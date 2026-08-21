<script setup lang="ts">
  /**
   * Подсказка поля: заполненная иконка ⓘ с всплывающим пояснением.
   *
   * Пояснения к полям формы длинные — с примером их иначе не написать, — а
   * рядом с полем длинный текст либо режется, либо разъезжает разметку. Поэтому
   * он прячется под иконку и показывается по наведению.
   *
   * Текст передаётся через слот, а не пропом `text` у `UTooltip`: штатная
   * подпись тултипа обрезает текст в одну строку классом `truncate`.
   */
  defineProps<{
    /** Текст подсказки: простыми словами и с примером */
    text: string;
  }>();
</script>

<template>
  <UTooltip :ui="{ content: 'h-auto max-w-80 py-1.5' }">
    <UIcon
      name="tabler:info-circle-filled"
      class="size-3.5 shrink-0 cursor-help text-dimmed transition-colors hover:text-default"
    />

    <template #content>
      <span class="whitespace-normal">{{ text }}</span>
    </template>
  </UTooltip>
</template>
