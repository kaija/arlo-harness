import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DELEGATION_TIMEOUT_MINUTES,
  DEFAULT_MAX_CONCURRENCY,
  parsePersonaConfig,
  parsePersonaYaml,
  type PersonaConfigInput,
} from '../src/index.js';

const minimal: PersonaConfigInput = {
  id: 'research-analyst',
  name: 'Research Analyst',
  description: 'Collects and summarizes sources.',
  prompt: 'You are a research analyst.',
};

function issuesOf(value: unknown) {
  const result = parsePersonaConfig(value);
  if (result.ok) throw new Error('Expected the config to be rejected.');
  return result.issues;
}

describe('persona.yaml schema', () => {
  it('fills defaults for a minimal persona', () => {
    const result = parsePersonaConfig(minimal);

    expect(result).toEqual({
      ok: true,
      value: {
        ...minimal,
        mcpServers: [],
        tools: { builtin: [], riskLevels: {} },
        browser: { enabled: false },
        maxConcurrency: DEFAULT_MAX_CONCURRENCY,
        alwaysOn: true,
        delegation: { timeoutMinutes: DEFAULT_DELEGATION_TIMEOUT_MINUTES },
        triggers: { events: [] },
      },
    });
    expect(DEFAULT_MAX_CONCURRENCY).toBe(1);
    expect(DEFAULT_DELEGATION_TIMEOUT_MINUTES).toBe(30);
  });

  it('keeps the model binding optional so the Persona inherits the global default', () => {
    const inherited = parsePersonaConfig(minimal);
    const local = parsePersonaConfig({
      ...minimal,
      modelBinding: { providerId: 'ollama', model: 'qwen3', settings: { temperature: 0.2 } },
    });

    expect(inherited.ok && inherited.value.modelBinding).toBeUndefined();
    expect(local.ok && local.value.modelBinding).toEqual({
      providerId: 'ollama',
      model: 'qwen3',
      settings: { temperature: 0.2 },
    });
  });

  it('parses the ADR-0008 example document', () => {
    const result = parsePersonaYaml(
      [
        'id: research-analyst',
        'name: Research Analyst',
        'description: 網路資料蒐集與摘要',
        'prompt: |',
        '  你是一位...',
        'modelBinding: { providerId: openai-main, model: gpt-5-mini }',
        'skills: [web-research, report-writer]',
        'mcpServers:',
        '  - ref: github',
        '  - name: local-fs',
        '    transport: stdio',
        '    command: npx',
        '    args: ["-y", "@modelcontextprotocol/server-filesystem", "./workdir"]',
        'tools:',
        '  builtin: [browser, filesystem, shell]',
        '  riskLevels:',
        '    shell_exec: high',
        '    browser_evaluate: high',
        'browser: { enabled: true }',
        'maxConcurrency: 1',
        'alwaysOn: true',
        'triggers:',
        '  events: []',
      ].join('\n'),
      { directoryName: 'research-analyst' },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.mcpServers).toEqual([
      { ref: 'github' },
      {
        name: 'local-fs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', './workdir'],
        env: {},
      },
    ]);
    expect(result.value.tools.builtin).toEqual(['browser', 'filesystem', 'shell']);
    expect(result.value.prompt).toBe('你是一位...');
  });

  it('accepts a delegation timeout override within bounds', () => {
    const result = parsePersonaConfig({ ...minimal, delegation: { timeoutMinutes: 120 } });
    expect(result.ok && result.value.delegation.timeoutMinutes).toBe(120);

    expect(issuesOf({ ...minimal, delegation: { timeoutMinutes: 0 } })[0]?.path).toBe(
      'delegation.timeoutMinutes',
    );
    expect(issuesOf({ ...minimal, delegation: { timeoutMinutes: 24 * 60 + 1 } })[0]?.path).toBe(
      'delegation.timeoutMinutes',
    );
  });

  it('rejects invalid concurrency', () => {
    for (const maxConcurrency of [0, 1.5, 17, '2']) {
      expect(issuesOf({ ...minimal, maxConcurrency }).map((issue) => issue.path)).toEqual([
        'maxConcurrency',
      ]);
    }
  });

  it('rejects misspelled and unknown fields instead of ignoring them', () => {
    const issues = issuesOf({ ...minimal, maxConcurency: 2, browser: { enable: true } });
    expect(issues.map((issue) => issue.path).sort()).toEqual(['', 'browser']);
  });

  it('rejects invalid ids, empty prompts, and reserved or mismatched ids', () => {
    expect(issuesOf({ ...minimal, id: 'Research_Analyst' })[0]?.path).toBe('id');
    expect(issuesOf({ ...minimal, id: 'orchestrator' })[0]?.path).toBe('id');
    expect(issuesOf({ ...minimal, prompt: '   ' })[0]?.path).toBe('prompt');

    const mismatched = parsePersonaConfig(minimal, { directoryName: 'other-persona' });
    expect(mismatched).toMatchObject({ ok: false, issues: [{ path: 'id' }] });
  });

  it('turns off alwaysOn only in a future version', () => {
    expect(issuesOf({ ...minimal, alwaysOn: false })[0]?.path).toBe('alwaysOn');
  });

  it('rejects unknown tool groups, risk levels, and duplicate list entries', () => {
    expect(issuesOf({ ...minimal, tools: { builtin: ['network'] } })[0]?.path).toBe(
      'tools.builtin.0',
    );
    expect(
      issuesOf({ ...minimal, tools: { riskLevels: { shell_exec: 'critical' } } })[0]?.path,
    ).toBe('tools.riskLevels.shell_exec');

    const duplicates = issuesOf({
      ...minimal,
      skills: ['web-research', 'web-research'],
      tools: { builtin: ['shell', 'shell'] },
      mcpServers: [{ ref: 'github' }, { name: 'github', transport: 'stdio', command: 'gh-mcp' }],
    });
    expect(duplicates.map((issue) => issue.path).sort()).toEqual([
      'mcpServers',
      'skills',
      'tools.builtin',
    ]);
  });

  it('requires the browser to be enabled for browser tools', () => {
    expect(issuesOf({ ...minimal, tools: { builtin: ['browser'] } })).toEqual([
      { path: 'browser.enabled', message: 'The browser tool group needs browser.enabled: true.' },
    ]);
  });

  it('rejects event triggers until Phase 2 defines them', () => {
    const issues = issuesOf({
      ...minimal,
      triggers: { events: [{ on: 'task.completed', prompt: 'Summarize {{event.payload}}' }] },
    });
    expect(issues[0]).toMatchObject({ path: 'triggers.events' });
  });

  it('reports YAML syntax errors and duplicate keys', () => {
    expect(parsePersonaYaml('id: [unclosed')).toMatchObject({ ok: false });
    expect(parsePersonaYaml('id: a\nid: b')).toMatchObject({ ok: false });
    expect(parsePersonaYaml('- just\n- a list')).toMatchObject({
      ok: false,
      issues: [{ path: '' }],
    });
  });

  it('stops alias expansion bombs', () => {
    const bomb = [
      'a: &a [x, x, x, x, x, x, x, x, x, x]',
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]',
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]',
      'd: [*c, *c, *c, *c, *c, *c, *c, *c, *c, *c]',
    ].join('\n');
    expect(parsePersonaYaml(bomb)).toMatchObject({ ok: false });
  });
});
