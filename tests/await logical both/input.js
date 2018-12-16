async function(left, right) {
	return await left() && await right();
}
