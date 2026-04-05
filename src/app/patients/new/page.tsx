import { SectionHeader } from '@/components/StatCard';
import NewPatientForm from '@/components/NewPatientForm';

export default function NewPatientPage() {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title="New patient"
        subtitle="Create a patient record before scheduling visits or adding insurance."
      />
      <NewPatientForm />
    </div>
  );
}
