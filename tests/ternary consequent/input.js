async function(foo, bar, baz) {
	const result = foo() ? await bar() : baz();
	return result || result;
}
