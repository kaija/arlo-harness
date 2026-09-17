import type { AgentId } from '@arlo/shared';
import { useEffect, useRef, type ReactNode } from 'react';
import { AgentAvatar } from '../../components/agent-avatar.js';
import { cn } from '../../lib/utils.js';
import type { ChatItem, PlatformState } from '../../state/model.js';
import { AgentMessage, ChatItemView, StreamStatus, UserBubble } from './ChatItems.js';

type Block =
  | { kind: 'item'; item: ChatItem }
  | { kind: 'turn'; id: string; agentId: AgentId; text: string; items: ChatItem[] };

/** Groups an Agent's reply with the reasoning, tool calls and delegations that follow it. */
function groupTurns(items: ChatItem[], ownerId: AgentId): Block[] {
  const blocks: Block[] = [];
  let turn: Extract<Block, { kind: 'turn' }> | undefined;
  for (const item of items) {
    if (item.kind === 'agent' && item.agentId === ownerId) {
      turn = { kind: 'turn', id: item.id, agentId: item.agentId, text: item.text, items: [] };
      blocks.push(turn);
    } else if (turn && item.kind !== 'user' && item.kind !== 'agent') {
      turn.items.push(item);
    } else {
      turn = undefined;
      blocks.push({ kind: 'item', item });
    }
  }
  return blocks;
}

interface ThreadViewProps {
  data: PlatformState;
  threadId: string;
  now: number;
  /** Main window style: a reply's tool calls and delegations sit under the Agent's avatar. */
  grouped?: boolean;
  compact?: boolean;
  onOpenThread: (agentId: AgentId, threadId: string) => void;
  renderInterrupt: (notificationId: string) => ReactNode;
  header?: ReactNode;
  empty?: ReactNode;
  className?: string;
}

export function ThreadView({
  data,
  threadId,
  now,
  grouped = false,
  compact = false,
  onOpenThread,
  renderInterrupt,
  header,
  empty,
  className,
}: ThreadViewProps) {
  const thread = data.threads[threadId];
  const items = data.threadItems[threadId] ?? [];
  const scroller = useRef<HTMLDivElement>(null);

  // Follow the conversation as it grows; switching Threads starts at the latest message.
  useEffect(() => {
    const node = scroller.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [threadId, items.length]);

  if (!thread) return null;
  const ownerId = thread.agentId;
  const shared = { data, ownerId, now, onOpenThread, renderInterrupt, compact };
  const blocks: Block[] = grouped
    ? groupTurns(items, ownerId)
    : items.map((item) => ({ kind: 'item', item }));
  const lastTurn = [...blocks].reverse().find((block) => block.kind === 'turn');

  return (
    <div
      ref={scroller}
      className={cn(
        'flex min-h-0 flex-1 flex-col overflow-y-auto',
        compact ? 'gap-2.5 px-[13px] py-[13px]' : 'gap-3 px-[18px] py-4',
        className,
      )}
    >
      {header}
      {items.length === 0 ? empty : null}
      {blocks.map((block) => {
        if (block.kind === 'item') {
          return <ChatItemView key={block.item.id} item={block.item} {...shared} />;
        }
        const agent = data.agents[block.agentId];
        if (!agent) return null;
        return (
          <div key={block.id} className="flex gap-[9px]">
            <AgentAvatar agent={agent} size={22} />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="text-body leading-[1.6] whitespace-pre-wrap">{block.text}</div>
              {block.items.map((item) => (
                <ChatItemView key={item.id} item={item} {...shared} />
              ))}
              {grouped && block === lastTurn ? (
                <StreamStatus data={data} threadId={threadId} now={now} />
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { AgentMessage, UserBubble };
