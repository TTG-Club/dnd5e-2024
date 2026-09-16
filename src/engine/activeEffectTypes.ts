/**
 * Типы данных системы Active Effects (D&D 5e)
 *
 * Система активных эффектов с формульным парсером,
 * числовыми модификаторами (changes) и булевыми флагами (flags).
 *
 * Используется в трёхфазном пайплайне:
 * prepareBaseData → applyActiveEffects → prepareDerivedData
 */

// `AreaEffectTrigger`, `BaseActiveEffect`, `EffectAura`, `EffectDuration`,
// `EffectDurationType`, `EffectTurnAnchor`, `EffectTurnTiming` — нейтральные
// контрактные типы эффекта (провенанс, длительность, аура, триггер области, база
// `BaseActiveEffect`): они живут в ядре системного контракта (`../contracts/*`),
// D&D наследует базу и реэкспортит формы для своих потребителей.
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
} from '@vtt/shared';

import type {
  ConditionKey,
  ConditionRef,
  DEATH_CONDITION_KEY,
} from './conditionKeys.js';
import type { DnDCustomBonusContext } from './customBonuses.js';
import type { EffectTrigger } from './effectTriggerTypes.js';
import type { EffectVariantPick } from './effectVariants.js';

import { z } from 'zod';

import { isRecord, typedObjectEntries } from '@vtt/shared';

import { CONDITIONS, CREATURE_CATEGORIES, SKILLS_LABELS } from './consts.js';
import {
  DAMAGE_PART_TARGETS,
  DAMAGE_TYPE_LABELS,
  DAMAGE_TYPES,
} from './damageConstants.js';
import {
  EFFECT_TAG_PATTERN,
  EFFECT_TRIGGER_ACTION_GATES,
  EFFECT_TRIGGER_ATTACK_ROLES,
  EFFECT_TRIGGER_EVENTS,
  EFFECT_TRIGGER_LIMIT_PERIODS,
  EFFECT_TRIGGER_RECIPIENTS,
  EFFECT_TRIGGER_RESERVED_EVENTS,
  EFFECT_TRIGGER_REST_TYPES,
  EFFECT_TRIGGER_SAVE_MODES,
  EFFECT_TRIGGER_TURN_OWNERS,
  MIN_TRIGGER_LIMIT_MAX,
} from './effectTriggerTypes.js';
import { EFFECT_VARIANT_PICKS } from './effectVariants.js';
import { parseEachValid } from './lenientParse.js';

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
  | 'critThreshold';

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

/** Приставка условия по типу ЦЕЛИ броска. */
export const TARGET_TYPE_CONDITION_PREFIX = 'target.creatureType === ';

/** Приставка условия по типу АТАКУЮЩЕГО — у защитного эффекта. */
export const INCOMING_ATTACKER_TYPE_CONDITION_PREFIX =
  'incoming.attackerCreatureType === ';

/** Условие «рядом с целью мой союзник» («Тактика стаи») */
export const TARGET_ALLY_ADJACENT_CONDITION = 'target.allyAdjacent';

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

export const EFFECT_CONDITION_SUGGESTIONS: Array<{
  value: string;
  label: string;
}> = [
  // === БРОСКИ ===
  {
    value: 'roll.hasAdvantage === true',
    label: 'Бросок: с преимуществом',
  },
  {
    value: 'roll.hasDisadvantage === true',
    label: 'Бросок: с помехой',
  },

  // === ДОСПЕХ НОСИТЕЛЯ ===
  // Считаются по самому листу, без броска: прибавка с таким условием попадает
  // в постоянные числа (КД «Обороны» видно в блоке защиты, а не только в бою).
  {
    value: 'self.armor === "any"',
    label: 'Носитель: в доспехе (любом)',
  },
  {
    value: 'self.armor === "none"',
    label: 'Носитель: без доспеха',
  },
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
  {
    value: 'self.armor === "shield"',
    label: 'Носитель: со щитом',
  },
  {
    value: 'self.armor === "noShield"',
    label: 'Носитель: без щита',
  },

  // === ХИТЫ ЦЕЛИ ===
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

  // === МЕТКА ЦЕЛИ ===
  {
    value: 'target.markedBySelf',
    label: 'Цель помечена мной (Метка охотника, Сглаз)',
  },
  {
    value: TARGET_ALLY_ADJACENT_CONDITION,
    label: 'Цель: рядом с ней мой союзник (Тактика стаи)',
  },

  // === ЗАЩИТА ===
  // Входящая атака: КД, «Атаки по носителю» и условие броска эффекта
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
  ...typedObjectEntries(CREATURE_CATEGORIES).map(([creatureType, label]) => ({
    value: `${INCOMING_ATTACKER_TYPE_CONDITION_PREFIX}"${creatureType}"`,
    label: `Защита: атакующий — ${label}`,
  })),

  // === ТИП СУЩЕСТВА ===
  // Собираются по справочнику, а не переписаны руками: список типов один на всю
  // систему, и вручную повторённый разошёлся бы с ним при первой же правке
  ...typedObjectEntries(CREATURE_CATEGORIES).map(([creatureType, label]) => ({
    value: `self.creatureType === "${creatureType}"`,
    label: `Носитель: ${label}`,
  })),
  ...typedObjectEntries(CREATURE_CATEGORIES).map(([creatureType, label]) => ({
    value: `target.creatureType === "${creatureType}"`,
    label: `Цель: ${label}`,
  })),
];

/**
 * Популярные формулы, типы урона, лечение и переменные для подсказок значения эффекта.
 */
export const EFFECT_VALUE_SUGGESTIONS: Array<{
  value: string;
  label: string;
}> = [
  // Характеристики и модификаторы
  { value: '@mod.spell', label: 'Модификатор заклинательной характеристики' },
  { value: '@mod.str', label: 'Модификатор Силы' },
  { value: '@mod.dex', label: 'Модификатор Ловкости' },
  { value: '@mod.con', label: 'Модификатор Телосложения' },
  { value: '@mod.int', label: 'Модификатор Интеллекта' },
  { value: '@mod.wis', label: 'Модификатор Мудрости' },
  { value: '@mod.cha', label: 'Модификатор Харизмы' },
  { value: '@prof', label: 'Бонус мастерства актора (@prof)' },
  { value: '@level', label: 'Общий уровень персонажа (@level)' },
  {
    value: '@classLevel',
    label: 'Уровень в классе умения (@classLevel; у своего эффекта — общий)',
  },

  // Скорости листа: ими задаётся «полёт равен скорости ходьбы»
  { value: '@speed.walk', label: 'Скорость ходьбы листа' },
  { value: '@speed.fly', label: 'Скорость полёта листа' },
  { value: '@speed.swim', label: 'Скорость плавания листа' },
  { value: '@speed.climb', label: 'Скорость лазания листа' },
  { value: '@speed.burrow', label: 'Скорость копания листа' },

  // Типы урона (с токенами)
  { value: '1к6@dmg.fire', label: 'Урон: Огонь (например, 1к6)' },
  { value: '1к6@dmg.cold', label: 'Урон: Холод' },
  { value: '1к6@dmg.lightning', label: 'Урон: Электричество' },
  { value: '1к6@dmg.thunder', label: 'Урон: Звук' },
  { value: '1к6@dmg.acid', label: 'Урон: Кислота' },
  { value: '1к6@dmg.poison', label: 'Урон: Яд' },
  { value: '1к6@dmg.necrotic', label: 'Урон: Некроз' },
  { value: '1к6@dmg.radiant', label: 'Урон: Излучение' },
  { value: '1к6@dmg.force', label: 'Урон: Силовое поле' },
  { value: '1к6@dmg.psychic', label: 'Урон: Психический' },
  { value: '1к6@dmg.bludgeoning', label: 'Урон: Дробящий' },
  { value: '1к6@dmg.piercing', label: 'Урон: Колющий' },
  { value: '1к6@dmg.slashing', label: 'Урон: Рубящий' },

  // Лечение
  { value: '1к8@heal', label: 'Лечение (например, 1к8)' },
  { value: '1к8@heal.temp', label: 'Временные хиты (Temp HP)' },

  // Условия по цели в формуле
  {
    value: '1к6@target.full',
    label: 'Формула: Урон только при полном HP цели',
  },
  {
    value: '1к6@target.notFull',
    label: 'Формула: Урон только по раненой цели',
  },
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
 * Метка смерти сюда не идёт: спасброска против неё не бывает — её ставит и
 * снимает запас хитов существа.
 */
export type SaveConditionKey = Exclude<
  ConditionKey,
  typeof DEATH_CONDITION_KEY
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
  | 'healing.blocked'
  | 'healing.tempBlocked'
  | DamageDefenseFlagKey
  | SkillFlagKey
  | SaveVsConditionFlagKey
  | SaveEvasionFlagKey
  | DamageIgnoreResistanceFlagKey;

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
  'initiative.advantage': 'Преимущество на бросок инициативы',
  'initiative.disadvantage': 'Помеха на бросок инициативы',
  'vision.blinded': 'Ослеплен (Ничего не видит, автопровал проверок зрения)',
  'vision.invisible': 'Невидимый (Скрыт от глаз, преимущество на атаки)',

  // Специфические флаги предметов
  'defense.critImmunity': 'Защита: Иммунитет к критическим попаданиям',

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
  /** Приоритет применения (меньше = раньше, по умолчанию 20) */
  priority: number;
}

/**
 * Как эффект начинает действовать: `use` — накладывается применением
 * источника (зелье, стрела, кнопка «Применить»), `toggle` — включается
 * переключателем («Ярость»).
 */
export const EFFECT_ACTIVATION_MODES = ['use', 'toggle'] as const;

/** Способ применения или включения эффекта */
export type EffectActivationMode = (typeof EFFECT_ACTIVATION_MODES)[number];

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
  /** Эффект успешного спасброска */
  onSuccess: EffectSaveOutcome;
}

/** Момент периодического спасброска для снятия эффекта */
export type EffectSaveTiming = 'startOfTurn' | 'endOfTurn';

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
   * Каст заклинания, к которому относится эффект: общий у эффектов заклинателя,
   * целей и зоны одного каста. Конец каста снимает их все.
   */
  castId?: string;

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
 * Эффект, который ложится на лист из умения, черты или вида: переключаемый —
 * выключенным, его включают руками, а не получают готовым.
 *
 * @param effect - эффект записи
 * @returns эффект для листа
 */
export function withActivationDefaults(effect: ActiveEffect): ActiveEffect {
  return isToggleActivatedEffect(effect)
    ? { ...effect, disabled: true }
    : effect;
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

/**
 * Читает число из поля формы: число как есть, строку с числом — числом.
 *
 * Поле ввода числа отдаёт пустую строку, когда его очистили, а без
 * модификатора `.number` — строку с числом.
 *
 * @param value - значение поля ввода
 * @returns число либо `undefined` для пустого, нечислового ввода и `NaN`
 */
export function parseFormNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  const parsed = Number(trimmed);

  return trimmed === '' || !Number.isFinite(parsed) ? undefined : parsed;
}

/**
 * Приводит числовое поле формы к числу до проверки схемой.
 *
 * Строгая схема на строке из поля ввода падала, и разбор отбрасывал куда
 * больше, чем одно поле: все модификаторы эффекта или его длительность целиком.
 *
 * @param value - значение поля как пришло
 * @returns число, `undefined` для пустого или нечислового ввода, либо исходное
 *   значение, если это не строка и не число
 */
function coerceOptionalNumber(value: unknown): unknown {
  return typeof value === 'number' || typeof value === 'string'
    ? parseFormNumber(value)
    : value;
}

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

/** Характеристики спасброска (для Zod-валидации эффекта) */
const SAVE_ABILITY_VALUES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

/** Zod-схема сложности спасброска: число, в том числе набранное строкой */
const EffectSaveDcSchema = z.preprocess(coerceOptionalNumber, z.number().int());

/** Zod-схема спасброска при наложении эффекта */
const EffectSaveSchema = z.object({
  ability: z.enum(SAVE_ABILITY_VALUES),
  dc: EffectSaveDcSchema,
  onSuccess: z.enum(['negate', 'half']),
});

/** Zod-схема периодического спасброска для снятия эффекта */
const RecurringSaveSchema = z.object({
  ability: z.enum(SAVE_ABILITY_VALUES),
  dc: EffectSaveDcSchema,
  timing: z.enum(['startOfTurn', 'endOfTurn']),
});

/** Zod-схема части урона эффекта (подмножество DamagePart) */
const EffectDamagePartSchema = z.object({
  formula: z.string(),
  type: z.enum(DAMAGE_TYPES).optional(),
  target: z.enum(DAMAGE_PART_TARGETS).optional(),
  requiresDamage: z.boolean().optional(),
  versatileFormula: z.string().optional(),
});

/** Zod-схема периодического урона (DoT) */
const RecurringDamageSchema = z.object({
  damageParts: z.array(EffectDamagePartSchema),
  timing: z.enum(['startOfTurn', 'endOfTurn']),
  save: EffectSaveSchema.optional(),
});

/** Приставка id эффектов, которые движок кладёт на сущность сам */
export const ACTIVE_EFFECT_ID_PREFIX = 'ae';

/** Самый длинный id каста — как у черновика области ядра */
const MAX_CAST_ID_LENGTH = 64;

/** Самая длинная формула Сл срабатывания */
const MAX_TRIGGER_DC_FORMULA_LENGTH = 200;

/** Zod-схема спасброска срабатывания */
const EffectTriggerSaveSchema = z.object({
  ability: z.enum(SAVE_ABILITY_VALUES),
  dc: EffectSaveDcSchema,
  mode: z.enum(EFFECT_TRIGGER_SAVE_MODES).optional().catch(undefined),
  dcFormula: z
    .string()
    .trim()
    .min(1)
    .max(MAX_TRIGGER_DC_FORMULA_LENGTH)
    .optional()
    .catch(undefined),
});

/** Zod-схема гейта действия срабатывания */
const EffectTriggerGateSchema = z
  .enum(EFFECT_TRIGGER_ACTION_GATES)
  .optional()
  .catch(undefined);

/** Zod-схема действия срабатывания */
const EffectTriggerActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('damage'),
    parts: z.array(EffectDamagePartSchema),
    on: EffectTriggerGateSchema,
    halfOnSave: z.literal(true).optional().catch(undefined),
  }),
  z.object({ type: z.literal('applySelf'), on: EffectTriggerGateSchema }),
  z.object({
    type: z.literal('applyCondition'),
    conditionKey: z.string().min(1),
    duration: EffectDurationSchema.optional().catch(undefined),
    recurringSave: RecurringSaveSchema.optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('applyTag'),
    tag: z.string().regex(EFFECT_TAG_PATTERN),
    label: z.string().min(1).optional().catch(undefined),
    duration: EffectDurationSchema.optional().catch(undefined),
    stack: z.literal(true).optional().catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('reduceMaxHp'),
    amount: z.string().trim().min(1).max(MAX_TRIGGER_DC_FORMULA_LENGTH),
    endsOnRest: z
      .enum([...EFFECT_TRIGGER_REST_TYPES, 'never'])
      .optional()
      .catch(undefined),
    on: EffectTriggerGateSchema,
  }),
  z.object({
    type: z.literal('setHp'),
    value: z.preprocess(coerceOptionalNumber, z.number().int().min(0)),
    on: EffectTriggerGateSchema,
  }),
  z.object({ type: z.literal('endCast'), on: EffectTriggerGateSchema }),
  z.object({ type: z.literal('removeSelf'), on: EffectTriggerGateSchema }),
]);

/** Самая длинная подпись варианта и ключ его группы */
const MAX_VARIANT_TEXT_LENGTH = 100;

/** Zod-схема варианта эффекта */
const EffectVariantSchema = z.object({
  group: z.string().trim().min(1).max(MAX_VARIANT_TEXT_LENGTH),
  label: z.string().trim().min(1).max(MAX_VARIANT_TEXT_LENGTH),
  pick: z.enum(EFFECT_VARIANT_PICKS).optional().catch(undefined),
});

/** Самый длинный ключ счётчика применения */
const MAX_ACTIVATION_COUNTER_LENGTH = 100;

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

/**
 * Zod-схема срабатывания. События следующих фаз разбираются, чтобы версия без
 * их поддержки не стирала их у записи.
 */
const EffectTriggerSchema = z.object({
  id: z.string().min(1),
  event: z.enum([...EFFECT_TRIGGER_EVENTS, ...EFFECT_TRIGGER_RESERVED_EVENTS]),
  turnOf: z.enum(EFFECT_TRIGGER_TURN_OWNERS).optional().catch(undefined),
  role: z.enum(EFFECT_TRIGGER_ATTACK_ROLES).optional().catch(undefined),
  restType: z.enum(EFFECT_TRIGGER_REST_TYPES).optional().catch(undefined),
  recipient: z.enum(EFFECT_TRIGGER_RECIPIENTS).optional().catch(undefined),
  condition: z.string().min(1).optional().catch(undefined),
  save: EffectTriggerSaveSchema.optional(),
  actions: z.array(EffectTriggerActionSchema).min(1),
  limit: EffectTriggerLimitSchema.optional().catch(undefined),
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

/**
 * Zod-схема для валидации ActiveEffect.
 *
 * Используется в `entityManager.updateActor()` для проверки
 * данных перед сохранением (AGENTS.md: "All external data is unknown by default. Use Zod").
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
  transfer: z.boolean().catch(false),
  duration: EffectDurationSchema.catch({ type: 'permanent' }),
  changes: EffectChangesSchema.catch([]),
  flags: EffectFlagsSchema.catch([]),
  aura: EffectAuraSchema.optional(),
  areaTrigger: z.enum(['stay', 'enter', 'exit']).optional(),
  // Незнакомая доставка обнуляет поле, а не отвергает эффект: снимок сущности
  // разбирается целиком, и один эффект не должен ронять запись урона
  effectTarget: z.enum(['self', 'target', 'zone']).optional().catch(undefined),
  magical: z.literal(true).optional().catch(undefined),
  endsWithAreaId: z.string().min(1).optional().catch(undefined),
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
  rollCondition: z.string().trim().min(1).optional().catch(undefined),
  castId: z.string().min(1).max(MAX_CAST_ID_LENGTH).optional().catch(undefined),
  concentration: z.literal(true).optional().catch(undefined),
  applySave: EffectSaveSchema.optional(),
  applyOnSuccess: z.boolean().optional(),
  applyOnSuccessOnly: z.boolean().optional(),
  consumeOn: z.enum(['carrierAttack', 'attackOnCarrier']).optional(),
  damageParts: z.array(EffectDamagePartSchema).optional(),
  recurringSave: RecurringSaveSchema.optional(),
  recurringDamage: RecurringDamageSchema.optional(),
  triggers: EffectTriggersSchema.optional().catch(undefined),
  conditionImmunities: z.array(z.string().min(1)).optional(),
  exhaustionLevel: z.number().int().min(0).optional(),
});

/** Zod-схема для массива ActiveEffect (для валидации actor.activeEffects) */
export const ActiveEffectsArraySchema = z
  .array(ActiveEffectSchema)
  .max(MAX_EFFECTS_PER_ACTOR);
