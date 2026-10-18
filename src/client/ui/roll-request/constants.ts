/**
 * Подписи и значения окна мастера «Запросить бросок».
 *
 * @module client/ui/roll-request/constants
 */

import type { AbilityType, SkillType } from '@vtt/shared';

/** Имя окна в менеджере окон ядра (окна регистрируются по имени файла) */
export const GM_ROLL_REQUEST_MODAL = 'GmRollRequestModal';

/** Сложность, с которой окно открывается: «лёгкая» по таблице Сл */
export const GM_ROLL_REQUEST_DEFAULT_DC = 10;

/** Пределы поля сложности */
export const GM_ROLL_REQUEST_DC_MIN = 1;
export const GM_ROLL_REQUEST_DC_MAX = 40;

/** Что мастер просит бросить */
export const GM_ROLL_REQUEST_KINDS = ['save', 'ability', 'skill'] as const;

/** Вид запроса мастера */
export type GmRollRequestKind = (typeof GM_ROLL_REQUEST_KINDS)[number];

/** Вид запроса, с которым окно открывается */
export const GM_ROLL_REQUEST_DEFAULT_KIND: GmRollRequestKind = 'ability';

/** Характеристика, с которой окно открывается: самая частая у проверок */
export const GM_ROLL_REQUEST_DEFAULT_ABILITY: AbilityType = 'dexterity';

/** Навык, с которым окно открывается: «все кидаем Внимательность» */
export const GM_ROLL_REQUEST_DEFAULT_SKILL: SkillType = 'perception';

/** Подписи видов запроса в переключателе окна */
export const GM_ROLL_REQUEST_KIND_LABELS: Record<GmRollRequestKind, string> = {
  save: 'Спасбросок',
  ability: 'Проверка характеристики',
  skill: 'Проверка навыка',
};

/**
 * Кому запрос: выделенные фишки (есть, только если окно открыли из меню
 * фишки) или группа фишек сцены, которые видят игроки
 */
export const GM_ROLL_REQUEST_GROUPS = [
  'selected',
  'actors',
  'creatures',
  'all',
] as const;

/** Адресаты запроса */
export type GmRollRequestGroup = (typeof GM_ROLL_REQUEST_GROUPS)[number];

/** Подписи адресатов; у выделенных в скобках добавляется их число */
export const GM_ROLL_REQUEST_GROUP_LABELS: Record<GmRollRequestGroup, string> =
  {
    selected: 'Выделенные',
    actors: 'Все игроки',
    creatures: 'Все существа',
    all: 'Все на сцене',
  };

/** Адресаты, когда выделенных нет (окно открыто с карты) */
export const GM_ROLL_REQUEST_DEFAULT_GROUP: GmRollRequestGroup = 'actors';

/** Подписи окна */
export const GM_ROLL_REQUEST_LABELS = {
  title: 'Запросить бросок',
  recipients: 'Кому',
  recipientsHint:
    'Игроки получат окно броска, за существ мастера бросок сделается сам. Скрытые от игроков фишки в группы не входят.',
  noRecipients: 'Под выбор не попала ни одна фишка сцены.',
  countPrefix: ' (',
  countSuffix: ')',
  kind: 'Что бросить',
  ability: 'Характеристика',
  skill: 'Навык',
  dc: 'Сложность (Сл)',
  submit: 'Запросить',
} as const;

/** Итог запроса — уведомление мастеру, когда все ответили */
export const GM_ROLL_REQUEST_SUMMARY_LABELS = {
  passed: 'Успех: ',
  failed: 'Провал: ',
  missing: 'Без броска: ',
  /** Итог броска в скобках после имени: «Гримли (17)» */
  totalPrefix: ' (',
  totalSuffix: ')',
  nameSeparator: ', ',
  partSeparator: '. ',
} as const;

/** Префикс сообщений запроса мастера в консоли */
export const GM_ROLL_REQUEST_LOG_PREFIX = '[GmRollRequest]';

/** Строки консоли запроса мастера */
export const GM_ROLL_REQUEST_LOG_MESSAGES = {
  sendFailed: 'Запрос броска не разослан',
} as const;

/** Иконка окна и уведомления */
export const GM_ROLL_REQUEST_ICON = 'tabler:dice-3';
