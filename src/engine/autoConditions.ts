/**
 * Состояния, которые вешаются сами: у состояния есть правило «вешать
 * автоматически» (`ConditionEntry.autoApply`) — строка словаря условий, та же,
 * что у срабатываний эффектов (`triggerConditions.ts`). Пока правило
 * выполняется, состояние висит на сущности; перестало — снимается.
 *
 * Правило задаётся в самом состоянии, а не в коде: канонный «Окровавленный»
 * приходит с правилом «хитов не больше половины», мастер может его поменять
 * или завести своё состояние с правилом («Тяжело ранен» — хитов не больше 10).
 *
 * Пересчёт живёт в нормализации сущности (`Dnd5eVttSystem.normalizeActor` /
 * `normalizeCreature`): Ядро прогоняет через неё каждую запись персонажа и
 * существа, поэтому значок появляется и снимается одинаково, каким бы путём ни
 * поменялись хиты, отметки или состояния.
 *
 * Правило владеет состоянием целиком: поставленный руками значок при
 * невыполненном правиле тоже снимается — иначе значок врал бы о хитах.
 *
 * @module system/dnd/autoConditions
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { ConditionRef } from './conditionKeys.js';
import type { DnDSceneEntity } from './dndEntities.js';

import {
  buildConditionActiveEffect,
  listConditions,
  resolveEffectConditionKey,
} from './conditionTemplates.js';
import { isTriggerConditionMet } from './triggerConditions.js';

/**
 * Несёт ли эффект состояние самой сущности. Аура, которая раздаёт состояние
 * другим, не в счёт: её снимать нельзя, и носителя она не метит.
 *
 * @param effect - активный эффект сущности
 * @param conditionKey - ключ состояния
 * @returns `true`, если эффект — это состояние на самой сущности
 */
function isOwnConditionEffect(
  effect: ActiveEffect,
  conditionKey: ConditionRef,
): boolean {
  return (
    !(effect.aura && !effect.aura.applyToSelf)
    && resolveEffectConditionKey(effect) === conditionKey
  );
}

/**
 * Приводит одно состояние с правилом в соответствие с сущностью. МУТИРУЕТ её.
 *
 * @param entity - персонаж или существо
 * @param conditionKey - ключ состояния
 * @param rule - правило «вешать автоматически»
 * @returns `true`, если состояние поставили или сняли
 */
function syncAutoCondition(
  entity: DnDSceneEntity,
  conditionKey: ConditionRef,
  rule: string,
): boolean {
  const effects = entity.activeEffects ?? [];
  const shouldHave = isTriggerConditionMet(entity, { condition: rule });

  const has = effects.some((effect) =>
    isOwnConditionEffect(effect, conditionKey),
  );

  if (shouldHave === has) {
    return false;
  }

  if (!shouldHave) {
    entity.activeEffects = effects.filter(
      (effect) => !isOwnConditionEffect(effect, conditionKey),
    );

    return true;
  }

  const mark = buildConditionActiveEffect(conditionKey);

  if (!mark) {
    return false;
  }

  entity.activeEffects = [...effects, mark];

  return true;
}

/**
 * Ставит и снимает все состояния с правилом «вешать автоматически» по текущему
 * виду сущности. МУТИРУЕТ её — так нормализация Ядра пишет в отданную сущность.
 *
 * Один проход по справочнику: правило, которое смотрит на другое состояние,
 * видит его уже пересчитанным, если то стоит в справочнике раньше.
 *
 * @param entity - персонаж или существо
 * @returns `true`, если что-то поставили или сняли
 */
export function syncAutoAppliedConditions(entity: DnDSceneEntity): boolean {
  let changed = false;

  for (const condition of listConditions()) {
    if (condition.autoApply) {
      changed =
        syncAutoCondition(entity, condition.key, condition.autoApply)
        || changed;
    }
  }

  return changed;
}
