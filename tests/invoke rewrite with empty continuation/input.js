async function(expression1, expression2, actionAsync) {
	if (expression1) {
		return;
	}

	if (expression2) {
		var a = 1;
	} else {
		try {
			let res = await actionAsync();
			var b = 2;
			return res;
		} catch (error) {
			return false;
		};
	}
}
