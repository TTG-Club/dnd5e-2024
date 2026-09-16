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
  EffectSaveOutcome,
  EffectSaveTiming,
  ResolvedActorStats,
} from './activeEffectTypes.js';
import type { ConditionRef } from './conditionKeys.js';
import type { DamageDefenseOutcome } from './damageUtils.js';
import type { DnDSceneEntity } from './dndEntities.js';
import type { CarrierContext } from './effectPipeline.js';
import type { DeferredTurnTrigger } from './effectTriggerRunner.js';
import type { EffectTriggerTurnOwner } from './effectTriggerTypes.js';
import type { FormulaContext } from './formulaParser.js';

import { isToggleActivatedEffect } from './activeEffectTypes.js';
import {
  listSavingThrowBonusKeys,
  resolveSavingThrowModifier,
  resolveSavingThrowRollMode,
} from './attackUtils.js';
import { ABILITY_LABELS } from './consts.js';
import { DAMAGE_TYPE_LABELS } from './damageConstants.js';
import { damageReachesTarget } from './damageTargetGate.js';
import { applyHpChange, applyMultiTypeDamageDefenses } from './damageUtils.js';
import { rollDamageFormula } from './diceFormula.js';
import {
  buildCarrierContext,
  collectActiveEffects,
  collectBonusRollFormulas,
  resolveActorStats,
} from './effectPipeline.js';
import { resetTriggerUsage } from './effectTriggerUsage.js';
import { buildFormulaContext } from './formulaParser.js';
import { limitEntityHealing } from './healingLimits.js';
import {
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
  writeEntityHitPoints,
} from './hitPoints.js';
import { expandDamageParts } from './spellUtils.js';

/** Период лимита, который заканчивается с концом хода */
const TURN_LIMIT_PERIODS = ['turn'] as const;

/** Период лимита, который заканчивается с новым раундом */
const ROUND_LIMIT_PERIODS = ['round'] as const;

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
  // Новый раунд заканчивает период лимита «раз в раунд»
  const usageReset = resetTriggerUsage(entity, ROUND_LIMIT_PERIODS);

  if (!entity.activeEffects || entity.activeEffects.length === 0) {
    return usageReset;
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

  return (
    usageReset || hasChanges || entity.activeEffects.length !== initialLength
  );
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
 * Эффект в момент наложения на носителя: наложивший запоминается всегда, точная
 * длительность хода инициализируется. По наложившему работают «ход
 * наложившего» у срабатываний, якорь длительности `source` и условие «цель
 * помечена мной» — путь наложения без него терял все три.
 *
 * @param effect - накладываемый эффект
 * @param context - носитель, наложивший и текущий ход
 * @returns эффект с наложившим и инициализированной turn-длительностью
 */
export function stampAppliedEffect(
  effect: ActiveEffect,
  context: TurnDurationContext,
): ActiveEffect {
  return stampTurnDuration(
    { ...effect, sourceActorId: context.sourceId ?? effect.sourceActorId },
    context,
  );
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
  // Конец любого хода боя заканчивает период лимита «раз в ход». Не начало:
  // эффекты начала хода срабатывают раньше, чем ядро зовёт эту границу
  const usageReset =
    timing === 'end' && resetTriggerUsage(entity, TURN_LIMIT_PERIODS);

  if (!entity.activeEffects || entity.activeEffects.length === 0) {
    return usageReset;
  }

  let changed = usageReset;

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

    // Переключаемый эффект по истечении выключается, а не уходит с листа
    if (isToggleActivatedEffect(effect)) {
      effect.disabled = true;
      effect.duration = { ...duration, turnSkipFirst: undefined };

      return true;
    }

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
  /**
   * Все отложенные срабатывания хода по порядку: урон своих эффектов, урон аур,
   * затем снятие. Прежние списки эффектов выше — их подмножества.
   */
  deferredTriggers: DeferredTurnTrigger[];
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
  /**
   * Прогон хода НАЛОЖИВШЕГО: чей ход идёт. Тогда срабатывают только
   * срабатывания «ход наложившего» эффектов, наложенных этим участником; без
   * поля — ход самой сущности.
   */
  sourceTurnActorId?: string;
  /**
   * Участвует ли наложивший в бою. Срабатывание «ход наложившего», чей
   * наложивший не в бою (или неизвестен), идёт на ходу носителя — так же
   * деградирует якорь длительности `source`. Без поля (старое ядро) — не в бою.
   */
  isSourceInCombat?: (sourceId: string) => boolean;
  /** Закончить каст эффекта: действие «Закончить каст» */
  endCast?: (effect: ActiveEffect) => void;
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
  /** Спасбросок навязан именно заклинанием */
  againstSpell?: boolean;
  /** Состояние, которого спасбросок позволяет избежать */
  againstCondition?: ConditionRef;
  /** Спасбросок концентрации */
  againstConcentration?: boolean;
  /** Преимущество или помеха самого спасброска */
  mode?: 'advantage' | 'disadvantage';
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
export function isMagicalEffect(effect: ActiveEffect): boolean {
  // Копия эффекта зоны заклинания и статус от входа в неё уже не `spell`, но
  // навязаны той же магией
  return effect.origin === 'spell' || effect.magical === true;
}

/**
 * Против чего спасбросок эффекта: магии и заклинания. Магия эффектов в системе
 * приходит только от заклинаний — самого эффекта заклинания и копий из его
 * зоны, — поэтому оба признака пока совпадают.
 *
 * @param effect - эффект, требующий спасброска
 * @returns обстоятельства спасброска
 */
export function resolveEffectMagicCircumstances(
  effect: ActiveEffect,
): Pick<SavingThrowCircumstances, 'againstMagic' | 'againstSpell'> {
  const againstMagic = isMagicalEffect(effect);

  return { againstMagic, againstSpell: againstMagic };
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
    ...resolveEffectMagicCircumstances(effect),
    againstCondition: effect.conditionKey,
  };
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

  const modifier = resolveSavingThrowModifier(stats, ability, circumstances);

  // Те же обстоятельства, что и у спасброска на клиенте: иначе серверный и
  // клиентский бросок одного эффекта давали бы разное преимущество
  const rollMode = resolveSavingThrowRollMode({
    flags: activeFlags,
    ability,
    againstMagic: circumstances?.againstMagic,
    againstSpell: circumstances?.againstSpell,
    againstCondition: circumstances?.againstCondition,
    againstConcentration: circumstances?.againstConcentration,
    mode: circumstances?.mode,
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

  const bonusDiceFormulas = listSavingThrowBonusKeys(
    ability,
    circumstances,
  ).flatMap((bonusKey) =>
    collectBonusRollFormulas(
      context.effects,
      bonusKey,
      { hasAdvantage, hasDisadvantage, self: context.self },
      context.formulaContext,
    ),
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
  return rollEffectSaveWithContext(
    spec,
    resolveActorStats(entity, [...ambientEffects]),
    buildEffectSavingThrowContext(entity, ambientEffects),
  );
}

/**
 * Бросает спасбросок эффекта по уже собранным статам и контексту: серия
 * спасбросков хода пересобирает контекст между бросками сама.
 *
 * @param spec - что бросать
 * @param stats - resolved-статы бросающего
 * @param context - контекст спасброска
 * @returns исход спасброска
 */
export function rollEffectSaveWithContext(
  spec: EffectSaveSpec,
  stats: ResolvedActorStats,
  context: EffectSavingThrowContext,
): TurnSaveOutcome {
  const { roll, total, passed } = rollEffectSavingThrow(
    spec.ability,
    spec.dc,
    stats,
    context,
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

/** Бросок формулы урона: итог и выпавшие кости */
export type DamageFormulaRoller = (formula: string) => {
  total: number;
  values: number[];
};

/** Как катать урон эффекта */
export interface EffectDamageRollOptions {
  /** Доля урона по исходу спасброска: 1 — полный, 0.5 — половина */
  scale?: number;
  /** Чем катать кости; по умолчанию — генератор движка (клиент даёт свои кубики) */
  rollFormula?: DamageFormulaRoller;
}

/** Одна часть урона эффекта после доли и защит — строка чата */
export interface EffectDamageRollLine {
  formula: string;
  type?: string;
  types?: string[];
  /** Выпавшие кости */
  values: number[];
  /** Урон части после доли спасброска и защит цели */
  applied: number;
  /** Сработавшая защита цели на этой части */
  outcome: DamageDefenseOutcome;
}

/** Урон эффекта по частям */
export interface EffectDamageRoll {
  /** Итог урона после доли и защит */
  total: number;
  /** Типы урона всех частей */
  types: string[];
  /** Все выпавшие кости */
  values: number[];
  /** Последняя сработавшая защита цели */
  outcome: DamageDefenseOutcome;
  lines: EffectDamageRollLine[];
}

/**
 * Делит урон частей по доле спасброска. Половина берётся от суммы, а не от
 * каждой части: «3 + 3, половина» — 3, а не 1 + 1. Остаток округления уходит
 * частям с наибольшей дробью.
 *
 * @param totals - урон частей
 * @param scale - доля
 * @returns урон частей после доли
 */
function scaleDamageTotals(totals: readonly number[], scale: number): number[] {
  if (scale === 1) {
    return [...totals];
  }

  const exact = totals.map((total) => total * scale);
  const scaled = exact.map((value) => Math.floor(value));
  const target = Math.floor(exact.reduce((sum, value) => sum + value, 0));

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - scaled[index] }))
    .sort((left, right) => right.remainder - left.remainder);

  let leftover = target - scaled.reduce((sum, value) => sum + value, 0);

  for (const { index } of byRemainder) {
    if (leftover <= 0) {
      break;
    }

    scaled[index] += 1;
    leftover -= 1;
  }

  return scaled;
}

/**
 * Катает урон нагрузки `DamagePart[]` по частям: кости, доля спасброска, затем
 * защиты цели (по правилам сопротивление применяется после прочих изменений).
 * Сегментирует части (`@dmg.<type>`); лечащие части и контекстные `@`-формулы
 * пропускаются — источник не подставил их числа.
 *
 * Условные слагаемые (`@target.full`, `@target.type.undead`) ядро развернуло в
 * ветки с гейтами — здесь они сверяются с самой целью
 * ({@link damageReachesTarget}). Без сверки катались бы ВСЕ ветки сразу, и
 * «взаимоисключающие» `@target.full`/`@target.notFull` давали бы двойной урон.
 *
 * Один бросок на сервер и клиент: эффект на цели при попадании, срабатывания
 * хода, входа и выхода.
 *
 * @param damageParts - части урона эффекта
 * @param stats - resolved-статы цели (нужны защиты от урона)
 * @param entity - сущность-цель (нужна для гейтов условных веток)
 * @param options - доля и бросок костей
 * @returns урон по частям
 */
export function rollEffectDamageParts(
  damageParts: DamagePart[],
  stats: ResolvedActorStats,
  entity: DnDSceneEntity,
  options: EffectDamageRollOptions = {},
): EffectDamageRoll {
  const { scale = 1, rollFormula = rollDamageFormula } = options;

  const segments = expandDamageParts(
    damageParts,
    undefined,
    (formula) => formula,
  ).filter(
    (segment) =>
      !segment.isHealing
      && !segment.formula.includes('@')
      && damageReachesTarget(segment, entity),
  );

  const rolls = segments.map((segment) => rollFormula(segment.formula));

  const scaledTotals = scaleDamageTotals(
    rolls.map((rolled) => Math.max(0, rolled.total)),
    scale,
  );

  const result: EffectDamageRoll = {
    total: 0,
    types: [],
    values: [],
    outcome: 'normal',
    lines: [],
  };

  for (const [index, segment] of segments.entries()) {
    const types = segment.types ?? (segment.type ? [segment.type] : []);

    const defense =
      types.length > 0
        ? applyMultiTypeDamageDefenses(
            scaledTotals[index],
            types,
            stats.damageDefenses,
          )
        : { finalDamage: scaledTotals[index], outcome: 'normal' as const };

    for (const type of types) {
      if (!result.types.includes(type)) {
        result.types.push(type);
      }
    }

    if (defense.outcome !== 'normal') {
      result.outcome = defense.outcome;
    }

    result.total += defense.finalDamage;
    result.values.push(...rolls[index].values);

    result.lines.push({
      formula: segment.formula,
      ...(segment.type ? { type: segment.type } : {}),
      ...(segment.types ? { types: segment.types } : {}),
      values: rolls[index].values,
      applied: defense.finalDamage,
      outcome: defense.outcome,
    });
  }

  return result;
}

/**
 * Урон нагрузки эффекта одним исходом для подписи в чате
 * ({@link rollEffectDamageParts}).
 *
 * @param effectName - название эффекта (для подписи)
 * @param damageParts - части урона эффекта
 * @param stats - resolved-статы цели (нужны защиты от урона)
 * @param entity - сущность-цель (нужна для гейтов условных веток)
 * @param options - доля и бросок костей
 * @returns исход урона или `null`, если урона не получилось
 */
export function rollEffectDamage(
  effectName: string,
  damageParts: DamagePart[],
  stats: ResolvedActorStats,
  entity: DnDSceneEntity,
  options: EffectDamageRollOptions = {},
): TurnDamageOutcome | null {
  const rolled = rollEffectDamageParts(damageParts, stats, entity, options);

  if (rolled.total <= 0) {
    return null;
  }

  return {
    effectName,
    total: rolled.total,
    types: rolled.types,
    values: rolled.values,
  };
}

/** Откуда пришёл разовый эффект */
export interface EntryEffectOptions {
  /** Зона, в которую вошли или из которой вышли; у ауры поля нет */
  sourceAreaId?: string;
  /** Ауры чужих токенов, накрывающие сущность (спасбросок, иммунитеты) */
  ambientEffects?: readonly ActiveEffect[];
  /**
   * Чей сейчас ход: состояние «до конца следующего хода», наложенное на ходу
   * своего якоря, не спадает в конце этого же хода.
   */
  activeTurnActorId?: string | null;
  /**
   * Закончить каст эффекта: действие «Закончить каст». Без поля (клиент,
   * старое ядро) снимается только сам эффект.
   */
  endCast?: (effect: ActiveEffect) => void;
  /** Урон события: `@damage` действия «Максимум хитов уменьшается» */
  eventDamage?: number;
  /**
   * Не привязывать наложенное к касту: наложения «когда заклинание
   * заканчивается» переживают сам каст.
   */
  detachFromCast?: boolean;
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
export function applyTurnHealing(
  entity: DnDSceneEntity,
  healed: number,
  tempHp: number,
): boolean {
  const allowed = limitEntityHealing(entity, {
    hitPoints: healed,
    temporary: tempHp,
  });

  const current = resolveEntityCurrentHp(entity);
  const max = resolveEntityMaxHp(entity);
  const temp = resolveEntityTempHp(entity);
  const nextCurrent = Math.min(max, current + allowed.hitPoints);
  const nextTemp = Math.max(temp, allowed.temporary);

  if (nextCurrent === current && nextTemp === temp) {
    return false;
  }

  writeEntityHitPoints(entity, { current: nextCurrent, temp: nextTemp });

  return true;
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

/** Подпись момента хода наложившего в сводке эффектов */
const SOURCE_TURN_SUMMARY_LABELS: Record<EffectSaveTiming, string> = {
  startOfTurn: 'начало хода наложившего',
  endOfTurn: 'конец хода наложившего',
};

/**
 * Подпись момента хода в сводке: ход носителя или наложившего.
 *
 * @param timing - момент хода
 * @param turnOf - чей ход
 * @returns подпись момента
 */
export function resolveTurnSummaryLabel(
  timing: EffectSaveTiming,
  turnOf: EffectTriggerTurnOwner = 'subject',
): string {
  return turnOf === 'source'
    ? SOURCE_TURN_SUMMARY_LABELS[timing]
    : TURN_TIMING_SUMMARY_LABELS[timing];
}

/**
 * Форматирует сводку периодических эффектов за тик хода в текст для чата.
 *
 * @param entityName - имя сущности
 * @param timing - момент хода (начало/конец)
 * @param result - результат `processTurnEffects`
 * @param turnOf - чей ход: носителя или наложившего
 * @returns строка для чата или `null`, если показывать нечего
 */
export function formatTurnEffectsMessage(
  entityName: string,
  timing: EffectSaveTiming,
  result: TurnEffectsResult,
  turnOf: EffectTriggerTurnOwner = 'subject',
): string | null {
  return formatEffectsSummary(
    entityName,
    resolveTurnSummaryLabel(timing, turnOf),
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
