async function(foo) {
	const [bar, ...rest] = await foo();
	return rest;
}
