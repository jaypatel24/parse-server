'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PurgeRouter = undefined;

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class PurgeRouter extends _PromiseRouter2.default {

  handlePurge(req) {
    if (req.auth.isReadOnly) {
      throw new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, 'read-only masterKey isn\'t allowed to purge a schema.');
    }
    return req.config.database.purgeCollection(req.params.className).then(() => {
      var cacheAdapter = req.config.cacheController;
      if (req.params.className == '_Session') {
        cacheAdapter.user.clear();
      } else if (req.params.className == '_Role') {
        cacheAdapter.role.clear();
      }
      return { response: {} };
    }).catch(error => {
      if (!error || error && error.code === _node2.default.Error.OBJECT_NOT_FOUND) {
        return { response: {} };
      }
      throw error;
    });
  }

  mountRoutes() {
    this.route('DELETE', '/purge/:className', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handlePurge(req);
    });
  }
}

exports.PurgeRouter = PurgeRouter;
exports.default = PurgeRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1B1cmdlUm91dGVyLmpzIl0sIm5hbWVzIjpbIm1pZGRsZXdhcmUiLCJQdXJnZVJvdXRlciIsImhhbmRsZVB1cmdlIiwicmVxIiwiYXV0aCIsImlzUmVhZE9ubHkiLCJFcnJvciIsIk9QRVJBVElPTl9GT1JCSURERU4iLCJjb25maWciLCJkYXRhYmFzZSIsInB1cmdlQ29sbGVjdGlvbiIsInBhcmFtcyIsImNsYXNzTmFtZSIsInRoZW4iLCJjYWNoZUFkYXB0ZXIiLCJjYWNoZUNvbnRyb2xsZXIiLCJ1c2VyIiwiY2xlYXIiLCJyb2xlIiwicmVzcG9uc2UiLCJjYXRjaCIsImVycm9yIiwiY29kZSIsIk9CSkVDVF9OT1RfRk9VTkQiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOztJQUFZQSxVOztBQUNaOzs7Ozs7OztBQUVPLE1BQU1DLFdBQU4saUNBQXdDOztBQUU3Q0MsY0FBWUMsR0FBWixFQUFpQjtBQUNmLFFBQUlBLElBQUlDLElBQUosQ0FBU0MsVUFBYixFQUF5QjtBQUN2QixZQUFNLElBQUksZUFBTUMsS0FBVixDQUFnQixlQUFNQSxLQUFOLENBQVlDLG1CQUE1QixFQUFpRCx1REFBakQsQ0FBTjtBQUNEO0FBQ0QsV0FBT0osSUFBSUssTUFBSixDQUFXQyxRQUFYLENBQW9CQyxlQUFwQixDQUFvQ1AsSUFBSVEsTUFBSixDQUFXQyxTQUEvQyxFQUNKQyxJQURJLENBQ0MsTUFBTTtBQUNWLFVBQUlDLGVBQWVYLElBQUlLLE1BQUosQ0FBV08sZUFBOUI7QUFDQSxVQUFJWixJQUFJUSxNQUFKLENBQVdDLFNBQVgsSUFBd0IsVUFBNUIsRUFBd0M7QUFDdENFLHFCQUFhRSxJQUFiLENBQWtCQyxLQUFsQjtBQUNELE9BRkQsTUFFTyxJQUFJZCxJQUFJUSxNQUFKLENBQVdDLFNBQVgsSUFBd0IsT0FBNUIsRUFBcUM7QUFDMUNFLHFCQUFhSSxJQUFiLENBQWtCRCxLQUFsQjtBQUNEO0FBQ0QsYUFBTyxFQUFDRSxVQUFVLEVBQVgsRUFBUDtBQUNELEtBVEksRUFTRkMsS0FURSxDQVNLQyxLQUFELElBQVc7QUFDbEIsVUFBSSxDQUFDQSxLQUFELElBQVdBLFNBQVNBLE1BQU1DLElBQU4sS0FBZSxlQUFNaEIsS0FBTixDQUFZaUIsZ0JBQW5ELEVBQXNFO0FBQ3BFLGVBQU8sRUFBQ0osVUFBVSxFQUFYLEVBQVA7QUFDRDtBQUNELFlBQU1FLEtBQU47QUFDRCxLQWRJLENBQVA7QUFlRDs7QUFFREcsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsUUFBWCxFQUFzQixtQkFBdEIsRUFBMkN6QixXQUFXMEIsNkJBQXRELEVBQXNGdkIsR0FBRCxJQUFTO0FBQUUsYUFBTyxLQUFLRCxXQUFMLENBQWlCQyxHQUFqQixDQUFQO0FBQStCLEtBQS9IO0FBQ0Q7QUF6QjRDOztRQUFsQ0YsVyxHQUFBQSxXO2tCQTRCRUEsVyIsImZpbGUiOiJQdXJnZVJvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBQcm9taXNlUm91dGVyIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tICcuLi9taWRkbGV3YXJlcyc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5cbmV4cG9ydCBjbGFzcyBQdXJnZVJvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuXG4gIGhhbmRsZVB1cmdlKHJlcSkge1xuICAgIGlmIChyZXEuYXV0aC5pc1JlYWRPbmx5KSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTiwgJ3JlYWQtb25seSBtYXN0ZXJLZXkgaXNuXFwndCBhbGxvd2VkIHRvIHB1cmdlIGEgc2NoZW1hLicpO1xuICAgIH1cbiAgICByZXR1cm4gcmVxLmNvbmZpZy5kYXRhYmFzZS5wdXJnZUNvbGxlY3Rpb24ocmVxLnBhcmFtcy5jbGFzc05hbWUpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHZhciBjYWNoZUFkYXB0ZXIgPSByZXEuY29uZmlnLmNhY2hlQ29udHJvbGxlcjtcbiAgICAgICAgaWYgKHJlcS5wYXJhbXMuY2xhc3NOYW1lID09ICdfU2Vzc2lvbicpIHtcbiAgICAgICAgICBjYWNoZUFkYXB0ZXIudXNlci5jbGVhcigpO1xuICAgICAgICB9IGVsc2UgaWYgKHJlcS5wYXJhbXMuY2xhc3NOYW1lID09ICdfUm9sZScpIHtcbiAgICAgICAgICBjYWNoZUFkYXB0ZXIucm9sZS5jbGVhcigpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB7cmVzcG9uc2U6IHt9fTtcbiAgICAgIH0pLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICBpZiAoIWVycm9yIHx8IChlcnJvciAmJiBlcnJvci5jb2RlID09PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSkge1xuICAgICAgICAgIHJldHVybiB7cmVzcG9uc2U6IHt9fTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuICB9XG5cbiAgbW91bnRSb3V0ZXMoKSB7XG4gICAgdGhpcy5yb3V0ZSgnREVMRVRFJywgICcvcHVyZ2UvOmNsYXNzTmFtZScsIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsIChyZXEpID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlUHVyZ2UocmVxKTsgfSk7XG4gIH1cbn1cblxuZXhwb3J0IGRlZmF1bHQgUHVyZ2VSb3V0ZXI7XG4iXX0=