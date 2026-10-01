/**
 * Выборы владельца в условиях и формулах его эффектов.
 *
 * Умение ссылается на выбор, сделанный в другом месте листа: «спасброски
 * против заклинаний существ из вашего Гримуара — с преимуществом», «Сл = 8 +
 * бонус мастерства + модификатор характеристики, увеличенной этой чертой».
 * Значение выбора в эффект заранее не записать — его знает только лист
 * владельца. Поэтому эффект пишет токен, а лист подставляет своё:
 *
 * - `@choice.<ключ>` — значения выбора списком через запятую:
 *   `target.creatureType === "@choice.monster-manual"` становится
 *   `target.creatureType === "undead, fiend"`. Токен стоит там, где словарь
 *   условий ждёт список: тип существа, тип урона;
 * - `@mod.feat` — модификатор характеристики, выбранной в ЭТОЙ черте:
 *   заклинательной (выбор вида «заклинательная характеристика») либо
 *   повышенной чертой. Становится обычным `@mod.cha`.
 *
 * Ответы ищутся сначала у черты, которой принадлежит эффект (`originId`), затем
 * по всему листу: черты, варианты умений класса, выборы класса и вида. Так
 * умение подкласса читает выбор, сделанный в умении базового класса.
 *
 * Подставляет владелец — там же, где уровень своего класса
 * (`classEffectScope.bindOwnerTokens`): при сборе своих эффектов, аур и
 * эффектов, которые он накладывает на других. Аура несёт выбор того, кто её
 * излучает, а не того, кто в неё вошёл.
 *
 * Токен без ответа остаётся как есть: условие с ним словарь не понимает и не
 * выполняет, формула с ним не считается и уступает запасному числу — эффект
 * молчит, а не срабатывает на всех.
 *
 * @module system/dnd/effectChoiceBinding
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { DnDActor, DnDSceneEntity } from './dndEntities.js';
import type {
  EffectTrigger,
  EffectTriggerAction,
  NestedEffectTrigger,
  NestedEffectTriggerAction,
} from './effectTriggerTypes.js';
import type { FeatData } from './featTypes.js';

import { isActorEntity, isRecord } from '@vtt/shared';

import { ActiveEffectSchema } from './activeEffectTypes.js';
import { isClassOptionChoiceKey } from './classFeatureOptions.js';
import { effectUsesToken } from './effectTokenBinding.js';
import { resolveChosenAbilities } from './featChoices.js';
import {
  FEAT_ORIGIN_PREFIX,
  resolveFeatSpellcastingAbility,
} from './featGrants.js';
import { ABILITY_ABBREVIATIONS } from './formulaParser.js';

/** Начало токена выбора: дальше — ключ выбора */
export const CHOICE_TOKEN_PREFIX = '@choice.';

/** Токен модификатора характеристики, выбранной в черте эффекта */
export const FEAT_ABILITY_MOD_TOKEN = '@mod.feat';

/** Токен выбора целиком: ключ — буквы, цифры, `-`, `_`, `#`, `:` */
const CHOICE_TOKEN_PATTERN = /@choice\.([\w#:-]+)/g;

/** Токен модификатора черты целиком: `@mod.feature` — не он */
const FEAT_ABILITY_MOD_PATTERN = /@mod\.feat\b/g;

/** Чем соединяются значения выбора — как списки словаря условий */
const CHOICE_VALUES_SEPARATOR = ', ';

/**
 * Значение, которое можно вписать в условие: ключ справочника, без кавычек и
 * управляющих знаков — иначе оно сломало бы строку условия.
 */
const SAFE_CHOICE_VALUE_PATTERN = /^[\p{L}\p{N} _.#:-]+$/u;

/** Разделитель частей ключа ответа варианта умения */
const CLASS_OPTION_SCOPE_SEPARATOR = ':';

/** Ответы на выборы: ключ выбора → значения */
export type ChoiceAnswers = Record<string, string[]>;

/**
 * Особенность листа с ответами игрока. Базовая особенность ядра о них не
 * знает — их добавляет система, поэтому она читается через тип с
 * необязательными полями.
 */
interface FeatureWithChoices {
  id: string;
  featData?: FeatData;
  choices?: ChoiceAnswers;
}

/**
 * Записывает ответы поверх собранных. Ответ варианта умения класса лежит под
 * ключом с областью (`classOption:<умение>:<вариант>:<ключ>`) — он доступен и
 * под своим коротким ключом, если тот не занят.
 *
 * @param answers - собранные ответы (меняются)
 * @param source - ответы источника
 */
function mergeAnswers(
  answers: ChoiceAnswers,
  source: Record<string, unknown> | undefined,
): void {
  for (const [key, values] of Object.entries(source ?? {})) {
    if (!Array.isArray(values)) {
      continue;
    }

    const texts = values.filter(
      (value): value is string => typeof value === 'string',
    );

    answers[key] = texts;

    if (isClassOptionChoiceKey(key)) {
      const shortKey = key.split(CLASS_OPTION_SCOPE_SEPARATOR).at(-1);

      if (shortKey) {
        answers[shortKey] ??= texts;
      }
    }
  }
}

/**
 * Ответы владельца на все выборы листа: вид, классы, черты и варианты умений.
 * При совпадении ключей побеждает более поздний источник; черты — последние.
 *
 * @param owner - лист персонажа
 * @returns ключ выбора → значения
 */
export function collectOwnerChoiceAnswers(owner: DnDActor): ChoiceAnswers {
  const answers: ChoiceAnswers = {};

  for (const bySource of Object.values(
    owner.system.species?.featDataChoices ?? {},
  )) {
    mergeAnswers(answers, bySource);
  }

  for (const classEntry of owner.system.classes ?? []) {
    mergeAnswers(answers, classEntry.choiceAnswers);
  }

  const features: FeatureWithChoices[] = owner.features ?? [];

  for (const feature of features) {
    mergeAnswers(answers, feature.choices);
  }

  return answers;
}

/**
 * Черта листа, которой принадлежит эффект: по провенансу `feat:<id>` либо по
 * id самой особенности (эффект, заведённый на листе).
 *
 * @param owner - лист персонажа
 * @param effect - эффект
 * @returns особенность либо `undefined`
 */
function findOwningFeature(
  owner: DnDActor,
  effect: Pick<ActiveEffect, 'originId'>,
): FeatureWithChoices | undefined {
  const { originId } = effect;

  if (!originId) {
    return undefined;
  }

  const featureId = originId.startsWith(FEAT_ORIGIN_PREFIX)
    ? originId.slice(FEAT_ORIGIN_PREFIX.length)
    : originId;

  const features: FeatureWithChoices[] = owner.features ?? [];

  return features.find((feature) => feature.id === featureId);
}

/**
 * Сокращение характеристики для токена `@mod.<сокращение>`.
 *
 * @param ability - характеристика
 * @returns сокращение либо `undefined`
 */
function abilityAbbreviation(ability: string): string | undefined {
  return Object.entries(ABILITY_ABBREVIATIONS).find(
    ([, full]) => full === ability,
  )?.[0];
}

/**
 * Токен модификатора характеристики, выбранной в черте: заклинательная
 * характеристика черты либо первая повышенная ею.
 *
 * @param feature - черта листа
 * @returns токен вида `@mod.cha` либо `undefined`, если выбора нет
 */
function resolveFeatAbilityToken(
  feature: FeatureWithChoices | undefined,
): string | undefined {
  if (!feature) {
    return undefined;
  }

  const ability =
    resolveFeatSpellcastingAbility(feature)
    ?? resolveChosenAbilities(feature.featData, feature.choices)[0];

  const abbreviation = ability ? abilityAbbreviation(ability) : undefined;

  return abbreviation ? `@mod.${abbreviation}` : undefined;
}

/**
 * Есть ли токен выбора в строке.
 *
 * @param text - условие или значение
 * @returns `true`, если токен есть
 */
function textMentionsChoice(text: string | undefined): boolean {
  return (
    text !== undefined
    && (text.includes(CHOICE_TOKEN_PREFIX)
      || text.includes(FEAT_ABILITY_MOD_TOKEN))
  );
}

/**
 * Срабатывания, которые несёт на себе состояние, наложенное действием.
 *
 * @param action - действие срабатывания
 * @returns вложенные срабатывания; пусто — их нет
 */
function listNestedTriggers(
  action: EffectTriggerAction | NestedEffectTriggerAction,
): readonly NestedEffectTrigger[] {
  if (action.type !== 'applyCondition') {
    return [];
  }

  return 'triggers' in action ? (action.triggers ?? []) : [];
}

/**
 * Есть ли токен выбора в условиях срабатывания и наложенных им состояний.
 *
 * @param trigger - срабатывание
 * @returns `true`, если токен есть
 */
function triggerMentionsChoice(
  trigger: EffectTrigger | NestedEffectTrigger,
): boolean {
  const { save } = trigger;

  return (
    textMentionsChoice(trigger.condition)
    || textMentionsChoice(trigger.choice?.condition)
    || textMentionsChoice(save?.autoSuccessIf)
    || textMentionsChoice(save?.autoFailIf)
    || (save?.modeIf ?? []).some((rule) => textMentionsChoice(rule.condition))
    || trigger.actions.some((action) =>
      listNestedTriggers(action).some(triggerMentionsChoice),
    )
  );
}

/**
 * Есть ли в эффекте токены выбора. Проверка идёт на каждом сборе эффектов,
 * поэтому смотрит только строки, где токен может стоять: условия эффекта,
 * строк и срабатываний и формулы (`effectUsesToken`).
 *
 * @param effect - эффект
 * @returns `true`, если подставлять есть что
 */
function mentionsChoiceToken(effect: ActiveEffect): boolean {
  return (
    textMentionsChoice(effect.rollCondition)
    || textMentionsChoice(effect.landingCondition)
    || effect.changes.some(
      (change) =>
        textMentionsChoice(change.condition)
        || textMentionsChoice(change.value),
    )
    || (effect.triggers ?? []).some(triggerMentionsChoice)
    || effectUsesToken(effect, FEAT_ABILITY_MOD_TOKEN)
  );
}

/** Подстановка, сделанная для эффекта, и по каким данным листа */
interface BoundChoiceEntry {
  /** Особенности листа на момент подстановки */
  features: unknown;
  /** Классы листа на момент подстановки */
  classes: unknown;
  /** Вид листа на момент подстановки */
  species: unknown;
  /** Эффект с подставленными выборами */
  bound: ActiveEffect;
}

/** Готовые подстановки — по объекту эффекта */
const boundCache = new WeakMap<ActiveEffect, BoundChoiceEntry>();

/**
 * Эффект с выборами владельца вместо токенов.
 *
 * Токены могут стоять в любой строке эффекта — условии броска, условии
 * строки, условии срабатывания, формуле Сл, — поэтому подстановка идёт по
 * записи целиком, а не по перечню полей: новое поле с условием не придётся
 * дописывать сюда.
 *
 * @param effect - эффект с токенами
 * @param owner - лист владельца
 * @param answers - ответы листа
 * @returns эффект с подставленным либо исходный, если подставить нечего
 */
function bindEffectChoices(
  effect: ActiveEffect,
  owner: DnDActor,
  answers: ChoiceAnswers,
): ActiveEffect {
  const feature = findOwningFeature(owner, effect);
  const featAbilityToken = resolveFeatAbilityToken(feature);
  const text = JSON.stringify(effect);

  const replaced = text
    .replaceAll(CHOICE_TOKEN_PATTERN, (token, key: string) => {
      const values = (feature?.choices?.[key] ?? answers[key] ?? []).filter(
        (value) => SAFE_CHOICE_VALUE_PATTERN.test(value),
      );

      return values.length > 0 ? values.join(CHOICE_VALUES_SEPARATOR) : token;
    })
    .replaceAll(
      FEAT_ABILITY_MOD_PATTERN,
      featAbilityToken ?? FEAT_ABILITY_MOD_TOKEN,
    );

  if (replaced === text) {
    return effect;
  }

  const raw: unknown = JSON.parse(replaced);
  const parsed = isRecord(raw) ? ActiveEffectSchema.safeParse(raw) : undefined;

  return parsed?.success ? parsed.data : effect;
}

/**
 * Подставляет выборы владельца в его эффекты. У существа выборов нет, эффект
 * без токенов возвращается тем же объектом.
 *
 * @param effects - эффекты владельца
 * @param owner - владелец
 * @returns эффекты с подставленными выборами
 */
export function bindOwnerChoices(
  effects: readonly ActiveEffect[],
  owner: DnDSceneEntity,
): readonly ActiveEffect[] {
  if (!isActorEntity(owner) || !effects.some(mentionsChoiceToken)) {
    return effects;
  }

  const { features } = owner;
  const { classes, species } = owner.system;

  // Ответы собираются один раз на вызов и только если подстановки нет в запасе
  let answers: ChoiceAnswers | undefined;

  return effects.map((effect) => {
    if (!mentionsChoiceToken(effect)) {
      return effect;
    }

    const cached = boundCache.get(effect);

    if (
      cached?.features === features
      && cached.classes === classes
      && cached.species === species
    ) {
      return cached.bound;
    }

    answers ??= collectOwnerChoiceAnswers(owner);

    const bound = bindEffectChoices(effect, owner, answers);

    boundCache.set(effect, { features, classes, species, bound });

    return bound;
  });
}
