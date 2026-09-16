import { z } from 'zod';
import { isPersonaId } from './ids.js';

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const riskLevelSchema = z.enum(RISK_LEVELS);

/** persona.yaml `tools.riskLevels` (ADR-0008); keys come from {@link toolRiskKey}. */
export const riskLevelOverridesSchema = z.record(z.string().min(1), riskLevelSchema);
export type RiskLevelOverrides = Readonly<Record<string, RiskLevel>>;

/**
 * Default risk level of every built-in tool (ADR-0010 §5). This table is the
 * single source of truth and is locked by a test: changing a level is a
 * security decision, not a refactor.
 */
export const BUILTIN_TOOL_RISK_LEVELS = Object.freeze({
  // Browser (ADR-0006 §4): reading is low; interacting with a page is medium.
  browser_navigate: 'low',
  browser_snapshot: 'low',
  browser_click: 'medium',
  browser_type: 'medium',
  browser_press_key: 'medium',
  browser_scroll: 'low',
  browser_screenshot: 'low',
  browser_extract: 'low',
  browser_wait_for: 'low',
  browser_tabs: 'low',
  browser_evaluate: 'high',
  // Filesystem: reads are low, writes inside workdir medium, deletes high.
  fs_read: 'low',
  fs_list: 'low',
  fs_write: 'medium',
  fs_delete: 'high',
  // Shell
  shell_exec: 'high',
  // Every Agent
  load_skill: 'low',
  ask_orchestrator: 'low',
  notify: 'low',
  // Orchestrator (ADR-0005); each `delegate_to_*` uses DELEGATE_TOOL_RISK_LEVEL.
  get_task: 'low',
  cancel_task: 'low',
  list_tasks: 'low',
  escalate_to_user: 'low',
} as const satisfies Record<string, RiskLevel>);

export type BuiltinToolName = keyof typeof BUILTIN_TOOL_RISK_LEVELS;

/** persona.yaml `tools.builtin` groups (ADR-0008). */
export const BUILTIN_TOOL_GROUPS = Object.freeze({
  browser: Object.freeze([
    'browser_navigate',
    'browser_snapshot',
    'browser_click',
    'browser_type',
    'browser_press_key',
    'browser_scroll',
    'browser_screenshot',
    'browser_extract',
    'browser_wait_for',
    'browser_tabs',
    'browser_evaluate',
  ]),
  filesystem: Object.freeze(['fs_read', 'fs_list', 'fs_write', 'fs_delete']),
  shell: Object.freeze(['shell_exec']),
} as const satisfies Record<string, readonly BuiltinToolName[]>);

export type BuiltinToolGroup = keyof typeof BUILTIN_TOOL_GROUPS;

export const DELEGATE_TOOL_PREFIX = 'delegate_to_';
/** A delegation only starts work; the Persona's own tools carry the risk. */
export const DELEGATE_TOOL_RISK_LEVEL: RiskLevel = 'low';
/** MCP tools without an explicit level (ADR-0010 §6) and Skill `tools.ts` tools. */
export const UNLISTED_TOOL_RISK_LEVEL: RiskLevel = 'medium';

export type ToolRef =
  | { source: 'builtin'; name: string }
  | { source: 'mcp'; server: string; tool: string }
  | { source: 'skill'; name: string };

export function delegateToolName(personaId: string): string {
  if (!isPersonaId(personaId)) {
    throw new Error(`Invalid persona id "${personaId}".`);
  }
  return `${DELEGATE_TOOL_PREFIX}${personaId.replaceAll('-', '_')}`;
}

export function isBuiltinToolName(name: string): name is BuiltinToolName {
  return Object.hasOwn(BUILTIN_TOOL_RISK_LEVELS, name);
}

/** Key used by `tools.riskLevels`; MCP tools are named `<server>.<tool>`. */
export function toolRiskKey(ref: ToolRef): string {
  return ref.source === 'mcp' ? `${ref.server}.${ref.tool}` : ref.name;
}

export function defaultToolRiskLevel(ref: ToolRef): RiskLevel {
  if (ref.source !== 'builtin') return UNLISTED_TOOL_RISK_LEVEL;
  if (isBuiltinToolName(ref.name)) return BUILTIN_TOOL_RISK_LEVELS[ref.name];
  if (ref.name.startsWith(DELEGATE_TOOL_PREFIX)) return DELEGATE_TOOL_RISK_LEVEL;
  throw new Error(`Built-in tool "${ref.name}" has no default risk level.`);
}

export interface ResolveToolRiskOptions {
  overrides?: RiskLevelOverrides;
  /**
   * Set by a write-capable tool when this call writes outside the Persona
   * workdir. Such writes are always high (ADR-0010 §5), whatever the override.
   */
  writesOutsideWorkdir?: boolean;
}

export function resolveToolRiskLevel(
  ref: ToolRef,
  options: ResolveToolRiskOptions = {},
): RiskLevel {
  if (options.writesOutsideWorkdir === true) return 'high';
  const { overrides } = options;
  const key = toolRiskKey(ref);
  if (overrides !== undefined && Object.hasOwn(overrides, key)) {
    return overrides[key] as RiskLevel;
  }
  return defaultToolRiskLevel(ref);
}

/** Maps to the SDK's `needsApproval`: only `low` runs without an interruption. */
export function requiresApproval(level: RiskLevel): boolean {
  return level !== 'low';
}
