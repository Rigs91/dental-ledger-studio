import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import PatientDemographicsForm from '@/components/PatientDemographicsForm';

export default async function EditPatientPage({
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
      <SectionHeader
        title="Edit patient profile"
        subtitle={`${patient.firstName} ${patient.lastName}`}
      />
      <PatientDemographicsForm
        patientId={patient.id}
        initialValues={{
          firstName: patient.firstName,
          middleName: patient.middleName,
          lastName: patient.lastName,
          phone: patient.phone,
          email: patient.email,
          addressLine1: patient.addressLine1,
          addressLine2: patient.addressLine2,
          city: patient.city,
          state: patient.state,
          postalCode: patient.postalCode,
          ssn: patient.ssn
        }}
      />
    </div>
  );
}
