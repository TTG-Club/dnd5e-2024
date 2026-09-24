/**
 * Формулы эффекта, которые считаются ОДИН раз — в момент наложения.
 *
 * Правила сплошь и рядом бросают кость один раз, а пользуются числом долго:
 * «Вибрирующие жидкости» бьют одним и тем же броском на каждом тике, «Замешательство»
 * висит 1к4 раунда. Если такую формулу оставить в эффекте, конвейер будет катать её
 * заново при каждом пересчёте листа — и число будет скакать.
 *
 * Поэтому такие формулы стираются при наложении: кость бросают здесь, результат
 * уезжает в сам эффект числом, и дальше эффект живёт обычным. Приём тот же,
 * что у подстановки чисел источника ({@link module:system/dnd/sourceFormulaBinding})
 * и уровня класса (`classEffectScope`), только с костью.
 *
 * Точка вызова одна — `withInitializedDuration` (turnEffects): её зовут все
 * пути наложения.
 *
 * @module system/dnd/applyTimeFormulas
 */

import type { ActiveEffect } from './activeEffectTypes.js';

import { rollDamageFormula } from './diceFormula.js';
import { formatFormulaNumber } from './formulaParser.js';

/** Токен сохранённого броска в формулах эффекта */
const SAVED_ROLL_TOKEN = '@roll';

/** Тот же токен целым словом: `@rollback` сохранённым броском не считается */
const SAVED_ROLL_PATTERN = new RegExp(`${SAVED_ROLL_TOKEN}\\b`, 'gu');

/** Осталась ли в формуле переменная, которую здесь не посчитать */
const UNBOUND_TOKEN_PROBE = /@[a-z]/iu;

/**
 * Считается ли формула здесь: кости и числа — да, оставшийся `@`-токен — нет.
 *
 * Токен доживает до наложения, когда его некому было подставить («@mod.spell»
 * вне каста). Считать такую формулу наполовину нельзя — как и кубиковый бонус,
 * она пропускается целиком.
 *
 * @param formula - формула
 * @returns `true`, если формулу можно бросить
 */
function isRollable(formula: string): boolean {
  return formula.trim().length > 0 && !UNBOUND_TOKEN_PROBE.test(formula);
}

/**
 * Подставляет число вместо `@roll`. Отрицательное — в скобках, как у чисел
 * источника: «1к6 + @roll» с −2 даёт «1к6 + (-2)», а не «1к6 + -2».
 *
 * @param formula - формула
 * @param value - результат сохранённого броска
 * @returns формула с числом
 */
function bindSavedRoll(formula: string, value: number): string {
  return formula.replace(SAVED_ROLL_PATTERN, formatFormulaNumber(value));
}

/**
 * Есть ли в эффекте формулы с сохранённым броском.
 *
 * @param effect - эффект
 * @returns `true`, если подставлять есть что
 */
function usesSavedRoll(effect: ActiveEffect): boolean {
  const probe = new RegExp(SAVED_ROLL_PATTERN.source, 'u');

  return (
    effect.changes.some((change) => probe.test(change.value))
    || (effect.damageParts ?? []).some((part) => probe.test(part.formula))
    || (effect.recurringDamage?.damageParts ?? []).some((part) =>
      probe.test(part.formula),
    )
  );
}

/**
 * Копия эффекта с подставленным сохранённым броском.
 *
 * @param effect - эффект
 * @param value - результат броска
 * @returns копия эффекта
 */
function withSavedRoll(effect: ActiveEffect, value: number): ActiveEffect {
  const bindPart = <T extends { formula: string }>(part: T): T => ({
    ...part,
    formula: bindSavedRoll(part.formula, value),
  });

  return {
    ...effect,
    savedRollValue: value,
    changes: effect.changes.map((change) => ({
      ...change,
      value: bindSavedRoll(change.value, value),
    })),
    ...(effect.damageParts === undefined
      ? {}
      : { damageParts: effect.damageParts.map(bindPart) }),
    ...(effect.recurringDamage === undefined
      ? {}
      : {
          recurringDamage: {
            ...effect.recurringDamage,
            damageParts: effect.recurringDamage.damageParts.map(bindPart),
          },
        }),
  };
}

/**
 * Копия эффекта со сроком, посчитанным из формулы.
 *
 * Срок формулой нужен «Замешательству» (1к4 раунда) и умениям, чей срок зависит
 * от характеристики. Результат уезжает в `duration.value` числом — `remaining`
 * из него посчитает `withInitializedDuration`, как у срока, набранного руками.
 *
 * Посчитанный срок узнаётся по заполненному `duration.value`: формулу и число
 * форма не даёт задать вместе, так что заполненное число у формулы — это уже
 * её результат, и повторная подготовка кость не перебрасывает.
 *
 * @param effect - эффект
 * @returns копия эффекта либо он сам, если считать нечего
 */
function withRolledDuration(effect: ActiveEffect): ActiveEffect {
  const formula = effect.durationFormula;

  if (
    formula === undefined
    || !isRollable(formula)
    || typeof effect.duration.value === 'number'
  ) {
    return effect;
  }

  const rolled = Math.max(0, Math.round(rollDamageFormula(formula).total));

  return { ...effect, duration: { ...effect.duration, value: rolled } };
}

/**
 * Считает формулы эффекта, которые бросают один раз — при наложении.
 *
 * @param effect - накладываемый эффект
 * @returns эффект с посчитанными числами либо он сам, если считать нечего
 */
export function stampApplyTimeFormulas(effect: ActiveEffect): ActiveEffect {
  const withDuration = withRolledDuration(effect);

  const savedRoll = withDuration.savedRoll;

  // Бросок уже сохранён: повторная подготовка не перебрасывает
  if (
    savedRoll === undefined
    || withDuration.savedRollValue !== undefined
    || !isRollable(savedRoll)
    || !usesSavedRoll(withDuration)
  ) {
    return withDuration;
  }

  return withSavedRoll(withDuration, rollDamageFormula(savedRoll).total);
}
