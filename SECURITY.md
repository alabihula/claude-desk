# Security Policy

## Supported versions

安全修复只保证进入最新发布版本和默认分支。请先确认问题能够在最新版本复现。

## Reporting a vulnerability

请使用 GitHub 的 [Private vulnerability reporting](https://github.com/alabihula/claude-desk/security/advisories/new) 私密报告安全问题，不要创建公开 Issue，也不要在截图中包含真实令牌、恢复码、私有代码或个人数据。

报告中请包含：

- 受影响版本和操作系统；
- 最小复现步骤与实际影响；
- 必要且已经脱敏的日志或截图；
- 你认为相关的代码位置或缓解方式。

维护者会先确认收到报告，再评估复现、影响和修复方式。修复公开前，请避免披露可被直接利用的细节。

## Scope notes

Claude Desk 会启动用户本机配置的 Claude Code，并访问用户主动选择的项目目录。与 Claude Code、模型提供商、MCP server、第三方 Skill 或本机编辑器自身有关的问题，应同时参考对应项目的安全渠道。
