<!--
  Строка списка «Срабатывания»: когда → спасбросок → что сделать → сколько раз.
  Что доступно, решает движок по месту окна: события — `layout.triggerEvents`,
  действия — `listTriggerActionTypes`, Сл формулой — `triggerEventAcceptsDcFormula`.
-->
<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { AbilityType } from '@vtt/shared';
  import type {
    EffectFormLayout,
    EffectTrigger,
    EffectTriggerAction,
    EffectTriggerActionGate,
    EffectTriggerActionType,
    EffectTriggerAreaTarget,
    EffectTriggerAttackRole,
    EffectTriggerEvent,
    EffectTriggerLimitPeriod,
    EffectTriggerRecipient,
    EffectTriggerRestType,
    EffectTriggerTurnOwner,
  } from '@vtt/shared/system/dnd.js';

  import type {
    EffectTriggerDamageGateChoice,
    EffectTriggerSaveModeChoice,
  } from '../effectFormOptions';

  import { computed } from 'vue';

  import {
    ABILITY_OPTIONS,
    AREA_TRIGGER_RECIPIENT,
    createDefaultEffectSave,
    DEFAULT_EFFECT_SAVE_ABILITY,
    DEFAULT_EFFECT_TAG,
    DEFAULT_SET_HP_VALUE,
    DEFAULT_TRIGGER_AREA_RADIUS,
    DEFAULT_TRIGGER_AREA_TARGET,
    DEFAULT_TRIGGER_ATTACK_ROLE,
    DEFAULT_TRIGGER_RECIPIENT,
    DEFAULT_TRIGGER_REST_TYPE,
    DEFAULT_TRIGGER_TURN_OWNER,
    isTurnTriggerEvent,
    layoutAcceptsSourceSaveDc,
    listTriggerActionTypes,
    MIN_TRIGGER_LIMIT_MAX,
    resolveTriggerActionGate,
    triggerEventAcceptsDcFormula,
    triggerEventHasRestType,
    triggerEventHasRole,
    validateFormula,
  } from '@vtt/shared/system/dnd.js';

  import { SCROLLABLE_DROPDOWN_UI } from '../../actor/constants';
  import {
    EFFECT_AURA_RADIUS_STEP,
    EFFECT_SOURCE_DC_LABELS,
  } from '../constants';
  import {
    buildTriggerRecipientOptions,
    DEFAULT_TRIGGER_CONDITION,
    DEFAULT_TRIGGER_LIMIT_PERIOD,
    EFFECT_AURA_TARGET_OPTIONS,
    EFFECT_TRIGGER_DAMAGE_GATE_OPTIONS,
    EFFECT_TRIGGER_GATE_OPTIONS,
    EFFECT_TRIGGER_PERIOD_OPTIONS,
    EFFECT_TRIGGER_REST_OPTIONS,
    EFFECT_TRIGGER_ROLE_OPTIONS,
    EFFECT_TRIGGER_SAVE_MODE_OPTIONS,
    triggerEventHasRecipientChoice,
  } from '../effectFormOptions';
  import {
    DEFAULT_MAX_HP_REDUCTION,
    EFFECT_TRIGGER_ACTION_ICONS,
    EFFECT_TRIGGER_ACTION_LABELS,
    EFFECT_TRIGGER_AREA_LABELS,
    EFFECT_TRIGGER_DAMAGE_HALF_GATE,
    EFFECT_TRIGGER_EVENT_LABELS,
    EFFECT_TRIGGER_NORMAL_SAVE_MODE,
    EFFECT_TRIGGER_ROW_LABELS,
    EFFECT_TRIGGER_TURN_OWNER_LABELS,
  } from '../triggerLabels';
  import EffectTriggerActionFields from './EffectTriggerActionFields.vue';
  import EffectTriggerConditionPicker from './EffectTriggerConditionPicker.vue';
  import SaveDcField from './SaveDcField.vue';

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

  /** Строка списка: окно заменяет её целиком при каждой правке */
  const trigger = defineModel<EffectTrigger>('trigger', { required: true });

  /**
   * События в выборе: доступные здесь и то, что уже стоит (неработающее
   * покажет плашка окна).
   */
  const eventItems = computed(() =>
    [...new Set([...props.layout.triggerEvents, trigger.value.event])].map(
      (triggerEvent) => ({
        value: triggerEvent,
        label: EFFECT_TRIGGER_EVENT_LABELS[triggerEvent] ?? triggerEvent,
      }),
    ),
  );

  /** Чей ход в выборе: доступные здесь и то, что уже стоит в данных */
  const turnOwnerItems = computed(() =>
    [
      ...new Set([
        ...props.layout.triggerTurnOwners,
        trigger.value.turnOf ?? DEFAULT_TRIGGER_TURN_OWNER,
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

  const acceptsDcFormula = computed(() =>
    triggerEventAcceptsDcFormula(trigger.value.event),
  );

  const hasOtherParty = computed(() =>
    triggerEventHasRecipientChoice(trigger.value.event),
  );

  const showsRole = computed(() => triggerEventHasRole(trigger.value.event));

  const showsRestType = computed(() =>
    triggerEventHasRestType(trigger.value.event),
  );

  const isAreaRecipient = computed(
    () => trigger.value.recipient === AREA_TRIGGER_RECIPIENT,
  );

  const recipientItems = computed(() =>
    buildTriggerRecipientOptions(trigger.value),
  );

  const acceptsSourceSaveDc = computed(() =>
    layoutAcceptsSourceSaveDc(props.layout),
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
      const { save } = trigger.value;

      update({
        event: next,
        role: triggerEventHasRole(next)
          ? (trigger.value.role ?? DEFAULT_TRIGGER_ATTACK_ROLE)
          : undefined,
        turnOf: isTurnTriggerEvent(next) ? trigger.value.turnOf : undefined,
        restType: triggerEventHasRestType(next)
          ? trigger.value.restType
          : undefined,
        recipient: buildTriggerRecipientOptions({
          ...trigger.value,
          event: next,
        })
          .map((option) => option.value)
          .find((recipientValue) => recipientValue === trigger.value.recipient),
        area: triggerEventHasRecipientChoice(next)
          ? trigger.value.area
          : undefined,
        save: save ? withEventDcFormula(save, next) : undefined,
        actions: trigger.value.actions.filter((action) =>
          actions.includes(action.type),
        ),
      });
    },
  });

  /**
   * Спасбросок без формулы Сл, если новое событие её не знает.
   *
   * @param save - спасбросок строки
   * @param nextEvent - новое событие
   * @returns спасбросок для события
   */
  function withEventDcFormula(
    save: NonNullable<EffectTrigger['save']>,
    nextEvent: EffectTriggerEvent,
  ): NonNullable<EffectTrigger['save']> {
    const { dcFormula: _formula, ...rest } = save;

    return triggerEventAcceptsDcFormula(nextEvent) ? save : rest;
  }

  // Получатель по умолчанию в данных не пишется
  const recipient = computed({
    get: () => trigger.value.recipient ?? DEFAULT_TRIGGER_RECIPIENT,
    set: (next: EffectTriggerRecipient) =>
      update({
        recipient: next === DEFAULT_TRIGGER_RECIPIENT ? undefined : next,
        // «Всем в радиусе» появляется с радиусом по умолчанию
        area:
          next === AREA_TRIGGER_RECIPIENT
            ? (trigger.value.area ?? { radius: DEFAULT_TRIGGER_AREA_RADIUS })
            : undefined,
      }),
  });

  const areaRadius = computed({
    get: () => trigger.value.area?.radius ?? DEFAULT_TRIGGER_AREA_RADIUS,
    set: (radius: number | null) => {
      if (radius !== null) {
        update({ area: { ...trigger.value.area, radius } });
      }
    },
  });

  const areaTarget = computed({
    get: () => trigger.value.area?.target ?? DEFAULT_TRIGGER_AREA_TARGET,
    set: (target: EffectTriggerAreaTarget) =>
      update({
        area: {
          radius: trigger.value.area?.radius ?? DEFAULT_TRIGGER_AREA_RADIUS,
          target: target === DEFAULT_TRIGGER_AREA_TARGET ? undefined : target,
        },
      }),
  });

  const dcFormula = computed({
    get: () => trigger.value.save?.dcFormula ?? '',
    set: (next: string | number) => {
      if (!trigger.value.save) {
        return;
      }

      const { dcFormula: _formula, ...rest } = trigger.value.save;
      const formula = String(next).trim();

      update({ save: formula ? { ...rest, dcFormula: formula } : rest });
    },
  });

  const dcFormulaError = computed(() => {
    const formula = trigger.value.save?.dcFormula;

    return formula ? validateFormula(formula).error : undefined;
  });

  const condition = computed({
    get: () => trigger.value.condition,
    set: (next: string | undefined) => update({ condition: next }),
  });

  const role = computed({
    get: () => trigger.value.role ?? DEFAULT_TRIGGER_ATTACK_ROLE,
    set: (next: EffectTriggerAttackRole) => update({ role: next }),
  });

  // Долгий отдых — значение по умолчанию: в данных он не пишется
  const restType = computed({
    get: () => trigger.value.restType ?? DEFAULT_TRIGGER_REST_TYPE,
    set: (next: EffectTriggerRestType) =>
      update({
        restType: next === DEFAULT_TRIGGER_REST_TYPE ? undefined : next,
      }),
  });

  // Обычный спасбросок в данных не пишется
  const saveMode = computed({
    get: (): EffectTriggerSaveModeChoice =>
      trigger.value.save?.mode ?? EFFECT_TRIGGER_NORMAL_SAVE_MODE,
    set: (next: EffectTriggerSaveModeChoice) => {
      if (!trigger.value.save) {
        return;
      }

      const { mode: _mode, ...rest } = trigger.value.save;

      update({
        save:
          next === EFFECT_TRIGGER_NORMAL_SAVE_MODE
            ? rest
            : { ...rest, mode: next },
      });
    },
  });

  // Ход носителя — значение по умолчанию: в данных он не пишется
  const turnOf = computed({
    get: () => trigger.value.turnOf ?? DEFAULT_TRIGGER_TURN_OWNER,
    set: (next: EffectTriggerTurnOwner) =>
      update({
        turnOf: next === DEFAULT_TRIGGER_TURN_OWNER ? undefined : next,
      }),
  });

  const hasSave = computed({
    get: () => trigger.value.save !== undefined,
    set: (enabled: boolean) => {
      update(
        enabled
          ? { save: createDefaultEffectSave(props.layout) }
          : {
              save: undefined,
              // Без спасброска «при успехе» не наступило бы никогда
              actions: trigger.value.actions.map(withoutGate),
            },
      );
    },
  });

  const saveAbility = computed({
    get: () => trigger.value.save?.ability ?? DEFAULT_EFFECT_SAVE_ABILITY,
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
        return { type, conditionKey: DEFAULT_TRIGGER_CONDITION };
      case 'applyTag':
        return { type, tag: DEFAULT_EFFECT_TAG };
      case 'setHp':
        return { type, value: DEFAULT_SET_HP_VALUE };
      case 'reduceMaxHp':
        return { type, amount: DEFAULT_MAX_HP_REDUCTION };
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
  function damageGateOf(
    action: EffectTriggerAction,
  ): EffectTriggerDamageGateChoice {
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
  function selectGate(
    index: number,
    choice: EffectTriggerDamageGateChoice,
  ): void {
    const action = withoutGate(trigger.value.actions[index]);

    if (choice === EFFECT_TRIGGER_DAMAGE_HALF_GATE) {
      if (action.type === 'damage') {
        updateAction(index, { ...action, on: 'always', halfOnSave: true });
      }

      return;
    }

    updateAction(index, { ...action, on: choice });
  }

  const hasLimit = computed({
    get: () => trigger.value.limit !== undefined,
    set: (enabled: boolean) =>
      update({
        limit: enabled
          ? { max: MIN_TRIGGER_LIMIT_MAX, per: DEFAULT_TRIGGER_LIMIT_PERIOD }
          : undefined,
      }),
  });

  const limitMax = computed({
    get: () => trigger.value.limit?.max ?? MIN_TRIGGER_LIMIT_MAX,
    set: (max: number | null) => {
      if (trigger.value.limit) {
        update({
          limit: { ...trigger.value.limit, max: max ?? MIN_TRIGGER_LIMIT_MAX },
        });
      }
    },
  });

  const limitPer = computed({
    get: () => trigger.value.limit?.per ?? DEFAULT_TRIGGER_LIMIT_PERIOD,
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
        v-if="showsRole"
        :label="EFFECT_TRIGGER_ROW_LABELS.role"
        class="w-48"
      >
        <USelect
          v-model="role"
          :items="EFFECT_TRIGGER_ROLE_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <UFormField
        v-if="showsRestType"
        :label="EFFECT_TRIGGER_ROW_LABELS.restType"
        class="w-48"
      >
        <USelect
          v-model="restType"
          :items="EFFECT_TRIGGER_REST_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <UFormField
        v-if="hasOtherParty"
        :label="EFFECT_TRIGGER_ROW_LABELS.recipient"
        class="w-56"
      >
        <USelect
          v-model="recipient"
          :items="recipientItems"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <template v-if="isAreaRecipient">
        <UFormField
          :label="EFFECT_TRIGGER_AREA_LABELS.radius"
          class="w-28"
        >
          <UInputNumber
            v-model="areaRadius"
            :min="0"
            :step="EFFECT_AURA_RADIUS_STEP"
            size="sm"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="EFFECT_TRIGGER_AREA_LABELS.target"
          class="w-44"
        >
          <USelect
            v-model="areaTarget"
            :items="EFFECT_AURA_TARGET_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>
      </template>

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

      <UFormField
        :label="EFFECT_TRIGGER_ROW_LABELS.saveMode"
        class="w-44"
      >
        <USelect
          v-model="saveMode"
          :items="EFFECT_TRIGGER_SAVE_MODE_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <SaveDcField
        v-model="saveDc"
        :label="EFFECT_TRIGGER_ROW_LABELS.saveDc"
        :auto-allowed="acceptsSourceSaveDc"
        :auto-label="EFFECT_SOURCE_DC_LABELS[layout.context]"
        :auto-value="sourceSaveDc"
      />

      <UFormField
        v-if="acceptsDcFormula"
        :label="EFFECT_TRIGGER_ROW_LABELS.dcFormula"
        :hint="EFFECT_TRIGGER_ROW_LABELS.dcFormulaHint"
        :error="dcFormulaError"
        class="w-72"
      >
        <UInput
          v-model="dcFormula"
          :placeholder="EFFECT_TRIGGER_ROW_LABELS.dcFormulaPlaceholder"
          size="sm"
          class="w-full"
        />
      </UFormField>
    </div>

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
            :items="EFFECT_TRIGGER_DAMAGE_GATE_OPTIONS"
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
            :items="EFFECT_TRIGGER_GATE_OPTIONS"
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

        <EffectTriggerActionFields
          :action="action"
          :layout="layout"
          :source-save-dc="sourceSaveDc"
          @update:action="updateAction(index, $event)"
        />
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
          :min="MIN_TRIGGER_LIMIT_MAX"
          size="sm"
          class="w-24"
        />

        <span class="text-xs text-muted">
          {{ EFFECT_TRIGGER_ROW_LABELS.limitTimes }}
        </span>

        <USelect
          v-model="limitPer"
          :items="EFFECT_TRIGGER_PERIOD_OPTIONS"
          value-key="value"
          size="sm"
          class="w-44"
          :portal="false"
        />
      </template>
    </div>
  </div>
</template>
