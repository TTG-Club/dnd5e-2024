<script setup lang="ts">
  import type { DamageType } from '@vtt/shared';
  import type {
    AttackRollMode,
    AttackRollModeReasons,
    DamageHitDetails,
    DndIncomingAttackContext,
    IncomingAttackContext,
    RollContext,
  } from '@vtt/shared/system/dnd.js';

  import type { AttackRollSnapshot } from '../../composables/attackRollSnapshot';
  import type { DamageTypeChoiceRequest } from '../../composables/damageTypeChoice';
  import type { RollBonusEvaluator } from '../../composables/rollBonusEvaluator';
  import type {
    ProjectileAttackContext,
    RolledSpellDamagePart,
    SpellDamagePartInput,
  } from '../../composables/useSpellResolution';
  import type { CheckRollResult, RollDamageVariant } from './diceRollTypes';

  import { promiseTimeout } from '@vueuse/core';
  import { computed, onBeforeUnmount, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { useChatStore } from '@/stores/chatStore';
  import { useDiceRollerStore } from '@/stores/diceRollerStore';
  import { useTargetStore } from '@/stores/targetStore';
  import {
    buildAttackFormula,
    CHOICE_DAMAGE_TYPE,
    damageTypeChoiceKey,
    doubleDiceInFormula,
    formatAttackRollModeReasons,
    formatDamageDefenseSuffix,
    getNaturalD20Roll,
    getShortDamageTypeLabel,
    isDamageType,
    isDeductionFormula,
    listPartDamageTypeChoices,
    performTwoStageAttack,
    rollRandomDamageTypeChoices,
    scaleDamageFormula,
    settleDamageTypeChoices,
    toRollerFormula,
    uniqueDamageTypeChoices,
  } from '@vtt/shared/system/dnd.js';

  import {
    announceDamageTypeChoices,
    useDamageTypeLabel,
  } from '../../composables/damageTypeChoice';
  import { buildIncomingAttackContext } from '../../composables/incomingAttack';
  import { resolveAttackerIgnoredResistances } from '../../composables/spellResolutionShared';
  import {
    dispatchAttackRollTriggers,
    reportAttackRoll,
  } from '../../composables/useEffectTriggerEvents';
  import { useWorldEntities } from '../../composables/useWorldEntities';
  import { useSystemDataStore } from '../../stores/systemDataStore';
  import {
    DICE_ROLL_DEFAULT_BUTTON,
    DICE_ROLL_LABELS,
    DICE_ROLL_LOG_PREFIX,
    SPELL_DAMAGE_ROLL_BUTTON,
    SPELL_LEVEL_SUFFIX,
    WILLING_SAVE_TOTAL,
  } from './constants';

  type RollVisibility = 'public' | 'gm' | 'private';

  interface Props {
    open: boolean;
    /** Заголовок модалки (напр. "Бросок инициативы", "Атака — Длинный меч") */
    title: string;
    /** Контекст/label для чата (напр. "Инициатива", "Атака — Длинный меч") */
    rollLabel: string;
    /** Текст кнопки броска (напр. "Бросить инициативу") */
    rollButtonText?: string;
    /**
     * Произвольная формула для броска (напр. "1к8 + 3").
     * Если указана — используется вместо стандартной "1к20 + modifier".
     */
    formula?: string;
    /**
     * Необязательное переопределение формулы ТОЛЬКО для отображения в блоке
     * «Формула». Нужно для условных веток @target (показ «2к8 или 2к12», когда
     * состояние цели неизвестно). На сам бросок не влияет — там используется
     * `formula` / `damageParts`.
     */
    formulaDisplay?: string;
    /**
     * Модификатор для стандартной формулы 1к20.
     * Используется только если formula не передана.
     */
    modifier?: number;
    /** Является ли это лечением (прибавить HP вместо вычитания) */
    isHealing?: boolean;
    /**
     * Бонус атаки (мод. характеристики + мастерство + доп. бонус).
     * Передаётся всегда, когда действие — атака; будет ли реально бросок
     * попадания, модалка решает сама по наличию выбранной цели.
     */
    attackModifier?: number;
    /** Функция для вычисления условных бонусов в момент броска */
    // eslint-disable-next-line vue/require-default-prop -- отсутствие расчёта и означает «условных бонусов нет», пустышка по умолчанию это бы скрыла
    evaluateConditionalBonuses?: (context: {
      hasAdvantage: boolean;
      hasDisadvantage: boolean;
    }) => { attackBonus: number; damageBonus: number };
    /** Кубиковые бонусы к атаке или стандартному d20-спасброску на момент броска. */
    evaluateBonusRollFormulas?: RollBonusEvaluator;
    /** Бонусы назначенных целей снарядов, собранные до расхода одноразовых эффектов. */
    evaluateProjectileBonusRollFormulas?: (
      context: RollContext,
    ) => ReadonlyMap<string, readonly string[]>;
    initialRollMode?: AttackRollMode;
    /**
     * Откуда стартовый режим атаки: состояния, эффекты, доспех, дистанция.
     * Без них окно показывало помеху «без причины».
     */
    rollModeReasons?: AttackRollModeReasons;
    /** С какой натуральной кости атака — крит (у оружия Чемпиона 19) */
    critThreshold?: number;
    /** Тип входящей атаки для расчёта условных бонусов к AC цели (melee/ranged/spell) */
    incomingAttackType?: IncomingAttackContext['attackType'];
    autoFail?: boolean;
    /**
     * Спасбросок можно не бросать: цель согласна. Кнопка есть у спасброска
     * против эффекта, которому по правилам достаточно согласия цели
     * («Согласная цель не совершает спасбросок»)
     */
    allowWilling?: boolean;
    /** Тип урона для расчета сопротивлений */
    damageType?: string;
    /** Сложность проверки/спасброска для вывода успеха или провала */
    targetDc?: number;

    // --- Секция каста заклинания (опционально) ---
    /** Базовый круг заклинания (0 = заговор). Если задан — показываем секцию «Круг» */
    spellLevel?: number;
    /** Массив Доступных уровней заклинаний. Если передан, селект предложит только их. */
    availableSpellLevels?: number[];
    /**
     * Круг закреплён до окна (плашка круга, выбор целей или снарядов): под него
     * уже посчитаны область, цена или число целей. Список кругов остаётся на
     * месте, но выключен и подписан — круг выбирают в одном месте, а не в двух.
     */
    spellLevelLocked?: boolean;
    /** Данные для масштабирования урона при усилении */
    spellScalingDice?: string;
    /** Уровень Pact-слота (warlock). Если > 0, показываем чекбокс */
    pactSlotLevel?: number;
    onSpellSlotConsume?: (
      castLevel: number,
      consumeSlot: boolean,
      isPactSlot: boolean,
    ) => void;
    /**
     * Коллбэк при любом успешном применении / броске. Передаёт итоговый урон и
     * выбранный тип урона.
     *
     * Контракт: окно не знает, урон ли его итог. Без `formula` и без
     * `skipRoll` оно катит d20-проверку, и `damageTotal` — итог проверки.
     * Отдавать его в разбор целей как урон вызывающий не должен: заклинание
     * сверяется с планом каста (`resolvePlannedDamageTotal`), а заклинание
     * без частей урона окно броска не открывает вовсе (`resolveSpellCastPlan`).
     */
    onRoll?: (
      damageTotal: number,
      resolvedDamageType?: string,
      attack?: AttackRollSnapshot,
    ) => void;
    /** Проверяет актуальность каста до расхода ячейки и применения эффектов. */
    beforeRoll?: (
      castLevel: number,
      consumeSlot: boolean,
      isPactSlot: boolean,
    ) => boolean;
    /**
     * Части урона/лечения (многочастный путь). Если заданы — модалка катает
     * каждую часть, объединяет в один бросок и вызывает `onRollParts` с разбивкой
     * вместо `onRoll`. Применение делегируется наружу (resolveSpellDamageWithParts).
     */
    damageParts?: SpellDamagePartInput[];
    /**
     * Коллбэк многочастного пути: получает брошенные части и снимок броска
     * атаки (если бросок попадания был) — по нему разбор считает удар.
     */
    onRollParts?: (
      parts: RolledSpellDamagePart[],
      attack?: AttackRollSnapshot,
    ) => void;
    /**
     * Roll-time сборщик бонус-частей урона от Active Effects (кость-формулы в
     * `damage.*`, в т.ч. условные «+2к6 при преимуществе»). Вызывается в момент
     * броска с фактическим режимом (преимущество/помеха); результат добавляется
     * к `damageParts`. Работает только в многочастном пути.
     */
    evaluateBonusDamageParts?: (context: {
      hasAdvantage: boolean;
      hasDisadvantage: boolean;
    }) => SpellDamagePartInput[];
    /**
     * Коллбэк чистой d20-проверки (окно без `formula`, без частей урона и без
     * броска попадания): отдаёт бросок В РАЗБИВКЕ — натуральную кость и
     * фактический модификатор вместе с добавленным в окне бонусом. Нужен
     * вызывающему, которому итога мало: инициатива хранит кость и модификатор
     * порознь (трекер показывает «к20 + мод»).
     */
    onCheckRoll?: (result: CheckRollResult) => void;
    /**
     * Коллбэк отмены: окно закрыли (крестик, Escape, конец сессии мира), так и
     * не бросив. Вызывается ровно один раз и ТОЛЬКО если броска не было.
     *
     * Нужен всем, кто ждёт результата окна: без него закрытие оставляло
     * вызывающего висеть навсегда (спасбросок цели — вместе со всем начатым
     * действием: урон не применялся, в чат не уходило ничего).
     */
    onCancel?: () => void;
    /** Коллбэк при попадании атаки (вызывается даже если нет формулы урона). */
    onHit?: (attack?: AttackRollSnapshot) => void;
    /**
     * Тип урона на выбор у источника броска (`@dmg.choice(…)`): окно
     * показывает поле «Тип урона» и в начале броска отдаёт итог — до урона,
     * попадания и эффектов (`requestDamageTypeChoice`).
     */
    damageTypeChoice?: DamageTypeChoiceRequest;
    /**
     * Наборы урона на выбор (урон «или» у действия существа): окно показывает
     * поле «Урон», и выбранный набор заменяет формулу, части, бонус-части,
     * вопрос о типе и применение (`onRollParts`). Нет — урон из пропов.
     */
    damageVariants?: RollDamageVariant[];
    /**
     * Кто атакует. На броске атаки (попадание ИЛИ промах) окно расходует
     * срабатывания «следующей атаки» у атакующего и целей — ДО самого броска:
     * режим (преим./помеха) уже зафиксирован в `attackRollMode`. Израсходованный
     * эффект действует на саму эту атаку: бросок отдаёт обработчикам урона
     * снимок (`AttackRollSnapshot`), и удар считается с этими эффектами, успел
     * ответ сервера убрать их из мира или нет. Не расходуется при отмене окна
     * и при бросках без атаки (чистый урон / лечение / спасбросок).
     */
    attackerId?: string;
    /**
     * Серия атак снарядов (Мистический заряд, Палящий луч): по кнопке модалка
     * НЕ катает ни атаку, ни урон сама, а отдаёт контекст броска (итоговый
     * модификатор атаки с учётом доп. бонуса и режим преимущества/помехи)
     * вызывающему — тот выполняет бросок попадания для каждого снаряда и урон
     * за попадания (useSpellResolution.resolveSpellDamage → projectileAttack).
     */
    onProjectileAttack?: (
      context: Omit<ProjectileAttackContext, 'attackType'>,
    ) => void;
    /** Если true — модалка НЕ применяет урон к цели (обработка делегирована вызывающему) */
    skipDamageApplication?: boolean;
    /** Если true — модалка НЕ отправляет результат в чат (вызывающий сам формирует сообщение) */
    skipChatMessage?: boolean;
    /**
     * Если true — модалка вообще НЕ кидает кубик (нет броска 1к20/урона и
     * сообщения о броске). Нужно для заклинаний-самобаффов без урона (напр.
     * Щит): окно служит только выбором круга и подтверждением — списывает
     * ячейку (`onSpellSlotConsume`) и зовёт `onRoll(0)`.
     */
    skipRoll?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), {
    rollButtonText: DICE_ROLL_DEFAULT_BUTTON,
    formula: undefined,
    formulaDisplay: undefined,
    modifier: 0,
    isHealing: false,
    attackModifier: undefined,
    initialRollMode: 'normal',
    rollModeReasons: undefined,
    evaluateBonusRollFormulas: undefined,
    evaluateProjectileBonusRollFormulas: undefined,
    incomingAttackType: undefined,
    damageType: undefined,
    spellLevel: undefined,
    availableSpellLevels: () => [],
    spellLevelLocked: false,
    spellScalingDice: undefined,
    pactSlotLevel: 0,
    onSpellSlotConsume: undefined,
    onRoll: undefined,
    beforeRoll: undefined,
    damageParts: undefined,
    onRollParts: undefined,
    evaluateBonusDamageParts: undefined,
    onCheckRoll: undefined,
    onCancel: undefined,
    onHit: undefined,
    damageTypeChoice: undefined,
    damageVariants: undefined,
    attackerId: undefined,
    critThreshold: undefined,
    onProjectileAttack: undefined,
    skipDamageApplication: false,
    skipChatMessage: false,
    skipRoll: false,
    targetDc: undefined,
    allowWilling: false,
  });

  const emit = defineEmits<{
    'update:open': [value: boolean];
  }>();

  const diceRollerStore = useDiceRollerStore();
  const chatStore = useChatStore();
  const targetStore = useTargetStore();
  const systemDataStore = useSystemDataStore();

  /** Пауза перед показом броска урона, когда 3D-кубики выключены (мс) */
  const ATTACK_RESULT_DELAY_MS = 800;

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const bonusValue = ref(0);
  const rollType = ref<RollVisibility>('public');

  // --- Стейт каста заклинания ---
  const selectedSpellLevel = ref(0);
  const consumeSpellSlot = ref(true);
  const usePactSlot = ref(false);

  // --- Урон «или»: набор урона выбирают в окне ---
  /** Номер выбранного набора в `damageVariants` */
  const selectedDamageVariantIndex = ref(0);

  /** Выбранный набор урона; без наборов урон берётся из пропов */
  const activeDamageVariant = computed<RollDamageVariant | undefined>(
    () => props.damageVariants?.[selectedDamageVariantIndex.value],
  );

  /** Пункты поля «Урон» */
  const damageVariantItems = computed(() =>
    (props.damageVariants ?? []).map((variant, index) => ({
      label: variant.label,
      value: index,
    })),
  );

  /**
   * Меняет выбранный набор урона.
   *
   * @param value - номер набора из селекта
   */
  function selectDamageVariant(value: unknown): void {
    if (typeof value === 'number') {
      selectedDamageVariantIndex.value = value;
    }
  }

  // Всё, что зависит от урона, берётся у выбранного набора, а без наборов —
  // из пропов: остальной код окна наборов не различает
  const rollFormula = computed(() =>
    activeDamageVariant.value
      ? activeDamageVariant.value.formula
      : props.formula,
  );

  const rollFormulaDisplay = computed(() =>
    activeDamageVariant.value ? undefined : props.formulaDisplay,
  );

  const rollDamageType = computed(() =>
    activeDamageVariant.value
      ? activeDamageVariant.value.damageType
      : props.damageType,
  );

  const rollDamageParts = computed(() =>
    activeDamageVariant.value
      ? activeDamageVariant.value.damageParts
      : props.damageParts,
  );

  const rollEvaluateBonusDamageParts = computed(() =>
    activeDamageVariant.value
      ? activeDamageVariant.value.evaluateBonusDamageParts
      : props.evaluateBonusDamageParts,
  );

  const rollDamageTypeChoice = computed(() =>
    activeDamageVariant.value
      ? activeDamageVariant.value.damageTypeChoice
      : props.damageTypeChoice,
  );

  const rollOnRollParts = computed(() =>
    activeDamageVariant.value
      ? activeDamageVariant.value.onRollParts
      : props.onRollParts,
  );

  // --- Стейт выбора типа урона ---
  const selectedChoiceDamageType = ref<DamageType>('fire');

  /** Нужен ли выбор типа урона (заклинания с damageType: 'choice') */
  const isDamageTypeChoice = computed(() => rollDamageType.value === 'choice');

  /** Итоговый тип урона: выбранный игроком или из пропа */
  const resolvedDamageType = computed(() => {
    if (isDamageTypeChoice.value) {
      return selectedChoiceDamageType.value;
    }

    return rollDamageType.value;
  });

  /**
   * Опции для селекта типа урона. Справочник приходит из мира, поэтому ключ
   * проверяется: чужой тип в списке всё равно не выбрать — защиты его не знают.
   * Служебный «выбор стихии» в списке не нужен — его выбирают на самом уроне.
   */
  const damageTypeOptions = computed(() =>
    systemDataStore.damageTypes.flatMap((damageType) =>
      damageType.key !== CHOICE_DAMAGE_TYPE && isDamageType(damageType.key)
        ? [{ label: damageType.name, value: damageType.key }]
        : [],
    ),
  );

  /** Показывать ли секцию каста заклинания */
  const hasSpellCast = computed(
    () => props.spellLevel !== undefined && props.spellLevel > 0,
  );

  /** Доступные круги для усиления */
  const spellLevelItems = computed(() => {
    if (!hasSpellCast.value || props.spellLevel === undefined) {
      return [];
    }

    if (props.availableSpellLevels.length > 0) {
      return props.availableSpellLevels.map((lvl) => ({
        label: `${lvl}${SPELL_LEVEL_SUFFIX}`,
        value: lvl,
      }));
    }

    const items = [];
    const baseLevel = props.spellLevel;

    for (let idx = baseLevel; idx <= 9; idx++) {
      items.push({ label: `${idx}${SPELL_LEVEL_SUFFIX}`, value: idx });
    }

    return items;
  });

  /** Можно ли выбрать Pact-слот */
  const canUsePactSlot = computed(() => {
    if (!props.pactSlotLevel || props.spellLevel === undefined) {
      return false;
    }

    return (
      props.pactSlotLevel > 0
      && props.pactSlotLevel >= props.spellLevel
      && selectedSpellLevel.value === props.pactSlotLevel
    );
  });

  /** Режим броска атаки (обычный / преимущество / помеха) */
  const attackRollMode = ref<AttackRollMode>('normal');

  // --- Тип урона на выбор у частей (`@dmg.choice(…)`) ---
  const getDamageTypeLabel = useDamageTypeLabel();

  /** Выбранный тип по ключу списка вариантов; нет записи — первый вариант */
  const partTypePicks = ref<Record<string, string>>({});

  /**
   * Типы на выбор, о которых спрашивает окно: все списки источника
   * (`damageTypeChoice` — его урон, эффекты на цель, зоны) и остаток частей
   * урона — бонус-урон собственных эффектов листа. Бонус-части собираются по
   * текущему режиму — так же, как их соберёт бросок. Одинаковый список —
   * одно поле. Случайные типы не спрашиваются: они выпадут при броске.
   */
  const partTypeChoiceRows = computed(() => {
    const bonusParts = rollDamageParts.value?.length
      ? (rollEvaluateBonusDamageParts.value?.({
          hasAdvantage: attackRollMode.value === 'advantage',
          hasDisadvantage: attackRollMode.value === 'disadvantage',
        }) ?? [])
      : [];

    return uniqueDamageTypeChoices([
      ...(rollDamageTypeChoice.value?.choices ?? []),
      ...listPartDamageTypeChoices([
        ...(rollDamageParts.value ?? []),
        ...bonusParts,
      ]),
    ])
      .filter((choice) => choice.mode === 'choose')
      .map((choice) => {
        const key = damageTypeChoiceKey(choice);

        return {
          key,
          value: partTypePicks.value[key] ?? choice.options[0],
          items: choice.options.map((option) => ({
            label: getDamageTypeLabel(option),
            value: option,
          })),
        };
      });
  });

  /**
   * Меняет выбранный тип у списка вариантов.
   *
   * @param key - ключ списка вариантов
   * @param value - выбранный тип из селекта
   */
  function selectPartType(key: string, value: unknown): void {
    if (typeof value === 'string') {
      partTypePicks.value = { ...partTypePicks.value, [key]: value };
    }
  }

  /**
   * Решает типы на выбор в начале броска: поля окна — их значение, случайные
   * списки источника выпадают здесь один раз. Итог уходит в чат и источнику
   * (`damageTypeChoice.onChoose`) раньше урона, попадания и эффектов, а
   * части урона этого броска решаются тем же итогом.
   *
   * @returns итог выбора для частей урона
   */
  function settleRollDamageTypeChoices(): Map<string, string> {
    const request = rollDamageTypeChoice.value;

    const picks = new Map([
      ...rollRandomDamageTypeChoices(request?.choices ?? []),
      ...partTypeChoiceRows.value.map((row): [string, string] => [
        row.key,
        row.value,
      ]),
    ]);

    if (request) {
      announceDamageTypeChoices(request.sourceName, request.choices, picks);
      request.onChoose(picks);
    }

    return picks;
  }

  const { findCurrentDndEntity } = useWorldEntities();

  /** AC цели с учётом типа входящей атаки. Реактивен к смене цели, пока модалка открыта */
  const targetAc = computed(() => {
    const attacker = findCurrentDndEntity(props.attackerId);

    // Ядро передаёт контекст системе как есть: тип атакующего едет в нём
    const attackContext: DndIncomingAttackContext | undefined =
      props.incomingAttackType
        ? {
            ...(attacker
              ? buildIncomingAttackContext(attacker, props.incomingAttackType)
              : { attackType: props.incomingAttackType }),
          }
        : undefined;

    return targetStore.getTargetAc(attackContext);
  });

  /**
   * Будет ли бросок попадания. Единая точка решения для UI и самого броска:
   * вызывающий передаёт attackModifier, если действие — атака, а наличие
   * выбранной цели проверяется здесь (без цели катится только урон).
   */
  const hasAttackRoll = computed(
    () =>
      props.attackModifier !== undefined
      && !props.isHealing
      && targetAc.value !== null,
  );

  /**
   * Показывать ли секцию «Режим броска» (обычный/преимущество/помеха). Только
   * при реальном броске: атака по цели, серия атак снарядов или стандартная
   * d20-проверка (без `formula`). При `skipRoll` (самобафф без броска) скрыта.
   */
  const showRollModeSection = computed(
    () =>
      !props.skipRoll
      && (hasAttackRoll.value
        || !rollFormula.value
        || props.onProjectileAttack !== undefined),
  );

  /**
   * Строки «Помеха: …» / «Преимущество: …» под режимом броска. Только у атаки
   * по цели: причины посчитаны для неё.
   */
  const rollModeReasonLines = computed<string[]>(() =>
    hasAttackRoll.value && props.rollModeReasons
      ? formatAttackRollModeReasons(props.rollModeReasons)
      : [],
  );

  /** Текст кнопки: атака без выбранной цели откатывается к броску урона */
  const effectiveRollButtonText = computed(() => {
    if (
      props.attackModifier !== undefined
      && !props.isHealing
      && targetAc.value === null
      && props.onProjectileAttack === undefined
    ) {
      return SPELL_DAMAGE_ROLL_BUTTON;
    }

    return props.rollButtonText;
  });

  /** Динамически вычисляемые условные бонусы (срабатывают, если условия соблюдены) */
  const currentConditionalBonuses = computed(() => {
    if (!props.evaluateConditionalBonuses) {
      return { attackBonus: 0, damageBonus: 0 };
    }

    return props.evaluateConditionalBonuses({
      hasAdvantage: attackRollMode.value === 'advantage',
      hasDisadvantage: attackRollMode.value === 'disadvantage',
    });
  });

  /** Кубиковые бонусы не входят в числовой модификатор листа. */
  const currentBonusRollFormulas = computed(
    () =>
      props.evaluateBonusRollFormulas?.({
        hasAdvantage: attackRollMode.value === 'advantage',
        hasDisadvantage: attackRollMode.value === 'disadvantage',
      }) ?? [],
  );

  /** Итоговая формула урона с учётом усиления на высших кругах */
  const effectiveFormula = computed(() => {
    if (
      !hasSpellCast.value
      || !rollFormula.value
      || !props.spellScalingDice
      || props.spellLevel === undefined
    ) {
      return rollFormula.value;
    }

    const levelDiff = selectedSpellLevel.value - props.spellLevel;

    if (levelDiff <= 0) {
      return rollFormula.value;
    }

    // Используем утилиту из shared
    return scaleDamageFormula(
      rollFormula.value,
      props.spellScalingDice,
      props.spellLevel,
      selectedSpellLevel.value,
    );
  });

  /** Базовая формула для отображения (без бонуса пользователя, но с учётом условных атак) */
  const displayFormula = computed(() => {
    // formulaDisplay переопределяет показ (условные ветки @target → «или»),
    // не затрагивая формулу броска. Масштабирование на высших кругах в этом
    // режиме не визуализируем — условные заклинания показываем как есть.
    const baseFormula =
      rollFormulaDisplay.value ?? effectiveFormula.value ?? rollFormula.value;

    if (baseFormula && !hasAttackRoll.value) {
      // Это чистый бросок урона или кастомный бросок формулы,
      // возможно мы захотим добавить currentConditionalBonuses.damageBonus сюда.
      // Но DiceRollModal используется как для атаки, так и отдельно
      const dmgBonus = currentConditionalBonuses.value.damageBonus;

      if (dmgBonus === 0) {
        return baseFormula;
      }

      return `${baseFormula}${dmgBonus > 0 ? '+' : ''}${dmgBonus}`;
    }

    // Для атак показываем бонус атаки (мод. характеристики + мастерство + …);
    // для прочих d20-бросков (спасы/проверки) — `modifier`.
    const baseMod = props.attackModifier ?? props.modifier;

    const mod = baseMod + currentConditionalBonuses.value.attackBonus;

    return buildAttackFormula(
      mod,
      attackRollMode.value,
      currentBonusRollFormulas.value,
    );
  });

  /** В окне уже бросили — закрытие после этого отменой не считается */
  let hasRolled = false;

  /** `onCancel` уже отдан — закрытие и размонтирование не должны дублировать его */
  let cancelNotified = false;

  /**
   * Сообщает вызывающему, что окно ушло без броска. Молчит, если бросок был
   * или об отмене уже сообщили: вызывающий сворачивает по ней начатое действие,
   * и повторить это второй раз нельзя.
   */
  function notifyCancel(): void {
    if (hasRolled || cancelNotified) {
      return;
    }

    cancelNotified = true;

    props.onCancel?.();
  }

  watch(
    () => props.open,
    (opened, wasOpened) => {
      if (opened) {
        hasRolled = false;
        cancelNotified = false;
        bonusValue.value = 0;
        rollType.value = 'public';
        attackRollMode.value = props.initialRollMode;
        partTypePicks.value = {};
        selectedDamageVariantIndex.value = 0;

        // Сброс стейта заклинания
        if (props.spellLevel !== undefined) {
          selectedSpellLevel.value =
            props.availableSpellLevels.length > 0
              ? props.availableSpellLevels[0]
              : props.spellLevel;

          consumeSpellSlot.value = props.spellLevel > 0;
          usePactSlot.value = false;
        }

        return;
      }

      // Окно закрылось. `wasOpened` отсекает первый (immediate) прогон у окон,
      // смонтированных закрытыми: отменять там ещё нечего.
      if (wasOpened) {
        notifyCancel();
      }
    },
    { immediate: true },
  );

  // Окно может уйти и без смены `open` — например, по концу сессии мира
  // (UDraggableModal слушает своё событие). Ждущий результата обязан узнать и
  // об этом, иначе действие снова повиснет.
  onBeforeUnmount(() => {
    if (props.open) {
      notifyCancel();
    }
  });

  /**
   * Бросок атаки состоялся: срабатывания «следующей атаки» у атакующего и целей.
   *
   * @param projectile - серия снарядов (цели — назначенные цели снарядов)
   * @returns снимок броска: цели и израсходованные эффекты сторон — его
   *   получают обработчики урона; атакующий неизвестен — `undefined`
   */
  function announceAttackRoll(
    projectile: boolean,
  ): AttackRollSnapshot | undefined {
    return props.attackerId
      ? dispatchAttackRollTriggers(props.attackerId, {
          projectile,
          rollMode: attackRollMode.value,
          attackType: props.incomingAttackType,
        })
      : undefined;
  }

  /**
   * Бросок атаки и его урон записаны: сервер выполнит срабатывания атаки со
   * спасброском, уроном и действиями другой стороне.
   *
   * @param attack - снимок броска; нет — атакующий неизвестен, сообщать не о ком
   * @param landed - попал ли бросок; не задано — здесь это ещё неизвестно
   * @param critical - попадание критическое
   */
  function finishAttackRoll(
    attack: AttackRollSnapshot | undefined,
    landed?: boolean,
    critical = false,
  ): void {
    if (attack) {
      reportAttackRoll(
        attack.attackerId,
        attack.targetIds,
        attackRollMode.value,
        landed,
        critical,
      );
    }
  }

  /**
   * Выполняет бросок и отправляет результат в чат.
   * Если задан attackModifier и есть цель — выполняет двухэтапную атаку D&D 5e.
   */
  function performRoll() {
    if (
      props.beforeRoll
      && !props.beforeRoll(
        selectedSpellLevel.value,
        consumeSpellSlot.value,
        usePactSlot.value && consumeSpellSlot.value,
      )
    ) {
      return;
    }

    // Бросок пошёл — закрытие окна в `finally` отменой уже не будет
    hasRolled = true;

    // Набор урона «или» и тип урона на выбор решаются первыми: чат и
    // источник узнают их раньше, чем ляжет урон и эффекты
    activeDamageVariant.value?.onSelect();

    const damageTypePicks = settleRollDamageTypeChoices();

    // Сохраняем текущие значения и устанавливаем нужные
    const prevPrivate = chatStore.isPrivateRoll;
    const prevGmOnly = chatStore.isGmOnlyRoll;

    chatStore.isPrivateRoll = rollType.value === 'private';
    chatStore.isGmOnlyRoll = rollType.value === 'gm';

    try {
      // Фиксируем бонус до расхода одноразовых эффектов: он относится к этому броску.
      const bonusDiceFormulas = props.skipRoll
        ? []
        : currentBonusRollFormulas.value;

      const bonusDiceFormulasByTarget = props.onProjectileAttack
        ? (props.evaluateProjectileBonusRollFormulas?.({
            hasAdvantage: attackRollMode.value === 'advantage',
            hasDisadvantage: attackRollMode.value === 'disadvantage',
          }) ?? new Map<string, readonly string[]>())
        : new Map<string, readonly string[]>();

      // --- Списание ячейки заклинания ---
      if (hasSpellCast.value && props.onSpellSlotConsume) {
        props.onSpellSlotConsume(
          selectedSpellLevel.value,
          consumeSpellSlot.value,
          usePactSlot.value && consumeSpellSlot.value,
        );
      }

      // --- Самобафф без броска: только списание ячейки + onRoll(0) ---
      // (Щит и пр.: окно нужно лишь для выбора круга и подтверждения).
      if (props.skipRoll) {
        if (props.onRoll) {
          props.onRoll(0, resolvedDamageType.value);
        }

        return;
      }

      // --- Серия атак снарядов: модалка только собирает контекст броска ---
      // Цели уже распределены (projectileStore); броски попадания и урон
      // выполняет вызывающий — по броску на каждый снаряд против AC его цели.
      if (props.onProjectileAttack) {
        // Расход одноразовых эффектов ДО броска: режим (преим./помеха) уже
        // зафиксирован в attackRollMode. Израсходованное едет в разбор снимком
        // броска — серия считается с ним
        const projectileAttack = announceAttackRoll(true);

        props.onProjectileAttack({
          attackModifier:
            (props.attackModifier ?? 0)
            + bonusValue.value
            + currentConditionalBonuses.value.attackBonus,
          rollMode: attackRollMode.value,
          bonusDiceFormulasByTarget,
          attack: projectileAttack,
        });

        finishAttackRoll(projectileAttack);

        return;
      }

      // AC цели, если будет бросок попадания (null — катим только урон)
      const attackTargetAc = hasAttackRoll.value ? targetAc.value : null;

      // --- Многочастный путь: один общий бросок всех частей ---
      const damageParts = rollDamageParts.value;

      if (damageParts && damageParts.length > 0) {
        // Бонус-части урона от Active Effects собираются в момент броска:
        // условия (преимущество/помеха, HP цели) оцениваются по фактическому
        // режиму, выбранному в модалке.
        const bonusParts =
          rollEvaluateBonusDamageParts.value?.({
            hasAdvantage: attackRollMode.value === 'advantage',
            hasDisadvantage: attackRollMode.value === 'disadvantage',
          }) ?? [];

        // Тип на выбор решается до броска: выбранный в окне, у случайного —
        // выпавший; дальше часть идёт обычным типом (защиты, чат)
        const effectiveParts = settleDamageTypeChoices(
          [...damageParts, ...bonusParts],
          damageTypePicks,
        );

        // Плоский условный бонус урона (evaluateConditionalBonuses) в
        // одночастном пути дописывается к формуле урона — сохраняем паритет,
        // дописывая его к первой урон-части. Прокидывается только оружейными
        // путями (заклинания этот проп не передают — их поведение не меняется).
        const flatDamageBonus = currentConditionalBonuses.value.damageBonus;

        if (flatDamageBonus !== 0) {
          const firstDamageIndex = effectiveParts.findIndex(
            (part) => !part.isHealing,
          );

          if (firstDamageIndex !== -1) {
            const sign = flatDamageBonus > 0 ? '+' : '';

            effectiveParts[firstDamageIndex] = {
              ...effectiveParts[firstDamageIndex],
              formula: `${effectiveParts[firstDamageIndex].formula}${sign}${flatDamageBonus}`,
            };
          }
        }

        if (attackTargetAc !== null) {
          // Расход одноразовых эффектов ДО броска (режим уже зафиксирован).
          // Части катаются после показа броска — удар считается по снимку
          const partsAttack = announceAttackRoll(false);

          // Атака: бросок попадания → части на попадании
          performPartsAttackRoll(
            attackTargetAc,
            effectiveParts,
            bonusDiceFormulas,
            partsAttack,
          );
        } else {
          performPartsRoll(effectiveParts);
        }

        return;
      }

      // --- Двухэтапная атака (D&D 5e) ---
      let damageTotal = 0;
      let attackSnapshot: AttackRollSnapshot | undefined;
      let attackLanded: boolean | undefined;
      let attackCritical = false;

      if (attackTargetAc !== null) {
        // Расход одноразовых эффектов ДО броска (режим уже зафиксирован).
        // Урон окно применяет в этом же тике — мир расхода ещё не видел; а
        // обработчик `onRoll` разбирает цели позже и считает их по снимку
        attackSnapshot = announceAttackRoll(false);

        const attack = performAttackRoll(
          attackTargetAc,
          bonusDiceFormulas,
          attackSnapshot,
        );

        damageTotal = attack.total;
        attackLanded = attack.landed;
        attackCritical = attack.critical;
      } else {
        // Обычный бросок (лечение или без цели)
        damageTotal = performSimpleRoll(bonusDiceFormulas);
      }

      if (props.onRoll) {
        props.onRoll(damageTotal, resolvedDamageType.value, attackSnapshot);
      }

      finishAttackRoll(attackSnapshot, attackLanded, attackCritical);
    } catch (err) {
      console.error(DICE_ROLL_LOG_PREFIX, err);

      // Бросок сорвался — закрытие ниже должно дойти до ждущего как отмена, а
      // не оставить его висеть. Если результат он всё же получил (упало уже
      // ПОСЛЕ коллбэка), лишняя отмена безвредна: промис решается один раз.
      hasRolled = false;
    } finally {
      isOpen.value = false;

      // Восстанавливаем
      chatStore.isPrivateRoll = prevPrivate;
      chatStore.isGmOnlyRoll = prevGmOnly;
    }
  }

  /**
   * Согласная цель: спасбросок не бросается и считается проваленным.
   *
   * По правилам согласие цели заменяет бросок целиком, поэтому здесь нет
   * броска вовсе — в чат уходит строка о согласии, а ждущему результат
   * отдаётся как провал с натуральной единицей.
   */
  function acceptWillingly(): void {
    hasRolled = true;

    if (!props.skipChatMessage) {
      chatStore.sendMessage(
        `${props.rollLabel}${DICE_ROLL_LABELS.outcomeWilling}`,
        'text',
      );
    }

    props.onCheckRoll?.({
      total: WILLING_SAVE_TOTAL,
      natural: WILLING_SAVE_TOTAL,
      modifier: 0,
      willing: true,
    });

    isOpen.value = false;
  }

  /**
   * Подробности удара для событий урона цели: крит и кто бил.
   *
   * @param critical - удар критом
   * @returns подробности удара
   */
  function buildHitDetails(critical: boolean): DamageHitDetails {
    if (!props.attackerId) {
      return { critical };
    }

    const ignoredResistances = resolveAttackerIgnoredResistances(
      props.attackerId,
    );

    return ignoredResistances.length > 0
      ? { critical, sourceId: props.attackerId, ignoredResistances }
      : { critical, sourceId: props.attackerId };
  }

  /**
   * Двухэтапная атака: бросок попадания → бросок урона.
   * Делегирует всю логику в performTwoStageAttack из attackUtils.
   *
   * @param targetAc - класс доспеха цели
   * @param bonusDiceFormulas - бонусы, зафиксированные до расхода эффектов
   * @param attack - снимок броска: его получает обработчик попадания
   * @returns урон броска, попал ли он и критически ли: попадание и крит уходят
   *   серверу вместе с событием броска — по ним работают части условия «атака
   *   попала» и удвоение костей урона срабатываний
   */
  function performAttackRoll(
    targetAc: number,
    bonusDiceFormulas: readonly string[],
    attack: AttackRollSnapshot | undefined,
  ): { total: number; landed: boolean; critical: boolean } {
    const attackMod =
      (props.attackModifier ?? 0)
      + bonusValue.value
      + currentConditionalBonuses.value.attackBonus;

    const attackFormula = buildAttackFormula(
      attackMod,
      attackRollMode.value,
      bonusDiceFormulas,
    );

    const targetName =
      targetStore.targetName ?? DICE_ROLL_LABELS.targetFallback;

    // Прикрепляем условный бонус урона к формуле урона, если он есть
    const damageBonus = currentConditionalBonuses.value.damageBonus;

    let finalDamageFormula = effectiveFormula.value ?? '';

    if (damageBonus !== 0 && finalDamageFormula) {
      finalDamageFormula += `${damageBonus > 0 ? '+' : ''}${damageBonus}`;
    }

    const attackOutput = performTwoStageAttack(
      {
        attackFormula,
        attackModifier: attackMod,
        targetAc,
        weaponName: props.rollLabel,
        targetName,
        damageFormula: finalDamageFormula,
        targetActorId: targetStore.targetActorId,
        targetFlags: targetStore.getTargetFlags(),
        critThreshold: props.critThreshold,
        damageType: resolvedDamageType.value,
      },
      (formula) => diceRollerStore.parseAndRoll(formula),
      (damage, isHealing, critical) =>
        targetStore.applyToTarget(
          damage,
          isHealing,
          resolvedDamageType.value,
          buildHitDetails(critical),
        ),
    );

    chatStore.sendMessage(attackFormula, 'roll', attackOutput.attackRoll);

    if (attackOutput.attackResult.isHit && props.onHit) {
      props.onHit(attack);
    }

    // Бросок урона показываем только ПОСЛЕ отображения броска атаки:
    // при включённых 3D-кубиках ждём окончания их анимации, иначе — короткую
    // паузу, чтобы результат d20 успел прочитаться. На промахе урона нет.
    if (attackOutput.damageRoll && finalDamageFormula) {
      const resultingDamageFormula = attackOutput.attackResult.isCriticalHit
        ? doubleDiceInFormula(finalDamageFormula)
        : finalDamageFormula;

      const damageRoll = attackOutput.damageRoll;

      // Сохраняем видимость броска (она будет сброшена в performRoll до того,
      // как сработает отложенная отправка урона).
      const wasPrivate = chatStore.isPrivateRoll;
      const wasGmOnly = chatStore.isGmOnlyRoll;

      void waitForAttackDisplay().then(() => {
        const prevPrivate = chatStore.isPrivateRoll;
        const prevGmOnly = chatStore.isGmOnlyRoll;

        chatStore.isPrivateRoll = wasPrivate;
        chatStore.isGmOnlyRoll = wasGmOnly;

        chatStore.sendMessage(resultingDamageFormula, 'roll', damageRoll);

        chatStore.isPrivateRoll = prevPrivate;
        chatStore.isGmOnlyRoll = prevGmOnly;
      });
    }

    return {
      total: attackOutput.damageRoll?.total ?? 0,
      landed: attackOutput.attackResult.isHit,
      critical: attackOutput.attackResult.isCriticalHit,
    };
  }

  /**
   * Ждёт, пока бросок атаки будет показан игроку, прежде чем кидать урон.
   * При включённых 3D-кубиках — до конца анимации, иначе — фиксированную паузу.
   */
  function waitForAttackDisplay(): Promise<void> {
    if (diceRollerStore.enable3dDice && diceRollerStore.isDiceBoxReady) {
      return diceRollerStore.waitForNextAnimation();
    }

    return promiseTimeout(ATTACK_RESULT_DELAY_MS);
  }

  /**
   * Обычный бросок (лечение или без цели)
   */
  function performSimpleRoll(bonusDiceFormulas: readonly string[]): number {
    let formula: string;

    /** Постоянная часть бонуса, к которой роллер добавит бонусные кости. */
    let checkModifier = 0;

    if (rollFormula.value) {
      // Суммируем введённый бонус пользователя + условный бонус на урон (если это бросок урона)
      // Если это просто "бросок формулы" не связанный с атакой (проверка хар-ки с кастомной формулой),
      // damageBonus будет 0 (т.к. targetKey будет attack.melee, а условия не выполнятся).
      const finalBonus =
        bonusValue.value + currentConditionalBonuses.value.damageBonus;

      if (finalBonus !== 0) {
        const sign = finalBonus >= 0 ? '+' : '-';

        formula = `${effectiveFormula.value ?? ''}${sign}${Math.abs(finalBonus)}`;
      } else {
        formula = effectiveFormula.value ?? '';
      }
    } else {
      checkModifier =
        props.modifier
        + bonusValue.value
        + currentConditionalBonuses.value.attackBonus;

      formula = buildAttackFormula(
        checkModifier,
        attackRollMode.value,
        bonusDiceFormulas,
      );
    }

    const rollData = diceRollerStore.parseAndRoll(formula);

    if (!props.isHealing && resolvedDamageType.value) {
      rollData.damageType = resolvedDamageType.value;
    }

    let rollLabel = props.rollLabel;

    if (!props.isHealing && resolvedDamageType.value) {
      const typeLabel = getShortDamageTypeLabel(resolvedDamageType.value);

      if (typeLabel) {
        rollLabel += ` (${typeLabel})`;
      }
    }

    // Автоприменение урона/лечения к цели (если не делегировано наружу)
    if (
      effectiveFormula.value
      && targetStore.targetActorId
      && !props.skipDamageApplication
    ) {
      const result = targetStore.applyToTarget(
        rollData.total,
        props.isHealing,
        resolvedDamageType.value,
        buildHitDetails(false),
      );

      if (result && !props.isHealing) {
        const tempAbsorbed = result.tempAbsorbed ?? 0;

        const totalDamage = result.hpBefore - result.hpAfter + tempAbsorbed;

        rollLabel += `${DICE_ROLL_LABELS.damageSuffixPrefix}${result.actorName} -${totalDamage} HP`;

        if (tempAbsorbed > 0) {
          rollLabel += `${DICE_ROLL_LABELS.tempAbsorbedPrefix}${tempAbsorbed}${DICE_ROLL_LABELS.tempAbsorbedSuffix}`;
        }

        rollLabel += formatDamageDefenseSuffix(result.defenseOutcome);
      }
    }

    if (props.autoFail) {
      rollLabel += DICE_ROLL_LABELS.outcomeAutoFail;
    } else if (props.targetDc !== undefined) {
      if (rollData.total >= props.targetDc) {
        rollLabel += DICE_ROLL_LABELS.outcomeSuccess;
      } else {
        rollLabel += DICE_ROLL_LABELS.outcomeFail;
      }
    }

    rollData.label = rollLabel;

    if (!props.skipChatMessage) {
      chatStore.sendMessage(formula, 'roll', rollData);
    }

    // Бонусные кости влияют на итог, но не изменяют натуральную оставленную d20.
    if (!rollFormula.value && props.onCheckRoll) {
      const natural = getNaturalD20Roll(rollData);

      props.onCheckRoll({
        total: rollData.total,
        natural,
        modifier: rollData.total - natural,
      });
    }

    return rollData.total;
  }

  /**
   * Катает части ПО ОЧЕРЕДИ (каждая — отдельная 3D-анимация фоном), собирает
   * разбивку и отдаёт её в `onRollParts`. Сам урон в чат не пишет — итоговое
   * сообщение формирует оркестратор (одно сообщение со всеми частями).
   *
   * @param parts - части урона/лечения
   * @param isCrit - крит (удваивает кубики урон-частей)
   * @param attack - снимок броска атаки: по нему разбор считает удар; нет —
   *   частям не предшествовал бросок попадания
   */
  async function rollPartsSequentially(
    parts: SpellDamagePartInput[],
    isCrit: boolean,
    attack?: AttackRollSnapshot,
  ): Promise<void> {
    const rolled: RolledSpellDamagePart[] = [];

    const use3d =
      diceRollerStore.enable3dDice && diceRollerStore.isDiceBoxReady;

    for (const part of parts) {
      let formula = part.formula;

      // Усиление высших кругов (ячейка) — к частям, помеченным applySlotScaling
      // (первая урон-часть; у per-target гейт-веток помечена каждая ветка,
      // к цели применяется только одна — двойного усиления нет).
      if (
        part.applySlotScaling
        && hasSpellCast.value
        && props.spellScalingDice
        && props.spellLevel !== undefined
        && selectedSpellLevel.value > props.spellLevel
      ) {
        formula = scaleDamageFormula(
          formula,
          props.spellScalingDice,
          props.spellLevel,
          selectedSpellLevel.value,
        );
      }

      // Крит удваивает кубики урона — не лечения и не вычета из урона
      if (isCrit && !part.isHealing && !isDeductionFormula(formula)) {
        formula = doubleDiceInFormula(formula);
      }

      // Вычет («−1к8 к урону») роллер читает только с нулём впереди
      const rollData = diceRollerStore.parseAndRoll(toRollerFormula(formula));

      // Анимируем эту часть и ждём её завершения — следующая полетит после
      if (use3d) {
        diceRollerStore.animateRoll({
          formula,
          total: rollData.total,
          dice: rollData.dice,
          details: '',
          label: props.rollLabel,
        });

        await diceRollerStore.waitForNextAnimation();
      }

      rolled.push({
        amount: rollData.total,
        formula,
        values: rollData.dice.flatMap((group) => group.values),
        type: part.type,
        types: part.types,
        isHealing: part.isHealing,
        healTemp: part.healTemp,
        target: part.target,
        requiresDamage: part.requiresDamage,
        targetGate: part.targetGate,
        targetTypeGate: part.targetTypeGate,
        targetStatusGate: part.targetStatusGate,
        critical: isCrit,
      });
    }

    rollOnRollParts.value?.(rolled, attack);
  }

  /**
   * Многочастный бросок без атаки (спасбросок / автопопадание / лечение):
   * части катаются по очереди, применение — через `onRollParts`.
   *
   * @param parts - части урона/лечения (включая бонус-части эффектов)
   */
  function performPartsRoll(parts: SpellDamagePartInput[]): void {
    void rollPartsSequentially(parts, false);
  }

  /**
   * Многочастная атака (заклинание или оружие): бросок попадания → на попадании
   * части катаются ПО ОЧЕРЕДИ (фоном, с удвоением кубиков на крите). На промахе —
   * урона нет. Итоговое сообщение со всеми частями формирует оркестратор.
   *
   * @param targetAc - класс доспеха цели
   * @param parts - части урона/лечения (включая бонус-части эффектов)
   * @param bonusDiceFormulas - бонусы попадания, не влияющие на урон
   * @param attack - снимок броска: цели — для сообщения серверу после урона,
   *   израсходованные эффекты — для разбора частей после показа броска
   */
  function performPartsAttackRoll(
    targetAc: number,
    parts: SpellDamagePartInput[],
    bonusDiceFormulas: readonly string[],
    attack: AttackRollSnapshot | undefined,
  ): void {
    const attackMod =
      (props.attackModifier ?? 0)
      + bonusValue.value
      + currentConditionalBonuses.value.attackBonus;

    const attackFormula = buildAttackFormula(
      attackMod,
      attackRollMode.value,
      bonusDiceFormulas,
    );

    const targetName =
      targetStore.targetName ?? DICE_ROLL_LABELS.targetFallback;

    // Только бросок попадания (без урона) — получаем hit/crit
    const attackOutput = performTwoStageAttack(
      {
        attackFormula,
        attackModifier: attackMod,
        targetAc,
        weaponName: props.rollLabel,
        targetName,
        targetActorId: targetStore.targetActorId,
        targetFlags: targetStore.getTargetFlags(),
        critThreshold: props.critThreshold,
      },
      (formula) => diceRollerStore.parseAndRoll(formula),
    );

    chatStore.sendMessage(attackFormula, 'roll', attackOutput.attackRoll);

    if (attackOutput.attackResult.isHit && props.onHit) {
      props.onHit(attack);
    }

    // На промахе урона нет
    if (!attackOutput.attackResult.isHit) {
      finishAttackRoll(attack, false);

      return;
    }

    const isCrit = attackOutput.attackResult.isCriticalHit;

    // Сначала показываем бросок атаки, затем по очереди — части урона; сервер
    // узнаёт о броске после урона. За время показа ответ сервера убирает
    // израсходованные эффекты из мира — части разбираются по снимку броска
    void waitForAttackDisplay()
      .then(() => rollPartsSequentially(parts, isCrit, attack))
      .then(() => finishAttackRoll(attack, true, isCrit));
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="380"
    :min-height="280"
    :title="title"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Индикатор автопровала -->
        <UAlert
          v-if="autoFail"
          color="error"
          variant="soft"
          icon="tabler:skull"
          :title="DICE_ROLL_LABELS.autoFail"
          :description="DICE_ROLL_LABELS.autoFailHint"
        />

        <!-- Секция каста заклинания -->
        <div
          v-if="hasSpellCast"
          class="space-y-2"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ DICE_ROLL_LABELS.spellLevel }}
          </span>

          <USelect
            v-model.number="selectedSpellLevel"
            :items="spellLevelItems"
            value-key="value"
            class="w-full"
            :disabled="spellLevelLocked"
            @change="usePactSlot = false"
          />

          <p
            v-if="spellLevelLocked"
            class="text-xs text-dimmed"
          >
            {{ DICE_ROLL_LABELS.spellLevelLocked }}
          </p>

          <UCheckbox
            v-model="consumeSpellSlot"
            :label="DICE_ROLL_LABELS.consumeSlot"
          />

          <UCheckbox
            v-if="canUsePactSlot && consumeSpellSlot"
            v-model="usePactSlot"
            :label="DICE_ROLL_LABELS.usePactSlot"
          />

          <div
            v-if="
              spellScalingDice
              && spellLevel !== undefined
              && selectedSpellLevel > spellLevel
            "
            class="rounded border border-primary/20 bg-primary/10 p-2 text-xs text-primary"
          >
            <strong>{{ DICE_ROLL_LABELS.scalingPrefix }}</strong> +{{
              spellScalingDice
            }}
            {{ DICE_ROLL_LABELS.scalingSuffix }}
          </div>
        </div>

        <!-- Выбор типа урона (для заклинаний с damageType: 'choice') -->
        <div
          v-if="isDamageTypeChoice && damageTypeOptions.length > 0"
          class="space-y-2"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ DICE_ROLL_LABELS.damageType }}
          </span>

          <USelect
            v-model="selectedChoiceDamageType"
            :items="damageTypeOptions"
            value-key="value"
            class="w-full"
          />
        </div>

        <!-- Набор урона «или» у действия существа -->
        <div
          v-if="damageVariantItems.length > 0"
          class="space-y-2"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ DICE_ROLL_LABELS.damageVariant }}
          </span>

          <USelect
            :model-value="selectedDamageVariantIndex"
            :items="damageVariantItems"
            value-key="value"
            class="w-full"
            @update:model-value="selectDamageVariant"
          />
        </div>

        <!-- Тип урона на выбор у частей (`@dmg.choice(…)`) -->
        <div
          v-for="row in partTypeChoiceRows"
          :key="row.key"
          class="space-y-2"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ DICE_ROLL_LABELS.damageType }}
          </span>

          <USelect
            :model-value="row.value"
            :items="row.items"
            value-key="value"
            class="w-full"
            @update:model-value="selectPartType(row.key, $event)"
          />
        </div>

        <!-- Формула (скрыта при skipRoll — самобафф без броска) -->
        <div
          v-if="!skipRoll"
          class="rounded-lg bg-elevated/50 p-3 text-center"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ DICE_ROLL_LABELS.formula }}
          </span>

          <div class="mt-1 font-mono text-lg font-bold text-highlighted">
            {{ displayFormula }}
            <span
              v-if="bonusValue !== 0"
              class="text-primary"
            >
              {{
                bonusValue >= 0
                  ? `+ ${bonusValue}`
                  : `− ${Math.abs(bonusValue)}`
              }}
            </span>
          </div>
        </div>

        <!-- Бонус (скрыт при skipRoll — самобафф без броска) -->
        <div
          v-if="!skipRoll"
          class="space-y-2"
        >
          <span class="text-sm text-toned">{{
            DICE_ROLL_LABELS.extraBonus
          }}</span>

          <UInput
            :model-value="bonusValue"
            type="number"
            size="sm"
            class="w-full"
            placeholder="0"
            @update:model-value="bonusValue = Number($event)"
          />
        </div>

        <!-- Режим броска (атаки с целью, серия атак снарядов, стандартные d20
             проверки); при skipRoll броска нет — секцию скрываем -->
        <div
          v-if="showRollModeSection"
          class="space-y-2"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ DICE_ROLL_LABELS.rollMode }}
          </span>

          <div class="grid grid-cols-3 gap-2">
            <UButton
              variant="soft"
              :color="attackRollMode === 'normal' ? 'primary' : 'neutral'"
              size="sm"
              block
              @click.left.exact.prevent="attackRollMode = 'normal'"
            >
              {{ DICE_ROLL_LABELS.rollModeNormal }}
            </UButton>

            <UButton
              variant="soft"
              :color="attackRollMode === 'advantage' ? 'success' : 'neutral'"
              size="sm"
              block
              @click.left.exact.prevent="attackRollMode = 'advantage'"
            >
              <UIcon
                name="tabler:arrow-big-up-filled"
                class="mr-1 h-4 w-4"
              />
              {{ DICE_ROLL_LABELS.rollModeAdvantage }}
            </UButton>

            <UButton
              variant="soft"
              :color="attackRollMode === 'disadvantage' ? 'error' : 'neutral'"
              size="sm"
              block
              @click.left.exact.prevent="attackRollMode = 'disadvantage'"
            >
              <UIcon
                name="tabler:arrow-big-down-filled"
                class="mr-1 h-4 w-4"
              />
              {{ DICE_ROLL_LABELS.rollModeDisadvantage }}
            </UButton>
          </div>

          <p
            v-for="line in rollModeReasonLines"
            :key="line"
            class="text-xs text-muted"
          >
            {{ line }}
          </p>
        </div>

        <!-- Разделитель -->
        <div
          v-if="!skipRoll"
          class="border-t border-muted"
        />

        <!-- Кто увидит (нет броска при skipRoll — секция не нужна) -->
        <div
          v-if="!skipRoll"
          class="space-y-2"
        >
          <span class="text-xs tracking-wider text-muted uppercase">
            {{ DICE_ROLL_LABELS.visibility }}
          </span>

          <div class="grid grid-cols-3 gap-2">
            <UButton
              variant="soft"
              :color="rollType === 'public' ? 'primary' : 'neutral'"
              size="sm"
              block
              @click.left.exact.prevent="rollType = 'public'"
            >
              <UIcon
                name="tabler:users"
                class="mr-1 h-4 w-4"
              />
              {{ DICE_ROLL_LABELS.visibilityAll }}
            </UButton>

            <UButton
              variant="soft"
              :color="rollType === 'gm' ? 'primary' : 'neutral'"
              size="sm"
              block
              @click.left.exact.prevent="rollType = 'gm'"
            >
              <UIcon
                name="tabler:shield"
                class="mr-1 h-4 w-4"
              />
              {{ DICE_ROLL_LABELS.visibilityGm }}
            </UButton>

            <UButton
              variant="soft"
              :color="rollType === 'private' ? 'warning' : 'neutral'"
              size="sm"
              block
              @click.left.exact.prevent="rollType = 'private'"
            >
              <UIcon
                name="tabler:eye-off"
                class="mr-1 h-4 w-4"
              />
              {{ DICE_ROLL_LABELS.visibilityPrivate }}
            </UButton>
          </div>
        </div>

        <!-- Кнопка броска -->
        <UButton
          color="primary"
          size="lg"
          block
          @click.left.exact.prevent="performRoll"
        >
          <UIcon
            name="tabler:dice-filled"
            class="mr-2 h-5 w-5"
          />
          {{ effectiveRollButtonText }}
        </UButton>

        <!-- Согласная цель: спасбросок не бросается вовсе -->
        <UButton
          v-if="allowWilling"
          color="neutral"
          variant="soft"
          size="md"
          block
          :title="DICE_ROLL_LABELS.willingHint"
          @click.left.exact.prevent="acceptWillingly"
        >
          <UIcon
            name="tabler:hand-stop"
            class="mr-2 h-4 w-4"
          />
          {{ DICE_ROLL_LABELS.willing }}
        </UButton>
      </div>
    </template>
  </UDraggableModal>
</template>
