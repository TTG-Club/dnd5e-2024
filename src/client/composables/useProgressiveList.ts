/**
 * Постепенный показ длинного списка: сперва первая порция строк, остальное —
 * по мере прокрутки.
 *
 * В окнах выбора из компендиумов бывает по две тысячи строк (все паки разом), и
 * каждая строка — компонент с галочкой. Нарисованные разом, они держали окно
 * закрытым по секунде и дольше, хотя данные уже лежали в памяти. Порция
 * рисуется мгновенно, а следующая подгружается, когда до конца списка остаётся
 * пара экранов, — пользователь разницы не видит.
 *
 * @module systems/dnd5e/composables/useProgressiveList
 */

import type { ComputedRef, MaybeRefOrGetter, Ref } from 'vue';

import { useIntersectionObserver } from '@vueuse/core';
import { computed, ref, toValue, watch } from 'vue';

/** Строк в первой порции — с запасом на самый высокий экран */
const INITIAL_ROW_COUNT = 60;

/** Строк в каждой следующей порции */
const ROW_COUNT_STEP = 100;

/**
 * Запас до конца списка, с которого подгружается следующая порция: прокрутка
 * не упирается в край, пока строки дорисовываются.
 */
const PRELOAD_MARGIN = '600px';

/** Постепенно показанный список */
export interface ProgressiveList<TItem> {
  /** Строки, которые рисуются сейчас */
  visibleItems: ComputedRef<TItem[]>;
  /** Остались ли строки за показанной частью */
  hasMore: ComputedRef<boolean>;
  /** Метка конца показанной части — ставится после строк, пока `hasMore` */
  endMarker: Ref<HTMLElement | null>;
}

/**
 * Постепенно показывает список.
 *
 * Новый список (поиск, фильтр, другой компендиум) снова начинается с первой
 * порции: иначе после сужения поиска и его сброса окно рисовало бы разом всё,
 * что успели прокрутить раньше.
 *
 * @param source - полный список
 * @returns показанная часть, признак продолжения и ref метки конца списка —
 *   её ставят после строк, пока `hasMore`
 */
export function useProgressiveList<TItem>(
  source: MaybeRefOrGetter<readonly TItem[]>,
): ProgressiveList<TItem> {
  const rowLimit = ref(INITIAL_ROW_COUNT);
  const endMarker = ref<HTMLElement | null>(null);

  watch(
    () => toValue(source),
    () => {
      rowLimit.value = INITIAL_ROW_COUNT;
    },
  );

  const visibleItems = computed(() => toValue(source).slice(0, rowLimit.value));

  const hasMore = computed(() => rowLimit.value < toValue(source).length);

  // Порция в сотню строк заведомо выше экрана, поэтому после неё метка уходит
  // за край и следующее пересечение случается только от прокрутки — цикла
  // «дорисовали — снова видно — дорисовали» не бывает
  useIntersectionObserver(
    endMarker,
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        rowLimit.value += ROW_COUNT_STEP;
      }
    },
    { rootMargin: PRELOAD_MARGIN },
  );

  return { visibleItems, hasMore, endMarker };
}
