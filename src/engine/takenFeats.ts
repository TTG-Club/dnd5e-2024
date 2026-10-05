/**
 * Черта, которую мастер кладёт на лист, вместе с её собственными вопросами.
 *
 * Черту берут не только перетаскиванием на лист: её выдают мастер уровня
 * (вместо повышения характеристик, выбором умения, перечнем даров) и мастер
 * вида. У перетащенной черты окно выбора обязательно — «Телекинетик» спрашивает
 * характеристику, «Умелый» три навыка. Мастер, который кладёт черту без этих
 * ответов, выдаёт её пустой: ни прибавки, ни характеристики, а умение такой
 * черты считает Сл не от неё. Здесь правило одно на все мастера: что спросить,
 * отвечено ли и как ответы ложатся на черту.
 *
 * @module system/dnd/takenFeats
 */

import type { DnDActor } from './dndEntities.js';
import type { FeatChoicePoolContext } from './featChoices.js';
import type { FeatChoice, FeatData } from './featTypes.js';

import {
  featChoicePendingCount,
  getVisibleFeatChoices,
  prepareFeatChoices,
} from './featChoices.js';
import { resolveFeatChoicesToAsk } from './featGrants.js';

/** Ответы на вопросы взятых черт: ключ ответов черты → ключ выбора → значения */
export type TakenFeatAnswers = Record<string, Record<string, string[]>>;

/** Черта, которую мастер кладёт на лист, и вопросы, которые она задаёт */
export interface TakenFeat<Feat extends { featData?: FeatData | null }> {
  /**
   * Ключ ответов этой черты в состоянии мастера. Несёт и место, откуда черта
   * взята, и её саму: смена черты в том же месте не наследует чужие ответы.
   */
  answersKey: string;
  /** Запись черты */
  feat: Feat;
  /** Собственные вопросы черты в порядке показа; пусто — спрашивать нечего */
  ownChoices: FeatChoice[];
}

/**
 * Собирает взятую мастером черту с её вопросами — теми же, что задаёт окно
 * выбора при перетаскивании черты на лист.
 *
 * @param answersKey - ключ ответов черты в состоянии мастера
 * @param feat - запись черты
 * @param actor - лист персонажа: уровень открывает ступени выборов
 * @returns черта с вопросами
 */
export function buildTakenFeat<Feat extends { featData?: FeatData | null }>(
  answersKey: string,
  feat: Feat,
  actor: DnDActor,
): TakenFeat<Feat> {
  return {
    answersKey,
    feat,
    ownChoices: prepareFeatChoices(
      resolveFeatChoicesToAsk(feat.featData, actor),
    ),
  };
}

/**
 * Отвечены ли все вопросы взятой черты. Проверяются только показанные: выбор
 * заклинания, ждущий ответа про класс, ещё не спрошен. Выбор с пустым пулом
 * незавершённым не считается — выбирать в нём нечего.
 *
 * @param taken - взятая черта
 * @param answers - ответы всех взятых черт
 * @param actor - лист персонажа: по нему сужаются пулы
 * @param context - каталоги, из которых собираются пулы
 * @param proficiencyBonus - бонус мастерства: от него зависит количество
 * @returns `true`, если черту можно класть на лист
 */
export function isTakenFeatAnswered<
  Feat extends { featData?: FeatData | null },
>(
  taken: TakenFeat<Feat>,
  answers: TakenFeatAnswers,
  actor: DnDActor,
  context: Omit<FeatChoicePoolContext, 'selections'> | undefined,
  proficiencyBonus: number,
): boolean {
  const own = answers[taken.answersKey] ?? {};

  return getVisibleFeatChoices(taken.ownChoices, own).every(
    (choice) =>
      featChoicePendingCount(
        choice,
        actor,
        { ...context, selections: own },
        proficiencyBonus,
        own,
      ) === 0,
  );
}

/**
 * Запись черты с ответами игрока — в том виде, в каком её принимает применение
 * черты. Черта без вопросов остаётся как есть: поле `choices` у неё значило бы
 * «выбор сделан», которого никто не делал.
 *
 * @param taken - взятая черта
 * @param answers - ответы всех взятых черт
 * @returns запись черты для применения
 */
export function withTakenFeatAnswers<
  Feat extends { featData?: FeatData | null },
>(
  taken: TakenFeat<Feat>,
  answers: TakenFeatAnswers,
): Feat & { choices?: Record<string, string[]> } {
  if (taken.ownChoices.length === 0) {
    return taken.feat;
  }

  return { ...taken.feat, choices: answers[taken.answersKey] ?? {} };
}
