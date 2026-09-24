import type { AbilityType, SceneEntity } from '@vtt/shared';
import type {
  ActiveEffect,
  AdjacentAllyState,
  CarrierContext,
  CreatureAction,
  CreatureCategory,
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
  EffectTargetKey,
  ResolvedActorStats,
  RollContext,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { SpellDamagePartInput } from './useSpellResolution';

import { useTargetStore } from '@/stores/targetStore';
/**
 * Композабл бонус-частей урона от Active Effects (оружие и заклинания).
 *
 * Кость-формулы в ключах `damage.melee`/`damage.ranged`/`damage.spell` (напр.
 * «2к6@dmg.fire@target.full») не входят в плоские статы пайплайна — они
 * катаются отдельными частями урона в многочастном пути. Композабл решает,
 * нужно ли броску идти многочастным путём, и собирает части в момент броска
 * (условия преимущества/помехи и HP цели оцениваются по фактическому
 * контексту, выбранному в модалке).
 *
 * Используется тремя точками броска: вкладкой снаряжения листа персонажа,
 * хотбар-макросом `weapon-attack` и обоими путями каста заклинаний.
 */
import {
  buildCarrierContext,
  buildFormulaContext,
  buildPseudoSpell,
  calculateWeaponDamageModifier,
  collectBonusDamageFormulas,
  describeDamagePart,
  entityHasWeaponMastery,
  getCreatureSpellMod,
  getDamageBonusKey,
  getWeaponDamageParts,
  getWeaponPrimaryDamageType,
  hasBonusDamageFormulas,
  isDnDEffect,
  isDndSceneEntity,
  listEnabledEffects,
  listEntityMarkSources,
  resolveBonusDamageParts,
  resolveCreatureDamageParts,
  resolveCreatureSpellDamageParts,
  resolveDamagePartsForCast,
  resolveEntityCreatureType,
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveSpellDamageFormula,
  substituteFormulaVariables,
  withFlatDamageBonus,
} from '@vtt/shared/system/dnd.js';

import { findAlliesAdjacentToTarget } from './targetAllyAdjacent';

/** Контекст броска из модалки (фактический режим преимущества/помехи) */
interface ModalRollContext {
  hasAdvantage: boolean;
  hasDisadvantage: boolean;
}

/** Roll-time сборщик бонус-частей (проп DiceRollModal) */
type BonusPartsEvaluator = (
  context: ModalRollContext,
) => SpellDamagePartInput[];

/** Параметры сборки многочастного броска оружия */
interface WeaponRollSetupOptions {
  /** Оружие */
  weapon: DnDGameItem;
  /** Владелец оружия — персонаж или существо (для @-переменных в формулах) */
  actor: DnDSceneEntity;
  /** Активные эффекты владельца (включая ауры) */
  effects: readonly ActiveEffect[];
  /** Итоговые статы (для @mod.* и статического урона с учётом эффектов) */
  resolvedStats?: ResolvedActorStats;
  /**
   * Полнота HP выбранной цели для токенов `@target.full`/`@target.notFull`.
   * `undefined` (нет цели) — части раскладываются на per-target гейт-ветки.
   */
  targetIsFull?: boolean;
  /**
   * Тип существа выбранной цели для токенов `@target.type.<тип>`.
   * `undefined` (нет цели / AoE) — части раскладываются на per-target гейт-ветки.
   */
  targetType?: CreatureCategory;
}

/** Результат сборки многочастного броска оружия */
interface WeaponRollSetup {
  /** Базовая часть урона оружия (формула + тип) */
  baseParts: SpellDamagePartInput[];
  /** Roll-time сборщик бонус-частей от эффектов (для DiceRollModal) */
  evaluateBonusDamageParts: BonusPartsEvaluator;
  /**
   * Псевдо-заклинание для оркестратора `resolveSpellDamageWithParts`:
   * без спасброска и эффектов, имя — для подписи в чате. Позволяет
   * переиспользовать многочастный движок применения (защиты по типу на
   * каждую часть, per-target гейты, единый HP-апдейт) без отдельного
   * оружейного оркестратора.
   */
  pseudoSpell: Spell;
}

/** Параметры сборки многочастного броска действия существа */
interface CreatureRollSetupOptions {
  /** Действие существа (с damageParts/saveType/areaOfEffect) */
  action: CreatureAction;
  /** Существо-источник (для casterId, эффектов и @-переменных в формулах) */
  creature: DnDCreature;
  /** Активные эффекты существа (включая ауры) */
  effects: readonly ActiveEffect[];
  /**
   * Полнота HP выбранной цели для токенов `@target.full`/`@target.notFull`.
   * `undefined` (нет цели / AoE) — части раскладываются на per-target гейт-ветки.
   */
  targetIsFull?: boolean;
  /**
   * Тип существа выбранной цели для токенов `@target.type.<тип>`.
   * `undefined` (нет цели / AoE) — части раскладываются на per-target гейт-ветки.
   */
  targetType?: CreatureCategory;
}

/** Результат сборки многочастного броска действия существа */
interface CreatureRollSetup {
  /** Базовые части урона действия (формулы существа, без инъекции модификатора) */
  baseParts: SpellDamagePartInput[];
  /** Roll-time сборщик бонус-частей от эффектов (для DiceRollModal) */
  evaluateBonusDamageParts: BonusPartsEvaluator;
  /** Псевдо-заклинание для оркестратора (saveType/saveEffect/areaOfEffect действия) */
  pseudoSpell: Spell;
}

/** Параметры сборки многочастного броска заклинания существа */
interface CreatureSpellRollSetupOptions {
  /** Заклинание существа (готовый «псевдо-спелл»: damageParts/saveType/areaOfEffect) */
  spell: Spell;
  /** Существо-заклинатель (для casterId, эффектов и @mod.spell в формулах) */
  creature: DnDCreature;
  /** Активные эффекты существа (включая ауры) */
  effects: readonly ActiveEffect[];
  /**
   * Полнота HP выбранной цели для токенов `@target.full`/`@target.notFull`.
   * `undefined` (нет цели / AoE) — части раскладываются на per-target гейт-ветки.
   */
  targetIsFull?: boolean;
  /**
   * Тип существа выбранной цели для токенов `@target.type.<тип>`.
   * `undefined` (нет цели / AoE) — части раскладываются на per-target гейт-ветки.
   */
  targetType?: CreatureCategory;
  /**
   * Заклинательная характеристика блока, из которого идёт каст. У блока она
   * своя («Магия шабаша» карги считается от Интеллекта), и без неё токен
   * `@mod.spell` посчитался бы от характеристики самого существа.
   */
  spellcastingAbility?: AbilityType;
}

/** Параметры сборщика бонус-частей урона заклинания */
interface SpellBonusEvaluatorOptions {
  /** Заклинание */
  spell: Spell;
  /** Актор-заклинатель */
  actor: DnDActor;
  /** Активные эффекты заклинателя (включая ауры) */
  effects: readonly ActiveEffect[];
  /** Итоговые статы (для @mod.* с учётом эффектов) */
  resolvedStats?: ResolvedActorStats;
  /**
   * Каст без единой цели (AoE-шаблон или распределение снарядов): условия
   * `target.hp.*` в поле condition откладываются в per-target гейт, а токены
   * `@target.*` в формуле раскладываются на гейт-ветки — оркестратор фильтрует
   * их по HP каждой цели в момент применения.
   */
  multiTarget: boolean;
}

/**
 * Разрешает @-переменные сегмента бонус-формулы. Сегмент без `@` разрешать
 * нечего — он уходит как есть; невалидный не валит бросок, а пропускается с
 * предупреждением: иначе в чат уехала бы строка формулы вместо числа.
 *
 * @param subFormula - сегмент формулы бонус-урона
 * @param source - чья это формула, для предупреждения («оружия», «существа»)
 * @param resolve - разрешение сегмента в контексте своего пути броска
 * @returns формула для роллера или пустая строка (пропуск сегмента)
 */
function resolveBonusFormula(
  subFormula: string,
  source: string,
  resolve: (formula: string) => string,
): string {
  if (!subFormula.includes('@')) {
    return subFormula;
  }

  try {
    return resolve(subFormula);
  } catch (error) {
    console.warn(
      `[BonusDamageParts] Невалидная формула бонус-урона ${source}:`,
      subFormula,
      error,
    );

    return '';
  }
}

/**
 * Есть ли у владельца кость-формулы бонус-урона для этого оружия.
 * Определяет, идёт ли бросок многочастным путём (иначе — прежний
 * одноформульный, нулевое изменение поведения).
 *
 * @param weapon - оружие
 * @param effects - активные эффекты владельца
 * @returns true если бросок должен идти многочастным путём
 */
export function hasWeaponBonusDamage(
  weapon: DnDGameItem,
  effects: readonly ActiveEffect[],
): boolean {
  return hasBonusDamageFormulas(
    effects,
    getDamageBonusKey(weapon.rangeType),
    weapon.id,
  );
}

/**
 * Есть ли у заклинателя кость-формулы бонус-урона заклинаний.
 *
 * @param effects - активные эффекты заклинателя
 * @returns true если каст должен идти многочастным путём
 */
export function hasSpellBonusDamage(effects: readonly ActiveEffect[]): boolean {
  return hasBonusDamageFormulas(effects, 'damage.spell');
}

/**
 * Собирает плоский бонус урона заклинаниями отдельной бонус-частью каста.
 *
 * Нужна СНАРЯДАМ (Волшебная стрела, Мистический заряд): их формула урона
 * катается на каждый снаряд, и влить бонус в неё значило бы дать «+2 за
 * снаряд». Бонус-части устроены иначе — они катаются один раз на каст и
 * применяются каждой задетой цели по разу, что и требует правило PHB 2024
 * «плоский бонус применяется один раз к броску».
 *
 * @param parts - бонус-части, собранные из кость-формул эффектов
 * @param flatBonus - плоский бонус урона заклинаниями (0 — ничего не добавлять)
 * @returns бонус-части вместе с плоским бонусом
 */
export function withFlatDamageBonusPart(
  parts: SpellDamagePartInput[],
  flatBonus: number,
): SpellDamagePartInput[] {
  if (flatBonus === 0) {
    return parts;
  }

  return [
    ...parts,
    {
      formula: String(flatBonus),
      isHealing: false,
      target: 'selected',
      requiresDamage: false,
    },
  ];
}

/**
 * Композабл бонус-частей урона от Active Effects.
 */
export function useBonusDamageParts() {
  const targetStore = useTargetStore();

  /**
   * Цель броска для условий `target.*` (читается в момент вызова): хиты, тип,
   * метки и — если известен бросающий — союзник бросающего рядом с целью.
   *
   * @param targetEntity - назначенная цель; без аргумента используется выбранный токен
   * @param attackerId - бросающий; без него «союзник рядом» не считается
   * @returns цель для условий или undefined (цели/HP нет)
   */
  function buildTargetHpContext(
    targetEntity?: SceneEntity | null,
    attackerId?: string,
  ):
    | {
        currentHp: number;
        maxHp: number;
        creatureType?: CreatureCategory;
        markedBy: string[];
        entityId: string;
        adjacentAllies?: readonly AdjacentAllyState[];
      }
    | undefined {
    const entity =
      targetEntity === undefined ? targetStore.getTargetActor() : targetEntity;

    if (!entity) {
      return undefined;
    }

    // Ядро видит entity как Base*; D&D-форму подтверждает гвард
    if (!isDndSceneEntity(entity)) {
      return undefined;
    }

    return {
      entityId: entity.id,
      // Союзник бросающего рядом с целью — для «Тактики стаи»; без бросающего
      // считать не от кого
      adjacentAllies: attackerId
        ? findAlliesAdjacentToTarget(attackerId, entity.id)
        : undefined,
      currentHp: resolveEntityCurrentHp(entity),
      maxHp: resolveEntityMaxHp(entity),
      // Тип цели — для условий `target.creatureType` и токенов `@target.type.*`:
      // читается с той же сущности, отдельного источника цели заводить незачем
      creatureType: resolveEntityCreatureType(entity),
      // Кто пометил цель — для условия «цель помечена мной» (Метка охотника)
      markedBy: listEntityMarkSources(entity),
    };
  }

  /**
   * Тип существа текущей цели (читается в момент вызова).
   *
   * @returns канонический тип цели либо undefined (цели нет / тип неизвестен)
   */
  function buildTargetTypeContext(): CreatureCategory | undefined {
    const entity = targetStore.getTargetActor();

    if (!entity || !isDndSceneEntity(entity)) {
      return undefined;
    }

    return resolveEntityCreatureType(entity);
  }

  /**
   * Собирает бонус-части по контексту броска: условия change оцениваются по
   * фактическому режиму и HP цели, формулы раскладываются на гейт-ветки и
   * типизированные сегменты.
   *
   * Без единой цели (`useTargetState: false` — AoE/снаряды) условия
   * `target.hp.*` и токены `@target.*` не гасятся, а откладываются в
   * per-target гейты (`targetGate`) — их оценивает оркестратор по HP
   * каждой цели в момент применения.
   *
   * @param effects - активные эффекты
   * @param damageKey - ключ урона (damage.melee/ranged/spell)
   * @param modalContext - режим броска из модалки
   * @param defaultType - тип урона сегментов без токена @dmg
   * @param useTargetState - оценивать ли состояние единой цели (false для AoE/снарядов)
   * @param resolveFormula - резолвер @-переменных сегмента
   * @param carrier - свойства носителя эффектов (для условий `self.*`)
   * @returns бонус-части урона
   */
  function collectParts(
    effects: readonly ActiveEffect[],
    damageKey: EffectTargetKey,
    modalContext: ModalRollContext,
    defaultType: string | undefined,
    useTargetState: boolean,
    resolveFormula: (subFormula: string) => string,
    carrier: CarrierContext,
    itemId?: string,
  ): SpellDamagePartInput[] {
    const targetHp = useTargetState
      ? buildTargetHpContext(undefined, carrier.entityId)
      : undefined;

    const rollContext: RollContext = {
      hasAdvantage: modalContext.hasAdvantage,
      hasDisadvantage: modalContext.hasDisadvantage,
      target: targetHp,
      // Кость-формулы с условием о носителе в плоские статы не попадают —
      // здесь эти условия и оцениваются
      self: carrier,
      // Предмет броска: по нему работает «только этим предметом»
      ...(itemId === undefined ? {} : { itemId }),
    };

    const formulas = collectBonusDamageFormulas(
      effects,
      damageKey,
      rollContext,
    );

    const targetIsFull = targetHp
      ? targetHp.currentHp >= targetHp.maxHp
      : undefined;

    return resolveBonusDamageParts(
      formulas,
      defaultType,
      targetIsFull,
      resolveFormula,
      targetHp?.creatureType,
    );
  }

  /**
   * Собирает данные многочастного броска оружия: базовую часть, roll-time
   * сборщик бонус-частей и псевдо-заклинание для оркестратора.
   *
   * @param options - оружие, актор, эффекты и базовая формула урона
   * @returns данные для DiceRollModal и resolveSpellDamageWithParts
   */
  function buildWeaponRollSetup(
    options: WeaponRollSetupOptions,
  ): WeaponRollSetup {
    const { weapon, actor, effects, resolvedStats, targetIsFull, targetType } =
      options;

    const damageKey = getDamageBonusKey(weapon.rangeType);
    const defaultType = getWeaponPrimaryDamageType(weapon);

    const pseudoSpell = buildPseudoSpell({
      id: `weapon-roll-${weapon.id}`,
      name: weapon.name,
      rollSource: 'weapon',
      weaponMastery: entityHasWeaponMastery(actor, weapon),
      deliveryType: weapon.rangeType === 'ranged' ? 'ranged' : 'melee',
      saveType: weapon.saveType ?? 'none',
      saveEffect: weapon.saveEffect,
      // Эффекты оружия (статус/доп.урон со своим applySave) обрабатывает
      // оркестратор per-target — тем же путём, что и у заклинаний/существ.
      activeEffects: weapon.activeEffects?.filter(isDnDEffect),
    });

    // Базовые части урона оружия через тот же резолвер, что и заклинания
    // (versatile-хват применён в getWeaponDamageParts; @-переменные, @dmg/@heal/
    // @target-токены и per-target гейты разворачиваются внутри).
    const resolvedParts: SpellDamagePartInput[] = resolveDamagePartsForCast(
      pseudoSpell,
      actor,
      getWeaponDamageParts(weapon),
      resolvedStats,
      targetIsFull,
      targetType,
    );

    // Статический урон оружия (мод. характеристики + магический бонус + свои
    // бонусы оружия + плоские бонусы эффектов) вливается в первую урон-часть —
    // как и прежде у одиночной формулы; ability-мод не дублируется на
    // дополнительные части урона.
    const flatDamageMod = calculateWeaponDamageModifier(
      actor,
      weapon,
      resolvedStats,
    );

    const baseParts = withFlatDamageBonus(resolvedParts, flatDamageMod);

    const formulaContext = buildFormulaContext(actor);

    // Контекст тот же, что у основной формулы урона: @mod.<abil>, @prof,
    // @level (@mod.spell у оружия недоступен — нет контекста заклинания)
    const resolveFormula = (subFormula: string): string =>
      resolveBonusFormula(subFormula, 'оружия', (formula) =>
        substituteFormulaVariables(formula, formulaContext),
      );

    const evaluateBonusDamageParts: BonusPartsEvaluator = (modalContext) =>
      collectParts(
        effects,
        damageKey,
        modalContext,
        defaultType,
        true,
        resolveFormula,
        buildCarrierContext(actor),
        weapon.id,
      );

    return { baseParts, evaluateBonusDamageParts, pseudoSpell };
  }

  /**
   * Собирает roll-time сборщик бонус-частей урона заклинания
   * (ключ `damage.spell`) для передачи в DiceRollModal.
   *
   * @param options - заклинание, актор, эффекты, статы и признак мультицели
   * @returns сборщик бонус-частей для DiceRollModal
   */
  function buildSpellBonusEvaluator(
    options: SpellBonusEvaluatorOptions,
  ): BonusPartsEvaluator {
    const { spell, actor, effects, resolvedStats, multiTarget } = options;

    // Спелл-резолвер знает @mod.spell и сам снимает токены типа урона
    const resolveFormula = (subFormula: string): string =>
      resolveBonusFormula(subFormula, 'заклинания', (formula) =>
        resolveSpellDamageFormula(spell, actor, formula, resolvedStats),
      );

    return (modalContext) =>
      collectParts(
        effects,
        'damage.spell',
        modalContext,
        undefined,
        !multiTarget,
        resolveFormula,
        buildCarrierContext(actor),
      );
  }

  /**
   * Собирает данные многочастного броска ДЕЙСТВИЯ СУЩЕСТВА: базовые части
   * (плоские формулы существа), roll-time сборщик бонус-частей от эффектов и
   * псевдо-заклинание для оркестратора.
   *
   * Отличие от оружия: модификатор НЕ вливается автоматически (у существ он уже
   * вшит в формулу, напр. «1к8 + 3»), бонус атаки и DC спасброска плоские.
   * Псевдо-заклинание несёт `saveType`/`saveEffect`/`areaOfEffect` действия —
   * оркестратор кидает спасброски целей (одиночная цель или AoE-шаблон) штатно.
   *
   * @param options - действие, существо-источник, эффекты и состояние цели
   * @returns данные для DiceRollModal и resolveSpellDamageWithParts
   */
  function buildCreatureRollSetup(
    options: CreatureRollSetupOptions,
  ): CreatureRollSetup {
    const { action, creature, effects, targetIsFull, targetType } = options;

    const damageKey = getDamageBonusKey(action.rangeType);

    const baseDamageParts = action.damageParts ?? [];

    const defaultType = baseDamageParts[0]
      ? describeDamagePart(baseDamageParts[0]).types[0]
      : undefined;

    const pseudoSpell = buildPseudoSpell({
      id: `creature-action-${creature.id}-${action.name}`,
      name: action.name,
      rollSource: 'creatureAction',
      targetType: action.areaOfEffect ? 'area' : 'creature',
      deliveryType: action.rangeType === 'ranged' ? 'ranged' : 'melee',
      saveType: action.saveType ?? 'none',
      saveEffect: action.saveEffect,
      areaOfEffect: action.areaOfEffect,
      // Эффекты действия (статус/доп.урон со своим applySave) обрабатывает
      // оркестратор per-target — тем же путём, что и у заклинаний/оружия.
      // Оркестратор разбирает эффекты действия по каждой задетой цели —
      // выключенные до него не доходят
      activeEffects: listEnabledEffects(action.activeEffects),
    });

    // Базовые части через тот же движок сегментации (@dmg/@heal/@target),
    // что и заклинания/оружие — без инъекции модификатора характеристики.
    const baseParts: SpellDamagePartInput[] = resolveCreatureDamageParts(
      baseDamageParts,
      targetIsFull,
      creature,
      targetType,
    );

    const formulaContext = buildFormulaContext(creature);

    const resolveFormula = (subFormula: string): string =>
      resolveBonusFormula(subFormula, 'существа', (formula) =>
        substituteFormulaVariables(formula, formulaContext),
      );

    const evaluateBonusDamageParts: BonusPartsEvaluator = (modalContext) =>
      collectParts(
        effects,
        damageKey,
        modalContext,
        defaultType,
        true,
        resolveFormula,
        buildCarrierContext(creature),
      );

    return { baseParts, evaluateBonusDamageParts, pseudoSpell };
  }

  /**
   * Собирает данные многочастного броска ЗАКЛИНАНИЯ СУЩЕСТВА. В отличие от
   * действий, источник — настоящее заклинание (его `saveType`/`saveEffect`/
   * `areaOfEffect`/`deliveryType` используются напрямую), а токен `@mod.spell`
   * в формулах подставляется из заклинательной характеристики существа.
   * DC спасброска и бонус атаки — плоские из `creature.system.spellcasting`.
   *
   * @param options - заклинание, существо-источник, эффекты и состояние цели
   * @returns данные для DiceRollModal и resolveSpellDamageWithParts
   */
  function buildCreatureSpellRollSetup(
    options: CreatureSpellRollSetupOptions,
  ): CreatureRollSetup {
    const {
      spell,
      creature,
      effects,
      targetIsFull,
      targetType,
      spellcastingAbility,
    } = options;

    const baseDamageParts = spell.damageParts ?? [];

    const defaultType = baseDamageParts[0]
      ? describeDamagePart(baseDamageParts[0]).types[0]
      : undefined;

    // Клон заклинания как псевдо-спелл: свои эффекты для save/area-пути, не
    // трогая сохранённое заклинание существа. Эффекты всегда идут через
    // оркестратор — он отбирает эффекты на цель, бросает их спасбросок и урон;
    // прямое наложение при попадании кидало на цель ВСЕ эффекты (и «себе»)
    // мимо спасброска
    const pseudoSpell: Spell = {
      ...spell,
      activeEffects: listEnabledEffects(spell.activeEffects),
    };

    const spellMod = getCreatureSpellMod(creature, spellcastingAbility);

    const baseParts: SpellDamagePartInput[] = resolveCreatureSpellDamageParts(
      baseDamageParts,
      targetIsFull,
      creature,
      spellMod,
      targetType,
    );

    const formulaContext = buildFormulaContext(creature);

    // У заклинания существа в контексте есть ещё и @mod.spell
    const resolveFormula = (subFormula: string): string =>
      resolveBonusFormula(subFormula, 'существа', (formula) =>
        substituteFormulaVariables(formula, { ...formulaContext, spellMod }),
      );

    const evaluateBonusDamageParts: BonusPartsEvaluator = (modalContext) =>
      collectParts(
        effects,
        'damage.spell',
        modalContext,
        defaultType,
        true,
        resolveFormula,
        buildCarrierContext(creature),
      );

    return { baseParts, evaluateBonusDamageParts, pseudoSpell };
  }

  return {
    hasWeaponBonusDamage,
    hasSpellBonusDamage,
    buildWeaponRollSetup,
    buildCreatureRollSetup,
    buildCreatureSpellRollSetup,
    buildSpellBonusEvaluator,
    buildTargetHpContext,
    buildTargetTypeContext,
  };
}
