/**
 * «Цена» эффекта ресурсом: чем платят за применение, включение, каст или
 * срабатывание.
 *
 * Правила сплошь и рядом берут плату не действием, а ресурсом: «потратьте
 * ячейку заклинания», «бросьте одну или две свои Кости Хитов», «потратьте 6
 * очков удали». Раньше применение умело списать один счётчик листа
 * (`activation.counter`), а срабатывание — ничего. Цена описывает плату одной
 * формой на все три места: список платежей, каждый — своего вида.
 *
 * Здесь только форма данных и её разбор: модуль не зависит ни от эффекта, ни
 * от срабатывания, поэтому оба ссылаются на него без круга. Расчёт — в
 * {@link module:system/dnd/effectPay}, подстановка потраченного в формулы — в
 * {@link module:system/dnd/effectPaidTokens}.
 *
 * @module system/dnd/effectPayTypes
 */

import { z } from 'zod';

import { parseEachValid } from './lenientParse.js';
import {
  MAX_SPELL_SLOT_LEVEL,
  MIN_SPELL_SLOT_LEVEL,
} from './spellSlotTable.js';

/** Чем платят: виды цены */
export const EFFECT_PRICE_KINDS = [
  'counter',
  'hitDice',
  'spellSlot',
  'itemUses',
  'inspiration',
] as const;

/**
 * Вид цены: счётчик листа, кости хитов, ячейка заклинания, заряды предмета или
 * героическое вдохновение.
 */
export type EffectPriceKind = (typeof EFFECT_PRICE_KINDS)[number];

/** Вид новой строки цены: счётчик листа — самый частый */
export const DEFAULT_EFFECT_PRICE_KIND: EffectPriceKind = 'counter';

/** Сколько единиц тратит цена без поля `amount` */
export const DEFAULT_PRICE_AMOUNT = '1';

/** Больше платежей у одной цены не бывает */
export const MAX_EFFECT_PRICES = 4;

/** Самая длинная формула количества и ключ счётчика */
const MAX_PRICE_TEXT_LENGTH = 100;

/**
 * Количество цены: сколько единиц и до скольких может выбрать игрок.
 *
 * `amount` — число или формула (`@castLevel`, `1 + @mod.con`); нет — одна
 * единица. `max` — верхняя граница выбора: игрок платит от `amount` до `max`
 * («одну или две кости», «от 1 до 5 единиц»). `amount: "0"` с `max` — цена по
 * желанию: ноль значит «не тратить».
 */
export interface EffectPriceAmount {
  /** Сколько единиц: число или формула; нет — одна */
  amount?: string;
  /** Верхняя граница выбора; нет — ровно `amount` */
  max?: string;
}

/** Счётчик листа (`system.classCounters`): очки, использования умения */
export interface EffectCounterPrice extends EffectPriceAmount {
  kind: 'counter';
  /** Ключ счётчика листа */
  counter: string;
}

/**
 * Кости хитов платящего. Бросаются при оплате один раз — сумма уходит в
 * `@paid.hitDiceRoll`, число и грань — в `@paid.hitDice` и `@paid.hitDie`.
 */
export interface EffectHitDicePrice extends EffectPriceAmount {
  kind: 'hitDice';
}

/** Ячейка заклинания: круг выбирает игрок в пределах */
export interface EffectSpellSlotPrice {
  kind: 'spellSlot';
  /** Наименьший круг ячейки; нет — первый */
  minLevel?: number;
  /** Наибольший круг ячейки; нет — девятый */
  maxLevel?: number;
  /** Только ячейка договора колдуна */
  pact?: true;
}

/**
 * Заряды предмета, с которого пришёл эффект: своя цена у каждого свойства
 * («первое слово — бесплатно, третье — 5 зарядов»). Ноль — свойство зарядов не
 * тратит. Заменяет обычный расход применения предмета.
 */
export interface EffectItemUsesPrice extends EffectPriceAmount {
  kind: 'itemUses';
}

/** Героическое вдохновение платящего */
export interface EffectInspirationPrice {
  kind: 'inspiration';
}

/** Один платёж цены */
export type EffectPrice =
  | EffectCounterPrice
  | EffectHitDicePrice
  | EffectSpellSlotPrice
  | EffectItemUsesPrice
  | EffectInspirationPrice;

/**
 * Цена: список платежей, платятся ВСЕ («кость хитов и использование умения»).
 * Платит тот, кто применяет, включает или колдует; у срабатывания — носитель
 * эффекта.
 */
export type EffectPay = EffectPrice[];

/**
 * Что потрачено: числа, которые подставляются вместо токенов `@paid.*`.
 * Хранятся у наложенного или включённого эффекта — как круг каста.
 */
export interface EffectPaid {
  /** Сколько единиц счётчиков потрачено (`@paid.counter`) */
  counter?: number;
  /** Сколько костей хитов потрачено (`@paid.hitDice`) */
  hitDice?: number;
  /** Грань потраченных костей хитов (`@paid.hitDie`) */
  hitDie?: number;
  /** Сумма броска потраченных костей хитов (`@paid.hitDiceRoll`) */
  hitDiceRoll?: number;
  /** Круг потраченной ячейки (`@paid.slotLevel`) */
  slotLevel?: number;
  /** Сколько зарядов предмета потрачено (`@paid.itemUses`) */
  itemUses?: number;
}

/** Поля потраченного — в порядке токенов */
export const EFFECT_PAID_FIELDS = [
  'counter',
  'hitDice',
  'hitDie',
  'hitDiceRoll',
  'slotLevel',
  'itemUses',
] as const satisfies ReadonlyArray<keyof EffectPaid>;

/** Поле потраченного */
export type EffectPaidField = (typeof EFFECT_PAID_FIELDS)[number];

/** Приставка токенов потраченного */
export const PAID_TOKEN_PREFIX = '@paid.';

/**
 * Токен потраченного по его полю.
 *
 * @param field - поле потраченного
 * @returns токен с `@`
 */
export function paidTokenOf(field: EffectPaidField): string {
  return `${PAID_TOKEN_PREFIX}${field}`;
}

/** Zod-схема формулы количества: число тоже приводится к строке */
const PriceFormulaSchema = z
  .preprocess(
    (value) => (typeof value === 'number' ? String(value) : value),
    z.string().trim().min(1).max(MAX_PRICE_TEXT_LENGTH),
  )
  .optional()
  .catch(undefined);

/** Zod-схема круга ячейки цены */
const PriceSlotLevelSchema = z
  .number()
  .int()
  .min(MIN_SPELL_SLOT_LEVEL)
  .max(MAX_SPELL_SLOT_LEVEL)
  .optional()
  .catch(undefined);

/** Zod-схема одного платежа цены */
const EffectPriceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('counter'),
    counter: z.string().trim().min(1).max(MAX_PRICE_TEXT_LENGTH),
    amount: PriceFormulaSchema,
    max: PriceFormulaSchema,
  }),
  z.object({
    kind: z.literal('hitDice'),
    amount: PriceFormulaSchema,
    max: PriceFormulaSchema,
  }),
  z.object({
    kind: z.literal('spellSlot'),
    minLevel: PriceSlotLevelSchema,
    maxLevel: PriceSlotLevelSchema,
    pact: z.literal(true).optional().catch(undefined),
  }),
  z.object({
    kind: z.literal('itemUses'),
    amount: PriceFormulaSchema,
    max: PriceFormulaSchema,
  }),
  z.object({ kind: z.literal('inspiration') }),
]);

/**
 * Zod-схема цены. Платежи разбираются ПО ОДНОМУ: незнакомый вид выбрасывает
 * один платёж, а не цену и не эффект. Пустая цена не хранится.
 */
export const EffectPaySchema = z
  .array(z.unknown())
  .transform((rawPrices): EffectPay | undefined => {
    const prices = parseEachValid(EffectPriceSchema, rawPrices).slice(
      0,
      MAX_EFFECT_PRICES,
    );

    return prices.length > 0 ? prices : undefined;
  })
  .optional()
  .catch(undefined);

/** Zod-схема числа потраченного: целое и не меньше нуля */
const PaidNumberSchema = z.number().int().min(0).optional().catch(undefined);

/** Zod-схема потраченного у наложенного эффекта */
export const EffectPaidSchema = z
  .object({
    counter: PaidNumberSchema,
    hitDice: PaidNumberSchema,
    hitDie: PaidNumberSchema,
    hitDiceRoll: PaidNumberSchema,
    slotLevel: PaidNumberSchema,
    itemUses: PaidNumberSchema,
  })
  .optional()
  .catch(undefined);

/**
 * Есть ли у платежа количество: ячейка и вдохновение тратятся по одной.
 *
 * @param price - платёж
 * @returns `true`, если у платежа читаются `amount` и `max`
 */
export function priceHasAmount(
  price: EffectPrice,
): price is EffectCounterPrice | EffectHitDicePrice | EffectItemUsesPrice {
  return (
    price.kind === 'counter'
    || price.kind === 'hitDice'
    || price.kind === 'itemUses'
  );
}

/** Подписи платежей — для описания цены, вариантов оплаты и чата */
export const EFFECT_PRICE_LABELS = {
  slot: 'ячейка',
  pactSlot: 'ячейка договора',
  slotLevelSuffix: ' круга',
  slotFrom: ' от ',
  slotUpTo: ' до ',
  hitDiceForms: ['кость хитов', 'кости хитов', 'костей хитов'],
  itemUsesForms: ['заряд', 'заряда', 'зарядов'],
  inspiration: 'героическое вдохновение',
  payJoiner: ' и ',
  paidJoiner: '; ',
  paidRollPrefix: ', бросок ',
  paidCounterForms: ['единица счётчика', 'единицы счётчика', 'единиц счётчика'],
} as const;

/** Формы слова по числу: одна кость, две кости, пять костей */
type PluralForms = readonly [string, string, string];

/**
 * Русская форма слова по числу.
 *
 * @param count - число
 * @param forms - формы: одна, две, пять
 * @returns форма слова
 */
export function pluralizePrice(count: number, forms: PluralForms): string {
  const tens = Math.abs(count) % 100;
  const ones = tens % 10;

  if (tens > 10 && tens < 20) {
    return forms[2];
  }

  if (ones === 1) {
    return forms[0];
  }

  return ones >= 2 && ones <= 4 ? forms[1] : forms[2];
}

/**
 * Платёж словами — для описания эффекта, вопроса и отказа: «ячейка от 4
 * круга», «1–2 кости хитов», «6 «Очки удали»».
 *
 * Формула количества остаётся формулой: числа платящего здесь неизвестны.
 *
 * @param price - платёж
 * @param counterName - название счётчика; нет — его ключ
 * @returns платёж словами
 */
export function describeEffectPrice(
  price: EffectPrice,
  counterName?: (counterKey: string) => string,
): string {
  const amount = priceHasAmount(price)
    ? formatPriceAmount(price)
    : DEFAULT_PRICE_AMOUNT;

  switch (price.kind) {
    case 'counter':
      return `${amount} «${counterName?.(price.counter) ?? price.counter}»`;
    case 'hitDice':
      return `${amount} ${pluralizeFormula(amount, EFFECT_PRICE_LABELS.hitDiceForms)}`;
    case 'itemUses':
      return `${amount} ${pluralizeFormula(amount, EFFECT_PRICE_LABELS.itemUsesForms)}`;
    case 'spellSlot': {
      const name = price.pact
        ? EFFECT_PRICE_LABELS.pactSlot
        : EFFECT_PRICE_LABELS.slot;

      const minLevel = price.minLevel ?? MIN_SPELL_SLOT_LEVEL;

      const from =
        minLevel > MIN_SPELL_SLOT_LEVEL
          ? `${EFFECT_PRICE_LABELS.slotFrom}${minLevel}`
          : '';

      const upTo =
        price.maxLevel === undefined
          ? ''
          : `${EFFECT_PRICE_LABELS.slotUpTo}${price.maxLevel}`;

      return from || upTo
        ? `${name}${from}${upTo}${EFFECT_PRICE_LABELS.slotLevelSuffix}`
        : name;
    }
    default:
      return EFFECT_PRICE_LABELS.inspiration;
  }
}

/**
 * Количество платежа словами: «2», «1–2», «0–@castLevel».
 *
 * @param price - платёж с количеством
 * @returns количество
 */
function formatPriceAmount(price: EffectPriceAmount): string {
  const amount = price.amount ?? DEFAULT_PRICE_AMOUNT;

  return price.max === undefined || price.max === amount
    ? amount
    : `${amount}–${price.max}`;
}

/**
 * Форма слова по количеству словами: у числа — по числу, у диапазона и
 * формулы — множественная («1–2 костей хитов» читается хуже, чем «кости»).
 *
 * @param amount - количество словами
 * @param forms - формы слова
 * @returns форма слова
 */
function pluralizeFormula(amount: string, forms: PluralForms): string {
  const value = Number(amount);

  return Number.isInteger(value) ? pluralizePrice(value, forms) : forms[1];
}

/**
 * Цена словами: платежи через «и».
 *
 * @param pay - цена
 * @param counterName - название счётчика; нет — его ключ
 * @returns цена словами; пусто — цены нет
 */
export function describeEffectPay(
  pay: EffectPay | undefined,
  counterName?: (counterKey: string) => string,
): string {
  return (pay ?? [])
    .map((price) => describeEffectPrice(price, counterName))
    .join(EFFECT_PRICE_LABELS.payJoiner);
}

/**
 * Потраченное словами — для карточки эффекта: «ячейка 3 круга; 2 кости хитов
 * (к10), бросок 11».
 *
 * @param paid - потраченное
 * @returns перечисление; пусто — ничего не потрачено
 */
export function describeEffectPaid(paid: EffectPaid | undefined): string {
  if (!paid) {
    return '';
  }

  const parts: string[] = [];

  if (paid.slotLevel !== undefined) {
    parts.push(
      `${EFFECT_PRICE_LABELS.slot} ${paid.slotLevel}${EFFECT_PRICE_LABELS.slotLevelSuffix}`,
    );
  }

  if (paid.hitDice) {
    const dice = `${paid.hitDice} ${pluralizePrice(paid.hitDice, EFFECT_PRICE_LABELS.hitDiceForms)}`;
    const die = paid.hitDie ? ` (к${paid.hitDie})` : '';

    const roll =
      paid.hitDiceRoll === undefined
        ? ''
        : `${EFFECT_PRICE_LABELS.paidRollPrefix}${paid.hitDiceRoll}`;

    parts.push(`${dice}${die}${roll}`);
  }

  if (paid.counter) {
    parts.push(
      `${paid.counter} ${pluralizePrice(paid.counter, EFFECT_PRICE_LABELS.paidCounterForms)}`,
    );
  }

  if (paid.itemUses) {
    parts.push(
      `${paid.itemUses} ${pluralizePrice(paid.itemUses, EFFECT_PRICE_LABELS.itemUsesForms)}`,
    );
  }

  return parts.join(EFFECT_PRICE_LABELS.paidJoiner);
}
