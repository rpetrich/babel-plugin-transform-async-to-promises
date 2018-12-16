async function(a, b, c) {
	return await a(await b(), await c());
}
