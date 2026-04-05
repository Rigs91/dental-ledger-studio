import type { CandidateCode, NormalizedProcedure } from './procedure';
import { normalizeProcedureText } from './procedure';
import { buildProcedureConfidence } from './procedureConfidence';

export type ProcedureCatalogEntry = {
  code: string;
  category: string;
  description: string;
  notes: string | null;
  patientDescription: string | null;
  estimatedCopayAvg?: number | string | { toString(): string } | null;
  copayRate?: number | null;
  copayBasis?: string | null;
};

type MatchSource = 'code' | 'description' | 'notes' | 'patientDescription' | 'category';

const STOP_WORDS = new Set([
  'the',
  'and',
  'or',
  'for',
  'to',
  'of',
  'a',
  'an',
  'in',
  'on',
  'per',
  'each',
  'with',
  'without',
  'by',
  'at',
  'from',
  'this',
  'that',
  'is',
  'are',
  'was',
  'were',
  'be',
  'as',
  'into',
  'over',
  'under',
  'after',
  'before'
]);

const SCORE_WEIGHTS: Record<MatchSource, number> = {
  code: 0.99,
  description: 0.95,
  notes: 0.9,
  patientDescription: 0.9,
  category: 0.6
};

const MIN_SCORE = 0.45;

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isNaN(value) ? null : value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (value && typeof value === 'object' && 'toString' in value) {
    const parsed = Number(String(value));
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function tokenize(value: string): string[] {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => token.length > 1 || /\d/.test(token));
}

function scoreTokens(inputTokens: string[], fieldTokens: string[]): number {
  if (inputTokens.length === 0 || fieldTokens.length === 0) {
    return 0;
  }
  const fieldSet = new Set(fieldTokens);
  let matches = 0;
  for (const token of inputTokens) {
    if (fieldSet.has(token)) {
      matches += 1;
    }
  }
  if (matches === 0) {
    return 0;
  }
  const inputCoverage = matches / inputTokens.length;
  const fieldCoverage = matches / fieldTokens.length;
  return 0.7 * inputCoverage + 0.3 * fieldCoverage;
}

function scoreField(
  inputNormalized: string,
  inputTokens: string[],
  fieldValue: string | null | undefined,
  weight: number
): number {
  if (!fieldValue) {
    return 0;
  }
  const fieldNormalized = normalizeProcedureText(fieldValue);
  if (!fieldNormalized) {
    return 0;
  }
  if (fieldNormalized === inputNormalized) {
    return weight;
  }
  if (fieldNormalized.includes(inputNormalized) || inputNormalized.includes(fieldNormalized)) {
    return Math.max(weight * 0.85, weight * 0.75);
  }
  const overlap = scoreTokens(inputTokens, tokenize(fieldNormalized));
  return overlap * weight;
}

function formatMatchSource(source?: MatchSource): string {
  switch (source) {
    case 'patientDescription':
      return 'patient description';
    case 'description':
      return 'procedure description';
    case 'notes':
      return 'notes';
    case 'category':
      return 'category';
    case 'code':
      return 'CDT code';
    default:
      return 'catalog';
  }
}

export function buildCatalogCandidates(
  inputText: string,
  catalog: ProcedureCatalogEntry[],
  patientAge?: number
): CandidateCode[] {
  const normalized = normalizeProcedureText(inputText);
  if (!normalized) {
    return [];
  }
  const inputTokens = tokenize(normalized);
  const candidates: CandidateCode[] = [];

  for (const entry of catalog) {
    const codeLower = entry.code.toLowerCase();
    let bestScore = 0;
    let bestSource: MatchSource | undefined;

    if (normalized.includes(codeLower)) {
      bestScore = SCORE_WEIGHTS.code;
      bestSource = 'code';
    } else {
      const descriptionScore = scoreField(normalized, inputTokens, entry.description, SCORE_WEIGHTS.description);
      const notesScore = scoreField(normalized, inputTokens, entry.notes, SCORE_WEIGHTS.notes);
      const patientScore = scoreField(normalized, inputTokens, entry.patientDescription, SCORE_WEIGHTS.patientDescription);
      const categoryScore = scoreField(normalized, inputTokens, entry.category, SCORE_WEIGHTS.category);

      const scores: Array<{ source: MatchSource; score: number }> = [
        { source: 'description', score: descriptionScore },
        { source: 'notes', score: notesScore },
        { source: 'patientDescription', score: patientScore },
        { source: 'category', score: categoryScore }
      ];
      const best = scores.reduce((current, next) => (next.score > current.score ? next : current), {
        source: 'description',
        score: 0
      });
      bestScore = best.score;
      bestSource = best.score > 0 ? best.source : undefined;
    }

    if (patientAge !== undefined) {
      const hasChildToken = inputTokens.includes('child') || inputTokens.includes('kid') || inputTokens.includes('kids');
      const hasAdultToken = inputTokens.includes('adult');
      if (entry.code === 'D1120' && (hasChildToken || patientAge < 14)) {
        bestScore += 0.05;
      }
      if (entry.code === 'D1110' && (hasAdultToken || patientAge >= 14)) {
        bestScore += 0.05;
      }
    }

    if (bestScore >= MIN_SCORE) {
      const copayAvg = toNumber(entry.estimatedCopayAvg);
      candidates.push({
        code: entry.code,
        label: entry.description,
        confidence: Math.min(bestScore, 0.99),
        rationale: bestSource
          ? `Matched ${formatMatchSource(bestSource)}.`
          : 'Matched procedure catalog.',
        suggested: false,
        category: entry.category,
        notes: entry.notes ?? undefined,
        patientDescription: entry.patientDescription ?? undefined,
        estimatedCopay: copayAvg ?? undefined,
        copayRate: typeof entry.copayRate === 'number' ? entry.copayRate : undefined,
        copayBasis: entry.copayBasis ?? undefined,
        matchSource: bestSource
      });
    }
  }

  return candidates.sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

function attachCatalogDetails(candidate: CandidateCode, catalogByCode: Map<string, ProcedureCatalogEntry>): CandidateCode {
  const entry = catalogByCode.get(candidate.code);
  if (!entry) {
    return candidate;
  }
  const copayAvg = toNumber(entry.estimatedCopayAvg);
  return {
    ...candidate,
    label: entry.description || candidate.label,
    category: candidate.category ?? entry.category,
    notes: candidate.notes ?? entry.notes ?? undefined,
    patientDescription: candidate.patientDescription ?? entry.patientDescription ?? undefined,
    estimatedCopay:
      candidate.estimatedCopay ??
      (copayAvg !== null ? copayAvg : undefined),
    copayRate: candidate.copayRate ?? (typeof entry.copayRate === 'number' ? entry.copayRate : undefined),
    copayBasis: candidate.copayBasis ?? entry.copayBasis ?? undefined
  };
}

export function enrichNormalizedWithCatalog(
  base: NormalizedProcedure,
  catalog: ProcedureCatalogEntry[],
  patientAge?: number
): NormalizedProcedure {
  if (catalog.length === 0) {
    return base;
  }
  const catalogCandidates = buildCatalogCandidates(base.freeText, catalog, patientAge);
  const catalogByCode = new Map(catalog.map((entry) => [entry.code, entry]));
  const baseCandidates = Array.isArray(base.candidateCodes) ? base.candidateCodes : [];
  const filteredBaseCandidates = baseCandidates.filter((candidate) => catalogByCode.has(candidate.code));

  const merged = new Map<string, CandidateCode>();
  for (const candidate of filteredBaseCandidates) {
    merged.set(candidate.code, attachCatalogDetails(candidate, catalogByCode));
  }
  for (const candidate of catalogCandidates) {
    const existing = merged.get(candidate.code);
    if (!existing) {
      merged.set(candidate.code, candidate);
      continue;
    }
    merged.set(candidate.code, {
      ...existing,
      label: candidate.label || existing.label,
      confidence: Math.max(existing.confidence, candidate.confidence),
      matchSource: existing.matchSource ?? candidate.matchSource,
      category: existing.category ?? candidate.category,
      notes: existing.notes ?? candidate.notes,
      patientDescription: existing.patientDescription ?? candidate.patientDescription,
      rationale: existing.rationale.includes('Catalog')
        ? existing.rationale
        : `${existing.rationale} ${candidate.rationale}`
    });
  }

  let mergedCandidates = Array.from(merged.values()).sort((a, b) => b.confidence - a.confidence);
  const topCandidate = mergedCandidates[0];
  const runnerUp = mergedCandidates[1];

  let needsConfirmation = base.needsConfirmation;
  let clarifyingQuestion = base.clarifyingQuestion;
  if (topCandidate) {
    const ambiguous =
      topCandidate.confidence < 0.75 || (runnerUp && topCandidate.confidence - runnerUp.confidence < 0.12);
    if (ambiguous) {
      needsConfirmation = true;
      if (!clarifyingQuestion && runnerUp) {
        clarifyingQuestion = `Confirm whether this should be billed as ${topCandidate.code} or ${runnerUp.code}.`;
      } else if (!clarifyingQuestion) {
        clarifyingQuestion = 'Confirm the CDT code that best matches the note.';
      }
    }
  }

  let suggestedCode = mergedCandidates.find((candidate) => candidate.suggested)?.code;
  if (!suggestedCode && mergedCandidates.length > 0) {
    suggestedCode = mergedCandidates[0].code;
  }
  if (suggestedCode) {
    mergedCandidates = mergedCandidates.map((candidate) => ({
      ...candidate,
      suggested: candidate.code === suggestedCode
    }));
  }

  const confidenceDetails = buildProcedureConfidence({
    freeText: base.freeText,
    normalizedText: base.normalizedText,
    candidateCodes: mergedCandidates,
    patientAge
  });

  return {
    ...base,
    confidence: confidenceDetails.confidenceScore,
    rationale: confidenceDetails.explanation,
    candidateCodes: mergedCandidates,
    needsConfirmation,
    clarifyingQuestion,
    confidenceDetails
  };
}
