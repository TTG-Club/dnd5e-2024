/**
 * Правило каста у эффекта: что мешает носителю накладывать заклинания, пока
 * эффект на нём.
 *
 * Запрет «нельзя вовсе», «нельзя с вербальным компонентом», «нельзя действием
 * Магия», «нельзя школу» — флаги (`actionRestrictions.ts`): у них нет чисел.
 * Здесь — правила с числами:
 * - круг ячейки: «не может использовать ячейки 7-го круга и выше»
 *   (`maxSlotLevel: 6`), «…ниже 3-го» (`minSlotLevel: 3`);
 * - провал каста: шанс («Замедление»: 25 %, если у заклинания соматический
 *   компонент) или спасбросок заклинателя («Слово силы: Боль»: Телосложение,
 *   иначе заклинание рассеивается).
 *
 * Здесь только форма данных и её разбор: модуль не зависит от эффекта, поэтому
 * эффект ссылается на него без круга. Расчёт — в
 * {@link module:system/dnd/effectCastRule}.
 *
 * @module system/dnd/effectCastRuleTypes
 */

import type { AbilityType } from '@vtt/shared';

import { z } from 'zod';

import {
  MAX_SPELL_SLOT_LEVEL,
  MIN_SPELL_SLOT_LEVEL,
} from './spellSlotTable.js';

/** Компоненты заклинания, по которым правило отбирает касты */
export const CAST_RULE_COMPONENTS = ['verbal', 'somatic', 'material'] as const;

/** Компонент заклинания, по которому правило отбирает касты */
export type CastRuleComponent = (typeof CAST_RULE_COMPONENTS)[number];

/** Спасбросок заклинателя при попытке каста */
export interface CastRuleSave {
  /** Характеристика спасброска */
  ability: AbilityType;
  /** Сложность; 0 — Сл источника, проставляется при наложении */
  dc: number;
  /** Сл формулой по наложившему: «8 + @prof + @mod.cha» */
  dcFormula?: string;
}

/** Правило каста у эффекта */
export interface EffectCastRule {
  /**
   * Самый высокий круг ячейки, которую носитель может потратить: «не может
   * использовать ячейки 7-го круга и выше» — 6. Заговоры и заклинания без
   * ячеек (с зарядами) правило не трогает.
   */
  maxSlotLevel?: number;
  /** Самый низкий круг ячейки, которую носитель может потратить */
  minSlotLevel?: number;
  /** Шанс провала каста в процентах (1–100): «вероятность 25 %» */
  failChance?: number;
  /** Спасбросок заклинателя при попытке каста: провал — заклинание не удалось */
  failSave?: CastRuleSave;
  /**
   * Только заклинания с этим компонентом проверяют провал: «с соматическим
   * компонентом». Нет поля — любое заклинание.
   */
  failComponent?: CastRuleComponent;
  /**
   * Ячейка при провале тратится («заклинание проваливается» по общему
   * правилу). Нет поля — потрачено только действие («Слово силы: Боль»).
   */
  failLosesSlot?: true;
}

/** Самый большой шанс провала — наверняка */
export const MAX_CAST_FAIL_CHANCE = 100;

/** Самая длинная формула Сл правила каста */
const MAX_CAST_RULE_DC_FORMULA_LENGTH = 200;

/** Характеристики спасброска правила каста */
const CAST_RULE_SAVE_ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

/**
 * Пустое поле окна — «не задано», а не ноль.
 *
 * @param value - значение поля
 * @returns значение либо `undefined` у пустого
 */
function emptyToUndefined(value: unknown): unknown {
  if (value === '' || value === null) {
    return undefined;
  }

  return typeof value === 'string' && value.trim() !== ''
    ? Number(value)
    : value;
}

/** Zod-схема круга ячейки в правиле каста */
const CastRuleSlotLevelSchema = z.preprocess(
  emptyToUndefined,
  z
    .number()
    .int()
    .min(MIN_SPELL_SLOT_LEVEL)
    .max(MAX_SPELL_SLOT_LEVEL)
    .optional()
    .catch(undefined),
);

/** Zod-схема спасброска заклинателя при попытке каста */
const CastRuleSaveSchema = z.object({
  ability: z.enum(CAST_RULE_SAVE_ABILITIES),
  dc: z.preprocess(emptyToUndefined, z.number().int().min(0)),
  dcFormula: z
    .string()
    .trim()
    .min(1)
    .max(MAX_CAST_RULE_DC_FORMULA_LENGTH)
    .optional()
    .catch(undefined),
});

/**
 * Есть ли в правиле хоть что-то: пустое правило в данные не пишется.
 *
 * @param rule - правило каста
 * @returns `true`, если правило что-то задаёт
 */
export function hasCastRuleContent(rule: EffectCastRule): boolean {
  return (
    rule.maxSlotLevel !== undefined
    || rule.minSlotLevel !== undefined
    || rule.failChance !== undefined
    || rule.failSave !== undefined
  );
}

/**
 * Zod-схема правила каста. Негодное поле выбрасывается одно, пустое правило —
 * целиком: эффект со старым или испорченным правилом остаётся рабочим.
 */
export const EffectCastRuleSchema = z
  .object({
    maxSlotLevel: CastRuleSlotLevelSchema,
    minSlotLevel: CastRuleSlotLevelSchema,
    failChance: z.preprocess(
      emptyToUndefined,
      z
        .number()
        .int()
        .min(1)
        .max(MAX_CAST_FAIL_CHANCE)
        .optional()
        .catch(undefined),
    ),
    failSave: CastRuleSaveSchema.optional().catch(undefined),
    failComponent: z.enum(CAST_RULE_COMPONENTS).optional().catch(undefined),
    failLosesSlot: z.literal(true).optional().catch(undefined),
  })
  .transform((rule): EffectCastRule | undefined => {
    const fails = rule.failChance !== undefined || rule.failSave !== undefined;

    const cleaned: EffectCastRule = {
      ...(rule.maxSlotLevel === undefined
        ? {}
        : { maxSlotLevel: rule.maxSlotLevel }),
      ...(rule.minSlotLevel === undefined
        ? {}
        : { minSlotLevel: rule.minSlotLevel }),
      ...(rule.failChance === undefined ? {} : { failChance: rule.failChance }),
      ...(rule.failSave ? { failSave: rule.failSave } : {}),
      // Отбор по компоненту и судьба ячейки без самого провала ничего не значат
      ...(fails && rule.failComponent
        ? { failComponent: rule.failComponent }
        : {}),
      ...(fails && rule.failLosesSlot ? { failLosesSlot: true } : {}),
    };

    return hasCastRuleContent(cleaned) ? cleaned : undefined;
  })
  .optional()
  .catch(undefined);
