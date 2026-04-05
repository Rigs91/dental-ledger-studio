import type { ReactNode, CSSProperties } from 'react';
import Link from 'next/link';

export function StatCard({
  title,
  value,
  description,
  accent,
  trend,
  href,
  highlight,
  scroll
}: {
  title: string;
  value: string;
  description?: string;
  accent?: string;
  trend?: {
    label: string;
    tone?: 'positive' | 'negative' | 'neutral';
  };
  href?: string;
  highlight?: boolean;
  scroll?: boolean;
}) {
  const trendTone = trend?.tone ?? 'neutral';
  const trendColor =
    trendTone === 'positive' ? '#0d9488' : trendTone === 'negative' ? '#f97316' : '#64748b';
  const accentStripe = accent
    ? {
        backgroundImage: `linear-gradient(${accent}, ${accent})`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'top left',
        backgroundSize: '100% 4px'
      }
    : {};
  const baseShadow = '0 18px 40px -24px rgba(15, 23, 42, 0.35)';
  const highlightShadow = highlight ? '0 18px 35px -22px rgba(13, 148, 136, 0.45)' : '';
  const combinedShadow = [baseShadow, highlightShadow].filter(Boolean).join(', ');
  const cardStyle: CSSProperties = {
    ...accentStripe,
    outline: highlight ? '2px solid rgba(13, 148, 136, 0.6)' : undefined,
    outlineOffset: highlight ? 2 : undefined,
    boxShadow: combinedShadow,
    cursor: href ? 'pointer' : undefined
  };
  const content = (
    <div className="card card-glow" style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
        <div className="text-muted" style={{ fontSize: 13, letterSpacing: '0.08em' }}>
          {title}
        </div>
        {trend ? (
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 999,
              background: `${trendColor}1a`,
              color: trendColor
            }}
          >
            {trend.label}
          </div>
        ) : null}
      </div>
      <div className="section-title" style={{ fontSize: 28, marginTop: 10 }}>
        {value}
      </div>
      {description ? (
        <div className="text-muted" style={{ marginTop: 8, fontSize: 14 }}>
          {description}
        </div>
      ) : null}
    </div>
  );
  if (href) {
    return (
      <Link href={href} scroll={scroll} style={{ display: 'block' }}>
        {content}
      </Link>
    );
  }
  return content;
}

export function SectionHeader({
  title,
  subtitle,
  action
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <h2 className="section-title" style={{ fontSize: 24, margin: 0 }}>
          {title}
        </h2>
        {subtitle ? (
          <div className="text-muted" style={{ marginTop: 6, fontSize: 14 }}>
            {subtitle}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  );
}
