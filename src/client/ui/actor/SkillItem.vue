<script setup lang="ts">
  import type { AbilityType, ProficiencyLevel, SkillType } from '@vtt/shared';

  import { computed } from 'vue';

  import { PASSIVE_SKILL_BASE } from '@vtt/shared/system/dnd.js';

  import {
    ABILITY_SHORT_LABELS,
    HIGHLIGHTED_SKILL_ROW_CLASS,
    SKILL_SETTINGS_LABELS,
  } from './constants';
  import ProficiencyIndicator from './ProficiencyIndicator.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    label: string;
    /** Ключ навыка правил; не задан — навык заведён игроком */
    skillKey?: SkillType;
    /**
     * Характеристика расчёта: в настройке навыков её подменяют, поэтому
     * приходит готовой, а не выводится из ключа навыка.
     */
    ability: AbilityType;
    proficiencyLevel: ProficiencyLevel;
    modifier: number;
    isEditMode: boolean;
    /** Навык заведён игроком: рядом с названием стоит пометка */
    isCustom?: boolean;
    /** Разбор значения для подсказки; пусто — навык считается по правилам */
    valueHint?: string;
    /**
     * Не показывать сокращение характеристики: с группировкой её называет
     * разделитель, и в строках она не повторяется.
     */
    hideAbility?: boolean;
    /** Строка связана с наведённой характеристикой: она подсвечена */
    isHighlighted?: boolean;
    /** Наведена та самая характеристика навыка: её сокращение горит тёплым */
    isAbilityHighlighted?: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'cycle-proficiency': [];
    'roll': [modifier: number, label: string, key?: SkillType];
  }>();

  const attributeShortName = computed(
    () => ABILITY_SHORT_LABELS[props.ability] || '',
  );

  const modifier = computed(() => props.modifier);

  const formattedModifier = computed(() => formatSignedNumber(modifier.value));

  /** Значок владения: без владения приглушён, с владением горит тёплым */
  const proficiencyClass = computed(() =>
    props.proficiencyLevel === 'none' ? 'text-muted' : 'text-primary',
  );

  /** Строка навыка наведённой характеристики: мягкая заливка и обводка */
  const rowClass = computed(() =>
    props.isHighlighted ? HIGHLIGHTED_SKILL_ROW_CLASS : undefined,
  );

  /** Сокращение характеристики: горит только у своей же наведённой */
  const abilityLabelClass = computed(() =>
    props.isAbilityHighlighted ? 'text-primary' : 'text-dimmed',
  );

  function handleClick() {
    if (!props.isEditMode) {
      emit('roll', modifier.value, props.label, props.skillKey);
    }
  }
</script>

<template>
  <div
    class="group flex cursor-pointer items-center justify-between rounded px-2 py-1.5 transition-colors hover:bg-accented/30"
    :class="rowClass"
    @click.left.exact.prevent="handleClick"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2.5">
      <!-- Индикатор владения (4 состояния) -->
      <ProficiencyIndicator
        :level="proficiencyLevel"
        :disabled="!isEditMode"
        :class="proficiencyClass"
        @cycle="emit('cycle-proficiency')"
      />

      <!-- Сокращение характеристики -->
      <span
        v-if="!hideAbility"
        class="w-6 shrink-0 text-[10px] font-bold tracking-wider uppercase transition-colors"
        :class="abilityLabelClass"
        >{{ attributeShortName }}</span
      >

      <span class="truncate text-sm font-medium text-toned">{{ label }}</span>

      <span
        v-if="isCustom"
        class="shrink-0 rounded border border-primary/40 px-1 text-[9px] font-bold tracking-wider text-primary uppercase"
        >{{ SKILL_SETTINGS_LABELS.customBadge }}</span
      >
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <!-- Модификатор. Навык не по правилам не сходится с характеристикой
        строки: пунктир зовёт навести и прочитать разбор -->
      <UTooltip
        v-if="valueHint"
        :text="valueHint"
        :delay-duration="300"
      >
        <span
          class="w-6 text-right text-sm font-bold text-highlighted underline decoration-dotted underline-offset-2"
          >{{ formattedModifier }}</span
        >
      </UTooltip>

      <span
        v-else
        class="w-6 text-right text-sm font-bold text-highlighted"
        >{{ formattedModifier }}</span
      >

      <!-- Пассивное значение (10 + модификатор) -->
      <span class="w-5 text-right text-xs font-semibold text-dimmed">{{
        PASSIVE_SKILL_BASE + modifier
      }}</span>
    </div>
  </div>
</template>
