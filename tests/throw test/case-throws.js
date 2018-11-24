async f => {
			var result;
			try {
				await f();
				result = false;
			} catch (e) {
				result = e;
			}
			expect(result).toBe(true);
		}