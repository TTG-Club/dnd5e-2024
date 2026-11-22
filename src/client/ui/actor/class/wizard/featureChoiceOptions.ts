import type { ClassFeatureChoice } from '@vtt/shared/system/dnd.js';

import type { ChoicePickerOption } from '../../ChoicePickerModal.vue';

/**
 * Вариант умения строкой окна выбора: описание открывается в нём отдельным
 * окном. Один разбор на выбор новых вариантов и на замену взятого — строки
 * одного и того же списка не должны выглядеть в двух местах по-разному.
 *
 * @param choice - вариант умения из записи класса
 * @returns строка окна выбора
 */
export function toFeatureChoicePickerOption(
  choice: ClassFeatureChoice,
): ChoicePickerOption {
  return {
    value: choice.key,
    name: choice.name,
    nameEn: choice.nameEn,
    additional: choice.additional,
    prerequisite: choice.prerequisite,
    description: choice.description,
    repeatable: choice.repeatable,
  };
}
