<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { SceneEntity } from '@vtt/shared';
  import type {
    AttackRollMode,
    DnDActor,
    DnDCustomBonusContext,
    DnDPreparedLimit,
    PreparedKind,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type {
    RolledSpellDamagePart,
    SpellDamagePartInput,
  } from '../../../composables/useSpellResolution';
  import type { SpellPropertyFilterKey } from '../constants';
  import type { SheetRowStat } from '../sheetRowTypes';

  import { useToast } from '@nuxt/ui/composables';
  import { computed, ref } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useActionPromptStore } from '@/stores/actionPromptStore';
  import { useAuraStore } from '@/stores/auraStore';
  import { useChatStore } from '@/stores/chatStore';
  import { useHotbarStore } from '@/stores/hotbarStore';
  import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
  import { useTargetStore } from '@/stores/targetStore';
  import { useWorldStore } from '@/stores/worldStore';
  import { isRecord } from '@vtt/shared';
  import {
    calculateSpellAttackModifier,
    CANTRIP_SPELL_LEVEL,
    collectActiveEffects,
    combineEffectsWithAmbient,
    computeSpellSlots,
    damagePartIsHealing,
    DEFAULT_PREPARED_LIMIT,
    getAvailableSpellLevels,
    getClassPreparedValue,
    getPactSlotInfo,
    getPreparedLimitBreakdown,
    getSpellAttackBreakdown,
    getSpellAttackType,
    getSpellDamageParts,
    getSpellPrimaryDamageType,
    getSpellProjectileCount,
    getSpellSaveDCBreakdown,
    getTotalLevel,
    isDnDEffect,
    isDndSceneEntity,
    parseSpellcastingSettings,
    pickCantripTierParts,
    PREPARED_LIMIT_EMPTY_VALUE,
    resolveActorStats,
    resolveDamagePartsForCast,
    resolveEntityCreatureType,
    resolveSpellDamageFormula,
    resolveSpellSaveDC,
    SPELL_DAMAGE_TEMPLATE_COLORS,
    SPELL_LEVEL_LABELS,
    SPELL_SCHOOL_LABELS,
    SPELL_TEMPLATE_DEFAULT_COLOR,
    SPELL_USES_RECOVERY_LABELS,
    spellIsHealing,
    withFlatDamageBonus,
    withFlatFormulaBonus,
  } from '@vtt/shared/system/dnd.js';

  import {
    getCasterSpellEffects,
    getTargetSpellEffects,
    instantiateSpellEffects,
  } from '../../../composables/spellResolutionShared';
  import {
    useBonusDamageParts,
    withFlatDamageBonusPart,
  } from '../../../composables/useBonusDamageParts';
  import { useClassDefinitions } from '../../../composables/useClassDefinitions';
  import {
    getSpellMaxRangeOnScene,
    isSpellCastBlockedByRange,
    isSpellTargetBlockedByRange,
  } from '../../../composables/useSceneRangeCheck';
  import { useSpellResolution } from '../../../composables/useSpellResolution';
  import ActorSpellRow from '../ActorSpellRow.vue';
  import {
    ACTOR_SPELLS_TAB_LABELS,
    FILTER_ROW_CONTROL_SIZE,
    SHEET_FILTER_LABELS,
    SHEET_ROW_MENU_LABELS,
    SPELL_DAMAGE_ROLL_BUTTON,
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
  import { getFilterChipClass } from '../utils/filterChipClass';
  import { formatSignedNumber } from '../utils/formatSignedNumber';
  import { formatSpellDamageDisplay } from '../utils/formatSpellDamageDisplay';

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
  const worldStore = useWorldStore();
  const chatStore = useChatStore();
  const targetStore = useTargetStore();

  const {
    needsAutoResolution,
    resolveSpellDamage,
    resolveSpellDamageWithParts,
  } = useSpellResolution();

  const { hasSpellBonusDamage, buildSpellBonusEvaluator } =
    useBonusDamageParts();

  function getCurrentWorldEntities(): SceneEntity[] {
    const worldId = worldStore.connectionState.currentWorldId;

    if (!worldId) {
      return [];
    }

    const world = worldStore.worlds.find(
      (worldEntry) => worldEntry.id === worldId,
    );

    if (!world) {
      return [];
    }

    return [...(world.actors ?? []), ...(world.creatures ?? [])];
  }

  function getWorldSocket() {
    return chatStore.getSocket();
  }

  /**
   * Накладывает «самобафф»-эффекты заклинания (effectTarget 'self' или без
   * значения) на самого заклинателя. Нужно для заклинаний без урона/цели-врага
   * вроде Щита: эффект добавляется в `activeEffects` актёра тем же partial-
   * апдейтом, что и заклинания/ячейки (родитель сливает по верхним ключам, не
   * затирая параллельные изменения), и анонсируется в чат.
   *
   * @param spell - заклинание
   */
  function applyCasterSpellEffects(spell: Spell): void {
    const casterEffects = getCasterSpellEffects(spell);

    if (casterEffects.length === 0) {
      return;
    }

    emit('update:actor', {
      activeEffects: [
        ...(props.actor.activeEffects ?? []),
        ...instantiateSpellEffects(casterEffects),
      ],
    });

    triggerSaveIfNotEdit();

    chatStore.sendMessage(
      `${spell.name}\n→ ${props.actor.name}: [${casterEffects
        .map((effect) => effect.name)
        .join(', ')}]`,
      'text',
    );
  }

  /**
   * Накладывает эффекты заклинания с `effectTarget: 'target'` на ВЫБРАННУЮ
   * цель. Переиспользует общий `targetStore.applyEffectsToTarget` (тот же путь,
   * что у оружия и существ: клон цели, новые id, origin, разворачивание
   * condition-шаблонов, эмит actor/creature:updated). Для безуронных заклинаний
   * это единственный фидбек, поэтому дополнительно пишем строку в чат.
   *
   * @param spell - заклинание
   */
  function applyTargetSpellEffects(spell: Spell): void {
    const targetEffects = getTargetSpellEffects(spell);

    if (targetEffects.length === 0) {
      return;
    }

    const targetName = targetStore.applyEffectsToTarget(targetEffects, 'spell');

    if (targetName) {
      chatStore.sendMessage(
        `${spell.name}\n→ ${targetName}: [${targetEffects
          .map((effect) => effect.name)
          .join(', ')}]`,
        'text',
      );
    }
  }

  const isSettingsModalOpen = ref(false);

  /** Resolved stats для отображения Spell Save DC и бонуса атаки */
  const resolvedStats = computed(() => resolveActorStats(props.actor));

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

  /** Числа листа, от которых считаются свои бонусы настройки */
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

  /** Карта casterType для computeSpellSlots */
  const casterTypeMap = computed(() => {
    const typeMap = new Map<
      string,
      import('@vtt/shared/system/dnd.js').CasterType
    >();

    const classes = props.actor.system?.classes ?? [];

    for (const entry of classes) {
      if (entry.casterType) {
        typeMap.set(entry.classKey, entry.casterType);
      }
    }

    return typeMap;
  });

  /** Максимальные ячейки заклинаний */
  const maxSlots = computed(() =>
    computeSpellSlots(props.actor.system?.classes ?? [], casterTypeMap.value),
  );

  /** Классы компендиума и созданные в мире — по ним читается таблица уровней */
  const { classDefinitions } = useClassDefinitions();

  /**
   * Предел подготовленных заклинаний: число из таблицы класса компендиума с
   * поправками листа (своё число либо бонус к числу класса).
   */
  const preparedSpellsLimit = computed(() =>
    getPreparedLimitBreakdown(
      getClassPreparedValue(
        props.actor.system?.classes ?? [],
        classDefinitions.value,
        'spells',
      ),
      props.actor.system?.preparedSpells,
    ),
  );

  /** Предел заговоров — тот же расчёт, но по своей колонке таблицы класса */
  const cantripsLimit = computed(() =>
    getPreparedLimitBreakdown(
      getClassPreparedValue(
        props.actor.system?.classes ?? [],
        classDefinitions.value,
        'cantrips',
      ),
      props.actor.system?.preparedCantrips,
    ),
  );

  /**
   * Предел подготовки числом: 0 означает «предела нет» — так его понимает
   * проверка при отметке заклинания.
   */
  const maxPreparedSpells = computed(
    () => preparedSpellsLimit.value.value ?? 0,
  );

  /** Текущее количество подготовленных заклинаний */
  const currentPreparedSpellsCount = computed(() => {
    const spells = props.actor.spells ?? [];

    return spells.filter(
      (spell) => spell.prepared && !spell.alwaysPrepared && spell.level > 0,
    ).length;
  });

  /**
   * Заговоры в книге. Отмечать их подготовку негде — заговор всегда при
   * заклинателе, поэтому считаются все, а не только помеченные.
   */
  const currentCantripsCount = computed(
    () =>
      (props.actor.spells ?? []).filter((spell) => spell.level === 0).length,
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

  /** Сохранённая настройка предела, открытого в модалке */
  const editedPreparedSettings = computed<DnDPreparedLimit>(() =>
    editedPreparedKind.value === 'cantrips'
      ? (props.actor.system?.preparedCantrips ?? DEFAULT_PREPARED_LIMIT)
      : (props.actor.system?.preparedSpells ?? DEFAULT_PREPARED_LIMIT),
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

  /** Использованные ячейки */
  const usedSlots = computed(
    () => props.actor.system?.spellSlotsUsed ?? [0, 0, 0, 0, 0, 0, 0, 0, 0],
  );

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

  /**
   * Подготовленное заклинание: отметка листа либо всегда подготовленное. У
   * заговора отметки нет — он при заклинателе всегда и из отбора не выпадает.
   *
   * @param spell - заклинание книги
   * @returns true — заклинание доступно без подготовки
   */
  function isSpellReady(spell: Spell): boolean {
    return (
      spell.level === CANTRIP_SPELL_LEVEL
      || Boolean(spell.prepared)
      || Boolean(spell.alwaysPrepared)
    );
  }

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

      if (filterPrepared.value && !isSpellReady(spell)) {
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

    for (const spell of spells) {
      const existing = grouped.get(spell.level) ?? [];

      existing.push(spell);
      grouped.set(spell.level, existing);
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
        used = usedSlots.value[level - 1] ?? 0;
      }

      return {
        level,
        label: SPELL_LEVEL_LABELS[level] ?? `${level}${SPELL_LEVEL_SUFFIX}`,
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

    if (prepared && maxPreparedSpells.value > 0) {
      const spell = currentSpells.find(
        (existingSpell) => existingSpell.id === spellId,
      );

      if (
        spell
        && !spell.alwaysPrepared
        && currentPreparedSpellsCount.value >= maxPreparedSpells.value
      ) {
        const toast = useToast();

        toast.add({
          title: ACTOR_SPELLS_TAB_LABELS.limitTitle,
          description: `${ACTOR_SPELLS_TAB_LABELS.limitTextPrefix}${maxPreparedSpells.value}${ACTOR_SPELLS_TAB_LABELS.limitTextSuffix}`,
          color: 'warning',
        });

        return;
      }
    }

    const newSpells = currentSpells.map((spell) =>
      spell.id === spellId ? { ...spell, prepared } : spell,
    );

    emit('update:actor', { spells: newSpells });
    triggerSaveIfNotEdit();
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

  /**
   * Плитки строки заклинания: урон (катится по нажатию) и заряды у врождённых
   * заклинаний, которые ячеек не тратят.
   *
   * @param spell - заклинание
   * @returns плитки в порядке показа
   */
  function getSpellStats(spell: Spell): SheetRowStat[] {
    const stats: SheetRowStat[] = [];

    const damage = formatSpellDamageDisplay(spell, props.actor);

    if (damage) {
      stats.push({
        key: 'damage',
        label: SPELL_STAT_LABELS.damage,
        value: damage,
        tooltip: SPELL_STAT_HINTS.damage,
        accent: true,
        rollable: true,
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

    // Подготовка — отметка, а не действие: у заговора и сигнатурного
    // заклинания подкласса её нет, они готовы всегда
    if (spell.level > CANTRIP_SPELL_LEVEL && !spell.alwaysPrepared) {
      gameActions.push({
        label: SPELL_MENU_LABELS.prepared,
        icon: 'tabler:wand',
        type: 'checkbox',
        checked: Boolean(spell.prepared),
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
    updatePrepared(spell.id, !spell.prepared);
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
   * Доступные круги для каста. У заклинаний с зарядами (врождённые/расовые)
   * круг фиксирован и ячейки не тратятся; у обычных — доступные ячейки
   * (или [0] для заговоров).
   * @param spell - заклинание
   * @returns массив доступных кругов
   */
  function getCastableSpellLevels(spell: Spell): number[] {
    if (spell.uses) {
      return [spell.level];
    }

    if (spell.level > 0) {
      return getAvailableSpellLevels(props.actor, spell.level);
    }

    return [0];
  }

  /**
   * Запускает процесс каста заклинания.
   * Отправляет карточку в чат и открывает DiceRollModal с секцией выбора круга.
   * @param spell - заклинание для каста
   */
  function castSpell(spell: Spell): void {
    // Заклинания с зарядами (врождённые/расовые) не тратят ячейки: проверяем
    // только заряды, без проверки доступных ячеек заклинаний.
    if (
      spell.uses
      && spell.uses.recovery !== 'atWill'
      && spell.uses.current <= 0
    ) {
      const toast = useToast();

      toast.add({
        title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
        description: `${ACTOR_SPELLS_TAB_LABELS.noUsesTextPrefix}${spell.name}${ACTOR_SPELLS_TAB_LABELS.noUsesTextSuffix}`,
        color: 'warning',
      });

      return;
    }

    const availableLevels = getCastableSpellLevels(spell);

    if (!spell.uses && spell.level > 0 && availableLevels.length === 0) {
      const toast = useToast();

      toast.add({
        title: ACTOR_SPELLS_TAB_LABELS.noSlotsTitle,
        description: `${ACTOR_SPELLS_TAB_LABELS.noSlotsTextPrefix}${spell.level}${ACTOR_SPELLS_TAB_LABELS.noSlotsTextSuffix}`,
        color: 'error',
      });

      return;
    }

    // Снарядный режим: число снарядов зависит от контекста каста
    // (заговоры — от уровня персонажа, уровневые — от круга ячейки)
    const casterLevel = getTotalLevel(props.actor.system?.classes);

    const baseProjectileCount = getSpellProjectileCount(spell, {
      slotLevel: availableLevels[0] ?? spell.level,
      casterLevel,
    });

    const hasProjectiles = baseProjectileCount > 1 && !spell.areaOfEffect;

    // Проверка дистанции каста до выбранной цели (только одиночная цель:
    // у AoE и снарядов собственные механики таргетинга)
    if (
      !spell.areaOfEffect
      && !hasProjectiles
      && isSpellCastBlockedByRange(spell, props.actor.id)
    ) {
      return;
    }

    // Ветка 1: Если есть область действия — пропускаем зелёный prompt, сразу начинаем применять (появится шаблон на курсоре)
    if (spell.areaOfEffect) {
      proceedWithCastSpell(spell);

      return;
    }

    if (hasProjectiles) {
      // Запускаем режим выбора целей (снарядов) с отдельным промптом
      import('@/stores/projectileStore').then(({ useProjectileStore }) => {
        const projectileStore = useProjectileStore();

        projectileStore.startTargeting(
          spell.projectiles?.targetDistribution ?? null,
          baseProjectileCount,
          (tokenId) =>
            !isSpellTargetBlockedByRange(spell, props.actor.id, tokenId),
        );

        openModal('ProjectilePromptModal', {
          spell,
          casterLevel,
          availableSpellLevels: availableLevels,
          onConfirm: (selectedLevel: number) => {
            proceedWithCastSpell(spell, selectedLevel);
          },
        });
      });

      return;
    }

    // Ветка 2: Обычные заклинания — сначала спрашиваем подтверждение через зелёный prompt
    const promptStore = useActionPromptStore();
    const promptId = `spell-cast-${spell.id}`;

    promptStore.addPrompt({
      id: promptId,
      icon: 'tabler:wand',
      title: `${ACTOR_SPELLS_TAB_LABELS.castConfirmPrefix}${spell.name}${ACTOR_SPELLS_TAB_LABELS.castConfirmSuffix}`,
      color: 'neutral',
      actions: [
        {
          icon: 'tabler:check',
          color: 'primary',
          onClick: () => {
            promptStore.removePrompt(promptId);
            proceedWithCastSpell(spell);
          },
        },
        {
          icon: 'tabler:x',
          color: 'neutral',
          variant: 'ghost',
          onClick: () => {
            promptStore.removePrompt(promptId);
          },
        },
      ],
    });
  }

  /**
   * Продолжает каст после финального подтверждения в Floating Prompt.
   */
  /**
   * Списывает один заряд заклинания с откатом (recovery !== 'atWill').
   * Заклинания без зарядов и «по желанию» не изменяются.
   * @param spell - заклинание
   */
  function consumeSpellUse(spell: Spell): void {
    if (!spell.uses || spell.uses.recovery === 'atWill') {
      return;
    }

    const newSpells = (props.actor.spells ?? []).map((entry) =>
      entry.id === spell.id && entry.uses
        ? {
            ...entry,
            uses: {
              ...entry.uses,
              current: Math.max(0, entry.uses.current - 1),
            },
          }
        : entry,
    );

    emit('update:actor', { spells: newSpells });
    triggerSaveIfNotEdit();
  }

  function proceedWithCastSpell(spell: Spell, lockedSpellLevel?: number): void {
    // Списываем заряд заклинания с откатом (врождённые/расовые) единожды на каст
    consumeSpellUse(spell);

    // Если есть область действия — сначала размещаем шаблон на сцене
    if (spell.areaOfEffect) {
      const templateStore = useSpellTemplateStore();

      const templateColor =
        SPELL_DAMAGE_TEMPLATE_COLORS[getSpellPrimaryDamageType(spell) ?? '']
        ?? SPELL_TEMPLATE_DEFAULT_COLOR;

      templateStore.requestPlacement(
        spell.areaOfEffect,
        templateColor,
        props.actor.id,
        (templateId) => continueSpellCast(spell, templateId, lockedSpellLevel),
        getSpellMaxRangeOnScene(spell),
      );

      return;
    }

    continueSpellCast(spell, undefined, lockedSpellLevel);
  }

  /**
   * Продолжает каст после размещения шаблона (или сразу, если AoE нет).
   */
  function continueSpellCast(
    spell: Spell,
    templateId?: string,
    lockedSpellLevel?: number,
  ): void {
    // Заклинания с зарядами (врождённые/расовые) не тратят ячейки и не
    // апкастятся: круг фиксирован, коллбэк списания ячейки не передаётся.
    const isInnate = !!spell.uses;
    const slotConsumer = isInnate ? undefined : handleSpellSlotConsume;

    let availableLevels = [0];

    if (lockedSpellLevel !== undefined) {
      availableLevels = [lockedSpellLevel];
    } else if (isInnate) {
      availableLevels = [spell.level];
    } else if (spell.level > 0) {
      availableLevels = getAvailableSpellLevels(props.actor, spell.level);
    }

    // Снарядный режим: число снарядов зависит от контекста каста
    // (заговоры — от уровня персонажа, уровневые — от круга ячейки)
    const casterLevel = getTotalLevel(props.actor.system?.classes);

    const projectileCount = getSpellProjectileCount(spell, {
      slotLevel: lockedSpellLevel ?? spell.level,
      casterLevel,
    });

    const hasProjectiles =
      projectileCount > 1 && !spell.areaOfEffect && templateId === undefined;

    // Состояние HP выбранной цели для токенов @target.full/@target.notFull.
    // Для AoE / без цели — undefined: части раскладываются на гейт-ветки
    // (targetGate), и оркестратор выбирает ветку по HP каждой цели (per-target).
    const targetEntity = spell.areaOfEffect
      ? null
      : targetStore.getTargetActor();

    // `system` ядра — непрозрачная запись: хиты читаются полем за полем
    const rawTargetHp = targetEntity?.system.hitPoints;
    const targetHp = isRecord(rawTargetHp) ? rawTargetHp : undefined;

    const targetIsFull =
      typeof targetHp?.max === 'number'
        ? (typeof targetHp.current === 'number' ? targetHp.current : 0)
          >= targetHp.max
        : undefined;

    // Тип цели — для токенов @target.type.<тип>. Как и состояние хитов, читается
    // только у одиночной цели: у области тип проверяется по каждой цели отдельно
    const targetType =
      targetEntity && isDndSceneEntity(targetEntity)
        ? resolveEntityCreatureType(targetEntity)
        : undefined;

    // Масштабирование заговора: на пороге уровня тир целиком заменяет базовые
    // части урона (см. cantripScalingTiers). Авто-умножение кубиков отключено.
    const spellDamageParts =
      spell.level === 0
        ? (pickCantripTierParts(spell, casterLevel)
          ?? getSpellDamageParts(spell))
        : getSpellDamageParts(spell);

    /** Плоский бонус эффектов к урону заклинаниями (`damage.spell`) */
    const flatSpellDamageBonus = resolvedStats.value?.damageBonuses.spell ?? 0;

    // Снарядам бонус в формулу не вливается — она катается на каждый снаряд;
    // им он едет отдельной бонус-частью ниже (см. withFlatDamageBonusPart)
    const formulaFlatBonus =
      hasProjectiles || spellIsHealing(spell) ? 0 : flatSpellDamageBonus;

    // Legacy одиночная формула (снаряды/одночастный путь): первая часть, с
    // разрешёнными @-переменными (@dmg-токены снимаются внутри resolve).
    const resolvedDamageFormula = withFlatFormulaBonus(
      resolveSpellDamageFormula(
        spell,
        props.actor,
        spellDamageParts[0]?.formula ?? '',
        resolvedStats.value,
        targetIsFull,
        targetType,
      ),
      formulaFlatBonus,
    );

    // --- Многочастный путь (несколько частей / нестандартный таргетинг) ---
    // Включая заклинания-атаки: модалка делает бросок попадания, затем части.
    // Исключены только снаряды (своя логика распределения).

    // Кость-формулы бонус-урона заклинаний (damage.spell) в Active Effects
    // катаются отдельными частями — каст идёт многочастным путём даже для
    // одночастного заклинания. Учитываются и ambient-эффекты аур на карте
    // (напр. аура союзника, дающая бонус-урон заклинаниям).
    const spellEffects = combineEffectsWithAmbient(
      collectActiveEffects(props.actor),
      // Ambient-ауры контракт отдаёт нейтральной базой — сужаем к D&D-форме.
      useAuraStore()
        .getAmbientEffectsForActor(props.actor.id)
        .filter(isDnDEffect),
    );

    const hasBonusDamage = hasSpellBonusDamage(spellEffects);

    // Есть ли у заклинания эффекты на цель (effectTarget 'target') — нужно для
    // резолва заклинаний без урона, чья задача — повесить эффект на цель.
    const hasSpellTargetEffects = getTargetSpellEffects(spell).length > 0;

    const useMultiPart =
      !hasProjectiles
      && (hasBonusDamage
        || spellDamageParts.length > 1
        || spellDamageParts.some(
          (part) =>
            (part.target ?? 'selected') !== 'selected'
            || part.requiresDamage
            || /@dmg\./i.test(part.formula)
            || /@heal/i.test(part.formula)
            || /@target\./i.test(part.formula),
        ));

    // Плоский бонус эффектов к урону заклинаниями (`damage.spell`) вливается в
    // первую урон-часть — так же, как статический бонус оружия
    const resolvedParts: SpellDamagePartInput[] = useMultiPart
      ? withFlatDamageBonus(
          resolveDamagePartsForCast(
            spell,
            props.actor,
            spellDamageParts,
            resolvedStats.value,
            targetIsFull,
            targetType,
          ),
          flatSpellDamageBonus,
        )
      : [];

    // Roll-time сборщик бонус-частей: условия (преимущество/помеха, HP цели)
    // оцениваются в момент броска по фактическому режиму из модалки.
    // Снаряды остаются на одноформульном пути, но бонус-части получают:
    // они катаются один раз на каст и применяются каждой задетой цели
    // (per-target гейты, см. resolveSpellDamage).
    const evaluateSpellBonusParts =
      useMultiPart || (hasProjectiles && hasBonusDamage)
        ? buildSpellBonusEvaluator({
            spell,
            actor: props.actor,
            effects: spellEffects,
            resolvedStats: resolvedStats.value,
            multiTarget:
              spell.areaOfEffect !== undefined
              || templateId !== undefined
              || hasProjectiles,
          })
        : undefined;

    let isApplied = false;

    const handleUnload = () => {
      if (!isApplied && templateId) {
        const templateStore = useSpellTemplateStore();

        templateStore.deleteTemplate(templateId);
      }

      if (!isApplied && hasProjectiles) {
        import('@/stores/projectileStore').then(({ useProjectileStore }) => {
          const projectileStore = useProjectileStore();

          if (projectileStore.isActive) {
            projectileStore.stopTargeting();
          }
        });
      }
    };

    window.addEventListener('beforeunload', handleUnload);

    const handleModalClose = (isOpen: boolean) => {
      if (!isOpen) {
        window.removeEventListener('beforeunload', handleUnload);

        if (!isApplied && templateId) {
          const templateStore = useSpellTemplateStore();

          templateStore.deleteTemplate(templateId);
        }

        if (!isApplied && hasProjectiles) {
          import('@/stores/projectileStore').then(({ useProjectileStore }) => {
            const projectileStore = useProjectileStore();

            if (projectileStore.isActive) {
              projectileStore.stopTargeting();
            }
          });
        }
      }
    };

    /**
     * Общий обработчик подтверждения броска.
     * Транслирует шаблон на сервер и запускает обработку целей.
     */
    function handleRollConfirm(
      damageTotal: number,
      chosenDamageType?: string,
    ): void {
      isApplied = true;
      window.removeEventListener('beforeunload', handleUnload);

      let cachedTemplate = null;

      if (templateId) {
        const templateStore = useSpellTemplateStore();

        cachedTemplate = templateStore.getPlacedTemplate(templateId);
        // Очищаем кэш (данные уже сохранены в cachedTemplate)
        templateStore.removePlacedTemplate(templateId);
      }

      // Автоматическая обработка целей (спасброски, авто-попадание). Эффекты
      // на цель без урона тоже требуют резолва: у save-заклинаний нужно кинуть
      // спасбросок и наложить эффект при провале — поэтому пускаем резолв и при
      // наличии target-эффектов, даже когда урона нет.
      if (
        needsAutoResolution(spell, hasProjectiles)
        && (damageTotal > 0 || hasSpellTargetEffects)
      ) {
        const scene = worldStore.currentScene;
        const actors = getCurrentWorldEntities();
        const socket = getWorldSocket();

        if (actors.length > 0 && socket) {
          const context = {
            spell,
            damageTotal,
            spellSaveDC: resolveSpellSaveDC(
              props.actor,
              spell,
              resolvedStats.value,
            ),
            actors,
            socket,
            overrideDamageType: chosenDamageType,
          };

          // Бонус-части для снарядов собираются здесь (в момент подтверждения
          // броска): снаряды autoHit — броска атаки нет, поэтому преимущество/
          // помеха не определены (false); HP-условия отложены в per-target гейты.
          // Плоский бонус заклинаниям едет здесь же отдельной частью: она
          // катается один раз на каст, а не на каждый снаряд
          const projectileBonusParts = hasProjectiles
            ? withFlatDamageBonusPart(
                evaluateSpellBonusParts?.({
                  hasAdvantage: false,
                  hasDisadvantage: false,
                }) ?? [],
                spellIsHealing(spell) ? 0 : flatSpellDamageBonus,
              )
            : undefined;

          resolveSpellDamage(context, {
            hasProjectiles,
            resolvedDamageFormula,
            scene,
            cachedTemplate,
            bonusDamageParts: projectileBonusParts,
          });
        }
      }

      // Самобафф: эффекты с effectTarget 'self' ложатся на заклинателя (напр.
      // Щит). Безопасно и для уронных заклинаний — без таких эффектов это no-op.
      applyCasterSpellEffects(spell);

      // Эффекты на цель (effectTarget 'target') без броска атаки и без
      // спасброска — автоприменение (напр. бафф союзника касанием): вешаем
      // сразу. Атакующие заклинания вешают их по попаданию (onHit модалки),
      // save-заклинания — внутри resolveSpellDamage выше.
      if (
        hasSpellTargetEffects
        && spell.saveType === 'none'
        && !getSpellAttackType(spell)
      ) {
        applyTargetSpellEffects(spell);
      }

      // Удаляем визуальный шаблон с карты (всегда, вне зависимости от результата)
      if (templateId) {
        const templateStore = useSpellTemplateStore();

        templateStore.deleteTemplate(templateId);
      }
    }

    /**
     * Обработчик многочастного броска: применяет части через оркестратор.
     */
    function handleRollPartsConfirm(parts: RolledSpellDamagePart[]): void {
      isApplied = true;
      window.removeEventListener('beforeunload', handleUnload);

      let cachedTemplate = null;

      if (templateId) {
        const templateStore = useSpellTemplateStore();

        cachedTemplate = templateStore.getPlacedTemplate(templateId);
        templateStore.removePlacedTemplate(templateId);
      }

      const scene = worldStore.currentScene;
      const actors = getCurrentWorldEntities();
      const socket = getWorldSocket();

      if (actors.length > 0 && socket) {
        void resolveSpellDamageWithParts(
          {
            spell,
            damageTotal: 0,
            spellSaveDC: resolveSpellSaveDC(
              props.actor,
              spell,
              resolvedStats.value,
            ),
            actors,
            socket,
            casterId: props.actor.id,
          },
          parts,
          { scene, cachedTemplate },
        );
      }

      if (templateId) {
        const templateStore = useSpellTemplateStore();

        templateStore.deleteTemplate(templateId);
      }
    }

    /**
     * Обработчик серии атак снарядов (Мистический заряд, Палящий луч):
     * модалка отдаёт контекст броска, по броску попадания на каждый снаряд
     * выполняет resolveSpellDamage. Бонус-части эффектов собираются с
     * фактическим режимом преимущества/помехи и катаются на каждое попадание.
     */
    function handleProjectileAttackRoll(rollContext: {
      attackModifier: number;
      rollMode: AttackRollMode;
    }): void {
      const projectileAttackType = getSpellAttackType(spell);

      if (!projectileAttackType) {
        return;
      }

      isApplied = true;
      window.removeEventListener('beforeunload', handleUnload);

      const scene = worldStore.currentScene;
      const actors = getCurrentWorldEntities();
      const socket = getWorldSocket();

      if (actors.length === 0 || !socket) {
        return;
      }

      // Серия атак (Мистический заряд, Палящий луч): каждый луч — СВОЙ бросок
      // атаки и свой бросок урона, поэтому плоский бонус получает каждый из
      // них. Правило «один раз к броску» тут и соблюдается: бросков несколько.
      // Отличие от автопопаданий (Волшебная стрела) — там бросок урона один на
      // каст, и бонус там начисляется однократно.
      const projectileBonusParts = withFlatDamageBonusPart(
        evaluateSpellBonusParts?.({
          hasAdvantage: rollContext.rollMode === 'advantage',
          hasDisadvantage: rollContext.rollMode === 'disadvantage',
        }) ?? [],
        spellIsHealing(spell) ? 0 : flatSpellDamageBonus,
      );

      resolveSpellDamage(
        {
          spell,
          damageTotal: 0,
          spellSaveDC: resolveSpellSaveDC(
            props.actor,
            spell,
            resolvedStats.value,
          ),
          actors,
          socket,
        },
        {
          hasProjectiles: true,
          resolvedDamageFormula,
          scene,
          projectileAttack: {
            attackModifier: rollContext.attackModifier,
            rollMode: rollContext.rollMode,
            attackType: projectileAttackType,
          },
          bonusDamageParts: projectileBonusParts,
        },
      );
    }

    /** Нужно ли пропустить автоприменение урона в модалке */
    const shouldSkipAutoApply = needsAutoResolution(spell, hasProjectiles);

    // Для заговоров и заклинаний без урона и без РЕАЛЬНОГО броска атаки — только
    // карточка (выбор круга + применение эффектов). getSpellAttackType === undefined
    // при автопопадании/лечении/не-атакующей доставке: тогда бросок не нужен, даже
    // если тип атаки melee/ranged (автопопадание = попадаем без броска).
    if (spellDamageParts.length === 0 && !getSpellAttackType(spell)) {
      // Для не-заговоров всё равно нужно списать ячейку (врождённые — заряд уже
      // списан в proceedWithCastSpell, ячейка не тратится)
      if (spell.level > 0 && !isInnate) {
        openModal('DiceRollModal', {
          'title': `${ACTOR_SPELLS_TAB_LABELS.rollTitlePrefix}${spell.name}`,
          'rollLabel': spell.name,
          'rollButtonText': SPELL_MENU_LABELS.cast,
          'skipRoll': true,
          'spellLevel': lockedSpellLevel ?? spell.level,
          'availableSpellLevels': availableLevels,
          'pactSlotLevel': pactSlotInfo.value.level,
          'onSpellSlotConsume': slotConsumer,
          'onRoll': handleRollConfirm,
          'onUpdate:open': handleModalClose,
        });
      } else {
        // Заговоры/врождённые без выбора ячейки (модалка не открывается):
        // эффекты применяем сразу при касте — на себя и/или на выбранную цель.
        applyCasterSpellEffects(spell);
        applyTargetSpellEffects(spell);
      }

      return;
    }

    // Атака / урон / лечение. Тип атаки — общий хелпер getSpellAttackType
    // (melee/ranged без autoHit); будет ли реально бросок попадания, решает
    // DiceRollModal по наличию выбранной цели в момент броска.
    const incomingAttackType = getSpellAttackType(spell);

    const baseMod = incomingAttackType
      ? calculateSpellAttackModifier(props.actor, spell, resolvedStats.value)
      : 0;

    let rollButtonText: string = SPELL_DAMAGE_ROLL_BUTTON;

    if (incomingAttackType) {
      rollButtonText = ACTOR_SPELLS_TAB_LABELS.attackRoll;
    } else if (spellDamageParts.some((part) => damagePartIsHealing(part))) {
      rollButtonText = ACTOR_SPELLS_TAB_LABELS.healing;
    }

    openModal('DiceRollModal', {
      'title': `${ACTOR_SPELLS_TAB_LABELS.rollTitlePrefix}${spell.name}`,
      'rollLabel': spell.name,
      rollButtonText,
      'formula': resolvedDamageFormula,
      'attackModifier': incomingAttackType ? baseMod : undefined,
      incomingAttackType,
      'isHealing': spellIsHealing(spell),
      'damageType': getSpellPrimaryDamageType(spell),
      'skipDamageApplication': shouldSkipAutoApply,
      'skipChatMessage': hasProjectiles,

      // Атакующие снаряды: модалка отдаёт контекст, серию бросков выполняет
      // resolveSpellDamage (бросок попадания на каждый снаряд)
      'onProjectileAttack':
        hasProjectiles && incomingAttackType
          ? handleProjectileAttackRoll
          : undefined,

      // Атакующее заклинание-эффект (без многочастного пути): эффекты на цель
      // вешаем по ПОПАДАНИЮ. Многочастные уронные заклинания накладывают их
      // сами в resolveSpellDamageWithParts, поэтому onHit для них не нужен.
      'onHit':
        incomingAttackType && hasSpellTargetEffects && !useMultiPart
          ? () => applyTargetSpellEffects(spell)
          : undefined,

      // Многочастный путь (если активен) — модалка катает части и зовёт onRollParts
      'damageParts': useMultiPart ? resolvedParts : undefined,
      'onRollParts': useMultiPart ? handleRollPartsConfirm : undefined,
      // Снарядам бонус-части катает resolveSpellDamage, а не модалка
      'evaluateBonusDamageParts': useMultiPart
        ? evaluateSpellBonusParts
        : undefined,

      // Секция круга заклинания
      'spellLevel':
        lockedSpellLevel ?? (spell.level > 0 ? spell.level : undefined),
      'availableSpellLevels': availableLevels,
      'spellScalingDice': spell.scaling?.additionalDice,
      'pactSlotLevel': hasPactSlots.value ? pactSlotInfo.value.level : 0,
      'onSpellSlotConsume': slotConsumer,
      'onRoll': handleRollConfirm,
      'onUpdate:open': handleModalClose,
    });
  }

  /**
   * Коллбэк списания ячейки заклинания.
   * Вызывается из DiceRollModal при подтверждении броска.
   *
   * @param castLevel - выбранный круг
   * @param consumeSlot - тратить ли ячейку
   * @param isPactSlot - использовать Pact-ячейку
   */
  function handleSpellSlotConsume(
    castLevel: number,
    consumeSlot: boolean,
    isPactSlot: boolean,
  ): void {
    if (!consumeSlot || castLevel <= 0) {
      return;
    }

    if (isPactSlot) {
      updatePactUsedSlots((props.actor.system?.pactSlotsUsed ?? 0) + 1);
    } else {
      const index = castLevel - 1;
      const newUsed = [...usedSlots.value];

      newUsed[index] = (newUsed[index] ?? 0) + 1;
      updateUsedSlots(newUsed);
    }
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
      </div>

      <!-- Поиск и отбор одной строкой: слева чипы отбора (подготовка, круги),
        справа — поле поиска, свойства и сброс. Разносит их распор на поле
        поиска. Чипы лежат в ряду поштучно, без вложенных групп: иначе круги
        переносятся на новую строку все разом, даже когда место ещё есть -->
      <div
        v-if="hasFilterControls"
        class="flex flex-wrap items-center gap-x-1.5 gap-y-2"
      >
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
          <button
            type="button"
            :class="propertyMenuChipClass"
            :title="SPELL_FILTER_LABELS.propertiesHint"
            :aria-label="SPELL_FILTER_LABELS.properties"
          >
            <UIcon
              name="tabler:adjustments-horizontal"
              class="size-4"
            />
          </button>
        </UDropdownMenu>

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
      @apply="applyPreparedLimit"
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
  </div>
</template>
