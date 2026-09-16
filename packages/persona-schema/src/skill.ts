import { z } from 'zod';
import { issuesFromZod, joinPath, type ConfigIssue, type ParseResult } from './issues.js';
import { parseYaml } from './yaml.js';

export const SKILL_NAME_MAX_LENGTH = 64;
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** Agent Skills naming rule; the name must also equal the skill's directory name. */
export const skillNameSchema = z
  .string()
  .max(SKILL_NAME_MAX_LENGTH)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Skill names use lowercase letters, digits, and single hyphens between words.',
  );

/**
 * SKILL.md frontmatter (Agent Skills format). Unknown keys are kept rather
 * than rejected so community skills that carry extra metadata still load
 * (ADR-0008 consequences).
 */
export const skillFrontmatterSchema = z.looseObject({
  name: skillNameSchema,
  description: z.string().trim().min(1).max(SKILL_DESCRIPTION_MAX_LENGTH),
  license: z.string().optional(),
  compatibility: z.string().max(500).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  'allowed-tools': z.string().optional(),
});
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export interface ParsedSkill {
  name: string;
  description: string;
  /** The Markdown body, returned by `load_skill(name)` (ADR-0008 §1). */
  instructions: string;
  frontmatter: SkillFrontmatter;
}

const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(text: string): { frontmatter: string; body: string } | undefined {
  const match = FRONTMATTER_PATTERN.exec(text);
  if (match === null) return undefined;
  return { frontmatter: match[1] as string, body: text.slice(match[0].length) };
}

export interface ParseSkillOptions {
  /** The skill's directory name, which the frontmatter `name` must match. */
  directoryName?: string;
}

export function parseSkillMarkdown(
  text: string,
  options: ParseSkillOptions = {},
): ParseResult<ParsedSkill> {
  const parts = splitFrontmatter(text);
  if (parts === undefined) {
    return {
      ok: false,
      issues: [
        { path: '', message: 'SKILL.md must start with YAML frontmatter between "---" lines.' },
      ],
    };
  }
  const yaml = parseYaml(parts.frontmatter, '');
  if (!yaml.ok) return yaml;
  const parsed = skillFrontmatterSchema.safeParse(yaml.value);
  if (!parsed.success) return { ok: false, issues: issuesFromZod(parsed.error) };

  const frontmatter = parsed.data;
  if (options.directoryName !== undefined && frontmatter.name !== options.directoryName) {
    return {
      ok: false,
      issues: [
        {
          path: 'name',
          message: `Skill name "${frontmatter.name}" must match its directory "${options.directoryName}".`,
        },
      ],
    };
  }
  return {
    ok: true,
    value: {
      name: frontmatter.name,
      description: frontmatter.description,
      instructions: parts.body.trim(),
      frontmatter,
    },
  };
}

/**
 * Applies persona.yaml `skills`: the listed skills in the listed order, or
 * every available skill sorted by name when the list is omitted (ADR-0008).
 *
 * `broken` maps skill directories that failed to parse to their issues. A
 * broken skill only fails the selection when the Persona would use it.
 */
export function selectSkills(
  names: readonly string[] | undefined,
  available: readonly ParsedSkill[],
  broken: ReadonlyMap<string, readonly ConfigIssue[]> = new Map(),
): ParseResult<ParsedSkill[]> {
  const issues: ConfigIssue[] = [];
  const selected: ParsedSkill[] = [];
  if (names === undefined) {
    issues.push(...[...broken.values()].flat());
    selected.push(...[...available].sort((a, b) => a.name.localeCompare(b.name)));
  } else {
    const byName = new Map(available.map((skill) => [skill.name, skill]));
    names.forEach((name, index) => {
      const skill = byName.get(name);
      if (broken.has(name)) {
        issues.push(...(broken.get(name) as readonly ConfigIssue[]));
      } else if (skill === undefined) {
        issues.push({
          path: joinPath('skills', index),
          message: `No skill named "${name}" in skills/.`,
        });
      } else {
        selected.push(skill);
      }
    });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: selected };
}

export const LOAD_SKILL_TOOL_NAME = 'load_skill';

/**
 * The system-prompt section listing each skill's name and description. Full
 * instructions stay out of the prompt until the model calls `load_skill`
 * (progressive disclosure, ADR-0008 §1). Returns '' when there are no skills.
 */
export function buildSkillIndex(
  skills: readonly Pick<ParsedSkill, 'name' | 'description'>[],
): string {
  if (skills.length === 0) return '';
  const lines = skills.map(
    (skill) => `- ${skill.name}: ${skill.description.replace(/\s+/g, ' ').trim()}`,
  );
  return [
    '# Skills',
    '',
    `Before following a skill, call ${LOAD_SKILL_TOOL_NAME} with its name to read the full instructions.`,
    '',
    ...lines,
  ].join('\n');
}
