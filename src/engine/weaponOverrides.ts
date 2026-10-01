/**
 * Замены свойств оружия от эффектов: кость урона, характеристика атаки и тип
 * урона («Дубинка» — дубинка и боевой посох бьют к8 заклинательной
 * характеристикой).
 *
 * Конвейер складывает строки `weapon.*` в `ResolvedActorStats.weaponOverrides`,
 * не зная, о каком оружии речь. Здесь каждое оружие выбирает свои: по виду из
 * условия `weapon.baseType` и по предмету, на котором лежит эффект.
 *
 * @module system/dnd/weaponOverrides
 */

import type {
  AbilityType,
  DamagePart,
  DefensibleDamageType,
} from '@vtt/shared';

import type {
  EffectChange,
  ResolvedActorStats,
  WeaponOverrideEntry,
} from './activeEffectTypes.js';
import type { DnDGameItem } from './dndEntities.js';

import {
  isWeaponOverrideKey,
  SPELL_DAMAGE_TYPE_KEY,
  WEAPON_ATTACK_ABILITY_KEY,
  WEAPON_DAMAGE_DICE_KEY,
  WEAPON_DAMAGE_TYPE_KEY,
  WEAPON_SPELL_ABILITY_LABEL,
  WEAPON_SPELL_ABILITY_VALUE,
} from './activeEffectTypes.js';
import { ABILITY_OPTIONS, isAbilityType } from './consts.js';
import {
  DAMAGE_TYPE_LABELS,
  isDefensibleDamageType,
} from './damageConstants.js';
import {
  detectFormulaDamageType,
  stripDamageTypeTokens,
} from './formulaTokens.js';

/** Итоговые замены одного оружия */
export interface WeaponOverride {
  /** Кость урона базовой части (`1к8`) */
  damageDice?: string;
  /** Характеристика атаки и урона */
  attackAbility?: AbilityType;
  /** Тип урона базовой части */
  damageType?: DefensibleDamageType;
  /** Названия эффектов, давших замены, — для подписи в разборе */
  sourceNames: string[];
}

/** Разделитель слагаемых формулы урона */
const FORMULA_TERM_SEPARATOR = '+';

/**
 * Касается ли запись этого оружия.
 *
 * @param entry - запись замены
 * @param weapon - оружие
 * @returns `true`, если вид и предмет подходят
 */
function entryReachesWeapon(
  entry: WeaponOverrideEntry,
  weapon: DnDGameItem,
): boolean {
  if (entry.itemId !== undefined && entry.itemId !== weapon.id) {
    return false;
  }

  if (entry.baseTypes === undefined) {
    return true;
  }

  return (
    weapon.baseType !== undefined && entry.baseTypes.includes(weapon.baseType)
  );
}

/**
 * Собирает замены свойств одного оружия.
 *
 * Строки идут по приоритету, при равном побеждает последняя — как режим
 * «Заменить» у числовых ключей. Характеристика `spell`, не связанная при
 * сотворении, и незнакомый тип урона пропускаются: оружие остаётся при своих.
 *
 * @param weapon - оружие
 * @param resolvedStats - итоговые статы владельца (нет — замен нет)
 * @returns замены оружия; пустой объект, если их нет
 */
export function resolveWeaponOverride(
  weapon: DnDGameItem,
  resolvedStats?: ResolvedActorStats,
): WeaponOverride {
  const override: WeaponOverride = { sourceNames: [] };

  const entries = (resolvedStats?.weaponOverrides ?? [])
    .filter((entry) => entryReachesWeapon(entry, weapon))
    .sort((entryA, entryB) => entryA.priority - entryB.priority);

  for (const entry of entries) {
    if (entry.key === WEAPON_DAMAGE_DICE_KEY) {
      override.damageDice = entry.value;
    } else if (
      entry.key === WEAPON_ATTACK_ABILITY_KEY
      && isAbilityType(entry.value)
    ) {
      override.attackAbility = entry.value;
    } else if (
      entry.key === WEAPON_DAMAGE_TYPE_KEY
      && isDefensibleDamageType(entry.value)
    ) {
      override.damageType = entry.value;
    } else {
      continue;
    }

    if (!override.sourceNames.includes(entry.sourceName)) {
      override.sourceNames.push(entry.sourceName);
    }
  }

  return override;
}

/**
 * Применяет замену кости и типа к базовой (первой) части урона.
 *
 * Кость меняется у первого слагаемого формулы, остальные слагаемые остаются.
 * Тип пишется туда же, где он был: в токен `@dmg.<тип>`, если он в формуле
 * есть, иначе в поле `type` части.
 *
 * @param part - базовая часть урона оружия
 * @param override - замены оружия
 * @returns новая часть; исходная не меняется
 */
function applyOverrideToBasePart(
  part: DamagePart,
  override: WeaponOverride,
): DamagePart {
  const [firstTerm = '', ...restTerms] = part.formula.split(
    FORMULA_TERM_SEPARATOR,
  );

  const tokenType = detectFormulaDamageType(firstTerm);

  const baseDice =
    override.damageDice ?? stripDamageTypeTokens(firstTerm).trim();

  const newTokenType = tokenType ? (override.damageType ?? tokenType) : null;

  const newFirstTerm = newTokenType
    ? `${baseDice}@dmg.${newTokenType}`
    : baseDice;

  const formula = [newFirstTerm, ...restTerms.map((term) => term.trim())]
    .filter((term) => term.length > 0)
    .join(` ${FORMULA_TERM_SEPARATOR} `);

  // Тип в токене уже заменён; поле `type` пишется, только если токена нет
  const typePatch =
    !tokenType && override.damageType ? { type: override.damageType } : {};

  return { ...part, formula, ...typePatch };
}

/**
 * Применяет замены оружия к его частям урона.
 *
 * Заменённая кость не зависит от хвата: «Дубинка» бьёт к8 и одной, и двумя
 * руками, поэтому формула хвата двумя руками у базовой части отбрасывается.
 *
 * @param parts - части урона оружия (хват уже учтён)
 * @param override - замены оружия
 * @returns части с заменами; без замен — исходный массив
 */
export function applyWeaponOverrideToDamageParts(
  parts: DamagePart[],
  override: WeaponOverride,
): DamagePart[] {
  if (!override.damageDice && !override.damageType) {
    return parts;
  }

  const [basePart, ...restParts] = parts;

  if (!basePart) {
    return parts;
  }

  const overridden = applyOverrideToBasePart(basePart, override);

  if (!override.damageDice) {
    return [overridden, ...restParts];
  }

  const { versatileFormula: _gripFormula, ...partWithoutGrip } = overridden;

  return [partWithoutGrip, ...restParts];
}

/**
 * Подставляет заклинательную характеристику наложившего в замену
 * характеристики оружия (`weapon.attackAbility: spell`).
 *
 * Делается при сотворении: тогда известно, каким классом или блоком творили.
 * На листе позже это уже не восстановить — у персонажа бывает несколько
 * заклинательных классов.
 *
 * @param effect - эффект заклинания
 * @param spellAbility - заклинательная характеристика наложившего
 * @returns эффект с подставленной характеристикой; без таких строк — исходный
 */
export function bindWeaponSpellAbility<
  Effect extends { changes: EffectChange[] },
>(effect: Effect, spellAbility: AbilityType): Effect {
  const needsBinding = effect.changes.some(isSpellAbilityChange);

  if (!needsBinding) {
    return effect;
  }

  return {
    ...effect,
    changes: effect.changes.map((change) =>
      isSpellAbilityChange(change)
        ? { ...change, value: spellAbility }
        : change,
    ),
  };
}

/**
 * Строка ли это «характеристика оружия — заклинательная».
 *
 * @param change - строка эффекта
 * @returns `true` для `weapon.attackAbility` со значением `spell`
 */
function isSpellAbilityChange(change: EffectChange): boolean {
  return (
    change.key === WEAPON_ATTACK_ABILITY_KEY
    && change.value.trim() === WEAPON_SPELL_ABILITY_VALUE
  );
}

/** Пункт выбора значения замены */
export interface WeaponOverrideValueOption {
  value: string;
  label: string;
}

/**
 * Значения на выбор у замены свойства оружия. Характеристика и тип урона —
 * закрытые списки: формулой их не задать, и опечатка молча оставила бы оружие
 * при своих.
 *
 * @param key - ключ строки эффекта
 * @returns пункты выбора либо `undefined`, если значение набирают сами
 */
export function getWeaponOverrideValueOptions(
  key: string,
): readonly WeaponOverrideValueOption[] | undefined {
  // Списки собираются при вызове, а не при загрузке модуля: движок связан
  // циклом импортов (расчёты оружия ↔ типы эффектов), и константа ключа на
  // загрузке этого модуля может быть ещё не создана
  if (key === WEAPON_ATTACK_ABILITY_KEY) {
    return [
      {
        value: WEAPON_SPELL_ABILITY_VALUE,
        label: WEAPON_SPELL_ABILITY_LABEL,
      },
      ...ABILITY_OPTIONS,
    ];
  }

  if (key === WEAPON_DAMAGE_TYPE_KEY || key === SPELL_DAMAGE_TYPE_KEY) {
    return Object.entries(DAMAGE_TYPE_LABELS).map(([value, label]) => ({
      value,
      label,
    }));
  }

  return undefined;
}

/** Ошибки значения замены оружия */
const WEAPON_OVERRIDE_VALUE_ERRORS = {
  unknownOption: 'Выберите значение из списка',
  noDice: 'Укажите кость, например 1к8',
} as const;

/** Буква кости в значении замены */
const DICE_LETTER_PATTERN = /[кдd]/i;

/**
 * Ошибка значения замены свойства оружия — подписью под полем окна эффекта.
 *
 * @param key - ключ строки
 * @param value - значение строки
 * @returns текст ошибки либо `undefined`
 */
export function validateWeaponOverrideValue(
  key: string,
  value: string,
): string | undefined {
  if (!isWeaponOverrideKey(key)) {
    return undefined;
  }

  const options = getWeaponOverrideValueOptions(key);

  if (options) {
    return options.some((option) => option.value === value.trim())
      ? undefined
      : WEAPON_OVERRIDE_VALUE_ERRORS.unknownOption;
  }

  return DICE_LETTER_PATTERN.test(value)
    ? undefined
    : WEAPON_OVERRIDE_VALUE_ERRORS.noDice;
}

/**
 * Подпись значения замены из списка («Заклинательная характеристика»,
 * «Силовой урон»).
 *
 * @param key - ключ строки
 * @param value - значение строки
 * @returns подпись либо `undefined`, если значение не из списка
 */
export function describeWeaponOverrideValue(
  key: string,
  value: string,
): string | undefined {
  return getWeaponOverrideValueOptions(key)?.find(
    (option) => option.value === value.trim(),
  )?.label;
}
