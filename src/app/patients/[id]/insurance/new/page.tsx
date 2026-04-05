import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import InsuranceForm from '@/components/InsuranceForm';

export default async function NewInsurancePage({
  params
}: {
  params: Promise<{ id?: string }>;
}) {
  const { id } = await params;
  if (!id) {
    return <div className="card">Missing patient ID.</div>;
  }

  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) {
    return <div className="card">Patient not found.</div>;
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader title="Add insurance" subtitle={`${patient.firstName} ${patient.lastName}`} />
      <InsuranceForm mode="create" patientId={patient.id} />
    </div>
  );
}
