'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.LRUCache = undefined;

var _lruCache = require('lru-cache');

var _lruCache2 = _interopRequireDefault(_lruCache);

var _defaults = require('../../defaults');

var _defaults2 = _interopRequireDefault(_defaults);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class LRUCache {
  constructor({
    ttl = _defaults2.default.cacheTTL,
    maxSize = _defaults2.default.cacheMaxSize
  }) {
    this.cache = new _lruCache2.default({
      max: maxSize,
      maxAge: ttl
    });
  }

  get(key) {
    return this.cache.get(key) || null;
  }

  put(key, value, ttl = this.ttl) {
    this.cache.set(key, value, ttl);
  }

  del(key) {
    this.cache.del(key);
  }

  clear() {
    this.cache.reset();
  }

}

exports.LRUCache = LRUCache;
exports.default = LRUCache;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9DYWNoZS9MUlVDYWNoZS5qcyJdLCJuYW1lcyI6WyJMUlVDYWNoZSIsImNvbnN0cnVjdG9yIiwidHRsIiwiY2FjaGVUVEwiLCJtYXhTaXplIiwiY2FjaGVNYXhTaXplIiwiY2FjaGUiLCJtYXgiLCJtYXhBZ2UiLCJnZXQiLCJrZXkiLCJwdXQiLCJ2YWx1ZSIsInNldCIsImRlbCIsImNsZWFyIiwicmVzZXQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOzs7Ozs7QUFFTyxNQUFNQSxRQUFOLENBQWU7QUFDcEJDLGNBQVk7QUFDVkMsVUFBTSxtQkFBU0MsUUFETDtBQUVWQyxjQUFVLG1CQUFTQztBQUZULEdBQVosRUFHRztBQUNELFNBQUtDLEtBQUwsR0FBYSx1QkFBUTtBQUNuQkMsV0FBS0gsT0FEYztBQUVuQkksY0FBUU47QUFGVyxLQUFSLENBQWI7QUFJRDs7QUFFRE8sTUFBSUMsR0FBSixFQUFTO0FBQ1AsV0FBTyxLQUFLSixLQUFMLENBQVdHLEdBQVgsQ0FBZUMsR0FBZixLQUF1QixJQUE5QjtBQUNEOztBQUVEQyxNQUFJRCxHQUFKLEVBQVNFLEtBQVQsRUFBZ0JWLE1BQU0sS0FBS0EsR0FBM0IsRUFBZ0M7QUFDOUIsU0FBS0ksS0FBTCxDQUFXTyxHQUFYLENBQWVILEdBQWYsRUFBb0JFLEtBQXBCLEVBQTJCVixHQUEzQjtBQUNEOztBQUVEWSxNQUFJSixHQUFKLEVBQVM7QUFDUCxTQUFLSixLQUFMLENBQVdRLEdBQVgsQ0FBZUosR0FBZjtBQUNEOztBQUVESyxVQUFRO0FBQ04sU0FBS1QsS0FBTCxDQUFXVSxLQUFYO0FBQ0Q7O0FBekJtQjs7UUFBVGhCLFEsR0FBQUEsUTtrQkE2QkVBLFEiLCJmaWxlIjoiTFJVQ2FjaGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgTFJVIGZyb20gJ2xydS1jYWNoZSc7XG5pbXBvcnQgZGVmYXVsdHMgIGZyb20gJy4uLy4uL2RlZmF1bHRzJztcblxuZXhwb3J0IGNsYXNzIExSVUNhY2hlIHtcbiAgY29uc3RydWN0b3Ioe1xuICAgIHR0bCA9IGRlZmF1bHRzLmNhY2hlVFRMLFxuICAgIG1heFNpemUgPSBkZWZhdWx0cy5jYWNoZU1heFNpemUsXG4gIH0pIHtcbiAgICB0aGlzLmNhY2hlID0gbmV3IExSVSh7XG4gICAgICBtYXg6IG1heFNpemUsXG4gICAgICBtYXhBZ2U6IHR0bFxuICAgIH0pO1xuICB9XG5cbiAgZ2V0KGtleSkge1xuICAgIHJldHVybiB0aGlzLmNhY2hlLmdldChrZXkpIHx8IG51bGw7XG4gIH1cblxuICBwdXQoa2V5LCB2YWx1ZSwgdHRsID0gdGhpcy50dGwpIHtcbiAgICB0aGlzLmNhY2hlLnNldChrZXksIHZhbHVlLCB0dGwpO1xuICB9XG5cbiAgZGVsKGtleSkge1xuICAgIHRoaXMuY2FjaGUuZGVsKGtleSk7XG4gIH1cblxuICBjbGVhcigpIHtcbiAgICB0aGlzLmNhY2hlLnJlc2V0KCk7XG4gIH1cblxufVxuXG5leHBvcnQgZGVmYXVsdCBMUlVDYWNoZTtcbiJdfQ==