<script setup lang="ts">
  import type {
    AbilityType,
    ArmorCategory,
    SkillType,
    SourceDefinition,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    ClassDefinition,
    DnDGameItem,
    GrantedSpellRef,
    HitDie,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type {
    EditableClassFeature,
    EditableCounter,
    EditableEquipmentOption,
    EditableLevelRow,
    EditableSpellcasting,
    EditableSubclass,
    EditableTableColumn,
  } from './classEditorTypes';

  import { computed, ref, watch } from 'vue';

  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import {
    findSpellInPacks,
    loadSpellPacks,
  } from '@/systems/dnd5e/composables/spellCompendium';
  import { generateId } from '@vtt/shared';
  import { ABILITY_OPTIONS, SKILLS_LIST } from '@vtt/shared/system/dnd.js';

  import {
    ARMOR_PROF_LABELS,
    CLASS_DEFAULT_SUBCLASS_LABEL,
    CLASS_FORM_LABELS,
    DEFINITION_FORM_LABELS,
    FORM_FIELD_LABELS,
    FORM_SECTION_TOGGLE_UI,
    FORM_TAB_LABELS,
    GRANT_FIELD_LABELS,
    GRANT_SECTION_LABELS,
    MODAL_BUTTON_LABELS,
    TOOL_PROF_LABELS,
    WEAPON_PROF_LABELS,
  } from '../constants';
  import FormSection from '../FormSection.vue';
  import SourceField from '../SourceField.vue';
  import { slugify } from '../utils/slugify';
  import ClassCountersEditor from './ClassCountersEditor.vue';
  import {
    buildAsiFeatures,
    buildColumns,
    buildCounter,
    buildFeature,
    buildLevelTable,
    buildSpellcasting,
    buildSubclass,
    createEmptyLevelTable,
    createEmptySpellcasting,
    HIT_DIE_OPTIONS,
    isPlainAsiFeature,
    toEditableColumns,
    toEditableCounter,
    toEditableFeature,
    toEditableLevelTable,
    toEditableSpellcasting,
    toEditableSubclass,
  } from './classEditorTypes';
  import ClassFeaturesEditor from './ClassFeaturesEditor.vue';
  import ClassLevelTableEditor from './ClassLevelTableEditor.vue';
  import ClassSpellcastingFields from './ClassSpellcastingFields.vue';
  import ClassSubclassesEditor from './ClassSubclassesEditor.vue';

  const props = defineProps<{
    open: boolean;
    /** Редактируемый класс (null = создание). Всегда плоский ClassDefinition. */
    classDefinition?: ClassDefinition | null;
    /** id исходного GameItem мира при редактировании (для обновления, не дубля) */
    classItemId?: string | null;
    /** Сокет — для загрузки заклинаний компендиума (подсказки связывания). */
    socket?: TypedWebSocketClient | null;
    zIndex?: number;
    positionOffset?: number;
    allowMultiple?: boolean;
    modalId?: string;
    savedPosition?: unknown;
    savedSize?: unknown;
  }>();

  const emit = defineEmits<{
    'close': [];
    'save': [gameClass: DnDGameItem];
    'bring-to-front': [];
  }>();

  const initialPosition = computed(() =>
    props.positionOffset
      ? { x: props.positionOffset, y: props.positionOffset }
      : undefined,
  );

  const { openModal } = useModalManager();

  // ── Опции селектов ─────────────────────────────────────────
  const armorOptions: { value: ArmorCategory; label: string }[] = [
    { value: 'light', label: ARMOR_PROF_LABELS.light },
    { value: 'medium', label: ARMOR_PROF_LABELS.medium },
    { value: 'heavy', label: ARMOR_PROF_LABELS.heavy },
    { value: 'shield', label: ARMOR_PROF_LABELS.shield },
  ];

  const weaponOptions = Object.entries(WEAPON_PROF_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  const toolOptions = Object.entries(TOOL_PROF_LABELS).map(
    ([value, label]) => ({
      value,
      label,
    }),
  );

  const abilityOptions = ABILITY_OPTIONS.map((ability) => ({
    value: ability.value,
    label: ability.label,
  }));

  const skillOptions = SKILLS_LIST.map((skill) => ({
    value: skill.key,
    label: skill.label,
  }));

  const tabItems = [
    { label: FORM_TAB_LABELS.main, slot: 'basic' as const },
    {
      label: GRANT_SECTION_LABELS.proficiencies,
      slot: 'proficiencies' as const,
    },
    { label: CLASS_FORM_LABELS.tabSpellcasting, slot: 'spellcasting' as const },
    { label: CLASS_FORM_LABELS.tabProgression, slot: 'progression' as const },
    { label: GRANT_SECTION_LABELS.features, slot: 'features' as const },
    { label: CLASS_FORM_LABELS.tabSubclasses, slot: 'subclasses' as const },
    { label: CLASS_FORM_LABELS.tabCounters, slot: 'counters' as const },
    { label: GRANT_SECTION_LABELS.equipment, slot: 'equipment' as const },
  ];

  // ── Состояние формы ────────────────────────────────────────
  const name = ref('');
  const nameEn = ref('');
  const description = ref('');
  const icon = ref('');
  const sourceKey = ref<string | undefined>(undefined);
  const source = ref<SourceDefinition | undefined>(undefined);
  const isSRD = ref(false);
  const hitDie = ref<HitDie>(8);
  const subclassLevel = ref(3);
  const subclassLabel = ref<string>(CLASS_DEFAULT_SUBCLASS_LABEL);

  const armorProficiencies = ref<ArmorCategory[]>([]);
  const weaponProficiencies = ref<string[]>([]);
  const toolProficiencies = ref<string[]>([]);
  const savingThrowProficiencies = ref<AbilityType[]>([]);
  const skillCount = ref(2);
  const skillFrom = ref<SkillType[]>([]);

  const multiclassEnabled = ref(false);
  const multiclassArmor = ref<ArmorCategory[]>([]);
  const multiclassWeapons = ref<string[]>([]);
  const multiclassTools = ref<string[]>([]);
  const multiclassSkillChoices = ref(0);

  const spellcasting = ref<EditableSpellcasting>(createEmptySpellcasting());

  const tableColumns = ref<EditableTableColumn[]>([]);
  const levelTable = ref<EditableLevelRow[]>(createEmptyLevelTable());

  const features = ref<EditableClassFeature[]>([]);
  const subclasses = ref<EditableSubclass[]>([]);
  const counters = ref<EditableCounter[]>([]);
  const equipment = ref<EditableEquipmentOption[]>([]);

  const existingKey = ref<string | null>(null);
  const existingId = ref<string | null>(null);

  /** Заклинания компендиума по пакам (имя, источник, пак) — для подсказок. */
  const availableSpells = ref<SpellOption[]>([]);

  /** Полные заклинания по пакам — для просмотра по клику. */
  const spellPacks = ref<
    { packId: string; packName: string; spells: Spell[] }[]
  >([]);

  const isCaster = computed(() => spellcasting.value.enabled);

  /** Особенности базового класса как опции привязки счётчиков. */
  const featureOptions = computed(() =>
    features.value
      .filter((feature) => feature.name.trim().length > 0)
      .map((feature) => ({ value: feature.key, label: feature.name })),
  );

  // ── Инициализация ──────────────────────────────────────────
  function resetForm(): void {
    name.value = '';
    nameEn.value = '';
    description.value = '';
    icon.value = '';
    sourceKey.value = undefined;
    source.value = undefined;
    isSRD.value = false;
    hitDie.value = 8;
    subclassLevel.value = 3;
    subclassLabel.value = CLASS_DEFAULT_SUBCLASS_LABEL;
    armorProficiencies.value = [];
    weaponProficiencies.value = [];
    toolProficiencies.value = [];
    savingThrowProficiencies.value = [];
    skillCount.value = 2;
    skillFrom.value = [];
    multiclassEnabled.value = false;
    multiclassArmor.value = [];
    multiclassWeapons.value = [];
    multiclassTools.value = [];
    multiclassSkillChoices.value = 0;
    spellcasting.value = createEmptySpellcasting();
    tableColumns.value = [];
    levelTable.value = createEmptyLevelTable();
    features.value = [];
    subclasses.value = [];
    counters.value = [];
    equipment.value = [];
    existingKey.value = null;
    existingId.value = null;
  }

  function hydrateFromDefinition(definition: ClassDefinition): void {
    name.value = definition.name || '';
    nameEn.value = definition.nameEn || '';
    description.value = definition.description || '';
    icon.value = definition.icon || '';
    sourceKey.value = definition.sourceKey;
    source.value = definition.source;
    isSRD.value = definition.isSRD ?? false;
    hitDie.value = definition.hitDie;
    subclassLevel.value = definition.subclassLevel;
    subclassLabel.value = definition.subclassLabel;
    existingKey.value = definition.key;

    armorProficiencies.value = [...definition.armorProficiencies];
    weaponProficiencies.value = [...definition.weaponProficiencies];
    toolProficiencies.value = [...(definition.toolProficiencies ?? [])];
    savingThrowProficiencies.value = [...definition.savingThrowProficiencies];
    skillCount.value = definition.skillChoices.count;
    skillFrom.value = [...definition.skillChoices.from];

    spellcasting.value = toEditableSpellcasting(definition.spellcasting);

    tableColumns.value = toEditableColumns(definition.tableColumns);

    // Только «обычные» ASI представляем чекбоксом строки; эпические дары и любые
    // asi-*, имеющие своё название/описание, сохраняем как настоящие особенности.
    const plainAsiKeys = new Set(
      (definition.features ?? [])
        .filter(isPlainAsiFeature)
        .map((feature) => feature.key),
    );

    levelTable.value = toEditableLevelTable(
      definition.levelTable,
      tableColumns.value,
      plainAsiKeys,
    );

    features.value = (definition.features ?? [])
      .filter((feature) => !isPlainAsiFeature(feature))
      .map(toEditableFeature);

    subclasses.value = (definition.subclasses ?? []).map(toEditableSubclass);
    counters.value = (definition.counters ?? []).map(toEditableCounter);

    equipment.value = (definition.startingEquipment ?? []).map((option) => ({
      uid: generateId('eq'),
      key: option.key,
      description: option.description,
    }));

    if (definition.multiclassProficiencies) {
      multiclassEnabled.value = true;
      multiclassArmor.value = [...definition.multiclassProficiencies.armor];
      multiclassWeapons.value = [...definition.multiclassProficiencies.weapons];
      multiclassTools.value = [...definition.multiclassProficiencies.tools];

      multiclassSkillChoices.value =
        definition.multiclassProficiencies.skillChoices;
    }
  }

  /** Загружает заклинания компендиума по пакам и резолвит имена выданных. */
  async function loadAvailableSpells(): Promise<void> {
    if (!props.socket) {
      availableSpells.value = [];
      spellPacks.value = [];

      return;
    }

    const { packs, options } = await loadSpellPacks(props.socket);

    spellPacks.value = packs;
    availableSpells.value = options;
    resolveGrantedNames();
  }

  /** Подставляет человекочитаемые имена выданным заклинаниям (по spellId). */
  function resolveGrantedNames(): void {
    const byId = new Map(
      availableSpells.value.map((option) => [option.id, option]),
    );

    const fix = (refs: GrantedSpellRef[]): void => {
      for (const ref of refs) {
        if (ref.spellId) {
          const option = byId.get(ref.spellId);

          if (option) {
            ref.name = option.name;
          }
        }
      }
    };

    const fixFeature = (feature: EditableClassFeature): void => {
      fix(feature.grantedSpells);

      for (const entry of feature.grantedSpellsByLevel) {
        fix(entry.spells);
      }
    };

    for (const feature of features.value) {
      fixFeature(feature);
    }

    for (const subclass of subclasses.value) {
      for (const feature of subclass.features) {
        fixFeature(feature);
      }
    }
  }

  /** Открывает детальный просмотр заклинания. */
  function openSpellDetail(spellId: string, packId?: string): void {
    const spell = findSpellInPacks(spellPacks.value, spellId, packId);

    if (spell) {
      openModal('SpellDetailModal', { spell });
    }
  }

  watch(
    () => props.open,
    (isOpen) => {
      if (!isOpen) {
        return;
      }

      resetForm();

      existingId.value = props.classItemId ?? null;

      if (props.classDefinition) {
        hydrateFromDefinition(props.classDefinition);
      }

      void loadAvailableSpells();
    },
    { immediate: true },
  );

  // ── Снаряжение ─────────────────────────────────────────────
  function addEquipment(): void {
    equipment.value.push({
      uid: generateId('eq'),
      key: String.fromCharCode(65 + equipment.value.length),
      description: '',
    });
  }

  function removeEquipment(index: number): void {
    equipment.value.splice(index, 1);
  }

  // ── Валидация и сохранение ─────────────────────────────────
  const canSave = computed(() => name.value.trim().length > 0);

  function buildDefinition(): ClassDefinition {
    const key =
      existingKey.value
      ?? `${slugify(nameEn.value || name.value) || 'class'}-${
        generateId('w').split('_')[2] ?? 'x'
      }`;

    const baseFeatures = features.value
      .filter((feature) => feature.name.trim().length > 0)
      .map((feature) => buildFeature(feature));

    const asiFeatures = buildAsiFeatures(levelTable.value, baseFeatures);

    const definition: ClassDefinition = {
      type: 'class',
      key,
      name: name.value.trim(),
      nameEn: nameEn.value.trim() || name.value.trim(),
      description: description.value.trim(),
      icon: icon.value.trim() || undefined,
      sourceKey: sourceKey.value,
      source: source.value,
      isSRD: isSRD.value,
      hitDie: hitDie.value,
      armorProficiencies: [...armorProficiencies.value],
      weaponProficiencies: [...weaponProficiencies.value],
      savingThrowProficiencies: [...savingThrowProficiencies.value],
      skillChoices: {
        count: skillCount.value,
        from: [...skillFrom.value],
      },
      spellcasting: buildSpellcasting(spellcasting.value),
      subclassLevel: subclassLevel.value,
      subclassLabel: subclassLabel.value.trim() || CLASS_DEFAULT_SUBCLASS_LABEL,
      subclasses: subclasses.value
        .filter((subclass) => subclass.name.trim().length > 0)
        .map(buildSubclass),
      features: [...baseFeatures, ...asiFeatures],
      levelTable: buildLevelTable(
        levelTable.value,
        features.value,
        tableColumns.value,
      ),
    };

    if (toolProficiencies.value.length > 0) {
      definition.toolProficiencies = [...toolProficiencies.value];
    }

    const columns = buildColumns(tableColumns.value);

    if (columns.length > 0) {
      definition.tableColumns = columns;
    }

    const builtCounters = counters.value
      .filter((counter) => counter.name.trim().length > 0)
      .map((counter) => buildCounter(counter));

    if (builtCounters.length > 0) {
      definition.counters = builtCounters;
    }

    const builtEquipment = equipment.value
      .filter((option) => option.key.trim().length > 0)
      .map((option) => ({
        key: option.key.trim(),
        description: option.description.trim(),
      }));

    if (builtEquipment.length > 0) {
      definition.startingEquipment = builtEquipment;
    }

    if (multiclassEnabled.value) {
      definition.multiclassProficiencies = {
        armor: [...multiclassArmor.value],
        weapons: [...multiclassWeapons.value],
        tools: [...multiclassTools.value],
        skillChoices: multiclassSkillChoices.value,
      };
    }

    return definition;
  }

  function handleSave(): void {
    if (!canSave.value) {
      return;
    }

    const definition = buildDefinition();

    const gameItem: DnDGameItem = {
      id: existingId.value ?? `item_${generateId('class')}`,
      type: 'class',
      name: definition.name,
      nameEn: definition.nameEn,
      description: definition.description ?? '',
      sourceKey: sourceKey.value,
      source: source.value,
      isSRD: isSRD.value,
      image: icon.value.trim() || undefined,
      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common',
      equipped: false,
      isReadOnly: false,
      classData: definition,
    };

    emit('save', gameItem);
    emit('close');
  }

  function handleOpenChange(value: boolean): void {
    if (!value) {
      emit('close');
    }
  }
</script>

<template>
  <UDraggableModal
    :open="open"
    :title="
      classDefinition
        ? CLASS_FORM_LABELS.editTitle
        : CLASS_FORM_LABELS.createTitle
    "
    :subtitle="nameEn || undefined"
    :initial-width="900"
    :min-width="640"
    :resizable="true"
    :z-index="zIndex"
    :saved-position="initialPosition"
    @update:open="handleOpenChange"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <UTabs
        :items="tabItems"
        variant="pill"
        class="flex flex-col"
        :ui="{
          list: 'mb-3 flex-wrap',
          trigger: 'justify-center',
          content: 'overflow-y-auto max-h-160',
        }"
      >
        <!-- ОСНОВНОЕ -->
        <template #basic>
          <div class="flex flex-col gap-4">
            <FormSection
              :title="DEFINITION_FORM_LABELS.generalTitle"
              icon="tabler:id"
            >
              <div class="grid grid-cols-2 gap-3">
                <UFormField :label="FORM_FIELD_LABELS.name">
                  <UInput
                    v-model="name"
                    :placeholder="CLASS_FORM_LABELS.namePlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="FORM_FIELD_LABELS.nameEn">
                  <UInput
                    v-model="nameEn"
                    :placeholder="CLASS_FORM_LABELS.nameEnPlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="CLASS_FORM_LABELS.hitDie">
                  <USelect
                    v-model="hitDie"
                    :items="HIT_DIE_OPTIONS"
                    value-key="value"
                    class="w-full"
                  />

                  <p class="mt-1 text-xs text-dimmed">
                    {{ CLASS_FORM_LABELS.hitDieHelp }}
                  </p>
                </UFormField>

                <SourceField
                  v-model:source-key="sourceKey"
                  v-model:source="source"
                />

                <UFormField :label="CLASS_FORM_LABELS.subclassLevel">
                  <UInputNumber
                    v-model="subclassLevel"
                    :min="1"
                    :max="20"
                  />

                  <p class="mt-1 text-xs text-dimmed">
                    {{ CLASS_FORM_LABELS.subclassLevelHelp }}
                  </p>
                </UFormField>

                <UFormField :label="CLASS_FORM_LABELS.subclassLabel">
                  <UInput
                    v-model="subclassLabel"
                    :placeholder="CLASS_FORM_LABELS.subclassLabelPlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="DEFINITION_FORM_LABELS.icon">
                  <UInput
                    v-model="icon"
                    :placeholder="CLASS_FORM_LABELS.iconPlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <div class="flex items-center">
                  <UCheckbox
                    v-model="isSRD"
                    :label="FORM_FIELD_LABELS.srd"
                  />
                </div>
              </div>
            </FormSection>

            <FormSection
              :title="FORM_FIELD_LABELS.descriptionMarkdown"
              icon="tabler:file-text"
            >
              <RichTextEditor v-model="description" />
            </FormSection>
          </div>
        </template>

        <!-- ВЛАДЕНИЯ -->
        <template #proficiencies>
          <div class="flex flex-col gap-4">
            <FormSection
              :title="CLASS_FORM_LABELS.startingProficienciesTitle"
              icon="tabler:certificate"
              :hint="CLASS_FORM_LABELS.startingProficienciesHint"
            >
              <div class="flex flex-col gap-3">
                <UFormField :label="GRANT_SECTION_LABELS.armor">
                  <USelectMenu
                    v-model="armorProficiencies"
                    :items="armorOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="CLASS_FORM_LABELS.armorPlaceholder"
                  />
                </UFormField>

                <UFormField :label="GRANT_SECTION_LABELS.weapons">
                  <USelectMenu
                    v-model="weaponProficiencies"
                    :items="weaponOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="CLASS_FORM_LABELS.weaponsPlaceholder"
                  />
                </UFormField>

                <UFormField :label="GRANT_SECTION_LABELS.tools">
                  <USelectMenu
                    v-model="toolProficiencies"
                    :items="toolOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="CLASS_FORM_LABELS.toolsPlaceholder"
                  />
                </UFormField>

                <UFormField :label="GRANT_SECTION_LABELS.savingThrows">
                  <USelectMenu
                    v-model="savingThrowProficiencies"
                    :items="abilityOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="GRANT_FIELD_LABELS.abilitiesPlaceholder"
                  />
                </UFormField>
              </div>
            </FormSection>

            <FormSection
              :title="CLASS_FORM_LABELS.skillChoiceTitle"
              icon="tabler:checklist"
              :hint="CLASS_FORM_LABELS.skillChoiceHint"
            >
              <div class="flex items-start gap-3">
                <UFormField
                  :label="FORM_FIELD_LABELS.amount"
                  class="w-1/4"
                >
                  <UInputNumber
                    v-model="skillCount"
                    :min="0"
                    :max="6"
                  />
                </UFormField>

                <UFormField
                  :label="GRANT_FIELD_LABELS.choiceFrom"
                  class="flex-1"
                >
                  <USelectMenu
                    v-model="skillFrom"
                    :items="skillOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="CLASS_FORM_LABELS.skillFromPlaceholder"
                  />
                </UFormField>
              </div>
            </FormSection>

            <FormSection
              :title="CLASS_FORM_LABELS.multiclassTitle"
              icon="tabler:stack-2"
              :hint="CLASS_FORM_LABELS.multiclassHint"
              :has-content="multiclassEnabled"
              class="transition-all duration-200"
            >
              <template #actions>
                <UCheckbox
                  v-model="multiclassEnabled"
                  :label="CLASS_FORM_LABELS.multiclassEnabled"
                  indicator="end"
                  :ui="FORM_SECTION_TOGGLE_UI"
                />
              </template>

              <div
                v-if="multiclassEnabled"
                class="flex flex-col gap-3"
              >
                <UFormField :label="GRANT_SECTION_LABELS.armor">
                  <USelectMenu
                    v-model="multiclassArmor"
                    :items="armorOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="GRANT_SECTION_LABELS.weapons">
                  <USelectMenu
                    v-model="multiclassWeapons"
                    :items="weaponOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="GRANT_SECTION_LABELS.tools">
                  <USelectMenu
                    v-model="multiclassTools"
                    :items="toolOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="CLASS_FORM_LABELS.multiclassSkills"
                  class="w-1/3"
                >
                  <UInputNumber
                    v-model="multiclassSkillChoices"
                    :min="0"
                    :max="4"
                  />
                </UFormField>
              </div>
            </FormSection>
          </div>
        </template>

        <!-- ЗАКЛИНАТЕЛЬСТВО -->
        <template #spellcasting>
          <FormSection
            :title="CLASS_FORM_LABELS.spellcastingTitle"
            icon="tabler:sparkles"
            :hint="CLASS_FORM_LABELS.spellcastingHint"
          >
            <ClassSpellcastingFields v-model="spellcasting" />
          </FormSection>
        </template>

        <!-- ПРОГРЕССИЯ -->
        <template #progression>
          <ClassLevelTableEditor
            v-model:rows="levelTable"
            v-model:columns="tableColumns"
            :features="features"
            :is-caster="isCaster"
          />
        </template>

        <!-- ОСОБЕННОСТИ -->
        <template #features>
          <ClassFeaturesEditor
            v-model="features"
            :available-spells="availableSpells"
            @open-spell="openSpellDetail"
          />
        </template>

        <!-- ПОДКЛАССЫ -->
        <template #subclasses>
          <div class="flex flex-col gap-2">
            <p class="text-xs text-dimmed">
              {{ CLASS_FORM_LABELS.subclassesHint }}
            </p>

            <ClassSubclassesEditor
              v-model="subclasses"
              :available-spells="availableSpells"
              :subclass-level="subclassLevel"
              @open-spell="openSpellDetail"
            />
          </div>
        </template>

        <!-- СЧЁТЧИКИ -->
        <template #counters>
          <div class="flex flex-col gap-2">
            <p class="text-xs text-dimmed">
              {{ CLASS_FORM_LABELS.countersHint }}
            </p>

            <ClassCountersEditor
              v-model="counters"
              :feature-options="featureOptions"
            />
          </div>
        </template>

        <!-- СНАРЯЖЕНИЕ -->
        <template #equipment>
          <div class="flex flex-col gap-2">
            <p class="text-xs text-dimmed">
              {{ CLASS_FORM_LABELS.equipmentHint }}
            </p>

            <div
              v-for="(option, optionIndex) in equipment"
              :key="option.uid"
              class="flex items-start gap-2 rounded-md border border-default bg-elevated/30 p-2"
            >
              <UInput
                v-model="option.key"
                :placeholder="CLASS_FORM_LABELS.equipmentKeyPlaceholder"
                class="w-17.5"
              />

              <UTextarea
                v-model="option.description"
                :rows="2"
                autoresize
                :placeholder="CLASS_FORM_LABELS.equipmentDescriptionPlaceholder"
                class="flex-1"
              />

              <UButton
                icon="tabler:trash"
                color="error"
                variant="ghost"
                size="xs"
                :aria-label="CLASS_FORM_LABELS.equipmentRemove"
                @click.left.exact.prevent="removeEquipment(optionIndex)"
              />
            </div>

            <UButton
              icon="tabler:plus"
              :label="CLASS_FORM_LABELS.equipmentAdd"
              color="primary"
              variant="soft"
              size="xs"
              class="self-start"
              @click.left.exact.prevent="addEquipment"
            />
          </div>
        </template>
      </UTabs>
    </template>

    <template #footer>
      <div class="flex items-center justify-between gap-3">
        <span
          v-if="!canSave"
          class="text-xs text-dimmed"
        >
          {{ CLASS_FORM_LABELS.saveHint }}
        </span>

        <div class="ml-auto flex gap-3">
          <UButton
            :label="MODAL_BUTTON_LABELS.cancel"
            color="neutral"
            variant="ghost"
            @click.left.exact.prevent="emit('close')"
          />

          <UButton
            :label="
              classDefinition
                ? MODAL_BUTTON_LABELS.save
                : MODAL_BUTTON_LABELS.create
            "
            color="primary"
            :disabled="!canSave"
            @click.left.exact.prevent="handleSave"
          />
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
