/**
 * Лимит Скрытой атаки «раз в ход» на клиенте: проверка, расход и возврат.
 *
 * Счётчик живёт в журнале срабатываний бросающего (`system.effectUsage`) под
 * общим ключом метки (`SNEAK_ATTACK_USAGE_KEY`) и едет боевым каналом — как
 * расход любого лимита. Сбрасывает его сервер в конце каждого хода боя.
 *
 * Расход пишется, когда кости Скрытой атаки брошены в урон: попадание по цели
 * или бросок без цели (тогда попал ли удар, решает мастер, и урон он наносит
 * сам). Промах лимит не тратит — на промахе урона не бросают вовсе. Вне боя
 * не пишется ничего: сбросить счётчик некому.
 *
 * Гонка двух клиентов одного игрока (две вкладки) не закрыта: каждый читает
 * свой журнал, а сервер о Скрытой атаке не знает. Два окна одного клиента
 * гонки не дают: журнал, посланный первым, второе читает сразу
 * (`readSentTriggerUsage`).
 */

import type { ActiveEffect, DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import {
  applyTriggerUsageChanges,
  buildSneakAttackSpend,
  canPayActivation,
  isSneakAttackSpent,
  readTriggerUsage,
  releaseSneakAttackUsage,
  withTriggerUsage,
} from '@vtt/shared/system/dnd.js';

import { payEntityActivation, readEntityCounters } from './effectToggle';
import { isEntityInCombat, resolveTurnStamp } from './encounterTurn';
import {
  changeEntityCombatState,
  readSentTriggerUsage,
} from './entityCombatWrite';
import { changeEntitySheet } from './entitySheetWrite';
import { useWorldEntities } from './useWorldEntities';

/**
 * Потрачена ли Скрытая атака бросающего в этом ходу. Вне боя — никогда.
 *
 * @param entityId - бросающий
 * @returns `true`, если в этом ходу её уже нет
 */
export function isSneakAttackSpentNow(entityId: string): boolean {
  if (!isEntityInCombat(entityId)) {
    return false;
  }

  const entity = useWorldEntities().findCurrentDndEntity(entityId);

  return entity ? isSneakAttackSpent(readSentTriggerUsage(entity)) : false;
}

/**
 * Тратит Скрытую атаку бросающего. Вне боя ничего не пишет.
 *
 * Зовётся, когда её кости брошены в урон: после попадания либо при атаке без
 * цели. Без цели это решение: попал ли удар, решает мастер и наносит урон
 * вне системы — другого момента «урон нанесён» у системы нет.
 *
 * @param entityId - бросающий
 * @returns метка хода, в котором потрачено; вне боя — `undefined`: возвращать
 *   нечего
 */
export function spendSneakAttack(entityId: string): string | undefined {
  if (!isEntityInCombat(entityId)) {
    return undefined;
  }

  const turnStamp = resolveTurnStamp();

  changeEntityCombatState(entityId, (current) =>
    withTriggerUsage(
      current,
      applyTriggerUsageChanges(
        readTriggerUsage(current),
        buildSneakAttackSpend(),
      ),
    ),
  );

  return turnStamp;
}

/**
 * Возвращает потраченную Скрытую атаку: урон отменили из чата. Только в том
 * же ходу — после его конца сервер счётчик уже сбросил, и снятие задело бы
 * расход следующего хода.
 *
 * @param entityId - бросающий
 * @param turnStamp - ход, в котором потрачено
 */
export function releaseSneakAttack(entityId: string, turnStamp: string): void {
  if (resolveTurnStamp() !== turnStamp) {
    return;
  }

  changeEntityCombatState(entityId, (current) =>
    withTriggerUsage(current, releaseSneakAttackUsage(current)),
  );
}

/**
 * Хватает ли бросающему ресурса на эффект по выбору при Скрытой атаке:
 * «Раздирание разума» тратит своё использование (`activation.counter`).
 * Приём без ресурса доступен всегда.
 *
 * @param entity - бросающий
 * @param effect - эффект-кнопка приёма
 * @returns `true`, если приём можно выбрать
 */
export function canAffordSneakAttackOption(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
): boolean {
  return (
    !effect.activation?.counter
    || canPayActivation(readEntityCounters(entity), effect.activation)
  );
}

/**
 * Списывает ресурс выбранных приёмов, когда их Скрытая атака брошена в урон
 * (попадание или атака без цели) — как кнопка «Применить» того же эффекта.
 * Эффекты-кнопки берутся со свежей сущности: копия приёма для цели уже без
 * применения и ресурса не знает.
 *
 * @param entityId - бросающий
 * @param effectIds - id эффектов-кнопок выбранных приёмов
 */
export function paySneakAttackOptions(
  entityId: string,
  effectIds: readonly string[],
): void {
  if (effectIds.length === 0) {
    return;
  }

  changeEntitySheet(entityId, (current) =>
    (current.activeEffects ?? [])
      .filter(
        (effect) => effectIds.includes(effect.id) && effect.activation?.counter,
      )
      .reduce((entity, effect) => payEntityActivation(entity, effect), current),
  );
}
