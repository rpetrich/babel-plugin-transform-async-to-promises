async function(iter, callback) {
	for await (var value of iter) {
	}
	return callback();
}
