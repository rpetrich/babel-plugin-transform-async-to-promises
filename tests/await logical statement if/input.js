async function(left, right) {
	if (true) {
		const result = left() && await right();
		return result || result;
	}
	return false;
}
