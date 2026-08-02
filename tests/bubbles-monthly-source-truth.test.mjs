import assert from "node:assert/strict";
import test from "node:test";
import { dateFromBorderedFile, validateMonthFiles } from "../scripts/bubbles-monthly-source-truth.mjs";

test("date-prefixed bordered exports preserve date mapping", () => {
  assert.equal(dateFromBorderedFile("2026-08-04_lion Edited.jpg", "2026-08"), "2026-08-04");
  assert.equal(dateFromBorderedFile("2026-09-04_lion Edited.jpg", "2026-08"), null);
  assert.deepEqual([...validateMonthFiles(["2026-02-01_a.jpg", "2026-02-02_b.jpg"], "2026-02", 2).keys()], ["2026-02-01", "2026-02-02"]);
  assert.throws(() => validateMonthFiles(["2026-02-01_a.jpg"], "2026-02", 2), /Missing bordered exports/);
});
