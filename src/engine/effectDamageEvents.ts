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
  EffectTriggerAttackRole,
  EffectTriggerEvent,
} from './effectTriggerTypes.js';
import type { TriggerEventData } from './triggerConditions.js';
import type {
  EffectSaveSpec,
  EntryEffectOptions,
  EntryEffectResult,
  TurnDamageOutcome,
  TurnSaveOutcome,
} from './turnEffects.js';

import { formatEffectNotes, unchangedOutcome } from './deferredEffectSaves.js';
import { listEquippedItemEffects } from './effectPipeline.js';
import {
  buildEffectSaveRollRequest,
  formatEffectRequesterLabel,
  settleEffectSaveOutcome,
  shouldRequestEffectSave,
} from './effectSaveAcquisition.js';
import {
  admitTrigger,
  buildTriggerSaveSpec,
  listTraitEffects,
  resolveEffectUsageScope,
  settleTriggerOutcome,
  toTriggerSaveOutcome,
} from './effectTriggerRunner.js';
import {
  isClientAttackRollTrigger,
  listEffectListTriggers,
} from './effectTriggers.js';
import { resolveEntityCurrentHp } from './hitPoints.js';
import { rollEffectSaveOutcome } from './turnEffects.js';

/** С чем прогоняются срабатывания событий с другой стороной */
export interface TriggerEventOptions {
  /** Запрос броска от ядра: спасбросок сущности без авто-спасбросков — игроку */
  requestRoll?: ServerRollRequester;
  /** Ауры чужих токенов, накрывающие субъекта */
  ambientEffects?: readonly ActiveEffect[];
  /** Субъект в бою: лимит «раз в ход / раунд» считается только в бою */
  inCombat?: boolean;
  /** Чей сейчас ход: срок наложенного */
  activeTurnActorId?: string | null;
  /** Живая сущность мира по id: другая сторона — кто нанёс урон */
  getEntity?: (entityId: string) => DnDSceneEntity | undefined;
  /** Закончить каст эффекта: провал концентрации */
  endCast?: (effect: ActiveEffect) => void;
}

/** С чем прогоняются события урона */
export interface DamageEventsOptions extends TriggerEventOptions {
  /** Хиты субъекта до урона: «хиты упали до 0» — только если они были */
  hpBefore: number;
}

/** Изменения одной сущности от событий урона */
export interface DamageEventsEntityOutcome {
  entity: DnDSceneEntity;
  changed: boolean;
  damageOutcomes: TurnDamageOutcome[];
  saveOutcomes: TurnSaveOutcome[];
}

/** Итог событий урона */
export interface DamageEventsResult {
  /** Субъект изменён: урон, наложение, снятие или счётчик лимита */
  changed: boolean;
  damageOutcomes: TurnDamageOutcome[];
  saveOutcomes: TurnSaveOutcome[];
  /** Спасброски, которые спросили у игроков */
  deferred: EngineDeferredTrigger[];
  /** Другие стороны, которым достались действия («урон тому, кто ударил») */
  related: DamageEventsEntityOutcome[];
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
    saveOutcomes: [],
    deferred: [],
    related: [],
  };
}

/**
 * Срабатывания эффектов субъекта на событие урона: эффекты на нём самом,
 * работающих предметов, черт существа и аур «пока внутри».
 *
 * @param entity - субъект
 * @param event - событие урона
 * @param ambientEffects - ауры чужих токенов
 * @returns срабатывания с источником
 */
function listDamageEventSources(
  entity: DnDSceneEntity,
  event: EffectTriggerEvent,
  ambientEffects: readonly ActiveEffect[],
): EffectTriggerSource[] {
  const sourcesOf = (
    effects: readonly ActiveEffect[],
    kind: { instance: boolean; ambient: boolean },
    scopeOf: (effect: ActiveEffect) => string,
  ): EffectTriggerSource[] =>
    effects.flatMap((effect) =>
      listEffectListTriggers(effect)
        .filter((trigger) => trigger.event === event)
        .map((trigger) => ({
          effect,
          trigger,
          ...kind,
          scope: scopeOf(effect),
        })),
    );

  const own = (entity.activeEffects ?? []).filter(
    (effect) => !effect.disabled && !(effect.aura && !effect.aura.applyToSelf),
  );

  const ambient = ambientEffects.filter(
    (effect) => !effect.disabled && (effect.areaTrigger ?? 'stay') === 'stay',
  );

  return [
    ...sourcesOf(
      own,
      { instance: true, ambient: false },
      resolveEffectUsageScope,
    ),
    ...sourcesOf(
      listEquippedItemEffects(entity),
      { instance: false, ambient: false },
      (effect) => `item:${effect.id}`,
    ),
    ...sourcesOf(
      listTraitEffects(entity),
      { instance: false, ambient: false },
      (effect) => `trait:${effect.id}`,
    ),
    ...sourcesOf(
      ambient,
      { instance: false, ambient: true },
      (effect) => `aura:${effect.id}`,
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
    saveOutcomes: [],
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
    saveOutcomes: [...outcome.saveOutcomes, ...continued.saveOutcomes],
    notes: outcome.notes,
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
  const snapshot: EffectTriggerSource = {
    ...source,
    effect: structuredClone(source.effect),
    trigger: structuredClone(source.trigger),
  };

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

        const save = toTriggerSaveOutcome(snapshot.trigger, acquisition.save);

        const settled = settleTriggerOutcome(
          liveEntity,
          liveEntity,
          snapshot,
          save,
          effectOptions,
        );

        return withContinuation(
          {
            changed: settled.damageOutcome !== null || settled.statusApplied,
            damageOutcomes: settled.damageOutcome
              ? [settled.damageOutcome]
              : [],
            saveOutcomes: [save],
            notes,
          },
          continuation?.(liveEntity) ?? null,
        );
      },
    () => null,
  );

  return { entityId: recipient.id, blocksMovement: false, resolution };
}

/** Чем закончилось одно срабатывание события */
type TriggerEventRun = 'skipped' | 'settled' | 'deferred';

/**
 * Одно срабатывание события с другой стороной: получатель, условие и лимит,
 * спасбросок на сервере или запросом игроку, действия. Одно на события урона
 * и бросок атаки — у них разные только данные события.
 *
 * @param subject - субъект: на нём эффект
 * @param source - срабатывание с источником
 * @param data - данные события: урон, бросок, другая сторона
 * @param options - с чем прогоняются события
 * @param result - общий итог (пополняется)
 * @param continuation - что делать после ответа игрока
 * @returns чем закончилось
 */
function runTriggerEventSource(
  subject: DnDSceneEntity,
  source: EffectTriggerSource,
  data: TriggerEventData,
  options: TriggerEventOptions,
  result: DamageEventsResult,
  continuation?: DamageEventsContinuation,
): TriggerEventRun {
  const { requestRoll } = options;
  const recipient = source.trigger.recipient === 'other' ? data.other : subject;

  // Эффект, снятый раньше в этой же серии, больше не срабатывает
  const removed =
    source.instance
    && !(subject.activeEffects ?? []).some(
      (effect) => effect.id === source.effect.id,
    );

  if (!recipient || removed) {
    return 'skipped';
  }

  if (!admitTrigger(subject, source, data, options.inCombat)) {
    return 'skipped';
  }

  // Счётчик лимита записан на субъекта — его надо сохранить
  if (source.trigger.limit) {
    result.changed = true;
  }

  const ambientEffects =
    recipient === subject ? (options.ambientEffects ?? []) : [];

  const effectOptions: EntryEffectOptions = {
    ambientEffects,
    activeTurnActorId: options.activeTurnActorId,
    endCast: options.endCast,
  };

  const spec = buildTriggerSaveSpec(source.effect, source.trigger, {
    entity: recipient,
    data,
  });

  if (spec && shouldRequestEffectSave(recipient, requestRoll)) {
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
    ? toTriggerSaveOutcome(
        source.trigger,
        rollEffectSaveOutcome(recipient, spec, ambientEffects),
      )
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
      restoresHitPoints(source.trigger) && source.trigger.recipient !== 'other';

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
    const sources = listDamageEventSources(subject, 'hpZero', ambientEffects);

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
    );

    for (const source of sources) {
      runDamageEventSource(subject, source, hit, options, result);
    }
  }

  return result;
}

/** Что известно о броске атаки одной стороне на сервере */
export interface AttackRollEventOptions extends TriggerEventOptions {
  /** Другая сторона: цель для атакующего, атакующий для цели */
  other?: DnDSceneEntity;
  /** Режим броска атаки */
  roll: TriggerEventData['roll'];
}

/**
 * Срабатывания броска атаки стороны, которые выполняются на субъекте.
 *
 * @param entity - сторона атаки
 * @param role - атакующий или цель
 * @returns срабатывания с источником
 */
function listServerAttackRollSources(
  entity: DnDSceneEntity,
  role: EffectTriggerAttackRole,
): EffectTriggerSource[] {
  return (entity.activeEffects ?? [])
    .filter((effect) => !effect.disabled)
    .flatMap((effect) =>
      listEffectListTriggers(effect)
        .filter(
          (trigger) =>
            trigger.event === 'attackRoll'
            && (trigger.role ?? 'attacker') === role
            && !isClientAttackRollTrigger(trigger),
        )
        .map((trigger) => ({
          effect,
          trigger,
          ambient: false,
          instance: true,
          scope: resolveEffectUsageScope(effect),
        })),
    );
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
  return listServerAttackRollSources(entity, role).length > 0;
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
  const data: TriggerEventData = { other: options.other, roll: options.roll };

  for (const source of listServerAttackRollSources(subject, role)) {
    runTriggerEventSource(subject, source, data, options, result);
  }

  return result;
}
