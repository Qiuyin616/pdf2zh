# pdf2zh

Zotero PDF 全文翻译插件，基于 [LuckYang1/PDF-to-md](https://github.com/LuckYang1/PDF-to-md) 改造。
保留 MinerU 的 Markdown / HTML 解析和附件导出，新增“翻译至 PDF”：解析 PDF、分片翻译与语义校订、渲染中文 PDF，并将最终 PDF 附回原文献条目。

**实验性版本，不是安装 XPI 即可运行的独立翻译器。** 翻译功能需要 MinerU、兼容的翻译 API 和另行启动的 PDF 渲染服务。数学修订属于模型推断，重要公式必须人工核对。

[下载 XPI](https://github.com/Qiuyin616/pdf2zh/releases/latest) · [反馈问题](https://github.com/Qiuyin616/pdf2zh/issues) · [English](README-en.md)

## 1. 安装插件

1. 从本仓库 [Releases](https://github.com/Qiuyin616/pdf2zh/releases) 下载 `pdf-to-markdown.xpi`，不要使用不含本改造的上游 XPI。
2. Zotero → 工具 → 插件 → 齿轮 → Install Add-on From File / 从文件安装插件。
3. 选择 XPI，重启 Zotero，打开设置中的 **PDF to Markdown**。显示名仍沿用此名称。

已在 macOS + Zotero 9.0.6 上验证翻译及附件导入。manifest 声明的范围不等于测试范围，其他版本、Windows、Linux 仍需验证。

插件 ID 仍为 `pdf-to-md@local`，与上游相同，不能作为两个独立插件同时安装。安装本版本会替换同 ID 的插件；已有设置可能保留。升级前建议备份 Zotero 数据。

## 2. MinerU 和翻译 API

- **在线 MinerU**：在 [API 管理页](https://mineru.net/apiManage/docs) 申请自己的 Token，填写“解析设置 → API Token”。原 PDF 将上传到 MinerU。
- **本地 MinerU**：按 [官方说明](https://github.com/opendatalab/MinerU/blob/master/README_zh-CN.md) 部署兼容 API / Router，再勾选“使用本地 MinerU API”。插件不负责安装 MinerU。
- **翻译 API**：填写供应商的 Chat Completions 基础地址、自己的 Key 和可用模型 ID。插件请求 `<基础地址>/chat/completions`，并发送 `reasoning_effort`。必须核实模型和参数兼容性。

未填写 MinerU Token、且未启用本地 API 时，会尝试轻量接口，当前代码按不超过 20 页处理。在线限额以服务方实际响应为准，长期使用建议配置 Token 或兼容的自建服务。

## 3. 安装和启动 PDF 渲染环境

**普通 Markdown / HTML 解析不需要本节；“翻译至 PDF”必须完成本节。**

下载完整源码 ZIP 并解压，或克隆本仓库 / 自己 fork 后的仓库：

```bash
git clone https://github.com/Qiuyin616/pdf2zh.git
cd pdf2zh
```

入口是 `service/render-service.mjs`。服务仅使用 Node.js 内置模块，单独运行它不需要 `npm install`，但需要以下系统依赖：

| 依赖            | 用途与安装                                                                                                  | 检查命令                           |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Node.js         | 安装 [Node.js LTS](https://nodejs.org/en/download)，运行 HTTP 服务                                          | `node --version`                   |
| Pandoc          | 按 [官方说明](https://pandoc.org/installing.html) 安装，转换 Markdown                                       | `pandoc --version`                 |
| XeLaTeX         | macOS 安装 [MacTeX](https://tug.org/mactex/)，Windows 安装 [TeX Live](https://tug.org/texlive/windows.html) | `xelatex --version`                |
| ctex / 中文字体 | 提供 `ctexart` 中文排版，完整 TeX 发行版通常已包含                                                          | `kpsewhich ctexart.cls` 应返回路径 |

首次安装推荐完整 TeX 发行版，体积较大但缺包排查较少；最小安装需要自行补齐 ctex、字体及 Pandoc 模板依赖。Linux 可通过系统包管理器安装 Node.js、Pandoc、XeTeX 和中文 TeX 支持，再执行上述检查。

### macOS

双击仓库根目录的 **Start-PDF-Renderer.command**。会检查依赖、端口，并补充 Homebrew / MacTeX 的常用 PATH。若 ZIP 解压后丢失可执行权限：

```bash
chmod +x Start-PDF-Renderer.command
./Start-PDF-Renderer.command
```

### Windows

安装依赖后重新打开终端，确认 Node.js、Pandoc、XeLaTeX 和 `kpsewhich` 在 PATH 中，然后双击 **Start-PDF-Renderer.bat**。窗口会保留错误提示；Windows 启动文件尚未在实机验证。

### 通用方式

在仓库根目录运行：

```bash
node service/render-service.mjs
# 或 npm run render-service
```

看到 `Semantic render service listening on http://127.0.0.1:8765` 后，将插件的“渲染服务”设为 **http://127.0.0.1:8765**，不要添加 `/v1/render-markdown`。

保持窗口和进程运行，按 Ctrl+C 停止。**设备重启后需要重新启动；本项目没有配置自动启动。** 重启 Zotero 不会启动渲染服务。端口占用时先确认是否已有服务，不要盲目结束其他程序。

macOS / Linux 修改端口或 Pandoc 路径：

```bash
SEMANTIC_RENDER_PORT=8766 PANDOC_BIN=/path/to/pandoc node service/render-service.mjs
```

Windows CMD 可先执行 `set SEMANTIC_RENDER_PORT=8766` 再运行 BAT。更改端口后同步修改 Zotero 设置。服务仅绑定本机 `127.0.0.1`，没有远程认证方案，不要直接对公网开放。

### 渲染测试

macOS / Linux 示例：

```bash
curl --fail-with-body http://127.0.0.1:8765/v1/render-markdown \
  -H 'Content-Type: application/json' \
  -d '{"markdown":"# 中文渲染测试\n\n行内公式 $F=ma$。"}' \
  -o renderer-test.pdf
```

打开生成的 PDF 检查中文和公式。服务没有 GET 健康检查；浏览器打开根地址返回 404，不代表服务损坏。

## 4. 使用方法

1. 先启动渲染服务，并填写 MinerU / 翻译设置。
2. Zotero 中选中文献条目或其原 PDF 附件。
3. 右键 → **PDF to Markdown → 翻译至 PDF**。多个 PDF 时选择原论文，不要选择已有译文。
4. 右下角显示上传、排队、解析、翻译第 1 轮、公式复核、可选的翻译第 2 轮（PDF 复核）、渲染 PDF、完成。
5. 完成后，最终 PDF 附回原条目，原 PDF 保留。结果附件带 `#PDF2MD` 标签，上级条目带 `#PDF2MD-Converted` 标签。

中间 Markdown 不导入文库。成功后尝试清理工作临时目录；失败或清理失败时可能留下临时文件。采用整体完成后导入，因此处理中条目下没有新附件是正常现象。

其他菜单保留：转换为 Markdown、转换为 HTML、导出附件、导出附件到指定位置、显示当前进度。Markdown 配套图片会一并保存 / 导出；HTML 会尝试嵌入图片。

## 5. 设置中每个参数

### 解析设置：MinerU

| 界面参数 / 内部键                      | 含义                                                  | 默认值与推荐                                                                      |
| -------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| API Token / `apiToken`                 | 在线 MinerU 凭据，不是翻译 API Key                    | 默认空；在线模式填自己的 Token，本地模式不使用                                    |
| 模型 / `modelVersion`                  | MinerU 的 `vlm` 或 `pipeline`，不是翻译模型           | 默认 `vlm`；先保留，再比较解析质量，以服务端支持为准                              |
| 语言 / `language`                      | 原 PDF 的识别语言，不是译文语言                       | 默认 `ch`；英文论文建议 `en`，中文用 `ch`                                         |
| 公式识别 / `enableFormula`             | 在线 Token / 轻量解析请求的公式选项                   | 默认开；科技论文保持开启                                                          |
| 表格识别 / `enableTable`               | 在线 Token / 轻量解析请求的表格选项                   | 默认开；一般保持开启                                                              |
| 强制 OCR / `isOcr`                     | 强制 OCR，可能改变已有文字层的识别结果                | 默认关；扫描件或文字层错误再开，不建议所有 PDF 都强制 OCR                         |
| 自动转换新增 PDF 附件 / `autoConvert`  | 新增 PDF 自动进行普通 Markdown 解析，不是自动翻译 PDF | 默认关，避免批量导入时意外调用 API                                                |
| 使用本地 MinerU API / `useLocalApi`    | 改用配置的自建服务，不向 mineru.net 上传              | 默认关；服务部署完成后再开；地址也可指向远程自建主机                              |
| API 地址 / `localApiUrl`               | MinerU 服务根地址                                     | 默认 `http://127.0.0.1:8002`；Router 通常 8002，直连通常 8000；末尾不要包含 `/v1` |
| API Key（可选）/ `localApiKey`         | 自建 MinerU 的鉴权 Key                                | 默认空；服务开启鉴权时填，否则留空                                                |
| 类型 / `localApiType`                  | 直连 V1 API（`api`）或 Router V1（`router`）          | 默认 `router`，与实际部署匹配；不是所有 MinerU HTTP 服务都兼容                    |
| Router 并发 / `localRouterConcurrency` | 本地 Router 解析任务并发，范围 1–8                    | 默认 2；资源紧张用 1，多 worker 再提高；不控制翻译 API 并发                       |
| 测试本地 API                           | 连通性 / 接口测试按钮                                 | 本地部署后使用，不测试在线 MinerU、翻译 API 或 PDF 渲染                           |

当前本地 MinerU 4.0 路径使用 Standard 档位；公式、表格、强制 OCR 和语言等在线选项，不应被当成本地路径的等效控制。

### 翻译与语义校订

| 界面参数 / 内部键                     | 含义                                                             | 默认值与推荐                                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| API 地址 / `semanticApiUrl`           | Chat Completions 基础地址，插件追加 `/chat/completions`          | 默认 `https://api.openai.com/v1`；填供应商地址，一般保留 `/v1`，不要填完整 completions 路径                                 |
| API Key / `semanticApiKey`            | 翻译供应商凭据，与 MinerU Token 无关                             | 默认空；仅在本机设置填写，不提交到 GitHub                                                                                   |
| 模型 / `semanticModel`                | 供应商可用的模型 ID                                              | 默认字符串 `gpt-6.1-sol` 仅在测试供应商验证过，不代表默认 OpenAI 地址支持；必须改为自己的供应商可用 ID                      |
| 目标语言 / `semanticLanguage`         | 分片请求中的目标语言                                             | 默认简体中文；系统提示词也指定中文，其他语言未完整验证，推荐保留默认                                                        |
| 思考强度 / `semanticThinkingEffort`   | `none` / `low` / `medium` / `high`，作为 `reasoning_effort` 发送 | 默认 `medium`；先建立质量基线，再比较 `low` 的费用 / 耗时；复杂数学再试 `high`；供应商必须支持对应值，`none` 不等于省略参数 |
| 渲染服务 / `semanticRenderUrl`        | Markdown 转 PDF 基础地址                                         | 默认 `http://127.0.0.1:8765`；不附加接口路径，使用前确认服务运行                                                            |
| PDF 视觉复核 / `semanticVisualReview` | 额外发送原 PDF 和问题列表进行对照复核                            | 默认关；需供应商支持 Chat Completions 的 PDF 文件输入，当前上传整个 PDF，不是局部截图，费用更高且兼容性需验证               |

起步建议：在线 MinerU Token、英文识别语言 `en`、公式 / 表格识别开启、强制 OCR 与自动转换关闭、思考先 `medium` 再对照 `low`、PDF 视觉复核关闭。以自己的账单和同一论文的质量对照评估成本，不保证跨供应商的价格或速度。

### 附件导出

| 参数 / 内部键                              | 含义                                 | 默认值与推荐                            |
| ------------------------------------------ | ------------------------------------ | --------------------------------------- |
| 默认文件夹 / `exportDir`                   | 导出目标，不改变 Zotero 内部存储位置 | 默认空，每次询问；经常导出时选可写目录  |
| 选择                                       | 导出目录选择按钮                     | 使用文件夹选择器，避免不可写系统目录    |
| 每个条目使用单独子文件夹 / `exportPerItem` | 按上级条目分目录导出                 | 默认关；批量导出 / 同名文件多时建议开启 |

`exportLastType` 是内部记忆项，不是设置面板中的用户参数。凭据存储在本机 Zotero 偏好中；密码框遮挡不代表加密存储，不要公开个人 Zotero profile 或完整日志。

## 6. 当前能力与限制

- 第一轮使用 Markdown 和邻近片段上下文，保护图片、表格和数学占位符。模型可提出 OCR、范数、向量 / 张量粗体修订，但属于推断。
- 专门公式复核只处理模型返回的修订候选，不是全部公式审计；没有候选时不发起复核模型调用。
- 行内公式误落正文的候选检测已接入，但没有完善的独立自动应用闭环，不能保证都修好。
- 可选视觉核对上传整个原 PDF，尚未实现按疑点裁剪页面的低成本路线。
- 图片引用有完整性检查，但复合图拆成子图后会导致页数膨胀、图注跨页，不能复刻原论文布局。
- HTML 表格、长公式、特殊 LaTeX、跨片段符号一致性仍需测试，不能保证数学和排版完全一致。
- API 尚无完善的超时 / 重试 / 断点续传；进度没有逐分片计数。停在第一轮可能是正常串行调用，也可能是网络等待，避免反复提交。
- 没有持久化的逐请求 token、缓存、推理及上传 / 下载统计。`cached_tokens` 已计入输入，`reasoning_tokens` 已计入输出，不要重复相加。
- 模型格式错误时存在回退原片段的情况。**完成不代表质量已验收**，应抽查摘要、末尾、图注、数字及关键公式。

## 7. 故障排查

| 现象                   | 检查方法                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| 设置能打开，没有新 PDF | 先检查渲染服务；仅安装 XPI 不够；也检查任务是否仍在翻译或被重复结果检查跳过 |
| 长时间翻译第 1 轮      | 当前串行分片且没有分片进度，检查供应商请求记录和网络；不要重复提交          |
| 401 / 403              | 区分 MinerU / 翻译服务，检查相应凭据、权限、模型资格                        |
| 400 / 模型或参数错误   | 检查供应商支持的模型 / 思考取值，地址不能重复 completions 路径              |
| 429 / 额度不足         | 检查服务限流、余额及 MinerU 配额                                            |
| 渲染 HTTP 500          | 查看渲染终端，检查依赖、ctex、字体、图片路径和 LaTeX 错误                   |
| 根地址返回 404         | 正常，仅提供 `POST /v1/render-markdown`                                     |
| 端口被占用             | 确认已有服务，或更改端口并同步 Zotero 设置                                  |
| 页数明显膨胀           | 常见于复合图独立排版，当前不恢复原版双栏布局                                |

Issue 只提交脱敏的版本、阶段和最小复现，不提交 Key、Token、个人 profile 或无权公开的论文。上传非公开资料到 MinerU / 翻译服务前，请确认相应权限。

## 8. 开发、fork 与发布

```bash
npm ci
npm run build
npm run lint:check
```

产物：`.scaffold/build/pdf-to-markdown.xpi`。`npm start` / `npm test` 前按 `.env.example` 配置独立 Zotero 开发 profile，避免影响个人文库。`.env` 不提交。

- `src/modules/pdfToMd.ts`：菜单、队列、MinerU、进度、附件导入及导出。
- `src/modules/semanticRepair.ts`：占位符、分片、修订恢复。
- `src/modules/semanticPipeline.ts`：翻译 / 复核 API 及渲染调用。
- `service/render-service.mjs`：本机 Pandoc / XeLaTeX 服务。
- `Start-PDF-Renderer.command` / `.bat`：快捷启动，不安装依赖或配置自动启动。
- `addon/content/preferences.xhtml` / `addon/prefs.js`：设置和默认值，凭据默认空。

构建工具从仓库元数据生成自动更新地址，指向本仓库固定 `release` tag 下的 `update.json`。推送 `v*` tag 会触发 Release 工作流。fork 后自己发布时，修改 `package.json` 的 repository、homepage、bugs 为自己的仓库，并核实构建后的更新地址。

另一台电脑安装不必 fork 或编译：下载 XPI 和完整源码（运行渲染服务）即可。**不需要把翻译 Key / MinerU Token 填到 GitHub Actions Secrets**，构建不调用这些 API。

## 上游与许可证

保留上游 Git 历史和作者归属，基于 [LuckYang1/PDF-to-md](https://github.com/LuckYang1/PDF-to-md)。
感谢上游引用的 [qingpy/zotero-pdf2md](https://github.com/qingpy/zotero-pdf2md)、[understandlxy/mineru-html-parser-zotero](https://github.com/understandlxy/mineru-html-parser-zotero)、[lisontowind/zotero-mineru](https://github.com/lisontowind/zotero-mineru)。

不是其他同名 / 类似名称 PDF 翻译项目的官方分发。许可证：[AGPL-3.0-or-later](LICENSE)。
