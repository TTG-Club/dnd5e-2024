<script setup lang="ts">
  import { computed } from 'vue';

  /**
   * Классы заголовка по имени семантического цвета.
   *
   * Карта, а не цепочка тернарников в шаблоне: §286 требует держать вычисление
   * классов в `computed`, а Tailwind вдобавок обязан увидеть каждый класс в
   * исходнике буквально — собрать имя из кусков (`text-${color}`) нельзя, правил
   * под такое не сгенерируется.
   */
  const TITLE_COLOR_CLASSES = {
    danger: 'text-danger',
    warning: 'text-warning',
    info: 'text-info',
    primary: 'text-primary',
    success: 'text-success',
    source: 'text-source',
    arcane: 'text-arcane',
    healing: 'text-healing',
  } as const;

  /** Семантический цвет заголовка секции */
  type FormSectionTitleColor = keyof typeof TITLE_COLOR_CLASSES;

  const props = withDefaults(
    defineProps<{
      title?: string;
      /**
       * Цвет заголовка; без значения заголовок приглушённый.
       *
       * @deprecated Легаси-стиль «разноцветных» заголовков. В новых и
       * редизайненных формах задавайте `icon` — заголовок рендерится в едином
       * стиле, а `titleColor` игнорируется.
       */
      titleColor?: FormSectionTitleColor;
      /** Иконка секции (`tabler:*`/`ttg:*`); включает единый стиль заголовка */
      icon?: string;
      /** Подсказка секции: иконка ⓘ с тултипом после текста заголовка */
      hint?: string;
      /** Есть ли контент у секции (если false, то паддинги будут симметричными) */
      hasContent?: boolean;
    }>(),
    {
      title: undefined,
      titleColor: undefined,
      icon: undefined,
      hint: undefined,
      hasContent: true,
    },
  );

  /** Классы цвета заголовка: с иконкой — единый стиль, иначе легаси-цвет */
  const titleColorClass = computed(() => {
    if (props.icon) {
      return 'text-highlighted';
    }

    return props.titleColor
      ? TITLE_COLOR_CLASSES[props.titleColor]
      : 'text-dimmed';
  });

  /** Нижний отступ секции: у пустой секции паддинги симметричные */
  const sectionPaddingClass = computed(() =>
    props.hasContent ? 'pb-3' : 'pb-2',
  );

  /** Отбивка заголовка от контента; у пустой секции её нет */
  const headerSpacingClass = computed(() =>
    props.hasContent ? 'mb-2' : 'mb-0',
  );
</script>

<template>
  <div
    class="rounded-lg border border-muted/60 bg-elevated/20 px-3 pt-2 transition-all duration-200"
    :class="sectionPaddingClass"
  >
    <!-- Заголовок -->
    <div
      v-if="title || $slots.header || $slots.actions"
      class="flex h-6 items-center justify-between"
      :class="headerSpacingClass"
    >
      <slot name="header">
        <div
          v-if="title"
          class="flex min-w-0 items-center gap-1.5"
        >
          <UIcon
            v-if="icon"
            :name="icon"
            class="size-4 shrink-0 text-primary"
          />

          <span
            class="truncate text-xs font-semibold tracking-wide"
            :class="titleColorClass"
          >
            {{ title }}
          </span>

          <UTooltip
            v-if="hint"
            :text="hint"
            :ui="{ content: 'h-auto max-w-72 whitespace-normal' }"
          >
            <UIcon
              name="tabler:info-circle"
              class="size-3.5 shrink-0 cursor-help text-dimmed transition-colors hover:text-default"
            />
          </UTooltip>
        </div>
      </slot>

      <div class="flex items-center gap-2">
        <slot name="actions" />
      </div>
    </div>

    <!-- Контент -->
    <div class="w-full">
      <slot />
    </div>
  </div>
</template>
