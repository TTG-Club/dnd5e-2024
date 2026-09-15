/**
 * Применение урона/лечения и наложение эффектов на сущность-цель по правилам
 * D&D 5e (защиты от урона, временные ХП, иммунитеты к состояниям, слияние
 * эффектов) плюс производные боевые характеристики цели (КД, активные флаги).
 *
 * Логика системо-зависима, поэтому живёт в системе D&D и вызывается Ядром
 * (нейтральный `targetStore`) через контракт `VttSystem`:
 * `applyDamageToEntity` / `applyEffectsToEntity` / `getEntityArmorClass` /
 * `getEntityActiveFlags`. Стор отвечает лишь за выбор цели и WS-отправку.
 *
 * Здесь же живёт БОЕВОЕ СОСТОЯНИЕ — `pickCombatState` / `applyCombatState`:
 * пара, которой ядро переносит исход боя на чужую цель узким каналом
 * `entity:apply-combat-state` вместо полной замены сущности.
 *
 * @module system/dnd/damageApplication
 */

import type { ActiveEffect, EffectOrigin } from './activeEffectTypes.js';
import type { DamageHit } from './damageHits.js';
import type { DamageApplyResult, DamageDefenseOutcome } from './damageUtils.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { IncomingAttackContext } from './effectPipeline.js';
import type { EffectTriggerUsageLedger } from './effectTriggerUsage.js';

import { generateId, isRecord } from '@vtt/shared';

import { ActiveEffectsArraySchema } from './activeEffectTypes.js';
import {
  buildConditionActiveEffect,
  resolveEffectConditionKey,
} from './conditionTemplates.js';
import {
  parseDamageHitDetails,
  readDamageHits,
  recordDamageHit,
} from './damageHits.js';
import { applyDamageDefenses, applyHpChange } from './damageUtils.js';
import {
  isImmuneToCondition,
  mergeAppliedEffects,
} from './effectAutomation.js';
import {
  collectActiveEffects,
  evaluateDefensiveACBonus,
  getEntityConditionImmunities,
  resolveActorStats,
} from './effectPipeline.js';
import { parseTriggerUsage, readTriggerUsage } from './effectTriggerUsage.js';
import { buildFormulaContext } from './formulaParser.js';
import {
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
  writeEntityHitPoints,
} from './hitPoints.js';
import { withInitializedDuration } from './turnEffects.js';

/**
 * Строит `ActiveEffect` для наложения на цель.
 *
 * Эффект, опознанный как состояние D&D 5e, получает источник `condition` и
 * ключ состояния — по ним лист и значок на токене узнают состояние. Нагрузка
 * при этом берётся у АВТОРА эффекта: имя, модификаторы, флаги, повторный
 * спасбросок и снятие после атаки. Раньше состояние пересобиралось из шаблона
 * целиком, и «Отравлен с −2 к КД и спасброском в конце хода» ложился на цель
 * голым «Отравлен». Из шаблона собирается только заготовка — эффект, у которого
 * нет ни модификаторов, ни флагов (узнан по одному имени).
 *
 * Длительность и цель применения всегда авторские.
 *
 * @param effect - исходный эффект из действия/оружия
 * @param fallbackOrigin - origin для не-condition эффектов
 * @returns готовый `ActiveEffect` для добавления в `activeEffects`
 */
function buildEffectForTarget(
  effect: ActiveEffect,
  fallbackOrigin: EffectOrigin,
): ActiveEffect {
  const conditionKey = resolveEffectConditionKey(effect);

  if (!conditionKey) {
    return withInitializedDuration({
      ...effect,
      id: generateId('effect'),
      origin: fallbackOrigin,
    });
  }

  const conditionEffect = buildConditionActiveEffect(conditionKey, {
    duration: effect.duration,
    effectTarget: effect.effectTarget,
  });

  if (!conditionEffect) {
    return withInitializedDuration({
      ...effect,
      id: generateId('effect'),
      origin: fallbackOrigin,
    });
  }

  const hasAuthorPayload = effect.changes.length > 0 || effect.flags.length > 0;

  // Остальные поля автора (повторный спасбросок, урон каждый ход, снятие после
  // атаки) переживают и заготовку: шаблон их не знает
  return withInitializedDuration({
    ...effect,
    id: conditionEffect.id,
    origin: conditionEffect.origin,
    conditionKey,
    description: effect.description || conditionEffect.description,
    icon: effect.icon ?? conditionEffect.icon,
    changes: hasAuthorPayload ? effect.changes : conditionEffect.changes,
    flags: hasAuthorPayload ? effect.flags : conditionEffect.flags,
    conditionImmunities:
      effect.conditionImmunities ?? conditionEffect.conditionImmunities,
    exhaustionLevel: effect.exhaustionLevel ?? conditionEffect.exhaustionLevel,
  });
}

/**
 * Применяет урон или лечение к сущности (мутирует её ХП) с учётом защит от урона
 * (иммунитет/сопротивление/уязвимость) и правила временных ХП (урон снимает temp
 * первым, лечение их не трогает). Возвращает сводку изменения для UI/чата.
 *
 * Урон записывается ударом в сущность (`recordDamageHit`): боевой снимок
 * увезёт его на сервер, и там сработают «получил урон» и «хиты упали до 0».
 *
 * @param entity - сущность-цель (обычно глубокая копия для безопасной WS-отправки)
 * @param amount - величина изменения ХП (положительное число)
 * @param isHealing - true = лечение (прибавить), false = урон (вычесть)
 * @param damageType - тип урона (для проверки защит); только для урона
 * @param details - подробности удара от вызывающего: крит, кто бил
 * @returns сводка результата применения
 */
export function applyTargetDamage(
  entity: DnDSceneEntity,
  amount: number,
  isHealing: boolean,
  damageType?: string,
  details?: unknown,
): DamageApplyResult {
  const hpBefore = resolveEntityCurrentHp(entity);
  const maxHp = resolveEntityMaxHp(entity);

  let finalAmount = amount;
  let defenseOutcome: DamageDefenseOutcome = 'normal';

  // Учитываем защиты цели: иммунитет (урон 0), сопротивление (½), уязвимость (×2)
  if (!isHealing && damageType) {
    const stats = resolveActorStats(entity);

    const defenseResult = applyDamageDefenses(
      amount,
      damageType,
      stats.damageDefenses,
    );

    finalAmount = defenseResult.finalDamage;
    defenseOutcome = defenseResult.outcome;
  }

  const tempBefore = resolveEntityTempHp(entity);

  // Урон сначала снимает временные ХП (правило 5e), лечение их не трогает
  const hpChange = applyHpChange({
    hpBefore,
    maxHp,
    tempBefore,
    damage: isHealing ? 0 : finalAmount,
    heal: isHealing ? finalAmount : 0,
  });

  writeEntityHitPoints(entity, {
    current: hpChange.hpAfter,
    temp: hpChange.tempAfter,
  });

  if (!isHealing) {
    const { critical, sourceId } = parseDamageHitDetails(details);

    recordDamageHit(entity, {
      amount: hpBefore + tempBefore - hpChange.hpAfter - hpChange.tempAfter,
      types: damageType ? [damageType] : [],
      critical,
      sourceId,
    });
  }

  return {
    actorName: entity.name,
    hpBefore,
    hpAfter: hpChange.hpAfter,
    tempAbsorbed: hpChange.tempAbsorbed,
    defenseOutcome,
  };
}

/**
 * Накладывает эффекты на сущность (мутирует список эффектов копии): отсеивает
 * состояния, к которым цель иммунна, собирает полноценные condition-эффекты и
 * сливает с текущими (один и тот же статус ЗАМЕНЯЕТ прежний — 5e 2024). Вызывающий
 * заранее отфильтровал отключённые эффекты.
 *
 * @param entity - сущность-цель (обычно глубокая копия)
 * @param effects - накладываемые эффекты (уже без отключённых)
 * @param origin - источник эффекта (метка в `activeEffects`)
 * @returns обновлённый массив `activeEffects` для записи в сущность
 */
export function applyEffectsToEntity(
  entity: DnDSceneEntity,
  effects: ActiveEffect[],
  origin: EffectOrigin,
): ActiveEffect[] {
  const existing = entity.activeEffects ?? [];

  // Иммунитеты к состояниям: у существ — статические + от активных эффектов,
  // у актёров — от активных эффектов (виды/предметы дают через них). К таким
  // состояниям эффект не накладывается.
  const conditionImmunities = getEntityConditionImmunities(entity);

  // Иммунные состояния отсеиваем
  const applicableEffects = effects.filter((effect) => {
    const conditionKey = resolveEffectConditionKey(effect);

    return !(
      conditionKey && isImmuneToCondition(conditionImmunities, conditionKey)
    );
  });

  // Один и тот же статус не стакается: повтор ЗАМЕНЯЕТ прежний (5e 2024);
  // разные эффекты складываются.
  return mergeAppliedEffects(
    existing,
    applicableEffects.map((effect) => buildEffectForTarget(effect, origin)),
  );
}

/**
 * Боевое состояние цели D&D 5e — единственное, что участник боя вправе изменить
 * у ЧУЖОЙ сущности: очки здоровья (текущие и временные) и активные эффекты.
 *
 * Максимум ХП, характеристики, инвентарь, владелец и прочий лист в снимок НЕ
 * входят и каналом `entity:apply-combat-state` недосягаемы — на этом держится
 * его безопасность.
 */
export interface DndCombatState {
  /** Текущие очки здоровья после применения исхода боя */
  hpCurrent: number;
  /** Временные очки здоровья после применения исхода боя */
  hpTemp: number;
  /** Полный список активных эффектов цели после применения исхода боя */
  activeEffects: ActiveEffect[];
  /**
   * Счётчики лимитов срабатываний («не чаще раза в ход»): бросок атаки на
   * клиенте расходует срабатывание. Нет поля — счётчики не трогаются.
   */
  effectUsage?: EffectTriggerUsageLedger;
  /**
   * Удары, от которых изменились хиты: по ним сервер прогоняет «получил урон»
   * и «хиты упали до 0». Нет поля — событий урона нет (отмена, правка хитов).
   */
  damage?: DamageHit[];
}

/**
 * Снимает с сущности её боевое состояние для отправки на сервер.
 *
 * @param entity - сущность-цель с уже применённым исходом боя
 * @returns снимок боевого состояния
 */
export function pickCombatState(entity: DnDSceneEntity): DndCombatState {
  const damage = readDamageHits(entity);

  return {
    hpCurrent: resolveEntityCurrentHp(entity),
    hpTemp: resolveEntityTempHp(entity),
    activeEffects: entity.activeEffects ?? [],
    ...(entity.system.effectUsage === undefined
      ? {}
      : { effectUsage: entity.system.effectUsage }),
    ...(damage.length > 0 ? { damage: [...damage] } : {}),
  };
}

/**
 * Записывает боевое состояние в сущность на сервере, мутируя её.
 *
 * Снимок пришёл от клиента, поэтому доверия ему нет: ХП проходят через границы
 * СЕРВЕРНОЙ сущности (максимум ХП каналом не меняется, значит лечением за предел
 * не выйти и отрицательных хитов не выставить), а эффекты — через ту же
 * Zod-схему, что и обычное сохранение актёра.
 *
 * @param entity - сущность-цель из состояния мира (мутируется)
 * @param state - снимок боевого состояния от клиента
 * @returns true, если снимок принят и сущность изменилась
 */
export function applyCombatState(
  entity: DnDSceneEntity,
  state: unknown,
): boolean {
  if (!isRecord(state)) {
    return false;
  }

  const { hpCurrent, hpTemp, activeEffects, effectUsage } = state;

  if (typeof hpCurrent !== 'number' || !Number.isFinite(hpCurrent)) {
    return false;
  }

  if (typeof hpTemp !== 'number' || !Number.isFinite(hpTemp)) {
    return false;
  }

  const parsedEffects = ActiveEffectsArraySchema.safeParse(activeEffects);

  if (!parsedEffects.success) {
    return false;
  }

  const nextHp = Math.max(
    0,
    Math.min(resolveEntityMaxHp(entity), Math.trunc(hpCurrent)),
  );

  const nextTemp = Math.max(0, Math.trunc(hpTemp));
  const nextEffects = parsedEffects.data;

  // Счётчики лимитов — только если клиент их прислал: старый клиент их не
  // знает, и снимок без поля не должен стирать счётчики сервера
  const nextUsage =
    effectUsage === undefined ? undefined : parseTriggerUsage(effectUsage);

  const usageChanged =
    nextUsage !== undefined
    && JSON.stringify(readTriggerUsage(entity)) !== JSON.stringify(nextUsage);

  const changed =
    nextHp !== resolveEntityCurrentHp(entity)
    || nextTemp !== resolveEntityTempHp(entity)
    || JSON.stringify(entity.activeEffects ?? [])
      !== JSON.stringify(nextEffects)
    || usageChanged;

  if (!changed) {
    return false;
  }

  writeEntityHitPoints(entity, { current: nextHp, temp: nextTemp });
  entity.activeEffects = nextEffects;

  if (nextUsage !== undefined) {
    entity.system.effectUsage =
      Object.keys(nextUsage).length > 0 ? nextUsage : undefined;
  }

  return true;
}

/**
 * Возвращает итоговый класс доспеха (КД) сущности с учётом модификаторов.
 * Если передан контекст входящей атаки — учитывает условные бонусы к КД
 * (например, Щит ловли стрел даёт +2 КД от дальнобойных атак).
 *
 * @param entity - сущность-цель
 * @param attackContext - опциональный контекст входящей атаки (melee/ranged/spell)
 * @returns эффективное значение КД
 */
export function getEntityArmorClass(
  entity: DnDSceneEntity,
  attackContext?: IncomingAttackContext,
): number {
  const stats = resolveActorStats(entity);

  let totalAC = stats.armorClass;

  if (attackContext) {
    const effects = collectActiveEffects(entity);

    totalAC += evaluateDefensiveACBonus(
      effects,
      attackContext,
      buildFormulaContext(entity),
    );
  }

  return totalAC;
}

/**
 * Возвращает набор активных флагов сущности (производных от активных эффектов) —
 * используется механикой попаданий/спасбросков для проверки условий.
 *
 * @param entity - сущность-цель
 * @returns множество активных флагов
 */
export function getEntityActiveFlags(
  entity: DnDSceneEntity,
): ReadonlySet<string> {
  return resolveActorStats(entity).activeFlags;
}
