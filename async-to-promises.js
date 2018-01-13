const errorOnIncompatible = true;

exports.default = function({ types, template, traverse }) {

	function pathsReachNodeTypes(matchingNodeTypes) {
		function visit(path, result) {
			const originalNode = path.node._originalNode;
			if (originalNode) {
				traverse(types.isStatement(originalNode) ? types.blockStatement([originalNode]) : types.expressionStatement(originalNode), visitor, path.scope, { match: result }, path);
				return false;
			}
			if (matchingNodeTypes.indexOf(path.node.type) !== -1) {
				result.any = true;
				result.all = true;
				result.hasBreak = result.hasBreak || path.isBreakStatement();
				return false;
			}
			if (path.isConditional()) {
				const test = match(path.get("test"));
				const consequent = match(path.get("consequent"));
				const alternate = match(path.get("alternate"));
				result.any = result.any || test.any || consequent.any || alternate.any;
				result.hasBreak = result.hasBreak || consequent.hasBreak || alternate.hasBreak;
				return (result.all = (test.all || (consequent.all && alternate.all && !result.hasBreak)));
			}
			if (path.isSwitchStatement()) {
				const discriminant = match(path.get("discriminant"));
				const cases = path.node.cases.map((switchCase, i) => path.get("cases." + i));
				const caseMatches = cases.map((switchCase, i) => {
					const result = { all: false, any: false, hasBreak: false };
					for (;;) {
						const caseMatch = match(switchCase);
						result.any = result.any || caseMatch.any;
						result.hasBreak = result.hasBreak || caseMatch.hasBreak;
						if (caseMatch.all) {
							result.all = true;
							break;
						}
						if (pathsBreakReturnOrThrow(switchCase).all) {
							break;
						}
						if (++i === cases.length) {
							break;
						}
						switchCase = cases[i];
					}
					return result;
				});
				result.any = result.any || discriminant.any || caseMatches.some(caseMatch => caseMatch.any);
				result.hasBreak = result.hasBreak || caseMatches.some(caseMatch => caseMatch.hasBreak);
				return result.all = discriminant.all || (cases.some(switchCase => !switchCase.node.test) && caseMatches.every(caseMatch => caseMatch.all && !caseMatch.hasBreak));
			}
			if (path.isDoWhileStatement()) {
				const body = match(path.get("body"));
				const test = match(path.get("test"));
				result.any = result.any || body.any || test.any;
				return result.all = (body.all || test.all);
			}
			if (path.isWhileStatement()) {
				// TODO: Support detecting break/return statements
				const test = match(path.get("test"));
				const body = match(path.get("body"));
				result.any = result.any || test.any || body.any;
				return result.all = test.all;
			}
			if (path.isForXStatement()) {
				const right = match(path.get("right"));
				const body = match(path.get("body"));
				result.any = result.any || right.any || body.any;
				return result.all = right.all;
			}
			if (path.isForStatement()) {
				const init = match(path.get("init"));
				const test = match(path.get("test"));
				const body = match(path.get("body"));
				const update = match(path.get("update"));
				result.any = result.any || init.any || test.any || body.any || update.any;
				return result.all = (init.all || test.all);
			}
			if (path.isLogicalExpression()) {
				const left = match(path.get("left"));
				const right = match(path.get("right"));
				result.any = result.any || left.any || right.any;
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
			if (!path || !path.node) {
				return { all: false, any: false, hasBreak: false };
			}
			const match = { all: false, any: false, hasBreak: false };
			if (typeof visit(path, match) === "undefined") {
				path.traverse(visitor, { match });
			}
			return match;
		}
		return match;
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

	function identifierInSingleReturnStatement(statements) {
		statements = statements.filter(statement => statement.type !== "EmptyStatement");
		if (statements.length === 1) {
			if (statements[0].type === "ReturnStatement") {
				let argument = statements[0].argument;
				if (argument) {
					while (argument.type === "AwaitExpression") {
						argument = argument.argument;
					}
					if (argument.type === "Identifier") {
						return argument;
					}
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
		if (!continuation || continuation.type !== "FunctionExpression") {
			return false;
		}
		if (continuation.params.length === 1) {
			const returnIdentifier = identifierInSingleReturnStatement(continuation.body.body);
			if (returnIdentifier && returnIdentifier.name === continuation.params[0].name) {
				return true;
			}
		}
		return false;
	}

	function awaitAndContinue(state, path, value, continuation, catchContinuation) {
		let useCallHelper = false;
		let ignoreResult = false;
		while (value.type === "CallExpression" && value.arguments.length === 0 && value.callee.type !== "MemberExpression") {
			value = value.callee;
			useCallHelper = true;
		}
		let args;
		if (!catchContinuation) {
			if (!continuation || isPassthroughContinuation(continuation)) {
				if (useCallHelper) {
					return types.callExpression(value, []);
				} else {
					return value;
				}
			}
			if (continuation.type === "Identifier" && continuation.name === "__empty") {
				ignoreResult = true;
				args = [value];
			} else {
				args = [value, continuation];
			}
		} else if (!continuation || isPassthroughContinuation(continuation)) {
			args = [value, voidExpression(), catchContinuation];
		} else {
			args = [value, continuation || voidExpression(), catchContinuation];
		}
		let helperName = useCallHelper ? "__call" : "__await";
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

	function relocateTail(state, awaitExpression, statementNode, target, temporary, exitIdentifier, breakIdentifier) {
		const tail = borrowTail(target);
		if (statementNode && statementNode.type === "ExpressionStatement" && statementNode.expression.type === "Identifier") {
			statementNode = null;
		}
		const blocks = removeUnnecessaryReturnStatements((statementNode ? [statementNode].concat(tail) : tail).filter(statement => statement.type !== "EmptyStatement"));
		if (blocks.length) {
			const fn = types.functionExpression(null, temporary ? [temporary] : [], blockStatement(blocks));
			target.replaceWith(returnStatement(awaitAndContinue(state, target, awaitExpression, fn), target.node));
		} else if (pathsReturnOrThrow(target).any) {
			target.replaceWith(returnStatement(awaitExpression, target.node));
			return target.get("argument");
		} else {
			target.replaceWith(returnStatement(awaitAndContinue(state, target, awaitExpression, helperReference(state, target, "__empty")), target.node));
		}
		const argument = target.get("argument");
		if (argument.isCallExpression()) {
			target.get("argument.arguments").forEach(awaitArgument => {
				if (awaitArgument.isFunction()) {
					rewriteFunctionBody(state, awaitArgument, exitIdentifier, breakIdentifier);
				}
			});
			return target.get("argument.arguments.0");
		}
	}

	function tryHelper(state, path, blockStatement, catchFunction) {
		const catchArgs = catchFunction ? [voidExpression(), catchFunction] : [];
		const body = blockStatement.body.filter(statement => statement.type !== "EmptyStatement");
		if (body.length === 1) {
			const statement = body[0];
			if (statement.type === "ReturnStatement") {
				let argument = statement.argument;
				while (argument.type === "AwaitExpression") {
					argument = argument.argument;
				}
				if (argument.type === "CallExpression" && argument.arguments.length === 0) {
					if (argument.callee.type === "Identifier" || argument.callee.type === "FunctionExpression") {
						return types.callExpression(helperReference(state, path, "__call"), [argument.callee].concat(catchArgs));
					}
				}
			}
		}
		return types.callExpression(helperReference(state, path, "__call"), [types.functionExpression(null, [], blockStatement)].concat(catchArgs));
	}

	function rewriteThisAndArgumentsExpression(rewritePath, targetPath) {
		let hasThis = false;
		let hasArguments = false;
		rewritePath.traverse({
			FunctionDeclaration(path) {
				path.skip();
			},
			FunctionExpression(path) {
				path.skip();
			},
			ThisExpression(path) {
				hasThis = true;
				path.replaceWith(types.identifier("_this"));
			},
			Identifier(path) {
				if (path.node.name === "arguments") {
					hasArguments = true;
					path.replaceWith(types.identifier("_arguments"));
				}
			},
			VariableDeclaration(path) {
				const scope = path.scope;
				if (path.node.kind === "var") {
					const declarations = path.get("declarations");
					for (const declaration of declarations) {
						const binding = scope.getBinding(declaration.node.id.name);
						if (binding.referencePaths.some(referencePath => referencePath.willIMaybeExecuteBefore(path)) || (binding.referencePaths.length && path.getDeepestCommonAncestorFrom(binding.referencePaths.concat([path])) !== path.parentPath)) {
							targetPath.scope.push({ id: declaration.node.id });
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
				const siblings = path.getAllPrevSiblings();
				if (siblings.some(sibling => !sibling.isFunctionDeclaration())) {
					const node = path.node;
					path.remove();
					siblings[0].insertBefore(node);
				}
			},
		});
		if (hasThis) {
			const binding = targetPath.scope.getBinding("_this");
			if (!binding || !binding.constant || binding.scope !== targetPath.scope) {
				targetPath.scope.push({ id: types.identifier("_this"), init: types.thisExpression() });
			}
		}
		if (hasArguments) {
			const binding = targetPath.scope.getBinding("_arguments");
			if (!binding || !binding.constant || binding.scope !== targetPath.scope) {
				targetPath.scope.push({ id: types.identifier("_arguments"), init: types.identifier("arguments") });
			}
		}
	}

	function functionize(expression) {
		return types.functionExpression(null, [], blockStatement([returnStatement(expression)]));
	}

	function blockStatement(statementOrStatements) {
		if ("length" in statementOrStatements) {
			return types.blockStatement(statementOrStatements.filter(statement => statement.type !== "EmptyStatement"));
		} else if (statementOrStatements.type !== "BlockStatement") {
			return types.blockStatement([statementOrStatements]);
		} else {
			return statementOrStatements;
		}
	}

	function inlineEvaluated(statements) {
		const returnIdentifier = identifierInSingleReturnStatement(statements);
		if (returnIdentifier) {
			return returnIdentifier;
		}
		return types.callExpression(types.functionExpression(null, [], blockStatement(statements)), []);
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
					const leftNode = left.node;
					const leftIdentifier = generateIdentifierForPath(left);
					declarations.push(types.variableDeclarator(leftIdentifier, leftNode));
					left.replaceWith(leftIdentifier);
					awaitExpression = parent.node.operator === "||" ? types.conditionalExpression(leftIdentifier, types.numericLiteral(0), awaitExpression) : types.conditionalExpression(leftIdentifier, awaitExpression, types.numericLiteral(0));
				}
			} else if (parent.isBinaryExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					const leftNode = left.node;
					const leftIdentifier = generateIdentifierForPath(left);
					declarations.push(types.variableDeclarator(leftIdentifier, leftNode));
					left.replaceWith(leftIdentifier);
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
						} else if (!callee.isIdentifier() || !(/^__/.test(callee.node.name) || (awaitPath.scope.getBinding(callee.node.name) || {}).constant)) {
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

	function buildBreakExitCheck(exitIdentifier, breakIdentifier) {
		if (breakIdentifier) {
			if (exitIdentifier) {
				return types.functionExpression(null, [], types.blockStatement([returnStatement(types.logicalExpression("||", breakIdentifier, exitIdentifier))]));
			} else {
				return types.functionExpression(null, [], types.blockStatement([returnStatement(breakIdentifier)]));
			}
		} else if (exitIdentifier) {
			return types.functionExpression(null, [], types.blockStatement([returnStatement(exitIdentifier)]));
		}
	}

	function replaceReturnsAndBreaks(path, exitIdentifier, breakIdentifier) {
		path.traverse({
			Function(path) {
				path.skip();
			},
			ReturnStatement(path) {
				if (!path.node._skip && exitIdentifier) {
					const newArgument = types.sequenceExpression([types.assignmentExpression("=", exitIdentifier, types.numericLiteral(1)), path.node.argument || voidExpression()]);
					path.replaceWith(returnStatement(newArgument, path.node))
				}
			},
			BreakStatement(path) {
				const replace = returnStatement(null, path.node);
				if (breakIdentifier) {
					path.replaceWithMultiple([
						types.expressionStatement(types.assignmentExpression("=", breakIdentifier, types.numericLiteral(1))),
						replace,
					]);
				} else {
					path.replaceWith(replace);
				}
			},
			ContinueStatement(path) {
				path.replaceWith(returnStatement(null, path.node));
			},
		});
	}

	function rewriteFunctionBody(state, path, exitIdentifier, breakIdentifier) {
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
							replaceReturnsAndBreaks(parent.get("consequent"), exitIdentifier, breakIdentifier);
							replaceReturnsAndBreaks(parent.get("alternate"), exitIdentifier, breakIdentifier);
							relocatedBlocks.push({
								relocate() {
									let resultIdentifier = null;
									if (!explicitExits.all && explicitExits.any) {
										resultIdentifier = path.scope.generateUidIdentifier("result");
										parent.insertAfter(types.ifStatement(exitIdentifier, returnStatement(resultIdentifier)));
									}
									if (!explicitExits.all) {
										relocateTail(state, inlineEvaluated([parent.node]), null, parent, resultIdentifier, exitIdentifier, breakIdentifier);
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
										finallyBody = finallyBody.concat(returnStatement(types.callExpression(helperReference(state, parent, "__rethrow"), [wasThrownIdentifier, resultIdentifier])));
										finallyName = "__finallyRethrows";
									} else {
										finallyName = "__finally";
									}
									finallyFunction = types.functionExpression(null, finallyArgs, blockStatement(finallyBody));
								}
								let catchExpression;
								let rewriteCatch;
								if (parent.node.handler) {
									const catchClause = parent.node.handler;
									rewriteCatch = catchClause.body.body.length;
									catchExpression = rewriteCatch ? types.functionExpression(null, [catchClause.param], catchClause.body) : helperReference(state, parent, "__empty");
								}
								const evalBlock = tryHelper(state, parent, parent.node.block, catchExpression);
								const evalPath = relocateTail(state, evalBlock, success, parent, temporary, exitIdentifier, breakIdentifier);
								if (evalPath && evalPath.isCallExpression()) {
									rewriteFunctionBody(state, evalPath.get("arguments.0"), exitIdentifier, breakIdentifier);
									if (rewriteCatch) {
										rewriteFunctionBody(state, evalPath.get("arguments.2"), exitIdentifier, breakIdentifier);
									}
								}
								if (finallyFunction && finallyName) {
									parent.get("argument").replaceWith(types.callExpression(helperReference(state, parent, finallyName), [parent.node.argument, finallyFunction]));
								}
							},
							path: parent,
						});
					} else if (parent.isForStatement() || parent.isWhileStatement() || parent.isDoWhileStatement() || parent.isForInStatement() || parent.isForOfStatement()) {
						const breaks = pathsBreak(parent);
						let breakIdentifier;
						const label = parent.parentPath.isLabeledStatement() ? parent.parent.label.name : null;
						if (breaks.any) {
							path.scope.push({ id: breakIdentifier = awaitPath.scope.generateUidIdentifier(label ? label + "Interrupt" : "interrupt") });
						}
						if (!exitIdentifier && explicitExits.any) {
							path.scope.push({ id: exitIdentifier = awaitPath.scope.generateUidIdentifier(label ? label + "Exit" : "exit") });
						}
						replaceReturnsAndBreaks(parent.get("body"), exitIdentifier, breakIdentifier);
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
										const exitCheck = buildBreakExitCheck(exitIdentifier, breakIdentifier);
										if (exitCheck) {
											params.push(unwrapReturnCallWithEmptyArguments(exitCheck, path.scope));
										}
										const loopCall = types.callExpression(helperReference(state, parent, isForIn ? forOwnBodyPath ? "__forOwn" : "__forIn" : "__forOf"), params);
										let resultIdentifier = null;
										if (explicitExits.any) {
											resultIdentifier = path.scope.generateUidIdentifier("result");
											parent.insertAfter(types.ifStatement(exitIdentifier, returnStatement(resultIdentifier)));
										}
										relocateTail(state, loopCall, null, label ? parent.parentPath : parent, resultIdentifier, exitIdentifier, breakIdentifier);
									},
									path: parent,
								})
							}
						} else {
							const forToIdentifiers = identifiersInForToLengthStatement(parent);
							let testExpression = parent.node.test;
							if (breakIdentifier) {
								const breakCheck = types.unaryExpression("!", breakIdentifier);
								testExpression = testExpression && (testExpression.type != "BooleanLiteral" || !testExpression.value) ? types.logicalExpression("&&", breakCheck, testExpression) : breakCheck;
							}
							if (exitIdentifier) {
								const exitCheck = types.unaryExpression("!", exitIdentifier);
								testExpression = testExpression && (testExpression.type != "BooleanLiteral" || !testExpression.value) ? types.logicalExpression("&&", exitCheck, testExpression) : exitCheck;
							}
							if (testExpression) {
								const testPath = parent.get("test");
								testPath.replaceWith(functionize(testExpression));
								rewriteFunctionBody(state, testPath, exitIdentifier);
							}
							const update = parent.get("update");
							if (update.node) {
								update.replaceWith(functionize(update.node));
							}
							relocatedBlocks.push({
								relocate() {
									const isDoWhile = parent.isDoWhileStatement();
									if (!breaks.any && !explicitExits.any && forToIdentifiers && !isDoWhile) {
										const loopCall = types.callExpression(helperReference(state, parent, "__forTo"), [forToIdentifiers.array, types.functionExpression(null, [forToIdentifiers.i], blockStatement(parent.node.body))])
										relocateTail(state, loopCall, null, parent, undefined, exitIdentifier, breakIdentifier);
									} else {
										const init = parent.get("init");
										if (init.node) {
											parent.insertBefore(init.node);
										}
										const forIdentifier = path.scope.generateUidIdentifier("for");
										const bodyFunction = types.functionExpression(null, [], blockStatement(parent.node.body));
										const testFunction = unwrapReturnCallWithEmptyArguments(parent.get("test").node || voidExpression(), path.scope);
										const updateFunction = unwrapReturnCallWithEmptyArguments(parent.get("update").node || voidExpression(), path.scope);
										const loopCall = isDoWhile ? types.callExpression(helperReference(state, parent, "__do"), [bodyFunction, testFunction]) : types.callExpression(helperReference(state, parent, "__for"), [testFunction, updateFunction, bodyFunction]);
										let resultIdentifier = null;
										if (explicitExits.any) {
											resultIdentifier = path.scope.generateUidIdentifier("result");
											parent.insertAfter(types.ifStatement(exitIdentifier, returnStatement(resultIdentifier)));
										}
										relocateTail(state, loopCall, null, parent, resultIdentifier, exitIdentifier, breakIdentifier);
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
							let breakIdentifier;
							if (!explicitExits.all && explicitExits.any && !exitIdentifier) {
								exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
								path.scope.push({ id: exitIdentifier });
							}
							let defaultIndex;
							testPaths.forEach((testPath, i) => {
								if (testPath.node) {
									testPath.replaceWith(functionize(testPath.node));
									rewriteFunctionBody(state, testPath, exitIdentifier);
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
									args.push(types.functionExpression(null, [], types.blockStatement(switchCase.consequent)));
									const caseExits = pathsReturnOrThrow(casePath);
									const caseBreaks = pathsBreak(casePath);
									const useBreakIdentifier = !caseBreaks.all && caseBreaks.any;
									if (useBreakIdentifier && !breakIdentifier) {
										breakIdentifier = parent.scope.generateUidIdentifier(label ? label.name + "Break" : "break");
										path.scope.push({ id: breakIdentifier });
									}
									if (caseExits.any || caseBreaks.any) {
										casePath.traverse({
											Function(path) {
												path.skip();
											},
											BreakStatement(path) {
												path.replaceWith(returnStatement(null, path.node));
												if (useBreakIdentifier) {
													path.insertBefore(types.expressionStatement(types.assignmentExpression("=", breakIdentifier, types.numericLiteral(1))));
												}
											},
											ReturnStatement(path) {
												if (exitIdentifier && !path.node._skip) {
													path.replaceWith(returnStatement(path.node.argument, path.node));
													path.insertBefore(types.expressionStatement(types.assignmentExpression("=", exitIdentifier, types.numericLiteral(1))));
												}
											},
										});
									}
									if (!caseExits.any && !caseBreaks.any) {
										args.push(helperReference(state, parent, "__empty"));
									} else if (!(caseExits.all || caseBreaks.all)) {
										const breakCheck = buildBreakExitCheck(caseExits.any ? exitIdentifier : null, useBreakIdentifier ? breakIdentifier : null);
										if (breakCheck) {
											args.push(breakCheck);
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
									const switchCall = types.callExpression(helperReference(state, parent, "__switch"), [discriminant.node, types.arrayExpression(cases)]);
									relocateTail(state, switchCall, null, label ? parent.parentPath : parent, resultIdentifier, exitIdentifier, breakIdentifier);
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
									relocateTail(state, originalArgument, types.emptyStatement(), parent, null, exitIdentifier, breakIdentifier);
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
									relocateTail(state, awaitExpression, parent.node, parent, resultIdentifier, exitIdentifier, breakIdentifier);
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
				if (/^__/.test(path.node.name) && dependencies.indexOf(path.node.name) == -1) {
					dependencies.push(path.node.name);
				}
			}
		});
		return dependencies;
	}

	function helperReference(state, path, name) {
		const file = path.scope.hub.file;
		let result = file.declarations[name];
		if (!result) {
			result = file.declarations[name] = types.identifier(name);
			if (state.opts.externalHelpers) {
				file.path.unshiftContainer("body", types.importDeclaration([types.importSpecifier(result, result)], types.stringLiteral("babel-plugin-transform-async-to-promises/helpers")));
			} else {
				if (!helpers) {
					// Read helpers from ./helpers.js
					const newHelpers = [];
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
				file.path.unshiftContainer("body", helper.value);
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
					const body = path.get("body").isBlockStatement() ? path.node.body : blockStatement([types.returnStatement(path.node.body)]);
					path.replaceWith(types.functionExpression(null, node.params, body, false, node.async));
				}
			},
			FunctionExpression(path) {
				if (path.node.async && isCompatible(path.get("body"))) {
					rewriteThisAndArgumentsExpression(path, path);
					rewriteFunctionBody(this, path);
					path.replaceWith(types.callExpression(helperReference(this, path, "__async"), [
						types.functionExpression(null, path.node.params, path.node.body)
					]));
				}
			},
			ClassMethod(path) {
				if (path.node.async && isCompatible(path.get("body"))) {
					if (path.node.kind === "method") {
						const body = path.get("body");
						body.replaceWith(types.blockStatement([types.returnStatement(types.callExpression(helperReference(this, path, "__call"), [types.functionExpression(null, [], body.node)]))]));
						const migratedPath = body.get("body.0.argument.arguments.0");
						rewriteThisAndArgumentsExpression(migratedPath, path);
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
