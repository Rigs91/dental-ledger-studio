import type { ReactNode } from 'react';

type Tone = 'neutral' | 'info' | 'warn' | 'risk' | 'success';

const toneClass: Record<Tone, string> = {
  neutral: 'pill-neutral',
  info: 'pill-info',
  warn: 'pill-warn',
  risk: 'pill-risk',
  success: 'pill-success'
};

export function PillBadge({
  children,
  tone = 'neutral'
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return <span className={`pill-badge ${toneClass[tone]}`}>{children}</span>;
}
