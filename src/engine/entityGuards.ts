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

import type {
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
} from './dndEntities.js';

import { isCreatureEntity, isRecord } from '@vtt/shared';

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
  return hasAbilityScores(entity.system);
}

/**
 * Есть ли в блоке `system` все шесть характеристик числами.
 *
 * Общая часть проверок формы: тот же вопрос задают и названной ядром сущности,
 * и сырой записи-черновику, а второй ответ на него разошёлся бы с первым.
 *
 * @param system - блок `system` записи
 * @returns `true`, если все шесть характеристик на месте числами
 */
function hasAbilityScores(system: Record<string, unknown>): boolean {
  const abilities = system.abilities;

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
  return isDndActorRecord(entity);
}

/**
 * Проверяет, что СЫРАЯ запись — уже собранный лист D&D 5e.
 *
 * Дверь для черновиков: при создании и сохранении лист приходит с границы мира
 * ещё частичной записью, которую ядро сущностью не назвало, — типизированные
 * guard'ы к ней не применить, не соврав типу. Поэтому проверка идёт от самой
 * записи: вид, блок `system`, характеристики и корневые коллекции. Ею же
 * проверяется и названная сущность — см. {@link isDndActor}: две проверки
 * одного и того же разошлись бы.
 *
 * @param value - сырая запись (черновик листа либо сущность сцены)
 * @returns `true`, если запись — полный лист D&D
 */
export function isDndActorRecord(value: unknown): value is DnDActor {
  if (
    !isRecord(value)
    || value.entityType !== 'actor'
    || !isRecord(value.system)
    || !hasAbilityScores(value.system)
  ) {
    return false;
  }

  return (
    Array.isArray(value.spells)
    && Array.isArray(value.equipment)
    && Array.isArray(value.features)
    && typeof value.notes === 'string'
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

/**
 * Сущность сцены с инвентарём — та, у которой снаряжение лежит корневым
 * массивом `equipment`.
 *
 * Намеренно НЕ союз конкретных типов (`DnDActor | DnDCreature`): инвентарь —
 * это свойство записи, а не сорт сущности. Появится третий носитель предметов
 * (сундук, транспорт, фамильяр) — он подойдёт под этот тип, как только заведёт
 * у себя `equipment`, и передача предметов заработает для него без единой
 * правки в правилах переноса.
 */
export type DnDInventoryEntity = SceneEntity & { equipment: DnDGameItem[] };

/**
 * Проверяет, что сущность сцены несёт инвентарь.
 *
 * Проверка структурная, а не по `entityType`: так предикат не приходится
 * расширять при каждом новом носителе предметов. Массив обязателен именно
 * массивом — это постусловие нормализации (`normalizeActor`/`normalizeCreature`
 * заводят пустой список), и запись, до которой нормализация не дошла, в перенос
 * не пускается: иначе `push` ушёл бы в `undefined`.
 *
 * @param entity - сущность сцены в нейтральной форме ядра
 * @returns `true`, если у сущности есть массив снаряжения
 */
export function hasInventory(
  entity: SceneEntity,
): entity is DnDInventoryEntity {
  return 'equipment' in entity && Array.isArray(entity.equipment);
}
