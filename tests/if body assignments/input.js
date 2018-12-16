async function(foo, bar, baz) {
	var result;
	if (foo()) {
		result = await bar();
	} else {
		result = await baz();
	}
	return result;
}
