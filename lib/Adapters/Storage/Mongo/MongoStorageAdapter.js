'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.MongoStorageAdapter = undefined;

var _MongoCollection = require('./MongoCollection');

var _MongoCollection2 = _interopRequireDefault(_MongoCollection);

var _MongoSchemaCollection = require('./MongoSchemaCollection');

var _MongoSchemaCollection2 = _interopRequireDefault(_MongoSchemaCollection);

var _StorageAdapter = require('../StorageAdapter');

var _mongodbUrl = require('../../../vendor/mongodbUrl');

var _MongoTransform = require('./MongoTransform');

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _defaults = require('../../../defaults');

var _defaults2 = _interopRequireDefault(_defaults);

var _logger = require('../../../logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }
// -disable-next

// -disable-next


// -disable-next
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const ReadPreference = mongodb.ReadPreference;

const MongoSchemaCollectionName = '_SCHEMA';

const storageAdapterAllCollections = mongoAdapter => {
  return mongoAdapter.connect().then(() => mongoAdapter.database.collections()).then(collections => {
    return collections.filter(collection => {
      if (collection.namespace.match(/\.system\./)) {
        return false;
      }
      // TODO: If you have one app with a collection prefix that happens to be a prefix of another
      // apps prefix, this will go very very badly. We should fix that somehow.
      return collection.collectionName.indexOf(mongoAdapter._collectionPrefix) == 0;
    });
  });
};

const convertParseSchemaToMongoSchema = (_ref) => {
  let schema = _objectWithoutProperties(_ref, []);

  delete schema.fields._rperm;
  delete schema.fields._wperm;

  if (schema.className === '_User') {
    // Legacy mongo adapter knows about the difference between password and _hashed_password.
    // Future database adapters will only know about _hashed_password.
    // Note: Parse Server will bring back password with injectDefaultSchema, so we don't need
    // to add _hashed_password back ever.
    delete schema.fields._hashed_password;
  }

  return schema;
};

// Returns { code, error } if invalid, or { result }, an object
// suitable for inserting into _SCHEMA collection, otherwise.
const mongoSchemaFromFieldsAndClassNameAndCLP = (fields, className, classLevelPermissions, indexes) => {
  const mongoObject = {
    _id: className,
    objectId: 'string',
    updatedAt: 'string',
    createdAt: 'string',
    _metadata: undefined
  };

  for (const fieldName in fields) {
    mongoObject[fieldName] = _MongoSchemaCollection2.default.parseFieldTypeToMongoFieldType(fields[fieldName]);
  }

  if (typeof classLevelPermissions !== 'undefined') {
    mongoObject._metadata = mongoObject._metadata || {};
    if (!classLevelPermissions) {
      delete mongoObject._metadata.class_permissions;
    } else {
      mongoObject._metadata.class_permissions = classLevelPermissions;
    }
  }

  if (indexes && typeof indexes === 'object' && Object.keys(indexes).length > 0) {
    mongoObject._metadata = mongoObject._metadata || {};
    mongoObject._metadata.indexes = indexes;
  }

  if (!mongoObject._metadata) {
    // cleanup the unused _metadata
    delete mongoObject._metadata;
  }

  return mongoObject;
};

class MongoStorageAdapter {
  // Private
  constructor({
    uri = _defaults2.default.DefaultMongoURI,
    collectionPrefix = '',
    mongoOptions = {}
  }) {
    this._uri = uri;
    this._collectionPrefix = collectionPrefix;
    this._mongoOptions = mongoOptions;

    // MaxTimeMS is not a global MongoDB client option, it is applied per operation.
    this._maxTimeMS = mongoOptions.maxTimeMS;
    this.canSortOnJoinTables = true;
    delete mongoOptions.maxTimeMS;
  }
  // Public


  connect() {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    // parsing and re-formatting causes the auth value (if there) to get URI
    // encoded
    const encodedUri = (0, _mongodbUrl.format)((0, _mongodbUrl.parse)(this._uri));

    this.connectionPromise = MongoClient.connect(encodedUri, this._mongoOptions).then(client => {
      // Starting mongoDB 3.0, the MongoClient.connect don't return a DB anymore but a client
      // Fortunately, we can get back the options and use them to select the proper DB.
      // https://github.com/mongodb/node-mongodb-native/blob/2c35d76f08574225b8db02d7bef687123e6bb018/lib/mongo_client.js#L885
      const options = client.s.options;
      const database = client.db(options.dbName);
      if (!database) {
        delete this.connectionPromise;
        return;
      }
      database.on('error', () => {
        delete this.connectionPromise;
      });
      database.on('close', () => {
        delete this.connectionPromise;
      });
      this.client = client;
      this.database = database;
    }).catch(err => {
      delete this.connectionPromise;
      return Promise.reject(err);
    });

    return this.connectionPromise;
  }

  handleError(error) {
    if (error && error.code === 13) {
      // Unauthorized error
      delete this.client;
      delete this.database;
      delete this.connectionPromise;
      _logger2.default.error('Received unauthorized error', { error: error });
    }
    throw error;
  }

  handleShutdown() {
    if (!this.client) {
      return;
    }
    this.client.close(false);
  }

  _adaptiveCollection(name) {
    return this.connect().then(() => this.database.collection(this._collectionPrefix + name)).then(rawCollection => new _MongoCollection2.default(rawCollection)).catch(err => this.handleError(err));
  }

  _schemaCollection() {
    return this.connect().then(() => this._adaptiveCollection(MongoSchemaCollectionName)).then(collection => new _MongoSchemaCollection2.default(collection));
  }

  classExists(name) {
    return this.connect().then(() => {
      return this.database.listCollections({ name: this._collectionPrefix + name }).toArray();
    }).then(collections => {
      return collections.length > 0;
    }).catch(err => this.handleError(err));
  }

  setClassLevelPermissions(className, CLPs) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: { '_metadata.class_permissions': CLPs }
    })).catch(err => this.handleError(err));
  }

  setIndexesWithSchemaFormat(className, submittedIndexes, existingIndexes = {}, fields) {
    if (submittedIndexes === undefined) {
      return Promise.resolve();
    }
    if (Object.keys(existingIndexes).length === 0) {
      existingIndexes = { _id_: { _id: 1 } };
    }
    const deletePromises = [];
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
        const promise = this.dropIndex(className, name);
        deletePromises.push(promise);
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
    let insertPromise = Promise.resolve();
    if (insertedIndexes.length > 0) {
      insertPromise = this.createIndexes(className, insertedIndexes);
    }
    return Promise.all(deletePromises).then(() => insertPromise).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, {
      $set: { '_metadata.indexes': existingIndexes }
    })).catch(err => this.handleError(err));
  }

  setIndexesFromMongo(className) {
    return this.getIndexes(className).then(indexes => {
      indexes = indexes.reduce((obj, index) => {
        if (index.key._fts) {
          delete index.key._fts;
          delete index.key._ftsx;
          for (const field in index.weights) {
            index.key[field] = 'text';
          }
        }
        obj[index.name] = index.key;
        return obj;
      }, {});
      return this._schemaCollection().then(schemaCollection => schemaCollection.updateSchema(className, {
        $set: { '_metadata.indexes': indexes }
      }));
    }).catch(err => this.handleError(err)).catch(() => {
      // Ignore if collection not found
      return Promise.resolve();
    });
  }

  createClass(className, schema) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = mongoSchemaFromFieldsAndClassNameAndCLP(schema.fields, className, schema.classLevelPermissions, schema.indexes);
    mongoObject._id = className;
    return this.setIndexesWithSchemaFormat(className, schema.indexes, {}, schema.fields).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.insertSchema(mongoObject)).catch(err => this.handleError(err));
  }

  addFieldIfNotExists(className, fieldName, type) {
    return this._schemaCollection().then(schemaCollection => schemaCollection.addFieldIfNotExists(className, fieldName, type)).then(() => this.createIndexesIfNeeded(className, fieldName, type)).catch(err => this.handleError(err));
  }

  // Drops a collection. Resolves with true if it was a Parse Schema (eg. _User, Custom, etc.)
  // and resolves with false if it wasn't (eg. a join table). Rejects if deletion was impossible.
  deleteClass(className) {
    return this._adaptiveCollection(className).then(collection => collection.drop()).catch(error => {
      // 'ns not found' means collection was already gone. Ignore deletion attempt.
      if (error.message == 'ns not found') {
        return;
      }
      throw error;
    })
    // We've dropped the collection, now remove the _SCHEMA document
    .then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.findAndDeleteSchema(className)).catch(err => this.handleError(err));
  }

  deleteAllClasses(fast) {
    return storageAdapterAllCollections(this).then(collections => Promise.all(collections.map(collection => fast ? collection.remove({}) : collection.drop())));
  }

  // Remove the column and all the data. For Relations, the _Join collection is handled
  // specially, this function does not delete _Join columns. It should, however, indicate
  // that the relation fields does not exist anymore. In mongo, this means removing it from
  // the _SCHEMA collection.  There should be no actual data in the collection under the same name
  // as the relation column, so it's fine to attempt to delete it. If the fields listed to be
  // deleted do not exist, this function should return successfully anyways. Checking for
  // attempts to delete non-existent fields is the responsibility of Parse Server.

  // Pointer field names are passed for legacy reasons: the original mongo
  // format stored pointer field names differently in the database, and therefore
  // needed to know the type of the field before it could delete it. Future database
  // adapters should ignore the pointerFieldNames argument. All the field names are in
  // fieldNames, they show up additionally in the pointerFieldNames database for use
  // by the mongo adapter, which deals with the legacy mongo format.

  // This function is not obligated to delete fields atomically. It is given the field
  // names in a list so that databases that are capable of deleting fields atomically
  // may do so.

  // Returns a Promise.
  deleteFields(className, schema, fieldNames) {
    const mongoFormatNames = fieldNames.map(fieldName => {
      if (schema.fields[fieldName].type === 'Pointer') {
        return `_p_${fieldName}`;
      } else {
        return fieldName;
      }
    });
    const collectionUpdate = { '$unset': {} };
    mongoFormatNames.forEach(name => {
      collectionUpdate['$unset'][name] = null;
    });

    const schemaUpdate = { '$unset': {} };
    fieldNames.forEach(name => {
      schemaUpdate['$unset'][name] = null;
    });

    return this._adaptiveCollection(className).then(collection => collection.updateMany({}, collectionUpdate)).then(() => this._schemaCollection()).then(schemaCollection => schemaCollection.updateSchema(className, schemaUpdate)).catch(err => this.handleError(err));
  }

  // Return a promise for all schemas known to this adapter, in Parse format. In case the
  // schemas cannot be retrieved, returns a promise that rejects. Requirements for the
  // rejection reason are TBD.
  getAllClasses() {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchAllSchemasFrom_SCHEMA()).catch(err => this.handleError(err));
  }

  // Return a promise for the schema with the given name, in Parse format. If
  // this adapter doesn't know about the schema, return a promise that rejects with
  // undefined as the reason.
  getClass(className) {
    return this._schemaCollection().then(schemasCollection => schemasCollection._fetchOneSchemaFrom_SCHEMA(className)).catch(err => this.handleError(err));
  }

  // TODO: As yet not particularly well specified. Creates an object. Maybe shouldn't even need the schema,
  // and should infer from the type. Or maybe does need the schema for validations. Or maybe needs
  // the schema only for the legacy mongo format. We'll figure that out later.
  createObject(className, schema, object) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoObject = (0, _MongoTransform.parseObjectToMongoObjectForCreate)(className, object, schema);
    return this._adaptiveCollection(className).then(collection => collection.insertOne(mongoObject)).catch(error => {
      if (error.code === 11000) {
        // Duplicate value
        const err = new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
        err.underlyingError = error;
        if (error.message) {
          const matches = error.message.match(/index:[\sa-zA-Z0-9_\-\.]+\$?([a-zA-Z_-]+)_1/);
          if (matches && Array.isArray(matches)) {
            err.userInfo = { duplicated_field: matches[1] };
          }
        }
        throw err;
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Remove all objects that match the given Parse Query.
  // If no objects match, reject with OBJECT_NOT_FOUND. If objects are found and deleted, resolve with undefined.
  // If there is some other error, reject with INTERNAL_SERVER_ERROR.
  deleteObjectsByQuery(className, schema, query) {
    schema = convertParseSchemaToMongoSchema(schema);
    return this._adaptiveCollection(className).then(collection => {
      const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
      return collection.deleteMany(mongoWhere);
    }).catch(err => this.handleError(err)).then(({ result }) => {
      if (result.n === 0) {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Object not found.');
      }
      return Promise.resolve();
    }, () => {
      throw new _node2.default.Error(_node2.default.Error.INTERNAL_SERVER_ERROR, 'Database adapter error');
    });
  }

  // Apply the update to all objects that match the given Parse Query.
  updateObjectsByQuery(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.updateMany(mongoWhere, mongoUpdate)).catch(err => this.handleError(err));
  }

  // Atomically finds and updates an object based on query.
  // Return value not currently well specified.
  findOneAndUpdate(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.findAndModify(mongoWhere, [], mongoUpdate, { new: true })).then(result => (0, _MongoTransform.mongoObjectToParseObject)(className, result.value, schema)).catch(error => {
      if (error.code === 11000) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Hopefully we can get rid of this. It's only used for config and hooks.
  upsertOneObject(className, schema, query, update) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoUpdate = (0, _MongoTransform.transformUpdate)(className, update, schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    return this._adaptiveCollection(className).then(collection => collection.upsertOne(mongoWhere, mongoUpdate)).catch(err => this.handleError(err));
  }

  // Executes a find. Accepts: className, query in Parse format, and { skip, limit, sort }.
  find(className, schema, query, { skip, limit, sort, keys, readPreference }) {
    schema = convertParseSchemaToMongoSchema(schema);
    const mongoWhere = (0, _MongoTransform.transformWhere)(className, query, schema);
    const mongoSort = _lodash2.default.mapKeys(sort, (value, fieldName) => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    const mongoKeys = _lodash2.default.reduce(keys, (memo, key) => {
      memo[(0, _MongoTransform.transformKey)(className, key, schema)] = 1;
      return memo;
    }, {});

    readPreference = this._parseReadPreference(readPreference);
    return this.createTextIndexesIfNeeded(className, query, schema).then(() => this._adaptiveCollection(className)).then(collection => collection.find(mongoWhere, {
      skip,
      limit,
      sort: mongoSort,
      keys: mongoKeys,
      maxTimeMS: this._maxTimeMS,
      readPreference
    })).then(objects => objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema))).catch(err => this.handleError(err));
  }

  // Create a unique index. Unique indexes on nullable fields are not allowed. Since we don't
  // currently know which fields are nullable and which aren't, we ignore that criteria.
  // As such, we shouldn't expose this function to users of parse until we have an out-of-band
  // Way of determining if a field is nullable. Undefined doesn't count against uniqueness,
  // which is why we use sparse indexes.
  ensureUniqueness(className, schema, fieldNames) {
    schema = convertParseSchemaToMongoSchema(schema);
    const indexCreationRequest = {};
    const mongoFieldNames = fieldNames.map(fieldName => (0, _MongoTransform.transformKey)(className, fieldName, schema));
    mongoFieldNames.forEach(fieldName => {
      indexCreationRequest[fieldName] = 1;
    });
    return this._adaptiveCollection(className).then(collection => collection._ensureSparseUniqueIndexInBackground(indexCreationRequest)).catch(error => {
      if (error.code === 11000) {
        throw new _node2.default.Error(_node2.default.Error.DUPLICATE_VALUE, 'Tried to ensure field uniqueness for a class that already has duplicates.');
      }
      throw error;
    }).catch(err => this.handleError(err));
  }

  // Used in tests
  _rawFind(className, query) {
    return this._adaptiveCollection(className).then(collection => collection.find(query, {
      maxTimeMS: this._maxTimeMS
    })).catch(err => this.handleError(err));
  }

  // Executes a count.
  count(className, schema, query, readPreference) {
    schema = convertParseSchemaToMongoSchema(schema);
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.count((0, _MongoTransform.transformWhere)(className, query, schema), {
      maxTimeMS: this._maxTimeMS,
      readPreference
    })).catch(err => this.handleError(err));
  }

  distinct(className, schema, query, fieldName) {
    schema = convertParseSchemaToMongoSchema(schema);
    const isPointerField = schema.fields[fieldName] && schema.fields[fieldName].type === 'Pointer';
    if (isPointerField) {
      fieldName = `_p_${fieldName}`;
    }
    return this._adaptiveCollection(className).then(collection => collection.distinct(fieldName, (0, _MongoTransform.transformWhere)(className, query, schema))).then(objects => {
      objects = objects.filter(obj => obj != null);
      return objects.map(object => {
        if (isPointerField) {
          const field = fieldName.substring(3);
          return (0, _MongoTransform.transformPointerString)(schema, field, object);
        }
        return (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema);
      });
    }).catch(err => this.handleError(err));
  }

  aggregate(className, schema, pipeline, readPreference) {
    let isPointerField = false;
    pipeline = pipeline.map(stage => {
      if (stage.$group) {
        stage.$group = this._parseAggregateGroupArgs(schema, stage.$group);
        if (stage.$group._id && typeof stage.$group._id === 'string' && stage.$group._id.indexOf('$_p_') >= 0) {
          isPointerField = true;
        }
      }
      if (stage.$match) {
        stage.$match = this._parseAggregateArgs(schema, stage.$match);
      }
      if (stage.$project) {
        stage.$project = this._parseAggregateProjectArgs(schema, stage.$project);
      }
      return stage;
    });
    readPreference = this._parseReadPreference(readPreference);
    return this._adaptiveCollection(className).then(collection => collection.aggregate(pipeline, { readPreference, maxTimeMS: this._maxTimeMS })).catch(error => {
      if (error.code === 16006) {
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, error.message);
      }
      throw error;
    }).then(results => {
      results.forEach(result => {
        if (result.hasOwnProperty('_id')) {
          if (isPointerField && result._id) {
            result._id = result._id.split('$')[1];
          }
          if (result._id == null || _lodash2.default.isEmpty(result._id)) {
            result._id = null;
          }
          result.objectId = result._id;
          delete result._id;
        }
      });
      return results;
    }).then(objects => objects.map(object => (0, _MongoTransform.mongoObjectToParseObject)(className, object, schema))).catch(err => this.handleError(err));
  }

  // This function will recursively traverse the pipeline and convert any Pointer or Date columns.
  // If we detect a pointer column we will rename the column being queried for to match the column
  // in the database. We also modify the value to what we expect the value to be in the database
  // as well.
  // For dates, the driver expects a Date object, but we have a string coming in. So we'll convert
  // the string to a Date so the driver can perform the necessary comparison.
  //
  // The goal of this method is to look for the "leaves" of the pipeline and determine if it needs
  // to be converted. The pipeline can have a few different forms. For more details, see:
  //     https://docs.mongodb.com/manual/reference/operator/aggregation/
  //
  // If the pipeline is an array, it means we are probably parsing an '$and' or '$or' operator. In
  // that case we need to loop through all of it's children to find the columns being operated on.
  // If the pipeline is an object, then we'll loop through the keys checking to see if the key name
  // matches one of the schema columns. If it does match a column and the column is a Pointer or
  // a Date, then we'll convert the value as described above.
  //
  // As much as I hate recursion...this seemed like a good fit for it. We're essentially traversing
  // down a tree to find a "leaf node" and checking to see if it needs to be converted.
  _parseAggregateArgs(schema, pipeline) {
    if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateArgs(schema, value));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
          if (typeof pipeline[field] === 'object') {
            // Pass objects down to MongoDB...this is more than likely an $exists operator.
            returnValue[`_p_${field}`] = pipeline[field];
          } else {
            returnValue[`_p_${field}`] = `${schema.fields[field].targetClass}$${pipeline[field]}`;
          }
        } else if (schema.fields[field] && schema.fields[field].type === 'Date') {
          returnValue[field] = this._convertToDate(pipeline[field]);
        } else {
          returnValue[field] = this._parseAggregateArgs(schema, pipeline[field]);
        }

        if (field === 'objectId') {
          returnValue['_id'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'createdAt') {
          returnValue['_created_at'] = returnValue[field];
          delete returnValue[field];
        } else if (field === 'updatedAt') {
          returnValue['_updated_at'] = returnValue[field];
          delete returnValue[field];
        }
      }
      return returnValue;
    }
    return pipeline;
  }

  // This function is slightly different than the one above. Rather than trying to combine these
  // two functions and making the code even harder to understand, I decided to split it up. The
  // difference with this function is we are not transforming the values, only the keys of the
  // pipeline.
  _parseAggregateProjectArgs(schema, pipeline) {
    const returnValue = {};
    for (const field in pipeline) {
      if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
        returnValue[`_p_${field}`] = pipeline[field];
      } else {
        returnValue[field] = this._parseAggregateArgs(schema, pipeline[field]);
      }

      if (field === 'objectId') {
        returnValue['_id'] = returnValue[field];
        delete returnValue[field];
      } else if (field === 'createdAt') {
        returnValue['_created_at'] = returnValue[field];
        delete returnValue[field];
      } else if (field === 'updatedAt') {
        returnValue['_updated_at'] = returnValue[field];
        delete returnValue[field];
      }
    }
    return returnValue;
  }

  // This function is slightly different than the two above. MongoDB $group aggregate looks like:
  //     { $group: { _id: <expression>, <field1>: { <accumulator1> : <expression1> }, ... } }
  // The <expression> could be a column name, prefixed with the '$' character. We'll look for
  // these <expression> and check to see if it is a 'Pointer' or if it's one of createdAt,
  // updatedAt or objectId and change it accordingly.
  _parseAggregateGroupArgs(schema, pipeline) {
    if (Array.isArray(pipeline)) {
      return pipeline.map(value => this._parseAggregateGroupArgs(schema, value));
    } else if (typeof pipeline === 'object') {
      const returnValue = {};
      for (const field in pipeline) {
        returnValue[field] = this._parseAggregateGroupArgs(schema, pipeline[field]);
      }
      return returnValue;
    } else if (typeof pipeline === 'string') {
      const field = pipeline.substring(1);
      if (schema.fields[field] && schema.fields[field].type === 'Pointer') {
        return `$_p_${field}`;
      } else if (field == 'createdAt') {
        return '$_created_at';
      } else if (field == 'updatedAt') {
        return '$_updated_at';
      }
    }
    return pipeline;
  }

  // This function will attempt to convert the provided value to a Date object. Since this is part
  // of an aggregation pipeline, the value can either be a string or it can be another object with
  // an operator in it (like $gt, $lt, etc). Because of this I felt it was easier to make this a
  // recursive method to traverse down to the "leaf node" which is going to be the string.
  _convertToDate(value) {
    if (typeof value === 'string') {
      return new Date(value);
    }

    const returnValue = {};
    for (const field in value) {
      returnValue[field] = this._convertToDate(value[field]);
    }
    return returnValue;
  }

  _parseReadPreference(readPreference) {
    switch (readPreference) {
      case 'PRIMARY':
        readPreference = ReadPreference.PRIMARY;
        break;
      case 'PRIMARY_PREFERRED':
        readPreference = ReadPreference.PRIMARY_PREFERRED;
        break;
      case 'SECONDARY':
        readPreference = ReadPreference.SECONDARY;
        break;
      case 'SECONDARY_PREFERRED':
        readPreference = ReadPreference.SECONDARY_PREFERRED;
        break;
      case 'NEAREST':
        readPreference = ReadPreference.NEAREST;
        break;
      case undefined:
        break;
      default:
        throw new _node2.default.Error(_node2.default.Error.INVALID_QUERY, 'Not supported read preference.');
    }
    return readPreference;
  }

  performInitialization() {
    return Promise.resolve();
  }

  createIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndex(index)).catch(err => this.handleError(err));
  }

  createIndexes(className, indexes) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.createIndexes(indexes)).catch(err => this.handleError(err));
  }

  createIndexesIfNeeded(className, fieldName, type) {
    if (type && type.type === 'Polygon') {
      const index = {
        [fieldName]: '2dsphere'
      };
      return this.createIndex(className, index);
    }
    return Promise.resolve();
  }

  createTextIndexesIfNeeded(className, query, schema) {
    for (const fieldName in query) {
      if (!query[fieldName] || !query[fieldName].$text) {
        continue;
      }
      const existingIndexes = schema.indexes;
      for (const key in existingIndexes) {
        const index = existingIndexes[key];
        if (index.hasOwnProperty(fieldName)) {
          return Promise.resolve();
        }
      }
      const indexName = `${fieldName}_text`;
      const textIndex = {
        [indexName]: { [fieldName]: 'text' }
      };
      return this.setIndexesWithSchemaFormat(className, textIndex, existingIndexes, schema.fields).catch(error => {
        if (error.code === 85) {
          // Index exist with different options
          return this.setIndexesFromMongo(className);
        }
        throw error;
      });
    }
    return Promise.resolve();
  }

  getIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.indexes()).catch(err => this.handleError(err));
  }

  dropIndex(className, index) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndex(index)).catch(err => this.handleError(err));
  }

  dropAllIndexes(className) {
    return this._adaptiveCollection(className).then(collection => collection._mongoCollection.dropIndexes()).catch(err => this.handleError(err));
  }

  updateSchemaWithIndexes() {
    return this.getAllClasses().then(classes => {
      const promises = classes.map(schema => {
        return this.setIndexesFromMongo(schema.className);
      });
      return Promise.all(promises);
    }).catch(err => this.handleError(err));
  }
}

exports.MongoStorageAdapter = MongoStorageAdapter;
exports.default = MongoStorageAdapter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9BZGFwdGVycy9TdG9yYWdlL01vbmdvL01vbmdvU3RvcmFnZUFkYXB0ZXIuanMiXSwibmFtZXMiOlsibW9uZ29kYiIsInJlcXVpcmUiLCJNb25nb0NsaWVudCIsIlJlYWRQcmVmZXJlbmNlIiwiTW9uZ29TY2hlbWFDb2xsZWN0aW9uTmFtZSIsInN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnMiLCJtb25nb0FkYXB0ZXIiLCJjb25uZWN0IiwidGhlbiIsImRhdGFiYXNlIiwiY29sbGVjdGlvbnMiLCJmaWx0ZXIiLCJjb2xsZWN0aW9uIiwibmFtZXNwYWNlIiwibWF0Y2giLCJjb2xsZWN0aW9uTmFtZSIsImluZGV4T2YiLCJfY29sbGVjdGlvblByZWZpeCIsImNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEiLCJzY2hlbWEiLCJmaWVsZHMiLCJfcnBlcm0iLCJfd3Blcm0iLCJjbGFzc05hbWUiLCJfaGFzaGVkX3Bhc3N3b3JkIiwibW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lQW5kQ0xQIiwiY2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiaW5kZXhlcyIsIm1vbmdvT2JqZWN0IiwiX2lkIiwib2JqZWN0SWQiLCJ1cGRhdGVkQXQiLCJjcmVhdGVkQXQiLCJfbWV0YWRhdGEiLCJ1bmRlZmluZWQiLCJmaWVsZE5hbWUiLCJwYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUiLCJjbGFzc19wZXJtaXNzaW9ucyIsIk9iamVjdCIsImtleXMiLCJsZW5ndGgiLCJNb25nb1N0b3JhZ2VBZGFwdGVyIiwiY29uc3RydWN0b3IiLCJ1cmkiLCJEZWZhdWx0TW9uZ29VUkkiLCJjb2xsZWN0aW9uUHJlZml4IiwibW9uZ29PcHRpb25zIiwiX3VyaSIsIl9tb25nb09wdGlvbnMiLCJfbWF4VGltZU1TIiwibWF4VGltZU1TIiwiY2FuU29ydE9uSm9pblRhYmxlcyIsImNvbm5lY3Rpb25Qcm9taXNlIiwiZW5jb2RlZFVyaSIsImNsaWVudCIsIm9wdGlvbnMiLCJzIiwiZGIiLCJkYk5hbWUiLCJvbiIsImNhdGNoIiwiZXJyIiwiUHJvbWlzZSIsInJlamVjdCIsImhhbmRsZUVycm9yIiwiZXJyb3IiLCJjb2RlIiwiaGFuZGxlU2h1dGRvd24iLCJjbG9zZSIsIl9hZGFwdGl2ZUNvbGxlY3Rpb24iLCJuYW1lIiwicmF3Q29sbGVjdGlvbiIsIl9zY2hlbWFDb2xsZWN0aW9uIiwiY2xhc3NFeGlzdHMiLCJsaXN0Q29sbGVjdGlvbnMiLCJ0b0FycmF5Iiwic2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zIiwiQ0xQcyIsInNjaGVtYUNvbGxlY3Rpb24iLCJ1cGRhdGVTY2hlbWEiLCIkc2V0Iiwic2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQiLCJzdWJtaXR0ZWRJbmRleGVzIiwiZXhpc3RpbmdJbmRleGVzIiwicmVzb2x2ZSIsIl9pZF8iLCJkZWxldGVQcm9taXNlcyIsImluc2VydGVkSW5kZXhlcyIsImZvckVhY2giLCJmaWVsZCIsIl9fb3AiLCJFcnJvciIsIklOVkFMSURfUVVFUlkiLCJwcm9taXNlIiwiZHJvcEluZGV4IiwicHVzaCIsImtleSIsImhhc093blByb3BlcnR5IiwiaW5zZXJ0UHJvbWlzZSIsImNyZWF0ZUluZGV4ZXMiLCJhbGwiLCJzZXRJbmRleGVzRnJvbU1vbmdvIiwiZ2V0SW5kZXhlcyIsInJlZHVjZSIsIm9iaiIsImluZGV4IiwiX2Z0cyIsIl9mdHN4Iiwid2VpZ2h0cyIsImNyZWF0ZUNsYXNzIiwiaW5zZXJ0U2NoZW1hIiwiYWRkRmllbGRJZk5vdEV4aXN0cyIsInR5cGUiLCJjcmVhdGVJbmRleGVzSWZOZWVkZWQiLCJkZWxldGVDbGFzcyIsImRyb3AiLCJtZXNzYWdlIiwiZmluZEFuZERlbGV0ZVNjaGVtYSIsImRlbGV0ZUFsbENsYXNzZXMiLCJmYXN0IiwibWFwIiwicmVtb3ZlIiwiZGVsZXRlRmllbGRzIiwiZmllbGROYW1lcyIsIm1vbmdvRm9ybWF0TmFtZXMiLCJjb2xsZWN0aW9uVXBkYXRlIiwic2NoZW1hVXBkYXRlIiwidXBkYXRlTWFueSIsImdldEFsbENsYXNzZXMiLCJzY2hlbWFzQ29sbGVjdGlvbiIsIl9mZXRjaEFsbFNjaGVtYXNGcm9tX1NDSEVNQSIsImdldENsYXNzIiwiX2ZldGNoT25lU2NoZW1hRnJvbV9TQ0hFTUEiLCJjcmVhdGVPYmplY3QiLCJvYmplY3QiLCJpbnNlcnRPbmUiLCJEVVBMSUNBVEVfVkFMVUUiLCJ1bmRlcmx5aW5nRXJyb3IiLCJtYXRjaGVzIiwiQXJyYXkiLCJpc0FycmF5IiwidXNlckluZm8iLCJkdXBsaWNhdGVkX2ZpZWxkIiwiZGVsZXRlT2JqZWN0c0J5UXVlcnkiLCJxdWVyeSIsIm1vbmdvV2hlcmUiLCJkZWxldGVNYW55IiwicmVzdWx0IiwibiIsIk9CSkVDVF9OT1RfRk9VTkQiLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJ1cGRhdGVPYmplY3RzQnlRdWVyeSIsInVwZGF0ZSIsIm1vbmdvVXBkYXRlIiwiZmluZE9uZUFuZFVwZGF0ZSIsIl9tb25nb0NvbGxlY3Rpb24iLCJmaW5kQW5kTW9kaWZ5IiwibmV3IiwidmFsdWUiLCJ1cHNlcnRPbmVPYmplY3QiLCJ1cHNlcnRPbmUiLCJmaW5kIiwic2tpcCIsImxpbWl0Iiwic29ydCIsInJlYWRQcmVmZXJlbmNlIiwibW9uZ29Tb3J0IiwibWFwS2V5cyIsIm1vbmdvS2V5cyIsIm1lbW8iLCJfcGFyc2VSZWFkUHJlZmVyZW5jZSIsImNyZWF0ZVRleHRJbmRleGVzSWZOZWVkZWQiLCJvYmplY3RzIiwiZW5zdXJlVW5pcXVlbmVzcyIsImluZGV4Q3JlYXRpb25SZXF1ZXN0IiwibW9uZ29GaWVsZE5hbWVzIiwiX2Vuc3VyZVNwYXJzZVVuaXF1ZUluZGV4SW5CYWNrZ3JvdW5kIiwiX3Jhd0ZpbmQiLCJjb3VudCIsImRpc3RpbmN0IiwiaXNQb2ludGVyRmllbGQiLCJzdWJzdHJpbmciLCJhZ2dyZWdhdGUiLCJwaXBlbGluZSIsInN0YWdlIiwiJGdyb3VwIiwiX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzIiwiJG1hdGNoIiwiX3BhcnNlQWdncmVnYXRlQXJncyIsIiRwcm9qZWN0IiwiX3BhcnNlQWdncmVnYXRlUHJvamVjdEFyZ3MiLCJyZXN1bHRzIiwic3BsaXQiLCJpc0VtcHR5IiwicmV0dXJuVmFsdWUiLCJ0YXJnZXRDbGFzcyIsIl9jb252ZXJ0VG9EYXRlIiwiRGF0ZSIsIlBSSU1BUlkiLCJQUklNQVJZX1BSRUZFUlJFRCIsIlNFQ09OREFSWSIsIlNFQ09OREFSWV9QUkVGRVJSRUQiLCJORUFSRVNUIiwicGVyZm9ybUluaXRpYWxpemF0aW9uIiwiY3JlYXRlSW5kZXgiLCIkdGV4dCIsImluZGV4TmFtZSIsInRleHRJbmRleCIsImRyb3BBbGxJbmRleGVzIiwiZHJvcEluZGV4ZXMiLCJ1cGRhdGVTY2hlbWFXaXRoSW5kZXhlcyIsImNsYXNzZXMiLCJwcm9taXNlcyJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUNBOzs7O0FBQ0E7Ozs7QUFDQTs7QUFLQTs7QUFJQTs7QUFTQTs7OztBQUVBOzs7O0FBQ0E7Ozs7QUFDQTs7Ozs7OztBQUxBOztBQUVBOzs7QUFLQTtBQUNBLE1BQU1BLFVBQVVDLFFBQVEsU0FBUixDQUFoQjtBQUNBLE1BQU1DLGNBQWNGLFFBQVFFLFdBQTVCO0FBQ0EsTUFBTUMsaUJBQWlCSCxRQUFRRyxjQUEvQjs7QUFFQSxNQUFNQyw0QkFBNEIsU0FBbEM7O0FBRUEsTUFBTUMsK0JBQStCQyxnQkFBZ0I7QUFDbkQsU0FBT0EsYUFBYUMsT0FBYixHQUNKQyxJQURJLENBQ0MsTUFBTUYsYUFBYUcsUUFBYixDQUFzQkMsV0FBdEIsRUFEUCxFQUVKRixJQUZJLENBRUNFLGVBQWU7QUFDbkIsV0FBT0EsWUFBWUMsTUFBWixDQUFtQkMsY0FBYztBQUN0QyxVQUFJQSxXQUFXQyxTQUFYLENBQXFCQyxLQUFyQixDQUEyQixZQUEzQixDQUFKLEVBQThDO0FBQzVDLGVBQU8sS0FBUDtBQUNEO0FBQ0Q7QUFDQTtBQUNBLGFBQVFGLFdBQVdHLGNBQVgsQ0FBMEJDLE9BQTFCLENBQWtDVixhQUFhVyxpQkFBL0MsS0FBcUUsQ0FBN0U7QUFD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S0FBS0csV0FBTCxDQUFpQkgsR0FBakIsQ0FGVCxDQUFQO0FBR0Q7O0FBRURtSixpQkFBZXpMLFNBQWYsRUFBa0M7QUFDaEMsV0FBTyxLQUFLOEMsbUJBQUwsQ0FBeUI5QyxTQUF6QixFQUNKZixJQURJLENBQ0NJLGNBQWNBLFdBQVcrSSxnQkFBWCxDQUE0QnNELFdBQTVCLEVBRGYsRUFFSnJKLEtBRkksQ0FFRUMsT0FBTyxLQUFLRyxXQUFMLENBQWlCSCxHQUFqQixDQUZULENBQVA7QUFHRDs7QUFFRHFKLDRCQUF3QztBQUN0QyxXQUFPLEtBQUtsRixhQUFMLEdBQ0p4SCxJQURJLENBQ0UyTSxPQUFELElBQWE7QUFDakIsWUFBTUMsV0FBV0QsUUFBUTNGLEdBQVIsQ0FBYXJHLE1BQUQsSUFBWTtBQUN2QyxlQUFPLEtBQUtrRixtQkFBTCxDQUF5QmxGLE9BQU9JLFNBQWhDLENBQVA7QUFDRCxPQUZnQixDQUFqQjtBQUdBLGFBQU91QyxRQUFRc0MsR0FBUixDQUFZZ0gsUUFBWixDQUFQO0FBQ0QsS0FOSSxFQU9KeEosS0FQSSxDQU9FQyxPQUFPLEtBQUtHLFdBQUwsQ0FBaUJILEdBQWpCLENBUFQsQ0FBUDtBQVFEO0FBdnRCd0Q7O1FBQTlDcEIsbUIsR0FBQUEsbUI7a0JBMHRCRUEsbUIiLCJmaWxlIjoiTW9uZ29TdG9yYWdlQWRhcHRlci5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEBmbG93XG5pbXBvcnQgTW9uZ29Db2xsZWN0aW9uICAgICAgIGZyb20gJy4vTW9uZ29Db2xsZWN0aW9uJztcbmltcG9ydCBNb25nb1NjaGVtYUNvbGxlY3Rpb24gZnJvbSAnLi9Nb25nb1NjaGVtYUNvbGxlY3Rpb24nO1xuaW1wb3J0IHsgU3RvcmFnZUFkYXB0ZXIgfSAgICBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQgdHlwZSB7IFNjaGVtYVR5cGUsXG4gIFF1ZXJ5VHlwZSxcbiAgU3RvcmFnZUNsYXNzLFxuICBRdWVyeU9wdGlvbnMgfSBmcm9tICcuLi9TdG9yYWdlQWRhcHRlcic7XG5pbXBvcnQge1xuICBwYXJzZSBhcyBwYXJzZVVybCxcbiAgZm9ybWF0IGFzIGZvcm1hdFVybCxcbn0gZnJvbSAnLi4vLi4vLi4vdmVuZG9yL21vbmdvZGJVcmwnO1xuaW1wb3J0IHtcbiAgcGFyc2VPYmplY3RUb01vbmdvT2JqZWN0Rm9yQ3JlYXRlLFxuICBtb25nb09iamVjdFRvUGFyc2VPYmplY3QsXG4gIHRyYW5zZm9ybUtleSxcbiAgdHJhbnNmb3JtV2hlcmUsXG4gIHRyYW5zZm9ybVVwZGF0ZSxcbiAgdHJhbnNmb3JtUG9pbnRlclN0cmluZyxcbn0gZnJvbSAnLi9Nb25nb1RyYW5zZm9ybSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBQYXJzZSAgICAgICAgICAgICAgICAgZnJvbSAncGFyc2Uvbm9kZSc7XG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmltcG9ydCBfICAgICAgICAgICAgICAgICAgICAgZnJvbSAnbG9kYXNoJztcbmltcG9ydCBkZWZhdWx0cyAgICAgICAgICAgICAgZnJvbSAnLi4vLi4vLi4vZGVmYXVsdHMnO1xuaW1wb3J0IGxvZ2dlciAgICAgICAgICAgICAgICBmcm9tICcuLi8uLi8uLi9sb2dnZXInO1xuXG4vLyBAZmxvdy1kaXNhYmxlLW5leHRcbmNvbnN0IG1vbmdvZGIgPSByZXF1aXJlKCdtb25nb2RiJyk7XG5jb25zdCBNb25nb0NsaWVudCA9IG1vbmdvZGIuTW9uZ29DbGllbnQ7XG5jb25zdCBSZWFkUHJlZmVyZW5jZSA9IG1vbmdvZGIuUmVhZFByZWZlcmVuY2U7XG5cbmNvbnN0IE1vbmdvU2NoZW1hQ29sbGVjdGlvbk5hbWUgPSAnX1NDSEVNQSc7XG5cbmNvbnN0IHN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnMgPSBtb25nb0FkYXB0ZXIgPT4ge1xuICByZXR1cm4gbW9uZ29BZGFwdGVyLmNvbm5lY3QoKVxuICAgIC50aGVuKCgpID0+IG1vbmdvQWRhcHRlci5kYXRhYmFzZS5jb2xsZWN0aW9ucygpKVxuICAgIC50aGVuKGNvbGxlY3Rpb25zID0+IHtcbiAgICAgIHJldHVybiBjb2xsZWN0aW9ucy5maWx0ZXIoY29sbGVjdGlvbiA9PiB7XG4gICAgICAgIGlmIChjb2xsZWN0aW9uLm5hbWVzcGFjZS5tYXRjaCgvXFwuc3lzdGVtXFwuLykpIHtcbiAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgLy8gVE9ETzogSWYgeW91IGhhdmUgb25lIGFwcCB3aXRoIGEgY29sbGVjdGlvbiBwcmVmaXggdGhhdCBoYXBwZW5zIHRvIGJlIGEgcHJlZml4IG9mIGFub3RoZXJcbiAgICAgICAgLy8gYXBwcyBwcmVmaXgsIHRoaXMgd2lsbCBnbyB2ZXJ5IHZlcnkgYmFkbHkuIFdlIHNob3VsZCBmaXggdGhhdCBzb21laG93LlxuICAgICAgICByZXR1cm4gKGNvbGxlY3Rpb24uY29sbGVjdGlvbk5hbWUuaW5kZXhPZihtb25nb0FkYXB0ZXIuX2NvbGxlY3Rpb25QcmVmaXgpID09IDApO1xuICAgICAgfSk7XG4gICAgfSk7XG59XG5cbmNvbnN0IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEgPSAoey4uLnNjaGVtYX0pID0+IHtcbiAgZGVsZXRlIHNjaGVtYS5maWVsZHMuX3JwZXJtO1xuICBkZWxldGUgc2NoZW1hLmZpZWxkcy5fd3Blcm07XG5cbiAgaWYgKHNjaGVtYS5jbGFzc05hbWUgPT09ICdfVXNlcicpIHtcbiAgICAvLyBMZWdhY3kgbW9uZ28gYWRhcHRlciBrbm93cyBhYm91dCB0aGUgZGlmZmVyZW5jZSBiZXR3ZWVuIHBhc3N3b3JkIGFuZCBfaGFzaGVkX3Bhc3N3b3JkLlxuICAgIC8vIEZ1dHVyZSBkYXRhYmFzZSBhZGFwdGVycyB3aWxsIG9ubHkga25vdyBhYm91dCBfaGFzaGVkX3Bhc3N3b3JkLlxuICAgIC8vIE5vdGU6IFBhcnNlIFNlcnZlciB3aWxsIGJyaW5nIGJhY2sgcGFzc3dvcmQgd2l0aCBpbmplY3REZWZhdWx0U2NoZW1hLCBzbyB3ZSBkb24ndCBuZWVkXG4gICAgLy8gdG8gYWRkIF9oYXNoZWRfcGFzc3dvcmQgYmFjayBldmVyLlxuICAgIGRlbGV0ZSBzY2hlbWEuZmllbGRzLl9oYXNoZWRfcGFzc3dvcmQ7XG4gIH1cblxuICByZXR1cm4gc2NoZW1hO1xufVxuXG4vLyBSZXR1cm5zIHsgY29kZSwgZXJyb3IgfSBpZiBpbnZhbGlkLCBvciB7IHJlc3VsdCB9LCBhbiBvYmplY3Rcbi8vIHN1aXRhYmxlIGZvciBpbnNlcnRpbmcgaW50byBfU0NIRU1BIGNvbGxlY3Rpb24sIG90aGVyd2lzZS5cbmNvbnN0IG1vbmdvU2NoZW1hRnJvbUZpZWxkc0FuZENsYXNzTmFtZUFuZENMUCA9IChmaWVsZHMsIGNsYXNzTmFtZSwgY2xhc3NMZXZlbFBlcm1pc3Npb25zLCBpbmRleGVzKSA9PiB7XG4gIGNvbnN0IG1vbmdvT2JqZWN0ID0ge1xuICAgIF9pZDogY2xhc3NOYW1lLFxuICAgIG9iamVjdElkOiAnc3RyaW5nJyxcbiAgICB1cGRhdGVkQXQ6ICdzdHJpbmcnLFxuICAgIGNyZWF0ZWRBdDogJ3N0cmluZycsXG4gICAgX21ldGFkYXRhOiB1bmRlZmluZWQsXG4gIH07XG5cbiAgZm9yIChjb25zdCBmaWVsZE5hbWUgaW4gZmllbGRzKSB7XG4gICAgbW9uZ29PYmplY3RbZmllbGROYW1lXSA9IE1vbmdvU2NoZW1hQ29sbGVjdGlvbi5wYXJzZUZpZWxkVHlwZVRvTW9uZ29GaWVsZFR5cGUoZmllbGRzW2ZpZWxkTmFtZV0pO1xuICB9XG5cbiAgaWYgKHR5cGVvZiBjbGFzc0xldmVsUGVybWlzc2lvbnMgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgbW9uZ29PYmplY3QuX21ldGFkYXRhID0gbW9uZ29PYmplY3QuX21ldGFkYXRhIHx8IHt9O1xuICAgIGlmICghY2xhc3NMZXZlbFBlcm1pc3Npb25zKSB7XG4gICAgICBkZWxldGUgbW9uZ29PYmplY3QuX21ldGFkYXRhLmNsYXNzX3Blcm1pc3Npb25zO1xuICAgIH0gZWxzZSB7XG4gICAgICBtb25nb09iamVjdC5fbWV0YWRhdGEuY2xhc3NfcGVybWlzc2lvbnMgPSBjbGFzc0xldmVsUGVybWlzc2lvbnM7XG4gICAgfVxuICB9XG5cbiAgaWYgKGluZGV4ZXMgJiYgdHlwZW9mIGluZGV4ZXMgPT09ICdvYmplY3QnICYmIE9iamVjdC5rZXlzKGluZGV4ZXMpLmxlbmd0aCA+IDApIHtcbiAgICBtb25nb09iamVjdC5fbWV0YWRhdGEgPSBtb25nb09iamVjdC5fbWV0YWRhdGEgfHwge307XG4gICAgbW9uZ29PYmplY3QuX21ldGFkYXRhLmluZGV4ZXMgPSBpbmRleGVzO1xuICB9XG5cbiAgaWYgKCFtb25nb09iamVjdC5fbWV0YWRhdGEpIHsgLy8gY2xlYW51cCB0aGUgdW51c2VkIF9tZXRhZGF0YVxuICAgIGRlbGV0ZSBtb25nb09iamVjdC5fbWV0YWRhdGE7XG4gIH1cblxuICByZXR1cm4gbW9uZ29PYmplY3Q7XG59XG5cblxuZXhwb3J0IGNsYXNzIE1vbmdvU3RvcmFnZUFkYXB0ZXIgaW1wbGVtZW50cyBTdG9yYWdlQWRhcHRlciB7XG4gIC8vIFByaXZhdGVcbiAgX3VyaTogc3RyaW5nO1xuICBfY29sbGVjdGlvblByZWZpeDogc3RyaW5nO1xuICBfbW9uZ29PcHRpb25zOiBPYmplY3Q7XG4gIC8vIFB1YmxpY1xuICBjb25uZWN0aW9uUHJvbWlzZTogUHJvbWlzZTxhbnk+O1xuICBkYXRhYmFzZTogYW55O1xuICBjbGllbnQ6IE1vbmdvQ2xpZW50O1xuICBfbWF4VGltZU1TOiA/bnVtYmVyO1xuICBjYW5Tb3J0T25Kb2luVGFibGVzOiBib29sZWFuO1xuXG4gIGNvbnN0cnVjdG9yKHtcbiAgICB1cmkgPSBkZWZhdWx0cy5EZWZhdWx0TW9uZ29VUkksXG4gICAgY29sbGVjdGlvblByZWZpeCA9ICcnLFxuICAgIG1vbmdvT3B0aW9ucyA9IHt9LFxuICB9OiBhbnkpIHtcbiAgICB0aGlzLl91cmkgPSB1cmk7XG4gICAgdGhpcy5fY29sbGVjdGlvblByZWZpeCA9IGNvbGxlY3Rpb25QcmVmaXg7XG4gICAgdGhpcy5fbW9uZ29PcHRpb25zID0gbW9uZ29PcHRpb25zO1xuXG4gICAgLy8gTWF4VGltZU1TIGlzIG5vdCBhIGdsb2JhbCBNb25nb0RCIGNsaWVudCBvcHRpb24sIGl0IGlzIGFwcGxpZWQgcGVyIG9wZXJhdGlvbi5cbiAgICB0aGlzLl9tYXhUaW1lTVMgPSBtb25nb09wdGlvbnMubWF4VGltZU1TO1xuICAgIHRoaXMuY2FuU29ydE9uSm9pblRhYmxlcyA9IHRydWU7XG4gICAgZGVsZXRlIG1vbmdvT3B0aW9ucy5tYXhUaW1lTVM7XG4gIH1cblxuICBjb25uZWN0KCkge1xuICAgIGlmICh0aGlzLmNvbm5lY3Rpb25Qcm9taXNlKSB7XG4gICAgICByZXR1cm4gdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICB9XG5cbiAgICAvLyBwYXJzaW5nIGFuZCByZS1mb3JtYXR0aW5nIGNhdXNlcyB0aGUgYXV0aCB2YWx1ZSAoaWYgdGhlcmUpIHRvIGdldCBVUklcbiAgICAvLyBlbmNvZGVkXG4gICAgY29uc3QgZW5jb2RlZFVyaSA9IGZvcm1hdFVybChwYXJzZVVybCh0aGlzLl91cmkpKTtcblxuICAgIHRoaXMuY29ubmVjdGlvblByb21pc2UgPSBNb25nb0NsaWVudC5jb25uZWN0KGVuY29kZWRVcmksIHRoaXMuX21vbmdvT3B0aW9ucykudGhlbihjbGllbnQgPT4ge1xuICAgICAgLy8gU3RhcnRpbmcgbW9uZ29EQiAzLjAsIHRoZSBNb25nb0NsaWVudC5jb25uZWN0IGRvbid0IHJldHVybiBhIERCIGFueW1vcmUgYnV0IGEgY2xpZW50XG4gICAgICAvLyBGb3J0dW5hdGVseSwgd2UgY2FuIGdldCBiYWNrIHRoZSBvcHRpb25zIGFuZCB1c2UgdGhlbSB0byBzZWxlY3QgdGhlIHByb3BlciBEQi5cbiAgICAgIC8vIGh0dHBzOi8vZ2l0aHViLmNvbS9tb25nb2RiL25vZGUtbW9uZ29kYi1uYXRpdmUvYmxvYi8yYzM1ZDc2ZjA4NTc0MjI1YjhkYjAyZDdiZWY2ODcxMjNlNmJiMDE4L2xpYi9tb25nb19jbGllbnQuanMjTDg4NVxuICAgICAgY29uc3Qgb3B0aW9ucyA9IGNsaWVudC5zLm9wdGlvbnM7XG4gICAgICBjb25zdCBkYXRhYmFzZSA9IGNsaWVudC5kYihvcHRpb25zLmRiTmFtZSk7XG4gICAgICBpZiAoIWRhdGFiYXNlKSB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBkYXRhYmFzZS5vbignZXJyb3InLCAoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgfSk7XG4gICAgICBkYXRhYmFzZS5vbignY2xvc2UnLCAoKSA9PiB7XG4gICAgICAgIGRlbGV0ZSB0aGlzLmNvbm5lY3Rpb25Qcm9taXNlO1xuICAgICAgfSk7XG4gICAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICAgIHRoaXMuZGF0YWJhc2UgPSBkYXRhYmFzZTtcbiAgICB9KS5jYXRjaCgoZXJyKSA9PiB7XG4gICAgICBkZWxldGUgdGhpcy5jb25uZWN0aW9uUHJvbWlzZTtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChlcnIpO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gIH1cblxuICBoYW5kbGVFcnJvcjxUPihlcnJvcjogPyhFcnJvciB8IFBhcnNlLkVycm9yKSk6IFByb21pc2U8VD4ge1xuICAgIGlmIChlcnJvciAmJiBlcnJvci5jb2RlID09PSAxMykgeyAvLyBVbmF1dGhvcml6ZWQgZXJyb3JcbiAgICAgIGRlbGV0ZSB0aGlzLmNsaWVudDtcbiAgICAgIGRlbGV0ZSB0aGlzLmRhdGFiYXNlO1xuICAgICAgZGVsZXRlIHRoaXMuY29ubmVjdGlvblByb21pc2U7XG4gICAgICBsb2dnZXIuZXJyb3IoJ1JlY2VpdmVkIHVuYXV0aG9yaXplZCBlcnJvcicsIHsgZXJyb3I6IGVycm9yIH0pO1xuICAgIH1cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIGhhbmRsZVNodXRkb3duKCkge1xuICAgIGlmICghdGhpcy5jbGllbnQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5jbGllbnQuY2xvc2UoZmFsc2UpO1xuICB9XG5cbiAgX2FkYXB0aXZlQ29sbGVjdGlvbihuYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5jb25uZWN0KClcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuZGF0YWJhc2UuY29sbGVjdGlvbih0aGlzLl9jb2xsZWN0aW9uUHJlZml4ICsgbmFtZSkpXG4gICAgICAudGhlbihyYXdDb2xsZWN0aW9uID0+IG5ldyBNb25nb0NvbGxlY3Rpb24ocmF3Q29sbGVjdGlvbikpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICBfc2NoZW1hQ29sbGVjdGlvbigpOiBQcm9taXNlPE1vbmdvU2NoZW1hQ29sbGVjdGlvbj4ge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3QoKVxuICAgICAgLnRoZW4oKCkgPT4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKE1vbmdvU2NoZW1hQ29sbGVjdGlvbk5hbWUpKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBuZXcgTW9uZ29TY2hlbWFDb2xsZWN0aW9uKGNvbGxlY3Rpb24pKTtcbiAgfVxuXG4gIGNsYXNzRXhpc3RzKG5hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLmNvbm5lY3QoKS50aGVuKCgpID0+IHtcbiAgICAgIHJldHVybiB0aGlzLmRhdGFiYXNlLmxpc3RDb2xsZWN0aW9ucyh7IG5hbWU6IHRoaXMuX2NvbGxlY3Rpb25QcmVmaXggKyBuYW1lIH0pLnRvQXJyYXkoKTtcbiAgICB9KS50aGVuKGNvbGxlY3Rpb25zID0+IHtcbiAgICAgIHJldHVybiBjb2xsZWN0aW9ucy5sZW5ndGggPiAwO1xuICAgIH0pLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgc2V0Q2xhc3NMZXZlbFBlcm1pc3Npb25zKGNsYXNzTmFtZTogc3RyaW5nLCBDTFBzOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwge1xuICAgICAgICAkc2V0OiB7ICdfbWV0YWRhdGEuY2xhc3NfcGVybWlzc2lvbnMnOiBDTFBzIH1cbiAgICAgIH0pKS5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHNldEluZGV4ZXNXaXRoU2NoZW1hRm9ybWF0KGNsYXNzTmFtZTogc3RyaW5nLCBzdWJtaXR0ZWRJbmRleGVzOiBhbnksIGV4aXN0aW5nSW5kZXhlczogYW55ID0ge30sIGZpZWxkczogYW55KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHN1Ym1pdHRlZEluZGV4ZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cbiAgICBpZiAoT2JqZWN0LmtleXMoZXhpc3RpbmdJbmRleGVzKS5sZW5ndGggPT09IDApIHtcbiAgICAgIGV4aXN0aW5nSW5kZXhlcyA9IHsgX2lkXzogeyBfaWQ6IDF9IH07XG4gICAgfVxuICAgIGNvbnN0IGRlbGV0ZVByb21pc2VzID0gW107XG4gICAgY29uc3QgaW5zZXJ0ZWRJbmRleGVzID0gW107XG4gICAgT2JqZWN0LmtleXMoc3VibWl0dGVkSW5kZXhlcykuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIGNvbnN0IGZpZWxkID0gc3VibWl0dGVkSW5kZXhlc1tuYW1lXTtcbiAgICAgIGlmIChleGlzdGluZ0luZGV4ZXNbbmFtZV0gJiYgZmllbGQuX19vcCAhPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBJbmRleCAke25hbWV9IGV4aXN0cywgY2Fubm90IHVwZGF0ZS5gKTtcbiAgICAgIH1cbiAgICAgIGlmICghZXhpc3RpbmdJbmRleGVzW25hbWVdICYmIGZpZWxkLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBgSW5kZXggJHtuYW1lfSBkb2VzIG5vdCBleGlzdCwgY2Fubm90IGRlbGV0ZS5gKTtcbiAgICAgIH1cbiAgICAgIGlmIChmaWVsZC5fX29wID09PSAnRGVsZXRlJykge1xuICAgICAgICBjb25zdCBwcm9taXNlID0gdGhpcy5kcm9wSW5kZXgoY2xhc3NOYW1lLCBuYW1lKTtcbiAgICAgICAgZGVsZXRlUHJvbWlzZXMucHVzaChwcm9taXNlKTtcbiAgICAgICAgZGVsZXRlIGV4aXN0aW5nSW5kZXhlc1tuYW1lXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIE9iamVjdC5rZXlzKGZpZWxkKS5mb3JFYWNoKGtleSA9PiB7XG4gICAgICAgICAgaWYgKCFmaWVsZHMuaGFzT3duUHJvcGVydHkoa2V5KSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfUVVFUlksIGBGaWVsZCAke2tleX0gZG9lcyBub3QgZXhpc3QsIGNhbm5vdCBhZGQgaW5kZXguYCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgZXhpc3RpbmdJbmRleGVzW25hbWVdID0gZmllbGQ7XG4gICAgICAgIGluc2VydGVkSW5kZXhlcy5wdXNoKHtcbiAgICAgICAgICBrZXk6IGZpZWxkLFxuICAgICAgICAgIG5hbWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICAgIGxldCBpbnNlcnRQcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgaWYgKGluc2VydGVkSW5kZXhlcy5sZW5ndGggPiAwKSB7XG4gICAgICBpbnNlcnRQcm9taXNlID0gdGhpcy5jcmVhdGVJbmRleGVzKGNsYXNzTmFtZSwgaW5zZXJ0ZWRJbmRleGVzKTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UuYWxsKGRlbGV0ZVByb21pc2VzKVxuICAgICAgLnRoZW4oKCkgPT4gaW5zZXJ0UHJvbWlzZSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi51cGRhdGVTY2hlbWEoY2xhc3NOYW1lLCB7XG4gICAgICAgICRzZXQ6IHsgJ19tZXRhZGF0YS5pbmRleGVzJzogIGV4aXN0aW5nSW5kZXhlcyB9XG4gICAgICB9KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIHNldEluZGV4ZXNGcm9tTW9uZ28oY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRJbmRleGVzKGNsYXNzTmFtZSkudGhlbigoaW5kZXhlcykgPT4ge1xuICAgICAgaW5kZXhlcyA9IGluZGV4ZXMucmVkdWNlKChvYmosIGluZGV4KSA9PiB7XG4gICAgICAgIGlmIChpbmRleC5rZXkuX2Z0cykge1xuICAgICAgICAgIGRlbGV0ZSBpbmRleC5rZXkuX2Z0cztcbiAgICAgICAgICBkZWxldGUgaW5kZXgua2V5Ll9mdHN4O1xuICAgICAgICAgIGZvciAoY29uc3QgZmllbGQgaW4gaW5kZXgud2VpZ2h0cykge1xuICAgICAgICAgICAgaW5kZXgua2V5W2ZpZWxkXSA9ICd0ZXh0JztcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgb2JqW2luZGV4Lm5hbWVdID0gaW5kZXgua2V5O1xuICAgICAgICByZXR1cm4gb2JqO1xuICAgICAgfSwge30pO1xuICAgICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwge1xuICAgICAgICAgICRzZXQ6IHsgJ19tZXRhZGF0YS5pbmRleGVzJzogaW5kZXhlcyB9XG4gICAgICAgIH0pKTtcbiAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpXG4gICAgICAuY2F0Y2goKCkgPT4ge1xuICAgICAgICAvLyBJZ25vcmUgaWYgY29sbGVjdGlvbiBub3QgZm91bmRcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSk7XG4gIH1cblxuICBjcmVhdGVDbGFzcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvT2JqZWN0ID0gbW9uZ29TY2hlbWFGcm9tRmllbGRzQW5kQ2xhc3NOYW1lQW5kQ0xQKHNjaGVtYS5maWVsZHMsIGNsYXNzTmFtZSwgc2NoZW1hLmNsYXNzTGV2ZWxQZXJtaXNzaW9ucywgc2NoZW1hLmluZGV4ZXMpO1xuICAgIG1vbmdvT2JqZWN0Ll9pZCA9IGNsYXNzTmFtZTtcbiAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzV2l0aFNjaGVtYUZvcm1hdChjbGFzc05hbWUsIHNjaGVtYS5pbmRleGVzLCB7fSwgc2NoZW1hLmZpZWxkcylcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKSlcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi5pbnNlcnRTY2hlbWEobW9uZ29PYmplY3QpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgYWRkRmllbGRJZk5vdEV4aXN0cyhjbGFzc05hbWU6IHN0cmluZywgZmllbGROYW1lOiBzdHJpbmcsIHR5cGU6IGFueSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHJldHVybiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKClcbiAgICAgIC50aGVuKHNjaGVtYUNvbGxlY3Rpb24gPT4gc2NoZW1hQ29sbGVjdGlvbi5hZGRGaWVsZElmTm90RXhpc3RzKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuY3JlYXRlSW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZSwgZmllbGROYW1lLCB0eXBlKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIERyb3BzIGEgY29sbGVjdGlvbi4gUmVzb2x2ZXMgd2l0aCB0cnVlIGlmIGl0IHdhcyBhIFBhcnNlIFNjaGVtYSAoZWcuIF9Vc2VyLCBDdXN0b20sIGV0Yy4pXG4gIC8vIGFuZCByZXNvbHZlcyB3aXRoIGZhbHNlIGlmIGl0IHdhc24ndCAoZWcuIGEgam9pbiB0YWJsZSkuIFJlamVjdHMgaWYgZGVsZXRpb24gd2FzIGltcG9zc2libGUuXG4gIGRlbGV0ZUNsYXNzKGNsYXNzTmFtZTogc3RyaW5nKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uZHJvcCgpKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgIC8vICducyBub3QgZm91bmQnIG1lYW5zIGNvbGxlY3Rpb24gd2FzIGFscmVhZHkgZ29uZS4gSWdub3JlIGRlbGV0aW9uIGF0dGVtcHQuXG4gICAgICAgIGlmIChlcnJvci5tZXNzYWdlID09ICducyBub3QgZm91bmQnKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAvLyBXZSd2ZSBkcm9wcGVkIHRoZSBjb2xsZWN0aW9uLCBub3cgcmVtb3ZlIHRoZSBfU0NIRU1BIGRvY3VtZW50XG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24uZmluZEFuZERlbGV0ZVNjaGVtYShjbGFzc05hbWUpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgZGVsZXRlQWxsQ2xhc3NlcyhmYXN0OiBib29sZWFuKSB7XG4gICAgcmV0dXJuIHN0b3JhZ2VBZGFwdGVyQWxsQ29sbGVjdGlvbnModGhpcylcbiAgICAgIC50aGVuKGNvbGxlY3Rpb25zID0+IFByb21pc2UuYWxsKGNvbGxlY3Rpb25zLm1hcChjb2xsZWN0aW9uID0+IGZhc3QgPyBjb2xsZWN0aW9uLnJlbW92ZSh7fSkgOiBjb2xsZWN0aW9uLmRyb3AoKSkpKTtcbiAgfVxuXG4gIC8vIFJlbW92ZSB0aGUgY29sdW1uIGFuZCBhbGwgdGhlIGRhdGEuIEZvciBSZWxhdGlvbnMsIHRoZSBfSm9pbiBjb2xsZWN0aW9uIGlzIGhhbmRsZWRcbiAgLy8gc3BlY2lhbGx5LCB0aGlzIGZ1bmN0aW9uIGRvZXMgbm90IGRlbGV0ZSBfSm9pbiBjb2x1bW5zLiBJdCBzaG91bGQsIGhvd2V2ZXIsIGluZGljYXRlXG4gIC8vIHRoYXQgdGhlIHJlbGF0aW9uIGZpZWxkcyBkb2VzIG5vdCBleGlzdCBhbnltb3JlLiBJbiBtb25nbywgdGhpcyBtZWFucyByZW1vdmluZyBpdCBmcm9tXG4gIC8vIHRoZSBfU0NIRU1BIGNvbGxlY3Rpb24uICBUaGVyZSBzaG91bGQgYmUgbm8gYWN0dWFsIGRhdGEgaW4gdGhlIGNvbGxlY3Rpb24gdW5kZXIgdGhlIHNhbWUgbmFtZVxuICAvLyBhcyB0aGUgcmVsYXRpb24gY29sdW1uLCBzbyBpdCdzIGZpbmUgdG8gYXR0ZW1wdCB0byBkZWxldGUgaXQuIElmIHRoZSBmaWVsZHMgbGlzdGVkIHRvIGJlXG4gIC8vIGRlbGV0ZWQgZG8gbm90IGV4aXN0LCB0aGlzIGZ1bmN0aW9uIHNob3VsZCByZXR1cm4gc3VjY2Vzc2Z1bGx5IGFueXdheXMuIENoZWNraW5nIGZvclxuICAvLyBhdHRlbXB0cyB0byBkZWxldGUgbm9uLWV4aXN0ZW50IGZpZWxkcyBpcyB0aGUgcmVzcG9uc2liaWxpdHkgb2YgUGFyc2UgU2VydmVyLlxuXG4gIC8vIFBvaW50ZXIgZmllbGQgbmFtZXMgYXJlIHBhc3NlZCBmb3IgbGVnYWN5IHJlYXNvbnM6IHRoZSBvcmlnaW5hbCBtb25nb1xuICAvLyBmb3JtYXQgc3RvcmVkIHBvaW50ZXIgZmllbGQgbmFtZXMgZGlmZmVyZW50bHkgaW4gdGhlIGRhdGFiYXNlLCBhbmQgdGhlcmVmb3JlXG4gIC8vIG5lZWRlZCB0byBrbm93IHRoZSB0eXBlIG9mIHRoZSBmaWVsZCBiZWZvcmUgaXQgY291bGQgZGVsZXRlIGl0LiBGdXR1cmUgZGF0YWJhc2VcbiAgLy8gYWRhcHRlcnMgc2hvdWxkIGlnbm9yZSB0aGUgcG9pbnRlckZpZWxkTmFtZXMgYXJndW1lbnQuIEFsbCB0aGUgZmllbGQgbmFtZXMgYXJlIGluXG4gIC8vIGZpZWxkTmFtZXMsIHRoZXkgc2hvdyB1cCBhZGRpdGlvbmFsbHkgaW4gdGhlIHBvaW50ZXJGaWVsZE5hbWVzIGRhdGFiYXNlIGZvciB1c2VcbiAgLy8gYnkgdGhlIG1vbmdvIGFkYXB0ZXIsIHdoaWNoIGRlYWxzIHdpdGggdGhlIGxlZ2FjeSBtb25nbyBmb3JtYXQuXG5cbiAgLy8gVGhpcyBmdW5jdGlvbiBpcyBub3Qgb2JsaWdhdGVkIHRvIGRlbGV0ZSBmaWVsZHMgYXRvbWljYWxseS4gSXQgaXMgZ2l2ZW4gdGhlIGZpZWxkXG4gIC8vIG5hbWVzIGluIGEgbGlzdCBzbyB0aGF0IGRhdGFiYXNlcyB0aGF0IGFyZSBjYXBhYmxlIG9mIGRlbGV0aW5nIGZpZWxkcyBhdG9taWNhbGx5XG4gIC8vIG1heSBkbyBzby5cblxuICAvLyBSZXR1cm5zIGEgUHJvbWlzZS5cbiAgZGVsZXRlRmllbGRzKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIGZpZWxkTmFtZXM6IHN0cmluZ1tdKSB7XG4gICAgY29uc3QgbW9uZ29Gb3JtYXROYW1lcyA9IGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm4gYF9wXyR7ZmllbGROYW1lfWBcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBmaWVsZE5hbWU7XG4gICAgICB9XG4gICAgfSk7XG4gICAgY29uc3QgY29sbGVjdGlvblVwZGF0ZSA9IHsgJyR1bnNldCcgOiB7fSB9O1xuICAgIG1vbmdvRm9ybWF0TmFtZXMuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIGNvbGxlY3Rpb25VcGRhdGVbJyR1bnNldCddW25hbWVdID0gbnVsbDtcbiAgICB9KTtcblxuICAgIGNvbnN0IHNjaGVtYVVwZGF0ZSA9IHsgJyR1bnNldCcgOiB7fSB9O1xuICAgIGZpZWxkTmFtZXMuZm9yRWFjaChuYW1lID0+IHtcbiAgICAgIHNjaGVtYVVwZGF0ZVsnJHVuc2V0J11bbmFtZV0gPSBudWxsO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24udXBkYXRlTWFueSh7fSwgY29sbGVjdGlvblVwZGF0ZSkpXG4gICAgICAudGhlbigoKSA9PiB0aGlzLl9zY2hlbWFDb2xsZWN0aW9uKCkpXG4gICAgICAudGhlbihzY2hlbWFDb2xsZWN0aW9uID0+IHNjaGVtYUNvbGxlY3Rpb24udXBkYXRlU2NoZW1hKGNsYXNzTmFtZSwgc2NoZW1hVXBkYXRlKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFJldHVybiBhIHByb21pc2UgZm9yIGFsbCBzY2hlbWFzIGtub3duIHRvIHRoaXMgYWRhcHRlciwgaW4gUGFyc2UgZm9ybWF0LiBJbiBjYXNlIHRoZVxuICAvLyBzY2hlbWFzIGNhbm5vdCBiZSByZXRyaWV2ZWQsIHJldHVybnMgYSBwcm9taXNlIHRoYXQgcmVqZWN0cy4gUmVxdWlyZW1lbnRzIGZvciB0aGVcbiAgLy8gcmVqZWN0aW9uIHJlYXNvbiBhcmUgVEJELlxuICBnZXRBbGxDbGFzc2VzKCk6IFByb21pc2U8U3RvcmFnZUNsYXNzW10+IHtcbiAgICByZXR1cm4gdGhpcy5fc2NoZW1hQ29sbGVjdGlvbigpLnRoZW4oc2NoZW1hc0NvbGxlY3Rpb24gPT4gc2NoZW1hc0NvbGxlY3Rpb24uX2ZldGNoQWxsU2NoZW1hc0Zyb21fU0NIRU1BKCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBSZXR1cm4gYSBwcm9taXNlIGZvciB0aGUgc2NoZW1hIHdpdGggdGhlIGdpdmVuIG5hbWUsIGluIFBhcnNlIGZvcm1hdC4gSWZcbiAgLy8gdGhpcyBhZGFwdGVyIGRvZXNuJ3Qga25vdyBhYm91dCB0aGUgc2NoZW1hLCByZXR1cm4gYSBwcm9taXNlIHRoYXQgcmVqZWN0cyB3aXRoXG4gIC8vIHVuZGVmaW5lZCBhcyB0aGUgcmVhc29uLlxuICBnZXRDbGFzcyhjbGFzc05hbWU6IHN0cmluZyk6IFByb21pc2U8U3RvcmFnZUNsYXNzPiB7XG4gICAgcmV0dXJuIHRoaXMuX3NjaGVtYUNvbGxlY3Rpb24oKVxuICAgICAgLnRoZW4oc2NoZW1hc0NvbGxlY3Rpb24gPT4gc2NoZW1hc0NvbGxlY3Rpb24uX2ZldGNoT25lU2NoZW1hRnJvbV9TQ0hFTUEoY2xhc3NOYW1lKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIFRPRE86IEFzIHlldCBub3QgcGFydGljdWxhcmx5IHdlbGwgc3BlY2lmaWVkLiBDcmVhdGVzIGFuIG9iamVjdC4gTWF5YmUgc2hvdWxkbid0IGV2ZW4gbmVlZCB0aGUgc2NoZW1hLFxuICAvLyBhbmQgc2hvdWxkIGluZmVyIGZyb20gdGhlIHR5cGUuIE9yIG1heWJlIGRvZXMgbmVlZCB0aGUgc2NoZW1hIGZvciB2YWxpZGF0aW9ucy4gT3IgbWF5YmUgbmVlZHNcbiAgLy8gdGhlIHNjaGVtYSBvbmx5IGZvciB0aGUgbGVnYWN5IG1vbmdvIGZvcm1hdC4gV2UnbGwgZmlndXJlIHRoYXQgb3V0IGxhdGVyLlxuICBjcmVhdGVPYmplY3QoY2xhc3NOYW1lOiBzdHJpbmcsIHNjaGVtYTogU2NoZW1hVHlwZSwgb2JqZWN0OiBhbnkpIHtcbiAgICBzY2hlbWEgPSBjb252ZXJ0UGFyc2VTY2hlbWFUb01vbmdvU2NoZW1hKHNjaGVtYSk7XG4gICAgY29uc3QgbW9uZ29PYmplY3QgPSBwYXJzZU9iamVjdFRvTW9uZ29PYmplY3RGb3JDcmVhdGUoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uaW5zZXJ0T25lKG1vbmdvT2JqZWN0KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxMTAwMCkgeyAvLyBEdXBsaWNhdGUgdmFsdWVcbiAgICAgICAgICBjb25zdCBlcnIgPSBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCcpO1xuICAgICAgICAgIGVyci51bmRlcmx5aW5nRXJyb3IgPSBlcnJvcjtcbiAgICAgICAgICBpZiAoZXJyb3IubWVzc2FnZSkge1xuICAgICAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGVycm9yLm1lc3NhZ2UubWF0Y2goL2luZGV4OltcXHNhLXpBLVowLTlfXFwtXFwuXStcXCQ/KFthLXpBLVpfLV0rKV8xLyk7XG4gICAgICAgICAgICBpZiAobWF0Y2hlcyAmJiBBcnJheS5pc0FycmF5KG1hdGNoZXMpKSB7XG4gICAgICAgICAgICAgIGVyci51c2VySW5mbyA9IHsgZHVwbGljYXRlZF9maWVsZDogbWF0Y2hlc1sxXSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICB0aHJvdyBlcnI7XG4gICAgICAgIH1cbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gUmVtb3ZlIGFsbCBvYmplY3RzIHRoYXQgbWF0Y2ggdGhlIGdpdmVuIFBhcnNlIFF1ZXJ5LlxuICAvLyBJZiBubyBvYmplY3RzIG1hdGNoLCByZWplY3Qgd2l0aCBPQkpFQ1RfTk9UX0ZPVU5ELiBJZiBvYmplY3RzIGFyZSBmb3VuZCBhbmQgZGVsZXRlZCwgcmVzb2x2ZSB3aXRoIHVuZGVmaW5lZC5cbiAgLy8gSWYgdGhlcmUgaXMgc29tZSBvdGhlciBlcnJvciwgcmVqZWN0IHdpdGggSU5URVJOQUxfU0VSVkVSX0VSUk9SLlxuICBkZWxldGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiB7XG4gICAgICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgICAgICByZXR1cm4gY29sbGVjdGlvbi5kZWxldGVNYW55KG1vbmdvV2hlcmUpXG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpXG4gICAgICAudGhlbigoeyByZXN1bHQgfSkgPT4ge1xuICAgICAgICBpZiAocmVzdWx0Lm4gPT09IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ09iamVjdCBub3QgZm91bmQuJyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgfSwgKCkgPT4ge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLCAnRGF0YWJhc2UgYWRhcHRlciBlcnJvcicpO1xuICAgICAgfSk7XG4gIH1cblxuICAvLyBBcHBseSB0aGUgdXBkYXRlIHRvIGFsbCBvYmplY3RzIHRoYXQgbWF0Y2ggdGhlIGdpdmVuIFBhcnNlIFF1ZXJ5LlxuICB1cGRhdGVPYmplY3RzQnlRdWVyeShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB1cGRhdGU6IGFueSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1VwZGF0ZSA9IHRyYW5zZm9ybVVwZGF0ZShjbGFzc05hbWUsIHVwZGF0ZSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi51cGRhdGVNYW55KG1vbmdvV2hlcmUsIG1vbmdvVXBkYXRlKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIEF0b21pY2FsbHkgZmluZHMgYW5kIHVwZGF0ZXMgYW4gb2JqZWN0IGJhc2VkIG9uIHF1ZXJ5LlxuICAvLyBSZXR1cm4gdmFsdWUgbm90IGN1cnJlbnRseSB3ZWxsIHNwZWNpZmllZC5cbiAgZmluZE9uZUFuZFVwZGF0ZShjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBxdWVyeTogUXVlcnlUeXBlLCB1cGRhdGU6IGFueSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1VwZGF0ZSA9IHRyYW5zZm9ybVVwZGF0ZShjbGFzc05hbWUsIHVwZGF0ZSwgc2NoZW1hKTtcbiAgICBjb25zdCBtb25nb1doZXJlID0gdHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmZpbmRBbmRNb2RpZnkobW9uZ29XaGVyZSwgW10sIG1vbmdvVXBkYXRlLCB7IG5ldzogdHJ1ZSB9KSlcbiAgICAgIC50aGVuKHJlc3VsdCA9PiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCByZXN1bHQudmFsdWUsIHNjaGVtYSkpXG4gICAgICAuY2F0Y2goZXJyb3IgPT4ge1xuICAgICAgICBpZiAoZXJyb3IuY29kZSA9PT0gMTEwMDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCcpO1xuICAgICAgICB9XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIEhvcGVmdWxseSB3ZSBjYW4gZ2V0IHJpZCBvZiB0aGlzLiBJdCdzIG9ubHkgdXNlZCBmb3IgY29uZmlnIGFuZCBob29rcy5cbiAgdXBzZXJ0T25lT2JqZWN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHVwZGF0ZTogYW55KSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvVXBkYXRlID0gdHJhbnNmb3JtVXBkYXRlKGNsYXNzTmFtZSwgdXBkYXRlLCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLnVwc2VydE9uZShtb25nb1doZXJlLCBtb25nb1VwZGF0ZSkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBFeGVjdXRlcyBhIGZpbmQuIEFjY2VwdHM6IGNsYXNzTmFtZSwgcXVlcnkgaW4gUGFyc2UgZm9ybWF0LCBhbmQgeyBza2lwLCBsaW1pdCwgc29ydCB9LlxuICBmaW5kKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHsgc2tpcCwgbGltaXQsIHNvcnQsIGtleXMsIHJlYWRQcmVmZXJlbmNlIH06IFF1ZXJ5T3B0aW9ucyk6IFByb21pc2U8YW55PiB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvV2hlcmUgPSB0cmFuc2Zvcm1XaGVyZShjbGFzc05hbWUsIHF1ZXJ5LCBzY2hlbWEpO1xuICAgIGNvbnN0IG1vbmdvU29ydCA9IF8ubWFwS2V5cyhzb3J0LCAodmFsdWUsIGZpZWxkTmFtZSkgPT4gdHJhbnNmb3JtS2V5KGNsYXNzTmFtZSwgZmllbGROYW1lLCBzY2hlbWEpKTtcbiAgICBjb25zdCBtb25nb0tleXMgPSBfLnJlZHVjZShrZXlzLCAobWVtbywga2V5KSA9PiB7XG4gICAgICBtZW1vW3RyYW5zZm9ybUtleShjbGFzc05hbWUsIGtleSwgc2NoZW1hKV0gPSAxO1xuICAgICAgcmV0dXJuIG1lbW87XG4gICAgfSwge30pO1xuXG4gICAgcmVhZFByZWZlcmVuY2UgPSB0aGlzLl9wYXJzZVJlYWRQcmVmZXJlbmNlKHJlYWRQcmVmZXJlbmNlKTtcbiAgICByZXR1cm4gdGhpcy5jcmVhdGVUZXh0SW5kZXhlc0lmTmVlZGVkKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSlcbiAgICAgIC50aGVuKCgpID0+IHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmZpbmQobW9uZ29XaGVyZSwge1xuICAgICAgICBza2lwLFxuICAgICAgICBsaW1pdCxcbiAgICAgICAgc29ydDogbW9uZ29Tb3J0LFxuICAgICAgICBrZXlzOiBtb25nb0tleXMsXG4gICAgICAgIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TLFxuICAgICAgICByZWFkUHJlZmVyZW5jZSxcbiAgICAgIH0pKVxuICAgICAgLnRoZW4ob2JqZWN0cyA9PiBvYmplY3RzLm1hcChvYmplY3QgPT4gbW9uZ29PYmplY3RUb1BhcnNlT2JqZWN0KGNsYXNzTmFtZSwgb2JqZWN0LCBzY2hlbWEpKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIENyZWF0ZSBhIHVuaXF1ZSBpbmRleC4gVW5pcXVlIGluZGV4ZXMgb24gbnVsbGFibGUgZmllbGRzIGFyZSBub3QgYWxsb3dlZC4gU2luY2Ugd2UgZG9uJ3RcbiAgLy8gY3VycmVudGx5IGtub3cgd2hpY2ggZmllbGRzIGFyZSBudWxsYWJsZSBhbmQgd2hpY2ggYXJlbid0LCB3ZSBpZ25vcmUgdGhhdCBjcml0ZXJpYS5cbiAgLy8gQXMgc3VjaCwgd2Ugc2hvdWxkbid0IGV4cG9zZSB0aGlzIGZ1bmN0aW9uIHRvIHVzZXJzIG9mIHBhcnNlIHVudGlsIHdlIGhhdmUgYW4gb3V0LW9mLWJhbmRcbiAgLy8gV2F5IG9mIGRldGVybWluaW5nIGlmIGEgZmllbGQgaXMgbnVsbGFibGUuIFVuZGVmaW5lZCBkb2Vzbid0IGNvdW50IGFnYWluc3QgdW5pcXVlbmVzcyxcbiAgLy8gd2hpY2ggaXMgd2h5IHdlIHVzZSBzcGFyc2UgaW5kZXhlcy5cbiAgZW5zdXJlVW5pcXVlbmVzcyhjbGFzc05hbWU6IHN0cmluZywgc2NoZW1hOiBTY2hlbWFUeXBlLCBmaWVsZE5hbWVzOiBzdHJpbmdbXSkge1xuICAgIHNjaGVtYSA9IGNvbnZlcnRQYXJzZVNjaGVtYVRvTW9uZ29TY2hlbWEoc2NoZW1hKTtcbiAgICBjb25zdCBpbmRleENyZWF0aW9uUmVxdWVzdCA9IHt9O1xuICAgIGNvbnN0IG1vbmdvRmllbGROYW1lcyA9IGZpZWxkTmFtZXMubWFwKGZpZWxkTmFtZSA9PiB0cmFuc2Zvcm1LZXkoY2xhc3NOYW1lLCBmaWVsZE5hbWUsIHNjaGVtYSkpO1xuICAgIG1vbmdvRmllbGROYW1lcy5mb3JFYWNoKGZpZWxkTmFtZSA9PiB7XG4gICAgICBpbmRleENyZWF0aW9uUmVxdWVzdFtmaWVsZE5hbWVdID0gMTtcbiAgICB9KTtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fZW5zdXJlU3BhcnNlVW5pcXVlSW5kZXhJbkJhY2tncm91bmQoaW5kZXhDcmVhdGlvblJlcXVlc3QpKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKGVycm9yLmNvZGUgPT09IDExMDAwKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSwgJ1RyaWVkIHRvIGVuc3VyZSBmaWVsZCB1bmlxdWVuZXNzIGZvciBhIGNsYXNzIHRoYXQgYWxyZWFkeSBoYXMgZHVwbGljYXRlcy4nKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICAvLyBVc2VkIGluIHRlc3RzXG4gIF9yYXdGaW5kKGNsYXNzTmFtZTogc3RyaW5nLCBxdWVyeTogUXVlcnlUeXBlKSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLmZpbmQocXVlcnksIHtcbiAgICAgIG1heFRpbWVNUzogdGhpcy5fbWF4VGltZU1TLFxuICAgIH0pKS5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIC8vIEV4ZWN1dGVzIGEgY291bnQuXG4gIGNvdW50KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIHJlYWRQcmVmZXJlbmNlOiA/c3RyaW5nKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIHJlYWRQcmVmZXJlbmNlID0gdGhpcy5fcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uY291bnQodHJhbnNmb3JtV2hlcmUoY2xhc3NOYW1lLCBxdWVyeSwgc2NoZW1hKSwge1xuICAgICAgICBtYXhUaW1lTVM6IHRoaXMuX21heFRpbWVNUyxcbiAgICAgICAgcmVhZFByZWZlcmVuY2UsXG4gICAgICB9KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGRpc3RpbmN0KGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IFNjaGVtYVR5cGUsIHF1ZXJ5OiBRdWVyeVR5cGUsIGZpZWxkTmFtZTogc3RyaW5nKSB7XG4gICAgc2NoZW1hID0gY29udmVydFBhcnNlU2NoZW1hVG9Nb25nb1NjaGVtYShzY2hlbWEpO1xuICAgIGNvbnN0IGlzUG9pbnRlckZpZWxkID0gc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09PSAnUG9pbnRlcic7XG4gICAgaWYgKGlzUG9pbnRlckZpZWxkKSB7XG4gICAgICBmaWVsZE5hbWUgPSBgX3BfJHtmaWVsZE5hbWV9YFxuICAgIH1cbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5kaXN0aW5jdChmaWVsZE5hbWUsIHRyYW5zZm9ybVdoZXJlKGNsYXNzTmFtZSwgcXVlcnksIHNjaGVtYSkpKVxuICAgICAgLnRoZW4ob2JqZWN0cyA9PiB7XG4gICAgICAgIG9iamVjdHMgPSBvYmplY3RzLmZpbHRlcigob2JqKSA9PiBvYmogIT0gbnVsbCk7XG4gICAgICAgIHJldHVybiBvYmplY3RzLm1hcChvYmplY3QgPT4ge1xuICAgICAgICAgIGlmIChpc1BvaW50ZXJGaWVsZCkge1xuICAgICAgICAgICAgY29uc3QgZmllbGQgPSBmaWVsZE5hbWUuc3Vic3RyaW5nKDMpO1xuICAgICAgICAgICAgcmV0dXJuIHRyYW5zZm9ybVBvaW50ZXJTdHJpbmcoc2NoZW1hLCBmaWVsZCwgb2JqZWN0KTtcbiAgICAgICAgICB9XG4gICAgICAgICAgcmV0dXJuIG1vbmdvT2JqZWN0VG9QYXJzZU9iamVjdChjbGFzc05hbWUsIG9iamVjdCwgc2NoZW1hKTtcbiAgICAgICAgfSk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgYWdncmVnYXRlKGNsYXNzTmFtZTogc3RyaW5nLCBzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSwgcmVhZFByZWZlcmVuY2U6ID9zdHJpbmcpIHtcbiAgICBsZXQgaXNQb2ludGVyRmllbGQgPSBmYWxzZTtcbiAgICBwaXBlbGluZSA9IHBpcGVsaW5lLm1hcCgoc3RhZ2UpID0+IHtcbiAgICAgIGlmIChzdGFnZS4kZ3JvdXApIHtcbiAgICAgICAgc3RhZ2UuJGdyb3VwID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVHcm91cEFyZ3Moc2NoZW1hLCBzdGFnZS4kZ3JvdXApO1xuICAgICAgICBpZiAoc3RhZ2UuJGdyb3VwLl9pZCAmJiAodHlwZW9mIHN0YWdlLiRncm91cC5faWQgPT09ICdzdHJpbmcnKSAmJiBzdGFnZS4kZ3JvdXAuX2lkLmluZGV4T2YoJyRfcF8nKSA+PSAwKSB7XG4gICAgICAgICAgaXNQb2ludGVyRmllbGQgPSB0cnVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJG1hdGNoKSB7XG4gICAgICAgIHN0YWdlLiRtYXRjaCA9IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHN0YWdlLiRtYXRjaCk7XG4gICAgICB9XG4gICAgICBpZiAoc3RhZ2UuJHByb2plY3QpIHtcbiAgICAgICAgc3RhZ2UuJHByb2plY3QgPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZVByb2plY3RBcmdzKHNjaGVtYSwgc3RhZ2UuJHByb2plY3QpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHN0YWdlO1xuICAgIH0pO1xuICAgIHJlYWRQcmVmZXJlbmNlID0gdGhpcy5fcGFyc2VSZWFkUHJlZmVyZW5jZShyZWFkUHJlZmVyZW5jZSk7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uYWdncmVnYXRlKHBpcGVsaW5lLCB7IHJlYWRQcmVmZXJlbmNlLCBtYXhUaW1lTVM6IHRoaXMuX21heFRpbWVNUyB9KSlcbiAgICAgIC5jYXRjaChlcnJvciA9PiB7XG4gICAgICAgIGlmIChlcnJvci5jb2RlID09PSAxNjAwNikge1xuICAgICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX1FVRVJZLCBlcnJvci5tZXNzYWdlKTtcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgcmVzdWx0cy5mb3JFYWNoKHJlc3VsdCA9PiB7XG4gICAgICAgICAgaWYgKHJlc3VsdC5oYXNPd25Qcm9wZXJ0eSgnX2lkJykpIHtcbiAgICAgICAgICAgIGlmIChpc1BvaW50ZXJGaWVsZCAmJiByZXN1bHQuX2lkKSB7XG4gICAgICAgICAgICAgIHJlc3VsdC5faWQgPSByZXN1bHQuX2lkLnNwbGl0KCckJylbMV07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAocmVzdWx0Ll9pZCA9PSBudWxsIHx8IF8uaXNFbXB0eShyZXN1bHQuX2lkKSkge1xuICAgICAgICAgICAgICByZXN1bHQuX2lkID0gbnVsbDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc3VsdC5vYmplY3RJZCA9IHJlc3VsdC5faWQ7XG4gICAgICAgICAgICBkZWxldGUgcmVzdWx0Ll9pZDtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gcmVzdWx0cztcbiAgICAgIH0pXG4gICAgICAudGhlbihvYmplY3RzID0+IG9iamVjdHMubWFwKG9iamVjdCA9PiBtb25nb09iamVjdFRvUGFyc2VPYmplY3QoY2xhc3NOYW1lLCBvYmplY3QsIHNjaGVtYSkpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiB3aWxsIHJlY3Vyc2l2ZWx5IHRyYXZlcnNlIHRoZSBwaXBlbGluZSBhbmQgY29udmVydCBhbnkgUG9pbnRlciBvciBEYXRlIGNvbHVtbnMuXG4gIC8vIElmIHdlIGRldGVjdCBhIHBvaW50ZXIgY29sdW1uIHdlIHdpbGwgcmVuYW1lIHRoZSBjb2x1bW4gYmVpbmcgcXVlcmllZCBmb3IgdG8gbWF0Y2ggdGhlIGNvbHVtblxuICAvLyBpbiB0aGUgZGF0YWJhc2UuIFdlIGFsc28gbW9kaWZ5IHRoZSB2YWx1ZSB0byB3aGF0IHdlIGV4cGVjdCB0aGUgdmFsdWUgdG8gYmUgaW4gdGhlIGRhdGFiYXNlXG4gIC8vIGFzIHdlbGwuXG4gIC8vIEZvciBkYXRlcywgdGhlIGRyaXZlciBleHBlY3RzIGEgRGF0ZSBvYmplY3QsIGJ1dCB3ZSBoYXZlIGEgc3RyaW5nIGNvbWluZyBpbi4gU28gd2UnbGwgY29udmVydFxuICAvLyB0aGUgc3RyaW5nIHRvIGEgRGF0ZSBzbyB0aGUgZHJpdmVyIGNhbiBwZXJmb3JtIHRoZSBuZWNlc3NhcnkgY29tcGFyaXNvbi5cbiAgLy9cbiAgLy8gVGhlIGdvYWwgb2YgdGhpcyBtZXRob2QgaXMgdG8gbG9vayBmb3IgdGhlIFwibGVhdmVzXCIgb2YgdGhlIHBpcGVsaW5lIGFuZCBkZXRlcm1pbmUgaWYgaXQgbmVlZHNcbiAgLy8gdG8gYmUgY29udmVydGVkLiBUaGUgcGlwZWxpbmUgY2FuIGhhdmUgYSBmZXcgZGlmZmVyZW50IGZvcm1zLiBGb3IgbW9yZSBkZXRhaWxzLCBzZWU6XG4gIC8vICAgICBodHRwczovL2RvY3MubW9uZ29kYi5jb20vbWFudWFsL3JlZmVyZW5jZS9vcGVyYXRvci9hZ2dyZWdhdGlvbi9cbiAgLy9cbiAgLy8gSWYgdGhlIHBpcGVsaW5lIGlzIGFuIGFycmF5LCBpdCBtZWFucyB3ZSBhcmUgcHJvYmFibHkgcGFyc2luZyBhbiAnJGFuZCcgb3IgJyRvcicgb3BlcmF0b3IuIEluXG4gIC8vIHRoYXQgY2FzZSB3ZSBuZWVkIHRvIGxvb3AgdGhyb3VnaCBhbGwgb2YgaXQncyBjaGlsZHJlbiB0byBmaW5kIHRoZSBjb2x1bW5zIGJlaW5nIG9wZXJhdGVkIG9uLlxuICAvLyBJZiB0aGUgcGlwZWxpbmUgaXMgYW4gb2JqZWN0LCB0aGVuIHdlJ2xsIGxvb3AgdGhyb3VnaCB0aGUga2V5cyBjaGVja2luZyB0byBzZWUgaWYgdGhlIGtleSBuYW1lXG4gIC8vIG1hdGNoZXMgb25lIG9mIHRoZSBzY2hlbWEgY29sdW1ucy4gSWYgaXQgZG9lcyBtYXRjaCBhIGNvbHVtbiBhbmQgdGhlIGNvbHVtbiBpcyBhIFBvaW50ZXIgb3JcbiAgLy8gYSBEYXRlLCB0aGVuIHdlJ2xsIGNvbnZlcnQgdGhlIHZhbHVlIGFzIGRlc2NyaWJlZCBhYm92ZS5cbiAgLy9cbiAgLy8gQXMgbXVjaCBhcyBJIGhhdGUgcmVjdXJzaW9uLi4udGhpcyBzZWVtZWQgbGlrZSBhIGdvb2QgZml0IGZvciBpdC4gV2UncmUgZXNzZW50aWFsbHkgdHJhdmVyc2luZ1xuICAvLyBkb3duIGEgdHJlZSB0byBmaW5kIGEgXCJsZWFmIG5vZGVcIiBhbmQgY2hlY2tpbmcgdG8gc2VlIGlmIGl0IG5lZWRzIHRvIGJlIGNvbnZlcnRlZC5cbiAgX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWE6IGFueSwgcGlwZWxpbmU6IGFueSk6IGFueSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkocGlwZWxpbmUpKSB7XG4gICAgICByZXR1cm4gcGlwZWxpbmUubWFwKCh2YWx1ZSkgPT4gdGhpcy5fcGFyc2VBZ2dyZWdhdGVBcmdzKHNjaGVtYSwgdmFsdWUpKTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBwaXBlbGluZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGNvbnN0IHJldHVyblZhbHVlID0ge307XG4gICAgICBmb3IgKGNvbnN0IGZpZWxkIGluIHBpcGVsaW5lKSB7XG4gICAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgICBpZiAodHlwZW9mIHBpcGVsaW5lW2ZpZWxkXSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIC8vIFBhc3Mgb2JqZWN0cyBkb3duIHRvIE1vbmdvREIuLi50aGlzIGlzIG1vcmUgdGhhbiBsaWtlbHkgYW4gJGV4aXN0cyBvcGVyYXRvci5cbiAgICAgICAgICAgIHJldHVyblZhbHVlW2BfcF8ke2ZpZWxkfWBdID0gcGlwZWxpbmVbZmllbGRdO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm5WYWx1ZVtgX3BfJHtmaWVsZH1gXSA9IGAke3NjaGVtYS5maWVsZHNbZmllbGRdLnRhcmdldENsYXNzfSQke3BpcGVsaW5lW2ZpZWxkXX1gO1xuICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnRGF0ZScpIHtcbiAgICAgICAgICByZXR1cm5WYWx1ZVtmaWVsZF0gPSB0aGlzLl9jb252ZXJ0VG9EYXRlKHBpcGVsaW5lW2ZpZWxkXSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fcGFyc2VBZ2dyZWdhdGVBcmdzKHNjaGVtYSwgcGlwZWxpbmVbZmllbGRdKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChmaWVsZCA9PT0gJ29iamVjdElkJykge1xuICAgICAgICAgIHJldHVyblZhbHVlWydfaWQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICAgIHJldHVyblZhbHVlWydfY3JlYXRlZF9hdCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgICAgcmV0dXJuVmFsdWVbJ191cGRhdGVkX2F0J10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgcmV0dXJuIHJldHVyblZhbHVlO1xuICAgIH1cbiAgICByZXR1cm4gcGlwZWxpbmU7XG4gIH1cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIHNsaWdodGx5IGRpZmZlcmVudCB0aGFuIHRoZSBvbmUgYWJvdmUuIFJhdGhlciB0aGFuIHRyeWluZyB0byBjb21iaW5lIHRoZXNlXG4gIC8vIHR3byBmdW5jdGlvbnMgYW5kIG1ha2luZyB0aGUgY29kZSBldmVuIGhhcmRlciB0byB1bmRlcnN0YW5kLCBJIGRlY2lkZWQgdG8gc3BsaXQgaXQgdXAuIFRoZVxuICAvLyBkaWZmZXJlbmNlIHdpdGggdGhpcyBmdW5jdGlvbiBpcyB3ZSBhcmUgbm90IHRyYW5zZm9ybWluZyB0aGUgdmFsdWVzLCBvbmx5IHRoZSBrZXlzIG9mIHRoZVxuICAvLyBwaXBlbGluZS5cbiAgX3BhcnNlQWdncmVnYXRlUHJvamVjdEFyZ3Moc2NoZW1hOiBhbnksIHBpcGVsaW5lOiBhbnkpOiBhbnkge1xuICAgIGNvbnN0IHJldHVyblZhbHVlID0ge307XG4gICAgZm9yIChjb25zdCBmaWVsZCBpbiBwaXBlbGluZSkge1xuICAgICAgaWYgKHNjaGVtYS5maWVsZHNbZmllbGRdICYmIHNjaGVtYS5maWVsZHNbZmllbGRdLnR5cGUgPT09ICdQb2ludGVyJykge1xuICAgICAgICByZXR1cm5WYWx1ZVtgX3BfJHtmaWVsZH1gXSA9IHBpcGVsaW5lW2ZpZWxkXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVyblZhbHVlW2ZpZWxkXSA9IHRoaXMuX3BhcnNlQWdncmVnYXRlQXJncyhzY2hlbWEsIHBpcGVsaW5lW2ZpZWxkXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChmaWVsZCA9PT0gJ29iamVjdElkJykge1xuICAgICAgICByZXR1cm5WYWx1ZVsnX2lkJ10gPSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICAgIGRlbGV0ZSByZXR1cm5WYWx1ZVtmaWVsZF07XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkID09PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICByZXR1cm5WYWx1ZVsnX2NyZWF0ZWRfYXQnXSA9IHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgICAgZGVsZXRlIHJldHVyblZhbHVlW2ZpZWxkXTtcbiAgICAgIH0gZWxzZSBpZiAoZmllbGQgPT09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgIHJldHVyblZhbHVlWydfdXBkYXRlZF9hdCddID0gcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgICBkZWxldGUgcmV0dXJuVmFsdWVbZmllbGRdO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gIH1cblxuICAvLyBUaGlzIGZ1bmN0aW9uIGlzIHNsaWdodGx5IGRpZmZlcmVudCB0aGFuIHRoZSB0d28gYWJvdmUuIE1vbmdvREIgJGdyb3VwIGFnZ3JlZ2F0ZSBsb29rcyBsaWtlOlxuICAvLyAgICAgeyAkZ3JvdXA6IHsgX2lkOiA8ZXhwcmVzc2lvbj4sIDxmaWVsZDE+OiB7IDxhY2N1bXVsYXRvcjE+IDogPGV4cHJlc3Npb24xPiB9LCAuLi4gfSB9XG4gIC8vIFRoZSA8ZXhwcmVzc2lvbj4gY291bGQgYmUgYSBjb2x1bW4gbmFtZSwgcHJlZml4ZWQgd2l0aCB0aGUgJyQnIGNoYXJhY3Rlci4gV2UnbGwgbG9vayBmb3JcbiAgLy8gdGhlc2UgPGV4cHJlc3Npb24+IGFuZCBjaGVjayB0byBzZWUgaWYgaXQgaXMgYSAnUG9pbnRlcicgb3IgaWYgaXQncyBvbmUgb2YgY3JlYXRlZEF0LFxuICAvLyB1cGRhdGVkQXQgb3Igb2JqZWN0SWQgYW5kIGNoYW5nZSBpdCBhY2NvcmRpbmdseS5cbiAgX3BhcnNlQWdncmVnYXRlR3JvdXBBcmdzKHNjaGVtYTogYW55LCBwaXBlbGluZTogYW55KTogYW55IHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheShwaXBlbGluZSkpIHtcbiAgICAgIHJldHVybiBwaXBlbGluZS5tYXAoKHZhbHVlKSA9PiB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUdyb3VwQXJncyhzY2hlbWEsIHZhbHVlKSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcGlwZWxpbmUgPT09ICdvYmplY3QnKSB7XG4gICAgICBjb25zdCByZXR1cm5WYWx1ZSA9IHt9O1xuICAgICAgZm9yIChjb25zdCBmaWVsZCBpbiBwaXBlbGluZSkge1xuICAgICAgICByZXR1cm5WYWx1ZVtmaWVsZF0gPSB0aGlzLl9wYXJzZUFnZ3JlZ2F0ZUdyb3VwQXJncyhzY2hlbWEsIHBpcGVsaW5lW2ZpZWxkXSk7XG4gICAgICB9XG4gICAgICByZXR1cm4gcmV0dXJuVmFsdWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgcGlwZWxpbmUgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjb25zdCBmaWVsZCA9IHBpcGVsaW5lLnN1YnN0cmluZygxKTtcbiAgICAgIGlmIChzY2hlbWEuZmllbGRzW2ZpZWxkXSAmJiBzY2hlbWEuZmllbGRzW2ZpZWxkXS50eXBlID09PSAnUG9pbnRlcicpIHtcbiAgICAgICAgcmV0dXJuIGAkX3BfJHtmaWVsZH1gO1xuICAgICAgfSBlbHNlIGlmIChmaWVsZCA9PSAnY3JlYXRlZEF0Jykge1xuICAgICAgICByZXR1cm4gJyRfY3JlYXRlZF9hdCc7XG4gICAgICB9IGVsc2UgaWYgKGZpZWxkID09ICd1cGRhdGVkQXQnKSB7XG4gICAgICAgIHJldHVybiAnJF91cGRhdGVkX2F0JztcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHBpcGVsaW5lO1xuICB9XG5cbiAgLy8gVGhpcyBmdW5jdGlvbiB3aWxsIGF0dGVtcHQgdG8gY29udmVydCB0aGUgcHJvdmlkZWQgdmFsdWUgdG8gYSBEYXRlIG9iamVjdC4gU2luY2UgdGhpcyBpcyBwYXJ0XG4gIC8vIG9mIGFuIGFnZ3JlZ2F0aW9uIHBpcGVsaW5lLCB0aGUgdmFsdWUgY2FuIGVpdGhlciBiZSBhIHN0cmluZyBvciBpdCBjYW4gYmUgYW5vdGhlciBvYmplY3Qgd2l0aFxuICAvLyBhbiBvcGVyYXRvciBpbiBpdCAobGlrZSAkZ3QsICRsdCwgZXRjKS4gQmVjYXVzZSBvZiB0aGlzIEkgZmVsdCBpdCB3YXMgZWFzaWVyIHRvIG1ha2UgdGhpcyBhXG4gIC8vIHJlY3Vyc2l2ZSBtZXRob2QgdG8gdHJhdmVyc2UgZG93biB0byB0aGUgXCJsZWFmIG5vZGVcIiB3aGljaCBpcyBnb2luZyB0byBiZSB0aGUgc3RyaW5nLlxuICBfY29udmVydFRvRGF0ZSh2YWx1ZTogYW55KTogYW55IHtcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgICAgcmV0dXJuIG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXR1cm5WYWx1ZSA9IHt9XG4gICAgZm9yIChjb25zdCBmaWVsZCBpbiB2YWx1ZSkge1xuICAgICAgcmV0dXJuVmFsdWVbZmllbGRdID0gdGhpcy5fY29udmVydFRvRGF0ZSh2YWx1ZVtmaWVsZF0pXG4gICAgfVxuICAgIHJldHVybiByZXR1cm5WYWx1ZTtcbiAgfVxuXG4gIF9wYXJzZVJlYWRQcmVmZXJlbmNlKHJlYWRQcmVmZXJlbmNlOiA/c3RyaW5nKTogP3N0cmluZyB7XG4gICAgc3dpdGNoIChyZWFkUHJlZmVyZW5jZSkge1xuICAgIGNhc2UgJ1BSSU1BUlknOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5QUklNQVJZO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnUFJJTUFSWV9QUkVGRVJSRUQnOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5QUklNQVJZX1BSRUZFUlJFRDtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ1NFQ09OREFSWSc6XG4gICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLlNFQ09OREFSWTtcbiAgICAgIGJyZWFrO1xuICAgIGNhc2UgJ1NFQ09OREFSWV9QUkVGRVJSRUQnOlxuICAgICAgcmVhZFByZWZlcmVuY2UgPSBSZWFkUHJlZmVyZW5jZS5TRUNPTkRBUllfUFJFRkVSUkVEO1xuICAgICAgYnJlYWs7XG4gICAgY2FzZSAnTkVBUkVTVCc6XG4gICAgICByZWFkUHJlZmVyZW5jZSA9IFJlYWRQcmVmZXJlbmNlLk5FQVJFU1Q7XG4gICAgICBicmVhaztcbiAgICBjYXNlIHVuZGVmaW5lZDpcbiAgICAgIGJyZWFrO1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9RVUVSWSwgJ05vdCBzdXBwb3J0ZWQgcmVhZCBwcmVmZXJlbmNlLicpO1xuICAgIH1cbiAgICByZXR1cm4gcmVhZFByZWZlcmVuY2U7XG4gIH1cblxuICBwZXJmb3JtSW5pdGlhbGl6YXRpb24oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgY3JlYXRlSW5kZXgoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4OiBhbnkpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmNyZWF0ZUluZGV4KGluZGV4KSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGNyZWF0ZUluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcsIGluZGV4ZXM6IGFueSkge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uY3JlYXRlSW5kZXhlcyhpbmRleGVzKSlcbiAgICAgIC5jYXRjaChlcnIgPT4gdGhpcy5oYW5kbGVFcnJvcihlcnIpKTtcbiAgfVxuXG4gIGNyZWF0ZUluZGV4ZXNJZk5lZWRlZChjbGFzc05hbWU6IHN0cmluZywgZmllbGROYW1lOiBzdHJpbmcsIHR5cGU6IGFueSkge1xuICAgIGlmICh0eXBlICYmIHR5cGUudHlwZSA9PT0gJ1BvbHlnb24nKSB7XG4gICAgICBjb25zdCBpbmRleCA9IHtcbiAgICAgICAgW2ZpZWxkTmFtZV06ICcyZHNwaGVyZSdcbiAgICAgIH07XG4gICAgICByZXR1cm4gdGhpcy5jcmVhdGVJbmRleChjbGFzc05hbWUsIGluZGV4KTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgY3JlYXRlVGV4dEluZGV4ZXNJZk5lZWRlZChjbGFzc05hbWU6IHN0cmluZywgcXVlcnk6IFF1ZXJ5VHlwZSwgc2NoZW1hOiBhbnkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBmb3IoY29uc3QgZmllbGROYW1lIGluIHF1ZXJ5KSB7XG4gICAgICBpZiAoIXF1ZXJ5W2ZpZWxkTmFtZV0gfHwgIXF1ZXJ5W2ZpZWxkTmFtZV0uJHRleHQpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBleGlzdGluZ0luZGV4ZXMgPSBzY2hlbWEuaW5kZXhlcztcbiAgICAgIGZvciAoY29uc3Qga2V5IGluIGV4aXN0aW5nSW5kZXhlcykge1xuICAgICAgICBjb25zdCBpbmRleCA9IGV4aXN0aW5nSW5kZXhlc1trZXldO1xuICAgICAgICBpZiAoaW5kZXguaGFzT3duUHJvcGVydHkoZmllbGROYW1lKSkge1xuICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgY29uc3QgaW5kZXhOYW1lID0gYCR7ZmllbGROYW1lfV90ZXh0YDtcbiAgICAgIGNvbnN0IHRleHRJbmRleCA9IHtcbiAgICAgICAgW2luZGV4TmFtZV06IHsgW2ZpZWxkTmFtZV06ICd0ZXh0JyB9XG4gICAgICB9O1xuICAgICAgcmV0dXJuIHRoaXMuc2V0SW5kZXhlc1dpdGhTY2hlbWFGb3JtYXQoY2xhc3NOYW1lLCB0ZXh0SW5kZXgsIGV4aXN0aW5nSW5kZXhlcywgc2NoZW1hLmZpZWxkcylcbiAgICAgICAgLmNhdGNoKChlcnJvcikgPT4ge1xuICAgICAgICAgIGlmIChlcnJvci5jb2RlID09PSA4NSkgeyAvLyBJbmRleCBleGlzdCB3aXRoIGRpZmZlcmVudCBvcHRpb25zXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5zZXRJbmRleGVzRnJvbU1vbmdvKGNsYXNzTmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgZ2V0SW5kZXhlcyhjbGFzc05hbWU6IHN0cmluZykge1xuICAgIHJldHVybiB0aGlzLl9hZGFwdGl2ZUNvbGxlY3Rpb24oY2xhc3NOYW1lKVxuICAgICAgLnRoZW4oY29sbGVjdGlvbiA9PiBjb2xsZWN0aW9uLl9tb25nb0NvbGxlY3Rpb24uaW5kZXhlcygpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgZHJvcEluZGV4KGNsYXNzTmFtZTogc3RyaW5nLCBpbmRleDogYW55KSB7XG4gICAgcmV0dXJuIHRoaXMuX2FkYXB0aXZlQ29sbGVjdGlvbihjbGFzc05hbWUpXG4gICAgICAudGhlbihjb2xsZWN0aW9uID0+IGNvbGxlY3Rpb24uX21vbmdvQ29sbGVjdGlvbi5kcm9wSW5kZXgoaW5kZXgpKVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG5cbiAgZHJvcEFsbEluZGV4ZXMoY2xhc3NOYW1lOiBzdHJpbmcpIHtcbiAgICByZXR1cm4gdGhpcy5fYWRhcHRpdmVDb2xsZWN0aW9uKGNsYXNzTmFtZSlcbiAgICAgIC50aGVuKGNvbGxlY3Rpb24gPT4gY29sbGVjdGlvbi5fbW9uZ29Db2xsZWN0aW9uLmRyb3BJbmRleGVzKCkpXG4gICAgICAuY2F0Y2goZXJyID0+IHRoaXMuaGFuZGxlRXJyb3IoZXJyKSk7XG4gIH1cblxuICB1cGRhdGVTY2hlbWFXaXRoSW5kZXhlcygpOiBQcm9taXNlPGFueT4ge1xuICAgIHJldHVybiB0aGlzLmdldEFsbENsYXNzZXMoKVxuICAgICAgLnRoZW4oKGNsYXNzZXMpID0+IHtcbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBjbGFzc2VzLm1hcCgoc2NoZW1hKSA9PiB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuc2V0SW5kZXhlc0Zyb21Nb25nbyhzY2hlbWEuY2xhc3NOYW1lKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiBQcm9taXNlLmFsbChwcm9taXNlcyk7XG4gICAgICB9KVxuICAgICAgLmNhdGNoKGVyciA9PiB0aGlzLmhhbmRsZUVycm9yKGVycikpO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IE1vbmdvU3RvcmFnZUFkYXB0ZXI7XG4iXX0=