/**
 * Боевая обработка активных эффектов D&D 5e на границах хода: тик длительностей,
 * точные turn-эффекты, периодический урон (DoT) и повторные спасброски, а также
 * разовое срабатывание эффектов области/ауры.
 *
 * Логика системо-зависима (спасброски по характеристикам, типы урона, HP-модель
 * D&D), поэтому живёт в `system/dnd/`. Ядро вызывает её через контракт
 * `VttSystem` (`runTurnEffects`/`expireTurnEffects`/`decrementEffectDurations`),
 * не импортируя этот файл напрямую — см. `docs/MULTI_SYSTEM_ARCHITECTURE.md`, Фаза 0.
 */

import type { AbilityType, DamagePart } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectDuration,
  EffectDurationType,
  EffectSave,
  EffectSaveOutcome,
  EffectSaveTiming,
  RecurringDamage,
  ResolvedActorStats,
} from './activeEffectTypes.js';
import type { ConditionRef } from './conditionKeys.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { CarrierContext } from './effectPipeline.js';
import type { FormulaContext } from './formulaParser.js';

import { generateId } from '@vtt/shared';

import { resolveSavingThrowRollMode } from './attackUtils.js';
import { ABILITY_LABELS } from './consts.js';
import { DAMAGE_TYPE_LABELS } from './damageConstants.js';
import { damageReachesTarget } from './damageTargetGate.js';
import { applyHpChange, applyMultiTypeDamageDefenses } from './damageUtils.js';
import { rollDamageFormula } from './diceFormula.js';
import {
  hasLastingEffectPayload,
  isImmuneToCondition,
  mergeAppliedEffects,
  resolveEffectApplication,
} from './effectAutomation.js';
import {
  buildCarrierContext,
  collectActiveEffects,
  collectBonusRollFormulas,
  getEntityConditionImmunities,
  resolveActorStats,
} from './effectPipeline.js';
import { buildFormulaContext } from './formulaParser.js';
import {
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
  writeEntityHitPoints,
} from './hitPoints.js';
import { expandDamageParts } from './spellUtils.js';

/**
 * Сколько раундов боя в единице длительности, которая отсчитывается раундами:
 * минута — 10 раундов, час — 600. Дни в бою не тикают.
 */
const ROUNDS_PER_DURATION_UNIT: Partial<Record<EffectDurationType, number>> = {
  rounds: 1,
  minutes: 10,
  hours: 600,
};

/**
 * Отсчитывается ли длительность раундами боя: у неё есть и число, и перевод в
 * раунды.
 *
 * @param duration - длительность эффекта
 * @returns раундов в единице либо `undefined`
 */
function roundsPerUnit(duration: EffectDuration): number | undefined {
  return ROUNDS_PER_DURATION_UNIT[duration.type];
}

/**
 * Уменьшает длительность (в раундах) всех эффектов на сущности (актёре или существе).
 * Минуты и часы тикают так же: их остаток хранится в раундах. Удаляет эффекты,
 * чьё время вышло.
 * @param entity - сущность, чьи эффекты нужно обновить
 * @returns true, если сущность была модифицирована
 */
export function decrementActorEffectDurations(entity: DnDSceneEntity): boolean {
  if (!entity.activeEffects || entity.activeEffects.length === 0) {
    return false;
  }

  let hasChanges = false;

  const initialLength = entity.activeEffects.length;

  // Длительность пересоздаётся, а не правится на месте: копии эффектов
  // (аура-нагрузка, эффект зоны) делаются мелким спредом и делят один объект
  // `duration` с оригиналом — правка на месте тикала бы общий счётчик по разу
  // за каждого носителя
  entity.activeEffects = entity.activeEffects.reduce<
    NonNullable<DnDSceneEntity['activeEffects']>
  >((kept, effect) => {
    const { duration } = effect;

    if (
      roundsPerUnit(duration) === undefined
      || typeof duration.remaining !== 'number'
    ) {
      kept.push(effect);

      return kept;
    }

    const remaining = duration.remaining - 1;

    hasChanges = true;

    if (remaining > 0) {
      kept.push({ ...effect, duration: { ...duration, remaining } });
    }

    return kept;
  }, []);

  return hasChanges || entity.activeEffects.length !== initialLength;
}

/**
 * Готовит эффект к наложению на цель: при длительности в раундах, минутах или
 * часах инициализирует `remaining` (в раундах: минута — 10) из `value`, если он
 * ещё не задан. Без этого эффект не тикает в бою —
 * `decrementActorEffectDurations` уменьшает только заданный `remaining`, и
 * «Щит веры на 10 минут» висел бы до ручного снятия.
 *
 * @param effect - накладываемый эффект
 * @returns эффект с инициализированным `remaining` (или исходный)
 */
export function withInitializedDuration(effect: ActiveEffect): ActiveEffect {
  const duration = effect.duration;
  const perUnit = roundsPerUnit(duration);

  if (
    perUnit !== undefined
    && typeof duration.value === 'number'
    && typeof duration.remaining !== 'number'
  ) {
    return {
      ...effect,
      duration: { ...duration, remaining: duration.value * perUnit },
    };
  }

  return effect;
}

/** Контекст наложения эффекта для инициализации точной длительности `type: 'turn'` */
export interface TurnDurationContext {
  /** id носителя — сущности, на которую ложится эффект */
  carrierId: string;
  /** id источника (кастера/атакующего), если известен */
  sourceId?: string;
  /** id участника, чей сейчас ход в активном энкаунтере (null/undefined вне боя) */
  activeTurnActorId?: string | null;
}

/**
 * Инициализирует точную длительность `type: 'turn'` в момент наложения эффекта.
 *
 * Проставляет `sourceActorId` (для якоря `source` — «до хода кастера») и флаг
 * `turnSkipFirst`: если эффект наложен ВО ВРЕМЯ хода якоря и истекает в КОНЦЕ
 * хода, то конец текущего хода — это «этот», а не «следующий» ход, поэтому
 * первую границу пропускаем (семантика D&D «до конца твоего СЛЕДУЮЩЕГО хода»).
 * Для начала хода пропуск не нужен — начало текущего хода уже прошло.
 *
 * Для не-`turn` длительностей возвращает эффект без изменений.
 *
 * @param effect - накладываемый эффект
 * @param context - контекст наложения (носитель/источник/текущий ход)
 * @returns эффект с инициализированной turn-длительностью
 */
export function stampTurnDuration(
  effect: ActiveEffect,
  context: TurnDurationContext,
): ActiveEffect {
  const duration = effect.duration;

  if (duration.type !== 'turn') {
    return effect;
  }

  const anchor = duration.turnAnchor ?? 'carrier';
  const timing = duration.turnTiming ?? 'end';

  // Якорь источника без известного кастера деградирует к носителю — ровно так
  // же, как в `expireTurnEffects`: иначе штамп и снятие эффекта считали бы
  // границу по разным сущностям, и эффект спадал бы на ход раньше
  const anchorId =
    anchor === 'source'
      ? (context.sourceId ?? context.carrierId)
      : context.carrierId;

  const skipFirst =
    timing === 'end'
    && context.activeTurnActorId != null
    && anchorId === context.activeTurnActorId;

  return {
    ...effect,
    sourceActorId:
      anchor === 'source'
        ? (context.sourceId ?? effect.sourceActorId)
        : effect.sourceActorId,
    duration: { ...duration, turnTiming: timing, turnSkipFirst: skipFirst },
  };
}

/**
 * Снимает с сущности точные turn-эффекты, чья граница хода наступила. Должна
 * вызываться на старте/в конце хода участника `turnActorId` для КАЖДОГО
 * участника энкаунтера (источник-якорь живёт на чужой сущности).
 *
 * Уважает `turnSkipFirst`: первая подходящая граница только снимает флаг, эффект
 * остаётся; следующая граница — снимает эффект.
 *
 * @param entity - сущность, чьи эффекты проверяем
 * @param turnActorId - id участника, чей ход сейчас обрабатывается
 * @param timing - граница: начало или конец хода
 * @param participantIds - состав боя; без него якорь источника не проверяется
 * @returns true, если эффекты сущности изменились
 */
export function expireTurnEffects(
  entity: DnDSceneEntity,
  turnActorId: string,
  timing: 'start' | 'end',
  participantIds?: ReadonlySet<string>,
): boolean {
  if (!entity.activeEffects || entity.activeEffects.length === 0) {
    return false;
  }

  let changed = false;

  entity.activeEffects = entity.activeEffects.filter((effect) => {
    const duration = effect.duration;

    if (duration.type !== 'turn' || (duration.turnTiming ?? 'end') !== timing) {
      return true;
    }

    const anchor = duration.turnAnchor ?? 'carrier';

    // Якорь источника годится, только если ход источника вообще наступит:
    // без `sourceActorId` (эффект наложен по пути без контекста кастера) и
    // когда источника нет в бою (не добавляли либо удалили после смерти) якорь
    // деградирует к носителю. Иначе эффект ждал бы хода, которого не будет, и
    // висел бы до конца сессии.
    const sourceId = effect.sourceActorId;

    const hasReachableSource =
      anchor === 'source'
      && sourceId !== undefined
      && (participantIds?.has(sourceId) ?? true);

    const anchorId = hasReachableSource ? sourceId : entity.id;

    if (anchorId !== turnActorId) {
      return true; // граница не нашего якоря
    }

    if (duration.turnSkipFirst) {
      // Пропускаем первую границу (ход наложения), снимаем флаг — эффект живёт.
      effect.duration = { ...duration, turnSkipFirst: false };
      changed = true;

      return true;
    }

    changed = true;

    return false; // граница «следующего» хода — снимаем эффект
  });

  return changed;
}

/** Исход одного повторного спасброска эффекта (начало/конец хода) */
export interface TurnSaveOutcome {
  /** Название эффекта */
  effectName: string;
  /** Характеристика спасброска */
  ability: AbilityType;
  /** Сложность */
  dc: number;
  /** Выпавшее на кости значение (1–20) */
  roll: number;
  /** Итог с модификатором */
  total: number;
  /** Успешен ли спас (эффект снят) */
  passed: boolean;
  /**
   * Спасбросок против урона каждый ход: что даёт успех. Не задан — это
   * повторный спасбросок, снимающий эффект.
   */
  damageOnSuccess?: EffectSaveOutcome;
}

/** Исход периодического урона (DoT) одного эффекта за тик */
export interface TurnDamageOutcome {
  /** Название эффекта */
  effectName: string;
  /** Итог урона после защит цели */
  total: number;
  /** Типы урона (для подписи в чате) */
  types: string[];
  /** Выпавшие значения кубиков (для отображения) */
  values: number[];
}

/** Исход лечения каждый ход («Регенерация», временные хиты «Героизма») */
export interface TurnHealingOutcome {
  /** Название эффекта */
  effectName: string;
  /** Восстановленные хиты */
  healed: number;
  /** Выданные временные хиты */
  tempHp: number;
  /** Выпавшие значения кубиков */
  values: number[];
}

/** Результат обработки периодических эффектов по сущности за один тик хода */
export interface TurnEffectsResult {
  /** Были ли изменения (снят эффект и/или нанесён урон) */
  changed: boolean;
  /** Суммарный нанесённый DoT-урон */
  damageTotal: number;
  /** Исходы повторных спасбросков */
  saveOutcomes: TurnSaveOutcome[];
  /** Исходы периодического урона */
  damageOutcomes: TurnDamageOutcome[];
  /** Исходы лечения и временных хитов каждый ход */
  healingOutcomes: TurnHealingOutcome[];
  /**
   * Урон аур «пока внутри», ждущий спасброска игрока. Эффекта ауры на самой
   * сущности нет — применять его придётся по снимку.
   */
  deferredAmbientDamageSaveEffects: ActiveEffect[];
  /**
   * Эффекты, чей повторный спасбросок НЕ брошен: его спросят у игрока. Эффект
   * остаётся на сущности, пока не придёт ответ.
   */
  deferredSaveEffects: ActiveEffect[];
  /**
   * Эффекты, чей урон каждый ход ждёт спасброска игрока: урон не нанесён, его
   * нанесут по ответу.
   */
  deferredDamageSaveEffects: ActiveEffect[];
}

/** Как прогонять периодические эффекты */
export interface TurnEffectsOptions {
  /**
   * Не бросать повторный спасбросок этого эффекта, а отложить (его спросят у
   * игрока). Без опции все спасброски бросает сервер.
   */
  deferRecurringSave?: (effect: ActiveEffect) => boolean;
  /**
   * Не бросать спасбросок против урона каждый ход, а отложить вместе с уроном
   * (его спросят у игрока). Без опции бросает сервер.
   */
  deferRecurringDamageSave?: (effect: ActiveEffect) => boolean;
  /**
   * Ауры чужих токенов, накрывающие сущность: их урон «пока внутри» тикает на
   * её ходу, а бонусы учитываются в спасбросках. Эффекты ауры на сущности не
   * лежат, поэтому их повторный спасбросок ничего не снимает.
   */
  ambientEffects?: readonly ActiveEffect[];
}

/** Эффекты и свойства носителя для бонусных кубиков серверного спасброска. */
export interface EffectSavingThrowContext {
  effects: readonly ActiveEffect[];
  formulaContext: FormulaContext;
  self: CarrierContext;
}

/**
 * Обстоятельства спасброска: от них зависят флаги преимущества вроде
 * «Мантии сопротивления заклинаниям» или «преимущество против Испуга».
 */
export interface SavingThrowCircumstances {
  /** Спасбросок навязан магией */
  againstMagic: boolean;
  /** Состояние, которого спасбросок позволяет избежать */
  againstCondition?: ConditionRef;
}

/**
 * Спасбросок, которого требует эффект: что бросать и против чего.
 *
 * Одна форма на все пути эффекта — спасбросок при входе в зону или ауру и
 * повторный спасбросок хода, брошенный сервером или игроком по запросу.
 */
export interface EffectSaveSpec extends SavingThrowCircumstances {
  /** Название эффекта — в подпись запроса и в сводку чата */
  effectName: string;
  /** Характеристика спасброска */
  ability: AbilityType;
  /** Сложность */
  dc: number;
}

/**
 * Навязан ли эффект магией. Спасбросок от эффекта заклинания (удержание,
 * повторный спасбросок «Паутины») получает преимущество от защиты против магии,
 * а ядовитое болото зоны — нет.
 *
 * @param effect - эффект, требующий спасброска
 * @returns `true` для эффекта заклинания
 */
function isMagicalEffect(effect: ActiveEffect): boolean {
  // Копия эффекта зоны заклинания и статус от входа в неё уже не `spell`, но
  // навязаны той же магией
  return effect.origin === 'spell' || effect.magical === true;
}

/**
 * Спасбросок при наложении эффекта зоны или ауры.
 *
 * @param effect - эффект с `applySave`
 * @param applySave - его спасбросок (передаётся отдельно, чтобы не проверять
 *   наличие второй раз)
 * @returns спецификация спасброска
 */
export function buildApplySaveSpec(
  effect: ActiveEffect,
  applySave: NonNullable<ActiveEffect['applySave']>,
): EffectSaveSpec {
  return {
    effectName: effect.name,
    ability: applySave.ability,
    dc: applySave.dc,
    againstMagic: isMagicalEffect(effect),
    againstCondition: effect.conditionKey,
  };
}

/**
 * Повторный спасбросок хода, снимающий эффект.
 *
 * @param effect - эффект с `recurringSave`
 * @param recurringSave - его повторный спасбросок
 * @returns спецификация спасброска
 */
export function buildRecurringSaveSpec(
  effect: ActiveEffect,
  recurringSave: NonNullable<ActiveEffect['recurringSave']>,
): EffectSaveSpec {
  return {
    effectName: effect.name,
    ability: recurringSave.ability,
    dc: recurringSave.dc,
    againstMagic: isMagicalEffect(effect),
    againstCondition: effect.conditionKey,
  };
}

/**
 * Спасбросок против урона каждый ход.
 *
 * @param effect - эффект с `recurringDamage.save`
 * @param save - его спасбросок
 * @returns спецификация спасброска
 */
export function buildRecurringDamageSaveSpec(
  effect: ActiveEffect,
  save: EffectSave,
): EffectSaveSpec {
  return {
    effectName: effect.name,
    ability: save.ability,
    dc: save.dc,
    againstMagic: isMagicalEffect(effect),
  };
}

/** Доля урона при успешном спасброске «половина урона» */
const HALF_DAMAGE_MULTIPLIER = 0.5;

/**
 * Какая доля урона достаётся после спасброска: провал — весь, успех — по
 * `onSuccess`.
 *
 * @param onSuccess - что даёт успех
 * @param passed - пройден ли спасбросок
 * @returns множитель урона
 */
export function resolveSaveDamageMultiplier(
  onSuccess: EffectSaveOutcome,
  passed: boolean,
): number {
  if (!passed) {
    return 1;
  }

  return onSuccess === 'half' ? HALF_DAMAGE_MULTIPLIER : 0;
}

/**
 * Собирает контекст один раз для серии спасбросков текущей сущности.
 *
 * @param entity - сущность, которая бросает
 * @returns эффекты и свойства носителя для бонусных кубиков
 */
export function buildEffectSavingThrowContext(
  entity: DnDSceneEntity,
  ambientEffects: readonly ActiveEffect[] = [],
): EffectSavingThrowContext {
  return {
    effects: [...collectActiveEffects(entity), ...ambientEffects],
    formulaContext: buildFormulaContext(entity),
    self: buildCarrierContext(entity),
  };
}

/** Грани кости спасброска */
const SAVING_THROW_DIE_SIDES = 20;

/**
 * Катает спасбросок сущности против сложности с учётом флагов её состояний.
 *
 * Автопровал (`save.autoFail.<характеристика>` от Парализованного,
 * Окаменевшего, Ошеломлённого, Находящегося без сознания) проваливает бросок
 * без кости; преимущество и помеха (`save.advantage`/`save.disadvantage`, общие
 * и по характеристике) катают две кости и берут лучшую либо худшую, взаимно
 * гасясь по правилам 5e.
 *
 * Общий для всех спасбросков движка: и периодического «спас снимает эффект», и
 * спасброска при срабатывании области или ауры — иначе один и тот же флаг
 * обрабатывался бы в двух местах по-разному.
 *
 * @param ability - характеристика спасброска
 * @param dc - сложность
 * @param stats - разрешённые статы сущности (модификаторы и флаги)
 * @param context - актуальные эффекты и свойства носителя бонусных кубиков
 * @param circumstances - навязан ли магией и против какого состояния; без них
 *   флаги «против магии» и «против состояния» не срабатывают
 * @returns выпавшее значение кости, итог с модификатором и признак успеха
 */
export function rollEffectSavingThrow(
  ability: AbilityType,
  dc: number,
  stats: ResolvedActorStats,
  context: EffectSavingThrowContext,
  circumstances?: SavingThrowCircumstances,
): { roll: number; total: number; passed: boolean } {
  const { activeFlags } = stats;

  if (activeFlags.has(`save.autoFail.${ability}`)) {
    return { roll: 1, total: 1, passed: false };
  }

  const modifier = stats.saves[ability] ?? 0;

  // Те же обстоятельства, что и у спасброска на клиенте: иначе серверный и
  // клиентский бросок одного эффекта давали бы разное преимущество
  const rollMode = resolveSavingThrowRollMode({
    flags: activeFlags,
    ability,
    againstMagic: circumstances?.againstMagic,
    againstCondition: circumstances?.againstCondition,
  });

  const hasAdvantage = rollMode === 'advantage';
  const hasDisadvantage = rollMode === 'disadvantage';

  const firstRoll = Math.floor(Math.random() * SAVING_THROW_DIE_SIDES) + 1;

  let roll = firstRoll;

  // Преимущество и помеха гасят друг друга — остаётся обычный бросок
  if (hasAdvantage !== hasDisadvantage) {
    const secondRoll = Math.floor(Math.random() * SAVING_THROW_DIE_SIDES) + 1;

    roll = hasAdvantage
      ? Math.max(firstRoll, secondRoll)
      : Math.min(firstRoll, secondRoll);
  }

  const bonusDiceFormulas = collectBonusRollFormulas(
    context.effects,
    `save.${ability}`,
    { hasAdvantage, hasDisadvantage, self: context.self },
    context.formulaContext,
  );

  const bonusTotal = bonusDiceFormulas.reduce(
    (totalBonus, formula) => totalBonus + rollDamageFormula(formula).total,
    0,
  );

  const total = roll + modifier + bonusTotal;

  return { roll, total, passed: total >= dc };
}

/**
 * Бросает спасбросок эффекта на сервере — за сущность, которая бросает сама
 * (авто-спасброски) или которой некому ответить.
 *
 * @param entity - сущность, которая бросает
 * @param spec - что бросать
 * @returns исход спасброска для применения и подписи в чате
 */
export function rollEffectSaveOutcome(
  entity: DnDSceneEntity,
  spec: EffectSaveSpec,
  ambientEffects: readonly ActiveEffect[] = [],
): TurnSaveOutcome {
  const { roll, total, passed } = rollEffectSavingThrow(
    spec.ability,
    spec.dc,
    resolveActorStats(entity, [...ambientEffects]),
    buildEffectSavingThrowContext(entity, ambientEffects),
    spec,
  );

  return {
    effectName: spec.effectName,
    ability: spec.ability,
    dc: spec.dc,
    roll,
    total,
    passed,
  };
}

/**
 * Применяет чистый урон к сущности ОДНИМ изменением HP (сначала временные
 * хиты, затем текущие — правило 5e). Мутирует `entity.system.hitPoints`.
 *
 * Используется и периодическим уроном (DoT при смене хода), и разовым уроном
 * эффектов области/ауры (при входе/выходе).
 *
 * @param entity - сущность
 * @param damage - суммарный урон
 */
export function applyDamageToEntity(
  entity: DnDSceneEntity,
  damage: number,
): void {
  // Через общие резолверы: у существа без явных `current`/`max` запас хитов
  // берётся из `average` статблока, иначе периодический урон уходил бы в 0.
  const hpBefore = resolveEntityCurrentHp(entity);
  const maxHp = resolveEntityMaxHp(entity);
  const tempBefore = resolveEntityTempHp(entity);

  const hpChange = applyHpChange({
    hpBefore,
    maxHp,
    tempBefore,
    damage,
    heal: 0,
  });

  writeEntityHitPoints(entity, {
    current: hpChange.hpAfter,
    temp: hpChange.tempAfter,
  });
}

/**
 * Катает урон одной нагрузки `DamagePart[]` с учётом защит цели и возвращает
 * исход для подписи в чате. Сегментирует части (`@dmg.<type>`), кидает кости и
 * применяет иммунитеты/сопротивления/уязвимости. Лечащие части и контекстные
 * `@`-формулы пропускаются (сервер их не катает). Возвращает `null`, если урона
 * не получилось (нет ненулевых сегментов).
 *
 * Условные слагаемые (`@target.full`, `@target.type.undead`) ядро развернуло в
 * ветки с гейтами — здесь они сверяются с самой целью
 * ({@link damageReachesTarget}). Без сверки катались бы ВСЕ ветки сразу, и
 * «взаимоисключающие» `@target.full`/`@target.notFull` давали бы двойной урон.
 *
 * @param effectName - название эффекта (для подписи)
 * @param damageParts - части урона эффекта
 * @param stats - resolved-статы цели (нужны защиты от урона)
 * @param entity - сущность-цель (нужна для гейтов условных веток)
 * @returns исход урона или `null`
 */
export function rollEffectDamage(
  effectName: string,
  damageParts: DamagePart[],
  stats: ResolvedActorStats,
  entity: DnDSceneEntity,
): TurnDamageOutcome | null {
  const segments = expandDamageParts(
    damageParts,
    undefined,
    (formula) => formula,
  );

  let effectTotal = 0;

  const effectValues: number[] = [];
  const effectTypes: string[] = [];

  for (const segment of segments) {
    // Урон не лечит; @-формулы (контекстные) сервер не катает
    if (segment.isHealing || segment.formula.includes('@')) {
      continue;
    }

    // Ветка условного слагаемого — только «своей» цели
    if (!damageReachesTarget(segment, entity)) {
      continue;
    }

    const rolled = rollDamageFormula(segment.formula);
    const types = segment.types ?? (segment.type ? [segment.type] : []);

    let damage = rolled.total;

    if (types.length > 0) {
      damage = applyMultiTypeDamageDefenses(
        damage,
        types,
        stats.damageDefenses,
      ).finalDamage;

      for (const type of types) {
        if (!effectTypes.includes(type)) {
          effectTypes.push(type);
        }
      }
    }

    effectTotal += damage;
    effectValues.push(...rolled.values);
  }

  if (effectTotal <= 0) {
    return null;
  }

  return {
    effectName,
    total: effectTotal,
    types: effectTypes,
    values: effectValues,
  };
}

/**
 * Катает урон каждый ход с учётом спасброска против него. Урон не
 * применяется — вызывающий складывает тики и списывает хиты одним изменением.
 *
 * @param entity - носитель эффекта
 * @param effect - эффект
 * @param recurringDamage - его урон каждый ход
 * @param save - исход спасброска против урона; `null` — спасброска нет
 * @param stats - resolved-статы носителя (защиты от урона)
 * @returns исход урона либо `null`, если урона нет
 */
export function rollRecurringDamage(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  recurringDamage: RecurringDamage,
  save: TurnSaveOutcome | null,
  stats: ResolvedActorStats,
): TurnDamageOutcome | null {
  const multiplier =
    recurringDamage.save && save
      ? resolveSaveDamageMultiplier(recurringDamage.save.onSuccess, save.passed)
      : 1;

  if (multiplier <= 0) {
    return null;
  }

  const rolled = rollEffectDamage(
    effect.name,
    recurringDamage.damageParts,
    stats,
    entity,
  );

  if (!rolled) {
    return null;
  }

  const total = Math.floor(rolled.total * multiplier);

  return total > 0 ? { ...rolled, total } : null;
}

/** Откуда пришёл разовый эффект */
export interface EntryEffectOptions {
  /** Зона, в которую вошли или из которой вышли; у ауры поля нет */
  sourceAreaId?: string;
  /** Ауры чужих токенов, накрывающие сущность (спасбросок, иммунитеты) */
  ambientEffects?: readonly ActiveEffect[];
}

/** Исход срабатывания эффекта области/ауры при входе/выходе */
export interface EntryEffectResult {
  /** Исход урона (если был) — для подписи в чате */
  damageOutcome: TurnDamageOutcome | null;
  /** Исход спасброска при наложении (если был) — для подписи в чате */
  saveOutcome: TurnSaveOutcome | null;
  /** Повешена ли длящаяся копия-статус на цель (мутация `activeEffects`) */
  statusApplied: boolean;
}

/**
 * Применяет разовый эффект области/ауры (`enter`/`exit`) по УЖЕ известному
 * исходу спасброска: наносит урон `damageParts` и, если у эффекта есть длящаяся
 * нагрузка (флаги/changes/состояние), вешает её копию как самостоятельный
 * эффект со своей длительностью.
 *
 * Что даёт успех спасброска, решает `resolveEffectApplication` — тот же гейт,
 * что у эффекта, наложенного атакой: половина урона без эффекта, «эффект даже
 * при успехе», «только при успехе». Своя логика здесь расходилась с атакой:
 * успех с половиной урона всё равно вешал статус.
 *
 * Спасбросок отделён от применения: его бросает сервер (авто-спасброски) или
 * игрок по запросу, и применение одно на оба пути.
 *
 * Мутирует `entity.system.hitPoints` (урон) и `entity.activeEffects` (статус).
 *
 * @param entity - сущность, на которую действует эффект
 * @param effect - эффект области/ауры (с `areaTrigger` `enter`/`exit`)
 * @param saveOutcome - исход спасброска эффекта; `null` — спасброска нет
 * @param options - откуда пришёл эффект
 * @returns исходы урона и спасброска для подписи в чате
 */
export function applyEntryEffect(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  saveOutcome: TurnSaveOutcome | null,
  options: EntryEffectOptions = {},
): EntryEffectResult {
  const ambientEffects = options.ambientEffects ?? [];
  const stats = resolveActorStats(entity, [...ambientEffects]);

  // Эффект области «приземлился» всегда: промаха у зоны нет, её защита —
  // только собственный спасбросок эффекта
  const application = resolveEffectApplication(effect, {
    landed: true,
    applySaveSucceeded: saveOutcome?.passed,
  });

  let damageOutcome: TurnDamageOutcome | null = null;

  if (
    effect.damageParts
    && effect.damageParts.length > 0
    && application.damageMultiplier > 0
  ) {
    const rolled = rollEffectDamage(
      effect.name,
      effect.damageParts,
      stats,
      entity,
    );

    if (rolled) {
      const total = Math.floor(rolled.total * application.damageMultiplier);

      if (total > 0) {
        applyDamageToEntity(entity, total);
        damageOutcome = { ...rolled, total };
      }
    }
  }

  // Длящаяся нагрузка (статус): вешаем самостоятельной копией, живущей по своей
  // длительности (не привязана к области, так как триггер разовый)
  const hasStatusPayload = hasLastingEffectPayload(effect);

  // Иммунитет к состоянию проверяется здесь так же, как при попадании атакой:
  // область — такой же путь наложения, и обходить статблок он не должен
  const conditionBlocked =
    effect.conditionKey !== undefined
    && isImmuneToCondition(
      getEntityConditionImmunities(entity, ambientEffects),
      effect.conditionKey,
    );

  let statusApplied = false;

  if (hasStatusPayload && application.applyEffect && !conditionBlocked) {
    const status = withInitializedDuration({
      ...effect,
      id: generateId('ae'),
      origin: 'condition',
      originId: undefined,
      areaTrigger: undefined,
      transfer: false,
      // Своя длительность: копия не должна делить счётчик с эффектом зоны
      duration: { ...effect.duration },
      // Разовая нагрузка уже отыграна — на длящейся копии её не оставляем
      damageParts: undefined,
      applySave: undefined,
      // Аура остаётся у источника: без сброса цель сама начала бы её излучать
      // (у копии нет `areaTrigger`, и она стала бы постоянной аурой)
      aura: undefined,
      effectTarget: undefined,
      // Статус от зоны заклинания кончается вместе с заклинанием — с зоной
      endsWithAreaId:
        effect.magical && options.sourceAreaId
          ? options.sourceAreaId
          : undefined,
    });

    // Правило PHB 2024 «Combining Game Effects»: одноимённый статус не
    // стакается — повторный вход в область обновляет его, а не плодит копии
    entity.activeEffects = mergeAppliedEffects(entity.activeEffects ?? [], [
      status,
    ]);

    statusApplied = true;
  }

  return { damageOutcome, saveOutcome, statusApplied };
}

/**
 * Срабатывание разового эффекта области/ауры, спасбросок которого бросает сам
 * сервер: у сущности авто-спасброски, либо ядро не умеет спросить игрока.
 *
 * @param entity - сущность, на которую действует эффект
 * @param effect - эффект области/ауры (с `areaTrigger` `enter`/`exit`)
 * @param options - откуда пришёл эффект
 * @returns исходы урона и спасброска для подписи в чате
 */
export function resolveEntryEffect(
  entity: DnDSceneEntity,
  effect: ActiveEffect,
  options: EntryEffectOptions = {},
): EntryEffectResult {
  const saveOutcome = effect.applySave
    ? rollEffectSaveOutcome(
        entity,
        buildApplySaveSpec(effect, effect.applySave),
        options.ambientEffects,
      )
    : null;

  return applyEntryEffect(entity, effect, saveOutcome, options);
}

/**
 * Катает лечащие части урона каждый ход: `@heal` восстанавливает хиты,
 * `@heal.temp` даёт временные. Формулы с `@`, которые не подставил источник,
 * сервер не катает.
 *
 * @param effectName - название эффекта (для подписи)
 * @param damageParts - части урона эффекта
 * @returns исход лечения либо `null`, если лечащих частей нет
 */
export function rollEffectHealing(
  effectName: string,
  damageParts: DamagePart[],
): TurnHealingOutcome | null {
  const segments = expandDamageParts(
    damageParts,
    undefined,
    (formula) => formula,
  );

  let healed = 0;
  let tempHp = 0;

  const values: number[] = [];

  for (const segment of segments) {
    if (!segment.isHealing || segment.formula.includes('@')) {
      continue;
    }

    const rolled = rollDamageFormula(segment.formula);

    if (segment.healTemp) {
      tempHp += rolled.total;
    } else {
      healed += rolled.total;
    }

    values.push(...rolled.values);
  }

  if (healed <= 0 && tempHp <= 0) {
    return null;
  }

  return { effectName, healed, tempHp, values };
}

/**
 * Лечение и временные хиты за тик одним изменением: хиты не выше максимума,
 * временные не складываются — остаются большие (правило 5e).
 *
 * @param entity - сущность
 * @param healed - восстановленные хиты
 * @param tempHp - выданные временные хиты
 * @returns `true`, если хиты изменились
 */
function applyTurnHealing(
  entity: DnDSceneEntity,
  healed: number,
  tempHp: number,
): boolean {
  const current = resolveEntityCurrentHp(entity);
  const max = resolveEntityMaxHp(entity);
  const temp = resolveEntityTempHp(entity);
  const nextCurrent = Math.min(max, current + healed);
  const nextTemp = Math.max(temp, tempHp);

  if (nextCurrent === current && nextTemp === temp) {
    return false;
  }

  writeEntityHitPoints(entity, { current: nextCurrent, temp: nextTemp });

  return true;
}

/**
 * Прогоняет периодические эффекты сущности для указанного момента хода
 * (начало/конец): сперва наносит DoT-урон (`recurringDamage`, со спасброском
 * против него, если он задан), затем катает повторные спасброски
 * (`recurringSave`) — успех снимает эффект.
 *
 * Спасброски учитывают модификатор, преимущество/помеху и бонусные кубики.
 * Спасбросок, который надо спросить у игрока (`options.deferRecurringSave`), не
 * бросается: эффект остаётся и уходит в `deferredSaveEffects`.
 *
 * Мутирует `entity.activeEffects` и `entity.system.hitPoints`.
 *
 * @param entity - сущность, чей момент хода обрабатывается
 * @param timing - момент: начало или конец хода
 * @param options - какие спасброски отложить
 * @returns урон, исходы бросков и были ли изменения
 */
export function processTurnEffects(
  entity: DnDSceneEntity,
  timing: EffectSaveTiming,
  options: TurnEffectsOptions = {},
): TurnEffectsResult {
  const empty: TurnEffectsResult = {
    changed: false,
    damageTotal: 0,
    saveOutcomes: [],
    damageOutcomes: [],
    healingOutcomes: [],
    deferredSaveEffects: [],
    deferredDamageSaveEffects: [],
    deferredAmbientDamageSaveEffects: [],
  };

  const ambientEffects = options.ambientEffects ?? [];

  // Урон ауры «пока внутри» тикает на ходу того, кто в ней стоит
  const ambientTurnEffects = ambientEffects.filter(
    (effect) =>
      (effect.areaTrigger ?? 'stay') === 'stay'
      && effect.recurringDamage !== undefined,
  );

  const ownEffects = entity.activeEffects ?? [];

  if (ownEffects.length === 0 && ambientTurnEffects.length === 0) {
    return empty;
  }

  const stats = resolveActorStats(entity, [...ambientEffects]);
  const saveOutcomes: TurnSaveOutcome[] = [];

  // 1. Периодический урон (DoT) по таймингу; со спасброском — по его исходу
  const damageOutcomes: TurnDamageOutcome[] = [];
  const healingOutcomes: TurnHealingOutcome[] = [];
  const deferredDamageSaveEffects: ActiveEffect[] = [];
  const deferredAmbientDamageSaveEffects: ActiveEffect[] = [];
  const ambientIds = new Set(ambientTurnEffects.map((effect) => effect.id));

  let damageTotal = 0;
  let healedTotal = 0;
  let tempHpGranted = 0;

  let savingThrowContext = buildEffectSavingThrowContext(
    entity,
    ambientEffects,
  );

  for (const effect of [...ownEffects, ...ambientTurnEffects]) {
    const recurringDamage = effect.recurringDamage;

    // Отключённый эффект не действует — значит, и не бьёт. Своя аура без
    // «действует и на носителя» бьёт других, а не того, кто её излучает
    if (
      effect.disabled
      || !recurringDamage
      || recurringDamage.timing !== timing
      || (!ambientIds.has(effect.id) && effect.aura && !effect.aura.applyToSelf)
    ) {
      continue;
    }

    // Лечение от спасброска не зависит: «Регенерация» лечит и без броска
    const healing = rollEffectHealing(effect.name, recurringDamage.damageParts);

    if (healing) {
      healingOutcomes.push(healing);
      healedTotal += healing.healed;
      tempHpGranted = Math.max(tempHpGranted, healing.tempHp);
    }

    let damageSave: TurnSaveOutcome | null = null;

    if (recurringDamage.save) {
      // Спасбросок спросят у игрока: урон ждёт ответа
      if (options.deferRecurringDamageSave?.(effect)) {
        if (ambientIds.has(effect.id)) {
          deferredAmbientDamageSaveEffects.push(effect);
        } else {
          deferredDamageSaveEffects.push(effect);
        }

        continue;
      }

      const { roll, total, passed } = rollEffectSavingThrow(
        recurringDamage.save.ability,
        recurringDamage.save.dc,
        stats,
        savingThrowContext,
        buildRecurringDamageSaveSpec(effect, recurringDamage.save),
      );

      damageSave = {
        effectName: effect.name,
        ability: recurringDamage.save.ability,
        dc: recurringDamage.save.dc,
        roll,
        total,
        passed,
        damageOnSuccess: recurringDamage.save.onSuccess,
      };

      saveOutcomes.push(damageSave);
    }

    const outcome = rollRecurringDamage(
      entity,
      effect,
      recurringDamage,
      damageSave,
      stats,
    );

    if (outcome) {
      damageTotal += outcome.total;
      damageOutcomes.push(outcome);
    }
  }

  if (damageTotal > 0) {
    applyDamageToEntity(entity, damageTotal);
    // Урон мог опустить хиты — повторные спасброски считаются уже по новому
    // состоянию сущности
    savingThrowContext = buildEffectSavingThrowContext(entity, ambientEffects);
  }

  const healingApplied =
    (healedTotal > 0 || tempHpGranted > 0)
    && applyTurnHealing(entity, healedTotal, tempHpGranted);

  // 2. Повторные спасброски по таймингу — успех снимает эффект
  const deferredSaveEffects: ActiveEffect[] = [];
  const initialLength = ownEffects.length;

  const remaining = ownEffects.filter((effect) => {
    const recurring = effect.recurringSave;

    // Отключённый эффект не действует — и сам себя спасброском не снимает
    if (effect.disabled || !recurring || recurring.timing !== timing) {
      return true;
    }

    // Спасбросок спросят у игрока: до ответа эффект держится
    if (options.deferRecurringSave?.(effect)) {
      deferredSaveEffects.push(effect);

      return true;
    }

    const { roll, total, passed } = rollEffectSavingThrow(
      recurring.ability,
      recurring.dc,
      stats,
      savingThrowContext,
      buildRecurringSaveSpec(effect, recurring),
    );

    saveOutcomes.push({
      effectName: effect.name,
      ability: recurring.ability,
      dc: recurring.dc,
      roll,
      total,
      passed,
    });

    if (passed) {
      // Снятый этой же серией эффект больше не даёт кубик следующим спасброскам.
      savingThrowContext = {
        ...savingThrowContext,
        effects: savingThrowContext.effects.filter(
          (activeEffect) => activeEffect.id !== effect.id,
        ),
      };
    }

    // Успех снимает эффект, провал — оставляет
    return !passed;
  });

  const effectsRemoved = remaining.length !== initialLength;

  if (effectsRemoved) {
    entity.activeEffects = remaining;
  }

  return {
    changed: damageTotal > 0 || effectsRemoved || healingApplied,
    damageTotal,
    saveOutcomes,
    damageOutcomes,
    healingOutcomes,
    deferredSaveEffects,
    deferredDamageSaveEffects,
    deferredAmbientDamageSaveEffects,
  };
}

/** Итог спасброска против урона каждый ход в сводке */
const RECURRING_DAMAGE_SAVE_STATUS: Record<
  EffectSaveOutcome | 'failed',
  string
> = {
  negate: '✓ без урона',
  half: '✓ половина урона',
  failed: '✗ полный урон',
};

/** Подпись временных хитов в сводке эффектов */
const TEMP_HP_SUMMARY_LABEL = 'временных HP';

/** Подпись момента хода в сводке эффектов */
export const TURN_TIMING_SUMMARY_LABELS: Record<EffectSaveTiming, string> = {
  startOfTurn: 'начало хода',
  endOfTurn: 'конец хода',
};

/**
 * Форматирует сводку периодических эффектов за тик хода в текст для чата.
 *
 * @param entityName - имя сущности
 * @param timing - момент хода (начало/конец)
 * @param result - результат `processTurnEffects`
 * @returns строка для чата или `null`, если показывать нечего
 */
export function formatTurnEffectsMessage(
  entityName: string,
  timing: EffectSaveTiming,
  result: TurnEffectsResult,
): string | null {
  return formatEffectsSummary(
    entityName,
    TURN_TIMING_SUMMARY_LABELS[timing],
    result.damageOutcomes,
    result.saveOutcomes,
    formatRecurringSaveStatus,
    result.healingOutcomes,
  );
}

/**
 * Итог повторного спасброска в сводке: успех снимает эффект.
 *
 * @param save - исход спасброска
 * @returns подпись итога
 */
export function formatRecurringSaveStatus(save: TurnSaveOutcome): string {
  if (save.damageOnSuccess) {
    return save.passed
      ? RECURRING_DAMAGE_SAVE_STATUS[save.damageOnSuccess]
      : RECURRING_DAMAGE_SAVE_STATUS.failed;
  }

  return save.passed ? '✓ снят' : '✗ держится';
}

/**
 * Первая строка сводки сработавших эффектов.
 *
 * @param entityName - имя сущности
 * @param whenLabel - подпись момента («начало хода», «область»)
 * @returns заголовок сводки
 */
export function formatEffectsSummaryHeader(
  entityName: string,
  whenLabel: string,
): string {
  return `Эффекты (${whenLabel}): ${entityName}`;
}

/**
 * Общий форматтер сводки сработавших эффектов в строку чата.
 *
 * @param entityName - имя сущности
 * @param whenLabel - подпись момента (напр. «начало хода», «вход в область»)
 * @param damageOutcomes - исходы урона
 * @param saveOutcomes - исходы спасбросков
 * @param formatSaveStatus - как подписать итог спасброска (зависит от контекста:
 *   периодический спас снимает эффект, спас при наложении отменяет/уменьшает урон)
 * @param healingOutcomes - исходы лечения и временных хитов
 * @returns строка для чата или `null`, если показывать нечего
 */
export function formatEffectsSummary(
  entityName: string,
  whenLabel: string,
  damageOutcomes: TurnDamageOutcome[],
  saveOutcomes: TurnSaveOutcome[],
  formatSaveStatus: (save: TurnSaveOutcome) => string,
  healingOutcomes: TurnHealingOutcome[] = [],
): string | null {
  if (
    damageOutcomes.length === 0
    && saveOutcomes.length === 0
    && healingOutcomes.length === 0
  ) {
    return null;
  }

  const lines = [formatEffectsSummaryHeader(entityName, whenLabel)];
  const damageLabels: Record<string, string> = DAMAGE_TYPE_LABELS;

  for (const damage of damageOutcomes) {
    const typeLabel =
      damage.types.map((type) => damageLabels[type] ?? type).join('/')
      || 'урон';

    const breakdown =
      damage.values.length > 0 ? `[${damage.values.join(', ')}] = ` : '';

    lines.push(
      `${damage.effectName}: ${breakdown}−${damage.total} HP (${typeLabel})`,
    );
  }

  for (const healing of healingOutcomes) {
    const breakdown =
      healing.values.length > 0 ? `[${healing.values.join(', ')}] = ` : '';

    if (healing.healed > 0) {
      lines.push(`${healing.effectName}: ${breakdown}+${healing.healed} HP`);
    }

    if (healing.tempHp > 0) {
      lines.push(
        `${healing.effectName}: ${breakdown}${healing.tempHp} ${TEMP_HP_SUMMARY_LABEL}`,
      );
    }
  }

  for (const save of saveOutcomes) {
    const abilityLabel = ABILITY_LABELS[save.ability];

    lines.push(
      `${save.effectName}: спас ${abilityLabel} [${save.roll}] = ${save.total} vs ${save.dc} — ${formatSaveStatus(save)}`,
    );
  }

  return lines.join('\n');
}
