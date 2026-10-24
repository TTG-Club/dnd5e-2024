import type {
  ActiveEffect,
  ClassDefinition,
  DnDActor,
} from '@vtt/shared/system/dnd.js';

import {
  hasSneakAttackSource,
  migrateLegacySneakAttackEffects,
  migrateStage3SneakAttackEffects,
} from '@vtt/shared/system/dnd.js';

import { collectFeatureEffects } from './classEffects';

/**
 * Обновление старых листов плута: кнопка Скрытой атаки, поставленная мастером
 * класса до появления `sneakAttack.damage`, заменяется новой строкой из
 * определения класса, а кнопки «−Nк6» Хитрого удара и подклассов, которые
 * делает автоматика, — снимаются или меняются на новые эффекты. Пересинхронизации
 * умений из компендиума у листа нет, поэтому без этого старый персонаж остался
 * бы с кнопками, а после выпуска новых данных — без автоматики (или с уроном
 * Скрытой атаки дважды).
 */

/** Ищет определение класса записи актора */
export type ClassResolver = (entry: {
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
 * Все эффекты умений класса и подкласса, положенные персонажу по уровню, — с
 * меткой класса в id. По ним миграция этапа 3 узнаёт, какие кнопки на листе
 * устарели.
 *
 * @param actor - персонаж
 * @param resolveClass - определение класса по записи
 * @returns эффекты умений; пусто — каталог не загружен
 */
function collectClassFeatureEffects(
  actor: DnDActor,
  resolveClass: ClassResolver,
): ActiveEffect[] {
  return (actor.system.classes ?? []).flatMap((entry) => {
    const definition = resolveClass(entry);

    if (!definition) {
      return [];
    }

    return collectFeatureEffects(
      definition,
      definition.features.filter(
        (feature) =>
          feature.level <= entry.level
          && (!feature.subclassKey
            || feature.subclassKey === entry.subclassKey),
      ),
    );
  });
}

/**
 * Эффекты листа после замены старой Скрытой атаки и кнопок этапа 3.
 *
 * @param actor - персонаж, каким он есть сейчас
 * @param resolveClass - определение класса по записи
 * @returns новые эффекты либо `undefined`, если менять нечего
 */
export function buildSneakAttackMigration(
  actor: DnDActor,
  resolveClass: ClassResolver,
): ActiveEffect[] | undefined {
  const current = actor.activeEffects ?? [];

  const stage1 = migrateLegacySneakAttackEffects(
    current,
    collectSneakAttackReplacements(actor, resolveClass),
  );

  const stage3 = migrateStage3SneakAttackEffects(
    stage1 ?? current,
    collectClassFeatureEffects(actor, resolveClass),
  );

  return stage3 ?? stage1;
}
