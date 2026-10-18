/**
 * Режимы урона в карточке чата: «Половина» и «Крит» под нанесённым или
 * отменённым уроном атаки.
 *
 * Обе кнопки — переключатели над уже брошенным уроном записи
 * (`attackDamageRecord.ts`): урон не перебрасывается, меняется только то,
 * сколько его досталось цели.
 *
 * Правила расчёта:
 *
 * - **Половина** — половина итога цели после её защит, с округлением вниз
 *   (5e). Половинится не бросок, а уже посчитанный урон цели: сопротивление
 *   и уязвимость учтены один раз, как при ударе.
 * - **Крит** — к урону идут кости крита: кости формулы, брошенные ещё раз,
 *   без модификаторов (5e). У попадания, которое и было критом, кости крита
 *   выделены из броска при записи (`attackDamageRoll.ts`), и «Не крит»
 *   снимает ровно их.
 * - **Вместе** — половина от урона с костями крита.
 *
 * Полный урон цели в каждом режиме запоминается в записи, как посчитан
 * (`AttackDamageTotals`), поэтому переключение туда и обратно возвращает
 * ровно прежние хиты, даже если защиты цели с тех пор изменились.
 *
 * Над нанесённым уроном кнопки меняют только хиты — ровно на разницу между
 * режимами. Эффекты удара, спасброски от смерти и события урона не
 * трогаются: удар уже состоялся, меняется лишь его сила. Над отменённым
 * уроном кнопка наносит записанный бросок заново, как «Нанести урон», только
 * без переброса костей.
 *
 * @module system/dnd/attackDamageModes
 */

import type {
  AppliedDamagePart,
  AttackDamagePart,
  AttackDamageRecord,
  AttackDamageTarget,
  AttackDamageTotals,
  ResolvedRecordedDamage,
} from './attackDamageRecord.js';
import type { AttackDamagePartRoll } from './attackDamageRoll.js';
import type { HpChangeDetail } from './damageUtils.js';
import type { DnDSceneEntity } from './dndEntities.js';

import {
  captureHitConsequences,
  dealRecordedDamage,
  resolveModeDamage,
  resolveRecordedDamage,
  revertRecordedDamage,
} from './attackDamageRecord.js';
import { describeDamagePartRoll } from './attackDamageRoll.js';
import { doubleDiceInFormula } from './attackUtils.js';
import { applyHpChange } from './damageUtils.js';
import {
  isEntityHpShownToPlayers,
  resolveEntityCurrentHp,
  resolveEntityMaxHp,
  resolveEntityTempHp,
  writeEntityHitPoints,
} from './hitPoints.js';

/** Режимы урона карточки: что стоит в записи или что из неё сделать */
export interface AttackDamageModes {
  /** Урон идёт половиной */
  half: boolean;
  /** К урону идут кости крита */
  critical: boolean;
}

/** Брошенные кости крита одной части */
export interface CritDiceRoll {
  /** Номер части в `AttackDamageRecord.parts` */
  part: number;
  /** Сумма костей */
  total: number;
  /** Выпавшие кости — для подробностей карточки */
  values?: readonly number[];
}

/** Что нужно бросить, чтобы нанести урон записи заново */
export interface DamageRerollPlan {
  /** Формула броска: у части с критом кости в ней удвоены */
  formula: string;
  /** Формула бросается критом */
  critical: boolean;
}

/** Смена хитов цели на разницу между режимами */
export interface ShiftedRecordedDamage {
  /** Копия цели с новыми хитами */
  updatedEntity: DnDSceneEntity;
  /** Сколько текущих хитов теперь снято ударом */
  hpLost: number;
  /** Сколько временных хитов теперь снято ударом */
  tempLost: number;
  /** Хиты цели до и после смены режима */
  hpChange: HpChangeDetail;
}

/** Итог смены режимов урона для одной цели */
export interface ChangedDamageModes {
  /** Копия цели с новыми хитами — её шлёт боевой канал */
  updatedEntity: DnDSceneEntity;
  /** Цель записи с новыми снятыми хитами и уроном по режимам */
  target: AttackDamageTarget;
  /** Полный урон цели в новом режиме — до половины */
  total: number;
  /** Урон цели в новом режиме: полный либо его половина */
  damage: number;
  /** Итоги частей в новом режиме — для подробностей карточки */
  parts: AppliedDamagePart[];
  /** Хиты цели до и после смены режима */
  hpChange: HpChangeDetail;
}

/**
 * Режимы урона, которые стоят в записи.
 *
 * @param record - запись об уроне
 * @returns половина и крит
 */
export function readDamageModes(
  record: Pick<AttackDamageRecord, 'half' | 'critical'>,
): AttackDamageModes {
  return { half: record.half === true, critical: record.critical };
}

/**
 * Знает ли запись бросок каждой части по отдельности. Без этого «Половина» и
 * «Крит» не работают: карточка записана версией системы, которая броска не
 * хранила, и под ней остаются только прежние кнопки.
 *
 * @param record - запись об уроне
 * @returns `true`, если режимы урона для записи доступны
 */
export function supportsDamageModes(
  record: Pick<AttackDamageRecord, 'parts'>,
): boolean {
  return record.parts.every((part) => part.roll !== undefined);
}

/**
 * Есть ли у записи кости крита: урон без костей (плоское число) крит не
 * меняет, и кнопка «Крит» под ним не нужна.
 *
 * @param record - запись об уроне
 * @returns `true`, если крит меняет урон записи
 */
export function hasCritDice(
  record: Pick<AttackDamageRecord, 'parts'>,
): boolean {
  return (
    supportsDamageModes(record)
    && record.parts.some((part) => part.roll?.critFormula !== undefined)
  );
}

/**
 * Части, для которых кости крита ещё не брошены: их бросает «Крит», когда
 * попадание критом не было.
 *
 * @param record - запись об уроне
 * @returns номера частей и формулы их костей крита
 */
export function listUnrolledCritDice(
  record: Pick<AttackDamageRecord, 'parts'>,
): { part: number; formula: string }[] {
  return record.parts.flatMap((part, index) =>
    part.roll?.critFormula !== undefined && part.roll.critTotal === undefined
      ? [{ part: index, formula: part.roll.critFormula }]
      : [],
  );
}

/**
 * Дописывает в запись брошенные кости крита.
 *
 * @param record - запись об уроне
 * @param rolls - брошенные кости крита по частям
 * @returns запись с костями крита; режим крита не меняется
 */
export function withCritDiceRolls(
  record: AttackDamageRecord,
  rolls: readonly CritDiceRoll[],
): AttackDamageRecord {
  return {
    ...record,
    parts: record.parts.map((part, index) => {
      const rolled = rolls.find((roll) => roll.part === index);

      if (!rolled || !part.roll) {
        return part;
      }

      return {
        ...part,
        roll: {
          ...part.roll,
          critTotal: rolled.total,
          ...(rolled.values && rolled.values.length > 0
            ? { critDice: [...rolled.values] }
            : {}),
        },
      };
    }),
  };
}

/**
 * Броски частей в режиме: обычный урон и, на крите, кости крита.
 *
 * @param record - запись об уроне
 * @param critical - к урону идут кости крита
 * @returns урон частей по номерам из `record.parts`; у записи без бросков —
 *   пусто
 */
export function resolveModeAmounts(
  record: Pick<AttackDamageRecord, 'parts'>,
  critical: boolean,
): number[] {
  return record.parts.flatMap((part) =>
    part.roll
      ? [part.roll.total + (critical ? (part.roll.critTotal ?? 0) : 0)]
      : [],
  );
}

/**
 * Урон записи для цели в режиме — нынешними защитами цели.
 *
 * @param entity - цель, какой она есть сейчас
 * @param record - запись об уроне
 * @param target - цель записи
 * @param critical - к урону идут кости крита
 * @returns полный урон цели и итоги частей
 */
function resolveModeDamageParts(
  entity: DnDSceneEntity,
  record: AttackDamageRecord,
  target: Pick<AttackDamageTarget, 'contributions'>,
  critical: boolean,
): ResolvedRecordedDamage {
  return resolveRecordedDamage(
    entity,
    record,
    target,
    resolveModeAmounts(record, critical),
  );
}

/**
 * Полный урон цели в режиме. Записанный берётся как есть; режим, которого
 * ещё не было, считается от записанного: к нему прибавляется разница между
 * режимами по броскам частей. Так в уроне остаётся то, чего в частях записи
 * нет (доп. урон наложенных эффектов), а защиты цели считаются только для
 * разницы.
 *
 * @param entity - цель, какой она есть сейчас
 * @param record - запись об уроне
 * @param target - цель записи
 * @param totals - уже известный урон по режимам
 * @param critical - нужный режим
 * @returns урон по режимам с заполненным нужным
 */
function withModeTotal(
  entity: DnDSceneEntity,
  record: AttackDamageRecord,
  target: Pick<AttackDamageTarget, 'contributions'>,
  totals: AttackDamageTotals,
  critical: boolean,
): AttackDamageTotals {
  const known = critical ? totals.critical : totals.normal;

  if (known !== undefined) {
    return totals;
  }

  const requested = resolveModeDamageParts(entity, record, target, critical);
  const otherTotal = critical ? totals.normal : totals.critical;

  const total =
    otherTotal === undefined
      ? requested.total
      : Math.max(
          0,
          otherTotal
            + requested.total
            - resolveModeDamageParts(entity, record, target, !critical).total,
        );

  return critical
    ? { ...totals, critical: total }
    : { ...totals, normal: total };
}

/**
 * Читает урон режима из уже заполненных итогов.
 *
 * @param totals - урон по режимам
 * @param critical - режим
 * @returns урон режима; ноль, если он не посчитан
 */
function pickModeTotal(totals: AttackDamageTotals, critical: boolean): number {
  return (critical ? totals.critical : totals.normal) ?? 0;
}

/**
 * Урон цели по режимам, от которого считается смена режима. Записанный
 * берётся как есть. У нанесённого урона без записанного итога он считается
 * сейчас, но не меньше того, что с цели действительно снято.
 *
 * @param entity - цель, какой она есть сейчас
 * @param record - запись об уроне с прежними режимами
 * @param target - цель записи
 * @param isApplied - урон сейчас нанесён
 * @returns урон по режимам; пусто, если урон отменён и итог не записан
 */
function resolveKnownTotals(
  entity: DnDSceneEntity,
  record: AttackDamageRecord,
  target: AttackDamageTarget,
  isApplied: boolean,
): AttackDamageTotals {
  if (target.totals || !isApplied) {
    return target.totals ?? {};
  }

  const total = Math.max(
    resolveModeDamageParts(entity, record, target, record.critical).total,
    Math.max(0, target.hpLost) + Math.max(0, target.tempLost),
  );

  return record.critical ? { critical: total } : { normal: total };
}

/**
 * Меняет хиты цели на разницу между двумя значениями урона одного удара: как
 * если бы удар с самого начала нанёс `to`, а не `from`.
 *
 * Урон стал меньше — цели возвращается разница: сперва текущие хиты (их удар
 * снимал последними), потом временные. Считается от нынешних хитов, не выше
 * максимума, как при отмене урона. Удар, который снял у цели всё, что было
 * (хитов оказалось меньше урона), возвращает только то, что снято сверх
 * нового урона.
 *
 * Урон стал больше — с цели снимается разница: сперва временные хиты. Удар,
 * который и так снял у цели всё, большего не снимает.
 *
 * @param entity - цель, какой она есть сейчас
 * @param target - что удар снял с цели
 * @param from - урон удара сейчас
 * @param to - урон удара после смены режима
 * @returns копия цели с новыми хитами и то, что теперь считается снятым
 */
export function shiftRecordedDamage(
  entity: DnDSceneEntity,
  target: Pick<AttackDamageTarget, 'hpLost' | 'tempLost'>,
  from: number,
  to: number,
): ShiftedRecordedDamage {
  // Лечение той же сводкой могло перекрыть урон: снятого тогда нет
  const hpLost = Math.max(0, target.hpLost);
  const tempLost = Math.max(0, target.tempLost);
  const lost = hpLost + tempLost;
  const hpBefore = resolveEntityCurrentHp(entity);
  const tempBefore = resolveEntityTempHp(entity);

  let updatedEntity: DnDSceneEntity;
  let nextHpLost = hpLost;
  let nextTempLost = tempLost;

  if (to < from) {
    const restored = lost - Math.min(to, lost);
    const restoredHp = Math.min(restored, hpLost);
    const restoredTemp = restored - restoredHp;

    updatedEntity = revertRecordedDamage(entity, {
      hpLost: restoredHp,
      tempLost: restoredTemp,
    });

    nextHpLost = hpLost - restoredHp;
    nextTempLost = tempLost - restoredTemp;
  } else {
    // Удар снял меньше своего урона — у цели кончились хиты: добавлять не с чего
    const added = lost < from ? 0 : to - from;

    const hpChange = applyHpChange({
      hpBefore,
      maxHp: resolveEntityMaxHp(entity),
      tempBefore,
      damage: added,
      heal: 0,
    });

    updatedEntity = JSON.parse(JSON.stringify(entity));

    writeEntityHitPoints(updatedEntity, {
      current: hpChange.hpAfter,
      temp: hpChange.tempAfter,
    });

    nextHpLost = hpLost + hpBefore - hpChange.hpAfter;
    nextTempLost = tempLost + hpChange.tempAbsorbed;
  }

  return {
    updatedEntity,
    hpLost: nextHpLost,
    tempLost: nextTempLost,
    hpChange: {
      hpBefore,
      hpAfter: resolveEntityCurrentHp(updatedEntity),
      tempBefore,
      tempAfter: resolveEntityTempHp(updatedEntity),
      isPublic: isEntityHpShownToPlayers(entity),
    },
  };
}

/**
 * Переводит урон записи для цели в другие режимы — «Половина» и «Крит».
 *
 * Над нанесённым уроном меняются только хиты, ровно на разницу между
 * режимами ({@link shiftRecordedDamage}); эффекты удара и остальные его
 * последствия остаются в записи как были — их снимет отмена урона. Над
 * отменённым уроном записанный бросок наносится заново в новых режимах: удар
 * записывается для событий урона на сервере, а его последствия — в запись.
 *
 * Кости крита к этому моменту уже в записи ({@link withCritDiceRolls}).
 *
 * @param entity - цель, какой она есть сейчас
 * @param record - запись об уроне с прежними режимами
 * @param target - цель записи
 * @param next - новые режимы
 * @param isApplied - урон сейчас нанесён (иначе — отменён)
 * @returns копия цели, новая цель записи и итог для карточки
 */
export function changeRecordedDamageModes(
  entity: DnDSceneEntity,
  record: AttackDamageRecord,
  target: AttackDamageTarget,
  next: AttackDamageModes,
  isApplied: boolean,
): ChangedDamageModes {
  const current = readDamageModes(record);

  const totals = withModeTotal(
    entity,
    record,
    target,
    withModeTotal(
      entity,
      record,
      target,
      resolveKnownTotals(entity, record, target, isApplied),
      current.critical,
    ),
    next.critical,
  );

  const total = pickModeTotal(totals, next.critical);
  const damage = resolveModeDamage(total, next.half);

  const resolved = resolveModeDamageParts(
    entity,
    record,
    target,
    next.critical,
  );

  if (isApplied) {
    const shifted = shiftRecordedDamage(
      entity,
      target,
      resolveModeDamage(pickModeTotal(totals, current.critical), current.half),
      damage,
    );

    return {
      updatedEntity: shifted.updatedEntity,
      target: {
        ...target,
        hpLost: shifted.hpLost,
        tempLost: shifted.tempLost,
        totals,
      },
      total,
      damage,
      parts: resolved.parts,
      hpChange: shifted.hpChange,
    };
  }

  const applied = dealRecordedDamage(
    entity,
    { ...record, critical: next.critical },
    resolved,
    damage,
  );

  return {
    updatedEntity: applied.updatedEntity,
    target: {
      entityId: target.entityId,
      name: entity.name,
      hpLost: applied.hpBefore - applied.hpAfter,
      tempLost: applied.tempLost,
      contributions: target.contributions,
      totals,
      ...captureHitConsequences(entity, applied.updatedEntity),
    },
    total,
    damage,
    parts: resolved.parts,
    hpChange: applied.hpChange,
  };
}

/**
 * Что бросить, чтобы нанести урон части заново («Нанести урон»): та же
 * формула, а у части с костями крита в режиме крита — с удвоенными костями,
 * одним броском, как бросает атака.
 *
 * @param record - запись об уроне
 * @param part - часть записи
 * @returns формула броска; у части без записанного броска — её формула как
 *   есть
 */
export function planDamageReroll(
  record: Pick<AttackDamageRecord, 'critical'>,
  part: AttackDamagePart,
): DamageRerollPlan {
  if (!part.roll) {
    return { formula: part.formula, critical: record.critical };
  }

  const critical = record.critical && part.roll.critTotal !== undefined;

  return {
    formula: critical
      ? doubleDiceInFormula(part.roll.formula)
      : part.roll.formula,
    critical,
  };
}

/**
 * Часть записи с новым броском («Нанести урон»).
 *
 * @param part - часть записи
 * @param plan - что бросали
 * @param rolled - итог броска и выпавшие кости
 * @param rolled.total - итог броска
 * @param rolled.values - выпавшие кости в порядке формулы
 * @returns часть с новым броском; часть без записанного броска — как есть
 */
export function withRerolledDamage(
  part: AttackDamagePart,
  plan: DamageRerollPlan,
  rolled: { total: number; values?: readonly number[] },
): AttackDamagePart {
  if (!part.roll) {
    return part;
  }

  const roll: AttackDamagePartRoll = describeDamagePartRoll({
    formula: plan.formula,
    total: rolled.total,
    values: rolled.values,
    critical: plan.critical,
  });

  return { ...part, formula: plan.formula, roll };
}
