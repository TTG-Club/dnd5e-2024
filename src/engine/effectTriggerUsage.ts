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
import type { RestType } from './restEngine.js';

import { z } from 'zod';

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

/** Чей счётчик лимита: зона, копия ауры, черта существа, предмет */
export type TriggerUsageScopeKind = 'area' | 'aura' | 'trait' | 'item';

/**
 * Источник счётчика лимита. Ключи сохраняются в сущность, и общий лимит («вход
 * в зону и начало хода в ней») работает, только если все пути строят источник
 * одинаково.
 *
 * @param kind - чей счётчик
 * @param id - id зоны, копии ауры, эффекта черты или предмета
 * @returns источник для ключа счётчика
 */
export function buildTriggerUsageScope(
  kind: TriggerUsageScopeKind,
  id: string,
): string {
  return `${kind}:${id}`;
}

/** Zod-схема записи счётчика: целое число срабатываний за известный период */
const TriggerUsageEntrySchema = z.object({
  used: z.number().int().positive(),
  per: z.enum(EFFECT_TRIGGER_LIMIT_PERIODS),
});

/**
 * Счётчики субъекта из данных — терпимо: негодная запись пропускается.
 *
 * @param entity - субъект
 * @returns счётчики
 */
export function readTriggerUsage(
  entity: DnDSceneEntity,
): EffectTriggerUsageLedger {
  return parseTriggerUsage(entity.system.effectUsage);
}

/**
 * Счётчики из недоверенных данных (боевой канал, старое сохранение) —
 * терпимо: негодная запись пропускается.
 *
 * @param raw - значение из данных
 * @returns счётчики
 */
export function parseTriggerUsage(raw: unknown): EffectTriggerUsageLedger {
  if (!isRecord(raw)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(raw).flatMap(([key, rawEntry]) => {
      const parsed = TriggerUsageEntrySchema.safeParse(rawEntry);

      return parsed.success ? [[key, parsed.data]] : [];
    }),
  );
}

/** Предел длины ключа счётчика в разнице журнала */
const MAX_USAGE_KEY_LENGTH = 512;

/** Сколько ключей принимает одна разница журнала */
const MAX_USAGE_CHANGE_KEYS = 256;

/**
 * Изменения журнала срабатываний относительно копии, от которой их считал
 * клиент.
 *
 * Расход — приращением, а не итоговым числом: два расхода одного лимита из
 * разных копий складываются, а не затирают друг друга. Сброс периода —
 * снятием ключа.
 */
export interface TriggerUsageChanges {
  /** Сколько срабатываний добавилось по ключу (`used` — приращение) */
  spend: EffectTriggerUsageLedger;
  /** Ключи основы, которых в итоге нет */
  removeKeys: string[];
}

/** Zod-схема разницы журнала из боевого снимка клиента */
export const TriggerUsageChangesSchema = z.object({
  spend: z
    .record(
      z.string().min(1).max(MAX_USAGE_KEY_LENGTH),
      TriggerUsageEntrySchema,
    )
    .refine(
      (spend) => Object.keys(spend).length <= MAX_USAGE_CHANGE_KEYS,
      'Слишком много ключей в разнице журнала',
    ),
  removeKeys: z
    .array(z.string().min(1).max(MAX_USAGE_KEY_LENGTH))
    .max(MAX_USAGE_CHANGE_KEYS),
});

/**
 * Разница двух журналов: что израсходовано и что сброшено.
 *
 * Число, ставшее меньше (такого правила нет, но данные недоверенные),
 * выражается снятием ключа и новым расходом с нуля.
 *
 * @param base - журнал, от которого считали
 * @param next - посчитанный журнал
 * @returns приращения и снятые ключи
 */
export function diffTriggerUsage(
  base: EffectTriggerUsageLedger,
  next: EffectTriggerUsageLedger,
): TriggerUsageChanges {
  const removeKeys = Object.keys(base).filter(
    (key) => !(key in next) || next[key].used < base[key].used,
  );

  const spend = Object.fromEntries(
    Object.entries(next).flatMap(([key, entry]) => {
      const before = removeKeys.includes(key) ? 0 : (base[key]?.used ?? 0);
      const added = entry.used - before;

      return added > 0 ? [[key, { used: added, per: entry.per }]] : [];
    }),
  );

  return { spend, removeKeys };
}

/**
 * Есть ли в разнице журнала хоть что-то.
 *
 * @param changes - разница
 * @returns `true`, если есть расход или сброс
 */
export function hasTriggerUsageChanges(changes: TriggerUsageChanges): boolean {
  return changes.removeKeys.length > 0 || Object.keys(changes.spend).length > 0;
}

/**
 * Сливает разницу с журналом сервера: снятые ключи убираются, расход
 * прибавляется к тому, что сервер уже насчитал.
 *
 * @param current - журнал сущности на сервере (не мутируется)
 * @param changes - разница от клиента
 * @returns новый журнал
 */
export function applyTriggerUsageChanges(
  current: EffectTriggerUsageLedger,
  changes: TriggerUsageChanges,
): EffectTriggerUsageLedger {
  const removed = new Set(changes.removeKeys);

  const kept = Object.fromEntries(
    Object.entries(current).filter(([key]) => !removed.has(key)),
  );

  return Object.entries(changes.spend).reduce<EffectTriggerUsageLedger>(
    (ledger, [key, entry]) => ({
      ...ledger,
      [key]: { used: (ledger[key]?.used ?? 0) + entry.used, per: entry.per },
    }),
    kept,
  );
}

/**
 * Записывает счётчики субъекту; пустые не хранятся.
 *
 * @param entity - субъект
 * @param ledger - счётчики
 */
export function writeTriggerUsage(
  entity: DnDSceneEntity,
  ledger: EffectTriggerUsageLedger,
): void {
  entity.system.effectUsage =
    Object.keys(ledger).length > 0 ? ledger : undefined;
}

/**
 * Сущность с другим журналом — новым объектом: запись стора хоста на месте не
 * меняется.
 *
 * @param entity - сущность
 * @param ledger - журнал
 * @returns новая сущность; пустой журнал не хранится
 */
export function withTriggerUsage<Entity extends DnDSceneEntity>(
  entity: Entity,
  ledger: EffectTriggerUsageLedger,
): Entity {
  return {
    ...entity,
    system: {
      ...entity.system,
      effectUsage: Object.keys(ledger).length > 0 ? ledger : undefined,
    },
  };
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

/**
 * Лимит реакции: одна за раунд на всё существо.
 *
 * Своего счётчика реакций у листа нет, и заводить второй учёт ради него
 * незачем: «не чаще одного раза за раунд» — тот же счётчик лимитов, только с
 * общим для всех эффектов носителя источником ({@link REACTION_USAGE_SCOPE}).
 * Так два эффекта с ценой «Реакция» не срабатывают в одном раунде оба.
 */
export const REACTION_TRIGGER_LIMIT: EffectTriggerLimit = {
  max: 1,
  per: 'round',
  key: 'reaction',
};

/** Источник счётчика реакции — общий у всех эффектов носителя */
export const REACTION_USAGE_SCOPE = 'reaction';

/**
 * Лимит срабатывания с учётом цены: реакция сама по себе «не чаще раза за
 * раунд», даже если своего лимита у срабатывания нет.
 *
 * @param trigger - срабатывание
 * @returns лимит либо `undefined`, если срабатывание не ограничено
 */
export function resolveTriggerLimit(
  trigger: Pick<EffectTrigger, 'limit' | 'cost'>,
): EffectTriggerLimit | undefined {
  if (trigger.limit) {
    return trigger.limit;
  }

  return trigger.cost === 'reaction' ? REACTION_TRIGGER_LIMIT : undefined;
}

/** Периоды, которые ведёт бой: вне боя ходов и раундов нет */
const COMBAT_LIMIT_PERIODS: readonly EffectTriggerLimitPeriod[] = [
  'turn',
  'round',
];

/**
 * Ключ счётчика лимита срабатывания. Счётчик реакции общий у всех эффектов
 * носителя, поэтому источник у него не эффект, а сам носитель.
 *
 * @param scope - источник эффекта
 * @param trigger - срабатывание
 * @param limit - действующий лимит срабатывания
 * @returns ключ счётчика
 */
function resolveTriggerUsageKey(
  scope: string,
  trigger: EffectTrigger,
  limit: EffectTriggerLimit,
): string {
  return buildTriggerUsageKey(trigger.limit ? scope : REACTION_USAGE_SCOPE, {
    ...trigger,
    limit,
  });
}

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
  const limit = resolveTriggerLimit(trigger);

  if (!limit) {
    return true;
  }

  if (!inCombat && COMBAT_LIMIT_PERIODS.includes(limit.per)) {
    resetTriggerUsage(entity, COMBAT_LIMIT_PERIODS);

    return true;
  }

  const key = resolveTriggerUsageKey(scope, trigger, limit);

  if (isTriggerLimitReached(entity, key, limit)) {
    return false;
  }

  consumeTriggerUse(entity, key, limit);

  return true;
}

/**
 * Пройдёт ли срабатывание по лимиту — без отметки в счётчике. Так проверяют
 * срабатывание, которое сперва спросит человека: лимит тратит согласие, а не
 * вопрос ({@link takeTriggerUse} — уже по ответу).
 *
 * @param entity - субъект
 * @param scope - источник эффекта
 * @param trigger - срабатывание
 * @param inCombat - идёт ли у субъекта бой
 * @returns `true`, если лимит не исчерпан
 */
export function canTakeTriggerUse(
  entity: DnDSceneEntity,
  scope: string,
  trigger: EffectTrigger,
  inCombat = true,
): boolean {
  const limit = resolveTriggerLimit(trigger);

  if (!limit || (!inCombat && COMBAT_LIMIT_PERIODS.includes(limit.per))) {
    return true;
  }

  return !isTriggerLimitReached(
    entity,
    resolveTriggerUsageKey(scope, trigger, limit),
    limit,
  );
}

/** Какие периоды лимита заканчивает отдых */
const REST_LIMIT_PERIODS: Record<
  RestType,
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
  restType: RestType,
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

/**
 * Остались ли у эффекта заряды — без траты: проверка срабатывания, которое
 * сперва спросит человека.
 *
 * @param entity - субъект
 * @param effectId - эффект, чьё срабатывание идёт
 * @returns `true`, если зарядов нет вовсе или они ещё есть
 */
export function hasEffectCharge(
  entity: DnDSceneEntity,
  effectId: string,
): boolean {
  const charges = entity.activeEffects?.find(
    (effect) => effect.id === effectId,
  )?.charges;

  return !charges || charges.current > 0;
}

/**
 * Проверяет заряды эффекта и, если срабатывать можно, тратит один.
 *
 * Заряды живут в самом эффекте, а не в счётчиках субъекта: «Огненный щит на
 * три отражения» — свойство этого экземпляра, и у второй копии свои три. Из
 * этого же следует граница: тратить можно только у эффекта, который ЛЕЖИТ на
 * существе. У ауры чужого токена и у эффекта зоны экземпляра нет, списывать
 * заряд некуда — такие срабатывания заряды просто не считают.
 *
 * Последний заряд с пометкой `endsWhenEmpty` снимает эффект тут же: само
 * срабатывание при этом доигрывает — заряд потрачен на него.
 *
 * @param entity - субъект
 * @param effectId - эффект, чьё срабатывание идёт
 * @returns `true`, если срабатывание выполняется
 */
export function takeEffectCharge(
  entity: DnDSceneEntity,
  effectId: string,
): boolean {
  const effects = entity.activeEffects;
  const index = effects?.findIndex((effect) => effect.id === effectId) ?? -1;

  if (!effects || index < 0) {
    return true;
  }

  const effect = effects[index];
  const charges = effect.charges;

  if (!charges) {
    return true;
  }

  if (charges.current <= 0) {
    return false;
  }

  const current = charges.current - 1;

  if (current === 0 && charges.endsWhenEmpty) {
    entity.activeEffects = effects.filter((_, at) => at !== index);

    return true;
  }

  entity.activeEffects = effects.map((kept, at) =>
    at === index ? { ...kept, charges: { ...charges, current } } : kept,
  );

  return true;
}
