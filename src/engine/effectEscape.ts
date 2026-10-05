/**
 * Действие, снимающее эффект: «вырваться».
 *
 * Правила часто дают жертве выход: «существо может действием совершить
 * проверку Силы (Атлетика) Сл 14 и освободиться». Такое действие совершает
 * человек, поэтому движок здесь только считает Сл, называет проверку и
 * говорит, что снимать по успеху. Сам бросок делает лист, как любую другую
 * проверку навыка.
 *
 * Грабли, ради которых модуль вообще отдельный: Сл «Авто» (0) значит «Сл
 * источника», а у эффекта из компендиума источника нет. Проверка против нуля
 * прошла бы у кого угодно, поэтому нулевая Сл — это ЯВНЫЙ отказ
 * ({@link resolveEffectEscapeDc} отдаёт `null`), а не молчаливый успех.
 *
 * @module system/dnd/effectEscape
 */

import type { SkillType } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectEscape,
  EffectEscapeActor,
  EffectEscapeOutcome,
  EffectEscapeRole,
  EffectEscapeRollMode,
  EffectFlagKey,
} from './activeEffectTypes.js';
import type { AttackRollMode } from './attackUtils.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { EffectActionCost } from './effectTriggerTypes.js';

import {
  formatActionCostBlock,
  resolveActionCostBlock,
} from './actionRestrictions.js';
import {
  DEFAULT_ESCAPE_ACTOR,
  DEFAULT_ESCAPE_OUTCOME,
  SOURCE_SAVE_DC,
} from './activeEffectTypes.js';
import { combineRollMode } from './attackUtils.js';
import { buildConditionActiveEffect } from './conditionTemplates.js';
import { SKILLS_LABELS } from './consts.js';
import { resolveSaveDc } from './effectSaveDcOwner.js';
import {
  actionCostTakesFeet,
  DEFAULT_EFFECT_MOVE_COST_FEET,
} from './effectTriggerTypes.js';

/** Подпись кнопки «вырваться», пока автор не назвал свою */
export const DEFAULT_ESCAPE_LABEL = 'Вырваться';

/** Подписи цены действия для кнопки и окна */
export const EFFECT_ACTION_COST_LABELS: Record<EffectActionCost, string> = {
  action: 'Действие',
  bonus: 'Бонусное действие',
  reaction: 'Реакция',
  move: 'Перемещение',
  free: 'Без затрат',
};

/** Подписи того, кто может вырваться */
export const EFFECT_ESCAPE_ACTOR_LABELS: Record<EffectEscapeActor, string> = {
  self: 'Носитель',
  adjacent: 'Существо рядом',
  any: 'Носитель или существо рядом',
};

/** Подписи режима броска проверки «вырваться» */
export const EFFECT_ESCAPE_ROLL_MODE_LABELS: Record<
  EffectEscapeRollMode,
  string
> = {
  advantage: 'С преимуществом',
  disadvantage: 'С помехой',
};

/** Состояние захвата: к нему относятся флаги «вырваться из захвата» */
const GRAPPLED_CONDITION_KEY = 'grappled';

/** Флаги вырывающегося: любая проверка «вырваться» и только из захвата */
const ESCAPER_ROLL_FLAGS: Record<
  EffectEscapeRollMode,
  { any: EffectFlagKey; grappled: EffectFlagKey }
> = {
  advantage: {
    any: 'escape.advantage',
    grappled: 'escape.advantage.grappled',
  },
  disadvantage: {
    any: 'escape.disadvantage',
    grappled: 'escape.disadvantage.grappled',
  },
};

/** Флаг того, кто держит: из его захвата вырываются с помехой */
export const GRAPPLE_ESCAPE_DISADVANTAGE_FLAG: EffectFlagKey =
  'grapple.escapeDisadvantage';

/** Соединители подписи кнопки «вырваться» */
const ESCAPE_LABEL_PARTS = {
  skillsJoiner: ' или ',
  dcPrefix: ' Сл ',
} as const;

/** Подписи того, что даёт успех */
export const EFFECT_ESCAPE_OUTCOME_LABELS: Record<EffectEscapeOutcome, string> =
  {
    removeSelf: 'Снять эффект',
    removeCondition: 'Снять состояние',
  };

/**
 * Сл проверки «вырваться».
 *
 * Сл 0 — «Сл источника»: её проставляют при наложении
 * (`stampSourceSaveDcs`). Осталась нулевой — источника не было, и честной
 * сложности у проверки нет: кнопка не действует.
 *
 * @param escape - блок действия
 * @returns сложность либо `null`, если её неоткуда взять
 */
export function resolveEffectEscapeDc(escape: EffectEscape): number | null {
  const { check } = escape;

  if (check === undefined) {
    return null;
  }

  // Сл формулой получила числа наложившего при наложении
  const dc = resolveSaveDc(check);

  return dc > SOURCE_SAVE_DC ? dc : null;
}

/**
 * Может ли действовать существо в этой роли: сам носитель или тот, кто рядом.
 *
 * @param escape - блок действия
 * @param role - роль действующего
 * @returns `true`, если роль вправе действовать
 */
export function escapeAllowsRole(
  escape: EffectEscape,
  role: EffectEscapeRole,
): boolean {
  const by = escape.by ?? DEFAULT_ESCAPE_ACTOR;

  return by === 'any' || by === role;
}

/** Навык проверки «вырваться» с его сложностью */
export interface EscapeCheckOption {
  /** Навык */
  skill: SkillType;
  /** Сложность этого навыка */
  dc: number;
  /** Подпись варианта: «Атлетика Сл 14», «Ловкость рук (воровскими инструментами) Сл 15» */
  label: string;
}

/**
 * Навыки, которыми можно вырываться: все — или только доступные роли. У
 * навыка своя Сл либо Сл проверки; навык, чью Сл взять неоткуда (Сл источника
 * не проставлена), в список не входит.
 *
 * @param escape - блок действия
 * @param role - роль действующего; нет — навыки всех ролей
 * @returns навыки со сложностью; пусто — проверки нет или бросать не против чего
 */
export function listEscapeChecks(
  escape: EffectEscape,
  role?: EffectEscapeRole,
): EscapeCheckOption[] {
  const { check } = escape;

  if (!check) {
    return [];
  }

  const baseDc = resolveEffectEscapeDc(escape);
  const options = check.skills ?? [{ skill: check.skill }];

  return options
    .filter(
      (option) =>
        role === undefined || option.by === undefined || option.by === role,
    )
    .flatMap((option) => {
      const dc = option.dc ?? baseDc;

      if (dc === null) {
        return [];
      }

      const name = option.label
        ? `${SKILLS_LABELS[option.skill]} (${option.label})`
        : SKILLS_LABELS[option.skill];

      return [
        {
          skill: option.skill,
          dc,
          label: `${name}${ESCAPE_LABEL_PARTS.dcPrefix}${dc}`,
        },
      ];
    });
}

/**
 * Можно ли вырваться из эффекта прямо сейчас: действие есть и его проверку
 * есть против чего бросать.
 *
 * @param effect - эффект
 * @param role - роль действующего; нет — хоть кто-то
 * @returns `true`, если кнопка действует
 */
export function canEscapeEffect(
  effect: ActiveEffect,
  role?: EffectEscapeRole,
): boolean {
  const { escape } = effect;

  if (!escape || effect.disabled) {
    return false;
  }

  if (role !== undefined && !escapeAllowsRole(escape, role)) {
    return false;
  }

  // Действие без проверки снимает эффект просто так — Сл ему не нужна
  return (
    escape.check === undefined || listEscapeChecks(escape, role).length > 0
  );
}

/**
 * Может ли существо помочь вырваться из эффекта как «существо рядом».
 *
 * Тот, кто эффект наложил, помощником не считается: он его держит. Иначе
 * ведущему, который управляет всеми, среди помощников предлагалось бы само
 * существо, схватившее носителя, — бросать проверку против собственной Сл.
 * Носитель, наложивший эффект на себя, вырывается сам — в роли носителя.
 *
 * @param effect - эффект с блоком «вырваться»
 * @param helperId - существо рядом с носителем
 * @returns `true`, если существо вправе помочь
 */
export function canHelpEscapeEffect(
  effect: ActiveEffect,
  helperId: string,
): boolean {
  return (
    canEscapeEffect(effect, 'adjacent') && effect.sourceActorId !== helperId
  );
}

/** Что влияет на режим броска проверки «вырваться» */
export interface EscapeRollModeParams {
  /** Режим проверки навыка по флагам бросающего (`resolveAbilityCheckRollMode`) */
  checkMode: AttackRollMode;
  /** Эффект, из которого вырываются */
  effect: ActiveEffect;
  /** Действующие флаги бросающего */
  flags: ReadonlySet<string>;
  /** Действующие флаги того, кто наложил эффект, если он известен */
  holderFlags?: ReadonlySet<string>;
}

/**
 * Режим броска проверки «вырваться»: режим самой проверки навыка, режим из
 * эффекта («проверки для освобождения — с помехой», Мимик), флаги вырывающегося
 * («преимущество, чтобы избавиться от состояния схваченный», Голиаф) и флаг
 * того, кто держит («из вашего захвата высвобождаются с помехой»).
 * Преимущество и помеха гасятся по обычному правилу.
 *
 * @param params - что влияет на режим
 * @returns режим броска
 */
export function resolveEscapeRollMode(
  params: EscapeRollModeParams,
): AttackRollMode {
  const { checkMode, effect, flags, holderFlags } = params;
  const isGrapple = effect.conditionKey === GRAPPLED_CONDITION_KEY;
  const effectMode = effect.escape?.check?.mode;

  /**
   * Действует ли режим по любой из причин.
   *
   * @param mode - преимущество или помеха
   * @returns `true`, если режим есть
   */
  const holds = (mode: EffectEscapeRollMode): boolean =>
    checkMode === mode
    || effectMode === mode
    || flags.has(ESCAPER_ROLL_FLAGS[mode].any)
    || (isGrapple && flags.has(ESCAPER_ROLL_FLAGS[mode].grappled));

  return combineRollMode(
    holds('advantage'),
    holds('disadvantage')
      || (isGrapple
        && (holderFlags?.has(GRAPPLE_ESCAPE_DISADVANTAGE_FLAG) ?? false)),
  );
}

/**
 * Состояние, которое носитель получает после освобождения («при успехе цель
 * извлекается и получает состояние лежащий ничком»).
 *
 * @param effect - эффект, из которого вырвались
 * @returns эффект состояния либо `null`, если его нет или состояние неизвестно
 */
export function buildEscapeAftermath(
  effect: ActiveEffect,
): ActiveEffect | null {
  const conditionKey = effect.escape?.onSuccessApply;

  return conditionKey ? buildConditionActiveEffect(conditionKey) : null;
}

/**
 * Почему кнопка «вырваться» не действует. Цену платит тот, кто действует, —
 * под «Электрошоком» реакцией не вырваться (`actionRestrictions.ts`); запрет
 * носителя помощника не касается.
 *
 * @param effect - эффект
 * @param actor - кто действует, если известен
 * @returns причина либо `null`, если кнопка действует
 */
export function describeEscapeUnavailable(
  effect: ActiveEffect,
  actor?: DnDSceneEntity,
): string | null {
  const { escape } = effect;

  if (!escape) {
    return null;
  }

  if (!canEscapeEffect(effect)) {
    return effect.disabled
      ? 'эффект выключен'
      : 'Сл источника неизвестна — проверка не против чего бросать';
  }

  const block = actor ? resolveActionCostBlock(actor, escape.cost) : null;

  return block ? formatActionCostBlock(block) : null;
}

/**
 * Подпись кнопки «вырваться»: своя или собранная из проверки и цены.
 *
 * @param effect - эффект с действием
 * @returns подпись кнопки
 */
export function formatEffectEscapeLabel(effect: ActiveEffect): string {
  const { escape } = effect;

  if (!escape) {
    return DEFAULT_ESCAPE_LABEL;
  }

  if (escape.label) {
    return escape.label;
  }

  const checks = listEscapeChecks(escape);

  if (checks.length === 0) {
    return DEFAULT_ESCAPE_LABEL;
  }

  return `${DEFAULT_ESCAPE_LABEL}: ${describeEscapeChecks(checks)}`;
}

/**
 * Навыки проверки одной строкой: при общей Сл — «Атлетика или Акробатика Сл
 * 14», при разной — «Ловкость рук Сл 20 или Атлетика Сл 25».
 *
 * @param checks - навыки со сложностью
 * @returns строка
 */
export function describeEscapeChecks(
  checks: readonly EscapeCheckOption[],
): string {
  const [first] = checks;

  if (!first) {
    return '';
  }

  const sameDc = checks.every(
    (option) =>
      option.dc === first.dc && option.label.endsWith(String(first.dc)),
  );

  if (!sameDc) {
    return checks
      .map((option) => option.label)
      .join(ESCAPE_LABEL_PARTS.skillsJoiner);
  }

  const suffix = `${ESCAPE_LABEL_PARTS.dcPrefix}${first.dc}`;

  const names = checks.map((option) => option.label.slice(0, -suffix.length));

  return `${names.join(ESCAPE_LABEL_PARTS.skillsJoiner)}${suffix}`;
}

/**
 * Подпись цены действия: «Действие», «Перемещение 5 фт».
 *
 * @param cost - цена; нет — без затрат
 * @param moveCostFeet - сколько футов стоит цена `move`
 * @returns подпись цены
 */
export function formatEffectActionCost(
  cost: EffectActionCost | undefined,
  moveCostFeet?: number,
): string {
  if (!cost) {
    return EFFECT_ACTION_COST_LABELS.free;
  }

  if (!actionCostTakesFeet(cost)) {
    return EFFECT_ACTION_COST_LABELS[cost];
  }

  const feet = moveCostFeet ?? DEFAULT_EFFECT_MOVE_COST_FEET;

  return `${EFFECT_ACTION_COST_LABELS.move} ${feet} фт`;
}

/**
 * Что снимает успех: сам эффект или наложенные им состояния.
 *
 * Обратной ссылки «состояние → наложивший его эффект» в данных нет, поэтому
 * «снять состояние» опирается на каст: у эффектов одного каста общий
 * `castId`. Без каста снимается сам эффект — иначе успех не снял бы ничего.
 *
 * @param effect - эффект с действием
 * @param carrierEffects - все эффекты носителя
 * @returns идентификаторы эффектов, которые снимает успех
 */
export function listEffectEscapeRemovals(
  effect: ActiveEffect,
  carrierEffects: readonly ActiveEffect[],
): string[] {
  const outcome = effect.escape?.onSuccess ?? DEFAULT_ESCAPE_OUTCOME;

  if (outcome === 'removeSelf' || !effect.castId) {
    return [effect.id];
  }

  const conditions = carrierEffects
    .filter(
      (entry) =>
        entry.castId === effect.castId && entry.conditionKey !== undefined,
    )
    .map((entry) => entry.id);

  return conditions.length > 0 ? conditions : [effect.id];
}
