"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.HooksController = undefined;

var _triggers = require("../triggers");

var triggers = _interopRequireWildcard(_triggers);

var _node = require("parse/node");

var Parse = _interopRequireWildcard(_node);

var _request = require("request");

var request = _interopRequireWildcard(_request);

var _logger = require("../logger");

var _http = require("http");

var _http2 = _interopRequireDefault(_http);

var _https = require("https");

var _https2 = _interopRequireDefault(_https);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

// -disable-next
/**  weak */

const DefaultHooksCollectionName = "_Hooks";
// -disable-next

const HTTPAgents = {
  http: new _http2.default.Agent({ keepAlive: true }),
  https: new _https2.default.Agent({ keepAlive: true })
};

class HooksController {

  constructor(applicationId, databaseController, webhookKey) {
    this._applicationId = applicationId;
    this._webhookKey = webhookKey;
    this.database = databaseController;
  }

  load() {
    return this._getHooks().then(hooks => {
      hooks = hooks || [];
      hooks.forEach(hook => {
        this.addHookToTriggers(hook);
      });
    });
  }

  getFunction(functionName) {
    return this._getHooks({ functionName: functionName }).then(results => results[0]);
  }

  getFunctions() {
    return this._getHooks({ functionName: { $exists: true } });
  }

  getTrigger(className, triggerName) {
    return this._getHooks({ className: className, triggerName: triggerName }).then(results => results[0]);
  }

  getTriggers() {
    return this._getHooks({ className: { $exists: true }, triggerName: { $exists: true } });
  }

  deleteFunction(functionName) {
    triggers.removeFunction(functionName, this._applicationId);
    return this._removeHooks({ functionName: functionName });
  }

  deleteTrigger(className, triggerName) {
    triggers.removeTrigger(triggerName, className, this._applicationId);
    return this._removeHooks({ className: className, triggerName: triggerName });
  }

  _getHooks(query = {}) {
    return this.database.find(DefaultHooksCollectionName, query).then(results => {
      return results.map(result => {
        delete result.objectId;
        return result;
      });
    });
  }

  _removeHooks(query) {
    return this.database.destroy(DefaultHooksCollectionName, query).then(() => {
      return Promise.resolve({});
    });
  }

  saveHook(hook) {
    var query;
    if (hook.functionName && hook.url) {
      query = { functionName: hook.functionName };
    } else if (hook.triggerName && hook.className && hook.url) {
      query = { className: hook.className, triggerName: hook.triggerName };
    } else {
      throw new Parse.Error(143, "invalid hook declaration");
    }
    return this.database.update(DefaultHooksCollectionName, query, hook, { upsert: true }).then(() => {
      return Promise.resolve(hook);
    });
  }

  addHookToTriggers(hook) {
    var wrappedFunction = wrapToHTTPRequest(hook, this._webhookKey);
    wrappedFunction.url = hook.url;
    if (hook.className) {
      triggers.addTrigger(hook.triggerName, hook.className, wrappedFunction, this._applicationId);
    } else {
      triggers.addFunction(hook.functionName, wrappedFunction, null, this._applicationId);
    }
  }

  addHook(hook) {
    this.addHookToTriggers(hook);
    return this.saveHook(hook);
  }

  createOrUpdateHook(aHook) {
    var hook;
    if (aHook && aHook.functionName && aHook.url) {
      hook = {};
      hook.functionName = aHook.functionName;
      hook.url = aHook.url;
    } else if (aHook && aHook.className && aHook.url && aHook.triggerName && triggers.Types[aHook.triggerName]) {
      hook = {};
      hook.className = aHook.className;
      hook.url = aHook.url;
      hook.triggerName = aHook.triggerName;
    } else {
      throw new Parse.Error(143, "invalid hook declaration");
    }

    return this.addHook(hook);
  }

  createHook(aHook) {
    if (aHook.functionName) {
      return this.getFunction(aHook.functionName).then(result => {
        if (result) {
          throw new Parse.Error(143, `function name: ${aHook.functionName} already exits`);
        } else {
          return this.createOrUpdateHook(aHook);
        }
      });
    } else if (aHook.className && aHook.triggerName) {
      return this.getTrigger(aHook.className, aHook.triggerName).then(result => {
        if (result) {
          throw new Parse.Error(143, `class ${aHook.className} already has trigger ${aHook.triggerName}`);
        }
        return this.createOrUpdateHook(aHook);
      });
    }

    throw new Parse.Error(143, "invalid hook declaration");
  }

  updateHook(aHook) {
    if (aHook.functionName) {
      return this.getFunction(aHook.functionName).then(result => {
        if (result) {
          return this.createOrUpdateHook(aHook);
        }
        throw new Parse.Error(143, `no function named: ${aHook.functionName} is defined`);
      });
    } else if (aHook.className && aHook.triggerName) {
      return this.getTrigger(aHook.className, aHook.triggerName).then(result => {
        if (result) {
          return this.createOrUpdateHook(aHook);
        }
        throw new Parse.Error(143, `class ${aHook.className} does not exist`);
      });
    }
    throw new Parse.Error(143, "invalid hook declaration");
  }
}

exports.HooksController = HooksController;
function wrapToHTTPRequest(hook, key) {
  return (req, res) => {
    const jsonBody = {};
    for (var i in req) {
      jsonBody[i] = req[i];
    }
    if (req.object) {
      jsonBody.object = req.object.toJSON();
      jsonBody.object.className = req.object.className;
    }
    if (req.original) {
      jsonBody.original = req.original.toJSON();
      jsonBody.original.className = req.original.className;
    }
    const jsonRequest = {
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(jsonBody)
    };

    const agent = hook.url.startsWith('https') ? HTTPAgents['https'] : HTTPAgents['http'];
    jsonRequest.agent = agent;

    if (key) {
      jsonRequest.headers['X-Parse-Webhook-Key'] = key;
    } else {
      _logger.logger.warn('Making outgoing webhook request without webhookKey being set!');
    }

    request.post(hook.url, jsonRequest, function (err, httpResponse, body) {
      var result;
      if (body) {
        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch (e) {
            err = {
              error: "Malformed response",
              code: -1,
              partialResponse: body.substring(0, 100)
            };
          }
        }
        if (!err) {
          result = body.success;
          err = body.error;
        }
      }

      if (err) {
        return res.error(err);
      } else if (hook.triggerName === 'beforeSave') {
        if (typeof result === 'object') {
          delete result.createdAt;
          delete result.updatedAt;
        }
        return res.success({ object: result });
      } else {
        return res.success(result);
      }
    });
  };
}

exports.default = HooksController;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9Ib29rc0NvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsidHJpZ2dlcnMiLCJQYXJzZSIsInJlcXVlc3QiLCJEZWZhdWx0SG9va3NDb2xsZWN0aW9uTmFtZSIsIkhUVFBBZ2VudHMiLCJodHRwIiwiQWdlbnQiLCJrZWVwQWxpdmUiLCJodHRwcyIsIkhvb2tzQ29udHJvbGxlciIsImNvbnN0cnVjdG9yIiwiYXBwbGljYXRpb25JZCIsImRhdGFiYXNlQ29udHJvbGxlciIsIndlYmhvb2tLZXkiLCJfYXBwbGljYXRpb25JZCIsIl93ZWJob29rS2V5IiwiZGF0YWJhc2UiLCJsb2FkIiwiX2dldEhvb2tzIiwidGhlbiIsImhvb2tzIiwiZm9yRWFjaCIsImhvb2siLCJhZGRIb29rVG9UcmlnZ2VycyIsImdldEZ1bmN0aW9uIiwiZnVuY3Rpb25OYW1lIiwicmVzdWx0cyIsImdldEZ1bmN0aW9ucyIsIiRleGlzdHMiLCJnZXRUcmlnZ2VyIiwiY2xhc3NOYW1lIiwidHJpZ2dlck5hbWUiLCJnZXRUcmlnZ2VycyIsImRlbGV0ZUZ1bmN0aW9uIiwicmVtb3ZlRnVuY3Rpb24iLCJfcmVtb3ZlSG9va3MiLCJkZWxldGVUcmlnZ2VyIiwicmVtb3ZlVHJpZ2dlciIsInF1ZXJ5IiwiZmluZCIsIm1hcCIsInJlc3VsdCIsIm9iamVjdElkIiwiZGVzdHJveSIsIlByb21pc2UiLCJyZXNvbHZlIiwic2F2ZUhvb2siLCJ1cmwiLCJFcnJvciIsInVwZGF0ZSIsInVwc2VydCIsIndyYXBwZWRGdW5jdGlvbiIsIndyYXBUb0hUVFBSZXF1ZXN0IiwiYWRkVHJpZ2dlciIsImFkZEZ1bmN0aW9uIiwiYWRkSG9vayIsImNyZWF0ZU9yVXBkYXRlSG9vayIsImFIb29rIiwiVHlwZXMiLCJjcmVhdGVIb29rIiwidXBkYXRlSG9vayIsImtleSIsInJlcSIsInJlcyIsImpzb25Cb2R5IiwiaSIsIm9iamVjdCIsInRvSlNPTiIsIm9yaWdpbmFsIiwianNvblJlcXVlc3QiLCJoZWFkZXJzIiwiYm9keSIsIkpTT04iLCJzdHJpbmdpZnkiLCJhZ2VudCIsInN0YXJ0c1dpdGgiLCJ3YXJuIiwicG9zdCIsImVyciIsImh0dHBSZXNwb25zZSIsInBhcnNlIiwiZSIsImVycm9yIiwiY29kZSIsInBhcnRpYWxSZXNwb25zZSIsInN1YnN0cmluZyIsInN1Y2Nlc3MiLCJjcmVhdGVkQXQiLCJ1cGRhdGVkQXQiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFFQTs7SUFBWUEsUTs7QUFFWjs7SUFBWUMsSzs7QUFFWjs7SUFBWUMsTzs7QUFDWjs7QUFDQTs7OztBQUNBOzs7Ozs7OztBQUpBO0FBTEE7O0FBV0EsTUFBTUMsNkJBQTZCLFFBQW5DO0FBUkE7O0FBU0EsTUFBTUMsYUFBYTtBQUNqQkMsUUFBTSxJQUFJLGVBQUtDLEtBQVQsQ0FBZSxFQUFFQyxXQUFXLElBQWIsRUFBZixDQURXO0FBRWpCQyxTQUFPLElBQUksZ0JBQU1GLEtBQVYsQ0FBZ0IsRUFBRUMsV0FBVyxJQUFiLEVBQWhCO0FBRlUsQ0FBbkI7O0FBS08sTUFBTUUsZUFBTixDQUFzQjs7QUFLM0JDLGNBQVlDLGFBQVosRUFBa0NDLGtCQUFsQyxFQUFzREMsVUFBdEQsRUFBa0U7QUFDaEUsU0FBS0MsY0FBTCxHQUFzQkgsYUFBdEI7QUFDQSxTQUFLSSxXQUFMLEdBQW1CRixVQUFuQjtBQUNBLFNBQUtHLFFBQUwsR0FBZ0JKLGtCQUFoQjtBQUNEOztBQUVESyxTQUFPO0FBQ0wsV0FBTyxLQUFLQyxTQUFMLEdBQWlCQyxJQUFqQixDQUFzQkMsU0FBUztBQUNwQ0EsY0FBUUEsU0FBUyxFQUFqQjtBQUNBQSxZQUFNQyxPQUFOLENBQWVDLElBQUQsSUFBVTtBQUN0QixhQUFLQyxpQkFBTCxDQUF1QkQsSUFBdkI7QUFDRCxPQUZEO0FBR0QsS0FMTSxDQUFQO0FBTUQ7O0FBRURFLGNBQVlDLFlBQVosRUFBMEI7QUFDeEIsV0FBTyxLQUFLUCxTQUFMLENBQWUsRUFBRU8sY0FBY0EsWUFBaEIsRUFBZixFQUErQ04sSUFBL0MsQ0FBb0RP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O0FBQ0FSLGdCQUFNUCxLQUFLVyxLQUFYO0FBQ0Q7QUFDRjs7QUFFRCxVQUFJSixHQUFKLEVBQVM7QUFDUCxlQUFPZixJQUFJbUIsS0FBSixDQUFVSixHQUFWLENBQVA7QUFDRCxPQUZELE1BRU8sSUFBSXhELEtBQUtTLFdBQUwsS0FBcUIsWUFBekIsRUFBdUM7QUFDNUMsWUFBSSxPQUFPVSxNQUFQLEtBQWtCLFFBQXRCLEVBQWdDO0FBQzlCLGlCQUFPQSxPQUFPOEMsU0FBZDtBQUNBLGlCQUFPOUMsT0FBTytDLFNBQWQ7QUFDRDtBQUNELGVBQU96QixJQUFJdUIsT0FBSixDQUFZLEVBQUNwQixRQUFRekIsTUFBVCxFQUFaLENBQVA7QUFDRCxPQU5NLE1BTUE7QUFDTCxlQUFPc0IsSUFBSXVCLE9BQUosQ0FBWTdDLE1BQVosQ0FBUDtBQUNEO0FBQ0YsS0EvQkQ7QUFnQ0QsR0E3REQ7QUE4REQ7O2tCQUVjaEMsZSIsImZpbGUiOiJIb29rc0NvbnRyb2xsZXIuanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiogQGZsb3cgd2VhayAqL1xuXG5pbXBvcnQgKiBhcyB0cmlnZ2VycyAgICAgICAgZnJvbSBcIi4uL3RyaWdnZXJzXCI7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCAqIGFzIFBhcnNlICAgICAgICAgICBmcm9tIFwicGFyc2Uvbm9kZVwiO1xuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgKiBhcyByZXF1ZXN0ICAgICAgICAgZnJvbSBcInJlcXVlc3RcIjtcbmltcG9ydCB7IGxvZ2dlciB9ICAgICAgICAgICBmcm9tICcuLi9sb2dnZXInO1xuaW1wb3J0IGh0dHAgICAgICAgICAgICAgICAgIGZyb20gJ2h0dHAnO1xuaW1wb3J0IGh0dHBzICAgICAgICAgICAgICAgIGZyb20gJ2h0dHBzJztcblxuY29uc3QgRGVmYXVsdEhvb2tzQ29sbGVjdGlvbk5hbWUgPSBcIl9Ib29rc1wiO1xuY29uc3QgSFRUUEFnZW50cyA9IHtcbiAgaHR0cDogbmV3IGh0dHAuQWdlbnQoeyBrZWVwQWxpdmU6IHRydWUgfSksXG4gIGh0dHBzOiBuZXcgaHR0cHMuQWdlbnQoeyBrZWVwQWxpdmU6IHRydWUgfSksXG59XG5cbmV4cG9ydCBjbGFzcyBIb29rc0NvbnRyb2xsZXIge1xuICBfYXBwbGljYXRpb25JZDpzdHJpbmc7XG4gIF93ZWJob29rS2V5OnN0cmluZztcbiAgZGF0YWJhc2U6IGFueTtcblxuICBjb25zdHJ1Y3RvcihhcHBsaWNhdGlvbklkOnN0cmluZywgZGF0YWJhc2VDb250cm9sbGVyLCB3ZWJob29rS2V5KSB7XG4gICAgdGhpcy5fYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQ7XG4gICAgdGhpcy5fd2ViaG9va0tleSA9IHdlYmhvb2tLZXk7XG4gICAgdGhpcy5kYXRhYmFzZSA9IGRhdGFiYXNlQ29udHJvbGxlcjtcbiAgfVxuXG4gIGxvYWQoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2dldEhvb2tzKCkudGhlbihob29rcyA9PiB7XG4gICAgICBob29rcyA9IGhvb2tzIHx8IFtdO1xuICAgICAgaG9va3MuZm9yRWFjaCgoaG9vaykgPT4ge1xuICAgICAgICB0aGlzLmFkZEhvb2tUb1RyaWdnZXJzKGhvb2spO1xuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBnZXRGdW5jdGlvbihmdW5jdGlvbk5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5fZ2V0SG9va3MoeyBmdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSB9KS50aGVuKHJlc3VsdHMgPT4gcmVzdWx0c1swXSk7XG4gIH1cblxuICBnZXRGdW5jdGlvbnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2dldEhvb2tzKHsgZnVuY3Rpb25OYW1lOiB7ICRleGlzdHM6IHRydWUgfSB9KTtcbiAgfVxuXG4gIGdldFRyaWdnZXIoY2xhc3NOYW1lLCB0cmlnZ2VyTmFtZSkge1xuICAgIHJldHVybiB0aGlzLl9nZXRIb29rcyh7IGNsYXNzTmFtZTogY2xhc3NOYW1lLCB0cmlnZ2VyTmFtZTogdHJpZ2dlck5hbWUgfSkudGhlbihyZXN1bHRzID0+IHJlc3VsdHNbMF0pO1xuICB9XG5cbiAgZ2V0VHJpZ2dlcnMoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2dldEhvb2tzKHsgY2xhc3NOYW1lOiB7ICRleGlzdHM6IHRydWUgfSwgdHJpZ2dlck5hbWU6IHsgJGV4aXN0czogdHJ1ZSB9IH0pO1xuICB9XG5cbiAgZGVsZXRlRnVuY3Rpb24oZnVuY3Rpb25OYW1lKSB7XG4gICAgdHJpZ2dlcnMucmVtb3ZlRnVuY3Rpb24oZnVuY3Rpb25OYW1lLCB0aGlzLl9hcHBsaWNhdGlvbklkKTtcbiAgICByZXR1cm4gdGhpcy5fcmVtb3ZlSG9va3MoeyBmdW5jdGlvbk5hbWU6IGZ1bmN0aW9uTmFtZSB9KTtcbiAgfVxuXG4gIGRlbGV0ZVRyaWdnZXIoY2xhc3NOYW1lLCB0cmlnZ2VyTmFtZSkge1xuICAgIHRyaWdnZXJzLnJlbW92ZVRyaWdnZXIodHJpZ2dlck5hbWUsIGNsYXNzTmFtZSwgdGhpcy5fYXBwbGljYXRpb25JZCk7XG4gICAgcmV0dXJuIHRoaXMuX3JlbW92ZUhvb2tzKHsgY2xhc3NOYW1lOiBjbGFzc05hbWUsIHRyaWdnZXJOYW1lOiB0cmlnZ2VyTmFtZSB9KTtcbiAgfVxuXG4gIF9nZXRIb29rcyhxdWVyeSA9IHt9KSB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YWJhc2UuZmluZChEZWZhdWx0SG9va3NDb2xsZWN0aW9uTmFtZSwgcXVlcnkpLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgIHJldHVybiByZXN1bHRzLm1hcCgocmVzdWx0KSA9PiB7XG4gICAgICAgIGRlbGV0ZSByZXN1bHQub2JqZWN0SWQ7XG4gICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIF9yZW1vdmVIb29rcyhxdWVyeSkge1xuICAgIHJldHVybiB0aGlzLmRhdGFiYXNlLmRlc3Ryb3koRGVmYXVsdEhvb2tzQ29sbGVjdGlvbk5hbWUsIHF1ZXJ5KS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICAgIH0pO1xuICB9XG5cbiAgc2F2ZUhvb2soaG9vaykge1xuICAgIHZhciBxdWVyeTtcbiAgICBpZiAoaG9vay5mdW5jdGlvbk5hbWUgJiYgaG9vay51cmwpIHtcbiAgICAgIHF1ZXJ5ID0geyBmdW5jdGlvbk5hbWU6IGhvb2suZnVuY3Rpb25OYW1lIH1cbiAgICB9IGVsc2UgaWYgKGhvb2sudHJpZ2dlck5hbWUgJiYgaG9vay5jbGFzc05hbWUgJiYgaG9vay51cmwpIHtcbiAgICAgIHF1ZXJ5ID0geyBjbGFzc05hbWU6IGhvb2suY2xhc3NOYW1lLCB0cmlnZ2VyTmFtZTogaG9vay50cmlnZ2VyTmFtZSB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxNDMsIFwiaW52YWxpZCBob29rIGRlY2xhcmF0aW9uXCIpO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5kYXRhYmFzZS51cGRhdGUoRGVmYXVsdEhvb2tzQ29sbGVjdGlvbk5hbWUsIHF1ZXJ5LCBob29rLCB7dXBzZXJ0OiB0cnVlfSkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKGhvb2spO1xuICAgIH0pXG4gIH1cblxuICBhZGRIb29rVG9UcmlnZ2Vycyhob29rKSB7XG4gICAgdmFyIHdyYXBwZWRGdW5jdGlvbiA9IHdyYXBUb0hUVFBSZXF1ZXN0KGhvb2ssIHRoaXMuX3dlYmhvb2tLZXkpO1xuICAgIHdyYXBwZWRGdW5jdGlvbi51cmwgPSBob29rLnVybDtcbiAgICBpZiAoaG9vay5jbGFzc05hbWUpIHtcbiAgICAgIHRyaWdnZXJzLmFkZFRyaWdnZXIoaG9vay50cmlnZ2VyTmFtZSwgaG9vay5jbGFzc05hbWUsIHdyYXBwZWRGdW5jdGlvbiwgdGhpcy5fYXBwbGljYXRpb25JZClcbiAgICB9IGVsc2Uge1xuICAgICAgdHJpZ2dlcnMuYWRkRnVuY3Rpb24oaG9vay5mdW5jdGlvbk5hbWUsIHdyYXBwZWRGdW5jdGlvbiwgbnVsbCwgdGhpcy5fYXBwbGljYXRpb25JZCk7XG4gICAgfVxuICB9XG5cbiAgYWRkSG9vayhob29rKSB7XG4gICAgdGhpcy5hZGRIb29rVG9UcmlnZ2Vycyhob29rKTtcbiAgICByZXR1cm4gdGhpcy5zYXZlSG9vayhob29rKTtcbiAgfVxuXG4gIGNyZWF0ZU9yVXBkYXRlSG9vayhhSG9vaykge1xuICAgIHZhciBob29rO1xuICAgIGlmIChhSG9vayAmJiBhSG9vay5mdW5jdGlvbk5hbWUgJiYgYUhvb2sudXJsKSB7XG4gICAgICBob29rID0ge307XG4gICAgICBob29rLmZ1bmN0aW9uTmFtZSA9IGFIb29rLmZ1bmN0aW9uTmFtZTtcbiAgICAgIGhvb2sudXJsID0gYUhvb2sudXJsO1xuICAgIH0gZWxzZSBpZiAoYUhvb2sgJiYgYUhvb2suY2xhc3NOYW1lICYmIGFIb29rLnVybCAmJiBhSG9vay50cmlnZ2VyTmFtZSAmJiB0cmlnZ2Vycy5UeXBlc1thSG9vay50cmlnZ2VyTmFtZV0pIHtcbiAgICAgIGhvb2sgPSB7fTtcbiAgICAgIGhvb2suY2xhc3NOYW1lID0gYUhvb2suY2xhc3NOYW1lO1xuICAgICAgaG9vay51cmwgPSBhSG9vay51cmw7XG4gICAgICBob29rLnRyaWdnZXJOYW1lID0gYUhvb2sudHJpZ2dlck5hbWU7XG5cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDE0MywgXCJpbnZhbGlkIGhvb2sgZGVjbGFyYXRpb25cIik7XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXMuYWRkSG9vayhob29rKTtcbiAgfVxuXG4gIGNyZWF0ZUhvb2soYUhvb2spIHtcbiAgICBpZiAoYUhvb2suZnVuY3Rpb25OYW1lKSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXRGdW5jdGlvbihhSG9vay5mdW5jdGlvbk5hbWUpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICBpZiAocmVzdWx0KSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDE0MywgYGZ1bmN0aW9uIG5hbWU6ICR7YUhvb2suZnVuY3Rpb25OYW1lfSBhbHJlYWR5IGV4aXRzYCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuY3JlYXRlT3JVcGRhdGVIb29rKGFIb29rKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChhSG9vay5jbGFzc05hbWUgJiYgYUhvb2sudHJpZ2dlck5hbWUpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldFRyaWdnZXIoYUhvb2suY2xhc3NOYW1lLCBhSG9vay50cmlnZ2VyTmFtZSkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTQzLCBgY2xhc3MgJHthSG9vay5jbGFzc05hbWV9IGFscmVhZHkgaGFzIHRyaWdnZXIgJHthSG9vay50cmlnZ2VyTmFtZX1gKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVPclVwZGF0ZUhvb2soYUhvb2spO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDE0MywgXCJpbnZhbGlkIGhvb2sgZGVjbGFyYXRpb25cIik7XG4gIH1cblxuICB1cGRhdGVIb29rKGFIb29rKSB7XG4gICAgaWYgKGFIb29rLmZ1bmN0aW9uTmFtZSkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0RnVuY3Rpb24oYUhvb2suZnVuY3Rpb25OYW1lKS50aGVuKChyZXN1bHQpID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLmNyZWF0ZU9yVXBkYXRlSG9vayhhSG9vayk7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDE0MywgYG5vIGZ1bmN0aW9uIG5hbWVkOiAke2FIb29rLmZ1bmN0aW9uTmFtZX0gaXMgZGVmaW5lZGApO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmIChhSG9vay5jbGFzc05hbWUgJiYgYUhvb2sudHJpZ2dlck5hbWUpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldFRyaWdnZXIoYUhvb2suY2xhc3NOYW1lLCBhSG9vay50cmlnZ2VyTmFtZSkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgICAgIGlmIChyZXN1bHQpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5jcmVhdGVPclVwZGF0ZUhvb2soYUhvb2spO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigxNDMsIGBjbGFzcyAke2FIb29rLmNsYXNzTmFtZX0gZG9lcyBub3QgZXhpc3RgKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoMTQzLCBcImludmFsaWQgaG9vayBkZWNsYXJhdGlvblwiKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB3cmFwVG9IVFRQUmVxdWVzdChob29rLCBrZXkpIHtcbiAgcmV0dXJuIChyZXEsIHJlcykgPT4ge1xuICAgIGNvbnN0IGpzb25Cb2R5ID0ge307XG4gICAgZm9yICh2YXIgaSBpbiByZXEpIHtcbiAgICAgIGpzb25Cb2R5W2ldID0gcmVxW2ldO1xuICAgIH1cbiAgICBpZiAocmVxLm9iamVjdCkge1xuICAgICAganNvbkJvZHkub2JqZWN0ID0gcmVxLm9iamVjdC50b0pTT04oKTtcbiAgICAgIGpzb25Cb2R5Lm9iamVjdC5jbGFzc05hbWUgPSByZXEub2JqZWN0LmNsYXNzTmFtZTtcbiAgICB9XG4gICAgaWYgKHJlcS5vcmlnaW5hbCkge1xuICAgICAganNvbkJvZHkub3JpZ2luYWwgPSByZXEub3JpZ2luYWwudG9KU09OKCk7XG4gICAgICBqc29uQm9keS5vcmlnaW5hbC5jbGFzc05hbWUgPSByZXEub3JpZ2luYWwuY2xhc3NOYW1lO1xuICAgIH1cbiAgICBjb25zdCBqc29uUmVxdWVzdDogYW55ID0ge1xuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXG4gICAgICB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoanNvbkJvZHkpLFxuICAgIH07XG5cbiAgICBjb25zdCBhZ2VudCA9IGhvb2sudXJsLnN0YXJ0c1dpdGgoJ2h0dHBzJykgPyBIVFRQQWdlbnRzWydodHRwcyddIDogSFRUUEFnZW50c1snaHR0cCddO1xuICAgIGpzb25SZXF1ZXN0LmFnZW50ID0gYWdlbnQ7XG5cbiAgICBpZiAoa2V5KSB7XG4gICAgICBqc29uUmVxdWVzdC5oZWFkZXJzWydYLVBhcnNlLVdlYmhvb2stS2V5J10gPSBrZXk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxvZ2dlci53YXJuKCdNYWtpbmcgb3V0Z29pbmcgd2ViaG9vayByZXF1ZXN0IHdpdGhvdXQgd2ViaG9va0tleSBiZWluZyBzZXQhJyk7XG4gICAgfVxuXG4gICAgcmVxdWVzdC5wb3N0KGhvb2sudXJsLCBqc29uUmVxdWVzdCwgZnVuY3Rpb24gKGVyciwgaHR0cFJlc3BvbnNlLCBib2R5KSB7XG4gICAgICB2YXIgcmVzdWx0O1xuICAgICAgaWYgKGJvZHkpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBib2R5ID09PSBcInN0cmluZ1wiKSB7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGJvZHkgPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgIGVyciA9IHtcbiAgICAgICAgICAgICAgZXJyb3I6IFwiTWFsZm9ybWVkIHJlc3BvbnNlXCIsXG4gICAgICAgICAgICAgIGNvZGU6IC0xLFxuICAgICAgICAgICAgICBwYXJ0aWFsUmVzcG9uc2U6IGJvZHkuc3Vic3RyaW5nKDAsIDEwMClcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICghZXJyKSB7XG4gICAgICAgICAgcmVzdWx0ID0gYm9keS5zdWNjZXNzO1xuICAgICAgICAgIGVyciA9IGJvZHkuZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGVycikge1xuICAgICAgICByZXR1cm4gcmVzLmVycm9yKGVycik7XG4gICAgICB9IGVsc2UgaWYgKGhvb2sudHJpZ2dlck5hbWUgPT09ICdiZWZvcmVTYXZlJykge1xuICAgICAgICBpZiAodHlwZW9mIHJlc3VsdCA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICBkZWxldGUgcmVzdWx0LmNyZWF0ZWRBdDtcbiAgICAgICAgICBkZWxldGUgcmVzdWx0LnVwZGF0ZWRBdDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcmVzLnN1Y2Nlc3Moe29iamVjdDogcmVzdWx0fSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gcmVzLnN1Y2Nlc3MocmVzdWx0KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBIb29rc0NvbnRyb2xsZXI7XG4iXX0=