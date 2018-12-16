async function(foo, baz) {
	foo = foo;
	return foo.bar(await baz);
}
