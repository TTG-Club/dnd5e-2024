<script setup lang="ts">
  import { computed, ref } from 'vue';

  import { EDITOR_NESTED_SECTION_LABELS } from './constants';
  import FieldHint from './FieldHint.vue';
  import SectionAddButton from './SectionAddButton.vue';

  /**
   * Раздел внутри записи формы: заголовок и содержимое на «дорожке» — линии,
   * идущей от значка свёртки вниз вдоль всего содержимого.
   *
   * Дорожка вместо рамки, потому что рамок в форме класса набиралось до семи
   * подряд — умение, варианты, вариант, механика, дары, строка дара, — все
   * одинаковые, и на глубине было не понять, чему принадлежит блок. Теперь в
   * форме два языка: КОРОБКА — объект списка (умение, вариант, дар, эффект),
   * ДОРОЖКА — раздел внутри объекта. Глубина читается по числу дорожек слева, а
   * взгляд ведёт по линии вверх, к хозяину.
   *
   * Пока курсор внутри поля, подсвечена дорожка его раздела — и вместе с ней
   * дорожки всех разделов выше: путь «где я сейчас» собирается сам, из
   * настоящих заголовков, без отдельной хлебной крошки.
   *
   * Тем же разделом показывает свои списки и карточка записи: свёрнутый блок
   * «Варианты» устроен там так же, и второй такой же компонент разошёлся бы с
   * этим при первой же правке. Им же мастер класса группирует заклинания по
   * записям-источникам — группа принадлежит своей записи так же, как поля
   * принадлежат объекту.
   */
  const props = withDefaults(
    defineProps<{
      title: string;
      /** Пояснение к разделу по наведению на ⓘ в шапке. */
      hint?: string;
      /** Сколько записей в разделе; ноль — бейджа нет. */
      count?: number;
      /** Подпись кнопки добавления в шапке; пусто — кнопки нет. */
      addLabel?: string;
      /**
       * Раздел сворачивается. Выключено — содержимое всегда на виду: так живут
       * блоки механики, где свёртка прятала бы уже заполненное.
       */
      collapsible?: boolean;
    }>(),
    {
      hint: undefined,
      count: 0,
      addLabel: undefined,
      collapsible: true,
    },
  );

  const emit = defineEmits<{ add: [] }>();

  const isOpen = ref(false);

  /** Показывать ли содержимое: несворачиваемый раздел всегда открыт. */
  const isContentVisible = computed(() => !props.collapsible || isOpen.value);

  /** Значок свёртки: показывает, куда уедет содержимое раздела. */
  const toggleIcon = computed(() =>
    isOpen.value ? 'tabler:chevron-down' : 'tabler:chevron-right',
  );

  /** Подпись шапки для скринридера. */
  const toggleLabel = computed(() =>
    isOpen.value
      ? EDITOR_NESTED_SECTION_LABELS.collapse
      : EDITOR_NESTED_SECTION_LABELS.expand,
  );

  /**
   * Шапка сворачиваемого раздела — она же кнопка свёртки: нажатие ловит
   * накладка во всю строку, а не один значок. У несворачиваемого раздела шапка
   * остаётся простым заголовком.
   */
  const headingTag = computed(() => (props.collapsible ? 'button' : 'div'));

  /** Оформление шапки: кнопкой она становится только у сворачиваемого. */
  const headingClass = computed(() =>
    props.collapsible ? 'cursor-pointer before:absolute before:inset-0' : '',
  );

  /** Атрибуты шапки: у заголовка без свёртки ни типа, ни состояния нет. */
  const headingAttributes = computed(() =>
    props.collapsible
      ? {
          'type': 'button' as const,
          'aria-expanded': isOpen.value,
          'aria-label': toggleLabel.value,
        }
      : {},
  );

  /**
   * Нажатие по шапке. У несворачиваемого раздела шапка — просто заголовок, и
   * нажимать в ней нечего.
   */
  function handleHeadingClick(): void {
    if (!props.collapsible) {
      return;
    }

    isOpen.value = !isOpen.value;
  }

  /** Добавление раскрывает раздел: иначе новая запись легла бы в свёрнутый. */
  function add(): void {
    isOpen.value = true;

    emit('add');
  }
</script>

<template>
  <section class="group/section flex flex-col gap-2">
    <div class="relative flex min-h-7 items-center gap-2">
      <!-- Нажатие по всей шапке ловит накладка — псевдоэлемент кнопки во всю
        строку: попадать в один значок приходилось прицельно. Кнопки справа
        подняты над накладкой через `relative` -->
      <component
        :is="headingTag"
        v-bind="headingAttributes"
        class="flex min-w-0 flex-1 items-center gap-2 text-left"
        :class="headingClass"
        @click.left.exact.prevent="handleHeadingClick"
      >
        <!-- Значок стоит перед подписью, а не в конце строки: от него вниз
          уходит дорожка, и вместе они читаются как одна ветка. У
          несворачиваемого раздела на его месте пустота — подписи стоят в
          столбик -->
        <UIcon
          v-if="props.collapsible"
          :name="toggleIcon"
          class="size-4 shrink-0 text-dimmed transition-colors group-focus-within/section:text-primary"
        />

        <span
          v-else
          class="size-4 shrink-0"
          aria-hidden="true"
        />

        <span
          class="min-w-0 truncate text-sm font-medium text-muted transition-colors group-focus-within/section:text-highlighted"
        >
          {{ props.title }}
        </span>

        <UBadge
          v-if="props.count"
          size="sm"
          color="primary"
          variant="subtle"
          class="shrink-0 tabular-nums"
        >
          {{ props.count }}
        </UBadge>
      </component>

      <span
        v-if="props.hint"
        class="relative flex shrink-0 items-center"
      >
        <FieldHint :text="props.hint" />
      </span>

      <!-- Кнопки подняты над накладкой шапки через `relative`. Слот — для своей
        кнопки добавления, когда обычной не хватает: у модификаторов вид
        выбирают меню, а не одним нажатием -->
      <div class="relative flex shrink-0 items-center gap-2">
        <slot name="actions" />

        <SectionAddButton
          v-if="props.addLabel"
          :label="props.addLabel"
          @click.left.exact.prevent="add"
        />
      </div>
    </div>

    <!-- Дорожка раздела: линия слева и отступ содержимого от неё. Отступ на
      узком окне меньше — вложенных дорожек бывает три подряд, и на широком
      отступе полям не осталось бы ширины -->
    <div
      v-if="isContentVisible"
      class="ml-2 flex flex-col gap-2 border-l-2 border-default pl-2 transition-colors group-focus-within/section:border-primary/60 sm:pl-3"
    >
      <slot />
    </div>
  </section>
</template>
