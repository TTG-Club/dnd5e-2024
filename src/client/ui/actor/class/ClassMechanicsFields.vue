<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { ActiveEffect } from '@vtt/shared/system/dnd.js';

  import type { EditableFeatGrants } from '../feat/featEditorTypes';
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { ClassMechanicsTitles } from './classEditorTypes';

  import { computed, useTemplateRef } from 'vue';

  import {
    FEAT_GRANTS_LABELS,
    GRANTED_SPELL_GROUPS_LABELS,
    MODAL_BUTTON_LABELS,
    SPELL_CHOICE_LABELS,
    SPELL_LIST_LABELS,
  } from '../constants';
  import CounterRowsEditor from '../CounterRowsEditor.vue';
  import EditorNestedSection from '../EditorNestedSection.vue';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import { usedChoiceKeys } from '../feat/featEditorTypes';
  import FeatSpellListEditor from '../feat/FeatSpellListEditor.vue';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import ModifierAddMenu from '../feat/ModifierAddMenu.vue';
  import ModifierRowsEditor from '../feat/ModifierRowsEditor.vue';
  import SpellChoiceRowsEditor from '../feat/SpellChoiceRowsEditor.vue';
  import GrantedSpellGroupsEditor from '../GrantedSpellGroupsEditor.vue';

  /**
   * Механика и эффекты записи класса — умения либо его варианта.
   *
   * Одна форма на двоих, потому что и умение, и вариант делают с листом одно и
   * то же: выдают владения, правят числа, заводят ресурс, дают заклинание.
   * Вторая форма для того же смысла разошлась бы с первой при первой же правке,
   * а лист применяет их одним и тем же кодом.
   *
   * Различаются только подписи (их приносит {@link ClassMechanicsTitles}) и
   * колонка таблицы у ресурса: ресурс умения попадает в таблицу прогрессии
   * класса, ресурс варианта — нет, вариант могут и не взять.
   */
  const props = withDefaults(
    defineProps<{
      /** Подписи блоков: свои у умения и свои у варианта. */
      titles: ClassMechanicsTitles;
      /**
       * Идентификатор окна редактора эффекта. Свой у каждой записи: имена окон —
       * плоское глобальное пространство, и два редактора с одним именем
       * открылись бы одним окном на двоих.
       */
      effectsModalId: string;
      /** Заклинания компендиума по пакам — для подсказок связывания. */
      availableSpells?: SpellOption[];
      /**
       * Сокет для окна выбора заклинания из компендиума. Без него добавить
       * заклинание нечем: другого способа завести запись у редактора нет.
       */
      socket?: TypedWebSocketClient | null;
      /**
       * Показывать у ресурса галочку колонки таблицы. Есть у умения — его
       * ресурс идёт в таблицу прогрессии класса; у варианта её нет: вариант
       * могут и не взять, а колонка таблицы стоит у всех.
       */
      withTableColumn?: boolean;
    }>(),
    { availableSpells: () => [], socket: null, withTableColumn: false },
  );

  /** Дары записи строками — тем же блоком, что у черты. */
  const grants = defineModel<EditableFeatGrants>('grants', { required: true });

  /** Активные эффекты записи. */
  const activeEffects = defineModel<ActiveEffect[]>('activeEffects', {
    required: true,
  });

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  /** Занятые ключи выборов: два выбора с одним ключом схлопнулись бы в один. */
  const takenChoiceKeys = computed(() => [...usedChoiceKeys(grants.value)]);

  /**
   * Списки разделов: кнопка добавления живёт в шапке раздела, а знание о том,
   * какой получается новая строка, остаётся у самого редактора — форма лишь
   * дёргает его за открытый наружу метод.
   */
  const grantRows = useTemplateRef('grantRows');
  const counterRows = useTemplateRef('counterRows');
  const spellGroups = useTemplateRef('spellGroups');
  const spellChoiceRows = useTemplateRef('spellChoiceRows');
  const spellListGroups = useTemplateRef('spellListGroups');
  const effectRows = useTemplateRef('effectRows');

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <EditorNestedSection
      :title="props.titles.grants"
      :hint="props.titles.grantsHint"
      :count="grants.grantRows.length"
      :add-label="FEAT_GRANTS_LABELS.addGrant"
      :collapsible="false"
      @add="grantRows?.addRow()"
    >
      <GrantRowsEditor
        ref="grantRows"
        v-model="grants.grantRows"
        :taken-keys="takenChoiceKeys"
        :socket="props.socket"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.modifiers"
      :hint="props.titles.modifiersHint"
      :count="grants.modifiers.length"
      :collapsible="false"
    >
      <!-- Своя кнопка: вид правки выбирают меню, а не одним нажатием -->
      <template #actions>
        <ModifierAddMenu v-model="grants.modifiers" />
      </template>

      <ModifierRowsEditor v-model="grants.modifiers" />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.counters"
      :hint="props.titles.countersHint"
      :count="grants.counters.length"
      :add-label="FEAT_GRANTS_LABELS.addCounter"
      :collapsible="false"
      @add="counterRows?.addCounter()"
    >
      <CounterRowsEditor
        ref="counterRows"
        v-model="grants.counters"
        :with-table-column="props.withTableColumn"
      />
    </EditorNestedSection>

    <!-- Группами: у каждой свой уровень открытия и свой источник — перечисленные
      заклинания либо весь список класса. Поуровневая выдача домена и клятвы —
      это те же группы со своим уровнем -->
    <EditorNestedSection
      :title="props.titles.spells"
      :hint="props.titles.spellsHint"
      :count="grants.grantedSpellGroups.length"
      :add-label="GRANTED_SPELL_GROUPS_LABELS.add"
      :collapsible="false"
      @add="spellGroups?.addGroup()"
    >
      <GrantedSpellGroupsEditor
        ref="spellGroups"
        v-model="grants.grantedSpellGroups"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        @open-spell="forwardOpenSpell"
      />
    </EditorNestedSection>

    <!-- Заклинания, которые игрок выбирает сам: «Договор Гримуара» предлагает
      три заговора. Отдельно от выдачи — там заклинание названо записью, здесь
      его называет игрок, и спрашивает его мастер класса -->
    <EditorNestedSection
      :title="props.titles.spellChoice"
      :hint="props.titles.spellChoiceHint"
      :count="grants.spellChoice.picks.length"
      :add-label="SPELL_CHOICE_LABELS.add"
      :collapsible="false"
      @add="spellChoiceRows?.addRow()"
    >
      <SpellChoiceRowsEditor
        ref="spellChoiceRows"
        v-model="grants.spellChoice"
        :taken-keys="takenChoiceKeys"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        @open-spell="forwardOpenSpell"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.spellList"
      :hint="props.titles.spellListHint"
      :count="grants.spellList.groups.length"
      :add-label="SPELL_LIST_LABELS.addGroup"
      :collapsible="false"
      @add="spellListGroups?.addGroup()"
    >
      <FeatSpellListEditor
        ref="spellListGroups"
        v-model="grants.spellList"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        @open-spell="forwardOpenSpell"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.effects"
      :hint="props.titles.effectsHint"
      :count="activeEffects.length"
      :add-label="MODAL_BUTTON_LABELS.addEffect"
      :collapsible="false"
      @add="effectRows?.createEffect()"
    >
      <EntityEffectsEditor
        ref="effectRows"
        v-model="activeEffects"
        :modal-id="props.effectsModalId"
        hide-aura
      />
    </EditorNestedSection>
  </div>
</template>
