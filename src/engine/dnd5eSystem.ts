import type {
  BaseActiveEffect,
  BaseActor,
  BaseCreature,
  BaseGameItem,
  CompendiumValueFormatter,
  ConditionDefinition,
  CustomArea,
  DiceRollData,
  Feature,
  GridSettings,
  HealthCondition,
  MeasurementTemplate,
  MovementRange,
  SceneEntity,
  SystemClientEventContext,
  SystemCombatStateResult,
  SystemDeferredTrigger,
  SystemDeferredTriggerResult,
  SystemRelatedTriggerResult,
  SystemRollResult,
  SystemTriggerContext,
  Token,
  VttSystem,
} from '@vtt/shared';

import type { ActiveEffect, EffectSaveTiming } from './activeEffectTypes.js';
import type { BackgroundDefinition } from './backgroundTypes.js';
import type { DndCombatState } from './damageApplication.js';
import type { DamageHit } from './damageHits.js';
import type { DamageApplyResult } from './damageUtils.js';
import type {
  DeferredEffectOutcome,
  EngineDeferredTrigger,
} from './deferredEffectSaves.js';
import type { DnDGameItem, DnDSceneEntity, Spell } from './dndEntities.js';
import type {
  DamageEventsResult,
  TriggerEventOptions,
} from './effectDamageEvents.js';
import type { IncomingAttackContext } from './effectPipeline.js';
import type { EffectTriggerSourceKind } from './effectTriggerRunner.js';
import type { AreaEffectsSyncResult } from './positionalEffects.js';
import type { SystemClientEvent } from './systemClientEvents.js';
import type {
  EntryEffectOptions,
  TurnDamageOutcome,
  TurnHealingOutcome,
  TurnSaveOutcome,
} from './turnEffects.js';

import { getHealthCondition, HEALTH_CONDITIONS, isRecord } from '@vtt/shared';

import {
  ActiveEffectsArraySchema,
  isActiveEffect,
  isDnDEffect,
  isEffectOrigin,
} from './activeEffectTypes.js';
import {
  normalizeActorData as normalizeDndActorData,
  validateActorData as validateDndActorData,
} from './actorValidation.js';
import {
  collectAllAuraEffects,
  calculateAmbientAuras as computeAmbientAuras,
  findEntitiesInArea,
} from './auraMath.js';
import { normalizeActor, normalizeCreature } from './calculations.js';
import { CLASS_KEY_OPTIONS } from './classTypes.js';
import {
  listConcentrationEffects,
  withoutCastEffects,
} from './concentration.js';
import {
  buildConditionActiveEffect,
  getConditionEntry,
  listConditions,
  resolveEffectConditionKey,
} from './conditionTemplates.js';
import {
  BASE_UNARMORED_AC,
  CREATURE_CATEGORIES,
  DEFAULT_ACTOR,
} from './consts.js';
import {
  applyCombatState as applyCombatStateImpl,
  applyEffectsToEntity as applyEffectsToEntityImpl,
  applyTargetDamage as applyTargetDamageImpl,
  getEntityActiveFlags as getEntityActiveFlagsImpl,
  getEntityArmorClass as getEntityArmorClassImpl,
  pickCombatState as pickCombatStateImpl,
} from './damageApplication.js';
import {
  clampDamageHits,
  parseDamageHits,
  toDamageHits,
} from './damageHits.js';
import { getSpellDamageParts } from './damageParts.js';
import {
  formatDeathSaveSummary,
  settleDeathSaveDamage,
  syncDeathSavesWithHp,
} from './deathSaves.js';
import { syncCreatureDeathCondition } from './deathState.js';
import {
  formatDeferredEffectsSummary,
  requestTurnTriggerSave,
} from './deferredEffectSaves.js';
import { rollDamageFormula as rollDamageFormulaImpl } from './diceFormula.js';
import {
  settleAppliedEvents,
  settleAttackRollTriggers,
  settleDamageEvents,
} from './effectDamageEvents.js';
import {
  collectActiveEffects,
  isDiceFormulaValue,
  resolveActorStats,
  resolveTotalMovementSpeed,
} from './effectPipeline.js';
import { shouldRequestEffectSave } from './effectSaveAcquisition.js';
import {
  buildTriggerSources,
  EFFECT_TRIGGER_SOURCE_KINDS,
  processTurnEffects,
} from './effectTriggerRunner.js';
import { isLegacyTrigger, listEffectEventTriggers } from './effectTriggers.js';
import { isDndSceneEntity } from './entityGuards.js';
import { buildFeatGrantsSummary } from './featGrantsSummary.js';
import { validateFormula } from './formulaParser.js';
import {
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
} from './hitPoints.js';
import { validateGameItem } from './itemSchemas.js';
import { transferItem } from './itemTransfer.js';
import {
  applyAuraTriggerEffects as computeAuraTriggerEffects,
  runPresenceTriggerSources,
  syncActorAreaEffects,
} from './positionalEffects.js';
import { damagePartIsHealing } from './spellUtils.js';
import { parseSystemClientEvent } from './systemClientEvents.js';
import { isPointInTemplate as isPointInTemplateGeometry } from './templateGeometry.js';
import {
  entityIgnoresTerrainCost as entityIgnoresTerrainCostImpl,
  resolveAreaTerrainCost,
} from './terrainCost.js';
import {
  buildEffectDiceRolls,
  decrementActorEffectDurations,
  expireTurnEffects as expireEntityTurnEffects,
  formatEffectsSummary,
  formatRecurringSaveStatus,
  formatTurnEffectsMessage,
  resolveTurnSummaryLabel,
} from './turnEffects.js';

/**
 * Type-guard: значение — валидное состояние здоровья (`HealthCondition`).
 *
 * @param value - проверяемый элемент
 * @returns true, если value имеет форму HealthCondition
 */
function isHealthCondition(value: unknown): value is HealthCondition {
  return (
    isRecord(value)
    && typeof value.key === 'string'
    && typeof value.minPercent === 'number'
    && typeof value.maxPercent === 'number'
    && typeof value.color === 'string'
  );
}

/**
 * Type-guard: значение — массив валидных состояний здоровья.
 * Внешние `customConditions` приходят как `unknown[]` (контракт VttSystem)
 * и валидируются здесь перед передачей в типизированный расчёт.
 *
 * @param value - проверяемое значение
 * @returns true, если value — массив HealthCondition
 */
function isHealthConditionArray(value: unknown): value is HealthCondition[] {
  return Array.isArray(value) && value.every(isHealthCondition);
}

/** Подпись момента в сводке сработавших зон */
const AREA_SUMMARY_LABEL = 'область';

/** Подпись момента в сводке сработавших аур */
const AURA_SUMMARY_LABEL = 'аура';

/**
 * Метка ожидания спасброска против урона каждый ход: у эффекта с уроном и
 * повторным спасброском на одной границе хода висят два разных запроса.
 */
const TURN_DAMAGE_SAVE_KEY = 'damage';

/**
 * Метка ожидания спасброска на ходу наложившего: один эффект срабатывает и на
 * своём ходу, и на ходу наложившего — ответы ждутся порознь.
 */
const SOURCE_TURN_SAVE_KEY = 'source';

/** Подпись момента в сводке событий урона */
const DAMAGE_EVENTS_SUMMARY_LABEL = 'от урона';

/** Подпись момента в сводке срабатываний «при наложении» */
const APPLIED_EVENTS_SUMMARY_LABEL = 'при наложении';

/**
 * Кубики эффектов сущности полем исхода для ядра: без бросков поля нет.
 *
 * @param entityName - имя сущности
 * @param damageOutcomes - исходы урона
 * @param healingOutcomes - исходы лечения
 * @returns поле бросков для исхода
 */
function effectRollsField(
  entityName: string,
  damageOutcomes: readonly TurnDamageOutcome[],
  healingOutcomes: readonly TurnHealingOutcome[],
): Pick<SystemDeferredTriggerResult, 'chatRolls'> {
  const chatRolls = buildEffectDiceRolls(
    entityName,
    damageOutcomes,
    healingOutcomes,
  );

  return chatRolls.length > 0 ? { chatRolls } : {};
}

/** Отказ в записи боевого снимка: ядро ничего не фиксирует */
const REJECTED_COMBAT_STATE: SystemCombatStateResult = {
  accepted: false,
  changed: false,
  chatSummary: null,
};

/**
 * Итог спасброска при входе в зону или ауру в сводке чата.
 *
 * @param save - исход спасброска
 * @returns подпись итога
 */
function formatEntrySaveStatus(save: TurnSaveOutcome): string {
  return save.passed ? '✓ спас' : '✗ провал';
}

/**
 * Сводка отложенного исхода зоны, ауры или события для чата.
 *
 * @param label - подпись момента («область», «аура»)
 * @returns функция: сущность и исход → сводка
 */
function formatEntryDeferredSummary(
  label: string,
): (entity: DnDSceneEntity, outcome: DeferredEffectOutcome) => string | null {
  return (entity, outcome) =>
    formatDeferredEffectsSummary(
      entity.name,
      label,
      outcome,
      formatEntrySaveStatus,
    );
}

/**
 * Поиск сущности ядра в форме D&D: сущность без данных системы — как не
 * найденная, применять к ней правила D&D нечего.
 *
 * @param getEntity - поиск сущности ядра; старое ядро его не даёт
 * @returns функция: id → сущность D&D
 */
function toDndEntityResolver(
  getEntity: ((entityId: string) => SceneEntity | undefined) | undefined,
): (entityId: string) => DnDSceneEntity | undefined {
  return (entityId) => {
    const found = getEntity?.(entityId);

    return found && isDndSceneEntity(found) ? found : undefined;
  };
}

/**
 * Переводит срабатывания движка, ждущие ответа игрока, в контракт ядра:
 * функция применения получает нейтральную сущность и отдаёт флаг изменения,
 * готовую сводку для чата и новые ожидания.
 *
 * Урон, нанесённый по ответу (урон на ходу, вход в зону), будит события урона,
 * если передан контекст. Ответы самих событий урона его не передают: их урон
 * новых событий не порождает.
 *
 * @param triggers - срабатывания движка
 * @param formatSummary - сводка исхода для чата
 * @param damageEventsContext - контекст событий урона от урона по ответу
 * @returns срабатывания для ядра либо `undefined`, если ждать нечего
 */
function toSystemDeferredTriggers(
  triggers: readonly EngineDeferredTrigger[],
  formatSummary: (
    entity: DnDSceneEntity,
    outcome: DeferredEffectOutcome,
  ) => string | null,
  damageEventsContext?: SystemTriggerContext,
): SystemDeferredTrigger[] | undefined {
  if (triggers.length === 0) {
    return undefined;
  }

  return triggers.map((trigger) => ({
    entityId: trigger.entityId,
    blocksMovement: trigger.blocksMovement,
    resolution: trigger.resolution.then((apply) =>
      apply
        ? (entity: SceneEntity): SystemDeferredTriggerResult => {
            // Ядро отдаёт живую сущность нейтральной формы: без данных системы
            // применять правила D&D не к чему
            if (!isDndSceneEntity(entity)) {
              return { changed: false, chatSummary: null };
            }

            const hpBefore = resolveEntityCurrentHp(entity);
            const outcome = apply(entity);

            const applied: SystemDeferredTriggerResult = {
              changed: outcome.changed,
              chatSummary: formatSummary(entity, outcome),
              ...effectRollsField(
                entity.name,
                outcome.damageOutcomes,
                outcome.healingOutcomes,
              ),
              deferred: toSystemDeferredTriggers(
                outcome.deferred ?? [],
                formatSummary,
              ),
            };

            return damageEventsContext
              ? withDamageEvents(
                  entity,
                  hpBefore,
                  toDamageHits(outcome.damageOutcomes),
                  damageEventsContext,
                  applied,
                )
              : applied;
          }
        : null,
    ),
  }));
}

/**
 * Складывает два исхода одной сущности: изменения, сводки, ожидания и другие
 * сущности.
 *
 * @param base - основной исход
 * @param extra - добавочный исход
 * @returns общий исход
 */
function mergeTriggerResults(
  base: SystemDeferredTriggerResult,
  extra: SystemDeferredTriggerResult,
): SystemDeferredTriggerResult {
  const chatSummary =
    [base.chatSummary, extra.chatSummary]
      .filter((summary) => summary !== null)
      .join('\n') || null;

  const deferred = [...(base.deferred ?? []), ...(extra.deferred ?? [])];
  const related = [...(base.related ?? []), ...(extra.related ?? [])];
  const chatRolls = [...(base.chatRolls ?? []), ...(extra.chatRolls ?? [])];

  return {
    changed: base.changed || extra.changed,
    chatSummary,
    ...(chatRolls.length > 0 ? { chatRolls } : {}),
    ...(deferred.length > 0 ? { deferred } : {}),
    ...(related.length > 0 ? { related } : {}),
  };
}

/**
 * Итог событий урона или наложения в контракте ядра: сводка и кубики
 * субъекта, ожидания ответа и другие стороны, которым достались действия.
 *
 * @param entity - субъект
 * @param events - итог событий
 * @param label - подпись момента в сводке
 * @returns исход для ядра
 */
function toDamageEventsTriggerResult(
  entity: DnDSceneEntity,
  events: DamageEventsResult,
  label: string = DAMAGE_EVENTS_SUMMARY_LABEL,
): SystemDeferredTriggerResult {
  const related: SystemRelatedTriggerResult[] = events.related.map(
    (outcome) => ({
      entity: outcome.entity,
      changed: outcome.changed,
      chatSummary: formatEffectsSummary(
        outcome.entity.name,
        label,
        outcome.damageOutcomes,
        outcome.saveOutcomes,
        formatEntrySaveStatus,
        outcome.healingOutcomes,
      ),
      ...effectRollsField(
        outcome.entity.name,
        outcome.damageOutcomes,
        outcome.healingOutcomes,
      ),
    }),
  );

  return {
    changed: events.changed,
    chatSummary: formatEffectsSummary(
      entity.name,
      label,
      events.damageOutcomes,
      events.saveOutcomes,
      formatEntrySaveStatus,
      events.healingOutcomes,
    ),
    ...effectRollsField(
      entity.name,
      events.damageOutcomes,
      events.healingOutcomes,
    ),
    deferred: toSystemDeferredTriggers(
      events.deferred,
      formatEntryDeferredSummary(label),
    ),
    ...(related.length > 0 ? { related } : {}),
  };
}

/**
 * Прогоняет события урона у сущности, в которую уже записан урон, и добавляет
 * их исход к исходу того, что урон нанесло.
 *
 * @param entity - субъект с записанным уроном
 * @param hpBefore - хиты до урона
 * @param hits - удары
 * @param context - возможности ядра
 * @param base - исход того, что нанесло урон
 * @param newEffectIds - эффекты, наложенные вместе с уроном: его они не слышат
 * @param deathSaveHits - удары для спасбросков от смерти — до среза по потере
 *   хитов: у лежащего на нуле потеря всегда ноль
 * @returns общий исход
 */
function withDamageEvents(
  entity: DnDSceneEntity,
  hpBefore: number,
  hits: readonly DamageHit[],
  context: SystemTriggerContext | undefined,
  base: SystemDeferredTriggerResult,
  newEffectIds?: ReadonlySet<string>,
  deathSaveHits: readonly DamageHit[] = hits,
): SystemDeferredTriggerResult {
  // Урон по лежащему на нуле — провалы спасбросков от смерти
  const deathSave = settleDeathSaveDamage(entity, hpBefore, deathSaveHits);

  const withDeathSave = deathSave
    ? mergeTriggerResults(base, {
        changed: true,
        chatSummary: formatDeathSaveSummary(entity.name, deathSave, 'damage'),
      })
    : base;

  if (hits.length === 0) {
    return withDeathSave;
  }

  const events = settleDamageEvents(entity, hits, {
    ...buildTriggerEventOptions(entity, context),
    hpBefore,
    newEffectIds,
  });

  return mergeTriggerResults(
    withDeathSave,
    toDamageEventsTriggerResult(entity, events),
  );
}

/**
 * С чем прогоняются события урона и наложения у сущности.
 *
 * @param entity - субъект
 * @param context - возможности ядра
 * @returns опции событий
 */
function buildTriggerEventOptions(
  entity: DnDSceneEntity,
  context: SystemTriggerContext | undefined,
): TriggerEventOptions {
  return {
    requestRoll: context?.requestRoll,
    ambientEffects: toAmbientResolver(context)(entity),
    inCombat: context?.isInCombat?.(entity) ?? false,
    activeTurnActorId: context?.getActiveTurnActorId?.() ?? null,
    getEntity: toDndEntityResolver(context?.getEntity),
    endCast: toCastEnder(context, entity.id),
    // Соседей по сцене даёт ядро; старое ядро их не знает — в радиусе никого
    listEntitiesInArea: (subject, area) =>
      findEntitiesInArea(
        context?.getSceneSurroundings?.(subject),
        area,
        subject,
      ),
  };
}

/**
 * Ауры чужих токенов из контекста ядра в форме D&D. Старое ядро аур не отдаёт —
 * тогда их нет.
 *
 * @param context - контекст срабатывания от ядра
 * @returns функция: сущность → её ауры
 */
function toAmbientResolver(
  context: SystemTriggerContext | undefined,
): (entity: SceneEntity) => ActiveEffect[] {
  return (entity) =>
    (context?.resolveAmbientEffects?.(entity) ?? []).filter(isDnDEffect);
}

/**
 * Конец каста эффекта через ядро: каст закончит заклинатель, наложивший
 * эффект. Старое ядро касты не заканчивает — тогда снимается только сам эффект.
 *
 * @param context - контекст срабатывания от ядра
 * @param carrierId - носитель эффекта: заклинатель, если наложивший неизвестен
 * @returns функция: эффект → закончить его каст
 */
function toCastEnder(
  context: SystemTriggerContext | undefined,
  carrierId: string,
): ((effect: ActiveEffect) => void) | undefined {
  const endCasts = context?.endCasts;

  if (!endCasts) {
    return undefined;
  }

  return (effect) => {
    if (effect.castId) {
      endCasts(effect.sourceActorId ?? carrierId, [effect.castId]);
    }
  };
}

/**
 * Снимает истёкшие эффекты и заканчивает касты меток концентрации, которые
 * истекли вместе с ними.
 *
 * @param entity - сущность
 * @param context - контекст срабатывания от ядра
 * @param expire - снятие истёкших эффектов
 * @returns изменилась ли сущность
 */
function expireWithConcentration(
  entity: DnDSceneEntity,
  context: SystemTriggerContext | undefined,
  expire: (entity: DnDSceneEntity) => boolean,
): boolean {
  const before = listConcentrationEffects(entity.activeEffects);
  const changed = expire(entity);

  const remaining = new Set(
    listConcentrationEffects(entity.activeEffects).map((effect) => effect.id),
  );

  const endCast = toCastEnder(context, entity.id);

  for (const effect of before) {
    if (!remaining.has(effect.id)) {
      endCast?.(effect);
    }
  }

  return changed;
}

/**
 * Исход срабатываний одной сущности в контракте ядра: сводка, ожидания ответа и
 * события урона от нанесённого урона.
 *
 * @param entity - сущность
 * @param outcome - что изменили срабатывания
 * @param hpBefore - хиты до срабатываний
 * @param label - подпись момента («область», «аура»)
 * @param context - возможности ядра
 * @returns исход для ядра
 */
function toEntityTriggerResult(
  entity: DnDSceneEntity,
  outcome: AreaEffectsSyncResult,
  hpBefore: number,
  label: string,
  context: SystemTriggerContext | undefined,
): SystemDeferredTriggerResult {
  return withDamageEvents(
    entity,
    hpBefore,
    toDamageHits(outcome.damageOutcomes),
    context,
    {
      changed: outcome.changed,
      chatSummary: formatEffectsSummary(
        entity.name,
        label,
        outcome.damageOutcomes,
        outcome.saveOutcomes,
        formatEntrySaveStatus,
        outcome.healingOutcomes,
      ),
      ...effectRollsField(
        entity.name,
        outcome.damageOutcomes,
        outcome.healingOutcomes,
      ),
      deferred: toSystemDeferredTriggers(
        outcome.deferred,
        formatEntryDeferredSummary(label),
        context,
      ),
    },
  );
}

/** Подпись момента в сводке срабатываний конца каста */
const CAST_END_SUMMARY_LABEL = 'конец заклинания';

/** Кто просит спасбросок срабатывания конца каста */
const CAST_END_REQUESTER_LABEL = 'Конец заклинания';

/**
 * Эффект снят вместе с кастом — снимать его срабатывание уже нечего, а счётчик
 * лимита общий с эффектом на сущности.
 */
const REMOVED_CAST_EFFECT_SOURCE_KIND: EffectTriggerSourceKind = {
  ...EFFECT_TRIGGER_SOURCE_KINDS.instance,
  instance: false,
};

/**
 * Срабатывания «когда заклинание заканчивается» у снятых эффектов каста:
 * наложенное ими переживает каст («Ускорение» — вялость после конца).
 *
 * @param entity - сущность, с которой сняты эффекты
 * @param removed - снятые эффекты каста
 * @param hpBefore - хиты до срабатываний
 * @param context - возможности ядра
 * @returns исход для ядра
 */
function runCastEndTriggers(
  entity: DnDSceneEntity,
  removed: readonly ActiveEffect[],
  hpBefore: number,
  context: SystemTriggerContext | undefined,
): SystemDeferredTriggerResult {
  const sources = buildTriggerSources(
    removed,
    REMOVED_CAST_EFFECT_SOURCE_KIND,
    (effect) => listEffectEventTriggers(effect, 'castEnd'),
  );

  if (sources.length === 0) {
    return { changed: false, chatSummary: null };
  }

  const outcome = runPresenceTriggerSources(entity, sources, {
    requestRoll: context?.requestRoll,
    inCombat: context?.isInCombat?.(entity) ?? false,
    requesterLabel: CAST_END_REQUESTER_LABEL,
    effectOptions: {
      ambientEffects: toAmbientResolver(context)(entity),
      activeTurnActorId: context?.getActiveTurnActorId?.() ?? null,
      detachFromCast: true,
    },
  });

  return toEntityTriggerResult(
    entity,
    outcome,
    hpBefore,
    CAST_END_SUMMARY_LABEL,
    context,
  );
}

/** Подпись момента в сводке срабатываний броска атаки */
const ATTACK_ROLL_SUMMARY_LABEL = 'атака';

/** Что изменили срабатывания броска атаки у одной сущности */
interface AttackRollEntityOutcome extends AreaEffectsSyncResult {
  entity: DnDSceneEntity;
}

/**
 * Бросок атаки от клиента: срабатывания атакующего и целей, которые не
 * выполнил клиент, — со спасброском, уроном, концом каста и действиями другой
 * стороне. Событие шлёт тот, кто управляет атакующим; урон самой атаки к этому
 * времени уже записан — сокет сохраняет порядок сообщений.
 *
 * @param event - событие броска атаки
 * @param context - возможности ядра и права отправителя
 * @returns исход по каждой изменённой сущности
 */
function settleAttackRollEvent(
  event: Extract<SystemClientEvent, { type: 'attackRoll' }>,
  context: SystemClientEventContext,
): SystemRelatedTriggerResult[] {
  const resolve = toDndEntityResolver(context.getEntity);
  const attacker = resolve(event.attackerId);

  if (!attacker || !context.canControl(attacker)) {
    return [];
  }

  const targets = event.targetIds.flatMap((targetId) => {
    const target = resolve(targetId);

    return target ? [target] : [];
  });

  const hpBefore = new Map(
    [attacker, ...targets].map((entity) => [
      entity.id,
      resolveEntityCurrentHp(entity),
    ]),
  );

  const outcomes = new Map<string, AttackRollEntityOutcome>();

  const outcomeOf = (entity: DnDSceneEntity): AttackRollEntityOutcome => {
    const existing = outcomes.get(entity.id);

    if (existing) {
      return existing;
    }

    const created: AttackRollEntityOutcome = {
      entity,
      changed: false,
      damageOutcomes: [],
      healingOutcomes: [],
      saveOutcomes: [],
      deferred: [],
    };

    outcomes.set(entity.id, created);

    return created;
  };

  // Другая сторона атакующего однозначна только при одной цели
  const sides = [
    {
      subject: attacker,
      role: 'attacker' as const,
      other: targets.length === 1 ? targets[0] : undefined,
    },
    ...targets.map((target) => ({
      subject: target,
      role: 'target' as const,
      other: attacker,
    })),
  ];

  for (const side of sides) {
    const events = settleAttackRollTriggers(side.subject, side.role, {
      other: side.other,
      roll: {
        hasAdvantage: event.rollMode === 'advantage',
        hasDisadvantage: event.rollMode === 'disadvantage',
      },
      requestRoll: context.requestRoll,
      ambientEffects: toAmbientResolver(context)(side.subject),
      inCombat: context.isInCombat?.(side.subject) ?? false,
      activeTurnActorId: context.getActiveTurnActorId?.() ?? null,
      endCast: toCastEnder(context, side.subject.id),
    });

    const subject = outcomeOf(side.subject);

    subject.changed ||= events.changed;
    subject.damageOutcomes.push(...events.damageOutcomes);
    subject.healingOutcomes.push(...events.healingOutcomes);
    subject.saveOutcomes.push(...events.saveOutcomes);
    subject.deferred.push(...events.deferred);

    for (const related of events.related) {
      const other = outcomeOf(related.entity);

      other.changed ||= related.changed;
      other.damageOutcomes.push(...related.damageOutcomes);
      other.healingOutcomes.push(...related.healingOutcomes);
      other.saveOutcomes.push(...related.saveOutcomes);
    }
  }

  return [...outcomes.values()]
    .filter(
      (outcome) =>
        outcome.changed
        || outcome.deferred.length > 0
        || outcome.saveOutcomes.length > 0,
    )
    .map((outcome) => ({
      entity: outcome.entity,
      ...toEntityTriggerResult(
        outcome.entity,
        outcome,
        hpBefore.get(outcome.entity.id) ?? 0,
        ATTACK_ROLL_SUMMARY_LABEL,
        context,
      ),
    }));
}

/** Подпись снятых эффектов закончившегося каста в чате */
const CAST_ENDED_SUMMARY_PREFIX = 'Каст закончился — сняты: ';

/**
 * Участие наложившего в бою из контекста ядра. Старое ядро не знает ни
 * сущностей, ни боя — тогда наложивший «не в бою», и срабатывание «ход
 * наложившего» идёт на ходу носителя.
 *
 * @param context - контекст срабатывания от ядра
 * @returns функция: id наложившего → участвует ли он в бою
 */
function toSourceInCombatResolver(
  context: SystemTriggerContext | undefined,
): (sourceId: string) => boolean {
  return (sourceId) => {
    const source = context?.getEntity?.(sourceId);

    return source !== undefined && context?.isInCombat?.(source) === true;
  };
}

/**
 * Прогоняет срабатывания хода сущности и спрашивает у игрока отложенные
 * спасброски. Общее тело хода носителя и хода наложившего: разные у них только
 * отбор срабатываний, подпись в чате и ключ ожидания ответа.
 *
 * @param entity - сущность, чьи эффекты проверяются
 * @param timing - начало или конец хода
 * @param context - возможности ядра
 * @param pendingKeys - спасброски, уже ждущие ответа игрока
 * @param sourceTurnActorId - чей ход, если это ход наложившего
 * @returns изменения, сводка и отложенные срабатывания
 */
function settleTurnEffects(
  entity: SceneEntity,
  timing: EffectSaveTiming,
  context: SystemTriggerContext | undefined,
  pendingKeys: Set<string>,
  sourceTurnActorId?: string,
): SystemDeferredTriggerResult {
  if (!isDndSceneEntity(entity)) {
    return { changed: false, chatSummary: null };
  }

  const requestRoll = context?.requestRoll;
  const askOwner = shouldRequestEffectSave(entity, requestRoll);
  const turnOf = sourceTurnActorId === undefined ? 'subject' : 'source';
  const hpBefore = resolveEntityCurrentHp(entity);
  const ambientEffects = toAmbientResolver(context)(entity);
  const endCast = toCastEnder(context, entity.id);

  const result = processTurnEffects(entity, timing, {
    deferRecurringSave: () => askOwner,
    deferRecurringDamageSave: () => askOwner,
    ambientEffects,
    sourceTurnActorId,
    isSourceInCombat: toSourceInCombatResolver(context),
    endCast,
  });

  // Ответ игрока накладывает и заканчивает каст так же, как бросок сервера
  const answerOptions: EntryEffectOptions = {
    ambientEffects,
    activeTurnActorId: sourceTurnActorId ?? entity.id,
    endCast,
  };

  const chatSummary = formatTurnEffectsMessage(
    entity.name,
    timing,
    result,
    turnOf,
  );

  const hits = toDamageHits(result.damageOutcomes);

  const rolls = effectRollsField(
    entity.name,
    result.damageOutcomes,
    result.healingOutcomes,
  );

  if (!askOwner) {
    return withDamageEvents(entity, hpBefore, hits, context, {
      changed: result.changed,
      chatSummary,
      ...rolls,
    });
  }

  // Один эффект срабатывает и на своём ходу, и на ходу наложившего — ответы
  // этих границ ждутся порознь
  const turnKey =
    sourceTurnActorId === undefined
      ? timing
      : `${timing}:${SOURCE_TURN_SAVE_KEY}:${sourceTurnActorId}`;

  const deferred: EngineDeferredTrigger[] = [];

  // Урон каждый ход идёт раньше повторного спасброска — в том же порядке, что
  // и при броске на сервере. Ключ ожидания старых полей прежний; явным
  // срабатываниям нужен и id срабатывания — их у эффекта может быть несколько
  const requests = [
    ...result.deferredTriggers.filter(
      (turnTrigger) => turnTrigger.stage === 'damage' && !turnTrigger.ambient,
    ),
    ...result.deferredTriggers.filter(
      (turnTrigger) => turnTrigger.stage === 'damage' && turnTrigger.ambient,
    ),
    ...result.deferredTriggers.filter(
      (turnTrigger) => turnTrigger.stage === 'effects',
    ),
  ].map((turnTrigger) => {
    const stageKey =
      turnTrigger.stage === 'damage'
        ? `${entity.id}:${turnTrigger.effect.id}:${turnKey}:${TURN_DAMAGE_SAVE_KEY}`
        : `${entity.id}:${turnTrigger.effect.id}:${turnKey}`;

    return {
      pendingKey: isLegacyTrigger(turnTrigger.trigger)
        ? stageKey
        : `${stageKey}:${turnTrigger.trigger.id}`,
      request: () =>
        requestTurnTriggerSave(
          entity,
          turnTrigger,
          timing,
          requestRoll,
          answerOptions,
        ),
    };
  });

  for (const { pendingKey, request } of requests) {
    if (pendingKeys.has(pendingKey)) {
      continue;
    }

    const trigger = request();

    if (!trigger) {
      continue;
    }

    pendingKeys.add(pendingKey);

    // Ответ пришёл (или запрос завершился иначе) — следующий спасбросок этого
    // эффекта снова можно спрашивать
    void trigger.resolution.finally(() => {
      pendingKeys.delete(pendingKey);
    });

    deferred.push(trigger);
  }

  return withDamageEvents(entity, hpBefore, hits, context, {
    changed: result.changed,
    chatSummary,
    ...rolls,
    deferred: toSystemDeferredTriggers(
      deferred,
      (outcomeEntity, outcome) =>
        formatDeferredEffectsSummary(
          outcomeEntity.name,
          resolveTurnSummaryLabel(timing, turnOf),
          outcome,
          formatRecurringSaveStatus,
        ),
      context,
    ),
  });
}

/** Подписи типов существ по ключу (для форматтера компендиума) */
const CREATURE_TYPE_LABELS: Record<string, string> = CREATURE_CATEGORIES;

/** Подписи классов по ключу (для форматтера компендиума) */
const CLASS_LABELS: Record<string, string> = Object.fromEntries(
  CLASS_KEY_OPTIONS.map((option) => [option.value, option.label]),
);

/**
 * Парсит показатель опасности (ПО) в число для сортировки.
 * Пусто/«—» → -1 (идут первыми); поддерживает дроби «1/8», «1/4», «1/2».
 *
 * @param cr - строковое значение challengeRating
 */
function parseChallengeRating(cr: string): number {
  if (!cr || cr === '—') {
    return -1;
  }

  if (cr.includes('/')) {
    const [numerator, denominator] = cr.split('/');
    const denominatorValue = Number(denominator);

    if (denominatorValue) {
      return Number(numerator) / denominatorValue;
    }
  }

  const parsed = Number(cr);

  return Number.isNaN(parsed) ? -1 : parsed;
}

/**
 * Сужает эффекты аур к D&D-форме: контракт отдаёт их нейтральной базой, а
 * считать по ним скорость может только движок своей системы.
 *
 * @param ambientEffects - эффекты аур в нейтральной форме ядра
 * @returns эффекты, которые движок узнаёт
 */
function collectDndAmbientEffects(
  ambientEffects: readonly BaseActiveEffect[],
): ActiveEffect[] {
  return ambientEffects.filter(isDnDEffect);
}

/**
 * Сущности, о которых уже пожаловались: предупреждение нужно один раз на
 * сущность, а гейт движения спрашивают на каждом захвате токена мышью.
 */
const unreadableEntityIds = new Set<string>();

/**
 * Жалуется на сущность, которую движок не узнаёт.
 *
 * Для реквизита и декораций это норма и молчание правильно, но лист с
 * характеристиками не числами выглядит целым, а токен его не двигается вовсе —
 * и понять это без подсказки неоткуда.
 *
 * @param entity - сущность сцены
 */
function warnUnreadableEntity(entity: SceneEntity): void {
  if (entity.entityType !== 'actor' && entity.entityType !== 'creature') {
    return;
  }

  if (unreadableEntityIds.has(entity.id)) {
    return;
  }

  unreadableEntityIds.add(entity.id);

  console.warn(
    `[dnd5e] Лист «${entity.name}» (${entity.id}) не читается как D&D: `
      + 'шесть характеристик должны быть числами. Токен такого листа ядро не '
      + 'двигает — скорость посчитать не по чему',
  );
}

/**
 * Форматтеры значений компендиума D&D по имени формата. Управляют подписью
 * и сортировкой опций фильтров и заголовков разделов в обобщённом движке
 * отображения (`useCompendiumView`).
 */
const COMPENDIUM_VALUE_FORMATTERS: Record<string, CompendiumValueFormatter> = {
  spellLevel: {
    label: (value) =>
      Number(value) === 0 ? 'Заговоры' : `${Number(value)} круг`,
    shortLabel: (value) => String(Number(value)),
    sortKey: (value) => Number(value),
  },
  challengeRating: {
    label: (value) => {
      const cr = String(value ?? '');

      return !cr || cr === '—' ? 'ПО — (без уровня опасности)' : `ПО ${cr}`;
    },
    shortLabel: (value) => {
      const cr = String(value ?? '');

      return cr && cr !== '—' ? cr : '—';
    },
    sortKey: (value) => parseChallengeRating(String(value ?? '')),
  },
  creatureType: {
    label: (value) => CREATURE_TYPE_LABELS[String(value)] ?? String(value),
    sortKey: (value) => CREATURE_TYPE_LABELS[String(value)] ?? String(value),
  },
  spellClass: {
    label: (value) => CLASS_LABELS[String(value)] ?? String(value),
    sortKey: (value) => CLASS_LABELS[String(value)] ?? String(value),
  },
};

/**
 * Проверяет, что значение — запись, по которой строится сводка механических
 * даров (черта, предмет-черта или предыстория). Все три формы адресуются по
 * названию, а остальные поля `buildFeatGrantsSummary` читает защитно.
 *
 * @param value - запись из контракта ядра
 * @returns `true`, если по записи можно строить сводку
 */
function isFeatSummarySource(
  value: unknown,
): value is Feature | DnDGameItem | BackgroundDefinition {
  return isRecord(value) && typeof value.name === 'string';
}

/**
 * Разбирает контекст входящей атаки, приходящий от ядра непрозрачным
 * значением: КД цели зависит от вида атаки (условные бонусы «+2 против
 * дальнобойных»), а чужой вид атаки такой бонус молча включил бы.
 *
 * @param value - контекст атаки из контракта ядра
 * @returns контекст атаки либо `undefined`, если вида атаки в нём нет
 */
function parseAttackContext(value: unknown): IncomingAttackContext | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const { attackType } = value;

  if (
    attackType === 'melee'
    || attackType === 'ranged'
    || attackType === 'spell'
  ) {
    return { attackType };
  }

  return undefined;
}

/**
 * Type-guard: запись компендиума — заклинание (для предиката лечения).
 *
 * @param entry - проверяемая запись
 */
function isSpellEntry(entry: unknown): entry is Spell {
  return isRecord(entry) && entry.type === 'spell';
}

/**
 * Производные булевы предикаты компендиума по ключу — для фильтров, которые
 * нельзя выразить одним полем (лечение определяется по частям урона).
 */
const COMPENDIUM_PREDICATES: Record<string, (entry: unknown) => boolean> = {
  spellHealing: (entry) =>
    isSpellEntry(entry)
    && getSpellDamageParts(entry).some((part) => damagePartIsHealing(part)),
};

/**
 * Игровая система D&D 5e (Ядро правил).
 * Предоставляет Ядру (Core VTT) абстрагированные методы для работы
 * с Инициативой, Боевкой и т.д.
 */
export class Dnd5eVttSystem implements VttSystem {
  readonly id = 'dnd5e-2024';

  readonly name = 'Dungeons & Dragons 5th Edition';

  readonly version = '0.8.60';

  /**
   * Выполняет валидацию данных актера по правилам системы D&D 5e.
   *
   * Строение списка эффектов разбирает схема, и её отказ отвергает сохранение
   * целиком. Нечитаемое значение строки — не повод для отказа: такие строки
   * встречаются в старых записях, и запрет их сохранять запер бы весь лист.
   * Движок такую строку просто не применяет, а здесь она попадает в лог мира —
   * иначе о ней не узнать ниоткуда.
   *
   * @param actor Объект актера для валидации
   */
  // eslint-disable-next-line class-methods-use-this
  validateActor(actor: BaseActor): void {
    if (!Array.isArray(actor.activeEffects)) {
      return;
    }

    // Схема и разбирает список, и типизирует его: дальше `changes` читаются
    // из её результата, а не из непрозрачной нейтральной базы
    const effects = ActiveEffectsArraySchema.parse(actor.activeEffects);

    for (const effect of effects) {
      for (const change of effect.changes) {
        // Строка без выбранного ключа заведена ради условия — значения у неё
        // ещё нет, и ругаться на него рано
        if (change.key === '') {
          continue;
        }

        // Кость-формулы бонус-урона («1к6») числом не считаются вовсе: их
        // катает бросок, и разбор формулы им не указ — как и в самом пайплайне
        if (isDiceFormulaValue(change.value)) {
          continue;
        }

        const result = validateFormula(change.value);

        if (!result.valid) {
          console.warn(
            `[dnd5e] Лист «${actor.name}» (${actor.id}), эффект «${effect.name}», `
              + `модификатор «${change.key}»: значение "${change.value}" не читается `
              + `(${result.error}) — строка не применяется`,
          );
        }
      }
    }
  }

  /**
   * Возвращает шаблон нового актёра D&D 5e по умолчанию (без `id`).
   *
   * Копия глубокая: при мелкой вложенные `system`/`token`/массивы остались бы
   * общими с константой-шаблоном, и правки одного созданного актёра меняли бы
   * и шаблон, и всех созданных по нему следом.
   */
  // eslint-disable-next-line class-methods-use-this
  createDefaultActor(): Partial<BaseActor> {
    return structuredClone(DEFAULT_ACTOR);
  }

  /**
   * Валидирует данные актёра D&D 5e для формы создания/редактирования.
   */
  // eslint-disable-next-line class-methods-use-this
  validateActorData(actor: Partial<BaseActor>): void {
    validateDndActorData(actor);
  }

  /**
   * Нормализует частичные данные актёра D&D 5e (зажимает значения в границы).
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeActorData(actor: Partial<BaseActor>): Partial<BaseActor> {
    return normalizeDndActorData(actor);
  }

  /**
   * Структурно валидирует данные предмета D&D 5e через Zod-схему (обобщённый
   * конверт + лениво по типу). Бросает `Error` при нарушении.
   */
  // eslint-disable-next-line class-methods-use-this
  validateItemData(item: unknown): void {
    validateGameItem(item);
  }

  /**
   * Строит Markdown-сводку механических даров черты/предмета/предыстории D&D 5e.
   */
  // eslint-disable-next-line class-methods-use-this
  getFeatGrantsSummary(feat: unknown): string {
    return isFeatSummarySource(feat) ? buildFeatGrantsSummary(feat) : '';
  }

  /**
   * Вычисляет модификатор инициативы для D&D 5e с учетом баффов и дебаффов (Active Effects).
   */
  // eslint-disable-next-line class-methods-use-this
  getInitiativeModifier(actor: BaseActor): number {
    // Актёр без данных системы в инициативу не вступает: считать её не по чему
    if (!isDndSceneEntity(actor)) {
      return 0;
    }

    // Вызываем полный пайплайн активных эффектов, чтобы получить итоговое значение инициативы
    const resolvedStats = resolveActorStats(actor);

    return resolvedStats.initiative;
  }

  /**
   * Совершает бросок инициативы (1к20 + модификатор)
   */
  rollInitiative(
    actor: BaseActor,
    rollFn?: (formula: string) => DiceRollData,
  ): SystemRollResult {
    const modifier = this.getInitiativeModifier(actor);

    if (rollFn) {
      // Клиент: Делаем бросок через стор (DiceRoller)
      const rollData = rollFn('1к20');

      return {
        roll: rollData.total, // Это чистое значение кубика от 1 до 20
        modifier,
        total: rollData.total + modifier,
        rollData,
      };
    }

    // Сервер (или если rollFn не передан): Автоматический математический бросок
    const roll = Math.floor(Math.random() * 20) + 1;

    return {
      roll,
      modifier,
      total: roll + modifier,
    };
  }

  /**
   * Инициализация системы (серверный lifecycle).
   * Пустая реализация по умолчанию — переопределяется серверным подклассом.
   */
  // eslint-disable-next-line class-methods-use-this
  init(_api: unknown): void {
    // Пустая реализация — override в серверном подклассе
  }

  /**
   * Повторные спасброски хода, ждущие ответа игрока: сущность, эффект и момент
   * хода. Пока ответа нет, тот же спасбросок на следующей такой же границе
   * хода не спрашивается второй раз.
   */
  private readonly pendingTurnSaveKeys = new Set<string>();

  /**
   * Уничтожение системы (серверный lifecycle): ожидания ответов остановленного
   * мира забываются.
   */
  destroy(): void {
    this.pendingTurnSaveKeys.clear();
  }

  /**
   * Прогоняет периодические эффекты сущности на границе хода (DoT-урон +
   * повторные спасброски D&D 5e) и возвращает флаг изменения и сводку для чата.
   *
   * Повторный спасбросок сущности без авто-спасбросков спрашивается у игрока:
   * ход не ждёт, исход приходит отложенным срабатыванием.
   */
  runTurnEffects(
    entity: SceneEntity,
    timing: 'startOfTurn' | 'endOfTurn',
    context?: SystemTriggerContext,
  ): SystemDeferredTriggerResult {
    return settleTurnEffects(entity, timing, context, this.pendingTurnSaveKeys);
  }

  /**
   * Прогоняет срабатывания «ход наложившего» у эффектов сущности, наложенных
   * участником `turnActorId`: «повторный спасбросок в конце хода заклинателя».
   * Спасбросок бросает носитель — у игрока его спрашивают так же, как на его
   * собственном ходу.
   */
  runSourceTurnEffects(
    entity: SceneEntity,
    turnActorId: string,
    timing: 'startOfTurn' | 'endOfTurn',
    context?: SystemTriggerContext,
  ): SystemDeferredTriggerResult {
    return settleTurnEffects(
      entity,
      timing,
      context,
      this.pendingTurnSaveKeys,
      turnActorId,
    );
  }

  /**
   * Снимает точные `turn`-эффекты на границе хода участника `turnActorId`.
   *
   * Состав боя нужен, чтобы отличить достижимый якорь-источник от недостижимого:
   * эффект «до конца хода кастера», которого нет в трекере инициативы, ждал бы
   * хода, который не наступит, — такой якорь деградирует к носителю.
   */
  // eslint-disable-next-line class-methods-use-this
  expireTurnEffects(
    entity: SceneEntity,
    turnActorId: string,
    timing: 'start' | 'end',
    participantIds: ReadonlySet<string>,
    context?: SystemTriggerContext,
  ): boolean {
    if (!isDndSceneEntity(entity)) {
      return false;
    }

    return expireWithConcentration(entity, context, (carrier) =>
      expireEntityTurnEffects(carrier, turnActorId, timing, participantIds),
    );
  }

  /**
   * Уменьшает длительность (в раундах) всех эффектов на сущности, снимая
   * истёкшие. Истёкшая метка концентрации заканчивает свой каст.
   */
  // eslint-disable-next-line class-methods-use-this
  decrementEffectDurations(
    entity: SceneEntity,
    context?: SystemTriggerContext,
  ): boolean {
    if (!isDndSceneEntity(entity)) {
      return false;
    }

    return expireWithConcentration(
      entity,
      context,
      decrementActorEffectDurations,
    );
  }

  /**
   * Снимает с сущности эффекты закончившихся кастов заклинателя: наложенные им
   * и с `castId` из списка. Эффекты других заклинателей не трогаются.
   */
  // eslint-disable-next-line class-methods-use-this -- хук контракта VttSystem: ядро вызывает его на экземпляре системы
  removeCastEffects(
    entity: SceneEntity,
    casterId: string,
    castIds: ReadonlySet<string>,
    context?: SystemTriggerContext,
  ): SystemDeferredTriggerResult {
    if (!isDndSceneEntity(entity)) {
      return { changed: false, chatSummary: null };
    }

    const effects = entity.activeEffects ?? [];
    const kept = withoutCastEffects(effects, casterId, castIds);

    if (kept.length === effects.length) {
      return { changed: false, chatSummary: null };
    }

    const removed = effects.filter((effect) => !kept.includes(effect));
    const hpBefore = resolveEntityCurrentHp(entity);

    entity.activeEffects = kept;

    const removal: SystemDeferredTriggerResult = {
      changed: true,
      chatSummary: `${entity.name}: ${CAST_ENDED_SUMMARY_PREFIX}${removed.map((effect) => effect.name).join(', ')}`,
    };

    return mergeTriggerResults(
      removal,
      runCastEndTriggers(entity, removed, hpBefore, context),
    );
  }

  /**
   * Событие правил от клиента: «прервать концентрацию» — закончить каст может
   * только тот, кто управляет заклинателем; бросок атаки — срабатывания, которые
   * выполняет сервер.
   */
  // eslint-disable-next-line class-methods-use-this -- хук контракта VttSystem: ядро вызывает его на экземпляре системы
  handleClientEvent(
    payload: unknown,
    context: SystemClientEventContext,
  ): SystemRelatedTriggerResult[] {
    const event = parseSystemClientEvent(payload);

    if (!event) {
      return [];
    }

    if (event.type === 'attackRoll') {
      return settleAttackRollEvent(event, context);
    }

    const caster = context.getEntity(event.casterId);

    if (caster && context.canControl(caster)) {
      context.endCasts?.(event.casterId, event.castIds);
    }

    return [];
  }

  /**
   * Разбирает эффекты зоны, которую прислал игрок (зона заклинания на месте
   * шаблона). Негодный список целиком отвергается: зона с «потерянными»
   * эффектами молча делала бы не то, что заклинание.
   *
   * @param raw - эффекты из черновика области
   * @returns проверенные эффекты или `null`
   */
  // eslint-disable-next-line class-methods-use-this
  parseAreaEffects(raw: unknown): ActiveEffect[] | null {
    const parsed = ActiveEffectsArraySchema.safeParse(raw);

    return parsed.success ? parsed.data : null;
  }

  /**
   * Синхронизирует эффекты зон при перемещении токена и форматирует сводку
   * сработавших триггеров для чата (метка «область»).
   */
  // eslint-disable-next-line class-methods-use-this
  syncAreaEffects(
    entity: SceneEntity,
    previousAreaIds: ReadonlySet<string>,
    currentAreaIds: ReadonlySet<string>,
    areas: CustomArea[],
    options?: SystemTriggerContext & {
      triggerOneShots?: boolean;
      alreadyEnteredAreaIds?: ReadonlySet<string>;
    },
  ): SystemDeferredTriggerResult {
    if (!isDndSceneEntity(entity)) {
      return { changed: false, chatSummary: null };
    }

    const hpBefore = resolveEntityCurrentHp(entity);

    const result = syncActorAreaEffects(
      entity,
      previousAreaIds,
      currentAreaIds,
      areas,
      { ...options, resolveAmbientEffects: toAmbientResolver(options) },
    );

    return toEntityTriggerResult(
      entity,
      result,
      hpBefore,
      AREA_SUMMARY_LABEL,
      options,
    );
  }

  /**
   * Обрабатывает разовые триггер-ауры при перемещении токена и форматирует по
   * каждой затронутой сущности сводку для чата (метка «аура»).
   */
  // eslint-disable-next-line class-methods-use-this
  applyAuraTriggerEffects(
    scene: { tokens?: Token[]; gridSettings?: GridSettings },
    movedToken: Token,
    movedEntity: SceneEntity,
    previousToken: Token | undefined,
    getEntity: (actorId: string) => SceneEntity | undefined,
    context?: SystemTriggerContext & { alreadyEnteredAuraKeys?: Set<string> },
  ): Array<SystemDeferredTriggerResult & { entity: SceneEntity }> {
    if (!isDndSceneEntity(movedEntity)) {
      return [];
    }

    const resolveEntity = toDndEntityResolver(getEntity);

    // Хиты до срабатываний у всех, кого аура может задеть: «хиты упали до 0»
    // знает только сравнение с ними
    const hpBefore = new Map(
      [
        movedEntity,
        ...(scene.tokens ?? []).map((token) => resolveEntity(token.actorId)),
      ]
        .filter((entity): entity is DnDSceneEntity => entity !== undefined)
        .map((entity) => [entity.id, resolveEntityCurrentHp(entity)]),
    );

    const outcomes = computeAuraTriggerEffects(
      scene,
      movedToken,
      movedEntity,
      previousToken,
      resolveEntity,
      {
        requestRoll: context?.requestRoll,
        resolveAmbientEffects: toAmbientResolver(context),
        isInCombat: context?.isInCombat,
        getActiveTurnActorId: context?.getActiveTurnActorId,
        alreadyEnteredAuraKeys: context?.alreadyEnteredAuraKeys,
      },
    );

    return outcomes.map((outcome) => ({
      entity: outcome.entity,
      ...toEntityTriggerResult(
        outcome.entity,
        outcome,
        hpBefore.get(outcome.entity.id) ?? 0,
        AURA_SUMMARY_LABEL,
        context,
      ),
    }));
  }

  /**
   * Проверяет попадание точки в область шаблона измерения по геометрии D&D 5e
   * (круг/конус/куб/линия).
   */
  // eslint-disable-next-line class-methods-use-this
  isPointInTemplate(
    pointX: number,
    pointY: number,
    gridSize: number,
    template: MeasurementTemplate,
  ): boolean {
    return isPointInTemplateGeometry(pointX, pointY, gridSize, template);
  }

  /**
   * Минимальный бросок кубиковой формулы урона D&D (сумма + выпавшие значения).
   */
  // eslint-disable-next-line class-methods-use-this
  rollDamageFormula(formula: string): { total: number; values: number[] } {
    return rollDamageFormulaImpl(formula);
  }

  /**
   * Собирает все аура-эффекты сущности (на самой сущности + с экипировки).
   */
  // eslint-disable-next-line class-methods-use-this
  collectAuraEffects(entity: SceneEntity): BaseActiveEffect[] {
    return isDndSceneEntity(entity) ? collectAllAuraEffects(entity) : [];
  }

  /**
   * Вычисляет внешние (ambient) аура-эффекты, накрывающие целевой токен.
   */
  // eslint-disable-next-line class-methods-use-this
  calculateAmbientAuras(
    targetToken: Token,
    sources: Array<{ token: Token; effects: BaseActiveEffect[] }>,
    gridSettings: GridSettings,
  ): BaseActiveEffect[] {
    // Границы системы D&D: нейтральные эффекты контракта — это D&D-эффекты
    // (`isDnDEffect` — доверенный шов системы к своим же данным).
    const dndSources = sources.map((source) => ({
      token: source.token,
      effects: source.effects.filter(isDnDEffect),
    }));

    return computeAmbientAuras(targetToken, dndSources, gridSettings);
  }

  /**
   * Суммарная скорость сущности по всем режимам движения с учётом эффектов —
   * ядро использует её как гейт «может ли токен двигаться» (0 — нельзя).
   *
   * Ауры с карты приходят отдельным списком: своими они сущности не являются, и
   * без них гейт считает не то же, что показывает лист, — аура, дающая скорость
   * неходячему, на листе видна, а токен ею не двинется.
   *
   * ⚠️ Хост этот аргумент пока НЕ передаёт: в его контракте у метода одна
   * сущность, а ауры лежат в его же сторе отдельно (README, § «Чего не хватает
   * для полноценного SDK», п. 16). Правка контракта — на стороне хоста, и
   * трогать его отсюда нельзя; со своей стороны метод к ней готов и посчитает
   * ауры в тот же день, когда они начнут приходить.
   *
   * @param entity - сущность токена
   * @param ambientEffects - эффекты аур, накрывающих токен
   */
  // eslint-disable-next-line class-methods-use-this
  getTotalMovementSpeed(
    entity: SceneEntity,
    ambientEffects: readonly BaseActiveEffect[] = [],
  ): number {
    // Сущность без данных системы правилами D&D не двигается: считать её
    // скорость не по чему, и ядро получит 0 вместо ошибки в обработчике хода.
    // У реквизита и декораций это норма, а вот лист с характеристиками не
    // числами так замирает молча — поэтому он и назван в предупреждении
    if (!isDndSceneEntity(entity)) {
      warnUnreadableEntity(entity);

      return 0;
    }

    return resolveTotalMovementSpeed(
      resolveActorStats(entity, collectDndAmbientEffects(ambientEffects)),
    );
  }

  /**
   * Дальность хода сущности за один ход — ядро красит по ней маршрут токена.
   *
   * Скорость по правилам D&D 2024 — это Скорость ходьбы. Существо, которое
   * ходить не умеет (парящее, плавающее, роющее), перемещается своим режимом,
   * поэтому при нулевой ходьбе берётся самый быстрый из остальных: иначе у
   * дракона в полёте зона хода схлопнулась бы в точку.
   *
   * «Рывок» даёт прибавку, равную Скорости, — отсюда удвоение предела.
   *
   * Ауры с карты приходят отдельным списком по той же причине, что и у
   * {@link getTotalMovementSpeed}, и с той же оговоркой: хост их пока не
   * передаёт, правка контракта — его.
   *
   * @param entity - сущность токена
   * @param ambientEffects - эффекты аур, накрывающих токен
   */
  // eslint-disable-next-line class-methods-use-this
  getMovementRange(
    entity: SceneEntity,
    ambientEffects: readonly BaseActiveEffect[] = [],
  ): MovementRange | null {
    // Сущность без данных системы считать не по чему
    if (!isDndSceneEntity(entity)) {
      return null;
    }

    const { movement } = resolveActorStats(
      entity,
      collectDndAmbientEffects(ambientEffects),
    );

    const base =
      movement.walk
      || Math.max(
        movement.fly || 0,
        movement.swim || 0,
        movement.climb || 0,
        movement.burrow || 0,
      );

    if (base <= 0) {
      return { base: 0, extended: 0 };
    }

    return { base, extended: base * 2 };
  }

  /**
   * Множитель цены клетки внутри зоны — труднопроходимая местность.
   *
   * Правило мастер задаёт строкой модификатора `terrain.movementCost` в
   * эффектах зоны, поэтому читается оно отсюда, а не из полей самой зоны.
   */
  // eslint-disable-next-line class-methods-use-this
  getAreaMovementCost(area: CustomArea): number {
    return resolveAreaTerrainCost(area);
  }

  /**
   * Не смотрит ли сущность на труднопроходимость вовсе (флаг
   * `terrain.ignoreDifficult` — сапоги, черта, форма движения).
   */
  // eslint-disable-next-line class-methods-use-this
  entityIgnoresTerrainCost(entity: SceneEntity): boolean {
    // Сущность без данных системы правилами D&D не описана: считать её
    // игнорирующей нельзя, иначе болото перестало бы работать на всех подряд
    if (!isDndSceneEntity(entity)) {
      return false;
    }

    return entityIgnoresTerrainCostImpl(entity);
  }

  /**
   * Снимает боевое состояние сущности D&D 5e (ХП и активные эффекты) для
   * отправки на сервер узким каналом `entity:apply-combat-state`.
   */
  // eslint-disable-next-line class-methods-use-this
  pickCombatState(entity: SceneEntity): DndCombatState | undefined {
    // Снимок сущности без данных системы не собрать, а выдумывать его нельзя —
    // он уходит на сервер и записывается в мир. `undefined` — штатный ответ
    // контракта: ядро откатится на полную замену сущности.
    return isDndSceneEntity(entity) ? pickCombatStateImpl(entity) : undefined;
  }

  /**
   * Записывает боевое состояние в сущность D&D 5e на сервере, проверив
   * пришедший от клиента снимок.
   */
  // eslint-disable-next-line class-methods-use-this
  applyCombatState(entity: SceneEntity, state: unknown): boolean {
    return isDndSceneEntity(entity)
      ? applyCombatStateImpl(entity, state)
      : false;
  }

  /**
   * Записывает боевой снимок и прогоняет события урона по его ударам. Удары
   * урезаются до того, что сущность действительно потеряла: снимок пришёл от
   * клиента.
   */
  // eslint-disable-next-line class-methods-use-this -- хук контракта VttSystem: ядро вызывает его на экземпляре системы
  settleCombatState(
    entity: SceneEntity,
    state: unknown,
    context?: SystemTriggerContext,
  ): SystemCombatStateResult {
    if (!isDndSceneEntity(entity)) {
      return REJECTED_COMBAT_STATE;
    }

    const hpBefore = resolveEntityCurrentHp(entity);
    const totalBefore = hpBefore + resolveEntityTempHp(entity);

    const effectIdsBefore = new Set(
      (entity.activeEffects ?? []).map((effect) => effect.id),
    );

    if (!applyCombatStateImpl(entity, state)) {
      return REJECTED_COMBAT_STATE;
    }

    // Подъём хитов закрывает серию спасбросков от смерти, падение — начинает
    syncDeathSavesWithHp(entity, hpBefore);

    const newEffectIds = new Set(
      (entity.activeEffects ?? [])
        .map((effect) => effect.id)
        .filter((effectId) => !effectIdsBefore.has(effectId)),
    );

    const loss =
      totalBefore
      - resolveEntityCurrentHp(entity)
      - resolveEntityTempHp(entity);

    const rawHits = isRecord(state) ? parseDamageHits(state.damage) : [];
    const hits = clampDamageHits(rawHits, loss);

    const damageResult = withDamageEvents(
      entity,
      hpBefore,
      hits,
      context,
      { changed: true, chatSummary: null },
      newEffectIds,
      rawHits,
    );

    const applied = settleAppliedEvents(
      entity,
      newEffectIds,
      hits,
      buildTriggerEventOptions(entity, context),
    );

    return {
      accepted: true,
      ...mergeTriggerResults(
        damageResult,
        toDamageEventsTriggerResult(
          entity,
          applied,
          APPLIED_EVENTS_SUMMARY_LABEL,
        ),
      ),
    };
  }

  /**
   * Применяет урон/лечение к сущности D&D 5e (мутирует ХП с учётом защит и
   * временных ХП) и возвращает сводку изменения.
   */
  // eslint-disable-next-line class-methods-use-this
  applyDamageToEntity(
    entity: SceneEntity,
    amount: number,
    isHealing: boolean,
    damageType?: string,
    details?: unknown,
  ): DamageApplyResult {
    // Сущность без данных системы урона не получает: её запас хитов неизвестен,
    // и выдуманное «после» ушло бы в метку и в чат как настоящее
    if (!isDndSceneEntity(entity)) {
      return { actorName: entity.name, hpBefore: 0, hpAfter: 0 };
    }

    return applyTargetDamageImpl(
      entity,
      amount,
      isHealing,
      damageType,
      details,
    );
  }

  /**
   * Накладывает эффекты на сущность D&D 5e (иммунитеты, condition-сборка,
   * слияние) и возвращает обновлённый список `activeEffects`.
   */
  // eslint-disable-next-line class-methods-use-this
  applyEffectsToEntity(
    entity: SceneEntity,
    effects: BaseActiveEffect[],
    origin: string,
  ): BaseActiveEffect[] {
    if (!isDndSceneEntity(entity) || !isEffectOrigin(origin)) {
      return entity.activeEffects ?? [];
    }

    return applyEffectsToEntityImpl(
      entity,
      effects.filter(isDnDEffect),
      origin,
    );
  }

  /**
   * Возвращает итоговый КД сущности D&D 5e с учётом контекста входящей атаки.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityArmorClass(entity: SceneEntity, attackContext?: unknown): number {
    if (!isDndSceneEntity(entity)) {
      return BASE_UNARMORED_AC;
    }

    return getEntityArmorClassImpl(entity, parseAttackContext(attackContext));
  }

  /**
   * Возвращает набор активных боевых флагов сущности D&D 5e.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityActiveFlags(entity: SceneEntity): ReadonlySet<string> {
    return isDndSceneEntity(entity)
      ? getEntityActiveFlagsImpl(entity)
      : new Set<string>();
  }

  /**
   * Переносит предмет из инвентаря отправителя в инвентарь получателя.
   *
   * Правило переноса живёт в движке ({@link transferItem}) и одно на все пути:
   * этот метод контракта зовёт ядро при перетаскивании токена на токен, а тот
   * же расчёт вызывает лист, на который предмет бросили мышью. Стороны — любые
   * сущности с инвентарём, а не только актёры.
   *
   * Права на перенос (владелец или ГМ) проверяет ядро — это правило VTT, а не
   * D&D, поэтому здесь их нет.
   *
   * @param source - сущность-отправитель
   * @param target - сущность-получатель
   * @param item - переносимый предмет
   * @returns обновлённые копии обеих сущностей либо `null`, если перенос невозможен
   */
  // eslint-disable-next-line class-methods-use-this
  transferItemBetweenEntities(
    source: SceneEntity,
    target: SceneEntity,
    item: BaseGameItem,
  ): { source: SceneEntity; target: SceneEntity } | null {
    return transferItem(source, target, item);
  }

  /**
   * Вычисляет итоговые характеристики актера с учетом активных эффектов.
   */
  // eslint-disable-next-line class-methods-use-this
  resolveActorStats(
    actor: BaseActor,
    effects?: readonly unknown[],
  ): Record<string, unknown> {
    if (!isDndSceneEntity(actor)) {
      return {};
    }

    const dndEffects = effects?.filter(isActiveEffect);

    // Копией, а не приведением: контракт ядра объявляет итог свободной записью,
    // а `ResolvedActorStats` — интерфейс без индексной сигнатуры, и структурно
    // он такой записи не соответствует. Тот же приём, что и в ядре для
    // `BaseGameItem`: туда, где ждут свободную форму, значение идёт копией.
    return { ...resolveActorStats(actor, dndEffects) };
  }

  /**
   * Собирает все активные эффекты, привязанные к актеру.
   */
  // eslint-disable-next-line class-methods-use-this
  collectActiveEffects(actor: BaseActor): readonly unknown[] {
    return isDndSceneEntity(actor) ? collectActiveEffects(actor) : [];
  }

  /**
   * Нормализует полного актёра D&D на месте при загрузке (миграция формата).
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeActor(actor: BaseActor): void {
    normalizeActor(actor);
  }

  /**
   * Выполняет нормализацию данных существа.
   *
   * Здесь же пересчитывается метка смерти: Ядро прогоняет существо через этот
   * метод при каждом изменении (создание и обновление на клиенте, загрузка мира
   * на сервере), поэтому череп на токене появляется и снимается одинаково,
   * какой бы путь ни поменял хиты.
   */
  // eslint-disable-next-line class-methods-use-this
  normalizeCreature(creature: BaseCreature): void {
    normalizeCreature(creature);
    syncCreatureDeathCondition(creature);
  }

  /**
   * Возвращает список доступных классов в системе для компендиума.
   */
  // eslint-disable-next-line class-methods-use-this
  getClassKeyOptions(): Array<{ value: string; label: string }> {
    return [...CLASS_KEY_OPTIONS];
  }

  /**
   * Возвращает форматтер значений компендиума по имени формата.
   */
  // eslint-disable-next-line class-methods-use-this
  getCompendiumValueFormatter(
    format: string,
  ): CompendiumValueFormatter | undefined {
    return COMPENDIUM_VALUE_FORMATTERS[format];
  }

  /**
   * Возвращает производный булев предикат компендиума по ключу.
   */
  // eslint-disable-next-line class-methods-use-this
  getCompendiumPredicate(
    key: string,
  ): ((entry: unknown) => boolean) | undefined {
    return COMPENDIUM_PREDICATES[key];
  }

  /**
   * Проверяет, активно ли конкретное состояние у актора.
   */
  // eslint-disable-next-line class-methods-use-this
  isConditionActive(
    activeEffects: readonly unknown[],
    conditionKey: string,
  ): boolean {
    return activeEffects
      .filter(isActiveEffect)
      .some(
        (effect) =>
          !(effect.aura && !effect.aura.applyToSelf)
          && resolveEffectConditionKey(effect) === conditionKey,
      );
  }

  /**
   * Переключает (добавляет/удаляет) состояние в списке эффектов актора.
   */

  toggleCondition(
    activeEffects: readonly unknown[],
    conditionKey: string,
    generateIdFn: (prefix: string) => string,
  ): unknown[] {
    const condition = getConditionEntry(conditionKey);

    if (!condition) {
      return [...activeEffects];
    }

    const effects = activeEffects.filter(isActiveEffect);

    if (this.isConditionActive(effects, conditionKey)) {
      return effects.filter(
        (effect) => resolveEffectConditionKey(effect) !== conditionKey,
      );
    } else {
      // Единый источник правды: builder проставляет conditionKey,
      // conditionImmunities и динамические changes Истощения.
      // Ключ берётся у найденного состояния, а не у входной строки: он уже
      // типизирован справочником, и лишняя проверка не нужна
      const newEffect = buildConditionActiveEffect(condition.key);

      if (!newEffect) {
        return [...effects];
      }

      newEffect.id = generateIdFn('effect');

      return [...effects, newEffect];
    }
  }

  /**
   * Определяет состояние здоровья по текущим и максимальным ХП по правилам системы.
   */
  // eslint-disable-next-line class-methods-use-this
  getHealthCondition(
    currentHp: number,
    maxHp: number,
    isActor?: boolean,
    customConditions?: unknown[],
  ):
    { key: string; nameEn: string; nameRu: string; color: string } | undefined {
    return getHealthCondition(
      currentHp,
      maxHp,
      isActor,
      isHealthConditionArray(customConditions) ? customConditions : undefined,
    );
  }

  /**
   * Возвращает таблицу состояний здоровья D&D 5e по умолчанию (пороги %ХП).
   */
  // eslint-disable-next-line class-methods-use-this
  getDefaultHealthConditions(): readonly HealthCondition[] {
    return HEALTH_CONDITIONS;
  }

  /**
   * Возвращает сводку ХП актёра для HUD выбранного токена (панель над сценой).
   * Читает `system.hitPoints` защитно из нейтрального блоба — ядро не знает
   * имён D&D-полей.
   *
   * Максимум берётся с учётом эффектов (ключ `hitPoints.max`) — тем же
   * расчётом, что у плитки хитов листа и у ограничения текущих хитов сверху.
   * Иначе после «Ложной жизни» HUD показывал бы 25/20: текущие хиты выше
   * собственного максимума.
   */
  // eslint-disable-next-line class-methods-use-this
  getActorHudSummary(actor: BaseActor): {
    hp: { current: number; max: number; temp: number };
  } {
    const hitPoints = isRecord(actor.system.hitPoints)
      ? actor.system.hitPoints
      : undefined;

    const baseMax = typeof hitPoints?.max === 'number' ? hitPoints.max : 0;

    return {
      hp: {
        current: typeof hitPoints?.current === 'number' ? hitPoints.current : 0,
        max: isDndSceneEntity(actor) ? resolveEntityMaxHp(actor) : baseMax,
        temp: typeof hitPoints?.temp === 'number' ? hitPoints.temp : 0,
      },
    };
  }

  /**
   * Возвращает хиты сущности для полосы и подписи НАД ТОКЕНОМ на сцене.
   *
   * Ядро читало `system.hitPoints` непрозрачным блобом и брало поле `max`, где
   * записан исходный запас листа. Но записанный максимум — не весь максимум:
   * эффект с ключом `hitPoints.max` («Помощь») поднимает потолок, и вылеченная
   * до 25 сущность с `max: 20` рисовалась над токеном как «25/20» — полоса
   * упиралась в край и спорила с листом.
   *
   * Поэтому максимум считается тем же `resolveEntityMaxHp`, что и плитка хитов
   * листа, лечение и ограничение текущих хитов сверху: разнобой не должен
   * вернуться с другой стороны. Текущие хиты — `resolveEntityCurrentHp`: у
   * существа без явного `current` это полный запас ЛИСТА (см. `hitPoints.ts`).
   *
   * Сущность не в форме D&D — `undefined`, ядро откатится на чтение блоба само.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityHitPoints(
    entity: SceneEntity,
  ): { current: number; max: number; temp: number } | undefined {
    if (!isDndSceneEntity(entity)) {
      return undefined;
    }

    return {
      current: resolveEntityCurrentHp(entity),
      max: resolveEntityMaxHp(entity),
      // Временные хиты необязательны у обоих видов сущностей — читаем защитно,
      // как это делает `getActorHudSummary`
      temp: resolveEntityTempHp(entity),
    };
  }

  /**
   * Возвращает бейдж «ПО X» (показатель опасности) для существа в списках ядра.
   * `undefined` — у существа нет показателя опасности.
   */
  // eslint-disable-next-line class-methods-use-this
  getEntityListBadge(creature: BaseCreature): string | undefined {
    const challengeRating = creature.system.challengeRating;

    // ПО хранится строкой ('1/4'), но в старых мирах/импортах встречается и
    // числом (normalizeCreature его к строке не коэрсит) — бейдж обязан
    // показываться в обоих случаях, как в UI до расшивки ядра.
    if (typeof challengeRating === 'number') {
      return `ПО ${challengeRating}`;
    }

    return typeof challengeRating === 'string' && challengeRating.length > 0
      ? `ПО ${challengeRating}`
      : undefined;
  }

  /**
   * Возвращает список всех доступных состояний: канон PHB плюс состояния,
   * заведённые в мире («Мастерская» → «Состояния»).
   */
  // eslint-disable-next-line class-methods-use-this
  getConditions(): ConditionDefinition[] {
    return listConditions().map((condition) => ({
      key: condition.key,
      label: condition.nameRu,
      icon: condition.icon,
      description: condition.description,
      systemId: 'dnd5e-2024',
      customImage: condition.customImage,
      overlay: condition.overlay,
    }));
  }
}

/** Экземпляр системы D&D 5e по умолчанию */
export const dnd5eSystemInstance = new Dnd5eVttSystem();
