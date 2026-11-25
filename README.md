# ai-service

Librairie IA générique, extraite du module IA d'`audit-interne-backend`. Elle ne contient
aucun code métier : chaque application branche ses propres outils, ses droits, son journal
et sa source de configuration.

Elle est en TypeScript et en ESM. Elle dépend de l'AI SDK (`ai`, en peer dependency), mais
d'aucun framework : elle s'utilise avec NestJS, Express ou autre.

## Contenu

| Domaine | Exports principaux |
|---|---|
| Fournisseurs | `AiProviderResolver`, `envAiConfig`, `isAiEnabled`, `supportsAudio`, `buildModel` |
| Chiffrement des clés API | `createSecretCipher`, `encryptWithKey`, `decryptWithKey`, `parseAesKey` |
| Garde-fous | `toolApprovalSecret`, `AI_HISTORY_LIMITS`, `AI_MAX_STEPS`, `aiRateLimitPerMinute`, `dataBlock`, `withoutRemoteContent` |
| Limite de débit | `MemoryRateLimitStore`, `RedisRateLimitStore` (ioredis convient) |
| Usage | `aiUsageRecord` : étapes, outils et jetons, jamais le texte |
| Rédaction | `streamWriting` : `FIX_SPELLING`, `REPHRASE_FORMAL` |
| Résumé audio | `streamAudioSummary` (Gemini seulement), `NO_SPEECH_MARKER` |
| Chat | `streamChat`, `sanitizeChatHistory`, `createToolApproval`, `authorizeTools`, `permissionTablePolicy` |
| Instructions | `loadInstruction`, `responseLanguageInstruction` |
| Erreurs | `AiError` (`code` et `status` HTTP conseillé : 400, 404, 501, 503) |

Les instructions fournies sont dans [instructions/](instructions/). Celles du chat sont propres
à chaque application : on les passe à `streamChat` via `instructions`.

## Fournisseur

Ordre de priorité : configuration active enregistrée par l'application, puis variables
d'environnement ([.env.example](.env.example)), sinon `AiError` `AI_NOT_CONFIGURED` (503).

```ts
const cipher = createSecretCipher(); // AI_ENCRYPTION_KEY

const ai = new AiProviderResolver({
  loadActive: async () => {
    const row = await prisma.aiProviderConfig.findFirst({ where: { isActive: true } });
    return row && {
      id: row.id,
      name: row.name,
      config: () => ({
        provider: PROVIDER_OF[row.provider],
        model: row.model,
        apiKey: row.apiKeyEncrypted ? cipher.decrypt(row.apiKeyEncrypted) : undefined,
        resourceName: row.resourceName ?? undefined,
        baseURL: row.baseUrl ?? undefined,
      }),
    };
  },
});

const model = await ai.model(); // 404 si AI_ENABLED=false, 503 si rien n'est configuré
ai.invalidate();                // après une modification des configurations enregistrées
```

## Chat avec outils

Toute écriture attend l'approbation de l'utilisateur. Les lectures (`list…` et `get…` par
défaut) s'exécutent directement. Un outil absent de la table des droits est refusé.

```ts
const result = await streamChat({
  model: await ai.model(),
  instructions: monPromptSysteme + responseLanguageInstruction(locale),
  messages: body.messages,            // vérifié ici : AiError 400 si invalide
  tools: mesOutils(user),
  approvalSecret: toolApprovalSecret(),
  policy: {
    isAllowed: permissionTablePolicy(TOOL_PERMISSIONS, (p) => can(user, p), {
      bypass: isSuperAdmin(user),
    }),
    refusalReason: (e) => (e instanceof ForbiddenException ? e.message : undefined),
    onEvent: (event) => audit.record(toAuditEntry(user, event)),
  },
  usageMetadata: { entityId },
  onUsage: (record) => audit.record(toUsageEntry(user, record)),
});

pipeUIMessageStreamToResponse({ response: res, stream: toUIMessageStream({ stream: result.stream }) });
```

Événements de `onEvent` : `refused`, `approval-requested`, `approval-denied`, `executed`
(entrée et résultat) et `read` (entrée seulement).

## Rédaction et résumé audio

```ts
const writing = await streamWriting({ model, text, action: 'FIX_SPELLING', onUsage });
pipeTextStreamToResponse({ response: res, stream: writing.textStream });

await ai.assertAudioSummaryAvailable(); // 501 hors Gemini
const summary = await streamAudioSummary({
  model,
  audio: { data: file.buffer, mediaType: file.mimetype },
  context: [controlName && `Contrôle audité : ${controlName}`],
  locale,
  onUsage,
});
```

## Limite de débit

```ts
const redis = new Redis({ ...options, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
redis.on('error', () => undefined);
const store = process.env.REDIS_HOST ? new RedisRateLimitStore(redis) : new MemoryRateLimitStore();

if (!(await store.hit(user.id, aiRateLimitPerMinute(), 60_000))) {
  // 429
}
```

Si Redis est injoignable, le compteur en mémoire prend le relais : la limite est alors
comptée par instance.

## Développement

```bash
pnpm install
pnpm typecheck
pnpm test     # Vitest
pnpm build    # dist/
```

## Utilisation depuis une autre application

Le paquet est privé. On l'installe par chemin local (`"ai-service": "file:../ai-service"`) ou
depuis son dépôt git. Node 22 ou plus est requis : une application CommonJS (NestJS) le charge
via `require(esm)`.
