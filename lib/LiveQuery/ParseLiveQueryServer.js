'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ParseLiveQueryServer = undefined;

var _tv = require('tv4');

var _tv2 = _interopRequireDefault(_tv);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _Subscription = require('./Subscription');

var _Client = require('./Client');

var _ParseWebSocketServer = require('./ParseWebSocketServer');

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

var _RequestSchema = require('./RequestSchema');

var _RequestSchema2 = _interopRequireDefault(_RequestSchema);

var _QueryTools = require('./QueryTools');

var _ParsePubSub = require('./ParsePubSub');

var _SessionTokenCache = require('./SessionTokenCache');

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _uuid = require('uuid');

var _uuid2 = _interopRequireDefault(_uuid);

var _triggers = require('../triggers');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class ParseLiveQueryServer {
  // className -> (queryHash -> subscription)
  constructor(server, config) {
    this.server = server;
    this.clients = new Map();
    this.subscriptions = new Map();

    config = config || {};

    // Store keys, convert obj to map
    const keyPairs = config.keyPairs || {};
    this.keyPairs = new Map();
    for (const key of Object.keys(keyPairs)) {
      this.keyPairs.set(key, keyPairs[key]);
    }
    _logger2.default.verbose('Support key pairs', this.keyPairs);

    // Initialize Parse
    _node2.default.Object.disableSingleInstance();

    const serverURL = config.serverURL || _node2.default.serverURL;
    _node2.default.serverURL = serverURL;
    const appId = config.appId || _node2.default.applicationId;
    const javascriptKey = _node2.default.javaScriptKey;
    const masterKey = config.masterKey || _node2.default.masterKey;
    _node2.default.initialize(appId, javascriptKey, masterKey);

    // Initialize websocket server
    this.parseWebSocketServer = new _ParseWebSocketServer.ParseWebSocketServer(server, parseWebsocket => this._onConnect(parseWebsocket), config.websocketTimeout);

    // Initialize subscriber
    this.subscriber = _ParsePubSub.ParsePubSub.createSubscriber(config);
    this.subscriber.subscribe(_node2.default.applicationId + 'afterSave');
    this.subscriber.subscribe(_node2.default.applicationId + 'afterDelete');
    // Register message handler for subscriber. When publisher get messages, it will publish message
    // to the subscribers and the handler will be called.
    this.subscriber.on('message', (channel, messageStr) => {
      _logger2.default.verbose('Subscribe messsage %j', messageStr);
      let message;
      try {
        message = JSON.parse(messageStr);
      } catch (e) {
        _logger2.default.error('unable to parse message', messageStr, e);
        return;
      }
      this._inflateParseObject(message);
      if (channel === _node2.default.applicationId + 'afterSave') {
        this._onAfterSave(message);
      } else if (channel === _node2.default.applicationId + 'afterDelete') {
        this._onAfterDelete(message);
      } else {
        _logger2.default.error('Get message %s from unknown channel %j', message, channel);
      }
    });

    // Initialize sessionToken cache
    this.sessionTokenCache = new _SessionTokenCache.SessionTokenCache(config.cacheTimeout);
  }

  // Message is the JSON object from publisher. Message.currentParseObject is the ParseObject JSON after changes.
  // Message.originalParseObject is the original ParseObject JSON.

  // The subscriber we use to get object update from publisher
  _inflateParseObject(message) {
    // Inflate merged object
    const currentParseObject = message.currentParseObject;
    let className = currentParseObject.className;
    let parseObject = new _node2.default.Object(className);
    parseObject._finishFetch(currentParseObject);
    message.currentParseObject = parseObject;
    // Inflate original object
    const originalParseObject = message.originalParseObject;
    if (originalParseObject) {
      className = originalParseObject.className;
      parseObject = new _node2.default.Object(className);
      parseObject._finishFetch(originalParseObject);
      message.originalParseObject = parseObject;
    }
  }

  // Message is the JSON object from publisher after inflated. Message.currentParseObject is the ParseObject after changes.
  // Message.originalParseObject is the original ParseObject.
  _onAfterDelete(message) {
    _logger2.default.verbose(_node2.default.applicationId + 'afterDelete is triggered');

    const deletedParseObject = message.currentParseObject.toJSON();
    const className = deletedParseObject.className;
    _logger2.default.verbose('ClassName: %j | ObjectId: %s', className, deletedParseObject.id);
    _logger2.default.verbose('Current client number : %d', this.clients.size);

    const classSubscriptions = this.subscriptions.get(className);
    if (typeof classSubscriptions === 'undefined') {
      _logger2.default.debug('Can not find subscriptions under this class ' + className);
      return;
    }
    for (const subscription of classSubscriptions.values()) {
      const isSubscriptionMatched = this._matchesSubscription(deletedParseObject, subscription);
      if (!isSubscriptionMatched) {
        continue;
      }
      for (const [clientId, requestIds] of _lodash2.default.entries(subscription.clientRequestIds)) {
        const client = this.clients.get(clientId);
        if (typeof client === 'undefined') {
          continue;
        }
        for (const requestId of requestIds) {
          const acl = message.currentParseObject.getACL();
          // Check ACL
          this._matchesACL(acl, client, requestId).then(isMatched => {
            if (!isMatched) {
              return null;
            }
            client.pushDelete(requestId, deletedParseObject);
          }, error => {
            _logger2.default.error('Matching ACL error : ', error);
          });
        }
      }
    }
  }

  // Message is the JSON object from publisher after inflated. Message.currentParseObject is the ParseObject after changes.
  // Message.originalParseObject is the original ParseObject.
  _onAfterSave(message) {
    _logger2.default.verbose(_node2.default.applicationId + 'afterSave is triggered');

    let originalParseObject = null;
    if (message.originalParseObject) {
      originalParseObject = message.originalParseObject.toJSON();
    }
    const currentParseObject = message.currentParseObject.toJSON();
    const className = currentParseObject.className;
    _logger2.default.verbose('ClassName: %s | ObjectId: %s', className, currentParseObject.id);
    _logger2.default.verbose('Current client number : %d', this.clients.size);

    const classSubscriptions = this.subscriptions.get(className);
    if (typeof classSubscriptions === 'undefined') {
      _logger2.default.debug('Can not find subscriptions under this class ' + className);
      return;
    }
    for (const subscription of classSubscriptions.values()) {
      const isOriginalSubscriptionMatched = this._matchesSubscription(originalParseObject, subscription);
      const isCurrentSubscriptionMatched = this._matchesSubscription(currentParseObject, subscription);
      for (const [clientId, requestIds] of _lodash2.default.entries(subscription.clientRequestIds)) {
        const client = this.clients.get(clientId);
        if (typeof client === 'undefined') {
          continue;
        }
        for (const requestId of requestIds) {
          // Set orignal ParseObject ACL checking promise, if the object does not match
          // subscription, we do not need to check ACL
          let originalACLCheckingPromise;
          if (!isOriginalSubscriptionMatched) {
            originalACLCheckingPromise = _node2.default.Promise.as(false);
          } else {
            let originalACL;
            if (message.originalParseObject) {
              originalACL = message.originalParseObject.getACL();
            }
            originalACLCheckingPromise = this._matchesACL(originalACL, client, requestId);
          }
          // Set current ParseObject ACL checking promise, if the object does not match
          // subscription, we do not need to check ACL
          let currentACLCheckingPromise;
          if (!isCurrentSubscriptionMatched) {
            currentACLCheckingPromise = _node2.default.Promise.as(false);
          } else {
            const currentACL = message.currentParseObject.getACL();
            currentACLCheckingPromise = this._matchesACL(currentACL, client, requestId);
          }

          _node2.default.Promise.when(originalACLCheckingPromise, currentACLCheckingPromise).then((isOriginalMatched, isCurrentMatched) => {
            _logger2.default.verbose('Original %j | Current %j | Match: %s, %s, %s, %s | Query: %s', originalParseObject, currentParseObject, isOriginalSubscriptionMatched, isCurrentSubscriptionMatched, isOriginalMatched, isCurrentMatched, subscription.hash);

            // Decide event type
            let type;
            if (isOriginalMatched && isCurrentMatched) {
              type = 'Update';
            } else if (isOriginalMatched && !isCurrentMatched) {
              type = 'Leave';
            } else if (!isOriginalMatched && isCurrentMatched) {
              if (originalParseObject) {
                type = 'Enter';
              } else {
                type = 'Create';
              }
            } else {
              return null;
            }
            const functionName = 'push' + type;
            client[functionName](requestId, currentParseObject);
          }, error => {
            _logger2.default.error('Matching ACL error : ', error);
          });
        }
      }
    }
  }

  _onConnect(parseWebsocket) {
    parseWebsocket.on('message', request => {
      if (typeof request === 'string') {
        try {
          request = JSON.parse(request);
        } catch (e) {
          _logger2.default.error('unable to parse request', request, e);
          return;
        }
      }
      _logger2.default.verbose('Request: %j', request);

      // Check whether this request is a valid request, return error directly if not
      if (!_tv2.default.validate(request, _RequestSchema2.default['general']) || !_tv2.default.validate(request, _RequestSchema2.default[request.op])) {
        _Client.Client.pushError(parseWebsocket, 1, _tv2.default.error.message);
        _logger2.default.error('Connect message error %s', _tv2.default.error.message);
        return;
      }

      switch (request.op) {
        case 'connect':
          this._handleConnect(parseWebsocket, request);
          break;
        case 'subscribe':
          this._handleSubscribe(parseWebsocket, request);
          break;
        case 'update':
          this._handleUpdateSubscription(parseWebsocket, request);
          break;
        case 'unsubscribe':
          this._handleUnsubscribe(parseWebsocket, request);
          break;
        default:
          _Client.Client.pushError(parseWebsocket, 3, 'Get unknown operation');
          _logger2.default.error('Get unknown operation', request.op);
      }
    });

    parseWebsocket.on('disconnect', () => {
      _logger2.default.info(`Client disconnect: ${parseWebsocket.clientId}`);
      const clientId = parseWebsocket.clientId;
      if (!this.clients.has(clientId)) {
        (0, _triggers.runLiveQueryEventHandlers)({
          event: 'ws_disconnect_error',
          clients: this.clients.size,
          subscriptions: this.subscriptions.size,
          error: `Unable to find client ${clientId}`
        });
        _logger2.default.error(`Can not find client ${clientId} on disconnect`);
        return;
      }

      // Delete client
      const client = this.clients.get(clientId);
      this.clients.delete(clientId);

      // Delete client from subscriptions
      for (const [requestId, subscriptionInfo] of _lodash2.default.entries(client.subscriptionInfos)) {
        const subscription = subscriptionInfo.subscription;
        subscription.deleteClientSubscription(clientId, requestId);

        // If there is no client which is subscribing this subscription, remove it from subscriptions
        const classSubscriptions = this.subscriptions.get(subscription.className);
        if (!subscription.hasSubscribingClient()) {
          classSubscriptions.delete(subscription.hash);
        }
        // If there is no subscriptions under this class, remove it from subscriptions
        if (classSubscriptions.size === 0) {
          this.subscriptions.delete(subscription.className);
        }
      }

      _logger2.default.verbose('Current clients %d', this.clients.size);
      _logger2.default.verbose('Current subscriptions %d', this.subscriptions.size);
      (0, _triggers.runLiveQueryEventHandlers)({
        event: 'ws_disconnect',
        clients: this.clients.size,
        subscriptions: this.subscriptions.size
      });
    });

    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'ws_connect',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });
  }

  _matchesSubscription(parseObject, subscription) {
    // Object is undefined or null, not match
    if (!parseObject) {
      return false;
    }
    return (0, _QueryTools.matchesQuery)(parseObject, subscription.query);
  }

  _matchesACL(acl, client, requestId) {
    // Return true directly if ACL isn't present, ACL is public read, or client has master key
    if (!acl || acl.getPublicReadAccess() || client.hasMasterKey) {
      return _node2.default.Promise.as(true);
    }
    // Check subscription sessionToken matches ACL first
    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    if (typeof subscriptionInfo === 'undefined') {
      return _node2.default.Promise.as(false);
    }

    const subscriptionSessionToken = subscriptionInfo.sessionToken;
    return this.sessionTokenCache.getUserId(subscriptionSessionToken).then(userId => {
      return acl.getReadAccess(userId);
    }).then(isSubscriptionSessionTokenMatched => {
      if (isSubscriptionSessionTokenMatched) {
        return _node2.default.Promise.as(true);
      }

      // Check if the user has any roles that match the ACL
      return new _node2.default.Promise((resolve, reject) => {

        // Resolve false right away if the acl doesn't have any roles
        const acl_has_roles = Object.keys(acl.permissionsById).some(key => key.startsWith("role:"));
        if (!acl_has_roles) {
          return resolve(false);
        }

        this.sessionTokenCache.getUserId(subscriptionSessionToken).then(userId => {

          // Pass along a null if there is no user id
          if (!userId) {
            return _node2.default.Promise.as(null);
          }

          // Prepare a user object to query for roles
          // To eliminate a query for the user, create one locally with the id
          var user = new _node2.default.User();
          user.id = userId;
          return user;
        }).then(user => {

          // Pass along an empty array (of roles) if no user
          if (!user) {
            return _node2.default.Promise.as([]);
          }

          // Then get the user's roles
          var rolesQuery = new _node2.default.Query(_node2.default.Role);
          rolesQuery.equalTo("users", user);
          return rolesQuery.find({ useMasterKey: true });
        }).then(roles => {

          // Finally, see if any of the user's roles allow them read access
          for (const role of roles) {
            if (acl.getRoleReadAccess(role)) {
              return resolve(true);
            }
          }
          resolve(false);
        }).catch(error => {
          reject(error);
        });
      });
    }).then(isRoleMatched => {

      if (isRoleMatched) {
        return _node2.default.Promise.as(true);
      }

      // Check client sessionToken matches ACL
      const clientSessionToken = client.sessionToken;
      return this.sessionTokenCache.getUserId(clientSessionToken).then(userId => {
        return acl.getReadAccess(userId);
      });
    }).then(isMatched => {
      return _node2.default.Promise.as(isMatched);
    }, () => {
      return _node2.default.Promise.as(false);
    });
  }

  _handleConnect(parseWebsocket, request) {
    if (!this._validateKeys(request, this.keyPairs)) {
      _Client.Client.pushError(parseWebsocket, 4, 'Key in request is not valid');
      _logger2.default.error('Key in request is not valid');
      return;
    }
    const hasMasterKey = this._hasMasterKey(request, this.keyPairs);
    const clientId = (0, _uuid2.default)();
    const client = new _Client.Client(clientId, parseWebsocket, hasMasterKey);
    parseWebsocket.clientId = clientId;
    this.clients.set(parseWebsocket.clientId, client);
    _logger2.default.info(`Create new client: ${parseWebsocket.clientId}`);
    client.pushConnect();
    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'connect',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });
  }

  _hasMasterKey(request, validKeyPairs) {
    if (!validKeyPairs || validKeyPairs.size == 0 || !validKeyPairs.has("masterKey")) {
      return false;
    }
    if (!request || !request.hasOwnProperty("masterKey")) {
      return false;
    }
    return request.masterKey === validKeyPairs.get("masterKey");
  }

  _validateKeys(request, validKeyPairs) {
    if (!validKeyPairs || validKeyPairs.size == 0) {
      return true;
    }
    let isValid = false;
    for (const [key, secret] of validKeyPairs) {
      if (!request[key] || request[key] !== secret) {
        continue;
      }
      isValid = true;
      break;
    }
    return isValid;
  }

  _handleSubscribe(parseWebsocket, request) {
    // If we can not find this client, return error to client
    if (!parseWebsocket.hasOwnProperty('clientId')) {
      _Client.Client.pushError(parseWebsocket, 2, 'Can not find this client, make sure you connect to server before subscribing');
      _logger2.default.error('Can not find this client, make sure you connect to server before subscribing');
      return;
    }
    const client = this.clients.get(parseWebsocket.clientId);

    // Get subscription from subscriptions, create one if necessary
    const subscriptionHash = (0, _QueryTools.queryHash)(request.query);
    // Add className to subscriptions if necessary
    const className = request.query.className;
    if (!this.subscriptions.has(className)) {
      this.subscriptions.set(className, new Map());
    }
    const classSubscriptions = this.subscriptions.get(className);
    let subscription;
    if (classSubscriptions.has(subscriptionHash)) {
      subscription = classSubscriptions.get(subscriptionHash);
    } else {
      subscription = new _Subscription.Subscription(className, request.query.where, subscriptionHash);
      classSubscriptions.set(subscriptionHash, subscription);
    }

    // Add subscriptionInfo to client
    const subscriptionInfo = {
      subscription: subscription
    };
    // Add selected fields and sessionToken for this subscription if necessary
    if (request.query.fields) {
      subscriptionInfo.fields = request.query.fields;
    }
    if (request.sessionToken) {
      subscriptionInfo.sessionToken = request.sessionToken;
    }
    client.addSubscriptionInfo(request.requestId, subscriptionInfo);

    // Add clientId to subscription
    subscription.addClientSubscription(parseWebsocket.clientId, request.requestId);

    client.pushSubscribe(request.requestId);

    _logger2.default.verbose(`Create client ${parseWebsocket.clientId} new subscription: ${request.requestId}`);
    _logger2.default.verbose('Current client number: %d', this.clients.size);
    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'subscribe',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });
  }

  _handleUpdateSubscription(parseWebsocket, request) {
    this._handleUnsubscribe(parseWebsocket, request, false);
    this._handleSubscribe(parseWebsocket, request);
  }

  _handleUnsubscribe(parseWebsocket, request, notifyClient = true) {
    // If we can not find this client, return error to client
    if (!parseWebsocket.hasOwnProperty('clientId')) {
      _Client.Client.pushError(parseWebsocket, 2, 'Can not find this client, make sure you connect to server before unsubscribing');
      _logger2.default.error('Can not find this client, make sure you connect to server before unsubscribing');
      return;
    }
    const requestId = request.requestId;
    const client = this.clients.get(parseWebsocket.clientId);
    if (typeof client === 'undefined') {
      _Client.Client.pushError(parseWebsocket, 2, 'Cannot find client with clientId ' + parseWebsocket.clientId + '. Make sure you connect to live query server before unsubscribing.');
      _logger2.default.error('Can not find this client ' + parseWebsocket.clientId);
      return;
    }

    const subscriptionInfo = client.getSubscriptionInfo(requestId);
    if (typeof subscriptionInfo === 'undefined') {
      _Client.Client.pushError(parseWebsocket, 2, 'Cannot find subscription with clientId ' + parseWebsocket.clientId + ' subscriptionId ' + requestId + '. Make sure you subscribe to live query server before unsubscribing.');
      _logger2.default.error('Can not find subscription with clientId ' + parseWebsocket.clientId + ' subscriptionId ' + requestId);
      return;
    }

    // Remove subscription from client
    client.deleteSubscriptionInfo(requestId);
    // Remove client from subscription
    const subscription = subscriptionInfo.subscription;
    const className = subscription.className;
    subscription.deleteClientSubscription(parseWebsocket.clientId, requestId);
    // If there is no client which is subscribing this subscription, remove it from subscriptions
    const classSubscriptions = this.subscriptions.get(className);
    if (!subscription.hasSubscribingClient()) {
      classSubscriptions.delete(subscription.hash);
    }
    // If there is no subscriptions under this class, remove it from subscriptions
    if (classSubscriptions.size === 0) {
      this.subscriptions.delete(className);
    }
    (0, _triggers.runLiveQueryEventHandlers)({
      event: 'unsubscribe',
      clients: this.clients.size,
      subscriptions: this.subscriptions.size
    });

    if (!notifyClient) {
      return;
    }

    client.pushUnsubscribe(request.requestId);

    _logger2.default.verbose(`Delete client: ${parseWebsocket.clientId} | subscription: ${request.requestId}`);
  }
}

exports.ParseLiveQueryServer = ParseLiveQueryServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9MaXZlUXVlcnkvUGFyc2VMaXZlUXVlcnlTZXJ2ZXIuanMiXSwibmFtZXMiOlsiUGFyc2VMaXZlUXVlcnlTZXJ2ZXIiLCJjb25zdHJ1Y3RvciIsInNlcnZlciIsImNvbmZpZyIsImNsaWVudHMiLCJNYXAiLCJzdWJzY3JpcHRpb25zIiwia2V5UGFpcnMiLCJrZXkiLCJPYmplY3QiLCJrZXlzIiwic2V0IiwidmVyYm9zZSIsImRpc2FibGVTaW5nbGVJbnN0YW5jZSIsInNlcnZlclVSTCIsImFwcElkIiwiYXBwbGljYXRpb25JZCIsImphdmFzY3JpcHRLZXkiLCJqYXZhU2NyaXB0S2V5IiwibWFzdGVyS2V5IiwiaW5pdGlhbGl6ZSIsInBhcnNlV2ViU29ja2V0U2VydmVyIiwicGFyc2VXZWJzb2NrZXQiLCJfb25Db25uZWN0Iiwid2Vic29ja2V0VGltZW91dCIsInN1YnNjcmliZXIiLCJjcmVhdGVTdWJzY3JpYmVyIiwic3Vic2NyaWJlIiwib24iLCJjaGFubmVsIiwibWVzc2FnZVN0ciIsIm1lc3NhZ2UiLCJKU09OIiwicGFyc2UiLCJlIiwiZXJyb3IiLCJfaW5mbGF0ZVBhcnNlT2JqZWN0IiwiX29uQWZ0ZXJTYXZlIiwiX29uQWZ0ZXJEZWxldGUiLCJzZXNzaW9uVG9rZW5DYWNoZSIsImNhY2hlVGltZW91dCIsImN1cnJlbnRQYXJzZU9iamVjdCIsImNsYXNzTmFtZSIsInBhcnNlT2JqZWN0IiwiX2ZpbmlzaEZldGNoIiwib3JpZ2luYWxQYXJzZU9iamVjdCIsImRlbGV0ZWRQYXJzZU9iamVjdCIsInRvSlNPTiIsImlkIiwic2l6ZSIsImNsYXNzU3Vic2NyaXB0aW9ucyIsImdldCIsImRlYnVnIiwic3Vic2NyaXB0aW9uIiwidmFsdWVzIiwiaXNTdWJzY3JpcHRpb25NYXRjaGVkIiwiX21hdGNoZXNTdWJzY3JpcHRpb24iLCJjbGllbnRJZCIsInJlcXVlc3RJZHMiLCJlbnRyaWVzIiwiY2xpZW50UmVxdWVzdElkcyIsImNsaWVudCIsInJlcXVlc3RJZCIsImFjbCIsImdldEFDTCIsIl9tYXRjaGVzQUNMIiwidGhlbiIsImlzTWF0Y2hlZCIsInB1c2hEZWxldGUiLCJpc09yaWdpbmFsU3Vic2NyaXB0aW9uTWF0Y2hlZCIsImlzQ3VycmVudFN1YnNjcmlwdGlvbk1hdGNoZWQiLCJvcmlnaW5hbEFDTENoZWNraW5nUHJvbWlzZSIsIlByb21pc2UiLCJhcyIsIm9yaWdpbmFsQUNMIiwiY3VycmVudEFDTENoZWNraW5nUHJvbWlzZSIsImN1cnJlbnRBQ0wiLCJ3aGVuIiwiaXNPcmlnaW5hbE1hdGNoZWQiLCJpc0N1cnJlbnRNYXRjaGVkIiwiaGFzaCIsInR5cGUiLCJmdW5jdGlvbk5hbWUiLCJyZXF1ZXN0IiwidmFsaWRhdGUiLCJvcCIsInB1c2hFcnJvciIsIl9oYW5kbGVDb25uZWN0IiwiX2hhbmRsZVN1YnNjcmliZSIsIl9oYW5kbGVVcGRhdGVTdWJzY3JpcHRpb24iLCJfaGFuZGxlVW5zdWJzY3JpYmUiLCJpbmZvIiwiaGFzIiwiZXZlbnQiLCJkZWxldGUiLCJzdWJzY3JpcHRpb25JbmZvIiwic3Vic2NyaXB0aW9uSW5mb3MiLCJkZWxldGVDbGllbnRTdWJzY3JpcHRpb24iLCJoYXNTdWJzY3JpYmluZ0NsaWVudCIsInF1ZXJ5IiwiZ2V0UHVibGljUmVhZEFjY2VzcyIsImhhc01hc3RlcktleSIsImdldFN1YnNjcmlwdGlvbkluZm8iLCJzdWJzY3JpcHRpb25TZXNzaW9uVG9rZW4iLCJzZXNzaW9uVG9rZW4iLCJnZXRVc2VySWQiLCJ1c2VySWQiLCJnZXRSZWFkQWNjZXNzIiwiaXNTdWJzY3JpcHRpb25TZXNzaW9uVG9rZW5NYXRjaGVkIiwicmVzb2x2ZSIsInJlamVjdCIsImFjbF9oYXNfcm9sZXMiLCJwZXJtaXNzaW9uc0J5SWQiLCJzb21lIiwic3RhcnRzV2l0aCIsInVzZXIiLCJVc2VyIiwicm9sZXNRdWVyeSIsIlF1ZXJ5IiwiUm9sZSIsImVxdWFsVG8iLCJmaW5kIiwidXNlTWFzdGVyS2V5Iiwicm9sZXMiLCJyb2xlIiwiZ2V0Um9sZVJlYWRBY2Nlc3MiLCJjYXRjaCIsImlzUm9sZU1hdGNoZWQiLCJjbGllbnRTZXNzaW9uVG9rZW4iLCJfdmFsaWRhdGVLZXlzIiwiX2hhc01hc3RlcktleSIsInB1c2hDb25uZWN0IiwidmFsaWRLZXlQYWlycyIsImhhc093blByb3BlcnR5IiwiaXNWYWxpZCIsInNlY3JldCIsInN1YnNjcmlwdGlvbkhhc2giLCJ3aGVyZSIsImZpZWxkcyIsImFkZFN1YnNjcmlwdGlvbkluZm8iLCJhZGRDbGllbnRTdWJzY3JpcHRpb24iLCJwdXNoU3Vic2NyaWJlIiwibm90aWZ5Q2xpZW50IiwiZGVsZXRlU3Vic2NyaXB0aW9uSW5mbyIsInB1c2hVbnN1YnNjcmliZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBRUEsTUFBTUEsb0JBQU4sQ0FBMkI7QUFFekI7QUFPQUMsY0FBWUMsTUFBWixFQUF5QkMsTUFBekIsRUFBc0M7QUFDcEMsU0FBS0QsTUFBTCxHQUFjQSxNQUFkO0FBQ0EsU0FBS0UsT0FBTCxHQUFlLElBQUlDLEdBQUosRUFBZjtBQUNBLFNBQUtDLGFBQUwsR0FBcUIsSUFBSUQsR0FBSixFQUFyQjs7QUFFQUYsYUFBU0EsVUFBVSxFQUFuQjs7QUFFQTtBQUNBLFVBQU1JLFdBQVdKLE9BQU9JLFFBQVAsSUFBbUIsRUFBcEM7QUFDQSxTQUFLQSxRQUFMLEdBQWdCLElBQUlGLEdBQUosRUFBaEI7QUFDQSxTQUFLLE1BQU1HLEdBQVgsSUFBa0JDLE9BQU9DLElBQVAsQ0FBWUgsUUFBWixDQUFsQixFQUF5QztBQUN2QyxXQUFLQSxRQUFMLENBQWNJLEdBQWQsQ0FBa0JILEdBQWxCLEVBQXVCRCxTQUFTQyxHQUFULENBQXZCO0FBQ0Q7QUFDRCxxQkFBT0ksT0FBUCxDQUFlLG1CQUFmLEVBQW9DLEtBQUtMLFFBQXpDOztBQUVBO0FBQ0EsbUJBQU1FLE1B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WUFBWVcsYUFBYVgsU0FBL0I7QUFDQVcsaUJBQWE0Qyx3QkFBYixDQUFzQzNFLGVBQWVtQyxRQUFyRCxFQUErREssU0FBL0Q7QUFDQTtBQUNBLFVBQU1aLHFCQUFxQixLQUFLNUMsYUFBTCxDQUFtQjZDLEdBQW5CLENBQXVCVCxTQUF2QixDQUEzQjtBQUNBLFFBQUksQ0FBQ1csYUFBYTZDLG9CQUFiLEVBQUwsRUFBMEM7QUFDeENoRCx5QkFBbUI0QyxNQUFuQixDQUEwQnpDLGFBQWEyQixJQUF2QztBQUNEO0FBQ0Q7QUFDQSxRQUFJOUIsbUJBQW1CRCxJQUFuQixLQUE0QixDQUFoQyxFQUFtQztBQUNqQyxXQUFLM0MsYUFBTCxDQUFtQndGLE1BQW5CLENBQTBCcEQsU0FBMUI7QUFDRDtBQUNELDZDQUEwQjtBQUN4Qm1ELGFBQU8sYUFEaUI7QUFFeEJ6RixlQUFTLEtBQUtBLE9BQUwsQ0FBYTZDLElBRkU7QUFHeEIzQyxxQkFBZSxLQUFLQSxhQUFMLENBQW1CMkM7QUFIVixLQUExQjs7QUFNQSxRQUFJLENBQUM2RixZQUFMLEVBQW1CO0FBQ2pCO0FBQ0Q7O0FBRURqRixXQUFPbUYsZUFBUCxDQUF1QjdELFFBQVFyQixTQUEvQjs7QUFFQSxxQkFBT2xELE9BQVAsQ0FBZ0Isa0JBQWlCVSxlQUFlbUMsUUFBUyxvQkFBbUIwQixRQUFRckIsU0FBVSxFQUE5RjtBQUNEO0FBOWlCd0I7O1FBa2pCekI5RCxvQixHQUFBQSxvQiIsImZpbGUiOiJQYXJzZUxpdmVRdWVyeVNlcnZlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB0djQgZnJvbSAndHY0JztcbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCB7IFN1YnNjcmlwdGlvbiB9IGZyb20gJy4vU3Vic2NyaXB0aW9uJztcbmltcG9ydCB7IENsaWVudCB9IGZyb20gJy4vQ2xpZW50JztcbmltcG9ydCB7IFBhcnNlV2ViU29ja2V0U2VydmVyIH0gZnJvbSAnLi9QYXJzZVdlYlNvY2tldFNlcnZlcic7XG5pbXBvcnQgbG9nZ2VyIGZyb20gJy4uL2xvZ2dlcic7XG5pbXBvcnQgUmVxdWVzdFNjaGVtYSBmcm9tICcuL1JlcXVlc3RTY2hlbWEnO1xuaW1wb3J0IHsgbWF0Y2hlc1F1ZXJ5LCBxdWVyeUhhc2ggfSBmcm9tICcuL1F1ZXJ5VG9vbHMnO1xuaW1wb3J0IHsgUGFyc2VQdWJTdWIgfSBmcm9tICcuL1BhcnNlUHViU3ViJztcbmltcG9ydCB7IFNlc3Npb25Ub2tlbkNhY2hlIH0gZnJvbSAnLi9TZXNzaW9uVG9rZW5DYWNoZSc7XG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnO1xuaW1wb3J0IHV1aWQgZnJvbSAndXVpZCc7XG5pbXBvcnQgeyBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzIH0gZnJvbSAnLi4vdHJpZ2dlcnMnO1xuXG5jbGFzcyBQYXJzZUxpdmVRdWVyeVNlcnZlciB7XG4gIGNsaWVudHM6IE1hcDtcbiAgLy8gY2xhc3NOYW1lIC0+IChxdWVyeUhhc2ggLT4gc3Vic2NyaXB0aW9uKVxuICBzdWJzY3JpcHRpb25zOiBPYmplY3Q7XG4gIHBhcnNlV2ViU29ja2V0U2VydmVyOiBPYmplY3Q7XG4gIGtleVBhaXJzIDogYW55O1xuICAvLyBUaGUgc3Vic2NyaWJlciB3ZSB1c2UgdG8gZ2V0IG9iamVjdCB1cGRhdGUgZnJvbSBwdWJsaXNoZXJcbiAgc3Vic2NyaWJlcjogT2JqZWN0O1xuXG4gIGNvbnN0cnVjdG9yKHNlcnZlcjogYW55LCBjb25maWc6IGFueSkge1xuICAgIHRoaXMuc2VydmVyID0gc2VydmVyO1xuICAgIHRoaXMuY2xpZW50cyA9IG5ldyBNYXAoKTtcbiAgICB0aGlzLnN1YnNjcmlwdGlvbnMgPSBuZXcgTWFwKCk7XG5cbiAgICBjb25maWcgPSBjb25maWcgfHwge307XG5cbiAgICAvLyBTdG9yZSBrZXlzLCBjb252ZXJ0IG9iaiB0byBtYXBcbiAgICBjb25zdCBrZXlQYWlycyA9IGNvbmZpZy5rZXlQYWlycyB8fCB7fTtcbiAgICB0aGlzLmtleVBhaXJzID0gbmV3IE1hcCgpO1xuICAgIGZvciAoY29uc3Qga2V5IG9mIE9iamVjdC5rZXlzKGtleVBhaXJzKSkge1xuICAgICAgdGhpcy5rZXlQYWlycy5zZXQoa2V5LCBrZXlQYWlyc1trZXldKTtcbiAgICB9XG4gICAgbG9nZ2VyLnZlcmJvc2UoJ1N1cHBvcnQga2V5IHBhaXJzJywgdGhpcy5rZXlQYWlycyk7XG5cbiAgICAvLyBJbml0aWFsaXplIFBhcnNlXG4gICAgUGFyc2UuT2JqZWN0LmRpc2FibGVTaW5nbGVJbnN0YW5jZSgpO1xuXG4gICAgY29uc3Qgc2VydmVyVVJMID0gY29uZmlnLnNlcnZlclVSTCB8fCBQYXJzZS5zZXJ2ZXJVUkw7XG4gICAgUGFyc2Uuc2VydmVyVVJMID0gc2VydmVyVVJMO1xuICAgIGNvbnN0IGFwcElkID0gY29uZmlnLmFwcElkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gICAgY29uc3QgamF2YXNjcmlwdEtleSA9IFBhcnNlLmphdmFTY3JpcHRLZXk7XG4gICAgY29uc3QgbWFzdGVyS2V5ID0gY29uZmlnLm1hc3RlcktleSB8fCBQYXJzZS5tYXN0ZXJLZXk7XG4gICAgUGFyc2UuaW5pdGlhbGl6ZShhcHBJZCwgamF2YXNjcmlwdEtleSwgbWFzdGVyS2V5KTtcblxuICAgIC8vIEluaXRpYWxpemUgd2Vic29ja2V0IHNlcnZlclxuICAgIHRoaXMucGFyc2VXZWJTb2NrZXRTZXJ2ZXIgPSBuZXcgUGFyc2VXZWJTb2NrZXRTZXJ2ZXIoXG4gICAgICBzZXJ2ZXIsXG4gICAgICAocGFyc2VXZWJzb2NrZXQpID0+IHRoaXMuX29uQ29ubmVjdChwYXJzZVdlYnNvY2tldCksXG4gICAgICBjb25maWcud2Vic29ja2V0VGltZW91dFxuICAgICk7XG5cbiAgICAvLyBJbml0aWFsaXplIHN1YnNjcmliZXJcbiAgICB0aGlzLnN1YnNjcmliZXIgPSBQYXJzZVB1YlN1Yi5jcmVhdGVTdWJzY3JpYmVyKGNvbmZpZyk7XG4gICAgdGhpcy5zdWJzY3JpYmVyLnN1YnNjcmliZShQYXJzZS5hcHBsaWNhdGlvbklkICsgJ2FmdGVyU2F2ZScpO1xuICAgIHRoaXMuc3Vic2NyaWJlci5zdWJzY3JpYmUoUGFyc2UuYXBwbGljYXRpb25JZCArICdhZnRlckRlbGV0ZScpO1xuICAgIC8vIFJlZ2lzdGVyIG1lc3NhZ2UgaGFuZGxlciBmb3Igc3Vic2NyaWJlci4gV2hlbiBwdWJsaXNoZXIgZ2V0IG1lc3NhZ2VzLCBpdCB3aWxsIHB1Ymxpc2ggbWVzc2FnZVxuICAgIC8vIHRvIHRoZSBzdWJzY3JpYmVycyBhbmQgdGhlIGhhbmRsZXIgd2lsbCBiZSBjYWxsZWQuXG4gICAgdGhpcy5zdWJzY3JpYmVyLm9uKCdtZXNzYWdlJywgKGNoYW5uZWwsIG1lc3NhZ2VTdHIpID0+IHtcbiAgICAgIGxvZ2dlci52ZXJib3NlKCdTdWJzY3JpYmUgbWVzc3NhZ2UgJWonLCBtZXNzYWdlU3RyKTtcbiAgICAgIGxldCBtZXNzYWdlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbWVzc2FnZSA9IEpTT04ucGFyc2UobWVzc2FnZVN0cik7XG4gICAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCd1bmFibGUgdG8gcGFyc2UgbWVzc2FnZScsIG1lc3NhZ2VTdHIsIGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aGlzLl9pbmZsYXRlUGFyc2VPYmplY3QobWVzc2FnZSk7XG4gICAgICBpZiAoY2hhbm5lbCA9PT0gUGFyc2UuYXBwbGljYXRpb25JZCArICdhZnRlclNhdmUnKSB7XG4gICAgICAgIHRoaXMuX29uQWZ0ZXJTYXZlKG1lc3NhZ2UpO1xuICAgICAgfSBlbHNlIGlmIChjaGFubmVsID09PSBQYXJzZS5hcHBsaWNhdGlvbklkICsgJ2FmdGVyRGVsZXRlJykge1xuICAgICAgICB0aGlzLl9vbkFmdGVyRGVsZXRlKG1lc3NhZ2UpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbG9nZ2VyLmVycm9yKCdHZXQgbWVzc2FnZSAlcyBmcm9tIHVua25vd24gY2hhbm5lbCAlaicsIG1lc3NhZ2UsIGNoYW5uZWwpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gSW5pdGlhbGl6ZSBzZXNzaW9uVG9rZW4gY2FjaGVcbiAgICB0aGlzLnNlc3Npb25Ub2tlbkNhY2hlID0gbmV3IFNlc3Npb25Ub2tlbkNhY2hlKGNvbmZpZy5jYWNoZVRpbWVvdXQpO1xuICB9XG5cbiAgLy8gTWVzc2FnZSBpcyB0aGUgSlNPTiBvYmplY3QgZnJvbSBwdWJsaXNoZXIuIE1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0IGlzIHRoZSBQYXJzZU9iamVjdCBKU09OIGFmdGVyIGNoYW5nZXMuXG4gIC8vIE1lc3NhZ2Uub3JpZ2luYWxQYXJzZU9iamVjdCBpcyB0aGUgb3JpZ2luYWwgUGFyc2VPYmplY3QgSlNPTi5cbiAgX2luZmxhdGVQYXJzZU9iamVjdChtZXNzYWdlOiBhbnkpOiB2b2lkIHtcbiAgICAvLyBJbmZsYXRlIG1lcmdlZCBvYmplY3RcbiAgICBjb25zdCBjdXJyZW50UGFyc2VPYmplY3QgPSBtZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdDtcbiAgICBsZXQgY2xhc3NOYW1lID0gY3VycmVudFBhcnNlT2JqZWN0LmNsYXNzTmFtZTtcbiAgICBsZXQgcGFyc2VPYmplY3QgPSBuZXcgUGFyc2UuT2JqZWN0KGNsYXNzTmFtZSk7XG4gICAgcGFyc2VPYmplY3QuX2ZpbmlzaEZldGNoKGN1cnJlbnRQYXJzZU9iamVjdCk7XG4gICAgbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QgPSBwYXJzZU9iamVjdDtcbiAgICAvLyBJbmZsYXRlIG9yaWdpbmFsIG9iamVjdFxuICAgIGNvbnN0IG9yaWdpbmFsUGFyc2VPYmplY3QgPSBtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3Q7XG4gICAgaWYgKG9yaWdpbmFsUGFyc2VPYmplY3QpIHtcbiAgICAgIGNsYXNzTmFtZSA9IG9yaWdpbmFsUGFyc2VPYmplY3QuY2xhc3NOYW1lO1xuICAgICAgcGFyc2VPYmplY3QgPSBuZXcgUGFyc2UuT2JqZWN0KGNsYXNzTmFtZSk7XG4gICAgICBwYXJzZU9iamVjdC5fZmluaXNoRmV0Y2gob3JpZ2luYWxQYXJzZU9iamVjdCk7XG4gICAgICBtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QgPSBwYXJzZU9iamVjdDtcbiAgICB9XG4gIH1cblxuICAvLyBNZXNzYWdlIGlzIHRoZSBKU09OIG9iamVjdCBmcm9tIHB1Ymxpc2hlciBhZnRlciBpbmZsYXRlZC4gTWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QgaXMgdGhlIFBhcnNlT2JqZWN0IGFmdGVyIGNoYW5nZXMuXG4gIC8vIE1lc3NhZ2Uub3JpZ2luYWxQYXJzZU9iamVjdCBpcyB0aGUgb3JpZ2luYWwgUGFyc2VPYmplY3QuXG4gIF9vbkFmdGVyRGVsZXRlKG1lc3NhZ2U6IGFueSk6IHZvaWQge1xuICAgIGxvZ2dlci52ZXJib3NlKFBhcnNlLmFwcGxpY2F0aW9uSWQgKyAnYWZ0ZXJEZWxldGUgaXMgdHJpZ2dlcmVkJyk7XG5cbiAgICBjb25zdCBkZWxldGVkUGFyc2VPYmplY3QgPSBtZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdC50b0pTT04oKTtcbiAgICBjb25zdCBjbGFzc05hbWUgPSBkZWxldGVkUGFyc2VPYmplY3QuY2xhc3NOYW1lO1xuICAgIGxvZ2dlci52ZXJib3NlKCdDbGFzc05hbWU6ICVqIHwgT2JqZWN0SWQ6ICVzJywgY2xhc3NOYW1lLCBkZWxldGVkUGFyc2VPYmplY3QuaWQpO1xuICAgIGxvZ2dlci52ZXJib3NlKCdDdXJyZW50IGNsaWVudCBudW1iZXIgOiAlZCcsIHRoaXMuY2xpZW50cy5zaXplKTtcblxuICAgIGNvbnN0IGNsYXNzU3Vic2NyaXB0aW9ucyA9IHRoaXMuc3Vic2NyaXB0aW9ucy5nZXQoY2xhc3NOYW1lKTtcbiAgICBpZiAodHlwZW9mIGNsYXNzU3Vic2NyaXB0aW9ucyA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGxvZ2dlci5kZWJ1ZygnQ2FuIG5vdCBmaW5kIHN1YnNjcmlwdGlvbnMgdW5kZXIgdGhpcyBjbGFzcyAnICsgY2xhc3NOYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBzdWJzY3JpcHRpb24gb2YgY2xhc3NTdWJzY3JpcHRpb25zLnZhbHVlcygpKSB7XG4gICAgICBjb25zdCBpc1N1YnNjcmlwdGlvbk1hdGNoZWQgPSB0aGlzLl9tYXRjaGVzU3Vic2NyaXB0aW9uKGRlbGV0ZWRQYXJzZU9iamVjdCwgc3Vic2NyaXB0aW9uKTtcbiAgICAgIGlmICghaXNTdWJzY3JpcHRpb25NYXRjaGVkKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBbY2xpZW50SWQsIHJlcXVlc3RJZHNdIG9mIF8uZW50cmllcyhzdWJzY3JpcHRpb24uY2xpZW50UmVxdWVzdElkcykpIHtcbiAgICAgICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnRzLmdldChjbGllbnRJZCk7XG4gICAgICAgIGlmICh0eXBlb2YgY2xpZW50ID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgcmVxdWVzdElkIG9mIHJlcXVlc3RJZHMpIHtcbiAgICAgICAgICBjb25zdCBhY2wgPSBtZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdC5nZXRBQ0woKTtcbiAgICAgICAgICAvLyBDaGVjayBBQ0xcbiAgICAgICAgICB0aGlzLl9tYXRjaGVzQUNMKGFjbCwgY2xpZW50LCByZXF1ZXN0SWQpLnRoZW4oKGlzTWF0Y2hlZCkgPT4ge1xuICAgICAgICAgICAgaWYgKCFpc01hdGNoZWQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIG51bGw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBjbGllbnQucHVzaERlbGV0ZShyZXF1ZXN0SWQsIGRlbGV0ZWRQYXJzZU9iamVjdCk7XG4gICAgICAgICAgfSwgKGVycm9yKSA9PiB7XG4gICAgICAgICAgICBsb2dnZXIuZXJyb3IoJ01hdGNoaW5nIEFDTCBlcnJvciA6ICcsIGVycm9yKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIE1lc3NhZ2UgaXMgdGhlIEpTT04gb2JqZWN0IGZyb20gcHVibGlzaGVyIGFmdGVyIGluZmxhdGVkLiBNZXNzYWdlLmN1cnJlbnRQYXJzZU9iamVjdCBpcyB0aGUgUGFyc2VPYmplY3QgYWZ0ZXIgY2hhbmdlcy5cbiAgLy8gTWVzc2FnZS5vcmlnaW5hbFBhcnNlT2JqZWN0IGlzIHRoZSBvcmlnaW5hbCBQYXJzZU9iamVjdC5cbiAgX29uQWZ0ZXJTYXZlKG1lc3NhZ2U6IGFueSk6IHZvaWQge1xuICAgIGxvZ2dlci52ZXJib3NlKFBhcnNlLmFwcGxpY2F0aW9uSWQgKyAnYWZ0ZXJTYXZlIGlzIHRyaWdnZXJlZCcpO1xuXG4gICAgbGV0IG9yaWdpbmFsUGFyc2VPYmplY3QgPSBudWxsO1xuICAgIGlmIChtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QpIHtcbiAgICAgIG9yaWdpbmFsUGFyc2VPYmplY3QgPSBtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QudG9KU09OKCk7XG4gICAgfVxuICAgIGNvbnN0IGN1cnJlbnRQYXJzZU9iamVjdCA9IG1lc3NhZ2UuY3VycmVudFBhcnNlT2JqZWN0LnRvSlNPTigpO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IGN1cnJlbnRQYXJzZU9iamVjdC5jbGFzc05hbWU7XG4gICAgbG9nZ2VyLnZlcmJvc2UoJ0NsYXNzTmFtZTogJXMgfCBPYmplY3RJZDogJXMnLCBjbGFzc05hbWUsIGN1cnJlbnRQYXJzZU9iamVjdC5pZCk7XG4gICAgbG9nZ2VyLnZlcmJvc2UoJ0N1cnJlbnQgY2xpZW50IG51bWJlciA6ICVkJywgdGhpcy5jbGllbnRzLnNpemUpO1xuXG4gICAgY29uc3QgY2xhc3NTdWJzY3JpcHRpb25zID0gdGhpcy5zdWJzY3JpcHRpb25zLmdldChjbGFzc05hbWUpO1xuICAgIGlmICh0eXBlb2YgY2xhc3NTdWJzY3JpcHRpb25zID09PSAndW5kZWZpbmVkJykge1xuICAgICAgbG9nZ2VyLmRlYnVnKCdDYW4gbm90IGZpbmQgc3Vic2NyaXB0aW9ucyB1bmRlciB0aGlzIGNsYXNzICcgKyBjbGFzc05hbWUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IHN1YnNjcmlwdGlvbiBvZiBjbGFzc1N1YnNjcmlwdGlvbnMudmFsdWVzKCkpIHtcbiAgICAgIGNvbnN0IGlzT3JpZ2luYWxTdWJzY3JpcHRpb25NYXRjaGVkID0gdGhpcy5fbWF0Y2hlc1N1YnNjcmlwdGlvbihvcmlnaW5hbFBhcnNlT2JqZWN0LCBzdWJzY3JpcHRpb24pO1xuICAgICAgY29uc3QgaXNDdXJyZW50U3Vic2NyaXB0aW9uTWF0Y2hlZCA9IHRoaXMuX21hdGNoZXNTdWJzY3JpcHRpb24oY3VycmVudFBhcnNlT2JqZWN0LCBzdWJzY3JpcHRpb24pO1xuICAgICAgZm9yIChjb25zdCBbY2xpZW50SWQsIHJlcXVlc3RJZHNdIG9mIF8uZW50cmllcyhzdWJzY3JpcHRpb24uY2xpZW50UmVxdWVzdElkcykpIHtcbiAgICAgICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnRzLmdldChjbGllbnRJZCk7XG4gICAgICAgIGlmICh0eXBlb2YgY2xpZW50ID09PSAndW5kZWZpbmVkJykge1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgcmVxdWVzdElkIG9mIHJlcXVlc3RJZHMpIHtcbiAgICAgICAgICAvLyBTZXQgb3JpZ25hbCBQYXJzZU9iamVjdCBBQ0wgY2hlY2tpbmcgcHJvbWlzZSwgaWYgdGhlIG9iamVjdCBkb2VzIG5vdCBtYXRjaFxuICAgICAgICAgIC8vIHN1YnNjcmlwdGlvbiwgd2UgZG8gbm90IG5lZWQgdG8gY2hlY2sgQUNMXG4gICAgICAgICAgbGV0IG9yaWdpbmFsQUNMQ2hlY2tpbmdQcm9taXNlO1xuICAgICAgICAgIGlmICghaXNPcmlnaW5hbFN1YnNjcmlwdGlvbk1hdGNoZWQpIHtcbiAgICAgICAgICAgIG9yaWdpbmFsQUNMQ2hlY2tpbmdQcm9taXNlID0gUGFyc2UuUHJvbWlzZS5hcyhmYWxzZSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGxldCBvcmlnaW5hbEFDTDtcbiAgICAgICAgICAgIGlmIChtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QpIHtcbiAgICAgICAgICAgICAgb3JpZ2luYWxBQ0wgPSBtZXNzYWdlLm9yaWdpbmFsUGFyc2VPYmplY3QuZ2V0QUNMKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBvcmlnaW5hbEFDTENoZWNraW5nUHJvbWlzZSA9IHRoaXMuX21hdGNoZXNBQ0wob3JpZ2luYWxBQ0wsIGNsaWVudCwgcmVxdWVzdElkKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgLy8gU2V0IGN1cnJlbnQgUGFyc2VPYmplY3QgQUNMIGNoZWNraW5nIHByb21pc2UsIGlmIHRoZSBvYmplY3QgZG9lcyBub3QgbWF0Y2hcbiAgICAgICAgICAvLyBzdWJzY3JpcHRpb24sIHdlIGRvIG5vdCBuZWVkIHRvIGNoZWNrIEFDTFxuICAgICAgICAgIGxldCBjdXJyZW50QUNMQ2hlY2tpbmdQcm9taXNlO1xuICAgICAgICAgIGlmICghaXNDdXJyZW50U3Vic2NyaXB0aW9uTWF0Y2hlZCkge1xuICAgICAgICAgICAgY3VycmVudEFDTENoZWNraW5nUHJvbWlzZSA9IFBhcnNlLlByb21pc2UuYXMoZmFsc2UpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zdCBjdXJyZW50QUNMID0gbWVzc2FnZS5jdXJyZW50UGFyc2VPYmplY3QuZ2V0QUNMKCk7XG4gICAgICAgICAgICBjdXJyZW50QUNMQ2hlY2tpbmdQcm9taXNlID0gdGhpcy5fbWF0Y2hlc0FDTChjdXJyZW50QUNMLCBjbGllbnQsIHJlcXVlc3RJZCk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgUGFyc2UuUHJvbWlzZS53aGVuKFxuICAgICAgICAgICAgb3JpZ2luYWxBQ0xDaGVja2luZ1Byb21pc2UsXG4gICAgICAgICAgICBjdXJyZW50QUNMQ2hlY2tpbmdQcm9taXNlXG4gICAgICAgICAgKS50aGVuKChpc09yaWdpbmFsTWF0Y2hlZCwgaXNDdXJyZW50TWF0Y2hlZCkgPT4ge1xuICAgICAgICAgICAgbG9nZ2VyLnZlcmJvc2UoJ09yaWdpbmFsICVqIHwgQ3VycmVudCAlaiB8IE1hdGNoOiAlcywgJXMsICVzLCAlcyB8IFF1ZXJ5OiAlcycsXG4gICAgICAgICAgICAgIG9yaWdpbmFsUGFyc2VPYmplY3QsXG4gICAgICAgICAgICAgIGN1cnJlbnRQYXJzZU9iamVjdCxcbiAgICAgICAgICAgICAgaXNPcmlnaW5hbFN1YnNjcmlwdGlvbk1hdGNoZWQsXG4gICAgICAgICAgICAgIGlzQ3VycmVudFN1YnNjcmlwdGlvbk1hdGNoZWQsXG4gICAgICAgICAgICAgIGlzT3JpZ2luYWxNYXRjaGVkLFxuICAgICAgICAgICAgICBpc0N1cnJlbnRNYXRjaGVkLFxuICAgICAgICAgICAgICBzdWJzY3JpcHRpb24uaGFzaFxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgLy8gRGVjaWRlIGV2ZW50IHR5cGVcbiAgICAgICAgICAgIGxldCB0eXBlO1xuICAgICAgICAgICAgaWYgKGlzT3JpZ2luYWxNYXRjaGVkICYmIGlzQ3VycmVudE1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgdHlwZSA9ICdVcGRhdGUnO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChpc09yaWdpbmFsTWF0Y2hlZCAmJiAhaXNDdXJyZW50TWF0Y2hlZCkge1xuICAgICAgICAgICAgICB0eXBlID0gJ0xlYXZlJztcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoIWlzT3JpZ2luYWxNYXRjaGVkICYmIGlzQ3VycmVudE1hdGNoZWQpIHtcbiAgICAgICAgICAgICAgaWYgKG9yaWdpbmFsUGFyc2VPYmplY3QpIHtcbiAgICAgICAgICAgICAgICB0eXBlID0gJ0VudGVyJztcbiAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICB0eXBlID0gJ0NyZWF0ZSc7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHJldHVybiBudWxsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgZnVuY3Rpb25OYW1lID0gJ3B1c2gnICsgdHlwZTtcbiAgICAgICAgICAgIGNsaWVudFtmdW5jdGlvbk5hbWVdKHJlcXVlc3RJZCwgY3VycmVudFBhcnNlT2JqZWN0KTtcbiAgICAgICAgICB9LCAoZXJyb3IpID0+IHtcbiAgICAgICAgICAgIGxvZ2dlci5lcnJvcignTWF0Y2hpbmcgQUNMIGVycm9yIDogJywgZXJyb3IpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgX29uQ29ubmVjdChwYXJzZVdlYnNvY2tldDogYW55KTogdm9pZCB7XG4gICAgcGFyc2VXZWJzb2NrZXQub24oJ21lc3NhZ2UnLCAocmVxdWVzdCkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiByZXF1ZXN0ID09PSAnc3RyaW5nJykge1xuICAgICAgICB0cnkge1xuICAgICAgICAgIHJlcXVlc3QgPSBKU09OLnBhcnNlKHJlcXVlc3QpO1xuICAgICAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgICBsb2dnZXIuZXJyb3IoJ3VuYWJsZSB0byBwYXJzZSByZXF1ZXN0JywgcmVxdWVzdCwgZSk7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBsb2dnZXIudmVyYm9zZSgnUmVxdWVzdDogJWonLCByZXF1ZXN0KTtcblxuICAgICAgLy8gQ2hlY2sgd2hldGhlciB0aGlzIHJlcXVlc3QgaXMgYSB2YWxpZCByZXF1ZXN0LCByZXR1cm4gZXJyb3IgZGlyZWN0bHkgaWYgbm90XG4gICAgICBpZiAoIXR2NC52YWxpZGF0ZShyZXF1ZXN0LCBSZXF1ZXN0U2NoZW1hWydnZW5lcmFsJ10pIHx8ICF0djQudmFsaWRhdGUocmVxdWVzdCwgUmVxdWVzdFNjaGVtYVtyZXF1ZXN0Lm9wXSkpIHtcbiAgICAgICAgQ2xpZW50LnB1c2hFcnJvcihwYXJzZVdlYnNvY2tldCwgMSwgdHY0LmVycm9yLm1lc3NhZ2UpO1xuICAgICAgICBsb2dnZXIuZXJyb3IoJ0Nvbm5lY3QgbWVzc2FnZSBlcnJvciAlcycsIHR2NC5lcnJvci5tZXNzYWdlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBzd2l0Y2gocmVxdWVzdC5vcCkge1xuICAgICAgY2FzZSAnY29ubmVjdCc6XG4gICAgICAgIHRoaXMuX2hhbmRsZUNvbm5lY3QocGFyc2VXZWJzb2NrZXQsIHJlcXVlc3QpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3N1YnNjcmliZSc6XG4gICAgICAgIHRoaXMuX2hhbmRsZVN1YnNjcmliZShwYXJzZVdlYnNvY2tldCwgcmVxdWVzdCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndXBkYXRlJzpcbiAgICAgICAgdGhpcy5faGFuZGxlVXBkYXRlU3Vic2NyaXB0aW9uKHBhcnNlV2Vic29ja2V0LCByZXF1ZXN0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1bnN1YnNjcmliZSc6XG4gICAgICAgIHRoaXMuX2hhbmRsZVVuc3Vic2NyaWJlKHBhcnNlV2Vic29ja2V0LCByZXF1ZXN0KTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCAzLCAnR2V0IHVua25vd24gb3BlcmF0aW9uJyk7XG4gICAgICAgIGxvZ2dlci5lcnJvcignR2V0IHVua25vd24gb3BlcmF0aW9uJywgcmVxdWVzdC5vcCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBwYXJzZVdlYnNvY2tldC5vbignZGlzY29ubmVjdCcsICgpID0+IHtcbiAgICAgIGxvZ2dlci5pbmZvKGBDbGllbnQgZGlzY29ubmVjdDogJHtwYXJzZVdlYnNvY2tldC5jbGllbnRJZH1gKTtcbiAgICAgIGNvbnN0IGNsaWVudElkID0gcGFyc2VXZWJzb2NrZXQuY2xpZW50SWQ7XG4gICAgICBpZiAoIXRoaXMuY2xpZW50cy5oYXMoY2xpZW50SWQpKSB7XG4gICAgICAgIHJ1bkxpdmVRdWVyeUV2ZW50SGFuZGxlcnMoe1xuICAgICAgICAgIGV2ZW50OiAnd3NfZGlzY29ubmVjdF9lcnJvcicsXG4gICAgICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemUsXG4gICAgICAgICAgZXJyb3I6IGBVbmFibGUgdG8gZmluZCBjbGllbnQgJHtjbGllbnRJZH1gXG4gICAgICAgIH0pO1xuICAgICAgICBsb2dnZXIuZXJyb3IoYENhbiBub3QgZmluZCBjbGllbnQgJHtjbGllbnRJZH0gb24gZGlzY29ubmVjdGApO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIC8vIERlbGV0ZSBjbGllbnRcbiAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50cy5nZXQoY2xpZW50SWQpO1xuICAgICAgdGhpcy5jbGllbnRzLmRlbGV0ZShjbGllbnRJZCk7XG5cbiAgICAgIC8vIERlbGV0ZSBjbGllbnQgZnJvbSBzdWJzY3JpcHRpb25zXG4gICAgICBmb3IgKGNvbnN0IFtyZXF1ZXN0SWQsIHN1YnNjcmlwdGlvbkluZm9dIG9mIF8uZW50cmllcyhjbGllbnQuc3Vic2NyaXB0aW9uSW5mb3MpKSB7XG4gICAgICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IHN1YnNjcmlwdGlvbkluZm8uc3Vic2NyaXB0aW9uO1xuICAgICAgICBzdWJzY3JpcHRpb24uZGVsZXRlQ2xpZW50U3Vic2NyaXB0aW9uKGNsaWVudElkLCByZXF1ZXN0SWQpO1xuXG4gICAgICAgIC8vIElmIHRoZXJlIGlzIG5vIGNsaWVudCB3aGljaCBpcyBzdWJzY3JpYmluZyB0aGlzIHN1YnNjcmlwdGlvbiwgcmVtb3ZlIGl0IGZyb20gc3Vic2NyaXB0aW9uc1xuICAgICAgICBjb25zdCBjbGFzc1N1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZ2V0KHN1YnNjcmlwdGlvbi5jbGFzc05hbWUpO1xuICAgICAgICBpZiAoIXN1YnNjcmlwdGlvbi5oYXNTdWJzY3JpYmluZ0NsaWVudCgpKSB7XG4gICAgICAgICAgY2xhc3NTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uaGFzaCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gSWYgdGhlcmUgaXMgbm8gc3Vic2NyaXB0aW9ucyB1bmRlciB0aGlzIGNsYXNzLCByZW1vdmUgaXQgZnJvbSBzdWJzY3JpcHRpb25zXG4gICAgICAgIGlmIChjbGFzc1N1YnNjcmlwdGlvbnMuc2l6ZSA9PT0gMCkge1xuICAgICAgICAgIHRoaXMuc3Vic2NyaXB0aW9ucy5kZWxldGUoc3Vic2NyaXB0aW9uLmNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgbG9nZ2VyLnZlcmJvc2UoJ0N1cnJlbnQgY2xpZW50cyAlZCcsIHRoaXMuY2xpZW50cy5zaXplKTtcbiAgICAgIGxvZ2dlci52ZXJib3NlKCdDdXJyZW50IHN1YnNjcmlwdGlvbnMgJWQnLCB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZSk7XG4gICAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHtcbiAgICAgICAgZXZlbnQ6ICd3c19kaXNjb25uZWN0JyxcbiAgICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICAgIHN1YnNjcmlwdGlvbnM6IHRoaXMuc3Vic2NyaXB0aW9ucy5zaXplXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJ1bkxpdmVRdWVyeUV2ZW50SGFuZGxlcnMoe1xuICAgICAgZXZlbnQ6ICd3c19jb25uZWN0JyxcbiAgICAgIGNsaWVudHM6IHRoaXMuY2xpZW50cy5zaXplLFxuICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemVcbiAgICB9KTtcbiAgfVxuXG4gIF9tYXRjaGVzU3Vic2NyaXB0aW9uKHBhcnNlT2JqZWN0OiBhbnksIHN1YnNjcmlwdGlvbjogYW55KTogYm9vbGVhbiB7XG4gICAgLy8gT2JqZWN0IGlzIHVuZGVmaW5lZCBvciBudWxsLCBub3QgbWF0Y2hcbiAgICBpZiAoIXBhcnNlT2JqZWN0KSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHJldHVybiBtYXRjaGVzUXVlcnkocGFyc2VPYmplY3QsIHN1YnNjcmlwdGlvbi5xdWVyeSk7XG4gIH1cblxuICBfbWF0Y2hlc0FDTChhY2w6IGFueSwgY2xpZW50OiBhbnksIHJlcXVlc3RJZDogbnVtYmVyKTogYW55IHtcbiAgICAvLyBSZXR1cm4gdHJ1ZSBkaXJlY3RseSBpZiBBQ0wgaXNuJ3QgcHJlc2VudCwgQUNMIGlzIHB1YmxpYyByZWFkLCBvciBjbGllbnQgaGFzIG1hc3RlciBrZXlcbiAgICBpZiAoIWFjbCB8fCBhY2wuZ2V0UHVibGljUmVhZEFjY2VzcygpIHx8IGNsaWVudC5oYXNNYXN0ZXJLZXkpIHtcbiAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKHRydWUpO1xuICAgIH1cbiAgICAvLyBDaGVjayBzdWJzY3JpcHRpb24gc2Vzc2lvblRva2VuIG1hdGNoZXMgQUNMIGZpcnN0XG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSW5mbyA9IGNsaWVudC5nZXRTdWJzY3JpcHRpb25JbmZvKHJlcXVlc3RJZCk7XG4gICAgaWYgKHR5cGVvZiBzdWJzY3JpcHRpb25JbmZvID09PSAndW5kZWZpbmVkJykge1xuICAgICAgcmV0dXJuIFBhcnNlLlByb21pc2UuYXMoZmFsc2UpO1xuICAgIH1cblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvblNlc3Npb25Ub2tlbiA9IHN1YnNjcmlwdGlvbkluZm8uc2Vzc2lvblRva2VuO1xuICAgIHJldHVybiB0aGlzLnNlc3Npb25Ub2tlbkNhY2hlLmdldFVzZXJJZChzdWJzY3JpcHRpb25TZXNzaW9uVG9rZW4pLnRoZW4oKHVzZXJJZCkgPT4ge1xuICAgICAgcmV0dXJuIGFjbC5nZXRSZWFkQWNjZXNzKHVzZXJJZCk7XG4gICAgfSkudGhlbigoaXNTdWJzY3JpcHRpb25TZXNzaW9uVG9rZW5NYXRjaGVkKSA9PiB7XG4gICAgICBpZiAoaXNTdWJzY3JpcHRpb25TZXNzaW9uVG9rZW5NYXRjaGVkKSB7XG4gICAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKHRydWUpO1xuICAgICAgfVxuXG4gICAgICAvLyBDaGVjayBpZiB0aGUgdXNlciBoYXMgYW55IHJvbGVzIHRoYXQgbWF0Y2ggdGhlIEFDTFxuICAgICAgcmV0dXJuIG5ldyBQYXJzZS5Qcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcblxuICAgICAgICAvLyBSZXNvbHZlIGZhbHNlIHJpZ2h0IGF3YXkgaWYgdGhlIGFjbCBkb2Vzbid0IGhhdmUgYW55IHJvbGVzXG4gICAgICAgIGNvbnN0IGFjbF9oYXNfcm9sZXMgPSBPYmplY3Qua2V5cyhhY2wucGVybWlzc2lvbnNCeUlkKS5zb21lKGtleSA9PiBrZXkuc3RhcnRzV2l0aChcInJvbGU6XCIpKTtcbiAgICAgICAgaWYgKCFhY2xfaGFzX3JvbGVzKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5zZXNzaW9uVG9rZW5DYWNoZS5nZXRVc2VySWQoc3Vic2NyaXB0aW9uU2Vzc2lvblRva2VuKVxuICAgICAgICAgIC50aGVuKCh1c2VySWQpID0+IHtcblxuICAgICAgICAgICAgLy8gUGFzcyBhbG9uZyBhIG51bGwgaWYgdGhlcmUgaXMgbm8gdXNlciBpZFxuICAgICAgICAgICAgaWYgKCF1c2VySWQpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFBhcnNlLlByb21pc2UuYXMobnVsbCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIFByZXBhcmUgYSB1c2VyIG9iamVjdCB0byBxdWVyeSBmb3Igcm9sZXNcbiAgICAgICAgICAgIC8vIFRvIGVsaW1pbmF0ZSBhIHF1ZXJ5IGZvciB0aGUgdXNlciwgY3JlYXRlIG9uZSBsb2NhbGx5IHdpdGggdGhlIGlkXG4gICAgICAgICAgICB2YXIgdXNlciA9IG5ldyBQYXJzZS5Vc2VyKCk7XG4gICAgICAgICAgICB1c2VyLmlkID0gdXNlcklkO1xuICAgICAgICAgICAgcmV0dXJuIHVzZXI7XG5cbiAgICAgICAgICB9KVxuICAgICAgICAgIC50aGVuKCh1c2VyKSA9PiB7XG5cbiAgICAgICAgICAgIC8vIFBhc3MgYWxvbmcgYW4gZW1wdHkgYXJyYXkgKG9mIHJvbGVzKSBpZiBubyB1c2VyXG4gICAgICAgICAgICBpZiAoIXVzZXIpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFBhcnNlLlByb21pc2UuYXMoW10pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAvLyBUaGVuIGdldCB0aGUgdXNlcidzIHJvbGVzXG4gICAgICAgICAgICB2YXIgcm9sZXNRdWVyeSA9IG5ldyBQYXJzZS5RdWVyeShQYXJzZS5Sb2xlKTtcbiAgICAgICAgICAgIHJvbGVzUXVlcnkuZXF1YWxUbyhcInVzZXJzXCIsIHVzZXIpO1xuICAgICAgICAgICAgcmV0dXJuIHJvbGVzUXVlcnkuZmluZCh7dXNlTWFzdGVyS2V5OnRydWV9KTtcbiAgICAgICAgICB9KS5cbiAgICAgICAgICB0aGVuKChyb2xlcykgPT4ge1xuXG4gICAgICAgICAgICAvLyBGaW5hbGx5LCBzZWUgaWYgYW55IG9mIHRoZSB1c2VyJ3Mgcm9sZXMgYWxsb3cgdGhlbSByZWFkIGFjY2Vzc1xuICAgICAgICAgICAgZm9yIChjb25zdCByb2xlIG9mIHJvbGVzKSB7XG4gICAgICAgICAgICAgIGlmIChhY2wuZ2V0Um9sZVJlYWRBY2Nlc3Mocm9sZSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzb2x2ZSh0cnVlKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzb2x2ZShmYWxzZSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAuY2F0Y2goKGVycm9yKSA9PiB7XG4gICAgICAgICAgICByZWplY3QoZXJyb3IpO1xuICAgICAgICAgIH0pO1xuXG4gICAgICB9KTtcbiAgICB9KS50aGVuKChpc1JvbGVNYXRjaGVkKSA9PiB7XG5cbiAgICAgIGlmKGlzUm9sZU1hdGNoZWQpIHtcbiAgICAgICAgcmV0dXJuIFBhcnNlLlByb21pc2UuYXModHJ1ZSk7XG4gICAgICB9XG5cbiAgICAgIC8vIENoZWNrIGNsaWVudCBzZXNzaW9uVG9rZW4gbWF0Y2hlcyBBQ0xcbiAgICAgIGNvbnN0IGNsaWVudFNlc3Npb25Ub2tlbiA9IGNsaWVudC5zZXNzaW9uVG9rZW47XG4gICAgICByZXR1cm4gdGhpcy5zZXNzaW9uVG9rZW5DYWNoZS5nZXRVc2VySWQoY2xpZW50U2Vzc2lvblRva2VuKS50aGVuKCh1c2VySWQpID0+IHtcbiAgICAgICAgcmV0dXJuIGFjbC5nZXRSZWFkQWNjZXNzKHVzZXJJZCk7XG4gICAgICB9KTtcbiAgICB9KS50aGVuKChpc01hdGNoZWQpID0+IHtcbiAgICAgIHJldHVybiBQYXJzZS5Qcm9taXNlLmFzKGlzTWF0Y2hlZCk7XG4gICAgfSwgKCkgPT4ge1xuICAgICAgcmV0dXJuIFBhcnNlLlByb21pc2UuYXMoZmFsc2UpO1xuICAgIH0pO1xuICB9XG5cbiAgX2hhbmRsZUNvbm5lY3QocGFyc2VXZWJzb2NrZXQ6IGFueSwgcmVxdWVzdDogYW55KTogYW55IHtcbiAgICBpZiAoIXRoaXMuX3ZhbGlkYXRlS2V5cyhyZXF1ZXN0LCB0aGlzLmtleVBhaXJzKSkge1xuICAgICAgQ2xpZW50LnB1c2hFcnJvcihwYXJzZVdlYnNvY2tldCwgNCwgJ0tleSBpbiByZXF1ZXN0IGlzIG5vdCB2YWxpZCcpO1xuICAgICAgbG9nZ2VyLmVycm9yKCdLZXkgaW4gcmVxdWVzdCBpcyBub3QgdmFsaWQnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgaGFzTWFzdGVyS2V5ID0gdGhpcy5faGFzTWFzdGVyS2V5KHJlcXVlc3QsIHRoaXMua2V5UGFpcnMpO1xuICAgIGNvbnN0IGNsaWVudElkID0gdXVpZCgpO1xuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBDbGllbnQoY2xpZW50SWQsIHBhcnNlV2Vic29ja2V0LCBoYXNNYXN0ZXJLZXkpO1xuICAgIHBhcnNlV2Vic29ja2V0LmNsaWVudElkID0gY2xpZW50SWQ7XG4gICAgdGhpcy5jbGllbnRzLnNldChwYXJzZVdlYnNvY2tldC5jbGllbnRJZCwgY2xpZW50KTtcbiAgICBsb2dnZXIuaW5mbyhgQ3JlYXRlIG5ldyBjbGllbnQ6ICR7cGFyc2VXZWJzb2NrZXQuY2xpZW50SWR9YCk7XG4gICAgY2xpZW50LnB1c2hDb25uZWN0KCk7XG4gICAgcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyh7XG4gICAgICBldmVudDogJ2Nvbm5lY3QnLFxuICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICBzdWJzY3JpcHRpb25zOiB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZVxuICAgIH0pO1xuICB9XG5cbiAgX2hhc01hc3RlcktleShyZXF1ZXN0OiBhbnksIHZhbGlkS2V5UGFpcnM6IGFueSk6IGJvb2xlYW4ge1xuICAgIGlmKCF2YWxpZEtleVBhaXJzIHx8IHZhbGlkS2V5UGFpcnMuc2l6ZSA9PSAwIHx8XG4gICAgICAhdmFsaWRLZXlQYWlycy5oYXMoXCJtYXN0ZXJLZXlcIikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgaWYoIXJlcXVlc3QgfHwgIXJlcXVlc3QuaGFzT3duUHJvcGVydHkoXCJtYXN0ZXJLZXlcIikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgcmV0dXJuIHJlcXVlc3QubWFzdGVyS2V5ID09PSB2YWxpZEtleVBhaXJzLmdldChcIm1hc3RlcktleVwiKTtcbiAgfVxuXG4gIF92YWxpZGF0ZUtleXMocmVxdWVzdDogYW55LCB2YWxpZEtleVBhaXJzOiBhbnkpOiBib29sZWFuIHtcbiAgICBpZiAoIXZhbGlkS2V5UGFpcnMgfHwgdmFsaWRLZXlQYWlycy5zaXplID09IDApIHtcbiAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICBsZXQgaXNWYWxpZCA9IGZhbHNlO1xuICAgIGZvciAoY29uc3QgW2tleSwgc2VjcmV0XSBvZiB2YWxpZEtleVBhaXJzKSB7XG4gICAgICBpZiAoIXJlcXVlc3Rba2V5XSB8fCByZXF1ZXN0W2tleV0gIT09IHNlY3JldCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlzVmFsaWQgPSB0cnVlO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIHJldHVybiBpc1ZhbGlkO1xuICB9XG5cbiAgX2hhbmRsZVN1YnNjcmliZShwYXJzZVdlYnNvY2tldDogYW55LCByZXF1ZXN0OiBhbnkpOiBhbnkge1xuICAgIC8vIElmIHdlIGNhbiBub3QgZmluZCB0aGlzIGNsaWVudCwgcmV0dXJuIGVycm9yIHRvIGNsaWVudFxuICAgIGlmICghcGFyc2VXZWJzb2NrZXQuaGFzT3duUHJvcGVydHkoJ2NsaWVudElkJykpIHtcbiAgICAgIENsaWVudC5wdXNoRXJyb3IocGFyc2VXZWJzb2NrZXQsIDIsICdDYW4gbm90IGZpbmQgdGhpcyBjbGllbnQsIG1ha2Ugc3VyZSB5b3UgY29ubmVjdCB0byBzZXJ2ZXIgYmVmb3JlIHN1YnNjcmliaW5nJyk7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0NhbiBub3QgZmluZCB0aGlzIGNsaWVudCwgbWFrZSBzdXJlIHlvdSBjb25uZWN0IHRvIHNlcnZlciBiZWZvcmUgc3Vic2NyaWJpbmcnKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnRzLmdldChwYXJzZVdlYnNvY2tldC5jbGllbnRJZCk7XG5cbiAgICAvLyBHZXQgc3Vic2NyaXB0aW9uIGZyb20gc3Vic2NyaXB0aW9ucywgY3JlYXRlIG9uZSBpZiBuZWNlc3NhcnlcbiAgICBjb25zdCBzdWJzY3JpcHRpb25IYXNoID0gcXVlcnlIYXNoKHJlcXVlc3QucXVlcnkpO1xuICAgIC8vIEFkZCBjbGFzc05hbWUgdG8gc3Vic2NyaXB0aW9ucyBpZiBuZWNlc3NhcnlcbiAgICBjb25zdCBjbGFzc05hbWUgPSByZXF1ZXN0LnF1ZXJ5LmNsYXNzTmFtZTtcbiAgICBpZiAoIXRoaXMuc3Vic2NyaXB0aW9ucy5oYXMoY2xhc3NOYW1lKSkge1xuICAgICAgdGhpcy5zdWJzY3JpcHRpb25zLnNldChjbGFzc05hbWUsIG5ldyBNYXAoKSk7XG4gICAgfVxuICAgIGNvbnN0IGNsYXNzU3Vic2NyaXB0aW9ucyA9IHRoaXMuc3Vic2NyaXB0aW9ucy5nZXQoY2xhc3NOYW1lKTtcbiAgICBsZXQgc3Vic2NyaXB0aW9uO1xuICAgIGlmIChjbGFzc1N1YnNjcmlwdGlvbnMuaGFzKHN1YnNjcmlwdGlvbkhhc2gpKSB7XG4gICAgICBzdWJzY3JpcHRpb24gPSBjbGFzc1N1YnNjcmlwdGlvbnMuZ2V0KHN1YnNjcmlwdGlvbkhhc2gpO1xuICAgIH0gZWxzZSB7XG4gICAgICBzdWJzY3JpcHRpb24gPSBuZXcgU3Vic2NyaXB0aW9uKGNsYXNzTmFtZSwgcmVxdWVzdC5xdWVyeS53aGVyZSwgc3Vic2NyaXB0aW9uSGFzaCk7XG4gICAgICBjbGFzc1N1YnNjcmlwdGlvbnMuc2V0KHN1YnNjcmlwdGlvbkhhc2gsIHN1YnNjcmlwdGlvbik7XG4gICAgfVxuXG4gICAgLy8gQWRkIHN1YnNjcmlwdGlvbkluZm8gdG8gY2xpZW50XG4gICAgY29uc3Qgc3Vic2NyaXB0aW9uSW5mbyA9IHtcbiAgICAgIHN1YnNjcmlwdGlvbjogc3Vic2NyaXB0aW9uXG4gICAgfTtcbiAgICAvLyBBZGQgc2VsZWN0ZWQgZmllbGRzIGFuZCBzZXNzaW9uVG9rZW4gZm9yIHRoaXMgc3Vic2NyaXB0aW9uIGlmIG5lY2Vzc2FyeVxuICAgIGlmIChyZXF1ZXN0LnF1ZXJ5LmZpZWxkcykge1xuICAgICAgc3Vic2NyaXB0aW9uSW5mby5maWVsZHMgPSByZXF1ZXN0LnF1ZXJ5LmZpZWxkcztcbiAgICB9XG4gICAgaWYgKHJlcXVlc3Quc2Vzc2lvblRva2VuKSB7XG4gICAgICBzdWJzY3JpcHRpb25JbmZvLnNlc3Npb25Ub2tlbiA9IHJlcXVlc3Quc2Vzc2lvblRva2VuO1xuICAgIH1cbiAgICBjbGllbnQuYWRkU3Vic2NyaXB0aW9uSW5mbyhyZXF1ZXN0LnJlcXVlc3RJZCwgc3Vic2NyaXB0aW9uSW5mbyk7XG5cbiAgICAvLyBBZGQgY2xpZW50SWQgdG8gc3Vic2NyaXB0aW9uXG4gICAgc3Vic2NyaXB0aW9uLmFkZENsaWVudFN1YnNjcmlwdGlvbihwYXJzZVdlYnNvY2tldC5jbGllbnRJZCwgcmVxdWVzdC5yZXF1ZXN0SWQpO1xuXG4gICAgY2xpZW50LnB1c2hTdWJzY3JpYmUocmVxdWVzdC5yZXF1ZXN0SWQpO1xuXG4gICAgbG9nZ2VyLnZlcmJvc2UoYENyZWF0ZSBjbGllbnQgJHtwYXJzZVdlYnNvY2tldC5jbGllbnRJZH0gbmV3IHN1YnNjcmlwdGlvbjogJHtyZXF1ZXN0LnJlcXVlc3RJZH1gKTtcbiAgICBsb2dnZXIudmVyYm9zZSgnQ3VycmVudCBjbGllbnQgbnVtYmVyOiAlZCcsIHRoaXMuY2xpZW50cy5zaXplKTtcbiAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHtcbiAgICAgIGV2ZW50OiAnc3Vic2NyaWJlJyxcbiAgICAgIGNsaWVudHM6IHRoaXMuY2xpZW50cy5zaXplLFxuICAgICAgc3Vic2NyaXB0aW9uczogdGhpcy5zdWJzY3JpcHRpb25zLnNpemVcbiAgICB9KTtcbiAgfVxuXG4gIF9oYW5kbGVVcGRhdGVTdWJzY3JpcHRpb24ocGFyc2VXZWJzb2NrZXQ6IGFueSwgcmVxdWVzdDogYW55KTogYW55IHtcbiAgICB0aGlzLl9oYW5kbGVVbnN1YnNjcmliZShwYXJzZVdlYnNvY2tldCwgcmVxdWVzdCwgZmFsc2UpO1xuICAgIHRoaXMuX2hhbmRsZVN1YnNjcmliZShwYXJzZVdlYnNvY2tldCwgcmVxdWVzdCk7XG4gIH1cblxuICBfaGFuZGxlVW5zdWJzY3JpYmUocGFyc2VXZWJzb2NrZXQ6IGFueSwgcmVxdWVzdDogYW55LCBub3RpZnlDbGllbnQ6IGJvb2wgPSB0cnVlKTogYW55IHtcbiAgICAvLyBJZiB3ZSBjYW4gbm90IGZpbmQgdGhpcyBjbGllbnQsIHJldHVybiBlcnJvciB0byBjbGllbnRcbiAgICBpZiAoIXBhcnNlV2Vic29ja2V0Lmhhc093blByb3BlcnR5KCdjbGllbnRJZCcpKSB7XG4gICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCAyLCAnQ2FuIG5vdCBmaW5kIHRoaXMgY2xpZW50LCBtYWtlIHN1cmUgeW91IGNvbm5lY3QgdG8gc2VydmVyIGJlZm9yZSB1bnN1YnNjcmliaW5nJyk7XG4gICAgICBsb2dnZXIuZXJyb3IoJ0NhbiBub3QgZmluZCB0aGlzIGNsaWVudCwgbWFrZSBzdXJlIHlvdSBjb25uZWN0IHRvIHNlcnZlciBiZWZvcmUgdW5zdWJzY3JpYmluZycpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCByZXF1ZXN0SWQgPSByZXF1ZXN0LnJlcXVlc3RJZDtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudHMuZ2V0KHBhcnNlV2Vic29ja2V0LmNsaWVudElkKTtcbiAgICBpZiAodHlwZW9mIGNsaWVudCA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIENsaWVudC5wdXNoRXJyb3IocGFyc2VXZWJzb2NrZXQsIDIsICdDYW5ub3QgZmluZCBjbGllbnQgd2l0aCBjbGllbnRJZCAnICArIHBhcnNlV2Vic29ja2V0LmNsaWVudElkICtcbiAgICAgICAgJy4gTWFrZSBzdXJlIHlvdSBjb25uZWN0IHRvIGxpdmUgcXVlcnkgc2VydmVyIGJlZm9yZSB1bnN1YnNjcmliaW5nLicpO1xuICAgICAgbG9nZ2VyLmVycm9yKCdDYW4gbm90IGZpbmQgdGhpcyBjbGllbnQgJyArIHBhcnNlV2Vic29ja2V0LmNsaWVudElkKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCBzdWJzY3JpcHRpb25JbmZvID0gY2xpZW50LmdldFN1YnNjcmlwdGlvbkluZm8ocmVxdWVzdElkKTtcbiAgICBpZiAodHlwZW9mIHN1YnNjcmlwdGlvbkluZm8gPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBDbGllbnQucHVzaEVycm9yKHBhcnNlV2Vic29ja2V0LCAyLCAnQ2Fubm90IGZpbmQgc3Vic2NyaXB0aW9uIHdpdGggY2xpZW50SWQgJyAgKyBwYXJzZVdlYnNvY2tldC5jbGllbnRJZCArXG4gICAgICAgICcgc3Vic2NyaXB0aW9uSWQgJyArIHJlcXVlc3RJZCArICcuIE1ha2Ugc3VyZSB5b3Ugc3Vic2NyaWJlIHRvIGxpdmUgcXVlcnkgc2VydmVyIGJlZm9yZSB1bnN1YnNjcmliaW5nLicpO1xuICAgICAgbG9nZ2VyLmVycm9yKCdDYW4gbm90IGZpbmQgc3Vic2NyaXB0aW9uIHdpdGggY2xpZW50SWQgJyArIHBhcnNlV2Vic29ja2V0LmNsaWVudElkICsgICcgc3Vic2NyaXB0aW9uSWQgJyArIHJlcXVlc3RJZCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIHN1YnNjcmlwdGlvbiBmcm9tIGNsaWVudFxuICAgIGNsaWVudC5kZWxldGVTdWJzY3JpcHRpb25JbmZvKHJlcXVlc3RJZCk7XG4gICAgLy8gUmVtb3ZlIGNsaWVudCBmcm9tIHN1YnNjcmlwdGlvblxuICAgIGNvbnN0IHN1YnNjcmlwdGlvbiA9IHN1YnNjcmlwdGlvbkluZm8uc3Vic2NyaXB0aW9uO1xuICAgIGNvbnN0IGNsYXNzTmFtZSA9IHN1YnNjcmlwdGlvbi5jbGFzc05hbWU7XG4gICAgc3Vic2NyaXB0aW9uLmRlbGV0ZUNsaWVudFN1YnNjcmlwdGlvbihwYXJzZVdlYnNvY2tldC5jbGllbnRJZCwgcmVxdWVzdElkKTtcbiAgICAvLyBJZiB0aGVyZSBpcyBubyBjbGllbnQgd2hpY2ggaXMgc3Vic2NyaWJpbmcgdGhpcyBzdWJzY3JpcHRpb24sIHJlbW92ZSBpdCBmcm9tIHN1YnNjcmlwdGlvbnNcbiAgICBjb25zdCBjbGFzc1N1YnNjcmlwdGlvbnMgPSB0aGlzLnN1YnNjcmlwdGlvbnMuZ2V0KGNsYXNzTmFtZSk7XG4gICAgaWYgKCFzdWJzY3JpcHRpb24uaGFzU3Vic2NyaWJpbmdDbGllbnQoKSkge1xuICAgICAgY2xhc3NTdWJzY3JpcHRpb25zLmRlbGV0ZShzdWJzY3JpcHRpb24uaGFzaCk7XG4gICAgfVxuICAgIC8vIElmIHRoZXJlIGlzIG5vIHN1YnNjcmlwdGlvbnMgdW5kZXIgdGhpcyBjbGFzcywgcmVtb3ZlIGl0IGZyb20gc3Vic2NyaXB0aW9uc1xuICAgIGlmIChjbGFzc1N1YnNjcmlwdGlvbnMuc2l6ZSA9PT0gMCkge1xuICAgICAgdGhpcy5zdWJzY3JpcHRpb25zLmRlbGV0ZShjbGFzc05hbWUpO1xuICAgIH1cbiAgICBydW5MaXZlUXVlcnlFdmVudEhhbmRsZXJzKHtcbiAgICAgIGV2ZW50OiAndW5zdWJzY3JpYmUnLFxuICAgICAgY2xpZW50czogdGhpcy5jbGllbnRzLnNpemUsXG4gICAgICBzdWJzY3JpcHRpb25zOiB0aGlzLnN1YnNjcmlwdGlvbnMuc2l6ZVxuICAgIH0pO1xuXG4gICAgaWYgKCFub3RpZnlDbGllbnQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjbGllbnQucHVzaFVuc3Vic2NyaWJlKHJlcXVlc3QucmVxdWVzdElkKTtcblxuICAgIGxvZ2dlci52ZXJib3NlKGBEZWxldGUgY2xpZW50OiAke3BhcnNlV2Vic29ja2V0LmNsaWVudElkfSB8IHN1YnNjcmlwdGlvbjogJHtyZXF1ZXN0LnJlcXVlc3RJZH1gKTtcbiAgfVxufVxuXG5leHBvcnQge1xuICBQYXJzZUxpdmVRdWVyeVNlcnZlclxufVxuIl19