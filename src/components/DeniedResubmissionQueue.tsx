'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/shared/domain/format';
import { PillBadge } from '@/components/ui/PillBadge';

export type DeniedClaimSummary = {
  id: string;
  patientId: string;
  patientName: string;
  dateOfService: string;
  balance: number;
  denialReason: string;
  denialCode?: string | null;
  lastSubmissionAt: string | null;
  submissionCount: number;
  snapshotLabel: string | null;
  memberId?: string | null;
  hasSnapshot: boolean;
};

type FilterMode = 'all' | 'ready' | 'needs-policy';

const resolveFilter = (value?: string | null): FilterMode => {
  if (value === 'ready') return 'ready';
  if (value === 'needs-policy') return 'needs-policy';
  return 'all';
};

export default function DeniedResubmissionQueue({
  claims,
  initialFilter
}: {
  claims: DeniedClaimSummary[];
  initialFilter?: string | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterMode>(resolveFilter(initialFilter));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [results, setResults] = useState<Record<string, 'pending' | 'ok' | 'error'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const claimById = useMemo(() => new Map(claims.map((claim) => [claim.id, claim])), [claims]);
  const readyClaims = useMemo(() => claims.filter((claim) => claim.hasSnapshot), [claims]);
  const needsPolicyClaims = useMemo(() => claims.filter((claim) => !claim.hasSnapshot), [claims]);
  const readyClaimIdSet = useMemo(() => new Set(readyClaims.map((claim) => claim.id)), [readyClaims]);

  const visibleClaims = useMemo(() => {
    if (filter === 'ready') {
      return readyClaims;
    }
    if (filter === 'needs-policy') {
      return needsPolicyClaims;
    }
    return claims;
  }, [claims, filter, readyClaims, needsPolicyClaims]);

  const selectedReadyIds = useMemo(
    () => selectedIds.filter((id) => readyClaimIdSet.has(id)),
    [selectedIds, readyClaimIdSet]
  );
  const selectedClaims = useMemo(
    () =>
      selectedIds
        .map((id) => claimById.get(id))
        .filter((claim): claim is DeniedClaimSummary => Boolean(claim)),
    [claimById, selectedIds]
  );
  const selectedReadyClaims = useMemo(
    () => selectedClaims.filter((claim) => claim.hasSnapshot),
    [selectedClaims]
  );
  const selectedBalance = useMemo(
    () => selectedReadyClaims.reduce((total, claim) => total + claim.balance, 0),
    [selectedReadyClaims]
  );

  const toggleSelection = (claimId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(claimId)) {
        next.delete(claimId);
      } else {
        next.add(claimId);
      }
      return Array.from(next);
    });
  };

  const selectAllReady = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      readyClaims.forEach((claim) => next.add(claim.id));
      return Array.from(next);
    });
  };

  const clearSelection = () => {
    setSelectedIds([]);
    setResults({});
    setErrors({});
  };

  const submitClaims = async (claimIds: string[], contextLabel: string) => {
    if (claimIds.length === 0) {
      setStatus(`Select at least one denied claim that is ready for resubmission (${contextLabel}).`);
      return;
    }
    if (reason.trim().length < 5) {
      setStatus('Enter a resubmission reason (at least 5 characters).');
      return;
    }

    setWorking(true);
    setStatus(null);
    setResults((prev) => ({ ...prev }));
    setErrors((prev) => ({ ...prev }));

    let successCount = 0;
    let failureCount = 0;

    for (let index = 0; index < claimIds.length; index += 1) {
      const claimId = claimIds[index];
      setResults((prev) => ({ ...prev, [claimId]: 'pending' }));
      try {
        const response = await fetch('/api/claims/resubmit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            claimId,
            reason: reason.trim(),
            useOriginalSnapshot: true
          })
        });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          const message = data.error ?? 'Unable to resubmit claim.';
          setResults((prev) => ({ ...prev, [claimId]: 'error' }));
          setErrors((prev) => ({ ...prev, [claimId]: message }));
          failureCount += 1;
        } else {
          setResults((prev) => ({ ...prev, [claimId]: 'ok' }));
          successCount += 1;
        }
      } catch (error) {
        setResults((prev) => ({ ...prev, [claimId]: 'error' }));
        setErrors((prev) => ({
          ...prev,
          [claimId]: error instanceof Error ? error.message : 'Unexpected error during resubmission.'
        }));
        failureCount += 1;
      }
    }

    setWorking(false);
    setStatus(
      failureCount === 0
        ? `Resubmitted ${successCount} claim(s).`
        : `Resubmitted ${successCount} claim(s); ${failureCount} failed. Review errors below.`
    );

    if (successCount > 0) {
      router.refresh();
    }
  };

  const resubmitSelected = () => submitClaims(selectedReadyIds, 'bulk');
  const resubmitSingle = (claimId: string) => submitClaims([claimId], 'single');

  return (
    <div
      className="grid-cards"
      style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 0.65fr)', alignItems: 'start' }}
    >
      <div className="card" style={{ display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <PillBadge tone="warn">Denied claims queue</PillBadge>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {visibleClaims.length} shown
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="button secondary"
              type="button"
              onClick={selectAllReady}
              disabled={readyClaims.length === 0}
            >
              Select all ready
            </button>
            <button className="button secondary" type="button" onClick={clearSelection}>
              Clear selection
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[
            { id: 'all', label: 'All denied', count: claims.length },
            { id: 'ready', label: 'Ready to resubmit', count: readyClaims.length },
            { id: 'needs-policy', label: 'Needs policy review', count: needsPolicyClaims.length }
          ].map((option) => (
            <button
              key={option.id}
              type="button"
              className={filter === option.id ? 'button' : 'button secondary'}
              onClick={() => setFilter(option.id as FilterMode)}
            >
              {option.label} ({option.count})
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 12, maxHeight: 520, overflowY: 'auto', paddingRight: 6 }}>
          {visibleClaims.length === 0 ? (
            <div className="text-muted">No denied claims match this filter.</div>
          ) : (
            visibleClaims.map((claim) => {
              const isSelected = selectedIds.includes(claim.id);
              const result = results[claim.id];
              const statusLabel = claim.hasSnapshot ? 'Ready' : 'Needs policy';
              const statusTone = claim.hasSnapshot ? 'success' : 'warn';
              return (
                <div
                  key={claim.id}
                  className="card"
                  style={{
                    padding: 12,
                    border: isSelected ? '2px solid #0f172a' : '1px solid rgba(15, 23, 42, 0.08)',
                    background: isSelected ? 'rgba(15, 23, 42, 0.04)' : undefined
                  }}
                >
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(claim.id)}
                      disabled={!claim.hasSnapshot}
                      aria-label={`Select claim ${claim.id}`}
                    />
                    <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                          <div style={{ fontWeight: 600 }}>{claim.patientName}</div>
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            DOS {claim.dateOfService} | Claim {claim.id.slice(0, 6)}
                          </div>
                          <div className="text-muted" style={{ fontSize: 12 }}>
                            {claim.snapshotLabel ?? 'No insurance snapshot on file'}
                            {claim.memberId ? ` | Member ${claim.memberId}` : ''}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: 600 }}>{formatCurrency(claim.balance)}</div>
                          <PillBadge tone={statusTone}>{statusLabel}</PillBadge>
                        </div>
                      </div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Denial: {claim.denialReason}
                        {claim.denialCode ? ` (${claim.denialCode})` : ''}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        {claim.lastSubmissionAt ? `Last submitted ${claim.lastSubmissionAt}` : 'No submissions recorded'}
                        {claim.submissionCount > 1 ? ` | Resubmissions ${claim.submissionCount - 1}` : ''}
                      </div>
                      {result === 'pending' ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Resubmitting...
                        </div>
                      ) : result === 'ok' ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Resubmitted successfully.
                        </div>
                      ) : result === 'error' && errors[claim.id] ? (
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          Error: {errors[claim.id]}
                        </div>
                      ) : null}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        <Link className="button secondary" href={`/billing/${claim.id}`}>
                          Review claim
                        </Link>
                        <Link className="button secondary" href={`/patients/${claim.patientId}`}>
                          Patient profile
                        </Link>
                        {claim.hasSnapshot ? (
                          <button
                            className="button"
                            type="button"
                            onClick={() => resubmitSingle(claim.id)}
                            disabled={working || reason.trim().length < 5}
                          >
                            Resubmit now
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <PillBadge tone="info">Bulk resubmission</PillBadge>
            <div className="text-muted" style={{ fontSize: 13 }}>
              Bulk resubmission uses each claim&apos;s original insurance snapshot. Claims without a snapshot require manual review.
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Selected ready claims: {selectedReadyIds.length}
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Ready: {readyClaims.length} | Needs policy review: {needsPolicyClaims.length}
            </div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Selected balance: {formatCurrency(selectedBalance)}
            </div>
          </div>
          <label>
            <div className="text-muted" style={{ marginBottom: 6 }}>
              Resubmission reason
            </div>
            <textarea
              className="input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Example: Denial corrected after documentation update. Resubmitting with original snapshot."
            />
          </label>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Selected claims (ready only):
            </div>
            {selectedReadyClaims.length === 0 ? (
              <div className="text-muted" style={{ fontSize: 12 }}>
                No ready claims selected yet.
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 8, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                {selectedReadyClaims.map((claim) => (
                  <div key={claim.id} className="card" style={{ padding: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{claim.patientName}</div>
                        <div className="text-muted" style={{ fontSize: 12 }}>
                          DOS {claim.dateOfService} | Claim {claim.id.slice(0, 6)}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 600 }}>{formatCurrency(claim.balance)}</div>
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => toggleSelection(claim.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="button"
            type="button"
            onClick={resubmitSelected}
            disabled={working || selectedReadyIds.length === 0 || reason.trim().length < 5}
          >
            {working ? 'Resubmitting...' : 'Resubmit selected claims'}
          </button>
          {status ? <div className="text-muted">{status}</div> : null}
        </div>
    </div>
  );
}
