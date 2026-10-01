/**
 * Спасбросок одной из нескольких характеристик на выбор бросающего:
 * «существо совершает спасбросок Силы или Ловкости».
 *
 * Выбирает бросающий, и выбор у него один разумный — характеристика с лучшим
 * спасброском. Поэтому вопроса нет: система берёт её сама, при равенстве —
 * первую по записи. Одна точка на все пути спасброска: при наложении у цели на
 * клиенте, у зоны и ауры на сервере и у срабатывания.
 *
 * @module system/dnd/saveAbilityChoice
 */

import type { AbilityType } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { ABILITY_GENITIVE_LABELS, ABILITY_LABELS } from './consts.js';
import { resolveActorStats } from './effectPipeline.js';

/** Спасбросок с характеристиками на выбор */
export interface SaveAbilityChoice {
  /** Характеристика спасброска */
  ability: AbilityType;
  /** Ещё характеристики на выбор бросающего */
  altAbilities?: readonly AbilityType[];
}

/**
 * Характеристики спасброска по порядку записи, без повторов.
 *
 * @param save - спасбросок
 * @returns характеристики; одна — выбора нет
 */
export function listSaveAbilities(save: SaveAbilityChoice): AbilityType[] {
  return [...new Set([save.ability, ...(save.altAbilities ?? [])])];
}

/**
 * Характеристики на выбор для записи: без основной характеристики спасброска
 * (она названа отдельно) и без пустого списка — поле тогда не пишется.
 *
 * @param ability - основная характеристика спасброска
 * @param abilities - отмеченные автором характеристики
 * @returns список для поля `altAbilities` либо `undefined`
 */
export function normalizeAltAbilities(
  ability: AbilityType,
  abilities: readonly AbilityType[],
): AbilityType[] | undefined {
  const others = abilities.filter((candidate) => candidate !== ability);

  return others.length > 0 ? others : undefined;
}

/**
 * Характеристика, которой бросающий совершит спасбросок: лучшая из названных.
 *
 * @param entity - кто бросает; нет — берётся первая по записи
 * @param save - спасбросок
 * @param ambientEffects - ауры чужих токенов, накрывающие бросающего
 * @returns характеристика спасброска
 */
export function pickSaveAbility(
  entity: DnDSceneEntity | undefined,
  save: SaveAbilityChoice,
  ambientEffects: readonly ActiveEffect[] = [],
): AbilityType {
  const abilities = listSaveAbilities(save);

  if (!entity || abilities.length === 1) {
    return save.ability;
  }

  const { saves } = resolveActorStats(entity, ambientEffects);

  // При равенстве остаётся первая по записи
  return abilities.reduce((best, ability) =>
    saves[ability] > saves[best] ? ability : best,
  );
}

/** Чем соединяются характеристики на выбор в подписи */
const ABILITY_CHOICE_JOINER = ' или ';

/**
 * Характеристики спасброска словами в родительном падеже: «Силы или
 * Ловкости».
 *
 * @param save - спасбросок
 * @returns подпись
 */
export function describeSaveAbilitiesGenitive(save: SaveAbilityChoice): string {
  return listSaveAbilities(save)
    .map((ability) => ABILITY_GENITIVE_LABELS[ability])
    .join(ABILITY_CHOICE_JOINER);
}

/**
 * Характеристики спасброска словами: «Сила или Ловкость».
 *
 * @param save - спасбросок
 * @returns подпись
 */
export function describeSaveAbilities(save: SaveAbilityChoice): string {
  return listSaveAbilities(save)
    .map((ability) => ABILITY_LABELS[ability])
    .join(ABILITY_CHOICE_JOINER);
}
