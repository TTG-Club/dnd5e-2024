/**
 * Проверка формы сущности сцены на границе «нейтральное ядро ↔ D&D».
 *
 * Ядро (сцена, сторы, сокет) знает сущность только как `SceneEntity`: у неё
 * `system` — непрозрачная запись, содержимое которой определяет система. Весь
 * расчёт D&D, наоборот, читает `DnDSceneEntity` с типизированным `system`.
 * Между этими двумя формами нужен разбор, а не доверие: в мире встречаются
 * записи от другой системы, недогруженные и просто испорченные.
 *
 * Проверяется то, на чём стоит весь расчёт листа и боя, — шесть характеристик.
 * Без них пайплайн эффектов считает от нулей и выдаёт бессмысленные КД,
 * спасброски и урон, поэтому такая сущность не цель и не носитель эффектов:
 * её отбрасывают целиком, а не чинят по месту.
 *
 * @module system/dnd/entityGuards
 */

import type { SceneEntity } from '@vtt/shared';

import type { DnDActor, DnDCreature, DnDSceneEntity } from './dndEntities.js';

import { isActorEntity, isCreatureEntity, isRecord } from '@vtt/shared';

import { ABILITY_KEYS } from './consts.js';

/**
 * Проверяет, что сущность сцены несёт данные D&D 5e.
 *
 * @param entity - сущность сцены в нейтральной форме ядра
 * @returns `true`, если у сущности есть все шесть характеристик числами
 */
export function isDndSceneEntity(
  entity: SceneEntity,
): entity is DnDSceneEntity {
  const abilities = entity.system.abilities;

  if (!isRecord(abilities)) {
    return false;
  }

  return ABILITY_KEYS.every((key) => typeof abilities[key] === 'number');
}

/**
 * Проверяет, что сущность сцены — актёр D&D 5e.
 *
 * Кроме характеристик сверяются корневые коллекции листа
 * (`spells`/`equipment`/`features`/`notes`): по типу они обязательны, а у
 * записи старого мира их нет. Заполняет их `normalizeActor`, и эта проверка —
 * его постусловие: прошла — форма собрана целиком.
 *
 * @param entity - сущность сцены в нейтральной форме ядра
 * @returns `true`, если это актёр с данными D&D
 */
export function isDndActor(entity: SceneEntity): entity is DnDActor {
  if (!isActorEntity(entity) || !isDndSceneEntity(entity)) {
    return false;
  }

  const actor: Record<string, unknown> = { ...entity };

  return (
    Array.isArray(actor.spells)
    && Array.isArray(actor.equipment)
    && Array.isArray(actor.features)
    && typeof actor.notes === 'string'
  );
}

/**
 * Проверяет, что сущность сцены — существо D&D 5e.
 *
 * @param entity - сущность сцены в нейтральной форме ядра
 * @returns `true`, если это существо с данными D&D
 */
export function isDndCreature(entity: SceneEntity): entity is DnDCreature {
  return isCreatureEntity(entity) && isDndSceneEntity(entity);
}
