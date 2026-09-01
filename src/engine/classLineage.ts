import type {
  ClassDefinition,
  ClassFeature,
  SubclassDefinition,
} from './classTypes.js';

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
  const own = parent.subclasses ?? [];
  const ownKeys = new Set(own.map((subclass) => subclass.key));

  const added = collectSubclassRecords(parent.key, records)
    .filter((record) => !ownKeys.has(record.key))
    .map((record) => toSubclassDefinition(record, parent.subclassLevel));

  return added.length > 0
    ? { ...parent, subclasses: [...own, ...added] }
    : parent;
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

  if (subclassRecords.length === 0) {
    return [...records];
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
