/**
 * Режим разработки (`npm run dev:hot`): имена и подписи.
 *
 * Файл читают две стороны: `vite.config.ts` (dev-сервер системы) и клиент на
 * странице. Поэтому здесь нет импортов — только значения.
 *
 * @module client/systemDevConsts
 */

/**
 * Событие dev-сервера для страницы: изменился файл, правку которого dev-сервер
 * до приложения не доносит.
 */
export const STALE_PART_EVENT = 'vttg:server-changed';

/** Серверная часть системы: `src/server` и манифест. */
export const SERVER_PART = 'server';

/** Движок правил: общий для клиента и сервера. */
export const ENGINE_PART = 'engine';

/** Файлы и папки серверной части (от корня проекта). */
export const SERVER_PART_PATHS: string[] = ['src/server', 'system.json'];

/** Папка движка правил (от корня проекта). */
export const ENGINE_PART_PATHS: string[] = ['src/engine'];

/** Строка терминала: правка серверной части. */
export const SERVER_PART_NOTICE =
  'серверная часть — dev-сервер её не обновляет. Нужны `npm run install:local` и перезапуск VTTG.';

/** Строка терминала: правка движка. */
export const ENGINE_PART_NOTICE =
  'движок общий — клиент уже обновлён, а сервер мира считает по-старому до `npm run install:local` и перезапуска VTTG.';

/** Заголовок уведомления о правке серверной части. */
export const SERVER_PART_TOAST_TITLE = 'Изменилась серверная часть системы';

/** Пояснение к уведомлению о правке серверной части. */
export const SERVER_PART_TOAST_DESCRIPTION =
  'Dev-сервер её не обновляет: выполните npm run install:local и перезапустите VTTG.';

/** Заголовок уведомления о правке движка. */
export const ENGINE_PART_TOAST_TITLE = 'Изменился движок правил';

/** Пояснение к уведомлению о правке движка. */
export const ENGINE_PART_TOAST_DESCRIPTION =
  'Клиент уже обновлён, а сервер мира считает по-старому, пока не выполнить npm run install:local и не перезапустить VTTG.';

/** Значок уведомлений режима разработки. */
export const STALE_PART_TOAST_ICON = 'tabler:alert-triangle';
