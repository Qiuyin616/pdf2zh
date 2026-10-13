/* global structuredClone */

export const mathPreamble = [
  "\\usepackage{mathtools,amssymb,bm,mathrsfs,graphicx}",
  "\\allowdisplaybreaks",
  "\\IfFontExistsTF{STIX Two Math}{\\newfontfamily{\\PDFtoMDMathGlyphFont}{STIX Two Math}}{\\newfontfamily{\\PDFtoMDMathGlyphFont}{texgyrepagella-math.otf}}",
  "\\providecommand{\\PDFtoMDUnicodeMath}[1]{\\text{\\PDFtoMDMathGlyphFont #1}}",
  "\\providecommand{\\PDFtoMDMathFit}[2]{\\begingroup\\setbox0=\\hbox{$\\displaystyle #2$}\\ifdim\\wd0>#1\\relax\\resizebox{#1}{!}{\\box0}\\else\\box0\\fi\\endgroup}",
  "\\IfFileExists{siunitx.sty}{\\usepackage{siunitx}}{}",
  "\\IfFileExists{mhchem.sty}{\\usepackage[version=4]{mhchem}}{}",
  "\\usepackage{fvextra}",
  "\\RecustomVerbatimEnvironment{verbatim}{Verbatim}{breaklines=true,breakanywhere=true}",
  "\\ifdefined\\Highlighting",
  "\\RecustomVerbatimEnvironment{Highlighting}{Verbatim}{commandchars=\\\\\\{\\},breaklines=true,breakanywhere=true}",
  "\\fi",
].join("\n");

export function mathTemplate(template) {
  const hook = "$fonts.latex()$";
  if (!template.includes(hook))
    throw new Error(
      "Unsupported Pandoc font template: fonts.latex hook missing",
    );
  return template.replace(hook, () =>
    [
      "\\usepackage{iftex}",
      "\\usepackage{fontspec}",
      "\\defaultfontfeatures{Scale=MatchLowercase}",
      "\\defaultfontfeatures[\\rmfamily]{Ligatures=TeX,Scale=1}",
      "\\usepackage{lmodern}",
      "\\IfFontExistsTF{Libertinus Serif}{\\setmainfont{Libertinus Serif}}{\\IfFontExistsTF{Times New Roman}{\\setmainfont{Times New Roman}}{}}",
      "\\IfFontExistsTF{DejaVu Sans Mono}{\\setmonofont{DejaVu Sans Mono}}{\\IfFontExistsTF{Menlo}{\\setmonofont{Menlo}}{\\IfFontExistsTF{Consolas}{\\setmonofont{Consolas}}{}}}",
    ].join("\n"),
  );
}

const outerEnvironments =
  /^(?:equation|align|alignat|gather|multline|flalign|eqnarray)\*?$/;
const innerEnvironments =
  /^(?:aligned|alignedat|gathered|split|cases|dcases|rcases|drcases|[pbBvV]?matrix\*?|smallmatrix|array)$/;
const symbols = {
  α: "alpha",
  β: "beta",
  γ: "gamma",
  δ: "delta",
  ε: "varepsilon",
  ϵ: "epsilon",
  ζ: "zeta",
  η: "eta",
  θ: "theta",
  ϑ: "vartheta",
  ι: "iota",
  κ: "kappa",
  λ: "lambda",
  μ: "mu",
  ν: "nu",
  ξ: "xi",
  π: "pi",
  ρ: "rho",
  σ: "sigma",
  τ: "tau",
  υ: "upsilon",
  φ: "varphi",
  ϕ: "phi",
  χ: "chi",
  ψ: "psi",
  ω: "omega",
  Γ: "Gamma",
  Δ: "Delta",
  Θ: "Theta",
  Λ: "Lambda",
  Ξ: "Xi",
  Π: "Pi",
  Σ: "Sigma",
  Υ: "Upsilon",
  Φ: "Phi",
  Ψ: "Psi",
  Ω: "Omega",
  "∂": "partial",
  "∇": "nabla",
  "×": "times",
  "·": "cdot",
  "⋅": "cdot",
  "⋆": "star",
  "∗": "ast",
  "∘": "circ",
  "•": "bullet",
  "⊕": "oplus",
  "⊖": "ominus",
  "⊙": "odot",
  "≪": "ll",
  "≫": "gg",
  "≲": "lesssim",
  "≳": "gtrsim",
  "≺": "prec",
  "≻": "succ",
  "⟨": "langle",
  "⟩": "rangle",
  "⌊": "lfloor",
  "⌋": "rfloor",
  "⌈": "lceil",
  "⌉": "rceil",
  "‖": "Vert",
  "⊤": "top",
  "⊥": "perp",
  "±": "pm",
  "∓": "mp",
  "≤": "leq",
  "≥": "geq",
  "≠": "neq",
  "≈": "approx",
  "∞": "infty",
  "∈": "in",
  "∉": "notin",
  "⊗": "otimes",
  "∪": "cup",
  "∩": "cap",
  "∀": "forall",
  "∃": "exists",
  "∑": "sum",
  "∏": "prod",
  "∫": "int",
  "∬": "iint",
  "∭": "iiint",
  "∮": "oint",
  "∝": "propto",
  "→": "to",
  "←": "leftarrow",
  "↔": "leftrightarrow",
  "⇒": "Rightarrow",
  "⇐": "Leftarrow",
  "⇔": "Leftrightarrow",
  "↦": "mapsto",
  "↑": "uparrow",
  "↓": "downarrow",
  "↕": "updownarrow",
  "≡": "equiv",
  "∼": "sim",
  "≃": "simeq",
  "≅": "cong",
  "⊆": "subseteq",
  "⊂": "subset",
  "⊇": "supseteq",
  "⊃": "supset",
  "∧": "land",
  "∨": "lor",
  "¬": "neg",
  "∅": "varnothing",
  ℝ: "mathbb{R}",
  ℂ: "mathbb{C}",
  ℕ: "mathbb{N}",
  ℤ: "mathbb{Z}",
  ℚ: "mathbb{Q}",
  ℓ: "ell",
  ℏ: "hbar",
  ς: "varsigma",
  ϖ: "varpi",
  ϱ: "varrho",
  ϰ: "varkappa",
};

// Only replace mathematical Unicode outside explicit text-mode groups.
export function normalizeMathSymbols(source) {
  let output = "";
  for (let i = 0; i < source.length; ) {
    const textGroup = source
      .slice(i)
      .match(/^\\(?:text|textrm|textnormal|texttt|mbox|operatorname)\*?\s*\{/);
    if (textGroup) {
      let end = i + textGroup[0].length;
      let depth = 1;
      while (end < source.length && depth) {
        if (source[end] === "\\") {
          end += 2;
          continue;
        }
        if (source[end] === "{") depth++;
        if (source[end] === "}") depth--;
        end++;
      }
      output += source.slice(i, end);
      i = end;
      continue;
    }
    const char = source[i++];
    output += char === "−" ? "-" : symbols[char] ? `\\${symbols[char]} ` : char;
  }
  return output;
}

function completeEnvironment(source) {
  const match = source
    .trim()
    .match(/^\\begin\{([^}]+)\}[\s\S]*\\end\{([^}]+)\}$/);
  return match && match[1] === match[2] ? match[1] : null;
}

/** Canonicalize presentation only, leaving code, prose, and mathematical meaning alone. */
export function normalizeMathDocument(document) {
  const output = structuredClone(document);
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if ((value.t === "Para" || value.t === "Plain") && Array.isArray(value.c)) {
      const nodes = value.c;
      for (let i = 1; i + 1 < nodes.length; i++) {
        const node = nodes[i];
        // Pandoc parses redundant $$$$x$$$$ as "$", Math("$x"), "$$".
        if (
          nodes[i - 1].t === "Str" &&
          nodes[i - 1].c.endsWith("$") &&
          node.t === "Math" &&
          node.c[0].t === "DisplayMath" &&
          node.c[1].startsWith("$") &&
          nodes[i + 1].t === "Str" &&
          nodes[i + 1].c.startsWith("$$")
        ) {
          node.c[1] = node.c[1].slice(1);
          nodes[i - 1].c = nodes[i - 1].c.slice(0, -1);
          nodes[i + 1].c = nodes[i + 1].c.slice(2);
          if (!nodes[i + 1].c) nodes.splice(i + 1, 1);
          if (!nodes[i - 1].c) {
            nodes.splice(i - 1, 1);
            i--;
          }
        }
      }
    }
    if (value.t === "Math") {
      if (value.c[0].t === "InlineMath" && /\\tag\*?\{/.test(value.c[1]))
        value.c[0].t = "DisplayMath";
      const environment = completeEnvironment(value.c[1]);
      value.c[1] = normalizeMathSymbols(value.c[1]);
      if (
        value.c[0].t === "DisplayMath" &&
        environment &&
        outerEnvironments.test(environment)
      ) {
        value.t = "RawInline";
        value.c = ["tex", value.c[1]];
      }
      return;
    }
    if (
      (value.t === "RawInline" || value.t === "RawBlock") &&
      value.c[0] === "tex"
    ) {
      const environment = completeEnvironment(value.c[1]);
      if (environment && outerEnvironments.test(environment))
        value.c[1] = normalizeMathSymbols(value.c[1]);
      if (environment && innerEnvironments.test(environment)) {
        const math = {
          t: "Math",
          c: [{ t: "DisplayMath" }, normalizeMathSymbols(value.c[1])],
        };
        if (value.t === "RawBlock") {
          value.t = "Para";
          value.c = [math];
        } else {
          value.t = math.t;
          value.c = math.c;
        }
      }
      return;
    }
    if (value.t === "Code" || value.t === "CodeBlock") return;
    for (const child of Object.values(value)) visit(child);
  }
  visit(output);
  return output;
}

export async function expandHtmlTables(document, parseHtml, serializeBlocks) {
  async function visit(value) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const node = value[i];
        if (
          node?.t === "RawBlock" &&
          node.c[0] === "html" &&
          /^\s*<table\b/i.test(node.c[1])
        ) {
          let end = i;
          let html = node.c[1];
          if (!/<\/table>\s*$/i.test(html) && serializeBlocks) {
            let depth = 1;
            while (++end < value.length) {
              const part = value[end];
              if (part?.t === "RawBlock" && part.c[0] === "html") {
                if (/^\s*<table\b/i.test(part.c[1])) depth++;
                if (/^\s*<\/table>/i.test(part.c[1])) depth--;
              }
              if (depth === 0) break;
            }
            if (end < value.length)
              html = await serializeBlocks(value.slice(i, end + 1));
            else end = i;
          }
          try {
            const parsed = await parseHtml(html);
            value.splice(i, end - i + 1, ...parsed.blocks);
            i += parsed.blocks.length - 1;
          } catch {
            // Preserve an unreadable table visibly, rather than dropping raw HTML.
            value[i] = { t: "CodeBlock", c: [["", ["html"], []], html] };
            if (end > i) value.splice(i + 1, end - i);
          }
        } else await visit(node);
      }
      return;
    }
    for (const child of Object.values(value)) await visit(child);
  }
  const output = structuredClone(document);
  await visit(output);
  return output;
}

/** Measure only display formulas; keep equation tags outside the measured box. */
export function fitDisplayMath(document) {
  const output = structuredClone(document);
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (value.t === "Math")
      value.c[1] = value.c[1].replace(
        /[\u{1d400}-\u{1d7ff}]/gu,
        (char) => `\\PDFtoMDUnicodeMath{${char}}`,
      );
    if (
      (value.t === "RawInline" || value.t === "RawBlock") &&
      value.c[0] === "tex" &&
      completeEnvironment(value.c[1])
    )
      value.c[1] = value.c[1].replace(
        /[\u{1d400}-\u{1d7ff}]/gu,
        (char) => `\\PDFtoMDUnicodeMath{${char}}`,
      );
    if (value.t === "Math" && value.c[0].t === "DisplayMath") {
      let body = value.c[1].trim();
      let suffix = "";
      let match;
      while ((match = body.match(/\\(?:tag\*?|label)\{[^{}]*\}\s*$/))) {
        suffix = match[0] + suffix;
        body = body.slice(0, match.index).trimEnd();
      }
      if (
        !/\\(?:tag|label|eqno|leqno)\b/.test(body) &&
        !/\\begin\{split\}/.test(body)
      ) {
        const width = suffix.includes("\\tag")
          ? "0.88\\linewidth"
          : "\\linewidth";
        value.c[1] = `\\PDFtoMDMathFit{${width}}{${body}}${suffix}`;
      }
      return;
    }
    if (value.t === "Code" || value.t === "CodeBlock") return;
    for (const child of Object.values(value)) visit(child);
  }
  visit(output);
  return output;
}
