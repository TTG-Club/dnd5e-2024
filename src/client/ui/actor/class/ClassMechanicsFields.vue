<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type {
    ActiveEffect,
    GrantedSpellRef,
  } from '@vtt/shared/system/dnd.js';

  import type { EditableFeatGrants } from '../feat/featEditorTypes';
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { ClassMechanicsTitles } from './classEditorTypes';

  import { computed } from 'vue';

  import CounterRowsEditor from '../CounterRowsEditor.vue';
  import EditorNestedSection from '../EditorNestedSection.vue';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import { usedChoiceKeys } from '../feat/featEditorTypes';
  import FeatSpellcastingFields from '../feat/FeatSpellcastingFields.vue';
  import FeatSpellListEditor from '../feat/FeatSpellListEditor.vue';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import ModifierRowsEditor from '../feat/ModifierRowsEditor.vue';
  import SpellChoiceRowsEditor from '../feat/SpellChoiceRowsEditor.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';

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

  /** Заклинания, которые запись даёт знать. */
  const grantedSpells = defineModel<GrantedSpellRef[]>('grantedSpells', {
    required: true,
  });

  /** Активные эффекты записи. */
  const activeEffects = defineModel<ActiveEffect[]>('activeEffects', {
    required: true,
  });

  const emit = defineEmits<{
    'open-spell': [spellId: string, packId?: string];
  }>();

  /** Занятые ключи выборов: два выбора с одним ключом схлопнулись бы в один. */
  const takenChoiceKeys = computed(() => [...usedChoiceKeys(grants.value)]);

  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <EditorNestedSection
      :title="props.titles.grants"
      :hint="props.titles.grantsHint"
      :collapsible="false"
    >
      <GrantRowsEditor
        v-model="grants.grantRows"
        :taken-keys="takenChoiceKeys"
        :socket="props.socket"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.modifiers"
      :collapsible="false"
    >
      <ModifierRowsEditor v-model="grants.modifiers" />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.counters"
      :collapsible="false"
    >
      <CounterRowsEditor
        v-model="grants.counters"
        :with-table-column="props.withTableColumn"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.spells"
      :hint="props.titles.spellsHint"
      :collapsible="false"
    >
      <GrantedSpellsEditor
        v-model="grantedSpells"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        @open-spell="forwardOpenSpell"
      />

      <!-- Характеристика и подготовка — одним блоком на все заклинания записи,
        тем же, что у черты: без «готовить не нужно» заклинание воззвания легло
        бы в книгу неподготовленным и заняло бы подготовку игроку -->
      <FeatSpellcastingFields v-model="grants" />

      <!-- Поуровневая выдача умения (домены, клятвы, покровители) идёт сюда же,
        следом за обычной: у варианта такого блока нет — вариант берут разом -->
      <slot name="spells-extra" />
    </EditorNestedSection>

    <!-- Заклинания, которые игрок выбирает сам: «Договор Гримуара» предлагает
      три заговора. Отдельно от выдачи — там заклинание названо записью, здесь
      его называет игрок, и спрашивает его мастер класса -->
    <EditorNestedSection
      :title="props.titles.spellChoice"
      :hint="props.titles.spellChoiceHint"
      :collapsible="false"
    >
      <SpellChoiceRowsEditor
        v-model="grants.spellChoice"
        :taken-keys="takenChoiceKeys"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.spellList"
      :hint="props.titles.spellListHint"
      :collapsible="false"
    >
      <FeatSpellListEditor
        v-model="grants.spellList"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        @open-spell="forwardOpenSpell"
      />
    </EditorNestedSection>

    <EditorNestedSection
      :title="props.titles.effects"
      :collapsible="false"
    >
      <EntityEffectsEditor
        v-model="activeEffects"
        :modal-id="props.effectsModalId"
        :hint="props.titles.effectsHint"
        :empty-text="props.titles.effectsEmpty"
        hide-aura
      />
    </EditorNestedSection>
  </div>
</template>
