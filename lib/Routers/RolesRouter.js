'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.RolesRouter = undefined;

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class RolesRouter extends _ClassesRouter2.default {
  className() {
    return '_Role';
  }

  mountRoutes() {
    this.route('GET', '/roles', req => {
      return this.handleFind(req);
    });
    this.route('GET', '/roles/:objectId', req => {
      return this.handleGet(req);
    });
    this.route('POST', '/roles', req => {
      return this.handleCreate(req);
    });
    this.route('PUT', '/roles/:objectId', req => {
      return this.handleUpdate(req);
    });
    this.route('DELETE', '/roles/:objectId', req => {
      return this.handleDelete(req);
    });
  }
}

exports.RolesRouter = RolesRouter;
exports.default = RolesRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL1JvbGVzUm91dGVyLmpzIl0sIm5hbWVzIjpbIlJvbGVzUm91dGVyIiwiY2xhc3NOYW1lIiwibW91bnRSb3V0ZXMiLCJyb3V0ZSIsInJlcSIsImhhbmRsZUZpbmQiLCJoYW5kbGVHZXQiLCJoYW5kbGVDcmVhdGUiLCJoYW5kbGVVcGRhdGUiLCJoYW5kbGVEZWxldGUiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFDQTs7Ozs7O0FBRU8sTUFBTUEsV0FBTixpQ0FBd0M7QUFDN0NDLGNBQVk7QUFDVixXQUFPLE9BQVA7QUFDRDs7QUFFREMsZ0JBQWM7QUFDWixTQUFLQyxLQUFMLENBQVcsS0FBWCxFQUFpQixRQUFqQixFQUEyQkMsT0FBTztBQUFFLGFBQU8sS0FBS0MsVUFBTCxDQUFnQkQsR0FBaEIsQ0FBUDtBQUE4QixLQUFsRTtBQUNBLFNBQUtELEtBQUwsQ0FBVyxLQUFYLEVBQWlCLGtCQUFqQixFQUFxQ0MsT0FBTztBQUFFLGFBQU8sS0FBS0UsU0FBTCxDQUFlRixHQUFmLENBQVA7QUFBNkIsS0FBM0U7QUFDQSxTQUFLRCxLQUFMLENBQVcsTUFBWCxFQUFrQixRQUFsQixFQUE0QkMsT0FBTztBQUFFLGFBQU8sS0FBS0csWUFBTCxDQUFrQkgsR0FBbEIsQ0FBUDtBQUFnQyxLQUFyRTtBQUNBLFNBQUtELEtBQUwsQ0FBVyxLQUFYLEVBQWlCLGtCQUFqQixFQUFxQ0MsT0FBTztBQUFFLGFBQU8sS0FBS0ksWUFBTCxDQUFrQkosR0FBbEIsQ0FBUDtBQUFnQyxLQUE5RTtBQUNBLFNBQUtELEtBQUwsQ0FBVyxRQUFYLEVBQW9CLGtCQUFwQixFQUF3Q0MsT0FBTztBQUFFLGFBQU8sS0FBS0ssWUFBTCxDQUFrQkwsR0FBbEIsQ0FBUDtBQUFnQyxLQUFqRjtBQUNEO0FBWDRDOztRQUFsQ0osVyxHQUFBQSxXO2tCQWNFQSxXIiwiZmlsZSI6IlJvbGVzUm91dGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiXG5pbXBvcnQgQ2xhc3Nlc1JvdXRlciBmcm9tICcuL0NsYXNzZXNSb3V0ZXInO1xuXG5leHBvcnQgY2xhc3MgUm9sZXNSb3V0ZXIgZXh0ZW5kcyBDbGFzc2VzUm91dGVyIHtcbiAgY2xhc3NOYW1lKCkge1xuICAgIHJldHVybiAnX1JvbGUnO1xuICB9XG5cbiAgbW91bnRSb3V0ZXMoKSB7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywnL3JvbGVzJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlRmluZChyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdHRVQnLCcvcm9sZXMvOm9iamVjdElkJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlR2V0KHJlcSk7IH0pO1xuICAgIHRoaXMucm91dGUoJ1BPU1QnLCcvcm9sZXMnLCByZXEgPT4geyByZXR1cm4gdGhpcy5oYW5kbGVDcmVhdGUocmVxKTsgfSk7XG4gICAgdGhpcy5yb3V0ZSgnUFVUJywnL3JvbGVzLzpvYmplY3RJZCcsIHJlcSA9PiB7IHJldHVybiB0aGlzLmhhbmRsZVVwZGF0ZShyZXEpOyB9KTtcbiAgICB0aGlzLnJvdXRlKCdERUxFVEUnLCcvcm9sZXMvOm9iamVjdElkJywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlRGVsZXRlKHJlcSk7IH0pO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFJvbGVzUm91dGVyO1xuIl19