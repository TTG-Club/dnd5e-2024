<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { ClassDefinition } from '@vtt/shared/system/dnd.js';

  import type { EditableGrantedSpellGroup } from './feat/featEditorTypes';
  import type { SpellOption } from './grantedSpellsEditorTypes';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
  import {
    ABILITY_OPTIONS,
    CLASS_KEY_OPTIONS,
    isClassDefinition,
  } from '@vtt/shared/system/dnd.js';

  import { GRANTED_SPELL_GROUPS_LABELS } from './constants';
  import {
    CLASS_SPELLS_LEVEL_OPTIONS,
    classSpellsLevelValue,
    createGrantedSpellGroup,
    GRANTED_SPELL_GROUP_SOURCE_OPTIONS,
    grantedSpellGroupTitle,
    parseClassSpellsLevelValue,
  } from './feat/featEditorTypes';
  import FieldHint from './FieldHint.vue';
  import GrantedSpellsEditor from './GrantedSpellsEditor.vue';

  /**
   * Заклинания, которые запись даёт знать без выбора, — группами.
   *
   * Тот же блок, что в мастерской сайта, и устроен так же: у каждой группы свой
   * уровень открытия и свой источник — перечисленные заклинания либо весь список
   * класса. Перечень устаревает при каждом пополнении компендиума, а список
   * собирается в момент выдачи, по пометке класса у самой записи заклинания.
   *
   * Групп несколько, и это НЕ взаимоисключающие варианты: каждая открывается на
   * своём уровне и складывается с предыдущими — заклинания домена приходят на 3,
   * 5, 7 уровнях.
   */
  const props = withDefaults(
    defineProps<{
      /** Заклинания компендиума по пакам — для подсказок и выбора пака. */
      availableSpells?: SpellOption[];
      /** WebSocket-клиент: окно выбора заклинания и список классов. */
      socket?: TypedWebSocketClient | null;
    }>(),
    { availableSpells: () => [], socket: null },
  );

  const groups = defineModel<EditableGrantedSpellGroup[]>({ required: true });

  const emit = defineEmits<{
    /** Открыть детальный просмотр заклинания (id + предпочтённый пак). */
    'open-spell': [spellId: string, packId?: string];
  }>();

  /** Класс компендиума: ключ, название и пак, из которого он взят. */
  interface KnownClass {
    key: string;
    name: string;
    packId?: string;
  }

  /** Классы, найденные в паках компендиума. */
  const compendiumClasses = ref<KnownClass[]>([]);

  /**
   * Классы для выбора: канонические из правил плюс всё, что нашлось в паках.
   *
   * Паки старше справочника правил: хоумбрю-класс есть только там, а его
   * заклинания помечены его же ключом. Канонические остаются на случай, когда
   * компендиума классов у мастера нет вовсе.
   */
  const classOptions = computed(() => {
    const byKey = new Map<string, { value: string; label: string }>();

    for (const option of CLASS_KEY_OPTIONS) {
      byKey.set(option.value, { value: option.value, label: option.label });
    }

    for (const entry of compendiumClasses.value) {
      byKey.set(entry.key, { value: entry.key, label: entry.name });
    }

    return [...byKey.values()];
  });

  /**
   * Характеристики выдачи — все шесть.
   *
   * Не только три «заклинательные»: заклинание, выданное записью, может считаться
   * от любой характеристики, и урезанный набор просто нельзя было бы заполнить.
   * Пустое значение — «от класса», и его отдаёт `clearable` селекта.
   */
  const abilityOptions = ABILITY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  /** Паки заклинаний: из них автор сужает выдачу до конкретного компендиума. */
  const spellPackOptions = computed(() => {
    const byId = new Map<string, { value: string; label: string }>();

    for (const option of props.availableSpells) {
      byId.set(option.packId, {
        value: option.packId,
        label: option.packName,
      });
    }

    return [...byId.values()];
  });

  /** Загружает классы компендиума — по ним группа узнаёт название и пак. */
  async function loadClasses(): Promise<void> {
    const socket = props.socket;

    if (!socket) {
      compendiumClasses.value = [];

      return;
    }

    const packs = await loadCompendiumKindByPack(socket, 'class');
    const known = new Map<string, KnownClass>();

    for (const pack of packs) {
      for (const entry of pack.entries) {
        const definition = readClassDefinition(entry);

        // Подкласс своим списком заклинаний не обладает — его заклинания
        // помечены ключом родителя, и выбирать подкласс здесь незачем
        if (
          !definition
          || definition.parentClassKey
          || known.has(definition.key)
        ) {
          continue;
        }

        known.set(definition.key, {
          key: definition.key,
          name: definition.name,
          packId: pack.packId,
        });
      }
    }

    compendiumClasses.value = [...known.values()];
  }

  /**
   * Определение класса из записи компендиума: у предмета мира оно лежит внутри
   * `classData`, у записи пака — самой записью.
   *
   * @param entry - запись компендиума
   */
  function readClassDefinition(entry: unknown): ClassDefinition | null {
    if (
      typeof entry === 'object'
      && entry !== null
      && 'classData' in entry
      && isClassDefinition(entry.classData)
    ) {
      return entry.classData;
    }

    return isClassDefinition(entry) ? entry : null;
  }

  watch(() => props.socket, loadClasses, { immediate: true });

  /** Группа выдаёт весь список класса, а не перечисленные заклинания. */
  function isClassList(group: EditableGrantedSpellGroup): boolean {
    return group.source === 'classList';
  }

  /**
   * Записывает классы группы вместе со снимком названий и паком.
   *
   * Снимок обязателен: заголовок группы и сводка даров показывают название, а по
   * одному ключу автор увидит «druid». Пак — подсказка, из какого компендиума
   * класс взят; на сбор заклинаний он не влияет.
   *
   * @param group - группа выдачи
   * @param keys - ключи выбранных классов
   */
  function setClasses(group: EditableGrantedSpellGroup, keys: string[]): void {
    const labels = new Map(
      classOptions.value.map((option) => [option.value, option.label]),
    );

    group.classKeys = [...keys];
    group.classNames = keys.map((key) => labels.get(key) ?? key);

    const fromPack = compendiumClasses.value.find(
      (entry) => entry.key === keys[0],
    );

    group.classPackId = fromPack?.packId;
  }

  /**
   * Записывает круг группы.
   *
   * @param group - группа выдачи
   * @param value - значение селекта
   */
  function setLevel(group: EditableGrantedSpellGroup, value: string): void {
    const parsed = parseClassSpellsLevelValue(value);

    group.levelMode = parsed.levelMode;
    group.level = parsed.level;
  }

  /** Заводит группу выдачи. Наружу: кнопка живёт в шапке раздела. */
  function addGroup(): void {
    groups.value = [...groups.value, createGrantedSpellGroup()];
  }

  /**
   * Убирает группу целиком вместе с её заклинаниями.
   *
   * @param index - номер группы
   */
  function removeGroup(index: number): void {
    groups.value = groups.value.filter(
      (_unused, groupIndex) => groupIndex !== index,
    );
  }

  /**
   * Пробрасывает просмотр заклинания наверх.
   *
   * @param spellId - id записи компендиума
   * @param packId - предпочтённый пак
   */
  function forwardOpenSpell(spellId: string, packId?: string): void {
    emit('open-spell', spellId, packId);
  }

  defineExpose({ addGroup });
</script>

<template>
  <div class="flex flex-col gap-3">
    <div
      v-for="(group, index) in groups"
      :key="group.uid"
      class="flex flex-col gap-2 rounded-lg border border-default bg-elevated/40 p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-sm font-medium text-highlighted">
          {{ grantedSpellGroupTitle(group) }}
        </span>

        <UButton
          icon="tabler:trash"
          color="error"
          variant="ghost"
          size="xs"
          :aria-label="GRANTED_SPELL_GROUPS_LABELS.remove"
          @click.left.exact.prevent="removeGroup(index)"
        />
      </div>

      <div class="flex flex-wrap items-end gap-2">
        <UFormField class="w-52">
          <template #label>
            <span class="flex items-center gap-1">
              {{ GRANTED_SPELL_GROUPS_LABELS.source }}
              <FieldHint :text="GRANTED_SPELL_GROUPS_LABELS.sourceHint" />
            </span>
          </template>

          <USelect
            v-model="group.source"
            :items="GRANTED_SPELL_GROUP_SOURCE_OPTIONS"
            value-key="value"
            label-key="label"
            class="w-full"
          />
        </UFormField>

        <!-- Круг — только у списка класса: у перечисленных он свой у каждой
          записи и берётся из компендиума -->
        <UFormField class="w-52">
          <template #label>
            <span class="flex items-center gap-1">
              {{ GRANTED_SPELL_GROUPS_LABELS.level }}
              <FieldHint :text="GRANTED_SPELL_GROUPS_LABELS.levelHint" />
            </span>
          </template>

          <USelect
            v-if="isClassList(group)"
            :model-value="classSpellsLevelValue(group)"
            :items="CLASS_SPELLS_LEVEL_OPTIONS"
            value-key="value"
            label-key="label"
            class="w-full"
            @update:model-value="setLevel(group, $event)"
          />

          <p
            v-else
            class="py-1.5 text-sm text-dimmed italic"
          >
            {{ GRANTED_SPELL_GROUPS_LABELS.levelFromRecord }}
          </p>
        </UFormField>

        <UFormField class="w-40">
          <template #label>
            <span class="flex items-center gap-1">
              {{ GRANTED_SPELL_GROUPS_LABELS.requiredLevel }}
              <FieldHint
                :text="GRANTED_SPELL_GROUPS_LABELS.requiredLevelHint"
              />
            </span>
          </template>

          <UInputNumber
            v-model="group.requiredLevel"
            :min="1"
            :max="20"
            :placeholder="GRANTED_SPELL_GROUPS_LABELS.requiredLevelPlaceholder"
            class="w-full"
          />
        </UFormField>

        <!-- Характеристика у группы, а не у записи: один набор заклинаний может
          считаться от одной характеристики, другой — от другой -->
        <UFormField class="w-52">
          <template #label>
            <span class="flex items-center gap-1">
              {{ GRANTED_SPELL_GROUPS_LABELS.ability }}
              <FieldHint :text="GRANTED_SPELL_GROUPS_LABELS.abilityHint" />
            </span>
          </template>

          <USelectMenu
            v-model="group.spellcastingAbility"
            :items="abilityOptions"
            value-key="value"
            label-key="label"
            clearable
            :placeholder="GRANTED_SPELL_GROUPS_LABELS.abilityPlaceholder"
            class="w-full"
          />
        </UFormField>

        <UCheckbox
          v-model="group.alwaysPrepared"
          :label="GRANTED_SPELL_GROUPS_LABELS.alwaysPrepared"
          class="mb-2"
        />

        <!-- Паки спрашиваются, только когда их больше одного: с единственным
          компендиумом сужать нечего, а поле сбивало бы с толку -->
        <UFormField
          v-if="isClassList(group) && spellPackOptions.length > 1"
          class="w-64"
        >
          <template #label>
            <span class="flex items-center gap-1">
              {{ GRANTED_SPELL_GROUPS_LABELS.spellPacks }}
              <FieldHint :text="GRANTED_SPELL_GROUPS_LABELS.spellPacksHint" />
            </span>
          </template>

          <USelectMenu
            v-model="group.spellPackIds"
            :items="spellPackOptions"
            value-key="value"
            label-key="label"
            multiple
            :placeholder="GRANTED_SPELL_GROUPS_LABELS.spellPacksPlaceholder"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField v-if="isClassList(group)">
        <template #label>
          <span class="flex items-center gap-1">
            {{ GRANTED_SPELL_GROUPS_LABELS.classes }}
            <FieldHint :text="GRANTED_SPELL_GROUPS_LABELS.classesHint" />
          </span>
        </template>

        <USelectMenu
          :model-value="group.classKeys"
          :items="classOptions"
          value-key="value"
          label-key="label"
          multiple
          :placeholder="GRANTED_SPELL_GROUPS_LABELS.classesPlaceholder"
          class="w-full"
          @update:model-value="setClasses(group, $event)"
        />
      </UFormField>

      <GrantedSpellsEditor
        v-else
        v-model="group.spells"
        :available-spells="props.availableSpells"
        :socket="props.socket"
        @open-spell="forwardOpenSpell"
      />
    </div>
  </div>
</template>
