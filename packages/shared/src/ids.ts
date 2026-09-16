import { z } from 'zod';

export const ORCHESTRATOR_AGENT_ID = 'orchestrator';
export const PERSONA_AGENT_ID_PREFIX = 'persona:';

/**
 * Persona ids appear in directory names, session partitions
 * (`persist:persona-<id>`), context ids (`user:<id>`), and delegate tool names
 * (`delegate_to_<id>`), so they are restricted to lowercase kebab-case. The
 * length cap keeps `delegate_to_<id>` within the 64-character function tool
 * name limit.
 */
export const PERSONA_ID_MAX_LENGTH = 48;
const PERSONA_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** `orchestrator` would make `user:orchestrator` and `delegate_to_orchestrator` ambiguous. */
export const RESERVED_PERSONA_IDS: readonly string[] = Object.freeze([ORCHESTRATOR_AGENT_ID]);

export type AgentId = typeof ORCHESTRATOR_AGENT_ID | `${typeof PERSONA_AGENT_ID_PREFIX}${string}`;

export function isPersonaId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= PERSONA_ID_MAX_LENGTH &&
    PERSONA_ID_PATTERN.test(value) &&
    !RESERVED_PERSONA_IDS.includes(value)
  );
}

export function isAgentId(value: unknown): value is AgentId {
  if (value === ORCHESTRATOR_AGENT_ID) return true;
  return (
    typeof value === 'string' &&
    value.startsWith(PERSONA_AGENT_ID_PREFIX) &&
    isPersonaId(value.slice(PERSONA_AGENT_ID_PREFIX.length))
  );
}

export const personaIdSchema = z
  .string()
  .refine(
    isPersonaId,
    'Persona id must be lowercase kebab-case, at most 48 characters, and not reserved.',
  );

export const agentIdSchema = z
  .string()
  .refine(isAgentId, 'Agent id must be "orchestrator" or "persona:<personaId>".');

export function personaAgentId(personaId: string): AgentId {
  if (!isPersonaId(personaId)) {
    throw new Error(`Invalid persona id "${personaId}".`);
  }
  return `${PERSONA_AGENT_ID_PREFIX}${personaId}`;
}

/** Returns the persona id for `persona:<id>`, or `undefined` for the Orchestrator. */
export function personaIdOf(agentId: AgentId): string | undefined {
  return agentId === ORCHESTRATOR_AGENT_ID
    ? undefined
    : agentId.slice(PERSONA_AGENT_ID_PREFIX.length);
}
