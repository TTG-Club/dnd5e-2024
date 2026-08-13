/**
 * Чувства персонажа сверх тёмного зрения: слепое зрение, истинное зрение,
 * чувство вибрации, телепатия.
 *
 * Считаются НА ЛЕТУ по применённым чертам, а не хранятся на акторе: так они не
 * расходятся с набором черт и не требуют отката при удалении черты — ровно как
 * тёмное зрение вида в `speciesGrants.ts`.
 *
 * **Это справка, а не механика.** Зрение токена в контракте приложения знает
 * только тёмное зрение (`Token.vision.darkvision`), поэтому на видимость в
 * темноте и на подсветку сцены эти чувства не влияют — они показываются в шапке
 * листа, чтобы игрок и мастер о них помнили. См. README, § «Чего не хватает для
 * полноценного SDK», п. 12.
 *
 * @module system/dnd/actorSenses
 */

import type { Feature } from '@vtt/shared';

import type { DnDActor } from './dndEntities.js';
import type { FeatData, FeatSenseKind } from './featTypes.js';

/** Чувство персонажа с итоговой дистанцией. */
export interface ActorSense {
  type: FeatSenseKind;
  /** Дистанция в футах */
  range: number;
}

/** Русские названия чувств — те же, что в справочнике TTG Club. */
export const SENSE_LABELS: Record<FeatSenseKind, string> = {
  blindsight: 'Слепое зрение',
  truesight: 'Истинное зрение',
  tremorsense: 'Чувство вибрации',
};

/** Иконки чувств для бейджей шапки листа. */
export const SENSE_ICONS: Record<FeatSenseKind, string> = {
  blindsight: 'tabler:eye-off',
  truesight: 'tabler:eye-star',
  tremorsense: 'tabler:waves-electricity',
};

/** Порядок показа чувств — от самого частого к редкому. */
const SENSE_ORDER: FeatSenseKind[] = ['blindsight', 'truesight', 'tremorsense'];

/**
 * «Дары»-блоб особенности листа.
 *
 * Базовый `Feature` о `featData` не знает — блоб добавляет система, — поэтому
 * особенность читается через тип с одним необязательным полем: он совместим с
 * любой особенностью и не требует приведения.
 */
interface FeatureWithGrants extends Feature {
  featData?: FeatData;
}

/** Блобы даров всех особенностей листа. */
function featureGrants(actor: DnDActor): FeatData[] {
  const features: FeatureWithGrants[] = actor.features ?? [];

  return features
    .map((feature) => feature.featData)
    .filter((featData): featData is FeatData => Boolean(featData));
}

/**
 * Чувства персонажа: по каждому виду берётся НАИБОЛЬШАЯ дистанция из всех
 * источников — два источника одного чувства не складываются, как и у тёмного
 * зрения.
 *
 * @param actor - лист персонажа
 * @returns чувства в порядке показа; пусто — ни одного нет
 */
export function collectActorSenses(actor: DnDActor): ActorSense[] {
  const ranges = new Map<FeatSenseKind, number>();

  for (const featData of featureGrants(actor)) {
    for (const sense of featData.modifiers?.senses ?? []) {
      if (!sense.range || sense.range <= 0) {
        continue;
      }

      const current = ranges.get(sense.type) ?? 0;

      if (sense.range > current) {
        ranges.set(sense.type, sense.range);
      }
    }
  }

  return SENSE_ORDER.filter((type) => ranges.has(type)).map((type) => ({
    type,
    range: ranges.get(type) ?? 0,
  }));
}

/**
 * Дальность телепатии персонажа — наибольшая из выданных чертами.
 *
 * @param actor - лист персонажа
 * @returns дистанция в футах; `0` — телепатии нет
 */
export function collectActorTelepathy(actor: DnDActor): number {
  let range = 0;

  for (const featData of featureGrants(actor)) {
    const granted = featData.modifiers?.telepathyRange ?? 0;

    if (granted > range) {
      range = granted;
    }
  }

  return range;
}
