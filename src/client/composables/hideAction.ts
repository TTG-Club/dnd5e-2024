/**
 * Засада и поиск на столе (правила 2024): кто прячется, бросок, состояние,
 * сообщение с кнопками; кто ищет, бросок, снятие засады.
 *
 * Правила — в движке (`hiding.ts`); здесь окна, чат и запись в мир. Действия
 * не привязаны к кнопкам: «Спрятаться» зовёт полка действий системы, «Найти» и
 * «Шум» — кнопки под сообщением о засаде, и та же функция поиска встанет на
 * полку, если там появится «Поиск».
 *
 * Запись — боевым каналом: снять засаду с чужой сущности ищущий вправе только
 * им, а снятие состояния будит на сервере срабатывания «состояние снялось».
 */

import type {
  ActiveEffect,
  DnDSceneEntity,
  EffectActionCost,
  HideFollowUpPayload,
} from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import { useChatStore } from '@/stores/chatStore';
import {
  buildHiddenEffect,
  findHiddenEffect,
  HIDE_CHECK_DC,
  HIDE_FOLLOW_UP_KIND,
  HIDE_SKILL,
  isHideSuccess,
  isSearchSuccess,
  mergeAppliedEffects,
  resolveActionCostBlock,
  resolveHideCost,
  SEARCH_SKILL,
  serializeHideFollowUp,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { HIDE_LABELS } from '../ui/stealth/hideLabels';
import { recordEntityActionSpend, warnActionCostBlocked } from './actionSpend';
import { listEntitiesNear } from './effectEscapeAction';
import { isEntityOwnTurn } from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import { controlsEntityAsUser } from './gmApprovalRequest';
import { refuseWhilePaused } from './pauseLock';
import { chooseOne } from './questionChoice';
import { refuseWhileSheetEditing } from './sheetEditLock';
import { openSkillCheckModal } from './skillCheckRoll';
import { listAmbientEffects, resolveEntityStats } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/** Ключ окна проверки засады: второе нажатие второго окна не открывает */
const HIDE_MODAL_KEY_PREFIX = 'hide:';

/** Ключ окна поиска */
const SEARCH_MODAL_KEY_PREFIX = 'search:';

/** Поиск — действие (правила 2024, «Поиск») */
const SEARCH_COST: EffectActionCost = 'action';

/** Вся сцена: искать может любое существо на ней, расстояние решает ведущий */
const WHOLE_SCENE_FEET = Number.POSITIVE_INFINITY;

/**
 * Показывает, почему действие не пошло: причину не глотают — иначе кнопка
 * молча не работает.
 *
 * @param title - что не пустили
 * @param description - причина словами
 */
function warn(title: string, description: string): void {
  useSystemToastStore().add({ title, description, color: 'warning' });
}

/**
 * Останавливает действие в бою вне своего хода: засада и поиск — действия.
 *
 * @param entity - кто действует
 * @param title - что не пустили
 * @returns `true`, если действие остановлено
 */
function refuseOutsideOwnTurn(entity: DnDSceneEntity, title: string): boolean {
  if (isEntityOwnTurn(entity.id)) {
    return false;
  }

  warn(title, `${entity.name}${HIDE_LABELS.notOwnTurnSuffix}`);

  return true;
}

/**
 * Общие запреты действия: пауза, чужое существо, чужой ход. Лист в правке
 * проверяет сам вход — первой инструкцией.
 *
 * @param entity - кто действует
 * @param title - что не пустили
 * @returns `true`, если действие остановлено
 */
function refuseAction(entity: DnDSceneEntity, title: string): boolean {
  return (
    refuseWhilePaused()
    || !controlsEntityAsUser(entity)
    || refuseOutsideOwnTurn(entity, title)
  );
}

/**
 * Пишет в чат удачную засаду: сообщение от имени спрятавшегося и под ним
 * дополнение с Сл поиска, подсказкой ведущему и кнопками «Найти» и «Шум».
 *
 * @param entity - спрятавшийся
 * @param effect - его состояние «В засаде»
 * @param cost - чем спрятался
 */
function announceHide(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  cost: EffectActionCost,
): void {
  const chat = useChatStore();
  const searchDc = effect.searchDc ?? HIDE_CHECK_DC;

  const messageId = chat.sendMessage(
    `${entity.name}${HIDE_LABELS.hiddenSuffix}${cost === 'bonus' ? HIDE_LABELS.bonusActionNote : ''}`,
    'text',
    undefined,
    undefined,
    { speakerEntityId: entity.id },
  );

  if (!messageId) {
    return;
  }

  chat.appendToMessage(
    messageId,
    `${HIDE_LABELS.searchDcPrefix}${searchDc}. ${HIDE_LABELS.coverHint}`,
    'text',
    undefined,
    {
      kind: HIDE_FOLLOW_UP_KIND,
      payload: serializeHideFollowUp({
        entityId: entity.id,
        effectId: effect.id,
        searchDc,
      }),
    },
  );
}

/**
 * Записывает исход проверки засады: трата хода, и при успехе — состояние «В
 * засаде» с Сл поиска и сообщение в чат. Провал окно броска уже показало.
 *
 * @param entityId - кто прятался
 * @param cost - чем прятался
 * @param total - итог проверки Скрытности
 */
function settleHide(
  entityId: string,
  cost: EffectActionCost,
  total: number,
): void {
  recordEntityActionSpend(entityId, cost);

  if (!isHideSuccess(total)) {
    return;
  }

  const effect = buildHiddenEffect(total);

  if (!effect) {
    warn(HIDE_LABELS.title, HIDE_LABELS.noConditionDescription);

    return;
  }

  const hidden = changeEntityCombatState(entityId, (current) => ({
    ...current,
    // Новая засада заменяет прежнюю: состояние одно, Сл — последней проверки
    activeEffects: mergeAppliedEffects(current.activeEffects ?? [], [effect]),
  }));

  if (hidden) {
    announceHide(hidden, effect, cost);
  }
}

/**
 * Действие «Засада»: проверка Ловкости (Скрытность) Сл 15. Действием либо
 * бонусным действием, если умение носителя это позволяет («Хитрое действие»).
 *
 * @param entity - кто прячется
 * @returns `true`, если окно проверки открыто
 */
export function startHide(entity: DnDSceneEntity): boolean {
  // Лист в режиме правки — действие ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(entity.id)) {
    return false;
  }

  if (refuseAction(entity, HIDE_LABELS.title)) {
    return false;
  }

  const ambientEffects = listAmbientEffects(entity.id);

  const cost = resolveHideCost(
    resolveEntityStats(entity).activeFlags,
    resolveActionCostBlock(entity, 'bonus', ambientEffects) !== null,
  );

  if (warnActionCostBlocked(entity, cost, HIDE_LABELS.title)) {
    return false;
  }

  openSkillCheckModal(entity, HIDE_SKILL, {
    modalKey: `${HIDE_MODAL_KEY_PREFIX}${entity.id}`,
    title: HIDE_LABELS.title,
    rollButtonText: HIDE_LABELS.rollButton,
    targetDc: HIDE_CHECK_DC,
    onRoll: (result: CheckRollResult) => {
      settleHide(entity.id, cost, result.total);
    },
  });

  return true;
}

/**
 * Снимает засаду — ровно тот эффект, о котором сообщение: новая засада той же
 * сущности остаётся.
 *
 * @param payload - кто спрятался и каким эффектом
 * @returns сущность после снятия либо `null`, если засады уже нет
 */
function removeHide(payload: HideFollowUpPayload): DnDSceneEntity | null {
  return changeEntityCombatState(payload.entityId, (current) => {
    const effects = current.activeEffects ?? [];

    if (!effects.some((effect) => effect.id === payload.effectId)) {
      return null;
    }

    return {
      ...current,
      activeEffects: effects.filter((effect) => effect.id !== payload.effectId),
    };
  });
}

/**
 * Жива ли засада из сообщения: сущность в мире, и на ней тот же эффект.
 *
 * @param payload - кто спрятался и каким эффектом
 * @returns спрятавшийся либо `undefined`, если засады уже нет
 */
export function findLiveHide(
  payload: HideFollowUpPayload,
): DnDSceneEntity | undefined {
  const hidden = useWorldEntities().findCurrentDndEntity(payload.entityId);

  return hidden && findHiddenEffect(hidden)?.id === payload.effectId
    ? hidden
    : undefined;
}

/**
 * Действие «Поиск» против засады: Мудрость (Внимательность) ищущего против Сл
 * поиска. Успех снимает засаду и пишет в чат, кто кого нашёл; провал окно
 * броска уже показало.
 *
 * @param searcher - кто ищет
 * @param payload - кого ищут и с какой Сл
 * @returns `true`, если окно проверки открыто
 */
export function searchForHidden(
  searcher: DnDSceneEntity,
  payload: HideFollowUpPayload,
): boolean {
  // Лист ищущего или спрятавшегося в режиме правки — действие ждёт
  if (
    refuseWhileSheetEditing(searcher.id)
    || refuseWhileSheetEditing(payload.entityId)
  ) {
    return false;
  }

  const hidden = findLiveHide(payload);

  if (!hidden) {
    warn(HIDE_LABELS.searchTitle, HIDE_LABELS.goneDescription);

    return false;
  }

  if (
    refuseAction(searcher, HIDE_LABELS.searchTitle)
    || warnActionCostBlocked(searcher, SEARCH_COST, HIDE_LABELS.searchTitle)
  ) {
    return false;
  }

  openSkillCheckModal(searcher, SEARCH_SKILL, {
    modalKey: `${SEARCH_MODAL_KEY_PREFIX}${payload.effectId}:${searcher.id}`,
    title: `${HIDE_LABELS.searchTitle}: ${hidden.name}`,
    rollButtonText: HIDE_LABELS.searchRollButton,
    targetDc: payload.searchDc,
    onRoll: (result: CheckRollResult) => {
      recordEntityActionSpend(searcher.id, SEARCH_COST);

      if (!isSearchSuccess(result.total, payload.searchDc)) {
        return;
      }

      const found = removeHide(payload);

      if (found) {
        useChatStore().sendMessage(
          `${searcher.name}${HIDE_LABELS.foundMiddle}${found.name}`,
          'text',
          undefined,
          undefined,
          { speakerEntityId: searcher.id },
        );
      }
    },
  });

  return true;
}

/**
 * Кто может искать: существа текущей сцены, которыми управляет пользователь,
 * кроме самого спрятавшегося.
 *
 * Ядро не отдаёт системе выделенную фишку пользователя, поэтому ищущего
 * выбирают в плашке; единственный кандидат берётся без вопроса.
 *
 * @param hiddenId - спрятавшийся
 * @returns кандидаты
 */
function listSearchers(hiddenId: string): DnDSceneEntity[] {
  return listEntitiesNear(hiddenId, WHOLE_SCENE_FEET).filter((entity) =>
    controlsEntityAsUser(entity),
  );
}

/**
 * «Найти» под сообщением о засаде: спрашивает, кто ищет, и запускает поиск.
 *
 * @param payload - кого ищут и с какой Сл
 */
export function searchFromChat(payload: HideFollowUpPayload): void {
  const hidden = findLiveHide(payload);

  if (!hidden) {
    warn(HIDE_LABELS.searchTitle, HIDE_LABELS.goneDescription);

    return;
  }

  const searchers = listSearchers(hidden.id);

  if (searchers.length === 0) {
    warn(HIDE_LABELS.searchTitle, HIDE_LABELS.noSearcherDescription);

    return;
  }

  chooseOne(
    HIDE_LABELS.searcherQuestion,
    HIDE_LABELS.searchTitle,
    searchers.map((entity) => ({ label: entity.name, value: entity })),
    (searcher) => {
      searchForHidden(searcher, payload);
    },
  );
}

/**
 * «Шум»: спрятавшийся издал звук громче шёпота — засада снимается. Вправе
 * ведущий и тот, кто управляет спрятавшимся.
 *
 * @param payload - кто спрятался и каким эффектом
 */
export function endHideByNoise(payload: HideFollowUpPayload): void {
  // Лист спрятавшегося в режиме правки — снятие ждёт
  if (refuseWhileSheetEditing(payload.entityId)) {
    return;
  }

  const hidden = findLiveHide(payload);

  if (!hidden) {
    warn(HIDE_LABELS.title, HIDE_LABELS.goneDescription);

    return;
  }

  if (!controlsEntityAsUser(hidden)) {
    warn(HIDE_LABELS.title, HIDE_LABELS.notControlledDescription);

    return;
  }

  if (refuseWhilePaused()) {
    return;
  }

  const revealed = removeHide(payload);

  if (revealed) {
    useChatStore().sendMessage(
      `${revealed.name}${HIDE_LABELS.noiseSuffix}`,
      'text',
      undefined,
      undefined,
      { speakerEntityId: revealed.id },
    );
  }
}
