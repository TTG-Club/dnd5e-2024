import type { DnDActor, Spell } from '@vtt/shared/system/dnd.js';

import {
  formatConditionalDamageDisplay,
  getSpellDamageParts,
  resolveActorStats,
  resolveSpellDamageFormula,
  stripDamageTypeTokens,
  stripFormulaVariables,
} from '@vtt/shared/system/dnd.js';

/** Кости в русском виде: «2d6» → «2к6» */
const DICE_NOTATION_PATTERN = /(\d+)d(\d+)/gi;

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
 * @param spell - заклинание
 * @param actor - владелец заклинания, если он известен
 * @returns подпись вида «4к6+4» / «1к8 + 1к6», пустая строка — урона нет
 */
export function formatSpellDamageDisplay(
  spell: Spell,
  actor?: DnDActor,
): string {
  const stats = actor ? resolveActorStats(actor) : null;

  const parts = getSpellDamageParts(spell)
    .map((part) => {
      // Инлайн-токены @dmg.<type> — это метки типа, не переменные роллера;
      // убираем их до подстановки @-переменных (иначе resolveVariable падает).
      const resolveTerm = (subFormula: string): string => {
        const baseFormula = stripDamageTypeTokens(subFormula);

        return actor && stats
          ? resolveSpellDamageFormula(spell, actor, baseFormula, stats)
          : stripFormulaVariables(baseFormula);
      };

      return formatConditionalDamageDisplay(part.formula, resolveTerm).replace(
        DICE_NOTATION_PATTERN,
        '$1к$2',
      );
    })
    .filter((formula) => formula.length > 0);

  return parts.join(' + ');
}
