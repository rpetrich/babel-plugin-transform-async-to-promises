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
	let insideLoop = 0;
	path.traverse({
		Function(path) {
			path.skip();
		},
		Loop: {
			enter(path) {
				insideLoop++;
			},
			exit(path) {
				insideLoop--;
			}
		},
		IfStatement: {
			enter(path) {
				// if (!pathsReachNodeTypes(path, ["ReturnStatement", "ThrowStatement"]).all) {
				// 	insideLoop++;
				// }
			},
			exit(path) {
				// if (!pathsReachNodeTypes(path, ["ReturnStatement", "ThrowStatement"]).all) {
				// 	insideLoop--;
				// }
			}
		},
		AwaitExpression(path) {
			if (insideLoop) {
				result = false;
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

function awaitAndContinue(types, target, continuation) {
	// return types.callExpression(types.memberExpression(types.callExpression(types.memberExpression(types.identifier("Promise"), types.identifier("resolve")), [target]), types.identifier("then")), [continuation]);
	if (continuation.params.length === 1) {
		const body = continuation.body.body;
		if (body.length === 1) {
			if (body[0].type === "ReturnStatement") {
				const argument = body[0].argument;
				if (argument.type === "Identifier" && argument.name === continuation.params[0].name) {
					return target;
				}
			}
		}
	}
	return types.callExpression(types.identifier("__await"), [target, continuation]);
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

function relocateTail(awaitExpression, statementNode, target, temporary, types, assign) {
	const blocks = (statementNode ? [statementNode] : []).concat(borrowTail(target));
	let ret = awaitAndContinue(types, awaitExpression, types.functionExpression(null, temporary ? [temporary] : [], types.blockStatement(blocks)));
	target.replaceWith(types.returnStatement(ret));
	if (assign) {
		target.get("argument.arguments.1.body").traverse({
			Function(path) {
				path.skip();
			},
			ReturnStatement(path) {
				path.get("argument").replaceWith(types.sequenceExpression([types.assignmentExpression("=", assign, types.numericLiteral(1)), path.node.argument]));
			}
		});
	}
}

function rewriteThisExpression(rewritePath, targetPath, types) {
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

module.exports = function({ types, template }) {
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
					rewriteThisExpression(path, path.parentPath, types);
				}
			},
			FunctionExpression(path) {
				if (path.node.async && isCompatible(path.get("body"))) {
					this.usedAsyncHelper = true;
					const that = this;
					const cleanupIfs = [];
					const cleanupExitIdentifiers = [];
					rewriteThisExpression(path, path, types);
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
						if (parent.isReturnStatement()) {
							awaitPath.replaceWith(awaitPath.node.argument);
						} else {
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
							let assign;
							while (parent !== path && parent) {
								if (parent.isIfStatement()) {
									const explicitExits = pathsReachNodeTypes(parent, ["ReturnStatement", "ThrowStatement"]);
									if (!explicitExits.all) {
										const index = cleanupIfs.indexOf(parent);
										if (index === -1) {
											cleanupIfs.push(parent);
											if (!assign && explicitExits.any) {
												assign = awaitPath.scope.generateUidIdentifier("exit");
												path.scope.push({ id: assign });
											}
											cleanupExitIdentifiers.push(assign);
										} else {
											if (!assign) {
												assign = cleanupExitIdentifiers[index];
											}
										}
									}
								}
								parent = parent.parentPath;
							}
							relocateTail(expressionToAwait, statement.node, statement, uid, types, assign);
						}
					}
					for (var i = 0; i < cleanupIfs.length; i++) {
						const cleanupIf = cleanupIfs[i];
						const assign = cleanupExitIdentifiers[i];
						const fn = types.functionExpression(null, [], types.blockStatement([cleanupIf.node]));
						const calledFn = types.callExpression(fn, []);
						if (assign) {
							const ret = path.scope.generateUidIdentifier();
							cleanupIf.insertAfter(types.IfStatement(assign, types.returnStatement(ret)));
							relocateTail(calledFn, null, cleanupIf, ret, types);
						} else {
							relocateTail(calledFn, null, cleanupIf, null, types);
						}
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
						body.insertBefore(template(`function __await(v, f) {
							return (v && v.then ? v : Promise.resolve(v)).then(f);
						}`)());		
					}
					path.stop();
				}
			}
		}
	}
}
