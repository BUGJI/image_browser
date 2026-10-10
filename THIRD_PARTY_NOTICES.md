# 第三方组件说明

本项目以 MIT 许可发布。下列第三方组件随源码 / 安装包分发，各自遵循其原始许可。

## image_compressor.exe

- **用途**：可选的缩略图外部转换器（设置 → 根目录 → 缓存生成方式 → 使用外部转换器建立缓存），仅 Windows 产物随包分发。
- **来源仓库**：<https://github.com/BUGJI/image_compresser_rust>
- **具体版本**：<https://github.com/BUGJI/image_compresser_rust/releases/tag/v1.0.0>（Release 附件 `image_compresser.exe`）
- **许可证**：MIT License
- **文件体积**：2,695,168 字节（PE32+ console x86-64）
- **SHA-256**：`9b2987d17c202a88d12af7c532e466668c56ddc527c2ce9eb6d7dcfa45308655`
- **分发方式**：该二进制**不入库**（避免仓库体积单调增长）；Windows 打包前由 `scripts/fetch-image-compressor.mjs` 从上方 Release 附件下载，并强制校验 SHA-256。也可运行 `npm run fetch:cli-thumb` 手动获取。
- **校验**：下载后可用 `sha256sum image_compressor.exe` 与上方哈希核对，确认与审计过的版本一致。

> OCR 运行时（onnxruntime / sharp）与 `@repeato/ocr` 通过 npm 依赖引入，未入库二进制；其许可随各自包的 `LICENSE` 文件。
