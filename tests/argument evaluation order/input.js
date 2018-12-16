async function(a, b, c) {
	return await a(1, b() + 1, await c());
}
