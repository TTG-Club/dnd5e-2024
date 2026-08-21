/**
 * Композабл свёртки листа сущности в шторку окна (актёр и существо).
 *
 * Лист рисует свою шапку внутри тела (`hide-header`), поэтому штатной кнопки
 * свёртки окно дать не может: рисует её шапка листа, а схлопывает окно сам
 * `UDraggableModal` — через ref. Оба листа делают это одинаково и отличаются
 * только источником имени, поэтому логика живёт здесь, а не в каждом листе.
 */
import type { ComputedRef, Ref } from 'vue';

import type UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';

import { computed, ref } from 'vue';

/** Что композабл отдаёт листу */
interface SheetMinimize {
  /** Ссылка на окно листа: вешается на `UDraggableModal` через `ref` */
  sheetModalRef: Ref<InstanceType<typeof UDraggableModal> | null>;
  /** Подпись свёрнутого листа */
  minimizedTitle: ComputedRef<string>;
  /** Свернуть лист в шторку */
  minimizeSheet: () => void;
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

  return { sheetModalRef, minimizedTitle, minimizeSheet };
}
