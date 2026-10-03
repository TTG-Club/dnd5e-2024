<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type {
    ActorClassEntry,
    ClassDefinition,
    ClassFeature,
    DnDActor,
    DnDCustomBonusContext,
    DnDPreparedLimit,
    DnDSpellSlotSettings,
    PreparedKind,
    Spell,
    SpellSaveDCSource,
  } from '@vtt/shared/system/dnd.js';

  import type { SpellCasterPort } from '../../../composables/spellCastFlow';
  import type { SpellPropertyFilterKey } from '../constants';
  import type { SheetRowStat } from '../sheetRowTypes';

  import { useToast } from '@nuxt/ui/composables';
  import { computed, ref, watch } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useChatStore } from '@/stores/chatStore';
  import { useHotbarStore } from '@/stores/hotbarStore';
  import { generateId } from '@vtt/shared';
  import {
    applySpellSlotSettings,
    buildCasterTypeMap,
    canTogglePrepared,
    CANTRIP_SPELL_LEVEL,
    computeSpellSlots,
    countsTowardCantrips,
    countsTowardPreparedSpells,
    damagePartIsHealing,
    findSpellCastBlock,
    getClassPreparedValue,
    getPactSlotInfo,
    getPreparedLimitBreakdown,
    getSpellAttackBreakdown,
    getSpellDamageParts,
    getSpellSaveDCBreakdown,
    isGrantedSpell,
    isSpellReady,
    parsePreparedLimit,
    parseSpellcastingSettings,
    parseSpellSlotSettings,
    PREPARED_LIMIT_EMPTY_VALUE,
    resolveEntityActionBlocks,
    resolveSpellSaveDC,
    settleBookCantrips,
    SPELL_LEVEL_LABELS,
    SPELL_SCHOOL_LABELS,
    SPELL_USES_RECOVERY_LABELS,
    syncClassGrantedSpells,
  } from '@vtt/shared/system/dnd.js';

  import {
    describeDamageVariantsStat,
    formatDamageTileFormula,
    useDamageTypeLabel,
  } from '../../../composables/damageTypeChoice';
  import {
    createSpellCasterPort,
    startSpellCast,
  } from '../../../composables/spellCastFlow';
  import { useClassCatalog } from '../../../composables/useClassCatalog';
  import { useCompendiumWarmup } from '../../../composables/useCompendiumWarmup';
  import {
    listAmbientEffects,
    resolveEntityStats,
  } from '../../../composables/useResolvedStats';
  import CompendiumDataModal from '../../compendium/CompendiumDataModal.vue';
  import ActorSpellRow from '../ActorSpellRow.vue';
  import {
    ACTOR_SPELLS_TAB_LABELS,
    FILTER_ROW_CONTROL_SIZE,
    GRANTED_CANTRIPS_GROUP_LABEL,
    GRANTED_CANTRIPS_GROUP_LEVEL,
    SHEET_FILTER_LABELS,
    SHEET_ROW_MENU_LABELS,
    SPELL_BROWSER_WARMUP_KINDS,
    SPELL_FILTER_LABELS,
    SPELL_LEVEL_SUFFIX,
    SPELL_MENU_LABELS,
    SPELL_MIME,
    SPELL_PROPERTY_FILTERS,
    SPELL_STAT_HINTS,
    SPELL_STAT_LABELS,
  } from '../constants';
  import FilterChip from '../FilterChip.vue';
  import FilterResetButton from '../FilterResetButton.vue';
  import PreparedSpellsModal from '../PreparedSpellsModal.vue';
  import SheetStatTile from '../SheetStatTile.vue';
  import SpellcastingSettingsModal from '../SpellcastingSettingsModal.vue';
  import SpellSlotsModal from '../SpellSlotsModal.vue';
  import { getFilterChipClass } from '../utils/filterChipClass';
  import { formatSignedNumber } from '../utils/formatSignedNumber';
  import { describeSpellDamageDisplay } from '../utils/formatSpellDamageDisplay';

  const props = defineProps<{
    actor: DnDActor;
    isEditMode: boolean;
    isDragOver?: boolean;
  }>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
    'immediate-save': [];
  }>();

  /**
   * Запрашивает у хозяина вкладки немедленное сохранение актёра — только вне
   * режима редактирования. В режиме редактирования изменения копятся в
   * локальной копии до «Сохранить»: немедленный push рассинхронизировал бы
   * снапшот отката (последующая «Отмена» затирала бы уже сохранённое).
   */
  function triggerSaveIfNotEdit() {
    if (!props.isEditMode) {
      emit('immediate-save');
    }
  }

  const { openModal } = useModalManager();
  // Уведомления берутся в setup: в обработчике клика `useToast()` уже не
  // работает — Vue молча глушит его, и сообщение «нет ячеек» не появлялось
  const toast = useToast();
  const chatStore = useChatStore();

  /**
   * Сокет мира — для окна компендиума и его прогрева.
   *
   * @returns сокет или `null`
   */
  function getWorldSocket() {
    return chatStore.getSocket();
  }

  const isSettingsModalOpen = ref(false);

  /**
   * Resolved stats для отображения Spell Save DC и бонуса атаки — с аурами
   * карты, тем же расчётом, что у каста: показанная Сл и Сл каста одна
   */
  const resolvedStats = computed(() => resolveEntityStats(props.actor));

  /** Запреты трат хода — одним расчётом на весь список заклинаний */
  const actionBlocks = computed(() =>
    resolveEntityActionBlocks(props.actor, listAmbientEffects(props.actor.id)),
  );

  /** Базовая характеристика заклинаний актора (с учетом классов) */
  const baseSpellcastingAbility = computed(() => {
    if (props.actor.system?.spellcastingAbility) {
      return props.actor.system.spellcastingAbility;
    }

    const casterClass = props.actor.system?.classes?.find(
      (entry) => entry.spellcastingAbility != null,
    );

    return casterClass?.spellcastingAbility ?? null;
  });

  /** Настройка заклинательства листа; поля нет у листов старых миров */
  const spellcastingSettings = computed(() =>
    parseSpellcastingSettings(props.actor.system?.spellcastingSettings),
  );

  /**
   * Числа листа, от которых считаются свои бонусы настройки заклинательства и
   * пределов подготовки
   */
  const spellcastingBonusContext = computed<DnDCustomBonusContext>(() => ({
    abilityMods: resolvedStats.value.abilityMods,
    proficiencyBonus: resolvedStats.value.proficiencyBonus,
  }));

  /**
   * Сложность спасброска по листу: расчёт по правилам с настройкой, но без
   * прибавок активных эффектов. Их держит `resolvedStats`, а окну настройки они
   * нужны отдельным числом.
   */
  const sheetSaveDC = computed(() =>
    getSpellSaveDCBreakdown({
      ability: baseSpellcastingAbility.value,
      settings: spellcastingSettings.value?.saveDC,
      context: spellcastingBonusContext.value,
    }),
  );

  /** Бонус атаки заклинанием по листу — тем же расчётом, что и сложность */
  const sheetSpellAttack = computed(() =>
    getSpellAttackBreakdown({
      ability: baseSpellcastingAbility.value,
      settings: spellcastingSettings.value?.attack,
      context: spellcastingBonusContext.value,
    }),
  );

  /** Итоговый бонус атаки заклинаниями для отображения в заголовке */
  const displaySpellAttackBonus = computed(() =>
    sheetSpellAttack.value === null
      ? null
      : sheetSpellAttack.value.value + resolvedStats.value.attackBonuses.spell,
  );

  /** Ячейки по таблицам классов — без своей поправки листа */
  const classSlots = computed(() => {
    const classes = props.actor.system?.classes ?? [];

    return computeSpellSlots(classes, buildCasterTypeMap(classes));
  });

  /** Свои бонусы листа к ячейкам; поля нет у листов старых миров */
  const spellSlotSettings = computed(() =>
    parseSpellSlotSettings(props.actor.system?.spellSlotSettings),
  );

  /** Максимальные ячейки заклинаний: классы и свои бонусы поверх */
  const maxSlots = computed(() =>
    applySpellSlotSettings(
      classSlots.value,
      spellSlotSettings.value,
      spellcastingBonusContext.value,
    ),
  );

  /** Использованные ячейки */
  const usedSlots = computed(
    () => props.actor.system?.spellSlotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0],
  );

  const isSlotsModalOpen = ref(false);

  /** У листа есть свои бонусы к ячейкам: значок настройки горит тёплым */
  const hasSpellSlotBonuses = computed(() =>
    spellSlotSettings.value.levels.some((bonuses) => bonuses.length > 0),
  );

  /**
   * Подсказка значка ячеек: сколько осталось из всего. Число ячеек видно и у
   * пузырьков кругов, но на значке без подписи оно объясняет, что он настраивает.
   */
  const slotsButtonTooltip = computed(() => {
    const total = maxSlots.value.reduce((sum, count) => sum + count, 0);

    const left = maxSlots.value.reduce(
      (sum, count, index) =>
        sum + Math.max(0, count - (usedSlots.value[index] ?? 0)),
      0,
    );

    const value = total === 0 ? PREPARED_LIMIT_EMPTY_VALUE : `${left}/${total}`;

    return `${ACTOR_SPELLS_TAB_LABELS.slotsHint}: ${value} — ${ACTOR_SPELLS_TAB_LABELS.slotsHintSettings}`;
  });

  /** Сохраняет свои бонусы к ячейкам из модалки */
  function applySpellSlotSettingsUpdate(settings: DnDSpellSlotSettings): void {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        spellSlotSettings: settings,
      },
    });

    triggerSaveIfNotEdit();
  }

  /** Классы по пакам — таблица уровней читается из записи, которую выбрали */
  const { resolve: resolveClassDefinition } = useClassCatalog();

  /**
   * Определение класса по записи листа: адресуется парой «пак + ключ», иначе
   * таблица читалась бы из одноимённой записи соседнего компендиума.
   *
   * @param entry - запись класса на листе
   */
  function classDefinitionOf(
    entry: ActorClassEntry,
  ): ClassDefinition | undefined {
    return resolveClassDefinition({
      key: entry.classKey,
      packId: entry.packId,
    });
  }

  /**
   * Предел подготовленных заклинаний: число из таблицы класса компендиума с
   * поправками листа (своё число либо свои бонусы к числу класса).
   */
  const preparedSpellsLimit = computed(() =>
    getPreparedLimitBreakdown(
      getClassPreparedValue(
        props.actor.system?.classes ?? [],
        classDefinitionOf,
        'spells',
      ),
      props.actor.system?.preparedSpells,
      spellcastingBonusContext.value,
    ),
  );

  /** Предел заговоров — тот же расчёт, но по своей колонке таблицы класса */
  const cantripsLimit = computed(() =>
    getPreparedLimitBreakdown(
      getClassPreparedValue(
        props.actor.system?.classes ?? [],
        classDefinitionOf,
        'cantrips',
      ),
      props.actor.system?.preparedCantrips,
      spellcastingBonusContext.value,
    ),
  );

  /**
   * Предел подготовки числом: 0 означает «предела нет» — так его понимает
   * проверка при отметке заклинания.
   */
  const maxPreparedSpells = computed(
    () => preparedSpellsLimit.value.value ?? 0,
  );

  /**
   * Заговоры книги уже отмечаются подготовкой. У листа старого мира поля нет:
   * пока вкладка не разобрала его заговоры по колонке «Заговоры», доступны все.
   */
  const cantripsTracked = computed(
    () => props.actor.system?.cantripsTracked === true,
  );

  /**
   * Текущее количество подготовленных заклинаний: книга и выдача умений класса,
   * которую готовит сам игрок. Заклинания домена, вида и черт места не занимают.
   */
  const currentPreparedSpellsCount = computed(
    () =>
      (props.actor.spells ?? []).filter((spell) =>
        countsTowardPreparedSpells(spell),
      ).length,
  );

  /** Открыт ли компендиум заклинаний, из которого пополняют книгу */
  const isSpellBrowserOpen = ref(false);

  // Заклинания и классы (подписи фильтра «Класс») для окна «Добавить» грузятся,
  // пока игрок смотрит на вкладку
  useCompendiumWarmup(() => getWorldSocket(), SPELL_BROWSER_WARMUP_KINDS);

  /**
   * Названия заклинаний листа: в окне они помечены изученными и повторно не
   * выбираются. По названию, а не по id: на листе у заклинания свой id, и с
   * идентификатором компендиума он никогда не совпадает.
   */
  const knownSpellNames = computed(() =>
    (props.actor.spells ?? []).map((spell) => spell.name),
  );

  /**
   * Класс, чьим списком открывается компендиум: первый класс персонажа. У
   * мультикласса фильтр всё равно снимается в самом окне, а открывать его
   * вовсе без фильтра значило бы вывалить весь справочник.
   */
  const spellBrowserClassKey = computed(
    () => props.actor.system?.classes?.[0]?.classKey,
  );

  /**
   * Пак первого класса: при повторе заклинания в нескольких компендиумах окно
   * оставляет копию из него — из того же пака, что и сам класс.
   */
  const spellBrowserPackId = computed(
    () => props.actor.system?.classes?.[0]?.packId,
  );

  /**
   * Кладёт выбранные в компендиуме заклинания в книгу. Норму по таблице класса
   * показывают плитки шапки — окно её не сторожит: книга волшебника по правилам
   * больше числа подготовленных, и запрет мешал бы больше, чем помогал.
   *
   * @param spells - заклинания, отмеченные в окне
   */
  function addSpellsFromCompendium(spells: Spell[]): void {
    const known = new Set(knownSpellNames.value);

    // Заговор приходит без отметки: ниже он сам займёт свободное место в
    // колонке «Заговоры», а лишний останется неотмеченным
    const added = spells
      .filter((spell) => !known.has(spell.name))
      .map((spell) => ({
        ...spell,
        id: generateId('spell'),
        prepared: spell.level === CANTRIP_SPELL_LEVEL ? undefined : false,
      }));

    if (added.length === 0) {
      return;
    }

    const combined = [...(props.actor.spells ?? []), ...added];

    emit('update:actor', {
      spells: cantripsTracked.value
        ? settleBookCantrips(
            combined,
            cantripsLimit.value.value,
            (spell) => spell.prepared === undefined,
          )
        : combined,
    });

    triggerSaveIfNotEdit();
  }

  /**
   * Заговоры в счёт колонки «Заговоры»: отмеченные в книге и выданные умениями
   * класса. Выданные видом, предысторией, чертой и с отметкой «Подготавливать
   * не нужно» («Чудотворец» жреца) идут сверх колонки.
   */
  const currentCantripsCount = computed(
    () =>
      (props.actor.spells ?? []).filter((spell) =>
        countsTowardCantrips(spell, cantripsTracked.value),
      ).length,
  );

  /**
   * Умения классов и подклассов персонажа — по ним выдачам на листе досылаются
   * отметки, которых не было при выдаче. undefined — какой-то класс ещё не
   * загружен, и сверять рано.
   */
  const actorClassFeatures = computed(() => {
    const features: ClassFeature[] = [];

    for (const entry of props.actor.system?.classes ?? []) {
      const definition = classDefinitionOf(entry);

      if (!definition) {
        return undefined;
      }

      const subclass = entry.subclassKey
        ? definition.subclasses.find(
            (candidate) => candidate.key === entry.subclassKey,
          )
        : undefined;

      features.push(...definition.features, ...(subclass?.features ?? []));
    }

    return features;
  });

  /**
   * Чинит заклинания листа, легшие до нынешних правил подготовки:
   * - заклинаниям умений класса досылается отметка «Подготавливать не нужно» —
   *   выгрузка долго её теряла, и заклинания домена приходилось готовить;
   * - заговоры книги старого листа разбираются по колонке «Заговоры»: раньше их
   *   подготовки не было, а теперь неотмеченный заговор недоступен.
   *
   * Цикл обрывается сам: починенный лист чинить нечего, и второй проход ничего
   * не меняет — отправки не будет.
   */
  watch(
    [
      () => props.actor.spells,
      actorClassFeatures,
      cantripsTracked,
      () => cantripsLimit.value.value,
    ],
    ([spells, features, tracked, limit]) => {
      if (!spells || !features) {
        return;
      }

      const synced = syncClassGrantedSpells(spells, features);

      if (tracked) {
        if (synced !== spells) {
          emit('update:actor', { spells: synced });
          triggerSaveIfNotEdit();
        }

        return;
      }

      emit('update:actor', {
        spells: settleBookCantrips(
          synced,
          limit,
          (spell) => spell.prepared !== true,
        ),
        system: { ...props.actor.system, cantripsTracked: true },
      });

      triggerSaveIfNotEdit();
    },
    { immediate: true },
  );

  /**
   * Числа заклинательства для плитки шапки. Подписи короткие, чтобы ряд
   * помещался на узком листе, — полное название остаётся в подсказке ячейки.
   */
  const spellcastingCells = computed(() => [
    {
      label: ACTOR_SPELLS_TAB_LABELS.saveDC,
      hint: ACTOR_SPELLS_TAB_LABELS.saveDCHint,
      // Прочерк — только когда числа у листа нет вовсе: своя сложность бывает
      // и нулевой, а `|| '—'` съел бы её
      value: sheetSaveDC.value === null ? '—' : resolvedStats.value.spellSaveDC,
    },
    {
      label: ACTOR_SPELLS_TAB_LABELS.attack,
      hint: ACTOR_SPELLS_TAB_LABELS.attackHint,
      value:
        displaySpellAttackBonus.value === null
          ? '—'
          : formatSignedNumber(displaySpellAttackBonus.value),
    },
  ]);

  /**
   * Прибавка к Сл спасброска от активных эффектов. Движок кладёт в
   * `spellSaveDC` и её, и расчёт листа, а окну настройки она нужна отдельно:
   * иначе предпросмотр для другой характеристики разошёлся бы с числом на
   * вкладке.
   */
  const saveDcEffectBonus = computed(
    () => resolvedStats.value.spellSaveDC - (sheetSaveDC.value?.value ?? 0),
  );

  /** Сохраняет настройку заклинательства из модалки */
  function handleSpellcastingUpdate(updates: Partial<DnDActor>): void {
    emit('update:actor', updates);

    triggerSaveIfNotEdit();
  }

  /**
   * Цвет числа в плитке подготовки: предел выбран (info) или превышен (danger).
   * Неизвестный предел не красится — сравнивать не с чем.
   *
   * @param count - сколько отмечено сейчас
   * @param limit - предел; null — таблица класса его не даёт
   */
  function preparedValueClass(count: number, limit: number | null): string {
    if (limit === null) {
      return 'text-toned';
    }

    if (count > limit) {
      return 'text-danger';
    }

    return count === limit ? 'text-info' : 'text-toned';
  }

  /**
   * Актёр колдует: есть заклинательный класс, характеристика заклинаний либо
   * сами заклинания. У неписей и невоюющих классов плиткам подготовки в шапке
   * делать нечего.
   */
  const isSpellcaster = computed(
    () =>
      (props.actor.system?.classes ?? []).some(
        (entry) =>
          entry.spellcastingAbility != null || entry.casterType != null,
      )
      || props.actor.system?.spellcastingAbility != null
      || (props.actor.spells?.length ?? 0) > 0,
  );

  /**
   * Плитки подготовки в шапке: заклинания книги и заговоры считаются порознь —
   * у каждого своя колонка таблицы класса и свой предел.
   *
   * У заклинателя видны обе, даже когда таблица класса числа не даёт: вместо
   * него стоит прочерк, а нажатие открывает настройку своего числа.
   */
  const preparedTiles = computed(() => {
    if (!isSpellcaster.value) {
      return [];
    }

    return [
      {
        kind: 'spells' as const,
        label: ACTOR_SPELLS_TAB_LABELS.prepared,
        hint: ACTOR_SPELLS_TAB_LABELS.preparedHint,
        limit: preparedSpellsLimit.value,
        count: currentPreparedSpellsCount.value,
      },
      {
        kind: 'cantrips' as const,
        label: ACTOR_SPELLS_TAB_LABELS.cantrips,
        hint: ACTOR_SPELLS_TAB_LABELS.cantripsHint,
        limit: cantripsLimit.value,
        count: currentCantripsCount.value,
      },
    ].map((tile) => ({
      kind: tile.kind,
      tooltip:
        tile.limit.value === null
          ? `${tile.hint}: ${tile.count}. ${ACTOR_SPELLS_TAB_LABELS.tileHintNoLimit}`
          : `${tile.hint}: ${tile.count} ${ACTOR_SPELLS_TAB_LABELS.tileHintOf} ${tile.limit.value} — ${ACTOR_SPELLS_TAB_LABELS.tileHintLimit}`,
      cells: [
        {
          label: tile.label,
          value: `${tile.count}/${tile.limit.value ?? PREPARED_LIMIT_EMPTY_VALUE}`,
          valueClass: preparedValueClass(tile.count, tile.limit.value),
        },
      ],
    }));
  });

  /** Какой предел настраивается в открытой модалке */
  const editedPreparedKind = ref<PreparedKind>('spells');

  const isPreparedModalOpen = ref(false);

  /** Разбор предела, открытого в модалке */
  const editedPreparedLimit = computed(() =>
    editedPreparedKind.value === 'cantrips'
      ? cantripsLimit.value
      : preparedSpellsLimit.value,
  );

  /**
   * Сохранённая настройка предела, открытого в модалке: разобранная, чтобы
   * старое число бонуса пришло в окно строкой списка.
   */
  const editedPreparedSettings = computed<DnDPreparedLimit>(() =>
    parsePreparedLimit(
      editedPreparedKind.value === 'cantrips'
        ? props.actor.system?.preparedCantrips
        : props.actor.system?.preparedSpells,
    ),
  );

  /** Открывает настройку предела подготовки нужного вида */
  function openPreparedModal(kind: PreparedKind): void {
    editedPreparedKind.value = kind;
    isPreparedModalOpen.value = true;
  }

  /** Сохраняет настройку предела подготовки */
  function applyPreparedLimit(limit: DnDPreparedLimit): void {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        ...(editedPreparedKind.value === 'cantrips'
          ? { preparedCantrips: limit }
          : { preparedSpells: limit }),
      },
    });

    triggerSaveIfNotEdit();
  }

  // --- Поиск и отбор ---

  const searchQuery = ref('');

  /** Отмеченные чипами круги; пусто — круги списка не сужаются */
  const filterLevels = ref<Set<number>>(new Set());

  /** Отмечен чип «Подготовленные» */
  const filterPrepared = ref(false);

  /** Отмеченные чипы свойств заклинания */
  const propertyFilters = ref<Record<SpellPropertyFilterKey, boolean>>({
    healing: false,
    concentration: false,
    ritual: false,
  });

  /**
   * Отбор сужает сам список заклинаний (а не только круги): под ним разделители
   * пустых кругов уже мешают — показывать нечего, кроме пузырьков ячеек.
   */
  const hasSpellFilter = computed(
    () =>
      searchQuery.value.trim().length > 0
      || filterPrepared.value
      || Object.values(propertyFilters.value).some((isPicked) => isPicked),
  );

  /** Список сужен: отбор есть что сбросить */
  const hasAnyFilter = computed(
    () => hasSpellFilter.value || filterLevels.value.size > 0,
  );

  /** Нажатие на «Сбросить»: список возвращается целиком */
  function resetFilters(): void {
    searchQuery.value = '';
    filterLevels.value = new Set();
    filterPrepared.value = false;

    propertyFilters.value = {
      healing: false,
      concentration: false,
      ritual: false,
    };
  }

  /** Очистка поля поиска крестиком */
  function clearSearch(): void {
    searchQuery.value = '';
  }

  /** Нажатие на чип подготовленных: тем же чипом отбор и снимается */
  function togglePreparedFilter(): void {
    filterPrepared.value = !filterPrepared.value;
  }

  /**
   * Нажатие на чип круга: круги набираются по одному, повторное нажатие снимает
   * круг с отбора.
   *
   * @param level - круг заклинания
   */
  function toggleLevelFilter(level: number): void {
    const pickedLevels = new Set(filterLevels.value);

    if (pickedLevels.has(level)) {
      pickedLevels.delete(level);
    } else {
      pickedLevels.add(level);
    }

    filterLevels.value = pickedLevels;
  }

  /**
   * Нажатие на чип свойства заклинания.
   *
   * @param key - свойство: лечение, концентрация либо ритуал
   */
  function togglePropertyFilter(key: SpellPropertyFilterKey): void {
    propertyFilters.value = {
      ...propertyFilters.value,
      [key]: !propertyFilters.value[key],
    };
  }

  /** Круги, у которых класс даёт ячейки заклинаний */
  const slotLevels = computed(() =>
    maxSlots.value.reduce<number[]>((levels, max, index) => {
      if (max > 0) {
        levels.push(index + 1);
      }

      return levels;
    }, []),
  );

  /**
   * Круги для чипов отбора: круги заклинаний книги и круги с ячейками — ячейку
   * тратят и на повышение круга уже известного заклинания, поэтому такой круг
   * стоит в списке даже без своих заклинаний.
   */
  const availableLevelFilters = computed(() => {
    const levels = new Set<number>(slotLevels.value);

    for (const spell of props.actor.spells ?? []) {
      levels.add(spell.level);
    }

    return [...levels].sort((levelA, levelB) => levelA - levelB);
  });

  /** Кругов больше одного — есть между чем выбирать */
  const hasLevelChips = computed(() => availableLevelFilters.value.length > 1);

  /**
   * Подготовку отмечают только у заклинаний книги: в списке из одних заговоров
   * помечать нечего — чипа отбора нет.
   */
  const isPreparedFilterAvailable = computed(() =>
    (props.actor.spells ?? []).some((spell) => spell.level > 0),
  );

  /** Ряд отбора: нужен, только когда в списке есть что отбирать */
  const hasFilterControls = computed(
    () => (props.actor.spells?.length ?? 0) > 0,
  );

  /**
   * Значок ячеек — квадрат чипа отбора, как соседний значок свойств. Без поиска
   * (в книге пусто) распор справа держит уже он сам.
   */
  const slotsButtonClass = computed(() => [
    getFilterChipClass(hasSpellSlotBonuses.value, 'icon'),
    hasFilterControls.value ? '' : 'ml-auto',
  ]);

  /**
   * Чипы кругов: сам чип — номер круга, у заговоров вместо номера буква.
   * Полную подпись («Заговоры», «3-й круг») показывает подсказка по наведению —
   * ей ряд не поместился бы на узком листе. Единственный круг чипов не даёт:
   * выбирать не из чего.
   */
  const levelChips = computed(() => {
    if (!hasLevelChips.value) {
      return [];
    }

    return availableLevelFilters.value.map((level) => ({
      level,
      label:
        level === CANTRIP_SPELL_LEVEL
          ? SPELL_FILTER_LABELS.cantrip
          : String(level),
      tooltip:
        level === CANTRIP_SPELL_LEVEL
          ? SPELL_FILTER_LABELS.cantripHint
          : (SPELL_LEVEL_LABELS[level] ?? `${level}${SPELL_LEVEL_SUFFIX}`),
      isPicked: filterLevels.value.has(level),
    }));
  });

  /** Отмечено хотя бы одно свойство: чип раскрывающегося меню горит тёплым */
  const hasPropertyFilter = computed(() =>
    Object.values(propertyFilters.value).some((isPicked) => isPicked),
  );

  /** Чип, раскрывающий меню свойств: квадрат со значком отбора */
  const propertyMenuChipClass = computed(() =>
    getFilterChipClass(hasPropertyFilter.value, 'icon'),
  );

  /**
   * Отметка свойства не закрывает меню: свойств три, и ставят их обычно
   * подряд — закрытие после каждой галочки заставляло бы открывать меню заново.
   *
   * @param event - событие выбора пункта меню
   */
  function keepMenuOpen(event: Event): void {
    event.preventDefault();
  }

  /** Пункты меню свойств: отметка держится галочкой в самом меню */
  const propertyMenuItems = computed<DropdownMenuItem[]>(() =>
    SPELL_PROPERTY_FILTERS.map((property) => ({
      label: property.label,
      icon: property.icon,
      type: 'checkbox',
      checked: propertyFilters.value[property.key],
      onSelect: keepMenuOpen,
      onUpdateChecked: () => togglePropertyFilter(property.key),
    })),
  );

  /** Заклинания, прошедшие поиск и отбор */
  const filteredSpells = computed(() => {
    const spells = props.actor.spells ?? [];
    const query = searchQuery.value.toLowerCase().trim();

    return spells.filter((spell) => {
      if (query && !spell.name.toLowerCase().includes(query)) {
        return false;
      }

      if (filterLevels.value.size > 0 && !filterLevels.value.has(spell.level)) {
        return false;
      }

      if (filterPrepared.value && !isSpellReady(spell, cantripsTracked.value)) {
        return false;
      }

      // Лечение: лечащая хотя бы одна часть урона (токен @heal в формуле)
      if (
        propertyFilters.value.healing
        && !getSpellDamageParts(spell).some((part) => damagePartIsHealing(part))
      ) {
        return false;
      }

      if (propertyFilters.value.concentration && !spell.concentration) {
        return false;
      }

      if (propertyFilters.value.ritual && !spell.ritual) {
        return false;
      }

      return true;
    });
  });

  /**
   * Круги ячеек, чьи разделители остаются в списке: разделитель круга без
   * заклинаний нужен ради пузырьков — ячейку тратят и на повышение круга уже
   * известного заклинания. Под отбором по самим заклинаниям пустые разделители
   * только мешают списку найденного.
   */
  const groupSlotLevels = computed(() => {
    if (hasSpellFilter.value) {
      return [];
    }

    return filterLevels.value.size > 0
      ? slotLevels.value.filter((level) => filterLevels.value.has(level))
      : slotLevels.value;
  });

  /** Группировка заклинаний по кругам */
  const spellsByLevel = computed(() => {
    const spells = filteredSpells.value;
    const grouped = new Map<number, Spell[]>();

    // Выданные заговоры — от вида, черты, предыстории, умений класса — стоят
    // своей группой: они подготовлены всегда, а среди заговоров остаётся книга,
    // из которой игрок отмечает свои
    for (const spell of spells) {
      const groupLevel =
        spell.level === CANTRIP_SPELL_LEVEL && isGrantedSpell(spell)
          ? GRANTED_CANTRIPS_GROUP_LEVEL
          : spell.level;

      const existing = grouped.get(groupLevel) ?? [];

      existing.push(spell);
      grouped.set(groupLevel, existing);
    }

    for (const level of groupSlotLevels.value) {
      if (!grouped.has(level)) {
        grouped.set(level, []);
      }
    }

    // Сортировка по кругу
    const sortedEntries = [...grouped.entries()].sort(
      ([levelA], [levelB]) => levelA - levelB,
    );

    return sortedEntries.map(([level, levelSpells]) => {
      let max = 0;
      let used = 0;

      if (level > 0 && level <= maxSlots.value.length) {
        max = maxSlots.value[level - 1];
        // Отрицательная прибавка могла срезать ячейки, уже потраченные раньше:
        // потраченных не бывает больше, чем ячеек, иначе счётчик ушёл бы в минус
        used = Math.min(max, usedSlots.value[level - 1] ?? 0);
      }

      return {
        level,
        label:
          level === GRANTED_CANTRIPS_GROUP_LEVEL
            ? GRANTED_CANTRIPS_GROUP_LABEL
            : (SPELL_LEVEL_LABELS[level] ?? `${level}${SPELL_LEVEL_SUFFIX}`),
        spells: levelSpells,
        max,
        used,
      };
    });
  });

  /** Pact-слот level и count */
  const pactSlotInfo = computed(() =>
    getPactSlotInfo(props.actor.system?.classes ?? []),
  );

  /** Есть ли Pact-слоты (Warlock) */
  const hasPactSlots = computed(() => pactSlotInfo.value.max > 0);

  /**
   * Обновляет использованные ячейки
   *
   * @param slots - новый массив использованных слотов
   */
  function updateUsedSlots(slots: number[]): void {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        spellSlotsUsed: slots,
      },
    });

    triggerSaveIfNotEdit();
  }

  /**
   * Обновляет использованные Pact-ячейки
   *
   * @param count - количество использованных
   */
  function updatePactUsedSlots(count: number): void {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        pactSlotsUsed: count,
      },
    });

    triggerSaveIfNotEdit();
  }

  /**
   * Тогл обычного слота
   *
   * @param levelIndex - индекс круга (0-based)
   * @param slotIndex - индекс пузырька
   */
  function toggleSlot(levelIndex: number, slotIndex: number): void {
    const newUsed = [...usedSlots.value];
    const currentUsed = newUsed[levelIndex] ?? 0;

    // Клик по заполненному = восстановить, по пустому = использовать
    if (slotIndex < currentUsed) {
      newUsed[levelIndex] = slotIndex;
    } else {
      newUsed[levelIndex] = slotIndex + 1;
    }

    updateUsedSlots(newUsed);
  }

  /**
   * Тогл Pact-слота
   *
   * @param slotIndex - индекс пузырька
   */
  function togglePactSlot(slotIndex: number): void {
    const currentUsed = props.actor.system?.pactSlotsUsed ?? 0;

    if (slotIndex < currentUsed) {
      updatePactUsedSlots(slotIndex);
    } else {
      updatePactUsedSlots(slotIndex + 1);
    }
  }

  /**
   * Открывает форму редактирования заклинания
   *
   * @param spell - заклинание для редактирования
   */
  function openEditSpell(spell: Spell): void {
    openModal('SpellFormModal', {
      actorId: props.actor.id,
      spell,
      resolveCasterSaveDc: (source: SpellSaveDCSource) =>
        resolveSpellSaveDC(props.actor, source, resolvedStats.value),
      onSave: (updated: Spell) => {
        const currentSpells = props.actor.spells ?? [];

        const newSpells = currentSpells.map((existingSpell) =>
          existingSpell.id === updated.id ? updated : existingSpell,
        );

        emit('update:actor', { spells: newSpells });
        triggerSaveIfNotEdit();
      },
    });
  }

  /**
   * Удаляет заклинание
   *
   * @param spellId - ID заклинания
   */
  function deleteSpell(spellId: string): void {
    const currentSpells = props.actor.spells ?? [];

    const filteredSpells = currentSpells.filter(
      (spell) => spell.id !== spellId,
    );

    emit('update:actor', { spells: filteredSpells });

    const hotbarStore = useHotbarStore();

    hotbarStore.removeByRef(spellId);

    triggerSaveIfNotEdit();
  }

  /**
   * Отправляет карточку заклинания в чат без каста
   *
   * @param spell - заклинание
   */
  function shareSpell(spell: Spell): void {
    const chatStore = useChatStore();

    chatStore.sendItemCard({
      cardType: 'spell',
      title: spell.name,
      payload: JSON.stringify(spell),
    });
  }

  /**
   * Обновляет флаг подготовки заклинания
   *
   * @param spellId - ID заклинания
   * @param prepared - новое значение
   */
  function updatePrepared(spellId: string, prepared: boolean): void {
    const currentSpells = props.actor.spells ?? [];

    const spell = currentSpells.find(
      (existingSpell) => existingSpell.id === spellId,
    );

    if (prepared && spell && isOverPreparedLimit(spell)) {
      const isCantrip = spell.level === CANTRIP_SPELL_LEVEL;

      toast.add({
        title: isCantrip
          ? ACTOR_SPELLS_TAB_LABELS.cantripLimitTitle
          : ACTOR_SPELLS_TAB_LABELS.limitTitle,
        description: `${
          isCantrip
            ? ACTOR_SPELLS_TAB_LABELS.cantripLimitTextPrefix
            : ACTOR_SPELLS_TAB_LABELS.limitTextPrefix
        }${preparedLimitOf(spell)}${ACTOR_SPELLS_TAB_LABELS.limitTextSuffix}`,
        color: 'warning',
      });

      return;
    }

    const newSpells = currentSpells.map((spell) =>
      spell.id === spellId ? { ...spell, prepared } : spell,
    );

    emit('update:actor', { spells: newSpells });
    triggerSaveIfNotEdit();
  }

  /**
   * Предел, в который упирается отметка заклинания: у заговора — колонка
   * «Заговоры», у заклинания — «Подг. закл.». 0 — предела нет.
   *
   * @param spell - отмечаемое заклинание
   */
  function preparedLimitOf(spell: Spell): number {
    return spell.level === CANTRIP_SPELL_LEVEL
      ? (cantripsLimit.value.value ?? 0)
      : maxPreparedSpells.value;
  }

  /**
   * Займёт ли отметка место сверх предела. Заклинание, которое в счёт не идёт
   * (выданное видом, чертой, домен), отмечается без оглядки на предел.
   *
   * @param spell - отмечаемое заклинание
   * @returns true — место кончилось
   */
  function isOverPreparedLimit(spell: Spell): boolean {
    const limit = preparedLimitOf(spell);
    const marked = { ...spell, prepared: true };

    if (spell.level === CANTRIP_SPELL_LEVEL) {
      return (
        limit > 0
        && countsTowardCantrips(marked)
        && currentCantripsCount.value >= limit
      );
    }

    return (
      limit > 0
      && countsTowardPreparedSpells(marked)
      && currentPreparedSpellsCount.value >= limit
    );
  }

  /**
   * Подпись под названием заклинания — школа магии. Круг называть незачем: он
   * стоит в заголовке раздела, под которым лежит строка.
   *
   * @param spell - заклинание
   * @returns название школы
   */
  function getSpellSubtitle(spell: Spell): string {
    return SPELL_SCHOOL_LABELS[spell.school] ?? '';
  }

  /** Название типа урона по справочнику мира — для подсказки плитки */
  const getDamageTypeLabel = useDamageTypeLabel();

  /**
   * Плитки строки заклинания: урон (катится по нажатию) и заряды у врождённых
   * заклинаний, которые ячеек не тратят.
   *
   * @param spell - заклинание
   * @returns плитки в порядке показа
   */
  function getSpellStats(spell: Spell): SheetRowStat[] {
    const stats: SheetRowStat[] = [];

    const damage = describeSpellDamageDisplay(spell, { actor: props.actor });

    if (damage.formula) {
      stats.push({
        key: 'damage',
        label: SPELL_STAT_LABELS.damage,
        value: formatDamageTileFormula(damage.baseFormula),
        accent: true,
        rollable: true,
        // Добавки по условию и тип на выбор в плитке не пишутся — значок и
        // строки подсказки
        ...describeDamageVariantsStat(
          spell,
          SPELL_STAT_HINTS.damage,
          getDamageTypeLabel,
          damage.conditionalFormulas,
        ),
      });
    }

    // «По желанию» заряды не тратит — считать там нечего
    if (spell.uses && spell.uses.recovery !== 'atWill') {
      const isEmpty = spell.uses.current <= 0;

      stats.push({
        key: 'uses',
        label: SPELL_STAT_LABELS.uses,
        value: `${spell.uses.current}/${spell.uses.max}`,
        tooltip: isEmpty
          ? SPELL_STAT_HINTS.usesEmpty
          : SPELL_USES_RECOVERY_LABELS[spell.uses.recovery],
        accent: !isEmpty,
      });
    }

    return stats;
  }

  /**
   * Пункты меню строки заклинания. Меню одно на правую кнопку мыши и на «⋮»,
   * а порядок тот же, что и у снаряжения: сначала состояние, потом действие,
   * следом правка записи и удаление.
   *
   * @param spell - заклинание
   * @returns группы пунктов для `UContextMenu` и `UDropdownMenu`
   */
  function getSpellMenuItems(spell: Spell): DropdownMenuItem[][] {
    const gameActions: DropdownMenuItem[] = [];

    // Подготовка — отметка, а не действие: у выданного заговора и заклинания
    // домена её нет, они готовы всегда
    if (canTogglePrepared(spell)) {
      gameActions.push({
        label: SPELL_MENU_LABELS.prepared,
        icon: 'tabler:wand',
        type: 'checkbox',
        checked: isSpellReady(spell, cantripsTracked.value),
        onUpdateChecked: (checked: boolean) =>
          updatePrepared(spell.id, checked),
      });
    }

    gameActions.push({
      label: SPELL_MENU_LABELS.cast,
      icon: 'tabler:sparkles',
      onSelect: () => castSpell(spell),
    });

    return [
      gameActions,
      [
        {
          label: SHEET_ROW_MENU_LABELS.edit,
          icon: 'tabler:edit',
          onSelect: () => openEditSpell(spell),
        },
        {
          label: SHEET_ROW_MENU_LABELS.share,
          icon: 'tabler:message-share',
          onSelect: () => shareSpell(spell),
        },
      ],
      [
        {
          label: SHEET_ROW_MENU_LABELS.remove,
          icon: 'tabler:trash',
          color: 'error',
          onSelect: () => deleteSpell(spell.id),
        },
      ],
    ];
  }

  /**
   * Начало перетаскивания строки заклинания: на хотбар кладётся макрос каста,
   * а MIME с самим заклинанием позволяет перенести его на другой лист.
   *
   * @param event - событие dragstart
   * @param spell - заклинание
   */
  function handleSpellDragStart(event: DragEvent, spell: Spell): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(SPELL_MIME, JSON.stringify(spell));

    startHotbarDrag(event, {
      id: spell.id,
      type: 'spell-cast',
      label: spell.name,
      icon: 'tabler:wand',
      ref: spell.id,
      actorId: props.actor.id,
    });
  }

  /** Переключает подготовку заклинания из строки списка */
  function toggleSpellPrepared(spell: Spell): void {
    updatePrepared(spell.id, !isSpellReady(spell, cantripsTracked.value));
  }

  /**
   * Заклинания по кругам, уже с подписью, плитками и меню каждой строки.
   *
   * Собираются вычислимым, а не вызовами из шаблона: разбор формулы урона
   * поднимает характеристики персонажа, и из шаблона он шёл бы на каждую
   * перерисовку списка — на книге в полсотни заклинаний это заметно.
   */
  const spellRowGroups = computed(() =>
    spellsByLevel.value.map((group) => ({
      ...group,
      rows: group.spells.map((spell) => ({
        spell,
        subtitle: getSpellSubtitle(spell),
        stats: getSpellStats(spell),
        menuItems: getSpellMenuItems(spell),
        castBlockedReason: findSpellCastBlock(actionBlocks.value, spell),
      })),
    })),
  );

  /** Открыто ли окно детального просмотра (используется для перехвата cast) */
  function openSpellDetail(spell: Spell): void {
    openModal('SpellDetailModal', {
      spell,
      showCastButton: true,
      onCast: () => castSpell(spell),
    });
  }

  /**
   * Заклинатель-лист для общего разбора каста: тот же заклинатель мира, что у
   * горячей панели (ячейку списывает бросок окна, а окно переживает вкладку),
   * отказ — уведомлением.
   *
   * @returns порт заклинателя
   */
  function createSheetCasterPort(): SpellCasterPort {
    return createSpellCasterPort(props.actor.id, (_spell, refusal) => {
      toast.add({
        title: refusal.title,
        description: refusal.description,
        color: 'warning',
      });
    });
  }

  /**
   * Запускает каст заклинания — общим разбором каста, тем же, что у горячей
   * панели.
   *
   * @param sourceSpell - заклинание для каста; эффекты — до выбора варианта
   */
  function castSpell(sourceSpell: Spell): void {
    startSpellCast(sourceSpell, createSheetCasterPort());
  }
</script>

<template>
  <div class="relative flex min-h-50 flex-col space-y-4">
    <!-- Шапка вкладки: ряд плиток и ряд отбора. Оба ряда и промежуток между
      ними — те же, что у шапки снаряжения: у листа одна шапка на все вкладки,
      и расходиться она не должна -->
    <div class="mb-2 flex flex-col gap-2">
      <!-- Плитки заклинательства и подготовки -->
      <div class="flex flex-wrap items-center gap-2">
        <SheetStatTile
          :cells="spellcastingCells"
          :aria-label="ACTOR_SPELLS_TAB_LABELS.spellcastingSettings"
          clickable
          @click="isSettingsModalOpen = true"
        />

        <SheetStatTile
          v-for="tile in preparedTiles"
          :key="tile.kind"
          :cells="tile.cells"
          :tooltip="tile.tooltip"
          :aria-label="ACTOR_SPELLS_TAB_LABELS.preparedLimitSettings"
          clickable
          @click="openPreparedModal(tile.kind)"
        />

        <!-- Книгу пополняют здесь: мастер уровня заклинания не спрашивает —
          их называет запись, которая их даёт, а остальное игрок берёт сам -->
        <UButton
          icon="tabler:plus"
          color="primary"
          variant="soft"
          :size="FILTER_ROW_CONTROL_SIZE"
          class="ml-auto shrink-0"
          @click.left.exact.prevent="isSpellBrowserOpen = true"
        >
          {{ ACTOR_SPELLS_TAB_LABELS.add }}
        </UButton>
      </div>

      <!-- Поиск и отбор одной строкой: слева чипы отбора (подготовка, круги),
        справа — поле поиска, свойства и сброс. Разносит их распор на поле
        поиска. Чипы лежат в ряду поштучно, без вложенных групп: иначе круги
        переносятся на новую строку все разом, даже когда место ещё есть -->
      <div class="flex flex-wrap items-center gap-x-1.5 gap-y-2">
        <!-- Ряд стоит и у пустой книги: в нём значок ячеек, а ячейки добавляют
          и персонажу без заклинаний — воину от черты или предмета -->
        <template v-if="hasFilterControls">
          <FilterChip
            v-if="isPreparedFilterAvailable"
            :label="SPELL_FILTER_LABELS.prepared"
            :tooltip="SPELL_FILTER_LABELS.preparedHint"
            icon="tabler:wand"
            :picked="filterPrepared"
            @toggle="togglePreparedFilter"
          />

          <!-- Круги — числами, как в справочнике заклинаний: подписью целиком
        («Заговоры», «3-й круг») ряд бы не поместился на узком листе, поэтому
        она уходит в подсказку -->
          <FilterChip
            v-for="levelChip in levelChips"
            :key="levelChip.level"
            :label="levelChip.label"
            :tooltip="levelChip.tooltip"
            :picked="levelChip.isPicked"
            @toggle="toggleLevelFilter(levelChip.level)"
          />

          <UInput
            v-model="searchQuery"
            icon="tabler:search"
            :placeholder="SHEET_FILTER_LABELS.search"
            :size="FILTER_ROW_CONTROL_SIZE"
            class="ml-auto w-40 shrink-0"
            :ui="{ trailing: 'pe-0.5' }"
          >
            <template
              v-if="searchQuery"
              #trailing
            >
              <UButton
                icon="tabler:x"
                color="neutral"
                variant="link"
                :size="FILTER_ROW_CONTROL_SIZE"
                :aria-label="SHEET_FILTER_LABELS.clear"
                @click.left.exact.prevent="clearSearch"
              />
            </template>
          </UInput>

          <!-- Свойства заклинания живут в раскрывающемся меню: обращаются к ним
        реже, чем к кругам, а места чипами занимали столько же. Отметки стоят
        галочками в самом меню, и оно не закрывается после каждой -->
          <UDropdownMenu
            :items="propertyMenuItems"
            :content="{ align: 'end' }"
          >
            <!-- Отметку свойств несут галочки пунктов меню, а не сама кнопка:
          `aria-pressed` на ней спорил бы с ролью кнопки, раскрывающей меню -->
            <UTooltip :text="SPELL_FILTER_LABELS.propertiesHint">
              <button
                type="button"
                :class="propertyMenuChipClass"
                :aria-label="SPELL_FILTER_LABELS.properties"
              >
                <UIcon
                  name="tabler:adjustments-horizontal"
                  class="size-4"
                />
              </button>
            </UTooltip>
          </UDropdownMenu>
        </template>

        <!-- Своя прибавка к ячейкам: настройка листа, а не отбор, но живёт
          рядом со значком свойств — одним значком, чтобы не теснить плитки -->
        <UTooltip :text="slotsButtonTooltip">
          <button
            type="button"
            :class="slotsButtonClass"
            :aria-label="ACTOR_SPELLS_TAB_LABELS.slotsSettings"
            @click.left.exact.prevent="isSlotsModalOpen = true"
          >
            <UIcon
              name="tabler:circles"
              class="size-4"
            />
          </button>
        </UTooltip>

        <FilterResetButton
          v-if="hasAnyFilter"
          @reset="resetFilters"
        />
      </div>
    </div>

    <!-- Ячейки Pact Magic -->
    <div
      v-if="hasPactSlots"
      class="space-y-1"
    >
      <div class="flex items-center gap-2 px-1 pt-2 pb-1">
        <span
          class="shrink-0 text-xs font-semibold tracking-wider text-magic uppercase"
        >
          {{ ACTOR_SPELLS_TAB_LABELS.pact }}
          <template v-if="pactSlotInfo.level"
            >({{ pactSlotInfo.level }})</template
          >
        </span>

        <div class="h-px flex-1 bg-accented/50" />

        <div class="flex items-center gap-2">
          <!-- Пузырьки Pact Magic -->
          <div class="flex items-center gap-1">
            <button
              v-for="slotIndex in pactSlotInfo.max"
              :key="slotIndex"
              class="h-4 w-4 shrink-0 cursor-pointer rounded-full border-2 transition-colors"
              :class="
                slotIndex <= (actor.system?.pactSlotsUsed ?? 0)
                  ? 'border-magic bg-magic/30'
                  : 'border-accented bg-transparent hover:border-accented'
              "
              :title="`${ACTOR_SPELLS_TAB_LABELS.pact}: ${
                slotIndex <= (actor.system?.pactSlotsUsed ?? 0)
                  ? ACTOR_SPELLS_TAB_LABELS.slotUsed
                  : ACTOR_SPELLS_TAB_LABELS.slotAvailable
              }`"
              @click.left.exact.prevent="togglePactSlot(slotIndex - 1)"
            />
          </div>

          <!-- Счётчик Pact Magic -->
          <span class="w-6 shrink-0 text-right text-xs text-dimmed">
            {{ pactSlotInfo.max - (actor.system?.pactSlotsUsed ?? 0) }}/{{
              pactSlotInfo.max
            }}
          </span>
        </div>
      </div>
    </div>

    <!-- Заклинания по кругам -->
    <div
      v-for="group in spellRowGroups"
      :key="group.level"
      class="space-y-1"
    >
      <!-- Заголовок круга -->
      <div class="flex items-center gap-2 px-1 pt-2 pb-1">
        <span
          class="shrink-0 text-xs font-semibold tracking-wider text-muted uppercase"
        >
          {{ group.label }}
        </span>

        <div class="h-px flex-1 bg-accented/50" />

        <!-- Ячейки заклинаний (выводим справа от заголовка) -->
        <div
          v-if="group.level > 0 && group.max > 0"
          class="flex items-center gap-2"
        >
          <!-- Пузырьки -->
          <div class="flex items-center gap-1">
            <button
              v-for="slotIndex in group.max"
              :key="slotIndex"
              class="h-4 w-4 shrink-0 cursor-pointer rounded-full border-2 transition-colors"
              :class="
                slotIndex <= group.used
                  ? 'border-success bg-success/30'
                  : 'border-accented bg-transparent hover:border-accented'
              "
              :title="`${group.label}: ${
                slotIndex <= group.used
                  ? ACTOR_SPELLS_TAB_LABELS.slotUsed
                  : ACTOR_SPELLS_TAB_LABELS.slotAvailable
              }`"
              @click.left.exact.prevent="
                toggleSlot(group.level - 1, slotIndex - 1)
              "
            />
          </div>

          <!-- Счётчик -->
          <span class="w-6 shrink-0 text-right text-xs text-dimmed">
            {{ group.max - group.used }}/{{ group.max }}
          </span>
        </div>
      </div>

      <!-- Список заклинаний в круге -->
      <ActorSpellRow
        v-for="row in group.rows"
        :key="row.spell.id"
        :spell="row.spell"
        :subtitle="row.subtitle"
        :stats="row.stats"
        :menu-items="row.menuItems"
        :cantrips-tracked="cantripsTracked"
        :cast-blocked-reason="row.castBlockedReason"
        @open="openSpellDetail(row.spell)"
        @cast="castSpell(row.spell)"
        @toggle-prepared="toggleSpellPrepared(row.spell)"
        @dragstart="handleSpellDragStart($event, row.spell)"
      />
    </div>

    <!-- Пусто -->
    <div
      v-if="!actor.spells || actor.spells.length === 0"
      class="flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors"
      :class="
        isDragOver
          ? 'border-primary/50 bg-primary/5 text-primary'
          : 'border-transparent text-dimmed'
      "
    >
      <UIcon
        name="tabler:wand"
        class="mb-2 h-8 w-8 opacity-50"
      />

      <p>{{ ACTOR_SPELLS_TAB_LABELS.empty }}</p>
    </div>

    <!-- Отбор ничего не оставил: пустое место объясняет, почему список пуст -->
    <div
      v-else-if="spellsByLevel.length === 0"
      class="flex items-center justify-center rounded-lg border border-dashed border-default p-8 text-center text-sm text-dimmed"
    >
      {{ SHEET_FILTER_LABELS.empty }}
    </div>

    <!-- Настройка предела подготовки (открывается нажатием на плитку) -->
    <PreparedSpellsModal
      v-model:open="isPreparedModalOpen"
      :kind="editedPreparedKind"
      :limit="editedPreparedSettings"
      :class-value="editedPreparedLimit.classValue"
      :context="spellcastingBonusContext"
      @apply="applyPreparedLimit"
    />

    <!-- Свои бонусы к ячейкам (открывается значком в ряду отбора) -->
    <SpellSlotsModal
      v-model:open="isSlotsModalOpen"
      :class-slots="classSlots"
      :settings="spellSlotSettings"
      :context="spellcastingBonusContext"
      @apply="applySpellSlotSettingsUpdate"
    />

    <!-- Настройка заклинательства (открывается нажатием на плитку) -->
    <SpellcastingSettingsModal
      v-model:open="isSettingsModalOpen"
      :actor="actor"
      :ability-mods="resolvedStats.abilityMods"
      :proficiency-bonus="resolvedStats.proficiencyBonus"
      :save-dc-effect-bonus="saveDcEffectBonus"
      :attack-effect-bonus="resolvedStats.attackBonuses.spell"
      @update:actor="handleSpellcastingUpdate"
    />

    <!-- Компендиум заклинаний: сколько взять — решает не окно, а таблица
      класса на плитках шапки, поэтому выбор здесь без предела -->
    <CompendiumDataModal
      v-if="isSpellBrowserOpen"
      v-model:open="isSpellBrowserOpen"
      :socket="getWorldSocket()"
      data-kind="spell"
      :title="ACTOR_SPELLS_TAB_LABELS.addTitle"
      :initial-class-filter="spellBrowserClassKey"
      :preferred-pack-id="spellBrowserPackId"
      :known-spell-names="knownSpellNames"
      unlimited-selection
      @select-spells="addSpellsFromCompendium"
    />
  </div>
</template>
