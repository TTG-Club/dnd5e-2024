/**
 * Копия сущности мира для быстрых панелей: следует за миром и сохраняет свои
 * правки частичной записью.
 *
 * У быстрой панели нет режима правки: она показывает сущность мира, а правку
 * шлёт сразу. Запись стора общая, и править её на месте нельзя — поэтому
 * панель держит копию, которую мир заменяет целиком на каждое своё изменение.
 * Вместе с копией встаёт и основа: пришедшее из мира правкой панели не
 * считается.
 */

import type { Ref } from 'vue';

import type { TypedWebSocketClient } from '@vtt/shared';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import { watch } from 'vue';

import { cloneEntityData } from '@vtt/shared/system/dnd.js';

import { useEntityDraftWrite } from './useEntityDraftWrite';

/** Что связывает копию панели с миром */
export interface WorldEntityCopyOptions<Entity extends DnDSceneEntity> {
  /** Копия сущности, которую правит панель */
  copy: Ref<Entity | null>;
  /** Сущность мира; нет — панель показывает последнюю копию */
  readWorld: () => Entity | null;
  /** Гвард формы сущности */
  isEntity: (value: unknown) => value is Entity;
}

/**
 * Держит копию сущности мира свежей и даёт сохранение её правок.
 *
 * @param options - копия панели, сущность мира и гвард формы
 * @returns `saveCopy` — отправить серверу то, чем копия отличается от мира
 */
export function useWorldEntityCopy<Entity extends DnDSceneEntity>(
  options: WorldEntityCopyOptions<Entity>,
): { saveCopy: (socket: TypedWebSocketClient) => void } {
  const { rebaseDraft, saveDraft } = useEntityDraftWrite({
    readDraft: () => options.copy.value,
    readWorld: options.readWorld,
    isEntity: options.isEntity,
  });

  watch(
    options.readWorld,
    (worldEntity) => {
      if (worldEntity) {
        options.copy.value = cloneEntityData(worldEntity);
        rebaseDraft();
      }
    },
    { immediate: true, deep: true },
  );

  return { saveCopy: (socket) => saveDraft(socket) };
}
