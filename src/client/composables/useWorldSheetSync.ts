/**
 * Черновик листа следует за миром: разделы, которые система пишет в мир во
 * время игры, подтягиваются в черновик, пока лист не в режиме правки.
 *
 * Один на лист персонажа и лист существа: у каждого был свой набор
 * наблюдателей, и лист существа раздел заклинаний пропустил. Токен сущности
 * подтягивается тем же помощником.
 */

import type { Ref } from 'vue';

import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { EntityDraftBase } from './useEntityDraftWrite';

import { watch } from 'vue';

import { cloneEntityData } from '@vtt/shared/system/dnd.js';

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
 * Кладёт в копию токен сущности мира — глубокой копией: запись стора хоста
 * общая. Сущность мира без токена копию не трогает.
 *
 * @param target - черновик листа или его основа (меняется)
 * @param world - сущность мира того же вида
 */
function copyWorldToken<Entity extends DnDSceneEntity>(
  target: Entity,
  world: Entity,
): void {
  if (world.token) {
    target.token = cloneEntityData(world.token);
  }
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
  /**
   * Кладёт всё, что лист берёт из мира, в черновик и в основу: разделы и
   * токен. Токен — тоже: за время правки его могли сменить окно настроек или
   * сцена, а наблюдатель в правке молчал.
   */
  function pullFromWorld(): void {
    const world = options.readWorld();

    if (!world) {
      return;
    }

    for (const target of [options.draft.value, options.base.value]) {
      if (target) {
        copyWorldSections(target, world);
        copyWorldToken(target, world);
      }
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

  // Токен правят окно настроек и сцена, лист его только показывает и хранит в
  // черновике. Правило то же, что у разделов: вне режима правки — в черновик
  // и в основу; в правке синхронизация стоит, иначе «Сохранить» отправило бы
  // чужое изменение токена как правку листа
  watch(
    () => options.readWorld()?.token,
    () => {
      const world = options.readWorld();

      if (!world || options.isPaused()) {
        return;
      }

      if (options.draft.value) {
        copyWorldToken(options.draft.value, world);
      }

      if (options.base.value) {
        copyWorldToken(options.base.value, world);
      }
    },
    { deep: true },
  );

  return { pullFromWorld };
}
