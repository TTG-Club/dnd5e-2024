/**
 * Единая точка чтения и записи хитов сущности D&D 5e (актор или существо).
 *
 * Формы отличаются: у актора `system.hitPoints.current`/`max` — обязательные
 * числа, у существа обязателен только `average` (среднее из статблока), а
 * `current`/`max` появляются лишь после того, как хиты кто-то реально задал
 * (модалка ХП, случайный бросок при создании копии, урон). Существо из
 * компендиума, созданное вручную (`DEFAULT_CREATURE`) или клонированное с
 * порчей данных приходит вообще без них.
 *
 * Отсюда правило, обязательное для ВСЕХ боевых путей: отсутствующий запас хитов
 * читается как `average`, ровно так же, как его показывает интерфейс (карточка
 * существа `current ?? average`, полоска над токеном `current ?? max ??
 * average`). Раньше боевая математика вместо этого читала `current ?? 0` /
 * `max ?? 0`, и существо без явных хитов становилось НЕУЯЗВИМЫМ: урон считался
 * от 0 хитов, серверный кламп по `max = 0` решал «ничего не изменилось», а
 * интерфейс всё это время показывал полное здоровье по откату на `average`.
 *
 * Здесь же живёт единственный ПИСАТЕЛЬ хитов `writeEntityHitPoints`: запись
 * приходится сужать по виду сущности (у union `system` иначе не сходятся типы),
 * и эта пятистрочная развилка была скопирована в четырёх боевых путях.
 *
 * NB: у `effectPipeline` есть свой `resolveHitPointsMax` для НЕПРОЗРАЧНОГО
 * блоба `system.hitPoints` (там сущность ещё не сужена, а дефолт — 10 хитов
 * базовой характеристики). Здесь работа с уже типизированной сущностью.
 *
 * @module system/dnd/hitPoints
 */

import type { DnDSceneEntity } from './dndEntities.js';

import { isActorEntity, isCreatureEntity } from '@vtt/shared';

import { resolveMaxHitPointsDelta } from './effectPipeline.js';

/**
 * Записанный в лист максимум хитов — БЕЗ активных эффектов.
 *
 * У существа: явный `max`, иначе `average` из статблока, иначе 0 (у существ с
 * текстовыми хитами вида «половина хитов призывателя» `average` равен `null`).
 *
 * Нужен там, где важен именно запас листа: «полные хиты» существа без явного
 * `current` и отсчёт самой прибавки эффектов. Все остальные чтения максимума
 * идут через {@link resolveEntityMaxHp} — с эффектами.
 *
 * @param entity - сущность (актор или существо)
 * @returns максимум хитов по записи листа
 */
export function resolveBaseMaxHp(entity: DnDSceneEntity): number {
  if (isCreatureEntity(entity)) {
    const { average, max } = entity.system.hitPoints;

    return max ?? average ?? 0;
  }

  return entity.system.hitPoints.max;
}

/**
 * Максимум хитов сущности С УЧЁТОМ активных эффектов (ключ `hitPoints.max`).
 *
 * Эффекты вроде «Ложной жизни» поднимают потолок хитов, и знать об этом обязаны
 * все боевые пути разом: лечение до максимума, ограничение текущих хитов сверху,
 * плитка хитов листа и сводка HUD. Поэтому потолок считается здесь, в
 * единственной точке чтения хитов, а не у каждого потребителя по-своему — иначе
 * эффект работал бы в лечении и не работал в ограничении.
 *
 * ВНЕ охвата: полоса над токеном рисуется ядром, которое читает `system` как
 * непрозрачный блоб (`useSceneTokens`) и о ключе `hitPoints.max` не знает —
 * там показывается запас листа, пока в контракте `VttSystem` нет метода чтения
 * хитов сущности.
 *
 * Считается прибавкой к запасу листа, а не значением из пайплайна целиком:
 * у пайплайна свой отсчёт для непрозрачного блока хитов (дефолт в 10), и
 * подменять им запас существа с текстовыми хитами нельзя.
 *
 * @param entity - сущность (актор или существо)
 * @returns максимум хитов с учётом эффектов
 */
export function resolveEntityMaxHp(entity: DnDSceneEntity): number {
  return Math.max(
    0,
    resolveBaseMaxHp(entity) + resolveMaxHitPointsDelta(entity),
  );
}

/**
 * Текущие хиты сущности.
 *
 * У существа без явного `current` — полный запас: статблок описывает существо
 * целым и невредимым, пока по нему не прошёлся урон.
 *
 * @param entity - сущность (актор или существо)
 * @returns текущие хиты
 */
export function resolveEntityCurrentHp(entity: DnDSceneEntity): number {
  if (isCreatureEntity(entity)) {
    // Запас листа, а не потолок с эффектами: статблок описывает существо целым,
    // а прибавка эффекта — временная надстройка, «полным» её не считают
    return entity.system.hitPoints.current ?? resolveBaseMaxHp(entity);
  }

  return entity.system.hitPoints.current;
}

/**
 * Временные хиты сущности (у обоих видов поле необязательное).
 *
 * @param entity - сущность (актор или существо)
 * @returns временные хиты
 */
export function resolveEntityTempHp(entity: DnDSceneEntity): number {
  return entity.system.hitPoints.temp ?? 0;
}

/**
 * Записывает исход боя в хиты сущности (МУТИРУЕТ её).
 *
 * Ветка по виду сущности обязательна: у union `DnDActorSystem | CreatureSystem`
 * присваивание не сужается без неё. Сущность неизвестного вида не трогаем —
 * молча, как и раньше: писать в неопознанную форму Ядра нельзя.
 *
 * Максимум хитов каналом боя не меняется, поэтому его здесь нет: у существа
 * `max` может так и остаться незаданным, и чтение продолжит откатываться на
 * `average` (см. `resolveEntityMaxHp`).
 *
 * @param entity - сущность-цель (обычно глубокая копия для отправки на сервер)
 * @param hitPoints - новые текущие и временные хиты
 * @param hitPoints.current - текущие хиты
 * @param hitPoints.temp - временные хиты
 */
export function writeEntityHitPoints(
  entity: DnDSceneEntity,
  hitPoints: { current: number; temp: number },
): void {
  if (isCreatureEntity(entity)) {
    entity.system.hitPoints.current = hitPoints.current;
    entity.system.hitPoints.temp = hitPoints.temp;
  } else if (isActorEntity(entity)) {
    entity.system.hitPoints.current = hitPoints.current;
    entity.system.hitPoints.temp = hitPoints.temp;
  }
}
