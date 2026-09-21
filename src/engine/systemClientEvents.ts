/**
 * События правил, которые случаются на клиенте и уходят на сервер ядром
 * (`system:client-event`): «прервать концентрацию», бросок атаки. Форма одна
 * на клиент и сервер; сервер проверяет её Zod-ом — событие пришло по сети.
 */

import type { AttackRollMode } from './attackUtils.js';

import { z } from 'zod';

import { ATTACK_ROLL_MODES } from './attackUtils.js';

/** Сколько кастов заканчивает одно событие */
const MAX_EVENT_CAST_IDS = 16;

/** Самый длинный id каста — как у черновика области ядра */
const MAX_CAST_ID_LENGTH = 64;

/** Zod-схема события «закончить касты заклинателя» */
const EndCastsEventSchema = z.object({
  type: z.literal('endCasts'),
  casterId: z.string().min(1),
  castIds: z
    .array(z.string().min(1).max(MAX_CAST_ID_LENGTH))
    .min(1)
    .max(MAX_EVENT_CAST_IDS),
});

/** Сколько целей у одного броска атаки */
const MAX_ATTACK_TARGETS = 16;

/** Zod-схема события «бросок атаки состоялся» */
const AttackRollEventSchema = z.object({
  type: z.literal('attackRoll'),
  attackerId: z.string().min(1),
  targetIds: z.array(z.string().min(1)).max(MAX_ATTACK_TARGETS),
  rollMode: z.enum(ATTACK_ROLL_MODES),
  /**
   * Попал ли бросок. Поля нет там, где к моменту сообщения это ещё неизвестно
   * (серия снарядов: броски делает вызывающий уже после события) — и тогда
   * части условия о попадании НЕ выполняются, как у всякой части без данных.
   */
  landed: z.boolean().optional(),
});

/** Zod-схема события правил от клиента */
const SystemClientEventSchema = z.discriminatedUnion('type', [
  EndCastsEventSchema,
  AttackRollEventSchema,
]);

/** Событие правил от клиента */
export type SystemClientEvent = z.infer<typeof SystemClientEventSchema>;

/**
 * Событие правил от клиента по сетевому значению.
 *
 * @param payload - то, что прислал клиент
 * @returns событие либо `null`, если форма незнакома
 */
export function parseSystemClientEvent(
  payload: unknown,
): SystemClientEvent | null {
  const parsed = SystemClientEventSchema.safeParse(payload);

  return parsed.success ? parsed.data : null;
}

/**
 * Событие «закончить касты заклинателя».
 *
 * @param casterId - заклинатель
 * @param castIds - касты
 * @returns событие для `system:client-event`
 */
export function buildEndCastsEvent(
  casterId: string,
  castIds: readonly string[],
): SystemClientEvent {
  return { type: 'endCasts', casterId, castIds: [...castIds] };
}

/**
 * Событие «бросок атаки состоялся»: сервер выполнит срабатывания атаки со
 * спасброском, уроном и действиями другой стороне.
 *
 * @param attackerId - атакующий
 * @param targetIds - цели
 * @param rollMode - режим броска
 * @param landed - попал ли бросок; не задано — к этому времени неизвестно
 * @returns событие для `system:client-event`
 */
export function buildAttackRollEvent(
  attackerId: string,
  targetIds: readonly string[],
  rollMode: AttackRollMode,
  landed?: boolean,
): SystemClientEvent {
  return {
    type: 'attackRoll',
    attackerId,
    targetIds: [...targetIds],
    rollMode,
    ...(landed === undefined ? {} : { landed }),
  };
}
