<script setup lang="ts">
  import type { PackKindEntries } from '@/core/compendiumDataClient';
  import type {
    AbilityType,
    ArmorCategory,
    CompendiumEntry,
    SkillType,
    SourceDefinition,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    AbilityDelimiter,
    ActiveEffect,
    ClassDefinition,
    ClassFeature,
    DnDGameItem,
    GrantedSpellRef,
    HitDie,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type {
    PickedCompendiumRef,
    PickerEntryFields,
  } from '../CompendiumRefPickerModal.vue';
  import type { EditableResourceCounter } from '../counterEditorTypes';
  import type { EditableFeatGrants } from '../feat/featEditorTypes';
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableStartingEquipmentOption } from '../startingEquipmentEditorTypes';
  import type {
    EditableClassFeature,
    EditableLevelRow,
    EditableSpellcasting,
    EditableSubclass,
    EditableTableColumn,
  } from './classEditorTypes';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useItemsStore } from '@/stores/itemsStore';
  import {
    findSpellInPacks,
    loadSpellPacks,
  } from '@/systems/dnd5e/composables/spellCompendium';
  import { generateId, isRecord } from '@vtt/shared';
  import {
    ABILITY_OPTIONS,
    classOwnCounterDefinitions,
    isClassDefinition,
    SKILLS_LIST,
    slugify,
    subclassCounterDefinitions,
    withUniqueSubclassKeys,
  } from '@vtt/shared/system/dnd.js';

  import CompendiumRefPickerModal from '../CompendiumRefPickerModal.vue';
  import {
    ABILITY_DELIMITER_OPTIONS,
    ARMOR_PROF_LABELS,
    CLASS_DEFAULT_SUBCLASS_LABEL,
    CLASS_FORM_LABELS,
    COMPENDIUM_PICKER_LABELS,
    DEFINITION_FORM_LABELS,
    FEAT_GRANTS_LABELS,
    FORM_FIELD_LABELS,
    FORM_SECTION_TOGGLE_UI,
    FORM_TAB_LABELS,
    GRANT_FIELD_LABELS,
    GRANT_SECTION_LABELS,
    GRANTED_SPELLS_LABELS,
    MODAL_BUTTON_LABELS,
    SPELL_LIST_LABELS,
    TOOL_PROF_LABELS,
    WEAPON_PROF_LABELS,
  } from '../constants';
  import CounterRowsEditor from '../CounterRowsEditor.vue';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import {
    buildFeatData,
    createEmptyFeatGrants,
    featDataToGrants,
  } from '../feat/featEditorTypes';
  import FeatSpellListEditor from '../feat/FeatSpellListEditor.vue';
  import FormSection from '../FormSection.vue';
  import GrantedSpellsEditor from '../GrantedSpellsEditor.vue';
  import SourceField from '../SourceField.vue';
  import StartingEquipmentEditor from '../StartingEquipmentEditor.vue';
  import {
    buildClassEquipmentOptions,
    toEditableEquipmentOption,
  } from '../startingEquipmentEditorTypes';
  import {
    buildAsiFeatures,
    buildColumns,
    buildCounter,
    buildFeature,
    buildFeatureCounters,
    buildLevelTable,
    buildScalingFeatures,
    buildSpellcasting,
    buildSubclass,
    collectPlainAsiKeys,
    createEmptyLevelTable,
    createEmptySpellcasting,
    distributeFeatureCounters,
    HIT_DIE_OPTIONS,
    toEditableColumns,
    toEditableFeatures,
    toEditableLevelTable,
    toEditableSpellcasting,
    toEditableSubclass,
  } from './classEditorTypes';
  import ClassFeaturesEditor from './ClassFeaturesEditor.vue';
  import ClassGrantsFields from './ClassGrantsFields.vue';
  import ClassLevelTableEditor from './ClassLevelTableEditor.vue';
  import ClassSpellcastingFields from './ClassSpellcastingFields.vue';
  import ClassSubclassesEditor from './ClassSubclassesEditor.vue';

  /** Родительский класс, показанный в поле: как называется и откуда взят. */
  interface ParentClassInfo {
    name: string;
    packName: string;
  }

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

  const { getNextZIndex, openModal } = useModalManager();
  const itemsStore = useItemsStore();

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
    { label: CLASS_FORM_LABELS.tabFeatures, slot: 'features' as const },
    { label: CLASS_FORM_LABELS.tabGrants, slot: 'grants' as const },
    { label: CLASS_FORM_LABELS.tabSubclasses, slot: 'subclasses' as const },
    { label: GRANT_SECTION_LABELS.equipment, slot: 'equipment' as const },
    { label: FORM_TAB_LABELS.effects, slot: 'effects' as const },
  ];

  // ── Состояние формы ────────────────────────────────────────
  const name = ref('');
  const nameEn = ref('');
  const description = ref('');
  /**
   * Иконка записи. Поля в форме у неё нет, но значение читается и пишется
   * обратно: иначе правка записи компендиума стирала бы её иконку.
   */
  const icon = ref('');
  const sourceKey = ref<string | undefined>(undefined);
  const source = ref<SourceDefinition | undefined>(undefined);
  const isSRD = ref(false);
  const hitDie = ref<HitDie>(8);
  const subclassLevel = ref(3);
  const subclassLabel = ref<string>(CLASS_DEFAULT_SUBCLASS_LABEL);
  const primaryAbilities = ref<AbilityType[]>([]);

  const primaryAbilitiesDelimiter = ref<AbilityDelimiter | undefined>(
    undefined,
  );

  /** Ключ родительского класса: заполнен — запись является его подклассом. */
  const parentClassKey = ref('');

  const armorProficiencies = ref<ArmorCategory[]>([]);
  const armorProficienciesCustom = ref('');
  const weaponProficiencies = ref<string[]>([]);
  const weaponProficienciesCustom = ref('');
  const toolProficiencies = ref<string[]>([]);
  const savingThrowProficiencies = ref<AbilityType[]>([]);
  const skillCount = ref(2);
  const skillFrom = ref<SkillType[]>([]);

  const multiclassEnabled = ref(false);
  const multiclassArmor = ref<ArmorCategory[]>([]);
  const multiclassArmorCustom = ref('');
  const multiclassWeapons = ref<string[]>([]);
  const multiclassWeaponsCustom = ref('');
  const multiclassTools = ref<string[]>([]);
  const multiclassSkillChoices = ref(0);

  const spellcasting = ref<EditableSpellcasting>(createEmptySpellcasting());

  const tableColumns = ref<EditableTableColumn[]>([]);
  const levelTable = ref<EditableLevelRow[]>(createEmptyLevelTable());

  const features = ref<EditableClassFeature[]>([]);

  /**
   * Умения-повышения характеристик записи как они пришли. В форме их место —
   * галочка ASI строки уровня, а собственные дары (категории черт, из которых
   * берут черту вместо прибавки) правке не подлежат: без переноса сохранение
   * записи снимало бы с шага характеристик список категорий класса.
   */
  const preservedAsiFeatures = ref<ClassFeature[]>([]);

  const subclasses = ref<EditableSubclass[]>([]);
  const counters = ref<EditableResourceCounter[]>([]);
  const equipment = ref<EditableStartingEquipmentOption[]>([]);
  const activeEffects = ref<ActiveEffect[]>([]);

  /**
   * Дары самого класса: владения, выборы, правки листа и ресурсы — тем же
   * блоком, что у черты. Форма правит их на вкладке «Дары», как на сайте.
   */
  const grants = ref<EditableFeatGrants>(createEmptyFeatGrants());

  /**
   * Заклинания, которые даёт сам класс. Живут в тех же дарах, но правятся на
   * вкладке «Заклинательство»: там их и ищут.
   */
  const grantedSpells = ref<GrantedSpellRef[]>([]);

  const existingKey = ref<string | null>(null);
  const existingId = ref<string | null>(null);

  /** Заклинания компендиума по пакам (имя, источник, пак) — для подсказок. */
  const availableSpells = ref<SpellOption[]>([]);

  /** Полные заклинания по пакам — для просмотра по клику. */
  const spellPacks = ref<
    { packId: string; packName: string; spells: Spell[] }[]
  >([]);

  const isCaster = computed(() => spellcasting.value.enabled);

  /**
   * Является ли редактируемая запись подклассом. Подкласс подкласса модель не
   * знает, поэтому у такой записи нет ни своей группы подклассов, ни вкладки с
   * ними — ровно как у происхождения вида.
   */
  const isSubclass = computed(() => parentClassKey.value.length > 0);

  /** Вкладки формы: у записи-подкласса «Подклассы» среди них нет. */
  const visibleTabItems = computed(() =>
    isSubclass.value
      ? tabItems.filter((tab) => tab.slot !== 'subclasses')
      : tabItems,
  );

  // ── Родительский класс ─────────────────────────────────────

  /** Свежий выбор родителя: окно выбора отдаёт и название, и пак. */
  const pickedParent = ref<ParentClassInfo | null>(null);

  /** Открыто ли окно выбора родительского класса. */
  const isParentPickerOpen = ref(false);

  /** z-index окна выбора родителя — оно встаёт поверх формы. */
  const parentPickerZIndex = ref<number | undefined>(undefined);

  /** Классы справочника (компендиум + мир) по ключу — источник названий. */
  const knownClassesByKey = ref(new Map<string, ParentClassInfo>());

  /**
   * Читает определение класса из записи: у предмета мира оно лежит во
   * вложенном `classData`, у записи компендиума — на верхнем уровне.
   *
   * @param entry - запись компендиума или предмет мира
   * @returns определение класса либо `null`
   */
  function readClassDefinition(entry: unknown): ClassDefinition | null {
    if (isRecord(entry) && isClassDefinition(entry.classData)) {
      return entry.classData;
    }

    return isClassDefinition(entry) ? entry : null;
  }

  /**
   * Годится ли запись в родительский класс и чем она адресуется. Ключ берётся у
   * самого определения: у класса мира `id` принадлежит предмету, а в
   * `parentClassKey` нужен ключ класса.
   *
   * Отсеиваются записи-подклассы (цепочку «подкласс подкласса» модель не знает)
   * и сама редактируемая запись — класс не бывает подклассом самого себя.
   *
   * @param entry - запись компендиума или предмет мира
   * @returns поля записи для окна выбора либо `null`
   */
  function resolveParentCandidate(
    entry: CompendiumEntry,
  ): PickerEntryFields | null {
    const definition = readClassDefinition(entry);

    if (
      !definition
      || definition.parentClassKey
      || definition.key === existingKey.value
    ) {
      return null;
    }

    return {
      key: definition.key,
      name: definition.name,
      nameEn: definition.nameEn ?? definition.name,
    };
  }

  /** Загружает классы справочника — по ним поле узнаёт название родителя. */
  async function loadKnownClasses(): Promise<void> {
    const known = new Map<string, ParentClassInfo>();

    if (props.socket) {
      const packs: PackKindEntries[] = await loadCompendiumKindByPack(
        props.socket,
        'class',
      );

      for (const pack of packs) {
        for (const entry of pack.entries) {
          const definition = readClassDefinition(entry);

          if (definition && !known.has(definition.key)) {
            known.set(definition.key, {
              name: definition.name,
              packName: pack.packName,
            });
          }
        }
      }
    }

    for (const worldItem of itemsStore.items) {
      const definition = readClassDefinition(worldItem);

      if (definition && !known.has(definition.key)) {
        known.set(definition.key, {
          name: definition.name,
          packName: COMPENDIUM_PICKER_LABELS.worldPack,
        });
      }
    }

    knownClassesByKey.value = known;
  }

  /** Запись справочника, стоящая за выбранным ключом родителя. */
  const knownParent = computed(() =>
    parentClassKey.value
      ? knownClassesByKey.value.get(parentClassKey.value)
      : undefined,
  );

  /**
   * Название родительского класса. Свежий выбор знает его сам; у записи,
   * открытой на правку, есть только ключ — название ищем в справочнике. Не
   * нашлось (пак с родителем не подключён) — показываем ключ, а не пустое
   * место.
   */
  const parentLabel = computed(() => {
    if (!parentClassKey.value) {
      return CLASS_FORM_LABELS.parentNone;
    }

    return (
      pickedParent.value?.name
      ?? knownParent.value?.name
      ?? parentClassKey.value
    );
  });

  /** Пока родитель не выбран, в поле стоит подсказка — её и приглушаем. */
  const parentLabelClass = computed(() =>
    parentClassKey.value ? 'text-default' : 'text-dimmed',
  );

  /** Компендиум родителя — пусто, если запись в справочнике не нашлась. */
  const parentPackLabel = computed(
    () => pickedParent.value?.packName ?? knownParent.value?.packName ?? '',
  );

  /** Открывает окно выбора родительского класса поверх формы. */
  function openParentPicker(): void {
    parentPickerZIndex.value = getNextZIndex();
    isParentPickerOpen.value = true;
  }

  /**
   * Принимает выбор. Окно отдаёт список, но выбор здесь одиночный — берём
   * первую и единственную ссылку.
   *
   * @param picked - выбранные записи
   */
  function applyParentPick(picked: PickedCompendiumRef[]): void {
    const parent = picked[0];

    if (!parent) {
      return;
    }

    parentClassKey.value = parent.url;
    pickedParent.value = { name: parent.name, packName: parent.packName };
  }

  /** Снимает родителя — запись снова самостоятельный класс. */
  function clearParent(): void {
    parentClassKey.value = '';
    pickedParent.value = null;
  }

  /**
   * Разделитель нужен, только когда характеристик больше одной: у одной ему
   * нечего разделять, и оставленное значение уехало бы в запись мусором.
   */
  const isDelimiterDisabled = computed(
    () => primaryAbilities.value.length <= 1,
  );

  watch(isDelimiterDisabled, (isDisabled) => {
    if (isDisabled) {
      primaryAbilitiesDelimiter.value = undefined;
    }
  });

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
    primaryAbilities.value = [];
    primaryAbilitiesDelimiter.value = undefined;
    parentClassKey.value = '';
    pickedParent.value = null;
    armorProficiencies.value = [];
    armorProficienciesCustom.value = '';
    weaponProficiencies.value = [];
    weaponProficienciesCustom.value = '';
    toolProficiencies.value = [];
    savingThrowProficiencies.value = [];
    skillCount.value = 2;
    skillFrom.value = [];
    multiclassEnabled.value = false;
    multiclassArmor.value = [];
    multiclassArmorCustom.value = '';
    multiclassWeapons.value = [];
    multiclassWeaponsCustom.value = '';
    multiclassTools.value = [];
    multiclassSkillChoices.value = 0;
    spellcasting.value = createEmptySpellcasting();
    tableColumns.value = [];
    levelTable.value = createEmptyLevelTable();
    features.value = [];
    preservedAsiFeatures.value = [];
    subclasses.value = [];
    counters.value = [];
    equipment.value = [];
    activeEffects.value = [];
    grants.value = createEmptyFeatGrants();
    grantedSpells.value = [];
    existingKey.value = null;
    existingId.value = null;
  }

  function hydrateFromDefinition(rawDefinition: ClassDefinition): void {
    // Ключи подклассов — уникальные, как их видит лист: у копии записи с сайта
    // два выпуска одного подкласса приезжают с одним ключом, и форма иначе
    // сохранила бы двойника как есть
    const definition = withUniqueSubclassKeys(rawDefinition);

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
    primaryAbilities.value = [...(definition.primaryAbilities ?? [])];
    primaryAbilitiesDelimiter.value = definition.primaryAbilitiesDelimiter;
    parentClassKey.value = definition.parentClassKey ?? '';
    existingKey.value = definition.key;

    armorProficiencies.value = [...definition.armorProficiencies];
    armorProficienciesCustom.value = definition.armorProficienciesCustom ?? '';
    weaponProficiencies.value = [...definition.weaponProficiencies];

    weaponProficienciesCustom.value =
      definition.weaponProficienciesCustom ?? '';

    toolProficiencies.value = [...(definition.toolProficiencies ?? [])];
    savingThrowProficiencies.value = [...definition.savingThrowProficiencies];
    skillCount.value = definition.skillChoices.count;
    skillFrom.value = [...definition.skillChoices.from];

    spellcasting.value = toEditableSpellcasting(definition.spellcasting);

    tableColumns.value = toEditableColumns(definition.tableColumns);

    // Только «обычные» ASI представляем чекбоксом строки; эпические дары и любые
    // asi-*, имеющие своё название/описание, сохраняем как настоящие умения.
    const plainAsiKeys = collectPlainAsiKeys(definition.features ?? []);

    preservedAsiFeatures.value = (definition.features ?? []).filter((feature) =>
      plainAsiKeys.has(feature.key),
    );

    levelTable.value = toEditableLevelTable(
      definition.levelTable,
      tableColumns.value,
      plainAsiKeys,
    );

    features.value = toEditableFeatures(
      (definition.features ?? []).filter(
        (feature) => !plainAsiKeys.has(feature.key),
      ),
    );

    // Ресурсы подкласса в выгрузке лежат в общем списке класса с ключом
    // подкласса — форма возвращает их подклассу, иначе они стали бы ресурсами
    // самого класса и достались бы персонажу любого подкласса
    subclasses.value = (definition.subclasses ?? []).map((subclass) =>
      toEditableSubclass({
        ...subclass,
        counters: subclassCounterDefinitions(definition, subclass.key),
      }),
    );

    // Раздаём ПОСЛЕ разбора умений: ресурс возвращается в своё умение по ключу
    counters.value = distributeFeatureCounters(
      classOwnCounterDefinitions(definition),
      features.value,
    );

    equipment.value = (definition.startingEquipment ?? []).map(
      toEditableEquipmentOption,
    );

    activeEffects.value = (definition.activeEffects ?? []).map((effect) => ({
      ...effect,
    }));

    grants.value = featDataToGrants(definition.featData);
    grantedSpells.value = [...(definition.featData?.grantedSpells ?? [])];

    // Ресурсы у класса одни — его счётчики. Заведённые когда-то в блоке даров
    // переносим сюда: модель у них теперь общая, а редактора там больше нет
    if (grants.value.counters.length > 0) {
      counters.value = [...counters.value, ...grants.value.counters];
      grants.value.counters = [];
    }

    if (definition.multiclassProficiencies) {
      multiclassEnabled.value = true;
      multiclassArmor.value = [...definition.multiclassProficiencies.armor];

      multiclassArmorCustom.value =
        definition.multiclassProficiencies.armorCustom ?? '';

      multiclassWeapons.value = [...definition.multiclassProficiencies.weapons];

      multiclassWeaponsCustom.value =
        definition.multiclassProficiencies.weaponsCustom ?? '';

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
      void loadKnownClasses();
    },
    { immediate: true },
  );

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
      .flatMap((feature) => [
        buildFeature(feature),
        ...buildScalingFeatures(feature),
      ]);

    const asiFeatures = buildAsiFeatures(
      levelTable.value,
      baseFeatures,
      preservedAsiFeatures.value,
    );

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

    if (parentClassKey.value) {
      definition.parentClassKey = parentClassKey.value;
    }

    if (primaryAbilities.value.length > 0) {
      definition.primaryAbilities = [...primaryAbilities.value];
    }

    // Разделитель имеет смысл только у списка из двух и более характеристик —
    // проверяем сам список, а не флаг поля: он вычислен для disabled селекта
    if (primaryAbilities.value.length > 1 && primaryAbilitiesDelimiter.value) {
      definition.primaryAbilitiesDelimiter = primaryAbilitiesDelimiter.value;
    }

    if (armorProficienciesCustom.value.trim()) {
      definition.armorProficienciesCustom =
        armorProficienciesCustom.value.trim();
    }

    if (weaponProficienciesCustom.value.trim()) {
      definition.weaponProficienciesCustom =
        weaponProficienciesCustom.value.trim();
    }

    if (toolProficiencies.value.length > 0) {
      definition.toolProficiencies = [...toolProficiencies.value];
    }

    const columns = buildColumns(tableColumns.value);

    if (columns.length > 0) {
      definition.tableColumns = columns;
    }

    // Ресурсы умений — тоже счётчики класса: от уровня класса идут их ступени
    const builtCounters = [
      ...counters.value
        .filter((counter) => counter.name.trim().length > 0)
        .map((counter) => buildCounter(counter)),
      ...buildFeatureCounters(features.value),
    ];

    if (builtCounters.length > 0) {
      definition.counters = builtCounters;
    }

    const builtEquipment = buildClassEquipmentOptions(equipment.value);

    if (builtEquipment.length > 0) {
      definition.startingEquipment = builtEquipment;
    }

    if (activeEffects.value.length > 0) {
      definition.activeEffects = activeEffects.value;
    }

    const featData = buildFeatData(grants.value, grantedSpells.value);

    if (featData) {
      definition.featData = featData;
    }

    if (multiclassEnabled.value) {
      definition.multiclassProficiencies = {
        armor: [...multiclassArmor.value],
        weapons: [...multiclassWeapons.value],
        tools: [...multiclassTools.value],
        skillChoices: multiclassSkillChoices.value,
      };

      if (multiclassArmorCustom.value.trim()) {
        definition.multiclassProficiencies.armorCustom =
          multiclassArmorCustom.value.trim();
      }

      if (multiclassWeaponsCustom.value.trim()) {
        definition.multiclassProficiencies.weaponsCustom =
          multiclassWeaponsCustom.value.trim();
      }
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
    :initial-width="1100"
    :initial-height="800"
    :min-width="640"
    :min-height="480"
    :resizable="true"
    :z-index="zIndex"
    :saved-position="initialPosition"
    :ui="{ body: 'flex min-h-0 flex-col' }"
    @update:open="handleOpenChange"
    @bring-to-front="emit('bring-to-front')"
  >
    <!-- Тело окна — колонка на всю высоту, а прокручивается только содержимое
      вкладки: у окна с изменяемым размером фиксированная высота вкладок
      оставляла бы под ними пустоту, сколько окно ни растягивай -->
    <template #body>
      <!-- Вкладки не переносятся, а прокручиваются лентой: у варианта «pill»
        каждая вкладка растёт по ширине, и одинокая вкладка второй строки
        занимала всю ширину окна. Индикатор активной вкладки при переносе тоже
        ломался — Reka считает ему только горизонтальное положение и на второй
        строке оставлял его под чужой вкладкой -->
      <UTabs
        :items="visibleTabItems"
        variant="pill"
        class="flex min-h-0 flex-1 flex-col"
        :ui="{
          list: 'custom-scrollbar mb-3 shrink-0 overflow-x-auto',
          trigger: 'shrink-0 justify-center',
          content: 'min-h-0 flex-1 overflow-y-auto',
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

                <UFormField
                  class="col-span-2"
                  :label="CLASS_FORM_LABELS.parent"
                >
                  <div class="flex items-center gap-2">
                    <div
                      class="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-elevated/40 px-2.5 py-1.5"
                    >
                      <span
                        class="min-w-0 flex-1 truncate text-sm"
                        :class="parentLabelClass"
                      >
                        {{ parentLabel }}
                      </span>

                      <UBadge
                        v-if="parentPackLabel"
                        color="success"
                        variant="subtle"
                        size="sm"
                        icon="tabler:book"
                        class="shrink-0"
                      >
                        {{ parentPackLabel }}
                      </UBadge>
                    </div>

                    <UButton
                      icon="tabler:books"
                      :label="CLASS_FORM_LABELS.parentPick"
                      color="primary"
                      variant="soft"
                      size="sm"
                      class="shrink-0"
                      @click.left.exact.prevent="openParentPicker"
                    />

                    <UButton
                      v-if="parentClassKey"
                      icon="tabler:x"
                      color="error"
                      variant="ghost"
                      size="sm"
                      class="shrink-0"
                      :title="CLASS_FORM_LABELS.parentClear"
                      :aria-label="CLASS_FORM_LABELS.parentClear"
                      @click.left.exact.prevent="clearParent"
                    />
                  </div>

                  <p class="mt-1 text-xs text-dimmed">
                    {{ CLASS_FORM_LABELS.parentHint }}
                  </p>
                </UFormField>

                <div class="col-span-2 flex items-center">
                  <UCheckbox
                    v-model="isSRD"
                    :label="FORM_FIELD_LABELS.srd"
                  />
                </div>
              </div>
            </FormSection>

            <!-- Характеристики класса: что он повышает в первую очередь и в чём
              владеет спасбросками. Стоят рядом, как в мастерской на сайте, —
              обе строки про характеристики, а не про владения -->
            <FormSection
              :title="CLASS_FORM_LABELS.abilitiesSectionTitle"
              icon="tabler:chart-arrows-vertical"
              :hint="CLASS_FORM_LABELS.primaryAbilitiesHint"
            >
              <div class="flex items-start gap-3">
                <UFormField
                  :label="CLASS_FORM_LABELS.primaryAbilities"
                  class="flex-1"
                >
                  <USelectMenu
                    v-model="primaryAbilities"
                    :items="abilityOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="CLASS_FORM_LABELS.primaryAbilitiesPlaceholder"
                  />
                </UFormField>

                <UFormField
                  :label="CLASS_FORM_LABELS.primaryAbilitiesDelimiter"
                  class="w-28"
                >
                  <USelect
                    v-model="primaryAbilitiesDelimiter"
                    :items="ABILITY_DELIMITER_OPTIONS"
                    value-key="value"
                    :disabled="isDelimiterDisabled"
                    :placeholder="CLASS_FORM_LABELS.primaryAbilitiesDelimiter"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="GRANT_SECTION_LABELS.savingThrows"
                  class="flex-1"
                >
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

            <!-- Группа подклассов отдельным блоком: подпись и уровень выбора
              читаются как одна настройка, а среди общих полей терялись -->
            <FormSection
              v-if="!isSubclass"
              :title="CLASS_FORM_LABELS.subclassesSectionTitle"
              icon="tabler:hierarchy-2"
              :hint="CLASS_FORM_LABELS.subclassesSectionHint"
            >
              <div class="grid grid-cols-2 gap-3">
                <UFormField :label="CLASS_FORM_LABELS.subclassLabel">
                  <UInput
                    v-model="subclassLabel"
                    :placeholder="CLASS_FORM_LABELS.subclassLabelPlaceholder"
                    class="w-full"
                  />
                </UFormField>

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
              <!-- Приписка стоит рядом со своим списком, а не отдельной
                строкой: она уточняет именно его («только щиты») -->
              <div class="grid grid-cols-2 gap-3">
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

                <UFormField :label="CLASS_FORM_LABELS.proficiencyCustom">
                  <UInput
                    v-model="armorProficienciesCustom"
                    :placeholder="CLASS_FORM_LABELS.armorCustomPlaceholder"
                    class="w-full"
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

                <UFormField :label="CLASS_FORM_LABELS.proficiencyCustom">
                  <UInput
                    v-model="weaponProficienciesCustom"
                    :placeholder="CLASS_FORM_LABELS.weaponsCustomPlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  class="col-span-2"
                  :label="GRANT_SECTION_LABELS.tools"
                >
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
                class="grid grid-cols-2 gap-3"
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

                <UFormField :label="CLASS_FORM_LABELS.proficiencyCustom">
                  <UInput
                    v-model="multiclassArmorCustom"
                    :placeholder="CLASS_FORM_LABELS.armorCustomPlaceholder"
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

                <UFormField :label="CLASS_FORM_LABELS.proficiencyCustom">
                  <UInput
                    v-model="multiclassWeaponsCustom"
                    :placeholder="CLASS_FORM_LABELS.weaponsCustomPlaceholder"
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

                <UFormField :label="CLASS_FORM_LABELS.multiclassSkills">
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
          <div class="flex flex-col gap-4">
            <FormSection
              :title="CLASS_FORM_LABELS.spellcastingTitle"
              icon="tabler:sparkles"
              :hint="CLASS_FORM_LABELS.spellcastingHint"
            >
              <ClassSpellcastingFields v-model="spellcasting" />
            </FormSection>

            <!-- Заклинания класса и расширение его списка — здесь, а не в дарах:
              на сайте они на этой же вкладке, и искать их дважды не приходится -->
            <FormSection
              :title="GRANTED_SPELLS_LABELS.title"
              icon="tabler:sparkles"
              :hint="CLASS_FORM_LABELS.spellsHint"
            >
              <GrantedSpellsEditor
                v-model="grantedSpells"
                :available-spells="availableSpells"
                :socket="socket"
                with-required-level
                @open-spell="openSpellDetail"
              />
            </FormSection>

            <FormSection
              :title="SPELL_LIST_LABELS.title"
              icon="tabler:list-details"
            >
              <FeatSpellListEditor
                v-model="grants.spellList"
                :available-spells="availableSpells"
                :socket="socket"
                @open-spell="openSpellDetail"
              />
            </FormSection>
          </div>
        </template>

        <!-- ДАРЫ: то, что даёт взятие класса целиком -->
        <template #grants>
          <div class="flex flex-col gap-4">
            <ClassGrantsFields
              v-model="grants"
              :socket="props.socket"
            />

            <!-- Ресурсы класса стоят среди остальных даров, а не отдельной
              вкладкой: это то же самое «что даёт класс», и искать их в двух
              местах не приходится -->
            <FormSection
              :title="FEAT_GRANTS_LABELS.countersTitle"
              icon="tabler:battery-2"
              :hint="CLASS_FORM_LABELS.countersHint"
            >
              <CounterRowsEditor
                v-model="counters"
                with-start-level
                with-table-column
              />
            </FormSection>
          </div>
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
            :socket="props.socket"
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
              :socket="props.socket"
              :subclass-level="subclassLevel"
              @open-spell="openSpellDetail"
            />
          </div>
        </template>

        <!-- СНАРЯЖЕНИЕ -->
        <template #equipment>
          <div class="flex flex-col gap-2">
            <p class="text-xs text-dimmed">
              {{ CLASS_FORM_LABELS.equipmentHint }}
            </p>

            <StartingEquipmentEditor
              v-model="equipment"
              show-key
              :socket="props.socket"
            />
          </div>
        </template>

        <!-- ЭФФЕКТЫ -->
        <template #effects>
          <EntityEffectsEditor
            v-model="activeEffects"
            modal-id="class-effect-form-modal"
            :hint="CLASS_FORM_LABELS.effectsHint"
            :empty-text="CLASS_FORM_LABELS.effectsEmpty"
            hide-aura
          />
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

  <!-- Выбор родительского класса стоит рядом с формой, а не внутри её вкладки:
    вкладка при переключении размонтируется и унесла бы окно выбора с собой -->
  <CompendiumRefPickerModal
    v-model:open="isParentPickerOpen"
    :socket="props.socket ?? null"
    kind="class"
    :title="CLASS_FORM_LABELS.parentPickTitle"
    :multiple="false"
    :resolve-entry="resolveParentCandidate"
    :z-index="parentPickerZIndex"
    @select="applyParentPick"
  />
</template>
