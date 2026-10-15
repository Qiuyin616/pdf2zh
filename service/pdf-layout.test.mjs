import { test } from "node:test";
import assert from "node:assert/strict";
import { inspectPdfLayout } from "./pdf-layout.mjs";

const page = (words) => `<page width="612" height="792">${words}</page>`;
const word = (left, right, top = 72, bottom = 84) =>
  `<word xMin="${left}" yMin="${top}" xMax="${right}" yMax="${bottom}">x</word>`;

test("catches page-edge clipping on the correct page, including vertical overflow", () => {
  const result = inspectPdfLayout(
    page(word(72, 540)) + page(word(590, 615) + word(72, 85, 788, 800)),
  );
  assert.equal(result.pageCount, 2);
  assert.equal(result.overflow.length, 2);
  assert.deepEqual(
    result.overflow.map((item) => item.page),
    [2, 2],
  );
});

test("normal glyph overhang is tolerated and margin intrusions are reported separately", () => {
  const result = inspectPdfLayout(
    page(word(72, 547) + word(72, 572) + word(-0.5, 20)),
  );
  assert.equal(result.overflow.length, 0);
  assert.equal(result.marginWarningCount, 2);
});

test("unreadable extraction fails rather than silently claiming validation passed", () => {
  assert.throws(() => inspectPdfLayout("not XML"), /页面/);
  assert.throws(
    () => inspectPdfLayout('<page width="bad" height="792"></page>'),
    /尺寸/,
  );
  assert.throws(
    () => inspectPdfLayout(page('<word xMin="72">x</word>')),
    /坐标/,
  );
  assert.equal(inspectPdfLayout(page("")).wordCount, 0);
});

test("landscape validation uses rotated dimensions per page in mixed documents", () => {
  const result = inspectPdfLayout(
    page(word(72, 540)) + page(word(650, 700)),
    "Page 1 rot: 0\nPage 2 rot: 90\n",
  );
  assert.equal(result.overflow.length, 0);
  assert.deepEqual(result.pageSizes[1], { page: 2, width: 792, height: 612 });
});
