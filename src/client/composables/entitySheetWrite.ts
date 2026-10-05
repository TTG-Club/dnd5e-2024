/**
 * Запись ресурсов листа во время игры — единственное место вне листов и окон
 * настройки, откуда система шлёт полную запись сущности (`emitEntityUpdate`).
 *
 * Полную запись сервер не сливает: `actor:updated` / `creature:updated`
 * заменяют сущность тем, что прислал клиент (README, § «Чего не хватает для
 * полноценного SDK»). Копия, захваченная раньше, — при открытии окна броска,
 * до вопроса о цене — возвращала хиты и эффекты, изменённые сервером за это
 * время. Здесь сущность берётся свежей в момент записи, преобразование меняет
 * только разделы листа, а стор правится тут же: следующая запись в том же
 * тике не возьмёт прежнее.
 *
 * Хиты, эффекты и журнал срабатываний этим путём не меняются — их несёт
 * боевой снимок (`entityCombatWrite.ts`), который сервер сливает со своим
 * состоянием. Журнал — тоже только им и ровно один раз на действие: помощник
 * листа расход журнала не шлёт. Раньше он слал разницу журнала сам, и
 * действие, которое писало и лист, и боевой снимок, тратило лимит дважды.
 */

import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { SheetWriteSection } from './worldSheetSections';

import { emitEntityUpdate } from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { isActorEntity, isCreatureEntity } from '@vtt/shared';
import {
  readTriggerUsage,
  resolveEntityCurrentHp,
  resolveEntityTempHp,
  withTriggerUsage,
} from '@vtt/shared/system/dnd.js';

import {
  readSentActiveEffects,
  readSentTriggerUsage,
} from './entityCombatWrite';
import { useWorldEntities } from './useWorldEntities';

/** Метка сообщений помощника в журнале браузера */
const SHEET_WRITE_LOG_PREFIX = '[entitySheetWrite]';

/** Что помощник пишет в журнал, отказывая записи или замечая чужой раздел */
const SHEET_WRITE_ERRORS = {
  combatState: 'хиты и эффекты меняет боевой снимок, а не запись листа',
  triggerUsage: 'журнал срабатываний шлёт боевой снимок, а не запись листа',
};

/**
 * Не тронуты ли хиты и эффекты: их меняет только боевой снимок. Полная запись
 * с другими хитами или эффектами затёрла бы то, что сервер изменил после
 * копии, — такую запись помощник не шлёт.
 *
 * @param current - сущность мира
 * @param next - новая сущность
 * @returns `true`, если хиты и эффекты те же
 */
function keepsCombatState(
  current: DnDSceneEntity,
  next: DnDSceneEntity,
): boolean {
  return (
    resolveEntityCurrentHp(next) === resolveEntityCurrentHp(current)
    && resolveEntityTempHp(next) === resolveEntityTempHp(current)
    && JSON.stringify(next.activeEffects ?? [])
      === JSON.stringify(current.activeEffects ?? [])
  );
}

/**
 * Меняет ресурсы листа сущности мира: ячейки, заряды, счётчики, предметы,
 * заклинания.
 *
 * Вызывающий отдаёт id и преобразование, а не готовую копию: сущность
 * перечитывается в момент записи. Ресурсы, посчитанные заранее (оплата цены
 * прошла через вопросы человеку), переносятся на свежую сущность
 * `withSheetResources(current, spent)`.
 *
 * Эффекты серверу уходят не из стора, а с посланным боевым каналом
 * (`readSentActiveEffects`): запись листа сразу после каста не возвращает
 * прежнюю метку концентрации и не стирает новую.
 *
 * Журнал срабатываний (`system.effectUsage`) — боевое состояние, как хиты и
 * эффекты: из преобразования он не берётся и этим помощником не шлётся.
 * Запись несёт журнал, посланный боевыми снимками (`readSentTriggerUsage`), а
 * расход журнала шлёт боевой помощник — тот, кто делал действие
 * (`sendTriggerUsageSpend`, `sendComputedCombatState`,
 * `changeEntityCombatState`). Преобразование, изменившее журнал, — ошибка
 * вызывающего: запись листа уходит, изменение журнала — нет.
 *
 * @param entityId - сущность
 * @param change - новая сущность от свежей: НОВЫЙ объект с теми же хитами,
 *   эффектами и журналом; `null` — ничего не писать
 * @returns записанная сущность; нет соединения, сущности, изменения или
 *   преобразование тронуло хиты и эффекты — `null`
 */
export function changeEntitySheet(
  entityId: string | null | undefined,
  change: (current: DnDSceneEntity) => DnDSceneEntity | null,
): DnDSceneEntity | null {
  const worldStore = useWorldStore();
  const worldId = worldStore.connectionState.currentWorldId;
  const socket = useChatStore().getSocket();
  const current = useWorldEntities().findCurrentDndEntity(entityId);

  if (!worldId || !socket || !current) {
    return null;
  }

  const changed = change(current);

  if (!changed || changed === current) {
    return null;
  }

  if (!keepsCombatState(current, changed)) {
    console.error(
      `${SHEET_WRITE_LOG_PREFIX} ${current.name}: ${SHEET_WRITE_ERRORS.combatState}`,
    );

    return null;
  }

  const storeLedger = readTriggerUsage(current);

  if (
    JSON.stringify(readTriggerUsage(changed)) !== JSON.stringify(storeLedger)
  ) {
    console.error(
      `${SHEET_WRITE_LOG_PREFIX} ${current.name}: ${SHEET_WRITE_ERRORS.triggerUsage}`,
    );
  }

  // Серверу — журнал с посланным расходом; стору — его прежний журнал: журнал
  // стора меняет только ответ сервера, по нему и узнают, что посланное дошло
  const stored = withTriggerUsage(changed, storeLedger);

  // Эффекты серверу — с посланным боевым каналом, чего в сторе ещё нет: метка
  // концентрации только что доведённого каста, снятое концом прежнего каста.
  // Стор их не получает: его эффекты меняет только ответ сервера
  const storeEffects = current.activeEffects ?? [];
  const sentEffects = readSentActiveEffects(current);

  const next = withTriggerUsage(
    JSON.stringify(sentEffects) === JSON.stringify(storeEffects)
      ? changed
      : { ...changed, activeEffects: [...sentEffects] },
    readSentTriggerUsage(current),
  );

  // Изменился только журнал — полной записи нечего нести
  if (
    JSON.stringify(stored)
    === JSON.stringify(withTriggerUsage(current, storeLedger))
  ) {
    return null;
  }

  // Стор — сразу: следующая запись в том же тике читает уже новые разделы.
  // Разделы — по списку `SHEET_WRITE_SECTIONS`: те же подтягивают из мира
  // открытые листы; новый раздел в списке без строки здесь не соберётся
  const sections: Pick<DnDSceneEntity, SheetWriteSection> = {
    system: stored.system,
    equipment: stored.equipment,
    spells: stored.spells,
  };

  if (isActorEntity(next)) {
    worldStore.updateActor(worldId, next.id, sections);
  } else if (isCreatureEntity(next)) {
    worldStore.updateCreature(worldId, next.id, sections);
  }

  emitEntityUpdate(socket, next);

  return next;
}
