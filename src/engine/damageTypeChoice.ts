/**
 * Тип урона на выбор: `@dmg.choice(acid,cold,fire)` и `@dmg.random(…)`.
 *
 * В правилах 2024 года много урона «одного из типов»: «Цветной шарик»,
 * «Чародейская вспышка», «Духовные стражи». Несколько `@dmg.<тип>` на одной
 * кости значат другое — урон всеми типами сразу (цели достаётся выгоднейший),
 * поэтому выбор записывается своим токеном, а решается ДО броска: итог
 * выбора подставляется в формулы обычным `@dmg.<тип>`, и дальше урон идёт
 * как любой другой — со своими сопротивлениями, уязвимостями и иммунитетом.
 *
 * Где решается выбор:
 * - у источника броска (заклинание, действие существа, оружие, предмет) —
 *   перед броском, одним вопросом на все его формулы, эффекты «на цель» и
 *   зоны включительно ({@link applySourceDamageTypeChoices}); так выбор
 *   делает тот, кто накладывает, и урон эффекта на цели потом идёт уже
 *   выбранным типом;
 * - остаток, который до броска не дошёл (бонус-урон собственных эффектов
 *   листа, эффекты без источника), решается при самом броске
 *   ({@link settleDamageTypeChoices}): окно броска спрашивает, а там, где
 *   спросить некого (урон эффекта в начале хода на сервере), тип выпадает
 *   случайно.
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { CreatureDamageAlternative } from './creatureDamageAlternatives.js';
import type { CantripScalingTier } from './dndEntities.js';
import type { DamageTypeChoice } from './formulaTokens.js';

import { listCreatureDamageAlternatives } from './creatureDamageAlternatives.js';
import {
  damageTypeChoiceKey,
  hasDamageTypeChoiceToken,
  listDamageTypeChoiceTokens,
  replaceDamageTypeChoiceTokens,
  uniqueDamageTypeChoices,
} from './formulaTokens.js';
import { mapTriggerDamageParts } from './triggerDamageParts.js';

/** Итог выбора: ключ типа на выбор ({@link damageTypeChoiceKey}) → тип урона */
export type DamageTypeChoicePicks = ReadonlyMap<string, string>;

/**
 * Источник броска с формулами урона: заклинание, действие существа, оружие,
 * предмет. Поля необязательные — у каждого вида источника своё подмножество.
 */
export interface DamageTypeChoiceSource {
  damageParts?: DamagePart[];
  cantripScalingTiers?: CantripScalingTier[];
  damageAlternatives?: CreatureDamageAlternative[];
  activeEffects?: ActiveEffect[];
}

/** Часть урона, у которой тип может быть ещё не выбран */
export interface DamageTypeChoicePart {
  type?: string;
  types?: string[];
  typeChoice?: DamageTypeChoice;
}

/**
 * Формулы части урона: основная и формула двуручного хвата.
 *
 * @param part - часть урона
 * @returns формулы части
 */
function listPartFormulas(part: DamagePart): string[] {
  return part.versatileFormula === undefined
    ? [part.formula]
    : [part.formula, part.versatileFormula];
}

/**
 * Все формулы урона эффекта: его урон, периодический урон, урон
 * срабатываний и значения модификаторов (бонус-урон `damage.*`).
 *
 * @param effect - эффект
 * @returns формулы эффекта
 */
function listEffectFormulas(effect: ActiveEffect): string[] {
  const triggerParts = (effect.triggers ?? []).flatMap((trigger) =>
    trigger.actions.flatMap((action) =>
      action.type === 'damage' ? action.parts : [],
    ),
  );

  return [
    ...(effect.damageParts ?? []).flatMap(listPartFormulas),
    ...(effect.recurringDamage?.damageParts ?? []).flatMap(listPartFormulas),
    ...triggerParts.flatMap(listPartFormulas),
    ...effect.changes.map((change) => change.value),
  ];
}

/**
 * Все формулы урона источника броска.
 *
 * @param source - заклинание, действие, оружие или предмет
 * @returns формулы источника
 */
function listSourceFormulas(source: DamageTypeChoiceSource): string[] {
  return [
    ...(source.damageParts ?? []).flatMap(listPartFormulas),
    ...(source.cantripScalingTiers ?? []).flatMap((tier) =>
      tier.parts.flatMap(listPartFormulas),
    ),
    ...listCreatureDamageAlternatives(source).flatMap((alternative) =>
      alternative.damageParts.flatMap(listPartFormulas),
    ),
    ...(source.activeEffects ?? []).flatMap(listEffectFormulas),
  ];
}

/**
 * Типы на выбор в формулах — без повторов: одинаковый список в нескольких
 * местах (кость и её рост по уровню, урон и эффект зоны) — один вопрос.
 *
 * @param formulas - формулы
 * @returns типы на выбор по порядку первого появления
 */
export function listDamageTypeChoices(
  formulas: readonly string[],
): DamageTypeChoice[] {
  return uniqueDamageTypeChoices(formulas.flatMap(listDamageTypeChoiceTokens));
}

/**
 * Типы на выбор источника броска — всё, о чём спросить перед броском.
 *
 * @param source - заклинание, действие, оружие или предмет
 * @returns типы на выбор по порядку первого появления
 */
export function listSourceDamageTypeChoices(
  source: DamageTypeChoiceSource,
): DamageTypeChoice[] {
  return listDamageTypeChoices(listSourceFormulas(source));
}

/**
 * Подставляет выбранные типы в формулу: `@dmg.choice(fire,cold)` →
 * `@dmg.fire`. Токен без выбора остаётся — его решит бросок.
 *
 * @param formula - формула
 * @param picks - итог выбора
 * @returns формула с выбранными типами
 */
export function applyDamageTypeChoicePicks(
  formula: string,
  picks: DamageTypeChoicePicks,
): string {
  return replaceDamageTypeChoiceTokens(formula, (choice) =>
    picks.get(damageTypeChoiceKey(choice)),
  );
}

/**
 * Выбранные типы в части урона.
 *
 * @param part - часть урона
 * @param picks - итог выбора
 * @returns исходная часть, если менять нечего, иначе копия
 */
function applyPartPicks(
  part: DamagePart,
  picks: DamageTypeChoicePicks,
): DamagePart {
  if (
    !hasDamageTypeChoiceToken(part.formula)
    && !hasDamageTypeChoiceToken(part.versatileFormula ?? '')
  ) {
    return part;
  }

  return {
    ...part,
    formula: applyDamageTypeChoicePicks(part.formula, picks),
    ...(part.versatileFormula === undefined
      ? {}
      : {
          versatileFormula: applyDamageTypeChoicePicks(
            part.versatileFormula,
            picks,
          ),
        }),
  };
}

/**
 * Выбранные типы в эффекте: урон, периодический урон, урон срабатываний и
 * модификаторы.
 *
 * @param effect - эффект
 * @param picks - итог выбора
 * @returns исходный эффект, если менять нечего, иначе копия
 */
function applyEffectPicks(
  effect: ActiveEffect,
  picks: DamageTypeChoicePicks,
): ActiveEffect {
  if (!listEffectFormulas(effect).some(hasDamageTypeChoiceToken)) {
    return effect;
  }

  const mapPart = (part: DamagePart): DamagePart => applyPartPicks(part, picks);

  return {
    ...effect,
    changes: effect.changes.map((change) =>
      hasDamageTypeChoiceToken(change.value)
        ? { ...change, value: applyDamageTypeChoicePicks(change.value, picks) }
        : change,
    ),
    ...(effect.damageParts === undefined
      ? {}
      : { damageParts: effect.damageParts.map(mapPart) }),
    ...(effect.recurringDamage === undefined
      ? {}
      : {
          recurringDamage: {
            ...effect.recurringDamage,
            damageParts: effect.recurringDamage.damageParts.map(mapPart),
          },
        }),
    ...(effect.triggers === undefined
      ? {}
      : {
          triggers: effect.triggers.map((trigger) =>
            mapTriggerDamageParts(trigger, mapPart),
          ),
        }),
  };
}

/**
 * Источник броска с выбранными типами во всех его формулах: урон, ступени
 * заговора, урон «или» существа и эффекты (включая зоны и эффекты «на
 * цель» — их урон потом идёт уже выбранным типом).
 *
 * @param source - заклинание, действие, оружие или предмет
 * @param picks - итог выбора
 * @returns исходный источник, если выбора нет, иначе копия
 */
export function applySourceDamageTypeChoices<
  Source extends DamageTypeChoiceSource,
>(source: Source, picks: DamageTypeChoicePicks): Source {
  if (picks.size === 0) {
    return source;
  }

  const mapPart = (part: DamagePart): DamagePart => applyPartPicks(part, picks);

  const alternatives = listCreatureDamageAlternatives(source);

  return {
    ...source,
    ...(source.damageParts === undefined
      ? {}
      : { damageParts: source.damageParts.map(mapPart) }),
    ...(source.cantripScalingTiers === undefined
      ? {}
      : {
          cantripScalingTiers: source.cantripScalingTiers.map((tier) => ({
            ...tier,
            parts: tier.parts.map(mapPart),
          })),
        }),
    ...(alternatives.length === 0
      ? {}
      : {
          damageAlternatives: alternatives.map((alternative) => ({
            ...alternative,
            damageParts: alternative.damageParts.map(mapPart),
          })),
        }),
    ...(source.activeEffects === undefined
      ? {}
      : {
          activeEffects: source.activeEffects.map((effect) =>
            applyEffectPicks(effect, picks),
          ),
        }),
  };
}

/**
 * Случайный тип из вариантов — с равными шансами («бросьте к8: тип по
 * таблице»).
 *
 * @param choice - тип на выбор
 * @param random - источник случайности в [0, 1)
 * @returns выпавший тип
 */
export function rollDamageTypeChoice(
  choice: DamageTypeChoice,
  random: () => number = Math.random,
): string {
  const index = Math.min(
    choice.options.length - 1,
    Math.floor(random() * choice.options.length),
  );

  return choice.options[Math.max(0, index)];
}

/**
 * Бросает случай у всех типов «случайно» (`@dmg.random`); выбор человека
 * (`@dmg.choice`) не трогает.
 *
 * @param choices - типы на выбор
 * @param random - источник случайности в [0, 1)
 * @returns итог выбора по случайным
 */
export function rollRandomDamageTypeChoices(
  choices: readonly DamageTypeChoice[],
  random: () => number = Math.random,
): Map<string, string> {
  return new Map(
    choices
      .filter((choice) => choice.mode === 'random')
      .map((choice) => [
        damageTypeChoiceKey(choice),
        rollDamageTypeChoice(choice, random),
      ]),
  );
}

/**
 * Типы на выбор, оставшиеся у развёрнутых частей урона, без повторов.
 *
 * @param parts - развёрнутые части
 * @returns типы на выбор по порядку первого появления
 */
export function listPartDamageTypeChoices(
  parts: readonly DamageTypeChoicePart[],
): DamageTypeChoice[] {
  return uniqueDamageTypeChoices(
    parts.flatMap((part) => (part.typeChoice ? [part.typeChoice] : [])),
  );
}

/**
 * Решает типы на выбор у развёрнутых частей перед броском: выбранный тип
 * становится типом части. Чего в итоге выбора нет — выпадает случайно: у
 * `@dmg.random` так и задумано, а у `@dmg.choice` без вопроса (урон эффекта
 * в начале хода, сервер) спросить некого, и равные шансы честнее, чем урон
 * без типа. Одинаковый список у нескольких частей получает один тип.
 *
 * @param parts - развёрнутые части
 * @param picks - итог выбора
 * @param random - источник случайности в [0, 1)
 * @returns части с решённым типом
 */
export function settleDamageTypeChoices<Part extends DamageTypeChoicePart>(
  parts: readonly Part[],
  picks: DamageTypeChoicePicks = new Map(),
  random: () => number = Math.random,
): Part[] {
  const settled = new Map(picks);

  return parts.map((part) => {
    if (!part.typeChoice) {
      return part;
    }

    const key = damageTypeChoiceKey(part.typeChoice);

    const type =
      settled.get(key) ?? rollDamageTypeChoice(part.typeChoice, random);

    settled.set(key, type);

    return { ...part, type, types: undefined, typeChoice: undefined };
  });
}
