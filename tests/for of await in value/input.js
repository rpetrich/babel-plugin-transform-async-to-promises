async function(foo) {
	var result = 0;
	for (var value of await foo())
		result += value;
	return result;
}
