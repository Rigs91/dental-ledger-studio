import type { ReactNode } from 'react';

export function SectionStack({ children }: { children: ReactNode }) {
  return <section className="section-stack">{children}</section>;
}
