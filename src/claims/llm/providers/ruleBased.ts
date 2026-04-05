import type { LLMProvider, BalanceExplanationResult, RootCauseSummaryResult } from '../provider';
import { mapProcedureIntent } from '@/intake/rules/procedure';
import { draftBalanceExplanation, summarizeRootCause } from '@/claims/rules/explanation';
import type { LedgerEvent } from '@prisma/client';

export class RuleBasedProvider implements LLMProvider {
  async normalizeProcedureIntent(input: {
    text: string;
    patientAge?: number;
  }) {
    return mapProcedureIntent(input.text, input.patientAge);
  }

  async draftBalanceExplanation(input: { ledgerEvents: LedgerEvent[] }): Promise<BalanceExplanationResult> {
    return {
      text: draftBalanceExplanation(input.ledgerEvents),
      source: 'rule-based'
    };
  }

  async summarizeRootCause(input: { issue: string; context?: string }): Promise<RootCauseSummaryResult> {
    return {
      text: summarizeRootCause(input.issue, input.context),
      source: 'rule-based'
    };
  }
}
