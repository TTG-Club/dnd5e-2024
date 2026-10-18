<script setup lang="ts">
  import type {
    AbilityType,
    BaseActor,
    Feature,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    BackgroundDefinition,
    ClassCounterDefinition,
    ClassDefinition,
    DnDActor,
    DnDGameItem,
    FeatAwaitingChoices,
    LongRestOptions,
    ResolvedGrantedSpell,
    RestTriggerOptions,
    RestType,
    ShortRestHitDiceResult,
    SpeciesDefinition,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { ItemTransferResult } from '../../composables/useItemTransfer';
  import type { ActorSubclassBadgeEntry } from './ActorHeader.vue';
  import type { ProficiencyHoldings } from './class/classRollback';
  import type { PickedDefinition } from './CompendiumPickerModal.vue';
  import type { MissingSheetSectionKey } from './constants';
  import type { AppliedFeatFeature } from './feat/featApply';
  import type { WizardQueueStep } from './levelUpTypes';
  import type {
    GrantRemovalOption,
    GrantRemovalSubject,
  } from './removal/grantRemovalPlan';

  import { useToast } from '@nuxt/ui/composables';
  import { createReusableTemplate } from '@vueuse/core';
  import { computed, ref, toRef, useTemplateRef, watch } from 'vue';

  import { ClientHooks } from '@/core/clientHooks';
  import { generateEntityId, requireSocket } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useActiveTab } from '@/shared_ui/composables/useActiveTab';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { useWorldStore } from '@/stores/worldStore';
  import { generateId, isEntityOwner, isRecord } from '@vtt/shared';
  import {
    appendGrantedSpells,
    applyActorRest,
    applyShortRestWithHitDice,
    calculateAbilityModifier,
    calculateMaxHP,
    checkFeatPrerequisites,
    cloneActorProficiencies,
    collectClassCounterDefinitions,
    collectFeatsAwaitingLeveledChoices,
    collectRechoosableFeats,
    collectSpeciesFeatDataSources,
    computeSpeciesDarkvision,
    computeSpeciesMovement,
    createInventoryItem,
    DEFAULT_ACTOR,
    getMulticlassProficiencies,
    getTotalLevel,
    isClassDefinition,
    isDndActor,
    isDndActorRecord,
    isSameCounterList,
    isSpell,
    mergeEntityDraft,
    normalizeActor,
    refreshFeatCounters,
    refreshSpeciesCounters,
    removeFeatChoiceSelections,
    removeFeatDataProficiencies,
    removeGrantedSpellsByFeatureNames,
    resolveActorStats,
    resolveEntityMaxHp,
    resolveFeatChoicesToAsk,
    resolveHitDiceSpendRules,
    spendShortRestHitDice,
    subspeciesFitsPack,
  } from '@vtt/shared/system/dnd.js';

  import { runRestWithTriggers } from '../../composables/restTriggerPrompt';
  import {
    refuseWhileSheetEditing,
    useSheetEditLock,
  } from '../../composables/sheetEditLock';
  import { useClassCatalog } from '../../composables/useClassCatalog';
  import { useEntityDraftWrite } from '../../composables/useEntityDraftWrite';
  import {
    describeItemTransfer,
    isItemTransferDrop,
    useItemTransfer,
  } from '../../composables/useItemTransfer';
  import { usePackChoiceQueue } from '../../composables/usePackChoicePrompt';
  import { useSheetLayout } from '../../composables/useSheetLayout';
  import { useSheetMinimize } from '../../composables/useSheetMinimize';
  import {
    isSpeciesDefinitionEntry,
    useSpeciesCatalog,
  } from '../../composables/useSpeciesCatalog';
  import { useWorldSheetSync } from '../../composables/useWorldSheetSync';
  import { useSystemDataStore } from '../../stores/systemDataStore';
  import ActorCenterPanel from './ActorCenterPanel.vue';
  import ActorHeader from './ActorHeader.vue';
  import ActorLeftPanel from './ActorLeftPanel.vue';
  import ActorRightPanel from './ActorRightPanel.vue';
  import ActorTabs from './ActorTabs.vue';
  import {
    buildBackgroundRemovalUpdates,
    rollbackBackgroundProficiencies,
  } from './background/backgroundRollback';
  import BackgroundSetupWizard from './background/BackgroundSetupWizard.vue';
  import ChoicePickerModal from './ChoicePickerModal.vue';
  import { isClassEffect } from './class/classEffects';
  import {
    diffProficiencyHoldings,
    rollbackClassProficiencies,
  } from './class/classRollback';
  import ClassSetupWizard from './class/ClassSetupWizard.vue';
  import CompendiumPickerModal from './CompendiumPickerModal.vue';
  import {
    ACTOR_SHEET_LABELS,
    ACTOR_SHEET_LAYOUT_CLASSES,
    ACTOR_SHEET_LOG_PREFIX,
    ACTOR_SHEET_WIDE_MIN_WIDTH_REM,
    BACKGROUND_DEFINITION_MIME,
    CLASS_DEFINITION_MIME,
    CLASS_WIZARD_LABELS,
    COMPENDIUM_PICKER_LABELS,
    DRAG_OVER_RESET_DELAY_MS,
    FEAT_CHOICES_LABELS,
    FEAT_PREREQUISITE_LABELS,
    FEATURE_OPTION_SEPARATOR,
    FEATURE_SOURCE_SEPARATOR,
    GAME_FEATURE_MIME,
    GAME_ITEM_MIME,
    MODAL_BUTTON_LABELS,
    PACK_CHOICE_INITIAL_SELECTION,
    PACK_CHOICE_PICK_COUNT,
    REST_LABELS,
    SHEET_FRAME_CLASSES,
    SHEET_SUMMARY_COMPACT_CLASSES,
    SHEET_SUMMARY_WIDE_CLASSES,
    SHEET_WINDOW_MIN_WIDTH,
    SPECIES_DEFINITION_MIME,
    SPECIES_WIZARD_LABELS,
    SPELL_MIME,
    TOAST_TITLES,
    UNSAVED_CHANGES_LABELS,
  } from './constants';
  import {
    applyFeatToActor,
    reapplyFeatToActor,
    resolveActorFeatSpells,
    resolveFeatGrantedSpells,
  } from './feat/featApply';
  import FeatChoicesModal from './feat/FeatChoicesModal.vue';
  import FeatRechooseModal from './feat/FeatRechooseModal.vue';
  import LongRestModal from './LongRestModal.vue';
  import GrantRemovalModal from './removal/GrantRemovalModal.vue';
  import {
    applyGrantRemovalSelection,
    collectGrantRemovalOptions,
  } from './removal/grantRemovalPlan';
  import ShortRestModal from './ShortRestModal.vue';
  import {
    buildSpeciesRemovalUpdates,
    rollbackSpeciesProficiencies,
  } from './species/speciesRollback';
  import SpeciesSetupWizard from './species/SpeciesSetupWizard.vue';
  import { resolveActorSpeciesSpells } from './species/speciesSpellUnlock';
  import SubspeciesChoiceModal from './species/SubspeciesChoiceModal.vue';

  /** Вид с подвидами, ждущий ответа «какой подвид» */
  interface PendingSubspeciesChoice {
    /** Вид, который ставится на лист */
    species: SpeciesDefinition;
    /** Пак вида */
    packId?: string;
    /** Подвиды вида — варианты окна */
    options: SpeciesDefinition[];
  }

  /** Удаление записи, ждущее выбора в окне */
  interface PendingGrantRemoval {
    subject: GrantRemovalSubject;
    options: GrantRemovalOption[];
  }

  /** Выбор игрока в окне удаления: применяется сразу после отката записи */
  interface GrantRemovalChoice {
    options: GrantRemovalOption[];
    /** Ключи строк, отмеченных к удалению */
    selectedIds: ReadonlySet<string>;
    /** Заклинания листа до отката: оставленные выданные берутся отсюда */
    spellsBefore: Spell[];
  }

  interface Props {
    open: boolean;
    actorId?: string;
    worldId: string;
    actors: DnDActor[];
    socket: TypedWebSocketClient | null;
    zIndex?: number;
    modalId?: string;
    isAdmin?: boolean;
    users?: Array<{ id: string; username: string; role: string }>;
    worldPort?: number;
    savedPosition?: { x: number; y: number };
    savedSize?: { width: number; height: number };
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'save': [actor: DnDActor];
    'close': [];
    'bring-to-front': [];
  }>();

  const worldStore = useWorldStore();
  const systemDataStore = useSystemDataStore();
  const toast = useToast();
  const { openModal, updateModalProps } = useModalManager();

  // Состояние
  const isEditMode = ref(false);
  const localActor = ref<DnDActor | null>(null);
  const savedSnapshot = ref<DnDActor | null>(null); // Снимок для отката изменений
  const isDirty = ref(false);
  const isSaving = ref(false);
  const isCreated = ref(false); // Флаг: персонаж уже создан на сервере

  /**
   * Характеристика под курсором: её навыки подсвечиваются в списке. Плитки
   * характеристик и список навыков стоят в разных колонках листа, поэтому
   * связывает их лист — общий родитель обеих панелей.
   */
  const highlightedAbility = ref<AbilityType | null>(null);

  /**
   * Запоминает характеристику под курсором для подсветки навыков.
   *
   * @param abilityKey - характеристика плитки; null — подсвечивать нечего
   */
  function handleAbilityHighlight(abilityKey: AbilityType | null): void {
    highlightedAbility.value = abilityKey;
  }

  // Модалка подтверждения
  const isConfirmOpen = ref(false);
  const pendingAction = ref<'close' | null>(null);

  // Модалка мастера классов
  const isClassWizardOpen = ref(false);
  const droppedClassDef = ref<ClassDefinition | null>(null);

  /** Пак записи класса в мастере: ложится на запись актора и ведёт следующие уровни */
  const droppedClassPackId = ref<string | undefined>(undefined);

  /** Мастер класса открыт, но список классов ещё грузится — показываем скелетон. */
  const isClassSetupLoading = ref(false);

  // Модалка мастера видов
  const isSpeciesWizardOpen = ref(false);

  const droppedSpeciesDef = ref<SpeciesDefinition | null>(null);

  /** Пак записи вида в мастере — на запись актора */
  const droppedSpeciesPackId = ref<string | undefined>(undefined);
  /**
   * Подвид, выбранный до мастера: отмечен в окне выбора, перенесён на лист сам
   * или назван в окне «какой подвид».
   */
  const droppedSubspeciesKey = ref<string | null>(null);

  /**
   * Вид с подвидами, ждущий ответа «какой подвид»: окно открыто, пока это
   * поле не пусто.
   */
  const pendingSubspeciesChoice = ref<PendingSubspeciesChoice | null>(null);

  /**
   * Вопросы «из какого компендиума взять запись» для этого персонажа: мастера и
   * выдачи черт спрашивают через общую очередь, лист показывает по одному.
   */
  const {
    currentQuestion: packChoiceQuestion,
    answerCurrent: answerPackChoice,
  } = usePackChoiceQueue(computed(() => localActor.value?.id));

  // Модалка мастера предыстории
  const isBackgroundWizardOpen = ref(false);
  const droppedBackgroundDef = ref<BackgroundDefinition | null>(null);

  /** Пак записи предыстории в мастере — на запись актора */
  const droppedBackgroundPackId = ref<string | undefined>(undefined);

  // Модалка подтверждения замены вида/предыстории
  const isReplaceConfirmOpen = ref(false);
  const replaceConfirmTarget = ref<'species' | 'background' | null>(null);

  // Окно выбора вида/класса/предыстории из компендиума (клик по шапке листа)
  const isCompendiumPickerOpen = ref(false);
  const compendiumPickerKind = ref<MissingSheetSectionKey>('species');

  /**
   * Определение последнего применённого вида.
   * Сохраняется после каждого применения вида для корректного отката при смене.
   */
  const appliedSpeciesDef = ref<SpeciesDefinition | null>(null);

  /** Определение применённого подвида-записи — для точного отката при смене. */
  const appliedSubspeciesDef = ref<SpeciesDefinition | null>(null);

  // Очередь для последовательного повышения уровней (Wizard)
  const wizardQueue = ref<WizardQueueStep[]>([]);

  // Раскладку выбирает ширина самого листа, а не экрана: окно листа сужают и
  // на большом экране, и тогда он обязан перестроиться так же, как на телефоне.
  const sheetBodyRef = useTemplateRef<HTMLElement>('sheetBody');

  const { isMeasured, isWide } = useSheetLayout(
    sheetBodyRef,
    ACTOR_SHEET_WIDE_MIN_WIDTH_REM,
  );

  const [DefineSummary, ReuseSummary] = createReusableTemplate();

  /** Классы раскладки листа: колонками на широком, столбцом на узком */
  const sheetLayoutClasses = computed(() =>
    isWide.value
      ? ACTOR_SHEET_LAYOUT_CLASSES.wide
      : ACTOR_SHEET_LAYOUT_CLASSES.compact,
  );

  const sheetFrameClass = computed(() =>
    isWide.value ? SHEET_FRAME_CLASSES.wide : SHEET_FRAME_CLASSES.compact,
  );

  const summaryLayoutClasses = computed(() =>
    isWide.value ? SHEET_SUMMARY_WIDE_CLASSES : SHEET_SUMMARY_COMPACT_CLASSES,
  );

  // Drag and Drop refs
  const isSpellDragOver = ref(false);
  const isEquipmentDragOver = ref(false);
  const isFeatureDragOver = ref(false);

  const { activeTab } = useActiveTab(
    'actor-sheet',
    toRef(() => localActor.value?.id),
    'equipment',
  );

  function isBackgroundDefinition(
    value: unknown,
  ): value is BackgroundDefinition {
    return isRecord(value) && value.type === 'background';
  }

  /**
   * Нагрузка переноса записи: определение вместе с паком либо голое
   * определение — так тянули раньше, и записи из браузера компендиума тянут до
   * сих пор.
   *
   * @param raw - разобранный JSON из `dataTransfer`
   */
  function unwrapDroppedDefinition(raw: unknown): {
    definition: unknown;
    packId?: string;
  } {
    if (isRecord(raw) && 'definition' in raw) {
      return {
        definition: raw.definition,
        packId: typeof raw.packId === 'string' ? raw.packId : undefined,
      };
    }

    return { definition: raw };
  }

  /** Запись справочника базовых типов снаряжения: ключ и категория. */
  interface EquipmentBaseTypeEntry {
    key: string;
    category: string;
  }

  /**
   * Разворачивает ключи владений класса в конкретные ключи базовых типов:
   * категория («light», «simple») превращается во все входящие в неё типы,
   * точный ключ остаётся собой, а неизвестный справочнику сохраняется как есть —
   * данные класса могут опережать справочник.
   *
   * Доспехи и оружие устроены одинаково, поэтому справочник передаётся
   * параметром: два одинаковых распаковщика разошлись бы при первой же правке.
   *
   * @param proficiencyKeys - ключи владений из определения класса
   * @param baseTypes - справочник базовых типов (доспехи или оружие)
   * @returns ключи базовых типов без повторов
   */
  function unpackProficiencyKeys(
    proficiencyKeys: readonly string[],
    baseTypes: readonly EquipmentBaseTypeEntry[],
  ): string[] {
    const result = new Set<string>();

    for (const proficiencyKey of proficiencyKeys) {
      const matchedTypes = baseTypes.filter(
        (baseType) =>
          baseType.category === proficiencyKey
          || baseType.key === proficiencyKey,
      );

      if (matchedTypes.length > 0) {
        matchedTypes.forEach((baseType) => result.add(baseType.key));
      } else {
        result.add(proficiencyKey);
      }
    }

    return Array.from(result);
  }

  /**
   * Классы по пакам: компендиум и мир порознь, подклассы свёрнуты внутрь
   * родителей своего пака. Запись ищется парой «пак + ключ» — копия
   * одноимённого класса в соседнем компендиуме не подменяет выбранную.
   */
  const classCatalog = useClassCatalog(toRef(props, 'socket'));

  /** Виды по пакам: компендиум и мир порознь, запись ищется парой «пак + ключ» */
  const speciesCatalog = useSpeciesCatalog(toRef(props, 'socket'));

  /**
   * Виды одним списком — мастеру вида и вкладке умений. При повторе ключа
   * берётся копия из пака вида персонажа: иначе подвиды и особенности читались
   * бы из соседнего компендиума.
   */
  const speciesDefinitions = computed(() =>
    speciesCatalog.flatPreferring(localActor.value?.system.species?.packId),
  );

  // Вкладка умений берёт варианты особенностей из стора — держим его в такте
  watch(
    speciesDefinitions,
    (definitions) => systemDataStore.rememberSpeciesDefinitions(definitions),
    { immediate: true },
  );

  /**
   * Записи видов для мастера: подвиды берутся из пака выбранного вида — у
   * одноимённого вида в соседнем компендиуме подвиды могут быть другими.
   * Подвиды мира, скопированные из другого компендиума, сюда не попадают.
   */
  const wizardSpeciesRecords = computed(() =>
    speciesCatalog
      .flatPreferring(droppedSpeciesPackId.value)
      .filter((record) =>
        subspeciesFitsPack(
          record,
          droppedSpeciesPackId.value,
          speciesCatalog.packIds.value,
        ),
      ),
  );

  /**
   * Загружает определение текущего вида актора для отката при смене.
   *
   * @param actorData - актор с существующим видом
   */
  async function loadCurrentSpeciesDefinition(
    actorData: DnDActor,
  ): Promise<void> {
    const speciesKey = actorData.system.species?.speciesKey;

    if (!speciesKey) {
      return;
    }

    await speciesCatalog.load();

    const packId = actorData.system.species?.packId;
    const found = speciesCatalog.resolve({ key: speciesKey, packId }) ?? null;

    if (found) {
      appliedSpeciesDef.value = found;
    }

    const subspeciesKey = actorData.system.species?.subspeciesKey;

    appliedSubspeciesDef.value = subspeciesKey
      ? (speciesCatalog.resolve({ key: subspeciesKey, packId }) ?? null)
      : null;
  }

  // Предзагрузка определений компендиума при появлении сокета (и смене мира).
  watch(
    () => props.socket,
    (socket) => {
      if (socket) {
        void classCatalog.load();
        void speciesCatalog.load();
      }
    },
    { immediate: true },
  );

  const confirmMessage = ACTOR_SHEET_LABELS.confirmSave;

  // Computed
  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const currentUser = computed(() => {
    if (!props.worldId || !worldStore.connectionState.loggedAsUserId) {
      return null;
    }

    const world = worldStore.getWorldById(props.worldId);

    if (!world) {
      return null;
    }

    return world.users.find(
      (user) => user.id === worldStore.connectionState.loggedAsUserId,
    );
  });

  const isAdmin = computed(() => {
    if (props.isAdmin !== undefined) {
      return props.isAdmin;
    }

    return worldStore.isGM;
  });

  const storeActor = computed<DnDActor | null | undefined>(() => {
    if (!props.actorId || !props.worldId) {
      return null;
    }

    const world = worldStore.getWorldById(props.worldId);

    if (!world) {
      return props.actors.find((actorEntry) => actorEntry.id === props.actorId);
    }

    // Запись стора мира — нейтральная, D&D-форму подтверждает гвард. Акторы
    // мира прогоняются через `normalizeActor` при загрузке мира, поэтому здесь
    // проверка проходит; если запись всё же не в D&D-форме, лист откроется
    // (его копия мигрируется в `initializeActor`), но внешние правки в него
    // подхватываться не будут.
    const found = world.actors.find(
      (actorEntry) => actorEntry.id === props.actorId,
    );

    return found && isDndActor(found) ? found : undefined;
  });

  const isOwner = computed(() => {
    if (!localActor.value) {
      return false;
    }

    return isEntityOwner(
      props.actorId ? storeActor.value : localActor.value,
      currentUser.value?.id,
    );
  });

  const canEdit = computed(() => {
    return isAdmin.value || isOwner.value;
  });

  /**
   * Определения счётчиков из компендиума для всех классов актора — по ним
   * ClassCounters подписывает ресурсы. Свои ресурсы класса и ресурсы его
   * выбранного подкласса: ресурсы других подклассов персонажу не положены, а
   * попавший на лист по ошибке ресурс подписан своим именем и в определении не
   * нуждается.
   */
  const counterDefinitions = computed((): ClassCounterDefinition[] => {
    if (!localActor.value) {
      return [];
    }

    const classes = localActor.value.system.classes;

    if (!classes || classes.length === 0) {
      return [];
    }

    return classes.flatMap((classEntry) => {
      const classDef = classCatalog.resolve({
        key: classEntry.classKey,
        packId: classEntry.packId,
      });

      if (!classDef) {
        return [];
      }

      return collectClassCounterDefinitions(
        classDef,
        classEntry.subclassKey,
      ).filter((counter) => classEntry.level >= counter.startLevel);
    });
  });

  /**
   * Выбранные подклассы для значка в шапке. На записи актора лежит только
   * ключ подкласса, название берётся из определения класса. Подкласс, которого
   * в каталоге нет (каталог ещё грузится или запись удалили), не показывается:
   * голый ключ игроку ничего не скажет.
   */
  const subclassBadgeEntries = computed((): ActorSubclassBadgeEntry[] => {
    const classes = localActor.value?.system.classes ?? [];

    return classes.flatMap((classEntry) => {
      if (!classEntry.subclassKey) {
        return [];
      }

      const classDef = classCatalog.resolve({
        key: classEntry.classKey,
        packId: classEntry.packId,
      });

      const subclass = classDef?.subclasses.find(
        (entry) => entry.key === classEntry.subclassKey,
      );

      if (!subclass) {
        return [];
      }

      return [
        {
          classKey: classEntry.classKey,
          className: classEntry.className,
          subclassName: subclass.name,
        },
      ];
    });
  });

  // Основа черновика: от неё считается то, что сохранение шлёт серверу
  const { draftBase, rebaseDraft, saveDraft } = useEntityDraftWrite({
    readDraft: () => localActor.value,
    readWorld: () => storeActor.value,
    isEntity: isDndActorRecord,
  });

  function initializeActor() {
    if (props.actorId) {
      const world = worldStore.getWorldById(props.worldId);

      // Мир хоста хранит акторов в НЕЙТРАЛЬНОЙ форме: у записи старого мира
      // D&D-формы ещё нет — её собирает `normalizeActor` ниже, на копии.
      const actor: BaseActor | undefined = world
        ? world.actors.find((actorEntry) => actorEntry.id === props.actorId)
        : // Веб версия - используем props.actors
          props.actors.find((actorEntry) => actorEntry.id === props.actorId);

      if (actor) {
        // Правится копия, а не запись стора: сущности хоста лист не мутирует
        const draft: BaseActor = JSON.parse(JSON.stringify(actor));

        normalizeActor(draft);

        // Гвард — постусловие миграции: после неё форма собрана целиком
        if (isDndActor(draft)) {
          localActor.value = draft;
          isEditMode.value = false;

          // Загружаем определение текущего вида для отката при смене
          void loadCurrentSpeciesDefinition(draft);
        } else {
          console.error(ACTOR_SHEET_LOG_PREFIX, props.actorId);
        }
      } else {
        console.error('[ActorModal] Actor not found with id:', props.actorId);
      }
    } else {
      const newId = generateEntityId('actor');

      // Шаблон копируем ГЛУБОКО. `DEFAULT_ACTOR` — модульная константа, а лист
      // пишет во вложенные разделы напрямую (`Object.assign(…system, …)` в
      // мастерах класса/вида/предыстории, пересборка владений, пересчёт хитов).
      // При мелком копировании `system`/`token` оставались ОБЩИМИ с шаблоном:
      // правки первого персонажа утекали в константу, и следующее «Создать
      // актёра» открывалось уже заполненным предыдущим персонажем.
      //
      // `structuredClone`, а не JSON-клон как в `featApply.ts`: там клонируют
      // реактивный Proxy листа (он бросает `DataCloneError`), здесь — сырую
      // константу, поэтому ограничения нет, а типы сохраняются без приведений.
      const newActor: DnDActor = {
        ...structuredClone(DEFAULT_ACTOR),
        id: newId,
        ownerId: !isAdmin.value ? currentUser.value?.id : undefined,
      };

      localActor.value = newActor;
      isEditMode.value = true;
    }

    isDirty.value = false;
    rebaseDraft();
  }

  watch(
    () => storeActor.value,
    (newActor, oldActor) => {
      // Если актера удалили, закрываем модалку
      if (oldActor && !newActor) {
        isOpen.value = false;
        emit('close');
      }
    },
  );

  /**
   * Разделы, которые система пишет в мир во время игры (ресурсы листа,
   * предметы, заклинания, эффекты, хиты), подтягиваются из стора в localActor.
   *
   * Зачем: localActor — глубокая копия на момент открытия листа, и лист
   * показывает её, а не мир. Сохранение шлёт серверу только разницу с
   * основой черновика, поэтому пришедшее из мира кладётся и в черновик, и в
   * основу: иначе лист отправил бы чужое изменение как своё.
   *
   * В режиме редактирования синхронизация выключена: локальные правки имеют
   * приоритет до «Сохранить»/«Отменить».
   */
  const { pullFromWorld } = useWorldSheetSync({
    readWorld: () => storeActor.value,
    draft: localActor,
    base: draftBase,
    isPaused: () => isEditMode.value,
  });

  // Пока лист в правке, персонаж не действует ни с листа, ни с панелей.
  // Отметка держится на том же id, с которым действуют вкладки листа, — на id
  // черновика: у нового, ещё не сохранённого персонажа `props.actorId` пуст, и
  // каст с такого листа шёл мимо проверки и молча ничего не делал
  useSheetEditLock(
    () => localActor.value?.id,
    () => isEditMode.value,
  );

  /**
   * Что лист показывает после «Сохранить». Черновик правки сливается с миром:
   * правки владельца — из черновика, всё, что он не трогал, — из мира (урон от
   * другого клиента, срабатывание сервера, списанный ресурс). На сервер при
   * этом уходят только правки владельца — разница со снимком входа в правку.
   *
   * @param draft - черновик листа
   * @returns персонаж, каким он станет после записи
   */
  function resolveActorToSave(draft: DnDActor): DnDActor {
    const world = storeActor.value;

    return isEditMode.value && savedSnapshot.value && world
      ? mergeEntityDraft(savedSnapshot.value, draft, world, isDndActorRecord)
      : draft;
  }

  function handleActorUpdate(updates: Partial<DnDActor>) {
    if (localActor.value) {
      Object.assign(localActor.value, updates);
      isDirty.value = true;

      if (!isEditMode.value) {
        handleImmediateSave();
      }
    }
  }

  /**
   * Немедленное сохранение актёра на сервер (для действий вне режима редактирования:
   * drop в снаряжение, экипировка, удаление)
   */
  function handleImmediateSave() {
    if (!localActor.value || !props.socket || !canEdit.value) {
      return;
    }

    try {
      requireSocket(props.socket);
      saveDraft(props.socket);

      isDirty.value = false;
    } catch (error) {
      console.error('[ActorModal] Immediate save failed:', error);
    }
  }

  /** Открыта ли модалка короткого отдыха (трата костей хитов) */
  const isShortRestOpen = ref(false);

  /** Открыта ли модалка продолжительного отдыха (предпросмотр восстановления) */
  const isLongRestOpen = ref(false);
  /**
   * Открыт пересмотр выборов черт. Живёт рядом с отдыхом, а не с выдачей черты:
   * открывает его именно продолжительный отдых.
   */
  const isFeatRechooseOpen = ref(false);

  /**
   * Удаление класса, вида или предыстории, ждущее выбора игрока: что из
   * выданного убрать вместе с записью. Пусто — спрашивать было не о чем.
   */
  const pendingGrantRemoval = ref<PendingGrantRemoval | null>(null);
  /** Открыто ли окно выбора при удалении записи */
  const isGrantRemovalOpen = ref(false);

  /**
   * Черты, у которых на новом уровне открылся выбор с уровнем доступа.
   * Пусто — окно выбора работает по своему обычному поводу (отдых).
   */
  const featsAwaitingLeveledChoices = ref<FeatAwaitingChoices[] | null>(null);

  /**
   * Модификатор Телосложения актёра для броска костей хитов — итоговый, с
   * эффектами: прибавки предыстории и повышения характеристик лежат ими, и по
   * числу листа кость хитов лечила бы меньше положенного
   */
  /** Как черты меняют трату костей хитов на коротком отдыхе */
  const hitDiceSpendRules = computed(() =>
    localActor.value ? resolveHitDiceSpendRules(localActor.value) : undefined,
  );

  const constitutionModifier = computed(() =>
    localActor.value
      ? resolveActorStats(localActor.value).abilityMods.constitution
      : 0,
  );

  /**
   * Применяет отдых к актёру. Оба типа отдыха открывают модалку: короткий —
   * для траты костей хитов, долгий — для предпросмотра восстановления.
   * @param restType - тип отдыха
   */
  function handleRest(restType: RestType): void {
    // Отдых в режиме правки ждёт «Сохранить» или отмены, как и действия
    if (refuseWhileSheetEditing(localActor.value?.id)) {
      return;
    }

    if (restType === 'short') {
      isShortRestOpen.value = true;

      return;
    }

    isLongRestOpen.value = true;
  }

  /**
   * Применяет продолжительный отдых: восстанавливает хиты, ячейки, заряды и
   * кости хитов (половину по правилам или все — по выбору в модалке), затем
   * выполняет срабатывания «после отдыха» по ответам владельца.
   * @param options - параметры долгого отдыха из модалки и ответы владельца
   */
  function finishLongRest(options: LongRestOptions): void {
    // Лист перечитывается: пока владелец отвечал на вопросы, он мог измениться
    if (!localActor.value) {
      return;
    }

    handleActorUpdate(applyActorRest(localActor.value, 'long', options));

    toast.add({
      title: REST_LABELS.long,
      description: ACTOR_SHEET_LABELS.longRestDone,
      color: 'success',
    });

    // Часть черт («Мастер оружия», «Дар устойчивости к энергиям») позволяет
    // выбрать заново — предлагаем это сразу после отдыха, а не отдельной кнопкой:
    // иначе про пересмотр просто забывают
    if (collectRechoosableFeats(localActor.value).length > 0) {
      // Повод другой — окно спрашивает про пересмотр, а не про ступени списка
      featsAwaitingLeveledChoices.value = null;
      isFeatRechooseOpen.value = true;
    }
  }

  /**
   * Завершает продолжительный отдых: сперва владельца спрашивают о
   * срабатываниях «после отдыха» с ценой или согласием, затем идёт сам отдых.
   * @param options - параметры долгого отдыха из модалки
   */
  function handleLongRestApply(options: LongRestOptions): void {
    // В правку вошли при открытом окне отдыха — отдых её тоже ждёт
    if (refuseWhileSheetEditing(localActor.value?.id)) {
      return;
    }

    if (!localActor.value) {
      return;
    }

    void runRestWithTriggers(
      localActor.value,
      'long',
      options,
      (triggerOptions) => finishLongRest({ ...options, ...triggerOptions }),
    );
  }

  /**
   * Применяет короткий отдых: накладывает результат броска костей хитов
   * (лечение + потраченные кости) на восстановление коротких ресурсов, затем
   * выполняет срабатывания «после отдыха» по ответам владельца.
   * @param result - результат броска костей хитов из модалки
   * @param triggerOptions - ответы владельца и сбор сводки срабатываний
   */
  function finishShortRest(
    result: ShortRestHitDiceResult,
    triggerOptions: RestTriggerOptions,
  ): void {
    // Лист перечитывается: пока владелец отвечал на вопросы, он мог измениться
    if (!localActor.value) {
      return;
    }

    handleActorUpdate(
      applyShortRestWithHitDice(localActor.value, result, triggerOptions),
    );

    toast.add({
      title: REST_LABELS.short,
      description: ACTOR_SHEET_LABELS.shortRestDone,
      color: 'success',
    });
  }

  /**
   * Завершает короткий отдых: сперва владельца спрашивают о срабатываниях
   * «после отдыха» — по листу с уже потраченными костями хитов, — затем идёт
   * сам отдых.
   * @param result - результат броска костей хитов из модалки
   */
  function handleShortRestApply(result: ShortRestHitDiceResult): void {
    // В правку вошли при открытом окне отдыха — отдых её тоже ждёт
    if (refuseWhileSheetEditing(localActor.value?.id)) {
      return;
    }

    if (!localActor.value) {
      return;
    }

    void runRestWithTriggers(
      spendShortRestHitDice(localActor.value, result),
      'short',
      {},
      (triggerOptions) => finishShortRest(result, triggerOptions),
    );
  }

  function toggleEditMode() {
    if (!canEdit.value) {
      return;
    }

    if (!isEditMode.value) {
      if (localActor.value) {
        savedSnapshot.value = JSON.parse(JSON.stringify(localActor.value));
      }

      isEditMode.value = true;
    } else {
      if (isDirty.value) {
        handleSave();

        return;
      }

      isEditMode.value = false;
      savedSnapshot.value = null;

      // Правок нет — черновик догоняет мир: за время правки он мог измениться
      pullFromWorld();
    }
  }

  function openSettings() {
    const world = worldStore.getWorldById(props.worldId);

    let users: Array<{ id: string; username: string; role: string }> = [];

    if (props.users && props.users.length > 0) {
      users = props.users;
    } else if (world?.users) {
      users = world.users;
    }

    openModal('ActorSettingsModal', {
      actorId: props.actorId,
      actorData: localActor.value, // Передаем текущие данные
      onSave: (updates: Partial<DnDActor>) => {
        // Обновляем локальное состояние при сохранении в модалке
        if (localActor.value) {
          Object.assign(localActor.value, updates);
          isDirty.value = true;
        }
      },
      onDelete: () => {
        isOpen.value = false;
      },
      isAdmin: isAdmin.value,
      worldId: props.worldId,
      users,
      socket: props.socket,
      // Фолбэк на порт из мира: если опенер не передал worldPort,
      // файловый менеджер в настройках всё равно получит сервер мира
      worldPort: props.worldPort ?? world?.port,
      zIndex: (props.zIndex || 10000) + 10,
    });
  }

  function handleSave() {
    if (!localActor.value || isSaving.value || !canEdit.value) {
      return;
    }

    if (!localActor.value.name || localActor.value.name.trim() === '') {
      toast.add({
        title: ACTOR_SHEET_LABELS.validationErrorTitle,
        description: ACTOR_SHEET_LABELS.validationNameRequired,
        color: 'error',
      });

      return;
    }

    // Считаем ДО отправки: ветка создания ниже сама выставляет `isCreated`,
    // поэтому проверка после неё всегда давала «обновлён» — даже при первом
    // сохранении нового персонажа.
    const isCreating = !props.actorId && !isCreated.value;

    isSaving.value = true;

    try {
      requireSocket(props.socket);

      if (props.actorId) {
        const saved = resolveActorToSave(localActor.value);

        // Основа правки — снимок входа в режим: синхронизация с миром на время
        // правки стояла, и всё, чем черновик от него отличается, — правки листа
        saveDraft(props.socket, isEditMode.value ? savedSnapshot.value : null);
        localActor.value = saved;
      } else {
        const rawLocalActor = JSON.parse(JSON.stringify(localActor.value));

        const newActor: DnDActor = {
          ...rawLocalActor,
          id: rawLocalActor?.id || generateEntityId('actor'),
        };

        props.socket.emit('actor:created', newActor);
        emit('save', newActor);
        isCreated.value = true;
        // Сервер получил лист целиком — дальнейшие правки считаются от него
        rebaseDraft();

        if (props.modalId) {
          updateModalProps(props.modalId, { actorId: newActor.id });
        }
      }

      toast.add({
        title: ACTOR_SHEET_LABELS.savedTitle,
        description: isCreating
          ? ACTOR_SHEET_LABELS.savedCreated
          : ACTOR_SHEET_LABELS.savedUpdated,
        color: 'success',
      });

      isDirty.value = false;
      savedSnapshot.value = null;
      isEditMode.value = false;
    } catch (error) {
      console.error('Failed to save actor:', error);

      toast.add({
        title: ACTOR_SHEET_LABELS.saveErrorTitle,
        description:
          error instanceof Error
            ? error.message
            : ACTOR_SHEET_LABELS.saveErrorText,
        color: 'error',
      });
    } finally {
      isSaving.value = false;
    }
  }

  function handleCancel() {
    if (isDirty.value) {
      pendingAction.value = 'close';
      isConfirmOpen.value = true;

      return;
    }

    isDirty.value = false;
    savedSnapshot.value = null;
    isOpen.value = false;
  }

  const { receiveTransferredItem } = useItemTransfer();

  const {
    sheetModalRef,
    minimizedTitle,
    minimizeSheet,
    canPopOutSheet,
    isSheetPoppedOut,
    togglePopOutSheet,
  } = useSheetMinimize(
    () => localActor.value?.name,
    ACTOR_SHEET_LABELS.untitled,
  );

  /**
   * Закрытие, пришедшее ОТ окна, а не от крестика в шапке листа: кнопка закрытия
   * на шторке свёрнутого листа и Escape. Такое закрытие минует `handleCancel`, а
   * с ним и вопрос о несохранённых правках, — поэтому заворачиваем его туда же.
   *
   * Окно шлёт это событие только чтобы закрыться (`update:open` всегда `false`),
   * поэтому значение не проверяем. Выход из мира приходит сюда же, но лист он
   * снимает не событием, а вычисткой реестра окон — вопрос показать не успеет.
   */
  function handleModalClose(): void {
    handleCancel();
  }

  /**
   * Отмена в модалке подтверждения
   */
  function onConfirmCancel() {
    isConfirmOpen.value = false;
    pendingAction.value = null;
  }

  /**
   * Сохранить и выполнить отложенное действие
   */
  function onConfirmSave() {
    isConfirmOpen.value = false;
    pendingAction.value = null;
    handleSave();
    isOpen.value = false;
  }

  /**
   * Отменить изменения и выполнить отложенное действие
   */
  function onConfirmDiscard() {
    isConfirmOpen.value = false;
    pendingAction.value = null;

    if (savedSnapshot.value) {
      localActor.value = JSON.parse(JSON.stringify(savedSnapshot.value));
    }

    isDirty.value = false;
    isOpen.value = false;
  }

  /**
   * Заголовок модалки подтверждения замены вида/предыстории
   */
  const replaceConfirmTitle = computed(() => {
    return replaceConfirmTarget.value === 'species'
      ? ACTOR_SHEET_LABELS.replaceSpeciesTitle
      : ACTOR_SHEET_LABELS.replaceBackgroundTitle;
  });

  /**
   * Текст предупреждения о замене вида/предыстории
   */
  const replaceConfirmMessage = computed(() => {
    if (!localActor.value) {
      return '';
    }

    if (replaceConfirmTarget.value === 'species') {
      const currentSpeciesName =
        localActor.value.system.species?.speciesName ?? '';

      const newSpeciesName = droppedSpeciesDef.value?.name ?? '';

      return (
        `${ACTOR_SHEET_LABELS.replaceSpeciesPrefix}${currentSpeciesName}`
        + `${ACTOR_SHEET_LABELS.replaceSpeciesMiddle}${newSpeciesName}${
          ACTOR_SHEET_LABELS.replaceSpeciesSuffix
        }`
      );
    }

    if (replaceConfirmTarget.value === 'background') {
      const currentBackgroundName =
        localActor.value.system.background?.backgroundName ?? '';

      const newBackgroundName = droppedBackgroundDef.value?.name ?? '';

      return (
        `${ACTOR_SHEET_LABELS.replaceBackgroundPrefix}${currentBackgroundName}`
        + `${ACTOR_SHEET_LABELS.replaceBackgroundMiddle}${newBackgroundName}${
          ACTOR_SHEET_LABELS.replaceBackgroundSuffix
        }`
      );
    }

    return '';
  });

  /**
   * Подтверждение замены: открывает мастер настройки нового вида/предыстории
   */
  function onReplaceConfirm() {
    if (replaceConfirmTarget.value === 'species') {
      isSpeciesWizardOpen.value = true;
    } else if (replaceConfirmTarget.value === 'background') {
      isBackgroundWizardOpen.value = true;
    }

    isReplaceConfirmOpen.value = false;
    replaceConfirmTarget.value = null;
  }

  /**
   * Отмена замены вида/предыстории
   */
  function onReplaceCancel() {
    if (replaceConfirmTarget.value === 'species') {
      droppedSpeciesDef.value = null;
    } else if (replaceConfirmTarget.value === 'background') {
      droppedBackgroundDef.value = null;
    }

    isReplaceConfirmOpen.value = false;
    replaceConfirmTarget.value = null;
  }

  // --- Drag and Drop классов ---

  function isDroppedGameItem(value: unknown): value is DnDGameItem {
    return (
      isRecord(value)
      && typeof value.id === 'string'
      && typeof value.name === 'string'
      && typeof value.description === 'string'
      && typeof value.type === 'string'
    );
  }

  /** Гард перетаскиваемой черты (несёт featData/activeEffects). */
  function isAppliedFeatFeature(value: unknown): value is AppliedFeatFeature {
    return (
      isRecord(value)
      && typeof value.name === 'string'
      && typeof value.description === 'string'
      // Пак черты приезжает с перетаскиванием из компендиума: чужая строка
      // вместо него ушла бы на лист и сломала поиск выдаваемых записей
      && (value.packId === undefined || typeof value.packId === 'string')
    );
  }

  let dragLeaveTimeout: number | undefined;

  function handleDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types) {
      return;
    }

    const types = Array.from(event.dataTransfer.types);

    const isClass = types.includes(CLASS_DEFINITION_MIME);
    const isSpecies = types.includes(SPECIES_DEFINITION_MIME);
    const isBackground = types.includes(BACKGROUND_DEFINITION_MIME);
    const hasSpell = types.includes(SPELL_MIME);
    const isEquipment = types.includes(GAME_ITEM_MIME);
    const isFeature = types.includes(GAME_FEATURE_MIME);

    if (
      isClass
      || isSpecies
      || isBackground
      || hasSpell
      || isEquipment
      || isFeature
    ) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';

      if (hasSpell) {
        isSpellDragOver.value = true;
      }

      if (isEquipment) {
        isEquipmentDragOver.value = true;
      }

      if (isFeature) {
        isFeatureDragOver.value = true;
      }

      window.clearTimeout(dragLeaveTimeout);

      dragLeaveTimeout = window.setTimeout(() => {
        isSpellDragOver.value = false;
        isEquipmentDragOver.value = false;
        isFeatureDragOver.value = false;
      }, DRAG_OVER_RESET_DELAY_MS);
    }
  }

  function handleDragLeave() {
    isSpellDragOver.value = false;
    isEquipmentDragOver.value = false;
    isFeatureDragOver.value = false;
  }

  /**
   * Запускает мастер настройки класса. Общий вход для переноса из компендиума
   * и для выбора одного класса в окне компендиума.
   *
   * @param definition - определение класса
   */
  async function startClassSetup(
    definition: ClassDefinition,
    packId?: string,
  ): Promise<void> {
    droppedClassDef.value = null;
    droppedClassPackId.value = undefined;
    wizardQueue.value = []; // Очередь уровней тут ни при чём

    // Окно открываем сразу, со скелетоном: список классов мог ещё не догрузиться
    // (лист только открылся), а молчать в ответ на перенос нельзя
    isClassSetupLoading.value = true;
    isClassWizardOpen.value = true;

    await classCatalog.load();

    isClassSetupLoading.value = false;

    // Перенесли запись-подкласс: настройку ведёт мастер её родителя, а подкласс
    // игрок выбирает шагом мастера
    const targetKey = definition.parentClassKey ?? definition.key;

    // Берём запись из каталога, а не саму перенесённую: там подклассы,
    // заведённые отдельными записями, уже свёрнуты внутрь родителя, — иначе
    // мастер не предложил бы хоумбрю-подкласс к компендиумному классу. Из того
    // пака, что назвали: одноимённый класс в соседнем компендиуме — не та
    // запись, которую выбрал игрок
    // У записи-подкласса пак родителя записан в ней самой: перенесённая из мира
    // запись сама лежит в паке мира, а родитель — в компендиуме
    const target = classCatalog.resolveWithPack({
      key: targetKey,
      packId: definition.parentClassPackId ?? packId,
    });

    // Родителя нет среди записей (пак не подключён) — настройка не начинается:
    // у самого подкласса нет ни таблицы уровней, ни владений
    if (!target && definition.parentClassKey) {
      isClassWizardOpen.value = false;

      toast.add({
        title: CLASS_WIZARD_LABELS.subclassParentMissingTitle,
        description: CLASS_WIZARD_LABELS.subclassParentMissingText,
        color: 'warning',
      });

      return;
    }

    droppedClassDef.value = target?.entry ?? definition;
    droppedClassPackId.value = target?.packId ?? packId;
  }

  /**
   * Запускает мастеров для нескольких выбранных классов подряд — мультикласс за
   * один заход. Идёт через ту же очередь, что и повышение уровня: мастер
   * сбрасывает своё состояние только при повторном открытии, поэтому следующий
   * класс должен открываться ПОСЛЕ закрытия предыдущего (этим и занимается
   * `processNextWizardStep`, ожидая загрузку определений).
   *
   * @param picked - выбранные классы вместе с паками
   */
  function startClassesSetup(picked: PickedDefinition<ClassDefinition>[]) {
    const [first, ...rest] = picked;

    if (!first) {
      return;
    }

    if (rest.length === 0) {
      void startClassSetup(first.definition, first.packId);

      return;
    }

    wizardQueue.value = picked.map((entry) => ({
      classKey: entry.definition.key,
      packId: entry.packId,
      targetLevel: 1,
    }));

    void processNextWizardStep();
  }

  /**
   * Запускает настройку вида: у персонажа с видом сперва спрашиваем замену.
   *
   * Запись-подвид самостоятельным видом не применяется: вместо неё открывается
   * мастер её родителя с этим подвидом на шаге происхождения. Родителя нет
   * среди записей (пак не подключён) — настройка не начинается.
   *
   * Вид, у которого есть подвиды, по правилам сам не берут: сперва окно
   * спрашивает, какой подвид, и мастер открывается уже с ним. Подвиды берутся
   * из каталога по данным записей — свои виды мира спрашиваются так же.
   *
   * @param definition - определение вида
   * @param packId - пак, из которого запись взяли; пусто — не известен
   */
  function startSpeciesSetup(definition: SpeciesDefinition, packId?: string) {
    let target = definition;
    let subspeciesKey: string | null = null;

    // Пак запоминается вместе с записью: по нему мастер найдёт подвиды из того
    // же компендиума, а лист — таблицу вида при следующем открытии
    let targetPackId =
      speciesCatalog.resolveWithPack({ key: definition.key, packId })?.packId
      ?? packId;

    if (definition.parentKey) {
      const parent = speciesCatalog.resolveWithPack({
        key: definition.parentKey,
        packId: definition.parentPackId ?? packId,
      });

      if (!parent) {
        toast.add({
          title: SPECIES_WIZARD_LABELS.subspeciesParentMissingTitle,
          description: SPECIES_WIZARD_LABELS.subspeciesParentMissingText,
          color: 'warning',
        });

        return;
      }

      target = parent.entry;
      targetPackId = parent.packId;
      subspeciesKey = definition.key;
    }

    if (!subspeciesKey) {
      const options = speciesCatalog.subspeciesOf({
        key: target.key,
        packId: targetPackId,
      });

      if (options.length > 0) {
        pendingSubspeciesChoice.value = {
          species: target,
          packId: targetPackId,
          options,
        };

        return;
      }
    }

    proceedSpeciesSetup(target, targetPackId, subspeciesKey);
  }

  /**
   * Подвид выбран в окне «какой подвид» — настройка вида идёт дальше с ним.
   *
   * @param subspecies - выбранный подвид
   */
  function handleSubspeciesChoice(subspecies: SpeciesDefinition) {
    const pending = pendingSubspeciesChoice.value;

    pendingSubspeciesChoice.value = null;

    if (pending) {
      proceedSpeciesSetup(pending.species, pending.packId, subspecies.key);
    }
  }

  /**
   * Игрок выбрал компендиум в окне «откуда взять».
   *
   * @param values - выбранное: один id компендиума
   */
  function handlePackChoiceApply(values: string[]) {
    answerPackChoice(values[0] ?? null);
  }

  /**
   * Окно «откуда взять» закрыли без выбора — запись не выдаётся.
   *
   * @param isOpen - новое состояние окна
   */
  function handlePackChoiceOpen(isOpen: boolean) {
    if (!isOpen) {
      answerPackChoice(null);
    }
  }

  /**
   * Окно «какой подвид» закрыли без выбора — вид на лист не ставится.
   *
   * @param isOpen - новое состояние окна
   */
  function handleSubspeciesChoiceOpen(isOpen: boolean) {
    if (!isOpen) {
      pendingSubspeciesChoice.value = null;
    }
  }

  /**
   * Открывает мастер вида (или сперва вопрос о замене прежнего вида).
   *
   * @param target - вид, который ставится на лист
   * @param targetPackId - пак вида
   * @param subspeciesKey - подвид, выбранный до мастера; `null` — не выбран
   */
  function proceedSpeciesSetup(
    target: SpeciesDefinition,
    targetPackId: string | undefined,
    subspeciesKey: string | null,
  ) {
    droppedSpeciesDef.value = target;
    droppedSpeciesPackId.value = targetPackId;
    droppedSubspeciesKey.value = subspeciesKey;

    if (localActor.value?.system.species) {
      replaceConfirmTarget.value = 'species';
      isReplaceConfirmOpen.value = true;
    } else {
      isSpeciesWizardOpen.value = true;
    }
  }

  /**
   * Запускает настройку предыстории: у персонажа с предысторией сперва
   * спрашиваем замену.
   *
   * @param definition - определение предыстории
   * @param packId - пак, из которого запись взяли; пусто — не известен
   */
  function startBackgroundSetup(
    definition: BackgroundDefinition,
    packId?: string,
  ) {
    droppedBackgroundDef.value = definition;
    droppedBackgroundPackId.value = packId;

    if (localActor.value?.system.background) {
      replaceConfirmTarget.value = 'background';
      isReplaceConfirmOpen.value = true;
    } else {
      isBackgroundWizardOpen.value = true;
    }
  }

  /**
   * Принимает предмет, переданный с другого листа: предмет уходит из инвентаря
   * отправителя и появляется здесь.
   *
   * Обе стороны пишет сервер одним действием; лист узнаёт о новом предмете из
   * обычной рассылки, а здесь только сообщает игроку итог.
   *
   * @param event - событие drop
   * @returns `true`, если нагрузка была передачей предмета
   */
  function handleItemTransferDrop(event: DragEvent): boolean {
    // В режиме правки жест не принимается: здесь открыт черновик, и его
    // «Сохранить» положило бы поверх пришедшего предмета прежний инвентарь.
    // Причину говорим: молчаливый отказ выглядел поломкой жеста
    if (isEditMode.value) {
      return (
        isItemTransferDrop(event)
        && refuseWhileSheetEditing(localActor.value?.id)
      );
    }

    if (!localActor.value) {
      return false;
    }

    const transfer = receiveTransferredItem(
      event,
      localActor.value,
      props.socket,
    );

    if (!transfer) {
      return false;
    }

    void reportItemTransfer(transfer);

    return true;
  }

  /**
   * Дожидается ответа сервера на передачу и говорит игроку итог.
   *
   * @param transfer - обещание итога передачи
   */
  async function reportItemTransfer(
    transfer: Promise<ItemTransferResult>,
  ): Promise<void> {
    const result = await transfer;

    if (result.outcome.ok) {
      activeTab.value = 'equipment';
    }

    toast.add(describeItemTransfer(result, ACTOR_SHEET_LABELS.itemReceived));
  }

  function handleDrop(event: DragEvent) {
    isSpellDragOver.value = false;
    isEquipmentDragOver.value = false;
    isFeatureDragOver.value = false;

    if (!canEdit.value || !event.dataTransfer) {
      return;
    }

    // Передача с другого листа идёт первой: у неё свой MIME, и по нему предмет
    // ПЕРЕЕЗЖАЕТ, а не копируется, как запись компендиума ниже
    if (handleItemTransferDrop(event)) {
      return;
    }

    const classDataStr = event.dataTransfer.getData(CLASS_DEFINITION_MIME);
    const speciesDataStr = event.dataTransfer.getData(SPECIES_DEFINITION_MIME);

    const backgroundDataStr = event.dataTransfer.getData(
      BACKGROUND_DEFINITION_MIME,
    );

    const spellData = event.dataTransfer.getData(SPELL_MIME);
    const equipData = event.dataTransfer.getData(GAME_ITEM_MIME);
    const featureData = event.dataTransfer.getData(GAME_FEATURE_MIME);

    if (classDataStr) {
      try {
        const dropped = unwrapDroppedDefinition(JSON.parse(classDataStr));

        if (!isClassDefinition(dropped.definition)) {
          throw new Error('Dropped class definition has invalid shape');
        }

        void startClassSetup(dropped.definition, dropped.packId);
        event.preventDefault();
        event.stopPropagation();
      } catch (error) {
        console.error('Failed to parse dropped class definition', error);
      }
    } else if (speciesDataStr) {
      try {
        const dropped = unwrapDroppedDefinition(JSON.parse(speciesDataStr));

        if (!isSpeciesDefinitionEntry(dropped.definition)) {
          throw new Error('Dropped species definition has invalid shape');
        }

        startSpeciesSetup(dropped.definition, dropped.packId);
        event.preventDefault();
        event.stopPropagation();
      } catch (error) {
        console.error('Failed to parse dropped species definition', error);
      }
    } else if (backgroundDataStr) {
      try {
        const dropped = unwrapDroppedDefinition(JSON.parse(backgroundDataStr));

        if (!isBackgroundDefinition(dropped.definition)) {
          throw new Error('Dropped background definition has invalid shape');
        }

        startBackgroundSetup(dropped.definition, dropped.packId);
        event.preventDefault();
        event.stopPropagation();
      } catch (error) {
        console.error('Failed to parse dropped background definition', error);
      }
    } else if (spellData) {
      try {
        const droppedSpell: unknown = JSON.parse(spellData);

        if (isSpell(droppedSpell) && localActor.value) {
          const alreadyExists = (localActor.value.spells ?? []).some(
            (spell) => spell.name === droppedSpell.name,
          );

          if (!alreadyExists) {
            const newSpell: Spell = {
              ...droppedSpell,
              id: generateId('spell'),
              prepared: false,
            };

            localActor.value.spells = [
              ...(localActor.value.spells ?? []),
              newSpell,
            ];

            isDirty.value = true;

            if (!isEditMode.value) {
              handleImmediateSave();
            }

            activeTab.value = 'spells';
          }
        }

        event.preventDefault();
        event.stopPropagation();
      } catch {}
    } else if (equipData) {
      try {
        const parsedItem: unknown = JSON.parse(equipData);

        if (!isDroppedGameItem(parsedItem)) {
          return;
        }

        if (localActor.value) {
          const alreadyExists = localActor.value.equipment.some(
            (item) => item.id === parsedItem.id,
          );

          if (!alreadyExists) {
            const newItem = createInventoryItem(parsedItem);

            localActor.value.equipment = [
              ...localActor.value.equipment,
              newItem,
            ];

            isDirty.value = true;

            if (!isEditMode.value) {
              handleImmediateSave();
            }

            activeTab.value = 'equipment';
          }
        }

        event.preventDefault();
        event.stopPropagation();
      } catch {}
    } else if (featureData) {
      try {
        const parsedFeat: unknown = JSON.parse(featureData);

        if (!isAppliedFeatFeature(parsedFeat)) {
          return;
        }

        const droppedFeat = parsedFeat;

        if (localActor.value) {
          const alreadyExists =
            !droppedFeat.repeatable
            && localActor.value.features.some(
              (feature) =>
                feature.featureType === 'feat'
                && feature.name === droppedFeat.name,
            );

          if (!alreadyExists) {
            void applyDroppedFeat(droppedFeat);
          }
        }

        event.preventDefault();
        event.stopPropagation();
      } catch {}
    }
  }

  /** Черта, ждущая выбора игрока: применяется после закрытия окна выбора */
  const pendingChoiceFeat = ref<AppliedFeatFeature | null>(null);
  const isFeatChoicesOpen = ref(false);

  /**
   * Записывает пересмотренный на отдыхе выбор: снимает старый и применяет новый
   * через ту же машинерию, что и правка черты, — иначе владения от прежнего
   * выбора остались бы на листе.
   *
   * @param selections - id особенности → (ключ выбора → значения)
   */
  async function handleFeatRechooseApply(
    selections: Record<string, Record<string, string[]>>,
  ): Promise<void> {
    if (!localActor.value) {
      return;
    }

    featsAwaitingLeveledChoices.value = null;

    for (const [featureId, choices] of Object.entries(selections)) {
      // Массив объявлен типом черты: базовый `Feature` о `featData` не знает, и
      // без объявления пришлось бы приводить тип у каждой найденной особенности
      const features: AppliedFeatFeature[] = localActor.value.features ?? [];

      const feature = features.find((entry) => entry.id === featureId);

      if (!feature) {
        continue;
      }

      const updated: AppliedFeatFeature = { ...feature, choices };

      // Пере-применение снимает заклинания черты и выдаёт их заново, поэтому их
      // обязательно нужно разрешить: с пустым списком новый выбор стоил бы
      // персонажу всех заклинаний этой черты
      const resolved = await resolveFeatGrantedSpells(
        props.socket,
        updated,
        localActor.value,
      );

      if (!localActor.value) {
        return;
      }

      const result = reapplyFeatToActor(
        localActor.value,
        feature,
        updated,
        resolved,
      );

      localActor.value.features = result.features;
      localActor.value.spells = result.spells;
      localActor.value.activeEffects = result.activeEffects;
      localActor.value.system.proficiencies = result.proficiencies;
      localActor.value.system.classCounters = result.classCounters;
    }

    isDirty.value = true;

    if (!isEditMode.value) {
      handleImmediateSave();
    }
  }

  /**
   * Выборы черты, ждущей ответа игрока: заданные автором плюс заведённые листом
   * под открытые ступени расширенного списка заклинаний («возьмите два из
   * пяти»). Что открыто — решает уровень персонажа, поэтому спрашиваем от листа.
   */
  const pendingFeatChoices = computed(() =>
    localActor.value
      ? resolveFeatChoicesToAsk(
          pendingChoiceFeat.value?.featData,
          localActor.value,
        )
      : (pendingChoiceFeat.value?.featData?.choices ?? []),
  );

  /**
   * Принимает сделанный выбор и доводит выдачу черты до конца.
   *
   * @param selections - ключ выбора → выбранные значения
   */
  function handleFeatChoicesApply(selections: Record<string, string[]>): void {
    const feat = pendingChoiceFeat.value;

    pendingChoiceFeat.value = null;

    if (feat) {
      void applyDroppedFeat({ ...feat, choices: selections });
    }
  }

  /**
   * Применяет перетащенную черту к актору: резолвит выдаваемые заклинания через
   * компендиум, затем добавляет особенность-черту, выдаёт заклинания, переносит
   * активные эффекты и владения. Резолв асинхронный — особенность появляется
   * после загрузки компендиума (обычно из кеша, мгновенно).
   *
   * @param droppedFeat - перетащенная черта (с featData/activeEffects)
   */
  async function applyDroppedFeat(
    droppedFeat: AppliedFeatFeature,
  ): Promise<void> {
    if (!localActor.value) {
      return;
    }

    // Черта с выборами сперва спрашивает игрока: применить её до ответа значит
    // выдать половину даров и потом дописывать вторую половину
    if (
      resolveFeatChoicesToAsk(droppedFeat.featData, localActor.value).length > 0
      && droppedFeat.choices === undefined
    ) {
      pendingChoiceFeat.value = droppedFeat;
      isFeatChoicesOpen.value = true;

      return;
    }

    const resolved = await resolveFeatGrantedSpells(
      props.socket,
      droppedFeat,
      localActor.value,
    );

    if (!localActor.value) {
      return;
    }

    // Требования проверяем, но не запрещаем: за столом мастер разрешает
    // исключения, а у уже собранных персонажей черта могла быть взята раньше
    const prerequisites = checkFeatPrerequisites(
      droppedFeat.featData,
      localActor.value,
      {
        armorCategoryOf: (armorKey) =>
          systemDataStore.armorBaseTypes.find(
            (baseType) => baseType.key === armorKey,
          )?.category,
      },
    );

    if (!prerequisites.met) {
      toast.add({
        title: FEAT_PREREQUISITE_LABELS.unmetTitle,
        description:
          FEAT_PREREQUISITE_LABELS.unmetPrefix
          + prerequisites.unmet.join(FEAT_PREREQUISITE_LABELS.unmetSeparator),
        color: 'warning',
      });
    }

    const result = applyFeatToActor(localActor.value, droppedFeat, resolved);

    localActor.value.features = result.features;
    localActor.value.spells = result.spells;
    localActor.value.activeEffects = result.activeEffects;
    localActor.value.system.proficiencies = result.proficiencies;
    localActor.value.system.classCounters = result.classCounters;

    if (result.token) {
      localActor.value.token = result.token;
    }

    isDirty.value = true;

    if (!isEditMode.value) {
      handleImmediateSave();
    }

    activeTab.value = 'features';
  }

  // --- Последовательное повышение уровня (Wizard) ---

  async function processNextWizardStep(): Promise<void> {
    if (wizardQueue.value.length === 0) {
      isClassWizardOpen.value = false;

      return;
    }

    const nextStep = wizardQueue.value[0];

    // Каталог кеширует ответ хоста — повторные шаги мастера сети не трогают
    await classCatalog.load();

    const target = classCatalog.resolveWithPack({
      key: nextStep.classKey,
      packId: nextStep.packId,
    });

    if (target) {
      droppedClassDef.value = target.entry;
      droppedClassPackId.value = target.packId;
      isClassSetupLoading.value = false;
      isClassWizardOpen.value = true;

      return;
    }

    toast.add({
      title: TOAST_TITLES.error,
      description: ACTOR_SHEET_LABELS.classNotFound,
      color: 'error',
    });

    wizardQueue.value.shift();
    void processNextWizardStep();
  }

  function handleStartWizardSequence(data: {
    queue: WizardQueueStep[];
    experience: number;
    forceApplies: import('@vtt/shared/system/dnd.js').ActorClassEntry[];
  }) {
    if (!localActor.value) {
      return;
    }

    // Сначала применяем опыт, чтобы он сохранился даже если мастер отменят
    localActor.value.system.experience = data.experience;

    wizardQueue.value = data.queue;

    // Запускаем первый шаг
    void processNextWizardStep();
  }

  function handleClassSetupApply(
    systemUpdates: Partial<DnDActor['system']>,
    rootUpdates: Partial<DnDActor>,
  ) {
    if (!localActor.value) {
      return;
    }

    // Потолок с эффектами ДО повышения: прибавка текущих хитов считается по
    // нему, а не по записи листа — Телосложение от предыстории и повышения
    // характеристик лежит эффектами, и его доля за новый уровень в запись не
    // попадает
    const previousMax = resolveEntityMaxHp(localActor.value);

    // Обновляем class/system data
    Object.assign(localActor.value.system, systemUpdates);

    // Обновляем корень актора (напр. features)
    if (Object.keys(rootUpdates).length > 0) {
      Object.assign(localActor.value, rootUpdates);
    }

    // Пересчитываем макс. ХП из истории бросков
    if (systemUpdates.classes) {
      const constitutionMod = calculateAbilityModifier(
        localActor.value.system.abilities?.constitution ?? 10,
      );

      localActor.value.system.hitPoints = {
        ...localActor.value.system.hitPoints,
        max: calculateMaxHP(systemUpdates.classes, constitutionMod),
      };

      const hpGain = resolveEntityMaxHp(localActor.value) - previousMax;

      localActor.value.system.hitPoints = {
        ...localActor.value.system.hitPoints,
        current: Math.max(
          1,
          (localActor.value.system.hitPoints?.current ?? 0) + hpGain,
        ),
      };
    }

    isDirty.value = true;
    handleImmediateSave();

    void unlockFeatSpellsForLevel();

    // Если мы повышаем уровень по очереди — переходим к следующему
    if (wizardQueue.value.length > 0) {
      wizardQueue.value.shift(); // удаляем выполненный шаг
      void processNextWizardStep();
    }
  }

  /**
   * Заклинания вида листа, открытые на его текущем уровне.
   *
   * @param actorData - лист персонажа с уже обновлённым уровнем
   * @returns заклинания вида; вида нет или он не найден в компендиуме — пусто
   */
  async function resolveCurrentSpeciesSpells(
    actorData: DnDActor,
  ): Promise<ResolvedGrantedSpell[]> {
    if (!actorData.system.species?.speciesKey) {
      return [];
    }

    await loadCurrentSpeciesDefinition(actorData);

    if (!appliedSpeciesDef.value) {
      return [];
    }

    return resolveActorSpeciesSpells(
      props.socket,
      actorData,
      appliedSpeciesDef.value,
      appliedSubspeciesDef.value,
    );
  }

  /**
   * Открывает на новом уровне то, что черты и вид выдают ступенями: заклинание с
   * уровнем доступа («Малое восстановление» метки исцеления приходит на третьем,
   * «Псевдожизнь» чтонического тифлинга — тоже) и выбор черты с уровнем открытия.
   *
   * Без этого прохода такие заклинания не появились бы никогда: черту и вид
   * применяют один раз, и повторно их дары никто не пересчитывает. Уже выданное
   * не задваивается — совпадения отсеиваются по названию. Расширение списка
   * заклинаний ничего не выдаёт — его показывает окно выбора заклинаний.
   */
  async function unlockFeatSpellsForLevel(): Promise<void> {
    if (!localActor.value) {
      return;
    }

    const [featSpells, speciesSpells] = await Promise.all([
      resolveActorFeatSpells(props.socket, localActor.value),
      resolveCurrentSpeciesSpells(localActor.value),
    ]);

    if (!localActor.value) {
      return;
    }

    const before = localActor.value.spells ?? [];

    const spells = appendGrantedSpells(
      appendGrantedSpells(before, featSpells, 'feat'),
      speciesSpells,
      'species',
    );

    // Не только новые записи: выдача без подготовки отдаёт отметку уже лежащей
    // записи, и число заклинаний при этом не меняется
    if (spells.some((spell, index) => spell !== before[index])) {
      localActor.value.spells = spells;
      isDirty.value = true;
      handleImmediateSave();
    }

    // Выбор с уровнем открытия сам не ответится: сперва игрок выбирает. Посреди
    // очереди повышений не спрашиваем — окно встало бы поверх мастера класса;
    // последний шаг очереди спросит про всё разом
    if (wizardQueue.value.length > 0) {
      return;
    }

    const awaiting = collectFeatsAwaitingLeveledChoices(localActor.value);

    if (awaiting.length > 0) {
      featsAwaitingLeveledChoices.value = awaiting;
      isFeatRechooseOpen.value = true;
    }
  }

  /**
   * Владения, которые класс держит на листе: стартовый набор у основного класса
   * и сокращённый (PHB 2024) у взятого мультиклассом.
   *
   * Без определения класса (пак компендиума мог исчезнуть) известны только
   * записанные на лист навыки и инструменты — доспехи, оружие и спасброски
   * такого класса при его удалении остаются на листе.
   *
   * @param classEntry - запись класса на листе
   * @param isPrimary - основной ли это класс (первый в списке)
   * @returns владения класса
   */
  function collectClassHoldings(
    classEntry: DnDActor['system']['classes'][number],
    isPrimary: boolean,
  ): ProficiencyHoldings {
    const holdings: ProficiencyHoldings = {
      armor: [],
      weapons: [],
      tools: [...(classEntry.grantedTools ?? [])],
      savingThrows: [],
      skills: [...classEntry.chosenSkills],
    };

    const classDef = classCatalog.resolve({
      key: classEntry.classKey,
      packId: classEntry.packId,
    });

    if (!classDef) {
      return holdings;
    }

    // Через хелпер, а не индексацией таблицы: у хоумбрю-класса ключ вне
    // `ClassKey`, и владения мультикласса лежат в его собственном поле
    // `multiclassProficiencies` — прямая индексация их теряла
    const multiclass = getMulticlassProficiencies(classDef);

    const armorKeys = isPrimary
      ? classDef.armorProficiencies
      : (multiclass?.armor ?? []);

    const weaponKeys = isPrimary
      ? classDef.weaponProficiencies
      : (multiclass?.weapons ?? []);

    return {
      ...holdings,
      armor: unpackProficiencyKeys(armorKeys, systemDataStore.armorBaseTypes),
      weapons: unpackProficiencyKeys(
        weaponKeys,
        systemDataStore.weaponBaseTypes,
      ),
      savingThrows: isPrimary ? [...classDef.savingThrowProficiencies] : [],
    };
  }

  /**
   * Владения, которые держат вид, предыстория и черты персонажа. Каждый
   * источник узнаётся своим же откатом: что ушло бы с ним, тем он и владеет.
   *
   * @param actor - актёр, с которого снимается класс
   * @returns владения по источникам
   */
  function collectNonClassHoldings(actor: DnDActor): ProficiencyHoldings[] {
    const proficiencies = actor.system.proficiencies;

    // Массив объявлен типом черты: базовый `Feature` о `featData` не знает
    const features: AppliedFeatFeature[] = actor.features;

    const featHoldings = features
      .filter((feature) => feature.featData)
      .map((feature) => {
        const rolledBack = cloneActorProficiencies(proficiencies);

        removeFeatDataProficiencies(rolledBack, feature.featData);

        removeFeatChoiceSelections(
          rolledBack,
          feature.featData,
          feature.choices,
        );

        return diffProficiencyHoldings(proficiencies, rolledBack);
      });

    return [
      diffProficiencyHoldings(
        proficiencies,
        rollbackBackgroundProficiencies(proficiencies, actor.system.background),
      ),
      diffProficiencyHoldings(
        proficiencies,
        rollbackSpeciesProficiencies(
          proficiencies,
          actor.system.species,
          appliedSpeciesDef.value,
          appliedSubspeciesDef.value,
          getTotalLevel(actor.system.classes),
        ),
      ),
      ...featHoldings,
    ];
  }

  /**
   * Имена источников, которыми помечены заклинания снимаемого класса.
   *
   * Одним именем не обойтись: заклинание, выданное блоком даров класса, помечено
   * названием класса, выданное вариантом умения — названием САМОГО варианта, а
   * запись варианта на листе названа «умение: вариант». Дары подкласса помечены
   * его названием, а оно живёт в происхождении записи («Колдун — Покровитель»).
   * Поэтому имя каждой снимаемой записи разбирается на составляющие.
   *
   * @param className - название снимаемого класса
   * @param features - записи листа, которые уходят вместе с классом
   * @returns имена источников для отката выданных заклинаний
   */
  function collectGrantedSpellSourceNames(
    className: string,
    features: ReadonlyArray<Feature>,
  ): string[] {
    const names = new Set<string>([className]);

    /**
     * Добавляет хвост строки после последнего разделителя.
     *
     * @param value - строка с разделителем
     * @param separator - разделитель
     */
    const addTail = (value: string, separator: string): void => {
      const index = value.lastIndexOf(separator);

      if (index !== -1) {
        names.add(value.slice(index + separator.length));
      }
    };

    for (const feature of features) {
      names.add(feature.name);
      addTail(feature.name, FEATURE_OPTION_SEPARATOR);
      addTail(feature.grantedBy ?? '', FEATURE_SOURCE_SEPARATOR);
    }

    return [...names];
  }

  /**
   * Принадлежит ли особенность классу: умение класса или его подкласса.
   *
   * Происхождение записи содержит название класса («Волшебник» или
   * «Волшебник — Школа воплощения»).
   *
   * @param feature - особенность листа
   * @param className - название класса
   */
  function isOwnClassFeature(feature: Feature, className: string): boolean {
    const isClassFeature =
      feature.featureType === 'class' || feature.featureType === 'subclass';

    return isClassFeature && Boolean(feature.grantedBy?.includes(className));
  }

  /**
   * Заклинания листа, какими они станут после отката записи. Считается тем же
   * кодом, что и сам откат, но лист не трогает: по разнице окно удаления
   * узнаёт выданные заклинания.
   *
   * @param actor - актёр до удаления
   * @param subject - что снимается
   * @returns заклинания без выданных снимаемой записью
   */
  function previewSpellsAfterRemoval(
    actor: DnDActor,
    subject: GrantRemovalSubject,
  ): Spell[] {
    if (subject.kind === 'species') {
      return (
        buildSpeciesRemovalUpdates(
          actor,
          appliedSpeciesDef.value,
          appliedSubspeciesDef.value,
        ).rootUpdates.spells ?? actor.spells
      );
    }

    if (subject.kind === 'background') {
      return (
        buildBackgroundRemovalUpdates(actor).rootUpdates.spells ?? actor.spells
      );
    }

    const className = actor.system.classes.find(
      (entry) => entry.classKey === subject.key,
    )?.className;

    if (!className) {
      return actor.spells;
    }

    return removeGrantedSpellsByFeatureNames(
      actor.spells,
      collectGrantedSpellSourceNames(
        className,
        actor.features.filter((feature) =>
          isOwnClassFeature(feature, className),
        ),
      ),
    );
  }

  /**
   * Применяет к листу выбор из окна удаления: возвращает оставленные выданные
   * заклинания и снимает отмеченные заклинания класса и предметы.
   *
   * @param choice - выбор игрока; пусто — окно не открывалось
   */
  function applyGrantRemovalChoice(choice?: GrantRemovalChoice): void {
    if (!localActor.value || !choice) {
      return;
    }

    const { spells, equipment } = applyGrantRemovalSelection(
      choice.spellsBefore,
      {
        spells: localActor.value.spells,
        equipment: localActor.value.equipment,
      },
      choice.options,
      choice.selectedIds,
    );

    localActor.value.spells = spells;
    localActor.value.equipment = equipment;
  }

  /**
   * Снимает запись с листа — каждую своим обработчиком.
   *
   * @param subject - что снимается
   * @param choice - выбор игрока из окна удаления; пусто — окно не открывалось
   */
  function removeGrant(
    subject: GrantRemovalSubject,
    choice?: GrantRemovalChoice,
  ): void {
    if (subject.kind === 'class') {
      handleRemoveClass(subject.key, choice);
    } else if (subject.kind === 'species') {
      handleRemoveSpecies(choice);
    } else {
      handleRemoveBackground(choice);
    }
  }

  /**
   * Начинает удаление записи. Если вместе с ней можно убрать заклинания или
   * стартовые предметы — сперва спрашивает, что именно; иначе снимает сразу:
   * удаление уже подтверждено в окне, из которого пришло.
   *
   * @param subject - что снимается
   */
  function requestGrantRemoval(subject: GrantRemovalSubject): void {
    const actor = localActor.value;

    if (!actor) {
      return;
    }

    const options = collectGrantRemovalOptions(
      actor,
      subject,
      previewSpellsAfterRemoval(actor, subject),
      actor.system.classes
        .map((entry) => entry.classKey)
        .filter((classKey) => classKey !== subject.key),
    );

    if (options.length === 0) {
      removeGrant(subject);

      return;
    }

    pendingGrantRemoval.value = { subject, options };
    isGrantRemovalOpen.value = true;
  }

  /**
   * Начинает удаление класса.
   *
   * @param classKey - ключ снимаемого класса
   */
  function requestClassRemoval(classKey: string): void {
    requestGrantRemoval({ kind: 'class', key: classKey });
  }

  /**
   * Доводит удаление до конца с выбором игрока.
   *
   * @param selectedIds - ключи строк, отмеченных в окне к удалению
   */
  function handleGrantRemovalConfirm(selectedIds: string[]): void {
    const pending = pendingGrantRemoval.value;

    if (!pending || !localActor.value) {
      return;
    }

    pendingGrantRemoval.value = null;

    removeGrant(pending.subject, {
      options: pending.options,
      selectedIds: new Set(selectedIds),
      spellsBefore: localActor.value.spells,
    });
  }

  /**
   * Удаляет класс у актёра и все связанные с ним данные:
   * - Запись из system.classes
   * - Особенности (features) с featureType 'class' или 'subclass', привязанные к этому классу
   * - Пересчёт HP
   *
   * @param classKey - ключ снимаемого класса
   * @param choice - выбор игрока из окна удаления; пусто — окно не открывалось
   */
  function handleRemoveClass(classKey: string, choice?: GrantRemovalChoice) {
    if (!localActor.value) {
      return;
    }

    const classes = localActor.value.system.classes || [];

    const removedEntry = classes.find((entry) => entry.classKey === classKey);

    if (!removedEntry) {
      return;
    }

    const removedClassName = removedEntry.className;

    // Удаляем запись класса
    const remainingClasses = classes.filter(
      (entry) => entry.classKey !== classKey,
    );

    localActor.value.system.classes = remainingClasses;

    // Удаляем все features, связанные с этим классом
    const removedFeatures = localActor.value.features.filter((feature) =>
      isOwnClassFeature(feature, removedClassName),
    );

    localActor.value.features = localActor.value.features.filter(
      (feature) => !isOwnClassFeature(feature, removedClassName),
    );

    // Заклинания, выданные снятыми умениями и их вариантами: воззвание колдуна
    // положило своё заклинание в книгу, и без класса ему там делать нечего
    if (localActor.value.spells) {
      localActor.value.spells = removeGrantedSpellsByFeatureNames(
        localActor.value.spells,
        collectGrantedSpellSourceNames(removedClassName, removedFeatures),
      );
    }

    // Удаляем activeEffects, связанные с этим классом. Эффекты, заявленные
    // записью класса, узнаются по провенансу в id; эффекты повышения
    // характеристик его не имеют — они собираются мастером на месте и несут
    // название класса в подписи
    if (localActor.value.activeEffects) {
      localActor.value.activeEffects = localActor.value.activeEffects.filter(
        (effect) =>
          !isClassEffect(effect, classKey)
          && !effect.name.includes(removedClassName),
      );
    }

    // Счётчики удалённого класса и ресурсы его умений. Классовые отбираются по
    // ключу класса, а ресурс выбранного варианта умения живёт на записи самого
    // варианта — вместе с ней он и уходит: пересборка от оставшихся
    // особенностей забирает всё, чему больше нечем владеть
    localActor.value.system.classCounters = refreshFeatCounters(
      localActor.value,
      (localActor.value.system.classCounters ?? []).filter(
        (counter) => counter.classKey !== classKey,
      ),
    );

    // Владения: уходит только то, что держал сам класс и не держит никто
    // другой — навыки и инструменты вида, предыстории и черт остаются. Черты
    // считаются уже без снятых с классом записей
    localActor.value.system.proficiencies = rollbackClassProficiencies(
      localActor.value.system.proficiencies,
      collectClassHoldings(removedEntry, classes[0] === removedEntry),
      remainingClasses.map((classEntry, classIndex) =>
        collectClassHoldings(classEntry, classIndex === 0),
      ),
      collectNonClassHoldings(localActor.value),
    );

    // Пересчитываем HP
    const constitutionMod = calculateAbilityModifier(
      localActor.value.system.abilities?.constitution ?? 10,
    );

    const newMax = calculateMaxHP(remainingClasses, constitutionMod);

    localActor.value.system.hitPoints = {
      ...localActor.value.system.hitPoints,
      max: newMax,
      current: Math.min(
        localActor.value.system.hitPoints?.current ?? newMax,
        newMax,
      ),
    };

    applyGrantRemovalChoice(choice);

    isDirty.value = true;
    handleImmediateSave();

    toast.add({
      title: ACTOR_SHEET_LABELS.classRemovedTitle,
      description: `${removedClassName}${ACTOR_SHEET_LABELS.classRemovedSuffix}`,
      color: 'success',
    });
  }

  /**
   * Открывает окно выбора записи компендиума для раздела шапки листа.
   *
   * @param kind - вид, класс или предыстория
   */
  function openCompendiumPicker(kind: MissingSheetSectionKey) {
    compendiumPickerKind.value = kind;
    isCompendiumPickerOpen.value = true;
  }

  /**
   * Запускает мастера настройки для записей, отмеченных в окне компендиума.
   * Ветки те же, что при переносе записи на лист; у классов их может быть
   * несколько — мастера открываются по очереди.
   *
   * @param picked - выбранные записи вместе с паками
   */
  function handleCompendiumPickerSelect(picked: PickedDefinition[]) {
    const classes: PickedDefinition<ClassDefinition>[] = [];

    for (const { definition, packId } of picked) {
      if (definition.type === 'species') {
        startSpeciesSetup(definition, packId);
      } else if (definition.type === 'background') {
        startBackgroundSetup(definition, packId);
      } else {
        classes.push({ definition, packId });
      }
    }

    if (classes.length > 0) {
      startClassesSetup(classes);
    }
  }

  /**
   * Снимает с персонажа вид: владения, особенности, тёмное зрение, размер и
   * скорость возвращаются к состоянию «вид не выбран».
   *
   * Без определения снимаемого вида (пак компендиума мог исчезнуть) владения
   * откатить нечем — снимаем всё остальное и предупреждаем об этом.
   *
   * @param choice - выбор игрока из окна удаления; пусто — окно не открывалось
   */
  function handleRemoveSpecies(choice?: GrantRemovalChoice) {
    if (!localActor.value?.system.species) {
      return;
    }

    const hasDefinition = Boolean(appliedSpeciesDef.value);

    const { systemUpdates, rootUpdates } = buildSpeciesRemovalUpdates(
      localActor.value,
      appliedSpeciesDef.value,
      appliedSubspeciesDef.value,
    );

    Object.assign(localActor.value.system, systemUpdates);
    Object.assign(localActor.value, rootUpdates);

    appliedSpeciesDef.value = null;
    appliedSubspeciesDef.value = null;
    droppedSpeciesDef.value = null;

    applyGrantRemovalChoice(choice);

    isDirty.value = true;
    handleImmediateSave();

    toast.add({
      title: COMPENDIUM_PICKER_LABELS.speciesRemovedTitle,
      description: hasDefinition
        ? COMPENDIUM_PICKER_LABELS.speciesRemovedText
        : COMPENDIUM_PICKER_LABELS.speciesRemovedWithoutDefinition,
      color: hasDefinition ? 'success' : 'warning',
    });
  }

  /**
   * Снимает с персонажа предысторию: бонусы характеристик, владения и
   * черта-происхождение уходят вместе с ней.
   *
   * @param choice - выбор игрока из окна удаления; пусто — окно не открывалось
   */
  function handleRemoveBackground(choice?: GrantRemovalChoice) {
    if (!localActor.value?.system.background) {
      return;
    }

    const { systemUpdates, rootUpdates } = buildBackgroundRemovalUpdates(
      localActor.value,
    );

    Object.assign(localActor.value.system, systemUpdates);
    Object.assign(localActor.value, rootUpdates);

    droppedBackgroundDef.value = null;

    applyGrantRemovalChoice(choice);

    isDirty.value = true;
    handleImmediateSave();

    toast.add({
      title: COMPENDIUM_PICKER_LABELS.backgroundRemovedTitle,
      description: COMPENDIUM_PICKER_LABELS.backgroundRemovedText,
      color: 'success',
    });
  }

  /**
   * Снимает с персонажа текущий вид или предысторию — смотря какой раздел
   * открыт в окне выбора. Класс снимается адресно, своим обработчиком.
   */
  function handleCompendiumPickerRemove() {
    const system = localActor.value?.system;

    if (compendiumPickerKind.value === 'species' && system?.species) {
      requestGrantRemoval({ kind: 'species', key: system.species.speciesKey });
    } else if (
      compendiumPickerKind.value === 'background'
      && system?.background
    ) {
      requestGrantRemoval({
        kind: 'background',
        key: system.background.backgroundKey,
      });
    }
  }

  function handleSpeciesSetupApply(
    systemUpdates: Partial<DnDActor['system']>,
    rootUpdates: Partial<DnDActor>,
  ) {
    if (!localActor.value) {
      return;
    }

    Object.assign(localActor.value.system, systemUpdates);

    if (Object.keys(rootUpdates).length > 0) {
      Object.assign(localActor.value, rootUpdates);
    }

    // Сохраняем определение применённого вида для отката при следующей смене
    appliedSpeciesDef.value = droppedSpeciesDef.value;

    const subspeciesKey = localActor.value.system.species?.subspeciesKey;

    appliedSubspeciesDef.value = subspeciesKey
      ? (speciesCatalog.resolve({
          key: subspeciesKey,
          packId: localActor.value.system.species?.packId,
        }) ?? null)
      : null;

    isDirty.value = true;
    handleImmediateSave();
  }

  /**
   * Пересчитывает уровне-зависимые дары вида (скорость, тёмное зрение, ресурсы)
   * под текущий суммарный уровень персонажа и выбранный подвид.
   * Особенности-списком не трогаем — лист показывает их по достижении уровня
   * (фильтр по level).
   */
  function recomputeSpeciesLeveledGrants(): void {
    const actorData = localActor.value;
    const speciesEntry = actorData?.system.species;

    if (!actorData || !speciesEntry) {
      return;
    }

    const definition = speciesCatalog.resolve({
      key: speciesEntry.speciesKey,
      packId: speciesEntry.packId,
    });

    if (!definition) {
      return;
    }

    const totalLevel = getTotalLevel(actorData.system.classes);
    const chosenSubspecies = Object.values(speciesEntry.featureChoices ?? {});

    const subspecies = speciesEntry.subspeciesKey
      ? (speciesCatalog.resolve({
          key: speciesEntry.subspeciesKey,
          packId: speciesEntry.packId,
        }) ?? null)
      : null;

    const movement = computeSpeciesMovement(
      definition,
      totalLevel,
      chosenSubspecies,
      subspecies,
    );

    const darkvision = computeSpeciesDarkvision(
      definition,
      totalLevel,
      chosenSubspecies,
      subspecies,
    );

    let changed = false;

    const current = actorData.system.movement;

    if (
      current.walk !== movement.walk
      || current.fly !== movement.fly
      || current.swim !== movement.swim
      || current.climb !== movement.climb
      || current.burrow !== movement.burrow
    ) {
      actorData.system.movement = { ...current, ...movement };
      changed = true;
    }

    if (
      actorData.token?.vision
      && actorData.token.vision.darkvision < darkvision
    ) {
      actorData.token.vision.darkvision = darkvision;
      changed = true;
    }

    // Ресурсы вида: «Скороход» лесного эльфа появляется на 3 уровне, а ресурс
    // умения со своим уровнем — вместе с умением. Источники берутся из записи
    // вида, как у мастера: на особенностях листа даров вида нет
    const counters = actorData.system.classCounters;

    const refreshedCounters = refreshSpeciesCounters(
      actorData,
      counters,
      collectSpeciesFeatDataSources(
        definition,
        totalLevel,
        chosenSubspecies,
        subspecies,
      ),
      speciesEntry.featDataChoices,
    );

    if (!isSameCounterList(counters, refreshedCounters)) {
      actorData.system.classCounters = refreshedCounters;
      changed = true;
    }

    if (changed) {
      isDirty.value = true;
      handleImmediateSave();
    }
  }

  // Дары вида по уровням: при повышении суммарного уровня (через мастер класса)
  // или смене выбранного подвида пересчитываем скорость/тёмное зрение/ресурсы.
  // Ресурсы в сигнатуру не входят, поэтому их пересчёт её не трогает. Сигнатура
  // строкой, чтобы watcher срабатывал только на реальные изменения и не зациклил
  // сам себя (пересчёт даёт те же значения → сигнатура не меняется).
  watch(
    () => {
      const speciesEntry = localActor.value?.system.species;

      if (!speciesEntry) {
        return '';
      }

      const totalLevel = getTotalLevel(localActor.value?.system.classes);

      const choices = Object.values(speciesEntry.featureChoices ?? {}).join(
        ',',
      );

      const subspecies = speciesEntry.subspeciesKey ?? '';

      return `${speciesEntry.speciesKey}|${subspecies}|${totalLevel}|${choices}`;
    },
    (signature, previousSignature) => {
      if (!signature || signature === previousSignature) {
        return;
      }

      recomputeSpeciesLeveledGrants();
    },
  );

  function handleBackgroundSetupApply(
    systemUpdates: Partial<DnDActor['system']>,
    rootUpdates: Partial<DnDActor>,
  ) {
    if (!localActor.value) {
      return;
    }

    Object.assign(localActor.value.system, systemUpdates);

    if (Object.keys(rootUpdates).length > 0) {
      Object.assign(localActor.value, rootUpdates);
    }

    isDirty.value = true;
    handleImmediateSave();
  }

  watch(
    () => props.open,
    (newValue) => {
      if (newValue) {
        initializeActor();

        // Хук модулей: лист актёра открыт (для расширений слота actor-sheet:tabs).
        // Только для существующего актёра — у нового ещё нет id.
        if (props.actorId) {
          ClientHooks.callAll('render:actor-sheet', props.actorId);
        }
      } else {
        savedSnapshot.value = null;
        isDirty.value = false;
      }
    },
    { immediate: true },
  );
</script>

<template>
  <!-- Сводка листа — здоровье, навыки, спасброски, владения — нужна в двух
    местах: на широком листе она стоит колонками слева от вкладок, на узком
    уходит во вкладку «Основное». Одно определение держит обработчики здесь и
    не плодит дубли разметки -->
  <DefineSummary>
    <!-- Свой `@container` у сводки узкого листа: её сетка считает колонки по
      ширине самой сводки. На широком листе обе обёртки растворяются, и панели
      встают колонками общей сетки листа -->
    <div
      v-if="localActor"
      :class="sheetLayoutClasses.summary"
    >
      <div :class="summaryLayoutClasses.grid">
        <ActorLeftPanel
          :actor="localActor"
          :is-edit-mode="isEditMode"
          :is-compact="!isWide"
          @update:actor="handleActorUpdate"
        />

        <!-- Центральная панель с навыками -->
        <ActorCenterPanel
          :actor="localActor"
          :is-edit-mode="isEditMode"
          :is-compact="!isWide"
          :counter-definitions="counterDefinitions"
          :highlighted-ability="highlightedAbility"
          @update:actor="handleActorUpdate"
        />
      </div>
    </div>
  </DefineSummary>

  <!--
    `max-h-[100%]` в `ui.body` снимает дефолтный потолок тела окна в 90vh:
    окно тянется почти на весь экран, и на полной высоте под содержимым
    оставалась пустая полоса. Класс вычитывает сама модалка и кладёт его
    значение в inline `max-height`.
  -->
  <UDraggableModal
    ref="sheetModalRef"
    :open="isOpen"
    :title="minimizedTitle"
    :draggable="true"
    :resizable="true"
    :min-width="SHEET_WINDOW_MIN_WIDTH"
    :min-height="600"
    :initial-width="1200"
    initial-height="85vh"
    :z-index="props.zIndex"
    :saved-position="props.savedPosition"
    :saved-size="props.savedSize"
    :ui="{
      content: 'bg-default rounded-xl',
      body: 'p-0 max-h-[100%]',
    }"
    :hide-header="true"
    poppable
    @update:open="handleModalClose"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div
        ref="sheetBody"
        class="relative flex h-full flex-col"
        @dragenter.prevent
        @dragover.prevent="handleDragOver"
        @dragleave="handleDragLeave"
        @drop.prevent="handleDrop"
      >
        <!-- Фоновая картинка с затуханием -->
        <img
          src="/assets/modals/actor_bg.webp"
          alt=""
          class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-8"
        />

        <div :class="sheetFrameClass">
          <!-- Шапка с информацией о персонаже -->
          <ActorHeader
            v-if="localActor"
            :actor="localActor"
            :is-edit-mode="isEditMode"
            :is-creating="!actorId && !isCreated"
            :can-edit="canEdit"
            :world-port="worldPort"
            :subclass-entries="subclassBadgeEntries"
            :can-pop-out="canPopOutSheet"
            :is-popped-out="isSheetPoppedOut"
            @update:actor="handleActorUpdate"
            @toggle-edit-mode="toggleEditMode"
            @open-settings="openSettings"
            @short-rest="handleRest('short')"
            @long-rest="handleRest('long')"
            @save="handleSave"
            @close="handleCancel"
            @minimize="minimizeSheet"
            @toggle-pop-out="togglePopOutSheet"
            @start-wizard="handleStartWizardSequence"
            @remove-class="requestClassRemoval"
            @open-compendium-picker="openCompendiumPicker"
          />
          <!-- Основной контент. Пока ширина листа не замерена, раскладка
          неизвестна, и рисовать его рано: угаданная раскладка на телефоне
          неверна, и лист перестроился бы на глазах -->
          <div :class="sheetLayoutClasses.content">
            <div
              v-if="localActor && isMeasured"
              :class="sheetLayoutClasses.grid"
            >
              <!-- Широкий лист: сводка — двумя левыми колонками -->
              <ReuseSummary v-if="isWide" />

              <!-- Правая колонка: характеристики и вкладки -->
              <div class="flex h-full min-w-0 flex-col">
                <ActorRightPanel
                  :actor="localActor"
                  :is-edit-mode="isEditMode"
                  class="mb-6"
                  @update:actor="handleActorUpdate"
                  @highlight="handleAbilityHighlight"
                />

                <ActorTabs
                  :actor="localActor"
                  :is-edit-mode="isEditMode"
                  :socket="socket"
                  :is-spell-drag-over="isSpellDragOver"
                  :is-equipment-drag-over="isEquipmentDragOver"
                  :is-feature-drag-over="isFeatureDragOver"
                  :has-main-tab="!isWide"
                  class="flex-1"
                  @update:actor="handleActorUpdate"
                  @immediate-save="handleImmediateSave"
                >
                  <!-- Узкий лист: сводка — первой вкладкой -->
                  <template #main>
                    <ReuseSummary />
                  </template>
                </ActorTabs>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDraggableModal>

  <!-- Модалка подтверждения -->
  <UDraggableModal
    v-model:open="isConfirmOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="400"
    :min-height="160"
    :z-index="Z_INDEX.MODAL_ELEVATED"
    :title="UNSAVED_CHANGES_LABELS.title"
  >
    <template #body>
      <div class="space-y-4">
        <p class="text-sm text-toned">
          {{ confirmMessage }}
        </p>

        <div class="flex justify-end gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="onConfirmCancel"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            variant="ghost"
            color="error"
            size="sm"
            @click.left.exact.prevent="onConfirmDiscard"
          >
            {{ UNSAVED_CHANGES_LABELS.discard }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="onConfirmSave"
          >
            {{ MODAL_BUTTON_LABELS.save }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>

  <!-- Модалка подтверждения замены вида/предыстории -->
  <UDraggableModal
    v-model:open="isReplaceConfirmOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="440"
    :min-height="160"
    :z-index="Z_INDEX.MODAL_ELEVATED * 2"
    :title="replaceConfirmTitle"
  >
    <template #body>
      <div class="space-y-4 p-4 text-center">
        <UIcon
          name="tabler:alert-triangle"
          class="mx-auto h-12 w-12 text-warning"
        />

        <p class="text-sm text-toned">
          {{ replaceConfirmMessage }}
        </p>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-center gap-3">
        <UButton
          variant="ghost"
          color="neutral"
          @click.left.exact.prevent="onReplaceCancel"
        >
          {{ MODAL_BUTTON_LABELS.cancel }}
        </UButton>

        <UButton
          color="error"
          icon="tabler:replace"
          @click.left.exact.prevent="onReplaceConfirm"
        >
          {{ ACTOR_SHEET_LABELS.replaceConfirm }}
        </UButton>
      </div>
    </template>
  </UDraggableModal>

  <!-- Мастер настройки класса -->
  <ClassSetupWizard
    v-if="localActor"
    v-model:open="isClassWizardOpen"
    :actor="localActor"
    :class-definition="droppedClassDef"
    :pack-id="droppedClassPackId"
    :loading="isClassSetupLoading"
    :socket="socket"
    @apply="handleClassSetupApply"
  />

  <!-- Мастер настройки вида -->
  <SpeciesSetupWizard
    v-if="localActor"
    v-model:open="isSpeciesWizardOpen"
    :actor="localActor"
    :species-definition="droppedSpeciesDef"
    :pack-id="droppedSpeciesPackId"
    :subspecies-key="droppedSubspeciesKey"
    :previous-species-definition="appliedSpeciesDef"
    :previous-subspecies-definition="appliedSubspeciesDef"
    :species-records="wizardSpeciesRecords"
    :socket="socket"
    @apply="handleSpeciesSetupApply"
  />

  <!-- Вид с подвидами: сперва спрашиваем, какой подвид -->
  <SubspeciesChoiceModal
    v-if="pendingSubspeciesChoice"
    :open="true"
    :species-name="pendingSubspeciesChoice.species.name"
    :options="pendingSubspeciesChoice.options"
    :pack-id="pendingSubspeciesChoice.packId"
    @update:open="handleSubspeciesChoiceOpen"
    @choose="handleSubspeciesChoice"
  />

  <!-- Запись есть в нескольких компендиумах мира: откуда взять -->
  <ChoicePickerModal
    v-if="packChoiceQuestion"
    :key="packChoiceQuestion.id"
    :open="true"
    :title="packChoiceQuestion.title"
    :subtitle="packChoiceQuestion.subtitle"
    :options="packChoiceQuestion.options"
    :selected="PACK_CHOICE_INITIAL_SELECTION"
    :max="PACK_CHOICE_PICK_COUNT"
    @apply="handlePackChoiceApply"
    @update:open="handlePackChoiceOpen"
  />

  <!-- Мастер настройки предыстории -->
  <BackgroundSetupWizard
    v-if="localActor"
    v-model:open="isBackgroundWizardOpen"
    :actor="localActor"
    :background-definition="droppedBackgroundDef"
    :pack-id="droppedBackgroundPackId"
    :socket="socket"
    @apply="handleBackgroundSetupApply"
  />

  <!-- Выбор вида/класса/предыстории из компендиума (клик по шапке листа) -->
  <CompendiumPickerModal
    v-if="localActor && isCompendiumPickerOpen"
    v-model:open="isCompendiumPickerOpen"
    :actor="localActor"
    :kind="compendiumPickerKind"
    :socket="socket"
    @select="handleCompendiumPickerSelect"
    @remove-current="handleCompendiumPickerRemove"
    @remove-class="requestClassRemoval"
  />

  <!-- Короткий отдых: трата костей хитов -->
  <ShortRestModal
    v-if="localActor"
    v-model:open="isShortRestOpen"
    :classes="localActor.system.classes"
    :manual-hit-dice="localActor.system.manualHitDice"
    :current-hit-points="localActor.system.hitPoints.current"
    :max-hit-points="resolveEntityMaxHp(localActor)"
    :con-mod="constitutionModifier"
    :hit-dice-rules="hitDiceSpendRules"
    @apply="handleShortRestApply"
  />

  <!-- Продолжительный отдых: предпросмотр восстановления -->
  <LongRestModal
    v-if="localActor"
    v-model:open="isLongRestOpen"
    :actor="localActor"
    @apply="handleLongRestApply"
  />

  <!-- Выбор при взятии черты: навык, оружие, тип урона -->
  <FeatChoicesModal
    v-if="localActor && pendingChoiceFeat"
    v-model:open="isFeatChoicesOpen"
    :feat-name="pendingChoiceFeat.name"
    :choices="pendingFeatChoices"
    :actor="localActor"
    :socket="socket"
    @apply="handleFeatChoicesApply"
  />

  <!-- Выбор у взятых черт: пересмотр на отдыхе и новые ступени списка -->
  <FeatRechooseModal
    v-if="localActor"
    v-model:open="isFeatRechooseOpen"
    :actor="localActor"
    :feats="featsAwaitingLeveledChoices"
    :title="
      featsAwaitingLeveledChoices ? FEAT_CHOICES_LABELS.leveledTitle : undefined
    "
    :hint="
      featsAwaitingLeveledChoices ? FEAT_CHOICES_LABELS.leveledHint : undefined
    "
    :confirm-label="
      featsAwaitingLeveledChoices ? MODAL_BUTTON_LABELS.apply : undefined
    "
    :socket="socket"
    @apply="handleFeatRechooseApply"
  />

  <!-- Удаление класса, вида или предыстории: что убрать вместе с записью -->
  <GrantRemovalModal
    v-if="pendingGrantRemoval"
    v-model:open="isGrantRemovalOpen"
    :kind="pendingGrantRemoval.subject.kind"
    :options="pendingGrantRemoval.options"
    @confirm="handleGrantRemovalConfirm"
  />
</template>

<style scoped>
  /* Сама полоса описана один раз в system.css. Здесь только ширина: лист
   * прокручивается целиком, и полоса у него шире, чем у панелей внутри. */
  .custom-scrollbar {
    --dnd5e-scrollbar-width: 6px;
  }
</style>
