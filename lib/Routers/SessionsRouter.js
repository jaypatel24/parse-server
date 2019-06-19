'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SessionsRouter = undefined;

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _Auth = require('../Auth');

var _Auth2 = _interopRequireDefault(_Auth);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class SessionsRouter extends _ClassesRouter2.default {

  className() {
    return '_Session';
  }

  handleMe(req) {
    // TODO: Verify correct behavior
    if (!req.info || !req.info.sessionToken) {
      throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Session token required.');
    }
    return _rest2.default.find(req.config, _Auth2.default.master(req.config), '_Session', { sessionToken: req.info.sessionToken }, undefined, req.info.clientSDK).then(response => {
      if (!response.results || response.results.length == 0) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_SESSION_TOKEN, 'Session token not found.');
      }
      return {
        response: response.results[0]
      };
    });
  }

  handleUpdateToRevocableSession(req) {
    const config = req.config;
    const user = req.auth.user;
    // Issue #2720
    // Calling without a session token would result in a not found user
    if (!user) {
      throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'invalid session');
    }
    const {
      sessionData,
      createSession
    } = _Auth2.default.createSession(config, {
      userId: user.id,
      createdWith: {
        'action': 'upgrade'
      },
      installationId: req.auth.installationId
    });

    return createSession().then(() => {
      // delete the session token, use the db to skip beforeSave
      return config.database.update('_User', {
        objectId: user.id
      }, {
        sessionToken: { __op: 'Delete' }
      });
    }).then(() => {
      return Promise.resolve({ response: sessionData });
    });
  }

  mountRoutes() {
    this.route('GET', '/sessions/me', req => {
      return this.handleMe(req);
    });
    this.route('GET', '/sessions', req => {
      return this.handleFind(req);
    });
    this.route('GET', '/sessions/:objectId', req => {
      return this.handleGet(req);
    });
    this.route('POST', '/sessions', req => {
      return this.handleCreate(req);
    });
    this.route('PUT', '/sessions/:objectId', req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/sessions/:objectId', req => {
      return this.handleDelete(req);
    });
    this.route('POST', '/upgradeToRevocableSession', req => {
      return this.handleUpdateToRevocableSession(req);
    });
  }
}

exports.SessionsRouter = SessionsRouter;
exports.default = SessionsRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1Nlc3Npb25zUm91dGVyLmpzIl0sIm5hbWVzIjpbIlNlc3Npb25zUm91dGVyIiwiY2xhc3NOYW1lIiwiaGFuZGxlTWUiLCJyZXEiLCJpbmZvIiwic2Vzc2lvblRva2VuIiwiRXJyb3IiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJmaW5kIiwiY29uZmlnIiwibWFzdGVyIiwidW5kZWZpbmVkIiwiY2xpZW50U0RLIiwidGhlbiIsInJlc3BvbnNlIiwicmVzdWx0cyIsImxlbmd0aCIsImhhbmRsZVVwZGF0ZVRvUmV2b2NhYmxlU2Vzc2lvbiIsInVzZXIiLCJhdXRoIiwiT0JKRUNUX05PVF9GT1VORCIsInNlc3Npb25EYXRhIiwiY3JlYXRlU2Vzc2lvbiIsInVzZXJJZCIsImlkIiwiY3JlYXRlZFdpdGgiLCJpbnN0YWxsYXRpb25JZCIsImRhdGFiYXNlIiwidXBkYXRlIiwib2JqZWN0SWQiLCJfX29wIiwiUHJvbWlzZSIsInJlc29sdmUiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwiaGFuZGxlRmluZCIsImhhbmRsZUdldCIsImhhbmRsZUNyZWF0ZSIsImhhbmRsZVVwZGF0ZSIsImhhbmRsZURlbGV0ZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFTyxNQUFNQSxjQUFOLGlDQUEyQzs7QUFFaERDLGNBQVk7QUFDVixXQUFPLFVBQVA7QUFDRDs7QUFFREMsV0FBU0MsR0FBVCxFQUFjO0FBQ1o7QUFDQSxRQUFJLENBQUNBLElBQUlDLElBQUwsSUFBYSxDQUFDRCxJQUFJQyxJQUFKLENBQVNDLFlBQTNCLEVBQXlDO0FBQ3ZDLFlBQU0sSUFBSSxlQUFNQyxLQUFWLENBQWdCLGVBQU1BLEtBQU4sQ0FBWUMscUJBQTVCLEVBQ0oseUJBREksQ0FBTjtBQUVEO0FBQ0QsV0FBTyxlQUFLQyxJQUFMLENBQVVMLElBQUlNLE1BQWQsRUFBc0IsZUFBS0MsTUFBTCxDQUFZUCxJQUFJTSxN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QUEvRCtDOztRQUFyQ0gsYyxHQUFBQSxjO2tCQWtFRUEsYyIsImZpbGUiOiJTZXNzaW9uc1JvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIlxuaW1wb3J0IENsYXNzZXNSb3V0ZXIgZnJvbSAnLi9DbGFzc2VzUm91dGVyJztcbmltcG9ydCBQYXJzZSAgICAgICAgIGZyb20gJ3BhcnNlL25vZGUnO1xuaW1wb3J0IHJlc3QgICAgICAgICAgZnJvbSAnLi4vcmVzdCc7XG5pbXBvcnQgQXV0aCAgICAgICAgICBmcm9tICcuLi9BdXRoJztcblxuZXhwb3J0IGNsYXNzIFNlc3Npb25zUm91dGVyIGV4dGVuZHMgQ2xhc3Nlc1JvdXRlciB7XG5cbiAgY2xhc3NOYW1lKCkge1xuICAgIHJldHVybiAnX1Nlc3Npb24nO1xuICB9XG5cbiAgaGFuZGxlTWUocmVxKSB7XG4gICAgLy8gVE9ETzogVmVyaWZ5IGNvcnJlY3QgYmVoYXZpb3JcbiAgICBpZiAoIXJlcS5pbmZvIHx8ICFyZXEuaW5mby5zZXNzaW9uVG9rZW4pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1NFU1NJT05fVE9LRU4sXG4gICAgICAgICdTZXNzaW9uIHRva2VuIHJlcXVpcmVkLicpO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdC5maW5kKHJlcS5jb25maWcsIEF1dGgubWFzdGVyKHJlcS5jb25maWcpLCAnX1Nlc3Npb24nLCB7IHNlc3Npb25Ub2tlbjogcmVxLmluZm8uc2Vzc2lvblRva2VuIH0sIHVuZGVmaW5lZCwgcmVxLmluZm8uY2xpZW50U0RLKVxuICAgICAgLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgIGlmICghcmVzcG9uc2UucmVzdWx0cyB8fCByZXNwb25zZS5yZXN1bHRzLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICAgICAgICdTZXNzaW9uIHRva2VuIG5vdCBmb3VuZC4nKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIHJlc3BvbnNlOiByZXNwb25zZS5yZXN1bHRzWzBdXG4gICAgICAgIH07XG4gICAgICB9KTtcbiAgfVxuXG4gIGhhbmRsZVVwZGF0ZVRvUmV2b2NhYmxlU2Vzc2lvbihyZXEpIHtcbiAgICBjb25zdCBjb25maWcgPSByZXEuY29uZmlnO1xuICAgIGNvbnN0IHVzZXIgPSByZXEuYXV0aC51c2VyO1xuICAgIC8vIElzc3VlICMyNzIwXG4gICAgLy8gQ2FsbGluZyB3aXRob3V0IGEgc2Vzc2lvbiB0b2tlbiB3b3VsZCByZXN1bHQgaW4gYSBub3QgZm91bmQgdXNlclxuICAgIGlmICghdXNlcikge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdpbnZhbGlkIHNlc3Npb24nKTtcbiAgICB9XG4gICAgY29uc3Qge1xuICAgICAgc2Vzc2lvbkRhdGEsXG4gICAgICBjcmVhdGVTZXNzaW9uXG4gICAgfSA9IEF1dGguY3JlYXRlU2Vzc2lvbihjb25maWcsIHtcbiAgICAgIHVzZXJJZDogdXNlci5pZCxcbiAgICAgIGNyZWF0ZWRXaXRoOiB7XG4gICAgICAgICdhY3Rpb24nOiAndXBncmFkZScsXG4gICAgICB9LFxuICAgICAgaW5zdGFsbGF0aW9uSWQ6IHJlcS5hdXRoLmluc3RhbGxhdGlvbklkLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIGNyZWF0ZVNlc3Npb24oKS50aGVuKCgpID0+IHtcbiAgICAgIC8vIGRlbGV0ZSB0aGUgc2Vzc2lvbiB0b2tlbiwgdXNlIHRoZSBkYiB0byBza2lwIGJlZm9yZVNhdmVcbiAgICAgIHJldHVybiBjb25maWcuZGF0YWJhc2UudXBkYXRlKCdfVXNlcicsIHtcbiAgICAgICAgb2JqZWN0SWQ6IHVzZXIuaWRcbiAgICAgIH0sIHtcbiAgICAgICAgc2Vzc2lvblRva2VuOiB7X19vcDogJ0RlbGV0ZSd9XG4gICAgICB9KTtcbiAgICB9KS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoeyByZXNwb25zZTogc2Vzc2lvbkRhdGEgfSk7XG4gICAgfSk7XG4gIH1cblxuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvc2Vzc2lvbnMvbWUnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVNZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL3Nlc3Npb25zJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlRmluZChyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCAnL3Nlc3Npb25zLzpvYmplY3RJZCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUdldChyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQT1NUJywgJy9zZXNzaW9ucycsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUNyZWF0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQVVQnLCAnL3Nlc3Npb25zLzpvYmplY3RJZCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZVVwZGF0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdERUxFVEUnLCAnL3Nlc3Npb25zLzpvYmplY3RJZCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZURlbGV0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQT1NUJywgJy91cGdyYWRlVG9SZXZvY2FibGVTZXNzaW9uJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlVXBkYXRlVG9SZXZvY2FibGVTZXNzaW9uKHJlcSk7IH0pXG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgU2Vzc2lvbnNSb3V0ZXI7XG4iXX0=