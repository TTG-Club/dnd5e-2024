/**
 * Под-модуль системы D&D 5e: ЗАСАДА.
 *
 * Регистрирует полку действий системы слева от панели быстрого доступа:
 * «Атака» и «Прыжок» (пока недоступны), «Спрятаться» и «Поиск». «Спрятаться»
 * в засаде горит, и нажатие на неё выводит из засады. «Поиск» ищет за
 * выделенную фишку — так ищет и игрок, и ведущий за врага. Кнопок под
 * сообщением о засаде нет: всё делается с полки. Полку ядро даёт с VTTG
 * 0.9.725; на старом приложении её нет — модуль её не регистрирует и не
 * падает.
 *
 * @module systems/dnd5e/modules/stealth
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { ActionShelfButton } from '../../composables/actionShelf';

import { findHiddenEffect } from '@vtt/shared/system/dnd.js';

import { registerActionShelf } from '../../composables/actionShelf';
import {
  leaveHide,
  startHide,
  startSearch,
} from '../../composables/hideAction';
import { useWorldEntities } from '../../composables/useWorldEntities';
import { ACTION_SHELF_BUTTONS, HIDE_ICON } from '../../ui/stealth/hideLabels';

/**
 * Зовёт действие полки за сущность, какой она стала к нажатию: полка могла
 * быть нарисована раньше последней правки.
 *
 * @param entityId - выделенная сущность
 * @param action - действие
 */
function runWithLiveEntity(
  entityId: string,
  action: (entity: DnDSceneEntity) => boolean,
): void {
  const entity = useWorldEntities().findCurrentDndEntity(entityId);

  if (entity) {
    action(entity);
  }
}

/**
 * Кнопки полки, пока не выбран свой герой: тот же набор и порядок, что у
 * героя, но все погашены — полка не исчезает и не прыгает при выделении.
 *
 * @returns погашенные кнопки полки
 */
function buildIdleShelfButtons(): ActionShelfButton[] {
  return [
    {
      id: ACTION_SHELF_BUTTONS.attackId,
      icon: ACTION_SHELF_BUTTONS.attackIcon,
      label: ACTION_SHELF_BUTTONS.attack,
      disabled: true,
      disabledReason: ACTION_SHELF_BUTTONS.inDevelopment,
    },
    {
      id: ACTION_SHELF_BUTTONS.jumpId,
      icon: ACTION_SHELF_BUTTONS.jumpIcon,
      label: ACTION_SHELF_BUTTONS.jump,
      disabled: true,
      disabledReason: ACTION_SHELF_BUTTONS.inDevelopment,
    },
    {
      id: ACTION_SHELF_BUTTONS.hideId,
      icon: HIDE_ICON,
      label: ACTION_SHELF_BUTTONS.hide,
      tooltip: ACTION_SHELF_BUTTONS.hideTooltip,
      disabled: true,
      disabledReason: ACTION_SHELF_BUTTONS.noHero,
    },
    {
      id: ACTION_SHELF_BUTTONS.searchId,
      icon: ACTION_SHELF_BUTTONS.searchIcon,
      label: ACTION_SHELF_BUTTONS.search,
      tooltip: ACTION_SHELF_BUTTONS.searchTooltip,
      disabled: true,
      disabledReason: ACTION_SHELF_BUTTONS.noHero,
    },
  ];
}

/**
 * Регистрирует засаду: полку действий.
 *
 * @param api - API ядра для системы
 */
export function register(api: ClientSystemAPI): void {
  registerActionShelf(api, {
    list: (context) => {
      const entity = useWorldEntities().findCurrentDndEntity(context.entityId);

      // Полка видна всегда: без своего героя — те же кнопки, но погашены
      if (!entity) {
        return buildIdleShelfButtons();
      }

      const hidden = findHiddenEffect(entity) !== undefined;

      return [
        {
          id: ACTION_SHELF_BUTTONS.attackId,
          icon: ACTION_SHELF_BUTTONS.attackIcon,
          label: ACTION_SHELF_BUTTONS.attack,
          disabled: true,
          disabledReason: ACTION_SHELF_BUTTONS.inDevelopment,
        },
        {
          id: ACTION_SHELF_BUTTONS.jumpId,
          icon: ACTION_SHELF_BUTTONS.jumpIcon,
          label: ACTION_SHELF_BUTTONS.jump,
          disabled: true,
          disabledReason: ACTION_SHELF_BUTTONS.inDevelopment,
        },
        {
          id: ACTION_SHELF_BUTTONS.hideId,
          icon: HIDE_ICON,
          label: ACTION_SHELF_BUTTONS.hide,
          tooltip: hidden
            ? ACTION_SHELF_BUTTONS.hideActiveTooltip
            : ACTION_SHELF_BUTTONS.hideTooltip,
          active: hidden,
          // Горящая кнопка снимает засаду, а не бросает заново
          onClick: () =>
            runWithLiveEntity(entity.id, hidden ? leaveHide : startHide),
        },
        {
          id: ACTION_SHELF_BUTTONS.searchId,
          icon: ACTION_SHELF_BUTTONS.searchIcon,
          label: ACTION_SHELF_BUTTONS.search,
          tooltip: ACTION_SHELF_BUTTONS.searchTooltip,
          onClick: () => runWithLiveEntity(entity.id, startSearch),
        },
      ];
    },
  });
}
