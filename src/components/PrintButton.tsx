'use client';

export default function PrintButton({ label = 'Print document' }: { label?: string }) {
  return (
    <button className="button secondary" type="button" onClick={() => window.print()}>
      {label}
    </button>
  );
}
