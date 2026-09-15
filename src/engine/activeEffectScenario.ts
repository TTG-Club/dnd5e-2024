/**
 * Живая сводка эффекта: одна-две фразы «что произойдёт» простыми словами.
 *
 * Сводка стоит в окне эффекта над всеми шагами и пересобирается на каждое
 * изменение: автор сразу видит, что собрал — «При входе в зону: спасбросок
 * Телосложения, Сл 13. Провал — 2к6 яд, «Отравлен» на 1 минуту. Успех —
 * половина урона». В отличие от `describeActiveEffect`, фраза знает МЕСТО
 * эффекта (зона, оружие, черта) и порядок событий: когда, какой спасбросок, что
 * при провале и что при успехе.
 */

import type {
  ActiveEffect,
  EffectAttackTrigger,
  EffectChange,
} from './activeEffectTypes.js';
import type {
  EffectFormContext,
  EffectFormLayout,
} from './effectFormLayout.js';

import {
  describeConditionName,
  describeEffectChange,
  describeEffectDamageParts,
  describeEffectDuration,
  describeEffectFlag,
  formatEffectSaveDc,
} from './activeEffectDescribe.js';
import { buildConditionActiveEffect } from './conditionTemplates.js';
import {
  readEffectSuccessOutcome,
  resolveEffectFormLayout,
} from './effectFormLayout.js';

/** Характеристики в родительном падеже — «спасбросок Телосложения» */
const ABILITY_GENITIVE_LABELS = {
  strength: 'Силы',
  dexterity: 'Ловкости',
  constitution: 'Телосложения',
  intelligence: 'Интеллекта',
  wisdom: 'Мудрости',
  charisma: 'Харизмы',
} as const;

/** Подписи цели ауры в сводке */
const AURA_TARGET_SCENARIO_LABELS = {
  allies: 'союзники',
  enemies: 'враги',
  all: 'все существа',
} as const;

/** Когда срабатывает эффект «на носителе» — по месту окна */
const CARRIER_MOMENT_LABELS: Record<EffectFormContext, string> = {
  ownEffects: 'Пока эффект активен',
  feature: 'Постоянно у персонажа',
  item: 'Пока предмет надет',
  weapon: 'Пока оружие экипировано',
  spell: 'После сотворения — на заклинателе',
  creatureAction: 'При использовании действия',
  creatureTrait: 'Постоянно у существа',
  zone: 'Пока существо в зоне',
  condition: 'Пока действует состояние',
  generic: 'Пока эффект активен',
};

/** Когда срабатывает эффект «на цели» — по месту окна */
const TARGET_MOMENT_LABELS: Record<EffectFormContext, string> = {
  ownEffects: 'При попадании',
  feature: 'При попадании',
  item: 'При попадании',
  weapon: 'При попадании оружием',
  spell: 'Когда заклинание задело цель',
  creatureAction: 'Когда действие задело цель',
  creatureTrait: 'При попадании',
  zone: 'При попадании',
  condition: 'При попадании',
  generic: 'При попадании',
};

/** Когда срабатывает эффект зоны */
const ZONE_MOMENT_LABELS = {
  stay: 'Пока существо в зоне',
  enter: 'При входе в зону',
  exit: 'При выходе из зоны',
} as const;

/** Когда срабатывает эффект зоны, которую оставляет заклинание */
const SPELL_ZONE_MOMENT_LABELS = {
  stay: 'Пока существо в зоне заклинания',
  enter: 'При входе в зону заклинания',
  exit: 'При выходе из зоны заклинания',
} as const;

/** Снятие после атаки — продолжением перечисления */
const CONSUME_ON_SCENARIO_LABELS: Record<EffectAttackTrigger, string> = {
  carrierAttack: 'снимается после своей атаки',
  attackOnCarrier: 'снимается после атаки по носителю',
};

/** Начало фразы эффекта ауры — по моменту срабатывания */
const AURA_MOMENT_PREFIXES = {
  stay: 'Существам в ауре ',
  enter: 'Когда существо входит в ауру ',
  exit: 'Когда существо выходит из ауры ',
} as const;

/** Части фраз сводки */
const SCENARIO_LABELS = {
  savePrefix: 'спасбросок ',
  failurePrefix: 'Провал — ',
  successPrefix: 'Успех — ',
  nothing: 'ничего',
  halfDamage: 'половина урона',
  andJoiner: ' и ',
  listJoiner: ', ',
  emptyEffect: 'эффект пока ничего не делает',
  everyTurnPrefix: 'каждый ход ',
  startOfTurn: ' в начале хода',
  endOfTurn: ' в конце хода',
  recurringSavePrefix: 'повторный спасбросок ',
  recurringSaveSuffix: ' снимает эффект',
  immunitiesPrefix: 'иммунитет к состояниям: ',
  actionSaveEffectAnyway: 'Эффект ложится и при успешном спасброске.',
  actionSaveOnlyOnSuccess: ', если цель прошла спасбросок',
  feetSuffix: ' фт',
  more: 'и ещё',
  damageSaveSuccess: ': успех — ',
} as const;

/** Что даёт успех спасброска против урона каждый ход */
const RECURRING_DAMAGE_SUCCESS_LABELS = {
  negate: 'без урона',
  half: 'половина урона',
} as const;

/**
 * Подпись Сл 0 по месту окна: у действия существа это Сл действия, а не
 * заклинателя.
 */
const SOURCE_SAVE_DC_LABELS: Partial<Record<EffectFormContext, string>> = {
  creatureAction: 'Сл действия',
  weapon: 'Сл оружия',
};

/** Сколько модификаторов и флагов называть поимённо, прежде чем сказать «и ещё» */
const MAX_NAMED_MODIFIERS = 3;

/**
 * Подпись Сл спасброска в сводке.
 *
 * @param dc - сложность из эффекта
 * @param context - место окна
 * @returns подпись сложности
 */
function formatScenarioSaveDc(dc: number, context: EffectFormContext): string {
  const sourceLabel = SOURCE_SAVE_DC_LABELS[context];

  return dc === 0 && sourceLabel ? sourceLabel : formatEffectSaveDc(dc);
}

/**
 * Когда срабатывает эффект.
 *
 * @param effect - эффект
 * @param layout - раскладка окна
 * @returns начало фразы
 */
function describeMoment(
  effect: ActiveEffect,
  layout: EffectFormLayout,
): string {
  switch (layout.delivery) {
    case 'zone':
      return layout.context === 'spell'
        ? SPELL_ZONE_MOMENT_LABELS[layout.trigger]
        : ZONE_MOMENT_LABELS[layout.trigger];
    case 'target':
      return TARGET_MOMENT_LABELS[layout.context];
    case 'aura': {
      if (!effect.aura) {
        return CARRIER_MOMENT_LABELS[layout.context];
      }

      return `${AURA_MOMENT_PREFIXES[layout.trigger]}${effect.aura.radius}${SCENARIO_LABELS.feetSuffix} (${AURA_TARGET_SCENARIO_LABELS[effect.aura.target]})`;
    }
    case 'carrier':
    default:
      return CARRIER_MOMENT_LABELS[layout.context];
  }
}

/**
 * Эффект состояния из шаблона — чтобы не перечислять то, что уже сказано его
 * названием: «Отравленный» и так значит помеху на атаки.
 *
 * @param effect - эффект
 * @returns эффект состояния либо `null`, если эффект состоянием не считается
 */
function conditionTemplateOf(effect: ActiveEffect): ActiveEffect | null {
  if (!effect.conditionKey) {
    return null;
  }

  return buildConditionActiveEffect(effect.conditionKey, {
    exhaustionLevel: effect.exhaustionLevel,
  });
}

/**
 * Совпадают ли строки модификаторов по смыслу.
 *
 * @param left - строка
 * @param right - строка
 * @returns `true`, если ключ, режим, значение и условие одни и те же
 */
function isSameChange(left: EffectChange, right: EffectChange): boolean {
  return (
    left.key === right.key
    && left.mode === right.mode
    && left.value === right.value
    && (left.condition ?? '') === (right.condition ?? '')
  );
}

/**
 * Называет модификаторы и флаги сверх состояния: первые поимённо, остальные
 * числом.
 *
 * @param effect - эффект
 * @param condition - эффект состояния, которым эффект считается
 * @returns подписи
 */
function describeModifiers(
  effect: ActiveEffect,
  condition: ActiveEffect | null,
): string[] {
  const ownChanges = effect.changes.filter(
    (change) =>
      change.key !== ''
      && change.value.trim() !== ''
      && !condition?.changes.some((conditionChange) =>
        isSameChange(conditionChange, change),
      ),
  );

  const ownFlags = effect.flags.filter(
    (flag) => !condition?.flags.includes(flag),
  );

  const named = [
    ...ownChanges.map(describeEffectChange),
    ...ownFlags.map(describeEffectFlag),
  ];

  if (named.length <= MAX_NAMED_MODIFIERS) {
    return named;
  }

  const rest = named.length - MAX_NAMED_MODIFIERS;

  return [
    ...named.slice(0, MAX_NAMED_MODIFIERS),
    `${SCENARIO_LABELS.more} ${rest}`,
  ];
}

/**
 * Что эффект оставляет на том, на кого лёг: состояние, модификаторы, периодику
 * и сроки. Урон срабатывания сюда не входит — он зависит от спасброска иначе.
 *
 * @param effect - эффект
 * @param layout - раскладка окна
 * @returns части фразы
 */
function describeLastingPayload(
  effect: ActiveEffect,
  layout: EffectFormLayout,
): string[] {
  const parts: string[] = [];
  const condition = conditionTemplateOf(effect);

  if (effect.conditionKey) {
    parts.push(`«${describeConditionName(effect.conditionKey)}»`);
  }

  parts.push(...describeModifiers(effect, condition));

  const ownImmunities = (effect.conditionImmunities ?? []).filter(
    (immunity) => !condition?.conditionImmunities?.includes(immunity),
  );

  if (layout.showConditionImmunities && ownImmunities.length > 0) {
    parts.push(
      `${SCENARIO_LABELS.immunitiesPrefix}${ownImmunities
        .map(describeConditionName)
        .join(SCENARIO_LABELS.listJoiner)}`,
    );
  }

  if (layout.showRecurringDamage && effect.recurringDamage) {
    const damage = describeEffectDamageParts(
      effect.recurringDamage.damageParts,
    );

    if (damage) {
      const { save, timing } = effect.recurringDamage;

      const saveClause = save
        ? ` (${SCENARIO_LABELS.savePrefix}${ABILITY_GENITIVE_LABELS[save.ability]}, ${formatScenarioSaveDc(save.dc, layout.context)}${SCENARIO_LABELS.damageSaveSuccess}${RECURRING_DAMAGE_SUCCESS_LABELS[save.onSuccess]})`
        : '';

      parts.push(
        `${SCENARIO_LABELS.everyTurnPrefix}${damage}${SCENARIO_LABELS[timing]}${saveClause}`,
      );
    }
  }

  if (layout.showRecurringSave && effect.recurringSave) {
    const { ability, dc, timing } = effect.recurringSave;

    parts.push(
      `${SCENARIO_LABELS.recurringSavePrefix}${ABILITY_GENITIVE_LABELS[ability]} ${formatScenarioSaveDc(dc, layout.context)}${SCENARIO_LABELS[timing]}${SCENARIO_LABELS.recurringSaveSuffix}`,
    );
  }

  if (layout.showConsumeOn && effect.consumeOn) {
    parts.push(CONSUME_ON_SCENARIO_LABELS[effect.consumeOn]);
  }

  const duration =
    layout.showDuration && effect.duration.type !== 'permanent'
      ? describeEffectDuration(effect.duration)
      : null;

  if (duration && parts.length > 0) {
    parts.push(duration);
  }

  return parts;
}

/**
 * Склеивает части в перечисление.
 *
 * @param parts - части
 * @returns перечисление либо «ничего»
 */
function joinParts(parts: readonly string[]): string {
  return parts.length > 0
    ? parts.join(SCENARIO_LABELS.listJoiner)
    : SCENARIO_LABELS.nothing;
}

/**
 * Что даёт успешный спасбросок эффекта.
 *
 * @param effect - эффект
 * @param damage - подпись урона срабатывания (пусто — урона нет)
 * @param lasting - длящаяся нагрузка
 * @returns фраза исхода
 */
function describeSuccess(
  effect: ActiveEffect,
  damage: string,
  lasting: readonly string[],
): string {
  switch (readEffectSuccessOutcome(effect)) {
    case 'halfDamage':
      return SCENARIO_LABELS.halfDamage;
    case 'halfDamageWithEffect':
      return `${SCENARIO_LABELS.halfDamage}${SCENARIO_LABELS.andJoiner}${joinParts(lasting)}`;
    case 'effectWithoutDamage':
      return joinParts(lasting);
    case 'onlyOnSuccess':
      return joinParts(damage ? [damage, ...lasting] : lasting);
    case 'nothing':
    default:
      return SCENARIO_LABELS.nothing;
  }
}

/**
 * Живая сводка эффекта для окна: когда срабатывает, какой спасбросок, что при
 * провале и что при успехе — в той форме, в какой эффект сработает там, откуда
 * открыто окно.
 *
 * @param effect - эффект в окне
 * @param context - место окна
 * @returns одна-две фразы
 */
export function describeEffectScenario(
  effect: ActiveEffect,
  context: EffectFormContext,
): string {
  const layout = resolveEffectFormLayout(context, effect);
  const moment = describeMoment(effect, layout);
  const lasting = describeLastingPayload(effect, layout);

  const damage =
    layout.showTriggerDamage && effect.damageParts?.length
      ? describeEffectDamageParts(effect.damageParts)
      : '';

  const everything = damage ? [damage, ...lasting] : lasting;

  if (layout.showSave && effect.applySave) {
    const { ability, dc } = effect.applySave;
    const outcome = readEffectSuccessOutcome(effect);

    const failure =
      outcome === 'onlyOnSuccess'
        ? SCENARIO_LABELS.nothing
        : joinParts(everything);

    return [
      `${moment}: ${SCENARIO_LABELS.savePrefix}${ABILITY_GENITIVE_LABELS[ability]}, ${formatScenarioSaveDc(dc, context)}.`,
      `${SCENARIO_LABELS.failurePrefix}${failure}.`,
      `${SCENARIO_LABELS.successPrefix}${describeSuccess(effect, damage, lasting)}.`,
    ].join(' ');
  }

  if (everything.length === 0) {
    return `${moment}: ${SCENARIO_LABELS.emptyEffect}.`;
  }

  if (layout.successOutcomeForActionSave) {
    switch (readEffectSuccessOutcome(effect)) {
      case 'onlyOnSuccess':
        return `${moment}${SCENARIO_LABELS.actionSaveOnlyOnSuccess}: ${joinParts(everything)}.`;
      case 'effectWithoutDamage':
      case 'halfDamageWithEffect':
        return `${moment}: ${joinParts(everything)}. ${SCENARIO_LABELS.actionSaveEffectAnyway}`;
      default:
        break;
    }
  }

  return `${moment}: ${joinParts(everything)}.`;
}
