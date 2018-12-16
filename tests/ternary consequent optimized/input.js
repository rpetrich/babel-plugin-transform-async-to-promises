async function(foo, bar, baz) {
	return foo() ? await bar() : baz();
}
