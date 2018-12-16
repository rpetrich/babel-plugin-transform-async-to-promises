async function() {
	function passthrough(value) {
		return value;
	}
	while (passthrough(true ? Promise.resolve(false) : await false)) {
		return true;
	}
	return false;
}
