import type { SpeciesDefinition } from './speciesTypes.js';

import { matchesParentPack, WORLD_PACK_ID } from './consts.js';

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
 * Подходит ли запись-подвид родителю из пака `packId` (см.
 * {@link SpeciesDefinition.parentPackId}).
 *
 * @param record - запись-подвид
 * @param packId - пак родителя; пусто — не известен
 * @param knownPackIds - подключённые паки (см. `matchesParentPack`)
 * @returns `true`, если подвид относится к родителю этого пака
 */
export function subspeciesFitsPack(
  record: SpeciesDefinition,
  packId: string | undefined,
  knownPackIds?: ReadonlySet<string>,
): boolean {
  return matchesParentPack(record.parentPackId, packId, knownPackIds);
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

/** Записи видов одного компендиума (или мира — `WORLD_PACK_ID`). */
export interface SpeciesPackRecords {
  packId: string;
  entries: ReadonlyArray<SpeciesDefinition>;
}

/** Подвиды, разложенные по родителям. */
export interface SubspeciesGrouping {
  /** Подвиды вида по ключу {@link subspeciesGroupKey}, по алфавиту */
  children: ReadonlyMap<string, SpeciesDefinition[]>;
  /**
   * Подвиды, нашедшие родителя: в общем списке они не стоят, их показывают
   * под видом. Подвид без найденного родителя сюда не попадает и остаётся в
   * общем списке — иначе запись без родителя пропала бы совсем.
   */
  nested: ReadonlySet<SpeciesDefinition>;
}

/**
 * Ключ родителя в {@link SubspeciesGrouping.children}: пак вместе с ключом
 * вида — у одноимённого вида соседнего компендиума подвиды могут быть другими.
 *
 * @param packId - пак вида
 * @param speciesKey - ключ вида
 * @returns ключ группы
 */
export function subspeciesGroupKey(packId: string, speciesKey: string): string {
  return `${packId}::${speciesKey}`;
}

/**
 * Паки, в которых подвид находит родителя. Сначала свой пак: подвид
 * компендиума принадлежит виду того же компендиума. В других паках родителя
 * ищем, только когда это разрешают данные: у подвида записан пак родителя
 * (копия из другого компендиума) либо подвид заведён в мире — тогда, как и в
 * каталоге видов, годится родитель любого подходящего пака.
 *
 * @param record - запись-подвид
 * @param ownPackId - пак, в котором лежит подвид
 * @param parentsByPack - ключи видов-родителей (записей без `parentKey`) по пакам
 * @param knownPackIds - подключённые паки
 * @returns паки родителя; пусто — родитель не нашёлся
 */
function parentPacksOf(
  record: SpeciesDefinition,
  ownPackId: string,
  parentsByPack: ReadonlyMap<string, ReadonlySet<string>>,
  knownPackIds: ReadonlySet<string>,
): string[] {
  const parentKey = record.parentKey ?? '';
  const parentPackId = record.parentPackId ?? '';

  const hasParent = (packId: string): boolean =>
    parentsByPack.get(packId)?.has(parentKey) ?? false;

  const pointsElsewhere =
    parentPackId !== ''
    && parentPackId !== ownPackId
    && knownPackIds.has(parentPackId);

  if (!pointsElsewhere && hasParent(ownPackId)) {
    return [ownPackId];
  }

  if (parentPackId === '' && ownPackId !== WORLD_PACK_ID) {
    return [];
  }

  return [...parentsByPack.keys()].filter(
    (packId) =>
      packId !== ownPackId
      && hasParent(packId)
      && matchesParentPack(record.parentPackId, packId, knownPackIds),
  );
}

/**
 * Раскладывает записи-подвиды по их видам — для списков, где подвид стоит не
 * отдельной строкой, а под своим видом (компендиум, окно выбора вида).
 * Подвид узнаётся только по данным записи (`parentKey`, `parentPackId`), так
 * что свои виды и подвиды мастерской и компендиумов мира раскладываются так
 * же, как записи TTG Club.
 *
 * @param packs - записи видов по пакам
 * @returns подвиды по родителям и набор разложенных подвидов
 */
export function groupSubspeciesByParent(
  packs: ReadonlyArray<SpeciesPackRecords>,
): SubspeciesGrouping {
  const knownPackIds = new Set(packs.map((pack) => pack.packId));

  const parentsByPack = new Map<string, Set<string>>(
    packs.map((pack) => [
      pack.packId,
      new Set(
        pack.entries
          .filter((entry) => !isSubspeciesRecord(entry))
          .map((entry) => entry.key),
      ),
    ]),
  );

  const grouped = new Map<string, SpeciesDefinition[]>();
  const nested = new Set<SpeciesDefinition>();

  for (const pack of packs) {
    for (const record of pack.entries) {
      if (!isSubspeciesRecord(record)) {
        continue;
      }

      const parentKey = record.parentKey ?? '';

      for (const parentPackId of parentPacksOf(
        record,
        pack.packId,
        parentsByPack,
        knownPackIds,
      )) {
        const groupKey = subspeciesGroupKey(parentPackId, parentKey);

        grouped.set(groupKey, [...(grouped.get(groupKey) ?? []), record]);
        nested.add(record);
      }
    }
  }

  const children = new Map<string, SpeciesDefinition[]>();

  for (const [groupKey, records] of grouped) {
    children.set(
      groupKey,
      collectSubspecies(records[0]?.parentKey ?? '', records),
    );
  }

  return { children, nested };
}
