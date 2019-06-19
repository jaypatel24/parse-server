'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ParseServer = exports.PushWorker = exports.TestUtils = exports.LRUCacheAdapter = exports.RedisCacheAdapter = exports.NullCacheAdapter = exports.InMemoryCacheAdapter = exports.FileSystemAdapter = exports.GCSAdapter = exports.S3Adapter = undefined;

var _ParseServer2 = require('./ParseServer');

var _ParseServer3 = _interopRequireDefault(_ParseServer2);

var _s3FilesAdapter = require('@parse/s3-files-adapter');

var _s3FilesAdapter2 = _interopRequireDefault(_s3FilesAdapter);

var _fsFilesAdapter = require('@parse/fs-files-adapter');

var _fsFilesAdapter2 = _interopRequireDefault(_fsFilesAdapter);

var _InMemoryCacheAdapter = require('./Adapters/Cache/InMemoryCacheAdapter');

var _InMemoryCacheAdapter2 = _interopRequireDefault(_InMemoryCacheAdapter);

var _NullCacheAdapter = require('./Adapters/Cache/NullCacheAdapter');

var _NullCacheAdapter2 = _interopRequireDefault(_NullCacheAdapter);

var _RedisCacheAdapter = require('./Adapters/Cache/RedisCacheAdapter');

var _RedisCacheAdapter2 = _interopRequireDefault(_RedisCacheAdapter);

var _LRUCache = require('./Adapters/Cache/LRUCache.js');

var _LRUCache2 = _interopRequireDefault(_LRUCache);

var _TestUtils = require('./TestUtils');

var TestUtils = _interopRequireWildcard(_TestUtils);

var _deprecated = require('./deprecated');

var _logger = require('./logger');

var _PushWorker = require('./Push/PushWorker');

var _Options = require('./Options');

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// Factory function
const _ParseServer = function (options) {
  const server = new _ParseServer3.default(options);
  return server.app;
};
// Mount the create liveQueryServer
_ParseServer.createLiveQueryServer = _ParseServer3.default.createLiveQueryServer;
_ParseServer.start = _ParseServer3.default.start;

const GCSAdapter = (0, _deprecated.useExternal)('GCSAdapter', '@parse/gcs-files-adapter');

Object.defineProperty(module.exports, 'logger', {
  get: _logger.getLogger
});

exports.default = _ParseServer3.default;
exports.S3Adapter = _s3FilesAdapter2.default;
exports.GCSAdapter = GCSAdapter;
exports.FileSystemAdapter = _fsFilesAdapter2.default;
exports.InMemoryCacheAdapter = _InMemoryCacheAdapter2.default;
exports.NullCacheAdapter = _NullCacheAdapter2.default;
exports.RedisCacheAdapter = _RedisCacheAdapter2.default;
exports.LRUCacheAdapter = _LRUCache2.default;
exports.TestUtils = TestUtils;
exports.PushWorker = _PushWorker.PushWorker;
exports.ParseServer = _ParseServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9pbmRleC5qcyJdLCJuYW1lcyI6WyJUZXN0VXRpbHMiLCJfUGFyc2VTZXJ2ZXIiLCJvcHRpb25zIiwic2VydmVyIiwiYXBwIiwiY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyIiwic3RhcnQiLCJHQ1NBZGFwdGVyIiwiT2JqZWN0IiwiZGVmaW5lUHJvcGVydHkiLCJtb2R1bGUiLCJleHBvcnRzIiwiZ2V0IiwiUzNBZGFwdGVyIiwiRmlsZVN5c3RlbUFkYXB0ZXIiLCJJbk1lbW9yeUNhY2hlQWRhcHRlciIsIk51bGxDYWNoZUFkYXB0ZXIiLCJSZWRpc0NhY2hlQWRhcHRlciIsIkxSVUNhY2hlQWRhcHRlciIsIlB1c2hXb3JrZXIiLCJQYXJzZVNlcnZlciJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7O0lBQVlBLFM7O0FBQ1o7O0FBQ0E7O0FBQ0E7O0FBQ0E7Ozs7OztBQUVBO0FBQ0EsTUFBTUMsZUFBZSxVQUFTQyxPQUFULEVBQXNDO0FBQ3pELFFBQU1DLFNBQVMsMEJBQWdCRCxPQUFoQixDQUFmO0FBQ0EsU0FBT0MsT0FBT0MsR0FBZDtBQUNELENBSEQ7QUFJQTtBQUNBSCxhQUFhSSxxQkFBYixHQUFxQyxzQkFBWUEscUJBQWpEO0FBQ0FKLGFBQWFLLEtBQWIsR0FBcUIsc0JBQVlBLEtBQWpDOztBQUVBLE1BQU1DLGFBQWEsNkJBQVksWUFBWixFQUEwQiwwQkFBMUIsQ0FBbkI7O0FBRUFDLE9BQU9DLGNBQVAsQ0FBc0JDLE9BQU9DLE9BQTdCLEVBQXNDLFFBQXRDLEVBQWdEO0FBQzlDQztBQUQ4QyxDQUFoRDs7O1FBTUVDLFM7UUFDQU4sVSxHQUFBQSxVO1FBQ0FPLGlCO1FBQ0FDLG9CO1FBQ0FDLGdCO1FBQ0FDLGlCO1FBQ0FDLGU7UUFDQWxCLFMsR0FBQUEsUztRQUNBbUIsVTtRQUNnQkMsVyxHQUFoQm5CLFkiLCJmaWxlIjoiaW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgUGFyc2VTZXJ2ZXIgICAgICAgICAgZnJvbSAnLi9QYXJzZVNlcnZlcic7XG5pbXBvcnQgUzNBZGFwdGVyICAgICAgICAgICAgZnJvbSAnQHBhcnNlL3MzLWZpbGVzLWFkYXB0ZXInXG5pbXBvcnQgRmlsZVN5c3RlbUFkYXB0ZXIgICAgZnJvbSAnQHBhcnNlL2ZzLWZpbGVzLWFkYXB0ZXInXG5pbXBvcnQgSW5NZW1vcnlDYWNoZUFkYXB0ZXIgZnJvbSAnLi9BZGFwdGVycy9DYWNoZS9Jbk1lbW9yeUNhY2hlQWRhcHRlcidcbmltcG9ydCBOdWxsQ2FjaGVBZGFwdGVyICAgICBmcm9tICcuL0FkYXB0ZXJzL0NhY2hlL051bGxDYWNoZUFkYXB0ZXInXG5pbXBvcnQgUmVkaXNDYWNoZUFkYXB0ZXIgICAgZnJvbSAnLi9BZGFwdGVycy9DYWNoZS9SZWRpc0NhY2hlQWRhcHRlcidcbmltcG9ydCBMUlVDYWNoZUFkYXB0ZXIgICAgICBmcm9tICcuL0FkYXB0ZXJzL0NhY2hlL0xSVUNhY2hlLmpzJ1xuaW1wb3J0ICogYXMgVGVzdFV0aWxzICAgICAgIGZyb20gJy4vVGVzdFV0aWxzJztcbmltcG9ydCB7IHVzZUV4dGVybmFsIH0gICAgICBmcm9tICcuL2RlcHJlY2F0ZWQnO1xuaW1wb3J0IHsgZ2V0TG9nZ2VyIH0gICAgICAgIGZyb20gJy4vbG9nZ2VyJztcbmltcG9ydCB7IFB1c2hXb3JrZXIgfSAgICAgICBmcm9tICcuL1B1c2gvUHVzaFdvcmtlcic7XG5pbXBvcnQgeyBQYXJzZVNlcnZlck9wdGlvbnMgfSAgICBmcm9tICcuL09wdGlvbnMnO1xuXG4vLyBGYWN0b3J5IGZ1bmN0aW9uXG5jb25zdCBfUGFyc2VTZXJ2ZXIgPSBmdW5jdGlvbihvcHRpb25zOiBQYXJzZVNlcnZlck9wdGlvbnMpIHtcbiAgY29uc3Qgc2VydmVyID0gbmV3IFBhcnNlU2VydmVyKG9wdGlvbnMpO1xuICByZXR1cm4gc2VydmVyLmFwcDtcbn1cbi8vIE1vdW50IHRoZSBjcmVhdGUgbGl2ZVF1ZXJ5U2VydmVyXG5fUGFyc2VTZXJ2ZXIuY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyID0gUGFyc2VTZXJ2ZXIuY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyO1xuX1BhcnNlU2VydmVyLnN0YXJ0ID0gUGFyc2VTZXJ2ZXIuc3RhcnQ7XG5cbmNvbnN0IEdDU0FkYXB0ZXIgPSB1c2VFeHRlcm5hbCgnR0NTQWRhcHRlcicsICdAcGFyc2UvZ2NzLWZpbGVzLWFkYXB0ZXInKTtcblxuT2JqZWN0LmRlZmluZVByb3BlcnR5KG1vZHVsZS5leHBvcnRzLCAnbG9nZ2VyJywge1xuICBnZXQ6IGdldExvZ2dlclxufSk7XG5cbmV4cG9ydCBkZWZhdWx0IFBhcnNlU2VydmVyO1xuZXhwb3J0IHtcbiAgUzNBZGFwdGVyLFxuICBHQ1NBZGFwdGVyLFxuICBGaWxlU3lzdGVtQWRhcHRlcixcbiAgSW5NZW1vcnlDYWNoZUFkYXB0ZXIsXG4gIE51bGxDYWNoZUFkYXB0ZXIsXG4gIFJlZGlzQ2FjaGVBZGFwdGVyLFxuICBMUlVDYWNoZUFkYXB0ZXIsXG4gIFRlc3RVdGlscyxcbiAgUHVzaFdvcmtlcixcbiAgX1BhcnNlU2VydmVyIGFzIFBhcnNlU2VydmVyXG59O1xuIl19