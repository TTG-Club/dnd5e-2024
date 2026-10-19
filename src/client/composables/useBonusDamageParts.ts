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
  FormulaContext,
  ResolvedActorStats,
  RollContext,
  SneakAttackDoubleSave,
  SneakAttackOption,
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
  addDiceToFormula,
  buildCarrierContext,
  buildPseudoSpell,
  buildSneakAttackOptionTargetEffect,
  calculateWeaponDamageModifier,
  collectBonusDamageFormulas,
  countFormulaDice,
  entityHasDamageStatus,
  entityHasWeaponMastery,
  getCreatureSpellMod,
  getDamageBonusKey,
  getDamagePartsPrimaryType,
  getWeaponDamageParts,
  getWeaponPrimaryDamageType,
  hasBonusDamageFormulas,
  hasSneakAttackSource,
  isDnDEffect,
  isDndSceneEntity,
  isUseActivatedEffect,
  listEnabledEffects,
  listEntityMarkSources,
  listSneakAttackOptions,
  passesLandingCondition,
  pickSneakAttackOptions,
  readSneakAttackAutoAdd,
  resolveBonusDamageParts,
  resolveCreatureDamageParts,
  resolveCreatureSpellDamageParts,
  resolveCunningStrikeLimit,
  resolveDamagePartsForCast,
  resolveEntityCreatureType,
  resolveEntityCurrentHp,
  resolveEntityExtraCreatureTypes,
  resolveEntityMaxHp,
  resolveSneakAttack,
  resolveSneakAttackDoubleSave,
  resolveSneakAttackMinDie,
  resolveSpellDamageFormula,
  SNEAK_ATTACK_LABEL,
  substituteFormulaVariables,
  sumSneakAttackOptionCost,
  withFlatDamageBonus,
} from '@vtt/shared/system/dnd.js';

import { hasEntityActedInCombat, resolveCombatRound } from './encounterTurn';
import {
  canAffordSneakAttackOption,
  isSneakAttackSpentNow,
  paySneakAttackOptions,
  spendSneakAttack,
} from './sneakAttackUsage';
import { findAlliesAdjacentToTarget } from './targetAllyAdjacent';
import { buildEntityFormulaContext } from './useResolvedStats';

/**
 * Приёмы Скрытой атаки бросающего в этом броске. Без выбранной цели их нет:
 * эффекты приёмов доставить некому — попадание и урон решает ведущий вне
 * системы, и кости с ресурсом ушли бы впустую.
 *
 * @param owner - бросающий
 * @param effects - его действующие эффекты (с аурами)
 * @param rollContext - контекст броска
 * @param formulaContext - числа бросающего
 * @returns приёмы; без цели — пусто
 */
function listTargetedSneakAttackOptions(
  owner: DnDSceneEntity,
  effects: readonly ActiveEffect[],
  rollContext: RollContext,
  formulaContext: FormulaContext,
): SneakAttackOption[] {
  return rollContext.target
    ? listSneakAttackOptions(
        withOwnUseButtons(owner, effects),
        rollContext,
        formulaContext,
      )
    : [];
}

/** Доступность приёма в этом броске: ресурс и цель */
export interface SneakAttackOptionAvailability {
  /** Ресурса хватает */
  affordable: boolean;
  /** Эффект приёма ляжет на выбранную цель */
  fitsTarget: boolean;
}

/**
 * Можно ли выбрать приём: ресурса хватает и цель подходит. Одно правило на
 * окно атаки и сборку урона — новое условие не разойдётся между ними.
 *
 * @param availability - доступность приёма
 * @returns `true`, если приём можно выбрать
 */
export function isSneakAttackOptionSelectable(
  availability: SneakAttackOptionAvailability,
): boolean {
  return availability.affordable && availability.fitsTarget;
}

/**
 * Спасбросок «Смертельного удара» для удара: без цели брать его не у кого.
 *
 * @param effects - эффекты бросающего
 * @param rollContext - контекст броска
 * @param formulaContext - числа бросающего
 * @returns спасбросок либо `undefined`
 */
function resolveTargetDoubleSave(
  effects: readonly ActiveEffect[],
  rollContext: RollContext,
  formulaContext: FormulaContext,
): SneakAttackDoubleSave | undefined {
  return rollContext.target
    ? resolveSneakAttackDoubleSave(effects, rollContext, formulaContext)
    : undefined;
}

/** Кости Скрытой атаки, когда приёмы Хитрого удара забрали их все */
const EMPTY_SNEAK_ATTACK_DICE = '0';

/**
 * Эффекты бросающего вместе с его кнопками «Применить». Сборщики броска
 * получают только действующие эффекты, а приём Хитрого удара — кнопка, которая
 * спит: её берут с листа самого бросающего (чужие ауры приёмов не дают).
 *
 * @param owner - бросающий
 * @param effects - его действующие эффекты (с аурами)
 * @returns эффекты и кнопки листа без повторов по id
 */
function withOwnUseButtons(
  owner: DnDSceneEntity,
  effects: readonly ActiveEffect[],
): ActiveEffect[] {
  const known = new Set(effects.map((effect) => effect.id));

  return [
    ...effects,
    ...(owner.activeEffects ?? []).filter(
      (effect) => isUseActivatedEffect(effect) && !known.has(effect.id),
    ),
  ];
}

/** Контекст броска из окна: фактический режим и решённое окном */
export interface BonusPartsRollContext {
  /** Бросок с преимуществом */
  hasAdvantage: boolean;
  /** Бросок с помехой */
  hasDisadvantage: boolean;
  /**
   * Скрытая атака идёт в этом броске: переключатель окна включён, а её
   * условия и лимит окно уже проверило ({@link SneakAttackRollPort})
   */
  sneakAttack?: boolean;
  /**
   * Выбранные в окне приёмы Хитрого удара и эффекты при Скрытой атаке — id
   * их эффектов-кнопок по порядку выбора. Цена убирает кости Скрытой атаки
   * до броска; приём, на который костей не хватило, отбрасывается
   */
  sneakAttackOptionIds?: readonly string[];
}

/** Roll-time сборщик бонус-частей (проп DiceRollModal) */
type BonusPartsEvaluator = (
  context: BonusPartsRollContext,
) => SpellDamagePartInput[];

/** Оружие броска — то, что читают условия и ключи «только этим предметом» */
type BonusPartsWeapon = Pick<
  DnDGameItem,
  'id' | 'weaponProperties' | 'rangeType' | 'sourceRangeType'
>;

/** Приём Хитрого удара в окне атаки */
export interface SneakAttackOptionPreview {
  /** Id эффекта-кнопки: ключ выбора */
  id: string;
  /** Название: «Хитрый удар: Отравить» */
  name: string;
  /** Пояснение приёма */
  description: string;
  /** Цена в костях Скрытой атаки */
  cost: number;
  /** Приём Хитрого удара (входит в число приёмов за удар) */
  cunningStrike: boolean;
  /** Ресурса хватает: «Раздирание разума» без использований — нет */
  affordable: boolean;
  /**
   * Эффект приёма ляжет на выбранную цель: её условие наложения выполнено
   * («Повалить» — Большая или меньше). Без цели — да: решит ведущий
   */
  fitsTarget: boolean;
}

/** Скрытая атака, которую окно атаки показывает переключателем */
export interface SneakAttackPreview {
  /** Кости для показа: «3к6» */
  formula: string;
  /** Чья она: эффект-источник */
  sourceName: string;
  /** В этом ходу уже потрачена: переключатель неактивен */
  spent: boolean;
  /** Сколько костей у неё до приёмов */
  diceCount: number;
  /** Приёмы Хитрого удара и эффекты по выбору, доступные в этом броске */
  options: SneakAttackOptionPreview[];
  /** Сколько приёмов Хитрого удара можно взять за удар */
  cunningStrikeLimit: number;
  /** Спасбросок «провал — урон атаки удвоен» («Смертельный удар») */
  doubleSave?: SneakAttackDoubleSave;
}

/**
 * Скрытая атака в окне атаки: есть ли она при текущем режиме и цели, включена
 * ли по умолчанию и как тратится. Окно зовёт `preview` при каждой смене
 * режима и цели, а `spend` — когда кости брошены в урон.
 */
export interface SneakAttackRollPort {
  /** Переключатель включён при открытии: настройка листа */
  defaultEnabled: boolean;
  /** Доступна ли сейчас; `undefined` — условия не выполнены */
  preview: (
    context: Pick<BonusPartsRollContext, 'hasAdvantage' | 'hasDisadvantage'>,
  ) => SneakAttackPreview | undefined;
  /**
   * Тратит лимит хода и ресурс выбранных приёмов; возвращает ход расхода
   * (вне боя — `undefined`, а ресурс приёмов тратится и вне боя)
   */
  spend: (optionIds?: readonly string[]) => string | undefined;
  /** Потрачен ли лимит хода прямо сейчас — без кэша показа окна */
  isSpent: () => boolean;
}

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
  /** Скрытая атака для окна; нет — её источников у владельца нет */
  sneakAttack?: SneakAttackRollPort;
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
export interface CreatureRollSetup {
  /** Базовые части урона действия (формулы существа, без инъекции модификатора) */
  baseParts: SpellDamagePartInput[];
  /** Roll-time сборщик бонус-частей от эффектов (для DiceRollModal) */
  evaluateBonusDamageParts: BonusPartsEvaluator;
  /** Псевдо-заклинание для оркестратора (saveType/saveEffect/areaOfEffect действия) */
  pseudoSpell: Spell;
  /** Скрытая атака для окна; нет — её источников у существа нет */
  sneakAttack?: SneakAttackRollPort;
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
        extraCreatureTypes: CreatureCategory[];
        markedBy: string[];
        entityId: string;
        adjacentAllies?: readonly AdjacentAllyState[];
        hasActed?: boolean;
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
      // Дополнительные типы цели считаются наравне с основным
      extraCreatureTypes: resolveEntityExtraCreatureTypes(entity),
      // Кто пометил цель — для условия «цель помечена мной» (Метка охотника)
      markedBy: listEntityMarkSources(entity),
      // Ходила ли цель в этом бою — для «Ликвидации» Убийцы
      hasActed: hasEntityActedInCombat(entity.id),
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
   * @param owner - бросающий: носитель эффектов (условия `self.*`) и владелец
   *   состояний `@self.status.*` в формулах бонус-урона
   * @param weapon - оружие броска: «только этим предметом» и условия по
   *   свойствам оружия; нет — бросок не оружием
   * @param sneakAttackContext - числа бросающего для костей Скрытой атаки;
   *   нет — этот бросок Скрытой атакой не бывает (заклинание)
   * @returns бонус-части урона; Скрытая атака — первой, со своей подписью
   */
  function collectParts(
    effects: readonly ActiveEffect[],
    damageKey: EffectTargetKey,
    modalContext: BonusPartsRollContext,
    defaultType: string | undefined,
    useTargetState: boolean,
    resolveFormula: (subFormula: string) => string,
    owner: DnDSceneEntity,
    weapon?: BonusPartsWeapon,
    sneakAttackContext?: FormulaContext,
  ): SpellDamagePartInput[] {
    const { rollContext, targetHp } = buildBonusRollContext(
      owner,
      modalContext,
      useTargetState,
      weapon,
    );

    // Скрытую атаку окно включило, только если она доступна; здесь она
    // решается заново тем же правилом — сборщик не хранит состояния окна
    const sneakAttack =
      modalContext.sneakAttack && sneakAttackContext
        ? resolveSneakAttack(effects, rollContext, sneakAttackContext)
        : undefined;

    // Зависимые строки («+1к6 этим ножом, если идёт Скрытая атака») видят,
    // применена ли она в этой атаке
    const formulas = collectBonusDamageFormulas(effects, damageKey, {
      ...rollContext,
      sneakAttack: sneakAttack !== undefined,
    });

    const targetIsFull = targetHp
      ? targetHp.currentHp >= targetHp.maxHp
      : undefined;

    const resolveParts = (
      partFormulas: Parameters<typeof resolveBonusDamageParts>[0],
    ): SpellDamagePartInput[] =>
      resolveBonusDamageParts(
        partFormulas,
        defaultType,
        targetIsFull,
        resolveFormula,
        targetHp?.creatureType,
        (status) => entityHasDamageStatus(owner, status),
      );

    // Кости Скрытой атаки — отдельной частью с типом оружия: крит их удваивает
    // так же, как кости удара, а окно и чат подписывают её по названию.
    // Приёмы Хитрого удара убирают кости ДО броска и едут с частью к цели
    const sneakAttackParts =
      sneakAttack && sneakAttackContext
        ? buildSneakAttackParts(
            sneakAttack.formula,
            effects,
            rollContext,
            sneakAttackContext,
            modalContext.sneakAttackOptionIds ?? [],
            owner,
            resolveParts,
          )
        : [];

    return [...sneakAttackParts, ...resolveParts(formulas)];
  }

  /**
   * Ляжет ли эффект приёма на выбранную цель: условие наложения проверяется
   * тем же правилом, что у оркестратора удара. Не ляжет — приём не выбрать:
   * кости ушли бы впустую. Без выбранной цели — да: попадание и цель решает
   * ведущий.
   *
   * @param owner - бросающий
   * @param effect - эффект-кнопка приёма
   * @returns `true`, если цели нет или она подходит
   */
  function sneakAttackOptionFitsTarget(
    owner: DnDSceneEntity,
    effect: ActiveEffect,
  ): boolean {
    const target = targetStore.getTargetActor();

    if (!effect.landingCondition || !target || !isDndSceneEntity(target)) {
      return true;
    }

    return passesLandingCondition(effect, target, {
      source: owner,
      combatRound: resolveCombatRound(),
    });
  }

  /**
   * Доступность приёма для этого бросающего и выбранной цели.
   *
   * @param owner - бросающий
   * @param effect - эффект-кнопка приёма
   * @returns ресурс и цель
   */
  function readSneakAttackOptionAvailability(
    owner: DnDSceneEntity,
    effect: ActiveEffect,
  ): SneakAttackOptionAvailability {
    return {
      affordable: canAffordSneakAttackOption(owner, effect),
      fitsTarget: sneakAttackOptionFitsTarget(owner, effect),
    };
  }

  /**
   * Часть урона Скрытой атаки с выбранными приёмами: их цена убирает кости,
   * их эффекты едут к цели, наименьшее значение кости — из строк
   * `sneakAttack.minDie`. Приём, которого больше нет (условие, ресурс) или на
   * который не хватило костей, отбрасывается.
   *
   * @param formula - кости Скрытой атаки
   * @param effects - эффекты бросающего
   * @param rollContext - контекст броска
   * @param formulaContext - числа бросающего
   * @param selectedIds - выбранные в окне приёмы
   * @param owner - бросающий: его ресурсы
   * @param resolveParts - разбор формулы в части с типом оружия
   * @returns части Скрытой атаки
   */
  function buildSneakAttackParts(
    formula: string,
    effects: readonly ActiveEffect[],
    rollContext: RollContext,
    formulaContext: FormulaContext,
    selectedIds: readonly string[],
    owner: DnDSceneEntity,
    resolveParts: (
      partFormulas: { formula: string }[],
    ) => SpellDamagePartInput[],
  ): SpellDamagePartInput[] {
    const options = listTargetedSneakAttackOptions(
      owner,
      effects,
      rollContext,
      formulaContext,
    ).filter((option) =>
      isSneakAttackOptionSelectable(
        readSneakAttackOptionAvailability(owner, option.effect),
      ),
    );

    const picked = pickSneakAttackOptions(
      options,
      selectedIds,
      countFormulaDice(formula),
      resolveCunningStrikeLimit(effects, rollContext, formulaContext),
    );

    const minDie = resolveSneakAttackMinDie(
      effects,
      rollContext,
      formulaContext,
    );

    const attackSave = resolveTargetDoubleSave(
      effects,
      rollContext,
      formulaContext,
    );

    const targetEffects = picked.map((option) =>
      buildSneakAttackOptionTargetEffect(option.effect),
    );

    const remaining = addDiceToFormula(
      formula,
      -sumSneakAttackOptionCost(picked),
    );

    // Приёмы съели все кости — часть остаётся нулём: по ней тратится лимит
    // хода и едут эффекты приёмов, а «0к6» роллер не читает
    return resolveParts([
      {
        formula:
          countFormulaDice(remaining) > 0 ? remaining : EMPTY_SNEAK_ATTACK_DICE,
      },
    ]).map((part) => ({
      ...part,
      label: SNEAK_ATTACK_LABEL,
      sneakAttack: true as const,
      ...(targetEffects.length > 0 ? { targetEffects } : {}),
      ...(minDie === undefined ? {} : { minDie }),
      ...(attackSave ? { attackSave } : {}),
    }));
  }

  /**
   * Контекст броска для условий эффектов: режим окна, цель (хиты, тип,
   * союзник рядом), носитель и оружие.
   *
   * @param owner - бросающий
   * @param modalContext - режим броска из окна
   * @param useTargetState - оценивать ли состояние единой цели
   * @param weapon - оружие броска; нет — бросок не оружием
   * @returns контекст и цель, по которой он собран
   */
  function buildBonusRollContext(
    owner: DnDSceneEntity,
    modalContext: Pick<
      BonusPartsRollContext,
      'hasAdvantage' | 'hasDisadvantage'
    >,
    useTargetState: boolean,
    weapon?: BonusPartsWeapon,
  ): {
    rollContext: RollContext;
    targetHp: ReturnType<typeof buildTargetHpContext>;
  } {
    const carrier: CarrierContext = buildCarrierContext(owner);

    const targetHp = useTargetState
      ? buildTargetHpContext(undefined, carrier.entityId)
      : undefined;

    const rollContext: RollContext = {
      hasAdvantage: modalContext.hasAdvantage,
      hasDisadvantage: modalContext.hasDisadvantage,
      target: targetHp,
      combatRound: resolveCombatRound(),
      // Кость-формулы с условием о носителе в плоские статы не попадают —
      // здесь эти условия и оцениваются
      self: carrier,
      // Предмет броска: по нему работает «только этим предметом», по его
      // свойствам — условие «метательным оружием», по его дальности —
      // «дальнобойное оружие» (самого оружия, а не вида атаки)
      ...(weapon === undefined
        ? {}
        : {
            itemId: weapon.id,
            weaponProperties: weapon.weaponProperties ?? [],
            weaponRangeType: weapon.sourceRangeType ?? weapon.rangeType,
          }),
    };

    return { rollContext, targetHp };
  }

  /**
   * Порт Скрытой атаки для окна атаки. Без строк `sneakAttack.damage` у
   * бросающего порта нет — окну нечего показывать.
   *
   * Без выбранной цели «союзник рядом с целью» не проверить: работает только
   * ветка «преимущество», а без неё переключателя нет.
   *
   * @param owner - бросающий
   * @param effects - его эффекты (с аурами)
   * @param formulaContext - его числа для костей
   * @param weapon - оружие броска; у действия существа его нет, и условия
   *   про оружие не выполняются
   * @returns порт либо `undefined`
   */
  function buildSneakAttackPort(
    owner: DnDSceneEntity,
    effects: readonly ActiveEffect[],
    formulaContext: FormulaContext,
    weapon?: BonusPartsWeapon,
  ): SneakAttackRollPort | undefined {
    if (!hasSneakAttackSource(effects)) {
      return undefined;
    }

    return {
      defaultEnabled: readSneakAttackAutoAdd(owner),
      preview: (modalContext) => {
        const { rollContext } = buildBonusRollContext(
          owner,
          modalContext,
          true,
          weapon,
        );

        const plan = resolveSneakAttack(effects, rollContext, formulaContext);

        if (!plan) {
          return undefined;
        }

        return {
          ...plan,
          spent: isSneakAttackSpentNow(owner.id),
          diceCount: countFormulaDice(plan.formula),
          options: listTargetedSneakAttackOptions(
            owner,
            effects,
            rollContext,
            formulaContext,
          ).map(({ effect, cost, cunningStrike }) => ({
            id: effect.id,
            name: effect.name,
            description: effect.description ?? '',
            cost,
            cunningStrike,
            ...readSneakAttackOptionAvailability(owner, effect),
          })),
          cunningStrikeLimit: resolveCunningStrikeLimit(
            effects,
            rollContext,
            formulaContext,
          ),
          doubleSave: resolveTargetDoubleSave(
            effects,
            rollContext,
            formulaContext,
          ),
        };
      },
      spend: (optionIds = []) => {
        paySneakAttackOptions(owner.id, optionIds);

        return spendSneakAttack(owner.id);
      },
      isSpent: () => isSneakAttackSpentNow(owner.id),
    };
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
    const defaultType = getWeaponPrimaryDamageType(weapon, resolvedStats);

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
      // Применяемый эффект оружия — кнопка предмета, а не свойство удара
      activeEffects: weapon.activeEffects
        ?.filter(isDnDEffect)
        .filter((effect) => !isUseActivatedEffect(effect)),
    });

    // Базовые части урона оружия через тот же резолвер, что и заклинания
    // (versatile-хват применён в getWeaponDamageParts; @-переменные, @dmg/@heal/
    // @target-токены и per-target гейты разворачиваются внутри).
    const resolvedParts: SpellDamagePartInput[] = resolveDamagePartsForCast(
      pseudoSpell,
      actor,
      getWeaponDamageParts(weapon, resolvedStats),
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

    const formulaContext = buildEntityFormulaContext(actor, resolvedStats);

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
        actor,
        weapon,
        formulaContext,
      );

    return {
      baseParts,
      evaluateBonusDamageParts,
      pseudoSpell,
      sneakAttack: buildSneakAttackPort(actor, effects, formulaContext, weapon),
    };
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
        actor,
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

    const defaultType = getDamagePartsPrimaryType(baseDamageParts);

    const pseudoSpell = buildPseudoSpell({
      id: `creature-action-${creature.id}-${action.name}`,
      name: action.name,
      rollSource: 'creatureAction',
      targetType: action.areaOfEffect ? 'area' : 'creature',
      deliveryType: action.rangeType === 'ranged' ? 'ranged' : 'melee',
      saveType: action.saveType ?? 'none',
      saveEffect: action.saveEffect,
      areaOfEffect: action.areaOfEffect,
      // Автопопадание — тот же флаг, что у заклинания: разбор целей читает
      // его одним правилом для обоих
      autoHit: action.autoHit,
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

    const formulaContext = buildEntityFormulaContext(creature);

    const resolveFormula = (subFormula: string): string =>
      resolveBonusFormula(subFormula, 'существа', (formula) =>
        substituteFormulaVariables(formula, formulaContext),
      );

    // У действия существа оружия нет: условия про оружие у Скрытой атаки
    // существа не выполняются, работают остальные (преимущество, союзник)
    const evaluateBonusDamageParts: BonusPartsEvaluator = (modalContext) =>
      collectParts(
        effects,
        damageKey,
        modalContext,
        defaultType,
        true,
        resolveFormula,
        creature,
        undefined,
        formulaContext,
      );

    return {
      baseParts,
      evaluateBonusDamageParts,
      pseudoSpell,
      sneakAttack: buildSneakAttackPort(creature, effects, formulaContext),
    };
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

    const defaultType = getDamagePartsPrimaryType(baseDamageParts);

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

    const formulaContext = buildEntityFormulaContext(creature);

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
        creature,
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
