async function(left, right) {
	const result = left() && await right();
	return result || result;
}
