"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

exports.default = function ({
  definitions,
  help,
  usage,
  start
}) {
  _commander2.default.loadDefinitions(definitions);
  if (usage) {
    _commander2.default.usage(usage);
  }
  if (help) {
    _commander2.default.on('--help', help);
  }
  _commander2.default.parse(process.argv, process.env);

  const options = _commander2.default.getOptions();
  start(_commander2.default, options, function () {
    logStartupOptions(options);
  });
};

var _commander = require("./commander");

var _commander2 = _interopRequireDefault(_commander);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function logStartupOptions(options) {
  for (const key in options) {
    let value = options[key];
    if (key == "masterKey") {
      value = "***REDACTED***";
    }
    if (typeof value === 'object') {
      try {
        value = JSON.stringify(value);
      } catch (e) {
        if (value && value.constructor && value.constructor.name) {
          value = value.constructor.name;
        }
      }
    }
    /* eslint-disable no-console */
    console.log(`${key}: ${value}`);
    /* eslint-enable no-console */
  }
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9jbGkvdXRpbHMvcnVubmVyLmpzIl0sIm5hbWVzIjpbImRlZmluaXRpb25zIiwiaGVscCIsInVzYWdlIiwic3RhcnQiLCJsb2FkRGVmaW5pdGlvbnMiLCJvbiIsInBhcnNlIiwicHJvY2VzcyIsImFyZ3YiLCJlbnYiLCJvcHRpb25zIiwiZ2V0T3B0aW9ucyIsImxvZ1N0YXJ0dXBPcHRpb25zIiwia2V5IiwidmFsdWUiLCJKU09OIiwic3RyaW5naWZ5IiwiZSIsImNvbnN0cnVjdG9yIiwibmFtZSIsImNvbnNvbGUiLCJsb2ciXSwibWFwcGluZ3MiOiI7Ozs7OztrQkF3QmUsVUFBUztBQUN0QkEsYUFEc0I7QUFFdEJDLE1BRnNCO0FBR3RCQyxPQUhzQjtBQUl0QkM7QUFKc0IsQ0FBVCxFQUtaO0FBQ0Qsc0JBQVFDLGVBQVIsQ0FBd0JKLFdBQXhCO0FBQ0EsTUFBSUUsS0FBSixFQUFXO0FBQ1Qsd0JBQVFBLEtBQVIsQ0FBY0EsS0FBZDtBQUNEO0FBQ0QsTUFBSUQsSUFBSixFQUFVO0FBQ1Isd0JBQVFJLEVBQVIsQ0FBVyxRQUFYLEVBQXFCSixJQUFyQjtBQUNEO0FBQ0Qsc0JBQVFLLEtBQVIsQ0FBY0MsUUFBUUMsSUFBdEIsRUFBNEJELFFBQVFFLEdBQXBDOztBQUVBLFFBQU1DLFVBQVUsb0JBQVFDLFVBQVIsRUFBaEI7QUFDQVIsNkJBQWVPLE9BQWYsRUFBd0IsWUFBVztBQUNqQ0Usc0JBQWtCRixPQUFsQjtBQUNELEdBRkQ7QUFHRCxDOztBQTFDRDs7Ozs7O0FBRUEsU0FBU0UsaUJBQVQsQ0FBMkJGLE9BQTNCLEVBQW9DO0FBQ2xDLE9BQUssTUFBTUcsR0FBWCxJQUFrQkgsT0FBbEIsRUFBMkI7QUFDekIsUUFBSUksUUFBUUosUUFBUUcsR0FBUixDQUFaO0FBQ0EsUUFBSUEsT0FBTyxXQUFYLEVBQXdCO0FBQ3RCQyxjQUFRLGdCQUFSO0FBQ0Q7QUFDRCxRQUFJLE9BQU9BLEtBQVAsS0FBaUIsUUFBckIsRUFBK0I7QUFDN0IsVUFBSTtBQUNGQSxnQkFBUUMsS0FBS0MsU0FBTCxDQUFlRixLQUFmLENBQVI7QUFDRCxPQUZELENBRUUsT0FBTUcsQ0FBTixFQUFTO0FBQ1QsWUFBSUgsU0FBU0EsTUFBTUksV0FBZixJQUE4QkosTUFBTUksV0FBTixDQUFrQkMsSUFBcEQsRUFBMEQ7QUFDeERMLGtCQUFRQSxNQUFNSSxXQUFOLENBQWtCQyxJQUExQjtBQUNEO0FBQ0Y7QUFDRjtBQUNEO0FBQ0FDLFlBQVFDLEdBQVIsQ0FBYSxHQUFFUixHQUFJLEtBQUlDLEtBQU0sRUFBN0I7QUFDQTtBQUNEO0FBQ0YiLCJmaWxlIjoicnVubmVyLmpzIiwic291cmNlc0NvbnRlbnQiOlsiXG5pbXBvcnQgcHJvZ3JhbSBmcm9tICcuL2NvbW1hbmRlcic7XG5cbmZ1bmN0aW9uIGxvZ1N0YXJ0dXBPcHRpb25zKG9wdGlvbnMpIHtcbiAgZm9yIChjb25zdCBrZXkgaW4gb3B0aW9ucykge1xuICAgIGxldCB2YWx1ZSA9IG9wdGlvbnNba2V5XTtcbiAgICBpZiAoa2V5ID09IFwibWFzdGVyS2V5XCIpIHtcbiAgICAgIHZhbHVlID0gXCIqKipSRURBQ1RFRCoqKlwiO1xuICAgIH1cbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdmFsdWUgPSBKU09OLnN0cmluZ2lmeSh2YWx1ZSlcbiAgICAgIH0gY2F0Y2goZSkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWUuY29uc3RydWN0b3IgJiYgdmFsdWUuY29uc3RydWN0b3IubmFtZSkge1xuICAgICAgICAgIHZhbHVlID0gdmFsdWUuY29uc3RydWN0b3IubmFtZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cbiAgICAvKiBlc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgY29uc29sZS5sb2coYCR7a2V5fTogJHt2YWx1ZX1gKTtcbiAgICAvKiBlc2xpbnQtZW5hYmxlIG5vLWNvbnNvbGUgKi9cbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbih7XG4gIGRlZmluaXRpb25zLFxuICBoZWxwLFxuICB1c2FnZSxcbiAgc3RhcnRcbn0pIHtcbiAgcHJvZ3JhbS5sb2FkRGVmaW5pdGlvbnMoZGVmaW5pdGlvbnMpO1xuICBpZiAodXNhZ2UpIHtcbiAgICBwcm9ncmFtLnVzYWdlKHVzYWdlKTtcbiAgfVxuICBpZiAoaGVscCkge1xuICAgIHByb2dyYW0ub24oJy0taGVscCcsIGhlbHApO1xuICB9XG4gIHByb2dyYW0ucGFyc2UocHJvY2Vzcy5hcmd2LCBwcm9jZXNzLmVudik7XG5cbiAgY29uc3Qgb3B0aW9ucyA9IHByb2dyYW0uZ2V0T3B0aW9ucygpO1xuICBzdGFydChwcm9ncmFtLCBvcHRpb25zLCBmdW5jdGlvbigpIHtcbiAgICBsb2dTdGFydHVwT3B0aW9ucyhvcHRpb25zKTtcbiAgfSk7XG59XG4iXX0=