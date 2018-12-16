async function(delay, callback) {
	return callback(delay ? await 0 : 0);
}
