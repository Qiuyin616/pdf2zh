/* global structuredClone */
import { test } from "node:test";
import assert from "node:assert/strict";
import { layoutTables } from "./table-layout.mjs";

const attr = ["", [], []];
const str = (text) => ({ t: "Str", c: text });
const math = (body) => ({ t: "Math", c: [{ t: "InlineMath" }, body] });
const span = (body) => ({ t: "Span", c: [attr, [math(body)]] });
const cell = (inlines, rowspan = 1, colspan = 1) => [
  attr,
  { t: "AlignDefault" },
  rowspan,
  colspan,
  [{ t: "Plain", c: inlines }],
];
const row = (...cells) => [attr, cells];
function document(rows, count = 2) {
  return {
    blocks: [
      {
        t: "Table",
        c: [
          attr,
          [null, []],
          Array.from({ length: count }, () => [
            { t: "AlignDefault" },
            { t: "ColWidthDefault" },
          ]),
          [attr, []],
          [[attr, 0, [], rows]],
          [attr, []],
        ],
      },
    ],
  };
}

test("HTML math spans and numbered lists fit within explicit column widths and can paginate", () => {
  const source = document([
    row(
      cell([str("Conservation")]),
      cell([
        span("a=b"),
        { t: "Space" },
        str("(1)"),
        { t: "Space" },
        span("c=d"),
        { t: "Space" },
        str("(2)"),
      ]),
    ),
  ]);
  const before = structuredClone(source);
  const table = layoutTables(source).blocks[0];
  const widths = table.c[2].map((spec) => spec[1].c);
  assert.ok(widths.every((width) => width > 0));
  assert.ok(Math.abs(widths[0] + widths[1] - 1) < 1e-10);
  assert.ok(widths[1] >= 0.7);
  const rows = table.c[4][0][3];
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[1][1][0][4], []);
  assert.match(
    rows[0][1][1][4][0].c[0].c[1][0].c[1],
    /PDFtoMDTableMathFit.*a=b/,
  );
  assert.ok(JSON.stringify(rows[1]).includes("(2)"));
  assert.deepEqual(source, before);
});

test("mixed prose, code, merged cells and given column proportions survive", () => {
  const source = document([
    row(
      cell([str("Prose"), { t: "Space" }, math("x"), str("and"), math("y")], 2),
      cell([{ t: "Code", c: [attr, "$x$"] }]),
    ),
  ]);
  source.blocks[0].c[2] = [
    [{ t: "AlignLeft" }, { t: "ColWidth", c: 2 }],
    [{ t: "AlignRight" }, { t: "ColWidth", c: 3 }],
  ];
  const table = layoutTables(source).blocks[0];
  assert.deepEqual(
    table.c[2].map((spec) => spec[1].c),
    [0.4, 0.6],
  );
  const rows = table.c[4][0][3];
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1][0][2], 2);
  assert.equal(rows[0][1][0][4].length, 1);
  assert.deepEqual(rows[0][1][1], source.blocks[0].c[4][0][3][0][1][1]);
});

test("wide tables use a landscape page while keeping the native table and header", () => {
  const source = document(
    [row(...Array.from({ length: 8 }, () => cell([str("Value")])))],
    8,
  );
  source.blocks[0].c[3][1] = [
    row(...Array.from({ length: 8 }, () => cell([str("Header")]))),
  ];
  const result = layoutTables(source);
  assert.match(result.blocks[0].c[1], /begin\{landscape\}/);
  assert.equal(result.blocks[1].t, "Table");
  assert.deepEqual(result.blocks[1].c[3], source.blocks[0].c[3]);
  assert.match(result.blocks[2].c[1], /end\{landscape\}/);
});

test("known equation headers from td cells become repeating native headers", () => {
  const source = document([
    row(
      cell([str("Electrochemical physics")]),
      cell([str("Governing equation and boundary condition")]),
    ),
    row(cell([str("Conservation")]), cell([span("a=b"), str("(1)")])),
  ]);
  const table = layoutTables(source).blocks[0];
  assert.equal(table.c[3][1].length, 1);
  assert.equal(table.c[4][0][3].length, 1);
  assert.ok(JSON.stringify(table.c[3]).includes("Electrochemical physics"));
});
