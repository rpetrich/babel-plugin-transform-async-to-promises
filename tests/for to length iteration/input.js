async function(list) {
	var result = 0;
	for (var i = 0; i < list.length; i++) {
		result += await list[i]();
	}
	return result;
}
