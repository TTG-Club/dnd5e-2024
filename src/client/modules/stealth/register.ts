/**
 * Под-модуль системы D&D 5e: ЗАСАДА.
 *
 * Регистрирует кнопки под сообщением об удачной засаде — «Найти» и «Шум» — и
 * полку действий системы слева от панели быстрого доступа: «Атака» и «Прыжок»
 * (пока недоступны) и «Спрятаться».
 *
 * Кнопки под сообщением ядро показывает автору сообщения и ведущему: враги
 * ищут спрятавшегося персонажа руками ведущего. Полку ядро даёт с VTTG
 * 0.9.725; на старом приложении её нет — модуль её не регистрирует и не
 * падает.
 *
 * @module systems/dnd5e/modules/stealth
 */

import type { ChatFollowUpActionContext } from '@/core/registries';
import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { ChatMessageFollowUp } from '@vtt/shared';

import {
  findHiddenEffect,
  HIDE_FOLLOW_UP_KIND,
  parseHideFollowUp,
} from '@vtt/shared/system/dnd.js';

import { registerActionShelf } from '../../composables/actionShelf';
import {
  endHideByNoise,
  findLiveHide,
  searchFromChat,
  startHide,
} from '../../composables/hideAction';
import { useWorldEntities } from '../../composables/useWorldEntities';
import {
  ACTION_SHELF_BUTTONS,
  HIDE_FOLLOW_UP_ACTIONS,
  HIDE_ICON,
} from '../../ui/stealth/hideLabels';

/** Раскладка кнопок под сообщением о засаде: в один ряд */
const HIDE_ACTIONS_LAYOUT = 'row';

/**
 * Кнопки под сообщением о засаде прячутся, когда засады уже нет: нашли, шум,
 * своя атака или заклинание.
 *
 * @param followUp - дополнение сообщения
 * @returns вид кнопки
 */
function resolveHideActionView(
  followUp: ChatMessageFollowUp,
): { hidden: true } | null {
  const payload = parseHideFollowUp(followUp.payload);

  return payload && findLiveHide(payload) ? null : { hidden: true };
}

/**
 * Обработчик кнопки под сообщением: читает данные засады и зовёт действие.
 *
 * @param action - что сделать с засадой
 * @returns обработчик нажатия
 */
function withHidePayload(
  action: typeof searchFromChat,
): (context: ChatFollowUpActionContext) => void {
  return (context) => {
    const payload = parseHideFollowUp(context.followUp.payload);

    if (payload) {
      action(payload);
    }
  };
}

/**
 * Регистрирует засаду: кнопки под сообщением и полку действий.
 *
 * @param api - API ядра для системы
 */
export function register(api: ClientSystemAPI): void {
  if ('chatFollowUpActions' in api) {
    api.chatFollowUpActions({
      kind: HIDE_FOLLOW_UP_KIND,
      layout: HIDE_ACTIONS_LAYOUT,
      actions: [
        {
          id: HIDE_FOLLOW_UP_ACTIONS.searchId,
          label: HIDE_FOLLOW_UP_ACTIONS.search,
          icon: HIDE_FOLLOW_UP_ACTIONS.searchIcon,
          tooltip: HIDE_FOLLOW_UP_ACTIONS.searchTooltip,
          view: resolveHideActionView,
          run: withHidePayload(searchFromChat),
        },
        {
          id: HIDE_FOLLOW_UP_ACTIONS.noiseId,
          label: HIDE_FOLLOW_UP_ACTIONS.noise,
          icon: HIDE_FOLLOW_UP_ACTIONS.noiseIcon,
          tooltip: HIDE_FOLLOW_UP_ACTIONS.noiseTooltip,
          view: resolveHideActionView,
          run: withHidePayload(endHideByNoise),
        },
      ],
    });
  }

  registerActionShelf(api, {
    list: (context) => {
      const entity = useWorldEntities().findCurrentDndEntity(context.entityId);

      if (!entity) {
        return [];
      }

      const hidden = findHiddenEffect(entity) !== undefined;

      return [
        {
          id: ACTION_SHELF_BUTTONS.attackId,
          icon: ACTION_SHELF_BUTTONS.attackIcon,
          label: ACTION_SHELF_BUTTONS.attack,
          disabled: true,
          disabledReason: ACTION_SHELF_BUTTONS.inDevelopment,
          onClick: () => {},
        },
        {
          id: ACTION_SHELF_BUTTONS.jumpId,
          icon: ACTION_SHELF_BUTTONS.jumpIcon,
          label: ACTION_SHELF_BUTTONS.jump,
          disabled: true,
          disabledReason: ACTION_SHELF_BUTTONS.inDevelopment,
          onClick: () => {},
        },
        {
          id: ACTION_SHELF_BUTTONS.hideId,
          icon: HIDE_ICON,
          label: ACTION_SHELF_BUTTONS.hide,
          tooltip: hidden
            ? ACTION_SHELF_BUTTONS.hideActiveTooltip
            : ACTION_SHELF_BUTTONS.hideTooltip,
          active: hidden,
          onClick: () => {
            const current = useWorldEntities().findCurrentDndEntity(entity.id);

            if (current) {
              startHide(current);
            }
          },
        },
      ];
    },
  });
}
