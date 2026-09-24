/**
 * Сущности текущего мира одним списком.
 *
 * Нужен всем, кто ищет участника боя по идентификатору: оркестратору урона,
 * блокам действий и заклинаний, передаче предметов. Список общий намеренно —
 * актёры и существа участвуют в бою на равных, и место, которое смотрит только
 * в актёров, молча теряет монстров.
 *
 * Сама склейка списка — хостовая (`collectWorldEntities`), здесь только
 * подстановка текущего мира: своя копия склейки разошлась бы с ядром ровно в
 * тот день, когда у мира появится третий вид сущностей.
 */

import type { SceneEntity } from '@vtt/shared';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import { collectWorldEntities, findEntityInWorld } from '@/core/entityUtils';
import { useWorldStore } from '@/stores/worldStore';
import { isDndSceneEntity } from '@vtt/shared/system/dnd.js';

/**
 * Доступ к сущностям текущего мира — актёрам и существам одним списком.
 *
 * @returns сборщик списка сущностей и поиск сущности по идентификатору
 */
export function useWorldEntities() {
  const worldStore = useWorldStore();

  /**
   * Все сущности текущего мира — и персонажи, и существа.
   *
   * Не `computed`: список спрашивают в обработчиках событий (бросок, drop), а
   * не в разметке, и кэшировать его между жестами незачем.
   *
   * @returns список сущностей мира; пустой, если мир не открыт
   */
  function getCurrentWorldEntities(): SceneEntity[] {
    return collectWorldEntities(worldStore.currentWorld);
  }

  /**
   * Ищет сущность текущего мира по идентификатору — среди актёров и существ.
   *
   * @param entityId - идентификатор сущности
   * @returns сущность либо `undefined`, если её нет в текущем мире
   */
  function findCurrentWorldEntity(
    entityId: string | null | undefined,
  ): SceneEntity | undefined {
    return findEntityInWorld(worldStore.currentWorld, entityId);
  }

  /**
   * Ищет сущность текущего мира с данными системы: участник броска читается
   * живым — эффекты могли измениться, пока окно открыто, а удалённая сущность
   * не должна оставлять старый бонус.
   *
   * @param entityId - идентификатор сущности
   * @returns D&D-сущность либо `undefined`
   */
  function findCurrentDndEntity(
    entityId: string | null | undefined,
  ): DnDSceneEntity | undefined {
    const entity = findCurrentWorldEntity(entityId);

    return entity && isDndSceneEntity(entity) ? entity : undefined;
  }

  return {
    findCurrentDndEntity,
    findCurrentWorldEntity,
    getCurrentWorldEntities,
  };
}
