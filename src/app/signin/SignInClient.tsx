'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

const highlights = [
  'Ledger-backed balances',
  'Date-of-service insurance checks',
  'Claim and review timelines'
];

export default function SignInClient({ next }: { next: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'working' | 'error'>('idle');

  const signIn = async () => {
    setStatus('working');
    const response = await fetch('/api/auth/signin', { method: 'POST', credentials: 'include' });
    if (!response.ok) {
      setStatus('error');
      return;
    }
    router.push(next);
  };

  return (
    <div className="card card-glow signin-card">
      <div className="brand-lockup">
        <div className="brand-name">Dental Ledger Studio</div>
        <div className="brand-tagline">
          Deterministic billing that shows every dollar, every decision.
        </div>
      </div>
      <div className="signin-copy">
        Move from intake to claim, with a ledger-backed timeline that makes balances explainable to
        patients, payers, and your team.
      </div>
      <div className="signin-highlights">
        {highlights.map((item) => (
          <div key={item} className="pill-badge pill-info">
            {item}
          </div>
        ))}
      </div>
      <div className="signin-actions">
        <button className="button" type="button" onClick={signIn} disabled={status === 'working'}>
          {status === 'working' ? 'Signing in...' : 'Sign in'}
        </button>
        <div className="text-muted signin-note">
          Continue to your last page or return to the home workflow.
        </div>
      </div>
      {status === 'error' ? (
        <div className="text-muted">Unable to sign in. Please try again.</div>
      ) : null}
    </div>
  );
}
