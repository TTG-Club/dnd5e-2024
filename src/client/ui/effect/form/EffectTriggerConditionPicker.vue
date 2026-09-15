<!--
  Условие срабатывания: части из словаря срабатываний, соединённые «и». Какие
  части что-то значят на событии, решает движок (`listTriggerConditionKinds`);
  часть, которую словарь не знает, показывается как есть и не теряется.
-->
<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type {
    EffectTriggerEvent,
    TriggerConditionKind,
    TriggerConditionParameter,
    TriggerConditionPart,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    CHOICE_DAMAGE_TYPE,
    CREATURE_CATEGORY_OPTIONS,
    getTriggerConditionParameter,
    isDamageType,
    listTriggerConditionKinds,
    readTriggerConditionParts,
    writeTriggerCondition,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import { SCROLLABLE_DROPDOWN_UI } from '../../actor/constants';
  import {
    EFFECT_TRIGGER_CONDITION_DEFAULT_VALUES,
    EFFECT_TRIGGER_CONDITION_KIND_LABELS,
    EFFECT_TRIGGER_CONDITION_LABELS,
  } from '../triggerLabels';

  const props = defineProps<{
    /** Событие срабатывания: от него зависят доступные части */
    event: EffectTriggerEvent;
  }>();

  const condition = defineModel<string | undefined>('condition', {
    required: true,
  });

  const systemDataStore = useSystemDataStore();

  /** Строка списка частей: разобранная часть или строка как есть */
  interface ConditionRow {
    key: string;
    part: TriggerConditionPart | null;
    text: string;
  }

  const parts = computed(() => readTriggerConditionParts(condition.value));

  const rows = computed<ConditionRow[]>(() =>
    parts.value.map((part, index) =>
      typeof part === 'string'
        ? { key: `${index}-raw`, part: null, text: part }
        : {
            key: `${index}-${part.kind}`,
            part,
            text: EFFECT_TRIGGER_CONDITION_KIND_LABELS[part.kind],
          },
    ),
  );

  // Справочник типов урона приходит из мира: чужой ключ условие не узнает
  const damageTypeItems = computed(() =>
    systemDataStore.damageTypes.flatMap((damageType) =>
      damageType.key !== CHOICE_DAMAGE_TYPE && isDamageType(damageType.key)
        ? [{ label: damageType.name, value: damageType.key }]
        : [],
    ),
  );

  const parameterItems = computed<
    Record<TriggerConditionParameter, Array<{ label: string; value: string }>>
  >(() => ({
    damageType: damageTypeItems.value,
    creatureType: CREATURE_CATEGORY_OPTIONS,
  }));

  /**
   * Записывает части условия.
   *
   * @param nextParts - части по порядку
   */
  function writeParts(
    nextParts: ReadonlyArray<TriggerConditionPart | string>,
  ): void {
    condition.value = writeTriggerCondition(nextParts);
  }

  /**
   * Добавляет часть условия; у части со значением — значение по умолчанию.
   *
   * @param kind - вид части
   */
  function addPart(kind: TriggerConditionKind): void {
    const parameter = getTriggerConditionParameter(kind);

    writeParts([
      ...parts.value,
      parameter
        ? { kind, value: EFFECT_TRIGGER_CONDITION_DEFAULT_VALUES[parameter] }
        : { kind },
    ]);
  }

  /**
   * Убирает часть условия.
   *
   * @param index - номер части
   */
  function removePart(index: number): void {
    writeParts(parts.value.filter((_part, partIndex) => partIndex !== index));
  }

  /**
   * Меняет значение части условия.
   *
   * @param index - номер части
   * @param value - новое значение
   */
  function updatePartValue(index: number, value: string): void {
    writeParts(
      parts.value.map((part, partIndex) =>
        partIndex === index && typeof part !== 'string'
          ? { ...part, value }
          : part,
      ),
    );
  }

  /**
   * Варианты значения части.
   *
   * @param part - часть условия
   * @returns варианты либо пустой список, если значения нет
   */
  function valueItemsOf(
    part: TriggerConditionPart,
  ): Array<{ label: string; value: string }> {
    const parameter = getTriggerConditionParameter(part.kind);

    return parameter ? parameterItems.value[parameter] : [];
  }

  const addItems = computed<DropdownMenuItem[]>(() =>
    listTriggerConditionKinds(props.event).map((kind) => ({
      label: EFFECT_TRIGGER_CONDITION_KIND_LABELS[kind],
      onSelect: () => addPart(kind),
    })),
  );
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <span class="text-xs font-medium text-default">
      {{ EFFECT_TRIGGER_CONDITION_LABELS.title }}
    </span>

    <p
      v-if="rows.length === 0"
      class="text-xs text-muted"
    >
      {{ EFFECT_TRIGGER_CONDITION_LABELS.always }}
    </p>

    <div
      v-for="(row, index) in rows"
      :key="row.key"
      class="flex flex-wrap items-center gap-2"
    >
      <span
        v-if="index > 0"
        class="text-xs text-muted"
      >
        {{ EFFECT_TRIGGER_CONDITION_LABELS.and }}
      </span>

      <span
        class="text-xs text-default"
        :title="row.part ? undefined : EFFECT_TRIGGER_CONDITION_LABELS.unknown"
      >
        {{ row.text }}
      </span>

      <USelect
        v-if="row.part && valueItemsOf(row.part).length > 0"
        :model-value="row.part.value"
        :items="valueItemsOf(row.part)"
        value-key="value"
        size="xs"
        class="w-44"
        :portal="false"
        @update:model-value="updatePartValue(index, $event)"
      />

      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="tabler:x"
        :title="EFFECT_TRIGGER_CONDITION_LABELS.remove"
        @click.left.exact.prevent="removePart(index)"
      />
    </div>

    <UDropdownMenu
      :items="addItems"
      :content="{ align: 'start' }"
      :ui="SCROLLABLE_DROPDOWN_UI"
    >
      <UButton
        color="primary"
        variant="soft"
        size="xs"
        icon="tabler:filter-plus"
        class="w-fit"
        :label="EFFECT_TRIGGER_CONDITION_LABELS.add"
      />
    </UDropdownMenu>
  </div>
</template>
