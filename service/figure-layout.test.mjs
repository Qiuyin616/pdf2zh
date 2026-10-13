import { test } from "node:test";
import assert from "node:assert/strict";
import { planFigures, layoutFigureBlocks } from "./figure-layout.mjs";
function body(path, box, label = "") {
  return {
    type: "chart",
    bbox: box,
    blocks: [
      {
        type: "chart_body",
        bbox: box,
        lines: [{ spans: [{ image_path: path, type: "chart" }] }],
      },
      ...(label
        ? [
            {
              type: "chart_caption",
              bbox: [box[0], box[1] - 8, box[0] + 10, box[1]],
              lines: [{ spans: [{ content: label, type: "text" }] }],
            },
          ]
        : []),
    ],
  };
}
function caption(content, box) {
  return {
    type: "chart_caption",
    bbox: box,
    lines: [{ spans: [{ type: "text", content }] }],
  };
}
const first =
  "Fig. 2 | Six panels compare the composition and cycling of a test specimen.";
const tail =
  "The continuation of the figure caption must be retained with the full group.";
function fixture() {
  const a = body("a.png", [20, 30, 80, 80], "a"),
    b = body("b.png", [100, 30, 160, 80], "b");
  a.blocks.push(caption(first, [10, 85, 95, 110]));
  b.blocks.push(caption(tail, [100, 85, 190, 110]));
  return {
    pdf_info: [{ page_idx: 0, page_size: [200, 300], para_blocks: [a, b] }],
  };
}
test("groups coordinate-confirmed panels and joins split captions without assuming source order", () => {
  const md = `a\n![](images/a.png)\n${first}\n\nScientific prose that must remain.\n\nb\n![](images/b.png)\n${tail}`;
  const result = planFigures(fixture(), md);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].panelCount, 2);
  assert.match(result.groups[0].caption, /continuation/);
  assert.ok(result.groups[0].bbox[1] <= 22);
  assert.ok(
    !result.groups[0].spans.some((s) =>
      md.slice(s.start, s.end).includes("Scientific prose"),
    ),
  );
});
test("does not guess missing captions, ambiguous assets or areas containing body text", () => {
  const md = `![](images/a.png)\n\n${first}\n\n![](images/b.png)\n\n${tail}`;
  assert.equal(
    planFigures(fixture(), md.replace(tail, "lost")).groups.length,
    0,
  );
  assert.equal(
    planFigures(fixture(), md + "\n![](images/a.png)").groups.length,
    0,
  );
  const layout = fixture();
  layout.pdf_info[0].para_blocks.push({
    type: "text",
    bbox: [40, 40, 120, 60],
  });
  assert.equal(planFigures(layout, md).groups.length, 0);
});
test("nearby vertically stacked figures remain separate", () => {
  const layout = fixture();
  const extra = body("c.png", [20, 150, 160, 200]);
  const cap =
    "Fig. 3 | A different figure on the same page must never be combined with figure 2.";
  extra.blocks.push(caption(cap, [10, 210, 190, 240]));
  layout.pdf_info[0].para_blocks.push(extra);
  const md = `![](images/a.png)\n${first}\n\n![](images/b.png)\n${tail}\n\n![](images/c.png)\n${cap}`;
  const groups = planFigures(layout, md).groups;
  assert.equal(groups.length, 2);
  assert.deepEqual(groups[1].sourceImages, ["c.png"]);
});
test("binds grouped image and caption while preserving other document blocks", () => {
  const image = {
    t: "Image",
    c: [["", ["pdf2md-figure"], []], [], ["images/group.png", ""]],
  };
  const para = { t: "Para", c: [image] },
    cap = { t: "Para", c: [{ t: "Str", c: "图2：中文图注" }] },
    prose = { t: "Para", c: [{ t: "Str", c: "正文" }] };
  const doc = { blocks: [para, cap, prose] };
  const result = layoutFigureBlocks(doc);
  assert.match(result.blocks[0].c[1], /minipage/);
  assert.deepEqual(result.blocks.at(-1), prose);
  assert.deepEqual(doc.blocks, [para, cap, prose]);
  assert.ok(
    result.blocks.some(
      (b) => b.t === "RawBlock" && b.c[1].includes("end{minipage}"),
    ),
  );
});

test("caption fragments beginning or ending in math preserve complete dollar delimiters", () => {
  const layout = fixture();
  const tailMath =
    "$\\mathrm{Li^{+}}$ and the remaining caption are retained with the same exact math delimiters.";
  layout.pdf_info[0].para_blocks[1].blocks.at(-1).lines[0].spans[0].content =
    tailMath;
  const md = `![](images/a.png)\n${first}\n\n![](images/b.png)\n${tailMath}`;
  const group = planFigures(layout, md).groups[0];
  assert.ok(group.caption.includes(tailMath));
  assert.equal(group.caption.split("$").length - 1, 2);
});

test("prepared Markdown replaces only confirmed fragments and uses PDF page scale for cropping", async () => {
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { prepareFigures } = await import("./figure-layout.mjs");
  const dir = await mkdtemp(join(tmpdir(), "figure-source-test-"));
  const md = `a\n![](images/a.png)\n${first}\n\nScientific prose that must remain.\n\nb\n![](images/b.png)\n${tail}`;
  await writeFile(join(dir, "layout.json"), JSON.stringify(fixture()));
  const calls = [];
  try {
    const result = await prepareFigures(
      { markdown: md, resourceDir: dir, sourcePdfPath: "source.pdf" },
      async (cmd, args) => {
        calls.push({ cmd, args });
        return {
          stdout: cmd === "pdfinfo" ? "Page 1 size: 600 x 900 pts" : "",
          stderr: "",
        };
      },
    );
    assert.equal(result.figures.length, 1);
    assert.equal((result.markdown.match(/!\[/g) || []).length, 1);
    assert.match(result.markdown, /pdf2md-figure/);
    assert.match(result.markdown, /Scientific prose that must remain/);
    assert.doesNotMatch(result.markdown, /^a\s*$/m);
    assert.doesNotMatch(result.markdown, /^b\s*$/m);
    assert.match(result.markdown, /continuation of the figure caption/);
    const crop = calls.find((c) => c.cmd === "pdftoppm").args;
    assert.equal(crop[crop.indexOf("-x") + 1], "100");
    assert.equal(crop[crop.indexOf("-y") + 1], "250");
    const failed = await prepareFigures(
      { markdown: md, resourceDir: dir, sourcePdfPath: "source.pdf" },
      async () => {
        throw new Error("crop unavailable");
      },
    );
    assert.equal(failed.markdown, md);
    assert.equal(failed.figures.length, 0);
    assert.match(failed.warnings[0], /crop unavailable/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
