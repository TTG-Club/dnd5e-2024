/**
 * Урон «или» у действия существа: другие наборы частей урона, из которых при
 * атаке берётся один. «20 (4к8 + 2), или 11 (2к8 + 2), если рой окровавлен» —
 * основной урон `4к8@dmg.necrotic + 2` и вариант
 * `2к8@dmg.necrotic@self.status.bloodied + 2`.
 *
 * Вариант — целый набор частей урона, а не одна формула: у существа меняется
 * весь удар («колющий и яд» становится «только колющим»). Вариант ЗАМЕНЯЕТ
 * основной урон, а не прибавляется к нему.
 *
 * Условие варианта пишется в его формуле — состоянием (`@self.status.*`,
 * `@target.status.*`). Вариант с состоянием берётся САМ, когда все его
 * состояния есть, и выпадает, когда нет: частное главнее общего. Способ
 * `formula` — «по формуле» — как раз такой вариант; остальные способы — для
 * вариантов без состояний: спросить бросающего или бросить случай.
 *
 * Выбор делается до окна броска: окно получает уже выбранные части, и весь
 * дальнейший путь (бонусы эффектов, спасброски, защиты цели) о вариантах не
 * знает.
 */

import type { DamagePart } from '@vtt/shared';

import type { CreatureAction } from './creatureTypes.js';
import type { StatusToken } from './formulaTokens.js';

import { z } from 'zod';

import { EffectDamagePartSchema } from './activeEffectTypes.js';
import {
  readStatusToken,
  splitFormulaTerms,
  stripStatusTokens,
} from './formulaTokens.js';
import { readDamageStatusName } from './spellUtils.js';

/**
 * Как выбирается вариант:
 * - `formula` — по состояниям в его формуле: берётся сам, когда они все есть.
 *   Без состояний в формуле такой вариант не берётся никогда — автор его ещё
 *   не дописал;
 * - `ask` — решает бросающий («если у химеры было преимущество», любое «одно
 *   из двух»);
 * - `random` — движок бросает сам, какой из наборов пойдёт.
 *
 * Состояние в формуле главнее способа: вариант с ним берётся сам при любом
 * способе — так читаются и записи, сделанные до появления `formula`.
 */
export const CREATURE_DAMAGE_CONDITIONS = ['formula', 'ask', 'random'] as const;

/** Способ выбора варианта урона */
export type CreatureDamageCondition =
  (typeof CREATURE_DAMAGE_CONDITIONS)[number];

/** Способ «по формуле»: вариант решают состояния в его формуле */
export const FORMULA_CREATURE_DAMAGE_CONDITION: CreatureDamageCondition =
  'formula';

/**
 * Способ нового варианта в окне действия. «По формуле» — потому что чаще всего
 * «или» в статблоке зависит от состояния («если рой окровавлен»).
 */
export const DEFAULT_CREATURE_DAMAGE_CONDITION: CreatureDamageCondition =
  FORMULA_CREATURE_DAMAGE_CONDITION;

/** Подписи способов выбора для списка в окне действия */
export const CREATURE_DAMAGE_CONDITION_LABELS: Record<
  CreatureDamageCondition,
  string
> = {
  formula: 'По формуле',
  ask: 'Выбрать при броске',
  random: 'Случайно',
};

/** Фраза способа выбора в сводке и чате */
const CONDITION_PHRASES: Record<CreatureDamageCondition, string> = {
  formula: 'по формуле',
  ask: 'на выбор при броске',
  random: 'случайно',
};

/**
 * Начало фразы по состоянию стороны: «если у атакующего: Окровавленный». Общее
 * для условия варианта «или» и строки броска в чате.
 */
export const DAMAGE_STATUS_PHRASE_PREFIXES: Record<
  StatusToken['side'],
  string
> = {
  self: 'если у атакующего: ',
  target: 'если у цели: ',
};

/** Между состояниями в одной фразе: «…Окровавленный и если у цели: …» */
const STATUS_PHRASE_JOINER = ' и ';

/**
 * Предел вариантов у одного действия. Статблоки 2024 года обходятся одним;
 * предел нужен против мусорных данных, а не против автора.
 */
export const MAX_CREATURE_DAMAGE_ALTERNATIVES = 5;

/** Вариант урона действия существа */
export interface CreatureDamageAlternative {
  /** Как выбирается вариант; состояние в формуле главнее способа */
  condition: CreatureDamageCondition;
  /**
   * Своя подпись варианта для вопроса при броске и для чата («С
   * преимуществом»). Нет — вариант называется своей формулой.
   */
  label?: string;
  /** Части урона варианта — целый набор вместо основного */
  damageParts: DamagePart[];
}

/**
 * Схема варианта. Данные приходят из компендиума и из мира как есть, поэтому
 * каждый вариант проверяется отдельно: битый выпадает, соседние остаются.
 */
const CreatureDamageAlternativeSchema = z.object({
  condition: z.enum(CREATURE_DAMAGE_CONDITIONS),
  label: z.string().trim().min(1).optional().catch(undefined),
  damageParts: z.array(EffectDamagePartSchema),
});

/**
 * Что известно в момент атаки: есть ли состояние у атакующего и у единой цели.
 * Нет проверки цели (область, цель не выбрана) — вариант с состоянием цели не
 * выбирается: проверять не на ком.
 */
export interface CreatureDamageContext {
  /** Есть ли состояние у атакующего */
  selfHasStatus?: (status: string) => boolean;
  /** Есть ли состояние у единой цели */
  targetHasStatus?: (status: string) => boolean;
}

/** Набор урона, которым пойдёт атака */
export interface CreatureDamageOption {
  /** Части урона набора */
  damageParts: DamagePart[];
  /** Вариант, из которого набор взят; нет — это основной урон действия */
  alternative?: CreatureDamageAlternative;
}

/**
 * Итог выбора: набор уже известен либо выбирать человеку — тогда в списке
 * основной урон и варианты без состояний. `matched` — сработали состояния
 * варианта, `rolled` — набор выпал случайно: то и другое называется в чате.
 */
export type CreatureDamageChoice =
  | {
      kind: 'resolved';
      option: CreatureDamageOption;
      matched?: true;
      rolled?: true;
    }
  | { kind: 'ask'; options: CreatureDamageOption[] };

/**
 * Части урона с непустой формулой: пустая строка — обычное состояние формы, а
 * не часть урона.
 *
 * @param parts - части урона
 * @returns части, которые есть что бросать
 */
function listFilledDamageParts(parts: readonly DamagePart[]): DamagePart[] {
  return parts.filter((part) => part.formula.trim().length > 0);
}

/**
 * Рабочие варианты урона действия: проверенные схемой, с непустыми частями и
 * не больше предела. Порядок сохраняется — из сработавших по состоянию
 * берётся верхний.
 *
 * @param action - действие существа
 * @returns варианты, готовые к выбору
 */
export function listCreatureDamageAlternatives(
  action: Pick<CreatureAction, 'damageAlternatives'>,
): CreatureDamageAlternative[] {
  // Поле пришло из JSON мира или компендиума: доверять его форме нельзя
  const raw: unknown = action.damageAlternatives;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .slice(0, MAX_CREATURE_DAMAGE_ALTERNATIVES)
    .flatMap((entry: unknown) => {
      const parsed = CreatureDamageAlternativeSchema.safeParse(entry);

      if (!parsed.success) {
        return [];
      }

      const { condition, label } = parsed.data;
      const damageParts = listFilledDamageParts(parsed.data.damageParts);

      if (damageParts.length === 0) {
        return [];
      }

      return [
        {
          condition,
          ...(label === undefined ? {} : { label }),
          damageParts,
        },
      ];
    });
}

/**
 * Состояния из формул варианта — его условие. Каждое состояние один раз, в
 * порядке первого появления.
 *
 * @param alternative - вариант урона
 * @returns состояния сторон, которые требует вариант
 */
export function listAlternativeStatuses(
  alternative: Pick<CreatureDamageAlternative, 'damageParts'>,
): StatusToken[] {
  const found = new Map<string, StatusToken>();

  for (const part of alternative.damageParts) {
    for (const term of splitFormulaTerms(part.formula)) {
      const token = readStatusToken(term);

      if (token) {
        found.set(`${token.side}:${token.status}`, token);
      }
    }
  }

  return [...found.values()];
}

/**
 * Части варианта для показа: без состояний в формуле. Состояния у варианта —
 * его условие: бросается он, только когда они все есть, так что в строке урона
 * они лишь повторили бы подпись условия.
 *
 * @param alternative - вариант урона
 * @returns части с формулами без состояний
 */
export function readAlternativeShownParts(
  alternative: Pick<CreatureDamageAlternative, 'damageParts'>,
): DamagePart[] {
  return alternative.damageParts.map((part) => ({
    ...part,
    formula: stripStatusTokens(part.formula),
  }));
}

/**
 * Фраза условия варианта для сводки и чата: состояния из формулы («если у
 * атакующего: Окровавленный») либо способ выбора («на выбор при броске»).
 *
 * @param alternative - вариант урона; без частей — только способ выбора
 * @returns фраза
 */
export function describeCreatureDamageCondition(
  alternative: Pick<CreatureDamageAlternative, 'condition'>
    & Partial<Pick<CreatureDamageAlternative, 'damageParts'>>,
): string {
  const statuses = alternative.damageParts
    ? listAlternativeStatuses({ damageParts: alternative.damageParts })
    : [];

  if (statuses.length === 0) {
    return CONDITION_PHRASES[alternative.condition];
  }

  return statuses
    .map(
      (token) =>
        `${DAMAGE_STATUS_PHRASE_PREFIXES[token.side]}${readDamageStatusName(token.status)}`,
    )
    .join(STATUS_PHRASE_JOINER);
}

/**
 * Выполнены ли все состояния варианта. Состояние цели без проверки цели
 * (область, цель не выбрана) не выполнено.
 *
 * @param statuses - состояния варианта
 * @param context - проверки состояний сторон
 * @returns `true`, если вариант должен заменить основной урон
 */
function statusesMatch(
  statuses: readonly StatusToken[],
  context: CreatureDamageContext,
): boolean {
  return statuses.every((token) => {
    const check =
      token.side === 'self' ? context.selfHasStatus : context.targetHasStatus;

    return check?.(token.status) ?? false;
  });
}

/**
 * Выбирает урон, которым пойдёт атака.
 *
 * Сначала варианты с состояниями в формуле — побеждает верхний, у которого все
 * состояния есть; остальные варианты с состояниями выпадают, как и «по
 * формуле» без состояний. Не сработал ни один — среди основного урона и
 * вариантов без состояний: есть «на выбор» —
 * спрашивают человека; только «случайно» — набор выпадает сам (основной и
 * «случайные» равны); иначе основной урон.
 *
 * @param action - действие существа
 * @param context - проверки состояний сторон
 * @param random - источник случайности `[0, 1)`; подменяется в тестах
 * @returns выбранный набор либо список для вопроса
 */
export function chooseCreatureActionDamage(
  action: Pick<CreatureAction, 'damageParts' | 'damageAlternatives'>,
  context: CreatureDamageContext = {},
  random: () => number = Math.random,
): CreatureDamageChoice {
  const baseOption: CreatureDamageOption = {
    damageParts: action.damageParts ?? [],
  };

  const alternatives = listCreatureDamageAlternatives(action);

  const toOption = (
    alternative: CreatureDamageAlternative,
  ): CreatureDamageOption => ({
    damageParts: alternative.damageParts,
    alternative,
  });

  const matched = alternatives.find((alternative) => {
    const statuses = listAlternativeStatuses(alternative);

    return statuses.length > 0 && statusesMatch(statuses, context);
  });

  if (matched) {
    return { kind: 'resolved', option: toOption(matched), matched: true };
  }

  // «По формуле» без состояний выбирать нечем: автор вариант не дописал
  const pickable = alternatives.filter(
    (alternative) =>
      alternative.condition !== FORMULA_CREATURE_DAMAGE_CONDITION
      && listAlternativeStatuses(alternative).length === 0,
  );

  if (pickable.some((alternative) => alternative.condition === 'ask')) {
    return { kind: 'ask', options: [baseOption, ...pickable.map(toOption)] };
  }

  if (pickable.length === 0) {
    return { kind: 'resolved', option: baseOption };
  }

  const pool = [baseOption, ...pickable.map(toOption)];

  // Случайность вне [0, 1) не должна выводить за список: берётся край
  const index = Math.min(
    pool.length - 1,
    Math.max(0, Math.floor(random() * pool.length)),
  );

  return { kind: 'resolved', option: pool[index] ?? baseOption, rolled: true };
}

/**
 * Действие с выбранным уроном. Вариантов у копии нет: дальше атака идёт уже
 * выбранным набором, и повторно выбирать некому.
 *
 * @param action - действие существа
 * @param option - выбранный набор урона
 * @returns копия действия для броска
 */
export function applyCreatureDamageOption(
  action: CreatureAction,
  option: CreatureDamageOption,
): CreatureAction {
  return {
    ...action,
    damageParts: option.damageParts,
    damageAlternatives: undefined,
  };
}
