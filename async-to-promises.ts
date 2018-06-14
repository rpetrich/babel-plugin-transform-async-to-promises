import { AwaitExpression, BlockStatement, CallExpression, LabeledStatement, Node, Expression, Statement, Identifier, ForStatement, ForInStatement, SpreadElement, ReturnStatement, ForOfStatement, Function, FunctionExpression, MemberExpression, NumericLiteral, ThisExpression, SwitchCase, Program, VariableDeclarator, StringLiteral, BooleanLiteral, Pattern } from "babel-types";
import { NodePath, Scope, Visitor } from "babel-traverse";
import { readFileSync } from "fs";
import { join } from "path";

interface PluginState {
	opts: {
		externalHelpers?: boolean;
		hoist?: boolean;
		inlineAsync?: boolean;
	};
}

declare module "babel-types" {
	interface Node {
		_originalNode?: Node;
		_skip?: true;
		_breakIdentifier?: Identifier;
	}
	interface Identifier {
		_helperName?: string;
	}
	interface ArrowFunctionExpression {
		_async?: true;
	}
	interface FunctionExpression {
		_async?: true;
	}
	interface FunctionDeclaration {
		_async?: true;
	}
	interface ClassMethod {
		_async?: true;
	}
	interface ObjectMethod {
		_async?: true;
	}
}

declare module "babel-traverse" {
	interface TraversalContext {
		create<T extends Node>(node: Node, obj: T[], key: string | number, listKey: string): NodePath<T>;
	}
	interface NodePath {
		isForAwaitStatement?(): this is NodePath<ForOfStatement>;
	}
}

interface HoistCallArgumentsInnerState {
	argumentNames: string[];
	additionalConstantNames: string[];
	path: NodePath;
	pathScopes: Scope[];
	scopes: Scope[];
};

interface HoistCallArgumentsState {
	state: PluginState,
	additionalConstantNames: string[]
}

interface TraversalTestResult {
	any: boolean;
	all: boolean;
}

interface BreakContinueItem {
	identifier: Identifier;
	name?: string;
	path: NodePath<Statement>;
}

interface ForToIdentifier {
	i: Identifier;
	array: Identifier;
}

const errorOnIncompatible = true;

interface Helper {
	value: Node;
	dependencies: string[];
};
let helpers: { [name: string]: Helper } | undefined;

const alwaysTruthy = ["Object", "Function", "Boolean", "Error", "String", "Number", "Math", "Date", "RegExp", "Array"];
const numberNames = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

export default function({ types, template, traverse, transformFromAst, version }: {
	types: typeof import("babel-types"),
	template: typeof import("babel-template"),
	traverse: typeof import("babel-traverse").default,
	transformFromAst: (ast: Program, code?: string, options?: any) => { code: string, map: any, ast: Program };
	version: string,
}) {

	const isNewBabel = !/^6\./.test(version);

	function wrapNodeInStatement(node: Node): Statement {
		if (types.isStatement(node)) {
			return types.blockStatement([node]);
		}
		if (types.isExpression(node)) {
			return types.expressionStatement(node);
		}
		throw new Error(`Expected either an expression or a statement, got a ${node.type}!`);
	}

	function pathForNewNode<T extends Node>(node: T, parentPath: NodePath): NodePath<T> {
		const result = parentPath.context.create(parentPath.node, [node], 0, "dummy");
		result.setContext(parentPath.context);
		return result;
	}

	function pathsPassTest(matchingNodeTest: (path: NodePath<Node | null>) => boolean, referenceOriginalNodes?: boolean): (path: NodePath<Node | null>) => TraversalTestResult {
		function visit(path: NodePath, result: TraversalTestResult, state: { breakingLabels: string[], unnamedBreak: boolean }) {
			if (referenceOriginalNodes) {
				const originalNode = path.node._originalNode;
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
				return (result.all = (test.all || (consequent.all && alternate.all)) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isSwitchStatement()) {
				const discriminant = match(path.get("discriminant"), state);
				const cases = path.get("cases");
				const caseMatches = cases.map((switchCase, i) => {
					const newState = { unnamedBreak: false, breakingLabels: state.breakingLabels };
					const newResult = match(switchCase, newState);
					for (i++; (!newResult.all || pathsBreakReturnOrThrow(switchCase).all) && i < cases.length; i++) {
						const tailMatch = match(cases[i], newState);
						newResult.all = (newResult.all || tailMatch.all) && !(state.breakingLabels.length || state.unnamedBreak);
						newResult.any = newResult.any || tailMatch.any;
						// newResult.paths = newResult.paths.concat(tailMatch.paths);
					}
					return newResult;
				});
				result.any = result.any || discriminant.any || caseMatches.some(caseMatch => caseMatch.any);
				// result.paths = caseMatches.reduce((acc, match) => acc.concat(match.paths), result.paths.concat(discriminant.paths));
				return result.all = ((discriminant.all || (cases.some(switchCase => !switchCase.node.test) && caseMatches.every(caseMatch => caseMatch.all))) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isDoWhileStatement()) {
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				const test = match(path.get("test"), state);
				result.any = result.any || body.any || test.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return result.all = ((body.all || test.all) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isWhileStatement()) {
				// TODO: Support detecting break/return statements
				const testPath = path.get("test");
				const test = match(testPath, state);
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				result.any = result.any || test.any || body.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return result.all = ((test.all || (body.all && (extractLooseBooleanValue(testPath.node) === true))) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isForXStatement()) {
				const right = match(path.get("right"), state);
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				result.any = result.any || right.any || body.any;
				// result.paths = result.paths.concat(right.paths).concat(body.paths);
				return result.all = (right.all && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isForStatement()) {
				const init = match(path.get("init"), state);
				const test = match(path.get("test"), state);
				const body = match(path.get("body"), { unnamedBreak: false, breakingLabels: state.breakingLabels });
				const update = match(path.get("update"), state);
				result.any = result.any || init.any || test.any || body.any || update.any;
				// result.paths = result.paths.concat(init.paths).concat(test.paths).concat(update.paths).concat(body.paths);
				return result.all = ((init.all || test.all) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isLogicalExpression()) {
				const left = match(path.get("left"), state);
				const right = match(path.get("right"), state);
				result.any = result.any || left.any || right.any;
				// result.paths = result.paths.concat(left.paths).concat(right.paths);
				return result.all = (left.all && !(state.breakingLabels.length || state.unnamedBreak));
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
					return result.all = !(state.breakingLabels.length || state.unnamedBreak);
				} else if (!finalizer.node) {
					return result.all = (handlerMatch.all && blockMatch.all && !(state.breakingLabels.length || state.unnamedBreak));
				}
				return false;
			}
			if (path.isFunction()) {
				return false;
			}
		}
		const visitor = {
			enter(this: { match: TraversalTestResult, state: { breakingLabels: string[], unnamedBreak: boolean } }, path: NodePath) {
				switch (visit(path, this.match, this.state)) {
					case true:
						path.stop();
						break;
					case false:
						path.skip();
						break;
				}
			}
		};
		function match(path: NodePath<Node | null>, state: { breakingLabels: string[], unnamedBreak: boolean }) {
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
		return pathsPassTest(path => path.type !== null && matchingNodeTypes.indexOf(path.type) !== -1, referenceOriginalNodes);
	}

	const pathsReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"], true);
	const pathsReturnOrThrowCurrentNodes = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"], false);
	const pathsBreak = pathsReachNodeTypes(["BreakStatement"], true);
	const pathsBreakReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement", "BreakStatement"], true);

	function isNonEmptyStatement(statement: Statement) {
		return !types.isEmptyStatement(statement);
	}

	function expressionInSingleReturnStatement(statements: Statement[]): Expression | void {
		statements = statements.filter(isNonEmptyStatement);
		if (statements.length === 1) {
			const firstStatement = statements[0];
			if (types.isReturnStatement(firstStatement)) {
				let argument = firstStatement.argument;
				if (argument) {
					return argument;
				}
			}
		}
	}

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

	function identifiersInForToLengthStatement(statement: NodePath<ForStatement>): ForToIdentifier | undefined {
		// Match: for (var i = 0; i < array.length; i++)
		const init = statement.get("init");
		if (init.isVariableDeclaration() && init.node.declarations.length === 1) {
			const declaration = init.get("declarations")[0];
			if (types.isNumericLiteral(declaration.node.init) && declaration.node.init.value === 0) {
				const i = declaration.node.id;
				const test = statement.get("test");
				if (types.isIdentifier(i) &&
					test.isBinaryExpression() &&
					test.node.operator === "<" &&
					types.isIdentifier(test.node.left) &&
					test.node.left.name === i.name
				) {
					const right = test.get("right");
					if (right.isMemberExpression()) {
						const object = right.node.object;
						if (types.isIdentifier(object) &&
							propertyNameOfMemberExpression(right.node) === "length"
						) {
							const update = statement.get("update");
							if (update.isUpdateExpression() &&
								update.node.operator == "++" &&
								types.isIdentifier(update.node.argument) &&
								update.node.argument.name === i.name
							) {
								const binding = statement.scope.getBinding(i.name);
								if (binding) {
									const updateArgument = update.get("argument");
									if (!binding.constantViolations.some(cv => cv !== updateArgument && cv !== update)) {
										return {
											i,
											array: object
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
						if (argument.isCallExpression() && invokeTypeOfExpression(argument) && argument.get("arguments").length === 1) {
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
						if (firstArg.isIdentifier() && firstArg.node.name === right.node.name &&
							secondArg.isIdentifier() && secondArg.node.name === left.node.name)
						{
							// Check for .call(...)
							const callee = test.get("callee");
							if (callee.isMemberExpression() && propertyNameOfMemberExpression(callee.node) === "call") {
								// Check for .hasOwnProperty
								let method = callee.get("object");
								if (method.isMemberExpression() && propertyNameOfMemberExpression(method.node) === "hasOwnProperty") {
									let target = method.get("object");
									// Check for empty temporary object
									if (target.isObjectExpression() && target.node.properties.length === 0) {
										return body.get("consequent");
									}
									// Strip .prototype if present
									if (target.isMemberExpression() && propertyNameOfMemberExpression(target.node) === "prototype") {
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

	function isPassthroughContinuation(continuation?: Expression) {
		if (!continuation || !types.isFunctionExpression(continuation)) {
			return false;
		}
		if (continuation.params.length === 1) {
			const expression = expressionInSingleReturnStatement(continuation.body.body);
			if (expression) {
				const firstParam = continuation.params[0];
				if (types.isIdentifier(firstParam)) {
					const valueName = firstParam.name;
					if (types.isIdentifier(expression) && expression.name === valueName) {
						return true;
					}
					if (types.isConditionalExpression(expression) && types.isIdentifier(expression.test) && types.isIdentifier(expression.consequent) && expression.consequent.name === valueName && types.isIdentifier(expression.alternate) && expression.alternate.name === valueName) {
						return true;
					}
				}
			}
		}
		return false;
	}

	function awaitAndContinue(state: PluginState, path: NodePath, value: Expression, continuation?: Expression, directExpression?: Expression) {
		if (continuation && isPassthroughContinuation(continuation)) {
			continuation = undefined;
		}
		if (!continuation && directExpression && types.isBooleanLiteral(directExpression) && directExpression.value) {
			return value;
		}
		let useCallHelper: boolean;
		let args: Expression[];
		if (types.isCallExpression(value) && value.arguments.length === 0 && !types.isMemberExpression(value.callee)) {
			useCallHelper = true;
			args = [value.callee];
		} else {
			useCallHelper = false;
			args = [value];
		}
		const ignoreResult = continuation && types.isIdentifier(continuation) && continuation === path.hub.file.declarations["_empty"];
		if (!ignoreResult && continuation) {
			args.push(unwrapReturnCallWithPassthroughArgument(continuation, path.scope));
		}
		if (directExpression && !(types.isBooleanLiteral(directExpression) && !directExpression.value)) {
			if (!ignoreResult && !continuation) {
				args.push(voidExpression());
			}
			args.push(directExpression);
		}
		let helperName = directExpression ? (useCallHelper ? "_call" : "_await") : (useCallHelper ? "_invoke" : "_continue");
		if (ignoreResult) {
			helperName += "Ignored";
		}
		if (args.length === 1) {
			switch (helperName) {
				case "_invoke":
					return types.callExpression(args[0], []);
				case "_continue":
					return args[0];
			}
		}
		return types.callExpression(helperReference(state, path, helperName), args);
	}

	function voidExpression(arg?: Expression) {
		return types.unaryExpression("void", arg || types.numericLiteral(0));
	}

	function borrowTail(target: NodePath): Statement[] {
		let current = target;
		let dest = [];
		while (current && current.node && current.inList && current.container) {
			while ((current.key as number) + 1 < (current.container as Statement[]).length) {
				dest.push((current.container as Statement[])[(current.key as number) + 1]);
				current.getSibling((current.key as number) + 1).remove();
			}
			current = current.parentPath;
			if (!current.isBlockStatement()) {
				break;
			}
		}
		return dest;
	}

	function exitsInTail(target: NodePath) {
		let current: NodePath | undefined = target;
		while (current && current.node && current.inList && current.container && !current.isFunction()) {
			for (var i = (current.key as number) + 1; i < (current.container as Node[]).length; i++) {
				const sibling = (current.container as Node[])[(current.key as number) + 1];
				if (pathsReturnOrThrow(current).any) {
					return true;
				}
			}
			current = current.parentPath;
		}
		return false;
	}

	function returnStatement(argument: Expression | undefined, originalNode?: Node): ReturnStatement {
		const result: ReturnStatement = types.returnStatement(argument);
		result._skip = true;
		result._originalNode = originalNode;
		return result;
	}

	function removeUnnecessaryReturnStatements(blocks: Statement[]): Statement[] {
		while (blocks.length) {
			const lastStatement = blocks[blocks.length - 1];
			if (types.isReturnStatement(lastStatement)) {
				if (lastStatement.argument === null || lastStatement.argument === undefined) {
					blocks = blocks.slice(0, blocks.length - 1);
				} else {
					if (blocks.length > 1) {
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
								blocks.push(types.returnStatement(conditionalExpression(previousStatement.test, consequent.argument, lastStatement.argument)));
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

	function rewriteAsyncNode<T extends Expression | Statement>(state: PluginState, parentPath: NodePath, node: T, additionalConstantNames: string[], exitIdentifier?: Identifier, unpromisify?: boolean) {
		const path = pathForNewNode(node, parentPath);
		rewriteAsyncBlock(state, path, additionalConstantNames, exitIdentifier, unpromisify);
		return path.node;
	}

	function allScopes(scope: Scope): Scope[] {
		const result = [];
		while (scope) {
			result.push(scope);
			scope = scope.parent;
		}
		return result;
	}

	const hoistCallArgumentsInnerVisitor: Visitor<HoistCallArgumentsInnerState> = {
		Identifier(identifierPath) {
			if (identifierSearchesScope(identifierPath)) {
				const name = identifierPath.node.name;
				if (this.argumentNames.indexOf(name) === -1) {
					if (this.additionalConstantNames.indexOf(name) !== -1) {
						this.scopes.push(this.path.scope.parent);
					} else {
						const binding = identifierPath.scope.getBinding(name);
						if (binding) {
							if (binding.scope && this.pathScopes.includes(binding.scope)) {
								this.scopes.push(binding.scope);
							}
						} else if (isNewBabel) {
							// Babel 7 doesn't resolve bindings for some reason, need to be conservative with hoisting
							this.scopes.push(this.path.scope.parent);
						}
					}
				}
			}
		}
	};

	function isValueLiteral(node: Node): node is (StringLiteral | NumericLiteral | BooleanLiteral) {
		return types.isStringLiteral(node) || types.isNumericLiteral(node) || types.isBooleanLiteral(node);
	}

	const hoistCallArgumentsVisitor: Visitor<HoistCallArgumentsState> = {
		FunctionExpression(path) {
			path.skip();
			const bodyPath = path.get("body");
			if (bodyPath.node.body.length === 0) {
				path.replaceWith(helperReference(this.state, path, "_empty"));
				return;
			}
			const argumentNames: string[] = [];
			for (const param of path.node.params) {
				if (types.isIdentifier(param)) {
					argumentNames.push(param.name);
				} else {
					return;
				}
			}
			const scopes: Scope[] = [];
			const pathScopes = allScopes(path.scope.parent);
			bodyPath.traverse(hoistCallArgumentsInnerVisitor, {
				argumentNames,
				scopes,
				pathScopes,
				path,
				additionalConstantNames: this.additionalConstantNames,
			});
			let scope = path.scope.getProgramParent()
			let ancestry = [scope];
			for (let otherScope of scopes) {
				if (!ancestry.includes(otherScope)) {
					scope = otherScope;
					ancestry = ancestry.concat(allScopes(otherScope));
				}
			}
			if (!ancestry.includes(path.scope.parent)) {
				let nameNode: Node = path.node;
				if (types.isFunctionExpression(nameNode) && nameNode.body.body.length === 1) {
					nameNode = nameNode.body.body[0];
				}
				if (types.isReturnStatement(nameNode) && nameNode.argument) {
					nameNode = nameNode.argument;
				}
				if (types.isCallExpression(nameNode)) {
					const callee = nameNode.callee;
					if (types.isIdentifier(callee) && callee._helperName) {
						nameNode = nameNode.arguments[0];
					}
				}
				const identifier = isValueLiteral(nameNode) ? path.scope.generateUidIdentifier(nameNode.value.toString().replace(/\d/g, (number: any) => numberNames[number as number])) : path.scope.generateUidIdentifierBasedOnNode(nameNode, "temp");
				scope.push({ id: identifier, init: path.node });
				path.replaceWith(identifier);
			}
		}
	};

	function hoistCallArguments(state: PluginState, path: NodePath, additionalConstantNames: string[]) {
		if (path.isCallExpression()) {
			const callee = path.node.callee;
			if (types.isIdentifier(callee) && callee._helperName) {
				path.traverse(hoistCallArgumentsVisitor, { state, additionalConstantNames });
			}
		}
	}

	function relocateTail(state: PluginState, awaitExpression: Expression, statementNode: Statement | undefined, target: NodePath<Statement>, additionalConstantNames: string[], temporary?: Identifier, exitCheck?: Expression, directExpression?: Expression) {
		const tail = borrowTail(target);
		let expression;
		let originalNode = target.node;
		const rewrittenTail = statementNode || tail.length ? rewriteAsyncNode(state, target, blockStatement((statementNode ? [statementNode] : []).concat(tail)), additionalConstantNames).body : [];
		const blocks = removeUnnecessaryReturnStatements(rewrittenTail.filter(isNonEmptyStatement));
		if (blocks.length) {
			const moreBlocks = exitCheck ? removeUnnecessaryReturnStatements([types.ifStatement(exitCheck, returnStatement(temporary)) as Statement].concat(blocks)) : blocks;
			const fn = types.functionExpression(undefined, temporary ? [temporary] : [], blockStatement(moreBlocks));
			expression = awaitAndContinue(state, target, awaitExpression, fn, directExpression);
			originalNode = types.blockStatement([target.node].concat(tail));
		} else if (pathsReturnOrThrow(target).any) {
			expression = awaitAndContinue(state, target, awaitExpression, undefined, directExpression);
		} else {
			expression = awaitAndContinue(state, target, awaitExpression, helperReference(state, target, "_empty"), directExpression);
		}
		target.replaceWith(returnStatement(expression, originalNode));
		if (state.opts.hoist && target.isReturnStatement()) {
			const argument = target.get("argument");
			if (argument.node) {
				hoistCallArguments(state, argument as NodePath<Expression>, additionalConstantNames);
			}
		}
	}

	const rewriteThisVisitor: Visitor<{ thisIdentifier?: Identifier }> = {
		Function(path: NodePath<Function>) {
			if (!path.isArrowFunctionExpression()) {
				path.skip();
			}
		},
		ThisExpression(path: NodePath<ThisExpression>) {
			if (!this.thisIdentifier) {
				this.thisIdentifier = path.scope.generateUidIdentifier("this");
			}
			path.replaceWith(this.thisIdentifier);
		},
	};

	function rewriteThisExpressions(rewritePath: NodePath, targetPath: NodePath) {
		const state: { thisIdentifier?: Identifier } = {};
		rewritePath.traverse(rewriteThisVisitor, state);
		if (state.thisIdentifier) {
			targetPath.scope.push({ id: state.thisIdentifier, init: types.thisExpression() });
		}
	}

	const rewriteThisArgumentsAndHoistVisitor: Visitor<{ targetPath: NodePath, thisIdentifier?: Identifier, argumentsIdentifier?: Identifier }> = {
		Function(path) {
			path.skip();
			if (path.isArrowFunctionExpression()) {
				path.traverse(rewriteThisVisitor, this);
			}
		},
		ThisExpression(path) {
			if (!this.thisIdentifier) {
				this.thisIdentifier = path.scope.generateUidIdentifier("this");
			}
			path.replaceWith(this.thisIdentifier);
		},
		Identifier(path) {
			// Rewrite arguments
			if (path.node.name === "arguments") {
				if (!this.argumentsIdentifier) {
					this.argumentsIdentifier = path.scope.generateUidIdentifier("arguments");
				}
				path.replaceWith(this.argumentsIdentifier);
			}
		},
		VariableDeclaration(path) {
			const scope = path.scope;
			if (path.node.kind === "var") {
				const declarations = path.get("declarations");
				for (const declaration of declarations) {
					const id = declaration.node.id;
					if (types.isIdentifier(id)) {
						const binding = scope.getBinding(id.name);
						if (!binding || (binding.referencePaths.some(referencePath => referencePath.willIMaybeExecuteBefore(path)) || (binding.referencePaths.length && path.getDeepestCommonAncestorFrom(binding.referencePaths.concat([path])) !== path.parentPath))) {
							this.targetPath.scope.push({ id });
							if (declaration.node.init) {
								path.insertBefore(types.expressionStatement(types.assignmentExpression("=", id, declaration.node.init)));
							}
							if ((path.parentPath.isForInStatement() || path.parentPath.isForOfStatement()) && path.parentPath.get("left") === path) {
								path.replaceWith(id);
							} else {
								declaration.remove();
							}
						}
					} else {
						// TODO: Support destructured identifiers
					}
				}
			}
		},
		FunctionDeclaration(path) {
			const siblings = path.getAllPrevSiblings();
			if (siblings.some(sibling => !sibling.isFunctionDeclaration())) {
				const node = path.node;
				const parentPath = path.parentPath;
				path.remove();
				const paths = siblings[0].insertBefore(node);
				if (isNewBabel) {
					parentPath.scope.registerDeclaration(paths[0]);
				}
			}
		},
	};

	function rewriteThisArgumentsAndHoistFunctions(rewritePath: NodePath, targetPath: NodePath) {
		const state: { targetPath: NodePath, thisIdentifier?: Identifier, argumentsIdentifier?: Identifier } = { targetPath };
		rewritePath.traverse(rewriteThisArgumentsAndHoistVisitor, state);
		if (state.thisIdentifier) {
			targetPath.scope.push({ id: state.thisIdentifier, init: types.thisExpression() });
		}
		if (state.argumentsIdentifier) {
			targetPath.scope.push({ id: state.argumentsIdentifier, init: types.identifier("arguments") });
		}
	}

	function functionize(expression: Expression | Statement): FunctionExpression {
		if (types.isExpression(expression)) {
			expression = returnStatement(expression);
		}
		if (!types.isBlockStatement(expression)) {
			expression = blockStatement([expression]);
		}
		return types.functionExpression(undefined, [], expression);
	}

	function blockStatement(statementOrStatements: Statement[] | Statement): BlockStatement {
		if ("length" in statementOrStatements) {
			return types.blockStatement(statementOrStatements.filter(statement => !types.isEmptyStatement(statement)));
		} else if (!types.isBlockStatement(statementOrStatements)) {
			return types.blockStatement([statementOrStatements]);
		} else {
			return statementOrStatements;
		}
	}

	function unwrapReturnCallWithEmptyArguments(node: Expression, scope: Scope, additionalConstantNames: string[]): Expression {
		if (types.isFunctionExpression(node) && node.body.body.length === 1) {
			const onlyStatement = node.body.body[0];
			if (types.isReturnStatement(onlyStatement)) {
				const expression = onlyStatement.argument;
				if (types.isCallExpression(expression)) {
					let callTarget;
					switch (expression.arguments.length) {
						case 0:
							callTarget = expression.callee;
							break;
						case 1: {
							const callee = expression.callee;
							if (types.isIdentifier(callee) && callee._helperName === "_call") {
								callTarget = expression.arguments[0];
							}
							break;
						}
					}
					if (callTarget) {
						if (types.isIdentifier(callTarget)) {
							const binding = scope.getBinding(callTarget.name);
							if (binding && binding.constant) {
								return callTarget;
							}
							if (additionalConstantNames.indexOf(callTarget.name) !== -1) {
								return callTarget;
							}
						} else if (types.isFunctionExpression(callTarget)) {
							return callTarget;
						}
					}
				}
			}
		}
		return node;
	}

	function unwrapReturnCallWithPassthroughArgument(node: Expression, scope: Scope) {
		if (types.isFunctionExpression(node) && node.params.length >= 1 && node.body.body.length >= 1) {
			const firstStatement = node.body.body[0];
			if (types.isReturnStatement(firstStatement)) {
				const expression = firstStatement.argument;
				if (types.isCallExpression(expression) && expression.arguments.length === 1) {
					const firstArgument = expression.arguments[0];
					const firstParam = node.params[0];
					if (types.isIdentifier(firstArgument) && types.isIdentifier(firstParam) && firstArgument.name === firstParam.name && types.isIdentifier(expression.callee)) {
						const binding = scope.getBinding(expression.callee.name);
						if (binding && binding.constant) {
							return expression.callee;
						}
					}
				}
			}
		}
		return node;
	}

	function isExpressionOfLiterals(path: NodePath, literalNames: string[]): boolean {
		if (path.isIdentifier()) {
			if (path.node.name === "undefined") {
				return true;
			}
			const binding = path.parentPath.scope.getBinding(path.node.name);
			if (binding) {
				return binding.constant;
			}
			if (literalNames.indexOf(path.node.name) !== -1) {
				return true;
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
			return path.get("elements").every(path => path === null || path.node === null ? true : isExpressionOfLiterals(path as NodePath, literalNames));
		}
		if (path.isObjectExpression()) {
			return path.get("properties").every(path => {
				if (!path.isObjectProperty()) {
					return true;
				}
				if (isExpressionOfLiterals(path.get("value"), literalNames) && (!path.node.computed || isExpressionOfLiterals(path.get("key"), literalNames))) {
					return true;
				}
				return false;
			});
		}
		if (path.isUnaryExpression()) {
			return isExpressionOfLiterals(path.get("argument"), literalNames);
		}
		if (path.isLogicalExpression() || path.isBinaryExpression()) {
			return isExpressionOfLiterals(path.get("left"), literalNames) && isExpressionOfLiterals(path.get("right"), literalNames);
		}
		if (path.isConditionalExpression()) {
			return isExpressionOfLiterals(path.get("test"), literalNames) && isExpressionOfLiterals(path.get("consequent"), literalNames) && isExpressionOfLiterals(path.get("alternate"), literalNames);
		}
		return false;
	}

	function generateIdentifierForPath(path: NodePath): Identifier {
		const result = path.scope.generateUidIdentifierBasedOnNode(path.node, "temp");
		if (path.isIdentifier() && path.node.name === result.name) {
			return path.scope.generateUidIdentifier("temp");
		}
		return result;
	}

	function conditionalExpression(test: Expression, consequent: Expression, alternate: Expression) {
		while (types.isUnaryExpression(test) && test.operator === "!") {
			test = test.argument;
			const temp = consequent;
			consequent = alternate;
			alternate = consequent;
		}
		if ((isValueLiteral(consequent) && isValueLiteral(alternate) && consequent.value === alternate.value) ||
			(types.isNullLiteral(consequent) && types.isNullLiteral(alternate)) ||
			(types.isIdentifier(consequent) && types.isIdentifier(alternate) && consequent.name === alternate.name)
		) {
			if (types.isIdentifier(test) || types.isLiteral(test)) {
				return consequent;
			}
		}
		return types.conditionalExpression(test, consequent, alternate);
	}

	function extractBooleanValue(node: Expression): boolean | void {
		if (types.isBooleanLiteral(node)) {
			return node.value;
		}
		if (types.isUnaryExpression(node) && node.operator === "!") {
			const result = extractLooseBooleanValue(node.argument);
			return typeof result === "undefined" ? undefined : !result;
		}
	}

	function extractLooseBooleanValue(node: Expression): boolean | void {
		if (isValueLiteral(node)) {
			return !!node.value;
		}
		if (types.isNullLiteral(node)) {
			return false;
		}
		if (types.isIdentifier(node)) {
			if (alwaysTruthy.includes(node.name)) {
				return true;
			}
			if (node.name === "undefined") {
				return false;
			}
		}
		if (types.isUnaryExpression(node) && node.operator === "!") {
			const result = extractLooseBooleanValue(node.argument);
			return typeof result === "undefined" ? undefined : !result;
		}
	}

	function logicalOr(left: Expression, right: Expression): Expression {
		switch (extractBooleanValue(left)) {
			case true:
				return left;
			case false:
				return right;
			default:
				return types.logicalExpression("||", left, right);
		}
	}

	function logicalOrLoose(left: Expression, right: Expression): Expression {
		switch (extractLooseBooleanValue(left)) {
			case false:
				return extractLooseBooleanValue(right) === false ? types.booleanLiteral(false) : right;
			case true:
				return types.booleanLiteral(true);
			default:
				switch (extractLooseBooleanValue(right)) {
					case false:
						return left;
					case true:
						return types.booleanLiteral(true);
					default:
						return types.logicalExpression("||", left, right);
				}
		}
	}

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

	function logicalNot(node: Expression): Expression {
		const literalValue = extractLooseBooleanValue(node);
		if (typeof literalValue !== "undefined") {
			return types.booleanLiteral(!literalValue);
		}
		if (types.isUnaryExpression(node) && node.operator === "!" && types.isUnaryExpression(node.argument) && node.argument.operator === "!") {
			return node.argument;
		}
		return types.unaryExpression("!", node);
	}

	function unwrapSpreadElement(path: NodePath<Expression | SpreadElement | null>): NodePath<Expression> {
		if (path.isExpression()) {
			return path;
		}
		if (path.isSpreadElement()) {
			return path.get("argument");
		}
		throw path.buildCodeFrameError(`Expected either an expression or a spread element, got a ${path.type}!`);
	}

	function findDeclarationToReuse(path: NodePath): NodePath<VariableDeclarator> | undefined {
		for (;;) {
			const parent = path.parentPath;
			if (parent.isVariableDeclarator() && parent.get("id").isIdentifier()) {
				return parent;
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
			const otherAwaitPath = findAwaitPath(other);
			if ((otherAwaitPath === other) || !otherAwaitPath) {
				path = path.parentPath;
			} else {
				break;
			}
		}
	}

	function extractDeclarations(originalAwaitPath: NodePath<AwaitExpression>, awaitExpression: Expression, additionalConstantNames: string[]): { declarations: VariableDeclarator[], awaitExpression: Expression, directExpression: Expression, reusingExisting: NodePath<VariableDeclarator> | undefined, resultIdentifier?: Identifier } {
		let awaitPath: NodePath<Exclude<Node, Statement>> = originalAwaitPath;
		const reusingExisting = findDeclarationToReuse(awaitPath);
		const reusingExistingId = reusingExisting ? reusingExisting.get("id") : undefined;
		const existingIdentifier = reusingExistingId && reusingExistingId.isIdentifier() ? reusingExistingId.node : undefined;
		let resultIdentifier: Identifier | undefined;
		if (awaitPath.parentPath.isSequenceExpression() && (awaitPath.key < (awaitPath.container as NodePath[]).length - 1)) {
			originalAwaitPath.replaceWith(types.numericLiteral(0));
		} else {
			const newIdentifier = resultIdentifier = existingIdentifier || generateIdentifierForPath(originalAwaitPath.get("argument"));
			originalAwaitPath.replaceWith(newIdentifier);
		}
		let declarations: VariableDeclarator[] = [];
		let directExpression: Expression = types.booleanLiteral(false);
		for (;;) {
			const parent = awaitPath.parentPath;
			if (parent.isVariableDeclarator()) {
				const beforeDeclarations: VariableDeclarator[] = [];
				while (parent.key !== 0) {
					const sibling = parent.getSibling(0);
					if (sibling.isVariableDeclarator()) {
						beforeDeclarations.push(sibling.node);
						sibling.remove();
					} else {
						throw sibling.buildCodeFrameError(`Expected a variable declarator, got a ${sibling.type}!`);
					}
				}
				if (beforeDeclarations.length) {
					declarations = declarations.concat(beforeDeclarations.concat(declarations));
				}
			} else if (parent.isLogicalExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isExpressionOfLiterals(left, additionalConstantNames)) {
						const leftIdentifier = generateIdentifierForPath(left);
						declarations = declarations.map(declaration => declaration.init ? types.variableDeclarator(declaration.id, logicalAnd(parent.node.operator === "||" ? logicalNot(leftIdentifier) : leftIdentifier, declaration.init)) : declaration);
						declarations.unshift(types.variableDeclarator(leftIdentifier, left.node));
						left.replaceWith(leftIdentifier);
					}
					const isOr = parent.node.operator === "||";
					awaitExpression = (isOr ? logicalOr : logicalAnd)(left.node, awaitExpression);
					directExpression = logicalOrLoose(isOr ? left.node : logicalNot(left.node), directExpression);
					if (awaitPath === originalAwaitPath) {
						if (!resultIdentifier) {
							resultIdentifier = existingIdentifier || generateIdentifierForPath(originalAwaitPath.get("argument"));
						}
						parent.replaceWith(resultIdentifier);
						awaitPath = parent;
						continue;
					}
				}
			} else if (parent.isBinaryExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isExpressionOfLiterals(left, additionalConstantNames)) {
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
					const otherAwaitPath = findAwaitPath(other);
					let testIdentifier: Identifier | undefined;
					const isBoth = consequent === awaitPath && otherAwaitPath === alternate;
					if (!(isBoth && awaitPath === originalAwaitPath) && !isExpressionOfLiterals(test, additionalConstantNames)) {
						testIdentifier = generateIdentifierForPath(test);
					}
					declarations = declarations.map(declaration => declaration.init ? types.variableDeclarator(declaration.id, (consequent === awaitPath ? logicalAnd : logicalOr)(testIdentifier || testNode, declaration.init)) : declaration);
					if (testIdentifier) {
						declarations.unshift(types.variableDeclarator(testIdentifier, testNode));
						test.replaceWith(testIdentifier);
						testNode = testIdentifier;
					}
					if (isBoth && otherAwaitPath) {
						awaitExpression = conditionalExpression(testNode, awaitExpression, otherAwaitPath.node.argument);
						if (!resultIdentifier) {
							resultIdentifier = existingIdentifier || generateIdentifierForPath(originalAwaitPath.get("argument"));
						}
						alternate.replaceWith(resultIdentifier);
						parent.replaceWith(resultIdentifier);
					} else {
						directExpression = logicalOrLoose(consequent !== awaitPath ? testNode : logicalNot(testNode), directExpression);
						if (otherAwaitPath) {
							awaitExpression = consequent !== awaitPath ? conditionalExpression(testNode, types.numericLiteral(0), awaitExpression) : conditionalExpression(testNode, awaitExpression, types.numericLiteral(0));
						} else {
							awaitExpression = consequent !== awaitPath ? conditionalExpression(testNode, other.node, awaitExpression) : conditionalExpression(testNode, awaitExpression, other.node);
							if (!resultIdentifier) {
								resultIdentifier = existingIdentifier || generateIdentifierForPath(originalAwaitPath.get("argument"));
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
						if (!isExpressionOfLiterals(spreadArg, additionalConstantNames)) {
							const argIdentifier = generateIdentifierForPath(spreadArg);
							declarations.unshift(types.variableDeclarator(argIdentifier, spreadArg.node));
							spreadArg.replaceWith(argIdentifier);
						}
					}
					if (!isExpressionOfLiterals(callee, additionalConstantNames)) {
						if (callee.isMemberExpression()) {
							const object = callee.get("object");
							if (!isExpressionOfLiterals(object, additionalConstantNames)) {
								const objectIdentifier = generateIdentifierForPath(object);
								declarations.unshift(types.variableDeclarator(objectIdentifier, object.node));
								object.replaceWith(objectIdentifier);
							}
							const property = callee.get("property");
							const calleeIdentifier = generateIdentifierForPath(property);
							const calleeNode = callee.node;
							const newArguments: (Expression | SpreadElement)[] = [object.node];
							parent.replaceWith(types.callExpression(types.memberExpression(calleeIdentifier, types.identifier("call")), newArguments.concat(parent.node.arguments)));
							declarations.unshift(types.variableDeclarator(calleeIdentifier, calleeNode));
						} else if (!callee.isIdentifier() || !(callee.node._helperName || (awaitPath.scope.getBinding(callee.node.name) || { constant: false }).constant)) {
							const calleeIdentifier = generateIdentifierForPath(callee);
							const calleeNode = callee.node;
							callee.replaceWith(calleeIdentifier);
							declarations.unshift(types.variableDeclarator(calleeIdentifier, calleeNode));
						}
					}
				}
			} else if (parent.isArrayExpression()) {
				for (const element of parent.get("elements")) {
					const spreadElement = unwrapSpreadElement(element);
					if (element === awaitPath || spreadElement === awaitPath) {
						break;
					}
					if (!isExpressionOfLiterals(spreadElement, additionalConstantNames)) {
						const elementIdentifier = generateIdentifierForPath(spreadElement);
						declarations.unshift(types.variableDeclarator(elementIdentifier, spreadElement.node));
						spreadElement.replaceWith(elementIdentifier);
					}
				}
			} else if (parent.isObjectExpression()) {
				for (const prop of parent.get("properties")) {
					if (prop === awaitPath) {
						break;
					}
					if (prop.isObjectProperty()) {
						if (prop.node.computed) {
							const propKey = prop.get("key");
							if (propKey === awaitPath) {
								break;
							}
							if (!isExpressionOfLiterals(propKey, additionalConstantNames)) {
								const keyIdentifier = generateIdentifierForPath(propKey);
								declarations.unshift(types.variableDeclarator(keyIdentifier, propKey.node));
								propKey.replaceWith(keyIdentifier);
							}
						}
						const propValue = prop.get("value");
						if (propValue === awaitPath) {
							break;
						}
						if (!isExpressionOfLiterals(propValue, additionalConstantNames)) {
							const propIdentifier = generateIdentifierForPath(propValue);
							declarations.unshift(types.variableDeclarator(propIdentifier, propValue.node));
							propValue.replaceWith(propIdentifier);
						}
					}
				}
			}
			if (parent.isStatement()) {
				return { declarations, awaitExpression, directExpression, reusingExisting, resultIdentifier };
			} else {
				awaitPath = parent;
			}
		}
	}

	function skipNode(path: NodePath) {
		path.skip();
	}

	const awaitPathVisitor: Visitor<{ result?: NodePath }> = {
		Function: skipNode,
		AwaitExpression(path) {
			this.result = path;
			path.stop();
		},
	};

	function findAwaitPath(path: NodePath): NodePath<AwaitExpression> | void {
		if (path.isAwaitExpression()) {
			return path;
		}
		let state: { result?: NodePath } = { };
		path.traverse(awaitPathVisitor, state);
		const result = state.result;
		if (result && result.isAwaitExpression()) {
			return result;
		}
	}

	function buildBreakExitCheck(exitIdentifier: Identifier | undefined, breakIdentifiers: { identifier: Identifier }[]): Expression | undefined {
		let expressions: Expression[] = (breakIdentifiers.map(identifier => identifier.identifier) || []).concat(exitIdentifier ? [exitIdentifier] : []);
		if (expressions.length) {
			return expressions.reduce((accumulator, identifier) => logicalOrLoose(accumulator, identifier));
		}
	}

	function pushMissing<T>(destination: T[], source: T[]) {
		for (var value of source) {
			var index = destination.indexOf(value);
			if (index < 0) {
				destination.push(value);
			}
		}
	}

	function setBreakIdentifier(value: Expression, breakIdentifier: BreakContinueItem): Expression {
		return types.assignmentExpression("=", breakIdentifier.identifier, value);
	}

	function setBreakIdentifiers(breakIdentifiers: ReadonlyArray<BreakContinueItem>) {
		return breakIdentifiers.reduce(setBreakIdentifier, types.numericLiteral(1))
	}

	const replaceReturnsAndBreaksVisitor: Visitor<{ exitIdentifier?: Identifier, breakIdentifiers: BreakContinueItem[], usedIdentifiers: BreakContinueItem[] }> = {
		Function: skipNode,
		ReturnStatement(path) {
			if (!path.node._skip && this.exitIdentifier) {
				if (path.node.argument && extractLooseBooleanValue(path.node.argument) === true) {
					path.replaceWith(returnStatement(types.assignmentExpression("=", this.exitIdentifier, path.node.argument), path.node));
				} else {
					path.replaceWithMultiple([
						types.expressionStatement(types.assignmentExpression("=", this.exitIdentifier, types.numericLiteral(1))),
						returnStatement(path.node.argument, path.node),
					]);
				}
			}
		},
		BreakStatement(path) {
			const replace = returnStatement(undefined, path.node);
			const label = path.node.label;
			const index = label ? this.breakIdentifiers.findIndex(breakIdentifier => breakIdentifier.name === label.name) : 0;
			if (index !== -1 && this.breakIdentifiers.length) {
				const used = this.breakIdentifiers.slice(0, index + 1);
				if (used.length) {
					pushMissing(this.usedIdentifiers, used);
					path.replaceWithMultiple([
						types.expressionStatement(setBreakIdentifiers(used)),
						replace,
					]);
					return;
				}
			}
			path.replaceWith(replace);
		},
		ContinueStatement(path) {
			const replace = returnStatement(undefined, path.node);
			const label = path.node.label;
			const index = label ? this.breakIdentifiers.findIndex(breakIdentifier => breakIdentifier.name === label.name) : 0;
			if (index !== -1 && this.breakIdentifiers.length) {
				const used = this.breakIdentifiers.slice(0, index);
				if (used.length) {
					pushMissing(this.usedIdentifiers, used);
					path.replaceWithMultiple([
						types.expressionStatement(setBreakIdentifiers(used)),
						replace,
					]);
					return;
				}
			}
			path.replaceWith(replace);
		},
	};

	function replaceReturnsAndBreaks(path: NodePath, exitIdentifier?: Identifier): BreakContinueItem[] {
		const state = { exitIdentifier, breakIdentifiers: breakContinueStackForPath(path), usedIdentifiers: [] as BreakContinueItem[] };
		path.traverse(replaceReturnsAndBreaksVisitor, state);
		for (const identifier of state.usedIdentifiers) {
			if (!identifier.path.parentPath.scope.getBinding(identifier.identifier.name)) {
				identifier.path.parentPath.scope.push({ id: identifier.identifier });
			}
		}
		return state.usedIdentifiers;
	}

	function breakIdentifierForPath(path: NodePath): Identifier {
		let result = path.node._breakIdentifier;
		if (!result) {
			result = path.node._breakIdentifier = path.scope.generateUidIdentifier(path.parentPath.isLabeledStatement() ? path.parentPath.node.label.name + "Interrupt" : "interrupt");
		}
		return result;
	}

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
			const originalNode = path.node._originalNode;
			if (originalNode) {
				traverse(wrapNodeInStatement(originalNode), simpleBreakOrContinueReferencesVisitor, path.scope, this, path);
				path.skip();
			}
		}
	};

	function simpleBreakOrContinueReferences(path: NodePath): NodePath[] {
		const state = { references: [] };
		path.traverse(simpleBreakOrContinueReferencesVisitor, state);
		return state.references;
	}

	const namedLabelReferencesVisitor: Visitor<{ name: string, breaks: NodePath[], continues: NodePath[] }> = {
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
			const originalNode = path.node._originalNode;
			if (originalNode) {
				traverse(wrapNodeInStatement(originalNode), namedLabelReferencesVisitor, path.scope, this, path);
				path.skip();
			}
		}
	};

	function namedLabelReferences(labelPath: NodePath<LabeledStatement>, targetPath: NodePath): { name: string, breaks: NodePath[], continues: NodePath[] } {
		const state = { name: labelPath.node.label.name, breaks: [], continues: [] };
		targetPath.traverse(namedLabelReferencesVisitor, state);
		return state;
	}

	function breakContinueStackForPath(path: NodePath) {
		let current = path;
		const result = [];
		while (current && !current.isFunction()) {
			if (current.isLoop() || current.isSwitchStatement()) {
				const breaks = pathsBreak(current);
				if (breaks.any && !breaks.all) {
					const simpleReferences = simpleBreakOrContinueReferences(current);
					if (current.parentPath.isLabeledStatement()) {
						const refs = namedLabelReferences(current.parentPath, path);
						if (simpleReferences.length || refs.breaks.length || refs.continues.length) {
							result.push({
								identifier: breakIdentifierForPath(current),
								name: current.parentPath.node.label.name,
								path: current.parentPath,
							});
						}
						current = current.parentPath;
					} else if (simpleReferences.length) {
						result.push({
							identifier: breakIdentifierForPath(current),
							path: current,
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
					});
				}
			}
			current = current.parentPath;
		}
		return result;
	}

	function isForAwaitStatement(path: NodePath): path is NodePath<ForOfStatement> {
		return path.isForAwaitStatement ? path.isForAwaitStatement() : false;
	}

	function getStatementParent(path: NodePath<Statement | Expression>): NodePath<Statement> {
		let parent: NodePath = path;
		do {
			if (parent.isStatement()) {
				return parent;
			}
		} while (parent = parent.parentPath);
		throw path.buildCodeFrameError(`Expected a statement parent!`);
	}

	interface RewriteAwaitState {
		pluginState: PluginState;
		path: NodePath;
		additionalConstantNames: string[];
		exitIdentifier?: Identifier;
	}

	function rewriteAwaitPath(this: RewriteAwaitState, rewritePath: NodePath<AwaitExpression> | NodePath<ForOfStatement>) {
		const state = this;
		const pluginState = state.pluginState;
		const path = state.path;
		const additionalConstantNames = state.additionalConstantNames;
		let awaitPath: NodePath<AwaitExpression> | NodePath<Node>;
		let processExpressions: boolean;
		const rewritePathCopy = rewritePath;
		if (rewritePath.isAwaitExpression()) {
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
			throw rewritePathCopy.buildCodeFrameError(`Expected either an await expression or a for await statement, got a ${rewritePathCopy.type}!`)
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
				test: Expression | null;
			}[];
		}[] = [];
		{
			// Determine if we need an exit identifier and rewrite break/return statements
			let targetPath: NodePath = awaitPath;
			let shouldPushExitIdentifier = false;
			while (targetPath !== path) {
				const parent = targetPath.parentPath;
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
			if (shouldPushExitIdentifier) {
				path.scope.push({ id: state.exitIdentifier });
			}
		}
		for (const item of paths) {
			const parent = item.parent;
			if (parent.isForStatement() || parent.isWhileStatement() || parent.isDoWhileStatement() || parent.isForInStatement() || parent.isForOfStatement() || isForAwaitStatement(parent) || parent.isLabeledStatement()) {
				item.breakIdentifiers = replaceReturnsAndBreaks(parent.get("body"), item.exitIdentifier);
				if (parent.isForStatement()) {
					if (item.forToIdentifiers = identifiersInForToLengthStatement(parent)) {
						additionalConstantNames.push(item.forToIdentifiers.i.name);
					}
				}
			} else if (item.parent.isSwitchStatement()) {
				item.cases = item.parent.get("cases").map((casePath) => {
					return {
						casePath,
						caseExits: pathsReturnOrThrow(casePath),
						caseBreaks: pathsBreak(casePath),
						breakIdentifiers: replaceReturnsAndBreaks(casePath, item.exitIdentifier),
						test: casePath.node.test,
					};
				});
			} else if (item.exitIdentifier) {
				replaceReturnsAndBreaks(parent, item.exitIdentifier);
			}
		}
		for (const { targetPath, explicitExits, breakIdentifiers, parent, exitIdentifier, cases, forToIdentifiers } of paths) {
			if (parent.isIfStatement()) {
				const test = parent.get("test");
				if (targetPath !== test) {
					let resultIdentifier;
					if (!explicitExits.all && explicitExits.any) {
						resultIdentifier = path.scope.generateUidIdentifier("result");
						additionalConstantNames.push(resultIdentifier.name);
					}
					if (!explicitExits.all) {
						const consequent = parent.get("consequent");
						const consequentNode = rewriteAsyncNode(pluginState, parent, consequent.node, additionalConstantNames, exitIdentifier);
						const alternate = parent.get("alternate");
						const alternateNode = alternate.node ? rewriteAsyncNode(pluginState, parent, alternate.node, additionalConstantNames, exitIdentifier) : undefined;
						const fn = types.functionExpression(undefined, [], blockStatement([types.ifStatement(test.node, consequentNode, alternateNode)]));
						relocateTail(pluginState, types.callExpression(fn, []), undefined, parent, additionalConstantNames, resultIdentifier, exitIdentifier);
						processExpressions = false;
					}
				}
			} else if (parent.isTryStatement()) {
				const temporary = explicitExits.any && !explicitExits.all ? path.scope.generateUidIdentifier("result") : undefined;
				const exitCheck = buildBreakExitCheck(explicitExits.any && !explicitExits.all ? exitIdentifier : undefined, []);
				let expression: Expression | Statement = rewriteAsyncNode(pluginState, parent, parent.node.block!, additionalConstantNames, exitIdentifier);
				const catchClause = parent.node.handler;
				if (catchClause) {
					const param = catchClause.param;
					const paramIsUsed = parent.get("handler").scope.getBinding(param.name)!.referencePaths.length !== 0;
					const fn = catchClause.body.body.length ? rewriteAsyncNode(pluginState, parent, types.functionExpression(undefined, paramIsUsed ? [param] : [], catchClause.body), additionalConstantNames, exitIdentifier) : helperReference(pluginState, parent, "_empty");
					expression = types.callExpression(helperReference(pluginState, path, "_catch"), [unwrapReturnCallWithEmptyArguments(functionize(expression), path.scope, additionalConstantNames), fn]);
				}
				if (parent.node.finalizer) {
					let finallyName: string;
					let finallyArgs: Identifier[];
					let finallyBody = parent.node.finalizer.body;
					if (!pathsReturnOrThrow(parent.get("finalizer")).all) {
						const resultIdentifier = temporary || path.scope.generateUidIdentifier("result");
						additionalConstantNames.push(resultIdentifier.name);
						const wasThrownIdentifier = path.scope.generateUidIdentifier("wasThrown");
						additionalConstantNames.push(wasThrownIdentifier.name);
						finallyArgs = [wasThrownIdentifier, resultIdentifier];
						finallyBody = finallyBody.concat(returnStatement(types.callExpression(helperReference(pluginState, parent, "_rethrow"), [wasThrownIdentifier, resultIdentifier])));
						finallyName = "_finallyRethrows";
					} else {
						finallyArgs = [];
						finallyName = "_finally";
					}
					const fn = types.functionExpression(undefined, finallyArgs, blockStatement(finallyBody));
					const rewritten = rewriteAsyncNode(pluginState, parent, fn, additionalConstantNames, exitIdentifier);
					expression = types.callExpression(helperReference(pluginState, parent, finallyName), [unwrapReturnCallWithEmptyArguments(functionize(expression), path.scope, additionalConstantNames), rewritten])
				}
				relocateTail(pluginState, types.isExpression(expression) ? expression : types.callExpression(functionize(expression), []), undefined, parent, additionalConstantNames, temporary, exitCheck);
				processExpressions = false;
			} else if (parent.isForStatement() || parent.isWhileStatement() || parent.isDoWhileStatement() || parent.isForInStatement() || parent.isForOfStatement() || isForAwaitStatement(parent)) {
				const breaks = pathsBreak(parent);
				const label = parent.parentPath.isLabeledStatement() ? parent.parentPath.node.label.name : undefined;
				if (parent.isForInStatement() || parent.isForOfStatement() || isForAwaitStatement(parent)) {
					const right = parent.get("right");
					if (awaitPath !== right) {
						const left = parent.get("left");
						const loopIdentifier = left.isVariableDeclaration() ? left.get("declarations")[0].get("id") : left;
						if (loopIdentifier.isIdentifier() || loopIdentifier.isPattern()) {
							const forOwnBodyPath = parent.isForInStatement() && extractForOwnBodyPath(parent);
							const bodyBlock = blockStatement((forOwnBodyPath || parent.get("body")).node);
							const params = [right.node, rewriteAsyncNode(pluginState, parent, bodyBlock.body.length ? types.functionExpression(undefined, [loopIdentifier.node], bodyBlock) : helperReference(pluginState, parent, "_empty"), additionalConstantNames, exitIdentifier)];
							const exitCheck = buildBreakExitCheck(exitIdentifier, breakIdentifiers || []);
							if (exitCheck) {
								params.push(types.functionExpression(undefined, [], types.blockStatement([returnStatement(exitCheck)])));
							}
							const loopCall = types.callExpression(helperReference(pluginState, parent, parent.isForInStatement() ? forOwnBodyPath ? "_forOwn" : "_forIn" : isForAwaitStatement(parent) ? "_forAwaitOf" : "_forOf"), params);
							let resultIdentifier = undefined;
							if (explicitExits.any) {
								resultIdentifier = path.scope.generateUidIdentifier("result");
								additionalConstantNames.push(resultIdentifier.name);
							}
							relocateTail(pluginState, loopCall, undefined, label && parent.parentPath.isStatement() ? parent.parentPath : parent, additionalConstantNames, resultIdentifier, exitIdentifier);
							processExpressions = false;
						} else {
							throw loopIdentifier.buildCodeFrameError(`Expected an identifier or pattern, but got a ${loopIdentifier.type}!`);
						}
					}
				} else {
					let testExpression = parent.node.test;
					const breakExitCheck = buildBreakExitCheck(exitIdentifier, breakIdentifiers || []);
					if (breakExitCheck) {
						const inverted = logicalNot(breakExitCheck);
						testExpression = testExpression && (!types.isBooleanLiteral(testExpression) || !testExpression.value) ? logicalAnd(inverted, testExpression, extractLooseBooleanValue) : inverted;
					}
					if (testExpression) {
						testExpression = rewriteAsyncNode(pluginState, parent, functionize(testExpression), additionalConstantNames, exitIdentifier, true);
					}
					const isDoWhile = parent.isDoWhileStatement();
					if (!breaks.any && !explicitExits.any && forToIdentifiers && !isDoWhile) {
						const loopCall = types.callExpression(helperReference(pluginState, parent, "_forTo"), [forToIdentifiers.array, rewriteAsyncNode(pluginState, parent, types.functionExpression(undefined, [forToIdentifiers.i], blockStatement(parent.node.body)), additionalConstantNames, exitIdentifier)])
						relocateTail(pluginState, loopCall, undefined, parent, additionalConstantNames, undefined, exitIdentifier);
					} else {
						let updateExpression: Expression | null = null;
						if (parent.isForStatement()) {
							updateExpression = parent.node.update;
							if (updateExpression) {
								updateExpression = rewriteAsyncNode(pluginState, parent, functionize(updateExpression), additionalConstantNames, exitIdentifier, true);
							}
							const init = parent.get("init");
							if (init.node) {
								parent.insertBefore(init.node);
							}
						}
						const forIdentifier = path.scope.generateUidIdentifier("for");
						const bodyFunction = rewriteAsyncNode(pluginState, parent, types.functionExpression(undefined, [], blockStatement(parent.node.body)), additionalConstantNames, exitIdentifier);
						const testFunction = unwrapReturnCallWithEmptyArguments(testExpression || voidExpression(), path.scope, additionalConstantNames);
						const updateFunction = unwrapReturnCallWithEmptyArguments(updateExpression || voidExpression(), path.scope, additionalConstantNames);
						const loopCall = isDoWhile ? types.callExpression(helperReference(pluginState, parent, "_do"), [bodyFunction, testFunction]) : types.callExpression(helperReference(pluginState, parent, "_for"), [testFunction, updateFunction, bodyFunction]);
						let resultIdentifier = undefined;
						if (explicitExits.any) {
							resultIdentifier = path.scope.generateUidIdentifier("result");
							additionalConstantNames.push(resultIdentifier.name);
						}
						relocateTail(pluginState, loopCall, undefined, parent, additionalConstantNames, resultIdentifier, exitIdentifier);
					}
					processExpressions = false;
				}
			} else if (parent.isSwitchStatement()) {
				const label = parent.parentPath.isLabeledStatement() ? parent.parentPath.node.label.name : undefined;
				const discriminant = parent.get("discriminant");
				const testPaths = parent.get("cases").map(casePath => casePath.get("test"));
				if (awaitPath !== discriminant && !(explicitExits.all && !testPaths.some(testPath => testPath.node ? findAwaitPath(testPath as NodePath<Expression>) !== undefined : false))) {
					let resultIdentifier;
					if (!explicitExits.all && explicitExits.any) {
						resultIdentifier = path.scope.generateUidIdentifier("result");
						additionalConstantNames.push(resultIdentifier.name);
					}
					const caseNodes = types.arrayExpression(cases ? cases.map(caseItem => {
						const args = [];
						let consequent;
						if (caseItem.casePath.node.consequent) {
							const rewritten = rewriteAsyncNode(pluginState, parent, blockStatement(removeUnnecessaryReturnStatements(caseItem.casePath.node.consequent)), additionalConstantNames, exitIdentifier);
							if (rewritten.body.length) {
								consequent = types.functionExpression(undefined, [], rewritten);
							}
						}
						if (caseItem.casePath.node.test) {
							args.push(rewriteAsyncNode(pluginState, parent, functionize(caseItem.casePath.node.test), additionalConstantNames));
						} else if (consequent) {
							args.push(voidExpression());
						}
						if (consequent) {
							const useBreakIdentifier = !caseItem.caseBreaks.all && caseItem.caseBreaks.any;
							args.push(consequent);
							if (!caseItem.caseExits.any && !caseItem.caseBreaks.any) {
								args.push(helperReference(pluginState, parent, "_empty"));
							} else if (!(caseItem.caseExits.all || caseItem.caseBreaks.all)) {
								const breakCheck = buildBreakExitCheck(caseItem.caseExits.any ? exitIdentifier : undefined, caseItem.breakIdentifiers);
								if (breakCheck) {
									args.push(types.functionExpression(undefined, [], types.blockStatement([returnStatement(breakCheck)])));
								}
							}
						}
						return types.arrayExpression(args);
					}) : []);
					const switchCall = types.callExpression(helperReference(pluginState, parent, "_switch"), [discriminant.node, caseNodes]);
					relocateTail(pluginState, switchCall, undefined, label && parent.parentPath.isStatement() ? parent.parentPath : parent, additionalConstantNames, resultIdentifier, exitIdentifier);
					processExpressions = false;
				}
			} else if (parent.isLabeledStatement()) {
				let resultIdentifier;
				if (!explicitExits.all && explicitExits.any) {
					resultIdentifier = path.scope.generateUidIdentifier("result");
					additionalConstantNames.push(resultIdentifier.name);
				}
				if (resultIdentifier || (breakIdentifiers && breakIdentifiers.length)) {
					const filteredBreakIdentifiers = breakIdentifiers ? breakIdentifiers.filter(id => id.name !== parent.node.label.name) : [];
					const fn = types.functionExpression(undefined, [], blockStatement(parent.node.body));
					const rewritten = rewriteAsyncNode(pluginState, parent, fn, additionalConstantNames, exitIdentifier);
					const exitCheck = buildBreakExitCheck(explicitExits.any ? exitIdentifier : undefined, filteredBreakIdentifiers);
					relocateTail(pluginState, types.callExpression(rewritten, []), undefined, parent, additionalConstantNames, resultIdentifier, exitCheck);
					processExpressions = false;
				}
			}
		}
		if (processExpressions) {
			if (awaitPath.isAwaitExpression()) {
				const originalArgument = awaitPath.node.argument;
				if (awaitPath.parentPath.isExpressionStatement()) {
					relocateTail(pluginState, originalArgument, undefined, awaitPath.parentPath, additionalConstantNames, undefined, undefined, types.booleanLiteral(false));
				} else {
					let parent = getStatementParent(awaitPath);
					const { declarations, awaitExpression, directExpression, reusingExisting, resultIdentifier } = extractDeclarations(awaitPath, originalArgument, additionalConstantNames);
					if (resultIdentifier) {
						additionalConstantNames.push(resultIdentifier.name);
					}
					if (declarations.length) {
						for (const { id } of declarations) {
							if (types.isIdentifier(id)) {
								additionalConstantNames.push(id.name);
							} else {
								throw awaitPath.buildCodeFrameError(`Expected an identifier declaration, but got a ${id.type}!`);
							}
						}
						if (parent.parentPath.isBlockStatement()) {
							const newPaths = parent.insertBefore(types.variableDeclaration("var", declarations));
							if (isNewBabel) {
								parent.scope.registerDeclaration(newPaths[0]);
							}
						} else {
							parent.replaceWith(blockStatement([types.variableDeclaration("var", declarations), parent.node]));
							if (parent.isBlockStatement()) {
								parent = parent.get("body")[1];
							}
						}
					}
					if (reusingExisting) {
						if (types.isVariableDeclaration(reusingExisting.parent) && reusingExisting.parent.declarations.length === 1) {
							reusingExisting.parentPath.replaceWith(types.emptyStatement());
						} else {
							reusingExisting.remove();
						}
					}
					relocateTail(pluginState, awaitExpression, parent.node, parent, additionalConstantNames, resultIdentifier, undefined, directExpression);
				}
			}
		}
	}

	const rewriteAsyncBlockVisitor: Visitor<RewriteAwaitState> & { ForAwaitStatement: any } = {
		Function: skipNode,
		AwaitExpression: rewriteAwaitPath,
		ForAwaitStatement: rewriteAwaitPath, // Support babel versions with separate ForAwaitStatement type
		ForOfStatement(path) {
			if ((path.node as any).await) { // Support babel versions with .await property on ForOfStatement type
				rewriteAwaitPath.call(this, path);
			}
		},
		CallExpression(path) {
			const callee = path.get("callee");
			if (callee.isIdentifier() && callee.node.name === "eval") {
				throw path.buildCodeFrameError("Calling eval from inside an async function is not supported!");
			}
		},
	};

	const unpromisifyVisitor: Visitor = {
		Function: skipNode,
		ReturnStatement(path) {
			const argument = path.get("argument");
			if (argument.node) {
				unpromisify(argument as NodePath<Expression>);
			}
		},
	};

	function unpromisify(path: NodePath<Expression>) {
		if (path.isNumericLiteral()) {
			return;
		}
		if (path.isBooleanLiteral()) {
			return;
		}
		if (path.isStringLiteral()) {
			return;
		}
		if (path.isNullLiteral()) {
			return;
		}
		if (path.isIdentifier() && path.node.name === "undefined") {
			return;
		}
		if (path.isArrayExpression()) {
			return;
		}
		if (path.isObjectExpression()) {
			return;
		}
		if (path.isBinaryExpression()) {
			return;
		}
		if (path.isUnaryExpression()) {
			return;
		}
		if (path.isUpdateExpression()) {
			return;
		}
		if (path.isCallExpression() && types.isIdentifier(path.node.callee) && path.node.callee._helperName) {
			switch (path.node.callee._helperName) {
				case "_await":
				case "_call": {
					const args = path.get("arguments");
					if (args.length > 2) {
						const firstArg = args[1];
						if (firstArg.isFunctionExpression()) {
							firstArg.traverse(unpromisifyVisitor);
						} else if (firstArg.isIdentifier()) {
							const binding = firstArg.scope.getBinding(firstArg.node.name);
							if (binding && binding.path.isVariableDeclarator()) {
								binding.path.get("init").traverse(unpromisifyVisitor);
							}
						}
					}
					break;
				}
				case "_awaitIgnored":
				case "_callIgnored":
					break;
			}
			return;
		}
		if (path.isLogicalExpression()) {
			unpromisify(path.get("left"));
			unpromisify(path.get("right"));
			return;
		}
		if (path.isConditionalExpression()) {
			unpromisify(path.get("consequent"));
			unpromisify(path.get("alternate"));
			return;
		}
		if (path.isSequenceExpression()) {
			const expressions = path.get("expressions");
			if (expressions.length) {
				unpromisify(expressions[expressions.length - 1]);
			}
			return;
		}
		path.replaceWith(logicalNot(logicalNot(path.node)));
	}

	function rewriteAsyncBlock(pluginState: PluginState, path: NodePath, additionalConstantNames: string[], exitIdentifier?: Identifier, unpromisify?: boolean) {
		path.traverse(rewriteAsyncBlockVisitor, { pluginState, path, additionalConstantNames, exitIdentifier });
		if (unpromisify) {
			// Rewrite values that potentially could be promises to booleans so that they aren't awaited
			path.traverse(unpromisifyVisitor);
		}
	}

	const getHelperDependenciesVisitor: Visitor<{ dependencies: string[] }> = {
		Identifier(path) {
			if (identifierSearchesScope(path) && path.hub.file.scope.getBinding(path.node.name) && this.dependencies.indexOf(path.node.name) === -1) {
				this.dependencies.push(path.node.name);
			}
		}
	};

	function getHelperDependencies(path: NodePath) {
		const state = { dependencies: [] };
		path.traverse(getHelperDependenciesVisitor, state);
		return state.dependencies;
	}

	const usesIdentifierVisitor: Visitor<{ name: string, found: boolean }> = {
		Identifier(path) {
			if (path.node.name === this.name) {
				this.found = true;
				path.stop();
			}
		}
	};

	function usesIdentifier(path: NodePath, name: string) {
		const state = { name, found: false };
		path.traverse(usesIdentifierVisitor, state);
		return state.found;
	}

	function helperReference(state: PluginState, path: NodePath, name: string): Identifier {
		const file = path.scope.hub.file;
		let result = file.declarations[name];
		if (!result) {
			result = file.declarations[name] = usesIdentifier(file.path, name) ? file.path.scope.generateUidIdentifier(name) : types.identifier(name);
			result._helperName = name;
			if (state.opts.externalHelpers) {
				file.path.unshiftContainer("body", types.importDeclaration([types.importSpecifier(result, types.identifier(name))], types.stringLiteral("babel-plugin-transform-async-to-promises/helpers")));
			} else {
				if (!helpers) {
					// Read helpers from ./helpers.js
					const newHelpers: { [name: string]: Helper } = {};
					const helperCode = readFileSync(join(__dirname, "helpers.js")).toString();
					const helperAst = require("babylon").parse(helperCode, { sourceType: "module" });
					transformFromAst(helperAst, helperCode, { babelrc: false, plugins: [{ visitor: {
						ExportNamedDeclaration(path) {
							const declaration = path.get("declaration");
							if (declaration.isFunctionDeclaration()) {
								newHelpers[declaration.node.id.name] = {
									value: declaration.node,
									dependencies: getHelperDependencies(declaration),
								};
								return;
							}
							if (declaration.isVariableDeclaration() && declaration.node.declarations.length === 1) {
								const declaratorId = declaration.node.declarations[0].id;
								if (types.isIdentifier(declaratorId)) {
									newHelpers[declaratorId.name] = {
										value: declaration.node,
										dependencies: getHelperDependencies(declaration),
									};
									return;
								}
							}
							throw path.buildCodeFrameError("Expected a named export from built-in helper!");
						}
					} as Visitor }] });
					helpers = newHelpers;
				}
				const helper = helpers[name];
				for (const dependency of helper.dependencies) {
					helperReference(state, path, dependency);
				}
				const value = (types as any).cloneDeep(helper.value) as typeof helper.value;
				let traversePath = file.path.get("body")[0];
				if (types.isVariableDeclaration(value) && traversePath.isVariableDeclaration()) {
					// TODO: Support variable declaration that references another variable declaration (this case doesn't exist yet in our helpers, but may in the future)
					traversePath.unshiftContainer("declarations", value.declarations[0]);
					traversePath = file.path.get("body")[0].get("declarations")[0];
				} else {
					file.path.unshiftContainer("body", value);
					traversePath = file.path.get("body")[0];
				}
				traversePath.traverse({
					Identifier(path) {
						const name = path.node.name;
						if (Object.hasOwnProperty.call(helpers, name)) {
							path.replaceWith(file.declarations[name]);
						}
					}
				} as Visitor);
			}
		}
		return result;
	}

	function isAsyncCallExpression(path: NodePath<CallExpression>): boolean {
		if (types.isIdentifier(path.node.callee)) {
			switch (path.node.callee._helperName) {
				case "_await":
				case "_call":
					return path.node.arguments.length < 3;
			}
		}
		return false;
	}

	function invokeTypeOfExpression(path: NodePath<Node | null>): "_invoke" | "_invokeIgnored" | void {
		if (path.isCallExpression() && types.isIdentifier(path.node.callee)) {
			const helperName = path.node.callee._helperName;
			switch (helperName) {
				case "_invoke":
				case "_invokeIgnored":
					return helperName;
			}
		}
	}

	function isAsyncFunctionExpression(path: NodePath): boolean {
		if (path.isFunction() && (path.node.async || path.node._async)) {
			return true;
		}
		if (path.isCallExpression() && types.isIdentifier(path.node.callee) && path.node.callee._helperName === "_async") {
			return true;
		}
		return false;
	}

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

	function isEvalOrArguments(path: NodePath): path is NodePath<Identifier> {
		return path.isIdentifier() && (path.node.name === "arguments" || path.node.name === "eval");
	}

	function identifierSearchesScope(path: NodePath<Identifier>): boolean {
		if (path.node.name === "undefined") {
			return false;
		}
		if (path.node._helperName) {
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
		return true;
	}

	function canThrow(this: { canThrow: boolean }): void {
		this.canThrow = true;
	}

	const checkForErrorsAndRewriteReturnsVisitor: Visitor<{ rewriteReturns: boolean, plugin: PluginState, canThrow: boolean }> = {
		Function: skipNode,
		ThrowStatement: canThrow,
		ForInStatement: canThrow,
		ForOfStatement: canThrow,
		WithStatement: canThrow,
		MemberExpression: canThrow,
		NewExpression: canThrow,
		TryStatement(path) {
			if (path.get("handler")) {
				path.get("block").skip();
			}
		},
		CallExpression(path) {
			if (!isAsyncCallExpression(path)) {
				if (invokeTypeOfExpression(path) === "_invoke") {
					const args = path.get("arguments");
					if (checkForErrorsAndRewriteReturns(args[0], this.plugin)) {
						this.canThrow = true;
					}
					if (args[1]) {
						args[1].traverse(checkForErrorsAndRewriteReturnsVisitor, this);
					}
				} else {
					const callee = path.get("callee");
					if (!isAsyncFunctionIdentifier(callee)) {
						this.canThrow = true;
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
			if (identifierSearchesScope(path) && !path.scope.getBinding(path.node.name)) {
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
				if (!argument.node || !((argument.isCallExpression() && isAsyncCallExpression(argument)) || invokeTypeOfExpression(argument) === "_invoke" || (argument.isCallExpression() && isAsyncFunctionIdentifier(argument.get("callee"))))) {
					argument.replaceWith(types.callExpression(helperReference(this.plugin, path, "_await"), argument.node ? [argument.node] : []));
				}
			}
		},
	};

	function checkForErrorsAndRewriteReturns(path: NodePath, plugin: PluginState, rewriteReturns: boolean = false): boolean {
		const state = { rewriteReturns, plugin, canThrow: false };
		path.traverse(checkForErrorsAndRewriteReturnsVisitor, state);
		return state.canThrow;
	}

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
						if (types.isIdentifier(argument.node.callee)) {
							const firstArgument = callArgs[0];
							if (types.isExpression(firstArgument)) {
								switch (argument.node.callee._helperName) {
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
		}
	}

	return {
		manipulateOptions(options: any, parserOptions: { plugins: string[] }) {
			parserOptions.plugins.push("asyncGenerators");
		},
		visitor: {
			FunctionDeclaration(path) {
				const node = path.node;
				if (node.async) {
					const expression = types.functionExpression(undefined, node.params, node.body, node.generator, node.async);
					const declarators = [types.variableDeclarator(node.id, expression)];
					let targetPath: NodePath<Node>;
					if (path.parentPath.isExportDeclaration()) {
						path.replaceWith(types.variableDeclaration("const", declarators));
						targetPath = path.parentPath;
					} else {
						path.replaceWith(types.variableDeclaration("var", declarators));
						targetPath = path;
					}
					for (const sibling of targetPath.getAllPrevSiblings().reverse()) {
						if (!sibling.isFunctionDeclaration()) {
							const newNode = targetPath.node;
							targetPath.remove();
							sibling.insertBefore(newNode);
							return;
						}
					}
				}
			},
			ArrowFunctionExpression(path) {
				const node = path.node;
				if (node.async) {
					rewriteThisExpressions(path, path.getFunctionParent());
					const body = types.isBlockStatement(path.node.body) ? path.node.body : blockStatement([types.returnStatement(path.node.body)]);
					path.replaceWith(types.functionExpression(undefined, node.params, body, false, node.async));
				}
			},
			FunctionExpression(path) {
				if (path.node.async) {
					rewriteThisArgumentsAndHoistFunctions(path, path);
					rewriteAsyncBlock(this, path, []);
					const inlineAsync = this.opts.inlineAsync;
					const bodyPath = path.get("body");
					const canThrow = checkForErrorsAndRewriteReturns(bodyPath, this, inlineAsync);
					if (inlineAsync && !pathsReturnOrThrowCurrentNodes(bodyPath).all) {
						path.node.body.body.push(types.returnStatement());
					}
					if (canThrow) {
						if (inlineAsync) {
							path.replaceWith(types.functionExpression(undefined, path.node.params, blockStatement(types.tryStatement(bodyPath.node, types.catchClause(types.identifier("e"), blockStatement([types.returnStatement(types.callExpression(types.memberExpression(types.identifier("Promise"), types.identifier("reject")), [types.identifier("e")]))]))))));
						} else {
							bodyPath.traverse(rewriteTopLevelReturnsVisitor);
							path.replaceWith(types.callExpression(helperReference(this, path, "_async"), [
								types.functionExpression(undefined, path.node.params, bodyPath.node)
							]));
						}
					} else {
						if (!inlineAsync) {
							checkForErrorsAndRewriteReturns(bodyPath, this, true)
						}
						path.replaceWith(types.functionExpression(undefined, path.node.params, bodyPath.node));
					}
					path.node._async = true;
				}
			},
			ClassMethod(path) {
				if (path.node.async) {
					if (path.node.kind === "method") {
						const body = path.get("body");
						body.replaceWith(types.blockStatement([types.returnStatement(types.callExpression(helperReference(this, path, "_call"), [types.functionExpression(undefined, [], body.node)]))]));
						const returnPath = body.get("body")[0];
						if (returnPath.isReturnStatement()) {
							const returnArgument = returnPath.get("argument");
							if (returnArgument.isCallExpression()) {
								const callArgument = returnArgument.get("arguments")[0]
								rewriteThisArgumentsAndHoistFunctions(callArgument, path);
								rewriteAsyncBlock(this, callArgument, []);
								path.replaceWith(types.classMethod(path.node.kind, path.node.key, path.node.params, path.node.body, path.node.computed, path.node.static));
							} else {
								throw returnArgument.buildCodeFrameError("Expected a call expression!");
							}
						} else {
							throw returnPath.buildCodeFrameError("Expected a return statement!");
						}
					}
				}
			},
			ObjectMethod(path) {
				if (path.node.async) {
					if (path.node.kind === "method") {
						path.replaceWith(types.objectProperty(path.node.key, types.functionExpression(undefined, path.node.params, path.node.body, path.node.generator, path.node.async), path.node.computed, false, path.node.decorators));
					}
				}
			},
		} as Visitor<PluginState>
	}
}

module.exports = exports.default;
