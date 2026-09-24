# Image Browser

本地 / 远程图片浏览器，主打直观、流畅的浏览体验。

![version](https://img.shields.io/github/v/release/BUGJI/image_browser?label=version)
![license](https://img.shields.io/badge/license-MIT-green)
![platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)
[![CI](https://github.com/BUGJI/image_browser/actions/workflows/ci.yml/badge.svg)](https://github.com/BUGJI/image_browser/actions/workflows/ci.yml)

> QQ 交流群 [1064353699](https://qm.qq.com/q/bI7nX30tFK)

## 目录

- [下载](#下载)
- [快速上手](#快速上手)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [开发](#开发)
- [已知限制](#已知限制)
- [License](#license)

---

## 下载

前往 **[GitHub Releases](https://github.com/BUGJI/image_browser/releases)** 下载最新版本：

| 平台    | 安装包                                                                       |
| ------- | ---------------------------------------------------------------------------- |
| Windows | `image-browser-<version>-setup.exe`（NSIS 安装包）/ 免安装 `.zip`            |
| Linux   | `.AppImage` / `.deb`                                                         |
| macOS   | `.dmg`（当前未提供预构建包，需在 macOS 上执行 `npm run build:mac` 自行构建） |

---

## 快速上手

1. **添加根目录**：左下角「设置 → 根目录 → 添加」，可手动输入或浏览选择，支持别名与排序；也支持添加 WebDAV 远程根。
2. **浏览图片**：左下角切换根目录，左侧目录树点击文件夹，右侧瀑布流即展示该文件夹及所有子文件夹中的图片；顶栏可切换瀑布流 / 矩形网格。
3. **搜索图片**：右上角输入文件名（支持 `*` / `?` 通配符），回车跨根目录搜索；清空退出搜索。
4. **查看原图**：点击卡片进入灯箱，`←`/`→` 切换，滚轮缩放或翻页，`Esc` 关闭；WebM 视频在灯箱内播放。
5. **复制图片**：灯箱内默认 `Ctrl+C` 复制原文件、`Ctrl+Shift+C` 复制图片（快捷键可自定义）；开启「快速复制」后单击卡片直接复制。
6. **收藏 / 打标签**：点击卡片或灯箱内的星标收藏；灯箱中可为图片添加标签，侧栏提供「我的收藏」与「标签」入口。
7. **缓存维护**：设置 → 根目录 → 性能优化，支持增量加速、整库重建、复用已有缓存、清理过期缓存四种模式。

<img width="600" height="360" alt="主界面" src="https://github.com/user-attachments/assets/1b64fb06-1304-4109-9ead-af36896bbba0" />

---

## 功能特性

### 浏览

- **多根目录管理**：注册多个本地目录或 WebDAV 远程根，支持别名、排序、路径校验、去重与只读标记。
- **目录树浏览**：实时扫描（可中止、带进度），支持文件夹过滤搜索与展开状态持久化。
- **瀑布流 / 矩形网格**：虚拟滚动只渲染可视区域，海量图片流畅滚动；缩放滑块实时调整密度，并记忆上次缩放值。
- **视频浏览**：支持 WebM；可将其按动图处理（首帧海报、悬停/自动播放）或作为普通视频用原生控件播放（进度 / 音量）。
- **缩略图缓存引擎**：每个根目录独立缓存，增量 / 全量 / 复用 / 清理四种模式；扫描与缩略图生成均在 Worker 线程，不阻塞 UI。

### 搜索

- **文件名搜索**：跨根目录按文件名匹配，支持 `*` / `?` 通配符。
- **图内文字搜索（OCR，可选）**：回车时自动合并 OCR 命中，文件名优先、按权重排序，命中卡片带「图内文字」角标。
- **OCR 组件按需管理**：模型随包内置；体积较大的 ONNX Runtime 运行时组件在「设置 → 图内文字搜索 → 运行时组件」中下载或本地导入，可随时删除，不影响基础安装包体积。
- **AI 语义搜索（实验性，默认隐藏）**：接入 OpenAI 兼容接口，用自然语言描述检索图片，需先在设置中建立向量索引；可在「开发者选项 → 显示隐藏功能」开启。

### 组织

- **收藏**：按根目录独立管理，目录树顶部快捷入口，支持功能总开关。
- **标签**：为图片打标签，支持新建、重命名、删除、合并；侧栏提供标签入口，灯箱内可直接编辑。
- **快速复制**：一键开关，单击卡片直接复制（原文件 / 图片两种模式可选）。

### 查看

- **灯箱增强**：滚轮可配置为缩放或切换图片；缩放可拖拽平移、双击复位，缩放上限可调。
- **自定义快捷键**：复制原文件、复制图片均可自由绑定组合键。
- **动图（GIF / WebM）控制**：播放方式（悬停 / 全部 / 不播放）与首帧海报来源可配置。

### 外观与系统

- **卡片外观自定义**：文件名、格式角标、收藏按钮、图内文字角标可独立设为「不显示 / 悬停显示 / 一直显示」。
- **主题外观**：亮色 / 暗色 / 纯黑（AMOLED）三档，暗色下可全黑背景。
- **界面调节**：顶栏样式（自绘 / 系统）、侧栏布局、动画开关、滚动预加载与缩略图尺寸等性能选项。
- **系统托盘常驻**：关闭行为可配置为每次询问 / 最小化到托盘 / 直接退出。
- **通知中心**：进度、成功、警告、错误统一管理，支持中止与操作按钮。
- **多语言**：简体中文 / English 即时切换。
- **更新提醒**：可开启启动时检测更新，有新版本时通知并跳转 GitHub Releases。

---

## 技术栈

Electron 43 · electron-vite 5 · Vue 3 · Vite 7 · Pinia · Element Plus · vue-i18n · node:sqlite · electron-builder 26

详细架构设计见 **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**。

---

## 开发

### 环境要求

- Node.js 22.5+（使用内置 `node:sqlite`，零编译、零原生依赖）
- npm 10+
- （可选）OCR 图内文字搜索依赖 `@repeato/ocr`（已列为可选依赖，`npm install` 会自动安装）。运行时组件（onnxruntime + sharp）在应用内按需下载；开发时 `node_modules` 已含原生依赖，可直接使用。

### 快速开始

```bash
npm install
npm run dev
```

### 常用命令

| 命令                      | 说明                                                              |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run dev`             | 开发模式，热更新                                                  |
| `npm run start`           | 预览已构建产物                                                    |
| `npm run build`           | 仅构建产物到 `out/`                                               |
| `npm run build:win`       | 打包 Windows 安装包（NSIS）                                       |
| `npm run build:win:zip`   | 打包 Windows x64 绿色版（zip）                                    |
| `npm run build:mac`       | 打包 macOS（需在 macOS 上执行）                                   |
| `npm run build:linux`     | 打包 Linux（AppImage / deb）                                      |
| `npm run build:ocr-addon` | 生成 OCR 运行时组件包（win32-x64），作为 GitHub Releases 附件发布 |
| `npm run lint`            | ESLint 检查（CI 会执行）                                          |
| `npm run format:check`    | Prettier 格式检查（CI 会执行）                                    |
| `npm run format`          | Prettier 自动格式化                                               |

> 打包前请替换 `build/icon.png` 及各平台正式图标。

更多模块划分、IPC 与数据层设计见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

## 已知限制

- **格式支持**：JPG / JPEG / PNG / GIF / WebP / BMP / TIFF 可索引浏览，WebM 视频可播放；缩略图解码依赖 JS/WASM 解码器，个别格式（如 BMP / TIFF）可能回退原图显示。
- **更新检测**通过 GitHub Releases 比对版本，提示后跳转下载页；`electron-updater` 的 `publish.url` 为占位符，未启用静默自动更新。
- **AI 语义搜索**为实验性功能，默认隐藏，需在「开发者选项」中开启。

---

## License

MIT
