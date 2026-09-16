import { describe, expect, it } from 'vitest';
import {
  buildSkillIndex,
  parseSkillMarkdown,
  selectSkills,
  splitFrontmatter,
  type ParsedSkill,
} from '../src/index.js';

function skill(name: string, description = `${name} description`): ParsedSkill {
  return { name, description, instructions: '', frontmatter: { name, description } };
}

describe('SKILL.md parsing', () => {
  it('splits frontmatter from the body, tolerating a BOM and CRLF line endings', () => {
    expect(splitFrontmatter('\uFEFF---\r\nname: a\r\n---\r\nBody\r\n')).toEqual({
      frontmatter: 'name: a',
      body: 'Body\r\n',
    });
    expect(splitFrontmatter('---\nname: a\n---')).toEqual({ frontmatter: 'name: a', body: '' });
    expect(splitFrontmatter('name: a\n---\n')).toBeUndefined();
    expect(splitFrontmatter('---\nname: a\n')).toBeUndefined();
  });

  it('returns name, description, instructions, and extra frontmatter keys', () => {
    const result = parseSkillMarkdown(
      [
        '---',
        'name: web-research',
        'description: >',
        '  Search the web and',
        '  collect sources.',
        'license: MIT',
        'metadata: { author: arlo }',
        'allowed-tools: browser_navigate browser_snapshot',
        'version: 2',
        '---',
        '',
        '# Web research',
        '',
        'Steps...',
        '',
      ].join('\n'),
      { directoryName: 'web-research' },
    );

    expect(result).toEqual({
      ok: true,
      value: {
        name: 'web-research',
        description: 'Search the web and collect sources.',
        instructions: '# Web research\n\nSteps...',
        frontmatter: {
          name: 'web-research',
          description: 'Search the web and collect sources.',
          license: 'MIT',
          metadata: { author: 'arlo' },
          'allowed-tools': 'browser_navigate browser_snapshot',
          version: 2,
        },
      },
    });
  });

  it('rejects missing frontmatter, missing fields, bad names, and long descriptions', () => {
    expect(parseSkillMarkdown('# No frontmatter')).toMatchObject({
      ok: false,
      issues: [{ path: '' }],
    });
    expect(parseSkillMarkdown('---\nname: a\n---\n')).toMatchObject({
      ok: false,
      issues: [{ path: 'description' }],
    });
    for (const name of ['Web-Research', 'web--research', '-web', 'web_research', 'a'.repeat(65)]) {
      expect(parseSkillMarkdown(`---\nname: ${name}\ndescription: d\n---\n`)).toMatchObject({
        ok: false,
        issues: [{ path: 'name' }],
      });
    }
    expect(
      parseSkillMarkdown(`---\nname: a\ndescription: ${'x'.repeat(1025)}\n---\n`),
    ).toMatchObject({ ok: false, issues: [{ path: 'description' }] });
    expect(parseSkillMarkdown('---\nname: [oops\n---\n')).toMatchObject({ ok: false });
  });

  it('requires the name to match the skill directory', () => {
    expect(
      parseSkillMarkdown('---\nname: web-research\ndescription: d\n---\n', {
        directoryName: 'research',
      }),
    ).toMatchObject({ ok: false, issues: [{ path: 'name' }] });
  });
});

describe('skill selection', () => {
  const available = [skill('report-writer'), skill('web-research'), skill('archive')];

  it('loads every skill by name when persona.yaml omits the list', () => {
    const result = selectSkills(undefined, available);
    expect(result.ok && result.value.map((s) => s.name)).toEqual([
      'archive',
      'report-writer',
      'web-research',
    ]);
  });

  it('keeps the listed order and reports unknown names', () => {
    const listed = selectSkills(['web-research', 'report-writer'], available);
    expect(listed.ok && listed.value.map((s) => s.name)).toEqual(['web-research', 'report-writer']);

    expect(selectSkills(['web-research', 'missing'], available)).toEqual({
      ok: false,
      issues: [{ path: 'skills.1', message: 'No skill named "missing" in skills/.' }],
    });
  });

  it('fails only when a broken skill would be used', () => {
    const brokenIssue = { path: 'skills.draft.SKILL.md', message: 'Missing SKILL.md.' };
    const broken = new Map([['draft', [brokenIssue]]]);

    expect(selectSkills(['web-research'], available, broken).ok).toBe(true);
    expect(selectSkills(['draft'], available, broken)).toEqual({
      ok: false,
      issues: [brokenIssue],
    });
    expect(selectSkills(undefined, available, broken)).toEqual({
      ok: false,
      issues: [brokenIssue],
    });
  });
});

describe('skill index', () => {
  it('lists names and single-line descriptions and points at load_skill', () => {
    const index = buildSkillIndex([
      skill('web-research', 'Search the web\nand collect   sources.'),
      skill('report-writer', 'Write reports.'),
    ]);

    expect(index).toBe(
      [
        '# Skills',
        '',
        'Before following a skill, call load_skill with its name to read the full instructions.',
        '',
        '- web-research: Search the web and collect sources.',
        '- report-writer: Write reports.',
      ].join('\n'),
    );
  });

  it('is empty without skills', () => {
    expect(buildSkillIndex([])).toBe('');
  });
});
