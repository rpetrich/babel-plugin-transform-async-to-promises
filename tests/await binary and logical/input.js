async function(left, middle, right) {
	return await left() + !(await middle()) && await right();
}
