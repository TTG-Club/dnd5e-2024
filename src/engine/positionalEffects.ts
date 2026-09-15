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
import type { TurnDamageOutcome, TurnSaveOutcome } from './turnEffects.js';

import { generateId } from '@vtt/shared';

import { isDnDEffect } from './activeEffectTypes.js';
import {
  collectAllAuraEffects,
  collectTriggerAurasForTarget,
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

/** Результат синхронизации area-эффектов токена за одно перемещение */
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
  } = {},
): AreaEffectsSyncResult {
  const {
    triggerOneShots = true,
    alreadyEnteredAreaIds,
    requestRoll,
    resolveAmbientEffects,
    isInCombat,
  } = options;

  const damageOutcomes: TurnDamageOutcome[] = [];
  const saveOutcomes: TurnSaveOutcome[] = [];
  const deferred: EngineDeferredTrigger[] = [];

  let changed = false;

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
    changed = true;
  }

  const runTrigger = (effect: ActiveEffect, area: CustomArea): void => {
    const entryOptions = {
      sourceAreaId: area.id,
      ambientEffects: resolveAmbientEffects?.(entity),
    };

    // Спасбросок бросает игрок — срабатывание ждёт его ответа
    if (effect.applySave && shouldRequestEffectSave(entity, requestRoll)) {
      const trigger = requestEntryEffect(
        entity,
        effect,
        requestRoll,
        formatZoneRequesterLabel(area.name),
        entryOptions,
      );

      if (trigger) {
        deferred.push(trigger);
      }

      return;
    }

    const result = resolveEntryEffect(entity, effect, entryOptions);

    if (result.damageOutcome) {
      damageOutcomes.push(result.damageOutcome);
    }

    if (result.saveOutcome) {
      saveOutcomes.push(result.saveOutcome);
    }

    // Урон или повешенный статус — обе мутации требуют рассылки на клиент
    if (result.damageOutcome || result.statusApplied) {
      changed = true;
    }
  };

  /**
   * Явное срабатывание входа или выхода: лимит, спасбросок на сервере или
   * запросом игроку, урон и наложения.
   *
   * @param effect - эффект зоны
   * @param area - зона
   * @param event - вход или выход
   */
  const runPresenceTriggers = (
    effect: ActiveEffect,
    area: CustomArea,
    event: 'enter' | 'exit',
  ): void => {
    const sources = listPresenceTriggerSources(
      effect,
      event,
      `area:${area.id}`,
    );

    for (const source of sources) {
      const inCombat = isInCombat?.(entity) ?? false;

      if (!admitTrigger(entity, source, {}, inCombat)) {
        continue;
      }

      // Счётчик лимита записан на сущность — её надо сохранить
      if (source.trigger.limit) {
        changed = true;
      }

      const presenceOptions = {
        sourceAreaId: area.id,
        ambientEffects: resolveAmbientEffects?.(entity),
      };

      if (source.trigger.save && shouldRequestEffectSave(entity, requestRoll)) {
        const request = requestPresenceTriggerSave(
          entity,
          source,
          requestRoll,
          formatZoneRequesterLabel(area.name),
          presenceOptions,
        );

        if (request) {
          deferred.push(request);
        }

        continue;
      }

      const save = rollTriggerSave(
        entity,
        source,
        presenceOptions.ambientEffects,
      );

      const result = settlePresenceTrigger(
        entity,
        source,
        save,
        presenceOptions,
      );

      if (result.damageOutcome) {
        damageOutcomes.push(result.damageOutcome);
      }

      if (result.saveOutcome) {
        saveOutcomes.push(result.saveOutcome);
      }

      if (result.damageOutcome || result.statusApplied) {
        changed = true;
      }
    }
  };

  // Разовые триггеры выхода (только при перемещении)
  if (triggerOneShots) {
    for (const areaId of exitedAreaIds) {
      const area = areas.find((areaEntry) => areaEntry.id === areaId);

      if (!area?.effects) {
        continue;
      }

      for (const effect of area.effects.filter(isDnDEffect)) {
        if (effect.disabled) {
          continue;
        }

        if (effect.areaTrigger === 'exit') {
          runTrigger(effect, area);
        }

        runPresenceTriggers(effect, area, 'exit');
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
      if (effect.disabled || (effect.areaTrigger ?? 'stay') !== 'stay') {
        continue;
      }

      entity.activeEffects.push({
        ...effect,
        id: generateId('ae'),
        origin: 'area',
        originId: areaId,
        transfer: false,
        // Копия уже в зоне — доставка «в зону» на ней ничего не значит
        effectTarget: undefined,
        // Копия живёт, пока существо в зоне: своя длительность спала бы, и
        // следующая же синхронизация повесила бы эффект заново
        duration: { type: 'permanent' },
      });

      changed = true;
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
        if (effect.disabled) {
          continue;
        }

        if (effect.areaTrigger === 'enter') {
          runTrigger(effect, area);
        }

        runPresenceTriggers(effect, area, 'enter');
      }
    }
  }

  return { changed, damageOutcomes, saveOutcomes, deferred };
}

/** Итог срабатывания триггер-аур по одной затронутой сущности */
export interface AuraTriggerOutcome {
  /** Затронутая сущность (живая ссылка из стейта мира) */
  entity: DnDSceneEntity;
  /** Нужна ли рассылка/персист (нанесён урон или повешен статус) */
  changed: boolean;
  /** Исходы урона — для подписи в чате */
  damageOutcomes: TurnDamageOutcome[];
  /** Исходы спасбросков — для подписи в чате */
  saveOutcomes: TurnSaveOutcome[];
  /** Срабатывания, чей спасбросок спросили у игрока */
  deferred: EngineDeferredTrigger[];
}

/** Ключ членства токена в конкретной ауре: токен-источник + эффект */
function auraHitKey(hit: TriggerAuraHit): string {
  return `${hit.sourceTokenId}:${hit.effect.id}`;
}

/**
 * Возвращает токен с диспозицией, разрешённой так же, как при рендере: приоритет
 * у настроек сущности (`entity.token.disposition`), затем у самого токена сцены.
 * Нужно потому, что у токена на сцене `disposition` часто не проставлен, а фильтр
 * аур по отношению (`allies`/`enemies`) сравнивает именно это поле.
 *
 * @param token - токен сцены
 * @param entity - сущность токена (источник авторитетной диспозиции)
 * @returns тот же токен либо его копия с разрешённой диспозицией
 */
function withResolvedDisposition(
  token: Token,
  entity: DnDSceneEntity | undefined,
): Token {
  const disposition = entity?.token?.disposition ?? token.disposition;

  if (disposition === token.disposition) {
    return token;
  }

  return { ...token, disposition };
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
  } = {},
): AuraTriggerOutcome[] {
  const tokens = scene.tokens;
  const gridSettings = scene.gridSettings;

  if (!tokens || tokens.length === 0 || !gridSettings) {
    return [];
  }

  const { requestRoll, resolveAmbientEffects } = options;
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

  const fire = (targetEntity: DnDSceneEntity, hit: TriggerAuraHit): void => {
    const entryOptions = {
      ambientEffects: resolveAmbientEffects?.(targetEntity),
    };

    // Спасбросок бросает игрок — срабатывание ждёт его ответа
    if (
      hit.effect.applySave
      && shouldRequestEffectSave(targetEntity, requestRoll)
    ) {
      const trigger = requestEntryEffect(
        targetEntity,
        hit.effect,
        requestRoll,
        formatAuraRequesterLabel(sourceNames.get(hit.sourceTokenId)),
        entryOptions,
      );

      if (trigger) {
        getAccumulator(targetEntity).deferred.push(trigger);
      }

      return;
    }

    const result = resolveEntryEffect(targetEntity, hit.effect, entryOptions);

    if (!result.damageOutcome && !result.saveOutcome && !result.statusApplied) {
      return;
    }

    const accumulator = getAccumulator(targetEntity);

    if (result.damageOutcome) {
      accumulator.damageOutcomes.push(result.damageOutcome);
    }

    if (result.saveOutcome) {
      accumulator.saveOutcomes.push(result.saveOutcome);
    }

    if (result.damageOutcome || result.statusApplied) {
      accumulator.changed = true;
    }
  };

  const diffAndFire = (
    targetEntity: DnDSceneEntity,
    prevHits: TriggerAuraHit[],
    currHits: TriggerAuraHit[],
  ): void => {
    const prevKeys = new Set(prevHits.map(auraHitKey));
    const currKeys = new Set(currHits.map(auraHitKey));

    // Вход: ауры с триггером enter, которых не было в прошлой позиции
    for (const hit of currHits) {
      if (
        hit.effect.areaTrigger === 'enter'
        && !prevKeys.has(auraHitKey(hit))
      ) {
        fire(targetEntity, hit);
      }
    }

    // Выход: ауры с триггером exit, которых больше нет в текущей позиции
    for (const hit of prevHits) {
      if (hit.effect.areaTrigger === 'exit' && !currKeys.has(auraHitKey(hit))) {
        fire(targetEntity, hit);
      }
    }
  };

  // Диспозиция перемещённого токена берётся из его сущности (на токене сцены её
  // может не быть) — иначе фильтр аур allies/enemies не сработает.
  const movedTokenResolved = withResolvedDisposition(movedToken, movedEntity);

  const previousTokenResolved = previousToken
    ? withResolvedDisposition(previousToken, movedEntity)
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
      token: withResolvedDisposition(token, entity),
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

  const hasTriggerAuras = movedAuras.some(
    (effect) => effect.areaTrigger === 'enter' || effect.areaTrigger === 'exit',
  );

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
