function(...fns) {
	return (value) => new Promise((resolve, reject) => {
		(async function run([f, ...fns], value) {
			try {
				if (f === undefined) resolve(value)
				else run(fns, await f(value))
			} catch (e) {
				reject(e)
			}
		})(fns, value);
	});
}
