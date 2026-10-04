# 第三方组件说明

本项目以 MIT 许可发布。下列第三方组件随源码 / 安装包分发，各自遵循其原始许可。

## image_compressor.exe

- **用途**：可选的缩略图外部转换器（设置 → 根目录 → 缓存生成方式 → 使用外部转换器建立缓存），仅 Windows 产物随包分发。
- **来源**：<https://github.com/BUGJI/image_compresser_rust>
- **许可证**：MIT License
- **入库体积**：2,695,168 字节（PE32+ console x86-64）
- **SHA-256**：`9b2987d17c202a88d12af7c532e466668c56ddc527c2ce9eb6d7dcfa45308655`
- **说明**：该工具独立构建后以二进制形式纳入本仓库，具体版本以随附二进制为准，可用上方 SHA-256 核对。

> OCR 运行时（onnxruntime / sharp）与 `@repeato/ocr` 通过 npm 依赖引入，未入库二进制；其许可随各自包的 `LICENSE` 文件。
