var state;
const promise = f([], () => state = true);
state = false;
await promise;
expect(state).toBe(true);
