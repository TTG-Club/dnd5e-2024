/**
 * Запись об уроне атаки в карточке чата: что брошено, кому и сколько хитов
 * снято и что удар изменил у цели помимо хитов (наложенные вместе с ним
 * эффекты, спасброски от смерти у лежащего на нуле). По ней кнопка «Отменить
 * урон» возвращает цели ровно снятое и снимает ровно наложенное, а «Нанести
 * урон» перебрасывает только кости урона — без нового броска попадания, по
 * тем же целям и с тем же критом.
 *
 * Запись едет в дополнении сообщения чата (`ChatMessageFollowUp.payload`)
 * строкой: ядро её хранит и отдаёт как есть, а читает только система.
 *
 * @module system/dnd/attackDamageRecord
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type {
  AttackDamagePartRoll,
  RolledDamagePartInput,
} from './attackDamageRoll.js';
import type { DamageHitDetails } from './damageHits.js';
import type {
  DamageDefenseOutcome,
  DndDamageApplyResult,
  HpChangeDetail,
} from './damageUtils.js';
import type { DeathSavesState } from './deathSaves.js';
import type { DnDSceneEntity } from './dndEntities.js';

import { z } from 'zod';

import { ActiveEffectsArraySchema } from './activeEffectTypes.js';
import {
  AttackDamagePartRollSchema,
  describeDamagePartRoll,
} from './attackDamageRoll.js';
import {
  applyTargetDamage,
  resolveTargetDamageDefenses,
} from './damageApplication.js';
import { readDamageHits, recordDamageHit } from './damageHits.js';
import { applyHpChange, applyMultiTypeDamageDefenses } from './damageUtils.js';
import {
  DeathSavesStateSchema,
  readDeathSaves,
  settleDeathSaveDamage,
  withActorDeathMark,
} from './deathSaves.js';
import { effectIdentityKey } from './effectAutomation.js';
import { isDndActor } from './entityGuards.js';
import {
  isEntityHpShownToPlayers,
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
  writeEntityHitPoints,
} from './hitPoints.js';
import { SYSTEM_ID } from './systemId.js';

/** Вид дополнения чата с нанесённым уроном атаки: под ним «Отменить урон» */
export const ATTACK_DAMAGE_FOLLOW_UP_KIND = `${SYSTEM_ID}:attack-damage`;

/** Вид дополнения чата с отменённым уроном атаки: под ним «Нанести урон» */
export const ATTACK_DAMAGE_REVERTED_FOLLOW_UP_KIND = `${SYSTEM_ID}:attack-damage-reverted`;

/** Сколько частей урона помнит запись */
const MAX_RECORD_PARTS = 16;

/** Сколько целей помнит запись */
const MAX_RECORD_TARGETS = 32;

/** Сколько наложенных ударом эффектов помнит запись по одной цели */
const MAX_RECORD_EFFECTS = 32;

/**
 * Предел строки записи: ядро не принимает дополнение чата с данными длиннее
 * (`CHAT_FOLLOW_UP_PAYLOAD_MAX_LENGTH`). Число продублировано: старое ядро
 * константу не отдаёт
 */
const MAX_RECORD_PAYLOAD_LENGTH = 16_000;

/**
 * Zod-схема части урона. Бросок по отдельности (`roll`) читается мягко:
 * негодный отбрасывается один — карточка остаётся с прежними кнопками
 */
const AttackDamagePartSchema = z.object({
  formula: z.string().min(1),
  types: z.array(z.string().min(1)),
  roll: AttackDamagePartRollSchema.optional().catch(undefined),
});

/** Zod-схема полного урона цели по режимам */
const AttackDamageTotalsSchema = z.object({
  normal: z.number().finite().nonnegative().optional(),
  critical: z.number().finite().nonnegative().optional(),
});

/** Zod-схема вклада части в цель */
const AttackDamageContributionSchema = z.object({
  part: z.number().int().nonnegative(),
  scale: z.number().finite().nonnegative(),
});

/** Zod-схема того, что удар сделал с серией спасбросков от смерти */
const AttackDeathSavesChangeSchema = z.object({
  before: DeathSavesStateSchema,
  after: DeathSavesStateSchema,
  killed: z.boolean(),
});

/**
 * Zod-схема цели урона. Последствия удара необязательны и читаются мягко:
 * негодное поле отбрасывается одно, хиты по записи всё равно возвращаются
 */
const AttackDamageTargetSchema = z.object({
  entityId: z.string().min(1),
  name: z.string(),
  hpLost: z.number().finite(),
  tempLost: z.number().finite(),
  contributions: z.array(AttackDamageContributionSchema).max(MAX_RECORD_PARTS),
  totals: AttackDamageTotalsSchema.optional().catch(undefined),
  addedEffectIds: z
    .array(z.string().min(1))
    .max(MAX_RECORD_EFFECTS)
    .optional()
    .catch(undefined),
  replacedEffects: ActiveEffectsArraySchema.optional().catch(undefined),
  deathSaves: AttackDeathSavesChangeSchema.optional().catch(undefined),
});

/** Zod-схема записи об уроне атаки */
const AttackDamageRecordSchema = z.object({
  label: z.string(),
  critical: z.boolean(),
  half: z.boolean().optional().catch(undefined),
  sourceId: z.string().min(1).optional(),
  ignoredResistances: z.array(z.string().min(1)).optional(),
  parts: z.array(AttackDamagePartSchema).min(1).max(MAX_RECORD_PARTS),
  targets: z.array(AttackDamageTargetSchema).min(1).max(MAX_RECORD_TARGETS),
});

/** Часть урона атаки: чем брошена и какого типа */
export interface AttackDamagePart {
  /** Брошенная формула — кости крита в ней уже удвоены */
  formula: string;
  /** Типы урона части; несколько — защиты по самому выгодному цели */
  types: string[];
  /**
   * Бросок части: обычный урон и кости крита по отдельности. По нему под
   * уроном работают «Половина» и «Крит»; у записи без него этих кнопок нет
   */
  roll?: AttackDamagePartRoll;
}

/**
 * Полный урон цели после защит, сколько бы хитов у неё ни было, — без крита
 * и с критом. Запоминается, как посчитан: «Половина» и «Крит» под уроном
 * переключаются между этими числами и не пересчитывают защиты цели заново.
 * Режим, которого ещё не было, досчитывается при первом переключении.
 */
export interface AttackDamageTotals {
  /** Урон без костей крита */
  normal?: number;
  /** Урон с костями крита */
  critical?: number;
}

/** Вклад части урона в цель */
export interface AttackDamageContribution {
  /** Номер части в `AttackDamageRecord.parts` */
  part: number;
  /** Доля броска до защит: 1 — полный урон, 0.5 — половина по спасброску */
  scale: number;
}

/** Что удар сделал с серией спасбросков от смерти персонажа */
export interface AttackDeathSavesChange {
  /** Серия до удара */
  before: DeathSavesState;
  /** Серия после удара */
  after: DeathSavesState;
  /** Удар убил: на персонаже появилась метка «Мёртв» */
  killed: boolean;
}

/**
 * Что удар изменил у цели помимо хитов. По этому отмена урона снимает ровно
 * наложенное ударом и не трогает то, что было у цели раньше или появилось
 * позже.
 */
export interface AttackHitConsequences {
  /** Эффекты и состояния, наложенные вместе с ударом, — по их `id` */
  addedEffectIds?: string[];
  /**
   * Эффекты цели, которые удар заменил своими (тот же статус не стакается):
   * отмена возвращает их на место
   */
  replacedEffects?: ActiveEffect[];
  /** Серия спасбросков от смерти: удар по лежащему на нуле или смерть */
  deathSaves?: AttackDeathSavesChange;
}

/** Цель урона атаки и то, что с неё снято */
export interface AttackDamageTarget extends AttackHitConsequences {
  /** Сущность-цель */
  entityId: string;
  /** Имя цели на момент удара — для строки в чате */
  name: string;
  /** Сколько снято текущих хитов */
  hpLost: number;
  /** Сколько снято временных хитов */
  tempLost: number;
  /** Какие части и в какой доле дошли до цели */
  contributions: AttackDamageContribution[];
  /** Полный урон цели по режимам — для «Половины» и «Крита» */
  totals?: AttackDamageTotals;
}

/** Запись об уроне атаки */
export interface AttackDamageRecord {
  /** Чем нанесён урон: оружие, заклинание */
  label: string;
  /**
   * Попадание критическое: событиям урона цели нужен крит. Кнопка «Крит» /
   * «Не крит» под уроном переключает его — к урону идут и кости крита
   */
  critical: boolean;
  /** Урон идёт половиной: кнопка «Половина» / «Полный урон» под уроном */
  half?: boolean;
  /** Кто бил */
  sourceId?: string;
  /** Типы урона, чьё сопротивление у целей не действует */
  ignoredResistances?: string[];
  /** Части урона по порядку */
  parts: AttackDamagePart[];
  /** Цели, получившие урон */
  targets: AttackDamageTarget[];
}

/** Итог одной части урона для цели */
export interface AppliedDamagePart {
  /** Номер части в `AttackDamageRecord.parts` */
  part: number;
  /** Урон части после доли и защит цели */
  applied: number;
  /** Сработавшая защита цели */
  outcome: DamageDefenseOutcome;
}

/** Итог повторного урона для цели */
export interface AppliedRecordedDamage {
  /** Копия цели с новыми хитами — её шлёт боевой канал */
  updatedEntity: DnDSceneEntity;
  /** Текущие хиты до урона */
  hpBefore: number;
  /** Текущие хиты после урона */
  hpAfter: number;
  /** Сколько урона сняли временные хиты */
  tempLost: number;
  /** Хиты цели до и после — для подробностей строки урона в чате */
  hpChange: HpChangeDetail;
  /** Сработавшая защита: последняя отличная от обычной */
  outcome: DamageDefenseOutcome;
  /** Итоги частей по порядку вкладов цели */
  parts: AppliedDamagePart[];
  /** Полный урон цели после защит — до половины */
  total: number;
  /** Нанесённый урон: полный либо его половина */
  damage: number;
}

/** Урон записи для цели после её защит — до того, как он снят с хитов */
export interface ResolvedRecordedDamage {
  /** Полный урон цели: сумма частей, не ниже нуля */
  total: number;
  /** Сработавшая защита: последняя отличная от обычной */
  outcome: DamageDefenseOutcome;
  /** Итоги частей по порядку вкладов цели */
  parts: AppliedDamagePart[];
  /** Типы урона частей, которые дошли до цели */
  damageTypes: string[];
}

/**
 * Половина урона по правилам 5e — с округлением вниз. Половинится итог цели
 * после её защит, а не бросок: сопротивление и уязвимость уже посчитаны.
 *
 * @param total - полный урон цели
 * @param half - урон идёт половиной
 * @returns урон к нанесению
 */
export function resolveModeDamage(total: number, half: boolean): number {
  return half ? Math.floor(total / 2) : total;
}

/**
 * Собирает запись в строку для дополнения чата.
 *
 * Заменённые ударом эффекты — единственное в записи, что бывает большим.
 * Если строка с ними не влезает в предел ядра, они в запись не идут: урон и
 * кнопки под ним важнее, а отмена тогда снимет наложенное, но прежний эффект
 * на место не вернёт.
 *
 * @param record - запись об уроне
 * @returns строка для `ChatMessageFollowUp.payload`
 */
export function serializeAttackDamageRecord(
  record: AttackDamageRecord,
): string {
  const serialized = JSON.stringify(record);

  if (serialized.length <= MAX_RECORD_PAYLOAD_LENGTH) {
    return serialized;
  }

  return JSON.stringify({
    ...record,
    targets: record.targets.map((target) => ({
      ...target,
      replacedEffects: undefined,
    })),
  });
}

/**
 * Итог удара для серии спасбросков от смерти — тем же правилом, что на
 * сервере (`settleDeathSaveDamage`), над отдельной копией.
 *
 * @param before - цель до удара
 * @param after - копия цели после удара, с записанным ударом
 * @returns изменение серии или `undefined`, если удар её не трогает
 */
function predictDeathSavesChange(
  before: DnDSceneEntity,
  after: DnDSceneEntity,
): AttackDeathSavesChange | undefined {
  const hits = readDamageHits(after);

  if (!isDndActor(before) || hits.length === 0) {
    return undefined;
  }

  const simulated: DnDSceneEntity = JSON.parse(JSON.stringify(after));

  const result = settleDeathSaveDamage(
    simulated,
    resolveEntityCurrentHp(before),
    hits,
  );

  if (!result) {
    return undefined;
  }

  return {
    before: { ...readDeathSaves(before) },
    after: { ...result.state },
    killed: result.outcome === 'dead',
  };
}

/**
 * Что удар изменил у цели помимо хитов: сравнивает цель до удара с копией,
 * в которую удар уже записан (хиты, эффекты, сам удар для сервера).
 *
 * Спасброски от смерти считает сервер — по ударам из боевого снимка. Здесь
 * то же правило прогоняется над копией, поэтому запись знает итог заранее.
 *
 * @param before - цель до удара
 * @param after - копия цели после удара, с записанным ударом
 * @returns последствия; пустой объект, если удар снял только хиты
 */
export function captureHitConsequences(
  before: DnDSceneEntity,
  after: DnDSceneEntity,
): AttackHitConsequences {
  const effectsBefore = before.activeEffects ?? [];
  const effectsAfter = after.activeEffects ?? [];
  const idsBefore = new Set(effectsBefore.map((effect) => effect.id));
  const idsAfter = new Set(effectsAfter.map((effect) => effect.id));

  const addedEffectIds = effectsAfter
    .map((effect) => effect.id)
    .filter((effectId) => !idsBefore.has(effectId))
    .slice(0, MAX_RECORD_EFFECTS);

  const replacedEffects: ActiveEffect[] = JSON.parse(
    JSON.stringify(effectsBefore.filter((effect) => !idsAfter.has(effect.id))),
  );

  const deathSaves = predictDeathSavesChange(before, after);

  return {
    ...(addedEffectIds.length > 0 ? { addedEffectIds } : {}),
    ...(replacedEffects.length > 0 ? { replacedEffects } : {}),
    ...(deathSaves ? { deathSaves } : {}),
  };
}

/**
 * Последствия удара одной суммой урона — для пути, где урон цели наносит
 * ядро (`applyToTarget`) и копии с ударом у вызывающего нет: тот же расчёт
 * выполняется над отдельной копией цели.
 *
 * @param before - цель до удара
 * @param amount - урон до защит цели
 * @param damageType - тип урона, если он известен
 * @param details - подробности удара: крит, кто бил
 * @returns последствия удара
 */
export function previewDamageConsequences(
  before: DnDSceneEntity,
  amount: number,
  damageType: string | undefined,
  details: DamageHitDetails,
): AttackHitConsequences {
  const preview: DnDSceneEntity = JSON.parse(JSON.stringify(before));

  applyTargetDamage(preview, amount, false, damageType, details);

  return captureHitConsequences(before, preview);
}

/**
 * Совпадают ли две серии спасбросков от смерти.
 *
 * @param left - серия
 * @param right - серия
 * @returns `true`, если счётчики и отметка «стабилен» равны
 */
function isSameDeathSaves(
  left: DeathSavesState,
  right: DeathSavesState,
): boolean {
  return (
    left.successes === right.successes
    && left.failures === right.failures
    && Boolean(left.stable) === Boolean(right.stable)
  );
}

/**
 * Текущие хиты цели после возврата снятого ударом.
 *
 * @param entity - цель, какой она есть сейчас
 * @param hpLost - сколько текущих хитов снял удар
 * @returns хиты после возврата, не выше максимума
 */
function resolveRevertedHp(entity: DnDSceneEntity, hpLost: number): number {
  return Math.max(
    0,
    Math.min(
      resolveEntityMaxHp(entity),
      resolveEntityCurrentHp(entity) + hpLost,
    ),
  );
}

/**
 * Эффекты цели после отмены удара: наложенное ударом снимается по `id`, а
 * заменённое им возвращается.
 *
 * Чужое не трогается: эффект того же статуса, наложенный позже, носит другой
 * `id` и остаётся. Заменённые возвращаются, только если эффект удара ещё
 * висел (иначе его уже сняли или заменили — возвращать прежнее не на что) и
 * только те, чьё место не занято таким же статусом.
 *
 * @param effects - эффекты цели сейчас
 * @param target - что удар наложил и заменил
 * @returns эффекты после отмены
 */
function revertRecordedEffects(
  effects: readonly ActiveEffect[],
  target: AttackHitConsequences,
): ActiveEffect[] {
  const addedIds = new Set(target.addedEffectIds ?? []);
  const kept = effects.filter((effect) => !addedIds.has(effect.id));

  if (kept.length === effects.length) {
    return kept;
  }

  const keptIds = new Set(kept.map((effect) => effect.id));

  const takenKeys = new Set(
    kept
      .filter((effect) => !effect.disabled)
      .map((effect) => effectIdentityKey(effect)),
  );

  const restored: ActiveEffect[] = JSON.parse(
    JSON.stringify(
      (target.replacedEffects ?? []).filter(
        (effect) =>
          !keptIds.has(effect.id)
          && (effect.disabled || !takenKeys.has(effectIdentityKey(effect))),
      ),
    ),
  );

  return [...kept, ...restored];
}

/**
 * Серия спасбросков от смерти после отмены удара. Серия лежит в листе
 * персонажа, а не в боевом состоянии, поэтому пишется отдельно от хитов.
 *
 * Хиты после отмены выше нуля — серию закроет сервер сам. Серия с удара не
 * менялась — возвращается прежняя целиком; менялась (персонаж успел бросить
 * спасбросок) — снимаются только провалы этого удара.
 *
 * @param entity - цель, какой она есть сейчас
 * @param target - что удар снял и изменил
 * @returns серия для записи или `null`, если писать нечего
 */
export function revertRecordedDeathSaves(
  entity: DnDSceneEntity,
  target: Pick<AttackDamageTarget, 'hpLost' | 'deathSaves'>,
): DeathSavesState | null {
  const change = target.deathSaves;

  if (
    !change
    || !isDndActor(entity)
    || resolveRevertedHp(entity, target.hpLost) > 0
  ) {
    return null;
  }

  const current = readDeathSaves(entity);

  if (isSameDeathSaves(current, change.after)) {
    return isSameDeathSaves(current, change.before)
      ? null
      : { ...change.before };
  }

  // Провалы удара: у стабильного удар начинал серию заново, и все провалы
  // новой серии — его
  const addedFailures = change.before.stable
    ? change.after.failures
    : Math.max(0, change.after.failures - change.before.failures);

  const failures = Math.max(0, current.failures - addedFailures);

  return failures === current.failures ? null : { ...current, failures };
}

/**
 * Читает запись из дополнения чата. Строка пришла по сети и могла быть
 * записана другой версией системы — негодная запись даёт `null`, и кнопка
 * просто ничего не делает.
 *
 * @param payload - строка из `ChatMessageFollowUp.payload`
 * @returns запись или `null`, если её нет либо она негодна
 */
export function parseAttackDamageRecord(
  payload: string | undefined,
): AttackDamageRecord | null {
  if (!payload) {
    return null;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }

  const parsed = AttackDamageRecordSchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

/**
 * Возвращает цели снятое уроном: текущие хиты — не выше максимума, временные —
 * сверх тех, что у неё есть сейчас. Считается от нынешних хитов цели, а не
 * возвратом к прежним числам: лечение и урон, случившиеся после удара,
 * остаются.
 *
 * Вместе с хитами снимается наложенное ударом: его эффекты и состояния и
 * метка «Мёртв», если удар убил лежащего на нуле. Серия спасбросков от
 * смерти лежит в листе и возвращается отдельно
 * ({@link revertRecordedDeathSaves}).
 *
 * @param entity - цель, какой она есть сейчас
 * @param target - что с неё снято и что на неё наложено
 * @returns новая копия цели с возвращёнными хитами и без эффектов удара
 */
export function revertRecordedDamage(
  entity: DnDSceneEntity,
  target: Pick<AttackDamageTarget, 'hpLost' | 'tempLost'>
    & AttackHitConsequences,
): DnDSceneEntity {
  const updatedEntity: DnDSceneEntity = JSON.parse(JSON.stringify(entity));

  writeEntityHitPoints(updatedEntity, {
    current: resolveRevertedHp(entity, target.hpLost),
    temp: Math.max(0, resolveEntityTempHp(entity) + target.tempLost),
  });

  const effects = revertRecordedEffects(
    updatedEntity.activeEffects ?? [],
    target,
  );

  // Метку смерти над нулём хитов снимет сервер; у оставшегося на нуле её
  // поставил этот удар — вместе с ним она и уходит
  updatedEntity.activeEffects = target.deathSaves?.killed
    ? withActorDeathMark(effects, false)
    : effects;

  return updatedEntity;
}

/**
 * Считает урон записи для цели: доля спасброска — та же, что в первый раз,
 * защиты — нынешние. С хитов ничего не снимает.
 *
 * @param entity - цель, какой она есть сейчас
 * @param record - запись об уроне
 * @param target - цель записи: какие части до неё доходят
 * @param rolledAmounts - броски частей по номерам из `record.parts`
 * @returns полный урон цели и итоги частей
 */
export function resolveRecordedDamage(
  entity: DnDSceneEntity,
  record: Pick<AttackDamageRecord, 'parts' | 'ignoredResistances'>,
  target: Pick<AttackDamageTarget, 'contributions'>,
  rolledAmounts: readonly number[],
): ResolvedRecordedDamage {
  const defenses = resolveTargetDamageDefenses(
    entity,
    record.ignoredResistances,
  );

  let outcome: DamageDefenseOutcome = 'normal';
  let total = 0;

  const parts: AppliedDamagePart[] = [];
  const damageTypes = new Set<string>();

  for (const contribution of target.contributions) {
    const part = record.parts[contribution.part];
    const rolled = rolledAmounts[contribution.part];

    if (!part || rolled === undefined) {
      continue;
    }

    // Вычет из урона («минус кость к урону атак») — не урон: ни доля
    // спасброска, ни защиты цели его не меняют
    if (rolled < 0) {
      total += rolled;
      parts.push({ part: contribution.part, applied: rolled, outcome });

      continue;
    }

    const defended = applyMultiTypeDamageDefenses(
      Math.floor(rolled * contribution.scale),
      part.types,
      defenses,
    );

    if (defended.outcome !== 'normal') {
      outcome = defended.outcome;
    }

    if (defended.finalDamage > 0) {
      for (const type of part.types) {
        damageTypes.add(type);
      }
    }

    total += defended.finalDamage;

    parts.push({
      part: contribution.part,
      applied: defended.finalDamage,
      outcome: defended.outcome,
    });
  }

  return {
    total: Math.max(0, total),
    outcome,
    parts,
    damageTypes: [...damageTypes],
  };
}

/**
 * Снимает с цели посчитанный урон записи: хиты пишутся одним изменением,
 * удар записывается в копию для событий урона на сервере.
 *
 * @param entity - цель, какой она есть сейчас
 * @param record - запись об уроне: крит и кто бил
 * @param resolved - урон цели после защит
 * @param damage - сколько нанести: полный урон либо его половина
 * @returns копия цели с уроном и итог для чата и новой записи
 */
export function dealRecordedDamage(
  entity: DnDSceneEntity,
  record: Pick<AttackDamageRecord, 'critical' | 'sourceId'>,
  resolved: ResolvedRecordedDamage,
  damage: number,
): AppliedRecordedDamage {
  const hpBefore = resolveEntityCurrentHp(entity);
  const tempBefore = resolveEntityTempHp(entity);

  const hpChange = applyHpChange({
    hpBefore,
    maxHp: resolveEntityMaxHp(entity),
    tempBefore,
    damage,
    heal: 0,
  });

  const updatedEntity: DnDSceneEntity = JSON.parse(JSON.stringify(entity));

  writeEntityHitPoints(updatedEntity, {
    current: hpChange.hpAfter,
    temp: hpChange.tempAfter,
  });

  recordDamageHit(updatedEntity, {
    amount: hpBefore + tempBefore - hpChange.hpAfter - hpChange.tempAfter,
    // Урон по хитам без того, что сняли временные: на нуле хитов потеря
    // ноль, а спасброски от смерти считают удар
    dealt: damage - hpChange.tempAbsorbed,
    types: resolved.damageTypes,
    critical: record.critical,
    sourceId: record.sourceId,
  });

  return {
    updatedEntity,
    hpBefore,
    hpAfter: hpChange.hpAfter,
    tempLost: hpChange.tempAbsorbed,
    hpChange: {
      hpBefore,
      hpAfter: hpChange.hpAfter,
      tempBefore,
      tempAfter: hpChange.tempAfter,
      isPublic: isEntityHpShownToPlayers(entity),
    },
    outcome: resolved.outcome,
    parts: resolved.parts,
    total: resolved.total,
    damage,
  };
}

/**
 * Наносит цели заново брошенный урон записи: доля спасброска — та же, что в
 * первый раз, защиты — нынешние, половина урона (`record.half`) — как стоит
 * в записи. Хиты пишутся одним изменением, удар записывается в копию для
 * событий урона на сервере.
 *
 * @param entity - цель, какой она есть сейчас
 * @param record - запись об уроне
 * @param target - цель записи: какие части до неё доходят
 * @param rolledAmounts - новые броски частей по номерам из `record.parts`
 * @returns копия цели с уроном и итог для чата и новой записи
 */
export function applyRecordedDamage(
  entity: DnDSceneEntity,
  record: AttackDamageRecord,
  target: Pick<AttackDamageTarget, 'contributions'>,
  rolledAmounts: readonly number[],
): AppliedRecordedDamage {
  const resolved = resolveRecordedDamage(entity, record, target, rolledAmounts);

  return dealRecordedDamage(
    entity,
    record,
    resolved,
    resolveModeDamage(resolved.total, record.half === true),
  );
}

/**
 * Запись об уроне одной формулой по одной цели — обычная атака оружием.
 *
 * @param params - что брошено и что снято с цели
 * @param params.label - чем нанесён урон
 * @param params.formula - брошенная формула урона (кости крита уже удвоены)
 * @param params.damageType - тип урона, если он известен
 * @param params.targetId - сущность-цель
 * @param params.result - итог применения урона к цели
 * @param params.details - подробности удара: крит, кто бил, чьи сопротивления
 *   не действуют
 * @param params.consequences - что удар изменил у цели помимо хитов
 * @param params.roll - итог и кости броска урона: с ними под уроном работают
 *   «Половина» и «Крит»
 * @returns запись для дополнения чата
 */
export function buildSingleTargetDamageRecord(params: {
  label: string;
  formula: string;
  damageType: string | undefined;
  targetId: string;
  result: DndDamageApplyResult;
  details: DamageHitDetails;
  consequences?: AttackHitConsequences;
  roll?: Pick<RolledDamagePartInput, 'total' | 'values'>;
}): AttackDamageRecord {
  const { details, result } = params;

  const roll = params.roll
    ? describeDamagePartRoll({
        ...params.roll,
        formula: params.formula,
        critical: details.critical,
      })
    : undefined;

  return {
    label: params.label,
    critical: details.critical,
    ...(details.sourceId ? { sourceId: details.sourceId } : {}),
    ...(details.ignoredResistances && details.ignoredResistances.length > 0
      ? { ignoredResistances: [...details.ignoredResistances] }
      : {}),
    parts: [
      {
        formula: params.formula,
        types: params.damageType ? [params.damageType] : [],
        ...(roll ? { roll } : {}),
      },
    ],
    targets: [
      {
        entityId: params.targetId,
        name: result.actorName,
        hpLost: result.hpBefore - result.hpAfter,
        tempLost: result.tempAbsorbed ?? 0,
        contributions: [{ part: 0, scale: 1 }],
        ...(result.damageDealt === undefined
          ? {}
          : {
              totals: details.critical
                ? { critical: result.damageDealt }
                : { normal: result.damageDealt },
            }),
        ...params.consequences,
      },
    ],
  };
}
