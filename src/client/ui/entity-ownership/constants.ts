import type { Toast } from '@nuxt/ui/composables';

import { TOKEN_SETTINGS_LABELS } from '../actor/constants';

/** Подписи назначения управления актёром или существом. */
export const ENTITY_OWNERSHIP_LABELS = {
  label: 'Управляют',
  none: 'Только ГМ',
  unknown: 'Неизвестный пользователь',
  search: 'Найти пользователя…',
  empty: 'Пользователи не найдены',
  more: 'ещё',
  gm: 'ГМ',
  player: 'Игрок',
  hint: 'Выберите одного или нескольких. ГМ всегда сохраняет управление.',
  conflict:
    'Управление изменилось в другом окне. Список обновлён — проверьте его и сохраните снова.',
};

/** Настройки поля поиска в списке управляющих. */
export const ENTITY_OWNERSHIP_SEARCH_INPUT = {
  placeholder: ENTITY_OWNERSHIP_LABELS.search,
};

/** Иконки поля управления. */
export const ENTITY_OWNERSHIP_ICONS = {
  users: 'tabler:users',
  selected: 'tabler:check',
};

/** Общая подсказка при конкурентном изменении управления. */
export const ENTITY_OWNERSHIP_CONFLICT_TOAST: Partial<Toast> = {
  title: TOKEN_SETTINGS_LABELS.errorSave,
  description: ENTITY_OWNERSHIP_LABELS.conflict,
  color: 'warning',
};
