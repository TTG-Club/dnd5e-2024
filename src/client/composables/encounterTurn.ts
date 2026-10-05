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
 * Идёт ли сейчас ход сущности. Вне боя хода нет — он считается своим: там
 * действуют, когда хотят.
 *
 * @param entityId - сущность
 * @returns `true` в свой ход и вне боя
 */
export function isEntityOwnTurn(entityId: string): boolean {
  return !isEntityInCombat(entityId) || resolveActiveTurnActorId() === entityId;
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

/** Метка «боя нет»: вне боя ход не меняется */
const NO_COMBAT_TURN_STAMP = '';

/**
 * Метка идущего хода: раунд и место в порядке инициативы. Меняется с каждым
 * концом хода — по ней узнают, что счётчики хода и раунда сервер уже сбросил.
 *
 * @returns метка хода; вне боя — пустая
 */
export function resolveTurnStamp(): string {
  const encounter = useInitiativeStore().encounter;

  return encounter?.isActive === true && encounter.currentTurnIndex >= 0
    ? `${encounter.round}:${encounter.currentTurnIndex}`
    : NO_COMBAT_TURN_STAMP;
}
