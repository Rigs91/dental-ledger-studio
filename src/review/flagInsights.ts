export type FlagInsight = {
  summary: string;
  cause: string;
  fix: string;
};

export type FlagGroup = {
  id: string;
  label: string;
  description: string;
  match: (issue: string) => boolean;
};

const normalize = (value: string) => value.toLowerCase();

export const FLAG_GROUPS: FlagGroup[] = [
  {
    id: 'coding',
    label: 'Coding confidence',
    description: 'Procedure intent and CDT selection.',
    match: (issue) => normalize(issue).includes('coding confidence')
  },
  {
    id: 'insurance',
    label: 'Insurance selection',
    description: 'Coverage conflicts or timeline issues.',
    match: (issue) => normalize(issue).includes('insurance')
  },
  {
    id: 'adjustments',
    label: 'Credits & adjustments',
    description: 'Post-payment adjustments or unapplied credits.',
    match: (issue) => {
      const text = normalize(issue);
      return text.includes('adjustment') || text.includes('credit');
    }
  },
  {
    id: 'denials',
    label: 'Denials',
    description: 'Payer denials and resubmissions.',
    match: (issue) => normalize(issue).includes('denied')
  },
  {
    id: 'frontdesk',
    label: 'Front desk follow-up',
    description: 'Patient outreach and intake follow-up.',
    match: (issue) => normalize(issue).includes('front desk')
  }
];

export function getFlagGroupId(issue: string): string {
  for (const group of FLAG_GROUPS) {
    if (group.match(issue)) {
      return group.id;
    }
  }
  return 'other';
}

export function getFlagInsight(issue: string, recommendedAction?: string): FlagInsight {
  const text = normalize(issue);

  if (text.includes('coding confidence')) {
    return {
      summary: 'One or more procedures have low coding confidence.',
      cause: 'The procedure intent did not map cleanly to a single CDT code.',
      fix: 'Review the procedures and confirm or update the CDT code selections.'
    };
  }

  if (text.includes('multiple active primary')) {
    return {
      summary: 'More than one primary policy is active for the date of service.',
      cause: 'Overlapping coverage makes it unclear which policy should pay first.',
      fix: 'Confirm the correct primary policy with the patient and update the claim.'
    };
  }

  if (text.includes('insurance changed near')) {
    return {
      summary: 'Insurance coverage changed close to the date of service.',
      cause: 'The claim may be billed to the wrong payer or with the wrong effective dates.',
      fix: 'Verify coverage dates, update the insurance snapshot, and resubmit if needed.'
    };
  }

  if (text.includes('insurance policy updated after visit')) {
    return {
      summary: 'A policy was updated after the visit date.',
      cause: 'Prior claims may have been billed with outdated coverage details.',
      fix: 'Review the updated policy dates and refresh the claim packet if it should change.'
    };
  }

  if (text.includes('adjustment after balance reached zero')) {
    return {
      summary: 'An adjustment posted after the balance hit zero.',
      cause: 'Post-zero adjustments can invalidate the patient explanation or create a hidden credit.',
      fix: 'Review the adjustment timing, update the patient statement, and apply any credits.'
    };
  }

  if (text.includes('unapplied credit')) {
    return {
      summary: 'A credit has been sitting on the account without being applied.',
      cause: 'Credits are not being applied to open balances or refunded promptly.',
      fix: 'Apply the credit to an open charge or issue a refund and document the action.'
    };
  }

  if (text.includes('claim marked denied')) {
    return {
      summary: 'The payer denied the claim.',
      cause: 'The denial must be addressed before collection or resubmission.',
      fix: 'Review denial reason details and resubmit or bill patient appropriately.'
    };
  }

  if (text.includes('front desk follow-up')) {
    return {
      summary: 'Front desk follow-up is required for this patient.',
      cause: 'Missing documentation, insurance confirmation, or patient contact is pending.',
      fix: 'Contact the patient and update intake or insurance details.'
    };
  }

  return {
    summary: 'This flag requires review.',
    cause: 'The system detected a condition that needs manual confirmation.',
    fix: recommendedAction ?? 'Review the claim details and update the record as needed.'
  };
}
