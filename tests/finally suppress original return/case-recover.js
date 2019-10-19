expect((await f(async _ => {
			throw "test";
		}, _ => undefined))).toBe("suppressed")