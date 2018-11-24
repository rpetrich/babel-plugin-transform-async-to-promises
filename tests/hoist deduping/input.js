async function(a, b, c) {
		if (await a()) {
			if (await b()) {
				const result = await c();
				return result || result;
			}
		} else {
			const result = await c();
			return result || result;
		}
	}