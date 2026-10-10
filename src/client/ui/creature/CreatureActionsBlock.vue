<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type {
    CreatureAction,
    CreatureActionSectionKey,
    DnDCreature,
  } from '@vtt/shared/system/dnd.js';

  import type { SheetRowStat } from '../actor/sheetRowTypes';

  import { computed, ref } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { useChatStore } from '@/stores/chatStore';
  import { useWorldStore } from '@/stores/worldStore';
  import { DISTANCE_UNIT_SHORT } from '@vtt/shared';
  import {
    AREA_SHAPE_LABELS,
    creatureActionHasSave,
    DEFAULT_REACH_FEET,
    describeCreatureDamageCondition,
    findCreatureActionBlock,
    getActionDescriptionMarkdown,
    hasCreatureActionRoll,
    isDndCreature,
    listCreatureDamageAlternatives,
    listSourceDamageTypeChoices,
    readAlternativeShownParts,
    resolveEntityActionBlocks,
    SAVE_TYPE_LABELS,
  } from '@vtt/shared/system/dnd.js';

  import { refuseAction } from '../../composables/actionRefusal';
  import { startCreatureAction } from '../../composables/creatureActionRoll';
  import {
    formatDamagePartsText,
    summarizeDamageParts,
  } from '../../composables/creatureDamageChoice';
  import {
    formatDamageBonusLines,
    formatDamageTileFormula,
    resolveDamageStatIcon,
  } from '../../composables/damageTypeChoice';
  import { hasActionSelfEffects } from '../../composables/effectActivationUse';
  import { isEntityOwnTurn } from '../../composables/encounterTurn';
  import { listAmbientEffects } from '../../composables/useResolvedStats';
  import { useSystemDataStore } from '../../stores/systemDataStore';
  import {
    ABILITY_SHORT_LABELS,
    DAMAGE_VARIANTS_STAT_ICON,
    FILTER_ROW_CONTROL_SIZE,
    MODAL_BUTTON_LABELS,
    SHEET_ROW_MENU_LABELS,
  } from '../actor/constants';
  import {
    formatAttackRange,
    formatMeleeOrRangedDistances,
  } from '../actor/utils/formatAttackDistances';
  import { formatSignedNumber } from '../actor/utils/formatSignedNumber';
  import {
    CREATURE_ACTION_MENU_LABELS,
    CREATURE_ACTIONS_BLOCK_LABELS,
    CREATURE_DAMAGE_CHOICE_LABELS,
    CREATURE_ICON,
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
    /**
     * Преамбула раздела из статблока: когда и как существо тратит эти
     * действия. Одного их числа для этого мало — условия у существ разные.
     */
    sectionDescription?: string;
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
    /**
     * Раздел статблока: по нему видно, чем существо платит за запись, —
     * реакции гаснут под «Электрошоком». Нет — трата хода не проверяется
     * (особенности)
     */
    section?: CreatureActionSectionKey;
  }

  const props = withDefaults(defineProps<Props>(), {
    title: undefined,
    legendaryCount: undefined,
    sectionDescription: '',
    mode: 'action',
    isReadOnly: false,
    creatureId: undefined,
    creatureName: undefined,
    search: '',
    showHeader: true,
    section: undefined,
  });

  const emit = defineEmits<{
    'update': [actions: CreatureAction[]];
    'update:legendaryCount': [count: number];
  }>();

  /** Запреты существа — одним расчётом на весь раздел; `null` — раздела нет */
  const actionBlocks = computed(() => {
    const creature = props.section ? getCreatureEntity() : null;

    return creature
      ? resolveEntityActionBlocks(creature, listAmbientEffects(creature.id))
      : null;
  });

  /** Идёт ли ход существа: вне своего хода атака из «Действий» — реакция */
  const isOwnTurn = computed(
    () => props.creatureId === undefined || isEntityOwnTurn(props.creatureId),
  );

  /**
   * Почему запись раздела сейчас не совершить: запрет траты либо вторая
   * атака действием под «одной атакой за ход».
   *
   * @param action - запись статблока
   * @returns причина словами либо `null`, если действие доступно
   */
  function blockOf(action: CreatureAction): string | null {
    const { section } = props;

    return section && actionBlocks.value
      ? findCreatureActionBlock(
          actionBlocks.value,
          section,
          action,
          isOwnTurn.value,
        )
      : null;
  }

  const systemDataStore = useSystemDataStore();
  const chatStore = useChatStore();
  const worldStore = useWorldStore();

  /**
   * Счётчик легендарных действий за раунд: «3/раунд». Хвост встаёт сразу за
   * числом, поэтому запись собирается строкой, а не шаблоном: подстановки
   * подряд форматтер вправе разорвать переносом, и Vue развёл бы их пробелом.
   */
  const legendaryPerRound = computed(
    () =>
      `${props.legendaryCount}${CREATURE_ACTIONS_BLOCK_LABELS.legendaryPerRoundSuffix}`,
  );

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
   * Единая со заклинаниями/оружием система damageParts. Плитка всегда
   * компактна — в ней формула урона, который бросается всегда. Добавки по
   * условию («+1к8, если атакующий окровавлен») и варианты (урон «или», тип на
   * выбор) в плитку не пишутся: их может быть сколько угодно. О них говорит
   * значок, а сами они — в подсказке отдельными строками. Так строка выглядит
   * одинаково, как бы ни был записан урон.
   *
   * @param action - действие существа
   * @returns формула плитки, строки подсказки и значок; null — нет частей урона
   */
  function actionDamageSummary(
    action: CreatureAction,
  ): { formula: string; tooltip: string; icon?: string } | null {
    const base = summarizeDamageParts(
      action.damageParts ?? [],
      getDamageTypeLabel,
    );

    const bonusLines = formatDamageBonusLines(base?.conditionalFormulas ?? []);

    const alternatives = listCreatureDamageAlternatives(action);

    if (alternatives.length === 0) {
      return base
        ? {
            formula: formatDamageTileFormula(base.baseFormula),
            tooltip: [base.typeLabel, ...bonusLines]
              .filter((line) => line.length > 0)
              .join(CREATURE_DAMAGE_CHOICE_LABELS.hintSeparator),
            icon: resolveDamageStatIcon(
              listSourceDamageTypeChoices(action).length > 0,
              bonusLines.length > 0,
            ),
          }
        : null;
    }

    const hints = alternatives.map(
      (alternative) =>
        `${CREATURE_DAMAGE_CHOICE_LABELS.orPrefix}${formatDamagePartsText(
          readAlternativeShownParts(alternative),
          getDamageTypeLabel,
        )}${CREATURE_DAMAGE_CHOICE_LABELS.hintSeparator}${describeCreatureDamageCondition(
          alternative,
        )}`,
    );

    return {
      formula: base
        ? formatDamageTileFormula(base.baseFormula)
        : CREATURE_DAMAGE_CHOICE_LABELS.noDamage,
      tooltip: [base?.typeLabel ?? '', ...bonusLines, ...hints]
        .filter((line) => line.length > 0)
        .join(CREATURE_DAMAGE_CHOICE_LABELS.hintSeparator),
      icon: DAMAGE_VARIANTS_STAT_ICON,
    };
  }

  // ── Броски урона ────────────────────────────────────────────────────────

  /** Существо-источник действий (для запретов трат хода) */
  function getCreatureEntity(): DnDCreature | null {
    if (!props.creatureId) {
      return null;
    }

    const worldId = worldStore.connectionState.currentWorldId;
    const world = worldStore.worlds.find((entry) => entry.id === worldId);

    // Стор хоста хранит сущности в нейтральной форме — D&D-форму подтверждает
    // гвард, как и везде на границе с хостом.
    const found = world?.creatures?.find(
      (entry) => entry.id === props.creatureId,
    );

    return found && isDndCreature(found) ? found : null;
  }

  /**
   * Совершает действие — общим путём действия существа, тем же, что у
   * горячей панели: отказ — уведомлением, запись без броска и эффектов —
   * карточкой в чат.
   *
   * @param sourceAction - действие существа; эффекты — до выбора варианта
   */
  function openRollModal(sourceAction: CreatureAction): void {
    if (!props.creatureId) {
      return;
    }

    startCreatureAction(sourceAction, {
      creatureId: props.creatureId,
      section: props.section,
      refuse: refuseAction,
      announce: shareActionToChat,
    });
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
   * Можно ли совершить запись прямо из строки: не компендиум, известно
   * существо-источник, и есть что делать — бросок, эффекты на себя или трата
   * хода раздела статблока. Последнее даёт кнопку и записи без броска
   * («Ловкий побег»): иначе её бонусное действие не отметить, и «Замедление»
   * пропустило бы после неё удар.
   *
   * @param action - действие существа
   * @returns `true`, если запись можно совершить
   */
  function canUseAction(action: CreatureAction): boolean {
    return (
      !props.isReadOnly
      && !!props.creatureId
      && (hasCreatureActionRoll(action)
        || hasActionSelfEffects(action)
        || props.section !== undefined)
    );
  }

  /**
   * Подпись применения записи: «Атаковать» — только у атаки; спасбросок и
   * запись без броска «Используют».
   *
   * @param action - действие существа
   * @returns подпись кнопки или пункта меню
   */
  function getUseLabel(action: CreatureAction): string {
    return hasCreatureActionRoll(action) && !creatureActionHasSave(action)
      ? CREATURE_ACTION_MENU_LABELS.attack
      : CREATURE_ACTION_MENU_LABELS.use;
  }

  /** Показывать ли кнопку «Атаковать» в модалке просмотра действия */
  const canAttackFromDetail = computed(
    () => !!detailAction.value && canUseAction(detailAction.value),
  );

  /** Подпись кнопки применения в модалке просмотра */
  const detailUseLabel = computed(() =>
    detailAction.value ? getUseLabel(detailAction.value) : undefined,
  );

  /**
   * Обрабатывает ввод количества легендарных действий
   * @param event - событие ввода
   */
  function handleLegendaryCountInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    emit('update:legendaryCount', Number(event.target.value));
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
      icon: CREATURE_ICON,
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

    if (creatureActionHasSave(action)) {
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
   * @returns подпись вида «Ближний бой, досягаемость 10 фт.» или
   *   «Рукопашная или дальнобойная, 5 фт. / 30/120 фт.»
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

    if (action.rangeType === 'meleeOrRanged') {
      return `${kind}, ${formatMeleeOrRangedDistances({
        reach: action.reach ?? DEFAULT_REACH_FEET,
        range: action.range,
        unitLabel: unit,
      })}`;
    }

    if (action.rangeType === 'ranged') {
      if (!action.range) {
        return kind;
      }

      return `${kind}, ${formatAttackRange(action.range, unit)}`;
    }

    return `${kind}${CREATURE_ACTIONS_BLOCK_LABELS.reachPrefix}${action.reach ?? DEFAULT_REACH_FEET} ${unit}`;
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

    if (creatureActionHasSave(action) && action.saveType) {
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
        tooltip: damage.tooltip,
        accent: true,
        rollable,
        icon: damage.icon,
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
          label: getUseLabel(action),
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
        blockedReason: blockOf(action),
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
          <span class="text-xs text-dimmed">({{ legendaryPerRound }})</span>

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
        {{ MODAL_BUTTON_LABELS.add }}
      </UButton>
    </div>

    <!-- Преамбула раздела: стоит под заголовком, а не в первой записи, —
      она объясняет весь раздел, а не одно действие -->
    <ItemDescriptionRenderer
      v-if="sectionDescription"
      :content="sectionDescription"
      class="mb-2 text-xs wrap-break-word text-dimmed"
    />

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
          :blocked-reason="row.blockedReason"
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

    <!-- Модалка просмотра действия -->
    <CreatureActionDetailModal
      v-model:open="isDetailOpen"
      :action="detailAction ?? null"
      :mode="mode"
      :show-attack-button="canAttackFromDetail"
      :attack-button-label="detailUseLabel"
      @attack="handleDetailAttack"
    />
  </div>
</template>
