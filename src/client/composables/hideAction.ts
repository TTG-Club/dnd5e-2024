/**
 * Засада и поиск на столе (правила 2024): кто прячется, бросок, состояние,
 * строка в карточке броска; кто ищет, бросок, снятие засады.
 *
 * Правила — в движке (`hiding.ts`); здесь окна, чат и запись в мир. Всё зовёт
 * полка действий системы: «Спрятаться» (горящая — выйти из засады) и «Поиск»
 * за выделенную фишку. Ведущий ищет за врага так же — выделив его фишку.
 *
 * Засада существа ведущего игрокам не видна: бросок и строка — только
 * ведущему (на старом хосте без таких сообщений — уведомление на его экране).
 *
 * Запись — боевым каналом: снять засаду с чужой сущности ищущий вправе только
 * им, а снятие состояния будит на сервере срабатывания «состояние снялось».
 */

import type { Token } from '@vtt/shared';
import type {
  ActiveEffect,
  DnDSceneEntity,
  EffectActionCost,
  HideEntry,
} from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { withTokenDisposition } from '@vtt/shared';
import {
  buildHiddenEffect,
  findHiddenEffect,
  getRelativeDisposition,
  HIDE_CHECK_DC,
  HIDE_SKILL,
  isHideSuccess,
  listHideCosts,
  mergeAppliedEffects,
  pickFoundHides,
  resolveActionCostBlock,
  resolveHideSearchDc,
  SEARCH_SKILL,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  HIDE_COST_NOTES,
  HIDE_COST_OPTIONS,
  HIDE_LABELS,
} from '../ui/stealth/hideLabels';
import { recordEntityActionSpend, warnActionCostBlocked } from './actionSpend';
import { isEntityOwnTurn } from './encounterTurn';
import { changeEntityCombatState } from './entityCombatWrite';
import {
  controlsEntityAsUser,
  GM_ONLY_ROLL,
  hasPlayerOwner,
} from './gmApprovalRequest';
import { canSendGmOnlyChat } from './gmOnlyChat';
import { refuseWhilePaused } from './pauseLock';
import { chooseOne } from './questionChoice';
import { resolveClientSceneSight } from './sceneSightFacts';
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

/** Поиск — действие (правила 2024, «Поиск») */
const SEARCH_COST: EffectActionCost = 'action';

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
 * Строка «Входит в засаду» с ценой дописывается в карточку броска
 * Скрытности, как урон в карточку атаки: видимость и подпись она наследует от
 * броска, Сл поиска — итог броска — там уже есть. Броска в чате нет —
 * отдельное сообщение с Сл: у персонажа игрока для всех, у существа ведущего
 * «только для мастера», а на хосте без таких сообщений — уведомление ведущему.
 *
 * @param entity - спрятавшийся
 * @param effect - его состояние «В засаде»
 * @param cost - чем спрятался
 * @param rollMessageId - сообщение с броском Скрытности; нет — броска в чате
 *   нет, объявление отдельным сообщением
 */
function announceHide(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  cost: EffectActionCost,
  rollMessageId: string | undefined,
): void {
  const chat = useChatStore();
  const announcement = `${HIDE_LABELS.hiddenMessage}${HIDE_COST_NOTES[cost] ?? ''}`;

  if (rollMessageId && chat.appendToMessage(rollMessageId, announcement)) {
    return;
  }

  const searchDc = `${HIDE_LABELS.searchDcPrefix}${resolveHideSearchDc(effect)}`;
  const gmOnly = !hasPlayerOwner(entity);

  if (gmOnly && !canSendGmOnlyChat()) {
    useSystemToastStore().add({
      title: `${entity.name}${HIDE_LABELS.hiddenSuffix}`,
      description: searchDc,
      color: 'info',
    });

    return;
  }

  chat.sendMessage(
    `${announcement}. ${searchDc}`,
    'text',
    undefined,
    undefined,
    { speakerEntityId: entity.id, ...(gmOnly ? { gmOnly: true } : {}) },
  );
}

/**
 * Записывает исход проверки засады: трата хода, и при успехе — состояние «В
 * засаде» с Сл поиска и объявление. Провал окно броска уже показало.
 *
 * @param entityId - кто прятался
 * @param cost - чем прятался
 * @param roll - итог проверки Скрытности и сообщение с броском
 */
function settleHide(
  entityId: string,
  cost: EffectActionCost,
  roll: Pick<CheckRollResult, 'total' | 'messageId'>,
): void {
  recordEntityActionSpend(entityId, cost);

  if (!isHideSuccess(roll.total)) {
    return;
  }

  const effect = buildHiddenEffect(roll.total);

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
    announceHide(hidden, effect, cost, roll.messageId);
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
    signedByRoller: true,
    ...(hasPlayerOwner(entity) ? {} : { rollVisibility: GM_ONLY_ROLL }),
    onRoll: (result: CheckRollResult) => {
      settleHide(entity.id, cost, result);
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
      label: HIDE_COST_OPTIONS[cost],
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
 * Снимает засаду — ровно этот эффект: новая засада той же сущности остаётся.
 *
 * @param payload - кто спрятался и каким эффектом
 * @returns сущность после снятия либо `null`, если засады уже нет
 */
function removeHide(payload: HideEntry): DnDSceneEntity | null {
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
 * Жива ли засада: сущность в мире, и на ней тот же эффект. Пока открыто окно
 * поиска, засаду могли снять — атакой, выходом или чужим поиском.
 *
 * @param payload - кто спрятался и каким эффектом
 * @returns спрятавшийся либо `undefined`, если засады уже нет
 */
function findLiveHide(payload: HideEntry): DnDSceneEntity | undefined {
  const hidden = useWorldEntities().findCurrentDndEntity(payload.entityId);

  return hidden && findHiddenEffect(hidden)?.id === payload.effectId
    ? hidden
    : undefined;
}

/**
 * Записывает исход поиска: трата действия, снятие каждой найденной засады и
 * сообщение в чат. В чат идут только найденные — остальных сообщение не
 * выдаёт.
 *
 * @param searcher - кто искал
 * @param hides - засады, которые он мог заметить
 * @param total - итог проверки Внимательности
 */
function settleSearch(
  searcher: DnDSceneEntity,
  hides: readonly HideEntry[],
  total: number,
): void {
  const live = hides.filter((hide) => findLiveHide(hide) !== undefined);

  recordEntityActionSpend(searcher.id, SEARCH_COST);

  const found = pickFoundHides(total, live).flatMap((hide) => {
    const revealed = removeHide(hide);

    return revealed ? [revealed.name] : [];
  });

  useChatStore().sendMessage(
    found.length > 0
      ? `${searcher.name}${HIDE_LABELS.foundMiddle}${found.join(HIDE_LABELS.foundSeparator)}`
      : `${searcher.name}${HIDE_LABELS.nothingFoundSuffix}`,
    'text',
    undefined,
    undefined,
    { speakerEntityId: searcher.id },
  );
}

/**
 * Запреты действия, цена и окно проверки Мудрости (Внимательность). Один
 * бросок сравнивается со Сл каждой засады.
 *
 * @param searcher - кто ищет
 * @param hides - засады, которые он может заметить
 * @returns `true`, если окно проверки открыто
 */
function openSearchCheck(
  searcher: DnDSceneEntity,
  hides: readonly HideEntry[],
): boolean {
  if (
    refuseAction(searcher, HIDE_LABELS.searchTitle)
    || warnActionCostBlocked(searcher, SEARCH_COST, HIDE_LABELS.searchTitle)
  ) {
    return false;
  }

  openSkillCheckModal(searcher, SEARCH_SKILL, {
    modalKey: `${SEARCH_MODAL_KEY_PREFIX}${searcher.id}`,
    title: HIDE_LABELS.searchTitle,
    rollButtonText: HIDE_LABELS.searchRollButton,
    signedByRoller: true,
    onRoll: (result: CheckRollResult) => {
      settleSearch(searcher, hides, result.total);
    },
  });

  return true;
}

/**
 * Засады на сцене, которые ищущий может заметить: спрятавшиеся, которых он
 * видит, кроме него самого и его союзников — где прячутся свои, он знает.
 * Сторона — по фишке, без фишки — по владельцу.
 *
 * «Видит» — правило видимости сцены (`sceneSight.ts` движка): стены и
 * закрытые двери на линии взгляда, сектор и дальность зрения фишки, темнота
 * без тёмного зрения, невидимость. Фактов нет (старое ядро, у ищущего нет
 * фишки на сцене) — видимость неизвестна, и засада остаётся в списке: решает
 * ведущий, как до проверки обзора.
 *
 * @param searcher - кто ищет
 * @returns засады
 */
export function listSearchableHides(searcher: DnDSceneEntity): HideEntry[] {
  const tokens = useWorldStore().currentScene?.tokens ?? [];
  const { findCurrentDndEntity } = useWorldEntities();
  const sight = resolveClientSceneSight();
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
      || sight?.canSee(searcher, entity) === false
      ? []
      : [
          {
            entityId: entity.id,
            effectId: hidden.id,
            searchDc: resolveHideSearchDc(hidden),
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

  return openSearchCheck(searcher, listSearchableHides(searcher));
}

/**
 * Снимает засаду и пишет об этом в чат от имени спрятавшегося.
 *
 * @param payload - кто спрятался и каким эффектом
 * @param message - сообщение чата
 * @returns `true`, если засада снята
 */
function revealHide(payload: HideEntry, message: string): boolean {
  const revealed = removeHide(payload);

  if (!revealed) {
    return false;
  }

  useChatStore().sendMessage(message, 'text', undefined, undefined, {
    speakerEntityId: revealed.id,
  });

  return true;
}

/**
 * Выход из засады по своей воле — повторное нажатие горящей «Спрятаться».
 * Действия не стоит и в чужой ход доступен: выйти можно в любой момент.
 *
 * @param entity - спрятавшийся
 * @returns `true`, если засада снята
 */
export function leaveHide(entity: DnDSceneEntity): boolean {
  // Лист в режиме правки — снятие ждёт «Сохранить» или отмены
  if (refuseWhileSheetEditing(entity.id)) {
    return false;
  }

  if (refuseWhilePaused() || !controlsEntityAsUser(entity)) {
    return false;
  }

  const hidden = findHiddenEffect(entity);

  if (!hidden) {
    return false;
  }

  return revealHide(
    {
      entityId: entity.id,
      effectId: hidden.id,
      searchDc: resolveHideSearchDc(hidden),
    },
    HIDE_LABELS.leftMessage,
  );
}
