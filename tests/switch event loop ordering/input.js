async function(delay, callback) {
	switch (delay) {
		case false:
			break;
		case true:
			await true;
			break;
	}
	return callback();
}
