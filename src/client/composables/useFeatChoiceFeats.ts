/**
 * Каталог черт компендиума для выбора черты в дарах.
 *
 * Выбор вида `feat` («Универсальность» человека просит черту происхождения, воин — боевой
 * стиль) отличается от остальных выборов тем, что его пул не описан справочником правил:
 * черты живут в компендиуме и грузятся с сервера. Без каталога пул пуст, и мастер
 * упирается в подпись «подходящих вариантов нет» при живой кнопке «Далее».
 *
 * Загрузка вынесена сюда, чтобы пикер и проверка «все ли ответы даны» смотрели на ОДИН
 * каталог: разойдись они, кнопка осталась бы недоступной при сделанном выборе. Грузится
 * каталог один раз и только когда понадобился — что считать «понадобился», решает
 * вызывающий: мастеру класса и форме предыстории хватает открытого окна, мастер вида
 * ждёт дара, которому черта нужна.
 */

import type { Ref } from 'vue';

import type { TypedWebSocketClient } from '@vtt/shared';

import type { CompendiumFeat } from '../ui/actor/feat/featApply';
import type { CatalogPack } from './useCompendiumCatalog';

import { computed, ref, shallowRef, watch } from 'vue';

import { loadCompendiumKindByPack } from '@/core/compendiumDataClient';
import { classifyRefInPacks } from '@vtt/shared/system/dnd.js';

import { flattenPreferringBy } from './useCompendiumCatalog';
import {
  chooseCandidate,
  describeCandidate,
  reportMissingRecords,
} from './usePackChoicePrompt';

/**
 * Черты, которые запись выдаёт без выбора, — ссылки по ключу. Чья копия
 * выдаётся, решает правило «свой пак → единственный другой → выбор игрока».
 */
export interface GrantedFeatRefs {
  /** Персонаж, которому выдаются черты: его лист покажет вопрос */
  actorId: Ref<string>;
  /** Ключи выдаваемых черт */
  featIds: Ref<string[]>;
  /** Что их выдаёт — подпись окна и уведомления */
  grantedBy: Ref<string>;
}

/**
 * Запись компендиума — черта. Требования `source` нет: у записей компендиума есть только
 * `sourceKey`, и проверка `source` отсеяла бы все черты.
 *
 * @param value - запись компендиума
 */
function isCompendiumFeat(value: unknown): value is CompendiumFeat {
  return (
    typeof value === 'object'
    && value !== null
    && 'id' in value
    && 'name' in value
    && 'description' in value
  );
}

/**
 * Загружает черты компендиума, если они нужны дарам.
 *
 * Каталог держится по пакам, а наружу отдаётся без повторов: копия черты из
 * пака записи, которая спрашивает, побеждает одноимённую из соседнего.
 *
 * @param socket - WebSocket-клиент; без него каталог остаётся пустым
 * @param isNeeded - нужен ли каталог: есть ли выбор черты или выдаваемая черта
 * @param preferredPackId - пак записи, которая спрашивает; пусто — порядок паков хоста
 * @returns `feats` — черты каталога (пустой список, пока не загружены)
 */
export function useFeatChoiceFeats(
  socket: Ref<TypedWebSocketClient | null | undefined>,
  isNeeded: Ref<boolean>,
  preferredPackId?: Ref<string | undefined>,
  grantedFeatRefs?: GrantedFeatRefs,
) {
  /** Черты компендиума по пакам — как приехали */
  const featPacks = ref<CatalogPack<CompendiumFeat>[]>([]);

  /**
   * Копии выдаваемых черт, выбранные игроком: черта лежит в нескольких чужих
   * компендиумах. Подменяют в каталоге копию, которую дал бы порядок паков.
   */
  const chosenCopies = shallowRef(new Map<string, CompendiumFeat>());

  /** Ключи, по которым уже спросили или сообщили, — в этом окне мастера */
  const settledIds = new Set<string>();

  const feats = computed<CompendiumFeat[]>(() => {
    const flat = flattenPreferringBy(
      featPacks.value,
      preferredPackId?.value,
      (feat) => feat.id,
    );

    if (chosenCopies.value.size === 0) {
      return flat;
    }

    return flat.map((feat) => chosenCopies.value.get(feat.id) ?? feat);
  });

  /**
   * Разбирает выдаваемые черты: однозначные остаются в каталоге как есть,
   * неоднозначные спрашиваются по одной, ненайденные попадают в уведомление.
   *
   * @param refs - что выдаётся и кому
   * @param featIds - ключи выдаваемых черт
   */
  async function settleGrantedFeats(
    refs: GrantedFeatRefs,
    featIds: string[],
  ): Promise<void> {
    const missing: string[] = [];

    for (const featId of featIds) {
      if (settledIds.has(featId)) {
        continue;
      }

      settledIds.add(featId);

      const resolution = classifyRefInPacks(
        featPacks.value,
        featId,
        (feat) => feat.id,
        preferredPackId?.value,
      );

      if (resolution.kind === 'missing') {
        missing.push(featId);

        continue;
      }

      if (resolution.kind === 'found') {
        continue;
      }

      // Вопросы идут по одному: следующий ждёт ответа на предыдущий
      const chosen = await chooseCandidate(
        refs.actorId.value,
        resolution.candidates,
        refs.grantedBy.value,
        describeCandidate,
      );

      if (chosen) {
        chosenCopies.value = new Map(chosenCopies.value).set(
          featId,
          chosen.entry,
        );
      }
    }

    reportMissingRecords(
      missing.map((key) => ({ grantedBy: refs.grantedBy.value, key })),
    );
  }

  // Выбор не запоминается: закрытый мастер или запись из другого пака спросят
  // заново
  watch([isNeeded, () => preferredPackId?.value], () => {
    settledIds.clear();
    chosenCopies.value = new Map();
  });

  if (grantedFeatRefs) {
    watch(
      // Наблюдатель сброса объявлен выше — при повторном открытии он успевает
      // очистить прошлые ответы до этого прохода
      [grantedFeatRefs.featIds, featPacks, isNeeded],
      ([featIds, packs, isRequired]) => {
        if (isRequired && packs.length > 0 && featIds.length > 0) {
          void settleGrantedFeats(grantedFeatRefs, featIds);
        }
      },
      { immediate: true },
    );
  }

  watch(
    [isNeeded, socket],
    async ([isRequired, socketClient]) => {
      if (!isRequired || !socketClient || featPacks.value.length > 0) {
        return;
      }

      const packs = await loadCompendiumKindByPack(socketClient, 'feat');

      featPacks.value = packs.map((pack) => {
        // Расширяем до unknown[]: черта не подтип CompendiumEntry, и гвард иначе
        // не сузит при filter
        const rawEntries: unknown[] = pack.entries;

        return {
          packId: pack.packId,
          packName: pack.packName,
          entries: rawEntries.filter(isCompendiumFeat),
        };
      });
    },
    { immediate: true },
  );

  return { feats };
}
