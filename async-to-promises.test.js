const asyncToPromises = require("./async-to-promises");
const babel6 = require("babel-core");
const types6 = require("babel-types");
const babel7 = require("@babel/core");
const types7 = require("@babel/types");
const babylon = require("babylon");

const checkTestCases = true;
const checkOutputMatches = true;
const logCompiledOutput = false;
const onlyRunTestName = undefined;

const helperNames = ["_Pact", "_settle", "_isSettledPact", "_async", "_await", "_awaitIgnored", "_continue", "_continueIgnored", "_forTo", "_forValues", "_forIn", "_forOwn", "_forOf", "_forAwaitOf", "_for", "_do", "_switch", "_call", "_callIgnored", "_invoke", "_invokeIgnored", "_catch", "_finallyRethrows", "_finally", "_rethrow", "_empty"];

const stripHelpersVisitor = {
	FunctionDeclaration(path) {
		if (helperNames.indexOf(path.node.id.name) === -1) {
			path.skip();
		} else {
			path.remove();
		}
	},
	VariableDeclarator(path) {
		if (helperNames.indexOf(path.node.id.name) === -1) {
			path.skip();
		} else if (path.isFunction() && path.id) {
			path.skip();
		} else if (path.isVariableDeclaration()) {
			const allDeclarations = path.get("declarations");
			const declarationsToRemove = allDeclarations.filter(declaration => /^_async/.test(declaration.node.id.name));
			if (declarationsToRemove.length === allDeclarations.length) {
				path.remove();
			} else {
				for (const declaration of allDeclarations) {
					declaration.remove();
				}
				path.skip();
			}
		} else if (!path.node.ignored) {
			path.remove();
		}
	}
};

const environments = [
	["babel 6", babel6, types6, asyncToPromises(babel6)],
	["babel 7", babel7, types7, asyncToPromises(babel7)],
];

function extractOnlyUserCode(babel, result) {
	return babel.transformFromAst(result.ast, result.code, { plugins: [{ visitor: stripHelpersVisitor }], compact: true, ast: false }).code;
}

function extractJustFunction(babel, result) {
	const extracted = extractOnlyUserCode(babel, result);
	const match = extracted.match(/(^return\s*)?(.*);$/);
	return match ? match[2] : extracted;
}

function compiledTest(name, { input, output, hoisted, cases, error, checkSyntax = true, module = false }) {
	if (onlyRunTestName && onlyRunTestName !== name) {
		return;
	}
	describe(name, () => {
		for (const [babelName, babel, types, pluginUnderTest] of environments) {
			describe(babelName, () => {
				const parseInput = module ? input : "return " + input;
				const ast = babel.parse ? babel.parse(parseInput, { parserOpts: { allowReturnOutsideFunction: true, plugins: ["asyncGenerators"] }, sourceType: "module" }) : babylon.parse(parseInput, { allowReturnOutsideFunction: true, sourceType: "module", plugins: ["asyncGenerators"] });
				if (error) {
					test("error", () => {
						try {
							babel.transformFromAst(ast, parseInput, { plugins: [[pluginUnderTest, {}]], compact: true })
							throw new Error("Expected error: " + error.toString());
						} catch (e) {
							const errorString = e.toString();
							if (typeof error === "string") {
								expect(errorString).toBe(error);
							} else {
								expect(errorString).toMatch(error);
							}
						}
					});
					return;
				}
				const extractFunction = module ? extractOnlyUserCode : extractJustFunction;
				const result = babel.transformFromAst(types.cloneDeep(ast), parseInput, { plugins: [[pluginUnderTest, {}]], compact: true, ast: true });
				const strippedResult = extractFunction(babel, result);
				const hoistedResult = babel.transformFromAst(types.cloneDeep(ast), parseInput, { plugins: [[pluginUnderTest, { hoist: true }]], compact: true, ast: true });
				const hoistedAndStrippedResult = extractFunction(babel, hoistedResult);
				if (logCompiledOutput) {
					console.log(name + " input", input);
					console.log(name + " output", strippedResult);
					if (hoistedAndStrippedResult !== strippedResult) {
						console.log(name + " hoisted", hoistedAndStrippedResult);
					}
				}
				let fn, rewrittenFn, hoistedFn;
				try {
					fn = new Function(`/* ${name} original */${parseInput}`)
				} catch (e) {
				}
				if (checkSyntax) {
					describe("syntax", () => {
						test("normal", () => {
							const code = result.code;
							try {
								rewrittenFn = new Function(`/* ${name} */${code}`);
							} catch (e) {
								if (e instanceof SyntaxError) {
									e.message += "\n" + code;
								}
								throw e;
							}
						});
						test("hoisted", () => {
							const code = hoistedResult.code;
							try {
								hoistedFn = new Function(`/* ${name} hoisted */${code}`);
							} catch (e) {
								if (e instanceof SyntaxError) {
									e.message += "\n" + code;
								}
								throw e;
							}
						});
					});
				}
				if (checkOutputMatches) {
					if (typeof output !== "undefined") {
						describe("output", () => {
							test("normal", () => {
								expect(strippedResult).toBe(output);
							});
							if (babelName !== "babel 7") {
								// Hoisting doesn't yet track scope properly on babel 7, temporarily ignoring tests
								test("hoisted", () => {
									expect(hoistedAndStrippedResult).toBe(typeof hoisted !== "undefined" ? hoisted : output);
								});
							}
						});
					}
				} else {
					if (strippedResult !== output) {
						console.log(name + ": " + strippedResult);
					}
					if (hoistedAndStrippedResult !== hoisted) {
						console.log(name + " hoisted: " + hoistedAndStrippedResult);
					}
				}
				if (checkTestCases) {
					for (let key in cases) {
						if (cases.hasOwnProperty(key)) {
							describe(key, () => {
								if (fn) {
									test("original", () => {
										return cases[key](fn());
									});
								}
								test("normal", () => {
									if (rewrittenFn) {
										return cases[key](rewrittenFn());
									}
								});
								test("hoisted", () => {
									if (hoistedFn) {
										return cases[key](hoistedFn());
									}
								});
							});
						}
					}
				}
			});
		}
	});
}

compiledTest("passthrough", {
	input: `function() { return 1; }`,
	output: `function(){return 1;}`,
	cases: {
		result: async f => expect(await f()).toBe(1),
	},
});

compiledTest("basic async", {
	input: `async function() { return true; }`,
	output: `function(){return _await(true);}`,
	cases: {
		result: async f => expect(await f()).toBe(true),
	},
});

compiledTest("call chains", {
	input: `async function(a, b, c) { return await a(await b(), await c()); }`,
	output: `function(a,b,c){return _call(b,function(_b){return _call(c,function(_c){return _await(a(_b,_c));});});}`,
	cases: {
		result: async f => expect(await f((b, c) => b + c, async _ => 2, async _ => 3)).toBe(5),
	},
});

compiledTest("argument evaluation order", {
	input: `async function(a, b, c) { return await a(1, b() + 1, await c()); }`,
	output: `_async(function(a,b,c){var _temp=b()+1;return _call(c,function(_c){return _await(a(1,_temp,_c));});})`,
	cases: {
		result: async f => expect(await f(async (a, b, c) => a + b + c, () => 1, async _ => 2)).toBe(5),
	},
});

compiledTest("assign to variable", {
	input: `async function(foo) { var result = await foo(); return result + 1; }`,
	output: `function(foo){return _call(foo,function(result){return result+1;});}`,
	hoisted: `var _temp=function(result){return result+1;};return function(foo){return _call(foo,_temp);}`,
	cases: {
		result: async f => expect(await f(async _ => 4)).toBe(5),
	},
});

compiledTest("two variables", {
	input: `async function(foo, bar) { var f = await foo(); var b = await bar(); return f + b; }`,
	output: `function(foo,bar){return _call(foo,function(f){return _call(bar,function(b){return f+b;});});}`,
	cases: {
		result: async f => expect(await f(async _ => 3, async _ => 2)).toBe(5),
	},
});

compiledTest("await logical left", {
	input: `async function(left, right) { return await left() && right(); }`,
	output: `function(left,right){return _call(left,function(_left){return _left&&right();});}`,
	cases: {
		false: async f => expect(await f(async _ => 0, _ => 2)).toBe(0),
		true: async f => expect(await f(async _ => 5, _ => 2)).toBe(2),
	},
});

compiledTest("await logical right", {
	input: `async function(left, right) { const result = left() && await right(); return result || result; }`,
	output: `_async(function(left,right){var _left=left();return _await(_left&&right(),function(result){return result||result;},!_left);})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(left,right){var _left=left();return _await(_left&&right(),_temp,!_left);})`,
	cases: {
		false: async f => expect(await f(_ => 0, async _ => 2)).toBe(0),
		true: async f => expect(await f(_ => 5, async _ => 2)).toBe(2),
	},
});

compiledTest("await logical right optimized", {
	input: `async function(left, right) { return left() && await right(); }`,
	output: `_async(function(left,right){var _left=left();return _left&&right();})`,
	cases: {
		false: async f => expect(await f(_ => 0, async _ => 2)).toBe(0),
		true: async f => expect(await f(_ => 5, async _ => 2)).toBe(2),
	},
});

compiledTest("await logical statement scope", {
	input: `async function(left, right) { if (true) { const result = left() && await right(); return result || result; } else { return false; } }`,
	output: `_async(function(left,right){if(true){var _left=left();return _await(_left&&right(),function(result){return result||result;},!_left);}else{return false;}})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(left,right){if(true){var _left=left();return _await(_left&&right(),_temp,!_left);}else{return false;}})`,
	cases: {
		false: async f => expect(await f(_ => 0, async _ => 2)).toBe(0),
		true: async f => expect(await f(_ => 5, async _ => 2)).toBe(2),
		order: async f => {
			let lastCalled = 0;
			await f(() => lastCalled = 1, () => lastCalled = 2);
			expect(lastCalled).toBe(2);
		}
	},
});

compiledTest("await logical statement scope optimized", {
	input: `async function(left, right) { if (true) return left() && await right(); else return false; }`,
	output: `_async(function(left,right){if(true){var _left=left();return _left&&right();}else return false;})`,
	cases: {
		false: async f => expect(await f(_ => 0, async _ => 2)).toBe(0),
		true: async f => expect(await f(_ => 5, async _ => 2)).toBe(2),
		order: async f => {
			let lastCalled = 0;
			await f(() => lastCalled = 1, () => lastCalled = 2);
			expect(lastCalled).toBe(2);
		}
	},
});

compiledTest("await logical both", {
	input: `async function(left, right) { return await left() && await right(); }`,
	output: `function(left,right){return _call(left,function(_left){return _await(_left&&right(),void 0,!_left);});}`,
	cases: {
		false: async f => expect(await f(async _ => 0, async _ => 2)).toBe(0),
		true: async f => expect(await f(async _ => 5, async _ => 2)).toBe(2),
	},
});

compiledTest("await logical complex right", {
	input: `async function(left, right) { return left() && 1 + await right(); }`,
	output: `_async(function(left,right){var _left=left();return _await(_left&&right(),function(_right){return _left&&1+_right;},!_left);})`,
	cases: {
		false: async f => expect(await f(_ => 0, async _ => 2)).toBe(0),
		true: async f => expect(await f(_ => 5, async _ => 2)).toBe(3),
	},
});

compiledTest("await logical complex left", {
	input: `async function(left, right) { return await left() + 1 && right(); }`,
	output: `function(left,right){return _call(left,function(_left){return _left+1&&right();});}`,
	cases: {
		false: async f => expect(await f(async _ => -1, _ => 2)).toBe(0),
		true: async f => expect(await f(async _ => 5, _ => 2)).toBe(2),
	},
});

compiledTest("await binary left", {
	input: `async function(left, right) { return await left() + right(); }`,
	output: `function(left,right){return _call(left,function(_left){return _left+right();});}`,
	cases: {
		two: async f => expect(await f(async _ => 0, _ => 2)).toBe(2),
		seven: async f => expect(await f(async _ => 5, _ => 2)).toBe(7),
	},
});

compiledTest("await binary right", {
	input: `async function(left, right) { return left() + await right(); }`,
	output: `_async(function(left,right){var _left=left();return _call(right,function(_right){return _left+_right;});})`,
	cases: {
		two: async f => expect(await f(_ => 0, async _ => 2)).toBe(2),
		seven: async f => expect(await f(_ => 5, async _ => 2)).toBe(7),
	},
});

compiledTest("await binary statement scope", {
	input: `async function(left, right) { if (true) return left() + await right(); else return false; }`,
	output: `_async(function(left,right){if(true){var _left=left();return _call(right,function(_right){return _left+_right;});}else return false;})`,
	cases: {
		two: async f => expect(await f(_ => 0, async _ => 2)).toBe(2),
		seven: async f => expect(await f(_ => 5, async _ => 2)).toBe(7),
		order: async f => {
			let lastCalled = 0;
			await f(() => lastCalled = 1, () => lastCalled = 2);
			expect(lastCalled).toBe(2);
		}
	},
});

compiledTest("await binary both", {
	input: `async function(left, right) { return await left() + await right(); }`,
	output: `function(left,right){return _call(left,function(_left){return _call(right,function(_right){return _left+_right;});});}`,
	cases: {
		two: async f => expect(await f(async _ => 0, async _ => 2)).toBe(2),
		seven: async f => expect(await f(async _ => 5, async _ => 2)).toBe(7),
	},
});

compiledTest("await binary and logical", {
	input: `async function(left, middle, right) { return await left() + !(await middle()) && await right(); }`,
	output: `function(left,middle,right){return _call(left,function(_left){return _call(middle,function(_middle){return _await(_left+!_middle&&right(),void 0,!(_left+!_middle));});});}`,
	cases: {
		two: async f => expect(await f(async _ => 3, async _ => false, async _ => 5)).toBe(5),
		seven: async f => expect(await f(async _ => 0, async _ => true, async _ => 2)).toBe(0),
	},
});

compiledTest("if prefix", {
	input: `async function(foo) { const result = await foo(); if (result) { return 1; } else { return 0; } }`,
	output: `function(foo){return _call(foo,function(result){if(result){return 1;}else{return 0;}});}`,
	hoisted: `var _temp=function(result){if(result){return 1;}else{return 0;}};return function(foo){return _call(foo,_temp);}`,
	cases: {
		consequent: async f => expect(await f(async _ => true)).toBe(1),
		alternate: async f => expect(await f(async _ => 0)).toBe(0),
	},
});

compiledTest("if predicate", {
	input: `async function(foo) { if (await foo()) { return 1; } else { return 0; } }`,
	output: `function(foo){return _call(foo,function(_foo){if(_foo){return 1;}else{return 0;}});}`,
	hoisted: `var _temp=function(_foo){if(_foo){return 1;}else{return 0;}};return function(foo){return _call(foo,_temp);}`,
	cases: {
		consequent: async f => expect(await f(async _ => true)).toBe(1),
		alternate: async f => expect(await f(async _ => 0)).toBe(0),
	},
});

compiledTest("if body returns", {
	input: `async function(foo, bar, baz) { if (foo()) { return await bar(); } else { return await baz(); } }`,
	output: `_async(function(foo,bar,baz){if(foo()){return bar();}else{return baz();}})`,
	cases: {
		consequent: async f => expect(await f(_ => true, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("if body assignments", {
	input: `async function(foo, bar, baz) { var result; if (foo()) { result = await bar(); } else { result = await baz(); }; return result; }`,
	output: `_async(function(foo,bar,baz){var result;return _invoke(function(){if(foo()){return _call(bar,function(_bar){result=_bar;});}else{return _call(baz,function(_baz){result=_baz;});}},function(){return result;});})`,
	hoisted: `_async(function(foo,bar,baz){var _temp=function(_bar){result=_bar;},_temp2=function(_baz){result=_baz;};var result;return _invoke(function(){if(foo()){return _call(bar,_temp);}else{return _call(baz,_temp2);}},function(){return result;});})`,
	cases: {
		consequent: async f => expect(await f(_ => true, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary consequent", {
	input: `async function(foo, bar, baz) { const result = foo() ? await bar() : baz(); return result || result; }`,
	output: `_async(function(foo,bar,baz){var _foo=foo();return _await(_foo?bar():baz(),function(result){return result||result;},!_foo);})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(foo,bar,baz){var _foo=foo();return _await(_foo?bar():baz(),_temp,!_foo);})`,
	cases: {
		consequent: async f => expect(await f(_ => true, async _ => 1, _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, async _ => 1, _ => 0)).toBe(0),
	},
});

compiledTest("ternary consequent optimized", {
	input: `async function(foo, bar, baz) { return foo() ? await bar() : baz(); }`,
	output: `_async(function(foo,bar,baz){var _foo=foo();return _foo?bar():baz();})`,
	cases: {
		consequent: async f => expect(await f(_ => true, async _ => 1, _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, async _ => 1, _ => 0)).toBe(0),
	},
});

compiledTest("ternary alternate", {
	input: `async function(foo, bar, baz) { const result = foo() ? bar() : await baz(); return result || result; }`,
	output: `_async(function(foo,bar,baz){var _foo=foo();return _await(_foo?bar():baz(),function(result){return result||result;},_foo);})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(foo,bar,baz){var _foo=foo();return _await(_foo?bar():baz(),_temp,_foo);})`,
	cases: {
		consequent: async f => expect(await f(_ => true, _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary alternate optimized", {
	input: `async function(foo, bar, baz) { return foo() ? bar() : await baz(); }`,
	output: `_async(function(foo,bar,baz){var _foo=foo();return _foo?bar():baz();})`,
	cases: {
		consequent: async f => expect(await f(_ => true, _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary body", {
	input: `async function(foo, bar, baz) { const result = foo() ? await bar() : await baz(); return result || result; }`,
	output: `_async(function(foo,bar,baz){return _await(foo()?bar():baz(),function(result){return result||result;});})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(foo,bar,baz){return _await(foo()?bar():baz(),_temp);})`,
	cases: {
		consequent: async f => expect(await f(_ => true, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary body optimized", {
	input: `async function(foo, bar, baz) { return foo() ? await bar() : await baz(); }`,
	output: `_async(function(foo,bar,baz){return foo()?bar():baz();})`,
	cases: {
		consequent: async f => expect(await f(_ => true, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary body complex left", {
	input: `async function(a, b, c, d) { const result = a() ? b() && await c() : await d(); return result || result; }`,
	output: `_async(function(a,b,c,d){var _a=a(),_b=_a&&b();return _await(_a?_b&&c():d(),function(result){return result||result;},!_b);})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(a,b,c,d){var _a=a(),_b=_a&&b();return _await(_a?_b&&c():d(),_temp,!_b);})`,
	cases: {
		consequent: async f => expect(await f(_ => true, _ => 1, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, _ => 1, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary body complex left optimized", {
	input: `async function(a, b, c, d) { return a() ? b() && await c() : await d(); }`,
	output: `_async(function(a,b,c,d){var _a=a(),_b=_a&&b();return _a?_b&&c():d();})`,
	cases: {
		consequent: async f => expect(await f(_ => true, _ => 1, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, _ => 1, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary body complex right", {
	input: `async function(a, b, c, d) { const result = a() ? await b() : c() && await d(); return result || result; }`,
	output: `_async(function(a,b,c,d){var _a=a();return _await(_a?b():0,function(_b){var _c=_a||c();return _await(_a?_b:_c&&d(),function(result){return result||result;},_a||!_c);},!_a);})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(a,b,c,d){var _a=a();return _await(_a?b():0,function(_b){var _c=_a||c();return _await(_a?_b:_c&&d(),_temp,_a||!_c);},!_a);})`,
	cases: {
		consequent: async f => expect(await f(_ => true, _ => 1, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, _ => 1, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary body complex right optimized", {
	input: `async function(a, b, c, d) { return a() ? await b() : c() && await d(); }`,
	output: `_async(function(a,b,c,d){var _a=a();return _await(_a?b():0,function(_b){var _c=_a||c();return _await(_a?_b:_c&&d(),void 0,_a||!_c);},!_a);})`,
	cases: {
		consequent: async f => expect(await f(_ => true, _ => 1, async _ => 1, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, _ => 1, async _ => 1, async _ => 0)).toBe(0),
	},
});

compiledTest("ternary predicate", {
	input: `async function(foo, bar, baz) { return await foo() ? bar() : baz(); }`,
	output: `function(foo,bar,baz){return _call(foo,function(_foo){return _foo?bar():baz();});}`,
	cases: {
		consequent: async f => expect(await f(async _ => true, _ => 1, _ => 0)).toBe(1),
		alternate: async f => expect(await f(async _ => false, _ => 1, _ => 0)).toBe(0),
	},
});

compiledTest("return in consequent", {
	input: `async function(foo, bar) { if (foo) { var baz = await bar(); if (baz) { return baz; } }; return 0; }`,
	output: `function(foo,bar){var _exit;return _invoke(function(){if(foo){return _call(bar,function(baz){if(baz){_exit=1;return baz;}});}},function(_result){return _await(_exit?_result:0);});}`,
	hoisted: `function(foo,bar){var _exit,_temp=function(baz){if(baz){_exit=1;return baz;}};return _invoke(function(){if(foo){return _call(bar,_temp);}},function(_result){return _await(_exit?_result:0);});}`,
	cases: {
		"inner if": async f => expect(await f(true, async _ => 1)).toBe(1),
		"outer if": async f => expect(await f(true, async _ => 0)).toBe(0),
		"no entry": async f => expect(await f(false, async _ => 1)).toBe(0),
	},
});

compiledTest("arguments expression", {
	input: `async function() { var result = false; for (var i = 0; i < arguments.length; i++) { if (await arguments[i]()) result = true; }; return result; }`,
	output: `_async(function(){var _arguments=arguments;var result=false;return _continue(_forTo(_arguments,function(i){return _await(_arguments[i](),function(_arguments$i){if(_arguments$i)result=true;});}),function(){return result;});})`,
	hoisted: `_async(function(){var _arguments=arguments,_temp=function(_arguments$i){if(_arguments$i)result=true;};var result=false;return _continue(_forTo(_arguments,function(i){return _await(_arguments[i](),_temp);}),function(){return result;});})`,
	cases: {
		none: async f => expect(await f()).toBe(false),
		one: async f => expect(await f(async () => true)).toBe(true),
		two: async f => expect(await f(async () => false, async () => true)).toBe(true),
	},
});

compiledTest("this expressions", {
	input: `async function() { const test = () => this; return await this.foo() + await this.bar() }`,
	output: `_async(function(){var _this=this;const test=()=>_this;return _await(_this.foo(),function(_this$foo){return _await(_this.bar(),function(_this$bar){return _this$foo+_this$bar;});});})`,
	cases: {
		direct: async f => expect(await f.call({ foo: _ => 1, bar: _ => 2 })).toBe(3),
		async: async f => expect(await f.call({ foo: async _ => 2, bar: async _ => 4 })).toBe(6),
	},
});

compiledTest("this call property", {
	// Use || to avoid optimizations
	input: `async function(foo) { var result = await foo.bar(); return result || result; }`,
	output: `_async(function(foo){return _await(foo.bar(),function(result){return result||result;});})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(foo){return _await(foo.bar(),_temp);})`,
	cases: {
		present: async f => expect(await f({ bar: function() { return this.baz; }, baz: 1})).toBe(1),
		missing: async f => expect(await f({ bar: function() { return this.baz; }})).toBe(undefined),
	},
});

compiledTest("this call subscript", {
	// Use || to avoid optimizations
	input: `async function(foo) { var result = await foo["bar"](); return result || result; }`,
	output: `_async(function(foo){return _await(foo["bar"](),function(result){return result||result;});})`,
	hoisted: `var _temp=function(result){return result||result;};return _async(function(foo){return _await(foo["bar"](),_temp);})`,
	cases: {
		present: async f => expect(await f({ bar: function() { return this.baz; }, baz: 1})).toBe(1),
		missing: async f => expect(await f({ bar: function() { return this.baz; }})).toBe(undefined),
	},
});

compiledTest("arrow functions", {
	input: `async foo => foo`,
	output: `function(foo){return _await(foo);}`,
	cases: {
		true: async f => expect(await f(true)).toBe(true),
		false: async f => expect(await f(false)).toBe(false),
	},
});

compiledTest("arrow functions with this", {
	input: `function () { return async () => this; }`,
	output: `function(){var _this=this;return function(){return _await(_this);};}`,
	cases: {
		true: async f => {
			const object = {};
			expect(await f.call(object)()).toBe(object);
		},
	},
});

compiledTest("arrow functions with this inner", {
	input: `function () { return async () => () => this; }`,
	output: `function(){var _this=this;return function(){return _await(()=>_this);};}`,
	cases: {
		true: async f => {
			const object = {};
			expect((await f.call(object)())()).toBe(object);
		},
	},
});

compiledTest("arrow functions with unbridged this inner", {
	input: `function () { return async () => function() { return this; }; }`,
	output: `function(){return function(){return _await(function(){return this;});};}`,
	cases: {
		true: async f => {
			const object = {};
			expect((await f.call(object)())()).toBe((function(){ return this; })());
		},
	},
});


compiledTest("inner functions", {
	input: `function (value) { return async other => value + other; }`,
	output: `function(value){return function(other){return _await(value+other);};}`,
	cases: {
		result: async f => expect(await f(1)(2)).toBe(3),
	},
});


compiledTest("forwarding to const async optimization", {
	input: `function (value) { const add = async (l, r) => await l + await r; return async (foo) => add(1, foo); }`,
	output: `function(value){const add=function(l,r){return _await(l,function(_l){return _await(r,function(_r){return _l+_r;});});};return function(foo){return add(1,foo);};}`,
	cases: {
		result: async f => expect(await f(1)(2)).toBe(3),
	},
});

compiledTest("forwarding to async function optimization", {
	input: `function (value) { const add = async (l, r) => l() + await r; return async (foo) => add(() => 1, foo); }`,
	output: `function(value){const add=_async(function(l,r){var _l=l();return _await(r,function(_r){return _l+_r;});});return function(foo){return add(()=>1,foo);};}`,
	cases: {
		result: async f => expect(await f(1)(2)).toBe(3),
	},
});

compiledTest("forwarding to async function optimization hoisted", {
	input: `function (value) { return async (foo) => add(1, foo); async function add(l, r) { return await l + await r; } }`,
	output: `function(value){var add=function(l,r){return _await(l,function(_l){return _await(r,function(_r){return _l+_r;});});};return function(foo){return add(1,foo);};}`,
	cases: {
		result: async f => expect(await f(1)(2)).toBe(3),
	},
});

compiledTest("forwarding to const async optimization bail out", {
	input: `function (value) { const add = (l, r) => l + r; return async (foo) => add(1, foo); }`,
	output: `function(value){const add=(l,r)=>l+r;return _async(function(foo){return add(1,foo);});}`,
	cases: {
		result: async f => expect(await f(1)(2)).toBe(3),
	},
});


compiledTest("compound variable declarator", {
	input: `async function(foo) { var a = 1, b = await foo(), c = 3; return a + b + c; }`,
	output: `function(foo){var a=1;return _call(foo,function(b){var c=3;return a+b+c;});}`,
	cases: {
		result: async f => expect(await f(async _ => 2)).toBe(6),
	},
});

compiledTest("calling member functions", {
	input: `async function(foo, bar) { return bar.baz(await foo()); }`,
	output: `_async(function(foo,bar){var _baz=bar.baz;return _call(foo,function(_foo){return _baz.call(bar,_foo);});})`,
	cases: {
		normal: async f => expect(await f(async _ => true, { baz: arg => arg })).toBe(true),
		reassign: async f => {
			const bar = {
				baz: () => true,
			};
			expect(await f(() => bar.baz = () => false, bar)).toBe(true)
		}
	},
});

compiledTest("catch and recover via return", {
	input: `async function(foo) { try { return await foo(); } catch(e) { return "fallback"; } }`,
	output: `_async(function(foo){return _catch(foo,function(){return"fallback";});})`,
	hoisted: `var _fallback=function(){return"fallback";};return _async(function(foo){return _catch(foo,_fallback);})`,
	cases: {
		success: async f => expect(await f(async _ => "success")).toBe("success"),
		fallback: async f => expect(await f(async _ => { throw "test"; })).toBe("fallback"),
	},
});

compiledTest("catch and ignore", {
	input: `async function(foo) { try { return await foo(); } catch(e) { } }`,
	output: `_async(function(foo){return _catch(foo,_empty);})`,
	cases: {
		success: async f => expect(await f(async _ => "success")).toBe("success"),
		fallback: async f => expect(await f(async _ => { throw "test"; })).toBe(undefined),
	},
});

compiledTest("catch and await", {
	input: `async function(foo, bar) { try { return await foo(); } catch(e) { await bar(); } }`,
	output: `_async(function(foo,bar){return _catch(foo,function(){return _callIgnored(bar);});})`,
	cases: {
		success: async f => expect(await f(async _ => "success", async _ => false)).toBe("success"),
		fallback: async f => expect(await f(async _ => { throw "test"; }, async _ => false)).toBe(undefined),
	},
});

compiledTest("catch and recover via variable", {
	input: `async function(value, log) { var result; try { result = await value(); } catch (e) { result = "an error"; }; log("result:", result); return result; }`,
	output: `_async(function(value,log){var result;return _continue(_catch(function(){return _call(value,function(_value){result=_value;});},function(){result="an error";}),function(){log("result:",result);return result;});})`,
	hoisted: `_async(function(value,log){var _temp=function(_value){result=_value;};var result;return _continue(_catch(function(){return _call(value,_temp);},function(){result="an error";}),function(){log("result:",result);return result;});})`,
	cases: {
		success: async f => expect(await f(async _ => "success", async _ => false)).toBe("success"),
		recover: async f => expect(await f(async _ => { throw "test"; }, async _ => false)).toBe("an error"),
	},
});

compiledTest("catch and recover via optimized return", {
	input: `async function(foo, bar) { try { return foo(); } catch(e) { return await bar(); } }`,
	output: `_async(function(foo,bar){return _catch(foo,function(){return _call(bar);});})`,
	cases: {
		success: async f => expect(await f(_ => "success")).toBe("success"),
		fallback: async f => expect(await f(_ => { throw "test"; }, () => "fallback")).toBe("fallback"),
	},
});

compiledTest("finally passthrough", {
	input: `async function(value, log) { try { return await value(); } finally { log("finished value(), might rethrow"); } }`,
	output: `_async(function(value,log){return _finallyRethrows(value,function(_wasThrown,_result){log("finished value(), might rethrow");return _rethrow(_wasThrown,_result);});})`,
	cases: {
		success: async f => expect(await f(async _ => "success", _ => undefined)).toBe("success"),
		throw: async f => {
			let result = false;
			try {
				await f(async _ => { throw "test"; }, _ => undefined);
			} catch (e) {
				result = true;
			}
			expect(result).toBe(true);
		}
	},
});

compiledTest("finally suppress original return", {
	input: `async function(value) { try { return await value(); } finally { return "suppressed"; } }`,
	output: `_async(function(value){return _finally(value,function(){return"suppressed";});})`,
	hoisted: `var _suppressed=function(){return"suppressed";};return _async(function(value){return _finally(value,_suppressed);})`,
	cases: {
		success: async f => expect(await f(async _ => "success", _ => undefined)).toBe("suppressed"),
		recover: async f => expect(await f(async _ => { throw "test"; }, _ => undefined)).toBe("suppressed"),
	},
});

compiledTest("finally double", {
	input: `async function(func) { try { try { return await func(); } finally { if (0) { return "not this"; } } } finally { return "suppressed"; } }`,
	output: `_async(function(func){return _finally(function(){return _finallyRethrows(func,function(_wasThrown,_result){if(0){return"not this";}return _rethrow(_wasThrown,_result);});},function(){return"suppressed";});})`,
	hoisted: `var _temp=function(_wasThrown,_result){if(0){return"not this";}return _rethrow(_wasThrown,_result);},_suppressed=function(){return"suppressed";};return _async(function(func){return _finally(function(){return _finallyRethrows(func,_temp);},_suppressed);})`,
	cases: {
		success: async f => expect(await f(async _ => "success", _ => undefined)).toBe("suppressed"),
		recover: async f => expect(await f(async _ => { throw "test"; }, _ => undefined)).toBe("suppressed"),
	},
});

compiledTest("try catch finally", {
	input: `async function(foo, bar, baz) { var result; try { return await foo(); } catch (e) { return await bar(); } finally { baz(); } }`,
	output: `_async(function(foo,bar,baz){var result;return _finallyRethrows(function(){return _catch(foo,function(){return _call(bar);});},function(_wasThrown,_result){baz();return _rethrow(_wasThrown,_result);});})`,
	cases: {
		normal: async f => {
			const foo = async () => true;
			let barCalled = false;
			const bar = async () => {
				barCalled = true;
				return false;
			}
			let bazCalled = false;
			const baz = async () => {
				bazCalled = true;
			}
			expect(await f(foo, bar, baz)).toBe(true);
			expect(barCalled).toBe(false);
			expect(bazCalled).toBe(true);
		},
		throws: async f => {
			const foo = async () => {
				throw new Error();
			};
			let barCalled = false;
			const bar = async () => {
				barCalled = true;
				return false;
			}
			let bazCalled = false;
			const baz = async () => {
				bazCalled = true;
			}
			expect(await f(foo, bar, baz)).toBe(false);
			expect(barCalled).toBe(true);
			expect(bazCalled).toBe(true);
		},
	},
});

compiledTest("throw test", {
	input: `async function() { throw true; }`,
	output: `_async(function(){throw true;})`,
	cases: {
		throws: async f => {
			var result;
			try {
				await f()
				result = false;
			} catch (e) {
				result = e;
			}
			expect(result).toBe(true);
		}
	},
});

compiledTest("throw from switch and catch", {
	input: `async function() { try { switch (true) { case true: throw await 1; } return false; } catch (e) { return true; } }`,
	output: `_async(function(){var _exit;return _catch(function(){return _continue(_switch(true,[[function(){return true;},function(){return _await(1,function(_){throw _;});}]]),function(_result){return _exit?_result:false;});},function(){return true;});})`,
	hoisted: `var _temp=function(_){throw _;},_true=function(){return true;},_one=function(){return _await(1,_temp);},_true2=function(){return true;};return _async(function(){var _exit,_temp2=function(_result){return _exit?_result:false;};return _catch(function(){return _continue(_switch(true,[[_true,_one]]),_temp2);},_true2);})`,
	cases: {
		result: async f => { expect(await f()).toBe(true) },
	},
});


compiledTest("for to length iteration", {
	input: `async function(list) { var result = 0; for (var i = 0; i < list.length; i++) { result += await list[i](); } return result;}`,
	output: `_async(function(list){var result=0;return _continue(_forTo(list,function(i){return _await(list[i](),function(_list$i){result+=_list$i;});}),function(){return result;});})`,
	hoisted: `_async(function(list){var _temp=function(_list$i){result+=_list$i;};var result=0;return _continue(_forTo(list,function(i){return _await(list[i](),_temp);}),function(){return result;});})`,
	cases: {
		zero: async f => expect(await f([])).toBe(0),
		one: async f => expect(await f([async _ => 1])).toBe(1),
		four: async f => expect(await f([async _ => 1, async _ => 3])).toBe(4),
		nine: async f => expect(await f([async _ => 1, async _ => 3, async _ => 5])).toBe(9),
	},
});

compiledTest("for to length with break", {
	input: `async function(list) { for (var i = 0; i < list.length; i++) { if (await list[i]()) { break; } }}`,
	output: `_async(function(list){var _interrupt;var i=0;return _continueIgnored(_for(function(){return!_interrupt&&i<list.length;},function(){return i++;},function(){return _await(list[i](),function(_list$i){if(_list$i){_interrupt=1;}});}));})`,
	hoisted: `_async(function(list){var _interrupt,_temp=function(_list$i){if(_list$i){_interrupt=1;}};var i=0;return _continueIgnored(_for(function(){return!_interrupt&&i<list.length;},function(){return i++;},function(){return _await(list[i](),_temp);}));})`,
	cases: {
		none: async f => expect(await f([])).toBe(undefined),
		single: async f => {
			let called = false;
			await f([async _ => called = true]);
			expect(called).toBe(true);
		},
		both: async f => {
			let called1 = false;
			let called2 = false;
			await f([async _ => { called1 = true }, async _ => called2 = true]);
			expect(called1).toBe(true);
			expect(called2).toBe(true);
		},
		stop: async f => {
			let called1 = false;
			let called2 = false;
			await f([async _ => called1 = true, async _ => called2 = true]);
			expect(called1).toBe(true);
			expect(called2).toBe(false);
		},
	},
});

compiledTest("for to length with return", {
	input: `async function(list) { for (var i = 0; i < list.length; i++) { if (await list[i]()) { return; } }}`,
	output: `_async(function(list){var _exit;var i=0;return _for(function(){return!_exit&&i<list.length;},function(){return i++;},function(){return _await(list[i](),function(_list$i){if(_list$i){_exit=1;}});});})`,
	hoisted: `_async(function(list){var _exit,_temp=function(_list$i){if(_list$i){_exit=1;}};var i=0;return _for(function(){return!_exit&&i<list.length;},function(){return i++;},function(){return _await(list[i](),_temp);});})`,
	cases: {
		none: async f => expect(await f([])).toBe(undefined),
		single: async f => {
			let called = false;
			await f([async _ => called = true]);
			expect(called).toBe(true);
		},
		both: async f => {
			let called1 = false;
			let called2 = false;
			await f([async _ => { called1 = true }, async _ => called2 = true]);
			expect(called1).toBe(true);
			expect(called2).toBe(true);
		},
		stop: async f => {
			let called1 = false;
			let called2 = false;
			await f([async _ => called1 = true, async _ => called2 = true]);
			expect(called1).toBe(true);
			expect(called2).toBe(false);
		},
	},
});

compiledTest("for to length with continue", {
	input: `async function(list) { for (var i = 0; i < list.length; i++) { if (await list[i]()) { continue; } return false; } return true; }`,
	output: `_async(function(list){var _exit;var i=0;return _continue(_for(function(){return!_exit&&i<list.length;},function(){return i++;},function(){return _await(list[i](),function(_list$i){if(_list$i){return;}_exit=1;return false;});}),function(_result){return _exit?_result:true;});})`,
	hoisted: `_async(function(list){var _exit,_temp=function(_list$i){if(_list$i){return;}_exit=1;return false;};var i=0;return _continue(_for(function(){return!_exit&&i<list.length;},function(){return i++;},function(){return _await(list[i](),_temp);}),function(_result){return _exit?_result:true;});})`,
	cases: {
		none: async f => expect(await f([])).toBe(true),
		"single true": async f => expect(await f([async _ => false])).toBe(false),
		"single false": async f => expect(await f([async _ => true])).toBe(true),
		"true and false": async f => expect(await f([async _ => true, async _ => false])).toBe(false),
	},
});

compiledTest("for to length with mutation", {
	input: `async function(list) { for (var i = 0; i < list.length; i++) { if (await list[i]()) { i = list.length; } }}`,
	output: `_async(function(list){var i=0;return _continueIgnored(_for(function(){return i<list.length;},function(){return i++;},function(){return _await(list[i](),function(_list$i){if(_list$i){i=list.length;}});}));})`,
	hoisted: `_async(function(list){var _temp=function(_list$i){if(_list$i){i=list.length;}};var i=0;return _continueIgnored(_for(function(){return i<list.length;},function(){return i++;},function(){return _await(list[i](),_temp);}));})`,
	cases: {
		none: async f => expect(await f([])).toBe(undefined),
		single: async f => {
			let called = false;
			await f([async _ => called = true]);
			expect(called).toBe(true);
		},
		both: async f => {
			let called1 = false;
			let called2 = false;
			await f([async _ => { called1 = true }, async _ => called2 = true]);
			expect(called1).toBe(true);
			expect(called2).toBe(true);
		},
		stop: async f => {
			let called1 = false;
			let called2 = false;
			await f([async _ => called1 = true, async _ => called2 = true]);
			expect(called1).toBe(true);
			expect(called2).toBe(false);
		},
	},
});

compiledTest("for of await in body", {
	input: `async function(iter) { var result = 0; for (var value of iter) result += await value; return result; }`,
	output: `_async(function(iter){var result=0;return _continue(_forOf(iter,function(value){return _await(value,function(_value){result+=_value;});}),function(){return result;});})`,
	hoisted: `_async(function(iter){var _temp=function(_value){result+=_value;};var result=0;return _continue(_forOf(iter,function(value){return _await(value,_temp);}),function(){return result;});})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([1])).toBe(1),
		multiple: async f => expect(await f([1,2])).toBe(3),
		error: async f => {
			try {
				await f({});
				// Should not get here
				expect(false).toBe(true);
			} catch (e) {
				expect(e.constructor).toBe(TypeError);
				expect(/\ is\ not\ iterable$/.test(e.message)).toBe(true);
			}
		}
	},
});

compiledTest("for of await in value", {
	input: `async function(foo) { var result = 0; for (var value of await foo()) result += value; return result; }`,
	output: `function(foo){var result=0;return _call(foo,function(_foo){for(var value of _foo)result+=value;return result;});}`,
	cases: {
		empty: async f => expect(await f(async () => [])).toBe(0),
		single: async f => expect(await f(async () => [1])).toBe(1),
		multiple: async f => expect(await f(async () => [1,2])).toBe(3),
	},
});

compiledTest("for of await in body with break", {
	input: `async function(iter) { var result = 0; for (var value of iter) { result += await value; if (result > 10) break; } return result; }`,
	output: `_async(function(iter){var _interrupt;var result=0;return _continue(_forOf(iter,function(value){return _await(value,function(_value){result+=_value;if(result>10){_interrupt=1;}});},function(){return _interrupt;}),function(){return result;});})`,
	hoisted: `_async(function(iter){var _interrupt,_temp=function(_value){result+=_value;if(result>10){_interrupt=1;}};var result=0;return _continue(_forOf(iter,function(value){return _await(value,_temp);},function(){return _interrupt;}),function(){return result;});})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([1])).toBe(1),
		multiple: async f => expect(await f([1,2])).toBe(3),
		break: async f => expect(await f([1,10,4])).toBe(11),
	},
});

compiledTest("for of in body", {
	input: `async function(iter) { let result = 0; for (const value of iter) { result += value; } return result; }`,
	output: `_async(function(iter){let result=0;for(const value of iter){result+=value;}return result;})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([1])).toBe(1),
		multiple: async f => expect(await f([1,2])).toBe(3),
	},
});

compiledTest("for await of in body", {
	input: `async function(iter) { let result = 0; for await (const value of iter) { result += value; } return result; }`,
	output: `_async(function(iter){let result=0;return _continue(_forAwaitOf(iter,function(value){result+=value;}),function(){return result;});})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([1])).toBe(1),
		multiple: async f => expect(await f([1,2])).toBe(3),
	},
});

compiledTest("for await of in body with break", {
	input: `async function(iter) { let result = 0; for await (const value of iter) { result += value; if (result > 10) break; } return result; }`,
	output: `_async(function(iter){var _interrupt;let result=0;return _continue(_forAwaitOf(iter,function(value){result+=value;if(result>10){_interrupt=1;return;}},function(){return _interrupt;}),function(){return result;});})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([1])).toBe(1),
		multiple: async f => expect(await f([1,2])).toBe(3),
		break: async f => expect(await f([1,10,4])).toBe(11),
	},
});

const whileCases = {
	one: async f => {
		var count = 0;
		expect(await f(async _ => { ++count })).toBe(undefined);
		expect(count).toBe(1);
	},
	two: async f => {
		var count = 0;
		expect(await f(async _ => { ++count; return count < 2; })).toBe(undefined);
		expect(count).toBe(2);
	},
	seven: async f => {
		var count = 0;
		expect(await f(async _ => { ++count; return count < 7; })).toBe(undefined);
		expect(count).toBe(7);
	},
};

compiledTest("while loop", {
	input: `async function(foo) { let shouldContinue = true; while (shouldContinue) { shouldContinue = await foo(); } }`,
	output: `_async(function(foo){let shouldContinue=true;return _continueIgnored(_for(function(){return!!shouldContinue;},void 0,function(){return _call(foo,function(_foo){shouldContinue=_foo;});}));})`,
	hoisted: `_async(function(foo){var _temp=function(_foo){shouldContinue=_foo;};let shouldContinue=true;return _continueIgnored(_for(function(){return!!shouldContinue;},void 0,function(){return _call(foo,_temp);}));})`,
	cases: whileCases,
});

compiledTest("while loop with predicate optimization", {
	input: `async function(foo) { let shouldContinue = true; function shouldContinueAsCall() { return shouldContinue; } while (await shouldContinueAsCall()) { shouldContinue = await foo(); } }`,
	output: `_async(function(foo){function shouldContinueAsCall(){return shouldContinue;}let shouldContinue=true;return _continueIgnored(_for(shouldContinueAsCall,void 0,function(){return _call(foo,function(_foo){shouldContinue=_foo;});}));})`,
	hoisted: `_async(function(foo){var _temp=function(_foo){shouldContinue=_foo;};function shouldContinueAsCall(){return shouldContinue;}let shouldContinue=true;return _continueIgnored(_for(shouldContinueAsCall,void 0,function(){return _call(foo,_temp);}));})`,
	cases: whileCases,
});

compiledTest("while loop with predicate optimization no-await bail out", {
	input: `async function(foo) { let shouldContinue = true; function shouldContinueAsCall() { return shouldContinue; } while (shouldContinueAsCall()) { shouldContinue = await foo(); } }`,
	output: `_async(function(foo){function shouldContinueAsCall(){return shouldContinue;}let shouldContinue=true;return _continueIgnored(_for(function(){return!!shouldContinueAsCall();},void 0,function(){return _call(foo,function(_foo){shouldContinue=_foo;});}));})`,
	hoisted: `_async(function(foo){var _temp=function(_foo){shouldContinue=_foo;};function shouldContinueAsCall(){return shouldContinue;}let shouldContinue=true;return _continueIgnored(_for(function(){return!!shouldContinueAsCall();},void 0,function(){return _call(foo,_temp);}));})`,
	cases: whileCases,
});

compiledTest("while loop with predicate optimization modify bail out", {
	input: `async function(foo) { let shouldContinue = true; let shouldContinueAsCall; shouldContinueAsCall = () => shouldContinue; while (await shouldContinueAsCall()) { shouldContinue = await foo(); } }`,
	output: `_async(function(foo){let shouldContinue=true;let shouldContinueAsCall;shouldContinueAsCall=()=>shouldContinue;return _continueIgnored(_for(function(){return _call(shouldContinueAsCall);},void 0,function(){return _call(foo,function(_foo){shouldContinue=_foo;});}));})`,
	hoisted: `_async(function(foo){var _temp=function(_foo){shouldContinue=_foo;};let shouldContinue=true;let shouldContinueAsCall;shouldContinueAsCall=()=>shouldContinue;return _continueIgnored(_for(function(){return _call(shouldContinueAsCall);},void 0,function(){return _call(foo,_temp);}));})`,
	cases: whileCases,
});

compiledTest("while predicate", {
	input: `async function(foo) { var count = 0; while(await foo()) { count++; } return count }`,
	output: `_async(function(foo){var count=0;return _continue(_for(foo,void 0,function(){count++;}),function(){return count;});})`,
	cases: {
		one: async f => {
			var count = 0;
			expect(await f(async _ => { ++count })).toBe(0);
			expect(count).toBe(1);
		},
		two: async f => {
			var count = 0;
			expect(await f(async _ => { ++count; return count < 2; })).toBe(1);
			expect(count).toBe(2);
		},
		seven: async f => {
			var count = 0;
			expect(await f(async _ => { ++count; return count < 7; })).toBe(6);
			expect(count).toBe(7);
		},
	},
});

compiledTest("while promise direct", {
	input: `async function() { while (Promise.resolve(false)) { await 1; return true; } return false; }`,
	output: `_async(function(){var _exit;return _continue(_for(function(){return!_exit&&!!Promise.resolve(false);},void 0,function(){return _await(1,function(){return _exit=true;});}),function(_result){return _exit?_result:false;});})`,
	hoisted: `_async(function(){var _exit,_exit2=function(){return _exit=true;};return _continue(_for(function(){return!_exit&&!!Promise.resolve(false);},void 0,function(){return _await(1,_exit2);}),function(_result){return _exit?_result:false;});})`,
	cases: {
		result: async f => expect(await f()).toBe(true),
	}
});

compiledTest("while promise indirect", {
	input: `async function() { function passthrough(value) { return value; } while (passthrough(true ? Promise.resolve(false) : await false)) { return true; } return false; }`,
	output: `_async(function(){var _exit;function passthrough(value){return value;}return _continue(_for(function(){return _await(!_exit&&(true?Promise.resolve(false):false),function(_false){return!_exit&&!!passthrough(_false);},true);},void 0,function(){return _exit=true;}),function(_result){return _exit?_result:false;});})`,
	hoisted: `_async(function(){var _exit,_temp=function(_false){return!_exit&&!!passthrough(_false);};function passthrough(value){return value;}return _continue(_for(function(){return _await(!_exit&&(true?Promise.resolve(false):false),_temp,true);},void 0,function(){return _exit=true;}),function(_result){return _exit?_result:false;});})`,
	cases: {
		result: async f => expect(await f()).toBe(true),
	}
});

compiledTest("do while loop", {
	input: `async function(foo) { let shouldContinue; do { shouldContinue = await foo(); } while(shouldContinue); }`,
	output: `_async(function(foo){let shouldContinue;return _continueIgnored(_do(function(){return _call(foo,function(_foo){shouldContinue=_foo;});},function(){return!!shouldContinue;}));})`,
	hoisted: `_async(function(foo){var _temp=function(_foo){shouldContinue=_foo;};let shouldContinue;return _continueIgnored(_do(function(){return _call(foo,_temp);},function(){return!!shouldContinue;}));})`,
	cases: {
		one: async f => {
			var count = 0;
			expect(await f(async _ => { ++count })).toBe(undefined);
			expect(count).toBe(1);
		},
		two: async f => {
			var count = 0;
			expect(await f(async _ => { ++count; return count < 2; })).toBe(undefined);
			expect(count).toBe(2);
		},
		seven: async f => {
			var count = 0;
			expect(await f(async _ => { ++count; return count < 7; })).toBe(undefined);
			expect(count).toBe(7);
		},
	},
});

compiledTest("do while return loop", {
	input: `async function(foo) { let shouldContinue; do { if (!await foo()) return true; } while(true); }`,
	output: `_async(function(foo){var _exit;let shouldContinue;return _do(function(){return _call(foo,function(_foo){if(!_foo)return _exit=true;});},function(){return!_exit;});})`,
	hoisted: `_async(function(foo){var _exit,_temp=function(_foo){if(!_foo)return _exit=true;};let shouldContinue;return _do(function(){return _call(foo,_temp);},function(){return!_exit;});})`,
	cases: {
		one: async f => {
			var count = 0;
			expect(await f(async _ => { ++count })).toBe(true);
			expect(count).toBe(1);
		},
		two: async f => {
			var count = 0;
			expect(await f(async _ => { ++count; return count < 2; })).toBe(true);
			expect(count).toBe(2);
		},
		seven: async f => {
			var count = 0;
			expect(await f(async _ => { ++count; return count < 7; })).toBe(true);
			expect(count).toBe(7);
		},
	},
});

compiledTest("for in await object", {
	input: `async function(foo) { var keys = []; for (var key in await foo()) { keys.push(key); }; return keys.sort(); }`,
	output: `function(foo){var keys=[];return _call(foo,function(_foo){for(var key in _foo){keys.push(key);}return keys.sort();});}`,
	cases: {
		two: async f => {
			var obj = { bar: 0, baz: 0 };
			expect(JSON.stringify(await f(async _ => obj))).toBe(`["bar","baz"]`);
		},
	},
});

compiledTest("for in await value", {
	input: `async function(foo) { var values = []; for (var key in foo) { values.push(await foo[key]()); }; return values.sort(); }`,
	output: `_async(function(foo){var values=[];return _continue(_forIn(foo,function(key){var _push=values.push;return _await(foo[key](),function(_foo$key){_push.call(values,_foo$key);});}),function(){return values.sort();});})`,
	cases: {
		two: async f => {
			var obj = { bar: async _ => 0, baz: async _ => 1 };
			expect(JSON.stringify(await f(obj))).toBe(`[0,1]`);
		},
	},
});

compiledTest("for in own await value on Object prototype", {
	input: `async function(foo) { var values = []; for (var key in foo) { if (Object.prototype.hasOwnProperty.call(foo, key)) { values.push(await foo[key]()); } } return values.sort(); }`,
	output: `_async(function(foo){var values=[];return _continue(_forOwn(foo,function(key){var _push=values.push;return _await(foo[key](),function(_foo$key){_push.call(values,_foo$key);});}),function(){return values.sort();});})`,
	cases: {
		two: async f => {
			var obj = { bar: async _ => 0, baz: async _ => 1 };
			expect(JSON.stringify(await f(obj))).toBe(`[0,1]`);
		},
	},
});

compiledTest("for in own await value on literal", {
	input: `async function(foo) { var values = []; for (var key in foo) { if ({}.hasOwnProperty.call(foo, key)) { values.push(await foo[key]()); } } return values.sort(); }`,
	output: `_async(function(foo){var values=[];return _continue(_forOwn(foo,function(key){var _push=values.push;return _await(foo[key](),function(_foo$key){_push.call(values,_foo$key);});}),function(){return values.sort();});})`,
	cases: {
		two: async f => {
			var obj = { bar: async _ => 0, baz: async _ => 1 };
			expect(JSON.stringify(await f(obj))).toBe(`[0,1]`);
		},
	},
});

compiledTest("for in await value with return", {
	input: `async function(foo) { for (var key in foo) { if (await foo[key]()) return true }; return false }`,
	output: `_async(function(foo){var _exit;return _continue(_forIn(foo,function(key){return _await(foo[key](),function(_foo$key){if(_foo$key)return _exit=true;});},function(){return _exit;}),function(_result){return _exit?_result:false;});})`,
	hoisted: `_async(function(foo){var _exit,_temp=function(_foo$key){if(_foo$key)return _exit=true;};return _continue(_forIn(foo,function(key){return _await(foo[key](),_temp);},function(){return _exit;}),function(_result){return _exit?_result:false;});})`,
	cases: {
		true: async f => {
			var obj = { foo: async _ => 0, bar: async _ => 1, baz: async _ => 0 };
			expect(await f(obj)).toBe(true);
		},
		false: async f => {
			var obj = { foo: async _ => 0, bar: async _ => 0, baz: async _ => 0 };
			expect(await f(obj)).toBe(false);
		},
	},
});

compiledTest("await for discriminant", {
	input: `async function(foo) { switch (await foo()) { case 1: return true; default: return false; } }`,
	output: `function(foo){return _call(foo,function(_foo){switch(_foo){case 1:return true;default:return false;}});}`,
	hoisted: `var _temp=function(_foo){switch(_foo){case 1:return true;default:return false;}};return function(foo){return _call(foo,_temp);}`,
	cases: {
		true: async f => {
			expect(await f(async () => 1)).toBe(true);
		},
		false: async f => {
			expect(await f(async () => 0)).toBe(false);
		},
	},
});

compiledTest("await for body", {
	input: `async function(foo, bar) { switch (foo()) { case 1: return await bar(); default: return false; } }`,
	output: `_async(function(foo,bar){switch(foo()){case 1:return bar();default:return false;}})`,
	cases: {
		zero: async f => {
			expect(await f(() => 1, async () => 0)).toBe(0);
		},
		one: async f => {
			expect(await f(() => 1, async () => 1)).toBe(1);
		},
		false: async f => {
			expect(await f(() => 0)).toBe(false);
		},
	},
});

compiledTest("await for body indirect optimized", {
	input: `async function(foo, bar) { switch (foo()) { case 1: var result = await bar(); return result; default: return false; } }`,
	output: `_async(function(foo,bar){switch(foo()){case 1:return bar();default:return false;}})`,
	cases: {
		zero: async f => {
			expect(await f(() => 1, async () => 0)).toBe(0);
		},
		one: async f => {
			expect(await f(() => 1, async () => 1)).toBe(1);
		},
		false: async f => {
			expect(await f(() => 0)).toBe(false);
		},
	},
});

compiledTest("await for body indirect unoptimized", {
	input: `async function(foo, bar) { switch (foo()) { case 1: var result = await bar(); return result || null; default: return false; } }`,
	output: `_async(function(foo,bar){switch(foo()){case 1:return _call(bar,function(result){return result||null;});default:return false;}})`,
	hoisted: `var _temp=function(result){return result||null;};return _async(function(foo,bar){switch(foo()){case 1:return _call(bar,_temp);default:return false;}})`,
	cases: {
		zero: async f => {
			expect(await f(() => 1, async () => 0)).toBe(null);
		},
		one: async f => {
			expect(await f(() => 1, async () => 1)).toBe(1);
		},
		false: async f => {
			expect(await f(() => 0)).toBe(false);
		},
	},
});

compiledTest("await case", {
	input: `async function(foo, bar) { switch (await foo()) { case await bar(): return true; default: return false; } }`,
	output: `function(foo,bar){return _call(foo,function(_foo){return _switch(_foo,[[function(){return _call(bar);},function(){return true;}],[void 0,function(){return false;}]]);});}`,
	hoisted: `var _true=function(){return true;},_false=function(){return false;};return function(foo,bar){var _bar2=function(){return _call(bar);};return _call(foo,function(_foo){return _switch(_foo,[[_bar2,_true],[void 0,_false]]);});}`,
	cases: {
		true: async f => {
			expect(await f(async () => 1, async () => 1)).toBe(true);
		},
		false: async f => {
			expect(await f(async () => 1, async () => 0)).toBe(false);
		},
	},
});

compiledTest("await break", {
	input: `async function(foo, bar) { var result; switch (await foo()) { case await bar(): result = true; break; default: result = false; break; } return result; }`,
	output: `function(foo,bar){var result;return _call(foo,function(_foo){return _continue(_switch(_foo,[[function(){return _call(bar);},function(){result=true;}],[void 0,function(){result=false;}]]),function(){return result;});});}`,
	hoisted: `function(foo,bar){var _bar2=function(){return _call(bar);},_temp=function(){result=true;},_temp2=function(){result=false;},_result=function(){return result;};var result;return _call(foo,function(_foo){return _continue(_switch(_foo,[[_bar2,_temp],[void 0,_temp2]]),_result);});}`,
	cases: {
		true: async f => {
			expect(await f(async () => 1, async () => 1)).toBe(true);
		},
		false: async f => {
			expect(await f(async () => 1, async () => 0)).toBe(false);
		},
	},
});

compiledTest("await complex switch", {
	input: `async function(foo, bar, baz) { switch (foo) { case 1: case 2: return 0; case await bar(): if (foo) break; if (foo === 0) return 1; case 5: baz(); default: return 2; } return 3; }`,
	output: `_async(function(foo,bar,baz){var _exit,_interrupt;return _continue(_switch(foo,[[function(){return 1;}],[function(){return 2;},function(){_exit=1;return 0;}],[function(){return _call(bar);},function(){if(foo){_interrupt=1;return;}if(foo===0)return _exit=1;},function(){return _interrupt||_exit;}],[function(){return 5;},function(){baz();},_empty],[void 0,function(){return _exit=2;}]]),function(_result){return _exit?_result:3;});})`,
	hoisted: `var _one=function(){return 1;},_two=function(){return 2;},_five=function(){return 5;};return _async(function(foo,bar,baz){var _exit,_interrupt;return _continue(_switch(foo,[[_one],[_two,function(){_exit=1;return 0;}],[function(){return _call(bar);},function(){if(foo){_interrupt=1;return;}if(foo===0)return _exit=1;},function(){return _interrupt||_exit;}],[_five,function(){baz();},_empty],[void 0,function(){return _exit=2;}]]),function(_result){return _exit?_result:3;});})`,
	cases: {
		fallthrough: async f => {
			expect(await f(1)).toBe(0);
		},
		direct: async f => {
			expect(await f(2)).toBe(0);
		},
		break: async f => {
			expect(await f(3, async () => 3)).toBe(3);
		},
		return: async f => {
			expect(await f(0, async () => 0)).toBe(1);
		},
		default: async f => {
			expect(await f(0, async () => 2)).toBe(2);
		},
		"fallthrough with code": async f => {
			let called = false;
			expect(await f(5, async () => 2, () => called = true)).toBe(2);
			expect(called).toBe(true);
		},
	},
});

compiledTest("for break with identifier", {
	input: `async function(foo) { loop: for (;;) { await foo(); break loop; } }`,
	output: `_async(function(foo){var _loopInterrupt;loop:return _continueIgnored(_for(function(){return!_loopInterrupt;},void 0,function(){return _call(foo,function(){_loopInterrupt=1;});}));})`,
	hoisted: `_async(function(foo){var _loopInterrupt,_temp=function(){_loopInterrupt=1;};loop:return _continueIgnored(_for(function(){return!_loopInterrupt;},void 0,function(){return _call(foo,_temp);}));})`,
});

compiledTest("switch break with identifier", {
	input: `async function(foo) { exit: switch (0) { default: await foo(); break exit; } }`,
	output: `_async(function(foo){var _exitInterrupt;return _continueIgnored(_switch(0,[[void 0,function(){return _call(foo,function(){_exitInterrupt=1;});}]]));})`,
	hoisted: `_async(function(foo){var _exitInterrupt,_temp=function(){_exitInterrupt=1;};return _continueIgnored(_switch(0,[[void 0,function(){return _call(foo,_temp);}]]));})`,
});

compiledTest("break labeled statement", {
	input: `async function(foo) { labeled: { if (await foo()) { break labeled; } return false; } return true; }`,
	output: `function(foo){var _exit,_labeledInterrupt;return _invoke(function(){return _call(foo,function(_foo){if(_foo){_labeledInterrupt=1;return;}_exit=1;return false;});},function(_result){return _await(_exit?_result:true);});}`,
	hoisted: `function(foo){var _exit,_labeledInterrupt,_temp=function(_foo){if(_foo){_labeledInterrupt=1;return;}_exit=1;return false;};return _invoke(function(){return _call(foo,_temp);},function(_result){return _await(_exit?_result:true);});}`,
	cases: {
		true: async f => expect(await f(() => 1)).toEqual(true),
		false: async f => expect(await f(() => 0)).toEqual(false),
	}
});

compiledTest("break with multiple labeled statements", {
	input: `async function(foo) { outer: { inner: { if (await foo()) { break outer; } } return false; } return true; }`,
	output: `function(foo){var _exit,_outerInterrupt;return _invoke(function(){return _invoke(function(){return _call(foo,function(_foo){if(_foo){_outerInterrupt=1;}});},function(){if(_outerInterrupt)return;_exit=1;return false;});},function(_result){return _await(_exit?_result:true);});}`,
	hoisted: `function(foo){var _exit,_outerInterrupt,_temp=function(_foo){if(_foo){_outerInterrupt=1;}},_foo2=function(){return _call(foo,_temp);},_temp2=function(){if(_outerInterrupt)return;_exit=1;return false;};return _invoke(function(){return _invoke(_foo2,_temp2);},function(_result){return _await(_exit?_result:true);});}`,
	cases: {
		true: async f => expect(await f(() => 1)).toEqual(true),
		false: async f => expect(await f(() => 0)).toEqual(false),
	}
});

compiledTest("fetch example", {
	input: `async function(url) { const response = await fetch(url); const blob = await response.blob(); return URL.createObjectURL(blob); }`,
	output: `_async(function(url){return _await(fetch(url),function(response){return _await(response.blob(),function(blob){return URL.createObjectURL(blob);});});})`,
	hoisted: `var _URL$createObjectURL=function(blob){return URL.createObjectURL(blob);},_response$blob=function(response){return _await(response.blob(),_URL$createObjectURL);};return _async(function(url){return _await(fetch(url),_response$blob);})`,
});

compiledTest("array literal", {
	input: `async function(left, right) { return [undefined | 0, left(), [true,"",{foo:1}]&&2, await right(), 4] }`,
	output: `_async(function(left,right){var _left=left();return _call(right,function(_right){return[undefined|0,_left,[true,"",{foo:1}]&&2,_right,4];});})`,
	cases: {
		value: async f => {
			expect(await f(() => 1, async () => 3)).toEqual([0, 1, 2, 3, 4]);
		},
		order: async f => {
			var leftCalled = false;
			await f(() => (expect(leftCalled).toBe(false), leftCalled = true), () => expect(leftCalled).toBe(true));
			expect(leftCalled).toBe(true);
		},
	}
});

compiledTest("object literal", {
	input: `async function(left, right, two) { return { zero: 0, one: left(), [two()]: 2, three: await right(), four: 4 } }`,
	output: `_async(function(left,right,two){var _two=two(),_left=left();return _call(right,function(_right){return{zero:0,one:_left,[_two]:2,three:_right,four:4};});})`,
	cases: {
		value: async f => {
			expect(await f(() => 1, async () => 3, () => "two")).toEqual({ zero: 0, one: 1, two: 2, three: 3, four: 4 });
		},
		order: async f => {
			var leftCalled = false;
			await f(() => (expect(leftCalled).toBe(false), leftCalled = true), () => expect(leftCalled).toBe(true), () => "two");
			expect(leftCalled).toBe(true);
		},
	}
});

compiledTest("sequence expression", {
	input: `async function(left, right) { return ((await left()), 1, (await right())) }`,
	output: `function(left,right){return _call(left,function(){return _call(right);});}`,
	cases: {
		value: async f => {
			expect(await f(async () => false, async () => true)).toEqual(true);
		},
		order: async f => {
			var leftCalled = false;
			await f(() => (expect(leftCalled).toBe(false), leftCalled = true), () => expect(leftCalled).toBe(true));
			expect(leftCalled).toBe(true);
		},
	}
});

compiledTest("class methods", {
	input: `function() { return class { async foo(baz) { return await baz(); } static async bar(baz) { return await baz(); } } }`,
	output: `function(){return class{foo(baz){return _call(function(){return _call(baz);});}static bar(baz){return _call(function(){return _call(baz);});}};}`,
	cases: {
		method: async f => expect(await (new (f())).foo(async () => true)).toBe(true),
		"class method": async f => expect(await f().bar(async () => true)).toBe(true),
	}
});

compiledTest("class methods with pseudo-variables", {
	input: `function() { return class { async testThis() { return this; } async testArguments() { return arguments[0]; } }; }`,
	output: `function(){return class{testThis(){var _this=this;return _call(function(){return _this;});}testArguments(){var _arguments=arguments;return _call(function(){return _arguments[0];});}};}`,
	cases: {
		"this": async f => {
			const object = new (f());
			expect(await object.testThis()).toBe(object);
		},
		"arguments": async f => {
			const object = new (f());
			expect(await object.testArguments(1)).toBe(1);
		},
	}
});

compiledTest("object method syntax", {
	input: `function() { return { async foo(bar) { return await bar(); } }; }`,
	output: `function(){return{foo:function(bar){return _call(bar);}};}`,
	cases: {
		method: async f => expect(await f().foo(async () => true)).toBe(true),
	}
});

compiledTest("variable hoisting", {
	input: `async function(foo) { function baz() { return bar; } var bar = await foo(); return baz(); }`,
	output: `function(foo){var bar;function baz(){return bar;}return _call(foo,function(_foo){bar=_foo;return baz();});}`,
	cases: {
		value: async f => expect(await f(() => true)).toBe(true),
	}
});

compiledTest("complex hoisting", {
	input: `async function(foo, baz) { if (foo()) { var result = await bar(); function bar() { return 1; } } else { result = await baz(); }; return result; }`,
	output: `_async(function(foo,baz){var result;return _invoke(function(){if(foo()){function bar(){return 1;}return _call(bar,function(_bar){result=_bar;});}else{return _call(baz,function(_baz){result=_baz;});}},function(){return result;});})`,
	hoisted: `_async(function(foo,baz){var result,_temp=function(_bar){result=_bar;},_temp2=function(_baz){result=_baz;};return _invoke(function(){if(foo()){function bar(){return 1;}return _call(bar,_temp);}else{return _call(baz,_temp2);}},function(){return result;});})`,
	cases: {
		consequent: async f => expect(await f(_ => true, async _ => 0)).toBe(1),
		alternate: async f => expect(await f(_ => false, async _ => 0)).toBe(0),
	},
});

compiledTest("for loop hoisting", {
	input: `async function(foo) { i = await foo(); for (var i in {}) {} return i; }`,
	output: `function(foo){var i;return _call(foo,function(_foo){i=_foo;for(i in{}){}return i;});}`,
	cases: {
		value: async f => expect(await f(() => true)).toBe(true),
	}
});

compiledTest("function hoisting", {
	input: `fun();

function wait() {
    return Promise.resolve();
}

var dummy;

async function fun() {
    await wait();
    return true;
}`,
	cases: {
		run: async f => expect(await f).toEqual(true),
	}
});

compiledTest("export hoisting", {
	input: `foo();
let dummy;
export async function foo() { return await Promise.resolve(true); }
`,
	output: `export const foo=_async(function(){return Promise.resolve(true);});foo();let dummy;`,
	checkSyntax: false,
	module: true,
});


compiledTest("helper names", {
	input: `async function(_async, _await) { return await _async(0) && _await(); }`,
	// Output test doesn't work now that we have a more precise check
	// output: `_async3(function(_async,_await){return _await2(_async(0),function(_async2){return _async2&&_await();});})`,
	cases: {
		value: async f => expect(await f(_ => true, _ => true)).toBe(true),
	},
});

compiledTest("for of await double with break", {
	input: `async function(matrix) { var result = 0; outer: for (var row of matrix) { for (var value of row) { result += await value; if (result > 10) break outer; } } return result; }`,
	output: `_async(function(matrix){var _outerInterrupt;var result=0;return _continue(_forOf(matrix,function(row){return _continueIgnored(_forOf(row,function(value){return _await(value,function(_value){result+=_value;if(result>10){_outerInterrupt=1;}});},function(){return _outerInterrupt;}));}),function(){return result;});})`,
	hoisted: `_async(function(matrix){var _outerInterrupt,_temp=function(_value){result+=_value;if(result>10){_outerInterrupt=1;}},_value2=function(value){return _await(value,_temp);},_outerInterrupt2=function(){return _outerInterrupt;};var result=0;return _continue(_forOf(matrix,function(row){return _continueIgnored(_forOf(row,_value2,_outerInterrupt2));}),function(){return result;});})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([[1]])).toBe(1),
		multiple: async f => expect(await f([[1,2],[3,4]])).toBe(10),
		break: async f => expect(await f([[1,10,4],[5,4]])).toBe(11),
	},
});

compiledTest("for of await double with break and two labels", {
	input: `async function(matrix) { var result = 0; outer: for (var row of matrix) { inner: for (var value of row) { result += await value; if (result > 10) break outer; if (result < 0) break inner; } } return result; }`,
	output: `_async(function(matrix){var _outerInterrupt;var result=0;return _continue(_forOf(matrix,function(row){var _innerInterrupt;return _continueIgnored(_forOf(row,function(value){return _await(value,function(_value){result+=_value;if(result>10){_outerInterrupt=_innerInterrupt=1;return;}if(result<0){_innerInterrupt=1;}});},function(){return _innerInterrupt||_outerInterrupt;}));}),function(){return result;});})`,
	hoisted: `_async(function(matrix){var _outerInterrupt;var result=0;return _continue(_forOf(matrix,function(row){var _innerInterrupt,_temp=function(_value){result+=_value;if(result>10){_outerInterrupt=_innerInterrupt=1;return;}if(result<0){_innerInterrupt=1;}};return _continueIgnored(_forOf(row,function(value){return _await(value,_temp);},function(){return _innerInterrupt||_outerInterrupt;}));}),function(){return result;});})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([[1]])).toBe(1),
		multiple: async f => expect(await f([[1,2],[3,4]])).toBe(10),
		outer: async f => expect(await f([[1,10,4],[5,4]])).toBe(11),
		inner: async f => expect(await f([[-1,10],[5,4]])).toBe(8),
	},
});

compiledTest("for of await double with continue", {
	input: `async function(matrix) { var result = 0; outer: for (var row of matrix) { inner: for (var cell of row) { const value = await cell; if (value > 10) continue inner; result += value; if (result < 0) continue outer; } } return result; }`,
	output: `_async(function(matrix){var result=0;return _continue(_forOf(matrix,function(row){var _innerInterrupt;return _continueIgnored(_forOf(row,function(cell){return _await(cell,function(value){if(value>10)return;result+=value;if(result<0){_innerInterrupt=1;}});},function(){return _innerInterrupt;}));}),function(){return result;});})`,
	hoisted: `_async(function(matrix){var result=0;return _continue(_forOf(matrix,function(row){var _innerInterrupt,_temp=function(value){if(value>10)return;result+=value;if(result<0){_innerInterrupt=1;}};return _continueIgnored(_forOf(row,function(cell){return _await(cell,_temp);},function(){return _innerInterrupt;}));}),function(){return result;});})`,
	cases: {
		empty: async f => expect(await f([])).toBe(0),
		single: async f => expect(await f([[1]])).toBe(1),
		multiple: async f => expect(await f([[1,2],[3,4]])).toBe(10),
		outer: async f => expect(await f([[-1,10],[5,4]])).toBe(8),
		inner: async f => expect(await f([[11,10],[5,4]])).toBe(19),
	},
});


const orderCases = {
	immediate: async f => {
		var state;
		const promise = f(false, () => state = true);
		state = false;
		await promise;
		expect(state).toBe(false);
	},
	delayed: async f => {
		var state;
		const promise = f(true, () => state = true);
		state = false;
		await promise;
		expect(state).toBe(true);
	},
};

compiledTest("ternary alternate event loop ordering", {
	input: `async function(delay, callback) { return callback(delay ? await 0 : 0); }`,
	output: `_async(function(delay,callback){return _await(0,callback,!delay);})`,
	cases: orderCases,
});

compiledTest("ternary consequent event loop ordering", {
	input: `async function(delay, callback) { return callback(!delay ? 0 : await 0); }`,
	output: `_async(function(delay,callback){return _await(0,callback,!delay);})`,
	cases: orderCases,
});

compiledTest("logical and alternate event loop ordering", {
	input: `async function(delay, callback) { return callback(delay && await 0); }`,
	output: `_async(function(delay,callback){return _await(delay&&0,callback,!delay);})`,
	cases: orderCases,
});

compiledTest("logical or consequent event loop ordering", {
	input: `async function(delay, callback) { return callback(!delay || await 0); }`,
	output: `_async(function(delay,callback){return _await(!delay||0,callback,!delay);})`,
	cases: orderCases,
});

compiledTest("if consequent event loop ordering", {
	input: `async function(delay, callback) { if (delay) await 0; return callback(); }`,
	output: `_async(function(delay,callback){return _invoke(function(){if(delay)return _awaitIgnored(0);},function(){return callback();});})`,
	cases: orderCases,
});

compiledTest("if alternate event loop ordering", {
	input: `async function(delay, callback) { if (!delay) { } else { await 0 }; return callback(); }`,
	output: `_async(function(delay,callback){return _invoke(function(){if(!delay){}else{return _awaitIgnored(0);}},function(){return callback();});})`,
	cases: orderCases,
});

compiledTest("for to event loop ordering", {
	input: `async function(delay, callback) { var array = [0,1,2,3,4]; for (var i = 0; i < array.length; i++) { if (delay) { await array[i]; } }; return callback(); }`,
	output: `_async(function(delay,callback){var array=[0,1,2,3,4];return _continue(_forTo(array,function(i){return _invokeIgnored(function(){if(delay){return _awaitIgnored(array[i]);}});}),function(){return callback();});})`,
	cases: orderCases,
});

compiledTest("switch event loop ordering", {
	input: `async function(delay, callback) { switch(delay) { case false: break; case true: await true; break; } return callback(); }`,
	output: `_async(function(delay,callback){var _interrupt;return _continue(_switch(delay,[[function(){return false;},function(){_interrupt=1;}],[function(){return true;},function(){return _await(true,function(){_interrupt=1;});}]]),function(){return callback();});})`,
	hoisted: `var _false=function(){return false;},_true=function(){return true;};return _async(function(delay,callback){var _interrupt,_temp=function(){_interrupt=1;};return _continue(_switch(delay,[[_false,function(){_interrupt=1;}],[_true,function(){return _await(true,_temp);}]]),function(){return callback();});})`,
	cases: orderCases,
});

compiledTest("for await of event loop ordering", {
	input: `async function(iter, callback) { for await (var value of iter) { }; return callback(); }`,
	output: `_async(function(iter,callback){return _continue(_forAwaitOf(iter,_empty),function(){return callback();});})`,
	cases: {
		empty: async f => {
			var state;
			const promise = f([], () => state = true);
			state = false;
			await promise;
			expect(state).toBe(true);
		},
		single: async f => {
			var state;
			const promise = f([1], () => state = true);
			state = false;
			await promise;
			expect(state).toBe(true);
		},
		multiple: async f => {
			var state;
			const promise = f([1, 2], () => state = true);
			state = false;
			await promise;
			expect(state).toBe(true);
		},
	}
});

compiledTest("Object spreading", {
	input: `async function(foo) { const { bar } = await foo(); return bar; }`,
	output: `function(foo){return _call(foo,function(_foo){const{bar}=_foo;return bar;});}`,
	hoisted: `var _temp=function(_foo){const{bar}=_foo;return bar;};return function(foo){return _call(foo,_temp);}`,
	cases: {
		value: async f => expect(await f(() => ({ bar: "baz" }))).toBe("baz"),
	},
});

compiledTest("Array spreading", {
	input: `async function(foo) { const [bar] = await foo(); return bar; }`,
	output: `function(foo){return _call(foo,function(_foo){const[bar]=_foo;return bar;});}`,
	hoisted: `var _temp=function(_foo){const[bar]=_foo;return bar;};return function(foo){return _call(foo,_temp);}`,
	cases: {
		value: async f => expect(await f(() => ["baz"])).toBe("baz"),
	},
});


compiledTest("Complex continuation ordering", {
	input: `() => {
		let index = 0;
		let promise = null;
		let messages = [];

		async function test() {
		    let promiseResolve;
		    let num = ++index;

		    messages.push("start " + num);

		    // place of interest
		    while (promise) {
		        messages.push("wait " + num);

		        await promise;
		    }

		    promise = new Promise(r => {
		        promiseResolve = r;
		    });

		    await wait();

		    promise = null;

		    promiseResolve();

		    messages.push("stop " + num);
		}

		function wait() {
		    return Promise.resolve();
		}

		return Promise.all([test(), test(), test()]).then(() => messages);
	}`,
	cases: {
		result: async f => expect(await f()).toEqual(['start 1', 'start 2', 'wait 2', 'start 3', 'wait 3', 'stop 1', 'wait 3', 'stop 2', 'stop 3']),
	},
});

compiledTest("try...catch...finally event loop ordering", {
	input: `async function() {
		let waitIndex = 0;
		const messages = [];
		messages.push('start');
		function wait() {
			let index = ++waitIndex;

			messages.push("waitStart" + index);

			return Promise.resolve()
				.then(() => {
					messages.push("waitStop" + index);
				});
		}
		try {
			messages.push('tryStart');
			await wait();
			messages.push('tryStop');
		} catch (err) {
			messages.push('catchStart');
			await wait();
			messages.push('catchStop');
		} finally {
			messages.push('finallyStart');
			await wait();
			messages.push('finallyStop');
		}
		messages.push('stop');
		return messages;
	}`,
	output: `_async(function(){let waitIndex=0;const messages=[];function wait(){let index=++waitIndex;messages.push("waitStart"+index);return Promise.resolve().then(()=>{messages.push("waitStop"+index);});}messages.push('start');return _continue(_finallyRethrows(function(){return _catch(function(){messages.push('tryStart');return _call(wait,function(){messages.push('tryStop');});},function(){messages.push('catchStart');return _call(wait,function(){messages.push('catchStop');});});},function(_wasThrown,_result){messages.push('finallyStart');return _call(wait,function(){messages.push('finallyStop');return _rethrow(_wasThrown,_result);});}),function(){messages.push('stop');return messages;});})`,
	hoisted: `_async(function(){var _temp=function(){messages.push('tryStop');},_temp2=function(){messages.push('catchStop');},_temp3=function(){messages.push('finallyStop');};let waitIndex=0;const messages=[];function wait(){let index=++waitIndex;messages.push("waitStart"+index);return Promise.resolve().then(()=>{messages.push("waitStop"+index);});}messages.push('start');return _continue(_finallyRethrows(function(){return _catch(function(){messages.push('tryStart');return _call(wait,_temp);},function(){messages.push('catchStart');return _call(wait,_temp2);});},function(_wasThrown,_result){messages.push('finallyStart');return _call(wait,function(){messages.push('finallyStop');return _rethrow(_wasThrown,_result);});}),function(){messages.push('stop');return messages;});})`,
	cases: {
		result: async f => expect(await f()).toEqual(['start', 'tryStart', 'waitStart1', 'waitStop1', 'tryStop', 'finallyStart', 'waitStart2', 'waitStop2', 'finallyStop', 'stop']),
	},
});

compiledTest("switch event loop ordering complex", {
	input: `Promise.all([test('case1'), test('case2'), test('case3')]);
function wait(messages) {
    messages.push('waitStart');

    return new Promise((resolve, reject) => setTimeout(resolve, 0))
        .then(() => {
            messages.push('waitStop');
        });
}

async function test(v) {
    let messages = [];

    switch (v) {
        case 'case1':
            messages.push('case1Start');
            await wait(messages);
            messages.push('case1Stop');
            break;
        case 'case2':
            messages.push('case2Start');
            await wait(messages);
            messages.push('case2Stop');
            // through
        case 'case3':
            messages.push('case3Start');
            await wait(messages);
            messages.push('case3Stop');
            break;
    }

    return messages;
}`,
	output: `var test=_async(function(v){var _interrupt;let messages=[];return _continue(_switch(v,[[function(){return'case1';},function(){messages.push('case1Start');return _await(wait(messages),function(){messages.push('case1Stop');_interrupt=1;});}],[function(){return'case2';},function(){messages.push('case2Start');return _await(wait(messages),function(){messages.push('case2Stop');});},_empty],[function(){return'case3';},function(){messages.push('case3Start');return _await(wait(messages),function(){messages.push('case3Stop');_interrupt=1;});}]]),function(){return messages;});});return Promise.all([test('case1'),test('case2'),test('case3')]);function wait(messages){messages.push('waitStart');return new Promise((resolve,reject)=>setTimeout(resolve,0)).then(()=>{messages.push('waitStop');});}`,
	hoisted: `var _caseone=function(){return'case1';},_casetwo=function(){return'case2';},_casethree=function(){return'case3';},_caseone2=function(){return'case1';},_casetwo2=function(){return'case2';},_casethree2=function(){return'case3';};var test=_async(function(v){var _interrupt,_temp=function(){messages.push('case1Stop');_interrupt=1;},_temp2=function(){messages.push('case2Stop');},_temp3=function(){messages.push('case3Stop');_interrupt=1;},_temp4=function(){messages.push('case2Stop');},_temp5=function(){messages.push('case1Stop');_interrupt=1;},_temp6=function(){messages.push('case3Stop');_interrupt=1;},_temp7=function(){messages.push('case1Start');return _await(wait(messages),_temp5);},_temp8=function(){messages.push('case2Start');return _await(wait(messages),_temp4);},_temp9=function(){messages.push('case3Start');return _await(wait(messages),_temp6);},_messages=function(){return messages;};let messages=[];return _continue(_switch(v,[[_caseone,function(){messages.push('case1Start');return _await(wait(messages),_temp);}],[_casetwo,function(){messages.push('case2Start');return _await(wait(messages),_temp2);},_empty],[_casethree,function(){messages.push('case3Start');return _await(wait(messages),_temp3);}]]),function(){return messages;});});return Promise.all([test('case1'),test('case2'),test('case3')]);function wait(messages){messages.push('waitStart');return new Promise((resolve,reject)=>setTimeout(resolve,0)).then(()=>{messages.push('waitStop');});}`,
	cases: {
		run: async v => {
			expect(await v).toEqual([
				['case1Start', 'waitStart', 'waitStop', 'case1Stop'],
				['case2Start', 'waitStart', 'waitStop', 'case2Stop', 'case3Start', 'waitStart', 'waitStop', 'case3Stop'],
				['case3Start', 'waitStart', 'waitStop', 'case3Stop']
			]);
		}
	}
});

compiledTest("invoke rewrite with empty continuation", {
	input: `async function(expression1, expression2, actionAsync) {
	    if (expression1) {
	        return;
	    }

	    if (expression2) {
			var a = 1;
	    } else {
	        try {
	            let res = await actionAsync();
	            var b = 2;
	            return res;
	        }
	        catch (error) {
	            return false;
	        };
	    }
	}`,
	output: `_async(function(expression1,expression2,actionAsync){if(expression1){return;}return function(){if(expression2){var a=1;}else{return _catch(function(){return _call(actionAsync,function(res){var b=2;return res;});},function(){return false;});}}();})`,
	hoisted: `var _temp=function(res){var b=2;return res;},_false=function(){return false;};return _async(function(expression1,expression2,actionAsync){var _actionAsync=function(){return _call(actionAsync,_temp);};if(expression1){return;}return function(){if(expression2){var a=1;}else{return _catch(_actionAsync,_false);}}();})`,
	cases: {
		result: async f => expect(await f(false, false, () => true)).toBe(true),
	},
});

compiledTest("return inside try", {
	input: `async function test(wait, messages) {
    messages.push('before-try');
    try {
        messages.push('start-try');
        await wait(1);
        messages.push('stop-try');

        return 'result-try';
    }
    catch (e) {
        messages.push('catch');
    }
    messages.push('after-try');

    return 'result-after-try';
}`,
	output: `_async(function(wait,messages){var _exit;messages.push('before-try');return _continue(_catch(function(){messages.push('start-try');return _await(wait(1),function(){messages.push('stop-try');_exit=1;return'result-try';});},function(){messages.push('catch');}),function(_result){if(_exit)return _result;messages.push('after-try');return'result-after-try';});})`,
	hoisted: `_async(function(wait,messages){var _exit,_temp=function(){messages.push('stop-try');_exit=1;return'result-try';};messages.push('before-try');return _continue(_catch(function(){messages.push('start-try');return _await(wait(1),_temp);},function(){messages.push('catch');}),function(_result){if(_exit)return _result;messages.push('after-try');return'result-after-try';});})`,
	cases: {
		value: async f => expect(await f(() => 0, [])).toBe('result-try'),
		messages: async f => {
			const messages = [];
			messages.push(await f((index) => {
				messages.push(`waitStart${index}`);
				return Promise.resolve().then(() => messages.push(`waitStop${index}`));
			}, messages));
			messages.push("stop");
			expect(messages).toEqual([
				"before-try",
				"start-try",
				"waitStart1",
				"waitStop1",
				"stop-try",
				"result-try",
				"stop",
			]);
		}
	}
});


compiledTest("eval is evil", {
	input: `async function(code) { return await eval(code); }`,
	error: /Calling eval from inside an async function is not supported\!/,
});
