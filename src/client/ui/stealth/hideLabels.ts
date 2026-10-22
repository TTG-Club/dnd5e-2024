/**
 * Подписи засады и поиска: полка действий, сообщения чата и предупреждения.
 */

import type { EffectActionCost, HideCost } from '@vtt/shared/system/dnd.js';

import {
  HIDDEN_CONDITION_ICON,
  HIDE_CHECK_DC,
  JUMP_RUN_UP_FEET,
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
  /**
   * Итог поиска: нашли — дальше найденные. Имени ищущего нет: его называет
   * шапка карточки броска
   */
  foundPrefix: 'Находит: ',
  /** Разделитель найденных */
  foundSeparator: ', ',
  /** Итог поиска: никого не нашли */
  nothingFoundMessage: 'Никого не находит',
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

/**
 * Кнопки полки действий системы (слева от панели быстрого доступа). Клавиши —
 * Q W E R по порядку кнопок, физическим кодом (`KeyboardEvent.code`): ядро
 * жмёт кнопку по клавише в любой раскладке и само показывает её в подсказке и
 * в окне «Управление».
 */
export const ACTION_SHELF_BUTTONS = {
  attackId: 'attack',
  attack: 'Атака',
  attackIcon: 'tabler:sword',
  attackHotkey: 'KeyQ',
  hideId: 'hide',
  hide: 'Спрятаться',
  hideHotkey: 'KeyE',
  hideActiveTooltip: 'Вы в засаде — нажмите, чтобы выйти',
  hideTooltip: `Засада: проверка Ловкости (Скрытность) Сл ${HIDE_CHECK_DC} — успех даёт состояние «В засаде»`,
  searchId: 'search',
  search: 'Поиск',
  searchIcon: SEARCH_ICON,
  searchHotkey: 'KeyR',
  searchTooltip:
    'Поиск: проверка Мудрости (Внимательность) — находит тех, кого видно (не сквозь стены, в пределах зрения), чья Сл не выше итога',
  jumpId: 'jump',
  jump: 'Прыжок',
  jumpIcon: 'tabler:arrow-bounce',
  jumpHotkey: 'KeyW',
  jumpTooltip: (standing: number, running: number): string =>
    `Прыжок в длину: ${standing} фт с места, ${running} фт с разбегом ${JUMP_RUN_UP_FEET} фт. Наведите на клетку — увидите дальность, щёлкните — прыжок`,
  jumpStandingTooltip: (standing: number): string =>
    `Прыжок в длину с места: ${standing} фт. Наведите на клетку — увидите дальность, щёлкните — прыжок`,
  jumpActiveTooltip:
    'Режим прыжка: щёлкните клетку, чтобы прыгнуть. Escape, правый щелчок или эта кнопка — выйти',
  /** Причина недоступной кнопки «Прыжок» */
  jumpNoMovement: 'Нет хода на прыжок в этот ход',
  /** Причина недоступной кнопки «Прыжок» на старом приложении */
  jumpNeedsHost: 'Нужен VTTG 0.9.751 или новее',
  /** Причина недоступной кнопки */
  inDevelopment: 'В разработке',
  /** Причина недоступной кнопки, пока не выбран свой герой */
  noHero: 'Выберите своего героя на сцене',
} as const;
