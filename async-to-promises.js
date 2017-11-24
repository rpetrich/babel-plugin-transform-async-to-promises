module.exports = function({ types, template }) {

	function statementForPath(path) {
		while (path && !path.isStatement()) {
			path = path.parentPath;
		}
		return path;
	}

	function hasAncestor(path, parentPath) {
		while (path) {
			if (path === parentPath) {
				return true;
			}
		}
		return false;
	}

	function pathsReachNodeTypes(matchingNodeTypes) {
		function visit(path, result) {
			if (matchingNodeTypes.indexOf(path.node.type) !== -1) {
				result.any = true;
				result.all = true;
				return true;
			}
			if (path.isConditional()) {
				const test = match(path.get("test"));
				const consequent = match(path.get("consequent"));
				const alternate = match(path.get("alternate"));
				result.any = result.any || test.any || consequent.any || alternate.any;
				return result.all = (test.all || (consequent.all && alternate.all));
			}
			if (path.isSwitchStatement()) {
				// TODO: Support checking that all cases match or fallthrough
				const discriminant = match(path.get("discriminant"));
				result.any = result.any || discriminant.any;
				return result.all = discriminant.all;
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
				const catchClause = path.get("handler");
				if (catchClause.node) {
					const handler = match(catchClause);
					result.any = result.any || handler.any;
					if (handler.all) {
						return result.all = true;
					} else {
						return false;
					}
				} else {
					return true;
				}
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
				return { all: false, any: false };
			}
			const match = { all: false, any: false };
			if (typeof visit(path, match) === "undefined") {
				path.traverse(visitor, { match });
			}
			return match;
		}
		return match;
	}

	const pathsReturnOrThrow = pathsReachNodeTypes(["ReturnStatement", "ThrowStatement"]);
	const pathsBreak = pathsReachNodeTypes(["BreakStatement"]);

	function isCompatible(path) {
		let result = true;
		let insideIncompatble = 0;
		path.traverse({
			BreakStatement(path) {
				if (path.node.label) {
					result = false;
					path.stop();
				}
			},
			ContinueStatement(path) {
				if (path.node.label) {
					result = false;
					path.stop();
				}
			},
			Function(path) {
				path.skip();
			},
			ForOfStatement: {
				enter(path) {
					insideIncompatble++;
				},
				exit(path) {
					insideIncompatble--;
				}
			},
			ForInStatement: {
				enter(path) {
					insideIncompatble++;
				},
				exit(path) {
					insideIncompatble--;
				}
			},
			SwitchStatement: {
				enter(path) {
					insideIncompatble++;
				},
				exit(path) {
					insideIncompatble++;
				}
			},
			AwaitExpression(path) {
				if (insideIncompatble) {
					result = false;
					path.stop();
				}
			}
		});
		return result;
	}

	function firstAwait(path) {
		let result;
		path.traverse({
			Function(path) {
				path.skip();
			},
			AwaitExpression(path) {
				result = path;
			}
		})
		return result;
	}

	function identifierInSingleReturnStatement(statements) {
		if (statements.length === 1) {
			if (statements[0].type === "ReturnStatement") {
				const argument = statements[0].argument;
				if (argument && argument.type === "Identifier") {
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

	function isPassthroughContinuation(continuation) {
		if (!continuation) {
			return true;
		}
		if (continuation.params.length === 1) {
			const returnIdentifier = identifierInSingleReturnStatement(continuation.body.body);
			if (returnIdentifier && returnIdentifier.name === continuation.params[0].name) {
				return true;
			}
		}
		return false;
	}

	function awaitAndContinue(target, continuation, catchContinuation) {
		let args;
		if (!catchContinuation) {
			if (isPassthroughContinuation(continuation)) {
				return target;
			}
			args = [target, continuation];
		} else if (isPassthroughContinuation(continuation)) {
			args = [target, voidExpression(), catchContinuation];
		} else {
			args = [target, continuation, catchContinuation];
		}
		return types.callExpression(types.identifier("__await"), args);
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

	function relocateTail(awaitExpression, statementNode, target, temporary, exitIdentifier) {
		const blocks = (statementNode ? [statementNode] : []).concat(borrowTail(target));
		let ret = awaitExpression;
		let isIIFE = false;
		if (blocks.length) {
			ret = awaitAndContinue(ret, types.functionExpression(null, temporary ? [temporary] : [], blockStatement(blocks)));
		} else if (ret.type === "CallExpression" && ret.arguments.length === 0 && ret.callee.type === "FunctionExpression" && ret.callee.params.length === 0) {
			target.replaceWithMultiple(ret.callee.body.body);
			isIIFE = true;
			return;
		}
		target.replaceWith(types.returnStatement(ret));
		if (exitIdentifier && blocks.length) {
			if (!isIIFE && target.node.argument.arguments.length < 2) {
				return;
			}
			const body = isIIFE ? target : target.get("argument.arguments.1.body");
			body.traverse({
				Function(path) {
					path.skip();
				},
				ReturnStatement(path) {
					const parent = path.parentPath;
					if (!(parent.isIfStatement() && parent.get("test").isIdentifier() && parent.get("test").node.name === exitIdentifier.name) &&
						!(path.get("argument").isSequenceExpression() && path.get("argument.expressions.0").isAssignmentExpression() && path.get("argument.expressions.0.left").isIdentifier() && path.node.argument.expressions[0].left.name === exitIdentifier.name))
					{
						path.get("argument").replaceWith(types.sequenceExpression([types.assignmentExpression("=", exitIdentifier, types.numericLiteral(1)), path.node.argument]));
					}
				},
			});
		}
	}

	function tryHelper(blockStatement) {
		if (blockStatement.body.length === 1) {
			const statement = blockStatement.body[0];
			if (statement.type === "ReturnStatement") {
				const argument = statement.argument;
				if (argument.type === "CallExpression" && argument.arguments.length === 0 && argument.callee.type === "Identifier") {
					return types.callExpression(types.identifier("__try"), [argument.callee]);
				}
			}
		}
		return types.callExpression(types.identifier("__try"), [types.functionExpression(null, [], blockStatement)])
	}

	function rewriteThisExpression(rewritePath, targetPath) {
		let hasThis = false;
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
			}
		});
		if (hasThis) {
			const binding = targetPath.scope.getBinding("_this");
			if (!binding || !binding.constant || binding.scope !== targetPath.scope) {
				targetPath.scope.push({ id: types.identifier("_this"), init: types.thisExpression() });
				// targetPath.insertBefore(types.variableDeclaration("var", [types.variableDeclarator(types.identifier("_this"), types.thisExpression())]));
			}
		}
	}

	function functionize(expression) {
		return types.functionExpression(null, [], blockStatement([types.returnStatement(expression)]));
	}

	function blockStatement(statementOrStatements) {
		if (statementOrStatements.length) {
			return types.blockStatement(statementOrStatements);
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

	function extractDeclarations(awaitPath) {
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
					const leftIdentifier = awaitPath.scope.generateUidIdentifierBasedOnNode(leftNode);
					declarations.push(types.variableDeclarator(leftIdentifier, leftNode));
					left.replaceWith(leftIdentifier);
					awaitPath.replaceWith(parent.node.operator === "||" ? types.conditionalExpression(leftIdentifier, types.numericLiteral(0), awaitPath.node) : types.conditionalExpression(leftIdentifier, awaitPath.node, types.numericLiteral(0)));
				}
			} else if (parent.isBinaryExpression()) {
				const left = parent.get("left");
				if (awaitPath !== left) {
					const leftNode = left.node;
					const leftIdentifier = awaitPath.scope.generateUidIdentifierBasedOnNode(leftNode);
					declarations.push(types.variableDeclarator(leftIdentifier, leftNode));
					left.replaceWith(leftIdentifier);
				}
			} else if (parent.isConditionalExpression()) {
				const test = parent.get("test");
				if (awaitPath !== test) {
					const consequent = parent.get("consequent");
					if (consequent !== awaitPath && consequent.isAwaitExpression()) {
						awaitPath.replaceWith(types.conditionalExpression(test.node, consequent.node.argument, awaitPath.node));
						parent.replaceWith(parent.node.alternate);
					} else {
						const testNode = test.node;
						const testIdentifier = awaitPath.scope.generateUidIdentifierBasedOnNode(testNode);
						declarations.push(types.variableDeclarator(testIdentifier, testNode));
						test.replaceWith(testIdentifier);
						awaitPath.replaceWith(consequent !== awaitPath ? types.conditionalExpression(testIdentifier, types.numericLiteral(0), awaitPath.node) : types.conditionalExpression(testIdentifier, awaitPath.node, types.numericLiteral(0)));
					}
				}
			}
			awaitPath = parent;
		} while (!awaitPath.isStatement());
		return declarations;
	}

	function rewriteFunctionBody(path, state) {
		const relocatedBlocks = [];
		rewriteThisExpression(path, path);
		let exitIdentifier;
		for (;;) {
			let awaitPath;
			path.traverse({
				Function(path) {
					path.skip();
				},
				AwaitExpression(path) {
					awaitPath = path;
				}
			});
			if (!awaitPath) {
				break;
			}
			const originalAwaitPath = awaitPath;
			const node = awaitPath.node;
			let expressionToAwait = node.argument;
			let processExpressions = true;
			do {
				const parent = awaitPath.parentPath;
				if (!relocatedBlocks.find(block => block.path === parent)) {
					const explicitExits = pathsReturnOrThrow(parent);
					if (parent.isIfStatement()) {
						if (awaitPath !== parent.get("test")) {
							if (!explicitExits.all && explicitExits.any && !exitIdentifier) {
								exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
								path.scope.push({ id: exitIdentifier });
							}
							relocatedBlocks.push({
								relocate() {
									let resultIdentifier = null;
									if (!explicitExits.all && explicitExits.any) {
										resultIdentifier = path.scope.generateUidIdentifier("result");
										parent.insertAfter(types.ifStatement(exitIdentifier, types.returnStatement(resultIdentifier)));
									}
									relocateTail(inlineEvaluated([parent.node]), null, parent, resultIdentifier);
								},
								path: parent,
							});
						}
					} else if (parent.isTryStatement()) {
						relocatedBlocks.push({
							relocate() {
								const temporary = explicitExits.all ? path.scope.generateUidIdentifier("result") : null;
								const success = explicitExits.all ? types.returnStatement(temporary) : null;
								let evalBlock = tryHelper(parent.node.block);
								state.usedTryHelper = true;
								let finallyFunction;
								if (parent.node.finalizer) {
									state.usedFinallyHelper = true;
									let finallyArgs = [];
									let finallyBody = parent.node.finalizer.body;
									if (!pathsReturnOrThrow(parent.get("finalizer")).all) {
										const resultIdentifier = path.scope.generateUidIdentifier("result");
										const wasThrownIdentifier = path.scope.generateUidIdentifier("wasThrown");
										finallyArgs = [wasThrownIdentifier, resultIdentifier];
										finallyBody = finallyBody.concat(types.ifStatement(wasThrownIdentifier, types.throwStatement(resultIdentifier), types.returnStatement(resultIdentifier)));
									}
									finallyFunction = types.functionExpression(null, finallyArgs, blockStatement(finallyBody));
								}
								if (parent.node.handler) {
									const catchFunction = types.functionExpression(null, [parent.node.handler.param], parent.node.handler.body);
									evalBlock = types.callExpression(types.memberExpression(evalBlock, types.identifier("then")), [voidExpression(), catchFunction]);
								}
								relocateTail(evalBlock, success, parent, temporary)
								if (finallyFunction) {
									const returnArgument = parent.get("argument");
									returnArgument.replaceWith(types.callExpression(types.identifier("__finally"), [returnArgument.node, finallyFunction]));
								}
							},
							path: parent,
						});
					} else if (parent.isForStatement() || parent.isWhileStatement() || parent.isDoWhileStatement()) {
						const breaks = pathsBreak(parent);
						let breakIdentifier;
						if (breaks.any) {
							path.scope.push({ id: breakIdentifier = awaitPath.scope.generateUidIdentifier("interrupt") });
						}
						if (!exitIdentifier && explicitExits.any) {
							path.scope.push({ id: exitIdentifier = awaitPath.scope.generateUidIdentifier("exit") });
						}
						parent.get("body").traverse({
							Function(path) {
								path.skip();
							},
							ReturnStatement(path) {
								if (!path.node._skip && exitIdentifier) {
									path.get("argument").replaceWith(types.sequenceExpression([types.assignmentExpression("=", exitIdentifier, types.numericLiteral(1)), path.node.argument]));
								}
							},
							BreakStatement(path) {
								const replace = types.returnStatement();
								replace._skip = true;
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
								const replace = types.returnStatement();
								replace._skip = true;
								path.replaceWith(replace);
							},
						});
						const forToIdentifiers = identifiersInForToLengthStatement(parent);
						let testExpression = parent.node.test;
						if (breakIdentifier) {
							const breakCheck = types.unaryExpression("!", breakIdentifier);
							testExpression = testExpression ? types.logicalExpression("&&", breakCheck, testExpression) : breakCheck;
						}
						if (testExpression) {
							const testPath = parent.get("test");
							testPath.replaceWith(functionize(testExpression));
							rewriteFunctionBody(testPath, state);
						}
						const update = parent.get("update");
						if (update.node) {
							update.replaceWith(functionize(update.node));
						}
						relocatedBlocks.push({
							relocate() {
								const isDoWhile = parent.isDoWhileStatement();
								if (!breaks.any && !explicitExits.any && forToIdentifiers && !isDoWhile) {
									// TODO: Validate that body doesn't reassign array or i
									const loopCall = types.callExpression(types.identifier("__forTo"), [forToIdentifiers.array, types.functionExpression(null, [forToIdentifiers.i], blockStatement(parent.node.body))])
									relocateTail(loopCall, null, parent);
									state.usedForToHelper = true;
								} else {
									const init = parent.get("init");
									if (init.node) {
										parent.insertBefore(init.node);
									}
									const forIdentifier = path.scope.generateUidIdentifier("for");
									const bodyFunction = types.functionExpression(null, [], blockStatement(parent.node.body));
									const testFunction = parent.get("test").node || voidExpression();
									const updateFunction = parent.get("update").node || voidExpression();
									const loopCall = isDoWhile ? types.callExpression(types.identifier("__do"), [bodyFunction, testFunction]) : types.callExpression(types.identifier("__for"), [testFunction, updateFunction, bodyFunction]);
									let resultIdentifier = null;
									if (explicitExits.any) {
										resultIdentifier = path.scope.generateUidIdentifier("result");
										parent.insertAfter(types.ifStatement(exitIdentifier, types.returnStatement(resultIdentifier)));
									}
									relocateTail(loopCall, null, parent, resultIdentifier, exitIdentifier, breakIdentifier);
									if (isDoWhile) {
										state.usedDoHelper = true;
									} else {
										state.usedForHelper = true;
									}
								}
							},
							path: parent,
						});
					}
				}
				if (processExpressions && parent.isStatement()) {
					if (!awaitPath.isFunction()) {
						const uid = originalAwaitPath.scope.generateUidIdentifierBasedOnNode(originalAwaitPath.node.argument);
						const originalExpression = originalAwaitPath.node;
						originalAwaitPath.replaceWith(uid);
						const declarations = extractDeclarations(originalAwaitPath);
						if (declarations.length) {
							parent.insertBefore(types.variableDeclaration("var", declarations));
						}
						const currentAwaitPath = awaitPath;
						relocatedBlocks.push({
							relocate() {
								relocateTail(originalExpression.argument, parent.node, parent, uid, exitIdentifier);
							},
							path: parent,
						});
					}
					processExpressions = false;
				}
				awaitPath = parent;
			} while (awaitPath !== path);
			state.usedAwaitHelper = true;
		}
		for (const block of relocatedBlocks) {
			block.relocate();
		}
	}

	return {
		visitor: {
			FunctionDeclaration(path) {
				const node = path.node;
				if (node.async && isCompatible(path.get("body"))) {
					path.remove();
					path.scope.parent.push({ id: node.id, init: types.functionExpression(null, node.params, node.body, node.generator, node.async) });
				}
			},
			ArrowFunctionExpression(path) {
				const node = path.node;
				if (node.async && isCompatible(path.get("body"))) {
					const body = path.get("body").isBlockStatement() ? path.node.body : blockStatement([types.returnStatement(path.node.body)]);
					path.replaceWith(types.functionExpression(null, node.params, body, false, node.async));
					rewriteThisExpression(path, path.parentPath);
				}
			},
			FunctionExpression(path) {
				if (path.node.async && isCompatible(path.get("body"))) {
					rewriteFunctionBody(path, this);
					this.usedAsyncHelper = true;
					path.replaceWith(types.callExpression(types.identifier("__async"), [
						types.functionExpression(null, path.node.params, path.node.body)
					]));
				}
			},
			Program: {
				exit(path) {
					const body = path.get("body.0");
					if (this.usedAsyncHelper) {
						body.insertBefore(template(`function __async(f) {
							return function() {
								try {
									return Promise.resolve(f.apply(this, arguments));
								} catch(e) {
									return Promise.reject(e);
								}
							}
						}`)());		
					}
					if (this.usedAwaitHelper) {
						body.insertBefore(template(`function __await(value, then) {
							return (value && value.then ? value : Promise.resolve(value)).then(then);
						}`)());
					}
					if (this.usedForToHelper) {
						this.usedForHelper = true;
						body.insertBefore(template(`function __forTo(array, body) {
							var i = 0;
							return __for(function() { return i < array.length; }, function() { i++; }, function() { return body(i); });
						}`)());
					}
					if (this.usedForHelper) {
						this.usedTryHelper = true;
						body.insertBefore(template(`function __for(test, update, body) {
							return new Promise(function(resolve, reject) {
								var result;
								cycle();
								function cycle() {
									__try(test).then(checkTestResult, reject);
								}
								function stashAndUpdate(value) {
									result = value;
									return update();
								}
								function checkTestResult(shouldContinue) {
									if (shouldContinue) {
										__try(body).then(stashAndUpdate).then(cycle, reject);
									} else {
										resolve(result);
									}
								}
							});
						}`)());		
					}
					if (this.usedDoHelper) {
						this.usedTryHelper = true;
						body.insertBefore(template(`function __do(body, test) {
							return new Promise(function(resolve, reject) {
								cycle();
								function cycle() {
									return __try(body).then(checkTestResult, reject);
								}
								function checkTestResult(value) {
									__try(test).then(function(shouldContinue) {
										if (shouldContinue) {
											cycle();
										} else {
											resolve(value);
										}
									}, reject);
								}
							});
						}`)());		
					}
					if (this.usedTryHelper) {
						body.insertBefore(template(`function __try(body) {
							return new Promise(function (resolve) { resolve(body()); });
						}`)());		
					}
					if (this.usedFinallyHelper) {
						body.insertBefore(template(`function __finally(promise, finalizer) {
							return promise.then(finalizer.bind(null, false), finalizer.bind(null, true));
						}`)());		
					}
					path.stop();
				}
			}
		}
	}
}
