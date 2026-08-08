/**
 * Помощники по страницам журнала.
 *
 * @module shared/utils/notePages
 */

import type { NotePage, NotePageInput } from '../types/base.js';

/**
 * Собирает черновик новой страницы журнала.
 *
 * `id === null` означает «страницы ещё нет в БД» — идентификатор ей выдаст
 * сервер при сохранении.
 *
 * @param title - название страницы
 * @param content - Markdown-содержимое
 * @returns черновик страницы для отправки на сервер
 */
export function createNotePageInput(
  title: string,
  content: string = '',
): NotePageInput {
  return {
    id: null,
    title,
    content,
    images: [],
    isHidden: false,
  };
}

/**
 * Приводит сохранённую страницу к форме отправки на сервер.
 *
 * @param page - страница из состояния журнала
 * @returns страница в форме сохранения
 */
export function toNotePageInput(page: NotePage): NotePageInput {
  return {
    id: page.id,
    title: page.title,
    content: page.content,
    images: [...page.images],
    isHidden: page.isHidden,
  };
}
