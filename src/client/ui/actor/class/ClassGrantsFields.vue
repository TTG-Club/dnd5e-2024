<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { EditableFeatGrants } from '../feat/featEditorTypes';

  import { computed } from 'vue';

  import { CLASS_FORM_LABELS, FEAT_GRANTS_LABELS } from '../constants';
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
   *
   * Ресурсы блок не рисует: у класса и у его умения они хранятся по-разному —
   * класс своими счётчиками (ступени, уровень появления, колонка таблицы),
   * умение — ресурсом дара. Каждый вызывающий рисует свой.
   */
  const grants = defineModel<EditableFeatGrants>({ required: true });

  const props = withDefaults(
    defineProps<{
      /** WebSocket-клиент: им строка дара «Черта» открывает компендиум. */
      socket?: TypedWebSocketClient | null;
      /**
       * Заголовки блоков. Блок стоит и у класса целиком, и внутри его умения, а
       * «Дары класса» внутри умения вводили бы в заблуждение: выдаёт их умение.
       */
      grantsTitle?: string;
      grantsHint?: string;
      modifiersTitle?: string;
    }>(),
    {
      socket: null,
      grantsTitle: CLASS_FORM_LABELS.grantsTitle,
      grantsHint: CLASS_FORM_LABELS.grantsHint,
      modifiersTitle: FEAT_GRANTS_LABELS.modifiersTitle,
    },
  );

  /** Занятые ключи выборов: два выбора с одним ключом схлопнулись бы в один. */
  const takenChoiceKeys = computed(() => [...usedChoiceKeys(grants.value)]);
</script>

<template>
  <div class="flex flex-col gap-4">
    <FormSection
      :title="props.grantsTitle"
      icon="tabler:gift"
      :hint="props.grantsHint"
    >
      <GrantRowsEditor
        v-model="grants.grantRows"
        :taken-keys="takenChoiceKeys"
        :socket="props.socket"
      />
    </FormSection>

    <FormSection
      :title="props.modifiersTitle"
      icon="tabler:adjustments-filled"
    >
      <ModifierRowsEditor v-model="grants.modifiers" />
    </FormSection>
  </div>
</template>
