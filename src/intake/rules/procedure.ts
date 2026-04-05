import { buildProcedureConfidence } from './procedureConfidence';
import type { ProcedureConfidence } from './procedureConfidence';

export type CandidateCode = {
  code: string;
  label: string;
  confidence: number;
  rationale: string;
  suggested?: boolean;
  category?: string;
  notes?: string;
  patientDescription?: string;
  estimatedCopay?: number;
  copayRate?: number;
  copayBasis?: string;
  matchSource?: 'code' | 'description' | 'notes' | 'patientDescription' | 'category';
};

export type NormalizedProcedure = {
  freeText: string;
  normalizedText: string;
  confidence: number;
  rationale: string;
  candidateCodes: CandidateCode[];
  needsConfirmation: boolean;
  clarifyingQuestion?: string;
  confidenceDetails?: ProcedureConfidence;
};

const cleaningPatterns = [/cleaning/i, /prophy/i];
const bitewingPattern = /bitewing/i;
const panoramicPattern = /panoramic|pano/i;
const periodicPattern = /periodic/i;
const comprehensivePattern = /comprehensive/i;
const fluoridePattern = /fluoride|varnish/i;
const periapicalPattern = /periapical|pa x-ray|periapical x-ray/i;
const PEDIATRIC_AGE_CUTOFF = 14;
// Aligns with common dental intake conventions for pediatric prophylaxis.

export function splitProcedures(text: string): string[] {
  return text
    .split(/\n|,|;|\band\b/i)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeProcedureText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function mapProcedureIntent(text: string, patientAge?: number): NormalizedProcedure {
  const normalized = normalizeProcedureText(text);
  const candidateCodes: CandidateCode[] = [];
  let confidence = 0.4;
  let rationale = 'Manual confirmation required.';
  let needsConfirmation = true;
  let clarifyingQuestion: string | undefined;

  if (cleaningPatterns.some((pattern) => pattern.test(normalized))) {
    const isChild = patientAge !== undefined && patientAge < PEDIATRIC_AGE_CUTOFF;
    const suggested = isChild ? 'D1120' : 'D1110';
    candidateCodes.push(
      {
        code: 'D1110',
        label: 'Adult cleaning',
        confidence: isChild ? 0.42 : 0.62,
        rationale: 'Suggested for adult prophylaxis based on age.',
        suggested: suggested === 'D1110'
      },
      {
        code: 'D1120',
        label: 'Child cleaning',
        confidence: isChild ? 0.62 : 0.42,
        rationale: 'Suggested for pediatric prophylaxis based on age.',
        suggested: suggested === 'D1120'
      }
    );
    confidence = 0.62;
    rationale = 'Cleaning intent detected; requires confirmation of age-specific code.';
    needsConfirmation = true;
    clarifyingQuestion = 'Confirm whether the cleaning should be billed as adult or child.';
  } else if (bitewingPattern.test(normalized)) {
    const countMatch = normalized.match(/\b(2|4)\b/);
    if (countMatch?.[1] === '2') {
      candidateCodes.push({
        code: 'D0272',
        label: 'Bitewing images (2)',
        confidence: 0.92,
        rationale: 'Explicit count of 2 images detected.',
        suggested: true
      });
      confidence = 0.92;
      rationale = 'Bitewing imaging with count 2 detected.';
      needsConfirmation = false;
    } else if (countMatch?.[1] === '4') {
      candidateCodes.push({
        code: 'D0274',
        label: 'Bitewing images (4)',
        confidence: 0.92,
        rationale: 'Explicit count of 4 images detected.',
        suggested: true
      });
      confidence = 0.92;
      rationale = 'Bitewing imaging with count 4 detected.';
      needsConfirmation = false;
    } else {
      candidateCodes.push(
        {
          code: 'D0272',
          label: 'Bitewing images (2)',
          confidence: 0.55,
          rationale: 'Bitewing mentioned without image count.',
          suggested: false
        },
        {
          code: 'D0274',
          label: 'Bitewing images (4)',
          confidence: 0.55,
          rationale: 'Bitewing mentioned without image count.',
          suggested: false
        }
      );
      confidence = 0.55;
      rationale = 'Bitewing imaging detected but count is missing.';
      needsConfirmation = true;
      clarifyingQuestion = 'How many bitewing images were taken (2 or 4)?';
    }
  } else if (panoramicPattern.test(normalized)) {
    candidateCodes.push({
      code: 'D0330',
      label: 'Panoramic image',
      confidence: 0.9,
      rationale: 'Panoramic imaging detected.',
      suggested: true
    });
    confidence = 0.9;
    rationale = 'Panoramic imaging detected.';
    needsConfirmation = false;
  } else if (periodicPattern.test(normalized)) {
    candidateCodes.push({
      code: 'D0120',
      label: 'Routine exam',
      confidence: 0.9,
      rationale: 'Periodic exam detected.',
      suggested: true
    });
    confidence = 0.9;
    rationale = 'Periodic exam detected.';
    needsConfirmation = false;
  } else if (comprehensivePattern.test(normalized)) {
    candidateCodes.push({
      code: 'D0150',
      label: 'Comprehensive exam',
      confidence: 0.9,
      rationale: 'Comprehensive exam detected.',
      suggested: true
    });
    confidence = 0.9;
    rationale = 'Comprehensive exam detected.';
    needsConfirmation = false;
  } else if (fluoridePattern.test(normalized)) {
    candidateCodes.push({
      code: 'D1206',
      label: 'Fluoride varnish',
      confidence: 0.9,
      rationale: 'Fluoride varnish detected.',
      suggested: true
    });
    confidence = 0.9;
    rationale = 'Fluoride varnish detected.';
    needsConfirmation = false;
  } else if (periapicalPattern.test(normalized)) {
    if (/first|initial|1/.test(normalized)) {
      candidateCodes.push({
        code: 'D0220',
        label: 'Periapical image (first)',
        confidence: 0.88,
        rationale: 'First periapical image noted.',
        suggested: true
      });
      confidence = 0.88;
      rationale = 'Periapical first image detected.';
      needsConfirmation = false;
    } else if (/additional|extra|2|3/.test(normalized)) {
      candidateCodes.push({
        code: 'D0230',
        label: 'Periapical image (additional)',
        confidence: 0.88,
        rationale: 'Additional periapical image noted.',
        suggested: true
      });
      confidence = 0.88;
      rationale = 'Periapical additional image detected.';
      needsConfirmation = false;
    } else {
      candidateCodes.push(
        {
          code: 'D0220',
          label: 'Periapical image (first)',
          confidence: 0.55,
          rationale: 'Periapical imaging detected without count.',
          suggested: false
        },
        {
          code: 'D0230',
          label: 'Periapical image (additional)',
          confidence: 0.55,
          rationale: 'Periapical imaging detected without count.',
          suggested: false
        }
      );
      confidence = 0.55;
      rationale = 'Periapical imaging detected but count is missing.';
      needsConfirmation = true;
      clarifyingQuestion = 'Was this the first periapical image or an additional one?';
    }
  }

  const confidenceDetails = buildProcedureConfidence({
    freeText: text,
    normalizedText: normalized,
    candidateCodes,
    patientAge
  });
  confidence = confidenceDetails.confidenceScore;
  rationale = confidenceDetails.explanation;

  return {
    freeText: text,
    normalizedText: normalized,
    confidence,
    rationale,
    candidateCodes,
    needsConfirmation,
    clarifyingQuestion,
    confidenceDetails
  };
}
