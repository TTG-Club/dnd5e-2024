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

import type { WorldConditionDefinition } from '@vtt/shared/system/dnd.js';

import {
  Dnd5eVttSystem,
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
