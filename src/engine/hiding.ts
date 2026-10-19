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

import { z } from 'zod';

import { HIDDEN_CONDITION_KEY } from './conditionKeys.js';
import { buildConditionActiveEffect } from './conditionTemplates.js';
import { SYSTEM_ID } from './systemId.js';

/** Сл проверки Ловкости (Скрытность) при засаде */
export const HIDE_CHECK_DC = 15;

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

/** Вид дополнения чата об удачной засаде: под ним «Найти» и «Шум» */
export const HIDE_FOLLOW_UP_KIND = `${SYSTEM_ID}:hide`;

/**
 * Чем носитель прячется: бонусным действием, если умение это позволяет и
 * бонусное сейчас не под запретом, иначе действием.
 *
 * Спрашивать не о чем: имея «Хитрое действие», бонусным прячутся всегда, а
 * отдельного учёта «бонусное уже потрачено» вне ограничивающих эффектов у
 * системы нет — его заменяет запрет траты (`resolveActionCostBlock`).
 *
 * @param flags - действующие флаги носителя
 * @param bonusBlocked - бонусное действие сейчас под запретом
 * @returns цена засады
 */
export function resolveHideCost(
  flags: ReadonlySet<string>,
  bonusBlocked: boolean,
): EffectActionCost {
  return flags.has(HIDE_AS_BONUS_FLAG) && !bonusBlocked ? 'bonus' : 'action';
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

/** Данные кнопок под сообщением о засаде: кто спрятался и с какой Сл */
const hideFollowUpPayloadSchema = z.object({
  /** Спрятавшаяся сущность */
  entityId: z.string().min(1),
  /** Эффект засады: снимают ровно его, а не новую засаду той же сущности */
  effectId: z.string().min(1),
  /** Сл поиска */
  searchDc: z.number().int().min(0),
});

/** Данные кнопок под сообщением о засаде */
export type HideFollowUpPayload = z.infer<typeof hideFollowUpPayloadSchema>;

/**
 * Записывает данные кнопок под сообщением о засаде.
 *
 * @param payload - кто спрятался, эффект и Сл
 * @returns строка для дополнения чата
 */
export function serializeHideFollowUp(payload: HideFollowUpPayload): string {
  return JSON.stringify(payload);
}

/**
 * Читает данные кнопок под сообщением о засаде.
 *
 * @param raw - строка дополнения чата
 * @returns данные либо `null`, если строка чужая или битая
 */
export function parseHideFollowUp(
  raw: string | undefined,
): HideFollowUpPayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = hideFollowUpPayloadSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
