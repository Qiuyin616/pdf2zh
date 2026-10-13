# pdf2zh

Experimental Zotero PDF translation fork of [LuckYang1/PDF-to-md](https://github.com/LuckYang1/PDF-to-md).

See the [Chinese README](README.md) for complete installation instructions, every setting, recommended configurations, troubleshooting and limitations.

## Installation

1. Download `pdf-to-markdown.xpi` from [this repository's Releases](https://github.com/Qiuyin616/pdf2zh/releases), install through Zotero Tools > Plugins > Install Add-on From File, and restart.
2. Configure your own MinerU service/credentials and a compatible Chat Completions translation API, supported model ID and reasoning effort.
3. Download the full repository. Install Node.js, Pandoc, XeLaTeX, ctex and Chinese fonts separately. The XPI does not contain the renderer or these dependencies.
4. Launch `Start-PDF-Renderer.command` on macOS or `Start-PDF-Renderer.bat` on Windows (not yet tested on Windows). Alternatively run `node service/render-service.mjs` from the repository root; no npm packages are needed for the renderer alone.
5. Set the renderer address to `http://127.0.0.1:8765`. Keep it running and restart it after reboot; automatic startup is not included.
6. Right-click the original PDF or its parent > PDF to Markdown > 翻译至 PDF. Only the final PDF is imported under the original item, not intermediate Markdown.

Verified on macOS with Zotero 9.0.6. Other environments need testing. The plugin retains upstream ID `pdf-to-md@local` and replaces, rather than coexists with, that plugin.

## Limitations and Privacy

Formula review covers proposed repairs, not all formulas. Inline formula candidate application is incomplete. Optional visual review sends the entire PDF and requires compatible PDF input support. Composite figures can expand page counts significantly. Retry, resume and persistent usage accounting are incomplete. Completed tasks still need scientific quality review.

The default model string is provider-specific and may not be available on the default API URL. Configure an ID and `reasoning_effort` supported by your provider.

Credentials belong in local Zotero settings and are blank in distributed defaults. Do not commit keys, tokens, logs, private papers or personal profiles. Password masking does not imply encrypted preference storage.

## Development

```bash
npm ci
npm run build
npm run lint:check
```

XPI: `.scaffold/build/pdf-to-markdown.xpi`. Configure a separate Zotero development profile using `.env.example` before development or Zotero-hosted tests. Fork maintainers must update repository, homepage and bugs URLs in `package.json` before building their own release/update feeds.

[AGPL-3.0-or-later](LICENSE). Upstream authorship and Git history are retained.
