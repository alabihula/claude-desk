# Claude Desk — MVP 实现说明

> 一个面向 Claude Code 的轻量本地桌面客户端。
> 产品形态参考 Codex App，但不做完整 IDE，也不做多 Agent 平台。
> 核心目标只有一个：让 Claude Code 在桌面端拥有顺手、直观、可贴图、可传文件、可持续会话的使用体验。

---

# 1. 产品定位

项目名称暂定：

```text
Claude Desk
```

一句话定位：

> A lightweight desktop client for Claude Code.

这个项目不是：

```text
❌ AI Control Center
❌ 多 Agent 编排平台
❌ IDE
❌ Cursor 替代品
❌ VSCode 替代品
❌ Agent Marketplace
```

它就是一个非常聚焦的 Claude Code GUI。

底层仍然使用本机已经配置好的 Claude Code CLI。

例如当前机器可以直接运行：

```bash
claude
```

那么 Claude Desk 只负责：

```text
项目管理
+
会话管理
+
Claude Code CLI
+
聊天式 UI
+
图片/文件附件
+
执行状态
+
代码改动查看
```

---

# 2. MVP 核心目标

第一版只需要做到以下完整体验：

```text
打开 Claude Desk
↓
左边看到本地项目
↓
进入某个项目
↓
创建新会话
↓
右边出现 Claude 对话窗口
↓
输入问题
↓
Claude Code 在该项目目录运行
↓
Claude 可以读取/修改代码
↓
用户可以 Cmd+V 粘贴截图
↓
用户可以拖入图片、文件
↓
Claude 根据附件继续工作
↓
界面显示 Claude 执行过程
↓
修改代码后显示 Changed Files
↓
可以查看简单 Diff
↓
关闭 App
↓
重新打开仍然能看到项目和历史会话
```

只要这一套跑通，MVP 就成功。

---

# 3. 技术栈

优先：

```text
Tauri 2
Vue 3
Vite
JavaScript
Pinia
Vue Router
SQLite
xterm.js（必要时用于底层 terminal / debug console）
portable-pty
pnpm
```

要求：

```text
不使用 TypeScript
macOS 优先
工程保持简单
不要过度抽象
不要引入大型 UI 框架
```

可以使用：

```text
lucide-vue-next
marked / markdown-it
shiki
diff
```

用于：

```text
图标
Markdown
代码高亮
Diff
```

---

# 4. 整体界面

整体结构参考 Codex App / ChatGPT Desktop / Linear 的克制风格。

核心布局：

```text
┌──────────────────┬───────────────────────────────────────────┐
│                  │                                           │
│   Claude Desk    │   project-name                            │
│                  │                                           │
│  Projects        │   Conversation                            │
│                  │                                           │
│  ● user-center   │   You                                     │
│    badminton     │   ┌───────────────────────────────────┐   │
│    oneid-sdk     │   │ 帮我看看这个页面为什么错位       │   │
│                  │   │ [ screenshot.png ]                │   │
│  ─────────────   │   └───────────────────────────────────┘   │
│                  │                                           │
│  Conversations   │   Claude                                  │
│                  │   我先检查相关组件和样式……               │
│  登录问题        │                                           │
│  UI还原          │   ✓ Read Login.vue                        │
│  token刷新       │   ✓ Read login.scss                       │
│                  │   ✓ Edited Login.vue                      │
│                  │                                           │
│                  │   Changed files 2                         │
│                  │                                           │
│                  ├───────────────────────────────────────────┤
│                  │ [＋]  Ask Claude...                 [↑]   │
│                  │                                           │
└──────────────────┴───────────────────────────────────────────┘
```

整个 App 不需要传统菜单式后台布局。

重点是：

```text
左边：项目 + 会话
右边：Claude
```

---

# 5. 左侧 Sidebar

宽度建议：

```text
240px ~ 280px
```

包括三个区域。

## 5.1 App Header

显示：

```text
Claude Desk
```

可以带一个小型自定义 Claude 风格 Logo。

不要直接复制 Anthropic 官方 Logo。

建议设计：

```text
抽象的 C
+
星芒 / 思考光点
+
暖橙色 accent
```

---

## 5.2 Projects

示例：

```text
Projects

● user-center
  badminton
  oneid-sdk

+ Add Project
```

功能：

```text
添加本地文件夹
切换项目
移除项目记录
Reveal in Finder
Open in VSCode
```

注意：

```text
Remove Project
```

只删除 Claude Desk 中的记录。

不能删除真实工程。

---

## 5.3 Conversations

当前 Project 下显示：

```text
Conversations

+ New chat

登录问题
UI还原
Token刷新
新会员页面
```

支持：

```text
新建
重命名
删除
切换
```

排序：

```text
最近使用优先
```

---

# 6. Project

Project 数据：

```js
{
  id: '',
  name: '',
  path: '',
  createdAt: '',
  updatedAt: '',
  lastOpenedAt: ''
}
```

添加项目：

```text
Add Project
↓
Tauri native folder picker
↓
选择目录
↓
保存
↓
自动创建第一个 Conversation
```

---

# 7. Conversation

Conversation 是 MVP 最主要的数据对象。

数据：

```js
{
  id: '',
  projectId: '',
  title: '',
  claudeSessionId: '',
  createdAt: '',
  updatedAt: '',
  lastOpenedAt: ''
}
```

注意：

如果 Claude Code CLI 支持恢复 Session：

```text
claude --resume ...
```

优先保存 Claude 自己的 Session ID。

这样 Conversation 与 Claude Code 原生上下文保持一致。

如果 CLI 集成方式无法稳定取得 Session ID，则第一版可以由 App 自己保存消息历史，并为每个 Conversation 保持独立 PTY。

优先级：

```text
Claude 原生 Session
>
App 模拟 Session
```

---

# 8. 右侧 Conversation View

右侧分为：

```text
Header
Message List
Activity
Changed Files
Composer
```

---

# 9. Header

顶部：

```text
user-center / 登录问题
```

右侧可以有：

```text
New Chat
...
```

菜单：

```text
Rename
Clear
Open Terminal
Reveal Project
```

保持简单。

---

# 10. Message UI

用户消息：

```text
You

帮我看看这个样式为什么有问题

[ screenshot.png ]
```

Claude：

```text
Claude

我先检查登录页以及对应样式文件。
```

消息支持：

```text
Markdown
代码块
表格
列表
文件路径
```

代码块：

```text
支持 syntax highlight
支持 Copy
```

文件路径如果可以识别：

```text
src/views/Login.vue
```

应支持点击。

点击后第一版可以：

```text
Open in VSCode
```

暂时不用内置编辑器。

---

# 11. Claude Activity

这是区别普通 Chat UI 的重要部分。

Claude Code 在运行期间，把工具执行过程以轻量 Activity 展示。

例如：

```text
● Working

✓ Read src/views/Login.vue
✓ Search "submitLogin"
✓ Read src/styles/login.scss
✓ Edit src/views/Login.vue
✓ Run pnpm lint
```

不要展示大量原始 JSON。

不要展示复杂 Debug 数据。

只需要用户能看懂：

```text
Claude 正在干什么
```

状态：

```text
queued
running
success
error
```

---

# 12. Claude Code 集成方式

## 原则

Claude Desk 不重新实现 Claude Agent。

它只包装：

```text
Claude Code CLI
```

后端结构建议：

```text
Claude Desk UI
↓
Claude Service
↓
PTY / Process
↓
Claude Code CLI
```

---

# 13. Claude Service

前端接口建议：

```js
claudeService.startConversation()

claudeService.sendMessage()

claudeService.stop()

claudeService.resume()

claudeService.restart()

claudeService.dispose()
```

事件：

```js
onText()
onActivity()
onTool()
onFileChange()
onError()
onExit()
```

不要让 Vue Component 直接管理 PTY。

---

# 14. CLI Adapter

需要一层简单适配：

```text
src/services/claude/
```

例如：

```text
claude.js
parser.js
session.js
attachments.js
```

目的：

未来 CLI 参数变化时，只改这一层。

不要为了“未来支持 Codex”现在就写通用 Provider 系统。

这个 App 第一版就是 Claude。

---

# 15. Claude CLI 启动

默认：

```bash
claude
```

cwd：

```text
当前 Project.path
```

Settings 中允许修改：

```text
Claude command
Claude args
Environment variables
```

因为用户可能使用：

```text
Claude Code 官方
火山 Ark
代理
自定义 base url
自定义启动脚本
```

例如：

```js
{
  command: 'claude',
  args: [],
  env: {}
}
```

---

# 16. Structured Output

如果当前 Claude Code CLI 有稳定的 stream-json / JSON 输出能力，优先采用结构化输出。

目的：

区分：

```text
Claude 文本
Tool Call
Tool Result
Error
Session Info
```

如果当前 CLI 结构化输出不足以满足交互式 Session，则：

```text
PTY
+
增量 parser
```

第一版允许使用 PTY。

原则：

```text
可靠优先
```

不要为了漂亮的数据结构破坏 Claude Code 原生能力。

---

# 17. Composer

底部 Composer 是使用频率最高的区域。

视觉参考 Codex / ChatGPT。

示例：

```text
┌────────────────────────────────────────────┐
│                                            │
│  Ask Claude...                             │
│                                            │
│  [截图]                                    │
│                                            │
│  ＋                              ↑          │
└────────────────────────────────────────────┘
```

支持：

```text
Enter              换行
Cmd + Enter        发送

或

Enter              发送
Shift + Enter      换行
```

具体选择一种即可。

建议：

```text
Enter 发送
Shift + Enter 换行
```

与主流 AI Chat 保持一致。

---

# 18. Cmd + V 图片粘贴

这是 MVP 必须重点做好的一项。

用户截图后：

```text
Cmd + V
```

Composer 自动识别 Clipboard Image。

流程：

```text
Clipboard
↓
读取 image
↓
保存到 App attachment 临时目录
↓
Composer 显示预览
↓
发送给 Claude
```

附件目录：

```text
~/Library/Application Support/Claude Desk/attachments/
```

文件名：

```text
timestamp_uuid.png
```

Composer：

```text
┌──────────────┐
│ screenshot   │ ×
│   preview    │
└──────────────┘
```

支持移除。

---

# 19. Drag & Drop

整个 Composer 支持拖拽：

```text
PNG
JPG
WEBP
PDF
TXT
MD
JSON
JS
Vue
TS
HTML
CSS
LOG
其他普通文件
```

拖进窗口时显示：

```text
Drop files here
```

附件类型：

```js
{
  id: '',
  conversationId: '',
  type: 'image | file',
  name: '',
  path: '',
  size: 0,
  createdAt: ''
}
```

---

# 20. Attachment 发送

不要自己重新做多模态 API。

Claude Code 原生能读取文件路径时，优先把真实路径交给 Claude。

例如用户：

```text
这个为什么错位
```

附件：

```text
/xxx/attachments/a.png
```

最终内部请求可以变成：

```text
这个为什么错位

附件：
/xxx/attachments/a.png
```

针对 Claude Code 支持的原生 image input 能力，可以进一步封装。

第一版最重要的是：

```text
附件能被 Claude 正确读取
```

而不是协议有多优雅。

---

# 21. 文件选择

Composer 的：

```text
＋
```

打开菜单：

```text
Upload File
Upload Image
```

也可以直接打开 native file picker。

不需要更多菜单。

---

# 22. Stop

Claude 工作时发送按钮变成：

```text
■
```

点击：

```text
Stop Claude
```

需要真正中断当前执行。

不能只是 UI 停止 loading。

---

# 23. Changed Files

当 Claude 修改工程后，右侧消息下方增加：

```text
Changed Files  3
```

展开：

```text
M src/views/Login.vue
M src/styles/login.scss
A src/components/LoginTips.vue
```

第一版可以通过 Git 获取：

```bash
git status --porcelain
```

不需要从 Claude Tool Call 推断。

---

# 24. Diff

点击 Changed File：

```text
src/views/Login.vue
```

打开简单 Diff Drawer / Modal：

```diff
- old
+ new
```

实现优先使用：

```bash
git diff -- path
```

如果新文件：

```text
显示新增内容
```

第一版不需要：

```text
Accept
Reject
Partial Apply
Inline Edit
```

只读即可。

---

# 25. Git

MVP 只使用 Git 做：

```text
Changed Files
Diff
```

不要实现：

```text
Commit
Branch
Push
Pull
PR
Worktree
```

---

# 26. Terminal

主界面不直接显示 Terminal。

Claude Desk 是 Chat-first。

但 Header 菜单提供：

```text
Open Terminal
```

可以弹出一个简单 Terminal Drawer。

用途：

```text
看 Claude CLI 原始状态
debug
执行临时命令
```

Terminal 不应该抢主界面。

---

# 27. Conversation Persistence

App 保存：

```text
Project
Conversation
Messages
Attachments
UI State
```

SQLite 表建议：

```text
projects

conversations

messages

attachments

settings
```

如果 Activity 有必要持久化：

```text
activities
```

否则只保留关键结果。

---

# 28. Messages

```js
{
  id: '',
  conversationId: '',
  role: 'user | assistant | system',
  content: '',
  createdAt: ''
}
```

如果 Claude Code 原生 Session 可以恢复完整历史：

App 自己保存消息仍然保留。

原因：

```text
快速渲染
搜索
Session 出问题时兜底
```

---

# 29. Settings

Settings MVP 只需要：

## Claude

```text
Command
Arguments
Environment Variables
```

## Appearance

```text
System
Light
Dark
```

默认：

```text
System
```

## Editor

```text
Open files with:

VSCode
Cursor
System Default
```

第一版至少支持：

```text
VSCode
```

---

# 30. Claude 元素设计

可以有 Claude 风格，但不要照抄 Anthropic 官方产品。

推荐视觉：

## Accent

使用偏暖的：

```text
terracotta / coral / warm orange
```

例如：

```text
#D97757
```

只是设计参考，不要求严格固定。

## Background

Dark：

```text
#181817
#20201F
#272625
```

Light：

```text
#F7F6F2
#FFFFFF
```

## Logo

自定义一个：

```text
抽象 C
+
四角星 / sparkle
```

含义：

```text
Claude
+
Code
+
Thinking
```

不要直接复制 Anthropic Logo。

---

# 31. 视觉原则

关键词：

```text
Warm
Quiet
Developer
Minimal
Native
```

避免：

```text
传统 SaaS 后台
蓝紫渐变 AI 风
大量玻璃拟态
大量卡片
大圆角 everywhere
炫酷粒子
```

希望打开时像：

```text
Codex
+
Claude
+
Raycast
```

---

# 32. 动效

少量即可。

允许：

```text
Sidebar item hover
Composer focus
Message fade in
Activity 状态变化
Drawer transition
```

不要：

```text
页面切换大动画
复杂 loading
粒子
光效
```

---

# 33. Empty State

首次进入：

```text
Claude Desk

Your Claude Code workspace.

[ Add Project ]
```

进入 Project，没有 Conversation：

```text
What are we building?

[ Ask Claude... ]
```

保持简单。

---

# 34. Keyboard Shortcuts

MVP：

```text
Cmd + N
New Conversation

Cmd + K
Focus Composer

Cmd + Shift + O
Add / Switch Project

Cmd + ,
Settings

Esc
Stop / Close Drawer
```

如果冲突可以调整。

---

# 35. 推荐工程结构

```text
claude-desk/
├── src/
│   ├── components/
│   │   ├── sidebar/
│   │   ├── conversation/
│   │   ├── composer/
│   │   ├── activity/
│   │   ├── diff/
│   │   └── common/
│   │
│   ├── views/
│   │   ├── Home.vue
│   │   ├── Workspace.vue
│   │   └── Settings.vue
│   │
│   ├── stores/
│   │   ├── project.js
│   │   ├── conversation.js
│   │   └── settings.js
│   │
│   ├── services/
│   │   ├── claude/
│   │   │   ├── claude.js
│   │   │   ├── parser.js
│   │   │   ├── session.js
│   │   │   └── attachments.js
│   │   ├── database.js
│   │   ├── git.js
│   │   └── files.js
│   │
│   ├── router/
│   ├── App.vue
│   └── main.js
│
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   │   ├── claude.rs
│   │   │   ├── process.rs
│   │   │   ├── files.rs
│   │   │   └── git.rs
│   │   ├── pty/
│   │   │   └── manager.rs
│   │   └── lib.rs
│   │
│   └── Cargo.toml
│
└── package.json
```

不要继续细拆。

---

# 36. 第一版明确不做

非常重要。

```text
❌ Codex
❌ Gemini
❌ 多 Provider
❌ Agent Pool
❌ Mission
❌ Workflow
❌ MCP 管理
❌ Git Worktree
❌ PR
❌ Commit
❌ 内置 IDE
❌ Monaco
❌ 文件树
❌ Browser Preview
❌ Team
❌ 登录
❌ 云同步
❌ Token Dashboard
❌ Prompt Marketplace
❌ Skills UI
❌ Agent 编排
❌ Voice
```

这个项目第一版就是：

```text
Claude Code GUI
```

---

# 37. MVP 开发顺序

严格按照：

```text
Step 1
创建 Tauri 2 + Vue 3 + Vite + JavaScript 工程

Step 2
完成整体 UI Shell
Sidebar + Workspace + Composer

Step 3
完成 Project 添加和切换

Step 4
SQLite 持久化

Step 5
Conversation 创建 / 切换 / 删除

Step 6
Claude Code CLI 最小接入
能在指定 cwd 启动
能发送 Prompt
能收到输出
能 Stop

Step 7
把 Claude 输出变成 Conversation Message UI

Step 8
Cmd+V 图片

Step 9
文件 Drag & Drop

Step 10
Conversation / Session 恢复

Step 11
Activity 展示

Step 12
Changed Files

Step 13
Diff

Step 14
Settings

Step 15
整体 UI polish
```

---

# 38. 每阶段要求

Codex 每完成一个阶段都需要：

```text
运行
检查
修正 error
确认当前功能可用
```

然后再进入下一阶段。

不要一次性写完所有模块再测试。

---

# 39. 最重要的技术验证

在 UI 细化前，必须优先验证：

```text
Claude Code CLI
能否稳定由 Tauri 启动
```

以及：

```text
能否保持交互 Session
能否增量读取输出
能否真正 Stop
能否恢复 Conversation
```

如果这里有技术限制：

优先调整 Claude integration。

不要为了坚持某个架构而 hack UI。

---

# 40. Claude CLI 配置兼容

不要假设用户一定使用 Anthropic 官方账号。

Claude Desk 必须继承当前 shell / 用户环境。

支持用户已经配置好的：

```text
PATH
代理
Ark
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
Claude Code config
```

不要在 App 内重新要求登录 Claude。

默认逻辑：

```text
如果终端 `claude` 能运行
Claude Desk 就应该尽量能运行。
```

---

# 41. Shell Environment

Tauri GUI App 在 macOS 下可能无法自动获得 Terminal 相同 PATH。

必须主动处理这个问题。

例如：

```text
/bin/zsh -l -c
```

或读取 login shell environment。

确保：

```bash
which claude
which node
which pnpm
which git
```

在 App 内能够正确解析。

这是 MVP 高优先级事项。

---

# 42. Error UX

如果找不到 Claude：

```text
Claude Code not found

Claude Desk couldn't find the `claude` command.

[ Open Settings ]
```

并显示：

```text
Detected PATH:
...
```

不要直接 crash。

---

如果 Claude 启动失败：

```text
Claude couldn't start.

Show details
```

Details 可以显示原始 stderr。

---

# 43. Conversation Title

创建后初始：

```text
New Conversation
```

用户发送第一条消息后：

第一版可以直接：

```text
取前 20~30 个字符
```

作为 title。

暂时不要额外调用模型生成标题。

---

# 44. 文件引用 UX

Claude 回复出现：

```text
src/views/Login.vue
```

如果能识别为当前 Project 内存在的文件：

显示成可点击 file chip / link。

点击：

```text
code -g /absolute/path
```

打开 VSCode。

如果包含行号：

```text
src/views/Login.vue:123
```

调用：

```bash
code -g file:123
```

---

# 45. 代码修改反馈

Claude 工作完成后：

```text
Done
```

下面自动出现：

```text
Changed Files

2 files changed

Login.vue
login.scss

[ Review Changes ]
```

这个体验要做得比 Terminal 直观。

---

# 46. Review Changes

点击：

```text
Review Changes
```

右边弹出 Drawer。

例如：

```text
┌──────────────────────────────────────┐
│ Changes                         ×    │
│                                      │
│ M Login.vue                           │
│ M login.scss                          │
│                                      │
│ ───────────────────────────────────  │
│                                      │
│ - old                                │
│ + new                                │
│                                      │
└──────────────────────────────────────┘
```

不需要编辑。

---

# 47. Loading / Working 状态

不要使用传统：

```text
spinner
```

Claude 工作时可以显示：

```text
✦ Claude is working
```

旁边轻微 pulse。

执行工具：

```text
Reading Login.vue
Searching project
Editing styles
Running tests
```

有一点 Claude 自己的温暖气质。

---

# 48. App 名称显示

开发阶段：

```text
Claude Desk
```

package：

```text
com.local.claudedesk
```

如果后续公开发布，再考虑品牌和商标问题。

目前只是本地工具。

---

# 49. MVP Definition of Done

以下全部完成才算 MVP 完成：

```text
[ ] App 可以启动
[ ] 可以 Add Project
[ ] 左侧可以切换 Project
[ ] 每个 Project 有独立 Conversation
[ ] 可以 New Conversation
[ ] Claude CLI 可以在 Project cwd 正常启动
[ ] 可以发送 Prompt
[ ] Claude 输出显示在聊天窗口
[ ] 可以 Stop
[ ] 可以 Cmd+V 粘贴截图
[ ] 可以拖拽图片
[ ] 可以拖拽普通文件
[ ] Claude 能正确读取附件
[ ] App 重启后 Project 保留
[ ] Conversation 历史保留
[ ] Claude Session 尽可能恢复
[ ] Activity 可读
[ ] Git Changed Files 可见
[ ] 可以查看 Git Diff
[ ] 文件路径可以 Open in VSCode
[ ] Claude command / env 可以在 Settings 修改
[ ] 找不到 Claude 时有清晰错误提示
```

---

# 50. Codex 初始执行 Prompt

将本文件保存为：

```text
CLAUDE_DESK_SPEC.md
```

然后对 Codex 输入：

```text
请完整阅读仓库根目录的 CLAUDE_DESK_SPEC.md。

现在直接按照文档实现 Claude Desk MVP。

这是一个 macOS 优先、基于 Tauri 2 + Vue 3 + JavaScript 的 Claude Code 桌面客户端。

核心产品目标非常明确：

它就是一个“Claude Code 版 Codex App”。

左侧是 Project + Conversation。
右侧是 Claude 对话窗口。
支持日常开发最常用的文本、截图粘贴、图片/文件拖拽、Claude Code 执行状态、Changed Files 和简单 Diff。

请注意：

1. 不使用 TypeScript。
2. 使用 pnpm。
3. 不引入复杂 UI 框架。
4. 不实现 Mission、Agent Pool、多 Provider、Workflow 等功能。
5. 第一优先级不是 UI，而是验证 Claude Code CLI 在 Tauri 中能稳定启动、交互、Stop 和恢复 Session。
6. Claude Desk 必须尽量继承用户当前 shell 环境，尤其是 PATH、Ark、代理和 Claude Code 已有配置。
7. 如果本机终端中的 `claude` 能正常运行，App 应尽量无需额外登录或配置即可运行。
8. UI 风格参考 Codex App / Raycast / Claude 的克制设计，但不要照抄任何官方品牌资产。
9. Claude 输出必须优先做成聊天式 UI，不要让用户主要面对裸 Terminal。
10. 图片粘贴 Cmd+V 与文件 Drag & Drop 是 MVP 核心功能，不要后置为可选项。
11. Claude 修改代码后，通过 Git 展示 Changed Files 和只读 Diff。
12. 不要先给我输出长篇方案，直接检查当前环境并开始实现。
13. 严格按照文档中的 MVP 开发顺序推进。
14. 每个阶段完成后自行运行、检查和修复，再继续下一阶段。
15. 遇到 Claude CLI 集成细节不确定时，优先检查本机 Claude CLI 的实际帮助命令和当前版本能力，不要凭空假设参数。

现在开始。

第一步先检查：

- macOS / Rust / Cargo / Node / pnpm
- Tauri 环境
- `which claude`
- `claude --version`
- `claude --help`
- 当前 shell PATH

确认后初始化项目并开始实现。
```

---

# 51. 产品原则

整个项目只遵循三个原则。

## 1. Claude first

所有功能首先考虑：

```text
是否让 Claude Code 更好用
```

---

## 2. Chat first

用户日常面对的是：

```text
Conversation
```

而不是：

```text
Terminal
```

---

## 3. Keep it small

遇到功能犹豫时：

```text
先不做
```

第一版做到：

```text
打开
选项目
贴图
提问
Claude 改代码
看结果
```

就已经足够有价值。
