<!--
  Строки модификаторов эффекта: «что меняется», режим, значение и условие.
  Приоритет показывается в режиме «для опытных» или когда у строки он уже
  задан — прятать заданное нельзя.
-->
<script setup lang="ts">
  // Корневой вход `@nuxt/ui` типов компонентов не отдаёт — берём из подпути
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';
  import type { WritableComputedRef } from 'vue';

  import type {
    EffectChange,
    EffectChangeModeChoice,
    EffectChangeStep,
    EffectModifierMenuItem,
    EffectModifierPreset,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import {
    applyEffectChangeModeChoice,
    canStepEffectChangeValue,
    DEFAULT_EFFECT_CHANGE_PRIORITY,
    describeEffectChangeCondition,
    describeEffectChangeKey,
    describeEffectChangeValueHint,
    EFFECT_CONDITION_SUGGESTIONS,
    EFFECT_MODIFIER_MENU,
    EFFECT_TARGET_SUGGESTIONS,
    EFFECT_VALUE_SUGGESTIONS,
    getEffectChangeModeChoice,
    getEffectChangeShownValue,
    isDiceFormulaValue,
    isEffectModifierSubmenu,
    isEffectTargetKey,
    isNoOpEffectChange,
    isRollTimeDiceKey,
    MAX_EFFECT_CHANGE_STEP,
    toStoredEffectChangeValue,
    validateFormula,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTIVE_EFFECT_DEFAULTS,
    SCROLLABLE_DROPDOWN_UI,
  } from '../../actor/constants';
  import FieldHint from '../../actor/FieldHint.vue';
  import ActiveEffectSuggestionsModal from '../ActiveEffectSuggestionsModal.vue';
  import {
    ACTIVE_EFFECT_TEMPLATES_LABELS,
    DAMAGE_CHANGE_KEY_PREFIX,
    DEFAULT_CHANGE_STEP_BY,
    DEFAULT_CHANGE_STEP_PER,
    EFFECT_CHANGE_MODE_OPTIONS,
    EFFECT_CHANGE_ROW_LABELS,
    EFFECT_CHANGE_STEP_LABELS,
    EFFECT_MODIFIERS_STEP_LABELS,
    EFFECT_TEMPLATES_MODAL_IDS,
  } from '../constants';
  import { EFFECT_CHANGE_STEP_PER_OPTIONS } from '../effectFormOptions';

  const props = defineProps<{
    /** Показывать приоритет у всех строк */
    showPriorityField: boolean;
  }>();

  const changes = defineModel<EffectChange[]>('changes', { required: true });

  /** Библиотека подсказок, открытая для строки */
  type ChangeLibraryKind = 'key' | 'value' | 'condition';

  /** Открытая библиотека и строка, для которой она открыта */
  const openLibrary = ref<{ kind: ChangeLibraryKind; index: number } | null>(
    null,
  );

  /**
   * Ошибка значения строки — подписью под полем.
   *
   * Нечитаемое значение («40 фт», опечатка) движок не применяет, и понять это
   * по листу невозможно. Сохранять такую строку не запрещаем — иначе старые
   * записи стало бы не сохранить, — но молчать о ней нельзя. Строка без ключа
   * заведена ради условия, значения у неё ещё нет.
   *
   * @param change - строка модификатора
   * @returns текст ошибки либо `undefined`
   */
  function valueError(change: EffectChange): string | undefined {
    if (change.key === '') {
      return undefined;
    }

    // Кость числом не считается: её катает бросок — если он у ключа вообще
    // есть. Кость в «Классе доспеха» движок молча пропустил бы
    if (isDiceFormulaValue(change.value)) {
      if (!isRollTimeDiceKey(change.key)) {
        return EFFECT_CHANGE_ROW_LABELS.diceNotRolledError;
      }

      return change.mode === 'add'
        ? undefined
        : EFFECT_CHANGE_ROW_LABELS.diceModeError;
    }

    const result = validateFormula(change.value);

    return result.valid ? undefined : result.error;
  }

  /**
   * Подсказка под шагом строки. Шаг двигает число; у формулы и пустого
   * значения двигать нечего — тогда подсказка становится предупреждением.
   *
   * @param change - строка модификатора
   * @param change.value - значение строки
   * @returns текст подсказки и её цвет
   */
  function describeStepHint(change: Pick<EffectChange, 'value'>): {
    stepHint: string;
    stepHintClass: string;
  } {
    return canStepEffectChangeValue(change.value)
      ? {
          stepHint: EFFECT_CHANGE_STEP_LABELS.hint,
          stepHintClass: 'text-muted',
        }
      : {
          stepHint: EFFECT_CHANGE_STEP_LABELS.numberHint,
          stepHintClass: 'text-warning',
        };
  }

  /**
   * Пояснение к значению под иконкой ⓘ: у урона — как задать кости, тип и
   * цель, у кости к броску — что она бросается заново. Текст длинный, и
   * строкой под полем он занимал больше места, чем сама строка модификатора.
   *
   * @param change - строка модификатора
   * @returns текст пояснения либо пустая строка
   */
  function describeValueHelp(change: EffectChange): string {
    if (change.key.startsWith(DAMAGE_CHANGE_KEY_PREFIX)) {
      return EFFECT_CHANGE_ROW_LABELS.damageFormulaHint;
    }

    const isRollDice =
      change.mode === 'add'
      && isRollTimeDiceKey(change.key)
      && isDiceFormulaValue(change.value);

    return isRollDice ? EFFECT_CHANGE_ROW_LABELS.rollDiceHint : '';
  }

  /**
   * Расшифровка значения под полем — как «Только: …» у условия.
   *
   * @param change - строка модификатора
   * @returns подпись либо пустая строка, если значение понятно и так
   */
  function describeValueLabel(change: EffectChange): string {
    const readable = describeEffectChangeValueHint(change);

    return readable
      ? `${EFFECT_CHANGE_ROW_LABELS.valueReadablePrefix}${readable}`
      : '';
  }

  /** Строки с вычисленными подписями и видимостью полей */
  const rows = computed(() =>
    changes.value.map((change, index) => {
      const condition = change.condition?.trim() ?? '';

      return {
        index,
        change,
        keyLabel: change.key
          ? describeEffectChangeKey(change.key)
          : EFFECT_CHANGE_ROW_LABELS.keyPlaceholder,
        valueError: valueError(change),
        // «Вычесть» — только в форме: в данных это «Добавить» с минусом
        modeChoice: getEffectChangeModeChoice(change),
        shownValue: getEffectChangeShownValue(change),
        isNoOp: isNoOpEffectChange(change),
        showPriority:
          props.showPriorityField
          || change.priority !== DEFAULT_EFFECT_CHANGE_PRIORITY,
        conditionLabel: condition
          ? `${EFFECT_CHANGE_ROW_LABELS.conditionOnlyPrefix}${describeEffectChangeCondition(condition)}`
          : '',
        valueLabel: describeValueLabel(change),
        valueHelp: describeValueHelp(change),
        hasStep: change.step !== undefined,
        ...describeStepHint(change),
      };
    }),
  );

  /**
   * Меняет поля строки.
   *
   * @param index - номер строки
   * @param patch - изменённые поля
   */
  function updateChange(index: number, patch: Partial<EffectChange>): void {
    changes.value = changes.value.map((change, changeIndex) =>
      changeIndex === index ? { ...change, ...patch } : change,
    );
  }

  /** Добавляет строку со значениями по умолчанию */
  function addChange(): void {
    changes.value = [
      ...changes.value,
      {
        key: ACTIVE_EFFECT_DEFAULTS.changeKey,
        mode: 'add',
        value: ACTIVE_EFFECT_DEFAULTS.changeValue,
        condition: '',
        priority: ACTIVE_EFFECT_DEFAULTS.changePriority,
      },
    ];
  }

  /**
   * Добавляет строку по готовому пункту меню: ключ, режим и (где он осмыслен)
   * значение уже проставлены.
   *
   * @param preset - пункт меню «Готовые»
   */
  function addChangeFromPreset(preset: EffectModifierPreset): void {
    // Пункт-условие оставляет ключ и значение пустыми намеренно: он отвечает
    // только за «когда», а «что менять» автор называет сам
    const isConditionPreset = Boolean(preset.condition);

    changes.value = [
      ...changes.value,
      {
        key: preset.key,
        mode: preset.mode,
        value:
          preset.value
          ?? (isConditionPreset ? '' : ACTIVE_EFFECT_DEFAULTS.changeValue),
        condition: preset.condition ?? '',
        priority: ACTIVE_EFFECT_DEFAULTS.changePriority,
      },
    ];
  }

  /**
   * Пункт выпадающего меню: готовая строка либо подменю её вариантов.
   *
   * @param item - пункт раздела меню
   * @returns пункт выпадающего меню
   */
  function toDropdownItem(item: EffectModifierMenuItem): DropdownMenuItem {
    if (isEffectModifierSubmenu(item)) {
      return {
        label: item.label,
        children: item.options.map((option) => ({
          label: option.label,
          onSelect: () => addChangeFromPreset(option),
        })),
      };
    }

    return { label: item.label, onSelect: () => addChangeFromPreset(item) };
  }

  /**
   * Меню «Готовые»: раздел — вложенное подменю. Ключей полсотни, и одним
   * списком они на экран не помещаются.
   */
  const presetMenuItems: DropdownMenuItem[][] = EFFECT_MODIFIER_MENU.map(
    (group) => [
      { label: group.label, children: group.items.map(toDropdownItem) },
    ],
  );

  /**
   * Удаляет строку.
   *
   * @param index - номер строки
   */
  function removeChange(index: number): void {
    changes.value = changes.value.filter(
      (_change, changeIndex) => changeIndex !== index,
    );
  }

  /**
   * Меняет значение строки.
   *
   * @param index - номер строки
   * @param value - значение поля
   */
  function updateValue(index: number, value: string | number): void {
    const change = changes.value[index];

    if (change) {
      updateChange(index, {
        value: toStoredEffectChangeValue(change, String(value)),
      });
    }
  }

  /**
   * Меняет режим строки. Число в поле остаётся тем, что видел автор.
   *
   * @param index - номер строки
   * @param choice - режим, в том числе «Вычесть»
   */
  function updateMode(index: number, choice: EffectChangeModeChoice): void {
    const change = changes.value[index];

    if (change) {
      updateChange(index, applyEffectChangeModeChoice(change, choice));
    }
  }

  /**
   * Меняет условие строки.
   *
   * @param index - номер строки
   * @param condition - условие
   */
  function updateCondition(index: number, condition: string | number): void {
    updateChange(index, { condition: String(condition) });
  }

  /**
   * Включает или убирает шаг строки. Новый шаг — «−1 каждый ход»: правило,
   * ради которого шаг и заводят, обычно убывающее.
   *
   * @param index - номер строки
   * @param enabled - нужен ли шаг
   */
  function toggleStep(index: number, enabled: boolean): void {
    updateChange(index, {
      step: enabled
        ? { by: DEFAULT_CHANGE_STEP_BY, per: DEFAULT_CHANGE_STEP_PER }
        : undefined,
    });
  }

  /**
   * Меняет поля шага строки.
   *
   * @param index - номер строки
   * @param patch - изменённые поля шага
   */
  function updateStep(index: number, patch: Partial<EffectChangeStep>): void {
    const step = changes.value[index]?.step;

    if (step) {
      updateChange(index, { step: { ...step, ...patch } });
    }
  }

  /**
   * Меняет величину шага; пустое поле — шаг стоит на месте, пока автор
   * набирает число.
   *
   * @param index - номер строки
   * @param by - на сколько за период
   */
  function updateStepBy(index: number, by: number | null): void {
    updateStep(index, { by: by ?? 0 });
  }

  /**
   * Меняет предел шага: пустое поле — «без предела».
   *
   * @param index - номер строки
   * @param until - предел
   */
  function updateStepUntil(index: number, until: number | null): void {
    updateStep(index, { until: until ?? undefined });
  }

  /**
   * Меняет приоритет строки; пустое поле не трогает запись, пока автор
   * набирает число.
   *
   * @param index - номер строки
   * @param priority - приоритет
   */
  function updatePriority(index: number, priority: number | null): void {
    if (priority !== null) {
      updateChange(index, { priority });
    }
  }

  /**
   * Открывает библиотеку подсказок для строки.
   *
   * @param kind - какая библиотека
   * @param index - номер строки
   */
  function openLibraryFor(kind: ChangeLibraryKind, index: number): void {
    openLibrary.value = { kind, index };
  }

  /**
   * Состояние окна библиотеки для `v-model:open`.
   *
   * @param kind - какая библиотека
   * @returns открыто ли окно
   */
  function libraryOpenModel(
    kind: ChangeLibraryKind,
  ): WritableComputedRef<boolean> {
    return computed({
      get: () => openLibrary.value?.kind === kind,
      set: (open: boolean) => {
        if (!open) {
          openLibrary.value = null;
        }
      },
    });
  }

  const isKeyLibraryOpen = libraryOpenModel('key');
  const isValueLibraryOpen = libraryOpenModel('value');
  const isConditionLibraryOpen = libraryOpenModel('condition');

  /**
   * Подставляет выбранное в библиотеке в строку и закрывает окно.
   *
   * @param kind - какая библиотека
   * @param value - выбранное значение
   */
  function applyLibraryValue(kind: ChangeLibraryKind, value: string): void {
    const target = openLibrary.value;

    openLibrary.value = null;

    if (!target || target.kind !== kind) {
      return;
    }

    switch (kind) {
      case 'key':
        // Подборщик отдаёт строку — сверяем с закрытым списком ключей движка
        if (isEffectTargetKey(value)) {
          updateChange(target.index, { key: value });
        }

        break;
      case 'value':
        // Через поле, а не в обход: у «Вычесть» подсказка ложится с минусом
        updateValue(target.index, value);

        break;
      case 'condition':
      default:
        updateChange(target.index, { condition: value });

        break;
    }
  }
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-default">
        {{ EFFECT_MODIFIERS_STEP_LABELS.changesTitle }}
      </span>

      <div class="flex items-center gap-1">
        <UDropdownMenu
          :items="presetMenuItems"
          :content="{ align: 'end' }"
          :ui="SCROLLABLE_DROPDOWN_UI"
        >
          <UTooltip :text="EFFECT_MODIFIERS_STEP_LABELS.changePresetHint">
            <UButton
              color="primary"
              variant="soft"
              size="xs"
              icon="tabler:list-search"
              :label="EFFECT_MODIFIERS_STEP_LABELS.presets"
            />
          </UTooltip>
        </UDropdownMenu>

        <UButton
          color="primary"
          variant="ghost"
          size="xs"
          icon="tabler:plus"
          :label="EFFECT_MODIFIERS_STEP_LABELS.add"
          @click.left.exact.prevent="addChange"
        />
      </div>
    </div>

    <p
      v-if="rows.length === 0"
      class="rounded-md border border-dashed border-default px-3 py-2 text-center text-xs text-dimmed"
    >
      {{ EFFECT_MODIFIERS_STEP_LABELS.changesEmpty }}
    </p>

    <div
      v-for="row in rows"
      :key="row.index"
      class="flex flex-col gap-2 rounded-md border border-default bg-elevated/50 px-3 py-2"
    >
      <div class="flex flex-wrap items-start gap-2">
        <UTooltip :text="EFFECT_CHANGE_ROW_LABELS.keyLibrary">
          <UButton
            color="neutral"
            variant="soft"
            size="sm"
            icon="tabler:target"
            class="min-w-48 flex-1 justify-start"
            @click.left.exact.prevent="openLibraryFor('key', row.index)"
          >
            {{ row.keyLabel }}
          </UButton>
        </UTooltip>

        <UTooltip :text="EFFECT_CHANGE_ROW_LABELS.mode">
          <div class="w-40">
            <USelect
              :model-value="row.modeChoice"
              :items="EFFECT_CHANGE_MODE_OPTIONS"
              value-key="value"
              size="sm"
              class="w-full"
              :portal="false"
              @update:model-value="updateMode(row.index, $event)"
            />
          </div>
        </UTooltip>

        <UTooltip
          v-if="row.showPriority"
          :text="EFFECT_CHANGE_ROW_LABELS.priorityHint"
        >
          <div class="w-24">
            <UInputNumber
              :model-value="row.change.priority"
              size="sm"
              class="w-full"
              @update:model-value="updatePriority(row.index, $event)"
            />
          </div>
        </UTooltip>

        <UTooltip :text="EFFECT_CHANGE_ROW_LABELS.remove">
          <UButton
            color="error"
            variant="soft"
            icon="tabler:trash"
            size="sm"
            @click.left.exact.prevent="removeChange(row.index)"
          />
        </UTooltip>
      </div>

      <UFormField :error="row.valueError">
        <div class="flex flex-col gap-1">
          <div class="flex w-full items-center gap-1">
            <UTooltip :text="EFFECT_CHANGE_ROW_LABELS.value">
              <div class="min-w-0 flex-1">
                <UInput
                  :model-value="row.shownValue"
                  :placeholder="EFFECT_CHANGE_ROW_LABELS.valuePlaceholder"
                  icon="tabler:calculator"
                  size="sm"
                  class="w-full font-mono text-xs"
                  @update:model-value="updateValue(row.index, $event)"
                />
              </div>
            </UTooltip>

            <UTooltip :text="EFFECT_CHANGE_ROW_LABELS.valueLibrary">
              <UButton
                color="neutral"
                variant="soft"
                icon="tabler:bulb"
                size="sm"
                @click.left.exact.prevent="openLibraryFor('value', row.index)"
              />
            </UTooltip>

            <FieldHint
              v-if="row.valueHelp"
              :text="row.valueHelp"
            />
          </div>

          <p
            v-if="row.valueLabel"
            class="text-xs text-muted"
          >
            {{ row.valueLabel }}
          </p>
        </div>
      </UFormField>

      <div class="flex flex-col gap-1">
        <div class="flex w-full gap-1">
          <UTooltip :text="EFFECT_CHANGE_ROW_LABELS.condition">
            <div class="min-w-0 flex-1">
              <UInput
                :model-value="row.change.condition ?? ''"
                :placeholder="EFFECT_CHANGE_ROW_LABELS.conditionPlaceholder"
                icon="tabler:filter"
                size="sm"
                class="w-full font-mono text-xs"
                @update:model-value="updateCondition(row.index, $event)"
              />
            </div>
          </UTooltip>

          <UTooltip :text="EFFECT_CHANGE_ROW_LABELS.conditionLibrary">
            <UButton
              color="neutral"
              variant="soft"
              icon="tabler:bulb"
              size="sm"
              @click.left.exact.prevent="openLibraryFor('condition', row.index)"
            />
          </UTooltip>
        </div>

        <p
          v-if="row.conditionLabel"
          class="text-xs text-muted"
        >
          {{ row.conditionLabel }}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <USwitch
            :model-value="row.hasStep"
            :label="EFFECT_CHANGE_STEP_LABELS.toggle"
            size="sm"
            @update:model-value="toggleStep(row.index, $event)"
          />

          <template v-if="row.change.step">
            <UTooltip :text="EFFECT_CHANGE_STEP_LABELS.by">
              <div class="w-24">
                <UInputNumber
                  :model-value="row.change.step.by"
                  :min="-MAX_EFFECT_CHANGE_STEP"
                  :max="MAX_EFFECT_CHANGE_STEP"
                  size="sm"
                  class="w-full"
                  @update:model-value="updateStepBy(row.index, $event)"
                />
              </div>
            </UTooltip>

            <UTooltip :text="EFFECT_CHANGE_STEP_LABELS.per">
              <div class="w-52">
                <USelect
                  :model-value="row.change.step.per"
                  :items="EFFECT_CHANGE_STEP_PER_OPTIONS"
                  value-key="value"
                  size="sm"
                  class="w-full"
                  :portal="false"
                  @update:model-value="updateStep(row.index, { per: $event })"
                />
              </div>
            </UTooltip>

            <UTooltip :text="EFFECT_CHANGE_STEP_LABELS.until">
              <div class="w-28">
                <UInputNumber
                  :model-value="row.change.step.until ?? null"
                  size="sm"
                  class="w-full"
                  :placeholder="EFFECT_CHANGE_STEP_LABELS.untilPlaceholder"
                  @update:model-value="updateStepUntil(row.index, $event)"
                />
              </div>
            </UTooltip>
          </template>
        </div>

        <p
          v-if="row.hasStep"
          class="text-xs"
          :class="row.stepHintClass"
        >
          {{ row.stepHint }}
        </p>
      </div>

      <p
        v-if="row.isNoOp"
        class="text-xs text-warning"
      >
        {{ EFFECT_CHANGE_ROW_LABELS.noOpHint }}
      </p>
    </div>
  </div>

  <ActiveEffectSuggestionsModal
    v-model:open="isKeyLibraryOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.keyTitle"
    :search-placeholder="ACTIVE_EFFECT_TEMPLATES_LABELS.keySearchPlaceholder"
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.keyEmpty"
    :items="EFFECT_TARGET_SUGGESTIONS"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.key"
    @select="applyLibraryValue('key', $event)"
  />

  <ActiveEffectSuggestionsModal
    v-model:open="isValueLibraryOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.valueTitle"
    :search-placeholder="ACTIVE_EFFECT_TEMPLATES_LABELS.valueSearchPlaceholder"
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.valueEmpty"
    :items="EFFECT_VALUE_SUGGESTIONS"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.value"
    @select="applyLibraryValue('value', $event)"
  />

  <ActiveEffectSuggestionsModal
    v-model:open="isConditionLibraryOpen"
    :title="ACTIVE_EFFECT_TEMPLATES_LABELS.conditionTitle"
    :search-placeholder="
      ACTIVE_EFFECT_TEMPLATES_LABELS.conditionSearchPlaceholder
    "
    :empty-label="ACTIVE_EFFECT_TEMPLATES_LABELS.conditionEmpty"
    :items="EFFECT_CONDITION_SUGGESTIONS"
    :modal-id="EFFECT_TEMPLATES_MODAL_IDS.condition"
    @select="applyLibraryValue('condition', $event)"
  />
</template>
