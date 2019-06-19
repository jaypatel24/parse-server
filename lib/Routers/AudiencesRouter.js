'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AudiencesRouter = undefined;

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class AudiencesRouter extends _ClassesRouter2.default {

  className() {
    return '_Audience';
  }

  handleFind(req) {
    const body = Object.assign(req.body, _ClassesRouter2.default.JSONFromQuery(req.query));
    const options = _ClassesRouter2.default.optionsFromBody(body);

    return _rest2.default.find(req.config, req.auth, '_Audience', body.where, options, req.info.clientSDK).then(response => {

      response.results.forEach(item => {
        item.query = JSON.parse(item.query);
      });

      return { response: response };
    });
  }

  handleGet(req) {
    return super.handleGet(req).then(data => {
      data.response.query = JSON.parse(data.response.query);

      return data;
    });
  }

  mountRoutes() {
    this.route('GET', '/push_audiences', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handleFind(req);
    });
    this.route('GET', '/push_audiences/:objectId', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handleGet(req);
    });
    this.route('POST', '/push_audiences', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handleCreate(req);
    });
    this.route('PUT', '/push_audiences/:objectId', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/push_audiences/:objectId', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handleDelete(req);
    });
  }
}

exports.AudiencesRouter = AudiencesRouter;
exports.default = AudiencesRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0F1ZGllbmNlc1JvdXRlci5qcyJdLCJuYW1lcyI6WyJtaWRkbGV3YXJlIiwiQXVkaWVuY2VzUm91dGVyIiwiY2xhc3NOYW1lIiwiaGFuZGxlRmluZCIsInJlcSIsImJvZHkiLCJPYmplY3QiLCJhc3NpZ24iLCJKU09ORnJvbVF1ZXJ5IiwicXVlcnkiLCJvcHRpb25zIiwib3B0aW9uc0Zyb21Cb2R5IiwiZmluZCIsImNvbmZpZyIsImF1dGgiLCJ3aGVyZSIsImluZm8iLCJjbGllbnRTREsiLCJ0aGVuIiwicmVzcG9uc2UiLCJyZXN1bHRzIiwiZm9yRWFjaCIsIml0ZW0iLCJKU09OIiwicGFyc2UiLCJoYW5kbGVHZXQiLCJkYXRhIiwibW91bnRSb3V0ZXMiLCJyb3V0ZSIsInByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzIiwiaGFuZGxlQ3JlYXRlIiwiaGFuZGxlVXBkYXRlIiwiaGFuZGxlRGVsZXRlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7Ozs7QUFDQTs7OztBQUNBOztJQUFZQSxVOzs7Ozs7QUFFTCxNQUFNQyxlQUFOLGlDQUE0Qzs7QUFFakRDLGNBQVk7QUFDVixXQUFPLFdBQVA7QUFDRDs7QUFFREMsYUFBV0MsR0FBWCxFQUFnQjtBQUNkLFVBQU1DLE9BQU9DLE9BQU9DLE1BQVAsQ0FBY0gsSUFBSUMsSUFBbEIsRUFBd0Isd0JBQWNHLGFBQWQsQ0FBNEJKLElBQUlLLEtBQWhDLENBQXhCLENBQWI7QUFDQSxVQUFNQyxVQUFVLHdCQUFjQyxlQUFkLENBQThCTixJQUE5QixDQUFoQjs7QUFFQSxXQUFPLGVBQUtPLElBQUwsQ0FBVVIsSUFBSVMsTUFBZCxFQUFzQlQsSUFBSVUsSUFBMUIsRUFBZ0MsV0FBaEMsRUFBNkNULEtBQUtVLEtBQWxELEVBQXlETCxPQUF6RCxFQUFrRU4sSUFBSVksSUFBSixDQUFTQyxTQUEzRSxFQUNKQyxJQURJLENBQ0VDLFFBQUQsSUFBYzs7QUFFbEJBLGVBQVNDLE9BQVQsQ0FBaUJDLE9BQWpCLENBQTBCQyxJQUFELElBQVU7QUFDakNBLGFBQUtiLEtBQUwsR0FBYWMsS0FBS0MsS0FBTCxDQUFXRixLQUFLYixLQUFoQixDQUFiO0FBQ0QsT0FGRDs7QUFJQSxhQUFPLEVBQUNVLFVBQVVBLFFBQVgsRUFBUDtBQUNELEtBUkksQ0FBUDtBQVNEOztBQUVETSxZQUFVckIsR0FBVixFQUFlO0FBQ2IsV0FBTyxNQUFNcUIsU0FBTixDQUFnQnJCLEdBQWhCLEVBQ0pjLElBREksQ0FDRVEsSUFBRCxJQUFVO0FBQ2RBLFdBQUtQLFFBQUwsQ0FBY1YsS0FBZCxHQUFzQmMsS0FBS0MsS0FBTCxDQUFXRSxLQUFLUCxRQUFMLENBQWNWLEtBQXpCLENBQXRCOztBQUVBLGFBQU9pQixJQUFQO0FBQ0QsS0FMSSxDQUFQO0FBTUQ7O0FBRURDLGdCQUFjO0FBQ1osU0FBS0MsS0FBTCxDQUFXLEtBQVgsRUFBaUIsaUJBQWpCLEVBQW9DNUIsV0FBVzZCLDZCQUEvQyxFQUE4RXpCLE9BQU87QUFBRSxhQUFPLEtBQUtELFVBQUwsQ0FBZ0JDLEdBQWhCLENBQVA7QUFBOEIsS0FBckg7QUFDQSxTQUFLd0IsS0FBTCxDQUFXLEtBQVgsRUFBaUIsMkJBQWpCLEVBQThDNUIsV0FBVzZCLDZCQUF6RCxFQUF3RnpCLE9BQU87QUFBRSxhQUFPLEtBQUtxQixTQUFMLENBQWVyQixHQUFmLENBQVA7QUFBNkIsS0FBOUg7QUFDQSxTQUFLd0IsS0FBTCxDQUFXLE1BQVgsRUFBa0IsaUJBQWxCLEVBQXFDNUIsV0FBVzZCLDZCQUFoRCxFQUErRXpCLE9BQU87QUFBRSxhQUFPLEtBQUswQixZQUFMLENBQWtCMUIsR0FBbEIsQ0FBUDtBQUFnQyxLQUF4SDtBQUNBLFNBQUt3QixLQUFMLENBQVcsS0FBWCxFQUFpQiwyQkFBakIsRUFBOEM1QixXQUFXNkIsNkJBQXpELEVBQXdGekIsT0FBTztBQUFFLGFBQU8sS0FBSzJCLFlBQUwsQ0FBa0IzQixHQUFsQixDQUFQO0FBQWdDLEtBQWpJO0FBQ0EsU0FBS3dCLEtBQUwsQ0FBVyxRQUFYLEVBQW9CLDJCQUFwQixFQUFpRDVCLFdBQVc2Qiw2QkFBNUQsRUFBMkZ6QixPQUFPO0FBQUUsYUFBTyxLQUFLNEIsWUFBTCxDQUFrQjVCLEdBQWxCLENBQVA7QUFBZ0MsS0FBcEk7QUFDRDtBQXBDZ0Q7O1FBQXRDSCxlLEdBQUFBLGU7a0JBdUNFQSxlIiwiZmlsZSI6IkF1ZGllbmNlc1JvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBDbGFzc2VzUm91dGVyIGZyb20gJy4vQ2xhc3Nlc1JvdXRlcic7XG5pbXBvcnQgcmVzdCBmcm9tICcuLi9yZXN0JztcbmltcG9ydCAqIGFzIG1pZGRsZXdhcmUgZnJvbSAnLi4vbWlkZGxld2FyZXMnO1xuXG5leHBvcnQgY2xhc3MgQXVkaWVuY2VzUm91dGVyIGV4dGVuZHMgQ2xhc3Nlc1JvdXRlciB7XG5cbiAgY2xhc3NOYW1lKCkge1xuICAgIHJldHVybiAnX0F1ZGllbmNlJztcbiAgfVxuXG4gIGhhbmRsZUZpbmQocmVxKSB7XG4gICAgY29uc3QgYm9keSA9IE9iamVjdC5hc3NpZ24ocmVxLmJvZHksIENsYXNzZXNSb3V0ZXIuSlNPTkZyb21RdWVyeShyZXEucXVlcnkpKTtcbiAgICBjb25zdCBvcHRpb25zID0gQ2xhc3Nlc1JvdXRlci5vcHRpb25zRnJvbUJvZHkoYm9keSk7XG5cbiAgICByZXR1cm4gcmVzdC5maW5kKHJlcS5jb25maWcsIHJlcS5hdXRoLCAnX0F1ZGllbmNlJywgYm9keS53aGVyZSwgb3B0aW9ucywgcmVxLmluZm8uY2xpZW50U0RLKVxuICAgICAgLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG5cbiAgICAgICAgcmVzcG9uc2UucmVzdWx0cy5mb3JFYWNoKChpdGVtKSA9PiB7XG4gICAgICAgICAgaXRlbS5xdWVyeSA9IEpTT04ucGFyc2UoaXRlbS5xdWVyeSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiB7cmVzcG9uc2U6IHJlc3BvbnNlfTtcbiAgICAgIH0pO1xuICB9XG5cbiAgaGFuZGxlR2V0KHJlcSkge1xuICAgIHJldHVybiBzdXBlci5oYW5kbGVHZXQocmVxKVxuICAgICAgLnRoZW4oKGRhdGEpID0+IHtcbiAgICAgICAgZGF0YS5yZXNwb25zZS5xdWVyeSA9IEpTT04ucGFyc2UoZGF0YS5yZXNwb25zZS5xdWVyeSk7XG5cbiAgICAgICAgcmV0dXJuIGRhdGE7XG4gICAgICB9KTtcbiAgfVxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsJy9wdXNoX2F1ZGllbmNlcycsIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUZpbmQocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywnL3B1c2hfYXVkaWVuY2VzLzpvYmplY3RJZCcsIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZUdldChyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdQT1NUJywnL3B1c2hfYXVkaWVuY2VzJywgbWlkZGxld2FyZS5wcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlQ3JlYXRlKHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BVVCcsJy9wdXNoX2F1ZGllbmNlcy86b2JqZWN0SWQnLCBtaWRkbGV3YXJlLnByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVVcGRhdGUocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnREVMRVRFJywnL3B1c2hfYXVkaWVuY2VzLzpvYmplY3RJZCcsIG1pZGRsZXdhcmUucHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZURlbGV0ZShyZXEpOyB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBBdWRpZW5jZXNSb3V0ZXI7XG4iXX0=