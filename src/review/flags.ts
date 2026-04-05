import {
  Claim,
  InsuranceOverride,
  InsurancePolicy,
  LedgerEvent,
  Prisma,
  PrismaClient,
  ProcedureRecord
} from '@prisma/client';
import { isAdjustmentAfterZero, buildLedgerSummary } from '@/ledger/ledger';
import { formatDate } from '@/shared/domain/format';
import { selectInsurance } from '@/insurance/insurance';
import { prisma } from '@/shared/domain/db';

type DbClient = PrismaClient | Prisma.TransactionClient;

export type FlagCandidate = {
  fingerprint: string;
  likelyIssue: string;
  confidence: number;
  recommendedAction: string;
  lastDetectedAt: Date;
  source: 'SYSTEM';
  status: 'OPEN';
};

const DAYS_30 = 30 * 24 * 60 * 60 * 1000;

export function detectFlags(input: {
  claim: Claim;
  policies: InsurancePolicy[];
  overrides: InsuranceOverride[];
  procedures: ProcedureRecord[];
  ledgerEvents: LedgerEvent[];
  dateOfService: Date;
}): FlagCandidate[] {
  const { claim, policies, overrides, procedures, ledgerEvents, dateOfService } = input;
  const flags: FlagCandidate[] = [];
  const selection = selectInsurance(policies, dateOfService, overrides);

  if (
    selection.needsConfirmation &&
    selection.activePolicies.filter((policy) => policy.priority === 'PRIMARY').length > 1
  ) {
    flags.push({
      fingerprint: `multi-primary-${claim.id}`,
      likelyIssue: 'Multiple active primary policies on date of service.',
      confidence: 0.82,
      recommendedAction: 'Confirm which primary policy should be used for this claim.',
      lastDetectedAt: new Date(),
      source: 'SYSTEM',
      status: 'OPEN'
    });
  }

  const nearDosChange = selection.warnings.some((warning) =>
    warning.toLowerCase().includes('changed within 14 days')
  );
  if (nearDosChange) {
    flags.push({
      fingerprint: `insurance-change-${claim.id}`,
      likelyIssue: 'Insurance changed near the date of service.',
      confidence: 0.7,
      recommendedAction: 'Verify coverage dates and confirm the correct policy with the patient.',
      lastDetectedAt: new Date(),
      source: 'SYSTEM',
      status: 'OPEN'
    });
  }

  if (
    procedures.some((procedure) => {
      const status = procedure.reviewStatus ?? 'PENDING';
      return procedure.confidence < 0.7 && status === 'PENDING';
    })
  ) {
    flags.push({
      fingerprint: `low-confidence-${claim.id}`,
      likelyIssue: 'Low coding confidence on at least one procedure.',
      confidence: 0.64,
      recommendedAction: 'Review procedure intent and confirm CDT code selections.',
      lastDetectedAt: new Date(),
      source: 'SYSTEM',
      status: 'OPEN'
    });
  }

  if (isAdjustmentAfterZero(ledgerEvents)) {
    flags.push({
      fingerprint: `adjustment-after-zero-${claim.id}`,
      likelyIssue: 'Adjustment after balance reached zero.',
      confidence: 0.76,
      recommendedAction: 'Verify the post-zero adjustment and update the patient explanation.',
      lastDetectedAt: new Date(),
      source: 'SYSTEM',
      status: 'OPEN'
    });
  }

  const summary = buildLedgerSummary(ledgerEvents);
  const now = Date.now();
  summary.unappliedCredits.forEach((credit) => {
    const age = now - new Date(credit.occurredAt).getTime();
    if (age > DAYS_30) {
      flags.push({
        fingerprint: `unapplied-credit-${credit.id}`,
        likelyIssue: 'Unapplied credit older than 30 days.',
        confidence: 0.68,
        recommendedAction: 'Apply credit to open charges or process a refund.',
        lastDetectedAt: new Date(),
        source: 'SYSTEM',
        status: 'OPEN'
      });
    }
  });

  if (claim.status === 'DENIED') {
    flags.push({
      fingerprint: `claim-denied-${claim.id}`,
      likelyIssue: 'Claim marked denied by payer.',
      confidence: 0.9,
      recommendedAction: 'Review denial reason and determine resubmission path.',
      lastDetectedAt: new Date(),
      source: 'SYSTEM',
      status: 'OPEN'
    });
  }

  return flags;
}

export async function upsertSystemFlags(claimId: string, db: DbClient = prisma) {
  const claim = await db.claim.findUnique({
    where: { id: claimId },
    include: {
      patient: { include: { insurances: true, insuranceOverrides: true } },
      visit: true,
      insurancePolicy: true,
      ledger: true
    }
  });

  if (!claim) {
    return [];
  }

  const procedures = await db.procedureRecord.findMany({
    where: { visitId: claim.visitId }
  });

  const candidates = detectFlags({
    claim,
    policies: claim.patient.insurances,
    overrides: claim.patient.insuranceOverrides,
    procedures,
    ledgerEvents: claim.ledger,
    dateOfService: claim.visit.dateOfService
  });

  const candidateIssues = new Set(candidates.map((candidate) => candidate.likelyIssue));
  const openSystemFlags = await db.flag.findMany({
    where: { claimId: claim.id, source: 'SYSTEM', status: 'OPEN' }
  });

  for (const existing of openSystemFlags) {
    if (!candidateIssues.has(existing.likelyIssue)) {
      await db.flag.update({
        where: { id: existing.id },
        data: {
          status: 'RESOLVED',
          resolvedAt: new Date(),
          resolutionNote: 'Auto-resolved after data updates removed the triggering condition.'
        }
      });
    }
  }

  const latestChange = claim.ledger.reduce((max, event) => {
    const time = new Date(event.occurredAt).getTime();
    return Math.max(max, time);
  }, new Date(claim.createdAt).getTime());

  const results = [];

  for (const candidate of candidates) {
    const existing = await db.flag.findFirst({ where: { fingerprint: candidate.fingerprint } });
    if (existing) {
      if (existing.status === 'VERIFIED') {
        if (latestChange > new Date(existing.lastDetectedAt).getTime()) {
          const fingerprint = `${candidate.fingerprint}-${latestChange}`;
          results.push(
            await db.flag.create({
              data: {
                patientId: claim.patientId,
                claimId: claim.id,
                source: 'SYSTEM',
                status: 'OPEN',
                likelyIssue: candidate.likelyIssue,
                confidence: candidate.confidence,
                recommendedAction: candidate.recommendedAction,
                fingerprint,
                lastDetectedAt: new Date()
              }
            })
          );
        }
      } else if (existing.status === 'RESOLVED') {
        results.push(
          await db.flag.update({
            where: { id: existing.id },
            data: {
              status: 'OPEN',
              resolvedAt: null,
              resolutionNote: null,
              lastDetectedAt: candidate.lastDetectedAt
            }
          })
        );
      } else {
        results.push(
          await db.flag.update({
            where: { id: existing.id },
            data: { lastDetectedAt: candidate.lastDetectedAt }
          })
        );
      }
    } else {
      results.push(
        await db.flag.create({
          data: {
            patientId: claim.patientId,
            claimId: claim.id,
            source: 'SYSTEM',
            status: 'OPEN',
            likelyIssue: candidate.likelyIssue,
            confidence: candidate.confidence,
            recommendedAction: candidate.recommendedAction,
            fingerprint: candidate.fingerprint,
            lastDetectedAt: candidate.lastDetectedAt
          }
        })
      );
    }
  }

  return results;
}

export async function flagInsurancePolicyChange(input: {
  patientId: string;
  policyId: string;
  effectiveStart: Date;
  effectiveEnd?: Date | null;
}, db: DbClient = prisma) {
  const { patientId, policyId, effectiveStart, effectiveEnd } = input;
  const start = effectiveStart;
  const end = effectiveEnd ?? null;

  const visits = await db.visit.findMany({
    where: {
      patientId,
      dateOfService: {
        gte: start,
        ...(end ? { lte: end } : {})
      }
    },
    include: { claims: true }
  });

  const now = new Date();
  const results = [];

  for (const visit of visits) {
    const visitDate = formatDate(visit.dateOfService);
    const claims = visit.claims.length > 0 ? visit.claims : [null];

    for (const claim of claims) {
      const fingerprintBase = claim
        ? `insurance-policy-change-${policyId}-${claim.id}`
        : `insurance-policy-change-${policyId}-${visit.id}`;
      const existing = await db.flag.findFirst({ where: { fingerprint: fingerprintBase } });
      const payload = {
        patientId,
        claimId: claim?.id ?? undefined,
        source: 'SYSTEM' as const,
        status: 'OPEN' as const,
        likelyIssue: `Insurance policy updated after visit on ${visitDate}.`,
        confidence: 0.72,
        recommendedAction:
          'Review coverage dates and confirm the policy used for this visit. Update claim packet if needed.',
        fingerprint: fingerprintBase,
        lastDetectedAt: now
      };

      if (existing) {
        if (existing.status === 'VERIFIED') {
          const refreshedFingerprint = `${fingerprintBase}-${now.getTime()}`;
          results.push(
            await db.flag.create({
              data: { ...payload, fingerprint: refreshedFingerprint }
            })
          );
        } else {
          results.push(
            await db.flag.update({
              where: { id: existing.id },
              data: { lastDetectedAt: now }
            })
          );
        }
      } else {
        results.push(await db.flag.create({ data: payload }));
      }
    }
  }

  return results;
}
