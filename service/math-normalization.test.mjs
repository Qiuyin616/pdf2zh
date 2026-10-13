import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMathDocument,
  normalizeMathSymbols,
  expandHtmlTables,
  fitDisplayMath,
  mathTemplate,
} from "./math-normalization.mjs";

const math = (body) => ({ t: "Math", c: [{ t: "DisplayMath" }, body] });
const document = (nodes) => ({
  "pandoc-api-version": [1, 23, 1],
  meta: {},
  blocks: [{ t: "Para", c: nodes }],
});

test("redundant four-dollar wrappers normalize without losing expression", () => {
  const source = document([
    { t: "Str", c: "$" },
    math("$x^2"),
    { t: "Str", c: "$$" },
  ]);
  const result = normalizeMathDocument(source);
  assert.deepEqual(result.blocks[0].c, [math("x^2")]);
  assert.equal(source.blocks[0].c.length, 3);
});

test("adjacent display equations and literal empty dollar runs remain unchanged", () => {
  const source = document([math("a"), math("b"), { t: "Str", c: "$$$$" }]);
  assert.deepEqual(normalizeMathDocument(source), source);
});

test("four-dollar repair preserves adjacent prose and punctuation", () => {
  const result = normalizeMathDocument(
    document([{ t: "Str", c: "公式：$" }, math("$x"), { t: "Str", c: "$$。" }]),
  );
  assert.deepEqual(result.blocks[0].c, [
    { t: "Str", c: "公式：" },
    math("x"),
    { t: "Str", c: "。" },
  ]);
});

test("code and ordinary text are never normalized as mathematical input", () => {
  const source = document([
    { t: "Code", c: [["", [], []], "$$$$σ$$$$"] },
    { t: "Str", c: "σ ≤ 1" },
  ]);
  assert.deepEqual(normalizeMathDocument(source), source);
});

test("standalone equation environments lose redundant outer math mode, not tags", () => {
  const body = "\\begin{align}σ &= 0\\tag{S1}\\\\a&=b\\end{align}";
  const result = normalizeMathDocument(document([math(body)]));
  assert.equal(result.blocks[0].c[0].t, "RawInline");
  assert.equal(
    result.blocks[0].c[0].c[1],
    "\\begin{align}\\sigma  &= 0\\tag{S1}\\\\a&=b\\end{align}",
  );
});

test("bare aligned/matrix environments receive their required display math mode", () => {
  const source = {
    blocks: [
      { t: "RawBlock", c: ["tex", "\\begin{bmatrix}a&b\\\\c&d\\end{bmatrix}"] },
    ],
  };
  const result = normalizeMathDocument(source);
  assert.equal(result.blocks[0].t, "Para");
  assert.equal(result.blocks[0].c[0].t, "Math");
});

test("Unicode math aliases preserve Greek variants and exclude text-mode groups", () => {
  assert.equal(
    normalizeMathSymbols(
      "σ=∂ε/∂t + ϵ + φ + ϕ + \\text{σ{中文}≤} + \\operatorname{Δ}",
    ),
    "\\sigma =\\partial \\varepsilon /\\partial t + \\epsilon  + \\varphi  + \\phi  + \\text{σ{中文}≤} + \\operatorname{Δ}",
  );
});

test("HTML table content becomes native structured blocks instead of disappearing", async () => {
  const source = {
    blocks: [
      { t: "RawBlock", c: ["html", "<table><tr><td>$x$</td></tr></table>"] },
    ],
  };
  const result = await expandHtmlTables(source, async () => ({
    blocks: [{ t: "Table", c: [] }],
  }));
  assert.equal(result.blocks[0].t, "Table");
  assert.equal(source.blocks[0].t, "RawBlock");
});

test("unreadable HTML tables stay visible as literal source", async () => {
  const source = {
    blocks: [{ t: "RawBlock", c: ["html", "<table>bad</table>"] }],
  };
  const result = await expandHtmlTables(source, async () => {
    throw new Error("bad HTML");
  });
  assert.equal(result.blocks[0].t, "CodeBlock");
  assert.equal(result.blocks[0].c[1], "<table>bad</table>");
});

test("Unicode subscripts attach to the symbol rather than an empty group", () => {
  assert.equal(
    normalizeMathSymbols("σ_{ij}+∑_{i=1}^n x_i"),
    "\\sigma _{ij}+\\sum _{i=1}^n x_i",
  );
});

test("Unicode operators and delimiters retain their TeX classes and limits", () => {
  assert.equal(
    normalizeMathSymbols("∇⋅σ+a⋆b+\\left⌊x\\right⌋"),
    "\\nabla \\cdot \\sigma +a\\star b+\\left\\lfloor x\\right\\rfloor ",
  );
});

test("Unicode minus is a minus token, including negative powers", () => {
  assert.equal(normalizeMathSymbols("x−y+10^{−3}+a∗b"), "x-y+10^{-3}+a\\ast b");
});

test("display fitting retains source and keeps tags/labels outside the measured box", () => {
  const source = document([math("a+b\\tag*{S1}\\label{eq:a}")]);
  const result = fitDisplayMath(source);
  assert.equal(
    result.blocks[0].c[0].c[1],
    "\\PDFtoMDMathFit{0.88\\linewidth}{a+b}\\tag*{S1}\\label{eq:a}",
  );
  assert.equal(source.blocks[0].c[0].c[1], "a+b\\tag*{S1}\\label{eq:a}");
});

test("non-terminal or nested numbering is not rearranged", () => {
  const source = document([
    math("\\tag{S1} a+b"),
    math("a+\\text{\\tag{not a tag}}"),
  ]);
  assert.deepEqual(fitDisplayMath(source), source);
});

test("split is not boxed outside its required display context", () => {
  const source = document([
    math("\\begin{split}a&=b\\\\c&=d\\end{split}\\tag{1}"),
  ]);
  assert.deepEqual(fitDisplayMath(source), source);
});

test("Unicode mathematical alphabets preserve the actual glyph without dropping boldness", () => {
  const source = document([{ t: "Math", c: [{ t: "InlineMath" }, "𝐂+𝒶+𝑥+𝛔"] }]);
  const result = fitDisplayMath(source);
  assert.equal(
    result.blocks[0].c[0].c[1],
    "\\PDFtoMDUnicodeMath{𝐂}+\\PDFtoMDUnicodeMath{𝒶}+\\PDFtoMDUnicodeMath{𝑥}+\\PDFtoMDUnicodeMath{𝛔}",
  );
  assert.equal(source.blocks[0].c[0].c[1], "𝐂+𝒶+𝑥+𝛔");
});

test("an explicitly numbered inline expression receives display math mode", () => {
  const source = document([
    { t: "Math", c: [{ t: "InlineMath" }, "x=y\\tag{1}"] },
  ]);
  assert.equal(
    normalizeMathDocument(source).blocks[0].c[0].c[0].t,
    "DisplayMath",
  );
});

test("split HTML table fragments are coalesced, preserving neighboring content", async () => {
  const source = {
    blocks: [
      { t: "RawBlock", c: ["html", "<table>"] },
      { t: "Para", c: [{ t: "Str", c: "cell" }] },
      { t: "RawBlock", c: ["html", "</table>"] },
      { t: "Para", c: [{ t: "Str", c: "after" }] },
    ],
  };
  const result = await expandHtmlTables(
    source,
    async (html) => {
      assert.equal(html, "<table><tr><td>cell</td></tr></table>");
      return { blocks: [{ t: "Table", c: [] }] };
    },
    async (blocks) => {
      assert.equal(blocks.length, 3);
      return "<table><tr><td>cell</td></tr></table>";
    },
  );
  assert.equal(result.blocks.length, 2);
  assert.equal(result.blocks[0].t, "Table");
  assert.equal(result.blocks[1].c[0].c, "after");
});

test("math template preserves the surrounding default template and dollar text", () => {
  const result = mathTemplate("before $$\n$fonts.latex()$\nafter $$");
  assert.ok(result.startsWith("before $$"));
  assert.ok(result.endsWith("after $$"));
  assert.ok(result.includes("\\usepackage{fontspec}"));
  assert.ok(!result.includes("unicode-math"));
  assert.throws(() => mathTemplate("missing hook"), /font template/);
});
