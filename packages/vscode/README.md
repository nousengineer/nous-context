# ThinkCoffee VS Code Extension

VS Code extension for autonomous workflows, defensive analysis, and orchestrator integration.

This package is in an implementation phase with mixed maturity: some commands are fully wired, while others are explicit placeholders.

## Status

Current implementation has two groups of features.

Implemented now:

- Advanced command handlers in `src/extension.ts` for:
	- code generation, debugging, and refactoring
	- defensive security scan and controlled simulation planning
	- multimodal file synthesis (image/text classification + reasoning summary)
	- workflow creation/execution with local fallback state checkpoints
	- remote orchestrator run operations (create/start/status/checkpoints/pause/resume/select)
- Network robustness in orchestrator client (HTTP error mapping + timeout handling)
- Output channel reporting for long-running autonomous tasks

Still placeholder (shows info message only):

- No command in this package remains info-only placeholder.

Known gaps:

- The contributed view container exists, and runtime behavior is still command-first.
- PM-facing control commands are intentionally not pinned in chat title actions.

Placeholder implementation backlog is tracked in `PLACEHOLDERS_TODO.md`.

## Build

```bash
cd packages/vscode
pnpm build
pnpm exec vsce package --no-dependencies
```

Install the generated `.vsix` from VS Code Extensions sidebar ("Install from VSIX...").

## Commands

Working commands (implemented handlers):

- `ThinkCoffee: Advanced Code Generation`
- `ThinkCoffee: AI-Powered Code Debugging`
- `ThinkCoffee: Intelligent Code Refactoring`
- `ThinkCoffee: Comprehensive Security Scan`
- `ThinkCoffee: Attack Simulation (Controlled)`
- `ThinkCoffee: Zero-Day Vulnerability Discovery`
- `ThinkCoffee: AI Image Analysis`
- `ThinkCoffee: Diagram Interpretation`
- `ThinkCoffee: Knowledge Synthesis`
- `ThinkCoffee: Multi-Step Problem Solving`
- `ThinkCoffee: Adaptive Deep Reasoning`
- `ThinkCoffee: Create Complex Workflow`
- `ThinkCoffee: Execute Autonomous Workflow`
- `ThinkCoffee: Orchestrator Run Status`
- `ThinkCoffee: Orchestrator Checkpoints`
- `ThinkCoffee: Pause Orchestrator Run`
- `ThinkCoffee: Resume Orchestrator Run`
- `ThinkCoffee: Select Orchestrator Run`
- `ThinkCoffee: Run Current Phase (Start Agents)` (PM/delegation command; not shown in chat title actions)
- `ThinkCoffee: Stop All Agents`
- `ThinkCoffee: Invoke Agent`

PM-delegated commands (formerly placeholders, now functional):

- `ThinkCoffee: Refresh Projects`
- `ThinkCoffee: Create Project`
- `ThinkCoffee: Add Context Entry`
- `ThinkCoffee: Add File as Context`
- `ThinkCoffee: Add Selection as Context`
- `ThinkCoffee: Add Workspace Structure as Context`
- `ThinkCoffee: Record Decision`
- `ThinkCoffee: Sync to AI Tools`
- `ThinkCoffee: Export Context`
- `ThinkCoffee: Open Context File`
- `ThinkCoffee: View Context Entry`
- `ThinkCoffee: Open AI Chat`
- `ThinkCoffee: Create Pipeline`
- `ThinkCoffee: Approve Phase`
- `ThinkCoffee: Reject Phase`
- `ThinkCoffee: View Task Output`
- `ThinkCoffee: Refresh Pipeline`
- `ThinkCoffee: Open Other Project`
- `ThinkCoffee: Configure Agent Models`
- `ThinkCoffee: View Agent Models`
- `ThinkCoffee: Toggle Dry-Run Mode`
- `ThinkCoffee: Open Safety Net Panel`
- `ThinkCoffee: Rollback Phase`
- `ThinkCoffee: List Available Snapshots`
- `ThinkCoffee: Cleanup Old Snapshots`

## Orchestrator Configuration

Remote orchestrator commands are enabled when `thinkcoffee.orchestrator.baseUrl` is set.

Supported settings:

- `thinkcoffee.orchestrator.baseUrl`
- `thinkcoffee.orchestrator.token`
- `thinkcoffee.orchestrator.workspaceId`

Runtime also reads `thinkcoffee.orchestrator.timeoutMs` (default `30000`) if defined in user settings.

## Data and State

- Workflow checkpoints and recent run summaries are persisted in VS Code workspace/global state.
- This extension README no longer claims active SQLite context management until placeholder commands are fully implemented.
