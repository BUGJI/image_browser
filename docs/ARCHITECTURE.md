# 技术架构

本文档面向开发者，介绍 image-browser 的技术设计与扩展方式。

## 进程架构

Electron 三进程模型：

```
┌─────────────────────────────────────────────┐
│ 主进程 (Main)                                │
│  · SQLite（app 级库 + 每根目录缓存库）        │
│  · 窗口管理 / 托盘 / 关闭行为                 │
│  · IPC 注册 / image:// 协议 / 缓存调度        │
│  · Worker 线程 (cache-worker)                │
│     递归扫描 / 解码 / 缩放 / webp 编码        │
└──────────────────────┬──────────────────────┘
                       │ contextBridge（window.api）
┌──────────────────────┴──────────────────────┐
│ 渲染进程 (Renderer)                          │
│  · 主窗口 index.html（瀑布流 / 目录树）       │
│  · 设置窗口 settings.html（单例）             │
└─────────────────────────────────────────────┘
```

重型任务（递归扫描图片、解码、缩放、WebP 编码）全部放在 `node:worker_threads` 的 Worker 中执行，主进程只做 DB 读写与任务调度，避免 UI 卡死。缩略图生成按批次调度，每批使用独立 Worker，单批崩溃只影响本批并自动继续，另有时限保护（120s 超时跳过该批）。

## 目录结构

```
image_browser/
├── src/
│   ├── main/                     # Electron 主进程
│   │   ├── index.js              # 入口：初始化 DB、注册 IPC、创建窗口、协议注册
│   │   ├── windows.js            # 窗口管理（主窗口 + 设置窗口单例、窗口状态记忆）
│   │   ├── db.js                 # node:sqlite 封装（queryAll/queryOne/run/transaction）
│   │   ├── settings.js           # app 级设置表读写（key-value，SQLite）
│   │   ├── roots.js              # 根目录注册管理（校验 / 别名 / 排序 / 去重）
│   │   ├── fs-scan.mjs           # 目录树扫描（迭代式、进度回调、可中止）
│   │   ├── ai.js                 # AI 语义搜索（向量索引维护 + 搜索）
│   │   ├── ocr.js                # OCR 图内文字搜索（索引维护 + 运行时管理 IPC）
│   │   ├── ocr-worker.mjs        # OCR Worker：@repeato/ocr（PaddleOCR + ONNX）识别
│   │   ├── ocr-addon.js          # OCR 运行时组件（onnxruntime+sharp）下载/导入/删除
│   │   ├── cache.js              # 缓存引擎调度 + image:// 图片协议
│   │   ├── cache-worker.mjs      # 缓存 Worker：扫描 / 解码 / 缩放 / webp 编码
│   │   ├── tray.js               # 系统托盘 + 关闭行为策略（ask/tray/quit）
│   │   ├── logger.js             # 日志模块（主进程 / 渲染进程 / Worker 落盘）
│   │   ├── updater.js            # 更新检测（当前为桩实现）
│   │   └── i18n.mjs              # 主进程极简 i18n（托盘菜单文案）
│   ├── preload/
│   │   └── index.js              # contextBridge 暴露 window.electron / window.api
│   └── renderer/                 # Vue 3 渲染进程（多页面）
│       ├── index.html            # 主窗口入口
│       ├── settings.html         # 设置窗口入口
│       └── src/
│           ├── main.js           # 主窗口启动（Element Plus + Pinia + vue-i18n）
│           ├── App.vue           # 主界面：顶栏 / 侧栏 / 瀑布流 / 悬浮工具栏
│           ├── components/
│           │   ├── TitleBar.vue      # 自绘顶栏（拖拽 + 窗口控制按钮）
│           │   ├── SideBar.vue       # 左侧栏：目录树 + 根目录切换 + 设置入口
│           │   ├── WaterfallGrid.vue # 瀑布流 + 虚拟滚动 + 懒加载
│           │   ├── Lightbox.vue      # 灯箱（原图 / 键盘导航 / 复制）
│           │   ├── NotificationHost.vue  # 通知中心
│           │   └── CloseAskDialog.vue    # 关闭行为询问框
│           ├── stores/            # Pinia：roots / theme / locale / notifications
│           ├── i18n/locales/      # zh-CN / en-US 语言包
│           ├── utils/image-url.js # image:// URL 构建
│           └── settings/          # 设置窗口
│               ├── SettingsApp.vue    # 布局：左侧树 + 右侧内容
│               ├── SidebarTree.vue    # 设置树 + 顶部搜索
│               └── pages/             # General / Roots / Theme / Appearance / DevOptions / About / Test
├── resources/icon.png             # 应用图标
├── scripts/gen_mock_imgs.py       # 生成模拟图片的测试脚本
├── electron.vite.config.mjs       # 多入口构建（index + settings + cache-worker）
├── electron-builder.yml           # 打包配置
└── package.json
```

## 主进程 ↔ 渲染进程通信（IPC）

预加载脚本通过 `contextBridge` 暴露两个全局对象：

- `window.electron` —— @electron-toolkit/preload 提供的 Electron API
- `window.api` —— 项目自定义 API（见 `src/preload/index.js`）

### API 一览

| 分组 | 方法 |
| --- | --- |
| 系统信息 | `getDbVersion()`、`versions` |
| 窗口控制 | `windowMinimize()`、`windowToggleMaximize()`、`windowClose()`、`windowCloseResult()`、`onAskClose()`、`onMaximizedChange()` |
| 设置窗口 | `openSettings()` |
| 设置读写 | `getSetting()`、`setSetting()`、`onSettingsChanged()` |
| 应用 | `appRelaunch()`、`checkUpdate()`、`toggleDevtools()`、`restartDevtools()`、`loggingSet()` |
| 根目录 | `rootsList()`、`rootsAdd()`、`rootsUpdate()`、`rootsRemove()`、`rootsReorder()`、`rootsGetCurrent()`、`rootsSetCurrent()`、`onRootsChanged()`、`onRootsCurrentChanged()` |
| 目录扫描 | `selectDirectory()`、`scanTree()`、`scanAbort()`、`onScanProgress()` |
| 缓存维护 | `cacheRun(rootId, mode)`、`cacheAbort()`、`cacheStatus()`、`onCacheProgress()` |
| 图片浏览 | `imagesList()`、`copyImageDataUrl()`、`copyImagePath()` |
| AI 语义搜索 | `aiIndex(rootId, mode)`、`aiAbort()`、`aiStatus()`、`aiSearch(rootId, query)`、`aiTestConnection()`、`aiTestCaption()`、`aiTestEmbed()`、`onAiProgress()` |
| OCR 图内文字搜索 | `ocrCheck()`、`ocrIndex(rootId, mode)`、`ocrAbort()`、`ocrStatus()`、`ocrSearch(rootId, query)`、`onOcrProgress()` |

**添加新 IPC 的路径**：`src/main/index.js` 用 `ipcMain.handle` 注册 → `src/preload/index.js` 在 `api` 中封装 → 渲染进程 `window.api.xxx()` 调用。跨窗口广播使用 `windows.js` 的 `broadcast(channel, payload)`。

## 数据层：SQLite（node:sqlite）

全部使用 Node 24 内置的 `node:sqlite`（`DatabaseSync`），零依赖、零编译。

- **app 级库**：`<userData>/image-browser.db`（WAL 模式）
  - `settings` 表：应用设置 key-value；
  - `roots` 表：根目录注册（路径唯一、别名、手动排序 `sort_order`）。
- **每根目录缓存库**：`<root>/.image_browser_cache/cache.db`（Windows 下目录设隐藏）
  - `files` 表：图片索引（路径、尺寸、mtime、缩略图路径）；
  - `meta` 表：最近一次维护任务记录。
- 批量写入统一包裹事务，避免大量 fsync 卡住主进程。

## 缓存引擎

每个注册根目录内维护独立缓存目录 `.image_browser_cache/`：

```
<root>/
├── .image_browser_cache/
│   ├── cache.db                 # SQLite：图片索引 + 尺寸
│   └── image_cache/             # WebP 缩略图，镜像源目录结构
│       └── <相对目录>/<文件名>.<原扩展名>.webp
```

### 四种维护模式

| 模式 | 行为 |
| --- | --- |
| `update` | 增量：扫描新增 / 变更 / 删除，为新增与变更图片生成缩略图 |
| `rebuild` | 全量：清空缓存目录与索引，重新扫描 + 全部重新生成 |
| `scan-cache` | 扫描 `image_cache/` 里已生成的缩略图计入索引（复用已有结果，清理孤儿缩略图） |
| `clean` | 移除索引中磁盘上已不存在的记录，删除无引用的缩略图文件 |

### 缩略图生成

- Worker 内解码：`png` 用 pngjs、`jpg/jpeg` 用 jpeg-js、`webp` 用 webp-wasm 解码为 RGBA；`gif/bmp/tiff` 暂无解码器，索引收录但无缩略图。
- 双线性缩放至配置宽度（默认 512px，可调），再以配置质量（默认 80）编码为 WebP。
- 失败自动跳过并计数（`failed`），不中断整体任务。

### 配置项（开发者选项可调）

| 设置 key | 默认值 | 说明 |
| --- | --- | --- |
| `cacheThumbWidth` | 512 | 缩略图宽度 |
| `cacheThumbQuality` | 80 | WebP 质量（1-100） |
| `cacheScanBatch` | 100 | 扫描分批大小 |
| `cacheThumbBatch` | 100 | 缩略图每批任务数 |

## 自定义协议 image://

`image://<rootId>/<encodedAbsPath>?size=orig|auto|thumb`

- 在 `app ready` 之前通过 `protocol.registerSchemesAsPrivileged` 注册（`secure` + `supportFetchAPI` + `stream`），不支持 `standard`（会把数字 host 按 IPv4 规范化）。
- `auto`（默认）：有 WebP 缩略图返回缩略图，否则回退原图；
- `thumb`：已知有缩略图时使用（URL 与 `auto` 区分，避免复用缓存建立前的原图响应）；
- `orig`：始终返回原图（灯箱用）。
- 返回体为 fs 流，带正确 MIME 与 `Cache-Control`；原图 / 缩略图未就绪的回退响应不加缓存。
- 渲染端 canvas 读取像素（复制等）需要跨域许可，响应带 `Access-Control-Allow-Origin: *` 与 `Cross-Origin-Resource-Policy`。

## OCR 图内文字搜索

用 PaddleOCR 识别图片内的文字并建立索引，搜索框回车时与文件名**合并检索**（无需主界面开关）。

- **搜索（合并）**：`handleImagesList` 在 `searchQuery` 非空时，除文件名匹配外，若设置 `ocrEnabled=true` 且该根目录有 `ocr_text` 索引，则把 `ocr_text.text` 命中一并合并。按 `abs_path` 去重，权重排序：文件名完全 100 > 前缀 80 > 子串 60 > 图内文字 40（`match:'text'` 的卡片显示「图内文字」角标）。
- **索引**：`ocr.js` 维护扫 `cache.db` 的 `files`，对每张图 OCR 识别文字存入 `ocr_text` 表（`abs_path` 唯一 + `text` + `src_mtime`），按 mtime 增量；`update / rebuild / clean` 三模式。
- **Worker**：推理在 `ocr-worker.mjs` 执行；模型在 worker 内懒加载并整批复用，结束发 `release`（`Ocr.releaseAll()`）再 terminate。
- **组件分层（体积控制）**：
  - 模型与 `@repeato/ocr` JS **随包内置**（asarUnpack `node_modules/@repeato/**`）；
  - `onnxruntime-node` + `sharp` 体积巨大，**不打进安装包**（`electron-builder.yml` 的 `files` 排除），改由 `ocr-addon.js` 在「设置 → 图内文字搜索 → 运行时组件」按需**下载 / 本地导入 / 删除**，解压到 `userData/ocr-addon/node_modules`；
  - worker 启动时通过 `env.NODE_PATH` 指向该目录解析原生依赖；开发环境下 `node_modules` 直接可用则无需 addon。
  - 组件包由 `scripts/build-ocr-addon.mjs`（`npm run build:ocr-addon`）生成，作为 GitHub Releases 附件发布，tag 与 `ocr-addon.js` 的 `ADDON_TAG` 对应。

## 多语言与主题

- **i18n**：渲染进程使用 vue-i18n（`zh-CN` / `en-US`），语言持久化到 `settings.language`，主窗口 / 设置窗口实时联动，Element Plus 组件文案随语言切换；主进程托盘菜单文案由 `i18n.mjs` 极简实现。
- **主题**：亮色 / 暗色通过 `html.dark` 类 + CSS 变量实现，持久化当前模式；`themeStartup` 控制启动时采用「暗色 / 亮色 / 上次状态」。
- **顶栏**：`titlebar` 设置项决定无边框自绘顶栏或系统顶栏（窗口级，切换需重启）。

## 托盘与窗口生命周期

- 托盘常驻：窗口全部关闭不退出，`window-all-closed` 仅在正在退出或关闭行为为「直接退出」时调用 `app.quit()`。
- 关闭行为（`closeAction`）：`ask`（弹询问框，可勾选记住）/ `tray`（隐藏到托盘）/ `quit`（直接退出）。
- 主窗口 close 拦截在 `attachWindowCloseBehavior` 中实现，询问框结果经 `window:ask-close-result` 回传。

## 扩展指南

- **新增设置页**：在 `SettingsApp.vue` 的 `treeData` 加节点，并在 `pageMap` 映射页面组件。
- **新增 IPC**：主进程 `ipcMain.handle` → preload 封装 → 渲染进程调用（见上文）。
- **支持更多图片格式缩略图**：在 `cache-worker.mjs` 的 `decodeImage` 中增加解码分支，并补充 `IMAGE_EXTS`。
- **接入真实更新**：替换 `updater.js` 的桩实现，并配置 `electron-builder.yml` 的 `publish`。
- **新增语言**：在 `i18n/locales/` 增加语言包，更新 `LOCALES`、主进程 `i18n.mjs` 的 `MESSAGES`。
