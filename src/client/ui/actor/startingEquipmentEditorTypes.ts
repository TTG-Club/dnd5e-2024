/**
 * Локальные типы редактора стартового снаряжения (формы предыстории и класса).
 *
 * Вариант снаряжения приезжает из компендиума в двух видах сразу: готовая строка
 * для чтения и разбор по позициям ({@link StartingEquipmentOption}). Форма
 * держит его в плоском виде без необязательных полей — так поля ввода не
 * работают с `undefined`, — а при сохранении пустые поля отбрасываются.
 *
 * @module systems/dnd5e/ui/actor/startingEquipmentEditorTypes
 */

import type {
  BackgroundEquipmentOption,
  ClassStartingEquipmentOption,
  StartingEquipmentItem,
  StartingEquipmentOption,
} from '@vtt/shared/system/dnd.js';

import { generateId } from '@vtt/shared';

/** Вариант стартового снаряжения в редактируемом виде. */
export interface EditableStartingEquipmentOption {
  /** Ключ строки списка — живёт только в форме, в запись не идёт */
  uid: string;
  /** Метка варианта («А», «Б») — есть у класса, у предыстории пусто */
  key: string;
  /** Видимая строка варианта */
  description: string;
  /** Позиции варианта — по ним мастер кладёт предметы в инвентарь */
  items: StartingEquipmentItem[];
  /** Количество монет варианта (0 = нет) */
  coins: number;
  /** Вид монет (`GC`, `SC`, …); пусто — золотые */
  coin: string;
  /** Стоимость альтернативы золотом у предыстории (0 = нет) */
  goldAlternative: number;
}

/**
 * Разворачивает вариант записи в редактируемый вид.
 *
 * @param option - вариант из записи предыстории или класса
 */
export function toEditableEquipmentOption(
  option: BackgroundEquipmentOption | ClassStartingEquipmentOption,
): EditableStartingEquipmentOption {
  return {
    uid: generateId('eq'),
    key: 'key' in option ? option.key : '',
    description: option.description,
    items: (option.items ?? []).map((item) => ({ ...item })),
    coins: option.coins ?? 0,
    coin: option.coin ?? '',
    goldAlternative:
      'goldAlternative' in option ? (option.goldAlternative ?? 0) : 0,
  };
}

/** Пустой вариант — заводится кнопкой «Добавить вариант». */
export function createEquipmentOption(
  key: string,
): EditableStartingEquipmentOption {
  return {
    uid: generateId('eq'),
    key,
    description: '',
    items: [],
    coins: 0,
    coin: '',
    goldAlternative: 0,
  };
}

/**
 * Общая часть варианта к сохранению: строка, позиции без названия
 * отбрасываются, пустые поля не пишутся.
 *
 * @param option - вариант из редактора
 */
function buildCommon(
  option: EditableStartingEquipmentOption,
): StartingEquipmentOption {
  const built: StartingEquipmentOption = {
    description: option.description.trim(),
  };

  const items = option.items
    .filter((item) => item.name.trim().length > 0)
    .map((item) => {
      const builtItem: StartingEquipmentItem = { name: item.name.trim() };
      const url = item.url?.trim();
      const note = item.note?.trim();

      if (url) {
        builtItem.url = url;
      }

      if (item.quantity !== undefined && item.quantity > 1) {
        builtItem.quantity = Math.round(item.quantity);
      }

      if (note) {
        builtItem.note = note;
      }

      return builtItem;
    });

  if (items.length > 0) {
    built.items = items;
  }

  if (option.coins > 0) {
    built.coins = option.coins;

    if (option.coin.trim()) {
      built.coin = option.coin.trim();
    }
  }

  return built;
}

/**
 * Варианты снаряжения предыстории к сохранению. Вариант без строки, позиций и
 * монет отбрасывается: показывать и выдавать по нему нечего.
 *
 * @param options - варианты из редактора
 */
export function buildBackgroundEquipmentOptions(
  options: EditableStartingEquipmentOption[],
): BackgroundEquipmentOption[] {
  return options
    .map((option) => {
      const built: BackgroundEquipmentOption = buildCommon(option);

      if (option.goldAlternative > 0) {
        built.goldAlternative = option.goldAlternative;
      }

      return built;
    })
    .filter(
      (option) =>
        option.description.length > 0
        || Boolean(option.items?.length)
        || Boolean(option.coins)
        || Boolean(option.goldAlternative),
    );
}

/**
 * Варианты снаряжения класса к сохранению. Метка варианта обязательна — по ней
 * мастер класса подписывает выбор.
 *
 * @param options - варианты из редактора
 */
export function buildClassEquipmentOptions(
  options: EditableStartingEquipmentOption[],
): ClassStartingEquipmentOption[] {
  return options
    .filter((option) => option.key.trim().length > 0)
    .map((option) => ({ ...buildCommon(option), key: option.key.trim() }));
}
