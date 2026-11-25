import { beforeEach, describe, expect, it, vi } from 'vitest';
import { streamText } from 'ai';
import { streamAudioSummary, streamChat, streamWriting } from '../src/index.js';

vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('ai')>()),
  streamText: vi.fn(),
}));

type Call = {
  instructions: string;
  prompt?: string;
  messages: { content: { type: string; text?: string; mediaType?: string }[] }[];
  tools?: Record<string, unknown>;
  experimental_toolApprovalSecret?: string;
  onError: (arg: { error: unknown }) => void;
  onEnd: (event: object) => unknown;
};

const stream = vi.mocked(streamText);
const lastCall = () => stream.mock.calls.at(-1)![0] as unknown as Call;
const model = 'fake-model' as never;
const logger = { error: vi.fn(), warn: vi.fn(), log: vi.fn() };

beforeEach(() => {
  stream.mockReset();
  stream.mockReturnValue({ textStream: 'flux' } as never);
});

describe('streamAudioSummary', () => {
  const audio = (mediaType: string) => ({ data: new Uint8Array([1, 2]), mediaType });

  it('renvoie le flux du modèle et retire les paramètres du type MIME', async () => {
    const result = await streamAudioSummary({ model, audio: audio('audio/webm;codecs=opus'), logger });
    expect(result).toEqual({ textStream: 'flux' });
    const [file] = lastCall().messages[0].content;
    expect(file).toMatchObject({ type: 'file', mediaType: 'audio/webm' });
    expect(lastCall().instructions).toContain('## AUDIO_SUMMARIZE');
  });

  it("ajoute le contexte avant l'audio quand il est fourni", async () => {
    await streamAudioSummary({
      model,
      audio: audio('audio/webm'),
      context: ['Contrôle audité : Double signature', undefined],
      logger,
    });
    const [first, second] = lastCall().messages[0].content;
    expect(first.text).toContain('Contrôle audité : Double signature');
    expect(second.type).toBe('file');
  });

  it('refuse un fichier qui n’est pas audio ou trop gros', async () => {
    await expect(streamAudioSummary({ model, audio: audio('image/png') })).rejects.toThrow(TypeError);
    await expect(
      streamAudioSummary({ model, audio: { data: new Uint8Array(10), mediaType: 'audio/webm' }, maxBytes: 5 }),
    ).rejects.toThrow(RangeError);
  });

  it("n'expose pas l'erreur du modèle (journalisée seulement)", async () => {
    await streamAudioSummary({ model, audio: audio('audio/webm'), logger });
    expect(() => lastCall().onError({ error: new Error('clé API invalide') })).not.toThrow();
    expect(logger.error).toHaveBeenCalled();
  });

  it("journalise l'usage sans le compte rendu ni l'audio", async () => {
    const onUsage = vi.fn();
    await streamAudioSummary({ model, audio: audio('audio/webm'), onUsage, logger });
    await lastCall().onEnd({
      text: 'Compte rendu confidentiel',
      steps: [],
      totalUsage: { inputTokens: 900, outputTokens: 200, totalTokens: 1100 },
    });
    const [record] = onUsage.mock.calls[0];
    expect(record).toMatchObject({ feature: 'audio-summarize', totalTokens: 1100, metadata: { audioBytes: 2 } });
    expect(JSON.stringify(record)).not.toContain('confidentiel');
  });
});

describe('streamWriting', () => {
  it("utilise les instructions de l'action et garde la langue du texte", async () => {
    await streamWriting({ model, text: 'Il y a un soucis.', action: 'FIX_SPELLING' });
    expect(lastCall().instructions).toContain('## FIX_SPELLING');
    expect(lastCall().prompt).toContain('ne le traduis pas');
    expect(lastCall().prompt).toContain('Il y a un soucis.');
  });

  it('refuse un texte trop long', async () => {
    await expect(streamWriting({ model, text: 'xx', action: 'FIX_SPELLING', maxLength: 1 })).rejects.toThrow(
      RangeError,
    );
  });
});

describe('streamChat', () => {
  const messages = [{ id: 'm', role: 'user', parts: [{ type: 'text', text: 'bonjour' }] }];
  const tools = { listRisks: { execute: async () => [] } } as never;

  it('sans outils : instructions et historique vérifié', async () => {
    await streamChat({ model, instructions: 'Tu es un assistant.', messages, logger });
    expect(lastCall().instructions).toBe('Tu es un assistant.');
    expect(lastCall().tools).toBeUndefined();
  });

  it('avec des outils : politique et secret obligatoires', async () => {
    await expect(streamChat({ model, instructions: '', messages, tools })).rejects.toThrow(/policy/);
    await expect(
      streamChat({ model, instructions: '', messages, tools, policy: { isAllowed: () => true } }),
    ).rejects.toThrow(/approvalSecret/);
  });

  it('enveloppe les outils et passe le secret des approbations', async () => {
    await streamChat({
      model,
      instructions: '',
      messages,
      tools,
      policy: { isAllowed: () => true },
      approvalSecret: 's'.repeat(32),
      logger,
    });
    expect(Object.keys(lastCall().tools!)).toEqual(['listRisks']);
    expect(lastCall().experimental_toolApprovalSecret).toBe('s'.repeat(32));
  });

  it("signale les écritures refusées par l'utilisateur depuis le message précédent", async () => {
    const onEvent = vi.fn();
    await streamChat({
      model,
      instructions: '',
      messages: [
        {
          id: 'a',
          role: 'assistant',
          parts: [
            {
              type: 'tool-deleteRisk',
              toolCallId: 'c1',
              state: 'approval-responded',
              input: {},
              approval: { id: 'ap1', approved: false },
            },
          ],
        },
      ],
      tools,
      policy: { isAllowed: () => true, onEvent },
      approvalSecret: 's'.repeat(32),
      logger,
    });
    expect(onEvent).toHaveBeenCalledWith({ type: 'approval-denied', toolName: 'deleteRisk', toolCallId: 'c1' });
  });
});
