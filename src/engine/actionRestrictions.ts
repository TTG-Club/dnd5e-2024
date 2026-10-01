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
 *   этим флагом (`recordActionSpend`);
 * - `actions.oneOfMoveActionBonus` — за ход одно из трёх: перемещение, действие
 *   или бонусное действие («Психическая плеть Таши»). Тот же счёт трат, только
 *   в наборе есть перемещение: его пишет сервер, когда фишка носителя прошла
 *   путь в свой ход (`recordActionSpend` с тратой `move`), а запас хода после
 *   действия обнуляется (`isTurnMovementSpent`). «Перемещение или действие»
 *   ледяного дьявола — этот флаг вместе с `actions.noBonusAction`;
 * - `actions.oneAttackPerAction` — действием «Атака» только одна атака за ход,
 *   сколько бы их ни давала «Дополнительная атака»: первая атака оружием или
 *   действием статблока пишется в счётчик хода, вторая недоступна. Считается
 *   только атака ДЕЙСТВИЕМ: удар бонусным действием и реакцией счётчик не
 *   двигает и под запрет не попадает. Цену удара даёт обстановка
 *   (`resolveAttackCost`): вне своего хода удар — реакция, в свой ход —
 *   действие «Атака»; у существа цену называет раздел статблока, персонаж
 *   удар бонусным действием объявляет сам (`planWeaponAttack`) — своего поля
 *   цены у оружия нет;
 * - `actions.noOpportunityAttack` — нет провоцированных атак, остальные
 *   реакции доступны («Электрошок» 2024). Отдельного действия «провоцированная
 *   атака» у системы нет — это удар вне своего хода, и запрет о нём
 *   предупреждает, а не гасит кнопку: вне хода бьют и по заготовленному
 *   действию.
 *
 * Колдовство — те же ограничения, только по заклинанию, а не по трате:
 * - `spellcasting.blocked` — нельзя накладывать заклинания (Ярость,
 *   Газообразная форма, Силовая клетка изнутри);
 * - `spellcasting.noVerbal` — нельзя заклинания с вербальным компонентом
 *   (Тишина, кляп);
 * - `spellcasting.noMagicAction` — нельзя действие «Магия»: заклинания со
 *   временем накладывания «действие» недоступны, бонусным действием и реакцией
 *   — можно («Цепи сдерживания магов»);
 * - `spellcasting.noSchool.<школа>` — нельзя заклинания одной школы;
 * - правило каста эффекта (`castRule`, `effectCastRule.ts`) — ячейки не выше и
 *   не ниже круга;
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

import type { SpellCastingTimeUnit, SpellSchool } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectFlagKey,
  SpellSchoolBlockFlagKey,
} from './activeEffectTypes.js';
import type { CreatureAction } from './creatureTypes.js';
import type { DnDCreature, DnDSceneEntity, Spell } from './dndEntities.js';
import type { EffectActionCost } from './effectTriggerTypes.js';
import type { EffectTriggerUsageLedger } from './effectTriggerUsage.js';

import { EFFECT_FLAG_LABELS } from './activeEffectTypes.js';
import { listConcentrationCastIds } from './concentration.js';
import { INCAPACITATED_CONDITION_KEY } from './conditionKeys.js';
import {
  filterCastLevels,
  resolveSlotLevelLimit,
  spellUsesSlot,
} from './effectCastRule.js';
import { collectActiveEffects, resolveActorStats } from './effectPipeline.js';
import { readTriggerUsage } from './effectTriggerUsage.js';
import { SPELL_SCHOOL_KEYS, SPELL_SCHOOL_LABELS } from './spellTypes.js';

/** Флаги ограничения действий */
export const ACTION_RESTRICTION_FLAGS = {
  /** Нет реакций */
  noReaction: 'actions.noReaction',
  /** Нет бонусных действий */
  noBonusAction: 'actions.noBonusAction',
  /** За ход — действие или бонусное действие, не оба */
  oneActionOrBonus: 'actions.oneActionOrBonus',
  /** За ход — одно из трёх: перемещение, действие или бонусное действие */
  oneOfMoveActionBonus: 'actions.oneOfMoveActionBonus',
  /** Действием «Атака» — только одна атака за ход */
  oneAttackPerAction: 'actions.oneAttackPerAction',
  /** Нет провоцированных атак */
  noOpportunityAttack: 'actions.noOpportunityAttack',
  /** Нельзя накладывать заклинания */
  noSpellcasting: 'spellcasting.blocked',
  /** Нельзя заклинания с вербальным компонентом */
  noVerbal: 'spellcasting.noVerbal',
  /** Нельзя действие «Магия»: заклинания действием */
  noMagicAction: 'spellcasting.noMagicAction',
  /** Нельзя концентрироваться */
  noConcentration: 'concentration.blocked',
} as const satisfies Record<string, EffectFlagKey>;

/** Запрет колдовства: что запрещено и чем */
type SpellcastingRestriction =
  'all' | 'verbal' | 'concentration' | 'magicAction';

/** Флаг каждого запрета колдовства */
const SPELLCASTING_RESTRICTION_FLAGS: Record<
  SpellcastingRestriction,
  EffectFlagKey
> = {
  all: ACTION_RESTRICTION_FLAGS.noSpellcasting,
  verbal: ACTION_RESTRICTION_FLAGS.noVerbal,
  concentration: ACTION_RESTRICTION_FLAGS.noConcentration,
  magicAction: ACTION_RESTRICTION_FLAGS.noMagicAction,
};

/** Начало причины запрета колдовства */
const SPELLCASTING_RESTRICTION_PREFIXES: Record<
  SpellcastingRestriction,
  string
> = {
  all: 'Заклинания недоступны',
  verbal: 'Заклинание с вербальным компонентом недоступно',
  concentration: 'Концентрация недоступна',
  magicAction: 'Действие «Магия» недоступно',
};

/** Запреты колдовства по порядку: общий главнее частных */
const SPELLCASTING_RESTRICTIONS: readonly SpellcastingRestriction[] = [
  'all',
  'verbal',
  'concentration',
  'magicAction',
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

/**
 * Трата хода, которую считают правила «за ход одно из»: к действию и
 * бонусному действию добавляется перемещение.
 */
type TurnSpendCost = Extract<EffectActionCost, 'action' | 'bonus' | 'move'>;

/** Ключи счётчиков трат хода в общих счётчиках носителя */
const TURN_SPEND_KEYS: Record<TurnSpendCost, string> = {
  action: 'turnSpend|action',
  bonus: 'turnSpend|bonus',
  move: 'turnSpend|move',
};

/** Ключ счётчика атак действием «Атака» за ход */
const ATTACK_SPEND_KEY = 'turnSpend|attack';

/** Трата, которой совершается действие «Атака» */
const ATTACK_ACTION_COST: RestrictedActionCost = 'action';

/** Трата, которой бьют вне своего хода */
const OFF_TURN_ATTACK_COST: RestrictedActionCost = 'reaction';

/**
 * Чем на деле совершается атака. Действием бьют только в свой ход: удар вне
 * хода — провоцированная атака или заготовленное действие, то есть реакция.
 * Бонусное действие и реакция остаются собой.
 *
 * @param cost - трата, которой атака названа (раздел статблока, выбор
 *   бьющего)
 * @param isOwnTurn - идёт ли ход атакующего; вне боя хода нет — считается
 *   своим
 * @returns трата, которую атака тратит
 */
export function resolveAttackCost(
  cost: RestrictedActionCost,
  isOwnTurn: boolean,
): RestrictedActionCost {
  return cost === ATTACK_ACTION_COST && !isOwnTurn
    ? OFF_TURN_ATTACK_COST
    : cost;
}

/** Правило «за ход одно из»: флаг и траты, из которых доступна одна */
interface ExclusiveSpendRule {
  /** Флаг правила */
  flag: EffectFlagKey;
  /** Траты, из которых за ход доступна одна */
  costs: readonly TurnSpendCost[];
}

/** Правила «за ход одно из» */
const EXCLUSIVE_SPEND_RULES: readonly ExclusiveSpendRule[] = [
  {
    flag: ACTION_RESTRICTION_FLAGS.oneActionOrBonus,
    costs: ['action', 'bonus'],
  },
  {
    flag: ACTION_RESTRICTION_FLAGS.oneOfMoveActionBonus,
    costs: ['move', 'action', 'bonus'],
  },
];

/**
 * Считается ли трата в правилах «за ход одно из».
 *
 * @param cost - трата
 * @returns `true` для действия, бонусного действия и перемещения
 */
function isTurnSpendCost(
  cost: EffectActionCost | undefined,
): cost is TurnSpendCost {
  return cost === 'action' || cost === 'bonus' || cost === 'move';
}

/**
 * Была ли в этот ход трата.
 *
 * @param ledger - счётчики носителя
 * @param key - ключ счётчика траты
 * @returns `true`, если трата записана
 */
function wasSpent(ledger: EffectTriggerUsageLedger, key: string): boolean {
  return (ledger[key]?.used ?? 0) > 0;
}

/**
 * Флаг «за ход одно из», если он запрещает трату: в этот ход уже была другая
 * трата из его набора.
 *
 * @param entity - носитель
 * @param flags - действующие флаги
 * @param cost - трата
 * @returns флаг либо `undefined`
 */
function findTurnSpendBlock(
  entity: DnDSceneEntity,
  flags: ReadonlySet<string>,
  cost: EffectActionCost,
): EffectFlagKey | undefined {
  if (!isTurnSpendCost(cost)) {
    return undefined;
  }

  const rules = EXCLUSIVE_SPEND_RULES.filter(
    (rule) => flags.has(rule.flag) && rule.costs.includes(cost),
  );

  if (rules.length === 0) {
    return undefined;
  }

  const ledger = readTriggerUsage(entity);

  return rules.find((rule) =>
    rule.costs.some(
      (other) => other !== cost && wasSpent(ledger, TURN_SPEND_KEYS[other]),
    ),
  )?.flag;
}

/**
 * Потрачен ли ход носителя так, что перемещаться ему уже нельзя: под «одним
 * из трёх» он совершил действие или бонусное действие.
 *
 * @param entity - носитель
 * @param flags - действующие флаги носителя
 * @returns `true`, если перемещение в этот ход недоступно
 */
export function isTurnMovementSpent(
  entity: DnDSceneEntity,
  flags: ReadonlySet<string>,
): boolean {
  return findTurnSpendBlock(entity, flags, 'move') !== undefined;
}

/**
 * Флаг «одна атака», если он запрещает удар: атака действием «Атака» в этот
 * ход уже была.
 *
 * @param entity - носитель
 * @param flags - действующие флаги
 * @returns флаг либо `undefined`
 */
function findAttackSpendBlock(
  entity: DnDSceneEntity,
  flags: ReadonlySet<string>,
): EffectFlagKey | undefined {
  const flag = ACTION_RESTRICTION_FLAGS.oneAttackPerAction;

  return flags.has(flag) && wasSpent(readTriggerUsage(entity), ATTACK_SPEND_KEY)
    ? flag
    : undefined;
}

/** Что ещё известно о трате хода */
export interface ActionSpendOptions {
  /**
   * Трата — атака. «Одна атака за ход» считает её, только когда она совершена
   * действием: удар бонусным действием и реакцией — не действие «Атака»
   */
  attack?: boolean;
  /** Ауры чужих токенов, накрывающие носителя */
  ambientEffects?: readonly ActiveEffect[];
}

/**
 * Счётчики носителя после траты хода — для записи боевым каналом. Пишется
 * только там, где трату считают: у носителя с правилом «за ход одно из» — трата
 * из его набора, у носителя с «одной атакой» — атака действием.
 *
 * @param entity - носитель
 * @param cost - трата
 * @param options - атака ли это и ауры на носителе
 * @returns новые счётчики либо `undefined`, если записывать нечего
 */
export function recordActionSpend(
  entity: DnDSceneEntity,
  cost: EffectActionCost | undefined,
  options: ActionSpendOptions = {},
): EffectTriggerUsageLedger | undefined {
  if (!isTurnSpendCost(cost)) {
    return undefined;
  }

  const flags = resolveActorStats(entity, options.ambientEffects).activeFlags;

  const keys = [
    ...(EXCLUSIVE_SPEND_RULES.some(
      (rule) => flags.has(rule.flag) && rule.costs.includes(cost),
    )
      ? [TURN_SPEND_KEYS[cost]]
      : []),
    ...(options.attack === true
    && cost === ATTACK_ACTION_COST
    && flags.has(ACTION_RESTRICTION_FLAGS.oneAttackPerAction)
      ? [ATTACK_SPEND_KEY]
      : []),
  ];

  if (keys.length === 0) {
    return undefined;
  }

  const ledger = { ...readTriggerUsage(entity) };

  for (const key of keys) {
    ledger[key] = { used: (ledger[key]?.used ?? 0) + 1, per: 'turn' };
  }

  return ledger;
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
  /** Причина запрета заклинаний школы */
  schools: Partial<Record<SpellSchool, string>>;
  /** Какими ячейками носитель может колдовать: не выше и не ниже круга */
  slotLevels: SlotLevelBlocks;
  /** Почему недоступна вторая атака действием «Атака» */
  attack?: string;
}

/** Лимит круга ячейки с причиной */
export interface SlotLevelBlocks {
  /** Самый высокий доступный круг ячейки */
  max?: number;
  /** Причина лимита сверху */
  maxReason?: string;
  /** Самый низкий доступный круг ячейки */
  min?: number;
  /** Причина лимита снизу */
  minReason?: string;
}

/** Начала причин остальных запретов */
const RESTRICTION_REASON_PREFIXES = {
  school: 'Заклинания школы недоступны',
  slotAbove: 'Ячейки выше круга недоступны',
  slotBelow: 'Ячейки ниже круга недоступны',
  attack: 'Вторая атака за ход недоступна',
  opportunityAttack: 'Провоцированные атаки недоступны',
} as const;

/**
 * Флаг запрета заклинаний школы.
 *
 * @param school - школа магии
 * @returns ключ флага
 */
function schoolBlockFlag(school: SpellSchool): SpellSchoolBlockFlagKey {
  return `spellcasting.noSchool.${school}`;
}

/**
 * Лимит круга ячейки с причинами — по правилам каста эффектов носителя.
 *
 * @param effects - действующие эффекты носителя и ауры на нём
 * @returns лимит; пустой — ограничений нет
 */
function resolveSlotLevelBlocks(
  effects: readonly ActiveEffect[],
): SlotLevelBlocks {
  const { max, min } = resolveSlotLevelLimit(effects);

  return {
    ...(max
      ? {
          max: max.level,
          maxReason: `${RESTRICTION_REASON_PREFIXES.slotAbove} (${max.level}): ${max.sourceName}`,
        }
      : {}),
    ...(min
      ? {
          min: min.level,
          minReason: `${RESTRICTION_REASON_PREFIXES.slotBelow} (${min.level}): ${min.sourceName}`,
        }
      : {}),
  };
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
  const schools: Partial<Record<SpellSchool, string>> = {};

  // Правила каста лежат на самих эффектах — их читают по списку
  const effects = [...collectActiveEffects(entity), ...ambientEffects];

  /**
   * Имя того, что запрещает, — по флагу.
   *
   * @param flag - флаг запрета
   * @returns имя эффекта либо подпись флага
   */
  const sourceOf = (flag: EffectFlagKey): string =>
    nameFlagSource(effects, flag);

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

  for (const school of SPELL_SCHOOL_KEYS) {
    const flag = schoolBlockFlag(school);

    if (flags.has(flag)) {
      schools[school] =
        `${RESTRICTION_REASON_PREFIXES.school} («${SPELL_SCHOOL_LABELS[school]}»): ${sourceOf(flag)}`;
    }
  }

  const attackFlag = findAttackSpendBlock(entity, flags);

  return {
    byCost,
    spellcasting,
    schools,
    slotLevels: resolveSlotLevelBlocks(effects),
    ...(attackFlag
      ? {
          attack: `${RESTRICTION_REASON_PREFIXES.attack}: ${sourceOf(attackFlag)}`,
        }
      : {}),
  };
}

/**
 * Круги, которыми носитель может наложить заклинание под лимитом круга
 * ячейки. Заговорам и заклинаниям с зарядами лимит не мешает.
 *
 * @param blocks - запреты носителя
 * @param spell - заклинание
 * @param levels - круги, которыми наложить можно по ячейкам
 * @returns разрешённые круги
 */
export function limitCastLevels(
  blocks: EntityActionBlocks,
  spell: SpellCastBlockSource,
  levels: readonly number[],
): number[] {
  return filterCastLevels(blocks.slotLevels, spell, levels);
}

/**
 * Почему под лимитом круга ячейки заклинание не наложить ни одним из кругов.
 *
 * @param blocks - запреты носителя
 * @param spell - заклинание
 * @param levels - круги, которыми наложить можно по ячейкам
 * @returns причина словами либо `null`, если хоть один круг разрешён
 */
export function findCastLevelBlock(
  blocks: EntityActionBlocks,
  spell: SpellCastBlockSource,
  levels: readonly number[],
): string | null {
  if (
    levels.length === 0
    || limitCastLevels(blocks, spell, levels).length > 0
  ) {
    return null;
  }

  const { max, maxReason, minReason } = blocks.slotLevels;

  // Все круги выше лимита — причина сверху, иначе снизу
  return (
    (max !== undefined && levels.every((level) => level > max)
      ? maxReason
      : (minReason ?? maxReason)) ?? null
  );
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

  const { max, maxReason } = blocks.slotLevels;

  const byRestriction =
    spellcasting.all
    ?? (spell.components?.verbal ? spellcasting.verbal : undefined)
    ?? (spell.concentration ? spellcasting.concentration : undefined)
    ?? (spell.castingTimeUnit === 'action'
      ? spellcasting.magicAction
      : undefined)
    ?? (spell.school ? blocks.schools[spell.school] : undefined)
    // Круг самого заклинания выше лимита: понизить его нельзя
    ?? (max !== undefined && spellUsesSlot(spell) && (spell.level ?? 0) > max
      ? maxReason
      : undefined);

  if (byRestriction) {
    return byRestriction;
  }

  const cost = resolveSpellCastCost(spell);

  return (cost && blocks.byCost[cost]) || null;
}

/** Что заклинания читает проверка каста */
export type SpellCastBlockSource = Partial<
  Pick<
    Spell,
    | 'castingTimeUnit'
    | 'components'
    | 'concentration'
    | 'school'
    | 'level'
    | 'uses'
  >
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

/**
 * Трата хода удара оружием персонажа, пока о нём ничего не известно: действие
 * «Атака». Своего поля цены у оружия нет — вне хода удар считается реакцией
 * (`resolveAttackCost`), а бонусным действием его объявляет сам бьющий
 * (`planWeaponAttack`).
 */
export const WEAPON_ATTACK_COST: RestrictedActionCost = ATTACK_ACTION_COST;

/** Трата, которой персонаж объявляет удар вместо действия «Атака» */
export const WEAPON_DECLARED_ATTACK_COST: RestrictedActionCost = 'bonus';

/**
 * Причина запрета атаки этой тратой — по собранным запретам: запрет самой
 * траты либо, у атаки действием, вторая атака под «одной атакой за ход».
 *
 * @param blocks - запреты носителя
 * @param cost - чем совершается атака
 * @returns причина словами либо `null`, если атака доступна
 */
function findAttackBlock(
  blocks: EntityActionBlocks,
  cost: RestrictedActionCost,
): string | null {
  return (
    blocks.byCost[cost]
    ?? (cost === ATTACK_ACTION_COST ? blocks.attack : undefined)
    ?? null
  );
}

/**
 * Почему персонаж не может ударить оружием этой тратой прямо сейчас:
 * недееспособен, ход уже потрачен на бонусное действие под «Замедлением» или
 * единственная атака действием «Атака» уже была. Удару бонусным действием и
 * реакцией «одна атака за ход» не мешает.
 *
 * @param entity - кто бьёт
 * @param ambientEffects - ауры чужих токенов, накрывающие его
 * @param cost - чем совершается удар; по умолчанию — действием «Атака»
 * @returns причина словами либо `null`, если удар доступен
 */
export function resolveWeaponAttackBlock(
  entity: DnDSceneEntity,
  ambientEffects: readonly ActiveEffect[] = [],
  cost: RestrictedActionCost = WEAPON_ATTACK_COST,
): string | null {
  return findAttackBlock(
    resolveEntityActionBlocks(entity, ambientEffects),
    cost,
  );
}

/** Как пойдёт удар оружием персонажа */
export interface WeaponAttackPlan {
  /** Чем удар совершается: действием «Атака», вне своего хода — реакцией */
  cost: RestrictedActionCost;
  /** Почему удар этой тратой недоступен; `null` — доступен */
  blocked: string | null;
  /**
   * Удар можно объявить бонусным действием: мешает ему только «одна атака за
   * ход», а бонусное действие у бьющего есть
   */
  canDeclareBonus: boolean;
}

/**
 * Решает, чем персонаж бьёт оружием и можно ли это сейчас — лист и горячая
 * панель. У оружия нет поля цены, поэтому в свой ход удар — действие «Атака»,
 * вне хода — реакция. Когда единственная атака действием уже была
 * («Замедление», «Изувечен»), удар не гаснет молча: бьющий может объявить его
 * бонусным действием (второе лёгкое оружие, «Мастер древкового оружия», удар
 * без оружия монаха) — отличить такой удар от действия «Атака» сама система
 * не может.
 *
 * @param entity - кто бьёт
 * @param isOwnTurn - идёт ли его ход; вне боя хода нет — считается своим
 * @param ambientEffects - ауры чужих токенов, накрывающие его
 * @returns трата, причина запрета и можно ли объявить бонусное действие
 */
export function planWeaponAttack(
  entity: DnDSceneEntity,
  isOwnTurn: boolean,
  ambientEffects: readonly ActiveEffect[] = [],
): WeaponAttackPlan {
  const blocks = resolveEntityActionBlocks(entity, ambientEffects);
  const cost = resolveAttackCost(WEAPON_ATTACK_COST, isOwnTurn);
  const blocked = findAttackBlock(blocks, cost);

  return {
    cost,
    blocked,
    canDeclareBonus:
      blocked !== null
      && blocks.byCost[cost] === undefined
      && findAttackBlock(blocks, WEAPON_DECLARED_ATTACK_COST) === null,
  };
}

/**
 * Предупреждение об ударе вне своего хода носителю без провоцированных атак.
 * Не запрет: вне хода бьют и по заготовленному действию — решает стол.
 *
 * @param entity - кто бьёт
 * @param ambientEffects - ауры чужих токенов, накрывающие его
 * @returns текст предупреждения либо `null`, если запрета нет
 */
export function resolveOpportunityAttackWarning(
  entity: DnDSceneEntity,
  ambientEffects: readonly ActiveEffect[] = [],
): string | null {
  const flag = ACTION_RESTRICTION_FLAGS.noOpportunityAttack;

  if (!resolveActorStats(entity, ambientEffects).activeFlags.has(flag)) {
    return null;
  }

  return `${RESTRICTION_REASON_PREFIXES.opportunityAttack}: ${nameFlagSource(
    [...collectActiveEffects(entity), ...ambientEffects],
    flag,
  )}`;
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
 * Атака ли это действием «Атака»: запись раздела «Действия» с броском
 * попадания. Бонусные действия, реакции и легендарные действия — не она.
 *
 * @param section - раздел статблока
 * @param action - запись статблока
 * @returns `true` для атаки из раздела «Действия»
 */
export function isCreatureAttackAction(
  section: CreatureActionSectionKey | undefined,
  action: Pick<CreatureAction, 'attackBonus'>,
): boolean {
  return section === 'actions' && action.attackBonus !== undefined;
}

/**
 * Чем существо совершает запись статблока: трата раздела, а у атаки из
 * «Действий» вне своего хода — реакция (провоцированная атака бьёт той же
 * записью).
 *
 * @param section - раздел статблока
 * @param action - запись статблока
 * @param isOwnTurn - идёт ли ход существа; вне боя хода нет — считается своим
 * @returns трата
 */
export function resolveCreatureActionCost(
  section: CreatureActionSectionKey,
  action: Pick<CreatureAction, 'attackBonus'>,
  isOwnTurn: boolean,
): RestrictedActionCost {
  const cost = CREATURE_SECTION_COSTS[section];

  return isCreatureAttackAction(section, action)
    ? resolveAttackCost(cost, isOwnTurn)
    : cost;
}

/**
 * Почему существо не может совершить ЭТО действие статблока: запрет траты
 * либо вторая атака действием под «одной атакой за ход». Атака из «Действий»
 * вне своего хода — реакция: её гасит запрет реакций, а «одна атака» — нет.
 *
 * @param blocks - запреты существа
 * @param section - раздел статблока
 * @param action - запись статблока
 * @param isOwnTurn - идёт ли ход существа; вне боя хода нет — считается своим
 * @returns причина словами либо `null`, если действие доступно
 */
export function findCreatureActionBlock(
  blocks: EntityActionBlocks,
  section: CreatureActionSectionKey,
  action: Pick<CreatureAction, 'attackBonus'>,
  isOwnTurn = true,
): string | null {
  const cost = resolveCreatureActionCost(section, action, isOwnTurn);

  return isCreatureAttackAction(section, action)
    ? findAttackBlock(blocks, cost)
    : (blocks.byCost[cost] ?? null);
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
