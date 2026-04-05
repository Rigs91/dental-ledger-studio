import { RuleBasedProvider } from './providers/ruleBased';
import { OpenAIProvider } from './providers/openai';
import { LocalModelProvider } from './providers/localModel';
import type { LLMProvider } from './provider';

export function getLLMProvider(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'rule-based').toLowerCase();
  if (provider === 'openai') {
    return new OpenAIProvider(process.env.OPENAI_API_KEY);
  }
  if (provider === 'local') {
    return new LocalModelProvider();
  }
  return new RuleBasedProvider();
}
