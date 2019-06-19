'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FeaturesRouter = undefined;

var _package = require('../../package.json');

var _PromiseRouter = require('../PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class FeaturesRouter extends _PromiseRouter2.default {
  mountRoutes() {
    this.route('GET', '/serverInfo', middleware.promiseEnforceMasterKeyAccess, req => {
      const features = {
        globalConfig: {
          create: true,
          read: true,
          update: true,
          delete: true
        },
        hooks: {
          create: true,
          read: true,
          update: true,
          delete: true
        },
        cloudCode: {
          jobs: true
        },
        logs: {
          level: true,
          size: true,
          order: true,
          until: true,
          from: true
        },
        push: {
          immediatePush: req.config.hasPushSupport,
          scheduledPush: req.config.hasPushScheduledSupport,
          storedPushData: req.config.hasPushSupport,
          pushAudiences: true,
          localization: true
        },
        schemas: {
          addField: true,
          removeField: true,
          addClass: true,
          removeClass: true,
          clearAllDataFromClass: true,
          exportClass: false,
          editClassLevelPermissions: true,
          editPointerPermissions: true
        }
      };

      return { response: {
          features: features,
          parseServerVersion: _package.version
        } };
    });
  }
}
exports.FeaturesRouter = FeaturesRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0ZlYXR1cmVzUm91dGVyLmpzIl0sIm5hbWVzIjpbIm1pZGRsZXdhcmUiLCJGZWF0dXJlc1JvdXRlciIsIm1vdW50Um91dGVzIiwicm91dGUiLCJwcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcyIsInJlcSIsImZlYXR1cmVzIiwiZ2xvYmFsQ29uZmlnIiwiY3JlYXRlIiwicmVhZCIsInVwZGF0ZSIsImRlbGV0ZSIsImhvb2tzIiwiY2xvdWRDb2RlIiwiam9icyIsImxvZ3MiLCJsZXZlbCIsInNpemUiLCJvcmRlciIsInVudGlsIiwiZnJvbSIsInB1c2giLCJpbW1lZGlhdGVQdXNoIiwiY29uZmlnIiwiaGFzUHVzaFN1cHBvcnQiLCJzY2hlZHVsZWRQdXNoIiwiaGFzUHVzaFNjaGVkdWxlZFN1cHBvcnQiLCJzdG9yZWRQdXNoRGF0YSIsInB1c2hBdWRpZW5jZXMiLCJsb2NhbGl6YXRpb24iLCJzY2hlbWFzIiwiYWRkRmllbGQiLCJyZW1vdmVGaWVsZCIsImFkZENsYXNzIiwicmVtb3ZlQ2xhc3MiLCJjbGVhckFsbERhdGFGcm9tQ2xhc3MiLCJleHBvcnRDbGFzcyIsImVkaXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJlZGl0UG9pbnRlclBlcm1pc3Npb25zIiwicmVzcG9uc2UiLCJwYXJzZVNlcnZlclZlcnNpb24iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7QUFDQTs7OztBQUNBOztJQUFZQSxVOzs7Ozs7QUFFTCxNQUFNQyxjQUFOLGlDQUEyQztBQUNoREMsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsS0FBWCxFQUFpQixhQUFqQixFQUFnQ0gsV0FBV0ksNkJBQTNDLEVBQTBFQyxPQUFPO0FBQy9FLFlBQU1DLFdBQVc7QUFDZkMsc0JBQWM7QUFDWkMsa0JBQVEsSUFESTtBQUVaQyxnQkFBTSxJQUZNO0FBR1pDLGtCQUFRLElBSEk7QUFJWkMsa0JBQVE7QUFKSSxTQURDO0FBT2ZDLGVBQU87QUFDTEosa0JBQVEsSUFESDtBQUVMQyxnQkFBTSxJQUZEO0FBR0xDLGtCQUFRLElBSEg7QUFJTEMsa0JBQVE7QUFKSCxTQVBRO0FBYWZFLG1CQUFXO0FBQ1RDLGdCQUFNO0FBREcsU0FiSTtBQWdCZkMsY0FBTTtBQUNKQyxpQkFBTyxJQURIO0FBRUpDLGdCQUFNLElBRkY7QUFHSkMsaUJBQU8sSUFISDtBQUlKQyxpQkFBTyxJQUpIO0FBS0pDLGdCQUFNO0FBTEYsU0FoQlM7QUF1QmZDLGNBQU07QUFDSkMseUJBQWVqQixJQUFJa0IsTUFBSixDQUFXQyxjQUR0QjtBQUVKQyx5QkFBZXBCLElBQUlrQixNQUFKLENBQVdHLHVCQUZ0QjtBQUdKQywwQkFBZ0J0QixJQUFJa0IsTUFBSixDQUFXQyxjQUh2QjtBQUlKSSx5QkFBZSxJQUpYO0FBS0pDLHdCQUFjO0FBTFYsU0F2QlM7QUE4QmZDLGlCQUFTO0FBQ1BDLG9CQUFVLElBREg7QUFFUEMsdUJBQWEsSUFGTjtBQUdQQyxvQkFBVSxJQUhIO0FBSVBDLHVCQUFhLElBSk47QUFLUEMsaUNBQXVCLElBTGhCO0FBTVBDLHVCQUFhLEtBTk47QUFPUEMscUNBQTJCLElBUHBCO0FBUVBDLGtDQUF3QjtBQVJqQjtBQTlCTSxPQUFqQjs7QUEwQ0EsYUFBTyxFQUFFQyxVQUFVO0FBQ2pCakMsb0JBQVVBLFFBRE87QUFFakJrQztBQUZpQixTQUFaLEVBQVA7QUFJRCxLQS9DRDtBQWdERDtBQWxEK0M7UUFBckN2QyxjLEdBQUFBLGMiLCJmaWxlIjoiRmVhdHVyZXNSb3V0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyB2ZXJzaW9uIH0gICAgIGZyb20gJy4uLy4uL3BhY2thZ2UuanNvbic7XG5pbXBvcnQgUHJvbWlzZVJvdXRlciAgIGZyb20gJy4uL1Byb21pc2VSb3V0ZXInO1xuaW1wb3J0ICogYXMgbWlkZGxld2FyZSBmcm9tIFwiLi4vbWlkZGxld2FyZXNcIjtcblxuZXhwb3J0IGNsYXNzIEZlYXR1cmVzUm91dGVyIGV4dGVuZHMgUHJvbWlzZVJvdXRlciB7XG4gIG1vdW50Um91dGVzKCkge1xuICAgIHRoaXMucm91dGUoJ0dFVCcsJy9zZXJ2ZXJJbmZvJywgbWlkZGxld2FyZS5wcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcywgcmVxID0+IHtcbiAgICAgIGNvbnN0IGZlYXR1cmVzID0ge1xuICAgICAgICBnbG9iYWxDb25maWc6IHtcbiAgICAgICAgICBjcmVhdGU6IHRydWUsXG4gICAgICAgICAgcmVhZDogdHJ1ZSxcbiAgICAgICAgICB1cGRhdGU6IHRydWUsXG4gICAgICAgICAgZGVsZXRlOiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBob29rczoge1xuICAgICAgICAgIGNyZWF0ZTogdHJ1ZSxcbiAgICAgICAgICByZWFkOiB0cnVlLFxuICAgICAgICAgIHVwZGF0ZTogdHJ1ZSxcbiAgICAgICAgICBkZWxldGU6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGNsb3VkQ29kZToge1xuICAgICAgICAgIGpvYnM6IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIGxvZ3M6IHtcbiAgICAgICAgICBsZXZlbDogdHJ1ZSxcbiAgICAgICAgICBzaXplOiB0cnVlLFxuICAgICAgICAgIG9yZGVyOiB0cnVlLFxuICAgICAgICAgIHVudGlsOiB0cnVlLFxuICAgICAgICAgIGZyb206IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHB1c2g6IHtcbiAgICAgICAgICBpbW1lZGlhdGVQdXNoOiByZXEuY29uZmlnLmhhc1B1c2hTdXBwb3J0LFxuICAgICAgICAgIHNjaGVkdWxlZFB1c2g6IHJlcS5jb25maWcuaGFzUHVzaFNjaGVkdWxlZFN1cHBvcnQsXG4gICAgICAgICAgc3RvcmVkUHVzaERhdGE6IHJlcS5jb25maWcuaGFzUHVzaFN1cHBvcnQsXG4gICAgICAgICAgcHVzaEF1ZGllbmNlczogdHJ1ZSxcbiAgICAgICAgICBsb2NhbGl6YXRpb246IHRydWUsXG4gICAgICAgIH0sXG4gICAgICAgIHNjaGVtYXM6IHtcbiAgICAgICAgICBhZGRGaWVsZDogdHJ1ZSxcbiAgICAgICAgICByZW1vdmVGaWVsZDogdHJ1ZSxcbiAgICAgICAgICBhZGRDbGFzczogdHJ1ZSxcbiAgICAgICAgICByZW1vdmVDbGFzczogdHJ1ZSxcbiAgICAgICAgICBjbGVhckFsbERhdGFGcm9tQ2xhc3M6IHRydWUsXG4gICAgICAgICAgZXhwb3J0Q2xhc3M6IGZhbHNlLFxuICAgICAgICAgIGVkaXRDbGFzc0xldmVsUGVybWlzc2lvbnM6IHRydWUsXG4gICAgICAgICAgZWRpdFBvaW50ZXJQZXJtaXNzaW9uczogdHJ1ZSxcbiAgICAgICAgfSxcbiAgICAgIH07XG5cbiAgICAgIHJldHVybiB7IHJlc3BvbnNlOiB7XG4gICAgICAgIGZlYXR1cmVzOiBmZWF0dXJlcyxcbiAgICAgICAgcGFyc2VTZXJ2ZXJWZXJzaW9uOiB2ZXJzaW9uLFxuICAgICAgfSB9O1xuICAgIH0pO1xuICB9XG59XG4iXX0=