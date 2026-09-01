/**
 * Подписи листа существа.
 *
 * Оформление у листов персонажа и существа общее: строки списков, плитки шапки
 * и ряд отбора собираются из одних и тех же кирпичей (`SheetRowStats`,
 * `SheetStatTile`, `FilterChip`). Здесь лежат только те подписи, которых на
 * листе персонажа нет, — общие берутся из `../actor/constants`.
 */

import type {
  CreatureAction,
  SpellUsesRecovery,
} from '@vtt/shared/system/dnd.js';

/**
 * Подпись основы бонуса мастерства существа: у него нет уровней, и по правилам
 * бонус берётся из показателя опасности. Сам показатель дописывается на месте.
 */
export const CREATURE_PROFICIENCY_RULE_TITLE = 'По опасности';

/** Подсказка плитки скорости, когда существо не двигается вовсе */
export const CREATURE_MOVEMENT_EMPTY = 'Существо не двигается';

/** Раздел вкладки «Действия»: свой список внутри одной сущности */
export type CreatureActionSectionKey =
  'actions' | 'bonusActions' | 'reactions' | 'legendary';

/** Раздел вкладки «Действия»: заголовок списка и подпись чипа отбора */
export interface CreatureActionSection {
  /** Ключ раздела */
  key: CreatureActionSectionKey;
  /** Заголовок раздела над списком */
  title: string;
  /** Короткая подпись чипа: ряд чипов должен помещаться на узком листе */
  chipLabel: string;
  /** Подсказка чипа — она же полное название отбора */
  chipHint: string;
}

/**
 * Разделы вкладки «Действия» в порядке показа. Порядок постоянный, чтобы чипы
 * не прыгали при пополнении существа.
 */
export const CREATURE_ACTION_SECTIONS: CreatureActionSection[] = [
  {
    key: 'actions',
    title: 'Действия',
    chipLabel: 'Действия',
    chipHint: 'Оставить на вкладке только обычные действия',
  },
  {
    key: 'bonusActions',
    title: 'Бонусные действия',
    chipLabel: 'Бонусные',
    chipHint: 'Оставить на вкладке только бонусные действия',
  },
  {
    key: 'reactions',
    title: 'Реакции',
    chipLabel: 'Реакции',
    chipHint: 'Оставить на вкладке только реакции',
  },
  {
    key: 'legendary',
    title: 'Легендарные действия',
    chipLabel: 'Легендарные',
    chipHint: 'Оставить на вкладке только легендарные действия',
  },
];

/** Подпись вида дальности — первая часть подписи под названием действия */
export const CREATURE_RANGE_TYPE_LABELS: Record<
  NonNullable<CreatureAction['rangeType']>,
  string
> = {
  melee: 'Ближний бой',
  ranged: 'Дальний бой',
};

/**
 * Значки записей существа. Значок говорит, чем запись занята в бою: атака,
 * спасбросок цели, область или пассивная особенность.
 */
export const CREATURE_ROW_ICONS: Record<
  'trait' | 'attack' | 'save' | 'area' | 'plain' | 'spell',
  string
> = {
  trait: 'tabler:star',
  attack: 'tabler:sword',
  save: 'tabler:shield-half',
  area: 'tabler:flame',
  plain: 'tabler:bolt',
  spell: 'tabler:wand',
};

/** Короткие подписи плиток параметров в строке действия */
export const CREATURE_ROW_STAT_LABELS: Record<
  'attack' | 'save' | 'damage',
  string
> = {
  attack: 'Атака',
  save: 'Спас',
  damage: 'Урон',
};

/** Подсказки плиток, у которых своей расшифровки нет */
export const CREATURE_ROW_STAT_HINTS: Record<'attack' | 'save', string> = {
  attack: 'Бонус броска атаки этим действием',
  save: 'Спасбросок цели и его сложность',
};

/** Подписи для скринридера в строках списков листа существа */
export const CREATURE_ROW_ARIA_LABELS: Record<
  'openAction' | 'openSpell' | 'use' | 'actionMenu' | 'spellMenu',
  string
> = {
  openAction: 'Открыть запись',
  openSpell: 'Открыть заклинание',
  use: 'Использовать',
  actionMenu: 'Действия с записью',
  spellMenu: 'Действия с заклинанием',
};

/**
 * Подписи пунктов меню строки действия, кроме общих с листом персонажа.
 *
 * Кнопки пополнения списка здесь нет: её подпись общая для всех окон и лежит в
 * `MODAL_BUTTON_LABELS.add`.
 */
export const CREATURE_ACTION_MENU_LABELS: Record<
  'attack' | 'use' | 'effects',
  string
> = {
  attack: 'Атаковать',
  use: 'Использовать',
  effects: 'Запись накладывает активные эффекты',
};

/** Подписи пустых разделов вкладок существа */
export const CREATURE_EMPTY_LABELS: Record<
  'actions' | 'traits' | 'spells',
  string
> = {
  actions: 'Действий нет',
  traits: 'Особенностей нет',
  spells:
    'Заклинаний нет. Перетащите заклинание из компендиума или раздела предметов.',
};

/** Подписи плитки и окна заклинательства существа */
export const CREATURE_SPELLCASTING_LABELS = {
  open: 'Настроить заклинательство',
  title: 'Заклинательство существа',
  hint:
    'По правилам сложность спасброска и бонус атаки выводятся из '
    + 'заклинательной характеристики и бонуса мастерства. В стат-блоке эти '
    + 'числа часто стоят готовыми — тогда их задают своим числом.',
  saveDC: 'Сл. спасбр.',
  saveDCHint: 'Сложность спасброска заклинаний',
  attack: 'Атака закл.',
  attackHint: 'Бонус атаки заклинанием',
  ability: 'Хар-ка',
  abilityHint: 'Заклинательная характеристика',
  abilityNone: 'Не выбрана',
  abilityMissing:
    'Без заклинательной характеристики расчёт по правилам не выходит: задайте '
    + 'её либо поставьте свои числа.',
  abilityMod: 'Модификатор характеристики',
  proficiency: 'Бонус мастерства',
  bonusLabel: 'Поправка',
  valueLabel: 'Значение',
  formula:
    'Сложность спасброска = 8 + бонус мастерства + модификатор характеристики. '
    + 'Бонус атаки — то же без базового числа.',
  none: '—',
} as const;

/** Способ, которым существо получает число заклинательства */
export type CreatureSpellcastingMode = 'auto' | 'autoPlus' | 'manual';

/** Подписи способов расчёта — они одни у сложности спасброска и у атаки */
export const CREATURE_SPELLCASTING_MODE_OPTIONS: Array<{
  value: CreatureSpellcastingMode;
  label: string;
}> = [
  { value: 'auto', label: 'По характеристике' },
  { value: 'autoPlus', label: 'По характеристике + поправка' },
  { value: 'manual', label: 'Своё число' },
];

/**
 * Чипы отбора по способу отката на вкладке заклинаний. Подписи здесь свои,
 * короткие: полные («Продолжительный отдых») в ряд не помещаются, а движок
 * отдаёт только их — они уходят в подсказку и в заголовок раздела.
 */
export const CREATURE_SPELL_RECOVERY_CHIPS: Array<{
  key: SpellUsesRecovery;
  label: string;
  hint: string;
}> = [
  {
    key: 'atWill',
    label: 'По желанию',
    hint: 'Оставить в списке только заклинания без зарядов',
  },
  {
    key: 'shortRest',
    label: 'Кор. отдых',
    hint: 'Оставить в списке только заклинания, заряды которых вернёт короткий отдых',
  },
  {
    key: 'longRest',
    label: 'Прод. отдых',
    hint: 'Оставить в списке только заклинания, заряды которых вернёт продолжительный отдых',
  },
];

/** Подписи окна невосприимчивости к состояниям */
export const CREATURE_CONDITION_IMMUNITIES_LABELS = {
  title: 'Невосприимчивость к состояниям',
  conditions: 'Состояния',
  customPlaceholder: 'от заклинаний школы Иллюзии...',
} as const;

/** Подписи окна среды обитания */
export const CREATURE_ENVIRONMENTS_LABELS = {
  title: 'Среда обитания',
  category: 'Категория',
  customTitle: 'Особая',
  customPlaceholder: 'например: Астральный план...',
} as const;

/** Подписи блока действий листа существа */
export const CREATURE_ACTIONS_BLOCK_LABELS = {
  /** Заголовок броска атаки — дальше идёт название записи */
  attackRollPrefix: 'Атака — ',
  /** Сообщение о недосягаемой цели: значок, название и разбор расстояния */
  outOfRangePrefix: '⛔ ',
  outOfRangeMiddle: ': цель вне досягаемости (',
  outOfRangeSuffix: ')',
  /** Приписка досягаемости в подписи под названием */
  reachPrefix: ', досягаемость ',
  /** Хвост счётчика легендарных действий — перед ним идёт их число за раунд */
  legendaryPerRoundSuffix: '/раунд',
} as const;

/** Подписи шапки листа существа */
export const CREATURE_HEADER_LABELS = {
  namePlaceholder: 'Имя существа',
  size: 'Размер',
  type: 'Вид',
  alignment: 'Мировоззрение',
  challengeRating: 'Уровень (ПО)',
  create: 'Создать существо',
  backToList: 'Вернуть в список существ',
  tokenSettings: 'Настройки токена',
  /** Подсказка строки «Средний — Исчадие — Законное злое» в режиме правки */
  editKind: 'Изменить размер, вид и мировоззрение',
  /** Подсказка уровня опасности в режиме правки */
  editChallengeRating: 'Изменить уровень опасности',
} as const;

/** Подписи окна размера, вида и мировоззрения существа */
export const CREATURE_KIND_LABELS = {
  title: 'Размер, вид и мировоззрение',
} as const;

/** Подписи окна уровня опасности существа */
export const CREATURE_CHALLENGE_LABELS = {
  title: 'Уровень опасности',
  /**
   * Пояснение к выбору: опыт виден прямо в списке, а бонус мастерства лист
   * пересчитывает сам — без этой строки его смена выглядела бы самовольной.
   */
  hint:
    'Уровень опасности задаёт опыт за победу над существом и его бонус '
    + 'мастерства.',
} as const;

/** Подписи карточки записи существа — окна просмотра действия или особенности */
export const CREATURE_ACTION_DETAIL_LABELS = {
  /** Заголовок окна, когда записи в окне ещё нет */
  fallbackTitle: 'Действие',
  areaPrefix: 'Область:',
  rangePrefix: 'Дальность:',
  reachPrefix: 'Досягаемость:',
} as const;

/** Подписи боевого блока листа существа */
export const CREATURE_COMBAT_LABELS = {
  /** Подсказка шестерёнки блока здоровья: костей хитов у существа нет */
  hitPointsOpen: 'Настроить здоровье',
  hoverBadge: '(зависание)',
  generateHitPoints: 'Сгенерировать здоровье по формуле',
  formulaPrefix: 'Формула:',
  /** Приставка среднего по формуле — дальше идёт само число */
  averagePrefix: 'Среднее:',
} as const;

/** Подписи окна защит существа */
export const CREATURE_DEFENSES_LABELS = {
  bypassAdamantine: 'Адамантиновое',
  bypassMagical: 'Магическое',
  bypassSilvered: 'Посеребрённое',
  /** Заголовки окна по виду защиты, который в нём правят */
  titleVulnerabilities: 'Уязвимости',
  titleResistances: 'Сопротивления',
  titleImmunities: 'Иммунитеты',
  /** Заголовок, когда вид защиты в окно не передан */
  titleFallback: 'Защиты',
  damageTypes: 'Типы урона',
  bypassTitle: 'Физическое пробивание',
  bypassHint:
    'Предметы с этим свойством игнорируют устойчивость к физическому урону.',
  customTitle: 'Особое',
  customPlaceholder: 'от немагического оружия...',
  customHint: 'Значения разделяются точкой с запятой.',
} as const;

/** Подписи блока навыков существа */
export const CREATURE_SKILLS_LABELS = {
  open: 'Настроить навыки',
} as const;

/**
 * Подписи блока характеристик существа. Заголовок окна броска общий с листом
 * персонажа и берётся из `ABILITY_CHECK_ROLL_LABELS`; своя здесь только надпись
 * на кнопке — у существа она короче, чем у персонажа.
 */
export const CREATURE_ABILITIES_LABELS = {
  rollButton: 'Бросок',
} as const;

/** Подписи строки существа в списке компендиума */
export const CREATURE_LIST_ITEM_LABELS = {
  /** Значок показателя опасности — дальше идёт само значение */
  challengeRatingPrefix: 'ПО ',
  /** Куда меню строки копирует запись */
  copyTarget: 'существа',
} as const;

/**
 * Подписи листа существа. Общие с листом персонажа (вкладка эффектов, описание,
 * виды отдыха) берутся из `../actor/constants`.
 */
export const CREATURE_SHEET_LABELS = {
  /** Подпись шторки, пока у создаваемого существа ещё нет имени */
  untitled: 'Новое существо',
  /**
   * Вкладка действий. Тем же словом подписан первый раздел внутри неё
   * (`CREATURE_ACTION_SECTIONS`), но это разные места: вкладка одна, а разделов
   * в ней четыре.
   */
  tabActions: 'Действия',
  /**
   * Вкладка инвентаря. Названа «Инвентарь», а не «Снаряжение», намеренно: у
   * существа это мешок с вещами, а статблок остаётся источником истины боя —
   * надетое не порождает действие и не трогает КД без выбора мастера.
   */
  tabEquipment: 'Инвентарь',
  /** Пустое значение блока защит и списков — прочерком его не пишут */
  empty: 'Нет',
  vulnerabilities: 'Уязвимости',
  resistances: 'Сопротивления',
  immunities: 'Иммунитеты',
  /** Подсказки шестерёнок блоков левой колонки: куда ведёт каждая */
  vulnerabilitiesOpen: 'Настроить уязвимости',
  resistancesOpen: 'Настроить сопротивления',
  immunitiesOpen: 'Настроить иммунитеты',
  conditionImmunitiesOpen: 'Настроить иммунитет к состояниям',
  environmentsOpen: 'Настроить среду обитания',
  bypassAdamantine: 'Пробивание: Адамантиновое',
  bypassMagical: 'Пробивание: Магическое',
  bypassSilvered: 'Пробивание: Посеребрённое',
  perception: 'Восприятие',
  visionPrefix: 'Зрение:',
  darkvisionPrefix: 'Тёмное зрение:',
  passivePerceptionPrefix: 'Пассивное Внимание:',
  environments: 'Среда обитания',
  environmentSpecialPrefix: 'Особая:',
  descriptionPlaceholder: 'Описание существа...',
  descriptionEmpty: 'Нет описания',
  discardQuestion: 'У вас есть несохранённые изменения. Что сделать?',
  /** Заголовок сообщения о неверно заполненной форме */
  validationErrorTitle: 'Ошибка валидации',
  validationNameRequired: 'Имя существа обязательно',
  savedTitle: 'Успешно',
  savedUpdated: 'Существо обновлено',
  savedCreated: 'Существо создано',
  saveErrorTitle: 'Ошибка сохранения',
  saveErrorText: 'Не удалось сохранить существо',
  longRestDone: 'Заряды заклинаний и хиты восстановлены.',
  shortRestDone: 'Заряды коротких заклинаний восстановлены.',
  spellAdded: 'Заклинание добавлено',
  spellDropFailed: 'Не удалось разобрать заклинание при перетаскивании',
  /** Итог перетаскивания предмета из панели «Предметы» или компендиума */
  itemAdded: 'Предмет добавлен в инвентарь',
  /** Итог передачи предмета с другого листа */
  itemReceived: 'Предмет передан',
  itemDropFailed: 'Не удалось разобрать предмет при перетаскивании',
} as const;

/** Приставка сообщений листа существа в консоли — она одна на весь файл */
export const CREATURE_SHEET_LOG_PREFIX =
  '[CreatureSheet] Не удалось привести существо к форме D&D:';

/**
 * Подписи окна правки записи существа — действия или особенности. Общие с
 * окнами листа персонажа (название, описание, спасбросок, область, дальность)
 * берутся из `../actor/constants`.
 */
export const CREATURE_ACTION_FORM_LABELS = {
  /** Заголовок окна правки: дальше дописывается название записи */
  editTitlePrefix: 'Редактирование: ',
  /** Заголовок окна создания новой особенности */
  createTraitTitle: 'Новая черта',
  /** Заголовок окна создания нового действия */
  createActionTitle: 'Новое действие',
  tabCombat: 'Боевые параметры',
  namePlaceholder: 'Название действия или черты',
  descriptionPlaceholder: 'Описание...',
  rangeTypeMelee: 'Ближний бой',
  rangeTypeRanged: 'Дальний бой',
  attackBonus: '+ к попаданию',
  damageTitle: 'Урон / лечение',
  damageHint:
    'Указывайте плоские формулы (модификатор уже вшит, напр. «1к8 + 3»). Тип '
    + 'урона, лечение и условия — токенами в формуле.',
  saveTypeShort: 'Тип',
  areaTitle: 'Область действия (шаблон)',
  effectsTitle: 'Активные эффекты',
  effectsEmpty:
    'Нет активных эффектов. Эффекты применяются при активации черты или '
    + 'попадании атакой.',
  /** Окончание множественного числа в строке «N модификатор(а/ов)» */
  countSuffix: 'а/ов',
  /** Слова счётчиков состава эффекта — окончание к ним даёт `countSuffix` */
  changesWord: 'модификатор',
  flagsWord: 'флаг',
  effectEnable: 'Включить',
  effectDisable: 'Выключить',
  effectEdit: 'Редактировать эффект',
  effectRemove: 'Удалить эффект',
} as const;

/**
 * Подпись существа без мировоззрения. Общая: её показывают и шапка листа, и
 * окно настроек — вразнобой они читались бы как разные состояния.
 */
export const CREATURE_NO_ALIGNMENT = 'Без мировоззрения';

/**
 * Подписи окна настроек, свои у листа существа. Всё остальное окно общее с
 * листом персонажа и берётся из `TOKEN_SETTINGS_LABELS`.
 */
export const CREATURE_SETTINGS_LABELS = {
  title: 'Настройки существа',
  visibleToAllHint:
    'Игроки смогут видеть это существо, но не смогут управлять им '
    + '(управление — только у владельца и ГМа).',
  /** Что показать игроку: владельца он не менял, менялся только токен */
  savedForPlayer: 'Токен и настройки существа обновлены',
} as const;
