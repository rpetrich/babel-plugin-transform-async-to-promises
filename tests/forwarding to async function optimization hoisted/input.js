function(value) {
	return async (foo) => add(1, foo);
	async function add(l, r) {
		return await l + await r;
	}
}
