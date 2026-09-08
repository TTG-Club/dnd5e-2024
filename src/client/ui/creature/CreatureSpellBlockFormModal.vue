<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type {
    CreatureSpellcastingBlock,
    DnDCreature,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    ABILITY_OPTIONS,
    calculateCreatureSpellBlockNumbers,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS } from '../actor/constants';
  import { formatSignedNumber } from '../actor/utils/formatSignedNumber';
  import {
    CREATURE_SPELL_BLOCK_FORM_LABELS,
    CREATURE_SPELLCASTING_LABELS,
  } from './constants';

  interface Props {
    open: boolean;
    /** Правимый блок; без него окно ничего не показывает */
    block?: CreatureSpellcastingBlock;
    /** Существо-владелец: по нему считается предпросмотр чисел блока */
    creature?: DnDCreature;
  }

  const props = withDefaults(defineProps<Props>(), {
    block: undefined,
    creature: undefined,
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [block: CreatureSpellcastingBlock];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Значение «характеристика как у существа» в списке выбора */
  const ABILITY_INHERIT = 'inherit';

  /** Значение пустого числового поля: у блока Сл и бонус необязательны */
  const NUMBER_EMPTY = null;

  /**
   * Правка идёт по копии: до «Применить» блок существа не меняется — окно
   * закрывают и «Отменой».
   */
  const form = reactive<{
    name: string;
    ability: AbilityType | typeof ABILITY_INHERIT;
    saveDC: number | null;
    attackBonus: number | null;
    verbal: boolean;
    somatic: boolean;
    material: boolean;
    note: string;
  }>({
    name: '',
    ability: ABILITY_INHERIT,
    saveDC: NUMBER_EMPTY,
    attackBonus: NUMBER_EMPTY,
    verbal: false,
    somatic: false,
    material: false,
    note: '',
  });

  watch(
    () => [props.open, props.block] as const,
    ([opened, block]) => {
      if (!opened || !block) {
        return;
      }

      form.name = block.name;
      form.ability = block.ability ?? ABILITY_INHERIT;
      form.saveDC = block.saveDC ?? NUMBER_EMPTY;
      form.attackBonus = block.attackBonus ?? NUMBER_EMPTY;
      form.verbal = block.ignoredComponents?.verbal ?? false;
      form.somatic = block.ignoredComponents?.somatic ?? false;
      form.material = block.ignoredComponents?.material ?? false;
      form.note = block.note ?? '';
    },
    { immediate: true },
  );

  /** Список выбора характеристики: шесть характеристик и «как у существа» */
  const abilityOptions = computed(() => [
    {
      value: ABILITY_INHERIT,
      label: CREATURE_SPELL_BLOCK_FORM_LABELS.abilityInherit,
    },
    ...ABILITY_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ]);

  /**
   * Черновик в том же виде, в каком он ляжет в запись существа: по нему движок
   * считает предпросмотр теми же правилами, что и плитка блока на вкладке.
   */
  const draftBlock = computed<CreatureSpellcastingBlock | undefined>(() => {
    if (!props.block) {
      return undefined;
    }

    const note = form.note.trim();

    return {
      ...props.block,
      name: form.name.trim() || props.block.name,
      ability: form.ability === ABILITY_INHERIT ? undefined : form.ability,
      saveDC: form.saveDC ?? undefined,
      attackBonus: form.attackBonus ?? undefined,
      ignoredComponents: {
        verbal: form.verbal,
        somatic: form.somatic,
        material: form.material,
      },
      note: note || undefined,
    };
  });

  /** Предпросмотр итоговых чисел — тех же, что стоят в плитке блока */
  const preview = computed(() => {
    if (!props.creature || !draftBlock.value) {
      return {
        saveDC: CREATURE_SPELLCASTING_LABELS.none,
        attack: CREATURE_SPELLCASTING_LABELS.none,
      };
    }

    const numbers = calculateCreatureSpellBlockNumbers(
      props.creature,
      draftBlock.value,
    );

    return {
      saveDC:
        numbers.saveDC === undefined
          ? CREATURE_SPELLCASTING_LABELS.none
          : String(numbers.saveDC),
      attack:
        numbers.attackBonus === undefined
          ? CREATURE_SPELLCASTING_LABELS.none
          : formatSignedNumber(numbers.attackBonus),
    };
  });

  function applyBlock(): void {
    if (!draftBlock.value) {
      return;
    }

    emit('apply', draftBlock.value);

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="480"
    :min-height="440"
    :title="CREATURE_SPELL_BLOCK_FORM_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ CREATURE_SPELL_BLOCK_FORM_LABELS.hint }}
        </p>

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-toned">
            {{ CREATURE_SPELL_BLOCK_FORM_LABELS.name }}
          </span>

          <UInput
            v-model="form.name"
            :placeholder="CREATURE_SPELL_BLOCK_FORM_LABELS.namePlaceholder"
            size="sm"
            class="w-64 shrink-0"
          />
        </div>

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-toned">
            {{ CREATURE_SPELL_BLOCK_FORM_LABELS.ability }}
          </span>

          <USelect
            v-model="form.ability"
            :items="abilityOptions"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-64 shrink-0"
          />
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_BLOCK_FORM_LABELS.saveDC }}
            </span>

            <UInputNumber
              v-model="form.saveDC"
              size="sm"
              class="w-64 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_BLOCK_FORM_LABELS.saveDCHint }}
          </p>
        </div>

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_BLOCK_FORM_LABELS.attackBonus }}
            </span>

            <UInputNumber
              v-model="form.attackBonus"
              size="sm"
              class="w-64 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_BLOCK_FORM_LABELS.attackBonusHint }}
          </p>
        </div>

        <div class="border-t border-muted" />

        <div class="space-y-1">
          <span class="text-sm text-toned">
            {{ CREATURE_SPELL_BLOCK_FORM_LABELS.components }}
          </span>

          <div class="flex flex-wrap items-center gap-x-4 gap-y-2 py-1">
            <UCheckbox
              v-model="form.verbal"
              :label="CREATURE_SPELL_BLOCK_FORM_LABELS.componentVerbal"
            />

            <UCheckbox
              v-model="form.somatic"
              :label="CREATURE_SPELL_BLOCK_FORM_LABELS.componentSomatic"
            />

            <UCheckbox
              v-model="form.material"
              :label="CREATURE_SPELL_BLOCK_FORM_LABELS.componentMaterial"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_BLOCK_FORM_LABELS.componentsHint }}
          </p>
        </div>

        <div class="border-t border-muted" />

        <div class="space-y-1">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELL_BLOCK_FORM_LABELS.note }}
            </span>

            <UInput
              v-model="form.note"
              :placeholder="CREATURE_SPELL_BLOCK_FORM_LABELS.notePlaceholder"
              size="sm"
              class="w-64 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            {{ CREATURE_SPELL_BLOCK_FORM_LABELS.noteHint }}
          </p>
        </div>

        <!-- Итоговые числа блока: то же, что показывает его плитка -->
        <div class="grid grid-cols-2 gap-3">
          <div
            class="flex flex-col items-center gap-1 rounded-lg border border-default/50 bg-elevated/20 px-3 py-2"
          >
            <span
              class="text-center text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ CREATURE_SPELLCASTING_LABELS.saveDCHint }}
            </span>

            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ preview.saveDC }}
            </span>
          </div>

          <div
            class="flex flex-col items-center gap-1 rounded-lg border border-default/50 bg-elevated/20 px-3 py-2"
          >
            <span
              class="text-center text-[10px] font-bold tracking-wider text-muted uppercase"
            >
              {{ CREATURE_SPELLCASTING_LABELS.attackHint }}
            </span>

            <span class="text-2xl font-bold text-highlighted tabular-nums">
              {{ preview.attack }}
            </span>
          </div>
        </div>

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
            @click.left.exact.prevent="applyBlock"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
