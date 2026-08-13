<script setup lang="ts">
  /**
   * Настройка одной характеристики: свои бонусы к её значению.
   *
   * Бонус идёт в само значение, а не в модификатор, — так же работают предметы
   * и активные эффекты. Поэтому предпросмотр показывает и итоговое значение, и
   * модификатор от него: прибавка +2 к 15 даёт 17 и модификатор +3, и это надо
   * видеть до того, как окно закрыли.
   *
   * Само число листа окно не правит: его меняют кнопками в овале плитки.
   */
  import type { AbilityType } from '@vtt/shared';
  import type {
    DnDCustomBonus,
    DnDCustomBonusContext,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    calculateAbilityModifier,
    getCustomBonusesValue,
    getCustomBonusValue,
    toStoredCustomBonus,
  } from '@vtt/shared/system/dnd.js';

  import {
    ABILITY_LABELS,
    ABILITY_SETTINGS_LABELS,
    CUSTOM_BONUS_LABELS,
    MODAL_BUTTON_LABELS,
  } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Характеристика, которую настраивают */
    ability: AbilityType;
    /** Число, записанное в самом листе */
    sheetValue: number;
    /** Вклад активных эффектов в значение характеристики */
    effectsBonus: number;
    /**
     * Значение задано активным эффектом целиком: свои бонусы в него не идут,
     * пока эффект держится.
     */
    isOverridden?: boolean;
    /** Свои бонусы к значению характеристики */
    bonuses?: DnDCustomBonus[];
    /**
     * Числа листа, от которых считается вклад бонусов. Это числа ДО прибавок к
     * характеристикам — от них считает и расчёт листа.
     */
    context: DnDCustomBonusContext;
  }

  const props = withDefaults(defineProps<Props>(), {
    isOverridden: false,
    bonuses: () => [],
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [data: { ability: AbilityType; bonuses: DnDCustomBonus[] }];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftBonuses = ref<DnDCustomBonus[]>([]);

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        // Копии, а не сами бонусы листа: окно живёт до «Применить», и его
        // правки не должны менять лист раньше времени
        draftBonuses.value = props.bonuses.map((bonus) => ({ ...bonus }));
      }
    },
  );

  const title = computed(
    () =>
      `${ABILITY_SETTINGS_LABELS.titlePrefix}${ABILITY_LABELS[props.ability]}`,
  );

  /** Вклад своих бонусов черновика */
  const bonusesValue = computed(() =>
    getCustomBonusesValue(props.context, draftBonuses.value),
  );

  /** Итоговое значение характеристики с правками окна */
  const previewValue = computed(
    () =>
      props.sheetValue
      + props.effectsBonus
      // Под перезаписью эффектом прибавки не идут никуда: показывать их в
      // итоге значило бы обещать число, которого на листе не будет
      + (props.isOverridden ? 0 : bonusesValue.value),
  );

  const previewModifier = computed(() =>
    formatSignedNumber(calculateAbilityModifier(previewValue.value)),
  );

  /** Разбор итога: из чего сложилось значение характеристики */
  const previewDetails = computed(() => {
    const parts = [`${ABILITY_SETTINGS_LABELS.sheetValue} ${props.sheetValue}`];

    if (props.effectsBonus !== 0) {
      parts.push(
        `${ABILITY_SETTINGS_LABELS.effects} ${formatSignedNumber(
          props.effectsBonus,
        )}`,
      );
    }

    for (const bonus of draftBonuses.value) {
      const label = bonus.label.trim() || CUSTOM_BONUS_LABELS.unnamed;

      parts.push(
        `${label} ${formatSignedNumber(
          getCustomBonusValue(props.context, bonus),
        )}`,
      );
    }

    return parts.join(' · ');
  });

  function applyChanges(): void {
    emit('apply', {
      ability: props.ability,
      bonuses: draftBonuses.value.map(toStoredCustomBonus),
    });

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="420"
    :min-height="240"
    :title="title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Свои бонусы -->
        <div class="space-y-3">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ ABILITY_SETTINGS_LABELS.bonusesTitle }}
          </span>

          <CustomBonusRows
            v-model="draftBonuses"
            :context="context"
          />

          <p class="text-xs leading-relaxed text-dimmed">
            {{ ABILITY_SETTINGS_LABELS.bonusesHint }}
          </p>

          <p
            v-if="isOverridden"
            class="text-xs leading-relaxed text-warning"
          >
            {{ ABILITY_SETTINGS_LABELS.overriddenHint }}
          </p>
        </div>

        <!-- Предпросмотр: значение и модификатор от него -->
        <div class="rounded-lg bg-elevated/50 p-3 text-center">
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ ABILITY_SETTINGS_LABELS.total }}
          </span>

          <div class="mt-1 flex items-center justify-center gap-3">
            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ previewValue }}
            </span>

            <span class="h-6 w-px bg-default/60" />

            <span class="text-sm text-muted">
              {{ ABILITY_SETTINGS_LABELS.modifier }}
            </span>

            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ previewModifier }}
            </span>
          </div>

          <div class="mt-1 text-xs text-dimmed">
            {{ previewDetails }}
          </div>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applyChanges"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
