/**
 * События урона у срабатываний эффектов: «получил урон» (`damageTaken`) и
 * «хиты упали до 0» (`hpZero`).
 *
 * Урон приходит двумя путями. Клиент наносит его атакой или заклинанием и шлёт
 * боевой снимок — в снимке едут удары (`DndCombatState.damage`), записанные в
 * копию сущности при применении урона (`recordDamageHit`). Сервер наносит его
 * сам: урон на ходу, вход в зону, ответ игрока. В обоих случаях события
 * прогоняет одна функция — `settleDamageEvents`.
 *
 * Урон, нанесённый самими событиями урона (ответный огонь, спасбросок против
 * урона), новых событий не порождает: иначе два «ответных» эффекта били бы друг
 * друга без конца.
 */

import type { ServerRollRequester } from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DamageHit } from './damageHits.js';
import type {
  DeferredEffectApply,
  DeferredEffectOutcome,
  EngineDeferredTrigger,
} from './deferredEffectSaves.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { EffectTriggerSource } from './effectTriggerRunner.js';
import type {
  EffectTrigger,
  EffectTriggerArea,
  EffectTriggerAttackRole,
  EffectTriggerEvent,
} from './effectTriggerTypes.js';
import type { SceneOffset } from './forcedMovement.js';
import type { TriggerEventData } from './triggerConditions.js';
import type {
  EffectSaveSpec,
  EntryEffectOptions,
  EntryEffectResult,
  SceneMoveOptions,
  TurnDamageOutcome,
  TurnHealingOutcome,
  TurnSaveOutcome,
} from './turnEffects.js';

import { withTokenDisposition } from '@vtt/shared';

import { isEffectDormant, listLiveEffects } from './activeEffectTypes.js';
import { getRelativeDisposition } from './auraMath.js';
import {
  formatEffectNotes,
  ignoreRejectedRollRequest,
  requestTriggerAsk,
  requestTriggerChoice,
  snapshotTriggerSource,
  toDeferredEffectOutcome,
  unchangedOutcome,
} from './deferredEffectSaves.js';
import { settleUnaskedTriggerPay } from './effectPay.js';
import { listEquippedItemEffects, listTraitEffects } from './effectPipeline.js';
import {
  buildEffectSaveRollRequest,
  formatEffectRequesterLabel,
  settleEffectSaveOutcome,
  shouldRequestEffectSave,
} from './effectSaveAcquisition.js';
import { bindTriggerSourceSaveDcs } from './effectSaveDcOwner.js';
import {
  admitTrigger,
  buildTriggerSaveSpec,
  buildTriggerSources,
  EFFECT_TRIGGER_SOURCE_KINDS,
  listAttackRollSources,
  listCarrierEventSources,
  rollTriggerSave,
  settleTriggerOutcome,
  toTriggerSaveOutcome,
  triggerSaveNeedsRoll,
} from './effectTriggerRunner.js';
import { listEffectEventTriggers } from './effectTriggers.js';
import {
  CHOICE_TRIGGER_RECIPIENT,
  DEFAULT_TRIGGER_RECIPIENT,
  isServerActiveAction,
  MAX_TRIGGER_PATH_REPEATS,
  SOURCE_TRIGGER_RECIPIENT,
  triggerAsksPermission,
} from './effectTriggerTypes.js';
import { findSceneToken } from './forcedMovement.js';
import {
  DAMAGE_TYPE_TOKEN_PREFIX,
  EVENT_DAMAGE_TYPE_TOKEN,
} from './formulaTokens.js';
import { resolveEntityCurrentHp } from './hitPoints.js';
import { listChoiceCandidates } from './triggerChoice.js';
import { withCombatRound } from './triggerConditions.js';
import { mapTriggerDamageParts } from './triggerDamageParts.js';

/** С чем прогоняются срабатывания событий с другой стороной */
export interface TriggerEventOptions extends SceneMoveOptions {
  /** Запрос броска от ядра: спасбросок сущности без авто-спасбросков — игроку */
  requestRoll?: ServerRollRequester;
  /** Ауры чужих токенов, накрывающие субъекта */
  ambientEffects?: readonly ActiveEffect[];
  /** Субъект в бою: лимит «раз в ход / раунд» считается только в бою */
  inCombat?: boolean;
  /** Чей сейчас ход: срок наложенного */
  activeTurnActorId?: string | null;
  /** Номер идущего раунда: расписание «на раунде N» (ядро, VTTG 0.9.533+) */
  combatRound?: number;
  /** Живая сущность мира по id: другая сторона — кто нанёс урон */
  getEntity?: (entityId: string) => DnDSceneEntity | undefined;
  /** Закончить каст эффекта: провал концентрации */
  endCast?: (effect: ActiveEffect) => void;
  /** Живые сущности в радиусе от субъекта: получатели «всем в радиусе» */
  listEntitiesInArea?: (
    subject: DnDSceneEntity,
    area: EffectTriggerArea,
  ) => DnDSceneEntity[];
}

/** С чем прогоняются события урона */
export interface DamageEventsOptions extends TriggerEventOptions {
  /** Хиты субъекта до урона: «хиты упали до 0» — только если они были */
  hpBefore: number;
  /**
   * Эффекты, наложенные тем же снимком, что и урон: «Сон» не просыпается от
   * урона заклинания, которое его наложило.
   */
  newEffectIds?: ReadonlySet<string>;
}

/** Изменения одной сущности от событий урона */
export interface DamageEventsEntityOutcome {
  entity: DnDSceneEntity;
  changed: boolean;
  damageOutcomes: TurnDamageOutcome[];
  healingOutcomes: TurnHealingOutcome[];
  saveOutcomes: TurnSaveOutcome[];
  /** Строки «сообщить» от эффектов этой стороны */
  notes: string[];
}

/** Итог событий урона */
export interface DamageEventsResult {
  /** Субъект изменён: урон, наложение, снятие или счётчик лимита */
  changed: boolean;
  damageOutcomes: TurnDamageOutcome[];
  healingOutcomes: TurnHealingOutcome[];
  saveOutcomes: TurnSaveOutcome[];
  /** Спасброски, которые спросили у игроков */
  deferred: EngineDeferredTrigger[];
  /** Другие стороны, которым достались действия («урон тому, кто ударил») */
  related: DamageEventsEntityOutcome[];
  /** Строки сводки от действий «сообщить» и перехода на следующую ступень */
  notes: string[];
}

/**
 * Пустой итог событий урона.
 *
 * @returns итог без изменений
 */
function createDamageEventsResult(): DamageEventsResult {
  return {
    changed: false,
    damageOutcomes: [],
    healingOutcomes: [],
    saveOutcomes: [],
    deferred: [],
    related: [],
    notes: [],
  };
}

/**
 * Срабатывания эффектов субъекта на событие урона: эффекты на нём самом,
 * работающих предметов, черт существа и аур «пока внутри».
 *
 * @param entity - субъект
 * @param event - событие урона
 * @param ambientEffects - ауры чужих токенов
 * @param newEffectIds - эффекты, наложенные тем же уроном: они его не слышат
 * @returns срабатывания с источником
 */
function listDamageEventSources(
  entity: DnDSceneEntity,
  event: EffectTriggerEvent,
  ambientEffects: readonly ActiveEffect[],
  newEffectIds: ReadonlySet<string> | undefined,
): EffectTriggerSource[] {
  const eventTriggersOf = (effect: ActiveEffect): EffectTrigger[] =>
    listEffectEventTriggers(effect, event);

  // Своя аура без «действует и на носителя» слышит урон других, а не носителя
  const own = (entity.activeEffects ?? []).filter(
    (effect) =>
      !isEffectDormant(effect)
      && !(effect.aura && !effect.aura.applyToSelf)
      && !(newEffectIds?.has(effect.id) ?? false),
  );

  const ambient = ambientEffects.filter(
    (effect) =>
      !isEffectDormant(effect) && (effect.areaTrigger ?? 'stay') === 'stay',
  );

  return [
    ...buildTriggerSources(
      own,
      EFFECT_TRIGGER_SOURCE_KINDS.instance,
      eventTriggersOf,
      entity,
    ),
    ...buildTriggerSources(
      listEquippedItemEffects(entity),
      EFFECT_TRIGGER_SOURCE_KINDS.item,
      eventTriggersOf,
      entity,
    ),
    ...buildTriggerSources(
      listTraitEffects(entity),
      EFFECT_TRIGGER_SOURCE_KINDS.trait,
      eventTriggersOf,
      entity,
    ),
    ...buildTriggerSources(
      ambient,
      EFFECT_TRIGGER_SOURCE_KINDS.aura,
      eventTriggersOf,
    ),
  ];
}

/**
 * Возвращает ли срабатывание хиты: «вместо 0 хитов — 1 хит».
 *
 * @param trigger - срабатывание
 * @returns `true`, если среди действий есть «хиты становятся»
 */
function restoresHitPoints(trigger: EffectTrigger): boolean {
  return trigger.actions.some((action) => action.type === 'setHp');
}

/**
 * Записывает исход срабатывания в итог сущности.
 *
 * @param outcome - итог сущности
 * @param settled - исход срабатывания
 */
function recordSettled(
  outcome: Omit<DamageEventsEntityOutcome, 'entity'>,
  settled: EntryEffectResult,
): void {
  if (settled.damageOutcome) {
    outcome.damageOutcomes.push(settled.damageOutcome);
  }

  if (settled.healingOutcome) {
    outcome.healingOutcomes.push(settled.healingOutcome);
  }

  if (settled.saveOutcome) {
    outcome.saveOutcomes.push(settled.saveOutcome);
  }

  if (settled.damageOutcome || settled.statusApplied) {
    outcome.changed = true;
  }
}

/**
 * Итог другой стороны в общем итоге: создаётся при первом касании.
 *
 * @param result - общий итог
 * @param entity - другая сторона
 * @returns её итог
 */
function relatedOutcomeOf(
  result: DamageEventsResult,
  entity: DnDSceneEntity,
): DamageEventsEntityOutcome {
  const existing = result.related.find((related) => related.entity === entity);

  if (existing) {
    return existing;
  }

  const created: DamageEventsEntityOutcome = {
    entity,
    changed: false,
    damageOutcomes: [],
    healingOutcomes: [],
    saveOutcomes: [],
    notes: [],
  };

  result.related.push(created);

  return created;
}

/** Продолжение серии после ответа игрока — на живой сущности */
type DamageEventsContinuation = (
  entity: DnDSceneEntity,
) => DamageEventsResult | null;

/**
 * Добавляет итог продолжения к исходу ответа игрока.
 *
 * @param outcome - исход ответа
 * @param continued - итог продолжения
 * @returns общий исход
 */
function withContinuation(
  outcome: DeferredEffectOutcome,
  continued: DamageEventsResult | null,
): DeferredEffectOutcome {
  if (!continued) {
    return outcome;
  }

  return {
    changed: outcome.changed || continued.changed,
    damageOutcomes: [...outcome.damageOutcomes, ...continued.damageOutcomes],
    healingOutcomes: [...outcome.healingOutcomes, ...continued.healingOutcomes],
    saveOutcomes: [...outcome.saveOutcomes, ...continued.saveOutcomes],
    notes: [...outcome.notes, ...continued.notes],
    deferred: [...(outcome.deferred ?? []), ...continued.deferred],
  };
}

/**
 * Спасбросок события урона, который бросает игрок. Исход применяется к живому
 * получателю; снятие эффекта — только если получатель и есть субъект.
 *
 * @param recipient - кто бросает
 * @param source - срабатывание с источником
 * @param spec - спасбросок с Сл события
 * @param requestRoll - запрос броска от ядра
 * @param effectOptions - откуда наложения и чей ход
 * @param continuation - что делать после ответа («0 хитов» у остальных)
 * @returns отложенное срабатывание
 */
function requestDamageEventSave(
  recipient: DnDSceneEntity,
  source: EffectTriggerSource,
  spec: EffectSaveSpec,
  requestRoll: ServerRollRequester,
  effectOptions: EntryEffectOptions,
  continuation?: DamageEventsContinuation,
): EngineDeferredTrigger {
  const snapshot = snapshotTriggerSource(source);

  const resolution = requestRoll(
    buildEffectSaveRollRequest(
      recipient,
      spec,
      formatEffectRequesterLabel(source.effect.name),
    ),
  ).then(
    (outcome): DeferredEffectApply =>
      (liveEntity) => {
        const acquisition = settleEffectSaveOutcome(liveEntity, spec, outcome);
        const notes = formatEffectNotes(spec, acquisition.note);

        if (acquisition.status === 'cancelled') {
          return withContinuation(
            unchangedOutcome(notes),
            continuation?.(liveEntity) ?? null,
          );
        }

        const settled = settleTriggerOutcome(
          liveEntity,
          liveEntity,
          snapshot,
          toTriggerSaveOutcome(snapshot.trigger, acquisition.save),
          effectOptions,
        );

        return withContinuation(
          toDeferredEffectOutcome(settled, notes),
          continuation?.(liveEntity) ?? null,
        );
      },
    ignoreRejectedRollRequest,
  );

  return { entityId: recipient.id, blocksMovement: false, resolution };
}

/** Чем закончилось одно срабатывание события */
type TriggerEventRun = 'skipped' | 'settled' | 'deferred';

/**
 * Получатели действий срабатывания события.
 *
 * @param subject - субъект
 * @param source - срабатывание с эффектом: у него спрашивают наложившего
 * @param eventData - данные события
 * @param options - с чем прогоняются события
 * @returns получатели; пусто — действовать не на кого
 */
function resolveTriggerRecipients(
  subject: DnDSceneEntity,
  source: EffectTriggerSource,
  eventData: TriggerEventData,
  options: TriggerEventOptions,
): DnDSceneEntity[] {
  const trigger = source.trigger;

  switch (trigger.recipient ?? DEFAULT_TRIGGER_RECIPIENT) {
    case 'other':
      return eventData.other ? [eventData.other] : [];
    // Наложивший: у эффекта из компендиума его нет, и срабатывание молчит —
    // бить носителя вместо неизвестного наложившего было бы хуже, чем ничего
    case SOURCE_TRIGGER_RECIPIENT: {
      const sourceId = source.effect.sourceActorId;

      if (!sourceId) {
        return [];
      }

      if (sourceId === subject.id) {
        return [subject];
      }

      const found = options.getEntity?.(sourceId);

      return found ? [found] : [];
    }
    case 'area':
      return trigger.area
        ? (options.listEntitiesInArea?.(subject, trigger.area) ?? [])
        : [];
    // Кандидаты выбора — те же, кого задел бы радиус, просеянные условием
    case 'choice':
      return trigger.choice
        ? listChoiceCandidates(subject, trigger.choice, options)
        : [];
    default:
      return [subject];
  }
}

/**
 * Данные события с отношением другой стороны к наложившему эффект: союзник ли
 * она ему. Считается по фишкам сцены; без сцены или без одной из фишек
 * отношение неизвестно, и поле не ставится.
 *
 * @param eventData - данные события
 * @param sourceId - кто наложил эффект
 * @param options - с чем прогоняются события
 * @returns данные события с отношением либо те же данные
 */
function withSourceRelation(
  eventData: TriggerEventData,
  sourceId: string | undefined,
  options: TriggerEventOptions,
): TriggerEventData {
  const { other } = eventData;
  const { surroundings } = options;

  if (!other || !sourceId || !surroundings) {
    return eventData;
  }

  const source = options.getEntity?.(sourceId);
  const sourceToken = findSceneToken(surroundings, sourceId);
  const otherToken = findSceneToken(surroundings, other.id);

  if (!sourceToken || !otherToken) {
    return eventData;
  }

  return {
    ...eventData,
    otherAlliedToSource:
      getRelativeDisposition(
        withTokenDisposition(sourceToken, source),
        withTokenDisposition(otherToken, other),
      ) === 'ally',
  };
}

/**
 * Тип только что полученного урона — в части урона срабатывания: токен
 * `@dmg.event` становится типом урона события («направить урон того же
 * типа»). Вне события урона токен остаётся, и часть идёт без типа.
 *
 * Зовётся до вопроса человеку: срабатывание с ценой «реакция», галочкой
 * «спрашивать» или ценой ресурсом уносит тип в свой снимок, и урон после
 * согласия идёт с ним — защиты получателя его видят.
 *
 * @param source - срабатывание с источником
 * @param eventData - данные события
 * @returns срабатывание с типом события либо то же срабатывание
 */
function bindEventDamageType(
  source: EffectTriggerSource,
  eventData: TriggerEventData,
): EffectTriggerSource {
  const [eventType] = eventData.damage?.types ?? [];

  if (
    !eventType
    || !source.trigger.actions.some(
      (action) =>
        action.type === 'damage'
        && action.parts.some((part) =>
          part.formula.includes(EVENT_DAMAGE_TYPE_TOKEN),
        ),
    )
  ) {
    return source;
  }

  return {
    ...source,
    trigger: mapTriggerDamageParts(source.trigger, (part) => ({
      ...part,
      formula: part.formula.replaceAll(
        EVENT_DAMAGE_TYPE_TOKEN,
        `${DAMAGE_TYPE_TOKEN_PREFIX}${eventType}`,
      ),
    })),
  };
}

/**
 * Одно срабатывание события с другой стороной: получатель, условие и лимит,
 * спасбросок на сервере или запросом игроку, действия. Одно на события урона
 * и бросок атаки — у них разные только данные события.
 *
 * @param subject - субъект: на нём эффект
 * @param rawSource - срабатывание с источником
 * @param rawEventData - данные события: урон, бросок, другая сторона
 * @param options - с чем прогоняются события
 * @param result - общий итог (пополняется)
 * @param continuation - что делать после ответа игрока
 * @returns чем закончилось
 */
function runTriggerEventSource(
  subject: DnDSceneEntity,
  rawSource: EffectTriggerSource,
  rawEventData: TriggerEventData,
  options: TriggerEventOptions,
  result: DamageEventsResult,
  continuation?: DamageEventsContinuation,
): TriggerEventRun {
  // Раунд — общий на всю серию: его знает ядро, а не построитель события.
  // Союзник ли другая сторона наложившему — знает сцена
  const eventData = withSourceRelation(
    withCombatRound(rawEventData, options.combatRound),
    rawSource.effect.sourceActorId,
    options,
  );

  // Данные события привязываются до развилки «спросить человека или нет»:
  // после согласия срабатывание выполняется тем же, чем выполнилось бы сразу
  const eventSource = bindEventDamageType(rawSource, eventData);

  const recipients = resolveTriggerRecipients(
    subject,
    eventSource,
    eventData,
    options,
  );

  // Эффект, снятый раньше в этой же серии, больше не срабатывает
  const removed =
    eventSource.instance
    && !(subject.activeEffects ?? []).some(
      (effect) => effect.id === eventSource.effect.id,
    );

  if (recipients.length === 0 || removed) {
    return 'skipped';
  }

  const { requestRoll } = options;
  const { choice } = eventSource.trigger;

  const choosesRecipients =
    eventSource.trigger.recipient === CHOICE_TRIGGER_RECIPIENT
    && choice !== undefined;

  // Срабатывание, которое спросит человека, лимит тратит уже по согласию
  const asks =
    triggerAsksPermission(eventSource.trigger) && Boolean(requestRoll);

  if (!admitTrigger(subject, eventSource, eventData, options.inCombat, asks)) {
    return 'skipped';
  }

  /** Опции наложения ответа человека: те же, что у броска сервера */
  const answerOptions: EntryEffectOptions = {
    ambientEffects: options.ambientEffects ?? [],
    activeTurnActorId: options.activeTurnActorId,
    endCast: options.endCast,
    eventDamage: eventData.damage?.amount,
    eventData,
    criticalTargetId: eventData.attack?.criticalTargetId,
    surroundings: options.surroundings,
    moveToken: options.moveToken,
    moveArea: options.moveArea,
    movementOffset: eventData.movement?.offset,
  };

  // «Спрашивать разрешения», цена «Реакция» и цена ресурсом: срабатывание
  // ждёт согласия владельца — и уже по нему выбирает цель и платит
  if (asks && requestRoll) {
    const requesterLabel = formatEffectRequesterLabel(eventSource.effect.name);

    const asked = requestTriggerAsk(
      subject,
      eventSource,
      requestRoll,
      requesterLabel,
      {
        effectOptions: answerOptions,
        inCombat: options.inCombat,
        ...(choosesRecipients && choice
          ? {
              buildChoiceRequest: (prepare) =>
                requestTriggerChoice(
                  subject,
                  eventSource,
                  recipients,
                  choice,
                  requestRoll,
                  requesterLabel,
                  answerOptions,
                  prepare,
                ),
            }
          : { recipients }),
        ...(continuation
          ? {
              finish: (liveSubject, outcome) =>
                withContinuation(outcome, continuation(liveSubject)),
            }
          : {}),
      },
    );

    // Цена не по карману — срабатывание молчит
    if (!asked) {
      return 'skipped';
    }

    result.deferred.push(asked);

    return 'deferred';
  }

  // Спросить некого: цена без выбора списывается сама, иначе срабатывание не
  // состоится
  const prepared = settleUnaskedTriggerPay(subject, eventSource);

  if (!prepared) {
    return 'skipped';
  }

  const { source } = prepared;

  if (prepared.notes.length > 0) {
    result.changed = true;
    result.notes.push(...prepared.notes);
  }

  // Получатель «по выбору»: кто именно, решает человек — всё срабатывание
  // ждёт ответа, а найденные кандидаты уходят в запрос
  if (choosesRecipients && choice) {
    if (!requestRoll) {
      return 'skipped';
    }

    const deferred = requestTriggerChoice(
      subject,
      source,
      recipients,
      choice,
      requestRoll,
      formatEffectRequesterLabel(source.effect.name),
      answerOptions,
    );

    if (!deferred) {
      return 'skipped';
    }

    result.deferred.push(deferred);

    return 'deferred';
  }

  // Счётчик лимита записан на субъекта — его надо сохранить
  if (source.trigger.limit) {
    result.changed = true;
  }

  // Каждый получатель бросает свой спасбросок; ждёт ли кто-то ответа игрока,
  // решает итог всего срабатывания
  const runs = recipients.map((recipient) =>
    settleTriggerForRecipient(
      subject,
      recipient,
      source,
      eventData,
      options,
      result,
      continuation,
    ),
  );

  return runs.includes('deferred') ? 'deferred' : 'settled';
}

/**
 * Действия срабатывания одному получателю: спасбросок на сервере или запросом
 * игроку, затем урон, лечение и наложения.
 *
 * @param subject - субъект: на нём эффект
 * @param recipient - получатель
 * @param subjectSource - срабатывание с источником, как его видит субъект
 * @param eventData - данные события
 * @param options - с чем прогоняются события
 * @param result - общий итог (пополняется)
 * @param continuation - что делать после ответа игрока
 * @returns ждёт ли получатель ответа игрока
 */
function settleTriggerForRecipient(
  subject: DnDSceneEntity,
  recipient: DnDSceneEntity,
  subjectSource: EffectTriggerSource,
  eventData: TriggerEventData,
  options: TriggerEventOptions,
  result: DamageEventsResult,
  continuation?: DamageEventsContinuation,
): 'settled' | 'deferred' {
  const { requestRoll } = options;

  // Сл формулой — по субъекту, на котором эффект, а не по бросающему
  const source = bindTriggerSourceSaveDcs(subjectSource, subject);

  const ambientEffects =
    recipient === subject ? (options.ambientEffects ?? []) : [];

  const effectOptions: EntryEffectOptions = {
    ambientEffects,
    activeTurnActorId: options.activeTurnActorId,
    endCast: options.endCast,
    eventDamage: eventData.damage?.amount,
    criticalTargetId: eventData.attack?.criticalTargetId,
    surroundings: options.surroundings,
    moveToken: options.moveToken,
    moveArea: options.moveArea,
    movementOffset: eventData.movement?.offset,
    collectNote: (note) => result.notes.push(note),
  };

  const spec = buildTriggerSaveSpec(source.effect, source.trigger, {
    entity: recipient,
    eventData,
  });

  // Автоматический исход спрашивать не нужно — бросать нечего
  if (
    spec
    && triggerSaveNeedsRoll(source.trigger, recipient, eventData)
    && shouldRequestEffectSave(recipient, requestRoll)
  ) {
    result.deferred.push(
      requestDamageEventSave(
        recipient,
        // Эффект другой стороны живой сущности субъекта не снимет
        recipient === subject ? source : { ...source, instance: false },
        spec,
        requestRoll,
        effectOptions,
        continuation,
      ),
    );

    return 'deferred';
  }

  const save = spec
    ? rollTriggerSave(recipient, source, ambientEffects, eventData)
    : null;

  recordSettled(
    recipient === subject ? result : relatedOutcomeOf(result, recipient),
    settleTriggerOutcome(subject, recipient, source, save, effectOptions),
  );

  return 'settled';
}

/**
 * Срабатывание события урона по удару: другая сторона — тот, кто бил.
 *
 * @param subject - субъект: на нём эффект
 * @param source - срабатывание с источником
 * @param hit - удар события
 * @param options - с чем прогоняются события
 * @param result - общий итог (пополняется)
 * @param continuation - что делать после ответа игрока
 * @returns чем закончилось
 */
function runDamageEventSource(
  subject: DnDSceneEntity,
  source: EffectTriggerSource,
  hit: DamageHit,
  options: DamageEventsOptions,
  result: DamageEventsResult,
  continuation?: DamageEventsContinuation,
): TriggerEventRun {
  const other = hit.sourceId ? options.getEntity?.(hit.sourceId) : undefined;

  return runTriggerEventSource(
    subject,
    source,
    { damage: hit, other },
    options,
    result,
    continuation,
  );
}

/**
 * «Хиты упали до 0»: сначала срабатывания, возвращающие хиты, затем остальные
 * — пока хиты снова не стали больше нуля. Так «Неумолимая стойкость» сохраняет
 * концентрацию. Если возвращающее хиты ждёт ответа игрока, остальные ждут
 * вместе с ним.
 *
 * @param subject - субъект
 * @param sources - срабатывания «0 хитов» по порядку
 * @param hit - удар, опустивший хиты
 * @param options - с чем прогоняются события
 * @param result - общий итог (пополняется)
 */
function runHpZeroSources(
  subject: DnDSceneEntity,
  sources: readonly EffectTriggerSource[],
  hit: DamageHit,
  options: DamageEventsOptions,
  result: DamageEventsResult,
): void {
  for (const [index, source] of sources.entries()) {
    if (resolveEntityCurrentHp(subject) > 0) {
      return;
    }

    const rest = sources.slice(index + 1);

    const waitsForHp =
      restoresHitPoints(source.trigger)
      && (source.trigger.recipient ?? DEFAULT_TRIGGER_RECIPIENT) === 'subject';

    const continuation: DamageEventsContinuation | undefined = waitsForHp
      ? (liveEntity) => {
          if (rest.length === 0 || resolveEntityCurrentHp(liveEntity) > 0) {
            return null;
          }

          const continued = createDamageEventsResult();

          runHpZeroSources(liveEntity, rest, hit, options, continued);

          return continued;
        }
      : undefined;

    const run = runDamageEventSource(
      subject,
      source,
      hit,
      options,
      result,
      continuation,
    );

    if (run === 'deferred' && continuation) {
      return;
    }
  }
}

/**
 * Прогоняет события урона у субъекта, в которого уже записан урон:
 * «хиты упали до 0» по последнему удару, затем «получил урон» по каждому удару.
 *
 * @param subject - субъект с уже записанным уроном (мутируется)
 * @param hits - удары
 * @param options - с чем прогоняются события
 * @returns итог
 */
export function settleDamageEvents(
  subject: DnDSceneEntity,
  hits: readonly DamageHit[],
  options: DamageEventsOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();
  const landed = hits.filter((hit) => hit.amount > 0);
  const lastHit = landed.at(-1);

  if (!lastHit) {
    return result;
  }

  const ambientEffects = options.ambientEffects ?? [];

  if (options.hpBefore > 0 && resolveEntityCurrentHp(subject) === 0) {
    const sources = listDamageEventSources(
      subject,
      'hpZero',
      ambientEffects,
      options.newEffectIds,
    );

    runHpZeroSources(
      subject,
      [
        ...sources.filter((source) => restoresHitPoints(source.trigger)),
        ...sources.filter((source) => !restoresHitPoints(source.trigger)),
      ],
      lastHit,
      options,
      result,
    );
  }

  for (const hit of landed) {
    const sources = listDamageEventSources(
      subject,
      'damageTaken',
      ambientEffects,
      options.newEffectIds,
    );

    for (const source of sources) {
      runDamageEventSource(subject, source, hit, options, result);
    }
  }

  return result;
}

/**
 * Один удар из всех ударов снимка: урон суммой, типы вместе, крит — если был
 * хоть один.
 *
 * @param hits - удары снимка
 * @returns удар либо `undefined`, если урона не было
 */
function mergeLandingHits(hits: readonly DamageHit[]): DamageHit | undefined {
  const landed = hits.filter((hit) => hit.amount > 0);
  const lastHit = landed.at(-1);

  if (!lastHit) {
    return undefined;
  }

  return {
    amount: landed.reduce((total, hit) => total + hit.amount, 0),
    types: [...new Set(landed.flatMap((hit) => hit.types))],
    critical: landed.some((hit) => hit.critical),
    sourceId: lastHit.sourceId,
  };
}

/**
 * «При наложении»: срабатывания эффектов, которые положил на субъекта тот же
 * боевой снимок. Урон события — урон этого снимка, другая сторона — кто
 * наложил эффект. Условие видит хиты уже после урона («оглушён, если хитов
 * не больше 150»).
 *
 * @param subject - субъект с записанным снимком (мутируется)
 * @param newEffectIds - эффекты, наложенные снимком
 * @param hits - удары снимка
 * @param options - с чем прогоняются события
 * @returns итог
 */
export function settleAppliedEvents(
  subject: DnDSceneEntity,
  newEffectIds: ReadonlySet<string>,
  hits: readonly DamageHit[],
  options: TriggerEventOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();

  const effects = listLiveEffects(subject).filter((effect) =>
    newEffectIds.has(effect.id),
  );

  const sources = buildTriggerSources(
    effects,
    EFFECT_TRIGGER_SOURCE_KINDS.instance,
    (effect) => listEffectEventTriggers(effect, 'applied'),
  );

  const damage = mergeLandingHits(hits);

  for (const source of sources) {
    const { sourceActorId } = source.effect;

    runTriggerEventSource(
      subject,
      source,
      {
        ...(damage ? { damage } : {}),
        other: sourceActorId ? options.getEntity?.(sourceActorId) : undefined,
      },
      options,
      result,
    );
  }

  return result;
}

/** Что известно о броске атаки одной стороне на сервере */
export interface AttackRollEventOptions extends TriggerEventOptions {
  /** Другая сторона: цель для атакующего, атакующий для цели */
  other?: DnDSceneEntity;
  /** Режим броска атаки */
  roll: TriggerEventData['roll'];
  /**
   * Попал ли бросок. Не задано — к моменту события это ещё неизвестно (серия
   * снарядов), и части условия «попала» / «промахнулась» не выполняются обе
   */
  landed?: boolean;
  /** Попадание критическое: урон срабатывания цели атаки удваивает кости */
  critical?: boolean;
}

/**
 * Есть ли у стороны срабатывания броска атаки, которые выполняет сервер: клиент
 * не шлёт событие, если делать нечего.
 *
 * @param entity - сторона атаки
 * @param role - атакующий или цель
 * @returns `true`, если серверу есть что выполнить
 */
export function hasServerAttackRollTriggers(
  entity: DnDSceneEntity,
  role: EffectTriggerAttackRole,
): boolean {
  return listAttackRollSources(entity, role, 'server').length > 0;
}

/**
 * Срабатывания события на всём, что действует вместе с сущностью: её эффекты,
 * надетые предметы, черты существа. Так собираются события лечения,
 * перемещения, снятия состояния и «свалил цель» — аур чужих токенов у них нет.
 *
 * @param entity - сущность
 * @param event - событие
 * @returns срабатывания с источником
 */
function listOwnEventSources(
  entity: DnDSceneEntity,
  event: EffectTriggerEvent,
): EffectTriggerSource[] {
  return listCarrierEventSources(entity, (effect) =>
    listEffectEventTriggers(effect, event),
  );
}

/**
 * Прогоняет на сервере срабатывания броска атаки стороны, которые не выполнил
 * клиент: со спасброском, уроном, концом каста и действиями другой стороне.
 *
 * @param subject - сторона атаки (мутируется)
 * @param role - атакующий или цель
 * @param options - другая сторона, режим броска и возможности ядра
 * @returns итог: субъект и другие стороны
 */
export function settleAttackRollTriggers(
  subject: DnDSceneEntity,
  role: EffectTriggerAttackRole,
  options: AttackRollEventOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();

  // Цель атаки: у атакующего это другая сторона, у цели — она сама
  const attackTarget = role === 'attacker' ? options.other : subject;

  const criticalTargetId =
    options.landed === true && options.critical === true
      ? attackTarget?.id
      : undefined;

  const eventData: TriggerEventData = {
    other: options.other,
    roll: options.roll,
    ...(options.landed === undefined
      ? {}
      : {
          attack: {
            kinds: [],
            landed: options.landed,
            ...(criticalTargetId === undefined ? {} : { criticalTargetId }),
          },
        }),
  };

  for (const source of listAttackRollSources(subject, role, 'server')) {
    runTriggerEventSource(subject, source, eventData, options, result);
  }

  return result;
}

/**
 * Кнопка «При действии»: срабатывания эффекта, чьи действия достаются другим
 * — всем в радиусе, тем, кого накрыл шаблон нажавшего, или наложившему.
 * Действия самому носителю выполняет клиент (`runEffectActiveAction`).
 *
 * @param subject - носитель эффекта (мутируется)
 * @param effectId - эффект с кнопкой
 * @param options - с чем прогоняются события
 * @returns итог: субъект и другие стороны
 */
export function settleEffectActionEvents(
  subject: DnDSceneEntity,
  effectId: string,
  options: TriggerEventOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();

  const effects = listLiveEffects(subject).filter(
    (effect) => effect.id === effectId,
  );

  const sources = buildTriggerSources(
    effects,
    EFFECT_TRIGGER_SOURCE_KINDS.instance,
    (effect) =>
      listEffectEventTriggers(effect, 'activate').filter(isServerActiveAction),
    subject,
  );

  for (const source of sources) {
    runTriggerEventSource(subject, source, {}, options, result);
  }

  return result;
}

/**
 * «Носителя вылечили»: срабатывания на подъём хитов. Число восстановленных
 * хитов идёт в `@damage` — переменную события; отдельной ей не заводится, у
 * этого события величина одна, и путать её не с чем.
 *
 * Временные хиты подъёмом не считаются: правила отделяют их от лечения, и
 * «когда тебя вылечили» на щит из временных хитов не срабатывает.
 *
 * @param subject - субъект с записанным снимком (мутируется)
 * @param healed - на сколько поднялись хиты; не больше нуля — событие молчит
 * @param options - с чем прогоняются события
 * @returns итог
 */
export function settleHealingEvents(
  subject: DnDSceneEntity,
  healed: number,
  options: TriggerEventOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();

  if (healed <= 0) {
    return result;
  }

  const sources = listOwnEventSources(subject, 'healed');

  for (const source of sources) {
    runTriggerEventSource(
      subject,
      source,
      { damage: { amount: healed, types: [], critical: false } },
      options,
      result,
    );
  }

  return result;
}

/** Перемещение носителя, как его увидело ядро */
export interface MovementEventData {
  /** Длина пройденного пути в футах */
  distance: number;
  /** Фишку переставили правила (толчок, притягивание), а не носитель */
  forced: boolean;
  /** Смещение фишки за перемещение, px: по нему зона идёт за носителем */
  offset?: SceneOffset;
}

/**
 * «Носитель прошёл путь»: срабатывания на перемещение носителя. Без шага —
 * одно за перемещение; с шагом `everyFeet` — за каждые столько футов пути.
 *
 * Остаток короче шага на следующее перемещение не переносится: три отдельных
 * шага по 5 футов при шаге 10 не дают ни одного срабатывания. Лимит «не чаще
 * N раз» режет серию как обычно: «раз в ход» схлопывает её в одно
 * срабатывание. Повторов не больше {@link MAX_TRIGGER_PATH_REPEATS}.
 *
 * @param subject - кто шёл (мутируется)
 * @param movement - длина пути и кто двигал
 * @param options - с чем прогоняются события
 * @returns итог
 */
export function settleMovementEvents(
  subject: DnDSceneEntity,
  movement: MovementEventData,
  options: TriggerEventOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();

  if (!(movement.distance > 0)) {
    return result;
  }

  const sources = listOwnEventSources(subject, 'moved');

  for (const source of sources) {
    const step = source.trigger.everyFeet;

    const repeats =
      step === undefined
        ? 1
        : Math.min(
            Math.floor(movement.distance / step),
            MAX_TRIGGER_PATH_REPEATS,
          );

    for (let repeat = 0; repeat < repeats; repeat++) {
      runTriggerEventSource(
        subject,
        source,
        {
          movement: {
            forced: movement.forced,
            ...(movement.offset ? { offset: movement.offset } : {}),
          },
        },
        options,
        result,
      );
    }
  }

  return result;
}

/**
 * «Состояние снялось»: срабатывания на уход состояния с носителя. Снятие видно
 * по исчезнувшим эффектам снимка — какое именно состояние ушло, несёт условие
 * `self.conditionLost === "…"`.
 *
 * @param subject - субъект с записанным снимком (мутируется)
 * @param lostConditions - ключи снятых состояний
 * @param options - с чем прогоняются события
 * @returns итог
 */
export function settleConditionLostEvents(
  subject: DnDSceneEntity,
  lostConditions: readonly string[],
  options: TriggerEventOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();

  if (lostConditions.length === 0) {
    return result;
  }

  const sources = listOwnEventSources(subject, 'conditionLost');

  for (const source of sources) {
    // Срабатывание с ключом состояния слушает только своё: «когда спадёт
    // Опутанность». Без ключа — любое снятое состояние
    const wanted = source.trigger.conditionKey;

    if (wanted !== undefined && !lostConditions.includes(wanted)) {
      continue;
    }

    runTriggerEventSource(subject, source, { lostConditions }, options, result);
  }

  return result;
}

/**
 * «Носитель свалил цель»: срабатывания того, чей урон обнулил хиты. Событие
 * идёт на ЕГО эффектах, а поверженный — другая сторона: условия о типе и хитах
 * читают его.
 *
 * Свалившего ищет ядро по id (`getEntity`): старое ядро сущностей не отдаёт —
 * тогда событие молчит, а не бьёт поверженного вместо него.
 *
 * @param downed - поверженный
 * @param hits - удары снимка: по последнему видно, чей урон добил
 * @param options - с чем прогоняются события
 * @returns итог и сваливший, если его изменило срабатывание
 */
export function settleDownedOtherEvents(
  downed: DnDSceneEntity,
  hits: readonly DamageHit[],
  options: TriggerEventOptions,
): DamageEventsResult {
  const result = createDamageEventsResult();

  const sourceId = mergeLandingHits(hits)?.sourceId;
  const slayer = sourceId ? options.getEntity?.(sourceId) : undefined;

  if (!slayer || slayer.id === downed.id) {
    return result;
  }

  const sources = listOwnEventSources(slayer, 'downedOther');

  if (sources.length === 0) {
    return result;
  }

  // Срабатывания идут на свалившем: он субъект своих эффектов
  const own = createDamageEventsResult();

  for (const source of sources) {
    runTriggerEventSource(slayer, source, { other: downed }, options, own);
  }

  // ...но снимок пишет ПОВЕРЖЕННЫЙ, и правки свалившего уедут в мир, только
  // если положить их «другой стороной». Иначе они останутся в памяти сервера
  const outcome = relatedOutcomeOf(result, slayer);

  outcome.changed ||= own.changed;
  outcome.damageOutcomes.push(...own.damageOutcomes);
  outcome.healingOutcomes.push(...own.healingOutcomes);
  outcome.saveOutcomes.push(...own.saveOutcomes);

  // Строки «сообщить» — эффектов свалившего: в его сводку, а не поверженного
  outcome.notes.push(...own.notes);

  result.related.push(...own.related);
  result.deferred.push(...own.deferred);

  return result;
}
