/**
 * Под-модуль системы D&D 5e: СВОИ КОМПЕНДИУМЫ МИРА.
 *
 * Мастер создаёт компендиум прямо в мире и кладёт в него записи «Мастерской» и
 * существ. Приложение даёт каркас (папки, замок, перетаскивание), а из чего
 * компендиум состоит, знает система: здесь регистрируются типы разделов D&D 5e —
 * как раздел называется, как показывать его список и как превратить сущность
 * мира в запись раздела.
 *
 * @module systems/dnd5e/modules/compendium
 */

import type {
  CompendiumKindRegistration,
  CompendiumWorldSource,
} from '@/core/registries';
import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { CompendiumEntryDraft } from '@vtt/shared/system/dnd.js';

import {
  COMPENDIUM_CREATURE_KIND,
  isDnDGameItem,
  worldCreatureToCompendiumEntry,
  worldItemToCompendiumEntry,
} from '@vtt/shared/system/dnd.js';

import { itemTypeIcon, itemTypeLabel } from '../../composables/dnd5eItemTypes';
import {
  COMPENDIUM_CREATURE_SECTION,
  COMPENDIUM_ITEM_SECTION_KINDS,
  COMPENDIUM_SECTION_FALLBACK_ICON,
  COMPENDIUM_SECTION_VIEWS,
} from '../../ui/compendium/constants';

/**
 * Собирает запись раздела из записи «Мастерской».
 *
 * @param kind - тип записей раздела
 * @param source - сущность мира
 * @returns запись компендиума либо `null`, если сущность разделу не подходит
 */
function itemSourceToEntry(
  kind: string,
  source: CompendiumWorldSource,
): CompendiumEntryDraft | null {
  if (source.kind !== 'item' || !isDnDGameItem(source.entity)) {
    return null;
  }

  return worldItemToCompendiumEntry(kind, source.entity);
}

/**
 * Собирает запись раздела существ из существа мира.
 *
 * @param source - сущность мира
 * @returns запись компендиума либо `null`, если сущность — не существо
 */
function creatureSourceToEntry(
  source: CompendiumWorldSource,
): CompendiumEntryDraft | null {
  if (source.kind !== 'creature') {
    return null;
  }

  return worldCreatureToCompendiumEntry(source.entity);
}

/**
 * Описывает тип раздела, хранящий записи «Мастерской». Название и значок — те
 * же, что у вида записей в «Мастерской»: раздел компендиума и закладка панели
 * говорят об одном и том же.
 *
 * @param kind - тип записей раздела
 * @returns описание типа раздела
 */
function buildItemSectionKind(kind: string): CompendiumKindRegistration {
  return {
    kind,
    label: itemTypeLabel(kind) ?? kind,
    icon: itemTypeIcon(kind) ?? COMPENDIUM_SECTION_FALLBACK_ICON,
    defaultView: COMPENDIUM_SECTION_VIEWS[kind],
    toEntry: (source) => itemSourceToEntry(kind, source),
  };
}

/** Регистрирует типы разделов своих компендиумов D&D 5e (через SDK). */
export function register(api: ClientSystemAPI): void {
  for (const kind of COMPENDIUM_ITEM_SECTION_KINDS) {
    api.compendiumKind(buildItemSectionKind(kind));
  }

  api.compendiumKind({
    kind: COMPENDIUM_CREATURE_KIND,
    label: COMPENDIUM_CREATURE_SECTION.label,
    icon: COMPENDIUM_CREATURE_SECTION.icon,
    defaultView: COMPENDIUM_SECTION_VIEWS[COMPENDIUM_CREATURE_KIND],
    toEntry: creatureSourceToEntry,
  });
}
