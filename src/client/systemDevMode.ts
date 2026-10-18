/**
 * Режим разработки (`npm run dev:hot`): то, что система делает на странице сверх
 * обычной регистрации.
 *
 * Клиентский код в этом режиме обновляется сам — правку `.vue` подменяет Vue,
 * остальное приложение перерегистрирует. Серверную часть dev-сервер до
 * приложения не доносит, и молчать об этом нельзя: правка движка выглядела бы
 * применённой (клиент уже новый), а сервер мира считал бы по-старому.
 *
 * Модуль подгружается только из ветки `import.meta.hot` точки входа — в
 * собранный `client.js` он не попадает.
 *
 * @module client/systemDevMode
 */

import type { ViteHotContext } from 'vite/types/hot.js';

import { z } from 'zod';

import { useSystemToastStore } from './stores/systemToastStore';
import {
  ENGINE_PART,
  ENGINE_PART_TOAST_DESCRIPTION,
  ENGINE_PART_TOAST_TITLE,
  SERVER_PART,
  SERVER_PART_TOAST_DESCRIPTION,
  SERVER_PART_TOAST_TITLE,
  STALE_PART_EVENT,
  STALE_PART_TOAST_ICON,
} from './systemDevConsts';

/** Сообщение dev-сервера: какая часть системы устарела в приложении. */
const stalePartSchema = z.object({
  part: z.enum([SERVER_PART, ENGINE_PART]),
  file: z.string(),
});

/** Подписи уведомления по частям системы. */
const STALE_PART_TOASTS: Record<
  z.infer<typeof stalePartSchema>['part'],
  { title: string; description: string }
> = {
  [SERVER_PART]: {
    title: SERVER_PART_TOAST_TITLE,
    description: SERVER_PART_TOAST_DESCRIPTION,
  },
  [ENGINE_PART]: {
    title: ENGINE_PART_TOAST_TITLE,
    description: ENGINE_PART_TOAST_DESCRIPTION,
  },
};

/**
 * Достаёт набор частей, о которых уже сказано на этой странице.
 *
 * Набор лежит в `hot.data` — он переживает повторное исполнение точки входа и
 * пропадает только с перезагрузкой страницы. Так о движке, который правят
 * десятки раз подряд, уведомление появляется однажды, а не на каждое сохранение.
 *
 * @param hot - контекст горячей замены точки входа
 * @returns набор имён частей
 */
function readShownParts(hot: ViteHotContext): Set<unknown> {
  const kept: unknown = hot.data.shownStaleParts;
  const shownParts = kept instanceof Set ? kept : new Set<unknown>();

  hot.data.shownStaleParts = shownParts;

  return shownParts;
}

/**
 * Подписывает страницу на сообщения dev-сервера о правке серверной части и
 * движка: показывает уведомление, что приложению нужны установка и перезапуск.
 *
 * @param hot - контекст горячей замены точки входа
 */
export function setupSystemDevMode(hot: ViteHotContext): void {
  hot.on(STALE_PART_EVENT, (payload: unknown) => {
    const stalePart = stalePartSchema.safeParse(payload);

    if (!stalePart.success) {
      return;
    }

    const shownParts = readShownParts(hot);

    if (shownParts.has(stalePart.data.part)) {
      return;
    }

    shownParts.add(stalePart.data.part);

    useSystemToastStore().add({
      ...STALE_PART_TOASTS[stalePart.data.part],
      color: 'warning',
      icon: STALE_PART_TOAST_ICON,
    });
  });
}
