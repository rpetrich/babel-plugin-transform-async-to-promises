async function(foo, bar, baz) {
	var result;
	try {
		return await foo();
	} catch (e) {
		return await bar();
	} finally {
		baz();
	}
}
