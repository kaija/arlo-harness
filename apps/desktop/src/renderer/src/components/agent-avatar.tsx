import { cn } from '../lib/utils.js';
import type { Agent } from '../state/model.js';
import { ORCHESTRATOR_ID, toneOfAgent } from '../state/selectors.js';
import { TONE_TEXT, TONE_TINT } from './tone.js';

const SIZES = {
  19: 'size-[19px] rounded-[6px] text-nano',
  20: 'size-5 rounded-[6px] text-nano',
  22: 'size-[22px] rounded-[6px] text-tiny',
  24: 'size-6 rounded-mark text-tiny',
  26: 'size-[26px] rounded-mark text-label',
  28: 'size-7 rounded-sm text-tiny',
  30: 'size-[30px] rounded-sm text-body',
  44: 'size-11 rounded-md text-[15px]',
} as const;

/** Brand-mark style initials square; the Orchestrator is the solid accent "A". Tint follows status. */
export function AgentAvatar({
  agent,
  size = 26,
  className,
}: {
  agent: Pick<Agent, 'id' | 'initials' | 'activity' | 'paused'>;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const orchestrator = agent.id === ORCHESTRATOR_ID;
  const tone = toneOfAgent(agent as Agent);
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center font-bold transition-colors duration-250',
        SIZES[size],
        orchestrator ? 'bg-primary text-white' : [TONE_TINT[tone], TONE_TEXT[tone]],
        className,
      )}
    >
      {agent.initials}
    </span>
  );
}
