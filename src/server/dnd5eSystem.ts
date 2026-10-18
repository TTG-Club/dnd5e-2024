/**
 * Серверная игровая система D&D 5th Edition.
 *
 * Наследует расчётную логику (initiative, модификаторы) из shared Dnd5eVttSystem.
 * Добавляет серверный lifecycle (init/destroy).
 *
 * Все расчётные функции (модификатор, бонус мастерства, AC и т.д.)
 * находятся в shared/system/dnd/calculations.ts — единый источник правды (DRY).
 *
 * Система регистрируется через ModuleRegistry.setSystem() при старте мира.
 */

import type { SceneEntity } from '@vtt/shared';
import type {
  DndEntityLight,
  WorldConditionDefinition,
} from '@vtt/shared/system/dnd.js';

import {
  computeEntityLight,
  Dnd5eVttSystem,
  isDndSceneEntity,
  parseWorldConditionRecords,
  setWorldConditionsSource,
} from '@vtt/shared/system/dnd.js';

export class Dnd5eSystem extends Dnd5eVttSystem {
  /**
   * Состояния мира на сервере. Новый массив — только когда записи мира
   * изменились: движок кэширует слияние с каноном по ссылке на список.
   */
  private worldConditions: readonly WorldConditionDefinition[] = [];

  /**
   * Записи мира изменились (хук Ядра: после загрузки мира и после каждой правки
   * записи). Отсюда серверный движок узнаёт состояния мира — без них правила
   * «вешать автоматически» и правки канона работали бы только в браузере.
   *
   * @param items - все записи мира
   */
  onWorldItemsChanged(items: readonly unknown[]): void {
    this.worldConditions = parseWorldConditionRecords(items);
    setWorldConditionsSource(() => this.worldConditions);
  }

  /**
   * Свет сущности на сервере — без кэша по объекту сущности. Сервер правит
   * сущность на месте (эффект сняли, предмет сняли), объект остаётся тем же, и
   * кэш отдал бы прежний свет: ядро считало бы фишку светящей, когда на
   * сцене она уже погасла (расчёт «кто кого видит», VTTG 0.9.700+).
   *
   * @param entity - сущность
   * @returns свет от эффектов либо `undefined`, если светить нечем сверх фишки
   */
  // eslint-disable-next-line class-methods-use-this -- хук контракта VttSystem: ядро вызывает его на экземпляре системы
  override resolveEntityLight(entity: SceneEntity): DndEntityLight | undefined {
    return isDndSceneEntity(entity) ? computeEntityLight(entity) : undefined;
  }

  override init(_api: unknown): void {
    // eslint-disable-next-line no-console -- журнал жизненного цикла системы: другого канала у серверной части нет
    console.log(`[${this.name}] System initialized (v${this.version})`);
  }

  override destroy(): void {
    super.destroy();
    // Движок живёт дольше мира: следующий мир не должен увидеть чужие состояния
    setWorldConditionsSource(null);

    // eslint-disable-next-line no-console -- журнал жизненного цикла системы: другого канала у серверной части нет
    console.log(`[${this.name}] System destroyed`);
  }
}
