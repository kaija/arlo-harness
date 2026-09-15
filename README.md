# Arlo Harness

Phase 1 repository scaffold for an Electron-based desktop AI Agent platform.

This first commit intentionally contains only the monorepo boundaries and a minimal Electron app.
Agent orchestration, A2A transport, browser tools, persona loading, persistence, and other product
features are reserved for later commits.

## Requirements

- Node.js 24 LTS or newer
- pnpm 12.4.2

## Development

```sh
corepack enable
pnpm install
pnpm dev
```

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm build
```

## Structure

```text
apps/desktop/                 Electron main, preload, and React renderer
packages/shared/              Shared cross-process types (placeholder)
packages/persona-schema/      Persona and Skill schemas (placeholder)
packages/a2a-transport/       A2A MessagePort transport (placeholder)
packages/agent-runtime/       Agent runtime integration (placeholder)
packages/browser-tools/       Browser automation tools (placeholder)
docs/spec/                    Accepted architecture decisions
```

TypeScript is temporarily pinned to 6.0.3 because the current stable typescript-eslint release
does not yet support TypeScript 7. Vite and its React plugin are pinned to the newest compatible
releases supported by electron-vite 5.
