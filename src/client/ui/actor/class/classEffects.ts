import type {
  ActiveEffect,
  ClassDefinition,
  ClassFeature,
  SubclassDefinition,
} from '@vtt/shared/system/dnd.js';

import {
  buildClassEffectId,
  withActivationDefaults,
} from '@vtt/shared/system/dnd.js';

/**
 * Эффекты, заявленные классом, подклассом и их умениями в компендиуме.
 *
 * Живёт отдельным модулем, а не внутри мастера класса: снимает эти эффекты лист
 * персонажа при удалении класса, а ставит — мастер, и общий им нужен один и тот
 * же способ узнать «этот эффект поставил класс».
 */

// Формат id живёт в движке: метку класса читает не только мастер (чтобы снять
// эффекты одного класса), но и пайплайн — по ней он подставляет в формулы
// умения уровень В ЭТОМ классе (`@classLevel`). Одна запись формата на обоих.
// Наружу отсюда идут только те два помощника, которыми пользуется лист: сам
// префикс нужен движку и берётся у него же.
export { buildClassEffectId, isClassEffect } from '@vtt/shared/system/dnd.js';

/**
 * Эффекты, которые класс ставит при взятии первого уровня в нём.
 *
 * Только на первом уровне: это то, что даёт сам класс целиком, и на каждом
 * следующем уровне эффект добавился бы второй копией.
 *
 * @param definition - определение класса
 * @param levelGained - уровень в этом классе, который сейчас берут
 * @returns эффекты класса (пусто, если уровень не первый)
 */
export function collectClassEffects(
  definition: ClassDefinition,
  levelGained: number,
): ActiveEffect[] {
  if (levelGained !== 1) {
    return [];
  }

  return withClassProvenance(definition.activeEffects, definition.key);
}

/**
 * Эффекты, которые подкласс ставит при его выборе.
 *
 * @param definition - определение класса (ради ключа провенанса)
 * @param subclass - выбранный подкласс; `undefined` — подкласс ещё не выбран
 * @param isJustChosen - подкласс выбран именно сейчас, а не был выбран раньше
 * @returns эффекты подкласса
 */
export function collectSubclassEffects(
  definition: ClassDefinition,
  subclass: SubclassDefinition | undefined,
  isJustChosen: boolean,
): ActiveEffect[] {
  if (!subclass || !isJustChosen) {
    return [];
  }

  return withClassProvenance(subclass.activeEffects, definition.key);
}

/**
 * Эффекты умений, полученных на этом уровне.
 *
 * Информационные умения эффектов не ставят — они и в список умений листа не
 * попадают.
 *
 * @param definition - определение класса (ради ключа провенанса)
 * @param features - умения уровня
 * @returns эффекты умений уровня
 */
export function collectFeatureEffects(
  definition: ClassDefinition,
  features: ReadonlyArray<ClassFeature>,
): ActiveEffect[] {
  const collected: ActiveEffect[] = [];

  for (const feature of features) {
    if (feature.isInformationalOnly) {
      continue;
    }

    collected.push(...(feature.activeEffects ?? []));
  }

  return withClassProvenance(collected, definition.key);
}

/**
 * Эффекты вариантов умений, выбранных прямо сейчас.
 *
 * Отдельно от эффектов самих умений: эффект варианта действует, только пока
 * вариант выбран, и в общих эффектах умения достался бы игроку вместе с
 * воззванием, которого он не брал. В id входят и умение, и вариант — у двух
 * умений с одинаково названным вариантом эффекты иначе слиплись бы в один.
 *
 * @param definition - определение класса (ради ключа провенанса)
 * @param grants - дары выбранных вариантов
 * @returns эффекты выбранных вариантов
 */
export function collectClassOptionEffects(
  definition: ClassDefinition,
  grants: ReadonlyArray<{
    featureKey: string;
    optionKey: string;
    activeEffects: ActiveEffect[];
  }>,
): ActiveEffect[] {
  const scoped = grants.flatMap((grant) =>
    grant.activeEffects.map((effect) => ({
      ...effect,
      id: `${grant.featureKey}:${grant.optionKey}:${effect.id}`,
    })),
  );

  return withClassProvenance(scoped, definition.key);
}

/**
 * Проставляет эффектам провенанс класса: свой id, источник и ссылку на класс.
 *
 * @param effects - эффекты записи компендиума
 * @param classKey - ключ класса
 * @returns эффекты, готовые лечь на актора
 */
function withClassProvenance(
  effects: ActiveEffect[] | undefined,
  classKey: string,
): ActiveEffect[] {
  return (effects ?? []).map((effect) => ({
    ...withActivationDefaults(effect),
    id: buildClassEffectId(classKey, effect.id),
    origin: 'feature' as const,
    originId: classKey,
  }));
}

/**
 * Добавляет эффекты класса к уже имеющимся, не создавая вторую копию.
 *
 * Повтор возможен на законных основаниях: мастер уровня можно закрыть и открыть
 * снова, а умение с выбором — переоткрыть. Совпадение по id и означает «этот
 * эффект уже стоит».
 *
 * @param existing - эффекты актёра
 * @param incoming - эффекты, которые ставит класс
 * @returns объединённый список либо исходный, если добавлять нечего
 */
export function mergeClassEffects(
  existing: ReadonlyArray<ActiveEffect>,
  incoming: ReadonlyArray<ActiveEffect>,
): ActiveEffect[] {
  const known = new Set(existing.map((effect) => effect.id));
  const added = incoming.filter((effect) => !known.has(effect.id));

  return [...existing, ...added];
}
