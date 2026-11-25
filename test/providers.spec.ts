import { describe, expect, it, vi } from 'vitest';
import {
  AiError,
  AiProviderResolver,
  createSecretCipher,
  encryptWithKey,
  envAiConfig,
  isAiEnabled,
  type StoredAiConfig,
} from '../src/index.js';

const KEY = Buffer.alloc(32, 7);

describe('variables d’environnement (relais)', () => {
  it('sans variable : rien de configuré, la clé Google est demandée', () => {
    expect(isAiEnabled({})).toBe(true);
    expect(envAiConfig({})).toEqual({ missing: ['GOOGLE_GENERATIVE_AI_API_KEY'] });
  });

  it('clé Google seule : Google et le modèle par défaut', () => {
    expect(envAiConfig({ GOOGLE_GENERATIVE_AI_API_KEY: 'k' })).toEqual({
      config: { provider: 'google', model: 'gemini-3.1-flash-lite' },
    });
  });

  it('fournisseur inconnu : signalé comme manquant', () => {
    const result = envAiConfig({ AI_PROVIDER: 'openai' });
    expect('missing' in result && result.missing[0]).toContain('AI_PROVIDER');
  });

  it.each([
    ['azure_openai', { AZURE_API_KEY: 'k', AZURE_RESOURCE_NAME: 'r' }, 'AI_MODEL'],
    ['azure_openai', { AI_MODEL: 'gpt', AZURE_RESOURCE_NAME: 'r' }, 'AZURE_API_KEY'],
    ['azure_openai', { AI_MODEL: 'gpt', AZURE_API_KEY: 'k' }, 'AZURE_RESOURCE_NAME ou AZURE_BASE_URL'],
    ['mistral', { AI_MODEL: 'mistral-small' }, 'MISTRAL_API_KEY'],
    ['openai_compatible', { AI_MODEL: 'qwen' }, 'AI_BASE_URL'],
  ])('%s incomplet : la variable manquante est nommée', (provider, values, missing) => {
    expect(envAiConfig({ AI_PROVIDER: provider, ...values })).toEqual({ missing: [missing] });
  });

  it('openai_compatible : modèle hébergé chez le client, clé facultative', () => {
    expect(
      envAiConfig({
        AI_PROVIDER: 'openai_compatible',
        AI_MODEL: 'qwen',
        AI_BASE_URL: 'http://ia.client.local:8000/v1',
      }),
    ).toEqual({
      config: {
        provider: 'openai_compatible',
        model: 'qwen',
        baseURL: 'http://ia.client.local:8000/v1',
        apiKey: undefined,
      },
    });
  });
});

describe('ordre : configuration enregistrée, puis variables, puis message', () => {
  const env = { AI_ENCRYPTION_KEY: KEY.toString('base64') };
  const cipher = createSecretCipher('AI_ENCRYPTION_KEY', env);
  const stored = (apiKeyEncrypted: string): StoredAiConfig => ({
    id: 'c1',
    name: 'Mistral',
    config: () => ({
      provider: 'mistral',
      model: 'mistral-large-latest',
      apiKey: cipher.decrypt(apiKeyEncrypted),
    }),
  });
  const resolver = (active: StoredAiConfig | null, vars: NodeJS.ProcessEnv = {}) =>
    new AiProviderResolver({
      env: vars,
      loadActive: vi.fn().mockResolvedValue(active),
      build: async () => 'fake-model' as never,
    });

  it('la configuration active enregistrée l’emporte sur les variables', async () => {
    const status = await resolver(stored(encryptWithKey('cle', KEY)), {
      GOOGLE_GENERATIVE_AI_API_KEY: 'k',
    }).status();
    expect(status).toEqual({
      state: 'READY',
      source: 'STORED',
      configId: 'c1',
      configName: 'Mistral',
      config: { provider: 'mistral', model: 'mistral-large-latest', apiKey: 'cle' },
    });
  });

  it('sans configuration active : les variables prennent le relais', async () => {
    const status = await resolver(null, { GOOGLE_GENERATIVE_AI_API_KEY: 'k' }).status();
    expect(status).toMatchObject({ state: 'READY', source: 'ENV' });
  });

  it('ni l’un ni l’autre : AiError 503 qui dit quoi fournir', async () => {
    const provider = resolver(null);
    expect(await provider.status()).toEqual({
      state: 'NOT_CONFIGURED',
      missing: ['GOOGLE_GENERATIVE_AI_API_KEY'],
      unreadableKey: false,
    });
    await expect(provider.model()).rejects.toMatchObject({
      code: 'AI_NOT_CONFIGURED',
      status: 503,
      message: expect.stringMatching(/Aucun fournisseur d'IA n'est configuré/),
    });
  });

  it('clé enregistrée illisible et pas de relais : message dédié', async () => {
    const provider = resolver(stored(encryptWithKey('cle', Buffer.alloc(32, 1))));
    expect(await provider.status()).toMatchObject({
      state: 'NOT_CONFIGURED',
      unreadableKey: true,
    });
    await expect(provider.model()).rejects.toThrow(/illisible/);
  });

  it('cache : la source n’est relue qu’après invalidate()', async () => {
    const loadActive = vi.fn().mockResolvedValue(null);
    const provider = new AiProviderResolver({
      env: { GOOGLE_GENERATIVE_AI_API_KEY: 'k' },
      loadActive,
    });
    await provider.status();
    await provider.status();
    expect(loadActive).toHaveBeenCalledTimes(1);
    provider.invalidate();
    await provider.status();
    expect(loadActive).toHaveBeenCalledTimes(2);
  });

  it('le modèle est créé une fois par configuration', async () => {
    const build = vi.fn().mockResolvedValue('fake-model');
    const provider = new AiProviderResolver({
      env: { GOOGLE_GENERATIVE_AI_API_KEY: 'k' },
      build,
    });
    expect(await provider.model()).toBe('fake-model');
    await provider.model();
    expect(build).toHaveBeenCalledTimes(1);
  });
});

it('AI_ENABLED=false : IA coupée même avec une configuration enregistrée (404)', async () => {
  const provider = new AiProviderResolver({
    env: { AI_ENABLED: 'false' },
    loadActive: async () => ({ id: 'c1', name: 'x', config: () => ({ provider: 'google', model: 'm' }) }),
  });
  expect(await provider.status()).toEqual({ state: 'DISABLED' });
  expect(await provider.isAudioSummaryAvailable()).toBe(false);
  await expect(provider.assertAvailable()).rejects.toMatchObject({ status: 404 });
});

it('résumé audio indisponible avec ce fournisseur : 501', async () => {
  const provider = new AiProviderResolver({
    env: { AI_PROVIDER: 'mistral', AI_MODEL: 'm', MISTRAL_API_KEY: 'k' },
  });
  await expect(provider.assertAvailable()).resolves.toMatchObject({ state: 'READY' });
  await expect(provider.assertAudioSummaryAvailable()).rejects.toBeInstanceOf(AiError);
  await expect(provider.assertAudioSummaryAvailable()).rejects.toMatchObject({ status: 501 });
});

it('chiffrement : sans clé, AiError 503', () => {
  expect(() => createSecretCipher('AI_ENCRYPTION_KEY', {}).encrypt('x')).toThrow(
    expect.objectContaining({ status: 503 }),
  );
});
