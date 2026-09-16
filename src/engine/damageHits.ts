/**
 * Удары для событий урона: что знает о каждом ударе клиент (типы, крит, кто
 * бил) и как оно едет на сервер в боевом снимке.
 *
 * Модуль без правил: его пишут применение урона (`damageApplication.ts`) и
 * снимок боевого состояния, а читают события урона (`effectDamageEvents.ts`).
 */

import type { DnDSceneEntity } from './dndEntities.js';
import type { TriggerDamageData } from './triggerConditions.js';
import type { TurnDamageOutcome } from './turnEffects.js';

import { z } from 'zod';

import { parseEachValid } from './lenientParse.js';

/** Удар: урон события, его типы, крит и кто бил */
export interface DamageHit extends TriggerDamageData {
  /** Кто нанёс урон — другая сторона события */
  sourceId?: string;
}

/** Сколько ударов принимает один боевой снимок */
const MAX_DAMAGE_HITS = 16;

/** Сколько типов урона у одного удара */
const MAX_DAMAGE_HIT_TYPES = 8;

/** Zod-схема удара из боевого снимка клиента */
const DamageHitSchema = z.object({
  amount: z.number().finite().nonnegative(),
  types: z.array(z.string().min(1)).max(MAX_DAMAGE_HIT_TYPES).catch([]),
  critical: z.boolean().catch(false),
  sourceId: z.string().min(1).optional().catch(undefined),
});

/**
 * Удары из боевого снимка. Снимок пришёл по сети: негодный удар выбрасывается
 * один, лишние сверх предела — тоже.
 *
 * @param value - поле `damage` снимка
 * @returns удары
 */
export function parseDamageHits(value: unknown): DamageHit[] {
  return parseEachValid(DamageHitSchema, value).slice(0, MAX_DAMAGE_HITS);
}

/**
 * Удары, записанные в копию сущности до отправки. Ключ — сама копия: клиент
 * клонирует цель на каждый удар, и запись живёт ровно столько, сколько копия.
 */
const recordedHits = new WeakMap<DnDSceneEntity, DamageHit[]>();

/**
 * Записывает удар в копию сущности: боевой снимок увезёт его на сервер.
 *
 * @param entity - копия цели, в которую уже записан урон
 * @param hit - удар
 */
export function recordDamageHit(entity: DnDSceneEntity, hit: DamageHit): void {
  if (hit.amount <= 0) {
    return;
  }

  recordedHits.set(entity, [...(recordedHits.get(entity) ?? []), hit]);
}

/**
 * Удары, записанные в копию сущности.
 *
 * @param entity - копия цели
 * @returns удары по порядку
 */
export function readDamageHits(entity: DnDSceneEntity): readonly DamageHit[] {
  return recordedHits.get(entity) ?? [];
}

/**
 * Удары снимка, урезанные до того, что сущность действительно потеряла.
 * Снимок пришёл от клиента: удар больше потери поднял бы Сл концентрации, а
 * удар без потери — вызвал бы спасбросок без урона.
 *
 * @param hits - удары снимка
 * @param loss - сколько хитов с временными ушло
 * @returns удары, чья сумма не больше потери
 */
export function clampDamageHits(
  hits: readonly DamageHit[],
  loss: number,
): DamageHit[] {
  let remaining = Math.max(0, loss);

  return hits.flatMap((hit) => {
    const amount = Math.min(hit.amount, remaining);

    remaining -= amount;

    return amount > 0 ? [{ ...hit, amount }] : [];
  });
}

/**
 * Удары урона, нанесённого на сервере срабатываниями.
 *
 * @param outcomes - исходы урона
 * @returns удары
 */
export function toDamageHits(
  outcomes: readonly TurnDamageOutcome[],
): DamageHit[] {
  return outcomes.map((outcome) => ({
    amount: outcome.total,
    types: outcome.types,
    critical: false,
  }));
}

/** Zod-схема подробностей удара, которые клиент передаёт в применение урона */
const DamageHitDetailsSchema = z.object({
  critical: z.boolean().catch(false),
  sourceId: z.string().min(1).optional().catch(undefined),
  /** Типы урона, чьё сопротивление цели удар игнорирует */
  ignoredResistances: z
    .array(z.string().min(1))
    .max(MAX_DAMAGE_HIT_TYPES)
    .optional()
    .catch(undefined),
});

/** Подробности удара: крит, кто бил и какие сопротивления игнорирует */
export type DamageHitDetails = z.infer<typeof DamageHitDetailsSchema>;

/**
 * Подробности удара от вызывающего применение урона. Ядро передаёт их как
 * есть, поэтому форма проверяется: негодные — «не крит, бивший неизвестен».
 *
 * @param value - подробности удара
 * @returns крит и кто бил
 */
export function parseDamageHitDetails(value: unknown): DamageHitDetails {
  const parsed = DamageHitDetailsSchema.safeParse(value);

  return parsed.success ? parsed.data : { critical: false };
}
