async function(foo, bar) {
	var f = await foo();
	var b = await bar();
	return f + b;
}
