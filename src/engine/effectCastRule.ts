/**
 * Правило каста эффекта в деле: лимит круга ячейки и провал каста.
 *
 * Правило лежит на эффекте носителя (`castRule`) и читается там же, где
 * остальные запреты колдовства: лимит круга — в `actionRestrictions.ts`
 * (кнопка гаснет с причиной, выбор круга сужается), провал — на клиенте в
 * момент, когда каст уже точно идёт (`composables/castFailure.ts`): действие
 * потрачено, заклинание не удалось. Аура со своим правилом («Зона
 * преследования»: спасбросок у всякого, кто колдует рядом) читается так же —
 * её эффект приходит списком аур на носителе.
 *
 * @module system/dnd/effectCastRule
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDSceneEntity, Spell } from './dndEntities.js';
import type {
  CastRuleComponent,
  CastRuleSave,
  EffectCastRule,
} from './effectCastRuleTypes.js';

import { ABILITY_GENITIVE_LABELS } from './consts.js';
import { MAX_CAST_FAIL_CHANCE } from './effectCastRuleTypes.js';
import { collectActiveEffects } from './effectPipeline.js';
import { CANTRIP_SPELL_LEVEL } from './spellTypes.js';

/** Лимит круга ячейки и эффект, который его дал */
export interface SlotLevelBound {
  /** Круг */
  level: number;
  /** Имя эффекта */
  sourceName: string;
}

/** Лимит круга ячейки носителя: самый строгий с каждой стороны */
export interface SlotLevelLimit {
  /** Самый высокий доступный круг */
  max?: SlotLevelBound;
  /** Самый низкий доступный круг */
  min?: SlotLevelBound;
}

/**
 * Лимит круга ячейки по правилам каста эффектов: из нескольких правил
 * действует самое строгое.
 *
 * @param effects - действующие эффекты носителя и ауры на нём
 * @returns лимит; пустой — ограничений нет
 */
export function resolveSlotLevelLimit(
  effects: readonly ActiveEffect[],
): SlotLevelLimit {
  const limit: SlotLevelLimit = {};

  for (const effect of effects) {
    const { maxSlotLevel, minSlotLevel } = effect.castRule ?? {};

    if (
      maxSlotLevel !== undefined
      && (limit.max === undefined || maxSlotLevel < limit.max.level)
    ) {
      limit.max = { level: maxSlotLevel, sourceName: effect.name };
    }

    if (
      minSlotLevel !== undefined
      && (limit.min === undefined || minSlotLevel > limit.min.level)
    ) {
      limit.min = { level: minSlotLevel, sourceName: effect.name };
    }
  }

  return limit;
}

/** Что лимит круга читает у заклинания */
export type SlotSpell = Partial<Pick<Spell, 'level' | 'uses'>>;

/**
 * Тратит ли заклинание ячейку: заговоры и заклинания с зарядами (врождённые)
 * — нет.
 *
 * @param spell - заклинание
 * @returns `true`, если каст идёт ячейкой
 */
export function spellUsesSlot(spell: SlotSpell): boolean {
  return (
    (spell.level ?? CANTRIP_SPELL_LEVEL) > CANTRIP_SPELL_LEVEL && !spell.uses
  );
}

/**
 * Круги, которыми заклинание можно наложить под лимитом круга ячейки.
 * Заговорам и заклинаниям с зарядами лимит не мешает.
 *
 * @param bounds - лимит: самый высокий и самый низкий доступный круг
 * @param bounds.max - самый высокий доступный круг
 * @param bounds.min - самый низкий доступный круг
 * @param spell - заклинание
 * @param levels - круги, которыми наложить можно по ячейкам
 * @returns разрешённые круги
 */
export function filterCastLevels(
  bounds: { max?: number; min?: number },
  spell: SlotSpell,
  levels: readonly number[],
): number[] {
  const { max, min } = bounds;

  if (!spellUsesSlot(spell) || (max === undefined && min === undefined)) {
    return [...levels];
  }

  return levels.filter(
    (level) =>
      (max === undefined || level <= max)
      && (min === undefined || level >= min),
  );
}

/**
 * Круги, которыми заклинатель может наложить заклинание под лимитом круга
 * ячейки своих эффектов, — для путей каста без собранных запретов.
 *
 * @param entity - заклинатель
 * @param spell - заклинание
 * @param levels - круги, которыми наложить можно по ячейкам
 * @param ambientEffects - ауры чужих токенов, накрывающие заклинателя
 * @returns разрешённые круги
 */
export function limitEntityCastLevels(
  entity: DnDSceneEntity,
  spell: SlotSpell,
  levels: readonly number[],
  ambientEffects: readonly ActiveEffect[] = [],
): number[] {
  if (!spellUsesSlot(spell)) {
    return [...levels];
  }

  const { max, min } = resolveSlotLevelLimit([
    ...collectActiveEffects(entity),
    ...ambientEffects,
  ]);

  return filterCastLevels(
    {
      ...(max ? { max: max.level } : {}),
      ...(min ? { min: min.level } : {}),
    },
    spell,
    levels,
  );
}

/** Проверка провала каста: правило и эффект, который его дал */
export interface CastFailureCheck {
  /** Имя эффекта */
  sourceName: string;
  /** Шанс провала в процентах */
  chance?: number;
  /** Спасбросок заклинателя */
  save?: CastRuleSave;
  /** Тратится ли при провале ячейка */
  losesSlot: boolean;
}

/** Что проверка провала читает у заклинания */
export type CastFailureSpell = Partial<Pick<Spell, 'components'>>;

/**
 * Есть ли у заклинания компонент.
 *
 * @param spell - заклинание
 * @param component - компонент
 * @returns `true`, если компонент нужен
 */
function spellHasComponent(
  spell: CastFailureSpell,
  component: CastRuleComponent,
): boolean {
  return spell.components?.[component] === true;
}

/**
 * Проверки провала, которые заклинание должно пройти, — из правил каста
 * эффектов носителя и аур на нём. Правило с отбором по компоненту касается
 * только заклинаний с этим компонентом.
 *
 * @param entity - заклинатель
 * @param spell - заклинание
 * @param ambientEffects - ауры чужих токенов, накрывающие заклинателя
 * @returns проверки по порядку эффектов; пусто — каст идёт как обычно
 */
export function listCastFailureChecks(
  entity: DnDSceneEntity,
  spell: CastFailureSpell,
  ambientEffects: readonly ActiveEffect[] = [],
): CastFailureCheck[] {
  return [...collectActiveEffects(entity), ...ambientEffects].flatMap(
    (effect) => {
      const rule = effect.castRule;

      if (
        !rule
        || (rule.failChance === undefined && rule.failSave === undefined)
        || (rule.failComponent !== undefined
          && !spellHasComponent(spell, rule.failComponent))
      ) {
        return [];
      }

      return [
        {
          sourceName: effect.name,
          ...(rule.failChance === undefined ? {} : { chance: rule.failChance }),
          ...(rule.failSave ? { save: rule.failSave } : {}),
          losesSlot: rule.failLosesSlot === true,
        },
      ];
    },
  );
}

/** Исход броска шанса провала */
export interface CastFailChanceRoll {
  /** Что выпало на к100 */
  roll: number;
  /** Провал: выпало не больше шанса */
  failed: boolean;
}

/**
 * Бросает шанс провала каста: к100, провал — не больше шанса.
 *
 * @param chance - шанс провала в процентах
 * @param random - источник случайности
 * @returns бросок и исход
 */
export function rollCastFailChance(
  chance: number,
  random: () => number = Math.random,
): CastFailChanceRoll {
  const roll = Math.floor(random() * MAX_CAST_FAIL_CHANCE) + 1;

  return { roll, failed: roll <= chance };
}

/** Подписи компонентов в описании правила */
const CAST_RULE_COMPONENT_LABELS: Record<CastRuleComponent, string> = {
  verbal: 'вербальным',
  somatic: 'соматическим',
  material: 'материальным',
};

/** Слова описания правила каста */
const CAST_RULE_LABELS = {
  maxSlot: 'ячейки не выше круга: ',
  minSlot: 'ячейки не ниже круга: ',
  failPrefix: 'каст',
  componentPrefix: ' с ',
  componentSuffix: ' компонентом',
  chanceMiddle: ' проваливается с шансом ',
  percent: ' %',
  savePrefix: ' требует спасброска ',
  saveDc: ' Сл ',
  saveSourceDc: ' (Сл источника)',
  both: ' и',
  losesSlot: '; ячейка при провале тратится',
  keepsSlot: '; ячейка при провале не тратится',
} as const;

/**
 * Правило каста словами — строки для карточки эффекта.
 *
 * @param rule - правило каста
 * @returns строки описания; пусто у пустого правила
 */
export function describeCastRule(rule: EffectCastRule): string[] {
  const lines: string[] = [];

  if (rule.maxSlotLevel !== undefined) {
    lines.push(`${CAST_RULE_LABELS.maxSlot}${rule.maxSlotLevel}`);
  }

  if (rule.minSlotLevel !== undefined) {
    lines.push(`${CAST_RULE_LABELS.minSlot}${rule.minSlotLevel}`);
  }

  if (rule.failChance === undefined && !rule.failSave) {
    return lines;
  }

  const component = rule.failComponent
    ? `${CAST_RULE_LABELS.componentPrefix}${CAST_RULE_COMPONENT_LABELS[rule.failComponent]}${CAST_RULE_LABELS.componentSuffix}`
    : '';

  const chance =
    rule.failChance === undefined
      ? ''
      : `${CAST_RULE_LABELS.chanceMiddle}${rule.failChance}${CAST_RULE_LABELS.percent}`;

  const save = rule.failSave
    ? `${chance ? CAST_RULE_LABELS.both : ''}${CAST_RULE_LABELS.savePrefix}${ABILITY_GENITIVE_LABELS[rule.failSave.ability]}${
        rule.failSave.dc > 0
          ? `${CAST_RULE_LABELS.saveDc}${rule.failSave.dc}`
          : CAST_RULE_LABELS.saveSourceDc
      }`
    : '';

  lines.push(
    `${CAST_RULE_LABELS.failPrefix}${component}${chance}${save}${
      rule.failLosesSlot
        ? CAST_RULE_LABELS.losesSlot
        : CAST_RULE_LABELS.keepsSlot
    }`,
  );

  return lines;
}

/** Слова сообщения о провале каста */
const CAST_FAILURE_MESSAGE_LABELS = {
  middle: ': заклинание «',
  failed: '» не удалось — ',
  chancePrefix: ' (к100: ',
  chanceMiddle: ' при шансе провала ',
  chanceSuffix: ' %)',
  savePrefix: ' (спасбросок ',
  saveMiddle: ' против Сл ',
  saveSuffix: ')',
  losesSlot: '. Действие и ячейка потрачены.',
  keepsSlot: '. Действие потрачено, ячейка — нет.',
} as const;

/** Чем провалился каст */
export interface CastFailureOutcome {
  /** Проверка, которую каст не прошёл */
  check: CastFailureCheck;
  /** Что выпало на к100 — у провала шансом */
  roll?: number;
  /** Итог спасброска — у провала спасброском */
  saveTotal?: number;
}

/**
 * Строка чата о проваленном касте.
 *
 * @param casterName - имя заклинателя
 * @param spellName - название заклинания
 * @param outcome - чем провалился каст
 * @param slotLost - потрачена ли ячейка
 * @returns строка для чата
 */
export function formatCastFailureMessage(
  casterName: string,
  spellName: string,
  outcome: CastFailureOutcome,
  slotLost: boolean,
): string {
  const { check, roll, saveTotal } = outcome;

  const chanceDetail =
    roll === undefined
      ? ''
      : `${CAST_FAILURE_MESSAGE_LABELS.chancePrefix}${roll}${CAST_FAILURE_MESSAGE_LABELS.chanceMiddle}${check.chance ?? 0}${CAST_FAILURE_MESSAGE_LABELS.chanceSuffix}`;

  const saveDetail =
    saveTotal === undefined || !check.save
      ? ''
      : `${CAST_FAILURE_MESSAGE_LABELS.savePrefix}${saveTotal}${CAST_FAILURE_MESSAGE_LABELS.saveMiddle}${check.save.dc}${CAST_FAILURE_MESSAGE_LABELS.saveSuffix}`;

  return `${casterName}${CAST_FAILURE_MESSAGE_LABELS.middle}${spellName}${CAST_FAILURE_MESSAGE_LABELS.failed}${check.sourceName}${chanceDetail}${saveDetail}${
    slotLost
      ? CAST_FAILURE_MESSAGE_LABELS.losesSlot
      : CAST_FAILURE_MESSAGE_LABELS.keepsSlot
  }`;
}
