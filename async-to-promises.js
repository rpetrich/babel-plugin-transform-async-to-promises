const errorOnIncompatible = true;

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

	function pathsPassTest(matchingNodeTest) {
		function visit(path, result) {
			const originalNode = path.node._originalNode;
			if (originalNode) {
				traverse(wrapNodeInStatement(originalNode), visitor, path.scope, { match: result }, path);
				return false;
			}
			if (matchingNodeTest(path)) {
				result.any = true;
				result.all = true;
				result.hasBreak = result.hasBreak || path.isBreakStatement();
				// result.paths.push(path);
				return false;
			}
			if (path.isConditional()) {
				const test = match(path.get("test"));
				const consequent = match(path.get("consequent"));
				const alternate = match(path.get("alternate"));
				result.any = result.any || test.any || consequent.any || alternate.any;
				result.hasBreak = result.hasBreak || consequent.hasBreak || alternate.hasBreak;
				// result.paths = result.paths.concat(test.paths).concat(consequent.paths).concat(alternate.paths);
				return (result.all = (test.all || (consequent.all && alternate.all && !result.hasBreak)));
			}
			if (path.isSwitchStatement()) {
				const discriminant = match(path.get("discriminant"));
				const cases = path.get("cases");
				const caseMatches = cases.map((switchCase, i) => {
					const result = match(switchCase);
					for (i++; (!result.all || pathsBreakReturnOrThrow(switchCase).all) && i < cases.length; i++) {
						const tailMatch = match(cases[i]);
						result.all = result.all || tailMatch.all;
						result.any = result.any || tailMatch.any;
						result.hasBreak = result.hasBreak || tailMatch.hasBreak;
						// result.paths = result.paths.concat(tailMatch.paths);
					}
					return result;
				});
				result.any = result.any || discriminant.any || caseMatches.some(caseMatch => caseMatch.any);
				result.hasBreak = result.hasBreak || caseMatches.some(caseMatch => caseMatch.hasBreak);
				// result.paths = caseMatches.reduce((acc, match) => acc.concat(match.paths), result.paths.concat(discriminant.paths));
				return result.all = discriminant.all || (cases.some(switchCase => !switchCase.node.test) && caseMatches.every(caseMatch => caseMatch.all && !caseMatch.hasBreak));
			}
			if (path.isDoWhileStatement()) {
				const body = match(path.get("body"));
				const test = match(path.get("test"));
				result.any = result.any || body.any || test.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return result.all = (body.all || test.all);
			}
			if (path.isWhileStatement()) {
				// TODO: Support detecting break/return statements
				const test = match(path.get("test"));
				const body = match(path.get("body"));
				result.any = result.any || test.any || body.any;
				// result.paths = result.paths.concat(test.paths).concat(body.paths);
				return result.all = test.all;
			}
			if (path.isForXStatement()) {
				const right = match(path.get("right"));
				const body = match(path.get("body"));
				result.any = result.any || right.any || body.any;
				// result.paths = result.paths.concat(right.paths).concat(body.paths);
				return result.all = right.all;
			}
			if (path.isForStatement()) {
				const init = match(path.get("init"));
				const test = match(path.get("test"));
				const body = match(path.get("body"));
				const update = match(path.get("update"));
				result.any = result.any || init.any || test.any || body.any || update.any;
				// result.paths = result.paths.concat(init.paths).concat(test.paths).concat(update.paths).concat(body.paths);
				return result.all = (init.all || test.all);
			}
			if (path.isLogicalExpression()) {
				const left = match(path.get("left"));
				const right = match(path.get("right"));
				result.any = result.any || left.any || right.any;
				// result.paths = result.paths.concat(left.paths).concat(right.paths);
				return result.all = left.all;
			}
			if (path.isReturnStatement()) {
				return true;
			}
			if (path.isBreakStatement()) {
				return result.hasBreak = true;
			}
			if (path.isContinueStatement()) {
				return true;
			}
			if (path.isThrowStatement()) {
				// TODO: Handle throw statements correctly
				return true;
			}
			if (path.isTryStatement()) {
				const blockMatch = match(path.get("block"));
				const finalizer = path.get("finalizer");
				const finalizerMatch = match(finalizer);
				const handler = path.get("handler");
				const handlerMatch = match(handler);
				result.any = result.any || blockMatch.any || handlerMatch.any || finalizerMatch.any;
				// result.paths = result.paths.concat(blockMatch.paths).concat(handlerMatch.paths).concat(finalizerMatch.paths);
				result.hasBreak = result.hasBreak || blockMatch.hasBreak || finalizerMatch.hasBreak || handler.hasBreak;
				if (finalizerMatch.all) {
					return result.all = true;
				} else if (!finalizer.node) {
					return result.all = handlerMatch.all && blockMatch.all;
				}
				return false;
			}
			if (path.isFunction()) {
				return false;
			}
		}
		const visitor = {
			enter(path) {
				switch (visit(path, this.match)) {
					case true:
						path.stop();
						break;
					case false:
						path.skip();
						break;
				}
			}
		};
		function match(path) {
			const match = { all: false, any: false, hasBreak: false, paths: [] };
			// const match = { all: false, any: false, hasBreak: false, paths: [] };
			if (path && path.node) {
				if (typeof visit(path, match) === "undefined") {
					path.traverse(visitor, { match });
				}
			}
			return match;
		}
		return match;
	}

	function pathsReachNodeTypes(matchingNodeTypes) {
		return pathsPassTest(path => matchingNodeTypes.indexOf(path.node.type) !== -1);
	}

	const pathsReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"]);
	const pathsBreak = pathsReachNodeTypes(["BreakStatement"]);
	const pathsBreakReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement", "BreakStatement"]);

	function isCompatible(path) {
		let result = true;
		path.traverse({
			BreakStatement(path) {
				const label = path.node.label;
				if (label) {
					const labeledStatement = path.findParent(parent => parent.isLabeledStatement());
					if (!labeledStatement || labeledStatement.node.label.name !== label.name) {
						if (errorOnIncompatible) {
							throw path.buildCodeFrameError("Only breaking out of the inner-most labeled scope is supported!");
						}
						result = false;
						path.stop();
					}
				}
			},
			ContinueStatement(path) {
				const label = path.node.label;
				if (label) {
					const labeledStatement = path.findParent(parent => parent.isLabeledStatement());
					if (!labeledStatement || labeledStatement.node.label.name !== label.name) {
						if (errorOnIncompatible) {
							throw path.buildCodeFrameError("Only continuing the inner-most labeled scope is supported!");
						}
						result = false;
						path.stop();
					}
				}
			},
			Function(path) {
				path.skip();
			}
		});
		return result;
	}

	function isNonEmptyStatement(statement) {
		return !types.isEmptyStatement(statement);
	}

	function awaitedExpressionInSingleReturnStatement(statements) {
		statements = statements.filter(isNonEmptyStatement);
		if (statements.length === 1) {
			if (types.isReturnStatement(statements[0])) {
				let argument = statements[0].argument;
				if (argument) {
					while (types.isAwaitExpression(argument)) {
						argument = argument.argument;
					}
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
			const expression = awaitedExpressionInSingleReturnStatement(continuation.body.body);
			if (expression && types.isIdentifier(expression) && expression.name === continuation.params[0].name) {
				return true;
			}
		}
		return false;
	}

	function awaitAndContinue(state, path, value, continuation, catchContinuation) {
		const useCallHelper = types.isCallExpression(value) && value.arguments.length === 0 && !types.isMemberExpression(value.callee);
		let ignoreResult = false;
		let firstArg;
		if (useCallHelper) {
			firstArg = value.callee;
			if (types.isFunctionExpression(firstArg)) {
				const expression = awaitedExpressionInSingleReturnStatement(firstArg.body.body);
				if (expression && types.isCallExpression(expression) && expression.callee._helperName === "_callIgnored") {
					firstArg = expression.arguments[0];
				}
			}
		} else {
			firstArg = value;
		}
		let args;
		if (!catchContinuation) {
			if (!continuation || isPassthroughContinuation(continuation)) {
				return value;
			}
			if (types.isIdentifier(continuation) && continuation === path.hub.file.declarations["_empty"]) {
				ignoreResult = true;
				args = [firstArg];
			} else {
				args = [firstArg, continuation];
			}
		} else if (!continuation || isPassthroughContinuation(continuation)) {
			args = [firstArg, voidExpression(), catchContinuation];
		} else {
			args = [firstArg, continuation || voidExpression(), catchContinuation];
		}
		let helperName = useCallHelper ? "_call" : "_await";
		if (ignoreResult) {
			helperName += "Ignored";
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
			if (types.isReturnStatement(lastStatement) && lastStatement.argument === null) {
				blocks.pop();
			} else {
				if (types.isIfStatement(lastStatement)) {
					if (types.isBlockStatement(lastStatement.consequent)) {
						removeUnnecessaryReturnStatements(lastStatement.consequent.body);
					}
					if (types.isBlockStatement(lastStatement.alternate)) {
						removeUnnecessaryReturnStatements(lastStatement.alternate.body);
					}
				}
				break;
			}
		}
		return blocks;
	}

	function rewriteFunctionNode(state, parentPath, node, exitIdentifier) {
		const path = pathForNewNode(node, parentPath);
		rewriteFunctionBody(state, path, exitIdentifier);
		return path.node;
	}

	function relocateTail(state, awaitExpression, statementNode, target, temporary, exitIdentifier) {
		const tail = borrowTail(target);
		if (statementNode && types.isExpressionStatement(statementNode) && types.isIdentifier(statementNode.expression)) {
			statementNode = null;
		}
		const blocks = removeUnnecessaryReturnStatements((statementNode ? [statementNode].concat(tail) : tail).filter(isNonEmptyStatement));
		if (blocks.length) {
			const fn = types.functionExpression(null, temporary ? [temporary] : [], blockStatement(blocks));
			const rewritten = rewriteFunctionNode(state, target, fn, exitIdentifier);
			target.replaceWith(returnStatement(awaitAndContinue(state, target, awaitExpression, rewritten), target.node));
		} else if (pathsReturnOrThrow(target).any) {
			target.replaceWith(returnStatement(awaitExpression, target.node));
			return target.get("argument");
		} else {
			target.replaceWith(returnStatement(awaitAndContinue(state, target, awaitExpression, helperReference(state, target, "_empty")), target.node));
		}
	}

	function tryHelper(state, path, blockStatement, catchFunction) {
		const catchArgs = catchFunction ? [voidExpression(), catchFunction] : [];
		const body = blockStatement.body.filter(isNonEmptyStatement);
		if (body.length === 1) {
			const statement = body[0];
			if (types.isReturnStatement(statement)) {
				let argument = statement.argument;
				while (types.isAwaitExpression(argument)) {
					argument = argument.argument;
				}
				if (types.isCallExpression(argument) && argument.arguments.length === 0) {
					if (types.isIdentifier(argument.callee) || types.isFunctionExpression(argument.callee)) {
						return types.callExpression(helperReference(state, path, "_call"), [argument.callee].concat(catchArgs));
					}
				}
			}
		}
		return types.callExpression(helperReference(state, path, "_call"), [types.functionExpression(null, [], blockStatement)].concat(catchArgs));
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
			if (types.isCallExpression(expression) && expression.arguments.length === 0 && types.isIdentifier(expression.callee)) {
				const binding = scope.getBinding(expression.callee.name);
				if (binding && binding.constant) {
					return expression.callee;
				}
			}
		}
		return node;
	}

	function isExpressionOfLiterals(path) {
		if (path.isIdentifier() && path.node.name === "undefined") {
			return true;
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
			return path.get("elements").every(path => isExpressionOfLiterals(path));
		}
		if (path.isObjectExpression()) {
			return path.get("properties").every(path => {
				if (!path.isObjectProperty()) {
					return true;
				}
				if (isExpressionOfLiterals(path.get("value")) && (!path.node.computed || isExpressionOfLiterals(path.get("key")))) {
					return true;
				}
			});
		}
		if (path.isUnaryExpression()) {
			return isExpressionOfLiterals(path.get("argument"));
		}
		if (path.isIdentifier()) {
			const binding = path.scope.getBinding(path.node.name);
			if (binding) {
				return binding.constant;
			}
		}
		return false;
	}

	function generateIdentifierForPath(path) {
		return path.scope.generateUidIdentifierBasedOnNode(path.isAwaitExpression() ? path.node.argument : path.node);
	}

	function extractDeclarations(awaitPath, awaitExpression) {
		const declarations = [];
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
					parent.parentPath.insertBefore(types.variableDeclaration(parent.parent.kind, beforeDeclarations));
				}
			} else if (parent.isLogicalExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isExpressionOfLiterals(left)) {
						const leftIdentifier = generateIdentifierForPath(left);
						declarations.push(types.variableDeclarator(leftIdentifier, left.node));
						left.replaceWith(leftIdentifier);
					}
					awaitExpression = parent.node.operator === "||" ? types.conditionalExpression(left.node, types.numericLiteral(0), awaitExpression) : types.conditionalExpression(left.node, awaitExpression, types.numericLiteral(0));
				}
			} else if (parent.isBinaryExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					if (!isExpressionOfLiterals(left)) {
						const leftIdentifier = generateIdentifierForPath(left);
						declarations.push(types.variableDeclarator(leftIdentifier, left.node));
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
						declarations.push(types.variableDeclarator(sequenceIdentifier, expression.node));
					}
					expression.remove();
				}
			} else if (parent.isConditionalExpression()) {
				const test = parent.get("test");
				if (awaitPath !== test) {
					const consequent = parent.get("consequent");
					const testNode = test.node;
					const testIdentifier = generateIdentifierForPath(test);
					declarations.push(types.variableDeclarator(testIdentifier, testNode));
					test.replaceWith(testIdentifier);
					if (consequent !== awaitPath && consequent.isAwaitExpression()) {
						awaitExpression = types.conditionalExpression(testIdentifier, consequent.node.argument, awaitExpression);
						parent.replaceWith(parent.node.alternate);
					} else {
						awaitExpression = consequent !== awaitPath ? types.conditionalExpression(testIdentifier, types.numericLiteral(0), awaitExpression) : types.conditionalExpression(testIdentifier, awaitExpression, types.numericLiteral(0));
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
							declarations.push(types.variableDeclarator(argIdentifier, arg.node));
							arg.replaceWith(argIdentifier);
						}
					}
					if (!isExpressionOfLiterals(callee)) {
						if (callee.isMemberExpression()) {
							const object = callee.get("object");
							if (!isExpressionOfLiterals(object)) {
								const objectIdentifier = generateIdentifierForPath(object);
								declarations.push(types.variableDeclarator(objectIdentifier, object.node));
								object.replaceWith(objectIdentifier);
							}
							const property = callee.get("property");
							const calleeIdentifier = generateIdentifierForPath(property);
							const calleeNode = callee.node;
							parent.replaceWith(types.callExpression(types.memberExpression(calleeIdentifier, types.identifier("call")), [object.node].concat(parent.node.arguments)));
							declarations.push(types.variableDeclarator(calleeIdentifier, calleeNode));
						} else if (!callee.isIdentifier() || !(!callee.node.name._helperName || (awaitPath.scope.getBinding(callee.node.name) || {}).constant)) {
							const calleeIdentifier = generateIdentifierForPath(callee);
							const calleeNode = callee.node;
							callee.replaceWith(calleeIdentifier);
							declarations.push(types.variableDeclarator(calleeIdentifier, calleeNode));
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
						declarations.push(types.variableDeclarator(elementIdentifier, element.node));
						element.replaceWith(elementIdentifier);
					}
				}
			} else if (parent.isObjectExpression()) {
				for (const prop of parent.get("properties")) {
					if (prop === awaitPath) {
						break;
					}
					if (prop.isObjectProperty()) {
						if (prop.computed) {
							const propKey = prop.get("key");
							if (!isExpressionOfLiterals(propKey)) {
								const keyIdentifier = generateIdentifierForPath(propKey);
								declarations.push(types.variableDeclarator(keyIdentifier, propKey.node));
								propKey.replaceWith(keyIdentifier);
							}
						}
						const propValue = prop.get("value");
						if (!isExpressionOfLiterals(propValue)) {
							const propIdentifier = generateIdentifierForPath(propValue);
							declarations.push(types.variableDeclarator(propIdentifier, propValue.node));
							propValue.replaceWith(propIdentifier);
						}
					}
				}
			}
			awaitPath = parent;
		} while (!awaitPath.isStatement());
		return { declarations, awaitExpression };
	}

	const lastAwaitVisitor = {
		Function(path) {
			path.skip();
		},
		AwaitExpression(path) {
			this.result = path;
		},
		CallExpression(path) {
			const callee = path.get("callee");
			if (callee.isIdentifier() && callee.node.name === "eval") {
				throw path.buildCodeFrameError("Calling eval from inside an async function is not supported!");
			}
		},
	};

	function findLastAwaitPath(path) {
		let state = { result: path.isAwaitExpression() ? path : null };
		path.traverse(lastAwaitVisitor, state);
		return state.result;
	}

	function buildBreakExitCheck(exitIdentifier, breakIdentifiers) {
		let expressions = (breakIdentifiers.map(identifier => identifier.identifier) || []).concat(exitIdentifier ? [exitIdentifier] : []);
		if (expressions.length) {
			return expressions.reduce((accumulator, identifier) => types.logicalExpression("||", accumulator, identifier));
		}
	}

	function replaceReturnsAndBreaks(path, exitIdentifier) {
		const breakIdentifiers = breakContinueStackForPath(path);
		path.traverse({
			Function(path) {
				path.skip();
			},
			ReturnStatement(path) {
				if (!path.node._skip && exitIdentifier) {
					path.replaceWithMultiple([
						types.expressionStatement(types.assignmentExpression("=", exitIdentifier, types.numericLiteral(1))),
						returnStatement(path.node.argument, path.node),
					]);
				}
			},
			BreakStatement(path) {
				const replace = returnStatement(null, path.node);
				const index = path.node.label ? breakIdentifiers.findIndex(breakIdentifier => breakIdentifier.name === path.node.label.name) : 0;
				if (index !== -1 && breakIdentifiers.length) {
					const expression = breakIdentifiers.slice(0, index + 1).reduce((expression, breakIdentifier) => types.assignmentExpression("=", breakIdentifiers[0].identifier, expression), types.numericLiteral(1));
					path.replaceWithMultiple([
						types.expressionStatement(expression),
						replace,
					]);
				} else {
					path.replaceWith(replace);
				}
			},
			ContinueStatement(path) {
				const replace = returnStatement(null, path.node);
				const index = path.node.label ? breakIdentifiers.findIndex(breakIdentifier => breakIdentifier.name === path.node.label.name) : 0;
				if (index !== -1 && breakIdentifiers.length) {
					const expression = breakIdentifiers.slice(0, index).reduce((expression, breakIdentifier) => types.assignmentExpression("=", breakIdentifiers[0].identifier, expression), types.numericLiteral(1));
					path.replaceWithMultiple([
						types.expressionStatement(expression),
						replace,
					]);
				} else {
					path.replaceWith(replace);
				}
			},
		});
		return breakIdentifiers;
	}

	function breakIdentifierForPath(path) {
		let result = path.node._breakIdentifier;
		if (!result) {
			result = path.node._breakIdentifier = path.scope.generateUidIdentifier(path.parentPath.isLabeledStatement() ? path.parent.label.name + "Interrupt" : "interrupt");
			path.parentPath.scope.push({ id: result });
		}
		return result;
	}

	const simpleBreakOrContinueReferencesVisitor = {
		Function(path) {
			path.skip();
		},
		Loop(path) {
			path.skip();
		},
		SwitchStatement(path) {
			path.skip();
		},
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
		Function(path) {
			path.skip();
		},
		BreakStatement(path) {
			if (path.node.label && path.node.label.name === this.name) {
				this.references.push(path);
			}
		},
		// ContinueStatement(path) {
		// 	if (path.node.label && path.node.label.name === this.name) {
		// 		this.references.push(path);
		// 	}
		// },
		ReturnStatement(path) {
			const originalNode = path.node._originalNode;
			if (originalNode) {
				traverse(wrapNodeInStatement(originalNode), namedLabelReferencesVisitor, path.scope, this, path);
				path.skip();
			}
		}
	};

	function namedLabelReferences(labelPath, targetPath) {
		const state = { name: labelPath.node.label.name, references: [] };
		targetPath.traverse(namedLabelReferencesVisitor, state);
		return state.references;
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
						if (simpleReferences.length || namedLabelReferences(current.parentPath, path).length) {
							result.push({
								identifier: breakIdentifierForPath(current),
								name: current.parentPath.node.label.name
							});
						}
						current = current.parentPath;
					} else if (simpleReferences.length) {
						result.push({
							identifier: breakIdentifierForPath(current),
						});
					}
				}
			} else if (current.isLabeledStatement() && namedLabelReferences(current, path).length) {
				result.push({
					identifier: breakIdentifierForPath(current.get("body")),
					name: current.node.label.name
				});
			}
			current = current.parentPath;
		}
		return result;
	}

	function rewriteFunctionBody(state, path, exitIdentifier) {
		if (!path || !path.isFunction()) {
			return;
		}
		let awaitPath;
		while (awaitPath = findLastAwaitPath(path)) {
			const relocatedBlocks = [];
			const originalAwaitPath = awaitPath;
			const originalExpression = awaitPath.node;
			const node = awaitPath.node;
			let expressionToAwait = node.argument;
			let processExpressions = true;
			do {
				let parent = awaitPath.parentPath;
				if (!relocatedBlocks.find(block => block.path === parent)) {
					const explicitExits = pathsReturnOrThrow(parent);
					if (parent.isIfStatement()) {
						if (awaitPath !== parent.get("test")) {
							if (!explicitExits.all && explicitExits.any && !exitIdentifier) {
								exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
								path.scope.push({ id: exitIdentifier });
							}
							replaceReturnsAndBreaks(parent.get("consequent"), exitIdentifier);
							replaceReturnsAndBreaks(parent.get("alternate"), exitIdentifier);
							relocatedBlocks.push({
								relocate() {
									let resultIdentifier = null;
									if (!explicitExits.all && explicitExits.any) {
										resultIdentifier = path.scope.generateUidIdentifier("result");
										parent.insertAfter(types.ifStatement(exitIdentifier, returnStatement(resultIdentifier)));
									}
									if (!explicitExits.all) {
										const fn = types.functionExpression(null, [], blockStatement([parent.node]));
										const rewritten = rewriteFunctionNode(state, parent, fn, exitIdentifier);
										relocateTail(state, types.callExpression(rewritten, []), null, parent, resultIdentifier, exitIdentifier);
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
										finallyBody = finallyBody.concat(returnStatement(types.callExpression(helperReference(state, parent, "_rethrow"), [wasThrownIdentifier, resultIdentifier])));
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
									catchExpression = rewriteCatch ? types.functionExpression(null, [catchClause.param], catchClause.body) : helperReference(state, parent, "_empty");
								}
								const evalBlock = tryHelper(state, parent, parent.node.block, catchExpression);
								relocateTail(state, evalBlock, success, parent, temporary, exitIdentifier);
								if (finallyFunction && finallyName) {
									parent.get("argument").replaceWith(types.callExpression(helperReference(state, parent, finallyName), [parent.node.argument, finallyFunction]));
								}
							},
							path: parent,
						});
					} else if (parent.isForStatement() || parent.isWhileStatement() || parent.isDoWhileStatement() || parent.isForInStatement() || parent.isForOfStatement()) {
						const breaks = pathsBreak(parent);
						const label = parent.parentPath.isLabeledStatement() ? parent.parent.label.name : null;
						if (!exitIdentifier && explicitExits.any) {
							path.scope.push({ id: exitIdentifier = awaitPath.scope.generateUidIdentifier(label ? label + "Exit" : "exit") });
						}
						const breakIdentifiers = replaceReturnsAndBreaks(parent.get("body"), exitIdentifier);
						const isForIn = parent.isForInStatement();
						const forOwnBodyPath = isForIn && extractForOwnBodyPath(parent);
						const isForOf = parent.isForOfStatement();
						if (isForIn || isForOf) {
							const right = parent.get("right");
							if (awaitPath !== right) {
								if (!explicitExits.all && explicitExits.any && !exitIdentifier) {
									exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
									path.scope.push({ id: exitIdentifier });
								}
								relocatedBlocks.push({
									relocate() {
										const left = parent.get("left");
										const loopIdentifier = left.isVariableDeclaration() ? left.node.declarations[0].id : left.node;
										const params = [right.node, types.functionExpression(null, [loopIdentifier], blockStatement((forOwnBodyPath || parent.get("body")).node))];
										const exitCheck = buildBreakExitCheck(exitIdentifier, breakIdentifiers);
										if (exitCheck) {
											params.push(unwrapReturnCallWithEmptyArguments(types.functionExpression(null, [], types.blockStatement([returnStatement(exitCheck)])), path.scope));
										}
										const loopCall = types.callExpression(helperReference(state, parent, isForIn ? forOwnBodyPath ? "_forOwn" : "_forIn" : "_forOf"), params);
										let resultIdentifier = null;
										if (explicitExits.any) {
											resultIdentifier = path.scope.generateUidIdentifier("result");
											parent.insertAfter(types.ifStatement(exitIdentifier, returnStatement(resultIdentifier)));
										}
										relocateTail(state, loopCall, null, label ? parent.parentPath : parent, resultIdentifier, exitIdentifier);
									},
									path: parent,
								})
							}
						} else {
							const forToIdentifiers = identifiersInForToLengthStatement(parent);
							let testExpression = parent.node.test;
							const breakExitCheck = buildBreakExitCheck(exitIdentifier, breakIdentifiers);
							if (breakExitCheck) {
								const inverted = types.unaryExpression("!", breakExitCheck);
								testExpression = testExpression && (!types.isBooleanLiteral(testExpression) || !testExpression.value) ? types.logicalExpression("&&", inverted, testExpression) : inverted;
							}
							if (testExpression) {
								const testPath = parent.get("test");
								testPath.replaceWith(rewriteFunctionNode(state, parent, functionize(testExpression), exitIdentifier));
							}
							const update = parent.get("update");
							if (update.node) {
								update.replaceWith(functionize(update.node));
							}
							relocatedBlocks.push({
								relocate() {
									const isDoWhile = parent.isDoWhileStatement();
									if (!breaks.any && !explicitExits.any && forToIdentifiers && !isDoWhile) {
										const loopCall = types.callExpression(helperReference(state, parent, "_forTo"), [forToIdentifiers.array, types.functionExpression(null, [forToIdentifiers.i], blockStatement(parent.node.body))])
										relocateTail(state, loopCall, null, parent, undefined, exitIdentifier);
									} else {
										const init = parent.get("init");
										if (init.node) {
											parent.insertBefore(init.node);
										}
										const forIdentifier = path.scope.generateUidIdentifier("for");
										const bodyFunction = types.functionExpression(null, [], blockStatement(parent.node.body));
										const testFunction = unwrapReturnCallWithEmptyArguments(parent.get("test").node || voidExpression(), path.scope);
										const updateFunction = unwrapReturnCallWithEmptyArguments(parent.get("update").node || voidExpression(), path.scope);
										const loopCall = isDoWhile ? types.callExpression(helperReference(state, parent, "_do"), [bodyFunction, testFunction]) : types.callExpression(helperReference(state, parent, "_for"), [testFunction, updateFunction, bodyFunction]);
										let resultIdentifier = null;
										if (explicitExits.any) {
											resultIdentifier = path.scope.generateUidIdentifier("result");
											parent.insertAfter(types.ifStatement(exitIdentifier, returnStatement(resultIdentifier)));
										}
										relocateTail(state, loopCall, null, parent, resultIdentifier, exitIdentifier);
									}
								},
								path: parent,
							});
						}
					} else if (parent.isSwitchStatement()) {
						// TODO: Support more complex switch statements
						const label = parent.parentPath.isLabeledStatement() ? parent.parent.label.name : null;
						const discriminant = parent.get("discriminant");
						const testPaths = parent.get("cases").map(casePath => casePath.get("test"));
						if (awaitPath !== discriminant && !(explicitExits.all && !testPaths.some(testPath => findLastAwaitPath(testPath)))) {
							if (!explicitExits.all && explicitExits.any && !exitIdentifier) {
								exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
								path.scope.push({ id: exitIdentifier });
							}
							let defaultIndex;
							testPaths.forEach((testPath, i) => {
								if (testPath.node) {
									testPath.replaceWith(rewriteFunctionNode(state, parent, functionize(testPath.node), exitIdentifier));
								} else {
									defaultIndex = i;
								}
							});
							const casePaths = parent.get("cases");
							const cases = casePaths.map(casePath => {
								const switchCase = casePath.node;
								const args = [];
								if (switchCase.test) {
									args.push(switchCase.test);
								} else if (switchCase.consequent.length) {
									args.push(voidExpression());
								}
								if (switchCase.consequent.length) {
									const caseExits = pathsReturnOrThrow(casePath);
									const caseBreaks = pathsBreak(casePath);
									const useBreakIdentifier = !caseBreaks.all && caseBreaks.any;
									let breakIdentifiers = replaceReturnsAndBreaks(casePath, exitIdentifier);
									args.push(types.functionExpression(null, [], types.blockStatement(removeUnnecessaryReturnStatements(switchCase.consequent))));
									if (!caseExits.any && !caseBreaks.any) {
										args.push(helperReference(state, parent, "_empty"));
									} else if (!(caseExits.all || caseBreaks.all)) {
										const breakCheck = buildBreakExitCheck(caseExits.any ? exitIdentifier : null, breakIdentifiers);
										if (breakCheck) {
											args.push(types.functionExpression(null, [], types.blockStatement([returnStatement(breakCheck)])));
										}
									}
								}
								return types.arrayExpression(args);
							});
							relocatedBlocks.push({
								relocate() {
									let resultIdentifier;
									if (!explicitExits.all && explicitExits.any) {
										resultIdentifier = path.scope.generateUidIdentifier("result");
										parent.insertAfter(types.ifStatement(exitIdentifier, returnStatement(resultIdentifier)));
									}
									const switchCall = types.callExpression(helperReference(state, parent, "_switch"), [discriminant.node, types.arrayExpression(cases)]);
									relocateTail(state, switchCall, null, label ? parent.parentPath : parent, resultIdentifier, exitIdentifier);
								},
								path: parent,
							});
						}
					}
				}
				if (processExpressions && (parent.isStatement() || (parent.isSwitchCase() && awaitPath.node != parent.node.test))) {
					if (!awaitPath.isFunction() && !awaitPath.isSwitchCase()) {
						const originalArgument = originalAwaitPath.node.argument;
						if (originalAwaitPath.parentPath.isExpressionStatement()) {
							originalAwaitPath.replaceWith(voidExpression());
							relocatedBlocks.push({
								relocate() {
									relocateTail(state, originalArgument, types.emptyStatement(), parent, null, exitIdentifier);
								},
								path: parent,
							});
						} else {
							const reusingExisting = originalAwaitPath.parentPath.isVariableDeclarator();
							let resultIdentifier;
							if (reusingExisting) {
								resultIdentifier = originalAwaitPath.parent.id;
							} else {
								resultIdentifier = generateIdentifierForPath(originalAwaitPath.get("argument"));
							}
							originalAwaitPath.replaceWith(resultIdentifier);
							const { declarations, awaitExpression } = extractDeclarations(originalAwaitPath, originalArgument);
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
										if (parent.node.declarations.length === 1) {
											parent.replaceWith(types.emptyStatement());
										} else {
											originalAwaitPath.parentPath.remove();
										}
									}
									relocateTail(state, awaitExpression, parent.node, parent, resultIdentifier, exitIdentifier);
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
	}

	let helpers;

	function getHelperDependencies(path) {
		const dependencies = [];
		path.traverse({
			Identifier(path) {
				if (path.hub.file.scope.getBinding(path.node.name) && dependencies.indexOf(path.node.name) === -1) {
					dependencies.push(path.node.name);
				}
			}
		});
		return dependencies;
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
				file.path.unshiftContainer("body", types.cloneDeep(helper.value));
				file.path.get("body.0").traverse({
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

	return {
		visitor: {
			FunctionDeclaration(path) {
				const node = path.node;
				if (node.async && isCompatible(path.get("body"))) {
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
				if (node.async && isCompatible(path.get("body"))) {
					rewriteThisExpressions(path, path.getFunctionParent());
					const body = path.get("body").isBlockStatement() ? path.node.body : blockStatement([types.returnStatement(path.node.body)]);
					path.replaceWith(types.functionExpression(null, node.params, body, false, node.async));
				}
			},
			FunctionExpression(path) {
				if (path.node.async && isCompatible(path.get("body"))) {
					rewriteThisArgumentsAndHoistFunctions(path, path);
					rewriteFunctionBody(this, path);
					path.replaceWith(types.callExpression(helperReference(this, path, "_async"), [
						types.functionExpression(null, path.node.params, path.node.body)
					]));
				}
			},
			ClassMethod(path) {
				if (path.node.async && isCompatible(path.get("body"))) {
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
				if (path.node.async && isCompatible(path.get("body"))) {
					if (path.node.kind === "method") {
						path.replaceWith(types.objectProperty(path.node.key, types.functionExpression(null, path.node.params, path.node.body, path.node.generator, path.node.async), path.node.computed, false, path.node.decorators));
					}
				}
			},
		}
	}
}

module.exports = exports.default;
