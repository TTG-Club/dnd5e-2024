/**
 * Метка смерти существа: производное состояние «Мёртв» по запасу хитов.
 *
 * Зачем метка вообще нужна. Токены рисует Ядро, и единственный его канал для
 * значка поверх фишки — состояние из `getConditions()`, опознанное в
 * `activeEffects` по `conditionKey`. Поэтому «мёртв» здесь не текст и не флаг
 * в `system`, а обычный эффект-состояние: только так на токене появляется
 * череп.
 *
 * Почему метка ПРОИЗВОДНАЯ, а не ручная: хиты существа меняют четыре разных
 * пути (урон боевым каналом, кнопки ±ХП на токене, лист существа, эффекты), и
 * каждый из них пришлось бы учить ставить и снимать метку. Вместо этого её
 * пересчитывают в единственной точке — нормализации существа
 * (`Dnd5eVttSystem.normalizeCreature`), через которую Ядро прогоняет запись при
 * каждом изменении.
 *
 * Акторов это не касается: персонаж на нуле хитов — «Без сознания», а не мёртв
 * (то же различие делает `getHealthCondition` нейтрального ядра).
 *
 * @module system/dnd/deathState
 */

import type { BaseCreature } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDCreature } from './dndEntities.js';

import { DEATH_CONDITION_KEY } from './conditionKeys.js';
import {
  buildConditionActiveEffect,
  resolveEffectConditionKey,
} from './conditionTemplates.js';
import { isDndCreature } from './entityGuards.js';
import { resolveEntityCurrentHp, resolveEntityMaxHp } from './hitPoints.js';

/**
 * Опознаёт метку смерти среди эффектов.
 *
 * @param effect - активный эффект существа
 * @returns `true`, если это метка «Мёртв»
 */
function isDeathMark(effect: ActiveEffect): boolean {
  return resolveEffectConditionKey(effect) === DEATH_CONDITION_KEY;
}

/**
 * Мертво ли существо по запасу хитов: хиты кончились.
 *
 * Проверка максимума обязательна: у существ с текстовыми хитами («половина
 * хитов призывателя») `average` равен `null`, запас читается нулём — и без неё
 * такое существо считалось бы мёртвым сразу после появления на сцене. Ровно так
 * же страхуется полоса здоровья над токеном (рисуется только при `maxHp > 0`).
 *
 * @param creature - существо с данными D&D
 * @returns `true`, если текущие хиты исчерпаны
 */
export function isCreatureDeadByHitPoints(creature: DnDCreature): boolean {
  return (
    resolveEntityMaxHp(creature) > 0 && resolveEntityCurrentHp(creature) <= 0
  );
}

/**
 * Приводит метку смерти в соответствие с хитами существа: вешает её на нуле
 * хитов и снимает, когда существо вылечили. МУТИРУЕТ `activeEffects`.
 *
 * Существо чужой системы или с испорченными данными не трогаем: без
 * характеристик хиты читать не от чего.
 *
 * @param creature - существо в нейтральной форме ядра (после нормализации)
 */
export function syncCreatureDeathCondition(creature: BaseCreature): void {
  if (!isDndCreature(creature)) {
    return;
  }

  const effects = creature.activeEffects ?? [];
  const isDead = isCreatureDeadByHitPoints(creature);
  const hasMark = effects.some(isDeathMark);

  if (isDead === hasMark) {
    return;
  }

  if (!isDead) {
    creature.activeEffects = effects.filter((effect) => !isDeathMark(effect));

    return;
  }

  const deathMark = buildConditionActiveEffect(DEATH_CONDITION_KEY);

  if (deathMark) {
    creature.activeEffects = [...effects, deathMark];
  }
}
