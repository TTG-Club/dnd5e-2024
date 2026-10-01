/**
 * Тип урона своих заклинаний на выбор при касте: «когда вы накладываете
 * заклинание, наносящее урон, вы можете изменить тип урона на психическую
 * энергию» («Психические заклинания», «Арканный некроз», «Разлагающий
 * Несвет»).
 *
 * Эффект носителя несёт строку {@link SPELL_DAMAGE_TYPE_KEY} с типом урона.
 * Перед кастом тип каждой части урона заклинания (и урона его эффектов)
 * становится выбором «свой или новый» — обычным `@dmg.choice(…)`, и дальше
 * вопрос задаёт тот же разбор, что у «Цветного шарика»: в окне броска или
 * плашкой. Правило «можете» соблюдается выбором: свой тип всегда первый.
 *
 * @module system/dnd/spellDamageRetype
 */

import type { DamagePart } from '@vtt/shared';

import type { DamageTypeChoiceSource } from './damageTypeChoice.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { SPELL_DAMAGE_TYPE_KEY } from './activeEffectTypes.js';
import { isDefensibleDamageType } from './damageConstants.js';
import { mapSourceDamageParts } from './damageTypeChoice.js';
import { resolveActorStats } from './effectPipeline.js';
import { addDamageTypeAlternatives } from './formulaTokens.js';

/**
 * Типы урона, на которые носитель может сменить урон своих заклинаний.
 *
 * @param caster - заклинатель
 * @returns ключи типов без повторов; пусто, если таких эффектов нет
 */
export function listSpellDamageRetypes(caster: DnDSceneEntity): string[] {
  const { weaponOverrides } = resolveActorStats(caster);

  const types = weaponOverrides
    .filter(
      (entry) =>
        entry.key === SPELL_DAMAGE_TYPE_KEY
        && isDefensibleDamageType(entry.value),
    )
    .map((entry) => entry.value);

  return [...new Set(types)];
}

/**
 * Часть урона с типом на выбор «свой или один из новых».
 *
 * @param part - часть урона
 * @param types - новые типы
 * @returns исходная часть, если менять нечего, иначе копия
 */
function retypePart(part: DamagePart, types: readonly string[]): DamagePart {
  const ownType =
    part.type !== undefined && isDefensibleDamageType(part.type)
      ? part.type
      : undefined;

  const formula = addDamageTypeAlternatives(part.formula, ownType, types);

  const versatileFormula =
    part.versatileFormula === undefined
      ? undefined
      : addDamageTypeAlternatives(part.versatileFormula, ownType, types);

  if (formula === part.formula && versatileFormula === part.versatileFormula) {
    return part;
  }

  return {
    ...part,
    formula,
    ...(versatileFormula === undefined ? {} : { versatileFormula }),
  };
}

/**
 * Заклинание с типом урона на выбор заклинателя: к типу каждой части урона
 * добавлены типы, на которые он может его сменить.
 *
 * @param spell - заклинание перед кастом
 * @param caster - заклинатель
 * @returns то же заклинание, если менять нечего, иначе копия
 */
export function retypeCasterSpellDamage<Source extends DamageTypeChoiceSource>(
  spell: Source,
  caster: DnDSceneEntity,
): Source {
  const types = listSpellDamageRetypes(caster);

  if (types.length === 0) {
    return spell;
  }

  return mapSourceDamageParts(spell, (part) => retypePart(part, types));
}
