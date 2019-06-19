'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.FilesController = undefined;

var _cryptoUtils = require('../cryptoUtils');

var _AdaptableController = require('./AdaptableController');

var _AdaptableController2 = _interopRequireDefault(_AdaptableController);

var _FilesAdapter = require('../Adapters/Files/FilesAdapter');

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _mime = require('mime');

var _mime2 = _interopRequireDefault(_mime);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const legacyFilesRegex = new RegExp("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-.*"); // FilesController.js
class FilesController extends _AdaptableController2.default {

  getFileData(config, filename) {
    return this.adapter.getFileData(filename);
  }

  createFile(config, filename, data, contentType) {

    const extname = _path2.default.extname(filename);

    const hasExtension = extname.length > 0;

    if (!hasExtension && contentType && _mime2.default.getExtension(contentType)) {
      filename = filename + '.' + _mime2.default.getExtension(contentType);
    } else if (hasExtension && !contentType) {
      contentType = _mime2.default.getType(filename);
    }

    if (!this.options.preserveFileName) {
      filename = (0, _cryptoUtils.randomHexString)(32) + '_' + filename;
    }

    const location = this.adapter.getFileLocation(config, filename);
    return this.adapter.createFile(filename, data, contentType).then(() => {
      return Promise.resolve({
        url: location,
        name: filename
      });
    });
  }

  deleteFile(config, filename) {
    return this.adapter.deleteFile(filename);
  }

  /**
   * Find file references in REST-format object and adds the url key
   * with the current mount point and app id.
   * Object may be a single object or list of REST-format objects.
   */
  expandFilesInObject(config, object) {
    if (object instanceof Array) {
      object.map(obj => this.expandFilesInObject(config, obj));
      return;
    }
    if (typeof object !== 'object') {
      return;
    }
    for (const key in object) {
      const fileObject = object[key];
      if (fileObject && fileObject['__type'] === 'File') {
        if (fileObject['url']) {
          continue;
        }
        const filename = fileObject['name'];
        // all filenames starting with "tfss-" should be from files.parsetfss.com
        // all filenames starting with a "-" seperated UUID should be from files.parse.com
        // all other filenames have been migrated or created from Parse Server
        if (config.fileKey === undefined) {
          fileObject['url'] = this.adapter.getFileLocation(config, filename);
        } else {
          if (filename.indexOf('tfss-') === 0) {
            fileObject['url'] = 'http://files.parsetfss.com/' + config.fileKey + '/' + encodeURIComponent(filename);
          } else if (legacyFilesRegex.test(filename)) {
            fileObject['url'] = 'http://files.parse.com/' + config.fileKey + '/' + encodeURIComponent(filename);
          } else {
            fileObject['url'] = this.adapter.getFileLocation(config, filename);
          }
        }
      }
    }
  }

  expectedAdapterType() {
    return _FilesAdapter.FilesAdapter;
  }

  getFileStream(config, filename) {
    return this.adapter.getFileStream(filename);
  }
}

exports.FilesController = FilesController;
exports.default = FilesController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9GaWxlc0NvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsibGVnYWN5RmlsZXNSZWdleCIsIlJlZ0V4cCIsIkZpbGVzQ29udHJvbGxlciIsImdldEZpbGVEYXRhIiwiY29uZmlnIiwiZmlsZW5hbWUiLCJhZGFwdGVyIiwiY3JlYXRlRmlsZSIsImRhdGEiLCJjb250ZW50VHlwZSIsImV4dG5hbWUiLCJoYXNFeHRlbnNpb24iLCJsZW5ndGgiLCJnZXRFeHRlbnNpb24iLCJnZXRUeXBlIiwib3B0aW9ucyIsInByZXNlcnZlRmlsZU5hbWUiLCJsb2NhdGlvbiIsImdldEZpbGVMb2NhdGlvbiIsInRoZW4iLCJQcm9taXNlIiwicmVzb2x2ZSIsInVybCIsIm5hbWUiLCJkZWxldGVGaWxlIiwiZXhwYW5kRmlsZXNJbk9iamVjdCIsIm9iamVjdCIsIkFycmF5IiwibWFwIiwib2JqIiwia2V5IiwiZmlsZU9iamVjdCIsImZpbGVLZXkiLCJ1bmRlZmluZWQiLCJpbmRleE9mIiwiZW5jb2RlVVJJQ29tcG9uZW50IiwidGVzdCIsImV4cGVjdGVkQWRhcHRlclR5cGUiLCJnZXRGaWxlU3RyZWFtIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQ0E7O0FBQ0E7Ozs7QUFDQTs7QUFDQTs7OztBQUNBOzs7Ozs7QUFFQSxNQUFNQSxtQkFBbUIsSUFBSUMsTUFBSixDQUFXLGlGQUFYLENBQXpCLEMsQ0FQQTtBQVNPLE1BQU1DLGVBQU4sdUNBQWtEOztBQUV2REMsY0FBWUMsTUFBWixFQUFvQkMsUUFBcEIsRUFBOEI7QUFDNUIsV0FBTyxLQUFLQyxPQUFMLENBQWFILFdBQWIsQ0FBeUJFLFFBQXpCLENBQVA7QUFDRDs7QUFFREUsYUFBV0gsTUFBWCxFQUFtQkMsUUFBbkIsRUFBNkJHLElBQTdCLEVBQW1DQyxXQUFuQyxFQUFnRDs7QUFFOUMsVUFBTUMsVUFBVSxlQUFLQSxPQUFMLENBQWFMLFFBQWIsQ0FBaEI7O0FBRUEsVUFBTU0sZUFBZUQsUUFBUUUsTUFBUixHQUFpQixDQUF0Qzs7QUFFQSxRQUFJLENBQUNELFlBQUQsSUFBaUJGLFdBQWpCLElBQWdDLGVBQUtJLFlBQUwsQ0FBa0JKLFdBQWxCLENBQXBDLEVBQW9FO0FBQ2xFSixpQkFBV0EsV0FBVyxHQUFYLEdBQWlCLGVBQUtRLFlBQUwsQ0FBa0JKLFdBQWxCLENBQTVCO0FBQ0QsS0FGRCxNQUVPLElBQUlFLGdCQUFnQixDQUFDRixXQUFyQixFQUFrQztBQUN2Q0Esb0JBQWMsZUFBS0ssT0FBTCxDQUFhVCxRQUFiLENBQWQ7QUFDRDs7QUFFRCxRQUFJLENBQUMsS0FBS1UsT0FBTCxDQUFhQyxnQkFBbEIsRUFBb0M7QUFDbENYLGlCQUFXLGtDQUFnQixFQUFoQixJQUFzQixHQUF0QixHQUE0QkEsUUFBdkM7QUFDRDs7QUFFRCxVQUFNWSxXQUFXLEtBQUtYLE9BQUwsQ0FBYVksZUFBYixDQUE2QmQsTUFBN0IsRUFBcUNDLFFBQXJDLENBQWpCO0FBQ0EsV0FBTyxLQUFLQyxPQUFMLENBQWFDLFVBQWIsQ0FBd0JGLFFBQXhCLEVBQWtDRyxJQUFsQyxFQUF3Q0MsV0FBeEMsRUFBcURVLElBQXJELENBQTBELE1BQU07QUFDckUsYUFBT0MsUUFBUUMsT0FBUixDQUFnQjtBQUNyQkMsYUFBS0wsUUFEZ0I7QUFFckJNLGNBQU1sQjtBQUZlLE9BQWhCLENBQVA7QUFJRCxLQUxNLENBQVA7QUFNRDs7QUFFRG1CLGFBQVdwQixNQUFYLEVBQW1CQyxRQUFuQixFQUE2QjtBQUMzQixXQUFPLEtBQUtDLE9BQUwsQ0FBYWtCLFVBQWIsQ0FBd0JuQixRQUF4QixDQUFQO0FBQ0Q7O0FBRUQ7Ozs7O0FBS0FvQixzQkFBb0JyQixNQUFwQixFQUE0QnNCLE1BQTVCLEVBQW9DO0FBQ2xDLFFBQUlBLGtCQUFrQkMsS0FBdEIsRUFBNkI7QUFDM0JELGFBQU9FLEdBQVAsQ0FBWUMsR0FBRCxJQUFTLEtBQUtKLG1CQUFMLENBQXlCckIsTUFBekIsRUFBaUN5QixHQUFqQyxDQUFwQjtBQUNBO0FBQ0Q7QUFDRCxRQUFJLE9BQU9ILE1BQVAsS0FBa0IsUUFBdEIsRUFBZ0M7QUFDOUI7QUFDRDtBQUNELFNBQUssTUFBTUksR0FBWCxJQUFrQkosTUFBbEIsRUFBMEI7QUFDeEIsWUFBTUssYUFBYUwsT0FBT0ksR0FBUCxDQUFuQjtBQUNBLFVBQUlDLGNBQWNBLFdBQVcsUUFBWCxNQUF5QixNQUEzQyxFQUFtRDtBQUNqRCxZQUFJQSxXQUFXLEtBQVgsQ0FBSixFQUF1QjtBQUNyQjtBQUNEO0FBQ0QsY0FBTTFCLFdBQVcwQixXQUFXLE1BQVgsQ0FBakI7QUFDQTtBQUNBO0FBQ0E7QUFDQSxZQUFJM0IsT0FBTzRCLE9BQVAsS0FBbUJDLFNBQXZCLEVBQWtDO0FBQ2hDRixxQkFBVyxLQUFYLElBQW9CLEtBQUt6QixPQUFMLENBQWFZLGVBQWIsQ0FBNkJkLE1BQTdCLEVBQXFDQyxRQUFyQyxDQUFwQjtBQUNELFNBRkQsTUFFTztBQUNMLGNBQUlBLFNBQVM2QixPQUFULENBQWlCLE9BQWpCLE1BQThCLENBQWxDLEVBQXFDO0FBQ25DSCx1QkFBVyxLQUFYLElBQW9CLGdDQUFnQzNCLE9BQU80QixPQUF2QyxHQUFpRCxHQUFqRCxHQUF1REcsbUJBQW1COUIsUUFBbkIsQ0FBM0U7QUFDRCxXQUZELE1BRU8sSUFBSUwsaUJBQWlCb0MsSUFBakIsQ0FBc0IvQixRQUF0QixDQUFKLEVBQXFDO0FBQzFDMEIsdUJBQVcsS0FBWCxJQUFvQiw0QkFBNEIzQixPQUFPNEIsT0FBbkMsR0FBNkMsR0FBN0MsR0FBbURHLG1CQUFtQjlCLFFBQW5CLENBQXZFO0FBQ0QsV0FGTSxNQUVBO0FBQ0wwQix1QkFBVyxLQUFYLElBQW9CLEtBQUt6QixPQUFMLENBQWFZLGVBQWIsQ0FBNkJkLE1BQTdCLEVBQXFDQyxRQUFyQyxDQUFwQjtBQUNEO0FBQ0Y7QUFDRjtBQUNGO0FBQ0Y7O0FBRURnQyx3QkFBc0I7QUFDcEI7QUFDRDs7QUFFREMsZ0JBQWNsQyxNQUFkLEVBQXNCQyxRQUF0QixFQUFnQztBQUM5QixXQUFPLEtBQUtDLE9BQUwsQ0FBYWdDLGFBQWIsQ0FBMkJqQyxRQUEzQixDQUFQO0FBQ0Q7QUEvRXNEOztRQUE1Q0gsZSxHQUFBQSxlO2tCQWtGRUEsZSIsImZpbGUiOiJGaWxlc0NvbnRyb2xsZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBGaWxlc0NvbnRyb2xsZXIuanNcbmltcG9ydCB7IHJhbmRvbUhleFN0cmluZyB9IGZyb20gJy4uL2NyeXB0b1V0aWxzJztcbmltcG9ydCBBZGFwdGFibGVDb250cm9sbGVyIGZyb20gJy4vQWRhcHRhYmxlQ29udHJvbGxlcic7XG5pbXBvcnQgeyBGaWxlc0FkYXB0ZXIgfSBmcm9tICcuLi9BZGFwdGVycy9GaWxlcy9GaWxlc0FkYXB0ZXInO1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgbWltZSBmcm9tICdtaW1lJztcblxuY29uc3QgbGVnYWN5RmlsZXNSZWdleCA9IG5ldyBSZWdFeHAoXCJeWzAtOWEtZkEtRl17OH0tWzAtOWEtZkEtRl17NH0tWzAtOWEtZkEtRl17NH0tWzAtOWEtZkEtRl17NH0tWzAtOWEtZkEtRl17MTJ9LS4qXCIpO1xuXG5leHBvcnQgY2xhc3MgRmlsZXNDb250cm9sbGVyIGV4dGVuZHMgQWRhcHRhYmxlQ29udHJvbGxlciB7XG5cbiAgZ2V0RmlsZURhdGEoY29uZmlnLCBmaWxlbmFtZSkge1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZ2V0RmlsZURhdGEoZmlsZW5hbWUpO1xuICB9XG5cbiAgY3JlYXRlRmlsZShjb25maWcsIGZpbGVuYW1lLCBkYXRhLCBjb250ZW50VHlwZSkge1xuXG4gICAgY29uc3QgZXh0bmFtZSA9IHBhdGguZXh0bmFtZShmaWxlbmFtZSk7XG5cbiAgICBjb25zdCBoYXNFeHRlbnNpb24gPSBleHRuYW1lLmxlbmd0aCA+IDA7XG5cbiAgICBpZiAoIWhhc0V4dGVuc2lvbiAmJiBjb250ZW50VHlwZSAmJiBtaW1lLmdldEV4dGVuc2lvbihjb250ZW50VHlwZSkpIHtcbiAgICAgIGZpbGVuYW1lID0gZmlsZW5hbWUgKyAnLicgKyBtaW1lLmdldEV4dGVuc2lvbihjb250ZW50VHlwZSk7XG4gICAgfSBlbHNlIGlmIChoYXNFeHRlbnNpb24gJiYgIWNvbnRlbnRUeXBlKSB7XG4gICAgICBjb250ZW50VHlwZSA9IG1pbWUuZ2V0VHlwZShmaWxlbmFtZSk7XG4gICAgfVxuXG4gICAgaWYgKCF0aGlzLm9wdGlvbnMucHJlc2VydmVGaWxlTmFtZSkge1xuICAgICAgZmlsZW5hbWUgPSByYW5kb21IZXhTdHJpbmcoMzIpICsgJ18nICsgZmlsZW5hbWU7XG4gICAgfVxuXG4gICAgY29uc3QgbG9jYXRpb24gPSB0aGlzLmFkYXB0ZXIuZ2V0RmlsZUxvY2F0aW9uKGNvbmZpZywgZmlsZW5hbWUpO1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuY3JlYXRlRmlsZShmaWxlbmFtZSwgZGF0YSwgY29udGVudFR5cGUpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICAgIHVybDogbG9jYXRpb24sXG4gICAgICAgIG5hbWU6IGZpbGVuYW1lXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIGRlbGV0ZUZpbGUoY29uZmlnLCBmaWxlbmFtZSkge1xuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZGVsZXRlRmlsZShmaWxlbmFtZSk7XG4gIH1cblxuICAvKipcbiAgICogRmluZCBmaWxlIHJlZmVyZW5jZXMgaW4gUkVTVC1mb3JtYXQgb2JqZWN0IGFuZCBhZGRzIHRoZSB1cmwga2V5XG4gICAqIHdpdGggdGhlIGN1cnJlbnQgbW91bnQgcG9pbnQgYW5kIGFwcCBpZC5cbiAgICogT2JqZWN0IG1heSBiZSBhIHNpbmdsZSBvYmplY3Qgb3IgbGlzdCBvZiBSRVNULWZvcm1hdCBvYmplY3RzLlxuICAgKi9cbiAgZXhwYW5kRmlsZXNJbk9iamVjdChjb25maWcsIG9iamVjdCkge1xuICAgIGlmIChvYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgb2JqZWN0Lm1hcCgob2JqKSA9PiB0aGlzLmV4cGFuZEZpbGVzSW5PYmplY3QoY29uZmlnLCBvYmopKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgICAgY29uc3QgZmlsZU9iamVjdCA9IG9iamVjdFtrZXldO1xuICAgICAgaWYgKGZpbGVPYmplY3QgJiYgZmlsZU9iamVjdFsnX190eXBlJ10gPT09ICdGaWxlJykge1xuICAgICAgICBpZiAoZmlsZU9iamVjdFsndXJsJ10pIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBmaWxlbmFtZSA9IGZpbGVPYmplY3RbJ25hbWUnXTtcbiAgICAgICAgLy8gYWxsIGZpbGVuYW1lcyBzdGFydGluZyB3aXRoIFwidGZzcy1cIiBzaG91bGQgYmUgZnJvbSBmaWxlcy5wYXJzZXRmc3MuY29tXG4gICAgICAgIC8vIGFsbCBmaWxlbmFtZXMgc3RhcnRpbmcgd2l0aCBhIFwiLVwiIHNlcGVyYXRlZCBVVUlEIHNob3VsZCBiZSBmcm9tIGZpbGVzLnBhcnNlLmNvbVxuICAgICAgICAvLyBhbGwgb3RoZXIgZmlsZW5hbWVzIGhhdmUgYmVlbiBtaWdyYXRlZCBvciBjcmVhdGVkIGZyb20gUGFyc2UgU2VydmVyXG4gICAgICAgIGlmIChjb25maWcuZmlsZUtleSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgZmlsZU9iamVjdFsndXJsJ10gPSB0aGlzLmFkYXB0ZXIuZ2V0RmlsZUxvY2F0aW9uKGNvbmZpZywgZmlsZW5hbWUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChmaWxlbmFtZS5pbmRleE9mKCd0ZnNzLScpID09PSAwKSB7XG4gICAgICAgICAgICBmaWxlT2JqZWN0Wyd1cmwnXSA9ICdodHRwOi8vZmlsZXMucGFyc2V0ZnNzLmNvbS8nICsgY29uZmlnLmZpbGVLZXkgKyAnLycgKyBlbmNvZGVVUklDb21wb25lbnQoZmlsZW5hbWUpO1xuICAgICAgICAgIH0gZWxzZSBpZiAobGVnYWN5RmlsZXNSZWdleC50ZXN0KGZpbGVuYW1lKSkge1xuICAgICAgICAgICAgZmlsZU9iamVjdFsndXJsJ10gPSAnaHR0cDovL2ZpbGVzLnBhcnNlLmNvbS8nICsgY29uZmlnLmZpbGVLZXkgKyAnLycgKyBlbmNvZGVVUklDb21wb25lbnQoZmlsZW5hbWUpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmaWxlT2JqZWN0Wyd1cmwnXSA9IHRoaXMuYWRhcHRlci5nZXRGaWxlTG9jYXRpb24oY29uZmlnLCBmaWxlbmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZXhwZWN0ZWRBZGFwdGVyVHlwZSgpIHtcbiAgICByZXR1cm4gRmlsZXNBZGFwdGVyO1xuICB9XG5cbiAgZ2V0RmlsZVN0cmVhbShjb25maWcsIGZpbGVuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5nZXRGaWxlU3RyZWFtKGZpbGVuYW1lKTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBGaWxlc0NvbnRyb2xsZXI7XG4iXX0=