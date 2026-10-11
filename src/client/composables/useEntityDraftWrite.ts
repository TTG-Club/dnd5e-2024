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
 * знает»: её двигает только правка, которую сервер записал, и раздел,
 * подтянутый из мира (`useWorldSheetSync`). Поэтому в разницу не попадает ни
 * уже записанное, ни пришедшее из мира, а несохранённое уходит со следующей
 * отправкой само.
 */

import type {
  EntityPatchFailure,
  EntityPatchFailureToast,
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
import { cloneEntityData, mergeEntityDraft } from '@vtt/shared/system/dnd.js';

import { withoutEntityOwnership } from '../ui/entity-ownership/utils';
import { copyWorldSections } from './worldSheetSections';

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
  const { socket, base, draft } = request;
  const outcome = await emitEntityChange(socket, base, draft);

  if (outcome.ok || outcome.reason !== PATCH_CONFLICT_REASON) {
    return outcome;
  }

  const world = request.readWorld();

  if (!world) {
    return outcome;
  }

  return emitEntityChange(
    socket,
    world,
    mergeEntityDraft(base, draft, world, request.isEntity),
  );
}

/**
 * Сохраняет поля окна настроек поверх сущности мира.
 *
 * Окно отдаёт часть полей, собранных от сущности мира в момент сохранения,
 * поэтому основа разницы — она же: серверу уходит только то, чем поля окна от
 * неё отличаются. Права едут, только если окно их прислало (ведущий): копия
 * сущности идёт без полей прав, и устаревшая карточка их не перезаписывает.
 *
 * @param socket - сокет мира
 * @param current - сущность мира сейчас
 * @param updates - поля из окна
 * @returns уведомление об отказе либо `null`, если правка записана
 */
export async function saveEntityFields(
  socket: TypedWebSocketClient,
  current: DnDSceneEntity,
  updates: object,
): Promise<EntityPatchFailureToast | null> {
  const outcome = await emitEntityChange(socket, current, {
    ...withoutEntityOwnership(current),
    ...updates,
  });

  return buildEntityPatchFailureToast(outcome, current.name);
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

/** Пара «основа → черновик», снятая в момент нажатия «Сохранить» */
interface FixedDraftChange<Entity extends DnDSceneEntity> {
  base: Entity;
  draft: Entity;
}

/** Основа черновика и его отправка */
export interface EntityDraftWrite<Entity extends DnDSceneEntity> {
  /**
   * Основа: то, что из черновика сервер уже знает. Раздел, подтянутый из мира
   * в черновик, кладётся и сюда
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
 * Отправки идут по очереди: следующая считает разницу уже после ответа на
 * предыдущую. Основа двигается только записанной правкой — отказ сервера её
 * не трогает, поэтому несохранённое остаётся несохранённым и уходит со
 * следующей отправкой, а игрок видит причину отказа.
 *
 * @param options - черновик, сущность мира и гвард формы
 * @returns основа черновика, её сброс и отправка правки
 */
export function useEntityDraftWrite<Entity extends DnDSceneEntity>(
  options: EntityDraftWriteOptions<Entity>,
): EntityDraftWrite<Entity> {
  const toast = useToast();
  const draftBase: EntityDraftBase<Entity> = { value: null };

  /** Очередь отправок: каждая ждёт ответа на предыдущую */
  let sendQueue: Promise<void> = Promise.resolve();

  function rebaseDraft(): void {
    const draft = options.readDraft();

    draftBase.value = draft ? cloneEntityData(draft) : null;
  }

  /**
   * Кладёт записанную сервером правку в основу — по одной операции. За время
   * отправки в основу мог прийти раздел из мира, и он уже несёт часть правки
   * (ответ сервера рассылается раньше подтверждения): операция, которая на
   * такую основу не легла, там уже учтена.
   *
   * @param sentBase - основа отправленной правки
   * @param sentDraft - отправленный черновик
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

  /**
   * Шлёт одну правку и по ответу сервера двигает основу либо сообщает отказ.
   *
   * @param socket - сокет мира
   * @param fixed - пара «основа → черновик» из режима правки; без неё шлётся
   *   несохранённое на момент отправки
   */
  async function sendChange(
    socket: TypedWebSocketClient,
    fixed: FixedDraftChange<Entity> | null,
  ): Promise<void> {
    const base = fixed?.base ?? draftBase.value;
    const draft = fixed?.draft ?? options.readDraft();

    // Сущности в мире нет — писать некуда: новый лист до первого «Сохранить»
    if (!options.readWorld() || !base || !draft) {
      return;
    }

    // Копии: основу правит синхронизация с миром, черновик — игрок, а
    // пересборка правки после отказа читает оба уже после ответа сервера
    const sentBase = cloneEntityData(base);
    const sentDraft = cloneEntityData(draft);

    const outcome = await saveEntityDraft({
      socket,
      base: sentBase,
      draft: sentDraft,
      readWorld: options.readWorld,
      isEntity: options.isEntity,
    });

    const failureToast = buildEntityPatchFailureToast(outcome, sentDraft.name);

    if (failureToast) {
      toast.add(failureToast);

      return;
    }

    acceptSentChange(sentBase, sentDraft);
  }

  function saveDraft(socket: TypedWebSocketClient, base?: Entity | null): void {
    const draft = options.readDraft();
    const world = options.readWorld();

    // Пара из режима правки снимается сейчас: сразу после «Сохранить» лист
    // сливает черновик с миром, и позже разница несла бы чужие изменения
    const fixed =
      base && draft
        ? { base: cloneEntityData(base), draft: cloneEntityData(draft) }
        : null;

    // Синхронизация с миром на время правки стояла — основа догоняет мир
    if (fixed && world && draftBase.value) {
      copyWorldSections(draftBase.value, world);
    }

    sendQueue = sendQueue.then(() => sendChange(socket, fixed));
  }

  return { draftBase, rebaseDraft, saveDraft };
}
