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

import type { EffectDurationType } from '@vtt/shared';

import type {
  ActiveEffect,
  EffectActivation,
  EffectActivationCost,
  EffectUseArea,
} from './activeEffectTypes.js';
import type {
  DnDGameItem,
  DnDSceneEntity,
  Spell,
  SpellRollSource,
} from './dndEntities.js';
import type { EffectPaid } from './effectPayTypes.js';
import type {
  SelfTriggerOptions,
  SelfTriggerReport,
} from './effectTriggerRunner.js';
import type { EffectTrigger } from './effectTriggerTypes.js';
import type { ActorCounterState } from './types.js';

import {
  DEFAULT_ACTIVATION_AMOUNT,
  isDnDEffect,
  isToggleActivatedEffect,
  isUseActivatedEffect,
} from './activeEffectTypes.js';
import { cloneEntityData } from './dataClone.js';
import { hasItemUsesPrice } from './effectPayTypes.js';
import {
  buildTriggerSources,
  EFFECT_TRIGGER_SOURCE_KINDS,
  settleSelfTriggerSources,
} from './effectTriggerRunner.js';
import { listEffectEventTriggers } from './effectTriggers.js';
import { isServerActiveAction } from './effectTriggerTypes.js';
import { canSpendItemUses, isItemDepleted, spendItemUses } from './itemUses.js';
import { buildPseudoSpell } from './spellUtils.js';
import {
  appendEffectsSummaryNotes,
  formatEffectsSummary,
  formatEntrySaveStatus,
} from './turnEffects.js';

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
 * Есть ли у предмета эффекты применения — зелье, свиток, масло. Такой предмет
 * ложится на панель быстрого доступа кнопкой «Использовать», а заряды и
 * количество здесь не смотрятся: кончившееся зелье остаётся зельем.
 *
 * @param item - предмет
 * @returns `true`, если предмет применяемый
 */
export function hasItemUseEffects(item: DnDGameItem): boolean {
  return listUseEffects(item.activeEffects).length > 0;
}

/**
 * Можно ли применить предмет: у него есть эффекты применения, хватает зарядов
 * и количества.
 *
 * @param item - предмет
 * @returns `true`, если предмет применяется
 */
export function canUseItem(item: DnDGameItem): boolean {
  if (!hasItemUseEffects(item)) {
    return false;
  }

  return (
    (canSpendItemUses(item) || hasPricedItemUse(item)) && !isItemDepleted(item)
  );
}

/**
 * Есть ли у предмета свойство со своей ценой в зарядах («первое слово —
 * бесплатно»): хватит ли зарядов, решает цена выбранного свойства, а не
 * обычный расход применения.
 *
 * @param item - предмет
 * @returns `true`, если хоть одно свойство платит зарядами само
 */
export function hasPricedItemUse(item: DnDGameItem): boolean {
  return listUseEffects(item.activeEffects).some((effect) =>
    hasItemUsesPrice(effect.pay),
  );
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
  if (!item || !hasItemUseEffects(item)) {
    return { blocked: 'missing' };
  }

  if (isItemDepleted(item)) {
    return { blocked: 'depleted', remaining: 0 };
  }

  if (item.uses) {
    return canSpendItemUses(item) || hasPricedItemUse(item)
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
  /** Дальность применения «на цель» в футах; нет — касание */
  range?: number;
  /** Область применения: шаблон на карте вместо выбора одной цели */
  area?: EffectUseArea;
  /** Применение требует концентрации */
  concentration?: boolean;
}

/**
 * Область применения группы эффектов: первая заданная. У вариантов одного
 * применения область общая — шаблон ставят один раз.
 *
 * @param effects - эффекты применения с признаком применения
 * @returns область либо `undefined`
 */
export function resolveEffectUseArea(
  effects: readonly ActiveEffect[] | undefined,
): EffectUseArea | undefined {
  return (effects ?? []).find(
    (effect) => isUseActivatedEffect(effect) && effect.activation?.area,
  )?.activation?.area;
}

/**
 * Трата хода на применение группы эффектов: первая заданная.
 *
 * @param effects - эффекты применения с признаком применения
 * @returns трата либо `undefined`, если применение хода не тратит
 */
export function resolveEffectUseCost(
  effects: readonly ActiveEffect[] | undefined,
): EffectActivationCost | undefined {
  return (effects ?? []).find(
    (effect) => isUseActivatedEffect(effect) && effect.activation?.cost,
  )?.activation?.cost;
}

/**
 * Требует ли применение группы эффектов концентрации: хватает одного эффекта
 * с такой отметкой.
 *
 * @param effects - эффекты применения с признаком применения
 * @returns `true`, если применение держится концентрацией
 */
export function resolveEffectUseConcentration(
  effects: readonly ActiveEffect[] | undefined,
): boolean {
  return (effects ?? []).some(
    (effect) =>
      isUseActivatedEffect(effect) && effect.activation?.concentration === true,
  );
}

/**
 * Область применения шаблоном заклинания: размер в футах задаёт запись,
 * растягивать его при размещении нельзя.
 *
 * @param area - область применения или шаблон срабатывания
 * @returns область в форме заклинания
 */
export function toUseAreaOfEffect(
  area: EffectUseArea,
): NonNullable<Spell['areaOfEffect']> {
  return {
    shape: area.shape,
    size: area.size,
    ...(area.width === undefined ? {} : { width: area.width }),
    unit: 'ft',
    resizable: false,
  };
}

/** Единицы срока заклинания по сроку эффекта зоны */
const ZONE_DURATION_UNITS: Partial<
  Record<EffectDurationType, Spell['durationUnit']>
> = {
  rounds: 'round',
  minutes: 'minute',
  hours: 'hour',
};

/**
 * Срок псевдо-заклинания по сроку его эффекта «в зону»: зона на месте шаблона
 * живёт столько, сколько записано у эффекта («горит 2 раунда»). Без такого
 * эффекта применение мгновенное.
 *
 * @param effects - эффекты применения
 * @returns поля срока псевдо-заклинания
 */
function resolveUseZoneDuration(
  effects: readonly ActiveEffect[],
): Partial<Pick<Spell, 'durationUnit' | 'durationValue'>> {
  const zone = effects.find((effect) => effect.effectTarget === 'zone');

  if (!zone) {
    return {};
  }

  const unit = ZONE_DURATION_UNITS[zone.duration.type];

  // Срок без счёта раундов (особый, до отдыха) — зона до снятия вручную
  return unit
    ? { durationUnit: unit, durationValue: zone.duration.value ?? 1 }
    : { durationUnit: 'special', durationValue: 0 };
}

/**
 * Разделитель частей ключа группы вариантов. Черта не встречается ни в ключах
 * классов, ни в ключах ресурсов, поэтому части не склеиваются в чужой ключ.
 */
const EFFECT_USE_GROUP_KEY_SEPARATOR = '|';

/** Приставка id псевдо-заклинания применения */
const USE_SPELL_ID_PREFIX = 'use-';

/**
 * Псевдо-заклинание применения предмета.
 *
 * @param item - предмет
 * @returns псевдо-заклинание
 */
export function buildItemUseSpell(item: DnDGameItem): Spell {
  const area = resolveEffectUseArea(item.activeEffects);

  return buildUseSpell({
    id: item.id,
    name: item.name,
    effects: listUseEffects(item.activeEffects),
    rollSource: 'item',
    ...(area ? { area } : {}),
    concentration: resolveEffectUseConcentration(item.activeEffects),
  });
}

/**
 * Ключ группы вариантов применения: эффекты листа с одним ключом — варианты
 * ОДНОГО применения («Божественная искра»: лечение, некротическая энергия,
 * излучение). Кнопка у них одна, выбор — при применении, трата — одна.
 *
 * В ключе не только группа варианта: у эффектов умений класса `originId` —
 * ключ класса, и два умения жреца с группой по умолчанию слиплись бы в одно.
 * Ресурс в ключе разводит их по тому, что они тратят.
 *
 * @param effect - эффект листа
 * @returns ключ либо `undefined`, если эффект не вариант применения
 */
export function effectUseGroupKey(effect: ActiveEffect): string | undefined {
  return isUseActivatedEffect(effect)
    ? buildVariantGroupKey(effect)
    : undefined;
}

/**
 * Ключ группы вариантов переключателя: эффекты листа с одним ключом —
 * варианты ОДНОГО включения («Ярость диких земель»: Медведь, Орёл, Волк).
 * Переключатель у них один, вариант выбирается при включении, и включён
 * всегда не больше одного. Состав ключа — как у применения.
 *
 * @param effect - эффект листа
 * @returns ключ либо `undefined`, если эффект не вариант переключателя
 */
export function effectToggleGroupKey(effect: ActiveEffect): string | undefined {
  return isToggleActivatedEffect(effect)
    ? buildVariantGroupKey(effect)
    : undefined;
}

/**
 * Ключ включения по имени из данных (`activation.exclusive`): ресурс и имя.
 * Ресурс в ключе — чтобы смена не переводила включение на чужой ресурс
 * бесплатно.
 *
 * @param effect - эффект листа
 * @returns ключ либо `undefined`, если у переключателя нет имени включения
 */
function buildExclusiveActivationKey(effect: ActiveEffect): string | undefined {
  const exclusive = effect.activation?.exclusive;

  if (!isToggleActivatedEffect(effect) || !exclusive) {
    return undefined;
  }

  return [effect.activation?.counter ?? '', exclusive].join(
    EFFECT_USE_GROUP_KEY_SEPARATOR,
  );
}

/**
 * Одно ли это включение: варианты одного переключателя («Ярость диких
 * земель») или переключатели с одним именем включения и одним ресурсом
 * («Ярость» класса и её копии в умениях подклассов). Одно включение горит
 * одним эффектом, а смена эффекта внутри него ресурс не тратит.
 *
 * Без пометки переключатели на общем ресурсе независимы: «Гнев моря» тратит
 * использование Дикой формы, но горит вместе с ней.
 *
 * @param first - переключатель
 * @param second - другой переключатель
 * @returns `true`, если это одно включение
 */
export function isSameEffectActivation(
  first: ActiveEffect,
  second: ActiveEffect,
): boolean {
  const variantKey = effectToggleGroupKey(first);

  if (variantKey !== undefined && variantKey === effectToggleGroupKey(second)) {
    return true;
  }

  const exclusiveKey = buildExclusiveActivationKey(first);

  return (
    exclusiveKey !== undefined
    && exclusiveKey === buildExclusiveActivationKey(second)
  );
}

/**
 * Горящий эффект того же включения, что и переключатель, — кроме него самого.
 *
 * @param effects - эффекты листа
 * @param effect - включаемый переключатель
 * @returns горящий эффект либо `undefined`, если включение не горит
 */
export function findBurningActivationPeer(
  effects: readonly ActiveEffect[],
  effect: ActiveEffect,
): ActiveEffect | undefined {
  return effects.find(
    (entry) =>
      entry.id !== effect.id
      && !entry.disabled
      && isSameEffectActivation(effect, entry),
  );
}

/**
 * Тратит ли включение ресурс. Включение с нуля тратит; смена эффекта внутри
 * горящего включения (другой вариант, копия «Ярости» подкласса) — нет: это
 * то же самое включение.
 *
 * @param effects - эффекты листа
 * @param effect - включаемый переключатель
 * @returns `true`, если ресурс нужно списать
 */
export function needsActivationPayment(
  effects: readonly ActiveEffect[],
  effect: ActiveEffect,
): boolean {
  return (
    effect.activation?.counter !== undefined
    && findBurningActivationPeer(effects, effect) === undefined
  );
}

/**
 * Можно ли включить переключатель: ресурса хватает или тратить не нужно.
 *
 * @param counters - счётчики листа
 * @param effects - эффекты листа
 * @param effect - включаемый переключатель
 * @returns `true`, если включение возможно
 */
export function canSwitchOnEffect(
  counters: readonly ActorCounterState[],
  effects: readonly ActiveEffect[],
  effect: ActiveEffect,
): boolean {
  return (
    !needsActivationPayment(effects, effect)
    || canPayActivation(counters, effect.activation)
  );
}

/**
 * Ключ группы вариантов из класса, ресурса и группы варианта.
 *
 * @param effect - эффект листа
 * @returns ключ либо `undefined`, если у эффекта нет варианта
 */
function buildVariantGroupKey(effect: ActiveEffect): string | undefined {
  if (!effect.variant) {
    return undefined;
  }

  return [
    effect.originId ?? '',
    effect.activation?.counter ?? '',
    effect.variant.group,
  ].join(EFFECT_USE_GROUP_KEY_SEPARATOR);
}

/**
 * Эффекты листа с тем же ключом группы, что у эффекта, — в порядке листа.
 * Эффект без группы — сам по себе.
 *
 * @param effects - эффекты листа
 * @param effect - эффект
 * @param keyOf - ключ группы эффекта
 * @returns эффекты группы
 */
function collectVariantGroup(
  effects: readonly ActiveEffect[],
  effect: ActiveEffect,
  keyOf: (entry: ActiveEffect) => string | undefined,
): ActiveEffect[] {
  const key = keyOf(effect);

  if (key === undefined) {
    return [effect];
  }

  const group = effects.filter((entry) => keyOf(entry) === key);

  return group.length > 0 ? group : [effect];
}

/**
 * Все варианты того же применения, что и эффект, — в порядке листа. Эффект без
 * группы — сам по себе.
 *
 * @param effects - эффекты листа
 * @param effect - применяемый эффект
 * @returns эффекты одного применения (сам эффект — всегда первый из них по
 *   порядку листа или единственный)
 */
export function collectEffectUseGroup(
  effects: readonly ActiveEffect[],
  effect: ActiveEffect,
): ActiveEffect[] {
  return collectVariantGroup(effects, effect, effectUseGroupKey);
}

/**
 * Все варианты того же переключателя, что и эффект, — в порядке листа. Эффект
 * без группы — сам по себе.
 *
 * @param effects - эффекты листа
 * @param effect - переключаемый эффект
 * @returns эффекты одного переключателя
 */
export function collectEffectToggleGroup(
  effects: readonly ActiveEffect[],
  effect: ActiveEffect,
): ActiveEffect[] {
  return collectVariantGroup(effects, effect, effectToggleGroupKey);
}

/**
 * Название группы вариантов применения или переключателя: у нескольких
 * вариантов — имя группы («Божественная искра»), у одного эффекта — его
 * собственное.
 *
 * @param group - эффекты одного применения или переключателя
 * @returns название для кнопки, чата, плашки выбора и панели быстрого доступа
 */
export function effectVariantGroupName(group: readonly ActiveEffect[]): string {
  const [first] = group;

  if (!first) {
    return '';
  }

  return group.length > 1 && first.variant ? first.variant.group : first.name;
}

/** Что показывает плашка выбора варианта переключателя */
export interface EffectToggleChoice {
  /** Название переключателя */
  name: string;
  /** Варианты — включёнными копиями */
  activeEffects: ActiveEffect[];
}

/**
 * Выбор варианта переключателя («Ярость диких земель»: Медведь, Орёл, Волк).
 *
 * Варианты лежат на листе выключенными, а выбор варианта выключенные эффекты
 * пропускает — поэтому в выбор они идут включёнными копиями. Id у копий
 * прежние: включается по нему эффект листа, а не копия.
 *
 * @param group - эффекты одного переключателя (см.
 *   {@link collectEffectToggleGroup})
 * @returns название и варианты для выбора
 */
export function buildEffectToggleChoice(
  group: readonly ActiveEffect[],
): EffectToggleChoice {
  return {
    name: effectVariantGroupName(group),
    activeEffects: group.map((effect) => ({ ...effect, disabled: false })),
  };
}

/**
 * Псевдо-заклинание применения эффекта листа («Применить») вместе с его
 * вариантами: окно выбора варианта видит все варианты группы, а дальность
 * берётся наибольшая из заданных.
 *
 * Эффект-шаблон на листе лежит выключенным (так его не читает пайплайн), и в
 * псевдо-заклинание он идёт включённым — иначе применение его бы отбросило.
 *
 * @param group - эффекты одного применения (см. {@link collectEffectUseGroup})
 * @returns псевдо-заклинание
 */
export function buildEffectGroupUseSpell(
  group: readonly ActiveEffect[],
): Spell {
  const [first] = group;

  const ranges = group.flatMap((effect) =>
    effect.activation?.range === undefined ? [] : [effect.activation.range],
  );

  const area = resolveEffectUseArea(group);

  return buildUseSpell({
    id: first?.id ?? '',
    name: effectVariantGroupName(group),
    effects: listUseEffects(
      group.map((effect) => ({ ...effect, disabled: false })),
    ),
    rollSource: 'effect',
    ...(ranges.length > 0 ? { range: Math.max(...ranges) } : {}),
    ...(area ? { area } : {}),
    concentration: resolveEffectUseConcentration(group),
  });
}

/**
 * Псевдо-заклинание применения одного эффекта листа.
 *
 * @param effect - эффект применения на листе
 * @returns псевдо-заклинание
 */
export function buildEffectUseSpell(effect: ActiveEffect): Spell {
  return buildEffectGroupUseSpell([effect]);
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
    // Концентрация применения — как у заклинания: метка у применившего
    ...(source.concentration ? { concentration: true } : {}),
    // Дальность без атаки: так её читает проверка дистанции цели
    ...(source.range === undefined
      ? {}
      : { range: source.range, rangeUnit: 'ft', deliveryType: 'none' }),
    // Область — шаблон на карте, как у заклинания; размер задаёт запись
    ...(source.area
      ? {
          areaOfEffect: toUseAreaOfEffect(source.area),
          ...resolveUseZoneDuration(source.effects),
        }
      : {}),
  });
}

/** Переключатели предмета: эффекты, которые включают и выключают */
export interface ItemToggleEntry {
  /** Эффект-переключатель */
  effect: ActiveEffect;
  /** Включён ли он сейчас */
  on: boolean;
}

/**
 * Переключатели предмета — пункты его меню («Язык пламени»: зажечь и
 * погасить).
 *
 * @param item - предмет
 * @returns переключатели по порядку записи
 */
export function listItemToggles(
  item: Pick<DnDGameItem, 'activeEffects'>,
): ItemToggleEntry[] {
  return (item.activeEffects ?? []).flatMap((effect) =>
    isDnDEffect(effect) && isToggleActivatedEffect(effect)
      ? [{ effect, on: effect.disabled !== true }]
      : [],
  );
}

/**
 * Инвентарь с включённым или выключенным переключателем предмета. Выключенный
 * забывает потраченное при включении — следующее включение заплатит заново.
 *
 * @param equipment - инвентарь
 * @param itemId - предмет
 * @param effectId - переключатель
 * @param on - включить или выключить
 * @param paid - потраченное ценой при включении
 * @returns новый инвентарь; предмета или эффекта нет — прежний
 */
export function switchItemToggle(
  equipment: readonly DnDGameItem[],
  itemId: string,
  effectId: string,
  on: boolean,
  paid?: EffectPaid,
): DnDGameItem[] {
  return equipment.map((item) =>
    item.id === itemId
      ? {
          ...item,
          activeEffects: (item.activeEffects ?? []).map((effect) => {
            if (effect.id !== effectId || !isDnDEffect(effect)) {
              return effect;
            }

            const { paid: _paid, ...rest } = effect;

            return {
              ...rest,
              disabled: !on,
              ...(on && paid ? { paid } : {}),
            };
          }),
        }
      : item,
  );
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
 * Оружие выстрела с боеприпасом: магический бонус боеприпаса идёт к атаке и
 * урону рядом с бонусом оружия (`ammunitionBonus`), эффекты применения
 * боеприпаса ложатся на цель вместе с эффектами оружия.
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

  const hasBonus = Number.isFinite(ammunitionBonus) && ammunitionBonus !== 0;

  return {
    ...weapon,
    isMagical: weapon.isMagical || hasBonus || undefined,
    ...(hasBonus ? { ammunitionBonus } : {}),
    activeEffects: [
      ...(weapon.activeEffects ?? []),
      ...listUseEffects(ammunition.activeEffects),
    ],
  };
}

/**
 * Оружие таким, каким оно выстрелит, — для плиток строки и карточки оружия:
 * с бонусом боеприпаса, которым заряжено. Кончившийся боеприпас в счёте
 * остаётся: строка показывает, чем оружие заряжено, и число сходится с ней.
 *
 * @param equipment - инвентарь
 * @param weapon - оружие
 * @returns оружие с боеприпасом либо как есть, если оно не заряжено
 */
export function withLoadedAmmunition(
  equipment: readonly DnDGameItem[],
  weapon: DnDGameItem,
): DnDGameItem {
  return withAmmunition(weapon, findLoadedAmmunition(equipment, weapon));
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
 * @param options - раунд боя, выбор цены и сбор сводки
 */
function settleOwnEffectTriggers(
  copy: DnDSceneEntity,
  effectId: string,
  listTriggers: (effect: ActiveEffect) => EffectTrigger[],
  options: SelfTriggerOptions,
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
    options,
  );
}

/**
 * Сущность после включения эффекта: сам эффект включён и подготовлен (точная
 * длительность хода отсчитывается от включения), его срабатывания «при
 * включении» выполнены — урон и лечение уже в хитах копии. Одно включение
 * горит одним эффектом: горящий эффект того же включения (соседний вариант,
 * другая копия «Ярости») выключается.
 *
 * @param entity - сущность из стора (не мутируется)
 * @param effectId - включаемый эффект
 * @param prepare - подготовка включённого эффекта
 * @param combatRound - номер идущего раунда: расписание «на раунде N»
 * @param options - выбор цены срабатываний и сбор сводки для чата
 * @returns копия сущности для боевого канала
 */
export function activateEffectOnEntity(
  entity: DnDSceneEntity,
  effectId: string,
  prepare: (effect: ActiveEffect) => ActiveEffect = (switched) => switched,
  combatRound?: number,
  options: Omit<SelfTriggerOptions, 'combatRound'> = {},
): DnDSceneEntity {
  const activated = cloneEntityData(entity);
  const effects = activated.activeEffects ?? [];
  const switched = effects.find((entry) => entry.id === effectId);

  activated.activeEffects = effects.map((entry) => {
    if (entry.id === effectId) {
      return prepare({ ...entry, disabled: false });
    }

    return switched
      && !entry.disabled
      && isSameEffectActivation(switched, entry)
      ? { ...entry, disabled: true }
      : entry;
  });

  settleOwnEffectTriggers(
    activated,
    effectId,
    (effect) => listEffectEventTriggers(effect, 'activate'),
    { ...options, combatRound },
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
 * @param options - выбор цены срабатываний и сбор сводки для чата
 * @returns копия сущности для боевого канала
 */
export function runEffectActiveAction(
  entity: DnDSceneEntity,
  effectId: string,
  combatRound?: number,
  options: Omit<SelfTriggerOptions, 'combatRound'> = {},
): DnDSceneEntity {
  const acted = cloneEntityData(entity);

  // Действия другим (всем в радиусе, наложившему) выполняет сервер
  settleOwnEffectTriggers(acted, effectId, listEffectSelfActions, {
    ...options,
    combatRound,
  });

  return acted;
}

/**
 * Срабатывания «При действии», которые клиент выполняет на самом носителе.
 *
 * @param effect - эффект носителя
 * @returns срабатывания; пусто — на носителе выполнять нечего
 */
export function listEffectSelfActions(effect: ActiveEffect): EffectTrigger[] {
  return listEffectActiveActions(effect).filter(
    (trigger) => !isServerActiveAction(trigger),
  );
}

/**
 * Срабатывания «При действии», чьи действия достаются другим: их выполняет
 * сервер по событию правил от клиента.
 *
 * @param effect - эффект носителя
 * @returns срабатывания; пусто — серверу выполнять нечего
 */
export function listEffectServerActions(effect: ActiveEffect): EffectTrigger[] {
  return listEffectActiveActions(effect).filter(isServerActiveAction);
}

/**
 * Шаблон, который кнопка «При действии» ставит на карту: первый заданный у её
 * срабатываний.
 *
 * @param effect - эффект носителя
 * @returns шаблон либо `undefined`, если получатели — по радиусу
 */
export function resolveEffectActionTemplate(
  effect: ActiveEffect,
): EffectUseArea | undefined {
  return listEffectServerActions(effect).find(
    (trigger) => trigger.area?.template,
  )?.area?.template;
}

/** Подпись момента в сводке срабатываний кнопки и переключателя */
export const SELF_TRIGGER_SUMMARY_LABEL = 'действие';

/**
 * Сводка срабатываний, выполненных на самой сущности, — для чата: урон,
 * лечение, спасброски и строки «Сообщить». Сервер такую сводку собирает сам, а
 * кнопку «При действии» и переключатель выполняет клиент — без этой строки
 * сообщение срабатывания до чата не доходило.
 *
 * @param entityName - имя сущности
 * @param report - что собрали срабатывания
 * @returns строка для чата либо `null`, если сообщать нечего
 */
export function formatSelfTriggerReport(
  entityName: string,
  report: SelfTriggerReport,
): string | null {
  const damageOutcomes = report.results.flatMap((result) =>
    result.damageOutcome ? [result.damageOutcome] : [],
  );

  const healingOutcomes = report.results.flatMap((result) =>
    result.healingOutcome ? [result.healingOutcome] : [],
  );

  const saveOutcomes = report.results.flatMap((result) =>
    result.saveOutcome ? [result.saveOutcome] : [],
  );

  const hasOutcomes =
    damageOutcomes.length > 0
    || healingOutcomes.length > 0
    || saveOutcomes.length > 0;

  return appendEffectsSummaryNotes(
    hasOutcomes
      ? formatEffectsSummary(
          entityName,
          SELF_TRIGGER_SUMMARY_LABEL,
          damageOutcomes,
          saveOutcomes,
          formatEntrySaveStatus,
          healingOutcomes,
        )
      : null,
    entityName,
    SELF_TRIGGER_SUMMARY_LABEL,
    report.notes,
  );
}
