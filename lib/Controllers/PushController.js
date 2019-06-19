'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushController = undefined;

var _node = require('parse/node');

var _RestQuery = require('../RestQuery');

var _RestQuery2 = _interopRequireDefault(_RestQuery);

var _RestWrite = require('../RestWrite');

var _RestWrite2 = _interopRequireDefault(_RestWrite);

var _Auth = require('../Auth');

var _StatusHandler = require('../StatusHandler');

var _utils = require('../Push/utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PushController {

  sendPush(body = {}, where = {}, config, auth, onPushStatusSaved = () => {}, now = new Date()) {
    if (!config.hasPushSupport) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Missing push configuration');
    }

    // Replace the expiration_time and push_time with a valid Unix epoch milliseconds time
    body.expiration_time = PushController.getExpirationTime(body);
    body.expiration_interval = PushController.getExpirationInterval(body);
    if (body.expiration_time && body.expiration_interval) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Both expiration_time and expiration_interval cannot be set');
    }

    // Immediate push
    if (body.expiration_interval && !body.hasOwnProperty('push_time')) {
      const ttlMs = body.expiration_interval * 1000;
      body.expiration_time = new Date(now.valueOf() + ttlMs).valueOf();
    }

    const pushTime = PushController.getPushTime(body);
    if (pushTime && pushTime.date !== 'undefined') {
      body['push_time'] = PushController.formatPushTime(pushTime);
    }

    // TODO: If the req can pass the checking, we return immediately instead of waiting
    // pushes to be sent. We probably change this behaviour in the future.
    let badgeUpdate = () => {
      return Promise.resolve();
    };

    if (body.data && body.data.badge) {
      const badge = body.data.badge;
      let restUpdate = {};
      if (typeof badge == 'string' && badge.toLowerCase() === 'increment') {
        restUpdate = { badge: { __op: 'Increment', amount: 1 } };
      } else if (typeof badge == 'object' && typeof badge.__op == 'string' && badge.__op.toLowerCase() == 'increment' && Number(badge.amount)) {
        restUpdate = { badge: { __op: 'Increment', amount: badge.amount } };
      } else if (Number(badge)) {
        restUpdate = { badge: badge };
      } else {
        throw "Invalid value for badge, expected number or 'Increment' or {increment: number}";
      }

      // Force filtering on only valid device tokens
      const updateWhere = (0, _utils.applyDeviceTokenExists)(where);
      badgeUpdate = () => {
        // Build a real RestQuery so we can use it in RestWrite
        const restQuery = new _RestQuery2.default(config, (0, _Auth.master)(config), '_Installation', updateWhere);
        return restQuery.buildRestWhere().then(() => {
          const write = new _RestWrite2.default(config, (0, _Auth.master)(config), '_Installation', restQuery.restWhere, restUpdate);
          write.runOptions.many = true;
          return write.execute();
        });
      };
    }
    const pushStatus = (0, _StatusHandler.pushStatusHandler)(config);
    return Promise.resolve().then(() => {
      return pushStatus.setInitial(body, where);
    }).then(() => {
      onPushStatusSaved(pushStatus.objectId);
      return badgeUpdate();
    }).then(() => {
      // Update audience lastUsed and timesUsed
      if (body.audience_id) {
        const audienceId = body.audience_id;

        var updateAudience = {
          lastUsed: { __type: "Date", iso: new Date().toISOString() },
          timesUsed: { __op: "Increment", "amount": 1 }
        };
        const write = new _RestWrite2.default(config, (0, _Auth.master)(config), '_Audience', { objectId: audienceId }, updateAudience);
        write.execute();
      }
      // Don't wait for the audience update promise to resolve.
      return Promise.resolve();
    }).then(() => {
      if (body.hasOwnProperty('push_time') && config.hasPushScheduledSupport) {
        return Promise.resolve();
      }
      return config.pushControllerQueue.enqueue(body, where, config, auth, pushStatus);
    }).catch(err => {
      return pushStatus.fail(err).then(() => {
        throw err;
      });
    });
  }

  /**
   * Get expiration time from the request body.
   * @param {Object} request A request object
   * @returns {Number|undefined} The expiration time if it exists in the request
   */
  static getExpirationTime(body = {}) {
    var hasExpirationTime = body.hasOwnProperty('expiration_time');
    if (!hasExpirationTime) {
      return;
    }
    var expirationTimeParam = body['expiration_time'];
    var expirationTime;
    if (typeof expirationTimeParam === 'number') {
      expirationTime = new Date(expirationTimeParam * 1000);
    } else if (typeof expirationTimeParam === 'string') {
      expirationTime = new Date(expirationTimeParam);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['expiration_time'] + ' is not valid time.');
    }
    // Check expirationTime is valid or not, if it is not valid, expirationTime is NaN
    if (!isFinite(expirationTime)) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['expiration_time'] + ' is not valid time.');
    }
    return expirationTime.valueOf();
  }

  static getExpirationInterval(body = {}) {
    const hasExpirationInterval = body.hasOwnProperty('expiration_interval');
    if (!hasExpirationInterval) {
      return;
    }

    var expirationIntervalParam = body['expiration_interval'];
    if (typeof expirationIntervalParam !== 'number' || expirationIntervalParam <= 0) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, `expiration_interval must be a number greater than 0`);
    }
    return expirationIntervalParam;
  }

  /**
   * Get push time from the request body.
   * @param {Object} request A request object
   * @returns {Number|undefined} The push time if it exists in the request
   */
  static getPushTime(body = {}) {
    var hasPushTime = body.hasOwnProperty('push_time');
    if (!hasPushTime) {
      return;
    }
    var pushTimeParam = body['push_time'];
    var date;
    var isLocalTime = true;

    if (typeof pushTimeParam === 'number') {
      date = new Date(pushTimeParam * 1000);
    } else if (typeof pushTimeParam === 'string') {
      isLocalTime = !PushController.pushTimeHasTimezoneComponent(pushTimeParam);
      date = new Date(pushTimeParam);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['push_time'] + ' is not valid time.');
    }
    // Check pushTime is valid or not, if it is not valid, pushTime is NaN
    if (!isFinite(date)) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, body['push_time'] + ' is not valid time.');
    }

    return {
      date,
      isLocalTime
    };
  }

  /**
   * Checks if a ISO8601 formatted date contains a timezone component
   * @param pushTimeParam {string}
   * @returns {boolean}
   */
  static pushTimeHasTimezoneComponent(pushTimeParam) {
    const offsetPattern = /(.+)([+-])\d\d:\d\d$/;
    return pushTimeParam.indexOf('Z') === pushTimeParam.length - 1 // 2007-04-05T12:30Z
    || offsetPattern.test(pushTimeParam); // 2007-04-05T12:30.000+02:00, 2007-04-05T12:30.000-02:00
  }

  /**
   * Converts a date to ISO format in UTC time and strips the timezone if `isLocalTime` is true
   * @param date {Date}
   * @param isLocalTime {boolean}
   * @returns {string}
   */
  static formatPushTime({ date, isLocalTime }) {
    if (isLocalTime) {
      // Strip 'Z'
      const isoString = date.toISOString();
      return isoString.substring(0, isoString.indexOf('Z'));
    }
    return date.toISOString();
  }
}

exports.PushController = PushController;
exports.default = PushController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9QdXNoQ29udHJvbGxlci5qcyJdLCJuYW1lcyI6WyJQdXNoQ29udHJvbGxlciIsInNlbmRQdXNoIiwiYm9keSIsIndoZXJlIiwiY29uZmlnIiwiYXV0aCIsIm9uUHVzaFN0YXR1c1NhdmVkIiwibm93IiwiRGF0ZSIsImhhc1B1c2hTdXBwb3J0IiwiRXJyb3IiLCJQVVNIX01JU0NPTkZJR1VSRUQiLCJleHBpcmF0aW9uX3RpbWUiLCJnZXRFeHBpcmF0aW9uVGltZSIsImV4cGlyYXRpb25faW50ZXJ2YWwiLCJnZXRFeHBpcmF0aW9uSW50ZXJ2YWwiLCJoYXNPd25Qcm9wZXJ0eSIsInR0bE1zIiwidmFsdWVPZiIsInB1c2hUaW1lIiwiZ2V0UHVzaFRpbWUiLCJkYXRlIiwiZm9ybWF0UHVzaFRpbWUiLCJiYWRnZVVwZGF0ZSIsIlByb21pc2UiLCJyZXNvbHZlIiwiZGF0YSIsImJhZGdlIiwicmVzdFVwZGF0ZSIsInRvTG93ZXJDYXNlIiwiX19vcCIsImFtb3VudCIsIk51bWJlciIsInVwZGF0ZVdoZXJlIiwicmVzdFF1ZXJ5IiwiYnVpbGRSZXN0V2hlcmUiLCJ0aGVuIiwid3JpdGUiLCJyZXN0V2hlcmUiLCJydW5PcHRpb25zIiwibWFueSIsImV4ZWN1dGUiLCJwdXNoU3RhdHVzIiwic2V0SW5pdGlhbCIsIm9iamVjdElkIiwiYXVkaWVuY2VfaWQiLCJhdWRpZW5jZUlkIiwidXBkYXRlQXVkaWVuY2UiLCJsYXN0VXNlZCIsIl9fdHlwZSIsImlzbyIsInRvSVNPU3RyaW5nIiwidGltZXNVc2VkIiwiaGFzUHVzaFNjaGVkdWxlZFN1cHBvcnQiLCJwdXNoQ29udHJvbGxlclF1ZXVlIiwiZW5xdWV1ZSIsImNhdGNoIiwiZXJyIiwiZmFpbCIsImhhc0V4cGlyYXRpb25UaW1lIiwiZXhwaXJhdGlvblRpbWVQYXJhbSIsImV4cGlyYXRpb25UaW1lIiwiaXNGaW5pdGUiLCJoYXNFeHBpcmF0aW9uSW50ZXJ2YWwiLCJleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSIsImhhc1B1c2hUaW1lIiwicHVzaFRpbWVQYXJhbSIsImlzTG9jYWxUaW1lIiwicHVzaFRpbWVIYXNUaW1lem9uZUNvbXBvbmVudCIsIm9mZnNldFBhdHRlcm4iLCJpbmRleE9mIiwibGVuZ3RoIiwidGVzdCIsImlzb1N0cmluZyIsInN1YnN0cmluZyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7QUFDQTs7OztBQUVPLE1BQU1BLGNBQU4sQ0FBcUI7O0FBRTFCQyxXQUFTQyxPQUFPLEVBQWhCLEVBQW9CQyxRQUFRLEVBQTVCLEVBQWdDQyxNQUFoQyxFQUF3Q0MsSUFBeEMsRUFBOENDLG9CQUFvQixNQUFNLENBQUUsQ0FBMUUsRUFBNEVDLE1BQU0sSUFBSUMsSUFBSixFQUFsRixFQUE4RjtBQUM1RixRQUFJLENBQUNKLE9BQU9LLGNBQVosRUFBNEI7QUFDMUIsWUFBTSxJQUFJLFlBQU1DLEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZQyxrQkFBNUIsRUFDSiw0QkFESSxDQUFOO0FBRUQ7O0FBRUQ7QUFDQVQsU0FBS1UsZUFBTCxHQUF1QlosZUFBZWEsaUJBQWYsQ0FBaUNYLElBQWpDLENBQXZCO0FBQ0FBLFNBQUtZLG1CQUFMLEdBQTJCZCxlQUFlZSxxQkFBZixDQUFxQ2IsSUFBckMsQ0FBM0I7QUFDQSxRQUFJQSxLQUFLVSxlQUFMLElBQXdCVixLQUFLWSxtQkFBakMsRUFBc0Q7QUFDcEQsWUFBTSxJQUFJLFlBQU1KLEtBQVYsQ0FDSixZQUFNQSxLQUFOLENBQVlDLGtCQURSLEVBRUosNERBRkksQ0FBTjtBQUdEOztBQUVEO0FBQ0EsUUFBSVQsS0FBS1ksbUJBQUwsSUFBNEIsQ0FBQ1osS0FBS2MsY0FBTCxDQUFvQixXQUFwQixDQUFqQyxFQUFtRTtBQUNqRSxZQUFNQyxRQUFRZixLQUFLWSxtQkFBTCxHQUEyQixJQUF6QztBQUNBWixXQUFLVSxlQUFMLEdBQXdCLElBQUlKLElBQUosQ0FBU0QsSUFBSVcsT0FBSixLQUFn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TCxFQUFQO0FBQ0Q7QUFoTXlCOztRQUFmbkQsYyxHQUFBQSxjO2tCQW1NRUEsYyIsImZpbGUiOiJQdXNoQ29udHJvbGxlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlIH0gICAgICAgICAgICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IFJlc3RRdWVyeSAgICAgICAgICAgICAgZnJvbSAnLi4vUmVzdFF1ZXJ5JztcbmltcG9ydCBSZXN0V3JpdGUgICAgICAgICAgICAgIGZyb20gJy4uL1Jlc3RXcml0ZSc7XG5pbXBvcnQgeyBtYXN0ZXIgfSAgICAgICAgICAgICBmcm9tICcuLi9BdXRoJztcbmltcG9ydCB7IHB1c2hTdGF0dXNIYW5kbGVyIH0gIGZyb20gJy4uL1N0YXR1c0hhbmRsZXInO1xuaW1wb3J0IHsgYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyB9IGZyb20gJy4uL1B1c2gvdXRpbHMnO1xuXG5leHBvcnQgY2xhc3MgUHVzaENvbnRyb2xsZXIge1xuXG4gIHNlbmRQdXNoKGJvZHkgPSB7fSwgd2hlcmUgPSB7fSwgY29uZmlnLCBhdXRoLCBvblB1c2hTdGF0dXNTYXZlZCA9ICgpID0+IHt9LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gICAgaWYgKCFjb25maWcuaGFzUHVzaFN1cHBvcnQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdNaXNzaW5nIHB1c2ggY29uZmlndXJhdGlvbicpO1xuICAgIH1cblxuICAgIC8vIFJlcGxhY2UgdGhlIGV4cGlyYXRpb25fdGltZSBhbmQgcHVzaF90aW1lIHdpdGggYSB2YWxpZCBVbml4IGVwb2NoIG1pbGxpc2Vjb25kcyB0aW1lXG4gICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uVGltZShib2R5KTtcbiAgICBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgPSBQdXNoQ29udHJvbGxlci5nZXRFeHBpcmF0aW9uSW50ZXJ2YWwoYm9keSk7XG4gICAgaWYgKGJvZHkuZXhwaXJhdGlvbl90aW1lICYmIGJvZHkuZXhwaXJhdGlvbl9pbnRlcnZhbCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgICdCb3RoIGV4cGlyYXRpb25fdGltZSBhbmQgZXhwaXJhdGlvbl9pbnRlcnZhbCBjYW5ub3QgYmUgc2V0Jyk7XG4gICAgfVxuXG4gICAgLy8gSW1tZWRpYXRlIHB1c2hcbiAgICBpZiAoYm9keS5leHBpcmF0aW9uX2ludGVydmFsICYmICFib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKSkge1xuICAgICAgY29uc3QgdHRsTXMgPSBib2R5LmV4cGlyYXRpb25faW50ZXJ2YWwgKiAxMDAwO1xuICAgICAgYm9keS5leHBpcmF0aW9uX3RpbWUgPSAobmV3IERhdGUobm93LnZhbHVlT2YoKSArIHR0bE1zKSkudmFsdWVPZigpO1xuICAgIH1cblxuICAgIGNvbnN0IHB1c2hUaW1lID0gUHVzaENvbnRyb2xsZXIuZ2V0UHVzaFRpbWUoYm9keSk7XG4gICAgaWYgKHB1c2hUaW1lICYmIHB1c2hUaW1lLmRhdGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBib2R5WydwdXNoX3RpbWUnXSA9IFB1c2hDb250cm9sbGVyLmZvcm1hdFB1c2hUaW1lKHB1c2hUaW1lKTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBJZiB0aGUgcmVxIGNhbiBwYXNzIHRoZSBjaGVja2luZywgd2UgcmV0dXJuIGltbWVkaWF0ZWx5IGluc3RlYWQgb2Ygd2FpdGluZ1xuICAgIC8vIHB1c2hlcyB0byBiZSBzZW50LiBXZSBwcm9iYWJseSBjaGFuZ2UgdGhpcyBiZWhhdmlvdXIgaW4gdGhlIGZ1dHVyZS5cbiAgICBsZXQgYmFkZ2VVcGRhdGUgPSAoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuXG4gICAgaWYgKGJvZHkuZGF0YSAmJiBib2R5LmRhdGEuYmFkZ2UpIHtcbiAgICAgIGNvbnN0IGJhZGdlID0gYm9keS5kYXRhLmJhZGdlO1xuICAgICAgbGV0IHJlc3RVcGRhdGUgPSB7fTtcbiAgICAgIGlmICh0eXBlb2YgYmFkZ2UgPT0gJ3N0cmluZycgJiYgYmFkZ2UudG9Mb3dlckNhc2UoKSA9PT0gJ2luY3JlbWVudCcpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IHsgX19vcDogJ0luY3JlbWVudCcsIGFtb3VudDogMSB9IH1cbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGJhZGdlID09ICdvYmplY3QnICYmIHR5cGVvZiBiYWRnZS5fX29wID09ICdzdHJpbmcnICYmXG4gICAgICAgICAgICAgICAgIGJhZGdlLl9fb3AudG9Mb3dlckNhc2UoKSA9PSAnaW5jcmVtZW50JyAmJiBOdW1iZXIoYmFkZ2UuYW1vdW50KSkge1xuICAgICAgICByZXN0VXBkYXRlID0geyBiYWRnZTogeyBfX29wOiAnSW5jcmVtZW50JywgYW1vdW50OiBiYWRnZS5hbW91bnQgfSB9XG4gICAgICB9IGVsc2UgaWYgKE51bWJlcihiYWRnZSkpIHtcbiAgICAgICAgcmVzdFVwZGF0ZSA9IHsgYmFkZ2U6IGJhZGdlIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IFwiSW52YWxpZCB2YWx1ZSBmb3IgYmFkZ2UsIGV4cGVjdGVkIG51bWJlciBvciAnSW5jcmVtZW50JyBvciB7aW5jcmVtZW50OiBudW1iZXJ9XCI7XG4gICAgICB9XG5cbiAgICAgIC8vIEZvcmNlIGZpbHRlcmluZyBvbiBvbmx5IHZhbGlkIGRldmljZSB0b2tlbnNcbiAgICAgIGNvbnN0IHVwZGF0ZVdoZXJlID0gYXBwbHlEZXZpY2VUb2tlbkV4aXN0cyh3aGVyZSk7XG4gICAgICBiYWRnZVVwZGF0ZSA9ICgpID0+IHtcbiAgICAgICAgLy8gQnVpbGQgYSByZWFsIFJlc3RRdWVyeSBzbyB3ZSBjYW4gdXNlIGl0IGluIFJlc3RXcml0ZVxuICAgICAgICBjb25zdCByZXN0UXVlcnkgPSBuZXcgUmVzdFF1ZXJ5KGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgdXBkYXRlV2hlcmUpO1xuICAgICAgICByZXR1cm4gcmVzdFF1ZXJ5LmJ1aWxkUmVzdFdoZXJlKCkudGhlbigoKSA9PiB7XG4gICAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfSW5zdGFsbGF0aW9uJywgcmVzdFF1ZXJ5LnJlc3RXaGVyZSwgcmVzdFVwZGF0ZSk7XG4gICAgICAgICAgd3JpdGUucnVuT3B0aW9ucy5tYW55ID0gdHJ1ZTtcbiAgICAgICAgICByZXR1cm4gd3JpdGUuZXhlY3V0ZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgcHVzaFN0YXR1cyA9IHB1c2hTdGF0dXNIYW5kbGVyKGNvbmZpZyk7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHB1c2hTdGF0dXMuc2V0SW5pdGlhbChib2R5LCB3aGVyZSk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICBvblB1c2hTdGF0dXNTYXZlZChwdXNoU3RhdHVzLm9iamVjdElkKTtcbiAgICAgIHJldHVybiBiYWRnZVVwZGF0ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgLy8gVXBkYXRlIGF1ZGllbmNlIGxhc3RVc2VkIGFuZCB0aW1lc1VzZWRcbiAgICAgIGlmIChib2R5LmF1ZGllbmNlX2lkKSB7XG4gICAgICAgIGNvbnN0IGF1ZGllbmNlSWQgPSBib2R5LmF1ZGllbmNlX2lkO1xuXG4gICAgICAgIHZhciB1cGRhdGVBdWRpZW5jZSA9IHtcbiAgICAgICAgICBsYXN0VXNlZDogeyBfX3R5cGU6IFwiRGF0ZVwiLCBpc286IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9LFxuICAgICAgICAgIHRpbWVzVXNlZDogeyBfX29wOiBcIkluY3JlbWVudFwiLCBcImFtb3VudFwiOiAxIH1cbiAgICAgICAgfTtcbiAgICAgICAgY29uc3Qgd3JpdGUgPSBuZXcgUmVzdFdyaXRlKGNvbmZpZywgbWFzdGVyKGNvbmZpZyksICdfQXVkaWVuY2UnLCB7b2JqZWN0SWQ6IGF1ZGllbmNlSWR9LCB1cGRhdGVBdWRpZW5jZSk7XG4gICAgICAgIHdyaXRlLmV4ZWN1dGUoKTtcbiAgICAgIH1cbiAgICAgIC8vIERvbid0IHdhaXQgZm9yIHRoZSBhdWRpZW5jZSB1cGRhdGUgcHJvbWlzZSB0byByZXNvbHZlLlxuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH0pLnRoZW4oKCkgPT4ge1xuICAgICAgaWYgKGJvZHkuaGFzT3duUHJvcGVydHkoJ3B1c2hfdGltZScpICYmIGNvbmZpZy5oYXNQdXNoU2NoZWR1bGVkU3VwcG9ydCkge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gY29uZmlnLnB1c2hDb250cm9sbGVyUXVldWUuZW5xdWV1ZShib2R5LCB3aGVyZSwgY29uZmlnLCBhdXRoLCBwdXNoU3RhdHVzKTtcbiAgICB9KS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICByZXR1cm4gcHVzaFN0YXR1cy5mYWlsKGVycikudGhlbigoKSA9PiB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEdldCBleHBpcmF0aW9uIHRpbWUgZnJvbSB0aGUgcmVxdWVzdCBib2R5LlxuICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtOdW1iZXJ8dW5kZWZpbmVkfSBUaGUgZXhwaXJhdGlvbiB0aW1lIGlmIGl0IGV4aXN0cyBpbiB0aGUgcmVxdWVzdFxuICAgKi9cbiAgc3RhdGljIGdldEV4cGlyYXRpb25UaW1lKGJvZHkgPSB7fSkge1xuICAgIHZhciBoYXNFeHBpcmF0aW9uVGltZSA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25fdGltZScpO1xuICAgIGlmICghaGFzRXhwaXJhdGlvblRpbWUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIGV4cGlyYXRpb25UaW1lUGFyYW0gPSBib2R5WydleHBpcmF0aW9uX3RpbWUnXTtcbiAgICB2YXIgZXhwaXJhdGlvblRpbWU7XG4gICAgaWYgKHR5cGVvZiBleHBpcmF0aW9uVGltZVBhcmFtID09PSAnbnVtYmVyJykge1xuICAgICAgZXhwaXJhdGlvblRpbWUgPSBuZXcgRGF0ZShleHBpcmF0aW9uVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZXhwaXJhdGlvblRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGV4cGlyYXRpb25UaW1lID0gbmV3IERhdGUoZXhwaXJhdGlvblRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ2V4cGlyYXRpb25fdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgZXhwaXJhdGlvblRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIGV4cGlyYXRpb25UaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZXhwaXJhdGlvblRpbWUpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBib2R5WydleHBpcmF0aW9uX3RpbWUnXSArICcgaXMgbm90IHZhbGlkIHRpbWUuJyk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uVGltZS52YWx1ZU9mKCk7XG4gIH1cblxuICBzdGF0aWMgZ2V0RXhwaXJhdGlvbkludGVydmFsKGJvZHkgPSB7fSkge1xuICAgIGNvbnN0IGhhc0V4cGlyYXRpb25JbnRlcnZhbCA9IGJvZHkuaGFzT3duUHJvcGVydHkoJ2V4cGlyYXRpb25faW50ZXJ2YWwnKTtcbiAgICBpZiAoIWhhc0V4cGlyYXRpb25JbnRlcnZhbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA9IGJvZHlbJ2V4cGlyYXRpb25faW50ZXJ2YWwnXTtcbiAgICBpZiAodHlwZW9mIGV4cGlyYXRpb25JbnRlcnZhbFBhcmFtICE9PSAnbnVtYmVyJyB8fCBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbSA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELFxuICAgICAgICBgZXhwaXJhdGlvbl9pbnRlcnZhbCBtdXN0IGJlIGEgbnVtYmVyIGdyZWF0ZXIgdGhhbiAwYCk7XG4gICAgfVxuICAgIHJldHVybiBleHBpcmF0aW9uSW50ZXJ2YWxQYXJhbTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcHVzaCB0aW1lIGZyb20gdGhlIHJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgQSByZXF1ZXN0IG9iamVjdFxuICAgKiBAcmV0dXJucyB7TnVtYmVyfHVuZGVmaW5lZH0gVGhlIHB1c2ggdGltZSBpZiBpdCBleGlzdHMgaW4gdGhlIHJlcXVlc3RcbiAgICovXG4gIHN0YXRpYyBnZXRQdXNoVGltZShib2R5ID0ge30pIHtcbiAgICB2YXIgaGFzUHVzaFRpbWUgPSBib2R5Lmhhc093blByb3BlcnR5KCdwdXNoX3RpbWUnKTtcbiAgICBpZiAoIWhhc1B1c2hUaW1lKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZhciBwdXNoVGltZVBhcmFtID0gYm9keVsncHVzaF90aW1lJ107XG4gICAgdmFyIGRhdGU7XG4gICAgdmFyIGlzTG9jYWxUaW1lID0gdHJ1ZTtcblxuICAgIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ251bWJlcicpIHtcbiAgICAgIGRhdGUgPSBuZXcgRGF0ZShwdXNoVGltZVBhcmFtICogMTAwMCk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcHVzaFRpbWVQYXJhbSA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGlzTG9jYWxUaW1lID0gIVB1c2hDb250cm9sbGVyLnB1c2hUaW1lSGFzVGltZXpvbmVDb21wb25lbnQocHVzaFRpbWVQYXJhbSk7XG4gICAgICBkYXRlID0gbmV3IERhdGUocHVzaFRpbWVQYXJhbSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG4gICAgLy8gQ2hlY2sgcHVzaFRpbWUgaXMgdmFsaWQgb3Igbm90LCBpZiBpdCBpcyBub3QgdmFsaWQsIHB1c2hUaW1lIGlzIE5hTlxuICAgIGlmICghaXNGaW5pdGUoZGF0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsXG4gICAgICAgIGJvZHlbJ3B1c2hfdGltZSddICsgJyBpcyBub3QgdmFsaWQgdGltZS4nKTtcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZSxcbiAgICAgIGlzTG9jYWxUaW1lLFxuICAgIH07XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIGlmIGEgSVNPODYwMSBmb3JtYXR0ZWQgZGF0ZSBjb250YWlucyBhIHRpbWV6b25lIGNvbXBvbmVudFxuICAgKiBAcGFyYW0gcHVzaFRpbWVQYXJhbSB7c3RyaW5nfVxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn1cbiAgICovXG4gIHN0YXRpYyBwdXNoVGltZUhhc1RpbWV6b25lQ29tcG9uZW50KHB1c2hUaW1lUGFyYW06IHN0cmluZyk6IGJvb2xlYW4ge1xuICAgIGNvbnN0IG9mZnNldFBhdHRlcm4gPSAvKC4rKShbKy1dKVxcZFxcZDpcXGRcXGQkLztcbiAgICByZXR1cm4gcHVzaFRpbWVQYXJhbS5pbmRleE9mKCdaJykgPT09IHB1c2hUaW1lUGFyYW0ubGVuZ3RoIC0gMSAvLyAyMDA3LTA0LTA1VDEyOjMwWlxuICAgICAgfHwgb2Zmc2V0UGF0dGVybi50ZXN0KHB1c2hUaW1lUGFyYW0pOyAvLyAyMDA3LTA0LTA1VDEyOjMwLjAwMCswMjowMCwgMjAwNy0wNC0wNVQxMjozMC4wMDAtMDI6MDBcbiAgfVxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhIGRhdGUgdG8gSVNPIGZvcm1hdCBpbiBVVEMgdGltZSBhbmQgc3RyaXBzIHRoZSB0aW1lem9uZSBpZiBgaXNMb2NhbFRpbWVgIGlzIHRydWVcbiAgICogQHBhcmFtIGRhdGUge0RhdGV9XG4gICAqIEBwYXJhbSBpc0xvY2FsVGltZSB7Ym9vbGVhbn1cbiAgICogQHJldHVybnMge3N0cmluZ31cbiAgICovXG4gIHN0YXRpYyBmb3JtYXRQdXNoVGltZSh7IGRhdGUsIGlzTG9jYWxUaW1lIH06IHsgZGF0ZTogRGF0ZSwgaXNMb2NhbFRpbWU6IGJvb2xlYW4gfSkge1xuICAgIGlmIChpc0xvY2FsVGltZSkgeyAvLyBTdHJpcCAnWidcbiAgICAgIGNvbnN0IGlzb1N0cmluZyA9IGRhdGUudG9JU09TdHJpbmcoKTtcbiAgICAgIHJldHVybiBpc29TdHJpbmcuc3Vic3RyaW5nKDAsIGlzb1N0cmluZy5pbmRleE9mKCdaJykpO1xuICAgIH1cbiAgICByZXR1cm4gZGF0ZS50b0lTT1N0cmluZygpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFB1c2hDb250cm9sbGVyO1xuIl19