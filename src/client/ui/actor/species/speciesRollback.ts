/**
 * Откат вида с листа персонажа: снятие всего, что вид выдал (владения,
 * особенности, выданные заклинания, эффект защит, тёмное зрение).
 *
 * Живёт отдельно от мастера настройки, потому что нужен ДВАЖДЫ: мастер
 * откатывает прежний вид перед применением нового, а лист — при удалении вида
 * без замены. Раньше эта логика была вшита внутрь `buildUpdates` мастера и
 * второму сценарию была недоступна.
 *
 * @module ui/actor/species/speciesRollback
 */

import type { Feature } from '@vtt/shared';
import type {
  ActiveEffect,
  ActorSpeciesEntry,
  DnDActor,
  DnDProficiencies,
  SpeciesDefinition,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { removeItems } from '@vtt/shared';
import {
  computeSpeciesDarkvision,
  CREATURE_SIZE_TO_TOKEN_SCALE,
  DEFAULT_ACTOR,
  getTotalLevel,
  isSkillType,
  removeGrantedSpellsByFeatureNames,
} from '@vtt/shared/system/dnd.js';

/**
 * Префикс стабильного id активного эффекта-защит, выданного видом. По нему
 * эффект прежнего вида снимается при смене/удалении вида, не задевая эффекты
 * из других источников (предметы/заклинания/состояния).
 */
export const SPECIES_DEFENSE_EFFECT_PREFIX = 'species-defenses:';

/**
 * Прежний префикс того же эффекта, когда вид давал только сопротивления. Снимаем
 * и его — в мирах, где он успел примениться, эффект иначе остался бы навсегда.
 */
export const SPECIES_LEGACY_RESISTANCE_EFFECT_PREFIX = 'species-resistance:';

/**
 * Проверяет, принадлежит ли эффект защитам, выданным видом (текущий или старый
 * префикс id).
 *
 * @param effect - активный эффект актёра
 */
export function isSpeciesDefenseEffect(effect: ActiveEffect): boolean {
  return (
    effect.id.startsWith(SPECIES_DEFENSE_EFFECT_PREFIX)
    || effect.id.startsWith(SPECIES_LEGACY_RESISTANCE_EFFECT_PREFIX)
  );
}

/**
 * Снимает владения, выданные прежним видом: и фиксированные позиции гранта, и
 * то, что игрок выбрал сам (`grantChoices` записи вида).
 *
 * Возвращает НОВЫЙ объект владений — исходный не меняется.
 *
 * @param proficiencies - текущие владения актёра
 * @param previousSpecies - запись прежнего вида на листе
 * @param previousSpeciesDef - определение прежнего вида (нужно ради
 * фиксированных позиций гранта; без него откатить нечего)
 */
export function rollbackSpeciesProficiencies(
  proficiencies: DnDProficiencies,
  previousSpecies: ActorSpeciesEntry | null | undefined,
  previousSpeciesDef: SpeciesDefinition | null | undefined,
): DnDProficiencies {
  const skills = { ...proficiencies.skills };
  const weapons = [...proficiencies.weapons];
  const armor = [...proficiencies.armor];
  const tools = [...proficiencies.tools];
  const languages = [...proficiencies.languages];
  const savingThrows = [...proficiencies.savingThrows];

  if (previousSpecies && previousSpeciesDef) {
    previousSpeciesDef.grants.forEach((grant, grantIndex) => {
      const previousUserChoices =
        previousSpecies.grantChoices[grantIndex] || [];

      if (grant.type === 'skillProficiency') {
        for (const choice of previousUserChoices) {
          if (isSkillType(choice)) {
            Reflect.deleteProperty(skills, choice);
          }
        }
      } else if (grant.type === 'weaponProficiency') {
        removeItems(weapons, grant.items ?? []);
        removeItems(weapons, previousUserChoices);
      } else if (grant.type === 'armorProficiency') {
        removeItems(armor, grant.items ?? []);
        removeItems(armor, previousUserChoices);
      } else if (grant.type === 'toolProficiency') {
        removeItems(tools, grant.items ?? []);
        removeItems(tools, previousUserChoices);
      } else if (grant.type === 'language') {
        removeItems(languages, grant.items ?? []);
        removeItems(languages, previousUserChoices);
      } else if (grant.type === 'savingThrowProficiency') {
        removeItems(savingThrows, grant.abilities);
      }
    });
  }

  return {
    ...proficiencies,
    skills,
    weapons,
    armor,
    tools,
    languages,
    savingThrows,
  };
}

/**
 * Собирает названия всех особенностей вида — своих и особенностей подвидов.
 * По этим именам ищутся заклинания, выданные видом (`grantedBy` заклинания).
 *
 * Подвиды берём ВСЕ, а не только выбранный: при откате важно снять всё, что
 * могло быть выдано, а имена особенностей внутри одного вида уникальны.
 *
 * @param definition - определение вида
 */
export function collectSpeciesFeatureNames(
  definition: SpeciesDefinition,
): string[] {
  const names: string[] = [];

  for (const feature of definition.features) {
    names.push(feature.name);

    for (const choice of feature.choices ?? []) {
      for (const choiceFeature of choice.features ?? []) {
        names.push(choiceFeature.name);
      }
    }
  }

  return names;
}

/**
 * Убирает с листа особенности, выданные видом.
 *
 * @param features - особенности актёра
 */
export function rollbackSpeciesFeatures(
  features: ReadonlyArray<Feature>,
): Feature[] {
  return features.filter((feature) => feature.featureType !== 'species');
}

/**
 * Убирает заклинания, выданные особенностями прежнего вида.
 *
 * @param spells - заклинания актёра
 * @param previousSpeciesDef - определение прежнего вида
 */
export function rollbackSpeciesGrantedSpells(
  spells: ReadonlyArray<Spell>,
  previousSpeciesDef: SpeciesDefinition | null | undefined,
): Spell[] {
  if (!previousSpeciesDef) {
    return [...spells];
  }

  return removeGrantedSpellsByFeatureNames(
    [...spells],
    collectSpeciesFeatureNames(previousSpeciesDef),
  );
}

/**
 * Собирает настройки токена без вклада вида: масштаб возвращается к базовому
 * размеру, тёмное зрение обнуляется ТОЛЬКО если оно совпадает с вкладом
 * снимаемого вида — иначе затёрли бы значение из другого источника
 * (класс/предмет/ручная правка). Полного учёта источников нет (нет
 * провенанса) — то же известное ограничение, что и при замене вида.
 *
 * @param actor - актёр, с которого снимается вид
 * @param previousSpeciesDef - определение снимаемого вида
 * @returns новые настройки токена — исходные не меняются
 */
function buildTokenWithoutSpecies(
  actor: DnDActor,
  previousSpeciesDef: SpeciesDefinition | null | undefined,
): DnDActor['token'] {
  const token = actor.token ?? {};
  const scale = CREATURE_SIZE_TO_TOKEN_SCALE[DEFAULT_ACTOR.system.size];
  const previousSpecies = actor.system.species;
  const vision = token.vision;

  if (!previousSpecies || !previousSpeciesDef || !vision) {
    return { ...token, scale };
  }

  const previousDarkvision = computeSpeciesDarkvision(
    previousSpeciesDef,
    getTotalLevel(actor.system.classes),
    Object.values(previousSpecies.featureChoices),
  );

  if (vision.darkvision !== previousDarkvision) {
    return { ...token, scale };
  }

  return { ...token, scale, vision: { ...vision, darkvision: 0 } };
}

/**
 * Собирает обновления актёра для ПОЛНОГО удаления вида: персонаж остаётся
 * вовсе без вида, все его дары сняты.
 *
 * Стартовое снаряжение и прочие разовые дары не изымаются — их не изымает и
 * замена вида; предмет, попавший в инвентарь, считается принадлежащим игроку.
 *
 * @param actor - актёр, с которого снимается вид
 * @param previousSpeciesDef - определение снимаемого вида. Без него владения
 * откатить нечем (определение могло исчезнуть вместе с паком компендиума) —
 * снимаем всё остальное, а владения остаются на листе
 */
export function buildSpeciesRemovalUpdates(
  actor: DnDActor,
  previousSpeciesDef: SpeciesDefinition | null | undefined,
): {
  systemUpdates: Partial<DnDActor['system']>;
  rootUpdates: Partial<DnDActor>;
} {
  const previousSpecies = actor.system.species;

  const systemUpdates: Partial<DnDActor['system']> = {
    species: null,
    size: DEFAULT_ACTOR.system.size,
    movement: { ...DEFAULT_ACTOR.system.movement },
    proficiencies: rollbackSpeciesProficiencies(
      actor.system.proficiencies,
      previousSpecies,
      previousSpeciesDef,
    ),
  };

  const rootUpdates: Partial<DnDActor> = {
    token: buildTokenWithoutSpecies(actor, previousSpeciesDef),
    features: rollbackSpeciesFeatures(actor.features),
    activeEffects: actor.activeEffects.filter(
      (effect) => !isSpeciesDefenseEffect(effect),
    ),
    spells: rollbackSpeciesGrantedSpells(actor.spells, previousSpeciesDef),
  };

  return { systemUpdates, rootUpdates };
}
