import { describe, it, expect } from 'vitest';
import { mapProcedureIntent, splitProcedures } from '../rules/procedure';
import { enrichNormalizedWithCatalog } from '../rules/procedureCatalog';

describe('mapProcedureIntent', () => {
  it('flags cleaning as needing confirmation', () => {
    const result = mapProcedureIntent('cleaning / prophy', 30);
    expect(result.needsConfirmation).toBe(true);
    expect(result.candidateCodes.length).toBeGreaterThan(1);
  });

  it('maps bitewing count', () => {
    const result = mapProcedureIntent('bitewing x-rays 4', 20);
    expect(result.candidateCodes[0].code).toBe('D0274');
    expect(result.needsConfirmation).toBe(false);
  });

  it('splits procedures by newline or "and"', () => {
    const items = splitProcedures('cleaning and fluoride\nperiodic exam');
    expect(items).toEqual(['cleaning', 'fluoride', 'periodic exam']);
  });

  it('matches patient description from the catalog', () => {
    const base = mapProcedureIntent('laughing gas', 32);
    const catalog = [
      {
        code: 'D9230',
        category: 'Adjunctive',
        description: 'Nitrous Oxide',
        notes: '"Laughing gas".',
        patientDescription: 'Laughing gas'
      }
    ];
    const normalized = enrichNormalizedWithCatalog(base, catalog, 32);
    expect(normalized.candidateCodes[0].code).toBe('D9230');
    expect(normalized.candidateCodes[0].patientDescription).toBe('Laughing gas');
  });

  it('returns high confidence for a clear match with complete evidence', () => {
    const result = mapProcedureIntent('bitewing x-rays 4', 22);
    expect(result.confidenceDetails).toBeDefined();
    expect(result.confidenceDetails?.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(result.confidenceDetails?.confidenceScore).toBeLessThanOrEqual(1);
    expect(result.confidenceDetails?.confidenceLevel).toBe('high');
    expect(result.confidenceDetails?.explanation).toMatch(/Overall confidence/i);
  });

  it('returns medium confidence when competition exists', () => {
    const result = mapProcedureIntent('cleaning / prophy', 30);
    expect(result.confidenceDetails).toBeDefined();
    expect(result.confidenceDetails?.confidenceLevel).toBe('medium');
    expect(result.confidenceDetails?.explanation).toMatch(/Competition:/i);
  });

  it('returns low confidence for ambiguous input', () => {
    const result = mapProcedureIntent('bitewing x-rays', 20);
    expect(result.confidenceDetails).toBeDefined();
    expect(result.confidenceDetails?.confidenceLevel).toBe('low');
    expect(result.confidenceDetails?.explanation).toMatch(/Competition:/i);
  });
});
