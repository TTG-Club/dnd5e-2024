/**
 * Правило, по которому ссылка одной записи компендиума на другую находит цель
 * среди всех паков мира.
 *
 * Запись пака ссылается на другую по ключу: черта выдаёт заклинание
 * `fireball-phb`, класс — черту, предыстория — снаряжение. Ключ не уникален
 * между паками: TTG Club и чужой компендиум могут оба держать `fireball-phb`
 * со своей механикой. Поэтому цель ищется так:
 *
 * 1. есть в своём паке (паке записи, которая ссылается) — берётся оттуда;
 * 2. своего нет, а среди остальных источников мира ключ есть ровно в одном —
 *    берётся оттуда без вопросов;
 * 3. есть в нескольких — пак выбирает тот, кому запись выдаётся (решает
 *    вызывающий: здесь только список кандидатов);
 * 4. нет нигде — не выдаётся.
 *
 * Записи самого мира (панель «Предметы», `WORLD_PACK_ID`) — такой же источник,
 * как пак компендиума.
 */

/** Пак с записями, среди которых ищется ссылка */
export interface RefSearchPack<TEntry> {
  packId: string;
  packName: string;
  entries: ReadonlyArray<TEntry>;
}

/** Копия записи в конкретном паке */
export interface RefCandidate<TEntry> {
  entry: TEntry;
  packId: string;
  packName: string;
}

/** Чем закончился поиск ссылки */
export type RefResolution<TEntry> =
  | { kind: 'found'; candidate: RefCandidate<TEntry> }
  | { kind: 'ambiguous'; candidates: RefCandidate<TEntry>[] }
  | { kind: 'missing' };

/**
 * Ищет запись по ключу среди паков по правилу «свой пак → единственный другой →
 * выбор → нет».
 *
 * Без своего пака (старый лист, запись из мира без пака, пак удалён из мира)
 * сразу идут шаги 2–4.
 *
 * @param packs - паки мира с записями нужного вида
 * @param key - ключ, по которому ссылаются
 * @param keyOf - чем запись адресуется внутри пака (`id` у заклинаний и черт, `key` у классов)
 * @param ownPackId - пак записи, которая ссылается
 * @returns найденная копия, список кандидатов для выбора или «нет нигде»
 */
export function classifyRefInPacks<TEntry>(
  packs: ReadonlyArray<RefSearchPack<TEntry>>,
  key: string,
  keyOf: (entry: TEntry) => string | undefined,
  ownPackId?: string,
): RefResolution<TEntry> {
  const candidates: RefCandidate<TEntry>[] = [];

  for (const pack of packs) {
    const entry = pack.entries.find((packEntry) => keyOf(packEntry) === key);

    if (entry === undefined) {
      continue;
    }

    const candidate = { entry, packId: pack.packId, packName: pack.packName };

    if (ownPackId !== undefined && pack.packId === ownPackId) {
      return { kind: 'found', candidate };
    }

    candidates.push(candidate);
  }

  const [single] = candidates;

  if (candidates.length === 1 && single) {
    return { kind: 'found', candidate: single };
  }

  return candidates.length === 0
    ? { kind: 'missing' }
    : { kind: 'ambiguous', candidates };
}
