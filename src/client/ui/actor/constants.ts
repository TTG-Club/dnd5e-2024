/**
 * Единый файл констант для DnD 5e актёра.
 *
 * Локализации характеристик, навыков, типов существ, размеров,
 * типов заклинателей и владений вынесены сюда,
 * чтобы избежать дублирования в компонентах.
 */

import type {
  AbilityType,
  ArmorCalculation,
  WeaponRangeType,
} from '@vtt/shared';

import { CUSTOM_SKILLS_MAX } from '@vtt/shared/system/dnd.js';

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
 * Используется в `SkillItem`, `CreatureAbilities`, строке действия существа.
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
 * Надпись на кнопке окна броска по умолчанию. Общая для листов персонажа и
 * существа: окно броска у них одно, и вразнобой кнопка читалась бы как разная.
 */
export const DICE_ROLL_DEFAULT_BUTTON = 'Бросить';

/** Надпись на кнопке броска урона — она одна у заклинаний и действий */
export const SPELL_DAMAGE_ROLL_BUTTON = 'Бросить урон';

/**
 * Подписи способов расчёта класса доспеха. Список общий у окна КД и подсказки
 * плитки листа.
 *
 * `custom` подписан, хотя в выбор не попадает: способ есть в нейтральном типе
 * записи, а движок считает его как «по умолчанию» — подпись нужна, чтобы у
 * записи из чужого мира подсказка не оказалась пустой.
 */
export const ARMOR_CALCULATION_LABELS: Record<ArmorCalculation, string> = {
  default: 'По умолчанию',
  natural: 'Природная броня',
  flat: 'Фиксированный',
  custom: 'По умолчанию',
};

/**
 * Способы расчёта КД, которые предлагает окно. `custom` в выбор не входит:
 * своей формулы у системы нет, и выбор способа, который считается как
 * «по умолчанию», только вводил бы в заблуждение.
 */
export const ARMOR_CALCULATION_OPTIONS: ArmorCalculation[] = [
  'default',
  'natural',
  'flat',
];

/**
 * Приписка «природный доспех» в записи класса доспеха. Значение записи, а не
 * подпись: по нему же ставится галочка в окне.
 */
export const NATURAL_ARMOR_FORMULA = 'природный доспех';

/** Подписи настройки класса доспеха */
export const ARMOR_CLASS_SETTINGS_LABELS = {
  formulaTitle: 'Формула',
  calculation: 'Расчёт',
  naturalBase: 'Базовый КД',
  flatValue: 'Значение',
  dexPart: 'мод. Ловкости',
  defaultHint: 'Без доспеха КД всегда равен 10 + модификатор Ловкости.',
  naturalHint: 'Природная броня: базовое значение + модификатор Ловкости.',
  naturalCreatureHint:
    'Природная броня: фиксированное значение для существа. Модификатор '
    + 'Ловкости обычно уже учтён в значении.',
  naturalMark: 'Природная броня (приписка)',
  flatHint:
    'Фиксированное значение КД. Модификатор Ловкости не учитывается. Позволяет '
    + 'указать, что это значение является природной броней.',
  bonusesTitle: 'Свои бонусы',
  bonusesHint:
    'Идут поверх любого расчёта: и по формуле, и с фиксированным значением. '
    + 'Так заводят кольцо защиты или боевой стиль — щит и активные эффекты '
    + 'считаются отдельно.',
} as const;

/** Подписи настройки инициативы */
export const INITIATIVE_SETTINGS_LABELS = {
  title: 'Настройка инициативы',
  ability: 'Характеристика',
  flatBonus: 'Доп. бонус',
  total: 'Итого',
  bonusesTitle: 'Свои бонусы',
  bonusesHint:
    'Складываются с модификатором характеристики. Бонус от мастерства нужен '
    + 'умениям вроде «Ловкача», а не отдельным числом.',
} as const;

/** Подписи настройки передвижения */
export const MOVEMENT_SETTINGS_LABELS = {
  title: 'Передвижение',
  units: 'Единицы',
  hover: 'Парение',
  bonusesHint:
    'Бонус идёт только в тот вид передвижения, у которого он заведён, и только '
    + 'если скорость этого вида не нулевая: ноль значит, что так лист не '
    + 'передвигается вовсе.',
  addBonus: 'Добавить бонус к виду передвижения',
} as const;

/**
 * Подписи плиток листа, общие для персонажа и существа. Плитки в обоих листах
 * одни и те же, и расходиться их названия не должны.
 */
export const SHEET_TILE_LABELS = {
  armorClass: 'Класс доспеха',
  initiative: 'Инициатива',
  hitPoints: 'Здоровье',
  proficiency: 'Мастерство',
} as const;

/**
 * Подписи кнопок окон — общие для листа персонажа, листа существа, окон
 * компендиума и мастеров создания. Кнопки эти стоят в каждом окне, и раньше
 * подпись вписывалась в шаблон на месте: при первой же правке формулировки
 * окна разъехались бы между собой.
 *
 * `apply`, `save` и `create` — три разных действия, а не синонимы одного:
 * окно настройки применяет посчитанное значение к листу, окно правки сущности
 * сохраняет саму запись, а у ещё не созданной записи то же действие называется
 * созданием. Сводить их в одну подпись нельзя — окна перестанут различаться.
 */
export const MODAL_BUTTON_LABELS = {
  /** Подтверждение окна настройки: посчитанное значение уходит на лист */
  apply: 'Применить',
  /** Подтверждение окна правки сущности: запись сохраняется */
  save: 'Сохранить',
  /** То же подтверждение, когда записи ещё нет и она заводится впервые */
  create: 'Создать',
  /** Отказ от правок: окно закрывается, ничего не применяя */
  cancel: 'Отмена',
  /** Удаление записи — кнопка окна и опасный пункт меню строки */
  remove: 'Удалить',
  /** Пополнение списка внутри окна: строка бонуса, счётчик, действие существа */
  add: 'Добавить',
  /**
   * Пополнение списка активных эффектов. Кнопка эта стоит в семи окнах правки и
   * в блоке эффектов существа; в четырёх из них подпись была со заглавной
   * («Добавить Эффект») — по-русски так не пишут, поэтому вариант один.
   */
  addEffect: 'Добавить эффект',
  /** Закрыть окно, ничего не решая: крестик в шапке листа */
  close: 'Закрыть',
  /** Единственная кнопка окна, которое только показывает: «прочитал» */
  done: 'Готово',
  /** Шаг назад в мастере создания */
  back: 'Назад',
  /** Шаг вперёд в мастере создания */
  next: 'Далее',
} as const;

/**
 * Подписи окна несохранённых правок. Окно одно и то же у листа персонажа,
 * листа существа и формы заклинания — расходиться его подписи не должны.
 *
 * `discard` живёт отдельно от `MODAL_BUTTON_LABELS.cancel` не по недосмотру: в
 * этом окне обе кнопки стоят рядом, и делают они разное — «Отмена» оставляет
 * окно правки открытым, «Отменить изменения» бросает правки и уходит.
 */
export const UNSAVED_CHANGES_LABELS = {
  title: 'Несохранённые изменения',
  discard: 'Отменить изменения',
} as const;

/** Заголовок окна подтверждения удаления — оно одно у персонажа и существа */
export const DELETE_CONFIRM_TITLE = 'Подтверждение удаления';

/** Подсказка переключателя режима правки в шапке обоих листов */
export const EDIT_MODE_TOGGLE_TITLE = 'Режим редактирования';

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

/** Подписи строк своего бонуса — они одни у всех настроек листа */
export const CUSTOM_BONUS_LABELS: Record<
  | 'source'
  | 'flatSource'
  | 'proficiencySource'
  | 'labelPlaceholder'
  | 'add'
  | 'remove'
  | 'unnamed',
  string
> = {
  source: 'Источник бонуса',
  flatSource: 'Своё число',
  proficiencySource: 'Бонус мастерства',
  labelPlaceholder: 'Откуда бонус',
  add: 'Добавить бонус',
  remove: 'Удалить бонус',
  unnamed: 'Свой бонус',
};

/** Подписи настройки бонуса мастерства */
export const PROFICIENCY_SETTINGS_LABELS = {
  title: 'Бонус мастерства',
  open: 'Настроить бонус мастерства',
  hint:
    'Бонус мастерства идёт в спасброски, навыки, атаку оружием и '
    + 'заклинательство. По правилам он растёт с уровнем персонажа, но основу '
    + 'можно задать своим числом, а сверху добавить свои бонусы.',
  baseTitle: 'Основа',
  customBase: 'Своё число вместо расчёта по уровню',
  baseValue: 'Своё число основы',
  levelSource: 'По уровню',
  bonusesTitle: 'Свои бонусы',
  totalTitle: 'Итоговый бонус',
  effects: 'Активные эффекты',
  overriddenHint:
    'Итог задан активным эффектом целиком: пока эффект держится, настройка '
    + 'на число не влияет — она сработает, когда он спадёт.',
} as const;

/**
 * Характеристики спасбросков в порядке показа: список идёт по столбцам сетки
 * два на три, поэтому пары стоят рядом (Сила — Интеллект и так далее).
 *
 * Общий для листа персонажа и листа существа: блок спасбросков у них один и тот
 * же, и расходиться порядок с сокращениями не должен.
 */
export const SAVING_THROW_ABILITIES: Array<{
  key: AbilityType;
  label: string;
  shortLabel: string;
}> = [
  { key: 'strength', label: 'Сила', shortLabel: 'Сил.' },
  { key: 'intelligence', label: 'Интеллект', shortLabel: 'Инт.' },
  { key: 'dexterity', label: 'Ловкость', shortLabel: 'Лов.' },
  { key: 'wisdom', label: 'Мудрость', shortLabel: 'Мдр.' },
  { key: 'constitution', label: 'Телосложение', shortLabel: 'Тел.' },
  { key: 'charisma', label: 'Харизма', shortLabel: 'Хар.' },
];

/** Подписи настройки спасбросков */
export const SAVING_THROW_SETTINGS_LABELS = {
  title: 'Настройка спасбросков',
  open: 'Настроить спасброски',
  hint:
    'Характеристика задаёт модификатор спасброска, при владении к нему '
    + 'добавляется бонус мастерства. Дополнительные бонусы складываются '
    + 'сверху — их сколько угодно.',
  commonTitle: 'Ко всем спасброскам',
  commonHint:
    'Бонус идёт в каждый из шести спасбросков: так заводят плащ защиты или '
    + 'ауру паладина, а не повторяют одно и то же шесть раз.',
  ability: 'Характеристика спасброска',
  proficient: 'Владеет спасброском',
  notProficient: 'Не владеет спасброском',
  proficiency: 'Владение спасброском',
  reset: 'Вернуть спасбросок к правилам',
  addBonus: 'Добавить бонус',
} as const;

/**
 * Подпись разделителя группы навыков (слот `label` у `USeparator`): мелкие
 * прописные. Цвет добавляется на месте — в списке листа подпись подсвечивается
 * вместе с группой. Константа общая: разделитель рисуют и список навыков
 * листа, и окно их настройки — вразнобой группы читались бы как разные списки.
 */
export const SKILL_GROUP_LABEL_CLASS =
  'text-[10px] font-bold tracking-wider uppercase transition-colors';

/**
 * Подсветка навыков наведённой характеристики: мягкая заливка и внутренняя
 * обводка. Обводка целиком лежит в этом классе и ничего не дублирует в
 * базовом: держать в базовом прозрачный `ring-transparent` нельзя — в
 * собранном CSS он идёт после цветной обводки и при равной специфичности
 * всегда её перебивает.
 */
export const HIGHLIGHTED_SKILL_ROW_CLASS =
  'bg-primary/10 ring-1 ring-primary/50 ring-inset';

/** Подписи настройки навыков */
export const SKILL_SETTINGS_LABELS = {
  title: 'Настройка навыков',
  open: 'Настроить навыки',
  hint:
    'Характеристика задаёт модификатор навыка, к нему добавляется бонус '
    + 'мастерства по уровню владения. Дополнительные бонусы складываются '
    + 'сверху — их сколько угодно.',
  ability: 'Характеристика навыка',
  proficiency: 'Владение навыком',
  reset: 'Вернуть навык к правилам',
  addBonus: 'Добавить бонус',
  passive: 'Пассивное значение',
  effects: 'Активные эффекты',
  overriddenBadge: 'Эффект',
  overriddenHint:
    'Итог навыка задан активным эффектом целиком: пока эффект держится, '
    + 'настройка на число не влияет — она сработает, когда он спадёт.',
  customTitle: 'Свой навык',
  customHint:
    'Навыка нет в правилах: он встанет в общий список по алфавиту и будет '
    + 'бросаться наравне с остальными.',
  customNamePlaceholder: 'Название навыка',
  customAdd: 'Добавить навык',
  customRemove: 'Удалить свой навык',
  customBadge: 'Свой',
  customDuplicate: 'Навык с таким названием уже есть',
  customLimit: `Своих навыков не больше ${CUSTOM_SKILLS_MAX}`,
  groupTitle: 'Группировать по характеристикам',
  groupHint:
    'Навыки встанут группами под своими характеристиками. Группу задаёт '
    + 'характеристика самого навыка: дополнительные бонусы от других '
    + 'характеристик в счёт не идут.',
} as const;

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

// ============================================================
// Строки списков на вкладках листа (снаряжение и заклинания)
// ============================================================

/**
 * Хвост подсказки нажимаемой плитки. Плитка броска отличается от справочной
 * только цветом рамки, и без этой строки её нажимаемость видна лишь по курсору.
 */
export const SHEET_ROLL_HINT_LABEL = 'нажмите, чтобы бросить';

/**
 * Подписи для скринридера в строках списков листа. К каждой дописывается
 * название записи («Открыть предмет: Кинжал»): по одной подписи на всю строку
 * список читался бы набором одинаковых кнопок.
 */
export const SHEET_ROW_ARIA_LABELS: Record<
  | 'openItem'
  | 'openSpell'
  | 'roll'
  | 'decreaseQuantity'
  | 'increaseQuantity'
  | 'quantity'
  | 'itemActions'
  | 'spellActions',
  string
> = {
  openItem: 'Открыть предмет',
  openSpell: 'Открыть заклинание',
  roll: 'Бросок',
  decreaseQuantity: 'Уменьшить количество',
  increaseQuantity: 'Увеличить количество',
  quantity: 'Количество',
  itemActions: 'Действия с предметом',
  spellActions: 'Действия с заклинанием',
};

/**
 * Подписи пунктов меню, общие для строк снаряжения и заклинаний. Строки обеих
 * вкладок ведут себя одинаково, и подписи у общих действий обязаны совпадать.
 */
export const SHEET_ROW_MENU_LABELS: Record<
  'edit' | 'share' | 'remove',
  string
> = {
  edit: 'Редактировать',
  share: 'Поделиться в чат',
  /** Действие то же, что и у кнопки окна, — подпись берётся оттуда же */
  remove: MODAL_BUTTON_LABELS.remove,
};

/**
 * Значки записей по типу предмета. Оружия и снаряжения здесь нет: у оружия
 * значок рисует `WeaponIcon` по базовому типу, а у снаряжения его выбирает
 * категория (`getEquipmentCategoryIcon` из движка).
 */
export const EQUIPMENT_TYPE_ICONS: Record<string, string> = {
  'trinket': 'tabler:diamond',
  'rod': 'tabler:wand',
  'ring': 'tabler:circle-dotted',
  'clothing': 'tabler:hanger',
  'wand': 'tabler:wand',
  'wondrous': 'tabler:sparkles',
  'vehicle-equipment': 'tabler:horse',
  'tool': 'tabler:tools',
  'spell': 'tabler:sparkles',
};

/** Значок записи неизвестного типа */
export const DEFAULT_EQUIPMENT_ICON = 'tabler:box';

/** Подпись типа дальности оружия — вторая часть подписи под названием */
export const WEAPON_RANGE_TYPE_LABELS: Record<WeaponRangeType, string> = {
  melee: 'Рукопашное оружие',
  ranged: 'Дальнобойное оружие',
};

/** Короткие подписи плиток параметров в строке снаряжения */
export const EQUIPMENT_STAT_LABELS: Record<
  'attack' | 'damage' | 'armorClass' | 'toolBonus' | 'cost',
  string
> = {
  attack: 'Атака',
  damage: 'Урон',
  armorClass: 'КД',
  toolBonus: 'Бонус',
  cost: 'Цена',
};

/** Единица измерения веса — подпись плитки веса */
export const WEIGHT_UNIT_LABEL = 'фнт.';

/** Подсказки плиток параметров, у которых своей расшифровки нет */
export const EQUIPMENT_STAT_HINTS: Record<
  'attack' | 'armorClass' | 'shieldClass' | 'toolBonus' | 'cost' | 'weight',
  string
> = {
  attack: 'Бонус броска атаки этим оружием',
  armorClass: 'Класс доспеха, который даёт надетый доспех',
  shieldClass: 'Бонус к классу доспеха от щита',
  toolBonus: 'Бонус к проверкам этим инструментом',
  cost: 'Стоимость одного предмета',
  weight: 'Вес одного предмета в фунтах',
};

/** Подписи кнопки надевания и причина, по которой она не нажимается */
export const EQUIPMENT_EQUIP_ACTION_LABELS: Record<
  'equip' | 'unequip' | 'blocked',
  string
> = {
  equip: 'Надеть',
  unequip: 'Снять',
  blocked: 'Уже надето другое снаряжение: доспех носят только один',
};

/** Значки состояния предмета рядом с названием */
export const EQUIPMENT_BADGE_LABELS: Record<
  'equipped' | 'twoHanded' | 'attuned' | 'attunementRequired',
  string
> = {
  equipped: 'Надет',
  twoHanded: 'Двуручный хват',
  attuned: 'Настроен',
  attunementRequired: 'Нужна настройка',
};

/** Подсказки значков состояния предмета */
export const EQUIPMENT_BADGE_HINTS: Record<
  'twoHanded' | 'attuned' | 'attunementRequired',
  string
> = {
  twoHanded:
    'Универсальным оружием пользуются двуручным хватом: урон катится большей костью. Хват меняется в меню строки и снятия не боится',
  attuned: 'Персонаж настроен на предмет — свойства предмета работают',
  attunementRequired:
    'Предмет требует настройки: его свойства не работают, пока персонаж на него не настроен — настройка в меню строки',
};

/**
 * Подписи пунктов меню строки снаряжения. Меню одно на правую кнопку мыши и на
 * «⋮» в конце строки: расходиться наборы действий не должны.
 */
export const EQUIPMENT_MENU_LABELS: Record<
  'attack' | 'twoHandedGrip' | 'attune' | 'unattune',
  string
> = {
  attack: 'Атаковать',
  /** Отметка, а не действие: снята — оружием пользуются одной рукой */
  twoHandedGrip: 'Двуручный хват',
  attune: 'Настроить',
  unattune: 'Снять настройку',
};

// ============================================================
// Строка заклинания на вкладке листа
// ============================================================

/** Короткие подписи плиток параметров в строке заклинания */
export const SPELL_STAT_LABELS: Record<'damage' | 'uses', string> = {
  damage: 'Урон',
  uses: 'Заряды',
};

/** Подсказки плиток строки заклинания */
export const SPELL_STAT_HINTS: Record<'damage' | 'usesEmpty', string> = {
  damage: 'Урон заклинания с учётом характеристик персонажа',
  usesEmpty: 'Заряды закончились — их вернёт отдых',
};

/**
 * Подсказки значка подготовки — он же переключатель. Заговор и всегда
 * подготовленное заклинание не переключаются: значок у них только горит.
 */
export const SPELL_PREPARED_LABELS: Record<
  'prepare' | 'unprepare' | 'always' | 'cantrip',
  string
> = {
  prepare: 'Подготовить',
  unprepare: 'Снять подготовку',
  always: 'Всегда подготовлено',
  cantrip: 'Заговор доступен всегда — готовить его не нужно',
};

/** Значки заклинания рядом с названием — буквой, ряд от них не растёт */
export const SPELL_BADGE_LABELS: Record<'concentration' | 'ritual', string> = {
  concentration: 'К',
  ritual: 'Р',
};

/** Расшифровки буквенных значков заклинания */
export const SPELL_BADGE_HINTS: Record<'concentration' | 'ritual', string> = {
  concentration: 'Концентрация',
  ritual: 'Ритуал',
};

/** Подписи пунктов меню строки заклинания, кроме общих со снаряжением */
export const SPELL_MENU_LABELS: Record<'prepared' | 'cast', string> = {
  /** Отметка, а не действие: снята — заклинание на день не подготовлено */
  prepared: 'Подготовлено',
  /**
   * Применение заклинания. Слово то же, что у `MODAL_BUTTON_LABELS.apply`, но
   * действие другое — там подтверждают настройку, здесь тратят ячейку. Поэтому
   * подпись своя: переименование одной не должно задевать другую.
   */
  cast: 'Применить',
};
