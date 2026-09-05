<script setup lang="ts">
  import type { DnDActor } from '@vtt/shared/system/dnd.js';

  import { ref, watch } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import JournalEditor from '@/shared_ui/components/JournalEditor.vue';

  import { ACTOR_TAB_LABELS } from '../constants';

  /*
   * Вкладка «Заметки» листа актёра.
   *
   * Показ отдан хостовому `ItemDescriptionRenderer` — тому же, что рисует
   * описание существа и предмета. Свой разбор через `marked`, живший здесь:
   * (1) не знал про броски `{@roll 1к6}` и показывал их голым текстом вместо
   * кнопки, (2) не знал про ссылки на материалы, (3) отдавал разметку в
   * `v-html` БЕЗ санитайзера, а заметки правит владелец листа — мастер
   * открывает их у себя.
   */

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
  }>();

  const localNotes = ref(props.actor.notes ?? '');

  watch(
    () => props.actor.notes,
    (newNotes) => {
      if (newNotes !== localNotes.value) {
        localNotes.value = newNotes ?? '';
      }
    },
  );

  watch(localNotes, (newValue) => {
    if (newValue !== props.actor.notes) {
      emit('update:actor', { notes: newValue });
    }
  });
</script>

<template>
  <div>
    <JournalEditor
      v-if="isEditMode"
      v-model="localNotes"
    />

    <div
      v-else
      class="min-h-50 rounded-lg bg-accented/30"
    >
      <ItemDescriptionRenderer
        v-if="actor.notes"
        :content="actor.notes"
        class="p-4"
      />

      <p
        v-else
        class="p-4 text-sm text-dimmed"
      >
        {{ ACTOR_TAB_LABELS.notesEmpty }}
      </p>
    </div>
  </div>
</template>
