<script setup lang="ts">
  import type {
    AbilityType,
    BaseCreature,
    ProficiencyLevel,
    SkillType,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    AttackRollMode,
    DnDCreature,
    DnDCustomBonusContext,
    DnDSavingThrowSettings,
    DnDSkillSettings,
    RestTriggerOptions,
    RestType,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { RollBonusEvaluator } from '../../composables/rollBonusEvaluator';
  import type { SheetTabEntry } from '../actor/sheetTabsModel';

  import { useToast } from '@nuxt/ui/composables';
  import { createReusableTemplate } from '@vueuse/core';
  import { computed, ref, toRef, useTemplateRef, watch } from 'vue';

  import { generateEntityId, requireSocket } from '@/core/entityUtils';
  import FieldsetLabel from '@/shared_ui/components/FieldsetLabel.vue';
  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import RichTextEditor from '@/shared_ui/components/RichTextEditor.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { useWorldStore } from '@/stores/worldStore';
  import { generateId, isEntityOwner } from '@vtt/shared';
  import {
    applyCreatureRest,
    calculateAbilityModifier,
    CR_TABLE,
    createInventoryItem,
    CREATURE_ENVIRONMENTS,
    CREATURE_HIT_DICE_RULE_KEYS,
    CREATURE_SIZE_TO_TOKEN_SCALE,
    DEFAULT_CREATURE,
    DEFAULT_PROFICIENCY_BONUS,
    ensureCreatureSpellsInBlocks,
    formatVisionRange,
    getActorAbilityModifiers,
    getCreatureHitDiceBonusContext,
    getCreatureProficiencyBonus,
    getCustomBonusesValue,
    getCustomSkillValue,
    getEntityExhaustionLevel,
    getProficiencyContribution,
    getSkillCheckBonusKeys,
    getSkillSetting,
    getSkillSettingAbility,
    isDndCreature,
    isDndCreatureRecord,
    isDnDGameItem,
    isProficiencyLevel,
    isSpell,
    listConditions,
    mergeEntityDraft,
    normalizeCreature,
    PASSIVE_SKILL_BASE,
    resolveAbilityCheckRollMode,
    resolveCreatureHitPointsByRules,
    SKILLS_LIST,
    syncCreatureSpellcastingUses,
    withExhaustionLevel,
  } from '@vtt/shared/system/dnd.js';

  import { runRestWithTriggers } from '../../composables/restTriggerPrompt';
  import { buildRollBonusEvaluator } from '../../composables/rollBonusEvaluator';
  import {
    refuseWhileSheetEditing,
    useSheetEditLock,
  } from '../../composables/sheetEditLock';
  import {
    isItemTransferDrop,
    useItemTransfer,
  } from '../../composables/useItemTransfer';
  import { useResolvedStats } from '../../composables/useResolvedStats';
  import { useSheetLayout } from '../../composables/useSheetLayout';
  import { useSheetMinimize } from '../../composables/useSheetMinimize';
  import { useWorldSheetSync } from '../../composables/useWorldSheetSync';
  import { useSystemDataStore } from '../../stores/systemDataStore';
  import {
    ABILITY_CHECK_ROLL_LABELS,
    CREATURE_SHEET_WIDE_MIN_WIDTH_REM,
    DICE_ROLL_DEFAULT_BUTTON,
    DRAG_OVER_RESET_DELAY_MS,
    FEET_UNIT_LABEL,
    FORM_FIELD_LABELS,
    FORM_TAB_LABELS,
    GAME_ITEM_MIME,
    GAME_ITEM_TRANSFER_MIME,
    GRANT_FIELD_LABELS,
    GRANT_SECTION_LABELS,
    MODAL_BUTTON_LABELS,
    PROFICIENCY_MODAL_LABELS,
    REST_LABELS,
    SAVING_THROW_ABILITIES,
    SAVING_THROW_ROLL_LABELS,
    SAVING_THROW_SETTINGS_LABELS,
    SHEET_BLOCK_VIEW_BORDER_CLASS,
    SHEET_FRAME_CLASSES,
    SHEET_MAIN_TAB_ID,
    SHEET_TABS_LABELS,
    SHEET_WINDOW_MIN_WIDTH,
    SKILL_SETTINGS_LABELS,
    SPELL_MIME,
    UNSAVED_CHANGES_LABELS,
  } from '../actor/constants';
  import DiceRollModal from '../actor/DiceRollModal.vue';
  import ExhaustionPanel from '../actor/ExhaustionPanel.vue';
  import LanguageProficiencyModal from '../actor/LanguageProficiencyModal.vue';
  import SavingThrowSettingsModal from '../actor/SavingThrowSettingsModal.vue';
  import SheetSettingsGear from '../actor/SheetSettingsGear.vue';
  import SheetTabs from '../actor/SheetTabs.vue';
  import SkillSettingsModal from '../actor/SkillSettingsModal.vue';
  import { formatSignedNumber } from '../actor/utils/formatSignedNumber';
  import { getSheetBlockClass } from '../actor/utils/sheetBlockClass';
  import { withoutEntityOwnership } from '../entity-ownership/utils';
  import {
    CREATURE_SHEET_DEFAULT_TAB_ID,
    CREATURE_SHEET_LABELS,
    CREATURE_SHEET_LAYOUT_CLASSES,
    CREATURE_SHEET_LOG_PREFIX,
  } from './constants';
  import CreatureAbilities from './CreatureAbilities.vue';
  import CreatureCombatBlock from './CreatureCombatBlock.vue';
  import CreatureConditionImmunitiesModal from './CreatureConditionImmunitiesModal.vue';
  import CreatureDefensesModal from './CreatureDefensesModal.vue';
  import CreatureEffectsBlock from './CreatureEffectsBlock.vue';
  import CreatureEnvironmentsModal from './CreatureEnvironmentsModal.vue';
  import CreatureEquipmentBlock from './CreatureEquipmentBlock.vue';
  import CreatureHeader from './CreatureHeader.vue';
  import CreatureSpellsBlock from './CreatureSpellsBlock.vue';
  import CreatureActionsTab from './tabs/CreatureActionsTab.vue';
  import CreatureTraitsTab from './tabs/CreatureTraitsTab.vue';
  import {
    applyPersistedCreatureSettings,
    mergeCreatureSettingsIntoDraft,
  } from './utils/applyPersistedCreatureSettings';

  interface Props {
    open: boolean;
    creatureId?: string;
    worldId?: string;
    creatures?: DnDCreature[];
    socket?: TypedWebSocketClient | null;
    zIndex?: number;
    modalId?: string;
    isAdmin?: boolean;
    savedPosition?: { x: number; y: number };
    savedSize?: { width: number; height: number };
    /** Данные существа из компендиума (режим только просмотр) */
    initialData?: {
      id: string;
      name: string;
      description?: string;
      system: DnDCreature['system'];
      nameEn?: string;
      header?: string;
      token?: DnDCreature['token'];
      spells?: Spell[];
      equipment?: DnDCreature['equipment'];
      activeEffects?: DnDCreature['activeEffects'];
      [key: string]: unknown;
    };
    /**
     * Лист правит не существо мира, а черновик: каждое сохранение уходит сюда,
     * а в мир не пишется ничего. Так правят запись существа в своём
     * компендиуме: `initialData` — запись (у новой её нет), `creatureId` и
     * `creatures` не задаются.
     */
    draftSave?: (creature: DnDCreature) => void;
  }

  const props = defineProps<Props>();

  const worldStore = useWorldStore();

  /**
   * Режим только просмотр (компендиум, без сокета). Черновик своего
   * компендиума — не просмотр: его правят, просто сохранение идёт в `draftSave`.
   */
  const isReadOnly = computed(
    () =>
      !props.socket
      || (!props.creatures && !!props.initialData && !props.draftSave),
  );

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'update:creature': [creature: DnDCreature];
    'save': [creature: DnDCreature];
    'close': [];
    'bring-to-front': [];
  }>();

  const toast = useToast();
  const { updateModalProps, openModal } = useModalManager();

  // Состояние
  const isEditMode = ref(false);

  /**
   * Оформление блоков левой колонки. Правило общее с листом персонажа: в правке
   * рамка горит цветом настройки, а настраиваемый блок нажимается целиком.
   * Цвет свой только у защит — тот же, что у значков внутри блока, иначе
   * уязвимость, сопротивление и иммунитет перестали бы различаться с одного
   * взгляда.
   */
  const blockClasses = computed(() => {
    const editMode = isEditMode.value;

    return {
      /** Блок без своего нажатия: настройка живёт в шестерёнке или её нет */
      plain: getSheetBlockClass({ isEditMode: editMode }),
      /** Блок, который в правке открывает своё окно нажатием целиком */
      editable: getSheetBlockClass({
        isEditMode: editMode,
        isClickable: editMode,
      }),
      vulnerabilities: getSheetBlockClass({
        isEditMode: editMode,
        isClickable: editMode,
        accent: 'error',
      }),
      resistances: getSheetBlockClass({
        isEditMode: editMode,
        isClickable: editMode,
        accent: 'info',
      }),
      immunities: getSheetBlockClass({
        isEditMode: editMode,
        isClickable: editMode,
        accent: 'warning',
      }),
      environments: getSheetBlockClass({
        isEditMode: editMode,
        isClickable: editMode,
        accent: 'success',
      }),
    };
  });

  const localCreature = ref<DnDCreature | null>(null);
  const savedSnapshot = ref<DnDCreature | null>(null);
  const isDirty = ref(false);
  const isSaving = ref(false);
  const isCreated = ref(false);

  /**
   * Лист создаёт новое существо, а не правит готовое. Черновик записи
   * компендиума с данными (`initialData`) — уже готовое существо, хотя
   * идентификатора мира у него нет.
   */
  const isCreating = computed(
    () =>
      !props.creatureId
      && !isCreated.value
      && !(props.draftSave && props.initialData),
  );

  /** Актуальное существо из хоста: локальный черновик не определяет права. */
  const storeCreature = computed(() => {
    if (!props.creatureId || !props.creatures) {
      return null;
    }

    return props.creatures.find((entry) => entry.id === props.creatureId);
  });

  const isOwner = computed(() => {
    const userId = worldStore.connectionState.loggedAsUserId;

    return isEntityOwner(
      props.creatureId ? storeCreature.value : localCreature.value,
      userId,
    );
  });

  /** Может ли пользователь управлять существом (ГМ или владелец) */
  const canControl = computed(() => Boolean(props.isAdmin) || isOwner.value);

  /** Текущий мир существа (источник пользователей и порта файлового менеджера) */
  const currentWorld = computed(() =>
    props.worldId ? worldStore.getWorldById(props.worldId) : null,
  );

  /** Список пользователей мира для выбора владельца в настройках */
  const worldUsers = computed(() => currentWorld.value?.users ?? []);

  /** Порт сервера мира — нужен файловому менеджеру (AssetBrowser) в настройках */
  const worldPort = computed(() => currentWorld.value?.port);

  // Модалка подтверждения
  const isConfirmOpen = ref(false);
  const pendingAction = ref<'close' | null>(null);

  // Раскладку выбирает ширина самого листа, а не экрана: окно листа сужают и
  // на большом экране, и тогда он обязан перестроиться так же, как на телефоне.
  const sheetBodyRef = useTemplateRef<HTMLElement>('sheetBody');

  const { isMeasured, isWide } = useSheetLayout(
    sheetBodyRef,
    CREATURE_SHEET_WIDE_MIN_WIDTH_REM,
  );

  const [DefineSummary, ReuseSummary] = createReusableTemplate();

  /** Классы раскладки листа: колонками на широком, столбцом на узком */
  const sheetLayoutClasses = computed(() =>
    isWide.value
      ? CREATURE_SHEET_LAYOUT_CLASSES.wide
      : CREATURE_SHEET_LAYOUT_CLASSES.compact,
  );

  const sheetFrameClass = computed(() =>
    isWide.value ? SHEET_FRAME_CLASSES.wide : SHEET_FRAME_CLASSES.compact,
  );

  // Вкладки: «Основное» есть только у узкого листа — в ней живёт сводка
  const tabs = computed<SheetTabEntry[]>(() => {
    const mainTabs = isWide.value
      ? []
      : [{ id: SHEET_MAIN_TAB_ID, label: SHEET_TABS_LABELS.main }];

    return [
      ...mainTabs,
      { id: 'actions', label: CREATURE_SHEET_LABELS.tabActions },
      { id: 'equipment', label: CREATURE_SHEET_LABELS.tabEquipment },
      { id: 'traits', label: GRANT_SECTION_LABELS.features },
      { id: 'spells', label: GRANT_SECTION_LABELS.spells },
      { id: 'effects', label: FORM_TAB_LABELS.effects },
      { id: 'description', label: FORM_FIELD_LABELS.description },
    ];
  });

  /** Вкладка, выбранная пользователем или листом; `null` — ещё не выбирали */
  const pickedTab = ref<string | null>(null);

  /**
   * Показанная вкладка. Пока её не выбирали, узкий лист открывается на
   * «Основном», а широкий — на действиях. Выбранное «Основное» на широком
   * листе показать негде, и там встают действия — сам выбор не затирается и
   * вернётся, когда окно снова сузят.
   */
  const activeTab = computed<string>({
    get: () => {
      if (pickedTab.value === null) {
        return isWide.value ? CREATURE_SHEET_DEFAULT_TAB_ID : SHEET_MAIN_TAB_ID;
      }

      if (pickedTab.value === SHEET_MAIN_TAB_ID && isWide.value) {
        return CREATURE_SHEET_DEFAULT_TAB_ID;
      }

      return pickedTab.value;
    },
    set: (tabId) => {
      pickedTab.value = tabId;
    },
  });

  const { resolvedStats, combinedEffects } = useResolvedStats(
    toRef(() => localCreature.value),
  );

  const { receiveTransferredItem } = useItemTransfer();

  const isDiceRollOpen = ref(false);

  /** Настройка окна броска: собирается перед каждым открытием */
  interface DiceRollConfig {
    modifier: number;
    title: string;
    rollLabel: string;
    rollButtonText: string;
    initialRollMode: AttackRollMode;
    evaluateBonusRollFormulas?: RollBonusEvaluator;
  }

  const diceRollConfig = ref<DiceRollConfig>({
    modifier: 0,
    title: '',
    rollLabel: '',
    rollButtonText: DICE_ROLL_DEFAULT_BUTTON,
    initialRollMode: 'normal',
  });

  /**
   * Открывает окно броска кубиков.
   *
   * @param config - настройка броска
   * @param config.modifier - модификатор броска
   * @param config.title - заголовок окна
   * @param config.rollLabel - подпись броска
   * @param config.rollButtonText - надпись на кнопке броска
   * @param config.initialRollMode - режим броска при открытии окна
   */
  function openDiceRoll(
    config: Partial<DiceRollConfig>
      & Pick<DiceRollConfig, 'modifier' | 'title' | 'rollLabel'>,
  ): void {
    diceRollConfig.value = {
      ...config,
      rollButtonText: config.rollButtonText ?? DICE_ROLL_DEFAULT_BUTTON,
      initialRollMode: config.initialRollMode ?? 'normal',
    };

    isDiceRollOpen.value = true;
  }

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Инициализирует данные существа: загружает существующее или создаёт новое
   */
  function initializeCreature() {
    // Режим компендиума — берём данные из initialData
    if (props.initialData) {
      const creature: DnDCreature = {
        entityType: 'creature',
        id: props.initialData.id,
        name: props.initialData.name,
        system: props.initialData.system,
        description: props.initialData.description,
        nameEn: props.initialData.nameEn,
        header: props.initialData.header,
        token: props.initialData.token,
        spells: props.initialData.spells,
        equipment: props.initialData.equipment,
        activeEffects: props.initialData.activeEffects,
      };

      const draft: BaseCreature = JSON.parse(JSON.stringify(creature));

      normalizeCreature(draft);

      // Гвард — постусловие миграции: после неё форма собрана целиком
      if (isDndCreature(draft)) {
        localCreature.value = draft;
        isEditMode.value = false;
        isDirty.value = false;
      } else {
        console.error(CREATURE_SHEET_LOG_PREFIX, props.initialData.id);
      }

      return;
    }

    if (props.creatureId && props.creatures) {
      const creature = props.creatures.find(
        (entry) => entry.id === props.creatureId,
      );

      if (creature) {
        const draft: BaseCreature = JSON.parse(JSON.stringify(creature));

        normalizeCreature(draft);

        // Гвард — постусловие миграции: после неё форма собрана целиком
        if (isDndCreature(draft)) {
          localCreature.value = draft;
          isEditMode.value = false;
        } else {
          console.error(CREATURE_SHEET_LOG_PREFIX, props.creatureId);
        }
      } else {
        console.error(
          '[CreatureSheet] Creature not found with id:',
          props.creatureId,
        );
      }
    } else if (!props.creatureId) {
      const newId = generateEntityId('creature');

      const newCreature: DnDCreature = JSON.parse(
        JSON.stringify({ ...DEFAULT_CREATURE, id: newId }),
      );

      localCreature.value = newCreature;
      isEditMode.value = true;
    }

    isDirty.value = false;
  }

  // Автоматическое обновление бонуса мастерства при смене CR
  const proficiencyBonusFromCr = computed(() => {
    if (!localCreature.value) {
      return 2;
    }

    const crEntry = CR_TABLE.find(
      (entry) => entry.cr === localCreature.value?.system.challengeRating,
    );

    return crEntry?.proficiencyBonus ?? 2;
  });

  watch(proficiencyBonusFromCr, (newBonus) => {
    if (localCreature.value && isEditMode.value) {
      localCreature.value.system.proficiencyBonus = newBonus;
      isDirty.value = true;
      handleImmediateSave();
    }
  });

  watch(
    () => storeCreature.value,
    (newCreature, oldCreature) => {
      // Если существо было удалено
      if (oldCreature && !newCreature) {
        isOpen.value = false;
        emit('close');
      }

      // Если localCreature был null (открыли с пустым creatures), инициализируем сейчас
      if (newCreature && !localCreature.value) {
        initializeCreature();
      }
    },
  );

  /**
   * Синхронизация token из store в localCreature.
   * Позволяет обновлять визуал/зрение, если они были изменены через настройки токена.
   */
  watch(
    () => storeCreature.value?.token,
    (newToken) => {
      if (localCreature.value && newToken && !isEditMode.value) {
        localCreature.value.token = JSON.parse(JSON.stringify(newToken));
      }
    },
    { deep: true },
  );

  /**
   * Разделы, которые система пишет в мир во время игры (ресурсы листа,
   * предметы, заклинания, эффекты, хиты), подтягиваются из стора в
   * localCreature — тем же помощником, что у листа персонажа. Пока лист
   * открыт, их меняют снаружи: каст списывает заряд «N/день», бой накладывает
   * и снимает эффекты, передача предмета правит инвентарь. Без этого лист
   * показывал бы прежнее, а следующая его правка отправила бы на сервер
   * устаревший раздел и затёрла бы списанное.
   */
  const { pullFromWorld } = useWorldSheetSync({
    readWorld: () => storeCreature.value,
    draft: localCreature,
    isPaused: () => isEditMode.value,
  });

  // Пока лист в правке, существо не действует ни с листа, ни с панелей.
  // Отметка — на id черновика, как у листа персонажа: с ним действуют блоки
  // листа, а у нового, ещё не сохранённого существа `props.creatureId` пуст
  useSheetEditLock(
    () => localCreature.value?.id,
    () => isEditMode.value,
  );

  /**
   * Что уходит на сервер по «Сохранить». Черновик правки сливается с миром:
   * правки владельца — из черновика, всё, что он не трогал, — из мира. Иначе
   * сохранение вернуло бы то, что мир изменил за время правки (урон, снятый
   * эффект, списанный заряд).
   *
   * @param draft - черновик листа
   * @returns существо для записи
   */
  function resolveCreatureToSave(draft: DnDCreature): DnDCreature {
    const world = storeCreature.value;

    return isEditMode.value && savedSnapshot.value && world
      ? mergeEntityDraft(savedSnapshot.value, draft, world, isDndCreatureRecord)
      : draft;
  }

  function handleImmediateSave() {
    if (
      isEditMode.value
      || !localCreature.value
      || !isDirty.value
      || !canControl.value
    ) {
      return;
    }

    emit('update:creature', localCreature.value);

    if (props.draftSave) {
      props.draftSave(JSON.parse(JSON.stringify(localCreature.value)));
    } else if (props.socket && props.creatureId) {
      props.socket.emit(
        'creature:updated',
        withoutEntityOwnership(localCreature.value),
      );
    }

    savedSnapshot.value = JSON.parse(JSON.stringify(localCreature.value));
    isDirty.value = false;
  }

  function handleCreatureUpdate(updates: Partial<DnDCreature>) {
    if (localCreature.value) {
      Object.assign(localCreature.value, updates);
      isDirty.value = true;
      handleImmediateSave();
    }
  }

  /** Текущая степень Истощения — её несёт эффект-состояние */
  const exhaustionLevel = computed(() =>
    getEntityExhaustionLevel(localCreature.value?.activeEffects),
  );

  /**
   * Ставит степень Истощения: движок пересобирает эффект со штрафами этой
   * степени, нулевая — снимает состояние.
   *
   * @param level - выбранная степень (0–6)
   */
  function handleExhaustionSelect(level: number): void {
    if (!localCreature.value) {
      return;
    }

    handleCreatureUpdate({
      activeEffects: withExhaustionLevel(
        localCreature.value.activeEffects ?? [],
        level,
      ),
    });
  }

  /**
   * Обновляет Markdown-описание существа.
   * @param description - новое описание существа
   */
  function handleCreatureDescriptionUpdate(description: string): void {
    handleCreatureUpdate({ description });
  }

  /**
   * Пересобирает хиты по правилам после правки размера или Телосложения.
   * Движок отдаёт тот же объект, когда менять нечего, а у существа без блока
   * хитов (запись старого мира или компендиума) — ничего: тогда запись не
   * трогается, и смена размера не спотыкается об отсутствующую формулу.
   */
  function syncHitPointsWithRules(): void {
    if (!localCreature.value) {
      return;
    }

    const ruledHitPoints = resolveCreatureHitPointsByRules(localCreature.value);

    if (ruledHitPoints) {
      localCreature.value.system.hitPoints = ruledHitPoints;
    }
  }

  function handleSystemUpdate(updates: Partial<DnDCreature['system']>) {
    if (localCreature.value) {
      Object.assign(localCreature.value.system, updates);

      // Размер существа и масштаб его токена — одна величина. Без этой
      // синхронизации выбранный «Огромный» остаётся токеном 1×1 на сцене, а
      // сохранение настроек токена возвращает размер обратно в «Средний»
      // (там size выводится из scale через TOKEN_SCALE_TO_CREATURE_SIZE).
      if (updates.size) {
        localCreature.value.token = {
          ...localCreature.value.token,
          scale: CREATURE_SIZE_TO_TOKEN_SCALE[updates.size],
        };
      }

      // Формула хитов — производная от размера и Телосложения (D&D 2024):
      // Большое существо с Тел. 16 не может жить с «2к8 + 2» из заготовки
      if (
        CREATURE_HIT_DICE_RULE_KEYS.some((key) => updates[key] !== undefined)
      ) {
        syncHitPointsWithRules();
      }

      isDirty.value = true;
      handleImmediateSave();
    }
  }

  const isLanguagesOpen = ref(false);

  function onLanguagesApply(selected: string[]) {
    if (localCreature.value) {
      localCreature.value.system.languages = selected;
      isDirty.value = true;
      handleImmediateSave();
    }
  }

  const isEnvironmentsOpen = ref(false);

  function onEnvironmentsApply(
    environments: string[],
    customEnvironments: string,
  ) {
    if (localCreature.value) {
      localCreature.value.system.environments = environments;
      localCreature.value.system.customEnvironments = customEnvironments;
      isDirty.value = true;
      handleImmediateSave();
    }
  }

  const isSkillsOpen = ref(false);

  const isDefensesOpen = ref(false);

  const systemDataStore = useSystemDataStore();

  /**
   * Карта ключей защит → локализованные названия (кэшируется через computed)
   */
  const defenseLabelMap = computed(() => {
    const labelMap: Record<string, string> = {
      // Ключи физического пробивания
      'bypass-adamantine': CREATURE_SHEET_LABELS.bypassAdamantine,
      'bypass-magical': CREATURE_SHEET_LABELS.bypassMagical,
      'bypass-silvered': CREATURE_SHEET_LABELS.bypassSilvered,
    };

    for (const dt of systemDataStore.damageTypes) {
      labelMap[dt.key] = dt.name;
    }

    for (const condition of listConditions()) {
      labelMap[condition.key] = condition.nameRu;
    }

    return labelMap;
  });

  /**
   * Получает локализованное название типа урона/модификатора
   */
  function getDefenseLabel(key: string): string {
    return defenseLabelMap.value[key] || key;
  }

  const activeDefenseCategory = ref<
    'vulnerabilities' | 'resistances' | 'immunities'
  >('vulnerabilities');

  function onDefensesApply(
    category: 'vulnerabilities' | 'resistances' | 'immunities',
    selected: string[],
  ): void {
    if (localCreature.value) {
      localCreature.value.system.defenses[category] = selected;
      isDirty.value = true;
      handleImmediateSave();
    }
  }

  const isConditionImmunitiesOpen = ref(false);

  function onConditionImmunitiesApply(selected: string[]): void {
    if (localCreature.value) {
      localCreature.value.system.defenses.conditionImmunities = selected;
      isDirty.value = true;
      handleImmediateSave();
    }
  }

  function openDefensesModal(
    category: 'vulnerabilities' | 'resistances' | 'immunities',
  ): void {
    if (isEditMode.value) {
      activeDefenseCategory.value = category;
      isDefensesOpen.value = true;
    }
  }

  /**
   * Открывает окно иммунитета к состояниям — только в правке, как и остальные
   * блоки защит: вне её блок ничего не настраивает и нажатия не ждёт.
   */
  function openConditionImmunitiesModal(): void {
    if (isEditMode.value) {
      isConditionImmunitiesOpen.value = true;
    }
  }

  /**
   * Применяет владения и настройку навыков: их правят одним окном и одной
   * таблицей, поэтому и приходят они вместе.
   *
   * @param payload - настройка из окна
   * @param payload.skills - уровни владения навыками правил
   * @param payload.settings - поправки расчёта и свои навыки
   */
  function onSkillsApply(payload: {
    skills: Partial<Record<SkillType, ProficiencyLevel>>;
    settings: DnDSkillSettings;
  }) {
    handleSystemUpdate({
      skills: payload.skills,
      skillSettings: payload.settings,
    });
  }

  /**
   * Уровень владения навыком. Записи существа держат владения на корне
   * системы, а не в блоке владений, как у листа персонажа.
   *
   * @param key - ключ навыка
   * @returns уровень владения
   */
  function getSkillProficiency(key: SkillType): ProficiencyLevel {
    const rawLevel = localCreature.value?.system.skills[key];

    return isProficiencyLevel(rawLevel) ? rawLevel : 'none';
  }

  /**
   * Модификаторы характеристик существа — по ним считаются свои навыки,
   * спасброски и запасной расчёт навыков правил.
   *
   * Берутся из разрешённых статов: там уже учтены активные эффекты и свои
   * бонусы к самим характеристикам. Пока статы не сошлись — расчёт по записи,
   * иначе числа мигали бы нулями.
   */
  const skillAbilityMods = computed<Record<AbilityType, number>>(
    () =>
      resolvedStats.value?.abilityMods
      ?? getActorAbilityModifiers(localCreature.value),
  );

  /**
   * Бонус мастерства существа: по опасности, с поправками своей настройки и с
   * учётом активных эффектов. Считать его нужно именно так везде — числа в
   * навыках, спасбросках и заклинательстве идут от него.
   */
  const creatureProficiencyBonus = computed(() =>
    localCreature.value
      ? getCreatureProficiencyBonus(localCreature.value, resolvedStats.value)
      : DEFAULT_PROFICIENCY_BONUS,
  );

  /** Числа листа, от которых считается вклад своих бонусов */
  const bonusContext = computed<DnDCustomBonusContext>(() => ({
    abilityMods: skillAbilityMods.value,
    proficiencyBonus: creatureProficiencyBonus.value,
  }));

  /**
   * Числа листа для формулы хитов: модификаторы по записи листа со своими
   * бонусами, но без активных эффектов — формула описывает стат-блок, а
   * эффект временно двигает итог поверх него.
   */
  const hitDiceBonusContext = computed<DnDCustomBonusContext | null>(() =>
    localCreature.value
      ? getCreatureHitDiceBonusContext(localCreature.value)
      : null,
  );

  /**
   * Поля, чей итог задан активным эффектом целиком. Окно настройки берёт
   * отсюда навыки под перезаписью: их число задаёт эффект, а не расчёт.
   */
  const overriddenSkillKeys = computed(
    () => resolvedStats.value?.overriddenKeys ?? new Set<string>(),
  );

  /** Навык существа бейджем: и подпись, и всё, чем катится его проверка */
  interface CreatureSkillBadge {
    /** Ключ списка: у навыка правил — его ключ, у своего — id записи */
    id: string;
    /** Подпись бейджа: название и значение со знаком */
    label: string;
    /** Название навыка: им подписан бросок */
    name: string;
    /** Итог навыка — он же модификатор броска */
    modifier: number;
    /** Характеристика расчёта: по ней читаются флаги проверки */
    ability: AbilityType;
    /** Ключ навыка правил; не задан — навык заведён вручную */
    key?: SkillType;
  }

  /**
   * Навыки существа для показа бейджами: только те, которыми оно владеет, и
   * все заведённые вручную — их в правилах нет, и отмечать их владением
   * незачем. Значение берётся из разрешённых статов: там уже учтены и поправки
   * расчёта, и активные эффекты.
   */
  const skillBadges = computed<CreatureSkillBadge[]>(() => {
    const creature = localCreature.value;

    if (!creature) {
      return [];
    }

    const settings = creature.system.skillSettings;
    const mods = skillAbilityMods.value;
    const profBonus = creatureProficiencyBonus.value;
    const result: CreatureSkillBadge[] = [];

    for (const skill of SKILLS_LIST) {
      const level = getSkillProficiency(skill.key);

      if (level === 'none') {
        continue;
      }

      const setting = getSkillSetting(settings, skill.key);
      const ability = getSkillSettingAbility(setting, skill.key);

      const fallback =
        mods[ability]
        + getProficiencyContribution(profBonus, level)
        + getCustomBonusesValue(bonusContext.value, setting.bonuses);

      const total = resolvedStats.value?.skills[skill.key] ?? fallback;

      result.push({
        id: skill.key,
        label: `${skill.label} ${formatSignedNumber(total)}`,
        name: skill.label,
        modifier: total,
        ability,
        key: skill.key,
      });
    }

    for (const skill of settings?.custom ?? []) {
      const total = getCustomSkillValue(bonusContext.value, skill);

      result.push({
        id: skill.id,
        label: `${skill.name} ${formatSignedNumber(total)}`,
        name: skill.name,
        modifier: total,
        ability: skill.ability,
      });
    }

    return result.sort((first, second) =>
      first.name.localeCompare(second.name),
    );
  });

  /**
   * Нажатие по бейджу навыка: вне правки катит проверку этого навыка — тем же
   * окном, что и проверка характеристики. В правке бейдж ведёт в настройку
   * навыков, как и нажатие по самому блоку: там числа правят, а не бросают.
   *
   * @param badge - навык бейджа
   */
  function handleSkillBadgeClick(badge: CreatureSkillBadge): void {
    if (isEditMode.value) {
      openSkillsModal();

      return;
    }

    openDiceRoll({
      modifier: badge.modifier,
      evaluateBonusRollFormulas: buildRollBonusEvaluator(
        () => localCreature.value ?? undefined,
        getSkillCheckBonusKeys(badge.key),
      ),
      title: `${ABILITY_CHECK_ROLL_LABELS.titlePrefix}${badge.name}`,
      rollLabel: `${ABILITY_CHECK_ROLL_LABELS.rollPrefix}${badge.name}`,
      rollButtonText: ABILITY_CHECK_ROLL_LABELS.button,
      initialRollMode: resolveAbilityCheckRollMode({
        flags: resolvedStats.value?.activeFlags ?? new Set(),
        ability: badge.ability,
        skill: badge.key,
      }),
    });
  }

  /**
   * Какие блоки левой колонки показывать.
   *
   * В просмотре пустые прячутся: в статблоке 2024-й строку «Уязвимости — нет»
   * не пишут, и лист без семи прочерков читается как книга, а не как форма.
   * В правке видны все — иначе пустой блок нечем было бы заполнить.
   *
   * Спасброски и чувства сюда не входят намеренно: они пустыми не бывают —
   * шесть спасбросков и пассивная Внимательность есть у любого существа.
   */
  const visibleBlocks = computed(() => {
    const system = localCreature.value?.system;
    const defenses = system?.defenses;
    const isEditing = isEditMode.value;

    return {
      exhaustion: isEditing || exhaustionLevel.value > 0,
      vulnerabilities:
        isEditing
        || Boolean(defenses?.vulnerabilities.length)
        || Boolean(defenses?.vulnerabilitiesText),
      resistances:
        isEditing
        || Boolean(defenses?.resistances.length)
        || Boolean(defenses?.resistancesText),
      immunities:
        isEditing
        || Boolean(defenses?.immunities.length)
        || Boolean(defenses?.immunitiesText),
      conditionImmunities:
        isEditing || Boolean(defenses?.conditionImmunities.length),
      skills: isEditing || skillBadges.value.length > 0,
      languages: isEditing || Boolean(system?.languages?.length),
      environments:
        isEditing
        || Boolean(system?.environments?.length)
        || Boolean(system?.customEnvironments),
    };
  });

  function openSettings() {
    openModal('CreatureSettingsModal', {
      creatureId: props.creatureId,
      creatureData: localCreature.value,
      onPersistedSave: (updates: Partial<DnDCreature>) => {
        if (localCreature.value) {
          localCreature.value = mergeCreatureSettingsIntoDraft(
            localCreature.value,
            updates,
          );

          // Отмена основной формы откатывает только её черновик, а не уже сохранённые настройки.
          if (savedSnapshot.value) {
            savedSnapshot.value = applyPersistedCreatureSettings(
              savedSnapshot.value,
              updates,
            );
          }
        }
      },
      onSave: (updates: Partial<DnDCreature>) => {
        if (localCreature.value) {
          const previousSize = localCreature.value.system.size;

          Object.assign(localCreature.value, updates);

          // Настройки токена меняют размер существа через масштаб — в обход
          // `handleSystemUpdate`, и формула хитов обязана сойтись и здесь
          if (localCreature.value.system.size !== previousSize) {
            syncHitPointsWithRules();
          }

          isDirty.value = true;
          handleImmediateSave();
        }
      },
      isAdmin: props.isAdmin,
      users: worldUsers.value,
      worldId: props.worldId,
      worldPort: worldPort.value,
      socket: props.socket,
      zIndex: (props.zIndex || 10000) + 10,
    });
  }

  function toggleEditMode() {
    if (!isEditMode.value) {
      if (localCreature.value) {
        savedSnapshot.value = JSON.parse(JSON.stringify(localCreature.value));
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

  function handleSave() {
    if (!localCreature.value || isSaving.value || !canControl.value) {
      return;
    }

    if (!localCreature.value.name || localCreature.value.name.trim() === '') {
      toast.add({
        title: CREATURE_SHEET_LABELS.validationErrorTitle,
        description: CREATURE_SHEET_LABELS.validationNameRequired,
        color: 'error',
      });

      return;
    }

    isSaving.value = true;

    try {
      requireSocket(props.socket);

      const wasCreating = isCreating.value;

      if (props.draftSave) {
        props.draftSave(JSON.parse(JSON.stringify(localCreature.value)));
        isCreated.value = true;
      } else if (props.creatureId) {
        const saved = resolveCreatureToSave(localCreature.value);

        localCreature.value = saved;
        props.socket!.emit('creature:updated', withoutEntityOwnership(saved));
      } else {
        const cleanCreature = JSON.parse(JSON.stringify(localCreature.value));

        props.socket!.emit('creature:created', cleanCreature);
        emit('save', cleanCreature);
        isCreated.value = true;

        if (props.modalId) {
          updateModalProps(props.modalId, { creatureId: cleanCreature.id });
        }
      }

      toast.add({
        title: CREATURE_SHEET_LABELS.savedTitle,
        description: wasCreating
          ? CREATURE_SHEET_LABELS.savedCreated
          : CREATURE_SHEET_LABELS.savedUpdated,
        color: 'success',
      });

      isDirty.value = false;
      savedSnapshot.value = null;
      isEditMode.value = false;
    } catch (error) {
      console.error('Failed to save creature:', error);

      toast.add({
        title: CREATURE_SHEET_LABELS.saveErrorTitle,
        description:
          error instanceof Error
            ? error.message
            : CREATURE_SHEET_LABELS.saveErrorText,
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
    () => localCreature.value?.name,
    CREATURE_SHEET_LABELS.untitled,
  );

  /**
   * Закрытие, пришедшее ОТ окна, а не от крестика в шапке листа: кнопка закрытия
   * на шторке свёрнутого листа. Такое закрытие минует `handleCancel`, а с ним и
   * вопрос о несохранённых правках, — поэтому заворачиваем его туда же.
   *
   * Окно шлёт это событие только чтобы закрыться (`update:open` всегда `false`),
   * поэтому значение не проверяем. Выход из мира приходит сюда же, но лист он
   * снимает не событием, а вычисткой реестра окон — вопрос показать не успеет.
   */
  function handleModalClose(): void {
    handleCancel();
  }

  function onConfirmCancel() {
    isConfirmOpen.value = false;
    pendingAction.value = null;
  }

  function onConfirmSave() {
    isConfirmOpen.value = false;
    pendingAction.value = null;
    handleSave();
    isOpen.value = false;
  }

  function onConfirmDiscard() {
    isConfirmOpen.value = false;
    pendingAction.value = null;

    if (savedSnapshot.value) {
      localCreature.value = JSON.parse(JSON.stringify(savedSnapshot.value));
    }

    isDirty.value = false;
    isOpen.value = false;
  }

  watch(
    () => props.open,
    (newOpen) => {
      if (newOpen) {
        initializeCreature();
      }
    },
    { immediate: true },
  );

  function handleLegendaryActionsUpdate(
    legendaryActions: DnDCreature['system']['legendary']['actions'],
  ) {
    if (!localCreature.value) {
      return;
    }

    handleSystemUpdate({
      legendary: {
        ...localCreature.value.system.legendary,
        actions: legendaryActions,
      },
    });
  }

  function handleLegendaryCountUpdate(count: number) {
    if (!localCreature.value) {
      return;
    }

    handleSystemUpdate({
      legendary: { ...localCreature.value.system.legendary, count },
    });
  }

  function handleActionsUpdate(
    actions: DnDCreature['system']['actions'],
  ): void {
    handleSystemUpdate({ actions });
  }

  function handleBonusActionsUpdate(
    bonusActions: DnDCreature['system']['bonusActions'],
  ): void {
    handleSystemUpdate({ bonusActions });
  }

  function handleReactionsUpdate(
    reactions: DnDCreature['system']['reactions'],
  ): void {
    handleSystemUpdate({ reactions });
  }

  function handleTraitsUpdate(traits: DnDCreature['system']['traits']): void {
    handleSystemUpdate({ traits });
  }

  /**
   * Обновляет заклинания существа вместе с их раскладкой по блокам.
   *
   * Одним обработчиком, а не двумя: правка почти всегда задевает и список, и
   * блоки (заклинание кладут в группу, режим группы меняет его заряды), а
   * двумя вызовами лист сохранялся бы дважды подряд.
   *
   * @param value - заклинания и блоки существа
   */
  function handleSpellbookUpdate(value: {
    spells: NonNullable<DnDCreature['spells']>;
    blocks: NonNullable<DnDCreature['system']['spellcastingBlocks']>;
  }): void {
    if (!localCreature.value) {
      return;
    }

    localCreature.value.spells = value.spells;
    localCreature.value.system.spellcastingBlocks = value.blocks;

    isDirty.value = true;
    handleImmediateSave();
  }

  /**
   * Применяет отдых к существу: восстанавливает заряды заклинаний (долгий
   * отдых — также хиты), выполняет срабатывания «после отдыха» по ответам
   * владельца, затем сохраняет.
   * @param restType - тип отдыха
   * @param triggerOptions - ответы владельца и сбор сводки срабатываний
   */
  function finishRest(
    restType: RestType,
    triggerOptions: RestTriggerOptions,
  ): void {
    // Лист перечитывается: пока владелец отвечал на вопросы, он мог измениться
    if (!localCreature.value) {
      return;
    }

    handleCreatureUpdate(
      applyCreatureRest(localCreature.value, restType, triggerOptions),
    );

    toast.add({
      title: restType === 'long' ? REST_LABELS.long : REST_LABELS.short,
      description:
        restType === 'long'
          ? CREATURE_SHEET_LABELS.longRestDone
          : CREATURE_SHEET_LABELS.shortRestDone,
      color: 'success',
    });
  }

  /**
   * Отдых существа: сперва владельца спрашивают о срабатываниях «после
   * отдыха» с ценой или согласием, затем идёт сам отдых.
   * @param restType - тип отдыха
   */
  function handleRest(restType: RestType): void {
    // Отдых в режиме правки ждёт «Сохранить» или отмены, как и действия
    if (refuseWhileSheetEditing(localCreature.value?.id)) {
      return;
    }

    if (!localCreature.value) {
      return;
    }

    void runRestWithTriggers(
      localCreature.value,
      restType,
      {},
      (triggerOptions) => finishRest(restType, triggerOptions),
    );
  }

  /** Тащат ли на лист предмет — для подсветки зоны приёма во вкладке */
  const isItemDragOver = ref(false);

  /**
   * Отложенное гашение подсветки. `dragleave` срабатывает и при переходе между
   * вложенными элементами листа, поэтому подсветку гасит не он, а пауза без
   * единого `dragover`: каждое движение мыши над листом отодвигает её заново.
   * Тот же приём, что на листе персонажа.
   */
  let itemDragLeaveTimeout: number | undefined;

  /**
   * Разрешает перетаскивание заклинания или предмета из панели «Предметы» и
   * компендиума на лист существа.
   * @param event - событие dragover
   */
  function handleSheetDragOver(event: DragEvent): void {
    if (isReadOnly.value || !event.dataTransfer) {
      return;
    }

    const types = event.dataTransfer.types;

    const hasItem =
      types.includes(GAME_ITEM_MIME) || types.includes(GAME_ITEM_TRANSFER_MIME);

    if (!types.includes(SPELL_MIME) && !hasItem) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';

    if (hasItem) {
      isItemDragOver.value = true;
    }

    window.clearTimeout(itemDragLeaveTimeout);

    itemDragLeaveTimeout = window.setTimeout(() => {
      isItemDragOver.value = false;
    }, DRAG_OVER_RESET_DELAY_MS);
  }

  /** Гасит подсветку зоны приёма, когда предмет увели с листа */
  function handleSheetDragLeave(): void {
    isItemDragOver.value = false;
  }

  /**
   * Принимает предмет, переданный с другого листа: предмет уходит из инвентаря
   * отправителя и появляется здесь.
   *
   * Отправителя обновляет композабл переноса — его лист может быть закрыт.
   * Сюда возвращается только новый инвентарь получателя, и он сохраняется
   * обычным путём листа.
   *
   * @param event - событие drop
   * @returns `true`, если нагрузка была передачей предмета — принята она или
   *   отброшена. `false` значит «это не передача», и лист идёт дальше по цепочке
   */
  function handleItemTransferDrop(event: DragEvent): boolean {
    // В режиме правки жест не принимается: у отправителя предмет уходит сразу и
    // на сервер, а здесь правки копятся до «Сохранить» — «Отмена» стёрла бы
    // предмет уже после того, как его отдали, и он пропал бы у обоих
    // Черновик своего компендиума предмет не принимает: у отправителя он ушёл бы
    // из мира насовсем — в запись компендиума, а не к существу на столе
    if (!localCreature.value || props.draftSave) {
      return false;
    }

    // Причину говорим: молчаливый отказ выглядел поломкой жеста
    if (isEditMode.value) {
      return (
        isItemTransferDrop(event)
        && refuseWhileSheetEditing(localCreature.value.id)
      );
    }

    const received = receiveTransferredItem(
      event,
      localCreature.value,
      props.socket,
    );

    if (!received) {
      return false;
    }

    handleCreatureUpdate({ equipment: received.equipment });

    activeTab.value = 'equipment';

    toast.add({
      title: CREATURE_SHEET_LABELS.itemReceived,
      description: received.itemName,
      color: 'success',
    });

    return true;
  }

  /**
   * Добавляет перетащенный из панели «Предметы» или компендиума предмет в
   * инвентарь существа: новый идентификатор, снятая пометка «только чтение» и
   * снятая экипировка.
   *
   * Запись, которая уже лежит в этом мешке, игнорируется по идентификатору —
   * так гасится перетаскивание предмета из списка на тот же лист. Одинаковые
   * предметы из компендиума при этом кладутся сколько угодно раз: каждому
   * достаётся свой новый идентификатор, а два кинжала в мешке — нормальный
   * случай (для стопки есть счётчик количества в строке).
   *
   * @param event - событие drop
   * @returns `true`, если нагрузка была предметом — принят он или отброшен.
   *   `false` значит только «это не предмет», и лист идёт проверять заклинание
   */
  function handleCompendiumItemDrop(event: DragEvent): boolean {
    const itemPayload = event.dataTransfer?.getData(GAME_ITEM_MIME);

    if (!itemPayload || !localCreature.value) {
      return false;
    }

    event.preventDefault();

    try {
      const dropped: unknown = JSON.parse(itemPayload);

      // Испорченная нагрузка и предмет, уже лежащий в этом мешке, отбрасываются
      // молча: событие всё равно наше, и передавать его дальше нечего
      if (!isDnDGameItem(dropped)) {
        return true;
      }

      const current = localCreature.value.equipment ?? [];

      if (current.some((entry) => entry.id === dropped.id)) {
        return true;
      }

      const newItem = createInventoryItem(dropped);

      handleCreatureUpdate({ equipment: [...current, newItem] });

      activeTab.value = 'equipment';

      toast.add({
        title: CREATURE_SHEET_LABELS.itemAdded,
        description: dropped.name,
        color: 'success',
      });
    } catch (error) {
      console.error(CREATURE_SHEET_LABELS.itemDropFailed, error);
    }

    return true;
  }

  /**
   * Добавляет перетащенное заклинание в блок заклинательства существа
   * (новый id, дубликат по имени игнорируется).
   * @param event - событие drop
   */
  function handleSheetDrop(event: DragEvent): void {
    isItemDragOver.value = false;

    if (isReadOnly.value || !canControl.value || !localCreature.value) {
      return;
    }

    if (handleItemTransferDrop(event) || handleCompendiumItemDrop(event)) {
      return;
    }

    const spellPayload = event.dataTransfer?.getData(SPELL_MIME);

    if (!spellPayload) {
      return;
    }

    event.preventDefault();

    try {
      const dropped: unknown = JSON.parse(spellPayload);

      // Данные приезжают из события браузера: без проверки испорченная
      // нагрузка легла бы в запись существа и сломала бы его лист
      if (!isSpell(dropped)) {
        return;
      }

      const current = localCreature.value.spells ?? [];

      if (current.some((entry) => entry.name === dropped.name)) {
        return;
      }

      const newSpell: Spell = { ...dropped, id: generateId('spell') };

      const spells = [...current, newSpell];

      // Перетащенное заклинание сразу кладётся в группу: вне блока заклинание
      // существа не живёт — блок задаёт, чем оно колдует. Группа подбирается по
      // зарядам записи, а если блока нет — заводится вместе с ним
      handleSpellbookUpdate(
        syncCreatureSpellcastingUses(
          spells,
          ensureCreatureSpellsInBlocks(
            spells,
            localCreature.value.system.spellcastingBlocks ?? [],
          ),
        ),
      );

      activeTab.value = 'spells';

      toast.add({
        title: CREATURE_SHEET_LABELS.spellAdded,
        description: dropped.name,
        color: 'success',
      });
    } catch (error) {
      console.error(CREATURE_SHEET_LABELS.spellDropFailed, error);
    }
  }

  function openSkillsModal(): void {
    if (isEditMode.value) {
      isSkillsOpen.value = true;
    }
  }

  function openLanguagesModal(): void {
    if (isEditMode.value) {
      isLanguagesOpen.value = true;
    }
  }

  function openEnvironmentsModal(): void {
    if (isEditMode.value) {
      isEnvironmentsOpen.value = true;
    }
  }

  // ── Спасброски ──────────────────────────────────────────────────────────

  /** Спасброски существа как массив AbilityType[] */
  const creatureSavingThrows = computed((): AbilityType[] => {
    return localCreature.value?.system.savingThrows ?? [];
  });

  /**
   * Вычисляет модификатор спасброска для характеристики
   */
  function calculateSavingThrow(abilityKey: AbilityType): number {
    if (resolvedStats.value) {
      return resolvedStats.value.saves[abilityKey] ?? 0;
    }

    if (!localCreature.value) {
      return 0;
    }

    const abilityScore = localCreature.value.system.abilities[abilityKey] ?? 10;
    const abilityMod = calculateAbilityModifier(abilityScore);
    const hasProficiency = creatureSavingThrows.value.includes(abilityKey);

    const profBonus = hasProficiency ? creatureProficiencyBonus.value : 0;

    return abilityMod + profBonus;
  }

  /**
   * Пассивная Внимательность: основа плюс значение навыка. Значение берётся
   * оттуда же, откуда его берёт строка списка навыков, — расходиться числа в
   * двух местах листа не должны.
   */
  const passivePerception = computed(() => {
    if (!localCreature.value) {
      return PASSIVE_SKILL_BASE;
    }

    const fallback =
      calculateAbilityModifier(
        localCreature.value.system.abilities.wisdom ?? 10,
      )
      + getProficiencyContribution(
        creatureProficiencyBonus.value,
        getSkillProficiency('perception'),
      );

    return (
      PASSIVE_SKILL_BASE + (resolvedStats.value?.skills.perception ?? fallback)
    );
  });

  /**
   * Подпись дальности обычного зрения. Незаданные настройки зрения
   * равнозначны нулю — существо видит без ограничения по дистанции.
   */
  const creatureVisionRangeLabel = computed(() => {
    return formatVisionRange(localCreature.value?.token?.vision?.range ?? 0);
  });

  /**
   * Форматирует модификатор со знаком (+/-)
   */
  /**
   * Нажатие по строке спасброска: вне режима правки катит спасбросок — как на
   * листе персонажа. В режиме правки строка ничего не бросает: там её кружком
   * ставят владение.
   *
   * @param ability - характеристика спасброска
   */
  function handleSavingThrowClick(ability: {
    key: AbilityType;
    label: string;
  }): void {
    if (isEditMode.value) {
      return;
    }

    openDiceRoll({
      modifier: calculateSavingThrow(ability.key),
      evaluateBonusRollFormulas: buildRollBonusEvaluator(
        () => localCreature.value ?? undefined,
        `save.${ability.key}`,
      ),
      title: `${SAVING_THROW_ROLL_LABELS.titlePrefix}${ability.label}`,
      rollLabel: `${SAVING_THROW_ROLL_LABELS.rollPrefix}${ability.label}`,
      rollButtonText: SAVING_THROW_ROLL_LABELS.button,
    });
  }

  /**
   * Переключает владение спасброском для характеристики
   */
  const isSavingThrowSettingsOpen = ref(false);

  /** Открывает окно настройки спасбросков — только в правке */
  function openSavingThrowSettings(): void {
    if (isEditMode.value) {
      isSavingThrowSettingsOpen.value = true;
    }
  }

  /**
   * Применяет настройку спасбросков: владения и поправки расчёта приходят из
   * окна вместе — их правят там одной таблицей.
   *
   * @param payload - настройка из окна
   * @param payload.savingThrows - характеристики, спасбросками которых владеют
   * @param payload.settings - поправки расчёта спасбросков
   */
  function onSavingThrowSettingsApply(payload: {
    savingThrows: AbilityType[];
    settings: DnDSavingThrowSettings;
  }): void {
    handleSystemUpdate({
      savingThrows: payload.savingThrows,
      savingThrowSettings: payload.settings,
    });
  }

  function toggleSavingThrow(abilityKey: AbilityType): void {
    if (!isEditMode.value || !localCreature.value) {
      return;
    }

    const current = [...creatureSavingThrows.value];
    const index = current.indexOf(abilityKey);

    if (index > -1) {
      current.splice(index, 1);
    } else {
      current.push(abilityKey);
    }

    handleSystemUpdate({ savingThrows: current });
  }
</script>

<template>
  <!-- Сводка существа — боевой блок, защиты, спасброски, навыки, чувства,
    языки — нужна в двух местах: на широком листе она стоит левой колонкой, на
    узком уходит во вкладку «Основное». Одно определение держит обработчики
    здесь и не плодит дубли разметки -->
  <DefineSummary>
    <!-- Свой `@container` у сводки узкого листа: в две колонки она встаёт по
      собственной ширине. На широком листе обёртка — сама левая колонка -->
    <div
      v-if="localCreature"
      :class="sheetLayoutClasses.summary"
    >
      <div :class="sheetLayoutClasses.summaryBlocks">
        <!-- Боевой блок: КД, ХП, Скорость -->
        <CreatureCombatBlock
          :system="localCreature.system"
          :is-edit-mode="isEditMode"
          :ability-mods="skillAbilityMods"
          :proficiency-bonus="creatureProficiencyBonus"
          :armor-class="resolvedStats?.armorClass"
          :resolved-movement="resolvedStats?.movement"
          :active-effects="combinedEffects"
          :hit-dice-bonus-context="hitDiceBonusContext"
          @update:system="handleSystemUpdate"
        />

        <!-- Истощение: сразу под здоровьем — степень штрафует все тесты
                к20 и скорость, и читается она вместе с хитами -->
        <ExhaustionPanel
          v-if="visibleBlocks.exhaustion"
          :level="exhaustionLevel"
          :is-edit-mode="isEditMode"
          @select="handleExhaustionSelect"
        />

        <!-- Защиты -->
        <FieldsetLabel
          v-if="visibleBlocks.vulnerabilities"
          :label="CREATURE_SHEET_LABELS.vulnerabilities"
          class="bg-default/20 transition-colors"
          :class="blockClasses.vulnerabilities"
          @click.left.exact.prevent="openDefensesModal('vulnerabilities')"
        >
          <!-- Шестерёнка ведёт в то же окно, что и клик по блоку: значок
                  называет настройку, а не прячет её за догадкой -->
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="CREATURE_SHEET_LABELS.vulnerabilitiesOpen"
              @open="openDefensesModal('vulnerabilities')"
            />
          </template>

          <div class="flex flex-wrap gap-1.5 p-2 pt-1">
            <UBadge
              v-for="key in localCreature.system.defenses.vulnerabilities"
              :key="key"
              :label="getDefenseLabel(key)"
              color="error"
              variant="subtle"
              :ui="{
                base: 'h-auto max-w-full',
                label:
                  'whitespace-normal wrap-break-word text-left leading-tight',
              }"
            />

            <span
              v-if="localCreature.system.defenses.vulnerabilities.length === 0"
              class="text-xs text-dimmed italic"
            >
              {{ CREATURE_SHEET_LABELS.empty }}
            </span>
          </div>

          <p
            v-if="localCreature.system.defenses.vulnerabilitiesText"
            class="px-2 pb-2 text-xs wrap-break-word text-toned"
          >
            {{ localCreature.system.defenses.vulnerabilitiesText }}
          </p>
        </FieldsetLabel>

        <FieldsetLabel
          v-if="visibleBlocks.resistances"
          :label="CREATURE_SHEET_LABELS.resistances"
          class="bg-default/20 transition-colors"
          :class="blockClasses.resistances"
          @click.left.exact.prevent="openDefensesModal('resistances')"
        >
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="CREATURE_SHEET_LABELS.resistancesOpen"
              @open="openDefensesModal('resistances')"
            />
          </template>

          <div class="flex flex-wrap gap-1.5 p-2 pt-1">
            <UBadge
              v-for="key in localCreature.system.defenses.resistances"
              :key="key"
              :label="getDefenseLabel(key)"
              color="info"
              variant="subtle"
              :ui="{
                base: 'h-auto max-w-full',
                label:
                  'whitespace-normal wrap-break-word text-left leading-tight',
              }"
            />

            <span
              v-if="localCreature.system.defenses.resistances.length === 0"
              class="text-xs text-dimmed italic"
            >
              {{ CREATURE_SHEET_LABELS.empty }}
            </span>
          </div>

          <p
            v-if="localCreature.system.defenses.resistancesText"
            class="px-2 pb-2 text-xs wrap-break-word text-toned"
          >
            {{ localCreature.system.defenses.resistancesText }}
          </p>
        </FieldsetLabel>

        <FieldsetLabel
          v-if="visibleBlocks.immunities"
          :label="CREATURE_SHEET_LABELS.immunities"
          class="bg-default/20 transition-colors"
          :class="blockClasses.immunities"
          @click.left.exact.prevent="openDefensesModal('immunities')"
        >
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="CREATURE_SHEET_LABELS.immunitiesOpen"
              @open="openDefensesModal('immunities')"
            />
          </template>

          <div class="flex flex-wrap gap-1.5 p-2 pt-1">
            <UBadge
              v-for="key in localCreature.system.defenses.immunities"
              :key="key"
              :label="getDefenseLabel(key)"
              color="warning"
              variant="subtle"
              :ui="{
                base: 'h-auto max-w-full',
                label:
                  'whitespace-normal wrap-break-word text-left leading-tight',
              }"
            />

            <span
              v-if="localCreature.system.defenses.immunities.length === 0"
              class="text-xs text-dimmed italic"
            >
              {{ CREATURE_SHEET_LABELS.empty }}
            </span>
          </div>

          <p
            v-if="localCreature.system.defenses.immunitiesText"
            class="px-2 pb-2 text-xs wrap-break-word text-toned"
          >
            {{ localCreature.system.defenses.immunitiesText }}
          </p>
        </FieldsetLabel>

        <FieldsetLabel
          v-if="visibleBlocks.conditionImmunities"
          :label="GRANT_FIELD_LABELS.conditionImmunities"
          class="bg-default/20 transition-colors"
          :class="blockClasses.editable"
          @click.left.exact.prevent="openConditionImmunitiesModal"
        >
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="CREATURE_SHEET_LABELS.conditionImmunitiesOpen"
              @open="openConditionImmunitiesModal"
            />
          </template>

          <div class="flex flex-wrap gap-1.5 p-2 pt-1">
            <UBadge
              v-for="key in localCreature.system.defenses.conditionImmunities"
              :key="key"
              :label="getDefenseLabel(key)"
              color="neutral"
              variant="subtle"
              :ui="{
                base: 'h-auto max-w-full',
                label:
                  'whitespace-normal wrap-break-word text-left leading-tight',
              }"
            />

            <span
              v-if="
                localCreature.system.defenses.conditionImmunities.length === 0
              "
              class="text-xs text-dimmed italic"
            >
              {{ CREATURE_SHEET_LABELS.empty }}
            </span>
          </div>
        </FieldsetLabel>
        <!-- Навыки, Чувства и Языки -->
        <!-- Спасброски -->
        <FieldsetLabel
          :label="GRANT_SECTION_LABELS.savingThrows"
          class="bg-default/20 transition-colors"
          :class="blockClasses.plain"
        >
          <!-- Шестерёнка ведёт в настройку расчёта: кружки в самом блоке
                  ставят только владение, а характеристику спасброска и свои
                  бонусы правят в окне -->
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="SAVING_THROW_SETTINGS_LABELS.open"
              @open="openSavingThrowSettings"
            />
          </template>

          <div class="px-2 pb-1">
            <div class="grid grid-cols-2 gap-x-2 gap-y-1">
              <div
                v-for="ability in SAVING_THROW_ABILITIES"
                :key="ability.key"
                class="flex cursor-pointer items-center gap-2 rounded p-1.5 transition-colors hover:bg-elevated"
                @click.left.exact.prevent="handleSavingThrowClick(ability)"
              >
                <button
                  class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border"
                  :class="
                    creatureSavingThrows.includes(ability.key)
                      ? 'border-primary bg-primary'
                      : 'border-accented bg-transparent'
                  "
                  @click.left.exact.prevent.stop="
                    toggleSavingThrow(ability.key)
                  "
                />

                <span class="flex-1 truncate text-sm font-medium text-toned">{{
                  ability.shortLabel
                }}</span>

                <span
                  class="rounded border border-default bg-elevated px-2 py-0.5 text-sm font-bold text-highlighted shadow-sm"
                >
                  {{ formatSignedNumber(calculateSavingThrow(ability.key)) }}
                </span>
              </div>
            </div>
          </div>
        </FieldsetLabel>

        <!-- Навыки — бейджами, как в стат-блоке: у существа отмечены
                считанные навыки, и полный список правил занимал бы всю колонку
                ради трёх строк. Владения правят в своём окне, а нажатие по
                бейджу вне правки катит проверку этого навыка -->
        <FieldsetLabel
          v-if="visibleBlocks.skills"
          :label="GRANT_SECTION_LABELS.skills"
          class="bg-default/20 transition-colors"
          :class="blockClasses.editable"
          @click.left.exact.prevent="openSkillsModal"
        >
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="SKILL_SETTINGS_LABELS.open"
              @open="openSkillsModal"
            />
          </template>

          <div class="flex flex-wrap gap-1.5 p-2 pt-1">
            <UBadge
              v-for="badge in skillBadges"
              :key="badge.id"
              :label="badge.label"
              color="neutral"
              variant="subtle"
              class="cursor-pointer transition-colors hover:bg-accented"
              @click.left.exact.stop.prevent="handleSkillBadgeClick(badge)"
            />

            <span
              v-if="skillBadges.length === 0"
              class="text-xs text-dimmed italic"
            >
              {{ CREATURE_SHEET_LABELS.empty }}
            </span>
          </div>
        </FieldsetLabel>

        <!-- Восприятие только считает: зрение существа правят в его
                настройках токена, поэтому блок не настраивается и в правке -->
        <FieldsetLabel
          :label="CREATURE_SHEET_LABELS.perception"
          class="bg-default/20"
          :class="SHEET_BLOCK_VIEW_BORDER_CLASS"
        >
          <div class="flex flex-col gap-1 p-2 pt-1 text-sm text-default">
            <div class="flex items-center justify-between">
              <span class="text-dimmed">
                {{ CREATURE_SHEET_LABELS.visionPrefix }}
              </span>

              <span>{{ creatureVisionRangeLabel }}</span>
            </div>

            <div
              v-if="localCreature.token?.vision?.darkvision"
              class="flex items-center justify-between"
            >
              <span class="text-dimmed">
                {{ CREATURE_SHEET_LABELS.darkvisionPrefix }}
              </span>

              <span>
                {{ localCreature.token.vision.darkvision }}
                {{ FEET_UNIT_LABEL }}
              </span>
            </div>

            <div class="flex items-center justify-between">
              <span class="text-dimmed">
                {{ CREATURE_SHEET_LABELS.passivePerceptionPrefix }}
              </span>

              <span class="font-bold text-highlighted">{{
                passivePerception
              }}</span>
            </div>
          </div>
        </FieldsetLabel>

        <FieldsetLabel
          v-if="visibleBlocks.languages"
          :label="GRANT_SECTION_LABELS.languages"
          class="bg-default/20 transition-colors"
          :class="blockClasses.editable"
          @click.left.exact.prevent="openLanguagesModal"
        >
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="PROFICIENCY_MODAL_LABELS.languagesOpen"
              @open="openLanguagesModal"
            />
          </template>

          <div class="flex flex-wrap gap-1.5 p-2 pt-1">
            <UBadge
              v-for="language in localCreature.system.languages"
              :key="language"
              :label="language"
              color="neutral"
              variant="subtle"
              :ui="{
                base: 'h-auto max-w-full',
                label:
                  'whitespace-normal wrap-break-word text-left leading-tight',
              }"
            />

            <span
              v-if="
                !localCreature.system.languages
                || localCreature.system.languages.length === 0
              "
              class="text-xs text-dimmed italic"
            >
              {{ CREATURE_SHEET_LABELS.empty }}
            </span>
          </div>
        </FieldsetLabel>

        <FieldsetLabel
          v-if="visibleBlocks.environments"
          :label="CREATURE_SHEET_LABELS.environments"
          class="bg-default/20 transition-colors"
          :class="blockClasses.environments"
          @click.left.exact.prevent="openEnvironmentsModal"
        >
          <template
            v-if="isEditMode"
            #actions
          >
            <SheetSettingsGear
              :label="CREATURE_SHEET_LABELS.environmentsOpen"
              @open="openEnvironmentsModal"
            />
          </template>

          <div class="flex flex-col gap-1 p-2 pt-1">
            <div class="flex flex-wrap gap-1.5">
              <UBadge
                v-for="env in localCreature.system.environments"
                :key="env"
                :label="
                  CREATURE_ENVIRONMENTS.find((entry) => entry.key === env)
                    ?.label || env
                "
                color="neutral"
                variant="subtle"
                :ui="{
                  base: 'h-auto max-w-full',
                  label:
                    'whitespace-normal wrap-break-word text-left leading-tight',
                }"
              />

              <span
                v-if="
                  (!localCreature.system.environments
                    || localCreature.system.environments.length === 0)
                  && !localCreature.system.customEnvironments
                "
                class="text-xs text-dimmed italic"
              >
                {{ CREATURE_SHEET_LABELS.empty }}
              </span>
            </div>

            <div
              v-if="localCreature.system.customEnvironments"
              class="mt-1 text-sm text-toned"
            >
              <span class="mb-0.5 block text-xs text-dimmed">
                {{ CREATURE_SHEET_LABELS.environmentSpecialPrefix }}
              </span>
              {{ localCreature.system.customEnvironments }}
            </div>
          </div>
        </FieldsetLabel>
      </div>
    </div>
  </DefineSummary>

  <!--
    `max-h-[100%]` в `ui.body` снимает дефолтный потолок тела окна в 90vh —
    тот же приём, что в листе персонажа: без него на полной высоте под
    содержимым оставалась пустая полоса.
  -->
  <UDraggableModal
    ref="sheetModalRef"
    :open="isOpen"
    :title="minimizedTitle"
    hide-header
    :initial-width="940"
    :initial-height="780"
    :min-width="SHEET_WINDOW_MIN_WIDTH"
    :min-height="300"
    :z-index="zIndex"
    :modal-id="modalId"
    :saved-position="savedPosition"
    :saved-size="savedSize"
    :ui="{
      content: 'bg-default rounded-xl',
      body: 'p-0 h-full flex flex-col max-h-[100%]',
    }"
    @update:open="handleModalClose"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <div
        v-if="localCreature"
        ref="sheetBody"
        class="relative flex h-full flex-col"
        @dragover="handleSheetDragOver"
        @dragleave="handleSheetDragLeave"
        @drop="handleSheetDrop"
      >
        <!-- Фоновая картинка с затуханием -->
        <img
          src="/assets/modals/actor_bg.webp"
          alt=""
          class="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-8"
        />

        <div :class="sheetFrameClass">
          <!-- Шапка существа (Full bleed) -->
          <CreatureHeader
            :creature="localCreature"
            :is-edit-mode="isEditMode"
            :is-creating="isCreating"
            :can-edit="canControl && !isReadOnly"
            @update="handleCreatureUpdate"
            @update:system="handleSystemUpdate"
            @toggle-edit-mode="toggleEditMode"
            @open-settings="openSettings"
            @short-rest="handleRest('short')"
            @long-rest="handleRest('long')"
            @close="handleCancel"
            @minimize="minimizeSheet"
            @save="handleSave"
          />

          <!-- Пока ширина листа не замерена, раскладка неизвестна, и рисовать
          содержимое рано: угаданная раскладка на телефоне неверна, и лист
          перестроился бы на глазах -->
          <div :class="sheetLayoutClasses.content">
            <div
              v-if="isMeasured"
              :class="sheetLayoutClasses.columns"
            >
              <!-- Широкий лист: сводка — левой колонкой -->
              <ReuseSummary v-if="isWide" />

              <!-- Правая колонка -->
              <div class="flex min-w-0 flex-1 flex-col gap-4">
                <!-- Характеристики: 6 ячеек -->
                <CreatureAbilities
                  :creature="localCreature"
                  :is-edit-mode="isEditMode"
                  @update:system="handleSystemUpdate"
                />

                <!-- Вкладки. Промежутки те же, что и у вкладок листа персонажа:
                строка вкладок у обоих листов одна и та же, и отступ до
                содержимого не должен расходиться -->
                <SheetTabs
                  v-model="activeTab"
                  :tabs="tabs"
                  class="mt-2"
                >
                  <!-- Узкий лист: сводка — первой вкладкой -->
                  <ReuseSummary v-if="activeTab === SHEET_MAIN_TAB_ID" />

                  <!-- Действия -->
                  <CreatureActionsTab
                    v-if="activeTab === 'actions'"
                    :creature="localCreature"
                    :is-edit-mode="isEditMode"
                    :is-read-only="isReadOnly"
                    @update:actions="handleActionsUpdate"
                    @update:bonus-actions="handleBonusActionsUpdate"
                    @update:reactions="handleReactionsUpdate"
                    @update:legendary-actions="handleLegendaryActionsUpdate"
                    @update:legendary-count="handleLegendaryCountUpdate"
                  />

                  <!-- Инвентарь -->
                  <template v-if="activeTab === 'equipment'">
                    <CreatureEquipmentBlock
                      :creature="localCreature"
                      :is-edit-mode="isEditMode"
                      :is-drag-over="isItemDragOver"
                      :is-read-only="isReadOnly || !canControl"
                      @update:creature="handleCreatureUpdate"
                    />
                  </template>

                  <!-- Особенности -->
                  <CreatureTraitsTab
                    v-if="activeTab === 'traits'"
                    :creature="localCreature"
                    :is-edit-mode="isEditMode"
                    :is-read-only="isReadOnly"
                    @update:traits="handleTraitsUpdate"
                  />

                  <!-- Заклинания -->
                  <template v-if="activeTab === 'spells'">
                    <CreatureSpellsBlock
                      :creature="localCreature"
                      :spells="localCreature.spells"
                      :spellcasting-blocks="
                        localCreature.system.spellcastingBlocks
                      "
                      :is-edit-mode="isEditMode"
                      :is-read-only="isReadOnly"
                      :can-edit="canControl && !isReadOnly"
                      :creature-id="localCreature.id"
                      :creature-name="localCreature.name"
                      :socket="socket"
                      @update:spellbook="handleSpellbookUpdate"
                    />
                  </template>

                  <!-- Эффекты -->
                  <template v-if="activeTab === 'effects'">
                    <CreatureEffectsBlock
                      :creature="localCreature"
                      :is-edit-mode="isEditMode"
                      @update:creature="handleCreatureUpdate"
                      @immediate-save="handleSave"
                    />
                  </template>

                  <!-- Описание -->
                  <template v-if="activeTab === 'description'">
                    <RichTextEditor
                      v-if="isEditMode"
                      :model-value="localCreature.description ?? ''"
                      :placeholder="
                        CREATURE_SHEET_LABELS.descriptionPlaceholder
                      "
                      @update:model-value="handleCreatureDescriptionUpdate"
                    />

                    <div
                      v-else
                      class="min-h-50 rounded-lg bg-accented/30"
                    >
                      <ItemDescriptionRenderer
                        v-if="localCreature.description"
                        :content="localCreature.description"
                        class="p-4"
                      />

                      <p
                        v-else
                        class="p-4 text-sm text-dimmed"
                      >
                        {{ CREATURE_SHEET_LABELS.descriptionEmpty }}
                      </p>
                    </div>
                  </template>
                </SheetTabs>
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
          {{ CREATURE_SHEET_LABELS.discardQuestion }}
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

  <!-- Броски навыков и спасбросков левой колонки -->
  <DiceRollModal
    v-model:open="isDiceRollOpen"
    :modifier="diceRollConfig.modifier"
    :title="diceRollConfig.title"
    :roll-label="diceRollConfig.rollLabel"
    :roll-button-text="diceRollConfig.rollButtonText"
    :initial-roll-mode="diceRollConfig.initialRollMode"
    :evaluate-bonus-roll-formulas="diceRollConfig.evaluateBonusRollFormulas"
  />

  <!-- Языки -->
  <LanguageProficiencyModal
    v-if="localCreature"
    v-model:open="isLanguagesOpen"
    :selected="localCreature.system.languages || []"
    @apply="onLanguagesApply"
  />

  <!-- Спасброски: владение и настройка расчёта — то же окно, что и у листа
    персонажа. Правила у спасбросков общие, различаются только места записи -->
  <SavingThrowSettingsModal
    v-if="localCreature"
    v-model:open="isSavingThrowSettingsOpen"
    :saving-throws="creatureSavingThrows"
    :settings="localCreature.system.savingThrowSettings"
    :ability-mods="skillAbilityMods"
    :proficiency-bonus="creatureProficiencyBonus"
    :saves="resolvedStats?.saves ?? {}"
    @apply="onSavingThrowSettingsApply"
  />

  <!-- Навыки -->
  <!-- Навыки: владение и настройка расчёта — то же окно, что и у листа
    персонажа. Правила у навыков общие, различаются только места записи -->
  <SkillSettingsModal
    v-if="localCreature"
    v-model:open="isSkillsOpen"
    :proficiencies="localCreature.system.skills"
    :settings="localCreature.system.skillSettings"
    :ability-mods="skillAbilityMods"
    :proficiency-bonus="creatureProficiencyBonus"
    :skills="resolvedStats?.skills ?? {}"
    :overridden-keys="overriddenSkillKeys"
    @apply="onSkillsApply"
  />

  <!-- Защиты -->
  <CreatureDefensesModal
    v-if="localCreature"
    v-model:open="isDefensesOpen"
    :category="activeDefenseCategory"
    :selected="localCreature.system.defenses[activeDefenseCategory] || []"
    @apply="onDefensesApply"
  />

  <CreatureConditionImmunitiesModal
    v-if="localCreature"
    v-model:open="isConditionImmunitiesOpen"
    :selected="localCreature.system.defenses.conditionImmunities || []"
    @apply="onConditionImmunitiesApply"
  />

  <CreatureEnvironmentsModal
    v-if="localCreature"
    v-model:open="isEnvironmentsOpen"
    :environments="localCreature.system.environments ?? []"
    :custom-environments="localCreature.system.customEnvironments ?? ''"
    @apply="onEnvironmentsApply"
  />
</template>
