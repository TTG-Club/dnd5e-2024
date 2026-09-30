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
 *   действий, ни бонусных действий, ни реакций.
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

import { EFFECT_FLAG_LABELS } from './activeEffectTypes.js';
import { INCAPACITATED_CONDITION_KEY } from './conditionKeys.js';
import { collectActiveEffects, resolveActorStats } from './effectPipeline.js';

/** Флаги ограничения действий */
export const ACTION_RESTRICTION_FLAGS = {
  /** Нет реакций */
  noReaction: 'actions.noReaction',
  /** Нет бонусных действий */
  noBonusAction: 'actions.noBonusAction',
} as const satisfies Record<string, EffectFlagKey>;

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

  const flag = findBlockingFlag(
    resolveActorStats(entity, ambientEffects).activeFlags,
    cost,
  );

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
  spell: Pick<Spell, 'castingTimeUnit'>,
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

  // Эффекты для имени причины собираются, только если запрет есть
  let effects: readonly ActiveEffect[] | null = null;

  for (const cost of RESTRICTED_ACTION_COSTS) {
    const flag = findBlockingFlag(flags, cost);

    if (flag) {
      effects ??= [...collectActiveEffects(entity), ...ambientEffects];

      byCost[cost] = formatActionCostBlock({
        cost,
        sourceName: nameFlagSource(effects, flag),
      });
    }
  }

  return { byCost };
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
  spell: Pick<Spell, 'castingTimeUnit'>,
): string | null {
  const cost = resolveSpellCastCost(spell);

  return (cost && blocks.byCost[cost]) || null;
}

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
  spell: Pick<Spell, 'castingTimeUnit'>,
  ambientEffects: readonly ActiveEffect[] = [],
): string | null {
  return findSpellCastBlock(
    resolveEntityActionBlocks(entity, ambientEffects),
    spell,
  );
}

/** Раздел статблока существа, у которого своя трата хода */
export type CreatureActionSection =
  'actions' | 'bonusActions' | 'reactions' | 'legendary';

/**
 * Трата хода у раздела статблока. Легендарное действие — не трата хода
 * существа, но недееспособное существо его не совершает: считается
 * действием.
 */
const CREATURE_SECTION_COSTS: Record<
  CreatureActionSection,
  RestrictedActionCost
> = {
  actions: 'action',
  bonusActions: 'bonus',
  reactions: 'reaction',
  legendary: 'action',
};

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
  section: CreatureActionSection,
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
): CreatureActionSection | undefined {
  const { system } = creature;

  const sections: [CreatureActionSection, readonly CreatureAction[]][] = [
    ['actions', system.actions ?? []],
    ['bonusActions', system.bonusActions ?? []],
    ['reactions', system.reactions ?? []],
    ['legendary', system.legendary?.actions ?? []],
  ];

  return sections.find(([, actions]) => actions.includes(action))?.[0];
}
