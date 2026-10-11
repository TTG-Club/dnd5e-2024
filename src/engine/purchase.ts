/**
 * Покупка предметов за монеты кошелька.
 *
 * Цена записи компендиума приходит строкой («15 зм») или объектом
 * `{ value, currency }`, а кошелёк держит пять видов монет. Чтобы сложить цены
 * разных монет и сравнить их с кошельком, всё сводится к медным — самой мелкой
 * монете: в них любая цена и любой кошелёк — целое число.
 *
 * @module system/dnd/purchase
 */

import type { CurrencyType } from './consts.js';
import type { DnDGameItem } from './dndEntities.js';
import type { DnDCurrency } from './types.js';

import { CURRENCY_OPTIONS, currencyShortLabel, parseCost } from './consts.js';

/** Сколько медных монет в одной монете каждого вида (PHB 2024, «Монеты»). */
export const COIN_VALUE_IN_COPPER: Readonly<Record<CurrencyType, number>> = {
  cp: 1,
  sp: 10,
  ep: 50,
  gp: 100,
  pp: 1000,
};

/**
 * Монеты, которыми записывают сумму: золотые, серебряные, медные. Платина и
 * электрум в ценах книг не встречаются — «1500 зм», а не «150 пм», — и сумма,
 * собранная из них, читалась бы хуже.
 */
const AMOUNT_COINS: readonly CurrencyType[] = ['gp', 'sp', 'cp'];

/**
 * Порядок, в котором кошелёк платит без размена: сначала теми монетами, в
 * которых названа цена (золото, серебро, медь), и только потом редкими —
 * электрумом и платиной.
 */
const EXACT_PAY_ORDER: readonly CurrencyType[] = ['gp', 'sp', 'cp', 'ep', 'pp'];

/** Порядок размена: разбивается самая мелкая из оставшихся монет. */
const BREAK_ORDER: readonly CurrencyType[] = ['cp', 'sp', 'ep', 'gp', 'pp'];

/** Пустой кошелёк — основа для сборки суммы из монет. */
const EMPTY_WALLET: DnDCurrency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };

/**
 * Цена предмета в медных монетах. Запись без цены стоит ноль — её отдают
 * даром, а не отказываются продавать.
 *
 * @param cost - цена предмета строкой или объектом
 * @returns цена в медных монетах, целое неотрицательное число
 */
export function itemCostInCopper(
  cost: DnDGameItem['cost'] | undefined | null,
): number {
  const parsed = parseCost(cost);

  return Math.max(
    0,
    Math.round(parsed.value * COIN_VALUE_IN_COPPER[parsed.currency]),
  );
}

/**
 * Сумма цен предметов в медных монетах.
 *
 * @param items - покупаемые предметы
 * @returns общая цена в медных монетах
 */
export function totalCostInCopper(
  items: ReadonlyArray<Pick<DnDGameItem, 'cost'>>,
): number {
  return items.reduce((sum, item) => sum + itemCostInCopper(item.cost), 0);
}

/**
 * Сколько всего денег в кошельке — в медных монетах.
 *
 * @param currency - кошелёк
 * @returns сумма всех монет в медных
 */
export function walletValueInCopper(currency: DnDCurrency): number {
  return CURRENCY_OPTIONS.reduce(
    (sum, option) =>
      sum + currency[option.value] * COIN_VALUE_IN_COPPER[option.value],
    0,
  );
}

/**
 * Раскладывает сумму в медных на золотые, серебряные и медные — так, как её
 * записали бы в книге: 1530 медных — это «15 зм 3 см».
 *
 * @param copper - сумма в медных монетах
 * @returns монеты суммы; электрума и платины в ней нет
 */
export function splitCopperIntoCoins(copper: number): DnDCurrency {
  let remaining = Math.max(0, Math.round(copper));
  let coins = EMPTY_WALLET;

  for (const coin of AMOUNT_COINS) {
    const count = Math.floor(remaining / COIN_VALUE_IN_COPPER[coin]);

    coins = { ...coins, [coin]: count };
    remaining -= count * COIN_VALUE_IN_COPPER[coin];
  }

  return coins;
}

/**
 * Подпись набора монет: «2 пм 15 зм 3 см», от крупных к мелким. Пустой набор
 * подписан нулём золотых — пустая строка в окне покупки читалась бы как сбой.
 *
 * @param currency - монеты
 * @returns строка для показа
 */
export function formatCoins(currency: DnDCurrency): string {
  const parts = CURRENCY_OPTIONS.filter((option) => currency[option.value] > 0)
    .map((option) => `${currency[option.value]} ${option.labelShort}`)
    .reverse();

  return parts.length > 0 ? parts.join(' ') : `0 ${currencyShortLabel()}`;
}

/**
 * Подпись суммы в медных: «15 зм 3 см».
 *
 * @param copper - сумма в медных монетах
 * @returns строка для показа
 */
export function formatCopperAmount(copper: number): string {
  return formatCoins(splitCopperIntoCoins(copper));
}

/**
 * Кошелёк после оплаты.
 *
 * Монеты не пересчитываются в «удобные»: тысяча медных остаётся тысячей
 * медных. Сначала кошелёк платит без размена, начиная с золота. Если ровно не
 * набралось, разбивается одна самая мелкая из оставшихся монет, а сдача с неё
 * возвращается золотом, серебром и медью.
 *
 * @param currency - кошелёк до оплаты
 * @param costInCopper - цена в медных монетах
 * @returns новый кошелёк либо `undefined`, если денег не хватает; исходный
 *   кошелёк не меняется
 */
export function payFromWallet(
  currency: DnDCurrency,
  costInCopper: number,
): DnDCurrency | undefined {
  if (costInCopper <= 0) {
    return currency;
  }

  if (walletValueInCopper(currency) < costInCopper) {
    return undefined;
  }

  let remaining = costInCopper;
  let wallet = currency;

  for (const coin of EXACT_PAY_ORDER) {
    const spent = Math.min(
      wallet[coin],
      Math.floor(remaining / COIN_VALUE_IN_COPPER[coin]),
    );

    wallet = { ...wallet, [coin]: wallet[coin] - spent };
    remaining -= spent * COIN_VALUE_IN_COPPER[coin];
  }

  // После оплаты без размена любая оставшаяся монета дороже остатка цены:
  // хватает одной, и остаток уходит в минус — это сдача
  for (const coin of BREAK_ORDER) {
    if (remaining > 0 && wallet[coin] > 0) {
      wallet = { ...wallet, [coin]: wallet[coin] - 1 };
      remaining -= COIN_VALUE_IN_COPPER[coin];
    }
  }

  const change = splitCopperIntoCoins(-remaining);

  return {
    ...wallet,
    gp: wallet.gp + change.gp,
    sp: wallet.sp + change.sp,
    cp: wallet.cp + change.cp,
  };
}

/**
 * Кошелёк после получения денег — выручки за проданный предмет.
 *
 * Сумма ложится золотом, серебром и медью, как её записали бы в книге:
 * остальные монеты кошелька остаются как были.
 *
 * @param currency - кошелёк до получения
 * @param amountInCopper - сумма в медных монетах; не больше нуля — класть нечего
 * @returns новый кошелёк; исходный не меняется
 */
export function receiveIntoWallet(
  currency: DnDCurrency,
  amountInCopper: number,
): DnDCurrency {
  if (amountInCopper <= 0) {
    return currency;
  }

  const coins = splitCopperIntoCoins(amountInCopper);

  return {
    ...currency,
    gp: currency.gp + coins.gp,
    sp: currency.sp + coins.sp,
    cp: currency.cp + coins.cp,
  };
}

/** Итог покупки: во что она обойдётся кошельку. */
export interface PurchaseSummary {
  /** Цена всех предметов в медных монетах */
  costInCopper: number;
  /** Сколько не хватает, в медных; ноль — денег достаточно */
  shortageInCopper: number;
  /** Кошелёк после покупки; `undefined` — денег не хватает */
  walletAfter: DnDCurrency | undefined;
}

/**
 * Считает покупку: общую цену, нехватку и кошелёк после оплаты.
 *
 * @param currency - кошелёк покупателя
 * @param items - покупаемые предметы
 * @returns итог покупки
 */
export function summarizePurchase(
  currency: DnDCurrency,
  items: ReadonlyArray<Pick<DnDGameItem, 'cost'>>,
): PurchaseSummary {
  const costInCopper = totalCostInCopper(items);

  return {
    costInCopper,
    shortageInCopper: Math.max(0, costInCopper - walletValueInCopper(currency)),
    walletAfter: payFromWallet(currency, costInCopper),
  };
}
