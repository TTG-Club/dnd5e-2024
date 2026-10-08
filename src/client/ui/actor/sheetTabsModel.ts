import { SHEET_TABS_OVERFLOW_EPSILON } from './constants';

/**
 * Как выделена вкладка в ленте помимо «выбрана / не выбрана»:
 * `drop` — над листом держат запись, которая ляжет в эту вкладку;
 * `danger` — вкладка сообщает о беде (перегруз у снаряжения).
 */
export type SheetTabTone = 'danger' | 'drop';

/** Вкладка ленты листа */
export interface SheetTabEntry {
  id: string;
  label: string;
  tone?: SheetTabTone;
}

/** Анимация смены вкладки: вперёд по ленте, назад или без анимации */
export type SheetTabTransition = 'tab-backward' | 'tab-forward' | 'tab-none';

/**
 * Проверяет, обрабатывает ли жест сам элемент под пальцем: поля ввода,
 * редактор текста и блоки с горизонтальной прокруткой (широкая таблица в
 * описании) — свайп по ним листать вкладки не должен.
 *
 * @param target - элемент, на котором начался жест
 * @param root - контейнер содержимого вкладки: до него идёт проверка
 * @returns `true`, если жест принадлежит содержимому
 */
export function isGestureOwnedByContent(
  target: EventTarget | null,
  root: HTMLElement | null,
): boolean {
  let element = target instanceof Element ? target : null;

  while (element && element !== root) {
    if (element.matches('input, textarea, select, [contenteditable]')) {
      return true;
    }

    const { overflowX } = window.getComputedStyle(element);

    const canScrollHorizontally =
      overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay';

    if (
      canScrollHorizontally
      && element.scrollWidth > element.clientWidth + SHEET_TABS_OVERFLOW_EPSILON
    ) {
      return true;
    }

    element = element.parentElement;
  }

  return false;
}
