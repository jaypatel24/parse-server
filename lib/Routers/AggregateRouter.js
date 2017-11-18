'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AggregateRouter = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _ClassesRouter2 = require('./ClassesRouter');

var _ClassesRouter3 = _interopRequireDefault(_ClassesRouter2);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var ALLOWED_KEYS = ['where', 'distinct', 'project', 'match', 'redact', 'limit', 'skip', 'unwind', 'group', 'sample', 'sort', 'geoNear', 'lookup', 'out', 'indexStats', 'facet', 'bucket', 'bucketAuto', 'sortByCount', 'addFields', 'replaceRoot', 'count', 'graphLookup'];

var AggregateRouter = exports.AggregateRouter = function (_ClassesRouter) {
  _inherits(AggregateRouter, _ClassesRouter);

  function AggregateRouter() {
    _classCallCheck(this, AggregateRouter);

    return _possibleConstructorReturn(this, (AggregateRouter.__proto__ || Object.getPrototypeOf(AggregateRouter)).apply(this, arguments));
  }

  _createClass(AggregateRouter, [{
    key: 'handleFind',
    value: function handleFind(req) {
      var body = Object.assign(req.body, _ClassesRouter3.default.JSONFromQuery(req.query));
      var options = {};
      var pipeline = [];

      for (var key in body) {
        if (ALLOWED_KEYS.indexOf(key) === -1) {
          throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, 'Invalid parameter for query: ' + key);
        }
        if (key === 'group') {
          if (body[key].hasOwnProperty('_id')) {
            throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, 'Invalid parameter for query: group. Please use objectId instead of _id');
          }
          if (!body[key].hasOwnProperty('objectId')) {
            throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, 'Invalid parameter for query: group. objectId is required');
          }
          body[key]._id = body[key].objectId;
          delete body[key].objectId;
        }
        pipeline.push(_defineProperty({}, '$' + key, body[key]));
      }
      if (body.distinct) {
        options.distinct = String(body.distinct);
      }
      options.pipeline = pipeline;
      if (typeof body.where === 'string') {
        body.where = JSON.parse(body.where);
      }
      return _rest2.default.find(req.config, req.auth, this.className(req), body.where, options, req.info.clientSDK).then(function (response) {
        return { response: response };
      });
    }
  }, {
    key: 'mountRoutes',
    value: function mountRoutes() {
      var _this2 = this;

      this.route('GET', '/aggregate/:className', middleware.promiseEnforceMasterKeyAccess, function (req) {
        return _this2.handleFind(req);
      });
    }
  }]);

  return AggregateRouter;
}(_ClassesRouter3.default);

exports.default = AggregateRouter;