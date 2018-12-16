async function(matrix) {
	var result = 0;
	outer: for (var row of matrix) {
		for (var value of row) {
			result += await value;
			if (result > 10) break outer;
		}
	}
	return result;
}
