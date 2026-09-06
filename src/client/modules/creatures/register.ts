/**
 * Под-модуль системы D&D 5e: СУЩЕСТВА.
 *
 * Регистрирует карточку сущности существа. Один из «модулей внутри системы».
 *
 * @module systems/dnd5e/modules/creatures
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import type { CreatureEntry } from '../../composables/useEntityDetailModals';

import { useWorldStore } from '@/stores/worldStore';
import { getCompendiumMediaUrl, isRecord } from '@vtt/shared';

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

/**
 * Ссылка на картинку строки списка — через кэш своего мира.
 *
 * Картинки записей компендиума лежат на сайте, и до кэша их тянул из интернета
 * каждый клиент отдельно: список, пролистанный быстро, получал от сайта отказ
 * «слишком часто», и строки оставались пустыми. Мир скачивает картинку один раз
 * и дальше отдаёт с диска.
 *
 * Маршрут кэша появился в VTTG 0.9.473 — отсюда `compatibility.minimum` в
 * манифесте: на приложении постарше система просто не запустится.
 *
 * @param imageUrl - ссылка на картинку токена из записи компендиума
 * @returns ссылку для строки списка; `undefined`, если картинки у записи нет
 */
function resolveListImageUrl(imageUrl: string | undefined): string | undefined {
  const worldPort = useWorldStore().currentWorld?.port;

  return getCompendiumMediaUrl(imageUrl, worldPort) ?? undefined;
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

      // Картинка токена — вместо значка в строке списка: одинаковый «пришелец»
      // у всех существ ничего не различал, а морда различает сразу.
      const token = isRecord(entry.token) ? entry.token : undefined;

      const imageUrl =
        typeof token?.imageUrl === 'string' ? token.imageUrl : undefined;

      return {
        name: entry.name,
        nameEn: entry.nameEn,
        imageUrl: resolveListImageUrl(imageUrl),
        // Источник — бейджем справа в строке списка, как у остальных записей
        sourceKey: entry.sourceKey,
        source: entry.source,
        challengeRating:
          typeof challengeRating === 'number'
          || typeof challengeRating === 'string'
            ? challengeRating
            : undefined,
      };
    },
  });
}
