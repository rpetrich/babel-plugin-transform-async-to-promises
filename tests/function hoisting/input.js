fun();

function wait() {
    return Promise.resolve();
}

var dummy;

async function fun() {
    await wait();
    return true;
}