async function(foo, bar, baz) {
	if (foo()) {
		return await bar();
	} else {
		return await baz();
	}
}
