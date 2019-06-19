'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Types = undefined;
exports.addFunction = addFunction;
exports.addJob = addJob;
exports.addTrigger = addTrigger;
exports.addLiveQueryEventHandler = addLiveQueryEventHandler;
exports.removeFunction = removeFunction;
exports.removeTrigger = removeTrigger;
exports._unregisterAll = _unregisterAll;
exports.getTrigger = getTrigger;
exports.triggerExists = triggerExists;
exports.getFunction = getFunction;
exports.getJob = getJob;
exports.getJobs = getJobs;
exports.getValidator = getValidator;
exports.getRequestObject = getRequestObject;
exports.getRequestQueryObject = getRequestQueryObject;
exports.getResponseObject = getResponseObject;
exports.maybeRunAfterFindTrigger = maybeRunAfterFindTrigger;
exports.maybeRunQueryTrigger = maybeRunQueryTrigger;
exports.maybeRunTrigger = maybeRunTrigger;
exports.inflate = inflate;
exports.runLiveQueryEventHandlers = runLiveQueryEventHandlers;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _logger = require('./logger');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// triggers.js
const Types = exports.Types = {
  beforeSave: 'beforeSave',
  afterSave: 'afterSave',
  beforeDelete: 'beforeDelete',
  afterDelete: 'afterDelete',
  beforeFind: 'beforeFind',
  afterFind: 'afterFind'
};

const baseStore = function () {
  const Validators = {};
  const Functions = {};
  const Jobs = {};
  const LiveQuery = [];
  const Triggers = Object.keys(Types).reduce(function (base, key) {
    base[key] = {};
    return base;
  }, {});

  return Object.freeze({
    Functions,
    Jobs,
    Validators,
    Triggers,
    LiveQuery
  });
};

function validateClassNameForTriggers(className, type) {
  const restrictedClassNames = ['_Session'];
  if (restrictedClassNames.indexOf(className) != -1) {
    throw `Triggers are not supported for ${className} class.`;
  }
  if (type == Types.beforeSave && className === '_PushStatus') {
    // _PushStatus uses undocumented nested key increment ops
    // allowing beforeSave would mess up the objects big time
    // TODO: Allow proper documented way of using nested increment ops
    throw 'Only afterSave is allowed on _PushStatus';
  }
  return className;
}

const _triggerStore = {};

function addFunction(functionName, handler, validationHandler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Functions[functionName] = handler;
  _triggerStore[applicationId].Validators[functionName] = validationHandler;
}

function addJob(jobName, handler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Jobs[jobName] = handler;
}

function addTrigger(type, className, handler, applicationId) {
  validateClassNameForTriggers(className, type);
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].Triggers[type][className] = handler;
}

function addLiveQueryEventHandler(handler, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  _triggerStore[applicationId] = _triggerStore[applicationId] || baseStore();
  _triggerStore[applicationId].LiveQuery.push(handler);
}

function removeFunction(functionName, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  delete _triggerStore[applicationId].Functions[functionName];
}

function removeTrigger(type, className, applicationId) {
  applicationId = applicationId || _node2.default.applicationId;
  delete _triggerStore[applicationId].Triggers[type][className];
}

function _unregisterAll() {
  Object.keys(_triggerStore).forEach(appId => delete _triggerStore[appId]);
}

function getTrigger(className, triggerType, applicationId) {
  if (!applicationId) {
    throw "Missing ApplicationID";
  }
  var manager = _triggerStore[applicationId];
  if (manager && manager.Triggers && manager.Triggers[triggerType] && manager.Triggers[triggerType][className]) {
    return manager.Triggers[triggerType][className];
  }
  return undefined;
}

function triggerExists(className, type, applicationId) {
  return getTrigger(className, type, applicationId) != undefined;
}

function getFunction(functionName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Functions) {
    return manager.Functions[functionName];
  }
  return undefined;
}

function getJob(jobName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Jobs) {
    return manager.Jobs[jobName];
  }
  return undefined;
}

function getJobs(applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Jobs) {
    return manager.Jobs;
  }
  return undefined;
}

function getValidator(functionName, applicationId) {
  var manager = _triggerStore[applicationId];
  if (manager && manager.Validators) {
    return manager.Validators[functionName];
  }
  return undefined;
}

function getRequestObject(triggerType, auth, parseObject, originalParseObject, config) {
  var request = {
    triggerName: triggerType,
    object: parseObject,
    master: false,
    log: config.loggerController,
    headers: config.headers,
    ip: config.ip
  };

  if (originalParseObject) {
    request.original = originalParseObject;
  }

  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}

function getRequestQueryObject(triggerType, auth, query, count, config, isGet) {
  isGet = !!isGet;

  var request = {
    triggerName: triggerType,
    query,
    master: false,
    count,
    log: config.loggerController,
    isGet,
    headers: config.headers,
    ip: config.ip
  };

  if (!auth) {
    return request;
  }
  if (auth.isMaster) {
    request['master'] = true;
  }
  if (auth.user) {
    request['user'] = auth.user;
  }
  if (auth.installationId) {
    request['installationId'] = auth.installationId;
  }
  return request;
}

// Creates the response object, and uses the request object to pass data
// The API will call this with REST API formatted objects, this will
// transform them to Parse.Object instances expected by Cloud Code.
// Any changes made to the object in a beforeSave will be included.
function getResponseObject(request, resolve, reject) {
  return {
    success: function (response) {
      if (request.triggerName === Types.afterFind) {
        if (!response) {
          response = request.objects;
        }
        response = response.map(object => {
          return object.toJSON();
        });
        return resolve(response);
      }
      // Use the JSON response
      if (response && !request.object.equals(response) && request.triggerName === Types.beforeSave) {
        return resolve(response);
      }
      response = {};
      if (request.triggerName === Types.beforeSave) {
        response['object'] = request.object._getSaveJSON();
      }
      return resolve(response);
    },
    error: function (code, message) {
      if (!message) {
        if (code instanceof _node2.default.Error) {
          return reject(code);
        }
        message = code;
        code = _node2.default.Error.SCRIPT_FAILED;
      }
      var scriptError = new _node2.default.Error(code, message);
      return reject(scriptError);
    }
  };
}

function userIdForLog(auth) {
  return auth && auth.user ? auth.user.id : undefined;
}

function logTriggerAfterHook(triggerType, className, input, auth) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger.info(`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}

function logTriggerSuccessBeforeHook(triggerType, className, input, result, auth) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  const cleanResult = _logger.logger.truncateLogMessage(JSON.stringify(result));
  _logger.logger.info(`${triggerType} triggered for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Result: ${cleanResult}`, {
    className,
    triggerType,
    user: userIdForLog(auth)
  });
}

function logTriggerErrorBeforeHook(triggerType, className, input, auth, error) {
  const cleanInput = _logger.logger.truncateLogMessage(JSON.stringify(input));
  _logger.logger.error(`${triggerType} failed for ${className} for user ${userIdForLog(auth)}:\n  Input: ${cleanInput}\n  Error: ${JSON.stringify(error)}`, {
    className,
    triggerType,
    error,
    user: userIdForLog(auth)
  });
}

function maybeRunAfterFindTrigger(triggerType, auth, className, objects, config) {
  return new Promise((resolve, reject) => {
    const trigger = getTrigger(className, triggerType, config.applicationId);
    if (!trigger) {
      return resolve();
    }
    const request = getRequestObject(triggerType, auth, null, null, config);
    const response = getResponseObject(request, object => {
      resolve(object);
    }, error => {
      reject(error);
    });
    logTriggerSuccessBeforeHook(triggerType, className, 'AfterFind', JSON.stringify(objects), auth);
    request.objects = objects.map(object => {
      //setting the class name to transform into parse object
      object.className = className;
      return _node2.default.Object.fromJSON(object);
    });
    const triggerPromise = trigger(request, response);
    if (triggerPromise && typeof triggerPromise.then === "function") {
      return triggerPromise.then(promiseResults => {
        if (promiseResults) {
          resolve(promiseResults);
        } else {
          return reject(new _node2.default.Error(_node2.default.Error.SCRIPT_FAILED, "AfterFind expect results to be returned in the promise"));
        }
      });
    }
  }).then(results => {
    logTriggerAfterHook(triggerType, className, JSON.stringify(results), auth);
    return results;
  });
}

function maybeRunQueryTrigger(triggerType, className, restWhere, restOptions, config, auth, isGet) {
  const trigger = getTrigger(className, triggerType, config.applicationId);
  if (!trigger) {
    return Promise.resolve({
      restWhere,
      restOptions
    });
  }

  const parseQuery = new _node2.default.Query(className);
  if (restWhere) {
    parseQuery._where = restWhere;
  }
  let count = false;
  if (restOptions) {
    if (restOptions.include && restOptions.include.length > 0) {
      parseQuery._include = restOptions.include.split(',');
    }
    if (restOptions.skip) {
      parseQuery._skip = restOptions.skip;
    }
    if (restOptions.limit) {
      parseQuery._limit = restOptions.limit;
    }
    count = !!restOptions.count;
  }
  const requestObject = getRequestQueryObject(triggerType, auth, parseQuery, count, config, isGet);
  return Promise.resolve().then(() => {
    return trigger(requestObject);
  }).then(result => {
    let queryResult = parseQuery;
    if (result && result instanceof _node2.default.Query) {
      queryResult = result;
    }
    const jsonQuery = queryResult.toJSON();
    if (jsonQuery.where) {
      restWhere = jsonQuery.where;
    }
    if (jsonQuery.limit) {
      restOptions = restOptions || {};
      restOptions.limit = jsonQuery.limit;
    }
    if (jsonQuery.skip) {
      restOptions = restOptions || {};
      restOptions.skip = jsonQuery.skip;
    }
    if (jsonQuery.include) {
      restOptions = restOptions || {};
      restOptions.include = jsonQuery.include;
    }
    if (jsonQuery.keys) {
      restOptions = restOptions || {};
      restOptions.keys = jsonQuery.keys;
    }
    if (jsonQuery.order) {
      restOptions = restOptions || {};
      restOptions.order = jsonQuery.order;
    }
    if (requestObject.readPreference) {
      restOptions = restOptions || {};
      restOptions.readPreference = requestObject.readPreference;
    }
    if (requestObject.includeReadPreference) {
      restOptions = restOptions || {};
      restOptions.includeReadPreference = requestObject.includeReadPreference;
    }
    if (requestObject.subqueryReadPreference) {
      restOptions = restOptions || {};
      restOptions.subqueryReadPreference = requestObject.subqueryReadPreference;
    }
    return {
      restWhere,
      restOptions
    };
  }, err => {
    if (typeof err === 'string') {
      throw new _node2.default.Error(1, err);
    } else {
      throw err;
    }
  });
}

// To be used as part of the promise chain when saving/deleting an object
// Will resolve successfully if no trigger is configured
// Resolves to an object, empty or containing an object key. A beforeSave
// trigger will set the object key to the rest format object to save.
// originalParseObject is optional, we only need that for before/afterSave functions
function maybeRunTrigger(triggerType, auth, parseObject, originalParseObject, config) {
  if (!parseObject) {
    return Promise.resolve({});
  }
  return new Promise(function (resolve, reject) {
    var trigger = getTrigger(parseObject.className, triggerType, config.applicationId);
    if (!trigger) return resolve();
    var request = getRequestObject(triggerType, auth, parseObject, originalParseObject, config);
    var response = getResponseObject(request, object => {
      logTriggerSuccessBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), object, auth);
      resolve(object);
    }, error => {
      logTriggerErrorBeforeHook(triggerType, parseObject.className, parseObject.toJSON(), auth, error);
      reject(error);
    });
    // Force the current Parse app before the trigger
    _node2.default.applicationId = config.applicationId;
    _node2.default.javascriptKey = config.javascriptKey || '';
    _node2.default.masterKey = config.masterKey;

    // AfterSave and afterDelete triggers can return a promise, which if they
    // do, needs to be resolved before this promise is resolved,
    // so trigger execution is synced with RestWrite.execute() call.
    // If triggers do not return a promise, they can run async code parallel
    // to the RestWrite.execute() call.
    var triggerPromise = trigger(request, response);
    if (triggerType === Types.afterSave || triggerType === Types.afterDelete) {
      logTriggerAfterHook(triggerType, parseObject.className, parseObject.toJSON(), auth);
      if (triggerPromise && typeof triggerPromise.then === "function") {
        return triggerPromise.then(resolve, resolve);
      } else {
        return resolve();
      }
    }
  });
}

// Converts a REST-format object to a Parse.Object
// data is either className or an object
function inflate(data, restObject) {
  var copy = typeof data == 'object' ? data : { className: data };
  for (var key in restObject) {
    copy[key] = restObject[key];
  }
  return _node2.default.Object.fromJSON(copy);
}

function runLiveQueryEventHandlers(data, applicationId = _node2.default.applicationId) {
  if (!_triggerStore || !_triggerStore[applicationId] || !_triggerStore[applicationId].LiveQuery) {
    return;
  }
  _triggerStore[applicationId].LiveQuery.forEach(handler => handler(data));
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy90cmlnZ2Vycy5qcyJdLCJuYW1lcyI6WyJhZGRGdW5jdGlvbiIsImFkZEpvYiIsImFkZFRyaWdnZXIiLCJhZGRMaXZlUXVlcnlFdmVudEhhbmRsZXIiLCJyZW1vdmVGdW5jdGlvbiIsInJlbW92ZVRyaWdnZXIiLCJfdW5yZWdpc3RlckFsbCIsImdldFRyaWdnZXIiLCJ0cmlnZ2VyRXhpc3RzIiwiZ2V0RnVuY3Rpb24iLCJnZXRKb2IiLCJnZXRKb2JzIiwiZ2V0VmFsaWRhdG9yIiwiZ2V0UmVxdWVzdE9iamVjdCIsImdldFJlcXVlc3RRdWVyeU9iamVjdCIsImdldFJlc3BvbnNlT2JqZWN0IiwibWF5YmVSdW5BZnRlckZpbmRUcmlnZ2VyIiwibWF5YmVSdW5RdWVyeVRyaWdnZXIiLCJtYXliZVJ1blRyaWdnZXIiLCJpbmZsYXRlIiwicnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyIsIlR5cGVzIiwiYmVmb3JlU2F2ZSIsImFmdGVyU2F2ZSIsImJlZm9yZURlbGV0ZSIsImFmdGVyRGVsZXRlIiwiYmVmb3JlRmluZCIsImFmdGVyRmluZCIsImJhc2VTdG9yZSIsIlZhbGlkYXRvcnMiLCJGdW5jdGlvbnMiLCJKb2JzIiwiTGl2ZVF1ZXJ5IiwiVHJpZ2dlcnMiLCJPYmplY3QiLCJrZXlzIiwicmVkdWNlIiwiYmFzZSIsImtleSIsImZyZWV6ZSIsInZhbGlkYXRlQ2xhc3NOYW1lRm9yVHJpZ2dlcnMiLCJjbGFzc05hbWUiLCJ0eXBlIiwicmVzdHJpY3RlZENsYXNzTmFtZXMiLCJpbmRleE9mIiwiX3RyaWdnZXJTdG9yZSIsImZ1bmN0aW9uTmFtZSIsImhhbmRsZXIiLCJ2YWxpZGF0aW9uSGFuZGxlciIsImFwcGxpY2F0aW9uSWQiLCJqb2JOYW1lIiwicHVzaCIsImZvckVhY2giLCJhcHBJZCIsInRyaWdnZXJUeXBlIiwibWFuYWdlciIsInVuZGVmaW5lZCIsImF1dGgiLCJwYXJzZU9iamVjdCIsIm9yaWdpbmFsUGFyc2VPYmplY3QiLCJjb25maWciLCJyZXF1ZXN0IiwidHJpZ2dlck5hbWUiLCJvYmplY3QiLCJtYXN0ZXIiLCJsb2ciLCJsb2dnZXJDb250cm9sbGVyIiwiaGVhZGVycyIsImlwIiwib3JpZ2luYWwiLCJpc01hc3RlciIsInVzZXIiLCJpbnN0YWxsYXRpb25JZCIsInF1ZXJ5IiwiY291bnQiLCJpc0dldCIsInJlc29sdmUiLCJyZWplY3QiLCJzdWNjZXNzIiwicmVzcG9uc2UiLCJvYmplY3RzIiwibWFwIiwidG9KU09OIiwiZXF1YWxzIiwiX2dldFNhdmVKU09OIiwiZXJyb3IiLCJjb2RlIiwibWVzc2FnZSIsIkVycm9yIiwiU0NSSVBUX0ZBSUxFRCIsInNjcmlwdEVycm9yIiwidXNlcklkRm9yTG9nIiwiaWQiLCJsb2dUcmlnZ2VyQWZ0ZXJIb29rIiwiaW5wdXQiLCJjbGVhbklucHV0IiwidHJ1bmNhdGVMb2dNZXNzYWdlIiwiSlNPTiIsInN0cmluZ2lmeSIsImluZm8iLCJsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2siLCJyZXN1bHQiLCJjbGVhblJlc3VsdCIsImxvZ1RyaWdnZXJFcnJvckJlZm9yZUhvb2siLCJQcm9taXNlIiwidHJpZ2dlciIsImZyb21KU09OIiwidHJpZ2dlclByb21pc2UiLCJ0aGVuIiwicHJvbWlzZVJlc3VsdHMiLCJyZXN1bHRzIiwicmVzdFdoZXJlIiwicmVzdE9wdGlvbnMiLCJwYXJzZVF1ZXJ5IiwiUXVlcnkiLCJfd2hlcmUiLCJpbmNsdWRlIiwibGVuZ3RoIiwiX2luY2x1ZGUiLCJzcGxpdCIsInNraXAiLCJfc2tpcCIsImxpbWl0IiwiX2xpbWl0IiwicmVxdWVzdE9iamVjdCIsInF1ZXJ5UmVzdWx0IiwianNvblF1ZXJ5Iiwid2hlcmUiLCJvcmRlciIsInJlYWRQcmVmZXJlbmNlIiwiaW5jbHVkZVJlYWRQcmVmZXJlbmNlIiwic3VicXVlcnlSZWFkUHJlZmVyZW5jZSIsImVyciIsImphdmFzY3JpcHRLZXkiLCJtYXN0ZXJLZXkiLCJkYXRhIiwicmVzdE9iamVjdCIsImNvcHkiXSwibWFwcGluZ3MiOiI7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QUErQixVQUFwRCxFQUFnRTtBQUM5RCxlQUFPRCxlQUFlQyxJQUFmLENBQW9CaEMsT0FBcEIsRUFBNkJBLE9BQTdCLENBQVA7QUFDRCxPQUZELE1BR0s7QUFDSCxlQUFPQSxTQUFQO0FBQ0Q7QUFDRjtBQUNGLEdBbENNLENBQVA7QUFtQ0Q7O0FBRUQ7QUFDQTtBQUNPLFNBQVN6RCxPQUFULENBQWlCb0gsSUFBakIsRUFBdUJDLFVBQXZCLEVBQW1DO0FBQ3hDLE1BQUlDLE9BQU8sT0FBT0YsSUFBUCxJQUFlLFFBQWYsR0FBMEJBLElBQTFCLEdBQWlDLEVBQUM5RixXQUFXOEYsSUFBWixFQUE1QztBQUNBLE9BQUssSUFBSWpHLEdBQVQsSUFBZ0JrRyxVQUFoQixFQUE0QjtBQUMxQkMsU0FBS25HLEdBQUwsSUFBWWtHLFdBQVdsRyxHQUFYLENBQVo7QUFDRDtBQUNELFNBQU8sZUFBTUosTUFBTixDQUFhd0UsUUFBYixDQUFzQitCLElBQXRCLENBQVA7QUFDRDs7QUFFTSxTQUFTckgseUJBQVQsQ0FBbUNtSCxJQUFuQyxFQUF5Q3RGLGdCQUFnQixlQUFNQSxhQUEvRCxFQUE4RTtBQUNuRixNQUFJLENBQUNKLGFBQUQsSUFBa0IsQ0FBQ0EsY0FBY0ksYUFBZCxDQUFuQixJQUFtRCxDQUFDSixjQUFjSSxhQUFkLEVBQTZCakIsU0FBckYsRUFBZ0c7QUFBRTtBQUFTO0FBQzNHYSxnQkFBY0ksYUFBZCxFQUE2QmpCLFNBQTdCLENBQXVDb0IsT0FBdkMsQ0FBZ0RMLE9BQUQsSUFBYUEsUUFBUXdGLElBQVIsQ0FBNUQ7QUFDRCIsImZpbGUiOiJ0cmlnZ2Vycy5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIHRyaWdnZXJzLmpzXG5pbXBvcnQgUGFyc2UgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgeyBsb2dnZXIgfSBmcm9tICcuL2xvZ2dlcic7XG5cbmV4cG9ydCBjb25zdCBUeXBlcyA9IHtcbiAgYmVmb3JlU2F2ZTogJ2JlZm9yZVNhdmUnLFxuICBhZnRlclNhdmU6ICdhZnRlclNhdmUnLFxuICBiZWZvcmVEZWxldGU6ICdiZWZvcmVEZWxldGUnLFxuICBhZnRlckRlbGV0ZTogJ2FmdGVyRGVsZXRlJyxcbiAgYmVmb3JlRmluZDogJ2JlZm9yZUZpbmQnLFxuICBhZnRlckZpbmQ6ICdhZnRlckZpbmQnXG59O1xuXG5jb25zdCBiYXNlU3RvcmUgPSBmdW5jdGlvbigpIHtcbiAgY29uc3QgVmFsaWRhdG9ycyA9IHt9O1xuICBjb25zdCBGdW5jdGlvbnMgPSB7fTtcbiAgY29uc3QgSm9icyA9IHt9O1xuICBjb25zdCBMaXZlUXVlcnkgPSBbXTtcbiAgY29uc3QgVHJpZ2dlcnMgPSBPYmplY3Qua2V5cyhUeXBlcykucmVkdWNlKGZ1bmN0aW9uKGJhc2UsIGtleSl7XG4gICAgYmFzZVtrZXldID0ge307XG4gICAgcmV0dXJuIGJhc2U7XG4gIH0sIHt9KTtcblxuICByZXR1cm4gT2JqZWN0LmZyZWV6ZSh7XG4gICAgRnVuY3Rpb25zLFxuICAgIEpvYnMsXG4gICAgVmFsaWRhdG9ycyxcbiAgICBUcmlnZ2VycyxcbiAgICBMaXZlUXVlcnksXG4gIH0pO1xufTtcblxuZnVuY3Rpb24gdmFsaWRhdGVDbGFzc05hbWVGb3JUcmlnZ2VycyhjbGFzc05hbWUsIHR5cGUpIHtcbiAgY29uc3QgcmVzdHJpY3RlZENsYXNzTmFtZXMgPSBbICdfU2Vzc2lvbicgXTtcbiAgaWYgKHJlc3RyaWN0ZWRDbGFzc05hbWVzLmluZGV4T2YoY2xhc3NOYW1lKSAhPSAtMSkge1xuICAgIHRocm93IGBUcmlnZ2VycyBhcmUgbm90IHN1cHBvcnRlZCBmb3IgJHtjbGFzc05hbWV9IGNsYXNzLmA7XG4gIH1cbiAgaWYgKHR5cGUgPT0gVHlwZXMuYmVmb3JlU2F2ZSAmJiBjbGFzc05hbWUgPT09ICdfUHVzaFN0YXR1cycpIHtcbiAgICAvLyBfUHVzaFN0YXR1cyB1c2VzIHVuZG9jdW1lbnRlZCBuZXN0ZWQga2V5IGluY3JlbWVudCBvcHNcbiAgICAvLyBhbGxvd2luZyBiZWZvcmVTYXZlIHdvdWxkIG1lc3MgdXAgdGhlIG9iamVjdHMgYmlnIHRpbWVcbiAgICAvLyBUT0RPOiBBbGxvdyBwcm9wZXIgZG9jdW1lbnRlZCB3YXkgb2YgdXNpbmcgbmVzdGVkIGluY3JlbWVudCBvcHNcbiAgICB0aHJvdyAnT25seSBhZnRlclNhdmUgaXMgYWxsb3dlZCBvbiBfUHVzaFN0YXR1cyc7XG4gIH1cbiAgcmV0dXJuIGNsYXNzTmFtZTtcbn1cblxuY29uc3QgX3RyaWdnZXJTdG9yZSA9IHt9O1xuXG5leHBvcnQgZnVuY3Rpb24gYWRkRnVuY3Rpb24oZnVuY3Rpb25OYW1lLCBoYW5kbGVyLCB2YWxpZGF0aW9uSGFuZGxlciwgYXBwbGljYXRpb25JZCkge1xuICBhcHBsaWNhdGlvbklkID0gYXBwbGljYXRpb25JZCB8fCBQYXJzZS5hcHBsaWNhdGlvbklkO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdID0gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gfHwgYmFzZVN0b3JlKCk7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uRnVuY3Rpb25zW2Z1bmN0aW9uTmFtZV0gPSBoYW5kbGVyO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLlZhbGlkYXRvcnNbZnVuY3Rpb25OYW1lXSA9IHZhbGlkYXRpb25IYW5kbGVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkSm9iKGpvYk5hbWUsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpIHtcbiAgYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgX3RyaWdnZXJTdG9yZVthcHBsaWNhdGlvbklkXSA9ICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdIHx8IGJhc2VTdG9yZSgpO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLkpvYnNbam9iTmFtZV0gPSBoYW5kbGVyO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYWRkVHJpZ2dlcih0eXBlLCBjbGFzc05hbWUsIGhhbmRsZXIsIGFwcGxpY2F0aW9uSWQpIHtcbiAgdmFsaWRhdGVDbGFzc05hbWVGb3JUcmlnZ2VycyhjbGFzc05hbWUsIHR5cGUpO1xuICBhcHBsaWNhdGlvbklkID0gYXBwbGljYXRpb25JZCB8fCBQYXJzZS5hcHBsaWNhdGlvbklkO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdID0gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gfHwgYmFzZVN0b3JlKCk7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uVHJpZ2dlcnNbdHlwZV1bY2xhc3NOYW1lXSA9IGhhbmRsZXI7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRMaXZlUXVlcnlFdmVudEhhbmRsZXIoaGFuZGxlciwgYXBwbGljYXRpb25JZCkge1xuICBhcHBsaWNhdGlvbklkID0gYXBwbGljYXRpb25JZCB8fCBQYXJzZS5hcHBsaWNhdGlvbklkO1xuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdID0gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gfHwgYmFzZVN0b3JlKCk7XG4gIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uTGl2ZVF1ZXJ5LnB1c2goaGFuZGxlcik7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVGdW5jdGlvbihmdW5jdGlvbk5hbWUsIGFwcGxpY2F0aW9uSWQpIHtcbiAgYXBwbGljYXRpb25JZCA9IGFwcGxpY2F0aW9uSWQgfHwgUGFyc2UuYXBwbGljYXRpb25JZDtcbiAgZGVsZXRlIF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uRnVuY3Rpb25zW2Z1bmN0aW9uTmFtZV1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZVRyaWdnZXIodHlwZSwgY2xhc3NOYW1lLCBhcHBsaWNhdGlvbklkKSB7XG4gIGFwcGxpY2F0aW9uSWQgPSBhcHBsaWNhdGlvbklkIHx8IFBhcnNlLmFwcGxpY2F0aW9uSWQ7XG4gIGRlbGV0ZSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLlRyaWdnZXJzW3R5cGVdW2NsYXNzTmFtZV1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIF91bnJlZ2lzdGVyQWxsKCkge1xuICBPYmplY3Qua2V5cyhfdHJpZ2dlclN0b3JlKS5mb3JFYWNoKGFwcElkID0+IGRlbGV0ZSBfdHJpZ2dlclN0b3JlW2FwcElkXSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgdHJpZ2dlclR5cGUsIGFwcGxpY2F0aW9uSWQpIHtcbiAgaWYgKCFhcHBsaWNhdGlvbklkKSB7XG4gICAgdGhyb3cgXCJNaXNzaW5nIEFwcGxpY2F0aW9uSURcIjtcbiAgfVxuICB2YXIgbWFuYWdlciA9IF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF1cbiAgaWYgKG1hbmFnZXJcbiAgICAmJiBtYW5hZ2VyLlRyaWdnZXJzXG4gICAgJiYgbWFuYWdlci5UcmlnZ2Vyc1t0cmlnZ2VyVHlwZV1cbiAgICAmJiBtYW5hZ2VyLlRyaWdnZXJzW3RyaWdnZXJUeXBlXVtjbGFzc05hbWVdKSB7XG4gICAgcmV0dXJuIG1hbmFnZXIuVHJpZ2dlcnNbdHJpZ2dlclR5cGVdW2NsYXNzTmFtZV07XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRyaWdnZXJFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIHR5cGU6IHN0cmluZywgYXBwbGljYXRpb25JZDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiAoZ2V0VHJpZ2dlcihjbGFzc05hbWUsIHR5cGUsIGFwcGxpY2F0aW9uSWQpICE9IHVuZGVmaW5lZCk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRGdW5jdGlvbihmdW5jdGlvbk5hbWUsIGFwcGxpY2F0aW9uSWQpIHtcbiAgdmFyIG1hbmFnZXIgPSBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdO1xuICBpZiAobWFuYWdlciAmJiBtYW5hZ2VyLkZ1bmN0aW9ucykge1xuICAgIHJldHVybiBtYW5hZ2VyLkZ1bmN0aW9uc1tmdW5jdGlvbk5hbWVdO1xuICB9XG4gIHJldHVybiB1bmRlZmluZWQ7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRKb2Ioam9iTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICB2YXIgbWFuYWdlciA9IF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF07XG4gIGlmIChtYW5hZ2VyICYmIG1hbmFnZXIuSm9icykge1xuICAgIHJldHVybiBtYW5hZ2VyLkpvYnNbam9iTmFtZV07XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldEpvYnMoYXBwbGljYXRpb25JZCkge1xuICB2YXIgbWFuYWdlciA9IF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF07XG4gIGlmIChtYW5hZ2VyICYmIG1hbmFnZXIuSm9icykge1xuICAgIHJldHVybiBtYW5hZ2VyLkpvYnM7XG4gIH1cbiAgcmV0dXJuIHVuZGVmaW5lZDtcbn1cblxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VmFsaWRhdG9yKGZ1bmN0aW9uTmFtZSwgYXBwbGljYXRpb25JZCkge1xuICB2YXIgbWFuYWdlciA9IF90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF07XG4gIGlmIChtYW5hZ2VyICYmIG1hbmFnZXIuVmFsaWRhdG9ycykge1xuICAgIHJldHVybiBtYW5hZ2VyLlZhbGlkYXRvcnNbZnVuY3Rpb25OYW1lXTtcbiAgfVxuICByZXR1cm4gdW5kZWZpbmVkO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmVxdWVzdE9iamVjdCh0cmlnZ2VyVHlwZSwgYXV0aCwgcGFyc2VPYmplY3QsIG9yaWdpbmFsUGFyc2VPYmplY3QsIGNvbmZpZykge1xuICB2YXIgcmVxdWVzdCA9IHtcbiAgICB0cmlnZ2VyTmFtZTogdHJpZ2dlclR5cGUsXG4gICAgb2JqZWN0OiBwYXJzZU9iamVjdCxcbiAgICBtYXN0ZXI6IGZhbHNlLFxuICAgIGxvZzogY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIsXG4gICAgaGVhZGVyczogY29uZmlnLmhlYWRlcnMsXG4gICAgaXA6IGNvbmZpZy5pcCxcbiAgfTtcblxuICBpZiAob3JpZ2luYWxQYXJzZU9iamVjdCkge1xuICAgIHJlcXVlc3Qub3JpZ2luYWwgPSBvcmlnaW5hbFBhcnNlT2JqZWN0O1xuICB9XG5cbiAgaWYgKCFhdXRoKSB7XG4gICAgcmV0dXJuIHJlcXVlc3Q7XG4gIH1cbiAgaWYgKGF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXF1ZXN0WydtYXN0ZXInXSA9IHRydWU7XG4gIH1cbiAgaWYgKGF1dGgudXNlcikge1xuICAgIHJlcXVlc3RbJ3VzZXInXSA9IGF1dGgudXNlcjtcbiAgfVxuICBpZiAoYXV0aC5pbnN0YWxsYXRpb25JZCkge1xuICAgIHJlcXVlc3RbJ2luc3RhbGxhdGlvbklkJ10gPSBhdXRoLmluc3RhbGxhdGlvbklkO1xuICB9XG4gIHJldHVybiByZXF1ZXN0O1xufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmVxdWVzdFF1ZXJ5T2JqZWN0KHRyaWdnZXJUeXBlLCBhdXRoLCBxdWVyeSwgY291bnQsIGNvbmZpZywgaXNHZXQpIHtcbiAgaXNHZXQgPSAhIWlzR2V0O1xuXG4gIHZhciByZXF1ZXN0ID0ge1xuICAgIHRyaWdnZXJOYW1lOiB0cmlnZ2VyVHlwZSxcbiAgICBxdWVyeSxcbiAgICBtYXN0ZXI6IGZhbHNlLFxuICAgIGNvdW50LFxuICAgIGxvZzogY29uZmlnLmxvZ2dlckNvbnRyb2xsZXIsXG4gICAgaXNHZXQsXG4gICAgaGVhZGVyczogY29uZmlnLmhlYWRlcnMsXG4gICAgaXA6IGNvbmZpZy5pcCxcbiAgfTtcblxuICBpZiAoIWF1dGgpIHtcbiAgICByZXR1cm4gcmVxdWVzdDtcbiAgfVxuICBpZiAoYXV0aC5pc01hc3Rlcikge1xuICAgIHJlcXVlc3RbJ21hc3RlciddID0gdHJ1ZTtcbiAgfVxuICBpZiAoYXV0aC51c2VyKSB7XG4gICAgcmVxdWVzdFsndXNlciddID0gYXV0aC51c2VyO1xuICB9XG4gIGlmIChhdXRoLmluc3RhbGxhdGlvbklkKSB7XG4gICAgcmVxdWVzdFsnaW5zdGFsbGF0aW9uSWQnXSA9IGF1dGguaW5zdGFsbGF0aW9uSWQ7XG4gIH1cbiAgcmV0dXJuIHJlcXVlc3Q7XG59XG5cbi8vIENyZWF0ZXMgdGhlIHJlc3BvbnNlIG9iamVjdCwgYW5kIHVzZXMgdGhlIHJlcXVlc3Qgb2JqZWN0IHRvIHBhc3MgZGF0YVxuLy8gVGhlIEFQSSB3aWxsIGNhbGwgdGhpcyB3aXRoIFJFU1QgQVBJIGZvcm1hdHRlZCBvYmplY3RzLCB0aGlzIHdpbGxcbi8vIHRyYW5zZm9ybSB0aGVtIHRvIFBhcnNlLk9iamVjdCBpbnN0YW5jZXMgZXhwZWN0ZWQgYnkgQ2xvdWQgQ29kZS5cbi8vIEFueSBjaGFuZ2VzIG1hZGUgdG8gdGhlIG9iamVjdCBpbiBhIGJlZm9yZVNhdmUgd2lsbCBiZSBpbmNsdWRlZC5cbmV4cG9ydCBmdW5jdGlvbiBnZXRSZXNwb25zZU9iamVjdChyZXF1ZXN0LCByZXNvbHZlLCByZWplY3QpIHtcbiAgcmV0dXJuIHtcbiAgICBzdWNjZXNzOiBmdW5jdGlvbihyZXNwb25zZSkge1xuICAgICAgaWYgKHJlcXVlc3QudHJpZ2dlck5hbWUgPT09IFR5cGVzLmFmdGVyRmluZCkge1xuICAgICAgICBpZighcmVzcG9uc2Upe1xuICAgICAgICAgIHJlc3BvbnNlID0gcmVxdWVzdC5vYmplY3RzO1xuICAgICAgICB9XG4gICAgICAgIHJlc3BvbnNlID0gcmVzcG9uc2UubWFwKG9iamVjdCA9PiB7XG4gICAgICAgICAgcmV0dXJuIG9iamVjdC50b0pTT04oKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXNvbHZlKHJlc3BvbnNlKTtcbiAgICAgIH1cbiAgICAgIC8vIFVzZSB0aGUgSlNPTiByZXNwb25zZVxuICAgICAgaWYgKHJlc3BvbnNlICYmICFyZXF1ZXN0Lm9iamVjdC5lcXVhbHMocmVzcG9uc2UpXG4gICAgICAgICAgJiYgcmVxdWVzdC50cmlnZ2VyTmFtZSA9PT0gVHlwZXMuYmVmb3JlU2F2ZSkge1xuICAgICAgICByZXR1cm4gcmVzb2x2ZShyZXNwb25zZSk7XG4gICAgICB9XG4gICAgICByZXNwb25zZSA9IHt9O1xuICAgICAgaWYgKHJlcXVlc3QudHJpZ2dlck5hbWUgPT09IFR5cGVzLmJlZm9yZVNhdmUpIHtcbiAgICAgICAgcmVzcG9uc2VbJ29iamVjdCddID0gcmVxdWVzdC5vYmplY3QuX2dldFNhdmVKU09OKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzb2x2ZShyZXNwb25zZSk7XG4gICAgfSxcbiAgICBlcnJvcjogZnVuY3Rpb24oY29kZSwgbWVzc2FnZSkge1xuICAgICAgaWYgKCFtZXNzYWdlKSB7XG4gICAgICAgIGlmIChjb2RlIGluc3RhbmNlb2YgUGFyc2UuRXJyb3IpIHtcbiAgICAgICAgICByZXR1cm4gcmVqZWN0KGNvZGUpXG4gICAgICAgIH1cbiAgICAgICAgbWVzc2FnZSA9IGNvZGU7XG4gICAgICAgIGNvZGUgPSBQYXJzZS5FcnJvci5TQ1JJUFRfRkFJTEVEO1xuICAgICAgfVxuICAgICAgdmFyIHNjcmlwdEVycm9yID0gbmV3IFBhcnNlLkVycm9yKGNvZGUsIG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuIHJlamVjdChzY3JpcHRFcnJvcik7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHVzZXJJZEZvckxvZyhhdXRoKSB7XG4gIHJldHVybiAoYXV0aCAmJiBhdXRoLnVzZXIpID8gYXV0aC51c2VyLmlkIDogdW5kZWZpbmVkO1xufVxuXG5mdW5jdGlvbiBsb2dUcmlnZ2VyQWZ0ZXJIb29rKHRyaWdnZXJUeXBlLCBjbGFzc05hbWUsIGlucHV0LCBhdXRoKSB7XG4gIGNvbnN0IGNsZWFuSW5wdXQgPSBsb2dnZXIudHJ1bmNhdGVMb2dNZXNzYWdlKEpTT04uc3RyaW5naWZ5KGlucHV0KSk7XG4gIGxvZ2dlci5pbmZvKGAke3RyaWdnZXJUeXBlfSB0cmlnZ2VyZWQgZm9yICR7Y2xhc3NOYW1lfSBmb3IgdXNlciAke3VzZXJJZEZvckxvZyhhdXRoKX06XFxuICBJbnB1dDogJHtjbGVhbklucHV0fWAsIHtcbiAgICBjbGFzc05hbWUsXG4gICAgdHJpZ2dlclR5cGUsXG4gICAgdXNlcjogdXNlcklkRm9yTG9nKGF1dGgpXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2sodHJpZ2dlclR5cGUsIGNsYXNzTmFtZSwgaW5wdXQsIHJlc3VsdCwgYXV0aCkge1xuICBjb25zdCBjbGVhbklucHV0ID0gbG9nZ2VyLnRydW5jYXRlTG9nTWVzc2FnZShKU09OLnN0cmluZ2lmeShpbnB1dCkpO1xuICBjb25zdCBjbGVhblJlc3VsdCA9IGxvZ2dlci50cnVuY2F0ZUxvZ01lc3NhZ2UoSlNPTi5zdHJpbmdpZnkocmVzdWx0KSk7XG4gIGxvZ2dlci5pbmZvKGAke3RyaWdnZXJUeXBlfSB0cmlnZ2VyZWQgZm9yICR7Y2xhc3NOYW1lfSBmb3IgdXNlciAke3VzZXJJZEZvckxvZyhhdXRoKX06XFxuICBJbnB1dDogJHtjbGVhbklucHV0fVxcbiAgUmVzdWx0OiAke2NsZWFuUmVzdWx0fWAsIHtcbiAgICBjbGFzc05hbWUsXG4gICAgdHJpZ2dlclR5cGUsXG4gICAgdXNlcjogdXNlcklkRm9yTG9nKGF1dGgpXG4gIH0pO1xufVxuXG5mdW5jdGlvbiBsb2dUcmlnZ2VyRXJyb3JCZWZvcmVIb29rKHRyaWdnZXJUeXBlLCBjbGFzc05hbWUsIGlucHV0LCBhdXRoLCBlcnJvcikge1xuICBjb25zdCBjbGVhbklucHV0ID0gbG9nZ2VyLnRydW5jYXRlTG9nTWVzc2FnZShKU09OLnN0cmluZ2lmeShpbnB1dCkpO1xuICBsb2dnZXIuZXJyb3IoYCR7dHJpZ2dlclR5cGV9IGZhaWxlZCBmb3IgJHtjbGFzc05hbWV9IGZvciB1c2VyICR7dXNlcklkRm9yTG9nKGF1dGgpfTpcXG4gIElucHV0OiAke2NsZWFuSW5wdXR9XFxuICBFcnJvcjogJHtKU09OLnN0cmluZ2lmeShlcnJvcil9YCwge1xuICAgIGNsYXNzTmFtZSxcbiAgICB0cmlnZ2VyVHlwZSxcbiAgICBlcnJvcixcbiAgICB1c2VyOiB1c2VySWRGb3JMb2coYXV0aClcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXliZVJ1bkFmdGVyRmluZFRyaWdnZXIodHJpZ2dlclR5cGUsIGF1dGgsIGNsYXNzTmFtZSwgb2JqZWN0cywgY29uZmlnKSB7XG4gIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgY29uc3QgdHJpZ2dlciA9IGdldFRyaWdnZXIoY2xhc3NOYW1lLCB0cmlnZ2VyVHlwZSwgY29uZmlnLmFwcGxpY2F0aW9uSWQpO1xuICAgIGlmICghdHJpZ2dlcikge1xuICAgICAgcmV0dXJuIHJlc29sdmUoKTtcbiAgICB9XG4gICAgY29uc3QgcmVxdWVzdCA9IGdldFJlcXVlc3RPYmplY3QodHJpZ2dlclR5cGUsIGF1dGgsIG51bGwsIG51bGwsIGNvbmZpZyk7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBnZXRSZXNwb25zZU9iamVjdChyZXF1ZXN0LFxuICAgICAgb2JqZWN0ID0+IHtcbiAgICAgICAgcmVzb2x2ZShvYmplY3QpO1xuICAgICAgfSxcbiAgICAgIGVycm9yID0+IHtcbiAgICAgICAgcmVqZWN0KGVycm9yKTtcbiAgICAgIH0pO1xuICAgIGxvZ1RyaWdnZXJTdWNjZXNzQmVmb3JlSG9vayh0cmlnZ2VyVHlwZSwgY2xhc3NOYW1lLCAnQWZ0ZXJGaW5kJywgSlNPTi5zdHJpbmdpZnkob2JqZWN0cyksIGF1dGgpO1xuICAgIHJlcXVlc3Qub2JqZWN0cyA9IG9iamVjdHMubWFwKG9iamVjdCA9PiB7XG4gICAgICAvL3NldHRpbmcgdGhlIGNsYXNzIG5hbWUgdG8gdHJhbnNmb3JtIGludG8gcGFyc2Ugb2JqZWN0XG4gICAgICBvYmplY3QuY2xhc3NOYW1lID0gY2xhc3NOYW1lO1xuICAgICAgcmV0dXJuIFBhcnNlLk9iamVjdC5mcm9tSlNPTihvYmplY3QpO1xuICAgIH0pO1xuICAgIGNvbnN0IHRyaWdnZXJQcm9taXNlID0gdHJpZ2dlcihyZXF1ZXN0LCByZXNwb25zZSk7XG4gICAgaWYgKHRyaWdnZXJQcm9taXNlICYmIHR5cGVvZiB0cmlnZ2VyUHJvbWlzZS50aGVuID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHJldHVybiB0cmlnZ2VyUHJvbWlzZS50aGVuKHByb21pc2VSZXN1bHRzID0+IHtcbiAgICAgICAgaWYocHJvbWlzZVJlc3VsdHMpIHtcbiAgICAgICAgICByZXNvbHZlKHByb21pc2VSZXN1bHRzKTtcbiAgICAgICAgfWVsc2V7XG4gICAgICAgICAgcmV0dXJuIHJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuU0NSSVBUX0ZBSUxFRCwgXCJBZnRlckZpbmQgZXhwZWN0IHJlc3VsdHMgdG8gYmUgcmV0dXJuZWQgaW4gdGhlIHByb21pc2VcIikpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0pLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICBsb2dUcmlnZ2VyQWZ0ZXJIb29rKHRyaWdnZXJUeXBlLCBjbGFzc05hbWUsIEpTT04uc3RyaW5naWZ5KHJlc3VsdHMpLCBhdXRoKTtcbiAgICByZXR1cm4gcmVzdWx0cztcbiAgfSk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBtYXliZVJ1blF1ZXJ5VHJpZ2dlcih0cmlnZ2VyVHlwZSwgY2xhc3NOYW1lLCByZXN0V2hlcmUsIHJlc3RPcHRpb25zLCBjb25maWcsIGF1dGgsIGlzR2V0KSB7XG4gIGNvbnN0IHRyaWdnZXIgPSBnZXRUcmlnZ2VyKGNsYXNzTmFtZSwgdHJpZ2dlclR5cGUsIGNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgaWYgKCF0cmlnZ2VyKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7XG4gICAgICByZXN0V2hlcmUsXG4gICAgICByZXN0T3B0aW9uc1xuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgcGFyc2VRdWVyeSA9IG5ldyBQYXJzZS5RdWVyeShjbGFzc05hbWUpO1xuICBpZiAocmVzdFdoZXJlKSB7XG4gICAgcGFyc2VRdWVyeS5fd2hlcmUgPSByZXN0V2hlcmU7XG4gIH1cbiAgbGV0IGNvdW50ID0gZmFsc2U7XG4gIGlmIChyZXN0T3B0aW9ucykge1xuICAgIGlmIChyZXN0T3B0aW9ucy5pbmNsdWRlICYmIHJlc3RPcHRpb25zLmluY2x1ZGUubGVuZ3RoID4gMCkge1xuICAgICAgcGFyc2VRdWVyeS5faW5jbHVkZSA9IHJlc3RPcHRpb25zLmluY2x1ZGUuc3BsaXQoJywnKTtcbiAgICB9XG4gICAgaWYgKHJlc3RPcHRpb25zLnNraXApIHtcbiAgICAgIHBhcnNlUXVlcnkuX3NraXAgPSByZXN0T3B0aW9ucy5za2lwO1xuICAgIH1cbiAgICBpZiAocmVzdE9wdGlvbnMubGltaXQpIHtcbiAgICAgIHBhcnNlUXVlcnkuX2xpbWl0ID0gcmVzdE9wdGlvbnMubGltaXQ7XG4gICAgfVxuICAgIGNvdW50ID0gISFyZXN0T3B0aW9ucy5jb3VudDtcbiAgfVxuICBjb25zdCByZXF1ZXN0T2JqZWN0ID0gZ2V0UmVxdWVzdFF1ZXJ5T2JqZWN0KHRyaWdnZXJUeXBlLCBhdXRoLCBwYXJzZVF1ZXJ5LCBjb3VudCwgY29uZmlnLCBpc0dldCk7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdHJpZ2dlcihyZXF1ZXN0T2JqZWN0KTtcbiAgfSkudGhlbigocmVzdWx0KSA9PiB7XG4gICAgbGV0IHF1ZXJ5UmVzdWx0ID0gcGFyc2VRdWVyeTtcbiAgICBpZiAocmVzdWx0ICYmIHJlc3VsdCBpbnN0YW5jZW9mIFBhcnNlLlF1ZXJ5KSB7XG4gICAgICBxdWVyeVJlc3VsdCA9IHJlc3VsdDtcbiAgICB9XG4gICAgY29uc3QganNvblF1ZXJ5ID0gcXVlcnlSZXN1bHQudG9KU09OKCk7XG4gICAgaWYgKGpzb25RdWVyeS53aGVyZSkge1xuICAgICAgcmVzdFdoZXJlID0ganNvblF1ZXJ5LndoZXJlO1xuICAgIH1cbiAgICBpZiAoanNvblF1ZXJ5LmxpbWl0KSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMubGltaXQgPSBqc29uUXVlcnkubGltaXQ7XG4gICAgfVxuICAgIGlmIChqc29uUXVlcnkuc2tpcCkge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLnNraXAgPSBqc29uUXVlcnkuc2tpcDtcbiAgICB9XG4gICAgaWYgKGpzb25RdWVyeS5pbmNsdWRlKSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMuaW5jbHVkZSA9IGpzb25RdWVyeS5pbmNsdWRlO1xuICAgIH1cbiAgICBpZiAoanNvblF1ZXJ5LmtleXMpIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5rZXlzID0ganNvblF1ZXJ5LmtleXM7XG4gICAgfVxuICAgIGlmIChqc29uUXVlcnkub3JkZXIpIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5vcmRlciA9IGpzb25RdWVyeS5vcmRlcjtcbiAgICB9XG4gICAgaWYgKHJlcXVlc3RPYmplY3QucmVhZFByZWZlcmVuY2UpIHtcbiAgICAgIHJlc3RPcHRpb25zID0gcmVzdE9wdGlvbnMgfHwge307XG4gICAgICByZXN0T3B0aW9ucy5yZWFkUHJlZmVyZW5jZSA9IHJlcXVlc3RPYmplY3QucmVhZFByZWZlcmVuY2U7XG4gICAgfVxuICAgIGlmIChyZXF1ZXN0T2JqZWN0LmluY2x1ZGVSZWFkUHJlZmVyZW5jZSkge1xuICAgICAgcmVzdE9wdGlvbnMgPSByZXN0T3B0aW9ucyB8fCB7fTtcbiAgICAgIHJlc3RPcHRpb25zLmluY2x1ZGVSZWFkUHJlZmVyZW5jZSA9IHJlcXVlc3RPYmplY3QuaW5jbHVkZVJlYWRQcmVmZXJlbmNlO1xuICAgIH1cbiAgICBpZiAocmVxdWVzdE9iamVjdC5zdWJxdWVyeVJlYWRQcmVmZXJlbmNlKSB7XG4gICAgICByZXN0T3B0aW9ucyA9IHJlc3RPcHRpb25zIHx8IHt9O1xuICAgICAgcmVzdE9wdGlvbnMuc3VicXVlcnlSZWFkUHJlZmVyZW5jZSA9IHJlcXVlc3RPYmplY3Quc3VicXVlcnlSZWFkUHJlZmVyZW5jZTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlc3RXaGVyZSxcbiAgICAgIHJlc3RPcHRpb25zXG4gICAgfTtcbiAgfSwgKGVycikgPT4ge1xuICAgIGlmICh0eXBlb2YgZXJyID09PSAnc3RyaW5nJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEsIGVycik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IGVycjtcbiAgICB9XG4gIH0pO1xufVxuXG4vLyBUbyBiZSB1c2VkIGFzIHBhcnQgb2YgdGhlIHByb21pc2UgY2hhaW4gd2hlbiBzYXZpbmcvZGVsZXRpbmcgYW4gb2JqZWN0XG4vLyBXaWxsIHJlc29sdmUgc3VjY2Vzc2Z1bGx5IGlmIG5vIHRyaWdnZXIgaXMgY29uZmlndXJlZFxuLy8gUmVzb2x2ZXMgdG8gYW4gb2JqZWN0LCBlbXB0eSBvciBjb250YWluaW5nIGFuIG9iamVjdCBrZXkuIEEgYmVmb3JlU2F2ZVxuLy8gdHJpZ2dlciB3aWxsIHNldCB0aGUgb2JqZWN0IGtleSB0byB0aGUgcmVzdCBmb3JtYXQgb2JqZWN0IHRvIHNhdmUuXG4vLyBvcmlnaW5hbFBhcnNlT2JqZWN0IGlzIG9wdGlvbmFsLCB3ZSBvbmx5IG5lZWQgdGhhdCBmb3IgYmVmb3JlL2FmdGVyU2F2ZSBmdW5jdGlvbnNcbmV4cG9ydCBmdW5jdGlvbiBtYXliZVJ1blRyaWdnZXIodHJpZ2dlclR5cGUsIGF1dGgsIHBhcnNlT2JqZWN0LCBvcmlnaW5hbFBhcnNlT2JqZWN0LCBjb25maWcpIHtcbiAgaWYgKCFwYXJzZU9iamVjdCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe30pO1xuICB9XG4gIHJldHVybiBuZXcgUHJvbWlzZShmdW5jdGlvbiAocmVzb2x2ZSwgcmVqZWN0KSB7XG4gICAgdmFyIHRyaWdnZXIgPSBnZXRUcmlnZ2VyKHBhcnNlT2JqZWN0LmNsYXNzTmFtZSwgdHJpZ2dlclR5cGUsIGNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgICBpZiAoIXRyaWdnZXIpIHJldHVybiByZXNvbHZlKCk7XG4gICAgdmFyIHJlcXVlc3QgPSBnZXRSZXF1ZXN0T2JqZWN0KHRyaWdnZXJUeXBlLCBhdXRoLCBwYXJzZU9iamVjdCwgb3JpZ2luYWxQYXJzZU9iamVjdCwgY29uZmlnKTtcbiAgICB2YXIgcmVzcG9uc2UgPSBnZXRSZXNwb25zZU9iamVjdChyZXF1ZXN0LCAob2JqZWN0KSA9PiB7XG4gICAgICBsb2dUcmlnZ2VyU3VjY2Vzc0JlZm9yZUhvb2soXG4gICAgICAgIHRyaWdnZXJUeXBlLCBwYXJzZU9iamVjdC5jbGFzc05hbWUsIHBhcnNlT2JqZWN0LnRvSlNPTigpLCBvYmplY3QsIGF1dGgpO1xuICAgICAgcmVzb2x2ZShvYmplY3QpO1xuICAgIH0sIChlcnJvcikgPT4ge1xuICAgICAgbG9nVHJpZ2dlckVycm9yQmVmb3JlSG9vayhcbiAgICAgICAgdHJpZ2dlclR5cGUsIHBhcnNlT2JqZWN0LmNsYXNzTmFtZSwgcGFyc2VPYmplY3QudG9KU09OKCksIGF1dGgsIGVycm9yKTtcbiAgICAgIHJlamVjdChlcnJvcik7XG4gICAgfSk7XG4gICAgLy8gRm9yY2UgdGhlIGN1cnJlbnQgUGFyc2UgYXBwIGJlZm9yZSB0aGUgdHJpZ2dlclxuICAgIFBhcnNlLmFwcGxpY2F0aW9uSWQgPSBjb25maWcuYXBwbGljYXRpb25JZDtcbiAgICBQYXJzZS5qYXZhc2NyaXB0S2V5ID0gY29uZmlnLmphdmFzY3JpcHRLZXkgfHwgJyc7XG4gICAgUGFyc2UubWFzdGVyS2V5ID0gY29uZmlnLm1hc3RlcktleTtcblxuICAgIC8vIEFmdGVyU2F2ZSBhbmQgYWZ0ZXJEZWxldGUgdHJpZ2dlcnMgY2FuIHJldHVybiBhIHByb21pc2UsIHdoaWNoIGlmIHRoZXlcbiAgICAvLyBkbywgbmVlZHMgdG8gYmUgcmVzb2x2ZWQgYmVmb3JlIHRoaXMgcHJvbWlzZSBpcyByZXNvbHZlZCxcbiAgICAvLyBzbyB0cmlnZ2VyIGV4ZWN1dGlvbiBpcyBzeW5jZWQgd2l0aCBSZXN0V3JpdGUuZXhlY3V0ZSgpIGNhbGwuXG4gICAgLy8gSWYgdHJpZ2dlcnMgZG8gbm90IHJldHVybiBhIHByb21pc2UsIHRoZXkgY2FuIHJ1biBhc3luYyBjb2RlIHBhcmFsbGVsXG4gICAgLy8gdG8gdGhlIFJlc3RXcml0ZS5leGVjdXRlKCkgY2FsbC5cbiAgICB2YXIgdHJpZ2dlclByb21pc2UgPSB0cmlnZ2VyKHJlcXVlc3QsIHJlc3BvbnNlKTtcbiAgICBpZih0cmlnZ2VyVHlwZSA9PT0gVHlwZXMuYWZ0ZXJTYXZlIHx8IHRyaWdnZXJUeXBlID09PSBUeXBlcy5hZnRlckRlbGV0ZSlcbiAgICB7XG4gICAgICBsb2dUcmlnZ2VyQWZ0ZXJIb29rKHRyaWdnZXJUeXBlLCBwYXJzZU9iamVjdC5jbGFzc05hbWUsIHBhcnNlT2JqZWN0LnRvSlNPTigpLCBhdXRoKTtcbiAgICAgIGlmKHRyaWdnZXJQcm9taXNlICYmIHR5cGVvZiB0cmlnZ2VyUHJvbWlzZS50aGVuID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgICAgcmV0dXJuIHRyaWdnZXJQcm9taXNlLnRoZW4ocmVzb2x2ZSwgcmVzb2x2ZSk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHJlc29sdmUoKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xufVxuXG4vLyBDb252ZXJ0cyBhIFJFU1QtZm9ybWF0IG9iamVjdCB0byBhIFBhcnNlLk9iamVjdFxuLy8gZGF0YSBpcyBlaXRoZXIgY2xhc3NOYW1lIG9yIGFuIG9iamVjdFxuZXhwb3J0IGZ1bmN0aW9uIGluZmxhdGUoZGF0YSwgcmVzdE9iamVjdCkge1xuICB2YXIgY29weSA9IHR5cGVvZiBkYXRhID09ICdvYmplY3QnID8gZGF0YSA6IHtjbGFzc05hbWU6IGRhdGF9O1xuICBmb3IgKHZhciBrZXkgaW4gcmVzdE9iamVjdCkge1xuICAgIGNvcHlba2V5XSA9IHJlc3RPYmplY3Rba2V5XTtcbiAgfVxuICByZXR1cm4gUGFyc2UuT2JqZWN0LmZyb21KU09OKGNvcHkpO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gcnVuTGl2ZVF1ZXJ5RXZlbnRIYW5kbGVycyhkYXRhLCBhcHBsaWNhdGlvbklkID0gUGFyc2UuYXBwbGljYXRpb25JZCkge1xuICBpZiAoIV90cmlnZ2VyU3RvcmUgfHwgIV90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0gfHwgIV90cmlnZ2VyU3RvcmVbYXBwbGljYXRpb25JZF0uTGl2ZVF1ZXJ5KSB7IHJldHVybjsgfVxuICBfdHJpZ2dlclN0b3JlW2FwcGxpY2F0aW9uSWRdLkxpdmVRdWVyeS5mb3JFYWNoKChoYW5kbGVyKSA9PiBoYW5kbGVyKGRhdGEpKTtcbn1cbiJdfQ==