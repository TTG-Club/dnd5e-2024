/**
 * Под-модуль системы D&D 5e: ЗАСАДА.
 *
 * Регистрирует кнопки под сообщением об удачной засаде — «Найти» и «Шум» — и
 * полку действий системы слева от панели быстрого доступа: «Атака» и «Прыжок»
 * (пока недоступны), «Спрятаться» и «Поиск».
 *
 * Сообщение с кнопками пишется только о засаде персонажа игрока. «Найти» —
 * только ведущему: враги ищут спрятавшегося персонажа его руками. «Шум» —
 * ведущему и автору сообщения (спрятавшемуся). Права проверяют сами
 * обработчики (`hideAction.ts`): показ кнопки не защищает. Засада существа
 * ведущего в чат не пишется — игроки ищут её «Поиском» на полке. «Поиск» на полке — тот же
 * поиск за выделенную фишку, им ищет и игрок. Полку ядро даёт с VTTG
 * 0.9.725; на старом приложении её нет — модуль её не регистрирует и не
 * падает.
 *
 * @module systems/dnd5e/modules/stealth
 */

import type { ChatFollowUpActionContext } from '@/core/registries';
import type { ClientSystemAPI } from '@/core/systemBootstrap';
import type { ChatMessageFollowUp } from '@vtt/shared';
import type { DnDSceneEntity } from '@vtt/shared/system/dnd.js';

import type { ActionShelfButton } from '../../composables/actionShelf';

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
  startSearch,
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
          gmOnly: true,
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
          onClick: () => runWithLiveEntity(entity.id, startHide),
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
