/* global Response, setTimeout, URL, TextDecoder */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  readdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import ts from "typescript";

const dir = await mkdtemp(join(tmpdir(), "pdf2md-client-test-"));
for (const name of ["semanticRepair", "semanticPipeline", "taskDiagnostics"]) {
  const source = await readFile(
    new URL(`../src/modules/${name}.ts`, import.meta.url),
    "utf8",
  );
  const compiled = ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
      },
    })
    .outputText.replace('"./semanticRepair"', '"./semanticRepair.mjs"');
  await writeFile(join(dir, `${name}.mjs`), compiled);
}
const { SemanticPipeline } = await import(
  pathToFileURL(join(dir, "semanticPipeline.mjs"))
);
const { TaskDiagnostics } = await import(
  pathToFileURL(join(dir, "taskDiagnostics.mjs"))
);
const addonSource = await readFile(
  new URL("../src/modules/pdfToMd.ts", import.meta.url),
  "utf8",
);
const addonCompiled = ts
  .transpileModule(addonSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
    },
  })
  .outputText.replace(
    /import .* from "..\/..\/package.json";/,
    'const config = {addonRef:"pdftomd"}; const version="test";',
  )
  .replace(
    /import .* from "..\/utils\/prefs";/,
    "const getPref = (key) => globalThis.testPrefs[key]; const setPref = () => {};",
  )
  .replace(
    /import .* from "\.\/renderHtml";/,
    "const renderMarkdownToHTML = () => {}; const renderMarkdownZipToHTML = () => {};",
  )
  .replace('"./semanticPipeline"', '"./semanticPipeline.mjs"')
  .replace('"./taskDiagnostics"', '"./taskDiagnostics.mjs"');
await writeFile(join(dir, "pdfToMd.mjs"), addonCompiled);
const { PDFToMarkdownService } = await import(
  pathToFileURL(join(dir, "pdfToMd.mjs"))
);
const options = {
  apiUrl: "http://example.invalid",
  apiKey: "test-secret",
  model: "test",
};

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("HTTP render error survives the real request and is written before task failure", async () => {
  const files = new Map();
  const log = new TaskDiagnostics(
    async (name, content) => {
      files.set(name, content);
    },
    [options.apiKey],
  );
  await log.event("stage", { status: "渲染 PDF" });
  await withServer(
    (req, res) => {
      assert.equal(req.url, "/v1/render-markdown");
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Missing $ inserted: equation 1" }));
    },
    async (url) => {
      const pipeline = new SemanticPipeline({
        ...options,
        diagnostic: (type, detail) => log.event(type, detail),
      });
      await assert.rejects(
        pipeline.renderMarkdown("$broken", "title", "/tmp", url),
        /Missing \$ inserted: equation 1/,
      );
    },
  );
  await log.finish("failed", { error: "compile failed" });
  const events = [...files.values()].join("\n");
  assert.match(events, /Missing \$ inserted: equation 1/);
  assert.match(events, /render.response/);
  assert.match(events, /render.error/);
  assert.equal(JSON.parse(files.get("status.json")).stage, "渲染 PDF");
});

test("rejects non-PDF HTTP 200 and captures fallback metadata on valid PDFs", async () => {
  const events = [];
  let valid = false;
  await withServer(
    (req, res) => {
      res.writeHead(200, {
        "x-render-mode": "partial-raw",
        "x-render-fallback-count": "2",
      });
      res.end(valid ? "%PDF-test" : "{error: 'not a PDF'}");
    },
    async (url) => {
      const pipeline = new SemanticPipeline({
        ...options,
        diagnostic: async (type, detail) => {
          events.push({ type, detail });
        },
      });
      await assert.rejects(
        pipeline.renderMarkdown("x", "t", "/tmp", url),
        /不是 PDF/,
      );
      valid = true;
      const bytes = await pipeline.renderMarkdown("x", "t", "/tmp", url);
      assert.equal(new TextDecoder().decode(bytes), "%PDF-test");
    },
  );
  assert.ok(
    events.some(
      (e) => e.type === "render.response" && e.detail.fallbackCount === "2",
    ),
  );
});

test("bounds stalled rendering and logs the timeout", async () => {
  const events = [];
  await withServer(
    () => {},
    async (url) => {
      const pipeline = new SemanticPipeline({
        ...options,
        renderTimeoutMs: 25,
        diagnostic: async (type, detail) => {
          events.push({ type, detail });
        },
      });
      await assert.rejects(
        pipeline.renderMarkdown("x", "t", "/tmp", url),
        /渲染超时/,
      );
    },
  );
  assert.ok(
    events.some(
      (e) => e.type === "render.error" && /超时/.test(e.detail.message),
    ),
  );
});

test("records partial translation responses and redacts credentials without losing Unicode", async () => {
  const files = new Map();
  const log = new TaskDiagnostics(
    async (name, content) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      files.set(name, content);
    },
    [options.apiKey],
  );
  let number = 0;
  const pipeline = new SemanticPipeline({
    ...options,
    chunkChars: 60,
    diagnostic: (type, detail) => log.event(type, detail),
    fetchImpl: async () => {
      if (++number === 2) throw new Error("connection interrupted");
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "BEGIN_MARKDOWN\n中文 test-secret\nEND_MARKDOWN",
              },
            },
          ],
          usage: { total_tokens: 9 },
        }),
        { status: 200 },
      );
    },
  });
  await assert.rejects(
    pipeline.run(
      Array.from({ length: 12 }, () => "paragraph ".repeat(6)).join("\n\n"),
    ),
    /connection interrupted/,
  );
  await log.finish("failed", { error: "test-secret" });
  const text = [...files.values()].join("\n");
  assert.match(text, /中文 <REDACTED>/);
  assert.doesNotMatch(text, /test-secret/);
  assert.match(text, /total_tokens/);
  assert.match(text, /ai.error/);
  const sequences = [...files.entries()]
    .filter(([name]) => name.startsWith("event-"))
    .map(([, value]) => JSON.parse(value).sequence);
  assert.deepEqual(
    sequences,
    sequences.map((_, i) => i + 1),
  );
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("Zotero job retains translated checkpoints, full render failure and completed import across cleanup", async () => {
  const root = join(dir, "zotero-jobs");
  globalThis.testPrefs = {
    useLocalApi: true,
    localApiType: "api",
    semanticApiUrl: "http://ai.invalid",
    semanticApiKey: "test-secret",
    semanticRenderUrl: "http://renderer.invalid",
    semanticModel: "test",
  };
  globalThis.addon = { data: { alive: true } };
  globalThis.ztoolkit = { log: () => {} };
  globalThis.PathUtils = { join, parent: dirname };
  globalThis.IOUtils = {
    makeDirectory: async (path) => {
      await mkdir(path, { recursive: true });
    },
    writeUTF8: async (path, text) => {
      await writeFile(path, text);
    },
    readUTF8: async (path) => readFile(path, "utf8"),
    write: async (path, bytes) => {
      await writeFile(path, bytes);
    },
    remove: async (path) => {
      await rm(path, { recursive: true, force: true });
    },
  };
  globalThis.Zotero = {
    getTempDirectory: () => ({ path: root }),
    Attachments: {
      importFromFile: async () => ({
        key: "OUTPUT",
        id: 42,
        addTag: () => {},
        saveTx: async () => {},
      }),
    },
  };
  let successful = false;
  for (const expected of ["failed", "completed"]) {
    const job = {
      att: { key: "INPUT", libraryID: 1, getCollections: () => [] },
      parent: null,
      path: "source.pdf",
      pdfName: "source.pdf",
      outputName: "article.md",
      dataId: "L1-INPUT",
      progressKey: "job",
      semantic: true,
      outputFormat: "markdown",
      saved: false,
      errMsg: "",
    };
    const service = new PDFToMarkdownService();
    service.collectJobs = async () => ({ jobs: [job], skipped: [] });
    for (const method of [
      "statusShow",
      "statusTotal",
      "statusDone",
      "statusQueued",
      "statusCurrent",
      "statusNote",
      "statusHeadline",
      "statusClose",
      "statusLine",
    ])
      service[method] = () => {};
    service.fetchWithTimeout = async (url, opts) =>
      new Response(
        url.endsWith("/v1/prepare-figures")
          ? JSON.stringify({
              markdown: JSON.parse(opts.body).markdown,
              figures: [],
              warnings: [],
            })
          : "{}",
        { status: 200 },
      );
    service.mainWindow = () => ({
      fetch: async (url) => {
        if (url.endsWith("/chat/completions"))
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: "BEGIN_MARKDOWN\n译文 $x$\nEND_MARKDOWN",
                  },
                },
              ],
              usage: { total_tokens: 10 },
            }),
          );
        return successful
          ? new Response("%PDF-test", { status: 200 })
          : new Response(JSON.stringify({ error: "Bad LaTeX: equation 7" }), {
              status: 500,
            });
      },
    });
    service.processLocalJob = async (current) => {
      const temp = service.jobTmpDir(current);
      const source = join(temp, "source.md");
      await writeFile(source, "Original $x$");
      try {
        await service.saveSemanticResult(current, source, "", temp);
        current.saved = true;
        service.setLine(current, "完成", "done");
      } catch (error) {
        current.errMsg = error.message;
        service.setLine(current, current.errMsg, "error");
      }
    };
    await service.runConversion([], null, {
      interactive: false,
      outputFormat: "markdown",
      semantic: true,
    });
    const status = JSON.parse(
      await readFile(join(job.tmpDir, "status.json"), "utf8"),
    );
    assert.equal(status.status, expected, status.error);
    assert.match(
      await readFile(join(job.tmpDir, "translated.md"), "utf8"),
      /译文/,
    );
    assert.equal(
      JSON.parse(await readFile(join(job.tmpDir, "render-input.json"), "utf8"))
        .resourceDir,
      job.tmpDir,
    );
    const timeline = await readFile(join(job.tmpDir, "timeline.log"), "utf8");
    assert.match(
      timeline,
      successful ? /attachment.imported/ : /Bad LaTeX: equation 7/,
    );
    if (successful)
      assert.ok((await stat(join(job.tmpDir, "article.pdf"))).size > 0);
    assert.equal((await readdir(job.tmpDir)).includes("task.json"), true);
    successful = true;
  }
});

test("group layout markers survive real semantic placeholder restoration", async () => {
  const { protectMarkdown, restoreMarkdown } = await import(
    pathToFileURL(join(dir, "semanticRepair.mjs"))
  );
  const source =
    "![](images/figure-03-2.png){.pdf2md-figure}\n\n图 2 | 图注 $x$.";
  const doc = protectMarkdown(source);
  assert.equal(doc.images[0], "![](images/figure-03-2.png){.pdf2md-figure}");
  assert.ok(!doc.text.includes("pdf2md-figure"));
  assert.equal(restoreMarkdown(doc.text, doc, []), source);
});
