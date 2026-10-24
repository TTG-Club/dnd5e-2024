/**
 * Этажи и высота сцены глазами правил D&D 5e: рост существа, 3D-расстояние
 * между фишками и «достаёт ли сквозь пол».
 *
 * Геометрию — этажи, проёмы, отрезки фишек, слои клеток — считает ядро
 * (`@vtt/shared`, VTTG 0.9.780); здесь только правила поверх неё: рост по
 * размеру, лёжа ниже, и что удар, «Тактика стаи» и дальность заклинания не
 * проходят сквозь перекрытие без проёма. Одна мера на клиент и сервер, иначе
 * лист и сервер разошлись бы в «достаёт ли».
 *
 * Сцена без этажей и фишки без высоты дают то же, что плоская мера
 * (`getTokenEdgeDistance`): это проверено тестами ядра бит в бит.
 *
 * @module system/dnd/sceneLevels
 */

import type {
  CustomArea,
  GridSettings,
  Scene,
  SceneFloor,
  SceneVerticalModel,
  Token,
  VerticalRange,
} from '@vtt/shared';

import type { DnDSceneEntity } from './dndEntities.js';
import type { CreatureSize } from './types.js';

import {
  buildSceneVerticalModel,
  getTokenPlanCenter,
  getTokenVerticalRange,
  getVerticalLayerGap,
  isOpenThroughFloors,
  measureEdgeDistance3d,
  normalizeFloorId,
  resolveGridCellSize,
} from '@vtt/shared';

import { hasEntityCondition } from './activeEffectTypes.js';
import { PRONE_CONDITION_KEY } from './conditionKeys.js';
import { normalizeCreatureSize } from './consts.js';

/**
 * Рост существа по размеру, футы. В PHB 2024 роста нет, есть сторона
 * пространства (крошечное — 2½ фута, огромное — 15); рост берётся равным ей,
 * как ширина фишки по плану.
 */
export const CREATURE_SIZE_HEIGHT_FEET: Record<CreatureSize, number> = {
  tiny: 2.5,
  small: 5,
  medium: 5,
  large: 10,
  huge: 15,
  gargantuan: 20,
};

/** Во сколько раз ниже лежащее существо */
export const PRONE_HEIGHT_RATIO = 0.5;

/**
 * Рост сущности по правилам D&D, футы: сторона пространства по размеру, лёжа
 * — вдвое ниже. Хук `resolveEntityHeight` ядра отдаёт его как есть: система
 * меряет в футах, а сетка сцены ядра у хука не спрашивается.
 *
 * @param entity - сущность сцены
 * @returns рост, футы
 */
export function resolveDndEntityHeight(entity: DnDSceneEntity): number {
  const height =
    CREATURE_SIZE_HEIGHT_FEET[normalizeCreatureSize(entity.system.size)];

  return hasEntityCondition(entity, PRONE_CONDITION_KEY)
    ? height * PRONE_HEIGHT_RATIO
    : height;
}

/** Сцена в объёме, нужном вертикали: сетка, этажи и области (проёмы, площадки) */
export interface LevelSceneInput {
  /** Сетка сцены */
  gridSettings: GridSettings;
  /** Этажи; нет — одноэтажная сцена (или старое ядро) */
  floors?: readonly SceneFloor[];
  /** Пользовательские области: проёмы в полу, площадки, лестницы */
  customAreas?: readonly CustomArea[];
}

/**
 * Модель вертикали ядра по тому, что знает вызывающий. Полной сцены у
 * правил на сервере нет (только сетка, этажи и области из окружения ядра),
 * поэтому сцена собирается из этих частей; остальные её поля вертикаль не
 * читает. Модель — снимок: строить на каждый расчёт, а в цикле — один раз.
 *
 * @param scene - сетка, этажи и области сцены
 * @returns модель вертикали
 */
export function buildLevelModel(scene: LevelSceneInput): SceneVerticalModel {
  const verticalScene: Scene = {
    id: '',
    name: '',
    width: 0,
    height: 0,
    backgroundImage: '',
    gridSettings: scene.gridSettings,
    tokens: [],
    drawings: [],
    visibility: 'hidden',
    forceView: false,
    floors: scene.floors ? [...scene.floors] : undefined,
    customAreas: scene.customAreas ? [...scene.customAreas] : undefined,
  };

  return buildSceneVerticalModel(verticalScene);
}

/** Фишка как участник 3D-меры */
export interface LevelTokenSubject {
  /** Фишка: угол, масштаб, этаж и высота над полом */
  token: Pick<Token, 'x' | 'y' | 'scale' | 'floorId' | 'aboveFloor'>;
  /** Рост; нет — по умолчанию ядра (сторона клетки × масштаб) */
  height?: number;
  /** Масштаб с учётом сущности; нет — `token.scale` */
  scale?: number;
}

/**
 * Участник 3D-меры для фишки сущности: рост по правилам D&D, если сущность
 * известна.
 *
 * @param token - фишка
 * @param entity - её сущность
 * @param scale - масштаб с учётом сущности
 * @returns участник меры
 */
export function toLevelSubject(
  token: LevelTokenSubject['token'],
  entity?: DnDSceneEntity,
  scale?: number,
): LevelTokenSubject {
  return {
    token,
    height: entity ? resolveDndEntityHeight(entity) : undefined,
    scale,
  };
}

/**
 * Абсолютный отрезок фишки `[низ, верх)` в единицах сцены.
 *
 * @param model - модель вертикали
 * @param subject - фишка с ростом
 * @returns отрезок
 */
export function resolveLevelTokenRange(
  model: SceneVerticalModel,
  subject: LevelTokenSubject,
): VerticalRange {
  return getTokenVerticalRange(model, subject.token, {
    height: subject.height,
    scale: subject.scale,
  });
}

/**
 * На сколько единиц сцены точка проверки отступает внутрь отрезка фишки от
 * его края: ступни стоящего лежат ровно на плоскости пола, а плоскость,
 * которой отрезок лишь касается, перекрытием не считается.
 */
const BODY_EDGE_INSET = 0.01;

/** Отрезок по одной оси: от и до */
interface AxisSpan {
  /** Начало */
  min: number;
  /** Конец (не меньше начала) */
  max: number;
}

/**
 * Ближайшие точки двух отрезков на одной оси: пересекаются — обе в середине
 * общей части; нет — на обращённых друг к другу концах, отступив внутрь на
 * `inset`.
 *
 * @param spanA - отрезок первой фишки
 * @param spanB - отрезок второй фишки
 * @param inset - отступ внутрь
 * @returns координаты на оси для первой и второй
 */
function closestOnAxis(
  spanA: AxisSpan,
  spanB: AxisSpan,
  inset: number,
): [number, number] {
  if (spanA.min >= spanB.max) {
    return [
      Math.min(spanA.min + inset, spanA.max),
      Math.max(spanB.max - inset, spanB.min),
    ];
  }

  if (spanB.min >= spanA.max) {
    return [
      Math.max(spanA.max - inset, spanA.min),
      Math.min(spanB.min + inset, spanB.max),
    ];
  }

  const middle =
    (Math.max(spanA.min, spanB.min) + Math.min(spanA.max, spanB.max)) / 2;

  return [middle, middle];
}

/**
 * Отпечаток фишки по плану, пиксели.
 *
 * @param model - модель вертикали
 * @param subject - фишка
 * @returns отрезки по X и Y
 */
function resolveFootprint(
  model: SceneVerticalModel,
  subject: LevelTokenSubject,
): { x: AxisSpan; y: AxisSpan } {
  const center = getTokenPlanCenter(
    model,
    subject.token,
    subject.scale ?? subject.token.scale,
  );

  const half =
    (resolveGridCellSize(model.gridSettings)
      * (subject.scale ?? subject.token.scale))
    / 2;

  return {
    x: { min: center.x - half, max: center.x + half },
    y: { min: center.y - half, max: center.y + half },
  };
}

/**
 * Проходит ли тело (удар, бросок, снаряд) от одной фишки к другой сквозь
 * перекрытия этажей: на своём этаже — всегда, между этажами — только через
 * открытый проём для движения или мимо края пола (балкон над двором).
 * Стеклянный пол и закрытый люк не пропускают.
 *
 * Отрезок проверки соединяет ближайшие точки фишек (их отпечатков и роста):
 * лучник с края балкона дотягивается до двора, а из середины комнаты наверху
 * сквозь её пол — нет.
 *
 * @param model - модель вертикали
 * @param subjectA - первая фишка
 * @param rangeA - её отрезок
 * @param subjectB - вторая фишка
 * @param rangeB - её отрезок
 * @returns true, если перекрытие не мешает
 */
export function isLevelPathOpen(
  model: SceneVerticalModel,
  subjectA: LevelTokenSubject,
  rangeA: VerticalRange,
  subjectB: LevelTokenSubject,
  rangeB: VerticalRange,
): boolean {
  if (
    normalizeFloorId(subjectA.token.floorId)
    === normalizeFloorId(subjectB.token.floorId)
  ) {
    return true;
  }

  const footprintA = resolveFootprint(model, subjectA);
  const footprintB = resolveFootprint(model, subjectB);
  const [xA, xB] = closestOnAxis(footprintA.x, footprintB.x, 0);
  const [yA, yB] = closestOnAxis(footprintA.y, footprintB.y, 0);

  const [zA, zB] = closestOnAxis(
    { min: rangeA.bottom, max: rangeA.top },
    { min: rangeB.bottom, max: rangeB.top },
    BODY_EDGE_INSET,
  );

  return isOpenThroughFloors(
    model,
    { x: xA, y: yA, z: zA },
    { x: xB, y: yB, z: zB },
    'movement',
  );
}

/** 3D-расстояние между фишками и то, мешает ли перекрытие */
export interface LevelDistance {
  /** Расстояние по правилу диагоналей сцены, единицы сцены */
  distance: number;
  /** Расстояние по плану, единицы сцены */
  horizontalDistance: number;
  /** Разница слоёв по вертикали, единицы сцены */
  verticalDistance: number;
  /** Между фишками перекрытие без проёма: ни удар, ни заклинание не проходят */
  blocked: boolean;
}

/**
 * Расстояние между краями двух фишек в 3D — мера ядра (вертикаль в слоях
 * клеток, правило диагоналей сцены) плюс признак перекрытия.
 *
 * @param model - модель вертикали
 * @param subjectA - первая фишка
 * @param subjectB - вторая фишка
 * @returns расстояние и его части
 */
export function measureLevelDistance(
  model: SceneVerticalModel,
  subjectA: LevelTokenSubject,
  subjectB: LevelTokenSubject,
): LevelDistance {
  const rangeA = resolveLevelTokenRange(model, subjectA);
  const rangeB = resolveLevelTokenRange(model, subjectB);

  const measured = measureEdgeDistance3d(
    model.gridSettings,
    {
      x: subjectA.token.x,
      y: subjectA.token.y,
      scale: subjectA.scale ?? subjectA.token.scale,
    },
    rangeA,
    {
      x: subjectB.token.x,
      y: subjectB.token.y,
      scale: subjectB.scale ?? subjectB.token.scale,
    },
    rangeB,
  );

  return {
    ...measured,
    blocked: !isLevelPathOpen(model, subjectA, rangeA, subjectB, rangeB),
  };
}

/**
 * Расстояние досягаемости: 3D-расстояние, а сквозь перекрытие — бесконечность
 * (ни удар, ни «союзник рядом» не считаются).
 *
 * @param model - модель вертикали
 * @param subjectA - первая фишка
 * @param subjectB - вторая фишка
 * @returns расстояние, единицы сцены
 */
export function getLevelReachDistance(
  model: SceneVerticalModel,
  subjectA: LevelTokenSubject,
  subjectB: LevelTokenSubject,
): number {
  return toReachDistance(measureLevelDistance(model, subjectA, subjectB));
}

/**
 * Расстояние досягаемости из 3D-меры: сквозь перекрытие — бесконечность.
 *
 * @param measured - 3D-расстояние
 * @returns расстояние, единицы сцены
 */
export function toReachDistance(measured: LevelDistance): number {
  return measured.blocked ? Number.POSITIVE_INFINITY : measured.distance;
}

/**
 * Зазор между двумя отрезками по вертикали в слоях клеток × шаг — так же, как
 * вертикальная часть 3D-меры ядра: летун, у которого низ на 10 футах над
 * средним существом на полу, — 10 футов, касающийся макушки — 5.
 *
 * @param rangeA - первый отрезок
 * @param rangeB - второй отрезок
 * @param step - шаг слоя (масштаб клетки)
 * @returns зазор, единицы сцены
 */
export function getVerticalLayerGapUnits(
  rangeA: VerticalRange,
  rangeB: VerticalRange,
  step: number,
): number {
  return step > 0 ? getVerticalLayerGap(rangeA, rangeB, step) * step : 0;
}

/**
 * Зазор между двумя отрезками по вертикали, единицы сцены, без нарезки на
 * слои: так меряют ауры и сферы — «во все стороны от существа» на столько-то
 * футов, как и их круг по плану.
 *
 * @param rangeA - первый отрезок
 * @param rangeB - второй отрезок
 * @returns зазор; пересекаются — 0
 */
export function getVerticalRangeGap(
  rangeA: VerticalRange,
  rangeB: VerticalRange,
): number {
  return Math.max(
    0,
    Math.max(rangeA.bottom, rangeB.bottom) - Math.min(rangeA.top, rangeB.top),
  );
}

/** Вертикаль пары фишек: их отрезки и перекрытие между ними */
export interface LevelPairVertical {
  /** Отрезок первой фишки */
  rangeA: VerticalRange;
  /** Отрезок второй фишки */
  rangeB: VerticalRange;
  /** Между ними перекрытие без проёма */
  blocked: boolean;
}

/**
 * Вертикаль пары фишек, если её можно знать. Фишки разных этажей, которых
 * модель не знает (правилам не дали этажей сцены), меряются только по плану:
 * отметки их полов неизвестны, а отсев по этажу тогда уже сделало ядро.
 *
 * @param model - модель вертикали
 * @param subjectA - первая фишка
 * @param subjectB - вторая фишка
 * @returns отрезки и перекрытие либо `undefined` — вертикаль неизвестна
 */
export function resolveLevelPairVertical(
  model: SceneVerticalModel,
  subjectA: LevelTokenSubject,
  subjectB: LevelTokenSubject,
): LevelPairVertical | undefined {
  const floorA = normalizeFloorId(subjectA.token.floorId);
  const floorB = normalizeFloorId(subjectB.token.floorId);

  if (
    floorA !== floorB
    && (!model.floorIndexById.has(floorA) || !model.floorIndexById.has(floorB))
  ) {
    return undefined;
  }

  const rangeA = resolveLevelTokenRange(model, subjectA);
  const rangeB = resolveLevelTokenRange(model, subjectB);

  return {
    rangeA,
    rangeB,
    blocked: !isLevelPathOpen(model, subjectA, rangeA, subjectB, rangeB),
  };
}
