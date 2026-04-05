import type { NormalizedProcedure } from '@/intake/rules/procedure';
import type { LedgerEvent } from '@prisma/client';

export type BalanceExplanationResult = {
  text: string;
  source: 'rule-based' | 'openai' | 'local';
};

export type RootCauseSummaryResult = {
  text: string;
  source: 'rule-based' | 'openai' | 'local';
};

export interface LLMProvider {
  normalizeProcedureIntent(input: {
    text: string;
    patientAge?: number;
  }): Promise<NormalizedProcedure>;
  draftBalanceExplanation(input: { ledgerEvents: LedgerEvent[] }): Promise<BalanceExplanationResult>;
  summarizeRootCause(input: { issue: string; context?: string }): Promise<RootCauseSummaryResult>;
}
