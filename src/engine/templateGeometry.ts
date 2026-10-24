/**
 * Геометрические утилиты для проверки попадания точек
 * в области шаблонов измерений (AoE).
 *
 * Используются как на клиенте (рендеринг), так и для определения,
 * какие токены попали в область заклинания.
 */

import type {
  DiagonalRule,
  DistanceUnit,
  MeasurementTemplate,
  ScenePoint3d,
  SceneVerticalModel,
  SpellAreaOfEffect,
  Token,
  VerticalRange,
} from '@vtt/shared';

import {
  convertDistance,
  getPointVerticalRange,
  getTokenPlanCenter,
  getTokenVerticalRange,
  isOpenThroughFloors,
  isPointInCircle,
  normalizeFloorId,
} from '@vtt/shared';

/**
 * Половинный угол конуса D&D 5e (радианы).
 * Ширина конуса на конце равна его длине → половинный угол arctan(0.5)
 * ≈ 26.57° (полный ≈ 53.13°).
 */
const MEASUREMENT_CONE_HALF_ANGLE = Math.atan(0.5);

/**
 * Сеточная норма вектора в пикселях — «выпрямленное» расстояние по правилу
 * диагоналей. Равна евклидовой длине вектора, направленного строго вдоль оси,
 * который имеет то же расстояние в клетках, что и исходный вектор.
 *
 * Для шаблонов используется непрерывная форма правила `alternating`
 * (каждая диагональная клетка стоит 1.5), без «лесенки» округления,
 * чтобы форма области была непрерывной.
 *
 * @param deltaX - смещение по X (пиксели)
 * @param deltaY - смещение по Y (пиксели)
 * @param rule - правило расчёта диагоналей
 * @returns сеточное расстояние в пикселях
 */
export function getTemplateGridNorm(
  deltaX: number,
  deltaY: number,
  rule: DiagonalRule,
): number {
  const absX = Math.abs(deltaX);
  const absY = Math.abs(deltaY);

  switch (rule) {
    case 'chebyshev': {
      // D&D 5e: диагональ стоит как прямая клетка
      return Math.max(absX, absY);
    }
    case 'alternating': {
      // D&D 3.5e/PF: диагональ в среднем стоит 1.5 клетки
      return Math.max(absX, absY) + Math.min(absX, absY) / 2;
    }
    case 'euclidean':
    default: {
      return Math.hypot(absX, absY);
    }
  }
}

/**
 * Порог (квадрат расстояния в пикселях), при котором точка считается
 * совпадающей с вершиной конуса. `Math.atan2(0, 0)` возвращает 0, из-за чего
 * угловая проверка ложно отсекала точку-источник для конусов, направленных
 * не вдоль оси X.
 */
const CONE_APEX_EPSILON_SQ = 1;

/**
 * Угловой допуск (радианы) для точек на рёбрах конуса. Центры клеток,
 * лежащие точно на ребре (например, боковые клетки осевого конуса),
 * без допуска включаются или выпадают по погрешности последнего бита:
 * `π/2 − atan(2)` отличается от `atan(0.5)` на 1 ulp, поэтому конус вправо
 * захватывал боковые клетки, а такой же конус вниз — нет.
 */
const CONE_EDGE_ANGLE_EPSILON = 1e-9;

/**
 * Проверяет, попадает ли вектор (deltaX, deltaY) в угловой сектор конуса.
 * Вершина конуса (нулевой вектор) всегда внутри — иначе `atan2(0,0)=0`
 * ложно отсекал бы точку-источник для конусов, направленных не вдоль оси X.
 *
 * @param deltaX - смещение точки от вершины по X
 * @param deltaY - смещение точки от вершины по Y
 * @param direction - угол направления конуса (радианы)
 * @param halfAngle - половинный угол конуса (радианы)
 * @returns true если направление внутри сектора
 */
function isDirectionWithinCone(
  deltaX: number,
  deltaY: number,
  direction: number,
  halfAngle: number,
): boolean {
  if (deltaX * deltaX + deltaY * deltaY < CONE_APEX_EPSILON_SQ) {
    return true;
  }

  const angle = Math.atan2(deltaY, deltaX);

  let diff = angle - direction;

  while (diff > Math.PI) {
    diff -= 2 * Math.PI;
  }

  while (diff < -Math.PI) {
    diff += 2 * Math.PI;
  }

  return Math.abs(diff) <= halfAngle + CONE_EDGE_ANGLE_EPSILON;
}

/**
 * Проверяет, находится ли точка внутри конуса (сектора).
 *
 * @param pointX - X координата точки
 * @param pointY - Y координата точки
 * @param originX - X начала конуса
 * @param originY - Y начала конуса
 * @param direction - угол направления конуса (радианы)
 * @param halfAngle - половинный угол конуса (радианы)
 * @param radius - длина конуса
 * @returns true если точка внутри конуса
 */
export function isPointInCone(
  pointX: number,
  pointY: number,
  originX: number,
  originY: number,
  direction: number,
  halfAngle: number,
  radius: number,
): boolean {
  const dx = pointX - originX;
  const dy = pointY - originY;
  const adjustedRadius = radius + 0.1;

  if (dx * dx + dy * dy > adjustedRadius * adjustedRadius) {
    return false;
  }

  return isDirectionWithinCone(dx, dy, direction, halfAngle);
}

/**
 * Проверяет, находится ли точка внутри повёрнутого прямоугольника (луча).
 *
 * @param pointX - X координата точки
 * @param pointY - Y координата точки
 * @param originX - X начала луча
 * @param originY - Y начала луча
 * @param direction - угол направления (радианы)
 * @param length - длина луча
 * @param width - ширина луча
 * @returns true если точка внутри луча
 */
export function isPointInRay(
  pointX: number,
  pointY: number,
  originX: number,
  originY: number,
  direction: number,
  length: number,
  width: number,
): boolean {
  const dx = pointX - originX;
  const dy = pointY - originY;
  const cos = Math.cos(-direction);
  const sin = Math.sin(-direction);
  const localX = dx * cos - dy * sin;
  const localY = dx * sin + dy * cos;
  const halfWidth = width / 2;

  // Epsilon для компенсации ошибок тригонометрии при повороте координат.
  // Без него cos(-π/2) ≈ 6.12e-17 вместо 0, что при boundary check
  // приводит к пропуску клеток на одной из сторон луча.
  const epsilon = 0.5;

  return (
    localX >= -epsilon
    && localX <= length + epsilon
    && localY >= -halfWidth - epsilon
    && localY <= halfWidth + epsilon
  );
}

/**
 * Проверяет, находится ли точка внутри axis-aligned прямоугольника.
 *
 * @param pointX - X координата точки
 * @param pointY - Y координата точки
 * @param originX - X первого угла
 * @param originY - Y первого угла
 * @param targetX - X противоположного угла
 * @param targetY - Y противоположного угла
 * @returns true если точка внутри прямоугольника
 */
export function isPointInRect(
  pointX: number,
  pointY: number,
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
): boolean {
  const minX = Math.min(originX, targetX);
  const maxX = Math.max(originX, targetX);
  const minY = Math.min(originY, targetY);
  const maxY = Math.max(originY, targetY);

  return pointX >= minX && pointX <= maxX && pointY >= minY && pointY <= maxY;
}

/**
 * Проверяет, попадает ли точка внутрь области шаблона.
 *
 * @param pointX - X координата точки
 * @param pointY - Y координата точки
 * @param gridSize - размер клетки в пикселях (дефолтная ширина луча)
 * @param template - шаблон измерения
 * @returns true если точка внутри области
 */
export function isPointInTemplate(
  pointX: number,
  pointY: number,
  gridSize: number,
  template: MeasurementTemplate,
): boolean {
  const dx = template.targetX - template.originX;
  const dy = template.targetY - template.originY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance < 1) {
    return false;
  }

  const direction = Math.atan2(dy, dx);

  switch (template.type) {
    case 'circle':
      return isPointInCircle(
        pointX,
        pointY,
        template.originX,
        template.originY,
        distance,
      );
    case 'cone':
      return isPointInCone(
        pointX,
        pointY,
        template.originX,
        template.originY,
        direction,
        MEASUREMENT_CONE_HALF_ANGLE,
        distance,
      );
    case 'rect':
      return isPointInRect(
        pointX,
        pointY,
        template.originX,
        template.originY,
        template.targetX,
        template.targetY,
      );
    case 'ray': {
      const rayWidth = template.width ?? gridSize;

      return isPointInRay(
        pointX,
        pointY,
        template.originX,
        template.originY,
        direction,
        distance,
        rayWidth,
      );
    }
    case 'cylinder':
      return isPointInCircle(
        pointX,
        pointY,
        template.originX,
        template.originY,
        distance,
      );
    default:
      return false;
  }
}

/**
 * Допуск на границе объёма, пикселей: точка ровно на верхней грани куба или
 * на краю сферы не должна выпадать по погрешности перевода футов в пиксели.
 */
const TEMPLATE_VOLUME_EPSILON_PX = 0.1;

/**
 * Сколько единиц сцены в клетке, когда хук ядра сетки не назвал: клетка D&D —
 * 5 футов.
 */
export const DEFAULT_TEMPLATE_UNITS_PER_CELL = 5;

/**
 * Попадает ли точка в ОБЪЁМ шаблона по правилам D&D 5e (PHB 2024, «Области
 * воздействия»):
 * - круг (`circle`) — **сфера** с центром в точке начала: огненный шар
 *   задевает и балкон над двором, и летуна;
 * - цилиндр — круг от точки начала вверх на свою высоту
 *   (`template.height`, из `areaOfEffect.height`); без высоты — вверх без
 *   предела (до потолка, его режет ядро);
 * - куб (`rect`) — от пола точки начала вверх на свою сторону;
 * - конус — объёмный, с горизонтальной осью: угол к оси меряется в 3D, и
 *   ширина у основания равна длине и вверх, и вниз;
 * - линия (`ray`) — брус своей ширины, по высоте — полширины вверх и вниз.
 *
 * На высоте точки начала ответ тот же, что у плоского
 * {@link isPointInTemplate}.
 *
 * @param point - точка: план в пикселях, высота в единицах сцены
 * @param origin - точка начала шаблона: план в пикселях, высота в единицах
 * @param template - шаблон
 * @param gridSize - размер клетки, пикселей
 * @param unitsPerCell - единиц сцены в клетке (футов)
 * @returns true, если точка в объёме
 */
export function isPointInTemplateVolume(
  point: ScenePoint3d,
  origin: ScenePoint3d,
  template: MeasurementTemplate,
  gridSize: number,
  unitsPerCell: number,
): boolean {
  if (!isPointInTemplate(point.x, point.y, gridSize, template)) {
    // Сфера и конус в объёме по плану не шире своего круга: вне плоской
    // фигуры точка не попадёт и выше или ниже
    return false;
  }

  const pixelsPerUnit = unitsPerCell > 0 ? gridSize / unitsPerCell : 0;
  const dz = (point.z - origin.z) * pixelsPerUnit;

  if (dz === 0) {
    return true;
  }

  const dx = point.x - template.originX;
  const dy = point.y - template.originY;
  const axisX = template.targetX - template.originX;
  const axisY = template.targetY - template.originY;
  const length = Math.hypot(axisX, axisY);

  switch (template.type) {
    case 'circle': {
      return Math.hypot(dx, dy, dz) <= length + TEMPLATE_VOLUME_EPSILON_PX;
    }
    case 'cylinder': {
      const heightPx =
        template.height === undefined
          ? Number.POSITIVE_INFINITY
          : template.height * pixelsPerUnit;

      return (
        dz >= -TEMPLATE_VOLUME_EPSILON_PX
        && dz <= heightPx + TEMPLATE_VOLUME_EPSILON_PX
      );
    }
    case 'rect': {
      const sidePx = Math.max(Math.abs(axisX), Math.abs(axisY));

      return (
        dz >= -TEMPLATE_VOLUME_EPSILON_PX
        && dz <= sidePx + TEMPLATE_VOLUME_EPSILON_PX
      );
    }
    case 'cone': {
      const distance = Math.hypot(dx, dy, dz);

      if (distance > length + TEMPLATE_VOLUME_EPSILON_PX) {
        return false;
      }

      // Проекция на горизонтальную ось конуса против наклона к ней
      const alongAxis = (dx * axisX + dy * axisY) / length;

      return (
        Math.acos(Math.min(1, alongAxis / distance))
        <= MEASUREMENT_CONE_HALF_ANGLE + CONE_EDGE_ANGLE_EPSILON
      );
    }
    case 'ray': {
      const halfWidth = (template.width ?? gridSize) / 2;

      return Math.abs(dz) <= halfWidth + TEMPLATE_VOLUME_EPSILON_PX;
    }
    default: {
      return false;
    }
  }
}

/**
 * Шаблон с высотой цилиндра из записи заклинания. Хост при размещении
 * переносит в шаблон только форму, размер и ширину, а высота цилиндра живёт
 * в `areaOfEffect.height`; без неё цилиндр («Лунный луч», «Огненная стена»
 * кольцом) был бы бесконечно высоким. Высота переводится в единицы сцены.
 *
 * @param template - размещённый шаблон
 * @param area - область заклинания; нет — шаблон как есть
 * @param sceneUnit - единицы сцены; нет — высота в единицах записи
 * @returns шаблон с высотой цилиндра
 */
export function withTemplateAreaHeight(
  template: MeasurementTemplate,
  area: SpellAreaOfEffect | undefined,
  sceneUnit: DistanceUnit | undefined,
): MeasurementTemplate {
  if (
    template.type !== 'cylinder'
    || template.height !== undefined
    || area?.height === undefined
  ) {
    return template;
  }

  return {
    ...template,
    height: sceneUnit
      ? convertDistance(area.height, area.unit, sceneUnit)
      : area.height,
  };
}

/**
 * Вертикаль сцены для шаблона: модель этажей и рост фишек. Без неё шаблон
 * плоский, как раньше.
 */
export interface TemplateLevelContext {
  /** Модель вертикали сцены */
  model: SceneVerticalModel;
  /** Рост фишки по правилам; нет ответа — по умолчанию ядра */
  resolveHeight?: (token: Token) => number | undefined;
}

/**
 * Абсолютная точка начала шаблона: план и высота его этажа плюс
 * `aboveFloor`.
 *
 * @param model - модель вертикали
 * @param template - шаблон
 * @returns точка начала
 */
export function resolveTemplateOrigin(
  model: SceneVerticalModel,
  template: MeasurementTemplate,
): ScenePoint3d {
  return {
    x: template.originX,
    y: template.originY,
    z: getPointVerticalRange(
      model,
      template.floorId,
      template.aboveFloor,
      template.originX,
      template.originY,
    ).bottom,
  };
}

/**
 * На сколько единиц сцены пробные точки роста отступают внутрь отрезка фишки:
 * ступни лежат ровно на плоскости пола, и без отступа пол под ними не
 * считался бы преградой.
 */
const TEMPLATE_BODY_INSET = 0.01;

/**
 * Пробные высоты на росте фишки: ближайшая к точке начала шаблона, ступни,
 * середина и макушка (с отступом внутрь). Шаблон задевает существо, если
 * задевает хоть часть его роста, до которой от начала ничто не закрывает.
 *
 * @param range - отрезок фишки
 * @param originZ - высота точки начала
 * @returns высоты пробных точек
 */
function listProbeHeights(range: VerticalRange, originZ: number): number[] {
  const inset = Math.min(TEMPLATE_BODY_INSET, (range.top - range.bottom) / 2);
  const low = range.bottom + inset;
  const high = Math.max(low, range.top - inset);

  return [
    Math.min(Math.max(originZ, low), high),
    low,
    (range.bottom + range.top) / 2,
    high,
  ];
}

/**
 * Накрывает ли шаблон фишку в объёме: центр фишки по плану, по высоте — хоть
 * одна пробная точка роста в объёме, и между ней и точкой начала нет
 * перекрытия без проёма (огненный шар во дворе не жжёт сквозь пол комнату
 * над ним, а того, кто стоит на балконе над краем двора, — жжёт).
 *
 * @param token - фишка
 * @param template - шаблон
 * @param gridSize - размер клетки, пикселей
 * @param levels - вертикаль сцены
 * @param origin - точка начала шаблона
 * @returns true, если фишка в объёме
 */
function isTokenInTemplateVolume(
  token: Token,
  template: MeasurementTemplate,
  gridSize: number,
  levels: TemplateLevelContext,
  origin: ScenePoint3d,
): boolean {
  const { model } = levels;
  const center = getTokenPlanCenter(model, token, token.scale);

  const range = getTokenVerticalRange(model, token, {
    height: levels.resolveHeight?.(token),
  });

  const sameFloor =
    normalizeFloorId(token.floorId) === normalizeFloorId(template.floorId);

  return listProbeHeights(range, origin.z).some((z) => {
    const point = { ...center, z };

    return (
      isPointInTemplateVolume(point, origin, template, gridSize, model.cellStep)
      && (sameFloor || isOpenThroughFloors(model, origin, point, 'movement'))
    );
  });
}

/**
 * Проверяет, попадает ли центр токена в область шаблона.
 *
 * @param tokenX - X позиция токена (левый верхний угол)
 * @param tokenY - Y позиция токена (левый верхний угол)
 * @param tokenScale - масштаб токена (1 = 1 клетка)
 * @param gridSize - размер клетки в пикселях
 * @param template - шаблон измерения
 * @returns true если центр токена попадает в область
 */
export function isTokenInTemplate(
  tokenX: number,
  tokenY: number,
  tokenScale: number,
  gridSize: number,
  template: MeasurementTemplate,
): boolean {
  const halfSize = (tokenScale * gridSize) / 2;

  return isPointInTemplate(
    tokenX + halfSize,
    tokenY + halfSize,
    gridSize,
    template,
  );
}

/**
 * Находит все токены, центры которых попадают в область шаблона.
 *
 * По правилам D&D 5e, AoE поражает **всех** в области, включая кастера и
 * скрытых от игроков. Метка `hidden` — про то, кому фишку показывать, а не про
 * то, есть ли существо на карте: засада, накрытая огненным шаром, урон
 * получает. Пока скрытые отсеивались здесь, мастер накрывал их площадью и
 * получал «в области никого нет».
 *
 * С вертикалью сцены шаблон — объём ({@link isPointInTemplateVolume}):
 * летун над кругом заклинания задет, только если до него достаёт сфера, а
 * фишка за перекрытием без проёма не задета вовсе.
 *
 * @param template - шаблон измерения (область заклинания)
 * @param tokens - массив токенов сцены
 * @param gridSize - размер клетки в пикселях
 * @param levels - вертикаль сцены; нет — по плану
 * @returns массив токенов, попавших в область
 */
export function findTokensInTemplate(
  template: MeasurementTemplate,
  tokens: readonly Token[],
  gridSize: number,
  levels?: TemplateLevelContext,
): Token[] {
  if (!levels) {
    return tokens.filter((token) =>
      isTokenInTemplate(token.x, token.y, token.scale, gridSize, template),
    );
  }

  const origin = resolveTemplateOrigin(levels.model, template);

  return tokens.filter((token) =>
    isTokenInTemplateVolume(token, template, gridSize, levels, origin),
  );
}

/** Вершина полигона зоны в мировых пикселях */
export interface TemplatePolygonPoint {
  x: number;
  y: number;
}

/**
 * Сколько вершин у круга зоны. Больше контур области не рисует (`ShapeGlow`
 * прореживает сверх 64), а меньше — многоугольник заметно отходит от круга.
 */
const TEMPLATE_CIRCLE_VERTEX_COUNT = 64;

/** Сколько отрезков у дуги конуса */
const TEMPLATE_CONE_ARC_SEGMENTS = 24;

/**
 * Запас наружу, пикселей. Проверка шаблона включает границу с допуском
 * (круг и конус +0.1, луч ±0.5), а попадание в полигон зоны — полуоткрытое:
 * центр клетки ровно на ребре без запаса выпадал бы из зоны, хотя был в
 * шаблоне. Полклетки до соседнего центра запас не достаёт.
 */
const TEMPLATE_POLYGON_PAD = 0.5;

/** Точка на расстоянии и под углом от начала */
function polarPoint(
  originX: number,
  originY: number,
  angle: number,
  radius: number,
): TemplatePolygonPoint {
  return {
    x: originX + Math.cos(angle) * radius,
    y: originY + Math.sin(angle) * radius,
  };
}

/**
 * Полигон зоны на месте шаблона заклинания: та же область, что накрывает
 * шаблон, но контуром, который ядро хранит у зоны сцены.
 *
 * Дуги описаны снаружи (круг, конус), рёбра вынесены на {@link
 * TEMPLATE_POLYGON_PAD}: всё, что шаблон считал внутри, остаётся внутри зоны.
 *
 * @param template - размещённый шаблон
 * @param gridSize - размер клетки в пикселях (ширина луча по умолчанию)
 * @returns вершины полигона либо `null` для вырожденного шаблона
 */
export function templateToPolygon(
  template: MeasurementTemplate,
  gridSize: number,
): TemplatePolygonPoint[] | null {
  const dx = template.targetX - template.originX;
  const dy = template.targetY - template.originY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Тот же порог, что у проверки шаблона: он не накрывает ничего
  if (distance < 1) {
    return null;
  }

  const { originX, originY } = template;
  const direction = Math.atan2(dy, dx);

  switch (template.type) {
    case 'circle':
    case 'cylinder': {
      const step = (2 * Math.PI) / TEMPLATE_CIRCLE_VERTEX_COUNT;
      const radius = (distance + TEMPLATE_POLYGON_PAD) / Math.cos(step / 2);

      return Array.from({ length: TEMPLATE_CIRCLE_VERTEX_COUNT }, (_, index) =>
        polarPoint(originX, originY, index * step, radius),
      );
    }
    case 'cone': {
      // Угол расширяется так, чтобы край на дальнем конце отошёл на запас
      const halfAngle =
        MEASUREMENT_CONE_HALF_ANGLE + TEMPLATE_POLYGON_PAD / distance;

      const step = (2 * halfAngle) / TEMPLATE_CONE_ARC_SEGMENTS;
      const radius = (distance + TEMPLATE_POLYGON_PAD) / Math.cos(step / 2);

      // Вершина отступает назад на запас: сама точка-источник тоже в зоне
      const apex = polarPoint(
        originX,
        originY,
        direction + Math.PI,
        TEMPLATE_POLYGON_PAD,
      );

      const arc = Array.from(
        { length: TEMPLATE_CONE_ARC_SEGMENTS + 1 },
        (_, index) =>
          polarPoint(
            originX,
            originY,
            direction - halfAngle + index * step,
            radius,
          ),
      );

      return [apex, ...arc];
    }
    case 'rect': {
      const minX = Math.min(originX, template.targetX) - TEMPLATE_POLYGON_PAD;
      const maxX = Math.max(originX, template.targetX) + TEMPLATE_POLYGON_PAD;
      const minY = Math.min(originY, template.targetY) - TEMPLATE_POLYGON_PAD;
      const maxY = Math.max(originY, template.targetY) + TEMPLATE_POLYGON_PAD;

      return [
        { x: minX, y: minY },
        { x: maxX, y: minY },
        { x: maxX, y: maxY },
        { x: minX, y: maxY },
      ];
    }
    case 'ray': {
      // Допуск проверки луча — 0.5 с каждой стороны; запас сверх него
      const margin = 2 * TEMPLATE_POLYGON_PAD;
      const halfWidth = (template.width ?? gridSize) / 2 + margin;
      const along = { x: Math.cos(direction), y: Math.sin(direction) };
      const across = { x: -along.y, y: along.x };
      const start = -margin;
      const end = distance + margin;

      const corner = (alongOffset: number, acrossOffset: number) => ({
        x: originX + along.x * alongOffset + across.x * acrossOffset,
        y: originY + along.y * alongOffset + across.y * acrossOffset,
      });

      return [
        corner(start, -halfWidth),
        corner(end, -halfWidth),
        corner(end, halfWidth),
        corner(start, halfWidth),
      ];
    }
    default:
      return null;
  }
}
