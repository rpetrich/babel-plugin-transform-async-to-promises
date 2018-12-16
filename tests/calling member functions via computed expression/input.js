async function(foo, bar, baz) {
	return bar[baz](await foo());
}
