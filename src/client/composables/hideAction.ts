/**
 * Засада и поиск на столе (правила 2024): кто прячется, бросок, состояние,
 * сообщение с кнопками; кто ищет, бросок, снятие засады.
 *
 * Правила — в движке (`hiding.ts`); здесь окна, чат и запись в мир. Действия
 * не привязаны к кнопкам: «Спрятаться» и «Поиск» зовёт полка действий системы,
 * «Найти» и «Шум» — кнопки под сообщением о засаде персонажа игрока.
 *
 * Засада существа ведущего игрокам не видна: бросок и сообщение — только
 * ведущему (на старом хосте без таких сообщений — уведомление на его экране),
 * кнопки «Найти» и «Шум» под ним видит только он; игроки ищут «Поиском».
 *
 * Запись — боевым каналом: снять засаду с чужой сущности ищущий вправе только
 * им, а снятие состояния будит на сервере срабатывания «состояние снялось».
 */

import type { Token } from '@vtt/shared';
import type {
  ActiveEffect,
  DnDSceneEntity,
  EffectActionCost,
  HideFollowUpPayload,
} from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { getEntityOwnerIds, withTokenDisposition } from '@vtt/shared';
import {
  buildHiddenEffect,
  findHiddenEffect,
  getRelativeDisposition,
  HIDE_CHECK_DC,
  HIDE_FOLLOW_UP_KIND,
  HIDE_SKILL,
  isHideSuccess,
  listHideCosts,
  mergeAppliedEffects,
  pickFoundHides,
  resolveActionCostBlock,
  SEARCH_SKILL,
  serializeHideFollowUp,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  HIDE_COST_NOTES,
  HIDE_COST_OPTIONS,
  HIDE_LABELS,
} from '../ui/stealth/hideLabels';
import { recordEntityActionSpend, warnActionCostBlocked } from './actionSpend';
import { listEntitiesNear } from './effectEscapeAction';
import { isEntityOwnTurn } from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import { controlsEntityAsUser, isGameMasterUser } from './gmApprovalRequest';
import { canSendGmOnlyChat } from './gmOnlyChat';
import { refuseWhilePaused } from './pauseLock';
import { chooseOne } from './questionChoice';
import { refuseWhileSheetEditing } from './sheetEditLock';
import { openSkillCheckModal } from './skillCheckRoll';
import { listAmbientEffects, resolveEntityStats } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/** Ключ окна проверки засады: второе нажатие второго окна не открывает */
const HIDE_MODAL_KEY_PREFIX = 'hide:';

/** Ключ плашки «действием или бонусным действием»: второе нажатие — та же */
const HIDE_COST_MODAL_KEY_PREFIX = 'hide-cost:';

/** Ключ окна поиска */
const SEARCH_MODAL_KEY_PREFIX = 'search:';

/** Бросок, который видит только ведущий: засада его существа */
const GM_ONLY_ROLL = 'gm';

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
 * Есть ли у сущности владелец-игрок: персонаж игрока, а не существо ведущего.
 *
 * @param entity - сущность
 * @returns `true`, если среди владельцев есть не ведущий
 */
export function hasPlayerOwner(entity: DnDSceneEntity): boolean {
  return getEntityOwnerIds(entity).some((userId) => !isGameMasterUser(userId));
}

/**
 * Ведущий ли текущий пользователь.
 *
 * @returns `true` у ведущего
 */
function isCurrentUserGameMaster(): boolean {
  const userId = useWorldStore().connectionState.loggedAsUserId;

  return Boolean(userId) && isGameMasterUser(userId ?? '');
}

/**
 * Сторона сущности: отношение её фишки на сцене. Без фишки — отношение
 * фишки-образца, а без него — по владельцу: персонаж игрока на стороне
 * игроков, существо ведущего — против них. Иначе ищущий без фишки считался бы
 * нейтральным и находил бы засады своих.
 *
 * @param entity - сущность
 * @param tokens - фишки сцены
 * @returns отношение для сравнения сторон
 */
function resolveEntitySide(
  entity: DnDSceneEntity,
  tokens: readonly Token[],
): Pick<Token, 'disposition'> {
  const token = tokens.find((entry) => entry.actorId === entity.id);

  if (token) {
    return { disposition: withTokenDisposition(token, entity).disposition };
  }

  return {
    disposition:
      entity.token?.disposition
      ?? (hasPlayerOwner(entity) ? 'friendly' : 'hostile'),
  };
}

/**
 * Союзники ли две сущности по отношению их сторон.
 *
 * @param left - первая сущность
 * @param right - вторая сущность
 * @param tokens - фишки сцены
 * @returns `true`, если они на одной стороне
 */
function areAllies(
  left: DnDSceneEntity,
  right: DnDSceneEntity,
  tokens: readonly Token[],
): boolean {
  return (
    getRelativeDisposition(
      resolveEntitySide(left, tokens),
      resolveEntitySide(right, tokens),
    ) === 'ally'
  );
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
 * Объявляет удачную засаду — одна точка на все виды объявления.
 *
 * Персонаж игрока: сообщение от его имени и под ним дополнение с Сл поиска,
 * подсказкой ведущему и кнопками «Найти» и «Шум». Существо ведущего: то же
 * сообщение «только для мастера» — игроки его не получают, кнопки под ним
 * видит только ведущий. Хост такого сообщения не умеет — в чат ничего, ни «в
 * засаде», ни Сл: ведущему уведомление на его экране.
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
  const searchDc = effect.searchDc ?? HIDE_CHECK_DC;
  const gmOnly = !hasPlayerOwner(entity);

  if (gmOnly && !canSendGmOnlyChat()) {
    useSystemToastStore().add({
      title: `${entity.name}${HIDE_LABELS.hiddenSuffix}`,
      description: `${HIDE_LABELS.searchDcPrefix}${searchDc}`,
      color: 'info',
    });

    return;
  }

  const chat = useChatStore();

  const messageId = chat.sendMessage(
    `${entity.name}${HIDE_LABELS.hiddenSuffix}${HIDE_COST_NOTES[cost] ?? ''}`,
    'text',
    undefined,
    undefined,
    { speakerEntityId: entity.id, ...(gmOnly ? { gmOnly: true } : {}) },
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
 * засаде» с Сл поиска и объявление. Провал окно броска уже показало.
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
 * Открывает проверку засады выбранной ценой. Бросок существа ведущего виден
 * только ведущему.
 *
 * @param entity - кто прячется
 * @param cost - чем прячется
 */
function rollHide(entity: DnDSceneEntity, cost: EffectActionCost): void {
  if (warnActionCostBlocked(entity, cost, HIDE_LABELS.title)) {
    return;
  }

  openSkillCheckModal(entity, HIDE_SKILL, {
    modalKey: `${HIDE_MODAL_KEY_PREFIX}${entity.id}`,
    title: HIDE_LABELS.title,
    rollButtonText: HIDE_LABELS.rollButton,
    targetDc: HIDE_CHECK_DC,
    ...(hasPlayerOwner(entity) ? {} : { rollVisibility: GM_ONLY_ROLL }),
    onRoll: (result: CheckRollResult) => {
      settleHide(entity.id, cost, result.total);
    },
  });
}

/**
 * Действие «Засада»: проверка Ловкости (Скрытность) Сл 15. Действием либо —
 * если умение носителя это позволяет («Хитрое действие») — бонусным
 * действием: тогда цену выбирает игрок, бонусное может быть нужно на другое.
 *
 * @param entity - кто прячется
 * @returns `true`, если засада пошла (окно или вопрос о цене открыты)
 */
export function startHide(entity: DnDSceneEntity): boolean {
  // Лист в режиме правки — действие ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(entity.id)) {
    return false;
  }

  if (refuseAction(entity, HIDE_LABELS.title)) {
    return false;
  }

  const costs = listHideCosts(
    resolveEntityStats(entity).activeFlags,
    resolveActionCostBlock(entity, 'bonus', listAmbientEffects(entity.id))
      !== null,
  );

  chooseOne(
    HIDE_LABELS.costQuestion,
    HIDE_LABELS.title,
    costs.map((cost) => ({
      label: HIDE_COST_OPTIONS[cost] ?? cost,
      value: cost,
    })),
    (cost) => {
      rollHide(entity, cost);
    },
    `${HIDE_COST_MODAL_KEY_PREFIX}${entity.id}`,
  );

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
 * Записывает исход поиска: трата действия, снятие каждой найденной засады и
 * сообщение в чат. В чат идут только найденные — остальных сообщение не
 * выдаёт; укрытие и линию зрения ведущий проверяет сам.
 *
 * Поиск против одной засады («Найти»), которой к броску уже нет (нашли, шум,
 * атака), действия не тратит: искать было некого — об этом и сообщение.
 *
 * @param searcher - кто искал
 * @param hides - засады, которые он мог заметить
 * @param total - итог проверки Внимательности
 * @param targeted - поиск против одной известной засады
 */
function settleSearch(
  searcher: DnDSceneEntity,
  hides: readonly HideFollowUpPayload[],
  total: number,
  targeted: boolean,
): void {
  const live = hides.filter((hide) => findLiveHide(hide) !== undefined);

  if (targeted && live.length === 0) {
    warn(HIDE_LABELS.searchTitle, HIDE_LABELS.goneDescription);

    return;
  }

  recordEntityActionSpend(searcher.id, SEARCH_COST);

  const found = pickFoundHides(total, live).flatMap((hide) => {
    const revealed = removeHide(hide);

    return revealed ? [revealed.name] : [];
  });

  useChatStore().sendMessage(
    found.length > 0
      ? `${searcher.name}${HIDE_LABELS.foundMiddle}${found.join(HIDE_LABELS.foundSeparator)}. ${HIDE_LABELS.searchHint}`
      : `${searcher.name}${HIDE_LABELS.nothingFoundSuffix}`,
    'text',
    undefined,
    undefined,
    { speakerEntityId: searcher.id },
  );
}

/**
 * Общий путь поиска для полки и чата: запреты действия, цена и окно проверки
 * Мудрости (Внимательность). Один бросок сравнивается со Сл каждой засады.
 *
 * @param searcher - кто ищет
 * @param hides - засады, которые он может заметить
 * @param check - заголовок окна и Сл, если засада одна и известна
 * @param check.title - заголовок окна
 * @param check.targetDc - Сл для окна; нет — окно Сл не показывает
 * @returns `true`, если окно проверки открыто
 */
function openSearchCheck(
  searcher: DnDSceneEntity,
  hides: readonly HideFollowUpPayload[],
  check: { title: string; targetDc?: number },
): boolean {
  if (
    refuseAction(searcher, HIDE_LABELS.searchTitle)
    || warnActionCostBlocked(searcher, SEARCH_COST, HIDE_LABELS.searchTitle)
  ) {
    return false;
  }

  openSkillCheckModal(searcher, SEARCH_SKILL, {
    modalKey: `${SEARCH_MODAL_KEY_PREFIX}${searcher.id}`,
    title: check.title,
    rollButtonText: HIDE_LABELS.searchRollButton,
    ...(check.targetDc === undefined ? {} : { targetDc: check.targetDc }),
    onRoll: (result: CheckRollResult) => {
      settleSearch(searcher, hides, result.total, check.targetDc !== undefined);
    },
  });

  return true;
}

/**
 * Поиск против одной засады — «Найти» под сообщением о ней (руками ведущего):
 * Сл известна, окно её показывает.
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

  return openSearchCheck(searcher, [payload], {
    title: `${HIDE_LABELS.searchTitle}: ${hidden.name}`,
    targetDc: payload.searchDc,
  });
}

/**
 * Засады на сцене, которые ищущий может заметить: все спрятавшиеся, кроме него
 * самого и его союзников — где прячутся свои, он знает. Сторона — по фишке,
 * без фишки — по владельцу. Линию зрения и укрытие система не проверяет.
 *
 * @param searcher - кто ищет
 * @returns засады
 */
export function listSearchableHides(
  searcher: DnDSceneEntity,
): HideFollowUpPayload[] {
  const tokens = useWorldStore().currentScene?.tokens ?? [];
  const { findCurrentDndEntity } = useWorldEntities();
  const seen = new Set<string>();

  return tokens.flatMap((token) => {
    const entity = findCurrentDndEntity(token.actorId);
    const hidden = entity ? findHiddenEffect(entity) : undefined;

    if (
      !entity
      || !hidden
      || entity.id === searcher.id
      || seen.has(entity.id)
    ) {
      return [];
    }

    seen.add(entity.id);

    return areAllies(searcher, entity, tokens)
      ? []
      : [
          {
            entityId: entity.id,
            effectId: hidden.id,
            searchDc: hidden.searchDc ?? HIDE_CHECK_DC,
          },
        ];
  });
}

/**
 * Действие «Поиск» (правила 2024) — кнопка полки: ищет выделенная фишка.
 * Мудрость (Внимательность) против Сл каждой засады, которую ищущий может
 * заметить; находит все перебитые. Окно Сл не показывает: сколько засад и
 * какие у них Сл, ищущий не знает. Бросок есть и тогда, когда прятаться
 * некому, — иначе кнопка выдавала бы, что засад нет.
 *
 * @param searcher - кто ищет
 * @returns `true`, если окно проверки открыто
 */
export function startSearch(searcher: DnDSceneEntity): boolean {
  // Лист ищущего в режиме правки — действие ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(searcher.id)) {
    return false;
  }

  return openSearchCheck(searcher, listSearchableHides(searcher), {
    title: HIDE_LABELS.searchTitle,
  });
}

/**
 * Кто может искать: существа текущей сцены, которыми управляет пользователь,
 * кроме самого спрятавшегося и его союзников — свои знают, где он.
 *
 * Ядро не отдаёт системе выделенную фишку пользователя, поэтому ищущего
 * выбирают в плашке; единственный кандидат берётся без вопроса.
 *
 * @param hidden - спрятавшийся
 * @returns кандидаты
 */
export function listSearchers(hidden: DnDSceneEntity): DnDSceneEntity[] {
  const tokens = useWorldStore().currentScene?.tokens ?? [];

  return listEntitiesNear(hidden.id, WHOLE_SCENE_FEET).filter(
    (entity) =>
      controlsEntityAsUser(entity) && !areAllies(entity, hidden, tokens),
  );
}

/**
 * «Найти» под сообщением о засаде: только ведущий — враги ищут спрятавшегося
 * персонажа его руками. Спрашивает, кто ищет, и запускает поиск.
 *
 * @param payload - кого ищут и с какой Сл
 */
export function searchFromChat(payload: HideFollowUpPayload): void {
  // Кнопку ядро и так показывает только ведущему, но показ не защищает:
  // отказывает сам обработчик
  if (!isCurrentUserGameMaster()) {
    warn(HIDE_LABELS.searchTitle, HIDE_LABELS.gmOnlyDescription);

    return;
  }

  const hidden = findLiveHide(payload);

  if (!hidden) {
    warn(HIDE_LABELS.searchTitle, HIDE_LABELS.goneDescription);

    return;
  }

  const searchers = listSearchers(hidden);

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
 * ведущий и тот, кто управляет спрятавшимся (автор сообщения о засаде).
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
