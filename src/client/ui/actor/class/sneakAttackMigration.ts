import type {
  ActiveEffect,
  ClassDefinition,
  DnDActor,
} from '@vtt/shared/system/dnd.js';

import {
  hasSneakAttackSource,
  migrateLegacySneakAttackEffects,
} from '@vtt/shared/system/dnd.js';

import { collectFeatureEffects } from './classEffects';

/**
 * Обновление старых листов плута: кнопка Скрытой атаки, поставленная мастером
 * класса до появления `sneakAttack.damage`, заменяется новой строкой из
 * определения класса. Пересинхронизации умений из компендиума у листа нет,
 * поэтому без этого старый персонаж остался бы с кнопкой, а после выпуска
 * новых данных — без автоматической Скрытой атаки.
 */

/** Ищет определение класса записи актора */
type ClassResolver = (entry: {
  classKey: string;
  packId?: string;
}) => ClassDefinition | undefined;

/**
 * Эффекты умений класса со Скрытой атакой, которые положены персонажу по его
 * уровню и подклассу, — с меткой класса в id, как их ставит мастер класса.
 *
 * @param actor - персонаж
 * @param resolveClass - определение класса по записи
 * @returns эффекты-замены; пусто — замен нет (каталог не загружен, данные
 *   компендиума ещё старые)
 */
function collectSneakAttackReplacements(
  actor: DnDActor,
  resolveClass: ClassResolver,
): ActiveEffect[] {
  return (actor.system.classes ?? []).flatMap((entry) => {
    const definition = resolveClass(entry);

    if (!definition) {
      return [];
    }

    const features = definition.features.filter(
      (feature) =>
        feature.level <= entry.level
        && (!feature.subclassKey || feature.subclassKey === entry.subclassKey)
        && hasSneakAttackSource(feature.activeEffects ?? []),
    );

    return collectFeatureEffects(definition, features).filter((effect) =>
      hasSneakAttackSource([effect]),
    );
  });
}

/**
 * Эффекты листа после замены старой Скрытой атаки.
 *
 * @param actor - персонаж, каким он есть сейчас
 * @param resolveClass - определение класса по записи
 * @returns новые эффекты либо `undefined`, если менять нечего
 */
export function buildSneakAttackMigration(
  actor: DnDActor,
  resolveClass: ClassResolver,
): ActiveEffect[] | undefined {
  return migrateLegacySneakAttackEffects(
    actor.activeEffects ?? [],
    collectSneakAttackReplacements(actor, resolveClass),
  );
}
