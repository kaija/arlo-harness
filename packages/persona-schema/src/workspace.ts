import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { isPersonaId } from '@arlo/shared';
import { joinPath, type ConfigIssue, type ParseResult } from './issues.js';
import { parsePersonaYaml, type PersonaConfig } from './persona.js';
import { buildSkillIndex, parseSkillMarkdown, selectSkills, type ParsedSkill } from './skill.js';

export const PERSONA_CONFIG_FILE = 'persona.yaml';
export const SKILLS_DIR = 'skills';
export const SKILL_FILE = 'SKILL.md';
export const WORKDIR_DIR = 'workdir';

export interface PersonaWorkspacePaths {
  root: string;
  configFile: string;
  skillsDir: string;
  workdir: string;
}

/** ADR-0008 layout under `<userData>/personas/`. */
export function personaWorkspacePaths(
  personasDir: string,
  personaId: string,
): PersonaWorkspacePaths {
  if (!isPersonaId(personaId)) {
    throw new Error(`Invalid persona id "${personaId}".`);
  }
  const root = join(personasDir, personaId);
  return {
    root,
    configFile: join(root, PERSONA_CONFIG_FILE),
    skillsDir: join(root, SKILLS_DIR),
    workdir: join(root, WORKDIR_DIR),
  };
}

export interface PersonaWorkspace {
  config: PersonaConfig;
  /** Skills the Persona uses, in persona.yaml order (or by name when unlisted). */
  skills: ParsedSkill[];
  /** System-prompt skill index for {@link skills}. */
  skillIndex: string;
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === 'ENOENT';
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

async function readSkills(
  skillsDir: string,
): Promise<{ skills: ParsedSkill[]; issuesByDir: Map<string, ConfigIssue[]> }> {
  const skills: ParsedSkill[] = [];
  const issuesByDir = new Map<string, ConfigIssue[]>();
  let entries: string[];
  try {
    entries = await readdir(skillsDir);
  } catch (error) {
    if (isMissing(error)) return { skills, issuesByDir };
    throw error;
  }
  for (const entry of entries.sort()) {
    const dir = join(skillsDir, entry);
    if (entry.startsWith('.') || !(await isDirectory(dir))) continue;
    const prefix = joinPath(SKILLS_DIR, entry, SKILL_FILE);
    let text: string;
    try {
      text = await readFile(join(dir, SKILL_FILE), 'utf8');
    } catch (error) {
      if (!isMissing(error)) throw error;
      issuesByDir.set(entry, [{ path: prefix, message: `Missing ${SKILL_FILE}.` }]);
      continue;
    }
    const parsed = parseSkillMarkdown(text, { directoryName: entry });
    if (parsed.ok) {
      skills.push(parsed.value);
    } else {
      issuesByDir.set(
        entry,
        parsed.issues.map((issue) => ({ ...issue, path: joinPath(prefix, issue.path) })),
      );
    }
  }
  return { skills, issuesByDir };
}

/**
 * Reads persona.yaml and the skills it uses from a workspace directory. A
 * broken skill only fails the load when the Persona would use it: when
 * persona.yaml lists skills, unlisted directories are ignored. Watching for
 * changes and loading `tools.ts` belong to the workspace loader (T11).
 */
export async function loadPersonaWorkspace(root: string): Promise<ParseResult<PersonaWorkspace>> {
  let text: string;
  try {
    text = await readFile(join(root, PERSONA_CONFIG_FILE), 'utf8');
  } catch (error) {
    if (!isMissing(error)) throw error;
    return { ok: false, issues: [{ path: PERSONA_CONFIG_FILE, message: 'File not found.' }] };
  }
  const config = parsePersonaYaml(text, { directoryName: basename(root) });
  if (!config.ok) {
    return {
      ok: false,
      issues: config.issues.map((issue) => ({
        ...issue,
        path: joinPath(PERSONA_CONFIG_FILE, issue.path),
      })),
    };
  }

  const { skills: available, issuesByDir } = await readSkills(join(root, SKILLS_DIR));
  const selected = selectSkills(config.value.skills, available, issuesByDir);
  if (!selected.ok) {
    // Skill file issues already carry their path; unknown names point into persona.yaml.
    const fileIssues = new Set([...issuesByDir.values()].flat());
    return {
      ok: false,
      issues: selected.issues.map((issue) =>
        fileIssues.has(issue)
          ? issue
          : { ...issue, path: joinPath(PERSONA_CONFIG_FILE, issue.path) },
      ),
    };
  }
  return {
    ok: true,
    value: {
      config: config.value,
      skills: selected.value,
      skillIndex: buildSkillIndex(selected.value),
    },
  };
}
