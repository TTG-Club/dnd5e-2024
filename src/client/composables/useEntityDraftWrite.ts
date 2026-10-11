/**
 * Сохранение черновика сущности частичной записью (`entity:patch`).
 *
 * Лист и быстрые панели держат черновик — копию сущности — и раньше слали его
 * целиком: `actor:updated` / `creature:updated` заменяют сущность на сервере
 * присланной копией, и всё, что сервер изменил после этой копии (урон, эффект,
 * списанный ресурс), сохранение возвращало назад. Здесь на сервер уходит
 * только разница между ОСНОВОЙ — копией, от которой считается правка, — и
 * черновиком; сервер кладёт её на свою текущую сущность.
 *
 * Основа ведётся рядом с черновиком и значит «что из черновика сервер уже
 * знает или вот-вот узнает»: её двигает каждая отправка и каждый раздел,
 * подтянутый из мира (`useWorldSheetSync`). Поэтому в разницу не попадает ни
 * уже посланное, ни пришедшее из мира. Правку, которую сервер не записал,
 * основа забывает — встаёт на сущность мира, — и несохранённое уходит со
 * следующей отправкой.
 */

import type {
  EntityPatchFailure,
  EntityPatchOutcome,
} from '@/core/entityUtils';
import type { TypedWebSocketClient } from '@vtt/shared';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import { useToast } from '@nuxt/ui/composables';

import {
  buildEntityPatchFailureToast,
  emitEntityChange,
} from '@/core/entityUtils';
import { applyEntityPatch, buildEntityPatch } from '@vtt/shared';
import {
  cloneEntityData,
  mergeEntityDraft,
  withPatchRecordIds,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { withoutEntityOwnership } from '../ui/entity-ownership/utils';

/**
 * Отказ сервера «правка не легла на текущую сущность»: запись списка успели
 * убрать либо раздела, который правили, на сервере нет
 */
export const PATCH_CONFLICT_REASON: EntityPatchFailure = 'conflict';

/** Что нужно, чтобы записать черновик */
export interface EntityDraftSaveRequest<Entity extends DnDSceneEntity> {
  /** Сокет мира */
  socket: TypedWebSocketClient;
  /** Копия, от которой считали правку */
  base: Entity;
  /** Черновик после правки */
  draft: Entity;
  /** Сущность мира сейчас; нет — пересобрать правку не из чего */
  readWorld: () => DnDSceneEntity | null | undefined;
  /** Гвард формы листа: слитое с миром обязано остаться сущностью того же вида */
  isEntity: (value: unknown) => value is Entity;
}

/**
 * Шлёт серверу разницу «основа → черновик».
 *
 * Правка, которая не легла на сущность сервера (`conflict`), пересобирается
 * один раз от свежей сущности мира: черновик сливается с миром по трём точкам
 * (`mergeEntityDraft`), и на сервер уходит разница «мир → слитое» — те же
 * правки владельца, выраженные поверх того, что есть на сервере сейчас.
 *
 * @param request - сокет, основа, черновик и доступ к сущности мира
 * @returns успех либо причина, по которой правка не записана
 */
export async function saveEntityDraft<Entity extends DnDSceneEntity>(
  request: EntityDraftSaveRequest<Entity>,
): Promise<EntityPatchOutcome> {
  const { socket } = request;

  // Счётчик, только что добавленный мастером класса или чертой, `id` ещё не
  // получил — без него разница ушла бы всем списком
  const base = withPatchRecordIds(request.base);
  const draft = withPatchRecordIds(request.draft);

  // Права лист не правит: копия идёт без них, и управляющие, назначенные
  // ведущим за время правки, из устаревшего черновика не перезаписываются
  const outcome = await emitEntityChange(
    socket,
    base,
    withoutEntityOwnership(draft),
  );

  if (outcome.ok || outcome.reason !== PATCH_CONFLICT_REASON) {
    return outcome;
  }

  const world = request.readWorld();

  if (!world) {
    return outcome;
  }

  return emitEntityChange(
    socket,
    withPatchRecordIds(world),
    withoutEntityOwnership(
      withPatchRecordIds(
        mergeEntityDraft(base, draft, world, request.isEntity),
      ),
    ),
  );
}

/**
 * Сохраняет поля окна настроек поверх сущности мира и сообщает игроку, если
 * сервер их не записал.
 *
 * Окно отдаёт часть полей, собранных от сущности мира в момент сохранения,
 * поэтому основа разницы — она же: серверу уходит только то, чем поля окна от
 * неё отличаются. Права едут, только если окно их прислало (ведущий): копия
 * сущности идёт без полей прав, и устаревшая карточка их не перезаписывает.
 *
 * @param socket - сокет мира
 * @param current - сущность мира сейчас
 * @param updates - поля из окна
 * @returns `true`, если правка записана; иначе игрок уже видит причину
 */
export async function saveEntityFields(
  socket: TypedWebSocketClient,
  current: DnDSceneEntity,
  updates: object,
): Promise<boolean> {
  const outcome = await emitEntityChange(socket, current, {
    ...withoutEntityOwnership(current),
    ...updates,
  });

  const failureToast = buildEntityPatchFailureToast(outcome, current.name);

  if (failureToast) {
    // Окно зовёт помощника уже после `setup` — уведомление идёт через стор
    useSystemToastStore().add(failureToast);
  }

  return failureToast === null;
}

/** Что связывает черновик с записью */
export interface EntityDraftWriteOptions<Entity extends DnDSceneEntity> {
  /** Черновик листа или панели */
  readDraft: () => Entity | null;
  /**
   * Сущность мира сейчас; нет — её ещё не создали (новый лист до первого
   * «Сохранить») либо уже удалили, и писать некуда
   */
  readWorld: () => Entity | null | undefined;
  /** Гвард формы листа */
  isEntity: (value: unknown) => value is Entity;
}

/**
 * Держатель основы черновика. Не реактивный: основу никто не показывает, её
 * только читают в момент отправки.
 */
export interface EntityDraftBase<Entity extends DnDSceneEntity> {
  value: Entity | null;
}

/** Основа черновика и его отправка */
export interface EntityDraftWrite<Entity extends DnDSceneEntity> {
  /**
   * Основа: то, что из черновика сервер уже знает или вот-вот узнает. Раздел,
   * подтянутый из мира в черновик, кладётся и сюда
   */
  draftBase: EntityDraftBase<Entity>;
  /** Основа := копия черновика (черновик заново взят из мира либо создан) */
  rebaseDraft: () => void;
  /**
   * Шлёт серверу несохранённое: разницу «основа → черновик».
   *
   * @param socket - сокет мира
   * @param base - своя основа вместо ведомой: снимок входа в режим правки.
   *   Пока лист в правке, синхронизация с миром стоит, и правки листа — это
   *   всё, чем черновик отличается от снимка
   */
  saveDraft: (socket: TypedWebSocketClient, base?: Entity | null) => void;
}

/**
 * Ведёт основу черновика и шлёт его правки частичной записью.
 *
 * Пара «основа → черновик» снимается в момент вызова и уходит сразу: ответ
 * сервера на прежнюю правку рассылается раньше её подтверждения и успевает
 * переписать раздел черновика, поэтому правка, отложенная до ответа, до
 * сервера уже не дошла бы. Основа при этом сразу встаёт на посланное —
 * следующая правка в том же тике шлёт только себя.
 *
 * Правку, которую сервер не записал, основа забывает: встаёт на сущность
 * мира, и всё, чем черновик от неё отличается, уйдёт со следующей отправкой.
 * Игрок видит причину отказа.
 *
 * @param options - черновик, сущность мира и гвард формы
 * @returns основа черновика, её сброс и отправка правки
 */
export function useEntityDraftWrite<Entity extends DnDSceneEntity>(
  options: EntityDraftWriteOptions<Entity>,
): EntityDraftWrite<Entity> {
  const toast = useToast();
  const draftBase: EntityDraftBase<Entity> = { value: null };

  function rebaseDraft(): void {
    const draft = options.readDraft();

    draftBase.value = draft ? cloneEntityData(draft) : null;
  }

  /**
   * Основа := сущность мира. Так основа забывает правку, которую сервер не
   * записал, и догоняет мир целиком после режима правки: за его время мир мог
   * сменить и то, что синхронизация листа не ведёт (имя, права).
   */
  function rebaseOnWorld(): void {
    const world = options.readWorld();

    if (world) {
      draftBase.value = cloneEntityData(world);
    }
  }

  /**
   * Кладёт посланную правку в основу — по одной операции: на сущность мира
   * ложится не всё (запись списка успели убрать), и то, что не легло, остаётся
   * несохранённым.
   *
   * @param sentBase - основа посланной правки
   * @param sentDraft - посланный черновик
   */
  function acceptSentChange(sentBase: Entity, sentDraft: Entity): void {
    for (const operation of buildEntityPatch(sentBase, sentDraft)) {
      const applied = draftBase.value
        ? applyEntityPatch(draftBase.value, [operation])
        : null;

      if (applied?.ok && options.isEntity(applied.value)) {
        draftBase.value = applied.value;
      }
    }
  }

  function saveDraft(socket: TypedWebSocketClient, base?: Entity | null): void {
    const draft = options.readDraft();
    const sourceBase = base ?? draftBase.value;

    // Сущности в мире нет — писать некуда: новый лист до первого «Сохранить»
    if (!options.readWorld() || !draft || !sourceBase) {
      return;
    }

    // Копии: основу правит синхронизация с миром, черновик — игрок, а
    // пересборка правки после отказа читает оба уже после ответа сервера
    const sentBase = withPatchRecordIds(cloneEntityData(sourceBase));
    const sentDraft = withPatchRecordIds(cloneEntityData(draft));

    if (base) {
      // «Сохранить» из режима правки: синхронизация с миром стояла, а лист
      // сейчас покажет черновик, слитый с миром. Основа — мир плюс правки
      rebaseOnWorld();
      acceptSentChange(sentBase, sentDraft);
    } else {
      draftBase.value = cloneEntityData(sentDraft);
    }

    void saveEntityDraft({
      socket,
      base: sentBase,
      draft: sentDraft,
      readWorld: options.readWorld,
      isEntity: options.isEntity,
    }).then((outcome) => {
      const failureToast = buildEntityPatchFailureToast(
        outcome,
        sentDraft.name,
      );

      if (failureToast) {
        rebaseOnWorld();
        toast.add(failureToast);
      }
    });
  }

  return { draftBase, rebaseDraft, saveDraft };
}
