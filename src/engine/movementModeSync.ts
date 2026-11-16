/**
 * Включённый вид перемещения фишки в согласии с эффектами сущности.
 *
 * Какой вид включён — знает только ядро (`Token.activeMovementModeId`,
 * VTTG 0.9.780): сущность состояния «в полёте» не хранит, у неё бывает
 * несколько фишек. Правила лишь просят ядро сменить вид
 * (`SystemTriggerContext.setTokenMovementMode`):
 * - «Левитация» (флаг `movement.levitate`) поднимает цель сама — вид
 *   включается, как только флаг появился;
 * - вид, которого у сущности больше нет (кончился «Полёт», сняли
 *   левитацию), выключается — фишку без опоры ядро уронит.
 *
 * Взлёт по Скорости полёта — выбор самого летуна (кнопка полки), эффект
 * «Полёт» только даёт Скорость. Старое ядро метода не даёт — сверка молчит.
 *
 * @module system/dnd/movementModeSync
 */

import type { SystemTriggerContext } from '@vtt/shared';

import type { DnDSceneEntity } from './dndEntities.js';

import { resolveActorStats } from './effectPipeline.js';
import {
  buildVerticalMovementModes,
  BURROW_MOVEMENT_MODE_ID,
  CLIMB_MOVEMENT_MODE_ID,
  FLY_MOVEMENT_MODE_ID,
  LEVITATE_MOVEMENT_MODE_ID,
  resolveMovementModesState,
  SWIM_MOVEMENT_MODE_ID,
} from './movementModes.js';

/** Смена включённого вида фишки у ядра; `null` — вид по умолчанию */
export type TokenMovementModeSetter = (
  tokenId: string,
  modeId: string | null,
) => void;

/** Виды системы, которые включаются состоянием фишки */
const PERSISTENT_MODE_IDS: ReadonlySet<string> = new Set([
  FLY_MOVEMENT_MODE_ID,
  LEVITATE_MOVEMENT_MODE_ID,
  SWIM_MOVEMENT_MODE_ID,
  CLIMB_MOVEMENT_MODE_ID,
  BURROW_MOVEMENT_MODE_ID,
]);

/**
 * Годится ли значение как смена вида фишки.
 *
 * @param value - член контекста ядра
 * @returns true для функции
 */
function isMovementModeSetter(
  value: unknown,
): value is TokenMovementModeSetter {
  return typeof value === 'function';
}

/**
 * Смена вида фишки из контекста правил, если ядро её даёт. Член появился в
 * ядре этажей (этап 2); старое ядро и клиент его не дают.
 *
 * @param context - контекст правил
 * @returns смена вида либо `undefined`
 */
export function findMovementModeSetter(
  context: SystemTriggerContext | undefined,
): TokenMovementModeSetter | undefined {
  if (!context || !('setTokenMovementMode' in context)) {
    return undefined;
  }

  const setter = context.setTokenMovementMode;

  return isMovementModeSetter(setter) ? setter : undefined;
}

/**
 * Какой вид должен быть включён у фишки по эффектам: левитация включается
 * сама, пропавший вид выключается, остальное остаётся как выбрал игрок.
 *
 * @param entity - сущность
 * @param activeModeId - включённый вид фишки
 * @returns новый вид (`null` — по умолчанию) либо `undefined` — не менять
 */
export function resolveMovementModeChange(
  entity: DnDSceneEntity,
  activeModeId: string | undefined,
): string | null | undefined {
  const state = resolveMovementModesState(entity, resolveActorStats(entity));

  if (state.levitating) {
    return activeModeId === LEVITATE_MOVEMENT_MODE_ID
      ? undefined
      : LEVITATE_MOVEMENT_MODE_ID;
  }

  if (!activeModeId || !PERSISTENT_MODE_IDS.has(activeModeId)) {
    return undefined;
  }

  const offered = buildVerticalMovementModes(state).some(
    (mode) => mode.id === activeModeId,
  );

  return offered ? undefined : null;
}

/**
 * Приводит включённый вид фишки сущности в согласие с её эффектами.
 * Вызывается после каждого срабатывания правил, которое могло наложить или
 * снять эффект; повторный вызов безвреден.
 *
 * @param entity - сущность
 * @param context - контекст правил; без смены вида у ядра сверка молчит
 */
export function reconcileMovementMode(
  entity: DnDSceneEntity,
  context: SystemTriggerContext | undefined,
): void {
  const setter = findMovementModeSetter(context);

  const token = setter
    ? context?.getSceneSurroundings?.(entity)?.token
    : undefined;

  if (!setter || !token) {
    return;
  }

  const change = resolveMovementModeChange(entity, token.activeMovementModeId);

  if (change !== undefined) {
    setter(token.id, change);
  }
}
