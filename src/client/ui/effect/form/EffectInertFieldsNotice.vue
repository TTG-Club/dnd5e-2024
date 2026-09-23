<!--
  Плашка «не работает в этом месте». Поля не стираются молча: запись могла
  прийти из старого редактора, и решает автор. Каждая настройка — своей
  строкой: что именно задано, почему не работает и своя кнопка «Убрать», —
  иначе непонятно, что сотрёт кнопка.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    EffectFormLayout,
    EffectTriggerEventSwitch,
    InertEffectField,
    UnsupportedEffectTrigger,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    capitalize,
    describeEffectTriggerInPlace,
    listUnsupportedEffectTriggers,
  } from '@vtt/shared/system/dnd.js';

  import FieldHint from '../../actor/FieldHint.vue';
  import {
    EFFECT_ACTIVATION_CHOICE_LABELS,
    EFFECT_INERT_FIELD_NAMES,
    EFFECT_INERT_FIELD_REASONS,
    EFFECT_INERT_FIELDS_LABELS,
    EFFECT_TARGET_DELIVERY_LABELS,
    EFFECT_TRIGGER_EVENT_UNAVAILABLE_REASONS,
  } from '../constants';
  import { EFFECT_TRIGGER_ACTION_LABELS } from '../triggerLabels';

  /** Строка плашки: одна неработающая настройка */
  interface InertRow {
    key: string;
    name: string;
    /**
     * Что именно задано, уже с разделителем после названия: склейка в
     * шаблоне дала бы лишний пробел перед двоеточием при переносе строки.
     * Пусто — хватает названия.
     */
    detail: string;
    reason: string;
    /** Поле, которое сотрёт кнопка; у срабатывания — только оно само */
    field: InertEffectField | null;
    triggerId: string | null;
  }

  const props = defineProps<{
    /** Неработающие поля эффекта */
    fields: readonly InertEffectField[];
    /** Эффект в окне: по нему называются неработающие срабатывания */
    effect: ActiveEffect;
    /** Раскладка окна */
    layout: EffectFormLayout;
  }>();

  const emit = defineEmits<{
    /** Убрать неработающие поля */
    clear: [fields: InertEffectField[]];
    /** Убрать одно неработающее срабатывание */
    removeTrigger: [triggerId: string];
  }>();

  /**
   * Подпись переключателя так, как он назван в окне.
   *
   * @param eventSwitch - переключатель
   * @returns подпись в кавычках
   */
  function describeEventSwitch(eventSwitch: EffectTriggerEventSwitch): string {
    const label =
      eventSwitch === 'target'
        ? EFFECT_TARGET_DELIVERY_LABELS[props.layout.context]
        : EFFECT_ACTIVATION_CHOICE_LABELS[eventSwitch];

    return `${EFFECT_INERT_FIELDS_LABELS.switchQuoteOpen}${label}${EFFECT_INERT_FIELDS_LABELS.switchQuoteClose}`;
  }

  /**
   * Почему срабатывание не работает: момент не наступает — и что тогда
   * выбрать, — или действий здесь нет.
   *
   * @param unsupported - неработающее срабатывание
   * @returns причина
   */
  function describeTriggerReason(
    unsupported: UnsupportedEffectTrigger,
  ): string {
    if (!unsupported.eventUnavailable) {
      return `${EFFECT_INERT_FIELDS_LABELS.actionsUnavailablePrefix}${unsupported.unavailableActions
        .map((type) => EFFECT_TRIGGER_ACTION_LABELS[type])
        .join(EFFECT_INERT_FIELDS_LABELS.actionsJoiner)}.`;
    }

    const reason =
      EFFECT_TRIGGER_EVENT_UNAVAILABLE_REASONS[unsupported.trigger.event]
      ?? EFFECT_INERT_FIELD_REASONS.triggers;

    if (unsupported.eventSwitches.length === 0) {
      return reason;
    }

    return `${reason}${EFFECT_INERT_FIELDS_LABELS.switchesPrefix}${unsupported.eventSwitches
      .map(describeEventSwitch)
      .join(EFFECT_INERT_FIELDS_LABELS.switchesJoiner)}.`;
  }

  const rows = computed<InertRow[]>(() =>
    props.fields.flatMap((field): InertRow[] => {
      if (field !== 'triggers') {
        return [
          {
            key: field,
            name: EFFECT_INERT_FIELD_NAMES[field],
            detail: '',
            reason: EFFECT_INERT_FIELD_REASONS[field],
            field,
            triggerId: null,
          },
        ];
      }

      return listUnsupportedEffectTriggers(props.effect, props.layout).map(
        (unsupported) => ({
          key: unsupported.trigger.id,
          name: EFFECT_INERT_FIELDS_LABELS.triggerName,
          detail: `${EFFECT_INERT_FIELDS_LABELS.detailSeparator}${capitalize(
            describeEffectTriggerInPlace(
              unsupported.trigger,
              props.layout.context,
            ),
          )}`,
          reason: describeTriggerReason(unsupported),
          field: null,
          triggerId: unsupported.trigger.id,
        }),
      );
    }),
  );

  /**
   * Убирает настройку одной строки.
   *
   * @param row - строка плашки
   */
  function clearRow(row: InertRow): void {
    if (row.triggerId !== null) {
      emit('removeTrigger', row.triggerId);
    } else if (row.field !== null) {
      emit('clear', [row.field]);
    }
  }

  /** Убирает все неработающие настройки разом */
  function clearAll(): void {
    emit('clear', [...props.fields]);
  }
</script>

<template>
  <div
    class="flex flex-col gap-1.5 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs"
  >
    <div class="flex items-center justify-between gap-2">
      <span class="flex items-center gap-1.5 font-medium text-warning">
        <UIcon
          name="tabler:alert-triangle"
          class="size-4 shrink-0"
        />

        {{ EFFECT_INERT_FIELDS_LABELS.title }}

        <FieldHint :text="EFFECT_INERT_FIELDS_LABELS.titleHint" />
      </span>

      <UButton
        v-if="rows.length > 1"
        color="warning"
        variant="ghost"
        size="xs"
        icon="tabler:eraser"
        :label="EFFECT_INERT_FIELDS_LABELS.clearAll"
        @click.left.exact.prevent="clearAll"
      />
    </div>

    <ul class="flex flex-col gap-1.5">
      <li
        v-for="row in rows"
        :key="row.key"
        class="flex items-start justify-between gap-2"
      >
        <div class="min-w-0">
          <p class="text-default">
            <span class="font-medium">{{ row.name }}</span>

            <template v-if="row.detail">{{ row.detail }}</template>
          </p>

          <p class="text-muted">
            {{ row.reason }}
          </p>
        </div>

        <UButton
          color="warning"
          variant="soft"
          size="xs"
          icon="tabler:eraser"
          :label="EFFECT_INERT_FIELDS_LABELS.clear"
          class="shrink-0"
          @click.left.exact.prevent="clearRow(row)"
        />
      </li>
    </ul>
  </div>
</template>
