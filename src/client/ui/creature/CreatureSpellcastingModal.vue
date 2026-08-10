<script setup lang="ts">
  import type { AbilityType } from '@vtt/shared';
  import type {
    CreatureSpellcasting,
    DnDAbilityScores,
  } from '@vtt/shared/system/dnd.js';

  import type { CreatureSpellcastingMode } from './constants';

  import { computed, reactive, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    ABILITY_OPTIONS,
    calculateAbilityModifier,
    calculateCreatureSpellcasting,
  } from '@vtt/shared/system/dnd.js';

  import { BONUS_INPUT_FORMAT_OPTIONS } from '../actor/constants';
  import { formatSignedNumber } from '../actor/utils/formatSignedNumber';
  import {
    CREATURE_SPELLCASTING_LABELS,
    CREATURE_SPELLCASTING_MODE_OPTIONS,
  } from './constants';

  interface Props {
    open: boolean;
    /** Текущие параметры заклинательства существа */
    spellcasting?: CreatureSpellcasting;
    /** Значения характеристик существа — по ним считается предпросмотр */
    abilities: DnDAbilityScores;
    /** Бонус мастерства существа */
    proficiencyBonus: number;
  }

  const props = withDefaults(defineProps<Props>(), {
    spellcasting: undefined,
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [spellcasting: CreatureSpellcasting];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Значение «характеристика не выбрана» в списке выбора */
  const ABILITY_NONE = 'none';

  /**
   * Правка идёт по копии: до «Применить» запись существа не меняется — окно
   * закрывают и «Отменой».
   */
  const form = reactive<{
    ability: AbilityType | typeof ABILITY_NONE;
    saveMode: CreatureSpellcastingMode;
    saveValue: number;
    attackMode: CreatureSpellcastingMode;
    attackValue: number;
  }>({
    ability: ABILITY_NONE,
    saveMode: 'auto',
    saveValue: 0,
    attackMode: 'auto',
    attackValue: 0,
  });

  /**
   * Способ расчёта по тому, что записано: своё число главнее поправки, а без
   * обоих число выводится по характеристике.
   *
   * @param manual - своё число
   * @param bonus - поправка к расчёту
   * @returns способ и его значение
   */
  function readMode(
    manual: number | undefined,
    bonus: number | undefined,
  ): { mode: CreatureSpellcastingMode; value: number } {
    if (manual !== undefined) {
      return { mode: 'manual', value: manual };
    }

    if (bonus !== undefined && bonus !== 0) {
      return { mode: 'autoPlus', value: bonus };
    }

    return { mode: 'auto', value: 0 };
  }

  /**
   * Собирает пару полей записи по способу расчёта: лишнее уходит в
   * `undefined`, иначе в записи остались бы оба числа сразу.
   *
   * @param mode - способ расчёта
   * @param value - своё число либо поправка
   * @returns своё число и поправка
   */
  function writeMode(
    mode: CreatureSpellcastingMode,
    value: number,
  ): { manual: number | undefined; bonus: number | undefined } {
    if (mode === 'manual') {
      return { manual: value, bonus: undefined };
    }

    return {
      manual: undefined,
      bonus: mode === 'autoPlus' ? value : undefined,
    };
  }

  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      const block = props.spellcasting;

      const save = readMode(block?.saveDC, block?.saveDCBonus);
      const attack = readMode(block?.attackBonus, block?.attackBonusExtra);

      form.ability = block?.ability ?? ABILITY_NONE;
      form.saveMode = save.mode;
      form.saveValue = save.value;
      form.attackMode = attack.mode;
      form.attackValue = attack.value;
    },
    { immediate: true },
  );

  /** Список выбора характеристики: шесть характеристик и «не выбрана» */
  const abilityOptions = computed(() => [
    { value: ABILITY_NONE, label: CREATURE_SPELLCASTING_LABELS.abilityNone },
    ...ABILITY_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    })),
  ]);

  /** Выбранная характеристика; null — расчёт по правилам невозможен */
  const selectedAbility = computed<AbilityType | null>(() =>
    form.ability === ABILITY_NONE ? null : form.ability,
  );

  /** Модификатор выбранной характеристики */
  const abilityModifier = computed<number | null>(() =>
    selectedAbility.value === null
      ? null
      : calculateAbilityModifier(props.abilities[selectedAbility.value] ?? 10),
  );

  /**
   * Черновик в том же виде, в каком он ляжет в запись существа: по нему движок
   * считает предпросмотр теми же правилами, что и числа шапки вкладки.
   */
  const draftSpellcasting = computed<CreatureSpellcasting>(() => {
    const save = writeMode(form.saveMode, form.saveValue);
    const attack = writeMode(form.attackMode, form.attackValue);

    return {
      ability: selectedAbility.value ?? undefined,
      saveDC: save.manual,
      saveDCBonus: save.bonus,
      attackBonus: attack.manual,
      attackBonusExtra: attack.bonus,
    };
  });

  /** Предпросмотр итоговых чисел — тех же, что стоят в плитке вкладки */
  const preview = computed(() => {
    const numbers = calculateCreatureSpellcasting(
      draftSpellcasting.value,
      props.abilities,
      props.proficiencyBonus,
    );

    return {
      saveDc:
        numbers.saveDC === undefined
          ? CREATURE_SPELLCASTING_LABELS.none
          : String(numbers.saveDC),
      attack:
        numbers.attackBonus === undefined
          ? CREATURE_SPELLCASTING_LABELS.none
          : formatSignedNumber(numbers.attackBonus),
    };
  });

  /** Расчёт по правилам без характеристики не выходит — окно об этом говорит */
  const isAbilityMissing = computed(
    () =>
      selectedAbility.value === null
      && (form.saveMode !== 'manual' || form.attackMode !== 'manual'),
  );

  /** Подпись поля: у своего числа стоит само значение, у поправки — прибавка */
  const saveValueLabel = computed(() =>
    form.saveMode === 'manual'
      ? CREATURE_SPELLCASTING_LABELS.valueLabel
      : CREATURE_SPELLCASTING_LABELS.bonusLabel,
  );

  const attackValueLabel = computed(() =>
    form.attackMode === 'manual'
      ? CREATURE_SPELLCASTING_LABELS.valueLabel
      : CREATURE_SPELLCASTING_LABELS.bonusLabel,
  );

  /**
   * Формат поля сложности спасброска: у поправки знак виден и у плюса, иначе
   * поле читается готовой сложностью, а не прибавкой к ней. У своего числа
   * знака нет — там стоит сама сложность.
   */
  const saveValueFormatOptions = computed(() =>
    form.saveMode === 'autoPlus' ? BONUS_INPUT_FORMAT_OPTIONS : undefined,
  );

  function applySpellcasting(): void {
    emit('apply', draftSpellcasting.value);

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
    :min-height="420"
    :title="CREATURE_SPELLCASTING_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ CREATURE_SPELLCASTING_LABELS.hint }}
        </p>

        <!-- Характеристика: от неё пляшут оба расчёта по правилам -->
        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-toned">
            {{ CREATURE_SPELLCASTING_LABELS.abilityHint }}
          </span>

          <USelect
            v-model="form.ability"
            :items="abilityOptions"
            value-key="value"
            label-key="label"
            size="sm"
            class="w-56 shrink-0"
          />
        </div>

        <p
          v-if="isAbilityMissing"
          class="text-xs leading-relaxed text-warning"
        >
          {{ CREATURE_SPELLCASTING_LABELS.abilityMissing }}
        </p>

        <div class="border-t border-muted" />

        <!-- Сложность спасброска -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELLCASTING_LABELS.saveDCHint }}
            </span>

            <USelect
              v-model="form.saveMode"
              :items="CREATURE_SPELLCASTING_MODE_OPTIONS"
              value-key="value"
              label-key="label"
              size="sm"
              class="w-56 shrink-0"
            />
          </div>

          <div
            v-if="form.saveMode !== 'auto'"
            class="flex items-center justify-between gap-4"
          >
            <span class="text-xs text-dimmed">{{ saveValueLabel }}</span>

            <UInputNumber
              v-model="form.saveValue"
              size="sm"
              class="w-56 shrink-0"
              :format-options="saveValueFormatOptions"
            />
          </div>
        </div>

        <div class="border-t border-muted" />

        <!-- Бонус атаки заклинанием -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">
              {{ CREATURE_SPELLCASTING_LABELS.attackHint }}
            </span>

            <USelect
              v-model="form.attackMode"
              :items="CREATURE_SPELLCASTING_MODE_OPTIONS"
              value-key="value"
              label-key="label"
              size="sm"
              class="w-56 shrink-0"
            />
          </div>

          <div
            v-if="form.attackMode !== 'auto'"
            class="flex items-center justify-between gap-4"
          >
            <span class="text-xs text-dimmed">{{ attackValueLabel }}</span>

            <!-- Бонус атаки — поправка в обоих случаях: и своё число здесь
              прибавляется к броску, поэтому знак виден всегда -->
            <UInputNumber
              v-model="form.attackValue"
              size="sm"
              class="w-56 shrink-0"
              :format-options="BONUS_INPUT_FORMAT_OPTIONS"
            />
          </div>
        </div>

        <div class="border-t border-muted" />

        <!-- Слагаемые расчёта по правилам -->
        <div class="flex items-center justify-between gap-4 text-sm">
          <span class="text-toned">
            {{ CREATURE_SPELLCASTING_LABELS.abilityMod }}
          </span>

          <span class="text-toned tabular-nums">
            {{
              abilityModifier === null
                ? CREATURE_SPELLCASTING_LABELS.none
                : formatSignedNumber(abilityModifier)
            }}
          </span>
        </div>

        <div class="flex items-center justify-between gap-4 text-sm">
          <span class="text-toned">
            {{ CREATURE_SPELLCASTING_LABELS.proficiency }}
          </span>

          <span class="text-toned tabular-nums">
            {{ formatSignedNumber(proficiencyBonus) }}
          </span>
        </div>

        <!-- Итоговые числа: то же, что показывает плитка вкладки -->
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
              {{ preview.saveDc }}
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

        <p class="text-xs leading-relaxed text-dimmed">
          {{ CREATURE_SPELLCASTING_LABELS.formula }}
        </p>

        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            Отмена
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applySpellcasting"
          >
            Применить
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
