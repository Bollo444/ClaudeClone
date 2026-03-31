[English](README.md) | [中文](README_CN.md)

# Claude Code — Source Architecture Deep Dive

> A comprehensive architectural analysis of Anthropic's official CLI coding assistant

![Preview](preview.png)

This repository is a restored Claude Code source tree reconstructed primarily from source maps and missing-module backfilling. It is not the original upstream repository state. Some files were unrecoverable from source maps and have been replaced with compatibility shims or degraded implementations so the project can install and run again.

## Quick Start

Requirements:

- Bun 1.3.5 or newer
- Node.js 24 or newer

```bash
bun install
bun run dev
```

Print the restored version:

```bash
bun run version
```

## Overview

Claude Code is Anthropic's command-line AI coding assistant. Users interact with Claude through a terminal via natural language, combining slash commands and tool invocations to accomplish software engineering tasks. It supports multiple execution modes:

| Mode                  | Description                                                              |
| --------------------- | ------------------------------------------------------------------------ |
| **Interactive REPL**  | Real-time terminal conversation — the primary use case                   |
| **MCP Server**        | Exposes tools to external programs via Model Context Protocol            |
| **Headless/SDK**      | Unattended mode for automation pipelines and Agent SDK integration       |
| **Bridge/Remote**     | Remote control mode, orchestrated from claude.ai web UI                  |
| **Assistant Daemon**  | Background daemon process                                                |

---

## Directory Structure

```text
src/
├── main.tsx               # CLI entry + command registration (~800KB, core hub)
├── QueryEngine.ts         # Query engine — manages conversation lifecycle
├── Tool.ts                # Tool abstract base class
├── Task.ts                # Background task abstraction
├── commands.ts            # Slash command registry
├── tools.ts               # Tool registry
├── query.ts               # Main interaction loop
├── context.ts             # Context management
├── setup.ts               # Session initialization
├── cost-tracker.ts        # Token cost tracking
├── history.ts             # Conversation history management
├── interactiveHelpers.tsx # Interactive helper components
│
├── entrypoints/           # Application entry points
├── screens/               # Top-level screens (REPL, Doctor, Resume)
├── components/            # React/Ink UI components (~146 files)
├── commands/              # Slash command implementations (~60+)
├── tools/                 # Tool implementations (~43)
├── services/              # Backend service integrations (~38)
├── hooks/                 # React Hooks (~87)
├── utils/                 # Utility functions (~331)
├── ink/                   # Custom terminal rendering engine
├── bridge/                # Remote control / Bridge mode
├── vim/                   # Vim emulator
├── state/                 # State management
├── tasks/                 # Background task implementations
├── query/                 # Query engine support modules
├── context/               # React Context providers
├── keybindings/           # Configurable keyboard shortcuts
├── skills/                # Skill system
├── plugins/               # Plugin system
├── migrations/            # Version migrations
├── constants/             # Constant definitions
├── types/                 # Type definitions
├── cli/                   # Non-interactive CLI mode
├── buddy/                 # Companion sprite animations
├── native-ts/             # Native module bindings
└── voice/                 # Voice input integration
```

---

## Core Architecture

### 1. Startup Flow

```text
main.tsx
  ├── Pre-init (MDM reads, Keychain prefetch, startup profiling)
  ├── Commander.js parses CLI arguments
  ├── Fast-path routing (--version, --dump-system-prompt, --mcp, bridge)
  └── Full REPL initialization
        ├── entrypoints/init.ts  → Config / env / telemetry / OAuth
        ├── setup.ts             → Git detection / permissions / session / worktree
        ├── replLauncher.tsx     → Ink render root
        └── screens/REPL.tsx     → Main REPL interaction loop
```

### 2. Tool System

Every capability exposed to the AI is abstracted as a Tool, defined in `Tool.ts`:

```typescript
interface Tool<Input, Output, Progress> {
  call(input: Input, context: ToolUseContext): Promise<ToolResult<Output>>
  description(): string
  inputSchema: ZodSchema           // Zod v4 validation
  isReadOnly(): boolean            // Read-only operation
  isDestructive(): boolean         // Destructive operation
  isConcurrencySafe(): boolean     // Safe for concurrent execution
  isEnabled(context): boolean      // Feature flag gate
  interruptBehavior(): InterruptBehavior
}
```

**Core Tool Inventory** (`tools/` directory):

| Category          | Tools                                                                    |
| ----------------- | ------------------------------------------------------------------------ |
| **File Ops**      | FileEdit, FileRead, FileWrite, Glob, Grep                                |
| **Execution**     | Bash (shell commands), NotebookEdit (Jupyter)                            |
| **Search**        | WebSearch, WebFetch, ToolSearch                                          |
| **Multi-Agent**   | Agent (sub-agent), TeamCreate, TeamDelete, SendMessage                   |
| **Task Mgmt**     | TaskCreate, TaskGet, TaskUpdate, TaskList, TaskStop, TaskOutput          |
| **Planning**      | EnterPlanMode, ExitPlanMode                                              |
| **Isolation**     | EnterWorktree, ExitWorktree                                              |
| **Scheduling**    | ScheduleCron (cron jobs)                                                 |
| **Integration**   | MCP (dynamic MCP tool proxy), Skill, LSP, Config                         |
| **Other**         | TodoWrite, Clipboard, Diff, Sleep                                        |

### 3. QueryEngine — The Conversation Engine

`QueryEngine.ts` is the heart of the application, managing the full conversation loop:

```text
User Input → Build Messages → Call Anthropic API (streaming) → Parse Response
    ↑                                                                     ↓
    ← ← ← ← ← ← ← Tool Results ← ← ← ← ← ← ← ← ← ← ← Tool Use detected?
                                          ↓ No                      ↓ Yes
                                      Output to user          Route to Tool
                                                                  ↓
                                                          Execute & collect result
```

Key responsibilities:

- Message construction and API invocation
- Streaming response processing
- Tool Use detection and routing
- Context window management (auto-compaction)
- Message queuing and command lifecycle

### 4. State Management

Uses a lightweight Observable Store pattern:

```text
state/
├── store.ts           # createStore<T>() → getState / setState / subscribe
├── AppStateStore.ts   # AppState type definition (deeply immutable)
├── AppState.tsx       # React Provider + useAppState() selector hook
├── selectors.ts       # Derived state selectors
└── onChangeAppState.ts # State-change side effects
```

AppState encompasses: settings, model selection, verbose mode, speculation state, task list, messages, tool permissions, todos, MCP connections, and more.

### 5. Context Compaction (`services/compact/`)

Automatically compresses conversations when they exceed the context window, with multiple strategies:

- **Auto-compact** — Triggered automatically
- **Micro-compact** — Lightweight compression
- **API micro-compact** — Server-side compression
- **Reactive compact** — Reactive compression
- **Session memory compact** — Memory-based compression

### 6. Multi-Agent Architecture

Claude Code supports Swarm mode for parallel multi-agent collaboration:

```text
Team Lead (Primary Agent)
    ├── Teammate A (InProcessTeammateTask) → Isolated Git Worktree
    ├── Teammate B (InProcessTeammateTask) → Isolated Git Worktree
    └── Teammate C (LocalAgentTask)        → Sub-agent

Coordination mechanisms:
- Shared TaskList (task assignment & status sync)
- Mailbox messaging system (inter-agent communication)
- SendMessage tool (cross-agent interaction)
```

---

## Technology Stack

### Runtime & Build

| Technology         | Purpose                                                              |
| ------------------ | -------------------------------------------------------------------- |
| **Bun**            | Runtime, `bun:bundle` feature flags + dead-code elimination          |
| **TypeScript**     | Strict mode, Zod v4 runtime validation                               |
| **React Compiler** | Optimized re-renders (`react/compiler-runtime`)                      |
| **Commander.js**   | CLI argument parsing (`@commander-js/extra-typings`)                 |
| **Biome**          | Linting and formatting                                               |
| **Build Macros**   | `MACRO.VERSION` injection, `feature()` feature gating                |

### UI Rendering

Built on a heavily customized **Ink** (React-for-terminal) engine (`ink/` directory):

- Custom React Reconciler → terminal output
- Flexbox-style layout engine
- Full terminal I/O layer (ANSI parsing, keyboard/mouse events, focus detection)
- Design system: ThemedBox/Text, Dialog, FuzzyPicker, ProgressBar, Tabs
- Virtual scrolling message list

### AI / LLM Integration

- **Anthropic SDK** (`@anthropic-ai/sdk`) with streaming
- Extended Thinking support
- Multi-model: Sonnet / Opus / Haiku families
- AWS Bedrock / GCP Vertex AI proxies
- Token budget management and cost tracking

### MCP (Model Context Protocol)

- Full MCP Client (connects to external MCP servers for additional tools/resources)
- Full MCP Server (exposes Claude Code tools to external programs)
- OAuth authentication, permission management, Elicitation handling

### Observability

- **OpenTelemetry** — Distributed tracing, metrics, logs
- **GrowthBook** — Feature flags
- **Datadog** — Monitoring integration
- Startup profiler (`utils/startupProfiler.ts`)
- FPS tracking (`context/fpsMetrics.tsx`)

### Authentication & Security

- OAuth 2.0 (claude.ai authentication)
- API Key support (direct / Bedrock / Vertex)
- mTLS certificate configuration
- Permission system (default / auto / bypass modes)
- Sandbox isolation
- macOS Keychain secure storage

---

## Vim Emulator (`vim/`)

A complete Vim state machine built into the prompt input:

```text
Modes: INSERT / NORMAL
Operators: d(delete), c(change), y(yank), p(paste), >(indent), <(outdent)
Motions: h/l/j/k, w/b/e, 0/^/$, gg, G, f/F/t/T
Text objects: iw, iW, i", i(, i{, i[, it, ip
Features: dot-repeat(.), registers, count prefixes, find/till, case toggle, join lines
```

The state machine core lives in `vim/transitions.ts` (driving state changes); `vim/operators.ts` executes concrete operations.

---

## Slash Command System (`commands/`)

60+ slash commands, organized by function:

| Category       | Commands                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| **Core**       | `/help`, `/init`, `/login`, `/logout`, `/config`, `/status`, `/cost`, `/exit`, `/clear`, `/compact`, `/resume` |
| **Dev**        | `/commit`, `/review`, `/pr-comments`, `/diff`, `/bughunter`, `/autofix-pr`                                     |
| **Config**     | `/model`, `/permissions`, `/mcp`, `/vim`, `/theme`, `/keybindings`, `/effort`                                   |
| **Agent**      | `/agents`, `/tasks`, `/teleport`                                                                               |
| **Integration**| `/ide`, `/desktop`, `/mobile`, `/chrome`, `/voice`                                                              |
| **Diagnostics**| `/doctor`, `/stats`, `/memory`, `/hooks`, `/skills`                                                             |

---

## Bridge Remote Control (`bridge/`)

Enables remote orchestration of Claude Code sessions from claude.ai:

```text
claude.ai ←→ Bridge API ←→ bridgeMain.ts (Worker)
                                  ├── Register as Worker
                                  ├── Poll for work assignments
                                  └── sessionRunner.ts → Isolated session
                                        ├── Single-session mode
                                        ├── Worktree mode (Git isolation)
                                        └── Same-directory mode
```

---

## Key Design Patterns

### Feature Gating

Bun compile-time feature flags enable dead-code elimination:

```typescript
if (feature("PROACTIVE")) { /* Internal builds only */ }
if (feature("KAIROS"))     { /* Specific releases */ }
if (feature("AGENT_TRIGGERS")) { /* Scheduled triggers */ }
```

Internal builds (`ant`) and external releases are differentiated via feature flags.

### Permission System

All Tool executions require permission checks:

```text
PermissionMode: default | auto | bypass
PermissionRule: always-allow | always-deny | always-ask

Execution flow: Tool.call() → Permission check → User confirmation (if needed) → Execute → Return result
```

### Plugin & Skill System

- **Skills** — Loaded from `.claude/skills/`, user-customizable
- **Plugins** — Installed/updated/removed via CLI, extend functionality
- **MCP Skills** — Skills built via the MCP protocol

---

## Data Flow Overview

```text
┌─────────────────────────────────────────────────────┐
│                    User Input (Prompt)               │
└──────────────────────┬──────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────┐
│  QueryEngine                                         │
│  ┌──────────┐  ┌───────────┐  ┌──────────────────┐  │
│  │  Message  │→│  API Call  │→│ Streaming Parser  │  │
│  │  Builder  │  │           │  │                   │  │
│  └──────────┘  └───────────┘  └────────┬─────────┘  │
│                                        ↓             │
│                              ┌──────────────────┐    │
│                              │ Tool Use Detector │    │
│                              └────────┬─────────┘    │
│                         ↓ Text Output  ↓ Tool Call   │
│                    ┌──────────┐  ┌──────────────┐    │
│                    │ Terminal  │  │ Tool Executor │    │
│                    │ Renderer │  │ + Permissions │    │
│                    │ (Ink)    │  │               │    │
│                    └──────────┘  └──────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## File Count Reference

| Module          | Files  | Description                         |
| --------------- | ------ | ----------------------------------- |
| `utils/`        | ~331   | Utility functions (largest dir)     |
| `hooks/`        | ~87    | React Hooks                         |
| `components/`   | ~146   | UI components                       |
| `commands/`     | ~60+   | Slash commands                      |
| `tools/`        | ~43    | Tool implementations                |
| `services/`     | ~38    | Backend services                    |
| `ink/`          | ~50    | Terminal rendering engine           |
| `bridge/`       | ~33    | Bridge mode                         |

---

## Technical Requirements

- **Runtime**: Bun (with `bun:bundle` compile optimization)
- **Language**: TypeScript (strict mode)
- **Minimum Node.js**: v18+
- **Validation**: Zod v4
- **Linting**: Biome
- **Version injection**: Build-time `MACRO.VERSION`

---

*This document was generated from a deep source code analysis and reflects the project's architectural design.*
