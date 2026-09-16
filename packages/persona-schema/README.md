# @arlo/persona-schema

Persona and Provider configuration (T04). Pure Node: no `electron` dependency. Parsers return
`{ ok: true, value }` or `{ ok: false, issues }`, where every issue has a dotted `path` and a
`message`, so a settings screen can mark every invalid field at once.

| Module          | Contents                                                                                 | ADR              |
| --------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| `persona.ts`    | `personaConfigSchema`, `parsePersonaYaml`; defaults for concurrency, tools, delegation   | 0005, 0008, 0009 |
| `settings.ts`   | `globalSettingsSchema` (providers, default binding, Orchestrator binding, MCP templates) | 0003, 0008       |
|                 | `resolveModelBinding`: the Agent's own binding, otherwise the global default             |                  |
| `mcp.ts`        | Inline MCP servers (`stdio`, `streamable_http`), `{ ref }` entries, `resolveMcpServers`  | 0008, 0010       |
| `skill.ts`      | SKILL.md frontmatter parsing, `selectSkills`, `buildSkillIndex` for `load_skill`         | 0008             |
| `workspace.ts`  | ADR-0008 paths and `loadPersonaWorkspace` (persona.yaml plus the skills it uses)         | 0008             |
| `agent-card.ts` | A2A v1.0 Agent Card for a Persona or the Orchestrator                                    | 0004, 0005       |

## Rules worth knowing

- persona.yaml rejects unknown keys, duplicate keys, and YAML alias expansion bombs. SKILL.md
  frontmatter keeps unknown keys so community skills load.
- The Persona `id` must match its workspace directory. A skill `name` must match its directory.
- `delegation.timeoutMinutes` (default 30, max 1440) overrides the sync delegation timeout.
- The `browser` tool group requires `browser.enabled: true`. `triggers.events` must stay empty
  until event triggers are implemented (Phase 2).
- MCP server names cannot contain `.` because MCP tools are named `<server>.<tool>` in
  `tools.riskLevels`. `env` and `headers` values are plain text in the YAML file.
- A broken skill fails a workspace load only if the Persona uses it.
- An Agent Card declares one JSON-RPC interface at `arlo://agents/<agentId>`, which the
  MessagePort transport routes. It never declares an HTTP address.

## Test

```sh
pnpm test
```

`test/fixtures/research-analyst/` is a sample workspace that follows the ADR-0008 layout.
