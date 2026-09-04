<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';

  import type { EditableFeatGrants } from '../feat/featEditorTypes';

  import { computed, useTemplateRef } from 'vue';

  import { CLASS_FORM_LABELS, FEAT_GRANTS_LABELS } from '../constants';
  import { usedChoiceKeys } from '../feat/featEditorTypes';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import ModifierAddMenu from '../feat/ModifierAddMenu.vue';
  import ModifierRowsEditor from '../feat/ModifierRowsEditor.vue';
  import FormSection from '../FormSection.vue';

  /**
   * Дары класса целиком — тем же блоком, что у черты.
   *
   * Одна форма на всех, кто что-то выдаёт листу: у потребителя дары черты,
   * класса и умения применяет один и тот же код, и вторая форма для того же
   * смысла означала бы второй разбор. Ровно так же устроена вкладка «Дары» на
   * сайте.
   *
   * Дары умения и его варианта рисует свой блок (`ClassMechanicsFields`): там к
   * тем же строкам добавлены ресурсы, заклинания и эффекты записи, а у класса
   * они стоят своими разделами вкладки.
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

  /** Список даров: кнопка добавления живёт в шапке своего раздела. */
  const grantRows = useTemplateRef('grantRows');
</script>

<template>
  <div class="flex flex-col gap-4">
    <FormSection
      :title="CLASS_FORM_LABELS.grantsTitle"
      icon="tabler:gift"
      :hint="CLASS_FORM_LABELS.grantsHint"
      :add-label="FEAT_GRANTS_LABELS.addGrant"
      @add="grantRows?.addRow()"
    >
      <GrantRowsEditor
        ref="grantRows"
        v-model="grants.grantRows"
        :taken-keys="takenChoiceKeys"
        :socket="props.socket"
      />
    </FormSection>

    <FormSection
      :title="FEAT_GRANTS_LABELS.modifiersTitle"
      icon="tabler:adjustments-filled"
      :hint="FEAT_GRANTS_LABELS.modifiersHint"
    >
      <!-- Своя кнопка: вид правки выбирают меню, а не одним нажатием -->
      <template #actions>
        <ModifierAddMenu v-model="grants.modifiers" />
      </template>

      <ModifierRowsEditor v-model="grants.modifiers" />
    </FormSection>
  </div>
</template>
