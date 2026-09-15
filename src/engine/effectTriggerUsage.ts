/**
 * Счётчики лимита «не чаще N раз» у срабатываний.
 *
 * Счётчик живёт на субъекте (`system.effectUsage`), а не на эффекте: у эффекта
 * зоны на стоящем в ней каждый раз новая копия, ауру чужого токена пересчитывают
 * на каждом ходу, а черта существа вообще не копируется на сущность. Ключ —
 * источник эффекта и id срабатывания (либо общий `limit.key`), так что «урон
 * зоны раз в ход» считает вход в зону и начало хода в ней одним лимитом.
 *
 * Сбрасываются счётчики на своих границах: ход — в конце любого хода боя
 * (`expireTurnEffects`), раунд — с новым раундом (`decrementActorEffectDurations`),
 * отдых — в `restEngine`.
 */

import type { DnDSceneEntity } from './dndEntities.js';
import type {
  EffectTrigger,
  EffectTriggerLimit,
  EffectTriggerLimitPeriod,
} from './effectTriggerTypes.js';

import { isRecord } from '@vtt/shared';

import { EFFECT_TRIGGER_LIMIT_PERIODS } from './effectTriggerTypes.js';

/** Сколько раз срабатывание уже сработало за период */
export interface EffectTriggerUsageEntry {
  used: number;
  per: EffectTriggerLimitPeriod;
}

/** Счётчики лимитов субъекта по ключу срабатывания */
export type EffectTriggerUsageLedger = Record<string, EffectTriggerUsageEntry>;

/** Разделитель источника и id в ключе счётчика */
const USAGE_KEY_SEPARATOR = '|';

/**
 * Ключ счётчика срабатывания.
 *
 * @param scope - источник эффекта: id эффекта, `area:<зона>`, `aura:<эффект>`
 * @param trigger - срабатывание с лимитом
 * @returns ключ
 */
export function buildTriggerUsageKey(
  scope: string,
  trigger: EffectTrigger,
): string {
  return `${scope}${USAGE_KEY_SEPARATOR}${trigger.limit?.key ?? trigger.id}`;
}

/** Известные периоды лимита — для проверки значения из данных */
const LIMIT_PERIODS: ReadonlySet<unknown> = new Set(
  EFFECT_TRIGGER_LIMIT_PERIODS,
);

/**
 * Известный ли период лимита.
 *
 * @param value - значение из данных
 * @returns `true` для периода лимита
 */
function isLimitPeriod(value: unknown): value is EffectTriggerLimitPeriod {
  return LIMIT_PERIODS.has(value);
}

/**
 * Счётчики субъекта из данных — терпимо: негодная запись пропускается.
 *
 * @param entity - субъект
 * @returns счётчики
 */
export function readTriggerUsage(
  entity: DnDSceneEntity,
): EffectTriggerUsageLedger {
  const raw = entity.system.effectUsage;

  if (!isRecord(raw)) {
    return {};
  }

  const ledger: EffectTriggerUsageLedger = {};

  for (const [key, entry] of Object.entries(raw)) {
    if (
      isRecord(entry)
      && typeof entry.used === 'number'
      && entry.used > 0
      && isLimitPeriod(entry.per)
    ) {
      ledger[key] = { used: entry.used, per: entry.per };
    }
  }

  return ledger;
}

/**
 * Записывает счётчики субъекту; пустые не хранятся.
 *
 * @param entity - субъект
 * @param ledger - счётчики
 */
function writeTriggerUsage(
  entity: DnDSceneEntity,
  ledger: EffectTriggerUsageLedger,
): void {
  entity.system.effectUsage =
    Object.keys(ledger).length > 0 ? ledger : undefined;
}

/**
 * Исчерпан ли лимит срабатывания.
 *
 * @param entity - субъект
 * @param key - ключ счётчика
 * @param limit - лимит срабатывания
 * @returns `true`, если срабатывать больше нельзя
 */
export function isTriggerLimitReached(
  entity: DnDSceneEntity,
  key: string,
  limit: EffectTriggerLimit,
): boolean {
  return (readTriggerUsage(entity)[key]?.used ?? 0) >= limit.max;
}

/**
 * Отмечает срабатывание в счётчике.
 *
 * @param entity - субъект
 * @param key - ключ счётчика
 * @param limit - лимит срабатывания
 */
export function consumeTriggerUse(
  entity: DnDSceneEntity,
  key: string,
  limit: EffectTriggerLimit,
): void {
  const ledger = readTriggerUsage(entity);
  const used = (ledger[key]?.used ?? 0) + 1;

  writeTriggerUsage(entity, { ...ledger, [key]: { used, per: limit.per } });
}

/** Периоды, которые ведёт бой: вне боя ходов и раундов нет */
const COMBAT_LIMIT_PERIODS: readonly EffectTriggerLimitPeriod[] = [
  'turn',
  'round',
];

/**
 * Проверяет лимит и, если срабатывать можно, отмечает срабатывание.
 *
 * Вне боя лимит хода и раунда не ограничивает: сбросить его некому, и зона,
 * ударившая раз, молчала бы до следующего боя. Оставшиеся от прошлого боя
 * счётчики хода и раунда при этом стираются — следующий бой начнётся с нуля.
 *
 * @param entity - субъект
 * @param scope - источник эффекта
 * @param trigger - срабатывание
 * @param inCombat - идёт ли у субъекта бой
 * @returns `true`, если срабатывание выполняется
 */
export function takeTriggerUse(
  entity: DnDSceneEntity,
  scope: string,
  trigger: EffectTrigger,
  inCombat = true,
): boolean {
  if (!trigger.limit) {
    return true;
  }

  if (!inCombat && COMBAT_LIMIT_PERIODS.includes(trigger.limit.per)) {
    resetTriggerUsage(entity, COMBAT_LIMIT_PERIODS);

    return true;
  }

  const key = buildTriggerUsageKey(scope, trigger);

  if (isTriggerLimitReached(entity, key, trigger.limit)) {
    return false;
  }

  consumeTriggerUse(entity, key, trigger.limit);

  return true;
}

/** Какие периоды лимита заканчивает отдых */
const REST_LIMIT_PERIODS: Record<
  'short' | 'long',
  readonly EffectTriggerLimitPeriod[]
> = {
  short: ['shortRest'],
  long: ['shortRest', 'longRest'],
};

/**
 * Периоды лимита, которые заканчивает отдых.
 *
 * @param restType - короткий или долгий отдых
 * @returns периоды
 */
export function restLimitPeriodsOf(
  restType: 'short' | 'long',
): readonly EffectTriggerLimitPeriod[] {
  return REST_LIMIT_PERIODS[restType];
}

/**
 * Счётчики без закончившихся периодов — для патча сущности.
 *
 * @param entity - субъект
 * @param periods - какие периоды закончились
 * @returns оставшиеся счётчики либо `undefined`, если их не осталось
 */
export function pruneTriggerUsage(
  entity: DnDSceneEntity,
  periods: readonly EffectTriggerLimitPeriod[],
): EffectTriggerUsageLedger | undefined {
  const kept = Object.fromEntries(
    Object.entries(readTriggerUsage(entity)).filter(
      ([, entry]) => !periods.includes(entry.per),
    ),
  );

  return Object.keys(kept).length > 0 ? kept : undefined;
}

/**
 * Сбрасывает счётчики указанных периодов.
 *
 * @param entity - субъект
 * @param periods - какие периоды закончились
 * @returns `true`, если что-то сброшено
 */
export function resetTriggerUsage(
  entity: DnDSceneEntity,
  periods: readonly EffectTriggerLimitPeriod[],
): boolean {
  const before = Object.keys(readTriggerUsage(entity)).length;
  const kept = pruneTriggerUsage(entity, periods);

  if (Object.keys(kept ?? {}).length === before) {
    return false;
  }

  writeTriggerUsage(entity, kept ?? {});

  return true;
}
