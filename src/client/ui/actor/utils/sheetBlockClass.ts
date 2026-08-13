import type { SheetBlockAccent } from '../constants';

import {
  SHEET_BLOCK_ACCENT_CLASS,
  SHEET_BLOCK_CLICKABLE_CLASS,
  SHEET_BLOCK_VIEW_BORDER_CLASS,
} from '../constants';

/** Что решает оформление блока листа */
export interface SheetBlockClassOptions {
  /** Лист в режиме правки: рамка блока горит цветом настройки */
  isEditMode: boolean;

  /**
   * По блоку кликают в этом режиме: курсор и потепление рамки под ним.
   *
   * Режимом это не выводится: плитка характеристики нажимается только в
   * просмотре (бросок), плитка мастерства — только в правке (окно настройки), а
   * здоровье и инициатива — всегда. Решает вызывающий блок.
   */
  isClickable?: boolean;

  /** Цвет рамки в правке; по умолчанию общий тёплый */
  accent?: SheetBlockAccent;
}

/**
 * Оформление блока листа: рамка и курсор. Блоки обоих листов — персонажа и
 * существа — выглядят одинаково по одному правилу, и правится оно здесь же.
 *
 * @param options - режим листа, нажимаемость и цвет рамки
 * @returns классы блока
 */
export function getSheetBlockClass(options: SheetBlockClassOptions): string {
  const accent = SHEET_BLOCK_ACCENT_CLASS[options.accent ?? 'primary'];

  return [
    options.isEditMode ? accent.edit : SHEET_BLOCK_VIEW_BORDER_CLASS,
    options.isClickable ? SHEET_BLOCK_CLICKABLE_CLASS : '',
    options.isClickable ? accent.hover : '',
  ]
    .filter(Boolean)
    .join(' ');
}
