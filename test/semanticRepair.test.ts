import { assert } from "chai";
import {
  checkPlaceholders,
  protectMarkdown,
  restoreMarkdown,
} from "../src/modules/semanticRepair";

describe("semantic repair placeholders", function () {
  it("preserves images, tables, display math, and inline math", function () {
    const source =
      "![](images/a.png)\n\n$C=F^TF$\n\n$$\\mathbf{C}=\\mathbf{F}^T\\mathbf{F}\\tag{1}$$\n\n<table><tr><td>$I_1$</td></tr></table>";
    const protectedDoc = protectMarkdown(source);
    assert.equal(protectedDoc.images.length, 1);
    assert.equal(protectedDoc.tables.length, 1);
    assert.equal(protectedDoc.formulas.length, 3);
    const check = checkPlaceholders(protectedDoc, protectedDoc.text);
    assert.equal(check.images.preserved, 1);
    assert.equal(check.tables.preserved, 1);
    assert.equal(check.formulas.preserved, 3);
    const restored = restoreMarkdown(protectedDoc.text, protectedDoc, []);
    assert.equal(restored, source);
  });

  it("restores a repaired formula and keeps its equation tag", function () {
    const source = "$$\\mathbf{u}^{(i)}\\tag{1}$$";
    const protectedDoc = protectMarkdown(source);
    const restored = restoreMarkdown(protectedDoc.text, protectedDoc, [
      {
        id: "MATH001",
        status: "repaired",
        latex: "\\boldsymbol{u}^{(i)}",
        confidence: 0.99,
      },
    ]);
    assert.include(restored, "\\boldsymbol{u}^{(i)}");
    assert.include(restored, "\\tag{1}");
    assert.match(restored, /^\$\$\n[\s\S]*\n\$\$$/);
  });

  it("restores repaired math and images inside a table", function () {
    const source = "<table><tr><td>$u$ ![](images/a.png)</td></tr></table>";
    const doc = protectMarkdown(source);
    const check = checkPlaceholders(doc, doc.text);
    assert.deepEqual(check.images.missing, []);
    assert.deepEqual(check.formulas.missing, []);
    const restored = restoreMarkdown(doc.text, doc, [
      { id: "MATH001", status: "repaired", latex: "\\mathbf{u}" },
    ]);
    assert.equal(
      restored,
      "<table><tr><td>$\\mathbf{u}$ ![](images/a.png)</td></tr></table>",
    );
    const missing = checkPlaceholders(doc, "");
    assert.equal(missing.images.missing.length, 1);
    assert.equal(missing.formulas.missing.length, 1);
    assert.equal(missing.tables.missing.length, 1);
  });

  it("preserves the complete group layout marker through translation placeholders", function () {
    const source =
      "![](images/figure-03-2.png){.pdf2md-figure}\n\nFig. 2 | caption $x$.";
    const doc = protectMarkdown(source);
    assert.equal(doc.images[0], "![](images/figure-03-2.png){.pdf2md-figure}");
    assert.notInclude(doc.text, ".pdf2md-figure");
    assert.equal(restoreMarkdown(doc.text, doc, []), source);
  });
});
