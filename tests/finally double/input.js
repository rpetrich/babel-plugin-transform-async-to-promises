async function(func) {
	try {
		try {
			return await func();
		} finally {
			if (0) {
				return "not this";
			}
		}
	} finally {
		return "suppressed";
	}
}


