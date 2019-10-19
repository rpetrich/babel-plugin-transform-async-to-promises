expect((await f(async _ => {
			throw "test";
		}, async _ => false))).toBe(undefined)