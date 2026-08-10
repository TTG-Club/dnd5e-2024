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

/** Подписи пунктов меню строки действия, кроме общих с листом персонажа */
export const CREATURE_ACTION_MENU_LABELS: Record<
  'attack' | 'use' | 'add' | 'effects',
  string
> = {
  attack: 'Атаковать',
  use: 'Использовать',
  add: 'Добавить',
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

/** Подписи блока навыков существа */
export const CREATURE_SKILLS_LABELS = {
  open: 'Настроить навыки',
} as const;
