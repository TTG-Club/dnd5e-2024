/**
 * Копирование вида, класса и подкласса из компендиума в «Мастерскую» мира.
 *
 * Определения вида и класса в мире живут записью-обёрткой (`speciesData` /
 * `classData`), поэтому копируются не сервером по id, как прочие записи, а
 * собираются здесь. Одна точка на всех: строка браузера компендиума и окна
 * просмотра обязаны класть в мир одно и то же.
 *
 * Ключ копии всегда новый — копия становится самостоятельной записью, и
 * запись компендиума при слиянии со списком мира её не перекрывает.
 */

import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  ClassDefinition,
  DnDGameItem,
  SpeciesDefinition,
  SubclassDefinition,
} from '@vtt/shared/system/dnd.js';

import { generateId } from '@vtt/shared';
import {
  splitSubclassRecords,
  toSubclassRecord,
} from '@vtt/shared/system/dnd.js';

/** Поля склада, обязательные у любой записи мира. */
const WORKSHOP_ITEM_DEFAULTS = {
  quantity: 1,
  weight: 0,
  cost: '',
  rarity: 'common',
  equipped: false,
  isReadOnly: false,
} as const;

/**
 * Запись мира для класса (и записи-подкласса).
 *
 * @param classDef - определение класса с уже новым ключом
 * @returns запись «Мастерской»
 */
function classWorkshopItem(classDef: ClassDefinition): Partial<DnDGameItem> {
  return {
    ...WORKSHOP_ITEM_DEFAULTS,
    name: classDef.name,
    nameEn: classDef.nameEn,
    description: classDef.description ?? '',
    type: 'class',
    sourceKey: classDef.sourceKey,
    isSRD: classDef.isSRD,
    classData: classDef,
  };
}

/**
 * Копирует вид (или подвид — запись со ссылкой `parentKey`) в «Мастерскую».
 * Ссылка на родителя сохраняется: копия подвида остаётся подвидом того же
 * вида — и того же компендиума, откуда её взяли: подвид лежит в одном паке со
 * своим родителем.
 *
 * @param socket - сокет мира; без него копировать некуда
 * @param species - определение вида из компендиума
 * @param packId - пак, из которого копируют; пусто — не известен
 */
export function copySpeciesToWorkshop(
  socket: TypedWebSocketClient | null,
  species: SpeciesDefinition,
  packId?: string,
): void {
  if (!socket) {
    return;
  }

  const parentPackId =
    species.parentKey && !species.parentPackId ? packId : undefined;

  const itemData: Partial<DnDGameItem> = {
    ...WORKSHOP_ITEM_DEFAULTS,
    name: species.name,
    nameEn: species.nameEn,
    description: species.description,
    type: 'species',
    sourceKey: species.sourceKey,
    isSRD: species.isSRD,
    speciesData: {
      ...species,
      key: generateId(species.key),
      ...(parentPackId ? { parentPackId } : {}),
    },
  };

  socket.emit('items:create', itemData);
}

/**
 * Копирует класс в «Мастерскую»: сам класс и каждый его подкласс — отдельными
 * записями, как вид и подвиды. Подкласс тогда правится своей формой и
 * сохраняется сам по себе, а на листе по-прежнему стоит среди подклассов
 * скопированного класса.
 *
 * @param socket - сокет мира; без него копировать некуда
 * @param classDef - определение класса из компендиума
 */
export function copyClassToWorkshop(
  socket: TypedWebSocketClient | null,
  classDef: ClassDefinition,
): void {
  if (!socket) {
    return;
  }

  const { classRecord, subclassRecords } = splitSubclassRecords(
    classDef,
    generateId(classDef.key),
    generateId,
  );

  for (const record of [classRecord, ...subclassRecords]) {
    socket.emit('items:create', classWorkshopItem(record));
  }
}

/**
 * Копирует один подкласс в «Мастерскую» отдельной записью-подклассом того же
 * класса: на листе он появится рядом с подклассами компендиума, а править его
 * можно, не трогая сам класс.
 *
 * @param socket - сокет мира; без него копировать некуда
 * @param parent - класс, внутри которого лежит подкласс
 * @param subclass - подкласс этого класса
 * @param parentPackId - пак класса; пусто — не известен
 */
export function copySubclassToWorkshop(
  socket: TypedWebSocketClient | null,
  parent: ClassDefinition,
  subclass: SubclassDefinition,
  parentPackId?: string,
): void {
  if (!socket) {
    return;
  }

  socket.emit(
    'items:create',
    classWorkshopItem(
      toSubclassRecord(
        parent,
        subclass,
        generateId(subclass.key),
        parentPackId,
      ),
    ),
  );
}
