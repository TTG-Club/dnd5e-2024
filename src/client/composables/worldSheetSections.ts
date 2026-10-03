/**
 * Разделы сущности, которые система пишет в мир во время игры, — одним
 * списком на тех, кто пишет, и тех, кто держит свою копию сущности.
 *
 * Открытый лист правит черновик — глубокую копию сущности — и сохраняет его
 * целиком. Раздел, который помощник записи изменил в мире, а лист из мира не
 * подтянул, следующее сохранение листа возвращает прежним: так заряд
 * заклинания существа, списанный кастом, оживал на первой же правке листа.
 * Список здесь один, поэтому «помощник пишет раздел, а лист его не
 * синхронизирует» разойтись не может (тест `worldSheetSync`).
 */

import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import { cloneEntityData } from '@vtt/shared/system/dnd.js';

/**
 * Разделы, которые кладёт в мир запись листа (`changeEntitySheet`): ресурсы
 * листа, предметы, заклинания
 */
export const SHEET_WRITE_SECTIONS = ['system', 'equipment', 'spells'] as const;

/**
 * Разделы, которые меняет боевой снимок (`changeEntityCombatState`): хиты и
 * журнал срабатываний лежат в `system`, эффекты — своим списком
 */
export const COMBAT_STATE_SECTIONS = ['system', 'activeEffects'] as const;

/** Раздел, который пишет запись листа */
export type SheetWriteSection = (typeof SHEET_WRITE_SECTIONS)[number];

/** Раздел, который пишет в мир хоть один помощник записи */
export type WorldSheetSection =
  SheetWriteSection | (typeof COMBAT_STATE_SECTIONS)[number];

/**
 * Все разделы, которые пишут помощники записи: их и подтягивает из мира
 * каждый, кто держит копию сущности
 */
export const WORLD_SHEET_SECTIONS: readonly WorldSheetSection[] = [
  ...new Set<WorldSheetSection>([
    ...SHEET_WRITE_SECTIONS,
    ...COMBAT_STATE_SECTIONS,
  ]),
];

/**
 * Кладёт в черновик один раздел сущности мира — глубокой копией: запись
 * стора хоста общая, и править её через черновик нельзя. Раздел, которого у
 * сущности мира нет, в черновике не трогается.
 *
 * @param draft - черновик листа (меняется)
 * @param world - сущность мира того же вида, что черновик
 * @param section - раздел
 */
export function copyWorldSection<
  Entity extends DnDSceneEntity,
  Section extends WorldSheetSection,
>(draft: Entity, world: Entity, section: Section): void {
  const value = world[section];

  if (value !== undefined) {
    draft[section] = cloneEntityData(value);
  }
}

/**
 * Кладёт в черновик все разделы, которые система пишет в мир.
 *
 * @param draft - черновик листа (меняется)
 * @param world - сущность мира того же вида, что черновик
 */
export function copyWorldSections<Entity extends DnDSceneEntity>(
  draft: Entity,
  world: Entity,
): void {
  for (const section of WORLD_SHEET_SECTIONS) {
    copyWorldSection(draft, world, section);
  }
}
