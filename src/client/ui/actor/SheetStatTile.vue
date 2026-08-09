<script setup lang="ts">
  import { computed } from 'vue';

  /** Ячейка плитки: короткая подпись и значение рядом с ней */
  interface StatCell {
    /** Короткая подпись — в узкой плитке помещается только она */
    label: string;
    /** Значение ячейки */
    value: string | number;
    /** Полное название: подсказка по наведению на ячейку */
    hint?: string;
    /** Свой цвет значения (превышение предела и прочие пометки) */
    valueClass?: string;
  }

  interface Props {
    /** Ячейки плитки; несколько — разделяются вертикальной чертой */
    cells: StatCell[];
    /** Подсказка на всю плитку (когда своей подсказки у ячеек нет) */
    tooltip?: string;
    /** Подпись для скринридера — у нажимаемой плитки */
    ariaLabel?: string;
    /** Плитка нажимается: курсор и потепление рамки под ним */
    clickable?: boolean;
    /** Тревожный вид: перегруз и прочие превышения предела */
    danger?: boolean;
  }

  /**
   * Плитка шапки вкладки листа (переносимый вес, заклинательство, подготовка).
   *
   * Одна на все вкладки, чтобы их шапки выглядели одинаково: плитка узнаётся по
   * рамке и высоте, а не по подписи. Нажимаемая — ещё и теплеет под курсором.
   */
  const props = withDefaults(defineProps<Props>(), {
    tooltip: undefined,
    ariaLabel: undefined,
    clickable: false,
    danger: false,
  });

  defineEmits<{
    click: [];
  }>();

  /** Нажимаемая плитка — кнопка, остальные просто показывают числа */
  const tileTag = computed(() => (props.clickable ? 'button' : 'div'));

  const tileClass = computed(() => [
    'flex h-7 items-center gap-3 rounded-lg border px-3 transition-colors',
    props.danger
      ? 'border-error/50 bg-error/10'
      : 'border-default/50 bg-elevated/20',
    props.clickable ? 'cursor-pointer' : '',
    props.clickable && props.danger ? 'hover:border-error' : '',
    props.clickable && !props.danger ? 'hover:border-primary/60' : '',
  ]);

  const labelClass = computed(() => [
    'text-[10px] font-bold tracking-wider whitespace-nowrap uppercase',
    props.danger ? 'text-error' : 'text-muted',
  ]);

  /** Цвет значения: свой у ячейки, иначе общий для плитки */
  function valueClass(cell: StatCell): string[] {
    return [
      'text-xs font-bold whitespace-nowrap tabular-nums',
      cell.valueClass ?? (props.danger ? 'text-error' : 'text-highlighted'),
    ];
  }
</script>

<template>
  <!-- Без текста подсказка сама выключается и лишней обёртки в разметку не
       добавляет (`as-child`), поэтому оборачиваем всегда -->
  <UTooltip :text="tooltip">
    <component
      :is="tileTag"
      :type="clickable ? 'button' : undefined"
      :aria-label="ariaLabel"
      :class="tileClass"
      @click.left.exact.prevent="$emit('click')"
    >
      <template
        v-for="(cell, index) in cells"
        :key="cell.label"
      >
        <span
          v-if="index > 0"
          class="h-5 w-px bg-default/60"
        />

        <UTooltip :text="cell.hint">
          <span class="flex items-center gap-1.5">
            <span :class="labelClass">{{ cell.label }}</span>

            <span :class="valueClass(cell)">{{ cell.value }}</span>
          </span>
        </UTooltip>
      </template>
    </component>
  </UTooltip>
</template>
