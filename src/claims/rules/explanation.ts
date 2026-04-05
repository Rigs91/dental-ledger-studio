import { LedgerEvent, LedgerEventType } from '@prisma/client';
import { buildLedgerSummary } from '@/ledger/ledger';
import { formatCurrency } from '@/shared/domain/format';

export function draftBalanceExplanation(events: LedgerEvent[]): string {
  const summary = buildLedgerSummary(events);
  const charges = summary.totalCharges;
  const balance = summary.currentBalance;

  const parts: string[] = [];
  if (charges > 0) {
    parts.push(`Charges posted total ${formatCurrency(charges)}.`);
  }

  const insurancePayments = events.filter((event) => event.type === LedgerEventType.INSURANCE_PAYMENT);
  if (insurancePayments.length > 0) {
    const paid = insurancePayments.reduce(
      (sum, event) => sum + Math.abs(Number(event.amount.toString())),
      0
    );
    parts.push(`Insurance payments total ${formatCurrency(paid)}.`);
  }

  const adjustments = events.filter(
    (event) => event.type === LedgerEventType.INSURANCE_ADJUSTMENT || event.type === LedgerEventType.BALANCE_CORRECTION
  );
  if (adjustments.length > 0) {
    const adjTotal = adjustments.reduce(
      (sum, event) => sum + Math.abs(Number(event.amount.toString())),
      0
    );
    parts.push(`Adjustments and corrections total ${formatCurrency(adjTotal)}.`);
  }

  const patientPayments = events.filter((event) => event.type === LedgerEventType.PATIENT_PAYMENT);
  if (patientPayments.length > 0) {
    const paid = patientPayments.reduce(
      (sum, event) => sum + Math.abs(Number(event.amount.toString())),
      0
    );
    parts.push(`Patient payments total ${formatCurrency(paid)}.`);
  }

  const credits = events.filter(
    (event) => event.type === LedgerEventType.CREDIT_CREATED || event.type === LedgerEventType.CREDIT_APPLIED
  );
  if (credits.length > 0) {
    const creditTotal = credits.reduce(
      (sum, event) => sum + Math.abs(Number(event.amount.toString())),
      0
    );
    parts.push(`Credits applied total ${formatCurrency(creditTotal)}.`);
  }

  if (summary.unappliedCredits.length > 0) {
    parts.push('There are unapplied credits that still need allocation.');
  }

  if (Math.abs(balance) < 0.005) {
    parts.push('The balance is currently zero.');
  } else if (balance > 0) {
    parts.push(`Current balance due is ${formatCurrency(balance)}.`);
  } else {
    parts.push(`Current credit balance is ${formatCurrency(Math.abs(balance))}.`);
  }

  return parts.join(' ');
}

export function summarizeRootCause(issue: string, context?: string): string {
  if (context) {
    return `${issue} ${context}`;
  }
  return issue;
}
