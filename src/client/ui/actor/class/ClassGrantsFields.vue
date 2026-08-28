<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { EditableFeatGrants } from '../feat/featEditorTypes';

  import { computed } from 'vue';

  import { CLASS_FORM_LABELS, FEAT_GRANTS_LABELS } from '../constants';
  import FeatCountersEditor from '../feat/FeatCountersEditor.vue';
  import { usedChoiceKeys } from '../feat/featEditorTypes';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import ModifierRowsEditor from '../feat/ModifierRowsEditor.vue';
  import FormSection from '../FormSection.vue';

  /**
   * Дары класса или его умения — тем же блоком, что у черты.
   *
   * Одна форма на всех, кто что-то выдаёт листу: у потребителя дары черты,
   * класса и умения применяет один и тот же код, и вторая форма для того же
   * смысла означала бы второй разбор. Ровно так же устроена вкладка «Дары» на
   * сайте.
   */
  const grants = defineModel<EditableFeatGrants>({ required: true });

  const props = withDefaults(
    defineProps<{
      /** WebSocket-клиент: им строка дара «Черта» открывает компендиум. */
      socket?: TypedWebSocketClient | null;
    }>(),
    { socket: null },
  );

  /** Занятые ключи выборов: два выбора с одним ключом схлопнулись бы в один. */
  const takenChoiceKeys = computed(() => [...usedChoiceKeys(grants.value)]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <FormSection
      :title="CLASS_FORM_LABELS.grantsTitle"
      icon="tabler:gift"
      :hint="CLASS_FORM_LABELS.grantsHint"
    >
      <GrantRowsEditor
        v-model="grants.grantRows"
        :taken-keys="takenChoiceKeys"
        :socket="props.socket"
      />
    </FormSection>

    <FormSection
      :title="FEAT_GRANTS_LABELS.modifiersTitle"
      icon="tabler:adjustments-filled"
    >
      <ModifierRowsEditor v-model="grants.modifiers" />
    </FormSection>

    <FormSection
      :title="FEAT_GRANTS_LABELS.countersTitle"
      icon="tabler:battery-2"
    >
      <FeatCountersEditor v-model="grants.counters" />
    </FormSection>
  </div>
</template>
