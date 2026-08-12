/**
 * Формулы расчёта системы D&D 5e
 *
 * Все математические формулы, специфичные для D&D 5e.
 * При переключении на другую систему — замени этот файл.
 */

import type {
  AbilityType,
  ActorArmorClass,
  ActorMovement,
  ArmorCalculation,
  BaseActor,
  BaseCreature,
  DamagePart,
  DistanceUnit,
  MovementType,
  ProficiencyLevel,
  SkillType,
} from '@vtt/shared';

import type { ResolvedActorStats } from './activeEffectTypes.js';
import type {
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
} from './dndEntities.js';
import type { ActorSpeciesEntry } from './speciesTypes.js';
import type {
  DnDActorSystem,
  DnDCurrency,
  DnDHitPoints,
  DnDProficiencies,
} from './types.js';

import { isRecord } from '@vtt/shared';

import { getTotalLevel } from './classTypes.js';
import {
  CREATURE_SIZE_TO_TOKEN_SCALE,
  DEFAULT_CREATURE_SIZE,
  EXPERIENCE_TABLE,
  isAbilityType,
  isCreatureType,
  isSkillType,
  MAX_LEVEL,
  MOVEMENT_LABELS,
  MOVEMENT_PRIORITY,
  normalizeCreatureSize,
  normalizeSpellUsesRecovery,
  SKILL_ABILITY_MAP,
} from './consts.js';
import {
  DEFAULT_PROFICIENCY_BONUS,
  getProficiencyBonusBreakdown,
  parseProficiencySettings,
} from './proficiencyBonus.js';

/**
 * Вычисляет модификатор характеристики
 *
 * Формула: floor((score - 10) / 2)
 *
 * @param abilityScore - Значение характеристики (1-30)
 * @returns Модификатор характеристики
 */
export function calculateAbilityModifier(abilityScore: number): number {
  return Math.floor((abilityScore - 10) / 2);
}

/**
 * Вычисляет бонус мастерства на основе уровня персонажа
 *
 * Формула: floor((level - 1) / 4) + 2
 *
 * @param level - Уровень персонажа (1-20)
 * @returns Бонус мастерства
 */
export function calculateProficiencyBonus(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

/**
 * Модификаторы всех шести характеристик по записи листа — без учёта активных
 * эффектов.
 *
 * Нужны там, где итоговых статов пайплайна под рукой нет: свои бонусы считаются
 * от модификаторов, а не от значений характеристик. Лист персонажа и лист
 * существа считают их одинаково.
 *
 * Пустая запись даёт нулевые модификаторы: лист рисуется и до того, как в него
 * подгрузилась сущность, и разбирать эту пустоту на каждой стороне незачем.
 *
 * @param actor - актёр или существо листа
 * @returns модификаторы характеристик
 */
export function getActorAbilityModifiers(
  actor: DnDActor | DnDCreature | null | undefined,
): Record<AbilityType, number> {
  const abilities = actor?.system?.abilities;

  return {
    strength: calculateAbilityModifier(abilities?.strength ?? 10),
    dexterity: calculateAbilityModifier(abilities?.dexterity ?? 10),
    constitution: calculateAbilityModifier(abilities?.constitution ?? 10),
    intelligence: calculateAbilityModifier(abilities?.intelligence ?? 10),
    wisdom: calculateAbilityModifier(abilities?.wisdom ?? 10),
    charisma: calculateAbilityModifier(abilities?.charisma ?? 10),
  };
}

/**
 * Бонус мастерства актёра. С итоговыми статами берётся их число — в нём уже
 * учтены и настройка листа, и активные эффекты; без них считается расчёт по
 * суммарному уровню с поправками настройки.
 *
 * Одна точка расчёта на всю систему: бонус идёт в спасброски, навыки, атаку
 * оружием и заклинательство, и считать его порознь нельзя — настройка листа
 * терялась бы в половине мест.
 *
 * @param actor - актёр листа
 * @param resolvedStats - итоговые статы пайплайна, если они есть
 * @returns бонус мастерства
 */
export function getActorProficiencyBonus(
  actor: DnDActor,
  resolvedStats?: ResolvedActorStats,
): number {
  if (resolvedStats) {
    return resolvedStats.proficiencyBonus;
  }

  return getProficiencyBonusBreakdown({
    ruleValue: calculateProficiencyBonus(getTotalLevel(actor.system?.classes)),
    settings: parseProficiencySettings(actor.system?.proficiencySettings),
    abilityMods: getActorAbilityModifiers(actor),
  }).value;
}

/**
 * Бонус мастерства существа. По правилам он берётся из показателя опасности
 * (`system.proficiencyBonus`), а настройка листа заменяет эту основу своим
 * числом и добавляет свои бонусы.
 *
 * Отдельно от {@link getActorProficiencyBonus}: у существа нет классовых
 * уровней, и основа расчёта у него своя.
 *
 * @param creature - существо листа
 * @param resolvedStats - итоговые статы пайплайна, если они есть
 * @returns бонус мастерства
 */
export function getCreatureProficiencyBonus(
  creature: DnDCreature,
  resolvedStats?: ResolvedActorStats,
): number {
  if (resolvedStats) {
    return resolvedStats.proficiencyBonus;
  }

  return getProficiencyBonusBreakdown({
    ruleValue: creature.system?.proficiencyBonus ?? DEFAULT_PROFICIENCY_BONUS,
    settings: parseProficiencySettings(creature.system?.proficiencySettings),
    abilityMods: getActorAbilityModifiers(creature),
  }).value;
}

/**
 * Возвращает требуемый опыт для следующего уровня
 *
 * @param currentLevel - Текущий уровень персонажа (1-20)
 * @returns Требуемый опыт для следующего уровня
 */
export function calculateExperienceForNextLevel(currentLevel: number): number {
  if (currentLevel >= MAX_LEVEL) {
    return EXPERIENCE_TABLE[MAX_LEVEL - 1];
  }

  return EXPERIENCE_TABLE[currentLevel] || EXPERIENCE_TABLE[MAX_LEVEL - 1];
}

/**
 * Возвращает базовую характеристику для навыка
 *
 * @param skill - Тип навыка
 * @returns Тип базовой характеристики
 */
export function getSkillAbility(skill: SkillType): AbilityType {
  return SKILL_ABILITY_MAP[skill];
}

/**
 * Type-guard: значение — корректный уровень владения навыком.
 *
 * Нужен для безопасного чтения уровня из данных типа `unknown`
 * (легаси/кросс-поля систем) без приведения через `as`.
 *
 * @param value - проверяемое значение
 * @returns true, если value — один из ProficiencyLevel
 */
export function isProficiencyLevel(value: unknown): value is ProficiencyLevel {
  return (
    value === 'none'
    || value === 'half'
    || value === 'proficient'
    || value === 'expertise'
  );
}

/**
 * Вклад бонуса мастерства в навык с учётом уровня владения.
 *
 * Единый источник правды для множителя владения:
 *  - none       → 0
 *  - half       → floor(бонус / 2)  (Мастер на все руки)
 *  - proficient → бонус
 *  - expertise  → бонус × 2          (Компетентность/Экспертиза)
 *
 * @param proficiencyBonus - Бонус мастерства существа/персонажа
 * @param proficiencyLevel - Уровень владения навыком
 * @returns Числовой вклад мастерства (без модификатора характеристики)
 */
export function getProficiencyContribution(
  proficiencyBonus: number,
  proficiencyLevel: ProficiencyLevel,
): number {
  if (proficiencyLevel === 'expertise') {
    return proficiencyBonus * 2;
  }

  if (proficiencyLevel === 'proficient') {
    return proficiencyBonus;
  }

  if (proficiencyLevel === 'half') {
    return Math.floor(proficiencyBonus / 2);
  }

  return 0;
}

/**
 * Вычисляет итоговый модификатор навыка с учётом уровня владения.
 *
 * Формула: модификатор_характеристики + бонус_мастерства × множитель_владения
 *
 * @param abilityScore - Значение характеристики, от которой зависит навык
 * @param proficiencyBonus - Бонус мастерства существа/персонажа
 * @param proficiencyLevel - Уровень владения навыком
 * @returns Итоговый числовой модификатор навыка
 */
export function calculateSkillModifier(
  abilityScore: number,
  proficiencyBonus: number,
  proficiencyLevel: ProficiencyLevel,
): number {
  return (
    calculateAbilityModifier(abilityScore)
    + getProficiencyContribution(proficiencyBonus, proficiencyLevel)
  );
}

/**
 * Определяет, имеет ли актёр владение данным оружием
 * на основе `proficiencyMode` и списка владений актёра.
 *
 * Проверяет по:
 * 1. Ключу базового типа (baseType, например "longsword")
 * 2. Категории оружия ("simple" / "martial")
 *
 * @param actor - актёр-владелец
 * @param weapon - оружие
 * @returns true если бонус мастерства должен применяться
 */
export function resolveWeaponProficiency(
  actor: DnDActor,
  weapon: DnDGameItem,
): boolean {
  const mode = weapon.proficiencyMode ?? 'auto';

  if (mode === 'always') {
    return true;
  }

  if (mode === 'never') {
    return false;
  }

  // auto: сверяем baseType оружия со списком владений актёра
  const actorWeapons = actor.system?.proficiencies?.weapons ?? [];

  if (!weapon.baseType) {
    return false;
  }

  // Проверка по ключу baseType (например, "longsword")
  if (actorWeapons.includes(weapon.baseType)) {
    return true;
  }

  // Проверка по категории оружия ("simple" / "martial")
  if (weapon.weaponCategory && actorWeapons.includes(weapon.weaponCategory)) {
    return true;
  }

  return false;
}

/**
 * Рассчитывает модификатор атаки для оружия на основе характеристик актёра.
 * Учитывает модификатор характеристики, бонус мастерства, бонус атаки оружия
 * и бонусы от Active Effects (ауры, экипировка и т.д.).
 *
 * @param actor - актёр-владелец
 * @param weapon - оружие
 * @param resolvedStats - итоговые статы из пайплайна (для бонусов от эффектов)
 * @returns модификатор атаки
 */
/**
 * Возвращает значение характеристики для броска оружия с учётом свойства
 * «Фехтовальное» (finesse): по правилам D&D можно использовать Силу ИЛИ
 * Ловкость — берётся бо́льшая. Без finesse — заданная `attackAbility`
 * (по умолчанию Сила).
 *
 * @param actor - актёр-владелец
 * @param weapon - оружие
 * @returns значение характеристики (1-30)
 */
export function resolveWeaponAbilityScore(
  actor: DnDActor,
  weapon: DnDGameItem,
): number {
  const abilities = actor.system?.abilities;

  if (weapon.weaponProperties?.includes('finesse')) {
    return Math.max(abilities?.strength ?? 10, abilities?.dexterity ?? 10);
  }

  return abilities?.[weapon.attackAbility ?? 'strength'] ?? 10;
}

export function calculateWeaponAttackModifier(
  actor: DnDActor,
  weapon: DnDGameItem,
  resolvedStats?: ResolvedActorStats,
): number {
  const abilityScore = resolveWeaponAbilityScore(actor, weapon);

  let modifier = calculateAbilityModifier(abilityScore);

  if (resolveWeaponProficiency(actor, weapon)) {
    modifier += getActorProficiencyBonus(actor, resolvedStats);
  }

  if (weapon.attackBonus) {
    modifier += weapon.attackBonus;
  }

  // Учёт магического бонуса
  if (weapon.isMagical && weapon.magicBonus) {
    modifier += Number(weapon.magicBonus);
  }

  // Бонусы от Active Effects (ауры, экипировка и т.д.)
  if (resolvedStats) {
    const isMelee = weapon.rangeType !== 'ranged';

    modifier += isMelee
      ? resolvedStats.attackBonuses.melee
      : resolvedStats.attackBonuses.ranged;
  }

  return modifier;
}

/**
 * Рассчитывает статический модификатор урона для оружия на основе характеристик актёра.
 * Учитывает модификатор характеристики и статические бонусы урона от Active Effects.
 *
 * @param actor - актёр-владелец
 * @param weapon - оружие
 * @param resolvedStats - итоговые статы из пайплайна (для бонусов от эффектов)
 * @returns статический бонус к урону
 */
export function calculateWeaponDamageModifier(
  actor: DnDActor,
  weapon: DnDGameItem,
  resolvedStats?: import('./activeEffectTypes.js').ResolvedActorStats,
): number {
  const abilityScore = resolveWeaponAbilityScore(actor, weapon);

  let modifier = calculateAbilityModifier(abilityScore);

  // Бонусы от Active Effects (ауры, экипировка и т.д.)
  if (resolvedStats) {
    const isMelee = weapon.rangeType !== 'ranged';

    modifier += isMelee
      ? resolvedStats.damageBonuses.melee
      : resolvedStats.damageBonuses.ranged;
  }

  return modifier;
}

/**
 * Проверяет, удерживается ли универсальное (versatile) оружие двумя руками.
 * Хват двумя руками задаётся флагом `twoHandedGrip` и имеет смысл только для
 * оружия со свойством `versatile`.
 *
 * @param weapon - оружие
 * @returns true, если versatile-оружие в текущий момент удерживается двумя руками
 */
export function isVersatileTwoHandedGrip(weapon: DnDGameItem): boolean {
  return (
    Boolean(weapon.twoHandedGrip)
    && Boolean(weapon.weaponProperties?.includes('versatile'))
  );
}

/**
 * Возвращает части урона оружия с учётом хвата (versatile).
 *
 * Источник истины боевого урона оружия — `damageParts` (единый со
 * заклинаниями движок). При хвате двумя руками для каждой части, у которой
 * задана `versatileFormula`, формула заменяется на неё (правило versatile
 * касается только базовых костей оружия).
 *
 * @param weapon - оружие
 * @returns части урона (с применённым versatile-хватом); `[]` если урон не задан
 */
export function getWeaponDamageParts(weapon: DnDGameItem): DamagePart[] {
  const parts = weapon.damageParts ?? [];

  if (!isVersatileTwoHandedGrip(weapon)) {
    return parts;
  }

  return parts.map((part) =>
    part.versatileFormula ? { ...part, formula: part.versatileFormula } : part,
  );
}

/**
 * Возвращает основной тип урона оружия — для подписей в списках/карточках и
 * дефолтного типа сегментов. Источник истины — первый инлайн-токен `@dmg.<type>`
 * в формуле первой части (если есть), иначе поле `type` первой части.
 *
 * @param weapon - оружие
 * @returns тип урона первой части или undefined, если урон не задан
 */
export function getWeaponPrimaryDamageType(
  weapon: DnDGameItem,
): string | undefined {
  const part = getWeaponDamageParts(weapon)[0];

  if (!part) {
    return undefined;
  }

  const tokenMatch = part.formula.match(/@dmg\.([a-z]+)/i);

  return tokenMatch ? tokenMatch[1].toLowerCase() : part.type;
}

/**
 * Форматирует формулы урона оружия для отображения: формулы всех частей,
 * соединённые « + », без инлайн-токенов (`@dmg.*`/`@heal`) и с заменой латинской
 * `d` на кириллическую `к` (`1d8` → `1к8`). Versatile-хват не учитывается.
 *
 * @param weapon - оружие
 * @returns строка вида «1к8 + 1к6» или пустая строка, если урон не задан
 */
export function formatWeaponDamageFormula(weapon: DnDGameItem): string {
  return getWeaponDamageParts(weapon)
    .map((part) =>
      part.formula
        .replace(/@dmg\.[a-z]+/gi, '')
        .replace(/@heal(\.temp)?/gi, '')
        .replace(/(\d+)d(\d+)/gi, '$1к$2')
        .replace(/\s{2,}/g, ' ')
        .trim(),
    )
    .filter((formula) => formula.length > 0)
    .join(' + ');
}

/**
 * Возвращает приоритетный тип движения и его значение для отображения в стат-блоке.
 *
 * @param movement - Объект движения персонажа
 * @returns Тип и значение приоритетного движения
 */
export function getDisplayMovement(movement: ActorMovement): {
  type: MovementType;
  value: number;
  label: string;
} {
  let bestType: MovementType = 'walk';
  let bestValue = movement.walk;

  for (const type of MOVEMENT_PRIORITY) {
    const value = movement[type];

    if (typeof value !== 'number' || value <= 0) {
      continue;
    }

    if (
      value > bestValue
      || (value === bestValue
        && MOVEMENT_PRIORITY.indexOf(type)
          < MOVEMENT_PRIORITY.indexOf(bestType))
    ) {
      bestType = type;
      bestValue = value;
    }
  }

  return { type: bestType, value: bestValue, label: MOVEMENT_LABELS[bestType] };
}

/**
 * Возвращает список ненулевых типов движения для tooltip
 *
 * @param movement - Объект движения персонажа
 * @returns Массив типов с ненулевыми значениями, отсортированных по приоритету
 */
export function getMovementList(
  movement: ActorMovement,
): Array<{ type: MovementType; value: number; label: string }> {
  return MOVEMENT_PRIORITY.filter((type) => {
    const value = movement[type];

    return typeof value === 'number' && value > 0;
  }).map((type) => ({
    type,
    value: movement[type],
    label: MOVEMENT_LABELS[type],
  }));
}

// ── Граница SQL↔TS: разбор legacy-полей актёра ────────────────
//
// В старом формате поля актёра лежали на его корне, а не в `system`, и
// приходят из БД / по сокету в неизвестной форме. Поэтому каждое читается как
// `unknown` и разбирается поштучно: испорченное поле заменяется значением по
// правилам, а не роняет лист и не утаскивает за собой соседние.

/**
 * Разбирает число с границы БД: старые записи хранят числа строками.
 *
 * @param value - сырое значение поля
 * @param fallback - значение по умолчанию
 * @returns число поля либо значение по умолчанию
 */
function parseLegacyNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

/**
 * Разбирает булево поле с границы БД.
 *
 * @param value - сырое значение поля
 * @param fallback - значение по умолчанию
 * @returns значение поля либо значение по умолчанию
 */
function parseLegacyBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Разбирает список строк: нестроковые элементы отбрасываются поштучно.
 *
 * @param value - сырое значение поля
 * @returns список строк (пустой, если разбирать нечего)
 */
function parseStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/**
 * Type-guard: значение — единица измерения расстояния.
 *
 * @param value - сырое значение поля
 * @returns `true`, если это известная единица измерения
 */
function isDistanceUnit(value: unknown): value is DistanceUnit {
  return value === 'ft' || value === 'm' || value === 'mi' || value === 'km';
}

/**
 * Type-guard: значение — способ расчёта КД.
 *
 * @param value - сырое значение поля
 * @returns `true`, если это известный способ расчёта
 */
function isArmorCalculation(value: unknown): value is ArmorCalculation {
  return (
    value === 'default'
    || value === 'natural'
    || value === 'flat'
    || value === 'custom'
  );
}

/**
 * Разбирает передвижение актёра. Значения берутся по одному, поэтому неполная
 * legacy-запись (только `walk`) не теряет то, что в ней было.
 *
 * @param value - сырое значение поля `movement`
 * @returns передвижение актёра
 */
function parseLegacyMovement(value: unknown): ActorMovement {
  const source = isRecord(value) ? value : {};

  return {
    walk: parseLegacyNumber(source.walk, 30),
    swim: parseLegacyNumber(source.swim, 0),
    fly: parseLegacyNumber(source.fly, 0),
    climb: parseLegacyNumber(source.climb, 0),
    burrow: parseLegacyNumber(source.burrow, 0),
    hover: parseLegacyBoolean(source.hover, false),
    units: isDistanceUnit(source.units) ? source.units : 'ft',
  };
}

/**
 * Разбирает класс доспеха актёра.
 *
 * @param value - сырое значение поля `armorClass`
 * @returns класс доспеха
 */
function parseLegacyArmorClass(value: unknown): ActorArmorClass {
  const source = isRecord(value) ? value : {};

  return {
    value: parseLegacyNumber(source.value, 10),
    calculation: isArmorCalculation(source.calculation)
      ? source.calculation
      : 'default',
    formula: typeof source.formula === 'string' ? source.formula : '',
    flat: typeof source.flat === 'number' ? source.flat : null,
  };
}

/**
 * Разбирает владения навыками: чужой ключ навыка или неизвестная степень
 * владения отбрасываются поштучно.
 *
 * @param value - сырое значение поля `proficiencies.skills`
 * @returns владения навыками
 */
function parseSkillProficiencies(
  value: unknown,
): Partial<Record<SkillType, ProficiencyLevel>> {
  const skills: Partial<Record<SkillType, ProficiencyLevel>> = {};

  if (!isRecord(value)) {
    return skills;
  }

  for (const [skillKey, level] of Object.entries(value)) {
    if (isSkillType(skillKey) && isProficiencyLevel(level)) {
      skills[skillKey] = level;
    }
  }

  return skills;
}

/**
 * Разбирает владения актёра.
 *
 * @param value - сырое значение поля `proficiencies`
 * @returns владения актёра
 */
function parseLegacyProficiencies(value: unknown): DnDProficiencies {
  const source = isRecord(value) ? value : {};

  return {
    armor: parseStringList(source.armor),
    weapons: parseStringList(source.weapons),
    weaponMasteries: parseStringList(source.weaponMasteries),
    tools: parseStringList(source.tools),
    // Общий язык — стартовый по правилам: у актёра без списка языков он есть,
    // а вот пустой список в записи — уже осознанный выбор, и его не трогаем
    languages:
      'languages' in source ? parseStringList(source.languages) : ['Общий'],
    savingThrows: Array.isArray(source.savingThrows)
      ? source.savingThrows.filter(isAbilityType)
      : [],
    skills: parseSkillProficiencies(source.skills),
  };
}

/**
 * Разбирает хиты актёра. Запас хитов у актёра — три обязательных числа, но у
 * записи старого мира их может не быть вовсе.
 *
 * @param value - сырое значение поля `hitPoints`
 * @returns хиты актёра
 */
function parseLegacyHitPoints(value: unknown): DnDHitPoints {
  const source = isRecord(value) ? value : {};

  return {
    current: parseLegacyNumber(source.current, 10),
    max: parseLegacyNumber(source.max, 10),
    temp: parseLegacyNumber(source.temp, 0),
  };
}

/**
 * Разбирает кошелёк актёра.
 *
 * @param value - сырое значение поля `currency`
 * @returns монеты актёра
 */
function parseLegacyCurrency(value: unknown): DnDCurrency {
  const source = isRecord(value) ? value : {};

  return {
    cp: parseLegacyNumber(source.cp, 0),
    sp: parseLegacyNumber(source.sp, 0),
    ep: parseLegacyNumber(source.ep, 0),
    gp: parseLegacyNumber(source.gp, 0),
    pp: parseLegacyNumber(source.pp, 0),
  };
}

/**
 * Разбирает запись выборов вида «ключ → строка».
 *
 * @param value - сырое значение поля
 * @returns запись выборов (пустая, если разбирать нечего)
 */
function parseChoiceRecord(value: unknown): Record<string, string> {
  const choices: Record<string, string> = {};

  if (!isRecord(value)) {
    return choices;
  }

  for (const [choiceKey, choice] of Object.entries(value)) {
    if (typeof choice === 'string') {
      choices[choiceKey] = choice;
    }
  }

  return choices;
}

/**
 * Разбирает выборы даров вида по уровням: ключ уровня — целое число.
 *
 * @param value - сырое значение поля `grantChoices`
 * @returns выборы даров по уровням
 */
function parseGrantChoices(value: unknown): Record<number, string[]> {
  const grantChoices: Record<number, string[]> = {};

  if (!isRecord(value)) {
    return grantChoices;
  }

  for (const [levelKey, choices] of Object.entries(value)) {
    const level = Number(levelKey);

    if (Number.isInteger(level)) {
      grantChoices[level] = parseStringList(choices);
    }
  }

  return grantChoices;
}

/**
 * Разбирает запись о виде актёра. Без ключа вида запись бесполезна — такая
 * отбрасывается целиком, остальные поля дополняются значениями по правилам.
 *
 * @param value - сырое значение поля `species`
 * @returns запись о виде либо `null`
 */
function parseLegacySpecies(value: unknown): ActorSpeciesEntry | null {
  if (!isRecord(value) || typeof value.speciesKey !== 'string') {
    return null;
  }

  return {
    speciesKey: value.speciesKey,
    speciesName:
      typeof value.speciesName === 'string'
        ? value.speciesName
        : value.speciesKey,
    creatureType: isCreatureType(value.creatureType)
      ? value.creatureType
      : 'humanoid',
    size: normalizeCreatureSize(value.size),
    featureChoices: parseChoiceRecord(value.featureChoices),
    grantChoices: parseGrantChoices(value.grantChoices),
  };
}

/**
 * Нормализует объект актёра: если данные хранятся на корне (legacy-формат),
 * переносит их в `system` (новый формат DnDActorSystem), и доводит запись до
 * формы, которую объявляет `DnDActor`.
 *
 * Принимает актёра в НЕЙТРАЛЬНОЙ форме ядра — иначе и быть не может: до этой
 * функции у записи старого мира нет ни `system.abilities`, ни корневых
 * коллекций, то есть D&D-формы у неё ещё нет. После вызова она есть, и её
 * подтверждает `isDndActor`.
 *
 * Вызывать при загрузке актёра из БД или получении по WebSocket.
 * Мутирует объект на месте — этого ждёт и ядро (контракт `VttSystem`).
 *
 * @param actor - объект актёра (может быть legacy или новый формат)
 */
export function normalizeActor(actor: BaseActor): void {
  // Legacy-поля лежат на корне актёра, а нейтральный тип их не знает: читаем
  // корень как свободную запись и разбираем каждое поле по отдельности.
  const raw: Record<string, unknown> = isRecord(actor) ? actor : {};

  // Дискриминатор типа сущности
  actor.entityType = 'actor';

  if (!Array.isArray(actor.activeEffects)) {
    actor.activeEffects = [];
  }

  const existingSystem = isRecord(actor.system) ? actor.system : undefined;

  if (existingSystem && isRecord(existingSystem.abilities)) {
    // Новый формат: `system` уже собран — правим только то, чего в нём может
    // не быть, и ничего больше не трогаем
    if (!existingSystem.currency) {
      existingSystem.currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
    }

    existingSystem.size = normalizeCreatureSize(existingSystem.size);
  } else {
    const system: DnDActorSystem = {
      species: parseLegacySpecies(raw.species),
      background: null,
      classes: [],
      experience: parseLegacyNumber(raw.experience, 0),
      inspiration: parseLegacyBoolean(raw.inspiration, false),
      size: normalizeCreatureSize(raw.size),

      abilities: {
        strength: parseLegacyNumber(raw.strength, 10),
        dexterity: parseLegacyNumber(raw.dexterity, 10),
        constitution: parseLegacyNumber(raw.constitution, 10),
        intelligence: parseLegacyNumber(raw.intelligence, 10),
        wisdom: parseLegacyNumber(raw.wisdom, 10),
        charisma: parseLegacyNumber(raw.charisma, 10),
      },

      movement: parseLegacyMovement(raw.movement),

      armorClass: parseLegacyArmorClass(raw.armorClass),

      hitPoints: parseLegacyHitPoints(existingSystem?.hitPoints),

      initiativeBonus: parseLegacyNumber(raw.initiativeBonus, 0),
      initiativeAbility: isAbilityType(raw.initiativeAbility)
        ? raw.initiativeAbility
        : 'dexterity',

      proficiencies: parseLegacyProficiencies(raw.proficiencies),

      currency: parseLegacyCurrency(raw.currency),

      classCounters: [],
    };

    actor.system = system;
  }

  // Корневые коллекции D&D объявлены обязательными, но у записи старого мира
  // их нет. Заполняем пустыми — те же значения, что весь лист подставлял через
  // `?? []`, только теперь запись и по форме соответствует своему типу.
  if (!Array.isArray(raw.spells)) {
    raw.spells = [];
  }

  if (!Array.isArray(raw.equipment)) {
    raw.equipment = [];
  }

  if (!Array.isArray(raw.features)) {
    raw.features = [];
  }

  if (typeof raw.notes !== 'string') {
    raw.notes = '';
  }
}

/**
 * Нормализует объект существа: если данные отсутствуют или неполные,
 * заполняет значениями по умолчанию.
 *
 * Принимает существо в НЕЙТРАЛЬНОЙ форме ядра — как и {@link normalizeActor}:
 * до этой функции у записи старого мира `system` может не быть вовсе, то есть
 * D&D-формы у неё ещё нет. После вызова она есть, и её подтверждает
 * `isDndCreature`.
 *
 * Вызывать при загрузке существа из БД.
 * Мутирует объект на месте — этого ждёт и ядро (контракт `VttSystem`).
 *
 * @param creature - объект существа (может быть legacy или новый формат)
 */
export function normalizeCreature(creature: BaseCreature): void {
  // Корневые поля D&D нейтральный тип не знает: читаем корень свободной записью
  const raw: Record<string, unknown> = isRecord(creature) ? creature : {};

  // Дискриминатор типа сущности
  creature.entityType = 'creature';

  // Если system отсутствует — создаём дефолтный.
  // Граница SQL↔TS: по типу поле обязательное, но у legacy-существа его нет.
  if (!isRecord(creature.system)) {
    creature.system = {
      size: DEFAULT_CREATURE_SIZE,
      type: 'humanoid',
      subtype: '',
      alignment: 'unaligned',
      armorClass: { value: 10, calculation: 'flat', formula: '', flat: 10 },
      hitPoints: { average: 10, formula: '' },
      movement: {
        walk: 30,
        swim: 0,
        fly: 0,
        climb: 0,
        burrow: 0,
        hover: false,
        units: 'ft',
      },
      abilities: {
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      },
      challengeRating: '0',
      proficiencyBonus: DEFAULT_PROFICIENCY_BONUS,
      savingThrows: [],
      skills: {},
      defenses: {
        vulnerabilities: [],
        resistances: [],
        immunities: [],
        conditionImmunities: [],
      },
      senses: '',
      languages: [],
      environments: [],
      customEnvironments: '',
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendary: { count: 0, actions: [] },
    };
  }

  const system: Record<string, unknown> = isRecord(creature.system)
    ? creature.system
    : {};

  // Размер приходит из компендиумов и легаси-миров в произвольном виде
  // (`'Medium'`, пусто, не строка) — приводим к канону здесь, чтобы дальше
  // по системе он был валиден: на нём завязан масштаб токена на сцене.
  system.size = normalizeCreatureSize(system.size);

  // Заполняем отсутствующие поля
  if (!isRecord(system.defenses)) {
    system.defenses = {
      vulnerabilities: [],
      resistances: [],
      immunities: [],
      conditionImmunities: [],
    };
  }

  // Коэрсия legacy-формата (текстовые поля старых миров → пустые структуры)
  const defenses: Record<string, unknown> = isRecord(system.defenses)
    ? system.defenses
    : {};

  if (!Array.isArray(defenses.vulnerabilities)) {
    defenses.vulnerabilities = [];
  }

  if (!Array.isArray(defenses.resistances)) {
    defenses.resistances = [];
  }

  if (!Array.isArray(defenses.immunities)) {
    defenses.immunities = [];
  }

  if (!Array.isArray(defenses.conditionImmunities)) {
    defenses.conditionImmunities = [];
  }

  // Бонус мастерства обязателен по типу записи, но у существ старых миров и
  // части паков его нет: без подстановки от него считались бы NaN
  if (typeof system.proficiencyBonus !== 'number') {
    system.proficiencyBonus = DEFAULT_PROFICIENCY_BONUS;
  }

  if (!Array.isArray(system.savingThrows)) {
    system.savingThrows = [];
  }

  if (!isRecord(system.skills)) {
    system.skills = {};
  }

  if (!Array.isArray(system.languages)) {
    system.languages = [];
  }

  if (!isRecord(system.legendary)) {
    system.legendary = { count: 0, actions: [] };
  }

  if (!Array.isArray(system.traits)) {
    system.traits = [];
  }

  if (!Array.isArray(system.actions)) {
    system.actions = [];
  }

  if (!Array.isArray(system.bonusActions)) {
    system.bonusActions = [];
  }

  if (!Array.isArray(system.reactions)) {
    system.reactions = [];
  }

  if (!Array.isArray(system.environments)) {
    system.environments = [];
  }

  if (typeof system.customEnvironments !== 'string') {
    system.customEnvironments = '';
  }

  // Нормализация movement: если отсутствует (legacy-существа) — дефолт 30 фт.
  if (!isRecord(system.movement)) {
    system.movement = {
      walk: 30,
      swim: 0,
      fly: 0,
      climb: 0,
      burrow: 0,
      hover: false,
      units: 'ft',
    };
  }

  // Удаляем legacy-поле speed (текстовый дубликат movement)
  delete system.speed;

  // Нормализация заклинаний существа: коэрсим в массив и приводим recovery
  // зарядов к каноническому union (алиас 'day' → 'longRest')
  if (!Array.isArray(raw.spells)) {
    raw.spells = [];
  }

  const spells: unknown[] = Array.isArray(raw.spells) ? raw.spells : [];

  for (const spell of spells) {
    if (isRecord(spell) && isRecord(spell.uses)) {
      spell.uses.recovery = normalizeSpellUsesRecovery(spell.uses.recovery);
    }
  }

  // Нормализация token: дефолты для существ — имя скрыто, ХП текстом
  if (!creature.token) {
    creature.token = {
      frameUrl: 'assets/token-frames/0.png',
      showName: false,
      hpDisplayMode: 'text',
      disposition: 'hostile',
    };
  } else {
    if (creature.token.showName === undefined) {
      creature.token.showName = false;
    }

    if (!creature.token.hpDisplayMode) {
      creature.token.hpDisplayMode = 'text';
    }

    if (!creature.token.disposition) {
      creature.token.disposition = 'hostile';
    }
  }
}

/**
 * Масштаб токена сущности с учётом её размера по правилам D&D.
 *
 * У существ из компендиума и персонажей, созданных до синхронизации размера,
 * масштаб не задан — выводим его из размера, иначе сохранение настроек токена
 * сбросило бы «Огромный» обратно в «Средний». Функция одна на все места
 * (начальные значения формы настроек и база сравнения «есть ли изменения»):
 * разойдись они — модалка открывалась бы уже «изменённой».
 *
 * Не путать с нейтральной `resolveTokenScale` хоста (`@/core/entityUtils`):
 * та разрешает масштаб размещённого на сцене токена и о размерах существ не
 * знает — её откат по умолчанию всегда `1`.
 *
 * @param entity - персонаж или существо сцены
 * @returns масштаб токена в клетках
 */
export function resolveCreatureTokenScale(entity: DnDSceneEntity): number {
  return (
    entity.token?.scale
    ?? CREATURE_SIZE_TO_TOKEN_SCALE[normalizeCreatureSize(entity.system.size)]
  );
}
