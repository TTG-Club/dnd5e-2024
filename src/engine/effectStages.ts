/**
 * Ступени эффекта: «проклятие переходит на следующую ступень».
 *
 * Правила с нарастающей бедой описывают ступени словами, а переводит на
 * следующую — человек (мастер или тот, кто наложил). Конвейер листа о
 * ступенях не знает вовсе: перевод ПЕРЕПИСЫВАЕТ `changes` и `flags` самого
 * эффекта из ступени. Так ступени не стоят ни одной новой ветки в расчёте
 * статов — и старые эффекты без ступеней работают ровно как прежде.
 *
 * @module system/dnd/effectStages
 */

import type { ActiveEffect, EffectStage } from './activeEffectTypes.js';

/** Первая ступень — у эффекта без поля `stageIndex` */
export const FIRST_EFFECT_STAGE_INDEX = 0;

/**
 * Есть ли у эффекта ступени.
 *
 * @param effect - эффект
 * @returns `true`, если ступени заведены
 */
export function hasEffectStages(effect: Pick<ActiveEffect, 'stages'>): boolean {
  return (effect.stages?.length ?? 0) > 0;
}

/**
 * Номер действующей ступени, приведённый к списку.
 *
 * @param effect - эффект
 * @returns номер ступени; 0, если ступеней нет
 */
export function resolveEffectStageIndex(
  effect: Pick<ActiveEffect, 'stages' | 'stageIndex'>,
): number {
  const total = effect.stages?.length ?? 0;

  if (total === 0) {
    return FIRST_EFFECT_STAGE_INDEX;
  }

  const index = effect.stageIndex ?? FIRST_EFFECT_STAGE_INDEX;

  return Math.min(Math.max(index, FIRST_EFFECT_STAGE_INDEX), total - 1);
}

/**
 * Действующая ступень эффекта.
 *
 * @param effect - эффект
 * @returns ступень либо `null`, если ступеней нет
 */
export function resolveEffectStage(
  effect: Pick<ActiveEffect, 'stages' | 'stageIndex'>,
): EffectStage | null {
  return effect.stages?.[resolveEffectStageIndex(effect)] ?? null;
}

/**
 * Есть ли куда переводить: действующая ступень не последняя.
 *
 * @param effect - эффект
 * @returns `true`, если следующая ступень есть
 */
export function canAdvanceEffectStage(
  effect: Pick<ActiveEffect, 'stages' | 'stageIndex' | 'disabled'>,
): boolean {
  const total = effect.stages?.length ?? 0;

  return (
    total > 0 && !effect.disabled && resolveEffectStageIndex(effect) < total - 1
  );
}

/**
 * Эффект на ступени: номер и её `changes` и `flags`. Копии списков — ступень
 * остаётся в эффекте, и правка строк не должна задеть её.
 *
 * @param effect - эффект
 * @param index - номер ступени
 * @param stage - ступень
 * @returns копия эффекта на ступени
 */
function withEffectStage(
  effect: ActiveEffect,
  index: number,
  stage: EffectStage,
): ActiveEffect {
  return {
    ...effect,
    stageIndex: index,
    changes: [...stage.changes],
    flags: [...stage.flags],
  };
}

/**
 * Переводит эффект на следующую ступень: номер растёт, а `changes` и `flags`
 * берутся из неё.
 *
 * Эффект не меняется на месте: он может быть чужим (снимок ядра, эффект
 * ауры), а хозяйские объекты система не правит.
 *
 * @param effect - эффект
 * @returns копия на следующей ступени либо `null`, если переводить некуда
 */
export function advanceEffectStage(effect: ActiveEffect): ActiveEffect | null {
  if (!canAdvanceEffectStage(effect)) {
    return null;
  }

  const nextIndex = resolveEffectStageIndex(effect) + 1;
  const stage = effect.stages?.[nextIndex];

  return stage ? withEffectStage(effect, nextIndex, stage) : null;
}

/**
 * Приводит эффект к его действующей ступени: нужен сразу после наложения,
 * чтобы первая ступень действовала, а не лежала списком без дела.
 *
 * @param effect - эффект
 * @returns эффект со значениями ступени либо он сам, если ступеней нет
 */
export function applyEffectStage(effect: ActiveEffect): ActiveEffect {
  const stage = resolveEffectStage(effect);

  return stage
    ? withEffectStage(effect, resolveEffectStageIndex(effect), stage)
    : effect;
}

/**
 * Подпись действующей ступени для листа: «Ступень 2 из 3 — …».
 *
 * @param effect - эффект
 * @returns подпись либо `null`, если ступеней нет
 */
export function formatEffectStageLabel(effect: ActiveEffect): string | null {
  const stage = resolveEffectStage(effect);

  if (!stage) {
    return null;
  }

  const index = resolveEffectStageIndex(effect) + 1;
  const total = effect.stages?.length ?? 0;

  return `Ступень ${index} из ${total} — ${stage.label}`;
}
