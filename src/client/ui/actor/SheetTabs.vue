<script setup lang="ts">
  import type { CSSProperties } from 'vue';

  import type {
    SheetTabEntry,
    SheetTabTone,
    SheetTabTransition,
  } from './sheetTabsModel';

  import { useEventListener, useResizeObserver } from '@vueuse/core';
  import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    reactive,
    ref,
    useTemplateRef,
    watch,
  } from 'vue';

  import {
    SHEET_TAB_CLASSES,
    SHEET_TABS_AXIS_LOCK_THRESHOLD,
    SHEET_TABS_DRAG_DEADZONE,
    SHEET_TABS_DRAG_FADE_SPAN,
    SHEET_TABS_DRAG_MAX_FADE,
    SHEET_TABS_DRAG_RESISTANCE,
    SHEET_TABS_LABELS,
    SHEET_TABS_SCROLL_EDGE_GAP,
    SHEET_TABS_SCROLL_EPSILON,
    SHEET_TABS_SCROLL_STEP_RATIO,
    SHEET_TABS_SETTLE_TIMEOUT_MS,
    SHEET_TABS_SWIPE_THRESHOLD,
  } from './constants';
  import { isGestureOwnedByContent } from './sheetTabsModel';

  interface Props {
    tabs: SheetTabEntry[];
  }

  const props = defineProps<Props>();

  /** Выбранная вкладка: хранит её лист, лента только показывает и переключает */
  const activeTab = defineModel<string>({ required: true });

  /** Ось жеста: пока `none` — решаем, чей он; вертикальный отдаём листу */
  type GestureAxis = 'horizontal' | 'none' | 'vertical';

  /**
   * Оформление вкладки по её состоянию.
   *
   * @param isActive - вкладка выбрана
   * @param tone - особое выделение вкладки, если есть
   * @returns классы кнопки вкладки
   */
  function resolveTabClass(isActive: boolean, tone?: SheetTabTone): string {
    if (tone === 'drop') {
      return SHEET_TAB_CLASSES.drop;
    }

    if (tone === 'danger') {
      return isActive
        ? SHEET_TAB_CLASSES.dangerActive
        : SHEET_TAB_CLASSES.dangerIdle;
    }

    return isActive ? SHEET_TAB_CLASSES.active : SHEET_TAB_CLASSES.idle;
  }

  const tabButtons = computed(() =>
    props.tabs.map((tab) => {
      const isActive = tab.id === activeTab.value;

      return {
        id: tab.id,
        label: tab.label,
        isActive,
        class: resolveTabClass(isActive, tab.tone),
      };
    }),
  );

  // Подписи вкладок всегда полные. Когда ряд не помещается (телефон, суженное
  // окно), он прокручивается свайпом, а по краям появляются кнопки-стрелки:
  // на компьютере свайпа нет, а на телефоне он не всегда очевиден.
  const stripRef = useTemplateRef<HTMLElement>('strip');
  const stripContentRef = useTemplateRef<HTMLElement>('stripContent');

  const stripScroll = reactive({ left: 0, max: 0 });

  /** Перечитывает позицию ленты и остаток прокрутки для стрелок */
  function updateStripScroll(): void {
    const strip = stripRef.value;

    if (!strip) {
      return;
    }

    stripScroll.left = strip.scrollLeft;
    stripScroll.max = strip.scrollWidth - strip.clientWidth;
  }

  const canScrollLeft = computed(
    () => stripScroll.left > SHEET_TABS_SCROLL_EPSILON,
  );

  const canScrollRight = computed(
    () => stripScroll.left < stripScroll.max - SHEET_TABS_SCROLL_EPSILON,
  );

  useEventListener(stripRef, 'scroll', updateStripScroll, { passive: true });

  // Ширина ленты меняется и без прокрутки: другой размер окна, появление
  // вкладки «Основное».
  useResizeObserver(stripContentRef, updateStripScroll);
  useResizeObserver(stripRef, updateStripScroll);

  /**
   * Прокручивает ленту вкладок на шаг в заданную сторону.
   *
   * @param direction - `-1` — влево, `1` — вправо
   */
  function scrollStrip(direction: number): void {
    const strip = stripRef.value;

    if (!strip) {
      return;
    }

    strip.scrollBy({
      left: direction * strip.clientWidth * SHEET_TABS_SCROLL_STEP_RATIO,
      behavior: 'smooth',
    });
  }

  function handleScrollLeft(): void {
    scrollStrip(-1);
  }

  function handleScrollRight(): void {
    scrollStrip(1);
  }

  /**
   * Подтягивает выбранную вкладку в видимую часть ленты. Двигается только сама
   * лента — лист под ней не дёргается. Крайние вкладки доводятся ровно до
   * края, остальные — с зазором под стрелку, иначе она ложится на подпись.
   *
   * @param behavior - `smooth` при переключении пользователем, `auto` — когда
   *   ленту ставят на место (открытие листа, смена раскладки)
   */
  function scrollActiveTabIntoView(
    behavior: 'auto' | 'smooth' = 'smooth',
  ): void {
    const strip = stripRef.value;

    if (!strip) {
      return;
    }

    const buttons = [...strip.querySelectorAll('[data-sheet-tab]')];

    const activeIndex = buttons.findIndex(
      (button) => button.getAttribute('data-active') === 'true',
    );

    const activeButton = buttons[activeIndex];

    if (!activeButton) {
      return;
    }

    if (activeIndex === 0) {
      strip.scrollTo({ left: 0, behavior });

      return;
    }

    if (activeIndex === buttons.length - 1) {
      strip.scrollTo({ left: strip.scrollWidth - strip.clientWidth, behavior });

      return;
    }

    const stripBox = strip.getBoundingClientRect();
    const buttonBox = activeButton.getBoundingClientRect();

    if (buttonBox.left < stripBox.left + SHEET_TABS_SCROLL_EDGE_GAP) {
      strip.scrollBy({
        left: buttonBox.left - stripBox.left - SHEET_TABS_SCROLL_EDGE_GAP,
        behavior,
      });

      return;
    }

    if (buttonBox.right > stripBox.right - SHEET_TABS_SCROLL_EDGE_GAP) {
      strip.scrollBy({
        left: buttonBox.right - stripBox.right + SHEET_TABS_SCROLL_EDGE_GAP,
        behavior,
      });
    }
  }

  /**
   * Анимация смены вкладки. `tab-forward` / `tab-backward` — переключение самим
   * пользователем: уходящая вкладка уезжает в сторону, приходящая проявляется
   * на месте. `tab-none` — подмена вкладки листом (смена раскладки, запись
   * бросили на лист): правил у имени нет, длительность нулевая, и вкладка
   * меняется без движения — иначе лист «мерцал» бы сразу после открытия.
   */
  const tabTransition = ref<SheetTabTransition>('tab-none');

  /** Анимация, заказанная переключением пользователя; `null` — вкладку сменил лист */
  let requestedTransition: SheetTabTransition | null = null;

  // Наблюдатель срабатывает до перерисовки, поэтому имя перехода успевает
  // встать раньше, чем уходящая вкладка начнёт уходить.
  watch(activeTab, () => {
    const isUserSwitch = requestedTransition !== null;

    tabTransition.value = requestedTransition ?? 'tab-none';
    requestedTransition = null;

    void nextTick(() =>
      scrollActiveTabIntoView(isUserSwitch ? 'smooth' : 'auto'),
    );
  });

  // Состав ленты меняется вместе с раскладкой (вкладка «Основное»): выбранная
  // вкладка могла уехать за край.
  watch(
    () => props.tabs.length,
    () => {
      void nextTick(() => scrollActiveTabIntoView('auto'));
    },
  );

  onMounted(() => {
    void nextTick(() => scrollActiveTabIntoView('auto'));
  });

  /**
   * Переключение вкладки самим пользователем — кнопкой ленты или свайпом.
   *
   * @param tabId - вкладка, на которую переключаются
   */
  function selectTab(tabId: string): void {
    if (tabId === activeTab.value) {
      return;
    }

    const currentIndex = props.tabs.findIndex(
      (tab) => tab.id === activeTab.value,
    );

    const nextIndex = props.tabs.findIndex((tab) => tab.id === tabId);

    requestedTransition =
      nextIndex > currentIndex ? 'tab-forward' : 'tab-backward';

    activeTab.value = tabId;
  }

  /**
   * Соседняя вкладка ленты или `undefined`, если дальше край: зацикливание
   * сбивает ощущение места в ленте.
   *
   * @param step - `-1` — предыдущая вкладка, `1` — следующая
   * @returns соседняя вкладка
   */
  function getAdjacentTab(step: number): SheetTabEntry | undefined {
    const currentIndex = props.tabs.findIndex(
      (tab) => tab.id === activeTab.value,
    );

    return props.tabs[currentIndex + step];
  }

  // Свайп по самому содержимому листает вкладки: на телефоне это привычнее, чем
  // целиться в узкую ленту. Жест ведём сами: ось выбирается на первых пикселях,
  // и только горизонтальный жест забирает событие себе — вертикальный остаётся
  // прокруткой листа.
  const contentRef = useTemplateRef<HTMLElement>('content');

  let gestureAxis: GestureAxis = 'none';
  let gestureStartX = 0;
  let gestureStartY = 0;

  /** Жест начался на элементе, который обрабатывает свайп сам */
  let isSwipeIgnored = false;

  /** Сдвиг вкладки под пальцем (px) и её прозрачность на этом сдвиге */
  const dragOffset = ref(0);
  const dragOpacity = ref(1);

  /** Палец отпущен: сдвиг доигрывает переходом, а не следует за пальцем */
  const isDragSettling = ref(false);

  /**
   * Вкладка сдвинута жестом или доигрывает возврат. Сдвиг держится классом
   * только на это время: `transform` делает блок опорой для `position: fixed`,
   * и постоянный сдвиг, даже нулевой, сломал бы меню и окна внутри вкладки.
   */
  const isPaneShifted = computed(
    () => dragOffset.value !== 0 || isDragSettling.value,
  );

  const paneClass = computed(() => ({
    'sheet-tabs-pane--shifted': isPaneShifted.value,
    'sheet-tabs-pane--settling': isDragSettling.value,
  }));

  // Позицию и затухание отдаём в CSS переменными: класс перехода объявлен ниже
  // них и перебивает обе величины, поэтому уход в сторону доигрывает ровно с
  // той точки, где палец отпустили.
  const paneStyle = computed<CSSProperties>(() => ({
    '--sheet-tab-drag-x': `${dragOffset.value}px`,
    '--sheet-tab-drag-opacity': `${dragOpacity.value}`,
  }));

  /** Таймер, снимающий сдвиг, если переход возврата не сообщил о конце */
  let settleTimer: number | undefined;

  /** Возврат вкладки доигран — сдвиг больше не нужен */
  function finishSettle(): void {
    window.clearTimeout(settleTimer);
    isDragSettling.value = false;
  }

  /**
   * Ведёт вкладку за пальцем: содержимое отъезжает в сторону жеста и гаснет. У
   * края ленты, где листать некуда, сдвиг гасится сопротивлением и без
   * затухания — жест видно, но он ничем не закончится.
   *
   * @param deltaX - путь пальца по горизонтали; меньше нуля — палец идёт влево
   */
  function updateDragOffset(deltaX: number): void {
    const width = contentRef.value?.clientWidth ?? 0;

    // Дальше своей ширины вкладка не уезжает: иначе уход в сторону (ровно
    // −100%) доигрывал бы назад, к пальцу.
    const distance = Math.min(
      Math.abs(deltaX) - SHEET_TABS_DRAG_DEADZONE,
      width,
    );

    if (width <= 0 || distance <= 0) {
      dragOffset.value = 0;
      dragOpacity.value = 1;

      return;
    }

    const step = deltaX < 0 ? 1 : -1;
    const hasTarget = getAdjacentTab(step) !== undefined;

    dragOffset.value =
      -step * distance * (hasTarget ? 1 : SHEET_TABS_DRAG_RESISTANCE);

    const progress = Math.min(
      1,
      distance / (width * SHEET_TABS_DRAG_FADE_SPAN),
    );

    dragOpacity.value = hasTarget ? 1 - progress * SHEET_TABS_DRAG_MAX_FADE : 1;
  }

  /**
   * Палец отпущен (или жест прерван системой): сдвиг снимается с переходом.
   * Переключилась вкладка — уходящая доигрывает уход от этой же точки, не
   * переключилась — содержимое возвращается на место.
   */
  function settleSwipe(): void {
    // Обычное касание и вертикальная прокрутка содержимое не сдвигают —
    // возвращать нечего.
    if (dragOffset.value === 0) {
      return;
    }

    isDragSettling.value = true;
    dragOffset.value = 0;
    dragOpacity.value = 1;

    // Событие конца перехода не приходит, если вкладку за это время сменили:
    // без таймера нулевой сдвиг остался бы на новой вкладке.
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(finishSettle, SHEET_TABS_SETTLE_TIMEOUT_MS);
  }

  /**
   * Начало касания: запоминает точку отсчёта и решает, наш ли это жест.
   * Мультитач — это масштабирование, его не перехватываем.
   *
   * @param event - событие касания
   */
  function handleTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];

    isSwipeIgnored =
      !touch
      || event.touches.length > 1
      || isGestureOwnedByContent(event.target, contentRef.value);

    gestureAxis = 'none';
    finishSettle();

    if (!touch) {
      return;
    }

    gestureStartX = touch.clientX;
    gestureStartY = touch.clientY;
  }

  /**
   * Движение пальца: выбирает ось жеста и ведёт вкладку, если ось наша.
   *
   * @param event - событие касания
   */
  function handleTouchMove(event: TouchEvent): void {
    const touch = event.touches[0];

    if (isSwipeIgnored || !touch) {
      return;
    }

    const deltaX = touch.clientX - gestureStartX;
    const deltaY = touch.clientY - gestureStartY;

    if (gestureAxis === 'none') {
      if (
        Math.max(Math.abs(deltaX), Math.abs(deltaY))
        < SHEET_TABS_AXIS_LOCK_THRESHOLD
      ) {
        return;
      }

      gestureAxis =
        Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical';
    }

    // Вертикаль — прокрутка листа, в неё не вмешиваемся.
    if (gestureAxis === 'vertical') {
      return;
    }

    // Жест наш: лист под пальцем стоит, иначе его тянет вертикальным дрейфом
    // пальца, и он дёргается прямо во время листания.
    if (event.cancelable) {
      event.preventDefault();
    }

    updateDragOffset(deltaX);
  }

  /**
   * Палец отпущен: вкладка снимается со сдвига, а дотянувший до порога жест
   * переключает её.
   *
   * @param event - событие касания
   */
  function handleTouchEnd(event: TouchEvent): void {
    const wasHorizontal = gestureAxis === 'horizontal' && !isSwipeIgnored;

    gestureAxis = 'none';
    settleSwipe();

    const touch = event.changedTouches[0];

    if (!wasHorizontal || !touch) {
      return;
    }

    const deltaX = touch.clientX - gestureStartX;

    if (Math.abs(deltaX) < SHEET_TABS_SWIPE_THRESHOLD) {
      return;
    }

    // Палец влево — следующая вкладка, как при листании ленты.
    const nextTab = getAdjacentTab(deltaX < 0 ? 1 : -1);

    if (nextTab) {
      selectTab(nextTab.id);
    }
  }

  /** Жест прерван системой (звонок, шторка) — вкладка просто возвращается */
  function handleTouchCancel(): void {
    gestureAxis = 'none';
    settleSwipe();
  }

  // `touchmove` слушаем активно: только так работает `preventDefault`. Остальные
  // события ничего не отменяют и остаются пассивными.
  useEventListener(contentRef, 'touchstart', handleTouchStart, {
    passive: true,
  });

  useEventListener(contentRef, 'touchmove', handleTouchMove, {
    passive: false,
  });

  useEventListener(contentRef, 'touchend', handleTouchEnd, { passive: true });

  useEventListener(contentRef, 'touchcancel', handleTouchCancel, {
    passive: true,
  });

  onBeforeUnmount(() => {
    window.clearTimeout(settleTimer);
  });

  /**
   * Высота уходящей вкладки: держит блок, пока приходящая не встала на место.
   * Без неё содержимое на кадр схлопывается в ноль, браузер подтягивает
   * прокрутку под укоротившийся лист — и лента вкладок дёргается вверх.
   */
  const paneMinHeight = ref('');

  /**
   * Запоминает высоту уходящей вкладки перед её удалением.
   *
   * @param element - корень уходящей вкладки
   */
  function handlePaneBeforeLeave(element: Element): void {
    paneMinHeight.value = `${element.getBoundingClientRect().height}px`;
  }

  /** Приходящая вкладка встала на место — держать высоту больше не нужно */
  function handlePaneAfterEnter(): void {
    paneMinHeight.value = '';
  }
</script>

<template>
  <div class="relative flex flex-1 flex-col">
    <!-- Линия под вкладками — тем же токеном, что и остальные линии листа
      (`default`): у `muted` свой, более светлый оттенок, и полоска выбивалась
      из рамок карточек и разделителей под ней -->
    <div class="relative mb-4 shrink-0 border-b border-default">
      <div
        ref="strip"
        class="sheet-tabs-strip overflow-x-auto overscroll-x-contain"
      >
        <div
          ref="stripContent"
          class="flex w-max min-w-full gap-4"
        >
          <button
            v-for="tab in tabButtons"
            :key="tab.id"
            type="button"
            data-sheet-tab
            :data-active="tab.isActive"
            :class="[SHEET_TAB_CLASSES.base, tab.class]"
            @click.left.exact.prevent="selectTab(tab.id)"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>

      <!-- Подложка под стрелкой непрозрачная: сквозь прозрачную кнопку
        просвечивала бы подпись вкладки, на которую она легла -->
      <Transition name="sheet-tabs-fade">
        <span
          v-if="canScrollLeft"
          class="absolute top-0 bottom-1 left-0 z-10 flex items-center rounded bg-default"
        >
          <UButton
            icon="tabler:chevron-left"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :aria-label="SHEET_TABS_LABELS.scrollLeft"
            @click.left.exact.prevent="handleScrollLeft"
          />
        </span>
      </Transition>

      <Transition name="sheet-tabs-fade">
        <span
          v-if="canScrollRight"
          class="absolute top-0 right-0 bottom-1 z-10 flex items-center rounded bg-default"
        >
          <UButton
            icon="tabler:chevron-right"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            :aria-label="SHEET_TABS_LABELS.scrollRight"
            @click.left.exact.prevent="handleScrollRight"
          />
        </span>
      </Transition>
    </div>

    <!-- `overflow-x-clip`, а не `hidden`: обрезает уезжающую вкладку, но не
      делает блок прокручиваемым по горизонтали и не ломает прокрутку листа -->
    <div
      ref="content"
      class="sheet-tabs-content flex flex-1 flex-col overflow-x-clip"
      :style="{ minHeight: paneMinHeight }"
    >
      <!-- Ключ по вкладке: смена вкладки = смена узла, поэтому уходящая
        успевает уехать в сторону, а приходящая появляется уже на её месте -->
      <Transition
        :name="tabTransition"
        mode="out-in"
        @before-leave="handlePaneBeforeLeave"
        @after-enter="handlePaneAfterEnter"
      >
        <div
          :key="activeTab"
          class="flex flex-1 flex-col"
          :class="paneClass"
          :style="paneStyle"
          @transitionend.self="finishSettle"
        >
          <slot />
        </div>
      </Transition>
    </div>
  </div>
</template>

<style scoped>
  /* Полоса прокрутки ленте не нужна: её заменяют стрелки по краям */
  .sheet-tabs-strip {
    scrollbar-width: none;
  }

  .sheet-tabs-strip::-webkit-scrollbar {
    display: none;
  }

  .sheet-tabs-fade-enter-active,
  .sheet-tabs-fade-leave-active {
    transition: opacity 0.2s ease;
  }

  .sheet-tabs-fade-enter-from,
  .sheet-tabs-fade-leave-to {
    opacity: 0;
  }

  /* Подмена вкладки меняет высоту листа, и браузер «якорит» прокрутку — из-за
   * этого лента вкладок дёргалась вверх на пару пикселей */
  .sheet-tabs-content {
    overflow-anchor: none;
  }

  /* Вкладка едет за пальцем и гаснет: величины приходят переменными из
   * скрипта. Правила переходов ниже перебивают позицию пальца, поэтому уход в
   * сторону доигрывает с той точки, где палец отпустили */
  .sheet-tabs-pane--shifted {
    transform: translateX(var(--sheet-tab-drag-x, 0));
    opacity: var(--sheet-tab-drag-opacity, 1);
  }

  /* Палец отпущен, а переключения не вышло — вкладка возвращается на место */
  .sheet-tabs-pane--settling {
    transition:
      transform 0.2s ease-out,
      opacity 0.2s ease-out;
  }

  /* Уходит только текущая вкладка — уезжает в сторону свайпа и гаснет.
   * Следующая не едет следом, а проявляется уже на месте. У `tab-none` правил
   * нет намеренно: нулевая длительность = мгновенная подмена вкладки */
  .tab-forward-leave-active,
  .tab-backward-leave-active {
    transition:
      transform 0.18s ease-in,
      opacity 0.18s ease-in;
  }

  .tab-forward-leave-to {
    transform: translateX(-100%);
    opacity: 0;
  }

  .tab-backward-leave-to {
    transform: translateX(100%);
    opacity: 0;
  }

  .tab-forward-enter-active,
  .tab-backward-enter-active {
    transition: opacity 0.15s ease-out;
  }

  .tab-forward-enter-from,
  .tab-backward-enter-from {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .tab-forward-leave-active,
    .tab-backward-leave-active,
    .tab-forward-enter-active,
    .tab-backward-enter-active {
      transition: none;
    }
  }
</style>
