import type { DnDActor } from './dndEntities.js';
import type { FeatData } from './featTypes.js';

import { pushUnique, removeItems } from '@vtt/shared';

/**
 * Общие примитивы применения блока даров `featData` к актору.
 *
 * Один и тот же блок несут черта, предыстория, вид (и его особенности) и умение
 * класса; применяют его четыре разных мастера, каждый со своей книгой учёта.
 * Здесь — только то, что у всех совпадает буквально: правка владений и подъём
 * тёмного зрения токена. Синтетический эффект даров собирает
 * `buildFeatGrantEffect`, выборы игрока — `applyFeatChoiceSelections`.
 */

/** Владения актора (структурно — то, что правит блок даров). */
export type ActorProficiencies = DnDActor['system']['proficiencies'];

/**
 * Глубокая копия владений (чтобы не мутировать исходный объект актора).
 *
 * Клонируем через JSON, а НЕ `structuredClone`: актор приходит из `ref` листа
 * (`localActor`), поэтому `actor.system.proficiencies` — реактивный Proxy Vue, на
 * котором `structuredClone` бросает `DataCloneError` («could not be cloned»).
 * Владения — чистый JSON (массивы строк + запись строка→строка), так что клон
 * без потерь. Тот же приём используется в {@link raiseTokenDarkvision}.
 *
 * @param proficiencies - владения актора
 * @returns независимая копия владений
 */
export function cloneActorProficiencies(
  proficiencies: ActorProficiencies,
): ActorProficiencies {
  return JSON.parse(JSON.stringify(proficiencies));
}

/**
 * Применяет безусловные владения блока даров к копии владений актора (in-place).
 *
 * @param proficiencies - копия владений актора
 * @param featData - блок даров источника; пусто — применять нечего
 */
export function applyFeatDataProficiencies(
  proficiencies: ActorProficiencies,
  featData: FeatData | null | undefined,
): void {
  for (const skill of featData?.skillProficiencies ?? []) {
    proficiencies.skills[skill] = 'proficient';
  }

  pushUnique(proficiencies.weapons, featData?.weaponProficiencies ?? []);
  pushUnique(proficiencies.weaponMasteries, featData?.weaponMasteries ?? []);
  pushUnique(proficiencies.armor, featData?.armorProficiencies ?? []);
  pushUnique(proficiencies.tools, featData?.toolProficiencies ?? []);
  pushUnique(proficiencies.languages, featData?.languages ?? []);

  pushUnique(
    proficiencies.savingThrows,
    featData?.savingThrowProficiencies ?? [],
  );
}

/**
 * Откатывает безусловные владения блока даров из копии владений актора
 * (in-place).
 *
 * @param proficiencies - копия владений актора
 * @param featData - блок даров источника; пусто — откатывать нечего
 */
export function removeFeatDataProficiencies(
  proficiencies: ActorProficiencies,
  featData: FeatData | null | undefined,
): void {
  for (const skill of featData?.skillProficiencies ?? []) {
    Reflect.deleteProperty(proficiencies.skills, skill);
  }

  removeItems(proficiencies.weapons, featData?.weaponProficiencies ?? []);
  removeItems(proficiencies.weaponMasteries, featData?.weaponMasteries ?? []);
  removeItems(proficiencies.armor, featData?.armorProficiencies ?? []);
  removeItems(proficiencies.tools, featData?.toolProficiencies ?? []);
  removeItems(proficiencies.languages, featData?.languages ?? []);

  removeItems(
    proficiencies.savingThrows,
    featData?.savingThrowProficiencies ?? [],
  );
}

/**
 * Возвращает обновлённые настройки токена с поднятым до `darkvision` тёмным
 * зрением, либо `undefined`, если поднимать нечего (источник не даёт тёмного
 * зрения или у токена оно уже не ниже). Дальность не понижается: у тёмного
 * зрения может быть другой источник (вид/класс/черта), и откат недеструктивен.
 *
 * @param token - текущие настройки токена актора
 * @param darkvision - тёмное зрение источника (футы)
 * @returns новые настройки токена либо `undefined`, когда менять нечего
 */
export function raiseTokenDarkvision(
  token: DnDActor['token'],
  darkvision: number,
): DnDActor['token'] | undefined {
  if (darkvision <= 0) {
    return undefined;
  }

  const next: NonNullable<DnDActor['token']> = JSON.parse(
    JSON.stringify(token ?? {}),
  );

  if (!next.vision) {
    next.vision = { enabled: true, range: 60, darkvision: 0, angle: 360 };
  }

  if (darkvision <= next.vision.darkvision) {
    return undefined;
  }

  next.vision.darkvision = darkvision;

  return next;
}
