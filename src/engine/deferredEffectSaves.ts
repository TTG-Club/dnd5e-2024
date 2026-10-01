/**
 * Отложенные срабатывания эффектов: спасбросок спросили у игрока, и применить
 * эффект можно только по его ответу.
 *
 * Зона, аура и повторный спасбросок хода срабатывают на сервере. Если сущность
 * не бросает сама (`shouldRequestEffectSave`), вместо броска уходит запрос
 * владельцу, а правила эффекта ждут ответа. Ядро применяет возвращённую функцию
 * к ЖИВОЙ сущности и само сохраняет и рассылает результат (контракт
 * `SystemDeferredTrigger`).
 */

import type { RollRequestOutcome, ServerRollRequester } from '@vtt/shared';

import type { ActiveEffect, EffectSaveTiming } from './activeEffectTypes.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { PayOption, PayPlan, TriggerSourcePreparer } from './effectPay.js';
import type {
  DeferredTurnTrigger,
  EffectTriggerSource,
} from './effectTriggerRunner.js';
import type {
  EffectTriggerAction,
  EffectTriggerChoice,
} from './effectTriggerTypes.js';
import type { TriggerEventData } from './triggerConditions.js';
import type {
  EffectPromptOption,
  EffectPromptRequestPayload,
} from './triggerPrompt.js';
import type {
  EffectSaveSpec,
  EntryEffectOptions,
  EntryEffectResult,
  TurnDamageOutcome,
  TurnHealingOutcome,
  TurnSaveOutcome,
} from './turnEffects.js';

import {
  buildTriggerPayContext,
  defaultPayPicks,
  payTriggerPrice,
  planEffectPay,
} from './effectPay.js';
import { describeEffectPay } from './effectPayTypes.js';
import {
  resolveActorStats,
  resolveTotalMovementSpeed,
} from './effectPipeline.js';
import {
  buildEffectSaveRollRequest,
  formatEffectRequesterLabel,
  settleEffectSaveOutcome,
} from './effectSaveAcquisition.js';
import { bindTriggerSourceSaveDcs } from './effectSaveDcOwner.js';
import { describeTriggerActions } from './effectTriggerDescribe.js';
import {
  applyEntryEffect,
  applyTriggerEffectActions,
  buildTriggerSaveSpec,
  removeEffectsById,
  rollTriggerDamage,
  rollTriggerSave,
  settlePresenceTrigger,
  settleTriggerOutcome,
  takeTriggerAdmission,
  toTriggerSaveOutcome,
} from './effectTriggerRunner.js';
import {
  listEffectListTriggers,
  turnTriggerEventOf,
} from './effectTriggers.js';
import {
  formatTargetChoiceRequestTitle,
  readChoiceAnswer,
  resolveChoiceCount,
  resolveChooserId,
  TARGET_CHOICE_REQUEST_KIND,
  toChoiceCandidatePayload,
} from './triggerChoice.js';
import {
  EFFECT_PROMPT_CONFIRM,
  EFFECT_PROMPT_CONFIRM_OPTIONS,
  EFFECT_PROMPT_REQUEST_KIND,
  formatEffectPromptTitle,
  MAX_PROMPT_OPTIONS,
  readPromptAnswer,
} from './triggerPrompt.js';
import {
  appendEffectsSummaryNotes,
  applyDamageToEntity,
  buildApplySaveSpec,
  formatEffectsSummary,
} from './turnEffects.js';

/** Исход отложенного срабатывания после ответа игрока */
export interface DeferredEffectOutcome {
  /** Сущность изменена — ядро сохранит и разошлёт её */
  changed: boolean;
  /** Урон срабатывания — для сводки в чате */
  damageOutcomes: TurnDamageOutcome[];
  /** Лечение срабатывания — для сводки в чате */
  healingOutcomes: TurnHealingOutcome[];
  /** Спасброски — для сводки в чате */
  saveOutcomes: TurnSaveOutcome[];
  /** Готовые строки сводки: отмена срабатывания, автоматический бросок */
  notes: string[];
  /** Новые ожидания ответа, появившиеся от применения («0 хитов» у остальных) */
  deferred?: EngineDeferredTrigger[];
}

/** Применение исхода к живой сущности */
export type DeferredEffectApply = (
  entity: DnDSceneEntity,
) => DeferredEffectOutcome;

/** Срабатывание эффекта, ждущее ответа игрока */
export interface EngineDeferredTrigger {
  /** Чью сущность менять по ответу */
  entityId: string;
  /** Провал отнимет скорость — фишку надо остановить до ответа */
  blocksMovement: boolean;
  /** Ответ пришёл: применение либо `null`, если применять нечего */
  resolution: Promise<DeferredEffectApply | null>;
}

/**
 * Строки сводки о спасброске эффекта: «Ядовитое облако: <заметка>».
 *
 * @param spec - спасбросок эффекта
 * @param note - заметка; без неё строк нет
 * @returns строки сводки
 */
export function formatEffectNotes(
  spec: EffectSaveSpec,
  note: string | null,
): string[] {
  return note ? [`${spec.effectName}: ${note}`] : [];
}

/**
 * Исход, который ничего не изменил, — с заметками или без.
 *
 * @param notes - строки сводки
 * @returns исход без изменений
 */
export function unchangedOutcome(notes: string[]): DeferredEffectOutcome {
  return {
    changed: false,
    damageOutcomes: [],
    healingOutcomes: [],
    saveOutcomes: [],
    notes,
  };
}

/**
 * Исход одного срабатывания после ответа игрока.
 *
 * @param result - что сделало срабатывание
 * @param notes - строки сводки
 * @returns исход для ядра
 */
export function toDeferredEffectOutcome(
  result: EntryEffectResult,
  notes: string[],
): DeferredEffectOutcome {
  return {
    changed: result.damageOutcome !== null || result.statusApplied,
    damageOutcomes: result.damageOutcome ? [result.damageOutcome] : [],
    healingOutcomes: result.healingOutcome ? [result.healingOutcome] : [],
    saveOutcomes: result.saveOutcome ? [result.saveOutcome] : [],
    notes,
  };
}

/**
 * Отказ запроса броска. Ядро обещает не отклонять промис; если это всё же
 * случилось, применять нечего — срабатывание просто не состоится.
 *
 * @returns применения нет
 */
export function ignoreRejectedRollRequest(): null {
  return null;
}

/**
 * Копия срабатывания с источником на момент срабатывания: зона и эффект
 * принадлежат ядру и могут измениться, пока игрок думает, а применить нужно
 * то, что сработало.
 *
 * @param source - срабатывание с источником
 * @returns копия
 */
export function snapshotTriggerSource(
  source: EffectTriggerSource,
): EffectTriggerSource {
  return {
    ...source,
    effect: structuredClone(source.effect),
    trigger: structuredClone(source.trigger),
  };
}

/**
 * Проваленный спасбросок — для сухого прогона «что будет при провале».
 *
 * @param spec - спасбросок эффекта
 * @returns исход провала
 */
function buildFailedSave(spec: EffectSaveSpec): TurnSaveOutcome {
  return {
    effectName: spec.effectName,
    ability: spec.ability,
    dc: spec.dc,
    roll: 1,
    total: 1,
    passed: false,
  };
}

/**
 * Применение исхода спасброска к сущности: к живой по ответу игрока или к
 * копии для прогона «что будет при провале».
 */
type PresenceSaveSettler = (
  entity: DnDSceneEntity,
  save: TurnSaveOutcome,
  options: EntryEffectOptions,
) => EntryEffectResult;

/**
 * Разовый спасбросок зоны или ауры, который бросает игрок: применение ждёт
 * ответа, а фишку останавливают сразу, если провал отнимет у неё скорость.
 *
 * Провал прогоняется на копии сущности, и скорость считается уже с ним. Так
 * учитываются и состояния («Опутан»), и флаги, и урон, опускающий хиты до нуля,
 * — без отдельного списка «что останавливает».
 *
 * @param entity - сущность, которую накрыл эффект
 * @param spec - спасбросок
 * @param requestRoll - запрос броска от ядра
 * @param requesterLabel - кто просит («Зона «Болото»»)
 * @param options - откуда пришёл эффект
 * @param settle - применение исхода
 * @returns отложенное срабатывание
 */
function requestPresenceSave(
  entity: DnDSceneEntity,
  spec: EffectSaveSpec,
  requestRoll: ServerRollRequester,
  requesterLabel: string,
  options: EntryEffectOptions,
  settle: PresenceSaveSettler,
): EngineDeferredTrigger {
  const resolution = requestRoll(
    buildEffectSaveRollRequest(entity, spec, requesterLabel),
  ).then(
    (outcome): DeferredEffectApply =>
      (liveEntity) => {
        const acquisition = settleEffectSaveOutcome(liveEntity, spec, outcome);
        const notes = formatEffectNotes(spec, acquisition.note);

        return acquisition.status === 'cancelled'
          ? unchangedOutcome(notes)
          : toDeferredEffectOutcome(
              settle(liveEntity, acquisition.save, options),
              notes,
            );
      },
    ignoreRejectedRollRequest,
  );

  // Копия каст не заканчивает: конец каста ушёл бы в ядро по-настоящему
  const probe = structuredClone(entity);

  settle(probe, buildFailedSave(spec), { ...options, endCast: undefined });

  return {
    entityId: entity.id,
    blocksMovement: resolveTotalMovementSpeed(resolveActorStats(probe)) <= 0,
    resolution,
  };
}

/**
 * Разовый эффект зоны или ауры со спасброском, который бросает игрок.
 *
 * @param entity - сущность, которую накрыл эффект
 * @param effect - эффект зоны или ауры с `applySave`
 * @param requestRoll - запрос броска от ядра
 * @param requesterLabel - кто просит («Зона «Болото»»)
 * @param options - откуда пришёл эффект
 * @returns отложенное срабатывание; `null`, если у эффекта нет спасброска
 */
export function requestEntryEffect(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  requestRoll: ServerRollRequester,
  requesterLabel: string,
  options: EntryEffectOptions = {},
): EngineDeferredTrigger | null {
  if (!effect.applySave) {
    return null;
  }

  // Зона принадлежит ядру и может измениться, пока игрок думает
  const snapshot = structuredClone(effect);

  return requestPresenceSave(
    entity,
    buildApplySaveSpec(snapshot, effect.applySave, entity),
    requestRoll,
    requesterLabel,
    options,
    (target, save, effectOptions) =>
      applyEntryEffect(target, snapshot, save, effectOptions),
  );
}

/** Что искать на живой сущности, когда пришёл ответ на спасбросок хода */
interface TurnTriggerAnswerTarget {
  effectId: string;
  triggerId: string;
  timing: EffectSaveTiming;
  stage: DeferredTurnTrigger['stage'];
  spec: EffectSaveSpec;
  ambient: boolean;
  instance: boolean;
  scope: string;
  /**
   * Снимок эффекта черты или ауры чужого токена: самого эффекта на сущности нет
   */
  snapshot?: ActiveEffect;
  /**
   * Опции наложения той же границы хода: ауры, чей ход и конец каста. Без них
   * «Закончить каст» по ответу игрока снимал бы только сам эффект.
   */
  effectOptions: EntryEffectOptions;
}

/**
 * Применяет ответ на спасбросок срабатывания хода к живой сущности: урон по
 * исходу, снятие или наложение, отмена — ничего.
 *
 * Эффект и срабатывание ищутся заново: пока игрок думал, эффект могли снять,
 * выключить или поменять — тогда спасбросок ни к чему не относится.
 *
 * @param entity - живая сущность
 * @param target - что бросали и где искать
 * @param outcome - исход запроса
 * @returns исход для сводки
 */
function applyTurnTriggerAnswer(
  entity: DnDSceneEntity,
  target: TurnTriggerAnswerTarget,
  outcome: RollRequestOutcome,
): DeferredEffectOutcome {
  const effect =
    target.snapshot
    ?? entity.activeEffects?.find((entry) => entry.id === target.effectId);

  const event = turnTriggerEventOf(target.timing);

  const trigger = effect
    ? listEffectListTriggers(effect).find(
        (entry) => entry.id === target.triggerId && entry.event === event,
      )
    : undefined;

  if (!effect || effect.disabled || !trigger?.save) {
    return unchangedOutcome([]);
  }

  const acquisition = settleEffectSaveOutcome(entity, target.spec, outcome);

  if (acquisition.status === 'cancelled') {
    return unchangedOutcome(formatEffectNotes(target.spec, acquisition.note));
  }

  const save = toTriggerSaveOutcome(trigger, acquisition.save);

  const source: EffectTriggerSource = {
    effect,
    trigger,
    ambient: target.ambient,
    instance: target.instance,
    scope: target.scope,
  };

  const damage =
    target.stage === 'damage'
      ? rollTriggerDamage(
          entity,
          effect,
          trigger,
          save.passed,
          resolveActorStats(entity),
        )
      : null;

  if (damage) {
    applyDamageToEntity(entity, damage.total);
  }

  // Снятие и наложение идут по тому же ответу — и на этапе урона, если
  // срабатывание и бьёт, и накладывает
  const { removes, applied } = applyTriggerEffectActions(
    entity,
    source,
    save.passed,
    target.effectOptions,
  );

  if (removes) {
    removeEffectsById(entity, new Set([target.effectId]));
  }

  return {
    changed: damage !== null || removes || applied,
    damageOutcomes: damage ? [damage] : [],
    healingOutcomes: [],
    saveOutcomes: [save],
    notes: formatEffectNotes(target.spec, acquisition.note),
  };
}

/**
 * Спасбросок срабатывания хода, который бросает игрок: урон, снятие или
 * наложение ждут ответа.
 *
 * @param entity - субъект срабатывания
 * @param deferred - отложенное срабатывание хода
 * @param timing - граница хода
 * @param requestRoll - запрос броска от ядра
 * @param effectOptions - опции наложения этой границы хода
 * @returns отложенное срабатывание; `null`, если спасброска нет
 */
export function requestTurnTriggerSave(
  entity: DnDSceneEntity,
  deferred: DeferredTurnTrigger,
  timing: EffectSaveTiming,
  requestRoll: ServerRollRequester,
  effectOptions: EntryEffectOptions = {},
): EngineDeferredTrigger | null {
  const { effect, trigger, ambient, instance, scope, stage, eventData } =
    deferred;

  // Режим «если…» и Сл формулой — по тем же данным хода, что у броска сервера
  const spec = buildTriggerSaveSpec(effect, trigger, { entity, eventData });

  if (!spec) {
    return null;
  }

  const target: TurnTriggerAnswerTarget = {
    effectId: effect.id,
    triggerId: trigger.id,
    timing,
    stage,
    spec,
    ambient,
    instance,
    scope,
    effectOptions,
    ...(instance ? {} : { snapshot: structuredClone(effect) }),
  };

  const resolution = requestRoll(
    buildEffectSaveRollRequest(
      entity,
      spec,
      formatEffectRequesterLabel(effect.name),
    ),
  ).then(
    (outcome): DeferredEffectApply =>
      (liveEntity) =>
        applyTurnTriggerAnswer(liveEntity, target, outcome),
    ignoreRejectedRollRequest,
  );

  // Спасбросок на границе хода — фишка в этот момент не идёт
  return { entityId: entity.id, blocksMovement: false, resolution };
}

/**
 * Срабатывание входа или выхода из зоны со спасброском, который бросает игрок.
 *
 * Эффект и срабатывание копируются в момент срабатывания: зона принадлежит
 * ядру и может измениться, пока игрок думает.
 *
 * @param entity - субъект срабатывания
 * @param source - срабатывание с источником
 * @param requestRoll - запрос броска от ядра
 * @param requesterLabel - кто просит («Зона «Лунный луч»»)
 * @param eventData - данные события: режим «если…» считается по ним так же,
 *   как у броска сервера
 * @param options - откуда пришли наложения
 * @returns отложенное срабатывание; `null`, если спасброска нет
 */
export function requestPresenceTriggerSave(
  entity: DnDSceneEntity,
  source: EffectTriggerSource,
  requestRoll: ServerRollRequester,
  requesterLabel: string,
  eventData: TriggerEventData,
  options: EntryEffectOptions = {},
): EngineDeferredTrigger | null {
  const spec = buildTriggerSaveSpec(source.effect, source.trigger, {
    entity,
    eventData,
  });

  if (!spec) {
    return null;
  }

  const snapshot = snapshotTriggerSource(source);

  return requestPresenceSave(
    entity,
    spec,
    requestRoll,
    requesterLabel,
    options,
    (target, save, effectOptions) =>
      settlePresenceTrigger(
        target,
        snapshot,
        toTriggerSaveOutcome(snapshot.trigger, save),
        effectOptions,
      ),
  );
}

/** Заметки в сводку чата о том, чем кончился вопрос человеку */
export const TRIGGER_ASK_CHAT_NOTES = {
  declined: 'срабатывание отменено — согласия нет',
  timeout: 'нет ответа — срабатывание отменено',
  payGone: 'платить уже нечем — срабатывание отменено',
  limitGone: 'уже использовано — срабатывание отменено',
} as const;

/** Вопросы срабатывания: обычный, о расходе реакции и о цене ресурсом */
export const TRIGGER_ASK_QUESTIONS = {
  plain: 'Пустить срабатывание в ход?',
  reaction: 'Потратить реакцию?',
  pay: 'Заплатить цену?',
  payChoice: 'Чем заплатить?',
} as const;

/** Подпись отказа платить в вопросе с выбором платежа */
const PAY_DECLINE_LABEL = 'Не платить';

/** Приставка цены в кратком описании вопроса */
const PAY_SUMMARY_PREFIX = 'Цена: ';

/**
 * Строит вопрос «да / нет» перед срабатыванием: подпись, варианты и краткое
 * описание того, что случится по согласию.
 *
 * @param source - срабатывание с источником
 * @returns нагрузка вопроса
 */
function buildTriggerAskPayload(
  source: EffectTriggerSource,
): EffectPromptRequestPayload {
  const actions = describeTriggerActions(source.trigger);
  const { pay, cost } = source.trigger;

  const summary = [
    pay ? `${PAY_SUMMARY_PREFIX}${describeEffectPay(pay)}` : '',
    actions,
  ]
    .filter((part) => part.length > 0)
    .join('. ');

  let question: string = TRIGGER_ASK_QUESTIONS.plain;

  if (pay) {
    question = TRIGGER_ASK_QUESTIONS.pay;
  } else if (cost === 'reaction') {
    question = TRIGGER_ASK_QUESTIONS.reaction;
  }

  return {
    kind: EFFECT_PROMPT_REQUEST_KIND,
    question,
    options: [...EFFECT_PROMPT_CONFIRM_OPTIONS],
    sourceName: source.effect.name,
    ...(summary ? { effectSummary: summary } : {}),
  };
}

/** Чем кончился вопрос о срабатывании */
type TriggerAskAnswer =
  | { status: 'confirmed'; pickIds?: ReadonlySet<string> }
  | { status: 'declined' | 'timeout' };

/**
 * Варианты вопроса «чем заплатить»: варианты платежа и отказ. Лишние сверх
 * предела вопроса отсекаются — отказ остаётся всегда.
 *
 * @param options - варианты платежа
 * @returns варианты ответа
 */
function buildPayPromptOptions(
  options: readonly PayOption[],
): EffectPromptOption[] {
  return [
    ...options
      .slice(0, MAX_PROMPT_OPTIONS - 1)
      .map((option) => ({ id: option.id, label: option.label })),
    { id: EFFECT_PROMPT_CONFIRM.no, label: PAY_DECLINE_LABEL },
  ];
}

/**
 * Спрашивает человека о срабатывании: согласие и, у цены с выбором, чем
 * платить — по вопросу на каждый платёж с несколькими вариантами. Первый же
 * вопрос служит и согласием: отдельного «да / нет» перед выбором нет.
 *
 * @param source - снимок срабатывания с источником
 * @param plan - разбор цены; `null` — цены нет
 * @param ask - отправка одного вопроса
 * @returns чем кончился вопрос
 */
async function askAboutTrigger(
  source: EffectTriggerSource,
  plan: PayPlan | null,
  ask: (payload: EffectPromptRequestPayload) => Promise<RollRequestOutcome>,
): Promise<TriggerAskAnswer> {
  const base = buildTriggerAskPayload(source);

  const choices = (plan?.prices ?? []).filter(
    (entry) => entry.options.length > 1,
  );

  /**
   * Статус несостоявшегося ответа.
   *
   * @param outcome - исход запроса
   * @returns молчание или отказ
   */
  const refusalOf = (outcome: RollRequestOutcome): TriggerAskAnswer => ({
    status: outcome.status === 'timeout' ? 'timeout' : 'declined',
  });

  if (choices.length === 0) {
    const outcome = await ask(base);

    if (
      readPromptAnswer(outcome, EFFECT_PROMPT_CONFIRM_OPTIONS)
      !== EFFECT_PROMPT_CONFIRM.yes
    ) {
      return refusalOf(outcome);
    }

    const picks = plan ? defaultPayPicks(plan) : null;

    return {
      status: 'confirmed',
      ...(picks ? { pickIds: new Set(picks.map((pick) => pick.id)) } : {}),
    };
  }

  // Платежи без выбора идут как есть — спрашивать о них нечего
  const pickIds = new Set(
    (plan?.prices ?? [])
      .filter((entry) => entry.options.length === 1)
      .flatMap((entry) => entry.options.map((option) => option.id)),
  );

  for (const entry of choices) {
    const options = buildPayPromptOptions(entry.options);

    const outcome = await ask({
      ...base,
      question: TRIGGER_ASK_QUESTIONS.payChoice,
      options,
    });

    const answer = readPromptAnswer(outcome, options);

    if (answer === null || answer === EFFECT_PROMPT_CONFIRM.no) {
      return refusalOf(outcome);
    }

    pickIds.add(answer);
  }

  return { status: 'confirmed', pickIds };
}

/** Чем дополняется вопрос срабатывания */
export interface TriggerAskOptions {
  /** Опции наложения */
  effectOptions?: EntryEffectOptions;
  /**
   * Чем спросить «кого задеть» после согласия. Подготовку срабатывания (оплату)
   * вопрос о цели выполняет сам — уже по ответу на него.
   */
  buildChoiceRequest?: (
    prepare: TriggerSourcePreparer,
  ) => EngineDeferredTrigger | null;
  /**
   * Получатели действий, известные заранее: другая сторона события, все в
   * радиусе. Нет — действия достаются самому субъекту.
   */
  recipients?: readonly DnDSceneEntity[];
  /** Идёт ли у субъекта бой: лимит хода и раунда считается только в бою */
  inCombat?: boolean;
  /** Что сделать после ответа, каким бы он ни был («0 хитов» у остальных) */
  finish?: (
    liveSubject: DnDSceneEntity,
    outcome: DeferredEffectOutcome,
  ) => DeferredEffectOutcome;
}

/**
 * Выполняет срабатывание, на которое согласились: спасбросок бросает сервер,
 * дальше — обычные урон, лечение и наложения.
 *
 * @param entity - живая сущность
 * @param source - снимок срабатывания с источником
 * @param options - опции наложения
 * @returns исход для сводки
 */
function applyAskedTrigger(
  entity: DnDSceneEntity,
  source: EffectTriggerSource,
  options: EntryEffectOptions,
): DeferredEffectOutcome {
  const notes: string[] = [];

  const result = settlePresenceTrigger(
    entity,
    source,
    rollTriggerSave(entity, source, options.ambientEffects ?? []),
    { ...options, collectNote: (note) => notes.push(note) },
  );

  return toDeferredEffectOutcome(result, notes);
}

/**
 * Срабатывание, которое спрашивает разрешения: пока человек не согласился,
 * ничего не происходит.
 *
 * Спрашивают у владельца носителя или наложившего (поле `asker`). Отказ,
 * молчание и «спрашивать некого» — одно и то же: срабатывание отменяется с
 * заметкой в чат, как у выбора цели.
 *
 * У срабатывания с ценой ресурсом вопрос несёт цену, а если платить можно
 * по-разному (круг ячейки, число костей хитов) — варианты платежа. Цена
 * списывается с живого субъекта уже по ответу, перед действиями; не хватает
 * ресурса — вопроса нет вовсе, срабатывание молчит.
 *
 * Согласие пускает срабатывание дальше по его обычному пути: у срабатывания с
 * получателем «по выбору» следом идёт вопрос «кого задеть»
 * (`buildChoiceRequest`), у остальных — урон и наложения сразу.
 *
 * @param subject - субъект: на нём эффект
 * @param source - срабатывание с источником
 * @param requestRoll - запрос от ядра
 * @param requesterLabel - кто просит («Эффект «Опутывание»»)
 * @param options - опции наложения, вопрос о цели, получатели и продолжение
 * @returns отложенное срабатывание; `null`, если цена не по карману
 */
export function requestTriggerAsk(
  subject: DnDSceneEntity,
  source: EffectTriggerSource,
  requestRoll: ServerRollRequester,
  requesterLabel: string,
  options: TriggerAskOptions = {},
): EngineDeferredTrigger | null {
  const {
    effectOptions = {},
    buildChoiceRequest,
    recipients,
    inCombat,
    finish,
  } = options;

  const snapshot = snapshotTriggerSource(source);
  const { pay } = snapshot.trigger;

  const plan = pay
    ? planEffectPay(subject, pay, buildTriggerPayContext(snapshot))
    : null;

  // Платить нечем — и спрашивать не о чем
  if (plan && plan.shortfall !== null) {
    return null;
  }

  const askerId = resolveChooserId(
    subject,
    snapshot.effect,
    snapshot.trigger.asker,
  );

  /**
   * Исход с продолжением серии.
   *
   * @param liveSubject - живой субъект
   * @param outcome - исход срабатывания
   * @returns общий исход
   */
  const finished = (
    liveSubject: DnDSceneEntity,
    outcome: DeferredEffectOutcome,
  ): DeferredEffectOutcome => (finish ? finish(liveSubject, outcome) : outcome);

  const resolution = askAboutTrigger(snapshot, plan, (payload) =>
    requestRoll({
      entityId: askerId,
      requesterLabel,
      title: formatEffectPromptTitle(snapshot.effect.name),
      payload,
    }),
  ).then(
    (answer): DeferredEffectApply | Promise<DeferredEffectApply | null> => {
      if (answer.status !== 'confirmed') {
        const note = TRIGGER_ASK_CHAT_NOTES[answer.status];

        return (liveSubject) =>
          finished(
            liveSubject,
            unchangedOutcome([`${snapshot.effect.name}: ${note}`]),
          );
      }

      /**
       * Оплата по выбранным вариантам — на живом субъекте.
       *
       * @param liveSubject - живой субъект
       * @param prepared - срабатывание, как его знает путь действий
       * @returns срабатывание с числами либо `null`
       */
      const prepare: TriggerSourcePreparer = (liveSubject, prepared) =>
        // Лимит и заряд вопрос только проверил — тратит их согласие. Пока
        // человек отвечал, их могло потратить другое срабатывание
        takeTriggerAdmission(liveSubject, prepared, inCombat)
          ? payTriggerPrice(liveSubject, prepared, answer.pickIds)
          : null;

      const choiceRequest = buildChoiceRequest?.(prepare);

      if (choiceRequest) {
        return choiceRequest.resolution;
      }

      return (liveSubject) => {
        const prepared = prepare(liveSubject, snapshot);

        if (!prepared) {
          return finished(
            liveSubject,
            unchangedOutcome([
              `${snapshot.effect.name}: ${snapshot.trigger.pay ? TRIGGER_ASK_CHAT_NOTES.payGone : TRIGGER_ASK_CHAT_NOTES.limitGone}`,
            ]),
          );
        }

        const outcome = recipients
          ? settleTriggerRecipients(
              liveSubject,
              prepared.source,
              recipients,
              effectOptions,
            )
          : applyAskedTrigger(liveSubject, prepared.source, effectOptions);

        return finished(liveSubject, {
          ...outcome,
          // Списанные цену, лимит и заряд надо сохранить, даже если действия
          // ничего не дали
          changed: true,
          notes: [...prepared.notes, ...outcome.notes],
        });
      };
    },
    ignoreRejectedRollRequest,
  );

  // Вопрос не про движение фишки: ход не ждёт ответа
  return { entityId: subject.id, blocksMovement: false, resolution };
}

/** Заметки в сводку чата о том, чем кончился выбор цели */
export const TARGET_CHOICE_CHAT_NOTES = {
  declined: 'цель не выбрана — срабатывание отменено',
  optionalDeclined: 'от выбора отказались',
  timeout: 'нет ответа на выбор цели — срабатывание отменено',
  noCandidates: 'выбирать не из кого',
} as const;

/** Действия, которые всегда остаются эффекту субъекта, а не выбранным */
const SUBJECT_ONLY_ACTIONS: readonly EffectTriggerAction['type'][] = [
  'removeSelf',
  'endCast',
];

/**
 * Срабатывание только с теми действиями, что достаются выбранным, — или
 * только с теми, что остаются субъекту.
 *
 * @param source - срабатывание с источником
 * @param subjectOnly - оставить действия субъекта, а не выбранных
 * @returns срабатывание с урезанным списком действий
 */
function narrowChoiceSource(
  source: EffectTriggerSource,
  subjectOnly: boolean,
): EffectTriggerSource {
  return {
    ...source,
    trigger: {
      ...source.trigger,
      actions: source.trigger.actions.filter(
        (action) => SUBJECT_ONLY_ACTIONS.includes(action.type) === subjectOnly,
      ),
    },
  };
}

/** Что известно о выборе к моменту ответа */
interface ChoiceAnswerTarget {
  /** Срабатывание на момент запроса: пока выбирали, эффект мог измениться */
  source: EffectTriggerSource;
  /** Кандидаты, которых отправляли в запросе */
  candidates: DnDSceneEntity[];
  choice: EffectTriggerChoice;
  effectOptions: EntryEffectOptions;
  /** Подготовка срабатывания на живом субъекте: оплата цены */
  prepare?: TriggerSourcePreparer;
}

/**
 * Применяет действия срабатывания к одному получателю.
 *
 * Спасбросок получателя бросается на сервере: спрашивать бросок вдогонку к
 * уже заданному вопросу значило бы два окна подряд на одно срабатывание.
 *
 * @param subject - субъект срабатывания (на нём эффект)
 * @param recipient - получатель
 * @param recipientSource - срабатывание с действиями получателя
 * @param effectOptions - опции наложения
 * @returns исход для сводки
 */
function settleTriggerRecipient(
  subject: DnDSceneEntity,
  recipient: DnDSceneEntity,
  recipientSource: EffectTriggerSource,
  effectOptions: EntryEffectOptions,
): DeferredEffectOutcome {
  // Сл формулой — по субъекту, на котором эффект, а не по получателю
  const source = bindTriggerSourceSaveDcs(recipientSource, subject);

  if (source.trigger.actions.length === 0) {
    return unchangedOutcome([]);
  }

  const notes: string[] = [];

  return toDeferredEffectOutcome(
    settleTriggerOutcome(
      subject,
      recipient,
      source,
      rollTriggerSave(recipient, source),
      { ...effectOptions, collectNote: (note) => notes.push(note) },
    ),
    notes,
  );
}

/**
 * Раздаёт действия срабатывания получателям, известным по ответу человека:
 * действия достаются получателям, «Снять эффект» и «Закончить каст» — эффекту
 * субъекта, как и всегда.
 *
 * Получатели, кроме самого субъекта, — чужие записи: их правки уходят ядру
 * вложенными отложенными срабатываниями, каждое со своей живой сущностью.
 *
 * @param subject - живой субъект (меняется)
 * @param source - срабатывание с источником
 * @param recipients - получатели
 * @param effectOptions - опции наложения
 * @returns исход для сводки
 */
export function settleTriggerRecipients(
  subject: DnDSceneEntity,
  source: EffectTriggerSource,
  recipients: readonly DnDSceneEntity[],
  effectOptions: EntryEffectOptions,
): DeferredEffectOutcome {
  const subjectSource = narrowChoiceSource(source, true);
  const recipientSource = narrowChoiceSource(source, false);

  const removal =
    subjectSource.trigger.actions.length > 0
      ? applyTriggerEffectActions(subject, subjectSource, false, effectOptions)
      : { removes: false, applied: false };

  if (removal.removes) {
    removeEffectsById(subject, new Set([source.effect.id]));
  }

  // Сам субъект среди получателей — живая сущность, а не её снимок из запроса
  const own = recipients
    .filter((recipient) => recipient.id === subject.id)
    .map(() =>
      settleTriggerRecipient(subject, subject, recipientSource, effectOptions),
    );

  // Чужие записи ядро берёт на себя: вложенному срабатыванию ждать уже нечего,
  // ответ известен. Эффект субъекта живая запись получателя не снимет
  const foreignSource = { ...recipientSource, instance: false };

  const deferred = recipients
    .filter((recipient) => recipient.id !== subject.id)
    .map((recipient) => ({
      entityId: recipient.id,
      blocksMovement: false,
      resolution: Promise.resolve<DeferredEffectApply>((liveRecipient) =>
        settleTriggerRecipient(
          liveRecipient,
          liveRecipient,
          foreignSource,
          effectOptions,
        ),
      ),
    }));

  return {
    changed:
      removal.removes
      || removal.applied
      || own.some((outcomePart) => outcomePart.changed),
    damageOutcomes: own.flatMap((outcomePart) => outcomePart.damageOutcomes),
    healingOutcomes: own.flatMap((outcomePart) => outcomePart.healingOutcomes),
    saveOutcomes: own.flatMap((outcomePart) => outcomePart.saveOutcomes),
    notes: own.flatMap((outcomePart) => outcomePart.notes),
    ...(deferred.length > 0 ? { deferred } : {}),
  };
}

/**
 * Применяет ответ на выбор цели: действия достаются выбранным
 * ({@link settleTriggerRecipients}).
 *
 * @param subject - живой субъект
 * @param target - что выбирали
 * @param outcome - исход запроса
 * @returns исход для сводки
 */
function applyChoiceAnswer(
  subject: DnDSceneEntity,
  target: ChoiceAnswerTarget,
  outcome: RollRequestOutcome,
): DeferredEffectOutcome {
  const chosen = readChoiceAnswer(outcome, target.candidates, target.choice);
  const effectName = target.source.effect.name;

  if (!chosen || chosen.length === 0) {
    return unchangedOutcome([
      `${effectName}: ${resolveChoiceNote(outcome, target.choice)}`,
    ]);
  }

  // Цена списывается здесь: выбор сделан, срабатывание состоится
  const prepared = target.prepare
    ? target.prepare(subject, target.source)
    : { source: target.source, notes: [] };

  if (!prepared) {
    return unchangedOutcome([
      `${effectName}: ${target.source.trigger.pay ? TRIGGER_ASK_CHAT_NOTES.payGone : TRIGGER_ASK_CHAT_NOTES.limitGone}`,
    ]);
  }

  const settled = settleTriggerRecipients(
    subject,
    prepared.source,
    chosen,
    target.effectOptions,
  );

  return {
    ...settled,
    changed: settled.changed || target.prepare !== undefined,
    notes: [...prepared.notes, ...settled.notes],
  };
}

/**
 * Заметка в чат о том, почему выбор не состоялся.
 *
 * @param outcome - исход запроса
 * @param choice - блок «по выбору»
 * @returns строка заметки
 */
function resolveChoiceNote(
  outcome: RollRequestOutcome,
  choice: EffectTriggerChoice,
): string {
  if (outcome.status === 'timeout') {
    return TARGET_CHOICE_CHAT_NOTES.timeout;
  }

  return choice.optional
    ? TARGET_CHOICE_CHAT_NOTES.optionalDeclined
    : TARGET_CHOICE_CHAT_NOTES.declined;
}

/**
 * Срабатывание с получателем «по выбору»: у человека спрашивают, кого задеть,
 * и действия ждут ответа.
 *
 * Спрашивают у владельца выбирающего — носителя эффекта или того, кто эффект
 * наложил (`resolveChooserId`). Ответ проверяется по списку кандидатов:
 * выбрать того, кого в запросе не было, нельзя.
 *
 * @param subject - субъект: на нём эффект
 * @param source - срабатывание с источником
 * @param candidates - кандидаты (`listChoiceCandidates`)
 * @param choice - блок «по выбору»
 * @param requestRoll - запрос от ядра
 * @param requesterLabel - кто просит («Эффект «Аура жизни»»)
 * @param effectOptions - опции наложения
 * @param prepare - подготовка срабатывания на живом субъекте (оплата цены)
 * @returns отложенное срабатывание; `null`, если выбирать не из кого
 */
export function requestTriggerChoice(
  subject: DnDSceneEntity,
  source: EffectTriggerSource,
  candidates: readonly DnDSceneEntity[],
  choice: EffectTriggerChoice,
  requestRoll: ServerRollRequester,
  requesterLabel: string,
  effectOptions: EntryEffectOptions = {},
  prepare?: TriggerSourcePreparer,
): EngineDeferredTrigger | null {
  if (candidates.length === 0) {
    return null;
  }

  const count = resolveChoiceCount(choice, candidates.length);

  const target: ChoiceAnswerTarget = {
    source: snapshotTriggerSource(source),
    candidates: candidates.map((candidate) => structuredClone(candidate)),
    choice,
    effectOptions,
    ...(prepare ? { prepare } : {}),
  };

  const resolution = requestRoll({
    entityId: resolveChooserId(subject, source.effect, choice.chooser),
    requesterLabel,
    title: formatTargetChoiceRequestTitle(count, source.effect.name),
    payload: {
      kind: TARGET_CHOICE_REQUEST_KIND,
      candidates: toChoiceCandidatePayload(candidates),
      count,
      ...(choice.optional ? { optional: true } : {}),
      sourceName: source.effect.name,
    },
  }).then(
    (answer): DeferredEffectApply =>
      (liveSubject) =>
        applyChoiceAnswer(liveSubject, target, answer),
    ignoreRejectedRollRequest,
  );

  // Выбор не про движение фишки: ход не ждёт ответа
  return { entityId: subject.id, blocksMovement: false, resolution };
}

/**
 * Сводка отложенного срабатывания для чата: урон, спасброски и заметки.
 *
 * @param entityName - имя сущности
 * @param whenLabel - подпись момента («область», «аура», «конец хода»)
 * @param outcome - исход срабатывания
 * @param formatSaveStatus - подпись итога спасброска
 * @returns строка для чата или `null`, если показывать нечего
 */
export function formatDeferredEffectsSummary(
  entityName: string,
  whenLabel: string,
  outcome: DeferredEffectOutcome,
  formatSaveStatus: (save: TurnSaveOutcome) => string,
): string | null {
  return appendEffectsSummaryNotes(
    formatEffectsSummary(
      entityName,
      whenLabel,
      outcome.damageOutcomes,
      outcome.saveOutcomes,
      formatSaveStatus,
      outcome.healingOutcomes,
    ),
    entityName,
    whenLabel,
    outcome.notes,
  );
}
