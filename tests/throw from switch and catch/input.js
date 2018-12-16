async function() {
	try {
		switch (true) {
			case true:
				throw await 1;
		}
		return false;
	} catch (e) {
		return true;
	}
}
