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
import type {
  DeferredTurnTrigger,
  EffectTriggerSource,
} from './effectTriggerRunner.js';
import type {
  EffectSaveSpec,
  EntryEffectOptions,
  TurnDamageOutcome,
  TurnSaveOutcome,
} from './turnEffects.js';

import {
  resolveActorStats,
  resolveTotalMovementSpeed,
} from './effectPipeline.js';
import {
  buildEffectSaveRollRequest,
  formatEffectRequesterLabel,
  settleEffectSaveOutcome,
} from './effectSaveAcquisition.js';
import {
  applyEntryEffect,
  applyTriggerEffectActions,
  buildTriggerSaveSpec,
  rollTriggerDamage,
  settlePresenceTrigger,
  toTriggerSaveOutcome,
  turnTriggerEventOf,
} from './effectTriggerRunner.js';
import { listEffectListTriggers } from './effectTriggers.js';
import {
  applyDamageToEntity,
  buildApplySaveSpec,
  formatEffectsSummary,
  formatEffectsSummaryHeader,
} from './turnEffects.js';

/** Исход отложенного срабатывания после ответа игрока */
export interface DeferredEffectOutcome {
  /** Сущность изменена — ядро сохранит и разошлёт её */
  changed: boolean;
  /** Урон срабатывания — для сводки в чате */
  damageOutcomes: TurnDamageOutcome[];
  /** Спасброски — для сводки в чате */
  saveOutcomes: TurnSaveOutcome[];
  /** Готовые строки сводки: отмена срабатывания, автоматический бросок */
  notes: string[];
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
function formatEffectNotes(
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
function unchangedOutcome(notes: string[]): DeferredEffectOutcome {
  return { changed: false, damageOutcomes: [], saveOutcomes: [], notes };
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
 * Отнимет ли проваленный спасбросок у сущности всю скорость.
 *
 * Прогон идёт на копии сущности: эффект накладывается как при провале, и
 * скорость считается уже с ним. Так учитываются и состояния («Опутан»), и
 * флаги, и урон, опускающий хиты до нуля, — без отдельного списка «что
 * останавливает».
 *
 * @param entity - сущность, которую накрыл эффект
 * @param effect - эффект со спасброском
 * @param spec - его спасбросок
 * @returns `true`, если при провале сущность не сможет двигаться
 */
export function failureHaltsMovement(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  spec: EffectSaveSpec,
): boolean {
  const probe = structuredClone(entity);

  applyEntryEffect(probe, effect, buildFailedSave(spec));

  return resolveTotalMovementSpeed(resolveActorStats(probe)) <= 0;
}

/**
 * Разовый эффект зоны или ауры со спасброском, который бросает игрок.
 *
 * Эффект копируется в момент срабатывания: зона принадлежит ядру и может
 * измениться, пока игрок думает, а применить нужно то, что сработало.
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

  const snapshot = structuredClone(effect);
  const spec = buildApplySaveSpec(snapshot, effect.applySave);

  const resolution = requestRoll(
    buildEffectSaveRollRequest(entity, spec, requesterLabel),
  ).then(
    (outcome): DeferredEffectApply =>
      (liveEntity) => {
        const acquisition = settleEffectSaveOutcome(liveEntity, spec, outcome);

        if (acquisition.status === 'cancelled') {
          return unchangedOutcome(formatEffectNotes(spec, acquisition.note));
        }

        const result = applyEntryEffect(
          liveEntity,
          snapshot,
          acquisition.save,
          options,
        );

        return {
          changed: result.damageOutcome !== null || result.statusApplied,
          damageOutcomes: result.damageOutcome ? [result.damageOutcome] : [],
          saveOutcomes: [acquisition.save],
          notes: formatEffectNotes(spec, acquisition.note),
        };
      },
    // Ядро обещает не отклонять промис; если это всё же случилось, применять
    // нечего — срабатывание просто не состоится
    () => null,
  );

  return {
    entityId: entity.id,
    blocksMovement: failureHaltsMovement(entity, snapshot, spec),
    resolution,
  };
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
  );

  if (removes) {
    entity.activeEffects = (entity.activeEffects ?? []).filter(
      (entry) => entry.id !== target.effectId,
    );
  }

  return {
    changed: damage !== null || removes || applied,
    damageOutcomes: damage ? [damage] : [],
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
 * @returns отложенное срабатывание; `null`, если спасброска нет
 */
export function requestTurnTriggerSave(
  entity: DnDSceneEntity,
  deferred: DeferredTurnTrigger,
  timing: EffectSaveTiming,
  requestRoll: ServerRollRequester,
): EngineDeferredTrigger | null {
  const { effect, trigger, ambient, instance, scope, stage } = deferred;
  const spec = buildTriggerSaveSpec(effect, trigger);

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
    () => null,
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
 * @param options - откуда пришли наложения
 * @returns отложенное срабатывание; `null`, если спасброска нет
 */
export function requestPresenceTriggerSave(
  entity: DnDSceneEntity,
  source: EffectTriggerSource,
  requestRoll: ServerRollRequester,
  requesterLabel: string,
  options: EntryEffectOptions = {},
): EngineDeferredTrigger | null {
  const spec = buildTriggerSaveSpec(source.effect, source.trigger);

  if (!spec) {
    return null;
  }

  const snapshot: EffectTriggerSource = {
    ...source,
    effect: structuredClone(source.effect),
    trigger: structuredClone(source.trigger),
  };

  const resolution = requestRoll(
    buildEffectSaveRollRequest(entity, spec, requesterLabel),
  ).then(
    (outcome): DeferredEffectApply =>
      (liveEntity) => {
        const acquisition = settleEffectSaveOutcome(liveEntity, spec, outcome);

        if (acquisition.status === 'cancelled') {
          return unchangedOutcome(formatEffectNotes(spec, acquisition.note));
        }

        const save = toTriggerSaveOutcome(snapshot.trigger, acquisition.save);

        const result = settlePresenceTrigger(
          liveEntity,
          snapshot,
          save,
          options,
        );

        return {
          changed: result.damageOutcome !== null || result.statusApplied,
          damageOutcomes: result.damageOutcome ? [result.damageOutcome] : [],
          saveOutcomes: [save],
          notes: formatEffectNotes(spec, acquisition.note),
        };
      },
    () => null,
  );

  // Провал отнимет скорость — фишку останавливают до ответа
  const probe = structuredClone(entity);

  settlePresenceTrigger(probe, snapshot, buildFailedSave(spec), options);

  return {
    entityId: entity.id,
    blocksMovement: resolveTotalMovementSpeed(resolveActorStats(probe)) <= 0,
    resolution,
  };
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
  const summary = formatEffectsSummary(
    entityName,
    whenLabel,
    outcome.damageOutcomes,
    outcome.saveOutcomes,
    formatSaveStatus,
  );

  if (outcome.notes.length === 0) {
    return summary;
  }

  return [
    summary ?? formatEffectsSummaryHeader(entityName, whenLabel),
    ...outcome.notes,
  ].join('\n');
}
