/**
 * Разница эффектов в боевом снимке: что клиент добавил, изменил и снял, — а не
 * список целиком.
 *
 * Клиент считает новый список эффектов от своей копии сущности. Между копией и
 * записью сервер мог список уже изменить: конец прежнего каста снял эффекты с
 * цели, или на заклинателе легла метка концентрации. Полный список из копии
 * вернул бы снятое и стёр легшее. Разница сливается со списком СЕРВЕРА:
 * снятое сервером не воскресает, легшее на сервере остаётся.
 *
 * Модуль без правил: основу пишут хуки системы и клиентский помощник записи,
 * снимок (`damageApplication.ts`) её читает, сервер сливает.
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { z } from 'zod';

import {
  ActiveEffectsArraySchema,
  MAX_EFFECTS_PER_ACTOR,
} from './activeEffectTypes.js';
import { mergeAppliedEffects } from './effectAutomation.js';

/** Сколько снятых эффектов принимает один снимок — не больше, чем их бывает */
const MAX_REMOVED_EFFECT_IDS = MAX_EFFECTS_PER_ACTOR;

/** Предел длины id снятого эффекта */
const MAX_EFFECT_ID_LENGTH = 256;

/** Изменения списка эффектов относительно копии, от которой их считал клиент */
export interface EffectChanges {
  /** Эффекты, которых в основе не было */
  add: ActiveEffect[];
  /** Эффекты основы, чьё содержимое изменилось */
  update: ActiveEffect[];
  /** Id эффектов основы, которых в итоге нет */
  removeIds: string[];
}

/** Zod-схема разницы эффектов из боевого снимка клиента */
export const EffectChangesSchema = z.object({
  add: ActiveEffectsArraySchema,
  update: ActiveEffectsArraySchema,
  removeIds: z
    .array(z.string().min(1).max(MAX_EFFECT_ID_LENGTH))
    .max(MAX_REMOVED_EFFECT_IDS),
});

/**
 * Основа копии: список эффектов, от которого клиент считал новый. Ключ — сама
 * копия: клиент клонирует сущность на каждую запись, и основа живёт ровно
 * столько, сколько копия.
 */
const recordedBaselines = new WeakMap<DnDSceneEntity, ActiveEffect[]>();

/**
 * Запоминает, от какого списка эффектов клиент считает новый список копии.
 * Первая запись побеждает: копия могла пройти несколько правок (урон, затем
 * эффекты), а основа — то, что было до первой.
 *
 * @param entityCopy - копия сущности, которая уйдёт боевым снимком
 * @param baseEffects - эффекты сущности до правки
 */
export function recordEffectsBaseline(
  entityCopy: DnDSceneEntity,
  baseEffects: readonly ActiveEffect[],
): void {
  if (recordedBaselines.has(entityCopy)) {
    return;
  }

  recordedBaselines.set(entityCopy, [...baseEffects]);
}

/**
 * Основа копии, если её записали.
 *
 * @param entityCopy - копия сущности
 * @returns эффекты до правки; нет записи — `undefined`
 */
export function readEffectsBaseline(
  entityCopy: DnDSceneEntity,
): readonly ActiveEffect[] | undefined {
  return recordedBaselines.get(entityCopy);
}

/**
 * Разница двух списков эффектов по id.
 *
 * @param base - список, от которого считали
 * @param next - посчитанный список
 * @returns добавленные, изменённые и снятые
 */
export function diffEffects(
  base: readonly ActiveEffect[],
  next: readonly ActiveEffect[],
): EffectChanges {
  const baseById = new Map(base.map((effect) => [effect.id, effect]));
  const nextIds = new Set(next.map((effect) => effect.id));

  const add = next.filter((effect) => !baseById.has(effect.id));

  const update = next.filter((effect) => {
    const before = baseById.get(effect.id);

    return (
      before !== undefined && JSON.stringify(before) !== JSON.stringify(effect)
    );
  });

  const removeIds = base
    .map((effect) => effect.id)
    .filter((effectId) => !nextIds.has(effectId));

  return { add, update, removeIds };
}

/**
 * Сливает разницу со списком эффектов сервера.
 *
 * Снятое убирается; изменённое заменяется на месте, только если сервер его
 * ещё держит (снятое сервером не воскресает); новое ложится по правилу
 * наложения — одноимённый эффект заменяет прежний.
 *
 * @param current - эффекты сущности на сервере (не мутируются)
 * @param changes - разница от клиента
 * @returns новый список эффектов
 */
export function applyEffectChanges(
  current: readonly ActiveEffect[],
  changes: EffectChanges,
): ActiveEffect[] {
  const removedIds = new Set(changes.removeIds);

  const updatesById = new Map(
    changes.update.map((effect) => [effect.id, effect]),
  );

  const addedIds = new Set(changes.add.map((effect) => effect.id));

  const kept = current
    .filter((effect) => !removedIds.has(effect.id) && !addedIds.has(effect.id))
    .map((effect) => updatesById.get(effect.id) ?? effect);

  return mergeAppliedEffects(kept, changes.add);
}
