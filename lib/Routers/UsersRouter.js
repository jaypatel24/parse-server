'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.UsersRouter = undefined;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _Config = require('../Config');

var _Config2 = _interopRequireDefault(_Config);

var _AccountLockout = require('../AccountLockout');

var _AccountLockout2 = _interopRequireDefault(_AccountLockout);

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _Auth = require('../Auth');

var _Auth2 = _interopRequireDefault(_Auth);

var _password = require('../password');

var _password2 = _interopRequireDefault(_password);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class UsersRouter extends _ClassesRouter2.default {

  className() {
    return '_User';
  }

  /**
   * Removes all "_" prefixed properties from an object, except "__type"
   * @param {Object} obj An object.
   */
  static removeHiddenProperties(obj) {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        // Regexp comes from Parse.Object.prototype.validate
        if (key !== "__type" && !/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
          delete obj[key];
        }
      }
    }
  }

  /**
   * Validates a password request in login and verifyPassword
   * @param {Object} req The request
   * @returns {Object} User object
   * @private
   */
  _authenticateUserFromRequest(req) {
    return new Promise((resolve, reject) => {
      // Use query parameters instead if provided in url
      let payload = req.body;
      if (!payload.username && req.query.username || !payload.email && req.query.email) {
        payload = req.query;
      }
      const {
        username,
        email,
        password
      } = payload;

      // TODO: use the right error codes / descriptions.
      if (!username && !email) {
        throw new _node2.default.Error(_node2.default.Error.USERNAME_MISSING, 'username/email is required.');
      }
      if (!password) {
        throw new _node2.default.Error(_node2.default.Error.PASSWORD_MISSING, 'password is required.');
      }
      if (typeof password !== 'string' || email && typeof email !== 'string' || username && typeof username !== 'string') {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
      }

      let user;
      let isValidPassword = false;
      let query;
      if (email && username) {
        query = { email, username };
      } else if (email) {
        query = { email };
      } else {
        query = { $or: [{ username }, { email: username }] };
      }
      return req.config.database.find('_User', query).then(results => {
        if (!results.length) {
          throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }

        if (results.length > 1) {
          // corner case where user1 has username == user2 email
          req.config.loggerController.warn('There is a user which email is the same as another user\'s username, logging in based on username');
          user = results.filter(user => user.username === username)[0];
        } else {
          user = results[0];
        }

        return _password2.default.compare(password, user.password);
      }).then(correct => {
        isValidPassword = correct;
        const accountLockoutPolicy = new _AccountLockout2.default(user, req.config);
        return accountLockoutPolicy.handleLoginAttempt(isValidPassword);
      }).then(() => {
        if (!isValidPassword) {
          throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }
        // Ensure the user isn't locked out
        // A locked out user won't be able to login
        // To lock a user out, just set the ACL to `masterKey` only  ({}).
        // Empty ACL is OK
        if (!req.auth.isMaster && user.ACL && Object.keys(user.ACL).length == 0) {
          throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Invalid username/password.');
        }
        if (req.config.verifyUserEmails && req.config.preventLoginWithUnverifiedEmail && !user.emailVerified) {
          throw new _node2.default.Error(_node2.default.Error.EMAIL_NOT_FOUND, 'User email is not verified.');
        }

        delete user.password;

        // Sometimes the authData still has null on that keys
        // https://github.com/parse-community/parse-server/issues/935
        if (user.authData) {
          Object.keys(user.authData).forEach(provider => {
            if (user.authData[provider] === null) {
              delete user.authData[provider];
            }
          });
          if (Object.keys(user.authData).length == 0) {
            delete user.authData;
          }
        }

        return resolve(user);
      }).catch(error => {
        return reject(error);
      });
    });
  }

  handleMe(req) {
    if (!req.info || !req.info.sessionToken) {
      throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
    }
    const sessionToken = req.info.sessionToken;
    return _rest2.default.find(req.config, _Auth2.default.master(req.config), '_Session', { sessionToken }, { include: 'user' }, req.info.clientSDK).then(response => {
      if (!response.results || response.results.length == 0 || !response.results[0].user) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Invalid session token');
      } else {
        const user = response.results[0].user;
        // Send token back on the login, because SDKs expect that.
        user.sessionToken = sessionToken;

        // Remove hidden properties.
        UsersRouter.removeHiddenProperties(user);

        return { response: user };
      }
    });
  }

  handleLogIn(req) {
    let user;
    return this._authenticateUserFromRequest(req).then(res => {

      user = res;

      // handle password expiry policy
      if (req.config.passwordPolicy && req.config.passwordPolicy.maxPasswordAge) {
        let changedAt = user._password_changed_at;

        if (!changedAt) {
          // password was created before expiry policy was enabled.
          // simply update _User object so that it will start enforcing from now
          changedAt = new Date();
          req.config.database.update('_User', { username: user.username }, { _password_changed_at: _node2.default._encode(changedAt) });
        } else {
          // check whether the password has expired
          if (changedAt.__type == 'Date') {
            changedAt = new Date(changedAt.iso);
          }
          // Calculate the expiry time.
          const expiresAt = new Date(changedAt.getTime() + 86400000 * req.config.passwordPolicy.maxPasswordAge);
          if (expiresAt < new Date()) // fail of current time is past password expiry time
            throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Your password has expired. Please reset your password.');
        }
      }

      // Remove hidden properties.
      UsersRouter.removeHiddenProperties(user);

      const {
        sessionData,
        createSession
      } = _Auth2.default.createSession(req.config, {
        userId: user.objectId, createdWith: {
          'action': 'login',
          'authProvider': 'password'
        }, installationId: req.info.installationId
      });

      user.sessionToken = sessionData.sessionToken;

      req.config.filesController.expandFilesInObject(req.config, user);

      return createSession();
    }).then(() => {
      return { response: user };
    });
  }

  handleVerifyPassword(req) {
    return this._authenticateUserFromRequest(req).then(user => {

      // Remove hidden properties.
      UsersRouter.removeHiddenProperties(user);

      return { response: user };
    }).catch(error => {
      throw error;
    });
  }

  handleLogOut(req) {
    const success = { response: {} };
    if (req.info && req.info.sessionToken) {
      return _rest2.default.find(req.config, _Auth2.default.master(req.config), '_Session', { sessionToken: req.info.sessionToken }, undefined, req.info.clientSDK).then(records => {
        if (records.results && records.results.length) {
          return _rest2.default.del(req.config, _Auth2.default.master(req.config), '_Session', records.results[0].objectId).then(() => {
            return Promise.resolve(success);
          });
        }
        return Promise.resolve(success);
      });
    }
    return Promise.resolve(success);
  }

  _throwOnBadEmailConfig(req) {
    try {
      _Config2.default.validateEmailConfiguration({
        emailAdapter: req.config.userController.adapter,
        appName: req.config.appName,
        publicServerURL: req.config.publicServerURL,
        emailVerifyTokenValidityDuration: req.config.emailVerifyTokenValidityDuration
      });
    } catch (e) {
      if (typeof e === 'string') {
        // Maybe we need a Bad Configuration error, but the SDKs won't understand it. For now, Internal Server Error.
        throw new _node2.default.Error(_node2.default.Error.INTERNAL_SERVER_ERROR, 'An appName, publicServerURL, and emailAdapter are required for password reset and email verification functionality.');
      } else {
        throw e;
      }
    }
  }

  handleResetRequest(req) {
    this._throwOnBadEmailConfig(req);

    const { email } = req.body;
    if (!email) {
      throw new _node2.default.Error(_node2.default.Error.EMAIL_MISSING, "you must provide an email");
    }
    if (typeof email !== 'string') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_EMAIL_ADDRESS, 'you must provide a valid email string');
    }
    const userController = req.config.userController;
    return userController.sendPasswordResetEmail(email).then(() => {
      return Promise.resolve({
        response: {}
      });
    }, err => {
      if (err.code === _node2.default.Error.OBJECT_NOT_FOUND) {
        throw new _node2.default.Error(_node2.default.Error.EMAIL_NOT_FOUND, `No user found with email ${email}.`);
      } else {
        throw err;
      }
    });
  }

  handleVerificationEmailRequest(req) {
    this._throwOnBadEmailConfig(req);

    const { email } = req.body;
    if (!email) {
      throw new _node2.default.Error(_node2.default.Error.EMAIL_MISSING, 'you must provide an email');
    }
    if (typeof email !== 'string') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_EMAIL_ADDRESS, 'you must provide a valid email string');
    }

    return req.config.database.find('_User', { email: email }).then(results => {
      if (!results.length || results.length < 1) {
        throw new _node2.default.Error(_node2.default.Error.EMAIL_NOT_FOUND, `No user found with email ${email}`);
      }
      const user = results[0];

      // remove password field, messes with saving on postgres
      delete user.password;

      if (user.emailVerified) {
        throw new _node2.default.Error(_node2.default.Error.OTHER_CAUSE, `Email ${email} is already verified.`);
      }

      const userController = req.config.userController;
      return userController.regenerateEmailVerifyToken(user).then(() => {
        userController.sendVerificationEmail(user);
        return { response: {} };
      });
    });
  }

  mountRoutes() {
    this.route('GET', '/users', req => {
      return this.handleFind(req);
    });
    this.route('POST', '/users', req => {
      return this.handleCreate(req);
    });
    this.route('GET', '/users/me', req => {
      return this.handleMe(req);
    });
    this.route('GET', '/users/:objectId', req => {
      return this.handleGet(req);
    });
    this.route('PUT', '/users/:objectId', req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/users/:objectId', req => {
      return this.handleDelete(req);
    });
    this.route('GET', '/login', req => {
      return this.handleLogIn(req);
    });
    this.route('POST', '/login', req => {
      return this.handleLogIn(req);
    });
    this.route('POST', '/logout', req => {
      return this.handleLogOut(req);
    });
    this.route('POST', '/requestPasswordReset', req => {
      return this.handleResetRequest(req);
    });
    this.route('POST', '/verificationEmailRequest', req => {
      return this.handleVerificationEmailRequest(req);
    });
    this.route('GET', '/verifyPassword', req => {
      return this.handleVerifyPassword(req);
    });
  }
}

exports.UsersRouter = UsersRouter; // These methods handle the User-related routes.

exports.default = UsersRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1VzZXJzUm91dGVyLmpzIl0sIm5hbWVzIjpbIlVzZXJzUm91dGVyIiwiY2xhc3NOYW1lIiwicmVtb3ZlSGlkZGVuUHJvcGVydGllcyIsIm9iaiIsImtleSIsImhhc093blByb3BlcnR5IiwidGVzdCIsIl9hdXRoZW50aWNhdGVVc2VyRnJvbVJlcXVlc3QiLCJyZXEiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlamVjdCIsInBheWxvYWQiLCJib2R5IiwidXNlcm5hbWUiLCJxdWVyeSIsImVtYWlsIiwicGFzc3dvcmQiLCJFcnJvciIsIlVTRVJOQU1FX01JU1NJTkciLCJQQVNTV09SRF9NSVNTSU5HIiwiT0JKRUNUX05PVF9GT1VORCIsInVzZXIiLCJpc1ZhbGlkUGFzc3dvcmQiLCIkb3IiLCJjb25maWciLCJkYXRhYmFzZSIsImZpbmQiLCJ0aGVuIiwicmVzdWx0cyIsImxlbmd0aCIsImxvZ2dlckNvbnRyb2xsZXIiLCJ3YXJuIiwiZmlsdGVyIiwiY29tcGFyZSIsImNvcnJlY3QiLCJhY2NvdW50TG9ja291dFBvbGljeSIsImhhbmRsZUxvZ2luQXR0ZW1wdCIsImF1dGgiLCJpc01hc3RlciIsIkFDTCIsIk9iamVjdCIsImtleXMiLCJ2ZXJpZnlVc2VyRW1haWxzIiwicHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCIsImVtYWlsVmVyaWZpZWQiLCJFTUFJTF9OT1RfRk9VTkQiLCJhdXRoRGF0YSIsImZvckVhY2giLCJwcm92aWRlciIsImNhdGNoIiwiZXJyb3IiLCJoYW5kbGVNZSIsImluZm8iLCJzZXNzaW9uVG9rZW4iLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJtYXN0ZXIiLCJpbmNsdWRlIiwiY2xpZW50U0RLIiwicmVzcG9uc2UiLCJoYW5kbGVMb2dJbiIsInJlcyIsInBhc3N3b3JkUG9saWN5IiwibWF4UGFzc3dvcmRBZ2UiLCJjaGFuZ2VkQXQiLCJfcGFzc3dvcmRfY2hhbmdlZF9hdCIsIkRhdGUiLCJ1cGRhdGUiLCJfZW5jb2RlIiwiX190eXBlIiwiaXNvIiwiZXhwaXJlc0F0IiwiZ2V0VGltZSIsInNlc3Npb25EYXRhIiwiY3JlYXRlU2Vzc2lvbiIsInVzZXJJZCIsIm9iamVjdElkIiwiY3JlYXRlZFdpdGgiLCJpbnN0YWxsYXRpb25JZCIsImZpbGVzQ29udHJvbGxlciIsImV4cGFuZEZpbGVzSW5PYmplY3QiLCJoYW5kbGVWZXJpZnlQYXNzd29yZCIsImhhbmRsZUxvZ091dCIsInN1Y2Nlc3MiLCJ1bmRlZmluZWQiLCJyZWNvcmRzIiwiZGVsIiwiX3Rocm93T25CYWRFbWFpbENvbmZpZyIsInZhbGlkYXRlRW1haWxDb25maWd1cmF0aW9uIiwiZW1haWxBZGFwdGVyIiwidXNlckNvbnRyb2xsZXIiLCJhZGFwdGVyIiwiYXBwTmFtZSIsInB1YmxpY1NlcnZlclVSTCIsImVtYWlsVmVyaWZ5VG9rZW5WYWxpZGl0eUR1cmF0aW9uIiwiZSIsIklOVEVSTkFMX1NFUlZFUl9FUlJPUiIsImhhbmRsZVJlc2V0UmVxdWVzdCIsIkVNQUlMX01JU1NJTkciLCJJTlZBTElEX0VNQUlMX0FERFJFU1MiLCJzZW5kUGFzc3dvcmRSZXNldEVtYWlsIiwiZXJyIiwiY29kZSIsImhhbmRsZVZlcmlmaWNhdGlvbkVtYWlsUmVxdWVzdCIsIk9USEVSX0NBVVNFIiwicmVnZW5lcmF0ZUVtYWlsVmVyaWZ5VG9rZW4iLCJzZW5kVmVyaWZpY2F0aW9uRW1haWwiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwiaGFuZGxlRmluZCIsImhhbmRsZUNyZWF0ZSIsImhhbmRsZUdldCIsImhhbmRsZVVwZGF0ZSIsImhhbmRsZURlbGV0ZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUVBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFTyxNQUFNQSxXQUFOLGlDQUF3Qzs7QUFFN0NDLGNBQVk7QUFDVixXQUFPLE9BQVA7QUFDRDs7QUFFRDs7OztBQUlBLFNBQU9DLHNCQUFQLENBQThCQyxHQUE5QixF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O0FBQ0EsU0FBS29HLEtBQUwsQ0FBVyxNQUFYLEVBQW1CLFFBQW5CLEVBQTZCcEcsT0FBTztBQUFFLGFBQU8sS0FBS29ELFdBQUwsQ0FBaUJwRCxHQUFqQixDQUFQO0FBQStCLEtBQXJFO0FBQ0EsU0FBS29HLEtBQUwsQ0FBVyxNQUFYLEVBQW1CLFNBQW5CLEVBQThCcEcsT0FBTztBQUFFLGFBQU8sS0FBSzBFLFlBQUwsQ0FBa0IxRSxHQUFsQixDQUFQO0FBQWdDLEtBQXZFO0FBQ0EsU0FBS29HLEtBQUwsQ0FBVyxNQUFYLEVBQW1CLHVCQUFuQixFQUE0Q3BHLE9BQU87QUFBRSxhQUFPLEtBQUt5RixrQkFBTCxDQUF3QnpGLEdBQXhCLENBQVA7QUFBc0MsS0FBM0Y7QUFDQSxTQUFLb0csS0FBTCxDQUFXLE1BQVgsRUFBbUIsMkJBQW5CLEVBQWdEcEcsT0FBTztBQUFFLGFBQU8sS0FBSytGLDhCQUFMLENBQW9DL0YsR0FBcEMsQ0FBUDtBQUFrRCxLQUEzRztBQUNBLFNBQUtvRyxLQUFMLENBQVcsS0FBWCxFQUFrQixpQkFBbEIsRUFBcUNwRyxPQUFPO0FBQUUsYUFBTyxLQUFLeUUsb0JBQUwsQ0FBMEJ6RSxHQUExQixDQUFQO0FBQXdDLEtBQXRGO0FBQ0Q7QUEvVDRDOztRQUFsQ1IsVyxHQUFBQSxXLEVBVmI7O2tCQTRVZUEsVyIsImZpbGUiOiJVc2Vyc1JvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIFRoZXNlIG1ldGhvZHMgaGFuZGxlIHRoZSBVc2VyLXJlbGF0ZWQgcm91dGVzLlxuXG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgQ29uZmlnIGZyb20gJy4uL0NvbmZpZyc7XG5pbXBvcnQgQWNjb3VudExvY2tvdXQgZnJvbSAnLi4vQWNjb3VudExvY2tvdXQnO1xuaW1wb3J0IENsYXNzZXNSb3V0ZXIgZnJvbSAnLi9DbGFzc2VzUm91dGVyJztcbmltcG9ydCByZXN0IGZyb20gJy4uL3Jlc3QnO1xuaW1wb3J0IEF1dGggZnJvbSAnLi4vQXV0aCc7XG5pbXBvcnQgcGFzc3dvcmRDcnlwdG8gZnJvbSAnLi4vcGFzc3dvcmQnO1xuXG5leHBvcnQgY2xhc3MgVXNlcnNSb3V0ZXIgZXh0ZW5kcyBDbGFzc2VzUm91dGVyIHtcblxuICBjbGFzc05hbWUoKSB7XG4gICAgcmV0dXJuICdfVXNlcic7XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlcyBhbGwgXCJfXCIgcHJlZml4ZWQgcHJvcGVydGllcyBmcm9tIGFuIG9iamVjdCwgZXhjZXB0IFwiX190eXBlXCJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9iaiBBbiBvYmplY3QuXG4gICAqL1xuICBzdGF0aWMgcmVtb3ZlSGlkZGVuUHJvcGVydGllcyhvYmopIHtcbiAgICBmb3IgKHZhciBrZXkgaW4gb2JqKSB7XG4gICAgICBpZiAob2JqLmhhc093blByb3BlcnR5KGtleSkpIHtcbiAgICAgICAgLy8gUmVnZXhwIGNvbWVzIGZyb20gUGFyc2UuT2JqZWN0LnByb3RvdHlwZS52YWxpZGF0ZVxuICAgICAgICBpZiAoa2V5ICE9PSBcIl9fdHlwZVwiICYmICEoL15bQS1aYS16XVswLTlBLVphLXpfXSokLykudGVzdChrZXkpKSB7XG4gICAgICAgICAgZGVsZXRlIG9ialtrZXldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFZhbGlkYXRlcyBhIHBhc3N3b3JkIHJlcXVlc3QgaW4gbG9naW4gYW5kIHZlcmlmeVBhc3N3b3JkXG4gICAqIEBwYXJhbSB7T2JqZWN0fSByZXEgVGhlIHJlcXVlc3RcbiAgICogQHJldHVybnMge09iamVjdH0gVXNlciBvYmplY3RcbiAgICogQHByaXZhdGVcbiAgICovXG4gIF9hdXRoZW50aWNhdGVVc2VyRnJvbVJlcXVlc3QocmVxKSB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIC8vIFVzZSBxdWVyeSBwYXJhbWV0ZXJzIGluc3RlYWQgaWYgcHJvdmlkZWQgaW4gdXJsXG4gICAgICBsZXQgcGF5bG9hZCA9IHJlcS5ib2R5O1xuICAgICAgaWYgKCFwYXlsb2FkLnVzZXJuYW1lICYmIHJlcS5xdWVyeS51c2VybmFtZSB8fCAhcGF5bG9hZC5lbWFpbCAmJiByZXEucXVlcnkuZW1haWwpIHtcbiAgICAgICAgcGF5bG9hZCA9IHJlcS5xdWVyeTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHtcbiAgICAgICAgdXNlcm5hbWUsXG4gICAgICAgIGVtYWlsLFxuICAgICAgICBwYXNzd29yZCxcbiAgICAgIH0gPSBwYXlsb2FkO1xuXG4gICAgICAvLyBUT0RPOiB1c2UgdGhlIHJpZ2h0IGVycm9yIGNvZGVzIC8gZGVzY3JpcHRpb25zLlxuICAgICAgaWYgKCF1c2VybmFtZSAmJiAhZW1haWwpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVTRVJOQU1FX01JU1NJTkcsICd1c2VybmFtZS9lbWFpbCBpcyByZXF1aXJlZC4nKTtcbiAgICAgIH1cbiAgICAgIGlmICghcGFzc3dvcmQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBBU1NXT1JEX01JU1NJTkcsICdwYXNzd29yZCBpcyByZXF1aXJlZC4nKTtcbiAgICAgIH1cbiAgICAgIGlmICh0eXBlb2YgcGFzc3dvcmQgIT09ICdzdHJpbmcnXG4gICAgICAgIHx8IGVtYWlsICYmIHR5cGVvZiBlbWFpbCAhPT0gJ3N0cmluZydcbiAgICAgICAgfHwgdXNlcm5hbWUgJiYgdHlwZW9mIHVzZXJuYW1lICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ0ludmFsaWQgdXNlcm5hbWUvcGFzc3dvcmQuJyk7XG4gICAgICB9XG5cbiAgICAgIGxldCB1c2VyO1xuICAgICAgbGV0IGlzVmFsaWRQYXNzd29yZCA9IGZhbHNlO1xuICAgICAgbGV0IHF1ZXJ5O1xuICAgICAgaWYgKGVtYWlsICYmIHVzZXJuYW1lKSB7XG4gICAgICAgIHF1ZXJ5ID0geyBlbWFpbCwgdXNlcm5hbWUgfTtcbiAgICAgIH0gZWxzZSBpZiAoZW1haWwpIHtcbiAgICAgICAgcXVlcnkgPSB7IGVtYWlsIH07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBxdWVyeSA9IHsgJG9yOiBbeyB1c2VybmFtZSB9LCB7IGVtYWlsOiB1c2VybmFtZSB9XSB9O1xuICAgICAgfVxuICAgICAgcmV0dXJuIHJlcS5jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCBxdWVyeSlcbiAgICAgICAgLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgICAgICBpZiAoIXJlc3VsdHMubGVuZ3RoKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ0ludmFsaWQgdXNlcm5hbWUvcGFzc3dvcmQuJyk7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMSkgeyAvLyBjb3JuZXIgY2FzZSB3aGVyZSB1c2VyMSBoYXMgdXNlcm5hbWUgPT0gdXNlcjIgZW1haWxcbiAgICAgICAgICAgIHJlcS5jb25maWcubG9nZ2VyQ29udHJvbGxlci53YXJuKCdUaGVyZSBpcyBhIHVzZXIgd2hpY2ggZW1haWwgaXMgdGhlIHNhbWUgYXMgYW5vdGhlciB1c2VyXFwncyB1c2VybmFtZSwgbG9nZ2luZyBpbiBiYXNlZCBvbiB1c2VybmFtZScpO1xuICAgICAgICAgICAgdXNlciA9IHJlc3VsdHMuZmlsdGVyKCh1c2VyKSA9PiB1c2VyLnVzZXJuYW1lID09PSB1c2VybmFtZSlbMF07XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHVzZXIgPSByZXN1bHRzWzBdO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiBwYXNzd29yZENyeXB0by5jb21wYXJlKHBhc3N3b3JkLCB1c2VyLnBhc3N3b3JkKTtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKGNvcnJlY3QpID0+IHtcbiAgICAgICAgICBpc1ZhbGlkUGFzc3dvcmQgPSBjb3JyZWN0O1xuICAgICAgICAgIGNvbnN0IGFjY291bnRMb2Nrb3V0UG9saWN5ID0gbmV3IEFjY291bnRMb2Nrb3V0KHVzZXIsIHJlcS5jb25maWcpO1xuICAgICAgICAgIHJldHVybiBhY2NvdW50TG9ja291dFBvbGljeS5oYW5kbGVMb2dpbkF0dGVtcHQoaXNWYWxpZFBhc3N3b3JkKTtcbiAgICAgICAgfSlcbiAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgIGlmICghaXNWYWxpZFBhc3N3b3JkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ0ludmFsaWQgdXNlcm5hbWUvcGFzc3dvcmQuJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIEVuc3VyZSB0aGUgdXNlciBpc24ndCBsb2NrZWQgb3V0XG4gICAgICAgICAgLy8gQSBsb2NrZWQgb3V0IHVzZXIgd29uJ3QgYmUgYWJsZSB0byBsb2dpblxuICAgICAgICAgIC8vIFRvIGxvY2sgYSB1c2VyIG91dCwganVzdCBzZXQgdGhlIEFDTCB0byBgbWFzdGVyS2V5YCBvbmx5ICAoe30pLlxuICAgICAgICAgIC8vIEVtcHR5IEFDTCBpcyBPS1xuICAgICAgICAgIGlmICghcmVxLmF1dGguaXNNYXN0ZXIgJiYgdXNlci5BQ0wgJiYgT2JqZWN0LmtleXModXNlci5BQ0wpLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ0ludmFsaWQgdXNlcm5hbWUvcGFzc3dvcmQuJyk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChyZXEuY29uZmlnLnZlcmlmeVVzZXJFbWFpbHMgJiYgcmVxLmNvbmZpZy5wcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsICYmICF1c2VyLmVtYWlsVmVyaWZpZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9OT1RfRk9VTkQsICdVc2VyIGVtYWlsIGlzIG5vdCB2ZXJpZmllZC4nKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBkZWxldGUgdXNlci5wYXNzd29yZDtcblxuICAgICAgICAgIC8vIFNvbWV0aW1lcyB0aGUgYXV0aERhdGEgc3RpbGwgaGFzIG51bGwgb24gdGhhdCBrZXlzXG4gICAgICAgICAgLy8gaHR0cHM6Ly9naXRodWIuY29tL3BhcnNlLWNvbW11bml0eS9wYXJzZS1zZXJ2ZXIvaXNzdWVzLzkzNVxuICAgICAgICAgIGlmICh1c2VyLmF1dGhEYXRhKSB7XG4gICAgICAgICAgICBPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5mb3JFYWNoKChwcm92aWRlcikgPT4ge1xuICAgICAgICAgICAgICBpZiAodXNlci5hdXRoRGF0YVtwcm92aWRlcl0gPT09IG51bGwpIHtcbiAgICAgICAgICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgaWYgKE9iamVjdC5rZXlzKHVzZXIuYXV0aERhdGEpLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgICAgICAgIGRlbGV0ZSB1c2VyLmF1dGhEYXRhO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cblxuICAgICAgICAgIHJldHVybiByZXNvbHZlKHVzZXIpO1xuICAgICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycm9yKTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBoYW5kbGVNZShyZXEpIHtcbiAgICBpZiAoIXJlcS5pbmZvIHx8ICFyZXEuaW5mby5zZXNzaW9uVG9rZW4pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1NFU1NJT05fVE9LRU4sICdJbnZhbGlkIHNlc3Npb24gdG9rZW4nKTtcbiAgICB9XG4gICAgY29uc3Qgc2Vzc2lvblRva2VuID0gcmVxLmluZm8uc2Vzc2lvblRva2VuO1xuICAgIHJldHVybiByZXN0LmZpbmQocmVxLmNvbmZpZywgQXV0aC5tYXN0ZXIocmVxLmNvbmZpZyksICdfU2Vzc2lvbicsXG4gICAgICB7IHNlc3Npb25Ub2tlbiB9LFxuICAgICAgeyBpbmNsdWRlOiAndXNlcicgfSwgcmVxLmluZm8uY2xpZW50U0RLKVxuICAgICAgLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIGlmICghcmVzcG9uc2UucmVzdWx0cyB8fFxuICAgICAgICAgIHJlc3BvbnNlLnJlc3VsdHMubGVuZ3RoID09IDAgfHxcbiAgICAgICAgICAhcmVzcG9uc2UucmVzdWx0c1swXS51c2VyKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTiwgJ0ludmFsaWQgc2Vzc2lvbiB0b2tlbicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGNvbnN0IHVzZXIgPSByZXNwb25zZS5yZXN1bHRzWzBdLnVzZXI7XG4gICAgICAgICAgLy8gU2VuZCB0b2tlbiBiYWNrIG9uIHRoZSBsb2dpbiwgYmVjYXVzZSBTREtzIGV4cGVjdCB0aGF0LlxuICAgICAgICAgIHVzZXIuc2Vzc2lvblRva2VuID0gc2Vzc2lvblRva2VuO1xuXG4gICAgICAgICAgLy8gUmVtb3ZlIGhpZGRlbiBwcm9wZXJ0aWVzLlxuICAgICAgICAgIFVzZXJzUm91dGVyLnJlbW92ZUhpZGRlblByb3BlcnRpZXModXNlcik7XG5cbiAgICAgICAgICByZXR1cm4geyByZXNwb25zZTogdXNlciB9O1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIGhhbmRsZUxvZ0luKHJlcSkge1xuICAgIGxldCB1c2VyO1xuICAgIHJldHVybiB0aGlzLl9hdXRoZW50aWNhdGVVc2VyRnJvbVJlcXVlc3QocmVxKVxuICAgICAgLnRoZW4oKHJlcykgPT4ge1xuXG4gICAgICAgIHVzZXIgPSByZXM7XG5cbiAgICAgICAgLy8gaGFuZGxlIHBhc3N3b3JkIGV4cGlyeSBwb2xpY3lcbiAgICAgICAgaWYgKHJlcS5jb25maWcucGFzc3dvcmRQb2xpY3kgJiYgcmVxLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEFnZSkge1xuICAgICAgICAgIGxldCBjaGFuZ2VkQXQgPSB1c2VyLl9wYXNzd29yZF9jaGFuZ2VkX2F0O1xuXG4gICAgICAgICAgaWYgKCFjaGFuZ2VkQXQpIHtcbiAgICAgICAgICAgIC8vIHBhc3N3b3JkIHdhcyBjcmVhdGVkIGJlZm9yZSBleHBpcnkgcG9saWN5IHdhcyBlbmFibGVkLlxuICAgICAgICAgICAgLy8gc2ltcGx5IHVwZGF0ZSBfVXNlciBvYmplY3Qgc28gdGhhdCBpdCB3aWxsIHN0YXJ0IGVuZm9yY2luZyBmcm9tIG5vd1xuICAgICAgICAgICAgY2hhbmdlZEF0ID0gbmV3IERhdGUoKTtcbiAgICAgICAgICAgIHJlcS5jb25maWcuZGF0YWJhc2UudXBkYXRlKCdfVXNlcicsIHsgdXNlcm5hbWU6IHVzZXIudXNlcm5hbWUgfSxcbiAgICAgICAgICAgICAgeyBfcGFzc3dvcmRfY2hhbmdlZF9hdDogUGFyc2UuX2VuY29kZShjaGFuZ2VkQXQpIH0pO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBjaGVjayB3aGV0aGVyIHRoZSBwYXNzd29yZCBoYXMgZXhwaXJlZFxuICAgICAgICAgICAgaWYgKGNoYW5nZWRBdC5fX3R5cGUgPT0gJ0RhdGUnKSB7XG4gICAgICAgICAgICAgIGNoYW5nZWRBdCA9IG5ldyBEYXRlKGNoYW5nZWRBdC5pc28pO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHRoZSBleHBpcnkgdGltZS5cbiAgICAgICAgICAgIGNvbnN0IGV4cGlyZXNBdCA9IG5ldyBEYXRlKGNoYW5nZWRBdC5nZXRUaW1lKCkgKyA4NjQwMDAwMCAqIHJlcS5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRBZ2UpO1xuICAgICAgICAgICAgaWYgKGV4cGlyZXNBdCA8IG5ldyBEYXRlKCkpIC8vIGZhaWwgb2YgY3VycmVudCB0aW1lIGlzIHBhc3QgcGFzc3dvcmQgZXhwaXJ5IHRpbWVcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdZb3VyIHBhc3N3b3JkIGhhcyBleHBpcmVkLiBQbGVhc2UgcmVzZXQgeW91ciBwYXNzd29yZC4nKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZW1vdmUgaGlkZGVuIHByb3BlcnRpZXMuXG4gICAgICAgIFVzZXJzUm91dGVyLnJlbW92ZUhpZGRlblByb3BlcnRpZXModXNlcik7XG5cbiAgICAgICAgY29uc3Qge1xuICAgICAgICAgIHNlc3Npb25EYXRhLFxuICAgICAgICAgIGNyZWF0ZVNlc3Npb25cbiAgICAgICAgfSA9IEF1dGguY3JlYXRlU2Vzc2lvbihyZXEuY29uZmlnLCB7XG4gICAgICAgICAgdXNlcklkOiB1c2VyLm9iamVjdElkLCBjcmVhdGVkV2l0aDoge1xuICAgICAgICAgICAgJ2FjdGlvbic6ICdsb2dpbicsXG4gICAgICAgICAgICAnYXV0aFByb3ZpZGVyJzogJ3Bhc3N3b3JkJ1xuICAgICAgICAgIH0sIGluc3RhbGxhdGlvbklkOiByZXEuaW5mby5pbnN0YWxsYXRpb25JZFxuICAgICAgICB9KTtcblxuICAgICAgICB1c2VyLnNlc3Npb25Ub2tlbiA9IHNlc3Npb25EYXRhLnNlc3Npb25Ub2tlbjtcblxuICAgICAgICByZXEuY29uZmlnLmZpbGVzQ29udHJvbGxlci5leHBhbmRGaWxlc0luT2JqZWN0KHJlcS5jb25maWcsIHVzZXIpO1xuXG4gICAgICAgIHJldHVybiBjcmVhdGVTZXNzaW9uKCk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4geyByZXNwb25zZTogdXNlciB9O1xuICAgICAgfSk7XG4gIH1cblxuICBoYW5kbGVWZXJpZnlQYXNzd29yZChyZXEpIHtcbiAgICByZXR1cm4gdGhpcy5fYXV0aGVudGljYXRlVXNlckZyb21SZXF1ZXN0KHJlcSlcbiAgICAgIC50aGVuKCh1c2VyKSA9PiB7XG5cbiAgICAgICAgLy8gUmVtb3ZlIGhpZGRlbiBwcm9wZXJ0aWVzLlxuICAgICAgICBVc2Vyc1JvdXRlci5yZW1vdmVIaWRkZW5Qcm9wZXJ0aWVzKHVzZXIpO1xuXG4gICAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB1c2VyIH07XG4gICAgICB9KS5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIGhhbmRsZUxvZ091dChyZXEpIHtcbiAgICBjb25zdCBzdWNjZXNzID0geyByZXNwb25zZToge30gfTtcbiAgICBpZiAocmVxLmluZm8gJiYgcmVxLmluZm8uc2Vzc2lvblRva2VuKSB7XG4gICAgICByZXR1cm4gcmVzdC5maW5kKHJlcS5jb25maWcsIEF1dGgubWFzdGVyKHJlcS5jb25maWcpLCAnX1Nlc3Npb24nLFxuICAgICAgICB7IHNlc3Npb25Ub2tlbjogcmVxLmluZm8uc2Vzc2lvblRva2VuIH0sIHVuZGVmaW5lZCwgcmVxLmluZm8uY2xpZW50U0RLXG4gICAgICApLnRoZW4oKHJlY29yZHMpID0+IHtcbiAgICAgICAgaWYgKHJlY29yZHMucmVzdWx0cyAmJiByZWNvcmRzLnJlc3VsdHMubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuIHJlc3QuZGVsKHJlcS5jb25maWcsIEF1dGgubWFzdGVyKHJlcS5jb25maWcpLCAnX1Nlc3Npb24nLFxuICAgICAgICAgICAgcmVjb3Jkcy5yZXN1bHRzWzBdLm9iamVjdElkXG4gICAgICAgICAgKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoc3VjY2Vzcyk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShzdWNjZXNzKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHN1Y2Nlc3MpO1xuICB9XG5cbiAgX3Rocm93T25CYWRFbWFpbENvbmZpZyhyZXEpIHtcbiAgICB0cnkge1xuICAgICAgQ29uZmlnLnZhbGlkYXRlRW1haWxDb25maWd1cmF0aW9uKHtcbiAgICAgICAgZW1haWxBZGFwdGVyOiByZXEuY29uZmlnLnVzZXJDb250cm9sbGVyLmFkYXB0ZXIsXG4gICAgICAgIGFwcE5hbWU6IHJlcS5jb25maWcuYXBwTmFtZSxcbiAgICAgICAgcHVibGljU2VydmVyVVJMOiByZXEuY29uZmlnLnB1YmxpY1NlcnZlclVSTCxcbiAgICAgICAgZW1haWxWZXJpZnlUb2tlblZhbGlkaXR5RHVyYXRpb246IHJlcS5jb25maWcuZW1haWxWZXJpZnlUb2tlblZhbGlkaXR5RHVyYXRpb25cbiAgICAgIH0pO1xuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIGlmICh0eXBlb2YgZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgLy8gTWF5YmUgd2UgbmVlZCBhIEJhZCBDb25maWd1cmF0aW9uIGVycm9yLCBidXQgdGhlIFNES3Mgd29uJ3QgdW5kZXJzdGFuZCBpdC4gRm9yIG5vdywgSW50ZXJuYWwgU2VydmVyIEVycm9yLlxuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLCAnQW4gYXBwTmFtZSwgcHVibGljU2VydmVyVVJMLCBhbmQgZW1haWxBZGFwdGVyIGFyZSByZXF1aXJlZCBmb3IgcGFzc3dvcmQgcmVzZXQgYW5kIGVtYWlsIHZlcmlmaWNhdGlvbiBmdW5jdGlvbmFsaXR5LicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhyb3cgZTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBoYW5kbGVSZXNldFJlcXVlc3QocmVxKSB7XG4gICAgdGhpcy5fdGhyb3dPbkJhZEVtYWlsQ29uZmlnKHJlcSk7XG5cbiAgICBjb25zdCB7IGVtYWlsIH0gPSByZXEuYm9keTtcbiAgICBpZiAoIWVtYWlsKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfTUlTU0lORywgXCJ5b3UgbXVzdCBwcm92aWRlIGFuIGVtYWlsXCIpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGVtYWlsICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfRU1BSUxfQUREUkVTUywgJ3lvdSBtdXN0IHByb3ZpZGUgYSB2YWxpZCBlbWFpbCBzdHJpbmcnKTtcbiAgICB9XG4gICAgY29uc3QgdXNlckNvbnRyb2xsZXIgPSByZXEuY29uZmlnLnVzZXJDb250cm9sbGVyO1xuICAgIHJldHVybiB1c2VyQ29udHJvbGxlci5zZW5kUGFzc3dvcmRSZXNldEVtYWlsKGVtYWlsKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICByZXNwb25zZToge31cbiAgICAgIH0pO1xuICAgIH0sIGVyciA9PiB7XG4gICAgICBpZiAoZXJyLmNvZGUgPT09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkVNQUlMX05PVF9GT1VORCwgYE5vIHVzZXIgZm91bmQgd2l0aCBlbWFpbCAke2VtYWlsfS5gKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IGVycjtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIGhhbmRsZVZlcmlmaWNhdGlvbkVtYWlsUmVxdWVzdChyZXEpIHtcbiAgICB0aGlzLl90aHJvd09uQmFkRW1haWxDb25maWcocmVxKTtcblxuICAgIGNvbnN0IHsgZW1haWwgfSA9IHJlcS5ib2R5O1xuICAgIGlmICghZW1haWwpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9NSVNTSU5HLCAneW91IG11c3QgcHJvdmlkZSBhbiBlbWFpbCcpO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIGVtYWlsICE9PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfRU1BSUxfQUREUkVTUywgJ3lvdSBtdXN0IHByb3ZpZGUgYSB2YWxpZCBlbWFpbCBzdHJpbmcnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gcmVxLmNvbmZpZy5kYXRhYmFzZS5maW5kKCdfVXNlcicsIHsgZW1haWw6IGVtYWlsIH0pLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgIGlmICghcmVzdWx0cy5sZW5ndGggfHwgcmVzdWx0cy5sZW5ndGggPCAxKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5FTUFJTF9OT1RfRk9VTkQsIGBObyB1c2VyIGZvdW5kIHdpdGggZW1haWwgJHtlbWFpbH1gKTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHVzZXIgPSByZXN1bHRzWzBdO1xuXG4gICAgICAvLyByZW1vdmUgcGFzc3dvcmQgZmllbGQsIG1lc3NlcyB3aXRoIHNhdmluZyBvbiBwb3N0Z3Jlc1xuICAgICAgZGVsZXRlIHVzZXIucGFzc3dvcmQ7XG5cbiAgICAgIGlmICh1c2VyLmVtYWlsVmVyaWZpZWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9USEVSX0NBVVNFLCBgRW1haWwgJHtlbWFpbH0gaXMgYWxyZWFkeSB2ZXJpZmllZC5gKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgdXNlckNvbnRyb2xsZXIgPSByZXEuY29uZmlnLnVzZXJDb250cm9sbGVyO1xuICAgICAgcmV0dXJuIHVzZXJDb250cm9sbGVyLnJlZ2VuZXJhdGVFbWFpbFZlcmlmeVRva2VuKHVzZXIpLnRoZW4oKCkgPT4ge1xuICAgICAgICB1c2VyQ29udHJvbGxlci5zZW5kVmVyaWZpY2F0aW9uRW1haWwodXNlcik7XG4gICAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7fSB9O1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvdXNlcnMnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVGaW5kKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCAnL3VzZXJzJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlQ3JlYXRlKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvdXNlcnMvbWUnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVNZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL3VzZXJzLzpvYmplY3RJZCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUdldChyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQVVQnLCAnL3VzZXJzLzpvYmplY3RJZCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZVVwZGF0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdERUxFVEUnLCAnL3VzZXJzLzpvYmplY3RJZCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZURlbGV0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL2xvZ2luJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlTG9nSW4ocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvbG9naW4nLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVMb2dJbihyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQT1NUJywgJy9sb2dvdXQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVMb2dPdXQocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvcmVxdWVzdFBhc3N3b3JkUmVzZXQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVSZXNldFJlcXVlc3QocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvdmVyaWZpY2F0aW9uRW1haWxSZXF1ZXN0JywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlVmVyaWZpY2F0aW9uRW1haWxSZXF1ZXN0KHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvdmVyaWZ5UGFzc3dvcmQnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVWZXJpZnlQYXNzd29yZChyZXEpOyB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBVc2Vyc1JvdXRlcjtcbiJdfQ==