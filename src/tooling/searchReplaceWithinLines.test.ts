import assert from "node:assert/strict";
import test from "node:test";
import {
  filterOffsetsFullyWithinLineRange,
  oneBasedLineContainingOffset,
} from "./searchReplaceWithinLines";

test("line numbers: CRLF boundaries", () => {
  const t = "a\r\nbbb\r\nccc\r\nbbb\r\n";
  assert.equal(oneBasedLineContainingOffset(t, 0), 1); // before 'a'
  assert.equal(oneBasedLineContainingOffset(t, t.indexOf("bbb")), 2); // start of line 2
  assert.equal(oneBasedLineContainingOffset(t, t.lastIndexOf("bbb")), 4);
});

test("within_lines keeps only occurrences fully inside span", () => {
  const t = "AAA\nBBB\nCCC\nBBB\n"; // duplicate BBB on lines 2 and 5 (1-based)
  const offsets: number[] = [];
  let j = -1;
  while ((j = t.indexOf("BBB", j + 1)) !== -1) {
    offsets.push(j);
  }
  assert.equal(offsets.length, 2);
  assert.deepEqual(filterOffsetsFullyWithinLineRange(t, 3, offsets, 4, 4), [offsets[1]]);
  assert.deepEqual(filterOffsetsFullyWithinLineRange(t, 3, offsets, 2, 2), [offsets[0]]);
  assert.deepEqual(filterOffsetsFullyWithinLineRange(t, 3, offsets, 1, 1), []);
});
