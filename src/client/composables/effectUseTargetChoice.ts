/**
 * Выбор получателя при применении предмета или эффекта листа с доставкой «На
 * цели при применении»: «Зелье лечения» выпивают сами или вливают другому.
 * Получателя — себя или другого — выбирают щелчком по фишке на карте, пока
 * висит плашка; дальше предела касания (у
 * псевдо-заклинания применения это 5 футов) игрок применяет только с
 * разрешения ведущего, ведущий — сам.
 */

import type {
  DnDSceneEntity,
  GmApprovalVerdict,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useProjectileStore } from '@/stores/projectileStore';
import { useTargetStore } from '@/stores/targetStore';
import { useWorldStore } from '@/stores/worldStore';
import { generateId } from '@vtt/shared';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  EFFECT_USE_GM_QUESTION_PARTS,
  EFFECT_USE_GM_VERDICT_TOASTS,
  EFFECT_USE_TARGET_COUNT,
  EFFECT_USE_TARGET_LABELS,
  EFFECT_USE_TARGET_MODAL_KEY_PREFIX,
} from '../ui/effect/constants';
import { requestGmApproval } from './gmApprovalRequest';
import { checkSpellRangeOnScene } from './useSceneRangeCheck';
import { useWorldEntities } from './useWorldEntities';

/**
 * Стоит ли фишка применившего на текущей сцене: без неё расстояние мерить не
 * от чего.
 *
 * @param userId - кто применяет
 * @returns `true`, если фишка есть
 */
function hasUserToken(userId: string): boolean {
  return (
    useWorldStore().currentScene?.tokens?.some(
      (token) => token.actorId === userId,
    ) ?? false
  );
}

/**
 * Можно ли выбрать фишку получателем: любое существо, которое применивший
 * видит, и он сам — зелье выпивают так же, как вливают другому. Расстояние
 * здесь не проверяется — дальнюю фишку выбрать можно, плашка покажет, что она
 * далеко.
 *
 * @param tokenId - фишка
 * @returns `true`, если фишку можно отметить
 */
function canPickUseTarget(tokenId: string): boolean {
  const worldStore = useWorldStore();

  const token = worldStore.currentScene?.tokens?.find(
    (entry) => entry.id === tokenId,
  );

  return (
    !!token
    && (worldStore.isGM || !token.hidden)
    && !!useWorldEntities().findCurrentDndEntity(token.actorId)
  );
}

/**
 * Сущность фишки в момент подтверждения: пока висела плашка, фишку могли
 * убрать со сцены.
 *
 * @param tokenId - фишка
 * @returns сущность либо `undefined`
 */
function resolveTokenEntity(tokenId: string): DnDSceneEntity | undefined {
  const token = useWorldStore().currentScene?.tokens?.find(
    (entry) => entry.id === tokenId,
  );

  return useWorldEntities().findCurrentDndEntity(token?.actorId);
}

/**
 * Вопрос ведущему: кто, что, к кому и насколько дальше касания.
 *
 * @param spell - псевдо-заклинание применения
 * @param user - кто применяет
 * @param target - получатель
 * @param tokenId - фишка получателя: от неё меряется расстояние
 * @returns текст вопроса
 */
function formatUseGmQuestion(
  spell: Spell,
  user: DnDSceneEntity,
  target: DnDSceneEntity,
  tokenId: string,
): string {
  const parts = EFFECT_USE_GM_QUESTION_PARTS;
  const rangeCheck = checkSpellRangeOnScene(spell, user.id, tokenId);
  const request = `${user.name}${parts.wantsToApply}${spell.name}${parts.toTarget}${target.name}`;

  if (!rangeCheck) {
    return `${request}${parts.end}`;
  }

  const unit = `${parts.unitSeparator}${rangeCheck.unitLabel}`;

  const reach =
    rangeCheck.maxRange === null
      ? ''
      : `${parts.reachPrefix}${rangeCheck.maxRange}${unit}`;

  return `${request}${parts.distancePrefix}${rangeCheck.distance}${unit}${reach}${parts.end}`;
}

/**
 * Показывает просящему, почему применения не будет.
 *
 * @param verdict - итог просьбы, кроме «разрешил»
 */
function notifyGmRefusal(
  verdict: Exclude<GmApprovalVerdict, 'approved'>,
): void {
  useSystemToastStore().add({
    ...EFFECT_USE_GM_VERDICT_TOASTS[verdict],
    color: 'warning',
  });
}

/**
 * Спрашивает, кому применить эффекты «на цель», и отдаёт выбранного.
 *
 * Получателя выбирают на карте; цель, отмеченная заранее (клавиша T), уже
 * выбрана. Дальше касания игрок сперва просит ведущего, и применение идёт
 * только по его разрешению. Без фишки применившего на сцене мерить нечем —
 * тогда годится выбранная цель, как раньше.
 *
 * @param spell - псевдо-заклинание применения
 * @param user - кто применяет
 * @param proceed - продолжение с идентификатором получателя
 */
export function chooseUseTarget(
  spell: Spell,
  user: DnDSceneEntity,
  proceed: (targetId: string) => void,
): void {
  const toastStore = useSystemToastStore();
  const targetStore = useTargetStore();

  if (!hasUserToken(user.id)) {
    const target = targetStore.getTargetActor();

    if (target) {
      proceed(target.id);

      return;
    }

    toastStore.add({
      title: EFFECT_USE_TARGET_LABELS.noTargetTitle,
      description: EFFECT_USE_TARGET_LABELS.noTargetText,
      color: 'warning',
    });

    return;
  }

  const projectileStore = useProjectileStore();

  projectileStore.startTargeting(
    'distinct',
    EFFECT_USE_TARGET_COUNT,
    canPickUseTarget,
  );

  // Заранее отмеченная цель сразу попадает в выбор — если она подходит
  if (targetStore.targetTokenId) {
    projectileStore.toggleTarget(targetStore.targetTokenId, true);
  }

  /** Фишку убрали со сцены, пока выбирали или ждали ведущего */
  function notifyTargetGone(): void {
    toastStore.add({
      title: EFFECT_USE_TARGET_LABELS.movedAwayTitle,
      description: EFFECT_USE_TARGET_LABELS.movedAwayText,
      color: 'warning',
    });
  }

  /**
   * Ждёт решения ведущего и по разрешению применяет. Получатель берётся из
   * мира заново: пока ведущий думал, фишку могли убрать.
   *
   * @param tokenId - выбранная фишка
   * @param target - получатель
   */
  async function applyAfterGmApproval(
    tokenId: string,
    target: DnDSceneEntity,
  ): Promise<void> {
    const verdict = await requestGmApproval(
      {
        question: formatUseGmQuestion(spell, user, target, tokenId),
        sourceName: spell.name,
      },
      { aboutEntityId: target.id, fromEntityId: user.id },
    );

    if (verdict !== 'approved') {
      notifyGmRefusal(verdict);

      return;
    }

    const approvedTarget = resolveTokenEntity(tokenId);

    if (approvedTarget) {
      proceed(approvedTarget.id);
    } else {
      notifyTargetGone();
    }
  }

  /**
   * Берёт сущность выбранной фишки и продолжает применение — сразу или после
   * разрешения ведущего.
   *
   * @param tokenId - выбранная фишка
   * @param needsGmApproval - получатель дальше касания, а применяет не ведущий
   */
  function handleConfirm(tokenId: string, needsGmApproval: boolean): void {
    const target = resolveTokenEntity(tokenId);

    if (!target) {
      notifyTargetGone();

      return;
    }

    if (needsGmApproval) {
      void applyAfterGmApproval(tokenId, target);

      return;
    }

    proceed(target.id);
  }

  useModalManager().openModal('EffectUseTargetPromptModal', {
    _modalKey: generateId(EFFECT_USE_TARGET_MODAL_KEY_PREFIX),
    spell,
    userId: user.id,
    targetingSessionId: projectileStore.sessionId,
    onConfirm: handleConfirm,
  });
}
