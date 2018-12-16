async function(foo, bar) {
    var a = 0,
        b = foo(),
        c = await bar(),
        d = 3;
    return a + b + c + d;
}
