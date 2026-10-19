<script setup lang="ts">
  import type {
    SneakAttackOptionChip,
    SneakAttackPanelState,
  } from './sneakAttackPanel';

  import { computed } from 'vue';

  import {
    DICE_ROLL_LABELS,
    SNEAK_ATTACK_OPTION_CHIP_STYLES,
    SNEAK_ATTACK_PANEL_ICONS,
  } from './constants';

  /**
   * Плашка Скрытой атаки в окне атаки: идёт ли она в этот бросок и сколько
   * костей добавит к урону, а под ней — приёмы Хитрого удара чипами.
   *
   * Отказ — выбор игрока по правилам: переключатель стоит на самой плашке, а
   * состояние дублируется словами («активна» / «не активна» и почему).
   * Описание приёма — в подсказке по наведению: в окне оно растягивало блок
   * на полэкрана.
   */
  const props = defineProps<{
    /** Состояние плашки */
    state: SneakAttackPanelState;
    /** Кости, что пойдут к урону после цены приёмов: «3к6» */
    diceLabel: string;
    /** Чья она, если не сама «Скрытая атака» плута; иначе пусто */
    sourceName: string;
    /** Строка «Смертельного удара»; пусто — её нет */
    doubleSaveLabel: string;
    /** Приёмы Хитрого удара и эффекты по выбору */
    options: SneakAttackOptionChip[];
    /** Сколько приёмов Хитрого удара можно взять за удар */
    cunningStrikeLimit: number;
  }>();

  const emit = defineEmits<{
    /** Игрок добавил Скрытую атаку или отказался от неё */
    'update:applied': [applied: boolean];
    /** Игрок отметил приём или снял отметку */
    'toggle-option': [optionId: string];
  }>();

  /** Кости идут к урону */
  const isActive = computed(() => props.state === 'active');

  /** Добавить или отказаться можно, только пока условие выполнено */
  const canToggle = computed(
    () => props.state === 'active' || props.state === 'declined',
  );

  // Активную плашку выделяет рамка, а не заливка: яркий фон спорил с
  // кнопками окна
  const panelClass = computed(() =>
    isActive.value ? 'border-success/30' : 'border-default',
  );

  const badgeLabel = computed(() => {
    switch (props.state) {
      case 'active':
        return DICE_ROLL_LABELS.sneakAttackActive;
      case 'declined':
        return DICE_ROLL_LABELS.sneakAttackDeclinedBadge;
      default:
        return DICE_ROLL_LABELS.sneakAttackInactive;
    }
  });

  const badgeColor = computed(() => (isActive.value ? 'success' : 'neutral'));

  /** Главная строка под заголовком: что будет с уроном либо почему ничего */
  const statusText = computed(() => {
    switch (props.state) {
      case 'active':
        return `+${props.diceLabel}${DICE_ROLL_LABELS.sneakAttackDamageSuffix}`;
      case 'declined':
        return DICE_ROLL_LABELS.sneakAttackDeclinedText;
      case 'spent':
        return DICE_ROLL_LABELS.sneakAttackSpent;
      default:
        return DICE_ROLL_LABELS.sneakAttackUnavailableText;
    }
  });

  const statusClass = computed(() =>
    isActive.value ? 'text-base font-semibold text-success' : 'text-toned',
  );

  /** Приёмы видны, только пока кости идут к урону: платить больше нечем */
  const visibleOptions = computed(() => (isActive.value ? props.options : []));

  const hasCunningStrike = computed(() =>
    visibleOptions.value.some((option) => option.cunningStrike),
  );

  const optionsTitle = computed(() =>
    hasCunningStrike.value
      ? DICE_ROLL_LABELS.cunningStrikeTitle
      : DICE_ROLL_LABELS.sneakAttackOptionsTitle,
  );

  /** Сколько приёмов Хитрого удара уже выбрано */
  const pickedCount = computed(
    () =>
      visibleOptions.value.filter(
        (option) => option.cunningStrike && option.selected,
      ).length,
  );

  /** «выбрано 1 из 2» — лимит приёмов Хитрого удара за удар */
  const pickedCountLabel = computed(
    () =>
      `${DICE_ROLL_LABELS.cunningStrikePickedPrefix}${pickedCount.value}${DICE_ROLL_LABELS.cunningStrikePickedSeparator}${props.cunningStrikeLimit}`,
  );

  /** Лимит выбран целиком — счётчик подсвечен */
  const pickedCountColor = computed(() =>
    pickedCount.value >= props.cunningStrikeLimit ? 'primary' : 'neutral',
  );

  /** Чипы приёмов с видом кнопки: выбранный — залитый, с галочкой */
  const optionChips = computed(() =>
    visibleOptions.value.map((option) => ({
      ...option,
      ...SNEAK_ATTACK_OPTION_CHIP_STYLES[pickChipStyle(option)],
      // Причина серого приёма — первой строкой подсказки, над описанием
      tooltipReason: option.disabled ? option.reason : '',
    })),
  );

  /**
   * Почему серые приёмы серые — строками под чипами. Лимит приёмов за удар
   * виден по счётчику, поэтому его причина живёт только в подсказке.
   */
  const reasonLines = computed(() =>
    visibleOptions.value
      .filter(
        (option) =>
          option.disabled
          && option.reason
          && option.reason !== DICE_ROLL_LABELS.sneakAttackOptionLimit,
      )
      .map((option) => ({
        id: option.id,
        text: `${option.label}${DICE_ROLL_LABELS.sneakAttackOptionReasonSeparator}${option.reason}`,
      })),
  );

  /**
   * Вид чипа: выбранный, доступный или серый.
   *
   * @param option - приём
   * @returns ключ вида
   */
  function pickChipStyle(
    option: SneakAttackOptionChip,
  ): keyof typeof SNEAK_ATTACK_OPTION_CHIP_STYLES {
    if (option.selected) {
      return 'selected';
    }

    return option.disabled ? 'blocked' : 'idle';
  }

  /**
   * Переключатель плашки: игрок добавляет Скрытую атаку или отказывается.
   *
   * @param applied - добавлять ли кости в этом броске
   */
  function setApplied(applied: boolean): void {
    emit('update:applied', applied);
  }

  /**
   * Отмечает приём или снимает отметку.
   *
   * @param optionId - id приёма
   */
  function toggleOption(optionId: string): void {
    emit('toggle-option', optionId);
  }
</script>

<template>
  <div
    class="space-y-2.5 rounded-lg border bg-elevated/50 p-3"
    :class="panelClass"
  >
    <div class="flex items-start gap-2.5">
      <div class="min-w-0 flex-1 space-y-0.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-sm font-semibold text-highlighted">
            {{ DICE_ROLL_LABELS.sneakAttack }}
          </span>

          <UBadge
            :color="badgeColor"
            variant="soft"
            size="sm"
          >
            {{ badgeLabel }}
          </UBadge>

          <UTooltip
            v-if="state === 'unavailable'"
            :ui="{ content: 'h-auto max-w-72 py-1.5' }"
          >
            <UIcon
              :name="SNEAK_ATTACK_PANEL_ICONS.hint"
              class="size-3.5 shrink-0 cursor-help text-dimmed transition-colors hover:text-default"
            />

            <template #content>
              <span class="whitespace-normal">
                {{ DICE_ROLL_LABELS.sneakAttackUnavailableHint }}
              </span>
            </template>
          </UTooltip>
        </div>

        <p
          class="text-sm"
          :class="statusClass"
        >
          {{ statusText }}
        </p>

        <p
          v-if="sourceName"
          class="text-xs text-muted"
        >
          {{ sourceName }}
        </p>
      </div>

      <USwitch
        v-if="canToggle"
        :model-value="isActive"
        color="success"
        class="mt-0.5 shrink-0"
        :aria-label="DICE_ROLL_LABELS.sneakAttack"
        @update:model-value="setApplied"
      />
    </div>

    <p
      v-if="isActive && doubleSaveLabel"
      class="flex items-start gap-1.5 text-xs text-warning"
    >
      <UIcon
        :name="SNEAK_ATTACK_PANEL_ICONS.doubleSave"
        class="mt-px size-3.5 shrink-0"
      />

      <span>{{ doubleSaveLabel }}</span>
    </p>

    <!-- Хитрый удар: приёмы платят костями Скрытой атаки до броска -->
    <div
      v-if="visibleOptions.length > 0"
      class="space-y-2 border-t border-success/20 pt-2.5"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs tracking-wider text-muted uppercase">
          {{ optionsTitle }}
        </span>

        <UBadge
          v-if="hasCunningStrike"
          :color="pickedCountColor"
          variant="subtle"
          size="sm"
        >
          {{ pickedCountLabel }}
        </UBadge>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <UTooltip
          v-for="option in optionChips"
          :key="option.id"
          :delay-duration="300"
          :ui="{ content: 'h-auto max-w-72 py-1.5' }"
        >
          <!-- Обёртка ловит наведение: у выключенной кнопки событий мыши нет -->
          <span class="inline-flex">
            <UButton
              :label="option.label"
              :icon="option.icon"
              :color="option.color"
              :variant="option.variant"
              :disabled="option.disabled"
              size="sm"
              @click.left.exact.prevent="toggleOption(option.id)"
            />
          </span>

          <template #content>
            <span class="whitespace-normal">
              <span
                v-if="option.tooltipReason"
                class="block font-medium first-letter:uppercase"
              >
                {{ option.tooltipReason }}
              </span>

              {{ option.hint }}
            </span>
          </template>
        </UTooltip>
      </div>

      <ul
        v-if="reasonLines.length > 0"
        class="space-y-0.5"
      >
        <li
          v-for="line in reasonLines"
          :key="line.id"
          class="text-xs text-dimmed"
        >
          {{ line.text }}
        </li>
      </ul>
    </div>
  </div>
</template>
