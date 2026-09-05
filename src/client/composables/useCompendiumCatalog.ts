/**
 * Каталог записей одного вида по пакам — единственная точка, где запись ищут по
 * ссылке «пак + ключ».
 *
 * В мире стоит сколько угодно компендиумов с одинаковыми ключами записей: DEV и
 * ПРОД TTG Club, паки других людей, предметы самого мира. Хост на запрос «все
 * записи вида» (`loadCompendiumKind`) склеивает паки и при совпадении ключа
 * оставляет первый попавшийся — так DEV-копия класса заслоняла ПРОД везде, куда
 * лист ходил по одному ключу. Здесь паки не склеиваются: каталог держит их
 * порознь (`loadCompendiumKindByPack`) и отдаёт ту копию, которую назвали.
 *
 * Ключ без пака — запасной путь: записи, сохранённые до появления `packId`, и
 * персонаж, перенесённый туда, где такого пака нет. Для них порядок тот же, что
 * был у склейки хоста: паки в порядке хоста, записи мира последними, — чтобы
 * старые листы вели себя ровно как раньше.
 */

import type { Ref } from 'vue';

import type { TypedWebSocketClient } from '@vtt/shared';
import type { CompendiumRecordRef } from '@vtt/shared/system/dnd.js';

import { computed, ref } from 'vue';

import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
import { WORLD_PACK_ID } from '@vtt/shared/system/dnd.js';

/** Записи одного компендиума */
export interface CatalogPack<TEntry> {
  packId: string;
  packName: string;
  entries: TEntry[];
}

/** Что нужно каталогу, чтобы собрать записи вида */
export interface CompendiumCatalogOptions<TEntry> {
  /** Сокет мира; null — компендиум недоступен, остаются записи мира */
  socket: Ref<TypedWebSocketClient | null>;
  /** Канонический тип записей узла компендиума (`class`, `species`, …) */
  kind: string;
  /** Опознаёт запись вида среди сырых записей пака */
  isEntry: (value: unknown) => value is TEntry;
  /**
   * Записи, созданные в самом мире — они станут последним паком
   * {@link WORLD_PACK_ID}. Функция, а не список: предметы мира приходят и
   * меняются асинхронно, и каталог перечитывает их на каждое обращение.
   */
  worldEntries?: () => TEntry[];
  /** Подпись пака мира в окнах выбора */
  worldPackName?: string;
}

/** Запись каталога: ключ — общий минимум, по нему запись и адресуется */
interface KeyedEntry {
  key: string;
}

/** Найденная запись вместе с паком, в котором она лежит */
export interface ResolvedRecord<TEntry> {
  entry: TEntry;
  packId: string;
}

/**
 * Каталог записей одного вида по пакам.
 *
 * @param options - откуда и что собирать
 */
export function useCompendiumCatalog<TEntry extends KeyedEntry>(
  options: CompendiumCatalogOptions<TEntry>,
) {
  /** Паки компендиума в порядке хоста */
  const compendiumPacks: Ref<CatalogPack<TEntry>[]> = ref([]);

  /** Компендиум уже запрошен: повторные `load` ничего не делают */
  const isLoaded = ref(false);

  /** Висящая загрузка — параллельные вызовы ждут одну и ту же */
  let pending: Promise<void> | null = null;

  /**
   * Загружает записи компендиума по пакам. Хост кеширует ответ по виду, поэтому
   * повторные каталоги того же вида сети не трогают.
   */
  function load(): Promise<void> {
    if (isLoaded.value) {
      return Promise.resolve();
    }

    if (pending) {
      return pending;
    }

    const socket = options.socket.value;

    if (!socket) {
      return Promise.resolve();
    }

    pending = loadCompendiumKindByPack(socket, options.kind)
      .then((loaded) => {
        compendiumPacks.value = loaded.flatMap((pack) => {
          // Расширяем до unknown[]: определения не подтипы CompendiumEntry, и
          // сужающий предикат иначе отвергается как несовместимый (TS2677)
          const rawEntries: unknown[] = pack.entries;
          const entries = rawEntries.filter(options.isEntry);

          return entries.length > 0
            ? [{ packId: pack.packId, packName: pack.packName, entries }]
            : [];
        });

        isLoaded.value = true;
      })
      .finally(() => {
        pending = null;
      });

    return pending;
  }

  /** Все паки: компендиум в порядке хоста, записи мира последним паком */
  const packs = computed<CatalogPack<TEntry>[]>(() => {
    const world = options.worldEntries?.() ?? [];

    if (world.length === 0) {
      return compendiumPacks.value;
    }

    return [
      ...compendiumPacks.value,
      {
        packId: WORLD_PACK_ID,
        packName: options.worldPackName ?? WORLD_PACK_ID,
        entries: world,
      },
    ];
  });

  /**
   * Запись по ссылке: копия из названного пака, иначе первая по ключу в
   * порядке паков.
   *
   * Откат по ключу сохраняет старые листы и переносимость: у другого мастера
   * названного пака может не быть, а запись с тем же ключом — быть.
   *
   * @param recordRef - ключ записи и пак, из которого её взяли
   */
  function resolve(recordRef: CompendiumRecordRef): TEntry | undefined {
    return resolveWithPack(recordRef)?.entry;
  }

  /**
   * Запись по ссылке вместе с паком, в котором она нашлась: у ссылки без пака
   * (перенос из браузера компендиума, старый лист) пак становится известен
   * здесь — и дальше запись адресуется уже полной парой.
   *
   * @param recordRef - ключ записи и пак, из которого её взяли
   */
  function resolveWithPack(
    recordRef: CompendiumRecordRef,
  ): ResolvedRecord<TEntry> | undefined {
    return resolveIn(packs.value, recordRef);
  }

  /**
   * Записи вида одним списком без повторов ключа. При повторе побеждает копия
   * предпочтённого пака, иначе первая по порядку паков — так пул выбора для
   * класса из ПРОД-компендиума собирается из его же заклинаний, а не из
   * одноимённых DEV-копий.
   *
   * @param preferredPackId - пак записи, которая спрашивает
   */
  function flatPreferring(preferredPackId?: string): TEntry[] {
    return flattenPreferring(packs.value, preferredPackId);
  }

  return {
    packs,
    compendiumPacks,
    isLoaded,
    load,
    resolve,
    resolveWithPack,
    flatPreferring,
  };
}

/**
 * Запись по ссылке среди паков: сперва названный пак, потом любой по ключу.
 *
 * @param packs - паки с записями
 * @param recordRef - ключ записи и предпочтённый пак
 */
export function resolveIn<TEntry extends KeyedEntry>(
  packs: ReadonlyArray<CatalogPack<TEntry>>,
  recordRef: CompendiumRecordRef,
): ResolvedRecord<TEntry> | undefined {
  if (recordRef.packId) {
    const preferred = packs.find((pack) => pack.packId === recordRef.packId);
    const own = preferred?.entries.find((entry) => entry.key === recordRef.key);

    if (own && preferred) {
      return { entry: own, packId: preferred.packId };
    }
  }

  for (const pack of packs) {
    const found = pack.entries.find((entry) => entry.key === recordRef.key);

    if (found) {
      return { entry: found, packId: pack.packId };
    }
  }

  return undefined;
}

/**
 * Плоский список без повторов ключа: копия предпочтённого пака побеждает,
 * иначе первая по порядку паков.
 *
 * @param packs - паки с записями
 * @param preferredPackId - пак, чьи копии берутся при повторе ключа
 */
export function flattenPreferring<TEntry extends KeyedEntry>(
  packs: ReadonlyArray<CatalogPack<TEntry>>,
  preferredPackId?: string,
): TEntry[] {
  return flattenPreferringBy(packs, preferredPackId, (entry) => entry.key);
}

/**
 * Паки в порядке обхода: предпочтённый первым, остальные как были.
 *
 * @param packs - паки с записями
 * @param preferredPackId - пак, который идёт первым; пусто или нет такого — порядок как есть
 */
export function orderPacksPreferring<TEntry>(
  packs: ReadonlyArray<CatalogPack<TEntry>>,
  preferredPackId?: string,
): ReadonlyArray<CatalogPack<TEntry>> {
  const preferred = preferredPackId
    ? packs.find((pack) => pack.packId === preferredPackId)
    : undefined;

  return preferred
    ? [preferred, ...packs.filter((pack) => pack !== preferred)]
    : packs;
}

/**
 * То же схлопывание, но ключ записи называет вызывающий: у заклинаний и черт
 * это `id`, у классов и видов — `key`.
 *
 * @param packs - паки с записями
 * @param preferredPackId - пак, чьи копии берутся при повторе ключа
 * @param keyOf - чем запись адресуется внутри пака
 */
export function flattenPreferringBy<TEntry>(
  packs: ReadonlyArray<CatalogPack<TEntry>>,
  preferredPackId: string | undefined,
  keyOf: (entry: TEntry) => string,
): TEntry[] {
  const seen = new Set<string>();
  const result: TEntry[] = [];

  for (const pack of orderPacksPreferring(packs, preferredPackId)) {
    for (const entry of pack.entries) {
      const key = keyOf(entry);

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(entry);
    }
  }

  return result;
}
