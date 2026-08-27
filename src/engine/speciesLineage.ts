import type { SpeciesDefinition } from './speciesTypes.js';

/**
 * Подвиды (происхождения) вида в новой модели: подвид — самостоятельная запись
 * вида со ссылкой `parentKey` на родителя, как на сайте TTG Club.
 *
 * Легаси-формат со встроенными вариантами (`SpeciesFeature.choices`) продолжает
 * читаться мастером и просмотром (дуал-рид); эти хелперы обслуживают только
 * записи-подвиды.
 */

/**
 * Является ли запись подвидом (происхождением) другого вида.
 *
 * @param definition - запись вида
 * @returns `true`, когда запись ссылается на родителя
 */
export function isSubspeciesRecord(definition: SpeciesDefinition): boolean {
  return Boolean(definition.parentKey);
}

/**
 * Собирает записи-подвиды указанного вида из набора записей (мир + компендиум),
 * отсортированные по названию.
 *
 * @param parentKey - ключ родительского вида
 * @param records - все доступные записи видов
 * @returns подвиды указанного вида
 */
export function collectSubspecies(
  parentKey: string,
  records: ReadonlyArray<SpeciesDefinition>,
): SpeciesDefinition[] {
  return records
    .filter((record) => record.parentKey === parentKey)
    .sort((first, second) =>
      first.name.localeCompare(second.name, 'ru', { sensitivity: 'base' }),
    );
}

/**
 * Находит запись-подвид по ключу среди набора записей.
 *
 * @param records - все доступные записи видов
 * @param subspeciesKey - ключ искомого подвида
 * @returns запись подвида либо `null`
 */
export function findSubspecies(
  records: ReadonlyArray<SpeciesDefinition>,
  subspeciesKey: string,
): SpeciesDefinition | null {
  return (
    records.find(
      (record) => record.key === subspeciesKey && isSubspeciesRecord(record),
    ) ?? null
  );
}

/**
 * Есть ли у вида легаси-варианты, встроенные в особенности. По ним мастер
 * по-прежнему спрашивает выбор старым способом — записи из старых паков и
 * хоумбрю-миров не должны терять подвиды.
 *
 * @param definition - запись вида
 * @returns `true`, когда хотя бы одна особенность несёт варианты
 */
export function hasLegacySubspeciesChoices(
  definition: SpeciesDefinition,
): boolean {
  return definition.features.some(
    (feature) => (feature.choices?.length ?? 0) > 0,
  );
}
