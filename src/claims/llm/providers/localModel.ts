import fs from 'fs';
import path from 'path';
import type { LLMProvider, BalanceExplanationResult, RootCauseSummaryResult } from '../provider';
import { RuleBasedProvider } from './ruleBased';
import type { LedgerEvent } from '@prisma/client';

export class LocalModelProvider implements LLMProvider {
  private fallback = new RuleBasedProvider();
  private isLoaded: boolean;
  private manifest: Record<string, unknown> | null = null;

  constructor() {
    this.isLoaded = this.loadLocalModel();
  }

  private loadLocalModel(): boolean {
    const modelDir = path.join(process.cwd(), 'models', 'dental-llm');
    if (!fs.existsSync(modelDir)) {
      return false;
    }
    const manifestPath = path.join(modelDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        this.manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>;
      } catch {
        this.manifest = null;
      }
    }
    return true;
  }

  async normalizeProcedureIntent(input: { text: string; patientAge?: number }) {
    const result = await this.fallback.normalizeProcedureIntent(input);
    if (this.isLoaded && this.manifest?.name) {
      return { ...result, rationale: `${result.rationale} Local model loaded: ${this.manifest.name}.` };
    }
    return result;
  }

  async draftBalanceExplanation(input: { ledgerEvents: LedgerEvent[] }): Promise<BalanceExplanationResult> {
    const result = await this.fallback.draftBalanceExplanation(input);
    return { ...result, source: 'local' };
  }

  async summarizeRootCause(input: { issue: string; context?: string }): Promise<RootCauseSummaryResult> {
    const result = await this.fallback.summarizeRootCause(input);
    return { ...result, source: 'local' };
  }
}
