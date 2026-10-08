/**
 * Композабл свёртки листа сущности в шторку окна и выноса его в отдельное окно
 * браузера (актёр и существо).
 *
 * Лист рисует свою шапку внутри тела (`hide-header`), поэтому штатной кнопки
 * свёртки окно дать не может: рисует её шапка листа, а схлопывает окно сам
 * `UDraggableModal` — через ref. Оба листа делают это одинаково и отличаются
 * только источником имени, поэтому логика живёт здесь, а не в каждом листе.
 */
import type { ComputedRef, Ref } from 'vue';

import type UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';

import { computed, ref } from 'vue';

import {
  MODAL_BUTTON_LABELS,
  SHEET_POP_OUT_ICONS,
} from '../ui/actor/constants';

/** Как выглядит кнопка выноса листа */
interface SheetPopOutButton {
  /** Подпись-подсказка */
  label: string;
  /** Имя иконки */
  icon: string;
}

/**
 * Вид кнопки выноса: на столе она выносит лист в отдельное окно браузера,
 * у вынесенного — возвращает обратно. Шапки листа актёра и листа существа
 * рисуют её одинаково.
 *
 * @param isPoppedOut - вынесен ли лист сейчас
 */
export function resolveSheetPopOutButton(
  isPoppedOut: boolean,
): SheetPopOutButton {
  if (isPoppedOut) {
    return {
      label: MODAL_BUTTON_LABELS.popIn,
      icon: SHEET_POP_OUT_ICONS.popIn,
    };
  }

  return {
    label: MODAL_BUTTON_LABELS.popOut,
    icon: SHEET_POP_OUT_ICONS.popOut,
  };
}

/** Что композабл отдаёт листу */
interface SheetMinimize {
  /** Ссылка на окно листа: вешается на `UDraggableModal` через `ref` */
  sheetModalRef: Ref<InstanceType<typeof UDraggableModal> | null>;
  /** Подпись свёрнутого листа */
  minimizedTitle: ComputedRef<string>;
  /** Свернуть лист в шторку */
  minimizeSheet: () => void;
  /**
   * Показывать ли кнопку выноса. Решает хост: настройка клиента, размер экрана.
   * На хосте без выноса окна ref ничего не отдаёт — кнопки просто нет.
   */
  canPopOutSheet: ComputedRef<boolean>;
  /** Вынесен ли лист в отдельное окно браузера */
  isSheetPoppedOut: ComputedRef<boolean>;
  /** Вынести лист в отдельное окно или вернуть его на стол */
  togglePopOutSheet: () => void;
}

/**
 * Готовит листу свёртку в шторку.
 *
 * @param resolveName - имя сущности; у ещё не названной оно пустое
 * @param untitledLabel - подпись шторки, пока имени нет
 */
export function useSheetMinimize(
  resolveName: () => string | undefined,
  untitledLabel: string,
): SheetMinimize {
  const sheetModalRef = ref<InstanceType<typeof UDraggableModal> | null>(null);

  // Подпись видна ТОЛЬКО в шторке: при `hide-header` штатная шапка окна не
  // рисуется, поэтому с собственной шапкой листа имя не двоится.
  const minimizedTitle = computed<string>(() => resolveName() || untitledLabel);

  // Окно остаётся открытым и живым: вкладки, скролл и незаконченные правки
  // дожидаются разворачивания.
  function minimizeSheet(): void {
    sheetModalRef.value?.setMinimized(true);
  }

  const canPopOutSheet = computed<boolean>(
    () => sheetModalRef.value?.canPopOut === true,
  );

  const isSheetPoppedOut = computed<boolean>(
    () => sheetModalRef.value?.isPoppedOut === true,
  );

  // Содержимое не перемонтируется: окно переносит готовую разметку, так что
  // вкладки и незаконченные правки переезжают вместе с листом.
  function togglePopOutSheet(): void {
    sheetModalRef.value?.setPoppedOut?.(!isSheetPoppedOut.value);
  }

  return {
    sheetModalRef,
    minimizedTitle,
    minimizeSheet,
    canPopOutSheet,
    isSheetPoppedOut,
    togglePopOutSheet,
  };
}
