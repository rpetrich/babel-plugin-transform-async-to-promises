async function(delay, callback) {
	var array = [0, 1, 2, 3, 4];
	for (var i = 0; i < array.length; i++) {
		if (delay) {
			await array[i];
		}
	}
	return callback();
}
