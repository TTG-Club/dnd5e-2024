import type {
  DamagePartDisplay,
  DamageSetDisplay,
  DnDActor,
  Spell,
} from '@vtt/shared/system/dnd.js';

import {
  combineDamagePartDisplays,
  formatDiceLetters,
  getSpellDamageParts,
  labelPaidTokens,
  resolveActorStats,
  resolveSpellDamageFormula,
  scaleDamageFormula,
  splitConditionalDamageDisplay,
  stripDamageTypeTokens,
  stripFormulaVariables,
} from '@vtt/shared/system/dnd.js';

/** Что уточняет показ урона: владелец заклинания и круг наложения */
interface SpellDamageDisplayOptions {
  /** Владелец заклинания: по нему @-переменные становятся числами */
  actor?: DnDActor;
  /** Круг наложения, если он задан записью (группа существа, врождённый каст) */
  castLevel?: number;
}

/**
 * Дописывает усиление высших кругов к постоянной части урона; у части целиком
 * под условием — к последней добавке, то есть в конец строки, как и раньше.
 *
 * @param display - показ части урона
 * @param scale - дописывает усиление к формуле
 * @returns показ части с усилением
 */
function scalePartDisplay(
  display: DamagePartDisplay,
  scale: (formula: string) => string,
): DamagePartDisplay {
  if (display.baseFormula) {
    return { ...display, baseFormula: scale(display.baseFormula) };
  }

  const lastIndex = display.conditionalFormulas.length - 1;

  return {
    ...display,
    conditionalFormulas: display.conditionalFormulas.map((formula, index) =>
      index === lastIndex ? scale(formula) : formula,
    ),
  };
}

/**
 * Формула урона заклинания для показа в списке.
 *
 * При известном владельце подставляет @-переменные конкретным числом; без него
 * (глобальный список предметов) убирает @-токены, оставляя одни кости. Условные
 * ветки `@target.*` показываются через «или».
 *
 * Общая для строки листа и для строки компендиума: расходиться показ урона в
 * двух списках не должен.
 *
 * Известный круг наложения (`castLevel` — группа заклинаний существа, врождённый
 * каст на фиксированном круге) дописывает усиление высших кругов к ПЕРВОЙ части
 * урона — той же, что усиливает окно броска. Без него показ базовый.
 *
 * Плитке строки листа нужна только постоянная часть урона: добавок по условию
 * («+2к6, если цель лежит ничком») может быть сколько угодно, их место — в
 * подсказке. Поэтому показ отдаётся и целиком, и разложенным.
 *
 * @param spell - заклинание
 * @param options - владелец заклинания и круг наложения
 * @returns показ урона; пустая `formula` — урона нет
 */
export function describeSpellDamageDisplay(
  spell: Spell,
  options: SpellDamageDisplayOptions = {},
): DamageSetDisplay {
  const { actor, castLevel } = options;

  const stats = actor ? resolveActorStats(actor) : null;

  const scalingDice = spell.scaling?.additionalDice;

  const parts = getSpellDamageParts(spell).map(
    (part, partIndex): DamagePartDisplay => {
      // Инлайн-токены @dmg.<type> — это метки типа, не переменные роллера;
      // убираем их до подстановки @-переменных (иначе resolveVariable падает).
      const resolveTerm = (subFormula: string): string => {
        // Потраченное ценой (`@paid.*`) до каста неизвестно: показывается
        // подписью, а не падает неизвестной переменной
        const baseFormula = labelPaidTokens(stripDamageTypeTokens(subFormula));

        return actor && stats
          ? resolveSpellDamageFormula(spell, actor, baseFormula, stats)
          : stripFormulaVariables(baseFormula);
      };

      const split = splitConditionalDamageDisplay(
        part.formula,
        resolveTerm,
        Boolean(part.type),
      );

      const display: DamagePartDisplay = {
        baseFormula: formatDiceLetters(split.base),
        conditionalFormulas: split.conditional.map((piece) =>
          formatDiceLetters(piece),
        ),
      };

      if (partIndex !== 0 || castLevel === undefined || !scalingDice) {
        return display;
      }

      // Кости усиления записаны в данных как есть («1d8») — буква приводится
      // к той же, что у остальной формулы
      return scalePartDisplay(display, (formula) =>
        formatDiceLetters(
          scaleDamageFormula(formula, scalingDice, spell.level, castLevel),
        ),
      );
    },
  );

  return combineDamagePartDisplays(parts);
}

/**
 * Формула урона заклинания одной строкой — для списка компендиума, где
 * подсказки у урона нет. Строке листа — {@link describeSpellDamageDisplay}.
 *
 * @param spell - заклинание
 * @param options - владелец заклинания и круг наложения
 * @returns подпись вида «4к6+4» / «1к8 + 1к6», пустая строка — урона нет
 */
export function formatSpellDamageDisplay(
  spell: Spell,
  options: SpellDamageDisplayOptions = {},
): string {
  return describeSpellDamageDisplay(spell, options).formula;
}
