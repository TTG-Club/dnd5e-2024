/**
 * События правил, которые случаются на клиенте и уходят на сервер ядром
 * (`system:client-event`): «прервать концентрацию». Форма одна на клиент и
 * сервер; сервер проверяет её Zod-ом — событие пришло по сети.
 */

import { z } from 'zod';

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

/** Zod-схема события правил от клиента */
const SystemClientEventSchema = z.discriminatedUnion('type', [
  EndCastsEventSchema,
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
