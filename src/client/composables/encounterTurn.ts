import { useInitiativeStore } from '@/stores/initiativeStore';

/**
 * Ход и участие в бою по трекеру инициативы клиента. Текущий ход берётся так
 * же, как на сервере: сырой `entries[currentTurnIndex]`, а не локально
 * пересортированный список — порядок на сервере и клиенте расходится после
 * добавления и удаления участников без переброса инициативы.
 */

/**
 * Чей сейчас ход в энкаунтере.
 *
 * @returns id участника либо `null`, если хода нет
 */
export function resolveActiveTurnActorId(): string | null {
  const encounter = useInitiativeStore().encounter;

  return encounter && encounter.currentTurnIndex >= 0
    ? (encounter.entries[encounter.currentTurnIndex]?.actorId ?? null)
    : null;
}

/**
 * Участвует ли сущность в идущем бою: активный начатый энкаунтер с ней.
 *
 * @param entityId - сущность
 * @returns `true`, если бой идёт и сущность в нём
 */
export function isEntityInCombat(entityId: string): boolean {
  const encounter = useInitiativeStore().encounter;

  return (
    encounter?.isActive === true
    && encounter.currentTurnIndex >= 0
    && encounter.entries.some((entry) => entry.actorId === entityId)
  );
}

/**
 * Какой раунд идёт в бою — для правил по расписанию «на раунде N».
 *
 * Как и на сервере: номер есть только у активного и уже начатого боя.
 *
 * @returns номер раунда либо `undefined`, если боя нет
 */
export function resolveCombatRound(): number | undefined {
  const encounter = useInitiativeStore().encounter;

  return encounter?.isActive === true && encounter.currentTurnIndex >= 0
    ? encounter.round
    : undefined;
}
