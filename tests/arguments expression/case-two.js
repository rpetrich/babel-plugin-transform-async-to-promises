expect((await f(async () => false, async () => true))).toBe(true);
