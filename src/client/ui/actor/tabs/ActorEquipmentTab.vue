<script setup lang="ts">
  // Корневой вход `@nuxt/ui` — это Nuxt-модуль, типы компонентов он не отдаёт
  import type { DropdownMenuItem } from '@nuxt/ui/components/DropdownMenu.vue';

  import type {
    AttackRollMode,
    DnDCarryingCapacity,
    DnDCurrency,
    DnDGameItem,
    DnDSceneEntity,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import type { ItemTransferPayload } from '../../../composables/useItemTransfer';
  import type {
    RolledSpellDamagePart,
    SpellDamagePartInput,
  } from '../../../composables/useSpellResolution';
  import type { SheetRowStat } from '../sheetRowTypes';

  import { computed, ref, toRef } from 'vue';

  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useChatStore } from '@/stores/chatStore';
  import { useHotbarStore } from '@/stores/hotbarStore';
  import { useTargetStore } from '@/stores/targetStore';
  import { useWorldStore } from '@/stores/worldStore';
  import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
  import { formatItemCost } from '@vtt/shared';
  import {
    buildFormulaContext,
    calculateWeaponAttackModifier,
    calculateWeaponDamageModifier,
    canSpendItemUses,
    CURRENCY_OPTIONS,
    DEFAULT_CREATURE_SIZE,
    describeDamagePart,
    describeWeaponAttack,
    describeWeaponDamage,
    evaluateConditionalBonuses,
    formatWeaponDamageFormula,
    getWeaponPrimaryDamageType,
    isDndSceneEntity,
    resolveActorStats,
    setItemUsesCurrent,
    spendItemUses,
    TOOL_CATEGORIES,
  } from '@vtt/shared/system/dnd.js';

  import { useBonusDamageParts } from '../../../composables/useBonusDamageParts';
  import { useCarryingCapacity } from '../../../composables/useCarryingCapacity';
  import { useResolvedStats } from '../../../composables/useResolvedStats';
  import { useSpellResolution } from '../../../composables/useSpellResolution';
  import { useWeaponIcon } from '../../../composables/useWeaponIcon';
  import { useWorldEntities } from '../../../composables/useWorldEntities';
  import ActorEquipmentRow from '../ActorEquipmentRow.vue';
  import CarryingCapacityModal from '../CarryingCapacityModal.vue';
  import {
    ACTOR_EQUIPMENT_TAB_LABELS,
    EQUIPMENT_EQUIP_ACTION_LABELS,
    EQUIPMENT_MENU_LABELS,
    EQUIPMENT_STAT_HINTS,
    EQUIPMENT_STAT_LABELS,
    GAME_ITEM_TRANSFER_MIME,
    SHEET_ROW_MENU_LABELS,
    WEAPON_RANGE_TYPE_LABELS,
    WEIGHT_UNIT_LABEL,
  } from '../constants';
  import CurrencyModal from '../CurrencyModal.vue';
  import DiceRollModal from '../DiceRollModal.vue';
  import SheetStatTile from '../SheetStatTile.vue';
  import { extractSpellFromGameItem } from '../utils/extractSpellFromGameItem';
  import { formatSignedNumber } from '../utils/formatSignedNumber';
  import { formatWeaponModifierParts } from '../utils/formatWeaponModifierParts';

  const props = defineProps<Props>();

  const { resolvedStats, combinedEffects } = useResolvedStats(
    toRef(() => props.entity),
  );

  /** Переносимый вес: сумма веса инвентаря и грузоподъёмность листа */
  const { weightLabel, isOverweight, capacitySettings, strength } =
    useCarryingCapacity(
      toRef(() => props.entity),
      resolvedStats,
    );

  // События точечные, а не одно «вот тебе кусок листа»: у актёра и существа
  // разные `system`, и общий тип обновления схлопнулся бы до полей, которые
  // есть у обоих. Панель отдаёт только то, что сама поменяла, а куда это
  // положить — знает хозяин листа
  const emit = defineEmits<{
    'update:equipment': [equipment: DnDGameItem[]];
    'update:currency': [currency: DnDCurrency];
    'update:carrying-capacity': [capacity: DnDCarryingCapacity];
    'immediate-save': [];
  }>();

  interface Props {
    /**
     * Лист-владелец инвентаря. И персонаж, и существо: механика снаряжения у
     * них общая — бросок атаки, урон и вес считаются одним кодом.
     */
    entity: DnDSceneEntity;
    isEditMode: boolean;
    isDragOver?: boolean;
    /** Показывать кошелёк. Есть у обоих листов, но не везде уместен */
    showCurrency?: boolean;
    /** Показывать плитку переносимого веса и её настройку */
    showCarryingCapacity?: boolean;
    /**
     * Разрешать перетаскивание оружия на панель быстрого доступа. У существа
     * выключено: макрос атаки ищет владельца среди актёров, и кнопка вышла бы
     * мёртвой — это хуже, чем её отсутствие
     */
    allowHotbarDrag?: boolean;
    /**
     * Лист только для чтения: инвентарь показывается, но не правится. Так лист
     * существа закрывает мешок чужого монстра от игрока без контроля над ним —
     * у листа персонажа для этого своя проверка владельца выше по дереву
     */
    isReadOnly?: boolean;
  }

  /**
   * Инвентарь листа. Читается со страховкой: у существа поле необязательное, а
   * в быстром окне лист приезжает из стора хоста без нормализации
   */
  const inventory = computed<DnDGameItem[]>(() => props.entity.equipment ?? []);

  /**
   * Запрашивает у хозяина вкладки немедленное сохранение актёра — только вне
   * режима редактирования. В режиме редактирования изменения копятся в
   * локальной копии до «Сохранить»: немедленный push рассинхронизировал бы
   * снапшот отката (последующая «Отмена» затирала бы уже сохранённое).
   */
  function triggerSaveIfNotEdit(): void {
    if (!props.isEditMode) {
      emit('immediate-save');
    }
  }

  /**
   * Отдаёт новый инвентарь хозяину листа и просит сохранить.
   *
   * Единственный выход правки наружу — поэтому здесь же стоит и проверка режима
   * только для чтения: разложи её по девяти операциям, и следующая десятая
   * приехала бы без неё.
   *
   * @param equipment - новый инвентарь листа
   */
  function commitEquipment(equipment: DnDGameItem[]): void {
    if (props.isReadOnly) {
      return;
    }

    emit('update:equipment', equipment);

    triggerSaveIfNotEdit();
  }

  const { getWeaponIcon } = useWeaponIcon();

  const systemDataStore = useSystemDataStore();
  const hotbarStore = useHotbarStore();
  const targetStore = useTargetStore();
  const chatStore = useChatStore();
  const worldStore = useWorldStore();

  const { resolveSpellDamageWithParts } = useSpellResolution();

  const { buildWeaponRollSetup, buildTargetHpContext } = useBonusDamageParts();

  const { getCurrentWorldEntities } = useWorldEntities();

  /**
   * Карта key → name для локализации типов урона
   */
  const damageTypeMap = computed(() => {
    const map = new Map<string, string>();

    for (const dt of systemDataStore.damageTypes) {
      map.set(dt.key, dt.name);
    }

    return map;
  });

  /**
   * Карта key → name для локализации категорий доспехов
   */
  const armorCategoryMap = computed(() => {
    const map = new Map<string, string>();

    for (const cat of systemDataStore.armorCategories) {
      map.set(cat.key, cat.name);
    }

    return map;
  });

  /**
   * Карта key → name для категорий инструментов
   */
  const toolCategoryMap = computed(() => {
    const map = new Map<string, string>();

    for (const [key, name] of Object.entries(TOOL_CATEGORIES)) {
      map.set(key, name);
    }

    return map;
  });

  /** Лейблы категорий оружия */
  const WEAPON_CATEGORY_LABELS: Record<string, string> = {
    simple: ACTOR_EQUIPMENT_TAB_LABELS.weaponsSimple,
    martial: ACTOR_EQUIPMENT_TAB_LABELS.weaponsMartial,
  };

  /**
   * Получает лейбл категории оружия по baseType (через weaponBaseTypes)
   * @param baseType - ключ базового типа оружия
   */
  function getWeaponCategoryLabel(baseType: string | undefined): string {
    if (!baseType) {
      return '';
    }

    const found = systemDataStore.weaponBaseTypes.find(
      (bt) => bt.key === baseType,
    );

    return found ? (WEAPON_CATEGORY_LABELS[found.category] ?? '') : '';
  }

  /** Конфигурация групп предметов для разделителей */
  const EQUIPMENT_GROUP_ORDER = [
    { type: 'weapon', label: ACTOR_EQUIPMENT_TAB_LABELS.sectionWeapons },
    { type: 'equipment', label: ACTOR_EQUIPMENT_TAB_LABELS.sectionEquipment },
    { type: 'tool', label: ACTOR_EQUIPMENT_TAB_LABELS.sectionTools },
  ];

  /**
   * Группировка предметов по типу:
   * Оружие, Доспехи, Прочее
   */
  const equipmentGroups = computed(() => {
    const groups: Array<{ label: string; items: DnDGameItem[] }> = [];

    for (const group of EQUIPMENT_GROUP_ORDER) {
      const items = inventory.value.filter((item) => item.type === group.type);

      if (items.length > 0) {
        groups.push({ label: group.label, items });
      }
    }

    // Прочее — всё, что не weapon и не armor
    const knownTypes = new Set(
      EQUIPMENT_GROUP_ORDER.map((group) => group.type),
    );

    const otherItems = inventory.value.filter(
      (item) => !knownTypes.has(item.type),
    );

    if (otherItems.length > 0) {
      groups.push({
        label: ACTOR_EQUIPMENT_TAB_LABELS.sectionOther,
        items: otherItems,
      });
    }

    return groups;
  });

  /** Категории, являющиеся настоящей бронёй (нельзя носить 2 одновременно) */
  const ARMOR_CATEGORIES = new Set(['light', 'medium', 'heavy']);

  /**
   * Есть ли уже экипированная броня (не щит).
   * По правилам D&D можно носить только один доспех.
   */
  const equippedArmorId = computed(() => {
    const found = inventory.value.find(
      (item) =>
        item.type === 'equipment'
        && item.equipped
        && ARMOR_CATEGORIES.has(item.equipmentCategory ?? ''),
    );

    return found?.id ?? null;
  });

  /**
   * Проверяет, заблокирована ли кнопка экипировки для предмета.
   * Блокирует экипировку второй брони (не щита), если одна уже надета.
   *
   * @param item - предмет для проверки
   * @returns true если кнопка должна быть заблокирована
   */
  function isEquipDisabled(item: DnDGameItem): boolean {
    // Если предмет уже экипирован — всегда можно снять
    if (item.equipped) {
      return false;
    }

    // Блокировка только для настоящей брони (light/medium/heavy)
    if (
      item.type !== 'equipment'
      || !ARMOR_CATEGORIES.has(item.equipmentCategory ?? '')
    ) {
      return false;
    }

    // Блокируем, если уже есть экипированная броня
    return equippedArmorId.value !== null;
  }

  // --- Бросок урона (через DiceRollModal) ---
  const isRollModalOpen = ref(false);

  /** Контекст броска, известный на момент подстановки бонусов */
  interface RollBonusContext {
    hasAdvantage: boolean;
    hasDisadvantage: boolean;
  }

  /** Настройки окна броска: заполняются перед каждым открытием */
  interface RollConfig {
    name: string;
    formula: string;
    attackModifier?: number;
    evaluateBonuses?: (context: RollBonusContext) => {
      attackBonus: number;
      damageBonus: number;
    };
    initialRollMode: AttackRollMode;
    incomingAttackType?: 'melee' | 'ranged' | 'spell';
    damageType?: string;
    /** Многочастный путь (бонус-части урона от Active Effects) */
    damageParts?: SpellDamagePartInput[];
    evaluateBonusDamageParts?: (
      context: RollBonusContext,
    ) => SpellDamagePartInput[];
    onRollParts?: (parts: RolledSpellDamagePart[]) => void;
    onHit?: () => void;
  }

  const rollConfig = ref<RollConfig>({
    name: '',
    formula: '',
    initialRollMode: 'normal',
  });

  /**
   * Открывает модалку броска урона для оружия
   * @param weapon - оружие с формулой урона
   */
  function openRollModal(weapon: DnDGameItem): void {
    if (!weapon.damageParts?.length) {
      return;
    }

    // Оружие со спасброском: цель кидает спас, броска попадания нет.
    const hasSave = !!weapon.saveType && weapon.saveType !== 'none';

    const baseMod = calculateWeaponAttackModifier(
      props.entity,
      weapon,
      resolvedStats.value,
    );

    const weaponSaveDC = 8 + baseMod;

    const evaluateBonuses = (context: {
      hasAdvantage: boolean;
      hasDisadvantage: boolean;
    }) => {
      const attackKey =
        weapon.rangeType === 'ranged' ? 'attack.ranged' : 'attack.melee';

      const damageKey =
        weapon.rangeType === 'ranged' ? 'damage.ranged' : 'damage.melee';

      // HP цели читается в момент броска — для условий target.hp.* («Убийца»)
      const rollContext = { ...context, target: buildTargetHpContext() };

      // Условный бонус может быть формулой (`@prof`, `@mod.dex`) — без
      // контекста @-переменных она дала бы ноль
      const formulaContext = buildFormulaContext(props.entity);

      return {
        attackBonus: evaluateConditionalBonuses(
          combinedEffects.value,
          attackKey,
          rollContext,
          formulaContext,
        ),
        damageBonus: evaluateConditionalBonuses(
          combinedEffects.value,
          damageKey,
          rollContext,
          formulaContext,
        ),
      };
    };

    const targetActor = targetStore.getTargetActor();

    let targetFlags = new Set<string>();

    // Стор целей хоста отдаёт нейтральную сущность — D&D-форму подтверждает
    // гвард, как и в остальных резолверах бросков
    if (targetActor && isDndSceneEntity(targetActor)) {
      targetFlags = resolveActorStats(targetActor).activeFlags;
    }

    const isAdvantage =
      resolvedStats.value?.activeFlags.has('attack.advantage')
      || targetFlags.has('attacksAgainst.advantage');

    const isDisadvantage =
      resolvedStats.value?.activeFlags.has('attack.disadvantage')
      || targetFlags.has('attacksAgainst.disadvantage');

    let initialRollMode: AttackRollMode = 'normal';

    if (isAdvantage && !isDisadvantage) {
      initialRollMode = 'advantage';
    } else if (isDisadvantage && !isAdvantage) {
      initialRollMode = 'disadvantage';
    }

    // Единая со заклинаниями система урона: бросок ВСЕГДА идёт многочастным
    // путём (части урона оружия + бонус-части эффектов). Состояние HP цели —
    // для условных веток @target.full/@target.notFull.
    const targetHp = buildTargetHpContext();

    const targetIsFull = targetHp
      ? targetHp.currentHp >= targetHp.maxHp
      : undefined;

    const weaponPartsSetup = buildWeaponRollSetup({
      weapon,
      actor: props.entity,
      effects: combinedEffects.value,
      resolvedStats: resolvedStats.value,
      targetIsFull,
      targetType: targetHp?.creatureType,
    });

    rollConfig.value = {
      name: weapon.name,
      formula: weaponPartsSetup.baseParts[0]?.formula ?? '',
      attackModifier: hasSave ? undefined : baseMod,
      evaluateBonuses,
      initialRollMode,
      incomingAttackType: weapon.rangeType === 'ranged' ? 'ranged' : 'melee',
      damageType: getWeaponPrimaryDamageType(weapon),
      damageParts: weaponPartsSetup.baseParts,
      evaluateBonusDamageParts: weaponPartsSetup.evaluateBonusDamageParts,
      onRollParts: (parts: RolledSpellDamagePart[]) =>
        handleWeaponRollParts(
          weaponPartsSetup.pseudoSpell,
          parts,
          weaponSaveDC,
        ),
      // Сбрасываем явно: `rollConfig` переиспользуется между бросками, и без
      // этого обработчик от ПРЕДЫДУЩЕГО броска остался бы висеть на текущем.
      onHit: undefined,
    };

    isRollModalOpen.value = true;
  }

  /**
   * Применяет брошенные части урона оружия через многочастный оркестратор:
   * защиты по типу на каждую часть, per-target гейты @target.*, единый
   * HP-апдейт и одно сообщение в чат.
   *
   * @param pseudoSpell - псевдо-заклинание оружия (со спасбросском оружия, если есть)
   * @param parts - брошенные части урона
   * @param spellSaveDC - DC спасброска оружия (для оружия со спасброском)
   */
  function handleWeaponRollParts(
    pseudoSpell: Spell,
    parts: RolledSpellDamagePart[],
    spellSaveDC: number,
  ): void {
    const actors = getCurrentWorldEntities();
    const socket = chatStore.getSocket();

    if (actors.length === 0 || !socket) {
      return;
    }

    void resolveSpellDamageWithParts(
      {
        spell: pseudoSpell,
        damageTotal: 0,
        spellSaveDC,
        actors,
        socket,
        casterId: props.entity.id,
      },
      parts,
      { scene: worldStore.currentScene },
    );
  }

  /**
   * Обработчик dragstart для перетаскивания оружия на hotbar.
   * @param event - событие dragstart
   * @param weapon - оружие
   */
  function handleWeaponDragStart(event: DragEvent, weapon: DnDGameItem): void {
    if (!weapon.damageParts?.length || !props.allowHotbarDrag) {
      return;
    }

    const { iconName, svgContent } = getWeaponIcon(weapon.baseType);
    const hotbarIcon = svgContent ?? iconName ?? 'tabler:target-arrow';

    startHotbarDrag(event, {
      id: weapon.id,
      type: 'weapon-attack',
      label: `${ACTOR_EQUIPMENT_TAB_LABELS.attackRollPrefix}${weapon.name}`,
      icon: hotbarIcon,
      ref: weapon.id,
      actorId: props.entity.id,
    });
  }

  /**
   * Обработчик dragstart для передачи любого предмета между токенами через DnD на сцену.
   * Добавляет MIME `application/game-item-transfer` с данными предмета и ID актора.
   * @param event - событие dragstart
   * @param item - передаваемый предмет
   */
  function handleItemDragStart(event: DragEvent, item: DnDGameItem): void {
    // Из листа в режиме чтения и из листа в режиме правки предмет не вынимается:
    // у получателя он появится сразу, а здесь правка либо запрещена, либо ещё
    // не сохранена, и предмет бы размножился
    if (!event.dataTransfer || props.isReadOnly || props.isEditMode) {
      return;
    }

    // Для любого предмета — MIME передачи между листами и токенами. Нагрузка
    // собирается по объявленному типу, а не безымянным литералом: иначе
    // переименование поля не поймал бы никто, а перенос просто перестал бы
    // срабатывать — молча, без ошибки
    const payload: ItemTransferPayload = {
      item,
      sourceActorId: props.entity.id,
    };

    const transferPayload = JSON.stringify(payload);

    event.dataTransfer.setData(GAME_ITEM_TRANSFER_MIME, transferPayload);
    event.dataTransfer.effectAllowed = 'copyMove';

    // Для оружия с уроном — дополнительно hotbar drag
    if (item.type === 'weapon' && item.damageParts?.length) {
      handleWeaponDragStart(event, item);
    }
  }

  const { openModal, closeModal } = useModalManager();

  /**
   * Открывает модалку просмотра предмета через глобальный ModalContainer.
   * Модалки независимы от листа персонажа и остаются при его закрытии.
   * @param item - предмет снаряжения
   */
  function openDetailModal(item: DnDGameItem): void {
    if (item.type === 'equipment') {
      openModal('EquipmentDetailModal', { item, open: true });
    } else if (item.type === 'tool') {
      openModal('ToolDetailModal', { item, open: true });
    } else if (item.type === 'spell') {
      const spell = extractSpellFromGameItem(item);

      if (spell) {
        openModal('SpellDetailModal', { spell });
      }
    } else {
      openModal('WeaponDetailModal', { item, open: true, actor: props.entity });
    }
  }

  /**
   * Открывает модалку редактирования предмета в зависимости от типа
   * @param item - предмет снаряжения
   */
  function openEditModal(item: DnDGameItem): void {
    const modalMap: Record<string, string> = {
      equipment: 'EquipmentFormModal',
      tool: 'ToolFormModal',
      spell: 'SpellFormModal',
      weapon: 'WeaponFormModal',
    };

    const modalName = modalMap[item.type] ?? 'WeaponFormModal';
    const formId = `${modalName}-${item.id}`;

    if (item.type === 'spell') {
      openModal(modalName, {
        item,
        onSave: (updatedSpell: Spell) =>
          saveSpellEdit(updatedSpell, formId, item),
        onClose: () => closeModal(formId),
      });
    } else {
      openModal(modalName, {
        item,
        // Владелец нужен только форме оружия — для предпросмотра атаки и
        // урона. Остальным формам его не передаём: необъявленный проп осел бы
        // атрибутом на корне и дал ворнинг
        ...(item.type === 'weapon' ? { actor: props.entity } : {}),
        onSave: (updated: DnDGameItem) => saveEquipmentEdit(updated, formId),
        onClose: () => closeModal(formId),
      });
    }
  }

  /**
   * Сохраняет редактированный предмет (оружие, доспех, инструмент) в equipment.
   *
   * @param updatedItem - обновлённый предмет
   * @param formId - ID модалки для закрытия
   */
  function saveEquipmentEdit(updatedItem: DnDGameItem, formId: string): void {
    const equipment = inventory.value.map((item) =>
      item.id === updatedItem.id
        ? { ...updatedItem, equipped: item.equipped }
        : item,
    );

    commitEquipment(equipment);
    closeModal(formId);
  }

  /** Сохраняет редактированное заклинание-предмет в equipment */
  function saveSpellEdit(
    updatedSpell: Spell,
    formId: string,
    originalItem: DnDGameItem,
  ): void {
    const updatedSpellItem: DnDGameItem = {
      ...originalItem,
      name: updatedSpell.name,
      nameEn: updatedSpell.nameEn,
      description: updatedSpell.description,
      spellData: updatedSpell,
    };

    const equipment = inventory.value.map((item) =>
      item.id === originalItem.id ? updatedSpellItem : item,
    );

    commitEquipment(equipment);
    closeModal(formId);
  }

  // --- Действия ---

  // TODO: Подумать над правилами для больших (Large+) существ:
  // - Большие существа могут держать двуручное оружие одной рукой
  // - Влияние размера на урон (oversized weapons)
  // TODO: Вернуть блокировку экипировки при нехватке рук (canEquip / freeHands)

  /**
   * Переключает экипировку предмета.
   *
   * Хват универсального оружия снятие не трогает: это выбор игрока, как оружием
   * пользуются, а не состояние рук. Сбрасывая его, лист забывал бы двуручный
   * хват при каждом снятии — и после надевания урон молча падал бы до меньшей
   * кости.
   *
   * @param itemId - ID предмета
   */
  function toggleEquipped(itemId: string): void {
    const equipment = inventory.value.map((item) =>
      item.id === itemId ? { ...item, equipped: !item.equipped } : item,
    );

    commitEquipment(equipment);
  }

  /**
   * Переключает хват универсального оружия (одноручный ↔ двуручный).
   *
   * Хват — свойство самого оружия, а не рук: он остаётся выбранным и у снятого
   * оружия, и после следующего надевания. Поэтому пункт меню виден всегда, а
   * `toggleEquipped` его не трогает.
   *
   * @param itemId - ID предмета
   */
  function toggleTwoHandedGrip(itemId: string): void {
    const equipment = inventory.value.map((item) =>
      item.id === itemId
        ? { ...item, twoHandedGrip: !item.twoHandedGrip }
        : item,
    );

    commitEquipment(equipment);
  }

  /**
   * Обновляет количество предмета
   * @param itemId - ID предмета
   * @param newQuantity - новое количество (минимум 1)
   */
  function updateItemQuantity(itemId: string, newQuantity: number): void {
    const clampedQuantity = Math.max(1, Math.floor(newQuantity));

    const equipment = inventory.value.map((item) =>
      item.id === itemId ? { ...item, quantity: clampedQuantity } : item,
    );

    commitEquipment(equipment);
  }

  /**
   * Переключает настройку (attunement) предмета
   * @param itemId - ID предмета
   */
  function toggleAttuned(itemId: string): void {
    const equipment = inventory.value.map((item) =>
      item.id === itemId ? { ...item, isAttuned: !item.isAttuned } : item,
    );

    commitEquipment(equipment);
  }

  /**
   * Списывает заряд предмета — правило расхода живёт в движке
   * ({@link spendItemUses}), здесь только запись результата в лист.
   *
   * @param itemId - ID предмета
   */
  function spendItemCharge(itemId: string): void {
    const equipment = inventory.value.map((item) =>
      item.id === itemId ? spendItemUses(item) : item,
    );

    commitEquipment(equipment);
  }

  /**
   * Возвращает один заряд вручную — отмена ошибочной траты. Восстановление
   * отдыхом идёт своим путём, через движок отдыха.
   *
   * @param itemId - ID предмета
   */
  function restoreItemCharge(itemId: string): void {
    const equipment = inventory.value.map((item) =>
      item.id === itemId && item.uses
        ? setItemUsesCurrent(item, item.uses.current + 1)
        : item,
    );

    commitEquipment(equipment);
  }

  /**
   * Удаляет предмет из инвентаря
   * @param itemId - ID предмета
   */
  function removeItem(itemId: string): void {
    if (props.isReadOnly) {
      return;
    }

    const equipment = inventory.value.filter((item) => item.id !== itemId);

    commitEquipment(equipment);

    // Кнопка удалённого предмета на панели быстрого доступа снимается ТОЛЬКО
    // вместе с успешной правкой: иначе лист в режиме просмотра чистил бы чужой
    // хотбар, ничего при этом не удалив
    hotbarStore.removeByRef(itemId);
  }

  /** Типы записей, у которых на листе есть своя форма правки */
  const EDITABLE_ITEM_TYPES = new Set(['weapon', 'equipment', 'spell', 'tool']);

  /**
   * Пункты меню строки предмета. Меню одно на правую кнопку мыши и на «⋮» в
   * конце строки: два набора действий у одной строки расходились бы.
   *
   * Группы разделяются чертой: сверху игровые действия предметом, ниже —
   * действия над записью листа, последним — удаление.
   *
   * @param item - предмет снаряжения
   * @returns группы пунктов для `UContextMenu` и `UDropdownMenu`
   */
  function getItemMenuItems(item: DnDGameItem): DropdownMenuItem[][] {
    const gameActions: DropdownMenuItem[] = [];

    // Надевание стоит первым и повторяет кнопку со значком слева: по одному
    // значку не всякий поймёт, что предмет им и берут в руки. Значок —
    // человечек: надевают тут и оружие, и кольцо, а рубашка обещала одежду,
    // щит же — доспех.
    gameActions.push({
      label: item.equipped
        ? EQUIPMENT_EQUIP_ACTION_LABELS.unequip
        : EQUIPMENT_EQUIP_ACTION_LABELS.equip,
      icon: item.equipped ? 'tabler:user-off' : 'tabler:user-check',
      disabled: isEquipDisabled(item),
      onSelect: () => toggleEquipped(item.id),
    });

    if (item.type === 'weapon' && item.damageParts?.length) {
      gameActions.push({
        label: EQUIPMENT_MENU_LABELS.attack,
        icon: 'tabler:sword',
        onSelect: () => openRollModal(item),
      });
    }

    // Хват — не разовое действие, а способ пользоваться оружием: отметка в
    // меню показывает, каким хватом оружие идёт в бой сейчас.
    if (isVersatile(item)) {
      gameActions.push({
        label: EQUIPMENT_MENU_LABELS.twoHandedGrip,
        icon: 'tabler:hand-grab',
        type: 'checkbox',
        checked: Boolean(item.twoHandedGrip),
        onUpdateChecked: () => toggleTwoHandedGrip(item.id),
      });
    }

    if (item.magicAttunement && item.magicAttunement !== 'none') {
      gameActions.push({
        label: item.isAttuned
          ? EQUIPMENT_MENU_LABELS.unattune
          : EQUIPMENT_MENU_LABELS.attune,
        icon: 'tabler:sparkles',
        onSelect: () => toggleAttuned(item.id),
      });
    }

    if (item.uses) {
      gameActions.push({
        label: EQUIPMENT_MENU_LABELS.spendCharge,
        icon: 'tabler:battery-vertical-3',
        disabled: !canSpendItemUses(item),
        onSelect: () => spendItemCharge(item.id),
      });

      if (item.uses.current < item.uses.max) {
        gameActions.push({
          label: EQUIPMENT_MENU_LABELS.restoreCharge,
          icon: 'tabler:battery-vertical-charging',
          onSelect: () => restoreItemCharge(item.id),
        });
      }
    }

    const sheetActions: DropdownMenuItem[] = [];

    if (EDITABLE_ITEM_TYPES.has(item.type)) {
      sheetActions.push({
        label: SHEET_ROW_MENU_LABELS.edit,
        icon: 'tabler:edit',
        onSelect: () => openEditModal(item),
      });
    }

    sheetActions.push({
      label: SHEET_ROW_MENU_LABELS.share,
      icon: 'tabler:message-share',
      onSelect: () => shareItemToChat(item),
    });

    const removeAction: DropdownMenuItem[] = [
      {
        label: SHEET_ROW_MENU_LABELS.remove,
        icon: 'tabler:trash',
        color: 'error',
        onSelect: () => removeItem(item.id),
      },
    ];

    return [gameActions, sheetActions, removeAction];
  }

  /**
   * Отправляет карточку предмета в чат.
   * @param item - предмет для публикации
   */
  function shareItemToChat(item: DnDGameItem): void {
    chatStore.sendItemCard({
      cardType: 'equipment',
      title: item.name,
      payload: JSON.stringify(item),
    });
  }

  /**
   * Проверяет, является ли оружие универсальным (versatile)
   * @param item - предмет из инвентаря
   */
  function isVersatile(item: DnDGameItem): boolean {
    return (
      item.type === 'weapon'
      && Boolean(item.weaponProperties?.includes('versatile'))
    );
  }

  /**
   * Вычисляет и форматирует бонус к броску атаки текущим оружием
   */
  function getWeaponAttackBonusLabel(weapon: DnDGameItem): string {
    return formatSignedNumber(
      calculateWeaponAttackModifier(props.entity, weapon, resolvedStats.value),
    );
  }

  /**
   * Расшифровка бонуса атаки для подсказки плитки: из чего сложилось число.
   * Строка мастерства остаётся в разборе и без владения — по ней видно, почему
   * бонуса мастерства в атаке нет.
   *
   * @param weapon - оружие
   * @returns строка вида «Ловкость +3 · Мастерство +2»
   */
  function weaponAttackHint(weapon: DnDGameItem): string {
    return formatWeaponModifierParts(
      describeWeaponAttack(props.entity, weapon, resolvedStats.value),
    );
  }

  /**
   * Подсказка плитки урона: вид урона и расшифровка статической прибавки.
   *
   * @param weapon - оружие
   * @returns строка вида «Колющий · Ловкость +3 · Магия +1»
   */
  function weaponDamageHint(weapon: DnDGameItem): string {
    return [
      weaponKindLabel(weapon),
      formatWeaponModifierParts(
        describeWeaponDamage(props.entity, weapon, resolvedStats.value),
      ),
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /**
   * Формула урона оружия для бейджа — симметрично заклинаниям: кости без
   * инлайн-токенов + вложенный модификатор характеристики/магии (как «4к6+4»).
   *
   * @param weapon - оружие
   * @returns строка вида «4к6+4» / «1к8 + 1к6»
   */
  function weaponDamageFormulaLabel(weapon: DnDGameItem): string {
    const base = formatWeaponDamageFormula(weapon);

    // Магический бонус входит в расчёт прибавки — отдельно его не добавляем
    const mod = calculateWeaponDamageModifier(
      props.entity,
      weapon,
      resolvedStats.value,
    );

    if (mod === 0) {
      return base;
    }

    return `${base}${mod > 0 ? '+' : ''}${mod}`;
  }

  /**
   * Подпись вида урона оружия для строки листа: локализованные типы (несколько —
   * через « + ») и «Лечение», если у оружия есть лечащая часть.
   *
   * @param weapon - оружие
   * @returns подпись вида «Гром» / «Рубящий + Огонь» / «Лечение»
   */
  function weaponKindLabel(weapon: DnDGameItem): string {
    const types = new Set<string>();

    let hasHealing = false;

    for (const part of weapon.damageParts ?? []) {
      const info = describeDamagePart(part);

      for (const type of info.types) {
        types.add(type);
      }

      if (info.isHealing) {
        hasHealing = true;
      }
    }

    const labels = [...types].map(
      (type) => damageTypeMap.value.get(type) ?? type,
    );

    if (hasHealing) {
      labels.push(ACTOR_EQUIPMENT_TAB_LABELS.healing);
    }

    return labels.join(' + ');
  }

  /**
   * Подпись под названием предмета: категория записи, у оружия — ещё и вид
   * дальности. Собирается здесь, а не в строке: названия категорий приходят из
   * справочников хоста.
   *
   * @param item - предмет снаряжения
   * @returns подпись вида «Воинское оружие, Рукопашное оружие»
   */
  function getItemSubtitle(item: DnDGameItem): string {
    if (item.type === 'weapon') {
      const parts = [
        getWeaponCategoryLabel(item.baseType),
        item.rangeType ? WEAPON_RANGE_TYPE_LABELS[item.rangeType] : '',
      ];

      return parts.filter(Boolean).join(', ');
    }

    if (item.type === 'equipment') {
      const category = item.equipmentCategory ?? '';

      return armorCategoryMap.value.get(category) ?? category;
    }

    if (item.type === 'tool') {
      const category = item.toolCategory ?? '';

      return toolCategoryMap.value.get(category) ?? category;
    }

    return item.typeLabel ?? '';
  }

  /**
   * Плитки параметров строки: боевой параметр предмета (атака и урон оружия,
   * КД доспеха, бонус инструмента), затем цена и вес.
   *
   * Цена уступает место боевым плиткам: в бою нужны они, а ряд не растёт.
   *
   * @param item - предмет снаряжения
   * @returns плитки в порядке показа
   */
  function getItemStats(item: DnDGameItem): SheetRowStat[] {
    const stats: SheetRowStat[] = [];

    if (item.type === 'weapon' && item.damageParts?.length) {
      stats.push(
        {
          key: 'attack',
          label: EQUIPMENT_STAT_LABELS.attack,
          value: getWeaponAttackBonusLabel(item),
          tooltip: weaponAttackHint(item),
          accent: true,
          rollable: true,
        },
        {
          key: 'damage',
          label: EQUIPMENT_STAT_LABELS.damage,
          value: weaponDamageFormulaLabel(item),
          tooltip: weaponDamageHint(item),
          accent: true,
          rollable: true,
        },
      );
    } else if (item.type === 'equipment' && item.baseArmorAC) {
      // Щит прибавляет к классу доспеха, а не задаёт его — и показан прибавкой
      const isShield = item.equipmentCategory === 'shield';
      const armorClass = item.baseArmorAC + (item.magicBonus ?? 0);

      stats.push({
        key: 'armorClass',
        label: EQUIPMENT_STAT_LABELS.armorClass,
        value: isShield ? formatSignedNumber(armorClass) : String(armorClass),
        tooltip: isShield
          ? EQUIPMENT_STAT_HINTS.shieldClass
          : EQUIPMENT_STAT_HINTS.armorClass,
        accent: true,
      });
    } else if (item.type === 'tool' && item.toolBonus) {
      stats.push({
        key: 'toolBonus',
        label: EQUIPMENT_STAT_LABELS.toolBonus,
        value: formatSignedNumber(item.toolBonus),
        tooltip: EQUIPMENT_STAT_HINTS.toolBonus,
        accent: true,
      });
    }

    // Заряды идут сразу за боевой плиткой: у предмета с зарядами это главное
    // число строки — по нему видно, работает предмет ещё или уже пуст
    if (item.uses) {
      stats.push({
        key: 'uses',
        label: EQUIPMENT_STAT_LABELS.uses,
        value: `${item.uses.current}/${item.uses.max}`,
        tooltip: EQUIPMENT_STAT_HINTS.uses,
        accent: item.uses.current > 0,
      });
    }

    const cost = formatItemCost(item.cost);

    if (cost && stats.length < 2) {
      stats.push({
        key: 'cost',
        label: EQUIPMENT_STAT_LABELS.cost,
        value: cost,
        tooltip: EQUIPMENT_STAT_HINTS.cost,
      });
    }

    if (item.weight > 0) {
      stats.push({
        key: 'weight',
        label: WEIGHT_UNIT_LABEL,
        value: String(item.weight),
        tooltip: EQUIPMENT_STAT_HINTS.weight,
      });
    }

    return stats;
  }

  /**
   * Разделы снаряжения со строками, уже собранными для показа.
   *
   * Собираются вычислимым, а не вызовами из шаблона: бонус атаки и формула
   * урона считаются по характеристикам персонажа, и из шаблона они шли бы на
   * каждую перерисовку списка.
   */
  const equipmentRowGroups = computed(() =>
    equipmentGroups.value.map((group) => ({
      label: group.label,
      rows: group.items.map((item) => ({
        item,
        subtitle: getItemSubtitle(item),
        stats: getItemStats(item),
        menuItems: getItemMenuItems(item),
        isEquipBlocked: isEquipDisabled(item),
      })),
    })),
  );

  // --- Переносимый вес ---

  /** Открыта ли модалка настройки грузоподъёмности */
  const isCapacityModalOpen = ref(false);

  /** Ячейка плитки переносимого веса */
  const carryingCapacityCells = computed(() => [
    {
      label: ACTOR_EQUIPMENT_TAB_LABELS.carriedWeight,
      value: weightLabel.value,
    },
  ]);

  /** Размер листа для расчёта грузоподъёмности */
  const actorSize = computed(
    () => props.entity.system?.size ?? DEFAULT_CREATURE_SIZE,
  );

  /**
   * Сохраняет настройку предела переносимого веса.
   *
   * Настройка живёт в блоке `system` листа персонажа, поэтому окно и не
   * показывается существу: предел у него считается по правилам от Силы и
   * размера, и менять там нечего
   */
  function applyCarryingCapacity(updated: DnDCarryingCapacity): void {
    if (props.isReadOnly) {
      return;
    }

    emit('update:carrying-capacity', updated);

    triggerSaveIfNotEdit();
  }

  // --- Кошелёк ---

  /** Открыта ли модалка редактирования валюты */
  const isCurrencyModalOpen = ref(false);

  /**
   * Текущий кошелёк актёра. Нули подставляются намеренно: во вкладку попадает и
   * актёр из `QuickEquipmentModal`, который берёт его из стора хоста без
   * `normalizeActor`, — у записи из старого мира поля кошелька может не быть.
   */
  const currency = computed<DnDCurrency>(() => {
    const wallet = props.entity.system.currency;

    return {
      cp: wallet?.cp ?? 0,
      sp: wallet?.sp ?? 0,
      ep: wallet?.ep ?? 0,
      gp: wallet?.gp ?? 0,
      pp: wallet?.pp ?? 0,
    };
  });

  /** Ячейки строки валюты: количество, сокращение и полное название монеты */
  const currencyCells = computed(() =>
    CURRENCY_OPTIONS.map((option) => ({
      key: option.value,
      amount: currency.value[option.value],
      labelShort: option.labelShort,
      labelFull: option.labelFull,
    })),
  );

  /**
   * Открывает окно правки кошелька. В режиме чтения не открывается вовсе:
   * иначе игрок «поменял» бы монеты чужого монстра, сервер молча отверг бы
   * запись, и лист врал бы до следующей синхронизации.
   */
  function openCurrencyModal(): void {
    if (props.isReadOnly) {
      return;
    }

    isCurrencyModalOpen.value = true;
  }

  /**
   * Сохраняет кошелёк после подтверждения в модалке
   */
  function applyCurrency(updated: DnDCurrency): void {
    if (props.isReadOnly) {
      return;
    }

    emit('update:currency', updated);

    triggerSaveIfNotEdit();
  }
</script>

<template>
  <div class="flex min-h-50 flex-1 flex-col space-y-1">
    <!-- Переносимый вес + деньги / валюта (Вплотную к табам) -->
    <div
      v-if="showCarryingCapacity || showCurrency"
      class="mb-5 flex flex-col gap-2"
    >
      <!-- Обёртка-flex: плитка занимает ширину по содержимому, а не всю строку -->
      <div
        v-if="showCarryingCapacity"
        class="flex"
      >
        <SheetStatTile
          :cells="carryingCapacityCells"
          :tooltip="ACTOR_EQUIPMENT_TAB_LABELS.carriedWeightHint"
          :aria-label="ACTOR_EQUIPMENT_TAB_LABELS.carryingCapacitySettings"
          clickable
          :danger="isOverweight"
          @click="isCapacityModalOpen = true"
        />
      </div>

      <!-- Высота строки та же, что у ряда отбора на других вкладках (28px,
        ступень `sm` компонентов кита) — задана `min-h`, а не отступами: на
        узком листе монеты переносятся, и строке нужно вырасти -->
      <div
        v-if="showCurrency"
        :role="isReadOnly ? undefined : 'button'"
        :tabindex="isReadOnly ? undefined : 0"
        :aria-label="ACTOR_EQUIPMENT_TAB_LABELS.editCurrency"
        class="flex min-h-7 cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border border-default/50 bg-elevated/20 px-4 py-0.5 transition-colors hover:border-default hover:bg-elevated/40"
        @click.left.exact.prevent="openCurrencyModal"
        @keydown.enter.prevent="openCurrencyModal"
        @keydown.space.prevent="openCurrencyModal"
      >
        <UTooltip
          v-for="cell in currencyCells"
          :key="cell.key"
          :text="cell.labelFull"
        >
          <span class="flex items-baseline gap-1.5">
            <span class="text-sm font-bold text-highlighted tabular-nums">{{
              cell.amount
            }}</span>

            <span
              class="text-[10px] font-bold tracking-wider text-muted uppercase"
              >{{ cell.labelShort }}</span
            >
          </span>
        </UTooltip>
      </div>
    </div>

    <!-- Индикатор пустого списка -->
    <div
      v-if="inventory.length === 0"
      class="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed px-3 py-8 text-xs transition-colors"
      :class="
        isDragOver
          ? 'border-primary/50 bg-primary/5 text-primary'
          : 'border-default/30 text-dimmed'
      "
    >
      {{ ACTOR_EQUIPMENT_TAB_LABELS.dropHere }}
    </div>

    <!-- Список предметов с разделителями -->
    <template v-if="inventory.length > 0">
      <div
        v-for="(group, index) in equipmentRowGroups"
        :key="group.label"
        class="flex flex-col"
      >
        <!-- Разделитель -->
        <h4
          class="mb-1 text-xs font-semibold tracking-wider text-muted uppercase"
          :class="index === 0 ? 'mt-0' : 'mt-5'"
        >
          {{ group.label }}
        </h4>

        <div class="flex flex-col gap-2">
          <ActorEquipmentRow
            v-for="row in group.rows"
            :key="row.item.id"
            :item="row.item"
            :subtitle="row.subtitle"
            :stats="row.stats"
            :menu-items="row.menuItems"
            :is-equip-blocked="row.isEquipBlocked"
            :is-edit-mode="isEditMode"
            @open="openDetailModal(row.item)"
            @toggle-equip="toggleEquipped(row.item.id)"
            @roll="openRollModal(row.item)"
            @update:quantity="updateItemQuantity(row.item.id, $event)"
            @dragstart="handleItemDragStart($event, row.item)"
          />
        </div>
      </div>
    </template>
  </div>

  <!-- Модалка настройки грузоподъёмности -->
  <CarryingCapacityModal
    v-if="showCarryingCapacity"
    v-model:open="isCapacityModalOpen"
    :capacity="capacitySettings"
    :strength="strength"
    :actor-size="actorSize"
    @apply="applyCarryingCapacity"
  />

  <!-- Модалка редактирования кошелька -->
  <CurrencyModal
    v-if="showCurrency"
    v-model:open="isCurrencyModalOpen"
    :currency="currency"
    @apply="applyCurrency"
  />

  <DiceRollModal
    v-model:open="isRollModalOpen"
    :formula="rollConfig.formula"
    :title="`${ACTOR_EQUIPMENT_TAB_LABELS.attackRollPrefix}${rollConfig.name}`"
    :roll-label="rollConfig.name"
    :attack-modifier="rollConfig.attackModifier"
    :evaluate-conditional-bonuses="rollConfig.evaluateBonuses"
    :initial-roll-mode="rollConfig.initialRollMode"
    :incoming-attack-type="rollConfig.incomingAttackType"
    :damage-type="rollConfig.damageType"
    :damage-parts="rollConfig.damageParts"
    :evaluate-bonus-damage-parts="rollConfig.evaluateBonusDamageParts"
    :on-roll-parts="rollConfig.onRollParts"
    :on-hit="rollConfig.onHit"
    :roll-button-text="ACTOR_EQUIPMENT_TAB_LABELS.attack"
  />
</template>
