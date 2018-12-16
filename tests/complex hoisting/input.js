async function(foo, baz) {
    if (foo()) {
        var result = await bar();

        function bar() {
            return 1;
        }
    } else {
        result = await baz();
    }
    return result;
}
