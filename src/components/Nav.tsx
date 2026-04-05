'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const pathname = usePathname();
  if (pathname === '/signin') {
    return null;
  }

  const links = [
    { href: '/', label: 'Home' },
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/operations', label: 'Daily Operations' },
    { href: '/intake', label: 'Intake' },
    { href: '/patients', label: 'Patients' },
    { href: '/billing', label: 'Billing' },
    { href: '/review', label: 'Review' },
    { href: '/analytics', label: 'Analytics' },
    { href: '/signin', label: 'Sign in' }
  ];

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/';
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  return (
    <nav className="nav">
      <Link href="/" className="nav-brand">
        <div className="brand-name">Dental Ledger Studio</div>
        <div className="brand-tagline">Deterministic billing that shows every dollar, every decision.</div>
      </Link>
      <div className="nav-links">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={isActive(link.href) ? 'nav-link active' : 'nav-link'}
            aria-current={isActive(link.href) ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
