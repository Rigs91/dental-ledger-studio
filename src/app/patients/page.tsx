import Link from 'next/link';
import { prisma } from '@/shared/domain/db';
import { SectionHeader } from '@/components/StatCard';
import { formatDate } from '@/shared/domain/format';
import { parseFlexibleDate } from '@/shared/validation/date';

export default async function PatientSearchPage({
  searchParams
}: {
  searchParams?: Promise<{ q?: string; dob?: string }>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const query = resolved?.q?.trim() ?? '';
  const dobQuery = resolved?.dob?.trim() ?? '';

  let patients = [] as { id: string; firstName: string; lastName: string; dob: Date }[];
  let error: string | null = null;
  if (query || dobQuery) {
    let dobFilter: { gte: Date; lt: Date } | undefined;
    if (dobQuery) {
      const parsed = parseFlexibleDate(dobQuery, { allowAmbiguous: true });
      if (!parsed.date) {
        error = parsed.error ?? 'Invalid date of birth.';
      } else {
        const start = new Date(
          Date.UTC(parsed.date.getUTCFullYear(), parsed.date.getUTCMonth(), parsed.date.getUTCDate())
        );
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        dobFilter = { gte: start, lt: end };
      }
    }

    if (!error) {
      const basePatients = await prisma.patient.findMany({
        where: dobFilter ? { dob: dobFilter } : undefined,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
      });

      if (!query) {
        patients = basePatients;
      } else {
        const normalizedQuery = query.toLowerCase();
        const nameParts = normalizedQuery.split(/\s+/).filter(Boolean);
        patients = basePatients.filter((patient) => {
          const firstName = patient.firstName.toLowerCase();
          const lastName = patient.lastName.toLowerCase();
          const fullName = `${firstName} ${lastName}`;
          if (nameParts.length > 1) {
            const first = nameParts[0];
            const last = nameParts.slice(1).join(' ');
            if (firstName.includes(first) && lastName.includes(last)) {
              return true;
            }
          }
          return (
            fullName.includes(normalizedQuery) ||
            firstName.includes(normalizedQuery) ||
            lastName.includes(normalizedQuery)
          );
        });
      }
    }
  }

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <SectionHeader
        title="Patient Search"
        subtitle="Search by name and date of birth to locate a patient record."
        action={
          <Link className="button secondary" href="/patients/new">
            New patient
          </Link>
        }
      />

      <form className="card" action="/patients" method="get" style={{ display: 'grid', gap: 12 }}>
        <label>
          <div className="text-muted" style={{ marginBottom: 6 }}>
            Patient name
          </div>
          <input className="input" name="q" placeholder="Maria Chen" defaultValue={query} />
        </label>
        <label>
          <div className="text-muted" style={{ marginBottom: 6 }}>
            Date of birth (any format)
          </div>
          <input className="input" name="dob" placeholder="04/12/1985" defaultValue={dobQuery} />
        </label>
        <button className="button" type="submit">
          Search patients
        </button>
      </form>

      {query || dobQuery ? (
        <div className="grid-cards">
          {error ? (
            <div className="card">{error}</div>
          ) : patients.length === 0 ? (
            <div className="card">No patients matched that search. Try a partial name.</div>
          ) : (
            patients.map((patient) => (
              <Link key={patient.id} href={`/patients/${patient.id}`} className="card">
                <div style={{ fontWeight: 600 }}>{`${patient.firstName} ${patient.lastName}`}</div>
                <div className="text-muted" style={{ marginTop: 6 }}>
                  DOB: {formatDate(patient.dob)}
                </div>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

