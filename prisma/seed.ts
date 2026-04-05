import {
  PrismaClient,
  ClaimStatus,
  ClaimPacketType,
  InsurancePriority,
  LedgerEventType,
  FlagSource,
  FlagStatus,
  ExplanationStatus,
  AppointmentStatus
} from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { Decimal } from '@prisma/client/runtime/library';
import { buildPayerPacket, buildPatientStatement, type InsuranceSnapshot } from '../src/documents/claimPackets';
import { draftBalanceExplanation } from '../src/claims/rules/explanation';
import { selectInsurance } from '../src/insurance/insurance';
import { detectFlags } from '../src/review/flags';

const prisma = new PrismaClient();

type ProcedureSeed = {
  category: string;
  code: string;
  description: string;
  estimatedFeeMin: number;
  estimatedFeeMax: number;
  notes: string;
  patientDescription: string;
};

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  const nextNonSpaceIndex = (start: number) => {
    for (let i = start; i < line.length; i += 1) {
      if (line[i] !== ' ') {
        return i;
      }
    }
    return line.length;
  };
  const hasClosingQuote = (start: number) => {
    for (let i = start; i < line.length; i += 1) {
      if (line[i] !== '"') {
        continue;
      }
      if (line[i + 1] === '"') {
        i += 1;
        continue;
      }
      const nextIndex = nextNonSpaceIndex(i + 1);
      if (nextIndex === line.length || line[nextIndex] === ',') {
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (!inQuotes) {
        const canStartQuoted = current.trim().length === 0 && hasClosingQuote(i + 1);
        if (canStartQuoted) {
          inQuotes = true;
          continue;
        }
        current += '"';
        continue;
      }
      if (line[i + 1] === '"') {
        current += '"';
        i += 1;
        continue;
      }
      const nextIndex = nextNonSpaceIndex(i + 1);
      if (nextIndex === line.length || line[nextIndex] === ',') {
        inQuotes = false;
        continue;
      }
      current += '"';
      continue;
    } else if (char === ',' && !inQuotes) {
      values.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

function parseFeeRange(value: string): { min: number; max: number } {
  const cleaned = value.replace(/\$/g, '').replace(/,/g, '').trim();
  const parts = cleaned.split(/\s*-\s*/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error('Empty fee range.');
  }
  const min = Number(parts[0]);
  const max = Number(parts.length > 1 ? parts[1] : parts[0]);
  if (Number.isNaN(min) || Number.isNaN(max)) {
    throw new Error(`Invalid fee range: ${value}`);
  }
  if (min > max) {
    throw new Error(`Fee range reversed: ${value}`);
  }
  return { min, max };
}

function loadProcedureSeed(): ProcedureSeed[] {
  const filePath = path.join(process.cwd(), 'prisma', 'data', 'procedures-and-codes.txt');
  if (!fs.existsSync(filePath)) {
    throw new Error('Procedure catalog source file not found at prisma/data/procedures-and-codes.txt.');
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length <= 1) {
    throw new Error('Procedure catalog source file is empty.');
  }
  const rows = lines.slice(1);
  return rows.map((line, index) => {
    const columns = parseCsvLine(line);
    if (columns.length > 6) {
      const feeCandidate = columns[3]?.trim();
      const extraPiece = columns[4]?.trim();
      if (feeCandidate && extraPiece) {
        const looksLikeTruncatedFee = /-\s*\$\d{1,3}$/.test(feeCandidate);
        const looksLikeThousands = /^\d{3}$/.test(extraPiece);
        if (looksLikeTruncatedFee && looksLikeThousands) {
          columns.splice(3, 2, `${feeCandidate},${extraPiece}`);
        }
      }
    }
    if (columns.length < 6) {
      throw new Error(`Malformed procedure row at line ${index + 2}.`);
    }
    const normalizedColumns =
      columns.length === 6
        ? columns
        : (() => {
            const [category, code, description, feeRange, ...tail] = columns;
            const combined = tail.join(',');
            const lastCommaIndex = combined.lastIndexOf(',');
            if (lastCommaIndex === -1) {
              return [category, code, description, feeRange, combined.trim(), ''];
            }
            return [
              category,
              code,
              description,
              feeRange,
              combined.slice(0, lastCommaIndex).trim(),
              combined.slice(lastCommaIndex + 1).trim()
            ];
          })();
    const [category, code, description, feeRange, notes, patientDescription] = normalizedColumns;
    const fee = parseFeeRange(feeRange);
    return {
      category: category.trim(),
      code: code.trim(),
      description: description.trim(),
      estimatedFeeMin: fee.min,
      estimatedFeeMax: fee.max,
      notes: notes.trim(),
      patientDescription: patientDescription.trim()
    };
  });
}

const insurers = ['Blue Dental', 'Sunrise Dental', 'SmilePlus', 'Guardian', 'United Dental', 'CareFirst', 'Delta Prime'];
const firstNames = ['Maria', 'Devon', 'Alex', 'Jordan', 'Sam', 'Taylor', 'Chris', 'Jamie', 'Morgan', 'Riley', 'Avery', 'Quinn', 'Parker', 'Drew', 'Casey', 'Robin', 'Shawn', 'Kelsey', 'Logan', 'Harper'];
const middleNames = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const lastNames = ['Chen', 'Patel', 'Nguyen', 'Garcia', 'Lee', 'Johnson', 'Rivera', 'Kim', 'Singh', 'Martinez', 'Brown', 'Davis', 'Hernandez', 'Lopez', 'Wilson', 'Clark', 'Lewis', 'Young', 'Hall', 'Allen'];
const streets = ['Pine', 'Maple', 'Cedar', 'Oak', 'Sunset', 'Willow', 'Lakeview', 'Hillcrest', 'Park', 'Ridge'];
const cities = ['Seattle', 'Bellevue', 'Tacoma', 'Redmond', 'Everett', 'Kirkland'];
const states = ['WA'];
const denialReasons = [
  'Coverage inactive on date of service.',
  'Missing tooth number or surface information.',
  'Procedure not covered under plan benefits.',
  'Duplicate claim detected by payer.',
  'Frequency limitation exceeded.'
];
const approvalReasons = [
  'Paid as billed by payer.',
  'Allowed amount applied with contractual adjustment.',
  'Covered after deductible applied.',
  'Covered at alternate benefit level.'
];

const rng = (() => {
  let seed = 42;
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
})();

const roundCents = (value: number) => Math.round(value * 100) / 100;
const toDecimal = (value: number) => new Decimal(roundCents(value).toFixed(2));
const randomCopayAmount = () => {
  if (rng() < 0.25) {
    return null;
  }
  return toDecimal(randomBetween(15, 55));
};

const COPAY_BASIS =
  'Estimated patient responsibility using typical dental plan coverage: Diagnostic/Preventive ~100% covered, Basic ~80%, Major ~50%. Actual copays vary by plan.';

const MAJOR_KEYWORDS = [
  'crown',
  'veneer',
  'denture',
  'bridge',
  'implant',
  'abutment',
  'occlusal guard',
  'night guard',
  'core buildup'
];

function copayRateForEntry(entry: ProcedureSeed): number {
  const category = entry.category.trim().toLowerCase();
  if (category === 'diagnostic' || category === 'preventive') {
    return 0;
  }

  if (category === 'prosthodontics' || category === 'implants') {
    return 0.5;
  }

  const description = entry.description.toLowerCase();
  if (MAJOR_KEYWORDS.some((keyword) => description.includes(keyword))) {
    return 0.5;
  }

  if (
    category === 'restorative' ||
    category === 'endodontics' ||
    category === 'periodontics' ||
    category === 'oral surgery' ||
    category === 'adjunctive'
  ) {
    return 0.2;
  }

  return 0.2;
}

const procedureSeed = loadProcedureSeed();
const seenCodes = new Set<string>();
for (const entry of procedureSeed) {
  if (seenCodes.has(entry.code)) {
    throw new Error(`Duplicate CDT code in procedure catalog: ${entry.code}`);
  }
  seenCodes.add(entry.code);
}
const feeScheduleSeed = procedureSeed.map((entry) => ({
  code: entry.code,
  label: entry.description,
  amount: roundCents((entry.estimatedFeeMin + entry.estimatedFeeMax) / 2)
}));
const procedureCatalog = procedureSeed.map((entry) => ({
  code: entry.code,
  label: entry.description,
  text: entry.patientDescription || entry.notes || entry.description
}));

function pick<T>(items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function randomBetween(min: number, max: number) {
  return min + rng() * (max - min);
}

function day(date: Date | string) {
  const base = typeof date === 'string' ? new Date(date) : new Date(date.getTime());
  base.setUTCHours(9, 0, 0, 0);
  return base;
}

function addDays(base: Date, days: number) {
  const value = new Date(base.getTime());
  value.setUTCDate(value.getUTCDate() + days);
  return day(value);
}

function addHours(base: Date, hours: number) {
  const value = new Date(base.getTime());
  value.setUTCHours(base.getUTCHours() + hours, 0, 0, 0);
  return value;
}

function randomDateBetween(start: Date, end: Date) {
  const time = start.getTime() + rng() * (end.getTime() - start.getTime());
  return day(new Date(time));
}

function buildPlannedProcedures(count: number) {
  const items: string[] = [];
  for (let i = 0; i < count; i += 1) {
    items.push(pick(procedureCatalog).text);
  }
  return {
    rawText: items.join(', '),
    items
  };
}

async function seed() {
  await prisma.flag.deleteMany();
  await prisma.explanationDraft.deleteMany();
  await prisma.claimSubmission.deleteMany();
  await prisma.claimPacket.deleteMany();
  await prisma.claimDecision.deleteMany();
  await prisma.ledgerEvent.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.procedureRecord.deleteMany();
  await prisma.visit.deleteMany();
  await prisma.appointment.deleteMany();
  await prisma.patientActivityEvent.deleteMany();
  await prisma.insuranceOverride.deleteMany();
  await prisma.insurancePolicy.deleteMany();
  await prisma.patient.deleteMany();
  await prisma.procedureCatalog.deleteMany();
  await prisma.feeSchedule.deleteMany();
  await prisma.user.deleteMany();

  await prisma.user.createMany({
    data: [
      { name: 'Alex Morgan', role: 'RECEPTIONIST' },
      { name: 'Jordan Lee', role: 'BILLING_MANAGER' },
      { name: 'Dr. Sam Rivera', role: 'DENTIST' }
    ]
  });

  await prisma.procedureCatalog.createMany({
    data: procedureSeed.map((entry) => ({
      code: entry.code,
      category: entry.category,
      description: entry.description,
      notes: entry.notes.length > 0 ? entry.notes : null,
      patientDescription: entry.patientDescription.length > 0 ? entry.patientDescription : null,
      estimatedFeeMin: toDecimal(entry.estimatedFeeMin),
      estimatedFeeMax: toDecimal(entry.estimatedFeeMax),
      estimatedCopayAvg: toDecimal(
        ((entry.estimatedFeeMin + entry.estimatedFeeMax) / 2) * copayRateForEntry(entry)
      ),
      copayRate: copayRateForEntry(entry),
      copayBasis: COPAY_BASIS
    }))
  });

  for (const fee of feeScheduleSeed) {
    await prisma.feeSchedule.create({
      data: {
        code: fee.code,
        label: fee.label,
        amount: new Decimal(fee.amount.toFixed(2)),
        effectiveStart: day('2025-01-01')
      }
    });
  }

  const feeMap = new Map(feeScheduleSeed.map((fee) => [fee.code, fee]));
  const today = day('2026-01-28');
  const pastStart = day('2025-07-01');
  const pastEnd = day('2026-01-10');
  const futureEnd = day('2026-03-15');

  for (let index = 0; index < 100; index += 1) {
    const firstName = firstNames[index % firstNames.length];
    const middleName = rng() > 0.55 ? pick(middleNames) : null;
    const lastName = `${lastNames[index % lastNames.length]} ${index + 1}`;
    const dobYear = Math.floor(randomBetween(1950, 2015));
    const dobMonth = Math.floor(randomBetween(1, 13));
    const dobDay = Math.floor(randomBetween(1, 28));
    const dob = day(`${dobYear}-${String(dobMonth).padStart(2, '0')}-${String(dobDay).padStart(2, '0')}`);

    const patient = await prisma.patient.create({
      data: {
        firstName,
        middleName,
        lastName,
        dob,
        phone: `(206) 555-${String(1000 + index).padStart(4, '0')}`,
        email: `${firstName.toLowerCase()}.${lastName.replace(/\s+/g, '').toLowerCase()}${index}@example.com`,
        addressLine1: `${100 + index} ${pick(streets)} St`,
        addressLine2: index % 5 === 0 ? `Unit ${index % 12 + 1}` : null,
        city: pick(cities),
        state: pick(states),
        postalCode: `98${String(100 + index).padStart(3, '0')}`,
        ssn: `${900000000 + index}`
      }
    });

    const policies: { id: string; priority: InsurancePriority; payerName: string; effectiveStart: Date; effectiveEnd: Date | null }[] = [];

    const insuranceRoll = rng();
    if (insuranceRoll >= 0.2) {
      const primaryStart = day('2025-01-01');
      const primaryEnd = rng() > 0.7 ? day('2026-12-31') : null;
      const primary = await prisma.insurancePolicy.create({
        data: {
          patientId: patient.id,
          payerName: pick(insurers),
          memberId: `M-${index}-${Math.floor(randomBetween(1000, 9999))}`,
          groupId: `GRP-${Math.floor(randomBetween(100, 999))}`,
          subscriberName: `${firstName} ${lastName}`,
          priority: InsurancePriority.PRIMARY,
          effectiveStart: primaryStart,
          effectiveEnd: primaryEnd,
          copayAmount: randomCopayAmount()
        }
      });
      policies.push(primary);

      if (insuranceRoll > 0.75) {
        const secondary = await prisma.insurancePolicy.create({
          data: {
            patientId: patient.id,
            payerName: pick(insurers),
            memberId: `S-${index}-${Math.floor(randomBetween(1000, 9999))}`,
            groupId: `SG-${Math.floor(randomBetween(100, 999))}`,
            subscriberName: `${firstName} ${lastName}`,
            priority: InsurancePriority.SECONDARY,
            effectiveStart: day('2024-06-01'),
            copayAmount: randomCopayAmount()
          }
        });
        policies.push(secondary);
      }
    }

    if (rng() < 0.12) {
      const overlapPrimary = await prisma.insurancePolicy.create({
        data: {
          patientId: patient.id,
          payerName: pick(insurers),
          memberId: `P-${index}-${Math.floor(randomBetween(1000, 9999))}`,
          groupId: `OP-${Math.floor(randomBetween(100, 999))}`,
          subscriberName: `${firstName} ${lastName}`,
          priority: InsurancePriority.PRIMARY,
          effectiveStart: day('2025-06-01'),
          effectiveEnd: day('2026-02-15'),
          copayAmount: randomCopayAmount()
        }
      });
      policies.push(overlapPrimary);
    }

    const pastAppointmentCount = rng() < 0.7 ? 1 : rng() < 0.3 ? 2 : 0;
    for (let i = 0; i < pastAppointmentCount; i += 1) {
      const scheduledAt = addHours(randomDateBetween(pastStart, pastEnd), 8 + i * 2);
      const plannedProcedures = buildPlannedProcedures(Math.floor(randomBetween(2, 4)));
      const appointment = await prisma.appointment.create({
        data: {
          patientId: patient.id,
          scheduledAt,
          plannedProcedures,
          status: AppointmentStatus.COMPLETED
        }
      });

      const visit = await prisma.visit.create({
        data: {
          patientId: patient.id,
          dateOfService: day(scheduledAt),
          plannedProcedures,
          appointmentId: appointment.id
        }
      });

      const procedures = [] as any[];
      const proceduresCount = Math.floor(randomBetween(2, 4));
      for (let j = 0; j < proceduresCount; j += 1) {
        const procedure = pick(procedureCatalog);
        const confidence = rng() < 0.15 ? 0.62 : 0.9;
        procedures.push({
          visitId: visit.id,
          freeText: procedure.text,
          normalizedText: procedure.text.toLowerCase(),
          confidence,
          rationale: confidence < 0.7 ? 'Requires confirmation due to ambiguous note.' : 'Matched fee schedule code.',
          candidateCodes: [
            {
              code: procedure.code,
              label: procedure.label,
              confidence,
              rationale: 'Matched fee schedule code.',
              suggested: true
            }
          ],
          selectedCode: procedure.code,
          selectedLabel: procedure.label
        });
      }
      await prisma.procedureRecord.createMany({ data: procedures });

      if (rng() > 0.2) {
        const selection = selectInsurance(policies as any, visit.dateOfService, []);
        const selectedPolicy = selection.selectedPolicy ?? selection.activePolicies[0] ?? null;
        const reason =
          selection.needsConfirmation && selectedPolicy
            ? `Multiple active policies; staff confirmed ${selectedPolicy.payerName}.`
            : selection.activePolicies.length === 0
            ? 'Self-pay confirmed by staff.'
            : selection.reason;

        const claimStatusRoll = rng();
        const status = claimStatusRoll < 0.15 ? ClaimStatus.DENIED : claimStatusRoll < 0.65 ? ClaimStatus.PAID : ClaimStatus.SUBMITTED;

        const claim = await prisma.claim.create({
          data: {
            patientId: patient.id,
            visitId: visit.id,
            insurancePolicyId: selectedPolicy?.id,
            insuranceSnapshot: selectedPolicy
              ? {
                  payerName: selectedPolicy.payerName,
                  memberId: selectedPolicy.memberId,
                  groupId: selectedPolicy.groupId,
                  subscriberName: selectedPolicy.subscriberName,
                  priority: selectedPolicy.priority,
                  effectiveStart: selectedPolicy.effectiveStart.toISOString(),
                  effectiveEnd: selectedPolicy.effectiveEnd?.toISOString() ?? null,
                  copayAmount: selectedPolicy.copayAmount?.toString() ?? null
                }
              : undefined,
            insuranceReason: reason,
            status
          }
        });

        const ledgerEvents = [] as any[];
        ledgerEvents.push({
          patientId: patient.id,
          visitId: visit.id,
          claimId: claim.id,
          type: LedgerEventType.PROCEDURE_PERFORMED,
          amount: new Decimal('0'),
          occurredAt: visit.dateOfService,
          metadata: { note: 'Procedures performed and confirmed.' }
        });

        const chargeLines = procedures.map((procedure, lineIndex) => {
          const fee = feeMap.get(procedure.selectedCode)!;
          return {
            patientId: patient.id,
            visitId: visit.id,
            claimId: claim.id,
            type: LedgerEventType.CHARGE_CREATED,
            amount: toDecimal(fee.amount),
            occurredAt: visit.dateOfService,
            metadata: { code: fee.code, label: fee.label, lineNumber: lineIndex + 1 }
          };
        });
        ledgerEvents.push(...chargeLines);

        ledgerEvents.push({
          patientId: patient.id,
          visitId: visit.id,
          claimId: claim.id,
          type: LedgerEventType.CLAIM_SUBMITTED,
          amount: new Decimal('0'),
          occurredAt: addDays(visit.dateOfService, 1),
          metadata: { channel: 'packet generated' }
        });

        const totalCharges = chargeLines.reduce((sum, line) => sum + Number(line.amount.toString()), 0);

        if (status === ClaimStatus.PAID) {
          const insurancePaid = roundCents(totalCharges * randomBetween(0.5, 0.8));
          const adjustment = roundCents(totalCharges * randomBetween(0.05, 0.2));
          let patientPaid = roundCents(totalCharges - insurancePaid - adjustment);
          let creditAmount = 0;
          if (patientPaid < 0) {
            creditAmount = Math.abs(patientPaid);
            patientPaid = 0;
          }

          ledgerEvents.push({
            patientId: patient.id,
            visitId: visit.id,
            claimId: claim.id,
            type: LedgerEventType.INSURANCE_PAYMENT,
            amount: toDecimal(-insurancePaid),
            occurredAt: addDays(visit.dateOfService, 12),
            metadata: { note: 'Carrier payment posted.' }
          });
          ledgerEvents.push({
            patientId: patient.id,
            visitId: visit.id,
            claimId: claim.id,
            type: LedgerEventType.INSURANCE_ADJUSTMENT,
            amount: toDecimal(-adjustment),
            occurredAt: addDays(visit.dateOfService, 12),
            metadata: { reason: 'Plan write-off applied.' }
          });
          if (patientPaid > 0) {
            ledgerEvents.push({
              patientId: patient.id,
              visitId: visit.id,
              claimId: claim.id,
              type: LedgerEventType.PATIENT_PAYMENT,
              amount: toDecimal(-patientPaid),
              occurredAt: addDays(visit.dateOfService, 18),
              metadata: { note: 'Patient paid remaining balance.' }
            });
          }
          if (creditAmount > 0) {
            const creditId = `credit-${claim.id}`;
            ledgerEvents.push({
              id: creditId,
              patientId: patient.id,
              visitId: visit.id,
              claimId: claim.id,
              type: LedgerEventType.CREDIT_CREATED,
              amount: toDecimal(-creditAmount),
              occurredAt: addDays(visit.dateOfService, 20),
              metadata: { reason: 'Overpayment credit.' }
            });
          }
        } else if (status === ClaimStatus.SUBMITTED) {
          const prepay = roundCents(totalCharges * randomBetween(0, 0.25));
          if (prepay > 0) {
            ledgerEvents.push({
              patientId: patient.id,
              visitId: visit.id,
              claimId: claim.id,
              type: LedgerEventType.PATIENT_PAYMENT,
              amount: toDecimal(-prepay),
              occurredAt: addDays(visit.dateOfService, 2),
              metadata: { note: 'Prepayment collected at visit.' }
            });
          }
        } else {
          ledgerEvents.push({
            patientId: patient.id,
            visitId: visit.id,
            claimId: claim.id,
            type: LedgerEventType.INSURANCE_ADJUSTMENT,
            amount: new Decimal('0'),
            occurredAt: addDays(visit.dateOfService, 10),
            metadata: { reason: 'Claim denied by payer.' }
          });
        }

        if (rng() < 0.08) {
          ledgerEvents.push({
            patientId: patient.id,
            visitId: visit.id,
            claimId: claim.id,
            type: LedgerEventType.BALANCE_CORRECTION,
            amount: toDecimal(15),
            occurredAt: addDays(visit.dateOfService, 25),
            metadata: { reason: 'Post-zero adjustment requires review.' }
          });
        }

        await prisma.ledgerEvent.createMany({ data: ledgerEvents });

        const fullLedger = await prisma.ledgerEvent.findMany({ where: { claimId: claim.id } });
        const explanationText = draftBalanceExplanation(fullLedger);
        const explanation = await prisma.explanationDraft.create({
          data: {
            claimId: claim.id,
            originalText: explanationText,
            status: ExplanationStatus.DRAFT
          }
        });

        const snapshot = claim.insuranceSnapshot as InsuranceSnapshot | null;
        const payerPacket = buildPayerPacket({
          claim,
          patient,
          visit,
          ledger: fullLedger,
          insuranceSnapshot: snapshot
        });
        const patientStatement = buildPatientStatement({
          claim,
          patient,
          visit,
          ledger: fullLedger,
          insuranceSnapshot: snapshot,
          explanation
        });

        await prisma.claimPacket.createMany({
          data: [
            {
              claimId: claim.id,
              type: ClaimPacketType.PAYER,
              payload: payerPacket.payload,
              html: payerPacket.html
            },
            {
              claimId: claim.id,
              type: ClaimPacketType.PATIENT,
              payload: patientStatement.payload,
              html: patientStatement.html
            }
          ]
        });

        await prisma.claimSubmission.create({
          data: {
            claimId: claim.id,
            insurancePolicyId: selectedPolicy?.id ?? null,
            insuranceSnapshot: claim.insuranceSnapshot ?? undefined,
            reason: 'Initial submission generated at intake.'
          }
        });

        if (status === ClaimStatus.DENIED) {
          await prisma.claimDecision.create({
            data: {
              claimId: claim.id,
              status: ClaimStatus.DENIED,
              reasonCode: 'DENIAL',
              reasonText: pick(denialReasons),
              occurredAt: addDays(visit.dateOfService, 9)
            }
          });
        } else if (status === ClaimStatus.PAID) {
          await prisma.claimDecision.create({
            data: {
              claimId: claim.id,
              status: ClaimStatus.PAID,
              reasonCode: 'APPROVED',
              reasonText: pick(approvalReasons),
              occurredAt: addDays(visit.dateOfService, 12)
            }
          });
        }

        const storedProcedures = await prisma.procedureRecord.findMany({ where: { visitId: visit.id } });
        const flags = detectFlags({
          claim,
          policies: policies as any,
          overrides: [],
          procedures: storedProcedures as any,
          ledgerEvents: fullLedger as any,
          dateOfService: visit.dateOfService
        });
        if (flags.length > 0) {
          await prisma.flag.createMany({
            data: flags.map((flag) => ({
              patientId: claim.patientId,
              claimId: claim.id,
              source: FlagSource.SYSTEM,
              status: FlagStatus.OPEN,
              likelyIssue: flag.likelyIssue,
              confidence: flag.confidence,
              recommendedAction: flag.recommendedAction,
              fingerprint: flag.fingerprint,
              lastDetectedAt: flag.lastDetectedAt
            }))
          });
        }
      }
    }

    if (rng() < 0.6) {
      const scheduledAt = addHours(randomDateBetween(today, futureEnd), 9 + Math.floor(randomBetween(0, 6)));
      const plannedProcedures = buildPlannedProcedures(Math.floor(randomBetween(1, 3)));
      const isToday = scheduledAt.toDateString() === today.toDateString();
      const status = isToday && rng() < 0.4 ? AppointmentStatus.CHECKED_IN : AppointmentStatus.SCHEDULED;
      await prisma.appointment.create({
        data: {
          patientId: patient.id,
          scheduledAt,
          plannedProcedures,
          status
        }
      });
    }

    if (rng() < 0.25) {
      const visitDate = randomDateBetween(pastStart, pastEnd);
      const plannedProcedures = buildPlannedProcedures(Math.floor(randomBetween(1, 3)));
      await prisma.visit.create({
        data: {
          patientId: patient.id,
          dateOfService: visitDate,
          plannedProcedures
        }
      });
    }
  }
}

seed()
  .catch(async (error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
