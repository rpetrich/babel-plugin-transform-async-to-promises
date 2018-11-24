var count = 0;
expect((await f(async _ => {
	++count;
}))).toBe(0);
expect(count).toBe(1);
