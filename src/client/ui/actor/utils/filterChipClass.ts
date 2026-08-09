import type { FilterChipShape } from '../constants';

import {
  FILTER_CHIP_CLASS,
  FILTER_CHIP_ICON_CLASS,
  FILTER_CHIP_IDLE_CLASS,
  FILTER_CHIP_SELECTED_CLASS,
  FILTER_CHIP_TEXT_CLASS,
} from '../constants';

/**
 * Оформление чипа отбора: выбранный горит тёплым, невыбранный теплеет только
 * под курсором. Чип без подписи остаётся квадратом под один значок.
 *
 * @param isSelected - чип выбран
 * @param shape - форма чипа: под подпись либо квадрат под значок
 * @returns классы чипа
 */
export function getFilterChipClass(
  isSelected: boolean,
  shape: FilterChipShape = 'text',
): string {
  return [
    FILTER_CHIP_CLASS,
    shape === 'icon' ? FILTER_CHIP_ICON_CLASS : FILTER_CHIP_TEXT_CLASS,
    isSelected ? FILTER_CHIP_SELECTED_CLASS : FILTER_CHIP_IDLE_CLASS,
  ].join(' ');
}
