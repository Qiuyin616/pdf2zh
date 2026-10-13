/* global structuredClone */
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const figureStart = /^\s*(?:Fig(?:ure)?\.?|图)\s*\d+\b/i;
const imagePattern = /!\[[^\]]*\]\(([^)]+)\)(?:[ \t]*\{[^}\n]*\})?/g;
function union(boxes) {
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}
function text(block) {
  return (block.lines || [])
    .flatMap((line) => line.spans || [])
    .map((span) =>
      span.type === "inline_equation"
        ? `$${span.content}$`
        : span.content || "",
    )
    .join("");
}
function descendants(block) {
  return [block, ...(block.blocks || []).flatMap(descendants)];
}
function canonical(value) {
  return value.replace(/[\s$]/g, "");
}
function textSpan(markdown, value) {
  const needle = canonical(value);
  if (!needle) return null;
  // Short labels must be whole lines, never substrings in scientific prose.
  if (needle.length < 40) {
    let offset = 0;
    for (const line of markdown.split("\n")) {
      if (canonical(line) === needle)
        return { start: offset, end: offset + line.length, raw: line };
      offset += line.length + 1;
    }
    return null;
  }
  const positions = [];
  let normalized = "";
  for (let i = 0; i < markdown.length; i++) {
    if (!/[\s$]/.test(markdown[i])) {
      normalized += markdown[i];
      positions.push(i);
    }
  }
  const index = normalized.indexOf(needle);
  if (index < 0 || normalized.indexOf(needle, index + 1) >= 0) return null;
  let start = positions[index],
    end = positions[index + needle.length - 1] + 1;
  if (value.trim().startsWith("$")) {
    while (start > 0 && /\s/.test(markdown[start - 1])) start--;
    if (markdown[start - 1] === "$") start--;
  }
  if (value.trim().endsWith("$")) {
    while (end < markdown.length && /\s/.test(markdown[end])) end++;
    if (markdown[end] === "$") end++;
  }
  return { start, end, raw: markdown.slice(start, end) };
}

/** Caption geometry anchors a group; unconfirmed regions are never guessed. */
export function planFigures(layout, markdown) {
  const groups = [],
    warnings = [];
  const references = [...markdown.matchAll(imagePattern)].map((match) => ({
    path: match[1],
    start: match.index,
    end: match.index + match[0].length,
  }));
  for (const page of layout.pdf_info || []) {
    const blocks = page.para_blocks || page.preproc_blocks || [];
    const flat = blocks.flatMap(descendants);
    const captions = flat.filter(
      (b) => /(?:image|chart)_caption/.test(b.type) && text(b).length > 40,
    );
    const starts = captions
      .filter((b) => figureStart.test(text(b)))
      .sort((a, b) => a.bbox[1] - b.bbox[1]);
    for (const anchor of starts) {
      const id = text(anchor).match(/\d+/)[0];
      if (
        starts.filter((block) => text(block).match(/\d+/)?.[0] === id)
          .length !== 1
      ) {
        warnings.push(
          `Fig. ${id}: repeated caption anchors on one page; fragments retained`,
        );
        continue;
      }
      const parts = captions.filter(
        (b) =>
          b === anchor ||
          (!figureStart.test(text(b)) &&
            Math.abs(b.bbox[1] - anchor.bbox[1]) < 15 &&
            b.bbox[0] >= anchor.bbox[2] - 8),
      );
      parts.sort((a, b) => a.bbox[0] - b.bbox[0]);
      const captionBox = union(parts.map((b) => b.bbox));
      const previous = captions.filter((b) => b.bbox[3] < captionBox[1] - 5);
      const lower = previous.length
        ? Math.max(...previous.map((b) => b.bbox[3]))
        : 0;
      const bodies = blocks.filter(
        (b) =>
          ["image", "chart"].includes(b.type) &&
          b.bbox[3] <= captionBox[1] + 3 &&
          b.bbox[1] >= lower &&
          (b.bbox[0] + b.bbox[2]) / 2 >= captionBox[0] &&
          (b.bbox[0] + b.bbox[2]) / 2 <= captionBox[2],
      );
      if (!bodies.length) {
        warnings.push(`Fig. ${id}: no confirmed image region`);
        continue;
      }
      const paths = [
        ...new Set(
          bodies
            .flatMap(descendants)
            .flatMap((b) => (b.lines || []).flatMap((l) => l.spans || []))
            .filter((s) => s.image_path)
            .map((s) => s.image_path),
        ),
      ];
      const refs = paths.map((path) =>
        references.filter(
          (r) =>
            r.path.replace(/^images\//, "") === path.replace(/^images\//, ""),
        ),
      );
      const captionSpans = parts.map((b) => textSpan(markdown, text(b)));
      if (
        !paths.length ||
        refs.some((r) => r.length !== 1) ||
        captionSpans.some((s) => !s)
      ) {
        warnings.push(
          `Fig. ${id}: source paths/caption are missing or ambiguous; fragments retained`,
        );
        continue;
      }
      const included = bodies
        .flatMap(descendants)
        .filter(
          (b) => b.bbox && b.bbox[3] <= captionBox[1] && !parts.includes(b),
        );
      const area = union(included.map((b) => b.bbox));
      // The caption column footprint includes panels that OCR missed altogether.
      area[0] = Math.min(area[0], captionBox[0]);
      area[2] = Math.max(area[2], captionBox[2]);
      const size = page.page_size;
      if (
        !Array.isArray(size) ||
        size.length !== 2 ||
        size.some((v) => !Number.isFinite(v) || v <= 0)
      ) {
        warnings.push(`Fig. ${id}: missing page size`);
        continue;
      }
      const bbox = [
        Math.max(0, area[0] - 2),
        Math.max(0, area[1] - 2),
        Math.min(size[0], area[2] + 2),
        Math.min(captionBox[1] - 1, area[3] + 2),
      ];
      // Do not absorb body text between distant figure fragments.
      const prose = blocks.filter(
        (b) =>
          ["text", "title", "table"].includes(b.type) &&
          b.bbox &&
          b.bbox[0] < bbox[2] &&
          b.bbox[2] > bbox[0] &&
          b.bbox[1] < bbox[3] &&
          b.bbox[3] > bbox[1],
      );
      if (prose.length) {
        warnings.push(
          `Fig. ${id}: region overlaps prose/table; fragments retained`,
        );
        continue;
      }
      const spans = [...refs.flat(), ...captionSpans];
      const labels = new Set(
        included
          .filter((b) => b.lines)
          .map(text)
          .filter((value) => value && value.length < 40)
          .map(canonical),
      );
      for (const ref of refs.flat()) {
        const boundary = markdown.lastIndexOf("\n\n", ref.start);
        const start = boundary < 0 ? 0 : boundary + 2;
        const next = markdown.indexOf("\n\n", ref.end);
        const end = next < 0 ? markdown.length : next;
        let offset = start;
        for (const line of markdown.slice(start, end).split("\n")) {
          if (labels.has(canonical(line)))
            spans.push({ start: offset, end: offset + line.length });
          offset += line.length + 1;
        }
      }
      groups.push({
        id: `figure-${String(page.page_idx + 1).padStart(2, "0")}-${id}`,
        number: id,
        page: page.page_idx + 1,
        pageSize: size,
        bbox,
        sourceImages: paths,
        spans,
        caption: captionSpans.map((s) => s.raw.trim()).join(" "),
        panelCount: paths.length,
      });
    }
  }
  return { groups, warnings };
}

export async function prepareFigures(payload, execute) {
  const { markdown, resourceDir, sourcePdfPath } = payload;
  if (
    typeof markdown !== "string" ||
    typeof resourceDir !== "string" ||
    typeof sourcePdfPath !== "string"
  )
    throw new Error("markdown, resourceDir and sourcePdfPath are required");
  let layout;
  try {
    layout = JSON.parse(
      await readFile(join(resourceDir, "layout.json"), "utf8"),
    );
  } catch {
    return {
      markdown,
      figures: [],
      warnings: ["MinerU layout.json unavailable; original fragments retained"],
    };
  }
  const { groups, warnings } = planFigures(layout, markdown);
  const replacements = [],
    figures = [];
  await mkdir(join(resourceDir, "images"), { recursive: true });
  for (const group of groups) {
    const path = `images/${group.id}.png`;
    const prefix = join(resourceDir, "images", group.id);
    try {
      const info = await execute(
        "pdfinfo",
        ["-f", String(group.page), "-l", String(group.page), sourcePdfPath],
        resourceDir,
      );
      const match = info.stdout.match(
        /(?:Page\s+\d+\s+size|Page size):\s*([\d.]+)\s+x\s+([\d.]+)/,
      );
      if (!match) throw new Error("PDF page dimensions unavailable");
      let [width, height] = match.slice(1).map(Number);
      const rotation = Number(
        info.stdout.match(/(?:Page\s+\d+\s+rot|Page rot):\s*(\d+)/)?.[1] || 0,
      );
      if (rotation === 90 || rotation === 270)
        [width, height] = [height, width];
      const sx = ((width / group.pageSize[0]) * 300) / 72,
        sy = ((height / group.pageSize[1]) * 300) / 72;
      const [x0, y0, x1, y1] = group.bbox;
      await execute(
        "pdftoppm",
        [
          "-f",
          String(group.page),
          "-l",
          String(group.page),
          "-r",
          "300",
          "-x",
          String(Math.floor(x0 * sx)),
          "-y",
          String(Math.floor(y0 * sy)),
          "-W",
          String(Math.ceil(x1 * sx) - Math.floor(x0 * sx)),
          "-H",
          String(Math.ceil(y1 * sy) - Math.floor(y0 * sy)),
          "-singlefile",
          "-cropbox",
          "-hide-annotations",
          "-png",
          sourcePdfPath,
          prefix,
        ],
        resourceDir,
      );
      const spans = group.spans.sort((a, b) => a.start - b.start);
      const unique = [];
      for (const span of spans) {
        const last = unique.at(-1);
        if (last && span.start < last.end) {
          last.end = Math.max(last.end, span.end);
          continue;
        }
        unique.push({ ...span });
      }
      if (
        replacements.some((r) =>
          unique.some((s) => s.start < r.end && s.end > r.start),
        )
      ) {
        warnings.push(`${group.id}: overlapping groups retained`);
        continue;
      }
      unique.forEach((span, index) =>
        replacements.push({
          ...span,
          content:
            index === 0
              ? `\n\n![](${path}){.pdf2md-figure}\n\n${group.caption}\n\n`
              : "",
        }),
      );
      const record = { ...group };
      delete record.spans;
      figures.push({ ...record, path, dpi: 300 });
    } catch (error) {
      warnings.push(
        `${group.id}: ${error.message}; original fragments retained`,
      );
    }
  }
  let output = markdown;
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    output =
      output.slice(0, replacement.start) +
      replacement.content +
      output.slice(replacement.end);
  return { markdown: output, figures, warnings };
}

function imageIn(block) {
  if (!["Para", "Plain"].includes(block.t)) return null;
  return block.c.length === 1 && block.c[0].t === "Image" ? block.c[0] : null;
}
function inlineText(nodes) {
  return nodes
    .map((node) => {
      if (node.t === "Str") return node.c;
      if (["Space", "SoftBreak", "LineBreak"].includes(node.t)) return " ";
      if (["Strong", "Emph", "Span"].includes(node.t))
        return inlineText(node.t === "Span" ? node.c[1] : node.c);
      return "";
    })
    .join("");
}
/** Bind a complete figure and its translated caption into one unbreakable unit. */
export function layoutFigureBlocks(document) {
  const output = structuredClone(document);
  const blocks = [];
  for (let i = 0; i < output.blocks.length; i++) {
    const block = output.blocks[i],
      image = imageIn(block);
    const grouped = image?.c[0][1]?.includes("pdf2md-figure");
    if (grouped) {
      const caption = output.blocks[i + 1];
      const hasCaption =
        caption &&
        ["Para", "Plain"].includes(caption.t) &&
        figureStart.test(inlineText(caption.c));
      image.c[0][2] = image.c[0][2].filter(
        ([k]) => k !== "width" && k !== "height",
      );
      image.c[0][2].push(["width", "100%"]);
      blocks.push(
        {
          t: "RawBlock",
          c: [
            "latex",
            "\\par\\medskip\\noindent\\begin{minipage}{\\linewidth}\\centering\n\\setkeys{Gin}{height=0.52\\textheight,keepaspectratio}",
          ],
        },
        block,
      );
      if (hasCaption) {
        blocks.push(
          {
            t: "RawBlock",
            c: ["latex", "\\par\\smallskip\\raggedright\\footnotesize"],
          },
          caption,
        );
        i++;
      }
      blocks.push({
        t: "RawBlock",
        c: ["latex", "\\end{minipage}\\par\\medskip"],
      });
    } else blocks.push(block);
  }
  output.blocks = blocks;
  return output;
}
