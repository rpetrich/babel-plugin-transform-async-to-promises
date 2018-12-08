async function() {
  var e_1, _a;
  const out = [];
  try {
    for (
      var _b = tslib_1.__asyncValues([1, 2]), _c;
      (_c = await _b.next()), !_c.done;

    ) {
      const item = _c.value;
      out.push(item);
    }
  } catch (e_1_1) {
    e_1 = { error: e_1_1 };
  } finally {
    try {
      if (_c && !_c.done && (_a = _b.return)) await _a.call(_b);
    } finally {
      if (e_1) throw e_1.error;
    }
  }
  return out;
}