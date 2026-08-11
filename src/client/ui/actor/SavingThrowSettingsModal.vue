<script setup lang="ts">
  /**
   * Настройка спасбросков листа.
   *
   * По правилам спасбросок — модификатор своей характеристики плюс бонус
   * мастерства при владении. Здесь этот расчёт правится: спасбросок катится от
   * другой характеристики, к нему добавляются свои бонусы, а бонусы, общие для
   * всех шести (плащ защиты, аура паладина), заводятся один раз наверху.
   *
   * Правки копятся в черновике до «Применить»: числа в окне пересчитываются
   * сразу, а лист узнаёт о них только по кнопке.
   */
  import type { AbilityType } from '@vtt/shared';
  import type {
    DnDActor,
    DnDCustomBonus,
    DnDSavingThrowSettings,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import { generateEntityId } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    ABILITY_LABELS,
    ABILITY_OPTIONS,
    getCustomBonusesValue,
    getSavingThrowSetting,
    NEW_CUSTOM_BONUS,
    toStoredSavingThrowSettings,
  } from '@vtt/shared/system/dnd.js';

  import {
    MODAL_BUTTON_LABELS,
    SAVING_THROW_SETTINGS_LABELS,
  } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Актёр листа: из него берутся владения и настройка спасбросков */
    actor: DnDActor;
    /** Модификаторы характеристик с учётом эффектов */
    abilityMods: Record<AbilityType, number>;
    /** Бонус мастерства с учётом эффектов */
    proficiencyBonus: number;
    /** Итоговые спасброски листа — из них берётся вклад активных эффектов */
    saves: Partial<Record<AbilityType, number>>;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [
      payload: {
        savingThrows: AbilityType[];
        settings: DnDSavingThrowSettings;
      },
    ];
  }>();

  /** Строка черновика: настройка одного спасброска до «Применить» */
  interface SavingThrowDraft {
    /** Спасбросок какой характеристики: ключ строки и её подпись */
    key: AbilityType;
    /** Характеристика расчёта: по правилам совпадает с ключом */
    ability: AbilityType;
    /** Владение спасброском: в счёт идёт бонус мастерства */
    proficient: boolean;
    /** Свои бонусы этого спасброска */
    bonuses: DnDCustomBonus[];
  }

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftSaves = ref<SavingThrowDraft[]>([]);
  const draftCommon = ref<DnDCustomBonus[]>([]);

  /**
   * Вклад активных эффектов в каждый спасбросок: разница между итогом листа и
   * тем, что даёт расчёт по записанной настройке. Без него числа в окне
   * расходились бы с блоком спасбросков у всех, на ком висит хоть один эффект.
   */
  const effectBonuses = ref<Partial<Record<AbilityType, number>>>({});

  /**
   * Заводит черновик по данным листа. Окно живёт в листе постоянно, поэтому
   * черновик собирается на каждом открытии — иначе оно показывало бы того
   * актёра, с которым его открыли впервые.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      const settings = props.actor.system.savingThrowSettings;
      const proficient = props.actor.system.proficiencies.savingThrows;
      const deltas: Partial<Record<AbilityType, number>> = {};

      draftSaves.value = ABILITY_OPTIONS.map((ability) => {
        const setting = getSavingThrowSetting(settings, ability.value);
        const isProficient = proficient.includes(ability.value);

        // Расчёт по записанной настройке: всё, что итог даёт сверх него, —
        // вклад эффектов, и он переносится в предпросмотр как есть
        const stored =
          props.abilityMods[setting.ability ?? ability.value]
          + (isProficient ? props.proficiencyBonus : 0)
          + getCustomBonusesValue(props.abilityMods, setting.bonuses)
          + getCustomBonusesValue(props.abilityMods, settings?.common ?? []);

        deltas[ability.value] = (props.saves[ability.value] ?? 0) - stored;

        return {
          key: ability.value,
          ability: setting.ability ?? ability.value,
          proficient: isProficient,
          bonuses: setting.bonuses.map((bonus) => ({ ...bonus })),
        };
      });

      draftCommon.value = (settings?.common ?? []).map((bonus) => ({
        ...bonus,
      }));

      effectBonuses.value = deltas;
    },
  );

  /** Вклад общих бонусов: он одинаков у всех шести строк */
  const commonBonusValue = computed(() =>
    getCustomBonusesValue(props.abilityMods, draftCommon.value),
  );

  /** Строки окна: черновик плюс всё, что рисуется рядом с ним */
  const displayRows = computed(() =>
    draftSaves.value.map((draft) => {
      const isChanged = draft.ability !== draft.key || draft.bonuses.length > 0;

      const value =
        props.abilityMods[draft.ability]
        + (draft.proficient ? props.proficiencyBonus : 0)
        + getCustomBonusesValue(props.abilityMods, draft.bonuses)
        + commonBonusValue.value
        + (effectBonuses.value[draft.key] ?? 0);

      return {
        draft,
        label: ABILITY_LABELS[draft.key],
        formattedValue: formatSignedNumber(value),
        isChanged,
        proficiencyLabel: draft.proficient
          ? SAVING_THROW_SETTINGS_LABELS.proficient
          : SAVING_THROW_SETTINGS_LABELS.notProficient,
        // Кружок владения повторяет блок спасбросков листа: закрашен — владеет
        proficiencyClass: draft.proficient
          ? 'border-primary bg-primary'
          : 'border-accented bg-transparent hover:border-primary',
        // Изменённая строка обведена тёплым: видно, где расчёт отошёл от правил
        frameClass: isChanged ? 'border-primary/40' : 'border-default/50',
      };
    }),
  );

  /**
   * Переключает владение спасброском — как кружком в блоке листа.
   *
   * @param draft - строка черновика
   */
  function toggleProficiency(draft: SavingThrowDraft): void {
    draft.proficient = !draft.proficient;
  }

  /**
   * Возврат спасброска к правилам: своя характеристика и без своих бонусов.
   * Владение остаётся — его даёт класс, а не подсчёт.
   *
   * @param draft - строка черновика
   */
  function resetSavingThrow(draft: SavingThrowDraft): void {
    draft.ability = draft.key;
    draft.bonuses = [];
  }

  /**
   * Заводит спасброску пустой бонус: заготовка «+1» правится тут же в строке.
   *
   * @param draft - строка черновика
   */
  function addBonus(draft: SavingThrowDraft): void {
    draft.bonuses = [
      ...draft.bonuses,
      { ...NEW_CUSTOM_BONUS, id: generateEntityId('bonus') },
    ];
  }

  /** Отдаёт настройку наверх и закрывает окно */
  function applySettings(): void {
    const saves: DnDSavingThrowSettings['saves'] = {};

    for (const draft of draftSaves.value) {
      saves[draft.key] = { ability: draft.ability, bonuses: draft.bonuses };
    }

    const settings: DnDSavingThrowSettings = {
      saves,
      common: draftCommon.value,
    };

    emit('apply', {
      savingThrows: draftSaves.value
        .filter((draft) => draft.proficient)
        .map((draft) => draft.key),
      settings: toStoredSavingThrowSettings(settings),
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
    :min-width="640"
    :min-height="480"
    :title="SAVING_THROW_SETTINGS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="flex flex-col gap-2">
        <p class="text-xs leading-relaxed text-dimmed">
          {{ SAVING_THROW_SETTINGS_LABELS.hint }}
        </p>

        <!-- Общие бонусы разделом, а не карточкой: своя рамка спорила бы с
          пунктиром кнопки «Добавить бонус» внутри него, а от строк спасбросков
          раздел отбивает разделитель -->
        <div class="flex flex-col gap-2">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ SAVING_THROW_SETTINGS_LABELS.commonTitle }}
          </span>

          <CustomBonusRows
            v-model="draftCommon"
            :ability-mods="abilityMods"
          />

          <p class="text-xs leading-relaxed text-dimmed">
            {{ SAVING_THROW_SETTINGS_LABELS.commonHint }}
          </p>
        </div>

        <div class="my-1 border-t border-muted" />

        <div
          v-for="row in displayRows"
          :key="row.draft.key"
          class="flex flex-col gap-2 rounded-lg border bg-elevated/20 p-2 transition-colors"
          :class="row.frameClass"
        >
          <div class="flex flex-wrap items-center gap-2">
            <UTooltip :text="row.proficiencyLabel">
              <button
                type="button"
                class="flex h-3.5 w-3.5 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors"
                :class="row.proficiencyClass"
                :aria-label="`${SAVING_THROW_SETTINGS_LABELS.proficiency}: ${row.label}`"
                :aria-pressed="row.draft.proficient"
                @click.left.exact.prevent="toggleProficiency(row.draft)"
              />
            </UTooltip>

            <span class="min-w-0 grow truncate text-sm text-toned">
              {{ row.label }}
            </span>

            <span
              class="w-8 shrink-0 text-right text-sm font-bold text-highlighted tabular-nums"
            >
              {{ row.formattedValue }}
            </span>

            <!-- Характеристика, сброс и плюс держатся одной группой: на узком
              окне она переносится под название целой строкой, а не рассыпается
              по краям -->
            <div class="flex items-center gap-2">
              <USelect
                v-model="row.draft.ability"
                :items="ABILITY_OPTIONS"
                value-key="value"
                label-key="label"
                size="sm"
                class="w-40 shrink-0"
                :aria-label="`${SAVING_THROW_SETTINGS_LABELS.ability}: ${row.label}`"
              />

              <UTooltip :text="SAVING_THROW_SETTINGS_LABELS.reset">
                <UButton
                  icon="tabler:rotate"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  :disabled="!row.isChanged"
                  :aria-label="`${SAVING_THROW_SETTINGS_LABELS.reset}: ${row.label}`"
                  @click.left.exact.prevent="resetSavingThrow(row.draft)"
                />
              </UTooltip>

              <UTooltip :text="SAVING_THROW_SETTINGS_LABELS.addBonus">
                <UButton
                  icon="tabler:plus"
                  color="neutral"
                  variant="subtle"
                  size="xs"
                  square
                  :aria-label="`${SAVING_THROW_SETTINGS_LABELS.addBonus}: ${row.label}`"
                  @click.left.exact.prevent="addBonus(row.draft)"
                />
              </UTooltip>
            </div>
          </div>

          <!-- У спасброска без своих бонусов строк нет вовсе, а первый бонус
            заводит плюс в шапке: своя кнопка «Добавить» в каждой из шести строк
            только шумела бы -->
          <CustomBonusRows
            v-if="row.draft.bonuses.length > 0"
            v-model="row.draft.bonuses"
            :ability-mods="abilityMods"
            :with-add="false"
            class="border-l-2 border-primary/40 pl-2"
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
