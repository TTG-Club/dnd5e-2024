<script setup lang="ts">
  /**
   * Подпись источника записи: аббревиатура на карточке, расшифровка — в
   * подсказке.
   *
   * В списках источник соседствует с десятком других бейджей, поэтому полное
   * название (а их два — русское и английское) в строку не помещается. Отсюда
   * разделение: видно `LFL`, при наведении — «Лорвин: Первый свет / Lorwyn:
   * First Light».
   */

  import type { SourceDefinition } from '@vtt/shared';

  import { computed } from 'vue';

  import { useSourceLabels } from '../../composables/useSourceLabel';

  const props = withDefaults(
    defineProps<{
      /** Ключ источника записи */
      sourceKey?: string;
      /** Определение, вписанное вместе с записью (авторская книга) */
      source?: SourceDefinition;
      /** Вариант отрисовки: бейдж (модалки) или простой текст (списки) */
      variant?: 'badge' | 'text';
    }>(),
    {
      sourceKey: undefined,
      source: undefined,
      variant: 'badge',
    },
  );

  const { getSourceDefinition } = useSourceLabels();

  const definition = computed(() =>
    getSourceDefinition(props.sourceKey, props.source),
  );

  /**
   * Расшифровка для подсказки: русское название, английское — второй строкой.
   * Если расшифровки нет вовсе (автор вписал только аббревиатуру), подсказку не
   * показываем — пустой тултип раздражает сильнее, чем его отсутствие.
   */
  const tooltipText = computed(() => {
    const source = definition.value;

    if (!source) {
      return undefined;
    }

    const lines = [source.name, source.nameEn].filter(
      (line): line is string => Boolean(line) && line !== source.abbreviation,
    );

    return lines.length ? lines.join('\n') : undefined;
  });
</script>

<template>
  <UTooltip
    v-if="definition?.abbreviation"
    :text="tooltipText"
    :disabled="!tooltipText"
    :ui="{ text: 'whitespace-pre-line' }"
  >
    <UBadge
      v-if="variant === 'badge'"
      :label="definition.abbreviation"
      color="neutral"
      variant="subtle"
      size="sm"
    />

    <span
      v-else
      class="truncate text-primary-400"
    >
      {{ definition.abbreviation }}
    </span>
  </UTooltip>
</template>
