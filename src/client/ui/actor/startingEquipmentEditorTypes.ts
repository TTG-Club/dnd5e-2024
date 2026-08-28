/**
 * Локальные типы редактора стартового снаряжения (формы предыстории и класса).
 *
 * Вариант снаряжения — это НАБОР ПОЗИЦИЙ и монеты к ним. Позиция адресуется
 * слагом страницы предмета ({@link StartingEquipmentItem.url}) — по нему она
 * находится в компендиуме и ложится в инвентарь полноценным предметом. Слаг
 * проставляет выбор из компендиума; вписанная руками позиция остаётся без него
 * и ложится простым предметом по названию.
 *
 * Форма держит вариант в плоском виде без необязательных полей — так поля ввода
 * не работают с `undefined`, — а при сохранении пустые поля отбрасываются.
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

import { CLASS_OPTION_KEYS } from './constants';

/** Позиция варианта в редактируемом виде. */
export interface EditableStartingEquipmentItem {
  /** Ключ строки списка — живёт только в форме, в запись не идёт */
  uid: string;
  /** Слаг страницы предмета; пусто — позиция вписана руками */
  url: string;
  name: string;
  /** Количество, не меньше 1 */
  quantity: number;
  /** Уточнение к позиции («по вашему выбору») */
  note: string;
}

/** Вариант стартового снаряжения в редактируемом виде. */
export interface EditableStartingEquipmentOption {
  /** Ключ строки списка — живёт только в форме, в запись не идёт */
  uid: string;
  /** Метка варианта («А», «Б») — есть у класса, у предыстории пусто */
  key: string;
  /**
   * Строка варианта из выгрузки сайта. В форме её НЕ правят: что игрок увидит,
   * решают позиции. Возится дальше нетронутой ради записей без позиций (старые
   * паки, свои классы) — им, кроме неё, показывать нечего.
   */
  description: string;
  /** Позиции варианта — по ним мастер кладёт предметы в инвентарь */
  items: EditableStartingEquipmentItem[];
  /** Количество золотых монет варианта (0 = нет) */
  coins: number;
  /** Стоимость альтернативы золотом у предыстории (0 = нет) */
  goldAlternative: number;
}

/**
 * Разворачивает позицию записи в редактируемый вид.
 *
 * @param item - позиция варианта
 */
function toEditableItem(
  item: StartingEquipmentItem,
): EditableStartingEquipmentItem {
  return {
    uid: generateId('eqi'),
    url: item.url ?? '',
    name: item.name,
    quantity:
      item.quantity !== undefined && item.quantity > 1
        ? Math.round(item.quantity)
        : 1,
    note: item.note ?? '',
  };
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
    items: (option.items ?? []).map(toEditableItem),
    coins: option.coins ?? 0,
    goldAlternative:
      'goldAlternative' in option ? (option.goldAlternative ?? 0) : 0,
  };
}

/** Пустая позиция — заводится кнопкой «Вписать позицию». */
export function createEquipmentItem(
  fields: Partial<EditableStartingEquipmentItem> = {},
): EditableStartingEquipmentItem {
  return {
    uid: generateId('eqi'),
    url: '',
    name: '',
    quantity: 1,
    note: '',
    ...fields,
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
    goldAlternative: 0,
  };
}

/**
 * Есть ли в варианте что сохранять. Пустой вариант (ни позиций, ни монет, ни
 * доставшейся из выгрузки строки) отбрасывается: показывать и выдавать по нему
 * нечего.
 *
 * @param option - вариант из редактора
 */
function isFilled(option: EditableStartingEquipmentOption): boolean {
  return (
    option.items.some((item) => item.name.trim().length > 0)
    || option.coins > 0
    || option.goldAlternative > 0
    || option.description.trim().length > 0
  );
}

/**
 * Общая часть варианта к сохранению: позиции без названия отбрасываются,
 * пустые поля не пишутся.
 *
 * Вид монет не пишется вовсе — стартовые деньги везде золотые, и отдельное поле
 * под них только путало.
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
      const url = item.url.trim();
      const note = item.note.trim();

      if (url) {
        builtItem.url = url;
      }

      if (item.quantity > 1) {
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
  }

  return built;
}

/**
 * Варианты снаряжения предыстории к сохранению.
 *
 * @param options - варианты из редактора
 */
export function buildBackgroundEquipmentOptions(
  options: EditableStartingEquipmentOption[],
): BackgroundEquipmentOption[] {
  return options.filter(isFilled).map((option) => {
    const built: BackgroundEquipmentOption = buildCommon(option);

    if (option.goldAlternative > 0) {
      built.goldAlternative = option.goldAlternative;
    }

    return built;
  });
}

/**
 * Варианты снаряжения класса к сохранению. Метка варианта («А», «Б») больше не
 * вводится руками — её раздаёт порядок: руками её всё равно набирали по
 * алфавиту, а пустая метка молча теряла целый вариант.
 *
 * @param options - варианты из редактора
 */
export function buildClassEquipmentOptions(
  options: EditableStartingEquipmentOption[],
): ClassStartingEquipmentOption[] {
  return options.filter(isFilled).map((option, index) => ({
    ...buildCommon(option),
    key: option.key.trim() || CLASS_OPTION_KEYS[index] || String(index + 1),
  }));
}
