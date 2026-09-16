/**
 * Спасброски от смерти (PHB 2024).
 *
 * Персонаж на 0 хитов в начале своего хода бросает к20 против Сл 10: успех или
 * провал копятся до трёх. Три успеха — стабилен, три провала — мёртв. 20 на
 * кости — 1 хит, 1 — два провала. Урон на 0 хитов — провал (крит — два), урон
 * не меньше максимума хитов — смерть.
 *
 * Счётчики живут в `system.deathSaves` персонажа и имеют смысл, только пока
 * хиты на нуле: подъём хитов их сбрасывает, новое падение до нуля начинает
 * серию заново. Сброс — пустые счётчики, а не удалённое поле: `undefined`
 * выпадает при рассылке, и клиент оставил бы старую серию. Существа статблока
 * спасбросков не бросают — у них метка смерти по хитам (`deathState.ts`).
 *
 * @module system/dnd/deathSaves
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { AttackRollMode } from './attackUtils.js';
import type { DnDActor, DnDSceneEntity } from './dndEntities.js';

import { DEATH_CONDITION_KEY } from './conditionKeys.js';
import {
  buildConditionActiveEffect,
  resolveEffectConditionKey,
} from './conditionTemplates.js';
import { isDndActor } from './entityGuards.js';
import { resolveEntityCurrentHp, resolveEntityMaxHp } from './hitPoints.js';

/** Сложность спасброска от смерти */
export const DEATH_SAVE_DC = 10;

/** Сколько успехов или провалов решают серию */
export const DEATH_SAVES_TO_RESOLVE = 3;

/** Натуральная кость, которая возвращает 1 хит */
const DEATH_SAVE_REVIVE_ROLL = 20;

/** Натуральная кость, которая считается двумя провалами */
const DEATH_SAVE_DOUBLE_FAILURE_ROLL = 1;

/** Хиты после 20 на кости */
const DEATH_SAVE_REVIVED_HP = 1;

/** Флаг преимущества на спасброски от смерти («Стойкий») */
export const DEATH_SAVE_ADVANTAGE_FLAG = 'save.advantage.death';

/** Флаг помехи на спасброски от смерти */
export const DEATH_SAVE_DISADVANTAGE_FLAG = 'save.disadvantage.death';

/** Счётчики серии спасбросков от смерти */
export interface DeathSavesState {
  /** Успехи: 0–3 */
  successes: number;
  /** Провалы: 0–3 */
  failures: number;
  /** Три успеха: стабилен, больше не бросает */
  stable?: true;
}

/** Чем кончился спасбросок или урон на нуле хитов */
export type DeathSaveOutcome =
  'success' | 'failure' | 'stable' | 'dead' | 'revived';

/** Итог спасброска от смерти */
export interface DeathSaveResult {
  /** Счётчики после броска */
  state: DeathSavesState;
  /** Что случилось */
  outcome: DeathSaveOutcome;
}

/** Пустая серия */
export const EMPTY_DEATH_SAVES: DeathSavesState = Object.freeze({
  successes: 0,
  failures: 0,
});

/**
 * Идёт ли серия: есть успехи, провалы или отметка «стабилен».
 *
 * @param state - счётчики из записи
 * @returns `true`, если серию есть что сбрасывать
 */
function hasDeathSaveProgress(state: DeathSavesState | undefined): boolean {
  return Boolean(
    state && (state.successes > 0 || state.failures > 0 || state.stable),
  );
}

/**
 * Счётчик в допустимых границах.
 *
 * @param value - сырое значение
 * @returns 0–3
 */
function clampCount(value: unknown): number {
  const count = typeof value === 'number' && Number.isFinite(value) ? value : 0;

  return Math.max(0, Math.min(DEATH_SAVES_TO_RESOLVE, Math.trunc(count)));
}

/**
 * Счётчики серии персонажа. Вне нуля хитов серии нет.
 *
 * @param actor - персонаж
 * @returns счётчики
 */
export function readDeathSaves(actor: DnDActor): DeathSavesState {
  const raw = actor.system.deathSaves;

  if (!raw || resolveEntityCurrentHp(actor) > 0) {
    return EMPTY_DEATH_SAVES;
  }

  return {
    successes: clampCount(raw.successes),
    failures: clampCount(raw.failures),
    ...(raw.stable ? { stable: true } : {}),
  };
}

/**
 * Опознаёт метку смерти.
 *
 * @param effect - эффект
 * @returns `true` для метки «Мёртв»
 */
function isDeathMark(effect: ActiveEffect): boolean {
  return resolveEffectConditionKey(effect) === DEATH_CONDITION_KEY;
}

/**
 * Мёртв ли персонаж по серии: на нём метка «Мёртв».
 *
 * @param actor - персонаж
 * @returns `true`, если персонаж мёртв
 */
export function isActorDead(actor: DnDActor): boolean {
  return (actor.activeEffects ?? []).some(isDeathMark);
}

/**
 * Бросает ли персонаж спасброски от смерти сейчас: хиты на нуле, не стабилен и
 * не мёртв.
 *
 * @param entity - сущность
 * @returns `true`, если серия идёт
 */
export function needsDeathSaves(entity: DnDSceneEntity): boolean {
  if (!isDndActor(entity)) {
    return false;
  }

  return (
    resolveEntityMaxHp(entity) > 0
    && resolveEntityCurrentHp(entity) === 0
    && !readDeathSaves(entity).stable
    && !isActorDead(entity)
  );
}

/**
 * Итог серии после прибавки успехов или провалов.
 *
 * @param state - счётчики до
 * @param successes - прибавка успехов
 * @param failures - прибавка провалов
 * @returns итог
 */
function advanceDeathSaves(
  state: DeathSavesState,
  successes: number,
  failures: number,
): DeathSaveResult {
  const next: DeathSavesState = {
    successes: Math.min(DEATH_SAVES_TO_RESOLVE, state.successes + successes),
    failures: Math.min(DEATH_SAVES_TO_RESOLVE, state.failures + failures),
  };

  if (next.failures >= DEATH_SAVES_TO_RESOLVE) {
    return { state: next, outcome: 'dead' };
  }

  if (next.successes >= DEATH_SAVES_TO_RESOLVE) {
    return { state: { ...next, stable: true }, outcome: 'stable' };
  }

  return { state: next, outcome: successes > 0 ? 'success' : 'failure' };
}

/**
 * Итог спасброска от смерти.
 *
 * @param state - счётчики до броска
 * @param natural - натуральная кость
 * @param total - итог с прибавками
 * @returns итог
 */
export function resolveDeathSave(
  state: DeathSavesState,
  natural: number,
  total: number,
): DeathSaveResult {
  if (natural >= DEATH_SAVE_REVIVE_ROLL) {
    return { state: EMPTY_DEATH_SAVES, outcome: 'revived' };
  }

  if (natural <= DEATH_SAVE_DOUBLE_FAILURE_ROLL) {
    return advanceDeathSaves(state, 0, 2);
  }

  return total >= DEATH_SAVE_DC
    ? advanceDeathSaves(state, 1, 0)
    : advanceDeathSaves(state, 0, 1);
}

/** Удар по персонажу, лежащему на нуле хитов */
export interface DeathSaveDamage {
  /** Урон удара */
  amount: number;
  /** Урон до среза хитами — если известен, считается он */
  dealt?: number;
  /** Критический удар — два провала */
  critical: boolean;
}

/**
 * Итог урона по персонажу на нуле хитов: провал (крит — два), урон не меньше
 * максимума хитов — смерть.
 *
 * @param state - счётчики до урона
 * @param damage - удар
 * @param maxHp - максимум хитов
 * @returns итог
 */
export function resolveDeathSaveDamage(
  state: DeathSavesState,
  damage: DeathSaveDamage,
  maxHp: number,
): DeathSaveResult {
  if (damage.amount >= maxHp) {
    return {
      state: { ...state, failures: DEATH_SAVES_TO_RESOLVE },
      outcome: 'dead',
    };
  }

  // Стабильный от урона теряет стабильность и начинает серию заново
  const base = state.stable
    ? EMPTY_DEATH_SAVES
    : { successes: state.successes, failures: state.failures };

  return advanceDeathSaves(base, 0, damage.critical ? 2 : 1);
}

/**
 * Эффекты персонажа с меткой смерти или без неё.
 *
 * @param effects - эффекты персонажа
 * @param dead - мёртв ли
 * @returns новые эффекты
 */
export function withActorDeathMark(
  effects: readonly ActiveEffect[],
  dead: boolean,
): ActiveEffect[] {
  const living = effects.filter((effect) => !isDeathMark(effect));

  if (!dead) {
    return living;
  }

  const deathMark = buildConditionActiveEffect(DEATH_CONDITION_KEY);

  return deathMark ? [...living, deathMark] : living;
}

/**
 * Записывает итог серии в персонажа: счётчики, 1 хит у поднявшегося, метку
 * смерти у погибшего. МУТИРУЕТ персонажа.
 *
 * @param actor - персонаж
 * @param result - итог спасброска или урона
 */
export function applyDeathSaveResult(
  actor: DnDActor,
  result: DeathSaveResult,
): void {
  if (result.outcome === 'revived') {
    actor.system.deathSaves = { ...EMPTY_DEATH_SAVES };

    actor.system.hitPoints = {
      ...actor.system.hitPoints,
      current: DEATH_SAVE_REVIVED_HP,
    };

    return;
  }

  actor.system.deathSaves = result.state;

  if (result.outcome === 'dead') {
    actor.activeEffects = withActorDeathMark(actor.activeEffects ?? [], true);
  }
}

/**
 * Приводит серию к хитам после их изменения. МУТИРУЕТ персонажа.
 *
 * - хиты выше нуля — серии нет, метка смерти снимается (персонажа подняли);
 * - хиты только что упали до нуля — серия начинается заново.
 *
 * @param entity - сущность после изменения
 * @param hpBefore - хиты до изменения
 * @returns `true`, если персонаж изменился
 */
export function syncDeathSavesWithHp(
  entity: DnDSceneEntity,
  hpBefore: number,
): boolean {
  if (!isDndActor(entity)) {
    return false;
  }

  const hp = resolveEntityCurrentHp(entity);

  if (hp > 0) {
    const hadSeries = hasDeathSaveProgress(entity.system.deathSaves);
    const wasDead = isActorDead(entity);

    if (hadSeries) {
      entity.system.deathSaves = { ...EMPTY_DEATH_SAVES };
    }

    if (wasDead) {
      entity.activeEffects = withActorDeathMark(
        entity.activeEffects ?? [],
        false,
      );
    }

    return hadSeries || wasDead;
  }

  if (hpBefore > 0 && hasDeathSaveProgress(entity.system.deathSaves)) {
    entity.system.deathSaves = { ...EMPTY_DEATH_SAVES };

    return true;
  }

  return false;
}

/**
 * Урон по персонажу: провалы спасбросков от смерти у лежащего на нуле и смерть
 * от урона не меньше максимума. МУТИРУЕТ персонажа.
 *
 * @param entity - сущность с уже записанным уроном
 * @param hpBefore - хиты до урона
 * @param hits - удары
 * @returns итог последнего удара, если серия изменилась
 */
export function settleDeathSaveDamage(
  entity: DnDSceneEntity,
  hpBefore: number,
  hits: readonly DeathSaveDamage[],
): DeathSaveResult | null {
  if (!isDndActor(entity) || resolveEntityCurrentHp(entity) > 0) {
    return null;
  }

  const maxHp = resolveEntityMaxHp(entity);

  if (maxHp <= 0 || isActorDead(entity)) {
    return null;
  }

  let hpLeft = hpBefore;
  let result: DeathSaveResult | null = null;

  for (const hit of hits) {
    const amount = hit.dealt ?? hit.amount;

    if (amount <= 0) {
      continue;
    }

    const state = result?.state ?? readDeathSaves(entity);

    // Удар, опустивший хиты до нуля, серию не двигает; убивает только остаток
    // урона не меньше максимума
    const overflow = hpLeft > 0 ? amount - hpLeft : amount;

    if (hpLeft > 0 && overflow < maxHp) {
      hpLeft = 0;

      continue;
    }

    hpLeft = 0;

    result = resolveDeathSaveDamage(
      state,
      { amount: overflow, critical: hit.critical },
      maxHp,
    );

    if (result.outcome === 'dead') {
      break;
    }
  }

  if (result) {
    applyDeathSaveResult(entity, result);
  }

  return result;
}

/**
 * Режим спасброска от смерти по флагам.
 *
 * @param flags - флаги персонажа
 * @returns режим броска
 */
export function resolveDeathSaveRollMode(
  flags: ReadonlySet<string>,
): AttackRollMode {
  const advantage = flags.has(DEATH_SAVE_ADVANTAGE_FLAG);
  const disadvantage = flags.has(DEATH_SAVE_DISADVANTAGE_FLAG);

  if (advantage === disadvantage) {
    return 'normal';
  }

  return advantage ? 'advantage' : 'disadvantage';
}

/** Итоги серии в чате */
export const DEATH_SAVE_OUTCOME_LABELS: Record<DeathSaveOutcome, string> = {
  success: 'успех',
  failure: 'провал',
  stable: 'три успеха — стабилен',
  dead: 'погибает',
  revived: '20 на кости — приходит в себя с 1 хитом',
};

/** Части строки чата о серии */
const DEATH_SAVE_SUMMARY_LABELS = {
  prefix: ': спасбросок от смерти — ',
  damagePrefix: ': урон на 0 хитов — ',
  successes: ' (успехи ',
  failures: ', провалы ',
  close: ')',
} as const;

/**
 * Строка чата об итоге серии.
 *
 * @param name - имя персонажа
 * @param result - итог
 * @param fromDamage - итог от урона, а не от броска
 * @returns строка
 */
export function formatDeathSaveSummary(
  name: string,
  result: DeathSaveResult,
  fromDamage = true,
): string {
  const prefix = fromDamage
    ? DEATH_SAVE_SUMMARY_LABELS.damagePrefix
    : DEATH_SAVE_SUMMARY_LABELS.prefix;

  const { successes, failures } = result.state;

  const counters =
    result.outcome === 'success' || result.outcome === 'failure'
      ? `${DEATH_SAVE_SUMMARY_LABELS.successes}${successes}/${DEATH_SAVES_TO_RESOLVE}${DEATH_SAVE_SUMMARY_LABELS.failures}${failures}/${DEATH_SAVES_TO_RESOLVE}${DEATH_SAVE_SUMMARY_LABELS.close}`
      : '';

  return `${name}${prefix}${DEATH_SAVE_OUTCOME_LABELS[result.outcome]}${counters}`;
}
