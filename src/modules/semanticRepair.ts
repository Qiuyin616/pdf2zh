export type FormulaKind = "display" | "inline";

export type FormulaRecord = {
  id: string;
  raw: string;
  body: string;
  kind: FormulaKind;
  tag: string;
  container: "body" | "table";
};

export type ProtectedMarkdown = {
  text: string;
  images: string[];
  tables: string[];
  formulas: FormulaRecord[];
};

export type FormulaRepair = {
  id: string;
  status?: "unchanged" | "repaired" | "corrected" | "rejected" | "needs_human";
  latex?: string;
  reason?: string;
  confidence?: number;
};

export type InlineFormulaCandidate = {
  span: string;
  latex: string;
  reason?: string;
  confidence?: number;
  chunk?: number;
};

export type PlaceholderCheck = {
  images: {
    expected: number;
    preserved: number;
    missing: string[];
    extra: string[];
  };
  tables: {
    expected: number;
    preserved: number;
    missing: string[];
    extra: string[];
  };
  formulas: {
    expected: number;
    preserved: number;
    missing: string[];
    extra: string[];
  };
};

const DISPLAY_MATH = /\$\$[\s\S]*?\$\$/g;
const INLINE_MATH = /(?<!\\)\$(?!\$)[\s\S]*?(?<!\\)\$/g;
const IMAGE = /!\[[^\]]*\]\([^)]+\)/g;
const TABLE = /<table>[\s\S]*?<\/table>/gi;

function protectMatches(
  input: string,
  pattern: RegExp,
  prefix: string,
  onMatch: (raw: string, id: string) => void,
): string {
  let index = 0;
  return input.replace(pattern, (raw) => {
    const id = `${prefix}${String(++index).padStart(3, "0")}`;
    onMatch(raw, id);
    return `[[${id}]]`;
  });
}

function formulaBody(raw: string): { body: string; kind: FormulaKind } {
  if (raw.startsWith("$$")) {
    return { body: raw.slice(2, -2).trim(), kind: "display" };
  }
  return { body: raw.slice(1, -1).trim(), kind: "inline" };
}

function formulaTag(body: string): string {
  return body.match(/\\tag\{([^}]+)\}/)?.[1] || "";
}

/**
 * Protect assets before translation while still tokenizing formulas inside tables.
 * This ordering is intentional: protecting a whole table first hides its math.
 */
export function protectMarkdown(markdown: string): ProtectedMarkdown {
  const images: string[] = [];
  const tables: string[] = [];
  const formulas: FormulaRecord[] = [];
  let text = String(markdown || "").replace(/\r\n/g, "\n");

  text = protectMatches(text, IMAGE, "IMG", (raw) => images.push(raw));
  let mathIndex = 0;
  const protectMath = (pattern: RegExp) =>
    text.replace(pattern, (raw) => {
      const id = `MATH${String(++mathIndex).padStart(3, "0")}`;
      const parsed = formulaBody(raw);
      formulas.push({
        id,
        raw,
        body: parsed.body,
        kind: parsed.kind,
        tag: formulaTag(parsed.body),
        container: "body",
      });
      return `[[${id}]]`;
    });
  text = protectMath(DISPLAY_MATH);
  /* Inline math is tokenized after display math so the dollar pairs do not overlap. */
  text = protectMath(INLINE_MATH);
  text = protectMatches(text, TABLE, "TABLE", (raw) => tables.push(raw));

  for (const formula of formulas) {
    if (tables.some((table) => table.includes(`[[${formula.id}]]`))) {
      formula.container = "table";
    }
  }
  return { text, images, tables, formulas };
}

export function chunkProtectedMarkdown(
  text: string,
  maxChars = 13500,
): string[] {
  const blocks = String(text || "").split(/\n\s*\n/);
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const block of blocks) {
    const nextSize = block.length + 2;
    if (current.length && size + nextSize > maxChars) {
      chunks.push(current.join("\n\n"));
      current = [];
      size = 0;
    }
    current.push(block);
    size += nextSize;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

export function formulaInventoryForChunk(
  chunk: string,
  protectedDoc: ProtectedMarkdown,
): FormulaRecord[] {
  const tableIds = [...chunk.matchAll(/\[\[TABLE(\d{3})\]\]/g)].map(
    (m) => `TABLE${m[1]}`,
  );
  return protectedDoc.formulas.filter(
    (formula) =>
      chunk.includes(`[[${formula.id}]]`) ||
      (formula.container === "table" &&
        tableIds.some((tableId) =>
          protectedDoc.tables[Number(tableId.slice(5)) - 1]?.includes(
            `[[${formula.id}]]`,
          ),
        )),
  );
}

function stripMathDelimiters(value: string): string {
  return String(value || "")
    .replace(/^\$\$[\s\S]*\$\$$/, (x) => x.slice(2, -2))
    .replace(/^\$[\s\S]*\$$/, (x) => x.slice(1, -1))
    .trim();
}

function wrapFormula(record: FormulaRecord, latex: string): string {
  let body = stripMathDelimiters(latex);
  if (record.tag && !/\\tag\{/.test(body) && record.kind === "display") {
    body += `\\tag{${record.tag}}`;
  }
  return record.kind === "display" ? `$$\n${body}\n$$` : `$${body}$`;
}

function expandTables(text: string, tables: string[]): string {
  return text.replace(/\[\[TABLE(\d{3})\]\]/g, (placeholder, index) => {
    return tables[Number(index) - 1] ?? placeholder;
  });
}

export function restoreMarkdown(
  translated: string,
  protectedDoc: ProtectedMarkdown,
  repairs: FormulaRepair[],
): string {
  const byID = new Map(
    repairs
      .filter((repair) => /^MATH\d{3}$/.test(String(repair.id || "")))
      .map((repair) => [repair.id, repair]),
  );
  // Tables contain nested math/image placeholders; expand them before restoring assets.
  let output = expandTables(translated, protectedDoc.tables);
  for (const formula of protectedDoc.formulas) {
    const repair = byID.get(formula.id);
    const useOriginal =
      !repair ||
      !repair.latex ||
      repair.status === "unchanged" ||
      repair.status === "rejected" ||
      repair.status === "needs_human";
    const replacement = useOriginal
      ? formula.raw
      : wrapFormula(formula, repair.latex as string);
    output = output.replace(`[[${formula.id}]]`, () => replacement);
  }
  for (let i = 0; i < protectedDoc.images.length; i++) {
    output = output.replace(
      `[[IMG${String(i + 1).padStart(3, "0")}]]`,
      () => protectedDoc.images[i],
    );
  }
  return output;
}

function placeholderSet(text: string, prefix: string): Set<string> {
  return new Set(
    [
      ...String(text || "").matchAll(
        new RegExp(`\\[\\[${prefix}\\d{3}\\]\\]`, "g"),
      ),
    ].map((m) => m[0]),
  );
}

export function checkPlaceholders(
  original: ProtectedMarkdown,
  translated: string,
): PlaceholderCheck {
  const check = (prefix: string, expected: number) => {
    const wanted = new Set(
      Array.from(
        { length: expected },
        (_, i) => `[[${prefix}${String(i + 1).padStart(3, "0")}]]`,
      ),
    );
    const actual = placeholderSet(
      prefix === "TABLE"
        ? translated
        : expandTables(translated, original.tables),
      prefix,
    );
    return {
      expected,
      preserved: [...wanted].filter((x) => actual.has(x)).length,
      missing: [...wanted].filter((x) => !actual.has(x)),
      extra: [...actual].filter((x) => !wanted.has(x)),
    };
  };
  return {
    images: check("IMG", original.images.length),
    tables: check("TABLE", original.tables.length),
    formulas: check("MATH", original.formulas.length),
  };
}

export function parseMarkedBlock(
  text: string,
  start: string,
  end: string,
): string {
  const match = String(text || "").match(
    new RegExp(`${start}\\s*([\\s\\S]*?)\\s*${end}`, "i"),
  );
  return match?.[1]?.trim() || "";
}

export function parseJSONList<T = any>(text: string): T[] {
  try {
    const parsed = JSON.parse(text || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
