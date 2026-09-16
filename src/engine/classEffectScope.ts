/**
 * Класс-владелец активного эффекта и подстановка `@classLevel` в его формулы.
 *
 * Умения класса растут по уровню В СВОЁМ КЛАССЕ: «Драконья устойчивость»
 * поднимает максимум хитов на уровень ЧАРОДЕЯ, а не на сумму уровней
 * мультиклассера. Общий `@level` для таких формул не годится — он считает все
 * классы разом.
 *
 * Пайплайн эффектов держит ОДИН контекст формул на весь лист, и уровень своего
 * класса в него не положить: он у каждого эффекта свой. Поэтому число
 * подставляется в сами формулы — один раз, там же, где эффекты собираются
 * (`collectActiveEffects` листа и `collectAllAuraEffects` источника ауры). Так
 * его видят ВСЕ потребители разом — статы листа, бонус-части урона, подписи
 * эффектов, — и ни один путь не может остаться необойдённым.
 *
 * Свой класс эффект называет меткой в id: эффекты умений кладёт на лист мастер
 * класса, и id у них вида `class-effect:<ключ класса>:<id записи>`. Формат
 * живёт здесь, а не в мастере: теперь его ЧИТАЕТ движок, и одна запись формата
 * на всех — единственный способ не разъехаться.
 *
 * @module system/dnd/classEffectScope
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect, EffectChange } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isCreatureEntity } from '@vtt/shared';

import { getClassLevels } from './classTypes.js';
import { COUNTER_FORMULA_TOKENS } from './counterResource.js';

/**
 * Префикс id эффекта, поставленного классом.
 *
 * Собственный id эффекта в записи компендиума не уникален на акторе: тот же
 * эффект приходит с предмета или заклинания, а два класса в мультиклассе
 * принесли бы копию друг друга. Префикс с ключом класса делает id своим и
 * позволяет как снять ровно эффекты одного класса, так и узнать его уровень.
 */
export const CLASS_EFFECT_PREFIX = 'class-effect:';

/**
 * Токен уровня в своём классе — то, что подставляет {@link bindClassLevels}.
 *
 * Берётся из общего словаря токенов листа: диалект формул один на эффекты,
 * ресурсы и таблицу класса, и второе написание того же токена разошлось бы с
 * первым при первой же правке.
 */
const CLASS_LEVEL_TOKEN = COUNTER_FORMULA_TOKENS.classLevel;

/**
 * Совпадение токена целиком: `@classLevels` или `@classLevelX` — не он, и
 * подменять в них начало нельзя.
 */
const CLASS_LEVEL_PATTERN = new RegExp(`${CLASS_LEVEL_TOKEN}\\b`, 'g');

/**
 * Собирает id эффекта, поставленного классом.
 *
 * @param classKey - ключ класса
 * @param effectId - id эффекта в записи компендиума
 * @returns id эффекта на акторе
 */
export function buildClassEffectId(classKey: string, effectId: string): string {
  return `${CLASS_EFFECT_PREFIX}${classKey}:${effectId}`;
}

/**
 * Проверяет, поставлен ли эффект указанным классом.
 *
 * @param effect - активный эффект актёра
 * @param classKey - ключ класса
 * @returns `true`, если эффект принадлежит этому классу
 */
export function isClassEffect(effect: ActiveEffect, classKey: string): boolean {
  return effect.id.startsWith(`${CLASS_EFFECT_PREFIX}${classKey}:`);
}

/**
 * Ключ класса, поставившего эффект, — из метки в id.
 *
 * @param effectId - id эффекта на акторе
 * @returns ключ класса либо `undefined`, если эффект поставлен не классом
 */
function readClassEffectClassKey(effectId: string): string | undefined {
  if (!effectId.startsWith(CLASS_EFFECT_PREFIX)) {
    return undefined;
  }

  const rest = effectId.slice(CLASS_EFFECT_PREFIX.length);
  const separator = rest.indexOf(':');

  return separator > 0 ? rest.slice(0, separator) : undefined;
}

/**
 * Уровни сущности по классам. У существа классов нет — карта пустая.
 *
 * Ветка по виду сущности обязательна: у union `system` не сужается сам.
 *
 * @param entity - актор или существо
 * @returns «ключ класса → уровень в нём»
 */
function classLevelsOf(entity: DnDSceneEntity): ReadonlyMap<string, number> {
  return isCreatureEntity(entity)
    ? new Map()
    : getClassLevels(entity.system.classes);
}

/** Есть ли в строке токен уровня своего класса */
function hasToken(value: string | undefined): boolean {
  return value !== undefined && value.includes(CLASS_LEVEL_TOKEN);
}

/** Подставляет уровень класса в одну формулу */
function bindFormula(value: string, classLevel: number): string {
  return value.replace(CLASS_LEVEL_PATTERN, String(classLevel));
}

/** Подставляет уровень класса в строку изменения */
function bindChange(change: EffectChange, classLevel: number): EffectChange {
  if (!hasToken(change.value) && !hasToken(change.condition)) {
    return change;
  }

  return {
    ...change,
    value: bindFormula(change.value, classLevel),
    ...(change.condition === undefined
      ? {}
      : { condition: bindFormula(change.condition, classLevel) }),
  };
}

/** Подставляет уровень класса в часть урона эффекта */
function bindDamagePart(part: DamagePart, classLevel: number): DamagePart {
  if (!hasToken(part.formula) && !hasToken(part.versatileFormula)) {
    return part;
  }

  return {
    ...part,
    formula: bindFormula(part.formula, classLevel),
    ...(part.versatileFormula === undefined
      ? {}
      : { versatileFormula: bindFormula(part.versatileFormula, classLevel) }),
  };
}

/** Все места эффекта, где может стоять формула с токеном */
function effectUsesClassLevel(effect: ActiveEffect): boolean {
  return (
    effect.changes.some(
      (change) => hasToken(change.value) || hasToken(change.condition),
    )
    || (effect.damageParts ?? []).some(
      (part) => hasToken(part.formula) || hasToken(part.versatileFormula),
    )
    || (effect.recurringDamage?.damageParts ?? []).some(
      (part) => hasToken(part.formula) || hasToken(part.versatileFormula),
    )
    || hasToken(effect.aura?.radiusFormula)
  );
}

/** Собирает копию эффекта с подставленным уровнем класса */
function bindEffect(effect: ActiveEffect, classLevel: number): ActiveEffect {
  return {
    ...effect,
    changes: effect.changes.map((change) => bindChange(change, classLevel)),
    ...(effect.damageParts === undefined
      ? {}
      : {
          damageParts: effect.damageParts.map((part) =>
            bindDamagePart(part, classLevel),
          ),
        }),
    ...(effect.recurringDamage === undefined
      ? {}
      : {
          recurringDamage: {
            ...effect.recurringDamage,
            damageParts: effect.recurringDamage.damageParts.map((part) =>
              bindDamagePart(part, classLevel),
            ),
          },
        }),
    ...(effect.aura?.radiusFormula === undefined
      ? {}
      : {
          aura: {
            ...effect.aura,
            radiusFormula: bindFormula(effect.aura.radiusFormula, classLevel),
          },
        }),
  };
}

/**
 * Подставляет в формулы эффектов уровень их собственного класса (`@classLevel`).
 *
 * Эффект без метки класса (свой эффект листа, предмет, вид, черта) остаётся
 * нетронутым: его `@classLevel` прочитается движком формул как `@level` — у
 * одноклассника это то же число, и формула без класса за спиной посчитает
 * ровно то, что считала до появления токена.
 *
 * Записи сущности не мутируются: копия собирается только у тех эффектов, где
 * токен действительно есть.
 *
 * @param effects - собранные активные эффекты
 * @param entity - сущность, у которой они собраны (источник уровней классов)
 * @returns эффекты с подставленным уровнем класса
 */
export function bindClassLevels(
  effects: readonly ActiveEffect[],
  entity: DnDSceneEntity,
): readonly ActiveEffect[] {
  if (!effects.some((effect) => effectUsesClassLevel(effect))) {
    return effects;
  }

  const classLevels = classLevelsOf(entity);

  if (classLevels.size === 0) {
    return effects;
  }

  return effects.map((effect) => {
    const classKey = readClassEffectClassKey(effect.id);

    const classLevel =
      classKey === undefined ? undefined : classLevels.get(classKey);

    if (classLevel === undefined || !effectUsesClassLevel(effect)) {
      return effect;
    }

    return bindEffect(effect, classLevel);
  });
}
