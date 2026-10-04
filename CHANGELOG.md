# Changelog

本项目所有值得注意的变更记录于此文件。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [1.1.5] - 2026-10-04

### Added

- `THIRD_PARTY_NOTICES.md`：说明随包分发的第三方二进制（外部转换器）的来源与许可。

### Changed

- 外部转换器文件名拼写修正：`image_compresser.exe` → `image_compressor.exe`。
- Linux 包维护者信息由模板残留 `openclaw` 改为 `BUGJI`。
- 应用标识 `appId` 由 `com.openclaw.image-browser` 迁移为 `com.bugji.image-browser`，并同步 `AppUserModelId`；NSIS 安装标识 GUID 显式固定为旧 appId 派生值，保证已安装用户正常升级、不出现重复安装。

### Fixed

- 更新检测：不再把 `ocr-runtime-*` 运行时组件 release 误判为新版本。
- `image://` 协议：解析符号链接，阻止根目录内 symlink 指向外部文件被读取。

## [1.1.4] - 2026-09-24

### Added

- `engines` 字段，明确 Node.js 22.5+ 与 npm 10+ 要求。

### Changed

- 安全加固：收紧主进程与渲染层权限。
- 性能优化：扫描与缩略图生成更流畅。
- 设置信息架构调整，缓存概况与一键更新更易用。

## [1.1.0] - 2026-09-23

### Added

- WebM 视频支持（可按动图处理或作为普通视频用原生控件播放）。

### Changed

- 性能优化与代码结构重构。

### Fixed

- 修复层级显示错误。

## [1.0.14] - 2026-09-23

### Changed

- 体验优化。

## [1.0.11] - 2026-09-11

### Added

- 图内文字搜索（OCR）落地，运行时组件支持在线下载 / 离线导入。
- OCR 缓存：构建缓存后可跨图搜字。
- 卡片「图内文字」角标显示匹配来源。

### Fixed

- 修复若干已知问题。

## [1.0.8] - 2026-09-06

### Added

- 收藏夹功能，瀑布流可直接操作收藏。
- 标签功能，单张图片可打多个标签。
- AI 搜索功能入口（实验性，默认隐藏）。

## [1.0.6] - 2026-09-04

### Added

- 外部转换器（`image_compressor.exe`）一次生成整个根的缩略图。

### Changed

- 首页浏览速度提升，缓存转换提速，新增多项可优化设置。

## [1.0.4] - 2026-09-04

### Added

- 收藏夹功能（设置 → 根目录启用）。
- 关于卡片样式设置：格式角标 / 文件名 / 收藏按钮可独立显示。
- 快速复制。

### Fixed

- 修复更新功能。

## [1.0.3] - 2026-09-03

### Added

- 灯箱缩放与拖拽。
- 快捷键系统。
- 复制模式可在「文件 / 图片」间切换；支持快速复制。

## [1.0.2] - 2026-09-03

### Added

- GIF 处理支持，可选择动图变静图以降低性能占用。
- 软件 logo。
- 纯黑模式（AMOLED）。

## [1.0.0] - 2026-08-12

### Added

- 首个版本，仅 Windows x64 安装包。
- 本地图片浏览、瀑布流、目录树等基础功能。

[1.1.5]: https://github.com/BUGJI/image_browser/compare/v1.1.4...v1.1.5
[1.1.4]: https://github.com/BUGJI/image_browser/compare/v1.1.0...v1.1.4
[1.1.0]: https://github.com/BUGJI/image_browser/compare/v1.0.14...v1.1.0
[1.0.14]: https://github.com/BUGJI/image_browser/compare/v1.0.11...v1.0.14
[1.0.11]: https://github.com/BUGJI/image_browser/compare/v1.0.8...v1.0.11
[1.0.8]: https://github.com/BUGJI/image_browser/compare/v1.0.6...v1.0.8
[1.0.6]: https://github.com/BUGJI/image_browser/compare/v1.0.4...v1.0.6
[1.0.4]: https://github.com/BUGJI/image_browser/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/BUGJI/image_browser/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/BUGJI/image_browser/compare/v1.0.0...v1.0.2
[1.0.0]: https://github.com/BUGJI/image_browser/releases/tag/v1.0.0
