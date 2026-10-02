/**
 * Сл формулой по владельцу эффекта в момент броска — часть
 * `effectSaveDc.ts`, которой нужны статы листа. Отдельным модулем, потому что
 * подстановка чисел владельца при наложении (`sourceFormulaBinding.ts`) живёт
 * внутри конвейера листа и статы звать не может.
 *
 * @module system/dnd/effectSaveDcOwner
 */

import type { DnDSceneEntity } from './dndEntities.js';
import type { SaveDcSource } from './effectSaveDc.js';
import type { EffectTrigger } from './effectTriggerTypes.js';
import type { FormulaContext } from './formulaParser.js';

import { isCreatureEntity } from '@vtt/shared';

import { resolveActorStats } from './effectPipeline.js';
import {
  evaluateSaveDcFormula,
  EVENT_DAMAGE_TOKEN,
  listTriggerSaveDcs,
  mapTriggerSaveDcs,
  saveDcFormulaUsesSpellDc,
} from './effectSaveDc.js';
import { buildResolvedFormulaContext } from './resolvedFormulaContext.js';
import { bindSaveDcFormula } from './sourceFormulaBinding.js';
import {
  calculateCreatureSpellBlockNumbers,
  DEFAULT_CREATURE_SPELL_SAVE_DC,
} from './spellUtils.js';

/**
 * Сл заклинаний сущности — то, что подставляет `@spellDc`. У персонажа — Сл
 * листа (с настройкой и прибавками эффектов), у существа — Сл его
 * заклинательства, без него — Сл по умолчанию.
 *
 * @param entity - владелец формулы
 * @returns Сл заклинаний
 */
export function resolveEntitySpellSaveDc(entity: DnDSceneEntity): number {
  if (isCreatureEntity(entity)) {
    return (
      calculateCreatureSpellBlockNumbers(entity, undefined).saveDC
      ?? DEFAULT_CREATURE_SPELL_SAVE_DC
    );
  }

  return resolveActorStats(entity).spellSaveDC;
}

/**
 * Контекст формулы Сл по владельцу: числа его листа и, если формула их
 * читает, Сл его заклинаний.
 *
 * @param owner - владелец эффекта
 * @param formulas - формулы, которые будут считаться в этом контексте
 * @returns контекст формул
 */
export function buildOwnerSaveDcContext(
  owner: DnDSceneEntity,
  formulas: readonly (string | undefined)[],
): FormulaContext {
  // Итоговые числа листа: черта «+1 к Харизме» живёт эффектом, и Сл
  // «8 + @prof + @mod.feat» читает ту Харизму, что показывает лист
  const context = buildResolvedFormulaContext(owner);

  return formulas.some(saveDcFormulaUsesSpellDc)
    ? { ...context, spellSaveDc: resolveEntitySpellSaveDc(owner) }
    : context;
}

/** Контекст без листа: формула из чисел и токенов события */
const DETACHED_SAVE_DC_CONTEXT: FormulaContext = {
  abilities: {},
  prof: 0,
  level: 0,
  movement: { walk: 0, swim: 0, fly: 0, climb: 0, burrow: 0 },
};

/**
 * Читает ли формула что-то, кроме урона события: такие токены считают по
 * владельцу, и без него пустой контекст дал бы нули вместо его чисел.
 *
 * @param formula - формула Сл
 * @returns `true`, если без владельца формулу не посчитать
 */
function readsOwnerTokens(formula: string): boolean {
  return formula.replaceAll(EVENT_DAMAGE_TOKEN, '').includes('@');
}

/**
 * Сл спасброска в момент броска.
 *
 * Формула считается по владельцу эффекта: у эффекта, наложенного на другого,
 * числа владельца уже подставлены при наложении, и осталась разве что
 * `@damage`; у своего эффекта носителя владелец — сам носитель. Без владельца
 * считается только формула из чисел и урона события.
 *
 * @param save - Сл спасброска
 * @param owner - владелец эффекта
 * @param eventDamage - урон события для `@damage`
 * @returns сложность
 */
export function resolveSaveDc(
  save: SaveDcSource,
  owner?: DnDSceneEntity,
  eventDamage?: number,
): number {
  const { dcFormula } = save;

  if (!dcFormula || (!owner && readsOwnerTokens(dcFormula))) {
    return save.dc;
  }

  const context = owner
    ? buildOwnerSaveDcContext(owner, [dcFormula])
    : DETACHED_SAVE_DC_CONTEXT;

  const value = evaluateSaveDcFormula(
    dcFormula,
    eventDamage === undefined
      ? context
      : { ...context, event: { damage: eventDamage } },
  );

  return value ?? save.dc;
}

/**
 * Срабатывание своего эффекта носителя, которое достаётся ДРУГОМУ (другая
 * сторона, «всем в радиусе», выбранный): Сл формулой считается по носителю —
 * владельцу, а не по тому, кто бросает. Числа подставляются до броска, и
 * наложенное срабатыванием состояние уносит уже готовую Сл повторного
 * спасброска («Ошеломляющий удар» монаха — его Мудрость, а не цели).
 *
 * @param source - срабатывание с источником
 * @param owner - владелец эффекта (субъект срабатывания)
 * @returns срабатывание с числами владельца в Сл
 */
export function bindTriggerSourceSaveDcs<
  Source extends { trigger: EffectTrigger },
>(source: Source, owner: DnDSceneEntity): Source {
  const formulas = listTriggerSaveDcs(source.trigger).map(
    (save) => save.dcFormula,
  );

  if (!formulas.some((formula) => formula !== undefined)) {
    return source;
  }

  const context = buildOwnerSaveDcContext(owner, formulas);

  return {
    ...source,
    trigger: mapTriggerSaveDcs(source.trigger, (save) =>
      bindSaveDcFormula(save, context),
    ),
  };
}
