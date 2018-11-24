async f => {
			let result = false;
			try {
				await f(async _ => {
					throw "test";
				}, _ => undefined);
			} catch (e) {
				result = true;
			}
			expect(result).toBe(true);
		}