'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _express = require('express');

var _express2 = _interopRequireDefault(_express);

var _logger = require('./logger');

var _logger2 = _interopRequireDefault(_logger);

var _util = require('util');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// A router that is based on promises rather than req/res/next.
// This is intended to replace the use of express.Router to handle
// subsections of the API surface.
// This will make it easier to have methods like 'batch' that
// themselves use our routing information, without disturbing express
// components that external developers may be modifying.

const Layer = require('express/lib/router/layer');

function validateParameter(key, value) {
  if (key == 'className') {
    if (value.match(/_?[A-Za-z][A-Za-z_0-9]*/)) {
      return value;
    }
  } else if (key == 'objectId') {
    if (value.match(/[A-Za-z0-9]+/)) {
      return value;
    }
  } else {
    return value;
  }
}

class PromiseRouter {
  // Each entry should be an object with:
  // path: the path to route, in express format
  // method: the HTTP method that this route handles.
  //   Must be one of: POST, GET, PUT, DELETE
  // handler: a function that takes request, and returns a promise.
  //   Successful handlers should resolve to an object with fields:
  //     status: optional. the http status code. defaults to 200
  //     response: a json object with the content of the response
  //     location: optional. a location header
  constructor(routes = [], appId) {
    this.routes = routes;
    this.appId = appId;
    this.mountRoutes();
  }

  // Leave the opportunity to
  // subclasses to mount their routes by overriding
  mountRoutes() {}

  // Merge the routes into this one
  merge(router) {
    for (var route of router.routes) {
      this.routes.push(route);
    }
  }

  route(method, path, ...handlers) {
    switch (method) {
      case 'POST':
      case 'GET':
      case 'PUT':
      case 'DELETE':
        break;
      default:
        throw 'cannot route method: ' + method;
    }

    let handler = handlers[0];

    if (handlers.length > 1) {
      handler = function (req) {
        return handlers.reduce((promise, handler) => {
          return promise.then(() => {
            return handler(req);
          });
        }, Promise.resolve());
      };
    }

    this.routes.push({
      path: path,
      method: method,
      handler: handler,
      layer: new Layer(path, null, handler)
    });
  }

  // Returns an object with:
  //   handler: the handler that should deal with this request
  //   params: any :-params that got parsed from the path
  // Returns undefined if there is no match.
  match(method, path) {
    for (var route of this.routes) {
      if (route.method != method) {
        continue;
      }
      const layer = route.layer || new Layer(route.path, null, route.handler);
      const match = layer.match(path);
      if (match) {
        const params = layer.params;
        Object.keys(params).forEach(key => {
          params[key] = validateParameter(key, params[key]);
        });
        return { params: params, handler: route.handler };
      }
    }
  }

  // Mount the routes on this router onto an express app (or express router)
  mountOnto(expressApp) {
    this.routes.forEach(route => {
      const method = route.method.toLowerCase();
      const handler = makeExpressHandler(this.appId, route.handler);
      expressApp[method].call(expressApp, route.path, handler);
    });
    return expressApp;
  }

  expressRouter() {
    return this.mountOnto(_express2.default.Router());
  }

  tryRouteRequest(method, path, request) {
    var match = this.match(method, path);
    if (!match) {
      throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'cannot route ' + method + ' ' + path);
    }
    request.params = match.params;
    return new Promise((resolve, reject) => {
      match.handler(request).then(resolve, reject);
    });
  }
}

exports.default = PromiseRouter; // A helper function to make an express handler out of a a promise
// handler.
// Express handlers should never throw; if a promise handler throws we
// just treat it like it resolved to an error.

function makeExpressHandler(appId, promiseHandler) {
  return function (req, res, next) {
    try {
      const url = maskSensitiveUrl(req);
      const body = Object.assign({}, req.body);
      const method = req.method;
      const headers = req.headers;
      _logger2.default.logRequest({
        method,
        url,
        headers,
        body
      });
      promiseHandler(req).then(result => {
        if (!result.response && !result.location && !result.text) {
          _logger2.default.error('the handler did not include a "response" or a "location" field');
          throw 'control should not get here';
        }

        _logger2.default.logResponse({ method, url, result });

        var status = result.status || 200;
        res.status(status);

        if (result.text) {
          res.send(result.text);
          return;
        }

        if (result.location) {
          res.set('Location', result.location);
          // Override the default expressjs response
          // as it double encodes %encoded chars in URL
          if (!result.response) {
            res.send('Found. Redirecting to ' + result.location);
            return;
          }
        }
        if (result.headers) {
          Object.keys(result.headers).forEach(header => {
            res.set(header, result.headers[header]);
          });
        }
        res.json(result.response);
      }, e => {
        _logger2.default.error(`Error generating response. ${(0, _util.inspect)(e)}`, { error: e });
        next(e);
      });
    } catch (e) {
      _logger2.default.error(`Error handling request: ${(0, _util.inspect)(e)}`, { error: e });
      next(e);
    }
  };
}

function maskSensitiveUrl(req) {
  let maskUrl = req.originalUrl.toString();
  const shouldMaskUrl = req.method === 'GET' && req.originalUrl.includes('/login') && !req.originalUrl.includes('classes');
  if (shouldMaskUrl) {
    maskUrl = _logger2.default.maskSensitiveUrl(maskUrl);
  }
  return maskUrl;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9Qcm9taXNlUm91dGVyLmpzIl0sIm5hbWVzIjpbIkxheWVyIiwicmVxdWlyZSIsInZhbGlkYXRlUGFyYW1ldGVyIiwia2V5IiwidmFsdWUiLCJtYXRjaCIsIlByb21pc2VSb3V0ZXIiLCJjb25zdHJ1Y3RvciIsInJvdXRlcyIsImFwcElkIiwibW91bnRSb3V0ZXMiLCJtZXJnZSIsInJvdXRlciIsInJvdXRlIiwicHVzaCIsIm1ldGhvZCIsInBhdGgiLCJoYW5kbGVycyIsImhhbmRsZXIiLCJsZW5ndGgiLCJyZXEiLCJyZWR1Y2UiLCJwcm9taXNlIiwidGhlbiIsIlByb21pc2UiLCJyZXNvbHZlIiwibGF5ZXIiLCJwYXJhbXMiLCJPYmplY3QiLCJrZXlzIiwiZm9yRWFjaCIsIm1vdW50T250byIsImV4cHJlc3NBcHAiLCJ0b0xvd2VyQ2FzZSIsIm1ha2VFeHByZXNzSGFuZGxlciIsImNhbGwiLCJleHByZXNzUm91dGVyIiwiUm91dGVyIiwidHJ5Um91dGVSZXF1ZXN0IiwicmVxdWVzdCIsIkVycm9yIiwiSU5WQUxJRF9KU09OIiwicmVqZWN0IiwicHJvbWlzZUhhbmRsZXIiLCJyZXMiLCJuZXh0IiwidXJsIiwibWFza1NlbnNpdGl2ZVVybCIsImJvZHkiLCJhc3NpZ24iLCJoZWFkZXJzIiwibG9nUmVxdWVzdCIsInJlc3VsdCIsInJlc3BvbnNlIiwibG9jYXRpb24iLCJ0ZXh0IiwiZXJyb3IiLCJsb2dSZXNwb25zZSIsInN0YXR1cyIsInNlbmQiLCJzZXQiLCJoZWFkZXIiLCJqc29uIiwiZSIsIm1hc2tVcmwiLCJvcmlnaW5hbFVybCIsInRvU3RyaW5nIiwic2hvdWxkTWFza1VybCIsImluY2x1ZGVzIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFPQTs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQVZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFNQSxNQUFNQSxRQUFRQyxRQUFRLDBCQUFSLENBQWQ7O0FBRUEsU0FBU0MsaUJBQVQsQ0FBMkJDLEdBQTNCLEVBQWdDQyxLQUFoQyxFQUF1QztBQUNyQyxNQUFJRCxPQUFPLFdBQVgsRUFBd0I7QUFDdEIsUUFBSUMsTUFBTUMsS0FBTixDQUFZLHlCQUFaLENBQUosRUFBNEM7QUFDMUMsYUFBT0QsS0FBUDtBQUNEO0FBQ0YsR0FKRCxNQUlPLElBQUlELE9BQU8sVUFBWCxFQUF1QjtBQUM1QixRQUFJQyxNQUFNQyxLQUFOLENBQVksY0FBWixDQUFKLEVBQWlDO0FBQy9CLGFBQU9ELEtBQVA7QUFDRDtBQUNGLEdBSk0sTUFJQTtBQUNMLFdBQU9BLEtBQVA7QUFDRDtBQUNGOztBQUdjLE1BQU1FLGFBQU4sQ0FBb0I7QUFDakM7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0FDLGNBQVlDLFNBQVMsRUFBckIsRUFBeUJDLEtBQXpCLEVBQWdDO0FBQzlCLFNBQUtELE1BQUwsR0FBY0EsTUFBZDtBQUNBLFNBQUtDLEtBQUwsR0FBYUEsS0FBYjtBQUNBLFNBQUtDLFdBQUw7QUFDRDs7QUFFRDtBQUNBO0FBQ0FBLGdCQUFjLENBQUU7O0FBRWhCO0FBQ0FDLFFBQU1DLE1BQU4sRUFBYztBQUNaLFNBQUssSUFBSUMsS0FBVCxJQUFrQkQsT0FBT0osTUFBekIsRUFBaUM7QUFDL0IsV0FBS0EsTUFBTCxDQUFZTSxJQUFaLENBQWlCRCxLQUFqQjtBQUNEO0FBQ0Y7O0FBRURBLFFBQU1FLE1BQU4sRUFBY0MsSUFBZCxFQUFvQixHQUFHQyxRQUF2QixFQUFpQztBQUMvQixZQUFPRixNQUFQO0FBQ0EsV0FBSyxNQUFMO0FBQ0EsV0FBSyxLQUFMO0FBQ0EsV0FBSyxLQUFMO0FBQ0EsV0FBSyxRQUFMO0FBQ0U7QUFDRjtBQUNFLGNBQU0sMEJBQTBCQSxNQUFoQztBQVBGOztBQVVBLFFBQUlHLFVBQVVELFNBQVMsQ0FBVCxDQUFkOztBQUVBLFFBQUlBLFNBQVNFLE1BQVQsR0FBa0IsQ0FBdEIsRUFBeUI7QUFDdkJELGdCQUFVLFVBQVNFLEdBQVQsRUFBYztBQUN0QixlQUFPSCxTQUFTSSxNQUFULENBQWdCLENBQUNDLE9BQUQsRUFBVUosT0FBVixLQUFzQjtBQUMzQyxpQkFBT0ksUUFBUUMsSUFBUixDQUFhLE1BQU07QUFDeEIsbUJBQU9MLFFBQVFFLEdBQVIsQ0FBUDtBQUNELFdBRk0sQ0FBUDtBQUdELFNBSk0sRUFJSkksUUFBUUMsT0FBUixFQUpJLENBQVA7QUFLRCxPQU5EO0FBT0Q7O0FBRUQsU0FBS2pCLE1BQUwsQ0FBWU0sSUFBWixDQUFpQjtBQUNmRSxZQUFNQSxJQURTO0FBRWZELGNBQVFBLE1BRk87QUFHZkcsZUFBU0EsT0FITTtBQUlmUSxhQUFPLElBQUkxQixLQUFKLENBQVVnQixJQUFWLEVBQWdCLElBQWhCLEVBQXNCRSxPQUF0QjtBQUpRLEtBQWpCO0FBTUQ7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQWIsUUFBTVUsTUFBTixFQUFjQyxJQUFkLEVBQW9CO0FBQ2xCLFNBQUssSUFBSUgsS0FBVCxJQUFrQixLQUFLTCxNQUF2QixFQUErQjtBQUM3QixVQUFJSyxNQUFNRSxNQUFOLElBQWdCQSxNQUFwQixFQUE0QjtBQUMxQjtBQUNEO0FBQ0QsWUFBTVcsUUFBUWIsTUFBTWEsS0FBTixJQUFlLElBQUkxQixLQUFKLENBQVVhLE1BQU1HLElBQWhCLEVBQXNCLElBQXRCLEVBQTRCSCxNQUFNSyxPQUFsQyxDQUE3QjtBQUNBLFlBQU1iLFFBQVFxQixNQUFNckIsS0FBTixDQUFZVyxJQUFaLENBQWQ7QUFDQSxVQUFJWCxLQUFKLEVBQVc7QUFDVCxjQUFNc0IsU0FBU0QsTUFBTUMsTUFBckI7QUFDQUMsZUFBT0MsSUFBUCxDQUFZRixNQUFaLEVBQW9CRyxPQUFwQixDQUE2QjNCLEdBQUQsSUFBUztBQUNuQ3dCLGlCQUFPeEIsR0FBUCxJQUFjRCxrQkFBa0JDLEdBQWxCLEVBQXVCd0IsT0FBT3hCLEdBQVAsQ0FBdkIsQ0FBZDtBQUNELFNBRkQ7QUFHQSxlQUFPLEVBQUN3QixRQUFRQSxNQUFULEVBQWlCVCxTQUFTTCxNQUFNSyxPQUFoQyxFQUFQO0FBQ0Q7QUFDRjtBQUNGOztBQUVEO0FBQ0FhLFlBQVVDLFVBQVYsRUFBc0I7QUFDcEIsU0FBS3hCLE1BQUwsQ0FBWXNCLE9BQVosQ0FBcUJqQixLQUFELElBQVc7QUFDN0IsWUFBTUUsU0FBU0YsTUFBTUUsTUFBTixDQUFha0IsV0FBYixFQUFmO0FBQ0EsWUFBTWYsVUFBVWdCLG1CQUFtQixLQUFLekIsS0FBeEIsRUFBK0JJLE1BQU1LLE9BQXJDLENBQWhCO0FBQ0FjLGlCQUFXakIsTUFBWCxFQUFtQm9CLElBQW5CLENBQXdCSCxVQUF4QixFQUFvQ25CLE1BQU1HLElBQTFDLEVBQWdERSxPQUFoRDtBQUNELEtBSkQ7QUFLQSxXQUFPYyxVQUFQO0FBQ0Q7O0FBRURJLGtCQUFnQjtBQUNkLFdBQU8sS0FBS0wsU0FBTCxDQUFlLGtCQUFRTSxNQUFSLEVBQWYsQ0FBUDtBQUNEOztBQUVEQyxrQkFBZ0J2QixNQUFoQixFQUF3QkMsSUFBeEIsRUFBOEJ1QixPQUE5QixFQUF1QztBQUNyQyxRQUFJbEMsUUFBUSxLQUFLQSxLQUFMLENBQVdVLE1BQVgsRUFBbUJDLElBQW5CLENBQVo7QUFDQSxRQUFJLENBQUNYLEtBQUwsRUFBWTtBQUNWLFlBQU0sSUFBSSxlQUFNbUMsS0FBVixDQUNKLGVBQU1BLEtBQU4sQ0FBWUMsWUFEUixFQUVKLGtCQUFrQjFCLE1BQWxCLEdBQTJCLEdBQTNCLEdBQWlDQyxJQUY3QixDQUFOO0FBR0Q7QUFDRHVCLFlBQVFaLE1BQVIsR0FBaUJ0QixNQUFNc0IsTUFBdkI7QUFDQSxXQUFPLElBQUlILE9BQUosQ0FBWSxDQUFDQyxPQUFELEVBQVVpQixNQUFWLEtBQXFCO0FBQ3RDckMsWUFBTWEsT0FBTixDQUFjcUIsT0FBZCxFQUF1QmhCLElBQXZCLENBQTRCRSxPQUE1QixFQUFxQ2lCLE1BQXJDO0FBQ0QsS0FGTSxDQUFQO0FBR0Q7QUF4R2dDOztrQkFBZHBDLGEsRUEyR3JCO0FBQ0E7QUFDQTtBQUNBOztBQUNBLFNBQVM0QixrQkFBVCxDQUE0QnpCLEtBQTVCLEVBQW1Da0MsY0FBbkMsRUFBbUQ7QUFDakQsU0FBTyxVQUFTdkIsR0FBVCxFQUFjd0IsR0FBZCxFQUFtQkMsSUFBbkIsRUFBeUI7QUFDOUIsUUFBSTtBQUNGLFlBQU1DLE1BQU1DLGlCQUFpQjNCLEdBQWpCLENBQVo7QUFDQSxZQUFNNEIsT0FBT3BCLE9BQU9xQixNQUFQLENBQWMsRUFBZCxFQUFrQjdCLElBQUk0QixJQUF0QixDQUFiO0FBQ0EsWUFBTWpDLFNBQVNLLElBQUlMLE1BQW5CO0FBQ0EsWUFBTW1DLFVBQVU5QixJQUFJOEIsT0FBcEI7QUFDQSx1QkFBSUMsVUFBSixDQUFlO0FBQ2JwQyxjQURhO0FBRWIrQixXQUZhO0FBR2JJLGVBSGE7QUFJYkY7QUFKYSxPQUFmO0FBTUFMLHFCQUFldkIsR0FBZixFQUFvQkcsSUFBcEIsQ0FBMEI2QixNQUFELElBQVk7QUFDbkMsWUFBSSxDQUFDQSxPQUFPQyxRQUFSLElBQW9CLENBQUNELE9BQU9FLFFBQTVCLElBQXdDLENBQUNGLE9BQU9HLElBQXBELEVBQTBEO0FBQ3hELDJCQUFJQyxLQUFKLENBQVUsZ0VBQVY7QUFDQSxnQkFBTSw2QkFBTjtBQUNEOztBQUVELHlCQUFJQyxXQUFKLENBQWdCLEVBQUUxQyxNQUFGLEVBQVUrQixHQUFWLEVBQWVNLE1BQWYsRUFBaEI7O0FBRUEsWUFBSU0sU0FBU04sT0FBT00sTUFBUCxJQUFpQixHQUE5QjtBQUNBZCxZQUFJYyxNQUFKLENBQVdBLE1BQVg7O0FBRUEsWUFBSU4sT0FBT0csSUFBWCxFQUFpQjtBQUNmWCxjQUFJZSxJQUFKLENBQVNQLE9BQU9HLElBQWhCO0FBQ0E7QUFDRDs7QUFFRCxZQUFJSCxPQUFPRSxRQUFYLEVBQXFCO0FBQ25CVixjQUFJZ0IsR0FBSixDQUFRLFVBQVIsRUFBb0JSLE9BQU9FLFFBQTNCO0FBQ0E7QUFDQTtBQUNBLGNBQUksQ0FBQ0YsT0FBT0MsUUFBWixFQUFzQjtBQUNwQlQsZ0JBQUllLElBQUosQ0FBUywyQkFBMkJQLE9BQU9FLFFBQTNDO0FBQ0E7QUFDRDtBQUNGO0FBQ0QsWUFBSUYsT0FBT0YsT0FBWCxFQUFvQjtBQUNsQnRCLGlCQUFPQyxJQUFQLENBQVl1QixPQUFPRixPQUFuQixFQUE0QnBCLE9BQTVCLENBQXFDK0IsTUFBRCxJQUFZO0FBQzlDakIsZ0JBQUlnQixHQUFKLENBQVFDLE1BQVIsRUFBZ0JULE9BQU9GLE9BQVAsQ0FBZVcsTUFBZixDQUFoQjtBQUNELFdBRkQ7QUFHRDtBQUNEakIsWUFBSWtCLElBQUosQ0FBU1YsT0FBT0MsUUFBaEI7QUFDRCxPQS9CRCxFQStCSVUsQ0FBRCxJQUFPO0FBQ1IseUJBQUlQLEtBQUosQ0FBVyw4QkFBNkIsbUJBQVFPLENBQVIsQ0FBVyxFQUFuRCxFQUFzRCxFQUFDUCxPQUFPTyxDQUFSLEVBQXREO0FBQ0FsQixhQUFLa0IsQ0FBTDtBQUNELE9BbENEO0FBbUNELEtBOUNELENBOENFLE9BQU9BLENBQVAsRUFBVTtBQUNWLHVCQUFJUCxLQUFKLENBQVcsMkJBQTBCLG1CQUFRTyxDQUFSLENBQVcsRUFBaEQsRUFBbUQsRUFBQ1AsT0FBT08sQ0FBUixFQUFuRDtBQUNBbEIsV0FBS2tCLENBQUw7QUFDRDtBQUNGLEdBbkREO0FBb0REOztBQUdELFNBQVNoQixnQkFBVCxDQUEwQjNCLEdBQTFCLEVBQStCO0FBQzdCLE1BQUk0QyxVQUFVNUMsSUFBSTZDLFdBQUosQ0FBZ0JDLFFBQWhCLEVBQWQ7QUFDQSxRQUFNQyxnQkFBZ0IvQyxJQUFJTCxNQUFKLEtBQWUsS0FBZixJQUF3QkssSUFBSTZDLFdBQUosQ0FBZ0JHLFFBQWhCLENBQXlCLFFBQXpCLENBQXhCLElBQ0MsQ0FBQ2hELElBQUk2QyxXQUFKLENBQWdCRyxRQUFoQixDQUF5QixTQUF6QixDQUR4QjtBQUVBLE1BQUlELGFBQUosRUFBbUI7QUFDakJILGNBQVUsaUJBQUlqQixnQkFBSixDQUFxQmlCLE9BQXJCLENBQVY7QUFDRDtBQUNELFNBQU9BLE9BQVA7QUFDRCIsImZpbGUiOiJQcm9taXNlUm91dGVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQSByb3V0ZXIgdGhhdCBpcyBiYXNlZCBvbiBwcm9taXNlcyByYXRoZXIgdGhhbiByZXEvcmVzL25leHQuXG4vLyBUaGlzIGlzIGludGVuZGVkIHRvIHJlcGxhY2UgdGhlIHVzZSBvZiBleHByZXNzLlJvdXRlciB0byBoYW5kbGVcbi8vIHN1YnNlY3Rpb25zIG9mIHRoZSBBUEkgc3VyZmFjZS5cbi8vIFRoaXMgd2lsbCBtYWtlIGl0IGVhc2llciB0byBoYXZlIG1ldGhvZHMgbGlrZSAnYmF0Y2gnIHRoYXRcbi8vIHRoZW1zZWx2ZXMgdXNlIG91ciByb3V0aW5nIGluZm9ybWF0aW9uLCB3aXRob3V0IGRpc3R1cmJpbmcgZXhwcmVzc1xuLy8gY29tcG9uZW50cyB0aGF0IGV4dGVybmFsIGRldmVsb3BlcnMgbWF5IGJlIG1vZGlmeWluZy5cblxuaW1wb3J0IFBhcnNlICAgICBmcm9tICdwYXJzZS9ub2RlJztcbmltcG9ydCBleHByZXNzICAgZnJvbSAnZXhwcmVzcyc7XG5pbXBvcnQgbG9nICAgICAgIGZyb20gJy4vbG9nZ2VyJztcbmltcG9ydCB7aW5zcGVjdH0gZnJvbSAndXRpbCc7XG5jb25zdCBMYXllciA9IHJlcXVpcmUoJ2V4cHJlc3MvbGliL3JvdXRlci9sYXllcicpO1xuXG5mdW5jdGlvbiB2YWxpZGF0ZVBhcmFtZXRlcihrZXksIHZhbHVlKSB7XG4gIGlmIChrZXkgPT0gJ2NsYXNzTmFtZScpIHtcbiAgICBpZiAodmFsdWUubWF0Y2goL18/W0EtWmEtel1bQS1aYS16XzAtOV0qLykpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH0gZWxzZSBpZiAoa2V5ID09ICdvYmplY3RJZCcpIHtcbiAgICBpZiAodmFsdWUubWF0Y2goL1tBLVphLXowLTldKy8pKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxufVxuXG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFByb21pc2VSb3V0ZXIge1xuICAvLyBFYWNoIGVudHJ5IHNob3VsZCBiZSBhbiBvYmplY3Qgd2l0aDpcbiAgLy8gcGF0aDogdGhlIHBhdGggdG8gcm91dGUsIGluIGV4cHJlc3MgZm9ybWF0XG4gIC8vIG1ldGhvZDogdGhlIEhUVFAgbWV0aG9kIHRoYXQgdGhpcyByb3V0ZSBoYW5kbGVzLlxuICAvLyAgIE11c3QgYmUgb25lIG9mOiBQT1NULCBHRVQsIFBVVCwgREVMRVRFXG4gIC8vIGhhbmRsZXI6IGEgZnVuY3Rpb24gdGhhdCB0YWtlcyByZXF1ZXN0LCBhbmQgcmV0dXJucyBhIHByb21pc2UuXG4gIC8vICAgU3VjY2Vzc2Z1bCBoYW5kbGVycyBzaG91bGQgcmVzb2x2ZSB0byBhbiBvYmplY3Qgd2l0aCBmaWVsZHM6XG4gIC8vICAgICBzdGF0dXM6IG9wdGlvbmFsLiB0aGUgaHR0cCBzdGF0dXMgY29kZS4gZGVmYXVsdHMgdG8gMjAwXG4gIC8vICAgICByZXNwb25zZTogYSBqc29uIG9iamVjdCB3aXRoIHRoZSBjb250ZW50IG9mIHRoZSByZXNwb25zZVxuICAvLyAgICAgbG9jYXRpb246IG9wdGlvbmFsLiBhIGxvY2F0aW9uIGhlYWRlclxuICBjb25zdHJ1Y3Rvcihyb3V0ZXMgPSBbXSwgYXBwSWQpIHtcbiAgICB0aGlzLnJvdXRlcyA9IHJvdXRlcztcbiAgICB0aGlzLmFwcElkID0gYXBwSWQ7XG4gICAgdGhpcy5tb3VudFJvdXRlcygpO1xuICB9XG5cbiAgLy8gTGVhdmUgdGhlIG9wcG9ydHVuaXR5IHRvXG4gIC8vIHN1YmNsYXNzZXMgdG8gbW91bnQgdGhlaXIgcm91dGVzIGJ5IG92ZXJyaWRpbmdcbiAgbW91bnRSb3V0ZXMoKSB7fVxuXG4gIC8vIE1lcmdlIHRoZSByb3V0ZXMgaW50byB0aGlzIG9uZVxuICBtZXJnZShyb3V0ZXIpIHtcbiAgICBmb3IgKHZhciByb3V0ZSBvZiByb3V0ZXIucm91dGVzKSB7XG4gICAgICB0aGlzLnJvdXRlcy5wdXNoKHJvdXRlKTtcbiAgICB9XG4gIH1cblxuICByb3V0ZShtZXRob2QsIHBhdGgsIC4uLmhhbmRsZXJzKSB7XG4gICAgc3dpdGNoKG1ldGhvZCkge1xuICAgIGNhc2UgJ1BPU1QnOlxuICAgIGNhc2UgJ0dFVCc6XG4gICAgY2FzZSAnUFVUJzpcbiAgICBjYXNlICdERUxFVEUnOlxuICAgICAgYnJlYWs7XG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93ICdjYW5ub3Qgcm91dGUgbWV0aG9kOiAnICsgbWV0aG9kO1xuICAgIH1cblxuICAgIGxldCBoYW5kbGVyID0gaGFuZGxlcnNbMF07XG5cbiAgICBpZiAoaGFuZGxlcnMubGVuZ3RoID4gMSkge1xuICAgICAgaGFuZGxlciA9IGZ1bmN0aW9uKHJlcSkge1xuICAgICAgICByZXR1cm4gaGFuZGxlcnMucmVkdWNlKChwcm9taXNlLCBoYW5kbGVyKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgICAgICAgICByZXR1cm4gaGFuZGxlcihyZXEpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9LCBQcm9taXNlLnJlc29sdmUoKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5yb3V0ZXMucHVzaCh7XG4gICAgICBwYXRoOiBwYXRoLFxuICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICBoYW5kbGVyOiBoYW5kbGVyLFxuICAgICAgbGF5ZXI6IG5ldyBMYXllcihwYXRoLCBudWxsLCBoYW5kbGVyKVxuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhbiBvYmplY3Qgd2l0aDpcbiAgLy8gICBoYW5kbGVyOiB0aGUgaGFuZGxlciB0aGF0IHNob3VsZCBkZWFsIHdpdGggdGhpcyByZXF1ZXN0XG4gIC8vICAgcGFyYW1zOiBhbnkgOi1wYXJhbXMgdGhhdCBnb3QgcGFyc2VkIGZyb20gdGhlIHBhdGhcbiAgLy8gUmV0dXJucyB1bmRlZmluZWQgaWYgdGhlcmUgaXMgbm8gbWF0Y2guXG4gIG1hdGNoKG1ldGhvZCwgcGF0aCkge1xuICAgIGZvciAodmFyIHJvdXRlIG9mIHRoaXMucm91dGVzKSB7XG4gICAgICBpZiAocm91dGUubWV0aG9kICE9IG1ldGhvZCkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGxheWVyID0gcm91dGUubGF5ZXIgfHwgbmV3IExheWVyKHJvdXRlLnBhdGgsIG51bGwsIHJvdXRlLmhhbmRsZXIpO1xuICAgICAgY29uc3QgbWF0Y2ggPSBsYXllci5tYXRjaChwYXRoKTtcbiAgICAgIGlmIChtYXRjaCkge1xuICAgICAgICBjb25zdCBwYXJhbXMgPSBsYXllci5wYXJhbXM7XG4gICAgICAgIE9iamVjdC5rZXlzKHBhcmFtcykuZm9yRWFjaCgoa2V5KSA9PiB7XG4gICAgICAgICAgcGFyYW1zW2tleV0gPSB2YWxpZGF0ZVBhcmFtZXRlcihrZXksIHBhcmFtc1trZXldKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB7cGFyYW1zOiBwYXJhbXMsIGhhbmRsZXI6IHJvdXRlLmhhbmRsZXJ9O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIC8vIE1vdW50IHRoZSByb3V0ZXMgb24gdGhpcyByb3V0ZXIgb250byBhbiBleHByZXNzIGFwcCAob3IgZXhwcmVzcyByb3V0ZXIpXG4gIG1vdW50T250byhleHByZXNzQXBwKSB7XG4gICAgdGhpcy5yb3V0ZXMuZm9yRWFjaCgocm91dGUpID0+IHtcbiAgICAgIGNvbnN0IG1ldGhvZCA9IHJvdXRlLm1ldGhvZC50b0xvd2VyQ2FzZSgpO1xuICAgICAgY29uc3QgaGFuZGxlciA9IG1ha2VFeHByZXNzSGFuZGxlcih0aGlzLmFwcElkLCByb3V0ZS5oYW5kbGVyKTtcbiAgICAgIGV4cHJlc3NBcHBbbWV0aG9kXS5jYWxsKGV4cHJlc3NBcHAsIHJvdXRlLnBhdGgsIGhhbmRsZXIpO1xuICAgIH0pO1xuICAgIHJldHVybiBleHByZXNzQXBwO1xuICB9XG5cbiAgZXhwcmVzc1JvdXRlcigpIHtcbiAgICByZXR1cm4gdGhpcy5tb3VudE9udG8oZXhwcmVzcy5Sb3V0ZXIoKSk7XG4gIH1cblxuICB0cnlSb3V0ZVJlcXVlc3QobWV0aG9kLCBwYXRoLCByZXF1ZXN0KSB7XG4gICAgdmFyIG1hdGNoID0gdGhpcy5tYXRjaChtZXRob2QsIHBhdGgpO1xuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAnY2Fubm90IHJvdXRlICcgKyBtZXRob2QgKyAnICcgKyBwYXRoKTtcbiAgICB9XG4gICAgcmVxdWVzdC5wYXJhbXMgPSBtYXRjaC5wYXJhbXM7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIG1hdGNoLmhhbmRsZXIocmVxdWVzdCkudGhlbihyZXNvbHZlLCByZWplY3QpO1xuICAgIH0pO1xuICB9XG59XG5cbi8vIEEgaGVscGVyIGZ1bmN0aW9uIHRvIG1ha2UgYW4gZXhwcmVzcyBoYW5kbGVyIG91dCBvZiBhIGEgcHJvbWlzZVxuLy8gaGFuZGxlci5cbi8vIEV4cHJlc3MgaGFuZGxlcnMgc2hvdWxkIG5ldmVyIHRocm93OyBpZiBhIHByb21pc2UgaGFuZGxlciB0aHJvd3Mgd2Vcbi8vIGp1c3QgdHJlYXQgaXQgbGlrZSBpdCByZXNvbHZlZCB0byBhbiBlcnJvci5cbmZ1bmN0aW9uIG1ha2VFeHByZXNzSGFuZGxlcihhcHBJZCwgcHJvbWlzZUhhbmRsZXIpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKHJlcSwgcmVzLCBuZXh0KSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHVybCA9IG1hc2tTZW5zaXRpdmVVcmwocmVxKTtcbiAgICAgIGNvbnN0IGJvZHkgPSBPYmplY3QuYXNzaWduKHt9LCByZXEuYm9keSk7XG4gICAgICBjb25zdCBtZXRob2QgPSByZXEubWV0aG9kO1xuICAgICAgY29uc3QgaGVhZGVycyA9IHJlcS5oZWFkZXJzO1xuICAgICAgbG9nLmxvZ1JlcXVlc3Qoe1xuICAgICAgICBtZXRob2QsXG4gICAgICAgIHVybCxcbiAgICAgICAgaGVhZGVycyxcbiAgICAgICAgYm9keVxuICAgICAgfSk7XG4gICAgICBwcm9taXNlSGFuZGxlcihyZXEpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICBpZiAoIXJlc3VsdC5yZXNwb25zZSAmJiAhcmVzdWx0LmxvY2F0aW9uICYmICFyZXN1bHQudGV4dCkge1xuICAgICAgICAgIGxvZy5lcnJvcigndGhlIGhhbmRsZXIgZGlkIG5vdCBpbmNsdWRlIGEgXCJyZXNwb25zZVwiIG9yIGEgXCJsb2NhdGlvblwiIGZpZWxkJyk7XG4gICAgICAgICAgdGhyb3cgJ2NvbnRyb2wgc2hvdWxkIG5vdCBnZXQgaGVyZSc7XG4gICAgICAgIH1cblxuICAgICAgICBsb2cubG9nUmVzcG9uc2UoeyBtZXRob2QsIHVybCwgcmVzdWx0IH0pO1xuXG4gICAgICAgIHZhciBzdGF0dXMgPSByZXN1bHQuc3RhdHVzIHx8IDIwMDtcbiAgICAgICAgcmVzLnN0YXR1cyhzdGF0dXMpO1xuXG4gICAgICAgIGlmIChyZXN1bHQudGV4dCkge1xuICAgICAgICAgIHJlcy5zZW5kKHJlc3VsdC50ZXh0KTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBpZiAocmVzdWx0LmxvY2F0aW9uKSB7XG4gICAgICAgICAgcmVzLnNldCgnTG9jYXRpb24nLCByZXN1bHQubG9jYXRpb24pO1xuICAgICAgICAgIC8vIE92ZXJyaWRlIHRoZSBkZWZhdWx0IGV4cHJlc3NqcyByZXNwb25zZVxuICAgICAgICAgIC8vIGFzIGl0IGRvdWJsZSBlbmNvZGVzICVlbmNvZGVkIGNoYXJzIGluIFVSTFxuICAgICAgICAgIGlmICghcmVzdWx0LnJlc3BvbnNlKSB7XG4gICAgICAgICAgICByZXMuc2VuZCgnRm91bmQuIFJlZGlyZWN0aW5nIHRvICcgKyByZXN1bHQubG9jYXRpb24pO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBpZiAocmVzdWx0LmhlYWRlcnMpIHtcbiAgICAgICAgICBPYmplY3Qua2V5cyhyZXN1bHQuaGVhZGVycykuZm9yRWFjaCgoaGVhZGVyKSA9PiB7XG4gICAgICAgICAgICByZXMuc2V0KGhlYWRlciwgcmVzdWx0LmhlYWRlcnNbaGVhZGVyXSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgfVxuICAgICAgICByZXMuanNvbihyZXN1bHQucmVzcG9uc2UpO1xuICAgICAgfSwgKGUpID0+IHtcbiAgICAgICAgbG9nLmVycm9yKGBFcnJvciBnZW5lcmF0aW5nIHJlc3BvbnNlLiAke2luc3BlY3QoZSl9YCwge2Vycm9yOiBlfSk7XG4gICAgICAgIG5leHQoZSk7XG4gICAgICB9KTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBsb2cuZXJyb3IoYEVycm9yIGhhbmRsaW5nIHJlcXVlc3Q6ICR7aW5zcGVjdChlKX1gLCB7ZXJyb3I6IGV9KTtcbiAgICAgIG5leHQoZSk7XG4gICAgfVxuICB9XG59XG5cblxuZnVuY3Rpb24gbWFza1NlbnNpdGl2ZVVybChyZXEpIHtcbiAgbGV0IG1hc2tVcmwgPSByZXEub3JpZ2luYWxVcmwudG9TdHJpbmcoKTtcbiAgY29uc3Qgc2hvdWxkTWFza1VybCA9IHJlcS5tZXRob2QgPT09ICdHRVQnICYmIHJlcS5vcmlnaW5hbFVybC5pbmNsdWRlcygnL2xvZ2luJylcbiAgICAgICAgICAgICAgICAgICAgICAmJiAhcmVxLm9yaWdpbmFsVXJsLmluY2x1ZGVzKCdjbGFzc2VzJyk7XG4gIGlmIChzaG91bGRNYXNrVXJsKSB7XG4gICAgbWFza1VybCA9IGxvZy5tYXNrU2Vuc2l0aXZlVXJsKG1hc2tVcmwpO1xuICB9XG4gIHJldHVybiBtYXNrVXJsO1xufVxuIl19