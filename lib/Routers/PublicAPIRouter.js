'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PublicAPIRouter = undefined;

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _Config = require('../Config');

var _Config2 = _interopRequireDefault(_Config);

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _fs = require('fs');

var _fs2 = _interopRequireDefault(_fs);

var _querystring = require('querystring');

var _querystring2 = _interopRequireDefault(_querystring);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const public_html = _path2.default.resolve(__dirname, "../../public_html");
const views = _path2.default.resolve(__dirname, '../../views');

class PublicAPIRouter extends _PromiseRouter2.default {

  verifyEmail(req) {
    const { token, username } = req.query;
    const appId = req.params.appId;
    const config = _Config2.default.get(appId);

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    if (!token || !username) {
      return this.invalidLink(req);
    }

    const userController = config.userController;
    return userController.verifyEmail(username, token).then(() => {
      const params = _querystring2.default.stringify({ username });
      return Promise.resolve({
        status: 302,
        location: `${config.verifyEmailSuccessURL}?${params}`
      });
    }, () => {
      return this.invalidVerificationLink(req);
    });
  }

  resendVerificationEmail(req) {
    const username = req.body.username;
    const appId = req.params.appId;
    const config = _Config2.default.get(appId);

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    if (!username) {
      return this.invalidLink(req);
    }

    const userController = config.userController;

    return userController.resendVerificationEmail(username).then(() => {
      return Promise.resolve({
        status: 302,
        location: `${config.linkSendSuccessURL}`
      });
    }, () => {
      return Promise.resolve({
        status: 302,
        location: `${config.linkSendFailURL}`
      });
    });
  }

  changePassword(req) {
    return new Promise((resolve, reject) => {
      const config = _Config2.default.get(req.query.id);

      if (!config) {
        this.invalidRequest();
      }

      if (!config.publicServerURL) {
        return resolve({
          status: 404,
          text: 'Not found.'
        });
      }
      // Should we keep the file in memory or leave like that?
      _fs2.default.readFile(_path2.default.resolve(views, "choose_password"), 'utf-8', (err, data) => {
        if (err) {
          return reject(err);
        }
        data = data.replace("PARSE_SERVER_URL", `'${config.publicServerURL}'`);
        resolve({
          text: data
        });
      });
    });
  }

  requestResetPassword(req) {

    const config = req.config;

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    const { username, token } = req.query;

    if (!username || !token) {
      return this.invalidLink(req);
    }

    return config.userController.checkResetTokenValidity(username, token).then(() => {
      const params = _querystring2.default.stringify({ token, id: config.applicationId, username, app: config.appName });
      return Promise.resolve({
        status: 302,
        location: `${config.choosePasswordURL}?${params}`
      });
    }, () => {
      return this.invalidLink(req);
    });
  }

  resetPassword(req) {

    const config = req.config;

    if (!config) {
      this.invalidRequest();
    }

    if (!config.publicServerURL) {
      return this.missingPublicServerURL();
    }

    const {
      username,
      token,
      new_password
    } = req.body;

    if (!username || !token || !new_password) {
      return this.invalidLink(req);
    }

    return config.userController.updatePassword(username, token, new_password).then(() => {
      const params = _querystring2.default.stringify({ username: username });
      return Promise.resolve({
        status: 302,
        location: `${config.passwordResetSuccessURL}?${params}`
      });
    }, err => {
      const params = _querystring2.default.stringify({ username: username, token: token, id: config.applicationId, error: err, app: config.appName });
      return Promise.resolve({
        status: 302,
        location: `${config.choosePasswordURL}?${params}`
      });
    });
  }

  invalidLink(req) {
    return Promise.resolve({
      status: 302,
      location: req.config.invalidLinkURL
    });
  }

  invalidVerificationLink(req) {
    const config = req.config;
    if (req.query.username && req.params.appId) {
      const params = _querystring2.default.stringify({ username: req.query.username, appId: req.params.appId });
      return Promise.resolve({
        status: 302,
        location: `${config.invalidVerificationLinkURL}?${params}`
      });
    } else {
      return this.invalidLink(req);
    }
  }

  missingPublicServerURL() {
    return Promise.resolve({
      text: 'Not found.',
      status: 404
    });
  }

  invalidRequest() {
    const error = new Error();
    error.status = 403;
    error.message = "unauthorized";
    throw error;
  }

  setConfig(req) {
    req.config = _Config2.default.get(req.params.appId);
    return Promise.resolve();
  }

  mountRoutes() {
    this.route('GET', '/apps/:appId/verify_email', req => {
      this.setConfig(req);
    }, req => {
      return this.verifyEmail(req);
    });

    this.route('POST', '/apps/:appId/resend_verification_email', req => {
      this.setConfig(req);
    }, req => {
      return this.resendVerificationEmail(req);
    });

    this.route('GET', '/apps/choose_password', req => {
      return this.changePassword(req);
    });

    this.route('POST', '/apps/:appId/request_password_reset', req => {
      this.setConfig(req);
    }, req => {
      return this.resetPassword(req);
    });

    this.route('GET', '/apps/:appId/request_password_reset', req => {
      this.setConfig(req);
    }, req => {
      return this.requestResetPassword(req);
    });
  }

  expressRouter() {
    const router = _express2.default.Router();
    router.use("/apps", _express2.default.static(public_html));
    router.use("/", super.expressRouter());
    return router;
  }
}

exports.PublicAPIRouter = PublicAPIRouter;
exports.default = PublicAPIRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1YmxpY0FQSVJvdXRlci5qcyJdLCJuYW1lcyI6WyJwdWJsaWNfaHRtbCIsInJlc29sdmUiLCJfX2Rpcm5hbWUiLCJ2aWV3cyIsIlB1YmxpY0FQSVJvdXRlciIsInZlcmlmeUVtYWlsIiwicmVxIiwidG9rZW4iLCJ1c2VybmFtZSIsInF1ZXJ5IiwiYXBwSWQiLCJwYXJhbXMiLCJjb25maWciLCJnZXQiLCJpbnZhbGlkUmVxdWVzdCIsInB1YmxpY1NlcnZlclVSTCIsIm1pc3NpbmdQdWJsaWNTZXJ2ZXJVUkwiLCJpbnZhbGlkTGluayIsInVzZXJDb250cm9sbGVyIiwidGhlbiIsInN0cmluZ2lmeSIsIlByb21pc2UiLCJzdGF0dXMiLCJsb2NhdGlvbiIsInZlcmlmeUVtYWlsU3VjY2Vzc1VSTCIsImludmFsaWRWZXJpZmljYXRpb25MaW5rIiwicmVzZW5kVmVyaWZpY2F0aW9uRW1haWwiLCJib2R5IiwibGlua1NlbmRTdWNjZXNzVVJMIiwibGlua1NlbmRGYWlsVVJMIiwiY2hhbmdlUGFzc3dvcmQiLCJyZWplY3QiLCJpZCIsInRleHQiLCJyZWFkRmlsZSIsImVyciIsImRhdGEiLCJyZXBsYWNlIiwicmVxdWVzdFJlc2V0UGFzc3dvcmQiLCJjaGVja1Jlc2V0VG9rZW5WYWxpZGl0eSIsImFwcGxpY2F0aW9uSWQiLCJhcHAiLCJhcHBOYW1lIiwiY2hvb3NlUGFzc3dvcmRVUkwiLCJyZXNldFBhc3N3b3JkIiwibmV3X3Bhc3N3b3JkIiwidXBkYXRlUGFzc3dvcmQiLCJwYXNzd29yZFJlc2V0U3VjY2Vzc1VSTCIsImVycm9yIiwiaW52YWxpZExpbmtVUkwiLCJpbnZhbGlkVmVyaWZpY2F0aW9uTGlua1VSTCIsIkVycm9yIiwibWVzc2FnZSIsInNldENvbmZpZyIsIm1vdW50Um91dGVzIiwicm91dGUiLCJleHByZXNzUm91dGVyIiwicm91dGVyIiwiUm91dGVyIiwidXNlIiwic3RhdGljIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FB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RUEsT0FBTztBQUFFLGFBQU8sS0FBS2dDLG9CQUFMLENBQTBCaEMsR0FBMUIsQ0FBUDtBQUF3QyxLQUZuRDtBQUdEOztBQUVEa0Qsa0JBQWdCO0FBQ2QsVUFBTUMsU0FBUyxrQkFBUUMsTUFBUixFQUFmO0FBQ0FELFdBQU9FLEdBQVAsQ0FBVyxPQUFYLEVBQW9CLGtCQUFRQyxNQUFSLENBQWU1RCxXQUFmLENBQXBCO0FBQ0F5RCxXQUFPRSxHQUFQLENBQVcsR0FBWCxFQUFnQixNQUFNSCxhQUFOLEVBQWhCO0FBQ0EsV0FBT0MsTUFBUDtBQUNEO0FBOU5nRDs7UUFBdENyRCxlLEdBQUFBLGU7a0JBaU9FQSxlIiwiZmlsZSI6IlB1YmxpY0FQSVJvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBQcm9taXNlUm91dGVyIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0IENvbmZpZyBmcm9tICcuLi9Db25maWcnO1xuaW1wb3J0IGV4cHJlc3MgZnJvbSAnZXhwcmVzcyc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCBmcyBmcm9tICdmcyc7XG5pbXBvcnQgcXMgZnJvbSAncXVlcnlzdHJpbmcnO1xuXG5jb25zdCBwdWJsaWNfaHRtbCA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi4vLi4vcHVibGljX2h0bWxcIik7XG5jb25zdCB2aWV3cyA9IHBhdGgucmVzb2x2ZShfX2Rpcm5hbWUsICcuLi8uLi92aWV3cycpO1xuXG5leHBvcnQgY2xhc3MgUHVibGljQVBJUm91dGVyIGV4dGVuZHMgUHJvbWlzZVJvdXRlciB7XG5cbiAgdmVyaWZ5RW1haWwocmVxKSB7XG4gICAgY29uc3QgeyB0b2tlbiwgdXNlcm5hbWUgfSA9IHJlcS5xdWVyeTtcbiAgICBjb25zdCBhcHBJZCA9IHJlcS5wYXJhbXMuYXBwSWQ7XG4gICAgY29uc3QgY29uZmlnID0gQ29uZmlnLmdldChhcHBJZCk7XG5cbiAgICBpZighY29uZmlnKXtcbiAgICAgIHRoaXMuaW52YWxpZFJlcXVlc3QoKTtcbiAgICB9XG5cbiAgICBpZiAoIWNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwpIHtcbiAgICAgIHJldHVybiB0aGlzLm1pc3NpbmdQdWJsaWNTZXJ2ZXJVUkwoKTtcbiAgICB9XG5cbiAgICBpZiAoIXRva2VuIHx8ICF1c2VybmFtZSkge1xuICAgICAgcmV0dXJuIHRoaXMuaW52YWxpZExpbmsocmVxKTtcbiAgICB9XG5cbiAgICBjb25zdCB1c2VyQ29udHJvbGxlciA9IGNvbmZpZy51c2VyQ29udHJvbGxlcjtcbiAgICByZXR1cm4gdXNlckNvbnRyb2xsZXIudmVyaWZ5RW1haWwodXNlcm5hbWUsIHRva2VuKS50aGVuKCgpID0+IHtcbiAgICAgIGNvbnN0IHBhcmFtcyA9IHFzLnN0cmluZ2lmeSh7dXNlcm5hbWV9KTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICBzdGF0dXM6IDMwMixcbiAgICAgICAgbG9jYXRpb246IGAke2NvbmZpZy52ZXJpZnlFbWFpbFN1Y2Nlc3NVUkx9PyR7cGFyYW1zfWBcbiAgICAgIH0pO1xuICAgIH0sICgpPT4ge1xuICAgICAgcmV0dXJuIHRoaXMuaW52YWxpZFZlcmlmaWNhdGlvbkxpbmsocmVxKTtcbiAgICB9KVxuICB9XG5cbiAgcmVzZW5kVmVyaWZpY2F0aW9uRW1haWwocmVxKSB7XG4gICAgY29uc3QgdXNlcm5hbWUgPSByZXEuYm9keS51c2VybmFtZTtcbiAgICBjb25zdCBhcHBJZCA9IHJlcS5wYXJhbXMuYXBwSWQ7XG4gICAgY29uc3QgY29uZmlnID0gQ29uZmlnLmdldChhcHBJZCk7XG5cbiAgICBpZighY29uZmlnKXtcbiAgICAgIHRoaXMuaW52YWxpZFJlcXVlc3QoKTtcbiAgICB9XG5cbiAgICBpZiAoIWNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwpIHtcbiAgICAgIHJldHVybiB0aGlzLm1pc3NpbmdQdWJsaWNTZXJ2ZXJVUkwoKTtcbiAgICB9XG5cbiAgICBpZiAoIXVzZXJuYW1lKSB7XG4gICAgICByZXR1cm4gdGhpcy5pbnZhbGlkTGluayhyZXEpO1xuICAgIH1cblxuICAgIGNvbnN0IHVzZXJDb250cm9sbGVyID0gY29uZmlnLnVzZXJDb250cm9sbGVyO1xuXG4gICAgcmV0dXJuIHVzZXJDb250cm9sbGVyLnJlc2VuZFZlcmlmaWNhdGlvbkVtYWlsKHVzZXJuYW1lKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICBzdGF0dXM6IDMwMixcbiAgICAgICAgbG9jYXRpb246IGAke2NvbmZpZy5saW5rU2VuZFN1Y2Nlc3NVUkx9YFxuICAgICAgfSk7XG4gICAgfSwgKCk9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtcbiAgICAgICAgc3RhdHVzOiAzMDIsXG4gICAgICAgIGxvY2F0aW9uOiBgJHtjb25maWcubGlua1NlbmRGYWlsVVJMfWBcbiAgICAgIH0pO1xuICAgIH0pXG4gIH1cblxuICBjaGFuZ2VQYXNzd29yZChyZXEpIHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgY29uZmlnID0gQ29uZmlnLmdldChyZXEucXVlcnkuaWQpO1xuXG4gICAgICBpZighY29uZmlnKXtcbiAgICAgICAgdGhpcy5pbnZhbGlkUmVxdWVzdCgpO1xuICAgICAgfVxuXG4gICAgICBpZiAoIWNvbmZpZy5wdWJsaWNTZXJ2ZXJVUkwpIHtcbiAgICAgICAgcmV0dXJuIHJlc29sdmUoe1xuICAgICAgICAgIHN0YXR1czogNDA0LFxuICAgICAgICAgIHRleHQ6ICdOb3QgZm91bmQuJ1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIC8vIFNob3VsZCB3ZSBrZWVwIHRoZSBmaWxlIGluIG1lbW9yeSBvciBsZWF2ZSBsaWtlIHRoYXQ/XG4gICAgICBmcy5yZWFkRmlsZShwYXRoLnJlc29sdmUodmlld3MsIFwiY2hvb3NlX3Bhc3N3b3JkXCIpLCAndXRmLTgnLCAoZXJyLCBkYXRhKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGVycik7XG4gICAgICAgIH1cbiAgICAgICAgZGF0YSA9IGRhdGEucmVwbGFjZShcIlBBUlNFX1NFUlZFUl9VUkxcIiwgYCcke2NvbmZpZy5wdWJsaWNTZXJ2ZXJVUkx9J2ApO1xuICAgICAgICByZXNvbHZlKHtcbiAgICAgICAgICB0ZXh0OiBkYXRhXG4gICAgICAgIH0pXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHJlcXVlc3RSZXNldFBhc3N3b3JkKHJlcSkge1xuXG4gICAgY29uc3QgY29uZmlnID0gcmVxLmNvbmZpZztcblxuICAgIGlmKCFjb25maWcpe1xuICAgICAgdGhpcy5pbnZhbGlkUmVxdWVzdCgpO1xuICAgIH1cblxuICAgIGlmICghY29uZmlnLnB1YmxpY1NlcnZlclVSTCkge1xuICAgICAgcmV0dXJuIHRoaXMubWlzc2luZ1B1YmxpY1NlcnZlclVSTCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHsgdXNlcm5hbWUsIHRva2VuIH0gPSByZXEucXVlcnk7XG5cbiAgICBpZiAoIXVzZXJuYW1lIHx8ICF0b2tlbikge1xuICAgICAgcmV0dXJuIHRoaXMuaW52YWxpZExpbmsocmVxKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY29uZmlnLnVzZXJDb250cm9sbGVyLmNoZWNrUmVzZXRUb2tlblZhbGlkaXR5KHVzZXJuYW1lLCB0b2tlbikudGhlbigoKSA9PiB7XG4gICAgICBjb25zdCBwYXJhbXMgPSBxcy5zdHJpbmdpZnkoe3Rva2VuLCBpZDogY29uZmlnLmFwcGxpY2F0aW9uSWQsIHVzZXJuYW1lLCBhcHA6IGNvbmZpZy5hcHBOYW1lLCB9KTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICBzdGF0dXM6IDMwMixcbiAgICAgICAgbG9jYXRpb246IGAke2NvbmZpZy5jaG9vc2VQYXNzd29yZFVSTH0/JHtwYXJhbXN9YFxuICAgICAgfSlcbiAgICB9LCAoKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5pbnZhbGlkTGluayhyZXEpO1xuICAgIH0pXG4gIH1cblxuICByZXNldFBhc3N3b3JkKHJlcSkge1xuXG4gICAgY29uc3QgY29uZmlnID0gcmVxLmNvbmZpZztcblxuICAgIGlmKCFjb25maWcpe1xuICAgICAgdGhpcy5pbnZhbGlkUmVxdWVzdCgpO1xuICAgIH1cblxuICAgIGlmICghY29uZmlnLnB1YmxpY1NlcnZlclVSTCkge1xuICAgICAgcmV0dXJuIHRoaXMubWlzc2luZ1B1YmxpY1NlcnZlclVSTCgpO1xuICAgIH1cblxuICAgIGNvbnN0IHtcbiAgICAgIHVzZXJuYW1lLFxuICAgICAgdG9rZW4sXG4gICAgICBuZXdfcGFzc3dvcmRcbiAgICB9ID0gcmVxLmJvZHk7XG5cbiAgICBpZiAoIXVzZXJuYW1lIHx8ICF0b2tlbiB8fCAhbmV3X3Bhc3N3b3JkKSB7XG4gICAgICByZXR1cm4gdGhpcy5pbnZhbGlkTGluayhyZXEpO1xuICAgIH1cblxuICAgIHJldHVybiBjb25maWcudXNlckNvbnRyb2xsZXIudXBkYXRlUGFzc3dvcmQodXNlcm5hbWUsIHRva2VuLCBuZXdfcGFzc3dvcmQpLnRoZW4oKCkgPT4ge1xuICAgICAgY29uc3QgcGFyYW1zID0gcXMuc3RyaW5naWZ5KHt1c2VybmFtZTogdXNlcm5hbWV9KTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgICBzdGF0dXM6IDMwMixcbiAgICAgICAgbG9jYXRpb246IGAke2NvbmZpZy5wYXNzd29yZFJlc2V0U3VjY2Vzc1VSTH0/JHtwYXJhbXN9YFxuICAgICAgfSk7XG4gICAgfSwgKGVycikgPT4ge1xuICAgICAgY29uc3QgcGFyYW1zID0gcXMuc3RyaW5naWZ5KHt1c2VybmFtZTogdXNlcm5hbWUsIHRva2VuOiB0b2tlbiwgaWQ6IGNvbmZpZy5hcHBsaWNhdGlvbklkLCBlcnJvcjplcnIsIGFwcDpjb25maWcuYXBwTmFtZX0pO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgIHN0YXR1czogMzAyLFxuICAgICAgICBsb2NhdGlvbjogYCR7Y29uZmlnLmNob29zZVBhc3N3b3JkVVJMfT8ke3BhcmFtc31gXG4gICAgICB9KTtcbiAgICB9KTtcblxuICB9XG5cbiAgaW52YWxpZExpbmsocmVxKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICBzdGF0dXM6IDMwMixcbiAgICAgIGxvY2F0aW9uOiByZXEuY29uZmlnLmludmFsaWRMaW5rVVJMXG4gICAgfSk7XG4gIH1cblxuICBpbnZhbGlkVmVyaWZpY2F0aW9uTGluayhyZXEpIHtcbiAgICBjb25zdCBjb25maWcgPSByZXEuY29uZmlnO1xuICAgIGlmIChyZXEucXVlcnkudXNlcm5hbWUgJiYgcmVxLnBhcmFtcy5hcHBJZCkge1xuICAgICAgY29uc3QgcGFyYW1zID0gcXMuc3RyaW5naWZ5KHt1c2VybmFtZTogcmVxLnF1ZXJ5LnVzZXJuYW1lLCBhcHBJZDogcmVxLnBhcmFtcy5hcHBJZH0pO1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgIHN0YXR1czogMzAyLFxuICAgICAgICBsb2NhdGlvbjogYCR7Y29uZmlnLmludmFsaWRWZXJpZmljYXRpb25MaW5rVVJMfT8ke3BhcmFtc31gXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHRoaXMuaW52YWxpZExpbmsocmVxKTtcbiAgICB9XG4gIH1cblxuICBtaXNzaW5nUHVibGljU2VydmVyVVJMKCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe1xuICAgICAgdGV4dDogICdOb3QgZm91bmQuJyxcbiAgICAgIHN0YXR1czogNDA0XG4gICAgfSk7XG4gIH1cblxuICBpbnZhbGlkUmVxdWVzdCgpIHtcbiAgICBjb25zdCBlcnJvciA9IG5ldyBFcnJvcigpO1xuICAgIGVycm9yLnN0YXR1cyA9IDQwMztcbiAgICBlcnJvci5tZXNzYWdlID0gXCJ1bmF1dGhvcml6ZWRcIjtcbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIHNldENvbmZpZyhyZXEpIHtcbiAgICByZXEuY29uZmlnID0gQ29uZmlnLmdldChyZXEucGFyYW1zLmFwcElkKTtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cblxuICBtb3VudFJvdXRlcygpIHtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvYXBwcy86YXBwSWQvdmVyaWZ5X2VtYWlsJyxcbiAgICAgIHJlcSA9PiB7IHRoaXMuc2V0Q29uZmlnKHJlcSkgfSxcbiAgICAgIHJlcSA9PiB7IHJldHVybiB0aGlzLnZlcmlmeUVtYWlsKHJlcSk7IH0pO1xuXG4gICAgdGhpcy5yb3V0ZSgnUE9TVCcsICcvYXBwcy86YXBwSWQvcmVzZW5kX3ZlcmlmaWNhdGlvbl9lbWFpbCcsXG4gICAgICByZXEgPT4geyB0aGlzLnNldENvbmZpZyhyZXEpOyB9LFxuICAgICAgcmVxID0+IHsgcmV0dXJuIHRoaXMucmVzZW5kVmVyaWZpY2F0aW9uRW1haWwocmVxKTsgfSk7XG5cbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvYXBwcy9jaG9vc2VfcGFzc3dvcmQnLFxuICAgICAgcmVxID0+IHsgcmV0dXJuIHRoaXMuY2hhbmdlUGFzc3dvcmQocmVxKTsgfSk7XG5cbiAgICB0aGlzLnJvdXRlKCdQT1NUJywnL2FwcHMvOmFwcElkL3JlcXVlc3RfcGFzc3dvcmRfcmVzZXQnLFxuICAgICAgcmVxID0+IHsgdGhpcy5zZXRDb25maWcocmVxKSB9LFxuICAgICAgcmVxID0+IHsgcmV0dXJuIHRoaXMucmVzZXRQYXNzd29yZChyZXEpOyB9KTtcblxuICAgIHRoaXMucm91dGUoJ0dFVCcsJy9hcHBzLzphcHBJZC9yZXF1ZXN0X3Bhc3N3b3JkX3Jlc2V0JyxcbiAgICAgIHJlcSA9PiB7IHRoaXMuc2V0Q29uZmlnKHJlcSkgfSxcbiAgICAgIHJlcSA9PiB7IHJldHVybiB0aGlzLnJlcXVlc3RSZXNldFBhc3N3b3JkKHJlcSk7IH0pO1xuICB9XG5cbiAgZXhwcmVzc1JvdXRlcigpIHtcbiAgICBjb25zdCByb3V0ZXIgPSBleHByZXNzLlJvdXRlcigpO1xuICAgIHJvdXRlci51c2UoXCIvYXBwc1wiLCBleHByZXNzLnN0YXRpYyhwdWJsaWNfaHRtbCkpO1xuICAgIHJvdXRlci51c2UoXCIvXCIsIHN1cGVyLmV4cHJlc3NSb3V0ZXIoKSk7XG4gICAgcmV0dXJuIHJvdXRlcjtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBQdWJsaWNBUElSb3V0ZXI7XG4iXX0=