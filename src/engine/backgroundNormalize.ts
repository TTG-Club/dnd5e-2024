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
  BackgroundToolGrant,
} from './backgroundTypes.js';

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
