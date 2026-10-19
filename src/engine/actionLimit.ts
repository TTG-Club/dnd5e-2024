/**
 * Ограничения действий существа: перезарядка и «раз в N ходов».
 *
 * Потраченное действие отмечается в журнале существа (`system.effectUsage`) —
 * том же, что у лимитов срабатываний: он едет боевым каналом, сервер сливает
 * его разницей, отдых чистит его по периодам. Своего хранилища ради двух
 * отметок заводить незачем.
 *
 * - Перезарядка `d3`…`d6` — запись `per: 'recharge'`; снимает её успешный
 *   бросок к6 в начале хода существа (запрос мастеру или хозяину) либо отдых.
 * - Перезарядка `slr`/`lr` — запись с периодом отдыха: снимает только отдых.
 * - «Раз в N ходов» — запись `per: 'cooldown'`, `used` = сколько ходов
 *   существа осталось ждать. Начало каждого хода существа уменьшает число, на
 *   нуле запись снимается: применённое в ход 1 при N = 3 снова доступно в ход 4.
 *   Вне боя ходов нет — там оно не ограничивает и не тратится.
 */

import type { ServerRollRequestOptions } from '@vtt/shared';

import type { CreatureSpellGroup } from './creatureSpellcasting.js';
import type { CreatureAction, CreatureRecharge } from './creatureTypes.js';
import type { DnDCreature } from './dndEntities.js';
import type {
  EffectTriggerUsageLedger,
  EffectUsagePeriod,
} from './effectTriggerUsage.js';

import { z } from 'zod';

import { isNeutralRollAnswer, isRecord } from '@vtt/shared';

// ── Данные ──────────────────────────────────────────────────────────────────

/** Наименьшее «раз в N ходов»: раз в ход — это вовсе не ограничение */
export const MIN_COOLDOWN_TURNS = 2;

/** Наибольшее «раз в N ходов»: дольше бой почти не длится */
export const MAX_COOLDOWN_TURNS = 20;

/** Все условия перезарядки — для разбора недоверенных данных */
export const CREATURE_RECHARGE_KEYS: readonly CreatureRecharge[] = [
  'd3',
  'd4',
  'd5',
  'd6',
  'slr',
  'lr',
];

/** Условия перезарядки броском к6 — для схемы запроса и порогов */
const ROLLED_RECHARGE_KEYS = ['d3', 'd4', 'd5', 'd6'] as const;

/** Перезарядка броском к6 */
export type RolledCreatureRecharge = Extract<
  CreatureRecharge,
  (typeof ROLLED_RECHARGE_KEYS)[number]
>;

/** С какого значения к6 бросковая перезарядка успешна */
const RECHARGE_THRESHOLDS: Record<RolledCreatureRecharge, number> = {
  d3: 3,
  d4: 4,
  d5: 5,
  d6: 6,
};

/** Наибольшее значение к6 */
const RECHARGE_DIE_MAX = 6;

/** Формула броска перезарядки — нейтральному окну ядра и серверу */
export const RECHARGE_ROLL_FORMULA = '1d6';

/** Перезарядка, которую возвращает только отдых, — и какой */
const REST_RECHARGE_PERIODS: Record<
  Exclude<CreatureRecharge, RolledCreatureRecharge>,
  EffectUsagePeriod
> = {
  slr: 'shortRest',
  lr: 'longRest',
};

/**
 * Перезарядка бросается к6.
 *
 * @param recharge - условие перезарядки
 * @returns `true` для `d3`…`d6`
 */
export function isRolledRecharge(
  recharge: CreatureRecharge,
): recharge is RolledCreatureRecharge {
  return recharge in RECHARGE_THRESHOLDS;
}

/**
 * Порог успеха перезарядки.
 *
 * @param recharge - перезарядка броском
 * @returns наименьшее успешное значение к6
 */
export function getRechargeThreshold(recharge: RolledCreatureRecharge): number {
  return RECHARGE_THRESHOLDS[recharge];
}

/**
 * Успешен ли бросок перезарядки.
 *
 * @param total - выпавшее на к6
 * @param recharge - перезарядка броском
 * @returns `true` — действие снова доступно
 */
export function isRechargeSuccess(
  total: number,
  recharge: RolledCreatureRecharge,
): boolean {
  return total >= getRechargeThreshold(recharge);
}

/**
 * Диапазон перезарядки словами: «5–6», «6».
 *
 * @param recharge - перезарядка броском
 * @returns диапазон
 */
export function formatRechargeRange(recharge: RolledCreatureRecharge): string {
  const threshold = getRechargeThreshold(recharge);

  return threshold === RECHARGE_DIE_MAX
    ? String(RECHARGE_DIE_MAX)
    : `${threshold}–${RECHARGE_DIE_MAX}`;
}

/**
 * «Раз в N ходов» из недоверенных данных: целое 2–20, иначе ничего.
 *
 * @param raw - значение из данных
 * @returns число ходов либо `undefined`
 */
export function normalizeCooldownTurns(raw: unknown): number | undefined {
  return typeof raw === 'number'
    && Number.isInteger(raw)
    && raw >= MIN_COOLDOWN_TURNS
    && raw <= MAX_COOLDOWN_TURNS
    ? raw
    : undefined;
}

/** Чем ограничено действие */
export type ActionLimit =
  | { kind: 'recharge'; recharge: CreatureRecharge }
  | { kind: 'cooldown'; turns: number };

/**
 * Ограничение записи статблока. Перезарядка главнее «раз в N ходов»: заданы
 * оба — это ошибка данных, и правило из книги побеждает своё.
 *
 * @param action - запись статблока
 * @returns ограничение либо `undefined`
 */
export function resolveActionLimit(
  action: Pick<CreatureAction, 'recharge' | 'cooldownTurns'>,
): ActionLimit | undefined {
  if (action.recharge) {
    return { kind: 'recharge', recharge: action.recharge };
  }

  const turns = normalizeCooldownTurns(action.cooldownTurns);

  return turns === undefined ? undefined : { kind: 'cooldown', turns };
}

/**
 * Ограничение группы заклинаний — по её режиму.
 *
 * @param group - группа
 * @returns ограничение либо `undefined`
 */
export function resolveSpellGroupLimit(
  group: Pick<CreatureSpellGroup, 'mode' | 'recharge' | 'cooldownTurns'>,
): ActionLimit | undefined {
  if (group.mode === 'recharge') {
    return group.recharge
      ? { kind: 'recharge', recharge: group.recharge }
      : undefined;
  }

  const turns =
    group.mode === 'cooldown'
      ? normalizeCooldownTurns(group.cooldownTurns)
      : undefined;

  return turns === undefined ? undefined : { kind: 'cooldown', turns };
}

// ── Ключи журнала ───────────────────────────────────────────────────────────

/** Начало ключа журнала у ограничений действий */
const ACTION_LIMIT_KEY_PREFIX = 'actionLimit:';

/** Вставка ключа журнала у групп заклинаний */
const SPELL_GROUP_KEY_PART = 'spellGroup:';

/**
 * Ключ журнала записи статблока. Держится за `id` записи
 * (`stampCreatureActionIds`), а не за название: у существа бывают две записи
 * с одним названием.
 *
 * @param actionId - id записи
 * @returns ключ
 */
export function buildActionLimitKey(actionId: string): string {
  return `${ACTION_LIMIT_KEY_PREFIX}${actionId}`;
}

/**
 * Ключ журнала группы заклинаний.
 *
 * @param groupId - id группы
 * @returns ключ
 */
export function buildSpellGroupLimitKey(groupId: string): string {
  return `${ACTION_LIMIT_KEY_PREFIX}${SPELL_GROUP_KEY_PART}${groupId}`;
}

// ── Состояние и трата ───────────────────────────────────────────────────────

/** Доступно ли действие по своему ограничению */
export type ActionLimitState =
  | { status: 'ready' }
  | { status: 'spent'; recharge: CreatureRecharge }
  | { status: 'cooldown'; turnsLeft: number };

/** Доступное действие — общее «нет ограничения» для движка и листа */
export const ACTION_LIMIT_READY_STATE: ActionLimitState = { status: 'ready' };

/**
 * Доступно ли действие сейчас.
 *
 * @param ledger - журнал существа
 * @param key - ключ действия
 * @param limit - ограничение действия
 * @param inCombat - идёт ли у существа бой
 * @returns состояние
 */
export function readActionLimitState(
  ledger: EffectTriggerUsageLedger,
  key: string,
  limit: ActionLimit | undefined,
  inCombat: boolean,
): ActionLimitState {
  const entry = ledger[key];

  if (!limit || !entry) {
    return ACTION_LIMIT_READY_STATE;
  }

  if (limit.kind === 'recharge') {
    return { status: 'spent', recharge: limit.recharge };
  }

  return inCombat && entry.per === 'cooldown'
    ? { status: 'cooldown', turnsLeft: entry.used }
    : ACTION_LIMIT_READY_STATE;
}

/**
 * Журнал после применения действия. Ограничение проверяют до этого
 * ({@link readActionLimitState}).
 *
 * Вне боя «раз в N ходов» не тратится — отсчитывать его некому; оставшаяся
 * от прошлого боя отметка при этом снимается, чтобы следующий бой начался с
 * чистого листа.
 *
 * @param ledger - журнал существа
 * @param key - ключ действия
 * @param limit - ограничение действия
 * @param inCombat - идёт ли у существа бой
 * @returns новый журнал либо `null`, если писать нечего
 */
export function spendActionLimit(
  ledger: EffectTriggerUsageLedger,
  key: string,
  limit: ActionLimit | undefined,
  inCombat: boolean,
): EffectTriggerUsageLedger | null {
  if (!limit) {
    return null;
  }

  if (limit.kind === 'cooldown') {
    if (inCombat) {
      return { ...ledger, [key]: { used: limit.turns, per: 'cooldown' } };
    }

    return key in ledger ? restoreActionLimit(ledger, key) : null;
  }

  const per = isRolledRecharge(limit.recharge)
    ? 'recharge'
    : REST_RECHARGE_PERIODS[limit.recharge];

  return { ...ledger, [key]: { used: 1, per } };
}

/**
 * Журнал без отметки действия — «Восстановить» с листа или успех перезарядки.
 *
 * @param ledger - журнал существа
 * @param key - ключ действия
 * @returns новый журнал либо `null`, если отметки не было
 */
export function restoreActionLimit(
  ledger: EffectTriggerUsageLedger,
  key: string,
): EffectTriggerUsageLedger | null {
  if (!(key in ledger)) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(ledger).filter(([entryKey]) => entryKey !== key),
  );
}

/**
 * Начало хода существа: «раз в N ходов» отсчитывает ход, дошедшие до нуля
 * снова доступны.
 *
 * @param ledger - журнал существа
 * @returns новый журнал либо `null`, если отсчитывать нечего
 */
export function advanceActionCooldowns(
  ledger: EffectTriggerUsageLedger,
): EffectTriggerUsageLedger | null {
  const entries = Object.entries(ledger);

  if (!entries.some(([, entry]) => entry.per === 'cooldown')) {
    return null;
  }

  return Object.fromEntries(
    entries.flatMap(([key, entry]) => {
      if (entry.per !== 'cooldown') {
        return [[key, entry]];
      }

      return entry.used > 1 ? [[key, { ...entry, used: entry.used - 1 }]] : [];
    }),
  );
}

// ── Что ждёт перезарядки ────────────────────────────────────────────────────

/** Потраченное действие с перезарядкой броском */
export interface SpentRecharge {
  /** Ключ журнала */
  key: string;
  /** Название записи или подпись группы заклинаний */
  name: string;
  /** Перезарядка */
  recharge: RolledCreatureRecharge;
}

/** Запись статблока или группа с ограничением — для поиска по журналу */
interface LimitedEntry {
  key: string;
  name: string;
  limit: ActionLimit | undefined;
}

/**
 * Записи статблока и группы заклинаний существа с ключами журнала.
 *
 * @param creature - существо
 * @returns записи с ограничениями
 */
function listLimitedEntries(creature: DnDCreature): LimitedEntry[] {
  const { system } = creature;

  const actions: readonly CreatureAction[] = [
    ...(system.traits ?? []),
    ...(system.actions ?? []),
    ...(system.bonusActions ?? []),
    ...(system.reactions ?? []),
    ...(system.legendary?.actions ?? []),
    ...(system.lair?.effects ?? []),
  ];

  const actionEntries = actions.flatMap((action) =>
    action.id
      ? [
          {
            key: buildActionLimitKey(action.id),
            name: action.name,
            limit: resolveActionLimit(action),
          },
        ]
      : [],
  );

  const groupEntries = (system.spellcastingBlocks ?? []).flatMap((block) =>
    block.groups.map((group) => ({
      key: buildSpellGroupLimitKey(group.id),
      name: group.label ?? block.name,
      limit: resolveSpellGroupLimit(group),
    })),
  );

  return [...actionEntries, ...groupEntries];
}

/**
 * Потраченные действия существа, которые в начале хода ждут броска
 * перезарядки.
 *
 * @param creature - существо
 * @param ledger - журнал существа
 * @returns потраченные действия
 */
export function listSpentRecharges(
  creature: DnDCreature,
  ledger: EffectTriggerUsageLedger,
): SpentRecharge[] {
  return listLimitedEntries(creature).flatMap(({ key, name, limit }) =>
    ledger[key]?.per === 'recharge'
    && limit?.kind === 'recharge'
    && isRolledRecharge(limit.recharge)
      ? [{ key, name, recharge: limit.recharge }]
      : [],
  );
}

/**
 * Кидать ли бросок перезарядки в начале хода самому, без окна. По умолчанию —
 * нет: поле хранится только у согласия.
 *
 * @param creature - существо
 * @returns `true`, если включено «кидать автоматически»
 */
export function readAutoRecharge(creature: DnDCreature): boolean {
  return creature.system.autoRecharge === true;
}

// ── Запрос броска ───────────────────────────────────────────────────────────

/** Вид запроса броска перезарядки — слот адресата узнаёт его по нему */
export const ACTION_RECHARGE_REQUEST_KIND = 'actionRecharge';

/** Подпись «кто просит» у запроса перезарядки */
const RECHARGE_REQUESTER_LABEL = 'Перезарядка';

/** Что просят бросить: перезарядку одного действия */
export interface ActionRechargeRequestPayload {
  kind: typeof ACTION_RECHARGE_REQUEST_KIND;
  /** Ключ журнала действия */
  key: string;
  /** Название действия */
  actionName: string;
  /** Перезарядка */
  recharge: RolledCreatureRecharge;
}

/** Zod-схема нагрузки запроса перезарядки */
const ActionRechargeRequestPayloadSchema = z.object({
  kind: z.literal(ACTION_RECHARGE_REQUEST_KIND),
  key: z.string().min(1),
  actionName: z.string(),
  recharge: z.enum(ROLLED_RECHARGE_KEYS),
});

/**
 * Нагрузка запроса перезарядки из недоверенных данных.
 *
 * @param raw - нагрузка запроса
 * @returns нагрузка либо `null`, если это другой запрос
 */
export function parseActionRechargeRequestPayload(
  raw: unknown,
): ActionRechargeRequestPayload | null {
  const parsed = ActionRechargeRequestPayloadSchema.safeParse(raw);

  return parsed.success ? parsed.data : null;
}

/**
 * Подпись запроса: «Перезарядка «Огненное дыхание» (5–6)».
 *
 * @param actionName - название действия
 * @param recharge - перезарядка
 * @returns подпись
 */
export function formatRechargeRequestTitle(
  actionName: string,
  recharge: RolledCreatureRecharge,
): string {
  return `${RECHARGE_REQUESTER_LABEL} «${actionName}» (${formatRechargeRange(recharge)})`;
}

/**
 * Серверный запрос броска перезарядки — мастеру или хозяину существа.
 *
 * @param creature - существо
 * @param spent - потраченное действие
 * @returns опции запроса для ядра
 */
export function buildActionRechargeRequest(
  creature: DnDCreature,
  spent: SpentRecharge,
): ServerRollRequestOptions {
  const payload: ActionRechargeRequestPayload = {
    kind: ACTION_RECHARGE_REQUEST_KIND,
    key: spent.key,
    actionName: spent.name,
    recharge: spent.recharge,
  };

  return {
    entityId: creature.id,
    requesterLabel: RECHARGE_REQUESTER_LABEL,
    title: formatRechargeRequestTitle(spent.name, spent.recharge),
    fallbackFormula: RECHARGE_ROLL_FORMULA,
    payload,
  };
}

/** Ответ окна системы на запрос перезарядки */
export interface ActionRechargeAnswer {
  kind: typeof ACTION_RECHARGE_REQUEST_KIND;
  /** Выпавшее на к6 */
  total: number;
}

/** Zod-схема выпавшего на к6 */
const RechargeTotalSchema = z.number().int().min(1).max(RECHARGE_DIE_MAX);

/**
 * Выпавшее на к6 из ответа: окно системы или нейтральное окно ядра (у
 * адресата не сработал слот, и он бросил формулу запроса).
 *
 * @param answer - непрозрачный `result` исхода
 * @returns значение к6 либо `null`, если форма ответа незнакома
 */
export function readActionRechargeAnswer(answer: unknown): number | null {
  // Своё окно и нейтральное окно ядра кладут выпавшее одинаково — в `total`
  const isKnownAnswer =
    (isRecord(answer) && answer.kind === ACTION_RECHARGE_REQUEST_KIND)
    || isNeutralRollAnswer(answer);

  const total = isKnownAnswer && isRecord(answer) ? answer.total : undefined;

  const parsed = RechargeTotalSchema.safeParse(total);

  return parsed.success ? parsed.data : null;
}

/** Исход перезарядки словами — в строке чата */
const RECHARGE_OUTCOME_LABELS = {
  ready: 'снова доступно',
  notReady: 'ещё не готово',
} as const;

/**
 * Строка чата об исходе перезарядки.
 *
 * @param creatureName - существо
 * @param actionName - действие
 * @param recharge - перезарядка
 * @param total - выпавшее на к6
 * @returns строка
 */
export function formatRechargeOutcome(
  creatureName: string,
  actionName: string,
  recharge: RolledCreatureRecharge,
  total: number,
): string {
  const verdict = isRechargeSuccess(total, recharge)
    ? RECHARGE_OUTCOME_LABELS.ready
    : RECHARGE_OUTCOME_LABELS.notReady;

  return `${creatureName}: перезарядка «${actionName}» (${formatRechargeRange(recharge)}) — выпало ${total}, ${verdict}`;
}
