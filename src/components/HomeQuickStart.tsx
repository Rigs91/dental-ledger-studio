'use client';

import { useState } from 'react';
import Link from 'next/link';

type RoleId = 'frontDesk' | 'billing' | 'leadership';

type RoleConfig = {
  id: RoleId;
  label: string;
  primary: Array<{ label: string; href: string }>;
  secondary: { label: string; href: string };
};

export default function HomeQuickStart({
  operationsHref,
  patientHref,
  reviewHref,
  billingHref,
  dashboardHref,
  analyticsHref
}: {
  operationsHref: string;
  patientHref: string;
  reviewHref: string;
  billingHref: string;
  dashboardHref: string;
  analyticsHref: string;
}) {
  const [role, setRole] = useState<RoleId>('frontDesk');

  const roles: RoleConfig[] = [
    {
      id: 'frontDesk',
      label: 'Front Desk',
      primary: [
        { label: 'Open daily operations', href: operationsHref },
        { label: 'Find patient', href: patientHref }
      ],
      secondary: { label: 'Open review inbox', href: reviewHref }
    },
    {
      id: 'billing',
      label: 'Billing',
      primary: [
        { label: 'Open billing', href: billingHref },
        { label: 'Open review inbox', href: reviewHref }
      ],
      secondary: { label: 'Find patient', href: patientHref }
    },
    {
      id: 'leadership',
      label: 'Leadership',
      primary: [
        { label: 'Open dashboard', href: dashboardHref },
        { label: 'Open review inbox', href: reviewHref }
      ],
      secondary: { label: 'Open analytics', href: analyticsHref }
    }
  ];

  const active = roles.find((item) => item.id === role) ?? roles[0];

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div className="text-muted" style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Role
        </div>
        <div
          style={{
            display: 'inline-flex',
            gap: 4,
            padding: 4,
            borderRadius: 999,
            background: 'rgba(15, 23, 42, 0.08)'
          }}
        >
          {roles.map((item) => {
            const isActive = item.id === role;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setRole(item.id)}
                style={{
                  border: 0,
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: isActive ? '#0f172a' : 'transparent',
                  color: isActive ? '#fff' : '#0f172a'
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'grid', gap: 4 }}>
          <div className="badge" style={{ textTransform: 'none', letterSpacing: '0.04em' }}>
            Quick Start
          </div>
          <div className="text-muted" style={{ fontSize: 13 }}>
            Suggested next actions for {active.label.toLowerCase()}.
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {active.primary.map((action) => (
            <Link key={action.label} className="button" href={action.href}>
              {action.label}
            </Link>
          ))}
          <Link className="button secondary" href={active.secondary.href}>
            {active.secondary.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
