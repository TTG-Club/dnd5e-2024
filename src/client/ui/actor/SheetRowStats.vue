<script setup lang="ts">
  import type { SheetRowStat } from './sheetRowTypes';

  import { computed } from 'vue';

  import { SHEET_ROLL_HINT_LABEL } from './constants';

  /** Плитка параметра с уже разрешёнными классами оформления */
  interface DecoratedStat {
    key: string;
    label: string;
    value: string;
    tooltip: string;
    rollable: boolean;
    containerClass: string;
    valueClass: string;
    labelClass: string;
  }

  interface Props {
    /** Плитки параметров в порядке показа */
    stats: SheetRowStat[];
    /** Подпись нажимаемой плитки для скринридера */
    rollAriaLabel?: string;
  }

  /** Классы плитки боевого параметра (атака, урон, КД) */
  const ACCENT_STAT_CLASSES = {
    container: 'border-primary/40 bg-primary/10',
    value: 'text-primary',
    label: 'text-primary/80',
  };

  /** Классы справочной плитки (цена, вес) */
  const PLAIN_STAT_CLASSES = {
    container: 'border-default/50 bg-default/40',
    value: 'text-highlighted',
    label: 'text-dimmed',
  };

  /** Добавка нажимаемой плитки: под курсором она теплеет, как кнопка */
  const ROLL_STAT_CLASS =
    'cursor-pointer hover:border-primary hover:bg-primary/20';

  /**
   * Раскладка плитки: на второй строке узкой карточки плитки делят свободное
   * место поровну (`basis-0`), на широкой остаются по содержимому — растягивать
   * там нечего. `whitespace-nowrap` держит нижнюю границу ширины: без него
   * плитка сжималась бы до самого длинного слова и «2к6+5» переносилось бы.
   */
  const STAT_LAYOUT_CLASSES =
    'flex shrink-0 grow basis-0 flex-col items-center rounded border px-2 py-0.5 whitespace-nowrap @xl:grow-0 @xl:basis-auto';

  /**
   * Дополняет плитку классами оформления — логика не должна жить в шаблоне.
   *
   * @param stat - исходная плитка параметра
   * @returns плитка с разрешёнными классами и подсказкой
   */
  function decorateStat(stat: SheetRowStat): DecoratedStat {
    const classes = stat.accent ? ACCENT_STAT_CLASSES : PLAIN_STAT_CLASSES;
    const tooltip = stat.tooltip ?? '';
    const rollable = Boolean(stat.rollable);

    return {
      key: stat.key,
      label: stat.label,
      value: stat.value,
      tooltip: rollable
        ? [tooltip, SHEET_ROLL_HINT_LABEL].filter(Boolean).join(' · ')
        : tooltip,
      rollable,
      containerClass: rollable
        ? `${classes.container} ${ROLL_STAT_CLASS}`
        : classes.container,
      valueClass: classes.value,
      labelClass: classes.label,
    };
  }

  const props = withDefaults(defineProps<Props>(), {
    rollAriaLabel: '',
  });

  const emit = defineEmits<{
    /** Нажата плитка с броском */
    roll: [stat: SheetRowStat];
  }>();

  const displayStats = computed<DecoratedStat[]>(() =>
    props.stats.map(decorateStat),
  );

  /**
   * Отдаёт наверх исходную плитку, а не разрисованную: строке нужен ключ и
   * значение, а классы — дело показа.
   *
   * @param index - место плитки в ряду
   */
  function handleRoll(index: number): void {
    const stat = props.stats[index];

    if (stat) {
      emit('roll', stat);
    }
  }
</script>

<template>
  <!-- Плитки переносятся внутри своей группы, поэтому `shrink-0` ей нельзя:
    иначе группа осталась бы шириной во все плитки в строку и растянула бы
    карточку. Слой z-10 поднимает её над подложкой названия, накрывающей всю
    строку: под подложкой плитки не получали бы наведения, и их расшифровки не
    открывались бы -->
  <div
    v-if="displayStats.length"
    class="relative z-10 flex grow flex-wrap items-center gap-1.5 @xl:grow-0"
  >
    <UTooltip
      v-for="(stat, index) in displayStats"
      :key="stat.key"
      :text="stat.tooltip"
      :disabled="!stat.tooltip"
    >
      <!-- Плитка с броском — кнопка: атака и урон катят свою формулу -->
      <button
        v-if="stat.rollable"
        type="button"
        class="transition-colors"
        :class="[STAT_LAYOUT_CLASSES, stat.containerClass]"
        :aria-label="rollAriaLabel"
        @click.left.exact.prevent.stop="handleRoll(index)"
      >
        <span
          class="text-xs font-bold"
          :class="stat.valueClass"
        >
          {{ stat.value }}
        </span>

        <span
          class="text-[9px] uppercase"
          :class="stat.labelClass"
        >
          {{ stat.label }}
        </span>
      </button>

      <div
        v-else
        :class="[STAT_LAYOUT_CLASSES, stat.containerClass]"
      >
        <span
          class="text-xs font-bold"
          :class="stat.valueClass"
        >
          {{ stat.value }}
        </span>

        <span
          class="text-[9px] uppercase"
          :class="stat.labelClass"
        >
          {{ stat.label }}
        </span>
      </div>
    </UTooltip>
  </div>
</template>
