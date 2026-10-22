/**
 * Подписи засады и поиска: полка действий, сообщения чата и предупреждения.
 */

import type { EffectActionCost, HideCost } from '@vtt/shared/system/dnd.js';

import {
  HIDDEN_CONDITION_ICON,
  HIDE_CHECK_DC,
} from '@vtt/shared/system/dnd.js';

/** Значок засады: состояние, кнопка полки, сообщение */
export const HIDE_ICON = HIDDEN_CONDITION_ICON;

/** Значок поиска: кнопка полки */
export const SEARCH_ICON = 'tabler:eye-search';

/** Подписи засады и поиска */
export const HIDE_LABELS = {
  /** Название действия: заголовок окна проверки и предупреждений */
  title: 'Засада',
  /** Кнопка броска в окне проверки */
  rollButton: 'Спрятаться',
  /** Заголовок окна поиска */
  searchTitle: 'Поиск',
  /** Кнопка броска в окне поиска */
  searchRollButton: 'Искать',
  /** Уведомление ведущему (без чата): после имени */
  hiddenSuffix: ' в засаде',
  /**
   * Сообщение чата о засаде — дальше цена. Имени нет: чат и так показывает,
   * кто говорит
   */
  hiddenMessage: 'Входит в засаду',
  /** Вопрос о цене засады, когда её можно выбрать */
  costQuestion: 'Спрятаться действием или бонусным действием?',
  /** Дополнение под сообщением: Сл поиска — дальше число */
  searchDcPrefix: 'Сл поиска: ',
  /** Сообщение чата: сам вышел из засады (повторное нажатие «Спрятаться») */
  leftMessage: 'Выходит из засады',
  /** Сообщение чата: нашли — между именем ищущего и найденными */
  foundMiddle: ' находит: ',
  /** Разделитель найденных */
  foundSeparator: ', ',
  /** Сообщение чата: никого не нашли — после имени */
  nothingFoundSuffix: ' ищет, но никого не находит',
  /** Подсказка ведущему после находки */
  searchHint:
    'Видит ли ищущий спрятавшегося (укрытие, линия зрения), решает ведущий.',
  /** Предупреждение: не свой ход — дальше имя */
  notOwnTurnSuffix: ' действует только в свой ход',
  /** Предупреждение: состояния «В засаде» нет в мире */
  noConditionDescription: 'Состояние «В засаде» удалено из мира.',
} as const;

/** Цена засады — кнопки вопроса «действием или бонусным действием» */
export const HIDE_COST_OPTIONS: Readonly<Record<HideCost, string>> = {
  bonus: 'Бонусным действием',
  action: 'Действием',
};

/** Цена засады — продолжение сообщения «Входит в засаду» */
export const HIDE_COST_NOTES: Partial<Record<EffectActionCost, string>> = {
  action: ' действием',
  bonus: ' бонусным действием',
};

/** Кнопки полки действий системы (слева от панели быстрого доступа) */
export const ACTION_SHELF_BUTTONS = {
  attackId: 'attack',
  attack: 'Атака',
  attackIcon: 'tabler:sword',
  hideId: 'hide',
  hide: 'Спрятаться',
  hideActiveTooltip: 'Вы в засаде — нажмите, чтобы выйти',
  hideTooltip: `Засада: проверка Ловкости (Скрытность) Сл ${HIDE_CHECK_DC} — успех даёт состояние «В засаде»`,
  searchId: 'search',
  search: 'Поиск',
  searchIcon: SEARCH_ICON,
  searchTooltip:
    'Поиск: проверка Мудрости (Внимательность) — находит засады, чья Сл не выше итога',
  jumpId: 'jump',
  jump: 'Прыжок',
  jumpIcon: 'tabler:arrow-bounce',
  /** Причина недоступной кнопки */
  inDevelopment: 'В разработке',
  /** Причина недоступной кнопки, пока не выбран свой герой */
  noHero: 'Выберите своего героя на сцене',
} as const;
