'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AppCache = undefined;

var _InMemoryCache = require('./Adapters/Cache/InMemoryCache');

var AppCache = exports.AppCache = new _InMemoryCache.InMemoryCache({ ttl: NaN });
exports.default = AppCache;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9jYWNoZS5qcyJdLCJuYW1lcyI6WyJBcHBDYWNoZSIsInR0bCIsIk5hTiJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUVPLElBQUlBLDhCQUFXLGlDQUFrQixFQUFDQyxLQUFLQyxHQUFOLEVBQWxCLENBQWY7a0JBQ1FGLFEiLCJmaWxlIjoiY2FjaGUuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQge0luTWVtb3J5Q2FjaGV9IGZyb20gJy4vQWRhcHRlcnMvQ2FjaGUvSW5NZW1vcnlDYWNoZSc7XG5cbmV4cG9ydCB2YXIgQXBwQ2FjaGUgPSBuZXcgSW5NZW1vcnlDYWNoZSh7dHRsOiBOYU59KTtcbmV4cG9ydCBkZWZhdWx0IEFwcENhY2hlO1xuIl19