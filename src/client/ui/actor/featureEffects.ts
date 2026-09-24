import type { Feature } from '@vtt/shared';
import type { ActiveEffect, DnDActor } from '@vtt/shared/system/dnd.js';

import type { AppliedFeatFeature } from './feat/featApply';

import { z } from 'zod';

import {
  isClassEffect,
  isToggleActivatedEffect,
  withActivationDefaults,
} from '@vtt/shared/system/dnd.js';

import {
  FEATURE_EFFECT_PREFIX,
  FEATURE_OPTION_SEPARATOR,
  FEATURE_SOURCE_SEPARATOR,
} from './constants';

/**
 * Эффект, который включает строка особенности, — «Ярость» на панели быстрого
 * доступа.
 *
 * Эффекты умений лежат в общем списке листа, и строка особенности находит свой
 * по ссылке `effectIds`: её кладут мастер класса и окно особенности. У листов, собранных до
 * ссылки, эффект ищется строго: эффект того же класса И с названием умения
 * (или «умение: вариант» — «Ярость диких земель: Медведь»), и только если
 * такой один. Совпадение одного названия без класса не годится: одноимённое
 * умение бывает у двух классов мультиклассера.
 */

/**
 * Ключ класса, давшего строку особенности: `grantedBy` начинается с названия
 * класса, у умения подкласса после него идёт разделитель и название подкласса.
 *
 * @param actor - персонаж
 * @param feature - строка особенности
 * @returns ключ класса либо `undefined`, если класс не найден
 */
function resolveFeatureClassKey(
  actor: DnDActor,
  feature: Feature,
): string | undefined {
  const { grantedBy } = feature;

  if (!grantedBy) {
    return undefined;
  }

  return actor.system.classes.find(
    (entry) =>
      grantedBy === entry.className
      || grantedBy.startsWith(`${entry.className}${FEATURE_SOURCE_SEPARATOR}`),
  )?.classKey;
}

/**
 * Назван ли эффект этим умением: «Ярость» или «Ярость диких земель: Медведь».
 *
 * @param effect - эффект листа
 * @param featureName - название умения
 * @returns `true`, если эффект носит имя умения
 */
function isNamedAfterFeature(
  effect: ActiveEffect,
  featureName: string,
): boolean {
  return (
    effect.name === featureName
    || effect.name.startsWith(`${featureName}${FEATURE_OPTION_SEPARATOR}`)
  );
}

/**
 * Ссылка особенности на эффекты — из сохранённого листа, поэтому проверяется:
 * испорченное поле считается отсутствующим, и эффект ищется запасным путём.
 */
const FeatureEffectIdsSchema = z.array(z.string());

/**
 * Проверенная ссылка особенности на свои эффекты.
 *
 * @param feature - строка особенности
 * @returns id эффектов либо `undefined`, если ссылки нет или она испорчена
 */
function readFeatureEffectIds(
  feature: AppliedFeatFeature,
): string[] | undefined {
  const parsed = FeatureEffectIdsSchema.safeParse(feature.effectIds);

  return parsed.success ? parsed.data : undefined;
}

/**
 * Эффекты листа, которые дала строка особенности, — их показывает вкладка
 * «Эффекты» окна описания.
 *
 * @param actor - персонаж
 * @param feature - строка особенности
 * @returns эффекты особенности; пусто — эффектов нет или связь не найдена
 */
export function listFeatureEffects(
  actor: DnDActor,
  feature: AppliedFeatFeature,
): ActiveEffect[] {
  const effects = actor.activeEffects ?? [];
  const linkedIds = readFeatureEffectIds(feature);

  if (linkedIds) {
    const linked = new Set(linkedIds);

    return effects.filter((effect) => linked.has(effect.id));
  }

  if (feature.featureType !== 'class' && feature.featureType !== 'subclass') {
    return [];
  }

  const classKey = resolveFeatureClassKey(actor, feature);

  if (!classKey) {
    return [];
  }

  return effects.filter(
    (effect) =>
      isClassEffect(effect, classKey)
      && isNamedAfterFeature(effect, feature.name),
  );
}

/**
 * Включаемый эффект строки особенности — только если такой один: какой из
 * двух включать кнопкой, угадывать нельзя.
 *
 * @param actor - персонаж
 * @param feature - строка особенности
 * @returns эффект с переключателем либо `undefined`, если его нет или он не
 *   определяется однозначно
 */
export function findFeatureToggleEffect(
  actor: DnDActor,
  feature: AppliedFeatFeature,
): ActiveEffect | undefined {
  const toggles = listFeatureEffects(actor, feature).filter(
    isToggleActivatedEffect,
  );

  return toggles.length === 1 ? toggles[0] : undefined;
}

/** Эффекты листа и ссылка особенности на свои эффекты после правки */
export interface FeatureEffectsPlacement {
  /** Эффекты листа целиком */
  activeEffects: ActiveEffect[];
  /** Id эффектов особенности на листе — поле `effectIds` её записи */
  effectIds: string[];
}

/**
 * Записывает эффекты, поправленные в окне особенности, прямо в эффекты листа.
 *
 * Эффект особенности — один объект: он живёт в эффектах листа, а особенность
 * хранит только ссылку на него. Поэтому правка в окне особенности видна на
 * вкладке «Эффекты», и наоборот. Эффект с прежним id заменяется на своём
 * месте, убранный из окна уходит с листа, новый ложится в конец с меткой
 * особенности в id; новый переключаемый — выключенным.
 *
 * @param actorEffects - эффекты листа
 * @param previousIds - id эффектов особенности на листе до правки
 * @param featureId - особенность
 * @param edited - эффекты из окна особенности; пусто — снять все
 * @returns эффекты листа и новая ссылка особенности
 */
export function saveFeatureEffects(
  actorEffects: readonly ActiveEffect[],
  previousIds: readonly string[],
  featureId: string,
  edited: readonly ActiveEffect[],
): FeatureEffectsPlacement {
  const previous = new Set(previousIds);
  const editedById = new Map(edited.map((effect) => [effect.id, effect]));

  const kept = actorEffects.flatMap((effect) => {
    if (!previous.has(effect.id)) {
      return [effect];
    }

    const replacement = editedById.get(effect.id);

    return replacement ? [replacement] : [];
  });

  const added = edited
    .filter((effect) => !previous.has(effect.id))
    .map((effect) => ({
      ...withActivationDefaults(effect),
      id: `${FEATURE_EFFECT_PREFIX}${featureId}:${effect.id}`,
      origin: 'feature' as const,
      originId: featureId,
    }));

  const keptIds = edited
    .filter((effect) => previous.has(effect.id))
    .map((effect) => effect.id);

  return {
    activeEffects: [...kept, ...added],
    effectIds: [...keptIds, ...added.map((effect) => effect.id)],
  };
}
