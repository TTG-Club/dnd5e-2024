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

import { ref, watch } from 'vue';

import { loadCompendiumKind } from '@/core/compendiumDataClient';

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
 * @param socket - WebSocket-клиент; без него каталог остаётся пустым
 * @param isNeeded - нужен ли каталог: есть ли выбор черты или выдаваемая черта
 * @returns `feats` — черты каталога (пустой список, пока не загружены)
 */
export function useFeatChoiceFeats(
  socket: Ref<TypedWebSocketClient | null | undefined>,
  isNeeded: Ref<boolean>,
) {
  const feats = ref<CompendiumFeat[]>([]);

  watch(
    [isNeeded, socket],
    async ([isRequired, socketClient]) => {
      if (!isRequired || !socketClient || feats.value.length > 0) {
        return;
      }

      const entries: unknown[] = await loadCompendiumKind(socketClient, 'feat');

      feats.value = entries.filter(isCompendiumFeat);
    },
    { immediate: true },
  );

  return { feats };
}
