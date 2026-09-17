import { useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../../components/icon.js';
import { Button } from '../../components/ui/button.js';
import { Tooltip } from '../../components/ui/tooltip.js';
import { cn } from '../../lib/utils.js';

interface ComposerProps {
  placeholder: string;
  onSend: (text: string, mode: 'sync' | 'async') => void;
  /** Main window: voice modes, attachments and "dispatch as background task". */
  variant?: 'full' | 'compact';
  /** ADR-0013: the mic only appears when the bound provider supports realtime transcription. */
  realtimeVoice?: boolean;
  initialText?: string;
  disabled?: boolean;
}

function InertTool({ icon, label }: { icon: IconName; label: string }) {
  // Attachments and voice capture land with T24/T30; the controls keep their place in the layout.
  return (
    <Tooltip content={`${label} · 尚未提供`} side="top">
      <span
        role="button"
        aria-label={label}
        aria-disabled="true"
        tabIndex={0}
        className="flex cursor-not-allowed text-faint"
      >
        <Icon name={icon} size={16} />
      </span>
    </Tooltip>
  );
}

export function Composer({
  placeholder,
  onSend,
  variant = 'full',
  realtimeVoice = true,
  initialText = '',
  disabled = false,
}: ComposerProps) {
  const [text, setText] = useState(initialText);
  const [voiceMode, setVoiceMode] = useState<'ptt' | 'auto'>('ptt');
  const empty = text.trim().length === 0;

  const send = (mode: 'sync' | 'async') => {
    if (empty || disabled) return;
    onSend(text.trim(), mode);
    setText('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(event.metaKey || event.ctrlKey ? 'async' : 'sync');
    }
  };

  const textarea = (
    <textarea
      aria-label={placeholder}
      placeholder={placeholder}
      value={text}
      rows={1}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={onKeyDown}
      className={cn(
        'field-sizing-content max-h-[132px] min-h-[20px] w-full resize-none bg-transparent leading-[1.55] placeholder:text-faint focus:outline-none',
        variant === 'full' ? 'text-body-sm' : 'flex-1 text-body-sm',
      )}
    />
  );

  if (variant === 'compact') {
    return (
      <div className="shrink-0 border-t border-border bg-secondary px-3.5 pt-[9px] pb-[11px]">
        <div className="flex items-center gap-2.5 rounded-bubble border border-border-strong bg-background px-[11px] py-2 focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)]">
          {textarea}
          <InertTool icon="attach" label="附件" />
          {realtimeVoice ? <InertTool icon="voice" label="語音輸入" /> : null}
          <Button
            variant="primary"
            size="icon"
            className="size-7"
            aria-label="Send"
            disabled={empty || disabled}
            onClick={() => send('sync')}
          >
            <Icon name="submit" size={14} />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-t border-border bg-secondary px-3.5 pt-2.5 pb-3">
      <div className="flex flex-col gap-2 rounded-bubble border border-border-strong bg-background px-[11px] py-[9px] focus-within:border-primary focus-within:shadow-[0_0_0_3px_var(--color-primary-soft)]">
        {textarea}
        <div className="flex items-center gap-2.5">
          <InertTool icon="attach" label="附件" />
          <InertTool icon="file" label="檔案" />
          {realtimeVoice ? (
            <div
              className="flex items-center gap-1"
              role="radiogroup"
              aria-label="Voice input mode"
            >
              <button
                type="button"
                role="radio"
                aria-checked={voiceMode === 'ptt'}
                onClick={() => setVoiceMode('ptt')}
                className={cn(
                  'flex items-center gap-[5px] rounded-full px-[9px] py-1 text-caption font-semibold transition-colors duration-150',
                  voiceMode === 'ptt'
                    ? 'bg-primary-soft text-primary'
                    : 'text-faint hover:text-foreground',
                )}
              >
                <Icon name="voice" size={14} />
                Push to talk
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={voiceMode === 'auto'}
                onClick={() => setVoiceMode('auto')}
                className={cn(
                  'rounded-full px-2 py-1 text-tiny transition-colors duration-150',
                  voiceMode === 'auto'
                    ? 'bg-primary-soft font-semibold text-primary'
                    : 'text-faint hover:text-foreground',
                )}
              >
                自動分段
              </button>
            </div>
          ) : null}
          <Tooltip content="上傳音訊轉文字 · 尚未提供" side="top">
            <span
              role="button"
              aria-disabled="true"
              tabIndex={0}
              className="cursor-not-allowed text-tiny text-faint"
            >
              上傳音訊
            </span>
          </Tooltip>
          <span className="flex-1" />
          <Button
            variant="outline"
            size="md"
            disabled={empty || disabled}
            onClick={() => send('async')}
          >
            Dispatch as background task
          </Button>
          <Button
            variant="primary"
            size="icon"
            aria-label="Send"
            disabled={empty || disabled}
            onClick={() => send('sync')}
          >
            <Icon name="submit" size={15} />
          </Button>
        </div>
      </div>
      <div className="mt-1.5 text-micro text-faint">
        語音轉文字結果會先填入輸入框，確認後再送出。Enter 送出 · ⌘Enter 派發為背景任務
      </div>
    </div>
  );
}
