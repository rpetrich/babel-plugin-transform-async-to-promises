expect((await f(async () => false, async () => true))).toEqual(true);
