/**
 * Константы системы D&D 5e (PHB 2024)
 *
 * Это единственный источник правды для всех D&D-специфичных данных.
 * При переключении на другую систему — замени этот файл.
 */

import type {
  AbilityType,
  ActorMovement,
  EquipmentCategory,
  MovementType,
  SkillType,
  ToolCategory,
} from '@vtt/shared';

import type { ConditionKey, ConditionRef } from './conditionKeys.js';
import type { DnDActor, SpellUsesRecovery } from './dndEntities.js';
import type { CreatureSize } from './types.js';

import { DEFAULT_CARRYING_CAPACITY } from './carryingCapacity.js';
import { DEATH_CONDITION_KEY } from './conditionKeys.js';
import { DEFAULT_PREPARED_LIMIT } from './preparedSpells.js';

// ============================================================
// Инструменты
// ============================================================

// ============================================================
// Базовые параметры (Core Rules)
// ============================================================

/** Базовый КД без брони (D&D 5e: 10 + DEX mod) */
export const BASE_UNARMORED_AC = 10;

/** Базовое слагаемое Сл спасброска от заклинаний (8 + мастерство + мод.) */
export const SPELL_SAVE_DC_BASE = 8;

// ============================================================
// Характеристики (Abilities)
// ============================================================

/** Локализованные названия характеристик (ключ → русский лейбл) */
export const ABILITY_LABELS: Record<AbilityType, string> = {
  strength: 'Сила',
  dexterity: 'Ловкость',
  constitution: 'Телосложение',
  intelligence: 'Интеллект',
  wisdom: 'Мудрость',
  charisma: 'Харизма',
};

/** Ключи характеристик в порядке листа */
export const ABILITY_KEYS: readonly AbilityType[] = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];

/** Множество всех допустимых ключей характеристик для быстрой проверки */
const ABILITY_KEY_SET: ReadonlySet<string> = new Set(ABILITY_KEYS);

/**
 * Проверяет, является ли значение допустимым ключом характеристики
 * (`AbilityType`). Значение приходит из данных мира, поэтому проверяется и его
 * тип: в записи актёра на месте ключа может оказаться что угодно.
 *
 * @param value - произвольное значение для проверки
 * @returns `true`, если `value` является `AbilityType`
 */
export function isAbilityType(value: unknown): value is AbilityType {
  return typeof value === 'string' && ABILITY_KEY_SET.has(value);
}

/** Характеристики для выбора в UI-селектах */
export const ABILITY_OPTIONS: ReadonlyArray<{
  value: AbilityType;
  label: string;
}> = ABILITY_KEYS.map((value) => ({ value, label: ABILITY_LABELS[value] }));

// ============================================================
// Навыки → Характеристики (Skills → Abilities)
// ============================================================

/** Маппинг навыков к их базовым характеристикам */
export const SKILL_ABILITY_MAP: Record<SkillType, AbilityType> = {
  acrobatics: 'dexterity',
  animalHandling: 'wisdom',
  arcana: 'intelligence',
  athletics: 'strength',
  deception: 'charisma',
  history: 'intelligence',
  insight: 'wisdom',
  intimidation: 'charisma',
  investigation: 'intelligence',
  medicine: 'wisdom',
  nature: 'intelligence',
  perception: 'wisdom',
  performance: 'charisma',
  persuasion: 'charisma',
  sleightOfHand: 'dexterity',
  stealth: 'dexterity',
  survival: 'wisdom',
  religion: 'intelligence',
};

/**
 * Локализованные названия навыков (ключ → русский лейбл).
 * Порядок записей — порядок показа навыков в листе (по алфавиту названий).
 */
export const SKILLS_LABELS: Record<SkillType, string> = {
  acrobatics: 'Акробатика',
  investigation: 'Анализ',
  arcana: 'Аркана',
  athletics: 'Атлетика',
  perception: 'Внимательность',
  survival: 'Выживание',
  performance: 'Выступление',
  intimidation: 'Запугивание',
  history: 'История',
  sleightOfHand: 'Ловкость рук',
  medicine: 'Медицина',
  deception: 'Обман',
  nature: 'Природа',
  insight: 'Проницательность',
  religion: 'Религия',
  stealth: 'Скрытность',
  persuasion: 'Убеждение',
  animalHandling: 'Уход за животными',
};

/** Множество всех допустимых ключей навыков для быстрой проверки */
const SKILL_KEY_SET: ReadonlySet<string> = new Set(Object.keys(SKILLS_LABELS));

/**
 * Проверяет, является ли строка допустимым ключом навыка (`SkillType`).
 *
 * @param value Произвольная строка для проверки
 * @returns `true`, если `value` является `SkillType`
 */
export function isSkillType(value: string): value is SkillType {
  return SKILL_KEY_SET.has(value);
}

/**
 * Список всех навыков с их локализованными названиями и базовыми
 * характеристиками — сборка двух справочников выше в порядке показа.
 *
 * `Object.keys` отдаёт ключи строками, поэтому каждый прогоняется через
 * {@link isSkillType}: чужой ключ в список не попадёт.
 */
export const SKILLS_LIST: Array<{
  key: SkillType;
  label: string;
  ability: AbilityType;
}> = Object.keys(SKILLS_LABELS).flatMap((key) =>
  isSkillType(key)
    ? [{ key, label: SKILLS_LABELS[key], ability: SKILL_ABILITY_MAP[key] }]
    : [],
);

// ============================================================
// Типы движения (Movement)
// ============================================================

/** Приоритет типов движения (от высшего к низшему) */
export const MOVEMENT_PRIORITY: MovementType[] = [
  'burrow',
  'climb',
  'fly',
  'swim',
  'walk',
];

/** Локализованные названия типов движения */
export const MOVEMENT_LABELS: Record<MovementType, string> = {
  burrow: 'Копание',
  climb: 'Лазание',
  fly: 'Полёт',
  swim: 'Плавание',
  walk: 'Ходьба',
};

/** Ключи типов движения в порядке показа */
export const MOVEMENT_KEYS: readonly MovementType[] = [
  'walk',
  'swim',
  'fly',
  'climb',
  'burrow',
];

/** Множество всех допустимых типов движения для быстрой проверки */
const MOVEMENT_KEY_SET: ReadonlySet<string> = new Set(MOVEMENT_KEYS);

/**
 * Проверяет, является ли значение допустимым типом движения (`MovementType`).
 * Значение приходит из данных мира и из ключей эффектов (`movement.fly`),
 * поэтому проверяется и его тип — на месте ключа может оказаться что угодно.
 *
 * @param value - произвольное значение для проверки
 * @returns `true`, если `value` является `MovementType`
 */
export function isMovementType(value: unknown): value is MovementType {
  return typeof value === 'string' && MOVEMENT_KEY_SET.has(value);
}

/** Локализованные названия категорий инструментов */
export const TOOL_CATEGORIES: Record<ToolCategory, string> = {
  artisan: 'Инструменты ремесленника',
  gaming: 'Игровые наборы',
  musical: 'Музыкальные инструменты',
  other: 'Прочие инструменты',
};

/** Полный список всех инструментов с их локализованными названиями и категориями */
export const TOOLS_LIST: Array<{
  key: string;
  label: string;
  category: ToolCategory;
}> = [
  // Инструменты ремесленника
  {
    key: 'alchemists-supplies',
    label: 'Инструменты алхимика',
    category: 'artisan',
  },
  {
    key: 'brewers-supplies',
    label: 'Инструменты пивовара',
    category: 'artisan',
  },
  {
    key: 'calligraphers-supplies',
    label: 'Инструменты каллиграфа',
    category: 'artisan',
  },
  {
    key: 'carpenters-tools',
    label: 'Инструменты плотника',
    category: 'artisan',
  },
  {
    key: 'cartographers-tools',
    label: 'Инструменты картографа',
    category: 'artisan',
  },
  {
    key: 'cobblers-tools',
    label: 'Инструменты сапожника',
    category: 'artisan',
  },
  { key: 'cooks-utensils', label: 'Инструменты повара', category: 'artisan' },
  {
    key: 'glassblowers-tools',
    label: 'Инструменты стеклодува',
    category: 'artisan',
  },
  { key: 'jewelers-tools', label: 'Инструменты ювелира', category: 'artisan' },
  {
    key: 'leatherworkers-tools',
    label: 'Инструменты кожевника',
    category: 'artisan',
  },
  { key: 'masons-tools', label: 'Инструменты каменщика', category: 'artisan' },
  {
    key: 'painters-supplies',
    label: 'Инструменты художника',
    category: 'artisan',
  },
  { key: 'potters-tools', label: 'Инструменты гончара', category: 'artisan' },
  { key: 'smiths-tools', label: 'Инструменты кузнеца', category: 'artisan' },
  {
    key: 'tinkers-tools',
    label: 'Инструменты ремонтника',
    category: 'artisan',
  },
  { key: 'weavers-tools', label: 'Инструменты ткача', category: 'artisan' },
  {
    key: 'woodcarvers-tools',
    label: 'Инструменты резчика по дереву',
    category: 'artisan',
  },
  // Игровые наборы
  { key: 'dice-set', label: 'Набор костей', category: 'gaming' },
  {
    key: 'dragonchess-set',
    label: 'Шахматы «Копье дракона»',
    category: 'gaming',
  },
  {
    key: 'playing-card-set',
    label: 'Набор игральных карт',
    category: 'gaming',
  },
  {
    key: 'three-dragon-ante-set',
    label: 'Набор для игры «Три дракона»',
    category: 'gaming',
  },
  // Музыкальные инструменты
  { key: 'bagpipes', label: 'Волынка', category: 'musical' },
  { key: 'drum', label: 'Барабан', category: 'musical' },
  { key: 'dulcimer', label: 'Цимбалы', category: 'musical' },
  { key: 'flute', label: 'Флейта', category: 'musical' },
  { key: 'lute', label: 'Лютня', category: 'musical' },
  { key: 'lyre', label: 'Лира', category: 'musical' },
  { key: 'horn', label: 'Рожок', category: 'musical' },
  { key: 'pan-flute', label: 'Флейта Пана', category: 'musical' },
  { key: 'shawm', label: 'Шалмей', category: 'musical' },
  { key: 'viol', label: 'Виола', category: 'musical' },
  // Прочие инструменты
  { key: 'disguise-kit', label: 'Набор для маскировки', category: 'other' },
  { key: 'forgery-kit', label: 'Набор для фальсификации', category: 'other' },
  { key: 'herbalism-kit', label: 'Набор травника', category: 'other' },
  {
    key: 'navigators-tools',
    label: 'Инструменты навигатора',
    category: 'other',
  },
  { key: 'poisoners-kit', label: 'Набор отравителя', category: 'other' },
  { key: 'thieves-tools', label: 'Воровские инструменты', category: 'other' },
];

/** Локализованные названия инструментов (включая абстрактные группы) */
export const TOOLS_LABELS: Record<string, string> = {
  ...Object.fromEntries(TOOLS_LIST.map((tool) => [tool.key, tool.label])),
  // Обобщенные группы (для предысторий на выбор)
  'artisans-tools': 'Инструменты ремесленника (на выбор)',
  'gaming-set': 'Игровой набор (на выбор)',
  'musical-instrument': 'Музыкальный инструмент (на выбор)',
};

// ============================================================
// Языки
// ============================================================
export const LANGUAGE_TYPES = [
  // Стандартные языки
  'Общий',
  'Дварфийский',
  'Эльфийский',
  'Гигантский',
  'Гномский',
  'Гоблинский',
  'Полуросликовский',
  'Оркский',
  // Редкие языки
  'Абиссальный',
  'Небесный',
  'Глубинная речь',
  'Драконий',
  'Инфернальный',
  'Первоязык',
  'Сильван',
  'Подземный',
  // Экзотические языки
  'Друидический',
  'Язык воров',
];

// ============================================================
// Опыт и уровни
// ============================================================

/** Максимальный уровень персонажа */
export const MAX_LEVEL = 20;

/** Минимальное значение характеристики */
export const ABILITY_SCORE_MIN = 1;

/** Максимальное значение характеристики */
export const ABILITY_SCORE_MAX = 30;

/** Таблица опыта для уровней 1-20 */
export const EXPERIENCE_TABLE = [
  0, // Level 1
  300, // Level 2
  900, // Level 3
  2700, // Level 4
  6500, // Level 5
  14000, // Level 6
  23000, // Level 7
  34000, // Level 8
  48000, // Level 9
  64000, // Level 10
  85000, // Level 11
  100000, // Level 12
  120000, // Level 13
  140000, // Level 14
  165000, // Level 15
  195000, // Level 16
  225000, // Level 17
  265000, // Level 18
  305000, // Level 19
  355000, // Level 20
];

// ============================================================
// Редкость предметов (Item Rarity)
// ============================================================

/** Опции редкости предметов для UI-селекта */
export const RARITY_OPTIONS = [
  { value: 'none' as const, label: 'Не выбрана' },
  { value: 'common' as const, label: 'Обычный' },
  { value: 'uncommon' as const, label: 'Необычный' },
  { value: 'rare' as const, label: 'Редкий' },
  { value: 'very-rare' as const, label: 'Крайне редкий' },
  { value: 'legendary' as const, label: 'Легендарный' },
  { value: 'artifact' as const, label: 'Артефакт' },
] as const;

/** Цвета для отображения редкости в UI */
export const RARITY_COLORS: Record<string, string> = {
  'common': 'text-toned',
  'uncommon': 'text-success',
  'rare': 'text-info',
  'very-rare': 'text-primary',
  'legendary': 'text-warning',
  'artifact': 'text-error',
};

/** Локализованные названия редкости (ключ → русский лейбл) */
export const RARITY_LABELS: Record<string, string> = Object.fromEntries(
  RARITY_OPTIONS.map((option) => [option.value, option.label]),
);

// ============================================================
// Категории экипировки (Equipment Category)
// ============================================================

/** Иконка экипировки по умолчанию (Iconify, формат `tabler:*`) */
export const DEFAULT_EQUIPMENT_ICON = 'tabler:shirt';

/**
 * Иконки (Iconify `tabler:*`) для категорий экипировки.
 *
 * Содержит щит и не-бронные категории. Для брони
 * (`light`/`medium`/`heavy`) иконка берётся по базовому типу, поэтому
 * этих ключей здесь намеренно нет.
 */
export const EQUIPMENT_CATEGORY_ICONS: Partial<
  Record<EquipmentCategory, string>
> = {
  'shield': 'tabler:shield',
  'wand': 'tabler:wand',
  'ring': 'tabler:diamond',
  'trinket': 'tabler:crystal-ball',
  'clothing': 'tabler:shirt',
  'wondrous': 'tabler:sparkles',
  'food': 'tabler:meat',
  'adventurer-equipment': 'tabler:backpack',
};

/**
 * Возвращает иконку категории экипировки или `fallback`, если для
 * категории нет своей иконки либо категория не задана.
 *
 * @param category - ключ категории экипировки
 * @param fallback - иконка по умолчанию (по умолчанию `DEFAULT_EQUIPMENT_ICON`)
 * @returns имя иконки в формате `tabler:*`
 */
export function getEquipmentCategoryIcon(
  category: EquipmentCategory | undefined,
  fallback: string = DEFAULT_EQUIPMENT_ICON,
): string {
  if (!category) {
    return fallback;
  }

  return EQUIPMENT_CATEGORY_ICONS[category] ?? fallback;
}

// ============================================================
// Значения по умолчанию для актора
// ============================================================

/** Значения по умолчанию для нового актора D&D 5e */
export const DEFAULT_ACTOR: Omit<DnDActor, 'id'> = {
  entityType: 'actor',
  ownerId: undefined,
  name: 'Новый персонаж',
  description: '',
  avatar: undefined,

  // Токен (рамка включена по умолчанию)
  token: {
    frameUrl: 'assets/token-frames/0.png',
    showName: false,
  },

  // Системные данные D&D 5e
  system: {
    species: null,
    background: null,
    classes: [],
    experience: 0,
    inspiration: false,
    size: 'medium',

    abilities: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },

    movement: {
      walk: 30,
      swim: 0,
      fly: 0,
      climb: 0,
      burrow: 0,
      hover: false,
      units: 'ft',
    } satisfies ActorMovement,
    armorClass: {
      value: 10,
      calculation: 'default',
      formula: '',
      flat: null,
    },
    hitPoints: {
      current: 10,
      max: 10,
      temp: 0,
    },
    initiativeBonus: 0,
    initiativeAbility: 'dexterity',

    proficiencies: {
      armor: [],
      weapons: [],
      tools: [],
      languages: ['Общий'],
      savingThrows: [],
      skills: {},
      weaponMasteries: [],
    },

    currency: {
      cp: 0,
      sp: 0,
      ep: 0,
      gp: 0,
      pp: 0,
    },
    carryingCapacity: { ...DEFAULT_CARRYING_CAPACITY },
    preparedSpells: { ...DEFAULT_PREPARED_LIMIT },
    preparedCantrips: { ...DEFAULT_PREPARED_LIMIT },
    spellSlotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    pactSlotsUsed: 0,
    classCounters: [],
  },
  // Контентные данные актора (на корне, не в system)
  spells: [],
  equipment: [],
  features: [],
  activeEffects: [],
  notes: '',
};

// ============================================================
// Состояния (Conditions) D&D 5e (PHB 2024)
// ============================================================

/** Ключи состояний (определены в leaf-модуле `conditionKeys`) */
export type { ConditionKey, ConditionRef };

/**
 * Данные одного состояния.
 *
 * Форма общая для канона PHB и для состояний, заведённых в мире, — поэтому ключ
 * `ConditionRef`, а не канонный union: в списках, сетках и иммунитетах те и
 * другие ходят вперемешку.
 */
export interface ConditionEntry {
  /** Уникальный ключ состояния */
  key: ConditionRef;
  /** Название на русском */
  nameRu: string;
  /** Название на английском */
  nameEn: string;
  /** Иконка из коллекции (как fallback) */
  icon: string;
  /** Картинка-значок: ассет мира или файл из `public/assets/status/` */
  customImage?: string;
  /** Описание эффектов состояния */
  description: string;
  /**
   * Рисовать значок крупно поверх всей фишки, а не ячейкой в сетке статусов
   * (Ядро читает признак из `getConditions`). Так помечают состояние, которое
   * описывает существо целиком, а не временную помеху, — «Мёртв».
   */
  overlay?: boolean;
}

/**
 * Все состояния D&D 5e (PHB 2024)
 *
 * Источник: https://new.ttg.club/glossary/condition-phb
 */
export const CONDITIONS: readonly ConditionEntry[] = [
  {
    key: 'blinded',
    nameRu: 'Ослеплённый',
    nameEn: 'Blinded',
    icon: 'tabler:eye-off',
    customImage: '/assets/status/blinded.svg',
    description:
      'Автоматический провал проверок, требующих зрение. Броски атаки против вас с преимуществом, ваши — с помехой.',
  },
  {
    key: 'charmed',
    nameRu: 'Очарованный',
    nameEn: 'Charmed',
    icon: 'tabler:heart',
    customImage: '/assets/status/charmed.svg',
    description:
      'Нельзя атаковать или вредить очаровавшему. Очаровавший имеет преимущество на социальные проверки против вас.',
  },
  {
    key: 'deafened',
    nameRu: 'Оглохший',
    nameEn: 'Deafened',
    icon: 'tabler:ear-off',
    description:
      'Не можете слышать. Автоматический провал проверок, требующих слух.',
  },
  {
    key: 'exhaustion',
    nameRu: 'Истощённый',
    nameEn: 'Exhaustion',
    icon: 'tabler:battery-off',
    customImage: '/assets/status/exhaustion.svg',
    description:
      'Накапливается (до 6 степеней, смерть на 6). Тест к20 −2 за степень. Скорость −5 фт за степень. Продолжительный отдых снимает 1 степень.',
  },
  {
    key: 'frightened',
    nameRu: 'Испуганный',
    nameEn: 'Frightened',
    icon: 'tabler:mood-sad',
    customImage: '/assets/status/frightened.svg',
    description:
      'Помеха на проверки характеристик и броски атаки, пока источник страха в зоне видимости. Нельзя добровольно приблизиться к источнику.',
  },
  {
    key: 'grappled',
    nameRu: 'Схваченный',
    nameEn: 'Grappled',
    icon: 'tabler:hand-stop',
    customImage: '/assets/status/grappled.svg',
    description:
      'Скорость равна 0. Помеха на броски атаки по любой цели, кроме схватившего. Схвативший может тащить существо за собой.',
  },
  {
    key: 'incapacitated',
    nameRu: 'Недееспособный',
    nameEn: 'Incapacitated',
    icon: 'tabler:ban',
    description:
      'Нет действий, бонусных действий и реакций. Нет концентрации. Нельзя говорить. Помеха на инициативу.',
  },
  {
    key: 'invisible',
    nameRu: 'Невидимый',
    nameEn: 'Invisible',
    icon: 'tabler:eye-closed',
    description:
      'Преимущество на инициативу. Атаки против вас с помехой, ваши — с преимуществом. Не подвержены эффектам, требующим видимость цели.',
  },
  {
    key: 'paralyzed',
    nameRu: 'Парализованный',
    nameEn: 'Paralyzed',
    icon: 'tabler:user-minus',
    customImage: '/assets/status/paralyzed.svg',
    description:
      'Недееспособен. Скорость 0. Автопровал спасбросков СИЛ и ЛОВ. Атаки по вам с преимуществом. Крит в пределах 5 фт.',
  },
  {
    key: 'petrified',
    nameRu: 'Окаменевший',
    nameEn: 'Petrified',
    icon: 'tabler:diamond',
    customImage: '/assets/status/petrified.svg',
    description:
      'Превращение в камень. Недееспособен. Скорость 0. Автопровал спасбросков СИЛ и ЛОВ. Атаки с преимуществом. Сопротивление всему урону. Иммунитет к яду.',
  },
  {
    key: 'poisoned',
    nameRu: 'Отравленный',
    nameEn: 'Poisoned',
    icon: 'tabler:droplet',
    customImage: '/assets/status/poisoned.svg',
    description: 'Помеха на броски атаки и проверки характеристик.',
  },
  {
    key: 'prone',
    nameRu: 'Лежащий ничком',
    nameEn: 'Prone',
    icon: 'tabler:download',
    customImage: '/assets/status/prone.svg',
    description:
      'Передвижение только ползком или подъём (½ скорости). Помеха на ваши атаки. Преимущество атак в пределах 5 фт, иначе помеха.',
  },
  {
    key: 'restrained',
    nameRu: 'Опутанный',
    nameEn: 'Restrained',
    icon: 'tabler:link',
    customImage: '/assets/status/restrained.svg',
    description:
      'Скорость 0, не может быть увеличена. Атаки по вам с преимуществом, ваши — с помехой.',
  },
  {
    key: 'stunned',
    nameRu: 'Ошеломлённый',
    nameEn: 'Stunned',
    icon: 'tabler:bolt',
    customImage: '/assets/status/stunned.svg',
    description:
      'Недееспособен. Автопровал спасбросков СИЛ и ЛОВ. Атаки по вам с преимуществом.',
  },
  {
    key: 'unconscious',
    nameRu: 'Бессознательный',
    nameEn: 'Unconscious',
    icon: 'tabler:zzz',
    customImage: '/assets/status/unconscious.svg',
    description:
      'Недееспособен + лежащий ничком. Скорость 0. Автопровал СИЛ и ЛОВ. Атаки с преимуществом. Крит в пределах 5 фт. Не осознаёте окружение.',
  },
  {
    key: DEATH_CONDITION_KEY,
    nameRu: 'Мёртв',
    nameEn: 'Dead',
    // Своей картинки в наборе хоста (/assets/status/) нет — берём иконку
    // коллекции, как «Оглохший» и «Недееспособный»
    icon: 'tabler:skull',
    description: 'Существо мертво: запас хитов исчерпан.',
    // Смерть — не помеха на пару ходов, а конец существа: череп рисуется во
    // весь токен, иначе его теряют среди прочих значков состояний
    overlay: true,
  },
] as const;

/**
 * Состояния, которые выбирают руками в интерфейсе системы (тумблеры листа,
 * списки иммунитетов, выдача от вида и черт).
 *
 * «Мёртв» из них исключён: это производная метка, её ставит и снимает запас
 * хитов существа (`deathState.ts`), и выбор её руками ничего бы не значил.
 */
export const SELECTABLE_CONDITIONS: readonly ConditionEntry[] =
  CONDITIONS.filter((condition) => condition.key !== DEATH_CONDITION_KEY);

// ============================================================
// Валюты (Currency)
// ============================================================

/** Тип валюты D&D 5e */
export type CurrencyType = 'cp' | 'sp' | 'ep' | 'gp' | 'pp';

/**
 * Монеты кошелька — от самой мелкой к самой крупной. Порядок задаёт и порядок
 * полей в выпадающих списках стоимости, и порядок ячеек в строке валюты листа.
 */
export const CURRENCY_OPTIONS: ReadonlyArray<{
  value: CurrencyType;
  /** Подпись для выпадающего списка стоимости предмета */
  label: string;
  /** Сокращение для компактных строк («мм», «зм») */
  labelShort: string;
  /** Полное название монеты — для подсказок и подписей полей */
  labelFull: string;
}> = [
  {
    value: 'cp',
    label: 'Медные (мм)',
    labelShort: 'мм',
    labelFull: 'Медные монеты',
  },
  {
    value: 'sp',
    label: 'Серебряные (см)',
    labelShort: 'см',
    labelFull: 'Серебряные монеты',
  },
  {
    value: 'ep',
    label: 'Электрумовые (эм)',
    labelShort: 'эм',
    labelFull: 'Электрумовые монеты',
  },
  {
    value: 'gp',
    label: 'Золотые (зм)',
    labelShort: 'зм',
    labelFull: 'Золотые монеты',
  },
  {
    value: 'pp',
    label: 'Платиновые (пм)',
    labelShort: 'пм',
    labelFull: 'Платиновые монеты',
  },
] as const;

/** Валюта по умолчанию */
export const DEFAULT_CURRENCY: CurrencyType = 'gp';

/** Множество всех допустимых видов монет для быстрой проверки */
const CURRENCY_TYPE_SET: ReadonlySet<string> = new Set(
  CURRENCY_OPTIONS.map((option) => option.value),
);

/**
 * Проверяет, является ли значение видом монеты (`CurrencyType`).
 * Стоимость записи компендиума приходит объектом `{ value, currency }`, где
 * `currency` — произвольная строка: чужая монета не должна уехать в кошелёк.
 *
 * @param value - произвольное значение для проверки
 * @returns `true`, если `value` является `CurrencyType`
 */
export function isCurrencyType(value: unknown): value is CurrencyType {
  return typeof value === 'string' && CURRENCY_TYPE_SET.has(value);
}

/** Минимальное количество монет одного вида в кошельке */
export const CURRENCY_AMOUNT_MIN = 0;

/** Максимальное количество монет одного вида в кошельке */
export const CURRENCY_AMOUNT_MAX = 9_999_999;

/**
 * Парсит строку стоимости (напр. "15 зм") в структурированный объект.
 *
 * @param cost - строка или объект стоимости
 * @returns объект { value, currency }
 */
export function parseCost(
  cost: string | { value: number; currency?: string } | undefined | null,
): { value: number; currency: CurrencyType } {
  if (!cost) {
    return { value: 0, currency: DEFAULT_CURRENCY };
  }

  if (typeof cost === 'object') {
    return {
      value: cost.value ?? 0,
      currency: isCurrencyType(cost.currency)
        ? cost.currency
        : DEFAULT_CURRENCY,
    };
  }

  // Парсим строку типа "15 зм", "100 мм", "25gp"
  const shortToKey: Record<string, CurrencyType> = {
    мм: 'cp',
    cp: 'cp',
    см: 'sp',
    sp: 'sp',
    эм: 'ep',
    ep: 'ep',
    зм: 'gp',
    gp: 'gp',
    пм: 'pp',
    pp: 'pp',
  };

  // eslint-disable-next-line regexp/no-obscure-range
  const match = cost.trim().match(/^(\d+(?:[.,]\d+)?)\s*([a-zа-яё]+)?$/i);

  if (!match) {
    return { value: 0, currency: DEFAULT_CURRENCY };
  }

  const numericValue = Number.parseFloat(match[1].replace(',', '.'));
  const currencyStr = match[2]?.toLowerCase() ?? '';

  return {
    value: Number.isNaN(numericValue) ? 0 : numericValue,
    currency: shortToKey[currencyStr] ?? DEFAULT_CURRENCY,
  };
}

// ============================================================
// Состояния здоровья (Health Conditions) для текстового отображения ХП
// ============================================================

export type { HealthCondition, HpDisplayMode } from '@vtt/shared';

export { getHealthCondition, HEALTH_CONDITIONS } from '@vtt/shared';

// ============================================================
// Существа — Типы (Creature Categories)
// ============================================================

/** Локализованные названия типов существ */
export const CREATURE_CATEGORIES: Record<
  import('./creatureTypes.js').CreatureCategory,
  string
> = {
  aberration: 'Аберрация',
  beast: 'Зверь',
  celestial: 'Небожитель',
  construct: 'Конструкт',
  dragon: 'Дракон',
  elemental: 'Элементаль',
  fey: 'Фея',
  fiend: 'Исчадие',
  giant: 'Великан',
  humanoid: 'Гуманоид',
  monstrosity: 'Чудовище',
  ooze: 'Слизь',
  plant: 'Растение',
  undead: 'Нежить',
};

/** Опции типов существ для UI-селектов */
export const CREATURE_CATEGORY_OPTIONS = Object.entries(
  CREATURE_CATEGORIES,
).map(([value, label]) => ({ value, label }));

/** Множество всех допустимых типов существ бестиария для быстрой проверки */
const CREATURE_CATEGORY_SET: ReadonlySet<string> = new Set(
  Object.keys(CREATURE_CATEGORIES),
);

/**
 * Проверяет, что строка — тип существа бестиария (`CreatureCategory`).
 * Ключ приходит из списков выбора, компендиумов и записей мира строкой.
 *
 * @param value - произвольная строка для проверки
 * @returns `true`, если это известный тип существа
 */
export function isCreatureCategory(
  value: string,
): value is import('./creatureTypes.js').CreatureCategory {
  return CREATURE_CATEGORY_SET.has(value);
}

/**
 * Локализованные названия типов существ для актёров и видов (Species).
 *
 * Включает `swarm`, в отличие от `CREATURE_CATEGORIES` (только бестиарные типы).
 */
export const CREATURE_TYPE_LABELS: Record<
  import('./speciesTypes.js').CreatureType,
  string
> = {
  ...CREATURE_CATEGORIES,
  swarm: 'Рой',
  monstrosity: 'Монстр',
};

/** Множество всех допустимых типов существ для быстрой проверки */
const CREATURE_TYPE_SET: ReadonlySet<string> = new Set(
  Object.keys(CREATURE_TYPE_LABELS),
);

/**
 * Проверяет, является ли значение допустимым типом существа (`CreatureType`).
 * Значение приходит из записей мира и компендиумов, поэтому проверяется и его
 * тип: на месте ключа может оказаться что угодно.
 *
 * @param value - произвольное значение для проверки
 * @returns `true`, если `value` является `CreatureType`
 */
export function isCreatureType(
  value: unknown,
): value is import('./speciesTypes.js').CreatureType {
  return typeof value === 'string' && CREATURE_TYPE_SET.has(value);
}

// ============================================================
// Существа — Мировоззрения (Creature Alignments)
// ============================================================

/** Локализованные названия мировоззрений */
export const CREATURE_ALIGNMENTS: Record<
  import('./creatureTypes.js').CreatureAlignment,
  string
> = {
  'lawful-good': 'Законное доброе',
  'neutral-good': 'Нейтральное доброе',
  'chaotic-good': 'Хаотичное доброе',
  'lawful-neutral': 'Законное нейтральное',
  'true-neutral': 'Истинно нейтральное',
  'chaotic-neutral': 'Хаотичное нейтральное',
  'lawful-evil': 'Законное злое',
  'neutral-evil': 'Нейтральное злое',
  'chaotic-evil': 'Хаотичное злое',
  'unaligned': 'Без мировоззрения',
  'any': 'Любое мировоззрение',
};

/** Множество всех допустимых мировоззрений для быстрой проверки */
const CREATURE_ALIGNMENT_SET: ReadonlySet<string> = new Set(
  Object.keys(CREATURE_ALIGNMENTS),
);

/**
 * Проверяет, является ли строка мировоззрением существа.
 * Ключ приходит из компендиумов и записей мира в произвольном виде.
 *
 * @param value - произвольная строка для проверки
 * @returns `true`, если это известное мировоззрение
 */
export function isCreatureAlignment(
  value: string,
): value is import('./creatureTypes.js').CreatureAlignment {
  return CREATURE_ALIGNMENT_SET.has(value);
}

/** Опции мировоззрений для UI-селектов */
export const CREATURE_ALIGNMENT_OPTIONS = Object.entries(
  CREATURE_ALIGNMENTS,
).map(([value, label]) => ({ value, label }));

/**
 * Возвращает русскую локализацию мировоззрения.
 *
 * Нормализует ключ (пробелы → дефисы, приведение к lowercase)
 * для совместимости с данными JSON-компендиума, где ключи
 * могут приходить в формате `"chaotic evil"` вместо `"chaotic-evil"`.
 *
 * @param alignment - ключ мировоззрения (может содержать пробелы или дефисы)
 * @returns русское название или undefined если ключ неизвестен
 */
export function getAlignmentLabel(alignment: string): string | undefined {
  if (isCreatureAlignment(alignment)) {
    return CREATURE_ALIGNMENTS[alignment];
  }

  // Нормализация: пробелы → дефисы, lowercase
  const normalized = alignment.toLowerCase().replace(/\s+/g, '-');

  return isCreatureAlignment(normalized)
    ? CREATURE_ALIGNMENTS[normalized]
    : undefined;
}

// ============================================================
// Существа — Размеры (Creature Sizes)
// ============================================================

/** Размеры существ D&D 5e — от крошечного к громадному. */
export const CREATURE_SIZES: readonly CreatureSize[] = [
  'tiny',
  'small',
  'medium',
  'large',
  'huge',
  'gargantuan',
];

/** Размер существа, когда во внешних данных его нет или он не распознан. */
export const DEFAULT_CREATURE_SIZE: CreatureSize = 'medium';

/** Множество всех допустимых размеров существ для быстрой проверки */
const CREATURE_SIZE_SET: ReadonlySet<string> = new Set(CREATURE_SIZES);

/**
 * Проверяет, что строка — размер существа D&D 5e.
 *
 * @param value - произвольная строка для проверки
 * @returns `true`, если `value` является `CreatureSize`
 */
export function isCreatureSize(value: string): value is CreatureSize {
  return CREATURE_SIZE_SET.has(value);
}

/**
 * Приводит размер существа из внешних данных к `CreatureSize`.
 *
 * Компендиумы TTG Club и легаси-миры отдают размер как придётся: строкой в
 * другом регистре (`'Medium'`), пустым значением или вовсе без поля. Разбор
 * живёт в одном месте, поэтому дальше по системе размер всегда валиден —
 * таблицам вроде `CREATURE_SIZE_TO_TOKEN_SCALE` не нужны запасные значения
 * на каждом обращении.
 *
 * @param value - размер из внешних данных
 * @returns распознанный размер или `DEFAULT_CREATURE_SIZE`
 */
export function normalizeCreatureSize(value: unknown): CreatureSize {
  if (typeof value !== 'string') {
    return DEFAULT_CREATURE_SIZE;
  }

  const normalized = value.trim().toLowerCase();

  return isCreatureSize(normalized) ? normalized : DEFAULT_CREATURE_SIZE;
}

/** Локализованные названия размеров существ */
export const CREATURE_SIZE_LABELS: Record<CreatureSize, string> = {
  tiny: 'Крошечный',
  small: 'Маленький',
  medium: 'Средний',
  large: 'Большой',
  huge: 'Огромный',
  gargantuan: 'Громадный',
};

/** Опции размеров для UI-селектов */
export const CREATURE_SIZE_OPTIONS = Object.entries(CREATURE_SIZE_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/**
 * Размер существа → масштаб его токена (в клетках).
 *
 * Размер существа и масштаб токена — одна и та же величина, показанная в двух
 * местах интерфейса (селект «Размер» в листе и кнопки «Размер токена» в
 * настройках), поэтому таблица одна на всю систему. Значения совпадают с
 * `TOKEN_SIZE_OPTIONS` хоста: ядро знает только нейтральные числовые масштабы,
 * а их перевод в игровые «размеры существа» — правило D&D.
 */
export const CREATURE_SIZE_TO_TOKEN_SCALE: Record<CreatureSize, number> = {
  tiny: 0.5,
  small: 0.8,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4,
};

/**
 * Масштаб токена (в клетках) → размер существа.
 *
 * Выводится из `CREATURE_SIZE_TO_TOKEN_SCALE`, а не пишется руками: ручная
 * копия уже расходилась с прямой таблицей (в ней не было `small`), из-за чего
 * сохранение настроек токена сбрасывало размер существа.
 *
 * Произвольный масштаб (токен растянут на сцене вручную) в таблице
 * отсутствует — обращение к ней даёт `undefined`, и это не ошибка данных.
 */
export const TOKEN_SCALE_TO_CREATURE_SIZE: Record<number, CreatureSize> =
  CREATURE_SIZES.reduce<Record<number, CreatureSize>>(
    (accumulator, size) => ({
      ...accumulator,
      [CREATURE_SIZE_TO_TOKEN_SCALE[size]]: size,
    }),
    {},
  );

// ============================================================
// Существа — Показатели опасности (Challenge Ratings)
// ============================================================

/**
 * Таблица показателей опасности D&D 5e.
 * Содержит CR, опыт и бонус мастерства.
 */
export const CR_TABLE: ReadonlyArray<{
  cr: string;
  xp: number;
  proficiencyBonus: number;
}> = [
  { cr: '0', xp: 0, proficiencyBonus: 2 },
  { cr: '1/8', xp: 25, proficiencyBonus: 2 },
  { cr: '1/4', xp: 50, proficiencyBonus: 2 },
  { cr: '1/2', xp: 100, proficiencyBonus: 2 },
  { cr: '1', xp: 200, proficiencyBonus: 2 },
  { cr: '2', xp: 450, proficiencyBonus: 2 },
  { cr: '3', xp: 700, proficiencyBonus: 2 },
  { cr: '4', xp: 1100, proficiencyBonus: 2 },
  { cr: '5', xp: 1800, proficiencyBonus: 3 },
  { cr: '6', xp: 2300, proficiencyBonus: 3 },
  { cr: '7', xp: 2900, proficiencyBonus: 3 },
  { cr: '8', xp: 3900, proficiencyBonus: 3 },
  { cr: '9', xp: 5000, proficiencyBonus: 4 },
  { cr: '10', xp: 5900, proficiencyBonus: 4 },
  { cr: '11', xp: 7200, proficiencyBonus: 4 },
  { cr: '12', xp: 8400, proficiencyBonus: 4 },
  { cr: '13', xp: 10000, proficiencyBonus: 5 },
  { cr: '14', xp: 11500, proficiencyBonus: 5 },
  { cr: '15', xp: 13000, proficiencyBonus: 5 },
  { cr: '16', xp: 15000, proficiencyBonus: 5 },
  { cr: '17', xp: 18000, proficiencyBonus: 6 },
  { cr: '18', xp: 20000, proficiencyBonus: 6 },
  { cr: '19', xp: 22000, proficiencyBonus: 6 },
  { cr: '20', xp: 25000, proficiencyBonus: 6 },
  { cr: '21', xp: 33000, proficiencyBonus: 7 },
  { cr: '22', xp: 41000, proficiencyBonus: 7 },
  { cr: '23', xp: 50000, proficiencyBonus: 7 },
  { cr: '24', xp: 62000, proficiencyBonus: 7 },
  { cr: '25', xp: 75000, proficiencyBonus: 8 },
  { cr: '26', xp: 90000, proficiencyBonus: 8 },
  { cr: '27', xp: 105000, proficiencyBonus: 8 },
  { cr: '28', xp: 120000, proficiencyBonus: 8 },
  { cr: '29', xp: 135000, proficiencyBonus: 9 },
  { cr: '30', xp: 155000, proficiencyBonus: 9 },
];

/** Опции CR для UI-селектов */
export const CR_OPTIONS = CR_TABLE.map((entry) => ({
  value: entry.cr,
  label: `${entry.cr} (${entry.xp.toLocaleString('ru-RU')} XP)`,
}));

// ============================================================
// Существа — Значения по умолчанию
// ============================================================

/** Значения по умолчанию для нового существа */
export const DEFAULT_CREATURE: Omit<
  import('./dndEntities.js').DnDCreature,
  'id'
> = {
  entityType: 'creature',
  name: 'Новое существо',
  description: '',
  autoSaves: true,
  token: {
    frameUrl: 'assets/token-frames/0.png',
    showName: false,
    hpDisplayMode: 'text',
    disposition: 'hostile',
  },
  activeEffects: [],
  system: {
    size: 'medium',
    type: 'humanoid',
    subtype: '',
    alignment: 'unaligned',
    armorClass: { value: 10, calculation: 'flat', formula: '', flat: 10 },
    hitPoints: { average: 10, formula: '2к8 + 2' },
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
    proficiencyBonus: 2,
    savingThrows: [],
    skills: {},
    defenses: {
      vulnerabilities: [],
      resistances: [],
      immunities: [],
      conditionImmunities: [],
    },
    senses: 'пассивная Внимательность 10',
    languages: ['Общий'],
    environments: [],
    customEnvironments: '',
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    legendary: { count: 0, actions: [] },
  },
};
export const CREATURE_ENVIRONMENTS = [
  { key: 'any', label: 'Любая' },
  { key: 'swamp', label: 'Болото' },
  { key: 'mountain', label: 'Гора' },
  { key: 'urban', label: 'Город' },
  { key: 'forest', label: 'Лес' },
  { key: 'planar', label: 'План бытия' },
  { key: 'coastal', label: 'Побережье' },
  { key: 'underwater', label: 'Подводный мир' },
  { key: 'underdark', label: 'Подземелье' },
  { key: 'arctic', label: 'Приполярье' },
  { key: 'desert', label: 'Пустыня' },
  { key: 'grassland', label: 'Степь' },
  { key: 'hill', label: 'Холм' },
] as const;

// ============================================================
// Заряды заклинаний (восстановление от отдыха)
// ============================================================

/** Карта значение → подпись для способа восстановления зарядов */
export const SPELL_USES_RECOVERY_LABELS: Record<SpellUsesRecovery, string> = {
  atWill: 'По желанию',
  shortRest: 'Короткий отдых',
  longRest: 'Продолжительный отдых',
};

/** Способы восстановления зарядов в порядке показа */
const SPELL_USES_RECOVERY_KEYS: readonly SpellUsesRecovery[] = [
  'atWill',
  'shortRest',
  'longRest',
];

/** Опции способа восстановления зарядов заклинания (форма, список, макрос) */
export const SPELL_USES_RECOVERY_OPTIONS: ReadonlyArray<{
  value: SpellUsesRecovery;
  label: string;
}> = SPELL_USES_RECOVERY_KEYS.map((value) => ({
  value,
  label: SPELL_USES_RECOVERY_LABELS[value],
}));

/**
 * Нормализует способ восстановления зарядов к каноническому union из 3 значений.
 * Алиас `'day'` (формат стат-блоков 2024 «N/день») приводится к `'longRest'`.
 *
 * @param recovery - сырое значение восстановления (возможно, legacy/alias)
 * @returns канонический `SpellUsesRecovery`
 */
export function normalizeSpellUsesRecovery(
  recovery: unknown,
): SpellUsesRecovery {
  if (recovery === 'shortRest') {
    return 'shortRest';
  }

  if (recovery === 'longRest' || recovery === 'day') {
    return 'longRest';
  }

  return 'atWill';
}
