function numberAttribute(tag, name) {
  return Number(tag.match(new RegExp(`\\b${name}="([\\d.eE+-]+)"`))?.[1]);
}

/** Inspect Poppler word boxes; use a tolerance for glyph overhang and rounding. */
export function inspectPdfLayout(xml, pageInfo = "") {
  const pages = [...xml.matchAll(/<page\b([^>]*)>([\s\S]*?)<\/page>/g)];
  if (!pages.length) throw new Error("PDF 版面检查未读取到页面");
  const overflow = [];
  const pageSizes = [];
  const rotations = new Map(
    [...pageInfo.matchAll(/Page\s+(\d+)\s+rot:\s*(-?\d+)/g)].map(
      ([, page, rotation]) => [Number(page), Number(rotation)],
    ),
  );
  let marginWarningCount = 0;
  let wordCount = 0;
  pages.forEach(([, attributes, content], index) => {
    let width = numberAttribute(attributes, "width");
    let height = numberAttribute(attributes, "height");
    // Poppler reports unrotated page dimensions but rotated word coordinates.
    if (Math.abs(rotations.get(index + 1) || 0) % 180 === 90)
      [width, height] = [height, width];
    if (!(width > 0 && height > 0))
      throw new Error("PDF 版面检查读取到无效页面尺寸");
    pageSizes.push({ page: index + 1, width, height });
    for (const [, word] of content.matchAll(/<word\b([^>]*)>/g)) {
      const box = ["xMin", "yMin", "xMax", "yMax"].map((name) =>
        numberAttribute(word, name),
      );
      if (!box.every(Number.isFinite))
        throw new Error("PDF 版面检查读取到无效文字坐标");
      wordCount++;
      if (
        box[0] < -1 ||
        box[1] < -1 ||
        box[2] > width + 1 ||
        box[3] > height + 1
      )
        overflow.push({ page: index + 1, box });
      else if (box[0] < 64 || box[2] > width - 64) marginWarningCount++;
    }
  });
  return {
    pageCount: pages.length,
    pageSizes,
    wordCount,
    marginWarningCount,
    overflow,
  };
}
