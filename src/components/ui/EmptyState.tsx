import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  actions
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      {description ? <div className="text-muted">{description}</div> : null}
      {actions ? <div className="action-bar">{actions}</div> : null}
    </div>
  );
}
