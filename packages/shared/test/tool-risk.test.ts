import { describe, expect, it } from 'vitest';
import {
  BUILTIN_TOOL_GROUPS,
  BUILTIN_TOOL_RISK_LEVELS,
  delegateToolName,
  defaultToolRiskLevel,
  requiresApproval,
  resolveToolRiskLevel,
  riskLevelOverridesSchema,
  toolRiskKey,
} from '../src/tool-risk.js';

describe('built-in tool risk levels', () => {
  // Locked on purpose (ADR-0010): editing this expectation is a security review.
  it('matches the reviewed default table exactly', () => {
    expect(BUILTIN_TOOL_RISK_LEVELS).toStrictEqual({
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
      fs_read: 'low',
      fs_list: 'low',
      fs_write: 'medium',
      fs_delete: 'high',
      shell_exec: 'high',
      load_skill: 'low',
      ask_orchestrator: 'low',
      notify: 'low',
      get_task: 'low',
      cancel_task: 'low',
      list_tasks: 'low',
      escalate_to_user: 'low',
    });
  });

  it('cannot be mutated at runtime', () => {
    expect(Object.isFrozen(BUILTIN_TOOL_RISK_LEVELS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_TOOL_GROUPS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_TOOL_GROUPS.browser)).toBe(true);
  });

  it('assigns every grouped tool a level and covers the whole browser toolset', () => {
    const grouped = Object.values(BUILTIN_TOOL_GROUPS).flat();
    for (const name of grouped) {
      expect(BUILTIN_TOOL_RISK_LEVELS[name]).toBeDefined();
    }
    expect(BUILTIN_TOOL_GROUPS.browser).toEqual(
      Object.keys(BUILTIN_TOOL_RISK_LEVELS).filter((name) => name.startsWith('browser_')),
    );
  });
});

describe('resolveToolRiskLevel', () => {
  it('uses the built-in default when there is no override', () => {
    expect(resolveToolRiskLevel({ source: 'builtin', name: 'browser_evaluate' })).toBe('high');
    expect(resolveToolRiskLevel({ source: 'builtin', name: 'browser_snapshot' })).toBe('low');
  });

  it('treats unlisted MCP and skill tools as medium', () => {
    expect(resolveToolRiskLevel({ source: 'mcp', server: 'github', tool: 'create_issue' })).toBe(
      'medium',
    );
    expect(resolveToolRiskLevel({ source: 'skill', name: 'summarize_report' })).toBe('medium');
  });

  it('treats dynamic delegate_to_* tools as low', () => {
    expect(defaultToolRiskLevel({ source: 'builtin', name: 'delegate_to_research_analyst' })).toBe(
      'low',
    );
  });

  it('throws for a built-in tool missing from the table', () => {
    expect(() => defaultToolRiskLevel({ source: 'builtin', name: 'browser_teleport' })).toThrow(
      'has no default risk level',
    );
  });

  it('applies persona.yaml overrides, keying MCP tools as <server>.<tool>', () => {
    const overrides = riskLevelOverridesSchema.parse({
      shell_exec: 'medium',
      'github.create_issue': 'high',
    });

    expect(resolveToolRiskLevel({ source: 'builtin', name: 'shell_exec' }, { overrides })).toBe(
      'medium',
    );
    expect(
      resolveToolRiskLevel(
        { source: 'mcp', server: 'github', tool: 'create_issue' },
        { overrides },
      ),
    ).toBe('high');
    expect(toolRiskKey({ source: 'mcp', server: 'github', tool: 'create_issue' })).toBe(
      'github.create_issue',
    );
  });

  it('ignores inherited object keys when looking up overrides', () => {
    const overrides = riskLevelOverridesSchema.parse({});
    expect(resolveToolRiskLevel({ source: 'skill', name: 'toString' }, { overrides })).toBe(
      'medium',
    );
  });

  it('forces writes outside the workdir to high even when overridden lower', () => {
    expect(
      resolveToolRiskLevel(
        { source: 'builtin', name: 'fs_write' },
        { overrides: { fs_write: 'low' }, writesOutsideWorkdir: true },
      ),
    ).toBe('high');
    expect(
      resolveToolRiskLevel(
        { source: 'builtin', name: 'fs_write' },
        { writesOutsideWorkdir: false },
      ),
    ).toBe('medium');
  });

  it('rejects unknown override levels', () => {
    expect(riskLevelOverridesSchema.safeParse({ shell_exec: 'none' }).success).toBe(false);
  });
});

describe('requiresApproval', () => {
  it('only lets low-risk tools run without an interruption', () => {
    expect(requiresApproval('low')).toBe(false);
    expect(requiresApproval('medium')).toBe(true);
    expect(requiresApproval('high')).toBe(true);
  });
});

describe('delegateToolName', () => {
  it('derives a function-safe tool name within 64 characters', () => {
    expect(delegateToolName('research-analyst')).toBe('delegate_to_research_analyst');
    expect(delegateToolName('a'.repeat(48)).length).toBeLessThanOrEqual(64);
  });

  it('rejects invalid persona ids', () => {
    expect(() => delegateToolName('Research Analyst')).toThrow('Invalid persona id');
  });
});
