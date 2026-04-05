import type { ReactNode } from 'react';

export function InfoCard({
  title,
  subtitle,
  badge,
  actions,
  children
}: {
  title?: string;
  subtitle?: string;
  badge?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="card info-card">
      {badge ? <div>{badge}</div> : null}
      {(title || subtitle || actions) && (
        <div className="info-card-header">
          <div className="info-card-title-wrap">
            {title ? <h3 className="info-card-title">{title}</h3> : null}
            {subtitle ? <p className="text-muted info-card-subtitle">{subtitle}</p> : null}
          </div>
          {actions ? <div className="info-card-actions">{actions}</div> : null}
        </div>
      )}
      <div className="info-card-content">{children}</div>
    </article>
  );
}
