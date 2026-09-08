import type { DnDActor, Spell } from '@vtt/shared/system/dnd.js';

import {
  formatConditionalDamageDisplay,
  getSpellDamageParts,
  resolveActorStats,
  resolveSpellDamageFormula,
  scaleDamageFormula,
  stripDamageTypeTokens,
  stripFormulaVariables,
} from '@vtt/shared/system/dnd.js';

/** Кости в русском виде: «2d6» → «2к6» */
const DICE_NOTATION_PATTERN = /(\d+)d(\d+)/gi;

/** Что уточняет показ урона: владелец заклинания и круг наложения */
interface SpellDamageDisplayOptions {
  /** Владелец заклинания: по нему @-переменные становятся числами */
  actor?: DnDActor;
  /** Круг наложения, если он задан записью (группа существа, врождённый каст) */
  castLevel?: number;
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
 * @param spell - заклинание
 * @param options - владелец заклинания и круг наложения
 * @returns подпись вида «4к6+4» / «1к8 + 1к6», пустая строка — урона нет
 */
export function formatSpellDamageDisplay(
  spell: Spell,
  options: SpellDamageDisplayOptions = {},
): string {
  const { actor, castLevel } = options;

  const stats = actor ? resolveActorStats(actor) : null;

  const scalingDice = spell.scaling?.additionalDice;

  const parts = getSpellDamageParts(spell)
    .map((part, partIndex) => {
      // Инлайн-токены @dmg.<type> — это метки типа, не переменные роллера;
      // убираем их до подстановки @-переменных (иначе resolveVariable падает).
      const resolveTerm = (subFormula: string): string => {
        const baseFormula = stripDamageTypeTokens(subFormula);

        return actor && stats
          ? resolveSpellDamageFormula(spell, actor, baseFormula, stats)
          : stripFormulaVariables(baseFormula);
      };

      const formula = formatConditionalDamageDisplay(
        part.formula,
        resolveTerm,
      ).replace(DICE_NOTATION_PATTERN, '$1к$2');

      if (partIndex !== 0 || castLevel === undefined || !scalingDice) {
        return formula;
      }

      return scaleDamageFormula(formula, scalingDice, spell.level, castLevel);
    })
    .filter((formula) => formula.length > 0);

  return parts.join(' + ');
}
