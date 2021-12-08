async function(foo, until) {
	let count = 0;
	while ((await foo()) !== until) {
		++count;
	};
	return count;
}