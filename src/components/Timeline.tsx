import type { LedgerEvent } from '@prisma/client';
import { buildLedgerSummary, ledgerEventLabel } from '@/ledger/ledger';
import { formatCurrency, formatDate } from '@/shared/domain/format';

export function Timeline({ events }: { events: LedgerEvent[] }) {
  const summary = buildLedgerSummary(events);
  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="badge">Ledger timeline</div>
          <div className="text-muted" style={{ marginTop: 6 }}>
            Last zero balance: {summary.lastZeroAt ? formatDate(summary.lastZeroAt) : 'Not yet reached'}
          </div>
        </div>
        <div className="section-title" style={{ fontSize: 22 }}>
          {formatCurrency(summary.currentBalance)}
        </div>
      </div>
      <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
        {summary.timeline.map((entry) => {
          const metadata = entry.event.metadata as Record<string, unknown> | null;
          return (
            <div
              key={entry.event.id}
              className="card"
              style={{ padding: 14, borderRadius: 16, border: '1px dashed rgba(15, 23, 42, 0.15)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{ledgerEventLabel(entry.event.type)}</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>
                    {formatDate(entry.event.occurredAt)}
                  </div>
                  {metadata ? (
                    <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                      {Object.entries(metadata)
                        .map(([key, value]) => {
                          const display =
                            value && typeof value === 'object' ? JSON.stringify(value) : String(value);
                          return `${key}: ${display}`;
                        })
                        .join(' - ')}
                    </div>
                  ) : null}
                  {entry.isLastZero ? (
                    <div className="badge" style={{ marginTop: 8, background: 'rgba(45, 212, 191, 0.2)' }}>
                      Last zero balance
                    </div>
                  ) : null}
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>
                    {formatCurrency(Number(entry.event.amount.toString()))}
                  </div>
                  <div className="text-muted" style={{ fontSize: 12 }}>
                    Running: {formatCurrency(entry.runningBalance)}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

