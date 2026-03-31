[English](README.md) | [中文](README_CN.md)

# Claude Code - 源码架构深度解析

> Anthropic 官方 CLI 编码助手的完整源码架构分析文档

![预览](preview.png)

本仓库是通过 source map 重建并回填缺失模块而还原的 Claude Code 源码树。它并非原始上游仓库的状态。部分文件无法从 source map 中恢复，已用兼容性垫片或降级实现替换，以确保项目能够重新安装和运行。

## 快速开始

环境要求：

- Bun 1.3.5 或更新版本
- Node.js 24 或更新版本

```bash
bun install
bun run dev
```

打印还原版本号：

```bash
bun run version
```

## 项目概述

Claude Code 是 Anthropic 开发的命令行 AI 编码助手。用户通过终端以自然语言与 Claude 交互，结合斜杠命令和工具调用完成软件工程任务。支持多种运行模式：

| 模式                  | 说明                                                     |
| --------------------- | -------------------------------------------------------- |
| **交互式 REPL**       | 终端内实时对话，核心使用场景                               |
| **MCP Server**        | 通过 Model Context Protocol 暴露工具给外部程序调用         |
| **Headless/SDK**      | 无头模式，用于自动化流水线和 Agent SDK 集成               |
| **Bridge/Remote**     | 远程控制模式，由 claude.ai 网页端调度                      |
| **Assistant Daemon**  | 后台守护进程模式                                          |

---

## 目录结构总览

```text
src/
├── main.tsx              # CLI 入口 + 命令注册 (~800KB，核心枢纽)
├── QueryEngine.ts        # 查询引擎，管理对话生命周期
├── Tool.ts               # Tool 抽象基类
├── Task.ts               # 后台任务抽象
├── commands.ts           # 斜杠命令注册表
├── tools.ts              # 工具注册表
├── query.ts              # 主交互循环
├── context.ts            # 上下文管理
├── setup.ts              # 会话初始化
├── cost-tracker.ts       # Token 成本追踪
├── history.ts            # 对话历史管理
├── interactiveHelpers.tsx # 交互辅助组件
│
├── entrypoints/          # 应用入口点
├── screens/              # 顶层屏幕 (REPL, Doctor, Resume)
├── components/           # React/Ink UI 组件 (~146 个)
├── commands/             # 斜杠命令实现 (~60+ 个)
├── tools/                # 工具实现 (~43 个)
├── services/             # 后端服务集成 (~38 个)
├── hooks/                # React Hooks (~87 个)
├── utils/                # 工具函数 (~331 个)
├── ink/                  # 自定义终端渲染引擎
├── bridge/               # 远程控制/Bridge 模式
├── vim/                  # Vim 模拟器
├── state/                # 状态管理
├── tasks/                # 后台任务实现
├── query/                # 查询引擎支持模块
├── context/              # React Context 提供者
├── keybindings/          # 可配置键盘快捷键
├── skills/               # Skill 系统
├── plugins/              # 插件系统
├── migrations/           # 版本迁移
├── constants/            # 常量定义
├── types/                # 类型定义
├── cli/                  # 非交互式 CLI 模式
├── buddy/                # 陪伴精灵动画
├── native-ts/            # 原生模块绑定
└── voice/                # 语音输入集成
```

---

## 核心架构

### 1. 启动流程

```text
main.tsx
  ├── 预初始化 (MDM 读取、Keychain 预取、启动性能分析)
  ├── Commander.js 解析 CLI 参数
  ├── 快速路径判断 (--version, --dump-system-prompt, --mcp, bridge)
  └── 完整 REPL 初始化
        ├── entrypoints/init.ts  → 配置/环境/遥测/OAuth
        ├── setup.ts             → Git 检测/权限/会话/Worktree
        ├── replLauncher.tsx     → Ink 渲染根节点
        └── screens/REPL.tsx     → 主 REPL 交互循环
```

### 2. Tool 系统

所有 AI 可调用的能力均抽象为 Tool，定义于 `Tool.ts`：

```typescript
interface Tool<Input, Output, Progress> {
  call(input: Input, context: ToolUseContext): Promise<ToolResult<Output>>
  description(): string
  inputSchema: ZodSchema           // Zod v4 校验
  isReadOnly(): boolean            // 只读操作
  isDestructive(): boolean         // 破坏性操作
  isConcurrencySafe(): boolean     // 可并发执行
  isEnabled(context): boolean      // 功能开关
  interruptBehavior(): InterruptBehavior
}
```

**核心工具清单** (`tools/` 目录)：

| 类别            | 工具                                                                      |
| --------------- | ------------------------------------------------------------------------- |
| **文件操作**    | FileEdit, FileRead, FileWrite, Glob, Grep                                 |
| **执行**        | Bash (Shell 命令), NotebookEdit (Jupyter)                                 |
| **搜索**        | WebSearch, WebFetch, ToolSearch                                           |
| **多 Agent**    | Agent (子 Agent), TeamCreate, TeamDelete, SendMessage                     |
| **任务管理**    | TaskCreate, TaskGet, TaskUpdate, TaskList, TaskStop, TaskOutput           |
| **规划**        | EnterPlanMode, ExitPlanMode                                               |
| **隔离**        | EnterWorktree, ExitWorktree                                               |
| **调度**        | ScheduleCron (定时任务)                                                    |
| **集成**        | MCP (动态 MCP 工具代理), Skill, LSP, Config                               |
| **其他**        | TodoWrite, Clipboard, Diff, Sleep                                         |

### 3. QueryEngine — 对话引擎

`QueryEngine.ts` 是应用心脏，管理完整的对话循环：

```text
用户输入 → 构建消息 → 调用 Anthropic API (流式) → 解析响应
    ↑                                                        ↓
    ← ← ← ← ← ← 工具结果回传 ← ← ← ← ← ← 检测到 Tool Use?
                                      ↓ 否                ↓ 是
                                  输出给用户          路由到对应 Tool
                                                          ↓
                                                      执行并收集结果
```

关键职责：

- 消息构建与 API 调用
- 流式响应处理
- Tool Use 检测与路由
- 上下文窗口管理（自动压缩）
- 消息队列与命令生命周期

### 4. 状态管理

采用轻量级 Observable Store 模式：

```text
state/
├── store.ts           # createStore<T>() → getState/setState/subscribe
├── AppStateStore.ts   # AppState 类型定义（深度不可变）
├── AppState.tsx       # React Provider + useAppState() selector
├── selectors.ts       # 派生状态选择器
└── onChangeAppState.ts # 状态变更副作用
```

AppState 包含：设置、模型选择、详细模式、推测状态、任务列表、消息、工具权限、Todo、MCP 连接等。

### 5. 上下文压缩 (`services/compact/`)

对话超出上下文窗口时自动压缩，支持多种策略：

- **Auto-compact** — 自动触发
- **Micro-compact** — 轻量级压缩
- **API micro-compact** — API 侧压缩
- **Reactive compact** — 响应式压缩
- **Session memory compact** — 基于会话记忆的压缩

### 6. 多 Agent 架构

Claude Code 支持 Swarm 模式，多个 Agent 并行协作：

```text
Team Lead (主 Agent)
    ├── Teammate A (InProcessTeammateTask) → 独立 Git Worktree
    ├── Teammate B (InProcessTeammateTask) → 独立 Git Worktree
    └── Teammate C (LocalAgentTask)        → 子 Agent

协调机制：
- 共享 TaskList（任务分配与状态同步）
- Mailbox 消息系统（Agent 间通信）
- SendMessage 工具（跨 Agent 交互）
```

---

## 技术栈

### 运行时与构建

| 技术               | 用途                                                     |
| ------------------ | -------------------------------------------------------- |
| **Bun**            | 运行时，`bun:bundle` 特性标志 + DCE                      |
| **TypeScript**     | 严格模式，Zod v4 运行时校验                               |
| **React Compiler** | 优化重渲染 (`react/compiler-runtime`)                    |
| **Commander.js**   | CLI 参数解析 (`@commander-js/extra-typings`)             |
| **Biome**          | 代码检查与格式化                                          |
| **Build Macros**   | `MACRO.VERSION` 版本注入，`feature()` 特性门控           |

### UI 渲染

基于深度定制的 **Ink** (React-for-terminal) 引擎 (`ink/` 目录)：

- 自定义 React Reconciler → 终端输出
- Flexbox 式布局引擎
- 完整的终端 I/O 层（ANSI 解析、键盘/鼠标事件、焦点检测）
- 设计系统：ThemedBox/Text、Dialog、FuzzyPicker、ProgressBar、Tabs
- 虚拟滚动消息列表

### AI/LLM 集成

- **Anthropic SDK** (`@anthropic-ai/sdk`) 流式调用
- Extended Thinking（扩展思考）支持
- 多模型：Sonnet / Opus / Haiku 家族
- AWS Bedrock / GCP Vertex AI 代理
- Token 预算管理与成本追踪

### MCP (Model Context Protocol)

- 完整的 MCP Client（连接外部 MCP Server 获取额外工具/资源）
- 完整的 MCP Server（暴露 Claude Code 工具给外部程序）
- OAuth 认证、权限管理、Elicitation 处理

### 可观测性

- **OpenTelemetry** — 分布式追踪、指标、日志
- **GrowthBook** — 特性标志
- **Datadog** — 监控集成
- 启动性能分析器 (`utils/startupProfiler.ts`)
- FPS 追踪 (`context/fpsMetrics.tsx`)

### 认证与安全

- OAuth 2.0 (claude.ai 认证)
- API Key 支持（直连 / Bedrock / Vertex）
- mTLS 证书配置
- 权限系统 (default / auto / bypass 模式)
- Sandbox 沙箱隔离
- macOS Keychain 安全存储

---

## Vim 模拟器 (`vim/`)

内置完整 Vim 状态机，支持 Prompt 输入中的 Vim 操作：

```text
模式：INSERT / NORMAL
操作符：d(delete), c(change), y(yank), p(paste), >(indent), <(outdent)
移动：h/l/j/k, w/b/e, 0/^/$, gg, G, f/F/t/T
文本对象：iw, iW, i", i(, i{, i[, it, ip
特性：点重复(.)、寄存器、计数前缀、查找/跳转、大小写切换、合并行
```

状态机核心在 `vim/transitions.ts`，驱动状态转换；`vim/operators.ts` 执行具体操作。

---

## 斜杠命令体系 (`commands/`)

共 60+ 斜杠命令，按功能分类：

| 分类        | 命令                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------- |
| **核心**    | `/help`, `/init`, `/login`, `/logout`, `/config`, `/status`, `/cost`, `/exit`, `/clear`, `/compact`, `/resume` |
| **开发**    | `/commit`, `/review`, `/pr-comments`, `/diff`, `/bughunter`, `/autofix-pr`                              |
| **配置**    | `/model`, `/permissions`, `/mcp`, `/vim`, `/theme`, `/keybindings`, `/effort`                           |
| **Agent**   | `/agents`, `/tasks`, `/teleport`                                                                        |
| **集成**    | `/ide`, `/desktop`, `/mobile`, `/chrome`, `/voice`                                                      |
| **诊断**    | `/doctor`, `/stats`, `/memory`, `/hooks`, `/skills`                                                     |

---

## Bridge 远程控制 (`bridge/`)

允许从 claude.ai 网页端远程调度 Claude Code 会话：

```text
claude.ai ←→ Bridge API ←→ bridgeMain.ts (Worker)
                                  ├── 注册为 Worker
                                  ├── 轮询获取工作分配
                                  └── sessionRunner.ts → 隔离会话
                                        ├── 单会话模式
                                        ├── Worktree 模式（Git 隔离）
                                        └── 同目录模式
```

---

## 关键设计模式

### 特性门控

使用 Bun 编译时特性标志实现死代码消除：

```typescript
if (feature("PROACTIVE")) { /* 仅内部构建包含 */ }
if (feature("KAIROS"))     { /* 仅特定版本 */ }
if (feature("AGENT_TRIGGERS")) { /* 定时触发功能 */ }
```

内部构建 (`ant`) 与外部发布版本通过特性标志区分。

### 权限系统

所有 Tool 执行前需通过权限检查：

```text
PermissionMode: default | auto | bypass
PermissionRule: always-allow | always-deny | always-ask

执行流程：Tool.call() → 权限检查 → 用户确认(如需) → 执行 → 返回结果
```

### 插件与 Skill 系统

- **Skills** — 从 `.claude/skills/` 加载，可由用户自定义
- **Plugins** — 通过 CLI 安装/更新/移除，扩展功能
- **MCP Skills** — 通过 MCP 协议构建的 Skill

---

## 数据流概览

```text
┌─────────────────────────────────────────────────────┐
│                    用户输入 (Prompt)                  │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  QueryEngine                                         │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │ 消息构建  │→│ API 调用   │→│ 流式响应解析      │  │
│  └──────────┘  └───────────┘  └────────┬─────────┘  │
│                                        ↓             │
│                              ┌──────────────────┐    │
│                              │ Tool Use 检测     │    │
│                              └────────┬─────────┘    │
│                         ↓ 文本输出    ↓ Tool 调用     │
│                    ┌──────────┐  ┌──────────────┐    │
│                    │ 终端渲染  │  │ Tool 执行     │    │
│                    │ (Ink)    │  │ + 权限检查    │    │
│                    └──────────┘  └──────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## 文件规模参考

| 模块           | 文件数  | 说明                       |
| -------------- | ------- | -------------------------- |
| `utils/`       | ~331    | 工具函数，项目最大目录       |
| `hooks/`       | ~87     | React Hooks                |
| `components/`  | ~146    | UI 组件                    |
| `commands/`    | ~60+    | 斜杠命令                   |
| `tools/`       | ~43     | Tool 实现                  |
| `services/`    | ~38     | 后端服务                   |
| `ink/`         | ~50     | 终端渲染引擎               |
| `bridge/`      | ~33     | Bridge 模式                |

---

## 技术要求

- **运行时**: Bun (带 `bun:bundle` 编译优化)
- **语言**: TypeScript (严格模式)
- **最低 Node.js**: v18+
- **校验**: Zod v4
- **Lint**: Biome
- **版本注入**: 构建时 `MACRO.VERSION`

---

*本文档基于源码深度分析生成，反映项目架构设计。*
