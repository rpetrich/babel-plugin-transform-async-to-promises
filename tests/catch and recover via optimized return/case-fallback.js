expect((await f(_ => {
			throw "test";
		}, () => "fallback"))).toBe("fallback")