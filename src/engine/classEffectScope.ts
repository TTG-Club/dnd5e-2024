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

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isCreatureEntity } from '@vtt/shared';

import { getClassLevels } from './classTypes.js';
import { bindOwnerChoices } from './effectChoiceBinding.js';
import { bindEffectToken, effectUsesToken } from './effectTokenBinding.js';
import { COUNTER_FORMULA_TOKENS } from './formulaParser.js';

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
  if (!effects.some((effect) => effectUsesToken(effect, CLASS_LEVEL_TOKEN))) {
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

    return classLevel === undefined
      ? effect
      : bindEffectToken(effect, CLASS_LEVEL_TOKEN, classLevel);
  });
}

/**
 * Подставляет в эффекты всё, что знает только их владелец: уровень своего
 * класса (`@classLevel`) и сделанные на листе выборы (`@choice.<ключ>`,
 * `@mod.feat` — `effectChoiceBinding.ts`). Одна точка на все места, где эффекты
 * владельца собираются: свои эффекты, ауры, эффекты «на цель».
 *
 * @param effects - собранные эффекты владельца
 * @param entity - владелец
 * @returns эффекты с подставленными числами и выборами
 */
export function bindOwnerTokens(
  effects: readonly ActiveEffect[],
  entity: DnDSceneEntity,
): readonly ActiveEffect[] {
  // Выборы — первыми: подстановка уровня класса делает копии эффектов, а
  // выборы ищутся и запоминаются по самим записям листа
  return bindClassLevels(bindOwnerChoices(effects, entity), entity);
}
