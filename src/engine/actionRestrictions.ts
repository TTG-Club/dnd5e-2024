/**
 * Ограничения действий носителя: что он сейчас не может совершить.
 *
 * Модель одна на все такие правила: флаг эффекта запрещает ВИД траты —
 * действие, бонусное действие, реакцию. Срок — обычный срок эффекта:
 * «Электрошок» запрещает реакции до начала следующего хода цели, «Смятение» —
 * пока действует. Флаги:
 * - `actions.noReaction` — нет реакций (Электрошок, Замедление, дыхание
 *   медного дракона);
 * - `actions.noBonusAction` — нет бонусных действий;
 * - `incapacitated` (Недееспособный и всё, что его включает) — нет ни
 *   действий, ни бонусных действий, ни реакций;
 * - `actions.oneActionOrBonus` — за ход действие ИЛИ бонусное действие
 *   («Замедление»): трата хода пишется в счётчики хода носителя
 *   (`system.effectUsage`, период «ход» — их обнуляет конец хода), и после
 *   одной траты вторая недоступна. Пишется только в бою и только у носителя с
 *   этим флагом (`recordActionSpend`).
 *
 * Колдовство — те же ограничения, только по заклинанию, а не по трате:
 * - `spellcasting.blocked` — нельзя накладывать заклинания (Ярость,
 *   Газообразная форма, Силовая клетка изнутри);
 * - `spellcasting.noVerbal` — нельзя заклинания с вербальным компонентом
 *   (Тишина, кляп);
 * - `concentration.blocked` — нельзя концентрироваться: заклинания с
 *   концентрацией не накладываются, а текущая концентрация прерывается, как
 *   только запрет начал действовать (`settleCombatState`).
 *
 * Где читается: срабатывание с ценой «Реакция» или «Бонусное действие» не
 * выполняется (`admitTrigger`), заклинание с таким временем накладывания,
 * реакция существа и «вырваться» с такой ценой не начинаются, кнопки гаснут с
 * причиной. Провоцированной атаки как отдельного действия у системы нет —
 * это атака реакцией, и её запрет — тот же флаг.
 *
 * @module system/dnd/actionRestrictions
 */

import type { SpellCastingTimeUnit } from '@vtt/shared';

import type { ActiveEffect, EffectFlagKey } from './activeEffectTypes.js';
import type { CreatureAction } from './creatureTypes.js';
import type { DnDCreature, DnDSceneEntity, Spell } from './dndEntities.js';
import type { EffectActionCost } from './effectTriggerTypes.js';
import type { EffectTriggerUsageLedger } from './effectTriggerUsage.js';

import { EFFECT_FLAG_LABELS } from './activeEffectTypes.js';
import { listConcentrationCastIds } from './concentration.js';
import { INCAPACITATED_CONDITION_KEY } from './conditionKeys.js';
import { collectActiveEffects, resolveActorStats } from './effectPipeline.js';
import { readTriggerUsage } from './effectTriggerUsage.js';

/** Флаги ограничения действий */
export const ACTION_RESTRICTION_FLAGS = {
  /** Нет реакций */
  noReaction: 'actions.noReaction',
  /** Нет бонусных действий */
  noBonusAction: 'actions.noBonusAction',
  /** За ход — действие или бонусное действие, не оба */
  oneActionOrBonus: 'actions.oneActionOrBonus',
  /** Нельзя накладывать заклинания */
  noSpellcasting: 'spellcasting.blocked',
  /** Нельзя заклинания с вербальным компонентом */
  noVerbal: 'spellcasting.noVerbal',
  /** Нельзя концентрироваться */
  noConcentration: 'concentration.blocked',
} as const satisfies Record<string, EffectFlagKey>;

/** Запрет колдовства: что запрещено и чем */
type SpellcastingRestriction = 'all' | 'verbal' | 'concentration';

/** Флаг каждого запрета колдовства */
const SPELLCASTING_RESTRICTION_FLAGS: Record<
  SpellcastingRestriction,
  EffectFlagKey
> = {
  all: ACTION_RESTRICTION_FLAGS.noSpellcasting,
  verbal: ACTION_RESTRICTION_FLAGS.noVerbal,
  concentration: ACTION_RESTRICTION_FLAGS.noConcentration,
};

/** Начало причины запрета колдовства */
const SPELLCASTING_RESTRICTION_PREFIXES: Record<
  SpellcastingRestriction,
  string
> = {
  all: 'Заклинания недоступны',
  verbal: 'Заклинание с вербальным компонентом недоступно',
  concentration: 'Концентрация недоступна',
};

/** Запреты колдовства по порядку: общий главнее частных */
const SPELLCASTING_RESTRICTIONS: readonly SpellcastingRestriction[] = [
  'all',
  'verbal',
  'concentration',
];

/** Трата, которую ограничение может запретить */
export type RestrictedActionCost = Extract<
  EffectActionCost,
  'action' | 'bonus' | 'reaction'
>;

/** Траты, которые ограничение может запретить, — по порядку */
const RESTRICTED_ACTION_COSTS: readonly RestrictedActionCost[] = [
  'action',
  'bonus',
  'reaction',
];

/** Какие траты запрещает каждый флаг */
const BLOCKED_COSTS_BY_FLAG: ReadonlyMap<
  EffectFlagKey,
  readonly RestrictedActionCost[]
> = new Map<EffectFlagKey, readonly RestrictedActionCost[]>([
  [ACTION_RESTRICTION_FLAGS.noReaction, ['reaction']],
  [ACTION_RESTRICTION_FLAGS.noBonusAction, ['bonus']],
  [INCAPACITATED_CONDITION_KEY, ['action', 'bonus', 'reaction']],
]);

/** Начало причины запрета по трате: «Реакция недоступна» */
const RESTRICTED_COST_PREFIXES: Record<RestrictedActionCost, string> = {
  action: 'Действие недоступно',
  bonus: 'Бонусное действие недоступно',
  reaction: 'Реакция недоступна',
};

/**
 * Можно ли ограничением запретить эту трату: перемещение и «без затрат»
 * ограничения действий не касаются.
 *
 * @param cost - трата
 * @returns `true` для действия, бонусного действия и реакции
 */
export function isRestrictedActionCost(
  cost: EffectActionCost | undefined,
): cost is RestrictedActionCost {
  return cost === 'action' || cost === 'bonus' || cost === 'reaction';
}

/** Почему трата запрещена */
export interface ActionCostBlock {
  /** Что запрещено */
  cost: RestrictedActionCost;
  /** Что запрещает: имя эффекта либо подпись флага */
  sourceName: string;
}

/**
 * Флаг, который запрещает трату, — из действующих флагов носителя.
 *
 * @param flags - действующие флаги
 * @param cost - трата
 * @returns флаг либо `undefined`
 */
function findBlockingFlag(
  flags: ReadonlySet<string>,
  cost: RestrictedActionCost,
): EffectFlagKey | undefined {
  for (const [flag, costs] of BLOCKED_COSTS_BY_FLAG) {
    if (costs.includes(cost) && flags.has(flag)) {
      return flag;
    }
  }

  return undefined;
}

/** Трата хода, которую считает «действие или бонусное» */
type TurnSpendCost = Extract<RestrictedActionCost, 'action' | 'bonus'>;

/** Ключи счётчиков трат хода в общих счётчиках носителя */
const TURN_SPEND_KEYS: Record<TurnSpendCost, string> = {
  action: 'turnSpend|action',
  bonus: 'turnSpend|bonus',
};

/** Какая трата запрещает какую: действие — бонусное, бонусное — действие */
const OTHER_TURN_SPEND: Record<TurnSpendCost, TurnSpendCost> = {
  action: 'bonus',
  bonus: 'action',
};

/**
 * Считается ли трата в «действие или бонусное».
 *
 * @param cost - трата
 * @returns `true` для действия и бонусного действия
 */
function isTurnSpendCost(cost: RestrictedActionCost): cost is TurnSpendCost {
  return cost === 'action' || cost === 'bonus';
}

/**
 * Флаг «действие или бонусное», если он запрещает трату: в этот ход уже была
 * другая из двух.
 *
 * @param entity - носитель
 * @param flags - действующие флаги
 * @param cost - трата
 * @returns флаг либо `undefined`
 */
function findTurnSpendBlock(
  entity: DnDSceneEntity,
  flags: ReadonlySet<string>,
  cost: RestrictedActionCost,
): EffectFlagKey | undefined {
  const flag = ACTION_RESTRICTION_FLAGS.oneActionOrBonus;

  if (!isTurnSpendCost(cost) || !flags.has(flag)) {
    return undefined;
  }

  const spent =
    readTriggerUsage(entity)[TURN_SPEND_KEYS[OTHER_TURN_SPEND[cost]]];

  return spent ? flag : undefined;
}

/**
 * Счётчики носителя после траты хода — для записи боевым каналом. Пишется
 * только там, где трату считают: у носителя с флагом «действие или
 * бонусное» и только действие или бонусное действие.
 *
 * @param entity - носитель
 * @param cost - трата
 * @returns новые счётчики либо `undefined`, если записывать нечего
 */
export function recordActionSpend(
  entity: DnDSceneEntity,
  cost: EffectActionCost | undefined,
): EffectTriggerUsageLedger | undefined {
  if (
    !isRestrictedActionCost(cost)
    || !isTurnSpendCost(cost)
    || !resolveActorStats(entity).activeFlags.has(
      ACTION_RESTRICTION_FLAGS.oneActionOrBonus,
    )
  ) {
    return undefined;
  }

  const ledger = readTriggerUsage(entity);
  const key = TURN_SPEND_KEYS[cost];

  return {
    ...ledger,
    [key]: { used: (ledger[key]?.used ?? 0) + 1, per: 'turn' },
  };
}

/**
 * Имя эффекта, давшего флаг, — для причины на кнопке. Флаг из ауры чужого
 * токена в своих эффектах не найдётся — тогда причина называется флагом.
 *
 * @param effects - эффекты носителя
 * @param flag - флаг
 * @returns имя эффекта либо подпись флага
 */
function nameFlagSource(
  effects: readonly ActiveEffect[],
  flag: EffectFlagKey,
): string {
  const source = effects.find((effect) => effect.flags.includes(flag));

  if (source) {
    return source.name;
  }

  return EFFECT_FLAG_LABELS[flag];
}

/**
 * Запрещена ли носителю трата прямо сейчас, и чем.
 *
 * @param entity - носитель
 * @param cost - трата
 * @param ambientEffects - ауры чужих токенов, накрывающие носителя
 * @returns причина запрета либо `null`, если трата доступна
 */
export function resolveActionCostBlock(
  entity: DnDSceneEntity,
  cost: EffectActionCost | undefined,
  ambientEffects: readonly ActiveEffect[] = [],
): ActionCostBlock | null {
  if (!isRestrictedActionCost(cost)) {
    return null;
  }

  const flags = resolveActorStats(entity, ambientEffects).activeFlags;

  const flag =
    findBlockingFlag(flags, cost) ?? findTurnSpendBlock(entity, flags, cost);

  if (!flag) {
    return null;
  }

  return {
    cost,
    sourceName: nameFlagSource(
      [...collectActiveEffects(entity), ...ambientEffects],
      flag,
    ),
  };
}

/**
 * Причина запрета словами — для подсказки на погасшей кнопке и строки чата:
 * «Реакция недоступна: Электрошок».
 *
 * @param block - причина запрета
 * @returns текст причины
 */
export function formatActionCostBlock(block: ActionCostBlock): string {
  return `${RESTRICTED_COST_PREFIXES[block.cost]}: ${block.sourceName}`;
}

/** Чем платят за накладывание заклинания: минуты и часы — не трата хода */
const CASTING_TIME_COSTS: Partial<
  Record<SpellCastingTimeUnit, RestrictedActionCost>
> = {
  'action': 'action',
  'bonus-action': 'bonus',
  'bonus-action-after-hit': 'bonus',
  'reaction': 'reaction',
};

/**
 * Трата хода на накладывание заклинания по его времени накладывания.
 *
 * @param spell - заклинание
 * @returns трата либо `undefined` (минуты, часы, время не задано)
 */
export function resolveSpellCastCost(
  spell: SpellCastBlockSource,
): RestrictedActionCost | undefined {
  return spell.castingTimeUnit
    ? CASTING_TIME_COSTS[spell.castingTimeUnit]
    : undefined;
}

/**
 * Запреты носителя разом — для списка заклинаний или действий, где кнопок
 * много, а статы листа считать на каждую незачем: одна сборка на список.
 */
export interface EntityActionBlocks {
  /** Причина запрета по трате хода */
  byCost: Partial<Record<RestrictedActionCost, string>>;
  /** Причина запрета колдовства по виду запрета */
  spellcasting: Partial<Record<SpellcastingRestriction, string>>;
}

/**
 * Собирает запреты носителя одним расчётом статов.
 *
 * @param entity - носитель
 * @param ambientEffects - ауры чужих токенов, накрывающие носителя
 * @returns запреты по тратам
 */
export function resolveEntityActionBlocks(
  entity: DnDSceneEntity,
  ambientEffects: readonly ActiveEffect[] = [],
): EntityActionBlocks {
  const flags = resolveActorStats(entity, ambientEffects).activeFlags;
  const byCost: Partial<Record<RestrictedActionCost, string>> = {};
  const spellcasting: Partial<Record<SpellcastingRestriction, string>> = {};

  // Эффекты для имени причины собираются, только если запрет есть
  let effects: readonly ActiveEffect[] | null = null;

  /**
   * Имя того, что запрещает, — по флагу.
   *
   * @param flag - флаг запрета
   * @returns имя эффекта либо подпись флага
   */
  const sourceOf = (flag: EffectFlagKey): string => {
    effects ??= [...collectActiveEffects(entity), ...ambientEffects];

    return nameFlagSource(effects, flag);
  };

  for (const cost of RESTRICTED_ACTION_COSTS) {
    const flag =
      findBlockingFlag(flags, cost) ?? findTurnSpendBlock(entity, flags, cost);

    if (flag) {
      byCost[cost] = formatActionCostBlock({
        cost,
        sourceName: sourceOf(flag),
      });
    }
  }

  for (const restriction of SPELLCASTING_RESTRICTIONS) {
    const flag = SPELLCASTING_RESTRICTION_FLAGS[restriction];

    if (flags.has(flag)) {
      spellcasting[restriction] =
        `${SPELLCASTING_RESTRICTION_PREFIXES[restriction]}: ${sourceOf(flag)}`;
    }
  }

  return { byCost, spellcasting };
}

/**
 * Почему заклинание сейчас не наложить — по собранным запретам носителя.
 *
 * @param blocks - запреты носителя
 * @param spell - заклинание
 * @returns причина словами либо `null`, если каст доступен
 */
export function findSpellCastBlock(
  blocks: EntityActionBlocks,
  spell: SpellCastBlockSource,
): string | null {
  const { spellcasting } = blocks;

  const byRestriction =
    spellcasting.all
    ?? (spell.components?.verbal ? spellcasting.verbal : undefined)
    ?? (spell.concentration ? spellcasting.concentration : undefined);

  if (byRestriction) {
    return byRestriction;
  }

  const cost = resolveSpellCastCost(spell);

  return (cost && blocks.byCost[cost]) || null;
}

/** Что заклинания читает проверка каста */
export type SpellCastBlockSource = Partial<
  Pick<Spell, 'castingTimeUnit' | 'components' | 'concentration'>
>;

/**
 * Почему носитель не может начать накладывание прямо сейчас — одна точка на
 * все пути каста: лист, быстрые заклинания, горячая панель, статблок.
 *
 * @param entity - заклинатель
 * @param spell - заклинание
 * @param ambientEffects - ауры чужих токенов, накрывающие заклинателя
 * @returns причина словами либо `null`, если каст доступен
 */
export function resolveSpellCastBlock(
  entity: DnDSceneEntity,
  spell: SpellCastBlockSource,
  ambientEffects: readonly ActiveEffect[] = [],
): string | null {
  return findSpellCastBlock(
    resolveEntityActionBlocks(entity, ambientEffects),
    spell,
  );
}

/** Раздел статблока существа, у которого своя трата хода */
export type CreatureActionSectionKey =
  'actions' | 'bonusActions' | 'reactions' | 'legendary';

/**
 * Трата хода у раздела статблока. Легендарное действие — не трата хода
 * существа, но недееспособное существо его не совершает: считается
 * действием.
 */
const CREATURE_SECTION_COSTS: Record<
  CreatureActionSectionKey,
  RestrictedActionCost
> = {
  actions: 'action',
  bonusActions: 'bonus',
  reactions: 'reaction',
  legendary: 'action',
};

/**
 * Трата хода у раздела статблока.
 *
 * @param section - раздел статблока
 * @returns трата
 */
export function resolveCreatureSectionCost(
  section: CreatureActionSectionKey,
): RestrictedActionCost {
  return CREATURE_SECTION_COSTS[section];
}

/**
 * Почему существо не может совершить действие этого раздела статблока — по
 * собранным запретам.
 *
 * @param blocks - запреты существа
 * @param section - раздел статблока
 * @returns причина словами либо `null`, если действие доступно
 */
export function findCreatureSectionBlock(
  blocks: EntityActionBlocks,
  section: CreatureActionSectionKey,
): string | null {
  return blocks.byCost[CREATURE_SECTION_COSTS[section]] ?? null;
}

/**
 * Раздел статблока, в котором лежит запись. У записи своего поля о трате хода
 * нет — её выдаёт место: реакция лежит в «Реакциях».
 *
 * @param creature - существо
 * @param action - запись статблока (тот же объект, что в списке)
 * @returns раздел либо `undefined` (особенность или записи нет)
 */
export function findCreatureActionSection(
  creature: DnDCreature,
  action: CreatureAction,
): CreatureActionSectionKey | undefined {
  const { system } = creature;

  const sections: [CreatureActionSectionKey, readonly CreatureAction[]][] = [
    ['actions', system.actions ?? []],
    ['bonusActions', system.bonusActions ?? []],
    ['reactions', system.reactions ?? []],
    ['legendary', system.legendary?.actions ?? []],
  ];

  return sections.find(([, actions]) => actions.includes(action))?.[0];
}

/**
 * Касты, которые носитель держит концентрацией, хотя концентрироваться ему
 * сейчас нельзя: запрет начал действовать («Ярость» включилась) — текущая
 * концентрация прерывается.
 *
 * @param entity - носитель
 * @returns id кастов, которые надо закончить; пусто — прерывать нечего
 */
export function listBlockedConcentrationCasts(
  entity: DnDSceneEntity,
): string[] {
  const castIds = listConcentrationCastIds(entity.activeEffects);

  if (castIds.length === 0) {
    return [];
  }

  return resolveActorStats(entity).activeFlags.has(
    ACTION_RESTRICTION_FLAGS.noConcentration,
  )
    ? castIds
    : [];
}
