/**
 * Типы данных игровой системы D&D 5e
 *
 * Все типы, специфичные для системы D&D 5e, которые заполняют
 * поле `system` в BaseActor (модульная архитектура).
 *
 * Ядро (Core) не знает про содержимое этих типов —
 * оно работает с `BaseActor.system: Record<string, unknown>`.
 */

import type {
  AbilityType,
  ActorArmorClass,
  ActorMovement,
  ProficiencyLevel,
  SkillType,
} from '@vtt/shared';

import type {
  ActorClassEntry,
  CounterRecovery,
  ManualHitDieGroup,
} from './classTypes.js';

/**
 * Текущее состояние счётчика классового ресурса на акторе
 *
 * Хранится в `actor.system.classCounters[]`.
 * Создаётся при добавлении класса и обновляется при повышении уровня.
 */
export interface ActorCounterState {
  /** Ключ счётчика (из ClassCounterDefinition.key) */
  counterKey: string;
  /** Ключ класса-владельца */
  classKey: string;
  /** Ключ подкласса (если счётчик от подкласса) */
  subclassKey?: string;
  /** Пользовательское название счётчика */
  name?: string;
  /** Пользовательское краткое название для компактного отображения */
  shortName?: string;
  /** Пользовательский тип восстановления */
  recovery?: CounterRecovery;
  /** Текущее значение */
  current: number;
  /** Максимальное значение (вычисляется из progression/formula) */
  max: number;
}

/** Валюта персонажа D&D 5e */
export interface DnDCurrency {
  cp: number; // Медные (Copper)
  sp: number; // Серебряные (Silver)
  ep: number; // Электрум (Electrum)
  gp: number; // Золотые (Gold)
  pp: number; // Платиновые (Platinum)
}

/**
 * Настройка предела переносимого веса (грузоподъёмности).
 *
 * Расчёт по правилам лист даёт переопределить целиком (своё значение), сдвинуть
 * поправкой на другой размер или дополнить своим бонусом в фунтах.
 */
export interface DnDCarryingCapacity {
  /**
   * Размер, по которому берётся поправка; null — размер актёра. Нужен умениям
   * вроде «Мощного телосложения»: существо считается на категорию крупнее
   * только для переносимого веса.
   */
  size: CreatureSize | null;

  /**
   * Своё значение предела вместо расчёта по правилам (в фунтах); null —
   * считать по правилам.
   */
  custom: number | null;

  /**
   * Свой бонус к пределу в фунтах: складывается и со своим значением, и с
   * расчётом по правилам. Отрицательный — предел уменьшается.
   */
  bonus: number;
}

/**
 * Настройка предела подготовки (заклинаний книги либо заговоров).
 *
 * По умолчанию предел считается по таблице класса из компендиума; лист даёт
 * задать своё число вместо подсчёта или прибавить к числу класса бонус.
 */
export interface DnDPreparedLimit {
  /**
   * Своё число вместо подсчёта по классу; null — считать по таблице класса.
   */
  custom: number | null;

  /**
   * Бонус к числу из таблицы класса (черта, предмет, домашнее правило).
   * Со своим числом не складывается — оно и есть предел.
   */
  bonus: number;
}

/** Вид своего бонуса: модификатор характеристики либо своё число */
export type DnDCustomBonusKind = 'ability' | 'flat';

/**
 * Своя прибавка сверх правил (предмет, умение, домашнее правило). Запись держит
 * оба источника разом — характеристику и число: в счёт идёт тот, что выбран
 * видом, а второй ждёт переключения, и введённое не теряется, пока игрок
 * примеряет бонус.
 */
export interface DnDCustomBonus {
  /** Идентификатор записи: ключ списка и адрес правки */
  id: string;

  /** Что даёт бонус: модификатор характеристики или своё число */
  kind: DnDCustomBonusKind;

  /** Характеристика-источник (для вида `ability`) */
  ability: AbilityType;

  /** Своё число (для вида `flat`) */
  value: number;

  /** Пометка источника («Плащ защиты»); пустая строка — без пометки */
  label: string;
}

/**
 * Настройка одного спасброска сверх правил.
 *
 * По правилам спасбросок катится от своей же характеристики, но умения и
 * предметы дают катить его от другой — и добавляют свои бонусы сверху.
 */
export interface DnDSavingThrowSetting {
  /**
   * Характеристика, чей модификатор идёт в спасбросок; null — своя же, как по
   * правилам.
   */
  ability: AbilityType | null;

  /** Свои бонусы спасброска (пустой список — считается по правилам) */
  bonuses: DnDCustomBonus[];
}

/**
 * Настройка спасбросков листа. Поля нет у актёров старых миров — без него все
 * шесть спасбросков считаются по правилам.
 */
export interface DnDSavingThrowSettings {
  /** Настройка каждого спасброска; ключа нет — спасбросок по правилам */
  saves: Partial<Record<AbilityType, DnDSavingThrowSetting>>;

  /**
   * Бонусы ко всем шести спасброскам сразу (плащ защиты, аура паладина): идут
   * в каждый сверх его собственных.
   */
  common: DnDCustomBonus[];
}

/**
 * Системные данные актора D&D 5e
 *
 * Содержит все D&D-специфичные поля, которые ранее были
 * частью монолитного Actor. Доступ: `actor.system.*`
 */
export interface DnDActorSystem {
  /** Index signature для совместимости с BaseActor.system: Record<string, unknown> */
  [key: string]: unknown;

  /**
   * Запись о виде актора (бывшая раса).
   * Содержит выбранный вид, размер и выборы особенностей.
   */
  species: import('./speciesTypes.js').ActorSpeciesEntry | null;
  /** Предыстория персонажа */
  background: import('./backgroundTypes.js').ActorBackgroundEntry | null;
  /** Классы персонажа (массив для мультикласса) */
  classes: ActorClassEntry[];
  /** Опыт персонажа */
  experience: number;
  /** Вдохновение: есть или нет (даёт/забирает только ГМ) */
  inspiration?: boolean;
  /** Размер существа (D&D 5e 2024) */
  size: CreatureSize;

  /** Значения характеристик (ability scores) */
  abilities: DnDAbilityScores;

  /** Передвижение персонажа */
  movement: ActorMovement;
  /** Класс доспеха */
  armorClass: ActorArmorClass;
  /** Здоровье */
  hitPoints: DnDHitPoints;
  /** Дополнительный бонус к инициативе */
  initiativeBonus: number;
  /** Характеристика для расчёта инициативы */
  initiativeAbility: AbilityType;

  /** Владения (proficiencies) */
  proficiencies: DnDProficiencies;

  /**
   * Настройка спасбросков: подменённая характеристика и свои бонусы. Поля нет
   * у актёров старых миров — без него всё считается по правилам.
   */
  savingThrowSettings?: DnDSavingThrowSettings;

  /** Валюта (деньги) */
  currency: DnDCurrency;

  /**
   * Настройка предела переносимого веса. Поля нет у актёров старых миров —
   * без него всё считается по правилам.
   */
  carryingCapacity?: DnDCarryingCapacity;

  /**
   * Настройка предела подготовленных заклинаний. Поля нет у актёров старых
   * миров — без него всё считается по таблице класса.
   */
  preparedSpells?: DnDPreparedLimit;

  /** Настройка предела заговоров — тот же счётчик, но своя колонка таблицы */
  preparedCantrips?: DnDPreparedLimit;

  /** Использованные ячейки заклинаний [1-9 круг], индекс 0 = 1-й круг */
  spellSlotsUsed?: number[];

  /** Использованные ячейки Pact Magic (Warlock) */
  pactSlotsUsed?: number;

  /** Характеристика заклинания (переопределение, если отличается от класса) */
  spellcastingAbility?: AbilityType;

  /** Ручные кости хитов (для NPC и кастомных актёров без классов) */
  manualHitDice?: ManualHitDieGroup[];

  /** Счётчики классовых ресурсов (очки чародейства, кости превосходства и т.д.) */
  classCounters: ActorCounterState[];
}

/**
 * Размер существа D&D 5e
 */
export type CreatureSize =
  'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';

/** Значения характеристик D&D 5e */
export interface DnDAbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

/** Здоровье персонажа D&D 5e */
export interface DnDHitPoints {
  current: number;
  max: number;
  temp: number;
}

/** Владения персонажа D&D 5e */
export interface DnDProficiencies {
  armor: string[];
  weapons: string[];
  /** Мастерство оружия (D&D 5.5e Weapon Mastery) — подмножество weapons */
  weaponMasteries: string[];
  tools: string[];
  languages: string[];
  savingThrows: AbilityType[];
  skills: Partial<Record<SkillType, ProficiencyLevel>>;
}
