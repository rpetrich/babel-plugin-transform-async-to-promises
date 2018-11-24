const object = {};
expect((await f.call(object)())).toBe(object);
