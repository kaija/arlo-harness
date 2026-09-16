import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentCard } from '@a2a-js/sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildAgentCard,
  loadPersonaWorkspace,
  personaAgentCard,
  personaWorkspacePaths,
} from '../src/index.js';

const fixture = join(import.meta.dirname, 'fixtures/research-analyst');

describe('workspace paths', () => {
  it('follows the ADR-0008 layout', () => {
    expect(personaWorkspacePaths('/data/personas', 'research-analyst')).toEqual({
      root: '/data/personas/research-analyst',
      configFile: '/data/personas/research-analyst/persona.yaml',
      skillsDir: '/data/personas/research-analyst/skills',
      workdir: '/data/personas/research-analyst/workdir',
    });
  });

  it('refuses ids that could escape the personas directory', () => {
    expect(() => personaWorkspacePaths('/data/personas', '../secrets')).toThrow(
      'Invalid persona id',
    );
  });
});

describe('loading a workspace', () => {
  let root: string;

  beforeEach(async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arlo-persona-'));
    root = join(parent, 'research-analyst');
    await cp(fixture, root, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(root, '..'), { recursive: true, force: true });
  });

  it('reads persona.yaml, the listed skills, and builds the skill index', async () => {
    const result = await loadPersonaWorkspace(root);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));

    expect(result.value.config.id).toBe('research-analyst');
    expect(result.value.skills.map((skill) => skill.name)).toEqual([
      'web-research',
      'report-writer',
    ]);
    expect(result.value.skills[0]?.instructions).toContain('browser_snapshot');
    expect(result.value.skillIndex).toContain(
      '- web-research: Search the web, open result pages, and collect sourced facts for a research question.',
    );
    expect(result.value.skillIndex).not.toContain('unused-broken');
  });

  it('loads every skill when persona.yaml omits the list, so a broken one fails', async () => {
    const yamlPath = join(root, 'persona.yaml');
    const text = (await readFile(yamlPath, 'utf8')).replace(/^skills: .*\n/m, '');
    await writeFile(yamlPath, text);

    const result = await loadPersonaWorkspace(root);

    expect(result).toMatchObject({
      ok: false,
      issues: [{ path: 'skills.unused-broken.SKILL.md' }],
    });
  });

  it('reports unknown and missing skills, ignoring dotfiles and plain files', async () => {
    await mkdir(join(root, 'skills', 'no-skill-file'));
    await mkdir(join(root, 'skills', '.git'));
    await writeFile(join(root, 'skills', 'README.md'), 'not a skill');
    const yamlPath = join(root, 'persona.yaml');
    const text = (await readFile(yamlPath, 'utf8')).replace(
      /^skills: .*$/m,
      'skills: [web-research, no-skill-file, missing]',
    );
    await writeFile(yamlPath, text);

    const result = await loadPersonaWorkspace(root);

    expect(result).toEqual({
      ok: false,
      issues: [
        { path: 'skills.no-skill-file.SKILL.md', message: 'Missing SKILL.md.' },
        { path: 'persona.yaml.skills.2', message: 'No skill named "missing" in skills/.' },
      ],
    });
  });

  it('requires persona.yaml and matching id', async () => {
    const renamed = join(root, '..', 'renamed');
    await cp(root, renamed, { recursive: true });

    expect(await loadPersonaWorkspace(renamed)).toMatchObject({
      ok: false,
      issues: [{ path: 'persona.yaml.id' }],
    });
    expect(await loadPersonaWorkspace(join(root, '..', 'nowhere'))).toEqual({
      ok: false,
      issues: [{ path: 'persona.yaml', message: 'File not found.' }],
    });
  });

  it('treats a workspace without skills/ as having no skills', async () => {
    await rm(join(root, 'skills'), { recursive: true });
    const yamlPath = join(root, 'persona.yaml');
    await writeFile(yamlPath, (await readFile(yamlPath, 'utf8')).replace(/^skills: .*\n/m, ''));

    const result = await loadPersonaWorkspace(root);

    expect(result.ok && result.value.skills).toEqual([]);
    expect(result.ok && result.value.skillIndex).toBe('');
  });
});

describe('Agent Card', () => {
  it('describes a Persona with its skills and a MessagePort JSON-RPC interface', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'arlo-card-'));
    const root = join(parent, 'research-analyst');
    await cp(fixture, root, { recursive: true });
    try {
      const workspace = await loadPersonaWorkspace(root);
      if (!workspace.ok) throw new Error(JSON.stringify(workspace.issues));

      const card = personaAgentCard(workspace.value.config, workspace.value.skills);
      const json = AgentCard.toJSON(card);

      expect(json).toMatchObject({
        name: 'Research Analyst',
        description: '網路資料蒐集與摘要',
        supportedInterfaces: [
          {
            url: 'arlo://agents/persona:research-analyst',
            protocolBinding: 'JSONRPC',
            protocolVersion: '1.0',
          },
        ],
        capabilities: { streaming: true, pushNotifications: false },
        defaultInputModes: ['text/plain', 'application/json'],
        skills: [
          { id: 'web-research', name: 'web-research' },
          {
            id: 'report-writer',
            name: 'report-writer',
            description: 'Turn collected notes into a short Markdown report in the workdir.',
          },
        ],
      });
      // The card crosses MessagePorts and is stored as JSON (ADR-0004 §5, ADR-0011).
      expect(AgentCard.toJSON(AgentCard.fromJSON(JSON.parse(JSON.stringify(json))))).toEqual(json);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it('builds the Orchestrator card from explicit fields', () => {
    const card = buildAgentCard({
      agentId: 'orchestrator',
      name: 'Orchestrator',
      description: 'Plans work and delegates to Personas.',
      skills: [],
      version: '0.1.0',
    });

    expect(card.supportedInterfaces[0]?.url).toBe('arlo://agents/orchestrator');
    expect(card.version).toBe('0.1.0');
    expect(card.skills).toEqual([]);
  });
});
