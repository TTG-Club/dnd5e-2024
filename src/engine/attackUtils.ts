/**
 * Утилиты боевой механики D&D 5e.
 *
 * Содержит чистые функции для расчётов атаки:
 * определение критов, формирование лейблов, удвоение кубиков.
 *
 * Используется в dnd5eMacros.ts (хотбар) и DiceRollModal.vue (лист персонажа).
 */

import type {
  AbilityType,
  DiceRollData,
  DistanceUnit,
  SkillType,
  WeaponRangeType,
} from '@vtt/shared';

import type {
  EffectTargetKey,
  ResolvedActorStats,
} from './activeEffectTypes.js';
import type { ConditionRef } from './conditionKeys.js';
import type { CreatureAction } from './creatureTypes.js';
import type { DamageApplyResult } from './damageUtils.js';
import type { DnDGameItem, Spell } from './dndEntities.js';
import type { EffectTriggerSaveMode } from './effectTriggerTypes.js';

import { z } from 'zod';

import { convertDistance } from '@vtt/shared';

import {
  buildSaveVsConditionFlag,
  CONCENTRATION_SAVE_KEY,
} from './activeEffectTypes.js';
import { SPELL_SAVE_DC_BASE } from './consts.js';
import { getShortDamageTypeLabel } from './damageConstants.js';
import { formatDamageDefenseSuffix } from './damageUtils.js';
import {
  getSkillAdvantageFlagKey,
  getSkillDisadvantageFlagKey,
} from './skills.js';

/** Досягаемость по умолчанию в футах (рукопашные атаки и заклинания касания) */
export const DEFAULT_REACH_FEET = 5;

/**
 * Форма d20-проверки, достаточная для натуральной кости: первая группа костей —
 * базовая d20, за ней могут идти бонусные кости.
 */
const d20CheckRollSchema = z.object({
  dice: z
    .tuple([
      z.object({
        sides: z.literal(20),
        values: z.array(z.number()),
        dropped: z.array(z.number()),
      }),
    ])
    .rest(z.unknown()),
});

/**
 * Читает оставленную d20 из результата броска, не смешивая её с бонусными
 * костями. Принимает и чужие данные — ответ другого клиента проверяется схемой,
 * а не принимается на веру.
 *
 * @param rollData - результат d20-проверки, в том числе пришедший по сети
 * @returns натуральная кость либо undefined, если единственной оставленной d20 нет
 */
export function parseNaturalD20Roll(rollData: unknown): number | undefined {
  const parsed = d20CheckRollSchema.safeParse(rollData);

  if (!parsed.success) {
    return undefined;
  }

  const [baseDice] = parsed.data.dice;

  // `dropped` хранит индексы костей, отброшенных преимуществом или помехой
  const keptValues = baseDice.values.filter(
    (_value, index) => !baseDice.dropped.includes(index),
  );

  return keptValues.length === 1 ? keptValues[0] : undefined;
}

/**
 * Читает оставленную d20 собственного броска. Такой бросок собран формулой
 * системы, и отсутствие d20 в нём — ошибка кода, а не данных.
 *
 * @param rollData - результат стандартной d20-проверки
 * @returns натуральная кость, определяющая критический успех или промах
 */
export function getNaturalD20Roll(rollData: DiceRollData): number {
  const naturalRoll = parseNaturalD20Roll(rollData);

  if (naturalRoll === undefined) {
    throw new Error(
      'В результате проверки отсутствует единственная оставленная d20',
    );
  }

  return naturalRoll;
}

/**
 * Ключ бонусов атаки по дальности оружия или действия.
 *
 * @param rangeType - дальность оружия или действия
 * @returns `attack.ranged` для дальнобойного, иначе `attack.melee`
 */
export function getAttackBonusKey(
  rangeType: WeaponRangeType | undefined,
): EffectTargetKey {
  return rangeType === 'ranged' ? 'attack.ranged' : 'attack.melee';
}

/**
 * Вид атаки для флагов по дальности оружия или действия.
 *
 * @param rangeType - дальность оружия или действия
 * @returns `ranged` для дальнобойного, иначе `melee`
 */
export function getAttackFlagCategory(
  rangeType: WeaponRangeType | undefined,
): AttackFlagCategory {
  return rangeType === 'ranged' ? 'ranged' : 'melee';
}

/** Вид атаки по ключу прибавки к атаке */
const ATTACK_FLAG_CATEGORY_BY_KEY: Partial<
  Record<EffectTargetKey, AttackFlagCategory>
> = {
  'attack.melee': 'melee',
  'attack.ranged': 'ranged',
  'attack.spell': 'spell',
};

/**
 * Вид атаки, к броску которой относятся ключи прибавок.
 *
 * @param keys - ключи прибавок броска
 * @returns вид атаки либо `undefined`, если бросок не атака
 */
export function getAttackFlagCategoryOfKeys(
  keys: readonly EffectTargetKey[],
): AttackFlagCategory | undefined {
  return keys
    .map((key) => ATTACK_FLAG_CATEGORY_BY_KEY[key])
    .find((attackType) => attackType !== undefined);
}

/**
 * Сл спасброска от оружия: 8 + модификатор атаки этим оружием.
 *
 * @param attackModifier - модификатор атаки оружием
 * @returns сложность
 */
export function resolveWeaponSaveDc(attackModifier: number): number {
  return SPELL_SAVE_DC_BASE + attackModifier;
}

/**
 * Ключ бонусов урона по дальности оружия или действия.
 *
 * @param rangeType - дальность оружия или действия
 * @returns `damage.ranged` для дальнобойного, иначе `damage.melee`
 */
export function getDamageBonusKey(
  rangeType: WeaponRangeType | undefined,
): EffectTargetKey {
  return rangeType === 'ranged' ? 'damage.ranged' : 'damage.melee';
}

/** Параметры для определения результата атаки */
interface AttackResolveParams {
  /** Итого броска (1к20 + модификатор) */
  total: number;
  /** Модификатор атаки (мод. характеристики + мастерство + бонус) */
  attackModifier: number;
  /** Натуральная оставленная кость d20, отдельно от бонусных костей. */
  naturalRoll: number;
  /** Класс доспеха цели */
  targetAc: number;
  /** Активные флаги цели (для иммунитета к критам и т.п.) */
  targetFlags?: ReadonlySet<string>;
  /** С какой натуральной кости крит (по умолчанию 20) */
  critThreshold?: number;
}

/** Результат определения атаки */
export interface AttackResult {
  /** Натуральное значение к20 (без модификатора) */
  naturalRoll: number;
  /** Критическое попадание (натуральная 20) */
  isCriticalHit: boolean;
  /** Критический промах (натуральная 1) */
  isCriticalMiss: boolean;
  /** Попадание (крит или total >= AC, но не крит. промах) */
  isHit: boolean;
}

/** Натуральная 20: крит по правилам и всегда попадание */
const NATURAL_CRIT_ROLL = 20;

/** Флаг «любое попадание по этому существу — критическое» */
export const FORCE_CRITICAL_FLAG = 'attacksAgainst.forceCritical';

/**
 * Определяет результат броска атаки D&D 5e.
 *
 * @param params - параметры броска
 * @returns результат определения попадания
 */
export function resolveAttackRoll(params: AttackResolveParams): AttackResult {
  const naturalRoll = params.naturalRoll;
  const isCriticalMiss = naturalRoll === 1;

  // Адамантиновая броня: критический удар становится обычным попаданием
  const hasCritImmunity =
    params.targetFlags?.has('defense.critImmunity') ?? false;

  // «Улучшенный крит» опускает порог, но единица по-прежнему промах
  const critThreshold = Math.min(
    NATURAL_CRIT_ROLL,
    params.critThreshold ?? NATURAL_CRIT_ROLL,
  );

  // «Попадание по этому существу — крит»: парализованный, без сознания. Критом
  // становится только атака, которая уже попала, — промах им не делается.
  // Иммунитет к критам сильнее — адамантиновая броня спасает и от него
  const forcesCritical = params.targetFlags?.has(FORCE_CRITICAL_FLAG) ?? false;
  const hitsByTotal = params.total >= params.targetAc;

  const isCriticalHit =
    (naturalRoll >= critThreshold || (forcesCritical && hitsByTotal))
    && !isCriticalMiss
    && !hasCritImmunity;

  const isHit =
    naturalRoll === NATURAL_CRIT_ROLL
    || (!isCriticalMiss && (isCriticalHit || hitsByTotal));

  return { naturalRoll, isCriticalHit, isCriticalMiss, isHit };
}

/** Параметры для формирования лейбла атаки */
interface AttackLabelParams {
  /** Название оружия или контекст броска */
  weaponName: string;
  /** Имя цели */
  targetName: string;
  /** Результат определения попадания */
  result: AttackResult;
  /** Атака с помехой (дальняя дистанция) */
  isDisadvantage?: boolean;
}

/**
 * Формирует лейбл для броска атаки с результатом попадания.
 *
 * Пример: `Атака — Длинный меч → Гоблин | ✅ Попадание!`
 *
 * @param params - параметры для лейбла
 * @returns текст лейбла
 */
export function buildAttackLabel(params: AttackLabelParams): string {
  let label = `Атака\u00A0—\u00A0${params.weaponName}\u00A0→\u00A0${params.targetName}`;

  if (params.isDisadvantage) {
    label += '\u00A0|\u00A0⚠️\u00A0Помеха\u00A0(дальняя\u00A0дистанция)';
  }

  if (params.result.isCriticalHit) {
    label += '\u00A0|\u00A0✨\u00A0КРИТ!';
  } else if (params.result.isCriticalMiss) {
    label += '\u00A0|\u00A0❌\u00A0Крит.\u00A0промах!';
  } else if (params.result.isHit) {
    label += '\u00A0|\u00A0✅\u00A0Попадание!';
  } else {
    label += '\u00A0|\u00A0❌\u00A0Промах!';
  }

  return label;
}

/**
 * Формирует лейбл для броска урона с результатом применения.
 *
 * @param weaponName - название оружия
 * @param applyResult - результат применения урона к цели (может отсутствовать)
 * @param damageType - тип урона
 * @returns текст лейбла
 */
export function buildDamageLabel(
  weaponName: string,
  applyResult?: DamageApplyResult | null,
  damageType?: string,
): string {
  const typeLabel = damageType ? getShortDamageTypeLabel(damageType) : '';

  const typeSuffix = typeLabel ? ` (${typeLabel})` : '';

  let label = `Урон${typeSuffix}\u00A0—\u00A0${weaponName}`;

  if (applyResult) {
    const tempAbsorbed = applyResult.tempAbsorbed ?? 0;

    const totalDamage =
      applyResult.hpBefore - applyResult.hpAfter + tempAbsorbed;

    label += `\u00A0→\u00A0${applyResult.actorName}:\u00A0-${totalDamage}\u00A0HP`;

    if (tempAbsorbed > 0) {
      label += `\u00A0(врем.\u00A0-${tempAbsorbed})`;
    }

    label += formatDamageDefenseSuffix(applyResult.defenseOutcome);
  }

  return label;
}

const DOUBLE_DICE_REGEX = /(\d+)(к|d)(\d+)/gi;

/**
 * Удваивает количество кубиков в формуле для критического удара.
 *
 * @param formula - исходная формула урона (напр. "2к6+3")
 * @returns формула с удвоенными кубиками (напр. "4к6+3")
 */
export function doubleDiceInFormula(formula: string): string {
  return formula.replace(
    DOUBLE_DICE_REGEX,
    (_match, count, separator, sides) => {
      return `${Number(count) * 2}${separator}${sides}`;
    },
  );
}

/** Параметры для полного двухэтапного броска атаки */
export interface PerformAttackParams {
  /** Формула атаки (напр. "1к20+5") */
  attackFormula: string;
  /** Модификатор атаки */
  attackModifier: number;
  /** Класс доспеха цели */
  targetAc: number;
  /** Название оружия */
  weaponName: string;
  /** Имя цели */
  targetName: string;
  /** Атака с помехой */
  isDisadvantage?: boolean;
  /** Формула урона (если есть) */
  damageFormula?: string;
  /** ID актора цели (для применения урона) */
  targetActorId?: string | null;
  /** Активные флаги цели (для иммунитета к критам и т.п.) */
  targetFlags?: ReadonlySet<string>;
  /** Тип урона (если есть) */
  damageType?: string;
  /** С какой натуральной кости крит (по умолчанию 20) */
  critThreshold?: number;
}

/** Результат двухэтапной атаки */
export interface PerformAttackResult {
  /** Данные броска атаки */
  attackRoll: DiceRollData;
  /** Данные броска урона (если попал и есть формула) */
  damageRoll?: DiceRollData;
  /** Результат определения попадания */
  attackResult: AttackResult;
}

/**
 * Выполняет двухэтапную атаку D&D 5e: бросок попадания → бросок урона.
 *
 * @param params - параметры атаки
 * @param rollFn - функция для парсинга и броска кубиков (parseAndRoll)
 * @param applyDamageFn - функция для применения урона к цели (опционально);
 *   третьим аргументом — крит: он нужен событиям урона цели
 * @returns результат атаки с данными обоих бросков
 */
export function performTwoStageAttack(
  params: PerformAttackParams,
  rollFn: (formula: string) => DiceRollData,
  applyDamageFn?: (
    damage: number,
    isHealing: boolean,
    critical: boolean,
  ) => DamageApplyResult | null,
): PerformAttackResult {
  const attackRoll = rollFn(params.attackFormula);

  const attackResult = resolveAttackRoll({
    total: attackRoll.total,
    naturalRoll: getNaturalD20Roll(attackRoll),
    attackModifier: params.attackModifier,
    targetAc: params.targetAc,
    targetFlags: params.targetFlags,
    critThreshold: params.critThreshold,
  });

  attackRoll.label = buildAttackLabel({
    weaponName: params.weaponName,
    targetName: params.targetName,
    result: attackResult,
    isDisadvantage: params.isDisadvantage,
  });

  const output: PerformAttackResult = { attackRoll, attackResult };

  // Если попал и есть формула урона — бросок урона
  if (attackResult.isHit && params.damageFormula) {
    const damageFormula = attackResult.isCriticalHit
      ? doubleDiceInFormula(params.damageFormula)
      : params.damageFormula;

    const damageRoll = rollFn(damageFormula);

    let applyResult: DamageApplyResult | null = null;

    if (params.targetActorId && applyDamageFn) {
      applyResult = applyDamageFn(
        damageRoll.total,
        false,
        attackResult.isCriticalHit,
      );
    }

    damageRoll.label = buildDamageLabel(
      params.weaponName,
      applyResult,
      params.damageType,
    );

    output.damageRoll = damageRoll;
  }

  return output;
}

/** Режимы броска атаки */
export const ATTACK_ROLL_MODES = [
  'normal',
  'advantage',
  'disadvantage',
] as const;

/** Режим броска атаки */
export type AttackRollMode = (typeof ATTACK_ROLL_MODES)[number];

/** Категория атаки для подбора профильных флагов преимущества/помехи */
export type AttackFlagCategory = 'melee' | 'ranged' | 'spell';

/** Параметры расчёта режима броска атаки по флагам атакующего и цели */
export interface AttackRollModeParams {
  /** Активные флаги атакующего (`ResolvedActorStats.activeFlags`) */
  attackerFlags: ReadonlySet<string>;
  /** Категория атаки: профильные флаги `attack.<category>.advantage/disadvantage` */
  attackType: AttackFlagCategory;
  /** Активные флаги цели (для `attacksAgainst.advantage/disadvantage`) */
  targetFlags?: ReadonlySet<string>;
  /** Внешняя помеха (напр. стрельба за пределы нормальной дистанции) */
  forceDisadvantage?: boolean;
}

/**
 * Определяет итоговый режим броска атаки D&D 5e по флагам атакующего и цели.
 *
 * Учитывает общие флаги (`attack.advantage`/`attack.disadvantage`), профильные
 * по категории атаки (`attack.<melee|ranged|spell>.*`), флаги «атак по цели» —
 * общие (`attacksAgainst.*`) и профильные по категории
 * (`attacksAgainst.<melee|ranged|spell>.*`, ими описан Лежащий ничком: рукопашные
 * по нему с преимуществом, дальнобойные с помехой) — и внешнюю помеху
 * `forceDisadvantage` (дистанция). По правилу 5e преимущество и помеха взаимно
 * гасятся до «обычного» броска.
 *
 * Единая точка для всех путей атаки (оружие/заклинания актёра, действия и
 * заклинания существа), чтобы флаги атакующего читались одинаково везде.
 *
 * @param params - флаги атакующего/цели и контекст
 * @returns режим броска: обычный / преимущество / помеха
 */
export function resolveAttackRollMode(
  params: AttackRollModeParams,
): AttackRollMode {
  const { attackerFlags, attackType, targetFlags, forceDisadvantage } = params;

  const hasAdvantage =
    attackerFlags.has('attack.advantage')
    || attackerFlags.has(`attack.${attackType}.advantage`)
    || (targetFlags?.has('attacksAgainst.advantage') ?? false)
    || (targetFlags?.has(`attacksAgainst.${attackType}.advantage`) ?? false);

  const hasDisadvantage =
    forceDisadvantage === true
    || attackerFlags.has('attack.disadvantage')
    || attackerFlags.has(`attack.${attackType}.disadvantage`)
    || (targetFlags?.has('attacksAgainst.disadvantage') ?? false)
    || (targetFlags?.has(`attacksAgainst.${attackType}.disadvantage`) ?? false);

  return combineRollMode(hasAdvantage, hasDisadvantage);
}

/**
 * Режим броска по наличию преимущества и помехи: по правилу 5e они гасятся.
 *
 * @param hasAdvantage - есть преимущество
 * @param hasDisadvantage - есть помеха
 * @returns режим броска
 */
export function combineRollMode(
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): AttackRollMode {
  if (hasAdvantage === hasDisadvantage) {
    return 'normal';
  }

  return hasAdvantage ? 'advantage' : 'disadvantage';
}

/**
 * Определяет режим броска инициативы по активным флагам сущности.
 *
 * Инициатива — проверка Ловкости, поэтому преимущество/помеху ей дают три
 * группы флагов: свои (`initiative.*`), профильные по Ловкости
 * (`abilityCheck.*.dexterity`) и общие на все проверки (`abilityCheck.*`).
 * По правилу 5e преимущество и помеха взаимно гасятся.
 *
 * Единая точка для листа персонажа, листа существа и окна броска из трекера
 * инициативы — чтобы одни и те же флаги везде читались одинаково.
 *
 * @param flags - активные флаги сущности (`ResolvedActorStats.activeFlags`)
 * @returns режим броска: обычный / преимущество / помеха
 */
export function resolveInitiativeRollMode(
  flags: ReadonlySet<string>,
): AttackRollMode {
  const hasAdvantage =
    flags.has('initiative.advantage')
    || flags.has('abilityCheck.advantage.dexterity')
    || flags.has('abilityCheck.advantage');

  const hasDisadvantage =
    flags.has('initiative.disadvantage')
    || flags.has('abilityCheck.disadvantage.dexterity')
    || flags.has('abilityCheck.disadvantage');

  return combineRollMode(hasAdvantage, hasDisadvantage);
}

/** Параметры расчёта режима проверки характеристики или навыка */
export interface AbilityCheckRollModeParams {
  /** Активные флаги существа (`ResolvedActorStats.activeFlags`) */
  flags: ReadonlySet<string>;
  /**
   * Характеристика проверки. У навыка — та, от которой он считается на листе:
   * Атлетику перевели на Телосложение — и флаги читаются по Телосложению.
   */
  ability: AbilityType;
  /**
   * Навык проверки. Не задан — катится голая проверка характеристики, и
   * понавыковые флаги (помеха Скрытности от брони) её не касаются.
   */
  skill?: SkillType;
}

/**
 * Определяет режим проверки характеристики или навыка D&D 5e по активным
 * флагам существа.
 *
 * Учитывает общие флаги (`abilityCheck.advantage`/`abilityCheck.disadvantage`),
 * профильные по характеристике (`abilityCheck.*.<ability>`) и понавыковые
 * (`skill.<навык>.*` — преимущество Скрытности от эльфийских сапог, помеха от
 * брони). По правилу 5e преимущество и помеха взаимно гасятся.
 *
 * Единая точка для листа персонажа и листа существа, чтобы одни и те же флаги
 * везде читались одинаково.
 *
 * @param params - флаги, характеристика и навык проверки
 * @returns режим броска: обычный / преимущество / помеха
 */
export function resolveAbilityCheckRollMode(
  params: AbilityCheckRollModeParams,
): AttackRollMode {
  const { flags, ability, skill } = params;

  const hasAdvantage =
    flags.has('abilityCheck.advantage')
    || flags.has(`abilityCheck.advantage.${ability}`)
    || (skill !== undefined && flags.has(getSkillAdvantageFlagKey(skill)));

  const hasDisadvantage =
    flags.has('abilityCheck.disadvantage')
    || flags.has(`abilityCheck.disadvantage.${ability}`)
    || (skill !== undefined && flags.has(getSkillDisadvantageFlagKey(skill)));

  return combineRollMode(hasAdvantage, hasDisadvantage);
}

/**
 * Модификатор броска проверки характеристики: модификатор характеристики плюс
 * прибавка ко всем проверкам. Плитка листа прибавку не показывает — она
 * только в броске; у навыков она уже в числе навыка.
 *
 * @param abilityModifier - модификатор характеристики
 * @param stats - итоговые статы; нет — прибавки нет
 * @returns модификатор броска
 */
export function resolveAbilityCheckModifier(
  abilityModifier: number,
  stats: Pick<ResolvedActorStats, 'abilityCheckBonus'> | undefined,
): number {
  return abilityModifier + (stats?.abilityCheckBonus ?? 0);
}

/** Параметры расчёта режима спасброска по флагам существа */
export interface SavingThrowRollModeParams {
  /** Активные флаги существа (`ResolvedActorStats.activeFlags`) */
  flags: ReadonlySet<string>;
  /** Характеристика спасброска */
  ability: AbilityType;
  /**
   * Спасбросок вызван заклинанием или иным магическим эффектом.
   *
   * Отдельным признаком, а не флагом существа: «против магии» — свойство
   * броска, а не носителя. Мантия сопротивления заклинаниям даёт преимущество
   * только тут и молчит на спасброске от яда.
   */
  againstMagic?: boolean;
  /**
   * Спасбросок вызван именно заклинанием, а не любой магией: «Кольцо
   * отражения заклинаний» даёт преимущество только тут.
   */
  againstSpell?: boolean;
  /**
   * Состояние, которого спасбросок позволяет избежать или которое прекращает.
   *
   * Тоже свойство броска, а не носителя: дварфийская стойкость даёт
   * преимущество на спасбросок против отравления и молчит на спасброске от
   * страха.
   */
  againstCondition?: ConditionRef;
  /**
   * Спасбросок концентрации: «Боевой заклинатель» даёт преимущество только на
   * нём, а не на всех спасбросках Телосложения.
   */
  againstConcentration?: boolean;
  /**
   * Преимущество или помеха самого спасброска, а не бросающего: «повторяет
   * спасбросок с преимуществом, если урон нанёс заклинатель».
   */
  mode?: EffectTriggerSaveMode;
}

/**
 * Определяет режим спасброска D&D 5e по активным флагам существа.
 *
 * Учитывает общие флаги (`save.advantage`/`save.disadvantage`), профильные по
 * характеристике (`save.*.<ability>`), `save.*.vsMagic` — когда спасбросок
 * вызван магией, — и `save.*.vs<Состояние>`, когда спасбросок против состояния.
 * По правилу 5e преимущество и помеха взаимно гасятся.
 *
 * Единая точка для листа персонажа и для спасбросков, которые навязывает
 * заклинание, чтобы одни и те же флаги читались одинаково.
 *
 * @param params - флаги, характеристика и обстоятельства спасброска
 * @returns режим броска: обычный / преимущество / помеха
 */
export function resolveSavingThrowRollMode(
  params: SavingThrowRollModeParams,
): AttackRollMode {
  const {
    flags,
    ability,
    againstMagic,
    againstSpell,
    againstCondition,
    againstConcentration,
    mode,
  } = params;

  const hasAdvantage =
    mode === 'advantage'
    || flags.has('save.advantage')
    || flags.has(`save.advantage.${ability}`)
    || (againstMagic === true && flags.has('save.advantage.vsMagic'))
    || (againstSpell === true && flags.has('save.advantage.vsSpell'))
    || (againstConcentration === true
      && flags.has('save.advantage.vsConcentration'))
    || (againstCondition !== undefined
      && flags.has(buildSaveVsConditionFlag('advantage', againstCondition)));

  const hasDisadvantage =
    mode === 'disadvantage'
    || flags.has('save.disadvantage')
    || flags.has(`save.disadvantage.${ability}`)
    || (againstMagic === true && flags.has('save.disadvantage.vsMagic'))
    || (againstSpell === true && flags.has('save.disadvantage.vsSpell'))
    || (againstConcentration === true
      && flags.has('save.disadvantage.vsConcentration'))
    || (againstCondition !== undefined
      && flags.has(buildSaveVsConditionFlag('disadvantage', againstCondition)));

  return combineRollMode(hasAdvantage, hasDisadvantage);
}

/** Обстоятельства спасброска, от которых зависят его прибавки */
export type SavingThrowBonusCircumstances = Pick<
  SavingThrowRollModeParams,
  'againstConcentration'
>;

/**
 * Ключи кубиковых прибавок спасброска: своей характеристики и, у спасброска
 * концентрации, ещё и концентрации.
 *
 * @param ability - характеристика спасброска
 * @param circumstances - обстоятельства спасброска
 * @returns ключи прибавок
 */
export function listSavingThrowBonusKeys(
  ability: AbilityType,
  circumstances: SavingThrowBonusCircumstances = {},
): EffectTargetKey[] {
  const abilityKey: EffectTargetKey = `save.${ability}`;

  return circumstances.againstConcentration
    ? [abilityKey, CONCENTRATION_SAVE_KEY]
    : [abilityKey];
}

/**
 * Модификатор спасброска с прибавками обстоятельств: спасбросок концентрации
 * получает ещё и свою прибавку.
 *
 * @param stats - посчитанные статы бросающего
 * @param ability - характеристика спасброска
 * @param circumstances - обстоятельства спасброска
 * @returns модификатор
 */
export function resolveSavingThrowModifier(
  stats: Pick<ResolvedActorStats, 'saves' | 'concentrationSaveBonus'>,
  ability: AbilityType,
  circumstances: SavingThrowBonusCircumstances = {},
): number {
  const concentrationBonus = circumstances.againstConcentration
    ? stats.concentrationSaveBonus
    : 0;

  return stats.saves[ability] + concentrationBonus;
}

/**
 * Формирует формулу для броска атаки D&D 5e.
 *
 * - `normal`: `1к20+N`
 * - `advantage`: `2к20kh1+N` (бросить 2 к20, взять лучший)
 * - `disadvantage`: `2к20kl1+N` (бросить 2 к20, взять худший)
 *
 * @param attackModifier - суммарный модификатор атаки
 * @param rollMode - режим броска (обычный / преимущество / помеха)
 * @param bonusDiceFormulas - кубиковые бонусы, бросаемые отдельно от d20
 * @returns формула атаки
 */
export function buildAttackFormula(
  attackModifier: number,
  rollMode: AttackRollMode = 'normal',
  bonusDiceFormulas: readonly string[] = [],
): string {
  const sign = attackModifier >= 0 ? '+' : '-';

  let diceExpr = '1к20';

  if (rollMode === 'advantage') {
    diceExpr = '2к20kh1';
  } else if (rollMode === 'disadvantage') {
    diceExpr = '2к20kl1';
  }

  const bonusSuffix = bonusDiceFormulas
    .map((formula) =>
      formula.startsWith('-') || formula.startsWith('+')
        ? formula
        : `+${formula}`,
    )
    .join('');

  return `${diceExpr}${sign}${Math.abs(attackModifier)}${bonusSuffix}`;
}

/**
 * Проверяет, находится ли цель в пределах досягаемости оружия.
 *
 * @param weapon - оружие для атаки
 * @param distance - расстояние до цели
 * @returns объект с результатом проверки или null
 */
export function checkRange(
  weapon: DnDGameItem,
  distance: number,
): { allowed: boolean; disadvantage: boolean } {
  if (weapon.rangeType === 'ranged' && weapon.range) {
    const normalRange = weapon.range.normal;
    const longRange = weapon.range.long ?? normalRange;

    if (distance > longRange) {
      return { allowed: false, disadvantage: false };
    }

    if (distance > normalRange) {
      return { allowed: true, disadvantage: true };
    }

    return { allowed: true, disadvantage: false };
  }

  // Ближний бой: проверяем reach
  const reach = weapon.reach ?? DEFAULT_REACH_FEET;

  if (distance > reach) {
    return { allowed: false, disadvantage: false };
  }

  return { allowed: true, disadvantage: false };
}

/**
 * Проверяет, находится ли цель в пределах досягаемости действия существа.
 *
 * Логика идентична checkRange для оружия:
 * - ranged: проверяет normal/long дистанцию, помеха при превышении нормальной
 * - melee: проверяет reach (по умолчанию 5)
 *
 * @param action - действие существа
 * @param distance - расстояние до цели
 * @returns объект с результатом проверки
 */
export function checkCreatureActionRange(
  action: CreatureAction,
  distance: number,
): { allowed: boolean; disadvantage: boolean } {
  if (action.rangeType === 'ranged' && action.range) {
    const normalRange = action.range.normal;
    const longRange = action.range.long ?? normalRange;

    if (distance > longRange) {
      return { allowed: false, disadvantage: false };
    }

    if (distance > normalRange) {
      return { allowed: true, disadvantage: true };
    }

    return { allowed: true, disadvantage: false };
  }

  // Ближний бой: проверяем reach
  const actionReach = action.reach ?? DEFAULT_REACH_FEET;

  if (distance > actionReach) {
    return { allowed: false, disadvantage: false };
  }

  return { allowed: true, disadvantage: false };
}

/**
 * Возвращает предел дистанции каста заклинания в единицах сцены.
 *
 * В отличие от оружия, у заклинаний D&D 5e нет «длинной» дистанции
 * с помехой — только жёсткий предел:
 * - `melee` / `touch`: досягаемость 5 футов;
 * - `ranged` / `none` с дистанцией больше 0: дистанция заклинания, сконвертированная
 *   из `rangeUnit` заклинания в единицы сцены;
 * - `self` / `sight` или дистанция 0: без ограничений.
 *
 * @param spell - заклинание
 * @param sceneUnit - единица измерения сцены
 * @returns предел дистанции в единицах сцены (null — дистанция не ограничена)
 */
export function getSpellMaxRange(
  spell: Spell,
  sceneUnit: DistanceUnit,
): number | null {
  if (spell.deliveryType === 'melee' || spell.deliveryType === 'touch') {
    return Math.round(convertDistance(DEFAULT_REACH_FEET, 'ft', sceneUnit));
  }

  if (
    (spell.deliveryType === 'ranged' || spell.deliveryType === 'none')
    && spell.range > 0
  ) {
    return Math.round(convertDistance(spell.range, spell.rangeUnit, sceneUnit));
  }

  return null;
}

/**
 * Проверяет, находится ли цель в пределах дистанции заклинания.
 *
 * Предел дистанции считается по правилам `getSpellMaxRange`.
 *
 * @param spell - заклинание
 * @param distance - расстояние до цели в единицах сцены
 * @param sceneUnit - единица измерения сцены
 * @returns результат проверки и предел дистанции в единицах сцены
 *   (`maxRange: null` — дистанция не ограничена)
 */
export function checkSpellRange(
  spell: Spell,
  distance: number,
  sceneUnit: DistanceUnit,
): { allowed: boolean; maxRange: number | null } {
  const maxRange = getSpellMaxRange(spell, sceneUnit);

  return {
    allowed: maxRange === null || distance <= maxRange,
    maxRange,
  };
}
