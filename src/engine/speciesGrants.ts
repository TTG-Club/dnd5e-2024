import type { MovementType } from '@vtt/shared';

import type { GrantedSpellSource } from './grantedSpells.js';
import type { SpeciesDefinition, SpeciesFeature } from './speciesTypes.js';

/**
 * Хелперы расчёта уровне-зависимых даров вида.
 *
 * Особенности вида могут появляться на разных уровнях персонажа и быть
 * привязаны к выбранному подвиду. Подвид задаётся двумя способами (дуал-рид):
 * легаси-вариантами внутри особенностей (`chosenSubspecies` — ключи выбранных
 * `SpeciesFeature.choices`) либо самостоятельной записью-подвидом с `parentKey`
 * (`subspecies`). Эти чистые функции используются и мастером настройки вида
 * (применение при добавлении), и листом актёра (пересчёт скорости/тёмного
 * зрения при повышении уровня).
 */

/** Оси скорости движения, которыми оперируют дары вида. */
const MOVEMENT_AXES: ReadonlyArray<
  Extract<MovementType, keyof SpeciesDefinition['speed']>
> = ['walk', 'fly', 'swim', 'climb', 'burrow'];

/**
 * Собирает плоский список особенностей вида с учётом выбранного подвида:
 * базовые особенности вида, особенности выбранных легаси-вариантов и
 * особенности записи-подвида. Уровень НЕ фильтруется — это делает вызывающий
 * код (для применения хранит все, для показа фильтрует по достижению уровня).
 *
 * @param definition - определение вида
 * @param chosenSubspecies - выбранные ключи легаси-вариантов
 * @param subspecies - выбранная запись-подвид; пусто — не выбрана
 * @returns базовые особенности + особенности выбранного подвида
 */
export function collectSpeciesFeatures(
  definition: SpeciesDefinition,
  chosenSubspecies: ReadonlyArray<string>,
  subspecies?: SpeciesDefinition | null,
): SpeciesFeature[] {
  const features: SpeciesFeature[] = [];

  for (const feature of definition.features) {
    features.push(feature);

    for (const choice of feature.choices ?? []) {
      if (!chosenSubspecies.includes(choice.key)) {
        continue;
      }

      for (const subspeciesFeature of choice.features ?? []) {
        features.push(subspeciesFeature);
      }
    }
  }

  for (const feature of subspecies?.features ?? []) {
    features.push(feature);
  }

  return features;
}

/**
 * Активна ли особенность на текущем уровне персонажа.
 *
 * @param feature - особенность вида
 * @param totalLevel - суммарный уровень персонажа
 * @returns true, если особенность уже получена по уровню
 */
export function isSpeciesFeatureActive(
  feature: SpeciesFeature,
  totalLevel: number,
): boolean {
  return (feature.level ?? 1) <= totalLevel;
}

/**
 * Считает итоговую скорость движения вида: базовая скорость плюс «не ниже»
 * прибавки от записи-подвида и от активных на текущем уровне особенностей.
 *
 * Скорости из `featData.modifiers` сюда не входят: их применяет синтетический
 * эффект даров (`buildFeatGrantEffect`), живущий на акторе своей записью.
 *
 * @param definition - определение вида
 * @param totalLevel - суммарный уровень персонажа
 * @param chosenSubspecies - выбранные ключи легаси-вариантов
 * @param subspecies - выбранная запись-подвид; пусто — не выбрана
 * @returns скорость по осям walk/fly/swim/climb/burrow
 */
export function computeSpeciesMovement(
  definition: SpeciesDefinition,
  totalLevel: number,
  chosenSubspecies: ReadonlyArray<string>,
  subspecies?: SpeciesDefinition | null,
): Record<(typeof MOVEMENT_AXES)[number], number> {
  const movement: Record<(typeof MOVEMENT_AXES)[number], number> = {
    walk: definition.speed.walk,
    fly: definition.speed.fly ?? 0,
    swim: definition.speed.swim ?? 0,
    climb: definition.speed.climb ?? 0,
    burrow: definition.speed.burrow ?? 0,
  };

  if (subspecies) {
    for (const axis of MOVEMENT_AXES) {
      const value = subspecies.speed[axis];

      if (typeof value === 'number' && value > movement[axis]) {
        movement[axis] = value;
      }
    }
  }

  const features = collectSpeciesFeatures(
    definition,
    chosenSubspecies,
    subspecies,
  );

  for (const feature of features) {
    if (!feature.movement || feature.isInformationalOnly) {
      continue;
    }

    if (!isSpeciesFeatureActive(feature, totalLevel)) {
      continue;
    }

    for (const axis of MOVEMENT_AXES) {
      const value = feature.movement[axis];

      if (typeof value === 'number' && value > movement[axis]) {
        movement[axis] = value;
      }
    }
  }

  return movement;
}

/**
 * Считает дальность тёмного зрения вида: максимум из легаси-даров `darkvision`,
 * блоков `featData` (записи, подвида и активных особенностей) и активных на
 * текущем уровне особенностей с полем `darkvision`.
 *
 * @param definition - определение вида
 * @param totalLevel - суммарный уровень персонажа
 * @param chosenSubspecies - выбранные ключи легаси-вариантов
 * @param subspecies - выбранная запись-подвид; пусто — не выбрана
 * @returns дальность тёмного зрения в футах (0, если нет)
 */
export function computeSpeciesDarkvision(
  definition: SpeciesDefinition,
  totalLevel: number,
  chosenSubspecies: ReadonlyArray<string>,
  subspecies?: SpeciesDefinition | null,
): number {
  let darkvision = 0;

  const raise = (value: number | undefined): void => {
    if (typeof value === 'number' && value > darkvision) {
      darkvision = value;
    }
  };

  for (const record of subspecies ? [definition, subspecies] : [definition]) {
    for (const grant of record.grants) {
      if (grant.type === 'darkvision') {
        raise(grant.range);
      }
    }

    raise(record.featData?.darkvision);
  }

  const features = collectSpeciesFeatures(
    definition,
    chosenSubspecies,
    subspecies,
  );

  for (const feature of features) {
    if (feature.isInformationalOnly) {
      continue;
    }

    if (!isSpeciesFeatureActive(feature, totalLevel)) {
      continue;
    }

    raise(feature.darkvision);
    raise(feature.featData?.darkvision);
  }

  return darkvision;
}

/**
 * Собирает связи «заклинание компендиума → особенность-источник» из вида —
 * включая особенности легаси-вариантов и записи-подвида. Берёт только
 * связанные с компендиумом (`spellId`) заклинания; дедуп по `spellId`.
 * Используется резолвером granted-заклинаний для подгрузки данных из
 * компендиума.
 *
 * @param definition - определение вида
 * @param subspecies - выбранная запись-подвид; пусто — не выбрана
 * @returns источники granted-заклинаний (только со `spellId`)
 */
export function collectSpeciesGrantedSpellSources(
  definition: SpeciesDefinition,
  subspecies?: SpeciesDefinition | null,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();

  const addFromFeature = (feature: SpeciesFeature): void => {
    if (feature.isInformationalOnly) {
      return;
    }

    for (const ref of feature.grantedSpells ?? []) {
      if (!ref.spellId || seenSpellIds.has(ref.spellId)) {
        continue;
      }

      seenSpellIds.add(ref.spellId);

      sources.push({
        spellId: ref.spellId,
        featureName: feature.name,
        packId: ref.packId,
      });
    }
  };

  for (const feature of definition.features) {
    addFromFeature(feature);

    for (const choice of feature.choices ?? []) {
      for (const choiceFeature of choice.features ?? []) {
        addFromFeature(choiceFeature);
      }
    }
  }

  for (const feature of subspecies?.features ?? []) {
    addFromFeature(feature);
  }

  return sources;
}
