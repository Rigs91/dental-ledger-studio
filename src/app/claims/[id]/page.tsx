import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import PrintButton from '@/components/PrintButton';
import { formatDate } from '@/shared/domain/format';

export default async function ClaimPacketPage({
  params,
  searchParams
}: {
  params: Promise<{ id?: string }>;
  searchParams?: Promise<{ type?: string; packetId?: string }>;
}) {
  const { id } = await params;
  const resolvedSearch = searchParams ? await searchParams : undefined;
  if (!id) {
    return <div className="card">Missing claim ID. Return to billing timeline.</div>;
  }
  const claim = await prisma.claim.findUnique({
    where: { id },
    include: {
      packets: true,
      patient: true,
      visit: true,
      ledger: true,
      explanations: { orderBy: { createdAt: 'desc' } }
    }
  });

  if (!claim) {
    return <div className="card">Claim not found.</div>;
  }

  const requestedType = resolvedSearch?.type?.toUpperCase();
  const type = requestedType === 'PATIENT' ? 'PATIENT' : 'PAYER';
  const requestedPacketId = resolvedSearch?.packetId;
  const storedPacket = requestedPacketId
    ? claim.packets.find((entry) => entry.id === requestedPacketId)
    : [...claim.packets]
        .filter((entry) => entry.type === type)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
  const packet = storedPacket ? { html: storedPacket.html } : null;

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title={type === 'PATIENT' ? 'Patient Statement' : 'Payer Claim Packet'}
        subtitle={`Claim ${claim.id} - ${claim.patient.firstName} ${claim.patient.lastName}`}
        action={
          <div style={{ display: 'flex', gap: 12 }}>
            <Link className="button secondary" href={`/billing/${claim.id}`}>
              Back to billing timeline
            </Link>
            <PrintButton />
          </div>
        }
      />

      <div className="grid-cards">
        <div className="card">
          <div className="badge">Document controls</div>
          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            <div className="text-muted">Generated: {formatDate(claim.createdAt)}</div>
            <div style={{ display: 'flex', gap: 12 }}>
              <Link className="button secondary" href={`/claims/${claim.id}?type=PAYER`}>
                View payer packet
              </Link>
              <Link className="button secondary" href={`/claims/${claim.id}?type=PATIENT`}>
                View patient statement
              </Link>
            </div>
            <div className="text-muted">
              Packet content is displayed from the stored claim packet artifact.
            </div>
          </div>
        </div>

        <div className="card claim-document">
          {packet ? (
            <div
              dangerouslySetInnerHTML={{
                __html: packet.html
              }}
            />
          ) : (
            <div className="text-muted">
              No stored packet found for this claim. Generate a packet from billing to view it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
