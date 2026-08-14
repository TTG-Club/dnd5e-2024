/**
 * Настройка навыков актёра D&D 5e.
 *
 * По правилам навык — модификатор своей характеристики плюс бонус мастерства
 * по уровню владения. Лист даёт поправить расчёт: катить проверку от другой
 * характеристики (Атлетика от Телосложения), добавить свои бонусы (перчатки
 * вора и подобное) и завести навык, которого в правилах нет вовсе.
 *
 * @module system/dnd/skills
 */

import type { AbilityType, ProficiencyLevel, SkillType } from '@vtt/shared';

import type { DnDCustomBonusContext } from './customBonuses.js';
import type {
  DnDCustomSkill,
  DnDSkillSetting,
  DnDSkillSettings,
} from './types.js';

import { isRecord } from '@vtt/shared';

import {
  getProficiencyContribution,
  isProficiencyLevel,
} from './calculations.js';
import {
  ABILITY_KEYS,
  ABILITY_LABELS,
  isAbilityType,
  isSkillType,
  SKILL_ABILITY_MAP,
} from './consts.js';
import {
  getCustomBonusesValue,
  parseCustomBonuses,
  toStoredCustomBonus,
} from './customBonuses.js';

/** Основа пассивного значения навыка: к ней прибавляется значение навыка */
export const PASSIVE_SKILL_BASE = 10;

/** Предел длины названия своего навыка: строка списка не должна разъезжаться */
export const CUSTOM_SKILL_NAME_MAX_LENGTH = 40;

/**
 * Сколько своих навыков разрешено завести. Предел не от правил, а от места:
 * список навыков листа и без того длинный, а десяток лишних строк панель ещё
 * выдерживает.
 */
export const CUSTOM_SKILLS_MAX = 10;

/** Характеристика нового своего навыка по умолчанию */
export const DEFAULT_CUSTOM_SKILL_ABILITY: AbilityType = 'intelligence';

/**
 * Следующий уровень владения навыком при переключении по кругу: нет →
 * половина → владение → компетенция → нет. Порядок один и в списке навыков
 * листа, и в окне настройки.
 */
export const SKILL_PROFICIENCY_NEXT: Record<
  ProficiencyLevel,
  ProficiencyLevel
> = {
  none: 'half',
  half: 'proficient',
  proficient: 'expertise',
  expertise: 'none',
};

/**
 * Ключ навыка для активных эффектов (`skill.stealth`). Тем же ключом эффект
 * перезаписывает итог навыка, поэтому строку собирает одна функция: лист
 * спрашивает про перезапись ровно теми ключами, какими её отмечает движок.
 *
 * @param skillKey - ключ навыка
 * @returns ключ поля для активных эффектов
 */
export function getSkillEffectKey(skillKey: SkillType): `skill.${SkillType}` {
  return `skill.${skillKey}`;
}

/** Навык по правилам: своя характеристика и без своих бонусов */
export const DEFAULT_SKILL_SETTING: DnDSkillSetting = {
  ability: null,
  bonuses: [],
};

/**
 * Настройка навыка из листа. Ключа нет — навык считается по правилам, и
 * вызывающему коду не приходится разбирать пустоту самому.
 *
 * @param settings - настройка навыков листа (может отсутствовать)
 * @param skillKey - ключ навыка
 * @returns настройка навыка
 */
export function getSkillSetting(
  settings: DnDSkillSettings | undefined,
  skillKey: SkillType,
): DnDSkillSetting {
  const setting = settings?.skills?.[skillKey];

  if (!setting) {
    return DEFAULT_SKILL_SETTING;
  }

  return {
    ability: setting.ability ?? null,
    bonuses: Array.isArray(setting.bonuses) ? setting.bonuses : [],
  };
}

/**
 * Характеристика, от которой навык считается на самом деле: из настройки, а
 * если её нет — по правилам.
 *
 * @param setting - настройка навыка
 * @param skillKey - ключ навыка
 * @returns характеристика расчёта
 */
export function getSkillSettingAbility(
  setting: DnDSkillSetting,
  skillKey: SkillType,
): AbilityType {
  return setting.ability ?? SKILL_ABILITY_MAP[skillKey];
}

/**
 * Навык отличается от правил: характеристика подменена или есть свои бонусы.
 * Уровень владения сюда не входит — его ставят и в самом списке навыков.
 *
 * @param setting - настройка навыка
 * @param skillKey - ключ навыка
 * @returns `true`, если навык считается не по правилам
 */
export function isChangedSkill(
  setting: DnDSkillSetting,
  skillKey: SkillType,
): boolean {
  return (
    (setting.ability !== null
      && setting.ability !== SKILL_ABILITY_MAP[skillKey])
    || setting.bonuses.length > 0
  );
}

/**
 * Значение своего навыка: модификатор характеристики, вклад владения и свои
 * бонусы. Активные эффекты своих навыков не касаются — ключа под них в
 * системе нет, целиться эффекту некуда.
 *
 * @param context - числа листа, от которых считаются свои бонусы
 * @param skill - свой навык
 * @returns значение навыка
 */
export function getCustomSkillValue(
  context: DnDCustomBonusContext,
  skill: DnDCustomSkill,
): number {
  return (
    (context.abilityMods[skill.ability] ?? 0)
    + getProficiencyContribution(context.proficiencyBonus, skill.proficiency)
    + getCustomBonusesValue(context, skill.bonuses)
  );
}

/** Ключ общей группы навыков: без группировки список идёт одной группой */
export const SKILL_GROUP_ALL_KEY = 'all';

/** Группа списка навыков: подпись разделителя и её строки */
export interface DnDSkillRowGroup<Row> {
  /** Ключ группы для списка */
  key: string;

  /** Характеристика группы; null — группировки нет */
  ability: AbilityType | null;

  /** Подпись разделителя; null — группировки нет, разделителя тоже */
  title: string | null;

  rows: Row[];
}

/**
 * Группы списка навыков. Без группировки список остаётся одной группой без
 * подписи — и панель листа, и окно настройки рисуют его одной и той же
 * разметкой, без второй ветки. С группировкой навыки идут в порядке
 * характеристик, а внутри группы — в исходном порядке (по алфавиту).
 * Характеристику навыку даёт только его собственная: свои бонусы от других
 * характеристик группу не задают. Характеристики без навыков пропускаются — у
 * Телосложения по правилам их нет вовсе.
 *
 * @param rows - записи навыков с характеристикой
 * @param groupByAbility - группировать ли навыки по характеристикам
 * @returns группы навыков для вывода
 */
export function getSkillRowGroups<Row extends { ability: AbilityType }>(
  rows: Row[],
  groupByAbility: boolean,
): Array<DnDSkillRowGroup<Row>> {
  if (!groupByAbility) {
    return [
      { key: SKILL_GROUP_ALL_KEY, ability: null, title: null, rows: [...rows] },
    ];
  }

  return ABILITY_KEYS.map((ability) => ({
    key: ability,
    ability,
    title: ABILITY_LABELS[ability],
    rows: rows.filter((row) => row.ability === ability),
  })).filter((group) => group.rows.length > 0);
}

/**
 * Приведение названия навыка к виду для сравнения: регистр, «ё» и лишние
 * пробелы не должны делать из одного навыка два.
 *
 * @param name - название навыка
 * @returns название для сравнения
 */
function normalizeSkillName(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

/**
 * Есть ли уже навык с таким названием. Сравнение нестрогое: «ловкость рук» и
 * «Ловкость  Рук» — один и тот же навык, а два одноимённых навыка сломали бы
 * список.
 *
 * @param names - названия навыков листа (правил и своих)
 * @param name - проверяемое название
 * @returns `true`, если навык с таким названием уже есть
 */
export function hasSkillName(names: string[], name: string): boolean {
  const key = normalizeSkillName(name);

  return names.some((existing) => normalizeSkillName(existing) === key);
}

/**
 * Свой навык из введённого названия: владения и своих бонусов у нового навыка
 * нет — их игрок задаёт в том же окне.
 *
 * @param id - идентификатор записи
 * @param name - название навыка
 * @param ability - характеристика навыка
 * @returns свой навык для настройки листа
 */
export function toCustomSkill(
  id: string,
  name: string,
  ability: AbilityType,
): DnDCustomSkill {
  return {
    id,
    name: name.trim(),
    ability,
    proficiency: 'none',
    bonuses: [],
  };
}

/**
 * Приведение настройки навыков к записи листа: навыки, вернувшиеся к правилам,
 * из записи выпадают целиком — лист не копит пустые настройки. Свои навыки без
 * названия отбрасываются: без него навык нельзя ни найти, ни назвать.
 *
 * @param settings - настройка из черновика окна
 * @returns настройка для записи в лист
 */
export function toStoredSkillSettings(
  settings: DnDSkillSettings,
): DnDSkillSettings {
  const skills: DnDSkillSettings['skills'] = {};

  for (const [skillKey, setting] of Object.entries(settings.skills)) {
    if (!setting || !isSkillType(skillKey)) {
      continue;
    }

    const stored: DnDSkillSetting = {
      ability:
        setting.ability === SKILL_ABILITY_MAP[skillKey]
          ? null
          : setting.ability,
      bonuses: setting.bonuses.map(toStoredCustomBonus),
    };

    if (isChangedSkill(stored, skillKey)) {
      skills[skillKey] = stored;
    }
  }

  const custom = settings.custom
    .map((skill) => ({
      ...skill,
      name: skill.name.trim(),
      bonuses: skill.bonuses.map(toStoredCustomBonus),
    }))
    .filter((skill) => skill.name.length > 0)
    .slice(0, CUSTOM_SKILLS_MAX);

  return { skills, custom, groupByAbility: settings.groupByAbility };
}

// ── Разбор записанных данных ──────────────────────────────────

/**
 * Разбирает настройку одного навыка.
 *
 * @param value - произвольное значение из записи актёра
 * @returns настройка навыка либо `undefined`, если её нет
 */
function parseSkillSetting(value: unknown): DnDSkillSetting | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return {
    ability: isAbilityType(value.ability) ? value.ability : null,
    bonuses: parseCustomBonuses(value.bonuses),
  };
}

/**
 * Разбирает свой навык: без идентификатора, названия и характеристики запись
 * бесполезна — такой навык отбрасывается целиком.
 *
 * @param value - произвольное значение из записи актёра
 * @returns свой навык либо `undefined`, если запись не разобрать
 */
function parseCustomSkill(value: unknown): DnDCustomSkill | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.id !== 'string'
    || typeof value.name !== 'string'
    || !isAbilityType(value.ability)
  ) {
    return undefined;
  }

  const proficiency: ProficiencyLevel = isProficiencyLevel(value.proficiency)
    ? value.proficiency
    : 'none';

  return {
    id: value.id,
    name: value.name,
    ability: value.ability,
    proficiency,
    bonuses: parseCustomBonuses(value.bonuses),
  };
}

/**
 * Разбирает настройку навыков из системных данных актёра.
 *
 * Данные читаются по месту, а не приводятся типом: поля нет у листов из старых
 * миров — ни у актёров, ни у существ.
 *
 * @param value - значение поля `skillSettings` системных данных
 * @returns настройка навыков либо `undefined`, если её нет
 */
export function parseSkillSettings(
  value: unknown,
): DnDSkillSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rawSkills = isRecord(value.skills) ? value.skills : {};
  const skills: DnDSkillSettings['skills'] = {};

  for (const [skillKey, rawSetting] of Object.entries(rawSkills)) {
    if (!isSkillType(skillKey)) {
      continue;
    }

    const setting = parseSkillSetting(rawSetting);

    if (setting) {
      skills[skillKey] = setting;
    }
  }

  const rawCustom = Array.isArray(value.custom) ? value.custom : [];

  const custom = rawCustom
    .map(parseCustomSkill)
    .filter((skill): skill is DnDCustomSkill => skill !== undefined);

  return {
    skills,
    custom,
    groupByAbility: value.groupByAbility === true,
  };
}
