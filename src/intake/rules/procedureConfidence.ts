import type { CandidateCode } from './procedure';

export type ConfidenceFactor = {
  name: string;
  rawValue: number;
  normalizedValue: number;
  weight: number;
  contribution: number;
};

export type ProcedureConfidence = {
  confidenceScore: number;
  confidenceLevel: 'high' | 'medium' | 'low';
  factors: ConfidenceFactor[];
  explanation: string;
};

type AttributeName = 'tooth' | 'surface' | 'quadrant' | 'material';

type AttributeEvidence = Record<AttributeName, number>;

const STOP_WORDS = new Set([
  // Standard stop words used for deterministic token normalization.
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

const FACTOR_WEIGHTS = {
  // Semantic match is the primary signal for intent alignment.
  semanticMatch: 0.35,
  // Attribute completeness enforces clinical specificity (tooth/surface/quadrant/material).
  attributeCompleteness: 0.2,
  // Ambiguity penalizes close competitors to avoid overconfidence.
  ambiguity: 0.2,
  // Rule consistency guards against explicit contradictions.
  ruleConsistency: 0.15,
  // Evidence coverage captures how much text is explained by the candidate description.
  evidenceCoverage: 0.1
} as const;

const TOTAL_WEIGHT =
  FACTOR_WEIGHTS.semanticMatch +
  FACTOR_WEIGHTS.attributeCompleteness +
  FACTOR_WEIGHTS.ambiguity +
  FACTOR_WEIGHTS.ruleConsistency +
  FACTOR_WEIGHTS.evidenceCoverage;

const CONFIDENCE_THRESHOLDS = {
  // High confidence is reserved for strong evidence across most factors.
  high: 0.85,
  // Medium confidence reflects partial evidence or moderate competition.
  medium: 0.65
} as const;

const COMPETITION_MARGIN_FULL = 0.25;
// A 0.25 gap on a 0-1 match scale indicates a clear separation between candidates.

const CONFLICT_PENALTY = 0.5;
// Each explicit contradiction halves rule consistency; two conflicts drive it to zero.

const PARTIAL_EVIDENCE = 0.5;
// Partial credit for generic attribute mentions without specificity.

const PEDIATRIC_AGE_CUTOFF = 14;
// Mirrors common dental intake conventions and existing rule-based mapping.

const MATERIAL_TOKENS = [
  'composite',
  'amalgam',
  'resin',
  'ceramic',
  'porcelain',
  'gold',
  'metal',
  'zirconia',
  'stainless',
  'titanium'
];

const SURFACE_TOKENS = [
  'occlusal',
  'mesial',
  'distal',
  'buccal',
  'lingual',
  'facial',
  'incisal',
  'mo',
  'do',
  'mod',
  'ol',
  'ob',
  'mb',
  'db',
  'ml',
  'dl',
  'fl',
  'bl',
  'li',
  'il',
  'io',
  'mf',
  'df'
];

const QUADRANT_TOKENS = [
  'ur',
  'ul',
  'lr',
  'll',
  'quadrant',
  'quad',
  'upper',
  'lower',
  'left',
  'right',
  'maxillary',
  'mandibular'
];

const TOOTH_NUMBER_PATTERN = /(?:tooth|#)\s*([1-9]|[12]\d|3[0-2]|[a-t])\b/i;
const TOOTH_WORD_PATTERN = /\b(tooth|teeth)\b/i;
const SURFACE_WORD_PATTERN = /\b(occlusal|mesial|distal|buccal|lingual|facial|incisal)\b/i;
const SURFACE_COMBO_PATTERN = /\b(mo|do|mod|ol|ob|mb|db|ml|dl|fl|bl|li|il|io|mf|df)\b/i;
const SURFACE_COUNT_PATTERN = /\b(1|2|3|4)\s*surface(s)?\b/i;
const QUADRANT_PATTERN = /\b(ur|ul|lr|ll|quadrant|quad)\b/i;
const ARCH_PATTERN = /\b(upper|lower|maxillary|mandibular)\b/i;
const SIDE_PATTERN = /\b(left|right)\b/i;
const MATERIAL_PATTERN = /\b(composite|amalgam|resin|ceramic|porcelain|gold|metal|zirconia|stainless|titanium)\b/i;

const TOOTH_REQUIRED_TRIGGERS = [
  /\btooth\b/i,
  /\bteeth\b/i,
  /\bextraction\b/i,
  /\bcrown\b/i,
  /\bfilling\b/i,
  /\brestoration\b/i,
  /\broot canal\b/i,
  /\bendo\b/i,
  /\bimplant\b/i,
  /\bveneer\b/i,
  /\bbridge\b/i,
  /\binlay\b/i,
  /\bonlay\b/i,
  /\bsealant\b/i,
  /\bperiapical\b/i,
  /\bpulp\b/i,
  /\bpost\b/i,
  /\bcore\b/i,
  /\bbuildup\b/i
];

const SURFACE_REQUIRED_TRIGGERS = [
  /\bfilling\b/i,
  /\brestoration\b/i,
  /\bsealant\b/i,
  /\bcomposite\b/i,
  /\bamalgam\b/i,
  /\binlay\b/i,
  /\bonlay\b/i,
  /\bsurface\b/i
];

const QUADRANT_REQUIRED_TRIGGERS = [
  /\bquadrant\b/i,
  /\bquad\b/i,
  /\bscaling\b/i,
  /\broot planing\b/i,
  /\bsrp\b/i,
  /\bperiodontal\b/i
];

const MATERIAL_REQUIRED_TRIGGERS = [
  /\bfilling\b/i,
  /\brestoration\b/i,
  /\bcrown\b/i,
  /\binlay\b/i,
  /\bonlay\b/i,
  /\bveneer\b/i
];

function clamp01(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(value, 0), 1);
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tokenize(value: string): string[] {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token))
    .filter((token) => token.length > 1 || /\d/.test(token));
}

function inferRequiredAttributes(text: string): AttributeName[] {
  const required = new Set<AttributeName>();
  if (TOOTH_REQUIRED_TRIGGERS.some((pattern) => pattern.test(text))) {
    required.add('tooth');
  }
  if (SURFACE_REQUIRED_TRIGGERS.some((pattern) => pattern.test(text))) {
    required.add('surface');
  }
  if (QUADRANT_REQUIRED_TRIGGERS.some((pattern) => pattern.test(text))) {
    required.add('quadrant');
  }
  if (MATERIAL_REQUIRED_TRIGGERS.some((pattern) => pattern.test(text))) {
    required.add('material');
  }
  return Array.from(required.values());
}

function detectAttributeEvidence(text: string): AttributeEvidence {
  let toothScore = 0;
  if (TOOTH_NUMBER_PATTERN.test(text)) {
    toothScore = 1;
  } else if (TOOTH_WORD_PATTERN.test(text)) {
    toothScore = PARTIAL_EVIDENCE;
  }

  let surfaceScore = 0;
  if (SURFACE_WORD_PATTERN.test(text) || SURFACE_COMBO_PATTERN.test(text)) {
    surfaceScore = 1;
  } else if (SURFACE_COUNT_PATTERN.test(text) || /\bsurface(s)?\b/i.test(text)) {
    surfaceScore = PARTIAL_EVIDENCE;
  }

  let quadrantScore = 0;
  const hasQuadrant = QUADRANT_PATTERN.test(text);
  const hasArch = ARCH_PATTERN.test(text);
  const hasSide = SIDE_PATTERN.test(text);
  if (hasQuadrant || (hasArch && hasSide)) {
    quadrantScore = 1;
  } else if (hasArch || hasSide) {
    quadrantScore = PARTIAL_EVIDENCE;
  }

  const materialScore = MATERIAL_PATTERN.test(text) ? 1 : 0;

  return {
    tooth: toothScore,
    surface: surfaceScore,
    quadrant: quadrantScore,
    material: materialScore
  };
}

function collectAttributeTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const token of tokenize(text)) {
    if (MATERIAL_TOKENS.includes(token) || SURFACE_TOKENS.includes(token) || QUADRANT_TOKENS.includes(token)) {
      tokens.add(token);
    }
  }
  const toothPattern = new RegExp(TOOTH_NUMBER_PATTERN.source, 'ig');
  const toothMatches = text.matchAll(toothPattern);
  for (const match of toothMatches) {
    if (match[1]) {
      tokens.add(match[1].toLowerCase());
    }
  }
  if (TOOTH_WORD_PATTERN.test(text)) {
    tokens.add('tooth');
    tokens.add('teeth');
  }
  return tokens;
}

function detectBitewingCount(text: string): number | null {
  if (!/bitewing/i.test(text)) {
    return null;
  }
  const match = text.match(/\b(2|4)\b/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function detectPeriapicalType(text: string): 'first' | 'additional' | null {
  if (!/periapical|pa x-ray|periapical x-ray/i.test(text)) {
    return null;
  }
  if (/\b(first|initial|1)\b/i.test(text)) {
    return 'first';
  }
  if (/\b(additional|extra|2|3)\b/i.test(text)) {
    return 'additional';
  }
  return null;
}

function detectAgePreference(text: string): 'adult' | 'child' | null {
  if (/\b(child|pediatric|kid|kids)\b/i.test(text)) {
    return 'child';
  }
  if (/\badult\b/i.test(text)) {
    return 'adult';
  }
  return null;
}

function detectExamType(text: string): 'periodic' | 'comprehensive' | null {
  if (/\bperiodic\b/i.test(text)) {
    return 'periodic';
  }
  if (/\bcomprehensive\b/i.test(text)) {
    return 'comprehensive';
  }
  return null;
}

function detectRuleConflicts(
  text: string,
  candidate: CandidateCode | undefined,
  patientAge?: number
): string[] {
  if (!candidate) {
    return [];
  }
  const conflicts: string[] = [];

  const agePreference = detectAgePreference(text);
  if (candidate.code === 'D1110') {
    if ((patientAge !== undefined && patientAge < PEDIATRIC_AGE_CUTOFF) || agePreference === 'child') {
      conflicts.push('Adult prophylaxis selected for a child context.');
    }
  }
  if (candidate.code === 'D1120') {
    if ((patientAge !== undefined && patientAge >= PEDIATRIC_AGE_CUTOFF) || agePreference === 'adult') {
      conflicts.push('Child prophylaxis selected for an adult context.');
    }
  }

  const bitewingCount = detectBitewingCount(text);
  if (bitewingCount === 2 && candidate.code === 'D0274') {
    conflicts.push('Bitewing count specifies 2 images but code is for 4.');
  }
  if (bitewingCount === 4 && candidate.code === 'D0272') {
    conflicts.push('Bitewing count specifies 4 images but code is for 2.');
  }

  const periapicalType = detectPeriapicalType(text);
  if (periapicalType === 'first' && candidate.code === 'D0230') {
    conflicts.push('Periapical note indicates the first image but code is additional.');
  }
  if (periapicalType === 'additional' && candidate.code === 'D0220') {
    conflicts.push('Periapical note indicates additional image but code is first.');
  }

  const examType = detectExamType(text);
  if (examType === 'periodic' && candidate.code === 'D0150') {
    conflicts.push('Periodic exam mentioned but code is comprehensive.');
  }
  if (examType === 'comprehensive' && candidate.code === 'D0120') {
    conflicts.push('Comprehensive exam mentioned but code is periodic.');
  }

  if (/\bpanoramic|pano\b/i.test(text) && candidate.code !== 'D0330' && !/panoramic/i.test(candidate.label)) {
    conflicts.push('Panoramic imaging noted but selected code is not panoramic.');
  }

  return conflicts;
}

function classifyConfidence(score: number): ProcedureConfidence['confidenceLevel'] {
  if (score >= CONFIDENCE_THRESHOLDS.high) {
    return 'high';
  }
  if (score >= CONFIDENCE_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'low';
}

function formatMatchSource(source?: CandidateCode['matchSource']): string {
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

function buildFactor(name: string, rawValue: number, normalizedValue: number, weight: number): ConfidenceFactor {
  const normalized = clamp01(normalizedValue);
  return {
    name,
    rawValue,
    normalizedValue: normalized,
    weight,
    contribution: normalized * weight
  };
}

export function buildProcedureConfidence(input: {
  freeText: string;
  normalizedText?: string;
  candidateCodes: CandidateCode[];
  patientAge?: number;
}): ProcedureConfidence {
  const normalizedText = input.normalizedText ? normalizeText(input.normalizedText) : normalizeText(input.freeText);
  const candidates = Array.isArray(input.candidateCodes) ? input.candidateCodes : [];
  const rankedCandidates = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const topCandidate = rankedCandidates[0];
  const runnerUp = rankedCandidates[1];

  if (!topCandidate) {
    const factors = [
      buildFactor('Semantic Match Quality', 0, 0, FACTOR_WEIGHTS.semanticMatch),
      buildFactor('Attribute Completeness', 0, 0, FACTOR_WEIGHTS.attributeCompleteness),
      buildFactor('Ambiguity & Competition', 0, 0, FACTOR_WEIGHTS.ambiguity),
      buildFactor('Rule Consistency', 0, 0, FACTOR_WEIGHTS.ruleConsistency),
      buildFactor('Evidence Coverage', 0, 0, FACTOR_WEIGHTS.evidenceCoverage)
    ];
    return {
      confidenceScore: 0,
      confidenceLevel: 'low',
      factors,
      explanation: 'No candidate procedures matched the intake text; confidence is low by design.'
    };
  }

  const semanticRaw = clamp01(topCandidate.confidence);
  const semanticFactor = buildFactor(
    'Semantic Match Quality',
    semanticRaw,
    semanticRaw,
    FACTOR_WEIGHTS.semanticMatch
  );

  const evidenceText = normalizeText(
    [topCandidate.code, topCandidate.label, topCandidate.category, topCandidate.notes, topCandidate.patientDescription]
      .filter(Boolean)
      .join(' ')
  );
  const requiredAttributes = inferRequiredAttributes(`${normalizedText} ${evidenceText}`);
  const attributeEvidence = detectAttributeEvidence(normalizedText);
  const expectedCount = requiredAttributes.length;
  const attributeScore =
    expectedCount === 0
      ? 1
      : requiredAttributes.reduce((sum, attribute) => sum + attributeEvidence[attribute], 0) / expectedCount;
  const attributeFactor = buildFactor(
    'Attribute Completeness',
    attributeScore,
    attributeScore,
    FACTOR_WEIGHTS.attributeCompleteness
  );

  const margin = runnerUp ? clamp01(topCandidate.confidence - runnerUp.confidence) : 1;
  const ambiguityNormalized = runnerUp ? clamp01(margin / COMPETITION_MARGIN_FULL) : 1;
  const ambiguityFactor = buildFactor(
    'Ambiguity & Competition',
    margin,
    ambiguityNormalized,
    FACTOR_WEIGHTS.ambiguity
  );

  const conflicts = detectRuleConflicts(normalizedText, topCandidate, input.patientAge);
  const ruleConsistencyRaw = conflicts.length;
  const ruleConsistencyNormalized = clamp01(1 - CONFLICT_PENALTY * conflicts.length);
  const ruleConsistencyFactor = buildFactor(
    'Rule Consistency',
    ruleConsistencyRaw,
    ruleConsistencyNormalized,
    FACTOR_WEIGHTS.ruleConsistency
  );

  const inputTokens = new Set(tokenize(normalizedText));
  const attributeTokens = collectAttributeTokens(normalizedText);
  const filteredInputTokens = Array.from(inputTokens).filter((token) => !attributeTokens.has(token));
  const evidenceTokens = new Set(tokenize(evidenceText));
  const coveredTokens = filteredInputTokens.filter((token) => evidenceTokens.has(token));
  const coverageRaw =
    filteredInputTokens.length === 0 ? 1 : coveredTokens.length / filteredInputTokens.length;
  const evidenceCoverageFactor = buildFactor(
    'Evidence Coverage',
    coverageRaw,
    coverageRaw,
    FACTOR_WEIGHTS.evidenceCoverage
  );

  const factors = [
    semanticFactor,
    attributeFactor,
    ambiguityFactor,
    ruleConsistencyFactor,
    evidenceCoverageFactor
  ];
  const weightedSum = factors.reduce((sum, factor) => sum + factor.contribution, 0);
  const confidenceScore = clamp01(weightedSum / TOTAL_WEIGHT);
  const confidenceLevel = classifyConfidence(confidenceScore);

  const missingAttributes =
    expectedCount === 0
      ? []
      : requiredAttributes.filter((attribute) => attributeEvidence[attribute] < 1);
  const attributeSummary =
    expectedCount === 0
      ? 'No required attributes detected in the note.'
      : `Required attributes present ${expectedCount - missingAttributes.length}/${expectedCount}${
          missingAttributes.length > 0 ? `; missing ${missingAttributes.join(', ')}.` : '.'
        }`;
  const competitionSummary = runnerUp
    ? `Competition: ${topCandidate.code} leads ${runnerUp.code} by margin ${margin.toFixed(2)}.`
    : 'No close competing codes detected.';
  const conflictSummary =
    conflicts.length === 0 ? 'No rule conflicts detected.' : `Rule conflicts: ${conflicts.join(' ')}`;
  const evidenceSummary = `Evidence coverage ${Math.round(coverageRaw * 100)}% of non-attribute terms.`;
  const matchSource = topCandidate.matchSource ? `Matched by ${formatMatchSource(topCandidate.matchSource)}. ` : '';
  const topLabel = topCandidate.label || topCandidate.code;
  const explanation = [
    `Top candidate ${topCandidate.code} (${topLabel}).`,
    `${matchSource}Semantic match ${semanticRaw.toFixed(2)}.`,
    attributeSummary,
    competitionSummary,
    conflictSummary,
    evidenceSummary,
    `Overall confidence ${confidenceScore.toFixed(2)} (${confidenceLevel}).`
  ]
    .filter(Boolean)
    .join(' ');

  return {
    confidenceScore,
    confidenceLevel,
    factors,
    explanation
  };
}
