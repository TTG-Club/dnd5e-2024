<!--
  Поля одного действия срабатывания: части урона, состояние с повторным
  спасброском, отметка-счётчик, хиты, уменьшение максимума хитов. Действие
  заменяется целиком при каждой правке.
-->
<script setup lang="ts">
  import type { AbilityType, DamagePart } from '@vtt/shared';
  import type {
    ConditionRef,
    EffectCastOwner,
    EffectFormLayout,
    EffectNotifyTarget,
    EffectRestoreKind,
    EffectSaveTiming,
    EffectTempHpMode,
    EffectTriggerAction,
    EffectTriggerActionType,
    EffectTriggerAreaShiftKind,
    EffectTriggerEvent,
    EffectTriggerMaxHpRestEnd,
    EffectTriggerMoveKind,
    EffectTriggerMoveOrigin,
    EffectTriggerReduceMaxHpAction,
    NestedEffectTrigger,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    CANTRIP_SPELL_LEVEL,
    createDefaultEffectSave,
    createEffectTriggerId,
    DEFAULT_CAST_OWNER,
    DEFAULT_NESTED_TRIGGER_EVENT,
    DEFAULT_NOTIFY_TARGET,
    DEFAULT_RESTORE_KIND,
    DEFAULT_TEMP_HP_MODE,
    DEFAULT_TRIGGER_AREA_SHIFT_KIND,
    DEFAULT_TRIGGER_MOVE_DISTANCE,
    DEFAULT_TRIGGER_MOVE_KIND,
    DEFAULT_TRIGGER_MOVE_ORIGIN,
    DEFAULT_TRIGGER_REST_TYPE,
    isEffectTag,
    layoutAcceptsSourceSaveDc,
    listNestedTriggerActionTypes,
    MAX_SPELL_SLOT_LEVEL,
    MIN_REVIVE_HP,
    MIN_SPELL_SLOT_LEVEL,
    NESTED_TRIGGER_EVENTS,
    PATH_AREA_SHIFT_KINDS,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import DamagePartsEditor from '../../actor/DamagePartsEditor.vue';
  import { EFFECT_SOURCE_DC_LABELS } from '../constants';
  import {
    ANY_CONDITION_KEY,
    buildAreaShiftKindOptions,
    buildConditionItems,
    buildConditionItemsWithAny,
    buildDamageTypeItems,
    createTriggerAction,
    EFFECT_CAST_OWNER_OPTIONS,
    EFFECT_NOTIFY_TARGET_OPTIONS,
    EFFECT_RESTORE_KIND_OPTIONS,
    EFFECT_SAVE_TIMING_OPTIONS,
    EFFECT_TEMP_HP_MODE_OPTIONS,
    EFFECT_TRIGGER_MAX_HP_REST_OPTIONS,
    EFFECT_TRIGGER_MOVE_KIND_OPTIONS,
    EFFECT_TRIGGER_MOVE_ORIGIN_OPTIONS,
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
    /** Событие срабатывания: «зона за носителем» бывает только на пути */
    event?: EffectTriggerEvent;
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
    listNestedTriggerActionTypes(
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
   * Меняет текст сообщения. Пустой текст не записывается: без текста
   * сообщение не сохранится схемой.
   *
   * @param value - новый текст
   */
  function updateNotifyText(value: string | number): void {
    const text = String(value).trim();

    if (action.value.type === 'notify' && text) {
      action.value = { ...action.value, text };
    }
  }

  /**
   * Меняет бросок к сообщению: пустая формула убирает бросок.
   *
   * @param value - формула броска
   */
  function updateNotifyRoll(value: string | number): void {
    const roll = String(value).trim();

    if (action.value.type === 'notify') {
      action.value = { ...action.value, roll: roll || undefined };
    }
  }

  // Носитель — значение по умолчанию: в данных оно не пишется
  const notifyTo = computed({
    get: () =>
      action.value.type === 'notify'
        ? (action.value.to ?? DEFAULT_NOTIFY_TARGET)
        : DEFAULT_NOTIFY_TARGET,
    set: (next: EffectNotifyTarget) => {
      if (action.value.type === 'notify') {
        action.value = {
          ...action.value,
          to: next === DEFAULT_NOTIFY_TARGET ? undefined : next,
        };
      }
    },
  });

  /**
   * Меняет число или формулу временных хитов. Пустое значение не пишется: без
   * него действие не сохранится схемой.
   *
   * @param value - новое значение
   */
  function updateTempHpAmount(value: string | number): void {
    const amount = String(value).trim();

    if (action.value.type === 'tempHp' && amount) {
      action.value = { ...action.value, amount };
    }
  }

  // Поставить — значение по умолчанию: в данных оно не пишется
  const tempHpMode = computed({
    get: () =>
      action.value.type === 'tempHp'
        ? (action.value.mode ?? DEFAULT_TEMP_HP_MODE)
        : DEFAULT_TEMP_HP_MODE,
    set: (next: EffectTempHpMode) => {
      if (action.value.type === 'tempHp') {
        action.value = {
          ...action.value,
          mode: next === DEFAULT_TEMP_HP_MODE ? undefined : next,
        };
      }
    },
  });

  const moveKind = computed({
    get: () =>
      action.value.type === 'move'
        ? action.value.kind
        : DEFAULT_TRIGGER_MOVE_KIND,
    set: (kind: EffectTriggerMoveKind) => {
      if (action.value.type === 'move') {
        action.value = { ...action.value, kind };
      }
    },
  });

  // Наложивший — значение по умолчанию: в данных оно не пишется
  const moveOrigin = computed({
    get: () =>
      action.value.type === 'move'
        ? (action.value.from ?? DEFAULT_TRIGGER_MOVE_ORIGIN)
        : DEFAULT_TRIGGER_MOVE_ORIGIN,
    set: (from: EffectTriggerMoveOrigin) => {
      if (action.value.type === 'move') {
        action.value = {
          ...action.value,
          from: from === DEFAULT_TRIGGER_MOVE_ORIGIN ? undefined : from,
        };
      }
    },
  });

  /**
   * Меняет расстояние перемещения.
   *
   * @param value - введённое число футов
   */
  function updateMoveDistance(value: number | null): void {
    if (action.value.type === 'move') {
      action.value = { ...action.value, distance: Math.max(0, value ?? 0) };
    }
  }

  const areaShiftKindOptions = computed(() =>
    buildAreaShiftKindOptions(props.event),
  );

  const areaShiftKind = computed({
    get: () =>
      action.value.type === 'moveArea'
        ? action.value.kind
        : DEFAULT_TRIGGER_AREA_SHIFT_KIND,
    set: (kind: EffectTriggerAreaShiftKind) => {
      if (action.value.type === 'moveArea') {
        action.value = { ...action.value, kind };
      }
    },
  });

  // Зона, идущая за носителем, повторяет его путь: расстояния у неё нет
  const areaShiftNeedsDistance = computed(
    () =>
      action.value.type === 'moveArea'
      && !PATH_AREA_SHIFT_KINDS.includes(action.value.kind),
  );

  /** «Снимается на выходе из зоны» есть только у эффекта зоны */
  const canEndOnZoneExit = computed(() => props.layout.delivery === 'zone');

  /**
   * Новое расстояние сдвига зоны.
   *
   * @param value - введённые футы
   */
  function updateAreaShiftDistance(value: number | null): void {
    if (action.value.type === 'moveArea') {
      action.value = { ...action.value, distance: Math.max(0, value ?? 0) };
    }
  }

  // Пустой ключ значит «все состояния получателя»
  const removedCondition = computed({
    get: () =>
      action.value.type === 'removeCondition'
        ? (action.value.conditionKey ?? ANY_CONDITION_KEY)
        : ANY_CONDITION_KEY,
    set: (next: string) => {
      if (action.value.type === 'removeCondition') {
        action.value = {
          ...action.value,
          conditionKey: next === ANY_CONDITION_KEY ? undefined : next,
        };
      }
    },
  });

  /** Состояния для снятия: «Все состояния» первым пунктом */
  const removableConditionItems = computed(() =>
    buildConditionItemsWithAny(EFFECT_TRIGGER_ROW_LABELS.removeConditionAll),
  );

  // Полный запас хитов вместо числа
  const reviveFull = computed({
    get: () => action.value.type === 'revive' && action.value.full === true,
    set: (enabled: boolean) => {
      if (action.value.type === 'revive') {
        action.value = { ...action.value, full: enabled ? true : undefined };
      }
    },
  });

  /**
   * Меняет число хитов у «Вернуть к жизни».
   *
   * @param value - введённое число
   */
  function updateReviveHp(value: number | null): void {
    if (action.value.type === 'revive') {
      action.value = {
        ...action.value,
        hp: Math.max(MIN_REVIVE_HP, value ?? MIN_REVIVE_HP),
      };
    }
  }

  const setHpToMax = computed({
    get: () => action.value.type === 'setHp' && action.value.toMax === true,
    set: (enabled: boolean) => {
      if (action.value.type === 'setHp') {
        action.value = { ...action.value, toMax: enabled ? true : undefined };
      }
    },
  });

  const restoreWhat = computed({
    get: () =>
      action.value.type === 'restore'
        ? action.value.what
        : DEFAULT_RESTORE_KIND,
    set: (next: EffectRestoreKind) => {
      if (action.value.type === 'restore') {
        action.value = {
          ...action.value,
          what: next,
          level: next === 'spellSlot' ? MIN_SPELL_SLOT_LEVEL : undefined,
          counter: next === 'counter' ? action.value.counter : undefined,
        };
      }
    },
  });

  /**
   * Меняет круг ячейки у «Вернуть ресурс».
   *
   * @param value - введённый круг
   */
  function updateRestoreLevel(value: number | null): void {
    if (action.value.type === 'restore') {
      action.value = {
        ...action.value,
        level: Math.min(
          MAX_SPELL_SLOT_LEVEL,
          Math.max(MIN_SPELL_SLOT_LEVEL, value ?? MIN_SPELL_SLOT_LEVEL),
        ),
      };
    }
  }

  /**
   * Меняет ключ ресурса листа. Пустой ключ не пишется: без него возвращать
   * нечего.
   *
   * @param value - введённый ключ
   */
  function updateRestoreCounter(value: string | number): void {
    const counter = String(value).trim();

    if (action.value.type === 'restore' && counter) {
      action.value = { ...action.value, counter };
    }
  }

  /**
   * Меняет круг у «Рассеять заклинания».
   *
   * @param value - введённый круг
   */
  function updateDispelLevel(value: number | null): void {
    if (action.value.type === 'dispel') {
      action.value = {
        ...action.value,
        maxLevel: Math.min(
          MAX_SPELL_SLOT_LEVEL,
          Math.max(CANTRIP_SPELL_LEVEL, value ?? CANTRIP_SPELL_LEVEL),
        ),
      };
    }
  }

  const dispelWithoutLevel = computed({
    get: () =>
      action.value.type === 'dispel' && action.value.withoutLevel === true,
    set: (enabled: boolean) => {
      if (action.value.type === 'dispel') {
        action.value = {
          ...action.value,
          withoutLevel: enabled ? true : undefined,
        };
      }
    },
  });

  // Свой каст — значение по умолчанию: в данных оно не пишется
  const endCastWhose = computed({
    get: () =>
      action.value.type === 'endCast'
        ? (action.value.whose ?? DEFAULT_CAST_OWNER)
        : DEFAULT_CAST_OWNER,
    set: (next: EffectCastOwner) => {
      if (action.value.type === 'endCast') {
        action.value = {
          ...action.value,
          whose: next === DEFAULT_CAST_OWNER ? undefined : next,
        };
      }
    },
  });

  /** «Спадает при выходе»: настройка есть только там, где эффект в зоне */
  const conditionEndsOnExit = computed({
    get: () =>
      action.value.type === 'applyCondition'
      && action.value.endsOnExit === true,
    set: (enabled: boolean) => {
      if (action.value.type === 'applyCondition') {
        action.value = {
          ...action.value,
          endsOnExit: enabled ? true : undefined,
        };
      }
    },
  });

  const conditionLocked = computed({
    get: () =>
      action.value.type === 'applyCondition' && action.value.locked === true,
    set: (enabled: boolean) => {
      if (action.value.type === 'applyCondition') {
        action.value = { ...action.value, locked: enabled ? true : undefined };
      }
    },
  });

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
      v-model="conditionLocked"
      :label="EFFECT_TRIGGER_ROW_LABELS.conditionLocked"
      :description="EFFECT_TRIGGER_ROW_LABELS.conditionLockedHint"
    />

    <USwitch
      v-if="canEndOnZoneExit"
      v-model="conditionEndsOnExit"
      :label="EFFECT_TRIGGER_ROW_LABELS.conditionEndsOnExit"
      :description="EFFECT_TRIGGER_ROW_LABELS.conditionEndsOnExitHint"
    />

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

  <div
    v-else-if="action.type === 'setHp'"
    class="flex flex-wrap items-center gap-3"
  >
    <UFormField
      v-if="!action.toMax"
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

    <USwitch
      v-model="setHpToMax"
      :label="EFFECT_TRIGGER_ROW_LABELS.setHpToMax"
    />
  </div>

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
    v-else-if="action.type === 'tempHp'"
    class="flex flex-wrap items-start gap-2"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.tempHpAmount"
      :help="EFFECT_TRIGGER_ROW_LABELS.maxHpAmountHint"
      class="w-56"
    >
      <UInput
        :model-value="action.amount"
        size="sm"
        class="w-full"
        @update:model-value="updateTempHpAmount"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.tempHpMode"
      class="w-44"
    >
      <USelect
        v-model="tempHpMode"
        :items="EFFECT_TEMP_HP_MODE_OPTIONS"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>
  </div>

  <div
    v-else-if="action.type === 'moveArea'"
    class="flex flex-wrap items-start gap-2"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.areaShiftKind"
      :help="EFFECT_TRIGGER_ROW_LABELS.areaShiftHint"
      class="w-52"
    >
      <USelect
        v-model="areaShiftKind"
        :items="areaShiftKindOptions"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>

    <UFormField
      v-if="areaShiftNeedsDistance"
      :label="EFFECT_TRIGGER_ROW_LABELS.moveDistance"
      class="w-28"
    >
      <UInputNumber
        :model-value="action.distance ?? DEFAULT_TRIGGER_MOVE_DISTANCE"
        :min="0"
        size="sm"
        class="w-full"
        @update:model-value="updateAreaShiftDistance"
      />
    </UFormField>
  </div>

  <div
    v-else-if="action.type === 'move'"
    class="flex flex-wrap items-start gap-2"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.moveKind"
      class="w-44"
    >
      <USelect
        v-model="moveKind"
        :items="EFFECT_TRIGGER_MOVE_KIND_OPTIONS"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.moveDistance"
      class="w-28"
    >
      <UInputNumber
        :model-value="action.distance"
        :min="0"
        size="sm"
        class="w-full"
        @update:model-value="updateMoveDistance"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.moveFrom"
      :help="EFFECT_TRIGGER_ROW_LABELS.moveHint"
      class="w-52"
    >
      <USelect
        v-model="moveOrigin"
        :items="EFFECT_TRIGGER_MOVE_ORIGIN_OPTIONS"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>
  </div>

  <UFormField
    v-else-if="action.type === 'removeCondition'"
    :label="EFFECT_TRIGGER_ROW_LABELS.condition"
    class="w-64"
  >
    <USelectMenu
      v-model="removedCondition"
      :items="removableConditionItems"
      value-key="value"
      label-key="label"
      size="sm"
      class="w-full"
      :portal="false"
    />
  </UFormField>

  <div
    v-else-if="action.type === 'revive'"
    class="flex flex-wrap items-center gap-3"
  >
    <UFormField
      v-if="!action.full"
      :label="EFFECT_TRIGGER_ROW_LABELS.reviveHp"
      class="w-32"
    >
      <UInputNumber
        :model-value="action.hp ?? MIN_REVIVE_HP"
        :min="MIN_REVIVE_HP"
        size="sm"
        class="w-full"
        @update:model-value="updateReviveHp"
      />
    </UFormField>

    <USwitch
      v-model="reviveFull"
      :label="EFFECT_TRIGGER_ROW_LABELS.reviveFull"
    />
  </div>

  <div
    v-else-if="action.type === 'restore'"
    class="flex flex-wrap items-start gap-2"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.restoreWhat"
      class="w-52"
    >
      <USelect
        v-model="restoreWhat"
        :items="EFFECT_RESTORE_KIND_OPTIONS"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>

    <UFormField
      v-if="action.what === 'spellSlot'"
      :label="EFFECT_TRIGGER_ROW_LABELS.restoreLevel"
      class="w-28"
    >
      <UInputNumber
        :model-value="action.level ?? MIN_SPELL_SLOT_LEVEL"
        :min="MIN_SPELL_SLOT_LEVEL"
        :max="MAX_SPELL_SLOT_LEVEL"
        size="sm"
        class="w-full"
        @update:model-value="updateRestoreLevel"
      />
    </UFormField>

    <UFormField
      v-else
      :label="EFFECT_TRIGGER_ROW_LABELS.restoreCounter"
      class="w-56"
    >
      <UInput
        :model-value="action.counter ?? ''"
        size="sm"
        class="w-full"
        @update:model-value="updateRestoreCounter"
      />
    </UFormField>
  </div>

  <div
    v-else-if="action.type === 'dispel'"
    class="flex flex-wrap items-center gap-3"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.dispelMaxLevel"
      class="w-32"
    >
      <UInputNumber
        :model-value="action.maxLevel"
        :min="CANTRIP_SPELL_LEVEL"
        :max="MAX_SPELL_SLOT_LEVEL"
        size="sm"
        class="w-full"
        @update:model-value="updateDispelLevel"
      />
    </UFormField>

    <USwitch
      v-model="dispelWithoutLevel"
      :label="EFFECT_TRIGGER_ROW_LABELS.dispelWithoutLevel"
    />
  </div>

  <UFormField
    v-else-if="action.type === 'endCast'"
    :label="EFFECT_TRIGGER_ROW_LABELS.endCastWhose"
    class="w-44"
  >
    <USelect
      v-model="endCastWhose"
      :items="EFFECT_CAST_OWNER_OPTIONS"
      value-key="value"
      size="sm"
      class="w-full"
      :portal="false"
    />
  </UFormField>

  <div
    v-else-if="action.type === 'notify'"
    class="flex flex-wrap items-start gap-2"
  >
    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.notifyText"
      class="w-72"
    >
      <UInput
        :model-value="action.text"
        :placeholder="EFFECT_TRIGGER_ROW_LABELS.notifyTextPlaceholder"
        size="sm"
        class="w-full"
        @update:model-value="updateNotifyText"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.notifyTo"
      class="w-48"
    >
      <USelect
        v-model="notifyTo"
        :items="EFFECT_NOTIFY_TARGET_OPTIONS"
        value-key="value"
        size="sm"
        class="w-full"
        :portal="false"
      />
    </UFormField>

    <UFormField
      :label="EFFECT_TRIGGER_ROW_LABELS.notifyRoll"
      :help="EFFECT_TRIGGER_ROW_LABELS.notifyRollHint"
      class="w-40"
    >
      <UInput
        :model-value="action.roll ?? ''"
        :placeholder="EFFECT_TRIGGER_ROW_LABELS.notifyRollPlaceholder"
        size="sm"
        class="w-full"
        @update:model-value="updateNotifyRoll"
      />
    </UFormField>
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
