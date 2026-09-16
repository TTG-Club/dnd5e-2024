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
import type { ActorCounterState } from './types.js';

import {
  DEFAULT_ACTIVATION_AMOUNT,
  isUseActivatedEffect,
} from './activeEffectTypes.js';
import { cloneEntityData } from './dataClone.js';
import {
  buildTriggerSources,
  EFFECT_TRIGGER_SOURCE_KINDS,
  settleSelfTriggerSources,
} from './effectTriggerRunner.js';
import { listEffectEventTriggers } from './effectTriggers.js';
import { canSpendItemUses, isItemDepleted, spendItemUses } from './itemUses.js';
import { buildPseudoSpell } from './spellUtils.js';

/** Свойство оружия, стреляющего боеприпасами */
export const AMMUNITION_PROPERTY = 'ammunition';

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

  return canSpendItemUses(item) && !isItemDepleted(item);
}

/**
 * Инвентарь после одного применения предмета: заряд — если заряды есть, иначе
 * единица количества у расходуемого. Кончившийся предмет остаётся в инвентаре
 * с нулём — строкой «Закончились» и погасшей кнопкой на панели.
 *
 * @param equipment - инвентарь
 * @param itemId - применённый предмет
 * @returns новый инвентарь
 */
export function spendItemUse(
  equipment: readonly DnDGameItem[],
  itemId: string,
): DnDGameItem[] {
  return equipment.map((item) => {
    if (item.id !== itemId) {
      return item;
    }

    if (item.uses) {
      return spendItemUses(item);
    }

    if (!item.consumable) {
      return item;
    }

    return { ...item, quantity: Math.max(0, item.quantity - 1) };
  });
}

/** Почему действие предмета сейчас недоступно */
export type ItemActionBlock =
  'missing' | 'depleted' | 'noUses' | 'noAmmunition';

/** Доступность действия предмета — для кнопки панели быстрого доступа */
export interface ItemActionAvailability {
  /** Почему недоступно; нет — действие доступно */
  blocked?: ItemActionBlock;
  /** Остаток: заряды, количество расходуемого, боеприпасы; нет — не ведётся */
  remaining?: number;
}

/**
 * Доступность применения предмета: есть ли он, не закончился ли, хватает ли
 * зарядов, и сколько осталось.
 *
 * @param item - предмет; нет — его убрали из инвентаря
 * @returns доступность
 */
export function describeItemUseAvailability(
  item: DnDGameItem | undefined,
): ItemActionAvailability {
  if (!item || listUseEffects(item.activeEffects).length === 0) {
    return { blocked: 'missing' };
  }

  if (isItemDepleted(item)) {
    return { blocked: 'depleted', remaining: 0 };
  }

  if (item.uses) {
    return canSpendItemUses(item)
      ? { remaining: item.uses.current }
      : { blocked: 'noUses', remaining: item.uses.current };
  }

  return item.consumable ? { remaining: item.quantity } : {};
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
  return buildPseudoSpell({
    id: `${USE_SPELL_ID_PREFIX}${source.id}`,
    name: source.name,
    rollSource: source.rollSource,
    activeEffects: source.effects,
  });
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
 * Предмет — боеприпас этого оружия: тип боеприпаса тот же, и сам предмет
 * боеприпасами не стреляет. У стреляющего оружия `ammunitionType` — чем оно
 * стреляет, у остального — что это за боеприпас. Магические стрелы приходят
 * из компендиума записью-оружием, поэтому тип записи не решает.
 *
 * @param item - предмет инвентаря
 * @param weapon - оружие
 * @returns `true`, если предметом стреляют из оружия
 */
function isAmmunitionFor(item: DnDGameItem, weapon: DnDGameItem): boolean {
  return (
    item.id !== weapon.id
    && !weaponUsesAmmunition(item)
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
 * Сколько выстрелов осталось: боеприпасы этого оружия по всему инвентарю.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns количество боеприпасов
 */
export function countWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): number {
  return equipment
    .filter((item) => isAmmunitionFor(item, weapon))
    .reduce((total, item) => total + Math.max(0, item.quantity), 0);
}

/**
 * Доступность атаки оружием: оружие есть и не закончилось, а у стрелкового,
 * чьи боеприпасы лист ведёт, остались выстрелы.
 *
 * @param equipment - инвентарь стрелка
 * @param weapon - оружие; нет — его убрали из инвентаря
 * @returns доступность и остаток боеприпасов
 */
export function describeWeaponAttackAvailability(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem | undefined,
): ItemActionAvailability {
  if (!weapon) {
    return { blocked: 'missing' };
  }

  if (isItemDepleted(weapon)) {
    return { blocked: 'depleted', remaining: 0 };
  }

  if (!tracksWeaponAmmunition(equipment, weapon)) {
    return {};
  }

  const remaining = countWeaponAmmunition(equipment, weapon);

  return remaining > 0 ? { remaining } : { blocked: 'noAmmunition', remaining };
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
    (item) => isAmmunitionFor(item, weapon) && !isItemDepleted(item),
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
  prepare: (effect: ActiveEffect) => ActiveEffect = (switched) => switched,
): DnDSceneEntity {
  const activated = cloneEntityData(entity);

  activated.activeEffects = (activated.activeEffects ?? []).map((entry) =>
    entry.id === effectId ? prepare({ ...entry, disabled: false }) : entry,
  );

  const activatedEffect = activated.activeEffects.find(
    (entry) => entry.id === effectId,
  );

  if (!activatedEffect) {
    return activated;
  }

  settleSelfTriggerSources(
    activated,
    buildTriggerSources(
      [activatedEffect],
      EFFECT_TRIGGER_SOURCE_KINDS.instance,
      (source) => listEffectEventTriggers(source, 'activate'),
    ),
  );

  return activated;
}
