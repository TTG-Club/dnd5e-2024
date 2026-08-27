<script setup lang="ts">
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableSpellListExpansion } from './featEditorTypes';

  import { SPELL_LIST_LABELS } from '../constants';
  import FieldHint from '../FieldHint.vue';
  import FormSection from '../FormSection.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';
  import { createSpellListGroup, spellListGroupTitle } from './featEditorTypes';
  import FeatSpellCountField from './FeatSpellCountField.vue';

  /**
   * Таблица «Заклинания метки»: заклинания, которые черта добавляет в список
   * заклинаний КЛАССА.
   *
   * Это не выдача: выданное заклинание персонаж знает и накладывает, а это он
   * лишь может подготовить наравне с классовыми. Свалить их в одну кучу значило
   * бы выдать «Метке исцеления» девять готовых заклинаний вместо двух.
   *
   * Ступенями, а не одним списком, потому что таблица открывается частями: у
   * метки дракона заклинания приходят на 1, 3, 5, 7 и 9 уровнях, и из каждой
   * ступени берут ограниченное число.
   */
  const expansion = defineModel<EditableSpellListExpansion>({ required: true });

  const props = withDefaults(
    defineProps<{
      /** Заклинания компендиума по пакам — для подсказок и выбора пака */
      availableSpells?: SpellOption[];
    }>(),
    { availableSpells: () => [] },
  );

  const emit = defineEmits<{
    /** Открыть детальный просмотр заклинания (id + предпочтённый пак) */
    'open-spell': [spellId: string, packId?: string];
  }>();

  /**
   * Пробрасывает просмотр заклинания наверх: списком владеет форма, и окно
   * записи открывает она же.
   *
   * @param spellId - id заклинания компендиума
   * @param packId - предпочтённый пак
   */
  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }

  function addGroup(): void {
    expansion.value.groups = [
      ...expansion.value.groups,
      createSpellListGroup(),
    ];
  }

  function removeGroup(index: number): void {
    expansion.value.groups = expansion.value.groups.filter(
      (_, groupIndex) => groupIndex !== index,
    );
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="flex items-center gap-1 text-xs text-dimmed">
      {{ SPELL_LIST_LABELS.hint }}
      <FieldHint :text="SPELL_LIST_LABELS.hintDetails" />
    </p>

    <div
      v-if="expansion.groups.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ SPELL_LIST_LABELS.empty }}
    </div>

    <FormSection
      v-for="(group, index) in expansion.groups"
      :key="group.uid"
      :title="spellListGroupTitle(group)"
      icon="tabler:list-numbers"
    >
      <template #actions>
        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="SPELL_LIST_LABELS.removeGroup"
          @click.left.exact.prevent="removeGroup(index)"
        />
      </template>

      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-end gap-2">
          <UFormField class="w-28">
            <template #label>
              <span class="flex items-center gap-1">
                {{ SPELL_LIST_LABELS.requiredLevel }}
                <FieldHint :text="SPELL_LIST_LABELS.requiredLevelHint" />
              </span>
            </template>

            <UInputNumber
              v-model="group.requiredLevel"
              :min="1"
              :max="20"
              size="sm"
              class="w-full"
              :placeholder="SPELL_LIST_LABELS.requiredLevelPlaceholder"
            />
          </UFormField>

          <FeatSpellCountField v-model="group.count" />

          <FieldHint
            :text="SPELL_LIST_LABELS.countHint"
            class="mb-2"
          />
        </div>

        <GrantedSpellsEditor
          v-model="group.spells"
          :available-spells="props.availableSpells"
          @open-spell="forwardOpenSpell"
        />
      </div>
    </FormSection>

    <UButton
      icon="tabler:plus"
      :label="SPELL_LIST_LABELS.addGroup"
      color="primary"
      variant="soft"
      block
      @click.left.exact.prevent="addGroup"
    />

    <!-- Без ступеней отметка ничего не описывает: расширять нечего -->
    <div
      v-if="expansion.groups.length > 0"
      class="flex items-center gap-1"
    >
      <UCheckbox
        v-model="expansion.requiresSpellcasting"
        :label="SPELL_LIST_LABELS.requiresSpellcasting"
      />

      <FieldHint :text="SPELL_LIST_LABELS.requiresSpellcastingHint" />
    </div>
  </div>
</template>
