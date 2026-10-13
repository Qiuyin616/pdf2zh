/* global structuredClone */

function inlineText(nodes) {
  return nodes
    .map((node) => (node.t === "Str" ? node.c : node.t === "Space" ? " " : ""))
    .join("");
}

function rawNode(node) {
  if (node.t === "Math") {
    const display = node.c[0].t === "DisplayMath";
    return {
      t: "Code",
      c: [["", [], []], display ? `$$\n${node.c[1]}\n$$` : `$${node.c[1]}$`],
    };
  }
  if (node.t === "RawInline")
    return { t: "Code", c: [["", [], []], node.c[1]] };
  if (node.t === "RawBlock")
    return { t: "CodeBlock", c: [["", ["latex"], []], node.c[1]] };
  return {
    t: "Code",
    c: [["", [], []], `![${inlineText(node.c[1])}](${node.c[2][0]})`],
  };
}

function candidatesFor(document) {
  const candidates = [];
  function visit(value, path) {
    if (!value || typeof value !== "object") return;
    if (["Math", "RawInline", "RawBlock", "Image"].includes(value.t)) {
      candidates.push({ path, node: value });
      return;
    }
    for (const [key, child] of Object.entries(value))
      visit(child, [...path, key]);
  }
  visit(document, []);
  return candidates;
}

function withFallbacks(document, candidates, enabled) {
  const output = structuredClone(document);
  candidates.forEach(({ path, node }, index) => {
    if (enabled.has(index)) return;
    const parent = path.slice(0, -1).reduce((value, key) => value[key], output);
    parent[path.at(-1)] = rawNode(node);
  });
  function displayBlocks(value) {
    if (!value || typeof value !== "object") return;
    if (
      value.t === "Para" &&
      value.c.length === 1 &&
      value.c[0].t === "Code" &&
      value.c[0].c[1].startsWith("$$\n")
    ) {
      value.t = "CodeBlock";
      value.c = value.c[0].c;
      value.c[0][1] = ["latex"];
      return;
    }
    for (const child of Object.values(value)) displayBlocks(child);
  }
  displayBlocks(output);
  return output;
}

function rawDocument(markdown, version) {
  return {
    "pandoc-api-version": version,
    meta: {},
    blocks: [{ t: "CodeBlock", c: [["", ["markdown"], []], markdown] }],
  };
}

/** Keep successful content formatted; unsuccessful content remains visible as source. */
export async function renderCompatible(
  markdown,
  { parse, compile, probeLimit = 24 },
) {
  try {
    return {
      pdf: await compile({ markdown }),
      mode: "normal",
      fallbackCount: 0,
      probes: 0,
    };
  } catch (error) {
    if (error.code === "ENOENT") throw error;
  }

  let document;
  try {
    document = await parse(markdown);
  } catch {
    const empty = await parse("");
    return {
      pdf: await compile({
        document: rawDocument(markdown, empty["pandoc-api-version"]),
      }),
      mode: "raw",
      fallbackCount: 1,
      probes: 0,
    };
  }
  const candidates = candidatesFor(document);
  const enabled = new Set();
  let pdf;
  try {
    pdf = await compile({
      document: withFallbacks(document, candidates, enabled),
    });
  } catch {
    return {
      pdf: await compile({
        document: rawDocument(markdown, document["pandoc-api-version"]),
      }),
      mode: "raw",
      fallbackCount: 1,
      probes: 0,
    };
  }

  let probes = 0;
  async function restore(group) {
    if (!group.length || probes >= probeLimit) return;
    probes++;
    const proposed = new Set([...enabled, ...group]);
    try {
      const next = await compile({
        document: withFallbacks(document, candidates, proposed),
      });
      group.forEach((index) => enabled.add(index));
      pdf = next;
    } catch {
      if (group.length === 1) return;
      const middle = Math.floor(group.length / 2);
      await restore(group.slice(0, middle));
      await restore(group.slice(middle));
    }
  }
  await restore(candidates.map((_, index) => index));
  const fallbackCount = candidates.length - enabled.size;
  return {
    pdf,
    mode: fallbackCount ? "partial-raw" : "normal",
    fallbackCount,
    probes,
  };
}
