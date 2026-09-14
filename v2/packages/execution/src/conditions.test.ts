import test from "node:test";
import assert from "node:assert/strict";
import { noticeMakesLastDayInapplicable } from "./conditions.js";
test("immediate-only last-working-day requires a verified positive notice period", () => {
  const labels = ["If available immediately, what was your last working day?"];
  assert.equal(noticeMakesLastDayInapplicable("LAST_WORKING_DAY", labels, 30), true);
  for (const days of [0, null, -1]) assert.equal(noticeMakesLastDayInapplicable("LAST_WORKING_DAY", labels, days), false);
  assert.equal(noticeMakesLastDayInapplicable("LAST_WORKING_DAY", ["Last working day"], 30), false);
  assert.equal(noticeMakesLastDayInapplicable("START_DATE", labels, 30), false);
});
