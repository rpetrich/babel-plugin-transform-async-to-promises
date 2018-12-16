async function(foo, bar, baz) {
	return foo() ? bar() : await baz();
}
