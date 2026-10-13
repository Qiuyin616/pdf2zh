#!/usr/bin/env node
/* global process, Buffer, console */

import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout, clearTimeout } from "node:timers";
import { renderCompatible } from "./render-compatibility.mjs";
import {
  normalizeMathDocument,
  expandHtmlTables,
  mathPreamble,
  mathTemplate,
  fitDisplayMath,
} from "./math-normalization.mjs";

const port = Number(process.env.SEMANTIC_RENDER_PORT || 8765);
const pandoc = process.env.PANDOC_BIN || "pandoc";

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        reject(new Error("request body is too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const timer = setTimeout(() => {
      try {
        if (process.platform === "win32") child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        // The process may have exited between the deadline and the signal.
      }
      reject(new Error("renderer subprocess timed out"));
    }, 30000);
    let stderr = "";
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(new Error(stderr.slice(-4000) || `pandoc exited with ${code}`));
    });
  });
}

async function render(payload) {
  if (!payload || typeof payload.markdown !== "string") {
    throw new Error("markdown is required");
  }
  const dir = await mkdtemp(join(tmpdir(), "zotero-semantic-render-"));
  const markdownPath = join(dir, "document.md");
  const pdfPath = join(dir, "document.pdf");
  const headerPath = join(dir, "fallback-header.tex");
  const templatePath = join(dir, "math-template.tex");
  try {
    await writeFile(
      templatePath,
      mathTemplate((await run(pandoc, ["-D", "latex"], dir)).stdout),
      "utf8",
    );
    await writeFile(headerPath, mathPreamble, "utf8");
    const resourcePath = String(payload.resourceDir || dir);
    const reader =
      "markdown+tex_math_dollars+tex_math_single_backslash+raw_tex";
    const parseSource = async (source, format) => {
      await writeFile(markdownPath, source, "utf8");
      return JSON.parse(
        (
          await run(
            pandoc,
            [markdownPath, "--from", format, "--to", "json"],
            dir,
          )
        ).stdout,
      );
    };
    const parse = async (markdown) =>
      normalizeMathDocument(
        await expandHtmlTables(
          await parseSource(markdown, reader),
          (html) =>
            parseSource(
              html,
              "html+tex_math_dollars+tex_math_single_backslash",
            ),
          async (blocks) => {
            const empty = await parseSource("", reader);
            empty.blocks = blocks;
            await writeFile(markdownPath, JSON.stringify(empty), "utf8");
            return (
              await run(
                pandoc,
                [markdownPath, "--from", "json", "--to", "html", "--mathjax"],
                dir,
              )
            ).stdout;
          },
        ),
      );
    const result = await renderCompatible(payload.markdown, {
      parse,
      compile: async ({ markdown, document }) => {
        const prepared = document || (await parse(markdown));
        await rm(pdfPath, { force: true });
        await writeFile(
          markdownPath,
          JSON.stringify(fitDisplayMath(prepared)),
          "utf8",
        );
        const compiled = await run(
          pandoc,
          [
            markdownPath,
            "--from",
            "json",
            "--pdf-engine=xelatex",
            `--resource-path=${resourcePath}`,
            "-V",
            "documentclass=ctexart",
            "--template",
            templatePath,
            "-V",
            "geometry:margin=1in",
            "--include-in-header",
            headerPath,
            "-o",
            pdfPath,
          ],
          dir,
        );
        return {
          data: await readFile(pdfPath),
          warningCount: (compiled.stderr.match(/^\[WARNING\]/gm) || []).length,
          missingGlyphCount: (compiled.stderr.match(/Missing character/g) || [])
            .length,
        };
      },
    });
    return {
      ...result,
      pdf: result.pdf.data,
      warningCount: result.pdf.warningCount,
      missingGlyphCount: result.pdf.missingGlyphCount,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/v1/render-markdown") {
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
    return;
  }
  try {
    const payload = JSON.parse(await readBody(req));
    const { pdf, mode, fallbackCount, warningCount, missingGlyphCount } =
      await render(payload);
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": pdf.length,
      "x-render-mode": mode,
      "x-render-fallback-count": fallbackCount,
      "x-render-warning-count": warningCount,
      "x-render-missing-glyph-count": missingGlyphCount,
    });
    res.end(pdf);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error?.message || error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    `Semantic render service listening on http://127.0.0.1:${server.address().port}`,
  );
});
