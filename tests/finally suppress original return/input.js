async function(value) {
	try {
		return await value();
	} finally {
		return "suppressed";
	}
}
