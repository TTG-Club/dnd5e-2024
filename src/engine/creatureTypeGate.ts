/**
 * Тип существа как признак цели и носителя: чтение типа с любой сущности сцены
 * и токен формулы `@target.type.<тип>`.
 *
 * Тип хранится по-разному — у существа это `system.type` из статблока, у листа
 * свой выбор (`system.creatureType`) либо тип выбранного вида, — а спрашивают
 * его одинаково: «кто передо мной». Развилка живёт здесь одна на весь расчёт,
 * как `resolveEntityCurrentHp` в `hitPoints.ts` собрал чтение хитов.
 *
 * Словарь признака один на всю систему (`CREATURE_CATEGORIES`): им подписан и
 * статблок существа, и вид персонажа, и гейт урона.
 *
 * @module system/dnd/creatureTypeGate
 */

import type { CreatureCategory } from './creatureTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { isCreatureEntity } from '@vtt/shared';

import { isCreatureCategory } from './consts.js';

/**
 * Тип листа, у которого не выбрано ни вида, ни своего типа.
 *
 * По правилам тип персонажу задаёт вид, и подавляющее большинство видов —
 * гуманоиды; тем же значением чинит испорченную запись вида `parseSpeciesEntry`.
 */
export const DEFAULT_ACTOR_CREATURE_TYPE: CreatureCategory = 'humanoid';

/** Приставка токена формулы, гасящего слагаемое по типу цели. */
const TARGET_TYPE_TOKEN_PREFIX = '@target.type.';

/** Регэксп поиска токена типа цели в слагаемом (с захватом типа). */
const TARGET_TYPE_DETECT_REGEX = /@target\.type\.([a-z]+)\b/i;

/** Регэксп удаления токенов типа цели из слагаемого. */
export const TARGET_TYPE_STRIP_REGEX = /\s*@target\.type\.[a-z]+\b\s*/gi;

/**
 * Токен формулы для типа существа.
 *
 * @param creatureType - тип существа
 * @returns строка вида `@target.type.undead`
 */
export function targetTypeToken(creatureType: CreatureCategory): string {
  return `${TARGET_TYPE_TOKEN_PREFIX}${creatureType}`;
}

/**
 * Тип существа, заданный токеном слагаемого.
 *
 * @param term - слагаемое формулы
 * @returns тип из токена; `undefined` — токена нет или тип неизвестен
 */
export function parseTargetTypeToken(
  term: string,
): CreatureCategory | undefined {
  const match = term.match(TARGET_TYPE_DETECT_REGEX);

  if (!match) {
    return undefined;
  }

  const parsed = match[1].toLowerCase();

  return isCreatureCategory(parsed) ? parsed : undefined;
}

/**
 * Тип существа сущности сцены.
 *
 * У листа порядок такой: свой выбор мастера главнее вида, а без обоих лист
 * считается гуманоидом — так гейты по типу работают и на персонаже, у которого
 * вид ещё не выбран. У существа тип один, из статблока: подставлять ему
 * «гуманоида» вместо испорченной записи нельзя — это молча меняло бы механику
 * чужого мира.
 *
 * @param entity - актор или существо в D&D-форме
 * @returns тип существа; `undefined` — только у существа с чужим типом
 */
export function resolveEntityCreatureType(
  entity: DnDSceneEntity,
): CreatureCategory | undefined {
  if (isCreatureEntity(entity)) {
    const statBlockType = entity.system.type;

    return isCreatureCategory(statBlockType) ? statBlockType : undefined;
  }

  const chosen = entity.system.creatureType;

  if (typeof chosen === 'string' && isCreatureCategory(chosen)) {
    return chosen;
  }

  const fromSpecies = entity.system.species?.creatureType;

  return typeof fromSpecies === 'string' && isCreatureCategory(fromSpecies)
    ? fromSpecies
    : DEFAULT_ACTOR_CREATURE_TYPE;
}
