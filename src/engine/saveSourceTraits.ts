/**
 * Чем вызван спасбросок: школа заклинания и типы его урона.
 *
 * «Совершает с помехой спасброски от заклинаний школы Прорицания», «помеха
 * при спасбросках против заклинания с уроном огнём или излучением» — условия
 * броска об источнике спасброска, рядом с `source.creatureType`:
 *
 * - `source.spellSchool === "divination"` — спасбросок вызвало заклинание
 *   этой школы (список через запятую);
 * - `source.damageType === "fire, radiant"` — то, что вызвало спасбросок,
 *   наносит урон одного из типов.
 *
 * Сведения собирает тот, кто накладывает ({@link describeSpellSaveSource}), и
 * они едут с целью спасброска и в нагрузке запроса — адресат считает тем же.
 * Модуль без зависимостей от конвейера: его читают и конвейер, и клиент.
 *
 * @module system/dnd/saveSourceTraits
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { CantripScalingTier } from './dndEntities.js';

import { splitQuotedList } from './conditionSyntax.js';
import { DAMAGE_TYPE_TOKEN_GLOBAL_REGEX } from './formulaTokens.js';

/** Приставка условия «спасбросок вызвало заклинание школы из списка» */
export const SOURCE_SPELL_SCHOOL_CONDITION_PREFIX = 'source.spellSchool === ';

/** Приставка условия «источник спасброска наносит урон типа из списка» */
export const SOURCE_DAMAGE_TYPE_CONDITION_PREFIX = 'source.damageType === ';

/** Сведения об источнике спасброска, кроме типа существа */
export interface SaveSourceTraits {
  /** Школа заклинания, вызвавшего спасбросок */
  sourceSpellSchool?: string;
  /** Типы урона того, что вызвало спасбросок */
  sourceDamageTypes?: string[];
}

/** То, что вызывает спасбросок: заклинание или псевдо-заклинание броска */
export interface SaveSourceSpell {
  school?: string;
  rollSource?: string;
  damageParts?: DamagePart[];
  cantripScalingTiers?: CantripScalingTier[];
  activeEffects?: ActiveEffect[];
}

/**
 * Типы урона частей: поле `type` и токены `@dmg.<тип>` формулы.
 *
 * @param parts - части урона
 * @returns ключи типов, возможно с повторами
 */
function listPartTypes(parts: readonly DamagePart[]): string[] {
  return parts.flatMap((part) => [
    ...(part.type ? [part.type] : []),
    ...[...part.formula.matchAll(DAMAGE_TYPE_TOKEN_GLOBAL_REGEX)].map((match) =>
      match[1].toLowerCase(),
    ),
  ]);
}

/**
 * Сведения об источнике спасброска по заклинанию: школа — только у настоящего
 * заклинания (у удара и действия существа школы нет), типы урона — у любого
 * броска, с уроном его эффектов и зон.
 *
 * @param spell - заклинание или псевдо-заклинание броска
 * @returns сведения; пустой объект, если назвать нечего
 */
export function describeSpellSaveSource(
  spell: SaveSourceSpell,
): SaveSourceTraits {
  const types = new Set([
    ...listPartTypes(spell.damageParts ?? []),
    ...(spell.cantripScalingTiers ?? []).flatMap((tier) =>
      listPartTypes(tier.parts),
    ),
    ...(spell.activeEffects ?? []).flatMap((effect) => [
      ...listPartTypes(effect.damageParts ?? []),
      ...listPartTypes(effect.recurringDamage?.damageParts ?? []),
    ]),
  ]);

  return {
    ...(spell.rollSource === undefined && spell.school
      ? { sourceSpellSchool: spell.school }
      : {}),
    ...(types.size > 0 ? { sourceDamageTypes: [...types] } : {}),
  };
}

/**
 * Известно ли об источнике спасброска что-нибудь, кроме типа существа.
 *
 * @param traits - сведения об источнике
 * @returns `true`, если названа школа или типы урона
 */
export function hasSaveSourceTraits(traits: SaveSourceTraits): boolean {
  return (
    traits.sourceSpellSchool !== undefined
    || (traits.sourceDamageTypes?.length ?? 0) > 0
  );
}

/**
 * Выполняется ли часть условия об источнике спасброска.
 *
 * @param part - часть условия
 * @param source - сведения об источнике из контекста броска
 * @param source.spellSchool - школа заклинания
 * @param source.damageTypes - типы урона
 * @returns итог; `undefined`, если часть не об источнике спасброска
 */
export function saveSourceConditionHolds(
  part: string,
  source: { spellSchool?: string; damageTypes?: readonly string[] } | undefined,
): boolean | undefined {
  if (part.startsWith(SOURCE_SPELL_SCHOOL_CONDITION_PREFIX)) {
    const schools = splitQuotedList(
      part.slice(SOURCE_SPELL_SCHOOL_CONDITION_PREFIX.length),
    );

    return (
      source?.spellSchool !== undefined
      && schools.includes(source.spellSchool.toLowerCase())
    );
  }

  if (part.startsWith(SOURCE_DAMAGE_TYPE_CONDITION_PREFIX)) {
    const types = splitQuotedList(
      part.slice(SOURCE_DAMAGE_TYPE_CONDITION_PREFIX.length),
    );

    return (source?.damageTypes ?? []).some((type) =>
      types.includes(type.toLowerCase()),
    );
  }

  return undefined;
}

/**
 * Подпись части условия об источнике спасброска.
 *
 * @param part - часть условия
 * @param describeSchool - название школы по ключу
 * @param describeType - название типа урона по ключу
 * @returns подпись; `undefined`, если часть не об источнике спасброска
 */
export function describeSaveSourceCondition(
  part: string,
  describeSchool: (key: string) => string,
  describeType: (key: string) => string,
): string | undefined {
  if (part.startsWith(SOURCE_SPELL_SCHOOL_CONDITION_PREFIX)) {
    const schools = splitQuotedList(
      part.slice(SOURCE_SPELL_SCHOOL_CONDITION_PREFIX.length),
    );

    return `спасбросок от заклинания школы: ${schools.map(describeSchool).join(', ')}`;
  }

  if (part.startsWith(SOURCE_DAMAGE_TYPE_CONDITION_PREFIX)) {
    const types = splitQuotedList(
      part.slice(SOURCE_DAMAGE_TYPE_CONDITION_PREFIX.length),
    );

    return `спасбросок от источника с уроном: ${types.map(describeType).join(', ')}`;
  }

  return undefined;
}
