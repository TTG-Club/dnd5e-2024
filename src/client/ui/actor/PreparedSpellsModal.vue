<script setup lang="ts">
  import type {
    DnDPreparedLimit,
    PreparedKind,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    getPreparedLimitBreakdown,
    normalizePreparedLimit,
    PREPARED_LIMIT_BONUS_MAX,
    PREPARED_LIMIT_BONUS_MIN,
    PREPARED_LIMIT_EMPTY_VALUE,
    PREPARED_LIMIT_MAX,
    PREPARED_LIMIT_MIN,
  } from '@vtt/shared/system/dnd.js';

  import { BONUS_INPUT_FORMAT_OPTIONS, MODAL_BUTTON_LABELS } from './constants';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    /** Что настраивается: заклинания книги либо заговоры */
    kind: PreparedKind;
    /** Текущая настройка предела */
    limit: DnDPreparedLimit;
    /** Число из таблиц классов; null — колонки нет */
    classValue: number | null;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [limit: DnDPreparedLimit];
  }>();

  /**
   * Подписи по виду подготовки: заговоры считаются отдельным счётчиком со своей
   * колонкой таблицы класса, поэтому и подписи у них свои.
   */
  const KIND_LABELS: Record<
    PreparedKind,
    { title: string; customValue: string; total: string; unknown: string }
  > = {
    spells: {
      title: 'Подготовленные заклинания',
      customValue: 'Число заклинаний',
      total: 'Всего можно подготовить',
      unknown:
        'Таблица класса числа подготовленных заклинаний не даёт — задайте своё число.',
    },
    cantrips: {
      title: 'Заговоры',
      customValue: 'Число заговоров',
      total: 'Всего заговоров',
      unknown: 'Таблица класса числа заговоров не даёт — задайте своё число.',
    },
  };

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const labels = computed(() => KIND_LABELS[props.kind]);

  const draftCustom = ref(false);
  const draftValue = ref(PREPARED_LIMIT_MIN);
  const draftBonus = ref(0);

  /**
   * Черновик заводится при открытии: окно живёт во вкладке постоянно, и без
   * этого оно показывало бы значения того счётчика, с которым его открыли
   * впервые. Своё число отталкивается от числа класса — игроку чаще нужно его
   * поправить, а не набирать с нуля.
   */
  watch(
    () => [props.open, props.kind],
    ([opened]) => {
      if (!opened) {
        return;
      }

      draftCustom.value = props.limit.custom !== null;
      draftBonus.value = props.limit.bonus;

      draftValue.value =
        props.limit.custom ?? props.classValue ?? PREPARED_LIMIT_MIN;
    },
    { immediate: true },
  );

  /**
   * Число из поля для предпросмотра: очищенное поле отдаёт не-число. В актёра
   * значения уходят через `normalizePreparedLimit` — он их и клампит.
   */
  function toFieldValue(value: number): number {
    return Number.isFinite(value) ? value : 0;
  }

  /** Настройка из черновика — и для предпросмотра, и для сохранения */
  const draftLimit = computed<DnDPreparedLimit>(() => ({
    custom: draftCustom.value ? toFieldValue(draftValue.value) : null,
    bonus: toFieldValue(draftBonus.value),
  }));

  /** Разбор предпросмотра — той же утилитой, что и плитка вкладки */
  const breakdown = computed(() =>
    getPreparedLimitBreakdown(props.classValue, draftLimit.value),
  );

  /** Число класса: от черновика не зависит, его меняют уровень и класс */
  const classValueLabel = computed(() =>
    props.classValue === null
      ? PREPARED_LIMIT_EMPTY_VALUE
      : String(props.classValue),
  );

  const totalLabel = computed(() =>
    breakdown.value.value === null
      ? PREPARED_LIMIT_EMPTY_VALUE
      : String(breakdown.value.value),
  );

  /** Бонус со знаком для строки предпросмотра */
  const bonusLabel = computed(() => formatSignedNumber(breakdown.value.bonus));

  /** Отдаёт выправленную настройку наверх и закрывает окно */
  function applyLimit(): void {
    emit('apply', normalizePreparedLimit(draftLimit.value));

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
    :min-height="300"
    :title="labels.title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-3">
        <UCheckbox
          v-model="draftCustom"
          label="Использовать своё число"
          description="Иначе число считается по таблице класса"
        />

        <div class="border-t border-muted" />

        <!-- Своё число вместо подсчёта -->
        <div
          v-if="draftCustom"
          class="flex items-center justify-between gap-4"
        >
          <span class="text-sm text-toned">{{ labels.customValue }}</span>

          <UInputNumber
            v-model="draftValue"
            :min="PREPARED_LIMIT_MIN"
            :max="PREPARED_LIMIT_MAX"
            size="sm"
            class="w-40 shrink-0"
          />
        </div>

        <!-- Подсчёт по таблице класса -->
        <template v-else>
          <div class="flex items-center justify-between gap-4 text-sm">
            <span class="text-toned">Число из таблицы класса</span>

            <span class="text-toned tabular-nums">{{ classValueLabel }}</span>
          </div>

          <div class="flex items-center justify-between gap-4">
            <span class="text-sm text-toned">Бонус к числу класса</span>

            <UInputNumber
              v-model="draftBonus"
              :min="PREPARED_LIMIT_BONUS_MIN"
              :max="PREPARED_LIMIT_BONUS_MAX"
              :format-options="BONUS_INPUT_FORMAT_OPTIONS"
              size="sm"
              class="w-40 shrink-0"
            />
          </div>

          <p class="text-xs leading-relaxed text-dimmed">
            <template v-if="classValue === null">
              {{ labels.unknown }}
            </template>

            <template v-else>
              Число берётся из таблицы класса компендиума на текущем уровне; у
              мультикласса складывается по всем классам. Бонус прибавляется к
              нему — например, от черты или предмета.
            </template>
          </p>
        </template>

        <div class="border-t border-muted" />

        <div class="flex items-center justify-between gap-4">
          <span class="text-sm text-muted">{{ labels.total }}</span>

          <span class="flex items-baseline gap-2">
            <span
              v-if="!draftCustom && breakdown.bonus !== 0"
              class="text-xs text-dimmed tabular-nums"
            >
              {{ classValueLabel }} {{ bonusLabel }}
            </span>

            <span class="text-xl font-bold text-highlighted tabular-nums">
              {{ totalLabel }}
            </span>
          </span>
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
            @click.left.exact.prevent="applyLimit"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
