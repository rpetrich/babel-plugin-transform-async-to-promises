export const __async = (function() {
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

export function __await(value, then, recover) {
	return Promise.resolve(value).then(then, recover);
}

export function __forTo(array, body) {
	return new Promise(function(resolve, reject) {
		var i = 0;
		var result;
		cycle();
		function dispatch(resolve) {
			resolve(body(i));
		}
		function cycle() {
			if (i < array.length) {
				(new Promise(dispatch)).then(next, reject);
			} else {
				resolve(result);
			}
		}
		function next(value) {
			result = value;
			i++;
			cycle();
		}
	});
}

export function __forIn(target, body, check) {
	var keys = [], i = 0;
	for (var key in target) {
		keys.push(key);
	}
	return __for(check ? function() { return i < keys.length && !check(); } : function() { return i < keys.length; }, function() { i++; }, function() { return body(keys[i]); });
}

export function __forOwn(target, body, check) {
	var keys = [], i = 0;
	for (var key in target) {
		if (Object.prototype.hasOwnProperty.call(target, key)) {
			keys.push(key);
		}
	}
	return __for(check ? function() { return i < keys.length && !check(); } : function() { return i < keys.length; }, function() { i++; }, function() { return body(keys[i]); });
}

export function __forOf(target, body, check) {
	if (typeof Symbol !== "undefined") {
		var iteratorSymbol = Symbol.iterator;
		if (iteratorSymbol) {
			var iterator = target[iteratorSymbol]();
			var step;
			var iteration = __for(check ? function() {
				return !(step = iterator.next()).done && !check();
			} : function() {
				return !(step = iterator.next()).done;
			}, void 0, function() {
				return body(step.value);
			});
			if (iterator.return) {
				return iteration.then(function(result) {
					try {
						// Inform iterator of early exit
						if ((!step || !step.done) && iterator.return) {
							iterator.return();
						}
					} finally {
						return result;
					}
				}, function(error) {
					try {
						// Inform iterator of early exit
						if ((!step || !step.done) && iterator.return) {
							iterator.return();
						}
					} finally {
						throw error;
					}
				});
			} else {
				return iteration;
			}
		}
	}
	// No support for Symbol.iterator
	if (target.length) {
		// Handle live collections properly
		var values = [];
		for (var value of target) {
			values.push(value);
		}
		target = values;
	}
	var i = 0;
	return __for(check ? function() { return i < target.length && !check(); } : function() { return i < target.length; }, function() { i++; }, function() { return body(target[i]); });
}

export function __for(test, update, body) {
	return new Promise(function(resolve, reject) {
		var result;
		cycle();
		function cycle() {
			__call(test, checkTestResult, reject);
		}
		function stashAndUpdate(value) {
			result = value;
			return update && update();
		}
		function checkTestResult(shouldContinue) {
			if (shouldContinue) {
				__call(body, stashAndUpdate).then(cycle, reject);
			} else {
				resolve(result);
			}
		}
	});
}

export function __do(body, test) {
	return new Promise(function(resolve, reject) {
		cycle();
		function cycle() {
			return __call(body, checkTestResult, reject);
		}
		function checkTestResult(value) {
			__call(test, function(shouldContinue) {
				if (shouldContinue) {
					cycle();
				} else {
					resolve(value);
				}
			}, reject);
		}
	});
}

export function __switch(discriminant, cases) {
	return new Promise(function(resolve, reject) {
		var i = -1;
		var defaultIndex = -1;
		function nextCase() {
			if (++i === cases.length) {
				if (defaultIndex !== -1) {
					i = defaultIndex;
					dispatchCaseBody();
				} else {
					resolve();
				}
			} else {
				var test = cases[i][0];
				if (test) {
					__call(test, checkCaseTest, reject);
				} else {
					defaultIndex = i;
					nextCase();
				}
			}
		}
		function checkCaseTest(test) {
			if (test !== discriminant) {
				nextCase();
			} else {
				dispatchCaseBody();
			}
		}
		function dispatchCaseBody() {
			for (;;) {
				var body = cases[i][1];
				if (body) {
					return __call(body, checkFallthrough, reject);
				} else if (++i === cases.length) {
					return resolve();
				}
			}
		}
		function checkFallthrough(result) {
			var fallthroughCheck = cases[i][2];
			if (!fallthroughCheck || fallthroughCheck()) {
				resolve(result);
			} else if (++i === cases.length) {
				resolve();
			} else {
				dispatchCaseBody();
			}
		}
		nextCase();
	});
}

export function __call(body, then, recover) {
	return (new Promise(function (resolve) { resolve(body()); })).then(then, recover);
}

export function __finallyRethrows(promise, finalizer) {
	return promise.then(finalizer.bind(null, false), finalizer.bind(null, true));
}

export function __finally(promise, finalizer) {
	return promise.then(finalizer, finalizer);
}

export function __rethrow(thrown, value) {
	if (thrown)
		throw value;
	return value;
}

export function __empty() {
}
