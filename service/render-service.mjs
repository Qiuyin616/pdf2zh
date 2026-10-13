#!/usr/bin/env node
/* global process, Buffer, console */

import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

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
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
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
  try {
    await writeFile(markdownPath, payload.markdown, "utf8");
    const resourcePath = String(payload.resourceDir || dir);
    await run(
      pandoc,
      [
        markdownPath,
        "--from",
        "markdown+tex_math_dollars+raw_tex",
        "--pdf-engine=xelatex",
        `--resource-path=${resourcePath}`,
        "-V",
        "documentclass=ctexart",
        "-V",
        "geometry:margin=1in",
        "-o",
        pdfPath,
      ],
      dir,
    );
    return await readFile(pdfPath);
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
    const pdf = await render(payload);
    res.writeHead(200, {
      "content-type": "application/pdf",
      "content-length": pdf.length,
    });
    res.end(pdf);
  } catch (error) {
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: String(error?.message || error) }));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Semantic render service listening on http://127.0.0.1:${port}`);
});
