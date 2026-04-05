import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import ManualFlagForm from './ManualFlagForm';
import { FLAG_GROUPS, getFlagGroupId } from '@/review/flagInsights';

export default async function ReviewInboxPage({
  searchParams
}: {
  searchParams?: Promise<{ patientId?: string; issue?: string; group?: string; sort?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const patientId = resolved?.patientId;
  const issueFilter = resolved?.issue?.trim();
  const groupFilter = resolved?.group ?? 'all';
  const sortKey = resolved?.sort ?? 'recent';
  const flags = await prisma.flag.findMany({
    where: {
      status: 'OPEN',
      ...(patientId ? { patientId } : {}),
      ...(issueFilter ? { likelyIssue: issueFilter } : {})
    },
    include: { claim: { include: { patient: true } }, patient: true },
    orderBy: { lastDetectedAt: 'desc' }
  });
  const claims = await prisma.claim.findMany({ include: { patient: true } });
  const claimOptions = claims.map((claim) => ({
    id: claim.id,
    label: `${claim.patient.firstName} ${claim.patient.lastName} - ${claim.id.slice(0, 6)}`
  }));

  const groupDefinitions = [
    { id: 'all', label: 'All issues', description: 'Everything in the queue.' },
    ...FLAG_GROUPS.map((group) => ({ id: group.id, label: group.label, description: group.description })),
    { id: 'other', label: 'Other', description: 'Unclassified or custom flags.' }
  ];

  const groupCounts = groupDefinitions.reduce<Record<string, number>>((acc, group) => {
    acc[group.id] = 0;
    return acc;
  }, {});

  flags.forEach((flag) => {
    const groupId = getFlagGroupId(flag.likelyIssue);
    groupCounts[groupId] = (groupCounts[groupId] ?? 0) + 1;
    groupCounts.all += 1;
  });

  const filteredByGroup = issueFilter
    ? flags
    : groupFilter === 'all'
    ? flags
    : groupFilter === 'other'
    ? flags.filter((flag) => getFlagGroupId(flag.likelyIssue) === 'other')
    : flags.filter((flag) => getFlagGroupId(flag.likelyIssue) === groupFilter);

  const resolvePatientName = (flag: (typeof flags)[number]) => {
    if (flag.claim?.patient) {
      return `${flag.claim.patient.firstName} ${flag.claim.patient.lastName}`;
    }
    return `${flag.patient.firstName} ${flag.patient.lastName}`;
  };

  const sortedFlags = [...filteredByGroup].sort((a, b) => {
    switch (sortKey) {
      case 'oldest':
        return new Date(a.lastDetectedAt).getTime() - new Date(b.lastDetectedAt).getTime();
      case 'confidence':
        return b.confidence - a.confidence;
      case 'patient':
        return resolvePatientName(a).localeCompare(resolvePatientName(b));
      default:
        return new Date(b.lastDetectedAt).getTime() - new Date(a.lastDetectedAt).getTime();
    }
  });

  const buildUrl = (updates: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (patientId) {
      params.set('patientId', patientId);
    }
    if (sortKey) {
      params.set('sort', sortKey);
    }
    if (groupFilter && !issueFilter) {
      params.set('group', groupFilter);
    }
    if (issueFilter) {
      params.set('issue', issueFilter);
    }
    Object.entries(updates).forEach(([key, value]) => {
      if (!value) {
        params.delete(key);
        return;
      }
      params.set(key, value);
    });
    const query = params.toString();
    return query.length > 0 ? `/review?${query}` : '/review';
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title="Review Inbox"
        subtitle={
          patientId
            ? 'Open flags for the selected patient.'
            : 'Automatic and manual flags that require billing manager action.'
        }
      />

      <div
        className="grid-cards"
        style={{ gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 0.7fr)', alignItems: 'start' }}
      >
        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div className="badge">Open flags</div>
              {issueFilter ? (
                <div className="badge" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  Filter: {issueFilter}
                </div>
              ) : null}
              {issueFilter ? (
                <Link className="button secondary" href={buildUrl({ issue: undefined, group: groupFilter })}>
                  Clear filter
                </Link>
              ) : null}
            </div>
            <div className="text-muted" style={{ fontSize: 13 }}>
              {sortedFlags.length} open
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {groupDefinitions.map((group) => {
                const count = groupCounts[group.id] ?? 0;
                const isActive = group.id === groupFilter && !issueFilter;
                return (
                  <Link
                    key={group.id}
                    href={buildUrl({ group: group.id, issue: undefined })}
                    className={isActive ? 'button' : 'button secondary'}
                  >
                    {group.label} ({count})
                  </Link>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[
                { id: 'recent', label: 'Newest' },
                { id: 'oldest', label: 'Oldest' },
                { id: 'confidence', label: 'Highest confidence' },
                { id: 'patient', label: 'Patient name' }
              ].map((option) => (
                <Link
                  key={option.id}
                  href={buildUrl({ sort: option.id })}
                  className={sortKey === option.id ? 'button' : 'button secondary'}
                >
                  Sort: {option.label}
                </Link>
              ))}
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gap: 12,
              maxHeight: 420,
              overflowY: 'auto',
              paddingRight: 6
            }}
          >
            {sortedFlags.length === 0 ? (
              <div className="text-muted">
                {issueFilter ? 'No open flags match this root cause.' : 'No flags available.'}
              </div>
            ) : (
              sortedFlags.map((flag) => (
                <Link key={flag.id} href={`/review/${flag.id}`} className="card" style={{ padding: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{flag.likelyIssue}</div>
                      <div className="text-muted" style={{ fontSize: 13 }}>
                        {resolvePatientName(flag)}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        Action: {flag.recommendedAction}
                      </div>
                    </div>
                    <div className="badge">{flag.status}</div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="card" style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="badge">Manual flag</div>
            <div className="text-muted" style={{ fontSize: 13 }}>
              Add a manual item to the open flags queue for follow-up.
            </div>
          </div>
          <ManualFlagForm claimOptions={claimOptions} />
        </div>
      </div>
    </div>
  );
}

