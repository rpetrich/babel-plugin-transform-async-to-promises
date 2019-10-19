expect((await f(() => ({ bar: "baz" })))).toBe("baz");
