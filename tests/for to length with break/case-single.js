let called = false;
await f([async _ => called = true]);
expect(called).toBe(true);
