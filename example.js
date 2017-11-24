function notAsync() {
	return false;
}

async function simpleAsync() {
	return true;
}

async function awaitPassthrough() {
	return await fetch("http://www.google.com/");
}

var single = async function() {
	var f = await foo();
	return f + 1;
}

var double = async function() {
	var f = await foo();
	var b = await bar();
	return f && b;
}

var logicalLeft = async function() {
	return await left && right;
}

var logicalRight = async function() {
	return left && await right;
}

var logicalBoth = async function() {
	return await left && await right;
}

var binaryLeft = async function() {
	return await left + right;
}

var binaryRight = async function() {
	return left + await right;
}

var binaryBoth = async function() {
	return await left + await right;
}

var binaryAndLogical = async function() {
	return await left + !(await middle) && await right;
}

var beforeIfBody = async function() {
	var foo = await bar;
	if (foo) {
		return 1;
	} else {
		return 0;
	}
}

var insideIfBody = async function() {
	var result;
	if (foo) {
		result = await bar;
	} else {
		result = await baz;
	}
	return result;
}

var insideIfConditional = async function() {
	if (await foo) {
		return 1;
	} else {
		return 0;
	}
}

var ternaryTest = async function() {
	return await foo ? bar : baz;
}

var ternaryConsequent = async function() {
	return foo ? await bar : baz;
}

var ternaryAlternate = async function() {
	return foo ? bar : await baz;
}

var ternaryBoth = async function() {
	return foo ? await bar : await baz;
}

var ternaryAll = async function() {
	return await foo ? await bar : await baz;
}

var onlyIf = async function() {
	if (foo) {
		var baz = await bar;
		if (baz) {
			return baz;
		}
	}
	return 0;
}

var testThis = async function() {
	return await this.foo + await this.bar + await this.baz;
}

// Arrow functions
var arrow = async (foo) => await foo;

var awaitKey = function (key) {
	// Test this expressions in arrow functions
	return async () => await this[key];
}

var variables = async function(value) {
	var a = 1, b = await value, c = 3;
	return a + b + c;
}

var catchAndFallback = async function(value) {
	try {
		return await value;
	} catch (e) {
		return "Error";
	}
}

var catchAndIgnore = async function(value) {
	try {
		return await value;
	} catch (e) {
	}
}

var catchAndAwait = async function(value) {
	try {
		return foo();
	} catch (e) {
		await value;
	}
}

var catchAndLog = async function(value) {
	var result;
	try {
		result = await value;
	} catch (e) {
		result = "Some Error";
	}
	console.log("result:", result);
	return result;
}

var finallyExample = async function(value) {
	try {
		await foo()
	} finally {
		console.log("finished foo, might rethrow");
	}
}

var finallySuppressedExample = async function(value) {
	try {
		await test();
	} finally {
		return "Ignored";
	}
}

var awaitAll = async function(list) {
	for (var i = 0; i < list.length; i++) {
		await list[i];
	}
}

var awaitWithBreak = async function(list) {
	for (var i = 0; i < list.length; i++) {
		if (await list[i]) {
			break;
		}
	}
}

var awaitWithContinue = async function(list) {
	for (var i = 0; i < list.length; i++) {
		var result = await list[i]
		if (!result) {
			continue;
		}
		console.log(result);
	}
}

var whileLoop = async function() {
	let shouldContinue = true;
	while (shouldContinue) {
		shouldContinue = await foo;
		console.log(shouldContinue);
	}
}

var doWhile = async function() {
	do {
		console.log(await foo);
	} while(false);
}

var doWhileRet = async function() {
	do {
		if (await foo) {
			return true;
		}
	} while(true);
}

var awaitPredicate = async function() {
	while (await foo()) {
		console.log("Got a foo!");
		if (1) {
			return true;
		}
	}
	return false;
}

var awaitPredicateSimple = async function() {
	while (await foo() && await bar()) {
		console.log("hi");
	}
}
