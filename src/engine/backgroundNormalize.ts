/**
 * Приведение определения предыстории к канонической форме {@link BackgroundDefinition}.
 *
 * Записи компендиума приходят из разных источников (паки TTG Club, паки модулей
 * мира, предметы, созданные в панели «Предметы»), и блоки даров в них
 * НЕОБЯЗАТЕЛЬНЫ: контракт Ядра помечает `abilityGrant`/`skillGrant`/`toolGrant`/
 * `featGrant`/`equipmentOptions` опциональными (`DnDGameItem`), а отдача TTG Club
 * дополнительно вырезает пустые блоки (`@JsonInclude(NON_NULL)`) и вовсе не
 * отдаёт `toolGrant` — владение инструментами хранится там свободным текстом,
 * а не идентификаторами.
 *
 * Мастер предыстории и его шаги читают эти блоки напрямую, поэтому вместо
 * россыпи `?.` по UI неполная запись один раз достраивается пустыми дефолтами
 * здесь — на границе входа данных в мастер.
 *
 * @module system/dnd/backgroundNormalize
 */

import type {
  BackgroundDefinition,
  BackgroundFeatGrant,
  BackgroundToolGrant,
} from './backgroundTypes.js';

import { classKeyByName, classKeyFromUrl } from './classTypes.js';

/** Уточнение в скобках: «Посвящённый в магию (Волшебник)», «(Волшебник)». */
const SUBCHOICE_BRACKETS = /\(([^()]+)\)\s*$/;

/**
 * Уточнение из текста: скобка, если она есть, иначе сам текст. Одним разбором на
 * все источники — уточнение приезжает и отдельным полем, и хвостом названия.
 *
 * @param value - поле уточнения либо название черты
 */
function subchoiceText(value: string | undefined): string {
  const text = value?.trim() ?? '';

  return SUBCHOICE_BRACKETS.exec(text)?.[1]?.trim() ?? text;
}

/**
 * Класс, который предыстория называет за игрока: «Мудрец» даёт «Посвящённого в
 * магию (Волшебник)» — список заклинаний задан ею самой, и спрашивать его у
 * игрока незачем.
 *
 * Источников три, потому что уточнение приезжает по-разному: поле нашей формы
 * ({@link BackgroundFeatGrant.featClassKey} — ключом или названием), уточнение
 * выгрузки TTG Club ({@link BackgroundFeatGrant.featSuffix} — названием) и
 * скобка в названии черты у записей, сделанных до появления полей. Разбор
 * нестрогий: уточнение, за которым не стоит известный класс («Мастер оружия
 * (алебарда)»), ничего не задаёт.
 *
 * @param grant - грант черты предыстории
 * @returns канонический ключ класса; `null` — класс называет игрок
 */
export function resolveBackgroundFeatClassKey(
  grant: BackgroundFeatGrant | undefined,
): string | null {
  const named = [grant?.featClassKey, grant?.featSuffix, grant?.featName].map(
    subchoiceText,
  );

  return named.reduce<string | null>(
    (found, value) => found ?? classKeyFromUrl(value) ?? classKeyByName(value),
    null,
  );
}

/** Достраивает грант инструментов: пустой список + валидный блок выбора. */
function normalizeToolGrant(
  raw: Partial<BackgroundToolGrant> | undefined,
): BackgroundToolGrant {
  const items = raw?.items ?? [];
  const choices = raw?.choices;

  if (!choices || !choices.count) {
    return { items };
  }

  return {
    items,
    choices: { count: choices.count, from: choices.from ?? [] },
  };
}

/**
 * Возвращает копию определения с гарантированно присутствующими блоками даров.
 * `null`/`undefined` пробрасывается как `null` — «предыстория не выбрана»
 * остаётся отдельным состоянием мастера, а не пустым определением.
 *
 * @param raw - запись компендиума или предмет мира типа `background`
 */
export function normalizeBackgroundDefinition(
  raw: BackgroundDefinition | null | undefined,
): BackgroundDefinition | null {
  if (!raw) {
    return null;
  }

  return {
    ...raw,
    abilityGrant: { abilities: raw.abilityGrant?.abilities ?? [] },
    skillGrant: { skills: raw.skillGrant?.skills ?? [] },
    toolGrant: normalizeToolGrant(raw.toolGrant),
    featGrant: { ...raw.featGrant, featName: raw.featGrant?.featName ?? '' },
    equipmentOptions: (raw.equipmentOptions ?? []).map((option) => ({
      ...option,
      // Позиции необязательны: у старых паков и своих предысторий вариант — это
      // только строка. Пустой список позволяет шагу снаряжения читать
      // `option.items` без проверок.
      items: option.items ?? [],
    })),
  };
}
