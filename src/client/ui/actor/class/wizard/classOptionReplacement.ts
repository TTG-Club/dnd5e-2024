/**
 * Снятие с листа варианта умения, который игрок заменил при повышении уровня:
 * воззвание колдуна, манёвр, метамагия.
 *
 * Вариант кладётся на лист своей записью («Таинственные воззвания: Доспех
 * теней»), а вместе с ней — эффектами, заклинаниями, владениями и ресурсами.
 * Заменённый вариант больше ничего не даёт, поэтому уходит всё это разом, а
 * ответы на его вопросы — вместе с записью: они лежат на ней же.
 *
 * Снимается вариант ДО того, как мастер положит на лист уровень: владение,
 * которое дают и старый вариант, и новый, иначе пропало бы при откате.
 *
 * @module ui/actor/class/wizard/classOptionReplacement
 */

import type {
  ActiveEffect,
  ActorProficiencies,
  ClassFeatureChoice,
  DnDActor,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { AppliedFeatFeature } from '../../feat/featApply';

import {
  buildClassEffectId,
  cloneActorProficiencies,
  collectClassOptionGrants,
  refreshFeatCounters,
  removeFeatChoiceSelections,
  removeFeatDataProficiencies,
  removeGrantedSpellsByFeatureNames,
} from '@vtt/shared/system/dnd.js';

import { listFeatureEffectIds } from '../classEffects';

/** Заменённый вариант: где его искать на листе и что он туда положил */
export interface ReplacedClassOption {
  /** Ключ класса — провенанс эффектов варианта */
  classKey: string;
  /** Ключ умения, чей это вариант */
  featureKey: string;
  /** Сам вариант из записи класса */
  option: ClassFeatureChoice;
  /** Название записи варианта на листе («Умение: Вариант») */
  recordName: string;
  /** Источник записи на листе (`grantedBy`) */
  grantedBy: string;
}

/** Лист без заменённого варианта и запись, которая с него ушла */
export interface ClassOptionRemoval {
  features: DnDActor['features'];
  activeEffects: ActiveEffect[];
  spells: Spell[];
  proficiencies: ActorProficiencies;
  classCounters: NonNullable<DnDActor['system']['classCounters']>;
  /**
   * Снятая запись варианта; `undefined` — на листе её не нашлось (запись
   * переименовали или удалили руками), и снято то, что вариант даёт по записи
   * класса.
   */
  removedRecord: AppliedFeatFeature | undefined;
}

/**
 * Id эффектов, которые вариант поставил на лист: его собственные эффекты и
 * синтетический эффект его даров. Только они — запись варианта, взятого на
 * уровне умения, ссылается ещё и на эффекты самого умения, а те остаются.
 *
 * @param replaced - заменённый вариант
 * @returns id эффектов варианта на листе
 */
function listOptionEffectIds(replaced: ReplacedClassOption): Set<string> {
  const grant = {
    featureKey: replaced.featureKey,
    optionKey: replaced.option.key,
  };

  return new Set([
    ...listFeatureEffectIds(
      replaced.classKey,
      replaced.option.activeEffects,
      grant,
    ),
    // Тот же ключ, под которым мастер ставит эффект даров варианта
    buildClassEffectId(
      replaced.classKey,
      `grant:${grant.featureKey}:${grant.optionKey}`,
    ),
  ]);
}

/**
 * Снимает с листа заменённый вариант умения со всем, что он выдал: записью,
 * эффектами, заклинаниями, владениями и ресурсами.
 *
 * Тёмное зрение не понижается — у него мог быть и другой источник, как и при
 * снятии черты.
 *
 * @param actor - лист персонажа до уровня
 * @param replaced - заменённый вариант
 * @returns лист без варианта; исходный лист не меняется
 */
export function removeReplacedClassOption(
  actor: DnDActor,
  replaced: ReplacedClassOption,
): ClassOptionRemoval {
  const removedRecord: AppliedFeatFeature | undefined = actor.features.find(
    (feature) =>
      feature.name === replaced.recordName
      && feature.grantedBy === replaced.grantedBy,
  );

  const features = removedRecord
    ? actor.features.filter((feature) => feature.id !== removedRecord.id)
    : actor.features;

  const effectIds = listOptionEffectIds(replaced);

  const activeEffects = (actor.activeEffects ?? []).filter(
    (effect) => !effectIds.has(effect.id),
  );

  // Заклинания варианта подписаны его названием — так их выдаёт мастер; запись
  // целиком — на случай заклинаний, выданных по ней листом
  const spells = removeGrantedSpellsByFeatureNames(actor.spells ?? [], [
    replaced.option.name,
    replaced.recordName,
  ]);

  // Дары берутся с записи: на ней и ключи вопросов в области варианта, и ответы
  // игрока. Без записи — дары варианта из записи класса, ответов тогда нет
  const featData =
    removedRecord?.featData
    ?? collectClassOptionGrants(
      { key: replaced.featureKey, choices: [replaced.option] },
      [replaced.option.key],
    )[0]?.featData;

  const proficiencies = cloneActorProficiencies(actor.system.proficiencies);

  removeFeatDataProficiencies(proficiencies, featData);
  removeFeatChoiceSelections(proficiencies, featData, removedRecord?.choices);

  // Ресурс варианта живёт на его записи: пересборка от оставшихся записей
  // забирает всё, чему больше нечем владеть
  const classCounters = refreshFeatCounters(
    { ...actor, features },
    actor.system.classCounters ?? [],
  );

  return {
    features,
    activeEffects,
    spells,
    proficiencies,
    classCounters,
    removedRecord,
  };
}
