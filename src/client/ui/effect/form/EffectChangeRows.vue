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
    EffectChangeMode,
    EffectModifierPreset,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import {
    DEFAULT_EFFECT_CHANGE_PRIORITY,
    describeEffectChangeCondition,
    describeEffectChangeKey,
    EFFECT_CONDITION_SUGGESTIONS,
    EFFECT_MODIFIER_MENU,
    EFFECT_TARGET_SUGGESTIONS,
    EFFECT_VALUE_SUGGESTIONS,
    isDiceFormulaValue,
    isEffectTargetKey,
    isNoOpEffectChange,
    validateFormula,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTIVE_EFFECT_DEFAULTS,
    SCROLLABLE_DROPDOWN_UI,
  } from '../../actor/constants';
  import ActiveEffectSuggestionsModal from '../ActiveEffectSuggestionsModal.vue';
  import {
    ACTIVE_EFFECT_TEMPLATES_LABELS,
    DAMAGE_CHANGE_KEY_PREFIX,
    EFFECT_CHANGE_MODE_OPTIONS,
    EFFECT_CHANGE_ROW_LABELS,
    EFFECT_MODIFIERS_STEP_LABELS,
    EFFECT_TEMPLATES_MODAL_IDS,
  } from '../constants';

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
    // Кость-формулы бонус-урона («1к6») числом не считаются: их катает бросок
    if (change.key === '' || isDiceFormulaValue(change.value)) {
      return undefined;
    }

    const result = validateFormula(change.value);

    return result.valid ? undefined : result.error;
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
        isNoOp: isNoOpEffectChange(change),
        showPriority:
          props.showPriorityField
          || change.priority !== DEFAULT_EFFECT_CHANGE_PRIORITY,
        conditionLabel: condition
          ? `${EFFECT_CHANGE_ROW_LABELS.conditionOnlyPrefix}${describeEffectChangeCondition(condition)}`
          : '',
        isDamageKey: change.key.startsWith(DAMAGE_CHANGE_KEY_PREFIX),
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
   * Меню «Готовые»: раздел — вложенное подменю. Ключей полсотни, и одним
   * списком они на экран не помещаются.
   */
  const presetMenuItems: DropdownMenuItem[][] = EFFECT_MODIFIER_MENU.map(
    (group) => [
      {
        label: group.label,
        children: group.items.map((preset) => ({
          label: preset.label,
          onSelect: () => addChangeFromPreset(preset),
        })),
      },
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
    updateChange(index, { value: String(value) });
  }

  /**
   * Меняет режим строки.
   *
   * @param index - номер строки
   * @param mode - режим
   */
  function updateMode(index: number, mode: EffectChangeMode): void {
    updateChange(index, { mode });
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
        updateChange(target.index, { value });

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
          <UButton
            color="primary"
            variant="soft"
            size="xs"
            icon="tabler:list-search"
            :label="EFFECT_MODIFIERS_STEP_LABELS.presets"
            :title="EFFECT_MODIFIERS_STEP_LABELS.changePresetHint"
          />
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
        <UButton
          color="neutral"
          variant="soft"
          size="sm"
          icon="tabler:target"
          class="min-w-48 flex-1 justify-start"
          :title="EFFECT_CHANGE_ROW_LABELS.keyLibrary"
          @click.left.exact.prevent="openLibraryFor('key', row.index)"
        >
          {{ row.keyLabel }}
        </UButton>

        <USelect
          :model-value="row.change.mode"
          :items="EFFECT_CHANGE_MODE_OPTIONS"
          value-key="value"
          size="sm"
          class="w-40"
          :title="EFFECT_CHANGE_ROW_LABELS.mode"
          :portal="false"
          @update:model-value="updateMode(row.index, $event)"
        />

        <UFormField
          :error="row.valueError"
          class="w-44"
        >
          <div class="flex w-full gap-1">
            <UInput
              :model-value="row.change.value"
              :placeholder="EFFECT_CHANGE_ROW_LABELS.valuePlaceholder"
              :title="EFFECT_CHANGE_ROW_LABELS.value"
              size="sm"
              class="flex-1 font-mono text-xs"
              @update:model-value="updateValue(row.index, $event)"
            />

            <UButton
              color="neutral"
              variant="soft"
              icon="tabler:bulb"
              size="sm"
              :title="EFFECT_CHANGE_ROW_LABELS.valueLibrary"
              @click.left.exact.prevent="openLibraryFor('value', row.index)"
            />
          </div>
        </UFormField>

        <UInputNumber
          v-if="row.showPriority"
          :model-value="row.change.priority"
          size="sm"
          class="w-24"
          :title="EFFECT_CHANGE_ROW_LABELS.priorityHint"
          @update:model-value="updatePriority(row.index, $event)"
        />

        <UButton
          color="error"
          variant="soft"
          icon="tabler:trash"
          size="sm"
          :title="EFFECT_CHANGE_ROW_LABELS.remove"
          @click.left.exact.prevent="removeChange(row.index)"
        />
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex w-full gap-1">
          <UInput
            :model-value="row.change.condition ?? ''"
            :placeholder="EFFECT_CHANGE_ROW_LABELS.conditionPlaceholder"
            :title="EFFECT_CHANGE_ROW_LABELS.condition"
            icon="tabler:filter"
            size="sm"
            class="flex-1 font-mono text-xs"
            @update:model-value="updateCondition(row.index, $event)"
          />

          <UButton
            color="neutral"
            variant="soft"
            icon="tabler:bulb"
            size="sm"
            :title="EFFECT_CHANGE_ROW_LABELS.conditionLibrary"
            @click.left.exact.prevent="openLibraryFor('condition', row.index)"
          />
        </div>

        <p
          v-if="row.conditionLabel"
          class="text-xs text-muted"
        >
          {{ row.conditionLabel }}
        </p>
      </div>

      <p
        v-if="row.isNoOp"
        class="text-xs text-warning"
      >
        {{ EFFECT_CHANGE_ROW_LABELS.noOpHint }}
      </p>

      <p
        v-if="row.isDamageKey"
        class="text-xs text-muted italic"
      >
        {{ EFFECT_CHANGE_ROW_LABELS.damageFormulaHint }}
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
