var count = 0;
expect((await f(async _ => ++count, 1))).toBe(0);
expect(count).toBe(1);