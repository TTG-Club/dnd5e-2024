/**
 * Засада и поиск (правила 2024, глоссарий «Засада» / Hide и «Поиск» / Search).
 *
 * «Засада» — действие: проверка Ловкости (Скрытность) Сл 15. Успех — состояние
 * «В засаде» (`HIDDEN_CONDITION_KEY`), и итог проверки становится Сл поиска:
 * враг ищет проверкой Мудрости (Внимательность) против неё. Засада кончается
 * своей атакой (`consumeOn` состояния), заклинанием с вербальным компонентом
 * (срабатывание `spellCast` состояния), звуком громче шёпота («шум» — кнопка
 * у ведущего и владельца) и находкой.
 *
 * Укрытие и линию зрения система не проверяет: укрытий у неё нет, решает
 * ведущий — подсказка уходит в чат вместе с засадой.
 *
 * Здесь — чистые правила: цена, исход проверок, сборка состояния, данные
 * кнопок под сообщением. Окна, чат и запись в мир — на клиенте
 * (`hideAction.ts`).
 *
 * @module system/dnd/hiding
 */

import type { SkillType } from '@vtt/shared';

import type { ActiveEffect, EffectFlagKey } from './activeEffectTypes.js';
import type { EffectActionCost } from './effectTriggerTypes.js';

import { HIDDEN_CONDITION_KEY } from './conditionKeys.js';
import { buildConditionActiveEffect } from './conditionTemplates.js';

/** Сл проверки Ловкости (Скрытность) при засаде */
export const HIDE_CHECK_DC = 15;

/** Чем можно спрятаться: действием либо бонусным действием */
export type HideCost = Extract<EffectActionCost, 'bonus' | 'action'>;

/**
 * Сл поиска засады: записанная в состоянии «В засаде», иначе Сл самой засады.
 *
 * @param hidden - состояние «В засаде»
 * @param hidden.searchDc - записанная Сл поиска
 * @returns Сл поиска
 */
export function resolveHideSearchDc(hidden: { searchDc?: number }): number {
  return hidden.searchDc ?? HIDE_CHECK_DC;
}

/** Навык засады */
export const HIDE_SKILL: SkillType = 'stealth';

/** Навык поиска */
export const SEARCH_SKILL: SkillType = 'perception';

/**
 * Флаг «засада бонусным действием»: «Хитрое действие» плута, «Проворный
 * побег» гоблинов. Отметка в данных умения, а не правило в коде: так одно
 * правило работает у класса, у существа и у предмета.
 */
export const HIDE_AS_BONUS_FLAG: EffectFlagKey = 'hide.bonusAction';

/**
 * Чем носитель может спрятаться: действием всегда, бонусным действием — если
 * умение это позволяет («Хитрое действие») и бонусное сейчас не под запретом.
 * Бонусное — первым: им прячутся чаще, но выбор за игроком — бонусное
 * действие может быть нужно на другое.
 *
 * @param flags - действующие флаги носителя
 * @param bonusBlocked - бонусное действие сейчас под запретом
 * @returns возможные цены засады
 */
export function listHideCosts(
  flags: ReadonlySet<string>,
  bonusBlocked: boolean,
): HideCost[] {
  return flags.has(HIDE_AS_BONUS_FLAG) && !bonusBlocked
    ? ['bonus', 'action']
    : ['action'];
}

/**
 * Удалась ли засада.
 *
 * @param total - итог проверки Ловкости (Скрытность)
 * @returns `true`, если итог не меньше Сл 15
 */
export function isHideSuccess(total: number): boolean {
  return total >= HIDE_CHECK_DC;
}

/**
 * Нашёл ли ищущий спрятавшегося.
 *
 * @param total - итог проверки Мудрости (Внимательность) ищущего
 * @param searchDc - Сл поиска засады
 * @returns `true`, если итог не меньше Сл
 */
export function isSearchSuccess(total: number, searchDc: number): boolean {
  return total >= searchDc;
}

/**
 * Засады, которые находит один бросок поиска: каждая, чья Сл не выше итога.
 *
 * Поиск — одна проверка на все засады: правила сравнивают её итог со Сл каждого
 * спрятавшегося, а цели ищущий не выбирает — он не знает, где прячутся. Поэтому
 * снимаются все перебитые засады, а не одна выбранная.
 *
 * @param total - итог проверки Мудрости (Внимательность) ищущего
 * @param hides - засады, которые ищущий может заметить
 * @returns найденные засады
 */
export function pickFoundHides<Hide extends { searchDc: number }>(
  total: number,
  hides: readonly Hide[],
): Hide[] {
  return hides.filter((hide) => isSearchSuccess(total, hide.searchDc));
}

/**
 * Состояние «В засаде» с запомненной Сл поиска.
 *
 * @param searchDc - итог проверки Скрытности
 * @returns эффект состояния либо `null`, если состояние в мире удалено
 */
export function buildHiddenEffect(searchDc: number): ActiveEffect | null {
  const effect = buildConditionActiveEffect(HIDDEN_CONDITION_KEY);

  return effect ? { ...effect, searchDc } : null;
}

/**
 * Состояние «В засаде» на сущности — включённое, на ней самой.
 *
 * @param entity - сущность
 * @param entity.activeEffects - её эффекты
 * @returns эффект засады либо `undefined`
 */
export function findHiddenEffect(entity: {
  activeEffects?: readonly ActiveEffect[];
}): ActiveEffect | undefined {
  return (entity.activeEffects ?? []).find(
    (effect) =>
      !effect.disabled
      && effect.conditionKey === HIDDEN_CONDITION_KEY
      && !(effect.aura && !effect.aura.applyToSelf),
  );
}

/**
 * Эффекты без состояния «В засаде»: засада снята (нашли, шум).
 *
 * @param effects - эффекты сущности
 * @returns новый список без засады
 */
export function withoutHiddenEffects(
  effects: readonly ActiveEffect[],
): ActiveEffect[] {
  return effects.filter(
    (effect) => effect.conditionKey !== HIDDEN_CONDITION_KEY,
  );
}

/**
 * Вербальный ли каст: у заклинания есть вербальный компонент, и заклинатель
 * его не опускает (статблок существа колдует «без вербальных компонентов»).
 *
 * @param spell - заклинание
 * @param spell.components - компоненты заклинания
 * @param spell.components.verbal - есть ли вербальный
 * @param verbalIgnored - заклинатель опускает вербальный компонент
 * @returns `true`, если каст слышно
 */
export function isVerbalSpellCast(
  spell: { components?: { verbal?: boolean } },
  verbalIgnored = false,
): boolean {
  return spell.components?.verbal === true && !verbalIgnored;
}

/** Засада на сцене: кто спрятался, каким эффектом и с какой Сл поиска */
export interface HideEntry {
  /** Спрятавшаяся сущность */
  entityId: string;
  /** Эффект засады: снимают ровно его, а не новую засаду той же сущности */
  effectId: string;
  /** Сл поиска */
  searchDc: number;
}
