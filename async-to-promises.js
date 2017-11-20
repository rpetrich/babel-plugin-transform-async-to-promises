module.exports = function({ types, template }) {

	function statementForPath(path) {
		while (path && !path.isStatement()) {
			path = path.parentPath;
		}
		return path;
	}

	function pathsReachNodeTypes(path, matchingNodeTypes) {
		const match = { all: false, any: false }
		if (!path || !path.node) {
			return match;
		}
		if (matchingNodeTypes.indexOf(path.node.type) !== -1) {
			match.all = true;
			match.any = true;
			return match;
		}
		const visitor = {
			Conditional(path) {
				path.skip();
				const test = pathsReachNodeTypes(path.get("test"), matchingNodeTypes);
				const consequent = pathsReachNodeTypes(path.get("consequent"), matchingNodeTypes);
				const alternate = pathsReachNodeTypes(path.get("alternate"), matchingNodeTypes);
				this.match.any = this.match.any || test.any || consequent.any || alternate.any;
				if (test.all || (consequent.all && alternate.all)) {
					this.match.all = true;
					path.stop();
				}
			},
			SwitchStatement(path) {
				path.skip();
				// TODO: Support checking that all cases match or fallthrough
				const discriminant = pathsReachNodeTypes(path.get("discriminant"), matchingNodeTypes);
				this.match.any = this.match.any || discriminant.any;
				if (discriminant.all) {
					this.match.all = true;
					path.stop();
				}
			},
			DoWhileStatement(path) {
				path.skip();
				const body = pathsReachNodeTypes(path.get("body"), matchingNodeTypes);
				const test = pathsReachNodeTypes(path.get("test"), matchingNodeTypes);
				this.match.any = this.match.any || body.any || test.any;
				if (body.all || test.all) {
					this.match.all = true;
					path.stop();
				}
			},
			WhileStatement(path) {
				path.skip();
				// TODO: Support detecting break/return statements
				const test = pathsReachNodeTypes(path.get("test"), matchingNodeTypes);
				const body = pathsReachNodeTypes(path.get("body"), matchingNodeTypes);
				this.match.any = this.match.any || test.any || body.any;
				if (test.all) {
					this.match.all = true;
					path.stop();
				}
			},
			ForXStatement(path) {
				path.skip();
				const right = pathsReachNodeTypes(path.get("right"), matchingNodeTypes);
				const body = pathsReachNodeTypes(path.get("body"), matchingNodeTypes);
				this.match.any = this.match.any || right.any || body.any;
				if (right.all) {
					this.match.all = true;
					path.stop();
				}
			},
			ForStatement(path) {
				path.skip();
				const init = pathsReachNodeTypes(path.get("init"), matchingNodeTypes);
				const test = pathsReachNodeTypes(path.get("test"), matchingNodeTypes);
				const body = pathsReachNodeTypes(path.get("body"), matchingNodeTypes);
				const update = pathsReachNodeTypes(path.get("update"), matchingNodeTypes);
				this.match.any = this.match.any || init.any || right.any || body.any || update.any;
				if (init.all || test.all) {
					this.match.all = true;
					path.stop();
				}
			},
			LogicalExpression(path) {
				path.skip();
				const left = pathsReachNodeTypes(path.get("left"), matchingNodeTypes);
				const right = pathsReachNodeTypes(path.get("left"), matchingNodeTypes);
				this.match.any = this.match.any || left.any || right.any;
				if (left.all) {
					this.match.all = true;
					path.stop();
				}
			},
			ReturnStatement(path) {
				path.stop();
			},
			BreakStatement(path) {
				path.stop();
			},
			ContinueStatement(path) {
				path.stop();
			},
			ThrowStatement(path) {
				// TODO: Handle throw statements correctly
				path.stop();
			},
			TryStatement(path) {
				path.skip();
				const catchClause = path.get("handler");
				if (catchClause.node) {
					const handler = pathsReachNodeTypes(catchClause, matchingNodeTypes);
					this.match.any = this.match.any || handler.any;
					if (handler.all) {
						this.match.all = true;
						path.stop();
					}
				} else {
					path.stop();
				}
			},
			Function(path) {
				path.skip();
			}
		};
		for (let nodeType of matchingNodeTypes) {
			visitor[nodeType] = function(path) {
				this.match.all = true;
				this.match.any = true;
				path.stop();
			};
		}
		path.traverse(visitor, {match});
		return match;
	}

	function isCompatible(path) {
		let result = true;
		let insideIncompatble = 0;
		path.traverse({
			ContinueStatement(path) {
				if (path.node.label) {
					result = false;
					path.stop();
				}
			},
			Function(path) {
				path.skip();
			},
			Loop: {
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
				if (argument.type === "Identifier") {
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
		let ret = awaitAndContinue(awaitExpression, types.functionExpression(null, temporary ? [temporary] : [], types.blockStatement(blocks)));
		target.replaceWith(types.returnStatement(ret));
		if (exitIdentifier) {
			const body = target.get("argument.arguments.1.body");
			body.traverse({
				Function(path) {
					path.skip();
				},
				ReturnStatement(path) {
					path.get("argument").replaceWith(types.sequenceExpression([types.assignmentExpression("=", exitIdentifier, types.numericLiteral(1)), path.node.argument]));
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

	function inlineEvaluated(statements) {
		const returnIdentifier = identifierInSingleReturnStatement(statements);
		if (returnIdentifier) {
			return returnIdentifier;
		}
		return types.callExpression(types.functionExpression(null, [], types.blockStatement(statements)), []);
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
					const body = path.get("body").isBlockStatement() ? path.node.body : types.blockStatement([types.returnStatement(path.node.body)]);
					path.replaceWith(types.functionExpression(null, node.params, body, false, node.async));
					rewriteThisExpression(path, path.parentPath);
				}
			},
			FunctionExpression(path) {
				if (path.node.async && isCompatible(path.get("body"))) {
					this.usedAsyncHelper = true;
					const that = this;
					const relocatedBlocks = [];
					rewriteThisExpression(path, path);
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
						let parent = awaitPath.parentPath;
						const node = awaitPath.node;
						const uid = awaitPath.scope.generateUidIdentifierBasedOnNode(awaitPath.node.argument);
						awaitPath.replaceWith(uid);
						const statement = statementForPath(awaitPath);
						let expressionToAwait = node.argument;
						const declarations = [];
						while (parent !== statement) {
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
									expressionToAwait = parent.node.operator === "||" ? types.conditionalExpression(leftIdentifier, types.numericLiteral(0), expressionToAwait) : types.conditionalExpression(leftIdentifier, expressionToAwait, types.numericLiteral(0));
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
										expressionToAwait = types.conditionalExpression(test.node, consequent.node.argument, expressionToAwait);
										parent.replaceWith(parent.node.alternate);
									} else {
										const testNode = test.node;
										const testIdentifier = awaitPath.scope.generateUidIdentifierBasedOnNode(testNode);
										declarations.push(types.variableDeclarator(testIdentifier, testNode));
										test.replaceWith(testIdentifier);
										expressionToAwait = consequent !== awaitPath ? types.conditionalExpression(testIdentifier, types.numericLiteral(0), expressionToAwait) : types.conditionalExpression(testIdentifier, expressionToAwait, types.numericLiteral(0));
									}
								}
							}
							awaitPath = parent;
							parent = parent.parentPath;
						}
						if (declarations.length) {
							const node = statement.node;
							statement.insertBefore(types.variableDeclaration("var", declarations));
						}
						that.usedAwaitHelper = true;
						let exitIdentifier;
						while (parent !== path && parent) {
							const index = relocatedBlocks.findIndex(block => block.path === parent);
							if (index !== -1) {
								if (!exitIdentifier) {
									exitIdentifier = relocatedBlocks[index].identifier;
								}
							} else {
								const block = parent;
								if (block.isIfStatement()) {
									const explicitExits = pathsReachNodeTypes(parent, ["ReturnStatement", "ThrowStatement"]);
									if (!explicitExits.all) {
										if (!exitIdentifier && explicitExits.any) {
											exitIdentifier = awaitPath.scope.generateUidIdentifier("exit");
											path.scope.push({ id: exitIdentifier });
										}
										relocatedBlocks.push({
											relocate() {
												let resultIdentifier = null;
												if (explicitExits.any) {
													resultIdentifier = path.scope.generateUidIdentifier("result");
													block.insertAfter(types.ifStatement(exitIdentifier, types.returnStatement(resultIdentifier)));
												}
												relocateTail(inlineEvaluated([block.node]), null, block, resultIdentifier);
											},
											path: parent,
										});
									}
								} else if (block.isTryStatement()) {
									const explicitExits = pathsReachNodeTypes(parent, ["ReturnStatement", "ThrowStatement"]);
									relocatedBlocks.push({
										relocate() {
											const temporary = explicitExits.all ? path.scope.generateUidIdentifier("result") : null;
											const success = explicitExits.all ? types.returnStatement(temporary) : null;
											let evalBlock = tryHelper(block.node.block);
											that.usedTryHelper = true;
											let finallyFunction;
											if (block.node.finalizer) {
												that.usedFinallyHelper = true;
												let finallyArgs = [];
												let finallyBody = block.node.finalizer.body;
												if (!pathsReachNodeTypes(block.get("finalizer"), ["ReturnStatement", "ThrowStatement"]).all) {
													const resultIdentifier = path.scope.generateUidIdentifier("result");
													const wasThrownIdentifier = path.scope.generateUidIdentifier("wasThrown");
													finallyArgs = [wasThrownIdentifier, resultIdentifier];
													finallyBody = finallyBody.concat(types.ifStatement(wasThrownIdentifier, types.throwStatement(resultIdentifier), types.returnStatement(resultIdentifier)));
												}
												finallyFunction = types.functionExpression(null, finallyArgs, types.blockStatement(finallyBody));
											}
											if (block.node.handler) {
												const catchFunction = types.functionExpression(null, [block.node.handler.param], block.node.handler.body);
												evalBlock = types.callExpression(types.memberExpression(evalBlock, types.identifier("then")), [voidExpression(), catchFunction]);
											}
											relocateTail(evalBlock, success, block, temporary)
											if (finallyFunction) {
												const returnArgument = block.get("argument");
												returnArgument.replaceWith(types.callExpression(types.identifier("__finally"), [returnArgument.node, finallyFunction]));
											}
										},
										path: parent,
									});
								} else if (block.isForStatement()) {
									const explicitExits = pathsReachNodeTypes(parent, ["ReturnStatement", "ThrowStatement"]);
									const breaks = pathsReachNodeTypes(parent, ["BreakStatement", "ThrowStatement"]);
									let breakIdentifier;
									if (breaks.any) {
										path.scope.push({ id: breakIdentifier = awaitPath.scope.generateUidIdentifier("interrupt") });
									}
									if (!exitIdentifier && explicitExits.any) {
										path.scope.push({ id: exitIdentifier = awaitPath.scope.generateUidIdentifier("exit") });
									}
									block.get("body").traverse({
										Function(path) {
											path.skip();
										},
										ReturnStatement(path) {
											if (!path.node._skip && exitIdentifier) {
												path.get("argument").replaceWith(types.sequenceExpression([types.assignmentExpression("=", exitIdentifier, types.numericLiteral(1)), path.node.argument]));
											}
										},
										BreakStatement(path) {
											const replace = breakIdentifier ? types.returnStatement(types.assignmentExpression("=", breakIdentifier, types.numericLiteral(1))) : types.returnStatement();
											replace._skip = true;
											path.replaceWith(replace);
										},
										ContinueStatement(path) {
											const replace = types.returnStatement();
											replace._skip = true;
											path.replaceWith(replace);
										},
									});
									const forToIdentifiers = identifiersInForToLengthStatement(block);
									relocatedBlocks.push({
										relocate() {
											const body = block.node.body.type === "BlockStatement" ? block.node.body.body : [block.node.body];
											if (!breaks.any && !explicitExits.any && forToIdentifiers) {
												// TODO: Validate that body doesn't reassign array or i
												const loopCall = types.callExpression(types.identifier("__forTo"), [forToIdentifiers.array, types.functionExpression(null, [forToIdentifiers.i], types.blockStatement(body))])
												relocateTail(loopCall, null, block);
												that.usedForToHelper = true;
											} else {
												const init = block.get("init");
												if (init.node) {
													block.insertBefore(init.node);
												}
												const forIdentifier = path.scope.generateUidIdentifier("for");
												const bodyFunction = types.functionExpression(null, [], types.blockStatement(body));
												let testExpression = block.node.test;
												if (breakIdentifier) {
													testExpression = types.logicalExpression("&&", types.unaryExpression("!", breakIdentifier), testExpression);
												}
												const testFunction = block.get("test") ? types.functionExpression(null, [], types.blockStatement([types.returnStatement(testExpression)])) : voidExpression();
												const updateFunction = block.get("update") ? types.functionExpression(null, [], types.blockStatement([types.expressionStatement(block.node.update)])) : voidExpression();
												const loopCall = types.callExpression(types.identifier("__for"), [testFunction, updateFunction || voidExpression(), bodyFunction]);
												let resultIdentifier = null;
												if (explicitExits.any) {
													resultIdentifier = path.scope.generateUidIdentifier("result");
													block.insertAfter(types.ifStatement(exitIdentifier, types.returnStatement(resultIdentifier)));
												}
												relocateTail(loopCall, null, block, resultIdentifier, exitIdentifier, breakIdentifier);
												that.usedForHelper = true;
											}
										},
										path: parent,
									});
								}
							}
							parent = parent.parentPath;
						}
						relocateTail(expressionToAwait, statement.node, statement, uid, exitIdentifier);
					}
					for (const block of relocatedBlocks) {
						block.relocate();
					}
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
								cycle();
								function cycle() {
									__try(test).then(checkTestResult, reject);
								}
								function checkTestResult(shouldContinue) {
									if (shouldContinue) {
										__try(body).then(update).then(cycle, reject);
									} else {
										resolve();
									}
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
