'use strict';

var _MongoStorageAdapter = require('./Adapters/Storage/Mongo/MongoStorageAdapter');

var _MongoStorageAdapter2 = _interopRequireDefault(_MongoStorageAdapter);

var _PostgresStorageAdapter = require('./Adapters/Storage/Postgres/PostgresStorageAdapter');

var _PostgresStorageAdapter2 = _interopRequireDefault(_PostgresStorageAdapter);

var _lodash = require('lodash');

var _lodash2 = _interopRequireDefault(_lodash);

var _SchemaCache = require('./Controllers/SchemaCache');

var _SchemaCache2 = _interopRequireDefault(_SchemaCache);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

var SchemaController = require('../src/Controllers/SchemaController');

let mongo = new _MongoStorageAdapter2.default({
    uri: "mongodb://wfadmin:TKGPBjFMHxCjn3x@ds063066-a0.mlab.com:63066,ds063066-a1.mlab.com:63066/wildfire?replicaSet=rs-ds063066"
});

let postgres = new _PostgresStorageAdapter2.default({
    uri: "postgres://wildfire:5V2kDTQ9PBDTXXB9Vkp7@wildfire-aurora-pg-cluster.cluster-cscdbepfqvif.us-east-1.rds.amazonaws.com/wildfire"
});

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

async function createPostgresClassesAndSchema(postgresSchemas) {
    for (let schema of postgresSchemas) {
        let newClass = await postgres.createClass(schema.className, schema);
    }
}

async function copyObjectsToPostgres(postgresSchemas) {
    for (let schema of postgresSchemas) {
        console.log("Copying for ", schema.className);
        // TOCHECK: do you need postgres or mongo schema here?
        let results = await mongo.find(schema.className, schema, {}, {});

        for (let object of results) {
            Object.keys(object).forEach(fieldName => {
                if (schema.fields[fieldName] && schema.fields[fieldName].type == "Date" && typeof object[fieldName] == "string") {
                    object[fieldName] = { 'iso': object[fieldName], '__type': 'Date' };
                }
            });

            if (schema.className == "_Installation") {
                delete object.GCMSenderId;
                delete object._tombstone;
            }

            await postgres.createObject(schema.className, schema, object);
        }
    }
}

async function generatePostgresSchemas() {
    let schemaCollection = await mongo._schemaCollection();
    let mongoSchemas = await schemaCollection._fetchAllSchemasFrom_SCHEMA();

    let postgresSchemas = [];

    for (let schema of mongoSchemas) {
        let pgSchema = toPostgresSchema(schema);
        delete pgSchema.fields.ACL;

        if (schema.className == "_Session") {
            pgSchema.fields.sessionToken = { type: 'String' };
        }

        if (schema.className == "_User") {
            pgSchema.fields.authData = { type: 'Object' };
            pgSchema.fields.sessionToken = { type: 'String' };
        }

        // console.log(schema, pgSchema);
        // console.log("============================================");
        postgresSchemas.push(pgSchema);
    }
    return postgresSchemas;
}

async function main() {
    await postgres.deleteAllClasses();
    await postgres._ensureSchemaCollectionExists();
    let postgresSchemas = await generatePostgresSchemas();

    await createPostgresClassesAndSchema(postgresSchemas);
    await copyObjectsToPostgres(postgresSchemas);
}

main().then(function (success) {
    console.log("success");
}, function (error) {
    console.log(error);
});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9taWdyYXRlTW9uZ29Ub1Bvc3RncmVzLmpzIl0sIm5hbWVzIjpbIlNjaGVtYUNvbnRyb2xsZXIiLCJyZXF1aXJlIiwibW9uZ28iLCJ1cmkiLCJwb3N0Z3JlcyIsInRvUG9zdGdyZXNTY2hlbWEiLCJzY2hlbWEiLCJmaWVsZHMiLCJfd3Blcm0iLCJ0eXBlIiwiY29udGVudHMiLCJfcnBlcm0iLCJjbGFzc05hbWUiLCJfaGFzaGVkX3Bhc3N3b3JkIiwiX3Bhc3N3b3JkX2hpc3RvcnkiLCJjcmVhdGVQb3N0Z3Jlc0NsYXNzZXNBbmRTY2hlbWEiLCJwb3N0Z3Jlc1NjaGVtYXMiLCJuZXdDbGFzcyIsImNyZWF0ZUNsYXNzIiwiY29weU9iamVjdHNUb1Bvc3RncmVzIiwiY29uc29sZSIsImxvZyIsInJlc3VsdHMiLCJmaW5kIiwib2JqZWN0IiwiT2JqZWN0Iiwia2V5cyIsImZvckVhY2giLCJmaWVsZE5hbWUiLCJHQ01TZW5kZXJJZCIsIl90b21ic3RvbmUiLCJjcmVhdGVPYmplY3QiLCJnZW5lcmF0ZVBvc3RncmVzU2NoZW1hcyIsInNjaGVtYUNvbGxlY3Rpb24iLCJfc2NoZW1hQ29sbGVjdGlvbiIsIm1vbmdvU2NoZW1hcyIsIl9mZXRjaEFsbFNjaGVtYXNGcm9tX1NDSEVNQSIsInBnU2NoZW1hIiwiQUNMIiwic2Vzc2lvblRva2VuIiwiYXV0aERhdGEiLCJwdXNoIiwibWFpbiIsImRlbGV0ZUFsbENsYXNzZXMiLCJfZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cyIsInRoZW4iLCJzdWNjZXNzIiwiZXJyb3IiXSwibWFwcGluZ3MiOiI7O0FBQUE7Ozs7QUFDQTs7OztBQUNBOzs7O0FBQ0E7Ozs7OztBQUVBLElBQUlBLG1CQUFtQkMsUUFBUSxxQ0FBUixDQUF2Qjs7QUFFQSxJQUFJQyxRQUFRLGtDQUF3QjtBQUM5QkMsU0FBSztBQUR5QixDQUF4QixDQUFaOztBQUlBLElBQUlDLFdBQVcscUNBQTJCO0FBQ3BDRCxTQUFLO0FBRCtCLENBQTNCLENB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QUFpQztBQUM3QnlCLHFCQUFTOUIsTUFBVCxDQUFnQmlDLFFBQWhCLEdBQTJCLEVBQUMvQixNQUFNLFFBQVAsRUFBM0I7QUFDQTRCLHFCQUFTOUIsTUFBVCxDQUFnQmdDLFlBQWhCLEdBQStCLEVBQUM5QixNQUFNLFFBQVAsRUFBL0I7QUFFSDs7QUFFRDtBQUNBO0FBQ0FPLHdCQUFnQnlCLElBQWhCLENBQXFCSixRQUFyQjtBQUNIO0FBQ0QsV0FBT3JCLGVBQVA7QUFDSDs7QUFFRCxlQUFlMEIsSUFBZixHQUFzQjtBQUNsQixVQUFNdEMsU0FBU3VDLGdCQUFULEVBQU47QUFDQSxVQUFNdkMsU0FBU3dDLDZCQUFULEVBQU47QUFDQSxRQUFJNUIsa0JBQWtCLE1BQU1nQix5QkFBNUI7O0FBRUEsVUFBTWpCLCtCQUErQkMsZUFBL0IsQ0FBTjtBQUNBLFVBQU1HLHNCQUFzQkgsZUFBdEIsQ0FBTjtBQUNIOztBQUdEMEIsT0FBT0csSUFBUCxDQUFZLFVBQVNDLE9BQVQsRUFBa0I7QUFDMUIxQixZQUFRQyxHQUFSLENBQVksU0FBWjtBQUNILENBRkQsRUFFRyxVQUFTMEIsS0FBVCxFQUFnQjtBQUNmM0IsWUFBUUMsR0FBUixDQUFZMEIsS0FBWjtBQUNILENBSkQiLCJmaWxlIjoibWlncmF0ZU1vbmdvVG9Qb3N0Z3Jlcy5qcyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCBNb25nb1N0b3JhZ2VBZGFwdGVyIGZyb20gJy4vQWRhcHRlcnMvU3RvcmFnZS9Nb25nby9Nb25nb1N0b3JhZ2VBZGFwdGVyJztcbmltcG9ydCBQb3N0Z3Jlc1N0b3JhZ2VBZGFwdGVyIGZyb20gJy4vQWRhcHRlcnMvU3RvcmFnZS9Qb3N0Z3Jlcy9Qb3N0Z3Jlc1N0b3JhZ2VBZGFwdGVyJztcbmltcG9ydCBfIGZyb20gJ2xvZGFzaCc7XG5pbXBvcnQgU2NoZW1hQ2FjaGUgZnJvbSAnLi9Db250cm9sbGVycy9TY2hlbWFDYWNoZSc7XG5cbnZhciBTY2hlbWFDb250cm9sbGVyID0gcmVxdWlyZSgnLi4vc3JjL0NvbnRyb2xsZXJzL1NjaGVtYUNvbnRyb2xsZXInKTtcblxubGV0IG1vbmdvID0gbmV3IE1vbmdvU3RvcmFnZUFkYXB0ZXIoe1xuICAgICAgdXJpOiBcIm1vbmdvZGI6Ly93ZmFkbWluOlRLR1BCakZNSHhDam4zeEBkczA2MzA2Ni1hMC5tbGFiLmNvbTo2MzA2NixkczA2MzA2Ni1hMS5tbGFiLmNvbTo2MzA2Ni93aWxkZmlyZT9yZXBsaWNhU2V0PXJzLWRzMDYzMDY2XCJcbn0pO1xuXG5sZXQgcG9zdGdyZXMgPSBuZXcgUG9zdGdyZXNTdG9yYWdlQWRhcHRlcih7XG4gICAgICB1cmk6IFwicG9zdGdyZXM6Ly93aWxkZmlyZTo1VjJrRFRROVBCRFRYWEI5VmtwN0B3aWxkZmlyZS1hdXJvcmEtcGctY2x1c3Rlci5jbHVzdGVyLWNzY2RiZXBmcXZpZi51cy1lYXN0LTEucmRzLmFtYXpvbmF3cy5jb20vd2lsZGZpcmVcIlxufSk7XG5cblxuY29uc3QgdG9Qb3N0Z3Jlc1NjaGVtYSA9IChzY2hlbWEpID0+IHtcbiAgaWYgKCFzY2hlbWEpIHtcbiAgICByZXR1cm4gc2NoZW1hO1xuICB9XG4gIHNjaGVtYS5maWVsZHMgPSBzY2hlbWEuZmllbGRzIHx8IHt9O1xuICBzY2hlbWEuZmllbGRzLl93cGVybSA9IHt0eXBlOiAnQXJyYXknLCBjb250ZW50czoge3R5cGU6ICdTdHJpbmcnfX1cbiAgc2NoZW1hLmZpZWxkcy5fcnBlcm0gPSB7dHlwZTogJ0FycmF5JywgY29udGVudHM6IHt0eXBlOiAnU3RyaW5nJ319XG4gIGlmIChzY2hlbWEuY2xhc3NOYW1lID09PSAnX1VzZXInKSB7XG4gICAgc2NoZW1hLmZpZWxkcy5faGFzaGVkX3Bhc3N3b3JkID0ge3R5cGU6ICdTdHJpbmcnfTtcbiAgICBzY2hlbWEuZmllbGRzLl9wYXNzd29yZF9oaXN0b3J5ID0ge3R5cGU6ICdBcnJheSd9O1xuICB9XG4gIHJldHVybiBzY2hlbWE7XG59XG5cblxuYXN5bmMgZnVuY3Rpb24gY3JlYXRlUG9zdGdyZXNDbGFzc2VzQW5kU2NoZW1hKHBvc3RncmVzU2NoZW1hcykge1xuICAgIGZvciAobGV0IHNjaGVtYSBvZiBwb3N0Z3Jlc1NjaGVtYXMpIHtcbiAgICAgICAgbGV0IG5ld0NsYXNzID0gYXdhaXQgcG9zdGdyZXMuY3JlYXRlQ2xhc3Moc2NoZW1hLmNsYXNzTmFtZSwgc2NoZW1hKTtcbiAgICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGNvcHlPYmplY3RzVG9Qb3N0Z3Jlcyhwb3N0Z3Jlc1NjaGVtYXMpIHtcbiAgICBmb3IgKGxldCBzY2hlbWEgb2YgcG9zdGdyZXNTY2hlbWFzKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiQ29weWluZyBmb3IgXCIsIHNjaGVtYS5jbGFzc05hbWUpXG4gICAgICAgIC8vIFRPQ0hFQ0s6IGRvIHlvdSBuZWVkIHBvc3RncmVzIG9yIG1vbmdvIHNjaGVtYSBoZXJlP1xuICAgICAgICBsZXQgcmVzdWx0cyA9IGF3YWl0IG1vbmdvLmZpbmQoc2NoZW1hLmNsYXNzTmFtZSwgc2NoZW1hLCB7fSwge30pO1xuXG4gICAgICAgIGZvciAobGV0IG9iamVjdCBvZiByZXN1bHRzKSB7XG4gICAgICAgICAgICBPYmplY3Qua2V5cyhvYmplY3QpLmZvckVhY2goZmllbGROYW1lID0+IHtcbiAgICAgICAgICAgICAgICBpZiAoc2NoZW1hLmZpZWxkc1tmaWVsZE5hbWVdICYmIHNjaGVtYS5maWVsZHNbZmllbGROYW1lXS50eXBlID09IFwiRGF0ZVwiICYmIHR5cGVvZihvYmplY3RbZmllbGROYW1lXSkgPT0gXCJzdHJpbmdcIikge1xuICAgICAgICAgICAgICAgICAgICBvYmplY3RbZmllbGROYW1lXSA9IHsnaXNvJzogb2JqZWN0W2ZpZWxkTmFtZV0sICdfX3R5cGUnOiAnRGF0ZSd9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIGlmIChzY2hlbWEuY2xhc3NOYW1lID09IFwiX0luc3RhbGxhdGlvblwiKSB7XG4gICAgICAgICAgICAgICAgZGVsZXRlIG9iamVjdC5HQ01TZW5kZXJJZDtcbiAgICAgICAgICAgICAgICBkZWxldGUgb2JqZWN0Ll90b21ic3RvbmU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGF3YWl0IHBvc3RncmVzLmNyZWF0ZU9iamVjdChzY2hlbWEuY2xhc3NOYW1lLCBzY2hlbWEsIG9iamVjdCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cblxuYXN5bmMgZnVuY3Rpb24gZ2VuZXJhdGVQb3N0Z3Jlc1NjaGVtYXMoKSB7XG4gICAgbGV0IHNjaGVtYUNvbGxlY3Rpb24gPSBhd2FpdCBtb25nby5fc2NoZW1hQ29sbGVjdGlvbigpO1xuICAgIGxldCBtb25nb1NjaGVtYXMgPSBhd2FpdCBzY2hlbWFDb2xsZWN0aW9uLl9mZXRjaEFsbFNjaGVtYXNGcm9tX1NDSEVNQSgpO1xuXG4gICAgbGV0IHBvc3RncmVzU2NoZW1hcyA9IFtdO1xuXG4gICAgZm9yIChsZXQgc2NoZW1hIG9mIG1vbmdvU2NoZW1hcykge1xuICAgICAgICBsZXQgcGdTY2hlbWEgPSB0b1Bvc3RncmVzU2NoZW1hKHNjaGVtYSk7XG4gICAgICAgIGRlbGV0ZSBwZ1NjaGVtYS5maWVsZHMuQUNMO1xuXG4gICAgICAgIGlmIChzY2hlbWEuY2xhc3NOYW1lID09IFwiX1Nlc3Npb25cIikge1xuICAgICAgICAgICAgcGdTY2hlbWEuZmllbGRzLnNlc3Npb25Ub2tlbiA9IHt0eXBlOiAnU3RyaW5nJ31cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChzY2hlbWEuY2xhc3NOYW1lID09IFwiX1VzZXJcIikge1xuICAgICAgICAgICAgcGdTY2hlbWEuZmllbGRzLmF1dGhEYXRhID0ge3R5cGU6ICdPYmplY3QnfVxuICAgICAgICAgICAgcGdTY2hlbWEuZmllbGRzLnNlc3Npb25Ub2tlbiA9IHt0eXBlOiAnU3RyaW5nJ31cblxuICAgICAgICB9XG5cbiAgICAgICAgLy8gY29uc29sZS5sb2coc2NoZW1hLCBwZ1NjaGVtYSk7XG4gICAgICAgIC8vIGNvbnNvbGUubG9nKFwiPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cIik7XG4gICAgICAgIHBvc3RncmVzU2NoZW1hcy5wdXNoKHBnU2NoZW1hKTtcbiAgICB9XG4gICAgcmV0dXJuIHBvc3RncmVzU2NoZW1hcztcbn1cblxuYXN5bmMgZnVuY3Rpb24gbWFpbigpIHtcbiAgICBhd2FpdCBwb3N0Z3Jlcy5kZWxldGVBbGxDbGFzc2VzKClcbiAgICBhd2FpdCBwb3N0Z3Jlcy5fZW5zdXJlU2NoZW1hQ29sbGVjdGlvbkV4aXN0cygpXG4gICAgbGV0IHBvc3RncmVzU2NoZW1hcyA9IGF3YWl0IGdlbmVyYXRlUG9zdGdyZXNTY2hlbWFzKCk7XG5cbiAgICBhd2FpdCBjcmVhdGVQb3N0Z3Jlc0NsYXNzZXNBbmRTY2hlbWEocG9zdGdyZXNTY2hlbWFzKTtcbiAgICBhd2FpdCBjb3B5T2JqZWN0c1RvUG9zdGdyZXMocG9zdGdyZXNTY2hlbWFzKTtcbn1cblxuXG5tYWluKCkudGhlbihmdW5jdGlvbihzdWNjZXNzKSB7XG4gICAgY29uc29sZS5sb2coXCJzdWNjZXNzXCIpXG59LCBmdW5jdGlvbihlcnJvcikge1xuICAgIGNvbnNvbGUubG9nKGVycm9yKTtcbn0pO1xuXG5cbiJdfQ==