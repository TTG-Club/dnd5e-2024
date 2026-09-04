/**
 * Чистые хелперы применения «даров» черты к актору.
 *
 * Эти функции используются и редактором черты (предпросмотр), и листом актёра
 * (применение при перетаскивании черты на персонажа и откат при удалении).
 * Применение владений к `system.proficiencies` остаётся на стороне клиента,
 * где доступны типы актора; здесь — только переносимые на актора структуры
 * (заклинания-источники, флаги защит, синтетический эффект черты).
 */

import type { AbilityType, DefensibleDamageType } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectChange,
  EffectFlagKey,
} from './activeEffectTypes.js';
import type { DamageDefenseKind } from './damageConstants.js';
import type { DnDActor } from './dndEntities.js';
import type {
  FeatChoice,
  FeatChoiceOption,
  FeatData,
  FeatHitPointsModifier,
  FeatModifiers,
  FeatSpellListGroup,
} from './featTypes.js';
import type {
  ClassSpellListRequest,
  GrantedSpellSource,
} from './grantedSpells.js';
import type { DamageDefenseEntry, GrantedSpellRef } from './speciesTypes.js';
import type { ActorCounterState } from './types.js';

import { generateId } from '@vtt/shared';

import { calculateAbilityModifier } from './calculations.js';
import { getTotalLevel } from './classTypes.js';
import { ABILITY_OPTIONS, isAbilityType } from './consts.js';
import {
  evaluateCounterMaxFormula,
  progressionCounterMax,
  withCounterMinimum,
} from './counterResource.js';
import {
  ABILITY_INCREASE_CHOICE_KEY,
  openFeatChoicesAtLevel,
} from './featChoices.js';
import { hasSpellcastingFeature } from './featPrerequisites.js';
import { buildFormulaContext } from './formulaParser.js';
import { getMaxSpellSlotLevel } from './spellSlotTable.js';

/**
 * Провенанс эффекта/заклинания, выданного чертой. По `originId === feat:<id>`
 * эффекты черты снимаются при её удалении, не задевая чужие источники.
 */
export const FEAT_ORIGIN_PREFIX = 'feat:';

/**
 * Провенанс даров предыстории. Та же машинерия даров (`buildFeatGrantEffect`,
 * `prepareTransferredFeatEffects`), но с префиксом `background:` — оптовый
 * фильтр `originId.startsWith('background:')` снимает все эффекты предыстории
 * одним проходом при её замене/удалении.
 */
export const BACKGROUND_ORIGIN_PREFIX = 'background:';

/**
 * Стабильный id синтетического эффекта-даров, выведенный из префикса провенанса:
 * `feat:` → `feat-grant:<id>` (как было), `background:` → `background-grant:<id>`.
 *
 * @param featureId - id источника даров (черты на акторе или ключ предыстории)
 * @param originPrefix - префикс провенанса
 */
function grantEffectId(featureId: string, originPrefix: string): string {
  return `${originPrefix.replace(/:$/, '-grant:')}${featureId}`;
}

/**
 * Формула прибавки к максимуму хитов.
 *
 * Слагаемое «за каждый уровень после взятия» пишется формулой с `@level`, а не
 * числом: оно растёт вместе с персонажем, и пересчитывать эффект на каждом
 * повышении уровня не пришлось бы — пайплайн эффектов считает `value` как
 * формулу при каждом обращении к листу.
 *
 * @param modifier - прибавка к хитам из механики черты
 * @param acquisitionLevel - уровень персонажа на момент взятия черты
 * @returns строка формулы или `null`, если прибавки нет
 */
function hitPointsFormula(
  modifier: FeatHitPointsModifier,
  acquisitionLevel: number,
): string | null {
  const parts: string[] = [];

  const flat =
    (modifier.flat ?? 0)
    + (modifier.perAcquisitionLevel ?? 0) * acquisitionLevel;

  if (flat !== 0) {
    parts.push(String(flat));
  }

  const perLevel = modifier.perLevelAfterAcquisition ?? 0;

  if (perLevel !== 0) {
    parts.push(`${perLevel} * (@level - ${acquisitionLevel})`);
  }

  return parts.length > 0 ? parts.join(' + ') : null;
}

/**
 * Разворачивает постоянные модификаторы черты в изменения активного эффекта.
 *
 * Скорость «равна скорости ходьбы» выражается формулой не может: `@`-переменной
 * скорости у пайплайна нет. Такой вид движения ставится режимом `upgrade` от
 * базовой скорости ходьбы персонажа — её передаёт вызывающий; без неё флаг
 * пропускается, чтобы не выставить полёт нулём.
 *
 * @param modifiers - постоянные модификаторы черты
 * @param context - уровень взятия и базовая скорость ходьбы персонажа
 */
function modifierChanges(
  modifiers: FeatModifiers,
  context: FeatGrantContext,
): EffectChange[] {
  const changes: EffectChange[] = [];
  const acquisitionLevel = context.acquisitionLevel ?? 1;

  if (modifiers.hitPoints) {
    const formula = hitPointsFormula(modifiers.hitPoints, acquisitionLevel);

    if (formula) {
      changes.push({
        key: 'hitPoints.max',
        mode: 'add',
        value: formula,
        priority: 20,
      });
    }
  }

  const speed = modifiers.speed;

  if (speed) {
    if (speed.walkBonus) {
      changes.push({
        key: 'movement.walk',
        mode: 'add',
        value: String(speed.walkBonus),
        priority: 20,
      });
    }

    for (const type of ['fly', 'climb', 'swim'] as const) {
      const explicit = speed[type];

      const equalsWalk =
        speed[
          `${type}EqualsWalk` as
            'flyEqualsWalk' | 'climbEqualsWalk' | 'swimEqualsWalk'
        ];

      const value = explicit ?? (equalsWalk ? context.walkSpeed : undefined);

      if (value) {
        changes.push({
          key: `movement.${type}`,
          mode: 'upgrade',
          value: String(value),
          priority: 20,
        });
      }
    }
  }

  if (modifiers.armorClassBonus) {
    changes.push({
      key: 'armorClass',
      mode: 'add',
      value: String(modifiers.armorClassBonus),
      priority: 20,
    });
  }

  if (modifiers.initiativeProficiencyBonus) {
    changes.push({
      key: 'initiative',
      mode: 'add',
      value: '@prof',
      priority: 20,
    });
  }

  if (modifiers.initiativeBonus) {
    changes.push({
      key: 'initiative',
      mode: 'add',
      value: String(modifiers.initiativeBonus),
      priority: 20,
    });
  }

  return changes;
}

/** Презентация синтетического эффекта-даров (по умолчанию — черта). */
export interface GrantEffectPresentation {
  /** Префикс провенанса (`originId`). По умолчанию `feat:`. */
  originPrefix?: string;
  /** Префикс имени эффекта («Черта», «Предыстория»). По умолчанию «Черта». */
  namePrefix?: string;
  /** Существительное в род. падеже для описания («черты», «предыстории»). */
  noun?: string;
  /** Иконка эффекта. По умолчанию `tabler:star`. */
  icon?: string;
}

/**
 * Числа персонажа, без которых постоянные модификаторы черты не развернуть.
 * Передаются на применении: движок даров актора не видит.
 */
export interface FeatGrantContext {
  /**
   * Суммарный уровень персонажа на момент взятия черты — основа прибавки к
   * хитам. Не передан — считается первым уровнем.
   */
  acquisitionLevel?: number;
  /**
   * Базовая скорость ходьбы персонажа: от неё берутся виды движения, заданные
   * флагом «равна скорости ходьбы». Не передана — такие флаги пропускаются.
   */
  walkSpeed?: number;
  /**
   * Защиты от урона, которые дал ответ игрока
   * ({@code damageDefenseChoices}). До выбора черта не знает, к какому типу даёт
   * защиту, поэтому в её дарах таких защит нет.
   */
  chosenDamageDefenses?: DamageDefenseEntry[];
  /**
   * Характеристики, выбранные игроком для повышения
   * ({@code abilityScoreIncrease.fromChoiceKey}) — так устроен «Устойчивый».
   */
  chosenAbilities?: string[];
}

/**
 * Формирует `originId` эффектов, принадлежащих источнику даров.
 *
 * @param featureId - id источника (черты на акторе или ключ предыстории)
 * @param originPrefix - префикс провенанса (по умолчанию `feat:`)
 */
export function featOriginId(
  featureId: string,
  originPrefix: string = FEAT_ORIGIN_PREFIX,
): string {
  return `${originPrefix}${featureId}`;
}

/**
 * Принадлежит ли активный эффект указанному источнику даров.
 *
 * @param effect - активный эффект
 * @param featureId - id источника даров
 * @param originPrefix - префикс провенанса (по умолчанию `feat:`)
 */
export function isFeatOwnedEffect(
  effect: ActiveEffect,
  featureId: string,
  originPrefix: string = FEAT_ORIGIN_PREFIX,
): boolean {
  return effect.originId === featOriginId(featureId, originPrefix);
}

/**
 * Заклинательная характеристика заклинаний черты.
 *
 * Задать её черта может двумя путями: назвать прямо (тогда она в дарах) или спросить
 * игрока — так устроен «Посвящённый в магию», где характеристику выбирают вместе со
 * списком класса. Ответ игрока и есть характеристика, иначе выбор ни на что не влиял бы.
 *
 * Ничего не задано — заклинание считается от характеристики листа, как остальные.
 *
 * @param feat - черта с дарами и ответами игрока
 * @param feat.featData - блоб даров черты
 * @param feat.choices - ответы игрока: ключ выбора → значения
 */
function resolveFeatSpellcastingAbility(feat: {
  featData?: FeatData | null;
  choices?: Record<string, string[]>;
}): AbilityType | undefined {
  if (feat.featData?.spellcastingAbility) {
    return feat.featData.spellcastingAbility;
  }

  for (const choice of feat.featData?.choices ?? []) {
    if (choice.type !== 'spellcastingAbility') {
      continue;
    }

    const answer = feat.choices?.[choice.key]?.[0];

    if (answer && isAbilityType(answer)) {
      return answer;
    }
  }

  return undefined;
}

/**
 * Собирает заклинания, которые запись даёт знать: перечисленные записью,
 * выбранные игроком и открытые уровнем персонажа.
 *
 * @param feat - запись с её `featData` и ответами игрока
 * @param feat.name - имя записи: им подписан источник выдачи и отката
 * @param feat.featData - блок даров записи с выдаваемыми заклинаниями
 * @param feat.choices - ответы игрока: ключ выбора → значения
 * @param actor - персонаж: по его уровню отбираются поуровневые группы выдачи
 * @returns источники заклинаний без повторов, в порядке появления
 */
export function collectFeatGrantedSpellSources(
  feat: {
    name: string;
    featData?: FeatData | null;
    choices?: Record<string, string[]>;
  },
  actor?: DnDActor | null,
): GrantedSpellSource[] {
  const sources: GrantedSpellSource[] = [];
  const seenSpellIds = new Set<string>();
  const castingAbility = resolveFeatSpellcastingAbility(feat);

  const characterLevel = actor
    ? getTotalLevel(actor.system.classes)
    : undefined;

  const push = (
    spellId: string | undefined,
    packId?: string,
    // Значения группы выдачи: они старше значений записи — ради того группа и
    // заводится, чтобы один набор заклинаний считался не так, как другой
    group?: { alwaysPrepared?: boolean; spellcastingAbility?: AbilityType },
  ): void => {
    if (!spellId || seenSpellIds.has(spellId)) {
      return;
    }

    seenSpellIds.add(spellId);

    sources.push({
      spellId,
      featureName: feat.name,
      packId,
      alwaysPrepared:
        group?.alwaysPrepared ?? feat.featData?.grantedSpellsAlwaysPrepared,
      castingAbility: group?.spellcastingAbility ?? castingAbility,
    });
  };

  for (const ref of feat.featData?.grantedSpells ?? []) {
    if (isSpellUnlocked(ref.requiredLevel, characterLevel)) {
      push(ref.spellId, ref.packId, ref);
    }
  }

  // Выбранное заклинание — такое же выданное: значение варианта и есть id записи
  // компендиума, по нему заклинание и кладётся в книгу. Выбор с уровнем открытия
  // выдаёт своё не раньше срока: ответ на него мог сохраниться заранее
  for (const choice of feat.featData?.choices ?? []) {
    if (choice.type !== 'spell' && choice.type !== 'cantrip') {
      continue;
    }

    if (!isSpellUnlocked(choice.requiredLevel, characterLevel)) {
      continue;
    }

    for (const spellId of feat.choices?.[choice.key] ?? []) {
      push(spellId);
    }
  }

  // Расширение списка заклинаний класса сюда не идёт: это доступность, а не
  // знание — его показывает окно выбора заклинаний
  // ({@link collectActorSpellListExpansions})

  return sources;
}

/**
 * Собирает запросы «выдать весь список класса» из `featData`.
 *
 * Сами заклинания здесь не подбираются: каталог грузится лениво и только там, где
 * выдача действительно применяется, — а сборщик работает и без него, в мастерах и на
 * дропе. Разворачивает запросы {@link expandClassSpellRequests}.
 *
 * Уровень персонажа режет и открытие группы, и круг: у группы «не выше доступного
 * круга» верхняя граница берётся из ячеек листа, поэтому список сам растёт при
 * повышении уровня. Листа нет (черту применяют вне персонажа — например, мастером
 * предыстории) — граница не ставится: потерять заклинание насовсем хуже, чем выдать
 * его раньше срока.
 *
 * @param feat - черта (имя-источник + блоб даров + ответы игрока)
 * @param feat.name - имя черты (источник при выдаче/откате)
 * @param feat.featData - блоб даров черты со списками классов
 * @param feat.choices - ответы игрока: из них берётся заклинательная характеристика
 * @param actor - лист персонажа: его уровень и ячейки решают, что уже открыто
 */
export function collectFeatGrantedClassSpellRequests(
  feat: {
    name: string;
    featData?: FeatData | null;
    choices?: Record<string, string[]>;
  },
  actor?: DnDActor | null,
): ClassSpellListRequest[] {
  const groups = feat.featData?.grantedClassSpells ?? [];

  if (groups.length === 0) {
    return [];
  }

  const castingAbility = resolveFeatSpellcastingAbility(feat);

  const characterLevel = actor
    ? getTotalLevel(actor.system.classes)
    : undefined;

  const maxSlotLevel = actor ? getMaxSpellSlotLevel(actor) : undefined;

  const requests: ClassSpellListRequest[] = [];

  for (const group of groups) {
    if (!isSpellUnlocked(group.requiredLevel, characterLevel)) {
      continue;
    }

    const classKeys = (group.classKeys ?? []).filter(Boolean);

    if (classKeys.length === 0) {
      continue;
    }

    requests.push({
      classKeys,
      featureName: feat.name,
      spellPackIds: group.spellPackIds,
      level: group.level,
      maxLevel: group.fromSlots ? maxSlotLevel : group.maxLevel,
      // Значения группы старше значений записи — см. {@link collectFeatGrantedSpellSources}
      alwaysPrepared:
        group.alwaysPrepared ?? feat.featData?.grantedSpellsAlwaysPrepared,
      castingAbility: group.spellcastingAbility ?? castingAbility,
    });
  }

  return requests;
}

/**
 * Доступен ли дар с уровнем доступа на текущем уровне персонажа.
 *
 * Уровень персонажа неизвестен (черту применяют вне листа — например, мастером
 * предыстории) — дар считается доступным: потерять заклинание насовсем хуже,
 * чем выдать его раньше срока.
 *
 * @param requiredLevel - уровень, с которого дар доступен
 * @param characterLevel - суммарный уровень персонажа
 */
function isSpellUnlocked(
  requiredLevel: number | undefined,
  characterLevel: number | undefined,
): boolean {
  if (!requiredLevel || requiredLevel <= 1) {
    return true;
  }

  return characterLevel === undefined || requiredLevel <= characterLevel;
}

/**
 * Особенность листа с дарами. Базовый `Feature` о `featData` и ответах игрока не
 * знает — их добавляет система, — поэтому особенность читается через тип с
 * необязательными полями. Тот же приём, что в `actorSenses.ts`.
 */
interface FeatureWithGrants {
  id: string;
  featData?: FeatData;
  /** Ответы игрока: от них зависит `@mod.spell` в максимуме ресурса */
  choices?: Record<string, string[]>;
}

/**
 * Ссылка на заклинание, у которой есть связь с записью компендиума. Без `spellId`
 * заклинание не выдать и не показать вариантом выбора — такие ссылки отсеиваются
 * заранее, и дальше по коду поле уже обязательное.
 */
interface LinkedSpellRef extends GrantedSpellRef {
  spellId: string;
}

/** Связана ли ссылка с записью компендиума. */
function isLinkedSpellRef(ref: GrantedSpellRef): ref is LinkedSpellRef {
  return Boolean(ref.spellId);
}

/** Открытая ступень расширенного списка заклинаний. */
export interface OpenFeatSpellListGroup {
  /** Сама ступень */
  group: FeatSpellListGroup;
  /** Заклинания ступени, связанные с компендиумом */
  spells: LinkedSpellRef[];
}

/**
 * Ступени расширенного списка, открытые персонажу прямо сейчас.
 *
 * Закрывают ступень две вещи: уровень доступа выше текущего и требование
 * заклинательства у всей таблицы (черты метки дракона расширяют список,
 * только если есть «Использование заклинаний» или «Магия договора»).
 *
 * @param featData - блоб даров черты
 * @param actor - лист персонажа: его уровень и умения решают, что открыто
 * @returns открытые ступени в порядке записи; пусто — расширять нечего
 */
export function collectOpenFeatSpellListGroups(
  featData: FeatData | null | undefined,
  actor: DnDActor,
): OpenFeatSpellListGroup[] {
  const expansion = featData?.spellList;

  if (!expansion?.groups?.length) {
    return [];
  }

  if (expansion.requiresSpellcasting && !hasSpellcastingFeature(actor)) {
    return [];
  }

  const characterLevel = getTotalLevel(actor.system.classes);
  const open: OpenFeatSpellListGroup[] = [];

  // Прежнее «сколько берут» из ступени не читается: расширение — доступность, а
  // не выбор, и весь открытый список просто становится доступен для подготовки
  for (const group of expansion.groups) {
    if (!isSpellUnlocked(group.requiredLevel, characterLevel)) {
      continue;
    }

    const spells = (group.spells ?? []).filter(isLinkedSpellRef);

    if (spells.length === 0) {
      continue;
    }

    open.push({ group, spells });
  }

  return open;
}

/** Заклинание, доступное персонажу сверх списка класса, — из расширения списка записи. */
export interface SpellListExpansionEntry {
  /** ID заклинания в компендиуме */
  spellId: string;
  /** Предпочтённый пак-компендиум (id манифеста) */
  packId?: string;
  /** Название из записи — на случай, если компендиум ещё не загружен */
  name: string;
  /** Запись листа, открывшая заклинание */
  featureName: string;
}

/**
 * Заклинания, доступные персонажу сверх списка его класса: открытые ступени
 * расширений от черт, вида, предыстории и умений класса, записанных на лист.
 *
 * Персонаж их не знает — окно выбора заклинаний показывает их рядом с
 * классовыми, и в книгу они попадают выбором игрока, как любое заклинание
 * класса. Одно и то же заклинание из двух записей идёт один раз.
 *
 * @param actor - лист персонажа: его уровень и умения решают, что открыто
 * @returns заклинания расширенного списка; пусто — расширять нечем
 */
export function collectActorSpellListExpansions(
  actor: DnDActor,
): SpellListExpansionEntry[] {
  const result: SpellListExpansionEntry[] = [];
  const seen = new Set<string>();

  for (const feature of actor.features ?? []) {
    const applied: FeatureWithGrants = feature;

    for (const open of collectOpenFeatSpellListGroups(
      applied.featData,
      actor,
    )) {
      for (const ref of open.spells) {
        if (seen.has(ref.spellId)) {
          continue;
        }

        seen.add(ref.spellId);

        result.push({
          spellId: ref.spellId,
          packId: ref.packId,
          name: ref.name,
          featureName: feature.name,
        });
      }
    }
  }

  return result;
}

/**
 * Ответы игрока по ВСЕМ чертам листа: ключ выбора → выбранные значения.
 *
 * Нужны повышению, привязанному к выбору ДРУГОЙ черты: «Мощная метка дракона»
 * поднимает ту характеристику, которую игрок назвал заклинательной у своей
 * метки, и в её собственных ответах этого ключа нет. Ответы самой черты
 * вызывающий дописывает поверх — свой ключ всегда главнее чужого.
 *
 * @param actor - лист персонажа
 * @returns объединённые ответы; при совпадении ключей побеждает последняя черта
 */
export function collectActorFeatChoiceAnswers(
  actor: DnDActor,
): Record<string, string[]> {
  const answers: Record<string, string[]> = {};
  const features: FeatureWithGrants[] = actor.features ?? [];

  for (const feature of features) {
    for (const [key, values] of Object.entries(feature.choices ?? {})) {
      answers[key] = values;
    }
  }

  return answers;
}

/** Черта листа, у которой прямо сейчас есть незаданный выбор. */
export interface FeatAwaitingChoices {
  /** Id особенности-черты на акторе */
  featureId: string;
  /** Название черты — в заголовке окна */
  featureName: string;
  /** Выборы, ждущие ответа */
  choices: FeatChoice[];
}

/**
 * Черты листа, у которых на новом уровне открылся выбор, ещё не отвеченный.
 *
 * Спрашивать приходится повторно, потому что выбор бывает с уровнем открытия:
 * при взятии черты игрок ответил на то, что было доступно, а выбор «с 5 уровня»
 * появился только сейчас. Берутся ТОЛЬКО выборы с уровнем или ступенями: то, что
 * спрашивали при взятии и оставили пустым, — решение игрока, а не пропуск.
 *
 * @param actor - лист персонажа с уже обновлённым уровнем
 * @returns черты с незаданными выборами; пусто — спрашивать нечего
 */
export function collectFeatsAwaitingLeveledChoices(
  actor: DnDActor,
): FeatAwaitingChoices[] {
  const level = getTotalLevel(actor.system.classes);
  const result: FeatAwaitingChoices[] = [];

  for (const feature of actor.features ?? []) {
    const applied: FeatureWithGrants = feature;
    const source = applied.featData?.choices ?? [];

    const leveledKeys = new Set(
      source
        .filter(
          (choice) =>
            (choice.requiredLevel !== undefined && choice.requiredLevel > 1)
            || Object.keys(choice.scaling ?? {}).length > 0,
        )
        .map((choice) => choice.key),
    );

    if (leveledKeys.size === 0) {
      continue;
    }

    const choices = openFeatChoicesAtLevel(source, level).filter(
      (choice) =>
        leveledKeys.has(choice.key)
        && (applied.choices?.[choice.key]?.length ?? 0) < (choice.count ?? 1),
    );

    if (choices.length > 0) {
      result.push({
        featureId: feature.id,
        featureName: feature.name,
        choices,
      });
    }
  }

  return result;
}

/** Подпись выбора характеристики: игрок видит её вместо машинного ключа. */
const ABILITY_INCREASE_CHOICE_LABEL = 'Повышение характеристики';

/**
 * Выбор характеристики, который лист заводит сам под повышение «на выбор».
 *
 * Записи компендиума описывают «+1 к Силе или Телосложению» одним
 * `abilityScoreIncrease.choice` и НЕ ссылаются на строку выбора: у большинства
 * черт 2024 повышение и есть весь выбор. Само по себе такое повышение движок не
 * применяет ({@link resolveChosenAbilities} ждёт ответ игрока), поэтому вопрос
 * лист задаёт сам — иначе «+1 к характеристике» молча не срабатывал бы.
 *
 * Привязанное повышение («Устойчивый» поднимает ту характеристику, спасбросками
 * которой овладел) сюда не попадает: его характеристика приходит из ответа на
 * ЧУЖОЙ выбор, и спрашивать её второй раз незачем.
 *
 * @param featData - блоб даров черты
 * @returns выбор характеристики либо `null`, если спрашивать нечего
 */
export function collectFeatAbilityIncreaseChoice(
  featData: FeatData | null | undefined,
): FeatChoice | null {
  const increase = featData?.abilityScoreIncrease;
  const choice = increase?.choice;

  if (!choice || increase?.fromChoiceKey) {
    return null;
  }

  const amount = choice.amount ?? 1;
  const count = choice.count > 0 ? choice.count : 1;

  const options: FeatChoiceOption[] = (choice.from ?? []).map((ability) => ({
    value: ability,
  }));

  return {
    key: ABILITY_INCREASE_CHOICE_KEY,
    type: 'ability',
    label: `${ABILITY_INCREASE_CHOICE_LABEL} (+${amount})`,
    count,
    // Пустой набор означает «любая характеристика» — пул соберёт справочник
    ...(options.length > 0 ? { options } : {}),
  };
}

/**
 * Все выборы, на которые черта ждёт ответа прямо сейчас: заданные автором и
 * открытые на уровне персонажа плюс заведённый листом выбор под повышение
 * характеристики. Выбор с уровнем открытия выше текущего отложен — его спросит
 * повышение уровня ({@link collectFeatsAwaitingLeveledChoices}).
 *
 * @param featData - блоб даров черты
 * @param actor - лист персонажа
 */
export function resolveFeatChoicesToAsk(
  featData: FeatData | null | undefined,
  actor: DnDActor,
): FeatChoice[] {
  const abilityChoice = collectFeatAbilityIncreaseChoice(featData);

  return [
    ...openFeatChoicesAtLevel(
      featData?.choices,
      getTotalLevel(actor.system.classes),
    ),
    ...(abilityChoice ? [abilityChoice] : []),
  ];
}

/**
 * Собирает флаги защит от урона (`resistance/immunity/vulnerability.<type>`) из
 * даров черты. Дедуп по типу урона: для типа берётся последний заданный вид.
 *
 * @param featData - блоб даров черты
 */
export function collectFeatDamageDefenseFlags(
  featData: FeatData | null | undefined,
): EffectFlagKey[] {
  const kindByType = new Map<DefensibleDamageType, DamageDefenseKind>();

  for (const entry of featData?.damageDefenses ?? []) {
    kindByType.set(entry.damageType, entry.kind);
  }

  const flags: EffectFlagKey[] = [];

  for (const [damageType, kind] of kindByType) {
    flags.push(`${kind}.${damageType}`);
  }

  return flags;
}

/**
 * Строит синтетический пассивный эффект даров черты: фиксированное повышение
 * характеристик (`ability.* add`), флаги защит от урона и иммунитеты к
 * состояниям. Возвращает `null`, если черта ничего из этого не даёт.
 *
 * Прибавка характеристик «на выбор» (`abilityScoreIncrease.choice`) сюда НЕ
 * входит — она требует выбора игрока и применяется отдельно.
 *
 * @param featureId - id примененной черты на акторе (для провенанса/отката)
 * @param featName - имя черты (для названия эффекта)
 * @param featData - блоб даров черты
 * @param presentation - провенанс и подписи (по умолчанию — черта)
 */
export function buildFeatGrantEffect(
  featureId: string,
  featName: string,
  featData: FeatData | null | undefined,
  presentation: GrantEffectPresentation = {},
  context: FeatGrantContext = {},
): ActiveEffect | null {
  const {
    originPrefix = FEAT_ORIGIN_PREFIX,
    namePrefix = 'Черта',
    noun = 'черты',
    icon = 'tabler:star',
  } = presentation;

  const changes: EffectChange[] = [];

  for (const { value: ability } of ABILITY_OPTIONS) {
    const bonus = featData?.abilityScoreIncrease?.fixed?.[ability];

    if (typeof bonus === 'number' && bonus !== 0) {
      changes.push({
        key: `ability.${ability}`,
        mode: 'add',
        value: String(bonus),
        priority: 20,
      });
    }
  }

  if (featData?.modifiers) {
    changes.push(...modifierChanges(featData.modifiers, context));
  }

  const flags = collectFeatDamageDefenseFlags(featData);

  // Защита по выбору: тип урона известен только после того, как игрок выбрал,
  // поэтому в дарах черты его нет — он приходит контекстом применения уже
  // сверенным со справочником (см. `resolveChosenDamageDefenses`)
  for (const defense of context.chosenDamageDefenses ?? []) {
    const flag: EffectFlagKey = `${defense.kind}.${defense.damageType}`;

    if (!flags.includes(flag)) {
      flags.push(flag);
    }
  }

  // Повышение выбранной характеристики («Устойчивый» поднимает ту, спасбросками
  // которой овладел): само число берётся из описания повышения
  const chosenAmount = featData?.abilityScoreIncrease?.choice?.amount ?? 1;

  for (const ability of context.chosenAbilities ?? []) {
    // Характеристика тоже приходит строкой выбора — сверяем со справочником
    if (!isAbilityType(ability)) {
      continue;
    }

    changes.push({
      key: `ability.${ability}`,
      mode: 'add',
      value: String(chosenAmount),
      priority: 20,
    });
  }

  const conditionImmunities = featData?.conditionImmunities ?? [];

  if (
    changes.length === 0
    && flags.length === 0
    && conditionImmunities.length === 0
  ) {
    return null;
  }

  const effect: ActiveEffect = {
    id: grantEffectId(featureId, originPrefix),
    name: `${namePrefix}: ${featName}`,
    description: `Дары ${noun} «${featName}».`,
    icon,
    disabled: false,
    origin: 'feature',
    originId: featOriginId(featureId, originPrefix),
    transfer: false,
    duration: { type: 'permanent' },
    changes,
    flags,
  };

  if (conditionImmunities.length > 0) {
    effect.conditionImmunities = [...conditionImmunities];
  }

  return effect;
}

/**
 * Готовит активные эффекты, авторски заданные на черте, к переносу на актора:
 * каждому эффекту выдаётся новый id и провенанс черты (`originId = feat:<id>`),
 * `transfer` сбрасывается (на акторе эффект уже «развёрнут»). Отключённые
 * (`disabled`) эффекты сохраняются как есть — игрок может включить их позже.
 *
 * @param featureId - id примененной черты на акторе
 * @param authoredEffects - активные эффекты, заданные на черте (GameItem.activeEffects)
 * @param originPrefix - префикс провенанса (по умолчанию `feat:`)
 */
export function prepareTransferredFeatEffects(
  featureId: string,
  authoredEffects: ReadonlyArray<ActiveEffect> | undefined,
  originPrefix: string = FEAT_ORIGIN_PREFIX,
): ActiveEffect[] {
  return (authoredEffects ?? []).map((effect) => ({
    ...effect,
    id: generateId('effect'),
    origin: 'feature',
    originId: featOriginId(featureId, originPrefix),
    transfer: false,
  }));
}

/**
 * Ресурсы черты в виде состояний счётчиков на акторе.
 *
 * Максимум считается формулой (`@prof` у «Удачливого»), поэтому пересчитывается
 * при каждой выдаче и при повышении уровня — иначе очки удачи застряли бы на
 * значении, посчитанном в момент взятия черты. Текущий остаток сохраняется, если
 * счётчик уже был на акторе: пересчёт максимума не должен восполнять потраченное.
 *
 * Название и способ восстановления кладутся прямо в состояние: определения
 * черты у панели счётчиков нет, и без них ресурс подписывался бы ключом.
 *
 * @param feat - особенность-черта на акторе
 * @param feat.id - id особенности: по нему ресурс снимается вместе с чертой
 * @param feat.featData - блоб даров черты
 * @param feat.choices - ответы игрока (нужны `@mod.spell` в максимуме)
 * @param actor - лист персонажа (для `@prof`, `@level`, модификаторов)
 * @param existing - счётчики, уже стоящие на акторе (для сохранения остатка)
 * @returns состояния счётчиков черты; пусто — ресурсов у неё нет
 */
export function buildFeatCounters(
  feat: {
    id: string;
    featData?: FeatData | null;
    choices?: Record<string, string[]>;
  },
  actor: DnDActor,
  existing: ReadonlyArray<ActorCounterState> = [],
): ActorCounterState[] {
  const definitions = feat.featData?.counters ?? [];

  if (definitions.length === 0) {
    return [];
  }

  const characterLevel = getTotalLevel(actor.system.classes);

  const context = {
    ...buildFormulaContext(actor),
    // `@mod.spell` в максимуме («Вознесение лича» — по заклинательной
    // характеристике): вне контекста заклинания движок его не знает, а у черты
    // характеристика есть — своя, спрошенная у игрока либо от класса
    spellMod: featSpellcastingModifier(feat, actor),
  };

  return definitions
    .filter((definition) => definition.key.trim().length > 0)
    .map((definition) => {
      // Ступени старше формулы: ряд, который формулой не пишется, задан ими
      // самими. Считаются от уровня персонажа — у записи своего уровня нет
      const max = definition.progression
        ? withCounterMinimum(
            progressionCounterMax(definition.progression, characterLevel),
            definition.min,
          )
        : // Тот же расчёт, что у своих ресурсов листа: кривая формула читается
          // нулём, иначе персонаж остался бы без всей черты из-за одной опечатки
          withCounterMinimum(
            evaluateCounterMaxFormula(definition.max, context),
            definition.min,
          );

      const previous = existing.find(
        (counter) =>
          counter.featureId === feat.id
          && counter.counterKey === definition.key,
      );

      return {
        counterKey: definition.key,
        featureId: feat.id,
        name: definition.name,
        shortName: definition.shortName,
        recovery: definition.recovery,
        // Формула и граница живут на счётчике: отдых пересчитывает максимум по
        // ним, не заглядывая в определение черты. У ступеней формулы нет —
        // отдых берёт посчитанный максимум как есть, как и у счётчика класса
        ...(definition.progression ? {} : { maxFormula: definition.max }),
        ...(definition.min ? { min: definition.min } : {}),
        current: previous ? Math.min(previous.current, max) : max,
        max,
      };
    });
}

/**
 * Модификатор заклинательной характеристики черты — для `@mod.spell`.
 *
 * Своя характеристика черты главнее классовой: «Вознесение лича» спрашивает её у
 * игрока, и ресурс обязан считаться от того, что он ответил. Нет ни своей, ни
 * классовой — модификатора нет, и формула с `@mod.spell` останется ошибкой,
 * а ресурс нулём: выдумывать характеристику хуже, чем показать ноль.
 *
 * @param feat - черта с дарами и ответами игрока
 * @param feat.featData - блоб даров черты
 * @param feat.choices - ответы игрока: ключ выбора → значения
 * @param actor - лист персонажа
 */
function featSpellcastingModifier(
  feat: { featData?: FeatData | null; choices?: Record<string, string[]> },
  actor: DnDActor,
): number | undefined {
  const casterClass = (actor.system.classes ?? []).find(
    (entry) => entry.spellcastingAbility,
  );

  const ability =
    resolveFeatSpellcastingAbility(feat) ?? casterClass?.spellcastingAbility;

  if (!ability) {
    return undefined;
  }

  return calculateAbilityModifier(actor.system.abilities[ability] ?? 10);
}

/**
 * Пересчитывает ресурсы всех черт актора, сохраняя классовые счётчики и
 * потраченные остатки.
 *
 * Нужен при повышении уровня: у «Удачливого» максимум равен бонусу мастерства,
 * и без пересчёта очки удачи застряли бы на значении, посчитанном в момент
 * взятия черты. Ресурсы черт, которых на листе больше нет, отсеиваются заодно.
 *
 * @param actor - лист персонажа (уже с новым уровнем)
 * @param counters - текущий список счётчиков актора
 * @returns новый список счётчиков: классовые как были, ресурсы черт пересчитаны
 */
export function refreshFeatCounters(
  actor: DnDActor,
  counters: ReadonlyArray<ActorCounterState>,
): ActorCounterState[] {
  const features: FeatureWithGrants[] = actor.features ?? [];

  const rebuilt = features.flatMap((feature) =>
    buildFeatCounters(feature, actor, counters),
  );

  const classCounters = counters.filter((counter) => !counter.featureId);

  return [...classCounters, ...rebuilt];
}
