<script setup lang="ts">
  /**
   * Окно подробного описания персонажа — как окно «Подробное описание
   * персонажа» листа на сайте. Текст правится тем же редактором журнала, что
   * и «Заметки», и уходит на лист по «Применить».
   */
  import { computed, ref, watch } from 'vue';

  import JournalEditor from '@/shared_ui/components/JournalEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  import { MODAL_BUTTON_LABELS, PERSONALITY_TAB_LABELS } from './constants';

  interface Props {
    open: boolean;
    /** Описание на момент открытия */
    description: string;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [description: string];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const draftDescription = ref('');

  // Черновик собирается на каждом открытии: окно живёт во вкладке постоянно
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        draftDescription.value = props.description;
      }
    },
    { immediate: true },
  );

  function handleApply(): void {
    emit('apply', draftDescription.value);

    isOpen.value = false;
  }

  function handleCancel(): void {
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="true"
    :resizable="true"
    :blocking="true"
    :initial-width="720"
    :initial-height="520"
    :min-width="480"
    :min-height="320"
    :title="PERSONALITY_TAB_LABELS.descriptionModalTitle"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="flex h-full flex-col gap-3">
        <JournalEditor
          v-model="draftDescription"
          class="min-h-0 flex-1"
        />

        <div class="flex justify-end gap-2">
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
    </template>
  </UDraggableModal>
</template>
