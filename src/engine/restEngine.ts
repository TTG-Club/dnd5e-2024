/**
 * Движок отдыха D&D 5e (короткий / продолжительный).
 *
 * Чистые функции вычисляют патч сущности при отдыхе: восстанавливают
 * счётчики классов, заряды заклинаний и предметов, ячейки заклинаний и хиты в
 * зависимости от типа отдыха и прописанного для ресурса способа отката.
 * Используется кнопками отдыха в листах актора и существа.
 *
 * Порядок отдыха один у персонажа и существа: отдых возвращает своё (ресурсы,
 * кости хитов, хиты, степень Истощения) → срабатывания «после отдыха»
 * выполняются на уже отдохнувшей сущности → хиты поднимаются ещё раз, если
 * срабатывание сняло то, что их держало. Срабатывание отдыха с вопросом или
 * ценой выполняется только по ответу владельца (`askRestTriggers`).
 *
 * Трата зарядов предмета живёт отдельно — см. `itemUses.ts`.
 */

import type { ActiveEffect, EffectFlagKey } from './activeEffectTypes.js';
import type { ActorClassEntry } from './classTypes.js';
import type {
  DnDActor,
  DnDCreature,
  DnDGameItem,
  DnDSceneEntity,
  ItemUsesRecovery,
  Spell,
  SpellUsesRecovery,
} from './dndEntities.js';
import type {
  EffectTriggerSource,
  SelfTriggerAnswers,
  SelfTriggerReport,
} from './effectTriggerRunner.js';
import type {
  EffectTrigger,
  EffectTriggerRestType,
} from './effectTriggerTypes.js';
import type { FormulaContext } from './formulaParser.js';
import type { EffectPromptAsker } from './triggerPrompt.js';
import type { ActorCounterState, DnDActorSystem } from './types.js';

import { isCreatureEntity } from '@vtt/shared';

import {
  EXHAUSTION_LONG_REST_RECOVERY,
  getEntityExhaustionLevel,
  withExhaustionLevel,
} from './conditionTemplates.js';
import {
  buildCounterFormulaContext,
  getCounterRecoveryAmount,
  getCounterRecoveryRules,
  isCounterAvailable,
  resolveCounterMaxIn,
} from './counterResource.js';
import { restoreCreatureSpellGroupUses } from './creatureSpellcasting.js';
import { cloneEntityData } from './dataClone.js';
import { askSelfTriggers } from './deferredEffectSaves.js';
import { resolveActorStats } from './effectPipeline.js';
import {
  listCarrierEventSources,
  settleSelfTriggerSources,
} from './effectTriggerRunner.js';
import { listEffectEventTriggers } from './effectTriggers.js';
import { DEFAULT_TRIGGER_REST_TYPE } from './effectTriggerTypes.js';
import { pruneTriggerUsage, restLimitPeriodsOf } from './effectTriggerUsage.js';
import { canEntityRegainHitPoints } from './healingLimits.js';
import {
  getHalfHitDiceRecovery,
  getHitDiceGroups,
  recoverHitDice,
} from './hitDiceUtils.js';
import { resolveEntityCurrentHp, resolveEntityMaxHp } from './hitPoints.js';

/** Тип отдыха */
export type RestType = 'short' | 'long';

/** С чем выполняются срабатывания «после отдыха» */
export interface RestTriggerOptions {
  /**
   * Ответы владельца на вопросы срабатываний отдыха ({@link askRestTriggers}).
   * Срабатывание с галочкой «спрашивать» или ценой ресурсом без ответа не
   * выполняется — в том числе когда поля нет вовсе: спросить было некому
   */
  triggerAnswers?: SelfTriggerAnswers;
  /** Куда складывать сводку срабатываний отдыха для чата; нет — она не нужна */
  triggerReport?: SelfTriggerReport;
}

/** Параметры продолжительного отдыха */
export interface LongRestOptions extends RestTriggerOptions {
  /** Вернуть ВСЕ потраченные кости хитов (домашнее правило вместо половины) */
  recoverAllHitDice?: boolean;
  /**
   * Выпавшие числа возврата зарядов по id предмета — для предметов с формулой
   * (`uses.formula`). Собирается модалкой отдыха из
   * {@link collectItemChargeRolls}; предмет без записи здесь восстанавливается
   * до максимума.
   */
  itemChargeRolls?: Record<string, number>;
}

/**
 * Предпросмотр продолжительного отдыха — что и сколько будет восстановлено.
 * Используется модалкой долгого отдыха для отображения итогов до подтверждения.
 */
export interface LongRestPreview {
  /** Хиты: текущие, максимум и насколько поднимутся */
  hitPoints: { current: number; max: number; restored: number };
  /** Временные хиты, которые будут сброшены */
  tempHitPointsCleared: number;
  /** Кости хитов: всего, потрачено, вернётся по правилам и при «вернуть все» */
  hitDice: {
    total: number;
    used: number;
    recoverHalf: number;
    recoverAll: number;
  };
  /** Сколько использованных ячеек заклинаний (вкл. пактовые) восстановится */
  spellSlotsRestored: number;
  /** Сколько классовых счётчиков восстановится */
  countersRestored: number;
  /** Сколько заклинаний восстановят заряды */
  spellChargesRestored: number;
  /** Сколько предметов инвентаря восстановят заряды */
  itemChargesRestored: number;
  /** Истощение: степень сейчас и какой станет после отдыха */
  exhaustion: { level: number; levelAfterRest: number };
}

/**
 * Результат броска костей хитов из модалки короткого отдыха.
 * Случайный бросок выполняется на клиенте (diceRollerStore), сюда приходит
 * уже вычисленное лечение и обновлённые счётчики потраченных костей.
 */
export interface ShortRestHitDiceResult {
  /** Новое значение текущих хитов (после лечения, не выше максимума) */
  hitPointsCurrent: number;
  /** Классы с обновлённым `hitDiceUsed` */
  classes: ActorClassEntry[];
  /** Ручные кости хитов с обновлённым `used` */
  manualHitDice?: DnDActorSystem['manualHitDice'];
}

/**
 * Восстанавливаются ли заряды с данным способом отката при этом типе отдыха.
 * Продолжительный отдых включает в себя эффект короткого.
 *
 * Счётчики ресурсов сюда не ходят: у них восстановление раздельное по видам
 * отдыха и с количеством (`counterResource.getCounterRecoveryRules`), а не
 * «всё или ничего».
 *
 * @param recovery - способ отката зарядов заклинания или предмета
 * @param restType - тип совершённого отдыха
 * @returns true, если заряды нужно восстановить до максимума
 */
function recoveryMatchesRest(
  recovery: SpellUsesRecovery | ItemUsesRecovery,
  restType: RestType,
): boolean {
  if (recovery === 'shortRest') {
    return true;
  }

  // «На рассвете» откатывается вместе с продолжительным отдыхом — отдельного
  // счётчика игрового времени у листа нет (см. `ItemUsesRecovery`).
  if (recovery === 'longRest' || recovery === 'dawn') {
    return restType === 'long';
  }

  return false;
}

/**
 * Возвращает копию счётчика класса с зарядами, которые вернул отдых.
 *
 * Отдых именно ДОБАВЛЯЕТ заряды, а не выставляет максимум: правило ресурса
 * может возвращать не всё, а одну штуку («Удача клинка» — заряд за короткий
 * отдых), и «до максимума» вернуло бы больше положенного.
 *
 * Максимум берётся посчитанным, а не записанным: у ресурса с формулой записанное
 * число — снимок последнего расчёта, и после повышения уровня отдых восполнял бы
 * его до прежнего потолка. Свежий максимум заодно сохраняется в счётчик.
 *
 * @param counter - текущее состояние счётчика
 * @param restType - тип совершённого отдыха
 * @param context - `@`-переменные листа для формулы максимума
 * @returns счётчик (новый объект при восстановлении)
 */
function restoreCounter(
  counter: ActorCounterState,
  restType: RestType,
  context: FormulaContext,
): ActorCounterState {
  const max = resolveCounterMaxIn(context, counter);
  const rules = getCounterRecoveryRules(counter);

  const restored = getCounterRecoveryAmount(
    restType === 'short' ? rules.shortRest : rules.longRest,
    max,
  );

  if (restored === 0 && max === counter.max) {
    return counter;
  }

  return {
    ...counter,
    max,
    current: Math.min(Math.max(counter.current + restored, 0), max),
  };
}

/**
 * Возвращает копию заклинания с восстановленными зарядами, если способ отката
 * зарядов соответствует типу отдыха; иначе — исходное заклинание. Заклинания
 * без зарядов или «по желанию» не изменяются.
 *
 * @param spell - заклинание
 * @param restType - тип совершённого отдыха
 * @returns заклинание (новый объект при восстановлении зарядов)
 */
function restoreSpellUses(spell: Spell, restType: RestType): Spell {
  if (!spell.uses || spell.uses.recovery === 'atWill') {
    return spell;
  }

  if (recoveryMatchesRest(spell.uses.recovery, restType)) {
    return { ...spell, uses: { ...spell.uses, current: spell.uses.max } };
  }

  return spell;
}

/**
 * Восстанавливает ли предмет заряды при этом отдыхе — и не полон ли он уже.
 * Общая проверка для патча отдыха и для предпросмотра, чтобы модалка и сам
 * отдых не разошлись в том, что считается восстановлением.
 *
 * @param item - предмет инвентаря
 * @param restType - тип совершённого отдыха
 */
function itemUsesRecoverable(item: DnDGameItem, restType: RestType): boolean {
  return (
    item.uses !== undefined
    && item.uses.current < item.uses.max
    && recoveryMatchesRest(item.uses.recovery, restType)
  );
}

/**
 * Возвращает копию предмета с восстановленными зарядами, если способ отката
 * соответствует типу отдыха; иначе — исходный предмет.
 *
 * Предмет с формулой возврата (`uses.formula`) ждёт результата броска: сам
 * движок кости не бросает. Пришёл бросок — прибавляем его к остатку, не выше
 * максимума; не пришёл — восстанавливаем до максимума, чтобы предмет не завис
 * пустым из-за того, что вызывающий не умеет бросать.
 *
 * @param item - предмет инвентаря
 * @param restType - тип совершённого отдыха
 * @param roll - выпавшее число возврата для этого предмета
 * @returns предмет (новый объект при восстановлении зарядов)
 */
function restoreItemUses(
  item: DnDGameItem,
  restType: RestType,
  roll: number | undefined,
): DnDGameItem {
  if (!item.uses || !itemUsesRecoverable(item, restType)) {
    return item;
  }

  const restored =
    item.uses.formula && roll !== undefined
      ? Math.min(item.uses.max, item.uses.current + roll)
      : item.uses.max;

  return { ...item, uses: { ...item.uses, current: restored } };
}

/**
 * Предметы, которым для отката зарядов нужен бросок — модалка отдыха бросает их
 * формулы и передаёт результат в {@link LongRestOptions.itemChargeRolls}.
 *
 * @param actor - актор
 * @param restType - тип совершённого отдыха
 * @returns предметы с формулой возврата, у которых есть что восстанавливать
 */
export function collectItemChargeRolls(
  actor: DnDActor,
  restType: RestType,
): Array<{ id: string; name: string; formula: string }> {
  return (actor.equipment ?? [])
    .filter(
      (item) =>
        itemUsesRecoverable(item, restType) && Boolean(item.uses?.formula),
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      formula: item.uses?.formula ?? '',
    }));
}

/**
 * Запускает ли отдых срабатывание: «любой» — всякий, иначе — свой.
 *
 * @param triggerRest - отдых срабатывания
 * @param restType - совершённый отдых
 * @returns `true`, если срабатывание выполняется
 */
function restTriggerMatches(
  triggerRest: EffectTriggerRestType,
  restType: RestType,
): boolean {
  return triggerRest === 'any' || triggerRest === restType;
}

/** Ответов нет: владельца о срабатываниях отдыха никто не спрашивал */
const NO_REST_TRIGGER_ANSWERS: SelfTriggerAnswers = new Map();

/**
 * Срабатывания «после отдыха» на всём, что действует вместе с сущностью: её
 * эффекты, надетые предметы, черты существа.
 *
 * @param entity - персонаж или существо
 * @param restType - совершённый отдых
 * @returns срабатывания с источником
 */
function listRestTriggerSources(
  entity: DnDSceneEntity,
  restType: RestType,
): EffectTriggerSource[] {
  const restTriggersOf = (effect: ActiveEffect): EffectTrigger[] =>
    listEffectEventTriggers(effect, 'rest').filter((trigger) =>
      restTriggerMatches(
        trigger.restType ?? DEFAULT_TRIGGER_REST_TYPE,
        restType,
      ),
    );

  return listCarrierEventSources(entity, restTriggersOf);
}

/**
 * Сущность после срабатываний «после отдыха»: снятие, отметки, состояния,
 * списанная цена, возвращённые ресурсы, урон и лечение.
 *
 * Сущность приходит из стора хоста — срабатывания идут на её JSON-копии.
 * Срабатывание с вопросом или ценой выполняется только по ответу владельца;
 * отменённое оставляет строку в сводке.
 *
 * @param entity - персонаж или существо, которому отдых уже вернул своё
 * @param restType - совершённый отдых
 * @param options - ответы владельца и сбор сводки
 * @returns копия после срабатываний либо `null`, если срабатывать нечему
 */
function settleRestTriggers<Entity extends DnDSceneEntity>(
  entity: Entity,
  restType: RestType,
  options: RestTriggerOptions,
): Entity | null {
  if (listRestTriggerSources(entity, restType).length === 0) {
    return null;
  }

  const rested = cloneEntityData(entity);

  settleSelfTriggerSources(rested, listRestTriggerSources(rested, restType), {
    answers: options.triggerAnswers ?? NO_REST_TRIGGER_ANSWERS,
    ...(options.triggerReport ? { report: options.triggerReport } : {}),
  });

  return rested;
}

/**
 * Текущие хиты после срабатываний продолжительного отдыха.
 *
 * Отдых поднял хиты до срабатываний, поэтому срабатывание, снявшее то, что их
 * держало (уменьшение максимума, запрет лечения), поднимает их ещё раз — до
 * нового потолка. Хиты, которые срабатывание изменило само (урон, лечение),
 * остаются как есть: это уже то, что случилось после отдыха.
 *
 * @param recovered - сущность после возврата отдыха, до срабатываний
 * @param rested - сущность после срабатываний
 * @returns текущие хиты
 */
function resolveRestedHitPoints(
  recovered: DnDSceneEntity,
  rested: DnDSceneEntity,
): number {
  const current = resolveEntityCurrentHp(rested);

  if (
    current !== resolveEntityCurrentHp(recovered)
    || !canEntityRegainHitPoints(rested)
  ) {
    return current;
  }

  const restedMax = resolveEntityMaxHp(rested);

  // Нуль — запаса в записи нет (текстовые хиты существа): оставляем что есть
  return restedMax > 0 ? restedMax : current;
}

/** Флаги «отдых не приносит пользы» по виду отдыха */
const REST_BLOCKED_FLAGS: Record<RestType, EffectFlagKey> = {
  short: 'rest.noBenefit.short',
  long: 'rest.noBenefit.long',
};

/**
 * Не приносит ли отдых пользы этому актёру.
 *
 * @param actor - отдыхающий
 * @param restType - короткий или продолжительный отдых
 * @returns `true`, если польза отдыха отменена
 */
function isRestBlocked(actor: DnDActor, restType: RestType): boolean {
  return resolveActorStats(actor).activeFlags.has(REST_BLOCKED_FLAGS[restType]);
}

/**
 * Актор, которому отдых вернул своё, — до срабатываний «после отдыха».
 *
 * Короткий отдых: пактовые ячейки, счётчики с откатом 'short', заряды
 * заклинаний и предметов 'shortRest'. Продолжительный — дополнительно: все
 * ячейки заклинаний, счётчики 'long', заряды 'longRest' и 'dawn', кости хитов,
 * хиты до максимума, сброс временных хитов и одна степень Истощения.
 *
 * @param actor - актор
 * @param restType - тип отдыха
 * @param options - параметры долгого отдыха (напр. вернуть все кости хитов)
 * @returns актор после возврата отдыха
 */
function recoverActor(
  actor: DnDActor,
  restType: RestType,
  options: LongRestOptions,
): DnDActor {
  const system = actor.system;

  // Контекст формул собирается один раз на весь список счётчиков
  const counterContext = buildCounterFormulaContext(actor);

  const restoredSystem: DnDActorSystem = {
    ...system,
    // Отдых заканчивает периоды лимитов «раз в отдых» у срабатываний эффектов
    ...(system.effectUsage === undefined
      ? {}
      : {
          effectUsage: pruneTriggerUsage(actor, restLimitPeriodsOf(restType)),
        }),
    // Пактовая магия восстанавливается и коротким, и продолжительным отдыхом
    pactSlotsUsed: 0,
    classCounters: system.classCounters.map((counter) =>
      restoreCounter(counter, restType, counterContext),
    ),
  };

  // Продолжительный отдых снимает одну степень Истощения (PHB 2024). Список
  // эффектов меняется, только когда есть что снимать: пустой `activeEffects`
  // перетёр бы эффекты, которых отдых не касается
  const exhaustionLevel =
    restType === 'long' ? getEntityExhaustionLevel(actor.activeEffects) : 0;

  const relieved: DnDActor =
    exhaustionLevel > 0
      ? {
          ...actor,
          activeEffects: withExhaustionLevel(
            actor.activeEffects ?? [],
            exhaustionLevel - EXHAUSTION_LONG_REST_RECOVERY,
          ),
        }
      : actor;

  if (restType === 'long') {
    // Долгий отдых: все ячейки «не использованы», хиты до максимума, temp сброшен
    restoredSystem.spellSlotsUsed = [];

    // Максимум — с прибавкой эффектов (`hitPoints.max`), тот же, что в плитке
    // листа: «полные хиты» после отдыха обязаны совпасть с показанным потолком,
    // иначе чародей с «Драконьей устойчивостью» вставал бы 26/29
    restoredSystem.hitPoints = {
      ...system.hitPoints,
      // Запрет лечения держит хиты и через отдых
      current: canEntityRegainHitPoints(relieved)
        ? resolveEntityMaxHp(relieved)
        : system.hitPoints.current,
      temp: 0,
    };

    // Возвращается до половины потраченных костей хитов (минимум 1),
    // либо все — при включённом домашнем правиле
    const recovered = recoverHitDice(
      system.classes,
      system.manualHitDice,
      options.recoverAllHitDice ?? false,
    );

    restoredSystem.classes = recovered.classes;

    if (system.manualHitDice) {
      restoredSystem.manualHitDice = recovered.manualHitDice;
    }
  }

  const rolls = options.itemChargeRolls ?? {};

  return {
    ...relieved,
    spells: actor.spells.map((spell) => restoreSpellUses(spell, restType)),
    equipment: (actor.equipment ?? []).map((item) =>
      restoreItemUses(item, restType, rolls[item.id]),
    ),
    system: restoredSystem,
  };
}

/**
 * Сущность, которой отдых вернул своё, — до срабатываний «после отдыха». По
 * ней считается цена срабатываний отдыха и задаются вопросы владельцу.
 * Отдых без пользы ничего не возвращает — сущность остаётся как есть.
 *
 * @param entity - персонаж или существо
 * @param restType - тип отдыха
 * @param options - параметры долгого отдыха
 * @returns сущность после возврата отдыха
 */
function recoverRestEntity(
  entity: DnDActor | DnDCreature,
  restType: RestType,
  options: LongRestOptions,
): DnDActor | DnDCreature {
  if (isCreatureEntity(entity)) {
    return recoverCreature(entity, restType);
  }

  return isRestBlocked(entity, restType)
    ? entity
    : recoverActor(entity, restType, options);
}

/**
 * Спрашивает владельца о срабатываниях «после отдыха» с галочкой
 * «спрашивать» или ценой ресурсом: согласие и чем платить. Вопрос задаётся по
 * уже отдохнувшей сущности: «половина оставшихся Костей Хитов» считается
 * после возврата костей. Ответы уходят в сам отдых
 * (`RestTriggerOptions.triggerAnswers`).
 *
 * @param entity - персонаж или существо до отдыха
 * @param restType - тип отдыха
 * @param ask - кто задаёт вопрос человеку (плашка стола)
 * @param options - параметры долгого отдыха: от них зависит, что вернётся
 * @returns ответы владельца; пусто — спрашивать было не о чем или отказ
 */
export function askRestTriggers(
  entity: DnDActor | DnDCreature,
  restType: RestType,
  ask: EffectPromptAsker,
  options: LongRestOptions = {},
): Promise<SelfTriggerAnswers> {
  const recovered = recoverRestEntity(entity, restType, options);

  return askSelfTriggers(
    recovered,
    listRestTriggerSources(recovered, restType),
    ask,
  );
}

/**
 * Вычисляет патч актора при отдыхе: отдых возвращает своё
 * ({@link recoverActor}), затем на отдохнувшем акторе идут срабатывания
 * «после отдыха» — и всё, что они сделали (эффекты, списанная цена, урон и
 * лечение), входит в патч.
 *
 * @param actor - актор
 * @param restType - тип отдыха
 * @param options - параметры долгого отдыха и ответы на вопросы срабатываний
 * @returns частичный патч актора для emit('update:actor', ...)
 */
export function applyActorRest(
  actor: DnDActor,
  restType: RestType,
  options: LongRestOptions = {},
): Partial<DnDActor> {
  // «Отдых не приносит пользы» («Проклятие бессонницы»): ни ресурсов, ни
  // ячеек, ни хитов. Сами срабатывания «после отдыха» при этом идут — отдых
  // состоялся, польза от него не пришла
  if (isRestBlocked(actor, restType)) {
    const blocked = settleRestTriggers(actor, restType, options);

    return blocked
      ? {
          activeEffects: blocked.activeEffects ?? [],
          equipment: blocked.equipment,
          system: blocked.system,
        }
      : {};
  }

  const recovered = recoverActor(actor, restType, options);
  const rested = settleRestTriggers(recovered, restType, options);

  if (!rested) {
    return {
      spells: recovered.spells,
      equipment: recovered.equipment,
      system: recovered.system,
      ...(recovered.activeEffects === actor.activeEffects
        ? {}
        : { activeEffects: recovered.activeEffects }),
    };
  }

  return {
    spells: rested.spells,
    equipment: rested.equipment,
    system:
      restType === 'long'
        ? {
            ...rested.system,
            hitPoints: {
              ...rested.system.hitPoints,
              current: resolveRestedHitPoints(recovered, rested),
            },
          }
        : rested.system,
    activeEffects: rested.activeEffects ?? [],
  };
}

/**
 * Считает предпросмотр продолжительного отдыха актора: сколько хитов, костей
 * хитов, ячеек, счётчиков и зарядов будет восстановлено. Чистая функция,
 * ничего не мутирует — только агрегирует текущее состояние.
 *
 * @param actor - актор
 * @returns структура с итогами восстановления для отображения в модалке
 */
export function summarizeActorLongRest(actor: DnDActor): LongRestPreview {
  const system = actor.system;

  const groups = getHitDiceGroups(system.classes, system.manualHitDice);
  const totalHitDice = groups.reduce((sum, group) => sum + group.total, 0);
  const usedHitDice = groups.reduce((sum, group) => sum + group.used, 0);

  const spellSlotsUsed = (system.spellSlotsUsed ?? []).reduce(
    (sum, used) => sum + used,
    0,
  );

  const spellSlotsRestored = spellSlotsUsed + (system.pactSlotsUsed ?? 0);

  // Считаются только те, кому отдых и правда что-то вернёт: у ресурса с
  // откатом «ничего» пустой остаток так и останется пустым, а ресурс, до
  // первой ступени которого персонаж не дорос, на листе не показан вовсе
  const counterContext = buildCounterFormulaContext(actor);

  const countersRestored = system.classCounters.filter((counter) => {
    const max = resolveCounterMaxIn(counterContext, counter);

    return (
      isCounterAvailable(counter, max)
      && counter.current < max
      && getCounterRecoveryAmount(
        getCounterRecoveryRules(counter).longRest,
        max,
      ) > 0
    );
  }).length;

  const spellChargesRestored = actor.spells.filter((spell) => {
    if (!spell.uses || spell.uses.recovery === 'atWill') {
      return false;
    }

    return (
      recoveryMatchesRest(spell.uses.recovery, 'long')
      && spell.uses.current < spell.uses.max
    );
  }).length;

  const itemChargesRestored = (actor.equipment ?? []).filter((item) =>
    itemUsesRecoverable(item, 'long'),
  ).length;

  const exhaustionLevel = getEntityExhaustionLevel(actor.activeEffects);

  // Потолок предпросмотра — тот же, до которого поднимет отдых
  const maxHitPoints = resolveEntityMaxHp(actor);

  return {
    hitPoints: {
      current: system.hitPoints.current,
      max: maxHitPoints,
      restored: Math.max(0, maxHitPoints - system.hitPoints.current),
    },
    tempHitPointsCleared: system.hitPoints.temp,
    hitDice: {
      total: totalHitDice,
      used: usedHitDice,
      recoverHalf: getHalfHitDiceRecovery(system.classes, system.manualHitDice),
      recoverAll: usedHitDice,
    },
    spellSlotsRestored,
    countersRestored,
    spellChargesRestored,
    itemChargesRestored,
    exhaustion: {
      level: exhaustionLevel,
      levelAfterRest: Math.max(
        0,
        exhaustionLevel - EXHAUSTION_LONG_REST_RECOVERY,
      ),
    },
  };
}

/**
 * Актор после траты костей хитов в окне короткого отдыха: новые хиты и
 * счётчики потраченных костей. По нему считается сам отдых и вопросы его
 * срабатываний.
 *
 * @param actor - актор
 * @param hitDice - результат броска костей хитов из модалки
 * @returns актор с потраченными костями
 */
export function spendShortRestHitDice(
  actor: DnDActor,
  hitDice: ShortRestHitDiceResult,
): DnDActor {
  return {
    ...actor,
    system: {
      ...actor.system,
      classes: hitDice.classes,
      manualHitDice: hitDice.manualHitDice,
      hitPoints: {
        ...actor.system.hitPoints,
        current: canEntityRegainHitPoints(actor)
          ? hitDice.hitPointsCurrent
          : actor.system.hitPoints.current,
      },
    },
  };
}

/**
 * Короткий отдых с тратой костей хитов.
 *
 * Сначала на актора ложится результат броска костей хитов (новые текущие хиты
 * и счётчики потраченных костей), затем идёт обычный короткий отдых
 * (`applyActorRest(actor, 'short')` — пактовые ячейки, короткие счётчики,
 * заряды заклинаний 'shortRest') и его срабатывания: цена срабатывания
 * костями хитов списывается с того, что осталось после окна.
 *
 * @param actor - актор
 * @param hitDice - результат броска костей хитов из модалки
 * @param options - ответы на вопросы срабатываний и сбор сводки
 * @returns частичный патч актора для emit('update:actor', ...)
 */
export function applyShortRestWithHitDice(
  actor: DnDActor,
  hitDice: ShortRestHitDiceResult,
  options: RestTriggerOptions = {},
): Partial<DnDActor> {
  const spent = spendShortRestHitDice(actor, hitDice);
  const patch = applyActorRest(spent, 'short', options);

  // Отдых без пользы патча листа не даёт, а кости и хиты окна записать надо
  return { ...patch, system: patch.system ?? spent.system };
}

/**
 * Существо, которому отдых вернул своё, — до срабатываний «после отдыха».
 *
 * Восстанавливает заряды заклинаний существа (`Creature.spells`) и заряды
 * предметов его инвентаря по их способу отката; продолжительный отдых
 * дополнительно поднимает хиты до максимума и сбрасывает временные хиты.
 *
 * Броски восстановления зарядов (`ItemUses.formula`) существу не передаются, в
 * отличие от листа персонажа: окна отдыха с такими бросками у существа нет, и
 * предмет с формулой возврата восполняется до максимума. Упрощение того же
 * рода, что и плоские числа в статблоке.
 *
 * @param creature - существо
 * @param restType - тип отдыха
 * @returns существо после возврата отдыха
 */
function recoverCreature(
  creature: DnDCreature,
  restType: RestType,
): DnDCreature {
  let system = creature.system;

  // Отдых заканчивает периоды лимитов «раз в отдых» у срабатываний эффектов
  if (system.effectUsage !== undefined) {
    system = {
      ...system,
      effectUsage: pruneTriggerUsage(creature, restLimitPeriodsOf(restType)),
    };
  }

  // Порция «на весь список» держит счётчик у себя, а не у заклинаний: без этой
  // строки отдых вернул бы заряды «каждому», а общий счётчик оставил пустым
  const blocks = creature.system.spellcastingBlocks;

  if (blocks?.length) {
    system = {
      ...system,
      spellcastingBlocks: restoreCreatureSpellGroupUses(blocks, restType),
    };
  }

  if (restType === 'long') {
    const hitPoints = creature.system.hitPoints;

    // Потолок — с прибавкой эффектов, как и у актора (внутри `max` статблока,
    // иначе `average`). Нуль означает, что запаса в записи нет вовсе — у
    // существа с текстовыми хитами («половина хитов призывателя»); такому отдых
    // оставляет то, что есть, а не обнуляет его.
    const restoredMax = resolveEntityMaxHp(creature);

    system = {
      ...system,
      hitPoints: {
        ...hitPoints,
        current: restoredMax > 0 ? restoredMax : hitPoints.current,
        temp: 0,
      },
    };
  }

  return {
    ...creature,
    spells: (creature.spells ?? []).map((spell) =>
      restoreSpellUses(spell, restType),
    ),
    equipment: (creature.equipment ?? []).map((item) =>
      restoreItemUses(item, restType, undefined),
    ),
    system,
  };
}

/**
 * Вычисляет патч существа при отдыхе: отдых возвращает своё
 * ({@link recoverCreature}), затем на отдохнувшем существе идут срабатывания
 * «после отдыха» — и всё, что они сделали, входит в патч.
 *
 * @param creature - существо
 * @param restType - тип отдыха
 * @param options - ответы на вопросы срабатываний и сбор сводки
 * @returns частичный патч существа для emit('update:creature', ...)
 */
export function applyCreatureRest(
  creature: DnDCreature,
  restType: RestType,
  options: RestTriggerOptions = {},
): Partial<DnDCreature> {
  const recovered = recoverCreature(creature, restType);
  const rested = settleRestTriggers(recovered, restType, options);

  if (!rested) {
    return {
      spells: recovered.spells,
      equipment: recovered.equipment,
      ...(recovered.system === creature.system
        ? {}
        : { system: recovered.system }),
    };
  }

  return {
    spells: rested.spells,
    equipment: rested.equipment,
    system:
      restType === 'long'
        ? {
            ...rested.system,
            hitPoints: {
              ...rested.system.hitPoints,
              current: resolveRestedHitPoints(recovered, rested),
            },
          }
        : rested.system,
    activeEffects: rested.activeEffects ?? [],
  };
}
