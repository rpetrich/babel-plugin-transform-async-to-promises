async function(left, right, two) {
	return {
		zero: 0,
		one: left(),
		[two()]: 2,
		three: await right(),
		four: 4
	}
}
