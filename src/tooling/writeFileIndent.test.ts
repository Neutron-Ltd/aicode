import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeWriteReplacementWithDocumentIndents,
  normalizeModelLinesForMerge,
} from "./writeFileIndent";

test("normalizeModelLinesForMerge drops lone trailing blank from terminal newline", () => {
  assert.deepEqual(normalizeModelLinesForMerge("a"), ["a"]);
  assert.deepEqual(normalizeModelLinesForMerge("a\nb"), ["a", "b"]);
  assert.deepEqual(normalizeModelLinesForMerge("a\nb\n"), ["a", "b"]);
  assert.deepEqual(normalizeModelLinesForMerge(""), [""]);
});

test("mergeWriteReplacement strips model nesting uses file line indentation", () => {
  const file = [
    "    body {",
    "    background: #fff;",
    "    font-family: Plus, sans-serif;",
  ];
  const model = ["    body {", "        background: #111;", "        font-family: 'Inter', sans-serif;"].join(
    "\n"
  );
  const got = mergeWriteReplacementWithDocumentIndents(file, model);
  assert.equal(
    got,
    ["    body {", "    background: #111;", "    font-family: 'Inter', sans-serif;"].join("\n")
  );
});

test("merge returns null when model line count differs from range", () => {
  const file = ["a", "b", "c"];
  assert.equal(mergeWriteReplacementWithDocumentIndents(file, "x\ny"), null);
});

test("merge preserves deliberate blank middle line indentation", () => {
  const file = ["    a", "", "    c"];
  const model = ["    a", "", "    c"].join("\n");
  assert.equal(
    mergeWriteReplacementWithDocumentIndents(file, model),
    ["    a", "", "    c"].join("\n")
  );
});
