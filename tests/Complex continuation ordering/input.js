() => {
    let index = 0;
    let promise = null;
    let messages = [];

    async function test() {
        let promiseResolve;
        let num = ++index;

        messages.push("start " + num);

        // place of interest
        while (promise) {
            messages.push("wait " + num);

            await promise;
        }

        promise = new Promise(r => {
            promiseResolve = r;
        });

        await wait();

        promise = null;

        promiseResolve();

        messages.push("stop " + num);
    }

    function wait() {
        return Promise.resolve();
    }

    return Promise.all([test(), test(), test()]).then(() => messages);
}
