/**
 * Подстановка чисел ИСТОЧНИКА в формулы эффекта.
 *
 * Эффект, который источник отдаёт другим, считается по источнику: «Аура
 * защиты» даёт союзникам модификатор Харизмы ПАЛАДИНА, «Лунный луч» бьёт с
 * модификатором заклинателя. Пайплайн же читает формулы строк в контексте
 * носителя, а сервер пропускает части урона с `@`. Поэтому, пока источник под
 * рукой, его токены превращаются в числа — остальные (`@dmg.*`, `@heal`,
 * `@target.*`, `@speed.*`) остаются: они относятся к цели и броску.
 *
 * Так же и Сл спасбросков эффекта формулой («8 + @prof + @mod.str» варвара,
 * «@spellDc» ауры): у наложенного эффекта это Сл НАЛОЖИВШЕГО, и формула без
 * оставшихся `@`-токенов сразу становится числом (см. `effectSaveDc.ts`).
 *
 * Числа источника идут и в урон и лечение срабатываний: «Божественная искра»
 * лечит `1к8 + @mod.wis` жреца срабатыванием «при наложении», и сервер,
 * получив формулу с `@`, её просто пропустил бы. Число костей выражением
 * (`(1 + steps(@classLevel, 7, 13, 18))к8`) считается сразу после
 * подстановки — см. `diceCountExpressions.ts`.
 *
 * @module system/dnd/sourceFormulaBinding
 */

import type { DamagePart } from '@vtt/shared';

import type { ActiveEffect, EffectChange } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { SaveDcSource } from './effectSaveDc.js';
import type { FormulaContext } from './formulaParser.js';

import { bindClassLevels } from './classEffectScope.js';
import { resolveDiceCountExpressions } from './diceCountExpressions.js';
import {
  evaluateSaveDcFormula,
  listEffectSaveDcs,
  mapEffectSaveDcs,
} from './effectSaveDc.js';
import { bindEffectToken, effectUsesToken } from './effectTokenBinding.js';
import {
  CAST_LEVEL_VARIABLE,
  evaluateFormula,
  formatFormulaNumber,
} from './formulaParser.js';
import {
  mapTriggerDamageParts,
  someTriggerDamagePart,
} from './triggerDamageParts.js';

/**
 * Токены, которые принадлежат источнику: модификаторы и значения
 * характеристик, модификатор заклинания, бонус мастерства, уровни, Сл
 * заклинаний.
 */
const SOURCE_TOKEN_PATTERN =
  /@(?:mod\.(?:str|dex|con|int|wis|cha|spell)|prof|classLevel|level|spellDc|str|dex|con|int|wis|cha)\b/g;

/** Токен круга ячейки каста */
const CAST_LEVEL_TOKEN = `@${CAST_LEVEL_VARIABLE}`;

/** Тот же токен — для проверки наличия, без позиции поиска у глобального */
const SOURCE_TOKEN_PROBE = new RegExp(SOURCE_TOKEN_PATTERN.source, 'u');

/** Есть ли в строке токен источника */
function hasSourceToken(value: string | undefined): boolean {
  return value !== undefined && SOURCE_TOKEN_PROBE.test(value);
}

/**
 * Подставляет числа источника в одну формулу. Токен, который в контексте не
 * посчитать (`@mod.spell` вне каста), остаётся как есть.
 *
 * @param formula - формула
 * @param context - контекст источника
 * @returns формула с числами источника
 */
export function bindSourceFormula(
  formula: string,
  context: FormulaContext,
): string {
  if (!hasSourceToken(formula)) {
    return formula;
  }

  const bound = formula.replace(SOURCE_TOKEN_PATTERN, (token) => {
    try {
      const value = evaluateFormula(token, context);

      return formatFormulaNumber(value);
    } catch {
      return token;
    }
  });

  return resolveDiceCountExpressions(bound);
}

/** Подставляет числа источника в строку модификатора */
function bindChange(
  change: EffectChange,
  context: FormulaContext,
): EffectChange {
  return hasSourceToken(change.value)
    ? { ...change, value: bindSourceFormula(change.value, context) }
    : change;
}

/** Подставляет числа источника в часть урона */
function bindDamagePart(part: DamagePart, context: FormulaContext): DamagePart {
  if (!hasSourceToken(part.formula) && !hasSourceToken(part.versatileFormula)) {
    return part;
  }

  return {
    ...part,
    formula: bindSourceFormula(part.formula, context),
    ...(part.versatileFormula === undefined
      ? {}
      : {
          versatileFormula: bindSourceFormula(part.versatileFormula, context),
        }),
  };
}

/**
 * Подставляет числа источника в Сл формулой. Не осталось `@`-токенов — Сл
 * становится числом, и формулу больше некому читать; остался `@damage` —
 * формула ждёт события.
 *
 * @param save - Сл спасброска
 * @param context - контекст источника
 * @returns Сл с числами источника
 */
export function bindSaveDcFormula<Save extends SaveDcSource>(
  save: Save,
  context: FormulaContext,
): Save {
  if (!saveDcNeedsBinding(save)) {
    return save;
  }

  const formula = bindSourceFormula(save.dcFormula ?? '', context);

  const value = formula.includes('@')
    ? undefined
    : evaluateSaveDcFormula(formula, context);

  return value === undefined
    ? { ...save, dcFormula: formula }
    : { ...save, dc: value, dcFormula: undefined };
}

/**
 * Есть ли что делать с Сл формулой при наложении: подставить числа источника
 * или, если токенов уже нет (круг ячейки подставлен раньше), сделать её
 * числом.
 *
 * @param save - Сл спасброска
 * @returns `true`, если формулу надо подставить или посчитать
 */
function saveDcNeedsBinding(save: SaveDcSource): boolean {
  return (
    save.dcFormula !== undefined
    && (hasSourceToken(save.dcFormula) || !save.dcFormula.includes('@'))
  );
}

/** Есть ли токен источника в части урона */
function partUsesSourceTokens(part: DamagePart): boolean {
  return hasSourceToken(part.formula) || hasSourceToken(part.versatileFormula);
}

/** Есть ли токен источника в частях урона */
function partsUseSourceTokens(
  parts: readonly DamagePart[] | undefined,
): boolean {
  return (parts ?? []).some(partUsesSourceTokens);
}

/** Что подставлять в эффект, кроме урона и лечения */
export interface SourceBindingOptions {
  /**
   * Подставлять ли числа источника в модификаторы. Эффект, который источник
   * ДЕРЖИТ за других (аура, зона), считает модификаторы по источнику: «Аура
   * защиты» даёт Харизму паладина. Эффект, наложенный на цель, — по цели:
   * «Доспехи мага» `13 + @mod.dex` — это Ловкость того, на ком доспех. По
   * умолчанию — подставлять.
   */
  changes?: boolean;
}

/**
 * Есть ли в эффекте круг ячейки — число, которое ставит только каст.
 *
 * @param effect - эффект
 * @returns `true`, если эффект читает `@castLevel`
 */
export function effectUsesCastLevel(effect: ActiveEffect): boolean {
  return effectUsesToken(effect, CAST_LEVEL_TOKEN);
}

/**
 * Есть ли в эффекте формулы, которые считаются от источника.
 *
 * @param effect - эффект
 * @param options - что подставлять кроме урона и лечения
 * @returns `true`, если подставлять есть что
 */
export function effectUsesSourceFormulas(
  effect: ActiveEffect,
  options: SourceBindingOptions = {},
): boolean {
  const { changes = true } = options;

  return (
    hasSourceToken(effect.savedRoll)
    || hasSourceToken(effect.durationFormula)
    || (changes
      && effect.changes.some((change) => hasSourceToken(change.value)))
    || partsUseSourceTokens(effect.damageParts)
    || partsUseSourceTokens(effect.recurringDamage?.damageParts)
    || someTriggerDamagePart(effect.triggers, partUsesSourceTokens)
    || effectUsesSourceSaveDcs(effect)
  );
}

/**
 * Есть ли у эффекта Сл формулой с токенами источника.
 *
 * @param effect - эффект
 * @returns `true`, если в Сл есть что подставлять
 */
function effectUsesSourceSaveDcs(effect: ActiveEffect): boolean {
  return listEffectSaveDcs(effect).some(saveDcNeedsBinding);
}

/**
 * Копия эффекта с числами источника в модификаторах, уроне и лечении
 * срабатываний, с кругом ячейки каста во всех формулах.
 *
 * @param sourceEffect - эффект
 * @param context - контекст источника
 * @param options - что подставлять кроме урона и лечения
 * @returns исходный эффект, если подставлять нечего, иначе копия
 */
export function bindSourceEffectFormulas(
  sourceEffect: ActiveEffect,
  context: FormulaContext,
  options: SourceBindingOptions = {},
): ActiveEffect {
  // Круг ячейки — число каста, а не носителя: он подставляется во ВСЕ формулы
  // эффекта, в модификаторы цели тоже («Подмога» поднимает хиты цели по кругу)
  const effect =
    context.castLevel === undefined
      ? sourceEffect
      : bindEffectToken(sourceEffect, CAST_LEVEL_TOKEN, context.castLevel);

  if (!effectUsesSourceFormulas(effect, options)) {
    return effect;
  }

  const { changes = true } = options;

  // Сл — всегда по источнику, как урон: это его умение, а не цели
  const saveBound = effectUsesSourceSaveDcs(effect)
    ? mapEffectSaveDcs(effect, (save) => bindSaveDcFormula(save, context))
    : effect;

  return {
    ...saveBound,
    // Проверка на `undefined`, а не на токен: она сужает тип, а формула без
    // токена и так возвращается из `bindSourceFormula` как есть
    ...(effect.savedRoll === undefined
      ? {}
      : { savedRoll: bindSourceFormula(effect.savedRoll, context) }),
    ...(effect.durationFormula === undefined
      ? {}
      : {
          durationFormula: bindSourceFormula(effect.durationFormula, context),
        }),
    changes: changes
      ? effect.changes.map((change) => bindChange(change, context))
      : effect.changes,
    ...(effect.damageParts === undefined
      ? {}
      : {
          damageParts: effect.damageParts.map((part) =>
            bindDamagePart(part, context),
          ),
        }),
    ...(saveBound.recurringDamage === undefined
      ? {}
      : {
          recurringDamage: {
            ...saveBound.recurringDamage,
            damageParts: saveBound.recurringDamage.damageParts.map((part) =>
              bindDamagePart(part, context),
            ),
          },
        }),
    ...(saveBound.triggers === undefined
      ? {}
      : {
          triggers: saveBound.triggers.map((trigger) =>
            mapTriggerDamageParts(trigger, (part) =>
              bindDamagePart(part, context),
            ),
          ),
        }),
  };
}

/**
 * Эффекты, которые источник накладывает НА ЦЕЛЬ, с его числами в уроне и
 * лечении: «Божественная искра» лечит `1к8 + @mod.wis` жреца, а не цели.
 * Модификаторы не трогаются — их цель читает по себе («Доспехи мага»).
 *
 * Уровень класса подставляется первым и по id эффекта: у эффекта умения
 * класса id вида `class-effect:<класс>:…`, и `@classLevel` — это уровень
 * источника в ЭТОМ классе. Поэтому звать до того, как эффекту раздадут новые
 * id при наложении.
 *
 * @param effects - эффекты «на цель»
 * @param source - кто накладывает
 * @param context - контекст формул источника (с `spellMod`, если он известен)
 * @returns эффекты с числами источника
 */
export function bindTargetEffectsToSource(
  effects: readonly ActiveEffect[],
  source: DnDSceneEntity,
  context: FormulaContext,
): ActiveEffect[] {
  return bindClassLevels(effects, source).map((effect) =>
    bindSourceEffectFormulas(effect, context, { changes: false }),
  );
}
