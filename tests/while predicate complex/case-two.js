var count = 0;
expect((await f(async _ => ++count, 2))).toBe(1);
expect(count).toBe(2);