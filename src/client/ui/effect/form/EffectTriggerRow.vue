<!--
  Строка списка «Срабатывания»: когда → спасбросок → что сделать → сколько раз.
  Что доступно, решает движок по месту окна: события — `layout.triggerEvents`,
  действия — `listTriggerActionTypes`, спасбросок — `triggerEventAcceptsSave`.
-->
<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { AbilityType, DamagePart } from '@vtt/shared';
  import type {
    ConditionRef,
    EffectFormLayout,
    EffectTrigger,
    EffectTriggerAction,
    EffectTriggerActionGate,
    EffectTriggerActionType,
    EffectTriggerAttackRole,
    EffectTriggerEvent,
    EffectTriggerLimitPeriod,
    EffectTriggerTurnOwner,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    DEFAULT_EFFECT_SAVE_DC,
    EFFECT_TRIGGER_ACTION_GATES,
    EFFECT_TRIGGER_ATTACK_ROLES,
    EFFECT_TRIGGER_LIMIT_PERIODS,
    isEffectTag,
    isTurnTriggerEvent,
    listSelectableConditions,
    listTriggerActionTypes,
    resolveTriggerActionGate,
    triggerEventAcceptsSave,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import { SCROLLABLE_DROPDOWN_UI } from '../../actor/constants';
  import DamagePartsEditor from '../../actor/DamagePartsEditor.vue';
  import { EFFECT_SOURCE_DC_LABELS } from '../constants';
  import {
    EFFECT_TRIGGER_ACTION_ICONS,
    EFFECT_TRIGGER_ACTION_LABELS,
    EFFECT_TRIGGER_DAMAGE_HALF_GATE,
    EFFECT_TRIGGER_DAMAGE_HALF_LABEL,
    EFFECT_TRIGGER_DEFAULT_TAG,
    EFFECT_TRIGGER_EVENT_LABELS,
    EFFECT_TRIGGER_GATE_LABELS,
    EFFECT_TRIGGER_PERIOD_LABELS,
    EFFECT_TRIGGER_ROLE_LABELS,
    EFFECT_TRIGGER_ROW_LABELS,
    EFFECT_TRIGGER_TURN_OWNER_LABELS,
  } from '../triggerLabels';
  import EffectTriggerConditionPicker from './EffectTriggerConditionPicker.vue';
  import SaveDcField from './SaveDcField.vue';

  /** Исход урона в строке: гейт либо «успех — половина» */
  type DamageGateChoice =
    EffectTriggerActionGate | typeof EFFECT_TRIGGER_DAMAGE_HALF_GATE;

  const props = defineProps<{
    /** Раскладка окна */
    layout: EffectFormLayout;
    /** Сл источника для «Авто», если окно её знает */
    sourceSaveDc?: number;
    /** Отметки, которые ставят срабатывания эффекта */
    knownTags: readonly string[];
  }>();

  const emit = defineEmits<{
    remove: [];
  }>();

  const trigger = defineModel<EffectTrigger>('trigger', { required: true });

  const systemDataStore = useSystemDataStore();

  /** Характеристика нового спасброска */
  const DEFAULT_SAVE_ABILITY: AbilityType = 'wisdom';

  /** Состояние нового действия «наложить состояние» */
  const DEFAULT_CONDITION: ConditionRef = 'poisoned';

  /** Период нового лимита */
  const DEFAULT_LIMIT_PERIOD: EffectTriggerLimitPeriod = 'turn';

  const damageTypeOptions = computed(() =>
    systemDataStore.damageTypes.map((damageType) => ({
      label: damageType.name,
      value: damageType.key,
    })),
  );

  /**
   * События в выборе: доступные здесь и то, что уже стоит (неработающее
   * покажет плашка окна).
   */
  const eventItems = computed(() =>
    [...new Set([...props.layout.triggerEvents, trigger.value.event])].map(
      (event) => ({
        value: event,
        label: EFFECT_TRIGGER_EVENT_LABELS[event] ?? event,
      }),
    ),
  );

  const roleItems = EFFECT_TRIGGER_ATTACK_ROLES.map((role) => ({
    value: role,
    label: EFFECT_TRIGGER_ROLE_LABELS[role],
  }));

  /** Чей ход в выборе: доступные здесь и то, что уже стоит в данных */
  const turnOwnerItems = computed(() =>
    [
      ...new Set([
        ...props.layout.triggerTurnOwners,
        trigger.value.turnOf ?? 'subject',
      ]),
    ].map((owner) => ({
      value: owner,
      label: EFFECT_TRIGGER_TURN_OWNER_LABELS[owner],
    })),
  );

  const showsTurnOwner = computed(
    () =>
      isTurnTriggerEvent(trigger.value.event)
      && turnOwnerItems.value.length > 1,
  );

  const periodItems = EFFECT_TRIGGER_LIMIT_PERIODS.map((period) => ({
    value: period,
    label: EFFECT_TRIGGER_PERIOD_LABELS[period],
  }));

  const gateItems = EFFECT_TRIGGER_ACTION_GATES.map((gate) => ({
    value: gate,
    label: EFFECT_TRIGGER_GATE_LABELS[gate],
  }));

  const damageGateItems: Array<{ value: DamageGateChoice; label: string }> = [
    { value: 'failed', label: EFFECT_TRIGGER_GATE_LABELS.failed },
    {
      value: EFFECT_TRIGGER_DAMAGE_HALF_GATE,
      label: EFFECT_TRIGGER_DAMAGE_HALF_LABEL,
    },
    { value: 'always', label: EFFECT_TRIGGER_GATE_LABELS.always },
    { value: 'saved', label: EFFECT_TRIGGER_GATE_LABELS.saved },
  ];

  // Список вычисляемый: кроме канона в него входят состояния, заведённые в мире
  const conditionItems = computed(() =>
    listSelectableConditions().map((condition) => ({
      value: condition.key,
      label: condition.nameRu,
    })),
  );

  const acceptsSave = computed(() =>
    triggerEventAcceptsSave(trigger.value.event),
  );

  const allowedActions = computed(() =>
    listTriggerActionTypes(props.layout, trigger.value.event),
  );

  /**
   * Заменяет строку целиком.
   *
   * @param patch - изменённые поля
   */
  function update(patch: Partial<EffectTrigger>): void {
    trigger.value = { ...trigger.value, ...patch };
  }

  /**
   * Действие без гейта и «половины»: без спасброска исход не выбирается.
   *
   * @param action - действие
   * @returns действие без привязки к спасброску
   */
  function withoutGate(action: EffectTriggerAction): EffectTriggerAction {
    const { on: _gate, ...rest } = action;

    if (rest.type === 'damage') {
      const { halfOnSave: _half, ...damage } = rest;

      return damage;
    }

    return rest;
  }

  const event = computed({
    get: () => trigger.value.event,
    set: (next: EffectTriggerEvent) => {
      const actions = listTriggerActionTypes(props.layout, next);
      const keepsSave = triggerEventAcceptsSave(next) && trigger.value.save;

      update({
        event: next,
        role:
          next === 'attackRoll'
            ? (trigger.value.role ?? 'attacker')
            : undefined,
        turnOf: isTurnTriggerEvent(next) ? trigger.value.turnOf : undefined,
        save: keepsSave ? trigger.value.save : undefined,
        actions: trigger.value.actions
          .filter((action) => actions.includes(action.type))
          .map((action) => (keepsSave ? action : withoutGate(action))),
      });
    },
  });

  const condition = computed({
    get: () => trigger.value.condition,
    set: (next: string | undefined) => update({ condition: next }),
  });

  const role = computed({
    get: () => trigger.value.role ?? 'attacker',
    set: (next: EffectTriggerAttackRole) => update({ role: next }),
  });

  // Ход носителя — значение по умолчанию: в данных он не пишется
  const turnOf = computed({
    get: () => trigger.value.turnOf ?? 'subject',
    set: (next: EffectTriggerTurnOwner) =>
      update({ turnOf: next === 'subject' ? undefined : next }),
  });

  const hasSave = computed({
    get: () => trigger.value.save !== undefined,
    set: (enabled: boolean) => {
      update(
        enabled
          ? {
              save: {
                ability: DEFAULT_SAVE_ABILITY,
                dc: props.layout.minSaveDc === 0 ? 0 : DEFAULT_EFFECT_SAVE_DC,
              },
            }
          : {
              save: undefined,
              // Без спасброска «при успехе» не наступило бы никогда
              actions: trigger.value.actions.map(withoutGate),
            },
      );
    },
  });

  const saveAbility = computed({
    get: () => trigger.value.save?.ability ?? DEFAULT_SAVE_ABILITY,
    set: (ability: AbilityType) => {
      if (trigger.value.save) {
        update({ save: { ...trigger.value.save, ability } });
      }
    },
  });

  const saveDc = computed({
    get: () => trigger.value.save?.dc ?? props.layout.minSaveDc,
    set: (dc: number) => {
      if (trigger.value.save) {
        update({ save: { ...trigger.value.save, dc } });
      }
    },
  });

  /**
   * Заменяет действие.
   *
   * @param index - номер действия
   * @param action - новое действие
   */
  function updateAction(index: number, action: EffectTriggerAction): void {
    update({
      actions: trigger.value.actions.map((entry, entryIndex) =>
        entryIndex === index ? action : entry,
      ),
    });
  }

  /**
   * Убирает действие.
   *
   * @param index - номер действия
   */
  function removeAction(index: number): void {
    update({
      actions: trigger.value.actions.filter(
        (_action, entryIndex) => entryIndex !== index,
      ),
    });
  }

  /**
   * Новое действие вида.
   *
   * @param type - вид действия
   * @returns действие
   */
  function createAction(type: EffectTriggerActionType): EffectTriggerAction {
    switch (type) {
      case 'damage':
        return { type, parts: [] };
      case 'applyCondition':
        return { type, conditionKey: DEFAULT_CONDITION };
      case 'applyTag':
        return { type, tag: EFFECT_TRIGGER_DEFAULT_TAG };
      default:
        return { type };
    }
  }

  const addActionItems = computed<DropdownMenuItem[]>(() =>
    allowedActions.value.map((type) => ({
      label: EFFECT_TRIGGER_ACTION_LABELS[type],
      icon: EFFECT_TRIGGER_ACTION_ICONS[type],
      onSelect: () =>
        update({ actions: [...trigger.value.actions, createAction(type)] }),
    })),
  );

  /**
   * Исход действия для выбора.
   *
   * @param action - действие
   * @returns гейт
   */
  function gateOf(action: EffectTriggerAction): EffectTriggerActionGate {
    return resolveTriggerActionGate(trigger.value, action);
  }

  /**
   * Исход урона для выбора: «успех — половина» — отдельный вариант.
   *
   * @param action - действие урона
   * @returns вариант
   */
  function damageGateOf(action: EffectTriggerAction): DamageGateChoice {
    return action.type === 'damage' && action.halfOnSave
      ? EFFECT_TRIGGER_DAMAGE_HALF_GATE
      : gateOf(action);
  }

  /**
   * Меняет исход действия.
   *
   * @param index - номер действия
   * @param choice - выбранный исход
   */
  function selectGate(index: number, choice: DamageGateChoice): void {
    const action = withoutGate(trigger.value.actions[index]);

    if (choice === EFFECT_TRIGGER_DAMAGE_HALF_GATE) {
      if (action.type === 'damage') {
        updateAction(index, { ...action, on: 'always', halfOnSave: true });
      }

      return;
    }

    updateAction(index, { ...action, on: choice });
  }

  /**
   * Меняет части урона.
   *
   * @param index - номер действия
   * @param parts - части урона
   */
  function updateDamageParts(index: number, parts: DamagePart[]): void {
    const action = trigger.value.actions[index];

    if (action.type === 'damage') {
      updateAction(index, { ...action, parts });
    }
  }

  /**
   * Меняет состояние действия.
   *
   * @param index - номер действия
   * @param conditionKey - ключ состояния
   */
  function updateCondition(index: number, conditionKey: ConditionRef): void {
    const action = trigger.value.actions[index];

    if (action.type === 'applyCondition') {
      updateAction(index, { ...action, conditionKey });
    }
  }

  /**
   * Меняет срок состояния или отметки в раундах; пусто — срок по умолчанию
   * (состояние — пока не снимут, отметка — до начала следующего хода).
   *
   * @param index - номер действия
   * @param rounds - раундов
   */
  function updateActionRounds(index: number, rounds: number | null): void {
    const action = trigger.value.actions[index];

    if (action.type !== 'applyCondition' && action.type !== 'applyTag') {
      return;
    }

    const { duration: _duration, ...rest } = action;

    updateAction(
      index,
      rounds === null || rounds <= 0
        ? rest
        : { ...rest, duration: { type: 'rounds', value: rounds } },
    );
  }

  /**
   * Срок состояния или отметки в раундах.
   *
   * @param action - действие
   * @returns раундов либо `null`
   */
  function actionRoundsOf(action: EffectTriggerAction): number | null {
    return (action.type === 'applyCondition' || action.type === 'applyTag')
      && action.duration?.type === 'rounds'
      ? (action.duration.value ?? null)
      : null;
  }

  /**
   * Меняет ключ или имя отметки.
   *
   * @param index - номер действия
   * @param patch - новый ключ или имя; пустое имя — как ключ
   */
  function updateTag(
    index: number,
    patch: { tag?: string | number; label?: string | number },
  ): void {
    const action = trigger.value.actions[index];

    if (action.type !== 'applyTag') {
      return;
    }

    const { label: _label, ...rest } = action;
    const label = String(patch.label ?? action.label ?? '').trim();

    updateAction(index, {
      ...rest,
      tag: String(patch.tag ?? action.tag).trim(),
      ...(label ? { label } : {}),
    });
  }

  /**
   * Подсказка к негодному ключу отметки.
   *
   * @param action - действие
   * @returns текст ошибки либо `undefined`
   */
  function tagErrorOf(action: EffectTriggerAction): string | undefined {
    return action.type === 'applyTag' && !isEffectTag(action.tag)
      ? EFFECT_TRIGGER_ROW_LABELS.tagInvalid
      : undefined;
  }

  const hasLimit = computed({
    get: () => trigger.value.limit !== undefined,
    set: (enabled: boolean) =>
      update({
        limit: enabled ? { max: 1, per: DEFAULT_LIMIT_PERIOD } : undefined,
      }),
  });

  const limitMax = computed({
    get: () => trigger.value.limit?.max ?? 1,
    set: (max: number | null) => {
      if (trigger.value.limit) {
        update({ limit: { ...trigger.value.limit, max: max ?? 1 } });
      }
    },
  });

  const limitPer = computed({
    get: () => trigger.value.limit?.per ?? DEFAULT_LIMIT_PERIOD,
    set: (per: EffectTriggerLimitPeriod) => {
      if (trigger.value.limit) {
        update({ limit: { ...trigger.value.limit, per } });
      }
    },
  });
</script>

<template>
  <div class="flex flex-col gap-2 rounded-md border border-default p-2">
    <div class="flex flex-wrap items-end gap-2">
      <UFormField
        :label="EFFECT_TRIGGER_ROW_LABELS.event"
        class="w-48"
      >
        <USelect
          v-model="event"
          :items="eventItems"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <UFormField
        v-if="trigger.event === 'attackRoll'"
        :label="EFFECT_TRIGGER_ROW_LABELS.role"
        class="w-48"
      >
        <USelect
          v-model="role"
          :items="roleItems"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <UFormField
        v-if="showsTurnOwner"
        :label="EFFECT_TRIGGER_ROW_LABELS.turnOf"
        class="w-48"
      >
        <USelect
          v-model="turnOf"
          :items="turnOwnerItems"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <UButton
        color="neutral"
        variant="ghost"
        size="xs"
        icon="tabler:trash"
        class="ml-auto"
        :title="EFFECT_TRIGGER_ROW_LABELS.remove"
        @click.left.exact.prevent="emit('remove')"
      />
    </div>

    <EffectTriggerConditionPicker
      v-model:condition="condition"
      :event="trigger.event"
      :known-tags="knownTags"
    />

    <template v-if="acceptsSave">
      <USwitch
        v-model="hasSave"
        :label="EFFECT_TRIGGER_ROW_LABELS.saveToggle"
      />

      <div
        v-if="trigger.save"
        class="flex flex-wrap items-end gap-3"
      >
        <UFormField
          :label="EFFECT_TRIGGER_ROW_LABELS.saveAbility"
          class="w-48"
        >
          <USelect
            v-model="saveAbility"
            :items="ABILITY_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>

        <SaveDcField
          v-model="saveDc"
          :label="EFFECT_TRIGGER_ROW_LABELS.saveDc"
          :auto-allowed="layout.minSaveDc === 0"
          :auto-label="EFFECT_SOURCE_DC_LABELS[layout.context]"
          :auto-value="sourceSaveDc"
        />
      </div>
    </template>

    <div class="flex flex-col gap-1.5">
      <span class="text-xs font-medium text-default">
        {{ EFFECT_TRIGGER_ROW_LABELS.actionsTitle }}
      </span>

      <p
        v-if="trigger.actions.length === 0"
        class="text-xs text-warning"
      >
        {{ EFFECT_TRIGGER_ROW_LABELS.actionsEmpty }}
      </p>

      <div
        v-for="(action, index) in trigger.actions"
        :key="`${index}-${action.type}`"
        class="flex flex-col gap-1.5 border-l-2 border-default pl-2"
      >
        <div class="flex flex-wrap items-center gap-2">
          <UIcon
            :name="EFFECT_TRIGGER_ACTION_ICONS[action.type]"
            class="size-4 text-muted"
          />

          <span class="text-xs text-default">
            {{ EFFECT_TRIGGER_ACTION_LABELS[action.type] }}
          </span>

          <USelect
            v-if="trigger.save && action.type === 'damage'"
            :model-value="damageGateOf(action)"
            :items="damageGateItems"
            value-key="value"
            size="xs"
            class="w-64"
            :portal="false"
            :aria-label="EFFECT_TRIGGER_ROW_LABELS.gate"
            @update:model-value="selectGate(index, $event)"
          />

          <USelect
            v-else-if="trigger.save"
            :model-value="gateOf(action)"
            :items="gateItems"
            value-key="value"
            size="xs"
            class="w-40"
            :portal="false"
            :aria-label="EFFECT_TRIGGER_ROW_LABELS.gate"
            @update:model-value="selectGate(index, $event)"
          />

          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="tabler:x"
            class="ml-auto"
            :title="EFFECT_TRIGGER_ROW_LABELS.removeAction"
            @click.left.exact.prevent="removeAction(index)"
          />
        </div>

        <DamagePartsEditor
          v-if="action.type === 'damage'"
          :model-value="action.parts"
          :damage-type-options="damageTypeOptions"
          :include-spell-modifier="false"
          :hide-modifiers="true"
          :allow-empty="true"
          @update:model-value="updateDamageParts(index, $event)"
        />

        <div
          v-else-if="action.type === 'applyCondition'"
          class="flex flex-wrap items-end gap-2"
        >
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
              @update:model-value="updateCondition(index, $event)"
            />
          </UFormField>

          <UFormField
            :label="EFFECT_TRIGGER_ROW_LABELS.conditionRounds"
            class="w-40"
          >
            <UInputNumber
              :model-value="actionRoundsOf(action)"
              :min="0"
              :placeholder="
                EFFECT_TRIGGER_ROW_LABELS.conditionRoundsPlaceholder
              "
              size="sm"
              class="w-full"
              @update:model-value="updateActionRounds(index, $event ?? null)"
            />
          </UFormField>
        </div>

        <div
          v-else-if="action.type === 'applyTag'"
          class="flex flex-wrap items-start gap-2"
        >
          <UFormField
            :label="EFFECT_TRIGGER_ROW_LABELS.tag"
            :error="tagErrorOf(action)"
            class="w-56"
          >
            <UInput
              :model-value="action.tag"
              size="sm"
              class="w-full"
              @update:model-value="updateTag(index, { tag: $event })"
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
              @update:model-value="updateTag(index, { label: $event })"
            />
          </UFormField>

          <UFormField
            :label="EFFECT_TRIGGER_ROW_LABELS.conditionRounds"
            class="w-52"
          >
            <UInputNumber
              :model-value="actionRoundsOf(action)"
              :min="0"
              :placeholder="EFFECT_TRIGGER_ROW_LABELS.tagRoundsPlaceholder"
              size="sm"
              class="w-full"
              @update:model-value="updateActionRounds(index, $event ?? null)"
            />
          </UFormField>
        </div>
      </div>

      <UDropdownMenu
        v-if="addActionItems.length > 0"
        :items="addActionItems"
        :content="{ align: 'start' }"
        :ui="SCROLLABLE_DROPDOWN_UI"
      >
        <UButton
          color="primary"
          variant="soft"
          size="xs"
          icon="tabler:plus"
          class="w-fit"
          :label="EFFECT_TRIGGER_ROW_LABELS.addAction"
        />
      </UDropdownMenu>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <USwitch
        v-model="hasLimit"
        :label="EFFECT_TRIGGER_ROW_LABELS.limitToggle"
      />

      <template v-if="trigger.limit">
        <UInputNumber
          v-model="limitMax"
          :min="1"
          size="sm"
          class="w-24"
        />

        <span class="text-xs text-muted">
          {{ EFFECT_TRIGGER_ROW_LABELS.limitTimes }}
        </span>

        <USelect
          v-model="limitPer"
          :items="periodItems"
          value-key="value"
          size="sm"
          class="w-44"
          :portal="false"
        />
      </template>
    </div>
  </div>
</template>
