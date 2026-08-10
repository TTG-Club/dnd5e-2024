<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type { MeasurementTemplate, SceneEntity } from '@vtt/shared';
  import type {
    AttackRollMode,
    CreatureAction,
    DnDCreature,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type {
    RolledSpellDamagePart,
    SpellDamagePartInput,
  } from '../../composables/useSpellResolution';
  import type { SheetRowStat } from '../actor/sheetRowTypes';

  import { computed, ref } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import { useChatStore } from '@/stores/chatStore';
  import { useSpellTemplateStore } from '@/stores/spellTemplateStore';
  import { useTargetStore } from '@/stores/targetStore';
  import { useWorldStore } from '@/stores/worldStore';
  import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
  import { DISTANCE_UNIT_SHORT } from '@vtt/shared';
  import {
    AREA_SHAPE_LABELS,
    collectActiveEffects,
    DEFAULT_REACH_FEET,
    describeDamagePart,
    getActionDescriptionMarkdown,
    SAVE_TYPE_LABELS,
    SPELL_DAMAGE_TEMPLATE_COLORS,
    SPELL_TEMPLATE_DEFAULT_COLOR,
  } from '@vtt/shared/system/dnd.js';

  import { useBonusDamageParts } from '../../composables/useBonusDamageParts';
  import { useSpellResolution } from '../../composables/useSpellResolution';
  import {
    ABILITY_SHORT_LABELS,
    FILTER_ROW_CONTROL_SIZE,
    SHEET_ROW_MENU_LABELS,
  } from '../actor/constants';
  import DiceRollModal from '../actor/DiceRollModal.vue';
  import { formatSignedNumber } from '../actor/utils/formatSignedNumber';
  import { checkCreatureActionRangeOnScene } from './composables/useCreatureRangeCheck';
  import {
    CREATURE_ACTION_MENU_LABELS,
    CREATURE_RANGE_TYPE_LABELS,
    CREATURE_ROW_ICONS,
    CREATURE_ROW_STAT_HINTS,
    CREATURE_ROW_STAT_LABELS,
  } from './constants';
  import CreatureActionDetailModal from './CreatureActionDetailModal.vue';
  import CreatureActionFormModal from './CreatureActionFormModal.vue';
  import CreatureActionRow from './CreatureActionRow.vue';
  import CreatureTraitRow from './CreatureTraitRow.vue';

  type ActionMode = 'trait' | 'action';

  interface Props {
    title?: string;
    actions: CreatureAction[];
    isEditMode: boolean;
    legendaryCount?: number;
    /** Режим: черта или действие (влияет на отображение боевых полей) */
    mode?: ActionMode;
    /** Режим только просмотр (компендиум) */
    isReadOnly?: boolean;
    /** ID существа для поддержки drag-and-drop на hotbar */
    creatureId?: string;
    /** Имя существа для подписи в hotbar */
    creatureName?: string;
    /**
     * Поиск по названию из ряда отбора вкладки. Сужает показ, но не сам список:
     * правка и удаление идут по месту записи в исходном массиве.
     */
    search?: string;
    /**
     * Своя строка заголовка с кнопкой «Добавить». Разделов у вкладки действий
     * несколько, и добавляют в каждый свой; у особенностей раздел один — там
     * кнопка уезжает в общий ряд отбора, а заголовок не нужен вовсе.
     */
    showHeader?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    title: undefined,
    legendaryCount: undefined,
    mode: 'action',
    isReadOnly: false,
    creatureId: undefined,
    creatureName: undefined,
    search: '',
    showHeader: true,
  });

  const emit = defineEmits<{
    'update': [actions: CreatureAction[]];
    'update:legendaryCount': [count: number];
  }>();

  const systemDataStore = useSystemDataStore();
  const chatStore = useChatStore();
  const targetStore = useTargetStore();
  const worldStore = useWorldStore();
  const spellTemplateStore = useSpellTemplateStore();

  const { buildCreatureRollSetup, buildTargetHpContext } =
    useBonusDamageParts();

  const { resolveSpellDamageWithParts } = useSpellResolution();

  // ── Просмотр действия (модалка) ──────────────────────────────────────────

  const isDetailOpen = ref(false);
  const detailAction = ref<CreatureAction | undefined>(undefined);

  /**
   * Открывает модалку просмотра действия (как у заклинаний/снаряжения).
   * @param action - действие существа
   */
  function openDetailModal(action: CreatureAction): void {
    detailAction.value = action;
    isDetailOpen.value = true;
  }

  /** «Атаковать» из модалки просмотра: закрывает её и запускает бросок */
  function handleDetailAttack(): void {
    const action = detailAction.value;

    isDetailOpen.value = false;

    if (action) {
      openRollModal(action);
    }
  }

  // ── Модалка создания/редактирования ─────────────────────────────────────

  const isFormOpen = ref(false);
  const editingAction = ref<CreatureAction | undefined>(undefined);
  const editingIndex = ref(-1);

  /**
   * Открывает модалку для создания нового действия
   */
  function openCreateForm(): void {
    editingAction.value = undefined;
    editingIndex.value = -1;
    isFormOpen.value = true;
  }

  /**
   * Открывает модалку для редактирования существующего действия
   * @param index - индекс действия в массиве
   */
  function openEditForm(index: number): void {
    editingAction.value = props.actions[index];
    editingIndex.value = index;
    isFormOpen.value = true;
  }

  /**
   * Обработчик сохранения из модалки
   * @param action - сохранённое действие
   * @param index - индекс (-1 = создание)
   */
  function handleActionSave(action: CreatureAction, index: number): void {
    if (index >= 0 && index < props.actions.length) {
      const updated = props.actions.map((existingAction, actionIndex) =>
        actionIndex === index ? action : existingAction,
      );

      emit('update', updated);
    } else {
      emit('update', [...props.actions, action]);
    }
  }

  /**
   * Удаляет действие по индексу
   * @param index - индекс действия
   */
  function removeAction(index: number): void {
    const updated = props.actions.filter(
      (_, actionIndex) => actionIndex !== index,
    );

    emit('update', updated);
  }

  /**
   * Возвращает локализованное название типа урона
   * @param damageTypeKey - ключ типа урона
   */
  function getDamageTypeLabel(damageTypeKey: string): string {
    const found = systemDataStore.damageTypes.find(
      (entry) => entry.key === damageTypeKey,
    );

    return found?.name ?? damageTypeKey;
  }

  /**
   * Сводка урона/лечения действия: формула (без токенов) и локализованные типы.
   * Единая со заклинаниями/оружием система damageParts.
   *
   * @param action - действие существа
   * @returns формула и подпись типов или null (нет частей урона)
   */
  function actionDamageSummary(
    action: CreatureAction,
  ): { formula: string; typeLabel: string } | null {
    const parts = action.damageParts ?? [];

    if (parts.length === 0) {
      return null;
    }

    const infos = parts.map((part) => describeDamagePart(part));

    const typeKeys = [...new Set(infos.flatMap((info) => info.types))];

    return {
      formula: infos.map((info) => info.formula).join(' + '),
      typeLabel: typeKeys.map((key) => getDamageTypeLabel(key)).join(', '),
    };
  }

  /** Основной тип урона действия (для цвета шаблона и подписи броска) */
  function actionPrimaryType(action: CreatureAction): string | undefined {
    const first = action.damageParts?.[0];

    return first ? describeDamagePart(first).types[0] : undefined;
  }

  /** Есть ли у действия спасбросок (заменяет бросок попадания) */
  function actionHasSave(action: CreatureAction): boolean {
    return !!action.saveType && action.saveType !== 'none';
  }

  /**
   * Проверяет, есть ли у действия боевые параметры (атака, урон или спасбросок)
   * @param action - действие
   */
  function hasAttackParams(action: CreatureAction): boolean {
    return !!(
      action.attackBonus !== undefined
      || (action.damageParts && action.damageParts.length > 0)
      || actionHasSave(action)
    );
  }

  // ── Броски урона ────────────────────────────────────────────────────────

  const isRollModalOpen = ref(false);

  const rollConfig = ref({
    title: '',
    name: '',
    formula: '',
    rollButtonText: 'Атаковать',
    attackModifier: undefined as number | undefined,
    initialRollMode: 'normal' as AttackRollMode,
    incomingAttackType: undefined as 'melee' | 'ranged' | 'spell' | undefined,
    damageType: undefined as string | undefined,
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

  /** Существо-источник действий (для casterId, эффектов, @-переменных) */
  function getCreatureEntity(): DnDCreature | null {
    if (!props.creatureId) {
      return null;
    }

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

  /**
   * Открывает модалку броска для действия. Атаки идут с броском попадания,
   * действия со спасброском/областью — без него (цель кидает спас). Перед
   * прямой атакой проверяется дистанция; для области сначала размещается шаблон.
   *
   * @param action - действие существа
   */
  function openRollModal(action: CreatureAction): void {
    if (!hasAttackParams(action)) {
      return;
    }

    const creature = getCreatureEntity();

    if (!creature) {
      return;
    }

    // Проверка дистанции — только для прямых атак (область таргетится шаблоном)
    let isDisadvantage = false;

    if (!action.areaOfEffect && targetStore.targetTokenId && props.creatureId) {
      const rangeCheck = checkCreatureActionRangeOnScene(
        action,
        props.creatureId,
        targetStore.targetTokenId,
      );

      if (rangeCheck && !rangeCheck.allowed) {
        chatStore.sendMessage(
          `⛔ ${action.name}: цель вне досягаемости (${rangeCheck.distance} ${rangeCheck.unitLabel})`,
          'text',
        );

        return;
      }

      if (rangeCheck?.disadvantage) {
        isDisadvantage = true;
      }
    }

    // Область: сначала размещаем шаблон у токена существа, затем кидаем урон
    if (action.areaOfEffect) {
      const color =
        SPELL_DAMAGE_TEMPLATE_COLORS[actionPrimaryType(action) ?? '']
        ?? SPELL_TEMPLATE_DEFAULT_COLOR;

      spellTemplateStore.requestPlacement(
        action.areaOfEffect,
        color,
        props.creatureId,
        (templateId) =>
          startActionRoll(action, creature, isDisadvantage, templateId),
        null,
      );

      return;
    }

    startActionRoll(action, creature, isDisadvantage, undefined);
  }

  /**
   * Готовит и открывает DiceRollModal для действия (многочастный путь).
   *
   * @param action - действие существа
   * @param creature - существо-источник
   * @param isDisadvantage - стартовать с помехой (проверка дистанции)
   * @param templateId - id размещённого AoE-шаблона (если действие с областью)
   */
  function startActionRoll(
    action: CreatureAction,
    creature: DnDCreature,
    isDisadvantage: boolean,
    templateId: string | undefined,
  ): void {
    const usesSaveOrArea = actionHasSave(action) || !!action.areaOfEffect;

    const effects = collectActiveEffects(creature);

    // Состояние HP цели для @target.* — только у одиночной цели (не у области)
    const targetHp = action.areaOfEffect ? undefined : buildTargetHpContext();

    const targetIsFull = targetHp
      ? targetHp.currentHp >= targetHp.maxHp
      : undefined;

    const setup = buildCreatureRollSetup({
      action,
      creature,
      effects,
      targetIsFull,
    });

    // Эффекты действия (статус/урон со своим applySave) обрабатывает
    // оркестратор per-target через `pseudoSpell.activeEffects` (выставлено в
    // buildCreatureRollSetup) — единый путь со заклинаниями и оружием.
    rollConfig.value = {
      title: usesSaveOrArea ? action.name : `Атака — ${action.name}`,
      name: action.name,
      formula: setup.baseParts[0]?.formula ?? '',
      rollButtonText: usesSaveOrArea ? 'Бросить урон' : 'Атаковать',
      attackModifier: usesSaveOrArea ? undefined : action.attackBonus,
      initialRollMode: isDisadvantage ? 'disadvantage' : 'normal',
      incomingAttackType: action.rangeType === 'ranged' ? 'ranged' : 'melee',
      damageType: actionPrimaryType(action),
      damageParts: setup.baseParts,
      evaluateBonusDamageParts: setup.evaluateBonusDamageParts,
      onRollParts: (parts: RolledSpellDamagePart[]) =>
        applyActionParts(
          action,
          creature,
          setup.pseudoSpell,
          parts,
          templateId,
        ),
      // Сбрасываем явно: `rollConfig` переиспользуется между бросками, и без
      // этого обработчик от ПРЕДЫДУЩЕГО броска остался бы висеть на текущем.
      onHit: undefined,
    };

    isRollModalOpen.value = true;
  }

  /**
   * Применяет брошенные части урона действия через многочастный оркестратор:
   * спасброски целей (одиночная цель или AoE-шаблон), защиты по типу, единый
   * HP-апдейт и одно сообщение в чат.
   *
   * @param action - действие существа (источник DC спасброска)
   * @param creature - существо-источник (casterId для self-частей)
   * @param pseudoSpell - псевдо-заклинание действия (saveType/saveEffect/эффекты)
   * @param parts - брошенные части урона
   * @param templateId - id размещённого AoE-шаблона (если был)
   */
  function applyActionParts(
    action: CreatureAction,
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
          spellSaveDC: action.saveDC ?? 10,
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

  /**
   * Обрабатывает нажатие по строке действия:
   * - в режиме редактирования — открывает форму;
   * - в остальных случаях — открывает карточку просмотра (бросок запускается
   *   значком в начале строки или плиткой параметра).
   *
   * @param action - действие существа
   * @param index - индекс действия
   */
  function handleActionClick(action: CreatureAction, index: number): void {
    if (props.isEditMode && !props.isReadOnly) {
      openEditForm(index);
    } else {
      openDetailModal(action);
    }
  }

  /**
   * Можно ли запустить бросок действия прямо из строки (есть боевые параметры,
   * не компендиум, известно существо-источник).
   * @param action - действие существа
   */
  function canUseAction(action: CreatureAction): boolean {
    return !props.isReadOnly && !!props.creatureId && hasAttackParams(action);
  }

  /** Показывать ли кнопку «Атаковать» в модалке просмотра действия */
  const canAttackFromDetail = computed(
    () => !!detailAction.value && canUseAction(detailAction.value),
  );

  /**
   * Обрабатывает ввод количества легендарных действий
   * @param event - событие ввода
   */
  function handleLegendaryCountInput(event: Event): void {
    emit(
      'update:legendaryCount',
      Number((event.target as HTMLInputElement).value),
    );
  }

  /**
   * Обработчик dragstart для перетаскивания действия на hotbar
   */
  function handleDragStart(event: DragEvent, action: CreatureAction): void {
    if (!props.creatureId) {
      return;
    }

    const label = props.creatureName
      ? `${props.creatureName} — ${action.name}`
      : action.name;

    startHotbarDrag(event, {
      id: `${props.creatureId}-${action.name.replace(/\\s+/g, '-')}`,
      type: 'creature-action',
      label,
      icon: 'tabler:alien',
      ref: action.name,
      actorId: props.creatureId,
    });
  }

  /**
   * Отправляет карточку записи в чат.
   * @param action - действие или особенность существа
   */
  function shareActionToChat(action: CreatureAction): void {
    chatStore.sendItemCard({
      cardType: 'feature',
      title: action.name,
      payload: JSON.stringify({
        name: action.name,
        description: getActionDescriptionMarkdown(action),
        featureType: props.mode === 'trait' ? 'feat' : 'feature',
      }),
    });
  }

  // ── Сборка строк списка ─────────────────────────────────────────────────

  /**
   * Значок записи: он говорит, чем запись занята в бою. Пассивной особенности
   * достаётся звезда — бросать у неё нечего.
   *
   * @param action - запись существа
   * @returns имя значка
   */
  function getActionIcon(action: CreatureAction): string {
    if (props.mode === 'trait') {
      return CREATURE_ROW_ICONS.trait;
    }

    if (action.areaOfEffect) {
      return CREATURE_ROW_ICONS.area;
    }

    if (actionHasSave(action)) {
      return CREATURE_ROW_ICONS.save;
    }

    if (action.attackBonus !== undefined) {
      return CREATURE_ROW_ICONS.attack;
    }

    return CREATURE_ROW_ICONS.plain;
  }

  /**
   * Подпись под названием: вид дальности и досягаемость либо область. Собрана
   * так же, как подпись предмета на листе персонажа, — категория и вид записи.
   *
   * @param action - запись существа
   * @returns подпись вида «Ближний бой, досягаемость 10 фт.»
   */
  function getActionSubtitle(action: CreatureAction): string {
    const unit = DISTANCE_UNIT_SHORT[action.distanceUnit ?? 'ft'];

    if (action.areaOfEffect) {
      const shape =
        AREA_SHAPE_LABELS[action.areaOfEffect.shape]
        ?? action.areaOfEffect.shape;

      return `${shape} ${action.areaOfEffect.size} ${unit}`;
    }

    if (!action.rangeType) {
      return '';
    }

    const kind = CREATURE_RANGE_TYPE_LABELS[action.rangeType];

    if (action.rangeType === 'ranged') {
      if (!action.range) {
        return kind;
      }

      const long = action.range.long ? `/${action.range.long}` : '';

      return `${kind}, ${action.range.normal}${long} ${unit}`;
    }

    return `${kind}, досягаемость ${action.reach ?? DEFAULT_REACH_FEET} ${unit}`;
  }

  /**
   * Плитки параметров строки: боевой параметр записи (бонус атаки либо
   * спасбросок цели), затем урон. Порядок тот же, что и у оружия на листе.
   *
   * @param action - запись существа
   * @returns плитки в порядке показа
   */
  function getActionStats(action: CreatureAction): SheetRowStat[] {
    const stats: SheetRowStat[] = [];
    const rollable = canUseAction(action);

    if (actionHasSave(action) && action.saveType) {
      stats.push({
        key: 'save',
        label: CREATURE_ROW_STAT_LABELS.save,
        value:
          `${ABILITY_SHORT_LABELS[action.saveType] ?? ''} ${action.saveDC ?? '?'}`.trim(),
        tooltip: `${CREATURE_ROW_STAT_HINTS.save}: ${SAVE_TYPE_LABELS[action.saveType]}`,
        accent: true,
        rollable,
      });
    } else if (action.attackBonus !== undefined) {
      stats.push({
        key: 'attack',
        label: CREATURE_ROW_STAT_LABELS.attack,
        value: formatSignedNumber(action.attackBonus),
        tooltip: CREATURE_ROW_STAT_HINTS.attack,
        accent: true,
        rollable,
      });
    }

    const damage = actionDamageSummary(action);

    if (damage) {
      stats.push({
        key: 'damage',
        label: CREATURE_ROW_STAT_LABELS.damage,
        value: damage.formula,
        tooltip: damage.typeLabel,
        accent: true,
        rollable,
      });
    }

    return stats;
  }

  /**
   * Пункты меню строки. Меню одно на правую кнопку мыши и на «⋮» в конце
   * строки: два набора действий у одной строки расходились бы.
   *
   * Группы разделяются чертой: сверху игровое действие записью, ниже —
   * действия над самой записью, последним — удаление.
   *
   * @param action - запись существа
   * @param index - место записи в списке
   * @returns группы пунктов для `UContextMenu` и `UDropdownMenu`
   */
  function getActionMenuItems(
    action: CreatureAction,
    index: number,
  ): DropdownMenuItem[][] {
    const groups: DropdownMenuItem[][] = [];

    if (canUseAction(action)) {
      groups.push([
        {
          label: actionHasSave(action)
            ? CREATURE_ACTION_MENU_LABELS.use
            : CREATURE_ACTION_MENU_LABELS.attack,
          icon: 'tabler:swords',
          onSelect: () => openRollModal(action),
        },
      ]);
    }

    const sheetActions: DropdownMenuItem[] = [];

    if (!props.isReadOnly) {
      sheetActions.push({
        label: SHEET_ROW_MENU_LABELS.edit,
        icon: 'tabler:edit',
        onSelect: () => openEditForm(index),
      });
    }

    sheetActions.push({
      label: SHEET_ROW_MENU_LABELS.share,
      icon: 'tabler:message-share',
      onSelect: () => shareActionToChat(action),
    });

    groups.push(sheetActions);

    if (!props.isReadOnly) {
      groups.push([
        {
          label: SHEET_ROW_MENU_LABELS.remove,
          icon: 'tabler:trash',
          color: 'error',
          onSelect: () => removeAction(index),
        },
      ]);
    }

    return groups;
  }

  /** Отбор по названию идёт: список сужен рядом отбора вкладки */
  const isSearching = computed(() => props.search.trim() !== '');

  /**
   * Строки списка, уже собранные для показа. Место записи в исходном массиве
   * остаётся при строке: по нему идут правка и удаление, и поиск его не сдвигает.
   *
   * Собираются вычислимым, а не вызовами из шаблона: подписи и плитки зависят
   * от справочников мира, и из шаблона они шли бы на каждую перерисовку.
   */
  const actionRows = computed(() => {
    const query = props.search.trim().toLowerCase();

    return props.actions
      .map((action, index) => ({ action, index }))
      .filter(
        ({ action }) =>
          !query
          || action.name.toLowerCase().includes(query)
          || (action.nameEn ?? '').toLowerCase().includes(query),
      )
      .map(({ action, index }) => ({
        key: `${index}-${action.name}`,
        action,
        index,
        icon: getActionIcon(action),
        subtitle: getActionSubtitle(action),
        stats: getActionStats(action),
        menuItems: getActionMenuItems(action, index),
        canUse: canUseAction(action),
        canDrag: !props.isEditMode && !!props.creatureId,
      }));
  });

  /**
   * Раздел на виду. Под поиском пустой раздел уезжает целиком: заголовок без
   * единой строки только сбивал бы с толку. Без поиска в режиме правки он
   * остаётся — иначе в пустой раздел нечем было бы добавить запись.
   */
  const isVisible = computed(
    () =>
      actionRows.value.length > 0 || (props.isEditMode && !isSearching.value),
  );

  /**
   * Промежуток между строками: карточки действий стоят просторнее плашек
   * особенностей — ровно как снаряжение и особенности на листе персонажа.
   */
  const listClass = computed(() =>
    props.mode === 'trait' ? 'flex flex-col gap-1' : 'flex flex-col gap-2',
  );

  // Кнопка «Добавить» вкладки особенностей стоит в общем ряду отбора, а форма
  // записи живёт здесь — открывать её оттуда больше нечем
  defineExpose({ openCreateForm });
</script>

<template>
  <div
    v-if="isVisible"
    class="flex flex-col"
  >
    <!-- Заголовок раздела — тот же разделитель, что и у групп снаряжения на
      листе персонажа. Кнопка «Добавить» стоит в его правом краю: ряд отбора
      один на вкладку, а разделов на ней несколько. У раздела без названия вне
      правки листа строка пустая — её не рисуем вовсе -->
    <div
      v-if="showHeader && (title || (isEditMode && !isReadOnly))"
      class="mb-1 flex min-h-7 items-center justify-between gap-2"
    >
      <div class="flex items-center gap-1.5">
        <h4
          v-if="title"
          class="text-xs font-semibold tracking-wider text-muted uppercase"
        >
          {{ title }}
        </h4>

        <!-- Счётчик легендарных действий -->
        <template v-if="legendaryCount !== undefined">
          <span class="text-xs text-dimmed">({{ legendaryCount }}/раунд)</span>

          <input
            v-if="isEditMode"
            :value="legendaryCount"
            type="number"
            min="0"
            max="5"
            class="ml-1 w-10 border-b border-muted bg-transparent text-center text-xs text-highlighted outline-none focus:border-primary"
            @input="handleLegendaryCountInput"
          />
        </template>
      </div>

      <UButton
        v-if="isEditMode && !isReadOnly"
        icon="tabler:plus"
        color="primary"
        variant="soft"
        :size="FILTER_ROW_CONTROL_SIZE"
        @click.left.exact.prevent="openCreateForm"
      >
        {{ CREATURE_ACTION_MENU_LABELS.add }}
      </UButton>
    </div>

    <!-- Список записей. У особенности боевых чисел нет — ей достаётся плашка
      вместо карточки, как и особенностям листа персонажа -->
    <div :class="listClass">
      <template
        v-for="row in actionRows"
        :key="row.key"
      >
        <CreatureTraitRow
          v-if="mode === 'trait'"
          :action="row.action"
          :menu-items="row.menuItems"
          :is-edit-mode="isEditMode"
          :is-read-only="isReadOnly"
          @open="openDetailModal(row.action)"
          @edit="openEditForm(row.index)"
          @delete="removeAction(row.index)"
        />

        <CreatureActionRow
          v-else
          :action="row.action"
          :icon="row.icon"
          :subtitle="row.subtitle"
          :stats="row.stats"
          :menu-items="row.menuItems"
          :can-use="row.canUse"
          :can-drag="row.canDrag"
          @open="handleActionClick(row.action, row.index)"
          @use="openRollModal(row.action)"
          @dragstart="handleDragStart($event, row.action)"
        />
      </template>
    </div>

    <!-- Модалка создания/редактирования -->
    <CreatureActionFormModal
      v-model:open="isFormOpen"
      :action="editingAction"
      :mode="mode"
      :index="editingIndex"
      @save="handleActionSave"
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
      :roll-button-text="rollConfig.rollButtonText"
      :damage-parts="rollConfig.damageParts"
      :evaluate-bonus-damage-parts="rollConfig.evaluateBonusDamageParts"
      :on-roll-parts="rollConfig.onRollParts"
      :on-hit="rollConfig.onHit"
    />

    <!-- Модалка просмотра действия -->
    <CreatureActionDetailModal
      v-model:open="isDetailOpen"
      :action="detailAction ?? null"
      :mode="mode"
      :show-attack-button="canAttackFromDetail"
      @attack="handleDetailAttack"
    />
  </div>
</template>
