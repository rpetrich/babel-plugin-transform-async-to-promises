var count = 0;
expect((await f(async _ => {
	++count;return count < 7;
}))).toBe(undefined);
expect(count).toBe(7);
