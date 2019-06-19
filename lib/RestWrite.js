'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _RestQuery = require('./RestQuery');

var _RestQuery2 = _interopRequireDefault(_RestQuery);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _logger = require('./logger');

var _logger2 = _interopRequireDefault(_logger);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

// A RestWrite encapsulates everything we need to run an operation
// that writes to the database.
// This could be either a "create" or an "update".

var SchemaController = require('./Controllers/SchemaController');
var deepcopy = require('deepcopy');

const Auth = require('./Auth');
var cryptoUtils = require('./cryptoUtils');
var passwordCrypto = require('./password');
var Parse = require('parse/node');
var triggers = require('./triggers');
var ClientSDK = require('./ClientSDK');


// query and data are both provided in REST API format. So data
// types are encoded by plain old objects.
// If query is null, this is a "create" and the data in data should be
// created.
// Otherwise this is an "update" - the object matching the query
// should get updated with data.
// RestWrite will handle objectId, createdAt, and updatedAt for
// everything. It also knows to use triggers and special modifications
// for the _User class.
function RestWrite(config, auth, className, query, data, originalData, clientSDK) {
  if (auth.isReadOnly) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Cannot perform a write operation when using readOnlyMasterKey');
  }
  this.config = config;
  this.auth = auth;
  this.className = className;
  this.clientSDK = clientSDK;
  this.storage = {};
  this.runOptions = {};
  if (!query && data.objectId) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'objectId is an invalid field name.');
  }

  // When the operation is complete, this.response may have several
  // fields.
  // response: the actual data to be returned
  // status: the http status code. if not present, treated like a 200
  // location: the location header. if not present, no location header
  this.response = null;

  // Processing this operation may mutate our data, so we operate on a
  // copy
  this.query = deepcopy(query);
  this.data = deepcopy(data);
  // We never change originalData, so we do not need a deep copy
  this.originalData = originalData;

  // The timestamp we'll use for this whole operation
  this.updatedAt = Parse._encode(new Date()).iso;
}

// A convenient method to perform all the steps of processing the
// write, in order.
// Returns a promise for a {response, status, location} object.
// status and location are optional.
RestWrite.prototype.execute = function () {
  return Promise.resolve().then(() => {
    return this.getUserAndRoleACL();
  }).then(() => {
    return this.validateClientClassCreation();
  }).then(() => {
    return this.handleInstallation();
  }).then(() => {
    return this.handleSession();
  }).then(() => {
    return this.validateAuthData();
  }).then(() => {
    return this.runBeforeTrigger();
  }).then(() => {
    return this.validateSchema();
  }).then(() => {
    return this.setRequiredFieldsIfNeeded();
  }).then(() => {
    return this.transformUser();
  }).then(() => {
    return this.expandFilesForExistingObjects();
  }).then(() => {
    return this.destroyDuplicatedSessions();
  }).then(() => {
    return this.runDatabaseOperation();
  }).then(() => {
    return this.createSessionTokenIfNeeded();
  }).then(() => {
    return this.handleFollowup();
  }).then(() => {
    return this.runAfterTrigger();
  }).then(() => {
    return this.cleanUserAuthData();
  }).then(() => {
    return this.response;
  });
};

// Uses the Auth object to get the list of roles, adds the user id
RestWrite.prototype.getUserAndRoleACL = function () {
  if (this.auth.isMaster) {
    return Promise.resolve();
  }

  this.runOptions.acl = ['*'];

  if (this.auth.user) {
    return this.auth.getUserRoles().then(roles => {
      this.runOptions.acl = this.runOptions.acl.concat(roles, [this.auth.user.id]);
      return;
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the allowClientClassCreation config.
RestWrite.prototype.validateClientClassCreation = function () {
  if (this.config.allowClientClassCreation === false && !this.auth.isMaster && SchemaController.systemClasses.indexOf(this.className) === -1) {
    return this.config.database.loadSchema().then(schemaController => schemaController.hasClass(this.className)).then(hasClass => {
      if (hasClass !== true) {
        throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'This user is not allowed to access ' + 'non-existent class: ' + this.className);
      }
    });
  } else {
    return Promise.resolve();
  }
};

// Validates this operation against the schema.
RestWrite.prototype.validateSchema = function () {
  return this.config.database.validateObject(this.className, this.data, this.query, this.runOptions);
};

// Runs any beforeSave triggers against this operation.
// Any change leads to our data being mutated.
RestWrite.prototype.runBeforeTrigger = function () {
  if (this.response) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'beforeSave' trigger for this class.
  if (!triggers.triggerExists(this.className, triggers.Types.beforeSave, this.config.applicationId)) {
    return Promise.resolve();
  }

  // Cloud code gets a bit of extra data for its objects
  var extraData = { className: this.className };
  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  }

  let originalObject = null;
  const updatedObject = this.buildUpdatedObject(extraData);
  if (this.query && this.query.objectId) {
    // This is an update for existing object.
    originalObject = triggers.inflate(extraData, this.originalData);
  }

  return Promise.resolve().then(() => {
    return triggers.maybeRunTrigger(triggers.Types.beforeSave, this.auth, updatedObject, originalObject, this.config);
  }).then(response => {
    if (response && response.object) {
      this.storage.fieldsChangedByTrigger = _lodash2.default.reduce(response.object, (result, value, key) => {
        if (!_lodash2.default.isEqual(this.data[key], value)) {
          result.push(key);
        }
        return result;
      }, []);
      this.data = response.object;
      // We should delete the objectId for an update write
      if (this.query && this.query.objectId) {
        delete this.data.objectId;
      }
    }
  });
};

RestWrite.prototype.setRequiredFieldsIfNeeded = function () {
  if (this.data) {
    // Add default fields
    this.data.updatedAt = this.updatedAt;
    if (!this.query) {
      this.data.createdAt = this.updatedAt;

      // Only assign new objectId if we are creating new object
      if (!this.data.objectId) {
        this.data.objectId = cryptoUtils.newObjectId(this.config.objectIdSize);
      }
    }
  }
  return Promise.resolve();
};

// Transforms auth data for a user object.
// Does nothing if this isn't a user object.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.validateAuthData = function () {
  if (this.className !== '_User') {
    return;
  }

  if (!this.query && !this.data.authData) {
    if (typeof this.data.username !== 'string' || _lodash2.default.isEmpty(this.data.username)) {
      throw new Parse.Error(Parse.Error.USERNAME_MISSING, 'bad or missing username');
    }
    if (typeof this.data.password !== 'string' || _lodash2.default.isEmpty(this.data.password)) {
      throw new Parse.Error(Parse.Error.PASSWORD_MISSING, 'password is required');
    }
  }

  if (!this.data.authData || !Object.keys(this.data.authData).length) {
    return;
  }

  var authData = this.data.authData;
  var providers = Object.keys(authData);
  if (providers.length > 0) {
    const canHandleAuthData = providers.reduce((canHandle, provider) => {
      var providerAuthData = authData[provider];
      var hasToken = providerAuthData && providerAuthData.id;
      return canHandle && (hasToken || providerAuthData == null);
    }, true);
    if (canHandleAuthData) {
      return this.handleAuthData(authData);
    }
  }
  throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
};

RestWrite.prototype.handleAuthDataValidation = function (authData) {
  const validations = Object.keys(authData).map(provider => {
    if (authData[provider] === null) {
      return Promise.resolve();
    }
    const validateAuthData = this.config.authDataManager.getValidatorForProvider(provider);
    if (!validateAuthData) {
      throw new Parse.Error(Parse.Error.UNSUPPORTED_SERVICE, 'This authentication method is unsupported.');
    }
    return validateAuthData(authData[provider]);
  });
  return Promise.all(validations);
};

RestWrite.prototype.findUsersWithAuthData = function (authData) {
  const providers = Object.keys(authData);
  const query = providers.reduce((memo, provider) => {
    if (!authData[provider]) {
      return memo;
    }
    const queryKey = `authData.${provider}.id`;
    const query = {};
    query[queryKey] = authData[provider].id;
    memo.push(query);
    return memo;
  }, []).filter(q => {
    return typeof q !== 'undefined';
  });

  let findPromise = Promise.resolve([]);
  if (query.length > 0) {
    findPromise = this.config.database.find(this.className, { '$or': query }, {});
  }

  return findPromise;
};

RestWrite.prototype.filteredObjectsByACL = function (objects) {
  if (this.auth.isMaster) {
    return objects;
  }
  return objects.filter(object => {
    if (!object.ACL) {
      return true; // legacy users that have no ACL field on them
    }
    // Regular users that have been locked out.
    return object.ACL && Object.keys(object.ACL).length > 0;
  });
};

RestWrite.prototype.handleAuthData = function (authData) {
  let results;
  return this.findUsersWithAuthData(authData).then(r => {
    results = this.filteredObjectsByACL(r);
    if (results.length > 1) {
      // More than 1 user with the passed id's
      throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
    }

    this.storage['authProvider'] = Object.keys(authData).join(',');

    if (results.length > 0) {
      const userResult = results[0];
      const mutatedAuthData = {};
      Object.keys(authData).forEach(provider => {
        const providerData = authData[provider];
        const userAuthData = userResult.authData[provider];
        if (!_lodash2.default.isEqual(providerData, userAuthData)) {
          mutatedAuthData[provider] = providerData;
        }
      });
      const hasMutatedAuthData = Object.keys(mutatedAuthData).length !== 0;
      let userId;
      if (this.query && this.query.objectId) {
        userId = this.query.objectId;
      } else if (this.auth && this.auth.user && this.auth.user.id) {
        userId = this.auth.user.id;
      }
      if (!userId || userId === userResult.objectId) {
        // no user making the call
        // OR the user making the call is the right one
        // Login with auth data
        delete results[0].password;

        // need to set the objectId first otherwise location has trailing undefined
        this.data.objectId = userResult.objectId;

        if (!this.query || !this.query.objectId) {
          // this a login call, no userId passed
          this.response = {
            response: userResult,
            location: this.location()
          };
        }
        // If we didn't change the auth data, just keep going
        if (!hasMutatedAuthData) {
          return;
        }
        // We have authData that is updated on login
        // that can happen when token are refreshed,
        // We should update the token and let the user in
        // We should only check the mutated keys
        return this.handleAuthDataValidation(mutatedAuthData).then(() => {
          // IF we have a response, we'll skip the database operation / beforeSave / afterSave etc...
          // we need to set it up there.
          // We are supposed to have a response only on LOGIN with authData, so we skip those
          // If we're not logging in, but just updating the current user, we can safely skip that part
          if (this.response) {
            // Assign the new authData in the response
            Object.keys(mutatedAuthData).forEach(provider => {
              this.response.response.authData[provider] = mutatedAuthData[provider];
            });
            // Run the DB update directly, as 'master'
            // Just update the authData part
            // Then we're good for the user, early exit of sorts
            return this.config.database.update(this.className, { objectId: this.data.objectId }, { authData: mutatedAuthData }, {});
          }
        });
      } else if (userId) {
        // Trying to update auth data but users
        // are different
        if (userResult.objectId !== userId) {
          throw new Parse.Error(Parse.Error.ACCOUNT_ALREADY_LINKED, 'this auth is already used');
        }
        // No auth data was mutated, just keep going
        if (!hasMutatedAuthData) {
          return;
        }
      }
    }
    return this.handleAuthDataValidation(authData);
  });
};

// The non-third-party parts of User transformation
RestWrite.prototype.transformUser = function () {
  var promise = Promise.resolve();

  if (this.className !== '_User') {
    return promise;
  }

  if (!this.auth.isMaster && "emailVerified" in this.data) {
    const error = `Clients aren't allowed to manually update email verification.`;
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, error);
  }

  // Do not cleanup session if objectId is not set
  if (this.query && this.objectId()) {
    // If we're updating a _User object, we need to clear out the cache for that user. Find all their
    // session tokens, and remove them from the cache.
    promise = new _RestQuery2.default(this.config, Auth.master(this.config), '_Session', {
      user: {
        __type: "Pointer",
        className: "_User",
        objectId: this.objectId()
      }
    }).execute().then(results => {
      results.results.forEach(session => this.config.cacheController.user.del(session.sessionToken));
    });
  }

  return promise.then(() => {
    // Transform the password
    if (this.data.password === undefined) {
      // ignore only if undefined. should proceed if empty ('')
      return Promise.resolve();
    }

    if (this.query) {
      this.storage['clearSessions'] = true;
      // Generate a new session only if the user requested
      if (!this.auth.isMaster) {
        this.storage['generateNewSession'] = true;
      }
    }

    return this._validatePasswordPolicy().then(() => {
      return passwordCrypto.hash(this.data.password).then(hashedPassword => {
        this.data._hashed_password = hashedPassword;
        delete this.data.password;
      });
    });
  }).then(() => {
    return this._validateUserName();
  }).then(() => {
    return this._validateEmail();
  });
};

RestWrite.prototype._validateUserName = function () {
  // Check for username uniqueness
  if (!this.data.username) {
    if (!this.query) {
      this.data.username = cryptoUtils.randomString(25);
      this.responseShouldHaveUsername = true;
    }
    return Promise.resolve();
  }
  // We need to a find to check for duplicate username in case they are missing the unique index on usernames
  // TODO: Check if there is a unique index, and if so, skip this query.
  return this.config.database.find(this.className, { username: this.data.username, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
    }
    return;
  });
};

RestWrite.prototype._validateEmail = function () {
  if (!this.data.email || this.data.email.__op === 'Delete') {
    return Promise.resolve();
  }
  // Validate basic email address format
  if (!this.data.email.match(/^.+@.+$/)) {
    return Promise.reject(new Parse.Error(Parse.Error.INVALID_EMAIL_ADDRESS, 'Email address format is invalid.'));
  }
  // Same problem for email as above for username
  return this.config.database.find(this.className, { email: this.data.email, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
    if (results.length > 0) {
      throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
    }
    if (!this.data.authData || !Object.keys(this.data.authData).length || Object.keys(this.data.authData).length === 1 && Object.keys(this.data.authData)[0] === 'anonymous') {
      // We updated the email, send a new validation
      this.storage['sendVerificationEmail'] = true;
      this.config.userController.setEmailVerifyToken(this.data);
    }
  });
};

RestWrite.prototype._validatePasswordPolicy = function () {
  if (!this.config.passwordPolicy) return Promise.resolve();
  return this._validatePasswordRequirements().then(() => {
    return this._validatePasswordHistory();
  });
};

RestWrite.prototype._validatePasswordRequirements = function () {
  // check if the password conforms to the defined password policy if configured
  const policyError = 'Password does not meet the Password Policy requirements.';

  // check whether the password meets the password strength requirements
  if (this.config.passwordPolicy.patternValidator && !this.config.passwordPolicy.patternValidator(this.data.password) || this.config.passwordPolicy.validatorCallback && !this.config.passwordPolicy.validatorCallback(this.data.password)) {
    return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
  }

  // check whether password contain username
  if (this.config.passwordPolicy.doNotAllowUsername === true) {
    if (this.data.username) {
      // username is not passed during password reset
      if (this.data.password.indexOf(this.data.username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
    } else {
      // retrieve the User object using objectId during password reset
      return this.config.database.find('_User', { objectId: this.objectId() }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        if (this.data.password.indexOf(results[0].username) >= 0) return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, policyError));
        return Promise.resolve();
      });
    }
  }
  return Promise.resolve();
};

RestWrite.prototype._validatePasswordHistory = function () {
  // check whether password is repeating from specified history
  if (this.query && this.config.passwordPolicy.maxPasswordHistory) {
    return this.config.database.find('_User', { objectId: this.objectId() }, { keys: ["_password_history", "_hashed_password"] }).then(results => {
      if (results.length != 1) {
        throw undefined;
      }
      const user = results[0];
      let oldPasswords = [];
      if (user._password_history) oldPasswords = _lodash2.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory - 1);
      oldPasswords.push(user.password);
      const newPassword = this.data.password;
      // compare the new password hash with all old password hashes
      const promises = oldPasswords.map(function (hash) {
        return passwordCrypto.compare(newPassword, hash).then(result => {
          if (result) // reject if there is a match
            return Promise.reject("REPEAT_PASSWORD");
          return Promise.resolve();
        });
      });
      // wait for all comparisons to complete
      return Promise.all(promises).then(() => {
        return Promise.resolve();
      }).catch(err => {
        if (err === "REPEAT_PASSWORD") // a match was found
          return Promise.reject(new Parse.Error(Parse.Error.VALIDATION_ERROR, `New password should not be the same as last ${this.config.passwordPolicy.maxPasswordHistory} passwords.`));
        throw err;
      });
    });
  }
  return Promise.resolve();
};

RestWrite.prototype.createSessionTokenIfNeeded = function () {
  if (this.className !== '_User') {
    return;
  }
  if (this.query) {
    return;
  }
  if (!this.storage['authProvider'] // signup call, with
  && this.config.preventLoginWithUnverifiedEmail // no login without verification
  && this.config.verifyUserEmails) {
    // verification is on
    return; // do not create the session token in that case!
  }
  return this.createSessionToken();
};

RestWrite.prototype.createSessionToken = function () {
  // cloud installationId from Cloud Code,
  // never create session tokens from there.
  if (this.auth.installationId && this.auth.installationId === 'cloud') {
    return;
  }

  const {
    sessionData,
    createSession
  } = Auth.createSession(this.config, {
    userId: this.objectId(),
    createdWith: {
      'action': this.storage['authProvider'] ? 'login' : 'signup',
      'authProvider': this.storage['authProvider'] || 'password'
    },
    installationId: this.auth.installationId
  });

  if (this.response && this.response.response) {
    this.response.response.sessionToken = sessionData.sessionToken;
  }

  return createSession();
};

RestWrite.prototype.destroyDuplicatedSessions = function () {
  // Only for _Session, and at creation time
  if (this.className != '_Session' || this.query) {
    return;
  }
  // Destroy the sessions in 'Background'
  const {
    user,
    installationId,
    sessionToken
  } = this.data;
  if (!user || !installationId) {
    return;
  }
  if (!user.objectId) {
    return;
  }
  this.config.database.destroy('_Session', {
    user,
    installationId,
    sessionToken: { '$ne': sessionToken }
  });
};

// Handles any followup logic
RestWrite.prototype.handleFollowup = function () {
  if (this.storage && this.storage['clearSessions'] && this.config.revokeSessionOnPasswordReset) {
    var sessionQuery = {
      user: {
        __type: 'Pointer',
        className: '_User',
        objectId: this.objectId()
      }
    };
    delete this.storage['clearSessions'];
    return this.config.database.destroy('_Session', sessionQuery).then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['generateNewSession']) {
    delete this.storage['generateNewSession'];
    return this.createSessionToken().then(this.handleFollowup.bind(this));
  }

  if (this.storage && this.storage['sendVerificationEmail']) {
    delete this.storage['sendVerificationEmail'];
    // Fire and forget!
    this.config.userController.sendVerificationEmail(this.data);
    return this.handleFollowup.bind(this);
  }
};

// Handles the _Session class specialness.
// Does nothing if this isn't an _Session object.
RestWrite.prototype.handleSession = function () {
  if (this.response || this.className !== '_Session') {
    return;
  }

  if (!this.auth.user && !this.auth.isMaster) {
    throw new Parse.Error(Parse.Error.INVALID_SESSION_TOKEN, 'Session token required.');
  }

  // TODO: Verify proper error to throw
  if (this.data.ACL) {
    throw new Parse.Error(Parse.Error.INVALID_KEY_NAME, 'Cannot set ' + 'ACL on a Session.');
  }

  if (this.query) {
    if (this.data.user && !this.auth.isMaster && this.data.user.objectId != this.auth.user.id) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.installationId) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    } else if (this.data.sessionToken) {
      throw new Parse.Error(Parse.Error.INVALID_KEY_NAME);
    }
  }

  if (!this.query && !this.auth.isMaster) {
    const additionalSessionData = {};
    for (var key in this.data) {
      if (key === 'objectId' || key === 'user') {
        continue;
      }
      additionalSessionData[key] = this.data[key];
    }

    const { sessionData, createSession } = Auth.createSession(this.config, {
      userId: this.auth.user.id,
      createdWith: {
        action: 'create'
      },
      additionalSessionData
    });

    return createSession().then(results => {
      if (!results.response) {
        throw new Parse.Error(Parse.Error.INTERNAL_SERVER_ERROR, 'Error creating session.');
      }
      sessionData['objectId'] = results.response['objectId'];
      this.response = {
        status: 201,
        location: results.location,
        response: sessionData
      };
    });
  }
};

// Handles the _Installation class specialness.
// Does nothing if this isn't an installation object.
// If an installation is found, this can mutate this.query and turn a create
// into an update.
// Returns a promise for when we're done if it can't finish this tick.
RestWrite.prototype.handleInstallation = function () {
  if (this.response || this.className !== '_Installation') {
    return;
  }

  if (!this.query && !this.data.deviceToken && !this.data.installationId && !this.auth.installationId) {
    throw new Parse.Error(135, 'at least one ID field (deviceToken, installationId) ' + 'must be specified in this operation');
  }

  // If the device token is 64 characters long, we assume it is for iOS
  // and lowercase it.
  if (this.data.deviceToken && this.data.deviceToken.length == 64) {
    this.data.deviceToken = this.data.deviceToken.toLowerCase();
  }

  // We lowercase the installationId if present
  if (this.data.installationId) {
    this.data.installationId = this.data.installationId.toLowerCase();
  }

  let installationId = this.data.installationId;

  // If data.installationId is not set and we're not master, we can lookup in auth
  if (!installationId && !this.auth.isMaster) {
    installationId = this.auth.installationId;
  }

  if (installationId) {
    installationId = installationId.toLowerCase();
  }

  // Updating _Installation but not updating anything critical
  if (this.query && !this.data.deviceToken && !installationId && !this.data.deviceType) {
    return;
  }

  var promise = Promise.resolve();

  var idMatch; // Will be a match on either objectId or installationId
  var objectIdMatch;
  var installationIdMatch;
  var deviceTokenMatches = [];

  // Instead of issuing 3 reads, let's do it with one OR.
  const orQueries = [];
  if (this.query && this.query.objectId) {
    orQueries.push({
      objectId: this.query.objectId
    });
  }
  if (installationId) {
    orQueries.push({
      'installationId': installationId
    });
  }
  if (this.data.deviceToken) {
    orQueries.push({ 'deviceToken': this.data.deviceToken });
  }

  if (orQueries.length == 0) {
    return;
  }

  promise = promise.then(() => {
    return this.config.database.find('_Installation', {
      '$or': orQueries
    }, {});
  }).then(results => {
    results.forEach(result => {
      if (this.query && this.query.objectId && result.objectId == this.query.objectId) {
        objectIdMatch = result;
      }
      if (result.installationId == installationId) {
        installationIdMatch = result;
      }
      if (result.deviceToken == this.data.deviceToken) {
        deviceTokenMatches.push(result);
      }
    });

    // Sanity checks when running a query
    if (this.query && this.query.objectId) {
      if (!objectIdMatch) {
        throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'Object not found for update.');
      }
      if (this.data.installationId && objectIdMatch.installationId && this.data.installationId !== objectIdMatch.installationId) {
        throw new Parse.Error(136, 'installationId may not be changed in this ' + 'operation');
      }
      if (this.data.deviceToken && objectIdMatch.deviceToken && this.data.deviceToken !== objectIdMatch.deviceToken && !this.data.installationId && !objectIdMatch.installationId) {
        throw new Parse.Error(136, 'deviceToken may not be changed in this ' + 'operation');
      }
      if (this.data.deviceType && this.data.deviceType && this.data.deviceType !== objectIdMatch.deviceType) {
        throw new Parse.Error(136, 'deviceType may not be changed in this ' + 'operation');
      }
    }

    if (this.query && this.query.objectId && objectIdMatch) {
      idMatch = objectIdMatch;
    }

    if (installationId && installationIdMatch) {
      idMatch = installationIdMatch;
    }
    // need to specify deviceType only if it's new
    if (!this.query && !this.data.deviceType && !idMatch) {
      throw new Parse.Error(135, 'deviceType must be specified in this operation');
    }
  }).then(() => {
    if (!idMatch) {
      if (!deviceTokenMatches.length) {
        return;
      } else if (deviceTokenMatches.length == 1 && (!deviceTokenMatches[0]['installationId'] || !installationId)) {
        // Single match on device token but none on installationId, and either
        // the passed object or the match is missing an installationId, so we
        // can just return the match.
        return deviceTokenMatches[0]['objectId'];
      } else if (!this.data.installationId) {
        throw new Parse.Error(132, 'Must specify installationId when deviceToken ' + 'matches multiple Installation objects');
      } else {
        // Multiple device token matches and we specified an installation ID,
        // or a single match where both the passed and matching objects have
        // an installation ID. Try cleaning out old installations that match
        // the deviceToken, and return nil to signal that a new object should
        // be created.
        var delQuery = {
          'deviceToken': this.data.deviceToken,
          'installationId': {
            '$ne': installationId
          }
        };
        if (this.data.appIdentifier) {
          delQuery['appIdentifier'] = this.data.appIdentifier;
        }
        this.config.database.destroy('_Installation', delQuery).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored.
            return;
          }
          // rethrow the error
          throw err;
        });
        return;
      }
    } else {
      if (deviceTokenMatches.length == 1 && !deviceTokenMatches[0]['installationId']) {
        // Exactly one device token match and it doesn't have an installation
        // ID. This is the one case where we want to merge with the existing
        // object.
        const delQuery = { objectId: idMatch.objectId };
        return this.config.database.destroy('_Installation', delQuery).then(() => {
          return deviceTokenMatches[0]['objectId'];
        }).catch(err => {
          if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
            // no deletions were made. Can be ignored
            return;
          }
          // rethrow the error
          throw err;
        });
      } else {
        if (this.data.deviceToken && idMatch.deviceToken != this.data.deviceToken) {
          // We're setting the device token on an existing installation, so
          // we should try cleaning out old installations that match this
          // device token.
          const delQuery = {
            'deviceToken': this.data.deviceToken
          };
          // We have a unique install Id, use that to preserve
          // the interesting installation
          if (this.data.installationId) {
            delQuery['installationId'] = {
              '$ne': this.data.installationId
            };
          } else if (idMatch.objectId && this.data.objectId && idMatch.objectId == this.data.objectId) {
            // we passed an objectId, preserve that instalation
            delQuery['objectId'] = {
              '$ne': idMatch.objectId
            };
          } else {
            // What to do here? can't really clean up everything...
            return idMatch.objectId;
          }
          if (this.data.appIdentifier) {
            delQuery['appIdentifier'] = this.data.appIdentifier;
          }
          this.config.database.destroy('_Installation', delQuery).catch(err => {
            if (err.code == Parse.Error.OBJECT_NOT_FOUND) {
              // no deletions were made. Can be ignored.
              return;
            }
            // rethrow the error
            throw err;
          });
        }
        // In non-merge scenarios, just return the installation match id
        return idMatch.objectId;
      }
    }
  }).then(objId => {
    if (objId) {
      this.query = { objectId: objId };
      delete this.data.objectId;
      delete this.data.createdAt;
    }
    // TODO: Validate ops (add/remove on channels, $inc on badge, etc.)
  });
  return promise;
};

// If we short-circuted the object response - then we need to make sure we expand all the files,
// since this might not have a query, meaning it won't return the full result back.
// TODO: (nlutsenko) This should die when we move to per-class based controllers on _Session/_User
RestWrite.prototype.expandFilesForExistingObjects = function () {
  // Check whether we have a short-circuited response - only then run expansion.
  if (this.response && this.response.response) {
    this.config.filesController.expandFilesInObject(this.config, this.response.response);
  }
};

RestWrite.prototype.runDatabaseOperation = function () {
  if (this.response) {
    return;
  }

  if (this.className === '_Role') {
    this.config.cacheController.role.clear();
  }

  if (this.className === '_User' && this.query && this.auth.isUnauthenticated()) {
    throw new Parse.Error(Parse.Error.SESSION_MISSING, `Cannot modify user ${this.query.objectId}.`);
  }

  if (this.className === '_Product' && this.data.download) {
    this.data.downloadName = this.data.download.name;
  }

  // TODO: Add better detection for ACL, ensuring a user can't be locked from
  //       their own user record.
  if (this.data.ACL && this.data.ACL['*unresolved']) {
    throw new Parse.Error(Parse.Error.INVALID_ACL, 'Invalid ACL.');
  }

  if (this.query) {
    // Force the user to not lockout
    // Matched with parse.com
    if (this.className === '_User' && this.data.ACL && this.auth.isMaster !== true) {
      this.data.ACL[this.query.objectId] = { read: true, write: true };
    }
    // update password timestamp if user password is being changed
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
      this.data._password_changed_at = Parse._encode(new Date());
    }
    // Ignore createdAt when update
    delete this.data.createdAt;

    let defer = Promise.resolve();
    // if password history is enabled then save the current password to history
    if (this.className === '_User' && this.data._hashed_password && this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordHistory) {
      defer = this.config.database.find('_User', { objectId: this.objectId() }, { keys: ["_password_history", "_hashed_password"] }).then(results => {
        if (results.length != 1) {
          throw undefined;
        }
        const user = results[0];
        let oldPasswords = [];
        if (user._password_history) {
          oldPasswords = _lodash2.default.take(user._password_history, this.config.passwordPolicy.maxPasswordHistory);
        }
        //n-1 passwords go into history including last password
        while (oldPasswords.length > this.config.passwordPolicy.maxPasswordHistory - 2) {
          oldPasswords.shift();
        }
        oldPasswords.push(user.password);
        this.data._password_history = oldPasswords;
      });
    }

    return defer.then(() => {
      // Run an update
      return this.config.database.update(this.className, this.query, this.data, this.runOptions).then(response => {
        response.updatedAt = this.updatedAt;
        this._updateResponseWithData(response, this.data);
        this.response = { response };
      });
    });
  } else {
    // Set the default ACL and password timestamp for the new _User
    if (this.className === '_User') {
      var ACL = this.data.ACL;
      // default public r/w ACL
      if (!ACL) {
        ACL = {};
        ACL['*'] = { read: true, write: false };
      }
      // make sure the user is not locked down
      ACL[this.data.objectId] = { read: true, write: true };
      this.data.ACL = ACL;
      // password timestamp to be used when password expiry policy is enforced
      if (this.config.passwordPolicy && this.config.passwordPolicy.maxPasswordAge) {
        this.data._password_changed_at = Parse._encode(new Date());
      }
    }

    // Run a create
    return this.config.database.create(this.className, this.data, this.runOptions).catch(error => {
      if (this.className !== '_User' || error.code !== Parse.Error.DUPLICATE_VALUE) {
        throw error;
      }

      // Quick check, if we were able to infer the duplicated field name
      if (error && error.userInfo && error.userInfo.duplicated_field === 'username') {
        throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
      }

      if (error && error.userInfo && error.userInfo.duplicated_field === 'email') {
        throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
      }

      // If this was a failed user creation due to username or email already taken, we need to
      // check whether it was username or email and return the appropriate error.
      // Fallback to the original method
      // TODO: See if we can later do this without additional queries by using named indexes.
      return this.config.database.find(this.className, { username: this.data.username, objectId: { '$ne': this.objectId() } }, { limit: 1 }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.USERNAME_TAKEN, 'Account already exists for this username.');
        }
        return this.config.database.find(this.className, { email: this.data.email, objectId: { '$ne': this.objectId() } }, { limit: 1 });
      }).then(results => {
        if (results.length > 0) {
          throw new Parse.Error(Parse.Error.EMAIL_TAKEN, 'Account already exists for this email address.');
        }
        throw new Parse.Error(Parse.Error.DUPLICATE_VALUE, 'A duplicate value for a field with unique values was provided');
      });
    }).then(response => {
      response.objectId = this.data.objectId;
      response.createdAt = this.data.createdAt;

      if (this.responseShouldHaveUsername) {
        response.username = this.data.username;
      }
      this._updateResponseWithData(response, this.data);
      this.response = {
        status: 201,
        response,
        location: this.location()
      };
    });
  }
};

// Returns nothing - doesn't wait for the trigger.
RestWrite.prototype.runAfterTrigger = function () {
  if (!this.response || !this.response.response) {
    return;
  }

  // Avoid doing any setup for triggers if there is no 'afterSave' trigger for this class.
  const hasAfterSaveHook = triggers.triggerExists(this.className, triggers.Types.afterSave, this.config.applicationId);
  const hasLiveQuery = this.config.liveQueryController.hasLiveQuery(this.className);
  if (!hasAfterSaveHook && !hasLiveQuery) {
    return Promise.resolve();
  }

  var extraData = { className: this.className };
  if (this.query && this.query.objectId) {
    extraData.objectId = this.query.objectId;
  }

  // Build the original object, we only do this for a update write.
  let originalObject;
  if (this.query && this.query.objectId) {
    originalObject = triggers.inflate(extraData, this.originalData);
  }

  // Build the inflated object, different from beforeSave, originalData is not empty
  // since developers can change data in the beforeSave.
  const updatedObject = this.buildUpdatedObject(extraData);
  updatedObject._handleSaveResponse(this.response.response, this.response.status || 200);

  // Notifiy LiveQueryServer if possible
  this.config.liveQueryController.onAfterSave(updatedObject.className, updatedObject, originalObject);

  // Run afterSave trigger
  return triggers.maybeRunTrigger(triggers.Types.afterSave, this.auth, updatedObject, originalObject, this.config).catch(function (err) {
    _logger2.default.warn('afterSave caught an error', err);
  });
};

// A helper to figure out what location this operation happens at.
RestWrite.prototype.location = function () {
  var middle = this.className === '_User' ? '/users/' : '/classes/' + this.className + '/';
  return this.config.mount + middle + this.data.objectId;
};

// A helper to get the object id for this operation.
// Because it could be either on the query or on the data
RestWrite.prototype.objectId = function () {
  return this.data.objectId || this.query.objectId;
};

// Returns a copy of the data and delete bad keys (_auth_data, _hashed_password...)
RestWrite.prototype.sanitizedData = function () {
  const data = Object.keys(this.data).reduce((data, key) => {
    // Regexp comes from Parse.Object.prototype.validate
    if (!/^[A-Za-z][0-9A-Za-z_]*$/.test(key)) {
      delete data[key];
    }
    return data;
  }, deepcopy(this.data));
  return Parse._decode(undefined, data);
};

// Returns an updated copy of the object
RestWrite.prototype.buildUpdatedObject = function (extraData) {
  const updatedObject = triggers.inflate(extraData, this.originalData);
  Object.keys(this.data).reduce(function (data, key) {
    if (key.indexOf(".") > 0) {
      // subdocument key with dot notation ('x.y':v => 'x':{'y':v})
      const splittedKey = key.split(".");
      const parentProp = splittedKey[0];
      let parentVal = updatedObject.get(parentProp);
      if (typeof parentVal !== 'object') {
        parentVal = {};
      }
      parentVal[splittedKey[1]] = data[key];
      updatedObject.set(parentProp, parentVal);
      delete data[key];
    }
    return data;
  }, deepcopy(this.data));

  updatedObject.set(this.sanitizedData());
  return updatedObject;
};

RestWrite.prototype.cleanUserAuthData = function () {
  if (this.response && this.response.response && this.className === '_User') {
    const user = this.response.response;
    if (user.authData) {
      Object.keys(user.authData).forEach(provider => {
        if (user.authData[provider] === null) {
          delete user.authData[provider];
        }
      });
      if (Object.keys(user.authData).length == 0) {
        delete user.authData;
      }
    }
  }
};

RestWrite.prototype._updateResponseWithData = function (response, data) {
  if (_lodash2.default.isEmpty(this.storage.fieldsChangedByTrigger)) {
    return response;
  }
  const clientSupportsDelete = ClientSDK.supportsForwardDelete(this.clientSDK);
  this.storage.fieldsChangedByTrigger.forEach(fieldName => {
    const dataValue = data[fieldName];

    if (!response.hasOwnProperty(fieldName)) {
      response[fieldName] = dataValue;
    }

    // Strips operations from responses
    if (response[fieldName] && response[fieldName].__op) {
      delete response[fieldName];
      if (clientSupportsDelete && dataValue.__op == 'Delete') {
        response[fieldName] = dataValue;
      }
    }
  });
  return response;
};

exports.default = RestWrite;

module.exports = RestWrite;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9SZXN0V3JpdGUuanMiXSwibmFtZXMiOlsiU2NoZW1hQ29udHJvbGxlciIsInJlcXVpcmUiLCJkZWVwY29weSIsIkF1dGgiLCJjcnlwdG9VdGlscyIsInBhc3N3b3JkQ3J5cHRvIiwiUGFyc2UiLCJ0cmlnZ2VycyIsIkNsaWVudFNESyIsIlJlc3RXcml0ZSIsImNvbmZpZyIsImF1dGgiLCJjbGFzc05hbWUiLCJxdWVyeSIsImRhdGEiLCJvcmlnaW5hbERhdGEiLCJjbGllbnRTREsiLCJpc1JlYWRPbmx5IiwiRXJyb3IiLCJPUEVSQVRJT05fRk9SQklEREVOIiwic3RvcmFnZSIsInJ1bk9wdGlvbnMiLCJvYmplY3RJZCIsIklOVkFMSURfS0VZX05BTUUiLCJyZXNwb25zZSIsInVwZGF0ZWRBdCIsIl9lbmNvZGUiLCJEYXRlIiwiaXNvIiwicHJvdG90eXBlIiwiZXhlY3V0ZSIsIlByb21pc2UiLCJyZXNvbHZlIiwidGhlbiIsImdldFVzZXJBbmRSb2xlQUNMIiwidmFsaWRhdGVDbGllbnRDbGFzc0NyZWF0aW9uIiwiaGFuZGxlSW5zdGFsbGF0aW9uIiwiaGFuZGxlU2Vzc2lvbiIsInZhbGlkYXRlQXV0aERhdGEiLCJydW5CZWZvcmVUcmlnZ2VyIiwidmFsaWRhdGVTY2hlbWEiLCJzZXRSZXF1aXJlZEZpZWxkc0lmTmVlZGVkIiwidHJhbnNmb3JtVXNlciIsImV4cGFuZEZpbGVzRm9yRXhpc3RpbmdPYmplY3RzIiwiZGVzdHJveUR1cGxpY2F0ZWRTZXNzaW9ucyIsInJ1bkRhdGFiYXNlT3BlcmF0aW9uIiwiY3JlYXRlU2Vzc2lvblRva2VuSWZOZWVkZWQiLCJoYW5kbGVGb2xsb3d1cCIsInJ1bkFmdGVyVHJpZ2dlciIsImNsZWFuVXNlckF1dGhEYXRhIiwiaXNNYXN0ZXIiLCJhY2wiLCJ1c2VyIiwiZ2V0VXNlclJvbGVzIiwicm9sZXMiLCJjb25jYXQiLCJpZCIsImFsbG93Q2xpZW50Q2xhc3NDcmVhdGlvbiIsInN5c3RlbUNsYXNzZXMiLCJpbmRleE9mIiwiZGF0YWJhc2UiLCJsb2FkU2NoZW1hIiwic2NoZW1hQ29udHJvbGxlciIsImhhc0NsYXNzIiwidmFsaWRhdGVPYmplY3QiLCJ0cmlnZ2VyRXhpc3RzIiwiVHlwZXMiLCJiZWZvcmVTYXZlIiwiYXBwbGljYXRpb25JZCIsImV4dHJhRGF0YSIsIm9yaWdpbmFsT2JqZWN0IiwidXBkYXRlZE9iamVjdCIsImJ1aWxkVXBkYXRlZE9iamVjdCIsImluZmxhdGUiLCJtYXliZVJ1blRyaWdnZXIiLCJvYmplY3QiLCJmaWVsZHNDaGFuZ2VkQnlUcmlnZ2VyIiwicmVkdWNlIiwicmVzdWx0IiwidmFsdWUiLCJrZXkiLCJpc0VxdWFsIiwicHVzaCIsImNyZWF0ZWRBdCIsIm5ld09iamVjdElkIiwib2JqZWN0SWRTaXplIiwiYXV0aERhdGEiLCJ1c2VybmFtZSIsImlzRW1wdHkiLCJVU0VSTkFNRV9NSVNTSU5HIiwicGFzc3dvcmQiLCJQQVNTV09SRF9NSVNTSU5HIiwiT2JqZWN0Iiwia2V5cyIsImxlbmd0aCIsInByb3ZpZGVycyIsImNhbkhhbmRsZUF1dGhEYXRhIiwiY2FuSGFuZGxlIiwicHJvdmlkZXIiLCJwcm92aWRlckF1dGhEYXRhIiwiaGFzVG9rZW4iLCJoYW5kbGVBdXRoRGF0YSIsIlVOU1VQUE9SVEVEX1NFUlZJQ0UiLCJoYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24iLCJ2YWxpZGF0aW9ucyIsIm1hcCIsImF1dGhEYXRhTWFuYWdlciIsImdldFZhbGlkYXRvckZvclByb3ZpZGVyIiwiYWxsIiwiZmluZFVzZXJzV2l0aEF1dGhEYXRhIiwibWVtbyIsInF1ZXJ5S2V5IiwiZmlsdGVyIiwicSIsImZpbmRQcm9taXNlIiwiZmluZCIsImZpbHRlcmVkT2JqZWN0c0J5QUNMIiwib2JqZWN0cyIsIkFDTCIsInJlc3VsdHMiLCJyIiwiQUNDT1VOVF9BTFJFQURZX0xJTktFRCIsImpvaW4iLCJ1c2VyUmVzdWx0IiwibXV0YXRlZEF1dGhEYXRhIiwiZm9yRWFjaCIsInByb3ZpZGVyRGF0YSIsInVzZXJBdXRoRGF0YSIsImhhc011dGF0ZWRBdXRoRGF0YSIsInVzZXJJZCIsImxvY2F0aW9uIiwidXBkYXRlIiwicHJvbWlzZSIsImVycm9yIiwibWFzdGVyIiwiX190eXBlIiwic2Vzc2lvbiIsImNhY2hlQ29udHJvbGxlciIsImRlbCIsInNlc3Npb25Ub2tlbiIsInVuZGVmaW5lZCIsIl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5IiwiaGFzaCIsImhhc2hlZFBhc3N3b3JkIiwiX2hhc2hlZF9wYXNzd29yZCIsIl92YWxpZGF0ZVVzZXJOYW1lIiwiX3ZhbGlkYXRlRW1haWwiLCJyYW5kb21TdHJpbmciLCJyZXNwb25zZVNob3VsZEhhdmVVc2VybmFtZSIsImxpbWl0IiwiVVNFUk5BTUVfVEFLRU4iLCJlbWFpbCIsIl9fb3AiLCJtYXRjaCIsInJlamVjdCIsIklOVkFMSURfRU1BSUxfQUREUkVTUyIsIkVNQUlMX1RBS0VOIiwidXNlckNvbnRyb2xsZXIiLCJzZXRFbWFpbFZlcmlmeVRva2VuIiwicGFzc3dvcmRQb2xpY3kiLCJfdmFsaWRhdGVQYXNzd29yZFJlcXVpcmVtZW50cyIsIl92YWxpZGF0ZVBhc3N3b3JkSGlzdG9yeSIsInBvbGljeUVycm9yIiwicGF0dGVyblZhbGlkYXRvciIsInZhbGlkYXRvckNhbGxiYWNrIiwiVkFMSURBVElPTl9FUlJPUiIsImRvTm90QWxsb3dVc2VybmFtZSIsIm1heFBhc3N3b3JkSGlzdG9yeSIsIm9sZFBhc3N3b3JkcyIsIl9wYXNzd29yZF9oaXN0b3J5IiwidGFrZSIsIm5ld1Bhc3N3b3JkIiwicHJvbWlzZXMiLCJjb21wYXJlIiwiY2F0Y2giLCJlcnIiLCJwcmV2ZW50TG9naW5XaXRoVW52ZXJpZmllZEVtYWlsIiwidmVyaWZ5VXNlckVtYWlscyIsImNyZWF0ZVNlc3Npb25Ub2tlbiIsImluc3RhbGxhdGlvbklkIiwic2Vzc2lvbkRhdGEiLCJjcmVhdGVTZXNzaW9uIiwiY3JlYXRlZFdpdGgiLCJkZXN0cm95IiwicmV2b2tlU2Vzc2lvbk9uUGFzc3dvcmRSZXNldCIsInNlc3Npb25RdWVyeSIsImJpbmQiLCJzZW5kVmVyaWZpY2F0aW9uRW1haWwiLCJJTlZBTElEX1NFU1NJT05fVE9LRU4iLCJhZGRpdGlvbmFsU2Vzc2lvbkRhdGEiLCJhY3Rpb24iLCJJTlRFUk5BTF9TRVJWRVJfRVJST1IiLCJzdGF0dXMiLCJkZXZpY2VUb2tlbiIsInRvTG93ZXJDYXNlIiwiZGV2aWNlVHlwZSIsImlkTWF0Y2giLCJvYmplY3RJZE1hdGNoIiwiaW5zdGFsbGF0aW9uSWRNYXRjaCIsImRldmljZVRva2VuTWF0Y2hlcyIsIm9yUXVlcmllcyIsIk9CSkVDVF9OT1RfRk9VTkQiLCJkZWxRdWVyeSIsImFwcElkZW50aWZpZXIiLCJjb2RlIiwib2JqSWQiLCJmaWxlc0NvbnRyb2xsZXIiLCJleHBhbmRGaWxlc0luT2JqZWN0Iiwicm9sZSIsImNsZWFyIiwiaXNVbmF1dGhlbnRpY2F0ZWQiLCJTRVNTSU9OX01JU1NJTkciLCJkb3dubG9hZCIsImRvd25sb2FkTmFtZSIsIm5hbWUiLCJJTlZBTElEX0FDTCIsInJlYWQiLCJ3cml0ZSIsIm1heFBhc3N3b3JkQWdlIiwiX3Bhc3N3b3JkX2NoYW5nZWRfYXQiLCJkZWZlciIsInNoaWZ0IiwiX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEiLCJjcmVhdGUiLCJEVVBMSUNBVEVfVkFMVUUiLCJ1c2VySW5mbyIsImR1cGxpY2F0ZWRfZmllbGQiLCJoYXNBZnRlclNhdmVIb29rIiwiYWZ0ZXJTYXZlIiwiaGFzTGl2ZVF1ZXJ5IiwibGl2ZVF1ZXJ5Q29udHJvbGxlciIsIl9oYW5kbGVTYXZlUmVzcG9uc2UiLCJvbkFmdGVyU2F2ZSIsIndhcm4iLCJtaWRkbGUiLCJtb3VudCIsInNhbml0aXplZERhdGEiLCJ0ZXN0IiwiX2RlY29kZSIsInNwbGl0dGVkS2V5Iiwic3BsaXQiLCJwYXJlbnRQcm9wIiwicGFyZW50VmFsIiwiZ2V0Iiwic2V0IiwiY2xpZW50U3VwcG9ydHNEZWxldGUiLCJzdXBwb3J0c0ZvcndhcmREZWxldGUiLCJmaWVsZE5hbWUiLCJkYXRhVmFsdWUiLCJo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QVMrTixTQUFULElBQXNCQyxTQUF0QjtBQUNEOztBQUVEO0FBQ0EsUUFBSWhPLFNBQVMrTixTQUFULEtBQXVCL04sU0FBUytOLFNBQVQsRUFBb0IvRixJQUEvQyxFQUFxRDtBQUNuRCxhQUFPaEksU0FBUytOLFNBQVQsQ0FBUDtBQUNBLFVBQUlGLHdCQUF3QkcsVUFBVWhHLElBQVYsSUFBa0IsUUFBOUMsRUFBd0Q7QUFDdERoSSxpQkFBUytOLFNBQVQsSUFBc0JDLFNBQXRCO0FBQ0Q7QUFDRjtBQUNGLEdBZEQ7QUFlQSxTQUFPaE8sUUFBUDtBQUNELENBckJEOztrQkF1QmVmLFM7O0FBQ2ZpUCxPQUFPQyxPQUFQLEdBQWlCbFAsU0FBakIiLCJmaWxlIjoiUmVzdFdyaXRlLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQSBSZXN0V3JpdGUgZW5jYXBzdWxhdGVzIGV2ZXJ5dGhpbmcgd2UgbmVlZCB0byBydW4gYW4gb3BlcmF0aW9uXG4vLyB0aGF0IHdyaXRlcyB0byB0aGUgZGF0YWJhc2UuXG4vLyBUaGlzIGNvdWxkIGJlIGVpdGhlciBhIFwiY3JlYXRlXCIgb3IgYW4gXCJ1cGRhdGVcIi5cblxudmFyIFNjaGVtYUNvbnRyb2xsZXIgPSByZXF1aXJlKCcuL0NvbnRyb2xsZXJzL1NjaGVtYUNvbnRyb2xsZXInKTtcbnZhciBkZWVwY29weSA9IHJlcXVpcmUoJ2RlZXBjb3B5Jyk7XG5cbmNvbnN0IEF1dGggPSByZXF1aXJlKCcuL0F1dGgnKTtcbnZhciBjcnlwdG9VdGlscyA9IHJlcXVpcmUoJy4vY3J5cHRvVXRpbHMnKTtcbnZhciBwYXNzd29yZENyeXB0byA9IHJlcXVpcmUoJy4vcGFzc3dvcmQnKTtcbnZhciBQYXJzZSA9IHJlcXVpcmUoJ3BhcnNlL25vZGUnKTtcbnZhciB0cmlnZ2VycyA9IHJlcXVpcmUoJy4vdHJpZ2dlcnMnKTtcbnZhciBDbGllbnRTREsgPSByZXF1aXJlKCcuL0NsaWVudFNESycpO1xuaW1wb3J0IFJlc3RRdWVyeSBmcm9tICcuL1Jlc3RRdWVyeSc7XG5pbXBvcnQgXyAgICAgICAgIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgbG9nZ2VyICAgIGZyb20gJy4vbG9nZ2VyJztcblxuLy8gcXVlcnkgYW5kIGRhdGEgYXJlIGJvdGggcHJvdmlkZWQgaW4gUkVTVCBBUEkgZm9ybWF0LiBTbyBkYXRhXG4vLyB0eXBlcyBhcmUgZW5jb2RlZCBieSBwbGFpbiBvbGQgb2JqZWN0cy5cbi8vIElmIHF1ZXJ5IGlzIG51bGwsIHRoaXMgaXMgYSBcImNyZWF0ZVwiIGFuZCB0aGUgZGF0YSBpbiBkYXRhIHNob3VsZCBiZVxuLy8gY3JlYXRlZC5cbi8vIE90aGVyd2lzZSB0aGlzIGlzIGFuIFwidXBkYXRlXCIgLSB0aGUgb2JqZWN0IG1hdGNoaW5nIHRoZSBxdWVyeVxuLy8gc2hvdWxkIGdldCB1cGRhdGVkIHdpdGggZGF0YS5cbi8vIFJlc3RXcml0ZSB3aWxsIGhhbmRsZSBvYmplY3RJZCwgY3JlYXRlZEF0LCBhbmQgdXBkYXRlZEF0IGZvclxuLy8gZXZlcnl0aGluZy4gSXQgYWxzbyBrbm93cyB0byB1c2UgdHJpZ2dlcnMgYW5kIHNwZWNpYWwgbW9kaWZpY2F0aW9uc1xuLy8gZm9yIHRoZSBfVXNlciBjbGFzcy5cbmZ1bmN0aW9uIFJlc3RXcml0ZShjb25maWcsIGF1dGgsIGNsYXNzTmFtZSwgcXVlcnksIGRhdGEsIG9yaWdpbmFsRGF0YSwgY2xpZW50U0RLKSB7XG4gIGlmIChhdXRoLmlzUmVhZE9ubHkpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTiwgJ0Nhbm5vdCBwZXJmb3JtIGEgd3JpdGUgb3BlcmF0aW9uIHdoZW4gdXNpbmcgcmVhZE9ubHlNYXN0ZXJLZXknKTtcbiAgfVxuICB0aGlzLmNvbmZpZyA9IGNvbmZpZztcbiAgdGhpcy5hdXRoID0gYXV0aDtcbiAgdGhpcy5jbGFzc05hbWUgPSBjbGFzc05hbWU7XG4gIHRoaXMuY2xpZW50U0RLID0gY2xpZW50U0RLO1xuICB0aGlzLnN0b3JhZ2UgPSB7fTtcbiAgdGhpcy5ydW5PcHRpb25zID0ge307XG4gIGlmICghcXVlcnkgJiYgZGF0YS5vYmplY3RJZCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCAnb2JqZWN0SWQgaXMgYW4gaW52YWxpZCBmaWVsZCBuYW1lLicpO1xuICB9XG5cbiAgLy8gV2hlbiB0aGUgb3BlcmF0aW9uIGlzIGNvbXBsZXRlLCB0aGlzLnJlc3BvbnNlIG1heSBoYXZlIHNldmVyYWxcbiAgLy8gZmllbGRzLlxuICAvLyByZXNwb25zZTogdGhlIGFjdHVhbCBkYXRhIHRvIGJlIHJldHVybmVkXG4gIC8vIHN0YXR1czogdGhlIGh0dHAgc3RhdHVzIGNvZGUuIGlmIG5vdCBwcmVzZW50LCB0cmVhdGVkIGxpa2UgYSAyMDBcbiAgLy8gbG9jYXRpb246IHRoZSBsb2NhdGlvbiBoZWFkZXIuIGlmIG5vdCBwcmVzZW50LCBubyBsb2NhdGlvbiBoZWFkZXJcbiAgdGhpcy5yZXNwb25zZSA9IG51bGw7XG5cbiAgLy8gUHJvY2Vzc2luZyB0aGlzIG9wZXJhdGlvbiBtYXkgbXV0YXRlIG91ciBkYXRhLCBzbyB3ZSBvcGVyYXRlIG9uIGFcbiAgLy8gY29weVxuICB0aGlzLnF1ZXJ5ID0gZGVlcGNvcHkocXVlcnkpO1xuICB0aGlzLmRhdGEgPSBkZWVwY29weShkYXRhKTtcbiAgLy8gV2UgbmV2ZXIgY2hhbmdlIG9yaWdpbmFsRGF0YSwgc28gd2UgZG8gbm90IG5lZWQgYSBkZWVwIGNvcHlcbiAgdGhpcy5vcmlnaW5hbERhdGEgPSBvcmlnaW5hbERhdGE7XG5cbiAgLy8gVGhlIHRpbWVzdGFtcCB3ZSdsbCB1c2UgZm9yIHRoaXMgd2hvbGUgb3BlcmF0aW9uXG4gIHRoaXMudXBkYXRlZEF0ID0gUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKS5pc287XG59XG5cbi8vIEEgY29udmVuaWVudCBtZXRob2QgdG8gcGVyZm9ybSBhbGwgdGhlIHN0ZXBzIG9mIHByb2Nlc3NpbmcgdGhlXG4vLyB3cml0ZSwgaW4gb3JkZXIuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3IgYSB7cmVzcG9uc2UsIHN0YXR1cywgbG9jYXRpb259IG9iamVjdC5cbi8vIHN0YXR1cyBhbmQgbG9jYXRpb24gYXJlIG9wdGlvbmFsLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5leGVjdXRlID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5nZXRVc2VyQW5kUm9sZUFDTCgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy52YWxpZGF0ZUNsaWVudENsYXNzQ3JlYXRpb24oKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuaGFuZGxlSW5zdGFsbGF0aW9uKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZVNlc3Npb24oKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMudmFsaWRhdGVBdXRoRGF0YSgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5ydW5CZWZvcmVUcmlnZ2VyKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnZhbGlkYXRlU2NoZW1hKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnNldFJlcXVpcmVkRmllbGRzSWZOZWVkZWQoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMudHJhbnNmb3JtVXNlcigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5leHBhbmRGaWxlc0ZvckV4aXN0aW5nT2JqZWN0cygpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5kZXN0cm95RHVwbGljYXRlZFNlc3Npb25zKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJ1bkRhdGFiYXNlT3BlcmF0aW9uKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbklmTmVlZGVkKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLmhhbmRsZUZvbGxvd3VwKCk7XG4gIH0pLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLnJ1bkFmdGVyVHJpZ2dlcigpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5jbGVhblVzZXJBdXRoRGF0YSgpO1xuICB9KS50aGVuKCgpID0+IHtcbiAgICByZXR1cm4gdGhpcy5yZXNwb25zZTtcbiAgfSlcbn07XG5cbi8vIFVzZXMgdGhlIEF1dGggb2JqZWN0IHRvIGdldCB0aGUgbGlzdCBvZiByb2xlcywgYWRkcyB0aGUgdXNlciBpZFxuUmVzdFdyaXRlLnByb3RvdHlwZS5nZXRVc2VyQW5kUm9sZUFDTCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG5cbiAgdGhpcy5ydW5PcHRpb25zLmFjbCA9IFsnKiddO1xuXG4gIGlmICh0aGlzLmF1dGgudXNlcikge1xuICAgIHJldHVybiB0aGlzLmF1dGguZ2V0VXNlclJvbGVzKCkudGhlbigocm9sZXMpID0+IHtcbiAgICAgIHRoaXMucnVuT3B0aW9ucy5hY2wgPSB0aGlzLnJ1bk9wdGlvbnMuYWNsLmNvbmNhdChyb2xlcywgW3RoaXMuYXV0aC51c2VyLmlkXSk7XG4gICAgICByZXR1cm47XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG59O1xuXG4vLyBWYWxpZGF0ZXMgdGhpcyBvcGVyYXRpb24gYWdhaW5zdCB0aGUgYWxsb3dDbGllbnRDbGFzc0NyZWF0aW9uIGNvbmZpZy5cblJlc3RXcml0ZS5wcm90b3R5cGUudmFsaWRhdGVDbGllbnRDbGFzc0NyZWF0aW9uID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLmNvbmZpZy5hbGxvd0NsaWVudENsYXNzQ3JlYXRpb24gPT09IGZhbHNlICYmICF0aGlzLmF1dGguaXNNYXN0ZXJcbiAgICAgICYmIFNjaGVtYUNvbnRyb2xsZXIuc3lzdGVtQ2xhc3Nlcy5pbmRleE9mKHRoaXMuY2xhc3NOYW1lKSA9PT0gLTEpIHtcbiAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UubG9hZFNjaGVtYSgpXG4gICAgICAudGhlbihzY2hlbWFDb250cm9sbGVyID0+IHNjaGVtYUNvbnRyb2xsZXIuaGFzQ2xhc3ModGhpcy5jbGFzc05hbWUpKVxuICAgICAgLnRoZW4oaGFzQ2xhc3MgPT4ge1xuICAgICAgICBpZiAoaGFzQ2xhc3MgIT09IHRydWUpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT1BFUkFUSU9OX0ZPUkJJRERFTixcbiAgICAgICAgICAgICdUaGlzIHVzZXIgaXMgbm90IGFsbG93ZWQgdG8gYWNjZXNzICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbm9uLWV4aXN0ZW50IGNsYXNzOiAnICsgdGhpcy5jbGFzc05hbWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbn07XG5cbi8vIFZhbGlkYXRlcyB0aGlzIG9wZXJhdGlvbiBhZ2FpbnN0IHRoZSBzY2hlbWEuXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlU2NoZW1hID0gZnVuY3Rpb24oKSB7XG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS52YWxpZGF0ZU9iamVjdCh0aGlzLmNsYXNzTmFtZSwgdGhpcy5kYXRhLCB0aGlzLnF1ZXJ5LCB0aGlzLnJ1bk9wdGlvbnMpO1xufTtcblxuLy8gUnVucyBhbnkgYmVmb3JlU2F2ZSB0cmlnZ2VycyBhZ2FpbnN0IHRoaXMgb3BlcmF0aW9uLlxuLy8gQW55IGNoYW5nZSBsZWFkcyB0byBvdXIgZGF0YSBiZWluZyBtdXRhdGVkLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5ydW5CZWZvcmVUcmlnZ2VyID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYmVmb3JlU2F2ZScgdHJpZ2dlciBmb3IgdGhpcyBjbGFzcy5cbiAgaWYgKCF0cmlnZ2Vycy50cmlnZ2VyRXhpc3RzKHRoaXMuY2xhc3NOYW1lLCB0cmlnZ2Vycy5UeXBlcy5iZWZvcmVTYXZlLCB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkKSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIC8vIENsb3VkIGNvZGUgZ2V0cyBhIGJpdCBvZiBleHRyYSBkYXRhIGZvciBpdHMgb2JqZWN0c1xuICB2YXIgZXh0cmFEYXRhID0ge2NsYXNzTmFtZTogdGhpcy5jbGFzc05hbWV9O1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgZXh0cmFEYXRhLm9iamVjdElkID0gdGhpcy5xdWVyeS5vYmplY3RJZDtcbiAgfVxuXG4gIGxldCBvcmlnaW5hbE9iamVjdCA9IG51bGw7XG4gIGNvbnN0IHVwZGF0ZWRPYmplY3QgPSB0aGlzLmJ1aWxkVXBkYXRlZE9iamVjdChleHRyYURhdGEpO1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgLy8gVGhpcyBpcyBhbiB1cGRhdGUgZm9yIGV4aXN0aW5nIG9iamVjdC5cbiAgICBvcmlnaW5hbE9iamVjdCA9IHRyaWdnZXJzLmluZmxhdGUoZXh0cmFEYXRhLCB0aGlzLm9yaWdpbmFsRGF0YSk7XG4gIH1cblxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRyaWdnZXJzLm1heWJlUnVuVHJpZ2dlcih0cmlnZ2Vycy5UeXBlcy5iZWZvcmVTYXZlLCB0aGlzLmF1dGgsIHVwZGF0ZWRPYmplY3QsIG9yaWdpbmFsT2JqZWN0LCB0aGlzLmNvbmZpZyk7XG4gIH0pLnRoZW4oKHJlc3BvbnNlKSA9PiB7XG4gICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLm9iamVjdCkge1xuICAgICAgdGhpcy5zdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIgPSBfLnJlZHVjZShyZXNwb25zZS5vYmplY3QsIChyZXN1bHQsIHZhbHVlLCBrZXkpID0+IHtcbiAgICAgICAgaWYgKCFfLmlzRXF1YWwodGhpcy5kYXRhW2tleV0sIHZhbHVlKSkge1xuICAgICAgICAgIHJlc3VsdC5wdXNoKGtleSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgIH0sIFtdKTtcbiAgICAgIHRoaXMuZGF0YSA9IHJlc3BvbnNlLm9iamVjdDtcbiAgICAgIC8vIFdlIHNob3VsZCBkZWxldGUgdGhlIG9iamVjdElkIGZvciBhbiB1cGRhdGUgd3JpdGVcbiAgICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgZGVsZXRlIHRoaXMuZGF0YS5vYmplY3RJZFxuICAgICAgfVxuICAgIH1cbiAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLnNldFJlcXVpcmVkRmllbGRzSWZOZWVkZWQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuZGF0YSkge1xuICAgIC8vIEFkZCBkZWZhdWx0IGZpZWxkc1xuICAgIHRoaXMuZGF0YS51cGRhdGVkQXQgPSB0aGlzLnVwZGF0ZWRBdDtcbiAgICBpZiAoIXRoaXMucXVlcnkpIHtcbiAgICAgIHRoaXMuZGF0YS5jcmVhdGVkQXQgPSB0aGlzLnVwZGF0ZWRBdDtcblxuICAgICAgLy8gT25seSBhc3NpZ24gbmV3IG9iamVjdElkIGlmIHdlIGFyZSBjcmVhdGluZyBuZXcgb2JqZWN0XG4gICAgICBpZiAoIXRoaXMuZGF0YS5vYmplY3RJZCkge1xuICAgICAgICB0aGlzLmRhdGEub2JqZWN0SWQgPSBjcnlwdG9VdGlscy5uZXdPYmplY3RJZCh0aGlzLmNvbmZpZy5vYmplY3RJZFNpemUpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG59O1xuXG4vLyBUcmFuc2Zvcm1zIGF1dGggZGF0YSBmb3IgYSB1c2VyIG9iamVjdC5cbi8vIERvZXMgbm90aGluZyBpZiB0aGlzIGlzbid0IGEgdXNlciBvYmplY3QuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3Igd2hlbiB3ZSdyZSBkb25lIGlmIGl0IGNhbid0IGZpbmlzaCB0aGlzIHRpY2suXG5SZXN0V3JpdGUucHJvdG90eXBlLnZhbGlkYXRlQXV0aERhdGEgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuY2xhc3NOYW1lICE9PSAnX1VzZXInKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCF0aGlzLnF1ZXJ5ICYmICF0aGlzLmRhdGEuYXV0aERhdGEpIHtcbiAgICBpZiAodHlwZW9mIHRoaXMuZGF0YS51c2VybmFtZSAhPT0gJ3N0cmluZycgfHwgXy5pc0VtcHR5KHRoaXMuZGF0YS51c2VybmFtZSkpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5VU0VSTkFNRV9NSVNTSU5HLFxuICAgICAgICAnYmFkIG9yIG1pc3NpbmcgdXNlcm5hbWUnKTtcbiAgICB9XG4gICAgaWYgKHR5cGVvZiB0aGlzLmRhdGEucGFzc3dvcmQgIT09ICdzdHJpbmcnIHx8IF8uaXNFbXB0eSh0aGlzLmRhdGEucGFzc3dvcmQpKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuUEFTU1dPUkRfTUlTU0lORyxcbiAgICAgICAgJ3Bhc3N3b3JkIGlzIHJlcXVpcmVkJyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKCF0aGlzLmRhdGEuYXV0aERhdGEgfHwgIU9iamVjdC5rZXlzKHRoaXMuZGF0YS5hdXRoRGF0YSkubGVuZ3RoKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIGF1dGhEYXRhID0gdGhpcy5kYXRhLmF1dGhEYXRhO1xuICB2YXIgcHJvdmlkZXJzID0gT2JqZWN0LmtleXMoYXV0aERhdGEpO1xuICBpZiAocHJvdmlkZXJzLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCBjYW5IYW5kbGVBdXRoRGF0YSA9IHByb3ZpZGVycy5yZWR1Y2UoKGNhbkhhbmRsZSwgcHJvdmlkZXIpID0+IHtcbiAgICAgIHZhciBwcm92aWRlckF1dGhEYXRhID0gYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgdmFyIGhhc1Rva2VuID0gKHByb3ZpZGVyQXV0aERhdGEgJiYgcHJvdmlkZXJBdXRoRGF0YS5pZCk7XG4gICAgICByZXR1cm4gY2FuSGFuZGxlICYmIChoYXNUb2tlbiB8fCBwcm92aWRlckF1dGhEYXRhID09IG51bGwpO1xuICAgIH0sIHRydWUpO1xuICAgIGlmIChjYW5IYW5kbGVBdXRoRGF0YSkge1xuICAgICAgcmV0dXJuIHRoaXMuaGFuZGxlQXV0aERhdGEoYXV0aERhdGEpO1xuICAgIH1cbiAgfVxuICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVU5TVVBQT1JURURfU0VSVklDRSxcbiAgICAnVGhpcyBhdXRoZW50aWNhdGlvbiBtZXRob2QgaXMgdW5zdXBwb3J0ZWQuJyk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbiA9IGZ1bmN0aW9uKGF1dGhEYXRhKSB7XG4gIGNvbnN0IHZhbGlkYXRpb25zID0gT2JqZWN0LmtleXMoYXV0aERhdGEpLm1hcCgocHJvdmlkZXIpID0+IHtcbiAgICBpZiAoYXV0aERhdGFbcHJvdmlkZXJdID09PSBudWxsKSB7XG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgfVxuICAgIGNvbnN0IHZhbGlkYXRlQXV0aERhdGEgPSB0aGlzLmNvbmZpZy5hdXRoRGF0YU1hbmFnZXIuZ2V0VmFsaWRhdG9yRm9yUHJvdmlkZXIocHJvdmlkZXIpO1xuICAgIGlmICghdmFsaWRhdGVBdXRoRGF0YSkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVOU1VQUE9SVEVEX1NFUlZJQ0UsXG4gICAgICAgICdUaGlzIGF1dGhlbnRpY2F0aW9uIG1ldGhvZCBpcyB1bnN1cHBvcnRlZC4nKTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbGlkYXRlQXV0aERhdGEoYXV0aERhdGFbcHJvdmlkZXJdKTtcbiAgfSk7XG4gIHJldHVybiBQcm9taXNlLmFsbCh2YWxpZGF0aW9ucyk7XG59XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuZmluZFVzZXJzV2l0aEF1dGhEYXRhID0gZnVuY3Rpb24oYXV0aERhdGEpIHtcbiAgY29uc3QgcHJvdmlkZXJzID0gT2JqZWN0LmtleXMoYXV0aERhdGEpO1xuICBjb25zdCBxdWVyeSA9IHByb3ZpZGVycy5yZWR1Y2UoKG1lbW8sIHByb3ZpZGVyKSA9PiB7XG4gICAgaWYgKCFhdXRoRGF0YVtwcm92aWRlcl0pIHtcbiAgICAgIHJldHVybiBtZW1vO1xuICAgIH1cbiAgICBjb25zdCBxdWVyeUtleSA9IGBhdXRoRGF0YS4ke3Byb3ZpZGVyfS5pZGA7XG4gICAgY29uc3QgcXVlcnkgPSB7fTtcbiAgICBxdWVyeVtxdWVyeUtleV0gPSBhdXRoRGF0YVtwcm92aWRlcl0uaWQ7XG4gICAgbWVtby5wdXNoKHF1ZXJ5KTtcbiAgICByZXR1cm4gbWVtbztcbiAgfSwgW10pLmZpbHRlcigocSkgPT4ge1xuICAgIHJldHVybiB0eXBlb2YgcSAhPT0gJ3VuZGVmaW5lZCc7XG4gIH0pO1xuXG4gIGxldCBmaW5kUHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShbXSk7XG4gIGlmIChxdWVyeS5sZW5ndGggPiAwKSB7XG4gICAgZmluZFByb21pc2UgPSB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICB7JyRvcic6IHF1ZXJ5fSwge30pXG4gIH1cblxuICByZXR1cm4gZmluZFByb21pc2U7XG59XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuZmlsdGVyZWRPYmplY3RzQnlBQ0wgPSBmdW5jdGlvbihvYmplY3RzKSB7XG4gIGlmICh0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICByZXR1cm4gb2JqZWN0cztcbiAgfVxuICByZXR1cm4gb2JqZWN0cy5maWx0ZXIoKG9iamVjdCkgPT4ge1xuICAgIGlmICghb2JqZWN0LkFDTCkge1xuICAgICAgcmV0dXJuIHRydWU7IC8vIGxlZ2FjeSB1c2VycyB0aGF0IGhhdmUgbm8gQUNMIGZpZWxkIG9uIHRoZW1cbiAgICB9XG4gICAgLy8gUmVndWxhciB1c2VycyB0aGF0IGhhdmUgYmVlbiBsb2NrZWQgb3V0LlxuICAgIHJldHVybiBvYmplY3QuQUNMICYmIE9iamVjdC5rZXlzKG9iamVjdC5BQ0wpLmxlbmd0aCA+IDA7XG4gIH0pO1xufVxuXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZUF1dGhEYXRhID0gZnVuY3Rpb24oYXV0aERhdGEpIHtcbiAgbGV0IHJlc3VsdHM7XG4gIHJldHVybiB0aGlzLmZpbmRVc2Vyc1dpdGhBdXRoRGF0YShhdXRoRGF0YSkudGhlbigocikgPT4ge1xuICAgIHJlc3VsdHMgPSB0aGlzLmZpbHRlcmVkT2JqZWN0c0J5QUNMKHIpO1xuICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDEpIHtcbiAgICAgIC8vIE1vcmUgdGhhbiAxIHVzZXIgd2l0aCB0aGUgcGFzc2VkIGlkJ3NcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5BQ0NPVU5UX0FMUkVBRFlfTElOS0VELFxuICAgICAgICAndGhpcyBhdXRoIGlzIGFscmVhZHkgdXNlZCcpO1xuICAgIH1cblxuICAgIHRoaXMuc3RvcmFnZVsnYXV0aFByb3ZpZGVyJ10gPSBPYmplY3Qua2V5cyhhdXRoRGF0YSkuam9pbignLCcpO1xuXG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgdXNlclJlc3VsdCA9IHJlc3VsdHNbMF07XG4gICAgICBjb25zdCBtdXRhdGVkQXV0aERhdGEgPSB7fTtcbiAgICAgIE9iamVjdC5rZXlzKGF1dGhEYXRhKS5mb3JFYWNoKChwcm92aWRlcikgPT4ge1xuICAgICAgICBjb25zdCBwcm92aWRlckRhdGEgPSBhdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgIGNvbnN0IHVzZXJBdXRoRGF0YSA9IHVzZXJSZXN1bHQuYXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICBpZiAoIV8uaXNFcXVhbChwcm92aWRlckRhdGEsIHVzZXJBdXRoRGF0YSkpIHtcbiAgICAgICAgICBtdXRhdGVkQXV0aERhdGFbcHJvdmlkZXJdID0gcHJvdmlkZXJEYXRhO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGhhc011dGF0ZWRBdXRoRGF0YSA9IE9iamVjdC5rZXlzKG11dGF0ZWRBdXRoRGF0YSkubGVuZ3RoICE9PSAwO1xuICAgICAgbGV0IHVzZXJJZDtcbiAgICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgdXNlcklkID0gdGhpcy5xdWVyeS5vYmplY3RJZDtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy5hdXRoICYmIHRoaXMuYXV0aC51c2VyICYmIHRoaXMuYXV0aC51c2VyLmlkKSB7XG4gICAgICAgIHVzZXJJZCA9IHRoaXMuYXV0aC51c2VyLmlkO1xuICAgICAgfVxuICAgICAgaWYgKCF1c2VySWQgfHwgdXNlcklkID09PSB1c2VyUmVzdWx0Lm9iamVjdElkKSB7IC8vIG5vIHVzZXIgbWFraW5nIHRoZSBjYWxsXG4gICAgICAgIC8vIE9SIHRoZSB1c2VyIG1ha2luZyB0aGUgY2FsbCBpcyB0aGUgcmlnaHQgb25lXG4gICAgICAgIC8vIExvZ2luIHdpdGggYXV0aCBkYXRhXG4gICAgICAgIGRlbGV0ZSByZXN1bHRzWzBdLnBhc3N3b3JkO1xuXG4gICAgICAgIC8vIG5lZWQgdG8gc2V0IHRoZSBvYmplY3RJZCBmaXJzdCBvdGhlcndpc2UgbG9jYXRpb24gaGFzIHRyYWlsaW5nIHVuZGVmaW5lZFxuICAgICAgICB0aGlzLmRhdGEub2JqZWN0SWQgPSB1c2VyUmVzdWx0Lm9iamVjdElkO1xuXG4gICAgICAgIGlmICghdGhpcy5xdWVyeSB8fCAhdGhpcy5xdWVyeS5vYmplY3RJZCkgeyAvLyB0aGlzIGEgbG9naW4gY2FsbCwgbm8gdXNlcklkIHBhc3NlZFxuICAgICAgICAgIHRoaXMucmVzcG9uc2UgPSB7XG4gICAgICAgICAgICByZXNwb25zZTogdXNlclJlc3VsdCxcbiAgICAgICAgICAgIGxvY2F0aW9uOiB0aGlzLmxvY2F0aW9uKClcbiAgICAgICAgICB9O1xuICAgICAgICB9XG4gICAgICAgIC8vIElmIHdlIGRpZG4ndCBjaGFuZ2UgdGhlIGF1dGggZGF0YSwganVzdCBrZWVwIGdvaW5nXG4gICAgICAgIGlmICghaGFzTXV0YXRlZEF1dGhEYXRhKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIFdlIGhhdmUgYXV0aERhdGEgdGhhdCBpcyB1cGRhdGVkIG9uIGxvZ2luXG4gICAgICAgIC8vIHRoYXQgY2FuIGhhcHBlbiB3aGVuIHRva2VuIGFyZSByZWZyZXNoZWQsXG4gICAgICAgIC8vIFdlIHNob3VsZCB1cGRhdGUgdGhlIHRva2VuIGFuZCBsZXQgdGhlIHVzZXIgaW5cbiAgICAgICAgLy8gV2Ugc2hvdWxkIG9ubHkgY2hlY2sgdGhlIG11dGF0ZWQga2V5c1xuICAgICAgICByZXR1cm4gdGhpcy5oYW5kbGVBdXRoRGF0YVZhbGlkYXRpb24obXV0YXRlZEF1dGhEYXRhKS50aGVuKCgpID0+IHtcbiAgICAgICAgICAvLyBJRiB3ZSBoYXZlIGEgcmVzcG9uc2UsIHdlJ2xsIHNraXAgdGhlIGRhdGFiYXNlIG9wZXJhdGlvbiAvIGJlZm9yZVNhdmUgLyBhZnRlclNhdmUgZXRjLi4uXG4gICAgICAgICAgLy8gd2UgbmVlZCB0byBzZXQgaXQgdXAgdGhlcmUuXG4gICAgICAgICAgLy8gV2UgYXJlIHN1cHBvc2VkIHRvIGhhdmUgYSByZXNwb25zZSBvbmx5IG9uIExPR0lOIHdpdGggYXV0aERhdGEsIHNvIHdlIHNraXAgdGhvc2VcbiAgICAgICAgICAvLyBJZiB3ZSdyZSBub3QgbG9nZ2luZyBpbiwgYnV0IGp1c3QgdXBkYXRpbmcgdGhlIGN1cnJlbnQgdXNlciwgd2UgY2FuIHNhZmVseSBza2lwIHRoYXQgcGFydFxuICAgICAgICAgIGlmICh0aGlzLnJlc3BvbnNlKSB7XG4gICAgICAgICAgICAvLyBBc3NpZ24gdGhlIG5ldyBhdXRoRGF0YSBpbiB0aGUgcmVzcG9uc2VcbiAgICAgICAgICAgIE9iamVjdC5rZXlzKG11dGF0ZWRBdXRoRGF0YSkuZm9yRWFjaCgocHJvdmlkZXIpID0+IHtcbiAgICAgICAgICAgICAgdGhpcy5yZXNwb25zZS5yZXNwb25zZS5hdXRoRGF0YVtwcm92aWRlcl0gPSBtdXRhdGVkQXV0aERhdGFbcHJvdmlkZXJdO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAvLyBSdW4gdGhlIERCIHVwZGF0ZSBkaXJlY3RseSwgYXMgJ21hc3RlcidcbiAgICAgICAgICAgIC8vIEp1c3QgdXBkYXRlIHRoZSBhdXRoRGF0YSBwYXJ0XG4gICAgICAgICAgICAvLyBUaGVuIHdlJ3JlIGdvb2QgZm9yIHRoZSB1c2VyLCBlYXJseSBleGl0IG9mIHNvcnRzXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UudXBkYXRlKHRoaXMuY2xhc3NOYW1lLCB7b2JqZWN0SWQ6IHRoaXMuZGF0YS5vYmplY3RJZH0sIHthdXRoRGF0YTogbXV0YXRlZEF1dGhEYXRhfSwge30pO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2UgaWYgKHVzZXJJZCkge1xuICAgICAgICAvLyBUcnlpbmcgdG8gdXBkYXRlIGF1dGggZGF0YSBidXQgdXNlcnNcbiAgICAgICAgLy8gYXJlIGRpZmZlcmVudFxuICAgICAgICBpZiAodXNlclJlc3VsdC5vYmplY3RJZCAhPT0gdXNlcklkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkFDQ09VTlRfQUxSRUFEWV9MSU5LRUQsXG4gICAgICAgICAgICAndGhpcyBhdXRoIGlzIGFscmVhZHkgdXNlZCcpO1xuICAgICAgICB9XG4gICAgICAgIC8vIE5vIGF1dGggZGF0YSB3YXMgbXV0YXRlZCwganVzdCBrZWVwIGdvaW5nXG4gICAgICAgIGlmICghaGFzTXV0YXRlZEF1dGhEYXRhKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiB0aGlzLmhhbmRsZUF1dGhEYXRhVmFsaWRhdGlvbihhdXRoRGF0YSk7XG4gIH0pO1xufVxuXG5cbi8vIFRoZSBub24tdGhpcmQtcGFydHkgcGFydHMgb2YgVXNlciB0cmFuc2Zvcm1hdGlvblxuUmVzdFdyaXRlLnByb3RvdHlwZS50cmFuc2Zvcm1Vc2VyID0gZnVuY3Rpb24oKSB7XG4gIHZhciBwcm9taXNlID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgaWYgKHRoaXMuY2xhc3NOYW1lICE9PSAnX1VzZXInKSB7XG4gICAgcmV0dXJuIHByb21pc2U7XG4gIH1cblxuICBpZiAoIXRoaXMuYXV0aC5pc01hc3RlciAmJiBcImVtYWlsVmVyaWZpZWRcIiBpbiB0aGlzLmRhdGEpIHtcbiAgICBjb25zdCBlcnJvciA9IGBDbGllbnRzIGFyZW4ndCBhbGxvd2VkIHRvIG1hbnVhbGx5IHVwZGF0ZSBlbWFpbCB2ZXJpZmljYXRpb24uYFxuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PUEVSQVRJT05fRk9SQklEREVOLCBlcnJvcik7XG4gIH1cblxuICAvLyBEbyBub3QgY2xlYW51cCBzZXNzaW9uIGlmIG9iamVjdElkIGlzIG5vdCBzZXRcbiAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5vYmplY3RJZCgpKSB7XG4gICAgLy8gSWYgd2UncmUgdXBkYXRpbmcgYSBfVXNlciBvYmplY3QsIHdlIG5lZWQgdG8gY2xlYXIgb3V0IHRoZSBjYWNoZSBmb3IgdGhhdCB1c2VyLiBGaW5kIGFsbCB0aGVpclxuICAgIC8vIHNlc3Npb24gdG9rZW5zLCBhbmQgcmVtb3ZlIHRoZW0gZnJvbSB0aGUgY2FjaGUuXG4gICAgcHJvbWlzZSA9IG5ldyBSZXN0UXVlcnkodGhpcy5jb25maWcsIEF1dGgubWFzdGVyKHRoaXMuY29uZmlnKSwgJ19TZXNzaW9uJywge1xuICAgICAgdXNlcjoge1xuICAgICAgICBfX3R5cGU6IFwiUG9pbnRlclwiLFxuICAgICAgICBjbGFzc05hbWU6IFwiX1VzZXJcIixcbiAgICAgICAgb2JqZWN0SWQ6IHRoaXMub2JqZWN0SWQoKSxcbiAgICAgIH1cbiAgICB9KS5leGVjdXRlKClcbiAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICByZXN1bHRzLnJlc3VsdHMuZm9yRWFjaChzZXNzaW9uID0+IHRoaXMuY29uZmlnLmNhY2hlQ29udHJvbGxlci51c2VyLmRlbChzZXNzaW9uLnNlc3Npb25Ub2tlbikpO1xuICAgICAgfSk7XG4gIH1cblxuICByZXR1cm4gcHJvbWlzZS50aGVuKCgpID0+IHtcbiAgICAvLyBUcmFuc2Zvcm0gdGhlIHBhc3N3b3JkXG4gICAgaWYgKHRoaXMuZGF0YS5wYXNzd29yZCA9PT0gdW5kZWZpbmVkKSB7IC8vIGlnbm9yZSBvbmx5IGlmIHVuZGVmaW5lZC4gc2hvdWxkIHByb2NlZWQgaWYgZW1wdHkgKCcnKVxuICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgIH1cblxuICAgIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgICB0aGlzLnN0b3JhZ2VbJ2NsZWFyU2Vzc2lvbnMnXSA9IHRydWU7XG4gICAgICAvLyBHZW5lcmF0ZSBhIG5ldyBzZXNzaW9uIG9ubHkgaWYgdGhlIHVzZXIgcmVxdWVzdGVkXG4gICAgICBpZiAoIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgICAgICB0aGlzLnN0b3JhZ2VbJ2dlbmVyYXRlTmV3U2Vzc2lvbiddID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcy5fdmFsaWRhdGVQYXNzd29yZFBvbGljeSgpLnRoZW4oKCkgPT4ge1xuICAgICAgcmV0dXJuIHBhc3N3b3JkQ3J5cHRvLmhhc2godGhpcy5kYXRhLnBhc3N3b3JkKS50aGVuKChoYXNoZWRQYXNzd29yZCkgPT4ge1xuICAgICAgICB0aGlzLmRhdGEuX2hhc2hlZF9wYXNzd29yZCA9IGhhc2hlZFBhc3N3b3JkO1xuICAgICAgICBkZWxldGUgdGhpcy5kYXRhLnBhc3N3b3JkO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlVXNlck5hbWUoKTtcbiAgfSkudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuX3ZhbGlkYXRlRW1haWwoKTtcbiAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVVzZXJOYW1lID0gZnVuY3Rpb24gKCkge1xuICAvLyBDaGVjayBmb3IgdXNlcm5hbWUgdW5pcXVlbmVzc1xuICBpZiAoIXRoaXMuZGF0YS51c2VybmFtZSkge1xuICAgIGlmICghdGhpcy5xdWVyeSkge1xuICAgICAgdGhpcy5kYXRhLnVzZXJuYW1lID0gY3J5cHRvVXRpbHMucmFuZG9tU3RyaW5nKDI1KTtcbiAgICAgIHRoaXMucmVzcG9uc2VTaG91bGRIYXZlVXNlcm5hbWUgPSB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIH1cbiAgLy8gV2UgbmVlZCB0byBhIGZpbmQgdG8gY2hlY2sgZm9yIGR1cGxpY2F0ZSB1c2VybmFtZSBpbiBjYXNlIHRoZXkgYXJlIG1pc3NpbmcgdGhlIHVuaXF1ZSBpbmRleCBvbiB1c2VybmFtZXNcbiAgLy8gVE9ETzogQ2hlY2sgaWYgdGhlcmUgaXMgYSB1bmlxdWUgaW5kZXgsIGFuZCBpZiBzbywgc2tpcCB0aGlzIHF1ZXJ5LlxuICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UuZmluZChcbiAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICB7dXNlcm5hbWU6IHRoaXMuZGF0YS51c2VybmFtZSwgb2JqZWN0SWQ6IHsnJG5lJzogdGhpcy5vYmplY3RJZCgpfX0sXG4gICAge2xpbWl0OiAxfVxuICApLnRoZW4ocmVzdWx0cyA9PiB7XG4gICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLCAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyB1c2VybmFtZS4nKTtcbiAgICB9XG4gICAgcmV0dXJuO1xuICB9KTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuX3ZhbGlkYXRlRW1haWwgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLmRhdGEuZW1haWwgfHwgdGhpcy5kYXRhLmVtYWlsLl9fb3AgPT09ICdEZWxldGUnKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICB9XG4gIC8vIFZhbGlkYXRlIGJhc2ljIGVtYWlsIGFkZHJlc3MgZm9ybWF0XG4gIGlmICghdGhpcy5kYXRhLmVtYWlsLm1hdGNoKC9eLitALiskLykpIHtcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfRU1BSUxfQUREUkVTUywgJ0VtYWlsIGFkZHJlc3MgZm9ybWF0IGlzIGludmFsaWQuJykpO1xuICB9XG4gIC8vIFNhbWUgcHJvYmxlbSBmb3IgZW1haWwgYXMgYWJvdmUgZm9yIHVzZXJuYW1lXG4gIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgIHRoaXMuY2xhc3NOYW1lLFxuICAgIHtlbWFpbDogdGhpcy5kYXRhLmVtYWlsLCBvYmplY3RJZDogeyckbmUnOiB0aGlzLm9iamVjdElkKCl9fSxcbiAgICB7bGltaXQ6IDF9XG4gICkudGhlbihyZXN1bHRzID0+IHtcbiAgICBpZiAocmVzdWx0cy5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfVEFLRU4sICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIGVtYWlsIGFkZHJlc3MuJyk7XG4gICAgfVxuICAgIGlmIChcbiAgICAgICF0aGlzLmRhdGEuYXV0aERhdGEgfHxcbiAgICAgICFPYmplY3Qua2V5cyh0aGlzLmRhdGEuYXV0aERhdGEpLmxlbmd0aCB8fFxuICAgICAgT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKS5sZW5ndGggPT09IDEgJiYgT2JqZWN0LmtleXModGhpcy5kYXRhLmF1dGhEYXRhKVswXSA9PT0gJ2Fub255bW91cydcbiAgICApIHtcbiAgICAgIC8vIFdlIHVwZGF0ZWQgdGhlIGVtYWlsLCBzZW5kIGEgbmV3IHZhbGlkYXRpb25cbiAgICAgIHRoaXMuc3RvcmFnZVsnc2VuZFZlcmlmaWNhdGlvbkVtYWlsJ10gPSB0cnVlO1xuICAgICAgdGhpcy5jb25maWcudXNlckNvbnRyb2xsZXIuc2V0RW1haWxWZXJpZnlUb2tlbih0aGlzLmRhdGEpO1xuICAgIH1cbiAgfSk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVBhc3N3b3JkUG9saWN5ID0gZnVuY3Rpb24oKSB7XG4gIGlmICghdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kpXG4gICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICByZXR1cm4gdGhpcy5fdmFsaWRhdGVQYXNzd29yZFJlcXVpcmVtZW50cygpLnRoZW4oKCkgPT4ge1xuICAgIHJldHVybiB0aGlzLl92YWxpZGF0ZVBhc3N3b3JkSGlzdG9yeSgpO1xuICB9KTtcbn07XG5cblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdmFsaWRhdGVQYXNzd29yZFJlcXVpcmVtZW50cyA9IGZ1bmN0aW9uKCkge1xuICAvLyBjaGVjayBpZiB0aGUgcGFzc3dvcmQgY29uZm9ybXMgdG8gdGhlIGRlZmluZWQgcGFzc3dvcmQgcG9saWN5IGlmIGNvbmZpZ3VyZWRcbiAgY29uc3QgcG9saWN5RXJyb3IgPSAnUGFzc3dvcmQgZG9lcyBub3QgbWVldCB0aGUgUGFzc3dvcmQgUG9saWN5IHJlcXVpcmVtZW50cy4nO1xuXG4gIC8vIGNoZWNrIHdoZXRoZXIgdGhlIHBhc3N3b3JkIG1lZXRzIHRoZSBwYXNzd29yZCBzdHJlbmd0aCByZXF1aXJlbWVudHNcbiAgaWYgKHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnBhdHRlcm5WYWxpZGF0b3IgJiYgIXRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnBhdHRlcm5WYWxpZGF0b3IodGhpcy5kYXRhLnBhc3N3b3JkKSB8fFxuICAgIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5LnZhbGlkYXRvckNhbGxiYWNrICYmICF0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS52YWxpZGF0b3JDYWxsYmFjayh0aGlzLmRhdGEucGFzc3dvcmQpKSB7XG4gICAgcmV0dXJuIFByb21pc2UucmVqZWN0KG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5WQUxJREFUSU9OX0VSUk9SLCBwb2xpY3lFcnJvcikpO1xuICB9XG5cbiAgLy8gY2hlY2sgd2hldGhlciBwYXNzd29yZCBjb250YWluIHVzZXJuYW1lXG4gIGlmICh0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5kb05vdEFsbG93VXNlcm5hbWUgPT09IHRydWUpIHtcbiAgICBpZiAodGhpcy5kYXRhLnVzZXJuYW1lKSB7IC8vIHVzZXJuYW1lIGlzIG5vdCBwYXNzZWQgZHVyaW5nIHBhc3N3b3JkIHJlc2V0XG4gICAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkLmluZGV4T2YodGhpcy5kYXRhLnVzZXJuYW1lKSA+PSAwKVxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlZBTElEQVRJT05fRVJST1IsIHBvbGljeUVycm9yKSk7XG4gICAgfSBlbHNlIHsgLy8gcmV0cmlldmUgdGhlIFVzZXIgb2JqZWN0IHVzaW5nIG9iamVjdElkIGR1cmluZyBwYXNzd29yZCByZXNldFxuICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywge29iamVjdElkOiB0aGlzLm9iamVjdElkKCl9KVxuICAgICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgICBpZiAocmVzdWx0cy5sZW5ndGggIT0gMSkge1xuICAgICAgICAgICAgdGhyb3cgdW5kZWZpbmVkO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5kYXRhLnBhc3N3b3JkLmluZGV4T2YocmVzdWx0c1swXS51c2VybmFtZSkgPj0gMClcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVkFMSURBVElPTl9FUlJPUiwgcG9saWN5RXJyb3IpKTtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH0pO1xuICAgIH1cbiAgfVxuICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLl92YWxpZGF0ZVBhc3N3b3JkSGlzdG9yeSA9IGZ1bmN0aW9uKCkge1xuICAvLyBjaGVjayB3aGV0aGVyIHBhc3N3b3JkIGlzIHJlcGVhdGluZyBmcm9tIHNwZWNpZmllZCBoaXN0b3J5XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeSkge1xuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKCdfVXNlcicsIHtvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpfSwge2tleXM6IFtcIl9wYXNzd29yZF9oaXN0b3J5XCIsIFwiX2hhc2hlZF9wYXNzd29yZFwiXX0pXG4gICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICB0aHJvdyB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdXNlciA9IHJlc3VsdHNbMF07XG4gICAgICAgIGxldCBvbGRQYXNzd29yZHMgPSBbXTtcbiAgICAgICAgaWYgKHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnkpXG4gICAgICAgICAgb2xkUGFzc3dvcmRzID0gXy50YWtlKHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnksIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkSGlzdG9yeSAtIDEpO1xuICAgICAgICBvbGRQYXNzd29yZHMucHVzaCh1c2VyLnBhc3N3b3JkKTtcbiAgICAgICAgY29uc3QgbmV3UGFzc3dvcmQgPSB0aGlzLmRhdGEucGFzc3dvcmQ7XG4gICAgICAgIC8vIGNvbXBhcmUgdGhlIG5ldyBwYXNzd29yZCBoYXNoIHdpdGggYWxsIG9sZCBwYXNzd29yZCBoYXNoZXNcbiAgICAgICAgY29uc3QgcHJvbWlzZXMgPSBvbGRQYXNzd29yZHMubWFwKGZ1bmN0aW9uIChoYXNoKSB7XG4gICAgICAgICAgcmV0dXJuIHBhc3N3b3JkQ3J5cHRvLmNvbXBhcmUobmV3UGFzc3dvcmQsIGhhc2gpLnRoZW4oKHJlc3VsdCkgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc3VsdCkgLy8gcmVqZWN0IGlmIHRoZXJlIGlzIGEgbWF0Y2hcbiAgICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVqZWN0KFwiUkVQRUFUX1BBU1NXT1JEXCIpO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICAgICAgICAgIH0pXG4gICAgICAgIH0pO1xuICAgICAgICAvLyB3YWl0IGZvciBhbGwgY29tcGFyaXNvbnMgdG8gY29tcGxldGVcbiAgICAgICAgcmV0dXJuIFByb21pc2UuYWxsKHByb21pc2VzKS50aGVuKCgpID0+IHtcbiAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XG4gICAgICAgIH0pLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgaWYgKGVyciA9PT0gXCJSRVBFQVRfUEFTU1dPUkRcIikgLy8gYSBtYXRjaCB3YXMgZm91bmRcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlamVjdChuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuVkFMSURBVElPTl9FUlJPUiwgYE5ldyBwYXNzd29yZCBzaG91bGQgbm90IGJlIHRoZSBzYW1lIGFzIGxhc3QgJHt0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEhpc3Rvcnl9IHBhc3N3b3Jkcy5gKSk7XG4gICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICB9XG4gIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuY3JlYXRlU2Vzc2lvblRva2VuSWZOZWVkZWQgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMuY2xhc3NOYW1lICE9PSAnX1VzZXInKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICh0aGlzLnF1ZXJ5KSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdGhpcy5zdG9yYWdlWydhdXRoUHJvdmlkZXInXSAvLyBzaWdudXAgY2FsbCwgd2l0aFxuICAgICAgJiYgdGhpcy5jb25maWcucHJldmVudExvZ2luV2l0aFVudmVyaWZpZWRFbWFpbCAvLyBubyBsb2dpbiB3aXRob3V0IHZlcmlmaWNhdGlvblxuICAgICAgJiYgdGhpcy5jb25maWcudmVyaWZ5VXNlckVtYWlscykgeyAvLyB2ZXJpZmljYXRpb24gaXMgb25cbiAgICByZXR1cm47IC8vIGRvIG5vdCBjcmVhdGUgdGhlIHNlc3Npb24gdG9rZW4gaW4gdGhhdCBjYXNlIVxuICB9XG4gIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbigpO1xufVxuXG5SZXN0V3JpdGUucHJvdG90eXBlLmNyZWF0ZVNlc3Npb25Ub2tlbiA9IGZ1bmN0aW9uKCkge1xuICAvLyBjbG91ZCBpbnN0YWxsYXRpb25JZCBmcm9tIENsb3VkIENvZGUsXG4gIC8vIG5ldmVyIGNyZWF0ZSBzZXNzaW9uIHRva2VucyBmcm9tIHRoZXJlLlxuICBpZiAodGhpcy5hdXRoLmluc3RhbGxhdGlvbklkICYmIHRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZCA9PT0gJ2Nsb3VkJykge1xuICAgIHJldHVybjtcbiAgfVxuXG4gIGNvbnN0IHtcbiAgICBzZXNzaW9uRGF0YSxcbiAgICBjcmVhdGVTZXNzaW9uLFxuICB9ID0gQXV0aC5jcmVhdGVTZXNzaW9uKHRoaXMuY29uZmlnLCB7XG4gICAgdXNlcklkOiB0aGlzLm9iamVjdElkKCksXG4gICAgY3JlYXRlZFdpdGg6IHtcbiAgICAgICdhY3Rpb24nOiB0aGlzLnN0b3JhZ2VbJ2F1dGhQcm92aWRlciddID8gJ2xvZ2luJyA6ICdzaWdudXAnLFxuICAgICAgJ2F1dGhQcm92aWRlcic6IHRoaXMuc3RvcmFnZVsnYXV0aFByb3ZpZGVyJ10gfHwgJ3Bhc3N3b3JkJ1xuICAgIH0sXG4gICAgaW5zdGFsbGF0aW9uSWQ6IHRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZCxcbiAgfSk7XG5cbiAgaWYgKHRoaXMucmVzcG9uc2UgJiYgdGhpcy5yZXNwb25zZS5yZXNwb25zZSkge1xuICAgIHRoaXMucmVzcG9uc2UucmVzcG9uc2Uuc2Vzc2lvblRva2VuID0gc2Vzc2lvbkRhdGEuc2Vzc2lvblRva2VuO1xuICB9XG5cbiAgcmV0dXJuIGNyZWF0ZVNlc3Npb24oKTtcbn1cblxuUmVzdFdyaXRlLnByb3RvdHlwZS5kZXN0cm95RHVwbGljYXRlZFNlc3Npb25zID0gZnVuY3Rpb24oKSB7XG4gIC8vIE9ubHkgZm9yIF9TZXNzaW9uLCBhbmQgYXQgY3JlYXRpb24gdGltZVxuICBpZiAodGhpcy5jbGFzc05hbWUgIT0gJ19TZXNzaW9uJyB8fCB0aGlzLnF1ZXJ5KSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIERlc3Ryb3kgdGhlIHNlc3Npb25zIGluICdCYWNrZ3JvdW5kJ1xuICBjb25zdCB7XG4gICAgdXNlcixcbiAgICBpbnN0YWxsYXRpb25JZCxcbiAgICBzZXNzaW9uVG9rZW4sXG4gIH0gPSB0aGlzLmRhdGE7XG4gIGlmICghdXNlciB8fCAhaW5zdGFsbGF0aW9uSWQpICB7XG4gICAgcmV0dXJuO1xuICB9XG4gIGlmICghdXNlci5vYmplY3RJZCkge1xuICAgIHJldHVybjtcbiAgfVxuICB0aGlzLmNvbmZpZy5kYXRhYmFzZS5kZXN0cm95KCdfU2Vzc2lvbicsIHtcbiAgICB1c2VyLFxuICAgIGluc3RhbGxhdGlvbklkLFxuICAgIHNlc3Npb25Ub2tlbjogeyAnJG5lJzogc2Vzc2lvblRva2VuIH0sXG4gIH0pO1xufVxuXG4vLyBIYW5kbGVzIGFueSBmb2xsb3d1cCBsb2dpY1xuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVGb2xsb3d1cCA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5zdG9yYWdlICYmIHRoaXMuc3RvcmFnZVsnY2xlYXJTZXNzaW9ucyddICYmIHRoaXMuY29uZmlnLnJldm9rZVNlc3Npb25PblBhc3N3b3JkUmVzZXQpIHtcbiAgICB2YXIgc2Vzc2lvblF1ZXJ5ID0ge1xuICAgICAgdXNlcjoge1xuICAgICAgICBfX3R5cGU6ICdQb2ludGVyJyxcbiAgICAgICAgY2xhc3NOYW1lOiAnX1VzZXInLFxuICAgICAgICBvYmplY3RJZDogdGhpcy5vYmplY3RJZCgpXG4gICAgICB9XG4gICAgfTtcbiAgICBkZWxldGUgdGhpcy5zdG9yYWdlWydjbGVhclNlc3Npb25zJ107XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmRlc3Ryb3koJ19TZXNzaW9uJywgc2Vzc2lvblF1ZXJ5KVxuICAgICAgLnRoZW4odGhpcy5oYW5kbGVGb2xsb3d1cC5iaW5kKHRoaXMpKTtcbiAgfVxuXG4gIGlmICh0aGlzLnN0b3JhZ2UgJiYgdGhpcy5zdG9yYWdlWydnZW5lcmF0ZU5ld1Nlc3Npb24nXSkge1xuICAgIGRlbGV0ZSB0aGlzLnN0b3JhZ2VbJ2dlbmVyYXRlTmV3U2Vzc2lvbiddO1xuICAgIHJldHVybiB0aGlzLmNyZWF0ZVNlc3Npb25Ub2tlbigpXG4gICAgICAudGhlbih0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcykpO1xuICB9XG5cbiAgaWYgKHRoaXMuc3RvcmFnZSAmJiB0aGlzLnN0b3JhZ2VbJ3NlbmRWZXJpZmljYXRpb25FbWFpbCddKSB7XG4gICAgZGVsZXRlIHRoaXMuc3RvcmFnZVsnc2VuZFZlcmlmaWNhdGlvbkVtYWlsJ107XG4gICAgLy8gRmlyZSBhbmQgZm9yZ2V0IVxuICAgIHRoaXMuY29uZmlnLnVzZXJDb250cm9sbGVyLnNlbmRWZXJpZmljYXRpb25FbWFpbCh0aGlzLmRhdGEpO1xuICAgIHJldHVybiB0aGlzLmhhbmRsZUZvbGxvd3VwLmJpbmQodGhpcyk7XG4gIH1cbn07XG5cbi8vIEhhbmRsZXMgdGhlIF9TZXNzaW9uIGNsYXNzIHNwZWNpYWxuZXNzLlxuLy8gRG9lcyBub3RoaW5nIGlmIHRoaXMgaXNuJ3QgYW4gX1Nlc3Npb24gb2JqZWN0LlxuUmVzdFdyaXRlLnByb3RvdHlwZS5oYW5kbGVTZXNzaW9uID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlIHx8IHRoaXMuY2xhc3NOYW1lICE9PSAnX1Nlc3Npb24nKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCF0aGlzLmF1dGgudXNlciAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLklOVkFMSURfU0VTU0lPTl9UT0tFTixcbiAgICAgICdTZXNzaW9uIHRva2VuIHJlcXVpcmVkLicpO1xuICB9XG5cbiAgLy8gVE9ETzogVmVyaWZ5IHByb3BlciBlcnJvciB0byB0aHJvd1xuICBpZiAodGhpcy5kYXRhLkFDTCkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FLCAnQ2Fubm90IHNldCAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgJ0FDTCBvbiBhIFNlc3Npb24uJyk7XG4gIH1cblxuICBpZiAodGhpcy5xdWVyeSkge1xuICAgIGlmICh0aGlzLmRhdGEudXNlciAmJiAhdGhpcy5hdXRoLmlzTWFzdGVyICYmIHRoaXMuZGF0YS51c2VyLm9iamVjdElkICE9IHRoaXMuYXV0aC51c2VyLmlkKSB7XG4gICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5WQUxJRF9LRVlfTkFNRSk7XG4gICAgfSBlbHNlIGlmICh0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuZGF0YS5zZXNzaW9uVG9rZW4pIHtcbiAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0tFWV9OQU1FKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIXRoaXMucXVlcnkgJiYgIXRoaXMuYXV0aC5pc01hc3Rlcikge1xuICAgIGNvbnN0IGFkZGl0aW9uYWxTZXNzaW9uRGF0YSA9IHt9O1xuICAgIGZvciAodmFyIGtleSBpbiB0aGlzLmRhdGEpIHtcbiAgICAgIGlmIChrZXkgPT09ICdvYmplY3RJZCcgfHwga2V5ID09PSAndXNlcicpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBhZGRpdGlvbmFsU2Vzc2lvbkRhdGFba2V5XSA9IHRoaXMuZGF0YVtrZXldO1xuICAgIH1cblxuICAgIGNvbnN0IHsgc2Vzc2lvbkRhdGEsIGNyZWF0ZVNlc3Npb24gfSA9IEF1dGguY3JlYXRlU2Vzc2lvbih0aGlzLmNvbmZpZywge1xuICAgICAgdXNlcklkOiB0aGlzLmF1dGgudXNlci5pZCxcbiAgICAgIGNyZWF0ZWRXaXRoOiB7XG4gICAgICAgIGFjdGlvbjogJ2NyZWF0ZScsXG4gICAgICB9LFxuICAgICAgYWRkaXRpb25hbFNlc3Npb25EYXRhXG4gICAgfSk7XG5cbiAgICByZXR1cm4gY3JlYXRlU2Vzc2lvbigpLnRoZW4oKHJlc3VsdHMpID0+IHtcbiAgICAgIGlmICghcmVzdWx0cy5yZXNwb25zZSkge1xuICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuSU5URVJOQUxfU0VSVkVSX0VSUk9SLFxuICAgICAgICAgICdFcnJvciBjcmVhdGluZyBzZXNzaW9uLicpO1xuICAgICAgfVxuICAgICAgc2Vzc2lvbkRhdGFbJ29iamVjdElkJ10gPSByZXN1bHRzLnJlc3BvbnNlWydvYmplY3RJZCddO1xuICAgICAgdGhpcy5yZXNwb25zZSA9IHtcbiAgICAgICAgc3RhdHVzOiAyMDEsXG4gICAgICAgIGxvY2F0aW9uOiByZXN1bHRzLmxvY2F0aW9uLFxuICAgICAgICByZXNwb25zZTogc2Vzc2lvbkRhdGFcbiAgICAgIH07XG4gICAgfSk7XG4gIH1cbn07XG5cbi8vIEhhbmRsZXMgdGhlIF9JbnN0YWxsYXRpb24gY2xhc3Mgc3BlY2lhbG5lc3MuXG4vLyBEb2VzIG5vdGhpbmcgaWYgdGhpcyBpc24ndCBhbiBpbnN0YWxsYXRpb24gb2JqZWN0LlxuLy8gSWYgYW4gaW5zdGFsbGF0aW9uIGlzIGZvdW5kLCB0aGlzIGNhbiBtdXRhdGUgdGhpcy5xdWVyeSBhbmQgdHVybiBhIGNyZWF0ZVxuLy8gaW50byBhbiB1cGRhdGUuXG4vLyBSZXR1cm5zIGEgcHJvbWlzZSBmb3Igd2hlbiB3ZSdyZSBkb25lIGlmIGl0IGNhbid0IGZpbmlzaCB0aGlzIHRpY2suXG5SZXN0V3JpdGUucHJvdG90eXBlLmhhbmRsZUluc3RhbGxhdGlvbiA9IGZ1bmN0aW9uKCkge1xuICBpZiAodGhpcy5yZXNwb25zZSB8fCB0aGlzLmNsYXNzTmFtZSAhPT0gJ19JbnN0YWxsYXRpb24nKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKCF0aGlzLnF1ZXJ5ICYmICF0aGlzLmRhdGEuZGV2aWNlVG9rZW4gJiYgIXRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZCAmJiAhdGhpcy5hdXRoLmluc3RhbGxhdGlvbklkKSB7XG4gICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNSxcbiAgICAgICdhdCBsZWFzdCBvbmUgSUQgZmllbGQgKGRldmljZVRva2VuLCBpbnN0YWxsYXRpb25JZCkgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICdtdXN0IGJlIHNwZWNpZmllZCBpbiB0aGlzIG9wZXJhdGlvbicpO1xuICB9XG5cbiAgLy8gSWYgdGhlIGRldmljZSB0b2tlbiBpcyA2NCBjaGFyYWN0ZXJzIGxvbmcsIHdlIGFzc3VtZSBpdCBpcyBmb3IgaU9TXG4gIC8vIGFuZCBsb3dlcmNhc2UgaXQuXG4gIGlmICh0aGlzLmRhdGEuZGV2aWNlVG9rZW4gJiYgdGhpcy5kYXRhLmRldmljZVRva2VuLmxlbmd0aCA9PSA2NCkge1xuICAgIHRoaXMuZGF0YS5kZXZpY2VUb2tlbiA9IHRoaXMuZGF0YS5kZXZpY2VUb2tlbi50b0xvd2VyQ2FzZSgpO1xuICB9XG5cbiAgLy8gV2UgbG93ZXJjYXNlIHRoZSBpbnN0YWxsYXRpb25JZCBpZiBwcmVzZW50XG4gIGlmICh0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgPSB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQudG9Mb3dlckNhc2UoKTtcbiAgfVxuXG4gIGxldCBpbnN0YWxsYXRpb25JZCA9IHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZDtcblxuICAvLyBJZiBkYXRhLmluc3RhbGxhdGlvbklkIGlzIG5vdCBzZXQgYW5kIHdlJ3JlIG5vdCBtYXN0ZXIsIHdlIGNhbiBsb29rdXAgaW4gYXV0aFxuICBpZiAoIWluc3RhbGxhdGlvbklkICYmICF0aGlzLmF1dGguaXNNYXN0ZXIpIHtcbiAgICBpbnN0YWxsYXRpb25JZCA9IHRoaXMuYXV0aC5pbnN0YWxsYXRpb25JZDtcbiAgfVxuXG4gIGlmIChpbnN0YWxsYXRpb25JZCkge1xuICAgIGluc3RhbGxhdGlvbklkID0gaW5zdGFsbGF0aW9uSWQudG9Mb3dlckNhc2UoKTtcbiAgfVxuXG4gIC8vIFVwZGF0aW5nIF9JbnN0YWxsYXRpb24gYnV0IG5vdCB1cGRhdGluZyBhbnl0aGluZyBjcml0aWNhbFxuICBpZiAodGhpcy5xdWVyeSAmJiAhdGhpcy5kYXRhLmRldmljZVRva2VuXG4gICAgICAgICAgICAgICAgICAmJiAhaW5zdGFsbGF0aW9uSWQgJiYgIXRoaXMuZGF0YS5kZXZpY2VUeXBlKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgdmFyIHByb21pc2UgPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICB2YXIgaWRNYXRjaDsgLy8gV2lsbCBiZSBhIG1hdGNoIG9uIGVpdGhlciBvYmplY3RJZCBvciBpbnN0YWxsYXRpb25JZFxuICB2YXIgb2JqZWN0SWRNYXRjaDtcbiAgdmFyIGluc3RhbGxhdGlvbklkTWF0Y2g7XG4gIHZhciBkZXZpY2VUb2tlbk1hdGNoZXMgPSBbXTtcblxuICAvLyBJbnN0ZWFkIG9mIGlzc3VpbmcgMyByZWFkcywgbGV0J3MgZG8gaXQgd2l0aCBvbmUgT1IuXG4gIGNvbnN0IG9yUXVlcmllcyA9IFtdO1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgb3JRdWVyaWVzLnB1c2goe1xuICAgICAgb2JqZWN0SWQ6IHRoaXMucXVlcnkub2JqZWN0SWRcbiAgICB9KTtcbiAgfVxuICBpZiAoaW5zdGFsbGF0aW9uSWQpIHtcbiAgICBvclF1ZXJpZXMucHVzaCh7XG4gICAgICAnaW5zdGFsbGF0aW9uSWQnOiBpbnN0YWxsYXRpb25JZFxuICAgIH0pO1xuICB9XG4gIGlmICh0aGlzLmRhdGEuZGV2aWNlVG9rZW4pIHtcbiAgICBvclF1ZXJpZXMucHVzaCh7J2RldmljZVRva2VuJzogdGhpcy5kYXRhLmRldmljZVRva2VufSk7XG4gIH1cblxuICBpZiAob3JRdWVyaWVzLmxlbmd0aCA9PSAwKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgcHJvbWlzZSA9IHByb21pc2UudGhlbigoKSA9PiB7XG4gICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19JbnN0YWxsYXRpb24nLCB7XG4gICAgICAnJG9yJzogb3JRdWVyaWVzXG4gICAgfSwge30pO1xuICB9KS50aGVuKChyZXN1bHRzKSA9PiB7XG4gICAgcmVzdWx0cy5mb3JFYWNoKChyZXN1bHQpID0+IHtcbiAgICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQgJiYgcmVzdWx0Lm9iamVjdElkID09IHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICAgICAgb2JqZWN0SWRNYXRjaCA9IHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHQuaW5zdGFsbGF0aW9uSWQgPT0gaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgaW5zdGFsbGF0aW9uSWRNYXRjaCA9IHJlc3VsdDtcbiAgICAgIH1cbiAgICAgIGlmIChyZXN1bHQuZGV2aWNlVG9rZW4gPT0gdGhpcy5kYXRhLmRldmljZVRva2VuKSB7XG4gICAgICAgIGRldmljZVRva2VuTWF0Y2hlcy5wdXNoKHJlc3VsdCk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBTYW5pdHkgY2hlY2tzIHdoZW4gcnVubmluZyBhIHF1ZXJ5XG4gICAgaWYgKHRoaXMucXVlcnkgJiYgdGhpcy5xdWVyeS5vYmplY3RJZCkge1xuICAgICAgaWYgKCFvYmplY3RJZE1hdGNoKSB7XG4gICAgICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5ELFxuICAgICAgICAgICdPYmplY3Qgbm90IGZvdW5kIGZvciB1cGRhdGUuJyk7XG4gICAgICB9XG4gICAgICBpZiAodGhpcy5kYXRhLmluc3RhbGxhdGlvbklkICYmIG9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWQgJiZcbiAgICAgICAgICB0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgIT09IG9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNixcbiAgICAgICAgICAnaW5zdGFsbGF0aW9uSWQgbWF5IG5vdCBiZSBjaGFuZ2VkIGluIHRoaXMgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdvcGVyYXRpb24nKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmRhdGEuZGV2aWNlVG9rZW4gJiYgb2JqZWN0SWRNYXRjaC5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUb2tlbiAhPT0gb2JqZWN0SWRNYXRjaC5kZXZpY2VUb2tlbiAmJlxuICAgICAgICAgICF0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQgJiYgIW9iamVjdElkTWF0Y2guaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNixcbiAgICAgICAgICAnZGV2aWNlVG9rZW4gbWF5IG5vdCBiZSBjaGFuZ2VkIGluIHRoaXMgJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICdvcGVyYXRpb24nKTtcbiAgICAgIH1cbiAgICAgIGlmICh0aGlzLmRhdGEuZGV2aWNlVHlwZSAmJiB0aGlzLmRhdGEuZGV2aWNlVHlwZSAmJlxuICAgICAgICAgIHRoaXMuZGF0YS5kZXZpY2VUeXBlICE9PSBvYmplY3RJZE1hdGNoLmRldmljZVR5cGUpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNixcbiAgICAgICAgICAnZGV2aWNlVHlwZSBtYXkgbm90IGJlIGNoYW5nZWQgaW4gdGhpcyAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgJ29wZXJhdGlvbicpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQgJiYgb2JqZWN0SWRNYXRjaCkge1xuICAgICAgaWRNYXRjaCA9IG9iamVjdElkTWF0Y2g7XG4gICAgfVxuXG4gICAgaWYgKGluc3RhbGxhdGlvbklkICYmIGluc3RhbGxhdGlvbklkTWF0Y2gpIHtcbiAgICAgIGlkTWF0Y2ggPSBpbnN0YWxsYXRpb25JZE1hdGNoO1xuICAgIH1cbiAgICAvLyBuZWVkIHRvIHNwZWNpZnkgZGV2aWNlVHlwZSBvbmx5IGlmIGl0J3MgbmV3XG4gICAgaWYgKCF0aGlzLnF1ZXJ5ICYmICF0aGlzLmRhdGEuZGV2aWNlVHlwZSAmJiAhaWRNYXRjaCkge1xuICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzNSxcbiAgICAgICAgJ2RldmljZVR5cGUgbXVzdCBiZSBzcGVjaWZpZWQgaW4gdGhpcyBvcGVyYXRpb24nKTtcbiAgICB9XG5cbiAgfSkudGhlbigoKSA9PiB7XG4gICAgaWYgKCFpZE1hdGNoKSB7XG4gICAgICBpZiAoIWRldmljZVRva2VuTWF0Y2hlcy5sZW5ndGgpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfSBlbHNlIGlmIChkZXZpY2VUb2tlbk1hdGNoZXMubGVuZ3RoID09IDEgJiZcbiAgICAgICAgKCFkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ2luc3RhbGxhdGlvbklkJ10gfHwgIWluc3RhbGxhdGlvbklkKVxuICAgICAgKSB7XG4gICAgICAgIC8vIFNpbmdsZSBtYXRjaCBvbiBkZXZpY2UgdG9rZW4gYnV0IG5vbmUgb24gaW5zdGFsbGF0aW9uSWQsIGFuZCBlaXRoZXJcbiAgICAgICAgLy8gdGhlIHBhc3NlZCBvYmplY3Qgb3IgdGhlIG1hdGNoIGlzIG1pc3NpbmcgYW4gaW5zdGFsbGF0aW9uSWQsIHNvIHdlXG4gICAgICAgIC8vIGNhbiBqdXN0IHJldHVybiB0aGUgbWF0Y2guXG4gICAgICAgIHJldHVybiBkZXZpY2VUb2tlbk1hdGNoZXNbMF1bJ29iamVjdElkJ107XG4gICAgICB9IGVsc2UgaWYgKCF0aGlzLmRhdGEuaW5zdGFsbGF0aW9uSWQpIHtcbiAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKDEzMixcbiAgICAgICAgICAnTXVzdCBzcGVjaWZ5IGluc3RhbGxhdGlvbklkIHdoZW4gZGV2aWNlVG9rZW4gJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAnbWF0Y2hlcyBtdWx0aXBsZSBJbnN0YWxsYXRpb24gb2JqZWN0cycpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gTXVsdGlwbGUgZGV2aWNlIHRva2VuIG1hdGNoZXMgYW5kIHdlIHNwZWNpZmllZCBhbiBpbnN0YWxsYXRpb24gSUQsXG4gICAgICAgIC8vIG9yIGEgc2luZ2xlIG1hdGNoIHdoZXJlIGJvdGggdGhlIHBhc3NlZCBhbmQgbWF0Y2hpbmcgb2JqZWN0cyBoYXZlXG4gICAgICAgIC8vIGFuIGluc3RhbGxhdGlvbiBJRC4gVHJ5IGNsZWFuaW5nIG91dCBvbGQgaW5zdGFsbGF0aW9ucyB0aGF0IG1hdGNoXG4gICAgICAgIC8vIHRoZSBkZXZpY2VUb2tlbiwgYW5kIHJldHVybiBuaWwgdG8gc2lnbmFsIHRoYXQgYSBuZXcgb2JqZWN0IHNob3VsZFxuICAgICAgICAvLyBiZSBjcmVhdGVkLlxuICAgICAgICB2YXIgZGVsUXVlcnkgPSB7XG4gICAgICAgICAgJ2RldmljZVRva2VuJzogdGhpcy5kYXRhLmRldmljZVRva2VuLFxuICAgICAgICAgICdpbnN0YWxsYXRpb25JZCc6IHtcbiAgICAgICAgICAgICckbmUnOiBpbnN0YWxsYXRpb25JZFxuICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgaWYgKHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyKSB7XG4gICAgICAgICAgZGVsUXVlcnlbJ2FwcElkZW50aWZpZXInXSA9IHRoaXMuZGF0YS5hcHBJZGVudGlmaWVyO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuY29uZmlnLmRhdGFiYXNlLmRlc3Ryb3koJ19JbnN0YWxsYXRpb24nLCBkZWxRdWVyeSlcbiAgICAgICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgICAgIGlmIChlcnIuY29kZSA9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgICAgICAgIC8vIG5vIGRlbGV0aW9ucyB3ZXJlIG1hZGUuIENhbiBiZSBpZ25vcmVkLlxuICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyByZXRocm93IHRoZSBlcnJvclxuICAgICAgICAgICAgdGhyb3cgZXJyO1xuICAgICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChkZXZpY2VUb2tlbk1hdGNoZXMubGVuZ3RoID09IDEgJiZcbiAgICAgICAgIWRldmljZVRva2VuTWF0Y2hlc1swXVsnaW5zdGFsbGF0aW9uSWQnXSkge1xuICAgICAgICAvLyBFeGFjdGx5IG9uZSBkZXZpY2UgdG9rZW4gbWF0Y2ggYW5kIGl0IGRvZXNuJ3QgaGF2ZSBhbiBpbnN0YWxsYXRpb25cbiAgICAgICAgLy8gSUQuIFRoaXMgaXMgdGhlIG9uZSBjYXNlIHdoZXJlIHdlIHdhbnQgdG8gbWVyZ2Ugd2l0aCB0aGUgZXhpc3RpbmdcbiAgICAgICAgLy8gb2JqZWN0LlxuICAgICAgICBjb25zdCBkZWxRdWVyeSA9IHtvYmplY3RJZDogaWRNYXRjaC5vYmplY3RJZH07XG4gICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5kZXN0cm95KCdfSW5zdGFsbGF0aW9uJywgZGVsUXVlcnkpXG4gICAgICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICAgICAgcmV0dXJuIGRldmljZVRva2VuTWF0Y2hlc1swXVsnb2JqZWN0SWQnXTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC5jYXRjaChlcnIgPT4ge1xuICAgICAgICAgICAgaWYgKGVyci5jb2RlID09IFBhcnNlLkVycm9yLk9CSkVDVF9OT1RfRk9VTkQpIHtcbiAgICAgICAgICAgICAgLy8gbm8gZGVsZXRpb25zIHdlcmUgbWFkZS4gQ2FuIGJlIGlnbm9yZWRcbiAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gcmV0aHJvdyB0aGUgZXJyb3JcbiAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0aGlzLmRhdGEuZGV2aWNlVG9rZW4gJiZcbiAgICAgICAgICBpZE1hdGNoLmRldmljZVRva2VuICE9IHRoaXMuZGF0YS5kZXZpY2VUb2tlbikge1xuICAgICAgICAgIC8vIFdlJ3JlIHNldHRpbmcgdGhlIGRldmljZSB0b2tlbiBvbiBhbiBleGlzdGluZyBpbnN0YWxsYXRpb24sIHNvXG4gICAgICAgICAgLy8gd2Ugc2hvdWxkIHRyeSBjbGVhbmluZyBvdXQgb2xkIGluc3RhbGxhdGlvbnMgdGhhdCBtYXRjaCB0aGlzXG4gICAgICAgICAgLy8gZGV2aWNlIHRva2VuLlxuICAgICAgICAgIGNvbnN0IGRlbFF1ZXJ5ID0ge1xuICAgICAgICAgICAgJ2RldmljZVRva2VuJzogdGhpcy5kYXRhLmRldmljZVRva2VuLFxuICAgICAgICAgIH07XG4gICAgICAgICAgLy8gV2UgaGF2ZSBhIHVuaXF1ZSBpbnN0YWxsIElkLCB1c2UgdGhhdCB0byBwcmVzZXJ2ZVxuICAgICAgICAgIC8vIHRoZSBpbnRlcmVzdGluZyBpbnN0YWxsYXRpb25cbiAgICAgICAgICBpZiAodGhpcy5kYXRhLmluc3RhbGxhdGlvbklkKSB7XG4gICAgICAgICAgICBkZWxRdWVyeVsnaW5zdGFsbGF0aW9uSWQnXSA9IHtcbiAgICAgICAgICAgICAgJyRuZSc6IHRoaXMuZGF0YS5pbnN0YWxsYXRpb25JZFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSBpZiAoaWRNYXRjaC5vYmplY3RJZCAmJiB0aGlzLmRhdGEub2JqZWN0SWRcbiAgICAgICAgICAgICAgICAgICAgJiYgaWRNYXRjaC5vYmplY3RJZCA9PSB0aGlzLmRhdGEub2JqZWN0SWQpIHtcbiAgICAgICAgICAgIC8vIHdlIHBhc3NlZCBhbiBvYmplY3RJZCwgcHJlc2VydmUgdGhhdCBpbnN0YWxhdGlvblxuICAgICAgICAgICAgZGVsUXVlcnlbJ29iamVjdElkJ10gPSB7XG4gICAgICAgICAgICAgICckbmUnOiBpZE1hdGNoLm9iamVjdElkXG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIFdoYXQgdG8gZG8gaGVyZT8gY2FuJ3QgcmVhbGx5IGNsZWFuIHVwIGV2ZXJ5dGhpbmcuLi5cbiAgICAgICAgICAgIHJldHVybiBpZE1hdGNoLm9iamVjdElkO1xuICAgICAgICAgIH1cbiAgICAgICAgICBpZiAodGhpcy5kYXRhLmFwcElkZW50aWZpZXIpIHtcbiAgICAgICAgICAgIGRlbFF1ZXJ5WydhcHBJZGVudGlmaWVyJ10gPSB0aGlzLmRhdGEuYXBwSWRlbnRpZmllcjtcbiAgICAgICAgICB9XG4gICAgICAgICAgdGhpcy5jb25maWcuZGF0YWJhc2UuZGVzdHJveSgnX0luc3RhbGxhdGlvbicsIGRlbFF1ZXJ5KVxuICAgICAgICAgICAgLmNhdGNoKGVyciA9PiB7XG4gICAgICAgICAgICAgIGlmIChlcnIuY29kZSA9PSBQYXJzZS5FcnJvci5PQkpFQ1RfTk9UX0ZPVU5EKSB7XG4gICAgICAgICAgICAgICAgLy8gbm8gZGVsZXRpb25zIHdlcmUgbWFkZS4gQ2FuIGJlIGlnbm9yZWQuXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIC8vIHJldGhyb3cgdGhlIGVycm9yXG4gICAgICAgICAgICAgIHRocm93IGVycjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIEluIG5vbi1tZXJnZSBzY2VuYXJpb3MsIGp1c3QgcmV0dXJuIHRoZSBpbnN0YWxsYXRpb24gbWF0Y2ggaWRcbiAgICAgICAgcmV0dXJuIGlkTWF0Y2gub2JqZWN0SWQ7XG4gICAgICB9XG4gICAgfVxuICB9KS50aGVuKChvYmpJZCkgPT4ge1xuICAgIGlmIChvYmpJZCkge1xuICAgICAgdGhpcy5xdWVyeSA9IHtvYmplY3RJZDogb2JqSWR9O1xuICAgICAgZGVsZXRlIHRoaXMuZGF0YS5vYmplY3RJZDtcbiAgICAgIGRlbGV0ZSB0aGlzLmRhdGEuY3JlYXRlZEF0O1xuICAgIH1cbiAgICAvLyBUT0RPOiBWYWxpZGF0ZSBvcHMgKGFkZC9yZW1vdmUgb24gY2hhbm5lbHMsICRpbmMgb24gYmFkZ2UsIGV0Yy4pXG4gIH0pO1xuICByZXR1cm4gcHJvbWlzZTtcbn07XG5cbi8vIElmIHdlIHNob3J0LWNpcmN1dGVkIHRoZSBvYmplY3QgcmVzcG9uc2UgLSB0aGVuIHdlIG5lZWQgdG8gbWFrZSBzdXJlIHdlIGV4cGFuZCBhbGwgdGhlIGZpbGVzLFxuLy8gc2luY2UgdGhpcyBtaWdodCBub3QgaGF2ZSBhIHF1ZXJ5LCBtZWFuaW5nIGl0IHdvbid0IHJldHVybiB0aGUgZnVsbCByZXN1bHQgYmFjay5cbi8vIFRPRE86IChubHV0c2Vua28pIFRoaXMgc2hvdWxkIGRpZSB3aGVuIHdlIG1vdmUgdG8gcGVyLWNsYXNzIGJhc2VkIGNvbnRyb2xsZXJzIG9uIF9TZXNzaW9uL19Vc2VyXG5SZXN0V3JpdGUucHJvdG90eXBlLmV4cGFuZEZpbGVzRm9yRXhpc3RpbmdPYmplY3RzID0gZnVuY3Rpb24oKSB7XG4gIC8vIENoZWNrIHdoZXRoZXIgd2UgaGF2ZSBhIHNob3J0LWNpcmN1aXRlZCByZXNwb25zZSAtIG9ubHkgdGhlbiBydW4gZXhwYW5zaW9uLlxuICBpZiAodGhpcy5yZXNwb25zZSAmJiB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlKSB7XG4gICAgdGhpcy5jb25maWcuZmlsZXNDb250cm9sbGVyLmV4cGFuZEZpbGVzSW5PYmplY3QodGhpcy5jb25maWcsIHRoaXMucmVzcG9uc2UucmVzcG9uc2UpO1xuICB9XG59O1xuXG5SZXN0V3JpdGUucHJvdG90eXBlLnJ1bkRhdGFiYXNlT3BlcmF0aW9uID0gZnVuY3Rpb24oKSB7XG4gIGlmICh0aGlzLnJlc3BvbnNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1JvbGUnKSB7XG4gICAgdGhpcy5jb25maWcuY2FjaGVDb250cm9sbGVyLnJvbGUuY2xlYXIoKTtcbiAgfVxuXG4gIGlmICh0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJyAmJlxuICAgICAgdGhpcy5xdWVyeSAmJlxuICAgICAgdGhpcy5hdXRoLmlzVW5hdXRoZW50aWNhdGVkKCkpIHtcbiAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuU0VTU0lPTl9NSVNTSU5HLCBgQ2Fubm90IG1vZGlmeSB1c2VyICR7dGhpcy5xdWVyeS5vYmplY3RJZH0uYCk7XG4gIH1cblxuICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfUHJvZHVjdCcgJiYgdGhpcy5kYXRhLmRvd25sb2FkKSB7XG4gICAgdGhpcy5kYXRhLmRvd25sb2FkTmFtZSA9IHRoaXMuZGF0YS5kb3dubG9hZC5uYW1lO1xuICB9XG5cbiAgLy8gVE9ETzogQWRkIGJldHRlciBkZXRlY3Rpb24gZm9yIEFDTCwgZW5zdXJpbmcgYSB1c2VyIGNhbid0IGJlIGxvY2tlZCBmcm9tXG4gIC8vICAgICAgIHRoZWlyIG93biB1c2VyIHJlY29yZC5cbiAgaWYgKHRoaXMuZGF0YS5BQ0wgJiYgdGhpcy5kYXRhLkFDTFsnKnVucmVzb2x2ZWQnXSkge1xuICAgIHRocm93IG5ldyBQYXJzZS5FcnJvcihQYXJzZS5FcnJvci5JTlZBTElEX0FDTCwgJ0ludmFsaWQgQUNMLicpO1xuICB9XG5cbiAgaWYgKHRoaXMucXVlcnkpIHtcbiAgICAvLyBGb3JjZSB0aGUgdXNlciB0byBub3QgbG9ja291dFxuICAgIC8vIE1hdGNoZWQgd2l0aCBwYXJzZS5jb21cbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiYgdGhpcy5kYXRhLkFDTCAmJiB0aGlzLmF1dGguaXNNYXN0ZXIgIT09IHRydWUpIHtcbiAgICAgIHRoaXMuZGF0YS5BQ0xbdGhpcy5xdWVyeS5vYmplY3RJZF0gPSB7IHJlYWQ6IHRydWUsIHdyaXRlOiB0cnVlIH07XG4gICAgfVxuICAgIC8vIHVwZGF0ZSBwYXNzd29yZCB0aW1lc3RhbXAgaWYgdXNlciBwYXNzd29yZCBpcyBiZWluZyBjaGFuZ2VkXG4gICAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInICYmIHRoaXMuZGF0YS5faGFzaGVkX3Bhc3N3b3JkICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5ICYmIHRoaXMuY29uZmlnLnBhc3N3b3JkUG9saWN5Lm1heFBhc3N3b3JkQWdlKSB7XG4gICAgICB0aGlzLmRhdGEuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpO1xuICAgIH1cbiAgICAvLyBJZ25vcmUgY3JlYXRlZEF0IHdoZW4gdXBkYXRlXG4gICAgZGVsZXRlIHRoaXMuZGF0YS5jcmVhdGVkQXQ7XG5cbiAgICBsZXQgZGVmZXIgPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgICAvLyBpZiBwYXNzd29yZCBoaXN0b3J5IGlzIGVuYWJsZWQgdGhlbiBzYXZlIHRoZSBjdXJyZW50IHBhc3N3b3JkIHRvIGhpc3RvcnlcbiAgICBpZiAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgJiYgdGhpcy5kYXRhLl9oYXNoZWRfcGFzc3dvcmQgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kgJiYgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5KSB7XG4gICAgICBkZWZlciA9IHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywge29iamVjdElkOiB0aGlzLm9iamVjdElkKCl9LCB7a2V5czogW1wiX3Bhc3N3b3JkX2hpc3RvcnlcIiwgXCJfaGFzaGVkX3Bhc3N3b3JkXCJdfSkudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoICE9IDEpIHtcbiAgICAgICAgICB0aHJvdyB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdXNlciA9IHJlc3VsdHNbMF07XG4gICAgICAgIGxldCBvbGRQYXNzd29yZHMgPSBbXTtcbiAgICAgICAgaWYgKHVzZXIuX3Bhc3N3b3JkX2hpc3RvcnkpIHtcbiAgICAgICAgICBvbGRQYXNzd29yZHMgPSBfLnRha2UodXNlci5fcGFzc3dvcmRfaGlzdG9yeSwgdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5KTtcbiAgICAgICAgfVxuICAgICAgICAvL24tMSBwYXNzd29yZHMgZ28gaW50byBoaXN0b3J5IGluY2x1ZGluZyBsYXN0IHBhc3N3b3JkXG4gICAgICAgIHdoaWxlIChvbGRQYXNzd29yZHMubGVuZ3RoID4gdGhpcy5jb25maWcucGFzc3dvcmRQb2xpY3kubWF4UGFzc3dvcmRIaXN0b3J5IC0gMikge1xuICAgICAgICAgIG9sZFBhc3N3b3Jkcy5zaGlmdCgpO1xuICAgICAgICB9XG4gICAgICAgIG9sZFBhc3N3b3Jkcy5wdXNoKHVzZXIucGFzc3dvcmQpO1xuICAgICAgICB0aGlzLmRhdGEuX3Bhc3N3b3JkX2hpc3RvcnkgPSBvbGRQYXNzd29yZHM7XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZGVmZXIudGhlbigoKSA9PiB7XG4gICAgICAvLyBSdW4gYW4gdXBkYXRlXG4gICAgICByZXR1cm4gdGhpcy5jb25maWcuZGF0YWJhc2UudXBkYXRlKHRoaXMuY2xhc3NOYW1lLCB0aGlzLnF1ZXJ5LCB0aGlzLmRhdGEsIHRoaXMucnVuT3B0aW9ucylcbiAgICAgICAgLnRoZW4ocmVzcG9uc2UgPT4ge1xuICAgICAgICAgIHJlc3BvbnNlLnVwZGF0ZWRBdCA9IHRoaXMudXBkYXRlZEF0O1xuICAgICAgICAgIHRoaXMuX3VwZGF0ZVJlc3BvbnNlV2l0aERhdGEocmVzcG9uc2UsIHRoaXMuZGF0YSk7XG4gICAgICAgICAgdGhpcy5yZXNwb25zZSA9IHsgcmVzcG9uc2UgfTtcbiAgICAgICAgfSk7XG4gICAgfSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gU2V0IHRoZSBkZWZhdWx0IEFDTCBhbmQgcGFzc3dvcmQgdGltZXN0YW1wIGZvciB0aGUgbmV3IF9Vc2VyXG4gICAgaWYgKHRoaXMuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgICB2YXIgQUNMID0gdGhpcy5kYXRhLkFDTDtcbiAgICAgIC8vIGRlZmF1bHQgcHVibGljIHIvdyBBQ0xcbiAgICAgIGlmICghQUNMKSB7XG4gICAgICAgIEFDTCA9IHt9O1xuICAgICAgICBBQ0xbJyonXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IGZhbHNlIH07XG4gICAgICB9XG4gICAgICAvLyBtYWtlIHN1cmUgdGhlIHVzZXIgaXMgbm90IGxvY2tlZCBkb3duXG4gICAgICBBQ0xbdGhpcy5kYXRhLm9iamVjdElkXSA9IHsgcmVhZDogdHJ1ZSwgd3JpdGU6IHRydWUgfTtcbiAgICAgIHRoaXMuZGF0YS5BQ0wgPSBBQ0w7XG4gICAgICAvLyBwYXNzd29yZCB0aW1lc3RhbXAgdG8gYmUgdXNlZCB3aGVuIHBhc3N3b3JkIGV4cGlyeSBwb2xpY3kgaXMgZW5mb3JjZWRcbiAgICAgIGlmICh0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeSAmJiB0aGlzLmNvbmZpZy5wYXNzd29yZFBvbGljeS5tYXhQYXNzd29yZEFnZSkge1xuICAgICAgICB0aGlzLmRhdGEuX3Bhc3N3b3JkX2NoYW5nZWRfYXQgPSBQYXJzZS5fZW5jb2RlKG5ldyBEYXRlKCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFJ1biBhIGNyZWF0ZVxuICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5jcmVhdGUodGhpcy5jbGFzc05hbWUsIHRoaXMuZGF0YSwgdGhpcy5ydW5PcHRpb25zKVxuICAgICAgLmNhdGNoKGVycm9yID0+IHtcbiAgICAgICAgaWYgKHRoaXMuY2xhc3NOYW1lICE9PSAnX1VzZXInIHx8IGVycm9yLmNvZGUgIT09IFBhcnNlLkVycm9yLkRVUExJQ0FURV9WQUxVRSkge1xuICAgICAgICAgIHRocm93IGVycm9yO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gUXVpY2sgY2hlY2ssIGlmIHdlIHdlcmUgYWJsZSB0byBpbmZlciB0aGUgZHVwbGljYXRlZCBmaWVsZCBuYW1lXG4gICAgICAgIGlmIChlcnJvciAmJiBlcnJvci51c2VySW5mbyAmJiBlcnJvci51c2VySW5mby5kdXBsaWNhdGVkX2ZpZWxkID09PSAndXNlcm5hbWUnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLCAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyB1c2VybmFtZS4nKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChlcnJvciAmJiBlcnJvci51c2VySW5mbyAmJiBlcnJvci51c2VySW5mby5kdXBsaWNhdGVkX2ZpZWxkID09PSAnZW1haWwnKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLkVNQUlMX1RBS0VOLCAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyBlbWFpbCBhZGRyZXNzLicpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSWYgdGhpcyB3YXMgYSBmYWlsZWQgdXNlciBjcmVhdGlvbiBkdWUgdG8gdXNlcm5hbWUgb3IgZW1haWwgYWxyZWFkeSB0YWtlbiwgd2UgbmVlZCB0b1xuICAgICAgICAvLyBjaGVjayB3aGV0aGVyIGl0IHdhcyB1c2VybmFtZSBvciBlbWFpbCBhbmQgcmV0dXJuIHRoZSBhcHByb3ByaWF0ZSBlcnJvci5cbiAgICAgICAgLy8gRmFsbGJhY2sgdG8gdGhlIG9yaWdpbmFsIG1ldGhvZFxuICAgICAgICAvLyBUT0RPOiBTZWUgaWYgd2UgY2FuIGxhdGVyIGRvIHRoaXMgd2l0aG91dCBhZGRpdGlvbmFsIHF1ZXJpZXMgYnkgdXNpbmcgbmFtZWQgaW5kZXhlcy5cbiAgICAgICAgcmV0dXJuIHRoaXMuY29uZmlnLmRhdGFiYXNlLmZpbmQoXG4gICAgICAgICAgdGhpcy5jbGFzc05hbWUsXG4gICAgICAgICAgeyB1c2VybmFtZTogdGhpcy5kYXRhLnVzZXJuYW1lLCBvYmplY3RJZDogeyckbmUnOiB0aGlzLm9iamVjdElkKCl9IH0sXG4gICAgICAgICAgeyBsaW1pdDogMSB9XG4gICAgICAgIClcbiAgICAgICAgICAudGhlbihyZXN1bHRzID0+IHtcbiAgICAgICAgICAgIGlmIChyZXN1bHRzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgdGhyb3cgbmV3IFBhcnNlLkVycm9yKFBhcnNlLkVycm9yLlVTRVJOQU1FX1RBS0VOLCAnQWNjb3VudCBhbHJlYWR5IGV4aXN0cyBmb3IgdGhpcyB1c2VybmFtZS4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB0aGlzLmNvbmZpZy5kYXRhYmFzZS5maW5kKFxuICAgICAgICAgICAgICB0aGlzLmNsYXNzTmFtZSxcbiAgICAgICAgICAgICAgeyBlbWFpbDogdGhpcy5kYXRhLmVtYWlsLCBvYmplY3RJZDogeyckbmUnOiB0aGlzLm9iamVjdElkKCl9IH0sXG4gICAgICAgICAgICAgIHsgbGltaXQ6IDEgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICB9KVxuICAgICAgICAgIC50aGVuKHJlc3VsdHMgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc3VsdHMubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRU1BSUxfVEFLRU4sICdBY2NvdW50IGFscmVhZHkgZXhpc3RzIGZvciB0aGlzIGVtYWlsIGFkZHJlc3MuJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuRFVQTElDQVRFX1ZBTFVFLCAnQSBkdXBsaWNhdGUgdmFsdWUgZm9yIGEgZmllbGQgd2l0aCB1bmlxdWUgdmFsdWVzIHdhcyBwcm92aWRlZCcpO1xuICAgICAgICAgIH0pO1xuICAgICAgfSlcbiAgICAgIC50aGVuKHJlc3BvbnNlID0+IHtcbiAgICAgICAgcmVzcG9uc2Uub2JqZWN0SWQgPSB0aGlzLmRhdGEub2JqZWN0SWQ7XG4gICAgICAgIHJlc3BvbnNlLmNyZWF0ZWRBdCA9IHRoaXMuZGF0YS5jcmVhdGVkQXQ7XG5cbiAgICAgICAgaWYgKHRoaXMucmVzcG9uc2VTaG91bGRIYXZlVXNlcm5hbWUpIHtcbiAgICAgICAgICByZXNwb25zZS51c2VybmFtZSA9IHRoaXMuZGF0YS51c2VybmFtZTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl91cGRhdGVSZXNwb25zZVdpdGhEYXRhKHJlc3BvbnNlLCB0aGlzLmRhdGEpO1xuICAgICAgICB0aGlzLnJlc3BvbnNlID0ge1xuICAgICAgICAgIHN0YXR1czogMjAxLFxuICAgICAgICAgIHJlc3BvbnNlLFxuICAgICAgICAgIGxvY2F0aW9uOiB0aGlzLmxvY2F0aW9uKClcbiAgICAgICAgfTtcbiAgICAgIH0pO1xuICB9XG59O1xuXG4vLyBSZXR1cm5zIG5vdGhpbmcgLSBkb2Vzbid0IHdhaXQgZm9yIHRoZSB0cmlnZ2VyLlxuUmVzdFdyaXRlLnByb3RvdHlwZS5ydW5BZnRlclRyaWdnZXIgPSBmdW5jdGlvbigpIHtcbiAgaWYgKCF0aGlzLnJlc3BvbnNlIHx8ICF0aGlzLnJlc3BvbnNlLnJlc3BvbnNlKSB7XG4gICAgcmV0dXJuO1xuICB9XG5cbiAgLy8gQXZvaWQgZG9pbmcgYW55IHNldHVwIGZvciB0cmlnZ2VycyBpZiB0aGVyZSBpcyBubyAnYWZ0ZXJTYXZlJyB0cmlnZ2VyIGZvciB0aGlzIGNsYXNzLlxuICBjb25zdCBoYXNBZnRlclNhdmVIb29rID0gdHJpZ2dlcnMudHJpZ2dlckV4aXN0cyh0aGlzLmNsYXNzTmFtZSwgdHJpZ2dlcnMuVHlwZXMuYWZ0ZXJTYXZlLCB0aGlzLmNvbmZpZy5hcHBsaWNhdGlvbklkKTtcbiAgY29uc3QgaGFzTGl2ZVF1ZXJ5ID0gdGhpcy5jb25maWcubGl2ZVF1ZXJ5Q29udHJvbGxlci5oYXNMaXZlUXVlcnkodGhpcy5jbGFzc05hbWUpO1xuICBpZiAoIWhhc0FmdGVyU2F2ZUhvb2sgJiYgIWhhc0xpdmVRdWVyeSkge1xuICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgfVxuXG4gIHZhciBleHRyYURhdGEgPSB7Y2xhc3NOYW1lOiB0aGlzLmNsYXNzTmFtZX07XG4gIGlmICh0aGlzLnF1ZXJ5ICYmIHRoaXMucXVlcnkub2JqZWN0SWQpIHtcbiAgICBleHRyYURhdGEub2JqZWN0SWQgPSB0aGlzLnF1ZXJ5Lm9iamVjdElkO1xuICB9XG5cbiAgLy8gQnVpbGQgdGhlIG9yaWdpbmFsIG9iamVjdCwgd2Ugb25seSBkbyB0aGlzIGZvciBhIHVwZGF0ZSB3cml0ZS5cbiAgbGV0IG9yaWdpbmFsT2JqZWN0O1xuICBpZiAodGhpcy5xdWVyeSAmJiB0aGlzLnF1ZXJ5Lm9iamVjdElkKSB7XG4gICAgb3JpZ2luYWxPYmplY3QgPSB0cmlnZ2Vycy5pbmZsYXRlKGV4dHJhRGF0YSwgdGhpcy5vcmlnaW5hbERhdGEpO1xuICB9XG5cbiAgLy8gQnVpbGQgdGhlIGluZmxhdGVkIG9iamVjdCwgZGlmZmVyZW50IGZyb20gYmVmb3JlU2F2ZSwgb3JpZ2luYWxEYXRhIGlzIG5vdCBlbXB0eVxuICAvLyBzaW5jZSBkZXZlbG9wZXJzIGNhbiBjaGFuZ2UgZGF0YSBpbiB0aGUgYmVmb3JlU2F2ZS5cbiAgY29uc3QgdXBkYXRlZE9iamVjdCA9IHRoaXMuYnVpbGRVcGRhdGVkT2JqZWN0KGV4dHJhRGF0YSk7XG4gIHVwZGF0ZWRPYmplY3QuX2hhbmRsZVNhdmVSZXNwb25zZSh0aGlzLnJlc3BvbnNlLnJlc3BvbnNlLCB0aGlzLnJlc3BvbnNlLnN0YXR1cyB8fCAyMDApO1xuXG4gIC8vIE5vdGlmaXkgTGl2ZVF1ZXJ5U2VydmVyIGlmIHBvc3NpYmxlXG4gIHRoaXMuY29uZmlnLmxpdmVRdWVyeUNvbnRyb2xsZXIub25BZnRlclNhdmUodXBkYXRlZE9iamVjdC5jbGFzc05hbWUsIHVwZGF0ZWRPYmplY3QsIG9yaWdpbmFsT2JqZWN0KTtcblxuICAvLyBSdW4gYWZ0ZXJTYXZlIHRyaWdnZXJcbiAgcmV0dXJuIHRyaWdnZXJzLm1heWJlUnVuVHJpZ2dlcih0cmlnZ2Vycy5UeXBlcy5hZnRlclNhdmUsIHRoaXMuYXV0aCwgdXBkYXRlZE9iamVjdCwgb3JpZ2luYWxPYmplY3QsIHRoaXMuY29uZmlnKVxuICAgIC5jYXRjaChmdW5jdGlvbihlcnIpIHtcbiAgICAgIGxvZ2dlci53YXJuKCdhZnRlclNhdmUgY2F1Z2h0IGFuIGVycm9yJywgZXJyKTtcbiAgICB9KVxufTtcblxuLy8gQSBoZWxwZXIgdG8gZmlndXJlIG91dCB3aGF0IGxvY2F0aW9uIHRoaXMgb3BlcmF0aW9uIGhhcHBlbnMgYXQuXG5SZXN0V3JpdGUucHJvdG90eXBlLmxvY2F0aW9uID0gZnVuY3Rpb24oKSB7XG4gIHZhciBtaWRkbGUgPSAodGhpcy5jbGFzc05hbWUgPT09ICdfVXNlcicgPyAnL3VzZXJzLycgOlxuICAgICcvY2xhc3Nlcy8nICsgdGhpcy5jbGFzc05hbWUgKyAnLycpO1xuICByZXR1cm4gdGhpcy5jb25maWcubW91bnQgKyBtaWRkbGUgKyB0aGlzLmRhdGEub2JqZWN0SWQ7XG59O1xuXG4vLyBBIGhlbHBlciB0byBnZXQgdGhlIG9iamVjdCBpZCBmb3IgdGhpcyBvcGVyYXRpb24uXG4vLyBCZWNhdXNlIGl0IGNvdWxkIGJlIGVpdGhlciBvbiB0aGUgcXVlcnkgb3Igb24gdGhlIGRhdGFcblJlc3RXcml0ZS5wcm90b3R5cGUub2JqZWN0SWQgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIHRoaXMuZGF0YS5vYmplY3RJZCB8fCB0aGlzLnF1ZXJ5Lm9iamVjdElkO1xufTtcblxuLy8gUmV0dXJucyBhIGNvcHkgb2YgdGhlIGRhdGEgYW5kIGRlbGV0ZSBiYWQga2V5cyAoX2F1dGhfZGF0YSwgX2hhc2hlZF9wYXNzd29yZC4uLilcblJlc3RXcml0ZS5wcm90b3R5cGUuc2FuaXRpemVkRGF0YSA9IGZ1bmN0aW9uKCkge1xuICBjb25zdCBkYXRhID0gT2JqZWN0LmtleXModGhpcy5kYXRhKS5yZWR1Y2UoKGRhdGEsIGtleSkgPT4ge1xuICAgIC8vIFJlZ2V4cCBjb21lcyBmcm9tIFBhcnNlLk9iamVjdC5wcm90b3R5cGUudmFsaWRhdGVcbiAgICBpZiAoISgvXltBLVphLXpdWzAtOUEtWmEtel9dKiQvKS50ZXN0KGtleSkpIHtcbiAgICAgIGRlbGV0ZSBkYXRhW2tleV07XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9LCBkZWVwY29weSh0aGlzLmRhdGEpKTtcbiAgcmV0dXJuIFBhcnNlLl9kZWNvZGUodW5kZWZpbmVkLCBkYXRhKTtcbn1cblxuLy8gUmV0dXJucyBhbiB1cGRhdGVkIGNvcHkgb2YgdGhlIG9iamVjdFxuUmVzdFdyaXRlLnByb3RvdHlwZS5idWlsZFVwZGF0ZWRPYmplY3QgPSBmdW5jdGlvbiAoZXh0cmFEYXRhKSB7XG4gIGNvbnN0IHVwZGF0ZWRPYmplY3QgPSB0cmlnZ2Vycy5pbmZsYXRlKGV4dHJhRGF0YSwgdGhpcy5vcmlnaW5hbERhdGEpO1xuICBPYmplY3Qua2V5cyh0aGlzLmRhdGEpLnJlZHVjZShmdW5jdGlvbiAoZGF0YSwga2V5KSB7XG4gICAgaWYgKGtleS5pbmRleE9mKFwiLlwiKSA+IDApIHtcbiAgICAgIC8vIHN1YmRvY3VtZW50IGtleSB3aXRoIGRvdCBub3RhdGlvbiAoJ3gueSc6diA9PiAneCc6eyd5Jzp2fSlcbiAgICAgIGNvbnN0IHNwbGl0dGVkS2V5ID0ga2V5LnNwbGl0KFwiLlwiKTtcbiAgICAgIGNvbnN0IHBhcmVudFByb3AgPSBzcGxpdHRlZEtleVswXTtcbiAgICAgIGxldCBwYXJlbnRWYWwgPSB1cGRhdGVkT2JqZWN0LmdldChwYXJlbnRQcm9wKTtcbiAgICAgIGlmKHR5cGVvZiBwYXJlbnRWYWwgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHBhcmVudFZhbCA9IHt9O1xuICAgICAgfVxuICAgICAgcGFyZW50VmFsW3NwbGl0dGVkS2V5WzFdXSA9IGRhdGFba2V5XTtcbiAgICAgIHVwZGF0ZWRPYmplY3Quc2V0KHBhcmVudFByb3AsIHBhcmVudFZhbCk7XG4gICAgICBkZWxldGUgZGF0YVtrZXldO1xuICAgIH1cbiAgICByZXR1cm4gZGF0YTtcbiAgfSwgZGVlcGNvcHkodGhpcy5kYXRhKSk7XG5cbiAgdXBkYXRlZE9iamVjdC5zZXQodGhpcy5zYW5pdGl6ZWREYXRhKCkpO1xuICByZXR1cm4gdXBkYXRlZE9iamVjdDtcbn07XG5cblJlc3RXcml0ZS5wcm90b3R5cGUuY2xlYW5Vc2VyQXV0aERhdGEgPSBmdW5jdGlvbigpIHtcbiAgaWYgKHRoaXMucmVzcG9uc2UgJiYgdGhpcy5yZXNwb25zZS5yZXNwb25zZSAmJiB0aGlzLmNsYXNzTmFtZSA9PT0gJ19Vc2VyJykge1xuICAgIGNvbnN0IHVzZXIgPSB0aGlzLnJlc3BvbnNlLnJlc3BvbnNlO1xuICAgIGlmICh1c2VyLmF1dGhEYXRhKSB7XG4gICAgICBPYmplY3Qua2V5cyh1c2VyLmF1dGhEYXRhKS5mb3JFYWNoKChwcm92aWRlcikgPT4ge1xuICAgICAgICBpZiAodXNlci5hdXRoRGF0YVtwcm92aWRlcl0gPT09IG51bGwpIHtcbiAgICAgICAgICBkZWxldGUgdXNlci5hdXRoRGF0YVtwcm92aWRlcl07XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgaWYgKE9iamVjdC5rZXlzKHVzZXIuYXV0aERhdGEpLmxlbmd0aCA9PSAwKSB7XG4gICAgICAgIGRlbGV0ZSB1c2VyLmF1dGhEYXRhO1xuICAgICAgfVxuICAgIH1cbiAgfVxufTtcblxuUmVzdFdyaXRlLnByb3RvdHlwZS5fdXBkYXRlUmVzcG9uc2VXaXRoRGF0YSA9IGZ1bmN0aW9uKHJlc3BvbnNlLCBkYXRhKSB7XG4gIGlmIChfLmlzRW1wdHkodGhpcy5zdG9yYWdlLmZpZWxkc0NoYW5nZWRCeVRyaWdnZXIpKSB7XG4gICAgcmV0dXJuIHJlc3BvbnNlO1xuICB9XG4gIGNvbnN0IGNsaWVudFN1cHBvcnRzRGVsZXRlID0gQ2xpZW50U0RLLnN1cHBvcnRzRm9yd2FyZERlbGV0ZSh0aGlzLmNsaWVudFNESyk7XG4gIHRoaXMuc3RvcmFnZS5maWVsZHNDaGFuZ2VkQnlUcmlnZ2VyLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICBjb25zdCBkYXRhVmFsdWUgPSBkYXRhW2ZpZWxkTmFtZV07XG5cbiAgICBpZighcmVzcG9uc2UuaGFzT3duUHJvcGVydHkoZmllbGROYW1lKSkge1xuICAgICAgcmVzcG9uc2VbZmllbGROYW1lXSA9IGRhdGFWYWx1ZTtcbiAgICB9XG5cbiAgICAvLyBTdHJpcHMgb3BlcmF0aW9ucyBmcm9tIHJlc3BvbnNlc1xuICAgIGlmIChyZXNwb25zZVtmaWVsZE5hbWVdICYmIHJlc3BvbnNlW2ZpZWxkTmFtZV0uX19vcCkge1xuICAgICAgZGVsZXRlIHJlc3BvbnNlW2ZpZWxkTmFtZV07XG4gICAgICBpZiAoY2xpZW50U3VwcG9ydHNEZWxldGUgJiYgZGF0YVZhbHVlLl9fb3AgPT0gJ0RlbGV0ZScpIHtcbiAgICAgICAgcmVzcG9uc2VbZmllbGROYW1lXSA9IGRhdGFWYWx1ZTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuICByZXR1cm4gcmVzcG9uc2U7XG59XG5cbmV4cG9ydCBkZWZhdWx0IFJlc3RXcml0ZTtcbm1vZHVsZS5leHBvcnRzID0gUmVzdFdyaXRlO1xuIl19