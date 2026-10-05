/**
 * Запись своего компендиума мира из сущности мира.
 *
 * Мастер кладёт запись «Мастерской» или существо в свой компендиум. Формы у
 * сущности мира и записи компендиума разные: заклинание, класс и вид в мире —
 * предмет-обёртка с вложенным определением, а в компендиуме определение лежит
 * плоско; существо мира несёт владельцев и наложенные эффекты, которым в
 * компендиуме не место. Здесь — обратное преобразование к тому, что делает
 * кнопка «Копировать» в компендиуме.
 *
 * Ключ записи (`id`) эти функции не задают: его выдаёт сервер приложения.
 *
 * @module compendiumEntry
 */

import type { BaseCreature } from '@vtt/shared';

import type { DnDGameItem } from './dndEntities.js';
import type { SpeciesDefinition } from './speciesTypes.js';

import { isRecord } from '@vtt/shared';

import { isClassDefinition } from './classTypes.js';
import { isDnDGameItem } from './itemSchemas.js';
import { isSpell } from './spellUtils.js';

/** Запись компендиума в виде, готовом к сохранению. */
export type CompendiumEntryDraft = Record<string, unknown>;

/** Тип записей раздела заклинаний. */
export const COMPENDIUM_SPELL_KIND = 'spell';

/** Тип записей раздела классов. */
export const COMPENDIUM_CLASS_KIND = 'class';

/** Тип записей раздела видов. */
export const COMPENDIUM_SPECIES_KIND = 'species';

/** Тип записей раздела существ. */
export const COMPENDIUM_CREATURE_KIND = 'creature';

/**
 * Типы записей «Мастерской», которые лежат в компендиуме в том же виде, что и
 * в мире: оружие, снаряжение, инструменты, черты, предыстории.
 */
export const COMPENDIUM_PLAIN_ITEM_KINDS: readonly string[] = [
  'weapon',
  'equipment',
  'tool',
  'feat',
  'background',
];

/**
 * Убирает из записи «Мастерской» то, что относится к миру, а не к содержанию:
 * мировой идентификатор, признак «надето», запрет правки и адрес страницы
 * сайта (он принадлежит официальной записи, с которой сделана копия).
 *
 * @param item - запись «Мастерской»
 * @returns содержательные поля записи
 */
function stripWorldItemFields(item: DnDGameItem): CompendiumEntryDraft {
  const {
    id: _id,
    equipped: _equipped,
    isReadOnly: _isReadOnly,
    srcSection: _srcSection,
    srcUrl: _srcUrl,
    srcVariant: _srcVariant,
    ...content
  } = item;

  return content;
}

/**
 * Собирает запись из определения, вложенного в предмет-обёртку (заклинание,
 * класс, вид). Название, описание и источник берутся у обёртки: в мире их
 * правят именно там.
 *
 * @param kind - тип записей раздела
 * @param item - предмет-обёртка
 * @param definition - вложенное определение
 * @returns плоская запись компендиума
 */
function unwrapDefinition(
  kind: string,
  item: DnDGameItem,
  definition: object,
): CompendiumEntryDraft {
  const { id: _id, ...content } = { id: undefined, ...definition };

  return {
    ...content,
    type: kind,
    name: item.name,
    nameEn: item.nameEn,
    description: item.description,
    sourceKey: item.sourceKey,
    source: item.source,
    isSRD: item.isSRD,
  };
}

/**
 * Превращает запись «Мастерской» в запись раздела заданного типа.
 *
 * @param kind - тип записей раздела (`dataKind`)
 * @param item - запись «Мастерской»
 * @returns запись компендиума либо `null`, если запись этому разделу не подходит
 */
export function worldItemToCompendiumEntry(
  kind: string,
  item: DnDGameItem,
): CompendiumEntryDraft | null {
  if (item.type !== kind) {
    return null;
  }

  if (COMPENDIUM_PLAIN_ITEM_KINDS.includes(kind)) {
    return stripWorldItemFields(item);
  }

  if (kind === COMPENDIUM_SPELL_KIND && item.spellData) {
    return unwrapDefinition(kind, item, item.spellData);
  }

  if (kind === COMPENDIUM_CLASS_KIND && item.classData) {
    return unwrapDefinition(kind, item, item.classData);
  }

  if (kind === COMPENDIUM_SPECIES_KIND && item.speciesData) {
    return unwrapDefinition(kind, item, item.speciesData);
  }

  return null;
}

/**
 * Превращает существо мира в запись компендиума: статблок, фишка, заклинания и
 * снаряжение. Владельцы, видимость и наложенные эффекты остаются в мире — это
 * состояние конкретного существа на столе, а не его описание.
 *
 * Принимает нейтральную форму существа: заклинания и снаряжение — поля D&D
 * поверх неё, и переносятся они как есть, без разбора.
 *
 * @param creature - существо мира
 * @returns запись компендиума
 */
export function worldCreatureToCompendiumEntry(
  creature: BaseCreature,
): CompendiumEntryDraft {
  return {
    type: COMPENDIUM_CREATURE_KIND,
    name: creature.name,
    nameEn: creature.nameEn,
    description: creature.description,
    header: creature.header,
    token: creature.token,
    system: creature.system,
    spells: 'spells' in creature ? creature.spells : undefined,
    equipment: 'equipment' in creature ? creature.equipment : undefined,
  };
}

/**
 * Проверяет, что запись — определение вида: ключ, по которому вид находит лист,
 * и тип существа, без которого вид не применить.
 *
 * @param value - запись компендиума
 * @returns `true`, если запись похожа на определение вида
 */
function isSpeciesEntry(value: unknown): value is SpeciesDefinition {
  return (
    isRecord(value)
    && typeof value.key === 'string'
    && typeof value.name === 'string'
    && 'creatureType' in value
  );
}

/**
 * Читает необязательную строку записи.
 *
 * @param entry - запись компендиума
 * @param field - имя поля
 * @returns значение поля либо `undefined`, если его нет или оно не строка
 */
function readEntryText(
  entry: CompendiumEntryDraft,
  field: string,
): string | undefined {
  const value = entry[field];

  return typeof value === 'string' ? value : undefined;
}

/**
 * Собирает предмет-обёртку для определения из компендиума — в том виде, в каком
 * его ждут формы заклинания, класса и вида.
 *
 * @param kind - тип записей раздела
 * @param entry - запись компендиума
 * @param entryKey - ключ записи; пустой у записи, которой ещё нет в разделе
 * @returns общие поля предмета-обёртки
 */
function buildDefinitionWrapper(
  kind: string,
  entry: CompendiumEntryDraft,
  entryKey: string,
): DnDGameItem {
  return {
    id: entryKey,
    name: readEntryText(entry, 'name') ?? '',
    nameEn: readEntryText(entry, 'nameEn'),
    description: readEntryText(entry, 'description') ?? '',
    type: kind,
    quantity: 1,
    weight: 0,
    cost: '',
    rarity: 'common',
    equipped: false,
    sourceKey: readEntryText(entry, 'sourceKey'),
    isSRD: entry.isSRD === true,
    isReadOnly: false,
  };
}

/**
 * Превращает запись своего компендиума в предмет для формы правки — в ту же
 * форму, которой правят записи «Мастерской». Обратно к
 * {@link worldItemToCompendiumEntry}: сохранённое формой проходит через него и
 * возвращается записью.
 *
 * @param kind - тип записей раздела (`dataKind`)
 * @param entry - запись компендиума
 * @returns предмет для формы либо `null`, если запись не разобрать
 */
export function compendiumEntryToWorldItem(
  kind: string,
  entry: CompendiumEntryDraft,
): DnDGameItem | null {
  const entryKey =
    readEntryText(entry, 'id') ?? readEntryText(entry, 'key') ?? '';

  if (kind === COMPENDIUM_SPELL_KIND) {
    const spell = { ...entry, id: entryKey };

    return isSpell(spell)
      ? { ...buildDefinitionWrapper(kind, entry, entryKey), spellData: spell }
      : null;
  }

  if (kind === COMPENDIUM_CLASS_KIND) {
    return isClassDefinition(entry)
      ? { ...buildDefinitionWrapper(kind, entry, entryKey), classData: entry }
      : null;
  }

  if (kind === COMPENDIUM_SPECIES_KIND) {
    return isSpeciesEntry(entry)
      ? { ...buildDefinitionWrapper(kind, entry, entryKey), speciesData: entry }
      : null;
  }

  const item = { ...entry, id: entryKey, equipped: false, isReadOnly: false };

  return isDnDGameItem(item) && item.type === kind ? item : null;
}
