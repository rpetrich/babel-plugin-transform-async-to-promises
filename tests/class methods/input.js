function() {
    return class {
        async foo(baz) {
            return await baz();
        }
        async bar(baz) {
            return baz();
        }
        static async foo() {}
        static async bar(baz) {
            return await baz();
        }
    };
}
