var count = 0;
expect((await f(async _ => {
	++count;return count < 2;
}))).toBe(true);
expect(count).toBe(2);
