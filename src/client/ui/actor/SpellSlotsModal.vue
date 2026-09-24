<script setup lang="ts">
  /**
   * Свои бонусы к ячейкам заклинаний листа.
   *
   * Ячейки считаются по таблицам классов, а бонусы ложатся сверху по кругам —
   * теми же строками, что у спасбросков и характеристик: своим числом,
   * модификатором характеристики или бонусом мастерства. Правки копятся в
   * черновике до «Применить».
   */
  import type {
    DnDCustomBonus,
    DnDCustomBonusContext,
    DnDSpellSlotSettings,
    SpellSlotArray,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import { generateEntityId } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    applySpellSlotSettings,
    getCustomBonusesValue,
    NEW_CUSTOM_BONUS,
    SPELL_LEVEL_LABELS,
    toStoredSpellSlotSettings,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS, SPELL_SLOTS_LABELS } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Ячейки по таблицам классов, без своих бонусов листа */
    classSlots: SpellSlotArray;
    /** Сохранённые бонусы листа */
    settings: DnDSpellSlotSettings;
    /** Числа листа, от которых считается вклад своих бонусов */
    context: DnDCustomBonusContext;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [settings: DnDSpellSlotSettings];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftLevels = ref<DnDCustomBonus[][]>([]);

  /**
   * Черновик заводится при открытии: окно живёт во вкладке постоянно, и без
   * этого показывало бы бонусы, с которыми его открыли впервые. Копии — чтобы
   * правки не трогали лист до «Применить».
   */
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        draftLevels.value = props.settings.levels.map((bonuses) =>
          bonuses.map((bonus) => ({ ...bonus })),
        );
      }
    },
    { immediate: true },
  );

  const draftSettings = computed<DnDSpellSlotSettings>(() => ({
    levels: draftLevels.value,
  }));

  /** Итог предпросмотра — той же утилитой, что и пузырьки вкладки */
  const totalSlots = computed(() =>
    applySpellSlotSettings(
      props.classSlots,
      draftSettings.value,
      props.context,
    ),
  );

  /** Строки окна: по одной на каждый круг */
  const rows = computed(() =>
    props.classSlots.map((classCount, index) => {
      const bonuses = draftLevels.value[index] ?? [];
      const isChanged = bonuses.length > 0;

      return {
        index,
        label: SPELL_LEVEL_LABELS[index + 1] ?? String(index + 1),
        bonuses,
        classCount,
        bonusLabel: formatSignedNumber(
          getCustomBonusesValue(props.context, bonuses),
        ),
        total: totalSlots.value[index],
        isChanged,
        // Строка с бонусами обведена тёплым: видно, где ячейки отошли от класса
        frameClass: isChanged ? 'border-primary/40' : 'border-default/50',
      };
    }),
  );

  /**
   * Замена бонусов одного круга: список пересобирается, а не правится на
   * месте — так его видит реактивность.
   *
   * @param index - индекс круга (0 = 1-й круг)
   * @param bonuses - новые бонусы круга
   */
  function setLevelBonuses(index: number, bonuses: DnDCustomBonus[]): void {
    draftLevels.value = draftLevels.value.map((levelBonuses, levelIndex) =>
      levelIndex === index ? bonuses : levelBonuses,
    );
  }

  /**
   * Заводит кругу пустой бонус: заготовка «+1» правится тут же в строке.
   *
   * @param index - индекс круга
   */
  function addBonus(index: number): void {
    setLevelBonuses(index, [
      ...(draftLevels.value[index] ?? []),
      { ...NEW_CUSTOM_BONUS, id: generateEntityId('bonus') },
    ]);
  }

  /**
   * Возврат круга к таблице класса: его бонусы убираются.
   *
   * @param index - индекс круга
   */
  function resetLevel(index: number): void {
    setLevelBonuses(index, []);
  }

  /** Отдаёт выправленные бонусы наверх и закрывает окно */
  function applySettings(): void {
    emit('apply', toStoredSpellSlotSettings(draftSettings.value));

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="640"
    :min-height="480"
    :title="SPELL_SLOTS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="flex flex-col gap-2">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ SPELL_SLOTS_LABELS.hint }}
        </p>

        <div class="my-1 border-t border-muted" />

        <div
          v-for="row in rows"
          :key="row.index"
          class="flex flex-col gap-2 rounded-lg border bg-elevated/20 p-2 transition-colors"
          :class="row.frameClass"
        >
          <div class="flex items-center gap-2">
            <span class="min-w-0 grow truncate text-sm text-toned">
              {{ row.label }}
            </span>

            <!-- Разбор итога: число класса и сумма бонусов. Без бонусов второе
              слагаемое не показывается — итог и так равен числу класса -->
            <UTooltip :text="SPELL_SLOTS_LABELS.fromClass">
              <span class="text-xs text-dimmed tabular-nums">
                {{ row.classCount }}
              </span>
            </UTooltip>

            <UTooltip
              v-if="row.isChanged"
              :text="SPELL_SLOTS_LABELS.bonus"
            >
              <span class="text-xs text-dimmed tabular-nums">
                {{ row.bonusLabel }}
              </span>
            </UTooltip>

            <UTooltip :text="SPELL_SLOTS_LABELS.total">
              <span
                class="w-6 shrink-0 text-right text-sm font-bold text-highlighted tabular-nums"
              >
                {{ row.total }}
              </span>
            </UTooltip>

            <UTooltip :text="SPELL_SLOTS_LABELS.reset">
              <UButton
                icon="tabler:rotate"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                :disabled="!row.isChanged"
                :aria-label="`${SPELL_SLOTS_LABELS.reset}: ${row.label}`"
                @click.left.exact.prevent="resetLevel(row.index)"
              />
            </UTooltip>

            <UTooltip :text="SPELL_SLOTS_LABELS.addBonus">
              <UButton
                icon="tabler:plus"
                color="neutral"
                variant="subtle"
                size="xs"
                square
                :aria-label="`${SPELL_SLOTS_LABELS.addBonus}: ${row.label}`"
                @click.left.exact.prevent="addBonus(row.index)"
              />
            </UTooltip>
          </div>

          <!-- У круга без бонусов строк нет вовсе, а первый бонус заводит плюс
            в шапке: своя кнопка «Добавить» в каждой из девяти строк шумела бы -->
          <CustomBonusRows
            v-if="row.bonuses.length > 0"
            :model-value="row.bonuses"
            :context="context"
            :with-add="false"
            class="border-l-2 border-primary/40 pl-2"
            @update:model-value="setLevelBonuses(row.index, $event)"
          />
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-1">
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
