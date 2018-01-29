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
	try {
		for (var i = 0; i < array.length; ++i) {
			var result = body(i);
			if (result && result.then) {
				return new Promise(function(resolve, reject) {
					result.then(cycle, reject);
					function cycle(result) {
						try {
							while (++i < array.length) {
								result = body(i);
								if (result && result.then) {
									result.then(cycle, reject);
									return;
								}
							}
							resolve(result);
						} catch (e) {
							reject(e);
						}
					}
				});
			}
		}
		return result;
	} catch (e) {
		return Promise.reject(e);
	}
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
				var fixup = function(value) {
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
					return iteration.then(fixup, function(error) {
						throw fixup(error);
					});
				} else {
					return fixup(iteration);
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

// Asynchronously implement a generic for loop
export function _for(test, update, body) {
	try {
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
	} catch (e) {
		return Promise.reject(e);
	}
	return new Promise(function(resolve, reject) {
		(stage === 0 ? shouldContinue.then(resumeAfterTest) : stage === 1 ? result.then(resumeAfterBody) : updateValue.then(resumeAfterUpdate)).catch(reject);
		function resumeAfterBody(value) {
			result = value;
			do {
				if (update) {
					updateValue = update();
					if (updateValue && updateValue.then) {
						updateValue.then(resumeAfterUpdate).catch(reject);
						return;
					}
				}
				shouldContinue = test();
				if (!shouldContinue) {
					resolve(result);
					return;
				}
				if (shouldContinue.then) {
					shouldContinue.then(resumeAfterTest).catch(reject);
					return;
				}
				result = body();
			} while (!result || !result.then);
			result.then(resumeAfterBody).catch(reject);
		}
		function resumeAfterTest(shouldContinue) {
			if (shouldContinue) {
				result = body();
				if (result && result.then) {
					result.then(resumeAfterBody).catch(reject);
				} else {
					resumeAfterBody(result);
				}
			} else {
				resolve(result);
			}
		}
		function resumeAfterUpdate() {
			if (shouldContinue = test()) {
				if (shouldContinue.then) {
					shouldContinue.then(resumeAfterTest).catch(reject);
				} else {
					resumeAfterTest(shouldContinue);
				}
			} else {
				resolve(result);
			}
		}
	});
}

// Asynchronously implement a do ... while loop
export function _do(body, test) {
	var awaitBody;
	try {
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
	} catch (e) {
		return Promise.reject(e);
	}
	return new Promise(function(resolve, reject) {
		(awaitBody ? result.then(resumeAfterBody) : shouldContinue.then(resumeAfterTest)).catch(reject);
		function resumeAfterBody(value) {
			result = value;
			while (shouldContinue = test()) {
				if (shouldContinue.then) {
					shouldContinue.then(resumeAfterTest).catch(reject);
					return;
				}
				result = body();
				if (result && result.then) {
					result.then(resumeAfterBody).catch(reject);
					return;
				}
			}
			resolve(result);
		}
		function resumeAfterTest(shouldContinue) {
			if (shouldContinue) {
				do {
					result = body();
					if (result && result.then) {
						result.then(resumeAfterBody).catch(reject);
						return;
					}
					shouldContinue = test();
					if (!shouldContinue) {
						resolve(result);
						return;
					}
				} while (!shouldContinue.then);
				shouldContinue.then(resumeAfterTest).catch(reject);
			} else {
				resolve(result);
			}
		}
	});
}

// Asynchronously implement a switch statement
export function _switch(discriminant, cases) {
	var dispatchIndex = -1;
	var awaitBody;
	outer:
	try {
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
	} catch (e) {
		return Promise.reject(e);
	}
	return new Promise(function(resolve, reject) {
		(awaitBody ? result.then(resumeAfterBody) : testValue.then(resumeAfterTest)).catch(reject);
		function resumeAfterTest(value) {
			for (;;) {
				if (value === discriminant) {
					dispatchIndex = i;
					break;
				}
				if (++i === cases.length) {
					if (dispatchIndex !== -1) {
						break;
					} else {
						resolve(result);
						return;
					}
				}
				test = cases[i][0];
				if (test) {
					value = test();
					if (value && value.then) {
						value.then(resumeAfterTest).catch(reject);
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
					result.then(resumeAfterBody).catch(reject);
					return;
				}
				var fallthroughCheck = cases[dispatchIndex][2];
				dispatchIndex++;
			} while (fallthroughCheck && !fallthroughCheck());
			resolve(result);
		}
		function resumeAfterBody(result) {
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
					result.then(resumeAfterBody).catch(reject);
					return;
				}
			}
			resolve(result);
		}
	});
}

// Asynchronously call a function and pass the result to explicitly passed continuations
export function _call(body, then, direct, recover) {
	try {
		var result = body();
		if (result && result.then) {
			return result.then(then, recover);
		}
		if (!direct) {
			return Promise.resolve(result).then(then, recover);
		}
	} catch(e) {
		if (recover) {
			try {
				return Promise.resolve(recover(e));
			} catch(e2) {
				e = e2;
			}
		}
		return Promise.reject(e);
	}
	return then ? then(result) : result;
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
	return _invoke(body, _empty);
}

// Asynchronously call a function and send errors to recovery continuation
export function _catch(body, recover, direct) {
	return _call(body, void 0, direct, recover);
}

// Asynchronously await a promise and pass the result to a finally continuation
export function _finallyRethrows(value, finalizer) {
	if (value && value.then) {
		return value.then(finalizer.bind(null, false), finalizer.bind(null, true));
	}
	try {
		return finalizer(false, value);
	} catch (e) {
		return Promise.reject(e);
	}
}

// Asynchronously await a promise and invoke a finally continuation that always overrides the result
export function _finally(value, finalizer) {
	if (value && value.then) {
		return value.then(finalizer, finalizer);
	}
	try {
		return finalizer();
	} catch (e) {
		return Promise.reject(e);
	}
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
