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

import { collectWorldEntities, findEntityInWorld } from '@/core/entityUtils';
import { useWorldStore } from '@/stores/worldStore';

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

  return { findCurrentWorldEntity, getCurrentWorldEntities };
}
