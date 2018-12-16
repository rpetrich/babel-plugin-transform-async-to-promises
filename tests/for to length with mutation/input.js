async function(list) {
	for (var i = 0; i < list.length; i++) {
		if (await list[i]()) {
			i = list.length;
		}
	}
}
