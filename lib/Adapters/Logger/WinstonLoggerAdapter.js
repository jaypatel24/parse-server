'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.WinstonLoggerAdapter = undefined;

var _LoggerAdapter = require('./LoggerAdapter');

var _WinstonLogger = require('./WinstonLogger');

const MILLISECONDS_IN_A_DAY = 24 * 60 * 60 * 1000;

class WinstonLoggerAdapter extends _LoggerAdapter.LoggerAdapter {
  constructor(options) {
    super();
    if (options) {
      (0, _WinstonLogger.configureLogger)(options);
    }
  }

  log() {
    return _WinstonLogger.logger.log.apply(_WinstonLogger.logger, arguments);
  }

  addTransport(transport) {
    // Note that this is calling addTransport
    // from logger.  See import - confusing.
    // but this is not recursive.
    (0, _WinstonLogger.addTransport)(transport);
  }

  // custom query as winston is currently limited
  query(options, callback = () => {}) {
    if (!options) {
      options = {};
    }
    // defaults to 7 days prior
    const from = options.from || new Date(Date.now() - 7 * MILLISECONDS_IN_A_DAY);
    const until = options.until || new Date();
    const limit = options.size || 10;
    const order = options.order || 'desc';
    const level = options.level || 'info';

    const queryOptions = {
      from,
      until,
      limit,
      order
    };

    return new Promise((resolve, reject) => {
      _WinstonLogger.logger.query(queryOptions, (err, res) => {
        if (err) {
          callback(err);
          return reject(err);
        }
        if (level == 'error') {
          callback(res['parse-server-error']);
          resolve(res['parse-server-error']);
        } else {
          callback(res['parse-server']);
          resolve(res['parse-server']);
        }
      });
    });
  }
}

exports.WinstonLoggerAdapter = WinstonLoggerAdapter;
exports.default = WinstonLoggerAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9BZGFwdGVycy9Mb2dnZXIvV2luc3RvbkxvZ2dlckFkYXB0ZXIuanMiXSwibmFtZXMiOlsiTUlMTElTRUNPTkRTX0lOX0FfREFZIiwiV2luc3RvbkxvZ2dlckFkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsIm9wdGlvbnMiLCJsb2ciLCJhcHBseSIsImFyZ3VtZW50cyIsImFkZFRyYW5zcG9ydCIsInRyYW5zcG9ydCIsInF1ZXJ5IiwiY2FsbGJhY2siLCJmcm9tIiwiRGF0ZSIsIm5vdyIsInVudGlsIiwibGltaXQiLCJzaXplIiwib3JkZXIiLCJsZXZlbCIsInF1ZXJ5T3B0aW9ucyIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVqZWN0IiwiZXJyIiwicmVzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7O0FBQ0E7O0FBRUEsTUFBTUEsd0JBQXdCLEtBQUssRUFBTCxHQUFVLEVBQVYsR0FBZSxJQUE3Qzs7QUFFTyxNQUFNQyxvQkFBTixzQ0FBaUQ7QUFDdERDLGNBQVlDLE9BQVosRUFBcUI7QUFDbkI7QUFDQSxRQUFJQSxPQUFKLEVBQWE7QUFDWCwwQ0FBZ0JBLE9BQWhCO0FBQ0Q7QUFDRjs7QUFFREMsUUFBTTtBQUNKLFdBQU8sc0JBQU9BLEdBQVAsQ0FBV0MsS0FBWCx3QkFBeUJDLFNBQXpCLENBQVA7QUFDRDs7QUFFREMsZUFBYUMsU0FBYixFQUF3QjtBQUN0QjtBQUNBO0FBQ0E7QUFDQSxxQ0FBYUEsU0FBYjtBQUNEOztBQUVEO0FBQ0FDLFFBQU1OLE9BQU4sRUFBZU8sV0FBVyxNQUFNLENBQUUsQ0FBbEMsRUFBb0M7QUFDbEMsUUFBSSxDQUFDUCxPQUFMLEVBQWM7QUFDWkEsZ0JBQVUsRUFBVjtBQUNEO0FBQ0Q7QUFDQSxVQUFNUSxPQUFPUixRQUFRUSxJQUFSLElBQWdCLElBQUlDLElBQUosQ0FBU0EsS0FBS0MsR0FBTCxLQUFjLElBQUliLHFCQUEzQixDQUE3QjtBQUNBLFVBQU1jLFFBQVFYLFFBQVFXLEtBQVIsSUFBaUIsSUFBSUYsSUFBSixFQUEvQjtBQUNBLFVBQU1HLFFBQVFaLFFBQVFhLElBQVIsSUFBZ0IsRUFBOUI7QUFDQSxVQUFNQyxRQUFRZCxRQUFRYyxLQUFSLElBQWlCLE1BQS9CO0FBQ0EsVUFBTUMsUUFBUWYsUUFBUWUsS0FBUixJQUFpQixNQUEvQjs7QUFFQSxVQUFNQyxlQUFlO0FBQ25CUixVQURtQjtBQUVuQkcsV0FGbUI7QUFHbkJDLFdBSG1CO0FBSW5CRTtBQUptQixLQUFyQjs7QUFPQSxXQUFPLElBQUlHLE9BQUosQ0FBWSxDQUFDQyxPQUFELEVBQVVDLE1BQVYsS0FBcUI7QUFDdEMsNEJBQU9iLEtBQVAsQ0FBYVUsWUFBYixFQUEyQixDQUFDSSxHQUFELEVBQU1DLEdBQU4sS0FBYztBQUN2QyxZQUFJRCxHQUFKLEVBQVM7QUFDUGIsbUJBQVNhLEdBQVQ7QUFDQSxpQkFBT0QsT0FBT0MsR0FBUCxDQUFQO0FBQ0Q7QUFDRCxZQUFJTCxTQUFTLE9BQWIsRUFBc0I7QUFDcEJSLG1CQUFTYyxJQUFJLG9CQUFKLENBQVQ7QUFDQUgsa0JBQVFHLElBQUksb0JBQUosQ0FBUjtBQUNELFNBSEQsTUFHTztBQUNMZCxtQkFBU2MsSUFBSSxjQUFKLENBQVQ7QUFDQUgsa0JBQVFHLElBQUksY0FBSixDQUFSO0FBQ0Q7QUFDRixPQVpEO0FBYUQsS0FkTSxDQUFQO0FBZUQ7QUFyRHFEOztRQUEzQ3ZCLG9CLEdBQUFBLG9CO2tCQXdERUEsb0IiLCJmaWxlIjoiV2luc3RvbkxvZ2dlckFkYXB0ZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgeyBMb2dnZXJBZGFwdGVyIH0gZnJvbSAnLi9Mb2dnZXJBZGFwdGVyJztcbmltcG9ydCB7IGxvZ2dlciwgYWRkVHJhbnNwb3J0LCBjb25maWd1cmVMb2dnZXIgfSBmcm9tICcuL1dpbnN0b25Mb2dnZXInO1xuXG5jb25zdCBNSUxMSVNFQ09ORFNfSU5fQV9EQVkgPSAyNCAqIDYwICogNjAgKiAxMDAwO1xuXG5leHBvcnQgY2xhc3MgV2luc3RvbkxvZ2dlckFkYXB0ZXIgZXh0ZW5kcyBMb2dnZXJBZGFwdGVyIHtcbiAgY29uc3RydWN0b3Iob3B0aW9ucykge1xuICAgIHN1cGVyKCk7XG4gICAgaWYgKG9wdGlvbnMpIHtcbiAgICAgIGNvbmZpZ3VyZUxvZ2dlcihvcHRpb25zKTtcbiAgICB9XG4gIH1cblxuICBsb2coKSB7XG4gICAgcmV0dXJuIGxvZ2dlci5sb2cuYXBwbHkobG9nZ2VyLCBhcmd1bWVudHMpO1xuICB9XG5cbiAgYWRkVHJhbnNwb3J0KHRyYW5zcG9ydCkge1xuICAgIC8vIE5vdGUgdGhhdCB0aGlzIGlzIGNhbGxpbmcgYWRkVHJhbnNwb3J0XG4gICAgLy8gZnJvbSBsb2dnZXIuICBTZWUgaW1wb3J0IC0gY29uZnVzaW5nLlxuICAgIC8vIGJ1dCB0aGlzIGlzIG5vdCByZWN1cnNpdmUuXG4gICAgYWRkVHJhbnNwb3J0KHRyYW5zcG9ydCk7XG4gIH1cblxuICAvLyBjdXN0b20gcXVlcnkgYXMgd2luc3RvbiBpcyBjdXJyZW50bHkgbGltaXRlZFxuICBxdWVyeShvcHRpb25zLCBjYWxsYmFjayA9ICgpID0+IHt9KSB7XG4gICAgaWYgKCFvcHRpb25zKSB7XG4gICAgICBvcHRpb25zID0ge307XG4gICAgfVxuICAgIC8vIGRlZmF1bHRzIHRvIDcgZGF5cyBwcmlvclxuICAgIGNvbnN0IGZyb20gPSBvcHRpb25zLmZyb20gfHwgbmV3IERhdGUoRGF0ZS5ub3coKSAtICg3ICogTUlMTElTRUNPTkRTX0lOX0FfREFZKSk7XG4gICAgY29uc3QgdW50aWwgPSBvcHRpb25zLnVudGlsIHx8IG5ldyBEYXRlKCk7XG4gICAgY29uc3QgbGltaXQgPSBvcHRpb25zLnNpemUgfHwgMTA7XG4gICAgY29uc3Qgb3JkZXIgPSBvcHRpb25zLm9yZGVyIHx8ICdkZXNjJztcbiAgICBjb25zdCBsZXZlbCA9IG9wdGlvbnMubGV2ZWwgfHwgJ2luZm8nO1xuXG4gICAgY29uc3QgcXVlcnlPcHRpb25zID0ge1xuICAgICAgZnJvbSxcbiAgICAgIHVudGlsLFxuICAgICAgbGltaXQsXG4gICAgICBvcmRlclxuICAgIH07XG5cbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgbG9nZ2VyLnF1ZXJ5KHF1ZXJ5T3B0aW9ucywgKGVyciwgcmVzKSA9PiB7XG4gICAgICAgIGlmIChlcnIpIHtcbiAgICAgICAgICBjYWxsYmFjayhlcnIpO1xuICAgICAgICAgIHJldHVybiByZWplY3QoZXJyKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAobGV2ZWwgPT0gJ2Vycm9yJykge1xuICAgICAgICAgIGNhbGxiYWNrKHJlc1sncGFyc2Utc2VydmVyLWVycm9yJ10pO1xuICAgICAgICAgIHJlc29sdmUocmVzWydwYXJzZS1zZXJ2ZXItZXJyb3InXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2FsbGJhY2socmVzWydwYXJzZS1zZXJ2ZXInXSk7XG4gICAgICAgICAgcmVzb2x2ZShyZXNbJ3BhcnNlLXNlcnZlciddKTtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBXaW5zdG9uTG9nZ2VyQWRhcHRlcjtcbiJdfQ==