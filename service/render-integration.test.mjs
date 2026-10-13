/* global process, fetch, setTimeout, clearTimeout, AbortSignal */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, URL } from "node:url";
import { TextDecoder } from "node:util";

let child;
let base;
let output = "";
const tick = String.fromCharCode(96);
before(async () => {
  child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./render-service.mjs", import.meta.url))],
    {
      env: { ...process.env, SEMANTIC_RENDER_PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Renderer did not start: " + output)),
      15000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Renderer exited: " + output));
    });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        base = match[0];
        clearTimeout(timer);
        resolve();
      }
    });
  });
});
after(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
});

async function render(markdown) {
  const response = await fetch(base + "/v1/render-markdown", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ markdown }),
    signal: AbortSignal.timeout(180000),
  });
  assert.equal(response.status, 200, response.ok ? "" : await response.text());
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.equal(new TextDecoder().decode(bytes.subarray(0, 5)), "%PDF-");
  assert.ok(bytes.length > 1000);
  return response;
}

test(
  "common paper formats must render normally, not pass by falling back",
  { timeout: 180000 },
  async () => {
    const response = await render(String.raw`# 数学兼容性集成测试

行内 $E=mc^2$，\(\mathbf C\)，金额 \$5，代码 ${tick}$$$$literal$$$$${tick}。

$$a=1$$$$b=2$$

$$$$x^2+y^2=z^2$$$$

\[\bm{\alpha}+\boldsymbol{\sigma}+\mathscr F+\mathbb R\tag{1}\]

$$\begin{align*}a&=b\\c&=d\tag{2}\end{align*}$$

$$\begin{split}f&=a+b\\&=c+d\end{split}\tag{3}$$

$$\begin{bmatrix*}[r]a&b\\c&d\end{bmatrix*}$$

$$f(x)=\begin{cases}x,&x≥0\\-x,&x<0\end{cases}$$

$$∇⋅σ=0,\quad a⋆b,\quad\left⟨x\right⟩,\quad\left⌊x\right⌋,\quad\left‖x\right‖_2$$

$$x−y+10^{−3}+a∗b$$

Unicode 字形：$𝐂+𝒶+𝑥+𝛔$。

$$\SI{450}{\mega\pascal},\quad\qty{0.5}{\nano\metre}$$

<table><tr><th>参数</th><th>公式</th></tr><tr><td>应变</td><td>$ε_{ij}$</td></tr></table>
`);
    assert.equal(response.headers.get("x-render-mode"), "normal");
    assert.equal(response.headers.get("x-render-fallback-count"), "0");
    assert.equal(response.headers.get("x-render-missing-glyph-count"), "0");
  },
);

test(
  "unknown commands remain readable while valid formulas stay formatted",
  { timeout: 180000 },
  async () => {
    const response = await render(String.raw`# 回退兼容性

正常公式 $F=ma$。

$$\DefinitelyInvalidMacro{x}\tag{X}$$
`);
    assert.equal(response.headers.get("x-render-mode"), "partial-raw");
    assert.equal(response.headers.get("x-render-fallback-count"), "1");
    assert.equal(response.headers.get("x-render-missing-glyph-count"), "0");
  },
);
