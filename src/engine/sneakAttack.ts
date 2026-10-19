/**
 * Скрытая атака — общий механизм эффекта, а не «код плута».
 *
 * Любой источник (класс, подкласс, существо, черта, предмет) задаёт её строкой
 * `sneakAttack.damage`: кости и условие. Атака оружием собирает такие строки в
 * момент броска, и если условие выполнено, окно атаки показывает переключатель
 * «Скрытая атака +Nк6». Включён — кости идут отдельной частью урона с подписью
 * «Скрытая атака» (тип — как у оружия, крит их удваивает), и тратится лимит
 * «раз в ход».
 *
 * Правило 2024 одинаково для всех источников, поэтому живёт здесь, а не в
 * данных:
 * - из нескольких источников, сработавших в одной атаке, берётся наибольший —
 *   кости не складываются;
 * - строки `sneakAttack.dice` («+1к6 к Скрытой атаке») прибавляют кости к
 *   выбранному источнику, а не идут отдельным уроном;
 * - лимит — одна копилка на все источники ({@link SNEAK_ATTACK_USAGE_KEY}):
 *   два источника не дадут её дважды за ход. Сбрасывает его конец любого хода
 *   боя (период `turn`), поэтому атака реакцией в чужой ход тоже возможна. Вне
 *   боя лимит не пишется вовсе: сбросить его некому, и расход провисел бы до
 *   первого хода в бою.
 *
 * @module system/dnd/sneakAttack
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { RollContext } from './effectPipeline.js';
import type { EffectTriggerLimit } from './effectTriggerTypes.js';
import type {
  EffectTriggerUsageLedger,
  TriggerUsageChanges,
} from './effectTriggerUsage.js';
import type { FormulaContext } from './formulaParser.js';

import {
  SNEAK_ATTACK_DAMAGE_KEY,
  SNEAK_ATTACK_DICE_KEY,
} from './activeEffectTypes.js';
import { resolveDiceCountExpressions } from './diceCountExpressions.js';
import {
  collectRollTimeChanges,
  resolveChangeValue,
} from './effectPipeline.js';
import {
  buildTriggerUsageScope,
  readTriggerUsage,
} from './effectTriggerUsage.js';
import { substituteFormulaVariables } from './formulaParser.js';

/** Подпись Скрытой атаки в окне атаки и в чате */
export const SNEAK_ATTACK_LABEL = 'Скрытая атака';

/** Метка Скрытой атаки — имя общей копилки лимита */
export const SNEAK_ATTACK_TAG = 'sneakAttack';

/** Лимит Скрытой атаки по правилам: раз в ход */
export const SNEAK_ATTACK_LIMIT: EffectTriggerLimit = {
  max: 1,
  per: 'turn',
  key: SNEAK_ATTACK_TAG,
};

/**
 * Ключ счётчика Скрытой атаки в журнале `system.effectUsage`. Источник —
 * метка, а не эффект: у мультиклассера и у предмета с той же Скрытой атакой
 * счётчик один.
 */
export const SNEAK_ATTACK_USAGE_KEY = `${buildTriggerUsageScope('tag', SNEAK_ATTACK_TAG)}|${SNEAK_ATTACK_LIMIT.key}`;

/** Скрытая атака, которая пойдёт в этой атаке, если её не выключить */
export interface SneakAttackPlan {
  /** Формула костей для роллера: числа уже подставлены, прибавки учтены */
  formula: string;
  /** Чья это Скрытая атака — эффект-источник наибольших костей */
  sourceName: string;
}

/** Кость в формуле: число (может не быть), буква, грань */
const DICE_TERM_PATTERN = /(\d*)\s*([кдd])\s*(\d+)/gi;

/** Первая кость формулы — к ней прибавляются кости Скрытой атаки */
const FIRST_DICE_TERM_PATTERN = /(\d*)\s*([кдd])\s*(\d+)/i;

/**
 * Средний итог костей формулы — по нему сравниваются источники. Числа без
 * костей не считаются: «наибольшая» Скрытая атака — по костям.
 *
 * @param formula - формула с подставленными числами
 * @returns среднее костей
 */
export function estimateDiceAverage(formula: string): number {
  let average = 0;

  for (const match of formula.matchAll(DICE_TERM_PATTERN)) {
    const count = match[1] ? Number(match[1]) : 1;
    const faces = Number(match[3]);

    average += (count * (faces + 1)) / 2;
  }

  return average;
}

/**
 * Прибавляет кости к первой кости формулы: «3к6» и 2 — «5к6». Отрицательная
 * прибавка убирает кости (Хитрый удар платит ими), но не ниже нуля.
 *
 * @param formula - формула с подставленными числами
 * @param extra - сколько костей прибавить
 * @returns формула с новым числом костей; без костей — как есть
 */
export function addDiceToFormula(formula: string, extra: number): string {
  if (extra === 0) {
    return formula;
  }

  return formula.replace(
    FIRST_DICE_TERM_PATTERN,
    (_term, count: string, letter: string, faces: string) => {
      const total = Math.max(0, (count ? Number(count) : 1) + extra);

      return `${total}${letter}${faces}`;
    },
  );
}

/**
 * Формула строки с числами носителя: `@classLevel` уже подставлен сборкой
 * эффектов, остальное (`@prof`, `@mod.dex`) — здесь, число костей
 * выражением считается тут же.
 *
 * Тип урона у Скрытой атаки — как у оружия, токенов `@dmg.*` в ней нет:
 * нечитаемая формула источником не считается, бросок не ломается.
 *
 * @param value - значение строки
 * @param formulaContext - числа носителя
 * @returns формула для роллера; нечитаемая — пустая строка
 */
function resolveSneakAttackFormula(
  value: string,
  formulaContext: FormulaContext,
): string {
  try {
    return resolveDiceCountExpressions(
      substituteFormulaVariables(value, formulaContext),
    );
  } catch {
    return '';
  }
}

/**
 * Решает, какая Скрытая атака доступна в этом броске: из строк
 * `sneakAttack.damage` с выполненным условием — наибольшая по костям, с
 * прибавками `sneakAttack.dice`. Переключатель окна и лимит здесь не
 * учитываются: их решает окно.
 *
 * Прибавки проверяются в контексте «Скрытая атака идёт», так что их условие
 * может ссылаться на неё же (`attack.sneakAttack === true`). Цикла нет:
 * прибавки на выбор источника не влияют.
 *
 * @param effects - эффекты бросающего (с аурами)
 * @param rollContext - контекст броска: режим, оружие, цель
 * @param formulaContext - числа бросающего
 * @returns Скрытая атака либо `undefined`, если её условия не выполнены
 */
export function resolveSneakAttack(
  effects: readonly ActiveEffect[],
  rollContext: RollContext,
  formulaContext: FormulaContext,
): SneakAttackPlan | undefined {
  const sources = collectRollTimeChanges(
    effects,
    SNEAK_ATTACK_DAMAGE_KEY,
    rollContext,
  ).map(({ change, effect }) => ({
    formula: resolveSneakAttackFormula(change.value, formulaContext),
    sourceName: effect.name,
  }));

  const best = sources.reduce<(typeof sources)[number] | undefined>(
    (largest, source) =>
      !largest
      || estimateDiceAverage(source.formula)
        > estimateDiceAverage(largest.formula)
        ? source
        : largest,
    undefined,
  );

  if (!best || estimateDiceAverage(best.formula) <= 0) {
    return undefined;
  }

  const extraDice = collectRollTimeChanges(effects, SNEAK_ATTACK_DICE_KEY, {
    ...rollContext,
    sneakAttack: true,
  }).reduce(
    (sum, { change }) =>
      sum + Math.trunc(resolveChangeValue(change.value, formulaContext) ?? 0),
    0,
  );

  return {
    formula: addDiceToFormula(best.formula, extraDice),
    sourceName: best.sourceName,
  };
}

/**
 * Есть ли у бросающего источник Скрытой атаки — строка `sneakAttack.damage`
 * в каком-либо эффекте. Без неё окну атаки нечего показывать.
 *
 * @param effects - эффекты бросающего (с аурами)
 * @returns `true`, если источник есть
 */
export function hasSneakAttackSource(
  effects: readonly ActiveEffect[],
): boolean {
  return effects.some((effect) =>
    effect.changes.some((change) => change.key === SNEAK_ATTACK_DAMAGE_KEY),
  );
}

/**
 * Добавляется ли Скрытая атака в окне атаки сама: настройка листа, по
 * умолчанию — да.
 *
 * @param entity - персонаж или существо
 * @returns `true`, если переключатель включён при открытии окна
 */
export function readSneakAttackAutoAdd(entity: DnDSceneEntity): boolean {
  return entity.system.sneakAttackAutoAdd !== false;
}

/**
 * Потрачена ли Скрытая атака в этом ходу.
 *
 * @param ledger - журнал срабатываний бросающего
 * @returns `true`, если лимит хода исчерпан
 */
export function isSneakAttackSpent(ledger: EffectTriggerUsageLedger): boolean {
  return (ledger[SNEAK_ATTACK_USAGE_KEY]?.used ?? 0) >= SNEAK_ATTACK_LIMIT.max;
}

/**
 * Разница журнала «Скрытая атака потрачена» — приращением, как и весь журнал
 * боевого канала: расход с другого клиента складывается, а не затирается.
 *
 * @returns разница журнала
 */
export function buildSneakAttackSpend(): TriggerUsageChanges {
  return {
    spend: {
      [SNEAK_ATTACK_USAGE_KEY]: { used: 1, per: SNEAK_ATTACK_LIMIT.per },
    },
    removeKeys: [],
  };
}

/**
 * Журнал, в котором расход Скрытой атаки возвращён: промах, отмена урона из
 * чата. На один расход меньше; пусто — ключ снимается.
 *
 * @param entity - бросающий, каким он есть сейчас
 * @returns журнал без одного расхода
 */
export function releaseSneakAttackUsage(
  entity: DnDSceneEntity,
): EffectTriggerUsageLedger {
  const ledger = readTriggerUsage(entity);
  const entry = ledger[SNEAK_ATTACK_USAGE_KEY];

  if (!entry) {
    return ledger;
  }

  const rest = Object.fromEntries(
    Object.entries(ledger).filter(([key]) => key !== SNEAK_ATTACK_USAGE_KEY),
  );

  return entry.used > 1
    ? { ...rest, [SNEAK_ATTACK_USAGE_KEY]: { ...entry, used: entry.used - 1 } }
    : rest;
}

/**
 * Id эффекта старой Скрытой атаки плута в компендиуме: кнопка «Применить»
 * (`activation: use`) с костями на один удар. Новая — постоянная строка
 * `sneakAttack.damage`; старая кнопка вместе с ней дала бы урон дважды.
 */
export const LEGACY_SNEAK_ATTACK_EFFECT_ID = 'effect-rogue-phb-sneak-attack';

/**
 * Старая ли это Скрытая атака: эффект класса с id старой кнопки (с любым
 * хвостом — копии и варианты) без строки `sneakAttack.damage`.
 *
 * @param effect - эффект на листе
 * @returns `true`, если эффект надо заменить
 */
function isLegacySneakAttackEffect(effect: ActiveEffect): boolean {
  return (
    effect.id.includes(`:${LEGACY_SNEAK_ATTACK_EFFECT_ID}`)
    && !hasSneakAttackSource([effect])
  );
}

/**
 * Эффекты листа со старой Скрытой атакой, заменённой новой из определения
 * класса. Повторный запуск ничего не меняет: старых эффектов уже нет, а
 * новые добавляются, только если их id на листе нет.
 *
 * Новой Скрытой атаки в определении нет (данные компендиума ещё старые) —
 * ничего не меняется: снять кнопку, не поставив строку, значило бы отнять
 * Скрытую атаку вовсе.
 *
 * @param effects - эффекты листа
 * @param replacements - эффекты класса со строкой `sneakAttack.damage`, уже с
 *   меткой класса в id
 * @returns новые эффекты листа либо `undefined`, если менять нечего
 */
export function migrateLegacySneakAttackEffects(
  effects: readonly ActiveEffect[],
  replacements: readonly ActiveEffect[],
): ActiveEffect[] | undefined {
  const fresh = replacements.filter((effect) => hasSneakAttackSource([effect]));

  if (fresh.length === 0 || !effects.some(isLegacySneakAttackEffect)) {
    return undefined;
  }

  const kept = effects.filter((effect) => !isLegacySneakAttackEffect(effect));
  const keptIds = new Set(kept.map((effect) => effect.id));

  return [...kept, ...fresh.filter((effect) => !keptIds.has(effect.id))];
}
