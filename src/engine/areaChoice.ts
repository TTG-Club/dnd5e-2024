/**
 * Цели области: кого накрыл шаблон и кого из них задеть.
 *
 * Одно правило на всё, что ставит шаблон на карту: заклинание с областью,
 * действие существа с областью, применение умения и предмета с областью
 * (`activation.area`) и кнопка «При действии» с шаблоном. Без настройки
 * задеты все, кого шаблон накрыл, — кроме мёртвых. С настройкой эффекта
 * `areaChoice` («до шести существ на ваш выбор в кубе», «существа по вашему
 * выбору», «кроме вас и союзников») задеты только те, кого отбор допускает и
 * кого отметил применивший.
 *
 * Область, исходящая от применившего («Волна грома», «Дрожь», дыхание
 * существа), самого применившего не задевает — пока запись не включила его
 * явно (`areaOriginatesFromCaster`).
 *
 * Словарь отбора — тот же, что у срабатываний «всем в радиусе» и «по выбору»
 * (`EffectTriggerAreaTarget`): третий словарь «свои / чужие» не заводится.
 *
 * @module system/dnd/areaChoice
 */

import type { MeasurementTemplate, SceneEntity, Token } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity, Spell } from './dndEntities.js';
import type { AreaChoiceMode, EffectAreaChoice } from './effectTriggerTypes.js';
import type { FormulaContext } from './formulaParser.js';

import { withTokenDisposition } from '@vtt/shared';

import { hasEntityCondition } from './activeEffectTypes.js';
import { getRelativeDisposition } from './auraMath.js';
import { DEATH_CONDITION_KEY } from './conditionKeys.js';
import {
  areaTargetIncludesSelf,
  areaTargetRelation,
  DEFAULT_AREA_CHOICE_FALLBACK,
  DEFAULT_AREA_CHOICE_TARGET,
  MAX_TRIGGER_CHOICE_COUNT,
  MIN_TRIGGER_CHOICE_COUNT,
} from './effectTriggerTypes.js';
import { isDndSceneEntity } from './entityGuards.js';
import { evaluateFormula } from './formulaParser.js';
import { findTokensInTemplate } from './templateGeometry.js';

/** Сущность в области и её фишка с действующим отношением */
export interface AreaCandidate {
  /** Сущность мира с данными системы */
  entity: DnDSceneEntity;
  /**
   * Фишка с действующим отношением (`withTokenDisposition` ядра): у сущности
   * приоритет, затем фишка, затем умолчание ядра
   */
  token: Token;
}

/**
 * Считается ли сущность целью области. Мёртвое существо («Мёртв»: 0 хитов у
 * существа, три провала спасбросков от смерти у персонажа) область не
 * задевает: спасбросок оно не бросает и урон не получает.
 *
 * @param entity - сущность в области
 * @returns `false`, если область её не задевает
 */
export function isAreaTarget(entity: DnDSceneEntity): boolean {
  return !hasEntityCondition(entity, DEATH_CONDITION_KEY);
}

/**
 * Кого накрыл шаблон: сущности мира с данными системы, без мёртвых и без
 * повторов (у сущности бывает несколько фишек).
 *
 * @param template - размещённый шаблон
 * @param tokens - фишки сцены
 * @param gridSize - размер клетки, пикс.
 * @param entities - сущности мира
 * @returns накрытые сущности в порядке фишек
 */
export function listAreaCandidates(
  template: MeasurementTemplate,
  tokens: readonly Token[],
  gridSize: number,
  entities: readonly SceneEntity[],
): AreaCandidate[] {
  const found = new Map<string, AreaCandidate>();

  for (const token of findTokensInTemplate(template, [...tokens], gridSize)) {
    const entity = entities.find((entry) => entry.id === token.actorId);

    if (
      !entity
      || found.has(entity.id)
      || !isDndSceneEntity(entity)
      || !isAreaTarget(entity)
    ) {
      continue;
    }

    found.set(entity.id, {
      entity,
      token: withTokenDisposition(token, entity),
    });
  }

  return [...found.values()];
}

/**
 * Что применяют с областью: заклинание либо псевдо-заклинание действия
 * существа, применения умения или предмета, кнопки «При действии». Поля
 * дальности нужны только правилу «область от применившего».
 */
export type AreaSource = Pick<Spell, 'id' | 'name' | 'level' | 'activeEffects'>
  & Partial<Pick<Spell, 'range' | 'rangeUnit' | 'deliveryType' | 'rollSource'>>;

/**
 * Единица дальности «на себя» в выгрузке заклинаний. В единицах расстояния
 * ядра её нет — запись приходит из компендиума как есть
 */
const SELF_RANGE_UNIT: string = 'self';

/**
 * Исходит ли область от применившего — а не ставится в точку на расстоянии.
 *
 * Источники описывают дальность по-разному, поэтому признак считается в одном
 * месте:
 * - заклинание — дальность «на себя»: единица дальности либо способ
 *   применения («Волна грома», «Огненные ладони», «Дрожь»);
 * - действие существа с областью — всегда: шаблон ставится от фишки существа,
 *   дальности точки у действия нет;
 * - применение умения или предмета и кнопка «При действии» — когда дальность
 *   не записана: записанная дальность значит «точка в пределах N футов».
 *
 * @param source - что применяют
 * @returns `true`, если область исходит от применившего
 */
export function areaOriginatesFromCaster(source: AreaSource): boolean {
  if (source.rollSource === undefined) {
    return (
      source.rangeUnit === SELF_RANGE_UNIT || source.deliveryType === 'self'
    );
  }

  if (source.rollSource === 'creatureAction') {
    return true;
  }

  return source.range === undefined || source.range <= 0;
}

/**
 * Включила ли запись применившего явно («включая вас»): отбор правила назван
 * и он с носителем. Умолчание отбора явным включением не считается.
 *
 * @param choice - правило выбора
 * @returns `true`, если применивший назван целью
 */
function choiceNamesCaster(choice: EffectAreaChoice | undefined): boolean {
  return choice?.target !== undefined && areaTargetIncludesSelf(choice.target);
}

/**
 * Правило выбора применения: первое `areaChoice` среди его эффектов. Правило
 * одно на применение — шаблон у него один.
 *
 * @param effects - эффекты заклинания, действия или применения
 * @returns правило либо `undefined` — задеты все в области
 */
export function findAreaChoice(
  effects: readonly ActiveEffect[] | undefined,
): EffectAreaChoice | undefined {
  return effects?.find((effect) => effect.areaChoice !== undefined)?.areaChoice;
}

/**
 * Как выбирают: без поля `mode` — «все» у правила без числа и «до N» у
 * правила с числом.
 *
 * @param choice - правило выбора
 * @returns режим выбора
 */
export function resolveAreaChoiceMode(
  choice: EffectAreaChoice,
): AreaChoiceMode {
  return choice.mode ?? (choice.count === undefined ? 'all' : 'upTo');
}

/**
 * Сколько целей можно отметить: число как есть, формула — от чисел
 * применившего (`@castLevel`, `@mod.cha`).
 *
 * @param choice - правило выбора
 * @param context - числа применившего; нет — формула не считается
 * @returns предел от 1 либо `undefined` — без предела (поля нет, формула не
 *   посчиталась)
 */
export function resolveAreaChoiceCount(
  choice: EffectAreaChoice,
  context?: FormulaContext,
): number | undefined {
  const { count } = choice;

  if (count === undefined) {
    return undefined;
  }

  let value: number;

  if (typeof count === 'number') {
    value = count;
  } else if (context) {
    try {
      value = evaluateFormula(count, context);
    } catch {
      return undefined;
    }
  } else {
    return undefined;
  }

  return Number.isFinite(value)
    ? Math.min(
        MAX_TRIGGER_CHOICE_COUNT,
        Math.max(MIN_TRIGGER_CHOICE_COUNT, Math.floor(value)),
      )
    : undefined;
}

/**
 * Кого из накрытых правило допускает: отношение к применившему и входит ли
 * он сам. Без поля `target` допускаются все в области вместе с применившим —
 * как у области без правила.
 *
 * @param candidates - накрытые шаблоном
 * @param choice - правило выбора
 * @param caster - применивший и его фишка
 * @returns допущенные кандидаты
 */
export function filterAreaCandidates(
  candidates: readonly AreaCandidate[],
  choice: EffectAreaChoice,
  caster: AreaCaster | undefined,
): AreaCandidate[] {
  const target = choice.target ?? DEFAULT_AREA_CHOICE_TARGET;
  const relation = areaTargetRelation(target);

  return candidates.filter((candidate) => {
    if (caster && candidate.entity.id === caster.entity.id) {
      return areaTargetIncludesSelf(target);
    }

    if (relation === 'all') {
      return true;
    }

    // Применившего на сцене нет — отношение не из чего посчитать: ни
    // «союзников», ни «врагов» правило не допускает
    const disposition = getRelativeDisposition(
      { disposition: caster?.disposition },
      candidate.token,
    );

    return relation === 'allies'
      ? disposition === 'ally'
      : disposition === 'enemy';
  });
}

/** Применивший: сущность и действующее отношение его фишки */
export interface AreaCaster {
  /** Сущность применившего */
  entity: SceneEntity;
  /** Отношение его фишки; нет — применившего нет на сцене */
  disposition: Token['disposition'];
}

/**
 * Применивший с отношением его фишки на сцене.
 *
 * @param caster - сущность применившего
 * @param tokens - фишки сцены
 * @returns применивший либо `undefined`, если сущности нет
 */
export function resolveAreaCaster(
  caster: SceneEntity | undefined,
  tokens: readonly Token[],
): AreaCaster | undefined {
  if (!caster) {
    return undefined;
  }

  const token = tokens.find((entry) => entry.actorId === caster.id);

  return {
    entity: caster,
    disposition: token
      ? withTokenDisposition(token, caster).disposition
      : caster.token?.disposition,
  };
}

/** Что нужно спросить у применившего */
export interface AreaChoiceRequest {
  /** Из кого выбирать */
  candidates: AreaCandidate[];
  /** Сколько можно отметить самое большее */
  max: number;
  /** Сколько нужно отметить самое меньшее; 0 — можно никого */
  min: number;
}

/** Чем уточняется разбор целей области */
export interface AreaTargetsPlanOptions {
  /** Числа применившего для предела формулой */
  context?: FormulaContext;
  /**
   * Область исходит от применившего (`areaOriginatesFromCaster`): сам он не
   * цель, пока правило не включило его явно
   */
  originatesFromCaster?: boolean;
}

/** Итог разбора целей области до вопроса применившему */
export type AreaTargetsPlan =
  | {
      /** Спрашивать некого: цели известны */
      kind: 'settled';
      /** Задетые сущности */
      targets: DnDSceneEntity[];
    }
  | {
      /** Применивший отмечает цели */
      kind: 'choose';
      /** Вопрос */
      request: AreaChoiceRequest;
      /** Кого задеть, если выбор не сделан (плашку закрыли) */
      fallbackTargets: DnDSceneEntity[];
    };

/**
 * Решает, кого задевает область и надо ли спрашивать применившего.
 *
 * @param candidates - накрытые шаблоном (`listAreaCandidates`)
 * @param choice - правило выбора; нет — задеты все накрытые
 * @param caster - применивший и его фишка (`resolveAreaCaster`)
 * @param options - числа применившего и признак «область от применившего»
 * @returns цели либо вопрос применившему
 */
export function planAreaTargets(
  candidates: readonly AreaCandidate[],
  choice: EffectAreaChoice | undefined,
  caster: AreaCaster | undefined,
  options: AreaTargetsPlanOptions = {},
): AreaTargetsPlan {
  // Область от применившего его самого не задевает: ни целью, ни строкой в
  // списке выбора. Обратное говорит только запись — отбором «с носителем»
  const covered =
    options.originatesFromCaster && caster && !choiceNamesCaster(choice)
      ? candidates.filter(
          (candidate) => candidate.entity.id !== caster.entity.id,
        )
      : candidates;

  if (!choice) {
    return {
      kind: 'settled',
      targets: covered.map((candidate) => candidate.entity),
    };
  }

  const allowed = filterAreaCandidates(covered, choice, caster);
  const allowedEntities = allowed.map((candidate) => candidate.entity);
  const mode = resolveAreaChoiceMode(choice);

  // «Все»: правило только отсеивает («кроме вас», «только враги»)
  if (mode === 'all' || allowed.length === 0) {
    return { kind: 'settled', targets: allowedEntities };
  }

  const max = Math.min(
    resolveAreaChoiceCount(choice, options.context) ?? allowed.length,
    allowed.length,
  );

  return {
    kind: 'choose',
    request: {
      candidates: allowed,
      max,
      min: mode === 'exactly' ? max : 0,
    },
    fallbackTargets:
      (choice.fallback ?? DEFAULT_AREA_CHOICE_FALLBACK) === 'all'
        ? allowedEntities
        : [],
  };
}

/**
 * Отмеченные применившим цели — из тех, кого предлагали, не больше предела.
 * Ответ приходит из окна: чужой id и лишняя отметка отбрасываются.
 *
 * @param request - вопрос
 * @param chosenIds - отмеченные id
 * @returns задетые сущности в порядке списка
 */
export function settleAreaChoice(
  request: AreaChoiceRequest,
  chosenIds: readonly string[],
): DnDSceneEntity[] {
  const chosen = new Set(chosenIds);

  return request.candidates
    .filter((candidate) => chosen.has(candidate.entity.id))
    .slice(0, request.max)
    .map((candidate) => candidate.entity);
}
