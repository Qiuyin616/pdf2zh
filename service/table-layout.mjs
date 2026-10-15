/* global structuredClone */

function rowGroups(table) {
  return [
    table.c[3][1],
    ...table.c[4].flatMap((body) => [body[2], body[3]]),
    table.c[5][1],
  ];
}

function mathIn(node) {
  if (node.t === "Math") return node;
  if (node.t === "Span" && node.c[1].length === 1) return mathIn(node.c[1][0]);
  return null;
}

// Only split lists of explicitly numbered equations, never prose containing math.
function equationLines(block) {
  if (!["Plain", "Para"].includes(block.t)) return [block];
  const groups = [];
  let current;
  for (const node of block.c) {
    if (mathIn(node)) {
      current = [];
      groups.push(current);
    } else if (
      !["Space", "SoftBreak", "LineBreak"].includes(node.t) &&
      !(node.t === "Str" && /^\(\d+[a-z]?\)[,;.]?$/.test(node.c))
    )
      return [block];
    if (!current) {
      if (["Space", "SoftBreak", "LineBreak"].includes(node.t)) continue;
      return [block];
    }
    current.push(node);
  }
  if (
    groups.length < 2 ||
    !groups.every((group) => group.some((node) => node.t === "Str"))
  )
    return [block];
  return groups.map((group) => ({ t: "Para", c: group }));
}

function measure(value) {
  if (!value || typeof value !== "object") return 0;
  if (value.t === "Str") return value.c.length;
  if (value.t === "Math") return Math.min(36, value.c[1].length);
  if (value.t === "Space") return 1;
  return Object.values(value).reduce((sum, child) => sum + measure(child), 0);
}

function text(value) {
  if (!value || typeof value !== "object") return "";
  if (value.t === "Str") return value.c;
  if (["Space", "SoftBreak", "LineBreak"].includes(value.t)) return " ";
  return Object.values(value).map(text).join("");
}

function fitCellMath(value, numbered = false) {
  if (!value || typeof value !== "object") return;
  if (["Code", "CodeBlock", "Table"].includes(value.t)) return;
  if (value.t === "Math") {
    if (
      value.c[0].t === "InlineMath" &&
      !value.c[1].includes("\\PDFtoMDTableMathFit")
    ) {
      const width = numbered
        ? "\\dimexpr\\linewidth-3em\\relax"
        : "0.98\\linewidth";
      const style = numbered ? "\\displaystyle " : "";
      value.c[1] = `\\PDFtoMDTableMathFit{${width}}{${style}${value.c[1]}}`;
    }
    return;
  }
  for (const child of Object.values(value)) fitCellMath(child, numbered);
}

function layoutTable(table) {
  const specs = table.c[2];
  const weights = specs.map(() => 6);
  let equationColumn = false;
  const first = table.c[4][0]?.[3]?.[0];
  // MinerU commonly emits these unambiguous equation headers as <td>.
  if (
    !table.c[3][1].length &&
    first?.[1].length === 2 &&
    first[1].every((cell) => cell[2] === 1 && cell[3] === 1) &&
    /^(Electrochemical|Thermal|Mechanical) physics$/i.test(
      text(first[1][0][4]).trim(),
    ) &&
    /^Governing equation and boundary condition$/i.test(
      text(first[1][1][4]).trim(),
    )
  )
    table.c[3][1].push(table.c[4][0][3].shift());
  // Break long two-column equation lists between equations, so longtable can
  // paginate them. Never change the row structure of merged cells.
  for (const group of rowGroups(table)) {
    for (let i = 0; i < group.length; i++) {
      const row = group[i];
      if (
        row[1].length !== 2 ||
        !row[1].every((cell) => cell[2] === 1 && cell[3] === 1) ||
        row[1][1][4].length !== 1
      )
        continue;
      const lines = equationLines(row[1][1][4][0]);
      if (lines.length < 2) continue;
      const continuation = lines.map((block, index) => {
        const next = structuredClone(row);
        next[1][1][4] = [block];
        if (index) next[1][0][4] = [];
        return next;
      });
      group.splice(i, 1, ...continuation);
      i += continuation.length - 1;
    }
  }
  for (const row of rowGroups(table).flat()) {
    let column = 0;
    for (const cell of row[1]) {
      const span = cell[3];
      const weight = Math.min(36, Math.sqrt(measure(cell[4])) * 3) / span;
      for (let i = column; i < Math.min(column + span, weights.length); i++)
        weights[i] = Math.max(weights[i], weight);
      column += span;
      cell[4] = cell[4].flatMap(equationLines);
      for (const block of cell[4]) {
        const numbered =
          ["Plain", "Para"].includes(block.t) &&
          block.c.some((node) => mathIn(node)) &&
          block.c.some(
            (node) => node.t === "Str" && /^\(\d+[a-z]?\)[,;.]?$/.test(node.c),
          );
        if (numbered && specs.length === 2 && column === 2)
          equationColumn = true;
        fitCellMath(block, numbered);
      }
    }
  }
  // Give equation columns most of the line; explicit source widths still win.
  if (equationColumn) weights[1] = Math.max(weights[1], weights[0] * 2.5);
  // Preserve explicit relative widths; infer only missing widths.
  const explicit = specs.map((spec) =>
    spec[1].t === "ColWidth" && spec[1].c > 0 ? spec[1].c : 0,
  );
  const specified = explicit.reduce((a, b) => a + b, 0);
  const missingWeight = weights.reduce(
    (sum, weight, i) => sum + (explicit[i] ? 0 : weight),
    0,
  );
  const widths = weights.map((weight, i) =>
    explicit[i]
      ? explicit[i]
      : (Math.max(0.1, 1 - specified) * weight) / missingWeight,
  );
  const total = widths.reduce((a, b) => a + b, 0);
  table.c[2] = specs.map(([alignment], i) => [
    alignment,
    { t: "ColWidth", c: widths[i] / total },
  ]);
}

/** Constrain native Pandoc tables, preserving cells, spans and multi-page layout. */
export function layoutTables(document) {
  const output = structuredClone(document);
  function visit(value, inTable = false) {
    if (!value || typeof value !== "object") return;
    if (["Code", "CodeBlock"].includes(value.t)) return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const node = value[i];
        visit(node, inTable);
        // A separate landscape page gives genuinely wide tables more room.
        if (node?.t === "Table" && !inTable && node.c[2].length >= 8) {
          value.splice(
            i,
            1,
            { t: "RawBlock", c: ["latex", "\\begin{landscape}"] },
            node,
            { t: "RawBlock", c: ["latex", "\\end{landscape}"] },
          );
          i += 2;
        }
      }
      return;
    }
    if (value.t === "Table") {
      layoutTable(value);
      inTable = true;
    }
    for (const child of Object.values(value)) visit(child, inTable);
  }
  visit(output);
  return output;
}

export const tablePreamble = [
  "\\usepackage{pdflscape}",
  "\\providecommand{\\PDFtoMDTableMathFit}[2]{\\begingroup\\setbox0=\\hbox{$#2$}\\ifdim\\wd0>#1\\relax\\resizebox{#1}{!}{\\box0}\\else\\box0\\fi\\endgroup}",
].join("\n");
