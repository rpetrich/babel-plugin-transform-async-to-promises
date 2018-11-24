expect((await f(async () => 1, async () => 0))).toBe(false);
