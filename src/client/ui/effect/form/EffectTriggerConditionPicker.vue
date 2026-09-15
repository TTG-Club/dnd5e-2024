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
    isEffectTag,
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
    /** Отметки, которые ставит этот эффект: условие по отметке их предлагает */
    knownTags: readonly string[];
  }>();

  /** Условие строкой словаря (`self.tag === "x" && …`); пусто — без условия */
  const condition = defineModel<string | undefined>('condition', {
    required: true,
  });

  const systemDataStore = useSystemDataStore();

  /** Строка списка частей: разобранная часть или строка как есть */
  interface ConditionRow {
    key: string;
    part: TriggerConditionPart | null;
    text: string;
    /** Подсказка к строке, которую окно не узнало */
    title?: string;
  }

  const parts = computed(() => readTriggerConditionParts(condition.value));

  const rows = computed<ConditionRow[]>(() =>
    parts.value.map((part, index) =>
      typeof part === 'string'
        ? {
            key: `${index}-raw`,
            part: null,
            text: part,
            title: EFFECT_TRIGGER_CONDITION_LABELS.unknown,
          }
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

  // Ключ отметки вводится строкой, у остальных значений — выбор из словаря
  const parameterItems = computed<
    Record<
      Exclude<TriggerConditionParameter, 'tag'>,
      Array<{ label: string; value: string }>
    >
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
      parameter ? { kind, value: defaultValueOf(parameter) } : { kind },
    ]);
  }

  /**
   * Значение новой части: у отметки — первая отметка эффекта.
   *
   * @param parameter - что выбирается
   * @returns значение
   */
  function defaultValueOf(parameter: TriggerConditionParameter): string {
    return parameter === 'tag'
      ? (props.knownTags[0] ?? EFFECT_TRIGGER_CONDITION_DEFAULT_VALUES.tag)
      : EFFECT_TRIGGER_CONDITION_DEFAULT_VALUES[parameter];
  }

  /**
   * Вводится ли значение части строкой — ключ отметки.
   *
   * @param part - часть условия
   * @returns `true` для частей с отметкой
   */
  function isTagPart(part: TriggerConditionPart): boolean {
    return getTriggerConditionParameter(part.kind) === 'tag';
  }

  /**
   * Меняет ключ отметки части. Негодный ключ не пишется: условие с ним
   * разобралось бы строкой, которую окно не знает, и поле ввода пропало бы.
   *
   * @param index - номер части
   * @param value - введённый ключ
   */
  function updatePartTag(index: number, value: string | number): void {
    const tag = String(value).trim();

    if (isEffectTag(tag)) {
      updatePartValue(index, tag);
    }
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

    return parameter && parameter !== 'tag'
      ? parameterItems.value[parameter]
      : [];
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
        :title="row.title"
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

      <template v-else-if="row.part && isTagPart(row.part)">
        <UInput
          :model-value="row.part.value"
          size="xs"
          class="w-40"
          @update:model-value="updatePartTag(index, $event)"
        />

        <UButton
          v-for="tag in knownTags"
          :key="tag"
          color="neutral"
          variant="soft"
          size="xs"
          :label="tag"
          :title="EFFECT_TRIGGER_CONDITION_LABELS.knownTags"
          @click.left.exact.prevent="updatePartValue(index, tag)"
        />
      </template>

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
