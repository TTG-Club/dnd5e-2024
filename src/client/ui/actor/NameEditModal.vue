<script setup lang="ts">
  /**
   * Окно названия листа: имя персонажа и — у существа — ещё его английское
   * название.
   *
   * Название правится здесь, а не полем прямо в шапке: поле ввода подменяло
   * собой заголовок и сдвигало шапку при каждом включении режима правки. В
   * шапке остался сам заголовок, а окно открывается нажатием на него.
   *
   * Правки копятся в черновике до «Применить»: лист узнаёт о них по кнопке.
   */
  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  import {
    FORM_FIELD_LABELS,
    MODAL_BUTTON_LABELS,
    NAME_EDIT_LABELS,
  } from './constants';

  /** Названия из окна — обе строки уходят на лист одной правкой */
  export interface NameEditResult {
    /** Название на русском */
    name: string;
    /** Английское название; у листа без такого поля остаётся пустым */
    nameEn: string;
  }

  interface Props {
    open: boolean;
    /** Заголовок окна: листы зовут своё название по-разному */
    title: string;
    /** Текущее название листа */
    name: string;
    /** Подсказка пустого поля названия */
    namePlaceholder: string;
    /** Текущее английское название — есть только у существа */
    nameEn?: string;
    /** Правится ли в окне английское название */
    withNameEn?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    nameEn: '',
    withNameEn: false,
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [result: NameEditResult];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftName = ref('');
  const draftNameEn = ref('');

  /**
   * Заводит черновик по данным листа. Окно живёт в шапке постоянно, поэтому
   * черновик собирается на каждом открытии — иначе оно показывало бы тот лист,
   * с которым его открыли впервые.
   */
  watch(
    () => props.open,
    (opened) => {
      if (!opened) {
        return;
      }

      draftName.value = props.name;
      draftNameEn.value = props.nameEn;
    },
  );

  /** Безымянный лист не сохраняем: по названию его находят в списках */
  const canApply = computed(() => draftName.value.trim().length > 0);

  /** Отдаёт названия на лист и закрывает окно */
  function applyNames(): void {
    if (!canApply.value) {
      return;
    }

    emit('apply', {
      name: draftName.value.trim(),
      nameEn: draftNameEn.value.trim(),
    });

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="420"
    :min-height="220"
    :title="title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <UFormField :label="FORM_FIELD_LABELS.name">
          <UInput
            v-model="draftName"
            :placeholder="namePlaceholder"
            autofocus
            class="w-full"
            @keydown.enter.prevent="applyNames"
          />
        </UFormField>

        <!-- Английское название: по нему запись ищется в англоязычных
          источниках, поэтому у существа оно правится тем же окном -->
        <UFormField
          v-if="withNameEn"
          :label="FORM_FIELD_LABELS.nameEn"
        >
          <UInput
            v-model="draftNameEn"
            :placeholder="NAME_EDIT_LABELS.nameEnPlaceholder"
            class="w-full"
            @keydown.enter.prevent="applyNames"
          />
        </UFormField>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            :disabled="!canApply"
            @click.left.exact.prevent="applyNames"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
