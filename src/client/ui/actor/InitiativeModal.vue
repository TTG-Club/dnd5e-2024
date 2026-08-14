<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type {
    DnDCustomBonus,
    DnDCustomBonusContext,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    ABILITY_LABELS,
    ABILITY_OPTIONS,
    calculateAbilityModifier,
    getCustomBonusesValue,
    getCustomBonusValue,
    toStoredCustomBonus,
  } from '@vtt/shared/system/dnd.js';

  import {
    CUSTOM_BONUS_LABELS,
    INITIATIVE_SETTINGS_LABELS,
    MODAL_BUTTON_LABELS,
  } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Текущий бонус инициативы */
    initiativeBonus: number;
    /** Текущая характеристика инициативы */
    initiativeAbility: AbilityType;
    /** Значения всех характеристик для предпросмотра */
    abilityScores: Record<AbilityType, number>;
    /** Свои бонусы к инициативе */
    bonuses?: DnDCustomBonus[];
    /** Числа листа, от которых считается вклад своих бонусов */
    context: DnDCustomBonusContext;
  }

  const props = withDefaults(defineProps<Props>(), { bonuses: () => [] });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [
      data: {
        initiativeBonus: number;
        initiativeAbility: AbilityType;
        bonuses: DnDCustomBonus[];
      },
    ];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const editAbility = ref<AbilityType>('dexterity');
  const editBonus = ref(0);
  const draftBonuses = ref<DnDCustomBonus[]>([]);

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        editAbility.value = props.initiativeAbility ?? 'dexterity';
        editBonus.value = props.initiativeBonus ?? 0;

        // Копии, а не сами бонусы листа: окно живёт до «Применить», и его
        // правки не должны менять лист раньше времени
        draftBonuses.value = props.bonuses.map((bonus) => ({ ...bonus }));
      }
    },
  );

  const selectedAbilityLabel = computed(
    () => ABILITY_LABELS[editAbility.value],
  );

  const abilityMod = computed(() => {
    return calculateAbilityModifier(
      props.abilityScores[editAbility.value] ?? 10,
    );
  });

  /** Вклад своих бонусов черновика */
  const bonusesValue = computed(() =>
    getCustomBonusesValue(props.context, draftBonuses.value),
  );

  const previewTotal = computed(
    () => abilityMod.value + editBonus.value + bonusesValue.value,
  );

  const previewFormatted = computed(() =>
    formatSignedNumber(previewTotal.value),
  );

  const previewDetails = computed(() => {
    const parts = [
      `${selectedAbilityLabel.value} ${formatSignedNumber(abilityMod.value)}`,
    ];

    if (editBonus.value !== 0) {
      parts.push(
        `${INITIATIVE_SETTINGS_LABELS.flatBonus} ${formatSignedNumber(editBonus.value)}`,
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

  function applyChanges() {
    emit('apply', {
      initiativeBonus: editBonus.value,
      initiativeAbility: editAbility.value,
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
    :min-width="440"
    :min-height="240"
    :title="INITIATIVE_SETTINGS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Характеристика -->
        <div class="flex items-center gap-3">
          <span class="w-32 text-sm text-toned">
            {{ INITIATIVE_SETTINGS_LABELS.ability }}
          </span>

          <USelect
            v-model="editAbility"
            :items="ABILITY_OPTIONS"
            value-key="value"
            label-key="label"
            class="flex-1"
          />
        </div>

        <!-- Бонус -->
        <div class="flex items-center gap-3">
          <span class="w-32 text-sm text-toned">
            {{ INITIATIVE_SETTINGS_LABELS.flatBonus }}
          </span>

          <UInput
            v-model.number="editBonus"
            type="number"
            size="sm"
            class="flex-1"
            placeholder="0"
          />
        </div>

        <!-- Свои бонусы -->
        <div class="space-y-3">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ INITIATIVE_SETTINGS_LABELS.bonusesTitle }}
          </span>

          <CustomBonusRows
            v-model="draftBonuses"
            :context="context"
          />

          <p class="text-xs leading-relaxed text-dimmed">
            {{ INITIATIVE_SETTINGS_LABELS.bonusesHint }}
          </p>
        </div>

        <!-- Предпросмотр -->
        <div class="rounded-lg bg-elevated/50 p-3 text-center">
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ INITIATIVE_SETTINGS_LABELS.total }}
          </span>

          <div class="mt-1 text-2xl font-bold text-highlighted">
            {{ previewFormatted }}
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
