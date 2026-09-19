<!--
  Поля одного действия срабатывания: части урона, состояние с повторным
  спасброском, отметка-счётчик, хиты, уменьшение максимума хитов. Действие
  заменяется целиком при каждой правке.
-->
<script setup lang="ts">
  import type { AbilityType, DamagePart } from '@vtt/shared';
  import type {
    ConditionRef,
    EffectFormLayout,
    EffectSaveTiming,
    EffectTriggerAction,
    EffectTriggerActionType,
    EffectTriggerEvent,
    EffectTriggerMaxHpRestEnd,
    EffectTriggerReduceMaxHpAction,
    NestedEffectTrigger,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    createDefaultEffectSave,
    createEffectTriggerId,
    DEFAULT_NESTED_TRIGGER_EVENT,
    DEFAULT_TRIGGER_REST_TYPE,
    isEffectTag,
    layoutAcceptsSourceSaveDc,
    listTriggerActionTypes,
    NESTED_TRIGGER_EVENTS,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import DamagePartsEditor from '../../actor/DamagePartsEditor.vue';
  import { EFFECT_SOURCE_DC_LABELS } from '../constants';
  import {
    buildConditionItems,
    buildDamageTypeItems,
    createTriggerAction,
    EFFECT_SAVE_TIMING_OPTIONS,
    EFFECT_TRIGGER_MAX_HP_REST_OPTIONS,
  } from '../effectFormOptions';
  import {
    DEFAULT_RECURRING_SAVE_TIMING,
    EFFECT_TRIGGER_ACTION_LABELS,
    EFFECT_TRIGGER_EVENT_LABELS,
    EFFECT_TRIGGER_ROW_LABELS,
  } from '../triggerLabels';
  import SaveDcField from './SaveDcField.vue';

  const props = defineProps<{
    /** Раскладка окна: Сл «Авто» и её подпись */
    layout: EffectFormLayout;
    /** Сл источника для «Авто», если окно её знает */
    sourceSaveDc?: number;
    /**
     * Действие уже вложено в наложенное состояние: своих срабатываний у него
     * не бывает — вложенность на одну ступень
     */
    nested?: boolean;
  }>();

  /** Действие строки */
  const action = defineModel<EffectTriggerAction>('action', {
    required: true,
  });

  const systemDataStore = useSystemDataStore();

  const damageTypeOptions = computed(() =>
    buildDamageTypeItems(systemDataStore.damageTypes),
  );

  // Список вычисляемый: кроме канона в него входят состояния, заведённые в мире
  const conditionItems = computed(buildConditionItems);

  const acceptsSourceSaveDc = computed(() =>
    layoutAcceptsSourceSaveDc(props.layout),
  );

  /** Срок состояния или отметки в раундах; `null` — срок по умолчанию */
  const rounds = computed(() =>
    (action.value.type === 'applyCondition' || action.value.type === 'applyTag')
    && action.value.duration?.type === 'rounds'
      ? (action.value.duration.value ?? null)
      : null,
  );

  /**
   * Меняет части урона.
   *
   * @param parts - части урона
   */
  function updateDamageParts(parts: DamagePart[]): void {
    if (action.value.type === 'damage') {
      action.value = { ...action.value, parts };
    }
  }

  /**
   * Меняет состояние действия.
   *
   * @param conditionKey - ключ состояния
   */
  function updateCondition(conditionKey: ConditionRef): void {
    if (action.value.type === 'applyCondition') {
      action.value = { ...action.value, conditionKey };
    }
  }

  /**
   * Меняет срок состояния или отметки в раундах; пусто — срок по умолчанию
   * (состояние — пока не снимут, отметка — до начала следующего хода).
   *
   * @param nextRounds - раундов
   */
  function updateRounds(nextRounds: number | null): void {
    const current = action.value;

    if (current.type !== 'applyCondition' && current.type !== 'applyTag') {
      return;
    }

    const { duration: _duration, ...rest } = current;

    action.value =
      nextRounds === null || nextRounds <= 0
        ? rest
        : { ...rest, duration: { type: 'rounds', value: nextRounds } };
  }

  const hasRecurringSave = computed({
    get: () =>
      action.value.type === 'applyCondition'
      && action.value.recurringSave !== undefined,
    set: (enabled: boolean) => {
      const current = action.value;

      if (current.type !== 'applyCondition') {
        return;
      }

      const { recurringSave: _save, ...rest } = current;

      action.value = enabled
        ? {
            ...rest,
            recurringSave: {
              ...createDefaultEffectSave(props.layout),
              timing: DEFAULT_RECURRING_SAVE_TIMING,
            },
          }
        : rest;
    },
  });

  /**
   * Меняет поле повторного спасброска состояния.
   *
   * @param patch - изменённые поля
   * @param patch.ability - характеристика
   * @param patch.dc - сложность
   * @param patch.timing - момент броска
   */
  function updateRecurringSave(patch: {
    ability?: AbilityType;
    dc?: number;
    timing?: EffectSaveTiming;
  }): void {
    const current = action.value;

    if (current.type === 'applyCondition' && current.recurringSave) {
      action.value = {
        ...current,
        recurringSave: { ...current.recurringSave, ...patch },
      };
    }
  }

  const hasNestedTrigger = computed({
    get: () =>
      action.value.type === 'applyCondition'
      && (action.value.triggers?.length ?? 0) > 0,
    set: (enabled: boolean) => {
      const current = action.value;

      if (current.type !== 'applyCondition') {
        return;
      }

      const { triggers: _triggers, ...rest } = current;

      action.value = enabled
        ? {
            ...rest,
            triggers: [
              {
                id: createEffectTriggerId(),
                event: DEFAULT_NESTED_TRIGGER_EVENT,
                actions: [{ type: 'removeSelf' }],
              },
            ],
          }
        : rest;
    },
  });

  /** Единственное вложенное срабатывание состояния */
  const nestedTrigger = computed(() =>
    action.value.type === 'applyCondition'
      ? action.value.triggers?.[0]
      : undefined,
  );

  /** Единственное действие вложенного срабатывания */
  const nestedAction = computed<EffectTriggerAction>({
    get: () => nestedTrigger.value?.actions[0] ?? { type: 'removeSelf' },
    set: (next) => updateNestedTrigger({ actions: [next] }),
  });

  /** События, на которые реагирует наложенное состояние */
  const nestedEventItems = NESTED_TRIGGER_EVENTS.map((event) => ({
    value: event,
    label: EFFECT_TRIGGER_EVENT_LABELS[event],
  }));

  /** Что вложенное срабатывание может сделать */
  const nestedActionItems = computed(() =>
    listTriggerActionTypes(
      props.layout,
      nestedTrigger.value?.event ?? DEFAULT_NESTED_TRIGGER_EVENT,
    ).map((type) => ({
      value: type,
      label: EFFECT_TRIGGER_ACTION_LABELS[type],
    })),
  );

  /**
   * Меняет вложенное срабатывание, не теряя остальных его полей.
   *
   * @param patch - изменённые поля срабатывания
   */
  function updateNestedTrigger(patch: Partial<NestedEffectTrigger>): void {
    const current = action.value;
    const trigger = nestedTrigger.value;

    if (current.type !== 'applyCondition' || !trigger) {
      return;
    }

    action.value = { ...current, triggers: [{ ...trigger, ...patch }] };
  }

  /**
   * Меняет событие вложенного срабатывания.
   *
   * @param nextEvent - событие наложенного состояния
   */
  function updateNestedEvent(nextEvent: EffectTriggerEvent): void {
    updateNestedTrigger({ event: nextEvent });
  }

  /**
   * Меняет вид действия вложенного срабатывания.
   *
   * @param type - вид действия
   */
  function updateNestedActionType(type: EffectTriggerActionType): void {
    nestedAction.value = createTriggerAction(type);
  }

  /**
   * Меняет число хитов действия «Хиты становятся».
   *
   * @param value - хитов
   */
  function updateSetHp(value: number | null): void {
    if (action.value.type === 'setHp') {
      action.value = { ...action.value, value: Math.max(0, value ?? 0) };
    }
  }

  /**
   * Меняет ключ или имя отметки.
   *
   * @param patch - новый ключ или имя; пустое имя — как ключ
   * @param patch.tag - ключ
   * @param patch.label - имя в списке
   */
  function updateTag(patch: {
    tag?: string | number;
    label?: string | number;
  }): void {
    const current = action.value;

    if (current.type !== 'applyTag') {
      return;
    }

    const { label: _label, ...rest } = current;
    const label = String(patch.label ?? current.label ?? '').trim();

    action.value = {
      ...rest,
      tag: String(patch.tag ?? current.tag).trim(),
      ...(label ? { label } : {}),
    };
  }

  const tagError = computed(() =>
    action.value.type === 'applyTag' && !isEffectTag(action.value.tag)
      ? EFFECT_TRIGGER_ROW_LABELS.tagInvalid
      : undefined,
  );

  // Счётчик пишется только включённым: `stack: true`
  const tagStack = computed({
    get: () => action.value.type === 'applyTag' && action.value.stack === true,
    set: (enabled: boolean) => {
      const current = action.value;

      if (current.type !== 'applyTag') {
        return;
      }

      const { stack: _stack, ...rest } = current;

      action.value = enabled ? { ...rest, stack: true } : rest;
    },
  });

  /**
   * Меняет поле уменьшения максимума хитов.
   *
   * @param patch - изменённые поля
   */
  function updateMaxHp(
    patch: Partial<Omit<EffectTriggerReduceMaxHpAction, 'type'>>,
  ): void {
    if (action.value.type === 'reduceMaxHp') {
      action.value = { ...action.value, ...patch };
    }
  }

  /**
   * Меняет «на сколько». Пустое значение не пишется: без него действие не
   * разобралось бы и срабатывание пропало бы из данных.
   *
   * @param value - введённая строка
   */
  function updateMaxHpAmount(value: string | number): void {
    const amount = String(value).trim();

    if (amount) {
      updateMaxHp({ amount });
    }
  }

  // Долгий отдых — значение по умолчанию: в данных он не пишется
  const maxHpRest = computed({
    get: () =>
      action.value.type === 'reduceMaxHp'
        ? (action.value.endsOnRest ?? DEFAULT_TRIGGER_REST_TYPE)
        : DEFAULT_TRIGGER_REST_TYPE,
    set: (next: EffectTriggerMaxHpRestEnd) => {
      const current = action.value;

      if (current.type !== 'reduceMaxHp') {
        return;
      }

      const { endsOnRest: _endsOnRest, ...withoutRestEnd } = current;

      action.value =
        next === DEFAULT_TRIGGER_REST_TYPE
          ? withoutRestEnd
          : { ...withoutRestEnd, endsOnRest: next };
    },
  });
</script>

<template>
  <DamagePartsEditor
    v-if="action.type === 'damage'"
    :model-value="action.parts"
    :damage-type-options="damageTypeOptions"
    :include-spell-modifier="false"
    :hide-modifiers="true"
    :allow-empty="true"
    @update:model-value="updateDamageParts"
  />

  <div
    v-else-if="action.type === 'applyCondition'"
    class="flex flex-col gap-2"
  >
    <div class="flex flex-wrap items-end gap-2">
      <UFormField
        :label="EFFECT_TRIGGER_ROW_LABELS.condition"
        class="w-56"
      >
        <USelect
          :model-value="action.conditionKey"
          :items="conditionItems"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
          @update:model-value="updateCondition"
        />
      </UFormField>

      <UFormField
        :label="EFFECT_TRIGGER_ROW_LABELS.conditionRounds"
        class="w-40"
      >
        <UInputNumber
          :model-value="rounds"
          :min="0"
          :placeholder="EFFECT_TRIGGER_ROW_LABELS.conditionRoundsPlaceholder"
          size="sm"
          class="w-full"
          @update:model-value="updateRounds"
        />
      </UFormField>
    </div>

    <USwitch
      v-model="hasRecurringSave"
      :label="EFFECT_TRIGGER_ROW_LABELS.recurringSaveToggle"
    />

    <div
      v-if="action.recurringSave"
      class="flex flex-wrap items-end gap-2"
    >
      <UFormField
        :label="EFFECT_TRIGGER_ROW_LABELS.saveAbility"
        class="w-44"
      >
        <USelect
          :model-value="action.recurringSave.ability"
          :items="ABILITY_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
          @update:model-value="updateRecurringSave({ ability: $event })"
        />
      </UFormField>

      <SaveDcField
        :model-value="action.recurringSave.dc"
        :label="EFFECT_TRIGGER_ROW_LABELS.saveDc"
        :auto-allowed="acceptsSourceSaveDc"
        :auto-label="EFFECT_SOURCE_DC_LABELS[layout.context]"
        :auto-value="sourceSaveDc"
        @update:model-value="updateRecurringSave({ dc: $event })"
      />

      <UFormField
        :label="EFFECT_TRIGGER_ROW_LABELS.recurringSaveTiming"
        class="w-40"
      >
        <USelect
          :model-value="action.recurringSave.timing"
          :items="EFFECT_SAVE_TIMING_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
          @update:model-value="updateRecurringSave({ timing: $event })"
        />
      </UFormField>
    </div>

    <!-- Своё срабатывание состояния: «Сон» просыпается от урона сам, не
         заканчивая каст всем целям -->
    <USwitch
      v-if="!nested"
      v-model="hasNestedTrigger"
      :label="EFFECT_TRIGGER_ROW_LABELS.nestedTriggerToggle"
    />

    <div
      v-if="!nested && nestedTrigger"
      class="flex flex-col gap-2 border-l-2 border-muted/50 pl-3"
    >
      <div class="flex flex-wrap items-end gap-2">
        <UFormField
          :label="EFFECT_TRIGGER_ROW_LABELS.nestedTriggerEvent"
          class="w-56"
        >
          <USelect
            :model-value="nestedTrigger.event"
            :items="nestedEventItems"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
            @update:model-value="updateNestedEvent"
          />
        </UFormField>

        <UFormField
          :label="EFFECT_TRIGGER_ROW_LABELS.nestedTriggerAction"
          class="w-56"
        >
          <USelect
            :model-value="nestedAction.type"
            :items="nestedActionItems"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
            @update:model-value="updateNestedActionType"
          />
        </UFormField>
      </div>

      <EffectTriggerActionFields
        v-model:action="nestedAction"
        :layout="layout"
        :source-save-dc="sourceSaveDc"
        nested
      />
    </div>
  </div>

  <UFormField
    v-else-if="action.type === 'setHp'"
    :label="EFFECT_TRIGGER_ROW_LABELS.setHpValue"
    class="w-32"
  >
    <UInputNumber
      :model-value="action.value"
      :min="0"
      size="sm"
      class="w-full"
      @update:model-value="updateSetHp"
    />
  </UFormField>

  <div
    v-else-if="action.type === 'applyTag'"
    class="flex flex-wrap items-start gap-2"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.tag"
      :error="tagError"
      class="w-56"
    >
      <UInput
        :model-value="action.tag"
        size="sm"
        class="w-full"
        @update:model-value="updateTag({ tag: $event })"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.tagLabel"
      class="w-48"
    >
      <UInput
        :model-value="action.label"
        :placeholder="EFFECT_TRIGGER_ROW_LABELS.tagLabelPlaceholder"
        size="sm"
        class="w-full"
        @update:model-value="updateTag({ label: $event })"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.conditionRounds"
      class="w-52"
    >
      <UInputNumber
        :model-value="rounds"
        :min="0"
        :placeholder="EFFECT_TRIGGER_ROW_LABELS.tagRoundsPlaceholder"
        size="sm"
        class="w-full"
        @update:model-value="updateRounds"
      />
    </UFormField>

    <USwitch
      v-model="tagStack"
      class="self-end"
      :label="EFFECT_TRIGGER_ROW_LABELS.tagStack"
      :description="EFFECT_TRIGGER_ROW_LABELS.tagStackHint"
    />
  </div>

  <div
    v-else-if="action.type === 'reduceMaxHp'"
    class="flex flex-wrap items-start gap-2"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.maxHpAmount"
      :help="EFFECT_TRIGGER_ROW_LABELS.maxHpAmountHint"
      class="w-56"
    >
      <UInput
        :model-value="action.amount"
        :placeholder="EFFECT_TRIGGER_ROW_LABELS.maxHpAmountPlaceholder"
        size="sm"
        class="w-full"
        @update:model-value="updateMaxHpAmount"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.maxHpRest"
      class="w-48"
    >
      <USelect
        v-model="maxHpRest"
        :items="EFFECT_TRIGGER_MAX_HP_REST_OPTIONS"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>
  </div>
</template>
