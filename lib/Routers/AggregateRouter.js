'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AggregateRouter = undefined;

var _ClassesRouter = require('./ClassesRouter');

var _ClassesRouter2 = _interopRequireDefault(_ClassesRouter);

var _rest = require('../rest');

var _rest2 = _interopRequireDefault(_rest);

var _middlewares = require('../middlewares');

var middleware = _interopRequireWildcard(_middlewares);

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _UsersRouter = require('./UsersRouter');

var _UsersRouter2 = _interopRequireDefault(_UsersRouter);

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const BASE_KEYS = ['where', 'distinct'];

const PIPELINE_KEYS = ['addFields', 'bucket', 'bucketAuto', 'collStats', 'count', 'currentOp', 'facet', 'geoNear', 'graphLookup', 'group', 'indexStats', 'limit', 'listLocalSessions', 'listSessions', 'lookup', 'match', 'out', 'project', 'redact', 'replaceRoot', 'sample', 'skip', 'sort', 'sortByCount', 'unwind'];

const ALLOWED_KEYS = [...BASE_KEYS, ...PIPELINE_KEYS];

class AggregateRouter extends _ClassesRouter2.default {

  handleFind(req) {
    const body = Object.assign(req.body, _ClassesRouter2.default.JSONFromQuery(req.query));
    const options = {};
    let pipeline = [];

    if (Array.isArray(body)) {
      pipeline = body.map(stage => {
        const stageName = Object.keys(stage)[0];
        return this.transformStage(stageName, stage);
      });
    } else {
      const stages = [];
      for (const stageName in body) {
        stages.push(this.transformStage(stageName, body));
      }
      pipeline = stages;
    }
    if (body.distinct) {
      options.distinct = String(body.distinct);
    }
    options.pipeline = pipeline;
    if (typeof body.where === 'string') {
      body.where = JSON.parse(body.where);
    }
    return _rest2.default.find(req.config, req.auth, this.className(req), body.where, options, req.info.clientSDK).then(response => {
      for (const result of response.results) {
        if (typeof result === 'object') {
          _UsersRouter2.default.removeHiddenProperties(result);
        }
      }
      return { response };
    });
  }

  transformStage(stageName, stage) {
    if (ALLOWED_KEYS.indexOf(stageName) === -1) {
      throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Invalid parameter for query: ${stageName}`);
    }
    if (stageName === 'group') {
      if (stage[stageName].hasOwnProperty('_id')) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Invalid parameter for query: group. Please use objectId instead of _id`);
      }
      if (!stage[stageName].hasOwnProperty('objectId')) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Invalid parameter for query: group. objectId is required`);
      }
      stage[stageName]._id = stage[stageName].objectId;
      delete stage[stageName].objectId;
    }
    return { [`$${stageName}`]: stage[stageName] };
  }

  mountRoutes() {
    this.route('GET', '/aggregate/:className', middleware.promiseEnforceMasterKeyAccess, req => {
      return this.handleFind(req);
    });
  }
}

exports.AggregateRouter = AggregateRouter;
exports.default = AggregateRouter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Sb3V0ZXJzL0FnZ3JlZ2F0ZVJvdXRlci5qcyJdLCJuYW1lcyI6WyJtaWRkbGV3YXJlIiwiQkFTRV9LRVlTIiwiUElQRUxJTkVfS0VZUyIsIkFMTE9XRURfS0VZUyIsIkFnZ3JlZ2F0ZVJvdXRlciIsImhhbmRsZUZpbmQiLCJyZXEiLCJib2R5IiwiT2JqZWN0IiwiYXNzaWduIiwiSlNPTkZyb21RdWVyeSIsInF1ZXJ5Iiwib3B0aW9ucyIsInBpcGVsaW5lIiwiQXJyYXkiLCJpc0FycmF5IiwibWFwIiwic3RhZ2UiLCJzdGFnZU5hbWUiLCJrZXlzIiwidHJhbnNmb3JtU3RhZ2UiLCJzdGFnZXMiLCJwdXNoIiwiZGlzdGluY3QiLCJTdHJpbmciLCJ3aGVyZSIsIkpTT04iLCJwYXJzZSIsImZpbmQiLCJjb25maWciLCJhdXRoIiwiY2xhc3NOYW1lIiwiaW5mbyIsImNsaWVudFNESyIsInRoZW4iLCJyZXNwb25zZSIsInJlc3VsdCIsInJlc3VsdHMiLCJyZW1vdmVIaWRkZW5Qcm9wZXJ0aWVzIiwiaW5kZXhPZiIsIkVycm9yIiwiSU5WQUxJRF9RVUVSWSIsImhhc093blByb3BlcnR5IiwiX2lkIiwib2JqZWN0SWQiLCJtb3VudFJvdXRlcyIsInJvdXRlIiwicHJvbWlzZUVuZm9yY2VNYXN0ZXJLZXlBY2Nlc3MiXSwibWFwcGluZ3MiOiI7Ozs7Ozs7QUFBQTs7OztBQUNBOzs7O0FBQ0E7O0lBQVlBLFU7O0FBQ1o7Ozs7QUFDQTs7Ozs7Ozs7QUFFQSxNQUFNQyxZQUFZLENBQUMsT0FBRCxFQUFVLFVBQVYsQ0FBbEI7O0FBRUEsTUFBTUMsZ0JBQWdCLENBQ3BCLFdBRG9CLEVBRXBCLFFBRm9CLEVBR3BCLFlBSG9CLEVBSXBCLFdBSm9CLEVBS3BCLE9BTG9CLEVBTXBCLFdBTm9CLEVBT3BCLE9BUG9CLEVBUXBCLFNBUm9CLEVBU3BCLGFBVG9CLEVBVXBCLE9BVm9CLEVBV3BCLFlBWG9CLEVBWXBCLE9BWm9CLEVBYXBCLG1CQWJvQixFQWNwQixjQWRv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QU0sSUFBSSxlQUFNRixLQUFWLENBQ0osZUFBTUEsS0FBTixDQUFZQyxhQURSLEVBRUgsMERBRkcsQ0FBTjtBQUlEO0FBQ0R4QixZQUFNQyxTQUFOLEVBQWlCeUIsR0FBakIsR0FBdUIxQixNQUFNQyxTQUFOLEVBQWlCMEIsUUFBeEM7QUFDQSxhQUFPM0IsTUFBTUMsU0FBTixFQUFpQjBCLFFBQXhCO0FBQ0Q7QUFDRCxXQUFPLEVBQUUsQ0FBRSxJQUFHMUIsU0FBVSxFQUFmLEdBQW1CRCxNQUFNQyxTQUFOLENBQXJCLEVBQVA7QUFDRDs7QUFFRDJCLGdCQUFjO0FBQ1osU0FBS0MsS0FBTCxDQUFXLEtBQVgsRUFBaUIsdUJBQWpCLEVBQTBDOUMsV0FBVytDLDZCQUFyRCxFQUFvRnpDLE9BQU87QUFBRSxhQUFPLEtBQUtELFVBQUwsQ0FBZ0JDLEdBQWhCLENBQVA7QUFBOEIsS0FBM0g7QUFDRDtBQWhFZ0Q7O1FBQXRDRixlLEdBQUFBLGU7a0JBbUVFQSxlIiwiZmlsZSI6IkFnZ3JlZ2F0ZVJvdXRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBDbGFzc2VzUm91dGVyIGZyb20gJy4vQ2xhc3Nlc1JvdXRlcic7XG5pbXBvcnQgcmVzdCBmcm9tICcuLi9yZXN0JztcbmltcG9ydCAqIGFzIG1pZGRsZXdhcmUgZnJvbSAnLi4vbWlkZGxld2FyZXMnO1xuaW1wb3J0IFBhcnNlICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG5pbXBvcnQgVXNlcnNSb3V0ZXIgICBmcm9tICcuL1VzZXJzUm91dGVyJztcblxuY29uc3QgQkFTRV9LRVlTID0gWyd3aGVyZScsICdkaXN0aW5jdCddO1xuXG5jb25zdCBQSVBFTElORV9LRVlTID0gW1xuICAnYWRkRmllbGRzJyxcbiAgJ2J1Y2tldCcsXG4gICdidWNrZXRBdXRvJyxcbiAgJ2NvbGxTdGF0cycsXG4gICdjb3VudCcsXG4gICdjdXJyZW50T3AnLFxuICAnZmFjZXQnLFxuICAnZ2VvTmVhcicsXG4gICdncmFwaExvb2t1cCcsXG4gICdncm91cCcsXG4gICdpbmRleFN0YXRzJyxcbiAgJ2xpbWl0JyxcbiAgJ2xpc3RMb2NhbFNlc3Npb25zJyxcbiAgJ2xpc3RTZXNzaW9ucycsXG4gICdsb29rdXAnLFxuICAnbWF0Y2gnLFxuICAnb3V0JyxcbiAgJ3Byb2plY3QnLFxuICAncmVkYWN0JyxcbiAgJ3JlcGxhY2VSb290JyxcbiAgJ3NhbXBsZScsXG4gICdza2lwJyxcbiAgJ3NvcnQnLFxuICAnc29ydEJ5Q291bnQnLFxuICAndW53aW5kJyxcbl07XG5cbmNvbnN0IEFMTE9XRURfS0VZUyA9IFsuLi5CQVNFX0tFWVMsIC4uLlBJUEVMSU5FX0tFWVNdO1xuXG5leHBvcnQgY2xhc3MgQWdncmVnYXRlUm91dGVyIGV4dGVuZHMgQ2xhc3Nlc1JvdXRlciB7XG5cbiAgaGFuZGxlRmluZChyZXEpIHtcbiAgICBjb25zdCBib2R5ID0gT2JqZWN0LmFzc2lnbihyZXEuYm9keSwgQ2xhc3Nlc1JvdXRlci5KU09ORnJvbVF1ZXJ5KHJlcS5xdWVyeSkpO1xuICAgIGNvbnN0IG9wdGlvbnMgPSB7fTtcbiAgICBsZXQgcGlwZWxpbmUgPSBbXTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KGJvZHkpKSB7XG4gICAgICBwaXBlbGluZSA9IGJvZHkubWFwKChzdGFnZSkgPT4ge1xuICAgICAgICBjb25zdCBzdGFnZU5hbWUgPSBPYmplY3Qua2V5cyhzdGFnZSlbMF07XG4gICAgICAgIHJldHVybiB0aGlzLnRyYW5zZm9ybVN0YWdlKHN0YWdlTmFtZSwgc3RhZ2UpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHN0YWdlcyA9IFtdO1xuICAgICAgZm9yIChjb25zdCBzdGFnZU5hbWUgaW4gYm9keSkge1xuICAgICAgICBzdGFnZXMucHVzaCh0aGlzLnRyYW5zZm9ybVN0YWdlKHN0YWdlTmFtZSwgYm9keSkpO1xuICAgICAgfVxuICAgICAgcGlwZWxpbmUgPSBzdGFnZXM7XG4gICAgfVxuICAgIGlmIChib2R5LmRpc3RpbmN0KSB7XG4gICAgICBvcHRpb25zLmRpc3RpbmN0ID0gU3RyaW5nKGJvZHkuZGlzdGluY3QpO1xuICAgIH1cbiAgICBvcHRpb25zLnBpcGVsaW5lID0gcGlwZWxpbmU7XG4gICAgaWYgKHR5cGVvZiBib2R5LndoZXJlID09PSAnc3RyaW5nJykge1xuICAgICAgYm9keS53aGVyZSA9IEpTT04ucGFyc2UoYm9keS53aGVyZSk7XG4gICAgfVxuICAgIHJldHVybiByZXN0LmZpbmQocmVxLmNvbmZpZywgcmVxLmF1dGgsIHRoaXMuY2xhc3NOYW1lKHJlcSksIGJvZHkud2hlcmUsIG9wdGlvbnMsIHJlcS5pbmZvLmNsaWVudFNESykudGhlbigocmVzcG9uc2UpID0+IHtcbiAgICAgIGZvcihjb25zdCByZXN1bHQgb2YgcmVzcG9uc2UucmVzdWx0cykge1xuICAgICAgICBpZih0eXBlb2YgcmVzdWx0ID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgIFVzZXJzUm91dGVyLnJlbW92ZUhpZGRlblByb3BlcnRpZXMocmVzdWx0KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHsgcmVzcG9uc2UgfTtcbiAgICB9KTtcbiAgfVxuXG4gIHRyYW5zZm9ybVN0YWdlKHN0YWdlTmFtZSwgc3RhZ2UpIHtcbiAgICBpZiAoQUxMT1dFRF9LRVlTLmluZGV4T2Yoc3RhZ2VOYW1lKSA9PT0gLTEpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSxcbiAgICAgICAgYEludmFsaWQgcGFyYW1ldGVyIGZvciBxdWVyeTogJHtzdGFnZU5hbWV9YFxuICAgICAgKTtcbiAgICB9XG4gICAgaWYgKHN0YWdlTmFtZSA9PT0gJ2dyb3VwJykge1xuICAgICAgaWYgKHN0YWdlW3N0YWdlTmFtZV0uaGFzT3duUHJvcGVydHkoJ19pZCcpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAgIGBJbnZhbGlkIHBhcmFtZXRlciBmb3IgcXVlcnk6IGdyb3VwLiBQbGVhc2UgdXNlIG9iamVjdElkIGluc3RlYWQgb2YgX2lkYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKCFzdGFnZVtzdGFnZU5hbWVdLmhhc093blByb3BlcnR5KCdvYmplY3RJZCcpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLFxuICAgICAgICAgIGBJbnZhbGlkIHBhcmFtZXRlciBmb3IgcXVlcnk6IGdyb3VwLiBvYmplY3RJZCBpcyByZXF1aXJlZGBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHN0YWdlW3N0YWdlTmFtZV0uX2lkID0gc3RhZ2Vbc3RhZ2VOYW1lXS5vYmplY3RJZDtcbiAgICAgIGRlbGV0ZSBzdGFnZVtzdGFnZU5hbWVdLm9iamVjdElkO1xuICAgIH1cbiAgICByZXR1cm4geyBbYCQke3N0YWdlTmFtZX1gXTogc3RhZ2Vbc3RhZ2VOYW1lXSB9O1xuICB9XG5cbiAgbW91bnRSb3V0ZXMoKSB7XG4gICAgdGhpcy5yb3V0ZSgnR0VUJywnL2FnZ3JlZ2F0ZS86Y2xhc3NOYW1lJywgbWlkZGxld2FyZS5wcm9taXNlRW5mb3JjZU1hc3RlcktleUFjY2VzcywgcmVxID0+IHsgcmV0dXJuIHRoaXMuaGFuZGxlRmluZChyZXEpOyB9KTtcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBBZ2dyZWdhdGVSb3V0ZXI7XG4iXX0=