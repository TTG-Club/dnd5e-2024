/**
 * Состояния, заведённые в МИРЕ: свои состояния стола и правки канонных.
 *
 * Своего хранилища у системы нет — данные живут в записях мира (хостовый
 * `itemsStore`), здесь они только разбираются и отдаются движку. Разбор один на
 * всё приложение: сетка состояний на листе, значки на токенах и списки
 * иммунитетов обязаны видеть один и тот же список.
 *
 * Обратной операции (отключить источник) здесь нет намеренно: выгрузка системы
 * (`unloadClientSystem`) чистит реестры ЯДРА и до системы не доходит — снимать
 * источник некому и незачем, а без активной системы движок D&D никто не спросит.
 *
 * @module systems/dnd5e/composables/worldConditions
 */

import type { ComputedRef } from 'vue';

import type { WorldConditionDefinition } from '@vtt/shared/system/dnd.js';

import { computed } from 'vue';

import { useItemsStore } from '@/stores/itemsStore';
import {
  CONDITION_ITEM_TYPE,
  parseConditionRecord,
  setWorldConditionsSource,
} from '@vtt/shared/system/dnd.js';

/**
 * Общий на всё приложение вычисляемый список.
 *
 * Один экземпляр, а не новый на каждый вызов: движок кэширует слияние канона с
 * миром по ССЫЛКЕ на этот список, и свежий массив на каждое чтение сбрасывал бы
 * кэш в самых горячих местах (опознание состояния у каждого эффекта).
 */
let worldConditions: ComputedRef<WorldConditionDefinition[]> | null = null;

/**
 * Возвращает общий список состояний мира, создавая его при первом чтении.
 *
 * Лень нужна из-за порядка загрузки: система регистрируется раньше, чем
 * приложение объявляет активную pinia, и обращение к хостовому стору на этапе
 * регистрации упало бы.
 *
 * @returns вычисляемый список состояний мира
 */
function ensureWorldConditions(): ComputedRef<WorldConditionDefinition[]> {
  worldConditions ??= computed(() => {
    const parsed: WorldConditionDefinition[] = [];

    for (const item of useItemsStore().itemsByType(CONDITION_ITEM_TYPE)) {
      const definition = parseConditionRecord(item);

      if (definition) {
        parsed.push(definition);
      }
    }

    return parsed;
  });

  return worldConditions;
}

/**
 * Подключает состояния мира к движку системы.
 *
 * Отдаётся ГЕТТЕРОМ, а не снимком: движок собран и для сервера, где нет ни
 * `vue`, ни `pinia`, поэтому реактивность он не хранит — зато чтение геттера
 * внутри чужого `computed` (в том числе ядрового, рисующего значки на токенах)
 * отслеживает зависимость, и список обновляется сразу после правки записи.
 */
export function connectWorldConditionsToEngine(): void {
  setWorldConditionsSource(() => ensureWorldConditions().value);
}
