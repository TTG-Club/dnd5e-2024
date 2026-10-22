/**
 * Полка действий системы — ряд постоянных кнопок слева от панели быстрого
 * доступа («Атака», «Прыжок», «Спрятаться»). Ядро даёт её с VTTG 0.9.725
 * (`ClientSystemAPI.actionShelf`); на старом приложении метода нет, и система
 * полку просто не регистрирует.
 *
 * Типы полки описаны здесь по контракту ядра: в типах приложения, против
 * которых собирается система, метода может ещё не быть.
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { SceneEntity } from '@vtt/shared';

/** Для кого собирается полка: выделенная сущность пользователя */
export interface ActionShelfContext {
  /** Выделенная сущность, которой пользователь вправе управлять */
  entityId: string | null;
  /** Она же целиком */
  entity: SceneEntity | null;
  /** Её фишка */
  tokenId: string | null;
  /** Пользователь — ведущий */
  isGM: boolean;
}

/** Кнопка полки */
export interface ActionShelfButton {
  /** Стабильный id кнопки в системе */
  id: string;
  /** Значок (`tabler:<имя>`) */
  icon: string;
  /** Подпись */
  label: string;
  /** Подсказка при наведении */
  tooltip?: string;
  /** Кнопка недоступна */
  disabled?: boolean;
  /** Почему недоступна */
  disabledReason?: string;
  /** Кнопка «включена»: подсветка */
  active?: boolean;
  /**
   * Горячая клавиша — код латинской буквы (`KeyQ`), как `KeyboardEvent.code`.
   * Ядро понимает её с VTTG 0.9.755; старое приложение поле отбрасывает.
   */
  hotkey?: string;
  /** Нажатие; у недоступной кнопки его может не быть */
  onClick?: (context: ActionShelfContext) => void | Promise<void>;
}

/** Провайдер полки: кнопки для выделенной сущности */
export interface ActionShelfProvider {
  /** До 10 кнопок; пусто — полки не видно */
  list: (context: ActionShelfContext) => ActionShelfButton[];
}

/** API ядра с полкой действий */
interface ActionShelfApi {
  actionShelf: (provider: ActionShelfProvider) => { refresh: () => void };
}

/**
 * Есть ли у ядра полка действий.
 *
 * @param api - API ядра для системы
 * @returns `true`, если метод полки есть
 */
function hasActionShelf(
  api: ClientSystemAPI,
): api is ClientSystemAPI & ActionShelfApi {
  return 'actionShelf' in api && typeof api.actionShelf === 'function';
}

/**
 * Регистрирует провайдера полки, если ядро её умеет.
 *
 * @param api - API ядра для системы
 * @param provider - кнопки для выделенной сущности
 * @returns `true`, если полка зарегистрирована
 */
export function registerActionShelf(
  api: ClientSystemAPI,
  provider: ActionShelfProvider,
): boolean {
  if (!hasActionShelf(api)) {
    return false;
  }

  api.actionShelf(provider);

  return true;
}
