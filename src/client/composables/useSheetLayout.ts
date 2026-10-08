import type { ComputedRef, Ref } from 'vue';

import { useElementSize } from '@vueuse/core';
import { computed, onMounted, ref, watch } from 'vue';

/** Раскладка листа по ширине его окна */
export interface SheetLayout {
  /** Ширина замерена — лист можно рисовать сразу в верной раскладке */
  isMeasured: ComputedRef<boolean>;
  /** Лист достаточно широк для колонок; иначе сводка уходит во вкладку */
  isWide: ComputedRef<boolean>;
}

/** Размер шрифта страницы, если браузер его не отдал */
const FALLBACK_ROOT_FONT_SIZE = 16;

/**
 * Читает размер шрифта страницы: от него отсчитываются `rem`, а масштаб
 * интерфейса хоста меняет именно его.
 *
 * @returns размер шрифта страницы в пикселях
 */
function readRootFontSize(): number {
  const fontSize = Number.parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );

  return Number.isFinite(fontSize) && fontSize > 0
    ? fontSize
    : FALLBACK_ROOT_FONT_SIZE;
}

/**
 * Раскладка листа по ширине самого листа, а не экрана: окно листа сужают и на
 * большом экране, и тогда лист обязан перестроиться так же, как на телефоне.
 *
 * Пока ширина не замерена, раскладка неизвестна — лист рисовать рано: угаданная
 * по экрану раскладка на телефоне неверна, и лист собрался бы колонками, а
 * через кадр перестроился на глазах.
 *
 * @param rootRef - элемент, по ширине которого выбирается раскладка
 * @param wideMinWidthRem - ширина в rem, с которой лист раскладывается колонками
 * @returns признаки «замерено» и «широкий лист»
 */
export function useSheetLayout(
  rootRef: Readonly<Ref<HTMLElement | null>>,
  wideMinWidthRem: number,
): SheetLayout {
  const { width: observedWidth } = useElementSize(rootRef);

  /**
   * Последняя ненулевая ширина. Свёрнутое окно прячет тело листа, и замер
   * отдаёт ноль — по нулю лист счёл бы себя незамеренным, убрал содержимое и
   * потерял бы всё, что в нём открыто.
   */
  const knownWidth = ref(0);

  /** Порог широкой раскладки в пикселях при текущем масштабе интерфейса */
  const wideMinWidth = ref(wideMinWidthRem * FALLBACK_ROOT_FONT_SIZE);

  /**
   * Запоминает ширину листа и пересчитывает порог: масштаб интерфейса меняет
   * размер шрифта страницы, а вместе с ним и ширину листа.
   *
   * @param width - замеренная ширина листа
   */
  function rememberWidth(width: number): void {
    if (width <= 0) {
      return;
    }

    knownWidth.value = width;
    wideMinWidth.value = wideMinWidthRem * readRootFontSize();
  }

  watch(observedWidth, rememberWidth);

  // Первый замер снимаем сами: наблюдатель сообщает ширину только после кадра,
  // и лист лишний кадр стоял бы пустым.
  onMounted(() => {
    rememberWidth(rootRef.value?.clientWidth ?? 0);
  });

  return {
    isMeasured: computed(() => knownWidth.value > 0),
    isWide: computed(() => knownWidth.value >= wideMinWidth.value),
  };
}
