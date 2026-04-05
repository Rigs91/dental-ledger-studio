import type { LLMProvider, BalanceExplanationResult, RootCauseSummaryResult } from '../provider';
import { RuleBasedProvider } from './ruleBased';
import type { LedgerEvent } from '@prisma/client';

const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4.1-mini';

export class OpenAIProvider implements LLMProvider {
  private fallback = new RuleBasedProvider();
  constructor(private apiKey: string | undefined) {}

  async normalizeProcedureIntent(input: { text: string; patientAge?: number }) {
    if (!this.apiKey) {
      return this.fallback.normalizeProcedureIntent(input);
    }

    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          input: [
            {
              role: 'system',
              content: 'Normalize dental procedure intent. Respond with JSON only.'
            },
            {
              role: 'user',
              content: JSON.stringify({ text: input.text, patientAge: input.patientAge })
            }
          ],
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        return this.fallback.normalizeProcedureIntent(input);
      }
      const data = await response.json();
      const payload = data.output?.[0]?.content?.[0]?.text;
      if (payload) {
        return JSON.parse(payload);
      }
      return this.fallback.normalizeProcedureIntent(input);
    } catch {
      return this.fallback.normalizeProcedureIntent(input);
    }
  }

  async draftBalanceExplanation(input: { ledgerEvents: LedgerEvent[] }): Promise<BalanceExplanationResult> {
    if (!this.apiKey) {
      return this.fallback.draftBalanceExplanation(input);
    }
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          input: [
            {
              role: 'system',
              content:
                'Draft a short patient-friendly balance explanation from ledger events. Respond with JSON {text}.'
            },
            {
              role: 'user',
              content: JSON.stringify({ ledgerEvents: input.ledgerEvents })
            }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (!response.ok) {
        return this.fallback.draftBalanceExplanation(input);
      }
      const data = await response.json();
      const payload = data.output?.[0]?.content?.[0]?.text;
      if (payload) {
        const parsed = JSON.parse(payload);
        return { text: parsed.text, source: 'openai' };
      }
      return this.fallback.draftBalanceExplanation(input);
    } catch {
      return this.fallback.draftBalanceExplanation(input);
    }
  }

  async summarizeRootCause(input: { issue: string; context?: string }): Promise<RootCauseSummaryResult> {
    if (!this.apiKey) {
      return this.fallback.summarizeRootCause(input);
    }
    try {
      const response = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          input: [
            {
              role: 'system',
              content:
                'Summarize likely root cause and recommended action. Respond with JSON {text}.'
            },
            {
              role: 'user',
              content: JSON.stringify(input)
            }
          ],
          response_format: { type: 'json_object' }
        })
      });
      if (!response.ok) {
        return this.fallback.summarizeRootCause(input);
      }
      const data = await response.json();
      const payload = data.output?.[0]?.content?.[0]?.text;
      if (payload) {
        const parsed = JSON.parse(payload);
        return { text: parsed.text, source: 'openai' };
      }
      return this.fallback.summarizeRootCause(input);
    } catch {
      return this.fallback.summarizeRootCause(input);
    }
  }
}
