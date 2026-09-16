import { A2A_PROTOCOL_VERSION, AgentCard } from '@a2a-js/sdk';
import { agentEndpointUrl, personaAgentId, type AgentId } from '@arlo/shared';
import type { PersonaConfig } from './persona.js';
import type { ParsedSkill } from './skill.js';

/** Plain text for conversation; JSON for structured parts such as HITL payloads (ADR-0010). */
export const AGENT_CARD_MEDIA_TYPES = Object.freeze(['text/plain', 'application/json']);

export interface AgentCardInput {
  agentId: AgentId;
  name: string;
  description: string;
  skills: readonly Pick<ParsedSkill, 'name' | 'description'>[];
  version?: string;
}

/**
 * Builds an A2A v1.0 Agent Card. The single JSON-RPC interface points at the
 * Agent's MessagePort endpoint URL rather than an HTTP address (ADR-0004 §2).
 * Streaming is always on: sync delegation consumes a stream (ADR-0005 §2).
 * Push notifications are off; task updates travel over the broker.
 */
export function buildAgentCard(input: AgentCardInput): AgentCard {
  return AgentCard.fromJSON({
    name: input.name,
    description: input.description,
    version: input.version ?? '1.0.0',
    supportedInterfaces: [
      {
        url: agentEndpointUrl(input.agentId),
        protocolBinding: 'JSONRPC',
        protocolVersion: A2A_PROTOCOL_VERSION,
      },
    ],
    capabilities: { streaming: true, pushNotifications: false, extendedAgentCard: false },
    defaultInputModes: [...AGENT_CARD_MEDIA_TYPES],
    defaultOutputModes: [...AGENT_CARD_MEDIA_TYPES],
    skills: input.skills.map((skill) => ({
      id: skill.name,
      name: skill.name,
      description: skill.description,
      tags: [],
    })),
  });
}

/** ADR-0004 §5: a Persona's card comes from persona.yaml `name`, `description`, and its skills. */
export function personaAgentCard(
  persona: Pick<PersonaConfig, 'id' | 'name' | 'description'>,
  skills: readonly Pick<ParsedSkill, 'name' | 'description'>[],
): AgentCard {
  return buildAgentCard({
    agentId: personaAgentId(persona.id),
    name: persona.name,
    description: persona.description,
    skills,
  });
}
