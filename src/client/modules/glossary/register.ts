/**
 * Под-модуль системы D&D 5e: ГЛОССАРИЙ.
 *
 * Регистрирует единственную карточку — справочный термин (`dataKind: 'glossary'`
 * в манифесте секции компендиума). Ни типов предметов, ни карточек чата у термина
 * нет: это текст, а не сущность листа персонажа, поэтому модуль такой короткий.
 *
 * Регистрация даёт две вещи разом: строки в браузере компендиума и разрешение
 * ссылок вида `.../glossary/<слаг>` из описаний — их в паках тысячи, и ядро
 * (`compendiumRefIndex`) открывает найденную запись через `openDetail` ЭТОЙ же
 * карточки, не зная ни глоссария, ни D&D.
 *
 * @module systems/dnd5e/modules/glossary
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import type { GlossaryEntry } from '../../composables/useEntityDetailModals';

import { useEntityDetailModals } from '../../composables/useEntityDetailModals';
import GlossaryListItem from '../../ui/compendium/GlossaryListItem.vue';

/**
 * Проверяет, что запись — термин глоссария.
 *
 * Хук `openDetail` принимает `unknown` (ядро не знает форм системных записей),
 * а запись приезжает с сервера, поэтому сужаем её проверкой, а не приведением
 * типа: `id` и `name` — единственное, без чего описание нечем открыть.
 *
 * @param entry - запись компендиума
 */
function isGlossaryEntry(entry: unknown): entry is GlossaryEntry {
  return (
    typeof entry === 'object'
    && entry !== null
    && 'id' in entry
    && typeof entry.id === 'string'
    && 'name' in entry
    && typeof entry.name === 'string'
  );
}

/** Регистрирует карточку термина глоссария D&D 5e (через SDK). */
export function register(api: ClientSystemAPI): void {
  api.entityCard({
    type: 'glossary',
    listItemComponent: GlossaryListItem,
    openDetail: (entry) => {
      if (isGlossaryEntry(entry)) {
        useEntityDetailModals().openGlossaryDetail(entry);
      }
    },
  });
}
