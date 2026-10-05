/**
 * Сл спасброска эффекта формулой — один путь для всех полей Сл.
 *
 * Сл умения, которое не колдует, — «8 + бонус мастерства + модификатор
 * характеристики» ВЛАДЕЛЬЦА: варвар пугает Силой, монах ошеломляет Мудростью,
 * дракорождённый дышит Телосложением. Сл ауры умения — «Сл ваших заклинаний».
 * Число такую Сл не выражает: оно не растёт с уровнем. Поэтому у каждого
 * спасброска эффекта (при наложении, повторного, против урона каждый ход,
 * срабатывания, проверки «вырваться») рядом с числом `dc` может лежать формула
 * `dcFormula`.
 *
 * Формулу считают по владельцу эффекта:
 * - эффект, который владелец отдаёт другим (цель, аура, зона), получает числа
 *   владельца при наложении — тем же путём, что и урон
 *   (`sourceFormulaBinding.bindSourceEffectFormulas`); формула без
 *   `@`-токенов сразу становится числом `dc`;
 * - свой эффект носителя (черта, предмет, черта существа) считается в момент
 *   броска по носителю — он и есть владелец (`effectSaveDcOwner.resolveSaveDc`).
 *
 * `dc` остаётся запасным числом: формула с ошибкой или без данных (`@damage`
 * вне события урона) не отменяет спасбросок, а бросается против него.
 *
 * @module system/dnd/effectSaveDc
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type {
  EffectTrigger,
  EffectTriggerAction,
  NestedEffectTrigger,
} from './effectTriggerTypes.js';
import type { FormulaContext } from './formulaParser.js';

import {
  evaluateFormula,
  EVENT_DAMAGE_VARIABLE,
  SPELL_SAVE_DC_VARIABLE,
  validateFormula,
} from './formulaParser.js';

/** Сл спасброска: число и необязательная формула */
export interface SaveDcSource {
  /** Сл числом; при формуле — запасное число */
  dc: number;
  /** Сл формулой по владельцу эффекта */
  dcFormula?: string;
}

/** Меньше этой Сл формула не даёт: Сл 0 и ниже проходил бы любой */
const MIN_FORMULA_SAVE_DC = 1;

/** Токен Сл заклинаний владельца в записи формулы */
const SPELL_SAVE_DC_TOKEN = `@${SPELL_SAVE_DC_VARIABLE}`;

/** Токен урона события в записи формулы */
export const EVENT_DAMAGE_TOKEN = `@${EVENT_DAMAGE_VARIABLE}`;

/**
 * Читает ли формула Сл заклинаний владельца. Её считают только по нужде: для
 * этого приходится собирать статы листа целиком.
 *
 * @param formula - формула Сл
 * @returns `true`, если в формуле есть `@spellDc`
 */
export function saveDcFormulaUsesSpellDc(formula: string | undefined): boolean {
  return formula?.includes(SPELL_SAVE_DC_TOKEN) === true;
}

/**
 * Считает формулу Сл. Ошибка, пустой токен или нечисло — `undefined`: тогда
 * бросают против запасного числа.
 *
 * @param formula - формула Сл
 * @param context - контекст формул
 * @returns Сл не меньше 1 либо `undefined`
 */
export function evaluateSaveDcFormula(
  formula: string,
  context: FormulaContext,
): number | undefined {
  try {
    const value = evaluateFormula(formula, context);

    return Number.isFinite(value)
      ? Math.max(MIN_FORMULA_SAVE_DC, Math.trunc(value))
      : undefined;
  } catch {
    // Автор ошибся в формуле — спасбросок всё равно бросается, против числа
    return undefined;
  }
}

/** Ошибки поля Сл формулой */
const SAVE_DC_FORMULA_ERRORS = {
  damageOutsideEvent: '@damage есть только у события урона',
} as const;

/** Что допускает поле Сл формулой в своём месте */
export interface SaveDcFormulaRules {
  /** Есть ли у события урон — токен `@damage` */
  acceptsDamage: boolean;
}

/**
 * Ошибка формулы Сл для поля окна: синтаксис и `@damage` вне события урона.
 *
 * @param formula - формула из поля
 * @param rules - что допускает место
 * @returns текст ошибки либо `undefined`, если формула годится
 */
export function describeSaveDcFormulaError(
  formula: string,
  rules: SaveDcFormulaRules,
): string | undefined {
  const { error } = validateFormula(formula);

  if (error) {
    return error;
  }

  return !rules.acceptsDamage && formula.includes(EVENT_DAMAGE_TOKEN)
    ? SAVE_DC_FORMULA_ERRORS.damageOutsideEvent
    : undefined;
}

/** Что сделать с одной Сл эффекта; тип спасброска сохраняется */
export type SaveDcMapper = <Save extends SaveDcSource>(save: Save) => Save;

/**
 * Срабатывание с изменёнными Сл: своя и у повторного спасброска наложенного
 * состояния вместе с его вложенными срабатываниями.
 *
 * @param trigger - срабатывание
 * @param mapSave - что сделать с Сл
 * @returns срабатывание с новыми Сл
 */
export function mapTriggerSaveDcs<
  Trigger extends EffectTrigger | NestedEffectTrigger,
>(trigger: Trigger, mapSave: SaveDcMapper): Trigger {
  return {
    ...trigger,
    ...(trigger.save ? { save: mapSave(trigger.save) } : {}),
    actions: trigger.actions.map((action) => mapActionSaveDcs(action, mapSave)),
  };
}

/**
 * Действие срабатывания с изменёнными Сл наложенного им состояния.
 *
 * @param action - действие
 * @param mapSave - что сделать с Сл
 * @returns действие с новыми Сл
 */
function mapActionSaveDcs<Action extends EffectTriggerAction>(
  action: Action,
  mapSave: SaveDcMapper,
): Action {
  if (action.type !== 'applyCondition') {
    return action;
  }

  return {
    ...action,
    ...(action.recurringSave
      ? { recurringSave: mapSave(action.recurringSave) }
      : {}),
    // «Вырваться» наложенного состояния — та же Сл источника, что у спасброска
    ...(action.escape?.check
      ? { escape: { ...action.escape, check: mapSave(action.escape.check) } }
      : {}),
    ...(action.triggers
      ? {
          triggers: action.triggers.map((nested) =>
            mapTriggerSaveDcs(nested, mapSave),
          ),
        }
      : {}),
  };
}

/**
 * Все Сл эффекта одним обходом: при наложении, повторный спасбросок, против
 * урона каждый ход, проверка «вырваться», срабатывания и наложенные ими
 * состояния. Новое поле Сл добавляется сюда — и доходит до подстановки чисел
 * владельца и до сводки сразу.
 *
 * @param effect - эффект
 * @param mapSave - что сделать с каждой Сл
 * @returns копия эффекта с новыми Сл
 */
export function mapEffectSaveDcs(
  effect: ActiveEffect,
  mapSave: SaveDcMapper,
): ActiveEffect {
  const {
    applySave,
    recurringSave,
    recurringDamage,
    escape,
    castRule,
    triggers,
  } = effect;

  return {
    ...effect,
    ...(applySave ? { applySave: mapSave(applySave) } : {}),
    ...(recurringSave ? { recurringSave: mapSave(recurringSave) } : {}),
    ...(recurringDamage?.save
      ? {
          recurringDamage: {
            ...recurringDamage,
            save: mapSave(recurringDamage.save),
          },
        }
      : {}),
    ...(escape?.check
      ? { escape: { ...escape, check: mapSave(escape.check) } }
      : {}),
    // Спасбросок при попытке каста — Сл наложившего, как у повторного
    ...(castRule?.failSave
      ? { castRule: { ...castRule, failSave: mapSave(castRule.failSave) } }
      : {}),
    ...(triggers
      ? {
          triggers: triggers.map((trigger) =>
            mapTriggerSaveDcs(trigger, mapSave),
          ),
        }
      : {}),
  };
}

/**
 * Сл срабатывания и наложенных им состояний — без копий, для проверок.
 *
 * @param trigger - срабатывание
 * @returns Сл срабатывания
 */
export function listTriggerSaveDcs(
  trigger: EffectTrigger | NestedEffectTrigger,
): SaveDcSource[] {
  return [
    ...(trigger.save ? [trigger.save] : []),
    ...trigger.actions.flatMap((action) =>
      action.type === 'applyCondition'
        ? [
            ...(action.recurringSave ? [action.recurringSave] : []),
            ...(action.escape?.check ? [action.escape.check] : []),
            ...('triggers' in action ? (action.triggers ?? []) : []).flatMap(
              listTriggerSaveDcs,
            ),
          ]
        : [],
    ),
  ];
}

/**
 * Все Сл эффекта списком — тот же обход, что у {@link mapEffectSaveDcs}, но
 * без копий: его зовут на каждом сборе аур.
 *
 * @param effect - эффект
 * @returns Сл эффекта
 */
export function listEffectSaveDcs(effect: ActiveEffect): SaveDcSource[] {
  return [
    ...(effect.applySave ? [effect.applySave] : []),
    ...(effect.recurringSave ? [effect.recurringSave] : []),
    ...(effect.recurringDamage?.save ? [effect.recurringDamage.save] : []),
    ...(effect.escape?.check ? [effect.escape.check] : []),
    ...(effect.castRule?.failSave ? [effect.castRule.failSave] : []),
    ...(effect.triggers ?? []).flatMap(listTriggerSaveDcs),
  ];
}
