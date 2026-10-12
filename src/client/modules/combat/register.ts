/**
 * Под-модуль системы D&D 5e: БОЙ В ЧАТЕ.
 *
 * Регистрирует кнопки под уроном атаки в карточке чата: «Отменить урон» под
 * нанесённым уроном и «Нанести урон» под отметкой об отмене, а рядом с ними,
 * в том же ряду, — переключатели «Половина» / «Полный урон» и «Крит» / «Не
 * крит». Кнопки рисует ядро — автору сообщения и мастеру. Что они делают, как
 * подписаны и кому из двоих показаны под конкретной карточкой — решает
 * система (`attackDamageActions.ts`): «Половина» и «Крит» под нанесённым
 * уроном видит и автор атаки, отмену и повторный урон — мастер и автор с
 * правом роли «Отмена урона из чата». Она же отказывает в самом действии.
 *
 * @module systems/dnd5e/modules/combat
 */

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import {
  ATTACK_DAMAGE_FOLLOW_UP_KIND,
  ATTACK_DAMAGE_REVERTED_FOLLOW_UP_KIND,
} from '@vtt/shared/system/dnd.js';

import {
  reapplyAttackDamage,
  resolveCriticalActionView,
  resolveHalfActionView,
  resolveReapplyActionView,
  resolveRevertActionView,
  revertAttackDamage,
  toggleAttackDamageCritical,
  toggleAttackDamageHalf,
} from '../../composables/attackDamageActions';
import { ATTACK_DAMAGE_ACTION_LABELS } from '../../ui/actor/constants';

/** Раскладка кнопок под уроном: кнопки равной ширины в один ряд */
const ATTACK_DAMAGE_ACTIONS_LAYOUT = 'row';

/**
 * Переключатели режима урона — одни и те же под нанесённым и под отменённым
 * уроном: над отменённым они наносят записанный бросок заново
 */
const ATTACK_DAMAGE_MODE_ACTIONS = [
  {
    id: ATTACK_DAMAGE_ACTION_LABELS.halfId,
    label: ATTACK_DAMAGE_ACTION_LABELS.half,
    icon: ATTACK_DAMAGE_ACTION_LABELS.halfIcon,
    tooltip: ATTACK_DAMAGE_ACTION_LABELS.halfTooltip,
    view: resolveHalfActionView,
    run: toggleAttackDamageHalf,
  },
  {
    id: ATTACK_DAMAGE_ACTION_LABELS.criticalId,
    label: ATTACK_DAMAGE_ACTION_LABELS.critical,
    icon: ATTACK_DAMAGE_ACTION_LABELS.criticalIcon,
    tooltip: ATTACK_DAMAGE_ACTION_LABELS.criticalTooltip,
    view: resolveCriticalActionView,
    run: toggleAttackDamageCritical,
  },
];

/**
 * Регистрирует действия над уроном атаки в чате.
 *
 * @param api - API ядра для системы
 */
export function register(api: ClientSystemAPI): void {
  // Ядро старше действий над дополнениями: кнопок нет, урон в карточке
  // остаётся обычной строкой
  if (!('chatFollowUpActions' in api)) {
    return;
  }

  api.chatFollowUpActions({
    kind: ATTACK_DAMAGE_FOLLOW_UP_KIND,
    layout: ATTACK_DAMAGE_ACTIONS_LAYOUT,
    actions: [
      {
        id: ATTACK_DAMAGE_ACTION_LABELS.revertId,
        label: ATTACK_DAMAGE_ACTION_LABELS.revert,
        icon: ATTACK_DAMAGE_ACTION_LABELS.revertIcon,
        view: resolveRevertActionView,
        run: revertAttackDamage,
      },
      ...ATTACK_DAMAGE_MODE_ACTIONS,
    ],
  });

  api.chatFollowUpActions({
    kind: ATTACK_DAMAGE_REVERTED_FOLLOW_UP_KIND,
    layout: ATTACK_DAMAGE_ACTIONS_LAYOUT,
    actions: [
      {
        id: ATTACK_DAMAGE_ACTION_LABELS.reapplyId,
        label: ATTACK_DAMAGE_ACTION_LABELS.reapply,
        icon: ATTACK_DAMAGE_ACTION_LABELS.reapplyIcon,
        view: resolveReapplyActionView,
        run: reapplyAttackDamage,
      },
      ...ATTACK_DAMAGE_MODE_ACTIONS,
    ],
  });
}
