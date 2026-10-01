/**
 * Константы своих компендиумов мира D&D 5e: какие разделы бывают и как каждый
 * показывает свой список.
 */

import type { CompendiumFilterField } from '@/core/registries';
import type { CompendiumView } from '@vtt/shared';

import {
  COMPENDIUM_CLASS_KIND,
  COMPENDIUM_CREATURE_KIND,
  COMPENDIUM_PLAIN_ITEM_KINDS,
  COMPENDIUM_SPECIES_KIND,
  COMPENDIUM_SPELL_KIND,
} from '@vtt/shared/system/dnd.js';

/**
 * Типы разделов, хранящих записи «Мастерской», в порядке выбора: заклинания,
 * затем предметы, затем определения персонажа.
 */
export const COMPENDIUM_ITEM_SECTION_KINDS: readonly string[] = [
  COMPENDIUM_SPELL_KIND,
  ...COMPENDIUM_PLAIN_ITEM_KINDS,
  COMPENDIUM_CLASS_KIND,
  COMPENDIUM_SPECIES_KIND,
];

/** Раздел существ: название и значок как у панели «Существа». */
export const COMPENDIUM_CREATURE_SECTION = {
  label: 'Существа',
  icon: 'tabler:alien',
} as const;

/** Значок раздела, если у его типа записей своего значка нет. */
export const COMPENDIUM_SECTION_FALLBACK_ICON = 'tabler:file';

/**
 * Вид списка, с которым раздел создаётся. Повторяет вид одноимённых разделов
 * официального компендиума TTG Club, чтобы свой раздел заклинаний или существ
 * выглядел привычно. Тип без записи здесь показывается простым списком.
 */
export const COMPENDIUM_SECTION_VIEWS: Readonly<
  Record<string, CompendiumView | undefined>
> = {
  [COMPENDIUM_SPELL_KIND]: {
    layout: 'filtered',
    groupBy: { path: 'level', format: 'spellLevel' },
    filters: [
      {
        id: 'level',
        label: 'Круг',
        type: 'enum',
        path: 'level',
        format: 'spellLevel',
        style: 'badges',
      },
      {
        id: 'props',
        label: 'Свойства',
        type: 'toggles',
        toggles: [
          {
            label: 'Лечение',
            predicate: 'spellHealing',
            icon: 'tabler:heart-filled',
            color: 'success',
          },
          {
            label: 'Концентрация',
            path: 'concentration',
            icon: 'tabler:eye',
            color: 'warning',
          },
        ],
      },
      {
        id: 'class',
        label: 'Класс',
        type: 'enum',
        path: 'classKeys',
        format: 'spellClass',
        style: 'list',
      },
    ],
  },
  [COMPENDIUM_CREATURE_KIND]: {
    layout: 'filtered',
    groupBy: { path: 'system.challengeRating', format: 'challengeRating' },
    filters: [
      {
        id: 'cr',
        label: 'Показатель опасности',
        type: 'enum',
        path: 'system.challengeRating',
        format: 'challengeRating',
        style: 'badges',
      },
      {
        id: 'type',
        label: 'Тип',
        type: 'enum',
        path: 'system.type',
        format: 'creatureType',
        style: 'list',
      },
    ],
  },
  feat: {
    layout: 'filtered',
    groupBy: { path: 'category', format: 'string' },
    filters: [
      {
        id: 'category',
        label: 'Категория',
        type: 'enum',
        path: 'category',
        format: 'string',
        style: 'list',
      },
    ],
  },
};

/** Параметр «Редкость» — общий для оружия, снаряжения и инструментов. */
const RARITY_FILTER_FIELD: CompendiumFilterField = {
  label: 'Редкость',
  type: 'enum',
  path: 'rarity',
  format: 'itemRarity',
  style: 'list',
  groupable: true,
};

/** Параметр «Магический» — общий для оружия и снаряжения. */
const MAGICAL_FILTER_FIELD: CompendiumFilterField = {
  label: 'Магический',
  type: 'toggle',
  path: 'isMagical',
  icon: 'tabler:sparkles',
  color: 'primary',
};

/**
 * Параметры записи, которые мастер может вынести в фильтры раздела. Только те,
 * чьи значения система умеет подписать по-русски: фильтр по сырому ключу
 * (`evocation`, `very-rare`) мастеру ничего не скажет.
 *
 * Идентификаторы `level` и `class` у заклинаний — те, которыми окно выбора
 * заклинаний само выставляет фильтры по кругу и классу.
 */
export const COMPENDIUM_SECTION_FILTER_FIELDS: Readonly<
  Record<string, readonly CompendiumFilterField[] | undefined>
> = {
  [COMPENDIUM_SPELL_KIND]: [
    {
      id: 'level',
      label: 'Круг',
      type: 'enum',
      path: 'level',
      format: 'spellLevel',
      style: 'badges',
      groupable: true,
    },
    {
      label: 'Школа магии',
      type: 'enum',
      path: 'school',
      format: 'spellSchool',
      style: 'list',
      groupable: true,
    },
    {
      id: 'class',
      label: 'Класс',
      type: 'enum',
      path: 'classKeys',
      format: 'spellClass',
      style: 'list',
    },
    {
      label: 'Лечение',
      type: 'toggle',
      predicate: 'spellHealing',
      icon: 'tabler:heart-filled',
      color: 'success',
    },
    {
      label: 'Концентрация',
      type: 'toggle',
      path: 'concentration',
      icon: 'tabler:eye',
      color: 'warning',
    },
    {
      label: 'Ритуал',
      type: 'toggle',
      path: 'ritual',
      icon: 'tabler:book',
      color: 'info',
    },
  ],
  [COMPENDIUM_CREATURE_KIND]: [
    {
      id: 'cr',
      label: 'Показатель опасности',
      type: 'enum',
      path: 'system.challengeRating',
      format: 'challengeRating',
      style: 'badges',
      groupable: true,
    },
    {
      id: 'type',
      label: 'Тип',
      type: 'enum',
      path: 'system.type',
      format: 'creatureType',
      style: 'list',
      groupable: true,
    },
    {
      label: 'Размер',
      type: 'enum',
      path: 'system.size',
      format: 'creatureSize',
      style: 'list',
      groupable: true,
    },
  ],
  feat: [
    {
      id: 'category',
      label: 'Категория',
      type: 'enum',
      path: 'category',
      format: 'string',
      style: 'list',
      groupable: true,
    },
  ],
  weapon: [RARITY_FILTER_FIELD, MAGICAL_FILTER_FIELD],
  equipment: [RARITY_FILTER_FIELD, MAGICAL_FILTER_FIELD],
  tool: [RARITY_FILTER_FIELD],
};

/**
 * Оформление круглой кнопки в шапке окна раздела — то же, что у кнопок шапки
 * листа персонажа и существа (`ActorHeader`, `CreatureHeader`).
 */
export const COMPENDIUM_HEADER_BUTTON_CLASS =
  'flex h-8 w-8 items-center justify-center rounded-full border border-default/50 bg-elevated/30 text-muted transition-colors hover:bg-accented/50 hover:text-highlighted';

/** Подписи правки записей своего компендиума в окне раздела. */
export const COMPENDIUM_AUTHORING_LABELS = {
  create: 'Создать',
  createTooltip: 'Создать запись в этом разделе',
  configureView: 'Настроить вид раздела',
  failedTitle: 'Не удалось сохранить',
  wrongKind: 'Запись другого типа — в этот раздел её сохранить нельзя.',
  unreadable: 'Запись не удалось открыть для правки: у неё незнакомая форма.',
  deleteTitle: 'Удалить запись?',
  deleteText: 'Запись будет удалена из компендиума. Отменить это нельзя.',
  deleteCancel: 'Отмена',
  deleteConfirm: 'Удалить',
} as const;
