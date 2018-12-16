async function(foo) {
	const {
		result
	} = await foo();
	return result + 1;
}
