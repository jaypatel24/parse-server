'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _Options = require('./Options');

var _defaults = require('./defaults');

var _defaults2 = _interopRequireDefault(_defaults);

var _logger = require('./logger');

var logging = _interopRequireWildcard(_logger);

var _Config = require('./Config');

var _Config2 = _interopRequireDefault(_Config);

var _PromiseRouter = require('./PromiseRouter');

var _PromiseRouter2 = _interopRequireDefault(_PromiseRouter);

var _requiredParameter = require('./requiredParameter');

var _requiredParameter2 = _interopRequireDefault(_requiredParameter);

var _AnalyticsRouter = require('./Routers/AnalyticsRouter');

var _ClassesRouter = require('./Routers/ClassesRouter');

var _FeaturesRouter = require('./Routers/FeaturesRouter');

var _FilesRouter = require('./Routers/FilesRouter');

var _FunctionsRouter = require('./Routers/FunctionsRouter');

var _GlobalConfigRouter = require('./Routers/GlobalConfigRouter');

var _HooksRouter = require('./Routers/HooksRouter');

var _IAPValidationRouter = require('./Routers/IAPValidationRouter');

var _InstallationsRouter = require('./Routers/InstallationsRouter');

var _LogsRouter = require('./Routers/LogsRouter');

var _ParseLiveQueryServer = require('./LiveQuery/ParseLiveQueryServer');

var _PublicAPIRouter = require('./Routers/PublicAPIRouter');

var _PushRouter = require('./Routers/PushRouter');

var _CloudCodeRouter = require('./Routers/CloudCodeRouter');

var _RolesRouter = require('./Routers/RolesRouter');

var _SchemasRouter = require('./Routers/SchemasRouter');

var _SessionsRouter = require('./Routers/SessionsRouter');

var _UsersRouter = require('./Routers/UsersRouter');

var _PurgeRouter = require('./Routers/PurgeRouter');

var _AudiencesRouter = require('./Routers/AudiencesRouter');

var _AggregateRouter = require('./Routers/AggregateRouter');

var _ParseServerRESTController = require('./ParseServerRESTController');

var _Controllers = require('./Controllers');

var controllers = _interopRequireWildcard(_Controllers);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// ParseServer - open-source compatible API Server for Parse apps

var batch = require('./batch'),
    bodyParser = require('body-parser'),
    express = require('express'),
    middlewares = require('./middlewares'),
    Parse = require('parse/node').Parse,
    path = require('path');

// Mutate the Parse object to add the Cloud Code handlers
addParseCloud();

// ParseServer works like a constructor of an express app.
// The args that we understand are:
// "analyticsAdapter": an adapter class for analytics
// "filesAdapter": a class like GridStoreAdapter providing create, get,
//                 and delete
// "loggerAdapter": a class like WinstonLoggerAdapter providing info, error,
//                 and query
// "jsonLogs": log as structured JSON objects
// "databaseURI": a uri like mongodb://localhost:27017/dbname to tell us
//          what database this Parse API connects to.
// "cloud": relative location to cloud code to require, or a function
//          that is given an instance of Parse as a parameter.  Use this instance of Parse
//          to register your cloud code hooks and functions.
// "appId": the application id to host
// "masterKey": the master key for requests to this app
// "collectionPrefix": optional prefix for database collection names
// "fileKey": optional key from Parse dashboard for supporting older files
//            hosted by Parse
// "clientKey": optional key from Parse dashboard
// "dotNetKey": optional key from Parse dashboard
// "restAPIKey": optional key from Parse dashboard
// "webhookKey": optional key from Parse dashboard
// "javascriptKey": optional key from Parse dashboard
// "push": optional key from configure push
// "sessionLength": optional length in seconds for how long Sessions should be valid for
// "maxLimit": optional upper bound for what can be specified for the 'limit' parameter on queries

class ParseServer {

  constructor(options) {
    injectDefaults(options);
    const {
      appId = (0, _requiredParameter2.default)('You must provide an appId!'),
      masterKey = (0, _requiredParameter2.default)('You must provide a masterKey!'),
      cloud,
      javascriptKey,
      serverURL = (0, _requiredParameter2.default)('You must provide a serverURL!'),
      __indexBuildCompletionCallbackForTests = () => {}
    } = options;
    // Initialize the node client SDK automatically
    Parse.initialize(appId, javascriptKey || 'unused', masterKey);
    Parse.serverURL = serverURL;

    const allControllers = controllers.getControllers(options);

    const {
      loggerController,
      databaseController,
      hooksController
    } = allControllers;
    this.config = _Config2.default.put(Object.assign({}, options, allControllers));

    logging.setLogger(loggerController);
    const dbInitPromise = databaseController.performInitialization();
    hooksController.load();

    // Note: Tests will start to fail if any validation happens after this is called.
    if (process.env.TESTING) {
      __indexBuildCompletionCallbackForTests(dbInitPromise);
    }

    if (cloud) {
      addParseCloud();
      if (typeof cloud === 'function') {
        cloud(Parse);
      } else if (typeof cloud === 'string') {
        require(path.resolve(process.cwd(), cloud));
      } else {
        throw "argument 'cloud' must either be a string or a function";
      }
    }
  }

  get app() {
    if (!this._app) {
      this._app = ParseServer.app(this.config);
    }
    return this._app;
  }

  handleShutdown() {
    const { adapter } = this.config.databaseController;
    if (adapter && typeof adapter.handleShutdown === 'function') {
      adapter.handleShutdown();
    }
  }

  static app({ maxUploadSize = '20mb', appId }) {
    // This app serves the Parse API directly.
    // It's the equivalent of https://api.parse.com/1 in the hosted Parse API.
    var api = express();
    //api.use("/apps", express.static(__dirname + "/public"));
    // File handling needs to be before default middlewares are applied
    api.use('/', middlewares.allowCrossDomain, new _FilesRouter.FilesRouter().expressRouter({
      maxUploadSize: maxUploadSize
    }));

    api.use('/health', function (req, res) {
      res.json({
        status: 'ok'
      });
    });

    api.use('/', bodyParser.urlencoded({ extended: false }), new _PublicAPIRouter.PublicAPIRouter().expressRouter());

    api.use(bodyParser.json({ 'type': '*/*', limit: maxUploadSize }));
    api.use(middlewares.allowCrossDomain);
    api.use(middlewares.allowMethodOverride);
    api.use(middlewares.handleParseHeaders);

    const appRouter = ParseServer.promiseRouter({ appId });
    api.use(appRouter.expressRouter());

    api.use(middlewares.handleParseErrors);

    // run the following when not testing
    if (!process.env.TESTING) {
      //This causes tests to spew some useless warnings, so disable in test
      /* istanbul ignore next */
      process.on('uncaughtException', err => {
        if (err.code === "EADDRINUSE") {
          // user-friendly message for this common error
          process.stderr.write(`Unable to listen on port ${err.port}. The port is already in use.`);
          process.exit(0);
        } else {
          throw err;
        }
      });
      // verify the server url after a 'mount' event is received
      /* istanbul ignore next */
      api.on('mount', function () {
        ParseServer.verifyServerUrl();
      });
    }
    if (process.env.PARSE_SERVER_ENABLE_EXPERIMENTAL_DIRECT_ACCESS === '1') {
      Parse.CoreManager.setRESTController((0, _ParseServerRESTController.ParseServerRESTController)(appId, appRouter));
    }
    return api;
  }

  static promiseRouter({ appId }) {
    const routers = [new _ClassesRouter.ClassesRouter(), new _UsersRouter.UsersRouter(), new _SessionsRouter.SessionsRouter(), new _RolesRouter.RolesRouter(), new _AnalyticsRouter.AnalyticsRouter(), new _InstallationsRouter.InstallationsRouter(), new _FunctionsRouter.FunctionsRouter(), new _SchemasRouter.SchemasRouter(), new _PushRouter.PushRouter(), new _LogsRouter.LogsRouter(), new _IAPValidationRouter.IAPValidationRouter(), new _FeaturesRouter.FeaturesRouter(), new _GlobalConfigRouter.GlobalConfigRouter(), new _PurgeRouter.PurgeRouter(), new _HooksRouter.HooksRouter(), new _CloudCodeRouter.CloudCodeRouter(), new _AudiencesRouter.AudiencesRouter(), new _AggregateRouter.AggregateRouter()];

    const routes = routers.reduce((memo, router) => {
      return memo.concat(router.routes);
    }, []);

    const appRouter = new _PromiseRouter2.default(routes, appId);

    batch.mountOnto(appRouter);
    return appRouter;
  }

  start(options, callback) {
    const app = express();
    if (options.middleware) {
      let middleware;
      if (typeof options.middleware == 'string') {
        middleware = require(path.resolve(process.cwd(), options.middleware));
      } else {
        middleware = options.middleware; // use as-is let express fail
      }
      app.use(middleware);
    }

    app.use(options.mountPath, this.app);
    const server = app.listen(options.port, options.host, callback);
    this.server = server;

    if (options.startLiveQueryServer || options.liveQueryServerOptions) {
      this.liveQueryServer = ParseServer.createLiveQueryServer(server, options.liveQueryServerOptions);
    }
    /* istanbul ignore next */
    if (!process.env.TESTING) {
      configureListeners(this);
    }
    this.expressApp = app;
    return this;
  }

  static start(options, callback) {
    const parseServer = new ParseServer(options);
    return parseServer.start(options, callback);
  }

  static createLiveQueryServer(httpServer, config) {
    if (!httpServer || config && config.port) {
      var app = express();
      httpServer = require('http').createServer(app);
      httpServer.listen(config.port);
    }
    return new _ParseLiveQueryServer.ParseLiveQueryServer(httpServer, config);
  }

  static verifyServerUrl(callback) {
    // perform a health check on the serverURL value
    if (Parse.serverURL) {
      const request = require('request');
      request(Parse.serverURL.replace(/\/$/, "") + "/health", function (error, response, body) {
        let json;
        try {
          json = JSON.parse(body);
        } catch (e) {
          json = null;
        }
        if (error || response.statusCode !== 200 || !json || json && json.status !== 'ok') {
          /* eslint-disable no-console */
          console.warn(`\nWARNING, Unable to connect to '${Parse.serverURL}'.` + ` Cloud code and push notifications may be unavailable!\n`);
          /* eslint-enable no-console */
          if (callback) {
            callback(false);
          }
        } else {
          if (callback) {
            callback(true);
          }
        }
      });
    }
  }
}

function addParseCloud() {
  const ParseCloud = require("./cloud-code/Parse.Cloud");
  Object.assign(Parse.Cloud, ParseCloud);
  global.Parse = Parse;
}

function injectDefaults(options) {
  Object.keys(_defaults2.default).forEach(key => {
    if (!options.hasOwnProperty(key)) {
      options[key] = _defaults2.default[key];
    }
  });

  if (!options.hasOwnProperty('serverURL')) {
    options.serverURL = `http://localhost:${options.port}${options.mountPath}`;
  }

  options.userSensitiveFields = Array.from(new Set(options.userSensitiveFields.concat(_defaults2.default.userSensitiveFields, options.userSensitiveFields)));

  options.masterKeyIps = Array.from(new Set(options.masterKeyIps.concat(_defaults2.default.masterKeyIps, options.masterKeyIps)));
}

// Those can't be tested as it requires a subprocess
/* istanbul ignore next */
function configureListeners(parseServer) {
  const server = parseServer.server;
  const sockets = {};
  /* Currently, express doesn't shut down immediately after receiving SIGINT/SIGTERM if it has client connections that haven't timed out. (This is a known issue with node - https://github.com/nodejs/node/issues/2642)
    This function, along with `destroyAliveConnections()`, intend to fix this behavior such that parse server will close all open connections and initiate the shutdown process as soon as it receives a SIGINT/SIGTERM signal. */
  server.on('connection', socket => {
    const socketId = socket.remoteAddress + ':' + socket.remotePort;
    sockets[socketId] = socket;
    socket.on('close', () => {
      delete sockets[socketId];
    });
  });

  const destroyAliveConnections = function () {
    for (const socketId in sockets) {
      try {
        sockets[socketId].destroy();
      } catch (e) {/* */}
    }
  };

  const handleShutdown = function () {
    process.stdout.write('Termination signal received. Shutting down.');
    destroyAliveConnections();
    server.close();
    parseServer.handleShutdown();
  };
  process.on('SIGTERM', handleShutdown);
  process.on('SIGINT', handleShutdown);
}

exports.default = ParseServer;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9QYXJzZVNlcnZlci5qcyJdLCJuYW1lcyI6WyJsb2dnaW5nIiwiY29udHJvbGxlcnMiLCJiYXRjaCIsInJlcXVpcmUiLCJib2R5UGFyc2VyIiwiZXhwcmVzcyIsIm1pZGRsZXdhcmVzIiwiUGFyc2UiLCJwYXRoIiwiYWRkUGFyc2VDbG91ZCIsIlBhcnNlU2VydmVyIiwiY29uc3RydWN0b3IiLCJvcHRpb25zIiwiaW5qZWN0RGVmYXVsdHMiLCJhcHBJZCIsIm1hc3RlcktleSIsImNsb3VkIiwiamF2YXNjcmlwdEtleSIsInNlcnZlclVSTCIsIl9faW5kZXhCdWlsZENvbXBsZXRpb25DYWxsYmFja0ZvclRlc3RzIiwiaW5pdGlhbGl6ZSIsImFsbENvbnRyb2xsZXJzIiwiZ2V0Q29udHJvbGxlcnMiLCJsb2dnZXJDb250cm9sbGVyIiwiZGF0YWJhc2VDb250cm9sbGVyIiwiaG9va3NDb250cm9sbGVyIiwiY29uZmlnIiwicHV0IiwiT2JqZWN0IiwiYXNzaWduIiwic2V0TG9nZ2VyIiwiZGJJbml0UHJvbWlzZSIsInBlcmZvcm1Jbml0aWFsaXphdGlvbiIsImxvYWQiLCJwcm9jZXNzIiwiZW52IiwiVEVTVElORyIsInJlc29sdmUiLCJjd2QiLCJhcHAiLCJfYXBwIiwiaGFuZGxlU2h1dGRvd24iLCJhZGFwdGVyIiwibWF4VXBsb2FkU2l6ZSIsImFwaSIsInVzZSIsImFsbG93Q3Jvc3NEb21haW4iLCJleHByZXNzUm91dGVyIiwicmVxIiwicmVzIiwianNvbiIsInN0YXR1cyIsInVybGVuY29kZWQiLCJleHRlbmRlZCIsImxpbWl0IiwiYWxsb3dNZXRob2RPdmVycmlkZSIsImhhbmRsZVBhcnNlSGVhZGVycyIsImFwcFJvdXRlciIsInByb21pc2VSb3V0ZXIiLCJoYW5kbGVQYXJzZUVycm9ycyIsIm9uIiwiZXJyIiwiY29kZSIsInN0ZGVyciIsIndyaXRlIiwicG9ydCIsImV4aXQiLCJ2ZXJpZnlTZXJ2ZXJVcmwiLCJQQVJTRV9TRVJWRVJfRU5BQkxFX0VYUEVSSU1FTlRBTF9ESVJFQ1RfQUNDRVNTIiwiQ29yZU1hbmFnZXIiLCJzZXRSRVNUQ29udHJvbGxlciIsInJvdXRlcnMiLCJyb3V0ZXMiLCJyZWR1Y2UiLCJtZW1vIiwicm91dGVyIiwiY29uY2F0IiwibW91bnRPbnRvIiwic3RhcnQiLCJjYWxsYmFjayIsIm1pZGRsZXdhcmUiLCJtb3VudFBhdGgiLCJzZXJ2ZXIiLCJsaXN0ZW4iLCJob3N0Iiwic3RhcnRMaXZlUXVlcnlTZXJ2ZXIiLCJsaXZlUXVlcnlTZXJ2ZXJPcHRpb25zIiwibGl2ZVF1ZXJ5U2VydmVyIiwiY3JlYXRlTGl2ZVF1ZXJ5U2VydmVyIiwiY29uZmlndXJlTGlzdGVuZXJzIiwiZXhwcmVzc0FwcCIsInBhcnNlU2VydmVyIiwiaHR0cFNlcnZlciIsImNyZWF0ZVNlcnZlciIsInJlcXVlc3QiLCJyZXBsYWNlIiwiZXJyb3IiLCJyZXNwb25zZSIsImJvZHkiLCJKU09OIiwicGFyc2UiLCJlIiwic3RhdHVzQ29kZSIsImNvbnNvbGUiLCJ3YXJuIiwiUGFyc2VDbG91ZCIsIkNsb3VkIiwiZ2xvYmFsIiwia2V5cyIsImZvckVhY2giLCJrZXkiLCJoYXNPd25Qcm9wZXJ0eSIsInVzZXJTZW5zaXRpdmVGaWVsZHMiLCJBcnJheSIsImZyb20iLCJTZXQiLCJtYXN0ZXJLZXlJcHMiLCJzb2NrZXRzIiwic29ja2V0Iiwic29ja2V0SWQiLCJyZW1vdGVBZGRyZXNzIiwicmVtb3RlUG9ydCIsImRlc3Ryb3lBbGl2ZUNvbm5lY3Rpb25zIiwiZGVzdHJveSIsInN0ZG91dCIsImNsb3NlIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFTQTs7QUFFQTs7OztBQUNBOztJQUFZQSxPOztBQUNaOzs7O0FBQ0E7Ozs7QUFDQTs7OztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUNBOztBQUVB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QkYsT0FBT0csVUFBckQ7QUFDQUosWUFBUUUsUUFBUixJQUFvQkQsTUFBcEI7QUFDQUEsV0FBTzFELEVBQVAsQ0FBVSxPQUFWLEVBQW1CLE1BQU07QUFDdkIsYUFBT3lELFFBQVFFLFFBQVIsQ0FBUDtBQUNELEtBRkQ7QUFHRCxHQU5EOztBQVFBLFFBQU1HLDBCQUEwQixZQUFXO0FBQ3pDLFNBQUssTUFBTUgsUUFBWCxJQUF1QkYsT0FBdkIsRUFBZ0M7QUFDOUIsVUFBSTtBQUNGQSxnQkFBUUUsUUFBUixFQUFrQkksT0FBbEI7QUFDRCxPQUZELENBRUUsT0FBT3RCLENBQVAsRUFBVSxDQUFFLEtBQU87QUFDdEI7QUFDRixHQU5EOztBQVFBLFFBQU01RCxpQkFBaUIsWUFBVztBQUNoQ1AsWUFBUTBGLE1BQVIsQ0FBZTVELEtBQWYsQ0FBcUIsNkNBQXJCO0FBQ0EwRDtBQUNBeEMsV0FBTzJDLEtBQVA7QUFDQWxDLGdCQUFZbEQsY0FBWjtBQUNELEdBTEQ7QUFNQVAsVUFBUTBCLEVBQVIsQ0FBVyxTQUFYLEVBQXNCbkIsY0FBdEI7QUFDQVAsVUFBUTBCLEVBQVIsQ0FBVyxRQUFYLEVBQXFCbkIsY0FBckI7QUFDRDs7a0JBRWMvQixXIiwiZmlsZSI6IlBhcnNlU2VydmVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gUGFyc2VTZXJ2ZXIgLSBvcGVuLXNvdXJjZSBjb21wYXRpYmxlIEFQSSBTZXJ2ZXIgZm9yIFBhcnNlIGFwcHNcblxudmFyIGJhdGNoID0gcmVxdWlyZSgnLi9iYXRjaCcpLFxuICBib2R5UGFyc2VyID0gcmVxdWlyZSgnYm9keS1wYXJzZXInKSxcbiAgZXhwcmVzcyA9IHJlcXVpcmUoJ2V4cHJlc3MnKSxcbiAgbWlkZGxld2FyZXMgPSByZXF1aXJlKCcuL21pZGRsZXdhcmVzJyksXG4gIFBhcnNlID0gcmVxdWlyZSgncGFyc2Uvbm9kZScpLlBhcnNlLFxuICBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xuXG5pbXBvcnQgeyBQYXJzZVNlcnZlck9wdGlvbnMsXG4gIExpdmVRdWVyeVNlcnZlck9wdGlvbnMgfSAgICAgIGZyb20gJy4vT3B0aW9ucyc7XG5pbXBvcnQgZGVmYXVsdHMgICAgICAgICAgICAgICAgIGZyb20gJy4vZGVmYXVsdHMnO1xuaW1wb3J0ICogYXMgbG9nZ2luZyAgICAgICAgICAgICBmcm9tICcuL2xvZ2dlcic7XG5pbXBvcnQgQ29uZmlnICAgICAgICAgICAgICAgICAgIGZyb20gJy4vQ29uZmlnJztcbmltcG9ydCBQcm9taXNlUm91dGVyICAgICAgICAgICAgZnJvbSAnLi9Qcm9taXNlUm91dGVyJztcbmltcG9ydCByZXF1aXJlZFBhcmFtZXRlciAgICAgICAgZnJvbSAnLi9yZXF1aXJlZFBhcmFtZXRlcic7XG5pbXBvcnQgeyBBbmFseXRpY3NSb3V0ZXIgfSAgICAgIGZyb20gJy4vUm91dGVycy9BbmFseXRpY3NSb3V0ZXInO1xuaW1wb3J0IHsgQ2xhc3Nlc1JvdXRlciB9ICAgICAgICBmcm9tICcuL1JvdXRlcnMvQ2xhc3Nlc1JvdXRlcic7XG5pbXBvcnQgeyBGZWF0dXJlc1JvdXRlciB9ICAgICAgIGZyb20gJy4vUm91dGVycy9GZWF0dXJlc1JvdXRlcic7XG5pbXBvcnQgeyBGaWxlc1JvdXRlciB9ICAgICAgICAgIGZyb20gJy4vUm91dGVycy9GaWxlc1JvdXRlcic7XG5pbXBvcnQgeyBGdW5jdGlvbnNSb3V0ZXIgfSAgICAgIGZyb20gJy4vUm91dGVycy9GdW5jdGlvbnNSb3V0ZXInO1xuaW1wb3J0IHsgR2xvYmFsQ29uZmlnUm91dGVyIH0gICBmcm9tICcuL1JvdXRlcnMvR2xvYmFsQ29uZmlnUm91dGVyJztcbmltcG9ydCB7IEhvb2tzUm91dGVyIH0gICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL0hvb2tzUm91dGVyJztcbmltcG9ydCB7IElBUFZhbGlkYXRpb25Sb3V0ZXIgfSAgZnJvbSAnLi9Sb3V0ZXJzL0lBUFZhbGlkYXRpb25Sb3V0ZXInO1xuaW1wb3J0IHsgSW5zdGFsbGF0aW9uc1JvdXRlciB9ICBmcm9tICcuL1JvdXRlcnMvSW5zdGFsbGF0aW9uc1JvdXRlcic7XG5pbXBvcnQgeyBMb2dzUm91dGVyIH0gICAgICAgICAgIGZyb20gJy4vUm91dGVycy9Mb2dzUm91dGVyJztcbmltcG9ydCB7IFBhcnNlTGl2ZVF1ZXJ5U2VydmVyIH0gZnJvbSAnLi9MaXZlUXVlcnkvUGFyc2VMaXZlUXVlcnlTZXJ2ZXInO1xuaW1wb3J0IHsgUHVibGljQVBJUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvUHVibGljQVBJUm91dGVyJztcbmltcG9ydCB7IFB1c2hSb3V0ZXIgfSAgICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1B1c2hSb3V0ZXInO1xuaW1wb3J0IHsgQ2xvdWRDb2RlUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvQ2xvdWRDb2RlUm91dGVyJztcbmltcG9ydCB7IFJvbGVzUm91dGVyIH0gICAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1JvbGVzUm91dGVyJztcbmltcG9ydCB7IFNjaGVtYXNSb3V0ZXIgfSAgICAgICAgZnJvbSAnLi9Sb3V0ZXJzL1NjaGVtYXNSb3V0ZXInO1xuaW1wb3J0IHsgU2Vzc2lvbnNSb3V0ZXIgfSAgICAgICBmcm9tICcuL1JvdXRlcnMvU2Vzc2lvbnNSb3V0ZXInO1xuaW1wb3J0IHsgVXNlcnNSb3V0ZXIgfSAgICAgICAgICBmcm9tICcuL1JvdXRlcnMvVXNlcnNSb3V0ZXInO1xuaW1wb3J0IHsgUHVyZ2VSb3V0ZXIgfSAgICAgICAgICBmcm9tICcuL1JvdXRlcnMvUHVyZ2VSb3V0ZXInO1xuaW1wb3J0IHsgQXVkaWVuY2VzUm91dGVyIH0gICAgICBmcm9tICcuL1JvdXRlcnMvQXVkaWVuY2VzUm91dGVyJztcbmltcG9ydCB7IEFnZ3JlZ2F0ZVJvdXRlciB9ICAgICAgZnJvbSAnLi9Sb3V0ZXJzL0FnZ3JlZ2F0ZVJvdXRlcic7XG5cbmltcG9ydCB7IFBhcnNlU2VydmVyUkVTVENvbnRyb2xsZXIgfSBmcm9tICcuL1BhcnNlU2VydmVyUkVTVENvbnRyb2xsZXInO1xuaW1wb3J0ICogYXMgY29udHJvbGxlcnMgZnJvbSAnLi9Db250cm9sbGVycyc7XG4vLyBNdXRhdGUgdGhlIFBhcnNlIG9iamVjdCB0byBhZGQgdGhlIENsb3VkIENvZGUgaGFuZGxlcnNcbmFkZFBhcnNlQ2xvdWQoKTtcblxuLy8gUGFyc2VTZXJ2ZXIgd29ya3MgbGlrZSBhIGNvbnN0cnVjdG9yIG9mIGFuIGV4cHJlc3MgYXBwLlxuLy8gVGhlIGFyZ3MgdGhhdCB3ZSB1bmRlcnN0YW5kIGFyZTpcbi8vIFwiYW5hbHl0aWNzQWRhcHRlclwiOiBhbiBhZGFwdGVyIGNsYXNzIGZvciBhbmFseXRpY3Ncbi8vIFwiZmlsZXNBZGFwdGVyXCI6IGEgY2xhc3MgbGlrZSBHcmlkU3RvcmVBZGFwdGVyIHByb3ZpZGluZyBjcmVhdGUsIGdldCxcbi8vICAgICAgICAgICAgICAgICBhbmQgZGVsZXRlXG4vLyBcImxvZ2dlckFkYXB0ZXJcIjogYSBjbGFzcyBsaWtlIFdpbnN0b25Mb2dnZXJBZGFwdGVyIHByb3ZpZGluZyBpbmZvLCBlcnJvcixcbi8vICAgICAgICAgICAgICAgICBhbmQgcXVlcnlcbi8vIFwianNvbkxvZ3NcIjogbG9nIGFzIHN0cnVjdHVyZWQgSlNPTiBvYmplY3RzXG4vLyBcImRhdGFiYXNlVVJJXCI6IGEgdXJpIGxpa2UgbW9uZ29kYjovL2xvY2FsaG9zdDoyNzAxNy9kYm5hbWUgdG8gdGVsbCB1c1xuLy8gICAgICAgICAgd2hhdCBkYXRhYmFzZSB0aGlzIFBhcnNlIEFQSSBjb25uZWN0cyB0by5cbi8vIFwiY2xvdWRcIjogcmVsYXRpdmUgbG9jYXRpb24gdG8gY2xvdWQgY29kZSB0byByZXF1aXJlLCBvciBhIGZ1bmN0aW9uXG4vLyAgICAgICAgICB0aGF0IGlzIGdpdmVuIGFuIGluc3RhbmNlIG9mIFBhcnNlIGFzIGEgcGFyYW1ldGVyLiAgVXNlIHRoaXMgaW5zdGFuY2Ugb2YgUGFyc2Vcbi8vICAgICAgICAgIHRvIHJlZ2lzdGVyIHlvdXIgY2xvdWQgY29kZSBob29rcyBhbmQgZnVuY3Rpb25zLlxuLy8gXCJhcHBJZFwiOiB0aGUgYXBwbGljYXRpb24gaWQgdG8gaG9zdFxuLy8gXCJtYXN0ZXJLZXlcIjogdGhlIG1hc3RlciBrZXkgZm9yIHJlcXVlc3RzIHRvIHRoaXMgYXBwXG4vLyBcImNvbGxlY3Rpb25QcmVmaXhcIjogb3B0aW9uYWwgcHJlZml4IGZvciBkYXRhYmFzZSBjb2xsZWN0aW9uIG5hbWVzXG4vLyBcImZpbGVLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkIGZvciBzdXBwb3J0aW5nIG9sZGVyIGZpbGVzXG4vLyAgICAgICAgICAgIGhvc3RlZCBieSBQYXJzZVxuLy8gXCJjbGllbnRLZXlcIjogb3B0aW9uYWwga2V5IGZyb20gUGFyc2UgZGFzaGJvYXJkXG4vLyBcImRvdE5ldEtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwicmVzdEFQSUtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwid2ViaG9va0tleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwiamF2YXNjcmlwdEtleVwiOiBvcHRpb25hbCBrZXkgZnJvbSBQYXJzZSBkYXNoYm9hcmRcbi8vIFwicHVzaFwiOiBvcHRpb25hbCBrZXkgZnJvbSBjb25maWd1cmUgcHVzaFxuLy8gXCJzZXNzaW9uTGVuZ3RoXCI6IG9wdGlvbmFsIGxlbmd0aCBpbiBzZWNvbmRzIGZvciBob3cgbG9uZyBTZXNzaW9ucyBzaG91bGQgYmUgdmFsaWQgZm9yXG4vLyBcIm1heExpbWl0XCI6IG9wdGlvbmFsIHVwcGVyIGJvdW5kIGZvciB3aGF0IGNhbiBiZSBzcGVjaWZpZWQgZm9yIHRoZSAnbGltaXQnIHBhcmFtZXRlciBvbiBxdWVyaWVzXG5cbmNsYXNzIFBhcnNlU2VydmVyIHtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBQYXJzZVNlcnZlck9wdGlvbnMpIHtcbiAgICBpbmplY3REZWZhdWx0cyhvcHRpb25zKTtcbiAgICBjb25zdCB7XG4gICAgICBhcHBJZCA9IHJlcXVpcmVkUGFyYW1ldGVyKCdZb3UgbXVzdCBwcm92aWRlIGFuIGFwcElkIScpLFxuICAgICAgbWFzdGVyS2V5ID0gcmVxdWlyZWRQYXJhbWV0ZXIoJ1lvdSBtdXN0IHByb3ZpZGUgYSBtYXN0ZXJLZXkhJyksXG4gICAgICBjbG91ZCxcbiAgICAgIGphdmFzY3JpcHRLZXksXG4gICAgICBzZXJ2ZXJVUkwgPSByZXF1aXJlZFBhcmFtZXRlcignWW91IG11c3QgcHJvdmlkZSBhIHNlcnZlclVSTCEnKSxcbiAgICAgIF9faW5kZXhCdWlsZENvbXBsZXRpb25DYWxsYmFja0ZvclRlc3RzID0gKCkgPT4ge30sXG4gICAgfSA9IG9wdGlvbnM7XG4gICAgLy8gSW5pdGlhbGl6ZSB0aGUgbm9kZSBjbGllbnQgU0RLIGF1dG9tYXRpY2FsbHlcbiAgICBQYXJzZS5pbml0aWFsaXplKGFwcElkLCBqYXZhc2NyaXB0S2V5IHx8ICd1bnVzZWQnLCBtYXN0ZXJLZXkpO1xuICAgIFBhcnNlLnNlcnZlclVSTCA9IHNlcnZlclVSTDtcblxuICAgIGNvbnN0IGFsbENvbnRyb2xsZXJzID0gY29udHJvbGxlcnMuZ2V0Q29udHJvbGxlcnMob3B0aW9ucyk7XG5cbiAgICBjb25zdCB7XG4gICAgICBsb2dnZXJDb250cm9sbGVyLFxuICAgICAgZGF0YWJhc2VDb250cm9sbGVyLFxuICAgICAgaG9va3NDb250cm9sbGVyLFxuICAgIH0gPSBhbGxDb250cm9sbGVycztcbiAgICB0aGlzLmNvbmZpZyA9IENvbmZpZy5wdXQoT2JqZWN0LmFzc2lnbih7fSwgb3B0aW9ucywgYWxsQ29udHJvbGxlcnMpKTtcblxuICAgIGxvZ2dpbmcuc2V0TG9nZ2VyKGxvZ2dlckNvbnRyb2xsZXIpO1xuICAgIGNvbnN0IGRiSW5pdFByb21pc2UgPSBkYXRhYmFzZUNvbnRyb2xsZXIucGVyZm9ybUluaXRpYWxpemF0aW9uKCk7XG4gICAgaG9va3NDb250cm9sbGVyLmxvYWQoKTtcblxuICAgIC8vIE5vdGU6IFRlc3RzIHdpbGwgc3RhcnQgdG8gZmFpbCBpZiBhbnkgdmFsaWRhdGlvbiBoYXBwZW5zIGFmdGVyIHRoaXMgaXMgY2FsbGVkLlxuICAgIGlmIChwcm9jZXNzLmVudi5URVNUSU5HKSB7XG4gICAgICBfX2luZGV4QnVpbGRDb21wbGV0aW9uQ2FsbGJhY2tGb3JUZXN0cyhkYkluaXRQcm9taXNlKTtcbiAgICB9XG5cbiAgICBpZiAoY2xvdWQpIHtcbiAgICAgIGFkZFBhcnNlQ2xvdWQoKTtcbiAgICAgIGlmICh0eXBlb2YgY2xvdWQgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgY2xvdWQoUGFyc2UpXG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBjbG91ZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgcmVxdWlyZShwYXRoLnJlc29sdmUocHJvY2Vzcy5jd2QoKSwgY2xvdWQpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRocm93IFwiYXJndW1lbnQgJ2Nsb3VkJyBtdXN0IGVpdGhlciBiZSBhIHN0cmluZyBvciBhIGZ1bmN0aW9uXCI7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZ2V0IGFwcCgpIHtcbiAgICBpZiAoIXRoaXMuX2FwcCkge1xuICAgICAgdGhpcy5fYXBwID0gUGFyc2VTZXJ2ZXIuYXBwKHRoaXMuY29uZmlnKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX2FwcDtcbiAgfVxuXG4gIGhhbmRsZVNodXRkb3duKCkge1xuICAgIGNvbnN0IHsgYWRhcHRlciB9ID0gdGhpcy5jb25maWcuZGF0YWJhc2VDb250cm9sbGVyO1xuICAgIGlmIChhZGFwdGVyICYmIHR5cGVvZiBhZGFwdGVyLmhhbmRsZVNodXRkb3duID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBhZGFwdGVyLmhhbmRsZVNodXRkb3duKCk7XG4gICAgfVxuICB9XG5cbiAgc3RhdGljIGFwcCh7bWF4VXBsb2FkU2l6ZSA9ICcyMG1iJywgYXBwSWR9KSB7XG4gICAgLy8gVGhpcyBhcHAgc2VydmVzIHRoZSBQYXJzZSBBUEkgZGlyZWN0bHkuXG4gICAgLy8gSXQncyB0aGUgZXF1aXZhbGVudCBvZiBodHRwczovL2FwaS5wYXJzZS5jb20vMSBpbiB0aGUgaG9zdGVkIFBhcnNlIEFQSS5cbiAgICB2YXIgYXBpID0gZXhwcmVzcygpO1xuICAgIC8vYXBpLnVzZShcIi9hcHBzXCIsIGV4cHJlc3Muc3RhdGljKF9fZGlybmFtZSArIFwiL3B1YmxpY1wiKSk7XG4gICAgLy8gRmlsZSBoYW5kbGluZyBuZWVkcyB0byBiZSBiZWZvcmUgZGVmYXVsdCBtaWRkbGV3YXJlcyBhcmUgYXBwbGllZFxuICAgIGFwaS51c2UoJy8nLCBtaWRkbGV3YXJlcy5hbGxvd0Nyb3NzRG9tYWluLCBuZXcgRmlsZXNSb3V0ZXIoKS5leHByZXNzUm91dGVyKHtcbiAgICAgIG1heFVwbG9hZFNpemU6IG1heFVwbG9hZFNpemVcbiAgICB9KSk7XG5cbiAgICBhcGkudXNlKCcvaGVhbHRoJywgKGZ1bmN0aW9uKHJlcSwgcmVzKSB7XG4gICAgICByZXMuanNvbih7XG4gICAgICAgIHN0YXR1czogJ29rJ1xuICAgICAgfSk7XG4gICAgfSkpO1xuXG4gICAgYXBpLnVzZSgnLycsIGJvZHlQYXJzZXIudXJsZW5jb2RlZCh7ZXh0ZW5kZWQ6IGZhbHNlfSksIG5ldyBQdWJsaWNBUElSb3V0ZXIoKS5leHByZXNzUm91dGVyKCkpO1xuXG4gICAgYXBpLnVzZShib2R5UGFyc2VyLmpzb24oeyAndHlwZSc6ICcqLyonICwgbGltaXQ6IG1heFVwbG9hZFNpemUgfSkpO1xuICAgIGFwaS51c2UobWlkZGxld2FyZXMuYWxsb3dDcm9zc0RvbWFpbik7XG4gICAgYXBpLnVzZShtaWRkbGV3YXJlcy5hbGxvd01ldGhvZE92ZXJyaWRlKTtcbiAgICBhcGkudXNlKG1pZGRsZXdhcmVzLmhhbmRsZVBhcnNlSGVhZGVycyk7XG5cbiAgICBjb25zdCBhcHBSb3V0ZXIgPSBQYXJzZVNlcnZlci5wcm9taXNlUm91dGVyKHsgYXBwSWQgfSk7XG4gICAgYXBpLnVzZShhcHBSb3V0ZXIuZXhwcmVzc1JvdXRlcigpKTtcblxuICAgIGFwaS51c2UobWlkZGxld2FyZXMuaGFuZGxlUGFyc2VFcnJvcnMpO1xuXG4gICAgLy8gcnVuIHRoZSBmb2xsb3dpbmcgd2hlbiBub3QgdGVzdGluZ1xuICAgIGlmICghcHJvY2Vzcy5lbnYuVEVTVElORykge1xuICAgICAgLy9UaGlzIGNhdXNlcyB0ZXN0cyB0byBzcGV3IHNvbWUgdXNlbGVzcyB3YXJuaW5ncywgc28gZGlzYWJsZSBpbiB0ZXN0XG4gICAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dCAqL1xuICAgICAgcHJvY2Vzcy5vbigndW5jYXVnaHRFeGNlcHRpb24nLCAoZXJyKSA9PiB7XG4gICAgICAgIGlmIChlcnIuY29kZSA9PT0gXCJFQUREUklOVVNFXCIpIHsgLy8gdXNlci1mcmllbmRseSBtZXNzYWdlIGZvciB0aGlzIGNvbW1vbiBlcnJvclxuICAgICAgICAgIHByb2Nlc3Muc3RkZXJyLndyaXRlKGBVbmFibGUgdG8gbGlzdGVuIG9uIHBvcnQgJHtlcnIucG9ydH0uIFRoZSBwb3J0IGlzIGFscmVhZHkgaW4gdXNlLmApO1xuICAgICAgICAgIHByb2Nlc3MuZXhpdCgwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgLy8gdmVyaWZ5IHRoZSBzZXJ2ZXIgdXJsIGFmdGVyIGEgJ21vdW50JyBldmVudCBpcyByZWNlaXZlZFxuICAgICAgLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbiAgICAgIGFwaS5vbignbW91bnQnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgUGFyc2VTZXJ2ZXIudmVyaWZ5U2VydmVyVXJsKCk7XG4gICAgICB9KTtcbiAgICB9XG4gICAgaWYgKHByb2Nlc3MuZW52LlBBUlNFX1NFUlZFUl9FTkFCTEVfRVhQRVJJTUVOVEFMX0RJUkVDVF9BQ0NFU1MgPT09ICcxJykge1xuICAgICAgUGFyc2UuQ29yZU1hbmFnZXIuc2V0UkVTVENvbnRyb2xsZXIoUGFyc2VTZXJ2ZXJSRVNUQ29udHJvbGxlcihhcHBJZCwgYXBwUm91dGVyKSk7XG4gICAgfVxuICAgIHJldHVybiBhcGk7XG4gIH1cblxuICBzdGF0aWMgcHJvbWlzZVJvdXRlcih7YXBwSWR9KSB7XG4gICAgY29uc3Qgcm91dGVycyA9IFtcbiAgICAgIG5ldyBDbGFzc2VzUm91dGVyKCksXG4gICAgICBuZXcgVXNlcnNSb3V0ZXIoKSxcbiAgICAgIG5ldyBTZXNzaW9uc1JvdXRlcigpLFxuICAgICAgbmV3IFJvbGVzUm91dGVyKCksXG4gICAgICBuZXcgQW5hbHl0aWNzUm91dGVyKCksXG4gICAgICBuZXcgSW5zdGFsbGF0aW9uc1JvdXRlcigpLFxuICAgICAgbmV3IEZ1bmN0aW9uc1JvdXRlcigpLFxuICAgICAgbmV3IFNjaGVtYXNSb3V0ZXIoKSxcbiAgICAgIG5ldyBQdXNoUm91dGVyKCksXG4gICAgICBuZXcgTG9nc1JvdXRlcigpLFxuICAgICAgbmV3IElBUFZhbGlkYXRpb25Sb3V0ZXIoKSxcbiAgICAgIG5ldyBGZWF0dXJlc1JvdXRlcigpLFxuICAgICAgbmV3IEdsb2JhbENvbmZpZ1JvdXRlcigpLFxuICAgICAgbmV3IFB1cmdlUm91dGVyKCksXG4gICAgICBuZXcgSG9va3NSb3V0ZXIoKSxcbiAgICAgIG5ldyBDbG91ZENvZGVSb3V0ZXIoKSxcbiAgICAgIG5ldyBBdWRpZW5jZXNSb3V0ZXIoKSxcbiAgICAgIG5ldyBBZ2dyZWdhdGVSb3V0ZXIoKVxuICAgIF07XG5cbiAgICBjb25zdCByb3V0ZXMgPSByb3V0ZXJzLnJlZHVjZSgobWVtbywgcm91dGVyKSA9PiB7XG4gICAgICByZXR1cm4gbWVtby5jb25jYXQocm91dGVyLnJvdXRlcyk7XG4gICAgfSwgW10pO1xuXG4gICAgY29uc3QgYXBwUm91dGVyID0gbmV3IFByb21pc2VSb3V0ZXIocm91dGVzLCBhcHBJZCk7XG5cbiAgICBiYXRjaC5tb3VudE9udG8oYXBwUm91dGVyKTtcbiAgICByZXR1cm4gYXBwUm91dGVyO1xuICB9XG5cbiAgc3RhcnQob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zLCBjYWxsYmFjazogPygpPT52b2lkKSB7XG4gICAgY29uc3QgYXBwID0gZXhwcmVzcygpO1xuICAgIGlmIChvcHRpb25zLm1pZGRsZXdhcmUpIHtcbiAgICAgIGxldCBtaWRkbGV3YXJlO1xuICAgICAgaWYgKHR5cGVvZiBvcHRpb25zLm1pZGRsZXdhcmUgPT0gJ3N0cmluZycpIHtcbiAgICAgICAgbWlkZGxld2FyZSA9IHJlcXVpcmUocGF0aC5yZXNvbHZlKHByb2Nlc3MuY3dkKCksIG9wdGlvbnMubWlkZGxld2FyZSkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWlkZGxld2FyZSA9IG9wdGlvbnMubWlkZGxld2FyZTsgLy8gdXNlIGFzLWlzIGxldCBleHByZXNzIGZhaWxcbiAgICAgIH1cbiAgICAgIGFwcC51c2UobWlkZGxld2FyZSk7XG4gICAgfVxuXG4gICAgYXBwLnVzZShvcHRpb25zLm1vdW50UGF0aCwgdGhpcy5hcHApO1xuICAgIGNvbnN0IHNlcnZlciA9IGFwcC5saXN0ZW4ob3B0aW9ucy5wb3J0LCBvcHRpb25zLmhvc3QsIGNhbGxiYWNrKTtcbiAgICB0aGlzLnNlcnZlciA9IHNlcnZlcjtcblxuICAgIGlmIChvcHRpb25zLnN0YXJ0TGl2ZVF1ZXJ5U2VydmVyIHx8IG9wdGlvbnMubGl2ZVF1ZXJ5U2VydmVyT3B0aW9ucykge1xuICAgICAgdGhpcy5saXZlUXVlcnlTZXJ2ZXIgPSBQYXJzZVNlcnZlci5jcmVhdGVMaXZlUXVlcnlTZXJ2ZXIoc2VydmVyLCBvcHRpb25zLmxpdmVRdWVyeVNlcnZlck9wdGlvbnMpO1xuICAgIH1cbiAgICAvKiBpc3RhbmJ1bCBpZ25vcmUgbmV4dCAqL1xuICAgIGlmICghcHJvY2Vzcy5lbnYuVEVTVElORykge1xuICAgICAgY29uZmlndXJlTGlzdGVuZXJzKHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLmV4cHJlc3NBcHAgPSBhcHA7XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICBzdGF0aWMgc3RhcnQob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zLCBjYWxsYmFjazogPygpPT52b2lkKSB7XG4gICAgY29uc3QgcGFyc2VTZXJ2ZXIgPSBuZXcgUGFyc2VTZXJ2ZXIob3B0aW9ucyk7XG4gICAgcmV0dXJuIHBhcnNlU2VydmVyLnN0YXJ0KG9wdGlvbnMsIGNhbGxiYWNrKTtcbiAgfVxuXG4gIHN0YXRpYyBjcmVhdGVMaXZlUXVlcnlTZXJ2ZXIoaHR0cFNlcnZlciwgY29uZmlnOiBMaXZlUXVlcnlTZXJ2ZXJPcHRpb25zKSB7XG4gICAgaWYgKCFodHRwU2VydmVyIHx8IChjb25maWcgJiYgY29uZmlnLnBvcnQpKSB7XG4gICAgICB2YXIgYXBwID0gZXhwcmVzcygpO1xuICAgICAgaHR0cFNlcnZlciA9IHJlcXVpcmUoJ2h0dHAnKS5jcmVhdGVTZXJ2ZXIoYXBwKTtcbiAgICAgIGh0dHBTZXJ2ZXIubGlzdGVuKGNvbmZpZy5wb3J0KTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBQYXJzZUxpdmVRdWVyeVNlcnZlcihodHRwU2VydmVyLCBjb25maWcpO1xuICB9XG5cbiAgc3RhdGljIHZlcmlmeVNlcnZlclVybChjYWxsYmFjaykge1xuICAgIC8vIHBlcmZvcm0gYSBoZWFsdGggY2hlY2sgb24gdGhlIHNlcnZlclVSTCB2YWx1ZVxuICAgIGlmKFBhcnNlLnNlcnZlclVSTCkge1xuICAgICAgY29uc3QgcmVxdWVzdCA9IHJlcXVpcmUoJ3JlcXVlc3QnKTtcbiAgICAgIHJlcXVlc3QoUGFyc2Uuc2VydmVyVVJMLnJlcGxhY2UoL1xcLyQvLCBcIlwiKSArIFwiL2hlYWx0aFwiLCBmdW5jdGlvbiAoZXJyb3IsIHJlc3BvbnNlLCBib2R5KSB7XG4gICAgICAgIGxldCBqc29uO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGpzb24gPSBKU09OLnBhcnNlKGJvZHkpO1xuICAgICAgICB9IGNhdGNoKGUpIHtcbiAgICAgICAgICBqc29uID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoZXJyb3IgfHwgcmVzcG9uc2Uuc3RhdHVzQ29kZSAhPT0gMjAwIHx8ICFqc29uIHx8IGpzb24gJiYganNvbi5zdGF0dXMgIT09ICdvaycpIHtcbiAgICAgICAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgICAgICAgY29uc29sZS53YXJuKGBcXG5XQVJOSU5HLCBVbmFibGUgdG8gY29ubmVjdCB0byAnJHtQYXJzZS5zZXJ2ZXJVUkx9Jy5gICtcbiAgICAgICAgICAgIGAgQ2xvdWQgY29kZSBhbmQgcHVzaCBub3RpZmljYXRpb25zIG1heSBiZSB1bmF2YWlsYWJsZSFcXG5gKTtcbiAgICAgICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLWNvbnNvbGUgKi9cbiAgICAgICAgICBpZihjYWxsYmFjaykge1xuICAgICAgICAgICAgY2FsbGJhY2soZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZihjYWxsYmFjaykge1xuICAgICAgICAgICAgY2FsbGJhY2sodHJ1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gYWRkUGFyc2VDbG91ZCgpIHtcbiAgY29uc3QgUGFyc2VDbG91ZCA9IHJlcXVpcmUoXCIuL2Nsb3VkLWNvZGUvUGFyc2UuQ2xvdWRcIik7XG4gIE9iamVjdC5hc3NpZ24oUGFyc2UuQ2xvdWQsIFBhcnNlQ2xvdWQpO1xuICBnbG9iYWwuUGFyc2UgPSBQYXJzZTtcbn1cblxuZnVuY3Rpb24gaW5qZWN0RGVmYXVsdHMob3B0aW9uczogUGFyc2VTZXJ2ZXJPcHRpb25zKSB7XG4gIE9iamVjdC5rZXlzKGRlZmF1bHRzKS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICBpZiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgb3B0aW9uc1trZXldID0gZGVmYXVsdHNba2V5XTtcbiAgICB9XG4gIH0pO1xuXG4gIGlmICghb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnc2VydmVyVVJMJykpIHtcbiAgICBvcHRpb25zLnNlcnZlclVSTCA9IGBodHRwOi8vbG9jYWxob3N0OiR7b3B0aW9ucy5wb3J0fSR7b3B0aW9ucy5tb3VudFBhdGh9YDtcbiAgfVxuXG4gIG9wdGlvbnMudXNlclNlbnNpdGl2ZUZpZWxkcyA9IEFycmF5LmZyb20obmV3IFNldChvcHRpb25zLnVzZXJTZW5zaXRpdmVGaWVsZHMuY29uY2F0KFxuICAgIGRlZmF1bHRzLnVzZXJTZW5zaXRpdmVGaWVsZHMsXG4gICAgb3B0aW9ucy51c2VyU2Vuc2l0aXZlRmllbGRzXG4gICkpKTtcblxuICBvcHRpb25zLm1hc3RlcktleUlwcyA9IEFycmF5LmZyb20obmV3IFNldChvcHRpb25zLm1hc3RlcktleUlwcy5jb25jYXQoXG4gICAgZGVmYXVsdHMubWFzdGVyS2V5SXBzLFxuICAgIG9wdGlvbnMubWFzdGVyS2V5SXBzXG4gICkpKTtcbn1cblxuLy8gVGhvc2UgY2FuJ3QgYmUgdGVzdGVkIGFzIGl0IHJlcXVpcmVzIGEgc3VicHJvY2Vzc1xuLyogaXN0YW5idWwgaWdub3JlIG5leHQgKi9cbmZ1bmN0aW9uIGNvbmZpZ3VyZUxpc3RlbmVycyhwYXJzZVNlcnZlcikge1xuICBjb25zdCBzZXJ2ZXIgPSBwYXJzZVNlcnZlci5zZXJ2ZXI7XG4gIGNvbnN0IHNvY2tldHMgPSB7fTtcbiAgLyogQ3VycmVudGx5LCBleHByZXNzIGRvZXNuJ3Qgc2h1dCBkb3duIGltbWVkaWF0ZWx5IGFmdGVyIHJlY2VpdmluZyBTSUdJTlQvU0lHVEVSTSBpZiBpdCBoYXMgY2xpZW50IGNvbm5lY3Rpb25zIHRoYXQgaGF2ZW4ndCB0aW1lZCBvdXQuIChUaGlzIGlzIGEga25vd24gaXNzdWUgd2l0aCBub2RlIC0gaHR0cHM6Ly9naXRodWIuY29tL25vZGVqcy9ub2RlL2lzc3Vlcy8yNjQyKVxuICAgIFRoaXMgZnVuY3Rpb24sIGFsb25nIHdpdGggYGRlc3Ryb3lBbGl2ZUNvbm5lY3Rpb25zKClgLCBpbnRlbmQgdG8gZml4IHRoaXMgYmVoYXZpb3Igc3VjaCB0aGF0IHBhcnNlIHNlcnZlciB3aWxsIGNsb3NlIGFsbCBvcGVuIGNvbm5lY3Rpb25zIGFuZCBpbml0aWF0ZSB0aGUgc2h1dGRvd24gcHJvY2VzcyBhcyBzb29uIGFzIGl0IHJlY2VpdmVzIGEgU0lHSU5UL1NJR1RFUk0gc2lnbmFsLiAqL1xuICBzZXJ2ZXIub24oJ2Nvbm5lY3Rpb24nLCAoc29ja2V0KSA9PiB7XG4gICAgY29uc3Qgc29ja2V0SWQgPSBzb2NrZXQucmVtb3RlQWRkcmVzcyArICc6JyArIHNvY2tldC5yZW1vdGVQb3J0O1xuICAgIHNvY2tldHNbc29ja2V0SWRdID0gc29ja2V0O1xuICAgIHNvY2tldC5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICBkZWxldGUgc29ja2V0c1tzb2NrZXRJZF07XG4gICAgfSk7XG4gIH0pO1xuXG4gIGNvbnN0IGRlc3Ryb3lBbGl2ZUNvbm5lY3Rpb25zID0gZnVuY3Rpb24oKSB7XG4gICAgZm9yIChjb25zdCBzb2NrZXRJZCBpbiBzb2NrZXRzKSB7XG4gICAgICB0cnkge1xuICAgICAgICBzb2NrZXRzW3NvY2tldElkXS5kZXN0cm95KCk7XG4gICAgICB9IGNhdGNoIChlKSB7IC8qICovIH1cbiAgICB9XG4gIH1cblxuICBjb25zdCBoYW5kbGVTaHV0ZG93biA9IGZ1bmN0aW9uKCkge1xuICAgIHByb2Nlc3Muc3Rkb3V0LndyaXRlKCdUZXJtaW5hdGlvbiBzaWduYWwgcmVjZWl2ZWQuIFNodXR0aW5nIGRvd24uJyk7XG4gICAgZGVzdHJveUFsaXZlQ29ubmVjdGlvbnMoKTtcbiAgICBzZXJ2ZXIuY2xvc2UoKTtcbiAgICBwYXJzZVNlcnZlci5oYW5kbGVTaHV0ZG93bigpO1xuICB9O1xuICBwcm9jZXNzLm9uKCdTSUdURVJNJywgaGFuZGxlU2h1dGRvd24pO1xuICBwcm9jZXNzLm9uKCdTSUdJTlQnLCBoYW5kbGVTaHV0ZG93bik7XG59XG5cbmV4cG9ydCBkZWZhdWx0IFBhcnNlU2VydmVyO1xuIl19