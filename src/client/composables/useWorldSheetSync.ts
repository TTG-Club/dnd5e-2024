/**
 * Черновик листа следует за миром: разделы, которые система пишет в мир во
 * время игры, подтягиваются в черновик, пока лист не в режиме правки.
 *
 * Один на лист персонажа и лист существа: у каждого был свой набор
 * наблюдателей, и лист существа раздел заклинаний пропустил.
 */

import type { Ref } from 'vue';

import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { EntityDraftBase } from './useEntityDraftWrite';

import { watch } from 'vue';

import {
  copyWorldSection,
  copyWorldSections,
  WORLD_SHEET_SECTIONS,
} from './worldSheetSections';

/** Что связывает черновик листа с миром */
export interface WorldSheetSyncOptions<Entity extends DnDSceneEntity> {
  /** Сущность мира; нет — лист не привязан к миру (новая, запись компендиума) */
  readWorld: () => Entity | null | undefined;
  /** Черновик листа */
  draft: Ref<Entity | null>;
  /**
   * Основа черновика (`useEntityDraftWrite`): раздел, пришедший из мира,
   * кладётся и в неё — иначе следующая правка листа отправила бы его серверу
   * как собственную
   */
  base: EntityDraftBase<Entity>;
  /**
   * Синхронизация стоит: в режиме правки локальные правки главнее до
   * «Сохранить» или отмены
   */
  isPaused: () => boolean;
}

/**
 * Подтягивает разделы мира в черновик листа на каждое их изменение.
 *
 * Наблюдатель у каждого раздела свой, и копируется только изменившийся
 * раздел: лист вне режима правки сохраняет свою правку сразу, но стор её
 * увидит только с ответом сервера — общий наблюдатель на чужое изменение
 * соседнего раздела вернул бы в черновик прежний, ещё не догнавший раздел.
 *
 * Цикла «мир → черновик → мир» нет: присваивание в черновик ничего не шлёт —
 * отправка идёт только из явных обработчиков сохранения листа.
 *
 * @param options - сущность мира, черновик и признак «синхронизация стоит»
 * @returns `pullFromWorld` — подтянуть все разделы сейчас (выход из правки
 *   без сохранения: за время правки мир мог измениться)
 */
export function useWorldSheetSync<Entity extends DnDSceneEntity>(
  options: WorldSheetSyncOptions<Entity>,
): { pullFromWorld: () => void } {
  /** Кладёт все разделы мира в черновик, если есть и то и другое */
  function pullFromWorld(): void {
    const world = options.readWorld();

    if (world && options.draft.value) {
      copyWorldSections(options.draft.value, world);
    }

    if (world && options.base.value) {
      copyWorldSections(options.base.value, world);
    }
  }

  for (const section of WORLD_SHEET_SECTIONS) {
    watch(
      () => options.readWorld()?.[section],
      () => {
        const world = options.readWorld();

        if (!world || options.isPaused()) {
          return;
        }

        if (options.draft.value) {
          copyWorldSection(options.draft.value, world, section);
        }

        if (options.base.value) {
          copyWorldSection(options.base.value, world, section);
        }
      },
      { deep: true },
    );
  }

  return { pullFromWorld };
}
