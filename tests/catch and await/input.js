async function(foo, bar) {
	try {
		return await foo();
	} catch(e) {
		await bar();
	}
}
