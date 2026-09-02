/**
 * Меню «Добавить модификатор» формы активного эффекта.
 *
 * Форма эффекта заполняется ключами (`armorClass`, `movement.fly`), и вписывать
 * их руками автор не обязан: меню предлагает те же понятные строки, что и
 * вкладка «Автоматизация» черты, а ключ, режим и значение подставляет само.
 *
 * Свой список ключей здесь НЕ заводится: разделы и режимы выводятся из того же
 * {@link EFFECT_TARGET_SUGGESTIONS}, которым живут библиотека ключей формы,
 * проверка `isEffectTargetKey` и авто-описание эффекта. Второй список рано или
 * поздно разошёлся бы с первым, и меню предлагало бы ключи, которых движок не
 * знает.
 *
 * @module system/dnd/effectModifierMenu
 */

import type { EffectChangeKey, EffectChangeMode } from './activeEffectTypes.js';

import {
  CARRIER_ARMOR_CONDITION_PREFIX,
  CARRIER_TYPE_CONDITION_PREFIX,
  EFFECT_CONDITION_SUGGESTIONS,
  EFFECT_TARGET_SUGGESTIONS,
  isEffectTargetKey,
  TARGET_TYPE_CONDITION_PREFIX,
} from './activeEffectTypes.js';

/** Раздел меню модификаторов. */
export type EffectModifierGroup =
  | 'core'
  | 'senses'
  | 'movement'
  | 'terrain'
  | 'abilities'
  | 'saves'
  | 'skills'
  | 'attack'
  | 'damage'
  | 'carrierType'
  | 'carrierArmor'
  | 'targetType';

/** Подписи разделов меню. */
const EFFECT_MODIFIER_GROUP_LABELS: Record<EffectModifierGroup, string> = {
  core: 'Основное',
  senses: 'Чувства',
  movement: 'Скорости',
  terrain: 'Местность (только для зоны сцены)',
  abilities: 'Характеристики',
  saves: 'Спасброски',
  skills: 'Навыки',
  attack: 'Атака',
  damage: 'Урон',
  carrierType: 'Условие: тип носителя',
  carrierArmor: 'Условие: доспех носителя',
  targetType: 'Условие: тип цели',
};

/** Порядок разделов в меню — от самого частого к редкому. */
const GROUP_ORDER: readonly EffectModifierGroup[] = [
  'core',
  'senses',
  'movement',
  'terrain',
  'abilities',
  'saves',
  'skills',
  'attack',
  'damage',
  'carrierType',
  'carrierArmor',
  'targetType',
];

/** Готовая строка модификатора: что подставится в новую строку формы. */
export interface EffectModifierPreset {
  /**
   * Ключ изменения. Пусто — пункт задаёт только условие: что менять, автор
   * назовёт сам (см. разделы «Условие: …»).
   */
  key: EffectChangeKey;
  /** Подпись пункта меню */
  label: string;
  /** Режим применения */
  mode: EffectChangeMode;
  /**
   * Значение строки. Не задано — форма подставит своё значение по умолчанию:
   * у большинства ключей осмысленного числа нет, его называет автор.
   */
  value?: string;
  /**
   * Условие строки. Задано — остальные поля пункт намеренно оставляет пустыми:
   * условие выбрано, а что оно ограничивает, автор заполняет сам.
   */
  condition?: string;
}

/** Раздел меню со своими пунктами. */
export interface EffectModifierMenuGroup {
  group: EffectModifierGroup;
  label: string;
  items: EffectModifierPreset[];
}

/**
 * Раздел, к которому относится ключ. Определяется приставкой — так новый ключ
 * попадает в меню сам, без правки этого файла.
 *
 * @param key - ключ изменения эффекта
 */
function groupOfKey(key: string): EffectModifierGroup {
  if (key.startsWith('ability.')) {
    return 'abilities';
  }

  if (key.startsWith('save.')) {
    return 'saves';
  }

  if (key.startsWith('skill.')) {
    return 'skills';
  }

  if (key.startsWith('attack.')) {
    return 'attack';
  }

  if (key.startsWith('damage.')) {
    return 'damage';
  }

  if (key.startsWith('movement.')) {
    return 'movement';
  }

  // Своим разделом, а не среди скоростей: это правило ЗОНЫ, а не носителя.
  // На листе такая строка не считается вовсе, и путать её со Скоростью нельзя.
  if (key.startsWith('terrain.')) {
    return 'terrain';
  }

  if (key.startsWith('sense.')) {
    return 'senses';
  }

  return 'core';
}

/**
 * Режим по умолчанию для ключа.
 *
 * Чувства и новые виды движения не складываются: два источника слепого зрения
 * дают не сумму, а большую дальность — это режим «Повысить до». Прибавка к
 * скорости ходьбы остаётся прибавкой, как и всё остальное.
 *
 * @param key - ключ изменения эффекта
 */
function defaultModeOfKey(key: string): EffectChangeMode {
  if (key.startsWith('sense.')) {
    return 'upgrade';
  }

  // Цена клетки — не прибавка к чему-то, а само значение: «здесь клетка стоит
  // вдвое». Прибавка тут читалась бы как «+2 к обычной цене», то есть ×3.
  if (key.startsWith('terrain.')) {
    return 'override';
  }

  if (key.startsWith('movement.') && key !== 'movement.walk') {
    return 'upgrade';
  }

  return 'add';
}

/**
 * Значение по умолчанию для раздела: только там, где единица выглядела бы
 * ошибкой — чувство «1 фут», скорость полёта «1 фут» или цена клетки «×1»
 * (то есть «зона ничего не меняет»).
 *
 * @param group - раздел меню
 */
function defaultValueOfGroup(group: EffectModifierGroup): string | undefined {
  if (group === 'terrain') {
    return '2';
  }

  if (group === 'senses') {
    return '60';
  }

  if (group === 'movement') {
    return '10';
  }

  return undefined;
}

/**
 * Комбинации, где важен не только ключ, но и значение: одним ключом их не
 * выразить, а руками автор писал бы формулу.
 *
 * Своего раздела у них нет — каждая встаёт в конец того же раздела, что и её
 * ключ: «полёт равен скорости ходьбы» ищут среди скоростей, а не в отдельном
 * списке «готовых».
 */
const READY_PRESETS: readonly EffectModifierPreset[] = [
  {
    key: 'initiative',
    label: 'Инициатива: + бонус мастерства',
    mode: 'add',
    value: '@prof',
  },
  {
    key: 'hitPoints.max',
    label: 'Максимум хитов: за каждый уровень',
    mode: 'add',
    value: '@level',
  },
  {
    key: 'movement.fly',
    label: 'Полёт: равен скорости ходьбы',
    mode: 'upgrade',
    value: '@speed.walk',
  },
  {
    key: 'movement.climb',
    label: 'Лазание: равно скорости ходьбы',
    mode: 'upgrade',
    value: '@speed.walk',
  },
  {
    key: 'movement.swim',
    label: 'Плавание: равно скорости ходьбы',
    mode: 'upgrade',
    value: '@speed.walk',
  },
  {
    key: 'movement.fly',
    label: 'Полёт: равен скорости плавания',
    mode: 'upgrade',
    value: '@speed.swim',
  },
];

/**
 * Пункты-условия по типу существа: выбор заполняет ТОЛЬКО поле условия, а ключ
 * и значение остаются пустыми — что именно ограничивает условие, автор
 * называет сам.
 *
 * Строки условий берутся из того же {@link EFFECT_CONDITION_SUGGESTIONS}, что и
 * библиотека условий формы: движок обязан уметь вычислить каждое предложенное
 * условие, и второй список разошёлся бы с первым.
 *
 * @param prefix - приставка условия семейства (носитель или цель)
 */
function conditionPresets(prefix: string): EffectModifierPreset[] {
  return EFFECT_CONDITION_SUGGESTIONS.filter((suggestion) =>
    suggestion.value.startsWith(prefix),
  ).map((suggestion) => ({
    key: '',
    label: suggestion.label,
    mode: 'add',
    condition: suggestion.value,
  }));
}

/**
 * Собирает меню: сперва простые ключи раздела, следом готовые комбинации того
 * же раздела.
 */
function buildMenu(): EffectModifierMenuGroup[] {
  const byGroup = new Map<EffectModifierGroup, EffectModifierPreset[]>();

  for (const suggestion of EFFECT_TARGET_SUGGESTIONS) {
    // Подсказки — свободные строки, а строка формы типизирована ключом:
    // неизвестный ключ в меню не попадает
    if (!isEffectTargetKey(suggestion.value)) {
      continue;
    }

    const group = groupOfKey(suggestion.value);
    const items = byGroup.get(group) ?? [];

    items.push({
      key: suggestion.value,
      label: suggestion.label,
      mode: defaultModeOfKey(suggestion.value),
      value: defaultValueOfGroup(group),
    });

    byGroup.set(group, items);
  }

  for (const preset of READY_PRESETS) {
    const group = groupOfKey(preset.key);
    const items = byGroup.get(group) ?? [];

    items.push(preset);
    byGroup.set(group, items);
  }

  byGroup.set('carrierType', conditionPresets(CARRIER_TYPE_CONDITION_PREFIX));

  byGroup.set('carrierArmor', conditionPresets(CARRIER_ARMOR_CONDITION_PREFIX));

  byGroup.set('targetType', conditionPresets(TARGET_TYPE_CONDITION_PREFIX));

  return GROUP_ORDER.filter(
    (group) => (byGroup.get(group) ?? []).length > 0,
  ).map((group) => ({
    group,
    label: EFFECT_MODIFIER_GROUP_LABELS[group],
    items: byGroup.get(group) ?? [],
  }));
}

/**
 * Меню модификаторов разделами — готово к показу выпадающим списком.
 * Считается один раз: списки ключей статичны.
 */
export const EFFECT_MODIFIER_MENU: readonly EffectModifierMenuGroup[] =
  buildMenu();
