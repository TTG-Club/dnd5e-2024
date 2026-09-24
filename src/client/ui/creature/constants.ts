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
  CreatureRecharge,
  CreatureSpellGroup,
  CreatureSpellRestKind,
  CreatureSpellUsageMode,
  SpellUsesRecovery,
} from '@vtt/shared/system/dnd.js';

import {
  isCreatureSpellPoolMode,
  isCreatureSpellRestMode,
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
 * Короткая подпись условия перезарядки — она стоит на значке в строке записи
 * и должна помещаться рядом с названием. Расшифровку несёт подсказка.
 */
export const CREATURE_RECHARGE_LABELS: Record<CreatureRecharge, string> = {
  d3: '3–6',
  d4: '4–6',
  d5: '5–6',
  d6: '6',
  slr: 'Отдых',
  lr: 'Долгий отдых',
};

/**
 * Условия перезарядки для списка в форме записи — готовыми парами, чтобы
 * обойтись без приведения ключа объекта к типу. Формулировки те же, что в
 * форме существа на сайте: список приезжает оттуда, и расхождение читалось бы
 * как другой набор значений.
 */
export const CREATURE_RECHARGE_OPTIONS: {
  label: string;
  value: CreatureRecharge;
}[] = [
  { label: '3–6', value: 'd3' },
  { label: '4–6', value: 'd4' },
  { label: '5–6', value: 'd5' },
  { label: '6', value: 'd6' },
  { label: 'после короткого или продолжительного отдыха', value: 'slr' },
  { label: 'после продолжительного отдыха', value: 'lr' },
];

/**
 * Полная расшифровка условия: подсказка значка и строка карточки записи.
 * Короткое «5–6» само по себе ничего не говорит тому, кто впервые видит
 * статблок.
 */
export const CREATURE_RECHARGE_HINTS: Record<CreatureRecharge, string> = {
  d3: 'Перезарядка 3–6: в начале хода бросьте к6',
  d4: 'Перезарядка 4–6: в начале хода бросьте к6',
  d5: 'Перезарядка 5–6: в начале хода бросьте к6',
  d6: 'Перезарядка 6: в начале хода бросьте к6',
  slr: 'Восстанавливается после короткого или продолжительного отдыха',
  lr: 'Восстанавливается после продолжительного отдыха',
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

/**
 * Подписи чисел заклинательства. Числа эти теперь у блока, а не у существа
 * целиком, и плитка с ними стоит в шапке блока.
 */
export const CREATURE_SPELLCASTING_LABELS = {
  saveDC: 'Сл. спасбр.',
  saveDCHint: 'Сложность спасброска заклинаний',
  attack: 'Атака закл.',
  attackHint: 'Бонус атаки заклинанием',
  ability: 'Хар-ка',
  abilityHint: 'Заклинательная характеристика',
  none: '—',
} as const;

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

/**
 * Подписи ограничений применений группы — в порядке показа в списке.
 *
 * Формулировки те же, что в форме бестиария на сайте: группы приезжают оттуда,
 * и другой набор подписей читался бы как другой набор режимов.
 */
export const CREATURE_SPELL_USAGE_MODE_OPTIONS: {
  label: string;
  value: CreatureSpellUsageMode;
}[] = [
  { label: 'По желанию', value: 'atWill' },
  { label: 'N в день, каждое', value: 'perDayEach' },
  { label: 'N в день, на весь список', value: 'perDayPool' },
  { label: 'N за отдых, каждое', value: 'perRestEach' },
  { label: 'N за отдых, на весь список', value: 'perRestPool' },
  { label: 'Перезарядка', value: 'recharge' },
  { label: 'Постоянно активно', value: 'constant' },
];

/** Виды отдыха, возвращающего применения группы */
export const CREATURE_SPELL_REST_OPTIONS: {
  label: string;
  value: CreatureSpellRestKind;
}[] = [
  { label: 'Короткий отдых', value: 'shortRest' },
  { label: 'Продолжительный отдых', value: 'longRest' },
];

/** Части выведенной подписи группы — так же, как заголовки в книгах */
const CREATURE_SPELL_GROUP_LABEL_PARTS = {
  atWill: 'По желанию',
  constant: 'Постоянно активно',
  recharge: 'Перезарядка',
  perDay: 'в день',
  perShortRest: 'за короткий отдых',
  perLongRest: 'за продолжительный отдых',
  each: 'каждое',
  pool: 'на весь список',
  unset: 'Группа без числа применений',
} as const;

/**
 * Подпись группы: своя, если её задал автор, иначе выведенная из ограничения —
 * «2 в день, каждое». По ней группа читается, как заголовок в книге.
 *
 * @param group - группа блока
 * @returns подпись заголовка группы
 */
export function getCreatureSpellGroupLabel(group: CreatureSpellGroup): string {
  if (group.label) {
    return group.label;
  }

  if (group.mode === 'atWill') {
    return CREATURE_SPELL_GROUP_LABEL_PARTS.atWill;
  }

  if (group.mode === 'constant') {
    return CREATURE_SPELL_GROUP_LABEL_PARTS.constant;
  }

  if (group.mode === 'recharge') {
    return group.recharge
      ? `${CREATURE_SPELL_GROUP_LABEL_PARTS.recharge} ${CREATURE_RECHARGE_LABELS[group.recharge]}`
      : CREATURE_SPELL_GROUP_LABEL_PARTS.recharge;
  }

  if (group.count === undefined) {
    return CREATURE_SPELL_GROUP_LABEL_PARTS.unset;
  }

  const restPeriod =
    group.rest === 'shortRest'
      ? CREATURE_SPELL_GROUP_LABEL_PARTS.perShortRest
      : CREATURE_SPELL_GROUP_LABEL_PARTS.perLongRest;

  const period = isCreatureSpellRestMode(group.mode)
    ? restPeriod
    : CREATURE_SPELL_GROUP_LABEL_PARTS.perDay;

  const scope = isCreatureSpellPoolMode(group.mode)
    ? CREATURE_SPELL_GROUP_LABEL_PARTS.pool
    : CREATURE_SPELL_GROUP_LABEL_PARTS.each;

  return `${group.count} ${period}, ${scope}`;
}

/**
 * MIME переноса заклинания существа между группами.
 *
 * Свой, а не общий `SPELL_MIME`: тот несёт запись заклинания и годится для
 * копирования с чужого листа, а здесь надо знать, что заклинание уже у этого
 * существа и из какой группы его тащат, — иначе перенос обернулся бы вторым
 * таким же заклинанием.
 */
export const CREATURE_SPELL_REF_MIME = 'application/creature-spell-ref';

/** Что несёт перенос заклинания между группами */
export interface CreatureSpellRefDragPayload {
  creatureId: string;
  spellId: string;
  /** Группа, из которой тащат */
  groupId: string;
}

/** Подписи вкладки заклинаний: блоки и их группы */
export const CREATURE_SPELL_BLOCKS_LABELS = {
  // Подписи кнопок — одним словом: обе стоят в ряду со значком «плюс», и что
  // они делают, видно по нему. Полная фраза осталась в подсказке
  addBlock: 'Блок',
  addBlockAria: 'Добавить блок',
  addBlockHint:
    'Блок — набор заклинаний с общими характеристикой, Сл и бонусом атаки',
  editBlock: 'Настроить блок',
  removeBlock: 'Удалить блок',
  removeBlockConfirm:
    'Блок удалится вместе с группами и их заклинаниями: вне блока заклинание '
    + 'существа не живёт. Пока лист не сохранён, изменение можно отменить, '
    + 'закрыв его.',
  unnamedBlock: 'Новый блок',
  groupsBadgeHint: 'Групп в блоке',
  spellsBadgeHint: 'Заклинаний в блоке',
  blockEmpty: 'В блоке пока нет групп',
  addGroup: 'Группа',
  addGroupAria: 'Добавить группу',
  addGroupHint:
    'Группа — список заклинаний под одним ограничением применений: «По '
    + 'желанию», «1 в день, каждое»',
  editGroup: 'Настроить группу',
  removeGroup: 'Удалить группу',
  removeGroupConfirm:
    'Группа удалится вместе со своими заклинаниями: вне группы заклинание '
    + 'существа не живёт. Пока лист не сохранён, изменение можно отменить, '
    + 'закрыв его.',
  groupEmpty: 'В группе пока нет заклинаний',
  addSpells: 'Добавить заклинания',
  pickSpellsTitle: 'Заклинания группы',
  spellsAdded: 'Заклинания добавлены',
  spellsAddFailed: 'Не удалось загрузить заклинания компендиума',
  poolUses: 'Применения группы',
  poolEmpty:
    'Применения группы кончились — их вернёт отдых, указанный в её настройке',
  componentsIgnored: 'Компоненты не требуются: ',
  componentVerbal: 'вербальный',
  componentSomatic: 'соматический',
  componentMaterial: 'материальный',
  refine: 'Круг и оговорка',
  castLevelStat: 'Круг',
  castLevelHint: 'Круг, которым существо накладывает это заклинание',
} as const;

/** Подписи окна настройки блока заклинаний */
export const CREATURE_SPELL_BLOCK_FORM_LABELS = {
  title: 'Блок заклинаний',
  hint:
    'Числа блока главнее чисел существа: «Магия шабаша» карги считается от '
    + 'Интеллекта со Сл 11, когда само существо колдует от Мудрости. Пустое '
    + 'поле — берётся число существа.',
  name: 'Название блока',
  namePlaceholder: 'Например: Использование заклинаний',
  ability: 'Заклинательная характеристика',
  abilityInherit: 'Как у существа',
  saveDC: 'Сл спасброска',
  saveDCHint: 'Плоское число из статблока; пусто — считается по характеристике',
  attackBonus: 'Бонус атаки',
  attackBonusHint: 'Тоже плоское число — как бонус атаки у действий',
  components: 'Компоненты не требуются',
  componentsHint:
    'Отметь те, без которых существо накладывает заклинания блока: «без '
    + 'материальных компонентов».',
  componentVerbal: 'Вербальные',
  componentSomatic: 'Соматические',
  componentMaterial: 'Материальные',
  note: 'Условие блока',
  notePlaceholder: 'Например: в пределах 30 футов от двух союзных карг',
  noteHint:
    'Оговорка, при которой блок работает. Числами её не выразить, а терять '
    + 'нельзя.',
  preview: 'Числа блока',
} as const;

/** Подписи окна настройки группы */
export const CREATURE_SPELL_GROUP_FORM_LABELS = {
  title: 'Группа заклинаний',
  hint:
    'Ограничение задаёт и заряды заклинаний группы, и то, чем они '
    + 'возвращаются. Поля, к ограничению не относящиеся, прячутся.',
  mode: 'Ограничение применений',
  count: 'Применений',
  countEachHint: 'Столько применений у КАЖДОГО заклинания группы',
  countPoolHint: 'Столько применений на ВСЮ группу, вместе взятую',
  rest: 'Возвращает применения',
  recharge: 'Перезарядка',
  rechargeHint:
    'Подсказка статблока: движок применения перезарядки не списывает — так же, '
    + 'как у действий существа.',
  label: 'Своя подпись',
  labelPlaceholder: 'Например: 1/день каждое',
  labelHint: 'Пусто — подпись собирается из ограничения',
} as const;

/** Подписи окна круга и оговорки заклинания группы */
export const CREATURE_SPELL_REF_FORM_LABELS = {
  title: 'Круг и оговорка',
  hint:
    'Круг наложения фиксирует окно броска: «Воображаемый убийца (версия 6 '
    + 'уровня)» полетит шестым кругом. Пусто — заклинание идёт своим кругом.',
  castLevel: 'Круг наложения',
  castLevelOwn: 'Свой круг заклинания',
  note: 'Оговорка',
  notePlaceholder: 'Например: только на себя',
  noteHint: 'Оговорка статблока строкой — она стоит под названием заклинания',
} as const;

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
  rechargePrefix: 'Перезарядка:',
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

/**
 * Подписи окна здоровья существа. Кость и бонус в нём не правятся: по правилам
 * 2024 кость задаёт размер, а бонус — Телосложение, и окно объясняет, откуда
 * взялись числа, вместо того чтобы давать их переписать.
 */
export const CREATURE_HIT_POINTS_LABELS = {
  /** Начало пояснения; дальше в скобках — размер и его кость */
  dieBySize: 'Кость хитов задаёт размер существа',
  /** Середина пояснения; дальше в скобках — модификатор */
  bonusByConstitution: 'бонус — модификатор Телосложения',
  /** Середина пояснения: после Телосложения */
  perDie: 'за каждую кость',
  /** Конец пояснения */
  plusCustomBonuses: 'плюс свои бонусы — один раз на формулу',
  /** Середина пояснения вместо Телосложения, когда основа задана числом */
  bonusCustom: 'бонус задан своим числом',
  /** Подсказка кнопки возврата основы бонуса к правилам */
  resetBaseBonus: 'Вернуть бонус по Телосложению',
  /** Заголовок строк своих бонусов формулы */
  customBonusesTitle: 'Свои бонусы к формуле',
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
  /**
   * Блок свободной строки снаряжения на вкладке инвентаря. Назван не
   * «Снаряжение»: сами предметы уже лежат ниже, в списке экипировки, а здесь
   * приписка мастерской — количества словами и то, чему карточки не нашлось.
   */
  gearNote: 'Дополнительная информация',
  /** Подсказка пустого поля приписки в режиме правки */
  gearNotePlaceholder: 'Дополнительно о снаряжении...',
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
  recharge: 'Перезарядка',
  /** Выбор «перезарядки нет»: запись доступна без ограничений */
  rechargeNone: 'Без перезарядки',
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
