let called = false;
expect((await f(5, async () => 2, () => called = true))).toBe(2);
expect(called).toBe(true);
