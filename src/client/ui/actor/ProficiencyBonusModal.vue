<script setup lang="ts">
  /**
   * Настройка бонуса мастерства листа.
   *
   * По правилам бонус растёт с уровнем персонажа. Здесь этот расчёт правится:
   * основа задаётся своим числом вместо расчёта по уровню, а сверху добавляются
   * свои бонусы — числом либо модификатором характеристики.
   *
   * Правки копятся в черновике до «Применить»: число в окне пересчитывается
   * сразу, а лист узнаёт о них только по кнопке.
   */
  import type { AbilityType } from '@vtt/shared';
  import type {
    DnDCustomBonus,
    DnDProficiencySettings,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    getProficiencyBonusBreakdown,
    PROFICIENCY_BASE_MAX,
    PROFICIENCY_BASE_MIN,
    toStoredProficiencySettings,
  } from '@vtt/shared/system/dnd.js';

  import { PROFICIENCY_SETTINGS_LABELS } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Настройка листа; нет — бонус считается по правилам */
    settings?: DnDProficiencySettings;
    /** Модификаторы характеристик с учётом эффектов */
    abilityMods: Record<AbilityType, number>;
    /** Бонус по правилам: по уровню персонажа либо по опасности существа */
    ruleValue: number;
    /** Подпись основы по правилам: «По уровню 5», «По опасности 1/2» */
    ruleTitle: string;
    /** Итоговый бонус листа: по нему видно, не задан ли он эффектом целиком */
    sheetValue: number;
  }

  const props = withDefaults(defineProps<Props>(), { settings: undefined });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [settings: DnDProficiencySettings];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftIsCustomBase = ref(false);
  const draftBase = ref(0);
  const draftBonuses = ref<DnDCustomBonus[]>([]);

  /**
   * Бонус задан активным эффектом целиком: настройка на итог листа не влияет,
   * пока эффект держится. Считается при открытии — по расхождению итога листа
   * с расчётом по записанной настройке.
   */
  const isOverridden = ref(false);

  /**
   * Заводит черновик по данным листа. Окно живёт в листе постоянно, поэтому
   * черновик собирается на каждом открытии — иначе оно показывало бы тот лист,
   * с которым его открыли впервые.
   *
   * Своё число основы подставляется из расчёта по правилам: его чаще правят на
   * пару единиц, чем набирают с нуля.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      const base = props.settings?.base ?? null;

      draftIsCustomBase.value = base !== null;
      draftBase.value = base ?? props.ruleValue;

      draftBonuses.value = (props.settings?.bonuses ?? []).map((bonus) => ({
        ...bonus,
      }));

      const stored = getProficiencyBonusBreakdown({
        ruleValue: props.ruleValue,
        settings: props.settings,
        abilityMods: props.abilityMods,
      });

      isOverridden.value = stored.value !== props.sheetValue;
    },
  );

  /**
   * Число из поля для предпросмотра: очищенное поле отдаёт NaN, и без
   * подстраховки он расползся бы по всему разбору. В лист значение уходит через
   * `toStoredProficiencySettings` — он его и клампит.
   *
   * @param value - значение поля ввода
   * @returns число основы
   */
  function toFieldValue(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  /** Настройка из черновика — и для предпросмотра, и для сохранения */
  const draftSettings = computed<DnDProficiencySettings>(() => ({
    base: draftIsCustomBase.value ? toFieldValue(draftBase.value) : null,
    bonuses: draftBonuses.value,
  }));

  /** Разбор предпросмотра — той же функцией, что считает и сам лист */
  const breakdown = computed(() =>
    getProficiencyBonusBreakdown({
      ruleValue: props.ruleValue,
      settings: draftSettings.value,
      abilityMods: props.abilityMods,
    }),
  );

  /** Подпись расчёта по правилам: и его основа, и что она даёт */
  const ruleLabel = computed(
    () => `${props.ruleTitle}: ${formatSignedNumber(props.ruleValue)}`,
  );

  const formattedTotal = computed(() =>
    formatSignedNumber(breakdown.value.value),
  );

  const formattedBase = computed(() =>
    formatSignedNumber(breakdown.value.base),
  );

  const formattedBonus = computed(() =>
    formatSignedNumber(breakdown.value.bonus),
  );

  /** Отдаёт выправленную настройку наверх и закрывает окно */
  function applySettings(): void {
    emit('apply', toStoredProficiencySettings(draftSettings.value));

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
    :min-height="340"
    :title="PROFICIENCY_SETTINGS_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Итог черновика -->
        <div class="text-center">
          <span class="text-4xl font-bold text-highlighted tabular-nums">
            {{ formattedTotal }}
          </span>
        </div>

        <!-- Бонус под перезаписью: число в листе не от настройки, и пометка
          объясняет, почему оно не двигается -->
        <p
          v-if="isOverridden"
          class="rounded border border-warning/50 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning"
        >
          {{ PROFICIENCY_SETTINGS_LABELS.overriddenHint }}
        </p>

        <div class="border-t border-muted" />

        <!-- Основа -->
        <div class="space-y-3">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ PROFICIENCY_SETTINGS_LABELS.baseTitle }}
          </span>

          <UCheckbox
            v-model="draftIsCustomBase"
            :label="PROFICIENCY_SETTINGS_LABELS.customBase"
            :description="ruleLabel"
          />

          <div
            v-if="draftIsCustomBase"
            class="flex items-center justify-between gap-4"
          >
            <span class="text-sm text-toned">
              {{ PROFICIENCY_SETTINGS_LABELS.baseValue }}
            </span>

            <UInputNumber
              v-model="draftBase"
              :min="PROFICIENCY_BASE_MIN"
              :max="PROFICIENCY_BASE_MAX"
              size="sm"
              class="w-40 shrink-0"
              :aria-label="PROFICIENCY_SETTINGS_LABELS.baseValue"
            />
          </div>
        </div>

        <div class="border-t border-muted" />

        <!-- Свои бонусы -->
        <div class="space-y-3">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ PROFICIENCY_SETTINGS_LABELS.bonusesTitle }}
          </span>

          <CustomBonusRows
            v-model="draftBonuses"
            :ability-mods="abilityMods"
          />
        </div>

        <div class="border-t border-muted" />

        <!-- Разбор итога -->
        <div class="space-y-1">
          <div class="flex items-center justify-between gap-4 text-sm">
            <span class="text-toned">
              {{ PROFICIENCY_SETTINGS_LABELS.baseTitle }}
            </span>

            <span class="text-toned tabular-nums">{{ formattedBase }}</span>
          </div>

          <div
            v-if="breakdown.bonus !== 0"
            class="flex items-center justify-between gap-4 text-sm"
          >
            <span class="text-toned">
              {{ PROFICIENCY_SETTINGS_LABELS.bonusesTitle }}
            </span>

            <span class="text-toned tabular-nums">{{ formattedBonus }}</span>
          </div>

          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-muted">
              {{ PROFICIENCY_SETTINGS_LABELS.totalTitle }}
            </span>

            <span class="text-xl font-bold text-highlighted tabular-nums">
              {{ formattedTotal }}
            </span>
          </div>
        </div>

        <p class="text-xs leading-relaxed text-dimmed">
          {{ PROFICIENCY_SETTINGS_LABELS.hint }}
        </p>

        <!-- Кнопки -->
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
            @click.left.exact.prevent="applySettings"
          >
            Применить
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
