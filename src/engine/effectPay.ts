/**
 * Расчёт цены ресурсом: что платящий может потратить, выбор количества и
 * списание.
 *
 * Оплата идёт в три шага, одинаковых для применения, включения, каста и
 * срабатывания:
 * 1. {@link planEffectPay} — по листу платящего собирает варианты каждого
 *    платежа («ячейка 2, 3 или 4 круга», «одна или две кости к10») и говорит,
 *    чего не хватает;
 * 2. человек выбирает вариант там, где их больше одного (окно на клиенте,
 *    вопрос владельцу — у срабатываний сервера);
 * 3. {@link settleEffectPay} списывает ресурсы и отдаёт потраченное
 *    (`EffectPaid`) — числа токенов `@paid.*`.
 *
 * Кости хитов здесь тратятся той же функцией, что и на коротком отдыхе
 * (`hitDiceUtils.spendHitDice`), а бросаются по тем же правилам черт
 * ({@link rollSpentHitDice}): «максимум вместо броска», «1 и 2 считать как 3»,
 * «первая после отдыха не тратится».
 *
 * У существа ресурсов листа нет: ячейка и кости хитов не списываются (их ведёт
 * ведущий), число всё равно выбирается и уходит в формулы; счётчиком,
 * зарядами и вдохновением существо платить не может.
 *
 * @module system/dnd/effectPay
 */

import type { ActiveEffect, EffectFlagKey } from './activeEffectTypes.js';
import type { DnDActor, DnDGameItem, DnDSceneEntity } from './dndEntities.js';
import type {
  EffectPaid,
  EffectPay,
  EffectPrice,
  EffectPriceAmount,
} from './effectPayTypes.js';
import type { EffectTriggerSource } from './effectTriggerRunner.js';
import type { EffectTriggerLimit } from './effectTriggerTypes.js';
import type { FormulaContext } from './formulaParser.js';

import { isActorEntity, isCreatureEntity } from '@vtt/shared';

import { isHitDie } from './classTypes.js';
import { cloneEntityData } from './dataClone.js';
import { resolveSlotLevelLimit } from './effectCastRule.js';
import { bindTriggerPaid } from './effectPaidTokens.js';
import {
  DEFAULT_PRICE_AMOUNT,
  describeEffectPrice,
  EFFECT_PRICE_LABELS,
  formatPriceHitDice,
  formatPriceSlot,
  PAID_TOKEN_PREFIX,
  paidTokenOf,
  pluralizePrice,
  priceHasAmount,
} from './effectPayTypes.js';
import { collectActiveEffects, resolveActorStats } from './effectPipeline.js';
import {
  consumeTriggerUse,
  isTriggerLimitReached,
} from './effectTriggerUsage.js';
import { CAST_LEVEL_VARIABLE, evaluateFormula } from './formulaParser.js';
import { getHitDiceGroups, spendHitDice } from './hitDiceUtils.js';
import { buildResolvedFormulaContext } from './resolvedFormulaContext.js';
import {
  computeActorSpellSlots,
  getPactSlotInfo,
  MAX_SPELL_SLOT_LEVEL,
  MIN_SPELL_SLOT_LEVEL,
} from './spellSlotTable.js';

/** Флаг «кости хитов: максимум вместо броска» */
export const HIT_DICE_MAXIMIZE_FLAG: EffectFlagKey = 'hitDice.maximize';

/** Флаг «кости хитов: выпавшие 1 и 2 считаются как 3» */
export const HIT_DICE_LOW_AS_THREE_FLAG: EffectFlagKey = 'hitDice.lowAsThree';

/** Флаг «первая кость хитов после отдыха не тратится» */
export const HIT_DICE_FIRST_FREE_FLAG: EffectFlagKey = 'hitDice.firstFree';

/** Наименьшее значение кости хитов под флагом {@link HIT_DICE_LOW_AS_THREE_FLAG} */
const HIT_DIE_LOW_FLOOR = 3;

/**
 * Лимит бесплатной кости хитов: одна после отдыха. Период — короткий отдых: его
 * заканчивает и короткий, и продолжительный.
 */
const FREE_HIT_DIE_LIMIT: EffectTriggerLimit = { max: 1, per: 'shortRest' };

/** Ключ бесплатной кости хитов в счётчиках лимитов листа */
const FREE_HIT_DIE_USAGE_KEY = 'hitDice|firstFree';

/** Токен круга каста в формуле количества */
const CAST_LEVEL_TOKEN = `@${CAST_LEVEL_VARIABLE}`;

/** Больше вариантов количества у одного платежа не предлагают */
const MAX_PRICE_CHOICES = 20;

/** С чем считается цена */
export interface PayContext {
  /** Круг каста: формулы количества читают `@castLevel` */
  castLevel?: number;
  /** Предмет, с которого пришёл эффект: с него берутся «заряды предмета» */
  itemId?: string;
  /**
   * Бросать ли потраченные кости хитов. Не бросаются там, где сумма никому не
   * нужна: кости — только цена («потратьте две Кости Хитов»).
   */
  rollHitDice?: boolean;
}

/** Вариант платежа: сколько и чего именно потратить */
export interface PayOption {
  /** Ключ варианта — им отвечают на вопрос */
  id: string;
  /** Сколько единиц; у ячейки — её круг */
  amount: number;
  /** Грань костей хитов */
  die?: number;
  /** Ячейка договора */
  pact?: boolean;
  /** Подпись варианта: «2 кости хитов (к10)», «ячейка 3 круга» */
  label: string;
}

/** Платёж цены с вариантами, которые платящий может себе позволить */
export interface PricePlan {
  price: EffectPrice;
  /** Доступные варианты; пусто — платить нечем */
  options: PayOption[];
}

/** Разбор цены по листу платящего */
export interface PayPlan {
  prices: PricePlan[];
  /** Чего не хватает; `null` — цена по карману */
  shortfall: string | null;
}

/** Итог оплаты */
export interface PaySettlement {
  /** Платящий со списанными ресурсами — новый объект */
  entity: DnDSceneEntity;
  /** Потраченное: числа токенов `@paid.*` */
  paid: EffectPaid;
  /** Что потрачено — словами, по платежу на строку */
  notes: string[];
}

/** Подписи оплаты: что потрачено и почему отказано */
const SETTLE_LABELS = {
  hitDiceNone: 'кости хитов не тратить',
  itemUsesNone: 'заряды не тратить',
  counterNone: 'не тратить',
  untracked: ' — у существа не списывается',
  freeDie: ' (первая после отдыха не тратится)',
  maximized: ' (максимум вместо броска)',
  shortfallPrefix: 'не хватает: ',
  noItem: 'заряды предмета (эффект не с предмета с зарядами)',
  paid: 'цена',
} as const;

/**
 * Число формулы количества: целое и не меньше нуля; не посчиталась — запасное.
 *
 * @param formula - формула количества
 * @param context - числа платящего и круг каста
 * @param fallback - что брать, если формулу не посчитать
 * @returns количество
 */
function evaluatePriceAmount(
  formula: string | undefined,
  context: FormulaContext,
  fallback: number,
): number {
  if (formula === undefined) {
    return fallback;
  }

  try {
    const value = evaluateFormula(formula, context);

    return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
  } catch {
    // Автор ошибся в формуле — берём запасное число, а не роняем оплату
    return fallback;
  }
}

/**
 * Границы количества платежа: от скольких до скольких единиц платит игрок.
 *
 * @param price - платёж с количеством
 * @param context - числа платящего и круг каста
 * @returns нижняя и верхняя граница
 */
function resolvePriceRange(
  price: EffectPriceAmount,
  context: FormulaContext,
): { min: number; max: number } {
  const min = evaluatePriceAmount(
    price.amount ?? DEFAULT_PRICE_AMOUNT,
    context,
    Number(DEFAULT_PRICE_AMOUNT),
  );

  const max = Math.max(min, evaluatePriceAmount(price.max, context, min));

  return { min, max: Math.min(max, min + MAX_PRICE_CHOICES - 1) };
}

/**
 * Количества от нижней до верхней границы, которые платящему по карману.
 *
 * @param range - границы количества
 * @param range.min - нижняя граница
 * @param range.max - верхняя граница
 * @param available - сколько единиц есть
 * @returns количества по возрастанию
 */
function listAffordableAmounts(
  range: { min: number; max: number },
  available: number,
): number[] {
  const amounts: number[] = [];

  for (let amount = range.min; amount <= range.max; amount++) {
    if (amount <= available) {
      amounts.push(amount);
    }
  }

  return amounts;
}

/**
 * Название счётчика листа для подписи: своё имя либо ключ.
 *
 * @param payer - платящий
 * @param counterKey - ключ счётчика
 * @returns название в кавычках
 */
function formatCounterName(payer: DnDSceneEntity, counterKey: string): string {
  return `«${readCounterName(payer, counterKey)}»`;
}

/**
 * Название счётчика платящего как на листе; счётчика нет — его ключ.
 *
 * @param payer - платящий
 * @param counterKey - ключ счётчика
 * @returns название без кавычек
 */
function readCounterName(payer: DnDSceneEntity, counterKey: string): string {
  const counter = isActorEntity(payer)
    ? payer.system.classCounters.find(
        (entry) => entry.counterKey === counterKey,
      )
    : undefined;

  return counter?.name ?? counterKey;
}

/** Группа костей хитов платящего: грань и сколько костей можно потратить */
interface PayerHitDice {
  die: number;
  available: number;
}

/**
 * Кости хитов платящего по граням, от большей к меньшей. У существа — кость
 * статблока; потраченные кости у него не ведутся.
 *
 * @param payer - платящий
 * @returns группы костей
 */
function listPayerHitDice(payer: DnDSceneEntity): PayerHitDice[] {
  if (isActorEntity(payer)) {
    return getHitDiceGroups(payer.system.classes, payer.system.manualHitDice)
      .filter((group) => group.available > 0)
      .map((group) => ({ die: group.die, available: group.available }));
  }

  if (!isCreatureEntity(payer)) {
    return [];
  }

  const { hitDie, hitDiceCount } = payer.system.hitPoints;

  return hitDie && hitDiceCount
    ? [{ die: hitDie, available: hitDiceCount }]
    : [];
}

/**
 * Варианты платежа костями хитов: количество на каждую грань, которой хватает.
 *
 * @param payer - платящий
 * @param price - платёж
 * @param index - номер платежа в цене
 * @param context - числа платящего и круг каста
 * @returns варианты
 */
function listHitDiceOptions(
  payer: DnDSceneEntity,
  price: EffectPriceAmount,
  index: number,
  context: FormulaContext,
): PayOption[] {
  const range = resolvePriceRange(price, context);
  const groups = listPayerHitDice(payer);

  // «Не тратить» — один вариант на все грани
  const none: PayOption[] =
    range.min === 0
      ? [{ id: `${index}:0`, amount: 0, label: SETTLE_LABELS.hitDiceNone }]
      : [];

  return [
    ...none,
    ...groups.flatMap((group) =>
      listAffordableAmounts(range, group.available)
        .filter((amount) => amount > 0)
        .map((amount) => ({
          id: `${index}:${amount}:${group.die}`,
          amount,
          die: group.die,
          label: formatPriceHitDice(amount, group.die),
        })),
    ),
  ];
}

/**
 * Варианты платежа ячейкой заклинания: круги с оставшимися ячейками в
 * пределах цены. У существа ячеек нет — предлагаются все круги пределов.
 *
 * @param payer - платящий
 * @param price - платёж ячейкой
 * @param index - номер платежа в цене
 * @returns варианты
 */
function listSlotOptions(
  payer: DnDSceneEntity,
  price: Extract<EffectPrice, { kind: 'spellSlot' }>,
  index: number,
): PayOption[] {
  const priceMin = price.minLevel ?? MIN_SPELL_SLOT_LEVEL;

  // «Не может использовать ячейки 7-го круга и выше» — запрет и на плату ими
  const limit = resolveSlotLevelLimit(collectActiveEffects(payer));

  const minLevel = Math.max(priceMin, limit.min?.level ?? MIN_SPELL_SLOT_LEVEL);

  const maxLevel = Math.min(
    Math.max(priceMin, price.maxLevel ?? MAX_SPELL_SLOT_LEVEL),
    limit.max?.level ?? MAX_SPELL_SLOT_LEVEL,
  );

  const options: PayOption[] = [];

  /**
   * Добавляет вариант ячейки.
   *
   * @param level - круг
   * @param pact - ячейка договора
   * @param suffix - приписка к подписи
   */
  const push = (level: number, pact: boolean, suffix = ''): void => {
    options.push({
      id: `${index}:${level}${pact ? ':pact' : ''}`,
      amount: level,
      ...(pact ? { pact } : {}),
      label: `${formatPriceSlot(level, pact)}${suffix}`,
    });
  };

  if (!isActorEntity(payer)) {
    if (price.pact) {
      return [];
    }

    for (let level = minLevel; level <= maxLevel; level++) {
      push(level, false, SETTLE_LABELS.untracked);
    }

    return options;
  }

  const actor: DnDActor = payer;

  if (!price.pact) {
    const slots = computeActorSpellSlots(actor);
    const used = actor.system.spellSlotsUsed ?? [];

    for (let level = minLevel; level <= maxLevel; level++) {
      if ((used[level - 1] ?? 0) < (slots[level - 1] ?? 0)) {
        push(level, false);
      }
    }
  }

  const pact = getPactSlotInfo(actor.system.classes);

  if (
    pact.max > 0
    && pact.level >= minLevel
    && pact.level <= maxLevel
    && (actor.system.pactSlotsUsed ?? 0) < pact.max
  ) {
    push(pact.level, true);
  }

  return options.sort((left, right) => left.amount - right.amount);
}

/**
 * Предмет платящего, с которого пришёл эффект, если у него есть заряды.
 *
 * @param payer - платящий
 * @param itemId - предмет
 * @returns предмет либо `undefined`
 */
function findChargedItem(
  payer: DnDSceneEntity,
  itemId: string | undefined,
): DnDGameItem | undefined {
  const item = itemId
    ? (payer.equipment ?? []).find((entry) => entry.id === itemId)
    : undefined;

  return item?.uses ? item : undefined;
}

/**
 * Варианты одного платежа, которые платящему по карману.
 *
 * @param payer - платящий
 * @param price - платёж
 * @param index - номер платежа в цене
 * @param context - числа платящего и круг каста
 * @param itemId - предмет, с которого пришёл эффект
 * @returns варианты; пусто — платить нечем
 */
function listPriceOptions(
  payer: DnDSceneEntity,
  price: EffectPrice,
  index: number,
  context: FormulaContext,
  itemId: string | undefined,
): PayOption[] {
  switch (price.kind) {
    case 'counter': {
      const counter = isActorEntity(payer)
        ? payer.system.classCounters.find(
            (entry) => entry.counterKey === price.counter,
          )
        : undefined;

      if (!counter) {
        return [];
      }

      const name = formatCounterName(payer, price.counter);

      return listAffordableAmounts(
        resolvePriceRange(price, context),
        counter.current,
      ).map((amount) => ({
        id: `${index}:${amount}`,
        amount,
        label:
          amount === 0
            ? `${name}: ${SETTLE_LABELS.counterNone}`
            : `${name}: ${amount}`,
      }));
    }
    case 'hitDice':
      return listHitDiceOptions(payer, price, index, context);
    case 'spellSlot':
      return listSlotOptions(payer, price, index);
    case 'itemUses': {
      const item = findChargedItem(payer, itemId);

      if (!item?.uses) {
        return [];
      }

      return listAffordableAmounts(
        resolvePriceRange(price, context),
        item.uses.current,
      ).map((amount) => ({
        id: `${index}:${amount}`,
        amount,
        label:
          amount === 0
            ? SETTLE_LABELS.itemUsesNone
            : `${amount} ${pluralizePrice(amount, EFFECT_PRICE_LABELS.itemUsesForms)}`,
      }));
    }
    default:
      return isActorEntity(payer) && payer.system.inspiration === true
        ? [
            {
              id: `${index}:1`,
              amount: 1,
              label: EFFECT_PRICE_LABELS.inspiration,
            },
          ]
        : [];
  }
}

/**
 * Разбирает цену по листу платящего: варианты каждого платежа и чего не
 * хватает.
 *
 * @param payer - кто платит
 * @param pay - цена
 * @param context - круг каста и предмет-источник
 * @returns разбор цены
 */
export function planEffectPay(
  payer: DnDSceneEntity,
  pay: EffectPay,
  context: PayContext = {},
): PayPlan {
  const formulaContext: FormulaContext = {
    ...buildResolvedFormulaContext(payer),
    ...(context.castLevel === undefined
      ? {}
      : { castLevel: context.castLevel }),
  };

  const prices = pay.map((price, index) => ({
    price,
    options: listPriceOptions(
      payer,
      price,
      index,
      formulaContext,
      context.itemId,
    ),
  }));

  const missing = prices
    .filter((entry) => entry.options.length === 0)
    .map((entry) =>
      entry.price.kind === 'itemUses' && !findChargedItem(payer, context.itemId)
        ? SETTLE_LABELS.noItem
        : describeEffectPrice(entry.price, (counterKey) =>
            formatCounterName(payer, counterKey).slice(1, -1),
          ),
    );

  return {
    prices,
    shortfall:
      missing.length > 0
        ? `${SETTLE_LABELS.shortfallPrefix}${missing.join(', ')}`
        : null,
  };
}

/**
 * Цена словами по листу платящего — для вопроса перед срабатыванием: счётчик
 * назван как на листе, а не ключом, количество — посчитанное число, а не
 * формула («3 кости хитов (к12)» вместо `ceil(@hitDice.left / 2)`). Платёж с
 * выбором описывается общими словами — что именно, человек выберет следом.
 *
 * @param payer - платящий
 * @param plan - разбор его цены
 * @returns цена словами
 */
export function describePayPlan(payer: DnDSceneEntity, plan: PayPlan): string {
  return plan.prices
    .map(({ price, options }) => {
      const [only] = options;

      return options.length === 1 && only
        ? only.label
        : describeEffectPrice(price, (counterKey) =>
            readCounterName(payer, counterKey),
          );
    })
    .join(EFFECT_PRICE_LABELS.payJoiner);
}

/**
 * Нужно ли спрашивать человека: хоть у одного платежа больше одного варианта.
 *
 * @param plan - разбор цены
 * @returns `true`, если есть что выбирать
 */
export function payNeedsChoice(plan: PayPlan): boolean {
  return plan.prices.some((entry) => entry.options.length > 1);
}

/**
 * Выбор по умолчанию: первый вариант каждого платежа — наименьшее количество
 * и младший круг.
 *
 * @param plan - разбор цены
 * @returns выбранные варианты либо `null`, если цена не по карману
 */
export function defaultPayPicks(plan: PayPlan): PayOption[] | null {
  if (plan.shortfall !== null) {
    return null;
  }

  return plan.prices.flatMap((entry) => entry.options.slice(0, 1));
}

/** Как черты владельца меняют трату костей хитов — на отдыхе и в цене */
export interface HitDiceSpendRules {
  /** Кости не бросаются: берётся максимум */
  maximize: boolean;
  /** Выпавшие 1 и 2 считаются как 3 */
  lowAsThree: boolean;
  /** Первая кость после отдыха ещё не потрачена — одна кость бесплатна */
  freeDie: boolean;
}

/** Правила траты костей хитов без черт: бросок как есть, все кости тратятся */
export const NO_HIT_DICE_SPEND_RULES: HitDiceSpendRules = {
  maximize: false,
  lowAsThree: false,
  freeDie: false,
};

/**
 * Правила траты костей хитов владельца: одни на короткий отдых и на цену
 * ресурсом — их дают флаги `hitDice.*` действующих эффектов.
 *
 * @param entity - владелец костей
 * @returns правила
 */
export function resolveHitDiceSpendRules(
  entity: DnDSceneEntity,
): HitDiceSpendRules {
  const flags: ReadonlySet<string> = resolveActorStats(entity).activeFlags;

  return {
    maximize: flags.has(HIT_DICE_MAXIMIZE_FLAG),
    lowAsThree: flags.has(HIT_DICE_LOW_AS_THREE_FLAG),
    freeDie:
      flags.has(HIT_DICE_FIRST_FREE_FLAG)
      && !isTriggerLimitReached(
        entity,
        FREE_HIT_DIE_USAGE_KEY,
        FREE_HIT_DIE_LIMIT,
      ),
  };
}

/**
 * На сколько вырастает сумма брошенных костей хитов от правила «1 и 2
 * считаются как 3»: окно отдыха бросает кости роллером приложения и поправляет
 * его сумму этим числом.
 *
 * @param values - выпавшие значения костей
 * @returns прибавка к сумме
 */
export function lowHitDiceBonus(values: readonly number[]): number {
  return values.reduce(
    (bonus, value) => bonus + Math.max(0, HIT_DIE_LOW_FLOOR - value),
    0,
  );
}

/** Бросок потраченных костей хитов */
export interface SpentHitDiceRoll {
  /** Значения костей — уже по правилам черт */
  values: number[];
  /** Сумма */
  total: number;
  /** Кости не бросались: взят максимум */
  maximized: boolean;
}

/**
 * Бросает потраченные кости хитов по правилам черт платящего: «максимум
 * вместо броска» и «1 и 2 считать как 3». Один путь на короткий отдых и на
 * цену ресурсом.
 *
 * @param die - грань
 * @param count - сколько костей
 * @param flags - действующие флаги платящего
 * @param random - источник случайности в [0, 1)
 * @returns значения и сумма
 */
export function rollSpentHitDice(
  die: number,
  count: number,
  flags: ReadonlySet<string>,
  random: () => number = Math.random,
): SpentHitDiceRoll {
  const maximized = flags.has(HIT_DICE_MAXIMIZE_FLAG);
  const floor = flags.has(HIT_DICE_LOW_AS_THREE_FLAG) ? HIT_DIE_LOW_FLOOR : 1;

  const values = Array.from({ length: Math.max(0, count) }, () =>
    maximized
      ? die
      : Math.min(die, Math.max(floor, Math.floor(random() * die) + 1)),
  );

  return {
    values,
    total: values.reduce((sum, value) => sum + value, 0),
    maximized,
  };
}

/**
 * Сколько костей хитов списать на деле: под флагом «первая после отдыха не
 * тратится» одна кость из первой траты остаётся у владельца. Отметка о
 * бесплатной кости пишется в счётчики лимитов листа (`system.effectUsage`) и
 * сбрасывается отдыхом вместе с ними.
 *
 * Мутирует счётчики переданной сущности — звать на копии.
 *
 * @param payer - платящий (меняется)
 * @param count - сколько костей тратит платёж
 * @param flags - действующие флаги платящего
 * @returns сколько костей списать
 */
export function takeFreeHitDie(
  payer: DnDSceneEntity,
  count: number,
  flags: ReadonlySet<string>,
): number {
  if (
    count <= 0
    || !flags.has(HIT_DICE_FIRST_FREE_FLAG)
    || isTriggerLimitReached(payer, FREE_HIT_DIE_USAGE_KEY, FREE_HIT_DIE_LIMIT)
  ) {
    return count;
  }

  consumeTriggerUse(payer, FREE_HIT_DIE_USAGE_KEY, FREE_HIT_DIE_LIMIT);

  return count - 1;
}

/**
 * Списывает кости хитов с листа персонажа.
 *
 * @param actor - лист (меняется)
 * @param die - грань
 * @param count - сколько костей списать
 */
function spendActorHitDice(actor: DnDActor, die: number, count: number): void {
  if (count <= 0 || !isHitDie(die)) {
    return;
  }

  const spent = spendHitDice(
    die,
    count,
    actor.system.classes,
    actor.system.manualHitDice,
  );

  actor.system.classes = spent.classes;
  actor.system.manualHitDice = spent.manualHitDice;
}

/**
 * Списывает ячейку заклинания с листа персонажа.
 *
 * @param actor - лист (меняется)
 * @param level - круг
 * @param pact - ячейка договора
 */
function spendActorSlot(actor: DnDActor, level: number, pact: boolean): void {
  if (pact) {
    actor.system.pactSlotsUsed = (actor.system.pactSlotsUsed ?? 0) + 1;

    return;
  }

  const used = Array.from(
    { length: MAX_SPELL_SLOT_LEVEL },
    (_, index) => actor.system.spellSlotsUsed?.[index] ?? 0,
  );

  used[level - 1] = (used[level - 1] ?? 0) + 1;
  actor.system.spellSlotsUsed = used;
}

/**
 * Оплата костями хитов: списание, бросок и строка для чата.
 *
 * @param payer - платящий (меняется)
 * @param option - выбранный вариант
 * @param paid - потраченное (пополняется)
 * @param context - бросать ли кости
 * @param random - источник случайности
 * @returns строка «что потрачено»
 */
function settleHitDice(
  payer: DnDSceneEntity,
  option: PayOption,
  paid: EffectPaid,
  context: PayContext,
  random: () => number,
): string {
  const die = option.die ?? 0;
  const flags = resolveActorStats(payer).activeFlags;
  const charged = takeFreeHitDie(payer, option.amount, flags);

  if (isActorEntity(payer)) {
    spendActorHitDice(payer, die, charged);
  }

  paid.hitDice = (paid.hitDice ?? 0) + option.amount;
  paid.hitDie = die;

  const head = [
    formatPriceHitDice(option.amount, die),
    charged < option.amount ? SETTLE_LABELS.freeDie : '',
    isActorEntity(payer) ? '' : SETTLE_LABELS.untracked,
  ].join('');

  if (context.rollHitDice === false) {
    return head;
  }

  const rolled = rollSpentHitDice(die, option.amount, flags, random);

  paid.hitDiceRoll = (paid.hitDiceRoll ?? 0) + rolled.total;

  const detail =
    rolled.values.length > 1
      ? `${rolled.values.join(' + ')} = ${rolled.total}`
      : String(rolled.total);

  return `${head}: ${detail}${rolled.maximized ? SETTLE_LABELS.maximized : ''}`;
}

/**
 * Списывает один платёж с копии платящего.
 *
 * @param payer - платящий (меняется)
 * @param price - платёж
 * @param option - выбранный вариант
 * @param paid - потраченное (пополняется)
 * @param context - предмет-источник и бросок костей
 * @param random - источник случайности
 * @returns строка «что потрачено» либо `null`, если платёж нулевой
 */
function settlePrice(
  payer: DnDSceneEntity,
  price: EffectPrice,
  option: PayOption,
  paid: EffectPaid,
  context: PayContext,
  random: () => number,
): string | null {
  switch (price.kind) {
    case 'counter': {
      if (option.amount <= 0 || !isActorEntity(payer)) {
        return null;
      }

      payer.system.classCounters = payer.system.classCounters.map((counter) =>
        counter.counterKey === price.counter
          ? {
              ...counter,
              current: Math.max(0, counter.current - option.amount),
            }
          : counter,
      );

      paid.counter = (paid.counter ?? 0) + option.amount;

      return option.label;
    }
    case 'hitDice':
      return option.amount > 0
        ? settleHitDice(payer, option, paid, context, random)
        : null;
    case 'spellSlot': {
      if (isActorEntity(payer)) {
        spendActorSlot(payer, option.amount, option.pact === true);
      }

      paid.slotLevel = option.amount;

      return option.label;
    }
    case 'itemUses': {
      if (option.amount <= 0) {
        return null;
      }

      payer.equipment = (payer.equipment ?? []).map((item) =>
        item.id === context.itemId && item.uses
          ? {
              ...item,
              uses: {
                ...item.uses,
                current: Math.max(0, item.uses.current - option.amount),
              },
            }
          : item,
      );

      paid.itemUses = (paid.itemUses ?? 0) + option.amount;

      return option.label;
    }
    default: {
      if (isActorEntity(payer)) {
        payer.system.inspiration = false;
      }

      return option.label;
    }
  }
}

/**
 * Списывает цену: по выбранному варианту каждого платежа. Исходная сущность не
 * меняется — возвращается копия со списанными ресурсами.
 *
 * Платёж без выбранного варианта пропускается: вызывающий отвечает за то,
 * чтобы выбор покрывал всю цену ({@link defaultPayPicks}, окно, вопрос).
 *
 * @param payer - кто платит
 * @param plan - разбор цены
 * @param picks - выбранные варианты — по одному на платёж
 * @param context - предмет-источник и бросок костей
 * @param random - источник случайности в [0, 1)
 * @returns платящий после оплаты, потраченное и строки для чата
 */
export function settleEffectPay(
  payer: DnDSceneEntity,
  plan: PayPlan,
  picks: readonly PayOption[],
  context: PayContext = {},
  random: () => number = Math.random,
): PaySettlement {
  const entity = cloneEntityData(payer);
  const paid: EffectPaid = {};
  const notes: string[] = [];
  const pickedIds = new Set(picks.map((pick) => pick.id));

  for (const entry of plan.prices) {
    const option = entry.options.find((candidate) =>
      pickedIds.has(candidate.id),
    );

    if (!option) {
      continue;
    }

    const note = settlePrice(
      entity,
      entry.price,
      option,
      paid,
      context,
      random,
    );

    if (note) {
      notes.push(note);
    }
  }

  return { entity, paid, notes };
}

/**
 * Переносит списанные ресурсы на живую сущность сервера: счётчики, кости
 * хитов, ячейки, вдохновение, заряды предметов и отметку бесплатной кости.
 * Эффекты и хиты не трогаются — их в это время меняет само срабатывание.
 *
 * @param live - живая сущность (меняется)
 * @param settled - платящий после оплаты
 */
export function applyPaySettlement(
  live: DnDSceneEntity,
  settled: DnDSceneEntity,
): void {
  live.equipment = settled.equipment;
  live.system.effectUsage = settled.system.effectUsage;

  if (!isActorEntity(live) || !isActorEntity(settled)) {
    return;
  }

  live.system.classCounters = settled.system.classCounters;
  live.system.classes = settled.system.classes;
  live.system.manualHitDice = settled.system.manualHitDice;
  live.system.spellSlotsUsed = settled.system.spellSlotsUsed;
  live.system.pactSlotsUsed = settled.system.pactSlotsUsed;
  live.system.inspiration = settled.system.inspiration;
}

/** Поля листа, которые меняет оплата: их несёт обычное сохранение сущности */
const SHEET_RESOURCE_FIELDS = [
  'classCounters',
  'classes',
  'manualHitDice',
  'spellSlotsUsed',
  'pactSlotsUsed',
  'inspiration',
] as const;

/**
 * Ресурсы листа одной строкой — для сравнения «изменились ли».
 *
 * @param entity - сущность
 * @returns ресурсы листа и предметы
 */
function serializeSheetResources(entity: DnDSceneEntity): string {
  const system: Record<string, unknown> = entity.system;

  return JSON.stringify([
    SHEET_RESOURCE_FIELDS.map((field) => system[field] ?? null),
    entity.equipment ?? null,
  ]);
}

/**
 * Разошлись ли ресурсы листа у двух копий сущности: счётчики, кости хитов,
 * ячейки, вдохновение, предметы. Боевой канал их не несёт — такую разницу надо
 * сохранять обычным сохранением сущности.
 *
 * @param before - сущность до действия
 * @param after - сущность после действия
 * @returns `true`, если ресурсы изменились
 */
export function sheetResourcesDiffer(
  before: DnDSceneEntity,
  after: DnDSceneEntity,
): boolean {
  return serializeSheetResources(before) !== serializeSheetResources(after);
}

/**
 * Сущность с ресурсами листа из другой её копии: счётчики, кости хитов,
 * ячейки, вдохновение и предметы — оттуда, остальное (хиты, эффекты) — своё.
 * Так оплата сохраняется отдельно от боевого снимка.
 *
 * @param base - сущность, чьи хиты и эффекты остаются
 * @param spent - копия со списанными ресурсами
 * @returns новая сущность
 */
export function withSheetResources(
  base: DnDSceneEntity,
  spent: DnDSceneEntity,
): DnDSceneEntity {
  const merged = cloneEntityData(base);

  applyPaySettlement(merged, spent);

  return merged;
}

/**
 * Читает ли цена круг каста: тогда круг надо знать до оплаты.
 *
 * @param pay - цена
 * @returns `true`, если количество хоть одного платежа считается от круга
 */
export function payUsesCastLevel(pay: EffectPay | undefined): boolean {
  return (pay ?? []).some(
    (price) =>
      priceHasAmount(price)
      && [price.amount, price.max].some((formula) =>
        formula?.includes(CAST_LEVEL_TOKEN),
      ),
  );
}

/**
 * Цена применения или каста: цена первого эффекта источника, у которого она
 * задана. Цена принадлежит кнопке или касту целиком, а не каждому эффекту
 * порознь, — поэтому второй эффект с ценой её не удваивает.
 *
 * @param effects - эффекты источника (заклинания, применения, варианта)
 * @returns цена либо `undefined`, если платить не за что
 */
export function collectSourcePay(
  effects: readonly ActiveEffect[] | undefined,
): EffectPay | undefined {
  return (effects ?? []).find(
    (effect) => !effect.disabled && effect.pay !== undefined,
  )?.pay;
}

/**
 * Читает ли кто-нибудь сумму броска потраченных костей хитов: без этого кости
 * только тратятся и бросать их незачем.
 *
 * Проверка — по записи целиком: токен может стоять в уроне заклинания, в
 * формуле эффекта, в действии срабатывания или в тексте сообщения.
 *
 * @param holder - заклинание, эффект или срабатывание
 * @returns `true`, если бросок нужен
 */
export function usesPaidHitDiceRoll(holder: unknown): boolean {
  return JSON.stringify(holder ?? null).includes(paidTokenOf('hitDiceRoll'));
}

/**
 * Есть ли в записи хоть один токен потраченного.
 *
 * @param holder - заклинание, эффект или срабатывание
 * @returns `true`, если токены есть
 */
export function usesPaidTokens(holder: unknown): boolean {
  return JSON.stringify(holder ?? null).includes(PAID_TOKEN_PREFIX);
}

/**
 * Что делать со срабатыванием на живом субъекте перед его действиями: списать
 * цену и вписать потраченное в формулы. `null` — платить уже нечем.
 */
export type TriggerSourcePreparer = (
  liveSubject: DnDSceneEntity,
  source: EffectTriggerSource,
) => PreparedTriggerSource | null;

/** Срабатывание, готовое к действиям, и строки сводки о подготовке */
export interface PreparedTriggerSource {
  source: EffectTriggerSource;
  notes: string[];
}

/**
 * С чем считается цена срабатывания: заряды берутся с предмета, который
 * принёс эффект, кости бросаются, только если их сумму кто-то читает.
 *
 * @param source - срабатывание с источником
 * @returns контекст оплаты
 */
export function buildTriggerPayContext(
  source: EffectTriggerSource,
): PayContext {
  return {
    ...(source.effect.carriedItemId
      ? { itemId: source.effect.carriedItemId }
      : {}),
    rollHitDice: usesPaidHitDiceRoll(source.trigger),
  };
}

/**
 * Списывает цену срабатывания с живого субъекта и вписывает потраченное в
 * формулы его действий.
 *
 * Варианты считаются заново по живой сущности: пока человек отвечал, ресурс
 * могли потратить. Выбранного варианта больше нет — платить нечем.
 *
 * @param liveSubject - живой субъект (меняется)
 * @param source - срабатывание с источником
 * @param pickIds - ключи выбранных вариантов; нет — варианты по умолчанию
 * @returns срабатывание с числами и строка сводки либо `null`
 */
export function payTriggerPrice(
  liveSubject: DnDSceneEntity,
  source: EffectTriggerSource,
  pickIds?: ReadonlySet<string>,
): PreparedTriggerSource | null {
  const { pay } = source.trigger;

  if (!pay) {
    return { source, notes: [] };
  }

  const context = buildTriggerPayContext(source);
  const plan = planEffectPay(liveSubject, pay, context);

  const picks = pickIds
    ? plan.prices.flatMap((entry) =>
        entry.options.filter((option) => pickIds.has(option.id)).slice(0, 1),
      )
    : defaultPayPicks(plan);

  if (plan.shortfall !== null || !picks || picks.length < plan.prices.length) {
    return null;
  }

  const settlement = settleEffectPay(liveSubject, plan, picks, context);

  applyPaySettlement(liveSubject, settlement.entity);

  const { pay: _pay, ...trigger } = bindTriggerPaid(
    source.trigger,
    settlement.paid,
  );

  return {
    source: { ...source, trigger },
    notes:
      settlement.notes.length > 0
        ? [
            `${source.effect.name} — ${SETTLE_LABELS.paid}: ${settlement.notes.join(EFFECT_PRICE_LABELS.paidJoiner)}`,
          ]
        : [],
  };
}

/**
 * Срабатывание с ценой там, где спросить человека нечем (старое ядро, прогон
 * на клиенте): цена без выбора списывается сама, цена с выбором или не по
 * карману срабатывание отменяет.
 *
 * @param subject - субъект (меняется)
 * @param source - срабатывание с источником
 * @returns срабатывание с числами либо `null`, если оно не состоится
 */
export function settleUnaskedTriggerPay(
  subject: DnDSceneEntity,
  source: EffectTriggerSource,
): PreparedTriggerSource | null {
  const { pay } = source.trigger;

  if (!pay) {
    return { source, notes: [] };
  }

  const plan = planEffectPay(subject, pay, buildTriggerPayContext(source));

  return plan.shortfall === null && !payNeedsChoice(plan)
    ? payTriggerPrice(subject, source)
    : null;
}
