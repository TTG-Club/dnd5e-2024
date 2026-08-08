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
      /** Цвет заголовка; без значения заголовок приглушённый */
      titleColor?: FormSectionTitleColor;
      /** Есть ли контент у секции (если false, то паддинги будут симметричными) */
      hasContent?: boolean;
    }>(),
    {
      title: undefined,
      titleColor: undefined,
      hasContent: true,
    },
  );

  /** Цвет заголовка; без явного значения — приглушённый */
  const titleColorClass = computed(() =>
    props.titleColor ? TITLE_COLOR_CLASSES[props.titleColor] : 'text-dimmed',
  );

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
        <span
          v-if="title"
          class="text-xs font-semibold tracking-wide"
          :class="titleColorClass"
        >
          {{ title }}
        </span>
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
