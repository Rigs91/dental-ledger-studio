import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import InsuranceForm from '@/components/InsuranceForm';

function toDateInput(date: Date | null) {
  if (!date) {
    return '';
  }
  return date.toISOString().slice(0, 10);
}

export default async function EditInsurancePage({
  params
}: {
  params: Promise<{ id?: string; policyId?: string }>;
}) {
  const { id, policyId } = await params;
  if (!id || !policyId) {
    return <div className="card">Missing patient or policy ID.</div>;
  }

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) {
    return <div className="card">Patient not found.</div>;
  }

  const policy = await prisma.insurancePolicy.findUnique({ where: { id: policyId } });
  if (!policy || policy.patientId !== patient.id) {
    return <div className="card">Policy not found for this patient.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title="Edit insurance"
        subtitle={`${patient.firstName} ${patient.lastName} | ${policy.payerName}`}
      />
      <InsuranceForm
        mode="edit"
        patientId={patient.id}
        policyId={policy.id}
        initialValues={{
          payerName: policy.payerName,
          memberId: policy.memberId,
          groupId: policy.groupId ?? '',
          subscriberName: policy.subscriberName ?? '',
          employerName: policy.employerName ?? '',
          priority: policy.priority,
          effectiveStart: toDateInput(policy.effectiveStart),
          effectiveEnd: toDateInput(policy.effectiveEnd),
          lastVerifiedAt: toDateInput(policy.lastVerifiedAt),
          copayAmount: policy.copayAmount ? policy.copayAmount.toString() : ''
        }}
      />
    </div>
  );
}
