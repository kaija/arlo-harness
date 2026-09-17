import type { ReactNode } from 'react';
import { Icon } from '../../components/icon.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '../../components/ui/dialog.js';
import { useTranslation } from '../../i18n.js';

/** Settings open as a large sheet over whichever window asked for them. */
export function SettingsShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(740px,calc(100vh-48px))] w-[min(1000px,calc(100vw-32px))] flex-col">
        <div className="flex h-[34px] shrink-0 items-center gap-2 border-b border-border bg-secondary px-3">
          <DialogTitle className="truncate text-label font-semibold text-muted-foreground">
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">{description}</DialogDescription>
          <span className="flex-1" />
          <button
            type="button"
            aria-label={t('settings.close')}
            onClick={onClose}
            className="flex text-faint hover:text-foreground"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}
