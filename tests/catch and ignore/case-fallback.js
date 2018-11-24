async f => expect((await f(async _ => {
			throw "test";
		}))).toBe(undefined)