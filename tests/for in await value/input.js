async function(foo) {
	var values = [];
	for (var key in foo) {
		values.push(await foo[key]());
	}
	return values.sort();
}
