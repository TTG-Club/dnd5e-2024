/**
 * Дары варианта умения класса: манёвр, воззвание, инфузия.
 *
 * Вариант выдаёт листу то же, что и само умение, — владения, правки, ресурсы,
 * заклинания, вопросы игроку, — но только пока он выбран. Отсюда две задачи,
 * которых у самого умения нет и которые решаются здесь.
 *
 * Первая: у каждого варианта свой набор ключей выбора, и набирают их авторы
 * независимо. Два манёвра, каждый со своим «выбери навык», приходят из
 * справочника с одинаковым ключом `skill` — лист спросил бы один вопрос на
 * двоих и записал бы обоим один ответ. Поэтому ключи варианта сужаются до его
 * области ({@link classOptionChoiceScope}) прежде, чем попасть листу.
 *
 * Вторая: ответ игрока на вопрос варианта, от которого он отказался, во
 * владения попасть не должен. Дары собираются только у ВЫБРАННЫХ вариантов —
 * {@link collectClassOptionGrants}.
 */

import type { ActiveEffect } from './activeEffectTypes.js';
import type { ClassFeature, ClassFeatureChoice } from './classTypes.js';
import type { FeatChoice, FeatData } from './featTypes.js';

import { FEAT_CHOICE_TYPE_LABELS } from './featChoices.js';

/**
 * Приставка ключей выбора, заданных вариантом умения. По ней вопрос варианта
 * отличают от вопроса самого умения — например, чтобы не спрашивать его дважды.
 */
export const CLASS_OPTION_CHOICE_PREFIX = 'classOption:';

/**
 * Область ключей выбора одного варианта умения.
 *
 * В область входит и ключ умения: один и тот же вариант (`defense` боевого
 * стиля) встречается у разных умений, и без ключа умения их вопросы слиплись бы
 * так же, как вопросы двух манёвров.
 *
 * @param featureKey - ключ умения, которому принадлежит вариант
 * @param optionKey - ключ варианта
 * @returns приставка ключей выбора этого варианта
 */
export function classOptionChoiceScope(
  featureKey: string,
  optionKey: string,
): string {
  return `${classOptionFeatureScope(featureKey)}${optionKey}:`;
}

/**
 * Область ключей выбора ВСЕХ вариантов одного умения.
 *
 * По ней мастер отбирает вопросы вариантов, чтобы задать их прямо в карточке
 * умения, рядом с самим выбором варианта: спрошенные общим списком где-то ниже,
 * они выглядели бы вопросами ниоткуда.
 *
 * @param featureKey - ключ умения
 * @returns приставка ключей выбора любого варианта этого умения
 */
export function classOptionFeatureScope(featureKey: string): string {
  return `${CLASS_OPTION_CHOICE_PREFIX}${featureKey}:`;
}

/**
 * Задан ли выбор вариантом умения, а не самой записью.
 *
 * @param key - ключ выбора
 * @returns `true`, если ключ сужен до области варианта
 */
export function isClassOptionChoiceKey(key: string): boolean {
  return key.startsWith(CLASS_OPTION_CHOICE_PREFIX);
}

/**
 * Сужает один вопрос до области варианта: и сам ключ, и ссылку на чужой ответ
 * внутри фильтра заклинаний — она адресует соседний вопрос ТОГО ЖЕ варианта.
 *
 * @param choice - вопрос из даров варианта
 * @param scope - приставка ключей варианта
 * @param optionName - название варианта для подписи вопроса
 * @returns вопрос с ключами в области варианта
 */
function scopeChoice(
  choice: FeatChoice,
  scope: string,
  optionName: string,
): FeatChoice {
  const scoped: FeatChoice = {
    ...choice,
    key: `${scope}${choice.key}`,
    // Вопрос варианта стоит рядом с вопросами самого умения: без названия
    // варианта игрок не поймёт, чей это «Владение навыком»
    label: optionName
      ? `${optionName}: ${choice.label || FEAT_CHOICE_TYPE_LABELS[choice.type]}`
      : choice.label,
  };

  const fromChoiceKey = choice.spellFilter?.classesFromChoiceKey;

  if (choice.spellFilter && fromChoiceKey) {
    scoped.spellFilter = {
      ...choice.spellFilter,
      classesFromChoiceKey: `${scope}${fromChoiceKey}`,
    };
  }

  return scoped;
}

/**
 * Сужает дары варианта до его области: ключи вопросов и все ссылки на них.
 *
 * Ссылок четыре, и пропустить хоть одну нельзя: повышение характеристик по
 * выбору, защита от урона по выбору, легаси-поле сопротивления и фильтр класса
 * у выбора заклинания — каждая ищет ответ по ключу, и разъехавшись с ним она
 * молча перестаёт находить выбранное.
 *
 * @param featData - дары варианта из справочника
 * @param scope - приставка ключей варианта
 * @param optionName - название варианта для подписей вопросов
 * @returns дары с ключами в области варианта; `undefined` — даров нет
 */
export function scopeClassOptionFeatData(
  featData: FeatData | undefined,
  scope: string,
  optionName: string,
): FeatData | undefined {
  if (!featData) {
    return undefined;
  }

  const scoped: FeatData = { ...featData };

  if (featData.choices?.length) {
    scoped.choices = featData.choices.map((choice) =>
      scopeChoice(choice, scope, optionName),
    );
  }

  if (featData.damageDefenseChoices?.length) {
    scoped.damageDefenseChoices = featData.damageDefenseChoices.map(
      (defense) => ({ ...defense, choiceKey: `${scope}${defense.choiceKey}` }),
    );
  }

  const increaseFromChoiceKey = featData.abilityScoreIncrease?.fromChoiceKey;

  if (featData.abilityScoreIncrease && increaseFromChoiceKey) {
    scoped.abilityScoreIncrease = {
      ...featData.abilityScoreIncrease,
      fromChoiceKey: `${scope}${increaseFromChoiceKey}`,
    };
  }

  const resistanceFromChoiceKey = featData.modifiers?.resistanceFromChoiceKey;

  if (featData.modifiers && resistanceFromChoiceKey) {
    scoped.modifiers = {
      ...featData.modifiers,
      resistanceFromChoiceKey: `${scope}${resistanceFromChoiceKey}`,
    };
  }

  return scoped;
}

/** Дары одного выбранного варианта умения, готовые лечь на лист. */
export interface ClassOptionGrant {
  /** Ключ умения, чей это вариант */
  featureKey: string;
  /** Ключ варианта */
  optionKey: string;
  /** Название варианта: им подписаны вопросы игроку и запись на листе */
  name: string;
  /** Приставка ключей выбора варианта */
  scope: string;
  /**
   * Дары варианта с ключами в его области; `undefined` — вариант выдаёт только
   * эффекты.
   */
  featData?: FeatData;
  /** Активные эффекты варианта; пусто — их у него нет */
  activeEffects: ActiveEffect[];
}

/**
 * Есть ли у варианта своя механика: без неё вариант — просто строка списка, и
 * листу с ним делать нечего.
 *
 * @param option - вариант умения из справочника
 * @returns `true`, если вариант что-то выдаёт листу
 */
export function hasClassOptionGrants(option: ClassFeatureChoice): boolean {
  return Boolean(option.featData) || Boolean(option.activeEffects?.length);
}

/**
 * Дары вариантов умения, ВЫБРАННЫХ игроком.
 *
 * Только выбранных: вариант, от которого игрок отказался, ничего листу не даёт,
 * и его вопросы задавать некому — ответ на них так и остался бы пустым.
 *
 * @param feature - умение класса или подкласса
 * @param selectedKeys - ключи выбранных вариантов этого умения
 * @returns дары выбранных вариантов; пусто — своей механики ни у одного нет
 */
export function collectClassOptionGrants(
  feature: Pick<ClassFeature, 'key' | 'choices'>,
  selectedKeys: ReadonlyArray<string>,
): ClassOptionGrant[] {
  if (selectedKeys.length === 0) {
    return [];
  }

  const chosen = new Set(selectedKeys);

  return (feature.choices ?? []).flatMap((option) => {
    if (!chosen.has(option.key) || !hasClassOptionGrants(option)) {
      return [];
    }

    const scope = classOptionChoiceScope(feature.key, option.key);

    return [
      {
        featureKey: feature.key,
        optionKey: option.key,
        name: option.name,
        scope,
        featData: scopeClassOptionFeatData(option.featData, scope, option.name),
        activeEffects: option.activeEffects ?? [],
      },
    ];
  });
}
