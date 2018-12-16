async function(left, right) {
	return left() && 1 + await right();
}
