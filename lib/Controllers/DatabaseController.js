'use strict';

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _node = require('parse/node');

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _intersect = require('intersect');

var _intersect2 = _interopRequireDefault(_intersect);

var _deepcopy = require('deepcopy');

var _deepcopy2 = _interopRequireDefault(_deepcopy);

var _logger = require('../logger');

var _logger2 = _interopRequireDefault(_logger);

var _SchemaController = require('./SchemaController');

var SchemaController = _interopRequireWildcard(_SchemaController);

var _StorageAdapter = require('../Adapters/Storage/StorageAdapter');

function _interopRequireWildcard(obj) { if (obj && obj.__esModule) { return obj; } else { var newObj = {}; if (obj != null) { for (var key in obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) newObj[key] = obj[key]; } } newObj.default = obj; return newObj; } }

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }
// A database adapter that works with data exported from the hosted
// Parse database.

// -disable-next

// -disable-next

// -disable-next

// -disable-next


function addWriteACL(query, acl) {
  const newQuery = _lodash2.default.cloneDeep(query);
  //Can't be any existing '_wperm' query, we don't allow client queries on that, no need to $and
  newQuery._wperm = { "$in": [null, ...acl] };
  return newQuery;
}

function addReadACL(query, acl) {
  const newQuery = _lodash2.default.cloneDeep(query);
  //Can't be any existing '_rperm' query, we don't allow client queries on that, no need to $and
  newQuery._rperm = { "$in": [null, "*", ...acl] };
  return newQuery;
}

// Transforms a REST API formatted ACL object to our two-field mongo format.
const transformObjectACL = (_ref) => {
  let { ACL } = _ref,
      result = _objectWithoutProperties(_ref, ['ACL']);

  if (!ACL) {
    return result;
  }

  result._wperm = [];
  result._rperm = [];

  for (const entry in ACL) {
    if (ACL[entry].read) {
      result._rperm.push(entry);
    }
    if (ACL[entry].write) {
      result._wperm.push(entry);
    }
  }
  return result;
};

const specialQuerykeys = ['$and', '$or', '$nor', '_rperm', '_wperm', '_perishable_token', '_email_verify_token', '_email_verify_token_expires_at', '_account_lockout_expires_at', '_failed_login_count'];

const isSpecialQueryKey = key => {
  return specialQuerykeys.indexOf(key) >= 0;
};

const validateQuery = query => {
  if (query.ACL) {
    throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Cannot query on ACL.');
  }

  if (query.$or) {
    if (query.$or instanceof Array) {
      query.$or.forEach(validateQuery);

      /* In MongoDB, $or queries which are not alone at the top level of the
       * query can not make efficient use of indexes due to a long standing
       * bug known as SERVER-13732.
       *
       * This block restructures queries in which $or is not the sole top
       * level element by moving all other top-level predicates inside every
       * subdocument of the $or predicate, allowing MongoDB's query planner
       * to make full use of the most relevant indexes.
       *
       * EG:      {$or: [{a: 1}, {a: 2}], b: 2}
       * Becomes: {$or: [{a: 1, b: 2}, {a: 2, b: 2}]}
       *
       * The only exceptions are $near and $nearSphere operators, which are
       * constrained to only 1 operator per query. As a result, these ops
       * remain at the top level
       *
       * https://jira.mongodb.org/browse/SERVER-13732
       * https://github.com/parse-community/parse-server/issues/3767
       */
      Object.keys(query).forEach(key => {
        const noCollisions = !query.$or.some(subq => subq.hasOwnProperty(key));
        let hasNears = false;
        if (query[key] != null && typeof query[key] == 'object') {
          hasNears = '$near' in query[key] || '$nearSphere' in query[key];
        }
        if (key != '$or' && noCollisions && !hasNears) {
          query.$or.forEach(subquery => {
            subquery[key] = query[key];
          });
          delete query[key];
        }
      });
      query.$or.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $or format - use an array value.');
    }
  }

  if (query.$and) {
    if (query.$and instanceof Array) {
      query.$and.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $and format - use an array value.');
    }
  }

  if (query.$nor) {
    if (query.$nor instanceof Array && query.$nor.length > 0) {
      query.$nor.forEach(validateQuery);
    } else {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, 'Bad $nor format - use an array of at least 1 value.');
    }
  }

  Object.keys(query).forEach(key => {
    if (query && query[key] && query[key].$regex) {
      if (typeof query[key].$options === 'string') {
        if (!query[key].$options.match(/^[imxs]+$/)) {
          throw new _node.Parse.Error(_node.Parse.Error.INVALID_QUERY, `Bad $options value for query: ${query[key].$options}`);
        }
      }
    }
    if (!isSpecialQueryKey(key) && !key.match(/^[a-zA-Z][a-zA-Z0-9_\.]*$/)) {
      throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid key name: ${key}`);
    }
  });
};

// Filters out any data that shouldn't be on this REST-formatted object.
const filterSensitiveData = (isMaster, aclGroup, className, object) => {
  if (className !== '_User') {
    return object;
  }

  object.password = object._hashed_password;
  delete object._hashed_password;

  delete object.sessionToken;

  if (isMaster) {
    return object;
  }
  delete object._email_verify_token;
  delete object._perishable_token;
  delete object._perishable_token_expires_at;
  delete object._tombstone;
  delete object._email_verify_token_expires_at;
  delete object._failed_login_count;
  delete object._account_lockout_expires_at;
  delete object._password_changed_at;
  delete object._password_history;

  if (aclGroup.indexOf(object.objectId) > -1) {
    return object;
  }
  delete object.authData;
  return object;
};

// Runs an update on the database.
// Returns a promise for an object with the new values for field
// modifications that don't know their results ahead of time, like
// 'increment'.
// Options:
//   acl:  a list of strings. If the object to be updated has an ACL,
//         one of the provided strings must provide the caller with
//         write permissions.
const specialKeysForUpdate = ['_hashed_password', '_perishable_token', '_email_verify_token', '_email_verify_token_expires_at', '_account_lockout_expires_at', '_failed_login_count', '_perishable_token_expires_at', '_password_changed_at', '_password_history'];

const isSpecialUpdateKey = key => {
  return specialKeysForUpdate.indexOf(key) >= 0;
};

function expandResultOnKeyPath(object, key, value) {
  if (key.indexOf('.') < 0) {
    object[key] = value[key];
    return object;
  }
  const path = key.split('.');
  const firstKey = path[0];
  const nextPath = path.slice(1).join('.');
  object[firstKey] = expandResultOnKeyPath(object[firstKey] || {}, nextPath, value[firstKey]);
  delete object[key];
  return object;
}

function sanitizeDatabaseResult(originalObject, result) {
  const response = {};
  if (!result) {
    return Promise.resolve(response);
  }
  Object.keys(originalObject).forEach(key => {
    const keyUpdate = originalObject[key];
    // determine if that was an op
    if (keyUpdate && typeof keyUpdate === 'object' && keyUpdate.__op && ['Add', 'AddUnique', 'Remove', 'Increment'].indexOf(keyUpdate.__op) > -1) {
      // only valid ops that produce an actionable result
      // the op may have happend on a keypath
      expandResultOnKeyPath(response, key, result);
    }
  });
  return Promise.resolve(response);
}

function joinTableName(className, key) {
  return `_Join:${key}:${className}`;
}

const flattenUpdateOperatorsForCreate = object => {
  for (const key in object) {
    if (object[key] && object[key].__op) {
      switch (object[key].__op) {
        case 'Increment':
          if (typeof object[key].amount !== 'number') {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].amount;
          break;
        case 'Add':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].objects;
          break;
        case 'AddUnique':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = object[key].objects;
          break;
        case 'Remove':
          if (!(object[key].objects instanceof Array)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_JSON, 'objects to add must be an array');
          }
          object[key] = [];
          break;
        case 'Delete':
          delete object[key];
          break;
        default:
          throw new _node.Parse.Error(_node.Parse.Error.COMMAND_UNAVAILABLE, `The ${object[key].__op} operator is not supported yet.`);
      }
    }
  }
};

const transformAuthData = (className, object, schema) => {
  if (object.authData && className === '_User') {
    Object.keys(object.authData).forEach(provider => {
      const providerData = object.authData[provider];
      const fieldName = `_auth_data_${provider}`;
      if (providerData == null) {
        object[fieldName] = {
          __op: 'Delete'
        };
      } else {
        object[fieldName] = providerData;
        schema.fields[fieldName] = { type: 'Object' };
      }
    });
    delete object.authData;
  }
};
// Transforms a Database format ACL to a REST API format ACL
const untransformObjectACL = (_ref2) => {
  let { _rperm, _wperm } = _ref2,
      output = _objectWithoutProperties(_ref2, ['_rperm', '_wperm']);

  if (_rperm || _wperm) {
    output.ACL = {};

    (_rperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = { read: true };
      } else {
        output.ACL[entry]['read'] = true;
      }
    });

    (_wperm || []).forEach(entry => {
      if (!output.ACL[entry]) {
        output.ACL[entry] = { write: true };
      } else {
        output.ACL[entry]['write'] = true;
      }
    });
  }
  return output;
};

/**
 * When querying, the fieldName may be compound, extract the root fieldName
 *     `temperature.celsius` becomes `temperature`
 * @param {string} fieldName that may be a compound field name
 * @returns {string} the root name of the field
 */
const getRootFieldName = fieldName => {
  return fieldName.split('.')[0];
};

const relationSchema = { fields: { relatedId: { type: 'String' }, owningId: { type: 'String' } } };

class DatabaseController {

  constructor(adapter, schemaCache) {
    this.adapter = adapter;
    this.schemaCache = schemaCache;
    // We don't want a mutable this.schema, because then you could have
    // one request that uses different schemas for different parts of
    // it. Instead, use loadSchema to get a schema.
    this.schemaPromise = null;
  }

  collectionExists(className) {
    return this.adapter.classExists(className);
  }

  purgeCollection(className) {
    return this.loadSchema().then(schemaController => schemaController.getOneSchema(className)).then(schema => this.adapter.deleteObjectsByQuery(className, schema, {}));
  }

  validateClassName(className) {
    if (!SchemaController.classNameIsValid(className)) {
      return Promise.reject(new _node.Parse.Error(_node.Parse.Error.INVALID_CLASS_NAME, 'invalid className: ' + className));
    }
    return Promise.resolve();
  }

  // Returns a promise for a schemaController.
  loadSchema(options = { clearCache: false }) {
    if (this.schemaPromise != null) {
      return this.schemaPromise;
    }
    this.schemaPromise = SchemaController.load(this.adapter, this.schemaCache, options);
    this.schemaPromise.then(() => delete this.schemaPromise, () => delete this.schemaPromise);
    return this.loadSchema(options);
  }

  // Returns a promise for the classname that is related to the given
  // classname through the key.
  // TODO: make this not in the DatabaseController interface
  redirectClassNameForKey(className, key) {
    return this.loadSchema().then(schema => {
      var t = schema.getExpectedType(className, key);
      if (t != null && typeof t !== 'string' && t.type === 'Relation') {
        return t.targetClass;
      }
      return className;
    });
  }

  // Uses the schema to validate the object (REST API format).
  // Returns a promise that resolves to the new schema.
  // This does not update this.schema, because in a situation like a
  // batch request, that could confuse other users of the schema.
  validateObject(className, object, query, { acl }) {
    let schema;
    const isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchema().then(s => {
      schema = s;
      if (isMaster) {
        return Promise.resolve();
      }
      return this.canAddField(schema, className, object, aclGroup);
    }).then(() => {
      return schema.validateObject(className, object, query);
    });
  }

  update(className, query, update, {
    acl,
    many,
    upsert
  } = {}, skipSanitization = false) {
    const originalQuery = query;
    const originalUpdate = update;
    // Make a copy of the object, so we don't mutate the incoming data.
    update = (0, _deepcopy2.default)(update);
    var relationUpdates = [];
    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    return this.loadSchema().then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'update')).then(() => {
        relationUpdates = this.collectRelationUpdates(className, originalQuery.objectId, update);
        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'update', query, aclGroup);
        }
        if (!query) {
          return Promise.resolve();
        }
        if (acl) {
          query = addWriteACL(query, acl);
        }
        validateQuery(query);
        return schemaController.getOneSchema(className, true).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return { fields: {} };
          }
          throw error;
        }).then(schema => {
          Object.keys(update).forEach(fieldName => {
            if (fieldName.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }
            const rootFieldName = getRootFieldName(fieldName);
            if (!SchemaController.fieldNameIsValid(rootFieldName) && !isSpecialUpdateKey(rootFieldName)) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name for update: ${fieldName}`);
            }
          });
          for (const updateOperation in update) {
            if (update[updateOperation] && typeof update[updateOperation] === 'object' && Object.keys(update[updateOperation]).some(innerKey => innerKey.includes('$') || innerKey.includes('.'))) {
              throw new _node.Parse.Error(_node.Parse.Error.INVALID_NESTED_KEY, "Nested keys should not contain the '$' or '.' characters");
            }
          }
          update = transformObjectACL(update);
          transformAuthData(className, update, schema);
          if (many) {
            return this.adapter.updateObjectsByQuery(className, schema, query, update);
          } else if (upsert) {
            return this.adapter.upsertOneObject(className, schema, query, update);
          } else {
            return this.adapter.findOneAndUpdate(className, schema, query, update);
          }
        });
      }).then(result => {
        if (!result) {
          throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
        }
        return this.handleRelationUpdates(className, originalQuery.objectId, update, relationUpdates).then(() => {
          return result;
        });
      }).then(result => {
        if (skipSanitization) {
          return Promise.resolve(result);
        }
        return sanitizeDatabaseResult(originalUpdate, result);
      });
    });
  }

  // Collect all relation-updating operations from a REST-format update.
  // Returns a list of all relation updates to perform
  // This mutates update.
  collectRelationUpdates(className, objectId, update) {
    var ops = [];
    var deleteMe = [];
    objectId = update.objectId || objectId;

    var process = (op, key) => {
      if (!op) {
        return;
      }
      if (op.__op == 'AddRelation') {
        ops.push({ key, op });
        deleteMe.push(key);
      }

      if (op.__op == 'RemoveRelation') {
        ops.push({ key, op });
        deleteMe.push(key);
      }

      if (op.__op == 'Batch') {
        for (var x of op.ops) {
          process(x, key);
        }
      }
    };

    for (const key in update) {
      process(update[key], key);
    }
    for (const key of deleteMe) {
      delete update[key];
    }
    return ops;
  }

  // Processes relation-updating operations from a REST-format update.
  // Returns a promise that resolves when all updates have been performed
  handleRelationUpdates(className, objectId, update, ops) {
    var pending = [];
    objectId = update.objectId || objectId;
    ops.forEach(({ key, op }) => {
      if (!op) {
        return;
      }
      if (op.__op == 'AddRelation') {
        for (const object of op.objects) {
          pending.push(this.addRelation(key, className, objectId, object.objectId));
        }
      }

      if (op.__op == 'RemoveRelation') {
        for (const object of op.objects) {
          pending.push(this.removeRelation(key, className, objectId, object.objectId));
        }
      }
    });

    return Promise.all(pending);
  }

  // Adds a relation.
  // Returns a promise that resolves successfully iff the add was successful.
  addRelation(key, fromClassName, fromId, toId) {
    const doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.upsertOneObject(`_Join:${key}:${fromClassName}`, relationSchema, doc, doc);
  }

  // Removes a relation.
  // Returns a promise that resolves successfully iff the remove was
  // successful.
  removeRelation(key, fromClassName, fromId, toId) {
    var doc = {
      relatedId: toId,
      owningId: fromId
    };
    return this.adapter.deleteObjectsByQuery(`_Join:${key}:${fromClassName}`, relationSchema, doc).catch(error => {
      // We don't care if they try to delete a non-existent relation.
      if (error.code == _node.Parse.Error.OBJECT_NOT_FOUND) {
        return;
      }
      throw error;
    });
  }

  // Removes objects matches this query from the database.
  // Returns a promise that resolves successfully iff the object was
  // deleted.
  // Options:
  //   acl:  a list of strings. If the object to be updated has an ACL,
  //         one of the provided strings must provide the caller with
  //         write permissions.
  destroy(className, query, { acl } = {}) {
    const isMaster = acl === undefined;
    const aclGroup = acl || [];

    return this.loadSchema().then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'delete')).then(() => {
        if (!isMaster) {
          query = this.addPointerPermissions(schemaController, className, 'delete', query, aclGroup);
          if (!query) {
            throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
          }
        }
        // delete by query
        if (acl) {
          query = addWriteACL(query, acl);
        }
        validateQuery(query);
        return schemaController.getOneSchema(className).catch(error => {
          // If the schema doesn't exist, pretend it exists with no fields. This behavior
          // will likely need revisiting.
          if (error === undefined) {
            return { fields: {} };
          }
          throw error;
        }).then(parseFormatSchema => this.adapter.deleteObjectsByQuery(className, parseFormatSchema, query)).catch(error => {
          // When deleting sessions while changing passwords, don't throw an error if they don't have any sessions.
          if (className === "_Session" && error.code === _node.Parse.Error.OBJECT_NOT_FOUND) {
            return Promise.resolve({});
          }
          throw error;
        });
      });
    });
  }

  // Inserts an object into the database.
  // Returns a promise that resolves successfully iff the object saved.
  create(className, object, { acl } = {}) {
    // Make a copy of the object, so we don't mutate the incoming data.
    const originalObject = object;
    object = transformObjectACL(object);

    object.createdAt = { iso: object.createdAt, __type: 'Date' };
    object.updatedAt = { iso: object.updatedAt, __type: 'Date' };

    var isMaster = acl === undefined;
    var aclGroup = acl || [];
    const relationUpdates = this.collectRelationUpdates(className, null, object);
    return this.validateClassName(className).then(() => this.loadSchema()).then(schemaController => {
      return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, 'create')).then(() => schemaController.enforceClassExists(className)).then(() => schemaController.reloadData()).then(() => schemaController.getOneSchema(className, true)).then(schema => {
        transformAuthData(className, object, schema);
        flattenUpdateOperatorsForCreate(object);
        return this.adapter.createObject(className, SchemaController.convertSchemaToAdapterSchema(schema), object);
      }).then(result => {
        return this.handleRelationUpdates(className, object.objectId, object, relationUpdates).then(() => {
          return sanitizeDatabaseResult(originalObject, result.ops[0]);
        });
      });
    });
  }

  canAddField(schema, className, object, aclGroup) {
    const classSchema = schema.data[className];
    if (!classSchema) {
      return Promise.resolve();
    }
    const fields = Object.keys(object);
    const schemaFields = Object.keys(classSchema);
    const newKeys = fields.filter(field => {
      // Skip fields that are unset
      if (object[field] && object[field].__op && object[field].__op === 'Delete') {
        return false;
      }
      return schemaFields.indexOf(field) < 0;
    });
    if (newKeys.length > 0) {
      return schema.validatePermission(className, aclGroup, 'addField');
    }
    return Promise.resolve();
  }

  // Won't delete collections in the system namespace
  /**
   * Delete all classes and clears the schema cache
   *
   * @param {boolean} fast set to true if it's ok to just delete rows and not indexes
   * @returns {Promise<void>} when the deletions completes
   */
  deleteEverything(fast = false) {
    this.schemaPromise = null;
    return Promise.all([this.adapter.deleteAllClasses(fast), this.schemaCache.clear()]);
  }

  // Returns a promise for a list of related ids given an owning id.
  // className here is the owning className.
  relatedIds(className, key, owningId, queryOptions) {
    const { skip, limit, sort } = queryOptions;
    const findOptions = {};
    if (sort && sort.createdAt && this.adapter.canSortOnJoinTables) {
      findOptions.sort = { '_id': sort.createdAt };
      findOptions.limit = limit;
      findOptions.skip = skip;
      queryOptions.skip = 0;
    }
    return this.adapter.find(joinTableName(className, key), relationSchema, { owningId }, findOptions).then(results => results.map(result => result.relatedId));
  }

  // Returns a promise for a list of owning ids given some related ids.
  // className here is the owning className.
  owningIds(className, key, relatedIds) {
    return this.adapter.find(joinTableName(className, key), relationSchema, { relatedId: { '$in': relatedIds } }, {}).then(results => results.map(result => result.owningId));
  }

  // Modifies query so that it no longer has $in on relation fields, or
  // equal-to-pointer constraints on relation fields.
  // Returns a promise that resolves when query is mutated
  reduceInRelation(className, query, schema) {
    // Search for an in-relation or equal-to-relation
    // Make it sequential for now, not sure of paralleization side effects
    if (query['$or']) {
      const ors = query['$or'];
      return Promise.all(ors.map((aQuery, index) => {
        return this.reduceInRelation(className, aQuery, schema).then(aQuery => {
          query['$or'][index] = aQuery;
        });
      })).then(() => {
        return Promise.resolve(query);
      });
    }

    const promises = Object.keys(query).map(key => {
      const t = schema.getExpectedType(className, key);
      if (!t || t.type !== 'Relation') {
        return Promise.resolve(query);
      }
      let queries = null;
      if (query[key] && (query[key]['$in'] || query[key]['$ne'] || query[key]['$nin'] || query[key].__type == 'Pointer')) {
        // Build the list of queries
        queries = Object.keys(query[key]).map(constraintKey => {
          let relatedIds;
          let isNegation = false;
          if (constraintKey === 'objectId') {
            relatedIds = [query[key].objectId];
          } else if (constraintKey == '$in') {
            relatedIds = query[key]['$in'].map(r => r.objectId);
          } else if (constraintKey == '$nin') {
            isNegation = true;
            relatedIds = query[key]['$nin'].map(r => r.objectId);
          } else if (constraintKey == '$ne') {
            isNegation = true;
            relatedIds = [query[key]['$ne'].objectId];
          } else {
            return;
          }
          return {
            isNegation,
            relatedIds
          };
        });
      } else {
        queries = [{ isNegation: false, relatedIds: [] }];
      }

      // remove the current queryKey as we don,t need it anymore
      delete query[key];
      // execute each query independently to build the list of
      // $in / $nin
      const promises = queries.map(q => {
        if (!q) {
          return Promise.resolve();
        }
        return this.owningIds(className, key, q.relatedIds).then(ids => {
          if (q.isNegation) {
            this.addNotInObjectIdsIds(ids, query);
          } else {
            this.addInObjectIdsIds(ids, query);
          }
          return Promise.resolve();
        });
      });

      return Promise.all(promises).then(() => {
        return Promise.resolve();
      });
    });

    return Promise.all(promises).then(() => {
      return Promise.resolve(query);
    });
  }

  // Modifies query so that it no longer has $relatedTo
  // Returns a promise that resolves when query is mutated
  reduceRelationKeys(className, query, queryOptions) {

    if (query['$or']) {
      return Promise.all(query['$or'].map(aQuery => {
        return this.reduceRelationKeys(className, aQuery, queryOptions);
      }));
    }

    var relatedTo = query['$relatedTo'];
    if (relatedTo) {
      return this.relatedIds(relatedTo.object.className, relatedTo.key, relatedTo.object.objectId, queryOptions).then(ids => {
        delete query['$relatedTo'];
        this.addInObjectIdsIds(ids, query);
        return this.reduceRelationKeys(className, query, queryOptions);
      }).then(() => {});
    }
  }

  addInObjectIdsIds(ids = null, query) {
    const idsFromString = typeof query.objectId === 'string' ? [query.objectId] : null;
    const idsFromEq = query.objectId && query.objectId['$eq'] ? [query.objectId['$eq']] : null;
    const idsFromIn = query.objectId && query.objectId['$in'] ? query.objectId['$in'] : null;

    // -disable-next
    const allIds = [idsFromString, idsFromEq, idsFromIn, ids].filter(list => list !== null);
    const totalLength = allIds.reduce((memo, list) => memo + list.length, 0);

    let idsIntersection = [];
    if (totalLength > 125) {
      idsIntersection = _intersect2.default.big(allIds);
    } else {
      idsIntersection = (0, _intersect2.default)(allIds);
    }

    // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.
    if (!('objectId' in query)) {
      query.objectId = {
        $in: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $in: undefined,
        $eq: query.objectId
      };
    }
    query.objectId['$in'] = idsIntersection;

    return query;
  }

  addNotInObjectIdsIds(ids = [], query) {
    const idsFromNin = query.objectId && query.objectId['$nin'] ? query.objectId['$nin'] : [];
    let allIds = [...idsFromNin, ...ids].filter(list => list !== null);

    // make a set and spread to remove duplicates
    allIds = [...new Set(allIds)];

    // Need to make sure we don't clobber existing shorthand $eq constraints on objectId.
    if (!('objectId' in query)) {
      query.objectId = {
        $nin: undefined
      };
    } else if (typeof query.objectId === 'string') {
      query.objectId = {
        $nin: undefined,
        $eq: query.objectId
      };
    }

    query.objectId['$nin'] = allIds;
    return query;
  }

  // Runs a query on the database.
  // Returns a promise that resolves to a list of items.
  // Options:
  //   skip    number of results to skip.
  //   limit   limit to this number of results.
  //   sort    an object where keys are the fields to sort by.
  //           the value is +1 for ascending, -1 for descending.
  //   count   run a count instead of returning results.
  //   acl     restrict this operation with an ACL for the provided array
  //           of user objectIds and roles. acl: null means no user.
  //           when this field is not present, don't do anything regarding ACLs.
  // TODO: make userIds not needed here. The db adapter shouldn't know
  // anything about users, ideally. Then, improve the format of the ACL
  // arg to work like the others.
  find(className, query, {
    skip,
    limit,
    acl,
    sort = {},
    count,
    keys,
    op,
    distinct,
    pipeline,
    readPreference,
    isWrite
  } = {}) {
    const isMaster = acl === undefined;
    const aclGroup = acl || [];
    op = op || (typeof query.objectId == 'string' && Object.keys(query).length === 1 ? 'get' : 'find');
    // Count operation if counting
    op = count === true ? 'count' : op;

    let classExists = true;
    return this.loadSchema().then(schemaController => {
      //Allow volatile classes if querying with Master (for _PushStatus)
      //TODO: Move volatile classes concept into mongo adapter, postgres adapter shouldn't care
      //that api.parse.com breaks when _PushStatus exists in mongo.
      return schemaController.getOneSchema(className, isMaster).catch(error => {
        // Behavior for non-existent classes is kinda weird on Parse.com. Probably doesn't matter too much.
        // For now, pretend the class exists but has no objects,
        if (error === undefined) {
          classExists = false;
          return { fields: {} };
        }
        throw error;
      }).then(schema => {
        // Parse.com treats queries on _created_at and _updated_at as if they were queries on createdAt and updatedAt,
        // so duplicate that behavior here. If both are specified, the correct behavior to match Parse.com is to
        // use the one that appears first in the sort list.
        if (sort._created_at) {
          sort.createdAt = sort._created_at;
          delete sort._created_at;
        }
        if (sort._updated_at) {
          sort.updatedAt = sort._updated_at;
          delete sort._updated_at;
        }
        const queryOptions = { skip, limit, sort, keys, readPreference };
        Object.keys(sort).forEach(fieldName => {
          if (fieldName.match(/^authData\.([a-zA-Z0-9_]+)\.id$/)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Cannot sort by ${fieldName}`);
          }
          const rootFieldName = getRootFieldName(fieldName);
          if (!SchemaController.fieldNameIsValid(rootFieldName)) {
            throw new _node.Parse.Error(_node.Parse.Error.INVALID_KEY_NAME, `Invalid field name: ${fieldName}.`);
          }
        });
        return (isMaster ? Promise.resolve() : schemaController.validatePermission(className, aclGroup, op)).then(() => this.reduceRelationKeys(className, query, queryOptions)).then(() => this.reduceInRelation(className, query, schemaController)).then(() => {
          if (!isMaster) {
            query = this.addPointerPermissions(schemaController, className, op, query, aclGroup);
          }
          if (!query) {
            if (op == 'get') {
              throw new _node.Parse.Error(_node.Parse.Error.OBJECT_NOT_FOUND, 'Object not found.');
            } else {
              return [];
            }
          }
          if (!isMaster) {
            if (isWrite) {
              query = addWriteACL(query, aclGroup);
            } else {
              query = addReadACL(query, aclGroup);
            }
          }
          validateQuery(query);
          if (count) {
            if (!classExists) {
              return 0;
            } else {
              return this.adapter.count(className, schema, query, readPreference);
            }
          } else if (distinct) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.distinct(className, schema, query, distinct);
            }
          } else if (pipeline) {
            if (!classExists) {
              return [];
            } else {
              return this.adapter.aggregate(className, schema, pipeline, readPreference);
            }
          } else {
            return this.adapter.find(className, schema, query, queryOptions).then(objects => objects.map(object => {
              object = untransformObjectACL(object);
              return filterSensitiveData(isMaster, aclGroup, className, object);
            })).catch(error => {
              throw new _node.Parse.Error(_node.Parse.Error.INTERNAL_SERVER_ERROR, error);
            });
          }
        });
      });
    });
  }

  deleteSchema(className) {
    return this.loadSchema({ clearCache: true }).then(schemaController => schemaController.getOneSchema(className, true)).catch(error => {
      if (error === undefined) {
        return { fields: {} };
      } else {
        throw error;
      }
    }).then(schema => {
      return this.collectionExists(className).then(() => this.adapter.count(className, { fields: {} })).then(count => {
        if (count > 0) {
          throw new _node.Parse.Error(255, `Class ${className} is not empty, contains ${count} objects, cannot drop schema.`);
        }
        return this.adapter.deleteClass(className);
      }).then(wasParseCollection => {
        if (wasParseCollection) {
          const relationFieldNames = Object.keys(schema.fields).filter(fieldName => schema.fields[fieldName].type === 'Relation');
          return Promise.all(relationFieldNames.map(name => this.adapter.deleteClass(joinTableName(className, name)))).then(() => {
            return;
          });
        } else {
          return Promise.resolve();
        }
      });
    });
  }

  addPointerPermissions(schema, className, operation, query, aclGroup = []) {
    // Check if class has public permission for operation
    // If the BaseCLP pass, let go through
    if (schema.testBaseCLP(className, aclGroup, operation)) {
      return query;
    }
    const perms = schema.perms[className];
    const field = ['get', 'find'].indexOf(operation) > -1 ? 'readUserFields' : 'writeUserFields';
    const userACL = aclGroup.filter(acl => {
      return acl.indexOf('role:') != 0 && acl != '*';
    });
    // the ACL should have exactly 1 user
    if (perms && perms[field] && perms[field].length > 0) {
      // No user set return undefined
      // If the length is > 1, that means we didn't de-dupe users correctly
      if (userACL.length != 1) {
        return;
      }
      const userId = userACL[0];
      const userPointer = {
        "__type": "Pointer",
        "className": "_User",
        "objectId": userId
      };

      const permFields = perms[field];
      const ors = permFields.map(key => {
        const q = {
          [key]: userPointer
        };
        // if we already have a constraint on the key, use the $and
        if (query.hasOwnProperty(key)) {
          return { '$and': [q, query] };
        }
        // otherwise just add the constaint
        return Object.assign({}, query, {
          [`${key}`]: userPointer
        });
      });
      if (ors.length > 1) {
        return { '$or': ors };
      }
      return ors[0];
    } else {
      return query;
    }
  }

  // TODO: create indexes on first creation of a _User object. Otherwise it's impossible to
  // have a Parse app without it having a _User collection.
  performInitialization() {
    const requiredUserFields = { fields: _extends({}, SchemaController.defaultColumns._Default, SchemaController.defaultColumns._User) };
    const requiredRoleFields = { fields: _extends({}, SchemaController.defaultColumns._Default, SchemaController.defaultColumns._Role) };

    const userClassPromise = this.loadSchema().then(schema => schema.enforceClassExists('_User'));
    const roleClassPromise = this.loadSchema().then(schema => schema.enforceClassExists('_Role'));

    const usernameUniqueness = userClassPromise.then(() => this.adapter.ensureUniqueness('_User', requiredUserFields, ['username'])).catch(error => {
      _logger2.default.warn('Unable to ensure uniqueness for usernames: ', error);
      throw error;
    });

    const emailUniqueness = userClassPromise.then(() => this.adapter.ensureUniqueness('_User', requiredUserFields, ['email'])).catch(error => {
      _logger2.default.warn('Unable to ensure uniqueness for user email addresses: ', error);
      throw error;
    });

    const roleUniqueness = roleClassPromise.then(() => this.adapter.ensureUniqueness('_Role', requiredRoleFields, ['name'])).catch(error => {
      _logger2.default.warn('Unable to ensure uniqueness for role name: ', error);
      throw error;
    });

    const indexPromise = this.adapter.updateSchemaWithIndexes();

    // Create tables for volatile classes
    const adapterInit = this.adapter.performInitialization({ VolatileClassesSchemas: SchemaController.VolatileClassesSchemas });
    return Promise.all([usernameUniqueness, emailUniqueness, roleUniqueness, adapterInit, indexPromise]);
  }

}

module.exports = DatabaseController;
// Expose validateQuery for tests
module.exports._validateQuery = validateQuery;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy9Db250cm9sbGVycy9EYXRhYmFzZUNvbnRyb2xsZXIuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsImFkZFdyaXRlQUNMIiwicXVlcnkiLCJhY2wiLCJuZXdRdWVyeSIsImNsb25lRGVlcCIsIl93cGVybSIsImFkZFJlYWRBQ0wiLCJfcnBlcm0iLCJ0cmFuc2Zvcm1PYmplY3RBQ0wiLCJBQ0wiLCJyZXN1bHQiLCJlbnRyeSIsInJlYWQiLCJwdXNoIiwid3JpdGUiLCJzcGVjaWFsUXVlcnlrZXlzIiwiaXNTcGVjaWFsUXVlcnlLZXkiLCJrZXkiLCJpbmRleE9mIiwidmFsaWRhdGVRdWVyeSIsIkVycm9yIiwiSU5WQUxJRF9RVUVSWSIsIiRvciIsIkFycmF5IiwiZm9yRWFjaCIsIk9iamVjdCIsImtleXMiLCJub0NvbGxpc2lvbnMiLCJzb21lIiwic3VicSIsImhhc093blByb3BlcnR5IiwiaGFzTmVhcnMiLCJzdWJxdWVyeSIsIiRhbmQiLCIkbm9yIiwibGVuZ3RoIiwiJHJlZ2V4IiwiJG9wdGlvbnMiLCJtYXRjaCIsIklOVkFMSURfS0VZX05BTUUiLCJmaWx0ZXJTZW5zaXRpdmVEYXRhIiwiaXNNYXN0ZXIiLCJhY2xHcm91cCIsImNsYXNzTmFtZSIsIm9iamVjdCIsInBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsInNlc3Npb25Ub2tlbiIsIl9lbWFpbF92ZXJpZnlfdG9rZW4iLCJfcGVyaXNoYWJsZV90b2tlbiIsIl9wZXJpc2hhYmxlX3Rva2VuX2V4cGlyZXNfYXQiLCJfdG9tYnN0b25lIiwiX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0IiwiX2ZhaWxlZF9sb2dpbl9jb3VudCIsIl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCIsIl9wYXNzd29yZF9jaGFuZ2VkX2F0IiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJvYmplY3RJZCIsImF1dGhEYXRhIiwic3BlY2lhbEtleXNGb3JVcGRhdGUiLCJpc1NwZWNpYWxVcGRhdGVLZXkiLCJleHBhbmRSZXN1bHRPbktleVBhdGgiLCJ2YWx1ZSIsInBhdGgiLCJzcGxpdCIsImZpcnN0S2V5IiwibmV4dFBhdGgiLCJzbGljZSIsImpvaW4iLCJzYW5pdGl6ZURhdGFiYXNlUmVzdWx0Iiwib3JpZ2luYWxPYmplY3QiLCJyZXNwb25zZSIsIlByb21pc2UiLCJyZXNvbHZlIiwia2V5VXBkYXRlIiwiX19vcCIsImpvaW5UYWJsZU5hbWUiLCJmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlIiwiYW1vdW50IiwiSU5WQUxJRF9KU09OIiwib2JqZWN0cyIsIkNPTU1BTkRfVU5BVkFJTEFCTEUiLCJ0cmFuc2Zvcm1BdXRoRGF0YSIsInNjaGVtYSIsInByb3ZpZGVyIiwicHJvdmlkZXJEYXRhIiwiZmllbGROYW1lIiwiZmllbGRzIiwidHlwZSIsInVudHJhbnNmb3JtT2JqZWN0QUNMIiwib3V0cHV0IiwiZ2V0Um9vdEZpZWxkTmFtZSIsInJlbGF0aW9uU2NoZW1hIiwicmVsYXRlZElkIiwib3duaW5nSWQiLCJEYXRhYmFzZUNvbnRyb2xsZXIiLCJjb25zdHJ1Y3RvciIsImFkYXB0ZXIiLCJzY2hlbWFDYWNoZSIsInNjaGVtYVByb21pc2UiLCJjb2xsZWN0aW9uRXhpc3RzIiwiY2xhc3NFeGlzdHMiLCJwdXJnZUNvbGxlY3Rpb24iLCJsb2FkU2NoZW1hIiwidGhlbiIsInNjaGVtYUNvbnRyb2xsZXIiLCJnZXRPbmVTY2hlbWEiLCJkZWxldGVPYmplY3RzQnlRdWVyeSIsInZhbGlkYXRlQ2xhc3NOYW1lIiwiY2xhc3NOYW1lSXNWYWxpZCIsInJlamVjdCIsIklOVkFMSURfQ0xBU1NfTkFNRSIsIm9wdGlvbnMiLCJjbGVhckNhY2hlIiwibG9hZCIsInJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5IiwidCIsImdldEV4cGVjdGVkVHlwZSIsInRhcmdldENsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJ1bmRlZmluZWQiLCJzIiwiY2FuQWRkRmllbGQiLCJ1cGRhdGUiLCJtYW55IiwidXBzZXJ0Iiwic2tpcFNhbml0aXphdGlvbiIsIm9yaWdpbmFsUXVlcnkiLCJvcmlnaW5hbFVwZGF0ZSIsInJlbGF0aW9uVXBkYXRlcyIsInZhbGlkYXRlUGVybWlzc2lvbiIsImNvbGxlY3RSZWxhdGlvblVwZGF0ZXMiLCJhZGRQb2ludGVyUGVybWlzc2lvbnMiLCJjYXRjaCIsImVycm9yIiwicm9vdEZpZWxkTmFtZSIsImZpZWxkTmFtZUlzVmFsaWQiLCJ1cGRhdGVPcGVyYXRpb24iLCJpbm5lcktleSIsImluY2x1ZGVzIiwiSU5WQUxJRF9ORVNURURfS0VZIiwidXBkYXRlT2JqZWN0c0J5UXVlcnkiLCJ1cHNlcnRPbmVPYmplY3QiLCJmaW5kT25lQW5kVXBkYXRlIiwiT0JKRUNUX05PVF9GT1VORCIsImhhbmRsZVJlbGF0aW9uVXBkYXRlcyIsIm9wcyIsImRlbGV0ZU1lIiwicHJvY2VzcyIsIm9wIiwieCIsInBlbmRpbmciLCJhZGRSZWxhdGlvbiIsInJlbW92ZVJlbGF0aW9uIiwiYWxsIiwiZnJvbUNsYXNzTmFtZSIsImZyb21JZCIsInRvSWQiLCJkb2MiLCJjb2RlIiwiZGVzdHJveSIsInBhcnNlRm9ybWF0U2NoZW1hIiwiY3JlYXRlIiwiY3JlYXRlZEF0IiwiaXNvIiwiX190eXBlIiwidXBkYXRlZEF0IiwiZW5mb3JjZUNsYXNzRXhpc3RzIiwicmVsb2FkRGF0YSIsImNyZWF0ZU9iamVjdCIsImNvbnZlcnRTY2hlbWFUb0FkYXB0ZXJTY2hlbWEiLCJjbGFzc1NjaGVtYSIsImRhdGEiLCJzY2hlbWFGaWVsZHMiLCJuZXdLZXlzIiwiZmlsdGVyIiwiZmllbGQiLCJkZWxldGVFdmVyeXRoaW5nIiwiZmFzdCIsImRlbGV0ZUFsbENsYXNzZXMiLCJjbGVhciIsInJlbGF0ZWRJZHMiLCJxdWVyeU9wdGlvbnMiLCJza2lwIiwibGltaXQiLCJzb3J0IiwiZmluZE9wdGlvbnMiLCJjYW5Tb3J0T25Kb2luVGFibGVzIiwiZmluZCIsInJlc3VsdHMiLCJtYXAiLCJvd25pbmdJZHMiLCJyZWR1Y2VJblJlbGF0aW9uIiwib3JzIiwiYVF1ZXJ5IiwiaW5kZXgiLCJwcm9taXNlcyIsInF1ZXJpZXMiLCJjb25zdHJhaW50S2V5IiwiaXNOZWdhdGlvbiIsInIiLCJxIiwiaWRzIiwiYWRkTm90SW5PYmplY3RJZHNJZHMiLCJhZGRJbk9iamVjdElkc0lkcyIsInJlZHVjZVJlbGF0aW9uS2V5cyIsInJlbGF0ZWRUbyIsImlkc0Zyb21TdHJpbmciLCJpZHNGcm9tRXEiLCJpZHNGcm9tSW4iLCJhbGxJZHMiLCJsaXN0IiwidG90YWxMZW5ndGgiLCJyZWR1Y2UiLCJtZW1vIiwiaWRzSW50ZXJzZWN0aW9uIiwiYmlnIiwiJGluIiwiJGVxIiwiaWRzRnJvbU5pbiIsIlNldCIsIiRuaW4iLCJjb3VudCIsImRpc3RpbmN0IiwicGlwZWxpbmUiLCJyZWFkUHJlZmVyZW5jZSIsImlzV3JpdGUiLCJfY3JlYXRlZF9hdCIsIl91cGRhdGVkX2F0IiwiYWdncmVnYXRlIiwiSU5URVJOQUxfU0VSVkVSX0VSUk9SIiwiZGVsZXRlU2NoZW1hIiwiZGVsZXRlQ2xhc3MiLCJ3YXNQYXJzZUNvbGxlY3Rpb24iLCJyZWxhdGlvbkZpZWxkTmFtZXMiLCJuYW1lIiwib3BlcmF0aW9uIiwidGVzdEJhc2VDTFAiLCJwZXJtcyIsInVzZXJBQ0wiLCJ1c2VySWQiLCJ1c2VyUG9pbnRlciIsInBlcm1GaWVsZHMiLCJhc3NpZ24iLCJwZXJmb3JtSW5pdGlhbGl6YXRpb24iLCJyZXF1aXJlZFVzZXJGaWVsZHMiLCJkZWZhdWx0Q29sdW1ucyIsIl9EZWZhdWx0IiwiX1VzZXIiLCJyZXF1aXJlZFJvbGVGaWVsZHMiLCJfUm9sZSIsInVzZXJDbGFzc1Byb21pc2UiLCJyb2xlQ2xhc3NQcm9taXNlIiwidXNlcm5hbWVVbmlxdWVuZXNzIiwiZW5zdXJlVW5pcXVlbmVzcyIsIndhcm4iLCJlbWFpbFVuaXF1ZW5lc3MiLCJyb2xlVW5pcXVlbmVzcyIsImluZGV4UHJvbWlzZSIsInVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzIiwiYWRhcHRlckluaXQiLCJWb2xhdGlsZUNsYXNzZXNTY2hlbWFzIiwibW9kdWxlIiwiZXhwb3J0cyIsIl92YWxpZGF0ZVF1ZXJ5Il0sIm1hcHBpbmdzIjoiOzs7O0FBS0E7O0FBRUE7Ozs7QUFFQTs7OztBQUVBOzs7O0FBQ0E7Ozs7QUFDQTs7SUFBWUEsZ0I7O0FBQ1o7Ozs7Ozs7QUFiQTtBQUNBOztBQUVBOztBQUVBOztBQUVBOztBQUVBOzs7QUFRQSxTQUFTQyxXQUFULENBQXFCQyxLQUFyQixFQUE0QkMsR0FBNUIsRUFBaUM7QUFDL0IsUUFBTUMsV0FBVyxpQkFBRUMsU0FBRixDQUFZSCxLQUFaLENBQWpCO0FBQ0E7QUFDQUUsV0FBU0UsTUFBVCxHQUFrQixFQUFFLE9BQVEsQ0FBQyxJQUFELEVBQU8sR0FBR0gsR0FBVixDQUFWLEVBQWxCO0FBQ0EsU0FBT0MsUUFBUDtBQUNEOztBQUVELFNBQVNHLFVBQVQsQ0FBb0JMLEtBQXBCLEVBQTJCQyxHQUEzQixFQUFnQztBQUM5QixRQUFNQyxXQUFXLGlCQUFFQyxTQUFGLENBQVlILEtBQVosQ0FBakI7QUFDQTtBQUNBRSxXQUFTSSxNQUFULEdBQWtCLEVBQUMsT0FBTyxDQUFDLElBQUQsRUFBTyxHQUFQLEVBQVksR0FBR0wsR0FBZixDQUFSLEVBQWxCO0FBQ0EsU0FBT0MsUUFBUDtBQUNEOztBQUVEO0FBQ0EsTUFBTUsscUJBQXFCLFVBQXdCO0FBQUEsTUFBdkIsRUFBRUMsR0FBRixFQUF1QjtBQUFBLE1BQWJDLE1BQWE7O0FBQ2pELE1BQUksQ0FBQ0QsR0FBTCxFQUFVO0FBQ1IsV0FBT0MsTUFBUDtBQUNEOztBQUVEQSxTQUFPTCxNQUFQLEdBQWdCLEVBQWhCO0FBQ0FLLFNBQU9ILE1BQVAsR0FBZ0IsRUFBaEI7O0FBRUEsT0FBSyxNQUFNSSxLQUFYLElBQW9CRixHQUFwQixFQUF5QjtBQUN2QixRQUFJQSxJQUFJRSxLQUFKLEVBQVdDLElBQWYsRUFBcUI7QUFDbkJGLGFBQU9ILE1BQVAsQ0FBY00sSUFBZCxDQUFtQkYsS0FBbkI7QUFDRDtBQUNELFFBQUlGLElBQUlFLEtBQUosRUFBV0csS0FBZixFQUFzQjtBQUNwQkosYUFBT0wsTUFBUCxDQUFjUSxJQUFkLENBQW1CRixLQUFuQjtBQUNEO0FBQ0Y7QUFDRCxTQUFPRCxNQUFQO0FBQ0QsQ0FqQkQ7O0FBbUJBLE1BQU1LLG1CQUFtQixDQUFDLE1BQUQsRUFBUyxLQUFULEVBQWdCLE1BQWhCLEVBQXdCLFFBQXhCLEVBQWtDLFFBQWxDLEVBQTRDLG1CQUE1QyxFQUFpRSxxQkFBakUsRUFBd0YsZ0NBQXhGLEVBQTBILDZCQUExSCxFQUF5SixxQkFBekosQ0FBekI7O0FBRUEsTUFBTUMsb0JBQW9CQyxPQUFPO0FBQy9CLFNBQU9GLGlCQUFpQkcsT0FBakIsQ0FBeUJELEdBQXpCLEtBQWlDLENBQXhDO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNRSxnQkFBaUJsQixLQUFELElBQXNCO0FBQzFDLE1BQUlBLE1BQU1RLEdBQVYsRUFBZTtBQUNiLFVBQU0sSUFBSSxZQUFNVyxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWUMsYUFBNUIsRUFBMkMsc0JBQTNDLENBQU47QUFDRDs7QUFFRCxNQUFJcEIsTUFBTXFCLEdBQVYsRUFBZTtBQUNiLFFBQUlyQixNQUFNcUIsR0FBTixZQUFxQkMsS0FBekIsRUFBZ0M7QUFDOUJ0QixZQUFNcUIsR0FBTixDQUFVRSxPQUFWLENBQWtCTCxhQUFsQjs7QUFFQTs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQW1CQU0sYUFBT0MsSUFBUCxDQUFZekIsS0FBWixFQUFtQnVCLE9BQW5CLENBQTJCUCxPQUFPO0FBQ2hDLGNBQU1VLGVBQWUsQ0FBQzFCLE1BQU1xQixHQUFOLENBQVVNLElBQVYsQ0FBZUMsUUFBUUEsS0FBS0MsY0FBTCxDQUFvQmIsR0FBcEIsQ0FBdkIsQ0FBdEI7QUFDQSxZQUFJYyxXQUFXLEtBQWY7QUFDQSxZQUFJOUIsTUFBTWdCLEdBQU4sS0FBYyxJQUFkLElBQXNCLE9BQU9oQixNQUFNZ0IsR0FBTixDQUFQLElBQXFCLFFBQS9DLEVBQXlEO0FBQ3ZEYyxxQkFBWSxXQUFXOUIsTUFBTWdCLEdBQU4sQ0FBWCxJQUF5QixpQkFBaUJoQixNQUFNZ0IsR0FBTixDQUF0RDtBQUNEO0FBQ0QsWUFBSUEsT0FBTyxLQUFQLElBQWdCVSxZQUFoQixJQUFnQyxDQUFDSSxRQUFyQyxFQUErQztBQUM3QzlCLGdCQUFNcUIsR0FBTixDQUFVRSxPQUFWLENBQWtCUSxZQUFZO0FBQzVCQSxxQkFBU2YsR0FBVCxJQUFnQmhCLE1BQU1nQixHQUFOLENBQWhCO0FBQ0QsV0FGRDtBQUdBLGlCQUFPaEIsTUFBTWdCLEdBQU4sQ0FBUDtBQUNEO0FBQ0YsT0FaRDtBQWFBaEIsWUFBTXFCLEdBQU4sQ0FBVUUsT0FBVixDQUFrQkwsYUFBbEI7QUFDRCxLQXBDRCxNQW9DTztBQUNMLFlBQU0sSUFBSSxZQUFNQyxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWUMsYUFBNUIsRUFBMkMsc0NBQTNDLENBQU47QUFDRDtBQUNGOztBQUVELE1BQUlwQixNQUFNZ0MsSUFBVixFQUFnQjtBQUNkLFFBQUloQyxNQUFNZ0MsSUFBTixZQUFzQlYsS0FBMUIsRUFBaUM7QUFDL0J0QixZQUFNZ0MsSUFBTixDQUFXVCxPQUFYLENBQW1CTCxhQUFuQjtBQUNELEtBRkQsTUFFTztBQUNMLFlBQU0sSUFBSSxZQUFNQyxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWUMsYUFBNUIsRUFBMkMsdUNBQTNDLENBQU47QUFDRDtBQUNGOztBQUVELE1BQUlwQixNQUFNaUMsSUFBVixFQUFnQjtBQUNkLFFBQUlqQyxNQUFNaUMsSUFBTixZQUFzQlgsS0FBdEIsSUFBK0J0QixNQUFNaUMsSUFBTixDQUFXQyxNQUFYLEdBQW9CLENBQXZELEVBQTBEO0FBQ3hEbEMsWUFBTWlDLElBQU4sQ0FBV1YsT0FBWCxDQUFtQkwsYUFBbkI7QUFDRCxLQUZELE1BRU87QUFDTCxZQUFNLElBQUksWUFBTUMsS0FBVixDQUFnQixZQUFNQSxLQUFOLENBQVlDLGFBQTVCLEVBQTJDLHFEQUEzQyxDQUFOO0FBQ0Q7QUFDRjs7QUFFREksU0FBT0MsSUFBUCxDQUFZekIsS0FBWixFQUFtQnVCLE9BQW5CLENBQTJCUCxPQUFPO0FBQ2hDLFFBQUloQixTQUFTQSxNQUFNZ0IsR0FBTixDQUFULElBQXVCaEIsTUFBTWdCLEdBQU4sRUFBV21CLE1BQXRDLEVBQThDO0FBQzVDLFVBQUksT0FBT25DLE1BQU1nQixHQUFOLEVBQVdvQixRQUFsQixLQUErQixRQUFuQyxFQUE2QztBQUMzQyxZQUFJLENBQUNwQyxNQUFNZ0IsR0FBTixFQUFXb0IsUUFBWCxDQUFvQkMsS0FBcEIsQ0FBMEIsV0FBMUIsQ0FBTCxFQUE2QztBQUMzQyxnQkFBTSxJQUFJLFlBQU1sQixLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWUMsYUFBNUIsRUFBNEMsaUNBQWdDcEIsTUFBTWdCLEdBQU4sRUFBV29CLFFBQVMsRUFBaEcsQ0FBTjtBQUNEO0FBQ0Y7QUFDRjtBQUNELFFBQUksQ0FBQ3JCLGtCQUFrQkMsR0FBbEIsQ0FBRCxJQUEyQixDQUFDQSxJQUFJcUIsS0FBSixDQUFVLDJCQUFWLENBQWhDLEVBQXdFO0FBQ3RFLFlBQU0sSUFBSSxZQUFNbEIsS0FBVixDQUFnQixZQUFNQSxLQUFOLENBQVltQixnQkFBNUIsRUFBK0MscUJBQW9CdEIsR0FBSSxFQUF2RSxDQUFOO0FBQ0Q7QUFDRixHQVhEO0FBWUQsQ0EzRUQ7O0FBNkVBO0FBQ0EsTUFBTXVCLHNCQUFzQixDQUFDQyxRQUFELEVBQVdDLFFBQVgsRUFBcUJDLFNBQXJCLEVBQWdDQyxNQUFoQyxLQUEyQztBQUNyRSxNQUFJRCxjQUFjLE9BQWxCLEVBQTJCO0FBQ3pCLFdBQU9DLE1BQVA7QUFDRDs7QUFFREEsU0FBT0MsUUFBUCxHQUFrQkQsT0FBT0UsZ0JBQXpCO0FBQ0EsU0FBT0YsT0FBT0UsZ0JBQWQ7O0FBRUEsU0FBT0YsT0FBT0csWUFBZDs7QUFFQSxNQUFJTixRQUFKLEVBQWM7QUFDWixXQUFPRyxNQUFQO0FBQ0Q7QUFDRCxTQUFPQSxPQUFPSSxtQkFBZDtBQUNBLFNBQU9KLE9BQU9LLGlCQUFkO0FBQ0EsU0FBT0wsT0FBT00sNEJBQWQ7QUFDQSxTQUFPTixPQUFPTyxVQUFkO0FBQ0EsU0FBT1AsT0FBT1EsOEJBQWQ7QUFDQSxTQUFPUixPQUFPUyxtQkFBZDtBQUNBLFNBQU9ULE9BQU9VLDJCQUFkO0FBQ0EsU0FBT1YsT0FBT1csb0JBQWQ7QUFDQSxTQUFPWCxPQUFPWSxpQkFBZDs7QUFFQSxNQUFLZCxTQUFTeEIsT0FBVCxDQUFpQjBCLE9BQU9hLFFBQXhCLElBQW9DLENBQUMsQ0FBMUMsRUFBOEM7QUFDNUMsV0FBT2IsTUFBUDtBQUNEO0FBQ0QsU0FBT0EsT0FBT2MsUUFBZDtBQUNBLFNBQU9kLE1BQVA7QUFDRCxDQTVCRDs7QUFnQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLE1BQU1lLHVCQUF1QixDQUFDLGtCQUFELEVBQXFCLG1CQUFyQixFQUEwQyxxQkFBMUMsRUFBaUUsZ0NBQWpFLEVBQW1HLDZCQUFuRyxFQUFrSSxxQkFBbEksRUFBeUosOEJBQXpKLEVBQXlMLHNCQUF6TCxFQUFpTixtQkFBak4sQ0FBN0I7O0FBRUEsTUFBTUMscUJBQXFCM0MsT0FBTztBQUNoQyxTQUFPMEMscUJBQXFCekMsT0FBckIsQ0FBNkJELEdBQTdCLEtBQXFDLENBQTVDO0FBQ0QsQ0FGRDs7QUFJQSxTQUFTNEMscUJBQVQsQ0FBK0JqQixNQUEvQixFQUF1QzNCLEdBQXZDLEVBQTRDNkMsS0FBNUMsRUFBbUQ7QUFDakQsTUFBSTdDLElBQUlDLE9BQUosQ0FBWSxHQUFaLElBQW1CLENBQXZCLEVBQTBCO0FBQ3hCMEIsV0FBTzNCLEdBQVAsSUFBYzZDLE1BQU03QyxHQUFOLENBQWQ7QUFDQSxXQUFPMkIsTUFBUDtBQUNEO0FBQ0QsUUFBTW1CLE9BQU85QyxJQUFJK0MsS0FBSixDQUFVLEdBQVYsQ0FBYjtBQUNBLFFBQU1DLFdBQVdGLEtBQUssQ0FBTCxDQUFqQjtBQUNBLFFBQU1HLFdBQVdILEtBQUtJLEtBQUwsQ0FBVyxDQUFYLEVBQWNDLElBQWQsQ0FBbUIsR0FBbkIsQ0FBakI7QUFDQXhCLFNBQU9xQixRQUFQLElBQW1CSixzQkFBc0JqQixPQUFPcUIsUUFBUCxLQUFvQixFQUExQyxFQUE4Q0MsUUFBOUMsRUFBd0RKLE1BQU1HLFFBQU4sQ0FBeEQsQ0FBbkI7QUFDQSxTQUFPckIsT0FBTzNCLEdBQVAsQ0FBUDtBQUNBLFNBQU8yQixNQUFQO0FBQ0Q7O0FBRUQsU0FBU3lCLHNCQUFULENBQWdDQyxjQUFoQyxFQUFnRDVELE1BQWhELEVBQXNFO0FBQ3BFLFFBQU02RCxXQUFXLEVBQWpCO0FBQ0EsTUFBSSxDQUFDN0QsTUFBTCxFQUFhO0FBQ1gsV0FBTzhELFFBQVFDLE9BQVIsQ0FBZ0JGLFFBQWhCLENBQVA7QUFDRDtBQUNEOUMsU0FBT0MsSUFBUCxDQUFZNEMsY0FBWixFQUE0QjlDLE9BQTVCLENBQW9DUCxPQUFPO0FBQ3pDLFVBQU15RCxZQUFZSixlQUFlckQsR0FBZixDQUFsQjtBQUNBO0FBQ0EsUUFBSXlELGFBQWEsT0FBT0EsU0FBUCxLQUFxQixRQUFsQyxJQUE4Q0EsVUFBVUMsSUFBeEQsSUFDQyxDQUFDLEtBQUQsRUFBUSxXQUFSLEVBQXFCLFFBQXJCLEVBQStCLFdBQS9CLEVBQTRDekQsT0FBNUMsQ0FBb0R3RCxVQUFVQyxJQUE5RCxJQUFzRSxDQUFDLENBRDVFLEVBQytFO0FBQzdFO0FBQ0E7QUFDQWQsNEJBQXNCVSxRQUF0QixFQUFnQ3RELEdBQWhDLEVBQXFDUCxNQUFyQztBQUNEO0FBQ0YsR0FURDtBQVVBLFNBQU84RCxRQUFRQyxPQUFSLENBQWdCRixRQUFoQixDQUFQO0FBQ0Q7O0FBRUQsU0FBU0ssYUFBVCxDQUF1QmpDLFNBQXZCLEVBQWtDMUIsR0FBbEMsRUFBdUM7QUFDckMsU0FBUSxTQUFRQSxHQUFJLElBQUcwQixTQUFVLEVBQWpDO0FBQ0Q7O0FBRUQsTUFBTWtDLGtDQUFrQ2pDLFVBQVU7QUFDaEQsT0FBSyxNQUFNM0IsR0FBWCxJQUFrQjJCLE1BQWxCLEVBQTBCO0FBQ3hCLFFBQUlBLE9BQU8zQixHQUFQLEtBQWUyQixPQUFPM0IsR0FBUCxFQUFZMEQsSUFBL0IsRUFBcUM7QUFDbkMsY0FBUS9CLE9BQU8zQixHQUFQLEVBQVkwRCxJQUFwQjtBQUNBLGFBQUssV0FBTDtBQUNFLGNBQUksT0FBTy9CLE9BQU8zQixHQUFQLEVBQVk2RCxNQUFuQixLQUE4QixRQUFsQyxFQUE0QztBQUMxQyxrQkFBTSxJQUFJLFlBQU0xRCxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWTJELFlBQTVCLEVBQTBDLGlDQUExQyxDQUFOO0FBQ0Q7QUFDRG5DLGlCQUFPM0IsR0FBUCxJQUFjMkIsT0FBTzNCLEdBQVAsRUFBWTZELE1BQTFCO0FBQ0E7QUFDRixhQUFLLEtBQUw7QUFDRSxjQUFJLEVBQUVsQyxPQUFPM0IsR0FBUCxFQUFZK0QsT0FBWixZQUErQnpELEtBQWpDLENBQUosRUFBNkM7QUFDM0Msa0JBQU0sSUFBSSxZQUFNSCxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWTJELFlBQTVCLEVBQTBDLGlDQUExQyxDQUFOO0FBQ0Q7QUFDRG5DLGlCQUFPM0IsR0FBUCxJQUFjMkIsT0FBTzNCLEdBQVAsRUFBWStELE9BQTFCO0FBQ0E7QUFDRixhQUFLLFdBQUw7QUFDRSxjQUFJLEVBQUVwQyxPQUFPM0IsR0FBUCxFQUFZK0QsT0FBWixZQUErQnpELEtBQWpDLENBQUosRUFBNkM7QUFDM0Msa0JBQU0sSUFBSSxZQUFNSCxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWTJELFlBQTVCLEVBQTBDLGlDQUExQyxDQUFOO0FBQ0Q7QUFDRG5DLGlCQUFPM0IsR0FBUCxJQUFjMkIsT0FBTzNCLEdBQVAsRUFBWStELE9BQTFCO0FBQ0E7QUFDRixhQUFLLFFBQUw7QUFDRSxjQUFJLEVBQUVwQyxPQUFPM0IsR0FBUCxFQUFZK0QsT0FBWixZQUErQnpELEtBQWpDLENBQUosRUFBNkM7QUFDM0Msa0JBQU0sSUFBSSxZQUFNSCxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWTJELFlBQTVCLEVBQTBDLGlDQUExQyxDQUFOO0FBQ0Q7QUFDRG5DLGlCQUFPM0IsR0FBUCxJQUFjLEVBQWQ7QUFDQTtBQUNGLGFBQUssUUFBTDtBQUNFLGlCQUFPMkIsT0FBTzNCLEdBQVAsQ0FBUDtBQUNBO0FBQ0Y7QUFDRSxnQkFBTSxJQUFJLFlBQU1HLEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZNkQsbUJBQTVCLEVBQWtELE9BQU1yQyxPQUFPM0IsR0FBUCxFQUFZMEQsSUFBSyxpQ0FBekUsQ0FBTjtBQTdCRjtBQStCRDtBQUNGO0FBQ0YsQ0FwQ0Q7O0FBc0NBLE1BQU1PLG9CQUFvQixDQUFDdkMsU0FBRCxFQUFZQyxNQUFaLEVBQW9CdUMsTUFBcEIsS0FBK0I7QUFDdkQsTUFBSXZDLE9BQU9jLFFBQVAsSUFBbUJmLGNBQWMsT0FBckMsRUFBOEM7QUFDNUNsQixXQUFPQyxJQUFQLENBQVlrQixPQUFPYyxRQUFuQixFQUE2QmxDLE9BQTdCLENBQXFDNEQsWUFBWTtBQUMvQyxZQUFNQyxlQUFlekMsT0FBT2MsUUFBUCxDQUFnQjBCLFFBQWhCLENBQXJCO0FBQ0EsWUFBTUUsWUFBYSxjQUFhRixRQUFTLEVBQXpDO0FBQ0EsVUFBSUMsZ0JBQWdCLElBQXBCLEVBQTBCO0FBQ3hCekMsZUFBTzBDLFNBQVAsSUFBb0I7QUFDbEJYLGdCQUFNO0FBRFksU0FBcEI7QUFHRCxPQUpELE1BSU87QUFDTC9CLGVBQU8wQyxTQUFQLElBQW9CRCxZQUFwQjtBQUNBRixlQUFPSSxNQUFQLENBQWNELFNBQWQsSUFBMkIsRUFBRUUsTUFBTSxRQUFSLEVBQTNCO0FBQ0Q7QUFDRixLQVhEO0FBWUEsV0FBTzVDLE9BQU9jLFFBQWQ7QUFDRDtBQUNGLENBaEJEO0FBaUJBO0FBQ0EsTUFBTStCLHVCQUF1QixXQUFpQztBQUFBLE1BQWhDLEVBQUNsRixNQUFELEVBQVNGLE1BQVQsRUFBZ0M7QUFBQSxNQUFacUYsTUFBWTs7QUFDNUQsTUFBSW5GLFVBQVVGLE1BQWQsRUFBc0I7QUFDcEJxRixXQUFPakYsR0FBUCxHQUFhLEVBQWI7O0FBRUEsS0FBQ0YsVUFBVSxFQUFYLEVBQWVpQixPQUFmLENBQXVCYixTQUFTO0FBQzlCLFVBQUksQ0FBQytFLE9BQU9qRixHQUFQLENBQVdFLEtBQVgsQ0FBTCxFQUF3QjtBQUN0QitFLGVBQU9qRixHQUFQLENBQVdFLEtBQVgsSUFBb0IsRUFBRUMsTUFBTSxJQUFSLEVBQXBCO0FBQ0QsT0FGRCxNQUVPO0FBQ0w4RSxlQUFPakYsR0FBUCxDQUFXRSxLQUFYLEVBQWtCLE1BQWxCLElBQTRCLElBQTVCO0FBQ0Q7QUFDRixLQU5EOztBQVFBLEtBQUNOLFVBQVUsRUFBWCxFQUFlbUIsT0FBZixDQUF1QmIsU0FBUztBQUM5QixVQUFJLENBQUMrRSxPQUFPakYsR0FBUCxDQUFXRSxLQUFYLENBQUwsRUFBd0I7QUFDdEIrRSxlQUFPakYsR0FBUCxDQUFXRSxLQUFYLElBQW9CLEVBQUVHLE9BQU8sSUFBVCxFQUFwQjtBQUNELE9BRkQsTUFFTztBQUNMNEUsZUFBT2pGLEdBQVAsQ0FBV0UsS0FBWCxFQUFrQixPQUFsQixJQUE2QixJQUE3QjtBQUNEO0FBQ0YsS0FORDtBQU9EO0FBQ0QsU0FBTytFLE1BQVA7QUFDRCxDQXJCRDs7QUF1QkE7Ozs7OztBQU1BLE1BQU1DLG1CQUFvQkwsU0FBRCxJQUErQjtBQUN0RCxTQUFPQSxVQUFVdEIsS0FBVixDQUFnQixHQUFoQixFQUFxQixDQUFyQixDQUFQO0FBQ0QsQ0FGRDs7QUFJQSxNQUFNNEIsaUJBQWlCLEVBQUVMLFFBQVEsRUFBRU0sV0FBVyxFQUFFTCxNQUFNLFFBQVIsRUFBYixFQUFpQ00sVUFBVSxFQUFFTixNQUFNLFFBQVIsRUFBM0MsRUFBVixFQUF2Qjs7QUFFQSxNQUFNTyxrQkFBTixDQUF5Qjs7QUFLdkJDLGNBQVlDLE9BQVosRUFBcUNDLFdBQXJDLEVBQXVEO0FBQ3JELFNBQUtELE9BQUwsR0FBZUEsT0FBZjtBQUNBLFNBQUtDLFdBQUwsR0FBbUJBLFdBQW5CO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsU0FBS0MsYUFBTCxHQUFxQixJQUFyQjtBQUNEOztBQUVEQyxtQkFBaUJ6RCxTQUFqQixFQUFzRDtBQUNwRCxXQUFPLEtBQUtzRCxPQUFMLENBQWFJLFdBQWIsQ0FBeUIxRCxTQUF6QixDQUFQO0FBQ0Q7O0FBRUQyRCxrQkFBZ0IzRCxTQUFoQixFQUFrRDtBQUNoRCxXQUFPLEtBQUs0RCxVQUFMLEdBQ0pDLElBREksQ0FDQ0Msb0JBQW9CQSxpQkFBaUJDLFlBQWpCLENBQThCL0QsU0FBOUIsQ0FEckIsRUFFSjZELElBRkksQ0FFQ3JCLFVBQVUsS0FBS2MsT0FBTCxDQUFhVSxvQkFBYixDQUFrQ2hFLFNBQWxDLEVBQTZDd0MsTUFBN0MsRUFBcUQsRUFBckQsQ0FGWCxDQUFQO0FBR0Q7O0FBRUR5QixvQkFBa0JqRSxTQUFsQixFQUFvRDtBQUNsRCxRQUFJLENBQUM1QyxpQkFBaUI4RyxnQkFBakIsQ0FBa0NsRSxTQUFsQyxDQUFMLEVBQW1EO0FBQ2pELGFBQU82QixRQUFRc0MsTUFBUixDQUFlLElBQUksWUFBTTFGLEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZMkYsa0JBQTVCLEVBQWdELHdCQUF3QnBFLFNBQXhFLENBQWYsQ0FBUDtBQUNEO0FBQ0QsV0FBTzZCLFFBQVFDLE9BQVIsRUFBUDtBQUNEOztBQUVEO0FBQ0E4QixhQUFXUyxVQUE2QixFQUFDQyxZQUFZLEtBQWIsRUFBeEMsRUFBeUc7QUFDdkcsUUFBSSxLQUFLZCxhQUFMLElBQXNCLElBQTFCLEVBQWdDO0FBQzlCLGFBQU8sS0FBS0EsYUFBWjtBQUNEO0FBQ0QsU0FBS0EsYUFBTCxHQUFxQnBHLGlCQUFpQm1ILElBQWpCLENBQXNCLEtBQUtqQixPQUEzQixFQUFvQyxLQUFLQyxXQUF6QyxFQUFzRGMsT0FBdEQsQ0FBckI7QUFDQSxTQUFLYixhQUFMLENBQW1CSyxJQUFuQixDQUF3QixNQUFNLE9BQU8sS0FBS0wsYUFBMUMsRUFDRSxNQUFNLE9BQU8sS0FBS0EsYUFEcEI7QUFFQSxXQUFPLEtBQUtJLFVBQUwsQ0FBZ0JTLE9BQWhCLENBQVA7QUFDRDs7QUFFRDtBQUNBO0FBQ0E7QUFDQUcsMEJBQXdCeEUsU0FBeEIsRUFBMkMxQixHQUEzQyxFQUEwRTtBQUN4RSxXQUFPLEtBQUtzRixVQUFMLEdBQWtCQyxJQUFsQixDQUF3QnJCLE1BQUQsSUFBWTtBQUN4QyxVQUFJaUMsSUFBS2pDLE9BQU9rQyxlQUFQLENBQXVCMUUsU0FBdkIsRUFBa0MxQixHQUFsQyxDQUFUO0FBQ0EsVUFBSW1HLEtBQUssSUFBTCxJQUFhLE9BQU9BLENBQVAsS0FBYSxRQUExQixJQUFzQ0EsRUFBRTVCLElBQUYsS0FBVyxVQUFyRCxFQUFpRTtBQUMvRCxlQUFPNEIsRUFBRUUsV0FBVDtBQUNEO0FBQ0QsYUFBTzNFLFNBQVA7QUFDRCxLQU5NLENBQVA7QUFPRDs7QUFFRDtBQUNBO0FBQ0E7QUFDQTtBQUNBNEUsaUJBQWU1RSxTQUFmLEVBQWtDQyxNQUFsQyxFQUErQzNDLEtBQS9DLEVBQTJELEVBQUVDLEdBQUYsRUFBM0QsRUFBb0c7QUFDbEcsUUFBSWlGLE1BQUo7QUFDQSxVQUFNMUMsV0FBV3ZDLFFBQVFzSCxTQUF6QjtBQUNBLFFBQUk5RSxXQUFzQnhDLE9BQU8sRUFBakM7QUFDQSxXQUFPLEtBQUtxRyxVQUFMLEdBQWtCQyxJQUFsQixDQUF1QmlCLEtBQUs7QUFDakN0QyxlQUFTc0MsQ0FBVDtBQUNBLFVBQUloRixRQUFKLEVBQWM7QUFDWixlQUFPK0IsUUFBUUMsT0FBUixFQUFQO0FBQ0Q7QUFDRCxhQUFPLEtBQUtpRCxXQUFMLENBQWlCdkMsTUFBakIsRUFBeUJ4QyxTQUF6QixFQUFvQ0MsTUFBcEMsRUFBNENGLFFBQTVDLENBQVA7QUFDRCxLQU5NLEVBTUo4RCxJQU5JLENBTUMsTUFBTTtBQUNaLGFBQU9yQixPQUFPb0MsY0FBUCxDQUFzQjVFLFNBQXRCLEVBQWlDQyxNQUFqQyxFQUF5QzNDLEtBQXpDLENBQVA7QUFDRCxLQVJNLENBQVA7QUFTRDs7QUFFRDBILFNBQU9oRixTQUFQLEVBQTBCMUMsS0FBMUIsRUFBc0MwSCxNQUF0QyxFQUFtRDtBQUNqRHpILE9BRGlEO0FBRWpEMEgsUUFGaUQ7QUFHakRDO0FBSGlELE1BSTdCLEVBSnRCLEVBSTBCQyxtQkFBNEIsS0FKdEQsRUFJMkU7QUFDekUsVUFBTUMsZ0JBQWdCOUgsS0FBdEI7QUFDQSxVQUFNK0gsaUJBQWlCTCxNQUF2QjtBQUNBO0FBQ0FBLGFBQVMsd0JBQVNBLE1BQVQsQ0FBVDtBQUNBLFFBQUlNLGtCQUFrQixFQUF0QjtBQUNBLFFBQUl4RixXQUFXdkMsUUFBUXNILFNBQXZCO0FBQ0EsUUFBSTlFLFdBQVd4QyxPQUFPLEVBQXRCO0FBQ0EsV0FBTyxLQUFLcUcsVUFBTCxHQUNKQyxJQURJLENBQ0NDLG9CQUFvQjtBQUN4QixhQUFPLENBQUNoRSxXQUFXK0IsUUFBUUMsT0FBUixFQUFYLEdBQStCZ0MsaUJBQWlCeUIsa0JBQWpCLENBQW9DdkYsU0FBcEMsRUFBK0NELFFBQS9DLEVBQXlELFFBQXpELENBQWhDLEVBQ0o4RCxJQURJLENBQ0MsTUFBTTtBQUNWeUIsMEJBQWtCLEtBQUtFLHNCQUFMLENBQTRCeEYsU0FBNUIsRUFBdUNvRixjQUFjdEUsUUFBckQsRUFBK0RrRSxNQUEvRCxDQUFsQjtBQUNBLFlBQUksQ0FBQ2xGLFFBQUwsRUFBZTtBQUNieEMsa0JBQVEsS0FBS21JLHFCQUFMLENBQTJCM0IsZ0JBQTNCLEVBQTZDOUQsU0FBN0MsRUFBd0QsUUFBeEQsRUFBa0UxQyxLQUFsRSxFQUF5RXlDLFFBQXpFLENBQVI7QUFDRDtBQUNELFlBQUksQ0FBQ3pDLEtBQUwsRUFBWTtBQUNWLGlCQUFPdUUsUUFBUUMsT0FBUixFQUFQO0FBQ0Q7QUFDRCxZQUFJdkUsR0FBSixFQUFTO0FBQ1BELGtCQUFRRCxZQUFZQyxLQUFaLEVBQW1CQyxHQUFuQixDQUFSO0FBQ0Q7QUFDRGlCLHNCQUFjbEIsS0FBZDtBQUNBLGVBQU93RyxpQkFBaUJDLFlBQWpCLENBQThCL0QsU0FBOUIsRUFBeUMsSUFBekMsRUFDSjBGLEtBREksQ0FDRUMsU0FBUztBQUNkO0FBQ0E7QUFDQSxjQUFJQSxVQUFVZCxTQUFkLEVBQXlCO0FBQ3ZCLG1CQUFPLEVBQUVqQyxRQUFRLEVBQVYsRUFBUDtBQUNEO0FBQ0QsZ0JBQU0rQyxLQUFOO0FBQ0QsU0FSSSxFQVNKOUIsSUFUSSxDQVNDckIsVUFBVTtBQUNkMUQsaUJBQU9DLElBQVAsQ0FBWWlHLE1BQVosRUFBb0JuRyxPQUFwQixDQUE0QjhELGFBQWE7QUFDdkMsZ0JBQUlBLFVBQVVoRCxLQUFWLENBQWdCLGlDQUFoQixDQUFKLEVBQXdEO0FBQ3RELG9CQUFNLElBQUksWUFBTWxCLEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZbUIsZ0JBQTVCLEVBQStDLGtDQUFpQytDLFNBQVUsRUFBMUYsQ0FBTjtBQUNEO0FBQ0Qsa0JBQU1pRCxnQkFBZ0I1QyxpQkFBaUJMLFNBQWpCLENBQXRCO0FBQ0EsZ0JBQUksQ0FBQ3ZGLGlCQUFpQnlJLGdCQUFqQixDQUFrQ0QsYUFBbEMsQ0FBRCxJQUFxRCxDQUFDM0UsbUJBQW1CMkUsYUFBbkIsQ0FBMUQsRUFBNkY7QUFDM0Ysb0JBQU0sSUFBSSxZQUFNbkgsS0FBVixDQUFnQixZQUFNQSxLQUFOLENBQVltQixnQkFBNUIsRUFBK0Msa0NBQWlDK0MsU0FBVSxFQUExRixDQUFOO0FBQ0Q7QUFDRixXQVJEO0FBU0EsZUFBSyxNQUFNbUQsZUFBWCxJQUE4QmQsTUFBOUIsRUFBc0M7QUFDcEMsZ0JBQUlBLE9BQU9jLGVBQVAsS0FBMkIsT0FBT2QsT0FBT2MsZUFBUCxDQUFQLEtBQW1DLFFBQTlELElBQTBFaEgsT0FBT0MsSUFBUCxDQUFZaUcsT0FBT2MsZUFBUCxDQUFaLEVBQXFDN0csSUFBckMsQ0FBMEM4RyxZQUFZQSxTQUFTQyxRQUFULENBQWtCLEdBQWxCLEtBQTBCRCxTQUFTQyxRQUFULENBQWtCLEdBQWxCLENBQWhGLENBQTlFLEVBQXVMO0FBQ3JMLG9CQUFNLElBQUksWUFBTXZILEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZd0gsa0JBQTVCLEVBQWdELDBEQUFoRCxDQUFOO0FBQ0Q7QUFDRjtBQUNEakIsbUJBQVNuSCxtQkFBbUJtSCxNQUFuQixDQUFUO0FBQ0F6Qyw0QkFBa0J2QyxTQUFsQixFQUE2QmdGLE1BQTdCLEVBQXFDeEMsTUFBckM7QUFDQSxjQUFJeUMsSUFBSixFQUFVO0FBQ1IsbUJBQU8sS0FBSzNCLE9BQUwsQ0FBYTRDLG9CQUFiLENBQWtDbEcsU0FBbEMsRUFBNkN3QyxNQUE3QyxFQUFxRGxGLEtBQXJELEVBQTREMEgsTUFBNUQsQ0FBUDtBQUNELFdBRkQsTUFFTyxJQUFJRSxNQUFKLEVBQVk7QUFDakIsbUJBQU8sS0FBSzVCLE9BQUwsQ0FBYTZDLGVBQWIsQ0FBNkJuRyxTQUE3QixFQUF3Q3dDLE1BQXhDLEVBQWdEbEYsS0FBaEQsRUFBdUQwSCxNQUF2RCxDQUFQO0FBQ0QsV0FGTSxNQUVBO0FBQ0wsbUJBQU8sS0FBSzFCLE9BQUwsQ0FBYThDLGdCQUFiLENBQThCcEcsU0FBOUIsRUFBeUN3QyxNQUF6QyxFQUFpRGxGLEtBQWpELEVBQXdEMEgsTUFBeEQsQ0FBUDtBQUNEO0FBQ0YsU0FqQ0ksQ0FBUDtBQWtDRCxPQS9DSSxFQWdESm5CLElBaERJLENBZ0RFOUYsTUFBRCxJQUFpQjtBQUNyQixZQUFJLENBQUNBLE1BQUwsRUFBYTtBQUNYLGdCQUFNLElBQUksWUFBTVUsS0FBVixDQUFnQixZQUFNQSxLQUFOLENBQVk0SCxnQkFBNUIsRUFBOEMsbUJBQTlDLENBQU47QUFDRDtBQUNELGVBQU8sS0FBS0MscUJBQUwsQ0FBMkJ0RyxTQUEzQixFQUFzQ29GLGNBQWN0RSxRQUFwRCxFQUE4RGtFLE1BQTlELEVBQXNFTSxlQUF0RSxFQUF1RnpCLElBQXZGLENBQTRGLE1BQU07QUFDdkcsaUJBQU85RixNQUFQO0FBQ0QsU0FGTSxDQUFQO0FBR0QsT0F2REksRUF1REY4RixJQXZERSxDQXVESTlGLE1BQUQsSUFBWTtBQUNsQixZQUFJb0gsZ0JBQUosRUFBc0I7QUFDcEIsaUJBQU90RCxRQUFRQyxPQUFSLENBQWdCL0QsTUFBaEIsQ0FBUDtBQUNEO0FBQ0QsZUFBTzJELHVCQUF1QjJELGNBQXZCLEVBQXVDdEgsTUFBdkMsQ0FBUDtBQUNELE9BNURJLENBQVA7QUE2REQsS0EvREksQ0FBUDtBQWdFRDs7QUFFRDtBQUNBO0FBQ0E7QUFDQXlILHlCQUF1QnhGLFNBQXZCLEVBQTBDYyxRQUExQyxFQUE2RGtFLE1BQTdELEVBQTBFO0FBQ3hFLFFBQUl1QixNQUFNLEVBQVY7QUFDQSxRQUFJQyxXQUFXLEVBQWY7QUFDQTFGLGVBQVdrRSxPQUFPbEUsUUFBUCxJQUFtQkEsUUFBOUI7O0FBRUEsUUFBSTJGLFVBQVUsQ0FBQ0MsRUFBRCxFQUFLcEksR0FBTCxLQUFhO0FBQ3pCLFVBQUksQ0FBQ29JLEVBQUwsRUFBUztBQUNQO0FBQ0Q7QUFDRCxVQUFJQSxHQUFHMUUsSUFBSCxJQUFXLGFBQWYsRUFBOEI7QUFDNUJ1RSxZQUFJckksSUFBSixDQUFTLEVBQUNJLEdBQUQsRUFBTW9JLEVBQU4sRUFBVDtBQUNBRixpQkFBU3RJLElBQVQsQ0FBY0ksR0FBZDtBQUNEOztBQUVELFVBQUlvSSxHQUFHMUUsSUFBSCxJQUFXLGdCQUFmLEVBQWlDO0FBQy9CdUUsWUFBSXJJLElBQUosQ0FBUyxFQUFDSSxHQUFELEVBQU1vSSxFQUFOLEVBQVQ7QUFDQUYsaUJBQVN0SSxJQUFULENBQWNJLEdBQWQ7QUFDRDs7QUFFRCxVQUFJb0ksR0FBRzFFLElBQUgsSUFBVyxPQUFmLEVBQXdCO0FBQ3RCLGFBQUssSUFBSTJFLENBQVQsSUFBY0QsR0FBR0gsR0FBakIsRUFBc0I7QUFDcEJFLGtCQUFRRSxDQUFSLEVBQVdySSxHQUFYO0FBQ0Q7QUFDRjtBQUNGLEtBbkJEOztBQXFCQSxTQUFLLE1BQU1BLEdBQVgsSUFBa0IwRyxNQUFsQixFQUEwQjtBQUN4QnlCLGNBQVF6QixPQUFPMUcsR0FBUCxDQUFSLEVBQXFCQSxHQUFyQjtBQUNEO0FBQ0QsU0FBSyxNQUFNQSxHQUFYLElBQWtCa0ksUUFBbEIsRUFBNEI7QUFDMUIsYUFBT3hCLE9BQU8xRyxHQUFQLENBQVA7QUFDRDtBQUNELFdBQU9pSSxHQUFQO0FBQ0Q7O0FBRUQ7QUFDQTtBQUNBRCx3QkFBc0J0RyxTQUF0QixFQUF5Q2MsUUFBekMsRUFBMkRrRSxNQUEzRCxFQUF3RXVCLEdBQXhFLEVBQWtGO0FBQ2hGLFFBQUlLLFVBQVUsRUFBZDtBQUNBOUYsZUFBV2tFLE9BQU9sRSxRQUFQLElBQW1CQSxRQUE5QjtBQUNBeUYsUUFBSTFILE9BQUosQ0FBWSxDQUFDLEVBQUNQLEdBQUQsRUFBTW9JLEVBQU4sRUFBRCxLQUFlO0FBQ3pCLFVBQUksQ0FBQ0EsRUFBTCxFQUFTO0FBQ1A7QUFDRDtBQUNELFVBQUlBLEdBQUcxRSxJQUFILElBQVcsYUFBZixFQUE4QjtBQUM1QixhQUFLLE1BQU0vQixNQUFYLElBQXFCeUcsR0FBR3JFLE9BQXhCLEVBQWlDO0FBQy9CdUUsa0JBQVExSSxJQUFSLENBQWEsS0FBSzJJLFdBQUwsQ0FBaUJ2SSxHQUFqQixFQUFzQjBCLFNBQXRCLEVBQ1hjLFFBRFcsRUFFWGIsT0FBT2EsUUFGSSxDQUFiO0FBR0Q7QUFDRjs7QUFFRCxVQUFJNEYsR0FBRzFFLElBQUgsSUFBVyxnQkFBZixFQUFpQztBQUMvQixhQUFLLE1BQU0vQixNQUFYLElBQXFCeUcsR0FBR3JFLE9BQXhCLEVBQWlDO0FBQy9CdUUsa0JBQVExSSxJQUFSLENBQWEsS0FBSzRJLGNBQUwsQ0FBb0J4SSxHQUFwQixFQUF5QjBCLFNBQXpCLEVBQ1hjLFFBRFcsRUFFWGIsT0FBT2EsUUFGSSxDQUFiO0FBR0Q7QUFDRjtBQUNGLEtBbkJEOztBQXFCQSxXQUFPZSxRQUFRa0YsR0FBUixDQUFZSCxPQUFaLENBQVA7QUFDRDs7QUFFRDtBQUNBO0FBQ0FDLGNBQVl2SSxHQUFaLEVBQXlCMEksYUFBekIsRUFBZ0RDLE1BQWhELEVBQWdFQyxJQUFoRSxFQUE4RTtBQUM1RSxVQUFNQyxNQUFNO0FBQ1ZqRSxpQkFBV2dFLElBREQ7QUFFVi9ELGdCQUFVOEQ7QUFGQSxLQUFaO0FBSUEsV0FBTyxLQUFLM0QsT0FBTCxDQUFhNkMsZUFBYixDQUE4QixTQUFRN0gsR0FBSSxJQUFHMEksYUFBYyxFQUEzRCxFQUE4RC9ELGNBQTlELEVBQThFa0UsR0FBOUUsRUFBbUZBLEdBQW5GLENBQVA7QUFDRDs7QUFFRDtBQUNBO0FBQ0E7QUFDQUwsaUJBQWV4SSxHQUFmLEVBQTRCMEksYUFBNUIsRUFBbURDLE1BQW5ELEVBQW1FQyxJQUFuRSxFQUFpRjtBQUMvRSxRQUFJQyxNQUFNO0FBQ1JqRSxpQkFBV2dFLElBREg7QUFFUi9ELGdCQUFVOEQ7QUFGRixLQUFWO0FBSUEsV0FBTyxLQUFLM0QsT0FBTCxDQUFhVSxvQkFBYixDQUFtQyxTQUFRMUYsR0FBSSxJQUFHMEksYUFBYyxFQUFoRSxFQUFtRS9ELGNBQW5FLEVBQW1Ga0UsR0FBbkYsRUFDSnpCLEtBREksQ0FDRUMsU0FBUztBQUNkO0FBQ0EsVUFBSUEsTUFBTXlCLElBQU4sSUFBYyxZQUFNM0ksS0FBTixDQUFZNEgsZ0JBQTlCLEVBQWdEO0FBQzlDO0FBQ0Q7QUFDRCxZQUFNVixLQUFOO0FBQ0QsS0FQSSxDQUFQO0FBUUQ7O0FBRUQ7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTBCLFVBQVFySCxTQUFSLEVBQTJCMUMsS0FBM0IsRUFBdUMsRUFBRUMsR0FBRixLQUF3QixFQUEvRCxFQUFpRjtBQUMvRSxVQUFNdUMsV0FBV3ZDLFFBQVFzSCxTQUF6QjtBQUNBLFVBQU05RSxXQUFXeEMsT0FBTyxFQUF4Qjs7QUFFQSxXQUFPLEtBQUtxRyxVQUFMLEdBQ0pDLElBREksQ0FDQ0Msb0JBQW9CO0FBQ3hCLGFBQU8sQ0FBQ2hFLFdBQVcrQixRQUFRQyxPQUFSLEVBQVgsR0FBK0JnQyxpQkFBaUJ5QixrQkFBakIsQ0FBb0N2RixTQUFwQyxFQUErQ0QsUUFBL0MsRUFBeUQsUUFBekQsQ0FBaEMsRUFDSjhELElBREksQ0FDQyxNQUFNO0FBQ1YsWUFBSSxDQUFDL0QsUUFBTCxFQUFlO0FBQ2J4QyxrQkFBUSxLQUFLbUkscUJBQUwsQ0FBMkIzQixnQkFBM0IsRUFBNkM5RCxTQUE3QyxFQUF3RCxRQUF4RCxFQUFrRTFDLEtBQWxFLEVBQXlFeUMsUUFBekUsQ0FBUjtBQUNBLGNBQUksQ0FBQ3pDLEtBQUwsRUFBWTtBQUNWLGtCQUFNLElBQUksWUFBTW1CLEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZNEgsZ0JBQTVCLEVBQThDLG1CQUE5QyxDQUFOO0FBQ0Q7QUFDRjtBQUNEO0FBQ0EsWUFBSTlJLEdBQUosRUFBUztBQUNQRCxrQkFBUUQsWUFBWUMsS0FBWixFQUFtQkMsR0FBbkIsQ0FBUjtBQUNEO0FBQ0RpQixzQkFBY2xCLEtBQWQ7QUFDQSxlQUFPd0csaUJBQWlCQyxZQUFqQixDQUE4Qi9ELFNBQTlCLEVBQ0owRixLQURJLENBQ0VDLFNBQVM7QUFDaEI7QUFDQTtBQUNFLGNBQUlBLFVBQVVkLFNBQWQsRUFBeUI7QUFDdkIsbUJBQU8sRUFBRWpDLFFBQVEsRUFBVixFQUFQO0FBQ0Q7QUFDRCxnQkFBTStDLEtBQU47QUFDRCxTQVJJLEVBU0o5QixJQVRJLENBU0N5RCxxQkFBcUIsS0FBS2hFLE9BQUwsQ0FBYVUsb0JBQWIsQ0FBa0NoRSxTQUFsQyxFQUE2Q3NILGlCQUE3QyxFQUFnRWhLLEtBQWhFLENBVHRCLEVBVUpvSSxLQVZJLENBVUVDLFNBQVM7QUFDaEI7QUFDRSxjQUFJM0YsY0FBYyxVQUFkLElBQTRCMkYsTUFBTXlCLElBQU4sS0FBZSxZQUFNM0ksS0FBTixDQUFZNEgsZ0JBQTNELEVBQTZFO0FBQzNFLG1CQUFPeEUsUUFBUUMsT0FBUixDQUFnQixFQUFoQixDQUFQO0FBQ0Q7QUFDRCxnQkFBTTZELEtBQU47QUFDRCxTQWhCSSxDQUFQO0FBaUJELE9BOUJJLENBQVA7QUErQkQsS0FqQ0ksQ0FBUDtBQWtDRDs7QUFFRDtBQUNBO0FBQ0E0QixTQUFPdkgsU0FBUCxFQUEwQkMsTUFBMUIsRUFBdUMsRUFBRTFDLEdBQUYsS0FBd0IsRUFBL0QsRUFBaUY7QUFDakY7QUFDRSxVQUFNb0UsaUJBQWlCMUIsTUFBdkI7QUFDQUEsYUFBU3BDLG1CQUFtQm9DLE1BQW5CLENBQVQ7O0FBRUFBLFdBQU91SCxTQUFQLEdBQW1CLEVBQUVDLEtBQUt4SCxPQUFPdUgsU0FBZCxFQUF5QkUsUUFBUSxNQUFqQyxFQUFuQjtBQUNBekgsV0FBTzBILFNBQVAsR0FBbUIsRUFBRUYsS0FBS3hILE9BQU8wSCxTQUFkLEVBQXlCRCxRQUFRLE1BQWpDLEVBQW5COztBQUVBLFFBQUk1SCxXQUFXdkMsUUFBUXNILFNBQXZCO0FBQ0EsUUFBSTlFLFdBQVd4QyxPQUFPLEVBQXRCO0FBQ0EsVUFBTStILGtCQUFrQixLQUFLRSxzQkFBTCxDQUE0QnhGLFNBQTVCLEVBQXVDLElBQXZDLEVBQTZDQyxNQUE3QyxDQUF4QjtBQUNBLFdBQU8sS0FBS2dFLGlCQUFMLENBQXVCakUsU0FBdkIsRUFDSjZELElBREksQ0FDQyxNQUFNLEtBQUtELFVBQUwsRUFEUCxFQUVKQyxJQUZJLENBRUNDLG9CQUFvQjtBQUN4QixhQUFPLENBQUNoRSxXQUFXK0IsUUFBUUMsT0FBUixFQUFYLEdBQStCZ0MsaUJBQWlCeUIsa0JBQWpCLENBQW9DdkYsU0FBcEMsRUFBK0NELFFBQS9DLEVBQXlELFFBQXpELENBQWhDLEVBQ0o4RCxJQURJLENBQ0MsTUFBTUMsaUJBQWlCOEQsa0JBQWpCLENBQW9DNUgsU0FBcEMsQ0FEUCxFQUVKNkQsSUFGSSxDQUVDLE1BQU1DLGlCQUFpQitELFVBQWpCLEVBRlAsRUFHSmhFLElBSEksQ0FHQyxNQUFNQyxpQkFBaUJDLFlBQWpCLENBQThCL0QsU0FBOUIsRUFBeUMsSUFBekMsQ0FIUCxFQUlKNkQsSUFKSSxDQUlDckIsVUFBVTtBQUNkRCwwQkFBa0J2QyxTQUFsQixFQUE2QkMsTUFBN0IsRUFBcUN1QyxNQUFyQztBQUNBTix3Q0FBZ0NqQyxNQUFoQztBQUNBLGVBQU8sS0FBS3FELE9BQUwsQ0FBYXdFLFlBQWIsQ0FBMEI5SCxTQUExQixFQUFxQzVDLGlCQUFpQjJLLDRCQUFqQixDQUE4Q3ZGLE1BQTlDLENBQXJDLEVBQTRGdkMsTUFBNUYsQ0FBUDtBQUNELE9BUkksRUFTSjRELElBVEksQ0FTQzlGLFVBQVU7QUFDZCxlQUFPLEtBQUt1SSxxQkFBTCxDQUEyQnRHLFNBQTNCLEVBQXNDQyxPQUFPYSxRQUE3QyxFQUF1RGIsTUFBdkQsRUFBK0RxRixlQUEvRCxFQUFnRnpCLElBQWhGLENBQXFGLE1BQU07QUFDaEcsaUJBQU9uQyx1QkFBdUJDLGNBQXZCLEVBQXVDNUQsT0FBT3dJLEdBQVAsQ0FBVyxDQUFYLENBQXZDLENBQVA7QUFDRCxTQUZNLENBQVA7QUFHRCxPQWJJLENBQVA7QUFjRCxLQWpCSSxDQUFQO0FBa0JEOztBQUVEeEIsY0FBWXZDLE1BQVosRUFBdUR4QyxTQUF2RCxFQUEwRUMsTUFBMUUsRUFBdUZGLFFBQXZGLEVBQTBIO0FBQ3hILFVBQU1pSSxjQUFjeEYsT0FBT3lGLElBQVAsQ0FBWWpJLFNBQVosQ0FBcEI7QUFDQSxRQUFJLENBQUNnSSxXQUFMLEVBQWtCO0FBQ2hCLGFBQU9uRyxRQUFRQyxPQUFSLEVBQVA7QUFDRDtBQUNELFVBQU1jLFNBQVM5RCxPQUFPQyxJQUFQLENBQVlrQixNQUFaLENBQWY7QUFDQSxVQUFNaUksZUFBZXBKLE9BQU9DLElBQVAsQ0FBWWlKLFdBQVosQ0FBckI7QUFDQSxVQUFNRyxVQUFVdkYsT0FBT3dGLE1BQVAsQ0FBZUMsS0FBRCxJQUFXO0FBQ3ZDO0FBQ0EsVUFBSXBJLE9BQU9vSSxLQUFQLEtBQWlCcEksT0FBT29JLEtBQVAsRUFBY3JHLElBQS9CLElBQXVDL0IsT0FBT29JLEtBQVAsRUFBY3JHLElBQWQsS0FBdUIsUUFBbEUsRUFBNEU7QUFDMUUsZUFBTyxLQUFQO0FBQ0Q7QUFDRCxhQUFPa0csYUFBYTNKLE9BQWIsQ0FBcUI4SixLQUFyQixJQUE4QixDQUFyQztBQUNELEtBTmUsQ0FBaEI7QUFPQSxRQUFJRixRQUFRM0ksTUFBUixHQUFpQixDQUFyQixFQUF3QjtBQUN0QixhQUFPZ0QsT0FBTytDLGtCQUFQLENBQTBCdkYsU0FBMUIsRUFBcUNELFFBQXJDLEVBQStDLFVBQS9DLENBQVA7QUFDRDtBQUNELFdBQU84QixRQUFRQyxPQUFSLEVBQVA7QUFDRDs7QUFFRDtBQUNBOzs7Ozs7QUFNQXdHLG1CQUFpQkMsT0FBZ0IsS0FBakMsRUFBc0Q7QUFDcEQsU0FBSy9FLGFBQUwsR0FBcUIsSUFBckI7QUFDQSxXQUFPM0IsUUFBUWtGLEdBQVIsQ0FBWSxDQUNqQixLQUFLekQsT0FBTCxDQUFha0YsZ0JBQWIsQ0FBOEJELElBQTlCLENBRGlCLEVBRWpCLEtBQUtoRixXQUFMLENBQWlCa0YsS0FBakIsRUFGaUIsQ0FBWixDQUFQO0FBSUQ7O0FBR0Q7QUFDQTtBQUNBQyxhQUFXMUksU0FBWCxFQUE4QjFCLEdBQTlCLEVBQTJDNkUsUUFBM0MsRUFBNkR3RixZQUE3RCxFQUFpSDtBQUMvRyxVQUFNLEVBQUVDLElBQUYsRUFBUUMsS0FBUixFQUFlQyxJQUFmLEtBQXdCSCxZQUE5QjtBQUNBLFVBQU1JLGNBQWMsRUFBcEI7QUFDQSxRQUFJRCxRQUFRQSxLQUFLdEIsU0FBYixJQUEwQixLQUFLbEUsT0FBTCxDQUFhMEYsbUJBQTNDLEVBQWdFO0FBQzlERCxrQkFBWUQsSUFBWixHQUFtQixFQUFFLE9BQVFBLEtBQUt0QixTQUFmLEVBQW5CO0FBQ0F1QixrQkFBWUYsS0FBWixHQUFvQkEsS0FBcEI7QUFDQUUsa0JBQVlILElBQVosR0FBbUJBLElBQW5CO0FBQ0FELG1CQUFhQyxJQUFiLEdBQW9CLENBQXBCO0FBQ0Q7QUFDRCxXQUFPLEtBQUt0RixPQUFMLENBQWEyRixJQUFiLENBQWtCaEgsY0FBY2pDLFNBQWQsRUFBeUIxQixHQUF6QixDQUFsQixFQUFpRDJFLGNBQWpELEVBQWlFLEVBQUVFLFFBQUYsRUFBakUsRUFBK0U0RixXQUEvRSxFQUNKbEYsSUFESSxDQUNDcUYsV0FBV0EsUUFBUUMsR0FBUixDQUFZcEwsVUFBVUEsT0FBT21GLFNBQTdCLENBRFosQ0FBUDtBQUVEOztBQUVEO0FBQ0E7QUFDQWtHLFlBQVVwSixTQUFWLEVBQTZCMUIsR0FBN0IsRUFBMENvSyxVQUExQyxFQUFtRjtBQUNqRixXQUFPLEtBQUtwRixPQUFMLENBQWEyRixJQUFiLENBQWtCaEgsY0FBY2pDLFNBQWQsRUFBeUIxQixHQUF6QixDQUFsQixFQUFpRDJFLGNBQWpELEVBQWlFLEVBQUVDLFdBQVcsRUFBRSxPQUFPd0YsVUFBVCxFQUFiLEVBQWpFLEVBQXVHLEVBQXZHLEVBQ0o3RSxJQURJLENBQ0NxRixXQUFXQSxRQUFRQyxHQUFSLENBQVlwTCxVQUFVQSxPQUFPb0YsUUFBN0IsQ0FEWixDQUFQO0FBRUQ7O0FBRUQ7QUFDQTtBQUNBO0FBQ0FrRyxtQkFBaUJySixTQUFqQixFQUFvQzFDLEtBQXBDLEVBQWdEa0YsTUFBaEQsRUFBMkU7QUFDM0U7QUFDQTtBQUNFLFFBQUlsRixNQUFNLEtBQU4sQ0FBSixFQUFrQjtBQUNoQixZQUFNZ00sTUFBTWhNLE1BQU0sS0FBTixDQUFaO0FBQ0EsYUFBT3VFLFFBQVFrRixHQUFSLENBQVl1QyxJQUFJSCxHQUFKLENBQVEsQ0FBQ0ksTUFBRCxFQUFTQyxLQUFULEtBQW1CO0FBQzVDLGVBQU8sS0FBS0gsZ0JBQUwsQ0FBc0JySixTQUF0QixFQUFpQ3VKLE1BQWpDLEVBQXlDL0csTUFBekMsRUFBaURxQixJQUFqRCxDQUF1RDBGLE1BQUQsSUFBWTtBQUN2RWpNLGdCQUFNLEtBQU4sRUFBYWtNLEtBQWIsSUFBc0JELE1BQXRCO0FBQ0QsU0FGTSxDQUFQO0FBR0QsT0FKa0IsQ0FBWixFQUlIMUYsSUFKRyxDQUlFLE1BQU07QUFDYixlQUFPaEMsUUFBUUMsT0FBUixDQUFnQnhFLEtBQWhCLENBQVA7QUFDRCxPQU5NLENBQVA7QUFPRDs7QUFFRCxVQUFNbU0sV0FBVzNLLE9BQU9DLElBQVAsQ0FBWXpCLEtBQVosRUFBbUI2TCxHQUFuQixDQUF3QjdLLEdBQUQsSUFBUztBQUMvQyxZQUFNbUcsSUFBSWpDLE9BQU9rQyxlQUFQLENBQXVCMUUsU0FBdkIsRUFBa0MxQixHQUFsQyxDQUFWO0FBQ0EsVUFBSSxDQUFDbUcsQ0FBRCxJQUFNQSxFQUFFNUIsSUFBRixLQUFXLFVBQXJCLEVBQWlDO0FBQy9CLGVBQU9oQixRQUFRQyxPQUFSLENBQWdCeEUsS0FBaEIsQ0FBUDtBQUNEO0FBQ0QsVUFBSW9NLFVBQWtCLElBQXRCO0FBQ0EsVUFBSXBNLE1BQU1nQixHQUFOLE1BQWVoQixNQUFNZ0IsR0FBTixFQUFXLEtBQVgsS0FBcUJoQixNQUFNZ0IsR0FBTixFQUFXLEtBQVgsQ0FBckIsSUFBMENoQixNQUFNZ0IsR0FBTixFQUFXLE1BQVgsQ0FBMUMsSUFBZ0VoQixNQUFNZ0IsR0FBTixFQUFXb0osTUFBWCxJQUFxQixTQUFwRyxDQUFKLEVBQW9IO0FBQ3BIO0FBQ0VnQyxrQkFBVTVLLE9BQU9DLElBQVAsQ0FBWXpCLE1BQU1nQixHQUFOLENBQVosRUFBd0I2SyxHQUF4QixDQUE2QlEsYUFBRCxJQUFtQjtBQUN2RCxjQUFJakIsVUFBSjtBQUNBLGNBQUlrQixhQUFhLEtBQWpCO0FBQ0EsY0FBSUQsa0JBQWtCLFVBQXRCLEVBQWtDO0FBQ2hDakIseUJBQWEsQ0FBQ3BMLE1BQU1nQixHQUFOLEVBQVd3QyxRQUFaLENBQWI7QUFDRCxXQUZELE1BRU8sSUFBSTZJLGlCQUFpQixLQUFyQixFQUE0QjtBQUNqQ2pCLHlCQUFhcEwsTUFBTWdCLEdBQU4sRUFBVyxLQUFYLEVBQWtCNkssR0FBbEIsQ0FBc0JVLEtBQUtBLEVBQUUvSSxRQUE3QixDQUFiO0FBQ0QsV0FGTSxNQUVBLElBQUk2SSxpQkFBaUIsTUFBckIsRUFBNkI7QUFDbENDLHlCQUFhLElBQWI7QUFDQWxCLHlCQUFhcEwsTUFBTWdCLEdBQU4sRUFBVyxNQUFYLEVBQW1CNkssR0FBbkIsQ0FBdUJVLEtBQUtBLEVBQUUvSSxRQUE5QixDQUFiO0FBQ0QsV0FITSxNQUdBLElBQUk2SSxpQkFBaUIsS0FBckIsRUFBNEI7QUFDakNDLHlCQUFhLElBQWI7QUFDQWxCLHlCQUFhLENBQUNwTCxNQUFNZ0IsR0FBTixFQUFXLEtBQVgsRUFBa0J3QyxRQUFuQixDQUFiO0FBQ0QsV0FITSxNQUdBO0FBQ0w7QUFDRDtBQUNELGlCQUFPO0FBQ0w4SSxzQkFESztBQUVMbEI7QUFGSyxXQUFQO0FBSUQsU0FwQlMsQ0FBVjtBQXFCRCxPQXZCRCxNQXVCTztBQUNMZ0Isa0JBQVUsQ0FBQyxFQUFDRSxZQUFZLEtBQWIsRUFBb0JsQixZQUFZLEVBQWhDLEVBQUQsQ0FBVjtBQUNEOztBQUVEO0FBQ0EsYUFBT3BMLE1BQU1nQixHQUFOLENBQVA7QUFDQTtBQUNBO0FBQ0EsWUFBTW1MLFdBQVdDLFFBQVFQLEdBQVIsQ0FBYVcsQ0FBRCxJQUFPO0FBQ2xDLFlBQUksQ0FBQ0EsQ0FBTCxFQUFRO0FBQ04saUJBQU9qSSxRQUFRQyxPQUFSLEVBQVA7QUFDRDtBQUNELGVBQU8sS0FBS3NILFNBQUwsQ0FBZXBKLFNBQWYsRUFBMEIxQixHQUExQixFQUErQndMLEVBQUVwQixVQUFqQyxFQUE2QzdFLElBQTdDLENBQW1Ea0csR0FBRCxJQUFTO0FBQ2hFLGNBQUlELEVBQUVGLFVBQU4sRUFBa0I7QUFDaEIsaUJBQUtJLG9CQUFMLENBQTBCRCxHQUExQixFQUErQnpNLEtBQS9CO0FBQ0QsV0FGRCxNQUVPO0FBQ0wsaUJBQUsyTSxpQkFBTCxDQUF1QkYsR0FBdkIsRUFBNEJ6TSxLQUE1QjtBQUNEO0FBQ0QsaUJBQU91RSxRQUFRQyxPQUFSLEVBQVA7QUFDRCxTQVBNLENBQVA7QUFRRCxPQVpnQixDQUFqQjs7QUFjQSxhQUFPRCxRQUFRa0YsR0FBUixDQUFZMEMsUUFBWixFQUFzQjVGLElBQXRCLENBQTJCLE1BQU07QUFDdEMsZUFBT2hDLFFBQVFDLE9BQVIsRUFBUDtBQUNELE9BRk0sQ0FBUDtBQUlELEtBdkRnQixDQUFqQjs7QUF5REEsV0FBT0QsUUFBUWtGLEdBQVIsQ0FBWTBDLFFBQVosRUFBc0I1RixJQUF0QixDQUEyQixNQUFNO0FBQ3RDLGFBQU9oQyxRQUFRQyxPQUFSLENBQWdCeEUsS0FBaEIsQ0FBUDtBQUNELEtBRk0sQ0FBUDtBQUdEOztBQUVEO0FBQ0E7QUFDQTRNLHFCQUFtQmxLLFNBQW5CLEVBQXNDMUMsS0FBdEMsRUFBa0RxTCxZQUFsRCxFQUFxRjs7QUFFbkYsUUFBSXJMLE1BQU0sS0FBTixDQUFKLEVBQWtCO0FBQ2hCLGFBQU91RSxRQUFRa0YsR0FBUixDQUFZekosTUFBTSxLQUFOLEVBQWE2TCxHQUFiLENBQWtCSSxNQUFELElBQVk7QUFDOUMsZUFBTyxLQUFLVyxrQkFBTCxDQUF3QmxLLFNBQXhCLEVBQW1DdUosTUFBbkMsRUFBMkNaLFlBQTNDLENBQVA7QUFDRCxPQUZrQixDQUFaLENBQVA7QUFHRDs7QUFFRCxRQUFJd0IsWUFBWTdNLE1BQU0sWUFBTixDQUFoQjtBQUNBLFFBQUk2TSxTQUFKLEVBQWU7QUFDYixhQUFPLEtBQUt6QixVQUFMLENBQ0x5QixVQUFVbEssTUFBVixDQUFpQkQsU0FEWixFQUVMbUssVUFBVTdMLEdBRkwsRUFHTDZMLFVBQVVsSyxNQUFWLENBQWlCYSxRQUhaLEVBSUw2SCxZQUpLLEVBS0o5RSxJQUxJLENBS0VrRyxHQUFELElBQVM7QUFDYixlQUFPek0sTUFBTSxZQUFOLENBQVA7QUFDQSxhQUFLMk0saUJBQUwsQ0FBdUJGLEdBQXZCLEVBQTRCek0sS0FBNUI7QUFDQSxlQUFPLEtBQUs0TSxrQkFBTCxDQUF3QmxLLFNBQXhCLEVBQW1DMUMsS0FBbkMsRUFBMENxTCxZQUExQyxDQUFQO0FBQ0QsT0FUSSxFQVNGOUUsSUFURSxDQVNHLE1BQU0sQ0FBRSxDQVRYLENBQVA7QUFVRDtBQUNGOztBQUVEb0csb0JBQWtCRixNQUFzQixJQUF4QyxFQUE4Q3pNLEtBQTlDLEVBQTBEO0FBQ3hELFVBQU04TSxnQkFBZ0MsT0FBTzlNLE1BQU13RCxRQUFiLEtBQTBCLFFBQTFCLEdBQXFDLENBQUN4RCxNQUFNd0QsUUFBUCxDQUFyQyxHQUF3RCxJQUE5RjtBQUNBLFVBQU11SixZQUE0Qi9NLE1BQU13RCxRQUFOLElBQWtCeEQsTUFBTXdELFFBQU4sQ0FBZSxLQUFmLENBQWxCLEdBQTBDLENBQUN4RCxNQUFNd0QsUUFBTixDQUFlLEtBQWYsQ0FBRCxDQUExQyxHQUFvRSxJQUF0RztBQUNBLFVBQU13SixZQUE0QmhOLE1BQU13RCxRQUFOLElBQWtCeEQsTUFBTXdELFFBQU4sQ0FBZSxLQUFmLENBQWxCLEdBQTBDeEQsTUFBTXdELFFBQU4sQ0FBZSxLQUFmLENBQTFDLEdBQWtFLElBQXBHOztBQUVBO0FBQ0EsVUFBTXlKLFNBQStCLENBQUNILGFBQUQsRUFBZ0JDLFNBQWhCLEVBQTJCQyxTQUEzQixFQUFzQ1AsR0FBdEMsRUFBMkMzQixNQUEzQyxDQUFrRG9DLFFBQVFBLFNBQVMsSUFBbkUsQ0FBckM7QUFDQSxVQUFNQyxjQUFjRixPQUFPRyxNQUFQLENBQWMsQ0FBQ0MsSUFBRCxFQUFPSCxJQUFQLEtBQWdCRyxPQUFPSCxLQUFLaEwsTUFBMUMsRUFBa0QsQ0FBbEQsQ0FBcEI7O0FBRUEsUUFBSW9MLGtCQUFrQixFQUF0QjtBQUNBLFFBQUlILGNBQWMsR0FBbEIsRUFBdUI7QUFDckJHLHdCQUFrQixvQkFBVUMsR0FBVixDQUFjTixNQUFkLENBQWxCO0FBQ0QsS0FGRCxNQUVPO0FBQ0xLLHdCQUFrQix5QkFBVUwsTUFBVixDQUFsQjtBQUNEOztBQUVEO0FBQ0EsUUFBSSxFQUFFLGNBQWNqTixLQUFoQixDQUFKLEVBQTRCO0FBQzFCQSxZQUFNd0QsUUFBTixHQUFpQjtBQUNmZ0ssYUFBS2pHO0FBRFUsT0FBakI7QUFHRCxLQUpELE1BSU8sSUFBSSxPQUFPdkgsTUFBTXdELFFBQWIsS0FBMEIsUUFBOUIsRUFBd0M7QUFDN0N4RCxZQUFNd0QsUUFBTixHQUFpQjtBQUNmZ0ssYUFBS2pHLFNBRFU7QUFFZmtHLGFBQUt6TixNQUFNd0Q7QUFGSSxPQUFqQjtBQUlEO0FBQ0R4RCxVQUFNd0QsUUFBTixDQUFlLEtBQWYsSUFBd0I4SixlQUF4Qjs7QUFFQSxXQUFPdE4sS0FBUDtBQUNEOztBQUVEME0sdUJBQXFCRCxNQUFnQixFQUFyQyxFQUF5Q3pNLEtBQXpDLEVBQXFEO0FBQ25ELFVBQU0wTixhQUFhMU4sTUFBTXdELFFBQU4sSUFBa0J4RCxNQUFNd0QsUUFBTixDQUFlLE1BQWYsQ0FBbEIsR0FBMkN4RCxNQUFNd0QsUUFBTixDQUFlLE1BQWYsQ0FBM0MsR0FBb0UsRUFBdkY7QUFDQSxRQUFJeUosU0FBUyxDQUFDLEdBQUdTLFVBQUosRUFBZSxHQUFHakIsR0FBbEIsRUFBdUIzQixNQUF2QixDQUE4Qm9DLFFBQVFBLFNBQVMsSUFBL0MsQ0FBYjs7QUFFQTtBQUNBRCxhQUFTLENBQUMsR0FBRyxJQUFJVSxHQUFKLENBQVFWLE1BQVIsQ0FBSixDQUFUOztBQUVBO0FBQ0EsUUFBSSxFQUFFLGNBQWNqTixLQUFoQixDQUFKLEVBQTRCO0FBQzFCQSxZQUFNd0QsUUFBTixHQUFpQjtBQUNmb0ssY0FBTXJHO0FBRFMsT0FBakI7QUFHRCxLQUpELE1BSU8sSUFBSSxPQUFPdkgsTUFBTXdELFFBQWIsS0FBMEIsUUFBOUIsRUFBd0M7QUFDN0N4RCxZQUFNd0QsUUFBTixHQUFpQjtBQUNmb0ssY0FBTXJHLFNBRFM7QUFFZmtHLGFBQUt6TixNQUFNd0Q7QUFGSSxPQUFqQjtBQUlEOztBQUVEeEQsVUFBTXdELFFBQU4sQ0FBZSxNQUFmLElBQXlCeUosTUFBekI7QUFDQSxXQUFPak4sS0FBUDtBQUNEOztBQUVEO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTJMLE9BQUtqSixTQUFMLEVBQXdCMUMsS0FBeEIsRUFBb0M7QUFDbENzTCxRQURrQztBQUVsQ0MsU0FGa0M7QUFHbEN0TCxPQUhrQztBQUlsQ3VMLFdBQU8sRUFKMkI7QUFLbENxQyxTQUxrQztBQU1sQ3BNLFFBTmtDO0FBT2xDMkgsTUFQa0M7QUFRbEMwRSxZQVJrQztBQVNsQ0MsWUFUa0M7QUFVbENDLGtCQVZrQztBQVdsQ0M7QUFYa0MsTUFZM0IsRUFaVCxFQVkyQjtBQUN6QixVQUFNekwsV0FBV3ZDLFFBQVFzSCxTQUF6QjtBQUNBLFVBQU05RSxXQUFXeEMsT0FBTyxFQUF4QjtBQUNBbUosU0FBS0EsT0FBTyxPQUFPcEosTUFBTXdELFFBQWIsSUFBeUIsUUFBekIsSUFBcUNoQyxPQUFPQyxJQUFQLENBQVl6QixLQUFaLEVBQW1Ca0MsTUFBbkIsS0FBOEIsQ0FBbkUsR0FBdUUsS0FBdkUsR0FBK0UsTUFBdEYsQ0FBTDtBQUNBO0FBQ0FrSCxTQUFNeUUsVUFBVSxJQUFWLEdBQWlCLE9BQWpCLEdBQTJCekUsRUFBakM7O0FBRUEsUUFBSWhELGNBQWMsSUFBbEI7QUFDQSxXQUFPLEtBQUtFLFVBQUwsR0FDSkMsSUFESSxDQUNDQyxvQkFBb0I7QUFDeEI7QUFDQTtBQUNBO0FBQ0EsYUFBT0EsaUJBQWlCQyxZQUFqQixDQUE4Qi9ELFNBQTlCLEVBQXlDRixRQUF6QyxFQUNKNEYsS0FESSxDQUNFQyxTQUFTO0FBQ2hCO0FBQ0E7QUFDRSxZQUFJQSxVQUFVZCxTQUFkLEVBQXlCO0FBQ3ZCbkIsd0JBQWMsS0FBZDtBQUNBLGlCQUFPLEVBQUVkLFFBQVEsRUFBVixFQUFQO0FBQ0Q7QUFDRCxjQUFNK0MsS0FBTjtBQUNELE9BVEksRUFVSjlCLElBVkksQ0FVQ3JCLFVBQVU7QUFDaEI7QUFDQTtBQUNBO0FBQ0UsWUFBSXNHLEtBQUswQyxXQUFULEVBQXNCO0FBQ3BCMUMsZUFBS3RCLFNBQUwsR0FBaUJzQixLQUFLMEMsV0FBdEI7QUFDQSxpQkFBTzFDLEtBQUswQyxXQUFaO0FBQ0Q7QUFDRCxZQUFJMUMsS0FBSzJDLFdBQVQsRUFBc0I7QUFDcEIzQyxlQUFLbkIsU0FBTCxHQUFpQm1CLEtBQUsyQyxXQUF0QjtBQUNBLGlCQUFPM0MsS0FBSzJDLFdBQVo7QUFDRDtBQUNELGNBQU05QyxlQUFlLEVBQUVDLElBQUYsRUFBUUMsS0FBUixFQUFlQyxJQUFmLEVBQXFCL0osSUFBckIsRUFBMkJ1TSxjQUEzQixFQUFyQjtBQUNBeE0sZUFBT0MsSUFBUCxDQUFZK0osSUFBWixFQUFrQmpLLE9BQWxCLENBQTBCOEQsYUFBYTtBQUNyQyxjQUFJQSxVQUFVaEQsS0FBVixDQUFnQixpQ0FBaEIsQ0FBSixFQUF3RDtBQUN0RCxrQkFBTSxJQUFJLFlBQU1sQixLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWW1CLGdCQUE1QixFQUErQyxrQkFBaUIrQyxTQUFVLEVBQTFFLENBQU47QUFDRDtBQUNELGdCQUFNaUQsZ0JBQWdCNUMsaUJBQWlCTCxTQUFqQixDQUF0QjtBQUNBLGNBQUksQ0FBQ3ZGLGlCQUFpQnlJLGdCQUFqQixDQUFrQ0QsYUFBbEMsQ0FBTCxFQUF1RDtBQUNyRCxrQkFBTSxJQUFJLFlBQU1uSCxLQUFWLENBQWdCLFlBQU1BLEtBQU4sQ0FBWW1CLGdCQUE1QixFQUErQyx1QkFBc0IrQyxTQUFVLEdBQS9FLENBQU47QUFDRDtBQUNGLFNBUkQ7QUFTQSxlQUFPLENBQUM3QyxXQUFXK0IsUUFBUUMsT0FBUixFQUFYLEdBQStCZ0MsaUJBQWlCeUIsa0JBQWpCLENBQW9DdkYsU0FBcEMsRUFBK0NELFFBQS9DLEVBQXlEMkcsRUFBekQsQ0FBaEMsRUFDSjdDLElBREksQ0FDQyxNQUFNLEtBQUtxRyxrQkFBTCxDQUF3QmxLLFNBQXhCLEVBQW1DMUMsS0FBbkMsRUFBMENxTCxZQUExQyxDQURQLEVBRUo5RSxJQUZJLENBRUMsTUFBTSxLQUFLd0YsZ0JBQUwsQ0FBc0JySixTQUF0QixFQUFpQzFDLEtBQWpDLEVBQXdDd0csZ0JBQXhDLENBRlAsRUFHSkQsSUFISSxDQUdDLE1BQU07QUFDVixjQUFJLENBQUMvRCxRQUFMLEVBQWU7QUFDYnhDLG9CQUFRLEtBQUttSSxxQkFBTCxDQUEyQjNCLGdCQUEzQixFQUE2QzlELFNBQTdDLEVBQXdEMEcsRUFBeEQsRUFBNERwSixLQUE1RCxFQUFtRXlDLFFBQW5FLENBQVI7QUFDRDtBQUNELGNBQUksQ0FBQ3pDLEtBQUwsRUFBWTtBQUNWLGdCQUFJb0osTUFBTSxLQUFWLEVBQWlCO0FBQ2Ysb0JBQU0sSUFBSSxZQUFNakksS0FBVixDQUFnQixZQUFNQSxLQUFOLENBQVk0SCxnQkFBNUIsRUFBOEMsbUJBQTlDLENBQU47QUFDRCxhQUZELE1BRU87QUFDTCxxQkFBTyxFQUFQO0FBQ0Q7QUFDRjtBQUNELGNBQUksQ0FBQ3ZHLFFBQUwsRUFBZTtBQUNiLGdCQUFJeUwsT0FBSixFQUFhO0FBQ1hqTyxzQkFBUUQsWUFBWUMsS0FBWixFQUFtQnlDLFFBQW5CLENBQVI7QUFDRCxhQUZELE1BRU87QUFDTHpDLHNCQUFRSyxXQUFXTCxLQUFYLEVBQWtCeUMsUUFBbEIsQ0FBUjtBQUNEO0FBQ0Y7QUFDRHZCLHdCQUFjbEIsS0FBZDtBQUNBLGNBQUk2TixLQUFKLEVBQVc7QUFDVCxnQkFBSSxDQUFDekgsV0FBTCxFQUFrQjtBQUNoQixxQkFBTyxDQUFQO0FBQ0QsYUFGRCxNQUVPO0FBQ0wscUJBQU8sS0FBS0osT0FBTCxDQUFhNkgsS0FBYixDQUFtQm5MLFNBQW5CLEVBQThCd0MsTUFBOUIsRUFBc0NsRixLQUF0QyxFQUE2Q2dPLGNBQTdDLENBQVA7QUFDRDtBQUNGLFdBTkQsTUFNUSxJQUFJRixRQUFKLEVBQWM7QUFDcEIsZ0JBQUksQ0FBQzFILFdBQUwsRUFBa0I7QUFDaEIscUJBQU8sRUFBUDtBQUNELGFBRkQsTUFFTztBQUNMLHFCQUFPLEtBQUtKLE9BQUwsQ0FBYThILFFBQWIsQ0FBc0JwTCxTQUF0QixFQUFpQ3dDLE1BQWpDLEVBQXlDbEYsS0FBekMsRUFBZ0Q4TixRQUFoRCxDQUFQO0FBQ0Q7QUFDRixXQU5PLE1BTUEsSUFBSUMsUUFBSixFQUFjO0FBQ3BCLGdCQUFJLENBQUMzSCxXQUFMLEVBQWtCO0FBQ2hCLHFCQUFPLEVBQVA7QUFDRCxhQUZELE1BRU87QUFDTCxxQkFBTyxLQUFLSixPQUFMLENBQWFvSSxTQUFiLENBQXVCMUwsU0FBdkIsRUFBa0N3QyxNQUFsQyxFQUEwQzZJLFFBQTFDLEVBQW9EQyxjQUFwRCxDQUFQO0FBQ0Q7QUFDRixXQU5PLE1BTUQ7QUFDTCxtQkFBTyxLQUFLaEksT0FBTCxDQUFhMkYsSUFBYixDQUFrQmpKLFNBQWxCLEVBQTZCd0MsTUFBN0IsRUFBcUNsRixLQUFyQyxFQUE0Q3FMLFlBQTVDLEVBQ0o5RSxJQURJLENBQ0N4QixXQUFXQSxRQUFROEcsR0FBUixDQUFZbEosVUFBVTtBQUNyQ0EsdUJBQVM2QyxxQkFBcUI3QyxNQUFyQixDQUFUO0FBQ0EscUJBQU9KLG9CQUFvQkMsUUFBcEIsRUFBOEJDLFFBQTlCLEVBQXdDQyxTQUF4QyxFQUFtREMsTUFBbkQsQ0FBUDtBQUNELGFBSGdCLENBRFosRUFJRHlGLEtBSkMsQ0FJTUMsS0FBRCxJQUFXO0FBQ25CLG9CQUFNLElBQUksWUFBTWxILEtBQVYsQ0FBZ0IsWUFBTUEsS0FBTixDQUFZa04scUJBQTVCLEVBQW1EaEcsS0FBbkQsQ0FBTjtBQUNELGFBTkksQ0FBUDtBQU9EO0FBQ0YsU0FqREksQ0FBUDtBQWtERCxPQWxGSSxDQUFQO0FBbUZELEtBeEZJLENBQVA7QUF5RkQ7O0FBRURpRyxlQUFhNUwsU0FBYixFQUErQztBQUM3QyxXQUFPLEtBQUs0RCxVQUFMLENBQWdCLEVBQUVVLFlBQVksSUFBZCxFQUFoQixFQUNKVCxJQURJLENBQ0NDLG9CQUFvQkEsaUJBQWlCQyxZQUFqQixDQUE4Qi9ELFNBQTlCLEVBQXlDLElBQXpDLENBRHJCLEVBRUowRixLQUZJLENBRUVDLFNBQVM7QUFDZCxVQUFJQSxVQUFVZCxTQUFkLEVBQXlCO0FBQ3ZCLGVBQU8sRUFBRWpDLFFBQVEsRUFBVixFQUFQO0FBQ0QsT0FGRCxNQUVPO0FBQ0wsY0FBTStDLEtBQU47QUFDRDtBQUNGLEtBUkksRUFTSjlCLElBVEksQ0FTRXJCLE1BQUQsSUFBaUI7QUFDckIsYUFBTyxLQUFLaUIsZ0JBQUwsQ0FBc0J6RCxTQUF0QixFQUNKNkQsSUFESSxDQUNDLE1BQU0sS0FBS1AsT0FBTCxDQUFhNkgsS0FBYixDQUFtQm5MLFNBQW5CLEVBQThCLEVBQUU0QyxRQUFRLEVBQVYsRUFBOUIsQ0FEUCxFQUVKaUIsSUFGSSxDQUVDc0gsU0FBUztBQUNiLFlBQUlBLFFBQVEsQ0FBWixFQUFlO0FBQ2IsZ0JBQU0sSUFBSSxZQUFNMU0sS0FBVixDQUFnQixHQUFoQixFQUFzQixTQUFRdUIsU0FBVSwyQkFBMEJtTCxLQUFNLCtCQUF4RSxDQUFOO0FBQ0Q7QUFDRCxlQUFPLEtBQUs3SCxPQUFMLENBQWF1SSxXQUFiLENBQXlCN0wsU0FBekIsQ0FBUDtBQUNELE9BUEksRUFRSjZELElBUkksQ0FRQ2lJLHNCQUFzQjtBQUMxQixZQUFJQSxrQkFBSixFQUF3QjtBQUN0QixnQkFBTUMscUJBQXFCak4sT0FBT0MsSUFBUCxDQUFZeUQsT0FBT0ksTUFBbkIsRUFBMkJ3RixNQUEzQixDQUFrQ3pGLGFBQWFILE9BQU9JLE1BQVAsQ0FBY0QsU0FBZCxFQUF5QkUsSUFBekIsS0FBa0MsVUFBakYsQ0FBM0I7QUFDQSxpQkFBT2hCLFFBQVFrRixHQUFSLENBQVlnRixtQkFBbUI1QyxHQUFuQixDQUF1QjZDLFFBQVEsS0FBSzFJLE9BQUwsQ0FBYXVJLFdBQWIsQ0FBeUI1SixjQUFjakMsU0FBZCxFQUF5QmdNLElBQXpCLENBQXpCLENBQS9CLENBQVosRUFBc0duSSxJQUF0RyxDQUEyRyxNQUFNO0FBQ3RIO0FBQ0QsV0FGTSxDQUFQO0FBR0QsU0FMRCxNQUtPO0FBQ0wsaUJBQU9oQyxRQUFRQyxPQUFSLEVBQVA7QUFDRDtBQUNGLE9BakJJLENBQVA7QUFrQkQsS0E1QkksQ0FBUDtBQTZCRDs7QUFFRDJELHdCQUFzQmpELE1BQXRCLEVBQW1DeEMsU0FBbkMsRUFBc0RpTSxTQUF0RCxFQUF5RTNPLEtBQXpFLEVBQXFGeUMsV0FBa0IsRUFBdkcsRUFBMkc7QUFDM0c7QUFDQTtBQUNFLFFBQUl5QyxPQUFPMEosV0FBUCxDQUFtQmxNLFNBQW5CLEVBQThCRCxRQUE5QixFQUF3Q2tNLFNBQXhDLENBQUosRUFBd0Q7QUFDdEQsYUFBTzNPLEtBQVA7QUFDRDtBQUNELFVBQU02TyxRQUFRM0osT0FBTzJKLEtBQVAsQ0FBYW5NLFNBQWIsQ0FBZDtBQUNBLFVBQU1xSSxRQUFRLENBQUMsS0FBRCxFQUFRLE1BQVIsRUFBZ0I5SixPQUFoQixDQUF3QjBOLFNBQXhCLElBQXFDLENBQUMsQ0FBdEMsR0FBMEMsZ0JBQTFDLEdBQTZELGlCQUEzRTtBQUNBLFVBQU1HLFVBQVVyTSxTQUFTcUksTUFBVCxDQUFpQjdLLEdBQUQsSUFBUztBQUN2QyxhQUFPQSxJQUFJZ0IsT0FBSixDQUFZLE9BQVosS0FBd0IsQ0FBeEIsSUFBNkJoQixPQUFPLEdBQTNDO0FBQ0QsS0FGZSxDQUFoQjtBQUdBO0FBQ0EsUUFBSTRPLFNBQVNBLE1BQU05RCxLQUFOLENBQVQsSUFBeUI4RCxNQUFNOUQsS0FBTixFQUFhN0ksTUFBYixHQUFzQixDQUFuRCxFQUFzRDtBQUN0RDtBQUNBO0FBQ0UsVUFBSTRNLFFBQVE1TSxNQUFSLElBQWtCLENBQXRCLEVBQXlCO0FBQ3ZCO0FBQ0Q7QUFDRCxZQUFNNk0sU0FBU0QsUUFBUSxDQUFSLENBQWY7QUFDQSxZQUFNRSxjQUFlO0FBQ25CLGtCQUFVLFNBRFM7QUFFbkIscUJBQWEsT0FGTTtBQUduQixvQkFBWUQ7QUFITyxPQUFyQjs7QUFNQSxZQUFNRSxhQUFhSixNQUFNOUQsS0FBTixDQUFuQjtBQUNBLFlBQU1pQixNQUFNaUQsV0FBV3BELEdBQVgsQ0FBZ0I3SyxHQUFELElBQVM7QUFDbEMsY0FBTXdMLElBQUk7QUFDUixXQUFDeEwsR0FBRCxHQUFPZ087QUFEQyxTQUFWO0FBR0E7QUFDQSxZQUFJaFAsTUFBTTZCLGNBQU4sQ0FBcUJiLEdBQXJCLENBQUosRUFBK0I7QUFDN0IsaUJBQU8sRUFBQyxRQUFRLENBQUN3TCxDQUFELEVBQUl4TSxLQUFKLENBQVQsRUFBUDtBQUNEO0FBQ0Q7QUFDQSxlQUFPd0IsT0FBTzBOLE1BQVAsQ0FBYyxFQUFkLEVBQWtCbFAsS0FBbEIsRUFBeUI7QUFDOUIsV0FBRSxHQUFFZ0IsR0FBSSxFQUFSLEdBQVlnTztBQURrQixTQUF6QixDQUFQO0FBR0QsT0FaVyxDQUFaO0FBYUEsVUFBSWhELElBQUk5SixNQUFKLEdBQWEsQ0FBakIsRUFBb0I7QUFDbEIsZUFBTyxFQUFDLE9BQU84SixHQUFSLEVBQVA7QUFDRDtBQUNELGFBQU9BLElBQUksQ0FBSixDQUFQO0FBQ0QsS0EvQkQsTUErQk87QUFDTCxhQUFPaE0sS0FBUDtBQUNEO0FBQ0Y7O0FBRUQ7QUFDQTtBQUNBbVAsMEJBQXdCO0FBQ3RCLFVBQU1DLHFCQUFxQixFQUFFOUoscUJBQWF4RixpQkFBaUJ1UCxjQUFqQixDQUFnQ0MsUUFBN0MsRUFBMER4UCxpQkFBaUJ1UCxjQUFqQixDQUFnQ0UsS0FBMUYsQ0FBRixFQUEzQjtBQUNBLFVBQU1DLHFCQUFxQixFQUFFbEsscUJBQWF4RixpQkFBaUJ1UCxjQUFqQixDQUFnQ0MsUUFBN0MsRUFBMER4UCxpQkFBaUJ1UCxjQUFqQixDQUFnQ0ksS0FBMUYsQ0FBRixFQUEzQjs7QUFFQSxVQUFNQyxtQkFBbUIsS0FBS3BKLFVBQUwsR0FDdEJDLElBRHNCLENBQ2pCckIsVUFBVUEsT0FBT29GLGtCQUFQLENBQTBCLE9BQTFCLENBRE8sQ0FBekI7QUFFQSxVQUFNcUYsbUJBQW1CLEtBQUtySixVQUFMLEdBQ3RCQyxJQURzQixDQUNqQnJCLFVBQVVBLE9BQU9vRixrQkFBUCxDQUEwQixPQUExQixDQURPLENBQXpCOztBQUdBLFVBQU1zRixxQkFBcUJGLGlCQUN4Qm5KLElBRHdCLENBQ25CLE1BQU0sS0FBS1AsT0FBTCxDQUFhNkosZ0JBQWIsQ0FBOEIsT0FBOUIsRUFBdUNULGtCQUF2QyxFQUEyRCxDQUFDLFVBQUQsQ0FBM0QsQ0FEYSxFQUV4QmhILEtBRndCLENBRWxCQyxTQUFTO0FBQ2QsdUJBQU95SCxJQUFQLENBQVksNkNBQVosRUFBMkR6SCxLQUEzRDtBQUNBLFlBQU1BLEtBQU47QUFDRCxLQUx3QixDQUEzQjs7QUFPQSxVQUFNMEgsa0JBQWtCTCxpQkFDckJuSixJQURxQixDQUNoQixNQUFNLEtBQUtQLE9BQUwsQ0FBYTZKLGdCQUFiLENBQThCLE9BQTlCLEVBQXVDVCxrQkFBdkMsRUFBMkQsQ0FBQyxPQUFELENBQTNELENBRFUsRUFFckJoSCxLQUZxQixDQUVmQyxTQUFTO0FBQ2QsdUJBQU95SCxJQUFQLENBQVksd0RBQVosRUFBc0V6SCxLQUF0RTtBQUNBLFlBQU1BLEtBQU47QUFDRCxLQUxxQixDQUF4Qjs7QUFPQSxVQUFNMkgsaUJBQWlCTCxpQkFDcEJwSixJQURvQixDQUNmLE1BQU0sS0FBS1AsT0FBTCxDQUFhNkosZ0JBQWIsQ0FBOEIsT0FBOUIsRUFBdUNMLGtCQUF2QyxFQUEyRCxDQUFDLE1BQUQsQ0FBM0QsQ0FEUyxFQUVwQnBILEtBRm9CLENBRWRDLFNBQVM7QUFDZCx1QkFBT3lILElBQVAsQ0FBWSw2Q0FBWixFQUEyRHpILEtBQTNEO0FBQ0EsWUFBTUEsS0FBTjtBQUNELEtBTG9CLENBQXZCOztBQU9BLFVBQU00SCxlQUFlLEtBQUtqSyxPQUFMLENBQWFrSyx1QkFBYixFQUFyQjs7QUFFQTtBQUNBLFVBQU1DLGNBQWMsS0FBS25LLE9BQUwsQ0FBYW1KLHFCQUFiLENBQW1DLEVBQUVpQix3QkFBd0J0USxpQkFBaUJzUSxzQkFBM0MsRUFBbkMsQ0FBcEI7QUFDQSxXQUFPN0wsUUFBUWtGLEdBQVIsQ0FBWSxDQUFDbUcsa0JBQUQsRUFBcUJHLGVBQXJCLEVBQXNDQyxjQUF0QyxFQUFzREcsV0FBdEQsRUFBbUVGLFlBQW5FLENBQVosQ0FBUDtBQUNEOztBQWx4QnNCOztBQXV4QnpCSSxPQUFPQyxPQUFQLEdBQWlCeEssa0JBQWpCO0FBQ0E7QUFDQXVLLE9BQU9DLE9BQVAsQ0FBZUMsY0FBZixHQUFnQ3JQLGFBQWhDIiwiZmlsZSI6IkRhdGFiYXNlQ29udHJvbGxlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIu+7vy8vIEBmbG93XG4vLyBBIGRhdGFiYXNlIGFkYXB0ZXIgdGhhdCB3b3JrcyB3aXRoIGRhdGEgZXhwb3J0ZWQgZnJvbSB0aGUgaG9zdGVkXG4vLyBQYXJzZSBkYXRhYmFzZS5cblxuLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG5pbXBvcnQgeyBQYXJzZSB9ICAgICAgICAgICAgICBmcm9tICdwYXJzZS9ub2RlJztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IF8gICAgICAgICAgICAgICAgICAgICAgZnJvbSAnbG9kYXNoJztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IGludGVyc2VjdCAgICAgICAgICAgICAgZnJvbSAnaW50ZXJzZWN0Jztcbi8vIEBmbG93LWRpc2FibGUtbmV4dFxuaW1wb3J0IGRlZXBjb3B5ICAgICAgICAgICAgICAgZnJvbSAnZGVlcGNvcHknO1xuaW1wb3J0IGxvZ2dlciAgICAgICAgICAgICAgICAgZnJvbSAnLi4vbG9nZ2VyJztcbmltcG9ydCAqIGFzIFNjaGVtYUNvbnRyb2xsZXIgICAgICAgZnJvbSAnLi9TY2hlbWFDb250cm9sbGVyJztcbmltcG9ydCB7IFN0b3JhZ2VBZGFwdGVyIH0gICAgIGZyb20gJy4uL0FkYXB0ZXJzL1N0b3JhZ2UvU3RvcmFnZUFkYXB0ZXInO1xuaW1wb3J0IHR5cGUgeyBRdWVyeU9wdGlvbnMsXG4gIEZ1bGxRdWVyeU9wdGlvbnMgfSAgICAgICAgICBmcm9tICcuLi9BZGFwdGVycy9TdG9yYWdlL1N0b3JhZ2VBZGFwdGVyJztcblxuZnVuY3Rpb24gYWRkV3JpdGVBQ0wocXVlcnksIGFjbCkge1xuICBjb25zdCBuZXdRdWVyeSA9IF8uY2xvbmVEZWVwKHF1ZXJ5KTtcbiAgLy9DYW4ndCBiZSBhbnkgZXhpc3RpbmcgJ193cGVybScgcXVlcnksIHdlIGRvbid0IGFsbG93IGNsaWVudCBxdWVyaWVzIG9uIHRoYXQsIG5vIG5lZWQgdG8gJGFuZFxuICBuZXdRdWVyeS5fd3Blcm0gPSB7IFwiJGluXCIgOiBbbnVsbCwgLi4uYWNsXX07XG4gIHJldHVybiBuZXdRdWVyeTtcbn1cblxuZnVuY3Rpb24gYWRkUmVhZEFDTChxdWVyeSwgYWNsKSB7XG4gIGNvbnN0IG5ld1F1ZXJ5ID0gXy5jbG9uZURlZXAocXVlcnkpO1xuICAvL0Nhbid0IGJlIGFueSBleGlzdGluZyAnX3JwZXJtJyBxdWVyeSwgd2UgZG9uJ3QgYWxsb3cgY2xpZW50IHF1ZXJpZXMgb24gdGhhdCwgbm8gbmVlZCB0byAkYW5kXG4gIG5ld1F1ZXJ5Ll9ycGVybSA9IHtcIiRpblwiOiBbbnVsbCwgXCIqXCIsIC4uLmFjbF19O1xuICByZXR1cm4gbmV3UXVlcnk7XG59XG5cbi8vIFRyYW5zZm9ybXMgYSBSRVNUIEFQSSBmb3JtYXR0ZWQgQUNMIG9iamVjdCB0byBvdXIgdHdvLWZpZWxkIG1vbmdvIGZvcm1hdC5cbmNvbnN0IHRyYW5zZm9ybU9iamVjdEFDTCA9ICh7IEFDTCwgLi4ucmVzdWx0IH0pID0+IHtcbiAgaWYgKCFBQ0wpIHtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgcmVzdWx0Ll93cGVybSA9IFtdO1xuICByZXN1bHQuX3JwZXJtID0gW107XG5cbiAgZm9yIChjb25zdCBlbnRyeSBpbiBBQ0wpIHtcbiAgICBpZiAoQUNMW2VudHJ5XS5yZWFkKSB7XG4gICAgICByZXN1bHQuX3JwZXJtLnB1c2goZW50cnkpO1xuICAgIH1cbiAgICBpZiAoQUNMW2VudHJ5XS53cml0ZSkge1xuICAgICAgcmVzdWx0Ll93cGVybS5wdXNoKGVudHJ5KTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlc3VsdDtcbn1cblxuY29uc3Qgc3BlY2lhbFF1ZXJ5a2V5cyA9IFsnJGFuZCcsICckb3InLCAnJG5vcicsICdfcnBlcm0nLCAnX3dwZXJtJywgJ19wZXJpc2hhYmxlX3Rva2VuJywgJ19lbWFpbF92ZXJpZnlfdG9rZW4nLCAnX2VtYWlsX3ZlcmlmeV90b2tlbl9leHBpcmVzX2F0JywgJ19hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCcsICdfZmFpbGVkX2xvZ2luX2NvdW50J107XG5cbmNvbnN0IGlzU3BlY2lhbFF1ZXJ5S2V5ID0ga2V5ID0+IHtcbiAgcmV0dXJuIHNwZWNpYWxRdWVyeWtleXMuaW5kZXhPZihrZXkpID49IDA7XG59XG5cbmNvbnN0IHZhbGlkYXRlUXVlcnkgPSAocXVlcnk6IGFueSk6IHZvaWQgPT4ge1xuICBpZiAocXVlcnkuQUNMKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksICdDYW5ub3QgcXVlcnkgb24gQUNMLicpO1xuICB9XG5cbiAgaWYgKHF1ZXJ5LiRvcikge1xuICAgIGlmIChxdWVyeS4kb3IgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgICAgcXVlcnkuJG9yLmZvckVhY2godmFsaWRhdGVRdWVyeSk7XG5cbiAgICAgIC8qIEluIE1vbmdvREIsICRvciBxdWVyaWVzIHdoaWNoIGFyZSBub3QgYWxvbmUgYXQgdGhlIHRvcCBsZXZlbCBvZiB0aGVcbiAgICAgICAqIHF1ZXJ5IGNhbiBub3QgbWFrZSBlZmZpY2llbnQgdXNlIG9mIGluZGV4ZXMgZHVlIHRvIGEgbG9uZyBzdGFuZGluZ1xuICAgICAgICogYnVnIGtub3duIGFzIFNFUlZFUi0xMzczMi5cbiAgICAgICAqXG4gICAgICAgKiBUaGlzIGJsb2NrIHJlc3RydWN0dXJlcyBxdWVyaWVzIGluIHdoaWNoICRvciBpcyBub3QgdGhlIHNvbGUgdG9wXG4gICAgICAgKiBsZXZlbCBlbGVtZW50IGJ5IG1vdmluZyBhbGwgb3RoZXIgdG9wLWxldmVsIHByZWRpY2F0ZXMgaW5zaWRlIGV2ZXJ5XG4gICAgICAgKiBzdWJkb2N1bWVudCBvZiB0aGUgJG9yIHByZWRpY2F0ZSwgYWxsb3dpbmcgTW9uZ29EQidzIHF1ZXJ5IHBsYW5uZXJcbiAgICAgICAqIHRvIG1ha2UgZnVsbCB1c2Ugb2YgdGhlIG1vc3QgcmVsZXZhbnQgaW5kZXhlcy5cbiAgICAgICAqXG4gICAgICAgKiBFRzogICAgICB7JG9yOiBbe2E6IDF9LCB7YTogMn1dLCBiOiAyfVxuICAgICAgICogQmVjb21lczogeyRvcjogW3thOiAxLCBiOiAyfSwge2E6IDIsIGI6IDJ9XX1cbiAgICAgICAqXG4gICAgICAgKiBUaGUgb25seSBleGNlcHRpb25zIGFyZSAkbmVhciBhbmQgJG5lYXJTcGhlcmUgb3BlcmF0b3JzLCB3aGljaCBhcmVcbiAgICAgICAqIGNvbnN0cmFpbmVkIHRvIG9ubHkgMSBvcGVyYXRvciBwZXIgcXVlcnkuIEFzIGEgcmVzdWx0LCB0aGVzZSBvcHNcbiAgICAgICAqIHJlbWFpbiBhdCB0aGUgdG9wIGxldmVsXG4gICAgICAgKlxuICAgICAgICogaHR0cHM6Ly9qaXJhLm1vbmdvZGIub3JnL2Jyb3dzZS9TRVJWRVItMTM3MzJcbiAgICAgICAqIGh0dHBzOi8vZ2l0aHViLmNvbS9wYXJzZS1jb21tdW5pdHkvcGFyc2Utc2VydmVyL2lzc3Vlcy8zNzY3XG4gICAgICAgKi9cbiAgICAgIE9iamVjdC5rZXlzKHF1ZXJ5KS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgIGNvbnN0IG5vQ29sbGlzaW9ucyA9ICFxdWVyeS4kb3Iuc29tZShzdWJxID0+IHN1YnEuaGFzT3duUHJvcGVydHkoa2V5KSlcbiAgICAgICAgbGV0IGhhc05lYXJzID0gZmFsc2VcbiAgICAgICAgaWYgKHF1ZXJ5W2tleV0gIT0gbnVsbCAmJiB0eXBlb2YgcXVlcnlba2V5XSA9PSAnb2JqZWN0Jykge1xuICAgICAgICAgIGhhc05lYXJzID0gKCckbmVhcicgaW4gcXVlcnlba2V5XSB8fCAnJG5lYXJTcGhlcmUnIGluIHF1ZXJ5W2tleV0pXG4gICAgICAgIH1cbiAgICAgICAgaWYgKGtleSAhPSAnJG9yJyAmJiBub0NvbGxpc2lvbnMgJiYgIWhhc05lYXJzKSB7XG4gICAgICAgICAgcXVlcnkuJG9yLmZvckVhY2goc3VicXVlcnkgPT4ge1xuICAgICAgICAgICAgc3VicXVlcnlba2V5XSA9IHF1ZXJ5W2tleV07XG4gICAgICAgICAgfSk7XG4gICAgICAgICAgZGVsZXRlIHF1ZXJ5W2tleV07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcXVlcnkuJG9yLmZvckVhY2godmFsaWRhdGVRdWVyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnQmFkICRvciBmb3JtYXQgLSB1c2UgYW4gYXJyYXkgdmFsdWUuJyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKHF1ZXJ5LiRhbmQpIHtcbiAgICBpZiAocXVlcnkuJGFuZCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgICBxdWVyeS4kYW5kLmZvckVhY2godmFsaWRhdGVRdWVyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCAnQmFkICRhbmQgZm9ybWF0IC0gdXNlIGFuIGFycmF5IHZhbHVlLicpO1xuICAgIH1cbiAgfVxuXG4gIGlmIChxdWVyeS4kbm9yKSB7XG4gICAgaWYgKHF1ZXJ5LiRub3IgaW5zdGFuY2VvZiBBcnJheSAmJiBxdWVyeS4kbm9yLmxlbmd0aCA+IDApIHtcbiAgICAgIHF1ZXJ5LiRub3IuZm9yRWFjaCh2YWxpZGF0ZVF1ZXJ5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksICdCYWQgJG5vciBmb3JtYXQgLSB1c2UgYW4gYXJyYXkgb2YgYXQgbGVhc3QgMSB2YWx1ZS4nKTtcbiAgICB9XG4gIH1cblxuICBPYmplY3Qua2V5cyhxdWVyeSkuZm9yRWFjaChrZXkgPT4ge1xuICAgIGlmIChxdWVyeSAmJiBxdWVyeVtrZXldICYmIHF1ZXJ5W2tleV0uJHJlZ2V4KSB7XG4gICAgICBpZiAodHlwZW9mIHF1ZXJ5W2tleV0uJG9wdGlvbnMgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgIGlmICghcXVlcnlba2V5XS4kb3B0aW9ucy5tYXRjaCgvXltpbXhzXSskLykpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgYEJhZCAkb3B0aW9ucyB2YWx1ZSBmb3IgcXVlcnk6ICR7cXVlcnlba2V5XS4kb3B0aW9uc31gKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICBpZiAoIWlzU3BlY2lhbFF1ZXJ5S2V5KGtleSkgJiYgIWtleS5tYXRjaCgvXlthLXpBLVpdW2EtekEtWjAtOV9cXC5dKiQvKSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGBJbnZhbGlkIGtleSBuYW1lOiAke2tleX1gKTtcbiAgICB9XG4gIH0pO1xufVxuXG4vLyBGaWx0ZXJzIG91dCBhbnkgZGF0YSB0aGF0IHNob3VsZG4ndCBiZSBvbiB0aGlzIFJFU1QtZm9ybWF0dGVkIG9iamVjdC5cbmNvbnN0IGZpbHRlclNlbnNpdGl2ZURhdGEgPSAoaXNNYXN0ZXIsIGFjbEdyb3VwLCBjbGFzc05hbWUsIG9iamVjdCkgPT4ge1xuICBpZiAoY2xhc3NOYW1lICE9PSAnX1VzZXInKSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuXG4gIG9iamVjdC5wYXNzd29yZCA9IG9iamVjdC5faGFzaGVkX3Bhc3N3b3JkO1xuICBkZWxldGUgb2JqZWN0Ll9oYXNoZWRfcGFzc3dvcmQ7XG5cbiAgZGVsZXRlIG9iamVjdC5zZXNzaW9uVG9rZW47XG5cbiAgaWYgKGlzTWFzdGVyKSB7XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuICBkZWxldGUgb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW47XG4gIGRlbGV0ZSBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW47XG4gIGRlbGV0ZSBvYmplY3QuX3BlcmlzaGFibGVfdG9rZW5fZXhwaXJlc19hdDtcbiAgZGVsZXRlIG9iamVjdC5fdG9tYnN0b25lO1xuICBkZWxldGUgb2JqZWN0Ll9lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdDtcbiAgZGVsZXRlIG9iamVjdC5fZmFpbGVkX2xvZ2luX2NvdW50O1xuICBkZWxldGUgb2JqZWN0Ll9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdDtcbiAgZGVsZXRlIG9iamVjdC5fcGFzc3dvcmRfY2hhbmdlZF9hdDtcbiAgZGVsZXRlIG9iamVjdC5fcGFzc3dvcmRfaGlzdG9yeTtcblxuICBpZiAoKGFjbEdyb3VwLmluZGV4T2Yob2JqZWN0Lm9iamVjdElkKSA+IC0xKSkge1xuICAgIHJldHVybiBvYmplY3Q7XG4gIH1cbiAgZGVsZXRlIG9iamVjdC5hdXRoRGF0YTtcbiAgcmV0dXJuIG9iamVjdDtcbn07XG5cbmltcG9ydCB0eXBlIHsgTG9hZFNjaGVtYU9wdGlvbnMgfSBmcm9tICcuL3R5cGVzJztcblxuLy8gUnVucyBhbiB1cGRhdGUgb24gdGhlIGRhdGFiYXNlLlxuLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIGFuIG9iamVjdCB3aXRoIHRoZSBuZXcgdmFsdWVzIGZvciBmaWVsZFxuLy8gbW9kaWZpY2F0aW9ucyB0aGF0IGRvbid0IGtub3cgdGhlaXIgcmVzdWx0cyBhaGVhZCBvZiB0aW1lLCBsaWtlXG4vLyAnaW5jcmVtZW50Jy5cbi8vIE9wdGlvbnM6XG4vLyAgIGFjbDogIGEgbGlzdCBvZiBzdHJpbmdzLiBJZiB0aGUgb2JqZWN0IHRvIGJlIHVwZGF0ZWQgaGFzIGFuIEFDTCxcbi8vICAgICAgICAgb25lIG9mIHRoZSBwcm92aWRlZCBzdHJpbmdzIG11c3QgcHJvdmlkZSB0aGUgY2FsbGVyIHdpdGhcbi8vICAgICAgICAgd3JpdGUgcGVybWlzc2lvbnMuXG5jb25zdCBzcGVjaWFsS2V5c0ZvclVwZGF0ZSA9IFsnX2hhc2hlZF9wYXNzd29yZCcsICdfcGVyaXNoYWJsZV90b2tlbicsICdfZW1haWxfdmVyaWZ5X3Rva2VuJywgJ19lbWFpbF92ZXJpZnlfdG9rZW5fZXhwaXJlc19hdCcsICdfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQnLCAnX2ZhaWxlZF9sb2dpbl9jb3VudCcsICdfcGVyaXNoYWJsZV90b2tlbl9leHBpcmVzX2F0JywgJ19wYXNzd29yZF9jaGFuZ2VkX2F0JywgJ19wYXNzd29yZF9oaXN0b3J5J107XG5cbmNvbnN0IGlzU3BlY2lhbFVwZGF0ZUtleSA9IGtleSA9PiB7XG4gIHJldHVybiBzcGVjaWFsS2V5c0ZvclVwZGF0ZS5pbmRleE9mKGtleSkgPj0gMDtcbn1cblxuZnVuY3Rpb24gZXhwYW5kUmVzdWx0T25LZXlQYXRoKG9iamVjdCwga2V5LCB2YWx1ZSkge1xuICBpZiAoa2V5LmluZGV4T2YoJy4nKSA8IDApIHtcbiAgICBvYmplY3Rba2V5XSA9IHZhbHVlW2tleV07XG4gICAgcmV0dXJuIG9iamVjdDtcbiAgfVxuICBjb25zdCBwYXRoID0ga2V5LnNwbGl0KCcuJyk7XG4gIGNvbnN0IGZpcnN0S2V5ID0gcGF0aFswXTtcbiAgY29uc3QgbmV4dFBhdGggPSBwYXRoLnNsaWNlKDEpLmpvaW4oJy4nKTtcbiAgb2JqZWN0W2ZpcnN0S2V5XSA9IGV4cGFuZFJlc3VsdE9uS2V5UGF0aChvYmplY3RbZmlyc3RLZXldIHx8IHt9LCBuZXh0UGF0aCwgdmFsdWVbZmlyc3RLZXldKTtcbiAgZGVsZXRlIG9iamVjdFtrZXldO1xuICByZXR1cm4gb2JqZWN0O1xufVxuXG5mdW5jdGlvbiBzYW5pdGl6ZURhdGFiYXNlUmVzdWx0KG9yaWdpbmFsT2JqZWN0LCByZXN1bHQpOiBQcm9taXNlPGFueT4ge1xuICBjb25zdCByZXNwb25zZSA9IHt9O1xuICBpZiAoIXJlc3VsdCkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocmVzcG9uc2UpO1xuICB9XG4gIE9iamVjdC5rZXlzKG9yaWdpbmFsT2JqZWN0KS5mb3JFYWNoKGtleSA9PiB7XG4gICAgY29uc3Qga2V5VXBkYXRlID0gb3JpZ2luYWxPYmplY3Rba2V5XTtcbiAgICAvLyBkZXRlcm1pbmUgaWYgdGhhdCB3YXMgYW4gb3BcbiAgICBpZiAoa2V5VXBkYXRlICYmIHR5cGVvZiBrZXlVcGRhdGUgPT09ICdvYmplY3QnICYmIGtleVVwZGF0ZS5fX29wXG4gICAgICAmJiBbJ0FkZCcsICdBZGRVbmlxdWUnLCAnUmVtb3ZlJywgJ0luY3JlbWVudCddLmluZGV4T2Yoa2V5VXBkYXRlLl9fb3ApID4gLTEpIHtcbiAgICAgIC8vIG9ubHkgdmFsaWQgb3BzIHRoYXQgcHJvZHVjZSBhbiBhY3Rpb25hYmxlIHJlc3VsdFxuICAgICAgLy8gdGhlIG9wIG1heSBoYXZlIGhhcHBlbmQgb24gYSBrZXlwYXRoXG4gICAgICBleHBhbmRSZXN1bHRPbktleVBhdGgocmVzcG9uc2UsIGtleSwgcmVzdWx0KTtcbiAgICB9XG4gIH0pO1xuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHJlc3BvbnNlKTtcbn1cblxuZnVuY3Rpb24gam9pblRhYmxlTmFtZShjbGFzc05hbWUsIGtleSkge1xuICByZXR1cm4gYF9Kb2luOiR7a2V5fToke2NsYXNzTmFtZX1gO1xufVxuXG5jb25zdCBmbGF0dGVuVXBkYXRlT3BlcmF0b3JzRm9yQ3JlYXRlID0gb2JqZWN0ID0+IHtcbiAgZm9yIChjb25zdCBrZXkgaW4gb2JqZWN0KSB7XG4gICAgaWYgKG9iamVjdFtrZXldICYmIG9iamVjdFtrZXldLl9fb3ApIHtcbiAgICAgIHN3aXRjaCAob2JqZWN0W2tleV0uX19vcCkge1xuICAgICAgY2FzZSAnSW5jcmVtZW50JzpcbiAgICAgICAgaWYgKHR5cGVvZiBvYmplY3Rba2V5XS5hbW91bnQgIT09ICdudW1iZXInKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICAgICAgfVxuICAgICAgICBvYmplY3Rba2V5XSA9IG9iamVjdFtrZXldLmFtb3VudDtcbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdBZGQnOlxuICAgICAgICBpZiAoIShvYmplY3Rba2V5XS5vYmplY3RzIGluc3RhbmNlb2YgQXJyYXkpKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfSlNPTiwgJ29iamVjdHMgdG8gYWRkIG11c3QgYmUgYW4gYXJyYXknKTtcbiAgICAgICAgfVxuICAgICAgICBvYmplY3Rba2V5XSA9IG9iamVjdFtrZXldLm9iamVjdHM7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAnQWRkVW5pcXVlJzpcbiAgICAgICAgaWYgKCEob2JqZWN0W2tleV0ub2JqZWN0cyBpbnN0YW5jZW9mIEFycmF5KSkge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0pTT04sICdvYmplY3RzIHRvIGFkZCBtdXN0IGJlIGFuIGFycmF5Jyk7XG4gICAgICAgIH1cbiAgICAgICAgb2JqZWN0W2tleV0gPSBvYmplY3Rba2V5XS5vYmplY3RzO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ1JlbW92ZSc6XG4gICAgICAgIGlmICghKG9iamVjdFtrZXldLm9iamVjdHMgaW5zdGFuY2VvZiBBcnJheSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9KU09OLCAnb2JqZWN0cyB0byBhZGQgbXVzdCBiZSBhbiBhcnJheScpO1xuICAgICAgICB9XG4gICAgICAgIG9iamVjdFtrZXldID0gW11cbiAgICAgICAgYnJlYWs7XG4gICAgICBjYXNlICdEZWxldGUnOlxuICAgICAgICBkZWxldGUgb2JqZWN0W2tleV07XG4gICAgICAgIGJyZWFrO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkNPTU1BTkRfVU5BVkFJTEFCTEUsIGBUaGUgJHtvYmplY3Rba2V5XS5fX29wfSBvcGVyYXRvciBpcyBub3Qgc3VwcG9ydGVkIHlldC5gKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuY29uc3QgdHJhbnNmb3JtQXV0aERhdGEgPSAoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkgPT4ge1xuICBpZiAob2JqZWN0LmF1dGhEYXRhICYmIGNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIE9iamVjdC5rZXlzKG9iamVjdC5hdXRoRGF0YSkuZm9yRWFjaChwcm92aWRlciA9PiB7XG4gICAgICBjb25zdCBwcm92aWRlckRhdGEgPSBvYmplY3QuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgY29uc3QgZmllbGROYW1lID0gYF9hdXRoX2RhdGFfJHtwcm92aWRlcn1gO1xuICAgICAgaWYgKHByb3ZpZGVyRGF0YSA9PSBudWxsKSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0ge1xuICAgICAgICAgIF9fb3A6ICdEZWxldGUnXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9iamVjdFtmaWVsZE5hbWVdID0gcHJvdmlkZXJEYXRhO1xuICAgICAgICBzY2hlbWEuZmllbGRzW2ZpZWxkTmFtZV0gPSB7IHR5cGU6ICdPYmplY3QnIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgICBkZWxldGUgb2JqZWN0LmF1dGhEYXRhO1xuICB9XG59XG4vLyBUcmFuc2Zvcm1zIGEgRGF0YWJhc2UgZm9ybWF0IEFDTCB0byBhIFJFU1QgQVBJIGZvcm1hdCBBQ0xcbmNvbnN0IHVudHJhbnNmb3JtT2JqZWN0QUNMID0gKHtfcnBlcm0sIF93cGVybSwgLi4ub3V0cHV0fSkgPT4ge1xuICBpZiAoX3JwZXJtIHx8IF93cGVybSkge1xuICAgIG91dHB1dC5BQ0wgPSB7fTtcblxuICAgIChfcnBlcm0gfHwgW10pLmZvckVhY2goZW50cnkgPT4ge1xuICAgICAgaWYgKCFvdXRwdXQuQUNMW2VudHJ5XSkge1xuICAgICAgICBvdXRwdXQuQUNMW2VudHJ5XSA9IHsgcmVhZDogdHJ1ZSB9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV1bJ3JlYWQnXSA9IHRydWU7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAoX3dwZXJtIHx8IFtdKS5mb3JFYWNoKGVudHJ5ID0+IHtcbiAgICAgIGlmICghb3V0cHV0LkFDTFtlbnRyeV0pIHtcbiAgICAgICAgb3V0cHV0LkFDTFtlbnRyeV0gPSB7IHdyaXRlOiB0cnVlIH07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBvdXRwdXQuQUNMW2VudHJ5XVsnd3JpdGUnXSA9IHRydWU7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cbiAgcmV0dXJuIG91dHB1dDtcbn1cblxuLyoqXG4gKiBXaGVuIHF1ZXJ5aW5nLCB0aGUgZmllbGROYW1lIG1heSBiZSBjb21wb3VuZCwgZXh0cmFjdCB0aGUgcm9vdCBmaWVsZE5hbWVcbiAqICAgICBgdGVtcGVyYXR1cmUuY2Vsc2l1c2AgYmVjb21lcyBgdGVtcGVyYXR1cmVgXG4gKiBAcGFyYW0ge3N0cmluZ30gZmllbGROYW1lIHRoYXQgbWF5IGJlIGEgY29tcG91bmQgZmllbGQgbmFtZVxuICogQHJldHVybnMge3N0cmluZ30gdGhlIHJvb3QgbmFtZSBvZiB0aGUgZmllbGRcbiAqL1xuY29uc3QgZ2V0Um9vdEZpZWxkTmFtZSA9IChmaWVsZE5hbWU6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gIHJldHVybiBmaWVsZE5hbWUuc3BsaXQoJy4nKVswXVxufVxuXG5jb25zdCByZWxhdGlvblNjaGVtYSA9IHsgZmllbGRzOiB7IHJlbGF0ZWRJZDogeyB0eXBlOiAnU3RyaW5nJyB9LCBvd25pbmdJZDogeyB0eXBlOiAnU3RyaW5nJyB9IH0gfTtcblxuY2xhc3MgRGF0YWJhc2VDb250cm9sbGVyIHtcbiAgYWRhcHRlcjogU3RvcmFnZUFkYXB0ZXI7XG4gIHNjaGVtYUNhY2hlOiBhbnk7XG4gIHNjaGVtYVByb21pc2U6ID9Qcm9taXNlPFNjaGVtYUNvbnRyb2xsZXIuU2NoZW1hQ29udHJvbGxlcj47XG5cbiAgY29uc3RydWN0b3IoYWRhcHRlcjogU3RvcmFnZUFkYXB0ZXIsIHNjaGVtYUNhY2hlOiBhbnkpIHtcbiAgICB0aGlzLmFkYXB0ZXIgPSBhZGFwdGVyO1xuICAgIHRoaXMuc2NoZW1hQ2FjaGUgPSBzY2hlbWFDYWNoZTtcbiAgICAvLyBXZSBkb24ndCB3YW50IGEgbXV0YWJsZSB0aGlzLnNjaGVtYSwgYmVjYXVzZSB0aGVuIHlvdSBjb3VsZCBoYXZlXG4gICAgLy8gb25lIHJlcXVlc3QgdGhhdCB1c2VzIGRpZmZlcmVudCBzY2hlbWFzIGZvciBkaWZmZXJlbnQgcGFydHMgb2ZcbiAgICAvLyBpdC4gSW5zdGVhZCwgdXNlIGxvYWRTY2hlbWEgdG8gZ2V0IGEgc2NoZW1hLlxuICAgIHRoaXMuc2NoZW1hUHJvbWlzZSA9IG51bGw7XG4gIH1cblxuICBjb2xsZWN0aW9uRXhpc3RzKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jbGFzc0V4aXN0cyhjbGFzc05hbWUpO1xuICB9XG5cbiAgcHVyZ2VDb2xsZWN0aW9uKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHNjaGVtYUNvbnRyb2xsZXIuZ2V0T25lU2NoZW1hKGNsYXNzTmFtZSkpXG4gICAgICAudGhlbihzY2hlbWEgPT4gdGhpcy5hZGFwdGVyLmRlbGV0ZU9iamVjdHNCeVF1ZXJ5KGNsYXNzTmFtZSwgc2NoZW1hLCB7fSkpO1xuICB9XG5cbiAgdmFsaWRhdGVDbGFzc05hbWUoY2xhc3NOYW1lOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIVNjaGVtYUNvbnRyb2xsZXIuY2xhc3NOYW1lSXNWYWxpZChjbGFzc05hbWUpKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfQ0xBU1NfTkFNRSwgJ2ludmFsaWQgY2xhc3NOYW1lOiAnICsgY2xhc3NOYW1lKSk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIHNjaGVtYUNvbnRyb2xsZXIuXG4gIGxvYWRTY2hlbWEob3B0aW9uczogTG9hZFNjaGVtYU9wdGlvbnMgPSB7Y2xlYXJDYWNoZTogZmFsc2V9KTogUHJvbWlzZTxTY2hlbWFDb250cm9sbGVyLlNjaGVtYUNvbnRyb2xsZXI+IHtcbiAgICBpZiAodGhpcy5zY2hlbWFQcm9taXNlICE9IG51bGwpIHtcbiAgICAgIHJldHVybiB0aGlzLnNjaGVtYVByb21pc2U7XG4gICAgfVxuICAgIHRoaXMuc2NoZW1hUHJvbWlzZSA9IFNjaGVtYUNvbnRyb2xsZXIubG9hZCh0aGlzLmFkYXB0ZXIsIHRoaXMuc2NoZW1hQ2FjaGUsIG9wdGlvbnMpO1xuICAgIHRoaXMuc2NoZW1hUHJvbWlzZS50aGVuKCgpID0+IGRlbGV0ZSB0aGlzLnNjaGVtYVByb21pc2UsXG4gICAgICAoKSA9PiBkZWxldGUgdGhpcy5zY2hlbWFQcm9taXNlKTtcbiAgICByZXR1cm4gdGhpcy5sb2FkU2NoZW1hKG9wdGlvbnMpO1xuICB9XG5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgZm9yIHRoZSBjbGFzc25hbWUgdGhhdCBpcyByZWxhdGVkIHRvIHRoZSBnaXZlblxuICAvLyBjbGFzc25hbWUgdGhyb3VnaCB0aGUga2V5LlxuICAvLyBUT0RPOiBtYWtlIHRoaXMgbm90IGluIHRoZSBEYXRhYmFzZUNvbnRyb2xsZXIgaW50ZXJmYWNlXG4gIHJlZGlyZWN0Q2xhc3NOYW1lRm9yS2V5KGNsYXNzTmFtZTogc3RyaW5nLCBrZXk6IHN0cmluZyk6IFByb21pc2U8P3N0cmluZz4ge1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEoKS50aGVuKChzY2hlbWEpID0+IHtcbiAgICAgIHZhciB0ICA9IHNjaGVtYS5nZXRFeHBlY3RlZFR5cGUoY2xhc3NOYW1lLCBrZXkpO1xuICAgICAgaWYgKHQgIT0gbnVsbCAmJiB0eXBlb2YgdCAhPT0gJ3N0cmluZycgJiYgdC50eXBlID09PSAnUmVsYXRpb24nKSB7XG4gICAgICAgIHJldHVybiB0LnRhcmdldENsYXNzO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGNsYXNzTmFtZTtcbiAgICB9KTtcbiAgfVxuXG4gIC8vIFVzZXMgdGhlIHNjaGVtYSB0byB2YWxpZGF0ZSB0aGUgb2JqZWN0IChSRVNUIEFQSSBmb3JtYXQpLlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHRvIHRoZSBuZXcgc2NoZW1hLlxuICAvLyBUaGlzIGRvZXMgbm90IHVwZGF0ZSB0aGlzLnNjaGVtYSwgYmVjYXVzZSBpbiBhIHNpdHVhdGlvbiBsaWtlIGFcbiAgLy8gYmF0Y2ggcmVxdWVzdCwgdGhhdCBjb3VsZCBjb25mdXNlIG90aGVyIHVzZXJzIG9mIHRoZSBzY2hlbWEuXG4gIHZhbGlkYXRlT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3Q6IGFueSwgcXVlcnk6IGFueSwgeyBhY2wgfTogUXVlcnlPcHRpb25zKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgbGV0IHNjaGVtYTtcbiAgICBjb25zdCBpc01hc3RlciA9IGFjbCA9PT0gdW5kZWZpbmVkO1xuICAgIHZhciBhY2xHcm91cDogc3RyaW5nW10gID0gYWNsIHx8IFtdO1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEoKS50aGVuKHMgPT4ge1xuICAgICAgc2NoZW1hID0gcztcbiAgICAgIGlmIChpc01hc3Rlcikge1xuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gdGhpcy5jYW5BZGRGaWVsZChzY2hlbWEsIGNsYXNzTmFtZSwgb2JqZWN0LCBhY2xHcm91cCk7XG4gICAgfSkudGhlbigoKSA9PiB7XG4gICAgICByZXR1cm4gc2NoZW1hLnZhbGlkYXRlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBxdWVyeSk7XG4gICAgfSk7XG4gIH1cblxuICB1cGRhdGUoY2xhc3NOYW1lOiBzdHJpbmcsIHF1ZXJ5OiBhbnksIHVwZGF0ZTogYW55LCB7XG4gICAgYWNsLFxuICAgIG1hbnksXG4gICAgdXBzZXJ0LFxuICB9OiBGdWxsUXVlcnlPcHRpb25zID0ge30sIHNraXBTYW5pdGl6YXRpb246IGJvb2xlYW4gPSBmYWxzZSk6IFByb21pc2U8YW55PiB7XG4gICAgY29uc3Qgb3JpZ2luYWxRdWVyeSA9IHF1ZXJ5O1xuICAgIGNvbnN0IG9yaWdpbmFsVXBkYXRlID0gdXBkYXRlO1xuICAgIC8vIE1ha2UgYSBjb3B5IG9mIHRoZSBvYmplY3QsIHNvIHdlIGRvbid0IG11dGF0ZSB0aGUgaW5jb21pbmcgZGF0YS5cbiAgICB1cGRhdGUgPSBkZWVwY29weSh1cGRhdGUpO1xuICAgIHZhciByZWxhdGlvblVwZGF0ZXMgPSBbXTtcbiAgICB2YXIgaXNNYXN0ZXIgPSBhY2wgPT09IHVuZGVmaW5lZDtcbiAgICB2YXIgYWNsR3JvdXAgPSBhY2wgfHwgW107XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHtcbiAgICAgICAgcmV0dXJuIChpc01hc3RlciA/IFByb21pc2UucmVzb2x2ZSgpIDogc2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgJ3VwZGF0ZScpKVxuICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgIHJlbGF0aW9uVXBkYXRlcyA9IHRoaXMuY29sbGVjdFJlbGF0aW9uVXBkYXRlcyhjbGFzc05hbWUsIG9yaWdpbmFsUXVlcnkub2JqZWN0SWQsIHVwZGF0ZSk7XG4gICAgICAgICAgICBpZiAoIWlzTWFzdGVyKSB7XG4gICAgICAgICAgICAgIHF1ZXJ5ID0gdGhpcy5hZGRQb2ludGVyUGVybWlzc2lvbnMoc2NoZW1hQ29udHJvbGxlciwgY2xhc3NOYW1lLCAndXBkYXRlJywgcXVlcnksIGFjbEdyb3VwKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghcXVlcnkpIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKGFjbCkge1xuICAgICAgICAgICAgICBxdWVyeSA9IGFkZFdyaXRlQUNMKHF1ZXJ5LCBhY2wpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFsaWRhdGVRdWVyeShxdWVyeSk7XG4gICAgICAgICAgICByZXR1cm4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCB0cnVlKVxuICAgICAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAgIC8vIElmIHRoZSBzY2hlbWEgZG9lc24ndCBleGlzdCwgcHJldGVuZCBpdCBleGlzdHMgd2l0aCBubyBmaWVsZHMuIFRoaXMgYmVoYXZpb3JcbiAgICAgICAgICAgICAgICAvLyB3aWxsIGxpa2VseSBuZWVkIHJldmlzaXRpbmcuXG4gICAgICAgICAgICAgICAgaWYgKGVycm9yID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB7IGZpZWxkczoge30gfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgICAgICAgICAgT2JqZWN0LmtleXModXBkYXRlKS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgICAgICBpZiAoZmllbGROYW1lLm1hdGNoKC9eYXV0aERhdGFcXC4oW2EtekEtWjAtOV9dKylcXC5pZCQvKSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSwgYEludmFsaWQgZmllbGQgbmFtZSBmb3IgdXBkYXRlOiAke2ZpZWxkTmFtZX1gKTtcbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIGNvbnN0IHJvb3RGaWVsZE5hbWUgPSBnZXRSb290RmllbGROYW1lKGZpZWxkTmFtZSk7XG4gICAgICAgICAgICAgICAgICBpZiAoIVNjaGVtYUNvbnRyb2xsZXIuZmllbGROYW1lSXNWYWxpZChyb290RmllbGROYW1lKSAmJiAhaXNTcGVjaWFsVXBkYXRlS2V5KHJvb3RGaWVsZE5hbWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgSW52YWxpZCBmaWVsZCBuYW1lIGZvciB1cGRhdGU6ICR7ZmllbGROYW1lfWApO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgdXBkYXRlT3BlcmF0aW9uIGluIHVwZGF0ZSkge1xuICAgICAgICAgICAgICAgICAgaWYgKHVwZGF0ZVt1cGRhdGVPcGVyYXRpb25dICYmIHR5cGVvZiB1cGRhdGVbdXBkYXRlT3BlcmF0aW9uXSA9PT0gJ29iamVjdCcgJiYgT2JqZWN0LmtleXModXBkYXRlW3VwZGF0ZU9wZXJhdGlvbl0pLnNvbWUoaW5uZXJLZXkgPT4gaW5uZXJLZXkuaW5jbHVkZXMoJyQnKSB8fCBpbm5lcktleS5pbmNsdWRlcygnLicpKSkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9ORVNURURfS0VZLCBcIk5lc3RlZCBrZXlzIHNob3VsZCBub3QgY29udGFpbiB0aGUgJyQnIG9yICcuJyBjaGFyYWN0ZXJzXCIpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB1cGRhdGUgPSB0cmFuc2Zvcm1PYmplY3RBQ0wodXBkYXRlKTtcbiAgICAgICAgICAgICAgICB0cmFuc2Zvcm1BdXRoRGF0YShjbGFzc05hbWUsIHVwZGF0ZSwgc2NoZW1hKTtcbiAgICAgICAgICAgICAgICBpZiAobWFueSkge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci51cGRhdGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIHVwZGF0ZSk7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICh1cHNlcnQpIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIudXBzZXJ0T25lT2JqZWN0KGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgdXBkYXRlKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5maW5kT25lQW5kVXBkYXRlKGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgdXBkYXRlKVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbigocmVzdWx0OiBhbnkpID0+IHtcbiAgICAgICAgICAgIGlmICghcmVzdWx0KSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnT2JqZWN0IG5vdCBmb3VuZC4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmhhbmRsZVJlbGF0aW9uVXBkYXRlcyhjbGFzc05hbWUsIG9yaWdpbmFsUXVlcnkub2JqZWN0SWQsIHVwZGF0ZSwgcmVsYXRpb25VcGRhdGVzKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgIH0pLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgaWYgKHNraXBTYW5pdGl6YXRpb24pIHtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShyZXN1bHQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHNhbml0aXplRGF0YWJhc2VSZXN1bHQob3JpZ2luYWxVcGRhdGUsIHJlc3VsdCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIENvbGxlY3QgYWxsIHJlbGF0aW9uLXVwZGF0aW5nIG9wZXJhdGlvbnMgZnJvbSBhIFJFU1QtZm9ybWF0IHVwZGF0ZS5cbiAgLy8gUmV0dXJucyBhIGxpc3Qgb2YgYWxsIHJlbGF0aW9uIHVwZGF0ZXMgdG8gcGVyZm9ybVxuICAvLyBUaGlzIG11dGF0ZXMgdXBkYXRlLlxuICBjb2xsZWN0UmVsYXRpb25VcGRhdGVzKGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3RJZDogP3N0cmluZywgdXBkYXRlOiBhbnkpIHtcbiAgICB2YXIgb3BzID0gW107XG4gICAgdmFyIGRlbGV0ZU1lID0gW107XG4gICAgb2JqZWN0SWQgPSB1cGRhdGUub2JqZWN0SWQgfHwgb2JqZWN0SWQ7XG5cbiAgICB2YXIgcHJvY2VzcyA9IChvcCwga2V5KSA9PiB7XG4gICAgICBpZiAoIW9wKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGlmIChvcC5fX29wID09ICdBZGRSZWxhdGlvbicpIHtcbiAgICAgICAgb3BzLnB1c2goe2tleSwgb3B9KTtcbiAgICAgICAgZGVsZXRlTWUucHVzaChrZXkpO1xuICAgICAgfVxuXG4gICAgICBpZiAob3AuX19vcCA9PSAnUmVtb3ZlUmVsYXRpb24nKSB7XG4gICAgICAgIG9wcy5wdXNoKHtrZXksIG9wfSk7XG4gICAgICAgIGRlbGV0ZU1lLnB1c2goa2V5KTtcbiAgICAgIH1cblxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ0JhdGNoJykge1xuICAgICAgICBmb3IgKHZhciB4IG9mIG9wLm9wcykge1xuICAgICAgICAgIHByb2Nlc3MoeCwga2V5KTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG5cbiAgICBmb3IgKGNvbnN0IGtleSBpbiB1cGRhdGUpIHtcbiAgICAgIHByb2Nlc3ModXBkYXRlW2tleV0sIGtleSk7XG4gICAgfVxuICAgIGZvciAoY29uc3Qga2V5IG9mIGRlbGV0ZU1lKSB7XG4gICAgICBkZWxldGUgdXBkYXRlW2tleV07XG4gICAgfVxuICAgIHJldHVybiBvcHM7XG4gIH1cblxuICAvLyBQcm9jZXNzZXMgcmVsYXRpb24tdXBkYXRpbmcgb3BlcmF0aW9ucyBmcm9tIGEgUkVTVC1mb3JtYXQgdXBkYXRlLlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gYWxsIHVwZGF0ZXMgaGF2ZSBiZWVuIHBlcmZvcm1lZFxuICBoYW5kbGVSZWxhdGlvblVwZGF0ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdElkOiBzdHJpbmcsIHVwZGF0ZTogYW55LCBvcHM6IGFueSkge1xuICAgIHZhciBwZW5kaW5nID0gW107XG4gICAgb2JqZWN0SWQgPSB1cGRhdGUub2JqZWN0SWQgfHwgb2JqZWN0SWQ7XG4gICAgb3BzLmZvckVhY2goKHtrZXksIG9wfSkgPT4ge1xuICAgICAgaWYgKCFvcCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBpZiAob3AuX19vcCA9PSAnQWRkUmVsYXRpb24nKSB7XG4gICAgICAgIGZvciAoY29uc3Qgb2JqZWN0IG9mIG9wLm9iamVjdHMpIHtcbiAgICAgICAgICBwZW5kaW5nLnB1c2godGhpcy5hZGRSZWxhdGlvbihrZXksIGNsYXNzTmFtZSxcbiAgICAgICAgICAgIG9iamVjdElkLFxuICAgICAgICAgICAgb2JqZWN0Lm9iamVjdElkKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKG9wLl9fb3AgPT0gJ1JlbW92ZVJlbGF0aW9uJykge1xuICAgICAgICBmb3IgKGNvbnN0IG9iamVjdCBvZiBvcC5vYmplY3RzKSB7XG4gICAgICAgICAgcGVuZGluZy5wdXNoKHRoaXMucmVtb3ZlUmVsYXRpb24oa2V5LCBjbGFzc05hbWUsXG4gICAgICAgICAgICBvYmplY3RJZCxcbiAgICAgICAgICAgIG9iamVjdC5vYmplY3RJZCkpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocGVuZGluZyk7XG4gIH1cblxuICAvLyBBZGRzIGEgcmVsYXRpb24uXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgYWRkIHdhcyBzdWNjZXNzZnVsLlxuICBhZGRSZWxhdGlvbihrZXk6IHN0cmluZywgZnJvbUNsYXNzTmFtZTogc3RyaW5nLCBmcm9tSWQ6IHN0cmluZywgdG9JZDogc3RyaW5nKSB7XG4gICAgY29uc3QgZG9jID0ge1xuICAgICAgcmVsYXRlZElkOiB0b0lkLFxuICAgICAgb3duaW5nSWQ6IGZyb21JZFxuICAgIH07XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci51cHNlcnRPbmVPYmplY3QoYF9Kb2luOiR7a2V5fToke2Zyb21DbGFzc05hbWV9YCwgcmVsYXRpb25TY2hlbWEsIGRvYywgZG9jKTtcbiAgfVxuXG4gIC8vIFJlbW92ZXMgYSByZWxhdGlvbi5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyBzdWNjZXNzZnVsbHkgaWZmIHRoZSByZW1vdmUgd2FzXG4gIC8vIHN1Y2Nlc3NmdWwuXG4gIHJlbW92ZVJlbGF0aW9uKGtleTogc3RyaW5nLCBmcm9tQ2xhc3NOYW1lOiBzdHJpbmcsIGZyb21JZDogc3RyaW5nLCB0b0lkOiBzdHJpbmcpIHtcbiAgICB2YXIgZG9jID0ge1xuICAgICAgcmVsYXRlZElkOiB0b0lkLFxuICAgICAgb3duaW5nSWQ6IGZyb21JZFxuICAgIH07XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5kZWxldGVPYmplY3RzQnlRdWVyeShgX0pvaW46JHtrZXl9OiR7ZnJvbUNsYXNzTmFtZX1gLCByZWxhdGlvblNjaGVtYSwgZG9jKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgLy8gV2UgZG9uJ3QgY2FyZSBpZiB0aGV5IHRyeSB0byBkZWxldGUgYSBub24tZXhpc3RlbnQgcmVsYXRpb24uXG4gICAgICAgIGlmIChlcnJvci5jb2RlID09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8vIFJlbW92ZXMgb2JqZWN0cyBtYXRjaGVzIHRoaXMgcXVlcnkgZnJvbSB0aGUgZGF0YWJhc2UuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgb2JqZWN0IHdhc1xuICAvLyBkZWxldGVkLlxuICAvLyBPcHRpb25zOlxuICAvLyAgIGFjbDogIGEgbGlzdCBvZiBzdHJpbmdzLiBJZiB0aGUgb2JqZWN0IHRvIGJlIHVwZGF0ZWQgaGFzIGFuIEFDTCxcbiAgLy8gICAgICAgICBvbmUgb2YgdGhlIHByb3ZpZGVkIHN0cmluZ3MgbXVzdCBwcm92aWRlIHRoZSBjYWxsZXIgd2l0aFxuICAvLyAgICAgICAgIHdyaXRlIHBlcm1pc3Npb25zLlxuICBkZXN0cm95KGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogYW55LCB7IGFjbCB9OiBRdWVyeU9wdGlvbnMgPSB7fSk6IFByb21pc2U8YW55PiB7XG4gICAgY29uc3QgaXNNYXN0ZXIgPSBhY2wgPT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBhY2xHcm91cCA9IGFjbCB8fCBbXTtcblxuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgICAgIHJldHVybiAoaXNNYXN0ZXIgPyBQcm9taXNlLnJlc29sdmUoKSA6IHNjaGVtYUNvbnRyb2xsZXIudmFsaWRhdGVQZXJtaXNzaW9uKGNsYXNzTmFtZSwgYWNsR3JvdXAsICdkZWxldGUnKSlcbiAgICAgICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgICAgICBpZiAoIWlzTWFzdGVyKSB7XG4gICAgICAgICAgICAgIHF1ZXJ5ID0gdGhpcy5hZGRQb2ludGVyUGVybWlzc2lvbnMoc2NoZW1hQ29udHJvbGxlciwgY2xhc3NOYW1lLCAnZGVsZXRlJywgcXVlcnksIGFjbEdyb3VwKTtcbiAgICAgICAgICAgICAgaWYgKCFxdWVyeSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELCAnT2JqZWN0IG5vdCBmb3VuZC4nKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gZGVsZXRlIGJ5IHF1ZXJ5XG4gICAgICAgICAgICBpZiAoYWNsKSB7XG4gICAgICAgICAgICAgIHF1ZXJ5ID0gYWRkV3JpdGVBQ0wocXVlcnksIGFjbCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YWxpZGF0ZVF1ZXJ5KHF1ZXJ5KTtcbiAgICAgICAgICAgIHJldHVybiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYShjbGFzc05hbWUpXG4gICAgICAgICAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgICAgIC8vIElmIHRoZSBzY2hlbWEgZG9lc24ndCBleGlzdCwgcHJldGVuZCBpdCBleGlzdHMgd2l0aCBubyBmaWVsZHMuIFRoaXMgYmVoYXZpb3JcbiAgICAgICAgICAgICAgLy8gd2lsbCBsaWtlbHkgbmVlZCByZXZpc2l0aW5nLlxuICAgICAgICAgICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICByZXR1cm4geyBmaWVsZHM6IHt9IH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAudGhlbihwYXJzZUZvcm1hdFNjaGVtYSA9PiB0aGlzLmFkYXB0ZXIuZGVsZXRlT2JqZWN0c0J5UXVlcnkoY2xhc3NOYW1lLCBwYXJzZUZvcm1hdFNjaGVtYSwgcXVlcnkpKVxuICAgICAgICAgICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICAgICAgICAvLyBXaGVuIGRlbGV0aW5nIHNlc3Npb25zIHdoaWxlIGNoYW5naW5nIHBhc3N3b3JkcywgZG9uJ3QgdGhyb3cgYW4gZXJyb3IgaWYgdGhleSBkb24ndCBoYXZlIGFueSBzZXNzaW9ucy5cbiAgICAgICAgICAgICAgICBpZiAoY2xhc3NOYW1lID09PSBcIl9TZXNzaW9uXCIgJiYgZXJyb3IuY29kZSA9PT0gUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCkge1xuICAgICAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7fSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgLy8gSW5zZXJ0cyBhbiBvYmplY3QgaW50byB0aGUgZGF0YWJhc2UuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgc3VjY2Vzc2Z1bGx5IGlmZiB0aGUgb2JqZWN0IHNhdmVkLlxuICBjcmVhdGUoY2xhc3NOYW1lOiBzdHJpbmcsIG9iamVjdDogYW55LCB7IGFjbCB9OiBRdWVyeU9wdGlvbnMgPSB7fSk6IFByb21pc2U8YW55PiB7XG4gIC8vIE1ha2UgYSBjb3B5IG9mIHRoZSBvYmplY3QsIHNvIHdlIGRvbid0IG11dGF0ZSB0aGUgaW5jb21pbmcgZGF0YS5cbiAgICBjb25zdCBvcmlnaW5hbE9iamVjdCA9IG9iamVjdDtcbiAgICBvYmplY3QgPSB0cmFuc2Zvcm1PYmplY3RBQ0wob2JqZWN0KTtcblxuICAgIG9iamVjdC5jcmVhdGVkQXQgPSB7IGlzbzogb2JqZWN0LmNyZWF0ZWRBdCwgX190eXBlOiAnRGF0ZScgfTtcbiAgICBvYmplY3QudXBkYXRlZEF0ID0geyBpc286IG9iamVjdC51cGRhdGVkQXQsIF9fdHlwZTogJ0RhdGUnIH07XG5cbiAgICB2YXIgaXNNYXN0ZXIgPSBhY2wgPT09IHVuZGVmaW5lZDtcbiAgICB2YXIgYWNsR3JvdXAgPSBhY2wgfHwgW107XG4gICAgY29uc3QgcmVsYXRpb25VcGRhdGVzID0gdGhpcy5jb2xsZWN0UmVsYXRpb25VcGRhdGVzKGNsYXNzTmFtZSwgbnVsbCwgb2JqZWN0KTtcbiAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUNsYXNzTmFtZShjbGFzc05hbWUpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLmxvYWRTY2hlbWEoKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4ge1xuICAgICAgICByZXR1cm4gKGlzTWFzdGVyID8gUHJvbWlzZS5yZXNvbHZlKCkgOiBzY2hlbWFDb250cm9sbGVyLnZhbGlkYXRlUGVybWlzc2lvbihjbGFzc05hbWUsIGFjbEdyb3VwLCAnY3JlYXRlJykpXG4gICAgICAgICAgLnRoZW4oKCkgPT4gc2NoZW1hQ29udHJvbGxlci5lbmZvcmNlQ2xhc3NFeGlzdHMoY2xhc3NOYW1lKSlcbiAgICAgICAgICAudGhlbigoKSA9PiBzY2hlbWFDb250cm9sbGVyLnJlbG9hZERhdGEoKSlcbiAgICAgICAgICAudGhlbigoKSA9PiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYShjbGFzc05hbWUsIHRydWUpKVxuICAgICAgICAgIC50aGVuKHNjaGVtYSA9PiB7XG4gICAgICAgICAgICB0cmFuc2Zvcm1BdXRoRGF0YShjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKTtcbiAgICAgICAgICAgIGZsYXR0ZW5VcGRhdGVPcGVyYXRvcnNGb3JDcmVhdGUob2JqZWN0KTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuY3JlYXRlT2JqZWN0KGNsYXNzTmFtZSwgU2NoZW1hQ29udHJvbGxlci5jb252ZXJ0U2NoZW1hVG9BZGFwdGVyU2NoZW1hKHNjaGVtYSksIG9iamVjdCk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbihyZXN1bHQgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlUmVsYXRpb25VcGRhdGVzKGNsYXNzTmFtZSwgb2JqZWN0Lm9iamVjdElkLCBvYmplY3QsIHJlbGF0aW9uVXBkYXRlcykudGhlbigoKSA9PiB7XG4gICAgICAgICAgICAgIHJldHVybiBzYW5pdGl6ZURhdGFiYXNlUmVzdWx0KG9yaWdpbmFsT2JqZWN0LCByZXN1bHQub3BzWzBdKVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICB9XG5cbiAgY2FuQWRkRmllbGQoc2NoZW1hOiBTY2hlbWFDb250cm9sbGVyLlNjaGVtYUNvbnRyb2xsZXIsIGNsYXNzTmFtZTogc3RyaW5nLCBvYmplY3Q6IGFueSwgYWNsR3JvdXA6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY2xhc3NTY2hlbWEgPSBzY2hlbWEuZGF0YVtjbGFzc05hbWVdO1xuICAgIGlmICghY2xhc3NTY2hlbWEpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgY29uc3QgZmllbGRzID0gT2JqZWN0LmtleXMob2JqZWN0KTtcbiAgICBjb25zdCBzY2hlbWFGaWVsZHMgPSBPYmplY3Qua2V5cyhjbGFzc1NjaGVtYSk7XG4gICAgY29uc3QgbmV3S2V5cyA9IGZpZWxkcy5maWx0ZXIoKGZpZWxkKSA9PiB7XG4gICAgICAvLyBTa2lwIGZpZWxkcyB0aGF0IGFyZSB1bnNldFxuICAgICAgaWYgKG9iamVjdFtmaWVsZF0gJiYgb2JqZWN0W2ZpZWxkXS5fX29wICYmIG9iamVjdFtmaWVsZF0uX19vcCA9PT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHNjaGVtYUZpZWxkcy5pbmRleE9mKGZpZWxkKSA8IDA7XG4gICAgfSk7XG4gICAgaWYgKG5ld0tleXMubGVuZ3RoID4gMCkge1xuICAgICAgcmV0dXJuIHNjaGVtYS52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgJ2FkZEZpZWxkJyk7XG4gICAgfVxuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8vIFdvbid0IGRlbGV0ZSBjb2xsZWN0aW9ucyBpbiB0aGUgc3lzdGVtIG5hbWVzcGFjZVxuICAvKipcbiAgICogRGVsZXRlIGFsbCBjbGFzc2VzIGFuZCBjbGVhcnMgdGhlIHNjaGVtYSBjYWNoZVxuICAgKlxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IGZhc3Qgc2V0IHRvIHRydWUgaWYgaXQncyBvayB0byBqdXN0IGRlbGV0ZSByb3dzIGFuZCBub3QgaW5kZXhlc1xuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gd2hlbiB0aGUgZGVsZXRpb25zIGNvbXBsZXRlc1xuICAgKi9cbiAgZGVsZXRlRXZlcnl0aGluZyhmYXN0OiBib29sZWFuID0gZmFsc2UpOiBQcm9taXNlPGFueT4ge1xuICAgIHRoaXMuc2NoZW1hUHJvbWlzZSA9IG51bGw7XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKFtcbiAgICAgIHRoaXMuYWRhcHRlci5kZWxldGVBbGxDbGFzc2VzKGZhc3QpLFxuICAgICAgdGhpcy5zY2hlbWFDYWNoZS5jbGVhcigpXG4gICAgXSk7XG4gIH1cblxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIGxpc3Qgb2YgcmVsYXRlZCBpZHMgZ2l2ZW4gYW4gb3duaW5nIGlkLlxuICAvLyBjbGFzc05hbWUgaGVyZSBpcyB0aGUgb3duaW5nIGNsYXNzTmFtZS5cbiAgcmVsYXRlZElkcyhjbGFzc05hbWU6IHN0cmluZywga2V5OiBzdHJpbmcsIG93bmluZ0lkOiBzdHJpbmcsIHF1ZXJ5T3B0aW9uczogUXVlcnlPcHRpb25zKTogUHJvbWlzZTxBcnJheTxzdHJpbmc+PiB7XG4gICAgY29uc3QgeyBza2lwLCBsaW1pdCwgc29ydCB9ID0gcXVlcnlPcHRpb25zO1xuICAgIGNvbnN0IGZpbmRPcHRpb25zID0ge307XG4gICAgaWYgKHNvcnQgJiYgc29ydC5jcmVhdGVkQXQgJiYgdGhpcy5hZGFwdGVyLmNhblNvcnRPbkpvaW5UYWJsZXMpIHtcbiAgICAgIGZpbmRPcHRpb25zLnNvcnQgPSB7ICdfaWQnIDogc29ydC5jcmVhdGVkQXQgfTtcbiAgICAgIGZpbmRPcHRpb25zLmxpbWl0ID0gbGltaXQ7XG4gICAgICBmaW5kT3B0aW9ucy5za2lwID0gc2tpcDtcbiAgICAgIHF1ZXJ5T3B0aW9ucy5za2lwID0gMDtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5maW5kKGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBrZXkpLCByZWxhdGlvblNjaGVtYSwgeyBvd25pbmdJZCB9LCBmaW5kT3B0aW9ucylcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4gcmVzdWx0cy5tYXAocmVzdWx0ID0+IHJlc3VsdC5yZWxhdGVkSWQpKTtcbiAgfVxuXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIGZvciBhIGxpc3Qgb2Ygb3duaW5nIGlkcyBnaXZlbiBzb21lIHJlbGF0ZWQgaWRzLlxuICAvLyBjbGFzc05hbWUgaGVyZSBpcyB0aGUgb3duaW5nIGNsYXNzTmFtZS5cbiAgb3duaW5nSWRzKGNsYXNzTmFtZTogc3RyaW5nLCBrZXk6IHN0cmluZywgcmVsYXRlZElkczogc3RyaW5nW10pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5maW5kKGpvaW5UYWJsZU5hbWUoY2xhc3NOYW1lLCBrZXkpLCByZWxhdGlvblNjaGVtYSwgeyByZWxhdGVkSWQ6IHsgJyRpbic6IHJlbGF0ZWRJZHMgfSB9LCB7fSlcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4gcmVzdWx0cy5tYXAocmVzdWx0ID0+IHJlc3VsdC5vd25pbmdJZCkpO1xuICB9XG5cbiAgLy8gTW9kaWZpZXMgcXVlcnkgc28gdGhhdCBpdCBubyBsb25nZXIgaGFzICRpbiBvbiByZWxhdGlvbiBmaWVsZHMsIG9yXG4gIC8vIGVxdWFsLXRvLXBvaW50ZXIgY29uc3RyYWludHMgb24gcmVsYXRpb24gZmllbGRzLlxuICAvLyBSZXR1cm5zIGEgcHJvbWlzZSB0aGF0IHJlc29sdmVzIHdoZW4gcXVlcnkgaXMgbXV0YXRlZFxuICByZWR1Y2VJblJlbGF0aW9uKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogYW55LCBzY2hlbWE6IGFueSk6IFByb21pc2U8YW55PiB7XG4gIC8vIFNlYXJjaCBmb3IgYW4gaW4tcmVsYXRpb24gb3IgZXF1YWwtdG8tcmVsYXRpb25cbiAgLy8gTWFrZSBpdCBzZXF1ZW50aWFsIGZvciBub3csIG5vdCBzdXJlIG9mIHBhcmFsbGVpemF0aW9uIHNpZGUgZWZmZWN0c1xuICAgIGlmIChxdWVyeVsnJG9yJ10pIHtcbiAgICAgIGNvbnN0IG9ycyA9IHF1ZXJ5Wyckb3InXTtcbiAgICAgIHJldHVybiBQcm9taXNlLmFsbChvcnMubWFwKChhUXVlcnksIGluZGV4KSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlZHVjZUluUmVsYXRpb24oY2xhc3NOYW1lLCBhUXVlcnksIHNjaGVtYSkudGhlbigoYVF1ZXJ5KSA9PiB7XG4gICAgICAgICAgcXVlcnlbJyRvciddW2luZGV4XSA9IGFRdWVyeTtcbiAgICAgICAgfSk7XG4gICAgICB9KSkudGhlbigoKSA9PiB7XG4gICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUocXVlcnkpO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgY29uc3QgcHJvbWlzZXMgPSBPYmplY3Qua2V5cyhxdWVyeSkubWFwKChrZXkpID0+IHtcbiAgICAgIGNvbnN0IHQgPSBzY2hlbWEuZ2V0RXhwZWN0ZWRUeXBlKGNsYXNzTmFtZSwga2V5KTtcbiAgICAgIGlmICghdCB8fCB0LnR5cGUgIT09ICdSZWxhdGlvbicpIHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShxdWVyeSk7XG4gICAgICB9XG4gICAgICBsZXQgcXVlcmllczogP2FueVtdID0gbnVsbDtcbiAgICAgIGlmIChxdWVyeVtrZXldICYmIChxdWVyeVtrZXldWyckaW4nXSB8fCBxdWVyeVtrZXldWyckbmUnXSB8fCBxdWVyeVtrZXldWyckbmluJ10gfHwgcXVlcnlba2V5XS5fX3R5cGUgPT0gJ1BvaW50ZXInKSkge1xuICAgICAgLy8gQnVpbGQgdGhlIGxpc3Qgb2YgcXVlcmllc1xuICAgICAgICBxdWVyaWVzID0gT2JqZWN0LmtleXMocXVlcnlba2V5XSkubWFwKChjb25zdHJhaW50S2V5KSA9PiB7XG4gICAgICAgICAgbGV0IHJlbGF0ZWRJZHM7XG4gICAgICAgICAgbGV0IGlzTmVnYXRpb24gPSBmYWxzZTtcbiAgICAgICAgICBpZiAoY29uc3RyYWludEtleSA9PT0gJ29iamVjdElkJykge1xuICAgICAgICAgICAgcmVsYXRlZElkcyA9IFtxdWVyeVtrZXldLm9iamVjdElkXTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGNvbnN0cmFpbnRLZXkgPT0gJyRpbicpIHtcbiAgICAgICAgICAgIHJlbGF0ZWRJZHMgPSBxdWVyeVtrZXldWyckaW4nXS5tYXAociA9PiByLm9iamVjdElkKTtcbiAgICAgICAgICB9IGVsc2UgaWYgKGNvbnN0cmFpbnRLZXkgPT0gJyRuaW4nKSB7XG4gICAgICAgICAgICBpc05lZ2F0aW9uID0gdHJ1ZTtcbiAgICAgICAgICAgIHJlbGF0ZWRJZHMgPSBxdWVyeVtrZXldWyckbmluJ10ubWFwKHIgPT4gci5vYmplY3RJZCk7XG4gICAgICAgICAgfSBlbHNlIGlmIChjb25zdHJhaW50S2V5ID09ICckbmUnKSB7XG4gICAgICAgICAgICBpc05lZ2F0aW9uID0gdHJ1ZTtcbiAgICAgICAgICAgIHJlbGF0ZWRJZHMgPSBbcXVlcnlba2V5XVsnJG5lJ10ub2JqZWN0SWRdO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiB7XG4gICAgICAgICAgICBpc05lZ2F0aW9uLFxuICAgICAgICAgICAgcmVsYXRlZElkc1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBxdWVyaWVzID0gW3tpc05lZ2F0aW9uOiBmYWxzZSwgcmVsYXRlZElkczogW119XTtcbiAgICAgIH1cblxuICAgICAgLy8gcmVtb3ZlIHRoZSBjdXJyZW50IHF1ZXJ5S2V5IGFzIHdlIGRvbix0IG5lZWQgaXQgYW55bW9yZVxuICAgICAgZGVsZXRlIHF1ZXJ5W2tleV07XG4gICAgICAvLyBleGVjdXRlIGVhY2ggcXVlcnkgaW5kZXBlbmRlbnRseSB0byBidWlsZCB0aGUgbGlzdCBvZlxuICAgICAgLy8gJGluIC8gJG5pblxuICAgICAgY29uc3QgcHJvbWlzZXMgPSBxdWVyaWVzLm1hcCgocSkgPT4ge1xuICAgICAgICBpZiAoIXEpIHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMub3duaW5nSWRzKGNsYXNzTmFtZSwga2V5LCBxLnJlbGF0ZWRJZHMpLnRoZW4oKGlkcykgPT4ge1xuICAgICAgICAgIGlmIChxLmlzTmVnYXRpb24pIHtcbiAgICAgICAgICAgIHRoaXMuYWRkTm90SW5PYmplY3RJZHNJZHMoaWRzLCBxdWVyeSk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuYWRkSW5PYmplY3RJZHNJZHMoaWRzLCBxdWVyeSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSlcblxuICAgIH0pXG5cbiAgICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZShxdWVyeSk7XG4gICAgfSlcbiAgfVxuXG4gIC8vIE1vZGlmaWVzIHF1ZXJ5IHNvIHRoYXQgaXQgbm8gbG9uZ2VyIGhhcyAkcmVsYXRlZFRvXG4gIC8vIFJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVzb2x2ZXMgd2hlbiBxdWVyeSBpcyBtdXRhdGVkXG4gIHJlZHVjZVJlbGF0aW9uS2V5cyhjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IGFueSwgcXVlcnlPcHRpb25zOiBhbnkpOiA/UHJvbWlzZTx2b2lkPiB7XG5cbiAgICBpZiAocXVlcnlbJyRvciddKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5hbGwocXVlcnlbJyRvciddLm1hcCgoYVF1ZXJ5KSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLnJlZHVjZVJlbGF0aW9uS2V5cyhjbGFzc05hbWUsIGFRdWVyeSwgcXVlcnlPcHRpb25zKTtcbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICB2YXIgcmVsYXRlZFRvID0gcXVlcnlbJyRyZWxhdGVkVG8nXTtcbiAgICBpZiAocmVsYXRlZFRvKSB7XG4gICAgICByZXR1cm4gdGhpcy5yZWxhdGVkSWRzKFxuICAgICAgICByZWxhdGVkVG8ub2JqZWN0LmNsYXNzTmFtZSxcbiAgICAgICAgcmVsYXRlZFRvLmtleSxcbiAgICAgICAgcmVsYXRlZFRvLm9iamVjdC5vYmplY3RJZCxcbiAgICAgICAgcXVlcnlPcHRpb25zKVxuICAgICAgICAudGhlbigoaWRzKSA9PiB7XG4gICAgICAgICAgZGVsZXRlIHF1ZXJ5WyckcmVsYXRlZFRvJ107XG4gICAgICAgICAgdGhpcy5hZGRJbk9iamVjdElkc0lkcyhpZHMsIHF1ZXJ5KTtcbiAgICAgICAgICByZXR1cm4gdGhpcy5yZWR1Y2VSZWxhdGlvbktleXMoY2xhc3NOYW1lLCBxdWVyeSwgcXVlcnlPcHRpb25zKTtcbiAgICAgICAgfSkudGhlbigoKSA9PiB7fSk7XG4gICAgfVxuICB9XG5cbiAgYWRkSW5PYmplY3RJZHNJZHMoaWRzOiA/QXJyYXk8c3RyaW5nPiA9IG51bGwsIHF1ZXJ5OiBhbnkpIHtcbiAgICBjb25zdCBpZHNGcm9tU3RyaW5nOiA/QXJyYXk8c3RyaW5nPiA9IHR5cGVvZiBxdWVyeS5vYmplY3RJZCA9PT0gJ3N0cmluZycgPyBbcXVlcnkub2JqZWN0SWRdIDogbnVsbDtcbiAgICBjb25zdCBpZHNGcm9tRXE6ID9BcnJheTxzdHJpbmc+ID0gcXVlcnkub2JqZWN0SWQgJiYgcXVlcnkub2JqZWN0SWRbJyRlcSddID8gW3F1ZXJ5Lm9iamVjdElkWyckZXEnXV0gOiBudWxsO1xuICAgIGNvbnN0IGlkc0Zyb21JbjogP0FycmF5PHN0cmluZz4gPSBxdWVyeS5vYmplY3RJZCAmJiBxdWVyeS5vYmplY3RJZFsnJGluJ10gPyBxdWVyeS5vYmplY3RJZFsnJGluJ10gOiBudWxsO1xuXG4gICAgLy8gQGZsb3ctZGlzYWJsZS1uZXh0XG4gICAgY29uc3QgYWxsSWRzOiBBcnJheTxBcnJheTxzdHJpbmc+PiA9IFtpZHNGcm9tU3RyaW5nLCBpZHNGcm9tRXEsIGlkc0Zyb21JbiwgaWRzXS5maWx0ZXIobGlzdCA9PiBsaXN0ICE9PSBudWxsKTtcbiAgICBjb25zdCB0b3RhbExlbmd0aCA9IGFsbElkcy5yZWR1Y2UoKG1lbW8sIGxpc3QpID0+IG1lbW8gKyBsaXN0Lmxlbmd0aCwgMCk7XG5cbiAgICBsZXQgaWRzSW50ZXJzZWN0aW9uID0gW107XG4gICAgaWYgKHRvdGFsTGVuZ3RoID4gMTI1KSB7XG4gICAgICBpZHNJbnRlcnNlY3Rpb24gPSBpbnRlcnNlY3QuYmlnKGFsbElkcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlkc0ludGVyc2VjdGlvbiA9IGludGVyc2VjdChhbGxJZHMpO1xuICAgIH1cblxuICAgIC8vIE5lZWQgdG8gbWFrZSBzdXJlIHdlIGRvbid0IGNsb2JiZXIgZXhpc3Rpbmcgc2hvcnRoYW5kICRlcSBjb25zdHJhaW50cyBvbiBvYmplY3RJZC5cbiAgICBpZiAoISgnb2JqZWN0SWQnIGluIHF1ZXJ5KSkge1xuICAgICAgcXVlcnkub2JqZWN0SWQgPSB7XG4gICAgICAgICRpbjogdW5kZWZpbmVkLFxuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBxdWVyeS5vYmplY3RJZCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHF1ZXJ5Lm9iamVjdElkID0ge1xuICAgICAgICAkaW46IHVuZGVmaW5lZCxcbiAgICAgICAgJGVxOiBxdWVyeS5vYmplY3RJZFxuICAgICAgfTtcbiAgICB9XG4gICAgcXVlcnkub2JqZWN0SWRbJyRpbiddID0gaWRzSW50ZXJzZWN0aW9uO1xuXG4gICAgcmV0dXJuIHF1ZXJ5O1xuICB9XG5cbiAgYWRkTm90SW5PYmplY3RJZHNJZHMoaWRzOiBzdHJpbmdbXSA9IFtdLCBxdWVyeTogYW55KSB7XG4gICAgY29uc3QgaWRzRnJvbU5pbiA9IHF1ZXJ5Lm9iamVjdElkICYmIHF1ZXJ5Lm9iamVjdElkWyckbmluJ10gPyBxdWVyeS5vYmplY3RJZFsnJG5pbiddIDogW107XG4gICAgbGV0IGFsbElkcyA9IFsuLi5pZHNGcm9tTmluLC4uLmlkc10uZmlsdGVyKGxpc3QgPT4gbGlzdCAhPT0gbnVsbCk7XG5cbiAgICAvLyBtYWtlIGEgc2V0IGFuZCBzcHJlYWQgdG8gcmVtb3ZlIGR1cGxpY2F0ZXNcbiAgICBhbGxJZHMgPSBbLi4ubmV3IFNldChhbGxJZHMpXTtcblxuICAgIC8vIE5lZWQgdG8gbWFrZSBzdXJlIHdlIGRvbid0IGNsb2JiZXIgZXhpc3Rpbmcgc2hvcnRoYW5kICRlcSBjb25zdHJhaW50cyBvbiBvYmplY3RJZC5cbiAgICBpZiAoISgnb2JqZWN0SWQnIGluIHF1ZXJ5KSkge1xuICAgICAgcXVlcnkub2JqZWN0SWQgPSB7XG4gICAgICAgICRuaW46IHVuZGVmaW5lZCxcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcXVlcnkub2JqZWN0SWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICBxdWVyeS5vYmplY3RJZCA9IHtcbiAgICAgICAgJG5pbjogdW5kZWZpbmVkLFxuICAgICAgICAkZXE6IHF1ZXJ5Lm9iamVjdElkXG4gICAgICB9O1xuICAgIH1cblxuICAgIHF1ZXJ5Lm9iamVjdElkWyckbmluJ10gPSBhbGxJZHM7XG4gICAgcmV0dXJuIHF1ZXJ5O1xuICB9XG5cbiAgLy8gUnVucyBhIHF1ZXJ5IG9uIHRoZSBkYXRhYmFzZS5cbiAgLy8gUmV0dXJucyBhIHByb21pc2UgdGhhdCByZXNvbHZlcyB0byBhIGxpc3Qgb2YgaXRlbXMuXG4gIC8vIE9wdGlvbnM6XG4gIC8vICAgc2tpcCAgICBudW1iZXIgb2YgcmVzdWx0cyB0byBza2lwLlxuICAvLyAgIGxpbWl0ICAgbGltaXQgdG8gdGhpcyBudW1iZXIgb2YgcmVzdWx0cy5cbiAgLy8gICBzb3J0ICAgIGFuIG9iamVjdCB3aGVyZSBrZXlzIGFyZSB0aGUgZmllbGRzIHRvIHNvcnQgYnkuXG4gIC8vICAgICAgICAgICB0aGUgdmFsdWUgaXMgKzEgZm9yIGFzY2VuZGluZywgLTEgZm9yIGRlc2NlbmRpbmcuXG4gIC8vICAgY291bnQgICBydW4gYSBjb3VudCBpbnN0ZWFkIG9mIHJldHVybmluZyByZXN1bHRzLlxuICAvLyAgIGFjbCAgICAgcmVzdHJpY3QgdGhpcyBvcGVyYXRpb24gd2l0aCBhbiBBQ0wgZm9yIHRoZSBwcm92aWRlZCBhcnJheVxuICAvLyAgICAgICAgICAgb2YgdXNlciBvYmplY3RJZHMgYW5kIHJvbGVzLiBhY2w6IG51bGwgbWVhbnMgbm8gdXNlci5cbiAgLy8gICAgICAgICAgIHdoZW4gdGhpcyBmaWVsZCBpcyBub3QgcHJlc2VudCwgZG9uJ3QgZG8gYW55dGhpbmcgcmVnYXJkaW5nIEFDTHMuXG4gIC8vIFRPRE86IG1ha2UgdXNlcklkcyBub3QgbmVlZGVkIGhlcmUuIFRoZSBkYiBhZGFwdGVyIHNob3VsZG4ndCBrbm93XG4gIC8vIGFueXRoaW5nIGFib3V0IHVzZXJzLCBpZGVhbGx5LiBUaGVuLCBpbXByb3ZlIHRoZSBmb3JtYXQgb2YgdGhlIEFDTFxuICAvLyBhcmcgdG8gd29yayBsaWtlIHRoZSBvdGhlcnMuXG4gIGZpbmQoY2xhc3NOYW1lOiBzdHJpbmcsIHF1ZXJ5OiBhbnksIHtcbiAgICBza2lwLFxuICAgIGxpbWl0LFxuICAgIGFjbCxcbiAgICBzb3J0ID0ge30sXG4gICAgY291bnQsXG4gICAga2V5cyxcbiAgICBvcCxcbiAgICBkaXN0aW5jdCxcbiAgICBwaXBlbGluZSxcbiAgICByZWFkUHJlZmVyZW5jZSxcbiAgICBpc1dyaXRlLFxuICB9OiBhbnkgPSB7fSk6IFByb21pc2U8YW55PiB7XG4gICAgY29uc3QgaXNNYXN0ZXIgPSBhY2wgPT09IHVuZGVmaW5lZDtcbiAgICBjb25zdCBhY2xHcm91cCA9IGFjbCB8fCBbXTtcbiAgICBvcCA9IG9wIHx8ICh0eXBlb2YgcXVlcnkub2JqZWN0SWQgPT0gJ3N0cmluZycgJiYgT2JqZWN0LmtleXMocXVlcnkpLmxlbmd0aCA9PT0gMSA/ICdnZXQnIDogJ2ZpbmQnKTtcbiAgICAvLyBDb3VudCBvcGVyYXRpb24gaWYgY291bnRpbmdcbiAgICBvcCA9IChjb3VudCA9PT0gdHJ1ZSA/ICdjb3VudCcgOiBvcCk7XG5cbiAgICBsZXQgY2xhc3NFeGlzdHMgPSB0cnVlO1xuICAgIHJldHVybiB0aGlzLmxvYWRTY2hlbWEoKVxuICAgICAgLnRoZW4oc2NoZW1hQ29udHJvbGxlciA9PiB7XG4gICAgICAgIC8vQWxsb3cgdm9sYXRpbGUgY2xhc3NlcyBpZiBxdWVyeWluZyB3aXRoIE1hc3RlciAoZm9yIF9QdXNoU3RhdHVzKVxuICAgICAgICAvL1RPRE86IE1vdmUgdm9sYXRpbGUgY2xhc3NlcyBjb25jZXB0IGludG8gbW9uZ28gYWRhcHRlciwgcG9zdGdyZXMgYWRhcHRlciBzaG91bGRuJ3QgY2FyZVxuICAgICAgICAvL3RoYXQgYXBpLnBhcnNlLmNvbSBicmVha3Mgd2hlbiBfUHVzaFN0YXR1cyBleGlzdHMgaW4gbW9uZ28uXG4gICAgICAgIHJldHVybiBzY2hlbWFDb250cm9sbGVyLmdldE9uZVNjaGVtYShjbGFzc05hbWUsIGlzTWFzdGVyKVxuICAgICAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgICAgLy8gQmVoYXZpb3IgZm9yIG5vbi1leGlzdGVudCBjbGFzc2VzIGlzIGtpbmRhIHdlaXJkIG9uIFBhcnNlLmNvbS4gUHJvYmFibHkgZG9lc24ndCBtYXR0ZXIgdG9vIG11Y2guXG4gICAgICAgICAgLy8gRm9yIG5vdywgcHJldGVuZCB0aGUgY2xhc3MgZXhpc3RzIGJ1dCBoYXMgbm8gb2JqZWN0cyxcbiAgICAgICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgIGNsYXNzRXhpc3RzID0gZmFsc2U7XG4gICAgICAgICAgICAgIHJldHVybiB7IGZpZWxkczoge30gfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICAgIH0pXG4gICAgICAgICAgLnRoZW4oc2NoZW1hID0+IHtcbiAgICAgICAgICAvLyBQYXJzZS5jb20gdHJlYXRzIHF1ZXJpZXMgb24gX2NyZWF0ZWRfYXQgYW5kIF91cGRhdGVkX2F0IGFzIGlmIHRoZXkgd2VyZSBxdWVyaWVzIG9uIGNyZWF0ZWRBdCBhbmQgdXBkYXRlZEF0LFxuICAgICAgICAgIC8vIHNvIGR1cGxpY2F0ZSB0aGF0IGJlaGF2aW9yIGhlcmUuIElmIGJvdGggYXJlIHNwZWNpZmllZCwgdGhlIGNvcnJlY3QgYmVoYXZpb3IgdG8gbWF0Y2ggUGFyc2UuY29tIGlzIHRvXG4gICAgICAgICAgLy8gdXNlIHRoZSBvbmUgdGhhdCBhcHBlYXJzIGZpcnN0IGluIHRoZSBzb3J0IGxpc3QuXG4gICAgICAgICAgICBpZiAoc29ydC5fY3JlYXRlZF9hdCkge1xuICAgICAgICAgICAgICBzb3J0LmNyZWF0ZWRBdCA9IHNvcnQuX2NyZWF0ZWRfYXQ7XG4gICAgICAgICAgICAgIGRlbGV0ZSBzb3J0Ll9jcmVhdGVkX2F0O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHNvcnQuX3VwZGF0ZWRfYXQpIHtcbiAgICAgICAgICAgICAgc29ydC51cGRhdGVkQXQgPSBzb3J0Ll91cGRhdGVkX2F0O1xuICAgICAgICAgICAgICBkZWxldGUgc29ydC5fdXBkYXRlZF9hdDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGNvbnN0IHF1ZXJ5T3B0aW9ucyA9IHsgc2tpcCwgbGltaXQsIHNvcnQsIGtleXMsIHJlYWRQcmVmZXJlbmNlIH07XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhzb3J0KS5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICAgICAgICAgIGlmIChmaWVsZE5hbWUubWF0Y2goL15hdXRoRGF0YVxcLihbYS16QS1aMC05X10rKVxcLmlkJC8pKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfS0VZX05BTUUsIGBDYW5ub3Qgc29ydCBieSAke2ZpZWxkTmFtZX1gKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBjb25zdCByb290RmllbGROYW1lID0gZ2V0Um9vdEZpZWxkTmFtZShmaWVsZE5hbWUpO1xuICAgICAgICAgICAgICBpZiAoIVNjaGVtYUNvbnRyb2xsZXIuZmllbGROYW1lSXNWYWxpZChyb290RmllbGROYW1lKSkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCBgSW52YWxpZCBmaWVsZCBuYW1lOiAke2ZpZWxkTmFtZX0uYCk7XG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIChpc01hc3RlciA/IFByb21pc2UucmVzb2x2ZSgpIDogc2NoZW1hQ29udHJvbGxlci52YWxpZGF0ZVBlcm1pc3Npb24oY2xhc3NOYW1lLCBhY2xHcm91cCwgb3ApKVxuICAgICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlZHVjZVJlbGF0aW9uS2V5cyhjbGFzc05hbWUsIHF1ZXJ5LCBxdWVyeU9wdGlvbnMpKVxuICAgICAgICAgICAgICAudGhlbigoKSA9PiB0aGlzLnJlZHVjZUluUmVsYXRpb24oY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hQ29udHJvbGxlcikpXG4gICAgICAgICAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoIWlzTWFzdGVyKSB7XG4gICAgICAgICAgICAgICAgICBxdWVyeSA9IHRoaXMuYWRkUG9pbnRlclBlcm1pc3Npb25zKHNjaGVtYUNvbnRyb2xsZXIsIGNsYXNzTmFtZSwgb3AsIHF1ZXJ5LCBhY2xHcm91cCk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghcXVlcnkpIHtcbiAgICAgICAgICAgICAgICAgIGlmIChvcCA9PSAnZ2V0Jykge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ09iamVjdCBub3QgZm91bmQuJyk7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICghaXNNYXN0ZXIpIHtcbiAgICAgICAgICAgICAgICAgIGlmIChpc1dyaXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5ID0gYWRkV3JpdGVBQ0wocXVlcnksIGFjbEdyb3VwKTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHF1ZXJ5ID0gYWRkUmVhZEFDTChxdWVyeSwgYWNsR3JvdXApO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB2YWxpZGF0ZVF1ZXJ5KHF1ZXJ5KTtcbiAgICAgICAgICAgICAgICBpZiAoY291bnQpIHtcbiAgICAgICAgICAgICAgICAgIGlmICghY2xhc3NFeGlzdHMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIDA7XG4gICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmNvdW50KGNsYXNzTmFtZSwgc2NoZW1hLCBxdWVyeSwgcmVhZFByZWZlcmVuY2UpO1xuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0gIGVsc2UgaWYgKGRpc3RpbmN0KSB7XG4gICAgICAgICAgICAgICAgICBpZiAoIWNsYXNzRXhpc3RzKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBbXTtcbiAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZGlzdGluY3QoY2xhc3NOYW1lLCBzY2hlbWEsIHF1ZXJ5LCBkaXN0aW5jdCk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSAgZWxzZSBpZiAocGlwZWxpbmUpIHtcbiAgICAgICAgICAgICAgICAgIGlmICghY2xhc3NFeGlzdHMpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHRoaXMuYWRhcHRlci5hZ2dyZWdhdGUoY2xhc3NOYW1lLCBzY2hlbWEsIHBpcGVsaW5lLCByZWFkUHJlZmVyZW5jZSk7XG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmFkYXB0ZXIuZmluZChjbGFzc05hbWUsIHNjaGVtYSwgcXVlcnksIHF1ZXJ5T3B0aW9ucylcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4ob2JqZWN0cyA9PiBvYmplY3RzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIG9iamVjdCA9IHVudHJhbnNmb3JtT2JqZWN0QUNMKG9iamVjdCk7XG4gICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZpbHRlclNlbnNpdGl2ZURhdGEoaXNNYXN0ZXIsIGFjbEdyb3VwLCBjbGFzc05hbWUsIG9iamVjdClcbiAgICAgICAgICAgICAgICAgICAgfSkpLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlRFUk5BTF9TRVJWRVJfRVJST1IsIGVycm9yKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG5cbiAgZGVsZXRlU2NoZW1hKGNsYXNzTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIHRoaXMubG9hZFNjaGVtYSh7IGNsZWFyQ2FjaGU6IHRydWUgfSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbnRyb2xsZXIgPT4gc2NoZW1hQ29udHJvbGxlci5nZXRPbmVTY2hlbWEoY2xhc3NOYW1lLCB0cnVlKSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvciA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgcmV0dXJuIHsgZmllbGRzOiB7fSB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG4gICAgICB9KVxuICAgICAgLnRoZW4oKHNjaGVtYTogYW55KSA9PiB7XG4gICAgICAgIHJldHVybiB0aGlzLmNvbGxlY3Rpb25FeGlzdHMoY2xhc3NOYW1lKVxuICAgICAgICAgIC50aGVuKCgpID0+IHRoaXMuYWRhcHRlci5jb3VudChjbGFzc05hbWUsIHsgZmllbGRzOiB7fSB9KSlcbiAgICAgICAgICAudGhlbihjb3VudCA9PiB7XG4gICAgICAgICAgICBpZiAoY291bnQgPiAwKSB7XG4gICAgICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcigyNTUsIGBDbGFzcyAke2NsYXNzTmFtZX0gaXMgbm90IGVtcHR5LCBjb250YWlucyAke2NvdW50fSBvYmplY3RzLCBjYW5ub3QgZHJvcCBzY2hlbWEuYCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmRlbGV0ZUNsYXNzKGNsYXNzTmFtZSk7XG4gICAgICAgICAgfSlcbiAgICAgICAgICAudGhlbih3YXNQYXJzZUNvbGxlY3Rpb24gPT4ge1xuICAgICAgICAgICAgaWYgKHdhc1BhcnNlQ29sbGVjdGlvbikge1xuICAgICAgICAgICAgICBjb25zdCByZWxhdGlvbkZpZWxkTmFtZXMgPSBPYmplY3Qua2V5cyhzY2hlbWEuZmllbGRzKS5maWx0ZXIoZmllbGROYW1lID0+IHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUmVsYXRpb24nKTtcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHJlbGF0aW9uRmllbGROYW1lcy5tYXAobmFtZSA9PiB0aGlzLmFkYXB0ZXIuZGVsZXRlQ2xhc3Moam9pblRhYmxlTmFtZShjbGFzc05hbWUsIG5hbWUpKSkpLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSk7XG4gICAgICB9KVxuICB9XG5cbiAgYWRkUG9pbnRlclBlcm1pc3Npb25zKHNjaGVtYTogYW55LCBjbGFzc05hbWU6IHN0cmluZywgb3BlcmF0aW9uOiBzdHJpbmcsIHF1ZXJ5OiBhbnksIGFjbEdyb3VwOiBhbnlbXSA9IFtdKSB7XG4gIC8vIENoZWNrIGlmIGNsYXNzIGhhcyBwdWJsaWMgcGVybWlzc2lvbiBmb3Igb3BlcmF0aW9uXG4gIC8vIElmIHRoZSBCYXNlQ0xQIHBhc3MsIGxldCBnbyB0aHJvdWdoXG4gICAgaWYgKHNjaGVtYS50ZXN0QmFzZUNMUChjbGFzc05hbWUsIGFjbEdyb3VwLCBvcGVyYXRpb24pKSB7XG4gICAgICByZXR1cm4gcXVlcnk7XG4gICAgfVxuICAgIGNvbnN0IHBlcm1zID0gc2NoZW1hLnBlcm1zW2NsYXNzTmFtZV07XG4gICAgY29uc3QgZmllbGQgPSBbJ2dldCcsICdmaW5kJ10uaW5kZXhPZihvcGVyYXRpb24pID4gLTEgPyAncmVhZFVzZXJGaWVsZHMnIDogJ3dyaXRlVXNlckZpZWxkcyc7XG4gICAgY29uc3QgdXNlckFDTCA9IGFjbEdyb3VwLmZpbHRlcigoYWNsKSA9PiB7XG4gICAgICByZXR1cm4gYWNsLmluZGV4T2YoJ3JvbGU6JykgIT0gMCAmJiBhY2wgIT0gJyonO1xuICAgIH0pO1xuICAgIC8vIHRoZSBBQ0wgc2hvdWxkIGhhdmUgZXhhY3RseSAxIHVzZXJcbiAgICBpZiAocGVybXMgJiYgcGVybXNbZmllbGRdICYmIHBlcm1zW2ZpZWxkXS5sZW5ndGggPiAwKSB7XG4gICAgLy8gTm8gdXNlciBzZXQgcmV0dXJuIHVuZGVmaW5lZFxuICAgIC8vIElmIHRoZSBsZW5ndGggaXMgPiAxLCB0aGF0IG1lYW5zIHdlIGRpZG4ndCBkZS1kdXBlIHVzZXJzIGNvcnJlY3RseVxuICAgICAgaWYgKHVzZXJBQ0wubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY29uc3QgdXNlcklkID0gdXNlckFDTFswXTtcbiAgICAgIGNvbnN0IHVzZXJQb2ludGVyID0gIHtcbiAgICAgICAgXCJfX3R5cGVcIjogXCJQb2ludGVyXCIsXG4gICAgICAgIFwiY2xhc3NOYW1lXCI6IFwiX1VzZXJcIixcbiAgICAgICAgXCJvYmplY3RJZFwiOiB1c2VySWRcbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHBlcm1GaWVsZHMgPSBwZXJtc1tmaWVsZF07XG4gICAgICBjb25zdCBvcnMgPSBwZXJtRmllbGRzLm1hcCgoa2V5KSA9PiB7XG4gICAgICAgIGNvbnN0IHEgPSB7XG4gICAgICAgICAgW2tleV06IHVzZXJQb2ludGVyXG4gICAgICAgIH07XG4gICAgICAgIC8vIGlmIHdlIGFscmVhZHkgaGF2ZSBhIGNvbnN0cmFpbnQgb24gdGhlIGtleSwgdXNlIHRoZSAkYW5kXG4gICAgICAgIGlmIChxdWVyeS5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgICAgcmV0dXJuIHsnJGFuZCc6IFtxLCBxdWVyeV19O1xuICAgICAgICB9XG4gICAgICAgIC8vIG90aGVyd2lzZSBqdXN0IGFkZCB0aGUgY29uc3RhaW50XG4gICAgICAgIHJldHVybiBPYmplY3QuYXNzaWduKHt9LCBxdWVyeSwge1xuICAgICAgICAgIFtgJHtrZXl9YF06IHVzZXJQb2ludGVyLFxuICAgICAgICB9KVxuICAgICAgfSk7XG4gICAgICBpZiAob3JzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgcmV0dXJuIHsnJG9yJzogb3JzfTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvcnNbMF07XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBxdWVyeTtcbiAgICB9XG4gIH1cblxuICAvLyBUT0RPOiBjcmVhdGUgaW5kZXhlcyBvbiBmaXJzdCBjcmVhdGlvbiBvZiBhIF9Vc2VyIG9iamVjdC4gT3RoZXJ3aXNlIGl0J3MgaW1wb3NzaWJsZSB0b1xuICAvLyBoYXZlIGEgUGFyc2UgYXBwIHdpdGhvdXQgaXQgaGF2aW5nIGEgX1VzZXIgY29sbGVjdGlvbi5cbiAgcGVyZm9ybUluaXRpYWxpemF0aW9uKCkge1xuICAgIGNvbnN0IHJlcXVpcmVkVXNlckZpZWxkcyA9IHsgZmllbGRzOiB7IC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQsIC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX1VzZXIgfSB9O1xuICAgIGNvbnN0IHJlcXVpcmVkUm9sZUZpZWxkcyA9IHsgZmllbGRzOiB7IC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX0RlZmF1bHQsIC4uLlNjaGVtYUNvbnRyb2xsZXIuZGVmYXVsdENvbHVtbnMuX1JvbGUgfSB9O1xuXG4gICAgY29uc3QgdXNlckNsYXNzUHJvbWlzZSA9IHRoaXMubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzY2hlbWEgPT4gc2NoZW1hLmVuZm9yY2VDbGFzc0V4aXN0cygnX1VzZXInKSlcbiAgICBjb25zdCByb2xlQ2xhc3NQcm9taXNlID0gdGhpcy5sb2FkU2NoZW1hKClcbiAgICAgIC50aGVuKHNjaGVtYSA9PiBzY2hlbWEuZW5mb3JjZUNsYXNzRXhpc3RzKCdfUm9sZScpKVxuXG4gICAgY29uc3QgdXNlcm5hbWVVbmlxdWVuZXNzID0gdXNlckNsYXNzUHJvbWlzZVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5hZGFwdGVyLmVuc3VyZVVuaXF1ZW5lc3MoJ19Vc2VyJywgcmVxdWlyZWRVc2VyRmllbGRzLCBbJ3VzZXJuYW1lJ10pKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgbG9nZ2VyLndhcm4oJ1VuYWJsZSB0byBlbnN1cmUgdW5pcXVlbmVzcyBmb3IgdXNlcm5hbWVzOiAnLCBlcnJvcik7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSk7XG5cbiAgICBjb25zdCBlbWFpbFVuaXF1ZW5lc3MgPSB1c2VyQ2xhc3NQcm9taXNlXG4gICAgICAudGhlbigoKSA9PiB0aGlzLmFkYXB0ZXIuZW5zdXJlVW5pcXVlbmVzcygnX1VzZXInLCByZXF1aXJlZFVzZXJGaWVsZHMsIFsnZW1haWwnXSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBsb2dnZXIud2FybignVW5hYmxlIHRvIGVuc3VyZSB1bmlxdWVuZXNzIGZvciB1c2VyIGVtYWlsIGFkZHJlc3NlczogJywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuXG4gICAgY29uc3Qgcm9sZVVuaXF1ZW5lc3MgPSByb2xlQ2xhc3NQcm9taXNlXG4gICAgICAudGhlbigoKSA9PiB0aGlzLmFkYXB0ZXIuZW5zdXJlVW5pcXVlbmVzcygnX1JvbGUnLCByZXF1aXJlZFJvbGVGaWVsZHMsIFsnbmFtZSddKSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGxvZ2dlci53YXJuKCdVbmFibGUgdG8gZW5zdXJlIHVuaXF1ZW5lc3MgZm9yIHJvbGUgbmFtZTogJywgZXJyb3IpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pO1xuXG4gICAgY29uc3QgaW5kZXhQcm9taXNlID0gdGhpcy5hZGFwdGVyLnVwZGF0ZVNjaGVtYVdpdGhJbmRleGVzKCk7XG5cbiAgICAvLyBDcmVhdGUgdGFibGVzIGZvciB2b2xhdGlsZSBjbGFzc2VzXG4gICAgY29uc3QgYWRhcHRlckluaXQgPSB0aGlzLmFkYXB0ZXIucGVyZm9ybUluaXRpYWxpemF0aW9uKHsgVm9sYXRpbGVDbGFzc2VzU2NoZW1hczogU2NoZW1hQ29udHJvbGxlci5Wb2xhdGlsZUNsYXNzZXNTY2hlbWFzIH0pO1xuICAgIHJldHVybiBQcm9taXNlLmFsbChbdXNlcm5hbWVVbmlxdWVuZXNzLCBlbWFpbFVuaXF1ZW5lc3MsIHJvbGVVbmlxdWVuZXNzLCBhZGFwdGVySW5pdCwgaW5kZXhQcm9taXNlXSk7XG4gIH1cblxuICBzdGF0aWMgX3ZhbGlkYXRlUXVlcnk6ICgoYW55KSA9PiB2b2lkKVxufVxuXG5tb2R1bGUuZXhwb3J0cyA9IERhdGFiYXNlQ29udHJvbGxlcjtcbi8vIEV4cG9zZSB2YWxpZGF0ZVF1ZXJ5IGZvciB0ZXN0c1xubW9kdWxlLmV4cG9ydHMuX3ZhbGlkYXRlUXVlcnkgPSB2YWxpZGF0ZVF1ZXJ5O1xuIl19