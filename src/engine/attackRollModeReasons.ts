/**
 * Откуда у броска атаки преимущество или помеха.
 *
 * Режим атаки ставится сам: от состояний, эффектов, аур, доспеха без владения
 * и дистанции. Окно броска показывало только итог — «Помеха», и игрок видел
 * помеху «без причины». Здесь каждый флаг режима сводится к названию того, кто
 * его поставил. Флаги берутся из того же списка, что и в расчёте режима
 * (`listAttackRollModeFlags`), — поэтому объяснение и бросок не расходятся.
 *
 * @module system/dnd/attackRollModeReasons
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { AttackFlagCategory, AttackRollModeKind } from './attackUtils.js';
import type {
  DndIncomingAttackContext,
  RollContext,
} from './effectPipeline.js';

import { describeEffectFlag } from './activeEffectDescribe.js';
import { isEffectDormant } from './activeEffectTypes.js';
import { listAttackRollModeFlags } from './attackUtils.js';
import {
  collectIncomingAttackFlags,
  collectRollConditionFlags,
  isRollOnlyEffect,
} from './effectPipeline.js';

/** Причины режима броска атаки: что дало преимущество и что помеху */
export interface AttackRollModeReasons {
  /** Источники преимущества */
  advantage: string[];
  /** Источники помехи */
  disadvantage: string[];
}

/** Что нужно, чтобы назвать причины режима атаки */
export interface AttackRollModeReasonParams {
  /** Вид атаки */
  attackType: AttackFlagCategory;
  /** Итоговые флаги атакующего — те же, что ушли в расчёт режима */
  attackerFlags: ReadonlySet<string>;
  /** Эффекты атакующего вместе с аурами */
  attackerEffects: readonly ActiveEffect[];
  /** Контекст броска — по нему решаются эффекты «только в бросках» */
  rollContext: RollContext;
  /** Итоговые флаги цели — те же, что ушли в расчёт режима */
  targetFlags: ReadonlySet<string>;
  /** Эффекты цели вместе с аурами; пусто — цели нет */
  targetEffects: readonly ActiveEffect[];
  /** Входящая атака глазами цели; нет — цели нет */
  incomingAttack?: DndIncomingAttackContext;
  /** Цель дальше нормальной дистанции оружия */
  isBeyondNormalRange: boolean;
}

/** Подписи причин, которые не являются эффектами */
const REASON_LABELS = {
  beyondNormalRange: 'дальше нормальной дистанции',
  armorWithoutProficiency: 'доспех без владения',
  targetSuffix: ' (у цели)',
} as const;

/**
 * Флаги, которые эффект атакующего ставит в этом броске. Эффект «только в
 * бросках» («Тактика стаи») даёт флаги, лишь если его условие выполнено.
 *
 * @param effect - эффект атакующего
 * @param rollContext - контекст броска
 * @returns флаги эффекта в этом броске
 */
function attackerEffectFlags(
  effect: ActiveEffect,
  rollContext: RollContext,
): readonly string[] {
  if (isRollOnlyEffect(effect)) {
    return collectRollConditionFlags([effect], rollContext);
  }

  return isEffectDormant(effect) ? [] : effect.flags;
}

/**
 * Флаги, которые эффект цели ставит против этой атаки. Защитный эффект с
 * условием («Защита от добра и зла») действует лишь против подходящей атаки.
 *
 * @param effect - эффект цели
 * @param incomingAttack - входящая атака
 * @returns флаги эффекта против этой атаки
 */
function targetEffectFlags(
  effect: ActiveEffect,
  incomingAttack: DndIncomingAttackContext | undefined,
): readonly string[] {
  if (isRollOnlyEffect(effect)) {
    return incomingAttack
      ? collectIncomingAttackFlags([effect], incomingAttack)
      : [];
  }

  return isEffectDormant(effect) ? [] : effect.flags;
}

/**
 * Названия эффектов, которые поставили флаг. Флаг есть, а эффекта нет — его
 * поставил движок сам, и причина берётся из запасной подписи.
 *
 * @param flag - флаг режима
 * @param effectFlags - эффекты и их флаги в этом броске
 * @param fallback - подпись, если ни один эффект флаг не ставит
 * @returns названия источников
 */
function namesForFlag(
  flag: string,
  effectFlags: ReadonlyArray<{ name: string; flags: readonly string[] }>,
  fallback: string,
): string[] {
  const names = effectFlags
    .filter((entry) => entry.flags.includes(flag))
    .map((entry) => entry.name);

  return names.length > 0 ? names : [fallback];
}

/**
 * Подпись флага атакующего, который не ставит ни один эффект. Общую помеху
 * атак без эффекта движок ставит только за доспех без владения.
 *
 * @param flag - флаг режима
 * @returns подпись причины
 */
function describeAttackerFlagWithoutEffect(flag: string): string {
  return flag === 'attack.disadvantage'
    ? REASON_LABELS.armorWithoutProficiency
    : describeEffectFlag(flag);
}

/**
 * Причины одной стороны режима: преимущества или помехи.
 *
 * @param kind - преимущество или помеха
 * @param params - флаги и эффекты сторон
 * @returns названия источников без повторов
 */
function listReasonsOfKind(
  kind: AttackRollModeKind,
  params: AttackRollModeReasonParams,
): string[] {
  const keys = listAttackRollModeFlags(kind, params.attackType);

  const attackerEntries = params.attackerEffects.map((effect) => ({
    name: effect.name,
    flags: attackerEffectFlags(effect, params.rollContext),
  }));

  const targetEntries = params.targetEffects.map((effect) => ({
    name: effect.name,
    flags: targetEffectFlags(effect, params.incomingAttack),
  }));

  const fromAttacker = keys.attacker
    .filter((flag) => params.attackerFlags.has(flag))
    .flatMap((flag) =>
      namesForFlag(
        flag,
        attackerEntries,
        describeAttackerFlagWithoutEffect(flag),
      ),
    );

  const fromTarget = keys.target
    .filter((flag) => params.targetFlags.has(flag))
    .flatMap((flag) =>
      namesForFlag(flag, targetEntries, describeEffectFlag(flag)),
    )
    .map((name) => `${name}${REASON_LABELS.targetSuffix}`);

  const fromRange =
    kind === 'disadvantage' && params.isBeyondNormalRange
      ? [REASON_LABELS.beyondNormalRange]
      : [];

  return [...new Set([...fromRange, ...fromAttacker, ...fromTarget])];
}

/**
 * Называет, откуда у броска атаки преимущество и помеха.
 *
 * @param params - флаги и эффекты атакующего и цели, дистанция
 * @returns источники преимущества и помехи; пусто — бросок обычный
 */
export function explainAttackRollMode(
  params: AttackRollModeReasonParams,
): AttackRollModeReasons {
  return {
    advantage: listReasonsOfKind('advantage', params),
    disadvantage: listReasonsOfKind('disadvantage', params),
  };
}

/** Подписи строк объяснения в окне броска */
const REASON_LINE_LABELS = {
  advantagePrefix: 'Преимущество: ',
  disadvantagePrefix: 'Помеха: ',
  cancelled: 'Преимущество и помеха гасят друг друга — бросок обычный',
} as const;

/**
 * Строки объяснения для окна броска: «Помеха: отравлен, доспех без владения».
 * Есть и то и другое — отдельная строка о том, что они гасятся.
 *
 * @param reasons - источники преимущества и помехи
 * @returns строки; пусто — объяснять нечего
 */
export function formatAttackRollModeReasons(
  reasons: AttackRollModeReasons,
): string[] {
  const lines = [
    reasons.advantage.length > 0
      ? `${REASON_LINE_LABELS.advantagePrefix}${reasons.advantage.join(', ')}`
      : '',
    reasons.disadvantage.length > 0
      ? `${REASON_LINE_LABELS.disadvantagePrefix}${reasons.disadvantage.join(', ')}`
      : '',
  ].filter((line) => line.length > 0);

  return lines.length > 1 ? [...lines, REASON_LINE_LABELS.cancelled] : lines;
}
