'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _logger = require('../../../logger');

var _logger2 = _interopRequireDefault(_logger);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var mongodb = require('mongodb');
var Parse = require('parse/node').Parse;

const transformKey = (className, fieldName, schema) => {
  // Check if the schema is known since it's a built-in field.
  switch (fieldName) {
    case 'objectId':
      return '_id';
    case 'createdAt':
      return '_created_at';
    case 'updatedAt':
      return '_updated_at';
    case 'sessionToken':
      return '_session_token';
    case 'lastUsed':
      return '_last_used';
    case 'timesUsed':
      return 'times_used';
  }

  if (schema.fields[fieldName] && schema.fields[fieldName].__type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  } else if (schema.fields[fieldName] && schema.fields[fieldName].type == 'Pointer') {
    fieldName = '_p_' + fieldName;
  }

  return fieldName;
};

const transformKeyValueForUpdate = (className, restKey, restValue, parseFormatSchema) => {
  // Check if the schema is known since it's a built-in field.
  var key = restKey;
  var timeField = false;
  switch (key) {
    case 'objectId':
    case '_id':
      if (className === '_GlobalConfig') {
        return {
          key: key,
          value: parseInt(restValue)
        };
      }
      key = '_id';
      break;
    case 'createdAt':
    case '_created_at':
      key = '_created_at';
      timeField = true;
      break;
    case 'updatedAt':
    case '_updated_at':
      key = '_updated_at';
      timeField = true;
      break;
    case 'sessionToken':
    case '_session_token':
      key = '_session_token';
      break;
    case 'expiresAt':
    case '_expiresAt':
      key = 'expiresAt';
      timeField = true;
      break;
    case '_email_verify_token_expires_at':
      key = '_email_verify_token_expires_at';
      timeField = true;
      break;
    case '_account_lockout_expires_at':
      key = '_account_lockout_expires_at';
      timeField = true;
      break;
    case '_failed_login_count':
      key = '_failed_login_count';
      break;
    case '_perishable_token_expires_at':
      key = '_perishable_token_expires_at';
      timeField = true;
      break;
    case '_password_changed_at':
      key = '_password_changed_at';
      timeField = true;
      break;
    case '_rperm':
    case '_wperm':
      return { key: key, value: restValue };
    case 'lastUsed':
    case '_last_used':
      key = '_last_used';
      timeField = true;
      break;
    case 'timesUsed':
    case 'times_used':
      key = 'times_used';
      timeField = true;
      break;
  }

  if (parseFormatSchema.fields[key] && parseFormatSchema.fields[key].type === 'Pointer' || !parseFormatSchema.fields[key] && restValue && restValue.__type == 'Pointer') {
    key = '_p_' + key;
  }

  // Handle atomic values
  var value = transformTopLevelAtom(restValue);
  if (value !== CannotTransform) {
    if (timeField && typeof value === 'string') {
      value = new Date(value);
    }
    if (restKey.indexOf('.') > 0) {
      return { key, value: restValue };
    }
    return { key, value };
  }

  // Handle arrays
  if (restValue instanceof Array) {
    value = restValue.map(transformInteriorValue);
    return { key, value };
  }

  // Handle update operators
  if (typeof restValue === 'object' && '__op' in restValue) {
    return { key, value: transformUpdateOperator(restValue, false) };
  }

  // Handle normal objects by recursing
  value = mapValues(restValue, transformInteriorValue);
  return { key, value };
};

const isRegex = value => {
  return value && value instanceof RegExp;
};

const isStartsWithRegex = value => {
  if (!isRegex(value)) {
    return false;
  }

  const matches = value.toString().match(/\/\^\\Q.*\\E\//);
  return !!matches;
};

const isAllValuesRegexOrNone = values => {
  if (!values || !Array.isArray(values) || values.length === 0) {
    return true;
  }

  const firstValuesIsRegex = isStartsWithRegex(values[0]);
  if (values.length === 1) {
    return firstValuesIsRegex;
  }

  for (let i = 1, length = values.length; i < length; ++i) {
    if (firstValuesIsRegex !== isStartsWithRegex(values[i])) {
      return false;
    }
  }

  return true;
};

const isAnyValueRegex = values => {
  return values.some(function (value) {
    return isRegex(value);
  });
};

const transformInteriorValue = restValue => {
  if (restValue !== null && typeof restValue === 'object' && Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  }
  // Handle atomic values
  var value = transformInteriorAtom(restValue);
  if (value !== CannotTransform) {
    return value;
  }

  // Handle arrays
  if (restValue instanceof Array) {
    return restValue.map(transformInteriorValue);
  }

  // Handle update operators
  if (typeof restValue === 'object' && '__op' in restValue) {
    return transformUpdateOperator(restValue, true);
  }

  // Handle normal objects by recursing
  return mapValues(restValue, transformInteriorValue);
};

const valueAsDate = value => {
  if (typeof value === 'string') {
    return new Date(value);
  } else if (value instanceof Date) {
    return value;
  }
  return false;
};

function transformQueryKeyValue(className, key, value, schema) {
  switch (key) {
    case 'createdAt':
      if (valueAsDate(value)) {
        return { key: '_created_at', value: valueAsDate(value) };
      }
      key = '_created_at';
      break;
    case 'updatedAt':
      if (valueAsDate(value)) {
        return { key: '_updated_at', value: valueAsDate(value) };
      }
      key = '_updated_at';
      break;
    case 'expiresAt':
      if (valueAsDate(value)) {
        return { key: 'expiresAt', value: valueAsDate(value) };
      }
      break;
    case '_email_verify_token_expires_at':
      if (valueAsDate(value)) {
        return { key: '_email_verify_token_expires_at', value: valueAsDate(value) };
      }
      break;
    case 'objectId':
      {
        if (className === '_GlobalConfig') {
          value = parseInt(value);
        }
        return { key: '_id', value };
      }
    case '_account_lockout_expires_at':
      if (valueAsDate(value)) {
        return { key: '_account_lockout_expires_at', value: valueAsDate(value) };
      }
      break;
    case '_failed_login_count':
      return { key, value };
    case 'sessionToken':
      return { key: '_session_token', value };
    case '_perishable_token_expires_at':
      if (valueAsDate(value)) {
        return { key: '_perishable_token_expires_at', value: valueAsDate(value) };
      }
      break;
    case '_password_changed_at':
      if (valueAsDate(value)) {
        return { key: '_password_changed_at', value: valueAsDate(value) };
      }
      break;
    case '_rperm':
    case '_wperm':
    case '_perishable_token':
    case '_email_verify_token':
      return { key, value };
    case '$or':
    case '$and':
    case '$nor':
      return { key: key, value: value.map(subQuery => transformWhere(className, subQuery, schema)) };
    case 'lastUsed':
      if (valueAsDate(value)) {
        return { key: '_last_used', value: valueAsDate(value) };
      }
      key = '_last_used';
      break;
    case 'timesUsed':
      return { key: 'times_used', value: value };
    default:
      {
        // Other auth data
        const authDataMatch = key.match(/^authData\.([a-zA-Z0-9_]+)\.id$/);
        if (authDataMatch) {
          const provider = authDataMatch[1];
          // Special-case auth data.
          return { key: `_auth_data_${provider}.id`, value };
        }
      }
  }

  const expectedTypeIsArray = schema && schema.fields[key] && schema.fields[key].type === 'Array';

  const expectedTypeIsPointer = schema && schema.fields[key] && schema.fields[key].type === 'Pointer';

  const field = schema && schema.fields[key];
  if (expectedTypeIsPointer || !schema && value && value.__type === 'Pointer') {
    key = '_p_' + key;
  }

  // Handle query constraints
  const transformedConstraint = transformConstraint(value, field);
  if (transformedConstraint !== CannotTransform) {
    if (transformedConstraint.$text) {
      return { key: '$text', value: transformedConstraint.$text };
    }
    if (transformedConstraint.$elemMatch) {
      return { key: '$nor', value: [{ [key]: transformedConstraint }] };
    }
    return { key, value: transformedConstraint };
  }

  if (expectedTypeIsArray && !(value instanceof Array)) {
    return { key, value: { '$all': [transformInteriorAtom(value)] } };
  }

  // Handle atomic values
  if (transformTopLevelAtom(value) !== CannotTransform) {
    return { key, value: transformTopLevelAtom(value) };
  } else {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `You cannot use ${value} as a query parameter.`);
  }
}

// Main exposed method to help run queries.
// restWhere is the "where" clause in REST API form.
// Returns the mongo form of the query.
function transformWhere(className, restWhere, schema) {
  const mongoWhere = {};
  for (const restKey in restWhere) {
    const out = transformQueryKeyValue(className, restKey, restWhere[restKey], schema);
    mongoWhere[out.key] = out.value;
  }
  return mongoWhere;
}

const parseObjectKeyValueToMongoObjectKeyValue = (restKey, restValue, schema) => {
  // Check if the schema is known since it's a built-in field.
  let transformedValue;
  let coercedToDate;
  switch (restKey) {
    case 'objectId':
      return { key: '_id', value: restValue };
    case 'expiresAt':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: 'expiresAt', value: coercedToDate };
    case '_email_verify_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_email_verify_token_expires_at', value: coercedToDate };
    case '_account_lockout_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_account_lockout_expires_at', value: coercedToDate };
    case '_perishable_token_expires_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_perishable_token_expires_at', value: coercedToDate };
    case '_password_changed_at':
      transformedValue = transformTopLevelAtom(restValue);
      coercedToDate = typeof transformedValue === 'string' ? new Date(transformedValue) : transformedValue;
      return { key: '_password_changed_at', value: coercedToDate };
    case '_failed_login_count':
    case '_rperm':
    case '_wperm':
    case '_email_verify_token':
    case '_hashed_password':
    case '_perishable_token':
      return { key: restKey, value: restValue };
    case 'sessionToken':
      return { key: '_session_token', value: restValue };
    default:
      // Auth data should have been transformed already
      if (restKey.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
        throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'can only query on ' + restKey);
      }
      // Trust that the auth data has been transformed and save it directly
      if (restKey.match(/^_auth_data_[a-zA-Z0-9_]+$/)) {
        return { key: restKey, value: restValue };
      }
  }
  //skip straight to transformTopLevelAtom for Bytes, they don't show up in the schema for some reason
  if (restValue && restValue.__type !== 'Bytes') {
    //Note: We may not know the type of a field here, as the user could be saving (null) to a field
    //That never existed before, meaning we can't infer the type.
    if (schema.fields[restKey] && schema.fields[restKey].type == 'Pointer' || restValue.__type == 'Pointer') {
      restKey = '_p_' + restKey;
    }
  }

  // Handle atomic values
  var value = transformTopLevelAtom(restValue);
  if (value !== CannotTransform) {
    return { key: restKey, value: value };
  }

  // ACLs are handled before this method is called
  // If an ACL key still exists here, something is wrong.
  if (restKey === 'ACL') {
    throw 'There was a problem transforming an ACL.';
  }

  // Handle arrays
  if (restValue instanceof Array) {
    value = restValue.map(transformInteriorValue);
    return { key: restKey, value: value };
  }

  // Handle normal objects by recursing
  if (Object.keys(restValue).some(key => key.includes('$') || key.includes('.'))) {
    throw new Parse.Error(Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
  }
  value = mapValues(restValue, transformInteriorValue);
  return { key: restKey, value };
};

const parseObjectToMongoObjectForCreate = (className, restCreate, schema) => {
  restCreate = addLegacyACL(restCreate);
  const mongoCreate = {};
  for (const restKey in restCreate) {
    if (restCreate[restKey] && restCreate[restKey].__type === 'Relation') {
      continue;
    }
    const { key, value } = parseObjectKeyValueToMongoObjectKeyValue(restKey, restCreate[restKey], schema);
    if (value !== undefined) {
      mongoCreate[key] = value;
    }
  }

  // Use the legacy mongo format for createdAt and updatedAt
  if (mongoCreate.createdAt) {
    mongoCreate._created_at = new Date(mongoCreate.createdAt.iso || mongoCreate.createdAt);
    delete mongoCreate.createdAt;
  }
  if (mongoCreate.updatedAt) {
    mongoCreate._updated_at = new Date(mongoCreate.updatedAt.iso || mongoCreate.updatedAt);
    delete mongoCreate.updatedAt;
  }

  return mongoCreate;
};

// Main exposed method to help update old objects.
const transformUpdate = (className, restUpdate, parseFormatSchema) => {
  const mongoUpdate = {};
  const acl = addLegacyACL(restUpdate);
  if (acl._rperm || acl._wperm || acl._acl) {
    mongoUpdate.$set = {};
    if (acl._rperm) {
      mongoUpdate.$set._rperm = acl._rperm;
    }
    if (acl._wperm) {
      mongoUpdate.$set._wperm = acl._wperm;
    }
    if (acl._acl) {
      mongoUpdate.$set._acl = acl._acl;
    }
  }
  for (var restKey in restUpdate) {
    if (restUpdate[restKey] && restUpdate[restKey].__type === 'Relation') {
      continue;
    }
    var out = transformKeyValueForUpdate(className, restKey, restUpdate[restKey], parseFormatSchema);

    // If the output value is an object with any $ keys, it's an
    // operator that needs to be lifted onto the top level update
    // object.
    if (typeof out.value === 'object' && out.value !== null && out.value.__op) {
      mongoUpdate[out.value.__op] = mongoUpdate[out.value.__op] || {};
      mongoUpdate[out.value.__op][out.key] = out.value.arg;
    } else {
      mongoUpdate['$set'] = mongoUpdate['$set'] || {};
      mongoUpdate['$set'][out.key] = out.value;
    }
  }

  return mongoUpdate;
};

// Add the legacy _acl format.
const addLegacyACL = restObject => {
  const restObjectCopy = _extends({}, restObject);
  const _acl = {};

  if (restObject._wperm) {
    restObject._wperm.forEach(entry => {
      _acl[entry] = { w: true };
    });
    restObjectCopy._acl = _acl;
  }

  if (restObject._rperm) {
    restObject._rperm.forEach(entry => {
      if (!(entry in _acl)) {
        _acl[entry] = { r: true };
      } else {
        _acl[entry].r = true;
      }
    });
    restObjectCopy._acl = _acl;
  }

  return restObjectCopy;
};

// A sentinel value that helper transformations return when they
// cannot perform a transformation
function CannotTransform() {}

const transformInteriorAtom = atom => {
  // TODO: check validity harder for the __type-defined types
  if (typeof atom === 'object' && atom && !(atom instanceof Date) && atom.__type === 'Pointer') {
    return {
      __type: 'Pointer',
      className: atom.className,
      objectId: atom.objectId
    };
  } else if (typeof atom === 'function' || typeof atom === 'symbol') {
    throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);
  } else if (DateCoder.isValidJSON(atom)) {
    return DateCoder.JSONToDatabase(atom);
  } else if (BytesCoder.isValidJSON(atom)) {
    return BytesCoder.JSONToDatabase(atom);
  } else if (typeof atom === 'object' && atom && atom.$regex !== undefined) {
    return new RegExp(atom.$regex);
  } else {
    return atom;
  }
};

// Helper function to transform an atom from REST format to Mongo format.
// An atom is anything that can't contain other expressions. So it
// includes things where objects are used to represent other
// datatypes, like pointers and dates, but it does not include objects
// or arrays with generic stuff inside.
// Raises an error if this cannot possibly be valid REST format.
// Returns CannotTransform if it's just not an atom
function transformTopLevelAtom(atom, field) {
  switch (typeof atom) {
    case 'number':
    case 'boolean':
    case 'undefined':
      return atom;
    case 'string':
      if (field && field.type === 'Pointer') {
        return `${field.targetClass}$${atom}`;
      }
      return atom;
    case 'symbol':
    case 'function':
      throw new Parse.Error(Parse.Error.INVALID_JSON, `cannot transform value: ${atom}`);
    case 'object':
      if (atom instanceof Date) {
        // Technically dates are not rest format, but, it seems pretty
        // clear what they should be transformed to, so let's just do it.
        return atom;
      }

      if (atom === null) {
        return atom;
      }

      // TODO: check validity harder for the __type-defined types
      if (atom.__type == 'Pointer') {
        return `${atom.className}$${atom.objectId}`;
      }
      if (DateCoder.isValidJSON(atom)) {
        return DateCoder.JSONToDatabase(atom);
      }
      if (BytesCoder.isValidJSON(atom)) {
        return BytesCoder.JSONToDatabase(atom);
      }
      if (GeoPointCoder.isValidJSON(atom)) {
        return GeoPointCoder.JSONToDatabase(atom);
      }
      if (PolygonCoder.isValidJSON(atom)) {
        return PolygonCoder.JSONToDatabase(atom);
      }
      if (FileCoder.isValidJSON(atom)) {
        return FileCoder.JSONToDatabase(atom);
      }
      return CannotTransform;

    default:
      // I don't think typeof can ever let us get here
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, `really did not expect value: ${atom}`);
  }
}

function relativeTimeToDate(text, now = new Date()) {
  text = text.toLowerCase();

  let parts = text.split(' ');

  // Filter out whitespace
  parts = parts.filter(part => part !== '');

  const future = parts[0] === 'in';
  const past = parts[parts.length - 1] === 'ago';

  if (!future && !past && text !== 'now') {
    return { status: 'error', info: "Time should either start with 'in' or end with 'ago'" };
  }

  if (future && past) {
    return {
      status: 'error',
      info: "Time cannot have both 'in' and 'ago'"
    };
  }

  // strip the 'ago' or 'in'
  if (future) {
    parts = parts.slice(1);
  } else {
    // past
    parts = parts.slice(0, parts.length - 1);
  }

  if (parts.length % 2 !== 0 && text !== 'now') {
    return {
      status: 'error',
      info: 'Invalid time string. Dangling unit or number.'
    };
  }

  const pairs = [];
  while (parts.length) {
    pairs.push([parts.shift(), parts.shift()]);
  }

  let seconds = 0;
  for (const [num, interval] of pairs) {
    const val = Number(num);
    if (!Number.isInteger(val)) {
      return {
        status: 'error',
        info: `'${num}' is not an integer.`
      };
    }

    switch (interval) {
      case 'yr':
      case 'yrs':
      case 'year':
      case 'years':
        seconds += val * 31536000; // 365 * 24 * 60 * 60
        break;

      case 'wk':
      case 'wks':
      case 'week':
      case 'weeks':
        seconds += val * 604800; // 7 * 24 * 60 * 60
        break;

      case 'd':
      case 'day':
      case 'days':
        seconds += val * 86400; // 24 * 60 * 60
        break;

      case 'hr':
      case 'hrs':
      case 'hour':
      case 'hours':
        seconds += val * 3600; // 60 * 60
        break;

      case 'min':
      case 'mins':
      case 'minute':
      case 'minutes':
        seconds += val * 60;
        break;

      case 'sec':
      case 'secs':
      case 'second':
      case 'seconds':
        seconds += val;
        break;

      default:
        return {
          status: 'error',
          info: `Invalid interval: '${interval}'`
        };
    }
  }

  const milliseconds = seconds * 1000;
  if (future) {
    return {
      status: 'success',
      info: 'future',
      result: new Date(now.valueOf() + milliseconds)
    };
  } else if (past) {
    return {
      status: 'success',
      info: 'past',
      result: new Date(now.valueOf() - milliseconds)
    };
  } else {
    return {
      status: 'success',
      info: 'present',
      result: new Date(now.valueOf())
    };
  }
}

// Transforms a query constraint from REST API format to Mongo format.
// A constraint is something with fields like $lt.
// If it is not a valid constraint but it could be a valid something
// else, return CannotTransform.
// inArray is whether this is an array field.
function transformConstraint(constraint, field) {
  const inArray = field && field.type && field.type === 'Array';
  if (typeof constraint !== 'object' || !constraint) {
    return CannotTransform;
  }
  const transformFunction = inArray ? transformInteriorAtom : transformTopLevelAtom;
  const transformer = atom => {
    const result = transformFunction(atom, field);
    if (result === CannotTransform) {
      throw new Parse.Error(Parse.Error.INVALID_JSON, `bad atom: ${JSON.stringify(atom)}`);
    }
    return result;
  };
  // keys is the constraints in reverse alphabetical order.
  // This is a hack so that:
  //   $regex is handled before $options
  //   $nearSphere is handled before $maxDistance
  var keys = Object.keys(constraint).sort().reverse();
  var answer = {};
  for (var key of keys) {
    switch (key) {
      case '$lt':
      case '$lte':
      case '$gt':
      case '$gte':
      case '$exists':
      case '$ne':
      case '$eq':
        {
          const val = constraint[key];
          if (val && typeof val === 'object' && val.$relativeTime) {
            if (field && field.type !== 'Date') {
              throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with Date field');
            }

            switch (key) {
              case '$exists':
              case '$ne':
              case '$eq':
                throw new Parse.Error(Parse.Error.INVALID_JSON, '$relativeTime can only be used with the $lt, $lte, $gt, and $gte operators');
            }

            const parserResult = relativeTimeToDate(val.$relativeTime);
            if (parserResult.status === 'success') {
              answer[key] = parserResult.result;
              break;
            }

            _logger2.default.info('Error while parsing relative date', parserResult);
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $relativeTime (${key}) value. ${parserResult.info}`);
          }

          answer[key] = transformer(val);
          break;
        }

      case '$in':
      case '$nin':
        {
          const arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = _lodash2.default.flatMap(arr, value => {
            return (atom => {
              if (Array.isArray(atom)) {
                return value.map(transformer);
              } else {
                return transformer(atom);
              }
            })(value);
          });
          break;
        }
      case '$all':
        {
          const arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad ' + key + ' value');
          }
          answer[key] = arr.map(transformInteriorAtom);

          const values = answer[key];
          if (isAnyValueRegex(values) && !isAllValuesRegexOrNone(values)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'All $all values must be of regex type or none: ' + values);
          }

          break;
        }
      case '$regex':
        var s = constraint[key];
        if (typeof s !== 'string') {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad regex: ' + s);
        }
        answer[key] = s;
        break;

      case '$containedBy':
        {
          const arr = constraint[key];
          if (!(arr instanceof Array)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $containedBy: should be an array`);
          }
          answer.$elemMatch = {
            $nin: arr.map(transformer)
          };
          break;
        }
      case '$options':
        answer[key] = constraint[key];
        break;

      case '$text':
        {
          const search = constraint[key].$search;
          if (typeof search !== 'object') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $search, should be object`);
          }
          if (!search.$term || typeof search.$term !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $term, should be string`);
          } else {
            answer[key] = {
              '$search': search.$term
            };
          }
          if (search.$language && typeof search.$language !== 'string') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $language, should be string`);
          } else if (search.$language) {
            answer[key].$language = search.$language;
          }
          if (search.$caseSensitive && typeof search.$caseSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $caseSensitive, should be boolean`);
          } else if (search.$caseSensitive) {
            answer[key].$caseSensitive = search.$caseSensitive;
          }
          if (search.$diacriticSensitive && typeof search.$diacriticSensitive !== 'boolean') {
            throw new Parse.Error(Parse.Error.INVALID_JSON, `bad $text: $diacriticSensitive, should be boolean`);
          } else if (search.$diacriticSensitive) {
            answer[key].$diacriticSensitive = search.$diacriticSensitive;
          }
          break;
        }
      case '$nearSphere':
        var point = constraint[key];
        answer[key] = [point.longitude, point.latitude];
        break;

      case '$maxDistance':
        answer[key] = constraint[key];
        break;

      // The SDKs don't seem to use these but they are documented in the
      // REST API docs.
      case '$maxDistanceInRadians':
        answer['$maxDistance'] = constraint[key];
        break;
      case '$maxDistanceInMiles':
        answer['$maxDistance'] = constraint[key] / 3959;
        break;
      case '$maxDistanceInKilometers':
        answer['$maxDistance'] = constraint[key] / 6371;
        break;

      case '$select':
      case '$dontSelect':
        throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, 'the ' + key + ' constraint is not supported yet');

      case '$within':
        var box = constraint[key]['$box'];
        if (!box || box.length != 2) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'malformatted $within arg');
        }
        answer[key] = {
          '$box': [[box[0].longitude, box[0].latitude], [box[1].longitude, box[1].latitude]]
        };
        break;

      case '$geoWithin':
        {
          const polygon = constraint[key]['$polygon'];
          const centerSphere = constraint[key]['$centerSphere'];
          if (polygon !== undefined) {
            let points;
            if (typeof polygon === 'object' && polygon.__type === 'Polygon') {
              if (!polygon.coordinates || polygon.coordinates.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; Polygon.coordinates should contain at least 3 lon/lat pairs');
              }
              points = polygon.coordinates;
            } else if (polygon instanceof Array) {
              if (polygon.length < 3) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should contain at least 3 GeoPoints');
              }
              points = polygon;
            } else {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $polygon should be Polygon object or Array of Parse.GeoPoint\'s');
            }
            points = points.map(point => {
              if (point instanceof Array && point.length === 2) {
                Parse.GeoPoint._validate(point[1], point[0]);
                return point;
              }
              if (!GeoPointCoder.isValidJSON(point)) {
                throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value');
              } else {
                Parse.GeoPoint._validate(point.latitude, point.longitude);
              }
              return [point.longitude, point.latitude];
            });
            answer[key] = {
              '$polygon': points
            };
          } else if (centerSphere !== undefined) {
            if (!(centerSphere instanceof Array) || centerSphere.length < 2) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere should be an array of Parse.GeoPoint and distance');
            }
            // Get point, convert to geo point if necessary and validate
            let point = centerSphere[0];
            if (point instanceof Array && point.length === 2) {
              point = new Parse.GeoPoint(point[1], point[0]);
            } else if (!GeoPointCoder.isValidJSON(point)) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere geo point invalid');
            }
            Parse.GeoPoint._validate(point.latitude, point.longitude);
            // Get distance and validate
            const distance = centerSphere[1];
            if (isNaN(distance) || distance < 0) {
              throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoWithin value; $centerSphere distance invalid');
            }
            answer[key] = {
              '$centerSphere': [[point.longitude, point.latitude], distance]
            };
          }
          break;
        }
      case '$geoIntersects':
        {
          const point = constraint[key]['$point'];
          if (!GeoPointCoder.isValidJSON(point)) {
            throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad $geoIntersect value; $point should be GeoPoint');
          } else {
            Parse.GeoPoint._validate(point.latitude, point.longitude);
          }
          answer[key] = {
            $geometry: {
              type: 'Point',
              coordinates: [point.longitude, point.latitude]
            }
          };
          break;
        }
      default:
        if (key.match(/^\$+/)) {
          throw new Parse.Error(Parse.Error.INVALID_JSON, 'bad constraint: ' + key);
        }
        return CannotTransform;
    }
  }
  return answer;
}

// Transforms an update operator from REST format to mongo format.
// To be transformed, the input should have an __op field.
// If flatten is true, this will flatten operators to their static
// data format. For example, an increment of 2 would simply become a
// 2.
// The output for a non-flattened operator is a hash with __op being
// the mongo op, and arg being the argument.
// The output for a flattened operator is just a value.
// Returns undefined if this should be a no-op.

function transformUpdateOperator({
  __op,
  amount,
  objects
}, flatten) {
  switch (__op) {
    case 'Delete':
      if (flatten) {
        return undefined;
      } else {
        return { __op: '$unset', arg: '' };
      }

    case 'Increment':
      if (typeof amount !== 'number') {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'incrementing must provide a number');
      }
      if (flatten) {
        return amount;
      } else {
        return { __op: '$inc', arg: amount };
      }

    case 'Add':
    case 'AddUnique':
      if (!(objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to add must be an array');
      }
      var toAdd = objects.map(transformInteriorAtom);
      if (flatten) {
        return toAdd;
      } else {
        var mongoOp = {
          Add: '$push',
          AddUnique: '$addToSet'
        }[__op];
        return { __op: mongoOp, arg: { '$each': toAdd } };
      }

    case 'Remove':
      if (!(objects instanceof Array)) {
        throw new Parse.Error(Parse.Error.INVALID_JSON, 'objects to remove must be an array');
      }
      var toRemove = objects.map(transformInteriorAtom);
      if (flatten) {
        return [];
      } else {
        return { __op: '$pullAll', arg: toRemove };
      }

    default:
      throw new Parse.Error(Parse.Error.COMMAND_UNAVAILABLE, `The ${__op} operator is not supported yet.`);
  }
}
function mapValues(object, iterator) {
  const result = {};
  Object.keys(object).forEach(key => {
    result[key] = iterator(object[key]);
  });
  return result;
}

const nestedMongoObjectToNestedParseObject = mongoObject => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
      return mongoObject;
    case 'undefined':
    case 'symbol':
    case 'function':
      throw 'bad value in mongoObjectToParseObject';
    case 'object':
      if (mongoObject === null) {
        return null;
      }
      if (mongoObject instanceof Array) {
        return mongoObject.map(nestedMongoObjectToNestedParseObject);
      }

      if (mongoObject instanceof Date) {
        return Parse._encode(mongoObject);
      }

      if (mongoObject instanceof mongodb.Long) {
        return mongoObject.toNumber();
      }

      if (mongoObject instanceof mongodb.Double) {
        return mongoObject.value;
      }

      if (BytesCoder.isValidDatabaseObject(mongoObject)) {
        return BytesCoder.databaseToJSON(mongoObject);
      }

      if (mongoObject.hasOwnProperty('__type') && mongoObject.__type == 'Date' && mongoObject.iso instanceof Date) {
        mongoObject.iso = mongoObject.iso.toJSON();
        return mongoObject;
      }

      return mapValues(mongoObject, nestedMongoObjectToNestedParseObject);
    default:
      throw 'unknown js type';
  }
};

const transformPointerString = (schema, field, pointerString) => {
  const objData = pointerString.split('$');
  if (objData[0] !== schema.fields[field].targetClass) {
    throw 'pointer to incorrect className';
  }
  return {
    __type: 'Pointer',
    className: objData[0],
    objectId: objData[1]
  };
};

// Converts from a mongo-format object to a REST-format object.
// Does not strip out anything based on a lack of authentication.
const mongoObjectToParseObject = (className, mongoObject, schema) => {
  switch (typeof mongoObject) {
    case 'string':
    case 'number':
    case 'boolean':
      return mongoObject;
    case 'undefined':
    case 'symbol':
    case 'function':
      throw 'bad value in mongoObjectToParseObject';
    case 'object':
      {
        if (mongoObject === null) {
          return null;
        }
        if (mongoObject instanceof Array) {
          return mongoObject.map(nestedMongoObjectToNestedParseObject);
        }

        if (mongoObject instanceof Date) {
          return Parse._encode(mongoObject);
        }

        if (mongoObject instanceof mongodb.Long) {
          return mongoObject.toNumber();
        }

        if (mongoObject instanceof mongodb.Double) {
          return mongoObject.value;
        }

        if (BytesCoder.isValidDatabaseObject(mongoObject)) {
          return BytesCoder.databaseToJSON(mongoObject);
        }

        const restObject = {};
        if (mongoObject._rperm || mongoObject._wperm) {
          restObject._rperm = mongoObject._rperm || [];
          restObject._wperm = mongoObject._wperm || [];
          delete mongoObject._rperm;
          delete mongoObject._wperm;
        }

        for (var key in mongoObject) {
          switch (key) {
            case '_id':
              restObject['objectId'] = '' + mongoObject[key];
              break;
            case '_hashed_password':
              restObject._hashed_password = mongoObject[key];
              break;
            case '_acl':
              break;
            case '_email_verify_token':
            case '_perishable_token':
            case '_perishable_token_expires_at':
            case '_password_changed_at':
            case '_tombstone':
            case '_email_verify_token_expires_at':
            case '_account_lockout_expires_at':
            case '_failed_login_count':
            case '_password_history':
              // Those keys will be deleted if needed in the DB Controller
              restObject[key] = mongoObject[key];
              break;
            case '_session_token':
              restObject['sessionToken'] = mongoObject[key];
              break;
            case 'updatedAt':
            case '_updated_at':
              restObject['updatedAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'createdAt':
            case '_created_at':
              restObject['createdAt'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'expiresAt':
            case '_expiresAt':
              restObject['expiresAt'] = Parse._encode(new Date(mongoObject[key]));
              break;
            case 'lastUsed':
            case '_last_used':
              restObject['lastUsed'] = Parse._encode(new Date(mongoObject[key])).iso;
              break;
            case 'timesUsed':
            case 'times_used':
              restObject['timesUsed'] = mongoObject[key];
              break;
            default:
              // Check other auth data keys
              var authDataMatch = key.match(/^_auth_data_([a-zA-Z0-9_]+)$/);
              if (authDataMatch) {
                var provider = authDataMatch[1];
                restObject['authData'] = restObject['authData'] || {};
                restObject['authData'][provider] = mongoObject[key];
                break;
              }

              if (key.indexOf('_p_') == 0) {
                var newKey = key.substring(3);
                if (!schema.fields[newKey]) {
                  _logger2.default.info('transform.js', 'Found a pointer column not in the schema, dropping it.', className, newKey);
                  break;
                }
                if (schema.fields[newKey].type !== 'Pointer') {
                  _logger2.default.info('transform.js', 'Found a pointer in a non-pointer column, dropping it.', className, key);
                  break;
                }
                if (mongoObject[key] === null) {
                  break;
                }
                restObject[newKey] = transformPointerString(schema, newKey, mongoObject[key]);
                break;
              } else if (key[0] == '_' && key != '__type') {
                throw 'bad key in untransform: ' + key;
              } else {
                var value = mongoObject[key];
                if (schema.fields[key] && schema.fields[key].type === 'File' && FileCoder.isValidDatabaseObject(value)) {
                  restObject[key] = FileCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'GeoPoint' && GeoPointCoder.isValidDatabaseObject(value)) {
                  restObject[key] = GeoPointCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'Polygon' && PolygonCoder.isValidDatabaseObject(value)) {
                  restObject[key] = PolygonCoder.databaseToJSON(value);
                  break;
                }
                if (schema.fields[key] && schema.fields[key].type === 'Bytes' && BytesCoder.isValidDatabaseObject(value)) {
                  restObject[key] = BytesCoder.databaseToJSON(value);
                  break;
                }
              }
              restObject[key] = nestedMongoObjectToNestedParseObject(mongoObject[key]);
          }
        }

        const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
        const relationFields = {};
        relationFieldNames.forEach(relationFieldName => {
          relationFields[relationFieldName] = {
            __type: 'Relation',
            className: schema.fields[relationFieldName].targetClass
          };
        });

        return _extends({}, restObject, relationFields);
      }
    default:
      throw 'unknown js type';
  }
};

var DateCoder = {
  JSONToDatabase(json) {
    return new Date(json.iso);
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Date';
  }
};

var BytesCoder = {
  base64Pattern: new RegExp("^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$"),
  isBase64Value(object) {
    if (typeof object !== 'string') {
      return false;
    }
    return this.base64Pattern.test(object);
  },

  databaseToJSON(object) {
    let value;
    if (this.isBase64Value(object)) {
      value = object;
    } else {
      value = object.buffer.toString('base64');
    }
    return {
      __type: 'Bytes',
      base64: value
    };
  },

  isValidDatabaseObject(object) {
    return object instanceof mongodb.Binary || this.isBase64Value(object);
  },

  JSONToDatabase(json) {
    return new mongodb.Binary(new Buffer(json.base64, 'base64'));
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Bytes';
  }
};

var GeoPointCoder = {
  databaseToJSON(object) {
    return {
      __type: 'GeoPoint',
      latitude: object[1],
      longitude: object[0]
    };
  },

  isValidDatabaseObject(object) {
    return object instanceof Array && object.length == 2;
  },

  JSONToDatabase(json) {
    return [json.longitude, json.latitude];
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'GeoPoint';
  }
};

var PolygonCoder = {
  databaseToJSON(object) {
    // Convert lng/lat -> lat/lng
    const coords = object.coordinates[0].map(coord => {
      return [coord[1], coord[0]];
    });
    return {
      __type: 'Polygon',
      coordinates: coords
    };
  },

  isValidDatabaseObject(object) {
    const coords = object.coordinates[0];
    if (object.type !== 'Polygon' || !(coords instanceof Array)) {
      return false;
    }
    for (let i = 0; i < coords.length; i++) {
      const point = coords[i];
      if (!GeoPointCoder.isValidDatabaseObject(point)) {
        return false;
      }
      Parse.GeoPoint._validate(parseFloat(point[1]), parseFloat(point[0]));
    }
    return true;
  },

  JSONToDatabase(json) {
    let coords = json.coordinates;
    // Add first point to the end to close polygon
    if (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1]) {
      coords.push(coords[0]);
    }
    const unique = coords.filter((item, index, ar) => {
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
      throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'GeoJSON: Loop must have at least 3 different vertices');
    }
    // Convert lat/long -> long/lat
    coords = coords.map(coord => {
      return [coord[1], coord[0]];
    });
    return { type: 'Polygon', coordinates: [coords] };
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'Polygon';
  }
};

var FileCoder = {
  databaseToJSON(object) {
    return {
      __type: 'File',
      name: object
    };
  },

  isValidDatabaseObject(object) {
    return typeof object === 'string';
  },

  JSONToDatabase(json) {
    return json.name;
  },

  isValidJSON(value) {
    return typeof value === 'object' && value !== null && value.__type === 'File';
  }
};

module.exports = {
  transformKey,
  parseObjectToMongoObjectForCreate,
  transformUpdate,
  transformWhere,
  mongoObjectToParseObject,
  relativeTimeToDate,
  transformConstraint,
  transformPointerString
};
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvVHJhbnNmb3JtLmpzIl0sIm5hbWVzIjpbIm1vbmdvZGIiLCJyZXF1aXJlIiwiUGFyc2UiLCJ0cmFuc2Zvcm1LZXkiLCJjbGFzc05hbWUiLCJmaWVsZE5hbWUiLCJzY2hlbWEiLCJmaWVsZHMiLCJfX3R5cGUiLCJ0eXBlIiwidHJhbnNmb3JtS2V5VmFsdWVGb3JVcGRhdGUiLCJyZXN0S2V5IiwicmVzdFZhbHVlIiwicGFyc2VGb3JtYXRTY2hlbWEiLCJrZXkiLCJ0aW1lRmllbGQiLCJ2YWx1ZSIsInBhcnNlSW50IiwidHJhbnNmb3JtVG9wTGV2ZWxBdG9tIiwiQ2Fubm90VHJhbnNmb3JtIiwiRGF0ZSIsImluZGV4T2YiLCJBcnJheSIsIm1hcCIsInRyYW5zZm9ybUludGVyaW9yVmFsdWUiLCJ0cmFuc2Zvcm1VcGRhdGVPcGVyYXRvciIsIm1hcFZhbHVlcyIsImlzUmVnZXgiLCJSZWdFeHAiLCJpc1N0YXJ0c1dpdGhSZWdleCIsIm1hdGNoZXMiLCJ0b1N0cmluZyIsIm1hdGNoIiwiaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSIsInZhbHVlcyIsImlzQXJyYXkiLCJsZW5ndGgiLCJmaXJzdFZhbHVlc0lzUmVnZXgiLCJpIiwiaXNBbnlWYWx1ZVJlZ2V4Iiwic29tZSIsIk9iamVjdCIsImtleXMiLCJpbmNsdWRlcyIsIkVycm9yIiwiSU5WQUxJRF9ORVNURURfS0VZIiwidHJhbnNmb3JtSW50ZXJpb3JBdG9tIiwidmFsdWVBc0RhdGUiLCJ0cmFuc2Zvcm1RdWVyeUtleVZhbHVlIiwic3ViUXVlcnkiLCJ0cmFuc2Zvcm1XaGVyZSIsImF1dGhEYXRhTWF0Y2giLCJwcm92aWRlciIsImV4cGVjdGVkVHlwZUlzQXJyYXkiLCJleHBlY3RlZFR5cGVJc1BvaW50ZXIiLCJmaWVsZCIsInRyYW5zZm9ybWVkQ29uc3RyYWludCIsInRyYW5zZm9ybUNvbnN0cmFpbnQiLCIkdGV4dCIsIiRlbGVtTWF0Y2giLCJJTlZBTElEX0pTT04iLCJyZXN0V2hlcmUiLCJtb25nb1doZXJlIiwib3V0IiwicGFyc2VPYmplY3RLZXlWYWx1ZVRvTW9uZ29PYmplY3RLZXlWYWx1ZSIsInRyYW5zZm9ybWVkVmFsdWUiLCJjb2VyY2VkVG9EYXRlIiwiSU5WQUxJRF9LRVlfTkFNRSIsInBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSIsInJlc3RDcmVhdGUiLCJhZGRMZWdhY3lBQ0wiLCJtb25nb0NyZWF0ZSIsInVuZGVmaW5lZCIsImNyZWF0ZWRBdCIsIl9jcmVhdGVkX2F0IiwiaXNvIiwidXBkYXRlZEF0IiwiX3VwZGF0ZWRfYXQiLCJ0cmFuc2Zvcm1VcGRhdGUiLCJyZXN0VXBkYXRlIiwibW9uZ29VcGRhdGUiLCJhY2wiLCJfcnBlcm0iLCJfd3Blcm0iLCJfYWNsIiwiJHNldCIsIl9fb3AiLCJhcmciLCJyZXN0T2JqZWN0IiwicmVzdE9iamVjdENvcHkiLCJmb3JFYWNoIiwiZW50cnkiLCJ3IiwiciIsImF0b20iLCJvYmplY3RJZCIsIkRhdGVDb2RlciIsImlzVmFsaWRKU09OIiwiSlNPTlRvRGF0YWJhc2UiLCJCeXRlc0NvZGVyIiwiJHJlZ2V4IiwidGFyZ2V0Q2xhc3MiLCJHZW9Qb2ludENvZGVyIiwiUG9seWdvbkNvZGVyIiwiRmlsZUNvZGVyIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwicmVsYXRpdmVUaW1lVG9EYXRlIiwidGV4dCIsIm5vdyIsInRvTG93ZXJDYXNlIiwicGFydHMiLCJzcGxpdCIsImZpbHRlciIsInBhcnQiLCJmdXR1cmUiLCJwYXN0Iiwic3RhdHVzIiwiaW5mbyIsInNsaWNlIiwicGFpcnMiLCJwdXNoIiwic2hpZnQiLCJzZWNvbmRzIiwibnVtIiwiaW50ZXJ2YWwiLCJ2YWwiLCJOdW1iZXIiLCJpc0ludGVnZXIiLCJtaWxsaXNlY29uZHMiLCJyZXN1bHQiLCJ2YWx1ZU9mIiwiY29uc3RyYWludCIsImluQXJyYXkiLCJ0cmFuc2Zvcm1GdW5jdGlvbiIsInRyYW5zZm9ybWVyIiwiSlNPTiIsInN0cmluZ2lmeSIsInNvcnQiLCJyZXZlcnNlIiwiYW5zd2VyIiwiJHJlbGF0aXZlVGltZSIsInBhcnNlclJlc3VsdCIsImFyciIsImZsYXRNYXAiLCJzIiwiJG5pbiIsInNlYXJjaCIsIiRzZWFyY2giLCIkdGVybSIsIiRsYW5ndWFnZSIsIiRjYXNlU2Vuc2l0aXZlIiwiJGRpYWNyaXRpY1NlbnNpdGl2ZSIsInBvaW50IiwibG9uZ2l0dWRlIiwibGF0aXR1ZGUiLCJDT01NQU5EX1VOQVZBSUxBQkxFIiwiYm94IiwicG9seWdvbiIsImNlbnRlclNwaGVyZSIsInBvaW50cyIsImNvb3JkaW5hdGVzIiwiR2VvUG9pbnQiLCJfdmFsaWRhdGUiLCJkaXN0YW5jZSIsImlzTmFOIiwiJGdlb21ldHJ5IiwiYW1vdW50Iiwib2JqZWN0cyIsImZsYXR0ZW4iLCJ0b0FkZCIsIm1vbmdvT3AiLCJBZGQiLCJBZGRVbmlxdWUiLCJ0b1JlbW92ZSIsIm9iamVjdCIsIml0ZXJhdG9yIiwibmVzdGVkTW9uZ29PYmplY3RUb05lc3RlZFBhcnNlT2JqZWN0IiwibW9uZ29PYmplY3QiLCJfZW5jb2RlIiwiTG9uZyIsInRvTnVtYmVyIiwiRG91YmxlIiwiaXNWYWxpZERhdGFiYXNlT2JqZWN0IiwiZGF0YWJhc2VUb0pTT04iLCJoYXNPd25Qcm9wZXJ0eSIsInRvSlNPTiIsInRyYW5zZm9ybVBvaW50ZXJTdHJpbmciLCJwb2ludGVyU3RyaW5nIiwib2JqRGF0YSIsIm1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCIsIl9oYXNoZWRfcGFzc3dvcmQiLCJuZXdLZXkiLCJzdWJzdHJpbmciLCJyZWxhdGlvbkZpZWxkTmFtZXMiLCJyZWxhdGlvbkZpZWxkcyIsInJlbGF0aW9uRmllbGROYW1lIiwianNvbiIsImJhc2U2NFBhdHRlcm4iLCJpc0Jhc2U2NFZhbHVlIiwidGVzdCIsImJ1ZmZlciIsImJhc2U2NCIsIkJpbmFyeSIsIkJ1ZmZlciIsImNvb3JkcyIsImNvb3JkIiwicGFyc2VGbG9hdCIsInVuaXF1ZSIsIml0ZW0iLCJp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QWlCLFNBRm5CO0FBSUQ7QUFoRWdCLENBQW5COztBQW1FQSxJQUFJZ0csWUFBWTtBQUNkK0UsaUJBQWVULE1BQWYsRUFBdUI7QUFDckIsV0FBTztBQUNMdEssY0FBUSxNQURIO0FBRUw2TSxZQUFNdkM7QUFGRCxLQUFQO0FBSUQsR0FOYTs7QUFRZFEsd0JBQXNCUixNQUF0QixFQUE4QjtBQUM1QixXQUFRLE9BQU9BLE1BQVAsS0FBa0IsUUFBMUI7QUFDRCxHQVZhOztBQVlkNUUsaUJBQWVrRyxJQUFmLEVBQXFCO0FBQ25CLFdBQU9BLEtBQUtpQixJQUFaO0FBQ0QsR0FkYTs7QUFnQmRwSCxjQUFZakYsS0FBWixFQUFtQjtBQUNqQixXQUFRLE9BQU9BLEtBQVAsS0FBaUIsUUFBakIsSUFDTkEsVUFBVSxJQURKLElBRU5BLE1BQU1SLE1BQU4sS0FBaUIsTUFGbkI7QUFJRDtBQXJCYSxDQUFoQjs7QUF3QkE4TSxPQUFPQyxPQUFQLEdBQWlCO0FBQ2ZwTixjQURlO0FBRWZpRSxtQ0FGZTtBQUdmVSxpQkFIZTtBQUlmNUIsZ0JBSmU7QUFLZjJJLDBCQUxlO0FBTWZuRixvQkFOZTtBQU9makQscUJBUGU7QUFRZmlJO0FBUmUsQ0FBakIiLCJmaWxlIjoiTW9uZ29UcmFuc2Zvcm0uanMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgbG9nIGZyb20gJy4uLy4uLy4uL2xvZ2dlcic7XG5pbXBvcnQgXyAgIGZyb20gJ2xvZGFzaCc7XG52YXIgbW9uZ29kYiA9IHJlcXVpcmUoJ21vbmdvZGInKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKS5QYXJzZTtcblxuY29uc3QgdHJhbnNmb3JtS2V5ID0gKGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEpID0+IHtcbiAgLy8gQ2hlY2sgaWYgdGhlIHNjaGVtYSBpcyBrbm93biBzaW5jZSBpdCdzIGEgYnVpbHQtaW4gZmllbGQuXG4gIHN3aXRjaChmaWVsZE5hbWUpIHtcbiAgY2FzZSAnb2JqZWN0SWQnOiByZXR1cm4gJ19pZCc7XG4gIGNhc2UgJ2NyZWF0ZWRBdCc6IHJldHVybiAnX2NyZWF0ZWRfYXQnO1xuICBjYXNlICd1cGRhdGVkQXQnOiByZXR1cm4gJ191cGRhdGVkX2F0JztcbiAgY2FzZSAnc2Vzc2lvblRva2VuJzogcmV0dXJuICdfc2Vzc2lvbl90b2tlbic7XG4gIGNhc2UgJ2xhc3RVc2VkJzogcmV0dXJuICdfbGFzdF91c2VkJztcbiAgY2FzZSAndGltZXNVc2VkJzogcmV0dXJuICd0aW1lc191c2VkJztcbiAgfVxuXG4gIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICBmaWVsZE5hbWUgPSAnX3BfJyArIGZpZWxkTmFtZTtcbiAgfSBlbHNlIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gJiYgc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT0gJ1BvaW50ZXInKSB7XG4gICAgZmllbGROYW1lID0gJ19wXycgKyBmaWVsZE5hbWU7XG4gIH1cblxuICByZXR1cm4gZmllbGROYW1lO1xufVxuXG5jb25zdCB0cmFuc2Zvcm1LZXlWYWx1ZUZvclVwZGF0ZSA9IChjbGFzc05hbWUsIHJlc3RLZXksIHJlc3RWYWx1ZSwgcGFyc2VGb3JtYXRTY2hlbWEpID0+IHtcbiAgLy8gQ2hlY2sgaWYgdGhlIHNjaGVtYSBpcyBrbm93biBzaW5jZSBpdCdzIGEgYnVpbHQtaW4gZmllbGQuXG4gIHZhciBrZXkgPSByZXN0S2V5O1xuICB2YXIgdGltZUZpZWxkID0gZmFsc2U7XG4gIHN3aXRjaChrZXkpIHtcbiAgY2FzZSAnb2JqZWN0SWQnOlxuICBjYXNlICdfaWQnOlxuICAgIGlmIChjbGFzc05hbWUgPT09ICdfR2xvYmFsQ29uZmlnJykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2V5OiBrZXksXG4gICAgICAgIHZhbHVlOiBwYXJzZUludChyZXN0VmFsdWUpXG4gICAgICB9XG4gICAgfVxuICAgIGtleSA9ICdfaWQnO1xuICAgIGJyZWFrO1xuICBjYXNlICdjcmVhdGVkQXQnOlxuICBjYXNlICdfY3JlYXRlZF9hdCc6XG4gICAga2V5ID0gJ19jcmVhdGVkX2F0JztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICBjYXNlICd1cGRhdGVkQXQnOlxuICBjYXNlICdfdXBkYXRlZF9hdCc6XG4gICAga2V5ID0gJ191cGRhdGVkX2F0JztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICBjYXNlICdzZXNzaW9uVG9rZW4nOlxuICBjYXNlICdfc2Vzc2lvbl90b2tlbic6XG4gICAga2V5ID0gJ19zZXNzaW9uX3Rva2VuJztcbiAgICBicmVhaztcbiAgY2FzZSAnZXhwaXJlc0F0JzpcbiAgY2FzZSAnX2V4cGlyZXNBdCc6XG4gICAga2V5ID0gJ2V4cGlyZXNBdCc7XG4gICAgdGltZUZpZWxkID0gdHJ1ZTtcbiAgICBicmVhaztcbiAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JzpcbiAgICBrZXkgPSAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgIGtleSA9ICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgIGtleSA9ICdfZmFpbGVkX2xvZ2luX2NvdW50JztcbiAgICBicmVhaztcbiAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAga2V5ID0gJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JzpcbiAgICBrZXkgPSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19ycGVybSc6XG4gIGNhc2UgJ193cGVybSc6XG4gICAgcmV0dXJuIHtrZXk6IGtleSwgdmFsdWU6IHJlc3RWYWx1ZX07XG4gIGNhc2UgJ2xhc3RVc2VkJzpcbiAgY2FzZSAnX2xhc3RfdXNlZCc6XG4gICAga2V5ID0gJ19sYXN0X3VzZWQnO1xuICAgIHRpbWVGaWVsZCA9IHRydWU7XG4gICAgYnJlYWs7XG4gIGNhc2UgJ3RpbWVzVXNlZCc6XG4gIGNhc2UgJ3RpbWVzX3VzZWQnOlxuICAgIGtleSA9ICd0aW1lc191c2VkJztcbiAgICB0aW1lRmllbGQgPSB0cnVlO1xuICAgIGJyZWFrO1xuICB9XG5cbiAgaWYgKChwYXJzZUZvcm1hdFNjaGVtYS5maWVsZHNba2V5XSAmJiBwYXJzZUZvcm1hdFNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnUG9pbnRlcicpIHx8ICghcGFyc2VGb3JtYXRTY2hlbWEuZmllbGRzW2tleV0gJiYgcmVzdFZhbHVlICYmIHJlc3RWYWx1ZS5fX3R5cGUgPT0gJ1BvaW50ZXInKSkge1xuICAgIGtleSA9ICdfcF8nICsga2V5O1xuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgdmFyIHZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gIGlmICh2YWx1ZSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgaWYgKHRpbWVGaWVsZCAmJiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykpIHtcbiAgICAgIHZhbHVlID0gbmV3IERhdGUodmFsdWUpO1xuICAgIH1cbiAgICBpZiAocmVzdEtleS5pbmRleE9mKCcuJykgPiAwKSB7XG4gICAgICByZXR1cm4ge2tleSwgdmFsdWU6IHJlc3RWYWx1ZX1cbiAgICB9XG4gICAgcmV0dXJuIHtrZXksIHZhbHVlfTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBhcnJheXNcbiAgaWYgKHJlc3RWYWx1ZSBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgdmFsdWUgPSByZXN0VmFsdWUubWFwKHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICAgIHJldHVybiB7a2V5LCB2YWx1ZX07XG4gIH1cblxuICAvLyBIYW5kbGUgdXBkYXRlIG9wZXJhdG9yc1xuICBpZiAodHlwZW9mIHJlc3RWYWx1ZSA9PT0gJ29iamVjdCcgJiYgJ19fb3AnIGluIHJlc3RWYWx1ZSkge1xuICAgIHJldHVybiB7a2V5LCB2YWx1ZTogdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IocmVzdFZhbHVlLCBmYWxzZSl9O1xuICB9XG5cbiAgLy8gSGFuZGxlIG5vcm1hbCBvYmplY3RzIGJ5IHJlY3Vyc2luZ1xuICB2YWx1ZSA9IG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICByZXR1cm4ge2tleSwgdmFsdWV9O1xufVxuXG5jb25zdCBpc1JlZ2V4ID0gdmFsdWUgPT4ge1xuICByZXR1cm4gdmFsdWUgJiYgKHZhbHVlIGluc3RhbmNlb2YgUmVnRXhwKVxufVxuXG5jb25zdCBpc1N0YXJ0c1dpdGhSZWdleCA9IHZhbHVlID0+IHtcbiAgaWYgKCFpc1JlZ2V4KHZhbHVlKSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGNvbnN0IG1hdGNoZXMgPSB2YWx1ZS50b1N0cmluZygpLm1hdGNoKC9cXC9cXF5cXFxcUS4qXFxcXEVcXC8vKTtcbiAgcmV0dXJuICEhbWF0Y2hlcztcbn1cblxuY29uc3QgaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSA9IHZhbHVlcyA9PiB7XG4gIGlmICghdmFsdWVzIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlcykgfHwgdmFsdWVzLmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3QgZmlyc3RWYWx1ZXNJc1JlZ2V4ID0gaXNTdGFydHNXaXRoUmVnZXgodmFsdWVzWzBdKTtcbiAgaWYgKHZhbHVlcy5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gZmlyc3RWYWx1ZXNJc1JlZ2V4O1xuICB9XG5cbiAgZm9yIChsZXQgaSA9IDEsIGxlbmd0aCA9IHZhbHVlcy5sZW5ndGg7IGkgPCBsZW5ndGg7ICsraSkge1xuICAgIGlmIChmaXJzdFZhbHVlc0lzUmVnZXggIT09IGlzU3RhcnRzV2l0aFJlZ2V4KHZhbHVlc1tpXSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdHJ1ZTtcbn1cblxuY29uc3QgaXNBbnlWYWx1ZVJlZ2V4ID0gdmFsdWVzID0+IHtcbiAgcmV0dXJuIHZhbHVlcy5zb21lKGZ1bmN0aW9uICh2YWx1ZSkge1xuICAgIHJldHVybiBpc1JlZ2V4KHZhbHVlKTtcbiAgfSk7XG59XG5cbmNvbnN0IHRyYW5zZm9ybUludGVyaW9yVmFsdWUgPSByZXN0VmFsdWUgPT4ge1xuICBpZiAocmVzdFZhbHVlICE9PSBudWxsICYmIHR5cGVvZiByZXN0VmFsdWUgPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKHJlc3RWYWx1ZSkuc29tZShrZXkgPT4ga2V5LmluY2x1ZGVzKCckJykgfHwga2V5LmluY2x1ZGVzKCcuJykpKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSwgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiKTtcbiAgfVxuICAvLyBIYW5kbGUgYXRvbWljIHZhbHVlc1xuICB2YXIgdmFsdWUgPSB0cmFuc2Zvcm1JbnRlcmlvckF0b20ocmVzdFZhbHVlKTtcbiAgaWYgKHZhbHVlICE9PSBDYW5ub3RUcmFuc2Zvcm0pIHtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH1cblxuICAvLyBIYW5kbGUgYXJyYXlzXG4gIGlmIChyZXN0VmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHJldHVybiByZXN0VmFsdWUubWFwKHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICB9XG5cbiAgLy8gSGFuZGxlIHVwZGF0ZSBvcGVyYXRvcnNcbiAgaWYgKHR5cGVvZiByZXN0VmFsdWUgPT09ICdvYmplY3QnICYmICdfX29wJyBpbiByZXN0VmFsdWUpIHtcbiAgICByZXR1cm4gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3IocmVzdFZhbHVlLCB0cnVlKTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBub3JtYWwgb2JqZWN0cyBieSByZWN1cnNpbmdcbiAgcmV0dXJuIG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xufVxuXG5jb25zdCB2YWx1ZUFzRGF0ZSA9IHZhbHVlID0+IHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gbmV3IERhdGUodmFsdWUpO1xuICB9IGVsc2UgaWYgKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbmZ1bmN0aW9uIHRyYW5zZm9ybVF1ZXJ5S2V5VmFsdWUoY2xhc3NOYW1lLCBrZXksIHZhbHVlLCBzY2hlbWEpIHtcbiAgc3dpdGNoKGtleSkge1xuICBjYXNlICdjcmVhdGVkQXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX2NyZWF0ZWRfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpfVxuICAgIH1cbiAgICBrZXkgPSAnX2NyZWF0ZWRfYXQnO1xuICAgIGJyZWFrO1xuICBjYXNlICd1cGRhdGVkQXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX3VwZGF0ZWRfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpfVxuICAgIH1cbiAgICBrZXkgPSAnX3VwZGF0ZWRfYXQnO1xuICAgIGJyZWFrO1xuICBjYXNlICdleHBpcmVzQXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnZXhwaXJlc0F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKX1cbiAgICB9XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHtrZXk6ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnLCB2YWx1ZTogdmFsdWVBc0RhdGUodmFsdWUpfVxuICAgIH1cbiAgICBicmVhaztcbiAgY2FzZSAnb2JqZWN0SWQnOiB7XG4gICAgaWYgKGNsYXNzTmFtZSA9PT0gJ19HbG9iYWxDb25maWcnKSB7XG4gICAgICB2YWx1ZSA9IHBhcnNlSW50KHZhbHVlKTtcbiAgICB9XG4gICAgcmV0dXJuIHtrZXk6ICdfaWQnLCB2YWx1ZX1cbiAgfVxuICBjYXNlICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKX1cbiAgICB9XG4gICAgYnJlYWs7XG4gIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgIHJldHVybiB7a2V5LCB2YWx1ZX07XG4gIGNhc2UgJ3Nlc3Npb25Ub2tlbic6IHJldHVybiB7a2V5OiAnX3Nlc3Npb25fdG9rZW4nLCB2YWx1ZX1cbiAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgaWYgKHZhbHVlQXNEYXRlKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHsga2V5OiAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSkgfVxuICAgIH1cbiAgICBicmVhaztcbiAgY2FzZSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7IGtleTogJ19wYXNzd29yZF9jaGFuZ2VkX2F0JywgdmFsdWU6IHZhbHVlQXNEYXRlKHZhbHVlKSB9XG4gICAgfVxuICAgIGJyZWFrO1xuICBjYXNlICdfcnBlcm0nOlxuICBjYXNlICdfd3Blcm0nOlxuICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbic6XG4gIGNhc2UgJ19lbWFpbF92ZXJpZnlfdG9rZW4nOiByZXR1cm4ge2tleSwgdmFsdWV9XG4gIGNhc2UgJyRvcic6XG4gIGNhc2UgJyRhbmQnOlxuICBjYXNlICckbm9yJzpcbiAgICByZXR1cm4ge2tleToga2V5LCB2YWx1ZTogdmFsdWUubWFwKHN1YlF1ZXJ5ID0+IHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgc3ViUXVlcnksIHNjaGVtYSkpfTtcbiAgY2FzZSAnbGFzdFVzZWQnOlxuICAgIGlmICh2YWx1ZUFzRGF0ZSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnX2xhc3RfdXNlZCcsIHZhbHVlOiB2YWx1ZUFzRGF0ZSh2YWx1ZSl9XG4gICAgfVxuICAgIGtleSA9ICdfbGFzdF91c2VkJztcbiAgICBicmVhaztcbiAgY2FzZSAndGltZXNVc2VkJzpcbiAgICByZXR1cm4ge2tleTogJ3RpbWVzX3VzZWQnLCB2YWx1ZTogdmFsdWV9O1xuICBkZWZhdWx0OiB7XG4gICAgLy8gT3RoZXIgYXV0aCBkYXRhXG4gICAgY29uc3QgYXV0aERhdGFNYXRjaCA9IGtleS5tYXRjaCgvXmF1dGhEYXRhXFwuKFthLXpBLVowLTlfXSspXFwuaWQkLyk7XG4gICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgIGNvbnN0IHByb3ZpZGVyID0gYXV0aERhdGFNYXRjaFsxXTtcbiAgICAgIC8vIFNwZWNpYWwtY2FzZSBhdXRoIGRhdGEuXG4gICAgICByZXR1cm4ge2tleTogYF9hdXRoX2RhdGFfJHtwcm92aWRlcn0uaWRgLCB2YWx1ZX07XG4gICAgfVxuICB9XG4gIH1cblxuICBjb25zdCBleHBlY3RlZFR5cGVJc0FycmF5ID1cbiAgICBzY2hlbWEgJiZcbiAgICBzY2hlbWEuZmllbGRzW2tleV0gJiZcbiAgICBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ0FycmF5JztcblxuICBjb25zdCBleHBlY3RlZFR5cGVJc1BvaW50ZXIgPVxuICAgIHNjaGVtYSAmJlxuICAgIHNjaGVtYS5maWVsZHNba2V5XSAmJlxuICAgIHNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnUG9pbnRlcic7XG5cbiAgY29uc3QgZmllbGQgPSBzY2hlbWEgJiYgc2NoZW1hLmZpZWxkc1trZXldO1xuICBpZiAoZXhwZWN0ZWRUeXBlSXNQb2ludGVyIHx8ICFzY2hlbWEgJiYgdmFsdWUgJiYgdmFsdWUuX190eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICBrZXkgPSAnX3BfJyArIGtleTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBxdWVyeSBjb25zdHJhaW50c1xuICBjb25zdCB0cmFuc2Zvcm1lZENvbnN0cmFpbnQgPSB0cmFuc2Zvcm1Db25zdHJhaW50KHZhbHVlLCBmaWVsZCk7XG4gIGlmICh0cmFuc2Zvcm1lZENvbnN0cmFpbnQgIT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgIGlmICh0cmFuc2Zvcm1lZENvbnN0cmFpbnQuJHRleHQpIHtcbiAgICAgIHJldHVybiB7a2V5OiAnJHRleHQnLCB2YWx1ZTogdHJhbnNmb3JtZWRDb25zdHJhaW50LiR0ZXh0fTtcbiAgICB9XG4gICAgaWYgKHRyYW5zZm9ybWVkQ29uc3RyYWludC4kZWxlbU1hdGNoKSB7XG4gICAgICByZXR1cm4geyBrZXk6ICckbm9yJywgdmFsdWU6IFt7IFtrZXldOiB0cmFuc2Zvcm1lZENvbnN0cmFpbnQgfV0gfTtcbiAgICB9XG4gICAgcmV0dXJuIHtrZXksIHZhbHVlOiB0cmFuc2Zvcm1lZENvbnN0cmFpbnR9O1xuICB9XG5cbiAgaWYgKGV4cGVjdGVkVHlwZUlzQXJyYXkgJiYgISh2YWx1ZSBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgIHJldHVybiB7a2V5LCB2YWx1ZTogeyAnJGFsbCcgOiBbdHJhbnNmb3JtSW50ZXJpb3JBdG9tKHZhbHVlKV0gfX07XG4gIH1cblxuICAvLyBIYW5kbGUgYXRvbWljIHZhbHVlc1xuICBpZiAodHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHZhbHVlKSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgcmV0dXJuIHtrZXksIHZhbHVlOiB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20odmFsdWUpfTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgWW91IGNhbm5vdCB1c2UgJHt2YWx1ZX0gYXMgYSBxdWVyeSBwYXJhbWV0ZXIuYCk7XG4gIH1cbn1cblxuLy8gTWFpbiBleHBvc2VkIG1ldGhvZCB0byBoZWxwIHJ1biBxdWVyaWVzLlxuLy8gcmVzdFdoZXJlIGlzIHRoZSBcIndoZXJlXCIgY2xhdXNlIGluIFJFU1QgQVBJIGZvcm0uXG4vLyBSZXR1cm5zIHRoZSBtb25nbyBmb3JtIG9mIHRoZSBxdWVyeS5cbmZ1bmN0aW9uIHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcmVzdFdoZXJlLCBzY2hlbWEpIHtcbiAgY29uc3QgbW9uZ29XaGVyZSA9IHt9O1xuICBmb3IgKGNvbnN0IHJlc3RLZXkgaW4gcmVzdFdoZXJlKSB7XG4gICAgY29uc3Qgb3V0ID0gdHJhbnNmb3JtUXVlcnlLZXlWYWx1ZShjbGFzc05hbWUsIHJlc3RLZXksIHJlc3RXaGVyZVtyZXN0S2V5XSwgc2NoZW1hKTtcbiAgICBtb25nb1doZXJlW291dC5rZXldID0gb3V0LnZhbHVlO1xuICB9XG4gIHJldHVybiBtb25nb1doZXJlO1xufVxuXG5jb25zdCBwYXJzZU9iamVjdEtleVZhbHVlVG9Nb25nb09iamVjdEtleVZhbHVlID0gKHJlc3RLZXksIHJlc3RWYWx1ZSwgc2NoZW1hKSA9PiB7XG4gIC8vIENoZWNrIGlmIHRoZSBzY2hlbWEgaXMga25vd24gc2luY2UgaXQncyBhIGJ1aWx0LWluIGZpZWxkLlxuICBsZXQgdHJhbnNmb3JtZWRWYWx1ZTtcbiAgbGV0IGNvZXJjZWRUb0RhdGU7XG4gIHN3aXRjaChyZXN0S2V5KSB7XG4gIGNhc2UgJ29iamVjdElkJzogcmV0dXJuIHtrZXk6ICdfaWQnLCB2YWx1ZTogcmVzdFZhbHVlfTtcbiAgY2FzZSAnZXhwaXJlc0F0JzpcbiAgICB0cmFuc2Zvcm1lZFZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gICAgY29lcmNlZFRvRGF0ZSA9IHR5cGVvZiB0cmFuc2Zvcm1lZFZhbHVlID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKHRyYW5zZm9ybWVkVmFsdWUpIDogdHJhbnNmb3JtZWRWYWx1ZVxuICAgIHJldHVybiB7a2V5OiAnZXhwaXJlc0F0JywgdmFsdWU6IGNvZXJjZWRUb0RhdGV9O1xuICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICBjb2VyY2VkVG9EYXRlID0gdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnID8gbmV3IERhdGUodHJhbnNmb3JtZWRWYWx1ZSkgOiB0cmFuc2Zvcm1lZFZhbHVlXG4gICAgcmV0dXJuIHtrZXk6ICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZX07XG4gIGNhc2UgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCc6XG4gICAgdHJhbnNmb3JtZWRWYWx1ZSA9IHRyYW5zZm9ybVRvcExldmVsQXRvbShyZXN0VmFsdWUpO1xuICAgIGNvZXJjZWRUb0RhdGUgPSB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKSA6IHRyYW5zZm9ybWVkVmFsdWVcbiAgICByZXR1cm4ge2tleTogJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcsIHZhbHVlOiBjb2VyY2VkVG9EYXRlfTtcbiAgY2FzZSAnX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdCc6XG4gICAgdHJhbnNmb3JtZWRWYWx1ZSA9IHRyYW5zZm9ybVRvcExldmVsQXRvbShyZXN0VmFsdWUpO1xuICAgIGNvZXJjZWRUb0RhdGUgPSB0eXBlb2YgdHJhbnNmb3JtZWRWYWx1ZSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZSh0cmFuc2Zvcm1lZFZhbHVlKSA6IHRyYW5zZm9ybWVkVmFsdWVcbiAgICByZXR1cm4geyBrZXk6ICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JywgdmFsdWU6IGNvZXJjZWRUb0RhdGUgfTtcbiAgY2FzZSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnOlxuICAgIHRyYW5zZm9ybWVkVmFsdWUgPSB0cmFuc2Zvcm1Ub3BMZXZlbEF0b20ocmVzdFZhbHVlKTtcbiAgICBjb2VyY2VkVG9EYXRlID0gdHlwZW9mIHRyYW5zZm9ybWVkVmFsdWUgPT09ICdzdHJpbmcnID8gbmV3IERhdGUodHJhbnNmb3JtZWRWYWx1ZSkgOiB0cmFuc2Zvcm1lZFZhbHVlXG4gICAgcmV0dXJuIHsga2V5OiAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnLCB2YWx1ZTogY29lcmNlZFRvRGF0ZSB9O1xuICBjYXNlICdfZmFpbGVkX2xvZ2luX2NvdW50JzpcbiAgY2FzZSAnX3JwZXJtJzpcbiAgY2FzZSAnX3dwZXJtJzpcbiAgY2FzZSAnX2VtYWlsX3ZlcmlmeV90b2tlbic6XG4gIGNhc2UgJ19oYXNoZWRfcGFzc3dvcmQnOlxuICBjYXNlICdfcGVyaXNoYWJsZV90b2tlbic6IHJldHVybiB7a2V5OiByZXN0S2V5LCB2YWx1ZTogcmVzdFZhbHVlfTtcbiAgY2FzZSAnc2Vzc2lvblRva2VuJzogcmV0dXJuIHtrZXk6ICdfc2Vzc2lvbl90b2tlbicsIHZhbHVlOiByZXN0VmFsdWV9O1xuICBkZWZhdWx0OlxuICAgIC8vIEF1dGggZGF0YSBzaG91bGQgaGF2ZSBiZWVuIHRyYW5zZm9ybWVkIGFscmVhZHlcbiAgICBpZiAocmVzdEtleS5tYXRjaCgvXmF1dGhEYXRhXFwuKFthLXpBLVowLTlfXSspXFwuaWQkLykpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCAnY2FuIG9ubHkgcXVlcnkgb24gJyArIHJlc3RLZXkpO1xuICAgIH1cbiAgICAvLyBUcnVzdCB0aGF0IHRoZSBhdXRoIGRhdGEgaGFzIGJlZW4gdHJhbnNmb3JtZWQgYW5kIHNhdmUgaXQgZGlyZWN0bHlcbiAgICBpZiAocmVzdEtleS5tYXRjaCgvXl9hdXRoX2RhdGFfW2EtekEtWjAtOV9dKyQvKSkge1xuICAgICAgcmV0dXJuIHtrZXk6IHJlc3RLZXksIHZhbHVlOiByZXN0VmFsdWV9O1xuICAgIH1cbiAgfVxuICAvL3NraXAgc3RyYWlnaHQgdG8gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tIGZvciBCeXRlcywgdGhleSBkb24ndCBzaG93IHVwIGluIHRoZSBzY2hlbWEgZm9yIHNvbWUgcmVhc29uXG4gIGlmIChyZXN0VmFsdWUgJiYgcmVzdFZhbHVlLl9fdHlwZSAhPT0gJ0J5dGVzJykge1xuICAgIC8vTm90ZTogV2UgbWF5IG5vdCBrbm93IHRoZSB0eXBlIG9mIGEgZmllbGQgaGVyZSwgYXMgdGhlIHVzZXIgY291bGQgYmUgc2F2aW5nIChudWxsKSB0byBhIGZpZWxkXG4gICAgLy9UaGF0IG5ldmVyIGV4aXN0ZWQgYmVmb3JlLCBtZWFuaW5nIHdlIGNhbid0IGluZmVyIHRoZSB0eXBlLlxuICAgIGlmIChzY2hlbWEuZmllbGRzW3Jlc3RLZXldICYmIHNjaGVtYS5maWVsZHNbcmVzdEtleV0udHlwZSA9PSAnUG9pbnRlcicgfHwgcmVzdFZhbHVlLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgIHJlc3RLZXkgPSAnX3BfJyArIHJlc3RLZXk7XG4gICAgfVxuICB9XG5cbiAgLy8gSGFuZGxlIGF0b21pYyB2YWx1ZXNcbiAgdmFyIHZhbHVlID0gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKHJlc3RWYWx1ZSk7XG4gIGlmICh2YWx1ZSAhPT0gQ2Fubm90VHJhbnNmb3JtKSB7XG4gICAgcmV0dXJuIHtrZXk6IHJlc3RLZXksIHZhbHVlOiB2YWx1ZX07XG4gIH1cblxuICAvLyBBQ0xzIGFyZSBoYW5kbGVkIGJlZm9yZSB0aGlzIG1ldGhvZCBpcyBjYWxsZWRcbiAgLy8gSWYgYW4gQUNMIGtleSBzdGlsbCBleGlzdHMgaGVyZSwgc29tZXRoaW5nIGlzIHdyb25nLlxuICBpZiAocmVzdEtleSA9PT0gJ0FDTCcpIHtcbiAgICB0aHJvdyAnVGhlcmUgd2FzIGEgcHJvYmxlbSB0cmFuc2Zvcm1pbmcgYW4gQUNMLic7XG4gIH1cblxuICAvLyBIYW5kbGUgYXJyYXlzXG4gIGlmIChyZXN0VmFsdWUgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHZhbHVlID0gcmVzdFZhbHVlLm1hcCh0cmFuc2Zvcm1JbnRlcmlvclZhbHVlKTtcbiAgICByZXR1cm4ge2tleTogcmVzdEtleSwgdmFsdWU6IHZhbHVlfTtcbiAgfVxuXG4gIC8vIEhhbmRsZSBub3JtYWwgb2JqZWN0cyBieSByZWN1cnNpbmdcbiAgaWYgKE9iamVjdC5rZXlzKHJlc3RWYWx1ZSkuc29tZShrZXkgPT4ga2V5LmluY2x1ZGVzKCckJykgfHwga2V5LmluY2x1ZGVzKCcuJykpKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfTkVTVEVEX0tFWSwgXCJOZXN0ZWQga2V5cyBzaG91bGQgbm90IGNvbnRhaW4gdGhlICckJyBvciAnLicgY2hhcmFjdGVyc1wiKTtcbiAgfVxuICB2YWx1ZSA9IG1hcFZhbHVlcyhyZXN0VmFsdWUsIHRyYW5zZm9ybUludGVyaW9yVmFsdWUpO1xuICByZXR1cm4ge2tleTogcmVzdEtleSwgdmFsdWV9O1xufVxuXG5jb25zdCBwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUgPSAoY2xhc3NOYW1lLCByZXN0Q3JlYXRlLCBzY2hlbWEpID0+IHtcbiAgcmVzdENyZWF0ZSA9IGFkZExlZ2FjeUFDTChyZXN0Q3JlYXRlKTtcbiAgY29uc3QgbW9uZ29DcmVhdGUgPSB7fVxuICBmb3IgKGNvbnN0IHJlc3RLZXkgaW4gcmVzdENyZWF0ZSkge1xuICAgIGlmIChyZXN0Q3JlYXRlW3Jlc3RLZXldICYmIHJlc3RDcmVhdGVbcmVzdEtleV0uX190eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgY29uc3QgeyBrZXksIHZhbHVlIH0gPSBwYXJzZU9iamVjdEtleVZhbHVlVG9Nb25nb09iamVjdEtleVZhbHVlKFxuICAgICAgcmVzdEtleSxcbiAgICAgIHJlc3RDcmVhdGVbcmVzdEtleV0sXG4gICAgICBzY2hlbWFcbiAgICApO1xuICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBtb25nb0NyZWF0ZVtrZXldID0gdmFsdWU7XG4gICAgfVxuICB9XG5cbiAgLy8gVXNlIHRoZSBsZWdhY3kgbW9uZ28gZm9ybWF0IGZvciBjcmVhdGVkQXQgYW5kIHVwZGF0ZWRBdFxuICBpZiAobW9uZ29DcmVhdGUuY3JlYXRlZEF0KSB7XG4gICAgbW9uZ29DcmVhdGUuX2NyZWF0ZWRfYXQgPSBuZXcgRGF0ZShtb25nb0NyZWF0ZS5jcmVhdGVkQXQuaXNvIHx8IG1vbmdvQ3JlYXRlLmNyZWF0ZWRBdCk7XG4gICAgZGVsZXRlIG1vbmdvQ3JlYXRlLmNyZWF0ZWRBdDtcbiAgfVxuICBpZiAobW9uZ29DcmVhdGUudXBkYXRlZEF0KSB7XG4gICAgbW9uZ29DcmVhdGUuX3VwZGF0ZWRfYXQgPSBuZXcgRGF0ZShtb25nb0NyZWF0ZS51cGRhdGVkQXQuaXNvIHx8IG1vbmdvQ3JlYXRlLnVwZGF0ZWRBdCk7XG4gICAgZGVsZXRlIG1vbmdvQ3JlYXRlLnVwZGF0ZWRBdDtcbiAgfVxuXG4gIHJldHVybiBtb25nb0NyZWF0ZTtcbn1cblxuLy8gTWFpbiBleHBvc2VkIG1ldGhvZCB0byBoZWxwIHVwZGF0ZSBvbGQgb2JqZWN0cy5cbmNvbnN0IHRyYW5zZm9ybVVwZGF0ZSA9IChjbGFzc05hbWUsIHJlc3RVcGRhdGUsIHBhcnNlRm9ybWF0U2NoZW1hKSA9PiB7XG4gIGNvbnN0IG1vbmdvVXBkYXRlID0ge307XG4gIGNvbnN0IGFjbCA9IGFkZExlZ2FjeUFDTChyZXN0VXBkYXRlKTtcbiAgaWYgKGFjbC5fcnBlcm0gfHwgYWNsLl93cGVybSB8fCBhY2wuX2FjbCkge1xuICAgIG1vbmdvVXBkYXRlLiRzZXQgPSB7fTtcbiAgICBpZiAoYWNsLl9ycGVybSkge1xuICAgICAgbW9uZ29VcGRhdGUuJHNldC5fcnBlcm0gPSBhY2wuX3JwZXJtO1xuICAgIH1cbiAgICBpZiAoYWNsLl93cGVybSkge1xuICAgICAgbW9uZ29VcGRhdGUuJHNldC5fd3Blcm0gPSBhY2wuX3dwZXJtO1xuICAgIH1cbiAgICBpZiAoYWNsLl9hY2wpIHtcbiAgICAgIG1vbmdvVXBkYXRlLiRzZXQuX2FjbCA9IGFjbC5fYWNsO1xuICAgIH1cbiAgfVxuICBmb3IgKHZhciByZXN0S2V5IGluIHJlc3RVcGRhdGUpIHtcbiAgICBpZiAocmVzdFVwZGF0ZVtyZXN0S2V5XSAmJiByZXN0VXBkYXRlW3Jlc3RLZXldLl9fdHlwZSA9PT0gJ1JlbGF0aW9uJykge1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHZhciBvdXQgPSB0cmFuc2Zvcm1LZXlWYWx1ZUZvclVwZGF0ZShjbGFzc05hbWUsIHJlc3RLZXksIHJlc3RVcGRhdGVbcmVzdEtleV0sIHBhcnNlRm9ybWF0U2NoZW1hKTtcblxuICAgIC8vIElmIHRoZSBvdXRwdXQgdmFsdWUgaXMgYW4gb2JqZWN0IHdpdGggYW55ICQga2V5cywgaXQncyBhblxuICAgIC8vIG9wZXJhdG9yIHRoYXQgbmVlZHMgdG8gYmUgbGlmdGVkIG9udG8gdGhlIHRvcCBsZXZlbCB1cGRhdGVcbiAgICAvLyBvYmplY3QuXG4gICAgaWYgKHR5cGVvZiBvdXQudmFsdWUgPT09ICdvYmplY3QnICYmIG91dC52YWx1ZSAhPT0gbnVsbCAmJiBvdXQudmFsdWUuX19vcCkge1xuICAgICAgbW9uZ29VcGRhdGVbb3V0LnZhbHVlLl9fb3BdID0gbW9uZ29VcGRhdGVbb3V0LnZhbHVlLl9fb3BdIHx8IHt9O1xuICAgICAgbW9uZ29VcGRhdGVbb3V0LnZhbHVlLl9fb3BdW291dC5rZXldID0gb3V0LnZhbHVlLmFyZztcbiAgICB9IGVsc2Uge1xuICAgICAgbW9uZ29VcGRhdGVbJyRzZXQnXSA9IG1vbmdvVXBkYXRlWyckc2V0J10gfHwge307XG4gICAgICBtb25nb1VwZGF0ZVsnJHNldCddW291dC5rZXldID0gb3V0LnZhbHVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBtb25nb1VwZGF0ZTtcbn1cblxuLy8gQWRkIHRoZSBsZWdhY3kgX2FjbCBmb3JtYXQuXG5jb25zdCBhZGRMZWdhY3lBQ0wgPSByZXN0T2JqZWN0ID0+IHtcbiAgY29uc3QgcmVzdE9iamVjdENvcHkgPSB7Li4ucmVzdE9iamVjdH07XG4gIGNvbnN0IF9hY2wgPSB7fTtcblxuICBpZiAocmVzdE9iamVjdC5fd3Blcm0pIHtcbiAgICByZXN0T2JqZWN0Ll93cGVybS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIF9hY2xbZW50cnldID0geyB3OiB0cnVlIH07XG4gICAgfSk7XG4gICAgcmVzdE9iamVjdENvcHkuX2FjbCA9IF9hY2w7XG4gIH1cblxuICBpZiAocmVzdE9iamVjdC5fcnBlcm0pIHtcbiAgICByZXN0T2JqZWN0Ll9ycGVybS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIGlmICghKGVudHJ5IGluIF9hY2wpKSB7XG4gICAgICAgIF9hY2xbZW50cnldID0geyByOiB0cnVlIH07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBfYWNsW2VudHJ5XS5yID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9KTtcbiAgICByZXN0T2JqZWN0Q29weS5fYWNsID0gX2FjbDtcbiAgfVxuXG4gIHJldHVybiByZXN0T2JqZWN0Q29weTtcbn1cblxuXG4vLyBBIHNlbnRpbmVsIHZhbHVlIHRoYXQgaGVscGVyIHRyYW5zZm9ybWF0aW9ucyByZXR1cm4gd2hlbiB0aGV5XG4vLyBjYW5ub3QgcGVyZm9ybSBhIHRyYW5zZm9ybWF0aW9uXG5mdW5jdGlvbiBDYW5ub3RUcmFuc2Zvcm0oKSB7fVxuXG5jb25zdCB0cmFuc2Zvcm1JbnRlcmlvckF0b20gPSAoYXRvbSkgPT4ge1xuICAvLyBUT0RPOiBjaGVjayB2YWxpZGl0eSBoYXJkZXIgZm9yIHRoZSBfX3R5cGUtZGVmaW5lZCB0eXBlc1xuICBpZiAodHlwZW9mIGF0b20gPT09ICdvYmplY3QnICYmIGF0b20gJiYgIShhdG9tIGluc3RhbmNlb2YgRGF0ZSkgJiYgYXRvbS5fX3R5cGUgPT09ICdQb2ludGVyJykge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgIGNsYXNzTmFtZTogYXRvbS5jbGFzc05hbWUsXG4gICAgICBvYmplY3RJZDogYXRvbS5vYmplY3RJZFxuICAgIH07XG4gIH0gZWxzZSBpZiAodHlwZW9mIGF0b20gPT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIGF0b20gPT09ICdzeW1ib2wnKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYGNhbm5vdCB0cmFuc2Zvcm0gdmFsdWU6ICR7YXRvbX1gKTtcbiAgfSBlbHNlIGlmIChEYXRlQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICByZXR1cm4gRGF0ZUNvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICB9IGVsc2UgaWYgKEJ5dGVzQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICByZXR1cm4gQnl0ZXNDb2Rlci5KU09OVG9EYXRhYmFzZShhdG9tKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgYXRvbSA9PT0gJ29iamVjdCcgJiYgYXRvbSAmJiBhdG9tLiRyZWdleCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgcmV0dXJuIG5ldyBSZWdFeHAoYXRvbS4kcmVnZXgpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBhdG9tO1xuICB9XG59XG5cbi8vIEhlbHBlciBmdW5jdGlvbiB0byB0cmFuc2Zvcm0gYW4gYXRvbSBmcm9tIFJFU1QgZm9ybWF0IHRvIE1vbmdvIGZvcm1hdC5cbi8vIEFuIGF0b20gaXMgYW55dGhpbmcgdGhhdCBjYW4ndCBjb250YWluIG90aGVyIGV4cHJlc3Npb25zLiBTbyBpdFxuLy8gaW5jbHVkZXMgdGhpbmdzIHdoZXJlIG9iamVjdHMgYXJlIHVzZWQgdG8gcmVwcmVzZW50IG90aGVyXG4vLyBkYXRhdHlwZXMsIGxpa2UgcG9pbnRlcnMgYW5kIGRhdGVzLCBidXQgaXQgZG9lcyBub3QgaW5jbHVkZSBvYmplY3RzXG4vLyBvciBhcnJheXMgd2l0aCBnZW5lcmljIHN0dWZmIGluc2lkZS5cbi8vIFJhaXNlcyBhbiBlcnJvciBpZiB0aGlzIGNhbm5vdCBwb3NzaWJseSBiZSB2YWxpZCBSRVNUIGZvcm1hdC5cbi8vIFJldHVybnMgQ2Fubm90VHJhbnNmb3JtIGlmIGl0J3MganVzdCBub3QgYW4gYXRvbVxuZnVuY3Rpb24gdHJhbnNmb3JtVG9wTGV2ZWxBdG9tKGF0b20sIGZpZWxkKSB7XG4gIHN3aXRjaCh0eXBlb2YgYXRvbSkge1xuICBjYXNlICdudW1iZXInOlxuICBjYXNlICdib29sZWFuJzpcbiAgY2FzZSAndW5kZWZpbmVkJzpcbiAgICByZXR1cm4gYXRvbTtcbiAgY2FzZSAnc3RyaW5nJzpcbiAgICBpZiAoZmllbGQgJiYgZmllbGQudHlwZSA9PT0gJ1BvaW50ZXInKSB7XG4gICAgICByZXR1cm4gYCR7ZmllbGQudGFyZ2V0Q2xhc3N9JCR7YXRvbX1gO1xuICAgIH1cbiAgICByZXR1cm4gYXRvbTtcbiAgY2FzZSAnc3ltYm9sJzpcbiAgY2FzZSAnZnVuY3Rpb24nOlxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sIGBjYW5ub3QgdHJhbnNmb3JtIHZhbHVlOiAke2F0b219YCk7XG4gIGNhc2UgJ29iamVjdCc6XG4gICAgaWYgKGF0b20gaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICAvLyBUZWNobmljYWxseSBkYXRlcyBhcmUgbm90IHJlc3QgZm9ybWF0LCBidXQsIGl0IHNlZW1zIHByZXR0eVxuICAgICAgLy8gY2xlYXIgd2hhdCB0aGV5IHNob3VsZCBiZSB0cmFuc2Zvcm1lZCB0bywgc28gbGV0J3MganVzdCBkbyBpdC5cbiAgICAgIHJldHVybiBhdG9tO1xuICAgIH1cblxuICAgIGlmIChhdG9tID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gYXRvbTtcbiAgICB9XG5cbiAgICAvLyBUT0RPOiBjaGVjayB2YWxpZGl0eSBoYXJkZXIgZm9yIHRoZSBfX3R5cGUtZGVmaW5lZCB0eXBlc1xuICAgIGlmIChhdG9tLl9fdHlwZSA9PSAnUG9pbnRlcicpIHtcbiAgICAgIHJldHVybiBgJHthdG9tLmNsYXNzTmFtZX0kJHthdG9tLm9iamVjdElkfWA7XG4gICAgfVxuICAgIGlmIChEYXRlQ29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgIHJldHVybiBEYXRlQ29kZXIuSlNPTlRvRGF0YWJhc2UoYXRvbSk7XG4gICAgfVxuICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICByZXR1cm4gQnl0ZXNDb2Rlci5KU09OVG9EYXRhYmFzZShhdG9tKTtcbiAgICB9XG4gICAgaWYgKEdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04oYXRvbSkpIHtcbiAgICAgIHJldHVybiBHZW9Qb2ludENvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgIH1cbiAgICBpZiAoUG9seWdvbkNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICByZXR1cm4gUG9seWdvbkNvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgIH1cbiAgICBpZiAoRmlsZUNvZGVyLmlzVmFsaWRKU09OKGF0b20pKSB7XG4gICAgICByZXR1cm4gRmlsZUNvZGVyLkpTT05Ub0RhdGFiYXNlKGF0b20pO1xuICAgIH1cbiAgICByZXR1cm4gQ2Fubm90VHJhbnNmb3JtO1xuXG4gIGRlZmF1bHQ6XG4gICAgLy8gSSBkb24ndCB0aGluayB0eXBlb2YgY2FuIGV2ZXIgbGV0IHVzIGdldCBoZXJlXG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVEVSTkFMX1NFUlZFUl9FUlJPUiwgYHJlYWxseSBkaWQgbm90IGV4cGVjdCB2YWx1ZTogJHthdG9tfWApO1xuICB9XG59XG5cbmZ1bmN0aW9uIHJlbGF0aXZlVGltZVRvRGF0ZSh0ZXh0LCBub3cgPSBuZXcgRGF0ZSgpKSB7XG4gIHRleHQgPSB0ZXh0LnRvTG93ZXJDYXNlKCk7XG5cbiAgbGV0IHBhcnRzID0gdGV4dC5zcGxpdCgnICcpO1xuXG4gIC8vIEZpbHRlciBvdXQgd2hpdGVzcGFjZVxuICBwYXJ0cyA9IHBhcnRzLmZpbHRlcigocGFydCkgPT4gcGFydCAhPT0gJycpO1xuXG4gIGNvbnN0IGZ1dHVyZSA9IHBhcnRzWzBdID09PSAnaW4nO1xuICBjb25zdCBwYXN0ID0gcGFydHNbcGFydHMubGVuZ3RoIC0gMV0gPT09ICdhZ28nO1xuXG4gIGlmICghZnV0dXJlICYmICFwYXN0ICYmIHRleHQgIT09ICdub3cnKSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAnZXJyb3InLCBpbmZvOiBcIlRpbWUgc2hvdWxkIGVpdGhlciBzdGFydCB3aXRoICdpbicgb3IgZW5kIHdpdGggJ2FnbydcIiB9O1xuICB9XG5cbiAgaWYgKGZ1dHVyZSAmJiBwYXN0KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgIGluZm86IFwiVGltZSBjYW5ub3QgaGF2ZSBib3RoICdpbicgYW5kICdhZ28nXCIsXG4gICAgfTtcbiAgfVxuXG4gIC8vIHN0cmlwIHRoZSAnYWdvJyBvciAnaW4nXG4gIGlmIChmdXR1cmUpIHtcbiAgICBwYXJ0cyA9IHBhcnRzLnNsaWNlKDEpO1xuICB9IGVsc2UgeyAvLyBwYXN0XG4gICAgcGFydHMgPSBwYXJ0cy5zbGljZSgwLCBwYXJ0cy5sZW5ndGggLSAxKTtcbiAgfVxuXG4gIGlmIChwYXJ0cy5sZW5ndGggJSAyICE9PSAwICYmIHRleHQgIT09ICdub3cnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ2Vycm9yJyxcbiAgICAgIGluZm86ICdJbnZhbGlkIHRpbWUgc3RyaW5nLiBEYW5nbGluZyB1bml0IG9yIG51bWJlci4nLFxuICAgIH07XG4gIH1cblxuICBjb25zdCBwYWlycyA9IFtdO1xuICB3aGlsZShwYXJ0cy5sZW5ndGgpIHtcbiAgICBwYWlycy5wdXNoKFsgcGFydHMuc2hpZnQoKSwgcGFydHMuc2hpZnQoKSBdKTtcbiAgfVxuXG4gIGxldCBzZWNvbmRzID0gMDtcbiAgZm9yIChjb25zdCBbbnVtLCBpbnRlcnZhbF0gb2YgcGFpcnMpIHtcbiAgICBjb25zdCB2YWwgPSBOdW1iZXIobnVtKTtcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIodmFsKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICBpbmZvOiBgJyR7bnVtfScgaXMgbm90IGFuIGludGVnZXIuYCxcbiAgICAgIH07XG4gICAgfVxuXG4gICAgc3dpdGNoKGludGVydmFsKSB7XG4gICAgY2FzZSAneXInOlxuICAgIGNhc2UgJ3lycyc6XG4gICAgY2FzZSAneWVhcic6XG4gICAgY2FzZSAneWVhcnMnOlxuICAgICAgc2Vjb25kcyArPSB2YWwgKiAzMTUzNjAwMDsgLy8gMzY1ICogMjQgKiA2MCAqIDYwXG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3drJzpcbiAgICBjYXNlICd3a3MnOlxuICAgIGNhc2UgJ3dlZWsnOlxuICAgIGNhc2UgJ3dlZWtzJzpcbiAgICAgIHNlY29uZHMgKz0gdmFsICogNjA0ODAwOyAvLyA3ICogMjQgKiA2MCAqIDYwXG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ2QnOlxuICAgIGNhc2UgJ2RheSc6XG4gICAgY2FzZSAnZGF5cyc6XG4gICAgICBzZWNvbmRzICs9IHZhbCAqIDg2NDAwOyAvLyAyNCAqIDYwICogNjBcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnaHInOlxuICAgIGNhc2UgJ2hycyc6XG4gICAgY2FzZSAnaG91cic6XG4gICAgY2FzZSAnaG91cnMnOlxuICAgICAgc2Vjb25kcyArPSB2YWwgKiAzNjAwOyAvLyA2MCAqIDYwXG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ21pbic6XG4gICAgY2FzZSAnbWlucyc6XG4gICAgY2FzZSAnbWludXRlJzpcbiAgICBjYXNlICdtaW51dGVzJzpcbiAgICAgIHNlY29uZHMgKz0gdmFsICogNjA7XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJ3NlYyc6XG4gICAgY2FzZSAnc2Vjcyc6XG4gICAgY2FzZSAnc2Vjb25kJzpcbiAgICBjYXNlICdzZWNvbmRzJzpcbiAgICAgIHNlY29uZHMgKz0gdmFsO1xuICAgICAgYnJlYWs7XG5cbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgc3RhdHVzOiAnZXJyb3InLFxuICAgICAgICBpbmZvOiBgSW52YWxpZCBpbnRlcnZhbDogJyR7aW50ZXJ2YWx9J2AsXG4gICAgICB9O1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IG1pbGxpc2Vjb25kcyA9IHNlY29uZHMgKiAxMDAwO1xuICBpZiAoZnV0dXJlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgaW5mbzogJ2Z1dHVyZScsXG4gICAgICByZXN1bHQ6IG5ldyBEYXRlKG5vdy52YWx1ZU9mKCkgKyBtaWxsaXNlY29uZHMpXG4gICAgfTtcbiAgfSBlbHNlIGlmIChwYXN0KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgaW5mbzogJ3Bhc3QnLFxuICAgICAgcmVzdWx0OiBuZXcgRGF0ZShub3cudmFsdWVPZigpIC0gbWlsbGlzZWNvbmRzKVxuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3N1Y2Nlc3MnLFxuICAgICAgaW5mbzogJ3ByZXNlbnQnLFxuICAgICAgcmVzdWx0OiBuZXcgRGF0ZShub3cudmFsdWVPZigpKVxuICAgIH1cbiAgfVxufVxuXG4vLyBUcmFuc2Zvcm1zIGEgcXVlcnkgY29uc3RyYWludCBmcm9tIFJFU1QgQVBJIGZvcm1hdCB0byBNb25nbyBmb3JtYXQuXG4vLyBBIGNvbnN0cmFpbnQgaXMgc29tZXRoaW5nIHdpdGggZmllbGRzIGxpa2UgJGx0LlxuLy8gSWYgaXQgaXMgbm90IGEgdmFsaWQgY29uc3RyYWludCBidXQgaXQgY291bGQgYmUgYSB2YWxpZCBzb21ldGhpbmdcbi8vIGVsc2UsIHJldHVybiBDYW5ub3RUcmFuc2Zvcm0uXG4vLyBpbkFycmF5IGlzIHdoZXRoZXIgdGhpcyBpcyBhbiBhcnJheSBmaWVsZC5cbmZ1bmN0aW9uIHRyYW5zZm9ybUNvbnN0cmFpbnQoY29uc3RyYWludCwgZmllbGQpIHtcbiAgY29uc3QgaW5BcnJheSA9IGZpZWxkICYmIGZpZWxkLnR5cGUgJiYgZmllbGQudHlwZSA9PT0gJ0FycmF5JztcbiAgaWYgKHR5cGVvZiBjb25zdHJhaW50ICE9PSAnb2JqZWN0JyB8fCAhY29uc3RyYWludCkge1xuICAgIHJldHVybiBDYW5ub3RUcmFuc2Zvcm07XG4gIH1cbiAgY29uc3QgdHJhbnNmb3JtRnVuY3Rpb24gPSBpbkFycmF5ID8gdHJhbnNmb3JtSW50ZXJpb3JBdG9tIDogdHJhbnNmb3JtVG9wTGV2ZWxBdG9tO1xuICBjb25zdCB0cmFuc2Zvcm1lciA9IChhdG9tKSA9PiB7XG4gICAgY29uc3QgcmVzdWx0ID0gdHJhbnNmb3JtRnVuY3Rpb24oYXRvbSwgZmllbGQpO1xuICAgIGlmIChyZXN1bHQgPT09IENhbm5vdFRyYW5zZm9ybSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgYGJhZCBhdG9tOiAke0pTT04uc3RyaW5naWZ5KGF0b20pfWApO1xuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG4gIC8vIGtleXMgaXMgdGhlIGNvbnN0cmFpbnRzIGluIHJldmVyc2UgYWxwaGFiZXRpY2FsIG9yZGVyLlxuICAvLyBUaGlzIGlzIGEgaGFjayBzbyB0aGF0OlxuICAvLyAgICRyZWdleCBpcyBoYW5kbGVkIGJlZm9yZSAkb3B0aW9uc1xuICAvLyAgICRuZWFyU3BoZXJlIGlzIGhhbmRsZWQgYmVmb3JlICRtYXhEaXN0YW5jZVxuICB2YXIga2V5cyA9IE9iamVjdC5rZXlzKGNvbnN0cmFpbnQpLnNvcnQoKS5yZXZlcnNlKCk7XG4gIHZhciBhbnN3ZXIgPSB7fTtcbiAgZm9yICh2YXIga2V5IG9mIGtleXMpIHtcbiAgICBzd2l0Y2goa2V5KSB7XG4gICAgY2FzZSAnJGx0JzpcbiAgICBjYXNlICckbHRlJzpcbiAgICBjYXNlICckZ3QnOlxuICAgIGNhc2UgJyRndGUnOlxuICAgIGNhc2UgJyRleGlzdHMnOlxuICAgIGNhc2UgJyRuZSc6XG4gICAgY2FzZSAnJGVxJzoge1xuICAgICAgY29uc3QgdmFsID0gY29uc3RyYWludFtrZXldO1xuICAgICAgaWYgKHZhbCAmJiB0eXBlb2YgdmFsID09PSAnb2JqZWN0JyAmJiB2YWwuJHJlbGF0aXZlVGltZSkge1xuICAgICAgICBpZiAoZmllbGQgJiYgZmllbGQudHlwZSAhPT0gJ0RhdGUnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJyRyZWxhdGl2ZVRpbWUgY2FuIG9ubHkgYmUgdXNlZCB3aXRoIERhdGUgZmllbGQnKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHN3aXRjaCAoa2V5KSB7XG4gICAgICAgIGNhc2UgJyRleGlzdHMnOlxuICAgICAgICBjYXNlICckbmUnOlxuICAgICAgICBjYXNlICckZXEnOlxuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICckcmVsYXRpdmVUaW1lIGNhbiBvbmx5IGJlIHVzZWQgd2l0aCB0aGUgJGx0LCAkbHRlLCAkZ3QsIGFuZCAkZ3RlIG9wZXJhdG9ycycpO1xuICAgICAgICB9XG5cbiAgICAgICAgY29uc3QgcGFyc2VyUmVzdWx0ID0gcmVsYXRpdmVUaW1lVG9EYXRlKHZhbC4kcmVsYXRpdmVUaW1lKTtcbiAgICAgICAgaWYgKHBhcnNlclJlc3VsdC5zdGF0dXMgPT09ICdzdWNjZXNzJykge1xuICAgICAgICAgIGFuc3dlcltrZXldID0gcGFyc2VyUmVzdWx0LnJlc3VsdDtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGxvZy5pbmZvKCdFcnJvciB3aGlsZSBwYXJzaW5nIHJlbGF0aXZlIGRhdGUnLCBwYXJzZXJSZXN1bHQpO1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCBgYmFkICRyZWxhdGl2ZVRpbWUgKCR7a2V5fSkgdmFsdWUuICR7cGFyc2VyUmVzdWx0LmluZm99YCk7XG4gICAgICB9XG5cbiAgICAgIGFuc3dlcltrZXldID0gdHJhbnNmb3JtZXIodmFsKTtcbiAgICAgIGJyZWFrO1xuICAgIH1cblxuICAgIGNhc2UgJyRpbic6XG4gICAgY2FzZSAnJG5pbic6IHtcbiAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgIGlmICghKGFyciBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICcgKyBrZXkgKyAnIHZhbHVlJyk7XG4gICAgICB9XG4gICAgICBhbnN3ZXJba2V5XSA9IF8uZmxhdE1hcChhcnIsIHZhbHVlID0+IHtcbiAgICAgICAgcmV0dXJuICgoYXRvbSkgPT4ge1xuICAgICAgICAgIGlmIChBcnJheS5pc0FycmF5KGF0b20pKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsdWUubWFwKHRyYW5zZm9ybWVyKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRyYW5zZm9ybWVyKGF0b20pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSkodmFsdWUpO1xuICAgICAgfSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnJGFsbCc6IHtcbiAgICAgIGNvbnN0IGFyciA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgIGlmICghKGFyciBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICdiYWQgJyArIGtleSArICcgdmFsdWUnKTtcbiAgICAgIH1cbiAgICAgIGFuc3dlcltrZXldID0gYXJyLm1hcCh0cmFuc2Zvcm1JbnRlcmlvckF0b20pO1xuXG4gICAgICBjb25zdCB2YWx1ZXMgPSBhbnN3ZXJba2V5XTtcbiAgICAgIGlmIChpc0FueVZhbHVlUmVnZXgodmFsdWVzKSAmJiAhaXNBbGxWYWx1ZXNSZWdleE9yTm9uZSh2YWx1ZXMpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdBbGwgJGFsbCB2YWx1ZXMgbXVzdCBiZSBvZiByZWdleCB0eXBlIG9yIG5vbmU6ICdcbiAgICAgICAgICArIHZhbHVlcyk7XG4gICAgICB9XG5cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICckcmVnZXgnOlxuICAgICAgdmFyIHMgPSBjb25zdHJhaW50W2tleV07XG4gICAgICBpZiAodHlwZW9mIHMgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgcmVnZXg6ICcgKyBzKTtcbiAgICAgIH1cbiAgICAgIGFuc3dlcltrZXldID0gcztcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJGNvbnRhaW5lZEJ5Jzoge1xuICAgICAgY29uc3QgYXJyID0gY29uc3RyYWludFtrZXldO1xuICAgICAgaWYgKCEoYXJyIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkY29udGFpbmVkQnk6IHNob3VsZCBiZSBhbiBhcnJheWBcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIGFuc3dlci4kZWxlbU1hdGNoID0ge1xuICAgICAgICAkbmluOiBhcnIubWFwKHRyYW5zZm9ybWVyKVxuICAgICAgfTtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICckb3B0aW9ucyc6XG4gICAgICBhbnN3ZXJba2V5XSA9IGNvbnN0cmFpbnRba2V5XTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJHRleHQnOiB7XG4gICAgICBjb25zdCBzZWFyY2ggPSBjb25zdHJhaW50W2tleV0uJHNlYXJjaDtcbiAgICAgIGlmICh0eXBlb2Ygc2VhcmNoICE9PSAnb2JqZWN0Jykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRzZWFyY2gsIHNob3VsZCBiZSBvYmplY3RgXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBpZiAoIXNlYXJjaC4kdGVybSB8fCB0eXBlb2Ygc2VhcmNoLiR0ZXJtICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICR0ZXJtLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgJyRzZWFyY2gnOiBzZWFyY2guJHRlcm1cbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKHNlYXJjaC4kbGFuZ3VhZ2UgJiYgdHlwZW9mIHNlYXJjaC4kbGFuZ3VhZ2UgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGxhbmd1YWdlLCBzaG91bGQgYmUgc3RyaW5nYFxuICAgICAgICApO1xuICAgICAgfSBlbHNlIGlmIChzZWFyY2guJGxhbmd1YWdlKSB7XG4gICAgICAgIGFuc3dlcltrZXldLiRsYW5ndWFnZSA9IHNlYXJjaC4kbGFuZ3VhZ2U7XG4gICAgICB9XG4gICAgICBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlICYmIHR5cGVvZiBzZWFyY2guJGNhc2VTZW5zaXRpdmUgIT09ICdib29sZWFuJykge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgIGBiYWQgJHRleHQ6ICRjYXNlU2Vuc2l0aXZlLCBzaG91bGQgYmUgYm9vbGVhbmBcbiAgICAgICAgKTtcbiAgICAgIH0gZWxzZSBpZiAoc2VhcmNoLiRjYXNlU2Vuc2l0aXZlKSB7XG4gICAgICAgIGFuc3dlcltrZXldLiRjYXNlU2Vuc2l0aXZlID0gc2VhcmNoLiRjYXNlU2Vuc2l0aXZlO1xuICAgICAgfVxuICAgICAgaWYgKHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlICYmIHR5cGVvZiBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZSAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgYGJhZCAkdGV4dDogJGRpYWNyaXRpY1NlbnNpdGl2ZSwgc2hvdWxkIGJlIGJvb2xlYW5gXG4gICAgICAgICk7XG4gICAgICB9IGVsc2UgaWYgKHNlYXJjaC4kZGlhY3JpdGljU2Vuc2l0aXZlKSB7XG4gICAgICAgIGFuc3dlcltrZXldLiRkaWFjcml0aWNTZW5zaXRpdmUgPSBzZWFyY2guJGRpYWNyaXRpY1NlbnNpdGl2ZTtcbiAgICAgIH1cbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgICBjYXNlICckbmVhclNwaGVyZSc6XG4gICAgICB2YXIgcG9pbnQgPSBjb25zdHJhaW50W2tleV07XG4gICAgICBhbnN3ZXJba2V5XSA9IFtwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlXTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJG1heERpc3RhbmNlJzpcbiAgICAgIGFuc3dlcltrZXldID0gY29uc3RyYWludFtrZXldO1xuICAgICAgYnJlYWs7XG5cbiAgICAvLyBUaGUgU0RLcyBkb24ndCBzZWVtIHRvIHVzZSB0aGVzZSBidXQgdGhleSBhcmUgZG9jdW1lbnRlZCBpbiB0aGVcbiAgICAvLyBSRVNUIEFQSSBkb2NzLlxuICAgIGNhc2UgJyRtYXhEaXN0YW5jZUluUmFkaWFucyc6XG4gICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnJG1heERpc3RhbmNlSW5NaWxlcyc6XG4gICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldIC8gMzk1OTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJyRtYXhEaXN0YW5jZUluS2lsb21ldGVycyc6XG4gICAgICBhbnN3ZXJbJyRtYXhEaXN0YW5jZSddID0gY29uc3RyYWludFtrZXldIC8gNjM3MTtcbiAgICAgIGJyZWFrO1xuXG4gICAgY2FzZSAnJHNlbGVjdCc6XG4gICAgY2FzZSAnJGRvbnRTZWxlY3QnOlxuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5DT01NQU5EX1VOQVZBSUxBQkxFLFxuICAgICAgICAndGhlICcgKyBrZXkgKyAnIGNvbnN0cmFpbnQgaXMgbm90IHN1cHBvcnRlZCB5ZXQnKTtcblxuICAgIGNhc2UgJyR3aXRoaW4nOlxuICAgICAgdmFyIGJveCA9IGNvbnN0cmFpbnRba2V5XVsnJGJveCddO1xuICAgICAgaWYgKCFib3ggfHwgYm94Lmxlbmd0aCAhPSAyKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ21hbGZvcm1hdHRlZCAkd2l0aGluIGFyZycpO1xuICAgICAgfVxuICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICckYm94JzogW1xuICAgICAgICAgIFtib3hbMF0ubG9uZ2l0dWRlLCBib3hbMF0ubGF0aXR1ZGVdLFxuICAgICAgICAgIFtib3hbMV0ubG9uZ2l0dWRlLCBib3hbMV0ubGF0aXR1ZGVdXG4gICAgICAgIF1cbiAgICAgIH07XG4gICAgICBicmVhaztcblxuICAgIGNhc2UgJyRnZW9XaXRoaW4nOiB7XG4gICAgICBjb25zdCBwb2x5Z29uID0gY29uc3RyYWludFtrZXldWyckcG9seWdvbiddO1xuICAgICAgY29uc3QgY2VudGVyU3BoZXJlID0gY29uc3RyYWludFtrZXldWyckY2VudGVyU3BoZXJlJ107XG4gICAgICBpZiAocG9seWdvbiAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGxldCBwb2ludHM7XG4gICAgICAgIGlmICh0eXBlb2YgcG9seWdvbiA9PT0gJ29iamVjdCcgJiYgcG9seWdvbi5fX3R5cGUgPT09ICdQb2x5Z29uJykge1xuICAgICAgICAgIGlmICghcG9seWdvbi5jb29yZGluYXRlcyB8fCBwb2x5Z29uLmNvb3JkaW5hdGVzLmxlbmd0aCA8IDMpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgICAnYmFkICRnZW9XaXRoaW4gdmFsdWU7IFBvbHlnb24uY29vcmRpbmF0ZXMgc2hvdWxkIGNvbnRhaW4gYXQgbGVhc3QgMyBsb24vbGF0IHBhaXJzJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcG9pbnRzID0gcG9seWdvbi5jb29yZGluYXRlcztcbiAgICAgICAgfSBlbHNlIGlmIChwb2x5Z29uIGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgICAgICBpZiAocG9seWdvbi5sZW5ndGggPCAzKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoXG4gICAgICAgICAgICAgIFBhcnNlLkVycm9yLklOVkFMSURfSlNPTixcbiAgICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgY29udGFpbiBhdCBsZWFzdCAzIEdlb1BvaW50cydcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBvaW50cyA9IHBvbHlnb247XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICAgICAgUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLFxuICAgICAgICAgICAgJ2JhZCAkZ2VvV2l0aGluIHZhbHVlOyAkcG9seWdvbiBzaG91bGQgYmUgUG9seWdvbiBvYmplY3Qgb3IgQXJyYXkgb2YgUGFyc2UuR2VvUG9pbnRcXCdzJ1xuICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICAgICAgcG9pbnRzID0gcG9pbnRzLm1hcCgocG9pbnQpID0+IHtcbiAgICAgICAgICBpZiAocG9pbnQgaW5zdGFuY2VvZiBBcnJheSAmJiBwb2ludC5sZW5ndGggPT09IDIpIHtcbiAgICAgICAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwb2ludFsxXSwgcG9pbnRbMF0pO1xuICAgICAgICAgICAgcmV0dXJuIHBvaW50O1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoIUdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04ocG9pbnQpKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWUnKTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgICAgIH1cbiAgICAgICAgICByZXR1cm4gW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdO1xuICAgICAgICB9KTtcbiAgICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICAgJyRwb2x5Z29uJzogcG9pbnRzXG4gICAgICAgIH07XG4gICAgICB9IGVsc2UgaWYgKGNlbnRlclNwaGVyZSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGlmICghKGNlbnRlclNwaGVyZSBpbnN0YW5jZW9mIEFycmF5KSB8fCBjZW50ZXJTcGhlcmUubGVuZ3RoIDwgMikge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdiYWQgJGdlb1dpdGhpbiB2YWx1ZTsgJGNlbnRlclNwaGVyZSBzaG91bGQgYmUgYW4gYXJyYXkgb2YgUGFyc2UuR2VvUG9pbnQgYW5kIGRpc3RhbmNlJyk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gR2V0IHBvaW50LCBjb252ZXJ0IHRvIGdlbyBwb2ludCBpZiBuZWNlc3NhcnkgYW5kIHZhbGlkYXRlXG4gICAgICAgIGxldCBwb2ludCA9IGNlbnRlclNwaGVyZVswXTtcbiAgICAgICAgaWYgKHBvaW50IGluc3RhbmNlb2YgQXJyYXkgJiYgcG9pbnQubGVuZ3RoID09PSAyKSB7XG4gICAgICAgICAgcG9pbnQgPSBuZXcgUGFyc2UuR2VvUG9pbnQocG9pbnRbMV0sIHBvaW50WzBdKTtcbiAgICAgICAgfSBlbHNlIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkSlNPTihwb2ludCkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZ2VvIHBvaW50IGludmFsaWQnKTtcbiAgICAgICAgfVxuICAgICAgICBQYXJzZS5HZW9Qb2ludC5fdmFsaWRhdGUocG9pbnQubGF0aXR1ZGUsIHBvaW50LmxvbmdpdHVkZSk7XG4gICAgICAgIC8vIEdldCBkaXN0YW5jZSBhbmQgdmFsaWRhdGVcbiAgICAgICAgY29uc3QgZGlzdGFuY2UgPSBjZW50ZXJTcGhlcmVbMV07XG4gICAgICAgIGlmKGlzTmFOKGRpc3RhbmNlKSB8fCBkaXN0YW5jZSA8IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnYmFkICRnZW9XaXRoaW4gdmFsdWU7ICRjZW50ZXJTcGhlcmUgZGlzdGFuY2UgaW52YWxpZCcpO1xuICAgICAgICB9XG4gICAgICAgIGFuc3dlcltrZXldID0ge1xuICAgICAgICAgICckY2VudGVyU3BoZXJlJzogW1xuICAgICAgICAgICAgW3BvaW50LmxvbmdpdHVkZSwgcG9pbnQubGF0aXR1ZGVdLFxuICAgICAgICAgICAgZGlzdGFuY2VcbiAgICAgICAgICBdXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBicmVhaztcbiAgICB9XG4gICAgY2FzZSAnJGdlb0ludGVyc2VjdHMnOiB7XG4gICAgICBjb25zdCBwb2ludCA9IGNvbnN0cmFpbnRba2V5XVsnJHBvaW50J107XG4gICAgICBpZiAoIUdlb1BvaW50Q29kZXIuaXNWYWxpZEpTT04ocG9pbnQpKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2JhZCAkZ2VvSW50ZXJzZWN0IHZhbHVlOyAkcG9pbnQgc2hvdWxkIGJlIEdlb1BvaW50J1xuICAgICAgICApO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgUGFyc2UuR2VvUG9pbnQuX3ZhbGlkYXRlKHBvaW50LmxhdGl0dWRlLCBwb2ludC5sb25naXR1ZGUpO1xuICAgICAgfVxuICAgICAgYW5zd2VyW2tleV0gPSB7XG4gICAgICAgICRnZW9tZXRyeToge1xuICAgICAgICAgIHR5cGU6ICdQb2ludCcsXG4gICAgICAgICAgY29vcmRpbmF0ZXM6IFtwb2ludC5sb25naXR1ZGUsIHBvaW50LmxhdGl0dWRlXVxuICAgICAgICB9XG4gICAgICB9O1xuICAgICAgYnJlYWs7XG4gICAgfVxuICAgIGRlZmF1bHQ6XG4gICAgICBpZiAoa2V5Lm1hdGNoKC9eXFwkKy8pKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihcbiAgICAgICAgICBQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sXG4gICAgICAgICAgJ2JhZCBjb25zdHJhaW50OiAnICsga2V5KTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBDYW5ub3RUcmFuc2Zvcm07XG4gICAgfVxuICB9XG4gIHJldHVybiBhbnN3ZXI7XG59XG5cbi8vIFRyYW5zZm9ybXMgYW4gdXBkYXRlIG9wZXJhdG9yIGZyb20gUkVTVCBmb3JtYXQgdG8gbW9uZ28gZm9ybWF0LlxuLy8gVG8gYmUgdHJhbnNmb3JtZWQsIHRoZSBpbnB1dCBzaG91bGQgaGF2ZSBhbiBfX29wIGZpZWxkLlxuLy8gSWYgZmxhdHRlbiBpcyB0cnVlLCB0aGlzIHdpbGwgZmxhdHRlbiBvcGVyYXRvcnMgdG8gdGhlaXIgc3RhdGljXG4vLyBkYXRhIGZvcm1hdC4gRm9yIGV4YW1wbGUsIGFuIGluY3JlbWVudCBvZiAyIHdvdWxkIHNpbXBseSBiZWNvbWUgYVxuLy8gMi5cbi8vIFRoZSBvdXRwdXQgZm9yIGEgbm9uLWZsYXR0ZW5lZCBvcGVyYXRvciBpcyBhIGhhc2ggd2l0aCBfX29wIGJlaW5nXG4vLyB0aGUgbW9uZ28gb3AsIGFuZCBhcmcgYmVpbmcgdGhlIGFyZ3VtZW50LlxuLy8gVGhlIG91dHB1dCBmb3IgYSBmbGF0dGVuZWQgb3BlcmF0b3IgaXMganVzdCBhIHZhbHVlLlxuLy8gUmV0dXJucyB1bmRlZmluZWQgaWYgdGhpcyBzaG91bGQgYmUgYSBuby1vcC5cblxuZnVuY3Rpb24gdHJhbnNmb3JtVXBkYXRlT3BlcmF0b3Ioe1xuICBfX29wLFxuICBhbW91bnQsXG4gIG9iamVjdHMsXG59LCBmbGF0dGVuKSB7XG4gIHN3aXRjaChfX29wKSB7XG4gIGNhc2UgJ0RlbGV0ZSc6XG4gICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB7X19vcDogJyR1bnNldCcsIGFyZzogJyd9O1xuICAgIH1cblxuICBjYXNlICdJbmNyZW1lbnQnOlxuICAgIGlmICh0eXBlb2YgYW1vdW50ICE9PSAnbnVtYmVyJykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ2luY3JlbWVudGluZyBtdXN0IHByb3ZpZGUgYSBudW1iZXInKTtcbiAgICB9XG4gICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgIHJldHVybiBhbW91bnQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB7X19vcDogJyRpbmMnLCBhcmc6IGFtb3VudH07XG4gICAgfVxuXG4gIGNhc2UgJ0FkZCc6XG4gIGNhc2UgJ0FkZFVuaXF1ZSc6XG4gICAgaWYgKCEob2JqZWN0cyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICB9XG4gICAgdmFyIHRvQWRkID0gb2JqZWN0cy5tYXAodHJhbnNmb3JtSW50ZXJpb3JBdG9tKTtcbiAgICBpZiAoZmxhdHRlbikge1xuICAgICAgcmV0dXJuIHRvQWRkO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbW9uZ29PcCA9IHtcbiAgICAgICAgQWRkOiAnJHB1c2gnLFxuICAgICAgICBBZGRVbmlxdWU6ICckYWRkVG9TZXQnXG4gICAgICB9W19fb3BdO1xuICAgICAgcmV0dXJuIHtfX29wOiBtb25nb09wLCBhcmc6IHsnJGVhY2gnOiB0b0FkZH19O1xuICAgIH1cblxuICBjYXNlICdSZW1vdmUnOlxuICAgIGlmICghKG9iamVjdHMgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdvYmplY3RzIHRvIHJlbW92ZSBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gICAgfVxuICAgIHZhciB0b1JlbW92ZSA9IG9iamVjdHMubWFwKHRyYW5zZm9ybUludGVyaW9yQXRvbSk7XG4gICAgaWYgKGZsYXR0ZW4pIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHtfX29wOiAnJHB1bGxBbGwnLCBhcmc6IHRvUmVtb3ZlfTtcbiAgICB9XG5cbiAgZGVmYXVsdDpcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuQ09NTUFORF9VTkFWQUlMQUJMRSwgYFRoZSAke19fb3B9IG9wZXJhdG9yIGlzIG5vdCBzdXBwb3J0ZWQgeWV0LmApO1xuICB9XG59XG5mdW5jdGlvbiBtYXBWYWx1ZXMob2JqZWN0LCBpdGVyYXRvcikge1xuICBjb25zdCByZXN1bHQgPSB7fTtcbiAgT2JqZWN0LmtleXMob2JqZWN0KS5mb3JFYWNoKChrZXkpID0+IHtcbiAgICByZXN1bHRba2V5XSA9IGl0ZXJhdG9yKG9iamVjdFtrZXldKTtcbiAgfSk7XG4gIHJldHVybiByZXN1bHQ7XG59XG5cbmNvbnN0IG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCA9IG1vbmdvT2JqZWN0ID0+IHtcbiAgc3dpdGNoKHR5cGVvZiBtb25nb09iamVjdCkge1xuICBjYXNlICdzdHJpbmcnOlxuICBjYXNlICdudW1iZXInOlxuICBjYXNlICdib29sZWFuJzpcbiAgICByZXR1cm4gbW9uZ29PYmplY3Q7XG4gIGNhc2UgJ3VuZGVmaW5lZCc6XG4gIGNhc2UgJ3N5bWJvbCc6XG4gIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICB0aHJvdyAnYmFkIHZhbHVlIGluIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCc7XG4gIGNhc2UgJ29iamVjdCc6XG4gICAgaWYgKG1vbmdvT2JqZWN0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICAgIHJldHVybiBtb25nb09iamVjdC5tYXAobmVzdGVkTW9uZ29PYmplY3RUb05lc3RlZFBhcnNlT2JqZWN0KTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBEYXRlKSB7XG4gICAgICByZXR1cm4gUGFyc2UuX2VuY29kZShtb25nb09iamVjdCk7XG4gICAgfVxuXG4gICAgaWYgKG1vbmdvT2JqZWN0IGluc3RhbmNlb2YgbW9uZ29kYi5Mb25nKSB7XG4gICAgICByZXR1cm4gbW9uZ29PYmplY3QudG9OdW1iZXIoKTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkRvdWJsZSkge1xuICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0LnZhbHVlO1xuICAgIH1cblxuICAgIGlmIChCeXRlc0NvZGVyLmlzVmFsaWREYXRhYmFzZU9iamVjdChtb25nb09iamVjdCkpIHtcbiAgICAgIHJldHVybiBCeXRlc0NvZGVyLmRhdGFiYXNlVG9KU09OKG1vbmdvT2JqZWN0KTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QuaGFzT3duUHJvcGVydHkoJ19fdHlwZScpICYmIG1vbmdvT2JqZWN0Ll9fdHlwZSA9PSAnRGF0ZScgJiYgbW9uZ29PYmplY3QuaXNvIGluc3RhbmNlb2YgRGF0ZSkge1xuICAgICAgbW9uZ29PYmplY3QuaXNvID0gbW9uZ29PYmplY3QuaXNvLnRvSlNPTigpO1xuICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0O1xuICAgIH1cblxuICAgIHJldHVybiBtYXBWYWx1ZXMobW9uZ29PYmplY3QsIG5lc3RlZE1vbmdvT2JqZWN0VG9OZXN0ZWRQYXJzZU9iamVjdCk7XG4gIGRlZmF1bHQ6XG4gICAgdGhyb3cgJ3Vua25vd24ganMgdHlwZSc7XG4gIH1cbn1cblxuY29uc3QgdHJhbnNmb3JtUG9pbnRlclN0cmluZyA9IChzY2hlbWEsIGZpZWxkLCBwb2ludGVyU3RyaW5nKSA9PiB7XG4gIGNvbnN0IG9iakRhdGEgPSBwb2ludGVyU3RyaW5nLnNwbGl0KCckJyk7XG4gIGlmIChvYmpEYXRhWzBdICE9PSBzY2hlbWEuZmllbGRzW2ZpZWxkXS50YXJnZXRDbGFzcykge1xuICAgIHRocm93ICdwb2ludGVyIHRvIGluY29ycmVjdCBjbGFzc05hbWUnO1xuICB9XG4gIHJldHVybiB7XG4gICAgX190eXBlOiAnUG9pbnRlcicsXG4gICAgY2xhc3NOYW1lOiBvYmpEYXRhWzBdLFxuICAgIG9iamVjdElkOiBvYmpEYXRhWzFdXG4gIH07XG59XG5cbi8vIENvbnZlcnRzIGZyb20gYSBtb25nby1mb3JtYXQgb2JqZWN0IHRvIGEgUkVTVC1mb3JtYXQgb2JqZWN0LlxuLy8gRG9lcyBub3Qgc3RyaXAgb3V0IGFueXRoaW5nIGJhc2VkIG9uIGEgbGFjayBvZiBhdXRoZW50aWNhdGlvbi5cbmNvbnN0IG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCA9IChjbGFzc05hbWUsIG1vbmdvT2JqZWN0LCBzY2hlbWEpID0+IHtcbiAgc3dpdGNoKHR5cGVvZiBtb25nb09iamVjdCkge1xuICBjYXNlICdzdHJpbmcnOlxuICBjYXNlICdudW1iZXInOlxuICBjYXNlICdib29sZWFuJzpcbiAgICByZXR1cm4gbW9uZ29PYmplY3Q7XG4gIGNhc2UgJ3VuZGVmaW5lZCc6XG4gIGNhc2UgJ3N5bWJvbCc6XG4gIGNhc2UgJ2Z1bmN0aW9uJzpcbiAgICB0aHJvdyAnYmFkIHZhbHVlIGluIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdCc7XG4gIGNhc2UgJ29iamVjdCc6IHtcbiAgICBpZiAobW9uZ29PYmplY3QgPT09IG51bGwpIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0Lm1hcChuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QpO1xuICAgIH1cblxuICAgIGlmIChtb25nb09iamVjdCBpbnN0YW5jZW9mIERhdGUpIHtcbiAgICAgIHJldHVybiBQYXJzZS5fZW5jb2RlKG1vbmdvT2JqZWN0KTtcbiAgICB9XG5cbiAgICBpZiAobW9uZ29PYmplY3QgaW5zdGFuY2VvZiBtb25nb2RiLkxvbmcpIHtcbiAgICAgIHJldHVybiBtb25nb09iamVjdC50b051bWJlcigpO1xuICAgIH1cblxuICAgIGlmIChtb25nb09iamVjdCBpbnN0YW5jZW9mIG1vbmdvZGIuRG91YmxlKSB7XG4gICAgICByZXR1cm4gbW9uZ29PYmplY3QudmFsdWU7XG4gICAgfVxuXG4gICAgaWYgKEJ5dGVzQ29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KG1vbmdvT2JqZWN0KSkge1xuICAgICAgcmV0dXJuIEJ5dGVzQ29kZXIuZGF0YWJhc2VUb0pTT04obW9uZ29PYmplY3QpO1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3RPYmplY3QgPSB7fTtcbiAgICBpZiAobW9uZ29PYmplY3QuX3JwZXJtIHx8IG1vbmdvT2JqZWN0Ll93cGVybSkge1xuICAgICAgcmVzdE9iamVjdC5fcnBlcm0gPSBtb25nb09iamVjdC5fcnBlcm0gfHwgW107XG4gICAgICByZXN0T2JqZWN0Ll93cGVybSA9IG1vbmdvT2JqZWN0Ll93cGVybSB8fCBbXTtcbiAgICAgIGRlbGV0ZSBtb25nb09iamVjdC5fcnBlcm07XG4gICAgICBkZWxldGUgbW9uZ29PYmplY3QuX3dwZXJtO1xuICAgIH1cblxuICAgIGZvciAodmFyIGtleSBpbiBtb25nb09iamVjdCkge1xuICAgICAgc3dpdGNoKGtleSkge1xuICAgICAgY2FzZSAnX2lkJzpcbiAgICAgICAgcmVzdE9iamVjdFsnb2JqZWN0SWQnXSA9ICcnICsgbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfaGFzaGVkX3Bhc3N3b3JkJzpcbiAgICAgICAgcmVzdE9iamVjdC5faGFzaGVkX3Bhc3N3b3JkID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfYWNsJzpcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuJzpcbiAgICAgIGNhc2UgJ19wZXJpc2hhYmxlX3Rva2VuJzpcbiAgICAgIGNhc2UgJ19wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgY2FzZSAnX3Bhc3N3b3JkX2NoYW5nZWRfYXQnOlxuICAgICAgY2FzZSAnX3RvbWJzdG9uZSc6XG4gICAgICBjYXNlICdfZW1haWxfdmVyaWZ5X3Rva2VuX2V4cGlyZXNfYXQnOlxuICAgICAgY2FzZSAnX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0JzpcbiAgICAgIGNhc2UgJ19mYWlsZWRfbG9naW5fY291bnQnOlxuICAgICAgY2FzZSAnX3Bhc3N3b3JkX2hpc3RvcnknOlxuICAgICAgICAvLyBUaG9zZSBrZXlzIHdpbGwgYmUgZGVsZXRlZCBpZiBuZWVkZWQgaW4gdGhlIERCIENvbnRyb2xsZXJcbiAgICAgICAgcmVzdE9iamVjdFtrZXldID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdfc2Vzc2lvbl90b2tlbic6XG4gICAgICAgIHJlc3RPYmplY3RbJ3Nlc3Npb25Ub2tlbiddID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICd1cGRhdGVkQXQnOlxuICAgICAgY2FzZSAnX3VwZGF0ZWRfYXQnOlxuICAgICAgICByZXN0T2JqZWN0Wyd1cGRhdGVkQXQnXSA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUobW9uZ29PYmplY3Rba2V5XSkpLmlzbztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdjcmVhdGVkQXQnOlxuICAgICAgY2FzZSAnX2NyZWF0ZWRfYXQnOlxuICAgICAgICByZXN0T2JqZWN0WydjcmVhdGVkQXQnXSA9IFBhcnNlLl9lbmNvZGUobmV3IERhdGUobW9uZ29PYmplY3Rba2V5XSkpLmlzbztcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdleHBpcmVzQXQnOlxuICAgICAgY2FzZSAnX2V4cGlyZXNBdCc6XG4gICAgICAgIHJlc3RPYmplY3RbJ2V4cGlyZXNBdCddID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZShtb25nb09iamVjdFtrZXldKSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnbGFzdFVzZWQnOlxuICAgICAgY2FzZSAnX2xhc3RfdXNlZCc6XG4gICAgICAgIHJlc3RPYmplY3RbJ2xhc3RVc2VkJ10gPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKG1vbmdvT2JqZWN0W2tleV0pKS5pc287XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAndGltZXNVc2VkJzpcbiAgICAgIGNhc2UgJ3RpbWVzX3VzZWQnOlxuICAgICAgICByZXN0T2JqZWN0Wyd0aW1lc1VzZWQnXSA9IG1vbmdvT2JqZWN0W2tleV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgLy8gQ2hlY2sgb3RoZXIgYXV0aCBkYXRhIGtleXNcbiAgICAgICAgdmFyIGF1dGhEYXRhTWF0Y2ggPSBrZXkubWF0Y2goL15fYXV0aF9kYXRhXyhbYS16QS1aMC05X10rKSQvKTtcbiAgICAgICAgaWYgKGF1dGhEYXRhTWF0Y2gpIHtcbiAgICAgICAgICB2YXIgcHJvdmlkZXIgPSBhdXRoRGF0YU1hdGNoWzFdO1xuICAgICAgICAgIHJlc3RPYmplY3RbJ2F1dGhEYXRhJ10gPSByZXN0T2JqZWN0WydhdXRoRGF0YSddIHx8IHt9O1xuICAgICAgICAgIHJlc3RPYmplY3RbJ2F1dGhEYXRhJ11bcHJvdmlkZXJdID0gbW9uZ29PYmplY3Rba2V5XTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChrZXkuaW5kZXhPZignX3BfJykgPT0gMCkge1xuICAgICAgICAgIHZhciBuZXdLZXkgPSBrZXkuc3Vic3RyaW5nKDMpO1xuICAgICAgICAgIGlmICghc2NoZW1hLmZpZWxkc1tuZXdLZXldKSB7XG4gICAgICAgICAgICBsb2cuaW5mbygndHJhbnNmb3JtLmpzJywgJ0ZvdW5kIGEgcG9pbnRlciBjb2x1bW4gbm90IGluIHRoZSBzY2hlbWEsIGRyb3BwaW5nIGl0LicsIGNsYXNzTmFtZSwgbmV3S2V5KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tuZXdLZXldLnR5cGUgIT09ICdQb2ludGVyJykge1xuICAgICAgICAgICAgbG9nLmluZm8oJ3RyYW5zZm9ybS5qcycsICdGb3VuZCBhIHBvaW50ZXIgaW4gYSBub24tcG9pbnRlciBjb2x1bW4sIGRyb3BwaW5nIGl0LicsIGNsYXNzTmFtZSwga2V5KTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAobW9uZ29PYmplY3Rba2V5XSA9PT0gbnVsbCkge1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJlc3RPYmplY3RbbmV3S2V5XSA9IHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcoc2NoZW1hLCBuZXdLZXksIG1vbmdvT2JqZWN0W2tleV0pO1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9IGVsc2UgaWYgKGtleVswXSA9PSAnXycgJiYga2V5ICE9ICdfX3R5cGUnKSB7XG4gICAgICAgICAgdGhyb3cgKCdiYWQga2V5IGluIHVudHJhbnNmb3JtOiAnICsga2V5KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YXIgdmFsdWUgPSBtb25nb09iamVjdFtrZXldO1xuICAgICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2tleV0gJiYgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdGaWxlJyAmJiBGaWxlQ29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gRmlsZUNvZGVyLmRhdGFiYXNlVG9KU09OKHZhbHVlKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1trZXldICYmIHNjaGVtYS5maWVsZHNba2V5XS50eXBlID09PSAnR2VvUG9pbnQnICYmIEdlb1BvaW50Q29kZXIuaXNWYWxpZERhdGFiYXNlT2JqZWN0KHZhbHVlKSkge1xuICAgICAgICAgICAgcmVzdE9iamVjdFtrZXldID0gR2VvUG9pbnRDb2Rlci5kYXRhYmFzZVRvSlNPTih2YWx1ZSk7XG4gICAgICAgICAgICBicmVhaztcbiAgICAgICAgICB9XG4gICAgICAgICAgaWYgKHNjaGVtYS5maWVsZHNba2V5XSAmJiBzY2hlbWEuZmllbGRzW2tleV0udHlwZSA9PT0gJ1BvbHlnb24nICYmIFBvbHlnb25Db2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBQb2x5Z29uQ29kZXIuZGF0YWJhc2VUb0pTT04odmFsdWUpO1xuICAgICAgICAgICAgYnJlYWs7XG4gICAgICAgICAgfVxuICAgICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2tleV0gJiYgc2NoZW1hLmZpZWxkc1trZXldLnR5cGUgPT09ICdCeXRlcycgJiYgQnl0ZXNDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBCeXRlc0NvZGVyLmRhdGFiYXNlVG9KU09OKHZhbHVlKTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXN0T2JqZWN0W2tleV0gPSBuZXN0ZWRNb25nb09iamVjdFRvTmVzdGVkUGFyc2VPYmplY3QobW9uZ29PYmplY3Rba2V5XSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgcmVsYXRpb25GaWVsZE5hbWVzID0gT2JqZWN0LmtleXMoc2NoZW1hLmZpZWxkcykuZmlsdGVyKGZpZWxkTmFtZSA9PiBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0udHlwZSA9PT0gJ1JlbGF0aW9uJyk7XG4gICAgY29uc3QgcmVsYXRpb25GaWVsZHMgPSB7fTtcbiAgICByZWxhdGlvbkZpZWxkTmFtZXMuZm9yRWFjaChyZWxhdGlvbkZpZWxkTmFtZSA9PiB7XG4gICAgICByZWxhdGlvbkZpZWxkc1tyZWxhdGlvbkZpZWxkTmFtZV0gPSB7XG4gICAgICAgIF9fdHlwZTogJ1JlbGF0aW9uJyxcbiAgICAgICAgY2xhc3NOYW1lOiBzY2hlbWEuZmllbGRzW3JlbGF0aW9uRmllbGROYW1lXS50YXJnZXRDbGFzcyxcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHJldHVybiB7IC4uLnJlc3RPYmplY3QsIC4uLnJlbGF0aW9uRmllbGRzIH07XG4gIH1cbiAgZGVmYXVsdDpcbiAgICB0aHJvdyAndW5rbm93biBqcyB0eXBlJztcbiAgfVxufVxuXG52YXIgRGF0ZUNvZGVyID0ge1xuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKGpzb24uaXNvKTtcbiAgfSxcblxuICBpc1ZhbGlkSlNPTih2YWx1ZSkge1xuICAgIHJldHVybiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICAgIHZhbHVlLl9fdHlwZSA9PT0gJ0RhdGUnXG4gICAgKTtcbiAgfVxufTtcblxudmFyIEJ5dGVzQ29kZXIgPSB7XG4gIGJhc2U2NFBhdHRlcm46IG5ldyBSZWdFeHAoXCJeKD86W0EtWmEtejAtOSsvXXs0fSkqKD86W0EtWmEtejAtOSsvXXsyfT09fFtBLVphLXowLTkrL117M309KT8kXCIpLFxuICBpc0Jhc2U2NFZhbHVlKG9iamVjdCkge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0ICE9PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy5iYXNlNjRQYXR0ZXJuLnRlc3Qob2JqZWN0KTtcbiAgfSxcblxuICBkYXRhYmFzZVRvSlNPTihvYmplY3QpIHtcbiAgICBsZXQgdmFsdWU7XG4gICAgaWYgKHRoaXMuaXNCYXNlNjRWYWx1ZShvYmplY3QpKSB7XG4gICAgICB2YWx1ZSA9IG9iamVjdDtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgPSBvYmplY3QuYnVmZmVyLnRvU3RyaW5nKCdiYXNlNjQnKTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIF9fdHlwZTogJ0J5dGVzJyxcbiAgICAgIGJhc2U2NDogdmFsdWVcbiAgICB9O1xuICB9LFxuXG4gIGlzVmFsaWREYXRhYmFzZU9iamVjdChvYmplY3QpIHtcbiAgICByZXR1cm4gKG9iamVjdCBpbnN0YW5jZW9mIG1vbmdvZGIuQmluYXJ5KSB8fCB0aGlzLmlzQmFzZTY0VmFsdWUob2JqZWN0KTtcbiAgfSxcblxuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgcmV0dXJuIG5ldyBtb25nb2RiLkJpbmFyeShuZXcgQnVmZmVyKGpzb24uYmFzZTY0LCAnYmFzZTY0JykpO1xuICB9LFxuXG4gIGlzVmFsaWRKU09OKHZhbHVlKSB7XG4gICAgcmV0dXJuICh0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgICAgdmFsdWUuX190eXBlID09PSAnQnl0ZXMnXG4gICAgKTtcbiAgfVxufTtcblxudmFyIEdlb1BvaW50Q29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdHZW9Qb2ludCcsXG4gICAgICBsYXRpdHVkZTogb2JqZWN0WzFdLFxuICAgICAgbG9uZ2l0dWRlOiBvYmplY3RbMF1cbiAgICB9XG4gIH0sXG5cbiAgaXNWYWxpZERhdGFiYXNlT2JqZWN0KG9iamVjdCkge1xuICAgIHJldHVybiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXkgJiZcbiAgICAgIG9iamVjdC5sZW5ndGggPT0gMlxuICAgICk7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBbIGpzb24ubG9uZ2l0dWRlLCBqc29uLmxhdGl0dWRlIF07XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdHZW9Qb2ludCdcbiAgICApO1xuICB9XG59O1xuXG52YXIgUG9seWdvbkNvZGVyID0ge1xuICBkYXRhYmFzZVRvSlNPTihvYmplY3QpIHtcbiAgICAvLyBDb252ZXJ0IGxuZy9sYXQgLT4gbGF0L2xuZ1xuICAgIGNvbnN0IGNvb3JkcyA9IG9iamVjdC5jb29yZGluYXRlc1swXS5tYXAoKGNvb3JkKSA9PiB7XG4gICAgICByZXR1cm4gW2Nvb3JkWzFdLCBjb29yZFswXV07XG4gICAgfSk7XG4gICAgcmV0dXJuIHtcbiAgICAgIF9fdHlwZTogJ1BvbHlnb24nLFxuICAgICAgY29vcmRpbmF0ZXM6IGNvb3Jkc1xuICAgIH1cbiAgfSxcblxuICBpc1ZhbGlkRGF0YWJhc2VPYmplY3Qob2JqZWN0KSB7XG4gICAgY29uc3QgY29vcmRzID0gb2JqZWN0LmNvb3JkaW5hdGVzWzBdO1xuICAgIGlmIChvYmplY3QudHlwZSAhPT0gJ1BvbHlnb24nIHx8ICEoY29vcmRzIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY29vcmRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBjb25zdCBwb2ludCA9IGNvb3Jkc1tpXTtcbiAgICAgIGlmICghR2VvUG9pbnRDb2Rlci5pc1ZhbGlkRGF0YWJhc2VPYmplY3QocG9pbnQpKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICAgIFBhcnNlLkdlb1BvaW50Ll92YWxpZGF0ZShwYXJzZUZsb2F0KHBvaW50WzFdKSwgcGFyc2VGbG9hdChwb2ludFswXSkpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBKU09OVG9EYXRhYmFzZShqc29uKSB7XG4gICAgbGV0IGNvb3JkcyA9IGpzb24uY29vcmRpbmF0ZXM7XG4gICAgLy8gQWRkIGZpcnN0IHBvaW50IHRvIHRoZSBlbmQgdG8gY2xvc2UgcG9seWdvblxuICAgIGlmIChjb29yZHNbMF1bMF0gIT09IGNvb3Jkc1tjb29yZHMubGVuZ3RoIC0gMV1bMF0gfHxcbiAgICAgICAgY29vcmRzWzBdWzFdICE9PSBjb29yZHNbY29vcmRzLmxlbmd0aCAtIDFdWzFdKSB7XG4gICAgICBjb29yZHMucHVzaChjb29yZHNbMF0pO1xuICAgIH1cbiAgICBjb25zdCB1bmlxdWUgPSBjb29yZHMuZmlsdGVyKChpdGVtLCBpbmRleCwgYXIpID0+IHtcbiAgICAgIGxldCBmb3VuZEluZGV4ID0gLTE7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGFyLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgICAgIGNvbnN0IHB0ID0gYXJbaV07XG4gICAgICAgIGlmIChwdFswXSA9PT0gaXRlbVswXSAmJlxuICAgICAgICAgICAgcHRbMV0gPT09IGl0ZW1bMV0pIHtcbiAgICAgICAgICBmb3VuZEluZGV4ID0gaTtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIGZvdW5kSW5kZXggPT09IGluZGV4O1xuICAgIH0pO1xuICAgIGlmICh1bmlxdWUubGVuZ3RoIDwgMykge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFxuICAgICAgICBQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsXG4gICAgICAgICdHZW9KU09OOiBMb29wIG11c3QgaGF2ZSBhdCBsZWFzdCAzIGRpZmZlcmVudCB2ZXJ0aWNlcydcbiAgICAgICk7XG4gICAgfVxuICAgIC8vIENvbnZlcnQgbGF0L2xvbmcgLT4gbG9uZy9sYXRcbiAgICBjb29yZHMgPSBjb29yZHMubWFwKChjb29yZCkgPT4ge1xuICAgICAgcmV0dXJuIFtjb29yZFsxXSwgY29vcmRbMF1dO1xuICAgIH0pO1xuICAgIHJldHVybiB7IHR5cGU6ICdQb2x5Z29uJywgY29vcmRpbmF0ZXM6IFtjb29yZHNdIH07XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdQb2x5Z29uJ1xuICAgICk7XG4gIH1cbn07XG5cbnZhciBGaWxlQ29kZXIgPSB7XG4gIGRhdGFiYXNlVG9KU09OKG9iamVjdCkge1xuICAgIHJldHVybiB7XG4gICAgICBfX3R5cGU6ICdGaWxlJyxcbiAgICAgIG5hbWU6IG9iamVjdFxuICAgIH1cbiAgfSxcblxuICBpc1ZhbGlkRGF0YWJhc2VPYmplY3Qob2JqZWN0KSB7XG4gICAgcmV0dXJuICh0eXBlb2Ygb2JqZWN0ID09PSAnc3RyaW5nJyk7XG4gIH0sXG5cbiAgSlNPTlRvRGF0YWJhc2UoanNvbikge1xuICAgIHJldHVybiBqc29uLm5hbWU7XG4gIH0sXG5cbiAgaXNWYWxpZEpTT04odmFsdWUpIHtcbiAgICByZXR1cm4gKHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgICB2YWx1ZS5fX3R5cGUgPT09ICdGaWxlJ1xuICAgICk7XG4gIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICB0cmFuc2Zvcm1LZXksXG4gIHBhcnNlT2JqZWN0VG9Nb25nb09iamVjdEZvckNyZWF0ZSxcbiAgdHJhbnNmb3JtVXBkYXRlLFxuICB0cmFuc2Zvcm1XaGVyZSxcbiAgbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0LFxuICByZWxhdGl2ZVRpbWVUb0RhdGUsXG4gIHRyYW5zZm9ybUNvbnN0cmFpbnQsXG4gIHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcsXG59O1xuIl19