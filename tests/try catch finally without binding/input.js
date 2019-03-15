async function(foo, bar, baz) {
	var result;
	try {
		return await foo();
	} catch {
		return await bar();
	} finally {
		baz();
	}
}
