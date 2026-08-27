<script setup lang="ts">
  import type { PackKindEntries } from '@/core/compendiumDataClient';
  import type {
    CompendiumEntry,
    SourceDefinition,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    ActiveEffect,
    CreatureSize,
    CreatureType,
    DnDGameItem,
    FeatChoice,
    FeatData,
    SpeciesDefinition,
    SpeciesFeature,
    SpeciesGrant,
    SpeciesMovementGrant,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type {
    PickedCompendiumRef,
    PickerEntryFields,
  } from '../CompendiumRefPickerModal.vue';
  import type { SpellOption } from '../grantedSpellsEditorTypes';
  import type { EditableFeature } from './speciesEditorTypes';

  import { computed, ref, watch } from 'vue';

  import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useItemsStore } from '@/stores/itemsStore';
  import {
    buildSpellLinkIndex,
    findSpellInPacks,
    linkGrantedSpellRefs,
    loadSpellPacks,
  } from '@/systems/dnd5e/composables/spellCompendium';
  import { generateId, isRecord, typedObjectEntries } from '@vtt/shared';
  import {
    CREATURE_SIZE_LABELS,
    CREATURE_TYPE_LABELS,
    slugify,
  } from '@vtt/shared/system/dnd.js';

  import CompendiumRefPickerModal from '../CompendiumRefPickerModal.vue';
  import {
    COMPENDIUM_PICKER_LABELS,
    DEFINITION_FORM_LABELS,
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    GRANT_SECTION_LABELS,
    MODAL_BUTTON_LABELS,
    SPECIES_FORM_LABELS,
  } from '../constants';
  import EntityEffectsEditor from '../EntityEffectsEditor.vue';
  import FeatCountersEditor from '../feat/FeatCountersEditor.vue';
  import {
    buildFeatData,
    createEmptyFeatGrants,
    featDataToGrants,
    usedChoiceKeys,
  } from '../feat/featEditorTypes';
  import GrantRowsEditor from '../feat/GrantRowsEditor.vue';
  import ModifierRowsEditor from '../feat/ModifierRowsEditor.vue';
  import FormSection from '../FormSection.vue';
  import SourceField from '../SourceField.vue';
  import { MOVEMENT_AXES } from './speciesEditorTypes';
  import SpeciesFeaturesEditor from './SpeciesFeaturesEditor.vue';

  defineOptions({ inheritAttrs: false });

  /** Основной вид, показанный в поле: как называется и откуда взят. */
  interface ParentSpeciesInfo {
    name: string;
    packName: string;
  }

  const props = defineProps<{
    open: boolean;
    /** Редактируемый вид (null = создание). Всегда плоский SpeciesDefinition. */
    speciesDefinition?: SpeciesDefinition | null;
    /** id исходного GameItem мира при редактировании (для обновления, не дубля) */
    speciesItemId?: string | null;
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
    'save': [species: DnDGameItem];
    'bring-to-front': [];
  }>();

  const initialPosition = computed(() =>
    props.positionOffset
      ? { x: props.positionOffset, y: props.positionOffset }
      : undefined,
  );

  // ============================================================
  // Опции для селектов
  // ============================================================
  const creatureTypeOptions = typedObjectEntries(CREATURE_TYPE_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  const sizeOptions = typedObjectEntries(CREATURE_SIZE_LABELS).map(
    ([value, label]) => ({ value, label }),
  );

  const tabItems = [
    { label: FORM_TAB_LABELS.main, slot: 'basic' as const },
    { label: SPECIES_FORM_LABELS.tabMovement, slot: 'movement' as const },
    { label: SPECIES_FORM_LABELS.tabGrants, slot: 'grants' as const },
    { label: GRANT_SECTION_LABELS.features, slot: 'features' as const },
    { label: SPECIES_FORM_LABELS.tabEffects, slot: 'effects' as const },
  ];

  const { getNextZIndex, openModal } = useModalManager();
  const itemsStore = useItemsStore();

  // ============================================================
  // Состояние формы
  // ============================================================
  const name = ref('');
  const nameEn = ref('');
  const description = ref('');
  const icon = ref('');
  const sourceKey = ref<string | undefined>(undefined);
  const source = ref<SourceDefinition | undefined>(undefined);
  const isSRD = ref(false);
  const creatureType = ref<CreatureType>('humanoid');
  const selectedSizes = ref<CreatureSize[]>(['medium']);

  /** Ключ основного вида; пустая строка — запись самостоятельная. */
  const parentKey = ref('');

  /** Название и пак только что выбранного основного вида — для показа в поле. */
  const pickedParent = ref<ParentSpeciesInfo | null>(null);

  /** Открыто ли окно выбора основного вида */
  const isParentPickerOpen = ref(false);

  /**
   * Слой окна выбора. Без него оно открылось бы ПОД формой, которая его
   * позвала: слои раздаёт менеджер окон, а не порядок в разметке.
   */
  const parentPickerZIndex = ref<number | undefined>(undefined);

  const speedWalk = ref(30);
  const speedFly = ref(0);
  const speedSwim = ref(0);
  const speedClimb = ref(0);
  const speedBurrow = ref(0);

  /** Обычное зрение в футах; 0 — не задано (в запись не пишется). */
  const speciesVision = ref(0);

  /**
   * Дары записи строками — та же редактируемая модель, что у черты и
   * предыстории (`featDataToGrants`/`buildFeatData`). Легаси-гранты известных
   * типов конвертируются в неё при открытии; сохранение пишет только `featData`.
   */
  const recordGrants = ref(createEmptyFeatGrants());

  /**
   * Легаси-гранты неизвестных типов, которые форма не редактирует, но обязана
   * сохранить при редактировании, чтобы не потерять (страховка совместимости).
   */
  const preservedGrants = ref<SpeciesGrant[]>([]);

  // Особенности
  const features = ref<EditableFeature[]>([]);
  const activeEffects = ref<ActiveEffect[]>([]);

  /** Заклинания компендиума по пакам (имя, источник, пак) — для подсказок. */
  const availableSpells = ref<SpellOption[]>([]);

  /** Полные заклинания по пакам — для просмотра по клику (открыть карточку). */
  const spellPacks = ref<
    { packId: string; packName: string; spells: Spell[] }[]
  >([]);

  const existingKey = ref<string | null>(null);
  const existingId = ref<string | null>(null);

  /** Занятые ключи выборов даров записи. */
  const recordTakenKeys = computed(() => [
    ...usedChoiceKeys(recordGrants.value),
  ]);

  // ============================================================
  // Родительский вид (запись — происхождение)
  // ============================================================

  /**
   * Похоже ли значение на определение вида. Отдельным предикатом, а не
   * проверкой по месту: `isRecord` сужает лишь до записи, а нужен
   * `SpeciesDefinition`.
   *
   * @param value - произвольное значение
   */
  function isSpeciesDefinitionRecord(
    value: unknown,
  ): value is SpeciesDefinition {
    return isRecord(value) && value.type === 'species';
  }

  /**
   * Достаёт определение вида из записи справочника: предмет мира прячет его в
   * `speciesData`, а запись компендиума приходит плоской.
   *
   * Смотрим именно на вложенный блоб, а не на «предмет ли это»: у записи вида в
   * компендиуме есть и `id`, и `name`, и `type: 'species'` — по признакам
   * предмета она от предмета мира неотличима, и проверка «предмет ⇒ speciesData»
   * оставляла бы от всего компендиума пустой список.
   *
   * @param entry - запись компендиума или предмет мира
   * @returns определение вида либо `null`
   */
  function readSpeciesDefinition(entry: unknown): SpeciesDefinition | null {
    if (isRecord(entry) && isSpeciesDefinitionRecord(entry.speciesData)) {
      return entry.speciesData;
    }

    return isSpeciesDefinitionRecord(entry) ? entry : null;
  }

  /**
   * Годится ли запись в основной вид и чем она адресуется. Ключ берём у самого
   * определения: у вида мира `id` принадлежит предмету, а в `parentKey` нужен
   * ключ вида — по нему подвид и находит родителя.
   *
   * Отсеиваются подвиды (цепочку «подвид подвида» модель не знает) и сама
   * редактируемая запись — вид не бывает происхождением самого себя.
   *
   * @param entry - запись компендиума или предмет мира
   * @returns поля записи для окна выбора либо `null`
   */
  function resolveParentCandidate(
    entry: CompendiumEntry,
  ): PickerEntryFields | null {
    const definition = readSpeciesDefinition(entry);

    if (
      !definition
      || definition.parentKey
      || definition.key === existingKey.value
    ) {
      return null;
    }

    return {
      key: definition.key,
      name: definition.name,
      nameEn: definition.nameEn,
    };
  }

  /**
   * Виды справочника (компендиум + мир) по ключу. В записи лежит один ключ
   * родителя, а показать в поле надо название — вот откуда оно берётся.
   */
  const knownSpeciesByKey = ref(new Map<string, ParentSpeciesInfo>());

  /** Загружает виды справочника — по ним поле узнаёт название основного вида. */
  async function loadKnownSpecies(): Promise<void> {
    const known = new Map<string, ParentSpeciesInfo>();

    if (props.socket) {
      const packs: PackKindEntries[] = await loadCompendiumKindByPack(
        props.socket,
        'species',
      );

      for (const pack of packs) {
        for (const entry of pack.entries) {
          const definition = readSpeciesDefinition(entry);

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
      const definition = readSpeciesDefinition(worldItem);

      if (definition && !known.has(definition.key)) {
        known.set(definition.key, {
          name: definition.name,
          packName: COMPENDIUM_PICKER_LABELS.worldPack,
        });
      }
    }

    knownSpeciesByKey.value = known;
  }

  /** Запись справочника, стоящая за выбранным ключом родителя. */
  const knownParent = computed(() =>
    parentKey.value ? knownSpeciesByKey.value.get(parentKey.value) : undefined,
  );

  /**
   * Название основного вида. Свежий выбор знает его сам; у записи, открытой на
   * правку, есть только ключ — название ищем в справочнике. Не нашлось (пак с
   * родителем не подключён) — показываем ключ, а не пустое место.
   */
  const parentLabel = computed(() => {
    if (!parentKey.value) {
      return SPECIES_FORM_LABELS.parentNone;
    }

    return (
      pickedParent.value?.name ?? knownParent.value?.name ?? parentKey.value
    );
  });

  /** Пока основной вид не выбран, в поле стоит подсказка — её и приглушаем. */
  const parentLabelClass = computed(() =>
    parentKey.value ? 'text-default' : 'text-dimmed',
  );

  /** Компендиум основного вида — пусто, если запись в справочнике не нашлась. */
  const parentPackLabel = computed(
    () => pickedParent.value?.packName ?? knownParent.value?.packName ?? '',
  );

  /** Открывает окно выбора основного вида поверх формы. */
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

    parentKey.value = parent.url;
    pickedParent.value = { name: parent.name, packName: parent.packName };
  }

  /** Снимает основной вид — запись снова самостоятельная. */
  function clearParent(): void {
    parentKey.value = '';
    pickedParent.value = null;
  }

  // ============================================================
  // Конвертация легаси-грантов в блок даров featData
  // ============================================================

  /**
   * Свободный ключ выбора: первый незанятый из `<база>`, `<база>-2`, ...
   *
   * @param base - базовый ключ по виду выбора
   * @param taken - уже занятые ключи (набор пополняется)
   */
  function freeChoiceKey(base: string, taken: Set<string>): string {
    let candidate = base;
    let suffix = 2;

    while (taken.has(candidate)) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    taken.add(candidate);

    return candidate;
  }

  /**
   * Конвертирует легаси-гранты известных типов в блок даров `featData`.
   * Неизвестные типы возвращаются как есть — их сохранит `preservedGrants`.
   *
   * @param grants - легаси-гранты записи
   * @returns конвертированный блок (null — конвертировать нечего) и остаток
   */
  function legacyGrantsToFeatData(grants: ReadonlyArray<SpeciesGrant>): {
    converted: FeatData | null;
    preserved: SpeciesGrant[];
  } {
    const built: FeatData = { type: 'feat' };
    const choices: FeatChoice[] = [];
    const preserved: SpeciesGrant[] = [];
    const takenKeys = new Set<string>();

    let hasContent = false;

    const pushChoice = (
      type: FeatChoice['type'],
      count: number,
      from: ReadonlyArray<string>,
    ): void => {
      choices.push({
        key: freeChoiceKey(type, takenKeys),
        type,
        count,
        ...(from.length > 0
          ? { options: from.map((value) => ({ value })) }
          : {}),
      });

      hasContent = true;
    };

    const pushItems = (
      field:
        | 'armorProficiencies'
        | 'weaponProficiencies'
        | 'toolProficiencies'
        | 'languages',
      items: ReadonlyArray<string>,
    ): void => {
      if (items.length === 0) {
        return;
      }

      built[field] = [...(built[field] ?? []), ...items];
      hasContent = true;
    };

    for (const grant of grants) {
      switch (grant.type) {
        case 'darkvision':
          built.darkvision = Math.max(built.darkvision ?? 0, grant.range);
          hasContent = true;

          break;
        case 'skillProficiency':
          if (grant.count > 0) {
            pushChoice('skill', grant.count, grant.from ?? []);
          }

          break;
        case 'savingThrowProficiency':
          built.savingThrowProficiencies = [
            ...(built.savingThrowProficiencies ?? []),
            ...grant.abilities,
          ];

          hasContent = true;

          break;
        case 'damageDefense':
          built.damageDefenses = [
            ...(built.damageDefenses ?? []),
            ...grant.entries.map((entry) => ({ ...entry })),
          ];

          hasContent = true;

          break;
        case 'conditionImmunity':
          built.conditionImmunities = [
            ...(built.conditionImmunities ?? []),
            ...grant.conditions,
          ];

          hasContent = true;

          break;
        case 'armorProficiency':
          pushItems('armorProficiencies', grant.items ?? []);

          if (grant.choices) {
            pushChoice('armor', grant.choices.count, grant.choices.from);
          }

          break;
        case 'weaponProficiency':
          pushItems('weaponProficiencies', grant.items ?? []);

          if (grant.choices) {
            pushChoice('weapon', grant.choices.count, grant.choices.from);
          }

          break;
        case 'toolProficiency':
          pushItems('toolProficiencies', grant.items ?? []);

          if (grant.choices) {
            pushChoice('tool', grant.choices.count, grant.choices.from);
          }

          break;
        case 'language':
          pushItems('languages', grant.items ?? []);

          if (grant.choices) {
            pushChoice('language', grant.choices.count, grant.choices.from);
          }

          break;
        default:
          preserved.push(grant);
      }
    }

    if (choices.length > 0) {
      built.choices = choices;
    }

    return { converted: hasContent ? built : null, preserved };
  }

  /**
   * Объединяет два необязательных массива; пустой результат схлопывается в
   * `undefined`, чтобы не плодить пустые поля в блоке даров.
   *
   * @param first - первый массив
   * @param second - второй массив
   */
  function mergeDefinedArrays<T>(
    first: ReadonlyArray<T> | undefined,
    second: ReadonlyArray<T> | undefined,
  ): T[] | undefined {
    const merged = [...(first ?? []), ...(second ?? [])];

    return merged.length > 0 ? merged : undefined;
  }

  /**
   * Сливает блок даров записи с конвертированными легаси-грантами. В реальных
   * записях источник один (новая выгрузка несёт featData, старая — гранты), но
   * при смешении ничего не должно потеряться.
   *
   * @param base - блок даров записи (`featData`)
   * @param extra - конвертированные легаси-гранты
   */
  function mergeFeatData(
    base: FeatData | undefined,
    extra: FeatData | null,
  ): FeatData | null {
    if (!base) {
      return extra;
    }

    if (!extra) {
      return base;
    }

    const takenKeys = new Set((base.choices ?? []).map((choice) => choice.key));

    const mergedChoices = [
      ...(base.choices ?? []),
      ...(extra.choices ?? []).map((choice) => ({
        ...choice,
        key: freeChoiceKey(choice.key, takenKeys),
      })),
    ];

    return {
      ...base,
      darkvision:
        Math.max(base.darkvision ?? 0, extra.darkvision ?? 0) || undefined,
      savingThrowProficiencies: mergeDefinedArrays(
        base.savingThrowProficiencies,
        extra.savingThrowProficiencies,
      ),
      armorProficiencies: mergeDefinedArrays(
        base.armorProficiencies,
        extra.armorProficiencies,
      ),
      weaponProficiencies: mergeDefinedArrays(
        base.weaponProficiencies,
        extra.weaponProficiencies,
      ),
      toolProficiencies: mergeDefinedArrays(
        base.toolProficiencies,
        extra.toolProficiencies,
      ),
      languages: mergeDefinedArrays(base.languages, extra.languages),
      damageDefenses: mergeDefinedArrays(
        base.damageDefenses,
        extra.damageDefenses,
      ),
      conditionImmunities: mergeDefinedArrays(
        base.conditionImmunities,
        extra.conditionImmunities,
      ),
      ...(mergedChoices.length > 0 ? { choices: mergedChoices } : {}),
    };
  }

  // ============================================================
  // Преобразование между моделью данных и редактируемыми полями
  // ============================================================

  /**
   * Разворачивает особенность вида в редактируемые поля.
   *
   * @param feature - особенность вида (базовая или особенность легаси-варианта)
   */
  function toEditableFields(
    feature: SpeciesFeature,
  ): Omit<EditableFeature, 'choices'> {
    return {
      key: feature.key || generateId('sf'),
      name: feature.name || '',
      description: feature.description || '',
      level: feature.level ?? 1,
      isInformationalOnly: feature.isInformationalOnly ?? false,
      movement: {
        walk: feature.movement?.walk ?? 0,
        fly: feature.movement?.fly ?? 0,
        swim: feature.movement?.swim ?? 0,
        climb: feature.movement?.climb ?? 0,
        burrow: feature.movement?.burrow ?? 0,
      },
      darkvision: feature.darkvision ?? 0,
      grantedSpells: (feature.grantedSpells ?? []).map((spell) => ({
        name: spell.name,
        spellId: spell.spellId,
        packId: spell.packId,
      })),
      activeEffects: (feature.activeEffects ?? []).map((effect) => ({
        ...effect,
      })),
      grants: featDataToGrants(feature.featData),
    };
  }

  /**
   * Собирает особенность вида из редактируемых полей (для сохранения).
   *
   * @param fields - редактируемые поля особенности
   */
  function buildFeatureFromFields(
    fields: Omit<EditableFeature, 'choices'>,
  ): SpeciesFeature {
    const built: SpeciesFeature = {
      key: fields.key,
      name: fields.name.trim(),
      description: fields.description.trim(),
    };

    const level = Math.max(1, Math.round(fields.level || 1));

    if (level > 1) {
      built.level = level;
    }

    if (fields.isInformationalOnly) {
      built.isInformationalOnly = true;
    }

    const movement: SpeciesMovementGrant = {};

    for (const axis of MOVEMENT_AXES) {
      if (fields.movement[axis] > 0) {
        movement[axis] = fields.movement[axis];
      }
    }

    if (Object.keys(movement).length > 0) {
      built.movement = movement;
    }

    if (fields.darkvision > 0) {
      built.darkvision = fields.darkvision;
    }

    const grantedSpells = fields.grantedSpells
      .filter((spell) => spell.name.trim().length > 0)
      .map((spell) => ({
        name: spell.name.trim(),
        ...(spell.spellId ? { spellId: spell.spellId } : {}),
        ...(spell.packId ? { packId: spell.packId } : {}),
      }));

    if (grantedSpells.length > 0) {
      built.grantedSpells = grantedSpells;
    }

    if (fields.activeEffects.length > 0) {
      built.activeEffects = fields.activeEffects;
    }

    // Заклинания особенности живут своим полем, поэтому в блок даров не идут
    const featData = buildFeatData(fields.grants, []);

    if (featData) {
      built.featData = featData;
    }

    return built;
  }

  // ============================================================
  // Инициализация при открытии
  // ============================================================
  function resetForm(): void {
    name.value = '';
    nameEn.value = '';
    description.value = '';
    icon.value = '';
    sourceKey.value = undefined;
    source.value = undefined;
    isSRD.value = false;
    creatureType.value = 'humanoid';
    selectedSizes.value = ['medium'];
    parentKey.value = '';
    pickedParent.value = null;
    speedWalk.value = 30;
    speedFly.value = 0;
    speedSwim.value = 0;
    speedClimb.value = 0;
    speedBurrow.value = 0;
    speciesVision.value = 0;
    recordGrants.value = createEmptyFeatGrants();
    preservedGrants.value = [];
    features.value = [];
    activeEffects.value = [];
    existingKey.value = null;
    existingId.value = null;
  }

  function hydrateFromDefinition(definition: SpeciesDefinition): void {
    name.value = definition.name || '';
    nameEn.value = definition.nameEn || '';
    description.value = definition.description || '';
    icon.value = definition.icon || '';
    sourceKey.value = definition.sourceKey;
    source.value = definition.source;
    isSRD.value = definition.isSRD ?? false;
    creatureType.value = definition.creatureType || 'humanoid';
    parentKey.value = definition.parentKey ?? '';

    selectedSizes.value =
      definition.size && definition.size.length > 0
        ? [...definition.size]
        : ['medium'];

    speedWalk.value = definition.speed?.walk ?? 30;
    speedFly.value = definition.speed?.fly ?? 0;
    speedSwim.value = definition.speed?.swim ?? 0;
    speedClimb.value = definition.speed?.climb ?? 0;
    speedBurrow.value = definition.speed?.burrow ?? 0;
    speciesVision.value = definition.vision ?? 0;
    existingKey.value = definition.key;

    // Легаси-гранты известных типов конвертируются в строки даров; неизвестные
    // сохраняются как есть и при сохранении вернутся в grants нетронутыми
    const { converted, preserved } = legacyGrantsToFeatData(
      definition.grants ?? [],
    );

    preservedGrants.value = preserved;

    recordGrants.value = featDataToGrants(
      mergeFeatData(definition.featData, converted) ?? undefined,
    );

    features.value = (definition.features ?? []).map((feature) => ({
      ...toEditableFields(feature),
      choices: (feature.choices ?? []).map((choice) => ({
        key: choice.key || generateId('sfc'),
        name: choice.name || '',
        description: choice.description || '',
        features: (choice.features ?? []).map(toEditableFields),
        damageDefenses: (choice.damageDefenses ?? []).map((entry) => ({
          ...entry,
        })),
        conditionImmunities: [...(choice.conditionImmunities ?? [])],
      })),
    }));

    activeEffects.value = (definition.activeEffects ?? []).map((effect) => ({
      ...effect,
    }));
  }

  /**
   * Загружает заклинания компендиума ПО ПАКАМ — для подсказок связывания,
   * выбора пака и просмотра. Без сокета — пусто (имена вводить всё равно можно).
   */
  async function loadAvailableSpells(): Promise<void> {
    if (!props.socket) {
      availableSpells.value = [];
      spellPacks.value = [];

      return;
    }

    const { packs, options } = await loadSpellPacks(props.socket);

    spellPacks.value = packs;
    availableSpells.value = options;
    autoLinkExactMatches();
  }

  /**
   * Авто-связывает заклинания особенностей с компендиумом по ТОЧНОМУ
   * уникальному (по id) совпадению имени — для базовых особенностей и для
   * вложенных особенностей легаси-вариантов.
   */
  function autoLinkExactMatches(): void {
    const index = buildSpellLinkIndex(availableSpells.value);

    for (const feature of features.value) {
      linkGrantedSpellRefs(feature.grantedSpells, index);

      for (const choice of feature.choices) {
        for (const choiceFeature of choice.features) {
          linkGrantedSpellRefs(choiceFeature.grantedSpells, index);
        }
      }
    }
  }

  /**
   * Открывает детальный просмотр заклинания. Предпочитает указанный пак, иначе
   * берёт первый пак, где это заклинание есть.
   *
   * @param spellId - id заклинания компендиума
   * @param packId - предпочтённый пак (опционально)
   */
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

      existingId.value = props.speciesItemId ?? null;

      if (props.speciesDefinition) {
        hydrateFromDefinition(props.speciesDefinition);
      }

      void loadAvailableSpells();
      void loadKnownSpecies();
    },
    { immediate: true },
  );

  // ============================================================
  // Валидация и сохранение
  // ============================================================
  const canSave = computed(
    () => name.value.trim().length > 0 && selectedSizes.value.length > 0,
  );

  function buildFeatures(): SpeciesFeature[] {
    return features.value
      .filter((feature) => feature.name.trim().length > 0)
      .map((feature) => {
        const built = buildFeatureFromFields(feature);

        const choices = feature.choices.filter(
          (choice) => choice.name.trim().length > 0,
        );

        if (choices.length > 0) {
          built.choices = choices.map((choice) => {
            const choiceFeatures = choice.features
              .filter((choiceFeature) => choiceFeature.name.trim().length > 0)
              .map(buildFeatureFromFields);

            return {
              key: choice.key,
              name: choice.name.trim(),
              description: choice.description.trim(),
              ...(choiceFeatures.length > 0
                ? { features: choiceFeatures }
                : {}),
              ...(choice.damageDefenses.length > 0
                ? {
                    damageDefenses: choice.damageDefenses.map((entry) => ({
                      ...entry,
                    })),
                  }
                : {}),
              ...(choice.conditionImmunities.length > 0
                ? { conditionImmunities: [...choice.conditionImmunities] }
                : {}),
            };
          });
        }

        return built;
      });
  }

  function handleSave(): void {
    if (!canSave.value) {
      return;
    }

    const key =
      existingKey.value
      ?? `${slugify(nameEn.value || name.value) || 'species'}-${
        generateId('w').split('_')[2] ?? 'x'
      }`;

    const speed: SpeciesDefinition['speed'] = { walk: speedWalk.value };

    if (speedFly.value > 0) {
      speed.fly = speedFly.value;
    }

    if (speedSwim.value > 0) {
      speed.swim = speedSwim.value;
    }

    if (speedClimb.value > 0) {
      speed.climb = speedClimb.value;
    }

    if (speedBurrow.value > 0) {
      speed.burrow = speedBurrow.value;
    }

    const definition: SpeciesDefinition = {
      type: 'species',
      key,
      name: name.value.trim(),
      nameEn: nameEn.value.trim() || name.value.trim(),
      description: description.value.trim(),
      icon: icon.value.trim() || undefined,
      sourceKey: sourceKey.value,
      source: source.value,
      isSRD: isSRD.value,
      creatureType: creatureType.value,
      size: [...selectedSizes.value],
      speed,
      // Известные легаси-типы конвертированы в featData; остаются только те,
      // которые форма не знает и потому не редактирует
      grants: [...preservedGrants.value],
      features: buildFeatures(),
    };

    if (parentKey.value) {
      definition.parentKey = parentKey.value;
    }

    if (speciesVision.value > 0) {
      definition.vision = Math.round(speciesVision.value);
    }

    const recordFeatData = buildFeatData(recordGrants.value, []);

    if (recordFeatData) {
      definition.featData = recordFeatData;
    }

    if (activeEffects.value.length > 0) {
      definition.activeEffects = activeEffects.value;
    }

    // При редактировании сохраняем id исходного GameItem (проброшен через
    // speciesItemId), иначе генерируем новый — так правка обновляет запись, а
    // не плодит дубликат (в форму приходит только плоский SpeciesDefinition).
    const gameItem: DnDGameItem = {
      id: existingId.value ?? `item_${generateId('species')}`,
      type: 'species',
      name: definition.name,
      nameEn: definition.nameEn,
      description: definition.description,
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
      speciesData: definition,
    };

    emit('save', gameItem);
    emit('close');
  }

  /**
   * Обрабатывает закрытие окна (крестик/клик мимо) — эмитит `close`.
   *
   * @param value - новое состояние открытости окна
   */
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
      speciesDefinition
        ? SPECIES_FORM_LABELS.editTitle
        : SPECIES_FORM_LABELS.createTitle
    "
    :subtitle="nameEn || undefined"
    :initial-width="960"
    :initial-height="700"
    :min-width="560"
    :min-height="420"
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
      <UTabs
        :items="tabItems"
        variant="pill"
        class="flex min-h-0 flex-1 flex-col"
        :ui="{
          list: 'mb-3 shrink-0',
          trigger: 'flex-1 justify-center',
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
                    :placeholder="SPECIES_FORM_LABELS.namePlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="FORM_FIELD_LABELS.nameEn">
                  <UInput
                    v-model="nameEn"
                    :placeholder="SPECIES_FORM_LABELS.nameEnPlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="SPECIES_FORM_LABELS.creatureType">
                  <USelect
                    v-model="creatureType"
                    :items="creatureTypeOptions"
                    value-key="value"
                    class="w-full"
                  />
                </UFormField>

                <UFormField :label="SPECIES_FORM_LABELS.sizes">
                  <USelectMenu
                    v-model="selectedSizes"
                    :items="sizeOptions"
                    value-key="value"
                    label-key="label"
                    multiple
                    class="w-full"
                    :placeholder="SPECIES_FORM_LABELS.sizesPlaceholder"
                  />

                  <p class="mt-1 text-xs text-dimmed">
                    {{ SPECIES_FORM_LABELS.sizesHelp }}
                  </p>
                </UFormField>

                <UFormField
                  class="col-span-2"
                  :label="SPECIES_FORM_LABELS.parent"
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
                      :label="SPECIES_FORM_LABELS.parentPick"
                      color="primary"
                      variant="soft"
                      size="sm"
                      class="shrink-0"
                      @click.left.exact.prevent="openParentPicker"
                    />

                    <UButton
                      v-if="parentKey"
                      icon="tabler:x"
                      color="error"
                      variant="ghost"
                      size="sm"
                      class="shrink-0"
                      :title="SPECIES_FORM_LABELS.parentClear"
                      :aria-label="SPECIES_FORM_LABELS.parentClear"
                      @click.left.exact.prevent="clearParent"
                    />
                  </div>

                  <p class="mt-1 text-xs text-dimmed">
                    {{ SPECIES_FORM_LABELS.parentHint }}
                  </p>
                </UFormField>

                <SourceField
                  v-model:source-key="sourceKey"
                  v-model:source="source"
                />

                <UFormField :label="DEFINITION_FORM_LABELS.icon">
                  <UInput
                    v-model="icon"
                    :placeholder="SPECIES_FORM_LABELS.iconPlaceholder"
                    class="w-full"
                  />
                </UFormField>

                <div class="col-span-2 flex items-center">
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

        <!-- ДВИЖЕНИЕ -->
        <template #movement>
          <FormSection
            :title="SPECIES_FORM_LABELS.speedTitle"
            icon="tabler:run"
            :hint="SPECIES_FORM_LABELS.speedStackHint"
          >
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <UFormField :label="SPECIES_FORM_LABELS.speedWalk">
                <UInputNumber
                  v-model="speedWalk"
                  :min="0"
                  :max="200"
                />
              </UFormField>

              <UFormField :label="SPECIES_FORM_LABELS.speedFly">
                <UInputNumber
                  v-model="speedFly"
                  :min="0"
                  :max="200"
                />
              </UFormField>

              <UFormField :label="SPECIES_FORM_LABELS.speedSwim">
                <UInputNumber
                  v-model="speedSwim"
                  :min="0"
                  :max="200"
                />
              </UFormField>

              <UFormField :label="SPECIES_FORM_LABELS.speedClimb">
                <UInputNumber
                  v-model="speedClimb"
                  :min="0"
                  :max="200"
                />
              </UFormField>

              <UFormField :label="SPECIES_FORM_LABELS.speedBurrow">
                <UInputNumber
                  v-model="speedBurrow"
                  :min="0"
                  :max="200"
                />
              </UFormField>
            </div>

            <p class="mt-3 text-xs text-dimmed">
              {{ SPECIES_FORM_LABELS.speedHint }}
            </p>
          </FormSection>

          <FormSection
            :title="SPECIES_FORM_LABELS.visionTitle"
            icon="tabler:eye"
            :hint="SPECIES_FORM_LABELS.visionHint"
            class="mt-4"
          >
            <UInputNumber
              v-model="speciesVision"
              :min="0"
              :max="1000"
              :step="5"
              class="w-40"
            />
          </FormSection>
        </template>

        <!-- ДАРЫ -->
        <template #grants>
          <div class="flex flex-col gap-4">
            <p class="text-xs text-dimmed">
              {{ SPECIES_FORM_LABELS.grantsTabHelp }}
            </p>

            <FormSection
              :title="SPECIES_FORM_LABELS.recordGrantsTitle"
              icon="tabler:gift"
              :hint="SPECIES_FORM_LABELS.recordGrantsHint"
            >
              <GrantRowsEditor
                v-model="recordGrants.grantRows"
                hide-ability
                :taken-keys="recordTakenKeys"
              />
            </FormSection>

            <FormSection
              :title="SPECIES_FORM_LABELS.recordModifiersTitle"
              icon="tabler:adjustments"
            >
              <ModifierRowsEditor v-model="recordGrants.modifiers" />
            </FormSection>

            <FormSection
              :title="SPECIES_FORM_LABELS.recordCountersTitle"
              icon="tabler:hexagons"
            >
              <FeatCountersEditor v-model="recordGrants.counters" />
            </FormSection>
          </div>
        </template>

        <!-- ОСОБЕННОСТИ -->
        <template #features>
          <SpeciesFeaturesEditor
            v-model="features"
            :available-spells="availableSpells"
            :socket="socket"
            @open-spell="openSpellDetail"
          />
        </template>

        <!-- ЭФФЕКТЫ -->
        <template #effects>
          <EntityEffectsEditor
            v-model="activeEffects"
            modal-id="species-effect-form-modal"
            :hint="SPECIES_FORM_LABELS.effectsHint"
            :empty-text="SPECIES_FORM_LABELS.effectsEmpty"
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
          {{ SPECIES_FORM_LABELS.saveHint }}
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
              speciesDefinition
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

  <!-- Выбор основного вида стоит рядом с формой, а не внутри её вкладки:
    вкладка при переключении размонтируется и унесла бы окно выбора с собой -->
  <CompendiumRefPickerModal
    v-model:open="isParentPickerOpen"
    :socket="props.socket ?? null"
    kind="species"
    :title="SPECIES_FORM_LABELS.parentPickTitle"
    :multiple="false"
    :resolve-entry="resolveParentCandidate"
    :z-index="parentPickerZIndex"
    @select="applyParentPick"
  />
</template>
