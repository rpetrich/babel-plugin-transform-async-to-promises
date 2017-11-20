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

var insideIfBody = async function() {
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
