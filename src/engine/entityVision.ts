/**
 * Зрение сущности по правилам D&D — ответ сцене приложения.
 *
 * Сцена приложения считает туман войны и видимость по зрению токена. Тёмное
 * зрение персонажа складывается не только из настроек токена: его дают
 * эффекты умений и черт («Аспект диких земель: Сова»), надетые и настроенные
 * предметы, заклинания. Пайплайн эффектов уже считает итог в
 * `ResolvedActorStats.senses.darkvision` (база — тёмное зрение токена), и
 * приложение спрашивает его хуком системы `resolveEntityVision`. Настройки
 * токена система при этом не переписывает: база остаётся базой, а эффект,
 * снятый с листа, сразу пропадает и со сцены.
 *
 * Хук зовётся часто — на каждом кадре тумана, — поэтому ответ кэшируется по
 * объекту сущности: стор приложения заменяет сущность новым объектом при
 * каждом изменении, и старый ответ уходит вместе со старым объектом.
 *
 * @module system/dnd/entityVision
 */

import type { DnDSceneEntity } from './dndEntities.js';

import { resolveActorStats } from './effectPipeline.js';
import { isTokenVisionEnabled, resolveTokenDarkvision } from './visionUtils.js';

/**
 * Зрение сущности по правилам системы — поверх настроек токена. Форма
 * контракта хука `resolveEntityVision` приложения: незаданное поле сцена
 * берёт из токена.
 */
export interface DndEntityVision {
  /** Зрение включено: эффект дал зрение токену, у которого оно выключено */
  enabled?: boolean;
  /** Дальность тёмного зрения в футах; 0 — нет */
  darkvisionUnits?: number;
}

/** Кэш ответов по объекту сущности — см. описание модуля */
const visionCache = new WeakMap<DnDSceneEntity, DndEntityVision | undefined>();

/**
 * Считает зрение сущности без кэша.
 *
 * @param entity - сущность
 * @returns поправка к зрению токена либо `undefined`, если правила ничего не
 *   меняют
 */
function computeEntityVision(
  entity: DnDSceneEntity,
): DndEntityVision | undefined {
  const isEnabled = isTokenVisionEnabled(entity.token);
  const tokenDarkvision = resolveTokenDarkvision(entity.token);
  const darkvision = resolveActorStats(entity).senses.darkvision;

  if (darkvision === tokenDarkvision) {
    return undefined;
  }

  // Эффект дал тёмное зрение токену с выключенным зрением — зрение включается:
  // иначе сцена его бы не увидела, а человек не понял бы, почему
  return {
    darkvisionUnits: darkvision,
    ...(!isEnabled && darkvision > 0 ? { enabled: true } : {}),
  };
}

/**
 * Зрение сущности по правилам D&D: поправка к зрению токена от эффектов,
 * предметов и умений.
 *
 * @param entity - сущность
 * @returns поправка к зрению токена либо `undefined`, если правила ничего не
 *   меняют
 */
export function resolveEntityVision(
  entity: DnDSceneEntity,
): DndEntityVision | undefined {
  if (visionCache.has(entity)) {
    return visionCache.get(entity);
  }

  const resolved = computeEntityVision(entity);

  visionCache.set(entity, resolved);

  return resolved;
}
