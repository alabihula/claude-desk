# Contributing to Claude Desk

感谢你愿意改进 Claude Desk。小而聚焦的 Issue 和 Pull Request 最容易评审与合并。

## 开始之前

1. 搜索现有 Issue，避免重复工作。
2. 较大的交互、架构或兼容性改动，请先创建 Issue 说明目标和边界。
3. 安全漏洞不要公开提交，请按照 [`SECURITY.md`](SECURITY.md) 私密报告。

## 本地开发

需要 Node.js 22、pnpm 10、Rust stable，以及 Tauri 2 对应平台的系统依赖。

```bash
pnpm install --frozen-lockfile
pnpm tauri dev
```

目录职责：

- `src/views` 只负责页面组合和页面级状态承接。
- `src/components` 保持单一展示或交互职责。
- 非平凡的解析、映射和交互逻辑放在 `src/services` 并配套测试。
- 会话、运行与队列编排集中在 `src/stores/workspace.js`。
- 文件、Git、持久化、配置和进程安全边界放在 `src-tauri/src`。

## 提交前检查

```bash
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
git diff --check
```

涉及桌面交互时，请同时验证打包后的 App。涉及 Windows 进程或安装行为时，必须运行 Windows workflow；不能只凭 macOS 编译结果判断。

## Pull Request

- 说明问题、解决方案和未覆盖边界。
- 列出实际执行的验证，而不是只写“已测试”。
- UI 改动请提供必要的截图或短视频，但不要包含令牌、内部代码或个人数据。
- 不要提交 `.env`、诊断导出、构建产物或本机配置。

提交贡献即表示你同意按本项目的 [MIT License](LICENSE) 授权你的贡献。
