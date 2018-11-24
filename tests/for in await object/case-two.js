var obj = { bar: 0, baz: 0 };
expect(JSON.stringify((await f(async _ => obj)))).toBe(`["bar","baz"]`);
