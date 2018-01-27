babel-plugin-transform-async-to-promises
========================================

Babel plugin to transform async/await functions to the equivalent chain of Promise calls with use of minimal helper functions.

### Input:

```javascript
async function fetchAsObjectURL(url) {
    const response = await fetch(url);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
}
```

### Output:

```javascript
var fetchAsObjectURL = _async(function(url) {
	return _await(fetch(url), function(response) {
		return _await(response.blob(), function(blob) {
			return URL.createObjectURL(blob);
		});
	});
});
```

## JavaScript Language Features

### Full Support
- `async`/`await`
- `for`/`while`/`do` loops (including loops that would exhaust stack if dispatched recursively)
- `switch` statements (including fallthrough and `default` cases)
- conditional expressions
- logical expressions
- `try`/`catch`
- `throw` expressions
- Function hoisting
- Variable hoisting
- Arrow functions
- Methods
- `arguments`
- `this`
- Proper member dereference order of operations

### Partial Support
- Standards-compliant event loop ordering
 - Compliant with respect to initial calls, conditionally called `await` expressions, and loops
 - `catch`/`finally` clauses are always dispatched asynchronously in the error path
 - `Promise` values in predicates will be awaited instead of merely checked for truthiness
- `break`/`continue` statements on loops/labeled statements
 - Full support for basic `break`/`continue` statements
 - Some forms of labeled statements/loops are transformed incorrectly
- `Function.length`
 - `async` functions will usually return a length of 0 (due to the use of the `_async` wrapper)

### No support
- `eval`
 - Impossible to support without deep hooks into the runtime
- Async generator functions
 - Not implemented or planned
- `Function.name`
 - Rewrite pass removes function name instrumentation
- `new AsyncFunction(...)`
 - Impossible to support without shipping babel and the plugin in the output
