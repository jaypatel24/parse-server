'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.AccountLockout = undefined;

var _node = require('parse/node');

var _node2 = _interopRequireDefault(_node);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

class AccountLockout {
  constructor(user, config) {
    this._user = user;
    this._config = config;
  }

  /**
   * set _failed_login_count to value
   */
  _setFailedLoginCount(value) {
    const query = {
      username: this._user.username
    };

    const updateFields = {
      _failed_login_count: value
    };

    return this._config.database.update('_User', query, updateFields);
  }

  /**
   * check if the _failed_login_count field has been set
   */
  _isFailedLoginCountSet() {
    const query = {
      username: this._user.username,
      _failed_login_count: { $exists: true }
    };

    return this._config.database.find('_User', query).then(users => {
      if (Array.isArray(users) && users.length > 0) {
        return true;
      } else {
        return false;
      }
    });
  }

  /**
   * if _failed_login_count is NOT set then set it to 0
   * else do nothing
   */
  _initFailedLoginCount() {
    return this._isFailedLoginCountSet().then(failedLoginCountIsSet => {
      if (!failedLoginCountIsSet) {
        return this._setFailedLoginCount(0);
      }
    });
  }

  /**
   * increment _failed_login_count by 1
   */
  _incrementFailedLoginCount() {
    const query = {
      username: this._user.username
    };

    const updateFields = { _failed_login_count: { __op: 'Increment', amount: 1 } };

    return this._config.database.update('_User', query, updateFields);
  }

  /**
   * if the failed login count is greater than the threshold
   * then sets lockout expiration to 'currenttime + accountPolicy.duration', i.e., account is locked out for the next 'accountPolicy.duration' minutes
   * else do nothing
   */
  _setLockoutExpiration() {
    const query = {
      username: this._user.username,
      _failed_login_count: { $gte: this._config.accountLockout.threshold }
    };

    const now = new Date();

    const updateFields = {
      _account_lockout_expires_at: _node2.default._encode(new Date(now.getTime() + this._config.accountLockout.duration * 60 * 1000))
    };

    return this._config.database.update('_User', query, updateFields).catch(err => {
      if (err && err.code && err.message && err.code === 101 && err.message === 'Object not found.') {
        return; // nothing to update so we are good
      } else {
        throw err; // unknown error
      }
    });
  }

  /**
   * if _account_lockout_expires_at > current_time and _failed_login_count > threshold
   *   reject with account locked error
   * else
   *   resolve
   */
  _notLocked() {
    const query = {
      username: this._user.username,
      _account_lockout_expires_at: { $gt: _node2.default._encode(new Date()) },
      _failed_login_count: { $gte: this._config.accountLockout.threshold }
    };

    return this._config.database.find('_User', query).then(users => {
      if (Array.isArray(users) && users.length > 0) {
        throw new _node2.default.Error(_node2.default.Error.OBJECT_NOT_FOUND, 'Your account is locked due to multiple failed login attempts. Please try again after ' + this._config.accountLockout.duration + ' minute(s)');
      }
    });
  }

  /**
   * set and/or increment _failed_login_count
   * if _failed_login_count > threshold
   *   set the _account_lockout_expires_at to current_time + accountPolicy.duration
   * else
   *   do nothing
   */
  _handleFailedLoginAttempt() {
    return this._initFailedLoginCount().then(() => {
      return this._incrementFailedLoginCount();
    }).then(() => {
      return this._setLockoutExpiration();
    });
  }

  /**
   * handle login attempt if the Account Lockout Policy is enabled
   */
  handleLoginAttempt(loginSuccessful) {
    if (!this._config.accountLockout) {
      return Promise.resolve();
    }
    return this._notLocked().then(() => {
      if (loginSuccessful) {
        return this._setFailedLoginCount(0);
      } else {
        return this._handleFailedLoginAttempt();
      }
    });
  }

}

exports.AccountLockout = AccountLockout; // This class handles the Account Lockout Policy settings.

exports.default = AccountLockout;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL3NyYy9BY2NvdW50TG9ja291dC5qcyJdLCJuYW1lcyI6WyJBY2NvdW50TG9ja291dCIsImNvbnN0cnVjdG9yIiwidXNlciIsImNvbmZpZyIsIl91c2VyIiwiX2NvbmZpZyIsIl9zZXRGYWlsZWRMb2dpbkNvdW50IiwidmFsdWUiLCJxdWVyeSIsInVzZXJuYW1lIiwidXBkYXRlRmllbGRzIiwiX2ZhaWxlZF9sb2dpbl9jb3VudCIsImRhdGFiYXNlIiwidXBkYXRlIiwiX2lzRmFpbGVkTG9naW5Db3VudFNldCIsIiRleGlzdHMiLCJmaW5kIiwidGhlbiIsInVzZXJzIiwiQXJyYXkiLCJpc0FycmF5IiwibGVuZ3RoIiwiX2luaXRGYWlsZWRMb2dpbkNvdW50IiwiZmFpbGVkTG9naW5Db3VudElzU2V0IiwiX2luY3JlbWVudEZhaWxlZExvZ2luQ291bnQiLCJfX29wIiwiYW1vdW50IiwiX3NldExvY2tvdXRFeHBpcmF0aW9uIiwiJGd0ZSIsImFjY291bnRMb2Nrb3V0IiwidGhyZXNob2xkIiwibm93IiwiRGF0ZSIsIl9hY2NvdW50X2xvY2tvdXRfZXhwaXJlc19hdCIsIl9lbmNvZGUiLCJnZXRUaW1lIiwiZHVyYXRpb24iLCJjYXRjaCIsImVyciIsImNvZGUiLCJtZXNzYWdlIiwiX25vdExvY2tlZCIsIiRndCIsIkVycm9yIiwiT0JKRUNUX05PVF9GT1VORCIsIl9oYW5kbGVGYWlsZWRMb2dpbkF0dGVtcHQiLCJoYW5kbGVMb2dpbkF0dGVtcHQiLCJsb2dpblN1Y2Nlc3NmdWwiLCJQcm9taXNlIiwicmVzb2x2ZSJdLCJtYXBwaW5ncyI6Ijs7Ozs7OztBQUNBOzs7Ozs7QUFFTyxNQUFNQSxjQUFOLENBQXFCO0FBQzFCQyxjQUFZQyxJQUFaLEVBQWtCQyxNQUFsQixFQUEwQjtBQUN4QixTQUFLQyxLQUFMLEdBQWFGLElBQWI7QUFDQSxTQUFLRyxPQUFMLEdBQWVGLE1BQWY7QUFDRDs7QUFFRDs7O0FBR0FHLHVCQUFxQkMsS0FBckIsRUFBNEI7QUFDMUIsVUFB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OztBQU1BLFdBQU8sS0FBS3pCLE9BQUwsQ0FBYU8sUUFBYixDQUFzQkksSUFBdEIsQ0FBMkIsT0FBM0IsRUFBb0NSLEtBQXBDLEVBQ0pTLElBREksQ0FDQ0MsU0FBUztBQUNiLFVBQUlDLE1BQU1DLE9BQU4sQ0FBY0YsS0FBZCxLQUF3QkEsTUFBTUcsTUFBTixHQUFlLENBQTNDLEVBQThDO0FBQzVDLGNBQU0sSUFBSSxlQUFNc0IsS0FBVixDQUFnQixlQUFNQSxLQUFOLENBQVlDLGdCQUE1QixFQUE4QywwRkFBMEYsS0FBS3ZDLE9BQUwsQ0FBYXdCLGNBQWIsQ0FBNEJPLFFBQXRILEdBQWlJLFlBQS9LLENBQU47QUFDRDtBQUNGLEtBTEksQ0FBUDtBQU1EOztBQUVEOzs7Ozs7O0FBT0FTLDhCQUE0QjtBQUMxQixXQUFPLEtBQUt2QixxQkFBTCxHQUNKTCxJQURJLENBQ0MsTUFBTTtBQUNWLGFBQU8sS0FBS08sMEJBQUwsRUFBUDtBQUNELEtBSEksRUFJSlAsSUFKSSxDQUlDLE1BQU07QUFDVixhQUFPLEtBQUtVLHFCQUFMLEVBQVA7QUFDRCxLQU5JLENBQVA7QUFPRDs7QUFFRDs7O0FBR0FtQixxQkFBbUJDLGVBQW5CLEVBQW9DO0FBQ2xDLFFBQUksQ0FBQyxLQUFLMUMsT0FBTCxDQUFhd0IsY0FBbEIsRUFBa0M7QUFDaEMsYUFBT21CLFFBQVFDLE9BQVIsRUFBUDtBQUNEO0FBQ0QsV0FBTyxLQUFLUixVQUFMLEdBQ0p4QixJQURJLENBQ0MsTUFBTTtBQUNWLFVBQUk4QixlQUFKLEVBQXFCO0FBQ25CLGVBQU8sS0FBS3pDLG9CQUFMLENBQTBCLENBQTFCLENBQVA7QUFDRCxPQUZELE1BRU87QUFDTCxlQUFPLEtBQUt1Qyx5QkFBTCxFQUFQO0FBQ0Q7QUFDRixLQVBJLENBQVA7QUFRRDs7QUFsSnlCOztRQUFmN0MsYyxHQUFBQSxjLEVBSGI7O2tCQXlKZUEsYyIsImZpbGUiOiJBY2NvdW50TG9ja291dC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vIFRoaXMgY2xhc3MgaGFuZGxlcyB0aGUgQWNjb3VudCBMb2Nrb3V0IFBvbGljeSBzZXR0aW5ncy5cbmltcG9ydCBQYXJzZSBmcm9tICdwYXJzZS9ub2RlJztcblxuZXhwb3J0IGNsYXNzIEFjY291bnRMb2Nrb3V0IHtcbiAgY29uc3RydWN0b3IodXNlciwgY29uZmlnKSB7XG4gICAgdGhpcy5fdXNlciA9IHVzZXI7XG4gICAgdGhpcy5fY29uZmlnID0gY29uZmlnO1xuICB9XG5cbiAgLyoqXG4gICAqIHNldCBfZmFpbGVkX2xvZ2luX2NvdW50IHRvIHZhbHVlXG4gICAqL1xuICBfc2V0RmFpbGVkTG9naW5Db3VudCh2YWx1ZSkge1xuICAgIGNvbnN0IHF1ZXJ5ID0ge1xuICAgICAgdXNlcm5hbWU6IHRoaXMuX3VzZXIudXNlcm5hbWVcbiAgICB9O1xuXG4gICAgY29uc3QgdXBkYXRlRmllbGRzID0ge1xuICAgICAgX2ZhaWxlZF9sb2dpbl9jb3VudDogdmFsdWVcbiAgICB9O1xuXG4gICAgcmV0dXJuIHRoaXMuX2NvbmZpZy5kYXRhYmFzZS51cGRhdGUoJ19Vc2VyJywgcXVlcnksIHVwZGF0ZUZpZWxkcyk7XG4gIH1cblxuICAvKipcbiAgICogY2hlY2sgaWYgdGhlIF9mYWlsZWRfbG9naW5fY291bnQgZmllbGQgaGFzIGJlZW4gc2V0XG4gICAqL1xuICBfaXNGYWlsZWRMb2dpbkNvdW50U2V0KCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0ge1xuICAgICAgdXNlcm5hbWU6IHRoaXMuX3VzZXIudXNlcm5hbWUsXG4gICAgICBfZmFpbGVkX2xvZ2luX2NvdW50OiB7ICRleGlzdHM6IHRydWUgfVxuICAgIH07XG5cbiAgICByZXR1cm4gdGhpcy5fY29uZmlnLmRhdGFiYXNlLmZpbmQoJ19Vc2VyJywgcXVlcnkpXG4gICAgICAudGhlbih1c2VycyA9PiB7XG4gICAgICAgIGlmIChBcnJheS5pc0FycmF5KHVzZXJzKSAmJiB1c2Vycy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBpZiBfZmFpbGVkX2xvZ2luX2NvdW50IGlzIE5PVCBzZXQgdGhlbiBzZXQgaXQgdG8gMFxuICAgKiBlbHNlIGRvIG5vdGhpbmdcbiAgICovXG4gIF9pbml0RmFpbGVkTG9naW5Db3VudCgpIHtcbiAgICByZXR1cm4gdGhpcy5faXNGYWlsZWRMb2dpbkNvdW50U2V0KClcbiAgICAgIC50aGVuKGZhaWxlZExvZ2luQ291bnRJc1NldCA9PiB7XG4gICAgICAgIGlmICghZmFpbGVkTG9naW5Db3VudElzU2V0KSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMuX3NldEZhaWxlZExvZ2luQ291bnQoMCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIGluY3JlbWVudCBfZmFpbGVkX2xvZ2luX2NvdW50IGJ5IDFcbiAgICovXG4gIF9pbmNyZW1lbnRGYWlsZWRMb2dpbkNvdW50KCkge1xuICAgIGNvbnN0IHF1ZXJ5ID0ge1xuICAgICAgdXNlcm5hbWU6IHRoaXMuX3VzZXIudXNlcm5hbWVcbiAgICB9O1xuXG4gICAgY29uc3QgdXBkYXRlRmllbGRzID0ge19mYWlsZWRfbG9naW5fY291bnQ6IHtfX29wOiAnSW5jcmVtZW50JywgYW1vdW50OiAxfX07XG5cbiAgICByZXR1cm4gdGhpcy5fY29uZmlnLmRhdGFiYXNlLnVwZGF0ZSgnX1VzZXInLCBxdWVyeSwgdXBkYXRlRmllbGRzKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBpZiB0aGUgZmFpbGVkIGxvZ2luIGNvdW50IGlzIGdyZWF0ZXIgdGhhbiB0aGUgdGhyZXNob2xkXG4gICAqIHRoZW4gc2V0cyBsb2Nrb3V0IGV4cGlyYXRpb24gdG8gJ2N1cnJlbnR0aW1lICsgYWNjb3VudFBvbGljeS5kdXJhdGlvbicsIGkuZS4sIGFjY291bnQgaXMgbG9ja2VkIG91dCBmb3IgdGhlIG5leHQgJ2FjY291bnRQb2xpY3kuZHVyYXRpb24nIG1pbnV0ZXNcbiAgICogZWxzZSBkbyBub3RoaW5nXG4gICAqL1xuICBfc2V0TG9ja291dEV4cGlyYXRpb24oKSB7XG4gICAgY29uc3QgcXVlcnkgPSB7XG4gICAgICB1c2VybmFtZTogdGhpcy5fdXNlci51c2VybmFtZSxcbiAgICAgIF9mYWlsZWRfbG9naW5fY291bnQ6IHsgJGd0ZTogdGhpcy5fY29uZmlnLmFjY291bnRMb2Nrb3V0LnRocmVzaG9sZCB9XG4gICAgfTtcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XG5cbiAgICBjb25zdCB1cGRhdGVGaWVsZHMgPSB7XG4gICAgICBfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQ6IFBhcnNlLl9lbmNvZGUobmV3IERhdGUobm93LmdldFRpbWUoKSArIHRoaXMuX2NvbmZpZy5hY2NvdW50TG9ja291dC5kdXJhdGlvbiAqIDYwICogMTAwMCkpXG4gICAgfTtcblxuICAgIHJldHVybiB0aGlzLl9jb25maWcuZGF0YWJhc2UudXBkYXRlKCdfVXNlcicsIHF1ZXJ5LCB1cGRhdGVGaWVsZHMpXG4gICAgICAuY2F0Y2goZXJyID0+IHtcbiAgICAgICAgaWYgKGVyciAmJiBlcnIuY29kZSAmJiBlcnIubWVzc2FnZSAmJiBlcnIuY29kZSA9PT0gMTAxICYmIGVyci5tZXNzYWdlID09PSAnT2JqZWN0IG5vdCBmb3VuZC4nKSB7XG4gICAgICAgICAgcmV0dXJuOyAvLyBub3RoaW5nIHRvIHVwZGF0ZSBzbyB3ZSBhcmUgZ29vZFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRocm93IGVycjsgLy8gdW5rbm93biBlcnJvclxuICAgICAgICB9XG4gICAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBpZiBfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQgPiBjdXJyZW50X3RpbWUgYW5kIF9mYWlsZWRfbG9naW5fY291bnQgPiB0aHJlc2hvbGRcbiAgICogICByZWplY3Qgd2l0aCBhY2NvdW50IGxvY2tlZCBlcnJvclxuICAgKiBlbHNlXG4gICAqICAgcmVzb2x2ZVxuICAgKi9cbiAgX25vdExvY2tlZCgpIHtcbiAgICBjb25zdCBxdWVyeSA9IHtcbiAgICAgIHVzZXJuYW1lOiB0aGlzLl91c2VyLnVzZXJuYW1lLFxuICAgICAgX2FjY291bnRfbG9ja291dF9leHBpcmVzX2F0OiB7ICRndDogUGFyc2UuX2VuY29kZShuZXcgRGF0ZSgpKSB9LFxuICAgICAgX2ZhaWxlZF9sb2dpbl9jb3VudDogeyRndGU6IHRoaXMuX2NvbmZpZy5hY2NvdW50TG9ja291dC50aHJlc2hvbGR9XG4gICAgfTtcblxuICAgIHJldHVybiB0aGlzLl9jb25maWcuZGF0YWJhc2UuZmluZCgnX1VzZXInLCBxdWVyeSlcbiAgICAgIC50aGVuKHVzZXJzID0+IHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkodXNlcnMpICYmIHVzZXJzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICB0aHJvdyBuZXcgUGFyc2UuRXJyb3IoUGFyc2UuRXJyb3IuT0JKRUNUX05PVF9GT1VORCwgJ1lvdXIgYWNjb3VudCBpcyBsb2NrZWQgZHVlIHRvIG11bHRpcGxlIGZhaWxlZCBsb2dpbiBhdHRlbXB0cy4gUGxlYXNlIHRyeSBhZ2FpbiBhZnRlciAnICsgdGhpcy5fY29uZmlnLmFjY291bnRMb2Nrb3V0LmR1cmF0aW9uICsgJyBtaW51dGUocyknKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogc2V0IGFuZC9vciBpbmNyZW1lbnQgX2ZhaWxlZF9sb2dpbl9jb3VudFxuICAgKiBpZiBfZmFpbGVkX2xvZ2luX2NvdW50ID4gdGhyZXNob2xkXG4gICAqICAgc2V0IHRoZSBfYWNjb3VudF9sb2Nrb3V0X2V4cGlyZXNfYXQgdG8gY3VycmVudF90aW1lICsgYWNjb3VudFBvbGljeS5kdXJhdGlvblxuICAgKiBlbHNlXG4gICAqICAgZG8gbm90aGluZ1xuICAgKi9cbiAgX2hhbmRsZUZhaWxlZExvZ2luQXR0ZW1wdCgpIHtcbiAgICByZXR1cm4gdGhpcy5faW5pdEZhaWxlZExvZ2luQ291bnQoKVxuICAgICAgLnRoZW4oKCkgPT4ge1xuICAgICAgICByZXR1cm4gdGhpcy5faW5jcmVtZW50RmFpbGVkTG9naW5Db3VudCgpO1xuICAgICAgfSlcbiAgICAgIC50aGVuKCgpID0+IHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3NldExvY2tvdXRFeHBpcmF0aW9uKCk7XG4gICAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBoYW5kbGUgbG9naW4gYXR0ZW1wdCBpZiB0aGUgQWNjb3VudCBMb2Nrb3V0IFBvbGljeSBpcyBlbmFibGVkXG4gICAqL1xuICBoYW5kbGVMb2dpbkF0dGVtcHQobG9naW5TdWNjZXNzZnVsKSB7XG4gICAgaWYgKCF0aGlzLl9jb25maWcuYWNjb3VudExvY2tvdXQpIHtcbiAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRoaXMuX25vdExvY2tlZCgpXG4gICAgICAudGhlbigoKSA9PiB7XG4gICAgICAgIGlmIChsb2dpblN1Y2Nlc3NmdWwpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5fc2V0RmFpbGVkTG9naW5Db3VudCgwKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5faGFuZGxlRmFpbGVkTG9naW5BdHRlbXB0KCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbn1cblxuZXhwb3J0IGRlZmF1bHQgQWNjb3VudExvY2tvdXQ7XG4iXX0=