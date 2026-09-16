/**
 * Позиционная боевая обработка эффектов D&D 5e: разовые триггеры зон
 * (`syncActorAreaEffects`) и триггер-аур (`applyAuraTriggerEffects`) при
 * перемещении токена — урон/спасбросок/статус на входе/выходе плюс реконсиляция
 * длящихся (`stay`) эффектов зон.
 *
 * Логика системо-зависима (модель `ActiveEffect`, спасброски, урон), поэтому
 * живёт в `system/dnd/`. Ядро (модули токенов/зон) вызывает её через контракт
 * `VttSystem` (`syncAreaEffects`/`applyAuraTriggerEffects`), не импортируя этот
 * файл напрямую — см. `docs/MULTI_SYSTEM_ARCHITECTURE.md`, Фаза 0 (§0.4).
 */

import type {
  CustomArea,
  GridSettings,
  ServerRollRequester,
  Token,
} from '@vtt/shared';

import type { ActiveEffect } from './activeEffectTypes.js';
import type { AuraSourceToken, TriggerAuraHit } from './auraMath.js';
import type { EngineDeferredTrigger } from './deferredEffectSaves.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { EffectTriggerSource } from './effectTriggerRunner.js';
import type {
  EntryEffectOptions,
  EntryEffectResult,
  TurnDamageOutcome,
  TurnSaveOutcome,
} from './turnEffects.js';

import { generateId, withTokenDisposition } from '@vtt/shared';

import {
  ACTIVE_EFFECT_ID_PREFIX,
  isDnDEffect,
  isEffectDormant,
} from './activeEffectTypes.js';
import {
  buildAmbientAuraEffectId,
  collectAllAuraEffects,
  collectTriggerAurasForTarget,
  isTriggerAura,
} from './auraMath.js';
import {
  requestEntryEffect,
  requestPresenceTriggerSave,
} from './deferredEffectSaves.js';
import {
  formatAuraRequesterLabel,
  formatZoneRequesterLabel,
  shouldRequestEffectSave,
} from './effectSaveAcquisition.js';
import {
  admitTrigger,
  listPresenceTriggerSources,
  resolveEntryEffect,
  rollTriggerSave,
  settlePresenceTrigger,
} from './effectTriggerRunner.js';
import { buildTriggerUsageScope } from './effectTriggerUsage.js';
import { passesLandingCondition } from './triggerConditions.js';

/**
 * Собирает ID областей, эффекты которых уже применены к актёру.
 *
 * @param entity - сущность для проверки
 * @returns Set с ID областей-источников
 */
export function getExistingAreaEffectIds(entity: DnDSceneEntity): Set<string> {
  const result = new Set<string>();

  if (entity.activeEffects) {
    for (const effect of entity.activeEffects) {
      if (effect.origin === 'area' && effect.originId) {
        result.add(effect.originId);
      }
    }
  }

  return result;
}

/** Ауры чужих токенов, накрывающие сущность прямо сейчас */
export type AmbientEffectsResolver = (
  entity: DnDSceneEntity,
) => readonly ActiveEffect[];

/**
 * Итог входа и выхода у сущности: синхронизации зон за перемещение или
 * срабатываний аур.
 */
export interface AreaEffectsSyncResult {
  /** Были ли изменения (добавлен/снят stay-эффект, нанесён урон, наложен статус) */
  changed: boolean;
  /** Исходы урона от триггеров входа/выхода — для подписи в чате */
  damageOutcomes: TurnDamageOutcome[];
  /** Исходы спасбросков от триггеров входа/выхода — для подписи в чате */
  saveOutcomes: TurnSaveOutcome[];
  /** Триггеры входа/выхода, чей спасбросок спросили у игрока */
  deferred: EngineDeferredTrigger[];
}

/** С чем срабатывает вход или выход у одной сущности */
export interface PresenceContext {
  /** Запрос броска от ядра: спасбросок сущности без авто-спасбросков — игроку */
  requestRoll?: ServerRollRequester;
  /** Сущность в бою: лимит «раз в ход / раунд» считается только в бою */
  inCombat: boolean;
  /** Кто просит спасбросок («Зона «Лунный луч»») */
  requesterLabel: string;
  /** Откуда пришли наложения и чей сейчас ход */
  effectOptions: EntryEffectOptions;
}

/**
 * Пустой итог входа и выхода.
 *
 * @returns итог без изменений
 */
function createPresenceOutcome(): AreaEffectsSyncResult {
  return { changed: false, damageOutcomes: [], saveOutcomes: [], deferred: [] };
}

/**
 * Добавляет итог одного срабатывания к общему.
 *
 * @param target - общий итог
 * @param part - итог срабатывания
 */
function mergePresenceOutcome(
  target: AreaEffectsSyncResult,
  part: AreaEffectsSyncResult,
): void {
  target.changed ||= part.changed;
  target.damageOutcomes.push(...part.damageOutcomes);
  target.saveOutcomes.push(...part.saveOutcomes);
  target.deferred.push(...part.deferred);
}

/**
 * Записывает исход срабатывания, выполненного на сервере.
 *
 * @param outcome - итог сущности
 * @param result - исход срабатывания
 */
function recordEntryResult(
  outcome: AreaEffectsSyncResult,
  result: EntryEffectResult,
): void {
  if (result.damageOutcome) {
    outcome.damageOutcomes.push(result.damageOutcome);
  }

  if (result.saveOutcome) {
    outcome.saveOutcomes.push(result.saveOutcome);
  }

  // Урон или повешенный статус — обе мутации требуют рассылки на клиент
  if (result.damageOutcome || result.statusApplied) {
    outcome.changed = true;
  }
}

/**
 * Разовый эффект входа или выхода старых полей (`areaTrigger`, спасбросок и
 * урон эффекта).
 *
 * @param entity - вошедший или вышедший
 * @param effect - эффект зоны или ауры
 * @param context - с чем срабатывает
 * @returns итог
 */
function runEntryEffect(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  context: PresenceContext,
): AreaEffectsSyncResult {
  const outcome = createPresenceOutcome();
  const { requestRoll, requesterLabel, effectOptions } = context;

  // Спасбросок бросает игрок — срабатывание ждёт его ответа
  if (effect.applySave && shouldRequestEffectSave(entity, requestRoll)) {
    const trigger = requestEntryEffect(
      entity,
      effect,
      requestRoll,
      requesterLabel,
      effectOptions,
    );

    if (trigger) {
      outcome.deferred.push(trigger);
    }

    return outcome;
  }

  recordEntryResult(outcome, resolveEntryEffect(entity, effect, effectOptions));

  return outcome;
}

/**
 * Явные срабатывания без данных события — вход и выход, конец каста: условие и
 * лимит, спасбросок на сервере или запросом игроку, урон и наложения.
 *
 * @param entity - вошедший или вышедший
 * @param sources - срабатывания с источником
 * @param context - с чем срабатывает
 * @returns итог
 */
export function runPresenceTriggerSources(
  entity: DnDSceneEntity,
  sources: readonly EffectTriggerSource[],
  context: PresenceContext,
): AreaEffectsSyncResult {
  const outcome = createPresenceOutcome();
  const { requestRoll, requesterLabel, effectOptions } = context;

  for (const source of sources) {
    if (!admitTrigger(entity, source, {}, context.inCombat)) {
      continue;
    }

    // Счётчик лимита записан на сущность — её надо сохранить
    if (source.trigger.limit) {
      outcome.changed = true;
    }

    if (source.trigger.save && shouldRequestEffectSave(entity, requestRoll)) {
      const request = requestPresenceTriggerSave(
        entity,
        source,
        requestRoll,
        requesterLabel,
        effectOptions,
      );

      if (request) {
        outcome.deferred.push(request);
      }

      continue;
    }

    const save = rollTriggerSave(entity, source, effectOptions.ambientEffects);

    recordEntryResult(
      outcome,
      settlePresenceTrigger(entity, source, save, effectOptions),
    );
  }

  return outcome;
}

/**
 * Вход или выход у одного эффекта зоны или ауры: разовый эффект старых полей и
 * явные срабатывания списка. Путь один на зону и ауру — разные у них только
 * источник счётчика лимита и подпись запроса броска.
 *
 * @param entity - вошедший или вышедший
 * @param effect - эффект зоны или ауры
 * @param event - вход или выход
 * @param scope - источник счётчика лимита (`area:<зона>`, `aura:<копия>`)
 * @param context - с чем срабатывает
 * @returns итог
 */
function runPresenceEvent(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  event: 'enter' | 'exit',
  scope: string,
  context: PresenceContext,
): AreaEffectsSyncResult {
  const outcome = createPresenceOutcome();

  // Условие наложения: вход или выход не касается того, на кого эффект не ложится
  if (!passesLandingCondition(effect, entity)) {
    return outcome;
  }

  if (effect.areaTrigger === event) {
    mergePresenceOutcome(outcome, runEntryEffect(entity, effect, context));
  }

  mergePresenceOutcome(
    outcome,
    runPresenceTriggerSources(
      entity,
      listPresenceTriggerSources(effect, event, scope),
      context,
    ),
  );

  return outcome;
}

/**
 * Синхронизирует area-эффекты для одного актёра на основе позиционного
 * перехода: какие области он покинул и в какие вошёл.
 *
 * - `stay`-эффекты (триггер не задан или `stay`) висят, пока токен внутри:
 *   добавляются при входе, снимаются реконсиляцией по текущим областям.
 * - `enter`/`exit`-эффекты — разовая нагрузка (урон/статус) в момент
 *   входа/выхода (`resolveEntryEffect`), на каждый вход/выход заново.
 *
 * Сравнение позиций (а не следов в `activeEffects`) нужно потому, что разовые
 * триггеры не оставляют следа — определить вход/выход можно лишь по геометрии.
 *
 * @param entity - сущность для синхронизации
 * @param previousAreaIds - ID областей в предыдущей позиции токена
 * @param currentAreaIds - ID областей в текущей позиции токена
 * @param areas - все области сцены (для получения списка эффектов)
 * @param options - опции синхронизации
 * @param options.triggerOneShots - проигрывать ли разовые enter/exit-триггеры
 *   (по умолчанию `true`); отключается при ре-синке после правки области (токен
 *   не двигался — урон/статус срабатывать не должны, нужна лишь реконсиляция
 *   stay-эффектов)
 * @param options.alreadyEnteredAreaIds - области, чей триггер входа уже
 *   отработал на этом перемещении. Ядро ведёт токен по маршруту клетка за
 *   клеткой, а урон входа по правилам берут «при первом входе за ход»:
 *   извилистый путь, дважды заходящий в одно болото, бьёт один раз. Триггеров
 *   выхода и реконсиляции stay набор не касается
 * @param options.requestRoll - запрос броска от ядра: спасбросок сущности без
 *   авто-спасбросков уходит игроку, а триггер — в `deferred`
 * @param options.resolveAmbientEffects - ауры чужих токенов, накрывающие
 *   сущность: учитываются в спасброске и иммунитетах срабатывания
 * @param options.isInCombat - участвует ли сущность в идущем бою: лимит
 *   срабатывания «раз в ход / раунд» считается только в бою. Без поля (старое
 *   ядро) — вне боя
 * @param options.getActiveTurnActorId - чей сейчас ход: состояние «до конца
 *   следующего хода», наложенное на ходу якоря, не спадает в конце этого хода
 * @returns изменения и исходы триггеров для чата
 */
export function syncActorAreaEffects(
  entity: DnDSceneEntity,
  previousAreaIds: ReadonlySet<string>,
  currentAreaIds: ReadonlySet<string>,
  areas: CustomArea[],
  options: {
    triggerOneShots?: boolean;
    alreadyEnteredAreaIds?: ReadonlySet<string>;
    requestRoll?: ServerRollRequester;
    resolveAmbientEffects?: AmbientEffectsResolver;
    isInCombat?: (entity: DnDSceneEntity) => boolean;
    getActiveTurnActorId?: () => string | null;
  } = {},
): AreaEffectsSyncResult {
  const {
    triggerOneShots = true,
    alreadyEnteredAreaIds,
    requestRoll,
    resolveAmbientEffects,
    isInCombat,
    getActiveTurnActorId,
  } = options;

  const outcome = createPresenceOutcome();

  if (!entity.activeEffects) {
    entity.activeEffects = [];
  }

  const enteredAreaIds = [...currentAreaIds].filter(
    (areaId) =>
      !previousAreaIds.has(areaId) && !alreadyEnteredAreaIds?.has(areaId),
  );

  const exitedAreaIds = [...previousAreaIds].filter(
    (areaId) => !currentAreaIds.has(areaId),
  );

  // Реконсиляция stay-эффектов: оставляем только для областей, где токен сейчас.
  // Снимает «зависшие» area-эффекты при выходе (в т.ч. при телепортации).
  const lengthBefore = entity.activeEffects.length;

  // Статус от входа в зону заклинания живёт, пока есть сама зона. Сверяется
  // только при ре-синке правки или удаления области: тогда `areas` — зоны той
  // же сцены, а при переходе на другую сцену список чужой, и статус снимался бы
  // зря
  const sceneAreaIds = triggerOneShots
    ? null
    : new Set(areas.map((area) => area.id));

  entity.activeEffects = entity.activeEffects.filter(
    (effect) =>
      !(
        effect.origin === 'area'
        && effect.originId
        && !currentAreaIds.has(effect.originId)
      )
      && !(
        sceneAreaIds
        && effect.endsWithAreaId
        && !sceneAreaIds.has(effect.endsWithAreaId)
      ),
  );

  if (entity.activeEffects.length !== lengthBefore) {
    outcome.changed = true;
  }

  /**
   * Вход или выход из зоны у одного её эффекта.
   *
   * @param effect - эффект зоны
   * @param area - зона
   * @param event - вход или выход
   */
  const runZoneEvent = (
    effect: ActiveEffect,
    area: CustomArea,
    event: 'enter' | 'exit',
  ): void => {
    const context: PresenceContext = {
      requestRoll,
      inCombat: isInCombat?.(entity) ?? false,
      requesterLabel: formatZoneRequesterLabel(area.name),
      effectOptions: {
        sourceAreaId: area.id,
        ambientEffects: resolveAmbientEffects?.(entity),
        activeTurnActorId: getActiveTurnActorId?.(),
      },
    };

    mergePresenceOutcome(
      outcome,
      runPresenceEvent(
        entity,
        effect,
        event,
        buildTriggerUsageScope('area', area.id),
        context,
      ),
    );
  };

  // Разовые триггеры выхода (только при перемещении)
  if (triggerOneShots) {
    for (const areaId of exitedAreaIds) {
      const area = areas.find((areaEntry) => areaEntry.id === areaId);

      if (!area?.effects) {
        continue;
      }

      for (const effect of area.effects.filter(isDnDEffect)) {
        if (isEffectDormant(effect)) {
          continue;
        }

        runZoneEvent(effect, area, 'exit');
      }
    }
  }

  // Реконсиляция stay-эффектов: добавляем недостающие для всех текущих областей
  // (работает и при входе токена, и при появлении/правке области под токеном).
  const existingStayAreaIds = getExistingAreaEffectIds(entity);

  for (const areaId of currentAreaIds) {
    if (existingStayAreaIds.has(areaId)) {
      continue;
    }

    const area = areas.find((areaEntry) => areaEntry.id === areaId);

    if (!area?.effects) {
      continue;
    }

    for (const effect of area.effects.filter(isDnDEffect)) {
      if (
        isEffectDormant(effect)
        || (effect.areaTrigger ?? 'stay') !== 'stay'
      ) {
        continue;
      }

      entity.activeEffects.push({
        ...effect,
        id: generateId(ACTIVE_EFFECT_ID_PREFIX),
        origin: 'area',
        originId: areaId,
        transfer: false,
        // Копия уже в зоне — доставка «в зону» на ней ничего не значит
        effectTarget: undefined,
        // Копия живёт, пока существо в зоне: своя длительность спала бы, и
        // следующая же синхронизация повесила бы эффект заново
        duration: { type: 'permanent' },
      });

      outcome.changed = true;
    }
  }

  // Разовые триггеры входа (только при перемещении)
  if (triggerOneShots) {
    for (const areaId of enteredAreaIds) {
      const area = areas.find((areaEntry) => areaEntry.id === areaId);

      if (!area?.effects) {
        continue;
      }

      for (const effect of area.effects.filter(isDnDEffect)) {
        if (isEffectDormant(effect)) {
          continue;
        }

        runZoneEvent(effect, area, 'enter');
      }
    }
  }

  return outcome;
}

/** Итог срабатывания триггер-аур по одной затронутой сущности */
export interface AuraTriggerOutcome extends AreaEffectsSyncResult {
  /** Затронутая сущность (живая ссылка из стейта мира) */
  entity: DnDSceneEntity;
}

/** Ключ членства токена в конкретной ауре: токен-источник + эффект */
function auraHitKey(hit: TriggerAuraHit): string {
  return `${hit.sourceTokenId}:${hit.effect.id}`;
}

/**
 * Обрабатывает разовые триггер-ауры (enter/exit) при перемещении токена.
 *
 * Перемещение влияет на членство в аурах двусторонне, поэтому считаем оба
 * случая по позиционному переходу (прошлая → текущая позиция):
 * 1. Перемещённый токен как ЦЕЛЬ — входит/выходит из аур других токенов.
 * 2. Перемещённый токен как ИСТОЧНИК — его ауры накрывают/освобождают другие
 *    токены (даже если те стоят на месте).
 *
 * @param scene - сцена с токенами и сеткой
 * @param scene.tokens - токены сцены
 * @param scene.gridSettings - настройки сетки
 * @param movedToken - токен после перемещения
 * @param movedEntity - сущность перемещённого токена
 * @param previousToken - токен до перемещения (для определения покинутых аур)
 * @param getEntity - резолвер сущности по actorId (живая ссылка из стейта)
 * @param options - возможности ядра на время срабатывания
 * @param options.requestRoll - запрос броска от ядра: спасбросок сущности без
 *   авто-спасбросков уходит игроку, а срабатывание — в `deferred`
 * @param options.resolveAmbientEffects - ауры чужих токенов, накрывающие
 *   затронутую сущность
 * @param options.isInCombat - участвует ли сущность в идущем бою (лимит «раз в
 *   ход / раунд»)
 * @param options.getActiveTurnActorId - чей сейчас ход (срок наложенного)
 * @param options.alreadyEnteredAuraKeys - входы в ауры, уже случившиеся за это
 *   перемещение: ядро ведёт фишку по шагам, и извилистый путь сквозь ауру
 *   входит в неё один раз. Набор пополняется
 * @returns исходы по каждой затронутой сущности (для рассылки и чата)
 */
export function applyAuraTriggerEffects(
  scene: { tokens?: Token[]; gridSettings?: GridSettings },
  movedToken: Token,
  movedEntity: DnDSceneEntity,
  previousToken: Token | undefined,
  getEntity: (actorId: string) => DnDSceneEntity | undefined,
  options: {
    requestRoll?: ServerRollRequester;
    resolveAmbientEffects?: AmbientEffectsResolver;
    isInCombat?: (entity: DnDSceneEntity) => boolean;
    getActiveTurnActorId?: () => string | null;
    alreadyEnteredAuraKeys?: Set<string>;
  } = {},
): AuraTriggerOutcome[] {
  const tokens = scene.tokens;
  const gridSettings = scene.gridSettings;

  if (!tokens || tokens.length === 0 || !gridSettings) {
    return [];
  }

  const {
    requestRoll,
    resolveAmbientEffects,
    isInCombat,
    getActiveTurnActorId,
    alreadyEnteredAuraKeys,
  } = options;

  const outcomes = new Map<string, AuraTriggerOutcome>();

  /** Имена сущностей по токенам — подпись источника ауры в запросе броска */
  const sourceNames = new Map<string, string>([
    [movedToken.id, movedEntity.name],
  ]);

  const getAccumulator = (targetEntity: DnDSceneEntity): AuraTriggerOutcome => {
    const existing = outcomes.get(targetEntity.id);

    if (existing) {
      return existing;
    }

    const created: AuraTriggerOutcome = {
      entity: targetEntity,
      changed: false,
      damageOutcomes: [],
      saveOutcomes: [],
      deferred: [],
    };

    outcomes.set(targetEntity.id, created);

    return created;
  };

  /**
   * Вход или выход сущности из одной ауры.
   *
   * @param targetEntity - вошедший или вышедший
   * @param hit - аура источника
   * @param event - вход или выход
   */
  const fire = (
    targetEntity: DnDSceneEntity,
    hit: TriggerAuraHit,
    event: 'enter' | 'exit',
  ): void => {
    const context: PresenceContext = {
      requestRoll,
      inCombat: isInCombat?.(targetEntity) ?? false,
      requesterLabel: formatAuraRequesterLabel(
        sourceNames.get(hit.sourceTokenId),
      ),
      effectOptions: {
        ambientEffects: resolveAmbientEffects?.(targetEntity),
        activeTurnActorId: getActiveTurnActorId?.(),
      },
    };

    // Счётчик лимита — тот же, что у этой ауры на ходу накрытого: вход и
    // начало хода в ауре делят «раз в ход»
    const outcome = runPresenceEvent(
      targetEntity,
      hit.effect,
      event,
      buildTriggerUsageScope(
        'aura',
        buildAmbientAuraEffectId(hit.effect, hit.sourceTokenId),
      ),
      context,
    );

    const touched =
      outcome.changed
      || outcome.deferred.length > 0
      || outcome.damageOutcomes.length > 0
      || outcome.saveOutcomes.length > 0;

    if (touched) {
      mergePresenceOutcome(getAccumulator(targetEntity), outcome);
    }
  };

  const diffAndFire = (
    targetEntity: DnDSceneEntity,
    prevHits: TriggerAuraHit[],
    currHits: TriggerAuraHit[],
  ): void => {
    const prevKeys = new Set(prevHits.map(auraHitKey));
    const currKeys = new Set(currHits.map(auraHitKey));

    // Вход: ауры, которых не было в прошлой позиции, — первый вход за
    // перемещение
    for (const hit of currHits) {
      const enteredKey = `${targetEntity.id}:${auraHitKey(hit)}`;

      if (
        prevKeys.has(auraHitKey(hit))
        || alreadyEnteredAuraKeys?.has(enteredKey)
      ) {
        continue;
      }

      alreadyEnteredAuraKeys?.add(enteredKey);
      fire(targetEntity, hit, 'enter');
    }

    // Выход: ауры, которых больше нет в текущей позиции
    for (const hit of prevHits) {
      if (!currKeys.has(auraHitKey(hit))) {
        fire(targetEntity, hit, 'exit');
      }
    }
  };

  // Диспозиция перемещённого токена берётся из его сущности (на токене сцены её
  // может не быть) — иначе фильтр аур allies/enemies не сработает.
  const movedTokenResolved = withTokenDisposition(movedToken, movedEntity);

  const previousTokenResolved = previousToken
    ? withTokenDisposition(previousToken, movedEntity)
    : undefined;

  // Остальные токены с разрешённой диспозицией и их аура-эффектами (один проход)
  const others: Array<{
    token: Token;
    entity: DnDSceneEntity;
    auraEffects: ReturnType<typeof collectAllAuraEffects>;
  }> = [];

  for (const token of tokens) {
    if (token.id === movedToken.id) {
      continue;
    }

    const entity = getEntity(token.actorId);

    if (!entity) {
      continue;
    }

    others.push({
      token: withTokenDisposition(token, entity),
      entity,
      auraEffects: collectAllAuraEffects(entity),
    });

    sourceNames.set(token.id, entity.name);
  }

  // 1. Перемещённый токен как ЦЕЛЬ: ауры остальных токенов (текущие позиции)
  const otherSources: AuraSourceToken[] = others
    .filter((other) => other.auraEffects.length > 0)
    .map((other) => ({ token: other.token, effects: other.auraEffects }));

  const prevTargetHits = previousTokenResolved
    ? collectTriggerAurasForTarget(
        previousTokenResolved,
        otherSources,
        gridSettings,
      )
    : [];

  const currTargetHits = collectTriggerAurasForTarget(
    movedTokenResolved,
    otherSources,
    gridSettings,
  );

  diffAndFire(movedEntity, prevTargetHits, currTargetHits);

  // 2. Перемещённый токен как ИСТОЧНИК: его ауры накрывают другие токены
  const movedAuras = collectAllAuraEffects(movedEntity);

  const hasTriggerAuras = movedAuras.some(isTriggerAura);

  if (hasTriggerAuras) {
    const sourcePrev: AuraSourceToken[] = previousTokenResolved
      ? [{ token: previousTokenResolved, effects: movedAuras }]
      : [];

    const sourceCurr: AuraSourceToken[] = [
      { token: movedTokenResolved, effects: movedAuras },
    ];

    for (const other of others) {
      const prevHits = collectTriggerAurasForTarget(
        other.token,
        sourcePrev,
        gridSettings,
      );

      const currHits = collectTriggerAurasForTarget(
        other.token,
        sourceCurr,
        gridSettings,
      );

      diffAndFire(other.entity, prevHits, currHits);
    }
  }

  return [...outcomes.values()];
}
