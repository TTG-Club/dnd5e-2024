<script setup lang="ts">
  import type { SheetRowStat } from './sheetRowTypes';

  import { computed } from 'vue';

  import {
    SHEET_ROLL_HINT_LABEL,
    SHEET_ROW_TOOLTIP_LINE_BREAK,
  } from './constants';

  /** Плитка параметра с уже разрешёнными классами оформления */
  interface DecoratedStat {
    key: string;
    label: string;
    value: string;
    /** Значок рядом со значением */
    icon?: string;
    /** Строки подсказки: перенос строки в `tooltip` плитки разбивает её */
    tooltipLines: string[];
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
   * Подсказка идёт строками: длинная расшифровка («основной урон, или другой,
   * если…») в одну строку растягивается во весь экран.
   *
   * @param stat - исходная плитка параметра
   * @returns плитка с разрешёнными классами и подсказкой
   */
  function decorateStat(stat: SheetRowStat): DecoratedStat {
    const classes = stat.accent ? ACCENT_STAT_CLASSES : PLAIN_STAT_CLASSES;
    const rollable = Boolean(stat.rollable);

    const lines = (stat.tooltip ?? '')
      .split(SHEET_ROW_TOOLTIP_LINE_BREAK)
      .filter((line) => line.length > 0);

    return {
      key: stat.key,
      label: stat.label,
      value: stat.value,
      icon: stat.icon,
      tooltipLines: rollable ? [...lines, SHEET_ROLL_HINT_LABEL] : lines,
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
      :disabled="stat.tooltipLines.length === 0"
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
          class="flex items-center gap-0.5 text-xs font-bold"
          :class="stat.valueClass"
        >
          {{ stat.value }}

          <UIcon
            v-if="stat.icon"
            :name="stat.icon"
            class="size-3"
          />
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
          class="flex items-center gap-0.5 text-xs font-bold"
          :class="stat.valueClass"
        >
          {{ stat.value }}

          <UIcon
            v-if="stat.icon"
            :name="stat.icon"
            class="size-3"
          />
        </span>

        <span
          class="text-[9px] uppercase"
          :class="stat.labelClass"
        >
          {{ stat.label }}
        </span>
      </div>

      <template #content>
        <div class="flex flex-col gap-0.5">
          <span
            v-for="(line, lineIndex) in stat.tooltipLines"
            :key="lineIndex"
          >
            {{ line }}
          </span>
        </div>
      </template>
    </UTooltip>
  </div>
</template>
