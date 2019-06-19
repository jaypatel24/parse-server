'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.ParseWebSocket = exports.ParseWebSocketServer = undefined;

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const typeMap = new Map([['disconnect', 'close']]);
const getWS = function () {
  try {
    return require('uws');
  } catch (e) {
    return require('ws');
  }
};

class ParseWebSocketServer {

  constructor(server, onConnect, websocketTimeout = 10 * 1000) {
    const WebSocketServer = getWS().Server;
    const wss = new WebSocketServer({ server: server });
    wss.on('listening', () => {
      _logger2.default.info('Parse LiveQuery Server starts running');
    });
    wss.on('connection', ws => {
      onConnect(new ParseWebSocket(ws));
      // Send ping to client periodically
      const pingIntervalId = setInterval(() => {
        if (ws.readyState == ws.OPEN) {
          ws.ping();
        } else {
          clearInterval(pingIntervalId);
        }
      }, websocketTimeout);
    });
    this.server = wss;
  }
}

exports.ParseWebSocketServer = ParseWebSocketServer;
class ParseWebSocket {

  constructor(ws) {
    this.ws = ws;
  }

  on(type, callback) {
    const wsType = typeMap.has(type) ? typeMap.get(type) : type;
    this.ws.on(wsType, callback);
  }

  send(message) {
    this.ws.send(message);
  }
}
exports.ParseWebSocket = ParseWebSocket;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9MaXZlUXVlcnkvUGFyc2VXZWJTb2NrZXRTZXJ2ZXIuanMiXSwibmFtZXMiOlsidHlwZU1hcCIsIk1hcCIsImdldFdTIiwicmVxdWlyZSIsImUiLCJQYXJzZVdlYlNvY2tldFNlcnZlciIsImNvbnN0cnVjdG9yIiwic2VydmVyIiwib25Db25uZWN0Iiwid2Vic29ja2V0VGltZW91dCIsIldlYlNvY2tldFNlcnZlciIsIlNlcnZlciIsIndzcyIsIm9uIiwiaW5mbyIsIndzIiwiUGFyc2VXZWJTb2NrZXQiLCJwaW5nSW50ZXJ2YWxJZCIsInNldEludGVydmFsIiwicmVhZHlTdGF0ZSIsIk9QRU4iLCJwaW5nIiwiY2xlYXJJbnRlcnZhbCIsInR5cGUiLCJjYWxsYmFjayIsIndzVHlwZSIsImhhcyIsImdldCIsInNlbmQiLCJtZXNzYWdlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7O0FBQUE7Ozs7OztBQUVBLE1BQU1BLFVBQVUsSUFBSUMsR0FBSixDQUFRLENBQUMsQ0FBQyxZQUFELEVBQWUsT0FBZixDQUFELENBQVIsQ0FBaEI7QUFDQSxNQUFNQyxRQUFRLFlBQVc7QUFDdkIsTUFBSTtBQUNGLFdBQU9DLFFBQVEsS0FBUixDQUFQO0FBQ0QsR0FGRCxDQUVFLE9BQU1DLENBQU4sRUFBUztBQUNULFdBQU9ELFFBQVEsSUFBUixDQUFQO0FBQ0Q7QUFDRixDQU5EOztBQVFPLE1BQU1FLG9CQUFOLENBQTJCOztBQUdoQ0MsY0FBWUMsTUFBWixFQUF5QkMsU0FBekIsRUFBOENDLG1CQUEyQixLQUFLLElBQTlFLEVBQW9GO0FBQ2xGLFVBQU1DLGtCQUFrQlIsUUFBUVMsTUFBaEM7QUFDQSxVQUFNQyxNQUFNLElBQUlGLGVBQUosQ0FBb0IsRUFBRUgsUUFBUUEsTUFBVixFQUFwQixDQUFaO0FBQ0FLLFFBQUlDLEVBQUosQ0FBTyxXQUFQLEVBQW9CLE1BQU07QUFDeEIsdUJBQU9DLElBQVAsQ0FBWSx1Q0FBWjtBQUNELEtBRkQ7QUFHQUYsUUFBSUMsRUFBSixDQUFPLFlBQVAsRUFBc0JFLEVBQUQsSUFBUTtBQUMzQlAsZ0JBQVUsSUFBSVEsY0FBSixDQUFtQkQsRUFBbkIsQ0FBVjtBQUNBO0FBQ0EsWUFBTUUsaUJBQWlCQyxZQUFZLE1BQU07QUFDdkMsWUFBSUgsR0FBR0ksVUFBSCxJQUFpQkosR0FBR0ssSUFBeEIsRUFBOEI7QUFDNUJMLGFBQUdNLElBQUg7QUFDRCxTQUZELE1BRU87QUFDTEMsd0JBQWNMLGNBQWQ7QUFDRDtBQUNGLE9BTnNCLEVBTXBCUixnQkFOb0IsQ0FBdkI7QUFPRCxLQVZEO0FBV0EsU0FBS0YsTUFBTCxHQUFjSyxHQUFkO0FBQ0Q7QUFyQitCOztRQUFyQlAsb0IsR0FBQUEsb0I7QUF3Qk4sTUFBTVcsY0FBTixDQUFxQjs7QUFHMUJWLGNBQVlTLEVBQVosRUFBcUI7QUFDbkIsU0FBS0EsRUFBTCxHQUFVQSxFQUFWO0FBQ0Q7O0FBRURGLEtBQUdVLElBQUgsRUFBaUJDLFFBQWpCLEVBQWlDO0FBQy9CLFVBQU1DLFNBQVN6QixRQUFRMEIsR0FBUixDQUFZSCxJQUFaLElBQW9CdkIsUUFBUTJCLEdBQVIsQ0FBWUosSUFBWixDQUFwQixHQUF3Q0EsSUFBdkQ7QUFDQSxTQUFLUixFQUFMLENBQVFGLEVBQVIsQ0FBV1ksTUFBWCxFQUFtQkQsUUFBbkI7QUFDRDs7QUFFREksT0FBS0MsT0FBTCxFQUF5QjtBQUN2QixTQUFLZCxFQUFMLENBQVFhLElBQVIsQ0FBYUMsT0FBYjtBQUNEO0FBZHlCO1FBQWZiLGMsR0FBQUEsYyIsImZpbGUiOiJQYXJzZVdlYlNvY2tldFNlcnZlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBsb2dnZXIgZnJvbSAnLi4vbG9nZ2VyJztcblxuY29uc3QgdHlwZU1hcCA9IG5ldyBNYXAoW1snZGlzY29ubmVjdCcsICdjbG9zZSddXSk7XG5jb25zdCBnZXRXUyA9IGZ1bmN0aW9uKCkge1xuICB0cnkge1xuICAgIHJldHVybiByZXF1aXJlKCd1d3MnKTtcbiAgfSBjYXRjaChlKSB7XG4gICAgcmV0dXJuIHJlcXVpcmUoJ3dzJyk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFBhcnNlV2ViU29ja2V0U2VydmVyIHtcbiAgc2VydmVyOiBPYmplY3Q7XG5cbiAgY29uc3RydWN0b3Ioc2VydmVyOiBhbnksIG9uQ29ubmVjdDogRnVuY3Rpb24sIHdlYnNvY2tldFRpbWVvdXQ6IG51bWJlciA9IDEwICogMTAwMCkge1xuICAgIGNvbnN0IFdlYlNvY2tldFNlcnZlciA9IGdldFdTKCkuU2VydmVyO1xuICAgIGNvbnN0IHdzcyA9IG5ldyBXZWJTb2NrZXRTZXJ2ZXIoeyBzZXJ2ZXI6IHNlcnZlciB9KTtcbiAgICB3c3Mub24oJ2xpc3RlbmluZycsICgpID0+IHtcbiAgICAgIGxvZ2dlci5pbmZvKCdQYXJzZSBMaXZlUXVlcnkgU2VydmVyIHN0YXJ0cyBydW5uaW5nJyk7XG4gICAgfSk7XG4gICAgd3NzLm9uKCdjb25uZWN0aW9uJywgKHdzKSA9PiB7XG4gICAgICBvbkNvbm5lY3QobmV3IFBhcnNlV2ViU29ja2V0KHdzKSk7XG4gICAgICAvLyBTZW5kIHBpbmcgdG8gY2xpZW50IHBlcmlvZGljYWxseVxuICAgICAgY29uc3QgcGluZ0ludGVydmFsSWQgPSBzZXRJbnRlcnZhbCgoKSA9PiB7XG4gICAgICAgIGlmICh3cy5yZWFkeVN0YXRlID09IHdzLk9QRU4pIHtcbiAgICAgICAgICB3cy5waW5nKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY2xlYXJJbnRlcnZhbChwaW5nSW50ZXJ2YWxJZCk7XG4gICAgICAgIH1cbiAgICAgIH0sIHdlYnNvY2tldFRpbWVvdXQpO1xuICAgIH0pO1xuICAgIHRoaXMuc2VydmVyID0gd3NzO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBQYXJzZVdlYlNvY2tldCB7XG4gIHdzOiBhbnk7XG5cbiAgY29uc3RydWN0b3Iod3M6IGFueSkge1xuICAgIHRoaXMud3MgPSB3cztcbiAgfVxuXG4gIG9uKHR5cGU6IHN0cmluZywgY2FsbGJhY2spOiB2b2lkIHtcbiAgICBjb25zdCB3c1R5cGUgPSB0eXBlTWFwLmhhcyh0eXBlKSA/IHR5cGVNYXAuZ2V0KHR5cGUpIDogdHlwZTtcbiAgICB0aGlzLndzLm9uKHdzVHlwZSwgY2FsbGJhY2spO1xuICB9XG5cbiAgc2VuZChtZXNzYWdlOiBhbnkpOiB2b2lkIHtcbiAgICB0aGlzLndzLnNlbmQobWVzc2FnZSk7XG4gIH1cbn1cbiJdfQ==