expect((await f(async (a, b, c) => a + b + c, () => 1, async _ => 2))).toBe(5);
