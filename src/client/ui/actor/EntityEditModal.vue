<script setup lang="ts">
  import type { ChoicePickerOption } from './ChoicePickerModal.vue';

  import { computed, reactive, watch } from 'vue';

  import JournalEditor from '@/shared_ui/components/JournalEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';

  import ChoicePickerField from './ChoicePickerField.vue';
  import {
    ENTITY_EDIT_LABELS,
    FORM_FIELD_LABELS,
    MODAL_BUTTON_LABELS,
  } from './constants';

  interface FeatureChoice {
    key: string;
    name: string;
    description: string;
  }

  interface EntityData {
    name: string;
    description: string;
    level?: number;
    selectedChoiceKey?: string;
  }

  interface Props {
    open: boolean;
    modalId: string;
    title?: string;
    initialName?: string;
    initialDescription?: string;
    initialLevel?: number;
    showLevel?: boolean;
    /** Варианты для выбора (напр. наследие драконов) */
    choices?: FeatureChoice[];
    /** Ключ текущего выбранного варианта */
    initialChoiceKey?: string;
    /** Заголовок для секции выбора */
    choiceLabel?: string;
    /** Запретить редактирование названия и описания (для SRD-особенностей) */
    readonlyCore?: boolean;
    zIndex?: number;
    savedPosition?: { x: number; y: number };
    savedSize?: { width: number; height: number };
    onSave?: (data: EntityData) => void;
  }

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'bring-to-front': [];
  }>();

  const props = withDefaults(defineProps<Props>(), {
    title: ENTITY_EDIT_LABELS.title,
    initialName: '',
    initialDescription: '',
    initialLevel: undefined,
    showLevel: false,
    choices: undefined,
    initialChoiceKey: undefined,
    choiceLabel: ENTITY_EDIT_LABELS.chooseVariant,
    readonlyCore: false,
    zIndex: undefined,
    savedPosition: undefined,
    savedSize: undefined,
    onSave: () => {},
  });

  const { closeModal } = useModalManager();

  const isOpen = computed({
    get: () => props.open,
    set: (val) => {
      if (!val) {
        handleClose();
      }
    },
  });

  const form = reactive<EntityData>({
    name: '',
    description: '',
    level: 1,
    selectedChoiceKey: undefined,
  });

  /**
   * Текущий выбранный вариант из choices
   */
  const selectedChoice = computed(() => {
    if (!props.choices || !form.selectedChoiceKey) {
      return undefined;
    }

    return props.choices.find(
      (choice) => choice.key === form.selectedChoiceKey,
    );
  });

  /** Варианты для окна выбора: описание читают, не закрывая окна */
  const choiceItems = computed<ChoicePickerOption[]>(() =>
    (props.choices ?? []).map((choice) => ({
      value: choice.key,
      name: choice.name,
      description: choice.description,
    })),
  );

  /** Выбранный вариант набором отметок — так его ждёт строка выбора */
  const choiceSelected = computed(() =>
    form.selectedChoiceKey ? [form.selectedChoiceKey] : [],
  );

  // При открытии — подставляем переданные значения
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        form.name = props.initialName;
        form.description = props.initialDescription;
        form.level = props.initialLevel ?? 1;
        form.selectedChoiceKey = props.initialChoiceKey;
      }
    },
    { immediate: true },
  );

  function handleClose() {
    closeModal(props.modalId);
  }

  /**
   * Обрабатывает выбор варианта: окно отдаёт набор отметок, а вариант берут
   * один.
   *
   * @param choiceKeys - ключи отмеченных вариантов
   */
  function handleChoiceSelect(choiceKeys: string[]) {
    form.selectedChoiceKey = choiceKeys[0];
  }

  function handleSave() {
    const name = form.name.trim();

    if (!name) {
      return;
    }

    if (props.onSave) {
      props.onSave({
        name,
        description: form.description.trim(),
        level: props.showLevel ? form.level : undefined,
        selectedChoiceKey: form.selectedChoiceKey,
      });
    }

    handleClose();
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="true"
    :resizable="true"
    :blocking="false"
    :min-width="450"
    :min-height="400"
    :title="title"
    :z-index="zIndex"
    :saved-position="savedPosition"
    :saved-size="savedSize"
    @on-drag-start="emit('bring-to-front')"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div class="flex h-full w-full flex-col gap-4 px-1 pb-1">
        <div class="flex w-full gap-4">
          <UFormField
            :label="FORM_FIELD_LABELS.name"
            class="flex-1"
          >
            <UInput
              v-model="form.name"
              :placeholder="ENTITY_EDIT_LABELS.namePlaceholder"
              size="md"
              autofocus
              :readonly="readonlyCore"
              class="w-full"
              @keydown.enter.prevent="handleSave"
            />
          </UFormField>

          <UFormField
            v-if="showLevel"
            :label="FORM_FIELD_LABELS.level"
            class="w-32"
          >
            <UInput
              v-model.number="form.level"
              type="number"
              min="1"
              max="20"
              size="md"
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Секция выбора (для особенностей с choices) -->
        <div
          v-if="choices && choices.length > 0"
          class="flex flex-col gap-2 rounded-lg bg-elevated/40 p-3"
        >
          <ChoicePickerField
            :label="choiceLabel"
            :options="choiceItems"
            :selected="choiceSelected"
            :max="1"
            @update:selected="handleChoiceSelect"
          />

          <!-- Описание выбранного варианта -->
          <div
            v-if="selectedChoice"
            class="mt-1 rounded-md bg-default/50 px-3 py-2 text-sm text-muted"
          >
            {{ selectedChoice.description }}
          </div>
        </div>

        <div class="flex min-h-62.5 flex-1 flex-col gap-1.5">
          <span class="text-sm font-medium text-highlighted">
            {{ FORM_FIELD_LABELS.description }}
          </span>

          <JournalEditor
            v-model="form.description"
            class="flex-1"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full items-center justify-end gap-3">
        <UButton
          variant="ghost"
          color="neutral"
          @click.left.exact.prevent="handleClose"
        >
          {{ MODAL_BUTTON_LABELS.cancel }}
        </UButton>

        <UButton
          color="primary"
          :disabled="!form.name.trim()"
          @click.left.exact.prevent="handleSave"
        >
          {{ MODAL_BUTTON_LABELS.save }}
        </UButton>
      </div>
    </template>
  </UDraggableModal>
</template>
