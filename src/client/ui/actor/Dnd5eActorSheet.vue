<script setup lang="ts">
  import type {
    AbilityType,
    BaseActor,
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
    RestType,
    ShortRestHitDiceResult,
    SpeciesDefinition,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { MissingSheetSectionKey } from './constants';
  import type { AppliedFeatFeature } from './feat/featApply';

  import { useToast } from '@nuxt/ui/composables';
  import { computed, ref, toRef, watch } from 'vue';

  import { ClientHooks } from '@/core/clientHooks';
  import { loadCompendiumKind } from '@/core/compendiumDataClient';
  import { generateEntityId, requireSocket } from '@/core/entityUtils';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useActiveTab } from '@/shared_ui/composables/useActiveTab';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { useItemsStore } from '@/stores/itemsStore';
  import { useWorldStore } from '@/stores/worldStore';
  import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
  import { generateId, isRecord } from '@vtt/shared';
  import {
    appendGrantedSpells,
    applyActorRest,
    applyShortRestWithHitDice,
    calculateAbilityModifier,
    calculateMaxHP,
    checkFeatPrerequisites,
    collectFeatsAwaitingSpellListChoices,
    collectRechoosableFeats,
    computeSpeciesDarkvision,
    computeSpeciesMovement,
    DEFAULT_ACTOR,
    getMulticlassProficiencies,
    getTotalLevel,
    isDndActor,
    isDnDGameItem,
    isSkillType,
    isSpell,
    normalizeActor,
    normalizeCompendiumItem,
    resolveFeatChoicesToAsk,
  } from '@vtt/shared/system/dnd.js';

  import { useSheetMinimize } from '../../composables/useSheetMinimize';
  import ActorCenterPanel from './ActorCenterPanel.vue';
  import ActorHeader from './ActorHeader.vue';
  import ActorLeftPanel from './ActorLeftPanel.vue';
  import ActorRightPanel from './ActorRightPanel.vue';
  import ActorTabs from './ActorTabs.vue';
  import { buildBackgroundRemovalUpdates } from './background/backgroundRollback';
  import BackgroundSetupWizard from './background/BackgroundSetupWizard.vue';
  import ClassSetupWizard from './class/ClassSetupWizard.vue';
  import CompendiumPickerModal from './CompendiumPickerModal.vue';
  import {
    ACTOR_SHEET_LABELS,
    ACTOR_SHEET_LOG_PREFIX,
    BACKGROUND_DEFINITION_MIME,
    CLASS_DEFINITION_MIME,
    COMPENDIUM_PICKER_LABELS,
    FEAT_CHOICES_LABELS,
    FEAT_PREREQUISITE_LABELS,
    GAME_FEATURE_MIME,
    GAME_ITEM_MIME,
    MODAL_BUTTON_LABELS,
    REST_LABELS,
    SPECIES_DEFINITION_MIME,
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
  import ShortRestModal from './ShortRestModal.vue';
  import { buildSpeciesRemovalUpdates } from './species/speciesRollback';
  import SpeciesSetupWizard from './species/SpeciesSetupWizard.vue';

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
  const itemsStore = useItemsStore();
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

  // Модалка мастера видов
  const isSpeciesWizardOpen = ref(false);

  const droppedSpeciesDef = ref<SpeciesDefinition | null>(null);

  // Модалка мастера предыстории
  const isBackgroundWizardOpen = ref(false);
  const droppedBackgroundDef = ref<BackgroundDefinition | null>(null);

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

  // Очередь для последовательного повышения уровней (Wizard)
  const wizardQueue = ref<Array<{ classKey: string; targetLevel: number }>>([]);

  // Drag and Drop refs
  const isSpellDragOver = ref(false);
  const isEquipmentDragOver = ref(false);
  const isFeatureDragOver = ref(false);

  const { activeTab } = useActiveTab(
    'actor-sheet',
    toRef(() => localActor.value?.id),
    'equipment',
  );

  function isClassDefinition(value: unknown): value is ClassDefinition {
    return isRecord(value) && value.type === 'class';
  }

  function isSpeciesDefinition(value: unknown): value is SpeciesDefinition {
    return isRecord(value) && value.type === 'species';
  }

  function isBackgroundDefinition(
    value: unknown,
  ): value is BackgroundDefinition {
    return isRecord(value) && value.type === 'background';
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

  /** Определения классов компендиума (все паки), загружены с сервера */
  const compendiumClassDefinitions = ref<ClassDefinition[]>([]);

  /**
   * Итоговый список классов: компендиум + созданные в мире (items.db).
   * Используется мастером класса (драг/повышение уровня), счётчиками классовых
   * ресурсов и сборкой владений.
   */
  const classDefinitions = ref<ClassDefinition[]>([]);

  /** Определения видов компендиума (все паки), загружены с сервера */
  const compendiumSpeciesDefinitions = ref<SpeciesDefinition[]>([]);

  /**
   * Итоговый список видов: компендиум + созданные в мире (items.db).
   * Используется для отката при смене вида и (через systemDataStore) для
   * выбора вариантов особенностей на листе актёра.
   */
  const speciesDefinitions = ref<SpeciesDefinition[]>([]);

  /**
   * Классы, созданные в мире (GameItem с type==='class'), развёрнутые в плоский
   * ClassDefinition из вложенного classData.
   *
   * @returns массив определений классов мира
   */
  function getWorldClassDefinitions(): ClassDefinition[] {
    // Стор хоста отдаёт нейтральные предметы — D&D-форму подтверждает гвард,
    // `classData` это её поле.
    return itemsStore.items
      .filter(isDnDGameItem)
      .filter((worldItem) => worldItem.type === 'class')
      .map((worldItem) => worldItem.classData)
      .filter((definition): definition is ClassDefinition =>
        isClassDefinition(definition),
      );
  }

  /**
   * Пересобирает итоговый список классов из кеша компендиума и классов мира
   * (компендиум приоритетен при совпадении ключей — копия SRD-класса получает
   * новый ключ и не перекрывает оригинал).
   */
  function rebuildClassDefinitions(): void {
    const merged = [...compendiumClassDefinitions.value];

    for (const worldClass of getWorldClassDefinitions()) {
      if (!merged.some((definition) => definition.key === worldClass.key)) {
        merged.push(worldClass);
      }
    }

    classDefinitions.value = merged;
  }

  /**
   * Загружает определения классов компендиума с сервера (агрегировано по всем
   * пакам: бандл + скачиваемые + модули) и пересобирает итоговый список вместе
   * с классами мира.
   *
   * @returns массив определений классов
   */
  async function loadClassDefinitions(): Promise<ClassDefinition[]> {
    if (props.socket) {
      // CompendiumEntry[] расширяем до unknown[], т.к. ClassDefinition не
      // подтип CompendiumEntry и guard иначе не сузит при filter.
      const entries: unknown[] = await loadCompendiumKind(
        props.socket,
        'class',
      );

      compendiumClassDefinitions.value = entries.filter(isClassDefinition);
    }

    rebuildClassDefinitions();

    return classDefinitions.value;
  }

  // Классы мира приходят/меняются асинхронно (открытие панели предметов,
  // live-sync, правки) — пересобираем итоговый список при любых изменениях.
  watch(getWorldClassDefinitions, () => rebuildClassDefinitions(), {
    deep: true,
  });

  /**
   * Виды, созданные в мире (GameItem с type==='species'), развёрнутые в
   * плоский SpeciesDefinition из вложенного speciesData.
   *
   * @returns массив определений видов мира
   */
  function getWorldSpeciesDefinitions(): SpeciesDefinition[] {
    // Стор хоста отдаёт нейтральные предметы — D&D-форму подтверждает гвард
    // (см. `getWorldClassDefinitions`).
    return itemsStore.items
      .filter(isDnDGameItem)
      .filter((worldItem) => worldItem.type === 'species')
      .map((worldItem) => worldItem.speciesData)
      .filter((definition): definition is SpeciesDefinition =>
        isSpeciesDefinition(definition),
      );
  }

  /**
   * Пересобирает итоговый список видов из кеша компендиума и видов мира
   * (компендиум приоритетен при совпадении ключей) и синхронизирует его с
   * systemDataStore — оттуда лист берёт варианты особенностей.
   */
  function rebuildSpeciesDefinitions(): void {
    const merged = [...compendiumSpeciesDefinitions.value];

    for (const worldSpecies of getWorldSpeciesDefinitions()) {
      if (!merged.some((definition) => definition.key === worldSpecies.key)) {
        merged.push(worldSpecies);
      }
    }

    speciesDefinitions.value = merged;
    systemDataStore.setSpeciesDefinitions(merged);
  }

  /**
   * Загружает определения видов компендиума с сервера и пересобирает итоговый
   * список (вместе с видами мира).
   *
   * @returns массив определений видов
   */
  async function loadSpeciesDefinitions(): Promise<SpeciesDefinition[]> {
    if (props.socket) {
      // CompendiumEntry[] расширяем до unknown[], т.к. SpeciesDefinition не
      // подтип CompendiumEntry и guard иначе не сузит при filter.
      const entries: unknown[] = await loadCompendiumKind(
        props.socket,
        'species',
      );

      compendiumSpeciesDefinitions.value = entries.filter(isSpeciesDefinition);
    }

    rebuildSpeciesDefinitions();

    return speciesDefinitions.value;
  }

  // Виды мира приходят/меняются асинхронно (открытие панели предметов,
  // live-sync, правки) — пересобираем итоговый список при любых изменениях.
  watch(getWorldSpeciesDefinitions, () => rebuildSpeciesDefinitions(), {
    deep: true,
  });

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

    const definitions = await loadSpeciesDefinitions();

    const found =
      definitions.find((definition) => definition.key === speciesKey) ?? null;

    if (found) {
      appliedSpeciesDef.value = found;
    }
  }

  // Предзагрузка определений компендиума при появлении сокета (и смене мира).
  watch(
    () => props.socket,
    (socket) => {
      if (socket) {
        void loadClassDefinitions();
        void loadSpeciesDefinitions();
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

  const isOwner = computed(() => {
    if (!localActor.value) {
      return false;
    }

    return localActor.value.ownerId === currentUser.value?.id;
  });

  const canEdit = computed(() => {
    return isAdmin.value || isOwner.value;
  });

  /**
   * Собирает определения счётчиков из компендиума для всех классов актора.
   * Используется для отображения name, icon, recovery в ClassCounters.
   */
  const counterDefinitions = computed((): ClassCounterDefinition[] => {
    if (!localActor.value) {
      return [];
    }

    const classes = localActor.value.system.classes;

    if (!classes || classes.length === 0) {
      return [];
    }

    const classDefs = classDefinitions.value;
    const result: ClassCounterDefinition[] = [];

    for (const classEntry of classes) {
      const classDef = classDefs.find(
        (definition) => definition.key === classEntry.classKey,
      );

      if (!classDef) {
        continue;
      }

      if (classDef.counters) {
        for (const counter of classDef.counters) {
          if (classEntry.level >= counter.startLevel) {
            result.push(counter);
          }
        }
      }

      if (classDef.subclasses) {
        const subclassKeys = new Set<string>();

        if (classEntry.subclassKey) {
          subclassKeys.add(classEntry.subclassKey);
        }

        for (const counter of localActor.value.system.classCounters ?? []) {
          if (counter.classKey === classEntry.classKey && counter.subclassKey) {
            subclassKeys.add(counter.subclassKey);
          }
        }

        for (const subclassKey of subclassKeys) {
          const subclass = classDef.subclasses.find(
            (entry) => entry.key === subclassKey,
          );

          if (subclass?.counters) {
            for (const counter of subclass.counters) {
              if (classEntry.level >= counter.startLevel) {
                result.push(counter);
              }
            }
          }
        }
      }
    }

    return result;
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
  }

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

  watch(
    () => storeActor.value?.token,
    (newToken) => {
      if (localActor.value && newToken) {
        localActor.value.token = JSON.parse(JSON.stringify(newToken));
      }
    },
    { deep: true },
  );

  /**
   * Синхронизация изменяемых извне разделов актёра из store в localActor:
   * equipment (передача предметов между токенами), system (HP, слоты, размер)
   * и spells (редактирование заклинаний, в т.ч. из других окон).
   *
   * Зачем: localActor — глубокая копия на момент открытия листа, а все
   * сохранения отправляют актёра ЦЕЛИКОМ (`actor:updated`). Без обратной
   * синхронизации любое сохранение листа затирало бы на сервере изменения,
   * пришедшие извне после открытия (потерянное обновление — так «слетали»
   * формулы заклинаний).
   *
   * В режиме редактирования синхронизация выключена: локальные правки имеют
   * приоритет до «Сохранить»/«Отменить». Цикл store → localActor → store
   * не возникает: присваивание в localActor ничего не отправляет на сервер —
   * emit происходит только в явных обработчиках сохранения.
   */
  watch(
    [
      () => storeActor.value?.equipment,
      () => storeActor.value?.system,
      () => storeActor.value?.spells,
      () => storeActor.value?.activeEffects,
    ],
    ([newEquipment, newSystem, newSpells, newActiveEffects]) => {
      if (!localActor.value || isEditMode.value) {
        return;
      }

      if (newEquipment) {
        localActor.value.equipment = JSON.parse(JSON.stringify(newEquipment));
      }

      if (newSystem) {
        localActor.value.system = JSON.parse(JSON.stringify(newSystem));
      }

      if (newSpells) {
        localActor.value.spells = JSON.parse(JSON.stringify(newSpells));
      }

      // Активные эффекты тоже меняются извне (каст самобаффа из хотбара/другого
      // окна добавляет эффект через worldStore) — без синхронизации открытый
      // лист показывал бы устаревшие КД/эффекты, а сохранение листа затёрло бы
      // их на сервере.
      if (newActiveEffects) {
        localActor.value.activeEffects = JSON.parse(
          JSON.stringify(newActiveEffects),
        );
      }
    },
    { deep: true },
  );

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
    if (!localActor.value || !props.socket) {
      return;
    }

    try {
      requireSocket(props.socket);

      props.socket.emit('actor:updated', localActor.value);
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
   * Черты, у которых на новом уровне открылась ступень таблицы заклинаний.
   * Пусто — окно выбора работает по своему обычному поводу (отдых).
   */
  const featsAwaitingSpellLists = ref<FeatAwaitingChoices[] | null>(null);

  /** Модификатор Телосложения актёра (для броска костей хитов) */
  const constitutionModifier = computed(() =>
    calculateAbilityModifier(
      localActor.value?.system.abilities?.constitution ?? 10,
    ),
  );

  /**
   * Применяет отдых к актёру. Оба типа отдыха открывают модалку: короткий —
   * для траты костей хитов, долгий — для предпросмотра восстановления.
   * @param restType - тип отдыха
   */
  function handleRest(restType: RestType): void {
    if (!localActor.value) {
      return;
    }

    if (restType === 'short') {
      isShortRestOpen.value = true;

      return;
    }

    isLongRestOpen.value = true;
  }

  /**
   * Завершает продолжительный отдых: восстанавливает хиты, ячейки, заряды и
   * кости хитов (половину по правилам или все — по выбору в модалке).
   * @param options - параметры долгого отдыха из модалки
   */
  function handleLongRestApply(options: LongRestOptions): void {
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
      featsAwaitingSpellLists.value = null;
      isFeatRechooseOpen.value = true;
    }
  }

  /**
   * Завершает короткий отдых: накладывает результат броска костей хитов
   * (лечение + потраченные кости) на восстановление коротких ресурсов.
   * @param result - результат броска костей хитов из модалки
   */
  function handleShortRestApply(result: ShortRestHitDiceResult): void {
    if (!localActor.value) {
      return;
    }

    handleActorUpdate(applyShortRestWithHitDice(localActor.value, result));

    toast.add({
      title: REST_LABELS.short,
      description: ACTOR_SHEET_LABELS.shortRestDone,
      color: 'success',
    });
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
    if (!localActor.value || isSaving.value) {
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
        const cleanActor = JSON.parse(JSON.stringify(localActor.value));

        props.socket.emit('actor:updated', cleanActor);
      } else {
        const rawLocalActor = JSON.parse(JSON.stringify(localActor.value));

        const newActor: DnDActor = {
          ...rawLocalActor,
          id: rawLocalActor?.id || generateEntityId('actor'),
        };

        props.socket.emit('actor:created', newActor);
        emit('save', newActor);
        isCreated.value = true;

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

  const { sheetModalRef, minimizedTitle, minimizeSheet } = useSheetMinimize(
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
      }, 100);
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
  function startClassSetup(definition: ClassDefinition) {
    droppedClassDef.value = definition;
    wizardQueue.value = []; // Очередь уровней тут ни при чём
    isClassWizardOpen.value = true;
  }

  /**
   * Запускает мастеров для нескольких выбранных классов подряд — мультикласс за
   * один заход. Идёт через ту же очередь, что и повышение уровня: мастер
   * сбрасывает своё состояние только при повторном открытии, поэтому следующий
   * класс должен открываться ПОСЛЕ закрытия предыдущего (этим и занимается
   * `processNextWizardStep`, ожидая загрузку определений).
   *
   * @param definitions - определения выбранных классов
   */
  function startClassesSetup(definitions: ClassDefinition[]) {
    const [firstDefinition, ...restDefinitions] = definitions;

    if (!firstDefinition) {
      return;
    }

    if (restDefinitions.length === 0) {
      startClassSetup(firstDefinition);

      return;
    }

    wizardQueue.value = definitions.map((definition) => ({
      classKey: definition.key,
      targetLevel: 1,
    }));

    void processNextWizardStep();
  }

  /**
   * Запускает настройку вида: у персонажа с видом сперва спрашиваем замену.
   *
   * @param definition - определение вида
   */
  function startSpeciesSetup(definition: SpeciesDefinition) {
    droppedSpeciesDef.value = definition;

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
   */
  function startBackgroundSetup(definition: BackgroundDefinition) {
    droppedBackgroundDef.value = definition;

    if (localActor.value?.system.background) {
      replaceConfirmTarget.value = 'background';
      isReplaceConfirmOpen.value = true;
    } else {
      isBackgroundWizardOpen.value = true;
    }
  }

  function handleDrop(event: DragEvent) {
    isSpellDragOver.value = false;
    isEquipmentDragOver.value = false;
    isFeatureDragOver.value = false;

    if (!canEdit.value || !event.dataTransfer) {
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
        const parsedClassDefinition: unknown = JSON.parse(classDataStr);

        if (!isClassDefinition(parsedClassDefinition)) {
          throw new Error('Dropped class definition has invalid shape');
        }

        startClassSetup(parsedClassDefinition);
        event.preventDefault();
        event.stopPropagation();
      } catch (error) {
        console.error('Failed to parse dropped class definition', error);
      }
    } else if (speciesDataStr) {
      try {
        const parsedSpeciesDefinition: unknown = JSON.parse(speciesDataStr);

        if (!isSpeciesDefinition(parsedSpeciesDefinition)) {
          throw new Error('Dropped species definition has invalid shape');
        }

        startSpeciesSetup(parsedSpeciesDefinition);
        event.preventDefault();
        event.stopPropagation();
      } catch (error) {
        console.error('Failed to parse dropped species definition', error);
      }
    } else if (backgroundDataStr) {
      try {
        const parsedBackgroundDefinition: unknown =
          JSON.parse(backgroundDataStr);

        if (!isBackgroundDefinition(parsedBackgroundDefinition)) {
          throw new Error('Dropped background definition has invalid shape');
        }

        startBackgroundSetup(parsedBackgroundDefinition);
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
            const newItem: DnDGameItem = normalizeCompendiumItem({
              ...parsedItem,
              id: generateId('eq'),
              isReadOnly: false,
              equipped: false,
            });

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

  /**
   * Применяет перетащенную черту к актору: резолвит выдаваемые заклинания через
   * компендиум, затем добавляет особенность-черту, выдаёт заклинания, переносит
   * активные эффекты и владения. Резолв асинхронный — особенность появляется
   * после загрузки компендиума (обычно из кеша, мгновенно).
   *
   * @param droppedFeat - перетащенная черта (с featData/activeEffects)
   */
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

    featsAwaitingSpellLists.value = null;

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

    // Определения классов агрегированы сервером по всем пакам (loadCompendiumKind
    // кеширует — повторные шаги мастера не делают лишних запросов).
    const classes = await loadClassDefinitions();

    const targetDef =
      classes.find(
        (classDefinition) => classDefinition.key === nextStep.classKey,
      ) ?? null;

    if (targetDef) {
      droppedClassDef.value = targetDef;
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
    queue: Array<{ classKey: string; targetLevel: number }>;
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

      const previousMax = localActor.value.system.hitPoints?.max ?? 0;
      const newMax = calculateMaxHP(systemUpdates.classes, constitutionMod);
      const hpGain = newMax - previousMax;

      localActor.value.system.hitPoints = {
        ...localActor.value.system.hitPoints,
        max: newMax,
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
   * Открывает на новом уровне то, что черты выдают ступенями: заклинание с
   * уровнем доступа («Малое восстановление» метки исцеления приходит на третьем)
   * и очередную ступень таблицы заклинаний класса.
   *
   * Без этого прохода такие заклинания не появились бы никогда: черту применяют
   * один раз, на взятии, и повторно её дары никто не пересчитывает. Уже выданное
   * не задваивается — совпадения отсеиваются по названию.
   */
  async function unlockFeatSpellsForLevel(): Promise<void> {
    if (!localActor.value) {
      return;
    }

    const resolved = await resolveActorFeatSpells(
      props.socket,
      localActor.value,
    );

    if (!localActor.value) {
      return;
    }

    const before = localActor.value.spells?.length ?? 0;
    const spells = appendGrantedSpells(localActor.value.spells ?? [], resolved);

    if (spells.length > before) {
      localActor.value.spells = spells;
      isDirty.value = true;
      handleImmediateSave();
    }

    // Ступень, из которой берут не всё, сама не откроется: сперва игрок выбирает.
    // Посреди очереди повышений не спрашиваем — окно встало бы поверх мастера
    // класса; последний шаг очереди спросит про всё разом
    if (wizardQueue.value.length > 0) {
      return;
    }

    const awaiting = collectFeatsAwaitingSpellListChoices(localActor.value);

    if (awaiting.length > 0) {
      featsAwaitingSpellLists.value = awaiting;
      isFeatRechooseOpen.value = true;
    }
  }

  /**
   * Пересобирает владения (armor, weapons, tools, savingThrows, skills)
   * на основе SRD-данных оставшихся классов.
   *
   * Первый класс в массиве получает полные стартовые владения,
   * остальные — только мультикласс-владения (PHB 2024).
   *
   * @param actor - актор для обновления
   * @param remainingClasses - оставшиеся записи классов
   * @param removedSkills - навыки удалённого класса для исключения
   */
  function rebuildProficienciesFromRemainingClasses(
    actor: DnDActor,
    remainingClasses: DnDActor['system']['classes'],
    removedSkills: string[],
  ): void {
    const proficiencies = actor.system.proficiencies;

    if (remainingClasses.length === 0) {
      // Удалён последний класс — полная очистка
      proficiencies.armor = [];
      proficiencies.weapons = [];
      proficiencies.tools = [];
      proficiencies.savingThrows = [];
      proficiencies.skills = {};

      return;
    }

    const localClasses = classDefinitions.value;

    // Собираем все владения из оставшихся классов
    const allArmor = new Set<string>();
    const allWeapons = new Set<string>();
    const allTools = new Set<string>();
    const allSavingThrows = new Set<AbilityType>();

    for (
      let classIndex = 0;
      classIndex < remainingClasses.length;
      classIndex++
    ) {
      const classEntry = remainingClasses[classIndex];

      const classDef = localClasses.find(
        (definition) => definition.key === classEntry.classKey,
      );

      if (!classDef) {
        continue;
      }

      if (classIndex === 0) {
        // Первый класс — полные стартовые владения
        for (const armor of unpackProficiencyKeys(
          classDef.armorProficiencies,
          systemDataStore.armorBaseTypes,
        )) {
          allArmor.add(armor);
        }

        for (const weapon of unpackProficiencyKeys(
          classDef.weaponProficiencies,
          systemDataStore.weaponBaseTypes,
        )) {
          allWeapons.add(weapon);
        }

        for (const tool of classDef.toolProficiencies ?? []) {
          allTools.add(tool);
        }

        for (const saving of classDef.savingThrowProficiencies) {
          allSavingThrows.add(saving);
        }
      } else {
        // Мультикласс — сокращённые владения (PHB 2024)
        // Через хелпер, а не индексацией таблицы: у хоумбрю-класса ключ вне
        // `ClassKey`, и владения мультикласса лежат в его собственном поле
        // `multiclassProficiencies` — прямая индексация их теряла.
        const multiProf = getMulticlassProficiencies(classDef);

        if (multiProf) {
          for (const armor of unpackProficiencyKeys(
            multiProf.armor,
            systemDataStore.armorBaseTypes,
          )) {
            allArmor.add(armor);
          }

          for (const weapon of unpackProficiencyKeys(
            multiProf.weapons,
            systemDataStore.weaponBaseTypes,
          )) {
            allWeapons.add(weapon);
          }

          for (const tool of multiProf.tools) {
            allTools.add(tool);
          }
        }
      }
    }

    proficiencies.armor = Array.from(allArmor);
    proficiencies.weapons = Array.from(allWeapons);
    proficiencies.tools = Array.from(allTools);
    proficiencies.savingThrows = Array.from(allSavingThrows);

    // Навыки — удаляем только те, которые были от удалённого класса
    if (removedSkills.length > 0) {
      // Проверяем, не дублируются ли навыки в оставшихся классах
      const remainingChosenSkills = new Set<string>();

      for (const classEntry of remainingClasses) {
        for (const skill of classEntry.chosenSkills) {
          remainingChosenSkills.add(skill);
        }
      }

      for (const removedSkill of removedSkills) {
        // Удаляем навык только если его нет ни в одном оставшемся классе
        if (
          isSkillType(removedSkill)
          && !remainingChosenSkills.has(removedSkill)
        ) {
          delete proficiencies.skills[removedSkill];
        }
      }
    }
  }

  /**
   * Удаляет класс у актёра и все связанные с ним данные:
   * - Запись из system.classes
   * - Особенности (features) с featureType 'class' или 'subclass', привязанные к этому классу
   * - Пересчёт HP
   */
  function handleRemoveClass(classKey: string) {
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
    if (localActor.value.features) {
      localActor.value.features = localActor.value.features.filter(
        (feature) => {
          const isClassFeature =
            feature.featureType === 'class'
            || feature.featureType === 'subclass';

          if (!isClassFeature) {
            return true;
          }

          // grantedBy содержит название класса (напр. «Волшебник» или
          // «Волшебник — Школа воплощения»)
          return !feature.grantedBy?.includes(removedClassName);
        },
      );
    }

    // Удаляем activeEffects, связанные с этим классом (ASI, черты)
    if (localActor.value.activeEffects) {
      localActor.value.activeEffects = localActor.value.activeEffects.filter(
        (effect) => !effect.name.includes(removedClassName),
      );
    }

    // Пересобираем proficiencies из SRD-данных оставшихся классов
    rebuildProficienciesFromRemainingClasses(
      localActor.value,
      remainingClasses,
      removedEntry.chosenSkills,
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
   * @param definitions - определения вида, классов или предыстории
   */
  function handleCompendiumPickerSelect(
    definitions: Array<
      SpeciesDefinition | ClassDefinition | BackgroundDefinition
    >,
  ) {
    const classDefinitions: ClassDefinition[] = [];

    for (const definition of definitions) {
      if (definition.type === 'species') {
        startSpeciesSetup(definition);
      } else if (definition.type === 'background') {
        startBackgroundSetup(definition);
      } else {
        classDefinitions.push(definition);
      }
    }

    if (classDefinitions.length > 0) {
      startClassesSetup(classDefinitions);
    }
  }

  /**
   * Снимает с персонажа вид: владения, особенности, тёмное зрение, размер и
   * скорость возвращаются к состоянию «вид не выбран».
   *
   * Без определения снимаемого вида (пак компендиума мог исчезнуть) владения
   * откатить нечем — снимаем всё остальное и предупреждаем об этом.
   */
  function handleRemoveSpecies() {
    if (!localActor.value?.system.species) {
      return;
    }

    const hasDefinition = Boolean(appliedSpeciesDef.value);

    const { systemUpdates, rootUpdates } = buildSpeciesRemovalUpdates(
      localActor.value,
      appliedSpeciesDef.value,
    );

    Object.assign(localActor.value.system, systemUpdates);
    Object.assign(localActor.value, rootUpdates);

    appliedSpeciesDef.value = null;
    droppedSpeciesDef.value = null;

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
   */
  function handleRemoveBackground() {
    if (!localActor.value?.system.background) {
      return;
    }

    const { systemUpdates, rootUpdates } = buildBackgroundRemovalUpdates(
      localActor.value,
    );

    Object.assign(localActor.value.system, systemUpdates);
    Object.assign(localActor.value, rootUpdates);

    droppedBackgroundDef.value = null;

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
    if (compendiumPickerKind.value === 'species') {
      handleRemoveSpecies();
    } else if (compendiumPickerKind.value === 'background') {
      handleRemoveBackground();
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

    isDirty.value = true;
    handleImmediateSave();
  }

  /**
   * Пересчитывает уровне-зависимые дары вида (скорость, тёмное зрение) под
   * текущий суммарный уровень персонажа и выбранный подвид. Особенности-списком
   * не трогаем — лист показывает их по достижении уровня (фильтр по level).
   */
  function recomputeSpeciesLeveledGrants(): void {
    const actorData = localActor.value;
    const speciesEntry = actorData?.system.species;

    if (!actorData || !speciesEntry) {
      return;
    }

    const definition = speciesDefinitions.value.find(
      (entry) => entry.key === speciesEntry.speciesKey,
    );

    if (!definition) {
      return;
    }

    const totalLevel = getTotalLevel(actorData.system.classes);
    const chosenSubspecies = Object.values(speciesEntry.featureChoices ?? {});

    const movement = computeSpeciesMovement(
      definition,
      totalLevel,
      chosenSubspecies,
    );

    const darkvision = computeSpeciesDarkvision(
      definition,
      totalLevel,
      chosenSubspecies,
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

    if (changed) {
      isDirty.value = true;
      handleImmediateSave();
    }
  }

  // Дары вида по уровням: при повышении суммарного уровня (через мастер класса)
  // или смене выбранного подвида пересчитываем скорость/тёмное зрение. Сигнатура
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

      return `${speciesEntry.speciesKey}|${totalLevel}|${choices}`;
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
    :min-width="800"
    :min-height="600"
    :initial-width="1200"
    initial-height="85vh"
    :z-index="props.zIndex"
    :saved-position="props.savedPosition"
    :saved-size="props.savedSize"
    :ui="{
      content: 'bg-default rounded-2xl',
      body: 'p-0 max-h-[100%]',
    }"
    :hide-header="true"
    @update:open="handleModalClose"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div
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
        <!-- Шапка с информацией о персонаже -->
        <ActorHeader
          v-if="localActor"
          :actor="localActor"
          :is-edit-mode="isEditMode"
          :is-creating="!actorId && !isCreated"
          :can-edit="canEdit"
          :is-admin="isAdmin"
          :world-port="worldPort"
          @update:actor="handleActorUpdate"
          @toggle-edit-mode="toggleEditMode"
          @open-settings="openSettings"
          @short-rest="handleRest('short')"
          @long-rest="handleRest('long')"
          @save="handleSave"
          @close="handleCancel"
          @minimize="minimizeSheet"
          @start-wizard="handleStartWizardSequence"
          @remove-class="handleRemoveClass"
          @open-compendium-picker="openCompendiumPicker"
        />
        <!-- Основной контент (3 колонки) -->
        <div class="custom-scrollbar flex-1 overflow-y-auto px-2 pt-4 pb-2">
          <div class="grid grid-cols-[250px_280px_1fr] gap-4">
            <ActorLeftPanel
              v-if="localActor"
              :actor="localActor"
              :is-edit-mode="isEditMode"
              class="flex flex-col"
              @update:actor="handleActorUpdate"
            />

            <!-- Центральная панель с навыками -->
            <ActorCenterPanel
              v-if="localActor"
              :actor="localActor"
              :is-edit-mode="isEditMode"
              :counter-definitions="counterDefinitions"
              :highlighted-ability="highlightedAbility"
              class="flex h-full flex-col"
              @update:actor="handleActorUpdate"
            />

            <!-- Правая панель с характеристиками -->
            <div class="flex h-full flex-col">
              <ActorRightPanel
                v-if="localActor"
                :actor="localActor"
                :is-edit-mode="isEditMode"
                class="mb-6"
                @update:actor="handleActorUpdate"
                @highlight="handleAbilityHighlight"
              />

              <!-- Вкладки с дополнительной информацией (теперь внутри правой колонки) -->
              <ActorTabs
                v-if="localActor"
                :actor="localActor"
                :is-edit-mode="isEditMode"
                :socket="socket"
                :is-spell-drag-over="isSpellDragOver"
                :is-equipment-drag-over="isEquipmentDragOver"
                :is-feature-drag-over="isFeatureDragOver"
                class="flex-1"
                @update:actor="handleActorUpdate"
                @immediate-save="handleImmediateSave"
              />
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
    :socket="socket"
    @apply="handleClassSetupApply"
  />

  <!-- Мастер настройки вида -->
  <SpeciesSetupWizard
    v-if="localActor"
    v-model:open="isSpeciesWizardOpen"
    :actor="localActor"
    :species-definition="droppedSpeciesDef"
    :previous-species-definition="appliedSpeciesDef"
    :socket="socket"
    @apply="handleSpeciesSetupApply"
  />

  <!-- Мастер настройки предыстории -->
  <BackgroundSetupWizard
    v-if="localActor"
    v-model:open="isBackgroundWizardOpen"
    :actor="localActor"
    :background-definition="droppedBackgroundDef"
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
    @remove-class="handleRemoveClass"
  />

  <!-- Короткий отдых: трата костей хитов -->
  <ShortRestModal
    v-if="localActor"
    v-model:open="isShortRestOpen"
    :classes="localActor.system.classes"
    :manual-hit-dice="localActor.system.manualHitDice"
    :current-hit-points="localActor.system.hitPoints.current"
    :max-hit-points="localActor.system.hitPoints.max"
    :con-mod="constitutionModifier"
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
    :feats="featsAwaitingSpellLists"
    :title="
      featsAwaitingSpellLists ? FEAT_CHOICES_LABELS.spellListTitle : undefined
    "
    :hint="
      featsAwaitingSpellLists ? FEAT_CHOICES_LABELS.spellListHint : undefined
    "
    :confirm-label="
      featsAwaitingSpellLists ? MODAL_BUTTON_LABELS.apply : undefined
    "
    :socket="socket"
    @apply="handleFeatRechooseApply"
  />
</template>

<style scoped>
  /* Сама полоса описана один раз в system.css. Здесь только ширина: лист
   * прокручивается целиком, и полоса у него шире, чем у панелей внутри. */
  .custom-scrollbar {
    --dnd5e-scrollbar-width: 6px;
  }
</style>
