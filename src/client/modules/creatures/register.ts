/**
 * Под-модуль системы D&D 5e: СУЩЕСТВА.
 *
 * Регистрирует карточку сущности существа. Один из «модулей внутри системы».
 *
 * @module systems/dnd5e/modules/creatures
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import type { CreatureEntry } from '../../composables/useEntityDetailModals';

import { isRecord } from '@vtt/shared';

import { useEntityDetailModals } from '../../composables/useEntityDetailModals';
import CreatureListItem from '../../ui/creature/CreatureListItem.vue';

/**
 * Проверяет, что запись — существо, которое можно открыть листом.
 * Идентификатор обязателен: по нему лист находит существо в мире.
 *
 * @param entry - запись предмета или компендиума
 * @returns `true`, если у записи есть строковый `id`
 */
function isCreatureEntry(entry: unknown): entry is CreatureEntry {
  return isRecord(entry) && typeof entry.id === 'string';
}

/** Регистрирует существ D&D 5e: карточка сущности (через SDK). */
export function register(api: ClientSystemAPI): void {
  api.entityCard({
    type: 'creature',
    listItemComponent: CreatureListItem,
    // Лист существа открывается в режиме просмотра — ядро вызывает этот хук и
    // из браузера компендиума, и при переходе по ссылке из описания.
    openDetail: (entry) => {
      if (isCreatureEntry(entry)) {
        useEntityDetailModals().openCreatureDetail(entry);
      }
    },
    propsFor: (entry) => {
      // Система знает форму своей записи: ПО существа — в `system.challengeRating`
      // (ядровой `EntityCardEntry` держит поле как непрозрачное `[key]: unknown`).
      const system = isRecord(entry.system) ? entry.system : undefined;
      const challengeRating = system?.challengeRating;

      return {
        name: entry.name,
        nameEn: entry.nameEn,
        header: entry.header,
        challengeRating:
          typeof challengeRating === 'number'
          || typeof challengeRating === 'string'
            ? challengeRating
            : undefined,
      };
    },
  });
}
