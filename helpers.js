// A type of promise-like that resolves synchronously and supports only one observer
export const _Pact = (function() {
	function _Pact() {}
	_Pact.prototype.then = function(onFulfilled, onRejected) {
		const state = this.__state;
		if (state) {
			const callback = state == 1 ? onFulfilled : onRejected;
			if (callback) {
				const result = new _Pact();
				try {
					_settle.call(result, 1, callback(this.__value));
				} catch (e) {
					_settle.call(result, 2, e);
				}
				return result;
			} else {
				return this;
			}
		}
		const result = new _Pact();
		this.__observer = () => {
			try {
				const value = this.__value;
				if (this.__state == 1) {
					_settle(result, 1, onFulfilled ? onFulfilled(value) : value);
				} else if (onRejected) {
					_settle(result, 1, onRejected(value));
				} else {
					_settle(result, 2, value);
				}
			} catch (e) {
				_settle(result, 2, e);
			}
		};
		return result;
	}
	return _Pact;
})();

// Settles a pact synchronously
export function _settle(pact, state, value) {
	if (!pact.__state) {
		if (value instanceof _Pact) {
			if (value.__state) {
				if (state === 1) {
					state = value.__state;
				}
				value = value.__value;
			} else {
				value.__observer = _settle.bind(null, pact, state, value);
				return;
			}
		} else if (typeof value == "object" && "then" in value) {
			value.then(_settle.bind(null, pact, state), _settle.bind(null, pact, 2));
			return;
		}
		pact.__state = state;
		pact.__value = value;
		const observer = pact.__observer;
		if (observer) {
			observer();
		}
	}
}

// Converts argument to a function that always returns a Promise
export const _async = (function() {
	try {
		if (isNaN.apply(null, {})) {
			return function(f) {
				return function() {
					try {
						return Promise.resolve(f.apply(this, arguments));
					} catch(e) {
						return Promise.reject(e);
					}
				}
			};
		}
	} catch (e) {
	}
	return function(f) {
		// Pre-ES5.1 JavaScript runtimes don't accept array-likes in Function.apply
		return function() {
			try {
				return Promise.resolve(f.apply(this, Array.prototype.slice.call(arguments)));
			} catch(e) {
				return Promise.reject(e);
			}
		}
	};
})();

// Awaits on a value that may or may not be a Promise (equivalent to the await keyword in ES2015, with continuations passed explicitly)
export function _await(value, then, direct) {
	if (direct) {
		return then ? then(value) : value;
	}
	value = Promise.resolve(value);
	return then ? value.then(then) : value;
}

// Awaits on a value that may or may not be a Promise, then ignores it
export function _awaitIgnored(value, direct) {
	if (!direct) {
		return Promise.resolve(value).then(_empty);
	}
}

// Proceeds after a value has resolved, or proceeds immediately if the value is not thenable
export function _continue(value, then) {
	return value && value.then ? value.then(then) : then(value);
}

// Proceeds after a value has resolved, or proceeds immediately if the value is not thenable
export function _continueIgnored(value) {
	if (value && value.then) {
		return value.then(_empty);
	}
}

// Asynchronously iterate through an object that has a length property, passing the index as the first argument to the callback (even as the length property changes)
export function _forTo(array, body) {
	for (var i = 0; i < array.length; ++i) {
		var result = body(i);
		if (result && result.then) {
			var pact = new _Pact();
			var reject = _settle.bind(null, pact, 2);
			result.then(_cycle, reject);
			return pact;
			function _cycle(result) {
				try {
					while (++i < array.length) {
						result = body(i);
						if (result && result.then) {
							result.then(_cycle, reject);
							return;
						}
					}
					_settle(pact, 1, result);
				} catch (e) {
					reject(e);
				}
			}
		}
	}
	return result;
}

// Asynchronously iterate through an object that has a length property, passing the value as the first argument to the callback (even as the length property changes)
export function _forValues(array, body, check) {
	var i = 0;
	return _for(check ? function() { return i < array.length && !check(); } : function() { return i < array.length; }, function() { i++; }, function() { return body(array[i]); });
}

// Asynchronously iterate through an object's properties (including properties inherited from the prototype)
// Uses a snapshot of the object's properties
export function _forIn(target, body, check) {
	var keys = [];
	for (var key in target) {
		keys.push(key);
	}
	return _forValues(keys, body, check);
}

// Asynchronously iterate through an object's own properties (excluding properties inherited from the prototype)
// Uses a snapshot of the object's properties
export function _forOwn(target, body, check) {
	var keys = [];
	for (var key in target) {
		if (Object.prototype.hasOwnProperty.call(target, key)) {
			keys.push(key);
		}
	}
	return _forValues(keys, body, check);
}

// Asynchronously iterate through an object's values
// Uses for...of if the runtime supports it, otherwise iterates until length on a copy
export function _forOf(target, body, check) {
	if (typeof Symbol !== "undefined") {
		var iteratorSymbol = Symbol.iterator;
		if (iteratorSymbol && (iteratorSymbol in target)) {
			var iterator = target[iteratorSymbol]();
			var step;
			var iteration = _for(check ? function() {
				return !(step = iterator.next()).done && !check();
			} : function() {
				return !(step = iterator.next()).done;
			}, void 0, function() {
				return body(step.value);
			});
			if (iterator.return) {
				function _fixup(value) {
					// Inform iterator of early exit
					if ((!step || !step.done) && iterator.return) {
						try {
							iterator.return();
						} catch(e) {
						}
					}
					return value;
				};
				if (iteration && iteration.then) {
					return iteration.then(_fixup, function(error) {
						throw _fixup(error);
					});
				} else {
					return _fixup(iteration);
				}
			} else {
				return iteration;
			}
		}
	}
	// No support for Symbol.iterator
	if (!("length" in target)) {
		throw new TypeError("value is not iterable");
	}
	// Handle live collections properly
	var values = [];
	for (var i = 0; i < target.length; i++) {
		values.push(target[i]);
	}
	return _forValues(values, body, check);
}

export function _forAwaitOf(target, body, check) {
	if (typeof Symbol !== "undefined") {
		var asyncIteratorSymbol = Symbol.asyncIterator;
		if (asyncIteratorSymbol && (asyncIteratorSymbol in target)) {
			var pact = new _Pact();
			var reject = _settle.bind(null, pact, 2);
			var iterator = target[asyncIteratorSymbol]();
			iterator.next().then(_resumeAfterNext).then(void 0, reject);
			return pact;
			function _resumeAfterBody(result) {
				if (check && !check()) {
					return _settle(pact, 1, result);
				}
				iterator.next().then(_resumeAfterNext).then(void 0, reject);
			}
			function _resumeAfterNext(step) {
				if (step.done) {
					_settle(pact, 1);
				} else {
					Promise.resolve(body(step.value)).then(_resumeAfterBody).then(void 0, reject);
				}
			}
		}
	}
	return Promise.resolve(_forOf(target, function(value) { return Promise.resolve(value).then(body); }, check));
}

// Asynchronously implement a generic for loop
export function _for(test, update, body) {
	var stage;
	for (;;) {
		var shouldContinue = test();
		if (!shouldContinue) {
			return result;
		}
		if (shouldContinue.then) {
			stage = 0;
			break;
		}
		var result = body();
		if (result && result.then) {
			stage = 1;
			break;
		}
		if (update) {
			var updateValue = update();
			if (updateValue && updateValue.then) {
				stage = 2;
				break;
			}
		}
	}
	var pact = new _Pact();
	var reject = _settle.bind(null, pact, 2);
	(stage === 0 ? shouldContinue.then(_resumeAfterTest) : stage === 1 ? result.then(_resumeAfterBody) : updateValue.then(_resumeAfterUpdate)).then(void 0, reject);
	return pact;
	function _resumeAfterBody(value) {
		result = value;
		do {
			if (update) {
				updateValue = update();
				if (updateValue && updateValue.then) {
					updateValue.then(_resumeAfterUpdate).then(void 0, reject);
					return;
				}
			}
			shouldContinue = test();
			if (!shouldContinue) {
				_settle(pact, 1, result);
				return;
			}
			if (shouldContinue.then) {
				shouldContinue.then(_resumeAfterTest).then(void 0, reject);
				return;
			}
			result = body();
		} while (!result || !result.then);
		result.then(_resumeAfterBody).then(void 0, reject);
	}
	function _resumeAfterTest(shouldContinue) {
		if (shouldContinue) {
			result = body();
			if (result && result.then) {
				result.then(_resumeAfterBody).then(void 0, reject);
			} else {
				_resumeAfterBody(result);
			}
		} else {
			_settle(pact, 1, result);
		}
	}
	function _resumeAfterUpdate() {
		if (shouldContinue = test()) {
			if (shouldContinue.then) {
				shouldContinue.then(_resumeAfterTest).then(void 0, reject);
			} else {
				_resumeAfterTest(shouldContinue);
			}
		} else {
			_settle(pact, 1, result);
		}
	}
}

// Asynchronously implement a do ... while loop
export function _do(body, test) {
	var awaitBody;
	do {
		var result = body();
		if (result && result.then) {
			awaitBody = true;
			break;
		}
		var shouldContinue = test();
		if (!shouldContinue) {
			return result;
		}
	} while (!shouldContinue.then);
	const pact = new _Pact();
	const reject = _settle.bind(null, pact, 2);
	(awaitBody ? result.then(_resumeAfterBody) : shouldContinue.then(_resumeAfterTest)).then(void 0, reject);
	return pact;
	function _resumeAfterBody(value) {
		result = value;
		while (shouldContinue = test()) {
			if (shouldContinue.then) {
				shouldContinue.then(_resumeAfterTest).then(void 0, reject);
				return;
			}
			result = body();
			if (result && result.then) {
				result.then(_resumeAfterBody).then(void 0, reject);
				return;
			}
		}
		_settle(pact, 1, result);
	}
	function _resumeAfterTest(shouldContinue) {
		if (shouldContinue) {
			do {
				result = body();
				if (result && result.then) {
					result.then(_resumeAfterBody).then(void 0, reject);
					return;
				}
				shouldContinue = test();
				if (!shouldContinue) {
					_settle(pact, 1, result);
					return;
				}
			} while (!shouldContinue.then);
			shouldContinue.then(_resumeAfterTest).then(void 0, reject);
		} else {
			_settle(pact, 1, result);
		}
	}
}

// Asynchronously implement a switch statement
export function _switch(discriminant, cases) {
	var dispatchIndex = -1;
	var awaitBody;
	outer: {
		for (var i = 0; i < cases.length; i++) {
			var test = cases[i][0];
			if (test) {
				var testValue = test();
				if (testValue && testValue.then) {
					break outer;
				}
				if (testValue === discriminant) {
					dispatchIndex = i;
					break;
				}
			} else {
				// Found the default case, set it as the pending dispatch case
				dispatchIndex = i;
			}
		}
		if (dispatchIndex !== -1) {
			do {
				var body = cases[dispatchIndex][1];
				while (!body) {
					dispatchIndex++;
					body = cases[dispatchIndex][1];
				}
				var result = body();
				if (result && result.then) {
					awaitBody = true;
					break outer;
				}
				var fallthroughCheck = cases[dispatchIndex][2];
				dispatchIndex++;
			} while (fallthroughCheck && !fallthroughCheck());
			return result;
		}
	}
	const pact = new _Pact();
	const reject = _settle.bind(null, pact, 2);
	(awaitBody ? result.then(_resumeAfterBody) : testValue.then(_resumeAfterTest)).then(void 0, reject);
	return pact;
	function _resumeAfterTest(value) {
		for (;;) {
			if (value === discriminant) {
				dispatchIndex = i;
				break;
			}
			if (++i === cases.length) {
				if (dispatchIndex !== -1) {
					break;
				} else {
					_settle(pact, 1, result);
					return;
				}
			}
			test = cases[i][0];
			if (test) {
				value = test();
				if (value && value.then) {
					value.then(_resumeAfterTest).then(void 0, reject);
					return;
				}
			} else {
				dispatchIndex = i;
			}
		}
		do {
			var body = cases[dispatchIndex][1];
			while (!body) {
				dispatchIndex++;
				body = cases[dispatchIndex][1];
			}
			var result = body();
			if (result && result.then) {
				result.then(_resumeAfterBody).then(void 0, reject);
				return;
			}
			var fallthroughCheck = cases[dispatchIndex][2];
			dispatchIndex++;
		} while (fallthroughCheck && !fallthroughCheck());
		_settle(pact, 1, result);
	}
	function _resumeAfterBody(result) {
		for (;;) {
			var fallthroughCheck = cases[dispatchIndex][2];
			if (!fallthroughCheck || fallthroughCheck()) {
				break;
			}
			dispatchIndex++;
			var body = cases[dispatchIndex][1];
			while (!body) {
				dispatchIndex++;
				body = cases[dispatchIndex][1];
			}
			result = body();
			if (result && result.then) {
				result.then(_resumeAfterBody).then(void 0, reject);
				return;
			}
		}
		_settle(pact, 1, result);
	}
}

// Asynchronously call a function and pass the result to explicitly passed continuations
export function _call(body, then, direct) {
	if (direct) {
		return then ? then(body()) : body();
	}
	try {
		var result = body();
		if (!result || !result.then) {
			result = Promise.resolve(result);
		}
		return then ? result.then(then) : result;
	} catch (e) {
		return Promise.reject(e);
	}
}

// Asynchronously call a function and swallow the result
export function _callIgnored(body, direct) {
	return _call(body, _empty, direct);
}

// Asynchronously call a function and pass the result to explicitly passed continuations
export function _invoke(body, then) {
	var result = body();
	if (result && result.then) {
		return result.then(then);
	}
	return then(result);
}

// Asynchronously call a function and swallow the result
export function _invokeIgnored(body) {
	var result = body();
	if (result && result.then) {
		return result.then(_empty);
	}
}

// Asynchronously call a function and send errors to recovery continuation
export function _catch(body, recover) {
	try {
		var result = body();
	} catch(e) {
		return recover(e);
	}
	if (result && result.then) {
		return result.then(void 0, recover);
	}
	return result;
}

// Asynchronously await a promise and pass the result to a finally continuation
export function _finallyRethrows(body, finalizer) {
	try {
		var result = body();
	} catch (e) {
		return finalizer(true, e);
	}
	if (result && result.then) {
		return result.then(finalizer.bind(null, false), finalizer.bind(null, true));
	}
	return finalizer(false, value);
}

// Asynchronously await a promise and invoke a finally continuation that always overrides the result
export function _finally(body, finalizer) {
	try {
		var result = body();
	} catch (e) {
		return finalizer();
	}
	if (result && result.then) {
		return result.then(finalizer, finalizer);
	}
	return finalizer();
}

// Rethrow or return a value from a finally continuation
export function _rethrow(thrown, value) {
	if (thrown)
		throw value;
	return value;
}

// Empty function to implement break and other control flow that ignores asynchronous results
export function _empty() {
}
