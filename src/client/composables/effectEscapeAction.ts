/**
 * Действие «вырваться» на столе: кто действует, каким навыком, бросок и исход.
 *
 * Вырываться может сам носитель, существо рядом с ним или любой из них
 * (`escape.by`). Помощник бросает СВОЙ навык со своими флагами — поэтому, когда
 * действовать могут несколько существ, сначала спрашивают «кто действует», а
 * при нескольких навыках («Атлетика или Акробатика») — «каким навыком».
 *
 * Исход уходит боевым каналом: снять эффект с чужого носителя помощник вправе
 * только им, а урон «при провале» должен разбудить события урона на сервере.
 */

import type { Token } from '@vtt/shared';
import type {
  ActiveEffect,
  DnDSceneEntity,
  EffectEscapeRole,
  EscapeCheckOption,
} from '@vtt/shared/system/dnd.js';

import type { CheckRollResult } from '../ui/actor/diceRollTypes';

import { resolveTokenScale } from '@/core/entityUtils';
import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { useWorldStore } from '@/stores/worldStore';
import { getTokenEdgeDistance } from '@vtt/shared';
import {
  applyDamagePartsToCopy,
  buildEscapeAftermath,
  canEscapeEffect,
  canHelpEscapeEffect,
  DEFAULT_REACH_FEET,
  describeEscapeUnavailable,
  escapeAllowsRole,
  formatEffectEscapeLabel,
  listEffectEscapeRemovals,
  listEscapeChecks,
  mergeAppliedEffects,
  resolveEscapeRollMode,
} from '@vtt/shared/system/dnd.js';

import { useSystemToastStore } from '../stores/systemToastStore';
import { formatSignedNumber } from '../ui/actor/utils/formatSignedNumber';
import {
  EFFECT_ESCAPE_LABELS,
  EFFECT_ESCAPE_MODAL_KEY_PREFIX,
  EFFECT_QUESTION_PROMPT_MODAL,
} from '../ui/effect/constants';
import { EFFECT_ESCAPE_PROMPT_LABELS } from '../ui/effect/escapeLabels';
import { recordEntityActionSpend } from './actionSpend';
import { changeEntityCombatState } from './entityCombatWrite';
import { controlsEntityAsUser } from './gmApprovalRequest';
import { refuseWhileSheetEditing } from './sheetEditLock';
import { openSkillCheckModal } from './skillCheckRoll';
import { resolveEntityStats } from './useResolvedStats';
import { useWorldEntities } from './useWorldEntities';

/** Кто действует, чтобы снять эффект */
export interface EscapeActor {
  /** Действующее существо */
  entity: DnDSceneEntity;
  /** Сам носитель или существо рядом с ним */
  role: EffectEscapeRole;
}

/**
 * Показывает, почему «вырваться» сейчас нельзя: причину не глотают — иначе
 * кнопка молча не работает.
 *
 * @param reason - причина словами
 */
function warnEscapeUnavailable(reason: string): void {
  useSystemToastStore().add({
    title: EFFECT_ESCAPE_LABELS.hint,
    description: `${EFFECT_ESCAPE_LABELS.unavailablePrefix}${reason}`,
    color: 'warning',
  });
}

/**
 * Существа текущей сцены в пределах футов от существа — по краям фишек, как
 * считает дистанцию атака.
 *
 * @param entityId - от кого мерить
 * @param feet - предел в футах
 * @returns существа рядом без повторов; нет сцены или фишки — пусто
 */
export function listEntitiesNear(
  entityId: string,
  feet: number,
): DnDSceneEntity[] {
  const worldStore = useWorldStore();
  const scene = worldStore.currentScene;
  const tokens: Token[] = scene?.tokens ?? [];

  if (!scene) {
    return [];
  }

  /**
   * Фишка с её настоящим масштабом на сцене.
   *
   * @param token - фишка
   * @returns фишка для измерения
   */
  const scaled = (token: Token): Token => ({
    ...token,
    scale: resolveTokenScale(worldStore.currentWorld, token),
  });

  const origins = tokens
    .filter((token) => token.actorId === entityId)
    .map(scaled);

  const nearIds = new Set(
    tokens
      .filter(
        (token) =>
          token.actorId !== entityId
          && origins.some(
            (origin) =>
              getTokenEdgeDistance(origin, scaled(token), scene.gridSettings)
              <= feet,
          ),
      )
      .map((token) => token.actorId),
  );

  const { findCurrentDndEntity } = useWorldEntities();

  return [...nearIds].flatMap((nearId) => {
    const entity = findCurrentDndEntity(nearId);

    return entity ? [entity] : [];
  });
}

/**
 * Кто может действовать, чтобы снять эффект, из тех, кем управляет текущий
 * пользователь: сам носитель и существа рядом с ним — по настройке эффекта.
 * Наложивший эффект в помощники не идёт (`canHelpEscapeEffect`).
 *
 * @param carrier - носитель эффекта
 * @param effect - эффект с блоком «вырваться»
 * @returns кандидаты: носитель — первым
 */
export function listEscapeActors(
  carrier: DnDSceneEntity,
  effect: ActiveEffect,
): EscapeActor[] {
  const { escape } = effect;

  if (!escape) {
    return [];
  }

  const self: EscapeActor[] =
    canEscapeEffect(effect, 'self') && controlsEntityAsUser(carrier)
      ? [{ entity: carrier, role: 'self' }]
      : [];

  const helpers: EscapeActor[] = canEscapeEffect(effect, 'adjacent')
    ? listEntitiesNear(carrier.id, DEFAULT_REACH_FEET)
        .filter(
          (entity) =>
            canHelpEscapeEffect(effect, entity.id)
            && controlsEntityAsUser(entity),
        )
        .map((entity) => ({ entity, role: 'adjacent' }))
    : [];

  return [...self, ...helpers];
}

/**
 * Спрашивает одно из нескольких плашкой вопроса; единственный вариант берётся
 * сразу, без вопроса. Закрытая плашка — отказ: продолжения нет.
 *
 * @param question - о чём спрашивают
 * @param sourceName - чей вопрос
 * @param options - варианты с подписями
 * @param proceed - продолжение с выбранным вариантом
 */
function chooseOne<Option>(
  question: string,
  sourceName: string,
  options: ReadonlyArray<{ label: string; value: Option }>,
  proceed: (value: Option) => void,
): void {
  const [only] = options;

  if (!only) {
    return;
  }

  if (options.length === 1) {
    proceed(only.value);

    return;
  }

  useModalManager().openModal(EFFECT_QUESTION_PROMPT_MODAL, {
    allowMultiple: true,
    question,
    options: options.map((option, index) => ({
      id: String(index),
      label: option.label,
    })),
    sourceName,
    onAnswer: (optionId: string) => {
      const chosen = options[Number(optionId)];

      if (chosen) {
        proceed(chosen.value);
      }
    },
    onCancel: () => {},
  });
}

/**
 * Записывает исход «вырваться» носителю боевым каналом: успех снимает эффект
 * (и кладёт состояние «после освобождения»), провал наносит урон «при
 * провале». Носитель перечитывается — пока бросали, лист мог измениться.
 *
 * @param carrierId - носитель
 * @param effect - эффект, из которого вырывались
 * @param succeeded - удалась ли проверка
 */
function settleEscape(
  carrierId: string,
  effect: ActiveEffect,
  succeeded: boolean,
): void {
  if (succeeded) {
    changeEntityCombatState(carrierId, (carrier) => {
      const removed = new Set(
        listEffectEscapeRemovals(effect, carrier.activeEffects ?? []),
      );

      const aftermath = buildEscapeAftermath(effect);

      const kept = (carrier.activeEffects ?? []).filter(
        (entry) => !removed.has(entry.id),
      );

      return {
        ...carrier,
        activeEffects: aftermath
          ? mergeAppliedEffects(kept, [aftermath])
          : kept,
      };
    });

    return;
  }

  const parts = effect.escape?.onFailDamage ?? [];

  if (parts.length === 0) {
    return;
  }

  let dealt = 0;

  // Урон «при провале» пишется ударами в копию: боевой снимок увезёт их на
  // сервер, и там сработают события урона. В чат идёт снятое на деле — после
  // защит цели и вместе с временными хитами
  const hurt = changeEntityCombatState(carrierId, (carrier) => {
    const result = applyDamagePartsToCopy(carrier, parts);

    dealt = result.dealt;

    return result.entity;
  });

  if (!hurt) {
    return;
  }

  useChatStore().sendMessage(
    `${effect.name}${EFFECT_ESCAPE_PROMPT_LABELS.failDamageMiddle}${hurt.name}${EFFECT_ESCAPE_PROMPT_LABELS.failDamageSuffix}${dealt}`,
    'text',
  );
}

/**
 * Бросает проверку «вырваться» выбранным навыком за действующего и записывает
 * исход носителю.
 *
 * @param carrier - носитель эффекта
 * @param effect - эффект с блоком «вырваться»
 * @param actor - кто действует
 * @param check - навык и его сложность
 */
function rollEscapeCheck(
  carrier: DnDSceneEntity,
  effect: ActiveEffect,
  actor: EscapeActor,
  check: EscapeCheckOption,
): void {
  const { entity } = actor;
  const { skill, dc } = check;

  // Флаг того, кто держит («из вашего захвата высвобождаются с помехой»),
  // читается с наложившего эффект — если он ещё в мире
  const holder = useWorldEntities().findCurrentDndEntity(effect.sourceActorId);

  openSkillCheckModal(entity, skill, {
    modalKey: `${EFFECT_ESCAPE_MODAL_KEY_PREFIX}${effect.id}`,
    title: `${formatEffectEscapeLabel(effect)}${EFFECT_ESCAPE_LABELS.titleSeparator}${entity.name}`,
    rollButtonText: EFFECT_ESCAPE_LABELS.rollButton,
    targetDc: dc,
    resolveMode: (checkMode, flags) =>
      resolveEscapeRollMode({
        checkMode,
        effect,
        flags,
        ...(holder
          ? { holderFlags: resolveEntityStats(holder).activeFlags }
          : {}),
      }),
    onRoll: (result: CheckRollResult) => {
      settleEscape(carrier.id, effect, result.total >= dc);
    },
  });
}

/**
 * Запускает действие «вырваться» за выбранное существо: запрет цены, трата
 * хода, выбор навыка и бросок. Действие без проверки снимает эффект сразу.
 *
 * @param carrier - носитель эффекта
 * @param effect - эффект с блоком «вырваться»
 * @param actor - кто действует
 * @returns `true`, если действие пошло
 */
export function runEscapeAs(
  carrier: DnDSceneEntity,
  effect: ActiveEffect,
  actor: EscapeActor,
): boolean {
  const { escape } = effect;

  if (!escape || !escapeAllowsRole(escape, actor.role)) {
    return false;
  }

  // Лист носителя или действующего в режиме правки — действие ждёт
  // «Сохранить» или отмены
  if (
    refuseWhileSheetEditing(carrier.id)
    || refuseWhileSheetEditing(actor.entity.id)
  ) {
    return false;
  }

  // Причину отказа показывают, а не глотают: иначе кнопка молча не работает
  const unavailable = describeEscapeUnavailable(effect, actor.entity);

  if (unavailable !== null) {
    warnEscapeUnavailable(unavailable);

    return false;
  }

  if (!escape.check) {
    // «Замедление»: вырваться действием — значит бонусного в этот ход уже нет
    recordEntityActionSpend(actor.entity.id, escape.cost);
    settleEscape(carrier.id, effect, true);

    return true;
  }

  const stats = resolveEntityStats(actor.entity);

  chooseOne(
    EFFECT_ESCAPE_PROMPT_LABELS.skillQuestion,
    effect.name,
    listEscapeChecks(escape, actor.role).map((check) => ({
      label: `${check.label}${EFFECT_ESCAPE_PROMPT_LABELS.modifierPrefix}${formatSignedNumber(stats.skills[check.skill])}${EFFECT_ESCAPE_PROMPT_LABELS.modifierSuffix}`,
      value: check,
    })),
    (check) => {
      recordEntityActionSpend(actor.entity.id, escape.cost);
      rollEscapeCheck(carrier, effect, actor, check);
    },
  );

  return true;
}

/**
 * Кнопка «вырваться» у эффекта носителя: если действовать могут несколько
 * существ, которыми управляет пользователь, — сначала вопрос «кто действует».
 *
 * @param carrierId - носитель эффекта
 * @param effectId - эффект с блоком «вырваться»
 * @returns `true`, если действие пошло или задан вопрос
 */
export function runEffectEscape(carrierId: string, effectId: string): boolean {
  // Лист носителя в режиме правки — до вопроса «кто действует»
  if (refuseWhileSheetEditing(carrierId)) {
    return false;
  }

  const carrier = useWorldEntities().findCurrentDndEntity(carrierId);
  const effect = carrier?.activeEffects?.find((entry) => entry.id === effectId);

  if (!carrier || !effect?.escape) {
    return false;
  }

  const actors = listEscapeActors(carrier, effect);

  if (actors.length === 0) {
    const reason =
      describeEscapeUnavailable(effect)
      ?? (escapeAllowsRole(effect.escape, 'self')
        ? EFFECT_ESCAPE_PROMPT_LABELS.noActor
        : EFFECT_ESCAPE_PROMPT_LABELS.noHelper);

    warnEscapeUnavailable(reason);

    return false;
  }

  chooseOne(
    EFFECT_ESCAPE_PROMPT_LABELS.actorQuestion,
    effect.name,
    actors.map((actor) => ({
      label:
        actor.role === 'self'
          ? `${actor.entity.name}${EFFECT_ESCAPE_PROMPT_LABELS.selfSuffix}`
          : `${actor.entity.name}${EFFECT_ESCAPE_PROMPT_LABELS.helperSuffix}`,
      value: actor,
    })),
    (actor) => {
      runEscapeAs(carrier, effect, actor);
    },
  );

  return true;
}

/** Эффект соседа, из которого существо может помочь вырваться */
export interface EscapeHelpOffer {
  /** Носитель эффекта */
  carrier: DnDSceneEntity;
  /** Эффект с блоком «вырваться» */
  effect: ActiveEffect;
  /** Подпись кнопки: «Гримли — Вырваться: Атлетика Сл 10» */
  label: string;
}

/**
 * Чем существо может помочь тем, кто рядом: эффекты соседей, из которых
 * вправе вырывать «существо рядом». Так помощник действует со своего листа, не
 * открывая чужой. Эффекты, которые существо наложило само, не предлагаются.
 *
 * @param helperId - помощник
 * @returns предложения помощи; нет сцены или соседей — пусто
 */
export function listEscapeHelpOffers(helperId: string): EscapeHelpOffer[] {
  return listEntitiesNear(helperId, DEFAULT_REACH_FEET).flatMap((carrier) =>
    (carrier.activeEffects ?? [])
      .filter((effect) => canHelpEscapeEffect(effect, helperId))
      .map((effect) => ({
        carrier,
        effect,
        label: `${carrier.name}${EFFECT_ESCAPE_LABELS.titleSeparator}${formatEffectEscapeLabel(effect)}`,
      })),
  );
}
