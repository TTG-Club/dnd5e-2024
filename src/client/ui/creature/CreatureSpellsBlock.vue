<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { MeasurementTemplate, SceneEntity } from '@vtt/shared';
  import type {
    AttackRollMode,
    CreatureSpellcasting,
    DnDCreature,
    Spell,
    SpellUsesRecovery,
  } from '@vtt/shared/system/dnd.js';

  import type {
    RolledSpellDamagePart,
    SpellDamagePartInput,
  } from '../../composables/useSpellResolution';
  import type { SheetRowStat } from '../actor/sheetRowTypes';

  import { useToast } from '@nuxt/ui/composables';
  import { computed, ref } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useChatStore } from '@/stores/chatStore';
  import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
  import { useTargetStore } from '@/stores/targetStore';
  import { useWorldStore } from '@/stores/worldStore';
  import {
    ABILITY_LABELS,
    collectActiveEffects,
    describeDamagePart,
    getCreatureSpellAttackBonus,
    getCreatureSpellRollButtonText,
    getCreatureSpellSaveDC,
    getSpellAttackType,
    SPELL_DAMAGE_TEMPLATE_COLORS,
    SPELL_SCHOOL_LABELS,
    SPELL_TEMPLATE_DEFAULT_COLOR,
    SPELL_USES_RECOVERY_LABELS,
    spellIsHealing,
  } from '@vtt/shared/system/dnd.js';

  import { useBonusDamageParts } from '../../composables/useBonusDamageParts';
  import { useSpellResolution } from '../../composables/useSpellResolution';
  import {
    FILTER_ROW_CONTROL_SIZE,
    SHEET_FILTER_LABELS,
    SHEET_ROW_MENU_LABELS,
    SPELL_MENU_LABELS,
    SPELL_MIME,
    SPELL_STAT_HINTS,
    SPELL_STAT_LABELS,
  } from '../actor/constants';
  import DiceRollModal from '../actor/DiceRollModal.vue';
  import FilterChip from '../actor/FilterChip.vue';
  import FilterResetButton from '../actor/FilterResetButton.vue';
  import SheetStatTile from '../actor/SheetStatTile.vue';
  import { formatSpellDamageDisplay } from '../actor/utils/formatSpellDamageDisplay';
  import {
    CREATURE_EMPTY_LABELS,
    CREATURE_SPELL_RECOVERY_CHIPS,
    CREATURE_SPELLCASTING_LABELS,
  } from './constants';
  import CreatureSpellcastingModal from './CreatureSpellcastingModal.vue';
  import CreatureSpellRow from './CreatureSpellRow.vue';

  interface Props {
    /** Существо-источник (для авто-вывода DC/бонуса из характеристики) */
    creature?: DnDCreature;
    /** Заклинания существа (верхний уровень `Creature.spells`) */
    spells?: Spell[];
    /** Параметры заклинательства (плоский DC/бонус атаки, характеристика) */
    spellcasting?: CreatureSpellcasting;
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
  }

  const props = withDefaults(defineProps<Props>(), {
    creature: undefined,
    spells: () => [],
    spellcasting: undefined,
    isReadOnly: false,
    canEdit: false,
  });

  const emit = defineEmits<{
    'update:spells': [value: Spell[]];
    'update:spellcasting': [value: CreatureSpellcasting];
  }>();

  const { openModal } = useModalManager();
  const toast = useToast();
  const chatStore = useChatStore();
  const targetStore = useTargetStore();
  const worldStore = useWorldStore();
  const spellTemplateStore = useSpellTemplateStore();

  const { buildCreatureSpellRollSetup, buildTargetHpContext } =
    useBonusDamageParts();

  const { resolveSpellDamageWithParts } = useSpellResolution();

  /** Параметры заклинательства с дефолтом */
  const block = computed<CreatureSpellcasting>(() => props.spellcasting ?? {});

  /**
   * Эффективная сложность спасброска: ручное значение либо авто-вывод из
   * характеристики (`8 + бонус мастерства + мод.`), если выбрана.
   */
  const effectiveSaveDC = computed(() =>
    props.creature
      ? getCreatureSpellSaveDC(props.creature)
      : block.value.saveDC,
  );

  /**
   * Эффективный бонус к атаке: ручное значение либо авто-вывод из
   * характеристики (`бонус мастерства + мод.`), если выбрана.
   */
  const effectiveAttackBonus = computed(() =>
    props.creature
      ? getCreatureSpellAttackBonus(props.creature)
      : block.value.attackBonus,
  );

  /**
   * Числа заклинательства для плитки шапки. Подписи короткие, чтобы плитка
   * помещалась на узком листе, — полное название остаётся в подсказке ячейки.
   */
  const spellcastingCells = computed(() => [
    {
      label: CREATURE_SPELLCASTING_LABELS.saveDC,
      hint: CREATURE_SPELLCASTING_LABELS.saveDCHint,
      value: effectiveSaveDC.value ?? CREATURE_SPELLCASTING_LABELS.none,
    },
    {
      label: CREATURE_SPELLCASTING_LABELS.attack,
      hint: CREATURE_SPELLCASTING_LABELS.attackHint,
      value:
        effectiveAttackBonus.value === undefined
          ? CREATURE_SPELLCASTING_LABELS.none
          : `${effectiveAttackBonus.value >= 0 ? '+' : ''}${effectiveAttackBonus.value}`,
    },
    {
      label: CREATURE_SPELLCASTING_LABELS.ability,
      hint: CREATURE_SPELLCASTING_LABELS.abilityHint,
      value: block.value.ability
        ? ABILITY_LABELS[block.value.ability]
        : CREATURE_SPELLCASTING_LABELS.none,
    },
  ]);

  /** Открыто ли окно настройки заклинательства */
  const isSpellcastingModalOpen = ref(false);

  /** Подсказка плитки: нажимается она только у того, кто правит существо */
  const spellcastingTooltip = computed(() =>
    props.canEdit ? CREATURE_SPELLCASTING_LABELS.open : undefined,
  );

  /**
   * Сохраняет настройку заклинательства из окна. Окно отдаёт блок целиком, а не
   * патч: способ расчёта выключает соседнее поле (своё число — поправку и
   * наоборот), и слияние оставило бы в записи оба числа сразу.
   *
   * @param updated - параметры заклинательства из окна
   */
  function applySpellcasting(updated: CreatureSpellcasting): void {
    emit('update:spellcasting', updated);
  }

  /**
   * Эмитит обновлённый список заклинаний существа.
   * @param spells - новый список заклинаний
   */
  function updateSpells(spells: Spell[]): void {
    emit('update:spells', spells);
  }

  // ── Отбор и поиск ─────────────────────────────────────────────────────────

  const searchQuery = ref('');

  /** Отмеченные чипами способы отката; пусто — список не сужается */
  const pickedRecoveries = ref<Set<SpellUsesRecovery>>(new Set());

  /** Способ отката заклинания: без зарядов оно доступно по желанию */
  function getSpellRecovery(spell: Spell): SpellUsesRecovery {
    return spell.uses?.recovery ?? 'atWill';
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

  /** Список сужен: отбор есть что сбросить */
  const hasAnyFilter = computed(
    () => activeRecoveries.value.length > 0 || searchQuery.value.trim() !== '',
  );

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

  // ── Сборка строк списка ───────────────────────────────────────────────────

  /**
   * Подпись под названием — школа магии. Способ отката называть незачем: он
   * стоит в заголовке раздела, под которым лежит строка.
   *
   * @param spell - заклинание
   * @returns название школы
   */
  function getSpellSubtitle(spell: Spell): string {
    return SPELL_SCHOOL_LABELS[spell.school] ?? '';
  }

  /**
   * Плитки строки заклинания: урон (катится по нажатию) и заряды. Те же поля,
   * что и у строки заклинания на листе персонажа.
   *
   * @param spell - заклинание
   * @returns плитки в порядке показа
   */
  function getSpellStats(spell: Spell): SheetRowStat[] {
    const stats: SheetRowStat[] = [];

    const damage = formatSpellDamageDisplay(spell);

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

    return stats;
  }

  /**
   * Пункты меню строки заклинания. Меню одно на правую кнопку мыши и на «⋮»:
   * сначала игровое действие, ниже — действия над записью, последним удаление.
   *
   * @param spell - заклинание
   * @returns группы пунктов
   */
  function getSpellMenuItems(spell: Spell): DropdownMenuItem[][] {
    const groups: DropdownMenuItem[][] = [];

    if (!props.isReadOnly) {
      groups.push([
        {
          label: SPELL_MENU_LABELS.cast,
          icon: 'tabler:sparkles',
          onSelect: () => castSpell(spell),
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
   * Разделы по способу отката со строками, уже собранными для показа. Пустые
   * разделы в список не попадают — под отбором их заголовки висели бы зря.
   */
  const spellRowGroups = computed(() =>
    CREATURE_SPELL_RECOVERY_CHIPS.map((group) => ({
      key: group.key,
      label: SPELL_USES_RECOVERY_LABELS[group.key],
      rows: filteredSpells.value
        .filter((spell) => getSpellRecovery(spell) === group.key)
        .map((spell) => ({
          spell,
          subtitle: getSpellSubtitle(spell),
          stats: getSpellStats(spell),
          menuItems: getSpellMenuItems(spell),
        })),
    })).filter((group) => group.rows.length > 0),
  );

  /**
   * Начинает перетаскивание заклинания: MIME для переноса на другой лист и
   * макрос существа для хотбара.
   *
   * @param event - событие dragstart
   * @param spell - заклинание существа
   */
  function handleSpellDragStart(event: DragEvent, spell: Spell): void {
    if (!event.dataTransfer) {
      return;
    }

    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(SPELL_MIME, JSON.stringify(spell));

    startHotbarDrag(event, {
      id: `${props.creatureId}-spell-${spell.id}`,
      type: 'creature-spell',
      label: spell.name,
      icon: 'tabler:wand',
      ref: spell.id,
      actorId: props.creatureId,
    });
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
   * Удаляет заклинание существа.
   * @param spellId - id заклинания
   */
  function deleteSpell(spellId: string): void {
    updateSpells(props.spells.filter((entry) => entry.id !== spellId));
  }

  /**
   * Открывает детальную карточку заклинания (просмотр + кнопка применения).
   * @param spell - заклинание
   */
  function openDetail(spell: Spell): void {
    openModal('SpellDetailModal', {
      spell,
      showCastButton: !props.isReadOnly,
      onCast: () => castSpell(spell),
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

  // ── Списание зарядов ──────────────────────────────────────────────────────

  /**
   * Списывает один заряд заклинания (для заклинаний с откатом, не «по желанию»).
   * @param spell - заклинание
   */
  function consumeSpellUse(spell: Spell): void {
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

  const rollConfig = ref({
    title: '',
    name: '',
    formula: '',
    rollButtonText: 'Бросить урон',
    attackModifier: undefined as number | undefined,
    initialRollMode: 'normal' as AttackRollMode,
    incomingAttackType: undefined as 'melee' | 'ranged' | 'spell' | undefined,
    damageType: undefined as string | undefined,
    isHealing: false,
    damageParts: [] as SpellDamagePartInput[],
    evaluateBonusDamageParts: undefined as
      | ((context: {
          hasAdvantage: boolean;
          hasDisadvantage: boolean;
        }) => SpellDamagePartInput[])
      | undefined,
    onRollParts: undefined as
      ((parts: RolledSpellDamagePart[]) => void) | undefined,
    onHit: undefined as (() => void) | undefined,
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
   * Запускает каст заклинания существа. Списывает заряд (если есть), для области
   * сначала размещает шаблон у токена существа, затем открывает бросок.
   *
   * @param spell - заклинание существа
   */
  function castSpell(spell: Spell): void {
    if (props.isReadOnly) {
      return;
    }

    const creature = getCreatureEntity();

    if (!creature) {
      return;
    }

    if (
      spell.uses
      && spell.uses.recovery !== 'atWill'
      && spell.uses.current <= 0
    ) {
      toast.add({
        title: 'Нет зарядов',
        description: `У «${spell.name}» не осталось зарядов — нужен отдых.`,
        color: 'warning',
      });

      return;
    }

    consumeSpellUse(spell);

    // Область: размещаем шаблон у токена существа, затем кидаем урон
    if (spell.areaOfEffect) {
      const color =
        SPELL_DAMAGE_TEMPLATE_COLORS[spellPrimaryType(spell) ?? '']
        ?? SPELL_TEMPLATE_DEFAULT_COLOR;

      spellTemplateStore.requestPlacement(
        spell.areaOfEffect,
        color,
        props.creatureId,
        (templateId) => startSpellRoll(spell, creature, templateId),
        null,
      );

      return;
    }

    startSpellRoll(spell, creature, undefined);
  }

  /**
   * Готовит и открывает DiceRollModal для заклинания существа (многочастный
   * путь). Атакующие заклинания идут с броском попадания (плоский бонус из
   * блока заклинательства); спасброски/область — без него.
   *
   * @param spell - заклинание существа
   * @param creature - существо-источник
   * @param templateId - id размещённого AoE-шаблона (если область)
   */
  function startSpellRoll(
    spell: Spell,
    creature: DnDCreature,
    templateId: string | undefined,
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

    const setup = buildCreatureSpellRollSetup({
      spell,
      creature,
      effects,
      targetIsFull,
    });

    // Эффекты заклинания: у атак — на цель при попадании; у спаса/области —
    // через оркестратор по каждой задетой цели в зависимости от спаса.
    const enabledEffects = spell.activeEffects?.filter(
      (effect) => !effect.disabled,
    );

    let onHit: (() => void) | undefined;

    if (!usesAttack) {
      setup.pseudoSpell.activeEffects = enabledEffects?.length
        ? enabledEffects
        : undefined;
    } else if (enabledEffects?.length) {
      onHit = () => {
        targetStore.applyEffectsToTarget(enabledEffects, 'feature');
      };
    }

    const isHealing = spellIsHealing(spell);

    rollConfig.value = {
      title: usesAttack ? `Атака — ${spell.name}` : spell.name,
      name: spell.name,
      formula: setup.baseParts[0]?.formula ?? '',
      rollButtonText: getCreatureSpellRollButtonText(usesAttack, isHealing),
      attackModifier: usesAttack
        ? getCreatureSpellAttackBonus(creature)
        : undefined,
      initialRollMode: 'normal',
      incomingAttackType: usesAttack ? attackType : undefined,
      damageType: spellPrimaryType(spell),
      isHealing,
      damageParts: setup.baseParts,
      evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
      onRollParts: (parts: RolledSpellDamagePart[]) =>
        applySpellParts(creature, setup.pseudoSpell, parts, templateId),
      onHit,
    };

    isRollModalOpen.value = true;
  }

  /**
   * Применяет брошенные части урона/лечения заклинания существа через
   * многочастный оркестратор (спасброски целей, защиты по типу, AoE-шаблон,
   * единый HP-апдейт). DC спасброска — плоский из блока заклинательства.
   *
   * @param creature - существо-источник (casterId для self-частей)
   * @param pseudoSpell - псевдо-заклинание (клон с activeEffects для спас/области)
   * @param parts - брошенные части урона
   * @param templateId - id размещённого AoE-шаблона (если был)
   */
  function applySpellParts(
    creature: DnDCreature,
    pseudoSpell: Spell,
    parts: RolledSpellDamagePart[],
    templateId: string | undefined,
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
          spellSaveDC: getCreatureSpellSaveDC(creature) ?? 10,
          actors,
          socket,
          casterId: creature.id,
        },
        parts,
        { scene: worldStore.currentScene, cachedTemplate },
      );
    }

    if (templateId) {
      spellTemplateStore.deleteTemplate(templateId);
    }
  }
</script>

<template>
  <div class="relative flex min-h-50 flex-col space-y-4">
    <!-- Шапка вкладки: ряд плиток и ряд отбора — те же, что у вкладки
      заклинаний на листе персонажа -->
    <div class="mb-2 flex flex-col gap-2">
      <!-- Обёртка-flex: плитка занимает ширину по содержимому, а не всю строку.
        Настройка открывается и вне правки листа — как заклинательство на листе
        персонажа: правка идёт в окне и сохраняется сразу -->
      <div class="flex flex-wrap items-center gap-2">
        <SheetStatTile
          :cells="spellcastingCells"
          :tooltip="spellcastingTooltip"
          :aria-label="CREATURE_SPELLCASTING_LABELS.open"
          :clickable="canEdit"
          @click="isSpellcastingModalOpen = true"
        />
      </div>

      <!-- Поиск и отбор одной строкой: слева чипы способов отката, справа поле
        поиска и сброс. Разносит их распор на поле поиска -->
      <div
        v-if="hasFilterControls"
        class="flex flex-wrap items-center gap-x-1.5 gap-y-2"
      >
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
          v-if="hasAnyFilter"
          @reset="resetFilters"
        />
      </div>
    </div>

    <!-- Список заклинаний по способу отката -->
    <div
      v-for="group in spellRowGroups"
      :key="group.key"
      class="space-y-1"
    >
      <!-- Заголовок раздела: подпись слева, линия до края строки — как у
        кругов заклинаний на листе персонажа -->
      <div class="flex items-center gap-2 px-1 pt-2 pb-1">
        <span
          class="shrink-0 text-xs font-semibold tracking-wider text-muted uppercase"
        >
          {{ group.label }}
        </span>

        <div class="h-px flex-1 bg-accented/50" />
      </div>

      <div class="flex flex-col gap-2">
        <CreatureSpellRow
          v-for="row in group.rows"
          :key="row.spell.id"
          :spell="row.spell"
          :subtitle="row.subtitle"
          :stats="row.stats"
          :menu-items="row.menuItems"
          :can-cast="!isReadOnly"
          @open="openDetail(row.spell)"
          @cast="castSpell(row.spell)"
          @dragstart="handleSpellDragStart($event, row.spell)"
        />
      </div>
    </div>

    <!-- Пусто -->
    <p
      v-if="spells.length === 0"
      class="text-sm text-dimmed"
    >
      {{ CREATURE_EMPTY_LABELS.spells }}
    </p>

    <p
      v-else-if="spellRowGroups.length === 0"
      class="py-4 text-center text-sm text-dimmed"
    >
      {{ SHEET_FILTER_LABELS.empty }}
    </p>

    <!-- Окно настройки заклинательства -->
    <CreatureSpellcastingModal
      v-if="creature"
      v-model:open="isSpellcastingModalOpen"
      :spellcasting="spellcasting"
      :abilities="creature.system.abilities"
      :proficiency-bonus="creature.system.proficiencyBonus"
      @apply="applySpellcasting"
    />

    <DiceRollModal
      v-model:open="isRollModalOpen"
      :formula="rollConfig.formula"
      :title="rollConfig.title"
      :roll-label="rollConfig.name"
      :attack-modifier="rollConfig.attackModifier"
      :initial-roll-mode="rollConfig.initialRollMode"
      :incoming-attack-type="rollConfig.incomingAttackType"
      :damage-type="rollConfig.damageType"
      :is-healing="rollConfig.isHealing"
      :roll-button-text="rollConfig.rollButtonText"
      :damage-parts="rollConfig.damageParts"
      :evaluate-bonus-damage-parts="rollConfig.evaluateBonusDamageParts"
      :on-roll-parts="rollConfig.onRollParts"
      :on-hit="rollConfig.onHit"
    />
  </div>
</template>
