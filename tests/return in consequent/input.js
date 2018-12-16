async function(foo, bar) {
	if (foo) {
		var baz = await bar();
		if (baz) {
			return baz;
		}
	}
	return 0;
}
