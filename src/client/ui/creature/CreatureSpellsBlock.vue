<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type {
    MeasurementTemplate,
    SceneEntity,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    AttackRollMode,
    CreatureSpellcastingBlock,
    CreatureSpellGroup,
    CreatureSpellPlacement,
    CreatureSpellRef,
    DnDCreature,
    Spell,
    SpellUsesRecovery,
  } from '@vtt/shared/system/dnd.js';

  import type { RollBonusEvaluator } from '../../composables/rollBonusEvaluator';
  import type { SpellCasterSource } from '../../composables/spellCastCompletion';
  import type {
    RolledSpellDamagePart,
    SpellDamagePartInput,
  } from '../../composables/useSpellResolution';
  import type { PickedCompendiumRef } from '../actor/CompendiumRefPickerModal.vue';
  import type { SheetRowStat } from '../actor/sheetRowTypes';
  import type { CreatureSpellRefDragPayload } from './constants';
  import type {
    CreatureSpellBlockView,
    CreatureSpellGroupView,
    CreatureSpellRowView,
  } from './creatureSpellViewTypes';

  import { useToast } from '@nuxt/ui/composables';
  import { computed, ref, watch } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useChatStore } from '@/stores/chatStore';
  import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
  import { useWorldStore } from '@/stores/worldStore';
  import { generateId, isRecord } from '@vtt/shared';
  import {
    ABILITY_LABELS,
    calculateCreatureSpellBlockNumbers,
    collectActiveEffects,
    collectCreatureSpellIdsInBlocks,
    consumeCreatureSpellGroupUse,
    createEmptyCreatureSpellcastingBlock,
    createEmptyCreatureSpellGroup,
    describeDamagePart,
    ensureCreatureSpellsInBlocks,
    findCreatureSpellPlacement,
    getCreatureSpellBlockAbility,
    getCreatureSpellcastingSpellCount,
    getCreatureSpellGroupRecovery,
    getCreatureSpellMod,
    getCreatureSpellRollButtonText,
    getSpellAttackType,
    hasCreatureSpellGroupUsesLeft,
    isCreatureSpellPoolMode,
    isSpell,
    SPELL_DAMAGE_TEMPLATE_COLORS,
    SPELL_SCHOOL_LABELS,
    SPELL_TEMPLATE_DEFAULT_COLOR,
    SPELL_USES_RECOVERY_LABELS,
    spellIsHealing,
    syncCreatureSpellcastingUses,
  } from '@vtt/shared/system/dnd.js';

  import { buildRollBonusEvaluator } from '../../composables/rollBonusEvaluator';
  import {
    completeSpellCast,
    DEFAULT_CREATURE_SPELL_SAVE_DC,
    SPELL_CAST_KEY_PREFIX,
  } from '../../composables/spellCastCompletion';
  import {
    findSpellInPacks,
    loadSpellPacks,
  } from '../../composables/spellCompendium';
  import { discardSpellTemplate } from '../../composables/spellResolutionShared';
  import { useBonusDamageParts } from '../../composables/useBonusDamageParts';
  import { useExpandedRows } from '../../composables/useExpandedRows';
  import { useSpellResolution } from '../../composables/useSpellResolution';
  import {
    SPELL_LEVEL_FILTER_ORDER,
    spellLevelFilterValue,
  } from '../actor/compendiumFilters';
  import CompendiumRefPickerModal from '../actor/CompendiumRefPickerModal.vue';
  import {
    ACTOR_SPELLS_TAB_LABELS,
    DELETE_CONFIRM_TITLE,
    FILTER_ROW_CONTROL_SIZE,
    MODAL_BUTTON_LABELS,
    REF_PICKER_LABELS,
    SHEET_FILTER_LABELS,
    SHEET_ROW_MENU_LABELS,
    SPELL_DAMAGE_ROLL_BUTTON,
    SPELL_MENU_LABELS,
    SPELL_MIME,
    SPELL_STAT_HINTS,
    SPELL_STAT_LABELS,
  } from '../actor/constants';
  import DiceRollModal from '../actor/DiceRollModal.vue';
  import FilterChip from '../actor/FilterChip.vue';
  import FilterResetButton from '../actor/FilterResetButton.vue';
  import { formatSpellDamageDisplay } from '../actor/utils/formatSpellDamageDisplay';
  import {
    CREATURE_ACTIONS_BLOCK_LABELS,
    CREATURE_EMPTY_LABELS,
    CREATURE_RECHARGE_HINTS,
    CREATURE_RECHARGE_LABELS,
    CREATURE_SPELL_BLOCKS_LABELS,
    CREATURE_SPELL_RECOVERY_CHIPS,
    CREATURE_SPELL_REF_MIME,
    CREATURE_SPELLCASTING_LABELS,
    getCreatureSpellGroupLabel,
  } from './constants';
  import CreatureSpellBlockCard from './CreatureSpellBlockCard.vue';
  import CreatureSpellBlockFormModal from './CreatureSpellBlockFormModal.vue';
  import CreatureSpellGroupFormModal from './CreatureSpellGroupFormModal.vue';
  import CreatureSpellRefModal from './CreatureSpellRefModal.vue';

  interface Props {
    /** Существо-источник (для авто-вывода DC/бонуса из характеристики) */
    creature?: DnDCreature;
    /** Заклинания существа (верхний уровень `Creature.spells`) */
    spells?: Spell[];
    /**
     * Блоки и группы заклинаний — так же, как в редакторе бестиария сайта.
     * Заклинания в них те же, что в `spells`: группа ссылается на них по `id`.
     */
    spellcastingBlocks?: CreatureSpellcastingBlock[];
    /** Режим редактирования */
    isEditMode: boolean;
    /** Режим только просмотр (компендиум) */
    isReadOnly?: boolean;
    /**
     * Пользователь управляет существом. Заклинательство правят и вне режима
     * правки листа — как на листе персонажа, где настройка открывается прямо с
     * плитки, а изменение сохраняется сразу.
     */
    canEdit?: boolean;
    /** ID существа-источника */
    creatureId: string;
    /** Имя существа (для подписей в хотбаре) */
    creatureName: string;
    /** WebSocket-клиент: выбор заклинаний группы из компендиума */
    socket?: TypedWebSocketClient | null;
  }

  const props = withDefaults(defineProps<Props>(), {
    creature: undefined,
    spells: () => [],
    spellcastingBlocks: () => [],
    isReadOnly: false,
    canEdit: false,
    socket: null,
  });

  const emit = defineEmits<{
    /**
     * Заклинания и блоки одним событием: правка почти всегда задевает и то, и
     * другое (заклинание кладут в группу, режим группы меняет его заряды), а
     * двумя событиями лист сохранялся бы дважды подряд.
     */
    'update:spellbook': [
      value: { spells: Spell[]; blocks: CreatureSpellcastingBlock[] },
    ];
  }>();

  const { openModal, getNextZIndex } = useModalManager();
  const toast = useToast();
  const chatStore = useChatStore();
  const worldStore = useWorldStore();
  const spellTemplateStore = useSpellTemplateStore();

  const { buildCreatureSpellRollSetup, buildTargetHpContext } =
    useBonusDamageParts();

  const { resolveSpellDamageWithParts } = useSpellResolution();

  /** Знак у бонуса: без него «+3» читалось бы как «3» */
  function formatBonus(value: number | undefined): string {
    if (value === undefined) {
      return CREATURE_SPELLCASTING_LABELS.none;
    }

    return `${value >= 0 ? '+' : ''}${value}`;
  }

  // ── Правка списка и блоков ────────────────────────────────────────────────

  /** Блоки заклинаний существа */
  const blocks = computed<CreatureSpellcastingBlock[]>(
    () => props.spellcastingBlocks,
  );

  /**
   * Отдаёт наверх заклинания и блоки разом.
   *
   * По дороге запись приводится в порядок: заклинание, не попавшее ни в одну
   * группу, кладётся в подходящую (вне блока заклинание существа не живёт), а
   * заряды приводятся к режимам групп — режим источник истины и для максимума
   * применений, и для способа отката.
   *
   * @param spells - заклинания существа
   * @param nextBlocks - блоки заклинаний
   */
  function emitSpellbook(
    spells: Spell[],
    nextBlocks: CreatureSpellcastingBlock[],
  ): void {
    const synced = syncCreatureSpellcastingUses(
      spells,
      ensureCreatureSpellsInBlocks(spells, nextBlocks),
    );

    emit('update:spellbook', {
      spells: synced.spells,
      blocks: synced.blocks,
    });
  }

  /**
   * Эмитит обновлённый список заклинаний существа, оставляя блоки как есть.
   *
   * @param spells - новый список заклинаний
   */
  function updateSpells(spells: Spell[]): void {
    emitSpellbook(spells, blocks.value);
  }

  /**
   * Эмитит обновлённые блоки, оставляя список заклинаний как есть.
   *
   * @param nextBlocks - новые блоки
   */
  function updateBlocks(nextBlocks: CreatureSpellcastingBlock[]): void {
    emitSpellbook([...props.spells], nextBlocks);
  }

  /**
   * Заменяет одну группу, не трогая соседние.
   *
   * @param groupId - ключ группы
   * @param next - новая группа
   */
  function replaceGroup(groupId: string, next: CreatureSpellGroup): void {
    updateBlocks(
      blocks.value.map((entry) => ({
        ...entry,
        groups: entry.groups.map((group) =>
          group.id === groupId ? next : group,
        ),
      })),
    );
  }

  /**
   * Ищет группу по ключу во всех блоках.
   *
   * @param groupId - ключ группы
   * @returns группа либо `undefined`
   */
  function findGroup(groupId: string): CreatureSpellGroup | undefined {
    for (const entry of blocks.value) {
      const group = entry.groups.find((item) => item.id === groupId);

      if (group) {
        return group;
      }
    }

    return undefined;
  }

  // ── Отбор и поиск ─────────────────────────────────────────────────────────

  const searchQuery = ref('');

  /** Отмеченные чипами способы отката; пусто — список не сужается */
  const pickedRecoveries = ref<Set<SpellUsesRecovery>>(new Set());

  /**
   * Способ отката заклинаний групп — по их режиму, а не по зарядам записи.
   *
   * У группы «на весь список» счётчик лежит у самой группы, и заряды её
   * заклинаний сняты: без этой карты они попадали бы под чип «По желанию»,
   * хотя ждут отдыха вместе со своей группой.
   */
  const recoveryBySpellId = computed(() => {
    const map = new Map<string, SpellUsesRecovery>();

    for (const entry of blocks.value) {
      for (const group of entry.groups) {
        const recovery = getCreatureSpellGroupRecovery(group);

        for (const spellRef of group.spells) {
          map.set(spellRef.spellId, recovery);
        }
      }
    }

    return map;
  });

  /** Способ отката заклинания: без зарядов и без группы оно «по желанию» */
  function getSpellRecovery(spell: Spell): SpellUsesRecovery {
    return (
      recoveryBySpellId.value.get(spell.id) ?? spell.uses?.recovery ?? 'atWill'
    );
  }

  /** Действующий отбор: отмеченные чипами способы отката */
  const activeRecoveries = computed(() =>
    CREATURE_SPELL_RECOVERY_CHIPS.map((chip) => chip.key).filter((key) =>
      pickedRecoveries.value.has(key),
    ),
  );

  /**
   * Чипы отбора по способу отката. Их всегда три, и стоят они в постоянном
   * порядке: способы задают правила, а не запись существа, поэтому чип
   * остаётся в ряду и у пустого способа.
   */
  const recoveryChips = computed(() =>
    CREATURE_SPELL_RECOVERY_CHIPS.map((chip) => ({
      ...chip,
      isPicked: activeRecoveries.value.includes(chip.key),
    })),
  );

  /** Ряд отбора: пустому списку сужать нечего */
  const hasFilterControls = computed(() => props.spells.length > 0);

  /**
   * Блоки и группы заводят только в правке листа: это перестройка статблока, а
   * не игровое действие. Каст, настройка и удаление остаются доступны и вне её
   * — как и прочая правка заклинаний существа.
   */
  const canAddStructure = computed(() => props.canEdit && props.isEditMode);

  /** Список сужен — хоть чипами, хоть поиском */
  const hasAnyFilter = computed(
    () => activeRecoveries.value.length > 0 || searchQuery.value.trim() !== '',
  );

  /**
   * «Сбросить» показывается только под отмеченные чипы: набранный текст
   * снимается крестиком в самом поле, и вторая кнопка для того же выскакивала
   * бы на каждой букве.
   */
  const hasPickedChips = computed(() => activeRecoveries.value.length > 0);

  /**
   * Нажатие на чип способа отката: способы набираются по одному, повторное
   * нажатие снимает способ с отбора.
   *
   * @param recovery - способ отката
   */
  function toggleRecoveryFilter(recovery: SpellUsesRecovery): void {
    const next = new Set(pickedRecoveries.value);

    if (next.has(recovery)) {
      next.delete(recovery);
    } else {
      next.add(recovery);
    }

    pickedRecoveries.value = next;
  }

  function clearSearch(): void {
    searchQuery.value = '';
  }

  /** Нажатие на «Сбросить»: список возвращается целиком */
  function resetFilters(): void {
    pickedRecoveries.value = new Set();
    searchQuery.value = '';
  }

  /** Заклинания, прошедшие отбор */
  const filteredSpells = computed(() => {
    const query = searchQuery.value.trim().toLowerCase();

    return props.spells.filter((spell) => {
      if (
        activeRecoveries.value.length > 0
        && !activeRecoveries.value.includes(getSpellRecovery(spell))
      ) {
        return false;
      }

      if (!query) {
        return true;
      }

      return (
        spell.name.toLowerCase().includes(query)
        || (spell.nameEn ?? '').toLowerCase().includes(query)
      );
    });
  });

  /** `id` заклинаний, прошедших отбор — по ним сужаются и строки групп */
  const filteredSpellIds = computed(
    () => new Set(filteredSpells.value.map((spell) => spell.id)),
  );

  /** Заклинания существа по `id` — группа хранит только ссылки */
  const spellsById = computed(
    () => new Map(props.spells.map((spell) => [spell.id, spell])),
  );

  // ── Сборка строк списка ───────────────────────────────────────────────────

  /**
   * Подпись под названием — школа магии, а следом оговорка статблока. Способ
   * отката называть незачем: он стоит в заголовке раздела, под которым лежит
   * строка.
   *
   * @param spell - заклинание
   * @param spellRef - ссылка группы с оговоркой
   * @returns подпись строки
   */
  function getSpellSubtitle(spell: Spell, spellRef?: CreatureSpellRef): string {
    const school = SPELL_SCHOOL_LABELS[spell.school] ?? '';

    if (!spellRef?.note) {
      return school;
    }

    return school ? `${school} · ${spellRef.note}` : spellRef.note;
  }

  /**
   * Плитки строки заклинания: урон (катится по нажатию), заряды и круг
   * наложения. Те же поля, что и у строки заклинания на листе персонажа.
   *
   * @param spell - заклинание
   * @param spellRef - ссылка группы с кругом наложения
   * @returns плитки в порядке показа
   */
  function getSpellStats(
    spell: Spell,
    spellRef?: CreatureSpellRef,
  ): SheetRowStat[] {
    const stats: SheetRowStat[] = [];

    const damage = formatSpellDamageDisplay(spell, {
      castLevel: spellRef?.castLevel,
    });

    if (damage) {
      stats.push({
        key: 'damage',
        label: SPELL_STAT_LABELS.damage,
        value: damage,
        tooltip: SPELL_STAT_HINTS.damage,
        accent: true,
        rollable: !props.isReadOnly,
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

    if (spellRef?.castLevel !== undefined) {
      stats.push({
        key: 'castLevel',
        label: CREATURE_SPELL_BLOCKS_LABELS.castLevelStat,
        value: String(spellRef.castLevel),
        tooltip: CREATURE_SPELL_BLOCKS_LABELS.castLevelHint,
      });
    }

    return stats;
  }

  /**
   * Пункты меню строки заклинания. Меню одно на правую кнопку мыши и на «⋮»:
   * сначала игровое действие, ниже — действия над записью, последним удаление.
   *
   * @param spell - заклинание
   * @param placement - группа, из которой идёт строка
   * @returns группы пунктов
   */
  function getSpellMenuItems(
    spell: Spell,
    placement?: CreatureSpellPlacement,
  ): DropdownMenuItem[][] {
    const groups: DropdownMenuItem[][] = [];

    if (!props.isReadOnly) {
      groups.push([
        {
          label: SPELL_MENU_LABELS.cast,
          icon: 'tabler:sparkles',
          onSelect: () => castSpell(spell, placement),
        },
      ]);
    }

    const sheetActions: DropdownMenuItem[] = [];

    if (!props.isReadOnly) {
      sheetActions.push({
        label: SHEET_ROW_MENU_LABELS.edit,
        icon: 'tabler:edit',
        onSelect: () => openEditForm(spell),
      });
    }

    if (placement && props.canEdit) {
      sheetActions.push({
        label: CREATURE_SPELL_BLOCKS_LABELS.refine,
        icon: 'tabler:adjustments',
        onSelect: () => openRefModal(placement),
      });
    }

    sheetActions.push({
      label: SHEET_ROW_MENU_LABELS.share,
      icon: 'tabler:message-share',
      onSelect: () => shareSpell(spell),
    });

    groups.push(sheetActions);

    if (!props.isReadOnly) {
      groups.push([
        {
          label: SHEET_ROW_MENU_LABELS.remove,
          icon: 'tabler:trash',
          color: 'error',
          onSelect: () => deleteSpell(spell.id),
        },
      ]);
    }

    return groups;
  }

  /**
   * Собирает строку списка для заклинания.
   *
   * @param spell - заклинание
   * @param placement - группа, из которой идёт строка
   * @returns строка списка
   */
  function buildRow(
    spell: Spell,
    placement?: CreatureSpellPlacement,
  ): CreatureSpellRowView {
    return {
      spell,
      spellRef: placement?.ref,
      subtitle: getSpellSubtitle(spell, placement?.ref),
      stats: getSpellStats(spell, placement?.ref),
      menuItems: getSpellMenuItems(spell, placement),
    };
  }

  /** Строка «Компоненты не требуются: …»; пусто — блоку нужны все компоненты */
  function getComponentsLabel(
    blockEntry: CreatureSpellcastingBlock,
  ): string | undefined {
    const ignored = blockEntry.ignoredComponents;

    if (!ignored) {
      return undefined;
    }

    const parts: string[] = [];

    if (ignored.verbal) {
      parts.push(CREATURE_SPELL_BLOCKS_LABELS.componentVerbal);
    }

    if (ignored.somatic) {
      parts.push(CREATURE_SPELL_BLOCKS_LABELS.componentSomatic);
    }

    if (ignored.material) {
      parts.push(CREATURE_SPELL_BLOCKS_LABELS.componentMaterial);
    }

    return parts.length
      ? CREATURE_SPELL_BLOCKS_LABELS.componentsIgnored + parts.join(', ')
      : undefined;
  }

  /**
   * Блоки, готовые к показу: числа, подписи и строки уже собраны.
   *
   * Вычисляемым списком, а не вызовами из шаблона: подписи зависят от
   * характеристик существа и режимов групп, и из шаблона они считались бы
   * заново на каждую перерисовку.
   */
  const blockViews = computed<CreatureSpellBlockView[]>(() =>
    blocks.value.map((blockEntry) => {
      const numbers = props.creature
        ? calculateCreatureSpellBlockNumbers(props.creature, blockEntry)
        : { saveDC: blockEntry.saveDC, attackBonus: blockEntry.attackBonus };

      const ability = props.creature
        ? getCreatureSpellBlockAbility(props.creature, blockEntry)
        : blockEntry.ability;

      const groups: CreatureSpellGroupView[] = blockEntry.groups.map(
        (group) => {
          const rows: CreatureSpellRowView[] = [];

          for (const spellRef of group.spells) {
            const spell = spellsById.value.get(spellRef.spellId);

            if (!spell || !filteredSpellIds.value.has(spell.id)) {
              continue;
            }

            rows.push(
              buildRow(spell, { block: blockEntry, group, ref: spellRef }),
            );
          }

          const isPool = isCreatureSpellPoolMode(group.mode);

          return {
            group,
            title: getCreatureSpellGroupLabel(group),
            usesLabel:
              isPool && group.uses
                ? `${group.uses.current}/${group.uses.max}`
                : undefined,
            isExhausted: !hasCreatureSpellGroupUsesLeft(group),
            rechargeLabel: group.recharge
              ? CREATURE_RECHARGE_LABELS[group.recharge]
              : undefined,
            rechargeHint: group.recharge
              ? CREATURE_RECHARGE_HINTS[group.recharge]
              : undefined,
            rows,
          };
        },
      );

      return {
        block: blockEntry,
        title: blockEntry.name || CREATURE_SPELL_BLOCKS_LABELS.unnamedBlock,
        cells: [
          {
            label: CREATURE_SPELLCASTING_LABELS.saveDC,
            hint: CREATURE_SPELLCASTING_LABELS.saveDCHint,
            value: String(numbers.saveDC ?? CREATURE_SPELLCASTING_LABELS.none),
          },
          {
            label: CREATURE_SPELLCASTING_LABELS.attack,
            hint: CREATURE_SPELLCASTING_LABELS.attackHint,
            value: formatBonus(numbers.attackBonus),
          },
          {
            label: CREATURE_SPELLCASTING_LABELS.ability,
            hint: CREATURE_SPELLCASTING_LABELS.abilityHint,
            value: ability
              ? ABILITY_LABELS[ability]
              : CREATURE_SPELLCASTING_LABELS.none,
          },
        ],
        note: blockEntry.note,
        componentsLabel: getComponentsLabel(blockEntry),
        groupCount: blockEntry.groups.length,
        spellCount: getCreatureSpellcastingSpellCount(blockEntry),
        groups,
      };
    }),
  );

  /**
   * Блоки на виду. Под отбором блок без единой строки уезжает целиком:
   * заголовок без содержимого только сбивал бы с толку. Без отбора он
   * остаётся — иначе в пустой блок нечем было бы добавить группу.
   */
  const visibleBlockViews = computed(() =>
    hasAnyFilter.value
      ? blockViews.value.filter((view) =>
          view.groups.some((group) => group.rows.length > 0),
        )
      : blockViews.value,
  );

  /**
   * Начинает перетаскивание заклинания: MIME для переноса на другой лист,
   * ссылка для переноса между группами и макрос существа для хотбара.
   *
   * @param event - событие dragstart
   * @param spell - заклинание существа
   * @param groupId - группа, из которой тащат
   */
  function handleSpellDragStart(
    event: DragEvent,
    spell: Spell,
    groupId: string,
  ): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(SPELL_MIME, JSON.stringify(spell));

    // Своя ссылка рядом с записью заклинания: по ней соседняя группа узнаёт,
    // что заклинание уже у этого существа, и переносит его, а не копирует
    const payload: CreatureSpellRefDragPayload = {
      creatureId: props.creatureId,
      spellId: spell.id,
      groupId,
    };

    event.dataTransfer.setData(
      CREATURE_SPELL_REF_MIME,
      JSON.stringify(payload),
    );

    startHotbarDrag(event, {
      id: `${props.creatureId}-spell-${spell.id}`,
      type: 'creature-spell',
      label: spell.name,
      icon: 'tabler:wand',
      ref: spell.id,
      actorId: props.creatureId,
    });
  }

  /**
   * Разбирает ссылку переноса между группами.
   *
   * @param raw - содержимое переноса
   * @returns ссылка либо `undefined`, если это чужой или испорченный перенос
   */
  function readRefDragPayload(
    raw: string,
  ): CreatureSpellRefDragPayload | undefined {
    try {
      const parsed: unknown = JSON.parse(raw);

      if (
        !isRecord(parsed)
        || typeof parsed.creatureId !== 'string'
        || typeof parsed.spellId !== 'string'
        || typeof parsed.groupId !== 'string'
      ) {
        return undefined;
      }

      return {
        creatureId: parsed.creatureId,
        spellId: parsed.spellId,
        groupId: parsed.groupId,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Переносит заклинание в другую группу вместе с его кругом наложения и
   * оговоркой: они относятся к заклинанию, а не к группе, и терять их при
   * перекладывании нельзя.
   *
   * @param moved - ссылка переноса
   * @param blockId - блок, на который бросили
   * @param groupId - группа, если бросили прямо на неё
   */
  function moveSpellToGroup(
    moved: CreatureSpellRefDragPayload,
    blockId: string,
    groupId: string | undefined,
  ): void {
    if (moved.groupId === groupId) {
      return;
    }

    let carried: CreatureSpellRef | undefined;

    const detached = blocks.value.map((block) => ({
      ...block,
      groups: block.groups.map((group) => {
        if (group.id !== moved.groupId) {
          return group;
        }

        carried = group.spells.find((entry) => entry.spellId === moved.spellId);

        return {
          ...group,
          spells: group.spells.filter(
            (entry) => entry.spellId !== moved.spellId,
          ),
        };
      }),
    }));

    const ref = carried;

    if (!ref) {
      return;
    }

    if (groupId) {
      updateBlocks(
        detached.map((block) => ({
          ...block,
          groups: block.groups.map((group) =>
            group.id === groupId
              ? { ...group, spells: [...group.spells, ref] }
              : group,
          ),
        })),
      );

      return;
    }

    // Бросили на блок мимо групп: подходящую подбирает общая раскладка, а круг
    // и оговорку возвращаем на место — она о них не знает
    const placed = ensureCreatureSpellsInBlocks(
      props.spells,
      detached,
      blockId,
    );

    updateBlocks(
      placed.map((block) => ({
        ...block,
        groups: block.groups.map((group) => ({
          ...group,
          spells: group.spells.map((entry) =>
            entry.spellId === ref.spellId ? ref : entry,
          ),
        })),
      })),
    );
  }

  /**
   * Кладёт заклинание компендиума в группу, на которую его бросили.
   *
   * @param dropped - запись заклинания из переноса
   * @param blockId - блок, на который бросили
   * @param groupId - группа, если бросили прямо на неё
   */
  function copyDroppedSpell(
    dropped: Spell,
    blockId: string,
    groupId: string | undefined,
  ): void {
    const group = groupId ? findGroup(groupId) : undefined;

    // Повтор в той же группе ничего не меняет — молча пропускаем
    if (
      group?.spells.some(
        (entry) => spellsById.value.get(entry.spellId)?.name === dropped.name,
      )
    ) {
      return;
    }

    const copy: Spell = { ...dropped, id: generateId('spell') };

    const spells = [...props.spells, copy];

    if (!group) {
      emitSpellbook(
        spells,
        ensureCreatureSpellsInBlocks(spells, blocks.value, blockId),
      );

      return;
    }

    emitSpellbook(
      spells,
      blocks.value.map((block) => ({
        ...block,
        groups: block.groups.map((entry) =>
          entry.id === group.id
            ? { ...entry, spells: [...entry.spells, { spellId: copy.id }] }
            : entry,
        ),
      })),
    );
  }

  /**
   * Отпускание заклинания над блоком либо его группой.
   *
   * Своё заклинание переносится, чужое — копируется записью. Одно и то же
   * перетаскивание несёт и то, и другое: строка листа кладёт рядом с записью
   * ещё и ссылку, по которой видно, что заклинание уже у этого существа.
   *
   * @param payload - событие и группа, на которую бросили
   * @param blockId - блок, которому принадлежит цель
   */
  function handleSpellDrop(
    payload: { event: DragEvent; groupId?: string },
    blockId: string,
  ): void {
    if (!props.canEdit || props.isReadOnly) {
      return;
    }

    const data = payload.event.dataTransfer;

    if (!data) {
      return;
    }

    const rawRef = data.getData(CREATURE_SPELL_REF_MIME);

    const moved = rawRef ? readRefDragPayload(rawRef) : undefined;

    if (moved && moved.creatureId === props.creatureId) {
      moveSpellToGroup(moved, blockId, payload.groupId);

      return;
    }

    const rawSpell = data.getData(SPELL_MIME);

    if (!rawSpell) {
      return;
    }

    try {
      const dropped: unknown = JSON.parse(rawSpell);

      // Данные приезжают из события браузера: без проверки испорченная
      // нагрузка легла бы в запись существа и сломала бы его лист
      if (isSpell(dropped)) {
        copyDroppedSpell(dropped, blockId, payload.groupId);
      }
    } catch (error) {
      console.error(CREATURE_SPELL_BLOCKS_LABELS.spellsAddFailed, error);
    }
  }

  // ── Блоки и группы ────────────────────────────────────────────────────────

  /**
   * Раскрытые блоки. Набор держит вкладка, а не карточка: заведённый блок
   * раскрывается сразу, а карточка о соседях не знает.
   */
  const {
    isExpanded: isBlockExpanded,
    toggle: toggleBlock,
    expand: expandBlock,
  } = useExpandedRows();

  // Единственный блок раскрывается сам: прятать его не от чего, а лишнее
  // нажатие мешало бы. Свернуть его после этого всё равно можно
  watch(
    () => blocks.value.map((entry) => entry.id).join('|'),
    () => {
      const only = blocks.value.length === 1 ? blocks.value[0] : undefined;

      if (only) {
        expandBlock(only.id);
      }
    },
    { immediate: true },
  );

  /** Блок, открытый в окне настройки */
  const editedBlock = ref<CreatureSpellcastingBlock | undefined>(undefined);

  const isBlockFormOpen = ref(false);

  /** Группа, открытая в окне настройки */
  const editedGroup = ref<CreatureSpellGroup | undefined>(undefined);

  const isGroupFormOpen = ref(false);

  /** Ссылка на заклинание, открытая в окне круга и оговорки */
  const editedRef = ref<CreatureSpellPlacement | undefined>(undefined);

  const isRefFormOpen = ref(false);

  /** Блок либо группа, удаление которых ждёт подтверждения */
  const pendingRemoval = ref<
    { kind: 'block' | 'group'; id: string } | undefined
  >(undefined);

  /** Слой окна подтверждения: оно встаёт поверх листа существа */
  const removalZIndex = ref<number | undefined>(undefined);

  /** Текст вопроса: у блока и у группы он разный */
  const removalText = computed(() =>
    pendingRemoval.value?.kind === 'block'
      ? CREATURE_SPELL_BLOCKS_LABELS.removeBlockConfirm
      : CREATURE_SPELL_BLOCKS_LABELS.removeGroupConfirm,
  );

  /** Заводит блок в конце списка и сразу раскрывает его — его же и заполняют */
  function addBlock(): void {
    const added = createEmptyCreatureSpellcastingBlock();

    updateBlocks([...blocks.value, added]);

    expandBlock(added.id);
  }

  /**
   * Открывает настройку блока.
   *
   * @param blockId - ключ блока
   */
  function openBlockForm(blockId: string): void {
    editedBlock.value = blocks.value.find((entry) => entry.id === blockId);

    isBlockFormOpen.value = editedBlock.value !== undefined;
  }

  /**
   * Сохраняет настройку блока.
   *
   * Группы берутся из текущей записи, а не из окна: окно открылось со снимком
   * блока и правит только его числа, а группы за это время мог задеть каст.
   *
   * @param updated - блок из окна
   */
  function applyBlock(updated: CreatureSpellcastingBlock): void {
    updateBlocks(
      blocks.value.map((entry) =>
        entry.id === updated.id ? { ...updated, groups: entry.groups } : entry,
      ),
    );
  }

  /**
   * Спрашивает подтверждение удаления блока или группы.
   *
   * Спрашиваем, потому что блок сворачивается: за свёрнутой шапкой не видно ни
   * групп, ни списков заклинаний, и промах по кнопке стирал бы их молча.
   *
   * @param kind - что удаляют
   * @param id - ключ блока либо группы
   */
  function askRemoval(kind: 'block' | 'group', id: string): void {
    pendingRemoval.value = { kind, id };
    removalZIndex.value = getNextZIndex();
  }

  /** Закрытие окна подтверждения любым способом — отказ от удаления */
  function handleRemovalOpenChange(isConfirmOpen: boolean): void {
    if (!isConfirmOpen) {
      pendingRemoval.value = undefined;
    }
  }

  /**
   * Удаляет блок либо группу после подтверждения — вместе с их заклинаниями.
   *
   * Вместе, потому что вне блока заклинание существа не живёт: оставить его без
   * группы нельзя, а перекладывать в чужую — гадать за автора. Об этом говорит
   * и вопрос окна.
   */
  function confirmRemoval(): void {
    const removal = pendingRemoval.value;

    pendingRemoval.value = undefined;

    if (!removal) {
      return;
    }

    const nextBlocks =
      removal.kind === 'block'
        ? blocks.value.filter((entry) => entry.id !== removal.id)
        : blocks.value.map((entry) => ({
            ...entry,
            groups: entry.groups.filter((group) => group.id !== removal.id),
          }));

    const kept = collectCreatureSpellIdsInBlocks(nextBlocks);

    emitSpellbook(
      props.spells.filter((spell) => kept.has(spell.id)),
      nextBlocks,
    );
  }

  /**
   * Заводит группу в конце блока.
   *
   * @param blockId - ключ блока
   */
  function addGroup(blockId: string): void {
    updateBlocks(
      blocks.value.map((entry) =>
        entry.id === blockId
          ? {
              ...entry,
              groups: [...entry.groups, createEmptyCreatureSpellGroup()],
            }
          : entry,
      ),
    );
  }

  /**
   * Открывает настройку группы.
   *
   * @param groupId - ключ группы
   */
  function openGroupForm(groupId: string): void {
    editedGroup.value = findGroup(groupId);

    isGroupFormOpen.value = editedGroup.value !== undefined;
  }

  /**
   * Сохраняет настройку группы.
   *
   * Список заклинаний и счётчик берутся из текущей записи, а не из окна: окно
   * открылось со снимком группы и правит только её ограничение, а список и
   * счётчик за это время мог задеть каст.
   *
   * @param updated - группа из окна
   */
  function applyGroup(updated: CreatureSpellGroup): void {
    const current = findGroup(updated.id);

    if (!current) {
      return;
    }

    replaceGroup(updated.id, {
      ...updated,
      spells: current.spells,
      uses: current.uses,
    });
  }

  /**
   * Открывает окно круга и оговорки заклинания группы.
   *
   * @param placement - группа и ссылка на заклинание
   */
  function openRefModal(placement: CreatureSpellPlacement): void {
    editedRef.value = placement;
    isRefFormOpen.value = true;
  }

  /**
   * Сохраняет круг и оговорку заклинания группы.
   *
   * @param updated - ссылка из окна
   */
  function applyRef(updated: CreatureSpellRef): void {
    const placement = editedRef.value;

    // Группа берётся текущая, а не из снимка, с которым открылось окно: за это
    // время её мог задеть каст
    const group = placement ? findGroup(placement.group.id) : undefined;

    if (!group) {
      return;
    }

    replaceGroup(group.id, {
      ...group,
      spells: group.spells.map((entry) =>
        entry.spellId === updated.spellId ? updated : entry,
      ),
    });
  }

  // ── Выбор заклинаний из компендиума ───────────────────────────────────────

  /** Группа, в которую добавляют заклинания */
  const pickerGroupId = ref<string | undefined>(undefined);

  const isPickerOpen = ref(false);

  /**
   * Слой окна выбора. Без него окно открылось бы ПОД листом, с которого его
   * позвали: слои раздаёт менеджер окон, а не порядок в разметке.
   */
  const pickerZIndex = ref<number | undefined>(undefined);

  /**
   * Открывает выбор заклинаний компендиума для группы.
   *
   * @param groupId - ключ группы
   */
  function openSpellPicker(groupId: string): void {
    pickerGroupId.value = groupId;
    pickerZIndex.value = getNextZIndex();
    isPickerOpen.value = true;
  }

  /**
   * Кладёт выбранные заклинания в группу.
   *
   * Запись заклинания копируется существу целиком, а группа ссылается на копию
   * по `id`: каст, хотбар и отдых работают с `Creature.spells`, и ссылкой на
   * компендиум им не обойтись. Уже перечисленные в этой группе пропускаются —
   * повтор в ней ничего не меняет.
   *
   * @param picked - отмеченные в окне записи компендиума
   */
  async function addPickedSpells(picked: PickedCompendiumRef[]): Promise<void> {
    const groupId = pickerGroupId.value;

    const group = groupId ? findGroup(groupId) : undefined;

    if (!group || !props.socket || !picked.length) {
      return;
    }

    try {
      const { packs } = await loadSpellPacks(props.socket);

      const taken = new Set(
        group.spells
          .map((entry) => spellsById.value.get(entry.spellId)?.name)
          .filter((name): name is string => Boolean(name)),
      );

      const addedSpells: Spell[] = [];
      const addedRefs: CreatureSpellRef[] = [];

      for (const entry of picked) {
        const found = findSpellInPacks(packs, entry.url, entry.packId);

        if (!found || taken.has(found.name)) {
          continue;
        }

        taken.add(found.name);

        const copy: Spell = { ...found, id: generateId('spell') };

        addedSpells.push(copy);
        addedRefs.push({ spellId: copy.id });
      }

      if (!addedSpells.length) {
        return;
      }

      emitSpellbook(
        [...props.spells, ...addedSpells],
        blocks.value.map((entry) => ({
          ...entry,
          groups: entry.groups.map((item) =>
            item.id === group.id
              ? { ...item, spells: [...item.spells, ...addedRefs] }
              : item,
          ),
        })),
      );

      toast.add({
        title: CREATURE_SPELL_BLOCKS_LABELS.spellsAdded,
        description: addedSpells.map((spell) => spell.name).join(', '),
        color: 'success',
      });
    } catch (error) {
      console.error(CREATURE_SPELL_BLOCKS_LABELS.spellsAddFailed, error);

      toast.add({
        title: CREATURE_SPELL_BLOCKS_LABELS.spellsAddFailed,
        color: 'error',
      });
    }
  }

  // ── Редактирование / удаление ─────────────────────────────────────────────

  /**
   * Открывает форму редактирования заклинания.
   * @param spell - редактируемое заклинание
   */
  function openEditForm(spell: Spell): void {
    openModal('SpellFormModal', {
      spell,
      onSave: (updated: Spell) => {
        updateSpells(
          props.spells.map((entry) =>
            entry.id === updated.id ? updated : entry,
          ),
        );
      },
    });
  }

  /**
   * Удаляет заклинание существа вместе со ссылками на него в группах: строка
   * без записи всё равно ничего не покажет.
   *
   * @param spellId - id заклинания
   */
  function deleteSpell(spellId: string): void {
    emitSpellbook(
      props.spells.filter((entry) => entry.id !== spellId),
      blocks.value.map((entry) => ({
        ...entry,
        groups: entry.groups.map((group) => ({
          ...group,
          spells: group.spells.filter((item) => item.spellId !== spellId),
        })),
      })),
    );
  }

  /**
   * Открывает детальную карточку заклинания (просмотр + кнопка применения).
   * @param spell - заклинание
   */
  function openDetail(spell: Spell): void {
    openModal('SpellDetailModal', {
      spell,
      showCastButton: !props.isReadOnly,
      onCast: () => castSpell(spell, findPlacement(spell.id)),
    });
  }

  /**
   * Делится заклинанием в чат.
   * @param spell - заклинание
   */
  function shareSpell(spell: Spell): void {
    chatStore.sendItemCard({
      cardType: 'spell',
      title: spell.name,
      payload: JSON.stringify(spell),
    });
  }

  /**
   * Ищет группу, в которой лежит заклинание.
   *
   * @param spellId - id заклинания
   * @returns блок с группой либо `undefined`
   */
  function findPlacement(spellId: string): CreatureSpellPlacement | undefined {
    return findCreatureSpellPlacement(blocks.value, spellId);
  }

  // ── Списание применений ───────────────────────────────────────────────────

  /**
   * Списывает одно применение на каст.
   *
   * У группы «на весь список» счётчик один на всю группу и лежит у неё;
   * у остальных заряды считает само заклинание.
   *
   * @param spell - заклинание
   * @param placement - группа, из которой идёт каст
   */
  function consumeSpellUse(
    spell: Spell,
    placement?: CreatureSpellPlacement,
  ): void {
    if (placement && isCreatureSpellPoolMode(placement.group.mode)) {
      updateBlocks(
        consumeCreatureSpellGroupUse(blocks.value, placement.group.id),
      );

      return;
    }

    if (!spell.uses || spell.uses.recovery === 'atWill') {
      return;
    }

    updateSpells(
      props.spells.map((entry) =>
        entry.id === spell.id && entry.uses
          ? {
              ...entry,
              uses: {
                ...entry.uses,
                current: Math.max(0, entry.uses.current - 1),
              },
            }
          : entry,
      ),
    );
  }

  // ── Каст заклинания ───────────────────────────────────────────────────────

  const isRollModalOpen = ref(false);

  /** Настройка окна броска заклинания: собирается перед каждым открытием */
  interface SpellRollConfig {
    title: string;
    name: string;
    formula: string;
    rollButtonText: string;
    attackModifier?: number;
    evaluateBonusRollFormulas?: RollBonusEvaluator;
    initialRollMode: AttackRollMode;
    incomingAttackType?: 'melee' | 'ranged' | 'spell';
    damageType?: string;
    isHealing: boolean;
    damageParts: SpellDamagePartInput[];
    /** Круг наложения из группы: окно броска открывается сразу на нём */
    spellLevel?: number;
    availableSpellLevels?: number[];
    spellScalingDice?: string;
    evaluateBonusDamageParts?: (context: {
      hasAdvantage: boolean;
      hasDisadvantage: boolean;
    }) => SpellDamagePartInput[];
    onRollParts?: (parts: RolledSpellDamagePart[]) => void;
    onHit?: () => void;
    /** Окно закрыли, не бросив: снимает со сцены размещённый AoE-шаблон */
    onCancel?: () => void;
  }

  const rollConfig = ref<SpellRollConfig>({
    title: '',
    name: '',
    formula: '',
    rollButtonText: SPELL_DAMAGE_ROLL_BUTTON,
    initialRollMode: 'normal',
    isHealing: false,
    damageParts: [],
  });

  /** Существо-источник (для casterId, эффектов, @-переменных) */
  function getCreatureEntity(): DnDCreature | null {
    const worldId = worldStore.connectionState.currentWorldId;
    const world = worldStore.worlds.find((entry) => entry.id === worldId);

    // Стор хоста хранит сущности в нейтральной форме — сужаем к D&D-форме,
    // как и везде на границе с хостом.
    return (
      (world?.creatures?.find((entry) => entry.id === props.creatureId) as
        DnDCreature | undefined) ?? null
    );
  }

  /** Сущности текущего мира (акторы + существа) — цели применения */
  function getCurrentWorldEntities(): SceneEntity[] {
    const worldId = worldStore.connectionState.currentWorldId;
    const world = worldStore.worlds.find((entry) => entry.id === worldId);

    if (!world) {
      return [];
    }

    return [...(world.actors ?? []), ...(world.creatures ?? [])];
  }

  /** Основной тип урона заклинания (для цвета шаблона и подписи броска) */
  function spellPrimaryType(spell: Spell): string | undefined {
    const first = spell.damageParts?.[0];

    return first ? describeDamagePart(first).types[0] : undefined;
  }

  /**
   * Запускает каст заклинания существа. Списывает применение (если есть), для
   * области сначала размещает шаблон у токена существа, затем открывает бросок.
   *
   * @param spell - заклинание существа
   * @param placement - группа, из которой идёт каст
   */
  function castSpell(spell: Spell, placement?: CreatureSpellPlacement): void {
    if (props.isReadOnly) {
      return;
    }

    const creature = getCreatureEntity();

    if (!creature) {
      return;
    }

    const isGroupEmpty =
      placement !== undefined
      && !hasCreatureSpellGroupUsesLeft(placement.group);

    const isSpellEmpty =
      !!spell.uses
      && spell.uses.recovery !== 'atWill'
      && spell.uses.current <= 0;

    if (isGroupEmpty || isSpellEmpty) {
      toast.add({
        title: ACTOR_SPELLS_TAB_LABELS.noUsesTitle,
        description:
          ACTOR_SPELLS_TAB_LABELS.noUsesTextPrefix
          + spell.name
          + ACTOR_SPELLS_TAB_LABELS.noUsesTextSuffix,
        color: 'warning',
      });

      return;
    }

    consumeSpellUse(spell, placement);

    // Область: размещаем шаблон у токена существа, затем кидаем урон
    if (spell.areaOfEffect) {
      const color =
        SPELL_DAMAGE_TEMPLATE_COLORS[spellPrimaryType(spell) ?? '']
        ?? SPELL_TEMPLATE_DEFAULT_COLOR;

      spellTemplateStore.requestPlacement(
        spell.areaOfEffect,
        color,
        props.creatureId,
        (templateId) => startSpellRoll(spell, creature, templateId, placement),
        null,
      );

      return;
    }

    startSpellRoll(spell, creature, undefined, placement);
  }

  /**
   * Готовит и открывает DiceRollModal для заклинания существа (многочастный
   * путь). Атакующие заклинания идут с броском попадания (плоский бонус блока,
   * а без блока — существа); спасброски/область — без него.
   *
   * @param spell - заклинание существа
   * @param creature - существо-источник
   * @param templateId - id размещённого AoE-шаблона (если область)
   * @param placement - группа, из которой идёт каст
   */
  function startSpellRoll(
    spell: Spell,
    creature: DnDCreature,
    templateId: string | undefined,
    placement?: CreatureSpellPlacement,
  ): void {
    const attackType = getSpellAttackType(spell);

    const usesSaveOrArea =
      (!!spell.saveType && spell.saveType !== 'none') || !!spell.areaOfEffect;

    const usesAttack = attackType !== undefined && !usesSaveOrArea;

    const effects = collectActiveEffects(creature);

    const targetHp = spell.areaOfEffect ? undefined : buildTargetHpContext();

    const targetIsFull = targetHp
      ? targetHp.currentHp >= targetHp.maxHp
      : undefined;

    const numbers = calculateCreatureSpellBlockNumbers(
      creature,
      placement?.block,
    );

    // Существо как заклинатель: Сл блока и модификатор его характеристики
    const casterSource: SpellCasterSource = {
      saveDc: numbers.saveDC ?? DEFAULT_CREATURE_SPELL_SAVE_DC,
      spellMod: getCreatureSpellMod(
        creature,
        getCreatureSpellBlockAbility(creature, placement?.block),
      ),
    };

    const castKey = generateId(SPELL_CAST_KEY_PREFIX);

    const setup = buildCreatureSpellRollSetup({
      spell,
      creature,
      effects,
      targetIsFull,
      targetType: targetHp?.creatureType,
      spellcastingAbility: getCreatureSpellBlockAbility(
        creature,
        placement?.block,
      ),
    });

    // Эффекты заклинания — всегда через оркестратор по каждой задетой цели: он
    // отбирает эффекты на цель, бросает их спасбросок и урон. Прямое наложение
    // при попадании кидало на цель ВСЕ эффекты (и «себе») мимо спасброска
    const enabledEffects = spell.activeEffects?.filter(
      (effect) => !effect.disabled,
    );

    setup.pseudoSpell.activeEffects = enabledEffects?.length
      ? enabledEffects
      : undefined;

    // Атака без частей урона: окно броска не зовёт `onRollParts`, и эффекты на
    // попадании разбирает тот же оркестратор с пустым набором частей
    const onHit =
      usesAttack
      && setup.baseParts.length === 0
      && setup.pseudoSpell.activeEffects
        ? () =>
            applySpellParts(
              creature,
              setup.pseudoSpell,
              [],
              templateId,
              casterSource,
              castKey,
            )
        : undefined;

    const isHealing = spellIsHealing(spell);

    // Круг наложения фиксирует окно броска: список кругов из одного значения,
    // ячейки существо всё равно не тратит. Без круга секция не показывается —
    // так же, как было до групп
    const castLevel = placement?.ref.castLevel;

    rollConfig.value = {
      title: usesAttack
        ? CREATURE_ACTIONS_BLOCK_LABELS.attackRollPrefix + spell.name
        : spell.name,
      name: spell.name,
      formula: setup.baseParts[0]?.formula ?? '',
      rollButtonText: getCreatureSpellRollButtonText(usesAttack, isHealing),
      attackModifier: usesAttack ? numbers.attackBonus : undefined,
      evaluateBonusRollFormulas: usesAttack
        ? buildRollBonusEvaluator(
            () => getCreatureEntity() ?? undefined,
            'attack.spell',
          )
        : undefined,
      initialRollMode: 'normal',
      incomingAttackType: usesAttack ? attackType : undefined,
      damageType: spellPrimaryType(spell),
      isHealing,
      damageParts: setup.baseParts,
      spellLevel: castLevel === undefined ? undefined : spell.level,
      availableSpellLevels: castLevel === undefined ? undefined : [castLevel],
      spellScalingDice:
        castLevel === undefined ? undefined : spell.scaling?.additionalDice,
      evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
      onRollParts: (parts: RolledSpellDamagePart[]) =>
        applySpellParts(
          creature,
          setup.pseudoSpell,
          parts,
          templateId,
          casterSource,
          castKey,
        ),
      onHit,
      // Отмена окна (крестик, Escape, конец сессии) обязана убрать шаблон: он
      // размещается ДО броска, и без этого отменённый каст оставлял область
      // висеть на карте до перезагрузки сцены
      onCancel: templateId ? () => discardSpellTemplate(templateId) : undefined,
    };

    isRollModalOpen.value = true;
  }

  /**
   * Применяет брошенные части урона/лечения заклинания существа через
   * многочастный оркестратор (спасброски целей, защиты по типу, AoE-шаблон,
   * единый HP-апдейт). DC спасброска — плоский из блока, а без блока — из
   * заклинательства существа.
   *
   * @param creature - существо-источник (casterId для self-частей)
   * @param pseudoSpell - псевдо-заклинание (клон с activeEffects для спас/области)
   * @param parts - брошенные части урона
   * @param templateId - id размещённого AoE-шаблона (если был)
   * @param casterSource - Сл блока и модификатор характеристики существа
   * @param castKey - ключ каста: окно зовёт применение и по попаданию, и по
   *   частям урона
   */
  function applySpellParts(
    creature: DnDCreature,
    pseudoSpell: Spell,
    parts: RolledSpellDamagePart[],
    templateId: string | undefined,
    casterSource: SpellCasterSource,
    castKey: string,
  ): void {
    const actors = getCurrentWorldEntities();
    const socket = chatStore.getSocket();

    let cachedTemplate: MeasurementTemplate | null = null;

    if (templateId) {
      cachedTemplate = spellTemplateStore.getPlacedTemplate(templateId) ?? null;
      spellTemplateStore.removePlacedTemplate(templateId);
    }

    if (actors.length > 0 && socket) {
      void resolveSpellDamageWithParts(
        {
          spell: pseudoSpell,
          damageTotal: 0,
          spellSaveDC: casterSource.saveDc,
          actors,
          socket,
          casterId: creature.id,
        },
        parts,
        { scene: worldStore.currentScene, cachedTemplate },
      );
    }

    // Эффекты на самом существе, зона на месте шаблона, конец концентрации
    completeSpellCast({
      spell: pseudoSpell,
      caster: getCreatureEntity() ?? creature,
      source: casterSource,
      template: cachedTemplate,
      applyCasterEffects: true,
      castKey,
    });

    if (templateId) {
      spellTemplateStore.deleteTemplate(templateId);
    }
  }
</script>

<template>
  <div class="relative flex min-h-50 flex-col space-y-4">
    <!-- Шапка вкладки: только ряд отбора. Плитки чисел стоят у блоков — они
      там свои у каждого, и общей на вкладку быть не может -->
    <div class="mb-2 flex flex-col gap-2">
      <!-- Поиск и отбор одной строкой: слева чипы способов отката, справа поле
        поиска, сброс и «Добавить блок». Разносит их распор на поле поиска. Ряд
        остаётся и у пустой вкладки — там в нём одна кнопка -->
      <div
        v-if="hasFilterControls || canAddStructure"
        class="flex flex-wrap items-center gap-x-1.5 gap-y-2"
      >
        <template v-if="hasFilterControls">
          <FilterChip
            v-for="chip in recoveryChips"
            :key="chip.key"
            :label="chip.label"
            :tooltip="chip.hint"
            :picked="chip.isPicked"
            @toggle="toggleRecoveryFilter(chip.key)"
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

          <FilterResetButton
            v-if="hasPickedChips"
            @reset="resetFilters"
          />
        </template>

        <UButton
          v-if="canAddStructure"
          icon="tabler:plus"
          variant="soft"
          :size="FILTER_ROW_CONTROL_SIZE"
          class="shrink-0"
          :class="{ 'ml-auto': !hasFilterControls }"
          :aria-label="CREATURE_SPELL_BLOCKS_LABELS.addBlockAria"
          :title="CREATURE_SPELL_BLOCKS_LABELS.addBlockHint"
          @click.left.exact.prevent="addBlock"
        >
          {{ CREATURE_SPELL_BLOCKS_LABELS.addBlock }}
        </UButton>
      </div>
    </div>

    <!-- Блоки заклинаний: числа, группы и их списки -->
    <div
      v-if="visibleBlockViews.length"
      class="flex flex-col gap-2"
    >
      <CreatureSpellBlockCard
        v-for="view in visibleBlockViews"
        :key="view.block.id"
        :view="view"
        :expanded="isBlockExpanded(view.block.id)"
        :can-edit="canEdit"
        :can-add-group="canAddStructure"
        :is-read-only="isReadOnly"
        @toggle="toggleBlock(view.block.id)"
        @edit-block="openBlockForm(view.block.id)"
        @remove-block="askRemoval('block', view.block.id)"
        @add-group="addGroup(view.block.id)"
        @edit-group="openGroupForm($event)"
        @remove-group="askRemoval('group', $event)"
        @add-spells="openSpellPicker($event)"
        @open-spell="openDetail($event)"
        @cast-spell="castSpell($event, findPlacement($event.id))"
        @spell-dragstart="
          handleSpellDragStart($event.event, $event.spell, $event.groupId)
        "
        @spell-drop="handleSpellDrop($event, view.block.id)"
      />
    </div>

    <!-- Пусто: блоков нет, заводить их зовёт кнопка в ряду отбора -->
    <p
      v-if="!blocks.length"
      class="text-sm text-dimmed"
    >
      {{ CREATURE_EMPTY_LABELS.spells }}
    </p>

    <!-- Отбор ничего не оставил -->
    <p
      v-if="hasAnyFilter && !visibleBlockViews.length"
      class="py-4 text-center text-sm text-dimmed"
    >
      {{ SHEET_FILTER_LABELS.empty }}
    </p>

    <CreatureSpellBlockFormModal
      v-model:open="isBlockFormOpen"
      :block="editedBlock"
      :creature="creature"
      @apply="applyBlock"
    />

    <CreatureSpellGroupFormModal
      v-model:open="isGroupFormOpen"
      :group="editedGroup"
      @apply="applyGroup"
    />

    <CreatureSpellRefModal
      v-model:open="isRefFormOpen"
      :spell-ref="editedRef?.ref"
      :spell-name="
        editedRef ? spellsById.get(editedRef.ref.spellId)?.name : undefined
      "
      @apply="applyRef"
    />

    <CompendiumRefPickerModal
      v-if="socket"
      v-model:open="isPickerOpen"
      :socket="socket"
      kind="spell"
      :title="CREATURE_SPELL_BLOCKS_LABELS.pickSpellsTitle"
      :filter-value="spellLevelFilterValue"
      :filter-label="REF_PICKER_LABELS.filterSpellLevel"
      :filter-order="SPELL_LEVEL_FILTER_ORDER"
      :z-index="pickerZIndex"
      multiple
      @select="addPickedSpells"
    />

    <!-- Подтверждение удаления блока или группы: за свёрнутой шапкой их
      содержимого не видно -->
    <UDraggableModal
      :open="pendingRemoval !== undefined"
      :title="DELETE_CONFIRM_TITLE"
      :draggable="false"
      :resizable="false"
      blocking
      :min-width="400"
      :min-height="160"
      :z-index="removalZIndex"
      @update:open="handleRemovalOpenChange"
    >
      <template #body>
        <div class="space-y-4">
          <p class="text-sm text-toned">{{ removalText }}</p>

          <div class="flex justify-end gap-2">
            <UButton
              variant="ghost"
              color="neutral"
              size="sm"
              @click.left.exact.prevent="pendingRemoval = undefined"
            >
              {{ MODAL_BUTTON_LABELS.cancel }}
            </UButton>

            <UButton
              color="error"
              icon="tabler:trash"
              size="sm"
              @click.left.exact.prevent="confirmRemoval"
            >
              {{ MODAL_BUTTON_LABELS.remove }}
            </UButton>
          </div>
        </div>
      </template>
    </UDraggableModal>

    <DiceRollModal
      v-model:open="isRollModalOpen"
      :formula="rollConfig.formula"
      :title="rollConfig.title"
      :roll-label="rollConfig.name"
      :attack-modifier="rollConfig.attackModifier"
      :evaluate-bonus-roll-formulas="rollConfig.evaluateBonusRollFormulas"
      :initial-roll-mode="rollConfig.initialRollMode"
      :incoming-attack-type="rollConfig.incomingAttackType"
      :damage-type="rollConfig.damageType"
      :is-healing="rollConfig.isHealing"
      :roll-button-text="rollConfig.rollButtonText"
      :damage-parts="rollConfig.damageParts"
      :spell-level="rollConfig.spellLevel"
      :available-spell-levels="rollConfig.availableSpellLevels"
      :spell-scaling-dice="rollConfig.spellScalingDice"
      :evaluate-bonus-damage-parts="rollConfig.evaluateBonusDamageParts"
      :on-roll-parts="rollConfig.onRollParts"
      :on-hit="rollConfig.onHit"
      :on-cancel="rollConfig.onCancel"
    />
  </div>
</template>
