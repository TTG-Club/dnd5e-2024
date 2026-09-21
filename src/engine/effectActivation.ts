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
  return (weapon.weaponProperties ?? []).includes(AMMUNITION_PROPERTY);
}

/**
 * Можно ли зарядить предмет в оружие: любой расходуемый предмет, кроме самого
 * оружия и того, что стреляет само.
 *
 * @param item - предмет инвентаря
 * @param weapon - оружие
 * @returns `true`, если предметом можно стрелять из оружия
 */
function isLoadableAmmunition(item: DnDGameItem, weapon: DnDGameItem): boolean {
  return (
    item.id !== weapon.id
    && Boolean(item.consumable)
    && !weaponUsesAmmunition(item)
  );
}

/**
 * Чем можно зарядить оружие: расходуемые предметы инвентаря. У оружия без
 * свойства «Боеприпасы» — ничем.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns предметы для зарядки
 */
export function listLoadableAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): DnDGameItem[] {
  return weaponUsesAmmunition(weapon)
    ? equipment.filter((item) => isLoadableAmmunition(item, weapon))
    : [];
}

/**
 * Предмет — боеприпас этого оружия по типу: тип боеприпаса тот же, и сам
 * предмет боеприпасами не стреляет. Так подбираются стрелы из компендиума,
 * пока оружие не заряжено: магические стрелы приходят записью-оружием, поэтому
 * тип записи не решает.
 *
 * @param item - предмет инвентаря
 * @param weapon - оружие
 * @returns `true`, если предмет подходит оружию по типу
 */
function matchesAmmunitionType(
  item: DnDGameItem,
  weapon: DnDGameItem,
): boolean {
  return (
    item.id !== weapon.id
    && !weaponUsesAmmunition(item)
    && item.ammunitionType !== undefined
    && item.ammunitionType === weapon.ammunitionType
  );
}

/**
 * Предметы, которыми оружие стреляет: заряженный, а если его не выбрали или
 * его больше нет в инвентаре — подходящие по типу.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns боеприпасы оружия
 */
function listWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): DnDGameItem[] {
  if (!weaponUsesAmmunition(weapon)) {
    return [];
  }

  const loaded = equipment.find(
    (item) =>
      item.id === weapon.loadedAmmunitionId
      && isLoadableAmmunition(item, weapon),
  );

  if (loaded) {
    return [loaded];
  }

  return equipment.filter((item) => matchesAmmunitionType(item, weapon));
}

/**
 * Ведёт ли лист учёт боеприпасов этого оружия: оно заряжено или в инвентаре
 * есть боеприпас его типа, пусть и кончившийся. Иначе оружие стреляет как
 * раньше — у старых листов стрел в инвентаре нет.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns `true`, если выстрел тратит боеприпас
 */
export function tracksWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): boolean {
  return listWeaponAmmunition(equipment, weapon).length > 0;
}

/**
 * Сколько выстрелов осталось: заряженный боеприпас или все боеприпасы типа.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns количество боеприпасов
 */
export function countWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): number {
  return listWeaponAmmunition(equipment, weapon).reduce(
    (total, item) => total + Math.max(0, item.quantity),
    0,
  );
}

/**
 * Чем оружие выстрелит сейчас — для меню и строки листа: боеприпас выстрела,
 * а если все кончились — первый из боеприпасов оружия.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns боеприпас либо `undefined`, если оружие не заряжено
 */
export function findLoadedAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): DnDGameItem | undefined {
  return (
    findWeaponAmmunition(equipment, weapon)
    ?? listWeaponAmmunition(equipment, weapon)[0]
  );
}

/**
 * Заряжает оружие предметом инвентаря или снимает выбор.
 *
 * @param equipment - инвентарь
 * @param weaponId - оружие
 * @param ammunitionId - боеприпас; нет — выбор снят, боеприпас подбирается по
 *   типу
 * @returns новый инвентарь
 */
export function loadWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weaponId: string,
  ammunitionId: string | undefined,
): DnDGameItem[] {
  return equipment.map((item) => {
    if (item.id !== weaponId) {
      return item;
    }

    const { loadedAmmunitionId: _previous, ...weapon } = item;

    return ammunitionId
      ? { ...weapon, loadedAmmunitionId: ammunitionId }
      : weapon;
  });
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
 * Боеприпас выстрела: заряженный предмет или подходящий по типу — с ненулевым
 * количеством, надетый первым.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns боеприпас либо `undefined`, если стрелять нечем
 */
export function findWeaponAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): DnDGameItem | undefined {
  const candidates = listWeaponAmmunition(equipment, weapon).filter(
    (item) => !isItemDepleted(item),
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
 * Выполняет на копии сущности срабатывания одного её эффекта без второй
 * стороны: «при включении» и «При действии».
 *
 * @param copy - копия сущности (меняется)
 * @param effectId - эффект
 * @param listTriggers - какие срабатывания эффекта выполнять
 * @param combatRound - номер идущего раунда: расписание «на раунде N»
 */
function settleOwnEffectTriggers(
  copy: DnDSceneEntity,
  effectId: string,
  listTriggers: (effect: ActiveEffect) => EffectTrigger[],
  combatRound: number | undefined,
): void {
  const effect = (copy.activeEffects ?? []).find(
    (entry) => entry.id === effectId,
  );

  if (!effect) {
    return;
  }

  settleSelfTriggerSources(
    copy,
    buildTriggerSources(
      [effect],
      EFFECT_TRIGGER_SOURCE_KINDS.instance,
      listTriggers,
    ),
    combatRound,
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
 * @param combatRound - номер идущего раунда: расписание «на раунде N»
 * @returns копия сущности для боевого канала
 */
export function activateEffectOnEntity(
  entity: DnDSceneEntity,
  effectId: string,
  prepare: (effect: ActiveEffect) => ActiveEffect = (switched) => switched,
  combatRound?: number,
): DnDSceneEntity {
  const activated = cloneEntityData(entity);

  activated.activeEffects = (activated.activeEffects ?? []).map((entry) =>
    entry.id === effectId ? prepare({ ...entry, disabled: false }) : entry,
  );

  settleOwnEffectTriggers(
    activated,
    effectId,
    (effect) => listEffectEventTriggers(effect, 'activate'),
    combatRound,
  );

  return activated;
}

/**
 * Действия действующего эффекта: срабатывания «При действии», которые
 * человек запускает кнопкой на листе.
 *
 * Правила часто дают заклинанию отдельное действие, пока оно действует:
 * «действием можешь переместить сферу на 30 футов». Переключатель для этого
 * не годится — заклинание уже действует, включать нечего. Поэтому у
 * действующего эффекта появляется своя кнопка, а её цена (действие, бонусное,
 * реакция) подписана рядом: ходом распоряжается человек, движок только
 * напоминает.
 *
 * @param effect - эффект носителя
 * @returns срабатывания «При действии»; пусто — кнопки нет
 */
export function listEffectActiveActions(effect: ActiveEffect): EffectTrigger[] {
  // Выключенный эффект не действует: у него кнопка включения, а не действия
  if (effect.disabled) {
    return [];
  }

  return listEffectEventTriggers(effect, 'activate');
}

/**
 * Есть ли у действующего эффекта своя кнопка действия.
 *
 * @param effect - эффект носителя
 * @returns `true`, если кнопка нужна
 */
export function hasEffectActiveAction(effect: ActiveEffect): boolean {
  return listEffectActiveActions(effect).length > 0;
}

/**
 * Сущность после действия действующего эффекта: срабатывания «При действии»
 * выполнены, урон и лечение уже в хитах копии.
 *
 * Отличие от {@link activateEffectOnEntity}: эффект уже действует и ничего не
 * включается — выполняются только его срабатывания «При действии».
 *
 * @param entity - сущность из стора (не мутируется)
 * @param effectId - эффект, чьё действие запускают
 * @param combatRound - номер идущего раунда: расписание «на раунде N»
 * @returns копия сущности для боевого канала
 */
export function runEffectActiveAction(
  entity: DnDSceneEntity,
  effectId: string,
  combatRound?: number,
): DnDSceneEntity {
  const acted = cloneEntityData(entity);

  settleOwnEffectTriggers(
    acted,
    effectId,
    listEffectActiveActions,
    combatRound,
  );

  return acted;
}
