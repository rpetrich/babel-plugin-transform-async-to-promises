const errorOnIncompatible = true;
let helpers;

exports.default = function({ types, template, traverse }) {

	function wrapNodeInStatement(node) {
		return types.isStatement(node) ? types.blockStatement([node]) : types.expressionStatement(node);
	}

	const pathForNewNodeVisitor = {
		enter(path) {
			this.path = path;
			path.stop();
		}
	};

	function pathForNewNode(node, parentPath) {
		const state = {};
		traverse(wrapNodeInStatement(node), pathForNewNodeVisitor, parentPath.scope, state, parentPath);
		return state.path;
	}

	function pathsPassTest(matchingNodeTest, referenceOriginalNodes) {
		function visit(path, result, state) {
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
				const body = match(path.get("body"), state);
				const test = match(path.get("test"), state);
				result.any = result.any || body.any || test.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return result.all = ((body.all || test.all) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isWhileStatement()) {
				// TODO: Support detecting break/return statements
				const test = match(path.get("test"), state);
				const body = match(path.get("body"), state);
				result.any = result.any || test.any || body.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return result.all = ((test.all || (!!extractBooleanValue(body.node) && body.all)) && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isForXStatement()) {
				const right = match(path.get("right"), state);
				const body = match(path.get("body"), state);
				result.any = result.any || right.any || body.any;
				// result.paths = result.paths.concat(right.paths).concat(body.paths);
				return result.all = (right.all && !(state.breakingLabels.length || state.unnamedBreak));
			}
			if (path.isForStatement()) {
				const init = match(path.get("init"), state);
				const test = match(path.get("test"), state);
				const body = match(path.get("body"), state);
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
			enter(path) {
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
		function match(path, state) {
			const match = { all: false, any: false };
			// const match = { all: false, any: false, paths: [] };
			if (path && path.node) {
				if (typeof visit(path, match, state) === "undefined") {
					path.traverse(visitor, { match, state });
				}
			}
			return match;
		}
		return function(path) {
			return match(path, { breakingLabels: [], unnamedBreak: false });
		};
	}

	function pathsReachNodeTypes(matchingNodeTypes, referenceOriginalNodes) {
		return pathsPassTest(path => matchingNodeTypes.indexOf(path.node.type) !== -1, referenceOriginalNodes);
	}

	const pathsReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"], true);
	const pathsReturnOrThrowCurrentNodes = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"], false);
	const pathsBreak = pathsReachNodeTypes(["BreakStatement"], true);
	const pathsBreakReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement", "BreakStatement"], true);

	function isNonEmptyStatement(statement) {
		return !types.isEmptyStatement(statement);
	}

	function expressionInSingleReturnStatement(statements) {
		statements = statements.filter(isNonEmptyStatement);
		if (statements.length === 1) {
			if (types.isReturnStatement(statements[0])) {
				let argument = statements[0].argument;
				if (argument) {
					return argument;
				}
			}
		}
	}

	function identifiersInForToLengthStatement(statement) {
		// Match: for (var i = 0; i < array.length; i++)
		const init = statement.get("init");
		if (init.isVariableDeclaration() && init.node.declarations.length === 1) {
			const declaration = init.get("declarations.0");
			if (declaration.get("init").isNumericLiteral() && declaration.node.init.value === 0) {
				const i = declaration.node.id;
				const test = statement.get("test");
				if (test.isBinaryExpression() &&
					test.node.operator === "<" &&
					test.get("left").isIdentifier() &&
					test.node.left.name === i.name
				) {
					const right = test.get("right");
					if (right.isMemberExpression() &&
						!right.node.computed &&
						right.get("object").isIdentifier() &&
						right.get("property").isIdentifier() &&
						right.node.property.name === "length"
					) {
						const update = statement.get("update");
						if (update.isUpdateExpression() &&
							update.node.operator == "++" &&
							update.get("argument").isIdentifier() &&
							update.node.argument.name === i.name
						) {
							if (!statement.scope.getBinding(i.name).constantViolations.some(cv => cv !== update.get("argument"))) {
								return {
									i,
									array: test.node.right.object
								};
							}
						}
					}
				}
			}
		}
	}

	function extractForOwnBodyPath(path) {
		// Match: for (var key of obj) { if (Object.prototype.hasOwnProperty.call(obj, key)) { ... } }
		let left = path.get("left");
		if (left.isVariableDeclaration()) {
			left = left.get("declarations.0.id");
		}
		const right = path.get("right");
		// Check to see if we have a simple for of statement with two variables
		if (left.isIdentifier() && right.isIdentifier() && path.scope.getBinding(right.node.name).constant) {
			let body = path.get("body");
			while (body.isBlockStatement()) {
				const statements = body.get("body");
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
					if (args[0].isIdentifier() && args[0].node.name === right.node.name &&
						args[1].isIdentifier() && args[1].node.name === left.node.name)
					{
						// Check for .call(...)
						const callee = test.get("callee");
						if (callee.isMemberExpression() && callee.get("property").isIdentifier() && !callee.node.computed && callee.node.property.name === "call") {
							// Check for .hasOwnProperty
							let method = callee.get("object");
							if (method.isMemberExpression() && method.get("property").isIdentifier() && !method.node.computed && method.node.property.name == "hasOwnProperty") {
								let target = method.get("object");
								// Check for empty temporary object
								if (target.isObjectExpression() && target.node.properties.length === 0) {
									return body.get("consequent");
								}
								// Strip .prototype if present
								if (target.isMemberExpression() && target.get("property").isIdentifier() && !target.node.computed && target.node.property.name == "prototype") {
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

	function isPassthroughContinuation(continuation) {
		if (!continuation || !types.isFunctionExpression(continuation)) {
			return false;
		}
		if (continuation.params.length === 1) {
			const expression = expressionInSingleReturnStatement(continuation.body.body);
			if (expression) {
				const valueName = continuation.params[0].name;
				if (types.isIdentifier(expression) && expression.name === valueName) {
					return true;
				}
				if (types.isConditionalExpression(expression) && types.isIdentifier(expression.test) && types.isIdentifier(expression.consequent) && expression.consequent.name === valueName && types.isIdentifier(expression.alternate) && expression.alternate.name === valueName) {
					return true;
				}
			}
		}
		return false;
	}

	function awaitAndContinue(state, path, value, continuation, directExpression) {
		if (continuation && isPassthroughContinuation(continuation)) {
			continuation = null;
		}
		if (!continuation && directExpression && types.isBooleanLiteral(directExpression) && directExpression.value) {
			return value;
		}
		const useCallHelper = types.isCallExpression(value) && value.arguments.length === 0 && !types.isMemberExpression(value.callee);
		const args = [useCallHelper ? value.callee : value];
		const ignoreResult = types.isIdentifier(continuation) && continuation === path.hub.file.declarations["_empty"];
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
		if (helperName === "_continue" && args.length === 1) {
			return args[0];
		}
		return types.callExpression(helperReference(state, path, helperName), args);
	}

	function voidExpression(arg) {
		return types.unaryExpression("void", arg || types.numericLiteral(0));
	}

	function borrowTail(target) {
		let current = target;
		let dest = [];
		// while (current && current.node && !current.isFunction()) {
			if (current.inList) {
				const container = current.container;
				while (current.key + 1 < container.length) {
					dest.push(container[current.key + 1]);
					current.getSibling(current.key + 1).remove();
				}
			}
			current = current.parentPath;
		// }
		return dest;
	}

	function returnStatement(argument, originalNode) {
		const result = types.returnStatement(argument);
		result._skip = true;
		result._originalNode = originalNode;
		return result;
	}

	function removeUnnecessaryReturnStatements(blocks) {
		while (blocks.length) {
			const lastStatement = blocks[blocks.length - 1];
			if (types.isReturnStatement(lastStatement)) {
				if (lastStatement.argument === null) {
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
					let consequent = lastStatement.consequent;
					if (types.isBlockStatement(consequent)) {
						consequent = blockStatement(removeUnnecessaryReturnStatements(consequent.body));
					}
					let alternate = lastStatement.alternate;
					if (types.isBlockStatement(alternate)) {
						alternate = removeUnnecessaryReturnStatements(alternate.body);
						alternate = alternate.length ? blockStatement(alternate) : null;
					} else if (removeUnnecessaryReturnStatements([alternate]).length === 0) {
						alternate = null;
					}
					if (consequent !== lastStatement.consequent || alternate !== lastStatement.alternate) {
						blocks = blocks.slice(0, blocks.length - 1);
						blocks.push(types.ifStatement(lastStatement.test, consequent, alternate));
					}
				}
				break;
			}
		}
		return blocks;
	}

	function rewriteFunctionNode(state, parentPath, node, exitIdentifier, unpromisify) {
		const path = pathForNewNode(node, parentPath);
		rewriteFunctionBody(state, path, exitIdentifier, unpromisify);
		return path.node;
	}

	function allScopes(scope) {
		const result = [];
		while (scope) {
			result.push(scope);
			scope = scope.parent;
		}
		return result;
	}

	function hoistFunctionPath(state, path, referenceNode = path.node, name = "temp") {
		if (path.node.body.body.length === 0) {
			path.replaceWith(helperReference(state, path, "_empty"));
			return;
		}
		const scopes = [];
		const pathScopes = allScopes(path.scope.parent);
		path.get("body").traverse({
			Identifier(identifierPath) {
				if (identifierSearchesScope(identifierPath)) {
					const binding = identifierPath.parentPath.scope.getBinding(identifierPath.node.name);
					if (binding && binding.scope && pathScopes.includes(binding.scope)) {
						scopes.push(binding.scope);
					}
				}
			}
		});
		let scope;
		if (scopes.length) {
			scope = scopes[0];
			let ancestry = allScopes(scope);
			for (var i = 1; i < scopes.length; i++) {
				if (!ancestry.includes(scopes[i].scope)) {
					scope = scopes[i];
					ancestry = allScopes(scope);
				}
			}
		} else {
			scope = path.scope.getProgramParent();
		}
		if (!allScopes(scope).includes(path.scope.parent)) {
			const identifier = path.scope.generateUidIdentifierBasedOnNode(referenceNode, name);
			scope.push({ id: identifier, init: path.node });
			path.replaceWith(identifier);
		}
	}

	function relocateTail(state, awaitExpression, statementNode, target, temporary, exitIdentifier, exitCheck, directExpression) {
		const tail = borrowTail(target);
		let expression;
		let originalNode = target.node;
		const blocks = removeUnnecessaryReturnStatements((statementNode ? [statementNode] : []).concat(tail).filter(isNonEmptyStatement));
		if (blocks.length) {
			const moreBlocks = exitCheck ? removeUnnecessaryReturnStatements([types.ifStatement(exitCheck, returnStatement(temporary))].concat(blocks)) : blocks;
			const fn = types.functionExpression(null, temporary ? [temporary] : [], blockStatement(moreBlocks));
			const rewritten = rewriteFunctionNode(state, target, fn, exitIdentifier);
			expression = awaitAndContinue(state, target, awaitExpression, rewritten, directExpression);
			originalNode = types.blockStatement([target.node].concat(tail));
		} else if (pathsReturnOrThrow(target).any) {
			expression = awaitAndContinue(state, target, awaitExpression, null, directExpression);
		} else {
			expression = awaitAndContinue(state, target, awaitExpression, helperReference(state, target, "_empty"), directExpression);
		}
		target.replaceWith(returnStatement(expression, originalNode));
		const returnArg = target.get("argument");
		if (returnArg.isCallExpression() && returnArg.node.callee._helperName) {
			returnArg.traverse({
				Function(path) {
					path.skip();
					hoistFunctionPath(state, path);
				}
			});
		}
	}

	function catchHelper(state, path, blockStatement, catchContinuation) {
		let target;
		const expression = expressionInSingleReturnStatement(blockStatement.body);
		if (expression && types.isCallExpression(expression)) {
			switch (expression.arguments.length) {
				case 0:
					if (types.isIdentifier(expression.callee) || types.isFunctionExpression(expression.callee)) {
						target = expression.callee;
					}
					break;
				case 1:
					if (expression.callee._helperName === "_call" && (types.isIdentifier(expression.arguments[0]) || types.isFunctionExpression(expression.arguments[0]))) {
						target = expression.arguments[0];
					}
					break;
			}
		}
		const catchArgs = [target || types.functionExpression(null, [], blockStatement)];
		if (catchContinuation) {
			catchArgs.push(catchContinuation);
		}
		return types.callExpression(helperReference(state, path, catchArgs.length > 1 ? "_catch" : "_call"), [].concat(catchArgs));
	}

	const rewriteThisVisitor = {
		Function(path) {
			if (!path.isArrowFunctionExpression()) {
				path.skip();
			}
		},
		ThisExpression(path) {
			if (!this.thisIdentifier) {
				this.thisIdentifier = path.scope.generateUidIdentifier("this");
			}
			path.replaceWith(this.thisIdentifier);
		},
	};

	function rewriteThisExpressions(rewritePath, targetPath) {
		const state = {};
		rewritePath.traverse(rewriteThisVisitor, state);
		if (state.thisIdentifier) {
			targetPath.scope.push({ id: state.thisIdentifier, init: types.thisExpression() });
		}
	}

	const rewriteThisArgumentsAndHoistVisitor = {
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
					const binding = scope.getBinding(declaration.node.id.name);
					if (binding.referencePaths.some(referencePath => referencePath.willIMaybeExecuteBefore(path)) || (binding.referencePaths.length && path.getDeepestCommonAncestorFrom(binding.referencePaths.concat([path])) !== path.parentPath)) {
						this.targetPath.scope.push({ id: declaration.node.id });
						if (declaration.node.init) {
							path.insertBefore(types.expressionStatement(types.assignmentExpression("=", declaration.node.id, declaration.node.init)));
						}
						if ((path.parentPath.isForInStatement() || path.parentPath.isForOfStatement()) && path.parentPath.get("left") === path) {
							path.replaceWith(declaration.node.id);
						} else {
							declaration.remove();
						}
					}
				}
			}
		},
		FunctionDeclaration(path) {
			// Hoist function declarations
			const siblings = path.getAllPrevSiblings();
			if (siblings.some(sibling => !sibling.isFunctionDeclaration())) {
				const node = path.node;
				path.remove();
				siblings[0].insertBefore(node);
			}
		},
	};

	function rewriteThisArgumentsAndHoistFunctions(rewritePath, targetPath) {
		const state = { targetPath };
		rewritePath.traverse(rewriteThisArgumentsAndHoistVisitor, state);
		if (state.thisIdentifier) {
			targetPath.scope.push({ id: state.thisIdentifier, init: types.thisExpression() });
		}
		if (state.argumentsIdentifier) {
			targetPath.scope.push({ id: state.argumentsIdentifier, init: types.identifier("arguments") });
		}
	}

	function functionize(expression) {
		return types.functionExpression(null, [], blockStatement([returnStatement(expression)]));
	}

	function blockStatement(statementOrStatements) {
		if ("length" in statementOrStatements) {
			return types.blockStatement(statementOrStatements.filter(statement => !types.isEmptyStatement()));
		} else if (!types.isBlockStatement(statementOrStatements)) {
			return types.blockStatement([statementOrStatements]);
		} else {
			return statementOrStatements;
		}
	}

	function unwrapReturnCallWithEmptyArguments(node, scope) {
		if (types.isFunctionExpression(node) && node.body.body.length === 1 && types.isReturnStatement(node.body.body[0])) {
			const expression = node.body.body[0].argument;
			if (types.isCallExpression(expression) && expression.arguments.length === 1 && expression.callee._helperName === "_call" && types.isIdentifier(expression.arguments[0])) {
				const identifier = expression.arguments[0]
				const binding = scope.getBinding(identifier.name);
				if (binding && binding.constant) {
					return identifier;
				}
			}
		}
		return node;
	}

	function unwrapReturnCallWithPassthroughArgument(node, scope) {
		if (types.isFunctionExpression(node) && node.params.length >= 1 && node.body.body.length === 1 && types.isReturnStatement(node.body.body[0])) {
			const expression = node.body.body[0].argument;
			if (types.isCallExpression(expression) && expression.arguments.length === 1 && types.isIdentifier(expression.arguments[0]) && expression.arguments[0].name === node.params[0].name && types.isIdentifier(expression.callee)) {
				const binding = scope.getBinding(expression.callee.name);
				if (binding && binding.constant) {
					return expression.callee;
				}
			}
		}
		return node;
	}

	function isExpressionOfLiterals(path, literalName) {
		if (path.isIdentifier()) {
			if (path.node.name === "undefined") {
				return true;
			}
			if (path.node.name === literalName) {
				return true;
			}
			const binding = path.parentPath.scope.getBinding(path.node.name);
			if (binding) {
				return binding.constant;
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
			return path.get("elements").every(path => isExpressionOfLiterals(path, literalName));
		}
		if (path.isObjectExpression()) {
			return path.get("properties").every(path => {
				if (!path.isObjectProperty()) {
					return true;
				}
				if (isExpressionOfLiterals(path.get("value")) && (!path.node.computed || isExpressionOfLiterals(path.get("key"), literalName))) {
					return true;
				}
			});
		}
		if (path.isUnaryExpression()) {
			return isExpressionOfLiterals(path.get("argument"), literalName);
		}
		if (path.isLogicalExpression() || path.isBinaryExpression()) {
			return isExpressionOfLiterals(path.get("left"), literalName) && isExpressionOfLiterals(path.get("right"), literalName);
		}
		if (path.isConditionalExpression()) {
			return isExpressionOfLiterals(path.get("test"), literalName) && isExpressionOfLiterals(path.get("consequent"), literalName) && isExpressionOfLiterals(path.get("alternate"), literalName);
		}
		return false;
	}

	function generateIdentifierForPath(path) {
		return path.scope.generateUidIdentifierBasedOnNode(path.node, "temp");
	}

	function conditionalExpression(test, consequent, alternate) {
		while (types.isUnaryExpression(test) && test.operator === "!") {
			test = test.argument;
			const temp = consequent;
			consequent = alternate;
			alternate = consequent;
		}
		if (consequent.type === alternate.type && "value" in consequent && consequent.value === alternate.value && (types.isIdentifier(test) || types.isBooleanLiteral(test) || types.isNumericLiteral(test))) {
			return consequent;
		}
		return types.conditionalExpression(test, consequent, alternate);
	}

	function extractBooleanValue(node) {
		if (types.isBooleanLiteral(node)) {
			return node.value;
		}
		if (types.isUnaryExpression(node) && node.operator === "!") {
			const result = extractLooseBooleanValue(node.argument);
			return typeof result === "undefined" ? undefined : !result;
		}
	}

	function extractLooseBooleanValue(node) {
		if (types.isBooleanLiteral(node) || types.isNumericLiteral(node) || types.isNumericLiteral(node)) {
			return !!node.value;
		}
	}

	function logicalOr(left, right) {
		switch (extractBooleanValue(left)) {
			case true:
				return left;
			case false:
				return right;
			default:
				return types.logicalExpression("||", left, right);
		}
	}

	function logicalOrLoose(left, right) {
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

	function logicalAnd(left, right, extract = extractBooleanValue) {
		switch (extract(left)) {
			case true:
				return left;
			case false:
				return right;
			default:
				return types.logicalExpression("&&", left, right);
		}
	}

	function logicalNot(node) {
		const literalValue = extractBooleanValue(node);
		if (typeof literalValue !== "undefined") {
			return types.booleanLiteral(!literalValue);
		}
		if (types.isUnaryExpression(node) && node.operator === "!" && types.isUnaryExpression(node.argument) && node.argument.operator === "!") {
			return node.argument;
		}
		return types.unaryExpression("!", node);
	}

	function findDeclarationToReuse(path) {
		for (;;) {
			const parent = path.parentPath;
			if (parent.isVariableDeclarator()) {
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

	function extractDeclarations(awaitPath, awaitExpression) {
		const originalAwaitPath = awaitPath;
		const reusingExisting = findDeclarationToReuse(awaitPath);//originalAwaitPath.parentPath.isVariableDeclarator() && originalAwaitPath.parentPath;
		let resultIdentifier = reusingExisting ? reusingExisting.node.id : generateIdentifierForPath(originalAwaitPath.get("argument"));
		let declarations = [];
		originalAwaitPath.replaceWith(resultIdentifier);
		let directExpression = types.booleanLiteral(false);
		do {
			const parent = awaitPath.parentPath;
			if (parent.isVariableDeclarator()) {
				const beforeDeclarations = [];
				while (parent.key !== 0) {
					const sibling = parent.getSibling(0);
					beforeDeclarations.push(sibling.node);
					sibling.remove();
				}
				if (beforeDeclarations.length) {
					declarations = beforeDeclarations.concat(declarations);
				}
			} else if (parent.isLogicalExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isExpressionOfLiterals(left)) {
						const leftIdentifier = generateIdentifierForPath(left);
						declarations = declarations.map(declaration => types.variableDeclarator(declaration.id, logicalAnd(parent.node.operator === "||" ? logicalNot(leftIdentifier) : leftIdentifier, declaration.init)));
						declarations.unshift(types.variableDeclarator(leftIdentifier, left.node));
						left.replaceWith(leftIdentifier);
					}
					const isOr = parent.node.operator === "||";
					awaitExpression = (isOr ? logicalOr : logicalAnd)(left.node, awaitExpression);
					directExpression = logicalOrLoose(isOr ? left.node : logicalNot(left.node), directExpression, extractLooseBooleanValue);
					if (awaitPath == originalAwaitPath) {
						parent.replaceWith(resultIdentifier);
						awaitPath = parent;
						continue;
					}
				}
			} else if (parent.isBinaryExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isExpressionOfLiterals(left)) {
						const leftIdentifier = generateIdentifierForPath(left);
						declarations.unshift(types.variableDeclarator(leftIdentifier, left.node));
						left.replaceWith(leftIdentifier);
					}
				}
			} else if (parent.isSequenceExpression()) {
				const children = parent.get("expressions");
				const position = children.indexOf(awaitPath);
				for (var i = 0; i < position; i++) {
					const expression = children[i];
					if (!isExpressionOfLiterals(expression)) {
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
					let testIdentifier;
					const isBoth = consequent === awaitPath && otherAwaitPath === alternate;
					if (!(isBoth && awaitPath === originalAwaitPath) && !isExpressionOfLiterals(test)) {
						testIdentifier = generateIdentifierForPath(test);
					}
					declarations = declarations.map(declaration => types.variableDeclarator(declaration.id, (consequent === awaitPath ? logicalAnd : logicalOr)(testIdentifier || testNode, declaration.init)));
					if (testIdentifier) {
						declarations.unshift(types.variableDeclarator(testIdentifier, testNode));
						test.replaceWith(testIdentifier);
						testNode = testIdentifier;
					}
					if (isBoth) {
						awaitExpression = conditionalExpression(testNode, awaitExpression, alternate.node.argument);
						alternate.replaceWith(resultIdentifier);
						parent.replaceWith(resultIdentifier);
					} else {
						directExpression = logicalOrLoose(consequent !== awaitPath ? testNode : logicalNot(testNode), directExpression, extractLooseBooleanValue);
						if (otherAwaitPath) {
							awaitExpression = consequent !== awaitPath ? conditionalExpression(testNode, types.numericLiteral(0), awaitExpression) : conditionalExpression(testNode, awaitExpression, types.numericLiteral(0));
						} else {
							awaitExpression = consequent !== awaitPath ? conditionalExpression(testNode, other.node, awaitExpression) : conditionalExpression(testNode, awaitExpression, other.node);
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
						if (arg === awaitPath) {
							break;
						}
						if (!isExpressionOfLiterals(arg)) {
							const argIdentifier = generateIdentifierForPath(arg);
							declarations.unshift(types.variableDeclarator(argIdentifier, arg.node));
							arg.replaceWith(argIdentifier);
						}
					}
					if (!isExpressionOfLiterals(callee)) {
						if (callee.isMemberExpression()) {
							const object = callee.get("object");
							if (!isExpressionOfLiterals(object)) {
								const objectIdentifier = generateIdentifierForPath(object);
								declarations.unshift(types.variableDeclarator(objectIdentifier, object.node));
								object.replaceWith(objectIdentifier);
							}
							const property = callee.get("property");
							const calleeIdentifier = generateIdentifierForPath(property);
							const calleeNode = callee.node;
							parent.replaceWith(types.callExpression(types.memberExpression(calleeIdentifier, types.identifier("call")), [object.node].concat(parent.node.arguments)));
							declarations.unshift(types.variableDeclarator(calleeIdentifier, calleeNode));
						} else if (!callee.isIdentifier() || !(!callee.node.name._helperName || (awaitPath.scope.getBinding(callee.node.name) || {}).constant)) {
							const calleeIdentifier = generateIdentifierForPath(callee);
							const calleeNode = callee.node;
							callee.replaceWith(calleeIdentifier);
							declarations.unshift(types.variableDeclarator(calleeIdentifier, calleeNode));
						}
					}
				}
			} else if (parent.isArrayExpression()) {
				for (const element of parent.get("elements")) {
					if (element === awaitPath) {
						break;
					}
					if (!isExpressionOfLiterals(element)) {
						const elementIdentifier = generateIdentifierForPath(element);
						declarations.unshift(types.variableDeclarator(elementIdentifier, element.node));
						element.replaceWith(elementIdentifier);
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
							if (!isExpressionOfLiterals(propKey)) {
								const keyIdentifier = generateIdentifierForPath(propKey);
								declarations.unshift(types.variableDeclarator(keyIdentifier, propKey.node));
								propKey.replaceWith(keyIdentifier);
							}
						}
						const propValue = prop.get("value");
						if (!isExpressionOfLiterals(propValue)) {
							const propIdentifier = generateIdentifierForPath(propValue);
							declarations.unshift(types.variableDeclarator(propIdentifier, propValue.node));
							propValue.replaceWith(propIdentifier);
						}
					}
				}
			}
			awaitPath = parent;
		} while (!awaitPath.isStatement());
		return { declarations, awaitExpression, directExpression, reusingExisting, resultIdentifier };
	}

	function skipNode(path) {
		path.skip();
	}

	const awaitPathVisitor = {
		Function: skipNode,
		AwaitExpression(path) {
			this.result = path;
			path.stop();
		},
	};

	function findAwaitPath(path) {
		let state = { result: path.isAwaitExpression() ? path : null };
		path.traverse(awaitPathVisitor, state);
		return state.result;
	}

	function buildBreakExitCheck(exitIdentifier, breakIdentifiers) {
		let expressions = (breakIdentifiers.map(identifier => identifier.identifier) || []).concat(exitIdentifier ? [exitIdentifier] : []);
		if (expressions.length) {
			return expressions.reduce((accumulator, identifier) => logicalOrLoose(accumulator, identifier));
		}
	}

	function pushMissing(destination, source) {
		for (var value of source) {
			var index = destination.indexOf(value);
			if (index < 0) {
				destination.push(value);
			}
		}
	}

	const replaceReturnsAndBreaksVisitor = {
		Function: skipNode,
		ReturnStatement(path) {
			if (!path.node._skip && this.exitIdentifier) {
				if (extractLooseBooleanValue(path.node.argument) === true) {
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
			const replace = returnStatement(null, path.node);
			const index = path.node.label ? this.breakIdentifiers.findIndex(breakIdentifier => breakIdentifier.name === path.node.label.name) : 0;
			if (index !== -1 && this.breakIdentifiers.length) {
				const used = this.breakIdentifiers.slice(0, index + 1);
				if (used.length) {
					pushMissing(this.usedIdentifiers, used);
					const expression = used.reduce((expression, breakIdentifier) => types.assignmentExpression("=", breakIdentifier.identifier, expression), types.numericLiteral(1));
					path.replaceWithMultiple([
						types.expressionStatement(expression),
						replace,
					]);
					return;
				}
			}
			path.replaceWith(replace);
		},
		ContinueStatement(path) {
			const replace = returnStatement(null, path.node);
			const index = path.node.label ? this.breakIdentifiers.findIndex(breakIdentifier => breakIdentifier.name === path.node.label.name) : 0;
			if (index !== -1 && this.breakIdentifiers.length) {
				const used = this.breakIdentifiers.slice(0, index);
				if (used.length) {
					pushMissing(this.usedIdentifiers, used);
					const expression = used.reduce((expression, breakIdentifier) => types.assignmentExpression("=", breakIdentifier.identifier, expression), types.numericLiteral(1));
					path.replaceWithMultiple([
						types.expressionStatement(expression),
						replace,
					]);
					return;
				}
			}
			path.replaceWith(replace);
		},
	};

	function replaceReturnsAndBreaks(path, exitIdentifier) {
		const state = { exitIdentifier, breakIdentifiers: breakContinueStackForPath(path), usedIdentifiers: [] };
		path.traverse(replaceReturnsAndBreaksVisitor, state);
		for (const identifier of state.usedIdentifiers) {
			if (!identifier.path.parentPath.scope.getBinding(identifier.identifier.name)) {
				identifier.path.parentPath.scope.push({ id: identifier.identifier });
			}
		}
		return state.usedIdentifiers;
	}

	function breakIdentifierForPath(path) {
		let result = path.node._breakIdentifier;
		if (!result) {
			result = path.node._breakIdentifier = path.scope.generateUidIdentifier(path.parentPath.isLabeledStatement() ? path.parent.label.name + "Interrupt" : "interrupt");
		}
		return result;
	}

	const simpleBreakOrContinueReferencesVisitor = {
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

	function simpleBreakOrContinueReferences(path) {
		const state = { references: [] };
		path.traverse(simpleBreakOrContinueReferencesVisitor, state);
		return state.references;
	}

	const namedLabelReferencesVisitor = {
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

	function namedLabelReferences(labelPath, targetPath) {
		const state = { name: labelPath.node.label.name, breaks: [], continues: [] };
		targetPath.traverse(namedLabelReferencesVisitor, state);
		return state;
	}

	function breakContinueStackForPath(path) {
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

	function rewriteAwaitPath(awaitPath) {
		const state = this;
		const pluginState = state.pluginState;
		const path = state.path;
		let processExpressions = !awaitPath.isForAwaitStatement();
		if (!processExpressions) {
			awaitPath = awaitPath.get("left");
		}
		const relocatedBlocks = [];
		const originalAwaitPath = awaitPath;
		const originalExpression = awaitPath.node;
		const node = awaitPath.node;
		let expressionToAwait = node.argument;
		do {
			let parent = awaitPath.parentPath;
			if (!relocatedBlocks.find(block => block.path === parent)) {
				const explicitExits = pathsReturnOrThrow(parent);
				if (parent.isIfStatement()) {
					if (awaitPath !== parent.get("test")) {
						if (!explicitExits.all && explicitExits.any && !state.exitIdentifier) {
							state.exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
							path.scope.push({ id: state.exitIdentifier });
						}
						replaceReturnsAndBreaks(parent.get("consequent"), state.exitIdentifier);
						replaceReturnsAndBreaks(parent.get("alternate"), state.exitIdentifier);
						relocatedBlocks.push({
							relocate() {
								let resultIdentifier = null;
								if (!explicitExits.all && explicitExits.any) {
									resultIdentifier = path.scope.generateUidIdentifier("result");
								}
								if (!explicitExits.all) {
									const fn = types.functionExpression(null, [], blockStatement([parent.node]));
									const rewritten = rewriteFunctionNode(pluginState, parent, fn, state.exitIdentifier);
									relocateTail(pluginState, types.callExpression(rewritten, []), null, parent, resultIdentifier, state.exitIdentifier, explicitExits.any ? state.exitIdentifier : undefined);
								}
							},
							path: parent,
						});
					}
				} else if (parent.isTryStatement()) {
					relocatedBlocks.push({
						relocate() {
							const temporary = explicitExits.all ? path.scope.generateUidIdentifier("result") : null;
							const success = explicitExits.all ? returnStatement(temporary) : null;
							let finallyFunction;
							let finallyName;
							if (parent.node.finalizer) {
								let finallyArgs = [];
								let finallyBody = parent.node.finalizer.body;
								if (!pathsReturnOrThrow(parent.get("finalizer")).all) {
									const resultIdentifier = path.scope.generateUidIdentifier("result");
									const wasThrownIdentifier = path.scope.generateUidIdentifier("wasThrown");
									finallyArgs = [wasThrownIdentifier, resultIdentifier];
									finallyBody = finallyBody.concat(returnStatement(types.callExpression(helperReference(pluginState, parent, "_rethrow"), [wasThrownIdentifier, resultIdentifier])));
									finallyName = "_finallyRethrows";
								} else {
									finallyName = "_finally";
								}
								finallyFunction = types.functionExpression(null, finallyArgs, blockStatement(finallyBody));
							}
							let catchExpression;
							let rewriteCatch;
							if (parent.node.handler) {
								const catchClause = parent.node.handler;
								rewriteCatch = catchClause.body.body.length;
								catchExpression = rewriteCatch ? types.functionExpression(null, [catchClause.param], catchClause.body) : helperReference(pluginState, parent, "_empty");
							}
							const evalBlock = catchHelper(pluginState, parent, parent.node.block, catchExpression);
							relocateTail(pluginState, evalBlock, success, parent, temporary, state.exitIdentifier);
							if (finallyFunction && finallyName) {
								parent.get("argument").replaceWith(types.callExpression(helperReference(pluginState, parent, finallyName), [parent.node.argument, finallyFunction]));
							}
						},
						path: parent,
					});
				} else if (parent.isForStatement() || parent.isWhileStatement() || parent.isDoWhileStatement() || parent.isForInStatement() || parent.isForOfStatement() || parent.isForAwaitStatement()) {
					const breaks = pathsBreak(parent);
					const label = parent.parentPath.isLabeledStatement() ? parent.parent.label.name : null;
					if (!state.exitIdentifier && explicitExits.any && !explicitExits.all) {
						path.scope.push({ id: state.exitIdentifier = awaitPath.scope.generateUidIdentifier("exit") });
					}
					const breakIdentifiers = replaceReturnsAndBreaks(parent.get("body"), state.exitIdentifier);
					const isForIn = parent.isForInStatement();
					const forOwnBodyPath = isForIn && extractForOwnBodyPath(parent);
					const isForOf = parent.isForOfStatement();
					const isForAwait = parent.isForAwaitStatement();
					if (isForIn || isForOf || isForAwait) {
						const right = parent.get("right");
						if (awaitPath !== right) {
							relocatedBlocks.push({
								relocate() {
									const left = parent.get("left");
									const loopIdentifier = left.isVariableDeclaration() ? left.node.declarations[0].id : left.node;
									const params = [right.node, types.functionExpression(null, [loopIdentifier], blockStatement((forOwnBodyPath || parent.get("body")).node))];
									const exitCheck = buildBreakExitCheck(state.exitIdentifier, breakIdentifiers);
									if (exitCheck) {
										params.push(types.functionExpression(null, [], types.blockStatement([returnStatement(exitCheck)])));
									}
									const loopCall = types.callExpression(helperReference(pluginState, parent, isForIn ? forOwnBodyPath ? "_forOwn" : "_forIn" : isForAwait ? "_forAwaitOf" : "_forOf"), params);
									let resultIdentifier = null;
									if (explicitExits.any) {
										resultIdentifier = path.scope.generateUidIdentifier("result");
									}
									relocateTail(pluginState, loopCall, null, label ? parent.parentPath : parent, resultIdentifier, state.exitIdentifier, explicitExits.any ? exitCheck : undefined);
								},
								path: parent,
							})
						}
					} else {
						const forToIdentifiers = identifiersInForToLengthStatement(parent);
						let testExpression = parent.node.test;
						const breakExitCheck = buildBreakExitCheck(state.exitIdentifier, breakIdentifiers);
						if (breakExitCheck) {
							const inverted = logicalNot(breakExitCheck);
							testExpression = testExpression && (!types.isBooleanLiteral(testExpression) || !testExpression.value) ? logicalAnd(inverted, testExpression, extractLooseBooleanValue) : inverted;
						}
						if (testExpression) {
							const testPath = parent.get("test");
							testPath.replaceWith(rewriteFunctionNode(pluginState, parent, functionize(testExpression), state.exitIdentifier, true));
						}
						const update = parent.get("update");
						if (update.node) {
							update.replaceWith(functionize(update.node));
						}
						relocatedBlocks.push({
							relocate() {
								const isDoWhile = parent.isDoWhileStatement();
								if (!breaks.any && !explicitExits.any && forToIdentifiers && !isDoWhile) {
									const loopCall = types.callExpression(helperReference(pluginState, parent, "_forTo"), [forToIdentifiers.array, types.functionExpression(null, [forToIdentifiers.i], blockStatement(parent.node.body))])
									relocateTail(pluginState, loopCall, null, parent, undefined, state.exitIdentifier, !explicitExits.all && explicitExits.any ? state.exitIdentifier : undefined);
								} else {
									const init = parent.get("init");
									if (init.node) {
										parent.insertBefore(init.node);
									}
									const forIdentifier = path.scope.generateUidIdentifier("for");
									const bodyFunction = types.functionExpression(null, [], blockStatement(parent.node.body));
									const testFunction = unwrapReturnCallWithEmptyArguments(parent.get("test").node || voidExpression(), path.scope);
									const updateFunction = unwrapReturnCallWithEmptyArguments(parent.get("update").node || voidExpression(), path.scope);
									const loopCall = isDoWhile ? types.callExpression(helperReference(pluginState, parent, "_do"), [bodyFunction, testFunction]) : types.callExpression(helperReference(pluginState, parent, "_for"), [testFunction, updateFunction, bodyFunction]);
									let resultIdentifier = null;
									if (explicitExits.any) {
										resultIdentifier = path.scope.generateUidIdentifier("result");
									}
									relocateTail(pluginState, loopCall, null, parent, resultIdentifier, state.exitIdentifier, !explicitExits.all && explicitExits.any ? state.exitIdentifier : undefined);
								}
							},
							path: parent,
						});
					}
				} else if (parent.isSwitchStatement()) {
					// TODO: Support more complex switch pluginStatements
					const label = parent.parentPath.isLabeledStatement() ? parent.parent.label.name : null;
					const discriminant = parent.get("discriminant");
					const testPaths = parent.get("cases").map(casePath => casePath.get("test"));
					if (awaitPath !== discriminant && !(explicitExits.all && !testPaths.some(testPath => findAwaitPath(testPath)))) {
						if (!explicitExits.all && explicitExits.any && !state.exitIdentifier) {
							state.exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
							path.scope.push({ id: state.exitIdentifier });
						}
						let defaultIndex;
						testPaths.forEach((testPath, i) => {
							if (testPath.node) {
								testPath.replaceWith(rewriteFunctionNode(pluginState, parent, functionize(testPath.node), state.exitIdentifier));
							} else {
								defaultIndex = i;
							}
						});
						const cases = parent.get("cases").map(casePath => ({
							test: casePath.node.test,
							consequent: casePath.node.consequent,
							caseExits: pathsReturnOrThrow(casePath),
							caseBreaks: pathsBreak(casePath),
							breakIdentifiers: replaceReturnsAndBreaks(casePath, state.exitIdentifier),
						}));
						relocatedBlocks.push({
							relocate() {
								let resultIdentifier;
								if (!explicitExits.all && explicitExits.any) {
									resultIdentifier = path.scope.generateUidIdentifier("result");
								}
								const caseNodes = types.arrayExpression(cases.map(caseItem => {
									const args = [];
									if (caseItem.test) {
										args.push(caseItem.test);
									} else if (caseItem.consequent.length) {
										args.push(voidExpression());
									}
									if (caseItem.consequent.length) {
										const useBreakIdentifier = !caseItem.caseBreaks.all && caseItem.caseBreaks.any;
										args.push(types.functionExpression(null, [], blockStatement(removeUnnecessaryReturnStatements(caseItem.consequent))));
										if (!caseItem.caseExits.any && !caseItem.caseBreaks.any) {
											args.push(helperReference(pluginState, parent, "_empty"));
										} else if (!(caseItem.caseExits.all || caseItem.caseBreaks.all)) {
											const breakCheck = buildBreakExitCheck(caseItem.caseExits.any ? state.exitIdentifier : null, caseItem.breakIdentifiers);
											if (breakCheck) {
												args.push(types.functionExpression(null, [], types.blockStatement([returnStatement(breakCheck)])));
											}
										}
									}
									return types.arrayExpression(args);
								}));
								const switchCall = types.callExpression(helperReference(pluginState, parent, "_switch"), [discriminant.node, caseNodes]);
								relocateTail(pluginState, switchCall, null, label ? parent.parentPath : parent, resultIdentifier, state.exitIdentifier, !explicitExits.all && explicitExits.any ? state.exitIdentifier : undefined);
							},
							path: parent,
						});
					}
				} else if (parent.isLabeledStatement()) {
					let resultIdentifier;
					if (!state.exitIdentifier && explicitExits.any && !explicitExits.all) {
						path.scope.push({ id: state.exitIdentifier = awaitPath.scope.generateUidIdentifier("exit") });
					}
					if (!explicitExits.all && explicitExits.any) {
						resultIdentifier = path.scope.generateUidIdentifier("result");
					}
					const breakIdentifiers = replaceReturnsAndBreaks(parent.get("body"), state.exitIdentifier).filter(id => id.name !== parent.node.label.name);
					relocatedBlocks.push({
						relocate() {
							if (resultIdentifier || breakIdentifiers.length) {
								const fn = types.functionExpression(null, [], blockStatement(parent.node.body));
								const rewritten = rewriteFunctionNode(pluginState, parent, fn, state.exitIdentifier);
								const exitCheck = buildBreakExitCheck(explicitExits.any ? state.exitIdentifier : null, breakIdentifiers);
								relocateTail(pluginState, types.callExpression(rewritten, []), null, parent, resultIdentifier, state.exitIdentifier, exitCheck);
							}
						},
						path: parent,
					});
				}
			}
			if (processExpressions && (parent.isStatement() || (parent.isSwitchCase() && awaitPath.node != parent.node.test))) {
				if (!awaitPath.isFunction() && !awaitPath.isSwitchCase()) {
					const originalArgument = originalAwaitPath.node.argument;
					if (originalAwaitPath.parentPath.isExpressionStatement()) {
						originalAwaitPath.replaceWith(voidExpression());
						relocatedBlocks.push({
							relocate() {
								relocateTail(pluginState, originalArgument, null, parent, null, state.exitIdentifier, undefined, types.booleanLiteral(false));
							},
							path: parent,
						});
					} else {
						const { declarations, awaitExpression, directExpression, reusingExisting, resultIdentifier } = extractDeclarations(originalAwaitPath, originalArgument);
						if (declarations.length) {
							if (!parent.parentPath.isBlockStatement()) {
								parent.replaceWithMultiple([types.variableDeclaration("var", declarations), parent.node]);
								parent = parent.get("body.1");
							} else {
								parent.insertBefore(types.variableDeclaration("var", declarations));
							}
						}
						relocatedBlocks.push({
							relocate() {
								if (reusingExisting) {
									if (reusingExisting.parent.declarations.length === 1) {
										reusingExisting.parentPath.replaceWith(types.emptyStatement());
									} else {
										reusingExisting.remove();
									}
								}
								relocateTail(pluginState, awaitExpression, parent.node, parent, resultIdentifier, state.exitIdentifier, undefined, directExpression);
							},
							path: parent,
						});
					}
				}
				processExpressions = false;
			}
			awaitPath = parent;
		} while (awaitPath !== path);
		for (const block of relocatedBlocks) {
			block.relocate();
		}
	}

	const rewriteFunctionBodyVisitor = {
		Function: skipNode,
		AwaitExpression: rewriteAwaitPath,
		ForAwaitStatement: rewriteAwaitPath,
		CallExpression(path) {
			const callee = path.get("callee");
			if (callee.isIdentifier() && callee.node.name === "eval") {
				throw path.buildCodeFrameError("Calling eval from inside an async function is not supported!");
			}
		},
	};

	const unpromisifyVisitor = {
		Function: skipNode,
		ReturnStatement(path) {
			if (path.node.argument) {
				unpromisify(path.get("argument"));
			}
		},
	};

	function unpromisify(path) {
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
		if (path.isObjectExpression() && !path.get("properties").some(property => property.computed || property.key.name === "then")) {
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
		if (path.isCallExpression() && path.node.callee._helperName) {
			switch (path.node.callee._helperName) {
				case "_await":
				case "_call": {
					const args = path.get("arguments");
					if (args.length > 2 && args[1].isFunctionExpression()) {
						args[1].traverse(unpromisifyVisitor);
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

	function rewriteFunctionBody(pluginState, path, exitIdentifier, unpromisify) {
		path.traverse(rewriteFunctionBodyVisitor, { pluginState, path, exitIdentifier });
		if (unpromisify) {
			// Rewrite values that potentially could be promises to booleans so that they aren't awaited
			path.traverse(unpromisifyVisitor);
		}
	}

	const getHelperDependenciesVisitor = {
		Identifier(path) {
			if (identifierSearchesScope(path) && path.hub.file.scope.getBinding(path.node.name) && this.dependencies.indexOf(path.node.name) === -1) {
				this.dependencies.push(path.node.name);
			}
		}
	};

	function getHelperDependencies(path) {
		const state = { dependencies: [] };
		path.traverse(getHelperDependenciesVisitor, state);
		return state.dependencies;
	}

	const usesIdentifierVisitor = {
		Identifier(path) {
			if (path.node.name === this.name) {
				this.found = true;
				path.stop();
			}
		}
	};

	function usesIdentifier(path, name) {
		const state = { name, found: false };
		path.traverse(usesIdentifierVisitor, state);
		return state.found;
	}

	function helperReference(state, path, name) {
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
					const newHelpers = {};
					const helperCode = require("fs").readFileSync(require("path").join(__dirname, "helpers.js")).toString();
					const helperAst = require("babylon").parse(helperCode, { sourceType: "module" });
					require("babel-core").transformFromAst(helperAst, helperCode, { babelrc: false, plugins: [{ visitor: {
						ExportNamedDeclaration(path) {
							const declaration = path.get("declaration");
							if (declaration.isFunctionDeclaration()) {
								newHelpers[declaration.node.id.name] = {
									value: declaration.node,
									dependencies: getHelperDependencies(declaration),
								};
							} else if (declaration.isVariableDeclaration()) {
								newHelpers[declaration.node.declarations[0].id.name] = {
									value: declaration.node,
									dependencies: getHelperDependencies(declaration),
								};
							}
						}
					} }] });
					helpers = newHelpers;
				}
				const helper = helpers[name];
				for (const dependency of helper.dependencies) {
					helperReference(state, path, dependency);
				}
				const value = types.cloneDeep(helper.value);
				let traversePath;
				if (types.isVariableDeclaration(value) && file.path.get("body.0").isVariableDeclaration()) {
					// TODO: Support variable declaration that references another variable declaration (this case doesn't exist yet in our helpers, but may in the future)
					file.path.get("body.0").unshiftContainer("declarations", value.declarations[0]);
					traversePath = file.path.get("body.0.declarations.0");
				} else {
					file.path.unshiftContainer("body", value);
					traversePath = file.path.get("body.0");
				}
				traversePath.traverse({
					Identifier(path) {
						const name = path.node.name;
						if (Object.hasOwnProperty.call(helpers, name)) {
							path.replaceWith(file.declarations[name]);
						}
					}
				});
			}
		}
		return result;
	}

	function isAsyncCallExpression(path) {
		if (!path.isCallExpression()) {
			return false;
		}
		switch (path.node.callee._helperName) {
			case "_await":
			case "_call":
				return path.node.arguments.length < 3;
			default:
				return false;
		}		
	}

	function isInvokeCallExpression(path) {
		if (!path.isCallExpression()) {
			return false;
		}
		switch (path.node.callee._helperName) {
			case "_invoke":
				return types.isFunctionExpression(path.node.arguments[0]) && types.isFunctionExpression(path.node.arguments[1]);
			default:
				return false;
		}
	}

	function isAsyncFunctionExpression(path) {
		if (path.isFunction() && (path.node.async || path.node._async)) {
			return true;
		}
		if (path.isCallExpression() && path.node.callee._helperName === "_async") {
			return true;
		}
		return false;
	}

	function isAsyncFunctionIdentifier(path) {
		if (path.isIdentifier()) {
			const binding = path.scope.getBinding(path.node.name);
			if (binding && binding.constant) {
				const bindingPath = binding.path;
				if (bindingPath.isVariableDeclarator()) {
					const initPath = bindingPath.get("init");
					if (initPath && isAsyncFunctionExpression(initPath)) {
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

	function isEvalOrArguments(path) {
		return path.isIdentifier() && (path.name === "arguments" || path.name === "eval");
	}

	function identifierSearchesScope(path) {
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

	function canThrow() {
		this.canThrow = true;
	}

	const checkForErrorsAndRewriteReturnsVisitor = {
		Function: skipNode,
		ThrowStatement: canThrow,
		ForInStatement: canThrow,
		ForOfStatement: canThrow,
		WithStatement: canThrow,
		MemberExpression: canThrow,
		NewExpression: canThrow,
		TryStatement(path) {
			if (path.get("handler")) {
				path.get("body").skip();
			}
		},
		CallExpression(path) {
			if (!isAsyncCallExpression(path)) {
				if (isInvokeCallExpression(path)) {
					const args = path.get("arguments");
					if (checkForErrorsAndRewriteReturns(args[0])) {
						this.canThrow = true;
					}
					args[1].traverse(checkForErrorsAndRewriteReturnsVisitor, this);
				} else {
					const callee = path.get("callee");
					if (!isAsyncFunctionIdentifier(callee)) {
						this.canThrow = true;
					}
				}
			}
		},
		UnaryExpression(path) {
			switch (path.node.operator) {
				case "++":
				case "--": {
					if (isEvalOrArguments(path.get("argument"))) {
						this.canThrow = true;
					}
					break;
				}
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
				if (!argument.node || !(isAsyncCallExpression(argument) || isInvokeCallExpression(argument) || (argument.isCallExpression() && isAsyncFunctionIdentifier(argument.get("callee"))))) {
					argument.replaceWith(types.callExpression(helperReference(this.plugin, path, "_await"), argument.node ? [argument.node] : []));
				}
			}
		},
	};

	function checkForErrorsAndRewriteReturns(path, rewriteReturns, plugin) {
		const state = { rewriteReturns, plugin, canThrow: false };
		path.traverse(checkForErrorsAndRewriteReturnsVisitor, state);
		return state.canThrow;
	}

	const rewriteTopLevelReturnsVisitor = {
		Function: skipNode,
		ReturnStatement(path) {
			const argument = path.get("argument");
			if (argument.isCallExpression() && (argument.node.arguments.length === 1 || (argument.node.arguments[1].type === "UnaryExpression" && argument.node.arguments[1].operator === "void"))) {
				switch (argument.node.callee._helperName) {
					case "_await":
						argument.replaceWith(argument.node.arguments[0]);
						break;
					case "_call":
						argument.replaceWith(types.callExpression(argument.node.arguments[0], []));
						break;
				}
			}
		}
	}

	return {
		manipulateOptions(options, parserOptions) {
			parserOptions.plugins.push("asyncGenerators");
		},
		visitor: {
			FunctionDeclaration(path) {
				const node = path.node;
				if (node.async) {
					const expression = types.functionExpression(null, node.params, node.body, node.generator, node.async);
					if (path.parentPath.isExportDeclaration() || path.parentPath.isExportDefaultDeclaration()) {
						path.replaceWith(types.variableDeclaration("const", [types.variableDeclarator(node.id, expression)]));
					} else {
						path.remove();
						path.scope.parent.push({ id: node.id, init: expression });
					}
				}
			},
			ArrowFunctionExpression(path) {
				const node = path.node;
				if (node.async) {
					rewriteThisExpressions(path, path.getFunctionParent());
					const body = path.get("body").isBlockStatement() ? path.node.body : blockStatement([types.returnStatement(path.node.body)]);
					path.replaceWith(types.functionExpression(null, node.params, body, false, node.async));
				}
			},
			FunctionExpression(path) {
				if (path.node.async) {
					rewriteThisArgumentsAndHoistFunctions(path, path);
					rewriteFunctionBody(this, path);
					const inlineAsync = this.opts.inlineAsync;
					const bodyPath = path.get("body");
					const canThrow = checkForErrorsAndRewriteReturns(bodyPath, inlineAsync, this);
					if (inlineAsync && !pathsReturnOrThrowCurrentNodes(bodyPath).all) {
						path.node.body.body.push(types.returnStatement());
					}
					if (canThrow) {
						if (inlineAsync) {
							path.replaceWith(types.functionExpression(null, path.node.params, blockStatement(types.tryStatement(bodyPath.node, types.catchClause(types.identifier("e"), blockStatement([types.returnStatement(types.callExpression(types.memberExpression(types.identifier("Promise"), types.identifier("reject")), [types.identifier("e")]))]))))));
						} else {
							bodyPath.traverse(rewriteTopLevelReturnsVisitor);
							path.replaceWith(types.callExpression(helperReference(this, path, "_async"), [
								types.functionExpression(null, path.node.params, bodyPath.node)
							]));
						}
					} else {
						if (!inlineAsync) {
							checkForErrorsAndRewriteReturns(bodyPath, true, this)
						}
						path.replaceWith(types.functionExpression(null, path.node.params, bodyPath.node));
					}
					path.node._async = true;
				}
			},
			ClassMethod(path) {
				if (path.node.async) {
					if (path.node.kind === "method") {
						const body = path.get("body");
						body.replaceWith(types.blockStatement([types.returnStatement(types.callExpression(helperReference(this, path, "_call"), [types.functionExpression(null, [], body.node)]))]));
						const migratedPath = body.get("body.0.argument.arguments.0");
						rewriteThisArgumentsAndHoistFunctions(migratedPath, path);
						rewriteFunctionBody(this, migratedPath);
						path.replaceWith(types.classMethod(path.node.kind, path.node.key, path.node.params, path.node.body, path.node.computed, path.node.static));
					}
				}
			},
			ObjectMethod(path) {
				if (path.node.async) {
					if (path.node.kind === "method") {
						path.replaceWith(types.objectProperty(path.node.key, types.functionExpression(null, path.node.params, path.node.body, path.node.generator, path.node.async), path.node.computed, false, path.node.decorators));
					}
				}
			},
		}
	}
}

module.exports = exports.default;
