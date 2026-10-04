# 待处理问题清单

> 本文件记录**代码 / 工程层面**的待优化项，供维护者逐条自行处理。
> 基线：`dev` @ `1e24a26b`（`package.json` 版本 1.1.4）｜整理时间：2026-10-04
> 文档层问题（README 的发布产物说明与版本徽章、package.json 的 repository 元数据）已在同批提交中一并修复，不在此列。

## 优先级速览

| #   | 级别 | 位置                                   | 一句话                                             |
| --- | ---- | -------------------------------------- | -------------------------------------------------- |
| 1   | P0   | `src/main/updater.js:76`               | 更新检测会把 OCR 运行时包误判成新版本              |
| 2   | P1   | 全仓库 / `.github/workflows/ci.yml`    | 零测试，CI 也不跑测试                              |
| 3   | P1   | 仓库根 `image_compresser.exe`          | 第三方二进制入库且无来源/许可说明，文件名拼写有误  |
| 4   | P1   | `electron-builder.yml:1,59`            | `openclaw` 品牌残留（改 appId 有升级路径风险）     |
| 5   | P1   | `build/icon.png`                       | 图标仅 256×256，不足以生成 macOS `.icns`           |
| 6   | P1   | `.github/workflows/`、无 CHANGELOG     | 发布全手工，release 说明手写，无变更日志           |
| 7   | P2   | `src/main/cache.js`（2047 行）         | 单文件职责过载，建议按职责拆包                     |
| 8   | P2   | 四个 Vue 组件                          | `Lightbox` / `WaterfallGrid` / `SideBar` / `App`   |
| 9   | P2   | `src/main/storage/path-utils.js:64`    | `isInsideRoot` 不解析符号链接                      |
| 10  | P2   | `src/main/ocr-addon.js:53,122,150`     | OCR 运行时包下载后无完整性校验                     |

---

## 1. 更新检测会把 OCR 运行时包误判为新版本

**级别**：P0（真实 bug，未暴露但触发条件即将到来）
**位置**：`src/main/updater.js:76`（`parseVersion`）、`src/main/updater.js:6`（`LATEST_RELEASE_URL`）

### 现象

`parseVersion` 的正则没有锚定开头：

```js
const match = tag.match(/(\d+(?:\.\d+){0,2})/)   // 缺 ^ 与 $，且不要求 v 前缀
```

对 `ocr-runtime-v1.22.0-rev_sharp-0.34.5` 这类 tag，它会抓取其中**第一段数字串**得到 `1.22.0`，紧接着 `compareVersions('1.22.0', '1.1.4') > 0` → 判定「有新版本」。

### 触发条件（这是最需要注意的部分）

`LATEST_RELEASE_URL` 用的是 GitHub 的 `/releases/latest` 端点，它返回的是**创建时间最新**的非 draft / 非 prerelease release，**而不是版本号最大的**。

而本仓库用于分发 OCR 运行时组件的那个 release 是普通 release，且 tag 由 `src/main/ocr-addon.js:26` **自动生成**：

```js
const ADDON_TAG = `ocr-runtime-v${ORT_VERSION}_sharp-${SHARP_VERSION}`
```

也就是说——**只要 onnxruntime 或 sharp 升一次版、重新发布该附件，它就会成为 `/releases/latest` 的返回值**。届时所有已安装用户都会被告知「有新版 1.22.0」，点「下载」跳到 OCR 组件的 release 页面。这不需要任何一方犯错，是常规维护动作就会踩到的坑。

### 为什么现在没暴露

现有的 `ocr-runtime-v1.22.0-rev_sharp-0.34.5` 创建于 2026-09-06，早于 v1.0.14 / v1.1.0 / v1.1.4，所以 latest 目前仍是 v1.1.4。

### 证据

把源码里这两个函数原样跑一遍：

```
tag=v1.1.4                                parseVersion=1.1.4    compare→0   正常
tag=ocr-runtime-v1.22.0-rev_sharp-0.34.5  parseVersion=1.22.0   compare→1   ❌ 误报有新版本
tag=ocr-runtime-v2.0.0-rev_sharp-1.0.0    parseVersion=2.0.0    compare→1   ❌ 误报有新版本
```

同一处正则的次要问题：`1.1.4-beta.1` 会被解析成 `1.1.4`，预发布号被吞掉。

### 建议修法（推荐 1 + 3 一起做）

1. **锚定并强制 `v` 前缀**，解析不出来直接放弃：

   ```js
   const m = /^\s*v(\d+(?:\.\d+){0,2})\s*$/.exec(String(tag))
   if (!m) return null
   ```

2. **改拉列表再筛选**，彻底不依赖 latest 的语义：

   ```js
   const res = await fetch(
     `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=30`
   )
   const release = (await res.json()).find(
     (r) => !r.draft && !r.prerelease && /^v\d+\.\d+\.\d+$/.test(r.tag_name)
   )
   ```

3. **把 OCR 运行时组件那个 release 在 GitHub 上勾选 Pre-release**（双保险，也顺带让它不出现在 Releases 列表首屏）。
   注意：`ocr-addon.js` 的下载 URL 是拼死的 tag，打 pre-release 标记**不影响**下载。

### 验收

`checkForUpdates()` 对 `ocr-runtime-*` 系列的 tag 一律返回 `hasUpdate: false`。

---

## 2. 零测试

**级别**：P1
**位置**：全仓库 ｜ `.github/workflows/ci.yml`

### 现状

20000 行源码、120 个文件，`*.test.*` / `*.spec.*` / `__tests__` 数量为 **0**；`package.json` 无 `test` 脚本、无测试框架依赖；CI 只跑 `lint` + `format:check` + `build`。

### 为什么值得补

第 1 条就是纯函数逻辑——一个三行的单测就能永久拦住它。

### 成本低、收益高的切入点（都是纯函数，不依赖 Electron 运行时）

| 目标                    | 值得覆盖的点                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `src/main/storage/path-utils.js` | `isInsideRoot` / `relFromRoot` / `joinPath`：`..` 越界、Windows 跨盘符、远程伪路径        |
| `src/main/updater.js`            | `parseVersion` / `compareVersions`：非常规 tag、预发布号、位数不等                        |
| `src/main/cache.js`              | `wildcardToRegex` / `likeEscape` / `nameMatchScore` / `mergeSearchResults`（搜索排序）    |
| i18n                             | 断言 `zh-CN` 与 `en-US` 键集合相等（目前靠人工比对）                                      |

### 建议

加 `vitest` 为 devDependency + `npm run test`；`parseVersion` / `compareVersions` 顺手 `export` 出来以便测试；CI 在 `lint` 之后加一步 `npm run test`。

---

## 3. `image_compresser.exe` 入库与命名

**级别**：P1
**位置**：仓库根 `image_compresser.exe`（2,695,168 B，PE32+ console x86-64）
**关联**：`electron-builder.yml:40-42`（win.extraResources）、`src/main/cache.js:418,419,422,430,1320`

### 问题

1. 2.7 MB 第三方二进制直接入库，并随 Windows 安装包一起分发；
2. 全仓库（README / `docs/` / 关于页）**没有任何来源、版本、许可说明**——MIT 项目分发第三方可执行文件，建议至少注明出处与许可；
3. 文件名拼写错误：`compresser` → `compressor`。

### 改名时要同步的位置

- `src/main/cache.js`：`:418`、`:419`、`:422`（三处候选路径）
- `electron-builder.yml`：`win.extraResources` 的 `from` / `to`
- `src/renderer/src/i18n/locales/zh-CN.js`、`en-US.js`：设置项文案与 placeholder
- `src/renderer/src/settings/pages/PerformancePage.vue:235`（输入框 placeholder）

### 可选

若该 exe 更新频率与体积可控，也可考虑改为 Release 附件按需下载（与 OCR 组件同一思路），避免仓库体积随二进制增长。

---

## 4. `openclaw` 品牌残留

**级别**：P1（但**改动有风险，需先评估**）
**位置**：`electron-builder.yml:1`（`appId: com.openclaw.image-browser`）、`electron-builder.yml:59`（`linux.maintainer: openclaw`）

### 说明

`openclaw` 不是本项目的标识，疑为早期模板继承。

### ⚠️ 升级路径警告

v1.1.4 已经**用这个 appId 发布过**。在 Windows 上 appId 参与安装标识（NSIS 的 GUID 派生），**直接修改会让已安装用户被系统识别成另一个应用**——旧版本残留、升级不覆盖、出现两份安装。

若要改，建议：

- 方案 A（稳）：appId 保持不动，仅改 `linux.maintainer`（只影响 deb 元数据，无副作用）；
- 方案 B：在下一个大版本改 appId，并显式固定 NSIS 的 `guid`、配套迁移说明。

---

## 5. 图标仅 256×256

**级别**：P1
**位置**：`build/icon.png`、`resources/icon.png`（同一份内容，2503 B，256×256，由 `build/gen_icon.py` 程序化生成）

### 问题

README 中已注明「打包前请替换 `build/icon.png` 及各平台正式图标」，实际影响最大的是 **macOS 打包**：electron-builder 生成 `.icns` 需要最大 1024×1024（512@2x）的源图，256×256 会产出模糊图标甚至打包告警。Windows / Linux 的 256 勉强可用，但也偏小。

### 建议

提供 ≥1024×1024 的正式图标，`build/icon.png`（打包用）与 `resources/icon.png`（运行时窗口/托盘图标）一并替换。

---

## 6. 发布流程手工、无变更日志

**级别**：P1
**位置**：`.github/workflows/`（目前只有 `ci.yml`）

### 现状

- 仓库无 `CHANGELOG.md`；11 个 release 的说明是手写短句（如「v1.1.4 安全加固与性能优化」）；
- 没有发布 workflow：安装包需要在本地跑 `npm run build:win` 再手工上传；
- macOS / Linux 产物至今没有，README 已按实际情况改为「需自行构建」。

### 建议

1. 加 `CHANGELOG.md`（Keep a Changelog 格式，以 `## [x.y.z]` 分节）；
2. 加 `.github/workflows/release.yml`：`on: push: tags: ['v*']` → `windows-latest` 出 `setup.exe` + zip，`ubuntu-latest` 出 AppImage / deb，用 `electron-builder --publish always` 或 `softprops/action-gh-release` 挂资产；
3. release body 从 CHANGELOG 对应小节抽取（有了自动化，第 1 点的投入才有回报）。

`electron-builder.yml:64-67` 已经配好 `publish.provider / owner / repo`，接 CI 发布时可直接复用。

---

## 7. `cache.js` 职责过载（2047 行）

**级别**：P2
**位置**：`src/main/cache.js`

### 现状

单文件同时承担：

| 职责               | 行段        |
| ------------------ | ----------- |
| 缓存配置           | `:92`       |
| 根缓存句柄         | `:142`      |
| 缩略图索引         | `:236-308`  |
| shas worker        | `:316`      |
| 缓存 worker 池     | `:354`      |
| 外部 exe 缩略图    | `:434-576`  |
| 图片尺寸探测       | `:580-678`  |
| 缩略图队列         | `:679`      |
| 搜索与排序         | `:706-802`、`:928-981` |
| WebP 尺寸          | `:803`      |
| 全量扫描           | `:982`      |
| 四种维护模式任务   | `:1117-1661` |
| 统计               | `:1662`     |
| IPC 注册           | `:1714`     |
| `image://` 协议    | `:1925`     |

### 建议

按职责拆包（纯搬移，导出面基本不变，风险低）：

- `cache/config.js` — `getCacheConfig` 与路径解析
- `cache/thumb-index.js` — `resolveThumb` / `primeThumbIndex` / `invalidateThumbIndex`
- `cache/workers.js` — `spawnCacheWorker` / `runShasWorker` / 并发控制
- `cache/cli-thumb.js` — `resolveCliExe` / `runCliThumbStage` / 尺寸探测
- `cache/search.js` — `likeEscape` / `ocrTextMatches` / `nameMatchScore` / `mergeSearchResults` / `wildcardToRegex` / `buildNameMatcher`
- `cache/tasks.js` — `runCacheTask` 与四种模式
- `cache/protocol.js` — `registerImageProtocol`

建议先补上第 2 条里的搜索排序测试再拆，安全网更足。

---

## 8. 四个超大 Vue 组件

**级别**：P2

| 文件                                        | 行数 |
| ------------------------------------------- | ---- |
| `src/renderer/src/components/Lightbox.vue`  | 893  |
| `src/renderer/src/components/WaterfallGrid.vue` | 856 |
| `src/renderer/src/components/SideBar.vue`   | 684  |
| `src/renderer/src/App.vue`                  | 596  |

### 建议

- `Lightbox.vue`：缩放 / 平移 / 键盘 / 滑动逻辑抽成 composable（项目已有 `utils/use-waterfall-layout.js`、`use-image-loader.js` 这类先例，风格一致）；
- `WaterfallGrid.vue`：布局计算进一步下沉到 composable；
- `App.vue`：搜索、通知、快捷键的编排抽成 composable。

（`i18n/locales/zh-CN.js` 651 行、`en-US.js` 686 行属数据文件，不算问题。）

---

## 9. `isInsideRoot` 不解析符号链接

**级别**：P2（加固项）
**位置**：`src/main/storage/path-utils.js:64`

### 现状

只做字符串层面的 `relative()` 判定，能挡住 `..` 与 Windows 跨盘符，**但不解析 symlink**。若某个已注册根目录内部存在指向外部的符号链接，`image://` 请求仍可读到根目录之外的文件。

### 影响

本机自用场景下风险有限（需要渲染层被注入 + 根目录内恰好有越界 symlink 两个条件同时成立），属加固项。

### 建议

在 `image://` 处理路径上补一层 `fs.realpath`：解析结果再调一次 `isInsideRoot`；对结果做缓存，避免每张图都 realpath。

### 验收

在根目录内建一个指向 `/etc` 的符号链接，`image://` 请求应返回 403。

---

## 10. OCR 运行时包下载无完整性校验

**级别**：P2
**位置**：`src/main/ocr-addon.js:53`（URL 拼接）、`:122`（写文件）、`:150`（`extract-zip` 解压到 staging）

### 现状

从本仓库 Release 下载 zip 后直接解压，**无校验和、无签名校验**。HTTPS 已提供传输层保护，`extract-zip` 自身也会阻止 zip-slip 路径穿越，因此现实风险不高。

但这是应用里**唯一**一条「从网络引入可执行代码（onnxruntime + sharp 原生模块）」的路径，补一道校验的成本很低。

### 建议

发布 `ocr-runtime-*.zip` 时同时产出 `.sha256`；客户端下载后先校验再解压，校验失败则删除 staging 目录并报错。

---

## 附：已确认无需处理的部分

以下几处一开始看着可疑，核实后确认是**正常设计**，列出来避免重复排查：

- **Electron 安全基线到位**：两个窗口均为 `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true`（`src/main/windows.js:127-131`、`:192-196`），渲染层有 CSP（`src/renderer/index.html:8`、`settings.html:8`）。
- **`image://` 有越界防护**，不是裸读盘（`src/main/cache.js:1936` 调 `isInsideRoot`）。
- **凭据未明文落库**：走 `safeStorage` 加密；Linux 无 keyring 时降级为 base64 并加 `plain:` 前缀标注（`src/main/secrets.js`）。
- **i18n 中英完全对齐**：499 个键零缺失（本次脚本比对）。
- **`console.*` 直接调用是合理的**：共 29 处，`src/main/logger.js` 专门 hook 了 console 并按天落盘，无需改成 logger 调用。
- **打包体积控制到位**：`electron-builder.yml` 已排除 onnxruntime / sharp / `@img` / source map / docs 等。

---

## 本文档维护约定

- 修完一条后，把该条从「优先级速览」表里删掉，并在下方保留已修复记录（或直接删除段落）；
- 新增问题时沿用同一格式：级别 / 位置（`路径:行号`）/ 现象 / 证据 / 建议修法 / 验收标准；
- 全部处理完后可直接删除本文件。
