/**
 * Справочник родителей для форм подкласса и подвида: по ссылке «ключ + пак»
 * находит название родителя и компендиум, в котором он лежит.
 *
 * Один ключ родителя («bard») есть сразу в нескольких компендиумах (DEV и
 * ПРОД, свой пак), поэтому записи помнят пак родителя, а справочник ищет
 * сначала по паре и лишь затем — по одному ключу: так читаются записи,
 * сохранённые до появления пака. Запасной поиск по ключу срабатывает, только
 * когда ключ однозначен: у родителя из нескольких паков угадывать нельзя, и
 * поле тогда покажет сам ключ без компендиума.
 */

/** Название родителя и компендиум, в котором он лежит. */
export interface ParentRecordInfo {
  name: string;
  packName: string;
}

/**
 * Справочник родителей: по паре «пак + ключ» и запасной — по ключу. `null`
 * у запасного ключа — он встречается в нескольких паках и ничего не
 * однозначно не называет.
 */
export type ParentRecordIndex = Map<string, ParentRecordInfo | null>;

/**
 * Ключ справочника. Без пака — запасной ключ: единственная запись с таким
 * ключом.
 *
 * @param key - ключ родителя
 * @param packId - пак родителя
 * @returns ключ справочника
 */
function indexKey(key: string, packId?: string): string {
  return packId ? `${packId}::${key}` : key;
}

/**
 * Добавляет родителя в справочник. Ключ, уже встреченный в другом паке,
 * перестаёт быть однозначным.
 *
 * @param index - справочник
 * @param key - ключ родителя
 * @param packId - пак родителя
 * @param info - название и компендиум
 */
export function rememberParentRecord(
  index: ParentRecordIndex,
  key: string,
  packId: string,
  info: ParentRecordInfo,
): void {
  index.set(indexKey(key, packId), info);
  index.set(key, index.has(key) ? null : info);
}

/**
 * Находит родителя по ссылке: копия из названного пака, иначе единственная с
 * таким ключом.
 *
 * @param index - справочник
 * @param key - ключ родителя
 * @param packId - пак родителя; пусто — не известен
 * @returns название и компендиум либо `undefined`, если родитель не нашёлся
 */
export function findParentRecord(
  index: ParentRecordIndex,
  key: string,
  packId?: string,
): ParentRecordInfo | undefined {
  return index.get(indexKey(key, packId)) ?? index.get(key) ?? undefined;
}
