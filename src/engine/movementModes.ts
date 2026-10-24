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
 * Препятствия (VTTG 0.9.756+): стену с высотой не выше четверти длины прыжка
 * ядро пропускает, выше — режет («вы врезаетесь в препятствие»); стену во всю
 * высоту не перепрыгнуть. Зону-провал (`terrain.impassable`) пешком не пройти,
 * но перепрыгнуть можно. Броски остаются за мастером: Сила (Атлетика) Сл 10
 * через низкое препятствие — по его решению, Ловкость (Акробатика) Сл 10 при
 * приземлении в труднопроходимую местность.
 *
 * Своя цена прыжка (`jump.cost`, заклинание «Прыжок») — участок с `cost`:
 * ядро списывает с хода цену, а не длину. Прыжок в высоту поднимает фишку
 * (`vertical.maxRise`, VTTG 0.9.780): приземление — общим падением ядра.
 *
 * Этажи (VTTG 0.9.780): полёт, левитация, плавание, лазание и копание — виды,
 * которые можно включить СОСТОЯНИЕМ фишки (`persistent`), со своей Скоростью и
 * правом менять высоту (`vertical`):
 * - полёт — Скорость полёта, по прямой над низкими стенами; держит в воздухе
 *   (`aloft`), пока летун не сбит с ног и Скорость не 0 — тогда он падает,
 *   если не парит (PHB 2024, «Скорость полёта»);
 * - левитация (флаг `movement.levitate`) — только вверх и вниз, до 20 футов за
 *   перемещение, по плану не двигает;
 * - плавание и лазание — своей Скоростью, без неё фут стоит два; лазающий
 *   держится за стену;
 * - копание — только со Скоростью копания, в том числе ниже пола.
 * Лестница-пандус — обычная местность (в PHB 2024 ступени не труднопроходимы),
 * приставная лестница и стена — лазание.
 *
 * @module system/dnd/movementModes
 */

import type { MovementBand, MovementMode, MovementModes } from '@vtt/shared';

import type { EffectFlagKey, ResolvedActorStats } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isTurnMovementSpent } from './actionRestrictions.js';
import { hasEntityCondition } from './activeEffectTypes.js';
import { PRONE_CONDITION_KEY } from './conditionKeys.js';
import { JUMP_OBSTACLE_RATIO, JUMP_RUN_UP_FEET } from './consts.js';
import { HOVER_FLAG } from './falling.js';

/** Id вида «Ходьба» — вид обычного перетаскивания фишки */
export const WALK_MOVEMENT_MODE_ID = 'walk';

/** Id вида «Прыжок» — его включает кнопка полки действий */
export const JUMP_MOVEMENT_MODE_ID = 'jump';

/** Id вида «Полёт» */
export const FLY_MOVEMENT_MODE_ID = 'fly';

/** Id вида «Левитация» */
export const LEVITATE_MOVEMENT_MODE_ID = 'levitate';

/** Id вида «Плавание» */
export const SWIM_MOVEMENT_MODE_ID = 'swim';

/** Id вида «Лазание» */
export const CLIMB_MOVEMENT_MODE_ID = 'climb';

/** Id вида «Копание» */
export const BURROW_MOVEMENT_MODE_ID = 'burrow';

/** Флаг «Левитация»: держится в воздухе, движется только вверх и вниз */
export const LEVITATE_FLAG: EffectFlagKey = 'movement.levitate';

/** На сколько футов за перемещение левитация поднимает или опускает (PHB 2024) */
export const LEVITATE_VERTICAL_FEET = 20;

/**
 * Во сколько раз дороже фут плавания и лазания без своей Скорости (PHB 2024:
 * каждый фут стоит один лишний)
 */
const UNTRAINED_MOVE_COST = 2;

/** Подписи видов и участков — их ядро пишет у курсора */
const MOVEMENT_MODE_LABELS = {
  walk: 'Ходьба',
  dash: 'Рывок',
  walkBeyond: 'не дойти за ход',
  fly: 'Полёт',
  flyBeyond: 'не долететь за ход',
  levitate: 'Левитация',
  levitateOnly: 'Только вверх и вниз',
  levitateHint: `Вверх или вниз до ${LEVITATE_VERTICAL_FEET} фт`,
  swim: 'Плавание',
  climb: 'Лазание',
  burrow: 'Копание',
  slowBeyond: 'не добраться за ход',
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
  /**
   * Своя цена прыжка в длину в футах хода (заклинание «Прыжок»); нет — фут
   * за фут
   */
  fixedCost?: number;
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
 * Своя цена прыжка (заклинание «Прыжок»: до 30 фт за 10 фт хода) меняет
 * расчёт длины: разбег не нужен, а ход тратит цена, а не длина — прыжок в
 * длину весь, если на цену хватает Скорости, иначе его нет.
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

  const high = {
    standingHigh: Math.min(Math.floor(stats.jump.high / 2), ownSpeed),
    runningHigh: capRunningJump(stats.jump.high, ownSpeed),
  };

  const fixedCost = stats.jump.cost;

  if (fixedCost !== undefined) {
    const long = fixedCost <= ownSpeed ? stats.jump.long : 0;

    return { standingLong: long, runningLong: long, ...high, fixedCost };
  }

  return {
    standingLong: Math.min(Math.floor(stats.jump.long / 2), ownSpeed),
    runningLong: capRunningJump(stats.jump.long, ownSpeed),
    ...high,
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
  // Своя цена — один участок без разбега: ядро (VTTG 0.9.756+) спишет с хода
  // цену, а не длину
  if (jump.fixedCost !== undefined) {
    return jump.standingLong > 0
      ? [
          {
            id: 'fixed-cost',
            label: MOVEMENT_MODE_LABELS.jump,
            upTo: jump.standingLong,
            tone: 'success',
            cost: jump.fixedCost,
          },
        ]
      : [];
  }

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
 * Участки хода своей Скоростью: до Скорости обычным шагом, до двух —
 * «Рывком». Нет хода — пусто.
 *
 * @param speed - Скорость вида
 * @returns участки
 */
function buildSpeedBands(speed: number): MovementBand[] {
  return speed > 0
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
}

/** Что, кроме Скорости ходьбы и прыжка, решает виды перемещения сущности */
export interface MovementModesState {
  /** Скорости по видам с эффектами (`speed.zero` их уже обнулил) */
  movement: ResolvedActorStats['movement'];
  /** Ход за этот ход уже отдан («одно из трёх») */
  movementSpent: boolean;
  /** Парит: сбитый с ног или без Скорости летун не падает */
  hover: boolean;
  /** Под левитацией */
  levitating: boolean;
  /** Лежит ничком */
  prone: boolean;
}

/**
 * Что решает виды перемещения сущности: скорости, парение, левитация и
 * «ничком».
 *
 * @param entity - сущность
 * @param stats - её разрешённые статы
 * @returns состояние для видов
 */
export function resolveMovementModesState(
  entity: DnDSceneEntity,
  stats: Pick<ResolvedActorStats, 'movement' | 'activeFlags'>,
): MovementModesState {
  return {
    movement: stats.movement,
    movementSpent: isTurnMovementSpent(entity, stats.activeFlags),
    hover:
      entity.system.movement?.hover === true
      || stats.activeFlags.has(HOVER_FLAG),
    levitating: stats.activeFlags.has(LEVITATE_FLAG),
    prone: hasEntityCondition(entity, PRONE_CONDITION_KEY),
  };
}

/**
 * Скорость вида без своей Скорости: ходьба, где каждый фут стоит два.
 *
 * @param own - своя Скорость вида
 * @param walk - Скорость ходьбы
 * @returns Скорость вида
 */
function resolveUntrainedSpeed(own: number, walk: number): number {
  return own > 0 ? own : Math.floor(walk / UNTRAINED_MOVE_COST);
}

/**
 * Виды перемещения, которые меняют высоту: полёт, левитация, плавание,
 * лазание, копание. Каждый — своей Скоростью; вид, которого у сущности нет
 * (полёт без Скорости полёта), не предлагается.
 *
 * @param state - скорости и состояние сущности
 * @returns виды по порядку
 */
export function buildVerticalMovementModes(
  state: MovementModesState,
): MovementMode[] {
  const { movement } = state;
  const turn = (speed: number): number => (state.movementSpent ? 0 : speed);
  const modes: MovementMode[] = [];

  if (movement.fly > 0 || state.hover) {
    modes.push({
      id: FLY_MOVEMENT_MODE_ID,
      label: MOVEMENT_MODE_LABELS.fly,
      measure: 'straight',
      bands: buildSpeedBands(turn(movement.fly)),
      beyondLabel: MOVEMENT_MODE_LABELS.flyBeyond,
      persistent: true,
      // Сбитый с ног или без Скорости летун падает, если не парит
      aloft: state.hover || (!state.prone && movement.fly > 0),
      vertical: { allowed: true },
      // Над низкой стеной летун пролетает; стену во всю высоту — нет
      clearance: {},
    });
  }

  if (state.levitating) {
    modes.push({
      id: LEVITATE_MOVEMENT_MODE_ID,
      label: MOVEMENT_MODE_LABELS.levitate,
      measure: 'straight',
      bands: [
        {
          id: 'levitate',
          label: MOVEMENT_MODE_LABELS.levitateOnly,
          upTo: 0,
          tone: 'success',
        },
      ],
      beyondLabel: MOVEMENT_MODE_LABELS.levitateOnly,
      hint: MOVEMENT_MODE_LABELS.levitateHint,
      persistent: true,
      aloft: true,
      vertical: {
        allowed: true,
        maxRise: LEVITATE_VERTICAL_FEET,
        maxDrop: LEVITATE_VERTICAL_FEET,
      },
    });
  }

  modes.push(
    {
      id: SWIM_MOVEMENT_MODE_ID,
      label: MOVEMENT_MODE_LABELS.swim,
      measure: 'path',
      bands: buildSpeedBands(
        turn(resolveUntrainedSpeed(movement.swim, movement.walk)),
      ),
      beyondLabel: MOVEMENT_MODE_LABELS.slowBeyond,
      persistent: true,
      vertical: { allowed: true },
    },
    {
      id: CLIMB_MOVEMENT_MODE_ID,
      label: MOVEMENT_MODE_LABELS.climb,
      measure: 'path',
      bands: buildSpeedBands(
        turn(resolveUntrainedSpeed(movement.climb, movement.walk)),
      ),
      beyondLabel: MOVEMENT_MODE_LABELS.slowBeyond,
      persistent: true,
      // Лазающий держится за стену: с неё он не падает, пока не отпустит
      aloft: !state.prone,
      vertical: { allowed: true },
    },
  );

  if (movement.burrow > 0) {
    modes.push({
      id: BURROW_MOVEMENT_MODE_ID,
      label: MOVEMENT_MODE_LABELS.burrow,
      measure: 'path',
      bands: buildSpeedBands(turn(movement.burrow)),
      beyondLabel: MOVEMENT_MODE_LABELS.slowBeyond,
      persistent: true,
      vertical: { allowed: true },
    });
  }

  return modes;
}

/**
 * Виды перемещения сущности для ядра.
 *
 * Ходьба — по маршруту: до Скорости обычным шагом, до двух Скоростей —
 * «Рывком» (прибавка, равная Скорости). Прыжок — по прямой, участки с места и
 * с разбегом, вверх — на высоту прыжка. Нет хода — у обоих видов пустые
 * участки: ядро зону не рисует, а режим прыжка не включается. Дальше — виды
 * со сменой высоты ({@link buildVerticalMovementModes}).
 *
 * @param speed - Скорость, которой сущность перемещается
 * @param jump - дальности прыжка
 * @param state - скорости и состояние сущности; нет — только ходьба и прыжок
 * @returns виды перемещения; вид по умолчанию — ходьба
 */
export function buildMovementModes(
  speed: number,
  jump: JumpDistances,
  state?: MovementModesState,
): MovementModes {
  const walkBands = buildSpeedBands(speed);
  const hint = describeHighJump(jump);
  const highJump = Math.max(jump.standingHigh, jump.runningHigh);

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
        // Низкое препятствие (VTTG 0.9.756+, стена с высотой) не выше четверти
        // длины прыжка перелетается; выше — «вы врезаетесь», поэтому без оговорки
        clearance: { ratio: JUMP_OBSTACLE_RATIO },
        // Прыжок в высоту поднимает фишку (VTTG 0.9.780); вниз — общим падением
        ...(highJump > 0
          ? { vertical: { allowed: true, maxRise: highJump } }
          : {}),
      },
      ...(state ? buildVerticalMovementModes(state) : []),
    ],
  };
}
