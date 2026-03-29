# Changelog

## v0.3.0 (2026-03-29)

### Features

- **AskUserQuestion card rendering** — SDK `AskUserQuestion` tool calls now render as interactive question cards with single/multi-select options on both Web and IM
- **MCP API port configurable** — Default changed from fixed 3002 to server port + 1, configurable via `--mcp-port` or `OPENLOBBY_MCP_PORT`
- **LM no-default-initialPrompt** — LM agent no longer sends initial messages when creating/switching sessions; auto-navigates instead (Web + IM)
- **`/release` skill** — Full version publishing workflow with CHANGELOG, GitHub Release, and notification output
- **`/todo` skill** — Quick TODO capture and management
- **Channel plugin system** — Dynamic loading of IM channel providers
- **Telegram channel adapter** — Telegram bot provider with long polling and webhook support
- **Adapter plugin system** — Dynamic loading of external CLI adapter packages
- **Dynamic command completions** — Slash command autocomplete from adapter SDK
- **Source-aware channel routing** — Web-originated messages skip IM delivery; approval cards route to IM when Web is not viewing
- **WeCom rich text** — Quote messages, media directives, and rich formatting
- **Channel management MCP tools** — LobbyManager can manage IM channel providers and bindings via MCP tools
- **Shared slash commands** — `/help`, `/ls`, `/add`, `/goto`, `/rm` work on both Web and IM
- **Per-session command caching** — SQLite-backed command cache for autocomplete
- **New CLI adapter skill** — `/new-cli-adapter` for generating adapter packages
- **New channel provider skill** — `/new-channel-provider` for generating channel packages

### Bug Fixes

- **Codex CLI resume command** — Fixed from `codex --resume` to correct `codex resume` subcommand syntax
- **Resume command hardcoded as Claude** — All 3 occurrences in SessionManager now use `adapter.getResumeCommand()`
- **Tool denial interruption** — Denied tools now properly interrupt execution
- **Sessions stuck in thinking** — Fixed race condition with event wiring
- **Idle session resume** — Resume idle sessions instead of creating duplicates
- **LobbyManager adapter priority** — Prefer Claude Code adapter
- **Codex error status on kill** — Prevent false error status after intentional kill

### Documentation

- **README overhaul** — Product positioning, CLI install instructions, usage scenarios, security description
- **CLAUDE.md** — Mandatory superpowers workflow for all changes

### Other Changes

- Adapter integration test suite
- vitest added to @openlobby/core
- Commit-per-fix workflow rule
