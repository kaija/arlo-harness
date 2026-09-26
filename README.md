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
pnpm test
pnpm build
pnpm --filter @arlo/desktop package
pnpm --filter @arlo/desktop test:e2e   # after build; launches Electron
```

`make ci` runs the same steps as CI. After changing `apps/desktop/src/main/db/schema.ts`, run
`pnpm --filter @arlo/desktop db:generate` and commit the generated migration.

## Structure

```text
apps/desktop/                 Electron main (SQLite in src/main/db, windows), preload, React renderer
packages/shared/              Cross-process contracts
packages/persona-schema/      persona.yaml, global settings, SKILL.md, Agent Cards
packages/a2a-transport/       A2A JSON-RPC over MessagePort, broker
packages/agent-runtime/       Model providers, Agent runner, FakeModel
packages/browser-tools/       Browser automation tools (placeholder)
docs/spec/                    Accepted architecture decisions and task waves
docs/reference-products/      Analyses of comparable open-source products (design references)
```

Implementation progress is tracked in [docs/spec/task-waves.md](docs/spec/task-waves.md).

## Renderer UI

The renderer implements the Claude Design "Agent Platform" mockups with Tailwind CSS 4, shadcn/ui-style
components (`apps/desktop/src/renderer/src/components/ui`), Zustand and TanStack Router. Colors, type
and radii come from the Arlo AI design system and are declared once in
`apps/desktop/src/renderer/src/styles.css`.

Until the renderer API (T20) streams real state, every window starts from the sample workspace in
`src/renderer/src/state/fixtures.ts`. User actions are JSON commands (`state/commands.ts`) applied
locally and mirrored to the other open windows; nothing is sent to an Agent yet. The routes are
`#/main`, `#/persona/<id>`, their `/settings` sheets, and `#/welcome` (first run).

TypeScript is temporarily pinned to 6.0.3 because the current stable typescript-eslint release
does not yet support TypeScript 7. Vite and its React plugin are pinned to the newest compatible
releases supported by electron-vite 5.
