async function(foo) {
	var keys = [];
	for (var key in await foo()) {
		keys.push(key);
	}
	return keys.sort();
}
