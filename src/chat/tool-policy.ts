import type { ToolApprovalStatus, ToolSet } from 'ai';

export const NOT_AUTHORIZED_STATUS = 'NON_AUTORISE' as const;

/** Par défaut, un outil `list…` ou `get…` lit ; tous les autres écrivent. */
export const isReadToolByName = (name: string) => /^(list|get)[A-Z]/.test(name);

/**
 * Événement d'un outil du chat, à journaliser par l'application. Ne contient jamais le
 * résultat d'une lecture : seulement l'outil, son entrée et l'identifiant de l'appel, qui
 * relie une demande d'approbation à son issue d'une requête à l'autre.
 *
 * - `refused` : écriture hors des droits ou refus des règles métier (meilleur signal d'une
 *   injection de prompt) ;
 * - `approval-requested` : écriture soumise à l'utilisateur ;
 * - `approval-denied` : écriture refusée par l'utilisateur ;
 * - `executed` : écriture exécutée, avec son entrée et son résultat ;
 * - `read` : lecture exécutée, entrée seulement.
 */
export type ToolEvent = {
  type: 'refused' | 'approval-requested' | 'approval-denied' | 'executed' | 'read';
  toolName: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  reason?: string;
};

/**
 * Politique des outils du chat, fournie par l'application : droits de l'utilisateur
 * connecté, outils de lecture, journal.
 */
export type ToolPolicy = {
  /** L'utilisateur a-t-il le droit d'appeler cet outil ? Un outil inconnu doit être refusé. */
  isAllowed: (toolName: string) => boolean;
  /** Outils exécutés sans approbation (par défaut : `list…` et `get…`). */
  isReadTool?: (toolName: string) => boolean;
  /**
   * Erreur levée par un outil qui est un refus des règles métier (ex. ForbiddenException) :
   * renvoyer son motif ; elle est alors rendue au modèle au lieu d'échouer.
   */
  refusalReason?: (error: unknown) => string | undefined;
  onEvent?: (event: ToolEvent) => unknown;
  /** Motif d'un refus par les droits. */
  profileRefusal?: string;
};

const DEFAULT_PROFILE_REFUSAL = 'votre profil ne permet pas cette action';

const refusal = (message: string) => ({
  status: NOT_AUTHORIZED_STATUS,
  message: `Action refusée : ${message}. Explique-le à l'utilisateur sans réessayer.`,
});

type ApprovalRequest = {
  toolCall: { toolName: string; toolCallId?: string; input?: unknown };
};

/**
 * Politique d'approbation du chat (`toolApproval` de streamText) : une lecture s'exécute
 * directement, une écriture hors des droits est refusée sans importuner l'utilisateur, toute
 * autre écriture attend son approbation dans l'interface (`approval-requested`).
 * L'approbation est signée par le serveur (`experimental_toolApprovalSecret`) : un client ne
 * peut pas en fabriquer une.
 */
export const createToolApproval =
  (
    policy: ToolPolicy,
    /** Appels auxquels l'utilisateur a déjà répondu (reprise) : demande déjà signalée. */
    answered: ReadonlySet<string> = new Set(),
  ) =>
  async ({ toolCall }: ApprovalRequest): Promise<ToolApprovalStatus> => {
    const { toolName, toolCallId, input } = toolCall;
    const isRead = policy.isReadTool ?? isReadToolByName;
    if (isRead(toolName)) return undefined;
    if (!policy.isAllowed(toolName)) {
      const reason = policy.profileRefusal ?? DEFAULT_PROFILE_REFUSAL;
      await policy.onEvent?.({ type: 'refused', toolName, toolCallId, input, reason });
      return { type: 'denied', reason };
    }
    if (!toolCallId || !answered.has(toolCallId)) {
      await policy.onEvent?.({ type: 'approval-requested', toolName, toolCallId, input });
    }
    return 'user-approval';
  };

/**
 * Vérifie, avant chaque appel d'outil, que l'utilisateur a le droit de faire l'action. Un
 * refus (droits insuffisants, ou erreur reconnue par `refusalReason`) est renvoyé au modèle
 * comme résultat d'outil, pour qu'il l'explique à l'utilisateur ; l'action n'est pas
 * exécutée. L'approbation par l'utilisateur est gérée en amont par `createToolApproval`.
 */
export function authorizeTools<T extends ToolSet>(tools: T, policy: ToolPolicy): T {
  const isRead = policy.isReadTool ?? isReadToolByName;
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      const execute = definition.execute;
      if (!execute) return [name, definition];
      return [
        name,
        {
          ...definition,
          execute: async (input: unknown, options: unknown) => {
            const toolCallId = (options as { toolCallId?: string } | undefined)?.toolCallId;
            const refuse = async (reason: string) => {
              await policy.onEvent?.({ type: 'refused', toolName: name, toolCallId, input, reason });
              return refusal(reason);
            };
            if (!policy.isAllowed(name)) {
              return refuse(policy.profileRefusal ?? DEFAULT_PROFILE_REFUSAL);
            }
            try {
              const output = await (
                execute as (input: unknown, options: unknown) => unknown
              )(input, options);
              await policy.onEvent?.(
                isRead(name)
                  ? { type: 'read', toolName: name, toolCallId, input }
                  : { type: 'executed', toolName: name, toolCallId, input, output },
              );
              return output;
            } catch (error) {
              const reason = policy.refusalReason?.(error);
              if (reason !== undefined) return refuse(reason);
              throw error;
            }
          },
        },
      ];
    }),
  ) as T;
}

/**
 * Droits des outils par table : chaque outil exige l'une des permissions listées. Un outil
 * absent de la table est refusé : tout nouvel outil doit y être déclaré.
 */
export function permissionTablePolicy<P>(
  table: Record<string, readonly P[]>,
  can: (permission: P) => boolean,
  options: { bypass?: boolean } = {},
): ToolPolicy['isAllowed'] {
  return (toolName) => {
    if (options.bypass) return true;
    const allowed = table[toolName];
    return !!allowed && allowed.some(can);
  };
}
