<script setup lang="ts">
  import { computed } from 'vue';

  const props = withDefaults(
    defineProps<{
      title?: string;
      /** Иконка секции (`tabler:*`/`ttg:*`); включает единый стиль заголовка */
      icon?: string;
      /** Подсказка секции: иконка ⓘ с тултипом после текста заголовка */
      hint?: string;
      /** Есть ли контент у секции (если false, то паддинги будут симметричными) */
      hasContent?: boolean;
    }>(),
    {
      title: undefined,
      icon: undefined,
      hint: undefined,
      hasContent: true,
    },
  );

  /** Классы цвета заголовка: с иконкой — основной текст, без — приглушённый */
  const titleColorClass = computed(() =>
    props.icon ? 'text-highlighted' : 'text-dimmed',
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

          <!-- Текст подсказки через слот, а не проп `text`: штатный спан
               тултипа обрезает текст в одну строку классом `truncate` -->
          <UTooltip
            v-if="hint"
            :ui="{ content: 'h-auto max-w-72 py-1.5' }"
          >
            <UIcon
              name="tabler:info-circle-filled"
              class="size-3.5 shrink-0 cursor-help text-dimmed transition-colors hover:text-default"
            />

            <template #content>
              <span class="whitespace-normal">{{ hint }}</span>
            </template>
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
