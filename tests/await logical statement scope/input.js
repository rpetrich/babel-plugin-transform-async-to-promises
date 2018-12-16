async function(left, right) {
	if (true) {
		const result = left() && await right();
		return result || result;
	} else {
		return false;
	}
}
