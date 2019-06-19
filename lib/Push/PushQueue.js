'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PushQueue = undefined;

var _ParseMessageQueue = require('../ParseMessageQueue');

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _utils = require('./utils');

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const PUSH_CHANNEL = 'parse-server-push';
const DEFAULT_BATCH_SIZE = 100;

class PushQueue {

  // config object of the publisher, right now it only contains the redisURL,
  // but we may extend it later.
  constructor(config = {}) {
    this.channel = config.channel || PushQueue.defaultPushChannel();
    this.batchSize = config.batchSize || DEFAULT_BATCH_SIZE;
    this.parsePublisher = _ParseMessageQueue.ParseMessageQueue.createPublisher(config);
  }

  static defaultPushChannel() {
    return `${_node2.default.applicationId}-${PUSH_CHANNEL}`;
  }

  enqueue(body, where, config, auth, pushStatus) {
    const limit = this.batchSize;

    where = (0, _utils.applyDeviceTokenExists)(where);

    // Order by objectId so no impact on the DB
    const order = 'objectId';
    return Promise.resolve().then(() => {
      return _rest2.default.find(config, auth, '_Installation', where, { limit: 0, count: true });
    }).then(({ results, count }) => {
      if (!results || count == 0) {
        return pushStatus.complete();
      }
      pushStatus.setRunning(Math.ceil(count / limit));
      let skip = 0;
      while (skip < count) {
        const query = { where,
          limit,
          skip,
          order };

        const pushWorkItem = {
          body,
          query,
          pushStatus: { objectId: pushStatus.objectId },
          applicationId: config.applicationId
        };
        this.parsePublisher.publish(this.channel, JSON.stringify(pushWorkItem));
        skip += limit;
      }
    });
  }
}
exports.PushQueue = PushQueue;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9QdXNoL1B1c2hRdWV1ZS5qcyJdLCJuYW1lcyI6WyJQVVNIX0NIQU5ORUwiLCJERUZBVUxUX0JBVENIX1NJWkUiLCJQdXNoUXVldWUiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImNoYW5uZWwiLCJkZWZhdWx0UHVzaENoYW5uZWwiLCJiYXRjaFNpemUiLCJwYXJzZVB1Ymxpc2hlciIsImNyZWF0ZVB1Ymxpc2hlciIsImFwcGxpY2F0aW9uSWQiLCJlbnF1ZXVlIiwiYm9keSIsIndoZXJlIiwiYXV0aCIsInB1c2hTdGF0dXMiLCJsaW1pdCIsIm9yZGVyIiwiUHJvbWlzZSIsInJlc29sdmUiLCJ0aGVuIiwiZmluZCIsImNvdW50IiwicmVzdWx0cyIsImNvbXBsZXRlIiwic2V0UnVubmluZyIsIk1hdGgiLCJjZWlsIiwic2tpcCIsInF1ZXJ5IiwicHVzaFdvcmtJdGVtIiwib2JqZWN0SWQiLCJwdWJsaXNoIiwiSlNPTiIsInN0cmluZ2lmeSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUFBOztBQUNBOzs7O0FBQ0E7O0FBQ0E7Ozs7OztBQUVBLE1BQU1BLGVBQWUsbUJBQXJCO0FBQ0EsTUFBTUMscUJBQXFCLEdBQTNCOztBQUVPLE1BQU1DLFNBQU4sQ0FBZ0I7O0FBS3JCO0FBQ0E7QUFDQUMsY0FBWUMsU0FBYyxFQUExQixFQUE4QjtBQUM1QixTQUFLQyxPQUFMLEdBQWVELE9BQU9DLE9BQVAsSUFBa0JILFVBQVVJLGtCQUFWLEVBQWpDO0FBQ0EsU0FBS0MsU0FBTCxHQUFpQkgsT0FBT0csU0FBUCxJQUFvQk4sa0JBQXJDO0FBQ0EsU0FBS08sY0FBTCxHQUFzQixxQ0FBa0JDLGVBQWxCLENBQWtDTCxNQUFsQyxDQUF0QjtBQUNEOztBQUVELFNBQU9FLGtCQUFQLEdBQTRCO0FBQzFCLFdBQVEsR0FBRSxlQUFNSSxhQUFjLElBQUdWLFlBQWEsRUFBOUM7QUFDRDs7QUFFRFcsVUFBUUMsSUFBUixFQUFjQyxLQUFkLEVBQXFCVCxNQUFyQixFQUE2QlUsSUFBN0IsRUFBbUNDLFVBQW5DLEVBQStDO0FBQzdDLFVBQU1DLFFBQVEsS0FBS1QsU0FBbkI7O0FBRUFNLFlBQVEsbUNBQXVCQSxLQUF2QixDQUFSOztBQUVBO0FBQ0EsVUFBTUksUUFBUSxVQUFkO0FBQ0EsV0FBT0MsUUFBUUMsT0FBUixHQUFrQkMsSUFBbEIsQ0FBdUIsTUFBTTtBQUNsQyxhQUFPLGVBQUtDLElBQUwsQ0FBVWpCLE1BQVYsRUFDTFUsSUFESyxFQUVMLGVBRkssRUFHTEQsS0FISyxFQUlMLEVBQUNHLE9BQU8sQ0FBUixFQUFXTSxPQUFPLElBQWxCLEVBSkssQ0FBUDtBQUtELEtBTk0sRUFNSkYsSUFOSSxDQU1DLENBQUMsRUFBQ0csT0FBRCxFQUFVRCxLQUFWLEVBQUQsS0FBc0I7QUFDNUIsVUFBSSxDQUFDQyxPQUFELElBQVlELFNBQVMsQ0FBekIsRUFBNEI7QUFDMUIsZUFBT1AsV0FBV1MsUUFBWCxFQUFQO0FBQ0Q7QUFDRFQsaUJBQVdVLFVBQVgsQ0FBc0JDLEtBQUtDLElBQUwsQ0FBVUwsUUFBUU4sS0FBbEIsQ0FBdEI7QUFDQSxVQUFJWSxPQUFPLENBQVg7QUFDQSxhQUFPQSxPQUFPTixLQUFkLEVBQXFCO0FBQ25CLGNBQU1PLFFBQVEsRUFBRWhCLEtBQUY7QUFDWkcsZUFEWTtBQUVaWSxjQUZZO0FBR1pYLGVBSFksRUFBZDs7QUFLQSxjQUFNYSxlQUFlO0FBQ25CbEIsY0FEbUI7QUFFbkJpQixlQUZtQjtBQUduQmQsc0JBQVksRUFBRWdCLFVBQVVoQixXQUFXZ0IsUUFBdkIsRUFITztBQUluQnJCLHlCQUFlTixPQUFPTTtBQUpILFNBQXJCO0FBTUEsYUFBS0YsY0FBTCxDQUFvQndCLE9BQXBCLENBQTRCLEtBQUszQixPQUFqQyxFQUEwQzRCLEtBQUtDLFNBQUwsQ0FBZUosWUFBZixDQUExQztBQUNBRixnQkFBUVosS0FBUjtBQUNEO0FBQ0YsS0EzQk0sQ0FBUDtBQTRCRDtBQXBEb0I7UUFBVmQsUyxHQUFBQSxTIiwiZmlsZSI6IlB1c2hRdWV1ZS5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFBhcnNlTWVzc2FnZVF1ZXVlIH0gICAgICBmcm9tICcuLi9QYXJzZU1lc3NhZ2VRdWV1ZSc7XG5pbXBvcnQgcmVzdCAgICAgICAgICAgICAgICAgICAgICAgZnJvbSAnLi4vcmVzdCc7XG5pbXBvcnQgeyBhcHBseURldmljZVRva2VuRXhpc3RzIH0gZnJvbSAnLi91dGlscyc7XG5pbXBvcnQgUGFyc2UgZnJvbSAncGFyc2Uvbm9kZSc7XG5cbmNvbnN0IFBVU0hfQ0hBTk5FTCA9ICdwYXJzZS1zZXJ2ZXItcHVzaCc7XG5jb25zdCBERUZBVUxUX0JBVENIX1NJWkUgPSAxMDA7XG5cbmV4cG9ydCBjbGFzcyBQdXNoUXVldWUge1xuICBwYXJzZVB1Ymxpc2hlcjogT2JqZWN0O1xuICBjaGFubmVsOiBTdHJpbmc7XG4gIGJhdGNoU2l6ZTogTnVtYmVyO1xuXG4gIC8vIGNvbmZpZyBvYmplY3Qgb2YgdGhlIHB1Ymxpc2hlciwgcmlnaHQgbm93IGl0IG9ubHkgY29udGFpbnMgdGhlIHJlZGlzVVJMLFxuICAvLyBidXQgd2UgbWF5IGV4dGVuZCBpdCBsYXRlci5cbiAgY29uc3RydWN0b3IoY29uZmlnOiBhbnkgPSB7fSkge1xuICAgIHRoaXMuY2hhbm5lbCA9IGNvbmZpZy5jaGFubmVsIHx8IFB1c2hRdWV1ZS5kZWZhdWx0UHVzaENoYW5uZWwoKTtcbiAgICB0aGlzLmJhdGNoU2l6ZSA9IGNvbmZpZy5iYXRjaFNpemUgfHwgREVGQVVMVF9CQVRDSF9TSVpFO1xuICAgIHRoaXMucGFyc2VQdWJsaXNoZXIgPSBQYXJzZU1lc3NhZ2VRdWV1ZS5jcmVhdGVQdWJsaXNoZXIoY29uZmlnKTtcbiAgfVxuXG4gIHN0YXRpYyBkZWZhdWx0UHVzaENoYW5uZWwoKSB7XG4gICAgcmV0dXJuIGAke1BhcnNlLmFwcGxpY2F0aW9uSWR9LSR7UFVTSF9DSEFOTkVMfWA7XG4gIH1cblxuICBlbnF1ZXVlKGJvZHksIHdoZXJlLCBjb25maWcsIGF1dGgsIHB1c2hTdGF0dXMpIHtcbiAgICBjb25zdCBsaW1pdCA9IHRoaXMuYmF0Y2hTaXplO1xuXG4gICAgd2hlcmUgPSBhcHBseURldmljZVRva2VuRXhpc3RzKHdoZXJlKTtcblxuICAgIC8vIE9yZGVyIGJ5IG9iamVjdElkIHNvIG5vIGltcGFjdCBvbiB0aGUgREJcbiAgICBjb25zdCBvcmRlciA9ICdvYmplY3RJZCc7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHJlc3QuZmluZChjb25maWcsXG4gICAgICAgIGF1dGgsXG4gICAgICAgICdfSW5zdGFsbGF0aW9uJyxcbiAgICAgICAgd2hlcmUsXG4gICAgICAgIHtsaW1pdDogMCwgY291bnQ6IHRydWV9KTtcbiAgICB9KS50aGVuKCh7cmVzdWx0cywgY291bnR9KSA9PiB7XG4gICAgICBpZiAoIXJlc3VsdHMgfHwgY291bnQgPT0gMCkge1xuICAgICAgICByZXR1cm4gcHVzaFN0YXR1cy5jb21wbGV0ZSgpO1xuICAgICAgfVxuICAgICAgcHVzaFN0YXR1cy5zZXRSdW5uaW5nKE1hdGguY2VpbChjb3VudCAvIGxpbWl0KSk7XG4gICAgICBsZXQgc2tpcCA9IDA7XG4gICAgICB3aGlsZSAoc2tpcCA8IGNvdW50KSB7XG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0geyB3aGVyZSxcbiAgICAgICAgICBsaW1pdCxcbiAgICAgICAgICBza2lwLFxuICAgICAgICAgIG9yZGVyIH07XG5cbiAgICAgICAgY29uc3QgcHVzaFdvcmtJdGVtID0ge1xuICAgICAgICAgIGJvZHksXG4gICAgICAgICAgcXVlcnksXG4gICAgICAgICAgcHVzaFN0YXR1czogeyBvYmplY3RJZDogcHVzaFN0YXR1cy5vYmplY3RJZCB9LFxuICAgICAgICAgIGFwcGxpY2F0aW9uSWQ6IGNvbmZpZy5hcHBsaWNhdGlvbklkXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5wYXJzZVB1Ymxpc2hlci5wdWJsaXNoKHRoaXMuY2hhbm5lbCwgSlNPTi5zdHJpbmdpZnkocHVzaFdvcmtJdGVtKSk7XG4gICAgICAgIHNraXAgKz0gbGltaXQ7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==