'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.PostgresStorageAdapter = undefined;

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };
// -disable-next

// -disable-next


var _PostgresClient = require('./PostgresClient');

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _sql = require('./sql');

var _sql2 = _interopRequireDefault(_sql);

var _StorageAdapter = require('../StorageAdapter');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

const PostgresRelationDoesNotExistError = '42P01';
const PostgresDuplicateRelationError = '42P07';
const PostgresDuplicateColumnError = '42701';
const PostgresMissingColumnError = '42703';
const PostgresDuplicateObjectError = '42710';
const PostgresUniqueIndexViolationError = '23505';
const PostgresTransactionAbortedError = '25P02';
const logger = require('../../../logger');

const debug = function (...args) {
  args = ['PG: ' + arguments[0]].concat(args.slice(1, args.length));
  const log = logger.getLogger();
  log.debug.apply(log, args);
};

const parseTypeToPostgresType = type => {
  switch (type.type) {
    case 'String':
      return 'text';
    case 'Date':
      return 'timestamp with time zone';
    case 'Object':
      return 'jsonb';
    case 'File':
      return 'text';
    case 'Boolean':
      return 'boolean';
    case 'Pointer':
      return 'char(10)';
    case 'Number':
      return 'double precision';
    case 'GeoPoint':
      return 'point';
    case 'Bytes':
      return 'jsonb';
    case 'Polygon':
      return 'polygon';
    case 'Array':
      if (type.contents && type.contents.type === 'String') {
        return 'text[]';
      } else {
        return 'jsonb';
      }
    default:
      throw `no type for ${JSON.stringify(type)} yet`;
  }
};

const ParseToPosgresComparator = {
  '$gt': '>',
  '$lt': '<',
  '$gte': '>=',
  '$lte': '<='
};

const mongoAggregateToPostgres = {
  $dayOfMonth: 'DAY',
  $dayOfWeek: 'DOW',
  $dayOfYear: 'DOY',
  $isoDayOfWeek: 'ISODOW',
  $isoWeekYear: 'ISOYEAR',
  $hour: 'HOUR',
  $minute: 'MINUTE',
  $second: 'SECOND',
  $millisecond: 'MILLISECONDS',
  $month: 'MONTH',
  $week: 'WEEK',
  $year: 'YEAR'
};

const toPostgresValue = value => {
  if (typeof value === 'object') {
    if (value.__type === 'Date') {
      return value.iso;
    }
    if (value.__type === 'File') {
      return value.name;
    }
  }
  return value;
};

const transformValue = value => {
  if (typeof value === 'object' && value.__type === 'Pointer') {
    return value.objectId;
  }
  return value;
};

// Duplicate from then mongo adapter...
const emptyCLPS = Object.freeze({
  find: {},
  get: {},
  create: {},
  update: {},
  delete: {},
  addField: {}
});

const defaultCLPS = Object.freeze({
  find: { '*': true },
  get: { '*': true },
  create: { '*': true },
  update: { '*': true },
  delete: { '*': true },
  addField: { '*': true }
});

const toParseSchema = schema => {
  if (schema.className === '_User') {
    delete schema.fields._hashed_password;
  }
  if (schema.fields) {
    delete schema.fields._wperm;
    delete schema.fields._rperm;
  }
  let clps = defaultCLPS;
  if (schema.classLevelPermissions) {
    clps = _extends({}, emptyCLPS, schema.classLevelPermissions);
  }
  let indexes = {};
  if (schema.indexes) {
    indexes = _extends({}, schema.indexes);
  }
  return {
    className: schema.className,
    fields: schema.fields,
    classLevelPermissions: clps,
    indexes
  };
};

const toPostgresSchema = schema => {
  if (!schema) {
    return schema;
  }
  schema.fields = schema.fields || {};
  schema.fields._wperm = { type: 'Array', contents: { type: 'String' } };
  schema.fields._rperm = { type: 'Array', contents: { type: 'String' } };
  if (schema.className === '_User') {
    schema.fields._hashed_password = { type: 'String' };
    schema.fields._password_history = { type: 'Array' };
  }
  return schema;
};

const handleDotFields = object => {
  Object.keys(object).forEach(fieldName => {
    if (fieldName.indexOf('.') > -1) {
      const components = fieldName.split('.');
      const first = components.shift();
      object[first] = object[first] || {};
      let currentObj = object[first];
      let next;
      let value = object[fieldName];
      if (value && value.__op === 'Delete') {
        value = undefined;
      }
      /* eslint-disable no-cond-assign */
      while (next = components.shift()) {
        /* eslint-enable no-cond-assign */
        currentObj[next] = currentObj[next] || {};
        if (components.length === 0) {
          currentObj[next] = value;
        }
        currentObj = currentObj[next];
      }
      delete object[fieldName];
    }
  });
  return object;
};

const transformDotFieldToComponents = fieldName => {
  return fieldName.split('.').map((cmpt, index) => {
    if (index === 0) {
      return `"${cmpt}"`;
    }
    return `'${cmpt}'`;
  });
};

const transformDotField = fieldName => {
  if (fieldName.indexOf('.') === -1) {
    return `"${fieldName}"`;
  }
  const components = transformDotFieldToComponents(fieldName);
  let name = components.slice(0, components.length - 1).join('->');
  name += '->>' + components[components.length - 1];
  return name;
};

const transformAggregateField = fieldName => {
  if (typeof fieldName !== 'string') {
    return fieldName;
  }
  if (fieldName === '$_created_at') {
    return 'createdAt';
  }
  if (fieldName === '$_updated_at') {
    return 'updatedAt';
  }
  return fieldName.substr(1);
};

const validateKeys = object => {
  if (typeof object == 'object') {
    for (const key in object) {
      if (typeof object[key] == 'object') {
        validateKeys(object[key]);
      }

      if (key.includes('$') || key.includes('.')) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
      }
    }
  }
};

// Returns the list of join tables on a schema
const joinTablesForSchema = schema => {
  const list = [];
  if (schema) {
    Object.keys(schema.fields).forEach(field => {
      if (schema.fields[field].type === 'Relation') {
        list.push(`_Join:${field}:${schema.className}`);
      }
    });
  }
  return list;
};

const buildWhereClause = ({ schema, query, index }) => {
  const patterns = [];
  let values = [];
  const sorts = [];

  schema = toPostgresSchema(schema);
  for (const fieldName in query) {
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const initialPatternsLength = patterns.length;
    const fieldValue = query[fieldName];

    // nothingin the schema, it's gonna blow up
    if (!schema.fields[fieldName]) {
      // as it won't exist
      if (fieldValue && fieldValue.$exists === false) {
        continue;
      }
    }

    if (fieldName.indexOf('.') >= 0) {
      let name = transformDotField(fieldName);
      if (fieldValue === null) {
        patterns.push(`${name} IS NULL`);
      } else {
        if (fieldValue.$in) {
          const inPatterns = [];
          name = transformDotFieldToComponents(fieldName).join('->');
          fieldValue.$in.forEach(listElem => {
            if (typeof listElem === 'string') {
              inPatterns.push(`"${listElem}"`);
            } else {
              inPatterns.push(`${listElem}`);
            }
          });
          patterns.push(`(${name})::jsonb @> '[${inPatterns.join()}]'::jsonb`);
        } else if (fieldValue.$regex) {
          // Handle later
        } else {
          patterns.push(`${name} = '${fieldValue}'`);
        }
      }
    } else if (fieldValue === null || fieldValue === undefined) {
      patterns.push(`$${index}:name IS NULL`);
      values.push(fieldName);
      index += 1;
      continue;
    } else if (typeof fieldValue === 'string') {
      if (isArrayField) {
        patterns.push('$' + index + ':name ? $' + (index + 1));
      } else {
        patterns.push('$' + index + ':name = $' + (index + 1));
      }
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (typeof fieldValue === 'boolean') {
      patterns.push(`$${index}:name = $${index + 1}`);
      // Can't cast boolean to double precision
      if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Number') {
        // Should always return zero results
        const MAX_INT_PLUS_ONE = 9223372036854775808;
        values.push(fieldName, MAX_INT_PLUS_ONE);
      } else {
        values.push(fieldName, fieldValue);
      }
      index += 2;
    } else if (typeof fieldValue === 'number') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue);
      index += 2;
    } else if (['$or', '$nor', '$and'].includes(fieldName)) {
      const clauses = [];
      const clauseValues = [];
      fieldValue.forEach(subQuery => {
        const clause = buildWhereClause({ schema, query: subQuery, index });
        if (clause.pattern.length > 0) {
          clauses.push(clause.pattern);
          clauseValues.push(...clause.values);
          index += clause.values.length;
        }
      });

      const orOrAnd = fieldName === '$and' ? ' AND ' : ' OR ';
      const not = fieldName === '$nor' ? ' NOT ' : '';

      patterns.push(`${not}(${clauses.join(orOrAnd)})`);
      values.push(...clauseValues);
    }

    if (fieldValue.$ne !== undefined) {
      if (isArrayField) {
        fieldValue.$ne = JSON.stringify([fieldValue.$ne]);
        patterns.push(`NOT array_contains($${index}:name, $${index + 1})`);
      } else {
        if (fieldValue.$ne === null) {
          patterns.push(`$${index}:name IS NOT NULL`);
          values.push(fieldName);
          index += 1;
          continue;
        } else {
          // if not null, we need to manually exclude null
          patterns.push(`($${index}:name <> $${index + 1} OR $${index}:name IS NULL)`);
        }
      }

      // TODO: support arrays
      values.push(fieldName, fieldValue.$ne);
      index += 2;
    }
    if (fieldValue.$eq !== undefined) {
      if (fieldValue.$eq === null) {
        patterns.push(`$${index}:name IS NULL`);
        values.push(fieldName);
        index += 1;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.$eq);
        index += 2;
      }
    }
    const isInOrNin = Array.isArray(fieldValue.$in) || Array.isArray(fieldValue.$nin);
    if (Array.isArray(fieldValue.$in) && isArrayField && schema.fields[fieldName].contents && schema.fields[fieldName].contents.type === 'String') {
      const inPatterns = [];
      let allowNull = false;
      values.push(fieldName);
      fieldValue.$in.forEach((listElem, listIndex) => {
        if (listElem === null) {
          allowNull = true;
        } else {
          values.push(listElem);
          inPatterns.push(`$${index + 1 + listIndex - (allowNull ? 1 : 0)}`);
        }
      });
      if (allowNull) {
        patterns.push(`($${index}:name IS NULL OR $${index}:name && ARRAY[${inPatterns.join()}])`);
      } else {
        patterns.push(`$${index}:name && ARRAY[${inPatterns.join()}]`);
      }
      index = index + 1 + inPatterns.length;
    } else if (isInOrNin) {
      var createConstraint = (baseArray, notIn) => {
        if (baseArray.length > 0) {
          const not = notIn ? ' NOT ' : '';
          if (isArrayField) {
            patterns.push(`${not} array_contains($${index}:name, $${index + 1})`);
            values.push(fieldName, JSON.stringify(baseArray));
            index += 2;
          } else {
            // Handle Nested Dot Notation Above
            if (fieldName.indexOf('.') >= 0) {
              return;
            }
            const inPatterns = [];
            values.push(fieldName);
            baseArray.forEach((listElem, listIndex) => {
              if (listElem !== null) {
                values.push(listElem);
                inPatterns.push(`$${index + 1 + listIndex}`);
              }
            });
            patterns.push(`$${index}:name ${not} IN (${inPatterns.join()})`);
            index = index + 1 + inPatterns.length;
          }
        } else if (!notIn) {
          values.push(fieldName);
          patterns.push(`$${index}:name IS NULL`);
          index = index + 1;
        }
      };
      if (fieldValue.$in) {
        createConstraint(_lodash2.default.flatMap(fieldValue.$in, elt => elt), false);
      }
      if (fieldValue.$nin) {
        createConstraint(_lodash2.default.flatMap(fieldValue.$nin, elt => elt), true);
      }
    } else if (typeof fieldValue.$in !== 'undefined') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $in value');
    } else if (typeof fieldValue.$nin !== 'undefined') {
      throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $nin value');
    }

    if (Array.isArray(fieldValue.$all) && isArrayField) {
      if (isAnyValueRegexStartsWith(fieldValue.$all)) {
        if (!isAllValuesRegexOrNone(fieldValue.$all)) {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + fieldValue.$all);
        }

        for (let i = 0; i < fieldValue.$all.length; i += 1) {
          const value = processRegexPattern(fieldValue.$all[i].$regex);
          fieldValue.$all[i] = value.substring(1) + '%';
        }
        patterns.push(`array_contains_all_regex($${index}:name, $${index + 1}::jsonb)`);
      } else {
        patterns.push(`array_contains_all($${index}:name, $${index + 1}::jsonb)`);
      }
      values.push(fieldName, JSON.stringify(fieldValue.$all));
      index += 2;
    }

    if (typeof fieldValue.$exists !== 'undefined') {
      if (fieldValue.$exists) {
        patterns.push(`$${index}:name IS NOT NULL`);
      } else {
        patterns.push(`$${index}:name IS NULL`);
      }
      values.push(fieldName);
      index += 1;
    }

    if (fieldValue.$containedBy) {
      const arr = fieldValue.$containedBy;
      if (!(arr instanceof Array)) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $containedBy: should be an array`);
      }

      patterns.push(`$${index}:name <@ $${index + 1}::jsonb`);
      values.push(fieldName, JSON.stringify(arr));
      index += 2;
    }

    if (fieldValue.$text) {
      const search = fieldValue.$text.$search;
      let language = 'english';
      if (typeof search !== 'object') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $search, should be object`);
      }
      if (!search.$term || typeof search.$term !== 'string') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $term, should be string`);
      }
      if (search.$language && typeof search.$language !== 'string') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $language, should be string`);
      } else if (search.$language) {
        language = search.$language;
      }
      if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
      } else if (search.$caseSensitive) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $caseSensitive not supported, please use $regex or create a separate lower case column.`);
      }
      if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
      } else if (search.$diacriticSensitive === false) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `bad $text: $diacriticSensitive - false not supported, install Postgres Unaccent Extension`);
      }
      patterns.push(`to_tsvector($${index}, $${index + 1}:name) @@ to_tsquery($${index + 2}, $${index + 3})`);
      values.push(language, fieldName, language, search.$term);
      index += 4;
    }

    if (fieldValue.$nearSphere) {
      const point = fieldValue.$nearSphere;
      const distance = fieldValue.$maxDistance;
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_DistanceSphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$within && fieldValue.$within.$box) {
      const box = fieldValue.$within.$box;
      const left = box[0].longitude;
      const bottom = box[0].latitude;
      const right = box[1].longitude;
      const top = box[1].latitude;

      patterns.push(`$${index}:name::point <@ $${index + 1}::box`);
      values.push(fieldName, `((${left}, ${bottom}), (${right}, ${top}))`);
      index += 2;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$centerSphere) {
      const centerSphere = fieldValue.$geoWithin.$centerSphere;
      if (!(centerSphere instanceof Array) || centerSphere.length < 2) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
      }
      // Get point, convert to geo point if necessary and validate
      let point = centerSphere[0];
      if (point instanceof Array && point.length === 2) {
        point = new _node2.default.GeoPoint(point[1], point[0]);
      } else if (!GeoPointCoder.isValidJSON(point)) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
      }
      _node2.default.GeoPoint._validate(point.latitude, point.longitude);
      // Get distance and validate
      const distance = centerSphere[1];
      if (isNaN(distance) || distance < 0) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
      }
      const distanceInKM = distance * 6371 * 1000;
      patterns.push(`ST_distance_sphere($${index}:name::geometry, POINT($${index + 1}, $${index + 2})::geometry) <= $${index + 3}`);
      values.push(fieldName, point.longitude, point.latitude, distanceInKM);
      index += 4;
    }

    if (fieldValue.$geoWithin && fieldValue.$geoWithin.$polygon) {
      const polygon = fieldValue.$geoWithin.$polygon;
      let points;
      if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
        if (!polygon.coordinates || polygon.coordinates.length < 3) {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
        }
        points = polygon.coordinates;
      } else if (polygon instanceof Array) {
        if (polygon.length < 3) {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
        }
        points = polygon;
      } else {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint\'s');
      }
      points = points.map(point => {
        if (point instanceof Array && point.length === 2) {
          _node2.default.GeoPoint._validate(point[1], point[0]);
          return `(${point[0]}, ${point[1]})`;
        }
        if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
          throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoWithin value');
        } else {
          _node2.default.GeoPoint._validate(point.latitude, point.longitude);
        }
        return `(${point.longitude}, ${point.latitude})`;
      }).join(', ');

      patterns.push(`$${index}:name::point <@ $${index + 1}::polygon`);
      values.push(fieldName, `(${points})`);
      index += 2;
    }
    if (fieldValue.$geoIntersects && fieldValue.$geoIntersects.$point) {
      const point = fieldValue.$geoIntersects.$point;
      if (typeof point !== 'object' || point.__type !== 'GeoPoint') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
      } else {
        _node2.default.GeoPoint._validate(point.latitude, point.longitude);
      }
      patterns.push(`$${index}:name::polygon @> $${index + 1}::point`);
      values.push(fieldName, `(${point.longitude}, ${point.latitude})`);
      index += 2;
    }

    if (fieldValue.$regex) {
      let regex = fieldValue.$regex;
      let operator = '~';
      const opts = fieldValue.$options;
      if (opts) {
        if (opts.indexOf('i') >= 0) {
          operator = '~*';
        }
        if (opts.indexOf('x') >= 0) {
          regex = removeWhiteSpace(regex);
        }
      }

      const name = transformDotField(fieldName);
      regex = processRegexPattern(regex);

      patterns.push(`$${index}:raw ${operator} '$${index + 1}:raw'`);
      values.push(name, regex);
      index += 2;
    }

    if (fieldValue.__type === 'Pointer') {
      if (isArrayField) {
        patterns.push(`array_contains($${index}:name, $${index + 1})`);
        values.push(fieldName, JSON.stringify([fieldValue]));
        index += 2;
      } else {
        patterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      }
    }

    if (fieldValue.__type === 'Date') {
      patterns.push(`$${index}:name = $${index + 1}`);
      values.push(fieldName, fieldValue.iso);
      index += 2;
    }

    if (fieldValue.__type === 'GeoPoint') {
      patterns.push('$' + index + ':name ~= POINT($' + (index + 1) + ', $' + (index + 2) + ')');
      values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
      index += 3;
    }

    if (fieldValue.__type === 'Polygon') {
      const value = convertPolygonToSQL(fieldValue.coordinates);
      patterns.push(`$${index}:name ~= $${index + 1}::polygon`);
      values.push(fieldName, value);
      index += 2;
    }

    Object.keys(ParseToPosgresComparator).forEach(cmp => {
      if (fieldValue[cmp] || fieldValue[cmp] === 0) {
        const pgComparator = ParseToPosgresComparator[cmp];
        patterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue[cmp]));
        index += 2;
      }
    });

    if (initialPatternsLength === patterns.length) {
      throw new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support this query type yet ${JSON.stringify(fieldValue)}`);
    }
  }
  values = values.map(transformValue);
  return { pattern: patterns.join(' AND '), values, sorts };
};

class PostgresStorageAdapter {

  constructor({
    uri,
    collectionPrefix = '',
    databaseOptions
  }) {
    this._collectionPrefix = collectionPrefix;
    const { client, pgp } = (0, _PostgresClient.createClient)(uri, databaseOptions);
    this._client = client;
    this._pgp = pgp;
    this.canSortOnJoinTables = false;
  }

  // Private


  handleShutdown() {
    if (!this._client) {
      return;
    }
    this._client.$pool.end();
  }

  _ensureSchemaCollectionExists(conn) {
    conn = conn || this._client;
    return conn.none('CREATE TABLE IF NOT EXISTS "_SCHEMA" ( "className" varChar(120), "schema" jsonb, "isParseClass" bool, PRIMARY KEY ("className") )').catch(error => {
      if (error.code === PostgresDuplicateRelationError || error.code === PostgresUniqueIndexViolationError || error.code === PostgresDuplicateObjectError) {
        // Table already exists, must have been created by a different request. Ignore error.
      } else {
        throw error;
      }
    });
  }

  classExists(name) {
    return this._client.one('SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)', [name], a => a.exists);
  }

  setClassLevelPermissions(className, CLPs) {
    const self = this;
    return this._client.task('set-class-level-permissions', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      const values = [className, 'schema', 'classLevelPermissions', JSON.stringify(CLPs)];
      yield t.none(`UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1`, values);
    });
  }

  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields, conn) {
    conn = conn || this._client;
    const self = this;
    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }
    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = { _id_: { _id: 1 } };
    }
    const deletedIndexes = [];
    const insertedIndexes = [];
    Object.keys(submittedIndexes).forEach(name => {
      const field = submittedIndexes[name];
      if (existingIndexes[name] && field.__op !== 'Delete') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Index ${name} exists, cannot update.`);
      }
      if (!existingIndexes[name] && field.__op === 'Delete') {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Index ${name} does not exist, cannot delete.`);
      }
      if (field.__op === 'Delete') {
        deletedIndexes.push(name);
        delete existingIndexes[name];
      } else {
        Object.keys(field).forEach(key => {
          if (!fields.hasOwnProperty(key)) {
            throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, `Field ${key} does not exist, cannot add index.`);
          }
        });
        existingIndexes[name] = field;
        insertedIndexes.push({
          key: field,
          name
        });
      }
    });
    return conn.tx('set-indexes-with-schema-format', function* (t) {
      if (insertedIndexes.length > 0) {
        yield self.createIndexes(className, insertedIndexes, t);
      }
      if (deletedIndexes.length > 0) {
        yield self.dropIndexes(className, deletedIndexes, t);
      }
      yield self._ensureSchemaCollectionExists(t);
      yield t.none('UPDATE "_SCHEMA" SET $2:name = json_object_set_key($2:name, $3::text, $4::jsonb) WHERE "className"=$1', [className, 'schema', 'indexes', JSON.stringify(existingIndexes)]);
    });
  }

  createClass(className, schema, conn) {
    conn = conn || this._client;
    return conn.tx('create-class', t => {
      const q1 = this.createTable(className, schema, t);
      const q2 = t.none('INSERT INTO "_SCHEMA" ("className", "schema", "isParseClass") VALUES ($<className>, $<schema>, true)', { className, schema });
      const q3 = this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields, t);
      return t.batch([q1, q2, q3]);
    }).then(() => {
      return toParseSchema(schema);
    }).catch(err => {
      if (err.data[0].result.code === PostgresTransactionAbortedError) {
        err = err.data[1].result;
      }
      if (err.code === PostgresUniqueIndexViolationError && err.detail.includes(className)) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, `Class ${className} already exists.`);
      }
      throw err;
    });
  }

  // Just create a table, do not insert in schema
  createTable(className, schema, conn) {
    conn = conn || this._client;
    const self = this;
    debug('createTable', className, schema);
    const valuesArray = [];
    const patternsArray = [];
    const fields = Object.assign({}, schema.fields);
    if (className === '_User') {
      fields._email_verify_token_expires_at = { type: 'Date' };
      fields._email_verify_token = { type: 'String' };
      fields._account_lockout_expires_at = { type: 'Date' };
      fields._failed_login_count = { type: 'Number' };
      fields._perishable_token = { type: 'String' };
      fields._perishable_token_expires_at = { type: 'Date' };
      fields._password_changed_at = { type: 'Date' };
      fields._password_history = { type: 'Array' };
    }
    let index = 2;
    const relations = [];
    Object.keys(fields).forEach(fieldName => {
      const parseType = fields[fieldName];
      // Skip when it's a relation
      // We'll create the tables later
      if (parseType.type === 'Relation') {
        relations.push(fieldName);
        return;
      }
      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        parseType.contents = { type: 'String' };
      }
      valuesArray.push(fieldName);
      valuesArray.push(parseTypeToPostgresType(parseType));
      patternsArray.push(`$${index}:name $${index + 1}:raw`);
      if (fieldName === 'objectId') {
        patternsArray.push(`PRIMARY KEY ($${index}:name)`);
      }
      index = index + 2;
    });
    const qs = `CREATE TABLE IF NOT EXISTS $1:name (${patternsArray.join()})`;
    const values = [className, ...valuesArray];

    return conn.task('create-table', function* (t) {
      try {
        yield self._ensureSchemaCollectionExists(t);
        yield t.none(qs, values);
      } catch (error) {
        if (error.code !== PostgresDuplicateRelationError) {
          throw error;
        }
        // ELSE: Table already exists, must have been created by a different request. Ignore the error.
      }
      yield t.tx('create-table-tx', tx => {
        return tx.batch(relations.map(fieldName => {
          return tx.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', { joinTable: `_Join:${fieldName}:${className}` });
        }));
      });
    });
  }

  schemaUpgrade(className, schema, conn) {
    debug('schemaUpgrade', { className, schema });
    conn = conn || this._client;
    const self = this;

    return conn.tx('schema-upgrade', function* (t) {
      const columns = yield t.map('SELECT column_name FROM information_schema.columns WHERE table_name = $<className>', { className }, a => a.column_name);
      const newColumns = Object.keys(schema.fields).filter(item => columns.indexOf(item) === -1).map(fieldName => self.addFieldIfNotExists(className, fieldName, schema.fields[fieldName], t));

      yield t.batch(newColumns);
    });
  }

  addFieldIfNotExists(className, fieldName, type, conn) {
    // TODO: Must be revised for invalid logic...
    debug('addFieldIfNotExists', { className, fieldName, type });
    conn = conn || this._client;
    const self = this;
    return conn.tx('add-field-if-not-exists', function* (t) {
      if (type.type !== 'Relation') {
        try {
          yield t.none('ALTER TABLE $<className:name> ADD COLUMN $<fieldName:name> $<postgresType:raw>', {
            className,
            fieldName,
            postgresType: parseTypeToPostgresType(type)
          });
        } catch (error) {
          if (error.code === PostgresRelationDoesNotExistError) {
            return yield self.createClass(className, { fields: { [fieldName]: type } }, t);
          }
          if (error.code !== PostgresDuplicateColumnError) {
            throw error;
          }
          // Column already exists, created by other request. Carry on to see if it's the right type.
        }
      } else {
        yield t.none('CREATE TABLE IF NOT EXISTS $<joinTable:name> ("relatedId" varChar(120), "owningId" varChar(120), PRIMARY KEY("relatedId", "owningId") )', { joinTable: `_Join:${fieldName}:${className}` });
      }

      const result = yield t.any('SELECT "schema" FROM "_SCHEMA" WHERE "className" = $<className> and ("schema"::json->\'fields\'->$<fieldName>) is not null', { className, fieldName });

      if (result[0]) {
        throw 'Attempted to add a field that already exists';
      } else {
        const path = `{fields,${fieldName}}`;
        yield t.none('UPDATE "_SCHEMA" SET "schema"=jsonb_set("schema", $<path>, $<type>)  WHERE "className"=$<className>', { path, type, className });
      }
    });
  }

  // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.
  deleteClass(className) {
    const operations = [{ query: `DROP TABLE IF EXISTS $1:name`, values: [className] }, { query: `DELETE FROM "_SCHEMA" WHERE "className" = $1`, values: [className] }];
    return this._client.tx(t => t.none(this._pgp.helpers.concat(operations))).then(() => className.indexOf('_Join:') != 0); // resolves with false when _Join table
  }

  // Delete all data known to this adapter. Used for testing.
  deleteAllClasses() {
    const now = new Date().getTime();
    const helpers = this._pgp.helpers;
    debug('deleteAllClasses');

    return this._client.task('delete-all-classes', function* (t) {
      try {
        const results = yield t.any('SELECT * FROM "_SCHEMA"');
        const joins = results.reduce((list, schema) => {
          return list.concat(joinTablesForSchema(schema.schema));
        }, []);
        const classes = ['_SCHEMA', '_PushStatus', '_JobStatus', '_JobSchedule', '_Hooks', '_GlobalConfig', '_Audience', ...results.map(result => result.className), ...joins];
        const queries = classes.map(className => ({ query: 'DROP TABLE IF EXISTS $<className:name>', values: { className } }));
        yield t.tx(tx => tx.none(helpers.concat(queries)));
      } catch (error) {
        if (error.code !== PostgresRelationDoesNotExistError) {
          throw error;
        }
        // No _SCHEMA collection. Don't delete anything.
      }
    }).then(() => {
      debug(`deleteAllClasses done in ${new Date().getTime() - now}`);
    });
  }

  // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.

  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.

  // Returns a Promise.
  deleteFields(className, schema, fieldNames) {
    debug('deleteFields', className, fieldNames);
    fieldNames = fieldNames.reduce((list, fieldName) => {
      const field = schema.fields[fieldName];
      if (field.type !== 'Relation') {
        list.push(fieldName);
      }
      delete schema.fields[fieldName];
      return list;
    }, []);

    const values = [className, ...fieldNames];
    const columns = fieldNames.map((name, idx) => {
      return `$${idx + 2}:name`;
    }).join(', DROP COLUMN');

    return this._client.tx('delete-fields', function* (t) {
      yield t.none('UPDATE "_SCHEMA" SET "schema"=$<schema> WHERE "className"=$<className>', { schema, className });
      if (values.length > 1) {
        yield t.none(`ALTER TABLE $1:name DROP COLUMN ${columns}`, values);
      }
    });
  }

  // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.
  getAllClasses() {
    const self = this;
    return this._client.task('get-all-classes', function* (t) {
      yield self._ensureSchemaCollectionExists(t);
      return yield t.map('SELECT * FROM "_SCHEMA"', null, row => toParseSchema(_extends({ className: row.className }, row.schema)));
    });
  }

  // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.
  getClass(className) {
    debug('getClass', className);
    return this._client.any('SELECT * FROM "_SCHEMA" WHERE "className"=$<className>', { className }).then(result => {
      if (result.length !== 1) {
        throw undefined;
      }
      return result[0].schema;
    }).then(toParseSchema);
  }

  // TODO: remove the mongo format dependency in the return value
  createObject(className, schema, object) {
    debug('createObject', className, object);
    let columnsArray = [];
    const valuesArray = [];
    schema = toPostgresSchema(schema);
    const geoPoints = {};

    object = handleDotFields(object);

    validateKeys(object);

    Object.keys(object).forEach(fieldName => {
      if (object[fieldName] === null) {
        return;
      }
      var authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
      if (authDataMatch) {
        var provider = authDataMatch[1];
        object['authData'] = object['authData'] || {};
        object['authData'][provider] = object[fieldName];
        delete object[fieldName];
        fieldName = 'authData';
      }

      columnsArray.push(fieldName);
      if (!schema.fields[fieldName] && className === '_User') {
        if (fieldName === '_email_verify_token' || fieldName === '_failed_login_count' || fieldName === '_perishable_token' || fieldName === '_password_history') {
          valuesArray.push(object[fieldName]);
        }

        if (fieldName === '_email_verify_token_expires_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }

        if (fieldName === '_account_lockout_expires_at' || fieldName === '_perishable_token_expires_at' || fieldName === '_password_changed_at') {
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
        }
        return;
      }
      switch (schema.fields[fieldName].type) {
        case 'Date':
          if (object[fieldName]) {
            valuesArray.push(object[fieldName].iso);
          } else {
            valuesArray.push(null);
          }
          break;
        case 'Pointer':
          valuesArray.push(object[fieldName].objectId);
          break;
        case 'Array':
          if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
            valuesArray.push(object[fieldName]);
          } else {
            valuesArray.push(JSON.stringify(object[fieldName]));
          }
          break;
        case 'Object':
        case 'Bytes':
        case 'String':
        case 'Number':
        case 'Boolean':
          valuesArray.push(object[fieldName]);
          break;
        case 'File':
          valuesArray.push(object[fieldName].name);
          break;
        case 'Polygon':
          {
            const value = convertPolygonToSQL(object[fieldName].coordinates);
            valuesArray.push(value);
            break;
          }
        case 'GeoPoint':
          // pop the point and process later
          geoPoints[fieldName] = object[fieldName];
          columnsArray.pop();
          break;
        default:
          throw `Type ${schema.fields[fieldName].type} not supported yet`;
      }
    });

    columnsArray = columnsArray.concat(Object.keys(geoPoints));
    const initialValues = valuesArray.map((val, index) => {
      let termination = '';
      const fieldName = columnsArray[index];
      if (['_rperm', '_wperm'].indexOf(fieldName) >= 0) {
        termination = '::text[]';
      } else if (schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        termination = '::jsonb';
      }
      return `$${index + 2 + columnsArray.length}${termination}`;
    });
    const geoPointsInjects = Object.keys(geoPoints).map(key => {
      const value = geoPoints[key];
      valuesArray.push(value.longitude, value.latitude);
      const l = valuesArray.length + columnsArray.length;
      return `POINT($${l}, $${l + 1})`;
    });

    const columnsPattern = columnsArray.map((col, index) => `$${index + 2}:name`).join();
    const valuesPattern = initialValues.concat(geoPointsInjects).join();

    const qs = `INSERT INTO $1:name (${columnsPattern}) VALUES (${valuesPattern})`;
    const values = [className, ...columnsArray, ...valuesArray];
    debug(qs, values);
    return this._client.none(qs, values).then(() => ({ ops: [object] })).catch(error => {
      if (error.code === PostgresUniqueIndexViolationError) {
        const err = new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.constraint) {
          const matches = error.constraint.match(/unique_([a-zA-Z]+)/);
          if (matches && Array.isArray(matches)) {
            err.userInfo = { duplicated_field: matches[1] };
          }
        }
        error = err;
      }
      throw error;
    });
  }

  // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.
  deleteObjectsByQuery(className, schema, query) {
    debug('deleteObjectsByQuery', className, query);
    const values = [className];
    const index = 2;
    const where = buildWhereClause({ schema, index, query });
    values.push(...where.values);
    if (Object.keys(query).length === 0) {
      where.pattern = 'TRUE';
    }
    const qs = `WITH deleted AS (DELETE FROM $1:name WHERE ${where.pattern} RETURNING *) SELECT count(*) FROM deleted`;
    debug(qs, values);
    return this._client.one(qs, values, a => +a.count).then(count => {
      if (count === 0) {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      } else {
        return count;
      }
    }).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }
      // ELSE: Don't delete anything if doesn't exist
    });
  }
  // Return value not currently well specified.
  findOneAndUpdate(className, schema, query, update) {
    debug('findOneAndUpdate', className, query, update);
    return this.updateObjectsByQuery(className, schema, query, update).then(val => val[0]);
  }

  // Apply the update to all objects that match the given Parse Query.
  updateObjectsByQuery(className, schema, query, update) {
    debug('updateObjectsByQuery', className, query, update);
    const updatePatterns = [];
    const values = [className];
    let index = 2;
    schema = toPostgresSchema(schema);

    const originalUpdate = _extends({}, update);
    update = handleDotFields(update);
    // Resolve authData first,
    // So we don't end up with multiple key updates
    for (const fieldName in update) {
      const authDataMatch = fieldName.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
      if (authDataMatch) {
        var provider = authDataMatch[1];
        const value = update[fieldName];
        delete update[fieldName];
        update['authData'] = update['authData'] || {};
        update['authData'][provider] = value;
      }
    }

    for (const fieldName in update) {
      const fieldValue = update[fieldName];
      if (fieldValue === null) {
        updatePatterns.push(`$${index}:name = NULL`);
        values.push(fieldName);
        index += 1;
      } else if (fieldName == 'authData') {
        // This recursively sets the json_object
        // Only 1 level deep
        const generate = (jsonb, key, value) => {
          return `json_object_set_key(COALESCE(${jsonb}, '{}'::jsonb), ${key}, ${value})::jsonb`;
        };
        const lastKey = `$${index}:name`;
        const fieldNameIndex = index;
        index += 1;
        values.push(fieldName);
        const update = Object.keys(fieldValue).reduce((lastKey, key) => {
          const str = generate(lastKey, `$${index}::text`, `$${index + 1}::jsonb`);
          index += 2;
          let value = fieldValue[key];
          if (value) {
            if (value.__op === 'Delete') {
              value = null;
            } else {
              value = JSON.stringify(value);
            }
          }
          values.push(key, value);
          return str;
        }, lastKey);
        updatePatterns.push(`$${fieldNameIndex}:name = ${update}`);
      } else if (fieldValue.__op === 'Increment') {
        updatePatterns.push(`$${index}:name = COALESCE($${index}:name, 0) + $${index + 1}`);
        values.push(fieldName, fieldValue.amount);
        index += 2;
      } else if (fieldValue.__op === 'Add') {
        updatePatterns.push(`$${index}:name = array_add(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'Delete') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, null);
        index += 2;
      } else if (fieldValue.__op === 'Remove') {
        updatePatterns.push(`$${index}:name = array_remove(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldValue.__op === 'AddUnique') {
        updatePatterns.push(`$${index}:name = array_add_unique(COALESCE($${index}:name, '[]'::jsonb), $${index + 1}::jsonb)`);
        values.push(fieldName, JSON.stringify(fieldValue.objects));
        index += 2;
      } else if (fieldName === 'updatedAt') {
        //TODO: stop special casing this. It should check for __type === 'Date' and use .iso
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'string') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'boolean') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'Pointer') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue.objectId);
        index += 2;
      } else if (fieldValue.__type === 'Date') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue instanceof Date) {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (fieldValue.__type === 'File') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, toPostgresValue(fieldValue));
        index += 2;
      } else if (fieldValue.__type === 'GeoPoint') {
        updatePatterns.push(`$${index}:name = POINT($${index + 1}, $${index + 2})`);
        values.push(fieldName, fieldValue.longitude, fieldValue.latitude);
        index += 3;
      } else if (fieldValue.__type === 'Polygon') {
        const value = convertPolygonToSQL(fieldValue.coordinates);
        updatePatterns.push(`$${index}:name = $${index + 1}::polygon`);
        values.push(fieldName, value);
        index += 2;
      } else if (fieldValue.__type === 'Relation') {
        // noop
      } else if (typeof fieldValue === 'number') {
        updatePatterns.push(`$${index}:name = $${index + 1}`);
        values.push(fieldName, fieldValue);
        index += 2;
      } else if (typeof fieldValue === 'object' && schema.fields[fieldName] && schema.fields[fieldName].type === 'Object') {
        // Gather keys to increment
        const keysToIncrement = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set
          // Note that Object.keys is iterating over the **original** update object
          // and that some of the keys of the original update could be null or undefined:
          // (See the above check `if (fieldValue === null || typeof fieldValue == "undefined")`)
          const value = originalUpdate[k];
          return value && value.__op === 'Increment' && k.split('.').length === 2 && k.split(".")[0] === fieldName;
        }).map(k => k.split('.')[1]);

        let incrementPatterns = '';
        if (keysToIncrement.length > 0) {
          incrementPatterns = ' || ' + keysToIncrement.map(c => {
            const amount = fieldValue[c].amount;
            return `CONCAT('{"${c}":', COALESCE($${index}:name->>'${c}','0')::int + ${amount}, '}')::jsonb`;
          }).join(' || ');
          // Strip the keys
          keysToIncrement.forEach(key => {
            delete fieldValue[key];
          });
        }

        const keysToDelete = Object.keys(originalUpdate).filter(k => {
          // choose top level fields that have a delete operation set.
          const value = originalUpdate[k];
          return value && value.__op === 'Delete' && k.split('.').length === 2 && k.split(".")[0] === fieldName;
        }).map(k => k.split('.')[1]);

        const deletePatterns = keysToDelete.reduce((p, c, i) => {
          return p + ` - '$${index + 1 + i}:value'`;
        }, '');

        updatePatterns.push(`$${index}:name = ('{}'::jsonb ${deletePatterns} ${incrementPatterns} || $${index + 1 + keysToDelete.length}::jsonb )`);

        values.push(fieldName, ...keysToDelete, JSON.stringify(fieldValue));
        index += 2 + keysToDelete.length;
      } else if (Array.isArray(fieldValue) && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array') {
        const expectedType = parseTypeToPostgresType(schema.fields[fieldName]);
        if (expectedType === 'text[]') {
          updatePatterns.push(`$${index}:name = $${index + 1}::text[]`);
        } else {
          let type = 'text';
          for (const elt of fieldValue) {
            if (typeof elt == 'object') {
              type = 'json';
              break;
            }
          }
          updatePatterns.push(`$${index}:name = array_to_json($${index + 1}::${type}[])::jsonb`);
        }
        values.push(fieldName, fieldValue);
        index += 2;
      } else {
        debug('Not supported update', fieldName, fieldValue);
        return Promise.reject(new _node2.default.Error(_node2.default.Error.OPERATION_FORBIDDEN, `Postgres doesn't support update ${JSON.stringify(fieldValue)} yet`));
      }
    }

    const where = buildWhereClause({ schema, index, query });
    values.push(...where.values);

    const whereClause = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `UPDATE $1:name SET ${updatePatterns.join()} ${whereClause} RETURNING *`;
    debug('update: ', qs, values);
    return this._client.any(qs, values);
  }

  // Hopefully, we can get rid of this. It's only used for config and hooks.
  upsertOneObject(className, schema, query, update) {
    debug('upsertOneObject', { className, query, update });
    const createValue = Object.assign({}, query, update);
    return this.createObject(className, schema, createValue).catch(error => {
      // ignore duplicate value errors as it's upsert
      if (error.code !== _node2.default.Error.DUPLICATE_VALUE) {
        throw error;
      }
      return this.findOneAndUpdate(className, schema, query, update);
    });
  }

  find(className, schema, query, { skip, limit, sort, keys }) {
    debug('find', className, query, { skip, limit, sort, keys });
    const hasLimit = limit !== undefined;
    const hasSkip = skip !== undefined;
    let values = [className];
    const where = buildWhereClause({ schema, query, index: 2 });
    values.push(...where.values);

    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const limitPattern = hasLimit ? `LIMIT $${values.length + 1}` : '';
    if (hasLimit) {
      values.push(limit);
    }
    const skipPattern = hasSkip ? `OFFSET $${values.length + 1}` : '';
    if (hasSkip) {
      values.push(skip);
    }

    let sortPattern = '';
    if (sort) {
      const sortCopy = sort;
      const sorting = Object.keys(sort).map(key => {
        const transformKey = transformDotFieldToComponents(key).join('->');
        // Using $idx pattern gives:  non-integer constant in ORDER BY
        if (sortCopy[key] === 1) {
          return `${transformKey} ASC`;
        }
        return `${transformKey} DESC`;
      }).join();
      sortPattern = sort !== undefined && Object.keys(sort).length > 0 ? `ORDER BY ${sorting}` : '';
    }
    if (where.sorts && Object.keys(where.sorts).length > 0) {
      sortPattern = `ORDER BY ${where.sorts.join()}`;
    }

    let columns = '*';
    if (keys) {
      // Exclude empty keys
      keys = keys.filter(key => {
        return key.length > 0;
      });
      columns = keys.map((key, index) => {
        if (key === '$score') {
          return `ts_rank_cd(to_tsvector($${2}, $${3}:name), to_tsquery($${4}, $${5}), 32) as score`;
        }
        return `$${index + values.length + 1}:name`;
      }).join();
      values = values.concat(keys);
    }

    const qs = `SELECT ${columns} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern}`;
    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      // Query on non existing table, don't crash
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }
      return [];
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  }

  // Converts from a postgres-format object to a REST-format object.
  // Does not strip out anything based on a lack of authentication.
  postgresObjectToParseObject(className, object, schema) {
    Object.keys(schema.fields).forEach(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer' && object[fieldName]) {
        object[fieldName] = { objectId: object[fieldName], __type: 'Pointer', className: schema.fields[fieldName].targetClass };
      }
      if (schema.fields[fieldName].type === 'Relation') {
        object[fieldName] = {
          __type: "Relation",
          className: schema.fields[fieldName].targetClass
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'GeoPoint') {
        object[fieldName] = {
          __type: "GeoPoint",
          latitude: object[fieldName].y,
          longitude: object[fieldName].x
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'Polygon') {
        let coords = object[fieldName];
        coords = coords.substr(2, coords.length - 4).split('),(');
        coords = coords.map(point => {
          return [parseFloat(point.split(',')[1]), parseFloat(point.split(',')[0])];
        });
        object[fieldName] = {
          __type: "Polygon",
          coordinates: coords
        };
      }
      if (object[fieldName] && schema.fields[fieldName].type === 'File') {
        object[fieldName] = {
          __type: 'File',
          name: object[fieldName]
        };
      }
    });
    //TODO: remove this reliance on the mongo format. DB adapter shouldn't know there is a difference between created at and any other date field.
    if (object.createdAt) {
      object.createdAt = object.createdAt.toISOString();
    }
    if (object.updatedAt) {
      object.updatedAt = object.updatedAt.toISOString();
    }
    if (object.expiresAt) {
      object.expiresAt = { __type: 'Date', iso: object.expiresAt.toISOString() };
    }
    if (object._email_verify_token_expires_at) {
      object._email_verify_token_expires_at = { __type: 'Date', iso: object._email_verify_token_expires_at.toISOString() };
    }
    if (object._account_lockout_expires_at) {
      object._account_lockout_expires_at = { __type: 'Date', iso: object._account_lockout_expires_at.toISOString() };
    }
    if (object._perishable_token_expires_at) {
      object._perishable_token_expires_at = { __type: 'Date', iso: object._perishable_token_expires_at.toISOString() };
    }
    if (object._password_changed_at) {
      object._password_changed_at = { __type: 'Date', iso: object._password_changed_at.toISOString() };
    }

    for (const fieldName in object) {
      if (object[fieldName] === null) {
        delete object[fieldName];
      }
      if (object[fieldName] instanceof Date) {
        object[fieldName] = { __type: 'Date', iso: object[fieldName].toISOString() };
      }
    }

    return object;
  }

  // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.
  ensureUniqueness(className, schema, fieldNames) {
    // Use the same name for every ensureUniqueness attempt, because postgres
    // Will happily create the same index with multiple names.
    const constraintName = `unique_${fieldNames.sort().join('_')}`;
    const constraintPatterns = fieldNames.map((fieldName, index) => `$${index + 3}:name`);
    const qs = `ALTER TABLE $1:name ADD CONSTRAINT $2:name UNIQUE (${constraintPatterns.join()})`;
    return this._client.none(qs, [className, constraintName, ...fieldNames]).catch(error => {
      if (error.code === PostgresDuplicateRelationError && error.message.includes(constraintName)) {
        // Index already exists. Ignore error.
      } else if (error.code === PostgresUniqueIndexViolationError && error.message.includes(constraintName)) {
        // Cast the error into the proper parse error
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      } else {
        throw error;
      }
    });
  }

  // Executes a count.
  count(className, schema, query) {
    debug('count', className, query);
    const values = [className];
    const where = buildWhereClause({ schema, query, index: 2 });
    values.push(...where.values);

    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const qs = `SELECT count(*) FROM $1:name ${wherePattern}`;
    return this._client.one(qs, values, a => +a.count).catch(error => {
      if (error.code !== PostgresRelationDoesNotExistError) {
        throw error;
      }
      return 0;
    });
  }

  distinct(className, schema, query, fieldName) {
    debug('distinct', className, query);
    let field = fieldName;
    let column = fieldName;
    const isNested = fieldName.indexOf('.') >= 0;
    if (isNested) {
      field = transformDotFieldToComponents(fieldName).join('->');
      column = fieldName.split('.')[0];
    }
    const isArrayField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Array';
    const isPointerField = schema.fields && schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    const values = [field, column, className];
    const where = buildWhereClause({ schema, query, index: 4 });
    values.push(...where.values);

    const wherePattern = where.pattern.length > 0 ? `WHERE ${where.pattern}` : '';
    const transformer = isArrayField ? 'jsonb_array_elements' : 'ON';
    let qs = `SELECT DISTINCT ${transformer}($1:name) $2:name FROM $3:name ${wherePattern}`;
    if (isNested) {
      qs = `SELECT DISTINCT ${transformer}($1:raw) $2:raw FROM $3:name ${wherePattern}`;
    }
    debug(qs, values);
    return this._client.any(qs, values).catch(error => {
      if (error.code === PostgresMissingColumnError) {
        return [];
      }
      throw error;
    }).then(results => {
      if (!isNested) {
        results = results.filter(object => object[field] !== null);
        return results.map(object => {
          if (!isPointerField) {
            return object[field];
          }
          return {
            __type: 'Pointer',
            className: schema.fields[fieldName].targetClass,
            objectId: object[field]
          };
        });
      }
      const child = fieldName.split('.')[1];
      return results.map(object => object[column][child]);
    }).then(results => results.map(object => this.postgresObjectToParseObject(className, object, schema)));
  }

  aggregate(className, schema, pipeline) {
    debug('aggregate', className, pipeline);
    const values = [className];
    let index = 2;
    let columns = [];
    let countField = null;
    let groupValues = null;
    let wherePattern = '';
    let limitPattern = '';
    let skipPattern = '';
    let sortPattern = '';
    let groupPattern = '';
    for (let i = 0; i < pipeline.length; i += 1) {
      const stage = pipeline[i];
      if (stage.$group) {
        for (const field in stage.$group) {
          const value = stage.$group[field];
          if (value === null || value === undefined) {
            continue;
          }
          if (field === '_id' && typeof value === 'string' && value !== '') {
            columns.push(`$${index}:name AS "objectId"`);
            groupPattern = `GROUP BY $${index}:name`;
            values.push(transformAggregateField(value));
            index += 1;
            continue;
          }
          if (field === '_id' && typeof value === 'object' && Object.keys(value).length !== 0) {
            groupValues = value;
            const groupByFields = [];
            for (const alias in value) {
              const operation = Object.keys(value[alias])[0];
              const source = transformAggregateField(value[alias][operation]);
              if (mongoAggregateToPostgres[operation]) {
                if (!groupByFields.includes(`"${source}"`)) {
                  groupByFields.push(`"${source}"`);
                }
                columns.push(`EXTRACT(${mongoAggregateToPostgres[operation]} FROM $${index}:name AT TIME ZONE 'UTC') AS $${index + 1}:name`);
                values.push(source, alias);
                index += 2;
              }
            }
            groupPattern = `GROUP BY $${index}:raw`;
            values.push(groupByFields.join());
            index += 1;
            continue;
          }
          if (value.$sum) {
            if (typeof value.$sum === 'string') {
              columns.push(`SUM($${index}:name) AS $${index + 1}:name`);
              values.push(transformAggregateField(value.$sum), field);
              index += 2;
            } else {
              countField = field;
              columns.push(`COUNT(*) AS $${index}:name`);
              values.push(field);
              index += 1;
            }
          }
          if (value.$max) {
            columns.push(`MAX($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$max), field);
            index += 2;
          }
          if (value.$min) {
            columns.push(`MIN($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$min), field);
            index += 2;
          }
          if (value.$avg) {
            columns.push(`AVG($${index}:name) AS $${index + 1}:name`);
            values.push(transformAggregateField(value.$avg), field);
            index += 2;
          }
        }
      } else {
        columns.push('*');
      }
      if (stage.$project) {
        if (columns.includes('*')) {
          columns = [];
        }
        for (const field in stage.$project) {
          const value = stage.$project[field];
          if (value === 1 || value === true) {
            columns.push(`$${index}:name`);
            values.push(field);
            index += 1;
          }
        }
      }
      if (stage.$match) {
        const patterns = [];
        const orOrAnd = stage.$match.hasOwnProperty('$or') ? ' OR ' : ' AND ';

        if (stage.$match.$or) {
          const collapse = {};
          stage.$match.$or.forEach(element => {
            for (const key in element) {
              collapse[key] = element[key];
            }
          });
          stage.$match = collapse;
        }
        for (const field in stage.$match) {
          const value = stage.$match[field];
          const matchPatterns = [];
          Object.keys(ParseToPosgresComparator).forEach(cmp => {
            if (value[cmp]) {
              const pgComparator = ParseToPosgresComparator[cmp];
              matchPatterns.push(`$${index}:name ${pgComparator} $${index + 1}`);
              values.push(field, toPostgresValue(value[cmp]));
              index += 2;
            }
          });
          if (matchPatterns.length > 0) {
            patterns.push(`(${matchPatterns.join(' AND ')})`);
          }
          if (schema.fields[field] && schema.fields[field].type && matchPatterns.length === 0) {
            patterns.push(`$${index}:name = $${index + 1}`);
            values.push(field, value);
            index += 2;
          }
        }
        wherePattern = patterns.length > 0 ? `WHERE ${patterns.join(` ${orOrAnd} `)}` : '';
      }
      if (stage.$limit) {
        limitPattern = `LIMIT $${index}`;
        values.push(stage.$limit);
        index += 1;
      }
      if (stage.$skip) {
        skipPattern = `OFFSET $${index}`;
        values.push(stage.$skip);
        index += 1;
      }
      if (stage.$sort) {
        const sort = stage.$sort;
        const keys = Object.keys(sort);
        const sorting = keys.map(key => {
          const transformer = sort[key] === 1 ? 'ASC' : 'DESC';
          const order = `$${index}:name ${transformer}`;
          index += 1;
          return order;
        }).join();
        values.push(...keys);
        sortPattern = sort !== undefined && sorting.length > 0 ? `ORDER BY ${sorting}` : '';
      }
    }

    const qs = `SELECT ${columns.join()} FROM $1:name ${wherePattern} ${sortPattern} ${limitPattern} ${skipPattern} ${groupPattern}`;
    debug(qs, values);
    return this._client.map(qs, values, a => this.postgresObjectToParseObject(className, a, schema)).then(results => {
      results.forEach(result => {
        if (!result.hasOwnProperty('objectId')) {
          result.objectId = null;
        }
        if (groupValues) {
          result.objectId = {};
          for (const key in groupValues) {
            result.objectId[key] = result[key];
            delete result[key];
          }
        }
        if (countField) {
          result[countField] = parseInt(result[countField], 10);
        }
      });
      return results;
    });
  }

  performInitialization({ VolatileClassesSchemas }) {
    // TODO: This method needs to be rewritten to make proper use of connections (@vitaly-t)
    debug('performInitialization');
    const promises = VolatileClassesSchemas.map(schema => {
      return this.createTable(schema.className, schema).catch(err => {
        if (err.code === PostgresDuplicateRelationError || err.code === _node2.default.Error.INVALID_CLASS_NAME) {
          return Promise.resolve();
        }
        throw err;
      }).then(() => this.schemaUpgrade(schema.className, schema));
    });
    return Promise.all(promises).then(() => {
      return this._client.tx('perform-initialization', t => {
        return t.batch([t.none(_sql2.default.misc.jsonObjectSetKeys), t.none(_sql2.default.array.add), t.none(_sql2.default.array.addUnique), t.none(_sql2.default.array.remove), t.none(_sql2.default.array.containsAll), t.none(_sql2.default.array.containsAllRegex), t.none(_sql2.default.array.contains)]);
      });
    }).then(data => {
      debug(`initializationDone in ${data.duration}`);
    }).catch(error => {
      /* eslint-disable no-console */
      console.error(error);
    });
  }

  createIndexes(className, indexes, conn) {
    return (conn || this._client).tx(t => t.batch(indexes.map(i => {
      return t.none('CREATE INDEX $1:name ON $2:name ($3:name)', [i.name, className, i.key]);
    })));
  }

  createIndexesIfNeeded(className, fieldName, type, conn) {
    return (conn || this._client).none('CREATE INDEX $1:name ON $2:name ($3:name)', [fieldName, className, type]);
  }

  dropIndexes(className, indexes, conn) {
    const queries = indexes.map(i => ({ query: 'DROP INDEX $1:name', values: i }));
    return (conn || this._client).tx(t => t.none(this._pgp.helpers.concat(queries)));
  }

  getIndexes(className) {
    const qs = 'SELECT * FROM pg_indexes WHERE tablename = ${className}';
    return this._client.any(qs, { className });
  }

  updateSchemaWithIndexes() {
    return Promise.resolve();
  }
}

exports.PostgresStorageAdapter = PostgresStorageAdapter;
function convertPolygonToSQL(polygon) {
  if (polygon.length < 3) {
    throw new _node2.default.Error(_node2.default.Error.INVALID_JSON, `Polygon must have at least 3 values`);
  }
  if (polygon[0][0] !== polygon[polygon.length - 1][0] || polygon[0][1] !== polygon[polygon.length - 1][1]) {
    polygon.push(polygon[0]);
  }
  const unique = polygon.filter((item, index, ar) => {
    let foundIndex = -1;
    for (let i = 0; i < ar.length; i += 1) {
      const pt = ar[i];
      if (pt[0] === item[0] && pt[1] === item[1]) {
        foundIndex = i;
        break;
      }
    }
    return foundIndex === index;
  });
  if (unique.length < 3) {
    throw new _node2.default.Error(_node2.default.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
  }
  const points = polygon.map(point => {
    _node2.default.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));
    return `(${point[1]}, ${point[0]})`;
  }).join(', ');
  return `(${points})`;
}

function removeWhiteSpace(regex) {
  if (!regex.endsWith('\n')) {
    regex += '\n';
  }

  // remove non escaped comments
  return regex.replace(/([^\\])#.*\n/gmi, '$1')
  // remove lines starting with a comment
  .replace(/^#.*\n/gmi, '')
  // remove non escaped whitespace
  .replace(/([^\\])\s+/gmi, '$1')
  // remove whitespace at the beginning of a line
  .replace(/^\s+/, '').trim();
}

function processRegexPattern(s) {
  if (s && s.startsWith('^')) {
    // regex for startsWith
    return '^' + literalizeRegexPart(s.slice(1));
  } else if (s && s.endsWith('$')) {
    // regex for endsWith
    return literalizeRegexPart(s.slice(0, s.length - 1)) + '$';
  }

  // regex for contains
  return literalizeRegexPart(s);
}

function isStartsWithRegex(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('^')) {
    return false;
  }

  const matches = value.match(/\^\\Q.*\\E/);
  return !!matches;
}

function isAllValuesRegexOrNone(values) {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }

  const firstValuesIsRegex = isStartsWithRegex(values[0].$regex);
  if (values.length === 1) {
    return firstValuesIsRegex;
  }

  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i].$regex)) {
      return false;
    }
  }

  return true;
}

function isAnyValueRegexStartsWith(values) {
  return values.some(function (value) {
    return isStartsWithRegex(value.$regex);
  });
}

function createLiteralRegex(remaining) {
  return remaining.split('').map(c => {
    if (c.match(/[0-9a-zA-Z]/) !== null) {
      // don't escape alphanumeric characters
      return c;
    }
    // escape everything else (single quotes with single quotes, everything else with a backslash)
    return c === `'` ? `''` : `\\${c}`;
  }).join('');
}

function literalizeRegexPart(s) {
  const matcher1 = /\\Q((?!\\E).*)\\E$/;
  const result1 = s.match(matcher1);
  if (result1 && result1.length > 1 && result1.index > -1) {
    // process regex that has a beginning and an end specified for the literal text
    const prefix = s.substr(0, result1.index);
    const remaining = result1[1];

    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  }

  // process regex that has a beginning specified for the literal text
  const matcher2 = /\\Q((?!\\E).*)$/;
  const result2 = s.match(matcher2);
  if (result2 && result2.length > 1 && result2.index > -1) {
    const prefix = s.substr(0, result2.index);
    const remaining = result2[1];

    return literalizeRegexPart(prefix) + createLiteralRegex(remaining);
  }

  // remove all instances of \Q and \E from the remaining text & escape single quotes
  return s.replace(/([^\\])(\\E)/, '$1').replace(/([^\\])(\\Q)/, '$1').replace(/^\\E/, '').replace(/^\\Q/, '').replace(/([^'])'/, `$1''`).replace(/^'([^'])/, `''$1`);
}

var GeoPointCoder = {
  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }
};

exports.default = PostgresStorageAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL1Bvc3RncmVzL1Bvc3RncmVzU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsiUG9zdGdyZXNSZWxhdGlvbkRvZXNOb3RFeGlzdEVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciIsIlBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yIiwiUG9zdGdyZXNEdXBsaWNhdGVPYmplY3RFcnJvciIsIlBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciIsIlBvc3RncmVzVHJhbnNhY3Rpb25BYm9ydGVkRXJyb3IiLCJsb2dnZXIiLCJyZXF1aXJlIiwiZGVidWciLCJhcmdzIiwiYXJndW1lbnRzIiwiY29uY2F0Iiwic2xpY2UiLCJsZW5ndGgiLCJsb2ciLCJnZXRMb2dnZXIiLCJhcHBseSIsInBhcnNlVHlwZVRvUG9zdGdyZXNUeXBlIiwidHlwZSIsImNvbnRlbnRzIiwiSlNPTiIsInN0cmluZ2lmeSIsIlBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvciIsIm1vbmdvQWdncmVnYXRlVG9Qb3N0Z3JlcyIsIiRkYXlPZk1vbnRoIiwiJGRheU9mV2VlayIsIiRkYXlPZlllYXIiLCIkaXNvRGF5T2ZXZWVrIiwiJGlzb1dlZWtZZWFyIiwiJGhvdXIiLCIkbWludXRlIiwiJHNlY29uZCIsIiRtaWxsaXNlY29uZCIsIiRtb250aCIsIiR3ZWVrIiwiJHllYXIiLCJ0b1Bvc3RncmVzVmFsdWUiLCJ2YWx1ZSIsIl9fdHlwZSIsImlzbyIsIm5hbWUiLCJ0cmFuc2Zvcm1WYWx1ZSIsIm9iamVjdElkIiwiZW1wdHlDTFBTIiwiT2JqZWN0IiwiZnJlZXplIiwiZmluZCIsImdldCIsImNyZWF0ZSIsInVwZGF0ZSIsImRlbGV0ZSIsImFkZEZpZWxkIiwiZGVmYXVsdENMUFMiLCJ0b1BhcnNlU2NoZW1hIiwic2NoZW1hIiwiY2xhc3NOYW1lIiwiZmllbGRzIiwiX2hhc2hlZF9wYXNzd29yZCIsIl93cGVybSIsIl9ycGVybSIsImNscHMiLCJjbGFzc0xldmVsUGVybWlzc2lvbnMiLCJpbmRleGVzIiwidG9Qb3N0Z3Jlc1NjaGVtYSIsIl9wYXNzd29yZF9oaXN0b3J5IiwiaGFuZGxlRG90RmllbGRzIiwib2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJmaWVsZE5hbWUiLCJpbmRleE9mIiwiY29tcG9uZW50cyIsInNwbGl0IiwiZmlyc3QiLCJzaGlmdCIsImN1cnJlbnRPYmoiLCJuZXh0IiwiX19vcCIsInVuZGVmaW5lZCIsInRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzIiwibWFwIiwiY21wdCIsImluZGV4IiwidHJhbnNmb3JtRG90RmllbGQiLCJqb2luIiwidHJhbnNmb3JtQWdncmVnYXRlRmllbGQiLCJzdWJzdHIiLCJ2YWxpZGF0ZUtleXMiLCJrZXkiLCJpbmNsdWRlcyIsIkVycm9yIiwiSU5WQUxJRF9ORVNURURfS0VZIiwiam9pblRhYmxlc0ZvclNjaGVtYSIsImxpc3QiLCJmaWVsZCIsInB1c2giLCJidWlsZFdoZXJlQ2xhdXNlIiwicXVlcnkiLCJwYXR0ZXJucyIsInZhbHVlcyIsInNvcnRzIiwiaXNBcnJheUZpZWxkIiwiaW5pdGlhbFBhdHRlcm5zTGVuZ3RoIiwiZmllbGRWYWx1ZSIsIiRleGlzdHMiLCIkaW4iLCJpblBhdHRlcm5zIiwibGlzdEVsZW0iLCIkcmVnZXgiLCJNQVhfSU5UX1BMVVNfT05FIiwiY2xhdXNlcyIsImNsYXVzZVZhbHVlcyIsInN1YlF1ZXJ5IiwiY2xhdXNlIiwicGF0dGVybiIsIm9yT3JBbmQiLCJub3QiLCIkbmUiLCIkZXEiLCJpc0luT3JOaW4iLCJBcnJheSIsImlzQXJyYXkiLCIkbmluIiwiYWxsb3dOdWxsIiwibGlzdEluZGV4IiwiY3JlYXRlQ29uc3RyYWludCIsImJhc2VBcnJheSIsIm5vdEluIiwiZmxhdE1hcCIsImVsdCIsIklOVkFMSURfSlNPTiIsIiRhbGwiLCJpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoIiwiaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSIsImkiLCJwcm9jZXNzUmVnZXhQYXR0ZXJuIiwic3Vic3RyaW5nIiwiJGNvbnRhaW5lZEJ5IiwiYXJyIiwiJHRleHQiLCJzZWFyY2giLCIkc2VhcmNoIiwibGFuZ3VhZ2UiLCIkdGVybSIsIiRsYW5ndWFnZSIsIiRjYXNlU2Vuc2l0aXZlIiwiJGRpYWNyaXRpY1NlbnNpdGl2ZSIsIiRuZWFyU3BoZXJlIiwicG9pbnQiLCJkaXN0YW5jZSIsIiRtYXhEaXN0YW5jZSIsImRpc3RhbmNlSW5LTSIsImxvbmdpdHVkZSIsImxhdGl0dWRlIiwiJHdpdGhpbiIsIiRib3giLCJib3giLCJsZWZ0IiwiYm90dG9tIiwicmlnaHQiLCJ0b3AiLCIkZ2VvV2l0aGluIiwiJGNlbnRlclNwaGVyZSIsImNlbnRlclNwaGVyZSIsIkdlb1BvaW50IiwiR2VvUG9pbnRDb2RlciIsImlzVmFsaWRKU09OIiwiX3ZhbGlkYXRlIiwiaXNOYU4iLCIkcG9seWdvbiIsInBvbHlnb24iLCJwb2ludHMiLCJjb29yZGluYXRlcyIsIiRnZW9JbnRlcnNlY3RzIiwiJHBvaW50IiwicmVnZXgiLCJvcGVyYXRvciIsIm9wdHMiLCIkb3B0aW9ucyIsInJlbW92ZVdoaXRlU3BhY2UiLCJjb252ZXJ0UG9seWdvblRvU1FMIiwiY21wIiwicGdDb21wYXJhdG9yIiwiT1BFUkFUSU9OX0ZPUkJJRERFTiIsIlBvc3RncmVzU3RvcmFnZUFkYXB0ZXIiLCJjb25zdHJ1Y3RvciIsInVyaSIsImNvbGxlY3Rpb25QcmVmaXgiLCJkYXRhYmFzZU9wdGlvbnMiLCJfY29sbGVjdGlvblByZWZpeCIsImNsaWVudCIsInBncCIsIl9jbGllbnQiLCJfcGdwIiwiY2FuU29ydE9uSm9pblRhYmxlcyIsImhhbmRsZVNodXRkb3duIiwiJHBvb2wiLCJlbmQiLCJfZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyIsImNvbm4iLCJub25lIiwiY2F0Y2giLCJlcnJvciIsImNvZGUiLCJjbGFzc0V4aXN0cyIsIm9uZSIsImEiLCJleGlzdHMiLCJzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMiLCJDTFBzIiwic2VsZiIsInRhc2siLCJ0Iiwic2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQiLCJzdWJtaXR0ZWRJbmRleGVzIiwiZXhpc3RpbmdJbmRleGVzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJfaWRfIiwiX2lkIiwiZGVsZXRlZEluZGV4ZXMiLCJpbnNlcnRlZEluZGV4ZXMiLCJJTlZBTElEX1FVRVJZIiwiaGFzT3duUHJvcGVydHkiLCJ0eCIsImNyZWF0ZUluZGV4ZXMiLCJkcm9wSW5kZXhlcyIsImNyZWF0ZUNsYXNzIiwicTEiLCJjcmVhdGVUYWJsZSIsInEyIiwicTMiLCJiYXRjaCIsInRoZW4iLCJlcnIiLCJkYXRhIiwicmVzdWx0IiwiZGV0YWlsIiwiRFVQTElDQVRFX1ZBTFVFIiwidmFsdWVzQXJyYXkiLCJwYXR0ZXJuc0FycmF5IiwiYXNzaWduIiwiX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0IiwiX2VtYWlsX3ZlcmlmeV90b2tlbiIsIl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCIsIl9mYWlsZWRfbG9naW5fY291bnQiLCJfcGVyaXNoYWJsZV90b2tlbiIsIl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQiLCJfcGFzc3dvcmRfY2hhbmdlZF9hdCIsInJlbGF0aW9ucyIsInBhcnNlVHlwZSIsInFzIiwiam9pblRhYmxlIiwic2NoZW1hVXBncmFkZSIsImNvbHVtbnMiLCJjb2x1bW5fbmFtZSIsIm5ld0NvbHVtbnMiLCJmaWx0ZXIiLCJpdGVtIiwiYWRkRmllbGRJZk5vdEV4aXN0cyIsInBvc3RncmVzVHlwZSIsImFueSIsInBhdGgiLCJkZWxldGVDbGFzcyIsIm9wZXJhdGlvbnMiLCJoZWxwZXJzIiwiZGVsZXRlQWxsQ2xhc3NlcyIsIm5vdyIsIkRhdGUiLCJnZXRUaW1lIiwicmVzdWx0cyIsImpvaW5zIiwicmVkdWNlIiwiY2xhc3NlcyIsInF1ZXJpZXMiLCJkZWxldGVGaWVsZHMiLCJmaWVsZE5hbWVzIiwiaWR4IiwiZ2V0QWxsQ2xhc3NlcyIsInJvdyIsImdldENsYXNzIiwiY3JlYXRlT2JqZWN0IiwiY29sdW1uc0FycmF5IiwiZ2VvUG9pbnRzIiwiYXV0aERhdGFNYXRjaCIsIm1hdGNoIiwicHJvdmlkZXIiLCJwb3AiLCJpbml0aWFsVmFsdWVzIiwidmFsIiwidGVybWluYXRpb24iLCJnZW9Qb2ludHNJbmplY3RzIiwibCIsImNvbHVtbnNQYXR0ZXJuIiwiY29sIiwidmFsdWVzUGF0dGVybiIsIm9wcyIsInVuZGVybHlpbmdFcnJvciIsImNvbnN0cmFpbnQiLCJtYXRjaGVzIiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwiZGVsZXRlT2JqZWN0c0J5UXVlcnkiLCJ3aGVyZSIsImNvdW50IiwiT0JKRUNUX05PVF9GT1VORCIsImZpbmRPbmVBbmRVcGRhdGUiLCJ1cGRhdGVPYmplY3RzQnlRdWVyeSIsInVwZGF0ZVBhdHRlcm5zIiwib3JpZ2luYWxVcGRhdGUiLCJnZW5lcmF0ZSIsImpzb25iIiwibGFzdEtleSIsImZpZWxkTmFtZUluZGV4Iiwic3RyIiwiYW1vdW50Iiwib2JqZWN0cyIsImtleXNUb0luY3JlbWVudCIsImsiLCJpbmNyZW1lbnRQYXR0ZXJucyIsImMiLCJrZXlzVG9EZWxldGUiLCJkZWxldGVQYXR0ZXJucyIsInAiLCJleHBlY3RlZFR5cGUiLCJyZWplY3QiLCJ3aGVyZUNsYXVzZSIsInVwc2VydE9uZU9iamVjdCIsImNyZWF0ZVZhbHVlIiwic2tpcCIsImxpbWl0Iiwic29ydCIsImhhc0xpbWl0IiwiaGFzU2tpcCIsIndoZXJlUGF0dGVybiIsImxpbWl0UGF0dGVybiIsInNraXBQYXR0ZXJuIiwic29ydFBhdHRlcm4iLCJzb3J0Q29weSIsInNvcnRpbmciLCJ0cmFuc2Zvcm1LZXkiLCJwb3N0Z3Jlc09iamVjdFRvUGFyc2VPYmplY3QiLCJ0YXJnZXRDbGFzcyIsInkiLCJ4IiwiY29vcmRzIiwicGFyc2VGbG9hdCIsImNyZWF0ZWRBdCIsInRvSVNPU3RyaW5nIiwidXBkYXRlZEF0IiwiZXhwaXJlc0F0IiwiZW5zdXJlVW5pcXVlbmVzcyIsImNvbnN0cmFpbnROYW1lIiwiY29uc3RyYWludFBhdHRlcm5zIiwibWVzc2FnZSIsImRpc3RpbmN0IiwiY29sdW1uIiwiaXNOZXN0ZWQiLCJpc1BvaW50ZXJGaWVsZCIsInRyYW5zZm9ybWVyIiwiY2hpbGQiLCJhZ2dyZWdhdGUiLCJwaXBlbGluZSIsImNvdW50RmllbGQiLCJncm91cFZhbHVlcyIsImdyb3VwUGF0dGVybiIsInN0YWdlIiwiJGdyb3VwIiwiZ3JvdXBCeUZpZWxkcyIsImFsaWFzIiwib3BlcmF0aW9uIiwic291cmNlIiwiJHN1bSIsIiRtYXgiLCIkbWluIiwiJGF2ZyIsIiRwcm9qZWN0IiwiJG1hdGNoIiwiJG9yIiwiY29sbGFwc2UiLCJlbGVtZW50IiwibWF0Y2hQYXR0ZXJucyIsIiRsaW1pdCIsIiRza2lwIiwiJHNvcnQiLCJvcmRlciIsInBhcnNlSW50IiwicGVyZm9ybUluaXRpYWxpemF0aW9uIiwiVm9sYXRpbGVDbGFzc2VzU2NoZW1hcyIsInByb21pc2VzIiwiSU5WQUxJRF9DTEFTU19OQU1FIiwiYWxsIiwibWlzYyIsImpzb25PYmplY3RTZXRLZXlzIiwiYXJyYXkiLCJhZGQiLCJhZGRVbmlxdWUiLCJyZW1vdmUiLCJjb250YWluc0FsbCIsImNvbnRhaW5zQWxsUmVnZXgiLCJjb250YWlucyIsImR1cmF0aW9uIiwiY29uc29sZSIsImNyZWF0ZUluZGV4ZXNJZk5lZWRlZCIsImdldEluZGV4ZXMiLCJ1cGRhdGVTY2hlbWFXaXRoSW5kZXhlcyIsInVuaXF1ZSIsImFyIiwiZm91bmRJbmRleCIsInB0IiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwiZW5kc1dpdGgiLCJyZXBsYWNlIiwidHJpbSIsInMiLCJzdGFydHNXaXRoIiwibGl0ZXJhbGl6ZVJlZ2V4UGFydCIsImlzU3RhcnRzV2l0aFJlZ2V4IiwiZmlyc3RWYWx1ZXNJc1JlZ2V4Iiwic29tZSIsImNyZWF0ZUxpdGVyYWxSZWdleCIsInJlbWFpbmlu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QUFQLEtBQWlCLFFBQWpCLElBQ05BLFVBQVUsSUFESixJQUVOQSxNQUFNQyxNQUFOLEtBQWlCLFVBRm5CO0FBSUQ7QUFOaUIsQ0FBcEI7O2tCQVNla0osc0IiLCJmaWxlIjoiUG9zdGdyZXNTdG9yYWdlQWRhcHRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEBmbG93XG5pbXBvcnQgeyBjcmVhdGVDbGllbnQgfSBmcm9tICcuL1Bvc3RncmVzQ2xpZW50Jztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IFBhcnNlICAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfICAgICAgICAgICAgICAgIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgc3FsICAgICAgICAgICAgICBmcm9tICcuL3NxbCc7XG5cbmNvbnN0IFBvc3RncmVzUmVsYXRpb25Eb2VzTm90RXhpc3RFcnJvciA9ICc0MlAwMSc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgPSAnNDJQMDcnO1xuY29uc3QgUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvciA9ICc0MjcwMSc7XG5jb25zdCBQb3N0Z3Jlc01pc3NpbmdDb2x1bW5FcnJvciA9ICc0MjcwMyc7XG5jb25zdCBQb3N0Z3Jlc0R1cGxpY2F0ZU9iamVjdEVycm9yID0gJzQyNzEwJztcbmNvbnN0IFBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvciA9ICcyMzUwNSc7XG5jb25zdCBQb3N0Z3Jlc1RyYW5zYWN0aW9uQWJvcnRlZEVycm9yID0gJzI1UDAyJztcbmNvbnN0IGxvZ2dlciA9IHJlcXVpcmUoJy4uLy4uLy4uL2xvZ2dlcicpO1xuXG5jb25zdCBkZWJ1ZyA9IGZ1bmN0aW9uKC4uLmFyZ3M6IGFueSkge1xuICBhcmdzID0gWydQRzogJyArIGFyZ3VtZW50c1swXV0uY29uY2F0KGFyZ3Muc2xpY2UoMSwgYXJncy5sZW5ndGgpKTtcbiAgY29uc3QgbG9nID0gbG9nZ2VyLmdldExvZ2dlcigpO1xuICBsb2cuZGVidWcuYXBwbHkobG9nLCBhcmdzKTtcbn1cblxuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSAgICBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgdHlwZSB7IFNjaGVtYVR5cGUsXG4gIFF1ZXJ5VHlwZSxcbiAgUXVlcnlPcHRpb25zIH0gZnJvbSAnLi4vU3RvcmFnZUFkYXB0ZXInO1xuXG5jb25zdCBwYXJzZVR5cGVUb1Bvc3RncmVzVHlwZSA9IHR5cGUgPT4ge1xuICBzd2l0Y2ggKHR5cGUudHlwZSkge1xuICBjYXNlICdTdHJpbmcnOiByZXR1cm4gJ3RleHQnO1xuICBjYXNlICdEYXRlJzogcmV0dXJuICd0aW1lc3RhbXAgd2l0aCB0aW1lIHpvbmUnO1xuICBjYXNlICdPYmplY3QnOiByZXR1cm4gJ2pzb25iJztcbiAgY2FzZSAnRmlsZSc6IHJldHVybiAndGV4dCc7XG4gIGNhc2UgJ0Jvb2xlYW4nOiByZXR1cm4gJ2Jvb2xlYW4nO1xuICBjYXNlICdQb2ludGVyJzogcmV0dXJuICdjaGFyKDEwKSc7XG4gIGNhc2UgJ051bWJlcic6IHJldHVybiAnZG91YmxlIHByZWNpc2lvbic7XG4gIGNhc2UgJ0dlb1BvaW50JzogcmV0dXJuICdwb2ludCc7XG4gIGNhc2UgJ0J5dGVzJzogcmV0dXJuICdqc29uYic7XG4gIGNhc2UgJ1BvbHlnb24nOiByZXR1cm4gJ3BvbHlnb24nO1xuICBjYXNlICdBcnJheSc6XG4gICAgaWYgKHR5cGUuY29udGVudHMgJiYgdHlwZS5jb250ZW50cy50eXBlID09PSAnU3RyaW5nJykge1xuICAgICAgcmV0dXJuICd0ZXh0W10nO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gJ2pzb25iJztcbiAgICB9XG4gIGRlZmF1bHQ6IHRocm93IGBubyB0eXBlIGZvciAke0pTT04uc3RyaW5naWZ5KHR5cGUpfSB5ZXRgO1xuICB9XG59O1xuXG5jb25zdCBQYXJzZVRvUG9zZ3Jlc0NvbXBhcmF0b3IgPSB7XG4gICckZ3QnOiAnPicsXG4gICckbHQnOiAnPCcsXG4gICckZ3RlJzogJz49JyxcbiAgJyRsdGUnOiAnPD0nXG59XG5cbmNvbnN0IG1vbmdvQWdncmVnYXRlVG9Qb3N0Z3JlcyA9IHtcbiAgJGRheU9mTW9udGg6ICdEQVknLFxuICAkZGF5T2ZXZWVrOiAnRE9XJyxcbiAgJGRheU9mWWVhcjogJ0RPWScsXG4gICRpc29EYXlPZldlZWs6ICdJU09ET1cnLFxuICAkaXNvV2Vla1llYXI6J0lTT1lFQVInLFxuICAkaG91cjogJ0hPVVInLFxuICAkbWludXRlOiAnTUlOVVRFJyxcbiAgJHNlY29uZDogJ1NFQ09ORCcsXG4gICRtaWxsaXNlY29uZDogJ01JTExJU0VDT05EUycsXG4gICRtb250aDogJ01PTlRIJyxcbiAgJHdlZWs6ICdXRUVLJyxcbiAgJHllYXI6ICdZRUFSJyxcbn07XG5cbmNvbnN0IHRvUG9zdGdyZXNWYWx1ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICBpZiAodmFsdWUuX190eXBlID09PSAnRGF0ZScpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5pc287XG4gICAgfVxuICAgIGlmICh2YWx1ZS5fX3R5cGUgPT09ICdGaWxlJykge1xuICAgICAgcmV0dXJuIHZhbHVlLm5hbWU7XG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuY29uc3QgdHJhbnNmb3JtVmFsdWUgPSB2YWx1ZSA9PiB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICAgIHZhbHVlLl9fdHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgcmV0dXJuIHZhbHVlLm9iamVjdElkO1xuICB9XG4gIHJldHVybiB2YWx1ZTtcbn1cblxuLy8gRHVwbGljYXRlIGZyb20gdGhlbiBtb25nbyBhZGFwdGVyLi4uXG5jb25zdCBlbXB0eUNMUFMgPSBPYmplY3QuZnJlZXplKHtcbiAgZmluZDoge30sXG4gIGdldDoge30sXG4gIGNyZWF0ZToge30sXG4gIHVwZGF0ZToge30sXG4gIGRlbGV0ZToge30sXG4gIGFkZEZpZWxkOiB7fSxcbn0pO1xuXG5jb25zdCBkZWZhdWx0Q0xQUyA9IE9iamVjdC5mcmVlemUoe1xuICBmaW5kOiB7JyonOiB0cnVlfSxcbiAgZ2V0OiB7JyonOiB0cnVlfSxcbiAgY3JlYXRlOiB7JyonOiB0cnVlfSxcbiAgdXBkYXRlOiB7JyonOiB0cnVlfSxcbiAgZGVsZXRlOiB7JyonOiB0cnVlfSxcbiAgYWRkRmllbGQ6IHsnKic6IHRydWV9LFxufSk7XG5cbmNvbnN0IHRvUGFyc2VTY2hlbWEgPSAoc2NoZW1hKSA9PiB7XG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX2hhc2hlZF9wYXNzd29yZDtcbiAgfVxuICBpZiAoc2NoZW1hLmZpZWxkcykge1xuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl93cGVybTtcbiAgICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fcnBlcm07XG4gIH1cbiAgbGV0IGNscHMgPSBkZWZhdWx0Q0xQUztcbiAgaWYgKHNjaGVtYS5jbGFzc0xldmVsUGVybWlzc2lvbnMpIHtcbiAgICBjbHBzID0gey4uLmVtcHR5Q0xQUywgLi4uc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9uc307XG4gIH1cbiAgbGV0IGluZGV4ZXMgPSB7fTtcbiAgaWYgKHNjaGVtYS5pbmRleGVzKSB7XG4gICAgaW5kZXhlcyA9IHsuLi5zY2hlbWEuaW5kZXhlc307XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBjbGFzc05hbWU6IHNjaGVtYS5jbGFzc05hbWUsXG4gICAgZmllbGRzOiBzY2hlbWEuZmllbGRzLFxuICAgIGNsYXNzTGV2ZWxQZXJtaXNzaW9uczogY2xwcyxcbiAgICBpbmRleGVzLFxuICB9O1xufVxuXG5jb25zdCB0b1Bvc3RncmVzU2NoZW1hID0gKHNjaGVtYSkgPT4ge1xuICBpZiAoIXNjaGVtYSkge1xuICAgIHJldHVybiBzY2hlbWE7XG4gIH1cbiAgc2NoZW1hLmZpZWxkcyA9IHNjaGVtYS5maWVsZHMgfHwge307XG4gIHNjaGVtYS5maWVsZHMuX3dwZXJtID0ge3R5cGU6ICdBcnJheScsIGNvbnRlbnRzOiB7dHlwZTogJ1N0cmluZyd9fVxuICBzY2hlbWEuZmllbGRzLl9ycGVybSA9IHt0eXBlOiAnQXJyYXknLCBjb250ZW50czoge3R5cGU6ICdTdHJpbmcnfX1cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQgPSB7dHlwZTogJ1N0cmluZyd9O1xuICAgIHNjaGVtYS5maWVsZHMuX3Bhc3N3b3JkX2hpc3RvcnkgPSB7dHlwZTogJ0FycmF5J307XG4gIH1cbiAgcmV0dXJuIHNjaGVtYTtcbn1cblxuY29uc3QgaGFuZGxlRG90RmllbGRzID0gKG9iamVjdCkgPT4ge1xuICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+IC0xKSB7XG4gICAgICBjb25zdCBjb21wb25lbnRzID0gZmllbGROYW1lLnNwbGl0KCcuJyk7XG4gICAgICBjb25zdCBmaXJzdCA9IGNvbXBvbmVudHMuc2hpZnQoKTtcbiAgICAgIG9iamVjdFtmaXJzdF0gPSBvYmplY3RbZmlyc3RdIHx8IHt9O1xuICAgICAgbGV0IGN1cnJlbnRPYmogPSBvYmplY3RbZmlyc3RdO1xuICAgICAgbGV0IG5leHQ7XG4gICAgICBsZXQgdmFsdWUgPSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB2YWx1ZSA9IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLWNvbmQtYXNzaWduICovXG4gICAgICB3aGlsZShuZXh0ID0gY29tcG9uZW50cy5zaGlmdCgpKSB7XG4gICAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLWNvbmQtYXNzaWduICovXG4gICAgICAgIGN1cnJlbnRPYmpbbmV4dF0gPSBjdXJyZW50T2JqW25leHRdIHx8IHt9O1xuICAgICAgICBpZiAoY29tcG9uZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICBjdXJyZW50T2JqW25leHRdID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY3VycmVudE9iaiA9IGN1cnJlbnRPYmpbbmV4dF07XG4gICAgICB9XG4gICAgICBkZWxldGUgb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgfVxuICB9KTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuY29uc3QgdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMgPSAoZmllbGROYW1lKSA9PiB7XG4gIHJldHVybiBmaWVsZE5hbWUuc3BsaXQoJy4nKS5tYXAoKGNtcHQsIGluZGV4KSA9PiB7XG4gICAgaWYgKGluZGV4ID09PSAwKSB7XG4gICAgICByZXR1cm4gYFwiJHtjbXB0fVwiYDtcbiAgICB9XG4gICAgcmV0dXJuIGAnJHtjbXB0fSdgO1xuICB9KTtcbn1cblxuY29uc3QgdHJhbnNmb3JtRG90RmllbGQgPSAoZmllbGROYW1lKSA9PiB7XG4gIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID09PSAtMSkge1xuICAgIHJldHVybiBgXCIke2ZpZWxkTmFtZX1cImA7XG4gIH1cbiAgY29uc3QgY29tcG9uZW50cyA9IHRyYW5zZm9ybURvdEZpZWxkVG9Db21wb25lbnRzKGZpZWxkTmFtZSk7XG4gIGxldCBuYW1lID0gY29tcG9uZW50cy5zbGljZSgwLCBjb21wb25lbnRzLmxlbmd0aCAtIDEpLmpvaW4oJy0+Jyk7XG4gIG5hbWUgKz0gJy0+PicgKyBjb21wb25lbnRzW2NvbXBvbmVudHMubGVuZ3RoIC0gMV07XG4gIHJldHVybiBuYW1lO1xufVxuXG5jb25zdCB0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCA9IChmaWVsZE5hbWUpID0+IHtcbiAgaWYgKHR5cGVvZiBmaWVsZE5hbWUgIT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZpZWxkTmFtZTtcbiAgfVxuICBpZiAoZmllbGROYW1lID09PSAnJF9jcmVhdGVkX2F0Jykge1xuICAgIHJldHVybiAnY3JlYXRlZEF0JztcbiAgfVxuICBpZiAoZmllbGROYW1lID09PSAnJF91cGRhdGVkX2F0Jykge1xuICAgIHJldHVybiAndXBkYXRlZEF0JztcbiAgfVxuICByZXR1cm4gZmllbGROYW1lLnN1YnN0cigxKTtcbn1cblxuY29uc3QgdmFsaWRhdGVLZXlzID0gKG9iamVjdCkgPT4ge1xuICBpZiAodHlwZW9mIG9iamVjdCA9PSAnb2JqZWN0Jykge1xuICAgIGZvciAoY29uc3Qga2V5IGluIG9iamVjdCkge1xuICAgICAgaWYgKHR5cGVvZiBvYmplY3Rba2V5XSA9PSAnb2JqZWN0Jykge1xuICAgICAgICB2YWxpZGF0ZUtleXMob2JqZWN0W2tleV0pO1xuICAgICAgfVxuXG4gICAgICBpZihrZXkuaW5jbHVkZXMoJyQnKSB8fCBrZXkuaW5jbHVkZXMoJy4nKSl7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX05FU1RFRF9LRVksIFwiTmVzdGVkIGtleXMgc2hvdWxkIG5vdCBjb250YWluIHRoZSAnJCcgb3IgJy4nIGNoYXJhY3RlcnNcIik7XG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbi8vIFJldHVybnMgdGhlIGxpc3Qgb2Ygam9pbiB0YWJsZXMgb24gYSBzY2hlbWFcbmNvbnN0IGpvaW5UYWJsZXNGb3JTY2hlbWEgPSAoc2NoZW1hKSA9PiB7XG4gIGNvbnN0IGxpc3QgPSBbXTtcbiAgaWYgKHNjaGVtYSkge1xuICAgIE9iamVjdC5rZXlzKHNjaGVtYS5maWVsZHMpLmZvckVhY2goKGZpZWxkKSA9PiB7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZF0udHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgICBsaXN0LnB1c2goYF9Kb2luOiR7ZmllbGR9OiR7c2NoZW1hLmNsYXNzTmFtZX1gKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuICByZXR1cm4gbGlzdDtcbn1cblxuaW50ZXJmYWNlIFdoZXJlQ2xhdXNlIHtcbiAgcGF0dGVybjogc3RyaW5nO1xuICB2YWx1ZXM6IEFycmF5PGFueT47XG4gIHNvcnRzOiBBcnJheTxhbnk+O1xufVxuXG5jb25zdCBidWlsZFdoZXJlQ2xhdXNlID0gKHsgc2NoZW1hLCBxdWVyeSwgaW5kZXggfSk6IFdoZXJlQ2xhdXNlID0+IHtcbiAgY29uc3QgcGF0dGVybnMgPSBbXTtcbiAgbGV0IHZhbHVlcyA9IFtdO1xuICBjb25zdCBzb3J0cyA9IFtdO1xuXG4gIHNjaGVtYSA9IHRvUG9zdGdyZXNTY2hlbWEoc2NoZW1hKTtcbiAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gcXVlcnkpIHtcbiAgICBjb25zdCBpc0FycmF5RmllbGQgPSBzY2hlbWEuZmllbGRzXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdXG4gICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdBcnJheSc7XG4gICAgY29uc3QgaW5pdGlhbFBhdHRlcm5zTGVuZ3RoID0gcGF0dGVybnMubGVuZ3RoO1xuICAgIGNvbnN0IGZpZWxkVmFsdWUgPSBxdWVyeVtmaWVsZE5hbWVdO1xuXG4gICAgLy8gbm90aGluZ2luIHRoZSBzY2hlbWEsIGl0J3MgZ29ubmEgYmxvdyB1cFxuICAgIGlmICghc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdKSB7XG4gICAgICAvLyBhcyBpdCB3b24ndCBleGlzdFxuICAgICAgaWYgKGZpZWxkVmFsdWUgJiYgZmllbGRWYWx1ZS4kZXhpc3RzID09PSBmYWxzZSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmllbGROYW1lLmluZGV4T2YoJy4nKSA+PSAwKSB7XG4gICAgICBsZXQgbmFtZSA9IHRyYW5zZm9ybURvdEZpZWxkKGZpZWxkTmFtZSk7XG4gICAgICBpZiAoZmllbGRWYWx1ZSA9PT0gbnVsbCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAke25hbWV9IElTIE5VTExgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmaWVsZFZhbHVlLiRpbikge1xuICAgICAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgICAgICBuYW1lID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoZmllbGROYW1lKS5qb2luKCctPicpO1xuICAgICAgICAgIGZpZWxkVmFsdWUuJGluLmZvckVhY2goKGxpc3RFbGVtKSA9PiB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGxpc3RFbGVtID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYFwiJHtsaXN0RWxlbX1cImApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgaW5QYXR0ZXJucy5wdXNoKGAke2xpc3RFbGVtfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCgke25hbWV9KTo6anNvbmIgQD4gJ1ske2luUGF0dGVybnMuam9pbigpfV0nOjpqc29uYmApO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuJHJlZ2V4KSB7XG4gICAgICAgICAgLy8gSGFuZGxlIGxhdGVyXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcGF0dGVybnMucHVzaChgJHtuYW1lfSA9ICcke2ZpZWxkVmFsdWV9J2ApO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlID09PSBudWxsIHx8IGZpZWxkVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTlVMTGApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgIGluZGV4ICs9IDE7XG4gICAgICBjb250aW51ZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgaWYgKGlzQXJyYXlGaWVsZCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKCckJyArIGluZGV4ICsgJzpuYW1lID8gJCcgKyAoaW5kZXggKyAxKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKCckJyArIGluZGV4ICsgJzpuYW1lID0gJCcgKyAoaW5kZXggKyAxKSk7XG4gICAgICB9XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnYm9vbGVhbicpIHtcbiAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfWApO1xuICAgICAgLy8gQ2FuJ3QgY2FzdCBib29sZWFuIHRvIGRvdWJsZSBwcmVjaXNpb25cbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdOdW1iZXInKSB7XG4gICAgICAgIC8vIFNob3VsZCBhbHdheXMgcmV0dXJuIHplcm8gcmVzdWx0c1xuICAgICAgICBjb25zdCBNQVhfSU5UX1BMVVNfT05FID0gOTIyMzM3MjAzNjg1NDc3NTgwODtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBNQVhfSU5UX1BMVVNfT05FKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICB9XG4gICAgICBpbmRleCArPSAyO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpZWxkVmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH0gZWxzZSBpZiAoWyckb3InLCAnJG5vcicsICckYW5kJ10uaW5jbHVkZXMoZmllbGROYW1lKSkge1xuICAgICAgY29uc3QgY2xhdXNlcyA9IFtdO1xuICAgICAgY29uc3QgY2xhdXNlVmFsdWVzID0gW107XG4gICAgICBmaWVsZFZhbHVlLmZvckVhY2goKHN1YlF1ZXJ5KSA9PiAge1xuICAgICAgICBjb25zdCBjbGF1c2UgPSBidWlsZFdoZXJlQ2xhdXNlKHsgc2NoZW1hLCBxdWVyeTogc3ViUXVlcnksIGluZGV4IH0pO1xuICAgICAgICBpZiAoY2xhdXNlLnBhdHRlcm4ubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGNsYXVzZXMucHVzaChjbGF1c2UucGF0dGVybik7XG4gICAgICAgICAgY2xhdXNlVmFsdWVzLnB1c2goLi4uY2xhdXNlLnZhbHVlcyk7XG4gICAgICAgICAgaW5kZXggKz0gY2xhdXNlLnZhbHVlcy5sZW5ndGg7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBvck9yQW5kID0gZmllbGROYW1lID09PSAnJGFuZCcgPyAnIEFORCAnIDogJyBPUiAnO1xuICAgICAgY29uc3Qgbm90ID0gZmllbGROYW1lID09PSAnJG5vcicgPyAnIE5PVCAnIDogJyc7XG5cbiAgICAgIHBhdHRlcm5zLnB1c2goYCR7bm90fSgke2NsYXVzZXMuam9pbihvck9yQW5kKX0pYCk7XG4gICAgICB2YWx1ZXMucHVzaCguLi5jbGF1c2VWYWx1ZXMpO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRuZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgIGZpZWxkVmFsdWUuJG5lID0gSlNPTi5zdHJpbmdpZnkoW2ZpZWxkVmFsdWUuJG5lXSk7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYE5PVCBhcnJheV9jb250YWlucygkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfSlgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmIChmaWVsZFZhbHVlLiRuZSA9PT0gbnVsbCkge1xuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5PVCBOVUxMYCk7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIC8vIGlmIG5vdCBudWxsLCB3ZSBuZWVkIHRvIG1hbnVhbGx5IGV4Y2x1ZGUgbnVsbFxuICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCgkJHtpbmRleH06bmFtZSA8PiAkJHtpbmRleCArIDF9IE9SICQke2luZGV4fTpuYW1lIElTIE5VTEwpYCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gVE9ETzogc3VwcG9ydCBhcnJheXNcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS4kbmUpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG4gICAgaWYgKGZpZWxkVmFsdWUuJGVxICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChmaWVsZFZhbHVlLiRlcSA9PT0gbnVsbCkge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgIGluZGV4ICs9IDE7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLiRlcSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IGlzSW5Pck5pbiA9IEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kaW4pIHx8IEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kbmluKTtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlLiRpbikgJiZcbiAgICAgICAgaXNBcnJheUZpZWxkICYmXG4gICAgICAgIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS5jb250ZW50cyAmJlxuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0uY29udGVudHMudHlwZSA9PT0gJ1N0cmluZycpIHtcbiAgICAgIGNvbnN0IGluUGF0dGVybnMgPSBbXTtcbiAgICAgIGxldCBhbGxvd051bGwgPSBmYWxzZTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBmaWVsZFZhbHVlLiRpbi5mb3JFYWNoKChsaXN0RWxlbSwgbGlzdEluZGV4KSA9PiB7XG4gICAgICAgIGlmIChsaXN0RWxlbSA9PT0gbnVsbCkge1xuICAgICAgICAgIGFsbG93TnVsbCA9IHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2gobGlzdEVsZW0pO1xuICAgICAgICAgIGluUGF0dGVybnMucHVzaChgJCR7aW5kZXggKyAxICsgbGlzdEluZGV4IC0gKGFsbG93TnVsbCA/IDEgOiAwKX1gKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICBpZiAoYWxsb3dOdWxsKSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCgkJHtpbmRleH06bmFtZSBJUyBOVUxMIE9SICQke2luZGV4fTpuYW1lICYmIEFSUkFZWyR7aW5QYXR0ZXJucy5qb2luKCl9XSlgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lICYmIEFSUkFZWyR7aW5QYXR0ZXJucy5qb2luKCl9XWApO1xuICAgICAgfVxuICAgICAgaW5kZXggPSBpbmRleCArIDEgKyBpblBhdHRlcm5zLmxlbmd0aDtcbiAgICB9IGVsc2UgaWYgKGlzSW5Pck5pbikge1xuICAgICAgdmFyIGNyZWF0ZUNvbnN0cmFpbnQgPSAoYmFzZUFycmF5LCBub3RJbikgPT4ge1xuICAgICAgICBpZiAoYmFzZUFycmF5Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBjb25zdCBub3QgPSBub3RJbiA/ICcgTk9UICcgOiAnJztcbiAgICAgICAgICBpZiAoaXNBcnJheUZpZWxkKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAke25vdH0gYXJyYXlfY29udGFpbnMoJCR7aW5kZXh9Om5hbWUsICQke2luZGV4ICsgMX0pYCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGJhc2VBcnJheSkpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gSGFuZGxlIE5lc3RlZCBEb3QgTm90YXRpb24gQWJvdmVcbiAgICAgICAgICAgIGlmIChmaWVsZE5hbWUuaW5kZXhPZignLicpID49IDApIHtcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgY29uc3QgaW5QYXR0ZXJucyA9IFtdO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICAgIGJhc2VBcnJheS5mb3JFYWNoKChsaXN0RWxlbSwgbGlzdEluZGV4KSA9PiB7XG4gICAgICAgICAgICAgIGlmIChsaXN0RWxlbSAhPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGxpc3RFbGVtKTtcbiAgICAgICAgICAgICAgICBpblBhdHRlcm5zLnB1c2goYCQke2luZGV4ICsgMSArIGxpc3RJbmRleH1gKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSAke25vdH0gSU4gKCR7aW5QYXR0ZXJucy5qb2luKCl9KWApO1xuICAgICAgICAgICAgaW5kZXggPSBpbmRleCArIDEgKyBpblBhdHRlcm5zLmxlbmd0aDtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAoIW5vdEluKSB7XG4gICAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lKTtcbiAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSBJUyBOVUxMYCk7XG4gICAgICAgICAgaW5kZXggPSBpbmRleCArIDE7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZFZhbHVlLiRpbikge1xuICAgICAgICBjcmVhdGVDb25zdHJhaW50KF8uZmxhdE1hcChmaWVsZFZhbHVlLiRpbiwgZWx0ID0+IGVsdCksIGZhbHNlKTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZFZhbHVlLiRuaW4pIHtcbiAgICAgICAgY3JlYXRlQ29uc3RyYWludChfLmZsYXRNYXAoZmllbGRWYWx1ZS4kbmluLCBlbHQgPT4gZWx0KSwgdHJ1ZSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmKHR5cGVvZiBmaWVsZFZhbHVlLiRpbiAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGluIHZhbHVlJyk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZS4kbmluICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkbmluIHZhbHVlJyk7XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkoZmllbGRWYWx1ZS4kYWxsKSAmJiBpc0FycmF5RmllbGQpIHtcbiAgICAgIGlmIChpc0FueVZhbHVlUmVnZXhTdGFydHNXaXRoKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgaWYgKCFpc0FsbFZhbHVlc1JlZ2V4T3JOb25lKGZpZWxkVmFsdWUuJGFsbCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnQWxsICRhbGwgdmFsdWVzIG11c3QgYmUgb2YgcmVnZXggdHlwZSBvciBub25lOiAnXG4gICAgICAgICAgICArIGZpZWxkVmFsdWUuJGFsbCk7XG4gICAgICAgIH1cblxuICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGZpZWxkVmFsdWUuJGFsbC5sZW5ndGg7IGkgKz0gMSkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gcHJvY2Vzc1JlZ2V4UGF0dGVybihmaWVsZFZhbHVlLiRhbGxbaV0uJHJlZ2V4KTtcbiAgICAgICAgICBmaWVsZFZhbHVlLiRhbGxbaV0gPSB2YWx1ZS5zdWJzdHJpbmcoMSkgKyAnJSc7XG4gICAgICAgIH1cbiAgICAgICAgcGF0dGVybnMucHVzaChgYXJyYXlfY29udGFpbnNfYWxsX3JlZ2V4KCQke2luZGV4fTpuYW1lLCAkJHtpbmRleCArIDF9Ojpqc29uYilgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYGFycmF5X2NvbnRhaW5zX2FsbCgkJHtpbmRleH06bmFtZSwgJCR7aW5kZXggKyAxfTo6anNvbmIpYCk7XG4gICAgICB9XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUuJGFsbCkpO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGZpZWxkVmFsdWUuJGV4aXN0cyAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIGlmIChmaWVsZFZhbHVlLiRleGlzdHMpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgSVMgTk9UIE5VTExgKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lIElTIE5VTExgKTtcbiAgICAgIH1cbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICBpbmRleCArPSAxO1xuICAgIH1cblxuICAgIGlmIChmaWVsZFZhbHVlLiRjb250YWluZWRCeSkge1xuICAgICAgY29uc3QgYXJyID0gZmllbGRWYWx1ZS4kY29udGFpbmVkQnk7XG4gICAgICBpZiAoIShhcnIgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICRjb250YWluZWRCeTogc2hvdWxkIGJlIGFuIGFycmF5YFxuICAgICAgICApO1xuICAgICAgfVxuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA8QCAkJHtpbmRleCArIDF9Ojpqc29uYmApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShhcnIpKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJHRleHQpIHtcbiAgICAgIGNvbnN0IHNlYXJjaCA9IGZpZWxkVmFsdWUuJHRleHQuJHNlYXJjaDtcbiAgICAgIGxldCBsYW5ndWFnZSA9ICdlbmdsaXNoJztcbiAgICAgIGlmICh0eXBlb2Ygc2VhcmNoICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRzZWFyY2gsIHNob3VsZCBiZSBvYmplY3RgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoIXNlYXJjaC4kdGVybSB8fCB0eXBlb2Ygc2VhcmNoLiR0ZXJtICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICR0ZXJtLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgaWYgKHNlYXJjaC4kbGFuZ3VhZ2UgJiYgdHlwZW9mIHNlYXJjaC4kbGFuZ3VhZ2UgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGxhbmd1YWdlLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGxhbmd1YWdlKSB7XG4gICAgICAgIGxhbmd1YWdlID0gc2VhcmNoLiRsYW5ndWFnZTtcbiAgICAgIH1cbiAgICAgIGlmIChzZWFyY2guJGNhc2VTZW5zaXRpdmUgJiYgdHlwZW9mIHNlYXJjaC4kY2FzZVNlbnNpdGl2ZSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGNhc2VTZW5zaXRpdmUsIHNob3VsZCBiZSBib29sZWFuYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGNhc2VTZW5zaXRpdmUpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkY2FzZVNlbnNpdGl2ZSBub3Qgc3VwcG9ydGVkLCBwbGVhc2UgdXNlICRyZWdleCBvciBjcmVhdGUgYSBzZXBhcmF0ZSBsb3dlciBjYXNlIGNvbHVtbi5gXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgJiYgdHlwZW9mIHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlICE9PSAnYm9vbGVhbicpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICBgYmFkICR0ZXh0OiAkZGlhY3JpdGljU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRkaWFjcml0aWNTZW5zaXRpdmUgPT09IGZhbHNlKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGRpYWNyaXRpY1NlbnNpdGl2ZSAtIGZhbHNlIG5vdCBzdXBwb3J0ZWQsIGluc3RhbGwgUG9zdGdyZXMgVW5hY2NlbnQgRXh0ZW5zaW9uYFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcGF0dGVybnMucHVzaChgdG9fdHN2ZWN0b3IoJCR7aW5kZXh9LCAkJHtpbmRleCArIDF9Om5hbWUpIEBAIHRvX3RzcXVlcnkoJCR7aW5kZXggKyAyfSwgJCR7aW5kZXggKyAzfSlgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGxhbmd1YWdlLCBmaWVsZE5hbWUsIGxhbmd1YWdlLCBzZWFyY2guJHRlcm0pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kbmVhclNwaGVyZSkge1xuICAgICAgY29uc3QgcG9pbnQgPSBmaWVsZFZhbHVlLiRuZWFyU3BoZXJlO1xuICAgICAgY29uc3QgZGlzdGFuY2UgPSBmaWVsZFZhbHVlLiRtYXhEaXN0YW5jZTtcbiAgICAgIGNvbnN0IGRpc3RhbmNlSW5LTSA9IGRpc3RhbmNlICogNjM3MSAqIDEwMDA7XG4gICAgICBwYXR0ZXJucy5wdXNoKGBTVF9EaXN0YW5jZVNwaGVyZSgkJHtpbmRleH06bmFtZTo6Z2VvbWV0cnksIFBPSU5UKCQke2luZGV4ICsgMX0sICQke2luZGV4ICsgMn0pOjpnZW9tZXRyeSkgPD0gJCR7aW5kZXggKyAzfWApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlLCBkaXN0YW5jZUluS00pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kd2l0aGluICYmIGZpZWxkVmFsdWUuJHdpdGhpbi4kYm94KSB7XG4gICAgICBjb25zdCBib3ggPSBmaWVsZFZhbHVlLiR3aXRoaW4uJGJveDtcbiAgICAgIGNvbnN0IGxlZnQgPSBib3hbMF0ubG9uZ2l0dWRlO1xuICAgICAgY29uc3QgYm90dG9tID0gYm94WzBdLmxhdGl0dWRlO1xuICAgICAgY29uc3QgcmlnaHQgPSBib3hbMV0ubG9uZ2l0dWRlO1xuICAgICAgY29uc3QgdG9wID0gYm94WzFdLmxhdGl0dWRlO1xuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZTo6cG9pbnQgPEAgJCR7aW5kZXggKyAxfTo6Ym94YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGAoKCR7bGVmdH0sICR7Ym90dG9tfSksICgke3JpZ2h0fSwgJHt0b3B9KSlgKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuJGdlb1dpdGhpbiAmJiBmaWVsZFZhbHVlLiRnZW9XaXRoaW4uJGNlbnRlclNwaGVyZSkge1xuICAgICAgY29uc3QgY2VudGVyU3BoZXJlID0gZmllbGRWYWx1ZS4kZ2VvV2l0aGluLiRjZW50ZXJTcGhlcmU7XG4gICAgICBpZiAoIShjZW50ZXJTcGhlcmUgaW5zdGFuY2VvZiBBcnJheSkgfHwgY2VudGVyU3BoZXJlLmxlbmd0aCA8IDIpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkY2VudGVyU3BoZXJlIHNob3VsZCBiZSBhbiBhcnJheSBvZiBQYXJzZS5HZW9Qb2ludCBhbmQgZGlzdGFuY2UnKTtcbiAgICAgIH1cbiAgICAgIC8vIEdldCBwb2ludCwgY29udmVydCB0byBnZW8gcG9pbnQgaWYgbmVjZXNzYXJ5IGFuZCB2YWxpZGF0ZVxuICAgICAgbGV0IHBvaW50ID0gY2VudGVyU3BoZXJlWzBdO1xuICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgIHBvaW50ID0gbmV3IFBhcnNlLkdlb1BvaW50KHBvaW50WzFdLCBwb2ludFswXSk7XG4gICAgICB9IGVsc2UgaWYgKCFHZW9Qb2ludENvZGVyLmlzVmFsaWRKU09OKHBvaW50KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZ2VvIHBvaW50IGludmFsaWQnKTtcbiAgICAgIH1cbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludC5sYXRpdHVkZSwgcG9pbnQubG9uZ2l0dWRlKTtcbiAgICAgIC8vIEdldCBkaXN0YW5jZSBhbmQgdmFsaWRhdGVcbiAgICAgIGNvbnN0IGRpc3RhbmNlID0gY2VudGVyU3BoZXJlWzFdO1xuICAgICAgaWYoaXNOYU4oZGlzdGFuY2UpIHx8IGRpc3RhbmNlIDwgMCkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZGlzdGFuY2UgaW52YWxpZCcpO1xuICAgICAgfVxuICAgICAgY29uc3QgZGlzdGFuY2VJbktNID0gZGlzdGFuY2UgKiA2MzcxICogMTAwMDtcbiAgICAgIHBhdHRlcm5zLnB1c2goYFNUX2Rpc3RhbmNlX3NwaGVyZSgkJHtpbmRleH06bmFtZTo6Z2VvbWV0cnksIFBPSU5UKCQke2luZGV4ICsgMX0sICQke2luZGV4ICsgMn0pOjpnZW9tZXRyeSkgPD0gJCR7aW5kZXggKyAzfWApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlLCBkaXN0YW5jZUluS00pO1xuICAgICAgaW5kZXggKz0gNDtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kZ2VvV2l0aGluICYmIGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kcG9seWdvbikge1xuICAgICAgY29uc3QgcG9seWdvbiA9IGZpZWxkVmFsdWUuJGdlb1dpdGhpbi4kcG9seWdvbjtcbiAgICAgIGxldCBwb2ludHM7XG4gICAgICBpZiAodHlwZW9mIHBvbHlnb24gPT09ICdvYmplY3QnICYmIHBvbHlnb24uX190eXBlID09PSAnUG9seWdvbicpIHtcbiAgICAgICAgaWYgKCFwb2x5Z29uLmNvb3JkaW5hdGVzIHx8IHBvbHlnb24uY29vcmRpbmF0ZXMubGVuZ3RoIDwgMykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgUG9seWdvbi5jb29yZGluYXRlcyBzaG91bGQgY29udGFpbiBhdCBsZWFzdCAzIGxvbi9sYXQgcGFpcnMnXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBwb2ludHMgPSBwb2x5Z29uLmNvb3JkaW5hdGVzO1xuICAgICAgfSBlbHNlIGlmICgocG9seWdvbiBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICBpZiAocG9seWdvbi5sZW5ndGggPCAzKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgY29udGFpbiBhdCBsZWFzdCAzIEdlb1BvaW50cydcbiAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgICAgIHBvaW50cyA9IHBvbHlnb247XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJHBvbHlnb24gc2hvdWxkIGJlIFBvbHlnb24gb2JqZWN0IG9yIEFycmF5IG9mIFBhcnNlLkdlb1BvaW50XFwncydcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHBvaW50cyA9IHBvaW50cy5tYXAoKHBvaW50KSA9PiB7XG4gICAgICAgIGlmIChwb2ludCBpbnN0YW5jZW9mIEFycmF5ICYmIHBvaW50Lmxlbmd0aCA9PT0gMikge1xuICAgICAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludFsxXSwgcG9pbnRbMF0pO1xuICAgICAgICAgIHJldHVybiBgKCR7cG9pbnRbMF19LCAke3BvaW50WzFdfSlgO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0eXBlb2YgcG9pbnQgIT09ICdvYmplY3QnIHx8IHBvaW50Ll9fdHlwZSAhPT0gJ0dlb1BvaW50Jykge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGdlb1dpdGhpbiB2YWx1ZScpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludC5sYXRpdHVkZSwgcG9pbnQubG9uZ2l0dWRlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYCgke3BvaW50LmxvbmdpdHVkZX0sICR7cG9pbnQubGF0aXR1ZGV9KWA7XG4gICAgICB9KS5qb2luKCcsICcpO1xuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZTo6cG9pbnQgPEAgJCR7aW5kZXggKyAxfTo6cG9seWdvbmApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBgKCR7cG9pbnRzfSlgKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuICAgIGlmIChmaWVsZFZhbHVlLiRnZW9JbnRlcnNlY3RzICYmIGZpZWxkVmFsdWUuJGdlb0ludGVyc2VjdHMuJHBvaW50KSB7XG4gICAgICBjb25zdCBwb2ludCA9IGZpZWxkVmFsdWUuJGdlb0ludGVyc2VjdHMuJHBvaW50O1xuICAgICAgaWYgKHR5cGVvZiBwb2ludCAhPT0gJ29iamVjdCcgfHwgcG9pbnQuX190eXBlICE9PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2JhZCAkZ2VvSW50ZXJzZWN0IHZhbHVlOyAkcG9pbnQgc2hvdWxkIGJlIEdlb1BvaW50J1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgfVxuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWU6OnBvbHlnb24gQD4gJCR7aW5kZXggKyAxfTo6cG9pbnRgKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgYCgke3BvaW50LmxvbmdpdHVkZX0sICR7cG9pbnQubGF0aXR1ZGV9KWApO1xuICAgICAgaW5kZXggKz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS4kcmVnZXgpIHtcbiAgICAgIGxldCByZWdleCA9IGZpZWxkVmFsdWUuJHJlZ2V4O1xuICAgICAgbGV0IG9wZXJhdG9yID0gJ34nO1xuICAgICAgY29uc3Qgb3B0cyA9IGZpZWxkVmFsdWUuJG9wdGlvbnM7XG4gICAgICBpZiAob3B0cykge1xuICAgICAgICBpZiAob3B0cy5pbmRleE9mKCdpJykgPj0gMCkge1xuICAgICAgICAgIG9wZXJhdG9yID0gJ34qJztcbiAgICAgICAgfVxuICAgICAgICBpZiAob3B0cy5pbmRleE9mKCd4JykgPj0gMCkge1xuICAgICAgICAgIHJlZ2V4ID0gcmVtb3ZlV2hpdGVTcGFjZShyZWdleCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgY29uc3QgbmFtZSA9IHRyYW5zZm9ybURvdEZpZWxkKGZpZWxkTmFtZSk7XG4gICAgICByZWdleCA9IHByb2Nlc3NSZWdleFBhdHRlcm4ocmVnZXgpO1xuXG4gICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06cmF3ICR7b3BlcmF0b3J9ICckJHtpbmRleCArIDF9OnJhdydgKTtcbiAgICAgIHZhbHVlcy5wdXNoKG5hbWUsIHJlZ2V4KTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgIGlmIChpc0FycmF5RmllbGQpIHtcbiAgICAgICAgcGF0dGVybnMucHVzaChgYXJyYXlfY29udGFpbnMoJCR7aW5kZXh9Om5hbWUsICQke2luZGV4ICsgMX0pYCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoW2ZpZWxkVmFsdWVdKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBmaWVsZFZhbHVlLm9iamVjdElkKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdEYXRlJykge1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUuaXNvKTtcbiAgICAgIGluZGV4ICs9IDI7XG4gICAgfVxuXG4gICAgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICBwYXR0ZXJucy5wdXNoKCckJyArIGluZGV4ICsgJzpuYW1lIH49IFBPSU5UKCQnICsgKGluZGV4ICsgMSkgKyAnLCAkJyArIChpbmRleCArIDIpICsgJyknKTtcbiAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5sb25naXR1ZGUsIGZpZWxkVmFsdWUubGF0aXR1ZGUpO1xuICAgICAgaW5kZXggKz0gMztcbiAgICB9XG5cbiAgICBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgY29uc3QgdmFsdWUgPSBjb252ZXJ0UG9seWdvblRvU1FMKGZpZWxkVmFsdWUuY29vcmRpbmF0ZXMpO1xuICAgICAgcGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgfj0gJCR7aW5kZXggKyAxfTo6cG9seWdvbmApO1xuICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCB2YWx1ZSk7XG4gICAgICBpbmRleCArPSAyO1xuICAgIH1cblxuICAgIE9iamVjdC5rZXlzKFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcikuZm9yRWFjaChjbXAgPT4ge1xuICAgICAgaWYgKGZpZWxkVmFsdWVbY21wXSB8fCBmaWVsZFZhbHVlW2NtcF0gPT09IDApIHtcbiAgICAgICAgY29uc3QgcGdDb21wYXJhdG9yID0gUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yW2NtcF07XG4gICAgICAgIHBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lICR7cGdDb21wYXJhdG9yfSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgdG9Qb3N0Z3Jlc1ZhbHVlKGZpZWxkVmFsdWVbY21wXSkpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKGluaXRpYWxQYXR0ZXJuc0xlbmd0aCA9PT0gcGF0dGVybnMubGVuZ3RoKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTiwgYFBvc3RncmVzIGRvZXNuJ3Qgc3VwcG9ydCB0aGlzIHF1ZXJ5IHR5cGUgeWV0ICR7SlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZSl9YCk7XG4gICAgfVxuICB9XG4gIHZhbHVlcyA9IHZhbHVlcy5tYXAodHJhbnNmb3JtVmFsdWUpO1xuICByZXR1cm4geyBwYXR0ZXJuOiBwYXR0ZXJucy5qb2luKCcgQU5EICcpLCB2YWx1ZXMsIHNvcnRzIH07XG59XG5cbmV4cG9ydCBjbGFzcyBQb3N0Z3Jlc1N0b3JhZ2VBZGFwdGVyIGltcGxlbWVudHMgU3RvcmFnZUFkYXB0ZXIge1xuXG4gIGNhblNvcnRPbkpvaW5UYWJsZXM6IGJvb2xlYW47XG5cbiAgLy8gUHJpdmF0ZVxuICBfY29sbGVjdGlvblByZWZpeDogc3RyaW5nO1xuICBfY2xpZW50OiBhbnk7XG4gIF9wZ3A6IGFueTtcblxuICBjb25zdHJ1Y3Rvcih7XG4gICAgdXJpLFxuICAgIGNvbGxlY3Rpb25QcmVmaXggPSAnJyxcbiAgICBkYXRhYmFzZU9wdGlvbnNcbiAgfTogYW55KSB7XG4gICAgdGhpcy5fY29sbGVjdGlvblByZWZpeCA9IGNvbGxlY3Rpb25QcmVmaXg7XG4gICAgY29uc3QgeyBjbGllbnQsIHBncCB9ID0gY3JlYXRlQ2xpZW50KHVyaSwgZGF0YWJhc2VPcHRpb25zKTtcbiAgICB0aGlzLl9jbGllbnQgPSBjbGllbnQ7XG4gICAgdGhpcy5fcGdwID0gcGdwO1xuICAgIHRoaXMuY2FuU29ydE9uSm9pblRhYmxlcyA9IGZhbHNlO1xuICB9XG5cbiAgaGFuZGxlU2h1dGRvd24oKSB7XG4gICAgaWYgKCF0aGlzLl9jbGllbnQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5fY2xpZW50LiRwb29sLmVuZCgpO1xuICB9XG5cbiAgX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHMoY29ubjogYW55KSB7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIHJldHVybiBjb25uLm5vbmUoJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTIFwiX1NDSEVNQVwiICggXCJjbGFzc05hbWVcIiB2YXJDaGFyKDEyMCksIFwic2NoZW1hXCIganNvbmIsIFwiaXNQYXJzZUNsYXNzXCIgYm9vbCwgUFJJTUFSWSBLRVkgKFwiY2xhc3NOYW1lXCIpICknKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IFBvc3RncmVzRHVwbGljYXRlUmVsYXRpb25FcnJvclxuICAgICAgICAgIHx8IGVycm9yLmNvZGUgPT09IFBvc3RncmVzVW5pcXVlSW5kZXhWaW9sYXRpb25FcnJvclxuICAgICAgICAgIHx8IGVycm9yLmNvZGUgPT09IFBvc3RncmVzRHVwbGljYXRlT2JqZWN0RXJyb3IpIHtcbiAgICAgICAgLy8gVGFibGUgYWxyZWFkeSBleGlzdHMsIG11c3QgaGF2ZSBiZWVuIGNyZWF0ZWQgYnkgYSBkaWZmZXJlbnQgcmVxdWVzdC4gSWdub3JlIGVycm9yLlxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIGNsYXNzRXhpc3RzKG5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQub25lKCdTRUxFQ1QgRVhJU1RTIChTRUxFQ1QgMSBGUk9NIGluZm9ybWF0aW9uX3NjaGVtYS50YWJsZXMgV0hFUkUgdGFibGVfbmFtZSA9ICQxKScsIFtuYW1lXSwgYSA9PiBhLmV4aXN0cyk7XG4gIH1cblxuICBzZXRDbGFzc0xldmVsUGVybWlzc2lvbnMoY2xhc3NOYW1lOiBzdHJpbmcsIENMUHM6IGFueSkge1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQudGFzaygnc2V0LWNsYXNzLWxldmVsLXBlcm1pc3Npb25zJywgZnVuY3Rpb24gKiAodCkge1xuICAgICAgeWllbGQgc2VsZi5fZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyh0KTtcbiAgICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWUsICdzY2hlbWEnLCAnY2xhc3NMZXZlbFBlcm1pc3Npb25zJywgSlNPTi5zdHJpbmdpZnkoQ0xQcyldO1xuICAgICAgeWllbGQgdC5ub25lKGBVUERBVEUgXCJfU0NIRU1BXCIgU0VUICQyOm5hbWUgPSBqc29uX29iamVjdF9zZXRfa2V5KCQyOm5hbWUsICQzOjp0ZXh0LCAkNDo6anNvbmIpIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDFgLCB2YWx1ZXMpO1xuICAgIH0pO1xuICB9XG5cbiAgc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoY2xhc3NOYW1lOiBzdHJpbmcsIHN1Ym1pdHRlZEluZGV4ZXM6IGFueSwgZXhpc3RpbmdJbmRleGVzOiBhbnkgPSB7fSwgZmllbGRzOiBhbnksIGNvbm46ID9hbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgaWYgKHN1Ym1pdHRlZEluZGV4ZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMoZXhpc3RpbmdJbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIGV4aXN0aW5nSW5kZXhlcyA9IHsgX2lkXzogeyBfaWQ6IDF9IH07XG4gICAgfVxuICAgIGNvbnN0IGRlbGV0ZWRJbmRleGVzID0gW107XG4gICAgY29uc3QgaW5zZXJ0ZWRJbmRleGVzID0gW107XG4gICAgT2JqZWN0LmtleXMoc3VibWl0dGVkSW5kZXhlcykuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkSW5kZXhlc1tuYW1lXTtcbiAgICAgIGlmIChleGlzdGluZ0luZGV4ZXNbbmFtZV0gJiYgZmllbGQuX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBJbmRleCAke25hbWV9IGV4aXN0cywgY2Fubm90IHVwZGF0ZS5gKTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhpc3RpbmdJbmRleGVzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgSW5kZXggJHtuYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gKTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICBkZWxldGVkSW5kZXhlcy5wdXNoKG5hbWUpO1xuICAgICAgICBkZWxldGUgZXhpc3RpbmdJbmRleGVzW25hbWVdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgT2JqZWN0LmtleXMoZmllbGQpLmZvckVhY2goa2V5ID0+IHtcbiAgICAgICAgICBpZiAoIWZpZWxkcy5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgYEZpZWxkICR7a2V5fSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGFkZCBpbmRleC5gKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBleGlzdGluZ0luZGV4ZXNbbmFtZV0gPSBmaWVsZDtcbiAgICAgICAgaW5zZXJ0ZWRJbmRleGVzLnB1c2goe1xuICAgICAgICAgIGtleTogZmllbGQsXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIGNvbm4udHgoJ3NldC1pbmRleGVzLXdpdGgtc2NoZW1hLWZvcm1hdCcsIGZ1bmN0aW9uICogKHQpIHtcbiAgICAgIGlmIChpbnNlcnRlZEluZGV4ZXMubGVuZ3RoID4gMCkge1xuICAgICAgICB5aWVsZCBzZWxmLmNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lLCBpbnNlcnRlZEluZGV4ZXMsIHQpO1xuICAgICAgfVxuICAgICAgaWYgKGRlbGV0ZWRJbmRleGVzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgeWllbGQgc2VsZi5kcm9wSW5kZXhlcyhjbGFzc05hbWUsIGRlbGV0ZWRJbmRleGVzLCB0KTtcbiAgICAgIH1cbiAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICB5aWVsZCB0Lm5vbmUoJ1VQREFURSBcIl9TQ0hFTUFcIiBTRVQgJDI6bmFtZSA9IGpzb25fb2JqZWN0X3NldF9rZXkoJDI6bmFtZSwgJDM6OnRleHQsICQ0Ojpqc29uYikgV0hFUkUgXCJjbGFzc05hbWVcIj0kMScsIFtjbGFzc05hbWUsICdzY2hlbWEnLCAnaW5kZXhlcycsIEpTT04uc3RyaW5naWZ5KGV4aXN0aW5nSW5kZXhlcyldKTtcbiAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGNvbm46ID9hbnkpIHtcbiAgICBjb25uID0gY29ubiB8fCB0aGlzLl9jbGllbnQ7XG4gICAgcmV0dXJuIGNvbm4udHgoJ2NyZWF0ZS1jbGFzcycsIHQgPT4ge1xuICAgICAgY29uc3QgcTEgPSB0aGlzLmNyZWF0ZVRhYmxlKGNsYXNzTmFtZSwgc2NoZW1hLCB0KTtcbiAgICAgIGNvbnN0IHEyID0gdC5ub25lKCdJTlNFUlQgSU5UTyBcIl9TQ0hFTUFcIiAoXCJjbGFzc05hbWVcIiwgXCJzY2hlbWFcIiwgXCJpc1BhcnNlQ2xhc3NcIikgVkFMVUVTICgkPGNsYXNzTmFtZT4sICQ8c2NoZW1hPiwgdHJ1ZSknLCB7IGNsYXNzTmFtZSwgc2NoZW1hIH0pO1xuICAgICAgY29uc3QgcTMgPSB0aGlzLnNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KGNsYXNzTmFtZSwgc2NoZW1hLmluZGV4ZXMsIHt9LCBzY2hlbWEuZmllbGRzLCB0KTtcbiAgICAgIHJldHVybiB0LmJhdGNoKFtxMSwgcTIsIHEzXSk7XG4gICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRvUGFyc2VTY2hlbWEoc2NoZW1hKTtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgaWYgKGVyci5kYXRhWzBdLnJlc3VsdC5jb2RlID09PSBQb3N0Z3Jlc1RyYW5zYWN0aW9uQWJvcnRlZEVycm9yKSB7XG4gICAgICAgICAgZXJyID0gZXJyLmRhdGFbMV0ucmVzdWx0O1xuICAgICAgICB9XG4gICAgICAgIGlmIChlcnIuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yICYmIGVyci5kZXRhaWwuaW5jbHVkZXMoY2xhc3NOYW1lKSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsIGBDbGFzcyAke2NsYXNzTmFtZX0gYWxyZWFkeSBleGlzdHMuYClcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnI7XG4gICAgICB9KVxuICB9XG5cbiAgLy8gSnVzdCBjcmVhdGUgYSB0YWJsZSwgZG8gbm90IGluc2VydCBpbiBzY2hlbWFcbiAgY3JlYXRlVGFibGUoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgY29ubjogYW55KSB7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIGRlYnVnKCdjcmVhdGVUYWJsZScsIGNsYXNzTmFtZSwgc2NoZW1hKTtcbiAgICBjb25zdCB2YWx1ZXNBcnJheSA9IFtdO1xuICAgIGNvbnN0IHBhdHRlcm5zQXJyYXkgPSBbXTtcbiAgICBjb25zdCBmaWVsZHMgPSBPYmplY3QuYXNzaWduKHt9LCBzY2hlbWEuZmllbGRzKTtcbiAgICBpZiAoY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgICBmaWVsZHMuX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0ID0ge3R5cGU6ICdEYXRlJ307XG4gICAgICBmaWVsZHMuX2VtYWlsX3ZlcmlmeV90b2tlbiA9IHt0eXBlOiAnU3RyaW5nJ307XG4gICAgICBmaWVsZHMuX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0ID0ge3R5cGU6ICdEYXRlJ307XG4gICAgICBmaWVsZHMuX2ZhaWxlZF9sb2dpbl9jb3VudCA9IHt0eXBlOiAnTnVtYmVyJ307XG4gICAgICBmaWVsZHMuX3BlcmlzaGFibGVfdG9rZW4gPSB7dHlwZTogJ1N0cmluZyd9O1xuICAgICAgZmllbGRzLl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQgPSB7dHlwZTogJ0RhdGUnfTtcbiAgICAgIGZpZWxkcy5fcGFzc3dvcmRfY2hhbmdlZF9hdCA9IHt0eXBlOiAnRGF0ZSd9O1xuICAgICAgZmllbGRzLl9wYXNzd29yZF9oaXN0b3J5ID0geyB0eXBlOiAnQXJyYXknfTtcbiAgICB9XG4gICAgbGV0IGluZGV4ID0gMjtcbiAgICBjb25zdCByZWxhdGlvbnMgPSBbXTtcbiAgICBPYmplY3Qua2V5cyhmaWVsZHMpLmZvckVhY2goKGZpZWxkTmFtZSkgPT4ge1xuICAgICAgY29uc3QgcGFyc2VUeXBlID0gZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICAvLyBTa2lwIHdoZW4gaXQncyBhIHJlbGF0aW9uXG4gICAgICAvLyBXZSdsbCBjcmVhdGUgdGhlIHRhYmxlcyBsYXRlclxuICAgICAgaWYgKHBhcnNlVHlwZS50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIHJlbGF0aW9ucy5wdXNoKGZpZWxkTmFtZSlcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgaWYgKFsnX3JwZXJtJywgJ193cGVybSddLmluZGV4T2YoZmllbGROYW1lKSA+PSAwKSB7XG4gICAgICAgIHBhcnNlVHlwZS5jb250ZW50cyA9IHsgdHlwZTogJ1N0cmluZycgfTtcbiAgICAgIH1cbiAgICAgIHZhbHVlc0FycmF5LnB1c2goZmllbGROYW1lKTtcbiAgICAgIHZhbHVlc0FycmF5LnB1c2gocGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUocGFyc2VUeXBlKSk7XG4gICAgICBwYXR0ZXJuc0FycmF5LnB1c2goYCQke2luZGV4fTpuYW1lICQke2luZGV4ICsgMX06cmF3YCk7XG4gICAgICBpZiAoZmllbGROYW1lID09PSAnb2JqZWN0SWQnKSB7XG4gICAgICAgIHBhdHRlcm5zQXJyYXkucHVzaChgUFJJTUFSWSBLRVkgKCQke2luZGV4fTpuYW1lKWApXG4gICAgICB9XG4gICAgICBpbmRleCA9IGluZGV4ICsgMjtcbiAgICB9KTtcbiAgICBjb25zdCBxcyA9IGBDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAkMTpuYW1lICgke3BhdHRlcm5zQXJyYXkuam9pbigpfSlgO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWUsIC4uLnZhbHVlc0FycmF5XTtcblxuICAgIHJldHVybiBjb25uLnRhc2soJ2NyZWF0ZS10YWJsZScsIGZ1bmN0aW9uICogKHQpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHlpZWxkIHNlbGYuX2Vuc3VyZVNjaGVtYUNvbGxlY3Rpb25FeGlzdHModCk7XG4gICAgICAgIHlpZWxkIHQubm9uZShxcywgdmFsdWVzKTtcbiAgICAgIH0gY2F0Y2goZXJyb3IpIHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFBvc3RncmVzRHVwbGljYXRlUmVsYXRpb25FcnJvcikge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICAgIC8vIEVMU0U6IFRhYmxlIGFscmVhZHkgZXhpc3RzLCBtdXN0IGhhdmUgYmVlbiBjcmVhdGVkIGJ5IGEgZGlmZmVyZW50IHJlcXVlc3QuIElnbm9yZSB0aGUgZXJyb3IuXG4gICAgICB9XG4gICAgICB5aWVsZCB0LnR4KCdjcmVhdGUtdGFibGUtdHgnLCB0eCA9PiB7XG4gICAgICAgIHJldHVybiB0eC5iYXRjaChyZWxhdGlvbnMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHR4Lm5vbmUoJ0NSRUFURSBUQUJMRSBJRiBOT1QgRVhJU1RTICQ8am9pblRhYmxlOm5hbWU+IChcInJlbGF0ZWRJZFwiIHZhckNoYXIoMTIwKSwgXCJvd25pbmdJZFwiIHZhckNoYXIoMTIwKSwgUFJJTUFSWSBLRVkoXCJyZWxhdGVkSWRcIiwgXCJvd25pbmdJZFwiKSApJywge2pvaW5UYWJsZTogYF9Kb2luOiR7ZmllbGROYW1lfToke2NsYXNzTmFtZX1gfSk7XG4gICAgICAgIH0pKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgc2NoZW1hVXBncmFkZShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBjb25uOiBhbnkpIHtcbiAgICBkZWJ1Zygnc2NoZW1hVXBncmFkZScsIHsgY2xhc3NOYW1lLCBzY2hlbWEgfSk7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuXG4gICAgcmV0dXJuIGNvbm4udHgoJ3NjaGVtYS11cGdyYWRlJywgZnVuY3Rpb24gKiAodCkge1xuICAgICAgY29uc3QgY29sdW1ucyA9IHlpZWxkIHQubWFwKCdTRUxFQ1QgY29sdW1uX25hbWUgRlJPTSBpbmZvcm1hdGlvbl9zY2hlbWEuY29sdW1ucyBXSEVSRSB0YWJsZV9uYW1lID0gJDxjbGFzc05hbWU+JywgeyBjbGFzc05hbWUgfSwgYSA9PiBhLmNvbHVtbl9uYW1lKTtcbiAgICAgIGNvbnN0IG5ld0NvbHVtbnMgPSBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKVxuICAgICAgICAuZmlsdGVyKGl0ZW0gPT4gY29sdW1ucy5pbmRleE9mKGl0ZW0pID09PSAtMSlcbiAgICAgICAgLm1hcChmaWVsZE5hbWUgPT4gc2VsZi5hZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0sIHQpKTtcblxuICAgICAgeWllbGQgdC5iYXRjaChuZXdDb2x1bW5zKTtcbiAgICB9KTtcbiAgfVxuXG4gIGFkZEZpZWxkSWZOb3RFeGlzdHMoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBhbnksIGNvbm46IGFueSkge1xuICAgIC8vIFRPRE86IE11c3QgYmUgcmV2aXNlZCBmb3IgaW52YWxpZCBsb2dpYy4uLlxuICAgIGRlYnVnKCdhZGRGaWVsZElmTm90RXhpc3RzJywge2NsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlfSk7XG4gICAgY29ubiA9IGNvbm4gfHwgdGhpcy5fY2xpZW50O1xuICAgIGNvbnN0IHNlbGYgPSB0aGlzO1xuICAgIHJldHVybiBjb25uLnR4KCdhZGQtZmllbGQtaWYtbm90LWV4aXN0cycsIGZ1bmN0aW9uICogKHQpIHtcbiAgICAgIGlmICh0eXBlLnR5cGUgIT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICB5aWVsZCB0Lm5vbmUoJ0FMVEVSIFRBQkxFICQ8Y2xhc3NOYW1lOm5hbWU+IEFERCBDT0xVTU4gJDxmaWVsZE5hbWU6bmFtZT4gJDxwb3N0Z3Jlc1R5cGU6cmF3PicsIHtcbiAgICAgICAgICAgIGNsYXNzTmFtZSxcbiAgICAgICAgICAgIGZpZWxkTmFtZSxcbiAgICAgICAgICAgIHBvc3RncmVzVHlwZTogcGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUodHlwZSlcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSBjYXRjaChlcnJvcikge1xuICAgICAgICAgIGlmIChlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICAgIHJldHVybiB5aWVsZCBzZWxmLmNyZWF0ZUNsYXNzKGNsYXNzTmFtZSwge2ZpZWxkczoge1tmaWVsZE5hbWVdOiB0eXBlfX0sIHQpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZXJyb3IuY29kZSAhPT0gUG9zdGdyZXNEdXBsaWNhdGVDb2x1bW5FcnJvcikge1xuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgfVxuICAgICAgICAgIC8vIENvbHVtbiBhbHJlYWR5IGV4aXN0cywgY3JlYXRlZCBieSBvdGhlciByZXF1ZXN0LiBDYXJyeSBvbiB0byBzZWUgaWYgaXQncyB0aGUgcmlnaHQgdHlwZS5cbiAgICAgICAgfVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgeWllbGQgdC5ub25lKCdDUkVBVEUgVEFCTEUgSUYgTk9UIEVYSVNUUyAkPGpvaW5UYWJsZTpuYW1lPiAoXCJyZWxhdGVkSWRcIiB2YXJDaGFyKDEyMCksIFwib3duaW5nSWRcIiB2YXJDaGFyKDEyMCksIFBSSU1BUlkgS0VZKFwicmVsYXRlZElkXCIsIFwib3duaW5nSWRcIikgKScsIHtqb2luVGFibGU6IGBfSm9pbjoke2ZpZWxkTmFtZX06JHtjbGFzc05hbWV9YH0pO1xuICAgICAgfVxuXG4gICAgICBjb25zdCByZXN1bHQgPSB5aWVsZCB0LmFueSgnU0VMRUNUIFwic2NoZW1hXCIgRlJPTSBcIl9TQ0hFTUFcIiBXSEVSRSBcImNsYXNzTmFtZVwiID0gJDxjbGFzc05hbWU+IGFuZCAoXCJzY2hlbWFcIjo6anNvbi0+XFwnZmllbGRzXFwnLT4kPGZpZWxkTmFtZT4pIGlzIG5vdCBudWxsJywge2NsYXNzTmFtZSwgZmllbGROYW1lfSk7XG5cbiAgICAgIGlmIChyZXN1bHRbMF0pIHtcbiAgICAgICAgdGhyb3cgJ0F0dGVtcHRlZCB0byBhZGQgYSBmaWVsZCB0aGF0IGFscmVhZHkgZXhpc3RzJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBge2ZpZWxkcywke2ZpZWxkTmFtZX19YDtcbiAgICAgICAgeWllbGQgdC5ub25lKCdVUERBVEUgXCJfU0NIRU1BXCIgU0VUIFwic2NoZW1hXCI9anNvbmJfc2V0KFwic2NoZW1hXCIsICQ8cGF0aD4sICQ8dHlwZT4pICBXSEVSRSBcImNsYXNzTmFtZVwiPSQ8Y2xhc3NOYW1lPicsIHtwYXRoLCB0eXBlLCBjbGFzc05hbWV9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIC8vIERyb3BzIGEgY29sbGVjdGlvbi4gUmVzb2x2ZXMgd2l0aCB0cnVlIGlmIGl0IHdhcyBhIFBhcnNlIFNjaGVtYSAoZWcuIF9Vc2VyLCBDdXN0b20sIGV0Yy4pXG4gIC8vIGFuZCByZXNvbHZlcyB3aXRoIGZhbHNlIGlmIGl0IHdhc24ndCAoZWcuIGEgam9pbiB0YWJsZSkuIFJlamVjdHMgaWYgZGVsZXRpb24gd2FzIGltcG9zc2libGUuXG4gIGRlbGV0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgY29uc3Qgb3BlcmF0aW9ucyA9IFtcbiAgICAgIHtxdWVyeTogYERST1AgVEFCTEUgSUYgRVhJU1RTICQxOm5hbWVgLCB2YWx1ZXM6IFtjbGFzc05hbWVdfSxcbiAgICAgIHtxdWVyeTogYERFTEVURSBGUk9NIFwiX1NDSEVNQVwiIFdIRVJFIFwiY2xhc3NOYW1lXCIgPSAkMWAsIHZhbHVlczogW2NsYXNzTmFtZV19XG4gICAgXTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LnR4KHQgPT4gdC5ub25lKHRoaXMuX3BncC5oZWxwZXJzLmNvbmNhdChvcGVyYXRpb25zKSkpXG4gICAgICAudGhlbigoKSA9PiBjbGFzc05hbWUuaW5kZXhPZignX0pvaW46JykgIT0gMCk7IC8vIHJlc29sdmVzIHdpdGggZmFsc2Ugd2hlbiBfSm9pbiB0YWJsZVxuICB9XG5cbiAgLy8gRGVsZXRlIGFsbCBkYXRhIGtub3duIHRvIHRoaXMgYWRhcHRlci4gVXNlZCBmb3IgdGVzdGluZy5cbiAgZGVsZXRlQWxsQ2xhc3NlcygpIHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbiAgICBjb25zdCBoZWxwZXJzID0gdGhpcy5fcGdwLmhlbHBlcnM7XG4gICAgZGVidWcoJ2RlbGV0ZUFsbENsYXNzZXMnKTtcblxuICAgIHJldHVybiB0aGlzLl9jbGllbnQudGFzaygnZGVsZXRlLWFsbC1jbGFzc2VzJywgZnVuY3Rpb24gKiAodCkge1xuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgcmVzdWx0cyA9IHlpZWxkIHQuYW55KCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiJyk7XG4gICAgICAgIGNvbnN0IGpvaW5zID0gcmVzdWx0cy5yZWR1Y2UoKGxpc3Q6IEFycmF5PHN0cmluZz4sIHNjaGVtYTogYW55KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGxpc3QuY29uY2F0KGpvaW5UYWJsZXNGb3JTY2hlbWEoc2NoZW1hLnNjaGVtYSkpO1xuICAgICAgICB9LCBbXSk7XG4gICAgICAgIGNvbnN0IGNsYXNzZXMgPSBbJ19TQ0hFTUEnLCAnX1B1c2hTdGF0dXMnLCAnX0pvYlN0YXR1cycsICdfSm9iU2NoZWR1bGUnLCAnX0hvb2tzJywgJ19HbG9iYWxDb25maWcnLCAnX0F1ZGllbmNlJywgLi4ucmVzdWx0cy5tYXAocmVzdWx0ID0+IHJlc3VsdC5jbGFzc05hbWUpLCAuLi5qb2luc107XG4gICAgICAgIGNvbnN0IHF1ZXJpZXMgPSBjbGFzc2VzLm1hcChjbGFzc05hbWUgPT4gKHtxdWVyeTogJ0RST1AgVEFCTEUgSUYgRVhJU1RTICQ8Y2xhc3NOYW1lOm5hbWU+JywgdmFsdWVzOiB7Y2xhc3NOYW1lfX0pKTtcbiAgICAgICAgeWllbGQgdC50eCh0eCA9PiB0eC5ub25lKGhlbHBlcnMuY29uY2F0KHF1ZXJpZXMpKSk7XG4gICAgICB9IGNhdGNoKGVycm9yKSB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBObyBfU0NIRU1BIGNvbGxlY3Rpb24uIERvbid0IGRlbGV0ZSBhbnl0aGluZy5cbiAgICAgIH1cbiAgICB9KVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICBkZWJ1ZyhgZGVsZXRlQWxsQ2xhc3NlcyBkb25lIGluICR7bmV3IERhdGUoKS5nZXRUaW1lKCkgLSBub3d9YCk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFJlbW92ZSB0aGUgY29sdW1uIGFuZCBhbGwgdGhlIGRhdGEuIEZvciBSZWxhdGlvbnMsIHRoZSBfSm9pbiBjb2xsZWN0aW9uIGlzIGhhbmRsZWRcbiAgLy8gc3BlY2lhbGx5LCB0aGlzIGZ1bmN0aW9uIGRvZXMgbm90IGRlbGV0ZSBfSm9pbiBjb2x1bW5zLiBJdCBzaG91bGQsIGhvd2V2ZXIsIGluZGljYXRlXG4gIC8vIHRoYXQgdGhlIHJlbGF0aW9uIGZpZWxkcyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBJbiBtb25nbywgdGhpcyBtZWFucyByZW1vdmluZyBpdCBmcm9tXG4gIC8vIHRoZSBfU0NIRU1BIGNvbGxlY3Rpb24uICBUaGVyZSBzaG91bGQgYmUgbm8gYWN0dWFsIGRhdGEgaW4gdGhlIGNvbGxlY3Rpb24gdW5kZXIgdGhlIHNhbWUgbmFtZVxuICAvLyBhcyB0aGUgcmVsYXRpb24gY29sdW1uLCBzbyBpdCdzIGZpbmUgdG8gYXR0ZW1wdCB0byBkZWxldGUgaXQuIElmIHRoZSBmaWVsZHMgbGlzdGVkIHRvIGJlXG4gIC8vIGRlbGV0ZWQgZG8gbm90IGV4aXN0LCB0aGlzIGZ1bmN0aW9uIHNob3VsZCByZXR1cm4gc3VjY2Vzc2Z1bGx5IGFueXdheXMuIENoZWNraW5nIGZvclxuICAvLyBhdHRlbXB0cyB0byBkZWxldGUgbm9uLWV4aXN0ZW50IGZpZWxkcyBpcyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgUGFyc2UgU2VydmVyLlxuXG4gIC8vIFRoaXMgZnVuY3Rpb24gaXMgbm90IG9ibGlnYXRlZCB0byBkZWxldGUgZmllbGRzIGF0b21pY2FsbHkuIEl0IGlzIGdpdmVuIHRoZSBmaWVsZFxuICAvLyBuYW1lcyBpbiBhIGxpc3Qgc28gdGhhdCBkYXRhYmFzZXMgdGhhdCBhcmUgY2FwYWJsZSBvZiBkZWxldGluZyBmaWVsZHMgYXRvbWljYWxseVxuICAvLyBtYXkgZG8gc28uXG5cbiAgLy8gUmV0dXJucyBhIFByb21pc2UuXG4gIGRlbGV0ZUZpZWxkcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBmaWVsZE5hbWVzOiBzdHJpbmdbXSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGRlYnVnKCdkZWxldGVGaWVsZHMnLCBjbGFzc05hbWUsIGZpZWxkTmFtZXMpO1xuICAgIGZpZWxkTmFtZXMgPSBmaWVsZE5hbWVzLnJlZHVjZSgobGlzdDogQXJyYXk8c3RyaW5nPiwgZmllbGROYW1lOiBzdHJpbmcpID0+IHtcbiAgICAgIGNvbnN0IGZpZWxkID0gc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdXG4gICAgICBpZiAoZmllbGQudHlwZSAhPT0gJ1JlbGF0aW9uJykge1xuICAgICAgICBsaXN0LnB1c2goZmllbGROYW1lKTtcbiAgICAgIH1cbiAgICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV07XG4gICAgICByZXR1cm4gbGlzdDtcbiAgICB9LCBbXSk7XG5cbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAuLi5maWVsZE5hbWVzXTtcbiAgICBjb25zdCBjb2x1bW5zID0gZmllbGROYW1lcy5tYXAoKG5hbWUsIGlkeCkgPT4ge1xuICAgICAgcmV0dXJuIGAkJHtpZHggKyAyfTpuYW1lYDtcbiAgICB9KS5qb2luKCcsIERST1AgQ09MVU1OJyk7XG5cbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LnR4KCdkZWxldGUtZmllbGRzJywgZnVuY3Rpb24gKiAodCkge1xuICAgICAgeWllbGQgdC5ub25lKCdVUERBVEUgXCJfU0NIRU1BXCIgU0VUIFwic2NoZW1hXCI9JDxzY2hlbWE+IFdIRVJFIFwiY2xhc3NOYW1lXCI9JDxjbGFzc05hbWU+Jywge3NjaGVtYSwgY2xhc3NOYW1lfSk7XG4gICAgICBpZiAodmFsdWVzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgeWllbGQgdC5ub25lKGBBTFRFUiBUQUJMRSAkMTpuYW1lIERST1AgQ09MVU1OICR7Y29sdW1uc31gLCB2YWx1ZXMpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgYWxsIHNjaGVtYXMga25vd24gdG8gdGhpcyBhZGFwdGVyLCBpbiBQYXJzZSBmb3JtYXQuIEluIGNhc2UgdGhlXG4gIC8vIHNjaGVtYXMgY2Fubm90IGJlIHJldHJpZXZlZCwgcmV0dXJucyBhIHByb21pc2UgdGhhdCByZWplY3RzLiBSZXF1aXJlbWVudHMgZm9yIHRoZVxuICAvLyByZWplY3Rpb24gcmVhc29uIGFyZSBUQkQuXG4gIGdldEFsbENsYXNzZXMoKSB7XG4gICAgY29uc3Qgc2VsZiA9IHRoaXM7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC50YXNrKCdnZXQtYWxsLWNsYXNzZXMnLCBmdW5jdGlvbiAqICh0KSB7XG4gICAgICB5aWVsZCBzZWxmLl9lbnN1cmVTY2hlbWFDb2xsZWN0aW9uRXhpc3RzKHQpO1xuICAgICAgcmV0dXJuIHlpZWxkIHQubWFwKCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiJywgbnVsbCwgcm93ID0+IHRvUGFyc2VTY2hlbWEoeyBjbGFzc05hbWU6IHJvdy5jbGFzc05hbWUsIC4uLnJvdy5zY2hlbWEgfSkpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gUmV0dXJuIGEgcHJvbWlzZSBmb3IgdGhlIHNjaGVtYSB3aXRoIHRoZSBnaXZlbiBuYW1lLCBpbiBQYXJzZSBmb3JtYXQuIElmXG4gIC8vIHRoaXMgYWRhcHRlciBkb2Vzbid0IGtub3cgYWJvdXQgdGhlIHNjaGVtYSwgcmV0dXJuIGEgcHJvbWlzZSB0aGF0IHJlamVjdHMgd2l0aFxuICAvLyB1bmRlZmluZWQgYXMgdGhlIHJlYXNvbi5cbiAgZ2V0Q2xhc3MoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICBkZWJ1ZygnZ2V0Q2xhc3MnLCBjbGFzc05hbWUpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQuYW55KCdTRUxFQ1QgKiBGUk9NIFwiX1NDSEVNQVwiIFdIRVJFIFwiY2xhc3NOYW1lXCI9JDxjbGFzc05hbWU+JywgeyBjbGFzc05hbWUgfSlcbiAgICAgIC50aGVuKHJlc3VsdCA9PiB7XG4gICAgICAgIGlmIChyZXN1bHQubGVuZ3RoICE9PSAxKSB7XG4gICAgICAgICAgdGhyb3cgdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiByZXN1bHRbMF0uc2NoZW1hO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHRvUGFyc2VTY2hlbWEpO1xuICB9XG5cbiAgLy8gVE9ETzogcmVtb3ZlIHRoZSBtb25nbyBmb3JtYXQgZGVwZW5kZW5jeSBpbiB0aGUgcmV0dXJuIHZhbHVlXG4gIGNyZWF0ZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBvYmplY3Q6IGFueSkge1xuICAgIGRlYnVnKCdjcmVhdGVPYmplY3QnLCBjbGFzc05hbWUsIG9iamVjdCk7XG4gICAgbGV0IGNvbHVtbnNBcnJheSA9IFtdO1xuICAgIGNvbnN0IHZhbHVlc0FycmF5ID0gW107XG4gICAgc2NoZW1hID0gdG9Qb3N0Z3Jlc1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IGdlb1BvaW50cyA9IHt9O1xuXG4gICAgb2JqZWN0ID0gaGFuZGxlRG90RmllbGRzKG9iamVjdCk7XG5cbiAgICB2YWxpZGF0ZUtleXMob2JqZWN0KTtcblxuICAgIE9iamVjdC5rZXlzKG9iamVjdCkuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdID09PSBudWxsKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHZhciBhdXRoRGF0YU1hdGNoID0gZmllbGROYW1lLm1hdGNoKC9eX2F1dGhfZGF0YV8oW2EtekEtWjAtOV9dKykkLyk7XG4gICAgICBpZiAoYXV0aERhdGFNYXRjaCkge1xuICAgICAgICB2YXIgcHJvdmlkZXIgPSBhdXRoRGF0YU1hdGNoWzFdO1xuICAgICAgICBvYmplY3RbJ2F1dGhEYXRhJ10gPSBvYmplY3RbJ2F1dGhEYXRhJ10gfHwge307XG4gICAgICAgIG9iamVjdFsnYXV0aERhdGEnXVtwcm92aWRlcl0gPSBvYmplY3RbZmllbGROYW1lXTtcbiAgICAgICAgZGVsZXRlIG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgICBmaWVsZE5hbWUgPSAnYXV0aERhdGEnO1xuICAgICAgfVxuXG4gICAgICBjb2x1bW5zQXJyYXkucHVzaChmaWVsZE5hbWUpO1xuICAgICAgaWYgKCFzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgICAgIGlmIChmaWVsZE5hbWUgPT09ICdfZW1haWxfdmVyaWZ5X3Rva2VuJyB8fFxuICAgICAgICAgICAgZmllbGROYW1lID09PSAnX2ZhaWxlZF9sb2dpbl9jb3VudCcgfHxcbiAgICAgICAgICAgIGZpZWxkTmFtZSA9PT0gJ19wZXJpc2hhYmxlX3Rva2VuJyB8fFxuICAgICAgICAgICAgZmllbGROYW1lID09PSAnX3Bhc3N3b3JkX2hpc3RvcnknKXtcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmaWVsZE5hbWUgPT09ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnKSB7XG4gICAgICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLmlzbyk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gobnVsbCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGZpZWxkTmFtZSA9PT0gJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcgfHxcbiAgICAgICAgICAgIGZpZWxkTmFtZSA9PT0gJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnIHx8XG4gICAgICAgICAgICBmaWVsZE5hbWUgPT09ICdfcGFzc3dvcmRfY2hhbmdlZF9hdCcpIHtcbiAgICAgICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0uaXNvKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChudWxsKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgc3dpdGNoIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSkge1xuICAgICAgY2FzZSAnRGF0ZSc6XG4gICAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSkge1xuICAgICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0uaXNvKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG51bGwpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnUG9pbnRlcic6XG4gICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0ub2JqZWN0SWQpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0FycmF5JzpcbiAgICAgICAgaWYgKFsnX3JwZXJtJywgJ193cGVybSddLmluZGV4T2YoZmllbGROYW1lKSA+PSAwKSB7XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChvYmplY3RbZmllbGROYW1lXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFsdWVzQXJyYXkucHVzaChKU09OLnN0cmluZ2lmeShvYmplY3RbZmllbGROYW1lXSkpO1xuICAgICAgICB9XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnT2JqZWN0JzpcbiAgICAgIGNhc2UgJ0J5dGVzJzpcbiAgICAgIGNhc2UgJ1N0cmluZyc6XG4gICAgICBjYXNlICdOdW1iZXInOlxuICAgICAgY2FzZSAnQm9vbGVhbic6XG4gICAgICAgIHZhbHVlc0FycmF5LnB1c2gob2JqZWN0W2ZpZWxkTmFtZV0pO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ0ZpbGUnOlxuICAgICAgICB2YWx1ZXNBcnJheS5wdXNoKG9iamVjdFtmaWVsZE5hbWVdLm5hbWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1BvbHlnb24nOiB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gY29udmVydFBvbHlnb25Ub1NRTChvYmplY3RbZmllbGROYW1lXS5jb29yZGluYXRlcyk7XG4gICAgICAgIHZhbHVlc0FycmF5LnB1c2godmFsdWUpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICAgIGNhc2UgJ0dlb1BvaW50JzpcbiAgICAgICAgLy8gcG9wIHRoZSBwb2ludCBhbmQgcHJvY2VzcyBsYXRlclxuICAgICAgICBnZW9Qb2ludHNbZmllbGROYW1lXSA9IG9iamVjdFtmaWVsZE5hbWVdO1xuICAgICAgICBjb2x1bW5zQXJyYXkucG9wKCk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgYFR5cGUgJHtzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZX0gbm90IHN1cHBvcnRlZCB5ZXRgO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgY29sdW1uc0FycmF5ID0gY29sdW1uc0FycmF5LmNvbmNhdChPYmplY3Qua2V5cyhnZW9Qb2ludHMpKTtcbiAgICBjb25zdCBpbml0aWFsVmFsdWVzID0gdmFsdWVzQXJyYXkubWFwKCh2YWwsIGluZGV4KSA9PiB7XG4gICAgICBsZXQgdGVybWluYXRpb24gPSAnJztcbiAgICAgIGNvbnN0IGZpZWxkTmFtZSA9IGNvbHVtbnNBcnJheVtpbmRleF07XG4gICAgICBpZiAoWydfcnBlcm0nLCdfd3Blcm0nXS5pbmRleE9mKGZpZWxkTmFtZSkgPj0gMCkge1xuICAgICAgICB0ZXJtaW5hdGlvbiA9ICc6OnRleHRbXSc7XG4gICAgICB9IGVsc2UgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5Jykge1xuICAgICAgICB0ZXJtaW5hdGlvbiA9ICc6Ompzb25iJztcbiAgICAgIH1cbiAgICAgIHJldHVybiBgJCR7aW5kZXggKyAyICsgY29sdW1uc0FycmF5Lmxlbmd0aH0ke3Rlcm1pbmF0aW9ufWA7XG4gICAgfSk7XG4gICAgY29uc3QgZ2VvUG9pbnRzSW5qZWN0cyA9IE9iamVjdC5rZXlzKGdlb1BvaW50cykubWFwKChrZXkpID0+IHtcbiAgICAgIGNvbnN0IHZhbHVlID0gZ2VvUG9pbnRzW2tleV07XG4gICAgICB2YWx1ZXNBcnJheS5wdXNoKHZhbHVlLmxvbmdpdHVkZSwgdmFsdWUubGF0aXR1ZGUpO1xuICAgICAgY29uc3QgbCA9IHZhbHVlc0FycmF5Lmxlbmd0aCArIGNvbHVtbnNBcnJheS5sZW5ndGg7XG4gICAgICByZXR1cm4gYFBPSU5UKCQke2x9LCAkJHtsICsgMX0pYDtcbiAgICB9KTtcblxuICAgIGNvbnN0IGNvbHVtbnNQYXR0ZXJuID0gY29sdW1uc0FycmF5Lm1hcCgoY29sLCBpbmRleCkgPT4gYCQke2luZGV4ICsgMn06bmFtZWApLmpvaW4oKTtcbiAgICBjb25zdCB2YWx1ZXNQYXR0ZXJuID0gaW5pdGlhbFZhbHVlcy5jb25jYXQoZ2VvUG9pbnRzSW5qZWN0cykuam9pbigpXG5cbiAgICBjb25zdCBxcyA9IGBJTlNFUlQgSU5UTyAkMTpuYW1lICgke2NvbHVtbnNQYXR0ZXJufSkgVkFMVUVTICgke3ZhbHVlc1BhdHRlcm59KWBcbiAgICBjb25zdCB2YWx1ZXMgPSBbY2xhc3NOYW1lLCAuLi5jb2x1bW5zQXJyYXksIC4uLnZhbHVlc0FycmF5XVxuICAgIGRlYnVnKHFzLCB2YWx1ZXMpO1xuICAgIHJldHVybiB0aGlzLl9jbGllbnQubm9uZShxcywgdmFsdWVzKVxuICAgICAgLnRoZW4oKCkgPT4gKHsgb3BzOiBbb2JqZWN0XSB9KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSBQb3N0Z3Jlc1VuaXF1ZUluZGV4VmlvbGF0aW9uRXJyb3IpIHtcbiAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCcpO1xuICAgICAgICAgIGVyci51bmRlcmx5aW5nRXJyb3IgPSBlcnJvcjtcbiAgICAgICAgICBpZiAoZXJyb3IuY29uc3RyYWludCkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGVycm9yLmNvbnN0cmFpbnQubWF0Y2goL3VuaXF1ZV8oW2EtekEtWl0rKS8pO1xuICAgICAgICAgICAgaWYgKG1hdGNoZXMgJiYgQXJyYXkuaXNBcnJheShtYXRjaGVzKSkge1xuICAgICAgICAgICAgICBlcnIudXNlckluZm8gPSB7IGR1cGxpY2F0ZWRfZmllbGQ6IG1hdGNoZXNbMV0gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgZXJyb3IgPSBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFJlbW92ZSBhbGwgb2JqZWN0cyB0aGF0IG1hdGNoIHRoZSBnaXZlbiBQYXJzZSBRdWVyeS5cbiAgLy8gSWYgbm8gb2JqZWN0cyBtYXRjaCwgcmVqZWN0IHdpdGggT0JKRUNUX05PVF9GT1VORC4gSWYgb2JqZWN0cyBhcmUgZm91bmQgYW5kIGRlbGV0ZWQsIHJlc29sdmUgd2l0aCB1bmRlZmluZWQuXG4gIC8vIElmIHRoZXJlIGlzIHNvbWUgb3RoZXIgZXJyb3IsIHJlamVjdCB3aXRoIElOVEVSTkFMX1NFUlZFUl9FUlJPUi5cbiAgZGVsZXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSkge1xuICAgIGRlYnVnKCdkZWxldGVPYmplY3RzQnlRdWVyeScsIGNsYXNzTmFtZSwgcXVlcnkpO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWVdO1xuICAgIGNvbnN0IGluZGV4ID0gMjtcbiAgICBjb25zdCB3aGVyZSA9IGJ1aWxkV2hlcmVDbGF1c2UoeyBzY2hlbWEsIGluZGV4LCBxdWVyeSB9KVxuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG4gICAgaWYgKE9iamVjdC5rZXlzKHF1ZXJ5KS5sZW5ndGggPT09IDApIHtcbiAgICAgIHdoZXJlLnBhdHRlcm4gPSAnVFJVRSc7XG4gICAgfVxuICAgIGNvbnN0IHFzID0gYFdJVEggZGVsZXRlZCBBUyAoREVMRVRFIEZST00gJDE6bmFtZSBXSEVSRSAke3doZXJlLnBhdHRlcm59IFJFVFVSTklORyAqKSBTRUxFQ1QgY291bnQoKikgRlJPTSBkZWxldGVkYDtcbiAgICBkZWJ1ZyhxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm9uZShxcywgdmFsdWVzICwgYSA9PiArYS5jb3VudClcbiAgICAgIC50aGVuKGNvdW50ID0+IHtcbiAgICAgICAgaWYgKGNvdW50ID09PSAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQsICdPYmplY3Qgbm90IGZvdW5kLicpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiBjb3VudDtcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICAvLyBFTFNFOiBEb24ndCBkZWxldGUgYW55dGhpbmcgaWYgZG9lc24ndCBleGlzdFxuICAgICAgfSk7XG4gIH1cbiAgLy8gUmV0dXJuIHZhbHVlIG5vdCBjdXJyZW50bHkgd2VsbCBzcGVjaWZpZWQuXG4gIGZpbmRPbmVBbmRVcGRhdGUoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgdXBkYXRlOiBhbnkpOiBQcm9taXNlPGFueT4ge1xuICAgIGRlYnVnKCdmaW5kT25lQW5kVXBkYXRlJywgY2xhc3NOYW1lLCBxdWVyeSwgdXBkYXRlKTtcbiAgICByZXR1cm4gdGhpcy51cGRhdGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIHVwZGF0ZSlcbiAgICAgIC50aGVuKCh2YWwpID0+IHZhbFswXSk7XG4gIH1cblxuICAvLyBBcHBseSB0aGUgdXBkYXRlIHRvIGFsbCBvYmplY3RzIHRoYXQgbWF0Y2ggdGhlIGdpdmVuIFBhcnNlIFF1ZXJ5LlxuICB1cGRhdGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB1cGRhdGU6IGFueSk6IFByb21pc2U8W2FueV0+IHtcbiAgICBkZWJ1ZygndXBkYXRlT2JqZWN0c0J5UXVlcnknLCBjbGFzc05hbWUsIHF1ZXJ5LCB1cGRhdGUpO1xuICAgIGNvbnN0IHVwZGF0ZVBhdHRlcm5zID0gW107XG4gICAgY29uc3QgdmFsdWVzID0gW2NsYXNzTmFtZV1cbiAgICBsZXQgaW5kZXggPSAyO1xuICAgIHNjaGVtYSA9IHRvUG9zdGdyZXNTY2hlbWEoc2NoZW1hKTtcblxuICAgIGNvbnN0IG9yaWdpbmFsVXBkYXRlID0gey4uLnVwZGF0ZX07XG4gICAgdXBkYXRlID0gaGFuZGxlRG90RmllbGRzKHVwZGF0ZSk7XG4gICAgLy8gUmVzb2x2ZSBhdXRoRGF0YSBmaXJzdCxcbiAgICAvLyBTbyB3ZSBkb24ndCBlbmQgdXAgd2l0aCBtdWx0aXBsZSBrZXkgdXBkYXRlc1xuICAgIGZvciAoY29uc3QgZmllbGROYW1lIGluIHVwZGF0ZSkge1xuICAgICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGZpZWxkTmFtZS5tYXRjaCgvXl9hdXRoX2RhdGFfKFthLXpBLVowLTlfXSspJC8pO1xuICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgdmFyIHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgICAgY29uc3QgdmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgICAgZGVsZXRlIHVwZGF0ZVtmaWVsZE5hbWVdO1xuICAgICAgICB1cGRhdGVbJ2F1dGhEYXRhJ10gPSB1cGRhdGVbJ2F1dGhEYXRhJ10gfHwge307XG4gICAgICAgIHVwZGF0ZVsnYXV0aERhdGEnXVtwcm92aWRlcl0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiB1cGRhdGUpIHtcbiAgICAgIGNvbnN0IGZpZWxkVmFsdWUgPSB1cGRhdGVbZmllbGROYW1lXTtcbiAgICAgIGlmIChmaWVsZFZhbHVlID09PSBudWxsKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gTlVMTGApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUpO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZE5hbWUgPT0gJ2F1dGhEYXRhJykge1xuICAgICAgICAvLyBUaGlzIHJlY3Vyc2l2ZWx5IHNldHMgdGhlIGpzb25fb2JqZWN0XG4gICAgICAgIC8vIE9ubHkgMSBsZXZlbCBkZWVwXG4gICAgICAgIGNvbnN0IGdlbmVyYXRlID0gKGpzb25iOiBzdHJpbmcsIGtleTogc3RyaW5nLCB2YWx1ZTogYW55KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGBqc29uX29iamVjdF9zZXRfa2V5KENPQUxFU0NFKCR7anNvbmJ9LCAne30nOjpqc29uYiksICR7a2V5fSwgJHt2YWx1ZX0pOjpqc29uYmA7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgbGFzdEtleSA9IGAkJHtpbmRleH06bmFtZWA7XG4gICAgICAgIGNvbnN0IGZpZWxkTmFtZUluZGV4ID0gaW5kZXg7XG4gICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSk7XG4gICAgICAgIGNvbnN0IHVwZGF0ZSA9IE9iamVjdC5rZXlzKGZpZWxkVmFsdWUpLnJlZHVjZSgobGFzdEtleTogc3RyaW5nLCBrZXk6IHN0cmluZykgPT4ge1xuICAgICAgICAgIGNvbnN0IHN0ciA9IGdlbmVyYXRlKGxhc3RLZXksIGAkJHtpbmRleH06OnRleHRgLCBgJCR7aW5kZXggKyAxfTo6anNvbmJgKVxuICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgbGV0IHZhbHVlID0gZmllbGRWYWx1ZVtrZXldO1xuICAgICAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKHZhbHVlLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gbnVsbDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIHZhbHVlID0gSlNPTi5zdHJpbmdpZnkodmFsdWUpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIHZhbHVlcy5wdXNoKGtleSwgdmFsdWUpO1xuICAgICAgICAgIHJldHVybiBzdHI7XG4gICAgICAgIH0sIGxhc3RLZXkpO1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtmaWVsZE5hbWVJbmRleH06bmFtZSA9ICR7dXBkYXRlfWApO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdJbmNyZW1lbnQnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUsIDApICsgJCR7aW5kZXggKyAxfWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUuYW1vdW50KTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnQWRkJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IGFycmF5X2FkZChDT0FMRVNDRSgkJHtpbmRleH06bmFtZSwgJ1tdJzo6anNvbmIpLCAkJHtpbmRleCArIDF9Ojpqc29uYilgKTtcbiAgICAgICAgdmFsdWVzLnB1c2goZmllbGROYW1lLCBKU09OLnN0cmluZ2lmeShmaWVsZFZhbHVlLm9iamVjdHMpKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKVxuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIG51bGwpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZFZhbHVlLl9fb3AgPT09ICdSZW1vdmUnKSB7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gYXJyYXlfcmVtb3ZlKENPQUxFU0NFKCQke2luZGV4fTpuYW1lLCAnW10nOjpqc29uYiksICQke2luZGV4ICsgMX06Ompzb25iKWApXG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgSlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZS5vYmplY3RzKSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX19vcCA9PT0gJ0FkZFVuaXF1ZScpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSBhcnJheV9hZGRfdW5pcXVlKENPQUxFU0NFKCQke2luZGV4fTpuYW1lLCAnW10nOjpqc29uYiksICQke2luZGV4ICsgMX06Ompzb25iKWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIEpTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUub2JqZWN0cykpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZE5hbWUgPT09ICd1cGRhdGVkQXQnKSB7IC8vVE9ETzogc3RvcCBzcGVjaWFsIGNhc2luZyB0aGlzLiBJdCBzaG91bGQgY2hlY2sgZm9yIF9fdHlwZSA9PT0gJ0RhdGUnIGFuZCB1c2UgLmlzb1xuICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKVxuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnYm9vbGVhbicpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZS5vYmplY3RJZCk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnRGF0ZScpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgdG9Qb3N0Z3Jlc1ZhbHVlKGZpZWxkVmFsdWUpKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkVmFsdWUuX190eXBlID09PSAnRmlsZScpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgdG9Qb3N0Z3Jlc1ZhbHVlKGZpZWxkVmFsdWUpKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdHZW9Qb2ludCcpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSBQT0lOVCgkJHtpbmRleCArIDF9LCAkJHtpbmRleCArIDJ9KWApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUubG9uZ2l0dWRlLCBmaWVsZFZhbHVlLmxhdGl0dWRlKTtcbiAgICAgICAgaW5kZXggKz0gMztcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgICBjb25zdCB2YWx1ZSA9IGNvbnZlcnRQb2x5Z29uVG9TUUwoZmllbGRWYWx1ZS5jb29yZGluYXRlcyk7XG4gICAgICAgIHVwZGF0ZVBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lID0gJCR7aW5kZXggKyAxfTo6cG9seWdvbmApO1xuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIHZhbHVlKTtcbiAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGRWYWx1ZS5fX3R5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgLy8gbm9vcFxuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZmllbGRWYWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkTmFtZSwgZmllbGRWYWx1ZSk7XG4gICAgICAgIGluZGV4ICs9IDI7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWVsZFZhbHVlID09PSAnb2JqZWN0J1xuICAgICAgICAgICAgICAgICAgICAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV1cbiAgICAgICAgICAgICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdPYmplY3QnKSB7XG4gICAgICAgIC8vIEdhdGhlciBrZXlzIHRvIGluY3JlbWVudFxuICAgICAgICBjb25zdCBrZXlzVG9JbmNyZW1lbnQgPSBPYmplY3Qua2V5cyhvcmlnaW5hbFVwZGF0ZSkuZmlsdGVyKGsgPT4ge1xuICAgICAgICAgIC8vIGNob29zZSB0b3AgbGV2ZWwgZmllbGRzIHRoYXQgaGF2ZSBhIGRlbGV0ZSBvcGVyYXRpb24gc2V0XG4gICAgICAgICAgLy8gTm90ZSB0aGF0IE9iamVjdC5rZXlzIGlzIGl0ZXJhdGluZyBvdmVyIHRoZSAqKm9yaWdpbmFsKiogdXBkYXRlIG9iamVjdFxuICAgICAgICAgIC8vIGFuZCB0aGF0IHNvbWUgb2YgdGhlIGtleXMgb2YgdGhlIG9yaWdpbmFsIHVwZGF0ZSBjb3VsZCBiZSBudWxsIG9yIHVuZGVmaW5lZDpcbiAgICAgICAgICAvLyAoU2VlIHRoZSBhYm92ZSBjaGVjayBgaWYgKGZpZWxkVmFsdWUgPT09IG51bGwgfHwgdHlwZW9mIGZpZWxkVmFsdWUgPT0gXCJ1bmRlZmluZWRcIilgKVxuICAgICAgICAgIGNvbnN0IHZhbHVlID0gb3JpZ2luYWxVcGRhdGVba107XG4gICAgICAgICAgcmV0dXJuIHZhbHVlICYmIHZhbHVlLl9fb3AgPT09ICdJbmNyZW1lbnQnICYmIGsuc3BsaXQoJy4nKS5sZW5ndGggPT09IDIgJiYgay5zcGxpdChcIi5cIilbMF0gPT09IGZpZWxkTmFtZTtcbiAgICAgICAgfSkubWFwKGsgPT4gay5zcGxpdCgnLicpWzFdKTtcblxuICAgICAgICBsZXQgaW5jcmVtZW50UGF0dGVybnMgPSAnJztcbiAgICAgICAgaWYgKGtleXNUb0luY3JlbWVudC5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgaW5jcmVtZW50UGF0dGVybnMgPSAnIHx8ICcgKyBrZXlzVG9JbmNyZW1lbnQubWFwKChjKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBhbW91bnQgPSBmaWVsZFZhbHVlW2NdLmFtb3VudDtcbiAgICAgICAgICAgIHJldHVybiBgQ09OQ0FUKCd7XCIke2N9XCI6JywgQ09BTEVTQ0UoJCR7aW5kZXh9Om5hbWUtPj4nJHtjfScsJzAnKTo6aW50ICsgJHthbW91bnR9LCAnfScpOjpqc29uYmA7XG4gICAgICAgICAgfSkuam9pbignIHx8ICcpO1xuICAgICAgICAgIC8vIFN0cmlwIHRoZSBrZXlzXG4gICAgICAgICAga2V5c1RvSW5jcmVtZW50LmZvckVhY2goKGtleSkgPT4ge1xuICAgICAgICAgICAgZGVsZXRlIGZpZWxkVmFsdWVba2V5XTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGtleXNUb0RlbGV0ZTogQXJyYXk8c3RyaW5nPiA9IE9iamVjdC5rZXlzKG9yaWdpbmFsVXBkYXRlKS5maWx0ZXIoayA9PiB7XG4gICAgICAgICAgLy8gY2hvb3NlIHRvcCBsZXZlbCBmaWVsZHMgdGhhdCBoYXZlIGEgZGVsZXRlIG9wZXJhdGlvbiBzZXQuXG4gICAgICAgICAgY29uc3QgdmFsdWUgPSBvcmlnaW5hbFVwZGF0ZVtrXTtcbiAgICAgICAgICByZXR1cm4gdmFsdWUgJiYgdmFsdWUuX19vcCA9PT0gJ0RlbGV0ZScgJiYgay5zcGxpdCgnLicpLmxlbmd0aCA9PT0gMiAmJiBrLnNwbGl0KFwiLlwiKVswXSA9PT0gZmllbGROYW1lO1xuICAgICAgICB9KS5tYXAoayA9PiBrLnNwbGl0KCcuJylbMV0pO1xuXG4gICAgICAgIGNvbnN0IGRlbGV0ZVBhdHRlcm5zID0ga2V5c1RvRGVsZXRlLnJlZHVjZSgocDogc3RyaW5nLCBjOiBzdHJpbmcsIGk6IG51bWJlcikgPT4ge1xuICAgICAgICAgIHJldHVybiBwICsgYCAtICckJHtpbmRleCArIDEgKyBpfTp2YWx1ZSdgO1xuICAgICAgICB9LCAnJyk7XG5cbiAgICAgICAgdXBkYXRlUGF0dGVybnMucHVzaChgJCR7aW5kZXh9Om5hbWUgPSAoJ3t9Jzo6anNvbmIgJHtkZWxldGVQYXR0ZXJuc30gJHtpbmNyZW1lbnRQYXR0ZXJuc30gfHwgJCR7aW5kZXggKyAxICsga2V5c1RvRGVsZXRlLmxlbmd0aH06Ompzb25iIClgKTtcblxuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIC4uLmtleXNUb0RlbGV0ZSwgSlNPTi5zdHJpbmdpZnkoZmllbGRWYWx1ZSkpO1xuICAgICAgICBpbmRleCArPSAyICsga2V5c1RvRGVsZXRlLmxlbmd0aDtcbiAgICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShmaWVsZFZhbHVlKVxuICAgICAgICAgICAgICAgICAgICAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV1cbiAgICAgICAgICAgICAgICAgICAgJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdBcnJheScpIHtcbiAgICAgICAgY29uc3QgZXhwZWN0ZWRUeXBlID0gcGFyc2VUeXBlVG9Qb3N0Z3Jlc1R5cGUoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdKTtcbiAgICAgICAgaWYgKGV4cGVjdGVkVHlwZSA9PT0gJ3RleHRbXScpIHtcbiAgICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX06OnRleHRbXWApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGxldCB0eXBlID0gJ3RleHQnO1xuICAgICAgICAgIGZvciAoY29uc3QgZWx0IG9mIGZpZWxkVmFsdWUpIHtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgZWx0ID09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgIHR5cGUgPSAnanNvbic7XG4gICAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB1cGRhdGVQYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9IGFycmF5X3RvX2pzb24oJCR7aW5kZXggKyAxfTo6JHt0eXBlfVtdKTo6anNvbmJgKTtcbiAgICAgICAgfVxuICAgICAgICB2YWx1ZXMucHVzaChmaWVsZE5hbWUsIGZpZWxkVmFsdWUpO1xuICAgICAgICBpbmRleCArPSAyO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVidWcoJ05vdCBzdXBwb3J0ZWQgdXBkYXRlJywgZmllbGROYW1lLCBmaWVsZFZhbHVlKTtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLCBgUG9zdGdyZXMgZG9lc24ndCBzdXBwb3J0IHVwZGF0ZSAke0pTT04uc3RyaW5naWZ5KGZpZWxkVmFsdWUpfSB5ZXRgKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgd2hlcmUgPSBidWlsZFdoZXJlQ2xhdXNlKHsgc2NoZW1hLCBpbmRleCwgcXVlcnkgfSlcbiAgICB2YWx1ZXMucHVzaCguLi53aGVyZS52YWx1ZXMpO1xuXG4gICAgY29uc3Qgd2hlcmVDbGF1c2UgPSB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCBxcyA9IGBVUERBVEUgJDE6bmFtZSBTRVQgJHt1cGRhdGVQYXR0ZXJucy5qb2luKCl9ICR7d2hlcmVDbGF1c2V9IFJFVFVSTklORyAqYDtcbiAgICBkZWJ1ZygndXBkYXRlOiAnLCBxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LmFueShxcywgdmFsdWVzKTtcbiAgfVxuXG4gIC8vIEhvcGVmdWxseSwgd2UgY2FuIGdldCByaWQgb2YgdGhpcy4gSXQncyBvbmx5IHVzZWQgZm9yIGNvbmZpZyBhbmQgaG9va3MuXG4gIHVwc2VydE9uZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB1cGRhdGU6IGFueSkge1xuICAgIGRlYnVnKCd1cHNlcnRPbmVPYmplY3QnLCB7Y2xhc3NOYW1lLCBxdWVyeSwgdXBkYXRlfSk7XG4gICAgY29uc3QgY3JlYXRlVmFsdWUgPSBPYmplY3QuYXNzaWduKHt9LCBxdWVyeSwgdXBkYXRlKTtcbiAgICByZXR1cm4gdGhpcy5jcmVhdGVPYmplY3QoY2xhc3NOYW1lLCBzY2hlbWEsIGNyZWF0ZVZhbHVlKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgLy8gaWdub3JlIGR1cGxpY2F0ZSB2YWx1ZSBlcnJvcnMgYXMgaXQncyB1cHNlcnRcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLmZpbmRPbmVBbmRVcGRhdGUoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCB1cGRhdGUpO1xuICAgICAgfSk7XG4gIH1cblxuICBmaW5kKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHsgc2tpcCwgbGltaXQsIHNvcnQsIGtleXMgfTogUXVlcnlPcHRpb25zKSB7XG4gICAgZGVidWcoJ2ZpbmQnLCBjbGFzc05hbWUsIHF1ZXJ5LCB7c2tpcCwgbGltaXQsIHNvcnQsIGtleXMgfSk7XG4gICAgY29uc3QgaGFzTGltaXQgPSBsaW1pdCAhPT0gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGhhc1NraXAgPSBza2lwICE9PSB1bmRlZmluZWQ7XG4gICAgbGV0IHZhbHVlcyA9IFtjbGFzc05hbWVdO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgcXVlcnksIGluZGV4OiAyIH0pXG4gICAgdmFsdWVzLnB1c2goLi4ud2hlcmUudmFsdWVzKTtcblxuICAgIGNvbnN0IHdoZXJlUGF0dGVybiA9IHdoZXJlLnBhdHRlcm4ubGVuZ3RoID4gMCA/IGBXSEVSRSAke3doZXJlLnBhdHRlcm59YCA6ICcnO1xuICAgIGNvbnN0IGxpbWl0UGF0dGVybiA9IGhhc0xpbWl0ID8gYExJTUlUICQke3ZhbHVlcy5sZW5ndGggKyAxfWAgOiAnJztcbiAgICBpZiAoaGFzTGltaXQpIHtcbiAgICAgIHZhbHVlcy5wdXNoKGxpbWl0KTtcbiAgICB9XG4gICAgY29uc3Qgc2tpcFBhdHRlcm4gPSBoYXNTa2lwID8gYE9GRlNFVCAkJHt2YWx1ZXMubGVuZ3RoICsgMX1gIDogJyc7XG4gICAgaWYgKGhhc1NraXApIHtcbiAgICAgIHZhbHVlcy5wdXNoKHNraXApO1xuICAgIH1cblxuICAgIGxldCBzb3J0UGF0dGVybiA9ICcnO1xuICAgIGlmIChzb3J0KSB7XG4gICAgICBjb25zdCBzb3J0Q29weTogYW55ID0gc29ydDtcbiAgICAgIGNvbnN0IHNvcnRpbmcgPSBPYmplY3Qua2V5cyhzb3J0KS5tYXAoKGtleSkgPT4ge1xuICAgICAgICBjb25zdCB0cmFuc2Zvcm1LZXkgPSB0cmFuc2Zvcm1Eb3RGaWVsZFRvQ29tcG9uZW50cyhrZXkpLmpvaW4oJy0+Jyk7XG4gICAgICAgIC8vIFVzaW5nICRpZHggcGF0dGVybiBnaXZlczogIG5vbi1pbnRlZ2VyIGNvbnN0YW50IGluIE9SREVSIEJZXG4gICAgICAgIGlmIChzb3J0Q29weVtrZXldID09PSAxKSB7XG4gICAgICAgICAgcmV0dXJuIGAke3RyYW5zZm9ybUtleX0gQVNDYDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYCR7dHJhbnNmb3JtS2V5fSBERVNDYDtcbiAgICAgIH0pLmpvaW4oKTtcbiAgICAgIHNvcnRQYXR0ZXJuID0gc29ydCAhPT0gdW5kZWZpbmVkICYmIE9iamVjdC5rZXlzKHNvcnQpLmxlbmd0aCA+IDAgPyBgT1JERVIgQlkgJHtzb3J0aW5nfWAgOiAnJztcbiAgICB9XG4gICAgaWYgKHdoZXJlLnNvcnRzICYmIE9iamVjdC5rZXlzKCh3aGVyZS5zb3J0czogYW55KSkubGVuZ3RoID4gMCkge1xuICAgICAgc29ydFBhdHRlcm4gPSBgT1JERVIgQlkgJHt3aGVyZS5zb3J0cy5qb2luKCl9YDtcbiAgICB9XG5cbiAgICBsZXQgY29sdW1ucyA9ICcqJztcbiAgICBpZiAoa2V5cykge1xuICAgICAgLy8gRXhjbHVkZSBlbXB0eSBrZXlzXG4gICAgICBrZXlzID0ga2V5cy5maWx0ZXIoKGtleSkgPT4ge1xuICAgICAgICByZXR1cm4ga2V5Lmxlbmd0aCA+IDA7XG4gICAgICB9KTtcbiAgICAgIGNvbHVtbnMgPSBrZXlzLm1hcCgoa2V5LCBpbmRleCkgPT4ge1xuICAgICAgICBpZiAoa2V5ID09PSAnJHNjb3JlJykge1xuICAgICAgICAgIHJldHVybiBgdHNfcmFua19jZCh0b190c3ZlY3RvcigkJHsyfSwgJCR7M306bmFtZSksIHRvX3RzcXVlcnkoJCR7NH0sICQkezV9KSwgMzIpIGFzIHNjb3JlYDtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gYCQke2luZGV4ICsgdmFsdWVzLmxlbmd0aCArIDF9Om5hbWVgO1xuICAgICAgfSkuam9pbigpO1xuICAgICAgdmFsdWVzID0gdmFsdWVzLmNvbmNhdChrZXlzKTtcbiAgICB9XG5cbiAgICBjb25zdCBxcyA9IGBTRUxFQ1QgJHtjb2x1bW5zfSBGUk9NICQxOm5hbWUgJHt3aGVyZVBhdHRlcm59ICR7c29ydFBhdHRlcm59ICR7bGltaXRQYXR0ZXJufSAke3NraXBQYXR0ZXJufWA7XG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5hbnkocXMsIHZhbHVlcylcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIC8vIFF1ZXJ5IG9uIG5vbiBleGlzdGluZyB0YWJsZSwgZG9uJ3QgY3Jhc2hcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgIT09IFBvc3RncmVzUmVsYXRpb25Eb2VzTm90RXhpc3RFcnJvcikge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBbXTtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHJlc3VsdHMubWFwKG9iamVjdCA9PiB0aGlzLnBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKSkpO1xuICB9XG5cbiAgLy8gQ29udmVydHMgZnJvbSBhIHBvc3RncmVzLWZvcm1hdCBvYmplY3QgdG8gYSBSRVNULWZvcm1hdCBvYmplY3QuXG4gIC8vIERvZXMgbm90IHN0cmlwIG91dCBhbnl0aGluZyBiYXNlZCBvbiBhIGxhY2sgb2YgYXV0aGVudGljYXRpb24uXG4gIHBvc3RncmVzT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWU6IHN0cmluZywgb2JqZWN0OiBhbnksIHNjaGVtYTogYW55KSB7XG4gICAgT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZm9yRWFjaChmaWVsZE5hbWUgPT4ge1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcicgJiYgb2JqZWN0W2ZpZWxkTmFtZV0pIHtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7IG9iamVjdElkOiBvYmplY3RbZmllbGROYW1lXSwgX190eXBlOiAnUG9pbnRlcicsIGNsYXNzTmFtZTogc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnRhcmdldENsYXNzIH07XG4gICAgICB9XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgX190eXBlOiBcIlJlbGF0aW9uXCIsXG4gICAgICAgICAgY2xhc3NOYW1lOiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udGFyZ2V0Q2xhc3NcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKG9iamVjdFtmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnR2VvUG9pbnQnKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogXCJHZW9Qb2ludFwiLFxuICAgICAgICAgIGxhdGl0dWRlOiBvYmplY3RbZmllbGROYW1lXS55LFxuICAgICAgICAgIGxvbmdpdHVkZTogb2JqZWN0W2ZpZWxkTmFtZV0ueFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgICBsZXQgY29vcmRzID0gb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICAgIGNvb3JkcyA9IGNvb3Jkcy5zdWJzdHIoMiwgY29vcmRzLmxlbmd0aCAtIDQpLnNwbGl0KCcpLCgnKTtcbiAgICAgICAgY29vcmRzID0gY29vcmRzLm1hcCgocG9pbnQpID0+IHtcbiAgICAgICAgICByZXR1cm4gW1xuICAgICAgICAgICAgcGFyc2VGbG9hdChwb2ludC5zcGxpdCgnLCcpWzFdKSxcbiAgICAgICAgICAgIHBhcnNlRmxvYXQocG9pbnQuc3BsaXQoJywnKVswXSlcbiAgICAgICAgICBdO1xuICAgICAgICB9KTtcbiAgICAgICAgb2JqZWN0W2ZpZWxkTmFtZV0gPSB7XG4gICAgICAgICAgX190eXBlOiBcIlBvbHlnb25cIixcbiAgICAgICAgICBjb29yZGluYXRlczogY29vcmRzXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0ZpbGUnKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fdHlwZTogJ0ZpbGUnLFxuICAgICAgICAgIG5hbWU6IG9iamVjdFtmaWVsZE5hbWVdXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICAvL1RPRE86IHJlbW92ZSB0aGlzIHJlbGlhbmNlIG9uIHRoZSBtb25nbyBmb3JtYXQuIERCIGFkYXB0ZXIgc2hvdWxkbid0IGtub3cgdGhlcmUgaXMgYSBkaWZmZXJlbmNlIGJldHdlZW4gY3JlYXRlZCBhdCBhbmQgYW55IG90aGVyIGRhdGUgZmllbGQuXG4gICAgaWYgKG9iamVjdC5jcmVhdGVkQXQpIHtcbiAgICAgIG9iamVjdC5jcmVhdGVkQXQgPSBvYmplY3QuY3JlYXRlZEF0LnRvSVNPU3RyaW5nKCk7XG4gICAgfVxuICAgIGlmIChvYmplY3QudXBkYXRlZEF0KSB7XG4gICAgICBvYmplY3QudXBkYXRlZEF0ID0gb2JqZWN0LnVwZGF0ZWRBdC50b0lTT1N0cmluZygpO1xuICAgIH1cbiAgICBpZiAob2JqZWN0LmV4cGlyZXNBdCkge1xuICAgICAgb2JqZWN0LmV4cGlyZXNBdCA9IHsgX190eXBlOiAnRGF0ZScsIGlzbzogb2JqZWN0LmV4cGlyZXNBdC50b0lTT1N0cmluZygpIH07XG4gICAgfVxuICAgIGlmIChvYmplY3QuX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0KSB7XG4gICAgICBvYmplY3QuX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0ID0geyBfX3R5cGU6ICdEYXRlJywgaXNvOiBvYmplY3QuX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0LnRvSVNPU3RyaW5nKCkgfTtcbiAgICB9XG4gICAgaWYgKG9iamVjdC5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQpIHtcbiAgICAgIG9iamVjdC5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQgPSB7IF9fdHlwZTogJ0RhdGUnLCBpc286IG9iamVjdC5fYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQudG9JU09TdHJpbmcoKSB9O1xuICAgIH1cbiAgICBpZiAob2JqZWN0Ll9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQpIHtcbiAgICAgIG9iamVjdC5fcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0ID0geyBfX3R5cGU6ICdEYXRlJywgaXNvOiBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdC50b0lTT1N0cmluZygpIH07XG4gICAgfVxuICAgIGlmIChvYmplY3QuX3Bhc3N3b3JkX2NoYW5nZWRfYXQpIHtcbiAgICAgIG9iamVjdC5fcGFzc3dvcmRfY2hhbmdlZF9hdCA9IHsgX190eXBlOiAnRGF0ZScsIGlzbzogb2JqZWN0Ll9wYXNzd29yZF9jaGFuZ2VkX2F0LnRvSVNPU3RyaW5nKCkgfTtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IGZpZWxkTmFtZSBpbiBvYmplY3QpIHtcbiAgICAgIGlmIChvYmplY3RbZmllbGROYW1lXSA9PT0gbnVsbCkge1xuICAgICAgICBkZWxldGUgb2JqZWN0W2ZpZWxkTmFtZV07XG4gICAgICB9XG4gICAgICBpZiAob2JqZWN0W2ZpZWxkTmFtZV0gaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0geyBfX3R5cGU6ICdEYXRlJywgaXNvOiBvYmplY3RbZmllbGROYW1lXS50b0lTT1N0cmluZygpIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIHVuaXF1ZSBpbmRleC4gVW5pcXVlIGluZGV4ZXMgb24gbnVsbGFibGUgZmllbGRzIGFyZSBub3QgYWxsb3dlZC4gU2luY2Ugd2UgZG9uJ3RcbiAgLy8gY3VycmVudGx5IGtub3cgd2hpY2ggZmllbGRzIGFyZSBudWxsYWJsZSBhbmQgd2hpY2ggYXJlbid0LCB3ZSBpZ25vcmUgdGhhdCBjcml0ZXJpYS5cbiAgLy8gQXMgc3VjaCwgd2Ugc2hvdWxkbid0IGV4cG9zZSB0aGlzIGZ1bmN0aW9uIHRvIHVzZXJzIG9mIHBhcnNlIHVudGlsIHdlIGhhdmUgYW4gb3V0LW9mLWJhbmRcbiAgLy8gV2F5IG9mIGRldGVybWluaW5nIGlmIGEgZmllbGQgaXMgbnVsbGFibGUuIFVuZGVmaW5lZCBkb2Vzbid0IGNvdW50IGFnYWluc3QgdW5pcXVlbmVzcyxcbiAgLy8gd2hpY2ggaXMgd2h5IHdlIHVzZSBzcGFyc2UgaW5kZXhlcy5cbiAgZW5zdXJlVW5pcXVlbmVzcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBmaWVsZE5hbWVzOiBzdHJpbmdbXSkge1xuICAgIC8vIFVzZSB0aGUgc2FtZSBuYW1lIGZvciBldmVyeSBlbnN1cmVVbmlxdWVuZXNzIGF0dGVtcHQsIGJlY2F1c2UgcG9zdGdyZXNcbiAgICAvLyBXaWxsIGhhcHBpbHkgY3JlYXRlIHRoZSBzYW1lIGluZGV4IHdpdGggbXVsdGlwbGUgbmFtZXMuXG4gICAgY29uc3QgY29uc3RyYWludE5hbWUgPSBgdW5pcXVlXyR7ZmllbGROYW1lcy5zb3J0KCkuam9pbignXycpfWA7XG4gICAgY29uc3QgY29uc3RyYWludFBhdHRlcm5zID0gZmllbGROYW1lcy5tYXAoKGZpZWxkTmFtZSwgaW5kZXgpID0+IGAkJHtpbmRleCArIDN9Om5hbWVgKTtcbiAgICBjb25zdCBxcyA9IGBBTFRFUiBUQUJMRSAkMTpuYW1lIEFERCBDT05TVFJBSU5UICQyOm5hbWUgVU5JUVVFICgke2NvbnN0cmFpbnRQYXR0ZXJucy5qb2luKCl9KWA7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5ub25lKHFzLCBbY2xhc3NOYW1lLCBjb25zdHJhaW50TmFtZSwgLi4uZmllbGROYW1lc10pXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNEdXBsaWNhdGVSZWxhdGlvbkVycm9yICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoY29uc3RyYWludE5hbWUpKSB7XG4gICAgICAgIC8vIEluZGV4IGFscmVhZHkgZXhpc3RzLiBJZ25vcmUgZXJyb3IuXG4gICAgICAgIH0gZWxzZSBpZiAoZXJyb3IuY29kZSA9PT0gUG9zdGdyZXNVbmlxdWVJbmRleFZpb2xhdGlvbkVycm9yICYmIGVycm9yLm1lc3NhZ2UuaW5jbHVkZXMoY29uc3RyYWludE5hbWUpKSB7XG4gICAgICAgIC8vIENhc3QgdGhlIGVycm9yIGludG8gdGhlIHByb3BlciBwYXJzZSBlcnJvclxuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5EVVBMSUNBVEVfVkFMVUUsICdBIGR1cGxpY2F0ZSB2YWx1ZSBmb3IgYSBmaWVsZCB3aXRoIHVuaXF1ZSB2YWx1ZXMgd2FzIHByb3ZpZGVkJyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gRXhlY3V0ZXMgYSBjb3VudC5cbiAgY291bnQoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSkge1xuICAgIGRlYnVnKCdjb3VudCcsIGNsYXNzTmFtZSwgcXVlcnkpO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWVdO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgcXVlcnksIGluZGV4OiAyIH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZVBhdHRlcm4gPSB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCBxcyA9IGBTRUxFQ1QgY291bnQoKikgRlJPTSAkMTpuYW1lICR7d2hlcmVQYXR0ZXJufWA7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5vbmUocXMsIHZhbHVlcywgYSA9PiArYS5jb3VudClcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlICE9PSBQb3N0Z3Jlc1JlbGF0aW9uRG9lc05vdEV4aXN0RXJyb3IpIHtcbiAgICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH0pO1xuICB9XG5cbiAgZGlzdGluY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgcXVlcnk6IFF1ZXJ5VHlwZSwgZmllbGROYW1lOiBzdHJpbmcpIHtcbiAgICBkZWJ1ZygnZGlzdGluY3QnLCBjbGFzc05hbWUsIHF1ZXJ5KTtcbiAgICBsZXQgZmllbGQgPSBmaWVsZE5hbWU7XG4gICAgbGV0IGNvbHVtbiA9IGZpZWxkTmFtZTtcbiAgICBjb25zdCBpc05lc3RlZCA9IGZpZWxkTmFtZS5pbmRleE9mKCcuJykgPj0gMDtcbiAgICBpZiAoaXNOZXN0ZWQpIHtcbiAgICAgIGZpZWxkID0gdHJhbnNmb3JtRG90RmllbGRUb0NvbXBvbmVudHMoZmllbGROYW1lKS5qb2luKCctPicpO1xuICAgICAgY29sdW1uID0gZmllbGROYW1lLnNwbGl0KCcuJylbMF07XG4gICAgfVxuICAgIGNvbnN0IGlzQXJyYXlGaWVsZCA9IHNjaGVtYS5maWVsZHNcbiAgICAgICAgICAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV1cbiAgICAgICAgICAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ0FycmF5JztcbiAgICBjb25zdCBpc1BvaW50ZXJGaWVsZCA9IHNjaGVtYS5maWVsZHNcbiAgICAgICAgICAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV1cbiAgICAgICAgICAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1BvaW50ZXInO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtmaWVsZCwgY29sdW1uLCBjbGFzc05hbWVdO1xuICAgIGNvbnN0IHdoZXJlID0gYnVpbGRXaGVyZUNsYXVzZSh7IHNjaGVtYSwgcXVlcnksIGluZGV4OiA0IH0pO1xuICAgIHZhbHVlcy5wdXNoKC4uLndoZXJlLnZhbHVlcyk7XG5cbiAgICBjb25zdCB3aGVyZVBhdHRlcm4gPSB3aGVyZS5wYXR0ZXJuLmxlbmd0aCA+IDAgPyBgV0hFUkUgJHt3aGVyZS5wYXR0ZXJufWAgOiAnJztcbiAgICBjb25zdCB0cmFuc2Zvcm1lciA9IGlzQXJyYXlGaWVsZCA/ICdqc29uYl9hcnJheV9lbGVtZW50cycgOiAnT04nO1xuICAgIGxldCBxcyA9IGBTRUxFQ1QgRElTVElOQ1QgJHt0cmFuc2Zvcm1lcn0oJDE6bmFtZSkgJDI6bmFtZSBGUk9NICQzOm5hbWUgJHt3aGVyZVBhdHRlcm59YDtcbiAgICBpZiAoaXNOZXN0ZWQpIHtcbiAgICAgIHFzID0gYFNFTEVDVCBESVNUSU5DVCAke3RyYW5zZm9ybWVyfSgkMTpyYXcpICQyOnJhdyBGUk9NICQzOm5hbWUgJHt3aGVyZVBhdHRlcm59YDtcbiAgICB9XG4gICAgZGVidWcocXMsIHZhbHVlcyk7XG4gICAgcmV0dXJuIHRoaXMuX2NsaWVudC5hbnkocXMsIHZhbHVlcylcbiAgICAgIC5jYXRjaCgoZXJyb3IpID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IFBvc3RncmVzTWlzc2luZ0NvbHVtbkVycm9yKSB7XG4gICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC50aGVuKChyZXN1bHRzKSA9PiB7XG4gICAgICAgIGlmICghaXNOZXN0ZWQpIHtcbiAgICAgICAgICByZXN1bHRzID0gcmVzdWx0cy5maWx0ZXIoKG9iamVjdCkgPT4gb2JqZWN0W2ZpZWxkXSAhPT0gbnVsbCk7XG4gICAgICAgICAgcmV0dXJuIHJlc3VsdHMubWFwKG9iamVjdCA9PiB7XG4gICAgICAgICAgICBpZiAoIWlzUG9pbnRlckZpZWxkKSB7XG4gICAgICAgICAgICAgIHJldHVybiBvYmplY3RbZmllbGRdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICAgICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgICAgICAgICAgIGNsYXNzTmFtZTogIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgICAgICAgICAgb2JqZWN0SWQ6IG9iamVjdFtmaWVsZF1cbiAgICAgICAgICAgIH07XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgY2hpbGQgPSBmaWVsZE5hbWUuc3BsaXQoJy4nKVsxXTtcbiAgICAgICAgcmV0dXJuIHJlc3VsdHMubWFwKG9iamVjdCA9PiBvYmplY3RbY29sdW1uXVtjaGlsZF0pO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4gcmVzdWx0cy5tYXAob2JqZWN0ID0+IHRoaXMucG9zdGdyZXNPYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpKSk7XG4gIH1cblxuICBhZ2dyZWdhdGUoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55KSB7XG4gICAgZGVidWcoJ2FnZ3JlZ2F0ZScsIGNsYXNzTmFtZSwgcGlwZWxpbmUpO1xuICAgIGNvbnN0IHZhbHVlcyA9IFtjbGFzc05hbWVdO1xuICAgIGxldCBpbmRleDogbnVtYmVyID0gMjtcbiAgICBsZXQgY29sdW1uczogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgY291bnRGaWVsZCA9IG51bGw7XG4gICAgbGV0IGdyb3VwVmFsdWVzID0gbnVsbDtcbiAgICBsZXQgd2hlcmVQYXR0ZXJuID0gJyc7XG4gICAgbGV0IGxpbWl0UGF0dGVybiA9ICcnO1xuICAgIGxldCBza2lwUGF0dGVybiA9ICcnO1xuICAgIGxldCBzb3J0UGF0dGVybiA9ICcnO1xuICAgIGxldCBncm91cFBhdHRlcm4gPSAnJztcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBpcGVsaW5lLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBjb25zdCBzdGFnZSA9IHBpcGVsaW5lW2ldO1xuICAgICAgaWYgKHN0YWdlLiRncm91cCkge1xuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHN0YWdlLiRncm91cCkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gc3RhZ2UuJGdyb3VwW2ZpZWxkXTtcbiAgICAgICAgICBpZiAodmFsdWUgPT09IG51bGwgfHwgdmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChmaWVsZCA9PT0gJ19pZCcgJiYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpICYmIHZhbHVlICE9PSAnJykge1xuICAgICAgICAgICAgY29sdW1ucy5wdXNoKGAkJHtpbmRleH06bmFtZSBBUyBcIm9iamVjdElkXCJgKTtcbiAgICAgICAgICAgIGdyb3VwUGF0dGVybiA9IGBHUk9VUCBCWSAkJHtpbmRleH06bmFtZWA7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaCh0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCh2YWx1ZSkpO1xuICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoZmllbGQgPT09ICdfaWQnICYmICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSAmJiBPYmplY3Qua2V5cyh2YWx1ZSkubGVuZ3RoICE9PSAwKSB7XG4gICAgICAgICAgICBncm91cFZhbHVlcyA9IHZhbHVlO1xuICAgICAgICAgICAgY29uc3QgZ3JvdXBCeUZpZWxkcyA9IFtdO1xuICAgICAgICAgICAgZm9yIChjb25zdCBhbGlhcyBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgICBjb25zdCBvcGVyYXRpb24gPSBPYmplY3Qua2V5cyh2YWx1ZVthbGlhc10pWzBdO1xuICAgICAgICAgICAgICBjb25zdCBzb3VyY2UgPSB0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCh2YWx1ZVthbGlhc11bb3BlcmF0aW9uXSk7XG4gICAgICAgICAgICAgIGlmIChtb25nb0FnZ3JlZ2F0ZVRvUG9zdGdyZXNbb3BlcmF0aW9uXSkge1xuICAgICAgICAgICAgICAgIGlmICghZ3JvdXBCeUZpZWxkcy5pbmNsdWRlcyhgXCIke3NvdXJjZX1cImApKSB7XG4gICAgICAgICAgICAgICAgICBncm91cEJ5RmllbGRzLnB1c2goYFwiJHtzb3VyY2V9XCJgKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBFWFRSQUNUKCR7bW9uZ29BZ2dyZWdhdGVUb1Bvc3RncmVzW29wZXJhdGlvbl19IEZST00gJCR7aW5kZXh9Om5hbWUgQVQgVElNRSBaT05FICdVVEMnKSBBUyAkJHtpbmRleCArIDF9Om5hbWVgKTtcbiAgICAgICAgICAgICAgICB2YWx1ZXMucHVzaChzb3VyY2UsIGFsaWFzKTtcbiAgICAgICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBncm91cFBhdHRlcm4gPSBgR1JPVVAgQlkgJCR7aW5kZXh9OnJhd2A7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaChncm91cEJ5RmllbGRzLmpvaW4oKSk7XG4gICAgICAgICAgICBpbmRleCArPSAxO1xuICAgICAgICAgICAgY29udGludWU7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh2YWx1ZS4kc3VtKSB7XG4gICAgICAgICAgICBpZiAodHlwZW9mIHZhbHVlLiRzdW0gPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgIGNvbHVtbnMucHVzaChgU1VNKCQke2luZGV4fTpuYW1lKSBBUyAkJHtpbmRleCArIDF9Om5hbWVgKTtcbiAgICAgICAgICAgICAgdmFsdWVzLnB1c2godHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWUuJHN1bSksIGZpZWxkKTtcbiAgICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGNvdW50RmllbGQgPSBmaWVsZDtcbiAgICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBDT1VOVCgqKSBBUyAkJHtpbmRleH06bmFtZWApO1xuICAgICAgICAgICAgICB2YWx1ZXMucHVzaChmaWVsZCk7XG4gICAgICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmICh2YWx1ZS4kbWF4KSB7XG4gICAgICAgICAgICBjb2x1bW5zLnB1c2goYE1BWCgkJHtpbmRleH06bmFtZSkgQVMgJCR7aW5kZXggKyAxfTpuYW1lYCk7XG4gICAgICAgICAgICB2YWx1ZXMucHVzaCh0cmFuc2Zvcm1BZ2dyZWdhdGVGaWVsZCh2YWx1ZS4kbWF4KSwgZmllbGQpO1xuICAgICAgICAgICAgaW5kZXggKz0gMjtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHZhbHVlLiRtaW4pIHtcbiAgICAgICAgICAgIGNvbHVtbnMucHVzaChgTUlOKCQke2luZGV4fTpuYW1lKSBBUyAkJHtpbmRleCArIDF9Om5hbWVgKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKHRyYW5zZm9ybUFnZ3JlZ2F0ZUZpZWxkKHZhbHVlLiRtaW4pLCBmaWVsZCk7XG4gICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodmFsdWUuJGF2Zykge1xuICAgICAgICAgICAgY29sdW1ucy5wdXNoKGBBVkcoJCR7aW5kZXh9Om5hbWUpIEFTICQke2luZGV4ICsgMX06bmFtZWApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2godHJhbnNmb3JtQWdncmVnYXRlRmllbGQodmFsdWUuJGF2ZyksIGZpZWxkKTtcbiAgICAgICAgICAgIGluZGV4ICs9IDI7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb2x1bW5zLnB1c2goJyonKTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kcHJvamVjdCkge1xuICAgICAgICBpZiAoY29sdW1ucy5pbmNsdWRlcygnKicpKSB7XG4gICAgICAgICAgY29sdW1ucyA9IFtdO1xuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gc3RhZ2UuJHByb2plY3QpIHtcbiAgICAgICAgICBjb25zdCB2YWx1ZSA9IHN0YWdlLiRwcm9qZWN0W2ZpZWxkXTtcbiAgICAgICAgICBpZiAoKHZhbHVlID09PSAxIHx8IHZhbHVlID09PSB0cnVlKSkge1xuICAgICAgICAgICAgY29sdW1ucy5wdXNoKGAkJHtpbmRleH06bmFtZWApO1xuICAgICAgICAgICAgdmFsdWVzLnB1c2goZmllbGQpO1xuICAgICAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kbWF0Y2gpIHtcbiAgICAgICAgY29uc3QgcGF0dGVybnMgPSBbXTtcbiAgICAgICAgY29uc3Qgb3JPckFuZCA9IHN0YWdlLiRtYXRjaC5oYXNPd25Qcm9wZXJ0eSgnJG9yJykgPyAnIE9SICcgOiAnIEFORCAnO1xuXG4gICAgICAgIGlmIChzdGFnZS4kbWF0Y2guJG9yKSB7XG4gICAgICAgICAgY29uc3QgY29sbGFwc2UgPSB7fTtcbiAgICAgICAgICBzdGFnZS4kbWF0Y2guJG9yLmZvckVhY2goKGVsZW1lbnQpID0+IHtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGVsZW1lbnQpIHtcbiAgICAgICAgICAgICAgY29sbGFwc2Vba2V5XSA9IGVsZW1lbnRba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9KTtcbiAgICAgICAgICBzdGFnZS4kbWF0Y2ggPSBjb2xsYXBzZTtcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHN0YWdlLiRtYXRjaCkge1xuICAgICAgICAgIGNvbnN0IHZhbHVlID0gc3RhZ2UuJG1hdGNoW2ZpZWxkXTtcbiAgICAgICAgICBjb25zdCBtYXRjaFBhdHRlcm5zID0gW107XG4gICAgICAgICAgT2JqZWN0LmtleXMoUGFyc2VUb1Bvc2dyZXNDb21wYXJhdG9yKS5mb3JFYWNoKChjbXApID0+IHtcbiAgICAgICAgICAgIGlmICh2YWx1ZVtjbXBdKSB7XG4gICAgICAgICAgICAgIGNvbnN0IHBnQ29tcGFyYXRvciA9IFBhcnNlVG9Qb3NncmVzQ29tcGFyYXRvcltjbXBdO1xuICAgICAgICAgICAgICBtYXRjaFBhdHRlcm5zLnB1c2goYCQke2luZGV4fTpuYW1lICR7cGdDb21wYXJhdG9yfSAkJHtpbmRleCArIDF9YCk7XG4gICAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkLCB0b1Bvc3RncmVzVmFsdWUodmFsdWVbY21wXSkpO1xuICAgICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0pO1xuICAgICAgICAgIGlmIChtYXRjaFBhdHRlcm5zLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgIHBhdHRlcm5zLnB1c2goYCgke21hdGNoUGF0dGVybnMuam9pbignIEFORCAnKX0pYCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlICYmIG1hdGNoUGF0dGVybnMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICBwYXR0ZXJucy5wdXNoKGAkJHtpbmRleH06bmFtZSA9ICQke2luZGV4ICsgMX1gKTtcbiAgICAgICAgICAgIHZhbHVlcy5wdXNoKGZpZWxkLCB2YWx1ZSk7XG4gICAgICAgICAgICBpbmRleCArPSAyO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB3aGVyZVBhdHRlcm4gPSBwYXR0ZXJucy5sZW5ndGggPiAwID8gYFdIRVJFICR7cGF0dGVybnMuam9pbihgICR7b3JPckFuZH0gYCl9YCA6ICcnO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRsaW1pdCkge1xuICAgICAgICBsaW1pdFBhdHRlcm4gPSBgTElNSVQgJCR7aW5kZXh9YDtcbiAgICAgICAgdmFsdWVzLnB1c2goc3RhZ2UuJGxpbWl0KTtcbiAgICAgICAgaW5kZXggKz0gMTtcbiAgICAgIH1cbiAgICAgIGlmIChzdGFnZS4kc2tpcCkge1xuICAgICAgICBza2lwUGF0dGVybiA9IGBPRkZTRVQgJCR7aW5kZXh9YDtcbiAgICAgICAgdmFsdWVzLnB1c2goc3RhZ2UuJHNraXApO1xuICAgICAgICBpbmRleCArPSAxO1xuICAgICAgfVxuICAgICAgaWYgKHN0YWdlLiRzb3J0KSB7XG4gICAgICAgIGNvbnN0IHNvcnQgPSBzdGFnZS4kc29ydDtcbiAgICAgICAgY29uc3Qga2V5cyA9IE9iamVjdC5rZXlzKHNvcnQpO1xuICAgICAgICBjb25zdCBzb3J0aW5nID0ga2V5cy5tYXAoKGtleSkgPT4ge1xuICAgICAgICAgIGNvbnN0IHRyYW5zZm9ybWVyID0gc29ydFtrZXldID09PSAxID8gJ0FTQycgOiAnREVTQyc7XG4gICAgICAgICAgY29uc3Qgb3JkZXIgPSBgJCR7aW5kZXh9Om5hbWUgJHt0cmFuc2Zvcm1lcn1gO1xuICAgICAgICAgIGluZGV4ICs9IDE7XG4gICAgICAgICAgcmV0dXJuIG9yZGVyO1xuICAgICAgICB9KS5qb2luKCk7XG4gICAgICAgIHZhbHVlcy5wdXNoKC4uLmtleXMpO1xuICAgICAgICBzb3J0UGF0dGVybiA9IHNvcnQgIT09IHVuZGVmaW5lZCAmJiBzb3J0aW5nLmxlbmd0aCA+IDAgPyBgT1JERVIgQlkgJHtzb3J0aW5nfWAgOiAnJztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBxcyA9IGBTRUxFQ1QgJHtjb2x1bW5zLmpvaW4oKX0gRlJPTSAkMTpuYW1lICR7d2hlcmVQYXR0ZXJufSAke3NvcnRQYXR0ZXJufSAke2xpbWl0UGF0dGVybn0gJHtza2lwUGF0dGVybn0gJHtncm91cFBhdHRlcm59YDtcbiAgICBkZWJ1ZyhxcywgdmFsdWVzKTtcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50Lm1hcChxcywgdmFsdWVzLCBhID0+IHRoaXMucG9zdGdyZXNPYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgYSwgc2NoZW1hKSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICByZXN1bHRzLmZvckVhY2gocmVzdWx0ID0+IHtcbiAgICAgICAgICBpZiAoIXJlc3VsdC5oYXNPd25Qcm9wZXJ0eSgnb2JqZWN0SWQnKSkge1xuICAgICAgICAgICAgcmVzdWx0Lm9iamVjdElkID0gbnVsbDtcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGdyb3VwVmFsdWVzKSB7XG4gICAgICAgICAgICByZXN1bHQub2JqZWN0SWQgPSB7fTtcbiAgICAgICAgICAgIGZvciAoY29uc3Qga2V5IGluIGdyb3VwVmFsdWVzKSB7XG4gICAgICAgICAgICAgIHJlc3VsdC5vYmplY3RJZFtrZXldID0gcmVzdWx0W2tleV07XG4gICAgICAgICAgICAgIGRlbGV0ZSByZXN1bHRba2V5XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKGNvdW50RmllbGQpIHtcbiAgICAgICAgICAgIHJlc3VsdFtjb3VudEZpZWxkXSA9IHBhcnNlSW50KHJlc3VsdFtjb3VudEZpZWxkXSwgMTApO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiByZXN1bHRzO1xuICAgICAgfSk7XG4gIH1cblxuICBwZXJmb3JtSW5pdGlhbGl6YXRpb24oeyBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzIH06IGFueSkge1xuICAgIC8vIFRPRE86IFRoaXMgbWV0aG9kIG5lZWRzIHRvIGJlIHJld3JpdHRlbiB0byBtYWtlIHByb3BlciB1c2Ugb2YgY29ubmVjdGlvbnMgKEB2aXRhbHktdClcbiAgICBkZWJ1ZygncGVyZm9ybUluaXRpYWxpemF0aW9uJyk7XG4gICAgY29uc3QgcHJvbWlzZXMgPSBWb2xhdGlsZUNsYXNzZXNTY2hlbWFzLm1hcCgoc2NoZW1hKSA9PiB7XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVUYWJsZShzY2hlbWEuY2xhc3NOYW1lLCBzY2hlbWEpXG4gICAgICAgIC5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICAgICAgaWYgKGVyci5jb2RlID09PSBQb3N0Z3Jlc0R1cGxpY2F0ZVJlbGF0aW9uRXJyb3IgfHwgZXJyLmNvZGUgPT09IFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSkge1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH0pXG4gICAgICAgIC50aGVuKCgpID0+IHRoaXMuc2NoZW1hVXBncmFkZShzY2hlbWEuY2xhc3NOYW1lLCBzY2hlbWEpKTtcbiAgICB9KTtcbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLl9jbGllbnQudHgoJ3BlcmZvcm0taW5pdGlhbGl6YXRpb24nLCB0ID0+IHtcbiAgICAgICAgICByZXR1cm4gdC5iYXRjaChbXG4gICAgICAgICAgICB0Lm5vbmUoc3FsLm1pc2MuanNvbk9iamVjdFNldEtleXMpLFxuICAgICAgICAgICAgdC5ub25lKHNxbC5hcnJheS5hZGQpLFxuICAgICAgICAgICAgdC5ub25lKHNxbC5hcnJheS5hZGRVbmlxdWUpLFxuICAgICAgICAgICAgdC5ub25lKHNxbC5hcnJheS5yZW1vdmUpLFxuICAgICAgICAgICAgdC5ub25lKHNxbC5hcnJheS5jb250YWluc0FsbCksXG4gICAgICAgICAgICB0Lm5vbmUoc3FsLmFycmF5LmNvbnRhaW5zQWxsUmVnZXgpLFxuICAgICAgICAgICAgdC5ub25lKHNxbC5hcnJheS5jb250YWlucylcbiAgICAgICAgICBdKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLnRoZW4oZGF0YSA9PiB7XG4gICAgICAgIGRlYnVnKGBpbml0aWFsaXphdGlvbkRvbmUgaW4gJHtkYXRhLmR1cmF0aW9ufWApO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIC8qIGVzbGludC1kaXNhYmxlIG5vLWNvbnNvbGUgKi9cbiAgICAgICAgY29uc29sZS5lcnJvcihlcnJvcik7XG4gICAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4ZXM6IGFueSwgY29ubjogP2FueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiAoY29ubiB8fCB0aGlzLl9jbGllbnQpLnR4KHQgPT4gdC5iYXRjaChpbmRleGVzLm1hcChpID0+IHtcbiAgICAgIHJldHVybiB0Lm5vbmUoJ0NSRUFURSBJTkRFWCAkMTpuYW1lIE9OICQyOm5hbWUgKCQzOm5hbWUpJywgW2kubmFtZSwgY2xhc3NOYW1lLCBpLmtleV0pO1xuICAgIH0pKSk7XG4gIH1cblxuICBjcmVhdGVJbmRleGVzSWZOZWVkZWQoY2xhc3NOYW1lOiBzdHJpbmcsIGZpZWxkTmFtZTogc3RyaW5nLCB0eXBlOiBhbnksIGNvbm46ID9hbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gKGNvbm4gfHwgdGhpcy5fY2xpZW50KS5ub25lKCdDUkVBVEUgSU5ERVggJDE6bmFtZSBPTiAkMjpuYW1lICgkMzpuYW1lKScsIFtmaWVsZE5hbWUsIGNsYXNzTmFtZSwgdHlwZV0pO1xuICB9XG5cbiAgZHJvcEluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4ZXM6IGFueSwgY29ubjogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcXVlcmllcyA9IGluZGV4ZXMubWFwKGkgPT4gKHtxdWVyeTogJ0RST1AgSU5ERVggJDE6bmFtZScsIHZhbHVlczogaX0pKTtcbiAgICByZXR1cm4gKGNvbm4gfHwgdGhpcy5fY2xpZW50KS50eCh0ID0+IHQubm9uZSh0aGlzLl9wZ3AuaGVscGVycy5jb25jYXQocXVlcmllcykpKTtcbiAgfVxuXG4gIGdldEluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICBjb25zdCBxcyA9ICdTRUxFQ1QgKiBGUk9NIHBnX2luZGV4ZXMgV0hFUkUgdGFibGVuYW1lID0gJHtjbGFzc05hbWV9JztcbiAgICByZXR1cm4gdGhpcy5fY2xpZW50LmFueShxcywge2NsYXNzTmFtZX0pO1xuICB9XG5cbiAgdXBkYXRlU2NoZW1hV2l0aEluZGV4ZXMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59XG5cbmZ1bmN0aW9uIGNvbnZlcnRQb2x5Z29uVG9TUUwocG9seWdvbikge1xuICBpZiAocG9seWdvbi5sZW5ndGggPCAzKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgYFBvbHlnb24gbXVzdCBoYXZlIGF0IGxlYXN0IDMgdmFsdWVzYFxuICAgICk7XG4gIH1cbiAgaWYgKHBvbHlnb25bMF1bMF0gIT09IHBvbHlnb25bcG9seWdvbi5sZW5ndGggLSAxXVswXSB8fFxuICAgIHBvbHlnb25bMF1bMV0gIT09IHBvbHlnb25bcG9seWdvbi5sZW5ndGggLSAxXVsxXSkge1xuICAgIHBvbHlnb24ucHVzaChwb2x5Z29uWzBdKTtcbiAgfVxuICBjb25zdCB1bmlxdWUgPSBwb2x5Z29uLmZpbHRlcigoaXRlbSwgaW5kZXgsIGFyKSA9PiB7XG4gICAgbGV0IGZvdW5kSW5kZXggPSAtMTtcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFyLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICBjb25zdCBwdCA9IGFyW2ldO1xuICAgICAgaWYgKHB0WzBdID09PSBpdGVtWzBdICYmXG4gICAgICAgICAgcHRbMV0gPT09IGl0ZW1bMV0pIHtcbiAgICAgICAgZm91bmRJbmRleCA9IGk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZm91bmRJbmRleCA9PT0gaW5kZXg7XG4gIH0pO1xuICBpZiAodW5pcXVlLmxlbmd0aCA8IDMpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAnR2VvSlNPTjogTG9vcCBtdXN0IGhhdmUgYXQgbGVhc3QgMyBkaWZmZXJlbnQgdmVydGljZXMnXG4gICAgKTtcbiAgfVxuICBjb25zdCBwb2ludHMgPSBwb2x5Z29uLm1hcCgocG9pbnQpID0+IHtcbiAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocGFyc2VGbG9hdChwb2ludFsxXSksIHBhcnNlRmxvYXQocG9pbnRbMF0pKTtcbiAgICByZXR1cm4gYCgke3BvaW50WzFdfSwgJHtwb2ludFswXX0pYDtcbiAgfSkuam9pbignLCAnKTtcbiAgcmV0dXJuIGAoJHtwb2ludHN9KWA7XG59XG5cbmZ1bmN0aW9uIHJlbW92ZVdoaXRlU3BhY2UocmVnZXgpIHtcbiAgaWYgKCFyZWdleC5lbmRzV2l0aCgnXFxuJykpe1xuICAgIHJlZ2V4ICs9ICdcXG4nO1xuICB9XG5cbiAgLy8gcmVtb3ZlIG5vbiBlc2NhcGVkIGNvbW1lbnRzXG4gIHJldHVybiByZWdleC5yZXBsYWNlKC8oW15cXFxcXSkjLipcXG4vZ21pLCAnJDEnKVxuICAgIC8vIHJlbW92ZSBsaW5lcyBzdGFydGluZyB3aXRoIGEgY29tbWVudFxuICAgIC5yZXBsYWNlKC9eIy4qXFxuL2dtaSwgJycpXG4gICAgLy8gcmVtb3ZlIG5vbiBlc2NhcGVkIHdoaXRlc3BhY2VcbiAgICAucmVwbGFjZSgvKFteXFxcXF0pXFxzKy9nbWksICckMScpXG4gICAgLy8gcmVtb3ZlIHdoaXRlc3BhY2UgYXQgdGhlIGJlZ2lubmluZyBvZiBhIGxpbmVcbiAgICAucmVwbGFjZSgvXlxccysvLCAnJylcbiAgICAudHJpbSgpO1xufVxuXG5mdW5jdGlvbiBwcm9jZXNzUmVnZXhQYXR0ZXJuKHMpIHtcbiAgaWYgKHMgJiYgcy5zdGFydHNXaXRoKCdeJykpe1xuICAgIC8vIHJlZ2V4IGZvciBzdGFydHNXaXRoXG4gICAgcmV0dXJuICdeJyArIGxpdGVyYWxpemVSZWdleFBhcnQocy5zbGljZSgxKSk7XG5cbiAgfSBlbHNlIGlmIChzICYmIHMuZW5kc1dpdGgoJyQnKSkge1xuICAgIC8vIHJlZ2V4IGZvciBlbmRzV2l0aFxuICAgIHJldHVybiBsaXRlcmFsaXplUmVnZXhQYXJ0KHMuc2xpY2UoMCwgcy5sZW5ndGggLSAxKSkgKyAnJCc7XG4gIH1cblxuICAvLyByZWdleCBmb3IgY29udGFpbnNcbiAgcmV0dXJuIGxpdGVyYWxpemVSZWdleFBhcnQocyk7XG59XG5cbmZ1bmN0aW9uIGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlKSB7XG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJyB8fCAhdmFsdWUuc3RhcnRzV2l0aCgnXicpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgY29uc3QgbWF0Y2hlcyA9IHZhbHVlLm1hdGNoKC9cXF5cXFxcUS4qXFxcXEUvKTtcbiAgcmV0dXJuICEhbWF0Y2hlcztcbn1cblxuZnVuY3Rpb24gaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSh2YWx1ZXMpIHtcbiAgaWYgKCF2YWx1ZXMgfHwgIUFycmF5LmlzQXJyYXkodmFsdWVzKSB8fCB2YWx1ZXMubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBjb25zdCBmaXJzdFZhbHVlc0lzUmVnZXggPSBpc1N0YXJ0c1dpdGhSZWdleCh2YWx1ZXNbMF0uJHJlZ2V4KTtcbiAgaWYgKHZhbHVlcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gZmlyc3RWYWx1ZXNJc1JlZ2V4O1xuICB9XG5cbiAgZm9yIChsZXQgaSA9IDEsIGxlbmd0aCA9IHZhbHVlcy5sZW5ndGg7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIGlmIChmaXJzdFZhbHVlc0lzUmVnZXggIT09IGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlc1tpXS4kcmVnZXgpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRydWU7XG59XG5cbmZ1bmN0aW9uIGlzQW55VmFsdWVSZWdleFN0YXJ0c1dpdGgodmFsdWVzKSB7XG4gIHJldHVybiB2YWx1ZXMuc29tZShmdW5jdGlvbiAodmFsdWUpIHtcbiAgICByZXR1cm4gaXNTdGFydHNXaXRoUmVnZXgodmFsdWUuJHJlZ2V4KTtcbiAgfSk7XG59XG5cbmZ1bmN0aW9uIGNyZWF0ZUxpdGVyYWxSZWdleChyZW1haW5pbmcpIHtcbiAgcmV0dXJuIHJlbWFpbmluZy5zcGxpdCgnJykubWFwKGMgPT4ge1xuICAgIGlmIChjLm1hdGNoKC9bMC05YS16QS1aXS8pICE9PSBudWxsKSB7XG4gICAgICAvLyBkb24ndCBlc2NhcGUgYWxwaGFudW1lcmljIGNoYXJhY3RlcnNcbiAgICAgIHJldHVybiBjO1xuICAgIH1cbiAgICAvLyBlc2NhcGUgZXZlcnl0aGluZyBlbHNlIChzaW5nbGUgcXVvdGVzIHdpdGggc2luZ2xlIHF1b3RlcywgZXZlcnl0aGluZyBlbHNlIHdpdGggYSBiYWNrc2xhc2gpXG4gICAgcmV0dXJuIGMgPT09IGAnYCA/IGAnJ2AgOiBgXFxcXCR7Y31gO1xuICB9KS5qb2luKCcnKTtcbn1cblxuZnVuY3Rpb24gbGl0ZXJhbGl6ZVJlZ2V4UGFydChzOiBzdHJpbmcpIHtcbiAgY29uc3QgbWF0Y2hlcjEgPSAvXFxcXFEoKD8hXFxcXEUpLiopXFxcXEUkL1xuICBjb25zdCByZXN1bHQxOiBhbnkgPSBzLm1hdGNoKG1hdGNoZXIxKTtcbiAgaWYocmVzdWx0MSAmJiByZXN1bHQxLmxlbmd0aCA+IDEgJiYgcmVzdWx0MS5pbmRleCA+IC0xKSB7XG4gICAgLy8gcHJvY2VzcyByZWdleCB0aGF0IGhhcyBhIGJlZ2lubmluZyBhbmQgYW4gZW5kIHNwZWNpZmllZCBmb3IgdGhlIGxpdGVyYWwgdGV4dFxuICAgIGNvbnN0IHByZWZpeCA9IHMuc3Vic3RyKDAsIHJlc3VsdDEuaW5kZXgpO1xuICAgIGNvbnN0IHJlbWFpbmluZyA9IHJlc3VsdDFbMV07XG5cbiAgICByZXR1cm4gbGl0ZXJhbGl6ZVJlZ2V4UGFydChwcmVmaXgpICsgY3JlYXRlTGl0ZXJhbFJlZ2V4KHJlbWFpbmluZyk7XG4gIH1cblxuICAvLyBwcm9jZXNzIHJlZ2V4IHRoYXQgaGFzIGEgYmVnaW5uaW5nIHNwZWNpZmllZCBmb3IgdGhlIGxpdGVyYWwgdGV4dFxuICBjb25zdCBtYXRjaGVyMiA9IC9cXFxcUSgoPyFcXFxcRSkuKikkL1xuICBjb25zdCByZXN1bHQyOiBhbnkgPSBzLm1hdGNoKG1hdGNoZXIyKTtcbiAgaWYocmVzdWx0MiAmJiByZXN1bHQyLmxlbmd0aCA+IDEgJiYgcmVzdWx0Mi5pbmRleCA+IC0xKXtcbiAgICBjb25zdCBwcmVmaXggPSBzLnN1YnN0cigwLCByZXN1bHQyLmluZGV4KTtcbiAgICBjb25zdCByZW1haW5pbmcgPSByZXN1bHQyWzFdO1xuXG4gICAgcmV0dXJuIGxpdGVyYWxpemVSZWdleFBhcnQocHJlZml4KSArIGNyZWF0ZUxpdGVyYWxSZWdleChyZW1haW5pbmcpO1xuICB9XG5cbiAgLy8gcmVtb3ZlIGFsbCBpbnN0YW5jZXMgb2YgXFxRIGFuZCBcXEUgZnJvbSB0aGUgcmVtYWluaW5nIHRleHQgJiBlc2NhcGUgc2luZ2xlIHF1b3Rlc1xuICByZXR1cm4gKFxuICAgIHMucmVwbGFjZSgvKFteXFxcXF0pKFxcXFxFKS8sICckMScpXG4gICAgICAucmVwbGFjZSgvKFteXFxcXF0pKFxcXFxRKS8sICckMScpXG4gICAgICAucmVwbGFjZSgvXlxcXFxFLywgJycpXG4gICAgICAucmVwbGFjZSgvXlxcXFxRLywgJycpXG4gICAgICAucmVwbGFjZSgvKFteJ10pJy8sIGAkMScnYClcbiAgICAgIC5yZXBsYWNlKC9eJyhbXiddKS8sIGAnJyQxYClcbiAgKTtcbn1cblxudmFyIEdlb1BvaW50Q29kZXIgPSB7XG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgICAgdmFsdWUuX190eXBlID09PSAnR2VvUG9pbnQnXG4gICAgKTtcbiAgfVxufTtcblxuZXhwb3J0IGRlZmF1bHQgUG9zdGdyZXNTdG9yYWdlQWRhcHRlcjtcbiJdfQ==