/**
 * Единый файл констант для DnD 5e актёра.
 *
 * Локализации характеристик, навыков, типов существ, размеров,
 * типов заклинателей и владений вынесены сюда,
 * чтобы избежать дублирования в компонентах.
 */

// Реэкспорт из единого shared-источника (производные от ABILITY_OPTIONS и SKILLS_LIST)
export {
  ABILITY_LABELS,
  CREATURE_SIZE_LABELS,
  CREATURE_TYPE_LABELS,
  SKILLS_LABELS as SKILL_LABELS,
} from '@vtt/shared/system/dnd.js';

// ============================================================
// MIME-типы для drag-and-drop сущностей
// ============================================================
/** MIME-тип для предысторий */
export const BACKGROUND_DEFINITION_MIME = 'application/background-definition';
/** MIME-тип для видов */
export const SPECIES_DEFINITION_MIME = 'application/species-definition';
/** MIME-тип для классов */
export const CLASS_DEFINITION_MIME = 'application/class-definition';
/** MIME-тип для заклинаний (drag-and-drop) */
export const SPELL_MIME = 'application/spell-item';
/** MIME-тип для предметов снаряжения (drag-and-drop) */
export const GAME_ITEM_MIME = 'application/game-item';
/** MIME-тип для черт и особенностей (drag-and-drop) */
export const GAME_FEATURE_MIME = 'application/game-feature';
/** Re-export: определение перенесено в core/mimeTypes.ts */
export { GAME_ITEM_TRANSFER_MIME } from '@/core/mimeTypes';

// ============================================================
// Незаполненные разделы шапки листа персонажа
// ============================================================

/** Раздел шапки листа, который заполняется переносом записи из компендиума */
export interface MissingSheetSection {
  /** Текст-плейсхолдер, например «Вид не выбран» */
  label: string;
  /** Подсказка: откуда взять недостающие данные */
  hint: string;
}

/** Разделы шапки листа, у которых есть подсказка при незаполненном значении */
export type MissingSheetSectionKey = 'species' | 'class' | 'background';

/**
 * Плейсхолдеры и подсказки для незаполненных разделов шапки листа.
 *
 * Вид, класс и предыстория попадают на лист только переносом из компендиума —
 * подсказка объясняет это тем, кто не знает про drag-and-drop.
 */
export const MISSING_SHEET_SECTIONS: Record<
  MissingSheetSectionKey,
  MissingSheetSection
> = {
  species: {
    label: 'Вид не выбран',
    hint: 'Чтобы добавить вид, перетащите его из компендиума на лист персонажа',
  },
  class: {
    label: 'Класс не выбран',
    hint: 'Чтобы добавить класс, перетащите его из компендиума на лист персонажа',
  },
  background: {
    label: 'Предыстория не выбрана',
    hint: 'Чтобы добавить предысторию, перетащите её из компендиума на лист персонажа',
  },
};

/** Локализация типов владения доспехами */
export const ARMOR_PROF_LABELS: Record<string, string> = {
  light: 'Лёгкое снаряжение',
  medium: 'Среднее снаряжение',
  heavy: 'Тяжёлое снаряжение',
  shield: 'Щиты',
};

/** Короткие названия доспехов (для компактных таблиц) */
export const ARMOR_PROF_SHORT_LABELS: Record<string, string> = {
  light: 'Лёгкие',
  medium: 'Средние',
  heavy: 'Тяжёлые',
  shield: 'Щиты',
};

/** Локализация типов владения оружием */
export const WEAPON_PROF_LABELS: Record<string, string> = {
  'simple': 'Простое оружие',
  'martial': 'Воинское оружие',
  'hand-crossbow': 'Ручной арбалет',
  'crossbow-hand': 'Ручной арбалет',
  'longsword': 'Длинный меч',
  'rapier': 'Рапира',
  'shortsword': 'Короткий меч',
  'scimitar': 'Ятаган',
};

/** Короткие названия оружия (для компактных таблиц) */
export const WEAPON_PROF_SHORT_LABELS: Record<string, string> = {
  'simple': 'Простое',
  'martial': 'Воинское',
  'hand-crossbow': 'Руч. арбалет',
  'crossbow-hand': 'Руч. арбалет',
  'longsword': 'Длинный меч',
  'rapier': 'Рапира',
  'shortsword': 'Короткий меч',
  'scimitar': 'Ятаган',
};

/** Локализация владения инструментами */
export const TOOL_PROF_LABELS: Record<string, string> = {
  'thieves-tools': 'Воровские инструменты',
  'three-musical-instruments': 'Три музыкальных инструмента',
  'herbalism-kit': 'Набор травника',
};

/**
 * Короткие аббревиатуры характеристик (для таблиц навыков и способностей)
 *
 * Используется в `SkillItem`, `CreatureAbilities`, `CreatureSkillsModal`.
 */
export const ABILITY_SHORT_LABELS: Record<string, string> = {
  strength: 'СИЛ',
  dexterity: 'ЛОВ',
  constitution: 'ТЕЛ',
  intelligence: 'ИНТ',
  wisdom: 'МУД',
  charisma: 'ХАР',
};

/**
 * Запас по бокам названия в шапке блока характеристики (px):
 * горизонтальные отступы `legend` плюс место до скруглений рамки.
 *
 * Если полное название вместе с этим запасом не влезает в ширину блока,
 * `AbilityScore` показывает аббревиатуру из `ABILITY_SHORT_LABELS`.
 */
export const ABILITY_LABEL_SIDE_SPACE = 20;

/**
 * Формат числовых полей своего бонуса в модалках листа: знак виден и у плюса,
 * иначе поле читается количеством, а не поправкой.
 */
export const BONUS_INPUT_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  signDisplay: 'exceptZero',
};

/** Локализованные названия типов заклинателей */
export const CASTER_TYPE_LABELS: Record<string, string> = {
  full: 'Полный',
  half: 'Половинный',
  third: 'Третичный',
  pact: 'Пакт',
  none: 'Нет',
};

// ============================================================
// Ряд отбора на вкладках листа
// ============================================================

/**
 * Общая часть оформления чипа отбора — тот же чип, что и в листе персонажа на
 * сайте: невысокая рамка вокруг короткой подписи, ряд чипов читается как один
 * набор переключателей.
 *
 * Высота задана явно и равна ступени `sm` компонентов Nuxt UI (28px), а не
 * складывается из отступов: у чипа настоящая рамка `border`, входящая в
 * габарит, а у поля и кнопки — обводка `ring`, которая габарит не меняет. От
 * одинаковых отступов ряд поэтому расходится на пару пикселей.
 */
export const FILTER_CHIP_CLASS =
  'flex h-7 cursor-pointer items-center justify-center gap-1 rounded border text-xs transition-colors select-none';

/** Размер компонентов Nuxt UI, с которым чипы стоят в одном ряду */
export const FILTER_ROW_CONTROL_SIZE = 'sm';

/** Форма чипа отбора: под подпись либо квадрат под один значок */
export type FilterChipShape = 'text' | 'icon';

/**
 * Чип с подписью: место под текст по бокам. Минимальная ширина равна высоте —
 * короткая подпись (номер круга, буква пометки) остаётся квадратом.
 */
export const FILTER_CHIP_TEXT_CLASS = 'min-w-7 px-2';

/**
 * Чип со значком вместо подписи: квадрат — боковые отступы ему не нужны,
 * значок и так стоит по центру.
 */
export const FILTER_CHIP_ICON_CLASS = 'w-7';

/** Невыбранный чип отбора: рамка теплеет только под курсором */
export const FILTER_CHIP_IDLE_CLASS =
  'border-default text-toned hover:border-warning/60';

/** Выбранный чип отбора: горит тёплым, как отмеченная строка списка */
export const FILTER_CHIP_SELECTED_CLASS =
  'border-warning bg-warning/10 text-warning';

/** Подписи ряда отбора, общие для вкладок листа */
export const SHEET_FILTER_LABELS: Record<
  'search' | 'clear' | 'reset' | 'resetHint' | 'empty',
  string
> = {
  search: 'Поиск по названию…',
  clear: 'Очистить поиск',
  reset: 'Сбросить',
  resetHint: 'Снять отбор и вернуть список целиком',
  empty: 'Под отбор ничего не подошло',
};

/** Подписи чипов отбора на вкладке заклинаний */
export const SPELL_FILTER_LABELS: Record<
  | 'prepared'
  | 'preparedHint'
  | 'cantrip'
  | 'cantripHint'
  | 'properties'
  | 'propertiesHint',
  string
> = {
  prepared: 'Подготовленные',
  preparedHint:
    'Оставить в списке только подготовленные заклинания; заговоры доступны всегда и остаются в нём',
  cantrip: 'Зг',
  cantripHint: 'Заговоры',
  properties: 'Свойства заклинания',
  propertiesHint: 'Отбор по свойствам: лечение, концентрация, ритуал',
};

/** Свойство заклинания, по которому сужается список вкладки */
export type SpellPropertyFilterKey = 'healing' | 'concentration' | 'ritual';

/** Пункт отбора по свойству заклинания */
export interface SpellPropertyFilter {
  /** Ключ свойства */
  key: SpellPropertyFilterKey;
  /** Название свойства — подпись пункта меню */
  label: string;
  /** Значок свойства */
  icon: string;
}

/**
 * Свойства заклинания, по которым сужается список. Живут в раскрывающемся
 * меню, а не чипами в ряду: обращаются к ним заметно реже, чем к кругам, а
 * место в ряду они занимали наравне с ними.
 */
export const SPELL_PROPERTY_FILTERS: SpellPropertyFilter[] = [
  { key: 'healing', label: 'Лечение', icon: 'tabler:heart-filled' },
  { key: 'concentration', label: 'Концентрация', icon: 'tabler:focus-2' },
  { key: 'ritual', label: 'Ритуал', icon: 'tabler:book' },
];

/**
 * Источник особенности, по которому сужается список вкладки. Черты входят
 * сюда наравне с остальными: раздел у них на вкладке свой, и чип «Черта»
 * оставляет на виду только его.
 */
export type FeatureOriginKey =
  'species' | 'class' | 'subclass' | 'background' | 'feat' | 'custom';

/**
 * Порядок чипов отбора по источнику: он постоянный, чтобы чипы не прыгали при
 * пополнении листа. Идёт от того, что персонаж получает раньше.
 */
export const FEATURE_ORIGIN_ORDER: FeatureOriginKey[] = [
  'species',
  'class',
  'subclass',
  'background',
  'feat',
  'custom',
];

/** Подписи чипов отбора по источнику особенности */
export const FEATURE_ORIGIN_LABELS: Record<FeatureOriginKey, string> = {
  species: 'Вид',
  class: 'Класс',
  subclass: 'Подкласс',
  background: 'Предыстория',
  feat: 'Черта',
  custom: 'Своё',
};

/** Подсказки чипов отбора по источнику особенности */
export const FEATURE_ORIGIN_HINTS: Record<FeatureOriginKey, string> = {
  species: 'Оставить в списке только особенности вида',
  class: 'Оставить в списке только особенности класса',
  subclass: 'Оставить в списке только особенности подкласса',
  background: 'Оставить в списке только особенности предыстории',
  feat: 'Оставить на вкладке только раздел черт',
  custom: 'Оставить в списке только записи, заведённые на листе вручную',
};
