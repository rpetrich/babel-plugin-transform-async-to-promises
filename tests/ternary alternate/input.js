async function(foo, bar, baz) {
	const result = foo() ? bar() : await baz();
	return result || result;
}
