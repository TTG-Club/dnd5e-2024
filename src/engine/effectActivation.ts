/**
 * Применение и включение эффектов: зелье выпивают, стрелу выпускают, «Ярость»
 * включают.
 *
 * Эффект без `activation` действует постоянно (пока предмет надет, пока
 * эффект лежит на листе). `use` — эффект не действует сам: он накладывается,
 * когда источник применяют (предмет — пунктом «Использовать», боеприпас —
 * выстрелом, эффект листа — кнопкой «Применить»), и тратит заряд, количество или
 * счётчик. `toggle` — эффект лежит на листе выключенным и включается
 * переключателем, который тратит счётчик и будит срабатывания «при включении».
 */

import type { ActiveEffect, EffectActivation } from './activeEffectTypes.js';
import type {
  DnDGameItem,
  DnDSceneEntity,
  Spell,
  SpellRollSource,
} from './dndEntities.js';
import type { EffectTrigger } from './effectTriggerTypes.js';
import type { ActorCounterState } from './types.js';

import { isUseActivatedEffect } from './activeEffectTypes.js';
import {
  admitTrigger,
  buildTriggerSources,
  EFFECT_TRIGGER_SOURCE_KINDS,
  rollTriggerSave,
  settlePresenceTrigger,
} from './effectTriggerRunner.js';
import { listEffectListTriggers } from './effectTriggers.js';
import { canSpendItemUses, spendItemUses } from './itemUses.js';

/** Сколько тратит применение или включение без поля `amount` */
export const DEFAULT_ACTIVATION_AMOUNT = 1;

/** Свойство оружия, стреляющего боеприпасами */
const AMMUNITION_PROPERTY = 'ammunition';

/**
 * Эффекты, которые накладывает применение источника, — без признака
 * применения: наложенная копия действует как обычный эффект.
 *
 * @param effects - эффекты источника
 * @returns эффекты применения
 */
export function listUseEffects(
  effects: readonly ActiveEffect[] | undefined,
): ActiveEffect[] {
  return (effects ?? [])
    .filter((effect) => !effect.disabled && isUseActivatedEffect(effect))
    .map(({ activation: _activation, ...effect }) => effect);
}

/**
 * Можно ли применить предмет: у него есть эффекты применения, хватает зарядов
 * и количества.
 *
 * @param item - предмет
 * @returns `true`, если предмет применяется
 */
export function canUseItem(item: DnDGameItem): boolean {
  if (listUseEffects(item.activeEffects).length === 0) {
    return false;
  }

  if (!canSpendItemUses(item)) {
    return false;
  }

  return !item.consumable || item.quantity > 0;
}

/**
 * Инвентарь после одного применения предмета: заряд — если заряды есть, иначе
 * единица количества у расходуемого; кончившийся расходуемый предмет уходит.
 *
 * @param equipment - инвентарь
 * @param itemId - применённый предмет
 * @returns новый инвентарь
 */
export function spendItemUse(
  equipment: readonly DnDGameItem[],
  itemId: string,
): DnDGameItem[] {
  return equipment.flatMap((item) => {
    if (item.id !== itemId) {
      return [item];
    }

    if (item.uses) {
      return [spendItemUses(item)];
    }

    if (!item.consumable) {
      return [item];
    }

    const quantity = item.quantity - 1;

    return quantity > 0 ? [{ ...item, quantity }] : [];
  });
}

/** Что применяют: предмет или эффект листа */
export interface EffectUseSource {
  /** Идентификатор источника */
  id: string;
  /** Название для чата */
  name: string;
  /** Эффекты применения, уже без признака применения */
  effects: ActiveEffect[];
  /** Чем источник разыгрывается */
  rollSource: SpellRollSource;
}

/** Приставка id псевдо-заклинания применения */
const USE_SPELL_ID_PREFIX = 'use-';

/**
 * Псевдо-заклинание применения предмета.
 *
 * @param item - предмет
 * @returns псевдо-заклинание
 */
export function buildItemUseSpell(item: DnDGameItem): Spell {
  return buildUseSpell({
    id: item.id,
    name: item.name,
    effects: listUseEffects(item.activeEffects),
    rollSource: 'item',
  });
}

/**
 * Псевдо-заклинание применения эффекта листа («Применить»).
 *
 * @param effect - эффект применения на листе
 * @returns псевдо-заклинание
 */
export function buildEffectUseSpell(effect: ActiveEffect): Spell {
  return buildUseSpell({
    id: effect.id,
    name: effect.name,
    effects: listUseEffects([{ ...effect, disabled: false }]),
    rollSource: 'effect',
  });
}

/**
 * Псевдо-заклинание применения: эффекты применения ложатся тем же путём, что и
 * эффекты заклинания, — на применившего и на цель.
 *
 * @param source - что применяют
 * @returns псевдо-заклинание
 */
export function buildUseSpell(source: EffectUseSource): Spell {
  return {
    id: `${USE_SPELL_ID_PREFIX}${source.id}`,
    name: source.name,
    rollSource: source.rollSource,
    level: 0,
    school: 'evocation',
    castingTimeValue: 1,
    castingTimeUnit: 'action',
    components: { verbal: false, somatic: false, material: false },
    range: 0,
    rangeUnit: 'ft',
    durationValue: 0,
    durationUnit: 'instantaneous',
    concentration: false,
    ritual: false,
    targetType: 'creature',
    deliveryType: 'touch',
    saveType: 'none',
    activeEffects: source.effects,
    description: '',
  };
}

/**
 * Стреляет ли оружие боеприпасами.
 *
 * @param weapon - оружие
 * @returns `true`, если у оружия свойство «Боеприпасы»
 */
export function weaponUsesAmmunition(weapon: DnDGameItem): boolean {
  return (
    weapon.ammunitionType !== undefined
    && (weapon.weaponProperties ?? []).includes(AMMUNITION_PROPERTY)
  );
}

/**
 * Предмет — боеприпас этого оружия: не оружие, тип боеприпаса тот же.
 *
 * @param item - предмет инвентаря
 * @param weapon - оружие
 * @returns `true`, если предметом стреляют из оружия
 */
function isAmmunitionFor(item: DnDGameItem, weapon: DnDGameItem): boolean {
  return (
    item.id !== weapon.id
    && item.type !== 'weapon'
    && item.ammunitionType !== undefined
    && item.ammunitionType === weapon.ammunitionType
  );
}

/**
 * Ведёт ли лист учёт боеприпасов этого оружия: в инвентаре есть боеприпас его
 * типа, пусть и кончившийся. Без такого предмета оружие стреляет как раньше —
 * у старых листов стрел в инвентаре нет.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns `true`, если выстрел тратит боеприпас
 */
export function tracksWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): boolean {
  return (
    weaponUsesAmmunition(weapon)
    && equipment.some((item) => isAmmunitionFor(item, weapon))
  );
}

/**
 * Боеприпас выстрела: предмет с тем же типом боеприпаса и ненулевым
 * количеством, надетый — первым.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns боеприпас либо `undefined`, если стрелять нечем
 */
export function findWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): DnDGameItem | undefined {
  if (!weaponUsesAmmunition(weapon)) {
    return undefined;
  }

  const candidates = equipment.filter(
    (item) => isAmmunitionFor(item, weapon) && item.quantity > 0,
  );

  return candidates.find((item) => item.equipped) ?? candidates[0];
}

/**
 * Оружие выстрела с боеприпасом: магический бонус боеприпаса складывается с
 * бонусом оружия, эффекты применения боеприпаса ложатся на цель вместе с
 * эффектами оружия.
 *
 * @param weapon - оружие
 * @param ammunition - боеприпас; без него оружие как есть
 * @returns оружие выстрела
 */
export function withAmmunition(
  weapon: DnDGameItem,
  ammunition: DnDGameItem | undefined,
): DnDGameItem {
  if (!ammunition) {
    return weapon;
  }

  const ammunitionBonus = ammunition.isMagical
    ? Number(ammunition.magicBonus ?? 0)
    : 0;

  const magicBonus = Number(weapon.magicBonus ?? 0) + ammunitionBonus;

  return {
    ...weapon,
    isMagical: weapon.isMagical || ammunitionBonus !== 0 || undefined,
    magicBonus: magicBonus === 0 ? weapon.magicBonus : magicBonus,
    activeEffects: [
      ...(weapon.activeEffects ?? []),
      ...listUseEffects(ammunition.activeEffects),
    ],
  };
}

/**
 * Инвентарь после выстрела: боеприпас тратится на единицу.
 *
 * @param equipment - инвентарь
 * @param ammunitionId - боеприпас
 * @returns новый инвентарь
 */
export function spendAmmunition(
  equipment: readonly DnDGameItem[],
  ammunitionId: string,
): DnDGameItem[] {
  return equipment.map((item) =>
    item.id === ammunitionId
      ? { ...item, quantity: Math.max(0, item.quantity - 1) }
      : item,
  );
}

/**
 * Счётчик листа, который тратит применение или включение эффекта.
 *
 * @param counters - счётчики листа
 * @param activation - применение или включение
 * @returns счётчик либо `undefined`, если тратить нечего или счётчика нет
 */
export function findActivationCounter(
  counters: readonly ActorCounterState[],
  activation: EffectActivation | undefined,
): ActorCounterState | undefined {
  const key = activation?.counter;

  return key
    ? counters.find((counter) => counter.counterKey === key)
    : undefined;
}

/**
 * Хватает ли счётчика на применение или включение.
 *
 * @param counters - счётчики листа
 * @param activation - применение или включение
 * @returns `true`, если тратить нечего или счётчика хватает
 */
export function canPayActivation(
  counters: readonly ActorCounterState[],
  activation: EffectActivation | undefined,
): boolean {
  if (!activation?.counter) {
    return true;
  }

  const counter = findActivationCounter(counters, activation);

  return (
    counter !== undefined
    && counter.current >= (activation.amount ?? DEFAULT_ACTIVATION_AMOUNT)
  );
}

/**
 * Счётчики после оплаты применения или включения.
 *
 * @param counters - счётчики листа
 * @param activation - применение или включение
 * @returns новые счётчики
 */
export function payActivation(
  counters: readonly ActorCounterState[],
  activation: EffectActivation | undefined,
): ActorCounterState[] {
  const key = activation?.counter;
  const amount = activation?.amount ?? DEFAULT_ACTIVATION_AMOUNT;

  return counters.map((counter) =>
    key && counter.counterKey === key
      ? { ...counter, current: Math.max(0, counter.current - amount) }
      : counter,
  );
}

/**
 * Сущность после включения эффекта: сам эффект включён и подготовлен (точная
 * длительность хода отсчитывается от включения), его срабатывания «при
 * включении» выполнены — урон и лечение уже в хитах копии.
 *
 * @param entity - сущность из стора (не мутируется)
 * @param effectId - включаемый эффект
 * @param prepare - подготовка включённого эффекта
 * @returns копия сущности для боевого канала
 */
export function activateEffectOnEntity(
  entity: DnDSceneEntity,
  effectId: string,
  prepare: (effect: ActiveEffect) => ActiveEffect = (effect) => effect,
): DnDSceneEntity {
  const activated: DnDSceneEntity = JSON.parse(JSON.stringify(entity));

  activated.activeEffects = (activated.activeEffects ?? []).map((effect) =>
    effect.id === effectId ? prepare({ ...effect, disabled: false }) : effect,
  );

  const effect = activated.activeEffects.find((entry) => entry.id === effectId);

  if (!effect) {
    return activated;
  }

  const sources = buildTriggerSources(
    [effect],
    EFFECT_TRIGGER_SOURCE_KINDS.instance,
    (source): EffectTrigger[] =>
      listEffectListTriggers(source).filter(
        (trigger) => trigger.event === 'activate',
      ),
  );

  for (const source of sources) {
    if (admitTrigger(activated, source)) {
      settlePresenceTrigger(
        activated,
        source,
        rollTriggerSave(activated, source),
      );
    }
  }

  return activated;
}
