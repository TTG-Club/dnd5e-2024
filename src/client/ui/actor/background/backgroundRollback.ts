/**
 * Откат предыстории с листа персонажа: снятие всего, что она выдала (бонусы
 * характеристик, владения, черта-происхождение и её эффекты, выданные
 * заклинания, тёмное зрение).
 *
 * Живёт отдельно от мастера настройки, потому что нужен ДВАЖДЫ: мастер
 * откатывает прежнюю предысторию перед применением новой, а лист — при её
 * удалении без замены. Раньше эта логика была вшита внутрь `buildUpdates`
 * мастера и второму сценарию была недоступна.
 *
 * В отличие от вида, определение предыстории тут не нужно: всё применённое
 * записано в саму запись листа (`ActorBackgroundEntry`) — ровно ради точного
 * отката.
 *
 * @module ui/actor/background/backgroundRollback
 */

import type { Feature } from '@vtt/shared';
import type {
  ActiveEffect,
  ActorBackgroundEntry,
  DnDActor,
  DnDProficiencies,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { removeItems } from '@vtt/shared';
import {
  BACKGROUND_ORIGIN_PREFIX,
  isFeatOwnedEffect,
  removeGrantedSpellsByFeatureNames,
} from '@vtt/shared/system/dnd.js';

/**
 * Снимает владения, выданные прежней предысторией: канонические навыки и
 * инструменты плюс расширенные дары её `featData`.
 *
 * Возвращает НОВЫЙ объект владений — исходный не меняется.
 *
 * @param proficiencies - текущие владения актёра
 * @param previousBackground - запись прежней предыстории на листе
 */
export function rollbackBackgroundProficiencies(
  proficiencies: DnDProficiencies,
  previousBackground: ActorBackgroundEntry | null | undefined,
): DnDProficiencies {
  const skills = { ...proficiencies.skills };
  const tools = [...proficiencies.tools];
  const savingThrows = [...proficiencies.savingThrows];
  const armor = [...proficiencies.armor];
  const weapons = [...proficiencies.weapons];
  const languages = [...proficiencies.languages];

  if (previousBackground) {
    // Навыки: канонические + расширенные (из featData)
    for (const skill of previousBackground.skillChoices) {
      Reflect.deleteProperty(skills, skill);
    }

    for (const skill of previousBackground.extraSkillProficiencies ?? []) {
      Reflect.deleteProperty(skills, skill);
    }

    // Инструменты: канонические + расширенные
    removeItems(tools, previousBackground.toolChoices);
    removeItems(tools, previousBackground.extraToolProficiencies ?? []);

    // Расширенные владения (из featData)
    removeItems(
      savingThrows,
      previousBackground.savingThrowProficiencies ?? [],
    );

    removeItems(armor, previousBackground.armorProficiencies ?? []);
    removeItems(weapons, previousBackground.weaponProficiencies ?? []);
    removeItems(languages, previousBackground.languages ?? []);
  }

  return {
    ...proficiencies,
    skills,
    tools,
    savingThrows,
    armor,
    weapons,
    languages,
  };
}

/**
 * Снимает эффекты предыстории: всё с провенансом `background:` (там и бонус
 * характеристик, и синтетический эффект даров, и перенесённые) плюс эффекты
 * выданной ею черты — те помечены провенансом самой черты (`feat:<id>`) и под
 * оптовый фильтр не попадают.
 *
 * @param effects - активные эффекты актёра
 * @param previousBackground - запись прежней предыстории на листе
 */
export function rollbackBackgroundEffects(
  effects: ReadonlyArray<ActiveEffect>,
  previousBackground: ActorBackgroundEntry | null | undefined,
): ActiveEffect[] {
  const grantedFeatId = previousBackground?.grantedFeatId;

  return effects.filter((effect) => {
    if (effect.originId?.startsWith(BACKGROUND_ORIGIN_PREFIX)) {
      return false;
    }

    return !(grantedFeatId && isFeatOwnedEffect(effect, grantedFeatId));
  });
}

/**
 * Убирает с листа черту-происхождение, выданную прежней предысторией.
 *
 * @param features - особенности актёра
 * @param previousBackground - запись прежней предыстории на листе
 */
export function rollbackBackgroundFeatures(
  features: ReadonlyArray<Feature>,
  previousBackground: ActorBackgroundEntry | null | undefined,
): Feature[] {
  const grantedFeatId = previousBackground?.grantedFeatId;

  if (!grantedFeatId) {
    return [...features];
  }

  return features.filter((feature) => feature.id !== grantedFeatId);
}

/**
 * Убирает заклинания, выданные прежней предысторией: и её чертой-происхождением,
 * и её собственным `featData`.
 *
 * @param spells - заклинания актёра
 * @param previousBackground - запись прежней предыстории на листе
 */
export function rollbackBackgroundGrantedSpells(
  spells: ReadonlyArray<Spell>,
  previousBackground: ActorBackgroundEntry | null | undefined,
): Spell[] {
  const sources: string[] = [];

  if (previousBackground?.grantedFeatName) {
    sources.push(previousBackground.grantedFeatName);
  }

  if (previousBackground?.ownGrantedSpellSource) {
    sources.push(previousBackground.ownGrantedSpellSource);
  }

  if (sources.length === 0) {
    return [...spells];
  }

  return removeGrantedSpellsByFeatureNames([...spells], sources);
}

/**
 * Собирает обновления актёра для ПОЛНОГО удаления предыстории: персонаж
 * остаётся вовсе без предыстории, все её дары сняты.
 *
 * Стартовое снаряжение не изымается — его не изымает и замена предыстории;
 * предмет, попавший в инвентарь, считается принадлежащим игроку.
 *
 * @param actor - актёр, с которого снимается предыстория
 */
export function buildBackgroundRemovalUpdates(actor: DnDActor): {
  systemUpdates: Partial<DnDActor['system']>;
  rootUpdates: Partial<DnDActor>;
} {
  const previousBackground = actor.system.background;

  const systemUpdates: Partial<DnDActor['system']> = {
    background: null,
    proficiencies: rollbackBackgroundProficiencies(
      actor.system.proficiencies,
      previousBackground,
    ),
  };

  const rootUpdates: Partial<DnDActor> = {
    features: rollbackBackgroundFeatures(actor.features, previousBackground),
    activeEffects: rollbackBackgroundEffects(
      actor.activeEffects,
      previousBackground,
    ),
    spells: rollbackBackgroundGrantedSpells(actor.spells, previousBackground),
  };

  // Тёмное зрение снимаем, только если оно ровно то, что подняла предыстория:
  // у него мог появиться другой источник (вид/класс/предмет), и обнулять его
  // мы не вправе. Запись `darkvisionApplied` заведена ровно для этой сверки.
  const appliedDarkvision = previousBackground?.darkvisionApplied ?? 0;

  if (appliedDarkvision > 0 && actor.token?.vision) {
    const token: NonNullable<DnDActor['token']> = JSON.parse(
      JSON.stringify(actor.token),
    );

    if (token.vision && token.vision.darkvision === appliedDarkvision) {
      token.vision.darkvision = 0;
      rootUpdates.token = token;
    }
  }

  return { systemUpdates, rootUpdates };
}
