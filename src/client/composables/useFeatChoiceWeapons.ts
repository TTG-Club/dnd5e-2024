/**
 * Виды оружия мира как набор вариантов выбора при взятии черты.
 *
 * Выбор оружия и оружейного приёма («Оружейные приёмы» воина — три вида оружия) отличается
 * от навыков и языков тем, что его пул не описан справочником правил: виды оружия живут в
 * данных мира. Движок их не знает и без этого списка возвращал пустой пул — игрок видел
 * «подходящих вариантов нет» и упирался в неактивную кнопку «Далее».
 *
 * Список берётся из справочных данных системы (`systemDataStore`), которые приходят с
 * сервера один раз при подключении к миру, — поэтому composable ничего не грузит сам.
 * Собран он в одном месте, чтобы пул выбора и проверка «все ли ответы даны» смотрели на
 * ОДИН список: разойдись они, кнопка осталась бы недоступной при заполненном выборе.
 */

import type { FeatChoiceOption } from '@vtt/shared/system/dnd.js';

import { computed } from 'vue';

import { useSystemDataStore } from '../stores/systemDataStore';

/**
 * Виды оружия мира для пула выбора черты.
 *
 * @returns `weaponOptions` — варианты «ключ + название» в порядке справочника
 */
export function useFeatChoiceWeapons() {
  const systemDataStore = useSystemDataStore();

  const weaponOptions = computed<FeatChoiceOption[]>(() =>
    systemDataStore.weaponBaseTypes.map((baseType) => ({
      value: baseType.key,
      name: baseType.name,
    })),
  );

  return { weaponOptions };
}
