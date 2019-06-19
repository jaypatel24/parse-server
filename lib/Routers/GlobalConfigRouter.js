'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.GlobalConfigRouter = undefined;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class GlobalConfigRouter extends _PromiseRouter2.default {
  getGlobalConfig(req) {
    return req.config.database.find('_GlobalConfig', { objectId: "1" }, { limit: 1 }).then(results => {
      if (results.length != 1) {
        // If there is no config in the database - return empty config.
        return { response: { params: {} } };
      }
      const globalConfig = results[0];
      return { response: { params: globalConfig.params } };
    });
  }

  updateGlobalConfig(req) {
    if (req.auth.isReadOnly) {
      throw new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, 'read-only masterKey isn\'t allowed to update the config.');
    }
    const params = req.body.params;
    // Transform in dot notation to make sure it works
    const update = Object.keys(params).reduce((acc, key) => {
      acc[`params.${key}`] = params[key];
      return acc;
    }, {});
    return req.config.database.update('_GlobalConfig', { objectId: "1" }, update, { upsert: true }).then(() => ({ response: { result: true } }));
  }

  mountRoutes() {
    this.route('GET', '/config', req => {
      return this.getGlobalConfig(req);
    });
    this.route('PUT', '/config', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.updateGlobalConfig(req);
    });
  }
}

exports.GlobalConfigRouter = GlobalConfigRouter; // global_config.js

exports.default = GlobalConfigRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0dsb2JhbENvbmZpZ1JvdXRlci5qcyJdLCJuYW1lcyI6WyJtaWRkbGV3YXJlIiwiR2xvYmFsQ29uZmlnUm91dGVyIiwiZ2V0R2xvYmFsQ29uZmlnIiwicmVxIiwiY29uZmlnIiwiZGF0YWJhc2UiLCJmaW5kIiwib2JqZWN0SWQiLCJsaW1pdCIsInRoZW4iLCJyZXN1bHRzIiwibGVuZ3RoIiwicmVzcG9uc2UiLCJwYXJhbXMiLCJnbG9iYWxDb25maWciLCJ1cGRhdGVHbG9iYWxDb25maWciLCJhdXRoIiwiaXNSZWFkT25seSIsIkVycm9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsImJvZHkiLCJ1cGRhdGUiLCJPYmplY3QiLCJrZXlzIiwicmVkdWNlIiwiYWNjIiwia2V5IiwidXBzZXJ0IiwicmVzdWx0IiwibW91bnRSb3V0ZXMiLCJyb3V0ZSIsInByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztJQUFZQSxVOzs7Ozs7QUFFTCxNQUFNQyxrQkFBTixpQ0FBK0M7QUFDcERDLGtCQUFnQkMsR0FBaEIsRUFBcUI7QUFDbkIsV0FBT0EsSUFBSUMsTUFBSixDQUFXQyxRQUFYLENBQW9CQyxJQUFwQixDQUF5QixlQUF6QixFQUEwQyxFQUFFQyxVQUFVLEdBQVosRUFBMUMsRUFBNkQsRUFBRUMsT0FBTyxDQUFULEVBQTdELEVBQTJFQyxJQUEzRSxDQUFpRkMsT0FBRCxJQUFhO0FBQ2xHLFVBQUlBLFFBQVFDLE1BQVIsSUFBa0IsQ0FBdEIsRUFBeUI7QUFDdkI7QUFDQSxlQUFPLEVBQUVDLFVBQVUsRUFBRUMsUUFBUSxFQUFWLEVBQVosRUFBUDtBQUNEO0FBQ0QsWUFBTUMsZUFBZUosUUFBUSxDQUFSLENBQXJCO0FBQ0EsYUFBTyxFQUFFRSxVQUFVLEVBQUVDLFFBQVFDLGFBQWFELE1BQXZCLEVBQVosRUFBUDtBQUNELEtBUE0sQ0FBUDtBQVFEOztBQUVERSxxQkFBbUJaLEdBQW5CLEVBQXdCO0FBQ3RCLFFBQUlBLElBQUlhLElBQUosQ0FBU0MsVUFBYixFQUF5QjtBQUN2QixZQUFNLElBQUksZUFBTUMsS0FBVixDQUFnQixlQUFNQSxLQUFOLENBQVlDLG1CQUE1QixFQUFpRCwwREFBakQsQ0FBTjtBQUNEO0FBQ0QsVUFBTU4sU0FBU1YsSUFBSWlCLElBQUosQ0FBU1AsTUFBeEI7QUFDQTtBQUNBLFVBQU1RLFNBQVNDLE9BQU9DLElBQVAsQ0FBWVYsTUFBWixFQUFvQlcsTUFBcEIsQ0FBMkIsQ0FBQ0MsR0FBRCxFQUFNQyxHQUFOLEtBQWM7QUFDdERELFVBQUssVUFBU0MsR0FBSSxFQUFsQixJQUF1QmIsT0FBT2EsR0FBUCxDQUF2QjtBQUNBLGFBQU9ELEdBQVA7QUFDRCxLQUhjLEVBR1osRUFIWSxDQUFmO0FBSUEsV0FBT3RCLElBQUlDLE1BQUosQ0FBV0MsUUFBWCxDQUFvQmdCLE1BQXBCLENBQTJCLGVBQTNCLEVBQTRDLEVBQUNkLFVBQVUsR0FBWCxFQUE1QyxFQUE2RGMsTUFBN0QsRUFBcUUsRUFBQ00sUUFBUSxJQUFULEVBQXJFLEVBQXFGbEIsSUFBckYsQ0FBMEYsT0FBTyxFQUFFRyxVQUFVLEVBQUVnQixRQUFRLElBQVYsRUFBWixFQUFQLENBQTFGLENBQVA7QUFDRDs7QUFFREMsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsS0FBWCxFQUFrQixTQUFsQixFQUE2QjNCLE9BQU87QUFBRSxhQUFPLEtBQUtELGVBQUwsQ0FBcUJDLEdBQXJCLENBQVA7QUFBa0MsS0FBeEU7QUFDQSxTQUFLMkIsS0FBTCxDQUFXLEtBQVgsRUFBa0IsU0FBbEIsRUFBNkI5QixXQUFXK0IsNkJBQXhDLEVBQXVFNUIsT0FBTztBQUFFLGFBQU8sS0FBS1ksa0JBQUwsQ0FBd0JaLEdBQXhCLENBQVA7QUFBcUMsS0FBckg7QUFDRDtBQTVCbUQ7O1FBQXpDRixrQixHQUFBQSxrQixFQUxiOztrQkFvQ2VBLGtCIiwiZmlsZSI6Ikdsb2JhbENvbmZpZ1JvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIGdsb2JhbF9jb25maWcuanNcbmltcG9ydCBQYXJzZSAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgUHJvbWlzZVJvdXRlciAgIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tIFwiLi4vbWlkZGxld2FyZXNcIjtcblxuZXhwb3J0IGNsYXNzIEdsb2JhbENvbmZpZ1JvdXRlciBleHRlbmRzIFByb21pc2VSb3V0ZXIge1xuICBnZXRHbG9iYWxDb25maWcocmVxKSB7XG4gICAgcmV0dXJuIHJlcS5jb25maWcuZGF0YWJhc2UuZmluZCgnX0dsb2JhbENvbmZpZycsIHsgb2JqZWN0SWQ6IFwiMVwiIH0sIHsgbGltaXQ6IDEgfSkudGhlbigocmVzdWx0cykgPT4ge1xuICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgLy8gSWYgdGhlcmUgaXMgbm8gY29uZmlnIGluIHRoZSBkYXRhYmFzZSAtIHJldHVybiBlbXB0eSBjb25maWcuXG4gICAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7IHBhcmFtczoge30gfSB9O1xuICAgICAgfVxuICAgICAgY29uc3QgZ2xvYmFsQ29uZmlnID0gcmVzdWx0c1swXTtcbiAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7IHBhcmFtczogZ2xvYmFsQ29uZmlnLnBhcmFtcyB9IH07XG4gICAgfSk7XG4gIH1cblxuICB1cGRhdGVHbG9iYWxDb25maWcocmVxKSB7XG4gICAgaWYgKHJlcS5hdXRoLmlzUmVhZE9ubHkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLCAncmVhZC1vbmx5IG1hc3RlcktleSBpc25cXCd0IGFsbG93ZWQgdG8gdXBkYXRlIHRoZSBjb25maWcuJyk7XG4gICAgfVxuICAgIGNvbnN0IHBhcmFtcyA9IHJlcS5ib2R5LnBhcmFtcztcbiAgICAvLyBUcmFuc2Zvcm0gaW4gZG90IG5vdGF0aW9uIHRvIG1ha2Ugc3VyZSBpdCB3b3Jrc1xuICAgIGNvbnN0IHVwZGF0ZSA9IE9iamVjdC5rZXlzKHBhcmFtcykucmVkdWNlKChhY2MsIGtleSkgPT4ge1xuICAgICAgYWNjW2BwYXJhbXMuJHtrZXl9YF0gPSBwYXJhbXNba2V5XTtcbiAgICAgIHJldHVybiBhY2M7XG4gICAgfSwge30pO1xuICAgIHJldHVybiByZXEuY29uZmlnLmRhdGFiYXNlLnVwZGF0ZSgnX0dsb2JhbENvbmZpZycsIHtvYmplY3RJZDogXCIxXCJ9LCB1cGRhdGUsIHt1cHNlcnQ6IHRydWV9KS50aGVuKCgpID0+ICh7IHJlc3BvbnNlOiB7IHJlc3VsdDogdHJ1ZSB9IH0pKTtcbiAgfVxuXG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsICcvY29uZmlnJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuZ2V0R2xvYmFsQ29uZmlnKHJlcSkgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUFVUJywgJy9jb25maWcnLCBtaWRkbGV3YXJlLnByb21pc2VFbmZvcmNlTWFzdGVyS2V5QWNjZXNzLCByZXEgPT4geyByZXR1cm4gdGhpcy51cGRhdGVHbG9iYWxDb25maWcocmVxKSB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBHbG9iYWxDb25maWdSb3V0ZXI7XG4iXX0=