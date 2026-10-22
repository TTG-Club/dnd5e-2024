/**
 * Виды перемещения D&D 2024 для ядра (`VttSystem.getMovementModes`, VTTG
 * 0.9.751+): ходьба с «Рывком» и прыжок в длину.
 *
 * Ядро только меряет, красит и подписывает — числа и слова отсюда. Правила
 * прыжка (глоссарий PHB 2024, «Прыжок в длину» / «Прыжок в высоту»):
 * - в длину с разбегом — на значение Силы, с места — вдвое меньше;
 * - в высоту с разбегом — на 3 + модификатор Силы, с места — вдвое меньше;
 * - разбег — не меньше 10 футов перемещения прямо перед прыжком;
 * - каждый фут прыжка тратит фут перемещения.
 *
 * Поэтому прыжок с места не длиннее Скорости, а с разбегом — не длиннее того,
 * что от Скорости остаётся после разбега. Сколько хода уже потрачено за ход,
 * ни ядро, ни система не ведут — предел считается от полной Скорости.
 *
 * С VTTG 0.9.754 прыжок идёт с подходом: если с места не допрыгнуть, ядро
 * ведёт фишку ходьбой до клетки отрыва и прыгает оттуда. Разбег — участок с
 * `minApproach` 10 фт, весь путь с прыжком — `totalLimit` (Скорость). Старое
 * ядро эти поля не читает и показывает прыжок от клетки фишки.
 *
 * Проверки при прыжке (Сила (Атлетика) Сл 10 через препятствие выше четверти
 * прыжка, Ловкость (Акробатика) Сл 10 при приземлении в труднопроходимую
 * местность) остаются за мастером: сцена не знает высоты препятствий.
 *
 * @module system/dnd/movementModes
 */

import type { MovementBand, MovementModes } from '@vtt/shared';

import type { ResolvedActorStats } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isTurnMovementSpent } from './actionRestrictions.js';
import { JUMP_RUN_UP_FEET } from './consts.js';

/** Id вида «Ходьба» — вид обычного перетаскивания фишки */
export const WALK_MOVEMENT_MODE_ID = 'walk';

/** Id вида «Прыжок» — его включает кнопка полки действий */
export const JUMP_MOVEMENT_MODE_ID = 'jump';

/** Подписи видов и участков — их ядро пишет у курсора */
const MOVEMENT_MODE_LABELS = {
  walk: 'Ходьба',
  dash: 'Рывок',
  walkBeyond: 'не дойти за ход',
  jump: 'Прыжок',
  standingJump: 'Прыжок с места',
  runningJump: 'Прыжок с разбегом',
  jumpBeyond: 'Не допрыгнуть',
  highJump: (standing: number, running: number): string =>
    `В высоту: ${standing} фт с места, ${running} фт с разбегом`,
  highStandingJump: (standing: number): string => `В высоту: ${standing} фт`,
} as const;

/** Дальность прыжка с учётом Скорости, в футах */
export interface JumpDistances {
  /** В длину с места */
  standingLong: number;
  /** В длину с разбегом; `0` — на разбег Скорости не хватает */
  runningLong: number;
  /** В высоту с места */
  standingHigh: number;
  /** В высоту с разбегом; `0` — на разбег Скорости не хватает */
  runningHigh: number;
}

/**
 * Скорость, которой сущность перемещается в этот ход.
 *
 * По правилам D&D 2024 Скорость — это Скорость ходьбы. Существо, которое
 * ходить не умеет (парящее, плавающее, роющее), перемещается своим режимом,
 * поэтому при нулевой ходьбе берётся самый быстрый из остальных: иначе у
 * дракона в полёте зона хода схлопнулась бы в точку. Ход, потраченный на
 * действие под «одним из трёх», даёт ноль.
 *
 * @param entity - сущность
 * @param stats - её разрешённые статы
 * @returns Скорость в футах; `0` — перемещаться нельзя
 */
export function resolveTurnSpeed(
  entity: DnDSceneEntity,
  stats: Pick<ResolvedActorStats, 'movement' | 'activeFlags'>,
): number {
  if (isTurnMovementSpent(entity, stats.activeFlags)) {
    return 0;
  }

  const { movement } = stats;

  return Math.max(
    0,
    movement.walk
      || Math.max(
        movement.fly || 0,
        movement.swim || 0,
        movement.climb || 0,
        movement.burrow || 0,
      ),
  );
}

/**
 * Прыжок с разбегом: сам прыжок не длиннее хода, оставшегося после разбега.
 *
 * @param distance - дальность прыжка с разбегом по правилу Силы
 * @param speed - Скорость сущности
 * @returns дальность с разбегом либо `0`, если на разбег хода нет
 */
function capRunningJump(distance: number, speed: number): number {
  const leftAfterRunUp = speed - JUMP_RUN_UP_FEET;

  return leftAfterRunUp > 0 ? Math.min(distance, leftAfterRunUp) : 0;
}

/**
 * Дальность прыжка сущности: правило Силы с поправками эффектов
 * (`stats.jump`), урезанное Скоростью — фут прыжка стоит фут хода.
 *
 * @param stats - разрешённые статы сущности
 * @param speed - Скорость, которой сущность перемещается
 * @returns дальности в длину и в высоту, с места и с разбегом
 */
export function resolveJumpDistances(
  stats: Pick<ResolvedActorStats, 'jump'>,
  speed: number,
): JumpDistances {
  const ownSpeed = Math.max(0, speed);

  return {
    standingLong: Math.min(Math.floor(stats.jump.long / 2), ownSpeed),
    runningLong: capRunningJump(stats.jump.long, ownSpeed),
    standingHigh: Math.min(Math.floor(stats.jump.high / 2), ownSpeed),
    runningHigh: capRunningJump(stats.jump.high, ownSpeed),
  };
}

/**
 * Участки прыжка в длину: с места, дальше — с разбегом. Разбег, который не
 * даёт прыгнуть дальше, чем с места, участка не заводит.
 *
 * @param jump - дальности прыжка
 * @returns участки по возрастанию дальности
 */
function buildJumpBands(jump: JumpDistances): MovementBand[] {
  const bands: MovementBand[] = [];

  if (jump.standingLong > 0) {
    bands.push({
      id: 'standing',
      label: MOVEMENT_MODE_LABELS.standingJump,
      upTo: jump.standingLong,
      tone: 'success',
    });
  }

  if (jump.runningLong > jump.standingLong) {
    bands.push({
      id: 'running',
      label: MOVEMENT_MODE_LABELS.runningJump,
      upTo: jump.runningLong,
      tone: 'warning',
      // Разбег — подход ядра (VTTG 0.9.754+): пройдя 10 фт, фишка прыгает дальше
      minApproach: JUMP_RUN_UP_FEET,
    });
  }

  return bands;
}

/**
 * Вторая строка подписи у курсора: высота прыжка. На плоской сцене её не
 * нарисовать, поэтому она идёт текстом.
 *
 * @param jump - дальности прыжка
 * @returns подпись либо `undefined`, если вверх не прыгнуть
 */
function describeHighJump(jump: JumpDistances): string | undefined {
  if (jump.runningHigh > jump.standingHigh) {
    return MOVEMENT_MODE_LABELS.highJump(jump.standingHigh, jump.runningHigh);
  }

  return jump.standingHigh > 0
    ? MOVEMENT_MODE_LABELS.highStandingJump(jump.standingHigh)
    : undefined;
}

/**
 * Виды перемещения сущности для ядра.
 *
 * Ходьба — по маршруту: до Скорости обычным шагом, до двух Скоростей —
 * «Рывком» (прибавка, равная Скорости). Прыжок — по прямой, участки с места и
 * с разбегом. Нет хода — у обоих видов пустые участки: ядро зону не рисует, а
 * режим прыжка не включается.
 *
 * @param speed - Скорость, которой сущность перемещается
 * @param jump - дальности прыжка
 * @returns виды перемещения; вид по умолчанию — ходьба
 */
export function buildMovementModes(
  speed: number,
  jump: JumpDistances,
): MovementModes {
  const walkBands: MovementBand[] =
    speed > 0
      ? [
          { id: 'walk', label: '', upTo: speed, tone: 'success' },
          {
            id: 'dash',
            label: MOVEMENT_MODE_LABELS.dash,
            upTo: speed * 2,
            tone: 'error',
          },
        ]
      : [];

  const hint = describeHighJump(jump);

  return {
    defaultModeId: WALK_MOVEMENT_MODE_ID,
    modes: [
      {
        id: WALK_MOVEMENT_MODE_ID,
        label: MOVEMENT_MODE_LABELS.walk,
        measure: 'path',
        bands: walkBands,
        beyondLabel: MOVEMENT_MODE_LABELS.walkBeyond,
      },
      {
        id: JUMP_MOVEMENT_MODE_ID,
        label: MOVEMENT_MODE_LABELS.jump,
        measure: 'straight',
        bands: speed > 0 ? buildJumpBands(jump) : [],
        beyondLabel: MOVEMENT_MODE_LABELS.jumpBeyond,
        ...(hint ? { hint } : {}),
        // Не допрыгнуть с места — ядро ведёт ходьбой до клетки отрыва; фут
        // прыжка стоит фут хода, поэтому подход и прыжок вместе — не больше Скорости
        approach: { modeId: WALK_MOVEMENT_MODE_ID },
        totalLimit: speed,
      },
    ],
  };
}
