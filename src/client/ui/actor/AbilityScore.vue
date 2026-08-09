<script setup lang="ts">
  import {
    unrefElement,
    useElementHover,
    useElementSize,
    useFocusWithin,
  } from '@vueuse/core';
  import { computed, useTemplateRef, watch } from 'vue';

  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';

  import { ABILITY_LABEL_SIDE_SPACE } from './constants';

  /** Источник бонуса к характеристике */
  export interface AbilityBonusSource {
    /** Название источника (например: "Предыстория: Послушник") */
    name: string;
    /** Числовое значение бонуса */
    value: number;
  }

  interface Props {
    label: string;
    /** Аббревиатура из трёх букв — подставляется, когда полное название не влезает */
    shortLabel: string;
    /** Итоговое значение характеристики (с учётом эффектов) */
    value: number;
    /** Базовое значение характеристики (без эффектов) */
    baseValue: number;
    modifier: number;
    isEditMode: boolean;
    /** Источники бонусов к характеристике от Active Effects */
    bonusSources?: AbilityBonusSource[];
  }

  const props = withDefaults(defineProps<Props>(), {
    bonusSources: () => [],
  });

  const emit = defineEmits<{
    'update:value': [value: number];
    'roll': [modifier: number, label: string];
    /** Плитка под курсором или в фокусе: лист подсвечивает её навыки */
    'highlight': [isActive: boolean];
  }>();

  /** Корень блока: его ширина решает, влезает ли полное название в шапку */
  const rootRef = useTemplateRef<InstanceType<typeof FieldsetLabel>>('root');

  /**
   * Невидимый образец полного названия. Нужен, чтобы сравнивать ширины по
   * реальному тексту в реальном шрифте, а не по оценке «символ × ширина».
   */
  const labelProbeRef = useTemplateRef<HTMLElement>('labelProbe');

  const { width: blockWidth } = useElementSize(rootRef);
  const { width: fullLabelWidth } = useElementSize(labelProbeRef);

  /** Полное название с боковым запасом шире блока → нужна аббревиатура */
  const isLabelCompact = computed(() => {
    // Нулевые ширины — момент до первого замера ResizeObserver
    if (blockWidth.value === 0 || fullLabelWidth.value === 0) {
      return false;
    }

    return fullLabelWidth.value + ABILITY_LABEL_SIDE_SPACE > blockWidth.value;
  });

  const displayLabel = computed(() =>
    isLabelCompact.value ? props.shortLabel : props.label,
  );

  /** Подсветка и курсор блока: в режиме правки клик по блоку не бросает кубик */
  const containerClass = computed(() => {
    return props.isEditMode
      ? 'hover:border-accented'
      : 'cursor-pointer hover:border-primary/50';
  });

  const formattedModifier = computed(() => {
    return props.modifier >= 0 ? `+${props.modifier}` : `${props.modifier}`;
  });

  const modifierClass = computed(() => {
    if (props.modifier > 0) {
      return 'text-highlighted';
    } else if (props.modifier < 0) {
      return 'text-danger';
    } else {
      return 'text-toned';
    }
  });

  /** Суммарный бонус от эффектов */
  const totalBonus = computed(() => {
    return props.bonusSources.reduce((sum, source) => sum + source.value, 0);
  });

  /** Форматированный бонус: +2, -1, или пустая строка */
  const formattedBonus = computed(() => {
    if (totalBonus.value === 0) {
      return '';
    }

    return totalBonus.value > 0
      ? `+${totalBonus.value}`
      : `${totalBonus.value}`;
  });

  /** Есть ли бонусы от эффектов */
  const hasBonus = computed(() => totalBonus.value !== 0);

  /** CSS-класс цвета бонуса: зелёный для положительных, красный для отрицательных */
  const bonusColorClass = computed(() => {
    return totalBonus.value > 0 ? 'text-success' : 'text-danger';
  });

  interface TooltipRow {
    label: string;
    /** Форматированное значение для отображения справа */
    value: string;
    /** Стиль строки: база/бонус/итог */
    kind: 'base' | 'bonus' | 'total';
  }

  /** Строки тултипа: базовое значение, источники бонусов и итог */
  const tooltipRows = computed<TooltipRow[]>(() => {
    const rows: TooltipRow[] = [
      { label: 'Базовое значение', value: `${props.baseValue}`, kind: 'base' },
    ];

    for (const source of props.bonusSources) {
      if (source.value === 0) {
        continue;
      }

      const prefix = source.value > 0 ? '+' : '';

      rows.push({
        label: source.name,
        value: `${prefix}${source.value}`,
        kind: 'bonus',
      });
    }

    rows.push({ label: 'Итого', value: `${props.value}`, kind: 'total' });

    return rows;
  });

  function handleRoll() {
    if (!props.isEditMode) {
      emit('roll', props.modifier, props.label);
    }
  }

  // Наведение подсвечивает навыки этой характеристики. Через `unrefElement`:
  // ref смотрит на компонент рамки, а слушателям нужен её корневой элемент.
  const isHovered = useElementHover(() => unrefElement(rootRef));

  // Клавиатура доходит до плитки табом: фокус внутри неё подсвечивает навыки
  // наравне с наведением, иначе связка была бы доступна только мышью. Именно
  // «внутри»: фокус ходит и по кнопкам правки самой плитки, и на этих шагах
  // подсветка не должна мигать.
  const { focused: isFocusWithin } = useFocusWithin(rootRef);

  const isHighlighted = computed(() => isHovered.value || isFocusWithin.value);

  watch(isHighlighted, (highlighted) => emit('highlight', highlighted));

  function handleInput(event: Event) {
    const numValue = Number.parseInt(
      (event.target as HTMLInputElement).value,
      10,
    );

    if (!Number.isNaN(numValue)) {
      emit('update:value', Math.max(1, Math.min(30, numValue)));
    }
  }

  function increment() {
    if (props.value < 30) {
      emit('update:value', props.value + 1);
    }
  }

  function decrement() {
    if (props.value > 1) {
      emit('update:value', props.value - 1);
    }
  }
</script>

<template>
  <FieldsetLabel
    ref="root"
    :label="displayLabel"
    :aria-label="label"
    center
    class="group relative h-14 border-muted bg-default/20 transition-colors"
    :class="containerClass"
    @click.left.exact.prevent="handleRoll"
  >
    <!-- Модификатор (крупно) -->
    <div class="flex items-center justify-center px-2 pb-2">
      <div
        class="text-xl font-bold"
        :class="modifierClass"
      >
        {{ formattedModifier }}
      </div>
    </div>

    <!--
      Образец для замера: то же начертание, что и у legend, но вне потока и
      невидимый. Даёт ширину полного названия независимо от того, какое из
      двух названий сейчас показано, — иначе замер зацикливался бы сам на себе.
    -->
    <span
      ref="labelProbe"
      aria-hidden="true"
      class="pointer-events-none invisible absolute top-0 left-0 text-[10px] font-bold tracking-wider whitespace-nowrap uppercase"
      >{{ label }}</span
    >

    <!-- Значение (в овале снизу) -->
    <div
      class="absolute -bottom-2 left-1/2 flex h-5 -translate-x-1/2 items-center gap-0.5 rounded-full border border-muted bg-elevated px-1 shadow-sm transition-colors"
      :class="[
        isEditMode
          ? 'w-[calc(100%-8px)] group-hover:border-accented'
          : 'min-w-10 px-2 group-hover:border-primary/50',
      ]"
    >
      <template v-if="isEditMode">
        <button
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs text-muted transition-colors hover:bg-accented/50 hover:text-highlighted"
          @click.left.exact.prevent="decrement"
        >
          −
        </button>

        <input
          :value="value"
          type="number"
          min="1"
          max="30"
          class="min-w-0 flex-1 [appearance:textfield] bg-transparent text-center text-[10px] font-bold text-highlighted tabular-nums outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          @input="handleInput"
        />

        <UTooltip v-if="hasBonus">
          <span
            class="shrink-0 text-[9px] leading-none font-bold tabular-nums"
            :class="bonusColorClass"
            >{{ formattedBonus }}</span
          >

          <template #content>
            <div class="flex flex-col gap-1 px-1 py-0.5 text-[11px]">
              <div
                v-for="(row, index) in tooltipRows"
                :key="index"
                class="flex items-center gap-3 whitespace-nowrap"
                :class="
                  row.kind === 'total'
                    ? 'border-t border-muted/30 pt-1 font-semibold'
                    : ''
                "
              >
                <span :class="row.kind === 'bonus' ? 'text-toned' : ''"
                  >{{ row.label }}:</span
                >

                <span
                  class="ml-auto tabular-nums"
                  :class="
                    row.kind === 'bonus' ? bonusColorClass : 'text-highlighted'
                  "
                  >{{ row.value }}</span
                >
              </div>
            </div>
          </template>
        </UTooltip>

        <button
          class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-xs text-muted transition-colors hover:bg-accented/50 hover:text-highlighted"
          @click.left.exact.prevent="increment"
        >
          +
        </button>
      </template>

      <!-- Режим просмотра: итоговое значение, разбивка в тултипе -->
      <template v-else>
        <UTooltip v-if="hasBonus">
          <span
            class="w-full text-center text-[9px] leading-none font-bold tabular-nums"
            :class="bonusColorClass"
            >{{ value }}</span
          >

          <template #content>
            <div class="flex flex-col gap-1 px-1 py-0.5 text-[11px]">
              <div
                v-for="(row, index) in tooltipRows"
                :key="index"
                class="flex items-center gap-3 whitespace-nowrap"
                :class="
                  row.kind === 'total'
                    ? 'border-t border-muted/30 pt-1 font-semibold'
                    : ''
                "
              >
                <span :class="row.kind === 'bonus' ? 'text-toned' : ''"
                  >{{ row.label }}:</span
                >

                <span
                  class="ml-auto tabular-nums"
                  :class="
                    row.kind === 'bonus' ? bonusColorClass : 'text-highlighted'
                  "
                  >{{ row.value }}</span
                >
              </div>
            </div>
          </template>
        </UTooltip>

        <span
          v-else
          class="w-full text-center text-[9px] leading-none font-bold text-highlighted"
          >{{ value }}</span
        >
      </template>
    </div>
  </FieldsetLabel>
</template>
