import { test } from "node:test";
import assert from "node:assert/strict";
import { renderCompatible } from "./render-compatibility.mjs";

const document = {
  "pandoc-api-version": [1, 23, 1],
  meta: {},
  blocks: [
    { t: "Para", c: [{ t: "Str", c: "正文" }] },
    {
      t: "Para",
      c: [{ t: "Math", c: [{ t: "DisplayMath" }, "\\badmacro{x}"] }],
    },
    { t: "Para", c: [{ t: "Math", c: [{ t: "DisplayMath" }, "F=ma"] }] },
  ],
};

test("normal rendering does not parse or retry", async () => {
  const result = await renderCompatible("source", {
    parse: () => assert.fail("unexpected parse"),
    compile: async () => "pdf",
  });
  assert.equal(result.mode, "normal");
  assert.equal(result.pdf, "pdf");
});

test("only failing math becomes literal source; healthy math and prose survive", async () => {
  const result = await renderCompatible("source", {
    parse: async () => document,
    compile: async (input) => {
      if (input.markdown) throw new Error("Missing $ inserted");
      if (
        input.document.blocks.some(
          (block) =>
            block.c?.[0]?.t === "Math" && block.c[0].c[1].includes("badmacro"),
        )
      ) {
        throw new Error("Undefined control sequence");
      }
      return input.document;
    },
  });
  assert.equal(result.mode, "partial-raw");
  assert.equal(result.fallbackCount, 1);
  assert.equal(result.pdf.blocks[0].c[0].c, "正文");
  assert.equal(result.pdf.blocks[1].t, "CodeBlock");
  assert.equal(result.pdf.blocks[1].c[1], "$$\n\\badmacro{x}\n$$");
  assert.equal(result.pdf.blocks[2].c[0].t, "Math");
});

test("failed structured fallback retains the entire Markdown source", async () => {
  const source = "# 标题\n\n$bad$\n\n![](missing.png)";
  const result = await renderCompatible(source, {
    parse: async () => document,
    compile: async (input) => {
      if (input.document?.blocks[0].t === "CodeBlock") return input.document;
      throw new Error("content error");
    },
  });
  assert.equal(result.mode, "raw");
  assert.equal(result.pdf.blocks[0].c[1], source);
});

test("malformed Markdown can fall back without relying on its parse", async () => {
  const result = await renderCompatible("broken source", {
    parse: async (source) => {
      if (source) throw new Error("parse error");
      return document;
    },
    compile: async (input) => {
      if (input.markdown) throw new Error("parse error");
      return input.document;
    },
  });
  assert.equal(result.mode, "raw");
  assert.equal(result.pdf.blocks[0].c[1], "broken source");
});

test("probe budget leaves remaining content readable instead of failing", async () => {
  const result = await renderCompatible("source", {
    probeLimit: 0,
    parse: async () => document,
    compile: async (input) => {
      if (input.markdown) throw new Error("bad math");
      return input.document;
    },
  });
  assert.equal(result.fallbackCount, 2);
  assert.equal(result.probes, 0);
});

test("missing rendering executable remains an actionable environment error", async () => {
  await assert.rejects(
    renderCompatible("source", {
      parse: () => assert.fail("unexpected parse"),
      compile: async () => {
        throw Object.assign(new Error("pandoc missing"), { code: "ENOENT" });
      },
    }),
    { code: "ENOENT" },
  );
});
