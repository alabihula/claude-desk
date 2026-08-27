# Claude Desk

[![Latest release](https://img.shields.io/github/v/release/alabihula/claude-desk?label=release)](https://github.com/alabihula/claude-desk/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Tauri 2](https://img.shields.io/badge/Tauri-2-24C8DB)
![Vue 3](https://img.shields.io/badge/Vue-3-42B883)

一个面向 Claude Code 的原生桌面客户端，在 macOS 和 Windows 上提供项目、对话、工具活动、权限、文件与 Git 变更等产品化交互。

> An unofficial native desktop client for Claude Code, built with Tauri 2 and Vue 3.

> [!IMPORTANT]
> Claude Desk 是社区项目，与 Anthropic 无隶属或背书关系。Claude、Claude Code 和 Anthropic 是其各自权利人的商标。使用本项目需要你自行安装、登录并配置 Claude Code。

## 为什么做 Claude Desk

Claude Code 的结构化运行时能力很强，但日常桌面使用还需要项目管理、连续对话、附件、上下文进度、工具权限、文件预览与变更审查。Claude Desk 将这些能力组织成原生桌面交互，不把终端输出直接暴露为产品界面。

## 主要能力

- **项目与连续对话：** 按项目管理会话，恢复 Claude Code session，并在本地持久化对话状态。
- **结构化执行过程：** 展示思考、工具活动、任务清单、权限请求和 Claude 提问。
- **上下文管理：** 显示上下文占用，支持手动与自动压缩后的进度更新。
- **附件与本地产物：** 支持粘贴图片、添加文件、预览图片/文本/HTML，并安全定位项目内产物。
- **队列、停止与调整：** 运行期间可加入补充消息、停止当前任务或立即调整方向。
- **文件与 Git：** 浏览项目文件、查看本地变更与 Diff，并从 App 打开或定位文件。
- **Skills 与 MCP：** 发现本机可用 Skills，查看 MCP server 状态。
- **桌面体验：** 中英文界面、明暗主题、紧凑显示，以及 macOS/Windows 原生进程行为。

更完整的产品边界与实现背景见 [`CLAUDE_DESK_SPEC.md`](CLAUDE_DESK_SPEC.md) 和 [`CLAUDE_DESK_ROADMAP.md`](CLAUDE_DESK_ROADMAP.md)。

## 使用前提

- 已安装并能够在终端运行 [`claude`](https://code.claude.com/docs/en/overview)。
- 已完成 Claude Code 登录，或配置了兼容的运行时环境。
- macOS 或 Windows。Linux 尚未作为正式交付平台验证。

## 安装

预构建版本见 [Releases](https://github.com/alabihula/claude-desk/releases/latest)。

当前公开构建没有 Apple notarization 或 Windows 商业代码签名：

- macOS 首次启动可能需要在 Finder 中右键 App 并选择“打开”。
- Windows 可能显示 “Unknown publisher”，请在确认安装包来自本仓库 Release 后再决定是否运行。

安装包的支持架构和 SHA-256 会写在对应 Release 说明中。

## 从源码运行

需要 Node.js 22、pnpm 10、Rust stable，以及 [Tauri 2 的系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/alabihula/claude-desk.git
cd claude-desk
pnpm install --frozen-lockfile
pnpm tauri dev
```

构建当前平台安装包：

```bash
pnpm tauri build
```

macOS 还提供独立架构脚本：

```bash
pnpm tauri:build:mac:arm64
pnpm tauri:build:mac:intel
pnpm tauri:build:mac:universal
```

## 验证

```bash
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Windows 安装包由 [Windows x64 workflow](.github/workflows/windows-build.yml) 在 Windows runner 上构建并验证 GUI 子系统、静默安装、启动与单实例行为。

## 项目结构

```text
src/views/                  页面组合与状态承接
src/components/             单一职责的界面组件
src/services/               解析、映射、交互与纯逻辑
src/stores/workspace.js     会话、运行、队列和工作区编排
src-tauri/src/              文件系统、Git、SQLite、配置和进程边界
.github/workflows/          Windows 构建与安装验证
```

## 数据与隐私

Claude Desk 的项目配置、对话数据库、附件副本和有界诊断记录保存在本机。发送给 AI 的内容由你本机配置的 Claude Code 运行时及其模型服务处理。详细边界见 [`PRIVACY.md`](PRIVACY.md)。

## 贡献与安全

欢迎提交 Issue 和 Pull Request。开始前请阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md)。安全问题请按 [`SECURITY.md`](SECURITY.md) 使用 GitHub 私密漏洞报告，不要创建公开 Issue。

## 许可证

项目自身代码采用 [MIT License](LICENSE)。第三方依赖及商标仍遵循各自许可证和权利声明，见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
