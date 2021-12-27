import {
	JSXNamespacedName,
	ArgumentPlaceholder,
	ArrowFunctionExpression,
	AssignmentPattern,
	AwaitExpression,
	BlockStatement,
	CallExpression,
	ClassMethod,
	LabeledStatement,
	Node,
	Expression,
	FunctionDeclaration,
	Statement,
	Identifier,
	ForStatement,
	ForInStatement,
	SpreadElement,
	ReturnStatement,
	ForOfStatement,
	Function,
	FunctionExpression,
	Literal,
	LogicalExpression,
	MemberExpression,
	NumericLiteral,
	ThisExpression,
	SwitchCase,
	Program,
	VariableDeclaration,
	VariableDeclarator,
	StringLiteral,
	BooleanLiteral,
	Pattern,
	LVal,
	ObjectPattern,
	RestElement,
	TSParameterProperty,
	YieldExpression,
	PatternLike,
	V8IntrinsicIdentifier,
	PrivateName,
} from "@babel/types";
import { NodePath, Scope, Visitor } from "@babel/traverse";
import { PluginObj } from "@babel/core";
import { code as helperCode } from "./helpers-string";

// Configuration types
interface AsyncToPromisesConfiguration {
	externalHelpers: boolean;
	hoist: boolean;
	inlineHelpers: boolean;
	minify: boolean;
	target: "es5" | "es6";
	topLevelAwait: "disabled" | "simple" | "return" | "ignore";
}

const defaultConfigValues: AsyncToPromisesConfiguration = {
	externalHelpers: false,
	hoist: false,
	inlineHelpers: false,
	minify: false,
	target: "es5",
	topLevelAwait: "disabled",
} as const;

function readConfigKey<K extends keyof AsyncToPromisesConfiguration>(
	config: Partial<Readonly<AsyncToPromisesConfiguration>>,
	key: K
): AsyncToPromisesConfiguration[K] {
	if (Object.hasOwnProperty.call(config, key)) {
		const result = config[key];
		if (typeof result !== "undefined") {
			return result as AsyncToPromisesConfiguration[K];
		}
	}
	return defaultConfigValues[key];
}

function discardingIntrinsics<T extends Node>(node: T | V8IntrinsicIdentifier): Exclude<T, V8IntrinsicIdentifier> {
	if (node.type == "V8IntrinsicIdentifier") {
		throw new Error(`Expected either an expression or a statement, got a ${node.type}!`);
	}
	return node as Exclude<T, V8IntrinsicIdentifier>;
}

function clearDeclarationData(declaration: NodePath<VariableDeclaration>) {
	let path: NodePath | null = declaration;
	while (path) {
		if (path.getData("declaration:var:2") == declaration) {
			path.setData("declaration:var:2", null);
		}
		path = path.parentPath;
	}
}

const constantFunctionMethods: { readonly [name: string]: boolean } = {
	"call": false,
	"apply": false,
	"bind": false,
};

const constantStaticMethods: { readonly [name: string]: { readonly [name: string]: boolean } } = {
	"Object": {
		"assign": true,
		"create": true,
		"defineProperty": true,
		"defineProperties": true,
		"entries": true,
		"freeze": true,
		"fromEntries": true,
		"getOwnPropertyDescriptor": true,
		"getOwnPropertyDescriptors": true,
		"getOwnPropertyNames": true,
		"getOwnPropertySymbols": true,
		"getPrototypeOf": true,
		"is": true,
		"isExtensible": true,
		"isFrozen": true,
		"isSealed": true,
		"keys": true,
		"preventExtensions": true,
		"seal": true,
		"setPrototypeOf": true,
		"values": true,
		...constantFunctionMethods,
	},
	"Function": constantFunctionMethods,
	"Boolean": constantFunctionMethods,
	"Number": {
		"isNaN": true,
		"isFinite": true,
		"isInteger": true,
		"isSafeInteger": true,
		"parseFloat": true,
		"parseInteger": true,
		...constantFunctionMethods,
	},
	"Array": {
		"from": true,
		"isArray": true,
		"of": true,
		...constantFunctionMethods,
	},
	"Date": {
		"now": true,
		"parse": true,
		"UTC": true,
		...constantFunctionMethods,
	},
	"RegExp": constantFunctionMethods,
	"Error": constantFunctionMethods,
	"TypeError": constantFunctionMethods,
	"Map": constantFunctionMethods,
	"Set": constantFunctionMethods,
	"WeakMap": constantFunctionMethods,
	"WeakSet": constantFunctionMethods,
	"Promise": {
		"all": true,
		"race": true,
		"resolve": true,
		"reject": true,
		...constantFunctionMethods,
	},
	"Math": {
		"abs": true,
		"acos": true,
		"asin": true,
		"atan": true,
		"atan2": true,
		"ceil": true,
		"cos": true,
		"exp": true,
		"floor": true,
		"log": true,
		"max": true,
		"min": true,
		"pow": true,
		"random": true,
		"round": true,
		"sin": true,
		"sqrt": true,
		"tan": true,
	},
	"JSON": {
		"parse": true,
		"stringify": true,
	},
	"URL": {
		"createObjectURL": true,
		"revokeObjectURL": true,
		...constantFunctionMethods,
	},
	"console": {
		"assert": true,
		"clear": true,
		"count": true,
		"error": true,
		"info": true,
		"log": true,
		"warn": true,
	},
	"document": {
		"createComment": true,
		"createElement": true,
		"createTextNode": true,
		"getElementsByClassName": true,
		"getElementsByTagName": true,
		"getElementsByName": true,
		"getElementById": true,
		"querySelector": true,
		"querySelectorAll": true,
		"write": true,
		"writeln": true,
	},
	"XMLHttpRequest": constantFunctionMethods,
	"WebSocket": constantFunctionMethods,
	"Image": constantFunctionMethods,
	"alert": constantFunctionMethods,
	"confirm": constantFunctionMethods,
	"open": constantFunctionMethods,
	"prompt": constantFunctionMethods,
	"eval": constantFunctionMethods,
	"isFinite": constantFunctionMethods,
	"isNaN": constantFunctionMethods,
	"parseInt": constantFunctionMethods,
	"parseFloat": constantFunctionMethods,
	"decodeURI": constantFunctionMethods,
	"decodeURIComponent": constantFunctionMethods,
	"encodeURI": constantFunctionMethods,
	"encodeURIComponent": constantFunctionMethods,
	"escape": constantFunctionMethods,
	"unescape": constantFunctionMethods,
	"$": constantFunctionMethods,
} as const;

type HelperName =
	| "_async"
	| "_await"
	| "_empty"
	| "_call"
	| "_yield"
	| "_continue"
	| "_continueIgnored"
	| "_catch"
	| "_catchInGenerator"
	| "_finally"
	| "_finallyRethrows"
	| "_invoke"
	| "_invokeIgnored"
	| "_switch"
	| "_for"
	| "_do"
	| "_forTo"
	| "_forOf"
	| "_forOwn"
	| "_forIn"
	| "_forAwaitOf"
	| "_rethrow"
	| "_promiseResolve"
	| "_promiseThen"
	| "_AsyncGenerator";

// Weakly stored information on nodes

const originalNodeMap = new WeakMap<Node, Node>();
const skipNodeSet = new WeakSet<Node>();
const breakIdentifierMap = new WeakMap<Node, Identifier>();
const isHelperDefinitionSet = new WeakSet<Node>();
const helperNameMap = new WeakMap<Identifier | MemberExpression, HelperName>();
const nodeIsAsyncSet = new WeakSet<Node>();

interface ForAwaitStatement {
	type: "ForAwaitStatement";
	left: VariableDeclaration | LVal;
	right: Expression;
	body: Statement;
}

declare module "@babel/traverse" {
	interface TraversalContext {
		create<T extends Node>(node: Node, obj: T[], key: string | number, listKey: string): NodePath<T>;
	}
	interface NodePath {
		isForAwaitStatement?(): this is NodePath<ForAwaitStatement>;
	}
}

type UsedHelpers = { [key in HelperName]: true };

interface PluginState {
	readonly opts: Partial<Readonly<AsyncToPromisesConfiguration>>;
	hasTopLevelAwait?: boolean;
	usedHelpers?: UsedHelpers;
}

interface GeneratorState {
	state: PluginState;
	generatorIdentifier?: Identifier;
}

interface HoistCallArgumentsInnerState {
	argumentNames: readonly string[];
	additionalConstantNames: readonly string[];
	path: NodePath;
	pathScopes: readonly Scope[];
	scopes: Scope[];
}

interface HoistCallArgumentsState {
	state: PluginState;
	additionalConstantNames: readonly string[];
}

interface TraversalTestResult {
	any: boolean;
	all: boolean;
}

interface BreakContinueItem {
	identifier: Identifier;
	name?: string;
	path: NodePath<Statement>;
	isAsync: boolean;
}

interface ForToIdentifier {
	i: Identifier;
	array: Identifier;
}

interface ExtractedDeclarations {
	declarationKind: "var" | "const" | "let";
	declarations: VariableDeclarator[];
	awaitExpression: Expression;
	directExpression: Expression;
	reusingExisting: NodePath<VariableDeclarator> | undefined;
	resultIdentifier?: Identifier | Pattern;
}

interface Helper {
	readonly value: Node;
	readonly dependencies: readonly HelperName[];
}
let helpers: { [name: string]: Helper } | undefined;

const alwaysTruthy = Object.keys(constantStaticMethods);
const numberNames = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

type CompatibleSubset<New, Old> = Partial<New> & Pick<New, keyof New & keyof Old>;

interface FindAwaitExpressionState {
	awaitPath?: NodePath;
}

// function generate(node?: Node): string {
// 	if (node === undefined) {
// 		return "";
// 	}
// 	return require("@babel/generator").default(node, {
// 		"compact": true,
// 		"minified": true,
// 	}).code;
// }

// Main function, called by babel with module implementations for types, template, traverse, transformFromAST and its version information
export default function ({
	types,
	traverse,
	transformFromAst,
	version,
}: {
	types: CompatibleSubset<typeof import("@babel/types"), typeof import("babel-types")>;
	traverse: typeof import("@babel/traverse").default;
	transformFromAst: (ast: Program, code?: string, options?: any) => { code: string; map: any; ast: Program };
	version: string;
}): PluginObj<PluginState> {
	const isNewBabel = !/^6\./.test(version);

	function cloneNode<T extends Node>(node: T): T {
		const result = (types as any).cloneDeep(node) as T;
		if (types.isIdentifier(node) || types.isMemberExpression(node)) {
			const helperName = helperNameMap.get(node);
			if (helperName !== undefined) {
				helperNameMap.set(result as any as Identifier | MemberExpression, helperName);
			}
		}
		return result;
	}

	// Helper to wrap a node in a statement so it can be used by functions that require a statement
	function wrapNodeInStatement(node: Node): Statement {
		if (types.isStatement(node)) {
			return types.blockStatement([node]);
		}
		if (types.isExpression(node)) {
			return types.expressionStatement(node);
		}
		throw new Error(`Expected either an expression or a statement, got a ${node.type}!`);
	}

	// Helper to wrap a fresh node in a path so that it can be traversed
	function pathForNewNode<T extends Node>(node: T, parentPath: NodePath): NodePath<T> {
		let contextPath: NodePath | null = parentPath;
		while (contextPath != null) {
			if (contextPath.context) {
				const result = contextPath.context.create(parentPath.node, [node], 0, "dummy");
				result.setContext(contextPath.context);
				return result;
			}
			contextPath = contextPath.parentPath;
		}
		throw parentPath.buildCodeFrameError(`Unable to find a context upon which to traverse!`, TypeError);
	}

	// Checks whether nodes pass a test
	function pathsPassTest(
		matchingNodeTest: (path: NodePath<Node | null | undefined>) => boolean,
		referenceOriginalNodes?: boolean
	): (path: NodePath<Node | null | undefined>) => TraversalTestResult {
		function visit(
			path: NodePath,
			result: TraversalTestResult,
			state: { breakingLabels: string[]; unnamedBreak: boolean }
		) {
			if (referenceOriginalNodes) {
				const originalNode = originalNodeMap.get(path.node);
				if (originalNode) {
					traverse(wrapNodeInStatement(originalNode), visitor, path.scope, { match: result, state }, path);
					return false;
				}
			}
			const doesMatch = matchingNodeTest(path);
			if (doesMatch) {
				result.any = true;
				result.all = !(state.breakingLabels.length || state.unnamedBreak);
				// result.paths.push(path);
			}
			if (path.isBreakStatement()) {
				const label = path.node.label;
				if (!label) {
					state.unnamedBreak = true;
				} else if (state.breakingLabels.indexOf(label.name) === -1) {
					state.breakingLabels.push(label.name);
				}
			}
			if (path.isLabeledStatement()) {
				const index = state.breakingLabels.indexOf(path.node.label.name);
				if (index !== -1) {
					state.breakingLabels.splice(index, 1);
				}
			}
			if (path.isLoop()) {
				state.unnamedBreak = false;
			}
			if (doesMatch) {
				return false;
			}
			if (path.isConditional()) {
				const test = match(path.get("test"), state);
				const consequent = match(path.get("consequent"), state);
				const alternate = match(path.get("alternate"), state);
				result.any = result.any || test.any || consequent.any || alternate.any;
				// result.paths = result.paths.concat(test.paths).concat(consequent.paths).concat(alternate.paths);
				return (result.all =
					(test.all || (consequent.all && alternate.all)) &&
					!(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isSwitchStatement()) {
				const discriminant = match(path.get("discriminant"), state);
				const cases = path.get("cases");
				const caseMatches = cases.map((switchCase, i) => {
					const newState = { unnamedBreak: false, breakingLabels: state.breakingLabels };
					const newResult = match(switchCase, newState);
					for (i++; (!newResult.all || pathsBreakReturnOrThrow(switchCase).all) && i < cases.length; i++) {
						const tailMatch = match(cases[i], newState);
						newResult.all =
							(newResult.all || tailMatch.all) && !(state.breakingLabels.length || state.unnamedBreak);
						newResult.any = newResult.any || tailMatch.any;
						// newResult.paths = newResult.paths.concat(tailMatch.paths);
					}
					return newResult;
				});
				result.any = result.any || discriminant.any || caseMatches.some((caseMatch) => caseMatch.any);
				// result.paths = caseMatches.reduce((acc, match) => acc.concat(match.paths), result.paths.concat(discriminant.paths));
				return (result.all =
					(discriminant.all ||
						(cases.some((switchCase) => !switchCase.node.test) &&
							caseMatches.every((caseMatch) => caseMatch.all))) &&
					!(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isDoWhileStatement()) {
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				const test = match(path.get("test"), state);
				result.any = result.any || body.any || test.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return (result.all = (body.all || test.all) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isWhileStatement()) {
				// TODO: Support detecting break/return statements
				const testPath = path.get("test");
				const test = match(testPath, state);
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				result.any = result.any || test.any || body.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return (result.all =
					(test.all || (body.all && extractLooseBooleanValue(testPath.node) === true)) &&
					!(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isForXStatement()) {
				const right = match(path.get("right"), state);
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				result.any = result.any || right.any || body.any;
				// result.paths = result.paths.concat(right.paths).concat(body.paths);
				return (result.all = right.all && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isForStatement()) {
				const init = match(path.get("init"), state);
				const test = match(path.get("test"), state);
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				const update = match(path.get("update"), state);
				result.any = result.any || init.any || test.any || body.any || update.any;
				// result.paths = result.paths.concat(init.paths).concat(test.paths).concat(update.paths).concat(body.paths);
				return (result.all = (init.all || test.all) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isLogicalExpression()) {
				const left = match(path.get("left"), state);
				const right = match(path.get("right"), state);
				result.any = result.any || left.any || right.any;
				// result.paths = result.paths.concat(left.paths).concat(right.paths);
				return (result.all = left.all && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isReturnStatement()) {
				return true;
			}
			if (path.isBreakStatement()) {
				return true;
			}
			if (path.isContinueStatement()) {
				return true;
			}
			if (path.isThrowStatement()) {
				// TODO: Handle throw statements correctly
				return true;
			}
			if (path.isTryStatement()) {
				const blockMatch = match(path.get("block"), state);
				const finalizer = path.get("finalizer");
				const finalizerMatch = match(finalizer, state);
				const handler = path.get("handler");
				const handlerMatch = match(handler, state);
				result.any = result.any || blockMatch.any || handlerMatch.any || finalizerMatch.any;
				// result.paths = result.paths.concat(blockMatch.paths).concat(handlerMatch.paths).concat(finalizerMatch.paths);
				if (finalizerMatch.all) {
					return (result.all = !(state.breakingLabels.length || state.unnamedBreak));
				} else if (!finalizer.node) {
					return (result.all =
						handlerMatch.all && blockMatch.all && !(state.breakingLabels.length || state.unnamedBreak));
				}
				return false;
			}
			if (path.isFunction()) {
				return false;
			}
		}
		const visitor = {
			enter(
				this: { match: TraversalTestResult; state: { breakingLabels: string[]; unnamedBreak: boolean } },
				path: NodePath
			) {
				switch (visit(path, this.match, this.state)) {
					case true:
						path.stop();
						break;
					case false:
						path.skip();
						break;
				}
			},
		};
		function match(
			path: NodePath<Node | null | undefined>,
			state: { breakingLabels: string[]; unnamedBreak: boolean }
		) {
			const match: TraversalTestResult = { all: false, any: false };
			if (path && path.node) {
				if (typeof visit(path as NodePath<Node>, match, state) === "undefined") {
					path.traverse(visitor, { match, state });
				}
			}
			return match;
		}
		return (path) => match(path, { breakingLabels: [], unnamedBreak: false });
	}

	function pathsReachNodeTypes(matchingNodeTypes: string[], referenceOriginalNodes?: boolean) {
		return pathsPassTest(
			(path) => path.type !== null && path.type !== undefined && matchingNodeTypes.indexOf(path.type) !== -1,
			referenceOriginalNodes
		);
	}

	// Helpers to trace return, throw and break behaviours
	const pathsReturn = pathsReachNodeTypes(["ReturnStatement"], true);
	const pathsReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"], true);
	const pathsReturnOrThrowCurrentNodes = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"], false);
	const pathsBreak = pathsReachNodeTypes(["BreakStatement"], true);
	const pathsBreakReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement", "BreakStatement"], true);

	function isNonEmptyStatement(statement: Statement) {
		return !types.isEmptyStatement(statement);
	}

	// Extract a single return expression
	function expressionInSingleReturnStatement(
		target: FunctionExpression | ArrowFunctionExpression
	): Expression | void {
		const body = target.body;
		if (types.isBlockStatement(body)) {
			const statements = body.body.filter(isNonEmptyStatement);
			if (statements.length === 0) {
				return voidExpression();
			} else {
				const firstStatement = statements[0];
				if (types.isReturnStatement(firstStatement)) {
					return firstStatement.argument || voidExpression();
				}
			}
		} else {
			return body;
		}
	}

	// Extract the static property of a member expression, if possible
	function propertyNameOfMemberExpression(node: MemberExpression): string | undefined {
		const property = node.property;
		if (node.computed) {
			if (types.isStringLiteral(property)) {
				return property.value;
			}
		} else {
			if (types.isIdentifier(property)) {
				return property.name;
			}
		}
	}

	// Match a for (var i = 0; i < array.length; i++) pattern
	function identifiersInForToLengthStatement(statement: NodePath<ForStatement>): ForToIdentifier | undefined {
		// Match: for (var i = 0; i < array.length; i++)
		const init = statement.get("init");
		if (init.isVariableDeclaration() && init.node.declarations.length === 1) {
			const declaration = init.get("declarations")[0];
			if (types.isNumericLiteral(declaration.node.init) && declaration.node.init.value === 0) {
				const i = declaration.node.id;
				const test = statement.get("test");
				if (
					types.isIdentifier(i) &&
					test.isBinaryExpression() &&
					test.node.operator === "<" &&
					types.isIdentifier(test.node.left) &&
					test.node.left.name === i.name
				) {
					const right = test.get("right");
					if (right.isMemberExpression()) {
						const object = right.node.object;
						if (types.isIdentifier(object) && propertyNameOfMemberExpression(right.node) === "length") {
							const update = statement.get("update");
							if (
								update.isUpdateExpression() &&
								update.node.operator == "++" &&
								types.isIdentifier(update.node.argument) &&
								update.node.argument.name === i.name
							) {
								const binding = statement.scope.getBinding(i.name);
								if (binding) {
									const updateArgument = update.get("argument");
									if (
										!binding.constantViolations.some((cv) => cv !== updateArgument && cv !== update)
									) {
										return {
											i,
											array: object,
										};
									}
								}
							}
						}
					}
				}
			}
		}
	}

	// Extract a for (var key of obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { ... } } pattern
	function extractForOwnBodyPath(path: NodePath<ForInStatement>) {
		// Match: for (var key of obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { ... } }
		let left = path.get("left");
		if (left.isVariableDeclaration()) {
			left = left.get("declarations")[0].get("id");
		}
		const right = path.get("right");
		// Check to see if we have a simple for of statement with two variables
		if (left.isIdentifier() && right.isIdentifier()) {
			const rightBinding = path.scope.getBinding(right.node.name);
			if (rightBinding && rightBinding.constant) {
				let body = path.get("body");
				for (;;) {
					let statements: NodePath<Statement>[];
					if (body.isBlockStatement()) {
						statements = body.get("body");
					} else if (body.isReturnStatement()) {
						const argument = body.get("argument");
						if (
							argument.isCallExpression() &&
							invokeTypeOfExpression(argument) &&
							argument.get("arguments").length === 1
						) {
							const firstArgument = argument.get("arguments")[0];
							if (firstArgument.isFunctionExpression()) {
								statements = firstArgument.get("body").get("body");
							} else {
								break;
							}
						} else {
							break;
						}
					} else {
						break;
					}
					if (statements.length !== 1) {
						return;
					}
					body = statements[0];
				}
				// Check for an if statement with a single call expression
				if (body.isIfStatement() && !body.node.alternate) {
					const test = body.get("test");
					if (test.isCallExpression() && test.node.arguments.length === 2) {
						const args = test.get("arguments");
						// Check that call arguments match the key and target variables
						const firstArg = args[0];
						const secondArg = args[1];
						if (
							firstArg.isIdentifier() &&
							firstArg.node.name === right.node.name &&
							secondArg.isIdentifier() &&
							secondArg.node.name === left.node.name
						) {
							// Check for .call(...)
							const callee = test.get("callee");
							if (callee.isMemberExpression() && propertyNameOfMemberExpression(callee.node) === "call") {
								// Check for .hasOwnProperty
								let method = callee.get("object");
								if (
									method.isMemberExpression() &&
									propertyNameOfMemberExpression(method.node) === "hasOwnProperty"
								) {
									let target = method.get("object");
									// Check for empty temporary object
									if (target.isObjectExpression() && target.node.properties.length === 0) {
										return body.get("consequent");
									}
									// Strip .prototype if present
									if (
										target.isMemberExpression() &&
										propertyNameOfMemberExpression(target.node) === "prototype"
									) {
										target = target.get("object");
									}
									// Check for Object
									if (target.isIdentifier() && target.node.name === "Object") {
										return body.get("consequent");
									}
								}
							}
						}
					}
				}
			}
		}
	}

	function isContinuation(
		possible: Expression | V8IntrinsicIdentifier
	): possible is FunctionExpression | ArrowFunctionExpression {
		return (
			(types.isFunctionExpression(possible) && possible.id === null) || types.isArrowFunctionExpression(possible)
		);
	}

	// Check if a function expression always returns its first argument, with no side effects
	function isPassthroughContinuation(continuation?: Expression) {
		if (continuation) {
			if (isContinuation(continuation) && continuation.params.length === 1) {
				const expression = expressionInSingleReturnStatement(continuation);
				if (expression) {
					const firstParam = continuation.params[0];
					if (types.isIdentifier(firstParam)) {
						const valueName = firstParam.name;
						if (types.isIdentifier(expression) && expression.name === valueName) {
							return true;
						}
						if (
							types.isConditionalExpression(expression) &&
							types.isIdentifier(expression.test) &&
							types.isIdentifier(expression.consequent) &&
							expression.consequent.name === valueName &&
							types.isIdentifier(expression.alternate) &&
							expression.alternate.name === valueName
						) {
							return true;
						}
					}
				}
			}
		}
		return false;
	}

	// Check if an expression is a function that returns undefined and has no side effects or is a reference to the _empty helper
	function isEmptyContinuation(continuation: Expression): boolean {
		if (types.isIdentifier(continuation)) {
			return helperNameMap.get(continuation) === "_empty";
		}
		if (isContinuation(continuation)) {
			const body = continuation.body;
			if (types.isBlockStatement(body)) {
				return body.body.length === 0;
			}
		}
		return false;
	}

	// Emit a void expression
	function voidExpression(arg?: Expression) {
		return types.unaryExpression("void", arg || types.numericLiteral(0));
	}

	// Simplify an expression with a substituted "truthiness" value for an identifier
	function simplifyWithIdentifier(expression: Expression, identifier: Identifier, truthy: boolean): Expression {
		if (types.isCallExpression(expression)) {
			switch (promiseCallExpressionType(expression)) {
				case "all":
				case "race":
				case "reject":
				case "resolve": {
					const firstArgument = expression.arguments[0];
					if (types.isExpression(firstArgument)) {
						const simplified = simplifyWithIdentifier(firstArgument, identifier, truthy);
						return simplified === expression.arguments[0]
							? expression
							: types.callExpression(expression.callee, [simplified]);
					}
				}
				case "then": {
					const callee = expression.callee;
					if (types.isMemberExpression(callee)) {
						const thenArgument = expression.arguments[0];
						const object = callee.object;
						if (types.isCallExpression(object)) {
							const valueArgument = object.arguments[0];
							if (types.isExpression(valueArgument) && types.isExpression(thenArgument)) {
								const simplified = simplifyWithIdentifier(valueArgument, identifier, truthy);
								return simplified === valueArgument
									? expression
									: callThenMethod(types.callExpression(object.callee, [simplified]), thenArgument);
							}
						}
					}
				}
			}
			if (
				(expression.arguments.length === 1 && types.isIdentifier(expression.callee)) ||
				isContinuation(expression.callee)
			) {
				const firstArgument = expression.arguments[0];
				if (types.isExpression(firstArgument)) {
					const simplified = simplifyWithIdentifier(firstArgument, identifier, truthy);
					return simplified === expression.arguments[0]
						? expression
						: types.callExpression(expression.callee, [simplified]);
				}
			}
		}
		if (
			types.isConditionalExpression(expression) &&
			types.isIdentifier(expression.test) &&
			expression.test.name === identifier.name
		) {
			return truthy ? expression.consequent : expression.alternate;
		}
		if (
			types.isLogicalExpression(expression) &&
			types.isIdentifier(expression.left) &&
			expression.left.name === identifier.name
		) {
			if (expression.operator === "&&") {
				return truthy ? expression.right : expression.left;
			}
			if (expression.operator === "||") {
				return truthy ? expression.left : expression.right;
			}
		}
		return expression;
	}

	// Checks if an expression is an identifier or a literal
	function isIdentifierOrLiteral(
		expression: Expression | V8IntrinsicIdentifier | PrivateName
	): expression is Identifier | Literal {
		return types.isIdentifier(expression) || types.isLiteral(expression);
	}

	// Extract a "simple" expression out of a continuation; this is to avoid emitting a function declaration for simple continuations that merely return a value
	function simpleExpressionForContinuation(continuation: Expression, value?: Expression) {
		if (isContinuation(continuation)) {
			let expression = expressionInSingleReturnStatement(continuation);
			if (expression) {
				switch (continuation.params.length) {
					case 0:
						if (
							(types.isConditionalExpression(expression) &&
								isIdentifierOrLiteral(expression.test) &&
								isIdentifierOrLiteral(expression.consequent) &&
								isIdentifierOrLiteral(expression.alternate)) ||
							((types.isLogicalExpression(expression) || types.isBinaryExpression(expression)) &&
								isIdentifierOrLiteral(expression.left) &&
								isIdentifierOrLiteral(expression.right)) ||
							(types.isUnaryExpression(expression) && isIdentifierOrLiteral(expression.argument)) ||
							(types.isCallExpression(expression) &&
								isIdentifierOrLiteral(expression.callee) &&
								expression.arguments.length === 0) ||
							isIdentifierOrLiteral(expression)
						) {
							return expression;
						}
						break;
					case 1: {
						if (!value) {
							return;
						}
						const firstParam = continuation.params[0];
						const replace = (expr: Expression | V8IntrinsicIdentifier) =>
							types.isIdentifier(firstParam) && types.isIdentifier(expr) && expr.name === firstParam.name
								? value
								: discardingIntrinsics(expr);
						if (isIdentifierOrLiteral(expression)) {
							return replace(expression);
						}
						if (
							types.isConditionalExpression(expression) &&
							isIdentifierOrLiteral(expression.test) &&
							isIdentifierOrLiteral(expression.consequent) &&
							isIdentifierOrLiteral(expression.alternate)
						) {
							return types.conditionalExpression(
								replace(expression.test),
								replace(expression.consequent),
								replace(expression.alternate)
							);
						}
						if (
							types.isLogicalExpression(expression) &&
							isIdentifierOrLiteral(expression.left) &&
							isIdentifierOrLiteral(expression.right)
						) {
							return types.logicalExpression(
								expression.operator,
								replace(expression.left),
								replace(expression.right)
							);
						}
						if (
							types.isBinaryExpression(expression) &&
							isIdentifierOrLiteral(expression.left) &&
							isIdentifierOrLiteral(expression.right)
						) {
							return types.binaryExpression(
								expression.operator,
								replace(expression.left),
								replace(expression.right)
							);
						}
						if (
							types.isCallExpression(expression) &&
							isIdentifierOrLiteral(expression.callee) &&
							expression.arguments.length === 0
						) {
							return types.callExpression(replace(expression.callee), expression.arguments);
						}
					}
				}
			}
		}
	}

	// Await an expression and resume control flow to the continuation, optionally calling directly
	function awaitAndContinue(
		state: PluginState,
		path: NodePath,
		value: Expression,
		continuation?: Expression,
		directExpression?: Expression
	): { readonly declarators: VariableDeclarator[]; readonly expression: Expression } {
		const declarators: VariableDeclarator[] = [];
		if (continuation) {
			if (isPassthroughContinuation(continuation)) {
				continuation = undefined;
			} else {
				continuation = unwrapReturnCallWithPassthroughArgument(continuation, path.scope);
			}
		}
		if (!continuation && directExpression && extractLooseBooleanValue(directExpression) === true) {
			return {
				declarators,
				expression: value,
			};
		}
		if (
			types.isCallExpression(value) &&
			value.arguments.length === 0 &&
			isContinuation(value.callee) &&
			value.callee.params.length === 0
		) {
			const newValue = expressionInSingleReturnStatement(value.callee);
			if (newValue) {
				value = newValue;
			}
		}
		// Directly call .then if the result of a yield statement and there is a continuation to call
		if (
			continuation &&
			!directExpression &&
			types.isCallExpression(value) &&
			types.isMemberExpression(value.callee) &&
			helperNameMap.get(value.callee) === "_yield"
		) {
			return {
				declarators,
				expression: callThenMethod(value, continuation),
			};
		}
		// Emit all of the code necessary to call correctly instead of calling helpers
		if (readConfigKey(state.opts, "inlineHelpers")) {
			if (directExpression) {
				const resolvedValue = types.callExpression(promiseResolve(), [value]);
				const direct = extractLooseBooleanValue(directExpression);
				if (typeof direct === "undefined") {
					// Emit a call to the continuation directly if the direct expression is true, otherwise resolve it and call via then
					let expression;
					if (continuation) {
						// Store the continuation in a temporary variable if it's complex enough
						let simpleExpression;
						if (
							!types.isIdentifier(continuation) &&
							!(simpleExpression = simpleExpressionForContinuation(
								continuation,
								isIdentifierOrLiteral(value) ? value : undefined
							))
						) {
							const id = path.scope.generateUidIdentifier("temp");
							if (isContinuation(continuation)) {
								if (!path.parentPath) {
									/* istanbul ignore next */
									throw path.buildCodeFrameError(`Expected a parent path!`, Error);
								}
								insertFunctionIntoScope(continuation, id, path.parentPath.scope);
							} else {
								declarators.push(types.variableDeclarator(id, continuation));
							}
							continuation = id;
						}
						expression = conditionalExpression(
							directExpression,
							simpleExpression || types.callExpression(continuation, [value]),
							callThenMethod(resolvedValue, continuation)
						);
					} else {
						// No continuation, only wrap the value in a Promise when not direct
						expression = conditionalExpression(directExpression, value, resolvedValue);
					}
					return {
						declarators,
						expression,
					};
				} else if (direct) {
					// Emit a direct call to the continuation
					return {
						declarators,
						expression: continuation ? types.callExpression(continuation, [value]) : value,
					};
				} else {
					// Emit a call to resolve the value and call the continuation from then
					return {
						declarators,
						expression: continuation ? callThenMethod(resolvedValue, continuation) : resolvedValue,
					};
				}
			} else if (continuation) {
				// Emit a potentially asynhcronous call to the continuation with the result of the value
				if (!types.isIdentifier(value)) {
					// Return a call to .then on expressions that provably return a Promise
					if (types.isCallExpression(value) && promiseCallExpressionType(value) !== undefined) {
						return {
							declarators,
							expression: callThenMethod(value, continuation),
						};
					}
					// Otherwise store in a temporary
					const id = path.scope.generateUidIdentifier("temp");
					declarators.push(types.variableDeclarator(id, value));
					value = id;
				}
				// Store the continuation in a temporary if it's simple
				const isEmpty = isEmptyContinuation(continuation);
				let simpleExpression;
				if (
					!isEmpty &&
					!types.isIdentifier(continuation) &&
					!(simpleExpression = simpleExpressionForContinuation(continuation, value))
				) {
					const id = path.scope.generateUidIdentifier("temp");
					if (isContinuation(continuation)) {
						if (!path.parentPath) {
							/* istanbul ignore next */
							throw path.buildCodeFrameError(`Expected a parent path!`, Error);
						}
						insertFunctionIntoScope(continuation, id, path.parentPath.scope);
					} else {
						declarators.push(types.variableDeclarator(id, continuation));
					}
					continuation = id;
				}
				// Emit a call to .then if value is thenable, otherwise call the continuation directly
				return {
					declarators,
					expression: types.conditionalExpression(
						types.logicalExpression("&&", value, types.memberExpression(value, types.identifier("then"))),
						callThenMethod(value, continuation),
						simpleExpression
							? simpleExpression
							: isEmpty
							? voidExpression()
							: types.callExpression(continuation, [value])
					),
				};
			}
		}
		// Emit calls to helpers
		const callTarget =
			types.isCallExpression(value) && value.arguments.length === 0 && !types.isMemberExpression(value.callee)
				? value.callee
				: undefined;
		const args: (Expression | V8IntrinsicIdentifier)[] = [callTarget || value];
		const ignoreResult = continuation && isEmptyContinuation(continuation);
		// Avoid unnecssary arguments to improve code density
		if (!ignoreResult && continuation) {
			args.push(continuation);
		}
		if (directExpression && extractLooseBooleanValue(directExpression) !== false) {
			if (!ignoreResult && !continuation) {
				args.push(voidExpression());
			}
			args.push(directExpression);
		}
		const baseHelper: "_call" | "_await" | "_invoke" | "_continue" = directExpression
			? callTarget
				? "_call"
				: "_await"
			: callTarget
			? "_invoke"
			: "_continue";
		const helperName: HelperName = ignoreResult ? ((baseHelper + "Ignored") as HelperName) : baseHelper;
		if (args.length === 1) {
			// Handle a few cases where a helper isn't actually necessary
			switch (helperName) {
				case "_invoke":
					return {
						declarators,
						expression: types.callExpression(args[0], []),
					};
				case "_continue":
					return {
						declarators,
						expression: discardingIntrinsics(args[0]),
					};
				case "_continueIgnored":
					const firstArgument = args[0];
					if (
						types.isCallExpression(firstArgument) &&
						(types.isIdentifier(firstArgument.callee) || types.isMemberExpression(firstArgument.callee))
					) {
						if (helperNameMap.get(firstArgument.callee) === "_continueIgnored") {
							return {
								declarators,
								expression: firstArgument,
							};
						}
					}
			}
		}
		// Emit the call to the helper with the arguments
		return {
			declarators,
			expression: types.callExpression(helperReference(state, path, helperName), args.map(discardingIntrinsics)),
		};
	}

	// Borrow the tail continuation of a statement
	function borrowTail(target: NodePath): Statement[] {
		let current: NodePath<Node> | null = target;
		const dest = [];
		while (current && current.node && current.inList && current.container) {
			const siblings = current.getAllNextSiblings();
			for (const sibling of siblings) {
				sibling.assertStatement();
				dest.push(sibling.node as Statement);
			}
			for (const sibling of siblings) {
				sibling.remove();
			}
			current = current.parentPath;
			if (!current || !current.isBlockStatement()) {
				break;
			}
		}
		return dest;
	}

	// Check if the tail continuation of an expression has a return or throw statement
	function exitsInTail(target: NodePath) {
		let current: NodePath | null | undefined = target;
		while (current && current.node && current.inList && current.container && !current.isFunction()) {
			for (var i = (current.key as number) + 1; i < (current.container as Node[]).length; i++) {
				if (pathsReturnOrThrow(current).any) {
					return true;
				}
			}
			current = current.parentPath;
		}
		return false;
	}

	// Emits a return statement, optionally referencing an original node
	function returnStatement(argument: Expression | undefined, originalNode?: Node): ReturnStatement {
		const result: ReturnStatement = types.returnStatement(argument);
		skipNodeSet.add(result);
		if (originalNode !== undefined) {
			originalNodeMap.set(result, originalNode);
		}
		return result;
	}

	// Merge unnecessary return statements and prune trailing empty returns
	function removeUnnecessaryReturnStatements(blocks: Statement[]): Statement[] {
		while (blocks.length) {
			const lastStatement = blocks[blocks.length - 1];
			if (types.isReturnStatement(lastStatement)) {
				if (lastStatement.argument === null || lastStatement.argument === undefined) {
					blocks = blocks.slice(0, blocks.length - 1);
				} else {
					if (
						types.isConditionalExpression(lastStatement.argument) &&
						types.isUnaryExpression(lastStatement.argument.alternate) &&
						lastStatement.argument.alternate.operator === "void" &&
						isValueLiteral(lastStatement.argument.alternate.argument)
					) {
						blocks = blocks.slice(0, blocks.length - 1);
						blocks.push(
							types.ifStatement(
								lastStatement.argument.test,
								types.returnStatement(lastStatement.argument.consequent)
							)
						);
					} else if (blocks.length > 1) {
						const previousStatement = blocks[blocks.length - 2];
						if (types.isIfStatement(previousStatement) && !previousStatement.alternate) {
							let consequent = previousStatement.consequent;
							while (types.isBlockStatement(consequent)) {
								if (consequent.body.length !== 1) {
									return blocks;
								}
								consequent = consequent.body[0];
							}
							if (types.isReturnStatement(consequent) && consequent.argument) {
								blocks = blocks.slice(0, blocks.length - 2);
								blocks.push(
									types.returnStatement(
										conditionalExpression(
											previousStatement.test,
											consequent.argument,
											lastStatement.argument
										)
									)
								);
							}
						}
					}
					break;
				}
			} else {
				if (types.isIfStatement(lastStatement)) {
					let consequent: Statement = lastStatement.consequent;
					if (types.isBlockStatement(consequent)) {
						consequent = blockStatement(removeUnnecessaryReturnStatements(consequent.body));
					}
					let alternate: Statement | null | undefined = lastStatement.alternate;
					if (alternate) {
						if (types.isBlockStatement(alternate)) {
							const removedOfUnnecessary = removeUnnecessaryReturnStatements(alternate.body);
							alternate = removedOfUnnecessary.length ? blockStatement(removedOfUnnecessary) : undefined;
						} else if (removeUnnecessaryReturnStatements([alternate]).length === 0) {
							alternate = undefined;
						}
					}
					if (consequent !== lastStatement.consequent || alternate !== lastStatement.alternate) {
						blocks = blocks.slice(0, blocks.length - 1);
						blocks.push(types.ifStatement(lastStatement.test, consequent, alternate || undefined));
					}
				}
				break;
			}
		}
		return blocks;
	}

	// Rewrite an async node to be explicitly managed continuations split at async expressions
	function rewriteAsyncNode<T extends Expression | Statement>(
		state: GeneratorState,
		parentPath: NodePath,
		node: T,
		additionalConstantNames: string[],
		exitIdentifier?: Identifier,
		unpromisify?: boolean
	) {
		const path = pathForNewNode(node, parentPath);
		rewriteAsyncBlock(state, path, additionalConstantNames, exitIdentifier, unpromisify);
		return path.node;
	}

	// Return the entire stack of scopes for a given scope
	function allScopes(scope: Scope): Scope[] {
		const result = [];
		while (scope) {
			result.push(scope);
			scope = scope.parent;
		}
		return result;
	}

	// Visitor that hoists call arguments
	const hoistCallArgumentsInnerVisitor: Visitor<HoistCallArgumentsInnerState> = {
		Identifier(identifierPath) {
			if (identifierSearchesScope(identifierPath)) {
				const name = identifierPath.node.name;
				if (this.argumentNames.indexOf(name) === -1) {
					if (this.additionalConstantNames.indexOf(name) !== -1) {
						this.scopes.push(this.path.scope.parent);
					} else {
						const binding = identifierPath.scope.getBinding(name) || this.path.scope.getBinding(name);
						if (binding) {
							const scope = binding.scope;
							if (scope !== null) {
								if (this.pathScopes.indexOf(scope) !== -1) {
									this.scopes.push(scope);
								}
							}
						}
					}
				}
			}
		},
	};

	// Check if a node is a literal that has its value on .value
	function isValueLiteral(node: Node): node is StringLiteral | NumericLiteral | BooleanLiteral {
		return types.isStringLiteral(node) || types.isNumericLiteral(node) || types.isBooleanLiteral(node);
	}

	// Filter out keys that vary from AST to AST, but don't have observably different behaviour when evaluated
	function keyFilter(key: string, value: any) {
		return key === "start" ||
			key === "end" ||
			key === "loc" ||
			key === "directives" ||
			key === "leadingComments" ||
			key === "trailingComments" ||
			key === "innerComments" ||
			key[0] === "_"
			? undefined
			: value;
	}

	// Helper function to check if nodes have equivalent behaviour when evaluated
	function nodesAreEquivalent<T extends Node | ReadonlyArray<Node>>(node: T): (node: T) => boolean {
		// Temporary deduping mechanism that filters source locations to see if nodes are otherwise identical
		let cached: string | undefined;
		return (other: T) => {
			if (typeof cached === "undefined") {
				cached = JSON.stringify(node, keyFilter);
			}
			return cached === JSON.stringify(other, keyFilter);
		};
	}

	// Helper visitor to reregister bindings on demand (working around some bugs in babel's scope tracking)
	const reregisterVariableVisitor: Visitor<{ readonly originalScope: Scope }> = {
		VariableDeclaration(path) {
			path.scope.registerDeclaration(path);
		},
		FunctionDeclaration(path) {
			path.parentPath.scope.registerDeclaration(path);
		},
		ClassDeclaration(path) {
			path.scope.registerDeclaration(path);
		},
		Function(path) {
			path.skip();
		},
	};

	// Inserts a function declaration into a particular scope, abusing the binding system as necessary
	function insertFunctionIntoScope(func: FunctionExpression | ArrowFunctionExpression, id: Identifier, scope: Scope) {
		// Insert a const declaration containing the function
		scope.push({ kind: "const", id, init: func, unique: true });
		// Find the declaration we just inserted
		const binding = scope.getBinding(id.name);
		if (typeof binding === "undefined") {
			/* istanbul ignore next */
			throw scope.path.buildCodeFrameError(`Could not find newly created binding for ${id.name}!`, Error);
		}
		// Replace it with a function declaration, because it generates smaller code and we no longer have to worry about const/let ordering issues
		const targetPath = binding.path.parentPath;
		if (!targetPath) {
			/* istanbul ignore next */
			throw scope.path.buildCodeFrameError(`Could not find newly created binding for ${id.name}!`, Error);
		}
		targetPath.replaceWith(
			types.functionDeclaration(
				id,
				func.params,
				types.isBlockStatement(func.body)
					? func.body
					: types.blockStatement([types.returnStatement(func.body)]),
				func.generator,
				func.async
			)
		);
		reregisterDeclarations(targetPath);
	}

	// Hoist function expressions into a scope where they can be reused
	function hoistFunctionExpressionHandler(
		this: HoistCallArgumentsState,
		path: NodePath<ArrowFunctionExpression | FunctionExpression>
	) {
		path.skip();
		const bodyPath = path.get("body");
		if (
			bodyPath.isBlockStatement() &&
			bodyPath.node.body.length === 0 &&
			!readConfigKey(this.state.opts, "inlineHelpers")
		) {
			path.replaceWith(emptyFunction(this.state, path));
			return;
		}
		const argumentNames: string[] = [];
		for (const param of path.node.params) {
			if (types.isIdentifier(param) || types.isPattern(param) || types.isRestElement(param)) {
				addConstantNames(argumentNames, param);
			} else {
				return;
			}
		}
		const scopes: Scope[] = [];
		const pathScopes = allScopes(path.scope.parent);
		path.traverse(hoistCallArgumentsInnerVisitor, {
			argumentNames,
			scopes,
			pathScopes,
			path,
			additionalConstantNames: this.additionalConstantNames,
		} as const);
		let scope = path.scope.getProgramParent();
		let ancestry = [scope];
		for (let otherScope of scopes) {
			if (ancestry.indexOf(otherScope) === -1) {
				scope = otherScope;
				ancestry = ancestry.concat(allScopes(otherScope));
			}
		}
		if (ancestry.indexOf(path.scope.parent) === -1) {
			const bindings = scope.bindings;
			const filter = nodesAreEquivalent([...path.node.params, path.node.body]);
			for (const key of Object.getOwnPropertyNames(bindings)) {
				const binding = bindings[key];
				const bindingPath = binding.path;
				if (bindingPath.isFunctionDeclaration()) {
					if (filter([...bindingPath.node.params, bindingPath.node.body])) {
						path.replaceWith(binding.identifier);
						return;
					}
				} else if (bindingPath.isVariableDeclarator()) {
					const init = bindingPath.get("init");
					if (init.node && isContinuation(init.node)) {
						if (filter([...init.node.params, init.node.body])) {
							path.replaceWith(binding.identifier);
							return;
						}
					}
				}
			}
			let nameNode: Node = path.node;
			if (types.isExpression(nameNode) && isContinuation(nameNode)) {
				nameNode = nameNode.body;
			}
			if (types.isBlockStatement(nameNode) && nameNode.body.length === 1) {
				nameNode = nameNode.body[0];
			}
			if (types.isReturnStatement(nameNode) && nameNode.argument) {
				nameNode = nameNode.argument;
			}
			if (types.isCallExpression(nameNode)) {
				const callee = nameNode.callee;
				if (types.isIdentifier(callee) && helperNameMap.has(callee)) {
					nameNode = nameNode.arguments[0];
				}
			}
			const id = isValueLiteral(nameNode)
				? scope.generateUidIdentifier(
						nameNode.value.toString().replace(/\d/g, (number: any) => numberNames[number as number])
				  )
				: path.scope.generateUidIdentifierBasedOnNode(nameNode, "temp");
			const init = path.node;
			// Replace with the generated ID
			path.replaceWith(id);
			// Insert the function into the scope
			insertFunctionIntoScope(init, id, scope);
		}
	}
	const hoistCallArgumentsVisitor: Visitor<HoistCallArgumentsState> = {
		FunctionExpression: hoistFunctionExpressionHandler,
		ArrowFunctionExpression: hoistFunctionExpressionHandler,
	};

	// Hoist the arguments of a call expression, so that additional closures aren't unnecessarily created at runtime
	function hoistCallArguments(state: PluginState, path: NodePath, additionalConstantNames: readonly string[]) {
		if (path.isCallExpression()) {
			const callee = path.node.callee;
			if ((types.isIdentifier(callee) || types.isMemberExpression(callee)) && helperNameMap.has(callee)) {
				const functionParent = path.getFunctionParent();
				if (functionParent) {
					const scope = functionParent.scope as any;
					if (scope.crawl) {
						scope.crawl();
					}
				}
				path.traverse(hoistCallArgumentsVisitor, { state, additionalConstantNames });
			}
		}
	}

	// Sanity check that a path is still valid and hasn't been removed
	function checkPathValidity(path: NodePath) {
		if (path.container === null) {
			/* istanbul ignore next */
			throw path.buildCodeFrameError(`Path was expected to have a container!`, TypeError);
		}
		if ("resync" in (path as any) && typeof (path as any).resync === "function") {
			(path as any).resync();
			if (path.container === null) {
				/* istanbul ignore next */
				throw path.buildCodeFrameError(
					`Path was expected to have a container, and lost its container upon resync!`,
					TypeError
				);
			}
		}
	}

	// Extract the continuation of a path, emit a call to a helper, passing the continuation in as an argument
	function relocateTail(
		generatorState: GeneratorState,
		awaitExpression: Expression,
		statementNode: Statement | undefined,
		target: NodePath<Statement | Expression>,
		additionalConstantNames: string[],
		temporary?: Identifier | Pattern,
		exitCheck?: Expression,
		directExpression?: Expression,
		skipReturns?: boolean
	) {
		// Find the tail continuation
		checkPathValidity(target);
		const tail = borrowTail(target);
		checkPathValidity(target);
		// Rewrite the continuation to be Promise chains
		let originalNode = types.isStatement(target.node) ? target.node : types.expressionStatement(target.node);
		const rewrittenTail =
			statementNode || tail.length
				? rewriteAsyncNode(
						generatorState,
						target,
						blockStatement((statementNode ? [statementNode] : []).concat(tail)),
						additionalConstantNames
				  ).body
				: [];
		checkPathValidity(target);
		// Strip dead code from the continuation
		let blocks = removeUnnecessaryReturnStatements(rewrittenTail.filter(isNonEmptyStatement));
		checkPathValidity(target);
		let replacement;
		if (blocks.length) {
			// Have a continuation, optimize it
			if (exitCheck) {
				if (temporary && !types.isIdentifier(temporary)) {
					const temporaryIdentifier = (temporary = target.scope.generateUidIdentifier("temp"));
					const declaration = types.variableDeclaration("const", [
						types.variableDeclarator(temporary, temporaryIdentifier),
					]) as any as Statement;
					blocks = [declaration].concat(blocks);
					temporary = temporaryIdentifier;
				}
				if (temporary !== undefined) {
					blocks = removeUnnecessaryReturnStatements(
						[types.ifStatement(exitCheck, returnStatement(temporary)) as Statement].concat(blocks)
					);
				} else {
					const minify = readConfigKey(generatorState.state.opts, "minify");
					blocks = removeUnnecessaryReturnStatements([
						types.ifStatement(
							logicalNot(exitCheck, minify),
							blocks.length === 1 ? blocks[0] : blockStatement(blocks)
						) as Statement,
					]);
				}
			}
			// Build a function expression for it
			const fn = functionize(generatorState.state, temporary ? [temporary] : [], blockStatement(blocks), target);
			// Emit an await expression for the await expression that calls the continuation
			replacement = awaitAndContinue(generatorState.state, target, awaitExpression, fn, directExpression);
			originalNode = types.blockStatement([originalNode].concat(tail));
		} else if (pathsReturnOrThrow(target).any || target.parentPath.isArrowFunctionExpression()) {
			// Emit an await expression for the await expression that passes through the output
			replacement = awaitAndContinue(generatorState.state, target, awaitExpression, undefined, directExpression);
		} else {
			// Emit an await expression for the await expression that ignores the output
			replacement = awaitAndContinue(
				generatorState.state,
				target,
				awaitExpression,
				emptyFunction(generatorState.state, target),
				directExpression
			);
		}
		checkPathValidity(target);
		// Insert a call to return the awaited expression
		if (target.isExpression() && target.parentPath.isArrowFunctionExpression()) {
			target.replaceWith(replacement.expression);
		} else if (skipReturns) {
			target.replaceWith(replacement.expression);
		} else if (target.isBlockStatement() && target.parentPath.isFunctionExpression()) {
			target.replaceWith(types.blockStatement([returnStatement(replacement.expression, originalNode)]));
		} else {
			target.replaceWith(returnStatement(replacement.expression, originalNode));
		}
		// Insert any new variable declarators the await call needed
		if (replacement.declarators.length) {
			reregisterDeclarations(target.insertBefore(types.variableDeclaration("const", replacement.declarators)));
		}
		// Hoist the call arguments if configured to do so
		if (readConfigKey(generatorState.state.opts, "hoist")) {
			if (target.isExpression()) {
				hoistCallArguments(generatorState.state, target as NodePath<Expression>, additionalConstantNames);
			} else if (target.isReturnStatement()) {
				const argument = target.get("argument");
				if (argument.node) {
					hoistCallArguments(generatorState.state, argument as NodePath<Expression>, additionalConstantNames);
				}
			}
		}
	}

	// Hoist a common subexpression into a named constant
	function rewriteToNamedConstant<T>(
		targetPath: NodePath,
		callback: (rewrite: (name: string, path: NodePath<Expression>) => void) => T
	): T {
		const declarators: { [name: string]: { kind: "const"; id: Identifier; init: Expression } } =
			Object.create(null);
		return callback((name, path) => {
			if (Object.hasOwnProperty.call(declarators, name)) {
				const id = declarators[name].id;
				const binding = targetPath.scope.getBinding(id.name);
				if (!binding || binding.path.get("init") !== path) {
					path.replaceWith(types.identifier(id.name));
				}
			} else {
				const id = path.scope.generateUidIdentifier(name);
				const init = path.node;
				path.replaceWith(id);
				const declarator = (declarators[name] = {
					kind: "const",
					id,
					init,
				});
				let skip = false;
				if (targetPath.isClassMethod() && targetPath.node.kind === "constructor") {
					// Workaround Scope.push not taking into account calls to super within constructors
					targetPath.traverse({
						Super(path) {
							if (!skip && path.parentPath.isCallExpression() && path.parentPath.get("callee") === path) {
								path.stop();
								path.getStatementParent()!.insertAfter(
									types.variableDeclaration("const", [types.variableDeclarator(id, init)])
								);
								skip = true;
							}
						},
					});
				}
				if (!skip) {
					targetPath.scope.push(declarator);
				}
				const binding = targetPath.scope.getBinding(id.name);
				if (binding) {
					binding.path.skip();
				}
			}
		});
	}

	// Rewrite this expression visitor
	const rewriteThisVisitor: Visitor<{ rewrite: (name: string, path: NodePath<Expression>) => void }> = {
		Function(path: NodePath<Function>) {
			if (!path.isArrowFunctionExpression()) {
				path.skip();
			}
		},
		ThisExpression(path: NodePath<ThisExpression>) {
			this.rewrite("this", path);
		},
	};

	// Rewrite this into _this so that it can be used in continuations
	function rewriteThisExpressions(rewritePath: NodePath, targetPath: NodePath) {
		rewriteToNamedConstant(targetPath, (rewrite) => rewritePath.traverse(rewriteThisVisitor, { rewrite }));
	}

	// Extracts all the identifiers populated in an LVal
	function identifiersInLVal(id: LVal, result: Identifier[] = []): Identifier[] {
		switch (id.type) {
			case "Identifier":
				result.push(id);
				break;
			case "AssignmentPattern":
				identifiersInLVal(id.left);
				break;
			case "ArrayPattern":
				for (const element of id.elements) {
					if (types.isLVal(element)) {
						identifiersInLVal(element, result);
					}
				}
				break;
			case "RestElement":
				identifiersInLVal(id.argument, result);
				break;
			case "ObjectPattern":
				for (const property of id.properties) {
					if (types.isRestElement(property)) {
						identifiersInLVal(property.argument, result);
					} else if (types.isPattern(property.value) || types.isIdentifier(property.value)) {
						identifiersInLVal(property.value, result);
					}
				}
				break;
			default:
				throw new Error(`Unexpected node is not an LVal: ${id}`);
		}
		return result;
	}

	// Checks if any identifiers are referenced before a specific path
	function anyIdentifiersRequireHoisting(
		identifiers: ReadonlyArray<Identifier>,
		path: NodePath<VariableDeclaration>
	) {
		const ancestry = path.getAncestry().reverse();
		for (const id of identifiers) {
			const binding = path.scope.getBinding(id.name);
			if (!binding) {
				return true;
			}
			const executingBeforePath = binding.referencePaths.find((referencePath) => {
				if (!referencePath.willIMaybeExecuteBefore(path)) {
					return false;
				}
				// Workaround bugs in babel's willIMaybeExecuteBefore
				const referenceAncestry = referencePath.getAncestry().reverse();
				const length = ancestry.length < referenceAncestry.length ? ancestry.length : referenceAncestry.length;
				for (let i = 1; i < length; i++) {
					if (ancestry[i] !== referenceAncestry[i]) {
						if (
							typeof ancestry[i].key === "number" &&
							typeof referenceAncestry[i].key === "number" &&
							ancestry[i].key < referenceAncestry[i].key
						) {
							return false;
						}
						if (
							(ancestry[i - 1].isForOfStatement() || ancestry[i - 1].isForInStatement()) &&
							ancestry[i].key === "left"
						) {
							return false;
						}
						if (ancestry[i - 1].isForStatement() && ancestry[i].key === "init") {
							return false;
						}
					}
				}
				return true;
			});
			if (executingBeforePath) {
				return true;
			}
			if (
				binding.referencePaths.length &&
				path.getDeepestCommonAncestorFrom(binding.referencePaths.concat([path])) !== path.parentPath
			) {
				return true;
			}
		}
		return false;
	}

	// Rewrite this, arguments and super visitor
	const rewriteThisArgumentsAndHoistVisitor: Visitor<{
		targetPath: NodePath;
		rewrite: (name: string, path: NodePath<Expression>) => void;
		rewriteSuper: boolean;
	}> = {
		Function(path) {
			path.skip();
			if (path.isArrowFunctionExpression()) {
				path.traverse(rewriteThisVisitor, this);
			}
		},
		Super(path) {
			if (this.rewriteSuper) {
				const parent = path.parentPath;
				if (parent.isMemberExpression() && parent.get("object") === path) {
					const property = parent.get("property") as NodePath<any>;
					if (parent.node.computed) {
						if (!property.isStringLiteral()) {
							throw path.buildCodeFrameError(
								`Expected a staticly resolvable super expression, got a computed expression of type ${property.node.type}`,
								TypeError
							);
						}
					}
					const grandparent = parent.parentPath;
					if (
						property.isIdentifier() &&
						grandparent.isCallExpression() &&
						grandparent.get("callee") === parent
					) {
						this.rewrite("super$" + property.node.name, parent);
						const args = grandparent.node.arguments.slice(0);
						args.unshift(types.thisExpression());
						grandparent.replaceWith(
							types.callExpression(types.memberExpression(parent.node, types.identifier("call")), args)
						);
						reregisterDeclarations(grandparent);
					}
				}
			}
		},
		ThisExpression(path) {
			// Rewrite this
			this.rewrite("this", path);
		},
		Identifier(path) {
			// Rewrite arguments
			if (path.node.name === "arguments" && identifierSearchesScope(path)) {
				this.rewrite("arguments", path);
			}
		},
		VariableDeclaration(path) {
			if (path.node.kind === "var") {
				const declarations = path.get("declarations");
				const mapped = declarations.map((declaration) => ({
					declaration,
					identifiers: identifiersInLVal(declaration.node.id),
				}));
				if (mapped.some(({ identifiers }) => anyIdentifiersRequireHoisting(identifiers, path))) {
					if (
						(path.parentPath.isForInStatement() || path.parentPath.isForOfStatement()) &&
						path.parentPath.get("left") === path &&
						declarations.length === 1
					) {
						path.replaceWith(declarations[0].node.id);
					} else {
						const expressions: Expression[] = [];
						for (const { declaration } of mapped) {
							if (declaration.node.init) {
								expressions.push(
									types.assignmentExpression("=", declaration.node.id, declaration.node.init)
								);
							}
						}
						clearDeclarationData(path);
						if (expressions.length === 0) {
							path.remove();
						} else if (expressions.length === 1) {
							path.replaceWith(expressions[0]);
						} else if (path.parentPath.isForStatement() && path.parentPath.get("init") === path) {
							path.replaceWith(types.sequenceExpression(expressions));
						} else {
							path.replaceWithMultiple(
								expressions.map((expression) => types.expressionStatement(expression))
							);
						}
					}
					for (const { identifiers } of mapped) {
						for (const id of identifiers) {
							this.targetPath.scope.push({ id });
						}
					}
				}
			}
		},
		FunctionDeclaration(path) {
			let targetPath: NodePath<FunctionDeclaration | BlockStatement> = path;
			while (targetPath.parentPath.isBlockStatement()) {
				targetPath = targetPath.parentPath;
			}
			for (const sibling of path.getAllPrevSiblings()) {
				if (!sibling.isFunctionDeclaration()) {
					const node = path.node;
					path.remove();
					reregisterDeclarations(sibling.insertBefore(node as any));
					return;
				}
			}
		},
	};

	// Rewrite this, arguments and super expressions so that they can be used in continuations
	function rewriteThisArgumentsAndHoistFunctions(rewritePath: NodePath, targetPath: NodePath, rewriteSuper: boolean) {
		rewriteToNamedConstant(targetPath, (rewrite) =>
			rewritePath.traverse(rewriteThisArgumentsAndHoistVisitor, { targetPath, rewrite, rewriteSuper })
		);
	}

	function translateTSParameterProperties<T extends Node>(
		array: Array<T | TSParameterProperty>
	): Array<T | Identifier | AssignmentPattern> {
		return array.map((n) => (n.type === "TSParameterProperty" ? n.parameter : n));
	}

	// Convert an expression or statement into a callable function expression
	function functionize(
		state: PluginState,
		params: Array<Identifier | Pattern | RestElement | TSParameterProperty>,
		expression: Expression | Statement,
		target: NodePath,
		id?: Identifier | null
	): FunctionExpression | ArrowFunctionExpression {
		const translatedParams = translateTSParameterProperties<Identifier | Pattern | RestElement>(params);
		if (!id && readConfigKey(state.opts, "target") === "es6") {
			let newExpression = expression;
			if (types.isBlockStatement(newExpression) && newExpression.body.length === 1) {
				newExpression = newExpression.body[0];
			}
			if (types.isReturnStatement(newExpression) && newExpression.argument) {
				newExpression = newExpression.argument;
			}
			const result = types.arrowFunctionExpression(
				translatedParams,
				types.isStatement(newExpression) && !types.isBlockStatement(newExpression)
					? types.blockStatement([newExpression])
					: newExpression
			);
			let usesThisOrArguments = false;
			pathForNewNode(result, target).traverse({
				Function(path) {
					path.skip();
				},
				ThisExpression(path) {
					usesThisOrArguments = true;
					path.stop();
				},
				Identifier(path) {
					if (path.node.name === "arguments" && identifierSearchesScope(path)) {
						usesThisOrArguments = true;
						path.stop();
					}
				},
			});
			if (!usesThisOrArguments) {
				return result;
			}
		}
		if (types.isExpression(expression)) {
			expression = returnStatement(expression);
		}
		if (!types.isBlockStatement(expression)) {
			expression = blockStatement([expression]);
		}
		expression.body = removeUnnecessaryReturnStatements(expression.body);
		return types.functionExpression(id, translatedParams, expression);
	}

	// Create a block statement from a list of statements
	function blockStatement(statementOrStatements: Statement[] | Statement): BlockStatement {
		if ("length" in statementOrStatements) {
			return types.blockStatement(
				statementOrStatements.filter((statement) => !types.isEmptyStatement(statement))
			);
		} else if (!types.isBlockStatement(statementOrStatements)) {
			return types.blockStatement([statementOrStatements]);
		} else {
			return statementOrStatements;
		}
	}

	// Unwrap function() { return ...(); } expressions
	function unwrapReturnCallWithEmptyArguments(
		node: Expression,
		scope: Scope,
		additionalConstantNames: string[]
	): Expression {
		if (isContinuation(node)) {
			const expression = expressionInSingleReturnStatement(node);
			if (expression && types.isCallExpression(expression)) {
				let callTarget;
				switch (expression.arguments.length) {
					case 0:
						// Match function() { return ...(); }
						callTarget = expression.callee;
						break;
					case 1: {
						const callee = expression.callee;
						const onlyArgument = expression.arguments[0];
						// Match function() { return _call(...); }
						if (types.isIdentifier(callee) && helperNameMap.get(callee) === "_call") {
							callTarget = onlyArgument;
						}
						// Match function() { return _await(...()); } or function() { return Promise.resolve(...()); }
						if (types.isIdentifier(callee) || types.isMemberExpression(callee)) {
							switch (helperNameMap.get(callee)) {
								case "_await":
								case "_promiseResolve":
									if (types.isCallExpression(onlyArgument) && onlyArgument.arguments.length === 0) {
										callTarget = onlyArgument.callee;
									}
									break;
							}
						}
						break;
					}
				}
				if (callTarget && types.isExpression(callTarget)) {
					if (types.isIdentifier(callTarget)) {
						const binding = scope.getBinding(callTarget.name);
						if (binding && binding.constant) {
							return callTarget;
						}
						if (additionalConstantNames.indexOf(callTarget.name) !== -1) {
							return callTarget;
						}
					} else if (isContinuation(callTarget)) {
						return unwrapReturnCallWithEmptyArguments(callTarget, scope, additionalConstantNames);
					}
				}
			}
		}
		return node;
	}

	// Unwrap function(arg) { return something(arg); } expressions
	function unwrapReturnCallWithPassthroughArgument(node: Expression, scope: Scope) {
		if (isContinuation(node) && node.params.length >= 1) {
			const expression = expressionInSingleReturnStatement(node);
			if (expression && types.isCallExpression(expression) && expression.arguments.length === 1) {
				const firstArgument = expression.arguments[0];
				const firstParam = node.params[0];
				if (
					types.isIdentifier(firstArgument) &&
					types.isIdentifier(firstParam) &&
					firstArgument.name === firstParam.name
				) {
					if (types.isIdentifier(expression.callee)) {
						const binding = scope.getBinding(expression.callee.name);
						if (binding && binding.constant) {
							return expression.callee;
						}
						// Simplify calls to known static functions like encodeURIComponent
						if (Object.hasOwnProperty.call(constantStaticMethods, expression.callee.name)) {
							return expression.callee;
						}
					} else if (types.isMemberExpression(expression.callee)) {
						// Simplify calls to known static methods like JSON.parse
						const propertyName = propertyNameOfMemberExpression(expression.callee);
						if (propertyName !== undefined) {
							const object = expression.callee.object;
							if (
								types.isIdentifier(object) &&
								Object.hasOwnProperty.call(constantStaticMethods, object.name) &&
								!scope.getBinding(object.name)
							) {
								const staticMethods = constantStaticMethods[object.name];
								if (
									Object.hasOwnProperty.call(staticMethods, propertyName) &&
									staticMethods[propertyName]
								) {
									return expression.callee;
								}
							}
						}
					}
				}
			}
		}
		return node;
	}

	// Return true if an expression contains entirely literals, with a list of identifiers assumed to have literal values
	function isExpressionOfLiterals(
		path: NodePath<Node | V8IntrinsicIdentifier | null | undefined>,
		literalNames: string[]
	): boolean {
		if (path.node === null || path.node === undefined) {
			return true;
		}
		if (path.isIdentifier()) {
			const name = path.node.name;
			if (name === "undefined" && !path.scope.getBinding("undefined")) {
				return true;
			}
			const binding = path.parentPath.scope.getBinding(name);
			if (binding) {
				return binding.constant;
			}
			if (literalNames.indexOf(name) !== -1) {
				return true;
			}
			if (Object.hasOwnProperty.call(constantStaticMethods, name) && !path.scope.getBinding(name)) {
				return true;
			}
			return false;
		}
		if (path.isMemberExpression()) {
			const object = path.get("object");
			if (object.isIdentifier()) {
				const propertyName = propertyNameOfMemberExpression(path.node);
				if (
					propertyName !== undefined &&
					Object.hasOwnProperty.call(constantStaticMethods, object.node.name) &&
					!path.scope.getBinding(object.node.name)
				) {
					const staticMethods = constantStaticMethods[object.node.name];
					if (Object.hasOwnProperty.call(staticMethods, propertyName) && staticMethods[propertyName]) {
						return true;
					}
				}
			}
			return false;
		}
		if (path.isBooleanLiteral()) {
			return true;
		}
		if (path.isNumericLiteral()) {
			return true;
		}
		if (path.isStringLiteral()) {
			return true;
		}
		if (path.isArrayExpression()) {
			return path
				.get("elements")
				.every((element) =>
					element === null || element.node === null
						? true
						: isExpressionOfLiterals(element as NodePath, literalNames)
				);
		}
		if (path.isNullLiteral()) {
			return true;
		}
		if (path.isObjectExpression()) {
			return path.get("properties").every((property) => {
				if (property.isObjectProperty()) {
					if (
						!property.node.computed ||
						isExpressionOfLiterals(property.get("key") as NodePath, literalNames)
					) {
						return isExpressionOfLiterals(property.get("value"), literalNames);
					}
				} else {
					return true;
				}
			});
		}
		if (path.isUnaryExpression()) {
			return isExpressionOfLiterals(path.get("argument"), literalNames);
		}
		if (path.isLogicalExpression()) {
			return (
				isExpressionOfLiterals(path.get("left"), literalNames) &&
				isExpressionOfLiterals(path.get("right"), literalNames)
			);
		}
		if (path.isBinaryExpression()) {
			return (
				isExpressionOfLiterals(path.get("left"), literalNames) &&
				isExpressionOfLiterals(path.get("right"), literalNames)
			);
		}
		if (path.isConditionalExpression()) {
			return (
				isExpressionOfLiterals(path.get("test"), literalNames) &&
				isExpressionOfLiterals(path.get("consequent"), literalNames) &&
				isExpressionOfLiterals(path.get("alternate"), literalNames)
			);
		}
		if (path.isExpression() && isContinuation(path.node)) {
			return true;
		}
		return false;
	}

	// Generate a new identifier named after the current node at a path
	function generateIdentifierForPath(path: NodePath<Node | null | undefined>): Identifier {
		const node = path.node;
		if (node) {
			const result = path.scope.generateUidIdentifierBasedOnNode(node, "temp");
			if (!path.isIdentifier() || path.node.name !== result.name) {
				return result;
			}
		}
		return path.scope.generateUidIdentifier("temp");
	}

	// Emit a truthy literal, using 1/0 if minified
	function booleanLiteral(value: boolean, minify?: boolean): NumericLiteral | BooleanLiteral {
		return minify ? types.numericLiteral(value ? 1 : 0) : types.booleanLiteral(value);
	}

	// Emit an optimized conditional expression, simplifying if possible
	function conditionalExpression(test: Expression, consequent: Expression, alternate: Expression): Expression {
		const looseValue = extractLooseBooleanValue(test);
		if (typeof looseValue !== "undefined") {
			return looseValue ? consequent : alternate;
		}
		while (types.isUnaryExpression(test) && test.operator === "!") {
			test = test.argument;
			const temp = consequent;
			consequent = alternate;
			alternate = temp;
		}
		if (
			(isValueLiteral(consequent) && isValueLiteral(alternate) && consequent.value === alternate.value) ||
			(types.isNullLiteral(consequent) && types.isNullLiteral(alternate)) ||
			(types.isIdentifier(consequent) && types.isIdentifier(alternate) && consequent.name === alternate.name)
		) {
			if (types.isIdentifier(test)) {
				return consequent;
			}
		}
		if (types.isIdentifier(test)) {
			consequent = simplifyWithIdentifier(consequent, test, true);
			alternate = simplifyWithIdentifier(alternate, test, false);
		}
		return types.conditionalExpression(test, consequent, alternate);
	}

	// Extract the boolean value of an expression, reading through unary expressions if necessary
	function extractBooleanValue(node: Expression): boolean | void {
		if (types.isBooleanLiteral(node)) {
			return node.value;
		}
		if (types.isUnaryExpression(node)) {
			if (node.operator === "!") {
				const result = extractLooseBooleanValue(node.argument);
				return typeof result === "undefined" ? undefined : !result;
			} else if (node.operator === "void") {
				return typeof extractLooseBooleanValue(node.argument) !== "undefined" ? false : undefined;
			}
		}
	}

	// Extract the thruthy value of an expression, reading through literals and unary expressions if necessary
	function extractLooseBooleanValue(node: Expression): boolean | void {
		if (isValueLiteral(node)) {
			return !!node.value;
		}
		if (types.isNullLiteral(node)) {
			return false;
		}
		if (types.isIdentifier(node)) {
			if (alwaysTruthy.indexOf(node.name) !== -1) {
				return true;
			}
			if (node.name === "undefined") {
				return false;
			}
		}
		return extractBooleanValue(node);
	}

	// Emit a logical or, optimizing based on the truthiness of both sides
	function logicalOr<L extends Expression, R extends Expression>(left: L, right: R): LogicalExpression | L | R {
		if (extractLooseBooleanValue(left) === true) {
			return left;
		} else if (extractBooleanValue(left) === false) {
			return right;
		} else {
			return types.logicalExpression("||", left, right);
		}
	}

	// Emit a logical or, optimizing based on the loose truthiness of both sides assuming that the consumer of the expression only cares about truthiness
	function logicalOrLoose<L extends Expression, R extends Expression>(
		left: L,
		right: R,
		minify?: boolean
	): LogicalExpression | BooleanLiteral | NumericLiteral | L | R {
		switch (extractLooseBooleanValue(left)) {
			case false:
				return extractLooseBooleanValue(right) === false ? booleanLiteral(false, minify) : right;
			case true:
				return booleanLiteral(true, minify);
			default:
				switch (extractLooseBooleanValue(right)) {
					case false:
						return left;
					case true:
						return booleanLiteral(true, minify);
					default:
						return types.logicalExpression("||", left, right);
				}
		}
	}

	// Emit a logical and, optimizing based on the value of the left expression
	function logicalAnd(left: Expression, right: Expression, extract = extractBooleanValue): Expression {
		switch (extract(left)) {
			case true:
				return left;
			case false:
				return right;
			default:
				return types.logicalExpression("&&", left, right);
		}
	}

	// Emit a logical not, optimizing where possible
	function logicalNot(node: Expression, minify?: boolean): Expression {
		const literalValue = extractLooseBooleanValue(node);
		if (typeof literalValue !== "undefined") {
			return booleanLiteral(!literalValue, minify);
		}
		if (
			types.isUnaryExpression(node) &&
			node.operator === "!" &&
			types.isUnaryExpression(node.argument) &&
			node.argument.operator === "!"
		) {
			return node.argument;
		}
		return types.unaryExpression("!", node);
	}

	// Unwrap the expression behind a spread element
	function unwrapSpreadElement(path: NodePath<Expression | SpreadElement>): NodePath<Expression>;
	function unwrapSpreadElement(path: NodePath<ArgumentPlaceholder>): NodePath<ArgumentPlaceholder>;
	function unwrapSpreadElement(path: NodePath<JSXNamespacedName>): NodePath<JSXNamespacedName>;
	function unwrapSpreadElement(path: NodePath<null>): NodePath<null>;
	function unwrapSpreadElement(
		path: NodePath<Expression | SpreadElement | ArgumentPlaceholder | JSXNamespacedName | null>
	): NodePath<Expression | ArgumentPlaceholder | JSXNamespacedName | null>;
	function unwrapSpreadElement(
		path: NodePath<any>
	): NodePath<Expression | ArgumentPlaceholder | JSXNamespacedName | null> {
		if (path.node === null) {
			return path as NodePath<null>;
		}
		if (path.node.type === "JSXNamespacedName") {
			return path as NodePath<JSXNamespacedName>;
		}
		if (path.isExpression()) {
			return path;
		}
		if (path.isSpreadElement()) {
			return path.get("argument");
		}
		if (isArgumentPlaceholder(path as NodePath<Node>)) {
			return path as NodePath<ArgumentPlaceholder>;
		}
		/* istanbul ignore next */
		throw path.buildCodeFrameError(
			`Expected either an expression or a spread element, got a ${path.type}!`,
			TypeError
		);
	}

	// Find the path of a declaration statement to reuse
	function findDeclarationToReuse(path: NodePath): NodePath<VariableDeclarator> | undefined {
		while (path) {
			const parent = path.parentPath;
			if (parent === null) {
				break;
			}
			if (parent.isVariableDeclarator()) {
				const id = parent.get("id");
				if (id.isIdentifier() || id.isPattern()) {
					return parent;
				}
			}
			let other;
			if (parent.isConditionalExpression()) {
				const test = parent.get("test");
				if (path === test) {
					break;
				}
				const consequent = parent.get("consequent");
				const alternate = parent.get("alternate");
				other = consequent === path ? alternate : consequent;
			} else if (parent.isLogicalExpression()) {
				const left = parent.get("left");
				const right = parent.get("right");
				other = left === path ? right : left;
			} else {
				break;
			}
			const otherAwaitPath = findAwaitOrYieldPath(other);
			if (otherAwaitPath === other || !otherAwaitPath) {
				path = parent;
			} else {
				break;
			}
		}
	}

	// Extract prefixes of an await expression out into declarations so that they can be reused in the continuation
	function extractDeclarations(
		state: PluginState,
		originalAwaitPath: NodePath<AwaitExpression | YieldExpression>,
		awaitExpression: Expression,
		additionalConstantNames: string[]
	): ExtractedDeclarations {
		let awaitPath: NodePath<Expression> = originalAwaitPath;
		const reusingExisting = findDeclarationToReuse(awaitPath);
		const reusingExistingId = reusingExisting ? reusingExisting.get("id") : undefined;
		const existingIdentifier =
			reusingExistingId && (reusingExistingId.isIdentifier() || reusingExistingId.isPattern())
				? reusingExistingId.node
				: undefined;
		let resultIdentifier: Identifier | Pattern | undefined;
		if (
			!awaitPath.parentPath.isSequenceExpression() ||
			!(awaitPath.key < (awaitPath.container as NodePath[]).length - 1)
		) {
			const argument = originalAwaitPath.get("argument");
			if (argument.isExpression()) {
				resultIdentifier = existingIdentifier || generateIdentifierForPath(argument);
			}
		}
		originalAwaitPath.replaceWith(
			types.isIdentifier(resultIdentifier) ? resultIdentifier : types.numericLiteral(0)
		);
		let declarations: VariableDeclarator[] = [];
		const isYield = originalAwaitPath.isYieldExpression();
		let directExpression: Expression = booleanLiteral(false, readConfigKey(state.opts, "minify"));
		for (;;) {
			const parent: NodePath = awaitPath.parentPath;
			if (parent.isVariableDeclarator()) {
				const beforeDeclarations: VariableDeclarator[] = [];
				let skipLiterals = true;
				for (let key = (parent.key as number) - 1; key >= 0; --key) {
					const sibling = parent.getSibling(key);
					if (sibling.isVariableDeclarator()) {
						const init = sibling.get("init");
						if (!skipLiterals || (init && !isExpressionOfLiterals(init, additionalConstantNames))) {
							skipLiterals = false;
							beforeDeclarations.unshift(sibling.node);
							sibling.remove();
						}
					} else {
						/* istanbul ignore next */
						throw sibling.buildCodeFrameError(
							`Expected a variable declarator, got a ${sibling.type}!`,
							TypeError
						);
					}
				}
				if (beforeDeclarations.length) {
					declarations = declarations.concat(beforeDeclarations.concat(declarations));
				}
			} else if (parent.isLogicalExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isYield && !isExpressionOfLiterals(left, additionalConstantNames)) {
						const leftIdentifier = generateIdentifierForPath(left);
						declarations = declarations.map((declaration) =>
							declaration.init
								? types.variableDeclarator(
										declaration.id,
										logicalAnd(
											parent.node.operator === "||" ? logicalNot(leftIdentifier) : leftIdentifier,
											declaration.init
										)
								  )
								: declaration
						);
						declarations.unshift(types.variableDeclarator(leftIdentifier, left.node));
						left.replaceWith(leftIdentifier);
					}
					const isOr = parent.node.operator === "||";
					awaitExpression = (isOr ? logicalOr : logicalAnd)(left.node, awaitExpression);
					if (!isYield) {
						directExpression = logicalOrLoose(
							isOr ? left.node : logicalNot(left.node),
							directExpression,
							readConfigKey(state.opts, "minify")
						);
					}
					if (awaitPath === originalAwaitPath) {
						if (resultIdentifier) {
							parent.replaceWith(resultIdentifier);
						} else {
							resultIdentifier =
								existingIdentifier || generateIdentifierForPath(originalAwaitPath.get("argument"));
							parent.replaceWith(resultIdentifier);
						}
						awaitPath = parent;
						continue;
					}
				}
			} else if (parent.isBinaryExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isExpressionOfLiterals(left, additionalConstantNames) && left.node.type !== "PrivateName") {
						const leftIdentifier = generateIdentifierForPath(left);
						declarations.unshift(types.variableDeclarator(leftIdentifier, left.node));
						left.replaceWith(leftIdentifier);
					}
				}
			} else if (parent.isSequenceExpression()) {
				const children = parent.get("expressions");
				const position = (children as ReadonlyArray<NodePath<Node>>).indexOf(awaitPath);
				for (var i = 0; i < position; i++) {
					const expression = children[i];
					if (!isExpressionOfLiterals(expression, additionalConstantNames)) {
						const sequenceIdentifier = generateIdentifierForPath(expression);
						declarations.unshift(types.variableDeclarator(sequenceIdentifier, expression.node));
					}
					expression.remove();
				}
				if (position === children.length - 1) {
					parent.replaceWith(children[position]);
				}
			} else if (parent.isConditionalExpression()) {
				const test = parent.get("test");
				if (awaitPath !== test) {
					let testNode = test.node;
					const consequent = parent.get("consequent");
					const alternate = parent.get("alternate");
					const other = consequent === awaitPath ? alternate : consequent;
					const otherAwaitPath = findAwaitOrYieldPath(other);
					let testIdentifier: Identifier | undefined;
					const isBoth = consequent === awaitPath && otherAwaitPath === alternate;
					if (
						!(isBoth && awaitPath === originalAwaitPath) &&
						!isExpressionOfLiterals(test, additionalConstantNames)
					) {
						testIdentifier = generateIdentifierForPath(test);
					}
					declarations = declarations.map((declaration) =>
						declaration.init
							? types.variableDeclarator(
									declaration.id,
									(consequent === awaitPath ? logicalAnd : logicalOr)(
										testIdentifier || testNode,
										declaration.init
									)
							  )
							: declaration
					);
					if (testIdentifier) {
						declarations.unshift(types.variableDeclarator(testIdentifier, testNode));
						test.replaceWith(testIdentifier);
						testNode = testIdentifier;
					}
					if (isBoth && otherAwaitPath) {
						awaitExpression = conditionalExpression(
							testNode,
							awaitExpression,
							otherAwaitPath.node.argument || types.identifier("undefined")
						);
						if (!resultIdentifier) {
							resultIdentifier =
								existingIdentifier || generateIdentifierForPath(originalAwaitPath.get("argument"));
						}
						alternate.replaceWith(resultIdentifier);
						parent.replaceWith(resultIdentifier);
					} else {
						if (!isYield) {
							directExpression = logicalOrLoose(
								consequent !== awaitPath ? testNode : logicalNot(testNode),
								directExpression,
								readConfigKey(state.opts, "minify")
							);
						}
						if (otherAwaitPath) {
							awaitExpression =
								consequent !== awaitPath
									? conditionalExpression(testNode, types.numericLiteral(0), awaitExpression)
									: conditionalExpression(testNode, awaitExpression, types.numericLiteral(0));
						} else {
							awaitExpression =
								consequent !== awaitPath
									? conditionalExpression(testNode, other.node, awaitExpression)
									: conditionalExpression(testNode, awaitExpression, other.node);
							if (!resultIdentifier) {
								resultIdentifier =
									existingIdentifier || generateIdentifierForPath(originalAwaitPath.get("argument"));
							}
							if (awaitPath === originalAwaitPath) {
								parent.replaceWith(resultIdentifier);
								awaitPath = parent;
								continue;
							}
							other.replaceWith(resultIdentifier);
						}
					}
				}
			} else if (parent.isCallExpression()) {
				const callee = parent.get("callee");
				if (callee !== awaitPath) {
					for (const arg of parent.get("arguments")) {
						const spreadArg = unwrapSpreadElement(arg);
						if (spreadArg === awaitPath || arg === awaitPath) {
							break;
						}
						if (spreadArg.isExpression() && !isExpressionOfLiterals(spreadArg, additionalConstantNames)) {
							const argIdentifier = generateIdentifierForPath(spreadArg);
							declarations.unshift(types.variableDeclarator(argIdentifier, spreadArg.node));
							spreadArg.replaceWith(argIdentifier);
						}
					}
					if (
						!isExpressionOfLiterals(callee, additionalConstantNames) &&
						typeof promiseCallExpressionType(parent.node) === "undefined"
					) {
						if (callee.isMemberExpression()) {
							const object = callee.get("object");
							const property = callee.get("property") as NodePath<Expression>;
							let objectDeclarator: VariableDeclarator | undefined;
							let staticMethods: { readonly [name: string]: boolean } = {};
							let constantObject = false;
							if (
								object.isIdentifier() &&
								Object.hasOwnProperty.call(constantStaticMethods, object.node.name) &&
								!callee.scope.getBinding(object.node.name)
							) {
								constantObject = true;
								staticMethods = constantStaticMethods[object.node.name];
							} else if (isExpressionOfLiterals(object, additionalConstantNames)) {
								constantObject = true;
							}
							if (!constantObject) {
								const objectIdentifier = generateIdentifierForPath(object);
								objectDeclarator = types.variableDeclarator(objectIdentifier, object.node);
								object.replaceWith(objectIdentifier);
							}
							if (
								!callee.node.computed &&
								property.isIdentifier() &&
								(property.node.name === "call" ||
									Object.hasOwnProperty.call(staticMethods, property.node.name))
							) {
								// parent.replaceWith(types.callExpression(types.memberExpression(object.node, types.identifier("call")), parent.node.arguments));
							} else {
								const calleeIdentifier = generateIdentifierForPath(property);
								const calleeNode = callee.node;
								const newArguments = parent.node.arguments.slice();
								newArguments.unshift({ ...object.node });
								parent.replaceWith(
									types.callExpression(
										types.memberExpression(calleeIdentifier, types.identifier("call")),
										newArguments
									)
								);
								declarations.unshift(types.variableDeclarator(calleeIdentifier, calleeNode));
							}
							if (typeof objectDeclarator !== "undefined") {
								declarations.unshift(objectDeclarator);
							}
						} else if (
							!callee.isIdentifier() ||
							!(
								helperNameMap.has(callee.node) ||
								(awaitPath.scope.getBinding(callee.node.name) || { constant: false }).constant
							)
						) {
							const calleeIdentifier = generateIdentifierForPath(callee);
							const calleeNode = callee.node;
							callee.replaceWith(calleeIdentifier);
							declarations.unshift(
								types.variableDeclarator(calleeIdentifier, discardingIntrinsics(calleeNode))
							);
						}
					}
				}
			} else if (parent.isArrayExpression()) {
				for (const element of parent.get("elements")) {
					const spreadElement = unwrapSpreadElement(element);
					if (element === awaitPath || spreadElement === awaitPath) {
						break;
					}
					if (
						spreadElement.isExpression() &&
						!isExpressionOfLiterals(spreadElement, additionalConstantNames)
					) {
						const elementIdentifier = generateIdentifierForPath(spreadElement);
						declarations.unshift(types.variableDeclarator(elementIdentifier, spreadElement.node));
						spreadElement.replaceWith(elementIdentifier);
					}
				}
			} else if (parent.isObjectExpression()) {
				for (const prop of parent.get("properties")) {
					if ((prop as unknown) === awaitPath) {
						break;
					}
					if (prop.isObjectProperty()) {
						if (prop.node.computed) {
							const propKey = prop.get("key") as NodePath;
							if (propKey === awaitPath) {
								break;
							}
							if (propKey.isExpression() && !isExpressionOfLiterals(propKey, additionalConstantNames)) {
								const keyIdentifier = generateIdentifierForPath(propKey);
								declarations.unshift(types.variableDeclarator(keyIdentifier, propKey.node));
								propKey.replaceWith(keyIdentifier);
							}
						}
						const propValue: NodePath<Expression | PatternLike> = prop.get("value");
						if (propValue === awaitPath) {
							break;
						}
						if (propValue.isExpression() && !isExpressionOfLiterals(propValue, additionalConstantNames)) {
							const propIdentifier = generateIdentifierForPath(propValue);
							declarations.unshift(types.variableDeclarator(propIdentifier, propValue.node));
							propValue.replaceWith(propIdentifier);
						}
					}
				}
			}
			if (parent.isStatement()) {
				return {
					declarationKind: reusingExisting ? (reusingExisting.parent as VariableDeclaration).kind : "const",
					declarations,
					awaitExpression,
					directExpression,
					reusingExisting,
					resultIdentifier,
				};
			}
			awaitPath = parent as NodePath<Expression>;
		}
	}

	// Helper to skip a node
	function skipNode(path: NodePath) {
		path.skip();
	}

	// Visitor to find an await path
	const awaitPathVisitor: Visitor<{ result?: NodePath<AwaitExpression> | NodePath<YieldExpression> }> = {
		Function: skipNode,
		AwaitExpression(path) {
			this.result = path;
			path.stop();
		},
		YieldExpression(path) {
			this.result = path;
			path.stop();
		},
	};

	// Finds the first child await or yield path, skipping functions
	function findAwaitOrYieldPath(path: NodePath): NodePath<AwaitExpression> | NodePath<YieldExpression> | undefined {
		if (path.isAwaitExpression() || path.isYieldExpression()) {
			return path;
		}
		const state: { result?: NodePath<AwaitExpression> | NodePath<YieldExpression> } = Object.create(null);
		path.traverse(awaitPathVisitor, state);
		return state.result;
	}

	// Build an expression that checks if a loop should be exited
	function buildBreakExitCheck(
		state: PluginState,
		exitIdentifier?: Identifier | undefined,
		breakIdentifiers?: { identifier: Identifier }[]
	): Expression | undefined {
		if (breakIdentifiers !== undefined && breakIdentifiers.length > 0) {
			const minify = readConfigKey(state.opts, "minify");
			const first = breakIdentifiers[0].identifier as Expression;
			const partial = breakIdentifiers
				.slice(1)
				.reduce((accumulator, { identifier }) => logicalOrLoose(accumulator, identifier, minify), first);
			return exitIdentifier ? logicalOrLoose(partial, exitIdentifier, minify) : partial;
		} else {
			return exitIdentifier;
		}
	}

	// Pushes missing values onto an array
	function pushMissing<T>(destination: T[], source: T[]) {
		for (var value of source) {
			var index = destination.indexOf(value);
			if (index < 0) {
				destination.push(value);
			}
		}
	}

	// Assigns to a break identifier
	function setBreakIdentifier(value: Expression, breakIdentifier: BreakContinueItem): Expression {
		return types.assignmentExpression("=", breakIdentifier.identifier, value);
	}

	// Assigns to all break identifiers in a list
	function setBreakIdentifiers(breakIdentifiers: ReadonlyArray<BreakContinueItem>, pluginState: PluginState) {
		return breakIdentifiers.reduce(
			setBreakIdentifier,
			booleanLiteral(true, readConfigKey(pluginState.opts, "minify"))
		);
	}

	function expressionNeverThrows(expression: Expression): boolean {
		return (
			isValueLiteral(expression) ||
			types.isIdentifier(expression) ||
			(types.isUnaryExpression(expression) && isValueLiteral(expression.argument))
		);
	}

	// Visitor that replaces all returns and breaks with updates to the appropriate break/exit bookkeeping variables
	const replaceReturnsAndBreaksVisitor: Visitor<{
		pluginState: PluginState;
		exitIdentifier?: Identifier;
		breakIdentifiers: BreakContinueItem[];
		usedIdentifiers: BreakContinueItem[];
		switchCount: number;
	}> = {
		Function: skipNode,
		ReturnStatement(path) {
			if (!skipNodeSet.has(path.node) && this.exitIdentifier) {
				const minify = readConfigKey(this.pluginState.opts, "minify");
				if (path.node.argument) {
					if (minify && extractLooseBooleanValue(path.node.argument) === true) {
						// assign _exit using a truthy return value
						path.replaceWith(
							returnStatement(
								types.assignmentExpression("=", this.exitIdentifier, path.node.argument),
								path.node
							)
						);
					} else if (expressionNeverThrows(path.node.argument)) {
						// path cannot throw, assign _exit first
						path.replaceWithMultiple([
							types.expressionStatement(
								types.assignmentExpression("=", this.exitIdentifier, booleanLiteral(true, minify))
							),
							returnStatement(path.node.argument, path.node),
						]);
					} else {
						// path might throw, evaluate it and assign to a temporary before assigning _exit
						const tempIdentifier = path.scope.generateUidIdentifierBasedOnNode(path.node.argument, "temp");
						path.replaceWithMultiple([
							types.variableDeclaration("const", [
								types.variableDeclarator(tempIdentifier, path.node.argument),
							]),
							types.expressionStatement(
								types.assignmentExpression("=", this.exitIdentifier, booleanLiteral(true, minify))
							),
							returnStatement(tempIdentifier, path.node),
						]);
					}
				} else {
					// empty return, assign _exit before returning
					path.replaceWithMultiple([
						types.expressionStatement(
							types.assignmentExpression("=", this.exitIdentifier, booleanLiteral(true, minify))
						),
						returnStatement(undefined, path.node),
					]);
				}
			}
		},
		SwitchStatement: {
			enter() {
				this.switchCount++;
			},
			exit() {
				this.switchCount--;
			},
		},
		Loop: {
			enter(path) {
				const parent = path.parentPath;
				this.breakIdentifiers.unshift({
					identifier: types.identifier("break"),
					path,
					name: parent.isLabeledStatement() ? parent.node.label.name : undefined,
					isAsync: false,
				});
			},
			exit() {
				this.breakIdentifiers.shift();
			},
		},
		BreakStatement(path) {
			const label = path.node.label;
			if (label || this.switchCount === 0) {
				const index = label
					? this.breakIdentifiers.findIndex((breakIdentifier) => breakIdentifier.name === label.name)
					: 0;
				const replace = returnStatement(undefined, path.node);
				if (index !== -1 && this.breakIdentifiers.length) {
					if (!this.breakIdentifiers[index].isAsync) {
						return;
					}
					const used = this.breakIdentifiers.slice(0, index + 1);
					if (used.length) {
						pushMissing(this.usedIdentifiers, used);
						path.replaceWithMultiple([
							types.expressionStatement(setBreakIdentifiers(used, this.pluginState)),
							replace,
						]);
						return;
					}
				}
				path.replaceWith(replace);
			}
		},
		ContinueStatement(path) {
			const label = path.node.label;
			const index = label
				? this.breakIdentifiers.findIndex((breakIdentifier) => breakIdentifier.name === label.name)
				: 0;
			const replace = returnStatement(undefined, path.node);
			if (index !== -1 && this.breakIdentifiers.length) {
				if (!this.breakIdentifiers[index].isAsync) {
					return;
				}
				const used = this.breakIdentifiers.slice(0, index);
				if (used.length) {
					pushMissing(this.usedIdentifiers, used);
					path.replaceWithMultiple([
						types.expressionStatement(setBreakIdentifiers(used, this.pluginState)),
						replace,
					]);
					return;
				}
			}
			path.replaceWith(replace);
		},
	};

	// Helper that replaces all returns and breaks with updates to the appropriate break/exit bookkeeping variables
	function replaceReturnsAndBreaks(
		pluginState: PluginState,
		path: NodePath,
		exitIdentifier: Identifier | undefined,
		existingUsedIdentifiers?: BreakContinueItem[]
	): BreakContinueItem[] {
		const usedIdentifiers: BreakContinueItem[] = [];
		// Import existing break identifiers that still exist in scope
		if (existingUsedIdentifiers !== undefined) {
			for (const item of existingUsedIdentifiers) {
				if (
					path.parentPath === null ||
					path.parentPath.scope.getBinding(item.identifier.name) ===
						path.scope.getBinding(item.identifier.name)
				) {
					usedIdentifiers.push(item);
				}
			}
		}
		// Search for new breaks
		const state = {
			pluginState,
			exitIdentifier,
			breakIdentifiers: breakContinueStackForPath(path),
			usedIdentifiers,
			switchCount: 0,
		};
		path.traverse(replaceReturnsAndBreaksVisitor, state);
		// Add declarations for any new identifiers
		for (const { identifier, path: identifierPath } of usedIdentifiers) {
			const parentScope = identifierPath.parentPath.scope;
			if (!parentScope.getBinding(identifier.name)) {
				parentScope.push({
					kind: "let",
					id: identifier,
					init: readConfigKey(pluginState.opts, "minify")
						? undefined
						: booleanLiteral(false, readConfigKey(pluginState.opts, "minify")),
				});
			}
		}
		return usedIdentifiers;
	}

	// Finds the break identifier associated with a path
	function breakIdentifierForPath(path: NodePath): Identifier {
		let result = breakIdentifierMap.get(path.node);
		if (!result) {
			result = path.scope.generateUidIdentifier(
				path.parentPath !== null && path.parentPath.isLabeledStatement()
					? path.parentPath.node.label.name + "Interrupt"
					: "interrupt"
			);
			breakIdentifierMap.set(path.node, result);
		}
		return result;
	}

	// Visitor that searches for unlabeled break statements
	const simpleBreakOrContinueReferencesVisitor: Visitor<{ references: NodePath[] }> = {
		Function: skipNode,
		Loop: skipNode,
		SwitchStatement: skipNode,
		BreakStatement(path) {
			if (!path.node.label) {
				this.references.push(path);
			}
		},
		// ContinueStatement(path) {
		// 	if (!path.node.label) {
		// 		this.references.push(path);
		// 	}
		// },
		ReturnStatement(path) {
			const originalNode = originalNodeMap.get(path.node);
			if (originalNode) {
				traverse(
					wrapNodeInStatement(originalNode),
					simpleBreakOrContinueReferencesVisitor,
					path.scope,
					this,
					path
				);
				path.skip();
			}
		},
	};

	// Searches for unlabeled break statements
	function simpleBreakOrContinueReferences(path: NodePath): NodePath[] {
		const state = { references: [] };
		path.traverse(simpleBreakOrContinueReferencesVisitor, state);
		return state.references;
	}

	// Visitor that searches for named label breaks/continues
	const namedLabelReferencesVisitor: Visitor<{ name: string; breaks: NodePath[]; continues: NodePath[] }> = {
		Function: skipNode,
		BreakStatement(path) {
			if (path.node.label && path.node.label.name === this.name) {
				this.breaks.push(path);
			}
		},
		ContinueStatement(path) {
			if (path.node.label && path.node.label.name === this.name) {
				this.continues.push(path);
			}
		},
		ReturnStatement(path) {
			const originalNode = originalNodeMap.get(path.node);
			if (originalNode) {
				traverse(wrapNodeInStatement(originalNode), namedLabelReferencesVisitor, path.scope, this, path);
				path.skip();
			}
		},
	};

	// Searches for named label breaks/continues
	function namedLabelReferences(
		labelPath: NodePath<LabeledStatement>,
		targetPath: NodePath
	): { name: string; breaks: NodePath[]; continues: NodePath[] } {
		const state = { name: labelPath.node.label.name, breaks: [], continues: [] };
		targetPath.traverse(namedLabelReferencesVisitor, state);
		return state;
	}

	// Build the break/continue stack for a path
	function breakContinueStackForPath(path: NodePath): BreakContinueItem[] {
		let current: NodePath | null = path;
		const result = [] as BreakContinueItem[];
		while (current && !current.isFunction()) {
			if (current.isLoop() || current.isSwitchStatement()) {
				const breaks = pathsBreak(current);
				if (breaks.any && (!current.isSwitchStatement() || !breaks.all)) {
					const simpleReferences = simpleBreakOrContinueReferences(current);
					if (current.parentPath.isLabeledStatement()) {
						const refs = namedLabelReferences(current.parentPath, path);
						if (simpleReferences.length || refs.breaks.length || refs.continues.length) {
							result.push({
								identifier: breakIdentifierForPath(current),
								name: current.parentPath.node.label.name,
								path: current.parentPath,
								isAsync: true,
							});
						}
						current = current.parentPath;
					} else if (simpleReferences.length) {
						result.push({
							identifier: breakIdentifierForPath(current),
							path: current,
							isAsync: true,
						});
					}
				}
			} else if (current.isLabeledStatement()) {
				const refs = namedLabelReferences(current, path);
				if (refs.breaks.length || refs.continues.length) {
					result.push({
						identifier: breakIdentifierForPath(current.get("body")),
						name: current.node.label.name,
						path: current,
						isAsync: true,
					});
				}
			}
			current = current.parentPath;
		}
		return result;
	}

	// Check if a path is a for-await statement (not supported on all Babel versions)
	function isForAwaitStatement(path: NodePath<any>): path is NodePath<ForAwaitStatement> {
		return path.isForAwaitStatement && path.node ? path.isForAwaitStatement() : false;
	}

	// Check if a path is an ArgumentPlaceholder statement (not supported on all Babel versions)
	function isArgumentPlaceholder(path: NodePath<Node>): path is NodePath<ArgumentPlaceholder> {
		return path.node.type === "ArgumentPlaceholder";
	}

	// Find the most immediate statement parent of a path
	function getStatementOrArrowBodyParent(path: NodePath<Statement | Expression>): NodePath<Statement | Expression> {
		let parent: NodePath<Node> | null = path;
		while (parent) {
			if (parent.isStatement()) {
				return parent;
			}
			if (parent.isArrowFunctionExpression()) {
				return parent.get("body");
			}
			parent = parent.parentPath;
		}
		/* istanbul ignore next */
		throw path.buildCodeFrameError(`Expected a statement parent!`, TypeError);
	}

	// Add constant names to a contant name array
	function addConstantNames(additionalConstantNames: string[], node: LVal) {
		if (types.isIdentifier(node)) {
			if (additionalConstantNames.indexOf(node.name) === -1) {
				additionalConstantNames.push(node.name);
			}
		} else if (types.isArrayPattern(node)) {
			for (const element of node.elements) {
				if (types.isIdentifier(element) || types.isPattern(element) || types.isRestElement(element)) {
					addConstantNames(additionalConstantNames, element);
				}
			}
		} else if (types.isObjectPattern(node)) {
			for (const property of node.properties) {
				if (types.isObjectProperty(property)) {
					addConstantNames(additionalConstantNames, property.key as any as LVal);
				} else if (types.isRestElement(property)) {
					addConstantNames(additionalConstantNames, property.argument);
				}
			}
		} else if (types.isRestElement(node)) {
			addConstantNames(additionalConstantNames, node.argument);
		}
	}

	interface RewriteAwaitState {
		generatorState: GeneratorState;
		path: NodePath;
		additionalConstantNames: string[];
		exitIdentifier?: Identifier;
		skipReturns?: boolean;
	}

	// Calls the _yield helper on an expression
	function yieldOnExpression(state: GeneratorState, expression: Expression) {
		const generatorIdentifier = state.generatorIdentifier;
		if (typeof generatorIdentifier === "undefined") {
			/* istanbul ignore next */
			throw new Error("Encountered a yield expression outside a generator function!");
		}
		const callee = types.memberExpression(generatorIdentifier, types.identifier("_yield"));
		helperNameMap.set(callee, "_yield");
		return types.callExpression(callee, [expression]);
	}

	// Rewrites an await or for-await expression
	function rewriteAwaitOrYieldPath(
		this: RewriteAwaitState,
		rewritePath: NodePath<AwaitExpression> | NodePath<YieldExpression> | NodePath<ForOfStatement>
	) {
		const state = this;
		const pluginState = state.generatorState.state;
		const path = state.path;
		const additionalConstantNames = state.additionalConstantNames;
		let awaitPath: NodePath<AwaitExpression> | NodePath<YieldExpression> | NodePath<Node>;
		let processExpressions: boolean;
		const rewritePathCopy = rewritePath;
		if (rewritePath.isAwaitExpression() || rewritePath.isYieldExpression()) {
			awaitPath = rewritePath;
			processExpressions = true;
		} else if (rewritePath.isForOfStatement() || isForAwaitStatement(rewritePath)) {
			const left = rewritePath.get("left");
			if (left.isAwaitExpression()) {
				awaitPath = (left as NodePath<AwaitExpression>).get("argument");
			} else if (left.isSpreadElement()) {
				awaitPath = unwrapSpreadElement(left);
			} else {
				awaitPath = left;
			}
			processExpressions = false;
		} else {
			/* istanbul ignore next */
			throw rewritePathCopy.buildCodeFrameError(
				`Expected either an await expression or a for await statement, got a ${rewritePathCopy.type}!`,
				TypeError
			);
		}
		const paths: {
			targetPath: NodePath;
			explicitExits: TraversalTestResult;
			parent: NodePath;
			exitIdentifier?: Identifier;
			breakIdentifiers?: BreakContinueItem[];
			forToIdentifiers?: ForToIdentifier;
			cases?: {
				casePath: NodePath<SwitchCase>;
				caseExits: TraversalTestResult;
				caseBreaks: TraversalTestResult;
				breakIdentifiers: BreakContinueItem[];
				test: Expression | null | undefined;
			}[];
		}[] = [];
		{
			// Determine if we need an exit identifier and rewrite break/return statements
			let targetPath: NodePath = awaitPath;
			let shouldPushExitIdentifier = false;
			while (targetPath !== path) {
				const parent = targetPath.parentPath;
				if (parent == null) {
					break;
				}
				if (!parent.isSwitchCase() && !parent.isBlockStatement()) {
					let exitIdentifier;
					const explicitExits = pathsReturnOrThrow(parent);
					if (!explicitExits.all && explicitExits.any && (parent.isLoop() || exitsInTail(parent))) {
						if (!state.exitIdentifier) {
							state.exitIdentifier = targetPath.scope.generateUidIdentifier("exit");
							shouldPushExitIdentifier = true;
						}
						exitIdentifier = state.exitIdentifier;
					}
					paths.push({
						targetPath,
						explicitExits,
						parent,
						exitIdentifier,
					});
				}
				targetPath = parent;
			}
			if (shouldPushExitIdentifier && state.exitIdentifier) {
				path.scope.push({
					kind: "let",
					id: state.exitIdentifier,
					init: readConfigKey(pluginState.opts, "minify")
						? undefined
						: booleanLiteral(false, readConfigKey(pluginState.opts, "minify")),
				});
			}
		}
		let breakIdentifiers: BreakContinueItem[] = [];
		for (const item of paths) {
			const parent = item.parent;
			if (
				parent.isForStatement() ||
				parent.isWhileStatement() ||
				parent.isDoWhileStatement() ||
				parent.isForInStatement() ||
				parent.isForOfStatement() ||
				isForAwaitStatement(parent) ||
				parent.isLabeledStatement()
			) {
				breakIdentifiers = item.breakIdentifiers = replaceReturnsAndBreaks(
					pluginState,
					parent.get("body") as NodePath,
					item.exitIdentifier,
					breakIdentifiers
				);
				if (parent.isForStatement()) {
					if ((item.forToIdentifiers = identifiersInForToLengthStatement(parent))) {
						addConstantNames(additionalConstantNames, item.forToIdentifiers.i);
					}
				}
			} else if (item.parent.isSwitchStatement()) {
				breakIdentifiers = breakIdentifiers.slice();
				item.cases = item.parent.get("cases").map((casePath) => {
					const caseExits = pathsReturnOrThrow(casePath);
					const caseBreaks = pathsBreak(casePath);
					const caseBreakIdentifiers = (item.breakIdentifiers = replaceReturnsAndBreaks(
						pluginState,
						casePath,
						item.exitIdentifier,
						breakIdentifiers
					));
					for (const breakItem of caseBreakIdentifiers) {
						if (
							!breakIdentifiers.find((existing) => existing.identifier.name === breakItem.identifier.name)
						) {
							breakIdentifiers.push(breakItem);
						}
					}
					return {
						casePath,
						caseExits,
						caseBreaks,
						breakIdentifiers: caseBreakIdentifiers,
						test: casePath.node.test,
					};
				});
			} else {
				breakIdentifiers = item.breakIdentifiers = replaceReturnsAndBreaks(
					pluginState,
					parent,
					item.exitIdentifier,
					breakIdentifiers
				);
			}
		}
		for (const {
			targetPath,
			explicitExits,
			breakIdentifiers,
			parent,
			exitIdentifier,
			cases,
			forToIdentifiers,
		} of paths) {
			if (
				parent.isExpressionStatement() &&
				(targetPath.isAwaitExpression() || targetPath.isYieldExpression()) &&
				processExpressions
			) {
				processExpressions = false;
				relocateTail(
					state.generatorState,
					targetPath.isYieldExpression()
						? yieldOnExpression(
								state.generatorState,
								targetPath.node.argument || types.identifier("undefined")
						  )
						: targetPath.node.argument,
					undefined,
					parent,
					additionalConstantNames,
					undefined,
					undefined,
					targetPath.isYieldExpression()
						? undefined
						: booleanLiteral(false, readConfigKey(pluginState.opts, "minify")),
					state.skipReturns
				);
			} else if (parent.isIfStatement()) {
				const test = parent.get("test");
				if (targetPath !== test) {
					let resultIdentifier;
					if (!explicitExits.all && explicitExits.any) {
						resultIdentifier = path.scope.generateUidIdentifier("result");
						addConstantNames(additionalConstantNames, resultIdentifier);
					}
					if (!explicitExits.all) {
						const consequent = parent.get("consequent");
						rewriteAsyncBlock(state.generatorState, consequent, additionalConstantNames, exitIdentifier);
						const alternate = parent.get("alternate");
						if (alternate.isStatement()) {
							rewriteAsyncBlock(state.generatorState, alternate, additionalConstantNames, exitIdentifier);
						}
						const fn = functionize(pluginState, [], blockStatement([parent.node]), targetPath);
						relocateTail(
							state.generatorState,
							types.callExpression(fn, []),
							undefined,
							parent,
							additionalConstantNames,
							resultIdentifier,
							exitIdentifier,
							undefined,
							state.skipReturns
						);
						processExpressions = false;
					}
				}
			} else if (parent.isTryStatement()) {
				const temporary =
					explicitExits.any && !explicitExits.all ? path.scope.generateUidIdentifier("result") : undefined;
				const exitCheck = buildBreakExitCheck(
					pluginState,
					explicitExits.any && !explicitExits.all ? exitIdentifier : undefined,
					breakIdentifiers
				);
				let expression: Expression | Statement = rewriteAsyncNode(
					state.generatorState,
					parent,
					parent.node.block!,
					additionalConstantNames,
					exitIdentifier
				);
				const catchClause = parent.node.handler;
				if (catchClause) {
					const param = catchClause.param;
					const paramIsUsed =
						param !== null &&
						param !== undefined &&
						(param.type !== "Identifier" ||
							parent.get("handler").scope.getBinding(param.name)!.referencePaths.length !== 0);
					const fn = catchClause.body.body.length
						? rewriteAsyncNode(
								state.generatorState,
								parent,
								functionize(
									pluginState,
									paramIsUsed && param != null ? [param] : [],
									catchClause.body,
									targetPath
								),
								additionalConstantNames,
								exitIdentifier
						  )
						: emptyFunction(pluginState, parent);
					expression = types.callExpression(
						helperReference(
							pluginState,
							path,
							state.generatorState.generatorIdentifier ? "_catchInGenerator" : "_catch"
						),
						[
							unwrapReturnCallWithEmptyArguments(
								functionize(pluginState, [], expression, targetPath),
								path.scope,
								additionalConstantNames
							),
							fn,
						]
					);
				}
				if (parent.node.finalizer) {
					let finallyName: HelperName;
					let finallyArgs: Identifier[];
					let finallyBody = parent.node.finalizer.body;
					if (!pathsReturnOrThrow(parent.get("finalizer")).all) {
						const resultIdentifier = temporary || path.scope.generateUidIdentifier("result");
						addConstantNames(additionalConstantNames, resultIdentifier);
						const wasThrownIdentifier = path.scope.generateUidIdentifier("wasThrown");
						addConstantNames(additionalConstantNames, wasThrownIdentifier);
						finallyArgs = [wasThrownIdentifier, resultIdentifier];
						if (readConfigKey(pluginState.opts, "inlineHelpers")) {
							finallyBody = finallyBody.concat([
								types.ifStatement(wasThrownIdentifier, types.throwStatement(resultIdentifier)),
								types.returnStatement(resultIdentifier),
							]);
						} else {
							finallyBody = finallyBody.concat(
								returnStatement(
									types.callExpression(helperReference(pluginState, parent, "_rethrow"), [
										wasThrownIdentifier,
										resultIdentifier,
									])
								)
							);
						}
						finallyName = "_finallyRethrows";
					} else {
						finallyArgs = [];
						finallyName = "_finally";
					}
					const fn = functionize(pluginState, finallyArgs, blockStatement(finallyBody), targetPath);
					const rewritten = rewriteAsyncNode(
						state.generatorState,
						parent,
						fn,
						additionalConstantNames,
						exitIdentifier
					);
					expression = types.callExpression(helperReference(pluginState, parent, finallyName), [
						unwrapReturnCallWithEmptyArguments(
							functionize(pluginState, [], expression, targetPath),
							path.scope,
							additionalConstantNames
						),
						rewritten,
					]);
				}
				relocateTail(
					state.generatorState,
					types.isExpression(expression)
						? expression
						: types.callExpression(functionize(pluginState, [], expression, targetPath), []),
					undefined,
					parent,
					additionalConstantNames,
					temporary,
					exitCheck,
					undefined,
					state.skipReturns
				);
				processExpressions = false;
			} else if (
				parent.isForStatement() ||
				parent.isWhileStatement() ||
				parent.isDoWhileStatement() ||
				parent.isForInStatement() ||
				parent.isForOfStatement() ||
				isForAwaitStatement(parent)
			) {
				const label = parent.parentPath.isLabeledStatement() ? parent.parentPath.node.label.name : undefined;
				if (parent.isForInStatement() || parent.isForOfStatement() || isForAwaitStatement(parent)) {
					const right = parent.get("right") as NodePath<Expression>;
					if (awaitPath !== right) {
						const left = parent.get("left") as NodePath<VariableDeclaration | LVal>;
						const loopIdentifier = left.isVariableDeclaration()
							? left.get("declarations")[0].get("id")
							: left;
						if (loopIdentifier.isIdentifier() || loopIdentifier.isPattern()) {
							const forOwnBodyPath = parent.isForInStatement() && extractForOwnBodyPath(parent);
							const bodyBlock = blockStatement(
								(forOwnBodyPath || (parent.get("body") as NodePath<Statement>)).node
							);
							const params = [
								right.node,
								rewriteAsyncNode(
									state.generatorState,
									parent,
									bodyBlock.body.length
										? functionize(pluginState, [loopIdentifier.node], bodyBlock, targetPath)
										: emptyFunction(pluginState, parent),
									additionalConstantNames,
									exitIdentifier
								),
							];
							const exitCheck = buildBreakExitCheck(pluginState, exitIdentifier, breakIdentifiers);
							if (exitCheck) {
								params.push(
									functionize(
										pluginState,
										[],
										types.blockStatement([returnStatement(exitCheck)]),
										targetPath
									)
								);
							}
							const loopCall = types.callExpression(
								helperReference(
									pluginState,
									parent,
									parent.isForInStatement()
										? forOwnBodyPath
											? "_forOwn"
											: "_forIn"
										: isForAwaitStatement(parent)
										? "_forAwaitOf"
										: "_forOf"
								),
								params
							);
							let resultIdentifier = undefined;
							if (explicitExits.any) {
								resultIdentifier = path.scope.generateUidIdentifier("result");
								addConstantNames(additionalConstantNames, resultIdentifier);
							}
							relocateTail(
								state.generatorState,
								loopCall,
								undefined,
								label && parent.parentPath.isStatement()
									? parent.parentPath
									: (parent as NodePath<Statement>),
								additionalConstantNames,
								resultIdentifier,
								exitIdentifier,
								undefined,
								state.skipReturns
							);
							processExpressions = false;
						} else {
							/* istanbul ignore next */
							throw loopIdentifier.buildCodeFrameError(
								`Expected an identifier or pattern, but got a ${loopIdentifier.type}!`,
								TypeError
							);
						}
					}
				} else {
					let testExpression = parent.node.test;
					const breakExitCheck = buildBreakExitCheck(pluginState, exitIdentifier, breakIdentifiers);
					if (breakExitCheck) {
						const inverted = logicalNot(breakExitCheck, readConfigKey(pluginState.opts, "minify"));
						testExpression =
							testExpression && (!types.isBooleanLiteral(testExpression) || !testExpression.value)
								? logicalAnd(inverted, testExpression, extractLooseBooleanValue)
								: inverted;
					}
					if (testExpression) {
						testExpression = rewriteAsyncNode(
							state.generatorState,
							parent,
							functionize(pluginState, [], testExpression, targetPath),
							additionalConstantNames,
							exitIdentifier,
							true
						);
					}
					const isDoWhile = parent.isDoWhileStatement();
					let loopCall;
					if (forToIdentifiers && !isDoWhile) {
						const args = [
							forToIdentifiers.array,
							rewriteAsyncNode(
								state.generatorState,
								parent,
								functionize(
									pluginState,
									[forToIdentifiers.i],
									blockStatement(parent.node.body),
									targetPath
								),
								additionalConstantNames,
								exitIdentifier
							),
						];
						if (breakExitCheck) {
							args.push(functionize(pluginState, [], breakExitCheck, targetPath));
						}
						loopCall = types.callExpression(helperReference(pluginState, parent, "_forTo"), args);
					} else {
						let updateExpression: Expression | null | undefined = null;
						if (parent.isForStatement()) {
							updateExpression = parent.node.update;
							if (updateExpression) {
								updateExpression = rewriteAsyncNode(
									state.generatorState,
									parent,
									functionize(pluginState, [], updateExpression, targetPath),
									additionalConstantNames,
									exitIdentifier,
									true
								);
							}
							const init = parent.get("init");
							if (init) {
								const initNode = init.node;
								if (initNode !== null && initNode !== undefined) {
									reregisterDeclarations(
										parent.insertBefore(
											types.isExpression(initNode)
												? types.expressionStatement(initNode)
												: initNode
										)
									);
								}
							}
						}
						const bodyFunction = rewriteAsyncNode(
							state.generatorState,
							parent,
							functionize(pluginState, [], blockStatement(parent.node.body || []), targetPath),
							additionalConstantNames,
							exitIdentifier
						);
						const testFunction = unwrapReturnCallWithEmptyArguments(
							testExpression || voidExpression(),
							path.scope,
							additionalConstantNames
						);
						const updateFunction = unwrapReturnCallWithEmptyArguments(
							updateExpression || voidExpression(),
							path.scope,
							additionalConstantNames
						);
						loopCall = isDoWhile
							? types.callExpression(helperReference(pluginState, parent, "_do"), [
									bodyFunction,
									testFunction,
							  ])
							: types.callExpression(helperReference(pluginState, parent, "_for"), [
									testFunction,
									updateFunction,
									bodyFunction,
							  ]);
					}
					let resultIdentifier = undefined;
					if (explicitExits.any) {
						resultIdentifier = path.scope.generateUidIdentifier("result");
						addConstantNames(additionalConstantNames, resultIdentifier);
					}
					relocateTail(
						state.generatorState,
						loopCall,
						undefined,
						parent,
						additionalConstantNames,
						resultIdentifier,
						exitIdentifier,
						undefined,
						state.skipReturns
					);
					processExpressions = false;
				}
			} else if (parent.isSwitchStatement()) {
				const label = parent.parentPath.isLabeledStatement() ? parent.parentPath.node.label.name : undefined;
				const discriminant = parent.get("discriminant");
				const testPaths = parent.get("cases").map((casePath) => casePath.get("test"));
				if (
					awaitPath !== discriminant &&
					!(
						explicitExits.all &&
						!testPaths.some((testPath) =>
							testPath.node ? findAwaitOrYieldPath(testPath as NodePath<Expression>) !== undefined : false
						)
					)
				) {
					let resultIdentifier;
					if (!explicitExits.all && explicitExits.any) {
						resultIdentifier = path.scope.generateUidIdentifier("result");
						addConstantNames(additionalConstantNames, resultIdentifier);
					}
					const caseNodes = types.arrayExpression(
						cases
							? cases.map((caseItem) => {
									const args = [];
									let consequent;
									if (caseItem.casePath.node.consequent) {
										const rewritten = rewriteAsyncNode(
											state.generatorState,
											parent,
											blockStatement(
												removeUnnecessaryReturnStatements(caseItem.casePath.node.consequent)
											),
											additionalConstantNames,
											exitIdentifier
										);
										if (rewritten.body.length) {
											consequent = functionize(pluginState, [], rewritten, targetPath);
										}
									}
									if (caseItem.casePath.node.test) {
										args.push(
											rewriteAsyncNode(
												state.generatorState,
												parent,
												functionize(pluginState, [], caseItem.casePath.node.test, targetPath),
												additionalConstantNames
											)
										);
									} else if (consequent) {
										args.push(voidExpression());
									}
									if (consequent) {
										args.push(consequent);
										if (!caseItem.caseExits.any && !caseItem.caseBreaks.any) {
											args.push(emptyFunction(pluginState, parent));
										} else if (!(caseItem.caseExits.all || caseItem.caseBreaks.all)) {
											const breakCheck = buildBreakExitCheck(
												pluginState,
												caseItem.caseExits.any ? exitIdentifier : undefined,
												caseItem.breakIdentifiers
											);
											if (breakCheck) {
												args.push(
													functionize(
														pluginState,
														[],
														types.blockStatement([returnStatement(breakCheck)]),
														targetPath
													)
												);
											}
										}
									}
									return types.arrayExpression(args);
							  })
							: []
					);
					const switchCall = types.callExpression(helperReference(pluginState, parent, "_switch"), [
						discriminant.node,
						caseNodes,
					]);
					relocateTail(
						state.generatorState,
						switchCall,
						undefined,
						label && parent.parentPath.isStatement() ? parent.parentPath : parent,
						additionalConstantNames,
						resultIdentifier,
						exitIdentifier,
						undefined,
						state.skipReturns
					);
					processExpressions = false;
				}
			} else if (parent.isLabeledStatement()) {
				let resultIdentifier;
				if (!explicitExits.all && explicitExits.any) {
					resultIdentifier = path.scope.generateUidIdentifier("result");
					addConstantNames(additionalConstantNames, resultIdentifier);
				}
				if (resultIdentifier || (breakIdentifiers && breakIdentifiers.length)) {
					const filteredBreakIdentifiers = breakIdentifiers
						? breakIdentifiers.filter((id) => id.name !== parent.node.label.name)
						: [];
					const fn = functionize(pluginState, [], blockStatement(parent.node.body), targetPath);
					const rewritten = rewriteAsyncNode(
						state.generatorState,
						parent,
						fn,
						additionalConstantNames,
						exitIdentifier
					);
					const exitCheck = buildBreakExitCheck(
						pluginState,
						explicitExits.any ? exitIdentifier : undefined,
						filteredBreakIdentifiers
					);
					relocateTail(
						state.generatorState,
						types.callExpression(rewritten, []),
						undefined,
						parent,
						additionalConstantNames,
						resultIdentifier,
						exitCheck,
						undefined,
						state.skipReturns
					);
					processExpressions = false;
				}
			}
		}
		if (processExpressions) {
			if (awaitPath.isAwaitExpression() || awaitPath.isYieldExpression()) {
				const originalArgument = awaitPath.node.argument;
				let parent = getStatementOrArrowBodyParent(awaitPath);
				const {
					declarationKind,
					declarations,
					awaitExpression,
					directExpression,
					reusingExisting,
					resultIdentifier,
				} = extractDeclarations(
					pluginState,
					awaitPath,
					originalArgument || types.identifier("undefined"),
					additionalConstantNames
				);
				if (resultIdentifier) {
					addConstantNames(additionalConstantNames, resultIdentifier);
				}
				if (declarations.length) {
					for (const { id } of declarations) {
						addConstantNames(additionalConstantNames, id);
					}
					if (parent.parentPath.isBlockStatement()) {
						reregisterDeclarations(
							parent.insertBefore(types.variableDeclaration(declarationKind, declarations))
						);
					} else {
						parent.replaceWith(
							blockStatement([
								types.variableDeclaration(declarationKind, declarations),
								types.isStatement(parent.node) ? parent.node : returnStatement(parent.node),
							])
						);
						const body = (parent as unknown as NodePath<BlockStatement>).get("body");
						reregisterDeclarations(body[0]);
						parent = body[1];
					}
				}
				if (reusingExisting) {
					if (
						types.isVariableDeclaration(reusingExisting.parent) &&
						reusingExisting.parent.declarations.length === 1
					) {
						reusingExisting.parentPath.replaceWith(types.emptyStatement());
					} else {
						reusingExisting.remove();
					}
				}
				const parentNode = parent.node;
				relocateTail(
					state.generatorState,
					awaitPath.isYieldExpression()
						? yieldOnExpression(state.generatorState, awaitExpression)
						: awaitExpression,
					types.isStatement(parentNode) ? parentNode : types.returnStatement(parentNode),
					parent,
					additionalConstantNames,
					resultIdentifier,
					undefined,
					awaitPath.isYieldExpression() ? undefined : directExpression,
					state.skipReturns
				);
			}
		}
	}

	// Main visitor that rewrites await and for-await expressions, skipping entering into child functions
	const rewriteAsyncBlockVisitor: Visitor<RewriteAwaitState> & { ForAwaitStatement: any } = {
		Function: skipNode,
		AwaitExpression: rewriteAwaitOrYieldPath,
		YieldExpression: rewriteAwaitOrYieldPath,
		ForAwaitStatement: rewriteAwaitOrYieldPath, // Support babel versions with separate ForAwaitStatement type
		ForOfStatement(path) {
			if ((path.node as any).await) {
				// Support babel versions with .await property on ForOfStatement type
				rewriteAwaitOrYieldPath.call(this, path);
			}
		},
		CallExpression(path) {
			const callee = path.get("callee");
			if (callee.isIdentifier() && callee.node.name === "eval") {
				throw path.buildCodeFrameError(
					"Calling eval from inside an async function is not supported!",
					TypeError
				);
			}
		},
	};

	// Visitor that unpromisifies return statements, skipping functions
	const unpromisifyVisitor: Visitor<PluginState> = {
		Function: skipNode,
		ReturnStatement(path) {
			const argument = path.get("argument");
			if (argument.node) {
				unpromisify(argument as NodePath<Expression>, this);
			}
		},
	};

	// Unpromisifies a path
	function unpromisify(path: NodePath<Expression>, pluginState: PluginState) {
		if (
			path.isNumericLiteral() ||
			path.isBooleanLiteral() ||
			path.isStringLiteral() ||
			path.isNullLiteral() ||
			(path.isIdentifier() && path.node.name === "undefined") ||
			path.isArrayExpression() ||
			path.isObjectExpression() ||
			path.isBinaryExpression() ||
			path.isUnaryExpression() ||
			path.isUpdateExpression()
		) {
			return;
		}
		if (
			path.isCallExpression() &&
			(types.isIdentifier(path.node.callee) || types.isMemberExpression(path.node.callee)) &&
			helperNameMap.has(path.node.callee)
		) {
			switch (helperNameMap.get(path.node.callee)) {
				case "_await":
					const args = path.get("arguments");
					if (args.length > 0 && args[0].isExpression()) {
						unpromisify(args[0], pluginState);
					}
				// fallthrough
				case "_call": {
					const args = path.get("arguments");
					if (args.length > 2) {
						const secondArg = args[1];
						if (types.isExpression(secondArg.node) && isContinuation(secondArg.node)) {
							secondArg.traverse(unpromisifyVisitor, pluginState);
						} else if (secondArg.isIdentifier()) {
							const binding = secondArg.scope.getBinding(secondArg.node.name);
							if (binding && binding.path.isVariableDeclarator()) {
								binding.path.get("init").traverse(unpromisifyVisitor, pluginState);
							}
						}
					}
					break;
				}
				case "_promiseThen": {
					const args = path.get("arguments");
					if (args.length > 2) {
						const firstArg = args[1];
						if (types.isExpression(firstArg.node) && isContinuation(firstArg.node)) {
							firstArg.traverse(unpromisifyVisitor, pluginState);
						} else if (firstArg.isIdentifier()) {
							const binding = firstArg.scope.getBinding(firstArg.node.name);
							if (binding && binding.path.isVariableDeclarator()) {
								binding.path.get("init").traverse(unpromisifyVisitor, pluginState);
							}
						}
					}
					break;
				}
			}
			return;
		}
		if (path.isLogicalExpression()) {
			unpromisify(path.get("left"), pluginState);
			unpromisify(path.get("right"), pluginState);
			return;
		}
		if (path.isConditionalExpression()) {
			unpromisify(path.get("consequent"), pluginState);
			unpromisify(path.get("alternate"), pluginState);
			return;
		}
		if (path.isSequenceExpression()) {
			const expressions = path.get("expressions");
			if (expressions.length) {
				unpromisify(expressions[expressions.length - 1], pluginState);
			}
			return;
		}
		const minify = readConfigKey(pluginState.opts, "minify");
		path.replaceWith(logicalNot(logicalNot(path.node, minify), minify));
	}

	// Rewrites await and for-await expressions, skipping entering into child functions
	function rewriteAsyncBlock(
		generatorState: GeneratorState,
		path: NodePath,
		additionalConstantNames: string[],
		exitIdentifier?: Identifier,
		shouldUnpromisify?: boolean,
		skipReturns?: boolean
	) {
		path.traverse(rewriteAsyncBlockVisitor, {
			generatorState,
			path,
			additionalConstantNames,
			exitIdentifier,
			skipReturns,
		});
		if (shouldUnpromisify) {
			// Rewrite values that potentially could be promises to booleans so that they aren't awaited
			if (path.isArrowFunctionExpression()) {
				const body = path.get("body");
				if (body.isExpression()) {
					unpromisify(body, generatorState.state);
				}
			} else {
				path.traverse(unpromisifyVisitor, generatorState.state);
			}
		}
	}

	interface HubFile {
		declarations: { [key: string]: Identifier };
		path: NodePath<Program>;
		scope: Scope;
	}

	function getFile(path: NodePath): HubFile {
		let hub: any = path.hub;
		if ("file" in hub) {
			return hub.file as HubFile;
		}
		throw path.buildCodeFrameError("Expected the path's hub to contain a file!", TypeError);
	}

	// Visitor to extract dependencies from a helper function
	const getHelperDependenciesVisitor: Visitor<{ dependencies: string[] }> = {
		Identifier(path) {
			if (
				identifierSearchesScope(path) &&
				getFile(path).scope.getBinding(path.node.name) &&
				this.dependencies.indexOf(path.node.name) === -1
			) {
				this.dependencies.push(path.node.name);
			}
		},
	};

	// Extract dependencies from a helper function
	function getHelperDependencies(path: NodePath) {
		const state = { dependencies: [] };
		path.traverse(getHelperDependenciesVisitor, state);
		return state.dependencies;
	}

	// Visitor that checks if an identifier is used
	const usesIdentifierVisitor: Visitor<{ name: string; found: boolean }> = {
		Identifier(path) {
			if (path.node.name === this.name) {
				this.found = true;
				path.stop();
			}
		},
	};

	// Check if an identifier is used by a path
	function usesIdentifier(path: NodePath, name: string) {
		const state = { name, found: false };
		path.traverse(usesIdentifierVisitor, state);
		return state.found;
	}

	function insertHelper(programPath: NodePath<Program>, value: Node): NodePath {
		const body = programPath.get("body");
		const destinationPath =
			body.find((path: NodePath) => !isHelperDefinitionSet.has(path.node) && !path.isImportDeclaration()) ||
			body.find(() => true)!;
		if (destinationPath.isVariableDeclaration()) {
			const before = destinationPath
				.get("declarations")
				.filter((path: NodePath) => isHelperDefinitionSet.has(path.node));
			const after = destinationPath
				.get("declarations")
				.filter((path: NodePath) => !isHelperDefinitionSet.has(path.node));
			if (types.isVariableDeclaration(value)) {
				const declaration = value.declarations[0];
				isHelperDefinitionSet.add(declaration);
				if (before.length === 0) {
					const target = after[0];
					reregisterDeclarations(target.insertBefore(declaration));
					return getPreviousSibling(target)!;
				} else {
					const target = before[before.length - 1];
					reregisterDeclarations(target.insertAfter(declaration));
					return getNextSibling(target)!;
				}
			} else {
				isHelperDefinitionSet.add(value);
				if (before.length === 0) {
					isHelperDefinitionSet.add(destinationPath.node);
					reregisterDeclarations(destinationPath.insertBefore(value));
					return getPreviousSibling(destinationPath)!;
				} else if (after.length === 0) {
					isHelperDefinitionSet.add(destinationPath.node);
					reregisterDeclarations(destinationPath.insertAfter(value));
					return getNextSibling(destinationPath)!;
				} else {
					const beforeNode = types.variableDeclaration(
						destinationPath.node.kind,
						before.map((path: NodePath) => path.node as VariableDeclarator)
					);
					isHelperDefinitionSet.add(beforeNode);
					const afterNode = types.variableDeclaration(
						destinationPath.node.kind,
						after.map((path: NodePath) => path.node as VariableDeclarator)
					);
					destinationPath.replaceWith(afterNode);
					reregisterDeclarations(destinationPath);
					reregisterDeclarations(destinationPath.insertBefore(beforeNode));
					reregisterDeclarations(destinationPath.insertBefore(value));
					return getPreviousSibling(destinationPath)!;
				}
			}
		} else {
			if (types.isVariableDeclaration(value)) {
				isHelperDefinitionSet.add(value.declarations[0]);
			} else {
				isHelperDefinitionSet.add(value);
			}
			const oldNode = destinationPath.node;
			destinationPath.replaceWith(value);
			reregisterDeclarations(destinationPath);
			reregisterDeclarations(destinationPath.insertAfter(oldNode));
			return destinationPath;
		}
	}

	// Emits a reference to a helper, inlining or importing it as necessary
	function helperReference(state: PluginState, path: NodePath, name: HelperName): Identifier {
		const file = getFile(path);
		let result = file.declarations[name];
		if (result) {
			result = cloneNode(result);
		} else {
			result = file.declarations[name] = usesIdentifier(file.path, name)
				? file.path.scope.generateUidIdentifier(name)
				: types.identifier(name);
			helperNameMap.set(result, name);
			if (readConfigKey(state.opts, "externalHelpers")) {
				/* istanbul ignore next */
				file.path.unshiftContainer(
					"body",
					types.importDeclaration(
						[types.importSpecifier(result, types.identifier(name))],
						types.stringLiteral("babel-plugin-transform-async-to-promises/helpers")
					)
				);
			} else {
				if (!helpers) {
					// Read helpers from ./helpers.js
					const newHelpers: { [name: string]: Helper } = {};
					const plugins = [
						{
							visitor: {
								ExportNamedDeclaration(path) {
									const declaration = path.get("declaration");
									if (declaration.isFunctionDeclaration()) {
										const id = declaration.node.id;
										if (!types.isIdentifier(id)) {
											throw declaration.buildCodeFrameError(
												`Expected a named declaration!`,
												TypeError
											);
										}
										newHelpers[id.name] = {
											value: declaration.node,
											dependencies: getHelperDependencies(declaration),
										};
										return;
									}
									if (
										declaration.isVariableDeclaration() &&
										declaration.node.declarations.length === 1
									) {
										const declaratorId = declaration.node.declarations[0].id;
										if (types.isIdentifier(declaratorId)) {
											newHelpers[declaratorId.name] = {
												value: declaration.node,
												dependencies: getHelperDependencies(declaration),
											};
											return;
										}
									}
									/* istanbul ignore next */
									throw path.buildCodeFrameError(
										"Expected a named export from built-in helper!",
										TypeError
									);
								},
							} as Visitor,
						},
					];
					const helperAst = require(isNewBabel ? "@babel/core" : "babylon").parse(helperCode, {
						sourceType: "module",
						filename: "helpers.js",
					});
					if (isNewBabel) {
						transformFromAst(helperAst, helperCode, {
							babelrc: false,
							configFile: false,
							plugins,
						});
					} else {
						transformFromAst(helperAst, helperCode, {
							babelrc: false,
							plugins,
						});
					}
					helpers = newHelpers;
				}
				const helper = helpers[name];
				// Insert helper dependencies first
				for (const dependency of helper.dependencies) {
					helperReference(state, path, dependency);
				}
				const usedHelpers = state.usedHelpers || (state.usedHelpers = {} as UsedHelpers);
				usedHelpers[name] = true;
			}
		}
		return result;
	}

	// Emits a reference to an empty function, inlining or importing it as necessary
	function emptyFunction(
		state: PluginState,
		path: NodePath
	): Identifier | FunctionExpression | ArrowFunctionExpression {
		return readConfigKey(state.opts, "inlineHelpers")
			? functionize(state, [], blockStatement([]), path)
			: helperReference(state, path, "_empty");
	}

	// Emits a reference to Promise.resolve and tags it as an _await reference
	function promiseResolve() {
		const result = types.memberExpression(types.identifier("Promise"), types.identifier("resolve"));
		helperNameMap.set(result, "_promiseResolve");
		return result;
	}

	// Emits a call to a target's then method
	function callThenMethod(value: Expression, continuation: Expression) {
		const thenExpression = types.memberExpression(value, types.identifier("then"));
		helperNameMap.set(thenExpression, "_promiseThen");
		return types.callExpression(thenExpression, [continuation]);
	}

	// Checks if an expression is an async call expression
	function isAsyncCallExpression(path: NodePath<CallExpression>): boolean {
		if (types.isIdentifier(path.node.callee) || types.isMemberExpression(path.node.callee)) {
			switch (helperNameMap.get(path.node.callee)) {
				case "_await":
				case "_call":
				case "_promiseResolve":
				case "_promiseThen":
					return path.node.arguments.length < 3;
			}
		}
		return false;
	}

	// Extracts the invoke type of a call expression
	function invokeTypeOfExpression(
		path: NodePath<Node | null>
	): "_invoke" | "_invokeIgnored" | "_catch" | "_catchInGenerator" | "_finally" | "_finallyRethrows" | void {
		if (path.isCallExpression() && types.isIdentifier(path.node.callee)) {
			const helperName = helperNameMap.get(path.node.callee);
			switch (helperName) {
				case "_invoke":
				case "_invokeIgnored":
				case "_catch":
				case "_catchInGenerator":
				case "_finally":
				case "_finallyRethrows":
					return helperName;
			}
		}
	}

	// Checks to see if an expression is an async function
	function isAsyncFunctionExpression(path: NodePath): boolean {
		if (path.isFunction() && (path.node.async || nodeIsAsyncSet.has(path.node))) {
			return true;
		}
		if (
			path.isCallExpression() &&
			types.isIdentifier(path.node.callee) &&
			helperNameMap.get(path.node.callee) === "_async"
		) {
			return true;
		}
		return false;
	}

	// Looks up if a bound function is an async function
	function isAsyncFunctionIdentifier(path: NodePath): path is NodePath<Identifier> {
		if (path.isIdentifier()) {
			const binding = path.scope.getBinding(path.node.name);
			if (binding && binding.constant) {
				const bindingPath = binding.path;
				if (bindingPath.isVariableDeclarator()) {
					const initPath = bindingPath.get("init");
					if (initPath.node && isAsyncFunctionExpression(initPath as NodePath<Expression>)) {
						return true;
					}
				} else if (bindingPath.isFunctionDeclaration()) {
					if (isAsyncFunctionExpression(bindingPath)) {
						return true;
					}
				}
			}
		}
		return false;
	}

	// Check if an argument is arguments or eval
	function isEvalOrArguments(path: NodePath): path is NodePath<Identifier> {
		return path.isIdentifier() && (path.node.name === "arguments" || path.node.name === "eval");
	}

	// Check if an indentifier at a path searches its scope
	function identifierSearchesScope(path: NodePath<Identifier>): boolean {
		if (path.node.name === "undefined") {
			return false;
		}
		if (helperNameMap.has(path.node)) {
			return false;
		}
		const parent = path.parentPath;
		if (parent.isVariableDeclarator() && parent.get("id") === path) {
			return false;
		}
		if (parent.isMemberExpression() && !parent.node.computed && parent.get("property") === path) {
			return false;
		}
		if (parent.isLabeledStatement() && parent.get("label") === path) {
			return false;
		}
		if (parent.isFunction() && parent.get("params").indexOf(path) !== -1) {
			return false;
		}
		return true;
	}

	// Visitor helper that sets the canThrow state
	function canThrow(this: { canThrow: boolean }): void {
		this.canThrow = true;
	}

	// Parse the promise call type of a call expression
	function promiseCallExpressionType(
		expression: CallExpression
	): "all" | "race" | "reject" | "resolve" | "then" | "catch" | "finally" | undefined {
		if (types.isMemberExpression(expression.callee)) {
			if (
				types.isIdentifier(expression.callee.object) &&
				expression.callee.object.name === "Promise" &&
				types.isIdentifier(expression.callee.property)
			) {
				switch (expression.callee.property.name) {
					case "all":
					case "race":
					case "reject":
					case "resolve":
						return expression.callee.property.name;
				}
			} else if (
				types.isCallExpression(expression.callee.object) &&
				types.isIdentifier(expression.callee.property)
			) {
				switch (expression.callee.property.name) {
					case "then":
					case "catch":
					case "finally":
						if (typeof promiseCallExpressionType(expression.callee.object) !== "undefined") {
							return expression.callee.property.name;
						}
						break;
				}
			}
		}
		return undefined;
	}

	// Visitor to simplify the top level of an async function and check if it needs to be wrapped in a try/catch
	const checkForErrorsAndRewriteReturnsVisitor: Visitor<{
		rewriteReturns: boolean;
		plugin: PluginState;
		canThrow: boolean;
	}> = {
		Function: skipNode,
		ThrowStatement: canThrow,
		ForInStatement: canThrow,
		ForOfStatement: canThrow,
		WithStatement: canThrow,
		NewExpression: canThrow,
		TryStatement(path) {
			if (path.get("handler")) {
				path.get("block").skip();
			}
		},
		CallExpression(path) {
			if (!isAsyncCallExpression(path)) {
				const args = path.get("arguments");
				switch (invokeTypeOfExpression(path)) {
					default:
						if (checkForErrorsAndRewriteReturns(args[0], this.plugin)) {
							this.canThrow = true;
						}
					// fallthrough
					case "_catch":
					case "_catchInGenerator":
					case "_finally":
					case "_finallyRethrows":
						if (args[1]) {
							if (checkForErrorsAndRewriteReturns(args[1], this.plugin)) {
								this.canThrow = true;
							}
						}
						break;
					case undefined: {
						const callee = path.get("callee");
						if (!isAsyncFunctionIdentifier(callee)) {
							this.canThrow = true;
						}
					}
				}
			}
		},
		UpdateExpression(path) {
			if (isEvalOrArguments(path.get("argument"))) {
				this.canThrow = true;
			}
		},
		UnaryExpression(path) {
			switch (path.node.operator) {
				case "delete":
					// Not strictly true that all delete expressions can potentially throw, but better to be cautious
					this.canThrow = true;
					break;
			}
		},
		BinaryExpression(path) {
			switch (path.node.operator) {
				case "instanceof":
				case "in":
					this.canThrow = true;
					break;
			}
		},
		Identifier(path) {
			if (
				identifierSearchesScope(path) &&
				!path.scope.getBinding(path.node.name) &&
				alwaysTruthy.indexOf(path.node.name) === -1
			) {
				this.canThrow = true;
			}
		},
		MemberExpression(path) {
			if (
				helperNameMap.get(path.node) !== "_await" &&
				!(
					path.parentPath.isCallExpression() &&
					promiseCallExpressionType(path.parentPath.node) !== undefined &&
					path.parentPath.get("callee") === path
				)
			) {
				const propertyName = propertyNameOfMemberExpression(path.node);
				if (propertyName !== undefined) {
					const object = path.get("object");
					if (
						object.isIdentifier() &&
						Object.hasOwnProperty.call(constantStaticMethods, object.node.name) &&
						Object.hasOwnProperty.call(constantStaticMethods[object.node.name], propertyName)
					) {
						return;
					}
				}
				this.canThrow = true;
			}
		},
		AssignmentExpression(path) {
			if (isEvalOrArguments(path.get("left"))) {
				this.canThrow = true;
			}
		},
		ReturnStatement(path) {
			if (this.rewriteReturns) {
				const argument = path.get("argument");
				if (argument && argument.node) {
					let arg = argument.node;
					if (
						!(
							(argument.isCallExpression() &&
								(isAsyncCallExpression(argument) ||
									typeof promiseCallExpressionType(argument.node) !== "undefined")) ||
							(argument.isCallExpression() && isAsyncFunctionIdentifier(argument.get("callee")))
						)
					) {
						const target = readConfigKey(this.plugin.opts, "inlineHelpers")
							? promiseResolve()
							: helperReference(this.plugin, path, "_await");
						if (types.isConditionalExpression(arg) && types.isIdentifier(arg.test)) {
							if (
								types.isCallExpression(arg.consequent) &&
								promiseCallExpressionType(arg.consequent) === "resolve" &&
								arg.consequent.arguments.length === 1 &&
								nodesAreEquivalent(arg.consequent.arguments[0])(arg.alternate)
							) {
								// Simplify Promise.resolve(foo ? bar() : Promise.resolve(bar())) to Promise.resolve(bar())
								arg = arg.alternate;
							} else if (
								types.isCallExpression(arg.alternate) &&
								promiseCallExpressionType(arg.alternate) === "resolve" &&
								arg.alternate.arguments.length === 1 &&
								nodesAreEquivalent(arg.alternate.arguments[0])(arg.consequent)
							) {
								// Simplify Promise.resolve(foo ? Promise.resolve(bar()) : bar()) to Promise.resolve(bar())
								arg = arg.consequent;
							}
						}
						if (
							types.isConditionalExpression(arg) &&
							types.isCallExpression(arg.consequent) &&
							promiseCallExpressionType(arg.consequent) === "resolve"
						) {
							// Simplify Promise.resolve(foo ? bar : Promise.resolve(baz)) to Promise.resolve(foo ? bar : baz)
							const consequent = arg.consequent.arguments[0];
							if (consequent && types.isExpression(consequent)) {
								arg = conditionalExpression(arg.test, consequent, arg.alternate);
							}
						}
						if (
							types.isConditionalExpression(arg) &&
							types.isCallExpression(arg.alternate) &&
							promiseCallExpressionType(arg.alternate) === "resolve"
						) {
							// Simplify Promise.resolve(foo ? Promise.resolve(bar) : baz) to Promise.resolve(foo ? bar : baz)
							const alternate = arg.alternate.arguments[0];
							if (alternate && types.isExpression(alternate)) {
								arg = conditionalExpression(arg.test, arg.consequent, alternate);
							}
						}
						if (types.isConditionalExpression(arg) && types.isIdentifier(arg.test)) {
							if (types.isIdentifier(arg.consequent) && arg.test.name === arg.consequent.name) {
								if (types.isIdentifier(arg.alternate) && arg.test.name === arg.alternate.name) {
									// Simplify Promise.resolve(foo ? foo : foo) to Promise.resolve(foo)
									arg = arg.test;
								} else {
									// Simplify Promise.resolve(foo ? bar : foo) to Promse.resolve(foo || bar)
									arg = types.logicalExpression("||", arg.consequent, arg.alternate);
								}
							} else if (types.isIdentifier(arg.alternate) && arg.test.name === arg.alternate.name) {
								// Simplify Promise.resolve(foo ? foo : bar) to Promse.resolve(foo && bar)
								arg = types.logicalExpression("&&", arg.alternate, arg.consequent);
							}
						}
						argument.replaceWith(types.callExpression(target, [arg]));
					}
				} else {
					const target = readConfigKey(this.plugin.opts, "inlineHelpers")
						? promiseResolve()
						: helperReference(this.plugin, path, "_await");
					argument.replaceWith(types.callExpression(target, []));
				}
			}
		},
	};

	// Simplify the top level of an async function and check if it needs to be wrapped in a try/catch
	function checkForErrorsAndRewriteReturns(
		path: NodePath,
		plugin: PluginState,
		rewriteReturns: boolean = false
	): boolean {
		const state = { rewriteReturns, plugin, canThrow: false };
		path.traverse(checkForErrorsAndRewriteReturnsVisitor, state);
		return state.canThrow;
	}

	// Visitor to rewrite the top level return expressions of an async function
	const rewriteTopLevelReturnsVisitor: Visitor = {
		Function: skipNode,
		ReturnStatement(path) {
			const argument = path.get("argument");
			if (argument.isCallExpression()) {
				const callArgs = argument.node.arguments;
				switch (callArgs.length) {
					case 3:
					case 2: {
						const secondArgument = callArgs[1];
						if (!types.isUnaryExpression(secondArgument) || secondArgument.operator !== "void") {
							break;
						}
						// fallthrough
					}
					case 1:
						if (
							types.isIdentifier(argument.node.callee) ||
							types.isMemberExpression(argument.node.callee)
						) {
							const firstArgument = callArgs[0];
							if (types.isExpression(firstArgument)) {
								switch (helperNameMap.get(argument.node.callee)) {
									case "_promiseResolve":
									case "_await":
										argument.replaceWith(firstArgument);
										break;
									case "_call":
										argument.replaceWith(types.callExpression(firstArgument, []));
										break;
								}
							}
						}
						break;
				}
			}
		},
	};

	// Shuffles a path to evaluate before its non-function declaration siblings
	function reorderPathBeforeSiblingStatements(targetPath: NodePath) {
		for (const sibling of targetPath.getAllPrevSiblings().reverse()) {
			if (!sibling.isFunctionDeclaration() && !sibling.isImportDeclaration()) {
				const newNode = targetPath.node;
				targetPath.remove();
				reregisterDeclarations(sibling.insertBefore(newNode));
				return;
			}
		}
	}

	// Register all declarations
	function reregisterDeclarations(pathOrPaths: any) {
		if (Array.isArray(pathOrPaths)) {
			for (const path of pathOrPaths) {
				reregisterDeclarations(path);
			}
		} else if (pathOrPaths && pathOrPaths.isLabeledStatement) {
			const scope = pathOrPaths.isFunction() ? pathOrPaths.parentPath.scope : pathOrPaths.scope;
			if (
				pathOrPaths.isVariableDeclaration() ||
				pathOrPaths.isFunctionDeclaration() ||
				pathOrPaths.isClassDeclaration()
			) {
				scope.registerDeclaration(pathOrPaths);
			}
			pathOrPaths.traverse(reregisterVariableVisitor, { originalScope: pathOrPaths.scope });
		}
	}

	// Get previous sibling
	function getPreviousSibling(targetPath: NodePath): NodePath | undefined {
		const siblings = targetPath.getAllPrevSiblings();
		return siblings.length !== 0 ? siblings[siblings.length - 1] : undefined;
	}

	// Get next sibling
	function getNextSibling(targetPath: NodePath): NodePath | undefined {
		const siblings = targetPath.getAllNextSiblings();
		return siblings.length !== 0 ? siblings[0] : undefined;
	}

	// Rewrite function arguments with default values to be check statements inserted into the body
	function rewriteDefaultArguments(targetPath: NodePath<FunctionExpression | ClassMethod>) {
		const statements: Statement[] = [];
		const params = targetPath.get("params");
		const literals: string[] = [];
		for (let i = 0; i < params.length; i++) {
			const param = params[i];
			if (param.isAssignmentPattern()) {
				const init = param.get("right");
				if (!isExpressionOfLiterals(init, literals)) {
					const left = param.get("left") as NodePath<Identifier | ObjectPattern>;
					let id: Identifier;
					let after: Statement | undefined;
					if (left.isIdentifier()) {
						id = left.node;
					} else {
						id = left.scope.generateUidIdentifier(`arg${i}`);
						after = types.variableDeclaration("let", [types.variableDeclarator(left.node, id)]);
					}
					const initNode = init.node;
					param.replaceWith(id);
					const isMissing = types.binaryExpression("===", id, types.identifier("undefined"));
					const assignment = types.expressionStatement(types.assignmentExpression("=", id, initNode));
					statements.push(types.ifStatement(isMissing, assignment));
					if (after) {
						statements.push(after);
					}
				}
			} else if (param.isIdentifier()) {
				literals.push(param.node.name);
			}
		}
		if (statements.length) {
			targetPath.node.body.body = statements.concat(targetPath.node.body.body);
		}
	}

	const unwrapReturnPromiseVisitor: Visitor = {
		ReturnStatement(path) {
			const argument = path.get("argument");
			if (argument.isCallExpression()) {
				switch (promiseCallExpressionType(argument.node)) {
					case "all":
					case "race":
					case "resolve":
						switch (argument.node.arguments.length) {
							case 0:
								path.replaceWith(types.returnStatement());
								break;
							case 1:
								const arg0 = argument.node.arguments[0];
								if (types.isExpression(arg0)) {
									path.replaceWith(types.returnStatement(arg0));
								}
								break;
						}
						break;
				}
			}
		},
	};

	const findAwaitExpressionVisitor: Visitor<FindAwaitExpressionState> = {
		AwaitExpression(path) {
			this.awaitPath = path;
			path.stop();
		},
	};

	// Main babel plugin implementation and top level visitor
	return {
		manipulateOptions(_options: any, parserOptions: { plugins: string[] }) {
			parserOptions.plugins.push("asyncGenerators");
		},
		visitor: {
			AwaitExpression(path) {
				if (!path.getFunctionParent() && !this.hasTopLevelAwait) {
					this.hasTopLevelAwait = true;
				}
			},
			ImportDeclaration: {
				exit(path) {
					if (this.hasTopLevelAwait && readConfigKey(this.opts, "topLevelAwait") === "simple") {
						throw path.buildCodeFrameError(`Cannot import after a top-level await when using topLevelAwait: "simple"!`, TypeError);
					}
				},
			},
			ExportDeclaration: {
				exit(path) {
					if (this.hasTopLevelAwait && readConfigKey(this.opts, "topLevelAwait") === "simple") {
						throw path.buildCodeFrameError(`Cannot export after a top-level await when using topLevelAwait: "simple"!`, TypeError);
					}
				},
			},
			Program: {
				exit(path) {
					if (this.hasTopLevelAwait) {
						// rediscover the top level await path since it may have been reorganized by a module plugin
						let rediscoverState = {} as FindAwaitExpressionState;
						path.traverse(findAwaitExpressionVisitor, rediscoverState);
						if (rediscoverState.awaitPath !== undefined) {
							const functionParent = rediscoverState.awaitPath.getFunctionParent();
							const topLevelAwaitParent = functionParent ? functionParent.get("body") : path;
							switch (readConfigKey(this.opts, "topLevelAwait")) {
								case "simple": {
									rewriteAsyncBlock({ state: this }, topLevelAwaitParent, [], undefined, false, true);
									break;
								}
								case "return": {
									rewriteAsyncBlock(
										{ state: this },
										topLevelAwaitParent,
										[],
										undefined,
										false,
										false
									);
									break;
								}
								case "ignore":
									break;
								default:
									throw rediscoverState.awaitPath.buildCodeFrameError(
										`Top level await is not supported unless experimental topLevelAwait: "simple" or topLevelAwait: "return" options are specified!`,
										TypeError
									);
							}
						}
					}
					const usedHelpers = this.usedHelpers;
					if (usedHelpers !== undefined) {
						const file = getFile(path);
						for (const helperName of Object.keys(usedHelpers)) {
							const helper = helpers![helperName];
							const value = cloneNode(helper.value) as typeof helper.value;
							const newPath = insertHelper(file.path, value);
							newPath.traverse({
								Identifier(identifierPath) {
									const name = identifierPath.node.name;
									if (Object.hasOwnProperty.call(helpers, name)) {
										identifierPath.replaceWith(file.declarations[name]);
									}
								},
							} as Visitor);
						}
					}
				},
			},
			FunctionDeclaration(path) {
				const node = path.node;
				if (node.async) {
					const expression = types.functionExpression(
						undefined,
						node.params,
						node.body,
						node.generator,
						node.async
					);
					if (node.id === null || node.id === undefined) {
						path.replaceWith(expression);
						reregisterDeclarations(path);
						return;
					}
					const declarators = [types.variableDeclarator(node.id, expression)];
					if (path.parentPath.isExportDeclaration()) {
						if (path.parentPath.isExportDefaultDeclaration()) {
							// export default function... is a function declaration in babel 7
							const targetPath = path.parentPath;
							targetPath.replaceWith(types.variableDeclaration("const", declarators));
							reregisterDeclarations(targetPath);
							reregisterDeclarations(targetPath.insertAfter(types.exportDefaultDeclaration(node.id)));
							reorderPathBeforeSiblingStatements(targetPath);
						} else {
							path.replaceWith(types.variableDeclaration("const", declarators));
							reregisterDeclarations(path);
							reorderPathBeforeSiblingStatements(path.parentPath);
						}
					} else {
						path.replaceWith(types.variableDeclaration("const", declarators));
						reregisterDeclarations(path);
						reorderPathBeforeSiblingStatements(path);
					}
				}
			},
			ArrowFunctionExpression(path) {
				const node = path.node;
				if (node.async) {
					rewriteThisExpressions(path, path.getFunctionParent() || path.scope.getProgramParent().path);
					const body = types.isBlockStatement(path.node.body)
						? path.node.body
						: blockStatement([types.returnStatement(path.node.body)]);
					path.replaceWith(types.functionExpression(undefined, node.params, body, false, node.async));
					reregisterDeclarations(path);
				}
			},
			FunctionExpression(path) {
				if (path.node.async) {
					const id = path.node.id;
					if (path.parentPath.isExportDefaultDeclaration() && id !== null && id !== undefined) {
						// export default function... is a function expression in babel 6
						const targetPath = path.parentPath;
						targetPath.replaceWith(
							types.variableDeclaration("const", [
								types.variableDeclarator(
									id,
									types.functionExpression(
										undefined,
										path.node.params,
										path.node.body,
										path.node.generator,
										path.node.async
									)
								),
							])
						);
						reregisterDeclarations(targetPath);
						reregisterDeclarations(targetPath.insertAfter(types.exportDefaultDeclaration(id)));
						reorderPathBeforeSiblingStatements(targetPath);
						return;
					}
					rewriteDefaultArguments(path);
					rewriteThisArgumentsAndHoistFunctions(path, path, false);
					const bodyPath = path.get("body");
					if (path.node.generator) {
						const generatorIdentifier = path.scope.generateUidIdentifier("generator");
						path.scope.push({ kind: "const", id: generatorIdentifier, unique: true });
						const generatorBinding = path.scope.getBinding(generatorIdentifier.name);
						if (typeof generatorBinding === "undefined") {
							/* istanbul ignore next */
							throw path.buildCodeFrameError(
								`Could not find newly created binding for ${generatorIdentifier.name}!`,
								Error
							);
						}
						rewriteAsyncBlock({ state: this, generatorIdentifier }, bodyPath, []);
						generatorBinding.path.remove();
						path.replaceWith(
							functionize(
								this,
								path.node.params,
								types.newExpression(helperReference(this, path, "_AsyncGenerator"), [
									functionize(this, [generatorIdentifier], bodyPath.node, path),
								]),
								path,
								id
							)
						);
					} else {
						rewriteAsyncBlock({ state: this }, path, []);
						const inlineHelpers = readConfigKey(this.opts, "inlineHelpers");
						const canThrow = checkForErrorsAndRewriteReturns(
							bodyPath,
							this,
							inlineHelpers || (id !== null && id !== undefined)
						);
						const parentPath = path.parentPath;
						const skipReturn =
							parentPath.isCallExpression() &&
							parentPath.node.callee === path.node &&
							parentPath.parentPath.isExpressionStatement();
						if (!skipReturn && !pathsReturnOrThrowCurrentNodes(bodyPath).all) {
							const awaitHelper = inlineHelpers
								? promiseResolve()
								: helperReference(this, path, "_await");
							path.node.body.body.push(types.returnStatement(types.callExpression(awaitHelper, [])));
						}
						if (skipReturn) {
							path.traverse(unwrapReturnPromiseVisitor);
						}
						if (canThrow) {
							if (inlineHelpers || id) {
								if (
									!id &&
									skipReturn &&
									parentPath.isCallExpression() &&
									parentPath.node.arguments.length === 0 &&
									!pathsReturn(bodyPath).any
								) {
									parentPath.parentPath.replaceWith(
										types.tryStatement(
											bodyPath.node,
											types.catchClause(
												types.identifier("e"),
												blockStatement([
													types.expressionStatement(
														types.callExpression(
															types.memberExpression(
																types.identifier("Promise"),
																types.identifier("reject")
															),
															[types.identifier("e")]
														)
													),
												])
											)
										)
									);
								} else {
									path.replaceWith(
										functionize(
											this,
											path.node.params,
											blockStatement(
												types.tryStatement(
													bodyPath.node,
													types.catchClause(
														types.identifier("e"),
														blockStatement([
															(skipReturn
																? types.expressionStatement
																: types.returnStatement)(
																types.callExpression(
																	types.memberExpression(
																		types.identifier("Promise"),
																		types.identifier("reject")
																	),
																	[types.identifier("e")]
																)
															),
														])
													)
												)
											),
											path,
											id
										)
									);
								}
							} else {
								bodyPath.traverse(rewriteTopLevelReturnsVisitor);
								path.replaceWith(
									types.callExpression(helperReference(this, path, "_async"), [
										functionize(this, path.node.params, bodyPath.node, path),
									])
								);
							}
						} else {
							if (!inlineHelpers) {
								checkForErrorsAndRewriteReturns(bodyPath, this, true);
							}
							path.replaceWith(functionize(this, path.node.params, bodyPath.node, path, id));
						}
					}
					nodeIsAsyncSet.add(path.node);
				}
			},
			ClassMethod(path) {
				if (path.node.async) {
					const body = path.get("body");
					if (path.node.kind === "method") {
						rewriteDefaultArguments(path);
						body.replaceWith(types.blockStatement([body.node]));
						const target = body.get("body")[0];
						if (!target.isBlockStatement()) {
							/* istanbul ignore next */
							throw path.buildCodeFrameError(
								`Expected a BlockStatement, got a ${target.type}`,
								TypeError
							);
						}
						if (path.node.generator) {
							const generatorIdentifier = target.scope.generateUidIdentifier("generator");
							target.scope.push({
								kind: "const",
								id: generatorIdentifier,
								init: generatorIdentifier,
								unique: true,
							});
							const generatorBinding = target.scope.getBinding(generatorIdentifier.name);
							if (typeof generatorBinding === "undefined") {
								/* istanbul ignore next */
								throw path.buildCodeFrameError(
									`Could not find newly created binding for ${generatorIdentifier.name}!`,
									Error
								);
							}
							rewriteAsyncBlock({ state: this, generatorIdentifier }, target, []);
							generatorBinding.path.remove();
							target.replaceWith(
								types.returnStatement(
									types.newExpression(helperReference(this, path, "_AsyncGenerator"), [
										functionize(this, [generatorIdentifier], target.node, target),
									])
								)
							);
						} else {
							const inlineHelpers = readConfigKey(this.opts, "inlineHelpers");
							rewriteThisArgumentsAndHoistFunctions(target, inlineHelpers ? target : body, true);
							rewriteAsyncBlock({ state: this }, target, []);
							const statements = target.get("body");
							const lastStatement = statements[statements.length - 1];
							if (!lastStatement || !lastStatement.isReturnStatement()) {
								const awaitHelper = inlineHelpers
									? promiseResolve()
									: helperReference(this, path, "_await");
								target.node.body.push(types.returnStatement(types.callExpression(awaitHelper, [])));
							}
							const canThrow = checkForErrorsAndRewriteReturns(body, this, true);
							if (!canThrow) {
								target.replaceWithMultiple(target.node.body);
							} else if (inlineHelpers) {
								target.replaceWith(
									types.tryStatement(
										target.node,
										types.catchClause(
											types.identifier("e"),
											blockStatement([
												types.returnStatement(
													types.callExpression(
														types.memberExpression(
															types.identifier("Promise"),
															types.identifier("reject")
														),
														[types.identifier("e")]
													)
												),
											])
										)
									)
								);
							} else {
								target.replaceWith(
									types.returnStatement(
										types.callExpression(helperReference(this, path, "_call"), [
											functionize(this, [], target.node, path),
										])
									)
								);
							}
						}
					}
					path.replaceWith(
						types.classMethod(
							path.node.kind,
							path.node.key,
							path.node.params,
							path.node.body,
							path.node.computed,
							path.node.static
						)
					);
				}
			},
			ObjectMethod(path) {
				if (path.node.async) {
					if (path.node.kind === "method") {
						path.replaceWith(
							types.objectProperty(
								path.node.key,
								types.functionExpression(
									undefined,
									path.node.params,
									path.node.body,
									path.node.generator,
									path.node.async
								),
								path.node.computed,
								false,
								path.node.decorators
							)
						);
					}
				}
			},
		},
	};
}

module.exports = exports.default;
