/**
 * Типы данных системы Active Effects (D&D 5e)
 *
 * Система активных эффектов с формульным парсером,
 * числовыми модификаторами (changes) и булевыми флагами (flags).
 *
 * Используется в трёхфазном пайплайне:
 * prepareBaseData → applyActiveEffects → prepareDerivedData
 */

import type {
  AbilityType,
  AreaEffectTrigger,
  BaseActiveEffect,
  DamagePart,
  DefensibleDamageType,
  EffectAura,
  EffectDuration,
  EffectDurationType,
  EffectOrigin,
  EffectTurnAnchor,
  EffectTurnTiming,
  MovementType,
  SkillType,
  SpellSchool,
} from '@vtt/shared';

import type {
  ConditionKey,
  ConditionRef,
  DEATH_CONDITION_KEY,
} from './conditionKeys.js';
// `AreaEffectTrigger`, `BaseActiveEffect`, `EffectAura`, `EffectDuration`,
// `EffectDurationType`, `EffectTurnAnchor`, `EffectTurnTiming` — нейтральные
// контрактные типы эффекта (провенанс, длительность, аура, триггер области, база
// `BaseActiveEffect`): они живут в ядре системного контракта (`../contracts/*`),
// D&D наследует базу и реэкспортит формы для своих потребителей.
import type { CreatureCategory } from './creatureTypes.js';
import type { DnDCustomBonusContext } from './customBonuses.js';
import type { EffectCastRule } from './effectCastRuleTypes.js';
import type { EffectChangeStep } from './effectChangeSteps.js';
import type { EffectPaid, EffectPay } from './effectPayTypes.js';
import type {
  EffectActionCost,
  EffectAreaChoice,
  EffectTrigger,
} from './effectTriggerTypes.js';
import type { EffectVariantPick } from './effectVariants.js';

import { z } from 'zod';

import { isRecord, typedObjectEntries } from '@vtt/shared';

import {
  BLOODIED_CONDITION_KEY,
  INCAPACITATED_CONDITION_KEY,
} from './conditionKeys.js';
import {
  CONDITIONS,
  CREATURE_CATEGORIES,
  isAbilityType,
  isCreatureCategory,
  isSkillType,
  MOVEMENT_KEYS,
  MOVEMENT_LABELS,
  SELECTABLE_CONDITIONS,
  SKILLS_LABELS,
} from './consts.js';
import {
  DAMAGE_PART_TARGETS,
  DAMAGE_TYPE_LABELS,
  DAMAGE_TYPES,
} from './damageConstants.js';
import { EffectCastRuleSchema } from './effectCastRuleTypes.js';
import {
  EFFECT_CHANGE_STEP_PERIODS,
  MAX_EFFECT_CHANGE_STEP,
} from './effectChangeSteps.js';
import {
  EffectPaidSchema,
  EffectPaySchema,
  formulaTextSchema,
} from './effectPayTypes.js';
import {
  coerceOptionalNumber,
  SAVE_ABILITY_VALUES,
  SaveDcFormulaSchema,
} from './effectSchemaParts.js';
import {
  AREA_CHOICE_FALLBACKS,
  AREA_CHOICE_MODES,
  EFFECT_ACTION_COSTS,
  EFFECT_CAST_OWNERS,
  EFFECT_NOTIFY_TARGETS,
  EFFECT_RESTORE_KINDS,
  EFFECT_TAG_PATTERN,
  EFFECT_TEMP_HP_MODES,
  EFFECT_TRIGGER_ACTION_GATES,
  EFFECT_TRIGGER_AREA_SHIFT_KINDS,
  EFFECT_TRIGGER_AREA_TARGETS,
  EFFECT_TRIGGER_ATTACK_ROLES,
  EFFECT_TRIGGER_CHOOSERS,
  EFFECT_TRIGGER_EVENTS,
  EFFECT_TRIGGER_LIMIT_PERIODS,
  EFFECT_TRIGGER_MAX_HP_REST_ENDS,
  EFFECT_TRIGGER_MOVE_KINDS,
  EFFECT_TRIGGER_MOVE_ORIGINS,
  EFFECT_TRIGGER_RECIPIENTS,
  EFFECT_TRIGGER_RESERVED_EVENTS,
  EFFECT_TRIGGER_REST_TYPES,
  EFFECT_TRIGGER_SAVE_MODES,
  EFFECT_TRIGGER_TURN_OWNERS,
  MAX_AREA_CHOICE_FORMULA_LENGTH,
  MAX_NOTIFY_TEXT_LENGTH,
  MAX_TRIGGER_CHANCE_PERCENT,
  MAX_TRIGGER_CHOICE_COUNT,
  MAX_TRIGGER_MOVE_DISTANCE,
  MAX_TRIGGER_PATH_FEET,
  MIN_REVIVE_HP,
  MIN_TRIGGER_CHANCE_PERCENT,
  MIN_TRIGGER_CHOICE_COUNT,
  MIN_TRIGGER_LIMIT_MAX,
  MIN_TRIGGER_PATH_FEET,
} from './effectTriggerTypes.js';
import { EFFECT_VARIANT_PICKS } from './effectVariants.js';
import { buildStatusToken } from './formulaTokens.js';
import { parseEachValid } from './lenientParse.js';
import {
  SOURCE_DAMAGE_TYPE_CONDITION_PREFIX,
  SOURCE_SPELL_SCHOOL_CONDITION_PREFIX,
} from './saveSourceTraits.js';
import {
  CARRIER_SPECIES_CONDITION_PREFIX,
  CARRIER_SPECIES_NOT_CONDITION_PREFIX,
} from './speciesCondition.js';
import {
  MAX_SPELL_SLOT_LEVEL,
  MIN_SPELL_SLOT_LEVEL,
} from './spellSlotTable.js';
import { CANTRIP_SPELL_LEVEL, SPELL_SCHOOL_LABELS } from './spellTypes.js';

export type {
  AreaEffectTrigger,
  BaseActiveEffect,
  EffectAura,
  EffectDuration,
  EffectDurationType,
  EffectOrigin,
  EffectTurnAnchor,
  EffectTurnTiming,
};

// ── Режимы изменений ─────────────────────────────────────────

/**
 * Режим применения числового изменения.
 *
 * Определяет, как `value` взаимодействует с базовым значением актора.
 * Порядок применения зависит от `priority` в `EffectChange`.
 */
export type EffectChangeMode =
  'add' | 'multiply' | 'override' | 'upgrade' | 'downgrade' | 'custom';

/** Локализованные названия режимов (для UI) */
export const EFFECT_CHANGE_MODE_LABELS: Record<EffectChangeMode, string> = {
  add: 'Добавить',
  multiply: 'Умножить',
  override: 'Заменить',
  upgrade: 'Повысить до',
  downgrade: 'Понизить до',
  custom: 'Особое',
} as const;

// ── Чувства ───────────────────────────────────────────────────

/**
 * Чувство сущности с дальностью в футах.
 *
 * Тёмное зрение здесь наравне с остальными: у эффекта нет своего токена, и
 * задать он может только число — поднять ли по нему зрение токена, решает уже
 * лист (см. `actorSenses.ts`). Телепатия чувством в строгом смысле не является,
 * но задаётся так же — дальностью в футах — и показывается тем же бейджем.
 */
export type SenseType =
  'darkvision' | 'blindsight' | 'truesight' | 'tremorsense' | 'telepathy';

/** Все виды чувств — порядок задаёт и порядок пунктов в подсказках UI. */
const SENSE_TYPES: readonly SenseType[] = [
  'darkvision',
  'blindsight',
  'truesight',
  'tremorsense',
  'telepathy',
];

/** Множество видов чувств — для быстрой проверки хвоста ключа `sense.*`. */
const SENSE_TYPE_SET: ReadonlySet<string> = new Set(SENSE_TYPES);

/**
 * Type-guard: строка — известный вид чувства.
 *
 * Нужен при разборе ключа `sense.blindsight`: хвост приходит из записи мира, и
 * чужое слово не должно завести в статах поле, которого нет.
 *
 * @param value - хвост ключа эффекта
 * @returns `true`, если это известный вид чувства
 */
export function isSenseType(value: string): value is SenseType {
  return SENSE_TYPE_SET.has(value);
}

// ── Ключи числовых изменений ──────────────────────────────────

/**
 * Ключ прибавки ко всем проверкам характеристик — и к проверкам навыков: навык
 * проверяется той же характеристикой («Камень удачи», «Синаптический разряд»).
 */
export const ABILITY_CHECK_KEY = 'abilityCheck';

/**
 * Ключ прибавки к броскам атаки ПО НОСИТЕЛЮ: её получает атакующий («Защита от
 * клинков» — атакующий вычитает 1к4). Считается только при броске атаки.
 */
export const ATTACKS_AGAINST_KEY = 'attacksAgainst';

/**
 * Ключ прибавки только к спасброскам концентрации: обычные спасброски
 * Телосложения её не получают («Синаптический разряд»).
 */
export const CONCENTRATION_SAVE_KEY = 'save.concentration';

/** Ключ прибавки к спасброскам от смерти */
export const DEATH_SAVE_KEY = 'deathSave';

// ── Замены свойств оружия ─────────────────────────────────────

/**
 * Ключ замены кости урона оружия («Дубинка»: к8 вместо к6). Значение — кость
 * формулой, число и грань костей можно задать выражением по уровню:
 * `(1 + steps(@level, 17))к(8 + 2 * steps(@level, 5, 11) - 6 * steps(@level, 17))`.
 */
export const WEAPON_DAMAGE_DICE_KEY = 'weapon.damageDice';

/**
 * Ключ замены характеристики атаки и урона оружия. Значение — ключ
 * характеристики либо {@link WEAPON_SPELL_ABILITY_VALUE}.
 */
export const WEAPON_ATTACK_ABILITY_KEY = 'weapon.attackAbility';

/** Ключ замены типа урона оружия — ключ типа урона (`force`) */
export const WEAPON_DAMAGE_TYPE_KEY = 'weapon.damageType';

/**
 * Ключ «тип урона своих заклинаний — на выбор»: значение — ключ типа урона
 * (`psychic`). При касте заклинания с уроном носитель выбирает, оставить тип
 * заклинания или взять этот («Психические заклинания», «Арканный некроз»).
 * Значение — слово из списка, а не формула, и на листе у строки числа нет: её
 * читает каст (`spellDamageRetype.ts`).
 */
export const SPELL_DAMAGE_TYPE_KEY = 'spell.damageType';

/**
 * Значение «заклинательная характеристика наложившего». При сотворении оно
 * заменяется ключом характеристики: на листе заклинателя уже не спросить, каким
 * классом творили.
 */
export const WEAPON_SPELL_ABILITY_VALUE = 'spell';

/** Подпись значения {@link WEAPON_SPELL_ABILITY_VALUE} */
export const WEAPON_SPELL_ABILITY_LABEL = 'Заклинательная характеристика';

/** Тип урона «Дубинки» во втором варианте */
export const SHILLELAGH_DAMAGE_TYPE = 'force';

/** Ключи, которые заменяют свойства оружия, а не прибавляют число */
export type WeaponOverrideKey =
  | typeof WEAPON_DAMAGE_DICE_KEY
  | typeof WEAPON_ATTACK_ABILITY_KEY
  | typeof WEAPON_DAMAGE_TYPE_KEY;

const WEAPON_OVERRIDE_KEY_SET: ReadonlySet<string> = new Set([
  WEAPON_DAMAGE_DICE_KEY,
  WEAPON_ATTACK_ABILITY_KEY,
  WEAPON_DAMAGE_TYPE_KEY,
]);

/**
 * Заменяет ли ключ свойство оружия. Такие строки не числа: конвейер не считает
 * их формулой, а складывает в `weaponOverrides` статов.
 *
 * @param key - ключ изменения
 * @returns `true` для ключей `weapon.*`
 */
export function isWeaponOverrideKey(key: string): key is WeaponOverrideKey {
  return WEAPON_OVERRIDE_KEY_SET.has(key);
}

/**
 * Ключ прибавки к получаемым временным хитам: «+5 к получаемым временным
 * хитам». Считается при каждой выдаче (`healingLimits.withTempHpGainBonus`),
 * а не на листе.
 */
export const TEMP_HP_GAIN_KEY = 'tempHp.gain';

/**
 * Ключ прибавки к досягаемости рукопашных атак носителя, в футах: «увеличить
 * досягаемость этой атаки на 10 футов». Считается при проверке расстояния
 * атаки (`offSheetChanges.withMeleeReachBonus`), а не на листе; «на одну
 * атаку» задаёт срок эффекта или его снятие после броска атаки.
 */
export const ATTACK_REACH_KEY = 'attack.reach';

/**
 * Ключи строк, которых нет на листе: их читает не конвейер статов, а тот, кому
 * они нужны в свой момент — выдача временных хитов, проверка расстояния
 * атаки, каст заклинания.
 */
const OFF_SHEET_CHANGE_KEYS: ReadonlySet<string> = new Set([
  TEMP_HP_GAIN_KEY,
  ATTACK_REACH_KEY,
  SPELL_DAMAGE_TYPE_KEY,
]);

/**
 * Считается ли строка в момент события, а не на листе.
 *
 * @param key - ключ строки эффекта
 * @returns `true`, если конвейер статов строку пропускает
 */
export function isOffSheetChangeKey(key: string): boolean {
  return OFF_SHEET_CHANGE_KEYS.has(key);
}

/**
 * Задаётся ли значение строки словом из списка или костью, а не формулой:
 * замены свойств оружия и тип урона заклинаний.
 *
 * @param key - ключ строки эффекта
 * @returns `true`, если значение формулой не проверяют
 */
export function isOptionValueKey(key: string): boolean {
  return isWeaponOverrideKey(key) || key === SPELL_DAMAGE_TYPE_KEY;
}

/**
 * Типобезопасный ключ для числовых модификаций актора.
 *
 * В отличие от строковой dot-нотации,
 * использует типизированные template literal types для автокомплита и проверки.
 */
export type EffectTargetKey =
  | `ability.${AbilityType}`
  | `save.${AbilityType}`
  | typeof CONCENTRATION_SAVE_KEY
  | typeof DEATH_SAVE_KEY
  | `skill.${SkillType}`
  | typeof ABILITY_CHECK_KEY
  | typeof ATTACKS_AGAINST_KEY
  | 'attack.melee'
  | 'attack.ranged'
  | 'attack.spell'
  | 'damage.melee'
  | 'damage.ranged'
  | 'damage.spell'
  | 'armorClass'
  | `movement.${MovementType}`
  | 'hitPoints.max'
  | 'initiative'
  | 'proficiencyBonus'
  | 'spellSaveDC'
  | `sense.${SenseType}`
  | 'terrain.movementCost'
  | 'critThreshold'
  | 'damage.all'
  | 'damage.weapon'
  | 'attack.weapon'
  | WeaponOverrideKey
  | 'creatureType'
  | 'creatureType.extra'
  | typeof TEMP_HP_GAIN_KEY
  | typeof ATTACK_REACH_KEY
  | typeof SPELL_DAMAGE_TYPE_KEY;

/**
 * Ключ строки модификатора: известный ключ движка либо ПУСТАЯ строка — «ключ
 * ещё не выбран».
 *
 * Пустой ключ появляется, когда строку заводит готовый пункт меню, задающий
 * только условие: что именно менять, автор называет сам. На расчёт такая строка
 * не влияет — конвейер её пропускает.
 */
export type EffectChangeKey = EffectTargetKey | '';

/**
 * Популярные ключи для подсказок в UI при настройке эффекта
 */
export const EFFECT_TARGET_SUGGESTIONS: Array<{
  value: string;
  label: string;
}> = [
  // Базовые параметры
  { value: 'armorClass', label: 'Класс доспеха (AC)' },
  { value: 'initiative', label: 'Инициатива (Бонус)' },
  { value: 'proficiencyBonus', label: 'Бонус мастерства' },
  { value: 'spellSaveDC', label: 'Сложность спасброска от заклинаний' },
  { value: 'hitPoints.max', label: 'Макс. здоровье (HP)' },

  // Местность
  {
    value: 'terrain.movementCost',
    label: 'Труднопроходимость (цена клетки)',
  },

  // Тип существа: его читают гейты урона «только по нежити» и условия
  {
    value: TEMP_HP_GAIN_KEY,
    label: 'Прибавка к получаемым временным хитам',
  },
  {
    value: ATTACK_REACH_KEY,
    label: 'Досягаемость рукопашных атак, фт',
  },
  { value: 'creatureType', label: 'Тип существа' },
  {
    value: 'creatureType.extra',
    label: 'Тип существа: ещё один, в дополнение к своему',
  },

  // Критические попадания
  {
    value: 'critThreshold',
    label:
      'Порог крита атаками оружием (режим «Не больше»: 19 — крит на 19–20)',
  },

  // Скорости
  { value: 'movement.walk', label: 'Скорость (Ходьба)' },
  { value: 'movement.fly', label: 'Скорость (Полет)' },
  { value: 'movement.swim', label: 'Скорость (Плавание)' },
  { value: 'movement.climb', label: 'Скорость (Лазание)' },
  { value: 'movement.burrow', label: 'Скорость (Копание)' },

  // Чувства (дальность в футах)
  { value: 'sense.darkvision', label: 'Чувство: Тёмное зрение' },
  { value: 'sense.blindsight', label: 'Чувство: Слепое зрение' },
  { value: 'sense.truesight', label: 'Чувство: Истинное зрение' },
  { value: 'sense.tremorsense', label: 'Чувство: Чувство вибрации' },
  { value: 'sense.telepathy', label: 'Чувство: Телепатия' },

  // Характеристики (Скрытые/Явные)
  { value: 'ability.strength', label: 'Сила (Очки)' },
  { value: 'ability.dexterity', label: 'Ловкость (Очки)' },
  { value: 'ability.constitution', label: 'Телосложение (Очки)' },
  { value: 'ability.intelligence', label: 'Интеллект (Очки)' },
  { value: 'ability.wisdom', label: 'Мудрость (Очки)' },
  { value: 'ability.charisma', label: 'Харизма (Очки)' },

  // Спасброски
  { value: 'save.strength', label: 'Спасбросок (Сила)' },
  { value: 'save.dexterity', label: 'Спасбросок (Ловкость)' },
  { value: 'save.constitution', label: 'Спасбросок (Телосложение)' },
  { value: 'save.intelligence', label: 'Спасбросок (Интеллект)' },
  { value: 'save.wisdom', label: 'Спасбросок (Мудрость)' },
  { value: 'save.charisma', label: 'Спасбросок (Харизма)' },
  { value: CONCENTRATION_SAVE_KEY, label: 'Спасбросок концентрации' },
  { value: DEATH_SAVE_KEY, label: 'Спасбросок от смерти' },

  // Проверки
  {
    value: ABILITY_CHECK_KEY,
    label: 'Все проверки характеристик (и навыков)',
  },

  // Бонусы Атак
  { value: 'attack.melee', label: 'Атака: Рукопашное оружие' },
  { value: 'attack.ranged', label: 'Атака: Дальнобойное оружие' },
  { value: 'attack.spell', label: 'Атака: Заклинание' },
  {
    value: ATTACKS_AGAINST_KEY,
    label: 'Атаки по носителю: прибавка атакующему',
  },

  // Бонусы Урона
  { value: 'damage.melee', label: 'Урон: Рукопашное оружие' },
  { value: 'damage.ranged', label: 'Урон: Дальнобойное оружие' },
  { value: 'damage.spell', label: 'Урон: Заклинание' },
  { value: 'damage.all', label: 'Урон: Весь наносимый' },
  { value: 'damage.weapon', label: 'Урон: Только этим предметом' },
  { value: 'attack.weapon', label: 'Атака: Только этим предметом' },

  // Замены свойств оружия («Дубинка»)
  { value: WEAPON_DAMAGE_DICE_KEY, label: 'Оружие: кость урона' },
  { value: WEAPON_ATTACK_ABILITY_KEY, label: 'Оружие: характеристика атаки' },
  { value: WEAPON_DAMAGE_TYPE_KEY, label: 'Оружие: тип урона' },
  {
    value: SPELL_DAMAGE_TYPE_KEY,
    label: 'Заклинания: тип урона на выбор при касте',
  },

  // Навыки
  { value: 'skill.acrobatics', label: 'Навык (Акробатика)' },
  { value: 'skill.animalHandling', label: 'Навык (Уход за животными)' },
  { value: 'skill.arcana', label: 'Навык (Аркана)' },
  { value: 'skill.athletics', label: 'Навык (Атлетика)' },
  { value: 'skill.deception', label: 'Навык (Обман)' },
  { value: 'skill.history', label: 'Навык (История)' },
  { value: 'skill.insight', label: 'Навык (Проницательность)' },
  { value: 'skill.investigation', label: 'Навык (Анализ)' },
  { value: 'skill.intimidation', label: 'Навык (Запугивание)' },
  { value: 'skill.medicine', label: 'Навык (Медицина)' },
  { value: 'skill.nature', label: 'Навык (Природа)' },
  { value: 'skill.perception', label: 'Навык (Внимательность)' },
  { value: 'skill.performance', label: 'Навык (Выступление)' },
  { value: 'skill.persuasion', label: 'Навык (Убеждение)' },
  { value: 'skill.religion', label: 'Навык (Религия)' },
  { value: 'skill.sleightOfHand', label: 'Навык (Ловкость рук)' },
  { value: 'skill.stealth', label: 'Навык (Скрытность)' },
  { value: 'skill.survival', label: 'Навык (Выживание)' },
];

/** Множество известных ключей изменения — для быстрой проверки строки */
const EFFECT_TARGET_KEY_SET: ReadonlySet<string> = new Set(
  EFFECT_TARGET_SUGGESTIONS.map((suggestion) => suggestion.value),
);

/**
 * Проверяет, что строка — известный ключ изменения эффекта.
 *
 * Нужна на границе с UI: подборщик ключей отдаёт строку, а `EffectChange.key`
 * типизирован. Список тот же, что показывается пользователю, — так проверка и
 * подсказки не расходятся.
 *
 * @param value - произвольная строка ключа
 * @returns `true`, если такой ключ известен движку
 */
export function isEffectTargetKey(value: string): value is EffectTargetKey {
  return EFFECT_TARGET_KEY_SET.has(value);
}

/**
 * Шаблоны логических условий для эффектов (поле `condition`).
 *
 * Список закрыт и содержит РОВНО те условия, которые движок умеет вычислять:
 * `evaluateCondition` (броски, состояние хитов цели, тип носителя и тип цели) и
 * `evaluateDefensiveCondition` (вид входящей атаки, только для ключа
 * `armorClass`) в `effectPipeline`. Неизвестное условие движок молча не
 * применяет, поэтому предлагать здесь непонятые строки нельзя — эффект
 * выглядел бы настроенным и не работал.
 *
 * Условия «Носитель: …» отличаются от прочих временем счёта: тип носителя
 * известен на листе, поэтому они работают и для постоянных значений — скорости,
 * класса доспеха, максимума хитов. Остальные условия оцениваются только в момент
 * броска и на числа листа не влияют.
 */
// ── Строение строк условий ────────────────────────────────────

/** Приставка условия по типу НОСИТЕЛЯ эффекта. */
export const CARRIER_TYPE_CONDITION_PREFIX = 'self.creatureType === ';

/** Приставка условия по надетому доспеху НОСИТЕЛЯ. */
export const CARRIER_ARMOR_CONDITION_PREFIX = 'self.armor === ';

/**
 * Приставка условия «атака идёт этой характеристикой». Общая для модификаторов
 * («Ярость»: бонус урона только атакам Силой) и срабатываний.
 */
export const ATTACK_ABILITY_CONDITION_PREFIX = 'attack.ability === ';

/**
 * Приставка условия «оружие этого вида» — для замен свойств оружия
 * (`weapon.*`). В кавычках список ключей вида через запятую, подходит любой:
 * `weapon.baseType === "club, quarterstaff"`. Список, а не `||`: словарь
 * условий остаётся перечнем без разбора выражений.
 */
export const WEAPON_BASE_TYPE_CONDITION_PREFIX = 'weapon.baseType === ';

/** Разделитель видов оружия внутри условия {@link WEAPON_BASE_TYPE_CONDITION_PREFIX} */
const WEAPON_BASE_TYPE_SEPARATOR = ',';

/**
 * Виды оружия, названные условием `weapon.baseType === "club, quarterstaff"`.
 *
 * @param condition - часть условия
 * @returns ключи видов либо `undefined`, если часть из другого семейства
 */
export function parseWeaponBaseTypeCondition(
  condition: string,
): string[] | undefined {
  const trimmed = condition.trim();

  if (!trimmed.startsWith(WEAPON_BASE_TYPE_CONDITION_PREFIX)) {
    return undefined;
  }

  const baseTypes = trimmed
    .slice(WEAPON_BASE_TYPE_CONDITION_PREFIX.length)
    .trim()
    .replace(/^["']|["']$/g, '')
    .split(WEAPON_BASE_TYPE_SEPARATOR)
    .map((baseType) => baseType.trim())
    .filter((baseType) => baseType.length > 0);

  return baseTypes.length > 0 ? baseTypes : undefined;
}

/** Условие «Дубинки»: дубинка или боевой посох */
export const SHILLELAGH_WEAPON_CONDITION = `${WEAPON_BASE_TYPE_CONDITION_PREFIX}"club, quarterstaff"`;

/** Приставка условия по типу ЦЕЛИ броска. */
export const TARGET_TYPE_CONDITION_PREFIX = 'target.creatureType === ';

/** Приставка условия «носитель не этого типа» (список — `creatureTypeCondition.ts`) */
export const CARRIER_TYPE_NOT_CONDITION_PREFIX = 'self.creatureType !== ';

/** Приставка условия «цель не этого типа» */
export const TARGET_TYPE_NOT_CONDITION_PREFIX = 'target.creatureType !== ';

/** Приставка условия по типу АТАКУЮЩЕГО — у защитного эффекта. */
export const INCOMING_ATTACKER_TYPE_CONDITION_PREFIX =
  'incoming.attackerCreatureType === ';

/**
 * Условие «цель броска — тот, кто наложил этот эффект»: «помеха на броски
 * атаки против вас» у эффекта на противнике.
 */
export const TARGET_IS_SOURCE_CONDITION = 'target.isSource === true';

/**
 * Условие «цель броска — НЕ тот, кто наложил этот эффект»: «помеха атакам по
 * целям, отличным от вас» («Непристойный жест», «Угрожающее присутствие»).
 */
export const TARGET_NOT_SOURCE_CONDITION = 'target.isSource === false';

/**
 * Условие защитного эффекта «атакует тот, кто наложил этот эффект».
 */
export const INCOMING_ATTACKER_IS_SOURCE_CONDITION =
  'incoming.attackerIsSource === true';

/**
 * Условие защитного эффекта «атакует НЕ тот, кто наложил этот эффект»:
 * «преимущество на атаки по цели для всех, кроме вас».
 */
export const INCOMING_ATTACKER_NOT_SOURCE_CONDITION =
  'incoming.attackerIsSource === false';

/**
 * Условие «рядом с целью мой дееспособный союзник» («Тактика стаи» PHB 2024:
 * союзник в 5 фт от цели без состояния «Недееспособный»).
 */
export const TARGET_ALLY_ADJACENT_CONDITION = 'target.allyAdjacent';

/** Условие «рядом с целью мой союзник в любом состоянии» */
export const TARGET_ANY_ALLY_ADJACENT_CONDITION = 'target.allyAdjacentAny';

/** Приставка условия «рядом с целью мой союзник в состоянии …» */
export const TARGET_ALLY_WITH_CONDITION_PREFIX = 'target.allyAdjacentWith === ';

/** Приставка условия «рядом с целью мой союзник не в состоянии …» */
export const TARGET_ALLY_WITHOUT_CONDITION_PREFIX =
  'target.allyAdjacentWithout === ';

/**
 * Какой союзник нужен рядом с целью: подписи без общей части «Цель: рядом с
 * ней мой союзник». Окно показывает их вторым полем, словарь условий — целиком.
 */
export const ADJACENT_ALLY_CONDITION_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
}> = [
  {
    value: TARGET_ALLY_ADJACENT_CONDITION,
    label: 'дееспособный (Тактика стаи)',
  },
  { value: TARGET_ANY_ALLY_ADJACENT_CONDITION, label: 'в любом состоянии' },
  ...SELECTABLE_CONDITIONS.map((condition) => ({
    value: `${TARGET_ALLY_WITH_CONDITION_PREFIX}"${condition.key}"`,
    label: `в состоянии «${condition.nameRu}»`,
  })),
  ...SELECTABLE_CONDITIONS.map((condition) => ({
    value: `${TARGET_ALLY_WITHOUT_CONDITION_PREFIX}"${condition.key}"`,
    label: `не в состоянии «${condition.nameRu}»`,
  })),
];

/** Общая часть подписи условий «союзник рядом с целью» */
export const ADJACENT_ALLY_CONDITION_LABEL = 'Цель: рядом с ней мой союзник';

/**
 * Условие ли это о союзнике рядом с целью.
 *
 * @param condition - строка условия
 * @returns `true` для условий семейства «союзник рядом»
 */
export function isAdjacentAllyCondition(condition: string): boolean {
  const trimmed = condition.trim();

  return (
    trimmed === TARGET_ALLY_ADJACENT_CONDITION
    || trimmed === TARGET_ANY_ALLY_ADJACENT_CONDITION
    || trimmed.startsWith(TARGET_ALLY_WITH_CONDITION_PREFIX)
    || trimmed.startsWith(TARGET_ALLY_WITHOUT_CONDITION_PREFIX)
  );
}

/**
 * Разделитель условий, соединённых «и»: `self.armor === "none" && ...`.
 *
 * Это НЕ выражение и не шаг к нему: каждая часть по-прежнему обязана быть
 * строкой из закрытого словаря, а `&&` только позволяет требовать нескольких
 * условий разом — «нет доспеха И нет щита» у наручей защиты. Другой связки
 * (`||`, отрицания, скобок) намеренно нет: разбирать их пришлось бы парсером,
 * а словарь должен оставаться перечнем.
 */
export const CONDITION_AND_SEPARATOR = '&&';

/**
 * Части составного условия.
 *
 * Одиночное условие — тоже список, из одного элемента: так весь дальнейший
 * разбор работает единообразно, без ветки «а если разделителя нет».
 *
 * @param condition - строка условия
 * @returns непустые части, каждая обрезана по краям
 */
export function splitConditionParts(condition: string): string[] {
  return condition
    .split(CONDITION_AND_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Разделы библиотеки условий — в порядке показа */
export const EFFECT_CONDITION_SECTIONS = {
  roll: 'Бросок и атака',
  armor: 'Доспех носителя',
  targetHp: 'Хиты цели',
  targetMark: 'Метка цели',
  effectSource: 'Наложивший эффект',
  adjacentAlly: 'Союзник рядом с целью',
  defense: 'Защита: входящая атака',
  saveSource: 'Источник спасброска',
  carrierSpecies: 'Вид носителя',
  carrierType: 'Тип носителя',
  targetType: 'Тип цели',
} as const;

/** Пояснение к условиям, которые считаются по листу, без броска */
const SHEET_CONDITION_HINT =
  'Считается по листу: прибавка входит в постоянные числа (КД, скорость).';

/** Пояснение к условиям броска: на числа листа они не влияют */
const ROLL_CONDITION_HINT =
  'Проверяется в момент броска; в числа листа строка не входит.';

/**
 * Подсказки условия строки: ровно те условия, которые движок умеет
 * вычислить (см. описание словаря выше), — по разделам библиотеки.
 */
export const EFFECT_CONDITION_SUGGESTIONS: readonly EffectLibrarySuggestion[] =
  [
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.roll,
      [
        {
          value: 'roll.hasAdvantage === true',
          label: 'Бросок: уже идёт с преимуществом',
        },
        {
          value: 'roll.hasDisadvantage === true',
          label: 'Бросок: уже идёт с помехой',
        },
        // Бонус урона оружия считается по характеристике, которой оно бьёт:
        // на листе он виден у каждого оружия своим, а в бросок идёт из того же
        // счёта
        {
          value: `${ATTACK_ABILITY_CONDITION_PREFIX}"strength"`,
          label: 'Атака: Силой (урон оружия)',
          hint: 'Урон Ярости: только удары Силой.',
        },
        {
          value: `${ATTACK_ABILITY_CONDITION_PREFIX}"dexterity"`,
          label: 'Атака: Ловкостью (урон оружия)',
        },
        // Только для замен свойств оружия (`weapon.*`): каждое оружие листа
        // сверяется со списком само
        {
          value: SHILLELAGH_WEAPON_CONDITION,
          label: 'Оружие: дубинка или боевой посох (Дубинка)',
          hint: 'Для замен «Оружие: …». Виды — ключами через запятую в кавычках.',
        },
      ],
      ROLL_CONDITION_HINT,
    ),

    // Считаются по самому листу, без броска: прибавка с таким условием
    // попадает в постоянные числа (КД «Обороны» видно в блоке защиты, а не
    // только в бою)
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.armor,
      [
        { value: 'self.armor === "any"', label: 'Носитель: в доспехе (любом)' },
        { value: 'self.armor === "none"', label: 'Носитель: без доспеха' },
        {
          value: 'self.armor === "light"',
          label: 'Носитель: в лёгком доспехе',
        },
        {
          value: 'self.armor === "medium"',
          label: 'Носитель: в среднем доспехе',
        },
        {
          value: 'self.armor === "heavy"',
          label: 'Носитель: в тяжёлом доспехе',
        },
        { value: 'self.armor === "shield"', label: 'Носитель: со щитом' },
        { value: 'self.armor === "noShield"', label: 'Носитель: без щита' },
        {
          value: `${CARRIER_ARMOR_CONDITION_PREFIX}"none" ${CONDITION_AND_SEPARATOR} ${CARRIER_ARMOR_CONDITION_PREFIX}"noShield"`,
          label: 'Носитель: без доспеха и без щита',
          hint:
            `Условия соединяются «${CONDITION_AND_SEPARATOR}» — нужны все сразу. `
            + '«Или» и отрицаний нет.',
        },
      ],
      SHEET_CONDITION_HINT,
    ),

    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.targetHp,
      [
        {
          value: 'target.hp.value === target.hp.max',
          label: 'Цель: с полными хитами (Убийца)',
        },
        {
          value: 'target.hp.value < target.hp.max',
          label: 'Цель: ранена (неполные хиты)',
        },
        {
          value: 'target.hp.value <= (target.hp.max / 2)',
          label: 'Цель: не больше половины хитов (Окровавлен)',
        },
      ],
      ROLL_CONDITION_HINT,
    ),

    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.targetMark,
      [
        {
          value: 'target.markedBySelf',
          label: 'Цель помечена мной (Метка охотника, Сглаз)',
        },
      ],
      ROLL_CONDITION_HINT,
    ),

    // Эффект лежит на противнике, а условие — о том, кто его наложил
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.effectSource,
      [
        {
          value: TARGET_IS_SOURCE_CONDITION,
          label: 'Цель — тот, кто наложил этот эффект («помеха атакам по вам»)',
        },
        {
          value: TARGET_NOT_SOURCE_CONDITION,
          label:
            'Цель — не тот, кто наложил этот эффект («помеха атакам не по вам»)',
        },
      ],
      ROLL_CONDITION_HINT,
    ),

    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.adjacentAlly,
      ADJACENT_ALLY_CONDITION_OPTIONS.map((option) => ({
        value: option.value,
        label: `${ADJACENT_ALLY_CONDITION_LABEL} — ${option.label}`,
      })),
      ROLL_CONDITION_HINT,
    ),

    // Входящая атака: КД, «Атаки по носителю» и условие броска эффекта
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.defense,
      [
        {
          value: 'incoming.attackType === "melee"',
          label: 'Защита: от рукопашных атак',
        },
        {
          value: 'incoming.attackType === "ranged"',
          label: 'Защита: от дальнобойных атак',
        },
        {
          value: 'incoming.attackType === "spell"',
          label: 'Защита: от атак заклинаниями',
        },
        {
          value: INCOMING_ATTACKER_IS_SOURCE_CONDITION,
          label: 'Защита: атакует тот, кто наложил этот эффект',
        },
        {
          value: INCOMING_ATTACKER_NOT_SOURCE_CONDITION,
          label:
            'Защита: атакует не тот, кто наложил этот эффект («все, кроме вас»)',
        },
        ...typedObjectEntries(CREATURE_CATEGORIES).map(
          ([creatureType, label]) => ({
            value: `${INCOMING_ATTACKER_TYPE_CONDITION_PREFIX}"${creatureType}"`,
            label: `Защита: атакующий — ${label}`,
          }),
        ),
      ],
      'Для КД и «Атак по носителю»: проверяется, когда атакуют носителя.',
    ),

    // Образцы: школу и типы урона автор вписывает свои, список — через запятую
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.saveSource,
      [
        {
          value: `${SOURCE_SPELL_SCHOOL_CONDITION_PREFIX}"divination"`,
          label:
            'Спасбросок: от заклинания школы… (ключ школы; список через запятую)',
        },
        {
          value: `${SOURCE_DAMAGE_TYPE_CONDITION_PREFIX}"fire, radiant"`,
          label:
            'Спасбросок: от источника с уроном типа… (ключи типов через запятую)',
        },
      ],
      ROLL_CONDITION_HINT,
    ),

    // Вид персонажа или подтип статблока — свободным названием, список через
    // запятую. Образцы: название автор вписывает своё
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.carrierSpecies,
      [
        {
          value: `${CARRIER_SPECIES_CONDITION_PREFIX}"эльф"`,
          label:
            'Носитель: вида… (впишите вид или подтип; список через запятую)',
        },
        {
          value: `${CARRIER_SPECIES_NOT_CONDITION_PREFIX}"дварф, дуэргар"`,
          label: 'Носитель: не вида… («Пояс дварфов»: не дварф и не дуэргар)',
        },
      ],
      SHEET_CONDITION_HINT,
    ),

    // Собираются по справочнику, а не переписаны руками: список типов один
    // на всю систему, и вручную повторённый разошёлся бы с ним при первой же
    // правке
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.carrierType,
      typedObjectEntries(CREATURE_CATEGORIES).map(([creatureType, label]) => ({
        value: `${CARRIER_TYPE_CONDITION_PREFIX}"${creatureType}"`,
        label: `Носитель: ${label}`,
      })),
      SHEET_CONDITION_HINT,
    ),
    ...inLibrarySection(
      EFFECT_CONDITION_SECTIONS.targetType,
      typedObjectEntries(CREATURE_CATEGORIES).map(([creatureType, label]) => ({
        value: `${TARGET_TYPE_CONDITION_PREFIX}"${creatureType}"`,
        label: `Цель: ${label}`,
      })),
      ROLL_CONDITION_HINT,
    ),
  ];

/**
 * Строка библиотеки подсказок формы эффекта: значение, условие или ключ.
 *
 * Раздел и пояснение нужны автору, который придумывает эффект сам: по одному
 * названию `@castLevel` не понять, что он живёт только у заклинаний, а
 * `steps(…)` без примера не найти вовсе.
 */
export interface EffectLibrarySuggestion {
  /** Что подставится в поле */
  value: string;
  /** Название строки */
  label: string;
  /** Раздел библиотеки — подпись, по которой строки собираются вместе */
  section: string;
  /** Где работает и как дописать под себя; нет — хватает названия */
  hint?: string;
}

/** Строка раздела до того, как ей назначен раздел */
type SectionEntry = Omit<EffectLibrarySuggestion, 'section'>;

/**
 * Проставляет раздел строкам одного раздела — чтобы не повторять его в
 * каждой строке списка.
 *
 * @param section - подпись раздела
 * @param entries - строки раздела
 * @param sharedHint - пояснение для строк, у которых своего нет
 * @returns строки библиотеки
 */
function inLibrarySection(
  section: string,
  entries: readonly SectionEntry[],
  sharedHint?: string,
): EffectLibrarySuggestion[] {
  return entries.map((entry) => {
    const hint = entry.hint ?? sharedHint;

    return hint ? { ...entry, section, hint } : { ...entry, section };
  });
}

/**
 * Урон Ярости PHB 2024: +2, с 9-го уровня варвара +3, с 16-го +4. Общий для
 * библиотеки значений и меню «Готовые» — пример ступеней `steps(…)`.
 */
export const RAGE_DAMAGE_BONUS_FORMULA = '2 + steps(@classLevel, 9, 16)';

/** Разделы библиотеки значений — в порядке показа */
export const EFFECT_VALUE_SECTIONS = {
  sheet: 'Числа листа',
  scaling: 'Рост по уровню и функции',
  dice: 'Кости',
  speeds: 'Скорости листа',
  damageType: 'Урон: тип',
  damageGate: 'Урон: только если…',
  healing: 'Лечение',
  spell: 'Заклинание и эффект',
} as const;

/** Пояснение к токенам-гейтам урона: гасят своё слагаемое */
const DAMAGE_GATE_HINT =
  'Только в уроне. Гасит своё слагаемое: в «1к8 + 2к6@…» 2к6 добавятся, '
  + 'только если условие выполнено.';

/**
 * Типы урона библиотеки значений. Названия — как в справочнике
 * `damage-types.json` и на сайте: «Огонь» рядом с «Огненный» читался бы
 * другим типом.
 */
const VALUE_DAMAGE_TYPES: ReadonlyArray<{
  damageType: DefensibleDamageType;
  label: string;
}> = [
  { damageType: 'fire', label: 'Огненный' },
  { damageType: 'cold', label: 'Холодный' },
  { damageType: 'lightning', label: 'Электрический' },
  { damageType: 'thunder', label: 'Звуковой' },
  { damageType: 'acid', label: 'Кислотный' },
  { damageType: 'poison', label: 'Ядовитый' },
  { damageType: 'necrotic', label: 'Некротический' },
  { damageType: 'radiant', label: 'Излучение' },
  { damageType: 'force', label: 'Силовое поле' },
  { damageType: 'psychic', label: 'Психический' },
  { damageType: 'bludgeoning', label: 'Дробящий' },
  { damageType: 'piercing', label: 'Колющий' },
  { damageType: 'slashing', label: 'Рубящий' },
];

/**
 * Подсказки значения модификатора — всё, что понимает формула движка:
 * переменные листа, функции, кости, токены урона и лечения.
 *
 * Каждая строка обязана проходить проверку поля значения хотя бы у одного
 * ключа: пример, который форма подсветит ошибкой, хуже отсутствия примера.
 */
export const EFFECT_VALUE_SUGGESTIONS: readonly EffectLibrarySuggestion[] = [
  ...inLibrarySection(EFFECT_VALUE_SECTIONS.sheet, [
    { value: '@mod.str', label: 'Модификатор Силы' },
    { value: '@mod.dex', label: 'Модификатор Ловкости' },
    { value: '@mod.con', label: 'Модификатор Телосложения' },
    { value: '@mod.int', label: 'Модификатор Интеллекта' },
    { value: '@mod.wis', label: 'Модификатор Мудрости' },
    { value: '@mod.cha', label: 'Модификатор Харизмы' },
    {
      value: '@str',
      label: 'Значение характеристики (@str, @dex, @con, @int, @wis, @cha)',
      hint: 'Само значение (16), а не модификатор (+3).',
    },
    { value: '@prof', label: 'Бонус мастерства' },
    { value: '@level', label: 'Общий уровень персонажа' },
    {
      value: '@classLevel',
      label: 'Уровень в классе умения',
      hint:
        'У умения класса — уровень в этом классе: у мультиклассера он меньше '
        + 'общего. У своего эффекта — общий уровень.',
    },
  ]),

  ...inLibrarySection(EFFECT_VALUE_SECTIONS.scaling, [
    {
      value: RAGE_DAMAGE_BONUS_FORMULA,
      label: 'Ступени: +2, с 9-го уровня +3, с 16-го +4 (урон Ярости)',
      hint:
        'steps(значение, порог1, порог2, …) — сколько порогов значение уже '
        + 'прошло. Пороги — по возрастанию.',
    },
    {
      value: 'floor(@level / 2)',
      label: 'Половина уровня, округление вниз',
      hint: 'floor — вниз, ceil — вверх. Деление без них даёт дробь.',
    },
    { value: 'ceil(@level / 2)', label: 'Половина уровня, округление вверх' },
    {
      value: 'max(1, @mod.cha)',
      label: 'Не меньше 1: модификатор Харизмы, минимум 1',
      hint: 'max(a, b) — большее из чисел, min(a, b) — меньшее.',
    },
    { value: 'min(@level, 10)', label: 'Не больше 10: уровень, но не выше' },
    {
      value: '@prof * 2',
      label: 'Арифметика: удвоенный бонус мастерства',
      hint: 'Можно + − * / и скобки: «(@level + 1) / 2».',
    },
    { value: 'abs(@mod.str)', label: 'Число без знака (модуль)' },
  ]),

  // Вычитается кость той же строкой со знаком минус — отдельной подсказки
  // «−1к4» нет, это было бы то же самое
  ...inLibrarySection(EFFECT_VALUE_SECTIONS.dice, [
    {
      value: '1к4',
      label: 'Кость к броску',
      hint:
        'Бросается заново в каждой атаке, спасброске, проверке или уроне. '
        + 'В числах листа (КД, скорость) кости не работают. Режим — '
        + '«Добавить» или «Вычесть».',
    },
    {
      value: '2к6',
      label: 'Дополнительный урон костями',
      hint:
        'Урон без типа получает тип оружия или заклинания. Свой тип — в '
        + `разделе «${EFFECT_VALUE_SECTIONS.damageType}».`,
    },
  ]),

  // Ими задаётся «полёт равен скорости ходьбы»
  ...inLibrarySection(
    EFFECT_VALUE_SECTIONS.speeds,
    MOVEMENT_KEYS.map((movementType) => ({
      value: `@speed.${movementType}`,
      label: `Скорость: ${MOVEMENT_LABELS[movementType]}`,
    })),
    'Режим «Не меньше» у другой скорости: «полёт равен ходьбе».',
  ),

  ...inLibrarySection(
    EFFECT_VALUE_SECTIONS.damageType,
    [
      ...VALUE_DAMAGE_TYPES.map(({ damageType, label }) => ({
        value: `1к6@dmg.${damageType}`,
        label,
      })),
      // Один тип из списка: несколько `@dmg.<тип>` подряд — урон всеми сразу
      {
        value: '1к6@dmg.choice(fire,cold)',
        label: 'Тип на выбор бросающего',
        hint: 'Варианты через запятую; перед броском спросят, какой.',
      },
      {
        value: '1к6@dmg.random(fire,cold)',
        label: 'Тип случайно из списка',
        hint: 'Шансы равные; выпавший тип попадёт в чат.',
      },
      {
        value: '1к6@dmg.fire + 1к6@dmg.cold',
        label: 'Два типа сразу',
        hint: 'Каждое слагаемое — своим типом.',
      },
    ],
    'Тип пишется после кости: «2к6@dmg.fire». Кость меняйте под себя.',
  ),

  ...inLibrarySection(
    EFFECT_VALUE_SECTIONS.damageGate,
    [
      { value: '1к6@target.full', label: 'Цель с полными хитами' },
      { value: '1к6@target.notFull', label: 'Цель ранена' },
      {
        value: '1к6@target.type.undead',
        label: 'Цель — существо типа (здесь нежить)',
        hint: `${DAMAGE_GATE_HINT} Тип — ключом: undead, fiend, dragon…`,
      },
      {
        value: `1к6${buildStatusToken('target', 'prone')}`,
        label: 'Цель в состоянии (здесь Ничком)',
        hint: `${DAMAGE_GATE_HINT} Состояние — ключом: prone, restrained…`,
      },
      {
        value: `1к6${buildStatusToken('self', BLOODIED_CONDITION_KEY)}`,
        label: 'Бросающий в состоянии (здесь Окровавлен)',
      },
    ],
    DAMAGE_GATE_HINT,
  ),

  ...inLibrarySection(EFFECT_VALUE_SECTIONS.healing, [
    {
      value: '1к8@heal',
      label: 'Лечение',
      hint: 'Восстанавливает хиты вместо урона.',
    },
    {
      value: '1к8@heal.temp',
      label: 'Временные хиты',
      hint: 'С имеющимися не складываются — остаётся большее.',
    },
  ]),

  ...inLibrarySection(EFFECT_VALUE_SECTIONS.spell, [
    {
      value: '@mod.spell',
      label: 'Модификатор заклинательной характеристики',
      hint: 'Только у эффекта заклинания.',
    },
    {
      value: '(@castLevel)к10',
      label: 'Круг ячейки: костей столько, каков круг (Лунный луч)',
      hint:
        '@castLevel — круг, которым сотворили. Только у эффекта заклинания: '
        + 'число подставляется при касте.',
    },
    {
      value: '5 * (@castLevel - 1)',
      label: 'Круг ячейки: прибавка за каждый круг выше 1-го (Подмога)',
    },
    {
      value: '@roll',
      label: 'Сохранённый бросок',
      hint:
        'Число из поля «Сохранённый бросок»: кость бросается один раз, когда '
        + 'эффект ложится, и дальше не меняется.',
    },
  ]),
];

// ── Ключи булевых флагов ──────────────────────────────────────

/** Флаг сопротивления конкретному типу урона (урон уменьшается вдвое) */
export type DamageResistanceFlagKey = `resistance.${DefensibleDamageType}`;

/** Флаг иммунитета к конкретному типу урона (урон игнорируется) */
export type DamageImmunityFlagKey = `immunity.${DefensibleDamageType}`;

/** Флаг уязвимости к конкретному типу урона (урон удваивается) */
export type DamageVulnerabilityFlagKey =
  `vulnerability.${DefensibleDamageType}`;

/**
 * Все флаги защит от урона по типам (сопротивление/иммунитет/уязвимость).
 * Генерируются по списку `DEFENSIBLE_DAMAGE_TYPES`.
 */
export type DamageDefenseFlagKey =
  DamageResistanceFlagKey | DamageImmunityFlagKey | DamageVulnerabilityFlagKey;

/** Флаг преимущества на проверки конкретного навыка */
export type SkillAdvantageFlagKey = `skill.${SkillType}.advantage`;

/** Флаг помехи на проверки конкретного навыка */
export type SkillDisadvantageFlagKey = `skill.${SkillType}.disadvantage`;

/**
 * Все понавыковые флаги. Генерируются по списку навыков: преимущество на
 * Скрытность и помеха на Скрытность — один и тот же род данных, и держать
 * второй перечислением значило бы дописывать союз при каждом новом предмете.
 */
export type SkillFlagKey = SkillAdvantageFlagKey | SkillDisadvantageFlagKey;

/**
 * Состояние, против которого бывает преимущество или помеха на спасбросок.
 *
 * Метка смерти и окровавленность сюда не идут: спасброска против них не
 * бывает — их ставит и снимает запас хитов существа.
 */
export type SaveConditionKey = Exclude<
  ConditionKey,
  typeof DEATH_CONDITION_KEY | typeof BLOODIED_CONDITION_KEY
>;

/** Флаг преимущества на спасбросок против состояния. */
export type SaveVsConditionAdvantageFlagKey =
  `save.advantage.vs${Capitalize<SaveConditionKey>}`;

/** Флаг помехи на спасбросок против состояния. */
export type SaveVsConditionDisadvantageFlagKey =
  `save.disadvantage.vs${Capitalize<SaveConditionKey>}`;

/**
 * Флаг «Увёртливости» по характеристике: спасбросок, успех которого даёт
 * половину урона, при успехе не даёт урона вовсе, а при провале — половину.
 */
export type SaveEvasionFlagKey = `save.evasion.${AbilityType}`;

/**
 * Флаг атакующего: его урон этого типа не уменьшает сопротивление цели
 * («Сила могилы» некроманта). Иммунитет по-прежнему действует.
 */
export type DamageIgnoreResistanceFlagKey =
  `damage.ignoreResistance.${DefensibleDamageType}`;

/**
 * Флаги спасброска против состояния — «преимущество на спасброски, чтобы
 * избежать или прекратить состояние Отравлен».
 *
 * Семейством по списку состояний, а не отдельными флагами: так написана
 * половина видов справочника (дварфийская стойкость, храбрость полурослика,
 * наследие фей), и держать их перечислением значило бы дописывать союз при
 * каждом новом виде. Признак «против чего спасаемся» — параметр броска, а не
 * свойство носителя, как и `vsMagic`.
 */
export type SaveVsConditionFlagKey =
  SaveVsConditionAdvantageFlagKey | SaveVsConditionDisadvantageFlagKey;

/** Флаг «нельзя накладывать заклинания школы»: по одному на школу магии */
export type SpellSchoolBlockFlagKey = `spellcasting.noSchool.${SpellSchool}`;

/**
 * Нечисловые эффекты: помеха, преимущество, иммунитеты.
 *
 * Флаги не имеют числового значения — они либо активны, либо нет.
 * Собираются в `Set<EffectFlagKey>` внутри `ResolvedActorStats.activeFlags`.
 */
export type EffectFlagKey =
  | 'attack.disadvantage'
  | 'attack.advantage'
  | 'attack.melee.advantage'
  | 'attack.melee.disadvantage'
  | 'attack.ranged.advantage'
  | 'attack.ranged.disadvantage'
  | 'attack.spell.advantage'
  | 'attack.spell.disadvantage'
  | 'attacksAgainst.advantage'
  | 'attacksAgainst.disadvantage'
  | 'attacksAgainst.melee.advantage'
  | 'attacksAgainst.melee.disadvantage'
  | 'attacksAgainst.ranged.advantage'
  | 'attacksAgainst.ranged.disadvantage'
  | 'attacksAgainst.spell.advantage'
  | 'attacksAgainst.spell.disadvantage'
  | 'abilityCheck.disadvantage'
  | 'abilityCheck.advantage'
  | 'abilityCheck.advantage.strength'
  | 'abilityCheck.advantage.dexterity'
  | 'abilityCheck.advantage.constitution'
  | 'abilityCheck.advantage.intelligence'
  | 'abilityCheck.advantage.wisdom'
  | 'abilityCheck.advantage.charisma'
  | 'abilityCheck.disadvantage.strength'
  | 'abilityCheck.disadvantage.dexterity'
  | 'abilityCheck.disadvantage.constitution'
  | 'abilityCheck.disadvantage.intelligence'
  | 'abilityCheck.disadvantage.wisdom'
  | 'abilityCheck.disadvantage.charisma'
  | 'save.advantage'
  | 'save.disadvantage'
  | 'save.advantage.vsMagic'
  | 'save.disadvantage.vsMagic'
  | 'save.advantage.vsSpell'
  | 'save.disadvantage.vsSpell'
  | 'save.advantage.death'
  | 'save.disadvantage.death'
  | 'save.negateOnSuccess.vsMagic'
  | 'save.advantage.vsConcentration'
  | 'save.disadvantage.vsConcentration'
  | 'save.advantage.strength'
  | 'save.advantage.dexterity'
  | 'save.advantage.constitution'
  | 'save.advantage.intelligence'
  | 'save.advantage.wisdom'
  | 'save.advantage.charisma'
  | 'save.disadvantage.strength'
  | 'save.disadvantage.dexterity'
  | 'save.disadvantage.constitution'
  | 'save.disadvantage.intelligence'
  | 'save.disadvantage.wisdom'
  | 'save.disadvantage.charisma'
  | 'save.autoFail.strength'
  | 'save.autoFail.dexterity'
  | 'save.autoFail.constitution'
  | 'save.autoFail.intelligence'
  | 'save.autoFail.wisdom'
  | 'save.autoFail.charisma'
  | 'speed.zero'
  | 'terrain.ignoreDifficult'
  | 'mark.bySource'
  | 'incapacitated'
  | 'initiative.advantage'
  | 'initiative.disadvantage'
  | 'vision.blinded'
  | 'vision.invisible'
  | 'defense.critImmunity'
  | 'defense.suppressAll'
  | 'defense.suppressResistances'
  | 'damage.concentrationDisadvantage'
  | 'healing.blocked'
  | 'healing.tempBlocked'
  | 'hitPoints.maxReductionBlocked'
  | 'attacksAgainst.forceCritical'
  | 'movement.teleportBlocked'
  | 'actions.noReaction'
  | 'actions.noBonusAction'
  | 'actions.oneActionOrBonus'
  | 'actions.oneOfMoveActionBonus'
  | 'actions.oneAttackPerAction'
  | 'actions.noOpportunityAttack'
  | 'spellcasting.blocked'
  | 'spellcasting.noVerbal'
  | 'spellcasting.noMagicAction'
  | SpellSchoolBlockFlagKey
  | 'concentration.blocked'
  | 'rest.noBenefit.short'
  | 'rest.noBenefit.long'
  | 'hitDice.maximize'
  | 'hitDice.lowAsThree'
  | 'hitDice.firstFree'
  | 'escape.advantage'
  | 'escape.disadvantage'
  | 'escape.advantage.grappled'
  | 'escape.disadvantage.grappled'
  | 'grapple.escapeDisadvantage'
  | DamageDefenseFlagKey
  | SkillFlagKey
  | SaveVsConditionFlagKey
  | SaveEvasionFlagKey
  | DamageIgnoreResistanceFlagKey;

/**
 * Подпись флага «нельзя накладывать заклинания школы».
 *
 * @param school - школа магии
 * @returns подпись
 */
function schoolBlockLabel(school: SpellSchool): string {
  return `Не может накладывать заклинания школы «${SPELL_SCHOOL_LABELS[school]}»`;
}

/**
 * Локализованные названия статических флагов (без генерируемых семейств).
 * Защиты от урона и понавыковые флаги собираются отдельно — см.
 * `DAMAGE_DEFENSE_FLAG_LABELS` и `buildSkillFlagLabels`.
 */
const BASE_EFFECT_FLAG_LABELS: Record<
  Exclude<
    EffectFlagKey,
    | DamageDefenseFlagKey
    | SkillFlagKey
    | SaveVsConditionFlagKey
    | SaveEvasionFlagKey
    | DamageIgnoreResistanceFlagKey
  >,
  string
> = {
  // Атаки
  'attack.disadvantage': 'Помеха на все атаки',
  'attack.advantage': 'Преимущество на все атаки',
  'attack.melee.advantage': 'Преимущество на рукопашные атаки',
  'attack.melee.disadvantage': 'Помеха на рукопашные атаки',
  'attack.ranged.advantage': 'Преимущество на дальнобойные атаки',
  'attack.ranged.disadvantage': 'Помеха на дальнобойные атаки',
  'attack.spell.advantage': 'Преимущество на атаки заклинаниями',
  'attack.spell.disadvantage': 'Помеха на атаки заклинаниями',
  'attacksAgainst.advantage': 'Преимущество атак по этому существу',
  'attacksAgainst.disadvantage': 'Помеха атак по этому существу',
  'attacksAgainst.melee.advantage':
    'Преимущество рукопашных атак по этому существу',
  'attacksAgainst.melee.disadvantage':
    'Помеха рукопашных атак по этому существу',
  'attacksAgainst.ranged.advantage':
    'Преимущество дальнобойных атак по этому существу',
  'attacksAgainst.ranged.disadvantage':
    'Помеха дальнобойных атак по этому существу',
  'attacksAgainst.spell.advantage':
    'Преимущество атак заклинаниями по этому существу',
  'attacksAgainst.spell.disadvantage':
    'Помеха атак заклинаниями по этому существу',

  // Проверки характеристик
  'abilityCheck.disadvantage': 'Помеха на ВСЕ проверки характеристик',
  'abilityCheck.advantage': 'Преимущество на ВСЕ проверки характеристик',
  'abilityCheck.advantage.strength': 'Преимущество на проверки: Сила',
  'abilityCheck.advantage.dexterity': 'Преимущество на проверки: Ловкость',
  'abilityCheck.advantage.constitution':
    'Преимущество на проверки: Телосложение',
  'abilityCheck.advantage.intelligence': 'Преимущество на проверки: Интеллект',
  'abilityCheck.advantage.wisdom': 'Преимущество на проверки: Мудрость',
  'abilityCheck.advantage.charisma': 'Преимущество на проверки: Харизма',
  'abilityCheck.disadvantage.strength': 'Помеха на проверки: Сила',
  'abilityCheck.disadvantage.dexterity': 'Помеха на проверки: Ловкость',
  'abilityCheck.disadvantage.constitution': 'Помеха на проверки: Телосложение',
  'abilityCheck.disadvantage.intelligence': 'Помеха на проверки: Интеллект',
  'abilityCheck.disadvantage.wisdom': 'Помеха на проверки: Мудрость',
  'abilityCheck.disadvantage.charisma': 'Помеха на проверки: Харизма',

  // Спасброски
  'save.advantage': 'Преимущество на ВСЕ спасброски',
  'save.disadvantage': 'Помеха на ВСЕ спасброски',
  'save.advantage.vsMagic':
    'Преимущество на спасброски против заклинаний и магических эффектов',
  'save.disadvantage.vsMagic':
    'Помеха на спасброски против заклинаний и магических эффектов',
  'save.advantage.vsSpell': 'Преимущество на спасброски против заклинаний',
  'save.disadvantage.vsSpell': 'Помеха на спасброски против заклинаний',
  'save.advantage.death': 'Преимущество на спасброски от смерти',
  'save.disadvantage.death': 'Помеха на спасброски от смерти',
  'save.negateOnSuccess.vsMagic':
    'Успешный спасбросок против магии «половина урона» — урона нет',
  'save.advantage.vsConcentration': 'Преимущество на спасброски концентрации',
  'save.disadvantage.vsConcentration': 'Помеха на спасброски концентрации',
  'save.advantage.strength': 'Преимущество на спасброски: Сила',
  'save.advantage.dexterity': 'Преимущество на спасброски: Ловкость',
  'save.advantage.constitution': 'Преимущество на спасброски: Телосложение',
  'save.advantage.intelligence': 'Преимущество на спасброски: Интеллект',
  'save.advantage.wisdom': 'Преимущество на спасброски: Мудрость',
  'save.advantage.charisma': 'Преимущество на спасброски: Харизма',
  'save.disadvantage.strength': 'Помеха на спасброски: Сила',
  'save.disadvantage.dexterity': 'Помеха на спасброски: Ловкость',
  'save.disadvantage.constitution': 'Помеха на спасброски: Телосложение',
  'save.disadvantage.intelligence': 'Помеха на спасброски: Интеллект',
  'save.disadvantage.wisdom': 'Помеха на спасброски: Мудрость',
  'save.disadvantage.charisma': 'Помеха на спасброски: Харизма',

  // Автопровалы
  'save.autoFail.strength': 'Автопровал спасбросков: Сила',
  'save.autoFail.dexterity': 'Автопровал спасбросков: Ловкость',
  'save.autoFail.constitution': 'Автопровал спасбросков: Телосложение',
  'save.autoFail.intelligence': 'Автопровал спасбросков: Интеллект',
  'save.autoFail.wisdom': 'Автопровал спасбросков: Мудрость',
  'save.autoFail.charisma': 'Автопровал спасбросков: Харизма',

  // Прочее
  'speed.zero': 'Скорость равна нулю',
  'terrain.ignoreDifficult':
    'Игнорирует труднопроходимую местность (клетки зон стоят как обычные)',
  'mark.bySource':
    'Метка наложившего: его условие «цель помечена мной» (Метка охотника, Сглаз)',
  'incapacitated': 'Недееспособен (Не может совершать действия/реакции)',

  // Ограничения действий (`actionRestrictions.ts`)
  'actions.noReaction': 'Не может совершать реакции',
  'actions.noBonusAction': 'Не может совершать бонусные действия',
  'actions.oneActionOrBonus':
    'За ход — действие или бонусное действие, не оба (Замедление)',
  'actions.oneOfMoveActionBonus':
    'За ход — одно из трёх: перемещение, действие или бонусное действие',
  'actions.oneAttackPerAction': 'Действием «Атака» — только одна атака за ход',
  'actions.noOpportunityAttack':
    'Не может совершать провоцированные атаки (остальные реакции доступны)',
  'spellcasting.blocked': 'Не может накладывать заклинания',
  'spellcasting.noVerbal':
    'Не может накладывать заклинания с вербальным компонентом',
  'spellcasting.noMagicAction':
    'Не может совершать действие «Магия» (заклинания действием)',
  'spellcasting.noSchool.abjuration': schoolBlockLabel('abjuration'),
  'spellcasting.noSchool.conjuration': schoolBlockLabel('conjuration'),
  'spellcasting.noSchool.divination': schoolBlockLabel('divination'),
  'spellcasting.noSchool.enchantment': schoolBlockLabel('enchantment'),
  'spellcasting.noSchool.evocation': schoolBlockLabel('evocation'),
  'spellcasting.noSchool.illusion': schoolBlockLabel('illusion'),
  'spellcasting.noSchool.necromancy': schoolBlockLabel('necromancy'),
  'spellcasting.noSchool.transmutation': schoolBlockLabel('transmutation'),
  'concentration.blocked':
    'Не может концентрироваться (текущая концентрация прерывается)',
  'initiative.advantage': 'Преимущество на бросок инициативы',
  'initiative.disadvantage': 'Помеха на бросок инициативы',
  'vision.blinded': 'Ослеплен (Ничего не видит, автопровал проверок зрения)',
  'vision.invisible': 'Невидимый (Скрыт от глаз, преимущество на атаки)',

  // Специфические флаги предметов
  'defense.critImmunity': 'Защита: Иммунитет к критическим попаданиям',
  'defense.suppressAll':
    'Защиты от урона не действуют (сопротивления и иммунитеты сняты)',
  'defense.suppressResistances':
    'Сопротивления урону не действуют (иммунитеты остаются)',
  'damage.concentrationDisadvantage':
    'Урон носителя: спасбросок концентрации цели с помехой',
  'hitPoints.maxReductionBlocked': 'Максимум хитов нельзя уменьшать',
  'attacksAgainst.forceCritical': 'Попадание по этому существу — крит',
  'movement.teleportBlocked': 'Не может телепортироваться',
  'rest.noBenefit.short': 'Короткий отдых не приносит пользы',
  'rest.noBenefit.long': 'Продолжительный отдых не приносит пользы',

  // Кости хитов: читают и короткий отдых, и цена ресурсом (`effectPay.ts`)
  'hitDice.maximize': 'Кости хитов: максимум вместо броска',
  'hitDice.lowAsThree': 'Кости хитов: выпавшие 1 и 2 считаются как 3',
  'hitDice.firstFree':
    'Кости хитов: первая после продолжительного отдыха не тратится',

  // «Вырваться» (`effectEscape.ts`)
  'escape.advantage': 'Преимущество на проверки, чтобы вырваться',
  'escape.disadvantage': 'Помеха на проверки, чтобы вырваться',
  'escape.advantage.grappled':
    'Преимущество на проверки, чтобы вырваться из захвата (Схваченный)',
  'escape.disadvantage.grappled':
    'Помеха на проверки, чтобы вырваться из захвата (Схваченный)',
  'grapple.escapeDisadvantage':
    'Из захвата носителя вырываются с помехой (Схваченный, наложенный им)',

  // Лечение
  'healing.blocked': 'Не может восстанавливать хиты',
  'healing.tempBlocked': 'Не может получать временные хиты',
};

/**
 * Подписи флагов «Увёртливости» — по одному на характеристику.
 *
 * Перечислением, как и остальные семейства: тип `Record` ловит новую
 * характеристику на этапе компиляции.
 */
const SAVE_EVASION_FLAG_LABELS: Record<SaveEvasionFlagKey, string> = {
  'save.evasion.strength': 'Увёртливость: спасбросок Силы',
  'save.evasion.dexterity': 'Увёртливость: спасбросок Ловкости',
  'save.evasion.constitution': 'Увёртливость: спасбросок Телосложения',
  'save.evasion.intelligence': 'Увёртливость: спасбросок Интеллекта',
  'save.evasion.wisdom': 'Увёртливость: спасбросок Мудрости',
  'save.evasion.charisma': 'Увёртливость: спасбросок Харизмы',
};

/**
 * Подпись флага «урон игнорирует сопротивление».
 *
 * @param damageType - тип урона
 * @returns подпись
 */
function ignoreResistanceLabel(damageType: DefensibleDamageType): string {
  return `Свой урон (${DAMAGE_TYPE_LABELS[damageType]}) игнорирует сопротивление`;
}

/** Подписи флагов «урон игнорирует сопротивление» — по типу урона. */
const DAMAGE_IGNORE_RESISTANCE_FLAG_LABELS: Record<
  DamageIgnoreResistanceFlagKey,
  string
> = {
  'damage.ignoreResistance.slashing': ignoreResistanceLabel('slashing'),
  'damage.ignoreResistance.piercing': ignoreResistanceLabel('piercing'),
  'damage.ignoreResistance.bludgeoning': ignoreResistanceLabel('bludgeoning'),
  'damage.ignoreResistance.fire': ignoreResistanceLabel('fire'),
  'damage.ignoreResistance.cold': ignoreResistanceLabel('cold'),
  'damage.ignoreResistance.lightning': ignoreResistanceLabel('lightning'),
  'damage.ignoreResistance.thunder': ignoreResistanceLabel('thunder'),
  'damage.ignoreResistance.poison': ignoreResistanceLabel('poison'),
  'damage.ignoreResistance.acid': ignoreResistanceLabel('acid'),
  'damage.ignoreResistance.necrotic': ignoreResistanceLabel('necrotic'),
  'damage.ignoreResistance.radiant': ignoreResistanceLabel('radiant'),
  'damage.ignoreResistance.force': ignoreResistanceLabel('force'),
  'damage.ignoreResistance.psychic': ignoreResistanceLabel('psychic'),
};

/**
 * Подписи флагов защит от урона (сопротивление/иммунитет/уязвимость).
 *
 * Тип `Record<DamageDefenseFlagKey, string>` гарантирует полноту на этапе
 * компиляции, а значения переиспользуют единый `DAMAGE_TYPE_LABELS`,
 * чтобы не дублировать русские названия типов урона.
 */
const DAMAGE_DEFENSE_FLAG_LABELS: Record<DamageDefenseFlagKey, string> = {
  'resistance.slashing': `Сопротивление: ${DAMAGE_TYPE_LABELS.slashing}`,
  'resistance.piercing': `Сопротивление: ${DAMAGE_TYPE_LABELS.piercing}`,
  'resistance.bludgeoning': `Сопротивление: ${DAMAGE_TYPE_LABELS.bludgeoning}`,
  'resistance.fire': `Сопротивление: ${DAMAGE_TYPE_LABELS.fire}`,
  'resistance.cold': `Сопротивление: ${DAMAGE_TYPE_LABELS.cold}`,
  'resistance.lightning': `Сопротивление: ${DAMAGE_TYPE_LABELS.lightning}`,
  'resistance.thunder': `Сопротивление: ${DAMAGE_TYPE_LABELS.thunder}`,
  'resistance.poison': `Сопротивление: ${DAMAGE_TYPE_LABELS.poison}`,
  'resistance.acid': `Сопротивление: ${DAMAGE_TYPE_LABELS.acid}`,
  'resistance.necrotic': `Сопротивление: ${DAMAGE_TYPE_LABELS.necrotic}`,
  'resistance.radiant': `Сопротивление: ${DAMAGE_TYPE_LABELS.radiant}`,
  'resistance.force': `Сопротивление: ${DAMAGE_TYPE_LABELS.force}`,
  'resistance.psychic': `Сопротивление: ${DAMAGE_TYPE_LABELS.psychic}`,
  'immunity.slashing': `Иммунитет: ${DAMAGE_TYPE_LABELS.slashing}`,
  'immunity.piercing': `Иммунитет: ${DAMAGE_TYPE_LABELS.piercing}`,
  'immunity.bludgeoning': `Иммунитет: ${DAMAGE_TYPE_LABELS.bludgeoning}`,
  'immunity.fire': `Иммунитет: ${DAMAGE_TYPE_LABELS.fire}`,
  'immunity.cold': `Иммунитет: ${DAMAGE_TYPE_LABELS.cold}`,
  'immunity.lightning': `Иммунитет: ${DAMAGE_TYPE_LABELS.lightning}`,
  'immunity.thunder': `Иммунитет: ${DAMAGE_TYPE_LABELS.thunder}`,
  'immunity.poison': `Иммунитет: ${DAMAGE_TYPE_LABELS.poison}`,
  'immunity.acid': `Иммунитет: ${DAMAGE_TYPE_LABELS.acid}`,
  'immunity.necrotic': `Иммунитет: ${DAMAGE_TYPE_LABELS.necrotic}`,
  'immunity.radiant': `Иммунитет: ${DAMAGE_TYPE_LABELS.radiant}`,
  'immunity.force': `Иммунитет: ${DAMAGE_TYPE_LABELS.force}`,
  'immunity.psychic': `Иммунитет: ${DAMAGE_TYPE_LABELS.psychic}`,
  'vulnerability.slashing': `Уязвимость: ${DAMAGE_TYPE_LABELS.slashing}`,
  'vulnerability.piercing': `Уязвимость: ${DAMAGE_TYPE_LABELS.piercing}`,
  'vulnerability.bludgeoning': `Уязвимость: ${DAMAGE_TYPE_LABELS.bludgeoning}`,
  'vulnerability.fire': `Уязвимость: ${DAMAGE_TYPE_LABELS.fire}`,
  'vulnerability.cold': `Уязвимость: ${DAMAGE_TYPE_LABELS.cold}`,
  'vulnerability.lightning': `Уязвимость: ${DAMAGE_TYPE_LABELS.lightning}`,
  'vulnerability.thunder': `Уязвимость: ${DAMAGE_TYPE_LABELS.thunder}`,
  'vulnerability.poison': `Уязвимость: ${DAMAGE_TYPE_LABELS.poison}`,
  'vulnerability.acid': `Уязвимость: ${DAMAGE_TYPE_LABELS.acid}`,
  'vulnerability.necrotic': `Уязвимость: ${DAMAGE_TYPE_LABELS.necrotic}`,
  'vulnerability.radiant': `Уязвимость: ${DAMAGE_TYPE_LABELS.radiant}`,
  'vulnerability.force': `Уязвимость: ${DAMAGE_TYPE_LABELS.force}`,
  'vulnerability.psychic': `Уязвимость: ${DAMAGE_TYPE_LABELS.psychic}`,
};

/**
 * Подписи понавыковых флагов — по паре на каждый навык.
 *
 * Выписаны перечислением, как и защиты от урона выше: тип
 * `Record<SkillFlagKey, string>` тогда гарантирует полноту на этапе компиляции,
 * а новый навык в справочнике сразу ломает сборку и не забывается. Значения
 * переиспользуют `SKILLS_LABELS`, чтобы русские названия не задваивались.
 */
const SKILL_FLAG_LABELS: Record<SkillFlagKey, string> = {
  'skill.acrobatics.advantage': `Преимущество на проверки: ${SKILLS_LABELS.acrobatics}`,
  'skill.animalHandling.advantage': `Преимущество на проверки: ${SKILLS_LABELS.animalHandling}`,
  'skill.arcana.advantage': `Преимущество на проверки: ${SKILLS_LABELS.arcana}`,
  'skill.athletics.advantage': `Преимущество на проверки: ${SKILLS_LABELS.athletics}`,
  'skill.deception.advantage': `Преимущество на проверки: ${SKILLS_LABELS.deception}`,
  'skill.history.advantage': `Преимущество на проверки: ${SKILLS_LABELS.history}`,
  'skill.insight.advantage': `Преимущество на проверки: ${SKILLS_LABELS.insight}`,
  'skill.intimidation.advantage': `Преимущество на проверки: ${SKILLS_LABELS.intimidation}`,
  'skill.investigation.advantage': `Преимущество на проверки: ${SKILLS_LABELS.investigation}`,
  'skill.medicine.advantage': `Преимущество на проверки: ${SKILLS_LABELS.medicine}`,
  'skill.nature.advantage': `Преимущество на проверки: ${SKILLS_LABELS.nature}`,
  'skill.perception.advantage': `Преимущество на проверки: ${SKILLS_LABELS.perception}`,
  'skill.performance.advantage': `Преимущество на проверки: ${SKILLS_LABELS.performance}`,
  'skill.persuasion.advantage': `Преимущество на проверки: ${SKILLS_LABELS.persuasion}`,
  'skill.religion.advantage': `Преимущество на проверки: ${SKILLS_LABELS.religion}`,
  'skill.sleightOfHand.advantage': `Преимущество на проверки: ${SKILLS_LABELS.sleightOfHand}`,
  'skill.stealth.advantage': `Преимущество на проверки: ${SKILLS_LABELS.stealth}`,
  'skill.survival.advantage': `Преимущество на проверки: ${SKILLS_LABELS.survival}`,
  'skill.acrobatics.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.acrobatics}`,
  'skill.animalHandling.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.animalHandling}`,
  'skill.arcana.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.arcana}`,
  'skill.athletics.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.athletics}`,
  'skill.deception.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.deception}`,
  'skill.history.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.history}`,
  'skill.insight.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.insight}`,
  'skill.intimidation.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.intimidation}`,
  'skill.investigation.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.investigation}`,
  'skill.medicine.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.medicine}`,
  'skill.nature.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.nature}`,
  'skill.perception.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.perception}`,
  'skill.performance.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.performance}`,
  'skill.persuasion.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.persuasion}`,
  'skill.religion.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.religion}`,
  'skill.sleightOfHand.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.sleightOfHand}`,
  'skill.stealth.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.stealth}`,
  'skill.survival.disadvantage': `Помеха на проверки: ${SKILLS_LABELS.survival}`,
};

/** Русские названия состояний по ключу — из единственного перечня системы. */
const CONDITION_NAME_BY_KEY = new Map(
  CONDITIONS.map((entry) => [entry.key, entry.nameRu]),
);

/**
 * Подпись флага спасброска против состояния.
 *
 * @param mode - «Преимущество» либо «Помеха»
 * @param condition - ключ состояния
 * @returns подпись для списка флагов
 */
function saveVsConditionLabel(
  mode: string,
  condition: SaveConditionKey,
): string {
  return `${mode} на спасброски против состояния: ${CONDITION_NAME_BY_KEY.get(condition) ?? condition}`;
}

/**
 * Подписи флагов спасброска против состояния — по паре на каждое состояние.
 *
 * Выписаны перечислением, как защиты от урона и понавыковые флаги выше: тип
 * `Record<SaveVsConditionFlagKey, string>` тогда гарантирует полноту на этапе
 * компиляции, а новое состояние в перечне сразу ломает сборку и не забывается.
 */
const SAVE_VS_CONDITION_FLAG_LABELS: Record<SaveVsConditionFlagKey, string> = {
  'save.advantage.vsBlinded': saveVsConditionLabel('Преимущество', 'blinded'),
  'save.advantage.vsCharmed': saveVsConditionLabel('Преимущество', 'charmed'),
  'save.advantage.vsDeafened': saveVsConditionLabel('Преимущество', 'deafened'),
  'save.advantage.vsExhaustion': saveVsConditionLabel(
    'Преимущество',
    'exhaustion',
  ),
  'save.advantage.vsFrightened': saveVsConditionLabel(
    'Преимущество',
    'frightened',
  ),
  'save.advantage.vsGrappled': saveVsConditionLabel('Преимущество', 'grappled'),
  'save.advantage.vsIncapacitated': saveVsConditionLabel(
    'Преимущество',
    'incapacitated',
  ),
  'save.advantage.vsInvisible': saveVsConditionLabel(
    'Преимущество',
    'invisible',
  ),
  'save.advantage.vsParalyzed': saveVsConditionLabel(
    'Преимущество',
    'paralyzed',
  ),
  'save.advantage.vsPetrified': saveVsConditionLabel(
    'Преимущество',
    'petrified',
  ),
  'save.advantage.vsPoisoned': saveVsConditionLabel('Преимущество', 'poisoned'),
  'save.advantage.vsProne': saveVsConditionLabel('Преимущество', 'prone'),
  'save.advantage.vsRestrained': saveVsConditionLabel(
    'Преимущество',
    'restrained',
  ),
  'save.advantage.vsStunned': saveVsConditionLabel('Преимущество', 'stunned'),
  'save.advantage.vsUnconscious': saveVsConditionLabel(
    'Преимущество',
    'unconscious',
  ),
  'save.disadvantage.vsBlinded': saveVsConditionLabel('Помеха', 'blinded'),
  'save.disadvantage.vsCharmed': saveVsConditionLabel('Помеха', 'charmed'),
  'save.disadvantage.vsDeafened': saveVsConditionLabel('Помеха', 'deafened'),
  'save.disadvantage.vsExhaustion': saveVsConditionLabel(
    'Помеха',
    'exhaustion',
  ),
  'save.disadvantage.vsFrightened': saveVsConditionLabel(
    'Помеха',
    'frightened',
  ),
  'save.disadvantage.vsGrappled': saveVsConditionLabel('Помеха', 'grappled'),
  'save.disadvantage.vsIncapacitated': saveVsConditionLabel(
    'Помеха',
    'incapacitated',
  ),
  'save.disadvantage.vsInvisible': saveVsConditionLabel('Помеха', 'invisible'),
  'save.disadvantage.vsParalyzed': saveVsConditionLabel('Помеха', 'paralyzed'),
  'save.disadvantage.vsPetrified': saveVsConditionLabel('Помеха', 'petrified'),
  'save.disadvantage.vsPoisoned': saveVsConditionLabel('Помеха', 'poisoned'),
  'save.disadvantage.vsProne': saveVsConditionLabel('Помеха', 'prone'),
  'save.disadvantage.vsRestrained': saveVsConditionLabel(
    'Помеха',
    'restrained',
  ),
  'save.disadvantage.vsStunned': saveVsConditionLabel('Помеха', 'stunned'),
  'save.disadvantage.vsUnconscious': saveVsConditionLabel(
    'Помеха',
    'unconscious',
  ),
};

/**
 * Ключ флага спасброска против состояния.
 *
 * Собирается здесь, а не у потребителя: строка ключа обязана совпадать с типом
 * семейства, и второе место сборки разошлось бы с ним на первом же состоянии.
 *
 * @param mode - вид флага
 * @param condition - ключ состояния
 * @returns ключ флага
 */
export function buildSaveVsConditionFlag(
  mode: 'advantage' | 'disadvantage',
  condition: ConditionRef,
): string {
  const capitalized = condition.charAt(0).toUpperCase() + condition.slice(1);

  return `save.${mode}.vs${capitalized}`;
}

/**
 * Локализованные названия флагов эффектов: статические, защиты от урона,
 * понавыковые и спасброски против состояния.
 */
export const EFFECT_FLAG_LABELS: Record<EffectFlagKey, string> = {
  ...BASE_EFFECT_FLAG_LABELS,
  ...DAMAGE_DEFENSE_FLAG_LABELS,
  ...SKILL_FLAG_LABELS,
  ...SAVE_VS_CONDITION_FLAG_LABELS,
  ...SAVE_EVASION_FLAG_LABELS,
  ...DAMAGE_IGNORE_RESISTANCE_FLAG_LABELS,
};

// ── Источник эффекта ──────────────────────────────────────────
// Тип `EffectOrigin` вынесен в нейтральный контракт (`../contracts/effects`) и
// реэкспортится выше. Здесь — только D&D-специфичные ярлыки для UI.

/**
 * Локализованные названия источников эффекта — откуда он на сущности взялся.
 * Их показывает карточка просмотра эффекта: по одному названию не видно,
 * снимется ли эффект вместе с предметом или висит сам по себе.
 */
export const EFFECT_ORIGIN_LABELS: Record<EffectOrigin, string> = {
  item: 'От предмета',
  spell: 'От заклинания',
  feature: 'От особенности',
  condition: 'Состояние',
  manual: 'Заведён вручную',
  area: 'От области',
} as const;

// ── Структуры данных ──────────────────────────────────────────

/**
 * Одно числовое изменение, вносимое Active Effect.
 *
 * Примеры:
 * - `{ key: 'ability.strength', mode: 'add', value: '2', priority: 20 }`
 * - `{ key: 'armorClass', mode: 'add', value: '@mod.cha', priority: 20 }`
 */
export interface EffectChange {
  /** Какой параметр модифицировать */
  key: EffectChangeKey;
  /** Как модифицировать */
  mode: EffectChangeMode;
  /** Числовое значение или формула с @-переменными */
  value: string;
  /** Опциональное условие (например: roll.hasAdvantage === true) */
  condition?: string;
  /**
   * Шаг: значение растёт или убывает со временем («−1 к броскам за каждый
   * следующий ход, до −5»). Работает только у плоского числа — см.
   * {@link module:system/dnd/effectChangeSteps}.
   */
  step?: EffectChangeStep;
  /** Приоритет применения (меньше = раньше, по умолчанию 20) */
  priority: number;
}

/**
 * Как эффект начинает действовать: `use` — накладывается применением
 * источника (зелье, стрела, кнопка «Применить»), `toggle` — включается
 * переключателем («Ярость»).
 */
export const EFFECT_ACTIVATION_MODES = ['use', 'toggle'] as const;

/** Сколько тратит применение или включение без поля `amount` */
export const DEFAULT_ACTIVATION_AMOUNT = 1;

/** Наименьшая дальность применения в футах; меньше — это касание */
export const MIN_ACTIVATION_RANGE = 1;

/** Способ применения или включения эффекта */
export type EffectActivationMode = (typeof EFFECT_ACTIVATION_MODES)[number];

/** Чем платят ходом за применение или включение */
export const EFFECT_ACTIVATION_COSTS = ['action', 'bonus', 'reaction'] as const;

/** Трата хода на применение или включение: действие, бонусное, реакция */
export type EffectActivationCost = (typeof EFFECT_ACTIVATION_COSTS)[number];

/** Формы области применения — те же, что у шаблона заклинания */
export const EFFECT_USE_AREA_SHAPES = [
  'cone',
  'circle',
  'ray',
  'rect',
] as const;

/** Форма области применения */
export type EffectUseAreaShape = (typeof EFFECT_USE_AREA_SHAPES)[number];

/** Форма области, у которой есть ширина, — линия */
const USE_AREA_SHAPE_WITH_WIDTH: EffectUseAreaShape = 'ray';

/**
 * Есть ли у формы области ширина: её задают только линии.
 *
 * @param shape - форма области
 * @returns `true` для линии
 */
export function useAreaHasWidth(
  shape: EffectUseAreaShape | undefined,
): boolean {
  return shape === USE_AREA_SHAPE_WITH_WIDTH;
}

/** Самая большая область применения, фт */
export const MAX_EFFECT_USE_AREA_SIZE = 1000;

/**
 * Область применения эффекта: шаблон, который применивший ставит на карту, как
 * у заклинания с областью. Эффекты «на цели» получают все, кого шаблон накрыл;
 * эффект «в зону» остаётся зоной на месте шаблона.
 */
export interface EffectUseArea {
  /** Форма: конус, сфера, линия или куб */
  shape: EffectUseAreaShape;
  /** Размер в футах: длина конуса и линии, радиус сферы, сторона куба */
  size: number;
  /** Ширина линии в футах */
  width?: number;
}

/** Применение или включение эффекта */
export interface EffectActivation {
  /** Накладывается применением или включается переключателем */
  mode: EffectActivationMode;
  /**
   * Счётчик листа (`system.classCounters`), который тратит применение или
   * включение; нет — ничего не тратит (у предмета тратятся его заряды)
   */
  counter?: string;
  /** Сколько тратится со счётчика; нет — одна единица */
  amount?: number;
  /**
   * Имя включения у переключателя: переключатели владельца с одним ресурсом и
   * одним именем — одно включение («Ярость» класса и её копии в умениях
   * подклассов). Пока горит один, включение другого его гасит и ресурс не
   * тратит. Нет — переключатель сам по себе (варианты одной группы — одно
   * включение и без имени)
   */
  exclusive?: string;
  /**
   * Дальность применения «на цель» в футах: «Божественная искра» — на
   * существо в пределах 30 фт. Нет — касание, и цель дальше 5 фт игрок
   * берёт только с разрешения ведущего.
   */
  range?: number;
  /**
   * Трата хода: «бонусным действием произнесите командное слово». Запрещённая
   * трата («нет бонусных действий») применение и включение не пускает, а
   * сделанная — пишется в счёт хода («Замедление»). Выключение ничего не
   * стоит. Нет — ход не тратится
   */
  cost?: EffectActivationCost;
  /**
   * Область применения: шаблон на карте вместо выбора одной цели («выдохом в
   * конусе 30 футов»). Только у применения
   */
  area?: EffectUseArea;
  /**
   * Применение требует концентрации, как заклинание («Дар медузы»:
   * «необходимо концентрироваться»): применивший получает метку концентрации,
   * прежняя концентрация кончается, а с концом этой снимается наложенное.
   * Только у применения
   */
  concentration?: true;
}

/**
 * Аура эффекта в D&D-форме: к нейтральной форме ядра добавлены радиус
 * формулой и угасание при недееспособности носителя.
 */
export interface DndEffectAura extends EffectAura {
  /**
   * Радиус формулой от носителя («10 фт, на 18-м уровне — 30»:
   * `@classLevel >= 18 ? 30 : 10` не выражается — пишется
   * `10 + 20 * floor(@classLevel / 18)`). Считается при сборе аур, результат
   * ложится в `radius`
   */
  radiusFormula?: string;
  /** Аура гаснет, пока носитель недееспособен («Аура защиты») */
  whileCapable?: true;
}

/** Кто может действовать, чтобы снять эффект */
export const EFFECT_ESCAPE_ACTORS = ['self', 'adjacent', 'any'] as const;

/**
 * Носитель эффекта, существо рядом с ним или любой из них («цель или существо
 * в пределах досягаемости могут действием…»)
 */
export type EffectEscapeActor = (typeof EFFECT_ESCAPE_ACTORS)[number];

/** В какой роли существо действует, чтобы снять эффект */
export const EFFECT_ESCAPE_ROLES = ['self', 'adjacent'] as const;

/** Действует сам носитель или существо рядом с ним */
export type EffectEscapeRole = (typeof EFFECT_ESCAPE_ROLES)[number];

/** Режим броска проверки «вырваться», заданный самим эффектом */
export const EFFECT_ESCAPE_ROLL_MODES = ['advantage', 'disadvantage'] as const;

/** Преимущество или помеха на проверку «вырваться» */
export type EffectEscapeRollMode = (typeof EFFECT_ESCAPE_ROLL_MODES)[number];

/** Больше навыков на выбор у одной проверки «вырваться» не бывает */
export const MAX_ESCAPE_SKILLS = 6;

/** Кто действует без поля `by`: сам носитель */
export const DEFAULT_ESCAPE_ACTOR: EffectEscapeActor = 'self';

/** Что даёт успех действия «вырваться» */
export const EFFECT_ESCAPE_OUTCOMES = [
  'removeSelf',
  'removeCondition',
] as const;

/**
 * Итог успеха: снять сам эффект или только наложенное им состояние
 * (эффект-источник остаётся и может наложить состояние снова).
 */
export type EffectEscapeOutcome = (typeof EFFECT_ESCAPE_OUTCOMES)[number];

/** Что даёт успех без поля `onSuccess`: снимается сам эффект */
export const DEFAULT_ESCAPE_OUTCOME: EffectEscapeOutcome = 'removeSelf';

/**
 * Действие, снимающее эффект: «существо может действием совершить проверку
 * Силы (Атлетика) Сл 14 и вырваться».
 *
 * Сл 0 — Сл источника, как и у остальных полей Сл. Своего источника у эффекта
 * из компендиума нет, поэтому нулевая Сл не превращается в проверку против
 * нуля (её прошёл бы кто угодно): кнопка честно отказывается действовать —
 * см. `resolveEffectEscapeDc`.
 */
export interface EffectEscape {
  /** Кто может действовать; нет — сам носитель */
  by?: EffectEscapeActor;
  /** Чем платит; нет — бесплатно */
  cost?: EffectActionCost;
  /** Сколько футов перемещения стоит цена `move` */
  moveCostFeet?: number;
  /** Проверка навыка; нет — действие снимает эффект без броска */
  check?: EffectEscapeCheck;
  /** Что даёт успех; нет — снимается сам эффект */
  onSuccess?: EffectEscapeOutcome;
  /**
   * Состояние, которое носитель получает после освобождения: «при успехе цель
   * извлекается и получает состояние лежащий ничком»
   */
  onSuccessApply?: ConditionRef;
  /**
   * Урон носителю при провале проверки: «каждая неудачная проверка наносит
   * пойманному 1 колющий урон»
   */
  onFailDamage?: DamagePart[];
  /** Подпись кнопки; нет — «Вырваться» */
  label?: string;
}

/**
 * Навык на выбор у проверки «вырваться»: правило захвата 2024 — «Атлетика или
 * Акробатика», у кандалов у каждого навыка своя Сл, у водного элементаля сам
 * схваченный бросает любой из двух, а сосед — только Атлетику.
 */
export interface EffectEscapeSkillOption {
  /** Навык проверки */
  skill: SkillType;
  /** Своя Сл этого навыка; нет — Сл проверки */
  dc?: number;
  /** Кому навык доступен; нет — всем, кто может действовать */
  by?: EffectEscapeRole;
  /** Подпись варианта: «воровскими инструментами» */
  label?: string;
}

/** Проверка навыка, снимающая эффект */
export interface EffectEscapeCheck {
  /**
   * Навык проверки. При списке `skills` — его первый навык: по этому полю
   * проверку читают версии системы, которые списка не знают
   */
  skill: SkillType;
  /** Сложность; 0 — Сл источника */
  dc: number;
  /** Сл формулой по наложившему: «8 + @prof + @mod.str» захвата */
  dcFormula?: string;
  /**
   * Навыки на выбор того, кто вырывается. Нет поля — один навык `skill`.
   */
  skills?: EffectEscapeSkillOption[];
  /**
   * Преимущество или помеха самой проверки: «проверки для освобождения от
   * этого состояния совершаются с помехой» (Мимик). Складывается с флагами
   * бросающего по обычному правилу — преимущество и помеха гасятся
   */
  mode?: EffectEscapeRollMode;
  /**
   * Сл, которую взять неоткуда, называет тот, кто бросает: «Схваченный»,
   * повешенный рукой ведущего, — того, кто держит, у него нет. Без отметки
   * неизвестная Сл остаётся отказом (`resolveEffectEscapeDc`)
   */
  askDc?: true;
}

/** Самая длинная подпись ступени */
export const MAX_EFFECT_STAGE_LABEL_LENGTH = 100;

/** Больше ступеней у одного эффекта не бывает */
export const MAX_EFFECT_STAGES = 10;

/**
 * Ступень эффекта: свой набор модификаторов и флагов.
 *
 * Правила с нарастающей бедой («Проклятие гибельного старения») описывают
 * ступени словами, а переводит на следующую — человек. Ступени лежат у
 * эффекта списком, а `changes` и `flags` носителя переписываются из ступени
 * при переводе (`advanceEffectStage`): так конвейер листа не узнаёт о
 * ступенях вовсе.
 */
export interface EffectStage {
  /** Подпись ступени: «Ступень 2 — скорость вдвое меньше» */
  label: string;
  /** Модификаторы ступени */
  changes: EffectChange[];
  /** Флаги ступени */
  flags: EffectFlagKey[];
}

/** Вариант эффекта в группе альтернатив */
export interface EffectVariant {
  /** Ключ группы: эффекты с одним ключом — альтернативы */
  group: string;
  /** Подпись варианта в выборе и в чате */
  label: string;
  /** Как выбирается вариант группы; нет — называет тот, кто бросает */
  pick?: EffectVariantPick;
}

/** Локализованные названия длительности (для UI) */
export const EFFECT_DURATION_LABELS: Record<EffectDurationType, string> = {
  permanent: 'Постоянно',
  rounds: 'Раунды',
  minutes: 'Минуты',
  hours: 'Часы',
  days: 'Дни',
  turn: 'До хода (точно)',
  special: 'Особое',
} as const;

/** Локализованные названия якоря хода (для UI) */
export const EFFECT_TURN_ANCHOR_LABELS: Record<EffectTurnAnchor, string> = {
  carrier: 'носителя (цели)',
  source: 'источника (кастера)',
} as const;

/** Локализованные названия момента хода (для UI) */
export const EFFECT_TURN_TIMING_LABELS: Record<EffectTurnTiming, string> = {
  start: 'в начале хода',
  end: 'в конце хода',
} as const;

/** Что делает успешный спасбросок эффекта с его нагрузкой */
export type EffectSaveOutcome = 'negate' | 'half';

/**
 * Спасбросок при наложении эффекта: цель кидает спас в момент применения (напр.
 * при попадании атакой). Провал — эффект применяется (и наносится его урон);
 * успех — отменяет нагрузку (`negate`) или уменьшает урон вдвое (`half`).
 */
export interface EffectSave {
  /** Характеристика спасброска */
  ability: AbilityType;
  /** Сложность спасброска */
  dc: number;
  /**
   * Сл формулой по владельцу эффекта: «8 + @prof + @mod.str», «@spellDc» — Сл
   * его заклинаний. Считается по тому, чей это эффект: у наложенного на
   * другого — числами наложившего при наложении, у своего — по носителю в
   * момент броска. Не посчиталась — `dc`.
   */
  dcFormula?: string;
  /**
   * Ещё характеристики на выбор цели: «спасбросок Силы или Ловкости». Цель
   * бросает лучшей из названных (`saveAbilityChoice.ts`)
   */
  altAbilities?: AbilityType[];
  /**
   * Сл — итог проверки навыка применившего: «совершите проверку Харизмы
   * (Запугивание); спасбросок Мудрости со Сл, равной результату вашей
   * проверки». Проверку бросает применивший при применении эффекта; `dc`
   * остаётся запасным числом там, где проверки нет (каст заклинания)
   */
  dcSkill?: SkillType;
  /** Эффект успешного спасброска */
  onSuccess: EffectSaveOutcome;
  /**
   * Согласная цель не бросает: «Согласная цель может не совершать спасбросок».
   * В окне броска появляется «Не сопротивляюсь» — решает владелец цели, а не
   * тот, кто накладывает.
   */
  allowWilling?: true;
}

/** Моменты периодического спасброска: начало или конец хода носителя */
export const EFFECT_SAVE_TIMINGS = ['startOfTurn', 'endOfTurn'] as const;

/** Момент периодического спасброска для снятия эффекта */
export type EffectSaveTiming = (typeof EFFECT_SAVE_TIMINGS)[number];

/**
 * Периодический спасбросок для снятия эффекта (правило «спас в начале/конце
 * хода прекращает действие»). И конец, и начало хода обрабатываются на сервере
 * при смене хода в энкаунтере.
 *
 * `dc === 0` — особый случай «использовать Сл кастера»: при наложении эффекта
 * заклинанием клиент проставляет сюда динамическую Сл спасброска заклинателя
 * (у заклинаний персонажей Сл зависит от билда). У существ Сл фиксирована.
 */
export interface RecurringSave {
  /** Характеристика спасброска */
  ability: AbilityType;
  /** Сложность спасброска (`0` = подставить Сл кастера при наложении) */
  dc: number;
  /**
   * Сл формулой по владельцу эффекта: «8 + @prof + @mod.str», «@spellDc» — Сл
   * его заклинаний. Считается по тому, чей это эффект: у наложенного на
   * другого — числами наложившего при наложении, у своего — по носителю в
   * момент броска. Не посчиталась — `dc`.
   */
  dcFormula?: string;
  /** Момент броска */
  timing: EffectSaveTiming;
}

/**
 * Периодический урон (DoT): наносится в начале/конце хода носителя, пока эффект
 * активен (напр. «Горение» от огненной области — урон каждый ход, даже если
 * цель прошла исходный спасбросок). Обрабатывается на сервере при смене хода.
 */
export interface RecurringDamage {
  /** Части урона (формат `DamagePart`, поддерживают токен `@dmg.<type>`) */
  damageParts: DamagePart[];
  /** Момент нанесения урона */
  timing: EffectSaveTiming;
  /**
   * Спасбросок против урона на каждом тике: провал — полный урон, успех — по
   * `onSuccess` (без урона или половина). «Облако смерти»: кто начинает ход в
   * облаке, бросает Телосложение. Эффект при этом остаётся — снимает его только
   * `recurringSave`. `dc === 0` — Сл заклинателя, проставляется при наложении.
   */
  save?: EffectSave;
}

/** Локализованные названия триггеров области (для UI) */
export const AREA_TRIGGER_LABELS: Record<AreaEffectTrigger, string> = {
  stay: 'Пока внутри',
  enter: 'При входе',
  exit: 'При выходе',
} as const;

/**
 * Триггер «сгорания» одноразового эффекта на броске атаки.
 *
 * - `carrierAttack` — эффект снимается, когда НОСИТЕЛЬ совершает бросок атаки
 *   (помеха/преимущество ровно на одну следующую атаку самого носителя:
 *   Злая насмешка, Луч слабости);
 * - `attackOnCarrier` — эффект снимается, когда по НОСИТЕЛЮ совершают бросок
 *   атаки (преимущество следующей атаки ПО цели: Направляющий снаряд).
 *
 * В обоих случаях эффект ещё и ограничен своей `duration` (потолок «до конца
 * следующего хода») — что наступит раньше, то и снимает эффект.
 */
export type EffectAttackTrigger = 'carrierAttack' | 'attackOnCarrier';

/** Локализованные названия триггеров расхода на атаке (для UI) */
export const EFFECT_ATTACK_TRIGGER_LABELS: Record<EffectAttackTrigger, string> =
  {
    carrierAttack: 'Снять после своей атаки',
    attackOnCarrier: 'Снять после атаки по цели',
  } as const;

/** Наибольшее число зарядов у эффекта */
export const MAX_EFFECT_CHARGES = 99;

/** Наименьший запас зарядов эффекта */
export const MIN_EFFECT_CHARGES = 1;

/** Сколько зарядов у нового блока зарядов */
export const DEFAULT_EFFECT_CHARGES = 3;

/** Заряды эффекта: сколько раз ещё сработают его срабатывания */
export interface EffectCharges {
  /** Сколько зарядов было при наложении */
  max: number;
  /** Сколько осталось */
  current: number;
  /** Последний заряд снимает эффект; нет — эффект остаётся пустым */
  endsWhenEmpty?: true;
}

/** Анимации света эффекта — те же, что у света фишки ядра */
export const EFFECT_LIGHT_ANIMATIONS = [
  'none',
  'pulse',
  'flicker',
  'torch',
  'strobe',
] as const;

/** Анимация света эффекта */
export type EffectLightAnimation = (typeof EFFECT_LIGHT_ANIMATIONS)[number];

/** Дальше этого радиуса свет эффекта не бывает, фт */
export const MAX_EFFECT_LIGHT_FEET = 1000;

/**
 * Свет, который излучает носитель, пока эффект действует («Корона света»:
 * яркий 30 фт и тусклый ещё 30). Считает `entityLight.ts`.
 */
export interface EffectLight {
  /** Радиус яркого света, фт */
  bright: number;
  /**
   * Тусклый свет ЗА ярким, фт — как в тексте правил: «и тусклый ещё на 20
   * фт». Дальний край света — `bright + dim`
   */
  dim: number;
  /** Цвет `#rrggbb`; нет — белый */
  color?: string;
  /** Анимация; нет — ровный свет */
  animation?: EffectLightAnimation;
}

/** На какой отдых восстанавливается «провал в успех» своим счётчиком */
export const SAVE_OVERRIDE_PERIODS = ['shortRest', 'longRest'] as const;

/** Период своего счётчика «провал в успех»: день — это долгий отдых */
export type SaveOverridePeriod = (typeof SAVE_OVERRIDE_PERIODS)[number];

/** Больше раз за период «провал в успех» не бывает */
export const MAX_SAVE_OVERRIDE_USES = 20;

/**
 * «Провал спасброска — вместо этого успех» за ресурс: «Легендарное
 * сопротивление» (3/день), черты и предметы игроков. Носитель, проваливший
 * спасбросок, может потратить единицу и преуспеть.
 *
 * Платит своим счётчиком носителя (`limit`: N раз до отдыха) либо ресурсом
 * листа (`counter`, как у применения). Задано оба — платит ресурс листа.
 */
export interface EffectSaveOverride {
  /** Своим счётчиком: N раз за период */
  limit?: { max: number; per: SaveOverridePeriod };
  /** Ресурс листа (`system.classCounters`), тратится по единице */
  counter?: string;
}

/**
 * Active Effect — полная D&D 5e структура. Наследует нейтральную
 * `BaseActiveEffect` (кросс-катные поля: id/имя/иконка/провенанс/длительность/
 * аура/триггер области) и уточняет `changes`/`flags`/`conditionKey` D&D-типами,
 * добавляя боевые поля (спасброски/урон/периодику/иммунитеты к состояниям).
 *
 * Основной документ активного эффекта.
 * Содержит числовые модификаторы (`changes`) и булевые флаги (`flags`).
 */
export interface ActiveEffect extends BaseActiveEffect {
  /** Уникальный идентификатор эффекта */
  id: string;
  /** Название эффекта */
  name: string;
  /** Описание эффекта */
  description: string;
  /** Путь к иконке (формат tabler:icon-name) */
  icon?: string;
  /** Отключён ли эффект (временно деактивирован, но не удалён) */
  disabled: boolean;

  /** Источник эффекта */
  origin: EffectOrigin;
  /** ID объекта-источника (предмета, заклинания и т.д.) */
  originId?: string;
  /**
   * ID сущности-источника (кастера/атакующего), наложившей эффект. Нужен для
   * точной длительности `type: 'turn'` с якорем `source` («до конца хода
   * кастера») и для провенанса. Проставляется при наложении.
   */
  sourceActorId?: string;

  /**
   * Тип существа наложившего — ставится вместе с `sourceActorId`: по нему
   * спасбросок против этого эффекта включает эффекты с условием
   * `source.creatureType`, даже когда бросает сервер и наложившего не спросить
   */
  sourceCreatureType?: CreatureCategory;

  /** Переносится ли эффект с предмета на актора при экипировке */
  transfer: boolean;

  /** Длительность эффекта */
  duration: EffectDuration;

  /** Числовые модификаторы (key + mode + value) */
  changes: EffectChange[];
  /** Булевые флаги (помеха, преимущество, автопровал спасбросков) */
  flags: EffectFlagKey[];

  /** Настройки ауры (если эффект транслируется на других) */
  aura?: DndEffectAura;

  /**
   * Триггер для эффектов области/ауры. Если не задан — `stay` (эффект висит,
   * пока сущность внутри). `enter`/`exit` — разовое срабатывание нагрузки
   * (урон `damageParts` и/или статус) в момент входа/выхода.
   */
  areaTrigger?: AreaEffectTrigger;

  /**
   * «На выбор из тех, кто в области»: кого из накрытых шаблоном задевает
   * применение («Замедление»: до шести существ на выбор в кубе). Правило одно
   * на применение — заклинание, действие существа, применение умения или
   * предмета с областью; нет — задеты все, кого накрыл шаблон
   * (`areaChoice.ts`)
   */
  areaChoice?: EffectAreaChoice;

  /**
   * Цель применения эффекта.
   * - `'self'` (по умолчанию) — применяется к владельцу при экипировке
   * - `'target'` — применяется к цели при попадании атакой
   * - `'zone'` — уходит в зону, которую заклинание оставляет на месте шаблона;
   *   на заклинателе и на целях каста не действует
   */
  effectTarget?: 'self' | 'target' | 'zone';

  /**
   * Эффект навязан магией, хотя пришёл не заклинанием напрямую: копия эффекта
   * зоны заклинания на стоящем в ней (`origin: 'area'`) и статус от входа в неё
   * (`origin: 'condition'`). Даёт спасброску преимущество защиты от магии.
   */
  magical?: true;

  /**
   * Зона заклинания, из которой пришёл статус при входе. Заклинание кончилось —
   * зоны на сцене нет — и статус снимается вместе с ней («Опутанный» от
   * «Паутины»). У статусов зон мастера поля нет: они живут своей длительностью.
   */
  endsWithAreaId?: string;

  /**
   * Зона, выход из которой снимает статус («Опутанность спадает, как только
   * выйдешь из Паутины»). От {@link endsWithAreaId} отличается моментом: тот
   * ждёт конца самой зоны, а этот — ухода существа из неё.
   */
  endsOnExitAreaId?: string;

  /**
   * Ключ состояния, если эффект представляет состояние — канонное (Испуганный,
   * Отравленный) либо заведённое в мире. Используется для проверки иммунитета
   * цели к состоянию и устойчивого опознания состояния (надёжнее сопоставления
   * по имени). Для обычных числовых баффов не задаётся.
   */
  conditionKey?: ConditionRef;

  /**
   * Ключ отметки: эффект наложен действием срабатывания «Отметка» и читается
   * условием `self.tag === "…"`. Отметки с одним ключом не стакаются.
   */
  tag?: string;

  /**
   * Ступени отметки-счётчика: сколько раз её поставили действием с `stack`.
   * Нет поля — одна.
   */
  tagStacks?: number;

  /**
   * Условие наложения: эффект ложится, только если оно выполнено. Строка
   * словаря срабатываний на событии «при наложении»: субъект — тот, на кого
   * ложится эффект, другая сторона — кто накладывает; `source.weaponMastery` —
   * атакующий владеет приёмом оружия («Опрокидывание»). Считается до урона
   * этого удара; «после урона» — срабатывание «при наложении».
   */
  landingCondition?: string;

  /**
   * Вариант: из эффектов одной группы ложится один — выбранный при касте или
   * случайный («Глухота/слепота», «Лучи глаз»).
   */
  variant?: EffectVariant;

  /**
   * Условие броска: эффект не входит в числа листа и действует только в
   * бросках, где условие выполнено, — флагами и прибавками. У атакующего —
   * словарь броска («Тактика стаи»: `target.allyAdjacent`), у защитника —
   * входящей атаки («Защита от добра и зла»:
   * `incoming.attackerCreatureType === "fiend"`). Условие о носителе
   * считается и на листе.
   */
  rollCondition?: string;

  /**
   * Применение или включение: эффект не действует сам, пока источник не
   * применили («Зелье лечения», «Стрела +1») или эффект не включили
   * («Ярость»). Нет поля — действует постоянно.
   */
  activation?: EffectActivation;

  /**
   * Цена ресурсом: что тратит тот, кто применяет, включает или колдует, —
   * ячейку, кости хитов, счётчик листа, заряды предмета, вдохновение. У
   * эффекта заклинания это цена каста сверх ячейки («потратьте две Кости
   * Хитов, иначе заклинание провалится»), у применения и переключателя — цена
   * кнопки. Не хватает ресурса — применение, включение и каст не состоятся.
   * Считает {@link module:system/dnd/effectPay}.
   */
  pay?: EffectPay;

  /**
   * Что потрачено ценой: числа токенов `@paid.*`. Проставляется при оплате и
   * живёт у наложенного или включённого эффекта, как круг каста: по нему
   * считаются формулы эффекта и его срабатываний, пока он действует.
   */
  paid?: EffectPaid;

  /**
   * Каст заклинания, к которому относится эффект: общий у эффектов заклинателя,
   * целей и зоны одного каста. Конец каста снимает их все.
   */
  castId?: string;

  /**
   * Круг, которым каст сотворён: по нему «Рассеивание магии» решает, снимать
   * ли эффект. Проставляется при касте; у эффекта из компендиума и у зоны
   * мастера круга нет.
   */
  castLevel?: number;

  /**
   * Состояние снимается только тем, что его наложило: плитка состояния на
   * листе и действие «снять состояние» его не трогают.
   */
  conditionLocked?: true;

  /**
   * Заряды эффекта: сколько раз ещё сработают его срабатывания. Каждое
   * сработавшее тратит один заряд; зарядов не осталось — срабатывания молчат.
   *
   * Заряды считаются только у эффекта, который ЛЕЖИТ на существе: у ауры
   * чужого токена и у эффекта зоны своего экземпляра нет, и тратить нечего.
   */
  charges?: EffectCharges;

  /**
   * «Провал спасброска — вместо этого успех» за ресурс
   * (`saveOverride.ts`): после проваленного спасброска владельцу носителя
   * предлагают преуспеть, пока ресурс не кончился.
   */
  saveOverride?: EffectSaveOverride;

  /** Свет, который излучает носитель, пока эффект действует */
  light?: EffectLight;

  /**
   * Сохранённый бросок: формула, которую бросают ОДИН раз — при наложении.
   * Результат подставляется вместо токена `@roll` во все формулы эффекта и
   * дальше не меняется: «Вибрирующие жидкости» бьют одним и тем же числом на
   * каждом тике, а не катают кость заново при каждом пересчёте листа.
   *
   * Считается в {@link module:system/dnd/applyTimeFormulas}.
   */
  savedRoll?: string;

  /** Результат сохранённого броска — уже подставлен в формулы эффекта */
  savedRollValue?: number;

  /**
   * Предмет, с которого эффект пришёл на носителя. Проставляется при СБОРЕ
   * эффектов (`listCarriedEffectEntries`), а не автором: по нему ключи
   * `damage.weapon` и `attack.weapon` достаются именно этому оружию, а не всем
   * атакам носителя. Эффект уезжает вместе с вещью — он лежит в ней самой.
   */
  carriedItemId?: string;

  /**
   * Срок формулой: «1к4» раунда у «Замешательства», «1 + @mod.con» у умения.
   * Бросается один раз, при наложении, и уезжает числом в `duration.value` —
   * дальше эффект живёт обычным сроком. Задаётся вместо числа срока, не вместе
   * с ним.
   */
  durationFormula?: string;

  /**
   * Метка концентрации: эффект держит каст `castId`, его срабатывания урона и
   * 0 хитов заканчивают каст. Метка у заклинателя одна.
   */
  concentration?: true;

  /**
   * Спасбросок при наложении: если задан, цель кидает спас в момент применения
   * эффекта (напр. при попадании атакой). Провал — эффект и его урон
   * применяются; успех — отменяет/уменьшает по `onSuccess`. Заменяет прежний
   * механизм «райдеров».
   */
  applySave?: EffectSave;

  /**
   * Накладывать эффект-состояние ДАЖЕ при успешном спасброске (собственный
   * `applySave` либо спасбросок уровня действия для области). Урон при этом
   * считается по `onSuccess` (нет/половина). Покрывает кейс «по области:
   * прокинул спас, но статус всё равно висит». По умолчанию `false`.
   */
  applyOnSuccess?: boolean;

  /**
   * Накладывать эффект ТОЛЬКО при успешном спасброске уровня действия и НЕ
   * накладывать при провале (зеркало `applyOnSuccess`). Нужно для заклинаний
   * с разными исходами «успех/провал» (Луч слабости: при успехе — помеха на
   * одну атаку; при провале — длительные штрафы отдельным эффектом). По
   * умолчанию `false`.
   */
  applyOnSuccessOnly?: boolean;

  /**
   * Одноразовость на броске атаки: эффект «сгорает» после первого же
   * подходящего броска атаки (см. `EffectAttackTrigger`), не дожидаясь конца
   * `duration`. Моделирует формулировку «помеха/преимущество на СЛЕДУЮЩИЙ бросок
   * атаки». Если не задан — эффект живёт по обычной длительности.
   */
  consumeOn?: EffectAttackTrigger;

  /**
   * Урон, наносимый при наложении эффекта (гейтится `applySave`: провал —
   * полный, успех — по `onSuccess`). Единая со заклинаниями система `DamagePart`
   * (напр. яд паука «2к8, половина при успехе»).
   */
  damageParts?: DamagePart[];

  /**
   * Периодический спасбросок для снятия эффекта (начало/конец хода носителя).
   * Обрабатывается сервером при смене хода в энкаунтере.
   */
  recurringSave?: RecurringSave;

  /**
   * Периодический урон (DoT) в начале/конце хода носителя, пока эффект активен
   * (напр. «Горение»). Обрабатывается сервером при смене хода в энкаунтере.
   */
  recurringDamage?: RecurringDamage;

  /**
   * Срабатывания, которых не выражают старые поля (урон каждый ход, повторный
   * спасбросок, снятие после атаки): лимит «раз в ход», состояние на ходу,
   * ход источника. Старые поля читаются как срабатывания `legacy.*` —
   * `collectEffectTriggers` (`effectTriggers.ts`).
   */
  triggers?: EffectTrigger[];

  /**
   * Состояния, которые эффект ПОДАВЛЯЕТ, не снимая: «Свобода перемещения»
   * гасит Опутанного, а когда кончится, состояние снова действует. Отличие от
   * иммунитета: иммунитет не даёт состоянию лечь, подавление — обратимо.
   */
  suppressConditions?: ConditionRef[];

  /**
   * Состояния, к которым эффект даёт иммунитет (напр. вид-грант «иммунитет к
   * отравлению»). У актёров нет `system.defenses` — иммунитет к состояниям
   * приходит именно отсюда; собирается `getEntityConditionImmunities`.
   */
  conditionImmunities?: ConditionRef[];

  /**
   * Степень Истощения (1–6), если `conditionKey === 'exhaustion'`.
   *
   * Хранится на самом эффекте, потому что штрафы Истощения разворачиваются в
   * набор `changes` и по ним степень уже не восстановить. Панель истощения
   * читает это поле, а при смене степени эффект пересобирается целиком
   * (`buildConditionActiveEffect`).
   */
  exhaustionLevel?: number;

  /**
   * Действие, снимающее эффект: кнопка «Вырваться» на вкладке «Эффекты»
   * листа. Без поля кнопки нет.
   */
  escape?: EffectEscape;

  /**
   * Срок по ходу — до конца ТЕКУЩЕГО хода: «скорость 0 до конца текущего
   * хода», «до конца вашего хода». Эффект, наложенный в ход якоря, обычно
   * живёт до конца его СЛЕДУЮЩЕГО хода (`turnSkipFirst`); с этим полем он
   * кончается с концом этого же хода. Наложенный вне хода якоря — как всегда:
   * до конца его ближайшего хода.
   */
  turnCurrent?: true;

  /**
   * Складывается с одноимёнными: повторное наложение не заменяет прежнее, а
   * ложится рядом («урон кумулятивный», «каждое попадание — ещё −1 к КД»).
   * Без поля действует общее правило: одноимённый эффект обновляется.
   */
  stackable?: true;

  /**
   * Правило каста носителя, пока эффект на нём: лимит круга ячейки и провал
   * каста шансом или спасброском (`effectCastRule.ts`).
   */
  castRule?: EffectCastRule;

  /**
   * Ступени эффекта: каждая со своими `changes` и `flags`. Перевод на
   * следующую переписывает их у эффекта (`advanceEffectStage`) — конвейер
   * листа о ступенях не знает.
   */
  stages?: EffectStage[];

  /** Какая ступень действует сейчас; нет — первая (0) */
  stageIndex?: number;
}

/**
 * Доверенное сужение нейтрального эффекта к D&D-форме. В мире D&D эффекты (на
 * акторах, предметах, областях) авторятся полной формой `ActiveEffect`;
 * нейтральная база `BaseActiveEffect` лишь скрывает D&D-поля (`changes`/`flags`/
 * `conditionKey`) от ядра. Внутри D&D-движка читаем их типизированно — тот же
 * доверенный шов, что и `isDnDActorEntity` (система знает форму своих данных).
 * Используется как guard в `.filter(isDnDEffect)` при чтении `activeEffects`/
 * `CustomArea.effects`, типизированных нейтральной базой.
 */
export function isDnDEffect(
  _effect: BaseActiveEffect,
): _effect is ActiveEffect {
  return true;
}

/**
 * Действует ли эффект на своего носителя: не адресован цели атаки и не уходит
 * в зону заклинания.
 *
 * @param effect - эффект
 * @returns `true` для эффекта «на носителе» (в том числе без поля)
 */
export function isCarrierEffect(
  effect: Pick<ActiveEffect, 'effectTarget'>,
): boolean {
  return (effect.effectTarget ?? 'self') === 'self';
}

/**
 * Накладывается ли эффект только применением источника.
 *
 * @param effect - эффект
 * @returns `true` для `activation.mode === 'use'`
 */
export function isUseActivatedEffect(
  effect: Pick<ActiveEffect, 'activation'>,
): boolean {
  return effect.activation?.mode === 'use';
}

/**
 * Спит ли эффект: выключен или ждёт применения. Спящий эффект лежит на листе
 * или предмете, но не действует — ни числами, ни флагами, ни аурой, ни
 * срабатываниями. Применение кладёт его действующую копию.
 *
 * @param effect - эффект
 * @returns `true`, если эффект сейчас не действует
 */
export function isEffectDormant(
  effect: Pick<ActiveEffect, 'disabled' | 'activation'>,
): boolean {
  return effect.disabled === true || isUseActivatedEffect(effect);
}

/**
 * Действующие эффекты носителя — без спящих.
 *
 * @param holder - носитель эффектов
 * @param holder.activeEffects - его эффекты
 * @returns действующие эффекты
 */
export function listLiveEffects(holder: {
  activeEffects?: readonly ActiveEffect[];
}): ActiveEffect[] {
  return (holder.activeEffects ?? []).filter(
    (effect) => !isEffectDormant(effect),
  );
}

/**
 * Есть ли на сущности состояние. Недееспособность дают и другие состояния
 * («Парализованный», «Ошеломлённый») — их флагом. Живёт рядом с
 * `listLiveEffects`, а не в условиях срабатываний: её зовёт и проверка цели
 * урона, и из условий срабатываний она вела бы в кольцо импортов.
 *
 * @param entity - сущность
 * @param entity.activeEffects - эффекты сущности
 * @param condition - ключ состояния
 * @returns `true`, если состояние есть
 */
export function hasEntityCondition(
  entity: { activeEffects?: readonly ActiveEffect[] },
  condition: string,
): boolean {
  const effects = listLiveEffects(entity);

  if (effects.some((effect) => effect.conditionKey === condition)) {
    return true;
  }

  // Недееспособность ставят и другие состояния — своим флагом
  return (
    condition === INCAPACITATED_CONDITION_KEY
    && effects.some((effect) =>
      effect.flags.includes(INCAPACITATED_CONDITION_KEY),
    )
  );
}

/**
 * Флаг «Увёртливости» характеристики спасброска.
 *
 * @param ability - характеристика
 * @returns ключ флага
 */
export function buildSaveEvasionFlag(ability: AbilityType): SaveEvasionFlagKey {
  return `save.evasion.${ability}`;
}

/**
 * Включают ли эффект переключателем.
 *
 * @param effect - эффект
 * @returns `true` для `activation.mode === 'toggle'`
 */
export function isToggleActivatedEffect(
  effect: Pick<ActiveEffect, 'activation'>,
): boolean {
  return effect.activation?.mode === 'toggle';
}

/**
 * Эффект, который ложится на лист из умения, черты или вида: с применением или
 * включением — выключенным. Переключаемый включают руками; шаблон применения
 * не действует никогда, а выключенным его не примет за состояние и ядро,
 * которое про применение не знает (значок на фишке).
 *
 * @param effect - эффект записи
 * @returns эффект для листа
 */
export function withActivationDefaults(effect: ActiveEffect): ActiveEffect {
  return effect.activation ? { ...effect, disabled: true } : effect;
}

/**
 * Эффекты, которые уходят с сущности: переключаемый не удаляется, а
 * выключается — снять его с листа значило бы потерять умение.
 *
 * @param effects - эффекты сущности
 * @param isRemoved - уходит ли эффект
 * @returns оставшиеся эффекты
 */
export function removeOrSwitchOffEffects(
  effects: readonly ActiveEffect[],
  isRemoved: (effect: ActiveEffect) => boolean,
): ActiveEffect[] {
  return effects.flatMap((effect) => {
    if (!isRemoved(effect)) {
      return [effect];
    }

    return isToggleActivatedEffect(effect)
      ? [{ ...effect, disabled: true }]
      : [];
  });
}

/**
 * Все источники эффекта — рантайм-зеркало `EffectOrigin`.
 * Кортеж, а не массив: из него же строится Zod-перечисление схемы эффекта,
 * поэтому список источников живёт ровно в одном месте.
 */
const EFFECT_ORIGIN_VALUES = [
  'item',
  'spell',
  'feature',
  'condition',
  'manual',
  'area',
] as const satisfies readonly EffectOrigin[];

/** Множество источников эффекта для быстрой проверки строки */
const EFFECT_ORIGIN_SET: ReadonlySet<string> = new Set(EFFECT_ORIGIN_VALUES);

/**
 * Проверяет, что строка — известный источник эффекта.
 *
 * Нужна на границе с ядром: в контракте `VttSystem.applyEffectsToEntity`
 * источник объявлен обычной строкой, а правила слияния эффектов завязаны на
 * конкретные значения.
 *
 * @param value - произвольная строка источника
 * @returns `true`, если это известный источник эффекта
 */
export function isEffectOrigin(value: string): value is EffectOrigin {
  return EFFECT_ORIGIN_SET.has(value);
}

/**
 * Проверяет, что произвольное значение — активный эффект D&D 5e.
 *
 * Отличается от {@link isDnDEffect} входом: там эффект уже пришёл нейтральной
 * базой ядра, здесь — совсем непрозрачным `unknown` (контракт `VttSystem`
 * объявляет списки эффектов как `readonly unknown[]`). Проверка структурная и
 * намеренно ленивая, как у схем предметов: сверяется то, по чему эффект
 * узнают и показывают, — идентификатор и название.
 *
 * Источник (`origin`) НЕ проверяется намеренно: у эффектов старых миров его
 * может не быть, а строже здесь нельзя — отброшенный эффект это потерянные
 * бонусы листа. Сравнения с источником ниже по коду безопасны на любом
 * значении.
 *
 * А вот форма трёх полей проверяется: `changes` и `flags` перебираются циклом
 * (`applyActiveEffects`, `collectDerivedChanges`, `validateActor`), а
 * `duration` читается по полю на каждой смене хода. Эффект без них ронял бы
 * расчёт листа и серверный тик раунда исключением, а терять при этом нечего —
 * бонусов у такого эффекта всё равно нет.
 *
 * @param value - произвольное значение из списка эффектов ядра
 * @returns `true`, если значение — активный эффект
 */
export function isActiveEffect(value: unknown): value is ActiveEffect {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && Array.isArray(value.changes)
    && Array.isArray(value.flags)
    && isRecord(value.duration)
  );
}

// ── ResolvedActorStats ────────────────────────────────────────

/** Замена свойства оружия, собранная конвейером из строки `weapon.*` */
export interface WeaponOverrideEntry {
  /** Что заменяется */
  key: WeaponOverrideKey;
  /** Новое значение строкой: кость, ключ характеристики или типа урона */
  value: string;
  /** Виды оружия из условия `weapon.baseType`; нет — любое оружие */
  baseTypes?: string[];
  /** Эффект лежит на самом предмете — замена только для него */
  itemId?: string;
  /** Порядок применения: при равном побеждает последняя */
  priority: number;
  /** Название эффекта — для подписи в разборе */
  sourceName: string;
}

/**
 * Промежуточные «resolved» статы актора после прохождения пайплайна.
 *
 * Это результат `resolveActorStats(actor)` — содержит все вычисленные значения
 * с учётом всех активных эффектов (changes + flags).
 */
export interface ResolvedActorStats {
  /** Значения характеристик (ability scores) */
  abilities: Record<AbilityType, number>;
  /** Модификаторы характеристик */
  abilityMods: Record<AbilityType, number>;
  /** Бонусы к спасброскам */
  saves: Record<AbilityType, number>;
  /** Бонусы к навыкам */
  skills: Record<SkillType, number>;
  /**
   * Прибавка ко всем проверкам характеристик ({@link ABILITY_CHECK_KEY}). В
   * навыки уже вошла: навык — та же проверка характеристики.
   */
  abilityCheckBonus: number;
  /** Прибавка к спасброскам концентрации ({@link CONCENTRATION_SAVE_KEY}) */
  concentrationSaveBonus: number;
  /** Прибавка к спасброскам от смерти ({@link DEATH_SAVE_KEY}) */
  deathSaveBonus: number;
  /** Класс доспеха */
  armorClass: number;
  /** Модификатор инициативы */
  initiative: number;
  /** Бонус мастерства */
  proficiencyBonus: number;
  /** Скорости передвижения */
  movement: Record<MovementType, number>;
  /**
   * Дальности чувств в футах (`0` — чувства нет).
   *
   * Это справка листа, а не механика сцены: зрение токена в контракте
   * приложения знает только тёмное зрение, поэтому числа отсюда показываются
   * бейджем в шапке, но на видимость не влияют (README, § «Чего не хватает для
   * полноценного SDK», п. 12).
   */
  senses: Record<SenseType, number>;
  /** Максимум хитов */
  hitPointsMax: number;
  /**
   * С какой натуральной кости атака оружием — крит (20 по правилам, 19 у
   * «Улучшенного крита» Чемпиона)
   */
  critThreshold: number;
  /** Бонусы к атаке */
  attackBonuses: {
    melee: number;
    ranged: number;
    spell: number;
  };
  /** Бонусы к урону */
  damageBonuses: {
    melee: number;
    ranged: number;
    spell: number;
  };
  /**
   * Бонусы к урону оружия только при атаке этой характеристикой («Ярость» —
   * атаки Силой). Оружие добавляет к себе бонус той характеристики, которой
   * бьёт: секира Силой получает его, рапира через Ловкость — нет.
   */
  abilityDamageBonuses: {
    melee: Partial<Record<AbilityType, number>>;
    ranged: Partial<Record<AbilityType, number>>;
  };
  /**
   * Замены свойств оружия от эффектов («Дубинка»): кость, характеристика и тип
   * урона. Лежат строками — каждое оружие листа выбирает свои по виду и
   * предмету (`weaponOverrides.ts`).
   */
  weaponOverrides: WeaponOverrideEntry[];
  /** DC спасброска заклинаний */
  spellSaveDC: number;
  /** Активные булевые флаги от всех эффектов */
  activeFlags: Set<EffectFlagKey>;
  /**
   * Защиты от урона по типам — собираются из статического поля
   * `system.defenses` (существа и будущие сущности) и флагов активных
   * эффектов (`resistance.*` / `immunity.*` / `vulnerability.*`).
   */
  damageDefenses: {
    /** Иммунитеты: урон игнорируется (множитель 0) */
    immunities: Set<DefensibleDamageType>;
    /** Сопротивления: урон уменьшается вдвое (множитель 0.5) */
    resistances: Set<DefensibleDamageType>;
    /** Уязвимости: урон удваивается (множитель 2) */
    vulnerabilities: Set<DefensibleDamageType>;
  };
  /** Ключи полей, перезаписанных режимом 'override' (не добавлять базовые значения в Фазе 3) */
  overriddenKeys: Set<string>;

  /**
   * Числа листа, от которых посчитаны свои бонусы к характеристикам: сами
   * характеристики к этому моменту ещё без них.
   *
   * Лист берёт их, чтобы показать в подсказке ровно те слагаемые, что взял
   * расчёт: бонус «+мод. Мудрости к Силе» считается до прибавок, и по
   * итоговым модификаторам он показал бы другое число.
   */
  abilityBonusContext: DnDCustomBonusContext;
}

// ── Константы ─────────────────────────────────────────────────

/** Приоритет по умолчанию для нового изменения */
export const DEFAULT_EFFECT_CHANGE_PRIORITY = 20;

/** Натуральная кость крита по правилам (`critThreshold` без эффектов) */
export const DEFAULT_CRIT_THRESHOLD = 20;

/** Максимальное количество эффектов на актора */
export const MAX_EFFECTS_PER_ACTOR = 50;

/**
 * Максимальное количество changes на один эффект.
 *
 * Поднято с 20: Истощение (PHB 2024) накладывает −2 ко ВСЕМ d20-тестам, что в
 * нашей модели разворачивается в отдельные числовые changes для атак (3),
 * спасбросков (6), навыков (18) и видов скорости (5) — до 32 на эффект (см.
 * `buildExhaustionChanges`). 40 оставляет запас и для ручных эффектов.
 */
export const MAX_CHANGES_PER_EFFECT = 40;

// ── Zod-схемы для валидации ───────────────────────────────────

export {
  MAX_SAVE_DC_FORMULA_LENGTH,
  parseFormNumber,
  SOURCE_SAVE_DC,
} from './effectSchemaParts.js';

/**
 * Zod-схема для валидации EffectChange.
 *
 * Используется на сервере для проверки входящих данных от клиента.
 */
export const EffectChangeSchema = z.object({
  /**
   * Ключ цели модификации.
   *
   * Рантайм НАМЕРЕННО остаётся широким: тут проходит любая строка. Сузить до
   * перечисления `EffectTargetKey` нельзя — разбор идёт целиком
   * (`if (!parsed.success) return false`), и один незнакомый ключ из хоумбрю или
   * старого мира отменил бы применение ВСЕГО набора эффектов. Неизвестный ключ
   * безвреден: конвейер эффектов просто не находит для него обработчик.
   *
   * А вот выводимый ТИП обязан совпадать с `EffectChange.key`, иначе результат
   * разбора не присвоить в `activeEffects` (было `TS2322` в
   * `damageApplication.ts`). `z.custom` даёт узкий тип без `as` и без `any`.
   */
  key: z.custom<EffectChangeKey>((value) => typeof value === 'string'),
  mode: z.enum([
    'add',
    'multiply',
    'override',
    'upgrade',
    'downgrade',
    'custom',
  ]),
  value: z.string().min(1),
  condition: z.string().optional(),
  step: z
    .object({
      by: z
        .number()
        .int()
        .min(-MAX_EFFECT_CHANGE_STEP)
        .max(MAX_EFFECT_CHANGE_STEP),
      per: z.enum(EFFECT_CHANGE_STEP_PERIODS),
      until: z.preprocess(
        coerceOptionalNumber,
        z.number().int().optional().catch(undefined),
      ),
    })
    .optional()
    .catch(undefined),
  // Очищенный приоритет — не повод терять строку: берём приоритет по умолчанию
  priority: z
    .preprocess(coerceOptionalNumber, z.number().int().min(0).max(100))
    .catch(DEFAULT_EFFECT_CHANGE_PRIORITY),
});

/**
 * Zod-схема списка модификаторов эффекта.
 *
 * Строки разбираются ПО ОДНОЙ: негодная (пустое значение, незнакомый режим)
 * отбрасывается, остальные остаются. Разбор списком целиком стирал все
 * модификаторы эффекта из-за одной недописанной строки — там, где разобранный
 * эффект записывается обратно (боевой канал, шаблон состояния). Лишние сверх
 * предела строки отсекаются, а не отменяют разбор.
 */
const EffectChangesSchema = z.array(z.unknown()).transform((rows) =>
  rows
    .flatMap((row) => {
      const parsed = EffectChangeSchema.safeParse(row);

      return parsed.success ? [parsed.data] : [];
    })
    .slice(0, MAX_CHANGES_PER_EFFECT),
);

/** Zod-схема зарядов эффекта */
export const EffectChargesSchema = z.object({
  max: z.number().int().min(MIN_EFFECT_CHARGES).max(MAX_EFFECT_CHARGES),
  current: z.number().int().min(0).max(MAX_EFFECT_CHARGES),
  endsWhenEmpty: z.literal(true).optional().catch(undefined),
});

/** Радиус света эффекта в футах */
const EffectLightFeetSchema = z.number().min(0).max(MAX_EFFECT_LIGHT_FEET);

/**
 * Zod-схема света эффекта: свет без радиуса отбрасывается, неверный цвет —
 * белый.
 */
const EffectLightSchema = z
  .object({
    bright: EffectLightFeetSchema,
    dim: EffectLightFeetSchema,
    color: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .optional()
      .catch(undefined),
    animation: z.enum(EFFECT_LIGHT_ANIMATIONS).optional().catch(undefined),
  })
  .refine((light) => light.bright + light.dim > 0);

/**
 * Zod-схема «провал в успех»: блок без счётчика и без ресурса платить нечем —
 * отбрасывается целиком.
 */
const EffectSaveOverrideSchema = z
  .object({
    limit: z
      .object({
        max: z.number().int().min(1).max(MAX_SAVE_OVERRIDE_USES),
        per: z.enum(SAVE_OVERRIDE_PERIODS),
      })
      .optional()
      .catch(undefined),
    counter: z.string().trim().min(1).max(100).optional().catch(undefined),
  })
  .refine((value) => value.limit !== undefined || value.counter !== undefined);

/**
 * Zod-схема для валидации EffectDuration.
 */
export const EffectDurationSchema = z.object({
  type: z.enum([
    'permanent',
    'rounds',
    'minutes',
    'hours',
    'days',
    'turn',
    'special',
  ]),
  // Очищенное количество не должно превращать «Раунды» в «Постоянно»: без
  // приведения длительность целиком падала в значение по умолчанию
  value: z.preprocess(coerceOptionalNumber, z.number().int().min(0).optional()),
  remaining: z.preprocess(
    coerceOptionalNumber,
    z.number().int().min(0).optional(),
  ),
  turnAnchor: z.enum(['carrier', 'source']).optional(),
  turnTiming: z.enum(['start', 'end']).optional(),
  turnSkipFirst: z.boolean().optional(),
});

export const EffectAuraSchema = z.object({
  radius: z.number().min(0),
  target: z.enum(['allies', 'enemies', 'all']),
  applyToSelf: z.boolean(),
  visible: z.boolean().optional(),
  color: z.string().optional(),
  radiusFormula: z.string().trim().min(1).optional().catch(undefined),
  whileCapable: z.literal(true).optional().catch(undefined),
});

/** Самый длинный ключ счётчика применения */
const MAX_ACTIVATION_COUNTER_LENGTH = 100;

/** Дальше этого предела цена перемещения не считается */
const MAX_MOVE_COST_FEET = 200;

/** Zod-схема сложности спасброска: число, в том числе набранное строкой */
const EffectSaveDcSchema = z.preprocess(coerceOptionalNumber, z.number().int());

/** Больше характеристик на выбор у одного спасброска не бывает */
export const MAX_SAVE_ALT_ABILITIES = 5;

/**
 * Zod-схема характеристик на выбор бросающего: чужая характеристика
 * выбрасывается одна, пустой список — целиком.
 */
const SaveAltAbilitiesSchema = z
  .array(z.string())
  .transform((abilities) => {
    const known = abilities
      .filter(isAbilityType)
      .slice(0, MAX_SAVE_ALT_ABILITIES);

    return known.length > 0 ? known : undefined;
  })
  .optional()
  .catch(undefined);

/** Zod-схема спасброска при наложении эффекта */
const EffectSaveSchema = z.object({
  allowWilling: z.literal(true).optional().catch(undefined),
  ability: z.enum(SAVE_ABILITY_VALUES),
  altAbilities: SaveAltAbilitiesSchema,
  dc: EffectSaveDcSchema,
  dcFormula: SaveDcFormulaSchema,
  dcSkill: z.string().refine(isSkillType).optional().catch(undefined),
  onSuccess: z.enum(['negate', 'half']),
});

/** Zod-схема периодического спасброска для снятия эффекта */
const RecurringSaveSchema = z.object({
  ability: z.enum(SAVE_ABILITY_VALUES),
  dc: EffectSaveDcSchema,
  dcFormula: SaveDcFormulaSchema,
  timing: z.enum(EFFECT_SAVE_TIMINGS),
});

/**
 * Zod-схема части урона (подмножество DamagePart). Общая для эффектов и урона
 * «или» у действий существа: часть урона везде одна и та же.
 */
export const EffectDamagePartSchema = z.object({
  formula: z.string(),
  type: z.enum(DAMAGE_TYPES).optional(),
  target: z.enum(DAMAGE_PART_TARGETS).optional(),
  requiresDamage: z.boolean().optional(),
  versatileFormula: z.string().optional(),
});

/** Zod-схема периодического урона (DoT) */
const RecurringDamageSchema = z.object({
  damageParts: z.array(EffectDamagePartSchema),
  timing: z.enum(EFFECT_SAVE_TIMINGS),
  save: EffectSaveSchema.optional(),
});

/** Приставка id эффектов, которые движок кладёт на сущность сам */
export const ACTIVE_EFFECT_ID_PREFIX = 'ae';

/** Самый длинный id каста — как у черновика области ядра */
const MAX_CAST_ID_LENGTH = 64;

/** Самая длинная формула действия срабатывания: урон максимума, хиты */
const MAX_TRIGGER_FORMULA_LENGTH = 200;

/**
 * Zod-схема формулы действия срабатывания. Число из старых данных («вернуть 2
 * единицы») читается как формула из одного числа.
 */
const TriggerFormulaSchema = formulaTextSchema(MAX_TRIGGER_FORMULA_LENGTH);

/** Больше правил режима у одного спасброска не бывает */
const MAX_SAVE_MODE_RULES = 8;

/** Zod-схема спасброска срабатывания */
const EffectTriggerSaveSchema = z.object({
  ability: z.enum(SAVE_ABILITY_VALUES),
  altAbilities: SaveAltAbilitiesSchema,
  dc: EffectSaveDcSchema,
  mode: z.enum(EFFECT_TRIGGER_SAVE_MODES).optional().catch(undefined),
  dcFormula: SaveDcFormulaSchema,
  modeIf: z
    .array(
      z.object({
        condition: z.string().trim().min(1),
        mode: z.enum(EFFECT_TRIGGER_SAVE_MODES),
      }),
    )
    .max(MAX_SAVE_MODE_RULES)
    .optional()
    .catch(undefined),
  autoSuccessIf: z.string().trim().min(1).optional().catch(undefined),
  autoFailIf: z.string().trim().min(1).optional().catch(undefined),
});

/** Zod-схема гейта действия срабатывания */
const EffectTriggerGateSchema = z
  .enum(EFFECT_TRIGGER_ACTION_GATES)
  .optional()
  .catch(undefined);

/** Zod-схемы действий срабатывания, кроме наложения состояния */
const EFFECT_TRIGGER_PLAIN_ACTION_SCHEMAS = [
  z.object({
    type: z.literal('damage'),
    parts: z.array(EffectDamagePartSchema),
    on: EffectTriggerGateSchema,
    halfOnSave: z.literal(true).optional().catch(undefined),
  }),
  z.object({ type: z.literal('applySelf'), on: EffectTriggerGateSchema }),
  z.object({
    type: z.literal('applyTag'),
    tag: z.string().regex(EFFECT_TAG_PATTERN),
    label: z.string().min(1).optional().catch(undefined),
    duration: EffectDurationSchema.optional().catch(undefined),
    durationFormula: TriggerFormulaSchema.optional().catch(undefined),
    stack: z.literal(true).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('reduceMaxHp'),
    amount: z.string().trim().min(1).max(MAX_TRIGGER_FORMULA_LENGTH),
    endsOnRest: z
      .enum(EFFECT_TRIGGER_MAX_HP_REST_ENDS)
      .optional()
      .catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('setHp'),
    value: z.preprocess(coerceOptionalNumber, z.number().int().min(0)),
    formula: TriggerFormulaSchema.optional().catch(undefined),
    toMax: z.literal(true).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('tempHp'),
    amount: z.string().trim().min(1).max(MAX_TRIGGER_FORMULA_LENGTH),
    mode: z.enum(EFFECT_TEMP_HP_MODES).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('removeCondition'),
    conditionKey: z.string().min(1).optional().catch(undefined),
    fromCreatureTypes: z
      .array(z.string())
      .transform((types) => types.filter(isCreatureCategory))
      .optional()
      .catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({ type: z.literal('kill'), on: EffectTriggerGateSchema }),
  z.object({
    type: z.literal('revive'),
    hp: z.preprocess(
      coerceOptionalNumber,
      z.number().int().min(MIN_REVIVE_HP).optional().catch(undefined),
    ),
    full: z.literal(true).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({ type: z.literal('dropHeld'), on: EffectTriggerGateSchema }),
  z.object({
    type: z.literal('restore'),
    what: z.enum(EFFECT_RESTORE_KINDS),
    level: z.preprocess(
      coerceOptionalNumber,
      z
        .number()
        .int()
        .min(MIN_SPELL_SLOT_LEVEL)
        .max(MAX_SPELL_SLOT_LEVEL)
        .optional()
        .catch(undefined),
    ),
    counter: z
      .string()
      .trim()
      .min(1)
      .max(MAX_ACTIVATION_COUNTER_LENGTH)
      .optional()
      .catch(undefined),
    amount: TriggerFormulaSchema.optional().catch(undefined),
    set: z.literal(true).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('dispel'),
    maxLevel: z.preprocess(
      coerceOptionalNumber,
      z.number().int().min(CANTRIP_SPELL_LEVEL).max(MAX_SPELL_SLOT_LEVEL),
    ),
    maxLevelFormula: z
      .string()
      .trim()
      .min(1)
      .max(MAX_TRIGGER_FORMULA_LENGTH)
      .optional()
      .catch(undefined),
    withoutLevel: z.literal(true).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('grantInspiration'),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('move'),
    kind: z.enum(EFFECT_TRIGGER_MOVE_KINDS),
    distance: z.preprocess(
      coerceOptionalNumber,
      z.number().int().min(0).max(MAX_TRIGGER_MOVE_DISTANCE),
    ),
    upTo: z.literal(true).optional().catch(undefined),
    from: z.enum(EFFECT_TRIGGER_MOVE_ORIGINS).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('moveArea'),
    kind: z.enum(EFFECT_TRIGGER_AREA_SHIFT_KINDS),
    distance: z.preprocess(
      coerceOptionalNumber,
      z
        .number()
        .int()
        .min(0)
        .max(MAX_TRIGGER_MOVE_DISTANCE)
        .optional()
        .catch(undefined),
    ),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('endCast'),
    whose: z.enum(EFFECT_CAST_OWNERS).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('notify'),
    text: z.string().trim().min(1).max(MAX_NOTIFY_TEXT_LENGTH),
    to: z.enum(EFFECT_NOTIFY_TARGETS).optional().catch(undefined),
    roll: z
      .string()
      .trim()
      .min(1)
      .max(MAX_TRIGGER_FORMULA_LENGTH)
      .optional()
      .catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({ type: z.literal('nextStage'), on: EffectTriggerGateSchema }),
  z.object({ type: z.literal('removeSelf'), on: EffectTriggerGateSchema }),
] as const;

/** Zod-схема футов перемещения, которыми платят цену `move` */
const MoveCostFeetSchema = z.preprocess(
  coerceOptionalNumber,
  z.number().int().min(0).max(MAX_MOVE_COST_FEET).optional().catch(undefined),
);

/**
 * Проверяет, что строка — известный флаг эффекта.
 *
 * Набор ключей закрыт и берётся из `EFFECT_FLAG_LABELS` — того же объекта, по
 * которому строится список в UI-подборщике флагов
 * (`ActiveEffectSuggestionsModal` в `ActiveEffectFormModal`). Так проверка и
 * список вариантов не могут разойтись: новый флаг добавляется в одном месте.
 *
 * @param value - произвольная строка флага
 * @returns `true`, если такой флаг известен движку
 */
export function isEffectFlagKey(value: string): value is EffectFlagKey {
  return Object.hasOwn(EFFECT_FLAG_LABELS, value);
}

/**
 * Zod-схема списка флагов эффекта.
 *
 * Неизвестные флаги ОТБРАСЫВАЮТСЯ, а не роняют разбор. Строгий вариант был
 * опасен: `ActiveEffectsArraySchema` разбирается целиком, поэтому один
 * хоумбрю-флаг из старого мира (или введённый в поле флага руками) отменял
 * разбор ВСЕГО списка эффектов — `validateActor` бросал, и лист переставал
 * сохраняться, а `applyCombatState` молча отказывался записывать урон.
 * Отброшенный флаг и раньше ничего не делал: движок сверяет флаги по этому же
 * списку, так что потери поведения нет — только потеря сохранения ушла.
 */
const EffectFlagsSchema = z
  .array(z.string())
  .transform((flags) => flags.filter(isEffectFlagKey));

/** Наименьшая своя Сл навыка: меньше — у навыка Сл проверки */
export const MIN_ESCAPE_SKILL_DC = 1;

/**
 * Zod-схема навыка на выбор у проверки «вырваться». Навык строкой — тот же
 * вариант без своей Сл: так список пишут руками.
 */
const EffectEscapeSkillOptionSchema = z.preprocess(
  (value) => (typeof value === 'string' ? { skill: value } : value),
  z.object({
    skill: z.custom<SkillType>(
      (value) => typeof value === 'string' && isSkillType(value),
    ),
    dc: z.preprocess(
      coerceOptionalNumber,
      z.number().int().min(MIN_ESCAPE_SKILL_DC).optional().catch(undefined),
    ),
    by: z.enum(EFFECT_ESCAPE_ROLES).optional().catch(undefined),
    label: z
      .string()
      .trim()
      .min(1)
      .max(MAX_EFFECT_STAGE_LABEL_LENGTH)
      .optional()
      .catch(undefined),
  }),
);

/**
 * Zod-схема списка навыков проверки «вырваться»: негодный навык выбрасывается
 * один, пустой список — отсутствием поля.
 */
const EffectEscapeSkillsSchema = z
  .array(z.unknown())
  .transform((rawSkills): EffectEscapeSkillOption[] | undefined => {
    const skills = parseEachValid(
      EffectEscapeSkillOptionSchema,
      rawSkills,
    ).slice(0, MAX_ESCAPE_SKILLS);

    return skills.length > 0 ? skills : undefined;
  })
  .optional()
  .catch(undefined);

/** Zod-схема проверки навыка, снимающей эффект */
const EffectEscapeCheckSchema = z.object({
  skill: z.string().refine(isSkillType),
  dc: EffectSaveDcSchema,
  dcFormula: SaveDcFormulaSchema,
  skills: EffectEscapeSkillsSchema,
  mode: z.enum(EFFECT_ESCAPE_ROLL_MODES).optional().catch(undefined),
  askDc: z.literal(true).optional().catch(undefined),
});

/** Zod-схема действия «вырваться» */
const EffectEscapeSchema = z.object({
  by: z.enum(EFFECT_ESCAPE_ACTORS).optional().catch(undefined),
  cost: z.enum(EFFECT_ACTION_COSTS).optional().catch(undefined),
  moveCostFeet: MoveCostFeetSchema,
  check: EffectEscapeCheckSchema.optional().catch(undefined),
  onSuccess: z.enum(EFFECT_ESCAPE_OUTCOMES).optional().catch(undefined),
  onSuccessApply: z.string().min(1).optional().catch(undefined),
  onFailDamage: z.array(EffectDamagePartSchema).optional().catch(undefined),
  label: z
    .string()
    .trim()
    .min(1)
    .max(MAX_EFFECT_STAGE_LABEL_LENGTH)
    .optional()
    .catch(undefined),
});

/** Поля наложения состояния без собственных срабатываний */
const applyConditionActionShape = {
  type: z.literal('applyCondition'),
  conditionKey: z.string().min(1),
  duration: EffectDurationSchema.optional().catch(undefined),
  durationFormula: TriggerFormulaSchema.optional().catch(undefined),
  recurringSave: RecurringSaveSchema.optional().catch(undefined),
  locked: z.literal(true).optional().catch(undefined),
  endsOnExit: z.literal(true).optional().catch(undefined),
  escape: EffectEscapeSchema.optional().catch(undefined),
  flags: EffectFlagsSchema.optional().catch(undefined),
  on: EffectTriggerGateSchema,
} as const;

/** Zod-схема действия вложенного срабатывания */
const NestedEffectTriggerActionSchema = z.discriminatedUnion('type', [
  ...EFFECT_TRIGGER_PLAIN_ACTION_SCHEMAS,
  z.object(applyConditionActionShape),
]);

/** Самая длинная подпись варианта и ключ его группы */
const MAX_VARIANT_TEXT_LENGTH = 100;

/** Zod-схема варианта эффекта */
const EffectVariantSchema = z.object({
  group: z.string().trim().min(1).max(MAX_VARIANT_TEXT_LENGTH),
  label: z.string().trim().min(1).max(MAX_VARIANT_TEXT_LENGTH),
  pick: z.enum(EFFECT_VARIANT_PICKS).optional().catch(undefined),
});

/**
 * Zod-схема области применения: шаблон на карте. Негодная область
 * выбрасывается целиком — применение остаётся с выбором одной цели.
 */
const EffectUseAreaSchema = z
  .object({
    shape: z.enum(EFFECT_USE_AREA_SHAPES),
    size: z.preprocess(
      coerceOptionalNumber,
      z.number().min(1).max(MAX_EFFECT_USE_AREA_SIZE),
    ),
    width: z.preprocess(
      coerceOptionalNumber,
      z.number().min(1).max(MAX_EFFECT_USE_AREA_SIZE).optional(),
    ),
  })
  .optional()
  .catch(undefined);

/** Zod-схема применения или включения эффекта */
const EffectActivationSchema = z.object({
  mode: z.enum(EFFECT_ACTIVATION_MODES),
  counter: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ACTIVATION_COUNTER_LENGTH)
    .optional()
    .catch(undefined),
  amount: z.preprocess(
    coerceOptionalNumber,
    z.number().int().min(1).optional().catch(undefined),
  ),
  exclusive: z
    .string()
    .trim()
    .min(1)
    .max(MAX_ACTIVATION_COUNTER_LENGTH)
    .optional()
    .catch(undefined),
  range: z.preprocess(
    coerceOptionalNumber,
    z.number().int().min(MIN_ACTIVATION_RANGE).optional().catch(undefined),
  ),
  cost: z.enum(EFFECT_ACTIVATION_COSTS).optional().catch(undefined),
  area: EffectUseAreaSchema,
  concentration: z.literal(true).optional().catch(undefined),
});

/** Zod-схема лимита срабатывания */
const EffectTriggerLimitSchema = z.object({
  max: z.preprocess(
    coerceOptionalNumber,
    z.number().int().min(MIN_TRIGGER_LIMIT_MAX),
  ),
  per: z.enum(EFFECT_TRIGGER_LIMIT_PERIODS),
  key: z.string().min(1).optional().catch(undefined),
});

/** Zod-схема правила «на выбор из тех, кто в области» */
const EffectAreaChoiceSchema = z.object({
  count: z
    .union([
      z
        .number()
        .int()
        .min(MIN_TRIGGER_CHOICE_COUNT)
        .max(MAX_TRIGGER_CHOICE_COUNT),
      z.string().trim().min(1).max(MAX_AREA_CHOICE_FORMULA_LENGTH),
    ])
    .optional()
    .catch(undefined),
  mode: z.enum(AREA_CHOICE_MODES).optional().catch(undefined),
  target: z.enum(EFFECT_TRIGGER_AREA_TARGETS).optional().catch(undefined),
  fallback: z.enum(AREA_CHOICE_FALLBACKS).optional().catch(undefined),
});

/** Zod-схема получателя «по выбору» */
const EffectTriggerChoiceSchema = z.object({
  radius: z.preprocess(coerceOptionalNumber, z.number().min(0)),
  target: z.enum(EFFECT_TRIGGER_AREA_TARGETS).optional().catch(undefined),
  count: z.preprocess(
    coerceOptionalNumber,
    z
      .number()
      .int()
      .min(MIN_TRIGGER_CHOICE_COUNT)
      .max(MAX_TRIGGER_CHOICE_COUNT)
      .optional()
      .catch(undefined),
  ),
  condition: z.string().min(1).optional().catch(undefined),
  optional: z.literal(true).optional().catch(undefined),
  chooser: z.enum(EFFECT_TRIGGER_CHOOSERS).optional().catch(undefined),
});

/**
 * Общие поля срабатывания — без действий: у вложенного срабатывания они те же,
 * отличается только список действий.
 *
 * События следующих фаз разбираются, чтобы версия без их поддержки не стирала
 * их у записи.
 */
const effectTriggerShape = {
  id: z.string().min(1),
  event: z.enum([...EFFECT_TRIGGER_EVENTS, ...EFFECT_TRIGGER_RESERVED_EVENTS]),
  turnOf: z.enum(EFFECT_TRIGGER_TURN_OWNERS).optional().catch(undefined),
  role: z.enum(EFFECT_TRIGGER_ATTACK_ROLES).optional().catch(undefined),
  restType: z.enum(EFFECT_TRIGGER_REST_TYPES).optional().catch(undefined),
  recipient: z.enum(EFFECT_TRIGGER_RECIPIENTS).optional().catch(undefined),
  conditionKey: z.string().min(1).optional().catch(undefined),
  area: z
    .object({
      radius: z.preprocess(coerceOptionalNumber, z.number().min(0)),
      target: z.enum(EFFECT_TRIGGER_AREA_TARGETS).optional().catch(undefined),
      template: EffectUseAreaSchema,
    })
    .optional()
    .catch(undefined),
  choice: EffectTriggerChoiceSchema.optional().catch(undefined),
  condition: z.string().min(1).optional().catch(undefined),
  save: EffectTriggerSaveSchema.optional(),
  limit: EffectTriggerLimitSchema.optional().catch(undefined),
  cost: z.enum(EFFECT_ACTION_COSTS).optional().catch(undefined),
  moveCostFeet: MoveCostFeetSchema,
  everyFeet: z.preprocess(
    coerceOptionalNumber,
    z
      .number()
      .int()
      .min(MIN_TRIGGER_PATH_FEET)
      .max(MAX_TRIGGER_PATH_FEET)
      .optional()
      .catch(undefined),
  ),
  ask: z.literal(true).optional().catch(undefined),
  asker: z.enum(EFFECT_TRIGGER_CHOOSERS).optional().catch(undefined),
  pay: EffectPaySchema,
  chancePercent: z.preprocess(
    coerceOptionalNumber,
    z
      .number()
      .int()
      .min(MIN_TRIGGER_CHANCE_PERCENT)
      .max(MAX_TRIGGER_CHANCE_PERCENT)
      .optional()
      .catch(undefined),
  ),
} as const;

/** Zod-схема вложенного срабатывания: своих вложенных у него уже нет */
const NestedEffectTriggerSchema = z.object({
  ...effectTriggerShape,
  actions: z.array(NestedEffectTriggerActionSchema).min(1),
});

/**
 * Zod-схема списка вложенных срабатываний. Разбираются по одному — как и
 * срабатывания эффекта.
 */
const NestedEffectTriggersSchema = z
  .array(z.unknown())
  .transform((rawTriggers) =>
    parseEachValid(NestedEffectTriggerSchema, rawTriggers),
  );

/** Zod-схема действия срабатывания */
const EffectTriggerActionSchema = z.discriminatedUnion('type', [
  ...EFFECT_TRIGGER_PLAIN_ACTION_SCHEMAS,
  z.object({
    ...applyConditionActionShape,
    triggers: NestedEffectTriggersSchema.optional().catch(undefined),
  }),
]);

/** Zod-схема срабатывания */
const EffectTriggerSchema = z.object({
  ...effectTriggerShape,
  actions: z.array(EffectTriggerActionSchema).min(1),
});

/**
 * Zod-схема списка срабатываний.
 *
 * Срабатывания разбираются ПО ОДНОМУ: незнакомое событие или действие
 * выбрасывает одно срабатывание, а не эффект и не весь снимок сущности.
 */
const EffectTriggersSchema = z
  .array(z.unknown())
  .transform((rawTriggers) => parseEachValid(EffectTriggerSchema, rawTriggers));

/** Zod-схема ступени эффекта */
const EffectStageSchema = z.object({
  label: z.string().trim().min(1).max(MAX_EFFECT_STAGE_LABEL_LENGTH),
  changes: EffectChangesSchema.catch([]),
  flags: EffectFlagsSchema.catch([]),
});

/**
 * Zod-схема для валидации ActiveEffect.
 *
 * Используется в `entityManager.updateActor()` для проверки данных перед
 * сохранением: всё, что приходит извне, до разбора считается неизвестным.
 *
 * Поля, которых у эффектов старых миров могло не быть (`description`,
 * `disabled`, `origin`, `transfer`), разбираются с безопасным значением по
 * умолчанию, а не роняют разбор: та же причина, что и у ключа change и у
 * `isActiveEffect` — отброшенный эффект это потерянные бонусы листа, а
 * непрошедший разбор — несохранённый лист целиком.
 */
export const ActiveEffectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().catch(''),
  icon: z.string().optional(),
  disabled: z.boolean().catch(false),
  origin: z.enum(EFFECT_ORIGIN_VALUES).catch('manual'),
  originId: z.string().optional(),
  sourceActorId: z.string().optional(),
  sourceCreatureType: z
    .custom<CreatureCategory>(isCreatureCategory)
    .optional()
    .catch(undefined),
  transfer: z.boolean().catch(false),
  duration: EffectDurationSchema.catch({ type: 'permanent' }),
  changes: EffectChangesSchema.catch([]),
  flags: EffectFlagsSchema.catch([]),
  aura: EffectAuraSchema.optional(),
  areaTrigger: z.enum(['stay', 'enter', 'exit']).optional(),
  areaChoice: EffectAreaChoiceSchema.optional().catch(undefined),
  // Незнакомая доставка обнуляет поле, а не отвергает эффект: снимок сущности
  // разбирается целиком, и один эффект не должен ронять запись урона
  effectTarget: z.enum(['self', 'target', 'zone']).optional().catch(undefined),
  magical: z.literal(true).optional().catch(undefined),
  endsWithAreaId: z.string().min(1).optional().catch(undefined),
  endsOnExitAreaId: z.string().min(1).optional().catch(undefined),
  // Ключи состояний — СТРОКА, а не перечень канона: состояния заводятся в мире
  // («Мастерская» → «Состояния»), и перечень канона молча выбрасывал бы у
  // эффекта ключ своего состояния — вместе с ним пропадали бы значок на токене
  // и проверка иммунитета.
  conditionKey: z.string().min(1).optional(),
  tag: z.string().regex(EFFECT_TAG_PATTERN).optional().catch(undefined),
  tagStacks: z.number().int().min(1).optional().catch(undefined),
  landingCondition: z.string().trim().min(1).optional().catch(undefined),
  variant: EffectVariantSchema.optional().catch(undefined),
  activation: EffectActivationSchema.optional().catch(undefined),
  pay: EffectPaySchema,
  paid: EffectPaidSchema,
  rollCondition: z.string().trim().min(1).optional().catch(undefined),
  castId: z.string().min(1).max(MAX_CAST_ID_LENGTH).optional().catch(undefined),
  castLevel: z.preprocess(
    coerceOptionalNumber,
    z
      .number()
      .int()
      .min(0)
      .max(MAX_SPELL_SLOT_LEVEL)
      .optional()
      .catch(undefined),
  ),
  conditionLocked: z.literal(true).optional().catch(undefined),
  charges: EffectChargesSchema.optional().catch(undefined),
  saveOverride: EffectSaveOverrideSchema.optional().catch(undefined),
  light: EffectLightSchema.optional().catch(undefined),
  savedRoll: z.string().trim().min(1).optional().catch(undefined),
  savedRollValue: z.preprocess(
    coerceOptionalNumber,
    z.number().optional().catch(undefined),
  ),
  durationFormula: z.string().trim().min(1).optional().catch(undefined),
  concentration: z.literal(true).optional().catch(undefined),
  applySave: EffectSaveSchema.optional(),
  applyOnSuccess: z.boolean().optional(),
  applyOnSuccessOnly: z.boolean().optional(),
  consumeOn: z.enum(['carrierAttack', 'attackOnCarrier']).optional(),
  damageParts: z.array(EffectDamagePartSchema).optional(),
  recurringSave: RecurringSaveSchema.optional(),
  recurringDamage: RecurringDamageSchema.optional(),
  triggers: EffectTriggersSchema.optional().catch(undefined),
  suppressConditions: z.array(z.string().min(1)).optional().catch(undefined),
  conditionImmunities: z.array(z.string().min(1)).optional(),
  exhaustionLevel: z.number().int().min(0).optional(),
  escape: EffectEscapeSchema.optional().catch(undefined),
  castRule: EffectCastRuleSchema,
  turnCurrent: z.literal(true).optional().catch(undefined),
  stackable: z.literal(true).optional().catch(undefined),
  stages: z
    .array(EffectStageSchema)
    .max(MAX_EFFECT_STAGES)
    .optional()
    .catch(undefined),
  stageIndex: z.preprocess(
    coerceOptionalNumber,
    z
      .number()
      .int()
      .min(0)
      .max(MAX_EFFECT_STAGES - 1)
      .optional()
      .catch(undefined),
  ),
});

/** Zod-схема для массива ActiveEffect (для валидации actor.activeEffects) */
export const ActiveEffectsArraySchema = z
  .array(ActiveEffectSchema)
  .max(MAX_EFFECTS_PER_ACTOR);
