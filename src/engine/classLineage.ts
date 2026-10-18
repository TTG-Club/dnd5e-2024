import type {
  ClassCounterDefinition,
  ClassDefinition,
  ClassFeature,
  SubclassDefinition,
} from './classTypes.js';

import { subclassCounterDefinitions } from './classCounterDefinitions.js';
import { matchesParentPack } from './consts.js';

/**
 * Подклассы отдельными записями: подкласс — самостоятельная запись класса со
 * ссылкой `parentClassKey` на родителя, как на сайте TTG Club
 * (`CharacterClass.parentUrl`) и как подвид у вида (`speciesLineage.ts`).
 *
 * Из компендиума подклассы приезжают уже свёрнутыми в `subclasses` родителя —
 * отдельными записями заводят хоумбрю-подклассы в самом мире. Чтобы весь лист
 * (мастер настройки, просмотр класса, счётчики) не знал про две формы записи,
 * список классов собирают через {@link mergeSubclassRecords}: после него
 * подкласс мира лежит там же, где подкласс компендиума.
 *
 * Ключ подкласса — его единственная идентичность на листе (`subclassKey` записи
 * класса у персонажа), поэтому внутри класса ключи обязаны быть уникальными.
 * Выгрузка выводит ключ из английского названия, и два издания одного
 * подкласса (UA-версии «Арканного лучника») приезжают с одним ключом: список
 * показывал их двумя строками, а выбор одной отмечал обе. Правило уникальности —
 * {@link withUniqueSubclassKeys}, то же, что у `VttgClassMapper` в core-api.
 */

/** Запись-подкласс: ключ родителя у неё заполнен всегда. */
type SubclassRecord = ClassDefinition & { parentClassKey: string };

/**
 * Является ли запись подклассом другого класса.
 *
 * @param definition - запись класса
 * @returns `true`, когда запись ссылается на родителя
 */
export function isSubclassRecord(
  definition: ClassDefinition,
): definition is SubclassRecord {
  return Boolean(definition.parentClassKey);
}

/**
 * Подходит ли запись-подкласс родителю из пака `packId` (см.
 * {@link ClassDefinition.parentClassPackId}).
 *
 * @param record - запись-подкласс
 * @param packId - пак родителя; пусто — не известен
 * @param knownPackIds - подключённые паки (см. `matchesParentPack`)
 * @returns `true`, если подкласс относится к родителю этого пака
 */
export function subclassFitsPack(
  record: ClassDefinition,
  packId: string | undefined,
  knownPackIds?: ReadonlySet<string>,
): boolean {
  return matchesParentPack(record.parentClassPackId, packId, knownPackIds);
}

/**
 * Собирает записи-подклассы указанного класса из набора записей (мир +
 * компендиум), отсортированные по названию.
 *
 * @param parentKey - ключ родительского класса
 * @param records - все доступные записи классов
 * @returns записи-подклассы указанного класса
 */
export function collectSubclassRecords(
  parentKey: string,
  records: ReadonlyArray<ClassDefinition>,
): ClassDefinition[] {
  return records
    .filter((record) => record.parentClassKey === parentKey)
    .sort((first, second) =>
      first.name.localeCompare(second.name, 'ru', { sensitivity: 'base' }),
    );
}

/**
 * Уровень открытия подкласса — минимальный уровень его умений. Так же его
 * выводит выгрузка сайта, когда у подкласса нет своего уровня.
 *
 * @param features - умения подкласса
 * @param fallbackLevel - уровень выбора подкласса у родителя
 * @returns уровень, на котором подкласс становится доступен
 */
function resolveUnlockLevel(
  features: ReadonlyArray<ClassFeature>,
  fallbackLevel: number,
): number {
  const levels = features.map((feature) => feature.level);

  return levels.length > 0 ? Math.min(...levels) : fallbackLevel;
}

/**
 * Переводит запись-подкласс в подкласс родителя. Умения получают
 * `subclassKey`: по нему лист отличает умение подкласса от умения класса.
 *
 * @param record - запись-подкласс
 * @param fallbackUnlockLevel - уровень выбора подкласса у родителя
 * @returns подкласс в форме, которую читает весь лист
 */
export function toSubclassDefinition(
  record: ClassDefinition,
  fallbackUnlockLevel: number,
): SubclassDefinition {
  const features = record.features.map((feature) => ({
    ...feature,
    subclassKey: record.key,
  }));

  const subclass: SubclassDefinition = {
    key: record.key,
    name: record.name,
    nameEn: record.nameEn ?? record.name,
    description: record.description ?? '',
    unlockLevel: resolveUnlockLevel(features, fallbackUnlockLevel),
    features,
  };

  if (record.sourceKey) {
    subclass.sourceKey = record.sourceKey;
  }

  if (record.source) {
    subclass.source = record.source;
  }

  if (record.spellcasting) {
    subclass.spellcasting = { ...record.spellcasting };
  }

  // Своя таблица переносится только целиком: без колонок её строки — набор
  // безымянных чисел, и просмотр класса нарисовал бы пустые заголовки
  if (record.tableColumns && record.tableColumns.length > 0) {
    subclass.levelTable = record.levelTable;
    subclass.tableColumns = record.tableColumns;
  }

  if (record.counters && record.counters.length > 0) {
    subclass.counters = record.counters;
  }

  if (record.activeEffects && record.activeEffects.length > 0) {
    subclass.activeEffects = record.activeEffects;
  }

  if (record.featData) {
    subclass.featData = record.featData;
  }

  return subclass;
}

/**
 * Копия значения без ссылки на подкласс. У записи-подкласса её умения и ресурсы
 * свои по определению — ключ подкласса им проставит
 * {@link toSubclassDefinition} уже новым ключом записи.
 *
 * @param value - умение или ресурс подкласса
 * @returns копия без `subclassKey`
 */
function withoutSubclassKey<T extends { subclassKey?: string }>(
  value: T,
): Omit<T, 'subclassKey'> {
  const { subclassKey: _subclassKey, ...rest } = value;

  return rest;
}

/**
 * Переводит подкласс, свёрнутый внутрь класса, в самостоятельную
 * запись-подкласс — обратное к {@link toSubclassDefinition}. Так подкласс
 * компендиума копируют в «Мастерскую» мира, чтобы править отдельно от класса.
 *
 * Ресурсы подкласса собираются из обоих мест, где их держит выгрузка: общего
 * списка класса (помеченные ключом подкласса) и списка самого подкласса.
 * Базовая механика (кость хитов, владения) берётся у родителя: у записи-
 * подкласса она не читается, но форма класса без неё открылась бы пустой.
 *
 * @param parent - класс, внутри которого лежит подкласс
 * @param subclass - подкласс этого класса
 * @param key - ключ новой записи
 * @param parentPackId - пак родителя; пусто — родитель из любого пака
 * @returns запись-подкласс со ссылкой на родителя
 */
export function toSubclassRecord(
  parent: ClassDefinition,
  subclass: SubclassDefinition,
  key: string,
  parentPackId?: string,
): SubclassRecord {
  const counters = subclassCounterDefinitions(parent, subclass.key).map(
    withoutSubclassKey,
  );

  const record: SubclassRecord = {
    type: 'class',
    key,
    name: subclass.name,
    nameEn: subclass.nameEn,
    description: subclass.description,
    parentClassKey: parent.key,
    hitDie: parent.hitDie,
    armorProficiencies: [...parent.armorProficiencies],
    weaponProficiencies: [...parent.weaponProficiencies],
    savingThrowProficiencies: [...parent.savingThrowProficiencies],
    skillChoices: {
      count: parent.skillChoices.count,
      from: [...parent.skillChoices.from],
    },
    subclassLevel: parent.subclassLevel,
    subclassLabel: parent.subclassLabel,
    subclasses: [],
    features: subclass.features.map(withoutSubclassKey),
    levelTable: subclass.levelTable ?? [],
  };

  if (parentPackId) {
    record.parentClassPackId = parentPackId;
  }

  if (subclass.sourceKey) {
    record.sourceKey = subclass.sourceKey;
  }

  if (subclass.source) {
    record.source = subclass.source;
  }

  if (subclass.spellcasting) {
    record.spellcasting = { ...subclass.spellcasting };
  }

  if (subclass.tableColumns && subclass.tableColumns.length > 0) {
    record.tableColumns = subclass.tableColumns;
  }

  if (counters.length > 0) {
    record.counters = counters;
  }

  if (subclass.activeEffects && subclass.activeEffects.length > 0) {
    record.activeEffects = subclass.activeEffects;
  }

  if (subclass.featData) {
    record.featData = subclass.featData;
  }

  return record;
}

/** Класс, разложенный на самостоятельные записи: сам класс и его подклассы. */
export interface SplitClassRecords {
  /** Запись класса без свёрнутых подклассов */
  classRecord: ClassDefinition;
  /** Записи-подклассы со ссылкой на {@link SplitClassRecords.classRecord} */
  subclassRecords: ClassDefinition[];
}

/**
 * Раскладывает класс со свёрнутыми подклассами на самостоятельные записи —
 * так, как их держит «Мастерская»: класс отдельно, каждый подкласс отдельно со
 * ссылкой на класс. Тогда подкласс правится и сохраняется своей записью, а не
 * внутри формы класса, — так же, как подвид у вида.
 *
 * Ресурсы подклассов уходят из общего списка класса в их записи: на листе они
 * вернутся к классу через {@link withSubclassRecords}.
 *
 * @param definition - класс компендиума
 * @param classKey - ключ записи класса
 * @param subclassKeyOf - ключ записи по ключу подкласса
 * @returns запись класса и записи его подклассов
 */
export function splitSubclassRecords(
  definition: ClassDefinition,
  classKey: string,
  subclassKeyOf: (subclassKey: string) => string,
): SplitClassRecords {
  const parent: ClassDefinition = {
    ...withUniqueSubclassKeys(definition),
    key: classKey,
  };

  const subclassRecords = parent.subclasses.map((subclass) =>
    toSubclassRecord(parent, subclass, subclassKeyOf(subclass.key)),
  );

  const classRecord: ClassDefinition = { ...parent, subclasses: [] };

  if (parent.counters) {
    classRecord.counters = parent.counters.filter(
      (counter) => !counter.subclassKey,
    );
  }

  return { classRecord, subclassRecords };
}

/**
 * Возвращает класс с приклеенными к нему записями-подклассами.
 *
 * Нужна и по одному классу, а не только целым списком: карточка класса
 * открывается по самой записи (панель предметов, браузер компендиума, ссылка из
 * описания) и списка классов не видит, — а показать подклассы мира обязана.
 *
 * Подкласс, чей ключ уже есть у родителя, не добавляется: запись компендиума
 * приоритетнее её копии в мире, как и при сборке самого списка классов.
 *
 * @param parent - класс, к которому клеим
 * @param records - все доступные записи классов (лишние отсеются по ключу)
 * @returns класс с подклассами; исходный объект, когда клеить нечего
 */
export function withSubclassRecords(
  parent: ClassDefinition,
  records: ReadonlyArray<ClassDefinition>,
): ClassDefinition {
  // Сначала — уникальные ключи своих подклассов: по ним же отсеиваются копии
  // из мира, и записи с одним ключом иначе слиплись бы в одну
  const base = withUniqueSubclassKeys(parent);
  const own = base.subclasses ?? [];
  const ownKeys = new Set(own.map((subclass) => subclass.key));

  const added = collectSubclassRecords(base.key, records)
    .filter((record) => !ownKeys.has(record.key))
    .map((record) => toSubclassDefinition(record, base.subclassLevel));

  return added.length > 0 ? { ...base, subclasses: [...own, ...added] } : base;
}

/** Первый порядковый суффикс, когда ключ не удалось развести источником. */
const FIRST_KEY_ORDINAL = 2;

/**
 * Уникальные ключи подклассов в порядке списка.
 *
 * Правило одно с выгрузкой (`VttgClassMapper.subclassKeys` в core-api), чтобы
 * ключ на листе персонажа пережил переустановку пака: ключ, встречающийся у
 * нескольких подклассов, у КАЖДОГО из них дополняется ключом источника
 * (`arcane-archer-uaau`); остающийся повтор (тот же источник дважды или
 * источника нет) получает порядковый номер. Подкласс с уникальным ключом не
 * переименовывается никогда.
 *
 * @param subclasses - подклассы записи
 * @returns ключи по индексам подклассов
 */
export function uniqueSubclassKeys(
  subclasses: ReadonlyArray<Pick<SubclassDefinition, 'key' | 'sourceKey'>>,
): string[] {
  const occurrences = new Map<string, number>();

  for (const subclass of subclasses) {
    occurrences.set(subclass.key, (occurrences.get(subclass.key) ?? 0) + 1);
  }

  const used = new Set<string>();

  return subclasses.map((subclass) => {
    const isShared = (occurrences.get(subclass.key) ?? 0) > 1;

    const bySource =
      isShared && subclass.sourceKey
        ? `${subclass.key}-${subclass.sourceKey}`
        : subclass.key;

    let candidate = bySource;

    for (let ordinal = FIRST_KEY_ORDINAL; used.has(candidate); ordinal += 1) {
      candidate = `${bySource}-${ordinal}`;
    }

    used.add(candidate);

    return candidate;
  });
}

/**
 * Переводит подкласс на новый ключ вместе со всем, что на него ссылается
 * внутри самого подкласса: умениями и собственными ресурсами.
 *
 * @param subclass - подкласс записи
 * @param key - новый ключ
 * @returns подкласс с новым ключом
 */
function renameSubclass(
  subclass: SubclassDefinition,
  key: string,
): SubclassDefinition {
  const renamed: SubclassDefinition = {
    ...subclass,
    key,
    features: subclass.features.map((feature) =>
      feature.subclassKey === subclass.key
        ? { ...feature, subclassKey: key }
        : feature,
    ),
  };

  if (subclass.counters) {
    renamed.counters = subclass.counters.map((counter) =>
      counter.subclassKey === subclass.key
        ? { ...counter, subclassKey: key }
        : counter,
    );
  }

  return renamed;
}

/**
 * Возвращает класс, у которого ключи подклассов уникальны
 * ({@link uniqueSubclassKeys}). Переименовывать нечего — исходный объект.
 *
 * Ресурс из общего списка класса, помеченный переименованным ключом, достаётся
 * каждому подклассу, носившему этот ключ: выгрузка не говорит, чьим из двух
 * изданий он был, а потерять ресурс обоих — хуже, чем выдать его обоим.
 *
 * @param parent - запись класса
 * @returns класс с уникальными ключами подклассов
 */
export function withUniqueSubclassKeys(
  parent: ClassDefinition,
): ClassDefinition {
  const own = parent.subclasses ?? [];
  const keys = uniqueSubclassKeys(own);

  if (keys.every((key, index) => key === own[index].key)) {
    return parent;
  }

  const renamedKeys = new Map<string, string[]>();

  const subclasses = own.map((subclass, index) => {
    const key = keys[index];

    if (key === subclass.key) {
      return subclass;
    }

    renamedKeys.set(subclass.key, [
      ...(renamedKeys.get(subclass.key) ?? []),
      key,
    ]);

    return renameSubclass(subclass, key);
  });

  const result: ClassDefinition = { ...parent, subclasses };

  if (parent.counters) {
    result.counters = parent.counters.flatMap(
      (counter): ClassCounterDefinition[] => {
        const targets = counter.subclassKey
          ? renamedKeys.get(counter.subclassKey)
          : undefined;

        return targets
          ? targets.map((key) => ({ ...counter, subclassKey: key }))
          : [counter];
      },
    );
  }

  return result;
}

/**
 * Сворачивает записи-подклассы внутрь их родителей и убирает их из списка.
 *
 * Записи без родителя среди набора остаются самостоятельными классами: пак с
 * родителем может быть не подключён, и молча терять такую запись нельзя.
 * Подкласс, чей ключ уже есть у родителя, не добавляется — запись компендиума
 * приоритетнее её копии в мире, как и при сборке самого списка классов.
 *
 * @param records - все доступные записи классов (компендиум + мир)
 * @returns классы со свёрнутыми подклассами
 */
export function mergeSubclassRecords(
  records: ReadonlyArray<ClassDefinition>,
): ClassDefinition[] {
  const subclassRecords = records.filter(isSubclassRecord);

  // Без записей-подклассов клеить нечего, но ключи своих подклассов всё равно
  // приводятся к уникальным — двойники приезжают из самого компендиума
  if (subclassRecords.length === 0) {
    return records.map(withUniqueSubclassKeys);
  }

  const parents = records.filter((record) => !isSubclassRecord(record));
  const parentKeys = new Set(parents.map((parent) => parent.key));

  const merged = parents.map((parent) =>
    withSubclassRecords(parent, subclassRecords),
  );

  const orphans = subclassRecords.filter(
    (record) => !parentKeys.has(record.parentClassKey),
  );

  return [...merged, ...orphans];
}
