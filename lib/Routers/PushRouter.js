"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushRouter = undefined;

var _PromiseRouter = require("../PromiseRouter");

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require("../middlewares");

var middleware = _interopRequireWildcard(_middlewares);

var _node = require("parse/node");

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PushRouter extends _PromiseRouter2.default {

  mountRoutes() {
    this.route("POST", "/push", middleware.promiseEnforceMasterKeyAccess, PushRouter.handlePOST);
  }

  static handlePOST(req) {
    if (req.auth.isReadOnly) {
      throw new _node.Parse.Error(_node.Parse.Error.OPERATION_FORBIDDEN, 'read-only masterKey isn\'t allowed to send push notifications.');
    }
    const pushController = req.config.pushController;
    if (!pushController) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Push controller is not set');
    }

    const where = PushRouter.getQueryCondition(req);
    let resolve;
    const promise = new Promise(_resolve => {
      resolve = _resolve;
    });
    let pushStatusId;
    pushController.sendPush(req.body, where, req.config, req.auth, objectId => {
      pushStatusId = objectId;
      resolve({
        headers: {
          'X-Parse-Push-Status-Id': pushStatusId
        },
        response: {
          result: true
        }
      });
    }).catch(err => {
      req.config.loggerController.error(`_PushStatus ${pushStatusId}: error while sending push`, err);
    });
    return promise;
  }

  /**
   * Get query condition from the request body.
   * @param {Object} req A request object
   * @returns {Object} The query condition, the where field in a query api call
   */
  static getQueryCondition(req) {
    const body = req.body || {};
    const hasWhere = typeof body.where !== 'undefined';
    const hasChannels = typeof body.channels !== 'undefined';

    let where;
    if (hasWhere && hasChannels) {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Channels and query can not be set at the same time.');
    } else if (hasWhere) {
      where = body.where;
    } else if (hasChannels) {
      where = {
        "channels": {
          "$in": body.channels
        }
      };
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.PUSH_MISCONFIGURED, 'Sending a push requires either "channels" or a "where" query.');
    }
    return where;
  }
}

exports.PushRouter = PushRouter;
exports.default = PushRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1c2hSb3V0ZXIuanMiXSwibmFtZXMiOlsibWlkZGxld2FyZSIsIlB1c2hSb3V0ZXIiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiLCJoYW5kbGVQT1NUIiwicmVxIiwiYXV0aCIsImlzUmVhZE9ubHkiLCJFcnJvciIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJwdXNoQ29udHJvbGxlciIsImNvbmZpZyIsIlBVU0hfTUlTQ09ORklHVVJFRCIsIndoZXJlIiwiZ2V0UXVlcnlDb25kaXRpb24iLCJyZXNvbHZlIiwicHJvbWlzZSIsIlByb21pc2UiLCJfcmVzb2x2ZSIsInB1c2hTdGF0dXNJZCIsInNlbmRQdXNoIiwiYm9keSIsIm9iamVjdElkIiwiaGVhZGVycyIsInJlc3BvbnNlIiwicmVzdWx0IiwiY2F0Y2giLCJlcnIiLCJsb2dnZXJDb250cm9sbGVyIiwiZXJyb3IiLCJoYXNXaGVyZSIsImhhc0NoYW5uZWxzIiwiY2hhbm5lbHMiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOztJQUFZQSxVOztBQUNaOzs7Ozs7QUFFTyxNQUFNQyxVQUFOLGlDQUF1Qzs7QUFFNUNDLGdCQUFjO0FBQ1osU0FBS0MsS0FBTCxDQUFXLE1BQVgsRUFBbUIsT0FBbkIsRUFBNEJILFdBQVdJLDZCQUF2QyxFQUFzRUgsV0FBV0ksVUFBakY7QUFDRDs7QUFFRCxTQUFPQSxVQUFQLENBQWtCQyxHQUFsQixFQUF1QjtBQUNyQixRQUFJQSxJQUFJQyxJQUFKLENBQVNDLFVBQWIsRUFBeUI7QUFDdkIsWUFBTSxJQUFJLFlBQU1DLEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZQyxtQkFBNUIsRUFBaUQsZ0VBQWpELENBQU47QUFDRDtBQUNELFVBQU1DLGlCQUFpQkwsSUFBSU0sTUFBSixDQUFXRCxjQUFsQztBQUNBLFFBQUksQ0FBQ0EsY0FBTCxFQUFxQjtBQUNuQixZQUFNLElBQUksWUFBTUYsS0FBVixDQUFnQixZQUFNQSxLQUFOLENBQVlJLGtCQUE1QixFQUFnRCw0QkFBaEQsQ0FBTjtBQUNEOztBQUVELFVBQU1DLFFBQVFiLFdBQVdjLGlCQUFYLENBQTZCVCxHQUE3QixDQUFkO0FBQ0EsUUFBSVUsT0FBSjtBQUNBLFVBQU1DLFVBQVUsSUFBSUMsT0FBSixDQUFhQyxRQUFELElBQWM7QUFDeENILGdCQUFVRyxRQUFWO0FBQ0QsS0FGZSxDQUFoQjtBQUdBLFFBQUlDLFlBQUo7QUFDQVQsbUJBQWVVLFFBQWYsQ0FBd0JmLElBQUlnQixJQUE1QixFQUFrQ1IsS0FBbEMsRUFBeUNSLElBQUlNLE1BQTdDLEVBQXFETixJQUFJQyxJQUF6RCxFQUFnRWdCLFFBQUQsSUFBYztBQUMzRUgscUJBQWVHLFFBQWY7QUFDQVAsY0FBUTtBQUNOUSxpQkFBUztBQUNQLG9DQUEwQko7QUFEbkIsU0FESDtBQUlOSyxrQkFBVTtBQUNSQyxrQkFBUTtBQURBO0FBSkosT0FBUjtBQVFELEtBVkQsRUFVR0MsS0FWSCxDQVVVQyxHQUFELElBQVM7QUFDaEJ0QixVQUFJTSxNQUFKLENBQVdpQixnQkFBWCxDQUE0QkMsS0FBNUIsQ0FBbUMsZUFBY1YsWUFBYSw0QkFBOUQsRUFBMkZRLEdBQTNGO0FBQ0QsS0FaRDtBQWFBLFdBQU9YLE9BQVA7QUFDRDs7QUFFRDs7Ozs7QUFLQSxTQUFPRixpQkFBUCxDQUF5QlQsR0FBekIsRUFBOEI7QUFDNUIsVUFBTWdCLE9BQU9oQixJQUFJZ0IsSUFBSixJQUFZLEVBQXpCO0FBQ0EsVUFBTVMsV0FBVyxPQUFPVCxLQUFLUixLQUFaLEtBQXNCLFdBQXZDO0FBQ0EsVUFBTWtCLGNBQWMsT0FBT1YsS0FBS1csUUFBWixLQUF5QixXQUE3Qzs7QUFFQSxRQUFJbkIsS0FBSjtBQUNBLFFBQUlpQixZQUFZQyxXQUFoQixFQUE2QjtBQUMzQixZQUFNLElBQUksWUFBTXZCLEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZSSxrQkFBNUIsRUFDSixxREFESSxDQUFOO0FBRUQsS0FIRCxNQUdPLElBQUlrQixRQUFKLEVBQWM7QUFDbkJqQixjQUFRUSxLQUFLUixLQUFiO0FBQ0QsS0FGTSxNQUVBLElBQUlrQixXQUFKLEVBQWlCO0FBQ3RCbEIsY0FBUTtBQUNOLG9CQUFZO0FBQ1YsaUJBQU9RLEtBQUtXO0FBREY7QUFETixPQUFSO0FBS0QsS0FOTSxNQU1BO0FBQ0wsWUFBTSxJQUFJLFlBQU14QixLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWUksa0JBQTVCLEVBQWdELCtEQUFoRCxDQUFOO0FBQ0Q7QUFDRCxXQUFPQyxLQUFQO0FBQ0Q7QUEvRDJDOztRQUFqQ2IsVSxHQUFBQSxVO2tCQWtFRUEsVSIsImZpbGUiOiJQdXNoUm91dGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IFByb21pc2VSb3V0ZXIgICBmcm9tICcuLi9Qcm9taXNlUm91dGVyJztcbmltcG9ydCAqIGFzIG1pZGRsZXdhcmUgZnJvbSBcIi4uL21pZGRsZXdhcmVzXCI7XG5pbXBvcnQgeyBQYXJzZSB9ICAgICAgIGZyb20gXCJwYXJzZS9ub2RlXCI7XG5cbmV4cG9ydCBjbGFzcyBQdXNoUm91dGVyIGV4dGVuZHMgUHJvbWlzZVJvdXRlciB7XG5cbiAgbW91bnRSb3V0ZXMoKSB7XG4gICAgdGhpcy5yb3V0ZShcIlBPU1RcIiwgXCIvcHVzaFwiLCBtaWRkbGV3YXJlLnByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLCBQdXNoUm91dGVyLmhhbmRsZVBPU1QpO1xuICB9XG5cbiAgc3RhdGljIGhhbmRsZVBPU1QocmVxKSB7XG4gICAgaWYgKHJlcS5hdXRoLmlzUmVhZE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLCAncmVhZC1vbmx5IG1hc3RlcktleSBpc25cXCd0IGFsbG93ZWQgdG8gc2VuZCBwdXNoIG5vdGlmaWNhdGlvbnMuJyk7XG4gICAgfVxuICAgIGNvbnN0IHB1c2hDb250cm9sbGVyID0gcmVxLmNvbmZpZy5wdXNoQ29udHJvbGxlcjtcbiAgICBpZiAoIXB1c2hDb250cm9sbGVyKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUFVTSF9NSVNDT05GSUdVUkVELCAnUHVzaCBjb250cm9sbGVyIGlzIG5vdCBzZXQnKTtcbiAgICB9XG5cbiAgICBjb25zdCB3aGVyZSA9IFB1c2hSb3V0ZXIuZ2V0UXVlcnlDb25kaXRpb24ocmVxKTtcbiAgICBsZXQgcmVzb2x2ZTtcbiAgICBjb25zdCBwcm9taXNlID0gbmV3IFByb21pc2UoKF9yZXNvbHZlKSA9PiB7XG4gICAgICByZXNvbHZlID0gX3Jlc29sdmU7XG4gICAgfSk7XG4gICAgbGV0IHB1c2hTdGF0dXNJZDtcbiAgICBwdXNoQ29udHJvbGxlci5zZW5kUHVzaChyZXEuYm9keSwgd2hlcmUsIHJlcS5jb25maWcsIHJlcS5hdXRoLCAob2JqZWN0SWQpID0+IHtcbiAgICAgIHB1c2hTdGF0dXNJZCA9IG9iamVjdElkO1xuICAgICAgcmVzb2x2ZSh7XG4gICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAnWC1QYXJzZS1QdXNoLVN0YXR1cy1JZCc6IHB1c2hTdGF0dXNJZFxuICAgICAgICB9LFxuICAgICAgICByZXNwb25zZToge1xuICAgICAgICAgIHJlc3VsdDogdHJ1ZVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICByZXEuY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIuZXJyb3IoYF9QdXNoU3RhdHVzICR7cHVzaFN0YXR1c0lkfTogZXJyb3Igd2hpbGUgc2VuZGluZyBwdXNoYCwgZXJyKTtcbiAgICB9KTtcbiAgICByZXR1cm4gcHJvbWlzZTtcbiAgfVxuXG4gIC8qKlxuICAgKiBHZXQgcXVlcnkgY29uZGl0aW9uIGZyb20gdGhlIHJlcXVlc3QgYm9keS5cbiAgICogQHBhcmFtIHtPYmplY3R9IHJlcSBBIHJlcXVlc3Qgb2JqZWN0XG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBxdWVyeSBjb25kaXRpb24sIHRoZSB3aGVyZSBmaWVsZCBpbiBhIHF1ZXJ5IGFwaSBjYWxsXG4gICAqL1xuICBzdGF0aWMgZ2V0UXVlcnlDb25kaXRpb24ocmVxKSB7XG4gICAgY29uc3QgYm9keSA9IHJlcS5ib2R5IHx8IHt9O1xuICAgIGNvbnN0IGhhc1doZXJlID0gdHlwZW9mIGJvZHkud2hlcmUgIT09ICd1bmRlZmluZWQnO1xuICAgIGNvbnN0IGhhc0NoYW5uZWxzID0gdHlwZW9mIGJvZHkuY2hhbm5lbHMgIT09ICd1bmRlZmluZWQnO1xuXG4gICAgbGV0IHdoZXJlO1xuICAgIGlmIChoYXNXaGVyZSAmJiBoYXNDaGFubmVscykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlBVU0hfTUlTQ09ORklHVVJFRCxcbiAgICAgICAgJ0NoYW5uZWxzIGFuZCBxdWVyeSBjYW4gbm90IGJlIHNldCBhdCB0aGUgc2FtZSB0aW1lLicpO1xuICAgIH0gZWxzZSBpZiAoaGFzV2hlcmUpIHtcbiAgICAgIHdoZXJlID0gYm9keS53aGVyZTtcbiAgICB9IGVsc2UgaWYgKGhhc0NoYW5uZWxzKSB7XG4gICAgICB3aGVyZSA9IHtcbiAgICAgICAgXCJjaGFubmVsc1wiOiB7XG4gICAgICAgICAgXCIkaW5cIjogYm9keS5jaGFubmVsc1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5QVVNIX01JU0NPTkZJR1VSRUQsICdTZW5kaW5nIGEgcHVzaCByZXF1aXJlcyBlaXRoZXIgXCJjaGFubmVsc1wiIG9yIGEgXCJ3aGVyZVwiIHF1ZXJ5LicpO1xuICAgIH1cbiAgICByZXR1cm4gd2hlcmU7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUHVzaFJvdXRlcjtcbiJdfQ==