import type { Claim, ExplanationDraft, LedgerEvent, Patient, Visit } from '@prisma/client';
import { formatCurrency, formatDate, formatLongDate } from '@/shared/domain/format';
import { buildLedgerSummary } from '@/ledger/ledger';
import { providerProfile } from './provider';

export type InsuranceSnapshot = {
  payerName: string;
  memberId: string;
  groupId?: string | null;
  subscriberName?: string | null;
  employerName?: string | null;
  priority: string;
  effectiveStart: string;
  effectiveEnd?: string | null;
  lastVerifiedAt?: string | null;
  copayAmount?: string | null;
};

export type PayerPacketLineItem = {
  line: number;
  code: string;
  description: string;
  tooth: string;
  surface: string;
  quantity: string;
  fee: string;
};

export type PayerPacketPayload = {
  claimId: string;
  dateOfService: string;
  patient: {
    id: string;
    name: string;
    dob: string;
    phone?: string | null;
    email?: string | null;
  };
  subscriber: {
    name: string;
    relationship: string;
    memberId: string;
    groupId?: string | null;
    employerName?: string | null;
  };
  provider: {
    practiceName: string;
    treatingDentist: string;
    npi: string;
    taxId: string;
    phone: string;
    address: string;
  };
  insurance: {
    payerName: string;
    priority?: string | null;
    effectiveStart?: string | null;
    effectiveEnd?: string | null;
    copayAmount?: string | null;
    employerName?: string | null;
  };
  serviceLines: PayerPacketLineItem[];
  totals: {
    totalFee: string;
  };
  notes: string[];
};

export type PatientStatementPayload = {
  claimId: string;
  patient: {
    id: string;
    name: string;
    dob: string;
  };
  visit: {
    dateOfService: string;
  };
  insurance: {
    payerName: string;
    memberId?: string | null;
    copayAmount?: string | null;
  };
  services: { description: string; code: string; fee: string }[];
  financials: {
    totalCharges: string;
    insurancePaid: string;
    adjustments: string;
    patientPayments: string;
    copayCollected: string;
    credits: string;
    balanceLabel: string;
    balanceAmount: string;
  };
  adjustments: { date: string; reason: string; amount: string }[];
  payments: { date: string; source: string; amount: string; note: string }[];
  explanation: {
    original: string;
    edited?: string | null;
  };
};

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value === 'object' && value && 'toString' in value) {
    const parsed = Number(String(value));
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

type ChargeUpdate = {
  lineNumber: number;
  code?: string;
  label?: string;
  fee?: string | number;
};

function isLaterEvent(a: LedgerEvent, b: LedgerEvent): boolean {
  const occurredDelta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
  if (occurredDelta !== 0) {
    return occurredDelta > 0;
  }
  const createdDelta = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  if (createdDelta !== 0) {
    return createdDelta > 0;
  }
  return a.id.localeCompare(b.id) > 0;
}

function getChargeUpdates(ledger: LedgerEvent[]): Map<number, { update: ChargeUpdate; event: LedgerEvent }> {
  const updates = new Map<number, { update: ChargeUpdate; event: LedgerEvent }>();
  ledger.forEach((event) => {
    if (event.type !== 'NOTE') {
      return;
    }
    const metadata = event.metadata as Record<string, unknown> | null;
    if (!metadata || typeof metadata !== 'object') {
      return;
    }
    const update = metadata.chargeUpdate as Record<string, unknown> | null;
    if (!update || typeof update !== 'object') {
      return;
    }
    const lineNumber = typeof update.lineNumber === 'number' ? update.lineNumber : null;
    if (!lineNumber || lineNumber < 1) {
      return;
    }
    const candidate: ChargeUpdate = {
      lineNumber,
      code: typeof update.code === 'string' ? update.code : undefined,
      label: typeof update.label === 'string' ? update.label : undefined,
      fee: typeof update.fee === 'number' || typeof update.fee === 'string' ? update.fee : undefined
    };
    const existing = updates.get(lineNumber);
    if (!existing || isLaterEvent(event, existing.event)) {
      updates.set(lineNumber, { update: candidate, event });
    }
  });
  return updates;
}

function isProcedureChargeUpdate(event: LedgerEvent): boolean {
  if (event.type !== 'BALANCE_CORRECTION') {
    return false;
  }
  const metadata = event.metadata as Record<string, unknown> | null;
  if (!metadata || typeof metadata !== 'object') {
    return false;
  }
  if (metadata.adjustmentType === 'PROCEDURE_UPDATE') {
    return true;
  }
  if (metadata.reason === 'Procedure code updated.') {
    return true;
  }
  return false;
}

function getChargeLines(ledger: LedgerEvent[]): { lines: PayerPacketLineItem[]; totalFee: number } {
  const updates = getChargeUpdates(ledger);
  const charges = ledger.filter((event) => event.type === 'CHARGE_CREATED');
  let totalFee = 0;
  const lines = charges.map((event, index) => {
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    const lineNumber = typeof metadata.lineNumber === 'number' ? metadata.lineNumber : index + 1;
    const update = updates.get(lineNumber)?.update;
    const code = update?.code ?? (typeof metadata.code === 'string' ? metadata.code : 'Uncoded');
    const description =
      update?.label ?? (typeof metadata.label === 'string' ? metadata.label : 'Unlabeled service');
    const tooth = typeof metadata.tooth === 'string' ? metadata.tooth : 'Not recorded';
    const surface = typeof metadata.surface === 'string' ? metadata.surface : 'Not recorded';
    const quantity = typeof metadata.quantity === 'string' ? metadata.quantity : '1';
    const feeValue = update?.fee !== undefined ? toNumber(update.fee) : toNumber(event.amount);
    totalFee += feeValue;
    const line = {
      line: lineNumber,
      code,
      description,
      tooth,
      surface,
      quantity,
      fee: formatCurrency(feeValue)
    };
    return line;
  });

  return {
    lines: lines.sort((a, b) => a.line - b.line),
    totalFee: Number(totalFee.toFixed(2))
  };
}

export function buildPayerPacket(input: {
  claim: Claim;
  patient: Patient;
  visit: Visit;
  ledger: LedgerEvent[];
  insuranceSnapshot: InsuranceSnapshot | null;
}): { payload: PayerPacketPayload; html: string } {
  const { claim, patient, visit, ledger, insuranceSnapshot } = input;
  const { lines: serviceLines, totalFee } = getChargeLines(ledger);
  const payerName = insuranceSnapshot?.payerName ?? 'Self-pay';
  const subscriberName = insuranceSnapshot?.subscriberName ?? `${patient.firstName} ${patient.lastName}`;
  const subscriberRelationship = insuranceSnapshot?.subscriberName
    ? 'Subscriber'
    : 'Self (subscriber not separately recorded)';

  const payload: PayerPacketPayload = {
    claimId: claim.id,
    dateOfService: formatDate(visit.dateOfService),
    patient: {
      id: patient.id,
      name: `${patient.firstName} ${patient.lastName}`,
      dob: formatDate(patient.dob),
      phone: patient.phone ?? null,
      email: patient.email ?? null
    },
    subscriber: {
      name: subscriberName,
      relationship: subscriberRelationship,
      memberId: insuranceSnapshot?.memberId ?? 'Self-pay',
      groupId: insuranceSnapshot?.groupId ?? null,
      employerName: insuranceSnapshot?.employerName ?? null
    },
    provider: {
      practiceName: providerProfile.practiceName,
      treatingDentist: providerProfile.treatingDentist,
      npi: providerProfile.npi,
      taxId: providerProfile.taxId,
      phone: providerProfile.phone,
      address: providerProfile.address
    },
    insurance: {
      payerName,
      priority: insuranceSnapshot?.priority ?? null,
      effectiveStart: insuranceSnapshot?.effectiveStart
        ? formatDate(insuranceSnapshot.effectiveStart)
        : null,
      effectiveEnd: insuranceSnapshot?.effectiveEnd ? formatDate(insuranceSnapshot.effectiveEnd) : null,
      copayAmount: insuranceSnapshot?.copayAmount
        ? formatCurrency(toNumber(insuranceSnapshot.copayAmount))
        : null,
      employerName: insuranceSnapshot?.employerName ?? null
    },
    serviceLines,
    totals: {
      totalFee: formatCurrency(totalFee)
    },
    notes: [
      claim.insuranceReason,
      insuranceSnapshot ? 'Insurance snapshot captured at claim creation.' : 'Self-pay visit confirmed by staff.'
    ]
  };

  return {
    payload,
    html: renderPayerPacketHtml(payload)
  };
}

export function buildPatientStatement(input: {
  claim: Claim;
  patient: Patient;
  visit: Visit;
  ledger: LedgerEvent[];
  insuranceSnapshot: InsuranceSnapshot | null;
  explanation?: ExplanationDraft | null;
}): { payload: PatientStatementPayload; html: string } {
  const { claim, patient, visit, ledger, insuranceSnapshot, explanation } = input;
  const summary = buildLedgerSummary(ledger);
  const { lines: serviceLines, totalFee } = getChargeLines(ledger);

  const insurancePayments = ledger.filter((event) => event.type === 'INSURANCE_PAYMENT');
  const adjustments = ledger.filter((event) => {
    if (event.type !== 'INSURANCE_ADJUSTMENT' && event.type !== 'BALANCE_CORRECTION') {
      return false;
    }
    return !isProcedureChargeUpdate(event);
  });
  const patientPayments = ledger.filter((event) => event.type === 'PATIENT_PAYMENT');
  const credits = ledger.filter(
    (event) => event.type === 'CREDIT_CREATED' || event.type === 'CREDIT_APPLIED'
  );
  const copayEvents = patientPayments.filter((event) => {
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    return metadata.source === 'copay';
  });

  const insurancePaidTotal = insurancePayments.reduce(
    (total, event) => total + Math.abs(toNumber(event.amount)),
    0
  );
  const adjustmentTotal = adjustments.reduce(
    (total, event) => total + Math.abs(toNumber(event.amount)),
    0
  );
  const patientPaidTotal = patientPayments.reduce(
    (total, event) => total + Math.abs(toNumber(event.amount)),
    0
  );
  const copayCollectedTotal = copayEvents.reduce(
    (total, event) => total + Math.abs(toNumber(event.amount)),
    0
  );
  const creditTotal = credits.reduce((total, event) => total + Math.abs(toNumber(event.amount)), 0);

  const balanceIsZero = Math.abs(summary.currentBalance) < 0.005;
  const balanceLabel = balanceIsZero
    ? 'Balance settled'
    : summary.currentBalance > 0
    ? 'Balance due'
    : 'Credit balance';
  const balanceAmountValue = Math.abs(summary.currentBalance);

  const payload: PatientStatementPayload = {
    claimId: claim.id,
    patient: {
      id: patient.id,
      name: `${patient.firstName} ${patient.lastName}`,
      dob: formatDate(patient.dob)
    },
    visit: {
      dateOfService: formatLongDate(visit.dateOfService)
    },
    insurance: {
      payerName: insuranceSnapshot?.payerName ?? 'Self-pay',
      memberId: insuranceSnapshot?.memberId ?? null,
      copayAmount: insuranceSnapshot?.copayAmount
        ? formatCurrency(toNumber(insuranceSnapshot.copayAmount))
        : null
    },
    services: serviceLines.map((line) => ({
      description: line.description,
      code: line.code,
      fee: line.fee
    })),
    financials: {
      totalCharges: formatCurrency(totalFee),
      insurancePaid: formatCurrency(insurancePaidTotal),
      adjustments: formatCurrency(adjustmentTotal),
      patientPayments: formatCurrency(patientPaidTotal),
      copayCollected: formatCurrency(copayCollectedTotal),
      credits: formatCurrency(creditTotal),
      balanceLabel,
      balanceAmount: formatCurrency(balanceAmountValue)
    },
    adjustments: [...adjustments]
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
      .map((event) => {
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;
      const reason =
        typeof metadata.reason === 'string'
          ? metadata.reason
          : event.type === 'BALANCE_CORRECTION'
          ? 'Balance correction applied.'
          : 'Adjustment posted by payer.';
      return {
        date: formatDate(event.occurredAt),
        reason,
        amount: formatCurrency(Math.abs(toNumber(event.amount)))
      };
    }),
    payments: [...insurancePayments, ...patientPayments]
      .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime())
      .map((event) => {
      const metadata = (event.metadata ?? {}) as Record<string, unknown>;
      const note = typeof metadata.note === 'string' ? metadata.note : '';
      return {
        date: formatDate(event.occurredAt),
        source: event.type === 'INSURANCE_PAYMENT' ? 'Insurance payment' : 'Patient payment',
        amount: formatCurrency(Math.abs(toNumber(event.amount))),
        note
      };
    }),
    explanation: {
      original: explanation?.originalText ?? 'Balance explanation pending staff review.',
      edited: explanation?.editedText ?? null
    }
  };

  return {
    payload,
    html: renderPatientStatementHtml(payload)
  };
}

export function renderPayerPacketHtml(payload: PayerPacketPayload): string {
  return `
  <section style="font-family: 'Source Sans 3', Arial, sans-serif; color: #0f172a;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
      <div>
        <div style="font-size:20px; font-weight:700;">Payer Claim Packet (ADA-style)</div>
        <div style="color:#475569; margin-top:4px;">Claim ${payload.claimId} | Date of service ${payload.dateOfService}</div>
      </div>
      <div style="text-align:right; font-size:12px; color:#475569;">
        <div>${payload.provider.practiceName}</div>
        <div>${payload.provider.phone}</div>
      </div>
    </div>

    <div style="display:grid; gap:12px; margin-top:16px;">
      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Patient information</div>
        <div>Name: ${payload.patient.name}</div>
        <div>DOB: ${payload.patient.dob}</div>
        <div>Patient ID: ${payload.patient.id}</div>
        <div>Phone: ${payload.patient.phone ?? 'Not recorded'}</div>
        <div>Email: ${payload.patient.email ?? 'Not recorded'}</div>
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Subscriber & insurance</div>
        <div>Payer: ${payload.insurance.payerName}</div>
        <div>Priority: ${payload.insurance.priority ?? 'Not recorded'}</div>
        <div>
          Effective:
          ${payload.insurance.effectiveStart ?? 'Not recorded'}${payload.insurance.effectiveEnd ? ` - ${payload.insurance.effectiveEnd}` : ''}
        </div>
        <div>Member ID: ${payload.subscriber.memberId}</div>
        <div>Group ID: ${payload.subscriber.groupId ?? 'Not recorded'}</div>
        <div>Employer: ${payload.subscriber.employerName ?? payload.insurance.employerName ?? 'Not recorded'}</div>
        <div>Subscriber: ${payload.subscriber.name}</div>
        <div>Relationship: ${payload.subscriber.relationship}</div>
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Provider</div>
        <div>Treating dentist: ${payload.provider.treatingDentist}</div>
        <div>NPI: ${payload.provider.npi}</div>
        <div>Tax ID: ${payload.provider.taxId}</div>
        <div>Address: ${payload.provider.address}</div>
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Service lines</div>
        <table style="width:100%; border-collapse:collapse; font-size:13px;">
          <thead>
            <tr style="text-align:left; color:#475569;">
              <th style="padding:6px 0;">Line</th>
              <th style="padding:6px 0;">Code</th>
              <th style="padding:6px 0;">Description</th>
              <th style="padding:6px 0;">Tooth</th>
              <th style="padding:6px 0;">Surface</th>
              <th style="padding:6px 0;">Qty</th>
              <th style="padding:6px 0; text-align:right;">Fee</th>
            </tr>
          </thead>
          <tbody>
            ${payload.serviceLines
              .map(
                (line) => `
              <tr style="border-top:1px solid #e2e8f0;">
                <td style="padding:6px 0;">${line.line}</td>
                <td style="padding:6px 0;">${line.code}</td>
                <td style="padding:6px 0;">${line.description}</td>
                <td style="padding:6px 0;">${line.tooth}</td>
                <td style="padding:6px 0;">${line.surface}</td>
                <td style="padding:6px 0;">${line.quantity}</td>
                <td style="padding:6px 0; text-align:right;">${line.fee}</td>
              </tr>
            `
              )
              .join('')}
          </tbody>
        </table>
        <div style="display:flex; justify-content:flex-end; margin-top:8px; font-weight:600;">
          Total fee: ${payload.totals.totalFee}
        </div>
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Submission notes</div>
        ${payload.notes.map((note) => `<div style="color:#475569;">${note}</div>`).join('')}
      </div>
    </div>
  </section>
  `;
}

export function renderPatientStatementHtml(payload: PatientStatementPayload): string {
  const insuranceHeading = payload.insurance.payerName === 'Self-pay' ? 'Self-pay responsibility' : 'Insurance billed';
  return `
  <section style="font-family: 'Source Sans 3', Arial, sans-serif; color: #0f172a;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
      <div>
        <div style="font-size:20px; font-weight:700;">Patient Statement</div>
        <div style="color:#475569; margin-top:4px;">Visit on ${payload.visit.dateOfService}</div>
      </div>
      <div style="text-align:right; font-size:12px; color:#475569;">
        <div>${payload.patient.name}</div>
        <div>Patient ID: ${payload.patient.id}</div>
      </div>
    </div>

    <div style="display:grid; gap:12px; margin-top:16px;">
      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Services performed</div>
        ${payload.services
          .map((service) => `<div>${service.description} (${service.code}) - ${service.fee}</div>`)
          .join('')}
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">${insuranceHeading}</div>
        <div>${payload.insurance.payerName}</div>
        ${payload.insurance.memberId ? `<div>Member ID: ${payload.insurance.memberId}</div>` : ''}
        ${payload.insurance.copayAmount ? `<div>Expected copay: ${payload.insurance.copayAmount}</div>` : ''}
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Financial summary</div>
        <div>Total charges: ${payload.financials.totalCharges}</div>
        <div>Insurance paid: ${payload.financials.insurancePaid}</div>
        <div>Adjustments: ${payload.financials.adjustments}</div>
        <div>Patient payments: ${payload.financials.patientPayments}</div>
        ${
          payload.insurance.copayAmount || payload.financials.copayCollected !== formatCurrency(0)
            ? `<div>Copay collected: ${payload.financials.copayCollected}</div>`
            : ''
        }
        <div>Credits: ${payload.financials.credits}</div>
        <div style="font-weight:600; margin-top:6px;">${payload.financials.balanceLabel}: ${payload.financials.balanceAmount}</div>
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Adjustments & payments</div>
        ${payload.adjustments.length === 0 ? '<div>No adjustments recorded.</div>' : ''}
        ${payload.adjustments
          .map((adj) => `<div>${adj.date}: ${adj.reason} (${adj.amount})</div>`)
          .join('')}
        ${payload.payments
          .map((payment) => `<div>${payment.date}: ${payment.source} ${payment.amount}${payment.note ? ` - ${payment.note}` : ''}</div>`)
          .join('')}
      </div>

      <div style="border:1px solid #e2e8f0; border-radius:12px; padding:12px;">
        <div style="font-weight:600; margin-bottom:6px;">Why you owe this balance</div>
        <div>${payload.explanation.edited ?? payload.explanation.original}</div>
      </div>
    </div>
  </section>
  `;
}
