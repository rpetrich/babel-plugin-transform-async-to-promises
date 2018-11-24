var obj = { foo: async _ => 0, bar: async _ => 1, baz: async _ => 0 };
expect((await f(obj))).toBe(true);
