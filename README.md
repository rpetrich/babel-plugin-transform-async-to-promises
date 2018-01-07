babel-plugin-transform-async-to-promises
========================================

Transforms async/await functions to the equivalent chain of Promise calls with use of minimal helper library.

### Input:

```javascript
async function fetchAsObjectURL(url) {
    var response = await fetch(url);
    var blob = await response.blob();
    return URL.createObjectURL(myBlob);
}
```

### Output:

```javascript
var fetchAsObjectURL = __async(function(url) {
	return __await(fetch(url), function(response) {
		return __await(response.blob(), function(blob) {
			return URL.createObjectURL(myBlob);
		});
	});
});
```
