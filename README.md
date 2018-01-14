babel-plugin-transform-async-to-promises
========================================

Transforms async/await functions to the equivalent chain of Promise calls with use of minimal helper library.

### Input:

```javascript
async function fetchAsObjectURL(url) {
    var response = await fetch(url);
    var blob = await response.blob();
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
