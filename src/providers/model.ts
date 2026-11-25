import { createAzure } from '@ai-sdk/azure';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { LanguageModel } from 'ai';
import type { AiConfig } from './config.js';

/**
 * Modèle d'une configuration. Une valeur absente est lue par le SDK dans sa variable
 * habituelle (GOOGLE_GENERATIVE_AI_API_KEY, AZURE_API_KEY, AZURE_RESOURCE_NAME, MISTRAL_API_KEY).
 */
export function createModel(config: AiConfig): LanguageModel {
  switch (config.provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey: config.apiKey })(config.model);
    case 'azure_openai':
      return createAzure({
        apiKey: config.apiKey,
        resourceName: config.resourceName,
        baseURL: config.baseURL,
      })(config.model);
    case 'mistral':
      return createMistral({ apiKey: config.apiKey })(config.model);
    case 'openai_compatible':
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL: config.baseURL!,
        apiKey: config.apiKey,
        // Sortie conforme à un schéma JSON (rédaction, rapports).
        supportsStructuredOutputs: true,
      })(config.model);
  }
}
