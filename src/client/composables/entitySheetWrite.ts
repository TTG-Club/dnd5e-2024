/**
 * Запись ресурсов листа во время игры: ячейки, заряды, счётчики, предметы,
 * заклинания — частичной записью (`entity:patch`).
 *
 * Полную запись (`actor:updated` / `creature:updated`) сервер не сливает: она
 * заменяет сущность тем, что прислал клиент, и возвращала хиты и эффекты,
 * изменённые сервером после копии клиента. Здесь на сервер уходит только то,
 * чем преобразование изменило сущность: сущность берётся свежей в момент
 * записи, а разница ложится на текущую сущность сервера. Стор правится тут
 * же: следующая запись в том же тике считается уже от новых разделов —
 * операции задают значение, а не приращение.
 *
 * Хиты, эффекты и журнал срабатываний этим путём не меняются — их несёт
 * боевой снимок (`entityCombatWrite.ts`), который сервер сливает правилами
 * системы. В правку листа они не попадают вовсе, поэтому запись листа сразу
 * после каста больше не может вернуть прежнюю метку концентрации.
 *
 * Правка, которая не легла на сущность сервера (отказ `conflict`), повторяется
 * один раз. Сервер ушёл вперёд (запись списка успели убрать) — рассылка уже
 * положила его сущность в стор, и преобразование выполняется заново над ней.
 * Сервер отстал (прежняя правка не записана, стор всё ещё несёт нашу) —
 * остаётся запасной путь: сущность стора уходит целиком, с эффектами и
 * журналом, посланными боевым каналом.
 */

import type { EntityPatchOutcome } from '@/core/entityUtils';
import type { TypedWebSocketClient } from '@vtt/shared';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { SheetWriteSection } from './worldSheetSections';

import { toRaw } from 'vue';

import {
  buildEntityPatchFailureToast,
  emitEntityPatch,
  emitEntityUpdate,
} from '@/core/entityUtils';
import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { buildEntityPatch, isActorEntity, isCreatureEntity } from '@vtt/shared';
import {
  readTriggerUsage,
  resolveEntityCurrentHp,
  resolveEntityTempHp,
  withPatchRecordIds,
  withTriggerUsage,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  readSentActiveEffects,
  readSentTriggerUsage,
} from './entityCombatWrite';
import { PATCH_CONFLICT_REASON } from './useEntityDraftWrite';
import { useWorldEntities } from './useWorldEntities';

/** Метка сообщений помощника в журнале браузера */
const SHEET_WRITE_LOG_PREFIX = '[entitySheetWrite]';

/** Что помощник пишет в журнал, отказывая записи или замечая чужой раздел */
const SHEET_WRITE_ERRORS = {
  combatState: 'хиты и эффекты меняет боевой снимок, а не запись листа',
  triggerUsage: 'журнал срабатываний шлёт боевой снимок, а не запись листа',
  refused: 'сервер не записал правку листа',
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
 * Запасной путь: сущность стора уходит на сервер целиком.
 *
 * Эффекты и журнал срабатываний — с посланным боевым каналом
 * (`readSentActiveEffects`, `readSentTriggerUsage`), чего в сторе ещё нет:
 * полная запись несёт сущность целиком и без этого вернула бы прежнюю метку
 * концентрации и стёрла бы расход лимита.
 *
 * @param socket - сокет мира
 * @param entityId - сущность
 */
function resendSheetInFull(
  socket: TypedWebSocketClient,
  entityId: string,
): void {
  const current = useWorldEntities().findCurrentDndEntity(entityId);

  if (!current) {
    return;
  }

  emitEntityUpdate(
    socket,
    withTriggerUsage(
      { ...current, activeEffects: [...readSentActiveEffects(current)] },
      readSentTriggerUsage(current),
    ),
  );
}

/**
 * Разделы, которые система положила в стор последней записью листа, — по
 * сущностям. По ним разбор отказа узнаёт, заменила ли рассылка сервера
 * сущность стора: пока разделы стора те же объекты, сервер отстаёт, и
 * сколько бы записей ни прошло в одном тике, стор несёт их все.
 */
const lastWrittenSections = new Map<
  string,
  Pick<DnDSceneEntity, SheetWriteSection>
>();

/**
 * Несёт ли стор разделы последней записи листа — те же объекты.
 *
 * @param current - сущность стора
 * @returns `true`, если рассылка сервера сущность ещё не заменила
 */
function keepsWrittenSections(current: DnDSceneEntity): boolean {
  const written = lastWrittenSections.get(current.id);

  return (
    written !== undefined
    && toRaw(current.system) === written.system
    && toRaw(current.equipment) === written.equipment
    && toRaw(current.spells) === written.spells
  );
}

/** Преобразование листа: новая сущность от свежей либо `null` */
type SheetChange = (current: DnDSceneEntity) => DnDSceneEntity | null;

/** Отправленная правка листа и то, чем её можно повторить */
interface SentSheetWrite {
  /** Сокет мира */
  socket: TypedWebSocketClient;
  /** Сущность, какой она стала в сторе после правки */
  entity: DnDSceneEntity;
  /** Преобразование, которым правка получена */
  change: SheetChange;
  /** Можно ли повторить правку: повтор сам уже не повторяется */
  mayRetry: boolean;
}

/**
 * Разделы листа, которые правка кладёт в стор.
 *
 * @param entity - сущность
 * @returns её разделы листа
 */
function pickSheetSections(
  entity: DnDSceneEntity,
): Pick<DnDSceneEntity, SheetWriteSection> {
  return {
    system: entity.system,
    equipment: entity.equipment,
    spells: entity.spells,
  };
}

/**
 * Разбирает ответ сервера на правку листа.
 *
 * Правка не легла на сущность сервера — повторяется один раз: если стор всё
 * ещё несёт разделы наших записей (сервер отстал), сущность стора уходит
 * целиком — со всеми записями этого тика; если рассылка уже заменила её
 * сущностью сервера, преобразование выполняется заново над ней. О прочих отказах и о неудавшемся повторе узнаёт игрок —
 * стор уже показывает списанное, а на сервере его нет.
 *
 * @param outcome - ответ сервера
 * @param sent - отправленная правка
 */
function settleSheetWrite(
  outcome: EntityPatchOutcome,
  sent: SentSheetWrite,
): void {
  if (outcome.ok) {
    return;
  }

  const { socket, entity } = sent;

  if (outcome.reason === PATCH_CONFLICT_REASON && sent.mayRetry) {
    const current = useWorldEntities().findCurrentDndEntity(entity.id);

    // Тот же объект раздела либо то же содержимое: стор хоста мог положить
    // раздел копией, и по одной ссылке «сервер отстал» не узнать
    const storeKeepsChange =
      current !== undefined
      && (keepsWrittenSections(current)
        || buildEntityPatch(
          pickSheetSections(current),
          pickSheetSections(entity),
        ).length === 0);

    if (storeKeepsChange) {
      resendSheetInFull(socket, entity.id);
    } else {
      writeSheetChange(entity.id, sent.change, false);
    }

    return;
  }

  const failureToast = buildEntityPatchFailureToast(outcome, entity.name);

  console.error(
    `${SHEET_WRITE_LOG_PREFIX} ${entity.name}: ${SHEET_WRITE_ERRORS.refused} (${outcome.reason})`,
  );

  if (failureToast) {
    useSystemToastStore().add(failureToast);
  }
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
 * На сервер уходит разница «свежая сущность → результат преобразования».
 * Хиты, эффекты и журнал срабатываний (`system.effectUsage`) — боевое
 * состояние: преобразование, тронувшее хиты или эффекты, не шлётся вовсе, а
 * журнал из преобразования не берётся. Его расход шлёт боевой помощник — тот,
 * кто делал действие (`sendTriggerUsageSpend`, `sendComputedCombatState`,
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
  change: SheetChange,
): DnDSceneEntity | null {
  return writeSheetChange(entityId, change, true);
}

/**
 * Выполняет преобразование над свежей сущностью, кладёт разделы в стор и шлёт
 * серверу разницу.
 *
 * @param entityId - сущность
 * @param change - преобразование листа
 * @param mayRetry - повторить ли правку, если она не ляжет на сущность сервера
 * @returns записанная сущность либо `null` (см. `changeEntitySheet`)
 */
function writeSheetChange(
  entityId: string | null | undefined,
  change: SheetChange,
  mayRetry: boolean,
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

  // Журнал — прежний, из стора: его меняет только ответ сервера на боевой
  // снимок, по нему и узнают, что посланное дошло
  // Записям списков — `id`: без него разница ушла бы всем списком
  const next = withPatchRecordIds(withTriggerUsage(changed, storeLedger));
  const operations = buildEntityPatch(withPatchRecordIds(current), next);

  // Изменился только журнал — писать нечего
  if (operations.length === 0) {
    return null;
  }

  // Стор — сразу: следующая запись в том же тике читает уже новые разделы.
  // Разделы — по списку `SHEET_WRITE_SECTIONS`: те же подтягивают из мира
  // открытые листы; новый раздел в списке без строки здесь не соберётся
  const sections = pickSheetSections(next);

  lastWrittenSections.set(next.id, sections);

  if (isActorEntity(next)) {
    worldStore.updateActor(worldId, next.id, sections);
  } else if (isCreatureEntity(next)) {
    worldStore.updateCreature(worldId, next.id, sections);
  }

  void emitEntityPatch(socket, next.id, operations).then((outcome) =>
    settleSheetWrite(outcome, { socket, entity: next, change, mayRetry }),
  );

  return next;
}
