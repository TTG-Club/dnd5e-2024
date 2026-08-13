<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type { DnDActor } from '@vtt/shared/system/dnd.js';

  import { computed, ref, toRef, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    ABILITY_OPTIONS,
    SPELL_SAVE_DC_BASE,
  } from '@vtt/shared/system/dnd.js';

  import {
    FORM_FIELD_LABELS,
    MODAL_BUTTON_LABELS,
    SPELLCASTING_SETTINGS_LABELS,
  } from './constants';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    actor: DnDActor;
    /** Модификаторы характеристик с учётом эффектов — для предпросмотра */
    abilityMods: Record<AbilityType, number>;
    /** {{ SPELLCASTING_SETTINGS_LABELS.proficiency }} актёра */
    proficiencyBonus: number;
    /** Прибавка к Сл спасброска от активных эффектов */
    saveDcEffectBonus: number;
    /** Прибавка к бонусу атаки заклинанием от активных эффектов */
    attackEffectBonus: number;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'update:actor': [updates: Partial<DnDActor>];
  }>();

  /** Значение варианта «по классу» в выборе характеристики */
  const ABILITY_AUTO = 'auto';

  /** Выбор характеристики: своя либо «по классу» */
  type AbilityChoice = AbilityType | typeof ABILITY_AUTO;

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const actorRef = toRef(props, 'actor');

  const draftAbility = ref<AbilityChoice>(ABILITY_AUTO);

  /**
   * Черновик заводится при открытии: окно живёт во вкладке постоянно, и без
   * этого «Отмена» не отличалась бы от «Применить».
   */
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        draftAbility.value =
          actorRef.value.system?.spellcastingAbility ?? ABILITY_AUTO;
      }
    },
    { immediate: true },
  );

  /** Характеристика из первого заклинательного класса (режим «по классу») */
  const classAbility = computed<AbilityType | null>(() => {
    const casterClass = actorRef.value.system?.classes?.find(
      (entry) => entry.spellcastingAbility != null,
    );

    return casterClass?.spellcastingAbility ?? null;
  });

  /** Характеристика, по которой считается предпросмотр */
  const effectiveAbility = computed<AbilityType | null>(() =>
    draftAbility.value === ABILITY_AUTO
      ? classAbility.value
      : draftAbility.value,
  );

  /** Название характеристики для строки разбора */
  function abilityLabel(ability: AbilityType): string {
    return (
      ABILITY_OPTIONS.find((option) => option.value === ability)?.label
      ?? ability
    );
  }

  const options = computed<Array<{ value: AbilityChoice; label: string }>>(
    () => [
      {
        value: ABILITY_AUTO,
        label: classAbility.value
          ? `${SPELLCASTING_SETTINGS_LABELS.autoByClassPrefix}${abilityLabel(classAbility.value)}${SPELLCASTING_SETTINGS_LABELS.autoByClassSuffix}`
          : SPELLCASTING_SETTINGS_LABELS.autoByClass,
      },
      ...ABILITY_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    ],
  );

  /** Модификатор выбранной характеристики; null — заклинательства нет */
  const abilityModifier = computed(() =>
    effectiveAbility.value
      ? (props.abilityMods[effectiveAbility.value] ?? 0)
      : null,
  );

  /**
   * Предпросмотр чисел заклинательства. Прибавки от эффектов входят в оба, иначе
   * окно расходилось бы с числами вкладки.
   */
  const preview = computed(() => {
    if (abilityModifier.value === null) {
      return { saveDc: '—', attack: '—' };
    }

    const base = props.proficiencyBonus + abilityModifier.value;

    return {
      saveDc: String(SPELL_SAVE_DC_BASE + base + props.saveDcEffectBonus),
      attack: formatSignedNumber(base + props.attackEffectBonus),
    };
  });

  /** Сохраняет выбранную характеристику и закрывает окно */
  function applySettings(): void {
    emit('update:actor', {
      system: {
        ...actorRef.value.system,
        spellcastingAbility:
          draftAbility.value === ABILITY_AUTO ? undefined : draftAbility.value,
      },
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
    :min-height="320"
    :title="SPELLCASTING_SETTINGS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-toned">
            {{ FORM_FIELD_LABELS.ability }}
          </span>

          <USelect
            v-model="draftAbility"
            :items="options"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-56 shrink-0"
          />
        </div>

        <p class="text-xs text-dimmed">
          <template v-if="classAbility">
            Определяется по классу: {{ abilityLabel(classAbility) }}.
          </template>

          <template v-else>
            {{ SPELLCASTING_SETTINGS_LABELS.noClassHint }}
          </template>
        </p>

        <div class="border-t border-muted" />

        <div class="flex items-center justify-between gap-4 text-sm">
          <span class="text-toned">{{
            SPELLCASTING_SETTINGS_LABELS.abilityMod
          }}</span>

          <span class="text-toned tabular-nums">
            <template v-if="effectiveAbility && abilityModifier !== null">
              {{ abilityLabel(effectiveAbility) }} ·
              {{ formatSignedNumber(abilityModifier) }}
            </template>

            <template v-else>—</template>
          </span>
        </div>

        <div class="flex items-center justify-between gap-4 text-sm">
          <span class="text-toned">{{
            SPELLCASTING_SETTINGS_LABELS.proficiency
          }}</span>

          <span class="text-toned tabular-nums">
            {{ formatSignedNumber(proficiencyBonus) }}
          </span>
        </div>

        <!-- Итоговые числа: то же, что показывает шапка вкладки -->
        <div class="grid grid-cols-2 gap-3">
          <div
            class="flex flex-col items-center gap-1 rounded-lg border border-default/50 bg-elevated/20 px-3 py-2"
          >
            <span
              class="text-center text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ SPELLCASTING_SETTINGS_LABELS.saveDC }}
            </span>

            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ preview.saveDc }}
            </span>
          </div>

          <div
            class="flex flex-col items-center gap-1 rounded-lg border border-default/50 bg-elevated/20 px-3 py-2"
          >
            <span
              class="text-center text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ SPELLCASTING_SETTINGS_LABELS.attack }}
            </span>

            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ preview.attack }}
            </span>
          </div>
        </div>

        <p class="text-xs leading-relaxed text-dimmed">
          {{ SPELLCASTING_SETTINGS_LABELS.formula }}
        </p>

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
            @click.left.exact.prevent="applySettings"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
