/**
 * Падение по правилам D&D 2024 (глоссарий PHB, «Падение»): 1к6 дробящего
 * урона за каждые 10 футов, не больше 20к6, и приземление ничком, если урон
 * получен. Падает ли фишка вообще, решает ядро (`settleTokenVertical`,
 * VTTG 0.9.780): оно спрашивает систему хуком `resolveUnsupported`, а итог —
 * высоту и признак падения — отдаёт в перемещении фишки
 * (`SystemTokenMovement.verticalDistance` / `fell`).
 *
 * «Падение пёрышком» (флаг {@link FEATHER_FALL_FLAG}) — без урона и на ноги:
 * скорость спуска 60 футов за раунд ядро не моделирует, существо опускается
 * сразу.
 *
 * @module system/dnd/falling
 */

import type {
  DistanceUnit,
  SystemUnsupportedContext,
  SystemUnsupportedDecision,
} from '@vtt/shared';

import type { EffectFlagKey } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { DEFAULT_DISTANCE_UNIT, DISTANCE_UNIT_SHORT } from '@vtt/shared';

import { hasEntityCondition } from './activeEffectTypes.js';
import { countSceneRangeSteps, RULES_DISTANCE_UNIT } from './attackUtils.js';
import { PRONE_CONDITION_KEY } from './conditionKeys.js';
import { buildConditionActiveEffect } from './conditionTemplates.js';
import {
  applyEffectsToEntity,
  applyTargetDamage,
} from './damageApplication.js';
import { resolveActorStats } from './effectPipeline.js';

/** Флаг «Падение пёрышком»: падение без урона и без «ничком» */
export const FEATHER_FALL_FLAG: EffectFlagKey = 'fall.featherFall';

/** Флаг «Парит»: сбитый с ног или без Скорости летун не падает */
export const HOVER_FLAG: EffectFlagKey = 'movement.hover';

/** Сколько футов падения на одну кость урона */
export const FALL_FEET_PER_DIE = 10;

/** Больше костей урона падение не даёт */
export const FALL_MAX_DICE = 20;

/** Кость урона от падения */
const FALL_DIE_SIDES = 6;

/** Тип урона от падения */
export const FALL_DAMAGE_TYPE = 'bludgeoning';

/** Подписи падения в чате */
const FALL_LABELS = {
  fell: (name: string, height: number, unit: DistanceUnit): string =>
    `${name} падает на ${height} ${DISTANCE_UNIT_SHORT[unit] ?? unit}`,
  damage: (formula: string, total: number): string =>
    `: ${formula} = ${total} дробящего урона`,
  prone: ', ничком',
  featherFall: ': «Падение пёрышком» — без урона, на ноги',
  noDamage: ': без урона',
} as const;

/**
 * Число костей урона за падение: 1к6 за каждые полные 10 футов, не больше
 * 20к6. Высота — в единицах сцены: на сцене в метрах 10 футов — 3 м
 * (`countSceneRangeSteps`).
 *
 * @param fallHeight - высота падения, единицы сцены
 * @param sceneUnit - единица сцены; нет — футы
 * @returns кости урона; меньше 10 футов — 0
 */
export function resolveFallDiceCount(
  fallHeight: number,
  sceneUnit: DistanceUnit = DEFAULT_DISTANCE_UNIT,
): number {
  return Math.min(
    FALL_MAX_DICE,
    countSceneRangeSteps(fallHeight, FALL_FEET_PER_DIE, sceneUnit),
  );
}

/**
 * Формула урона от падения в записи системы (`3к6`).
 *
 * @param fallHeight - высота падения, единицы сцены
 * @param sceneUnit - единица сцены; нет — футы
 * @returns формула либо `null` — падение без урона
 */
export function resolveFallDamageFormula(
  fallHeight: number,
  sceneUnit: DistanceUnit = DEFAULT_DISTANCE_UNIT,
): string | null {
  const dice = resolveFallDiceCount(fallHeight, sceneUnit);

  return dice > 0 ? `${dice}к${FALL_DIE_SIDES}` : null;
}

/**
 * Действует ли на сущность флаг эффекта (с учётом всех её эффектов).
 *
 * @param entity - сущность
 * @param flag - флаг
 * @returns true, если флаг поднят
 */
function hasActiveFlag(entity: DnDSceneEntity, flag: EffectFlagKey): boolean {
  return resolveActorStats(entity).activeFlags.has(flag);
}

/**
 * Решение системы о фишке без опоры (хук ядра `resolveUnsupported`): падает.
 * «Падение пёрышком» тоже падение — только без урона; держит в воздухе
 * включённый вид перемещения (`aloft`), а его ядро проверяет само до вызова.
 *
 * @param entity - сущность
 * @param context - что ядро знает о фишке
 * @returns решение
 */
export function resolveDndUnsupported(
  entity: DnDSceneEntity,
  context: SystemUnsupportedContext,
): SystemUnsupportedDecision {
  // Ниже нуля падать некуда: ядро отвечает нижним этажом, решение то же
  return context.fallHeight > 0 ? 'fall' : 'stay';
}

/** Итог падения сущности */
export interface FallOutcome {
  /** Строка для чата */
  summary: string;
  /** Урон после защит; без урона — 0 */
  damage: number;
  /** Легла ничком */
  prone: boolean;
}

/** Чем бросать формулу урона */
export type FallDamageRoller = (formula: string) => { total: number };

/**
 * Падение сущности: урон 1к6 за 10 футов (не больше 20к6) с защитами цели и
 * «ничком», если урон получен (PHB 2024). «Падение пёрышком» — без урона и на
 * ноги. Мутирует хиты и `activeEffects` сущности.
 *
 * @param entity - упавшая сущность
 * @param fallHeight - высота падения, единицы сцены
 * @param rollFormula - бросок формулы урона
 * @param sceneUnit - единица сцены; нет — футы
 * @returns итог для чата
 */
export function applyFallToEntity(
  entity: DnDSceneEntity,
  fallHeight: number,
  rollFormula: FallDamageRoller,
  sceneUnit: DistanceUnit = DEFAULT_DISTANCE_UNIT,
): FallOutcome {
  // Футы — целыми, как раньше; метры — до десятых: 4,5 м, а не 5
  const height =
    sceneUnit === RULES_DISTANCE_UNIT
      ? Math.round(fallHeight)
      : Math.round(fallHeight * 10) / 10;

  const head = FALL_LABELS.fell(entity.name, height, sceneUnit);

  if (hasActiveFlag(entity, FEATHER_FALL_FLAG)) {
    return {
      summary: `${head}${FALL_LABELS.featherFall}`,
      damage: 0,
      prone: false,
    };
  }

  const formula = resolveFallDamageFormula(fallHeight, sceneUnit);

  if (!formula) {
    return {
      summary: `${head}${FALL_LABELS.noDamage}`,
      damage: 0,
      prone: false,
    };
  }

  const rolled = rollFormula(formula);

  const applied = applyTargetDamage(
    entity,
    rolled.total,
    false,
    FALL_DAMAGE_TYPE,
  );

  const damage = applied.damageDealt ?? 0;
  const prone = damage > 0 && layProne(entity);

  return {
    summary: `${head}${FALL_LABELS.damage(formula, damage)}${prone ? FALL_LABELS.prone : ''}`,
    damage,
    prone,
  };
}

/**
 * Кладёт сущность ничком (иммунитет к состоянию соблюдается).
 *
 * @param entity - сущность (мутируется)
 * @returns true, если теперь лежит
 */
function layProne(entity: DnDSceneEntity): boolean {
  if (hasEntityCondition(entity, PRONE_CONDITION_KEY)) {
    return true;
  }

  const prone = buildConditionActiveEffect(PRONE_CONDITION_KEY);

  if (!prone) {
    return false;
  }

  entity.activeEffects = applyEffectsToEntity(entity, [prone], 'condition');

  return hasEntityCondition(entity, PRONE_CONDITION_KEY);
}
