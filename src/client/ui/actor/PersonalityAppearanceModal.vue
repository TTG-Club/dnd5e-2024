<script setup lang="ts">
  /**
   * Окно примет персонажа: мировоззрение, возраст, рост, вес, глаза, волосы и
   * кожа — как окно «Приметы персонажа» листа на сайте.
   *
   * Правки копятся в черновике до «Применить»: лист узнаёт о них по кнопке.
   */
  import type {
    DnDActorPersonality,
    PersonalityFieldKey,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    CHARACTER_ALIGNMENT_OPTIONS,
    EMPTY_ACTOR_PERSONALITY,
    PERSONALITY_FIELD_MAX_LENGTH,
    PERSONALITY_TEXT_FIELD_KEYS,
  } from '@vtt/shared/system/dnd.js';

  import {
    MODAL_BUTTON_LABELS,
    PERSONALITY_TAB_LABELS,
    PERSONALITY_TEXT_FIELD_LABELS,
  } from './constants';

  interface Props {
    open: boolean;
    /** Личность персонажа на момент открытия */
    personality: DnDActorPersonality;
    /**
     * Поле, по плитке которого открыли окно: в нём встаёт курсор. null —
     * открыли карандашом раздела, курсор никуда не ставится.
     */
    focusField: PersonalityFieldKey | null;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [personality: DnDActorPersonality];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const textFields = PERSONALITY_TEXT_FIELD_KEYS.map((field) => ({
    key: field,
    ...PERSONALITY_TEXT_FIELD_LABELS[field],
  }));

  const draft = ref<DnDActorPersonality>({ ...EMPTY_ACTOR_PERSONALITY });

  /**
   * Мировоззрение для выбора: пустого значения выбор не держит, «не выбрано»
   * для него — undefined, а на листе — пустая строка.
   */
  const draftAlignment = computed({
    get: () => draft.value.alignment || undefined,
    set: (alignment: string | undefined) => {
      draft.value = { ...draft.value, alignment: alignment ?? '' };
    },
  });

  /**
   * Заводит черновик по листу. Окно живёт во вкладке постоянно, поэтому
   * черновик собирается на каждом открытии — иначе оно показывало бы приметы
   * на момент первого открытия.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      draft.value = { ...props.personality };
    },
    { immediate: true },
  );

  /** Отдаёт приметы на лист и закрывает окно */
  function handleApply(): void {
    emit('apply', draft.value);

    isOpen.value = false;
  }

  /**
   * Сброс формы: приметы очищаются целиком, лист меняется по «Применить».
   * Подробное описание окно не правит — оно остаётся как было.
   */
  function handleReset(): void {
    draft.value = {
      ...EMPTY_ACTOR_PERSONALITY,
      description: draft.value.description,
    };
  }

  function handleCancel(): void {
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="520"
    :min-height="360"
    :title="PERSONALITY_TAB_LABELS.appearanceModalTitle"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <UFormField :label="PERSONALITY_TAB_LABELS.alignment">
          <USelect
            v-model="draftAlignment"
            :items="CHARACTER_ALIGNMENT_OPTIONS"
            :placeholder="PERSONALITY_TAB_LABELS.alignmentPlaceholder"
            :autofocus="focusField === 'alignment'"
            class="w-full"
          />
        </UFormField>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UFormField
            v-for="field in textFields"
            :key="field.key"
            :label="field.label"
          >
            <UInput
              v-model="draft[field.key]"
              :placeholder="field.placeholder"
              :maxlength="PERSONALITY_FIELD_MAX_LENGTH"
              :autofocus="field.key === focusField"
              class="w-full"
              @keydown.enter.prevent="handleApply"
            />
          </UFormField>
        </div>

        <div class="flex items-center justify-between gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="handleReset"
          >
            {{ PERSONALITY_TAB_LABELS.reset }}
          </UButton>

          <div class="flex gap-2">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              @click.left.exact.prevent="handleCancel"
            >
              {{ MODAL_BUTTON_LABELS.cancel }}
            </UButton>

            <UButton
              color="primary"
              size="sm"
              @click.left.exact.prevent="handleApply"
            >
              {{ MODAL_BUTTON_LABELS.apply }}
            </UButton>
          </div>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
