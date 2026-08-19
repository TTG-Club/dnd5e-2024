/**
 * Локальные типы редактирования черты (форма «Создать/Редактировать черту»).
 *
 * Форма держит «дары» черты в плоском, удобном для UI виде
 * ({@link EditableFeatGrants}); при сохранении они собираются в блоб
 * {@link FeatData} (`buildFeatData`), а при открытии — разворачиваются из него
 * (`featDataToGrants`). Тип вынесен отдельно, чтобы вкладку «Автоматизация»
 * ({@link FeatGrantsFields}) можно было переиспользовать в других разделах.
 */

import type { AbilityType, SkillType } from '@vtt/shared';
import type {
  ConditionKey,
  DamageDefenseEntry,
  FeatAbilityScoreIncrease,
  FeatData,
  FeatModifiers,
  FeatPrerequisite,
  FeatSenseKind,
  GrantedSpellRef,
} from '@vtt/shared/system/dnd.js';

import { FEAT_GRANTS_LABELS } from '../constants';

/** Характеристики в порядке вывода. */
export const ABILITY_KEYS: readonly AbilityType[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/** Запись «характеристика → число» со всеми шестью характеристиками по нулям. */
export function createEmptyAbilityRecord(): Record<AbilityType, number> {
  return {
    strength: 0,
    dexterity: 0,
    constitution: 0,
    intelligence: 0,
    wisdom: 0,
    charisma: 0,
  };
}

/** Чувства в порядке вывода (тёмное зрение — своё поле, его тут нет). */
export const SENSE_KEYS: readonly FeatSenseKind[] = [
  'blindsight',
  'truesight',
  'tremorsense',
];

/** Запись «чувство → дистанция» со всеми чувствами по нулям. */
export function createEmptySenseRecord(): Record<FeatSenseKind, number> {
  return { blindsight: 0, truesight: 0, tremorsense: 0 };
}

/** Редактируемые «дары» черты (вкладка «Автоматизация»). */
export interface EditableFeatGrants {
  skillProficiencies: SkillType[];
  savingThrowProficiencies: AbilityType[];
  armorProficiencies: string[];
  weaponProficiencies: string[];
  toolProficiencies: string[];
  languages: string[];
  damageDefenses: DamageDefenseEntry[];
  conditionImmunities: ConditionKey[];
  darkvision: number;
  /** Чувства с дистанцией в футах (0 = не даётся). */
  senses: Record<FeatSenseKind, number>;
  /** Дальность телепатии в футах (0 = нет). */
  telepathyRange: number;
  /** Прибавка к скорости ходьбы в футах. */
  speedWalkBonus: number;
  /** Скорость полёта в футах (0 = не даётся). */
  speedFly: number;
  /** Скорость лазания в футах (0 = не даётся). */
  speedClimb: number;
  /** Скорость плавания в футах (0 = не даётся). */
  speedSwim: number;
  /** Полёт равен скорости ходьбы (числовое значение тогда не нужно). */
  speedFlyEqualsWalk: boolean;
  /** Лазание равно скорости ходьбы. */
  speedClimbEqualsWalk: boolean;
  /** Плавание равно скорости ходьбы. */
  speedSwimEqualsWalk: boolean;
  /** Постоянная прибавка к максимуму хитов. */
  hitPointsFlat: number;
  /** Прибавка к хитам за каждый уровень персонажа на момент взятия черты. */
  hitPointsPerAcquisitionLevel: number;
  /** Прибавка к хитам за каждый уровень после взятия черты. */
  hitPointsPerLevelAfterAcquisition: number;
  /** Постоянная прибавка к классу доспеха. */
  armorClassBonus: number;
  /** Постоянная числовая прибавка к инициативе. */
  initiativeBonus: number;
  /** К инициативе прибавляется бонус мастерства («Бдительный»). */
  initiativeProficiencyBonus: boolean;
  /** Фиксированные прибавки характеристик (0 = нет). */
  asiFixed: Record<AbilityType, number>;
  /** Прибавка на выбор: размер прибавки. */
  asiChoiceAmount: number;
  /** Прибавка на выбор: сколько характеристик выбирается (0 = нет выбора). */
  asiChoiceCount: number;
  /** Прибавка на выбор: из каких характеристик (пусто = любая). */
  asiChoiceFrom: AbilityType[];
  /** Минимальные значения характеристик-требований (0 = нет). */
  prerequisiteAbilities: Record<AbilityType, number>;
  /** Минимальный суммарный уровень персонажа (0 = нет). */
  prerequisiteMinLevel: number;
  /** Требуется ли способность творить заклинания. */
  prerequisiteSpellcasting: boolean;
  /** Произвольный текст требования. */
  prerequisiteText: string;
}

/**
 * Ключи числовых полей «даров»: по ним редактор строит однотипные строки
 * настроек и обнуляет блок модификаторов, не перечисляя поля дважды.
 */
export type NumericGrantKey = {
  [Key in keyof EditableFeatGrants]: EditableFeatGrants[Key] extends number
    ? Key
    : never;
}[keyof EditableFeatGrants];

/** Ключи флагов «даров» (галочки «равно ходьбе», бонус мастерства). */
export type BooleanGrantKey = {
  [Key in keyof EditableFeatGrants]: EditableFeatGrants[Key] extends boolean
    ? Key
    : never;
}[keyof EditableFeatGrants];

/**
 * Виды движения, у которых есть спутник «равно ходьбе»: строка редактора
 * складывается из поля скорости и этой галочки. Ходьбы в списке нет — у неё
 * задаётся прибавка к своей же скорости, а не само значение.
 */
export const SPEED_MODIFIER_ROWS = [
  {
    key: 'speedFly',
    equalsWalkKey: 'speedFlyEqualsWalk',
    label: FEAT_GRANTS_LABELS.speedFly,
    equalsWalkLabel: FEAT_GRANTS_LABELS.speedFlyEqualsWalk,
  },
  {
    key: 'speedClimb',
    equalsWalkKey: 'speedClimbEqualsWalk',
    label: FEAT_GRANTS_LABELS.speedClimb,
    equalsWalkLabel: FEAT_GRANTS_LABELS.speedClimbEqualsWalk,
  },
  {
    key: 'speedSwim',
    equalsWalkKey: 'speedSwimEqualsWalk',
    label: FEAT_GRANTS_LABELS.speedSwim,
    equalsWalkLabel: FEAT_GRANTS_LABELS.speedSwimEqualsWalk,
  },
] as const satisfies ReadonlyArray<{
  key: NumericGrantKey;
  equalsWalkKey: BooleanGrantKey;
  label: string;
  equalsWalkLabel: string;
}>;

/**
 * Числовые поля блока «Модификаторы листа». Перечислены отдельно от остальных
 * «даров»: по ним редактор понимает, задан ли блок, и обнуляет только его.
 */
export const MODIFIER_NUMBER_KEYS = [
  'speedWalkBonus',
  'speedFly',
  'speedClimb',
  'speedSwim',
  'hitPointsFlat',
  'hitPointsPerAcquisitionLevel',
  'hitPointsPerLevelAfterAcquisition',
  'armorClassBonus',
  'initiativeBonus',
] as const satisfies readonly NumericGrantKey[];

/** Флаги блока «Модификаторы листа» — вторая половина того же набора. */
export const MODIFIER_FLAG_KEYS = [
  'speedFlyEqualsWalk',
  'speedClimbEqualsWalk',
  'speedSwimEqualsWalk',
  'initiativeProficiencyBonus',
] as const satisfies readonly BooleanGrantKey[];

/** Пустые «дары» черты. */
export function createEmptyFeatGrants(): EditableFeatGrants {
  return {
    skillProficiencies: [],
    savingThrowProficiencies: [],
    armorProficiencies: [],
    weaponProficiencies: [],
    toolProficiencies: [],
    languages: [],
    damageDefenses: [],
    conditionImmunities: [],
    darkvision: 0,
    senses: createEmptySenseRecord(),
    telepathyRange: 0,
    speedWalkBonus: 0,
    speedFly: 0,
    speedClimb: 0,
    speedSwim: 0,
    speedFlyEqualsWalk: false,
    speedClimbEqualsWalk: false,
    speedSwimEqualsWalk: false,
    hitPointsFlat: 0,
    hitPointsPerAcquisitionLevel: 0,
    hitPointsPerLevelAfterAcquisition: 0,
    armorClassBonus: 0,
    initiativeBonus: 0,
    initiativeProficiencyBonus: false,
    asiFixed: createEmptyAbilityRecord(),
    asiChoiceAmount: 1,
    asiChoiceCount: 0,
    asiChoiceFrom: [],
    prerequisiteAbilities: createEmptyAbilityRecord(),
    prerequisiteMinLevel: 0,
    prerequisiteSpellcasting: false,
    prerequisiteText: '',
  };
}

/** Разворачивает блоб {@link FeatData} в редактируемые «дары». */
export function featDataToGrants(
  featData: FeatData | null | undefined,
): EditableFeatGrants {
  const grants = createEmptyFeatGrants();

  if (!featData) {
    return grants;
  }

  grants.skillProficiencies = [...(featData.skillProficiencies ?? [])];

  grants.savingThrowProficiencies = [
    ...(featData.savingThrowProficiencies ?? []),
  ];

  grants.armorProficiencies = [...(featData.armorProficiencies ?? [])];
  grants.weaponProficiencies = [...(featData.weaponProficiencies ?? [])];
  grants.toolProficiencies = [...(featData.toolProficiencies ?? [])];
  grants.languages = [...(featData.languages ?? [])];

  grants.damageDefenses = (featData.damageDefenses ?? []).map((entry) => ({
    ...entry,
  }));

  grants.conditionImmunities = [...(featData.conditionImmunities ?? [])];
  grants.darkvision = featData.darkvision ?? 0;

  const modifiers = featData.modifiers;

  for (const sense of modifiers?.senses ?? []) {
    grants.senses[sense.type] = sense.range;
  }

  grants.telepathyRange = modifiers?.telepathyRange ?? 0;

  const speed = modifiers?.speed;

  grants.speedWalkBonus = speed?.walkBonus ?? 0;
  grants.speedFly = speed?.fly ?? 0;
  grants.speedClimb = speed?.climb ?? 0;
  grants.speedSwim = speed?.swim ?? 0;
  grants.speedFlyEqualsWalk = speed?.flyEqualsWalk ?? false;
  grants.speedClimbEqualsWalk = speed?.climbEqualsWalk ?? false;
  grants.speedSwimEqualsWalk = speed?.swimEqualsWalk ?? false;

  const hitPoints = modifiers?.hitPoints;

  grants.hitPointsFlat = hitPoints?.flat ?? 0;
  grants.hitPointsPerAcquisitionLevel = hitPoints?.perAcquisitionLevel ?? 0;

  grants.hitPointsPerLevelAfterAcquisition =
    hitPoints?.perLevelAfterAcquisition ?? 0;

  grants.armorClassBonus = modifiers?.armorClassBonus ?? 0;
  grants.initiativeBonus = modifiers?.initiativeBonus ?? 0;

  grants.initiativeProficiencyBonus =
    modifiers?.initiativeProficiencyBonus ?? false;

  for (const ability of ABILITY_KEYS) {
    grants.asiFixed[ability] =
      featData.abilityScoreIncrease?.fixed?.[ability] ?? 0;
  }

  const choice = featData.abilityScoreIncrease?.choice;

  if (choice) {
    grants.asiChoiceAmount = choice.amount;
    grants.asiChoiceCount = choice.count;
    grants.asiChoiceFrom = [...(choice.from ?? [])];
  }

  for (const ability of ABILITY_KEYS) {
    grants.prerequisiteAbilities[ability] =
      featData.prerequisite?.abilities?.[ability] ?? 0;
  }

  grants.prerequisiteMinLevel = featData.prerequisite?.minLevel ?? 0;

  grants.prerequisiteSpellcasting =
    featData.prerequisite?.spellcasting ?? false;

  grants.prerequisiteText = featData.prerequisite?.text ?? '';

  return grants;
}

/**
 * Собирает блоб {@link FeatData} из редактируемых «даров» и списка выдаваемых
 * заклинаний. Пустые поля опускаются; если черта не даёт ничего механического —
 * возвращает `undefined` (блоб не пишется).
 *
 * Часть механики черт компендиума форма не показывает — выборы при взятии
 * ({@link FeatData.choices}), привязки к ним и разобранные предусловия. Их
 * нельзя терять при правке названия черты, поэтому исходный блоб передаётся
 * через `base` и такие поля переносятся в новый как есть.
 *
 * @param grants - редактируемые «дары» черты
 * @param grantedSpells - выдаваемые заклинания (вкладка «Заклинания»)
 * @param base - исходный блоб редактируемой черты (для полей вне формы)
 */
export function buildFeatData(
  grants: EditableFeatGrants,
  grantedSpells: GrantedSpellRef[],
  base?: FeatData | null,
): FeatData | undefined {
  const data: FeatData = { type: 'feat' };

  if (base?.choices?.length) {
    data.choices = base.choices.map((choice) => ({ ...choice }));
  }

  if (grants.skillProficiencies.length > 0) {
    data.skillProficiencies = [...grants.skillProficiencies];
  }

  if (grants.savingThrowProficiencies.length > 0) {
    data.savingThrowProficiencies = [...grants.savingThrowProficiencies];
  }

  if (grants.armorProficiencies.length > 0) {
    data.armorProficiencies = [...grants.armorProficiencies];
  }

  if (grants.weaponProficiencies.length > 0) {
    data.weaponProficiencies = [...grants.weaponProficiencies];
  }

  if (grants.toolProficiencies.length > 0) {
    data.toolProficiencies = [...grants.toolProficiencies];
  }

  if (grants.languages.length > 0) {
    data.languages = [...grants.languages];
  }

  if (grants.damageDefenses.length > 0) {
    data.damageDefenses = grants.damageDefenses.map((entry) => ({ ...entry }));
  }

  if (grants.conditionImmunities.length > 0) {
    data.conditionImmunities = [...grants.conditionImmunities];
  }

  if (grants.darkvision > 0) {
    data.darkvision = grants.darkvision;
  }

  const asi = buildAbilityScoreIncrease(grants, base);

  if (asi) {
    data.abilityScoreIncrease = asi;
  }

  const modifiers = buildModifiers(grants, base);

  if (modifiers) {
    data.modifiers = modifiers;
  }

  const prerequisite = buildPrerequisite(grants, base);

  if (prerequisite) {
    data.prerequisite = prerequisite;
  }

  const refs = grantedSpells
    .filter((spell) => spell.name.trim().length > 0)
    .map((spell) => ({
      name: spell.name.trim(),
      ...(spell.spellId ? { spellId: spell.spellId } : {}),
      ...(spell.packId ? { packId: spell.packId } : {}),
    }));

  if (refs.length > 0) {
    data.grantedSpells = refs;
  }

  // Заклинательная характеристика и признак подготовки формой не правятся: они
  // приходят из компендиума и относятся к выданным заклинаниям целиком. Переносим
  // из исходного блоба, иначе сохранение черты стёрло бы их
  if (base?.spellcastingAbility) {
    data.spellcastingAbility = base.spellcastingAbility;
  }

  if (base?.grantedSpellsAlwaysPrepared !== undefined) {
    data.grantedSpellsAlwaysPrepared = base.grantedSpellsAlwaysPrepared;
  }

  // Кроме дискриминанта `type` ничего не задано — блоб не нужен.
  return Object.keys(data).length > 1 ? data : undefined;
}

/**
 * Собирает повышение характеристик из редактируемых «даров».
 *
 * @param grants - редактируемые «дары» черты
 * @param base - исходный блоб: из него переносится привязка к выбору
 */
function buildAbilityScoreIncrease(
  grants: EditableFeatGrants,
  base?: FeatData | null,
): FeatAbilityScoreIncrease | undefined {
  const fixed: Partial<Record<AbilityType, number>> = {};

  for (const ability of ABILITY_KEYS) {
    const bonus = grants.asiFixed[ability];

    if (bonus && bonus !== 0) {
      fixed[ability] = bonus;
    }
  }

  const result: FeatAbilityScoreIncrease = {};

  if (Object.keys(fixed).length > 0) {
    result.fixed = fixed;
  }

  if (grants.asiChoiceCount > 0 && grants.asiChoiceAmount !== 0) {
    result.choice = {
      amount: grants.asiChoiceAmount,
      count: grants.asiChoiceCount,
      ...(grants.asiChoiceFrom.length > 0
        ? { from: [...grants.asiChoiceFrom] }
        : {}),
    };
  }

  const fromChoiceKey = base?.abilityScoreIncrease?.fromChoiceKey;

  if (fromChoiceKey) {
    result.fromChoiceKey = fromChoiceKey;
  }

  // Предел формой не правится — переносим из исходного блоба, иначе сохранение
  // черты, пришедшей из компендиума, стёрло бы его
  const upto = base?.abilityScoreIncrease?.upto;

  if (upto) {
    result.upto = upto;
  }

  return result.fixed || result.choice || result.fromChoiceKey
    ? result
    : undefined;
}

/**
 * Собирает постоянные модификаторы листа (хиты, скорости, КД, чувства,
 * телепатия, инициатива) из редактируемых «даров».
 *
 * @param grants - редактируемые «дары» черты
 * @param base - исходный блоб: из него переносится привязка сопротивления к выбору
 */
function buildModifiers(
  grants: EditableFeatGrants,
  base?: FeatData | null,
): FeatModifiers | undefined {
  const result: FeatModifiers = {};

  const hitPoints = {
    ...(grants.hitPointsFlat !== 0 ? { flat: grants.hitPointsFlat } : {}),
    ...(grants.hitPointsPerAcquisitionLevel !== 0
      ? { perAcquisitionLevel: grants.hitPointsPerAcquisitionLevel }
      : {}),
    ...(grants.hitPointsPerLevelAfterAcquisition !== 0
      ? {
          perLevelAfterAcquisition: grants.hitPointsPerLevelAfterAcquisition,
        }
      : {}),
  };

  if (Object.keys(hitPoints).length > 0) {
    result.hitPoints = hitPoints;
  }

  const speed = {
    ...(grants.speedWalkBonus !== 0
      ? { walkBonus: grants.speedWalkBonus }
      : {}),
    ...(grants.speedFly > 0 ? { fly: grants.speedFly } : {}),
    ...(grants.speedClimb > 0 ? { climb: grants.speedClimb } : {}),
    ...(grants.speedSwim > 0 ? { swim: grants.speedSwim } : {}),
    ...(grants.speedFlyEqualsWalk ? { flyEqualsWalk: true } : {}),
    ...(grants.speedClimbEqualsWalk ? { climbEqualsWalk: true } : {}),
    ...(grants.speedSwimEqualsWalk ? { swimEqualsWalk: true } : {}),
  };

  if (Object.keys(speed).length > 0) {
    result.speed = speed;
  }

  if (grants.armorClassBonus !== 0) {
    result.armorClassBonus = grants.armorClassBonus;
  }

  const senses = SENSE_KEYS.filter((type) => grants.senses[type] > 0).map(
    (type) => ({ type, range: grants.senses[type] }),
  );

  if (senses.length > 0) {
    result.senses = senses;
  }

  if (grants.telepathyRange > 0) {
    result.telepathyRange = grants.telepathyRange;
  }

  if (grants.initiativeProficiencyBonus) {
    result.initiativeProficiencyBonus = true;
  }

  if (grants.initiativeBonus !== 0) {
    result.initiativeBonus = grants.initiativeBonus;
  }

  const resistanceFromChoiceKey = base?.modifiers?.resistanceFromChoiceKey;

  if (resistanceFromChoiceKey) {
    result.resistanceFromChoiceKey = resistanceFromChoiceKey;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Собирает предусловия из редактируемых «даров».
 *
 * @param grants - редактируемые «дары» черты
 * @param base - исходный блоб: из него переносятся требования, которых нет в форме
 */
function buildPrerequisite(
  grants: EditableFeatGrants,
  base?: FeatData | null,
): FeatPrerequisite | undefined {
  const basePrerequisite = base?.prerequisite;

  // Требования, которых форма не показывает (разобранные ссылки на классы,
  // виды, черты и т.п.), переносятся из исходного блоба как есть.
  const result: FeatPrerequisite = {
    ...(basePrerequisite?.abilityRequirements
      ? { abilityRequirements: basePrerequisite.abilityRequirements }
      : {}),
    ...(basePrerequisite?.classFeatures
      ? { classFeatures: basePrerequisite.classFeatures }
      : {}),
    ...(basePrerequisite?.feats ? { feats: basePrerequisite.feats } : {}),
    ...(basePrerequisite?.classes ? { classes: basePrerequisite.classes } : {}),
    ...(basePrerequisite?.species ? { species: basePrerequisite.species } : {}),
    ...(basePrerequisite?.backgrounds
      ? { backgrounds: basePrerequisite.backgrounds }
      : {}),
    ...(basePrerequisite?.armorProficiency
      ? { armorProficiency: basePrerequisite.armorProficiency }
      : {}),
    ...(basePrerequisite?.campaign
      ? { campaign: basePrerequisite.campaign }
      : {}),
    ...(basePrerequisite?.anyDragonmark
      ? { anyDragonmark: basePrerequisite.anyDragonmark }
      : {}),
  };

  const abilities: Partial<Record<AbilityType, number>> = {};

  for (const ability of ABILITY_KEYS) {
    const value = grants.prerequisiteAbilities[ability];

    if (value && value > 0) {
      abilities[ability] = value;
    }
  }

  if (Object.keys(abilities).length > 0) {
    result.abilities = abilities;
  }

  if (grants.prerequisiteMinLevel > 0) {
    result.minLevel = grants.prerequisiteMinLevel;
  }

  if (grants.prerequisiteSpellcasting) {
    result.spellcasting = true;
  }

  if (grants.prerequisiteText.trim().length > 0) {
    result.text = grants.prerequisiteText.trim();
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
