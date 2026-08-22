/**
 * Под-модуль системы D&D 5e: СОСТОЯНИЯ.
 *
 * Регистрирует карточку записи состояния и подключает состояния мира к движку:
 * дальше их видят и сетка состояний на листе, и значки на токенах, и списки
 * иммунитетов. Один из «модулей внутри системы».
 *
 * @module systems/dnd5e/modules/conditions
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import {
  CONDITION_ITEM_TYPE,
  isConditionItem,
  isDnDGameItem,
} from '@vtt/shared/system/dnd.js';

import { connectWorldConditionsToEngine } from '../../composables/worldConditions';
import { CONDITION_MODALS } from '../../ui/condition/conditionConsts';
import ConditionListItem from '../../ui/condition/ConditionListItem.vue';

/** Регистрирует состояния D&D 5e: карточка записи и источник состояний мира. */
export function register(api: ClientSystemAPI): void {
  api.entityCard({
    type: CONDITION_ITEM_TYPE,
    listItemComponent: ConditionListItem,
    openDetail: (entry) => {
      if (isDnDGameItem(entry) && isConditionItem(entry)) {
        useModalManager().openModal(CONDITION_MODALS.detail, { item: entry });
      }
    },
  });

  // Состояния мира — записи «Мастерской»; движку они отдаются геттером, поэтому
  // подключение достаточно выполнить один раз при загрузке системы.
  connectWorldConditionsToEngine();
}
