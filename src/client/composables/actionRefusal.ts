/**
 * Отказ действия — тому, кто действовал, и только ему.
 *
 * Действие, которое не началось (нет зарядов, нет ячеек, цель вне дальности,
 * запрет траты хода, нет боеприпасов), объясняет почему уведомлением у
 * нажавшего. Раньше отказ с листа шёл уведомлением, а с горячей панели —
 * строкой в общий чат: игроки видели, что у чудовища кончились заряды или что
 * до цели ему не дотянуться. Здесь один способ на лист и панель, на персонажа
 * и существо.
 *
 * Совершённое действие (каст, урон, спасброски, провал каста) пишет в общий
 * чат само — это не отказ.
 */

import type { Spell } from '@vtt/shared/system/dnd.js';

import type { SpellCastRefusal } from './spellCastFlow';

import { useSystemToastStore } from '../stores/systemToastStore';
import {
  ACTION_REFUSAL_LABELS,
  ACTOR_EQUIPMENT_TAB_LABELS,
} from '../ui/actor/constants';

/**
 * Говорит действовавшему, почему действие не началось. Уведомление видит
 * только он: в чат и другим клиентам отказ не уходит.
 *
 * @param title - что не вышло
 * @param description - почему
 */
export function refuseAction(title: string, description?: string): void {
  useSystemToastStore().add({ title, description, color: 'warning' });
}

/**
 * Отказ каста заклинания — один на лист и горячую панель, на персонажа и
 * существо. Причина заклинание не называет: его называет эта строка.
 *
 * @param spell - заклинание
 * @param refusal - почему каст не начался
 */
export function refuseSpellCast(
  spell: Pick<Spell, 'name'>,
  refusal: SpellCastRefusal,
): void {
  refuseAction(
    refusal.title,
    `${spell.name}${ACTION_REFUSAL_LABELS.sourceSeparator}${refusal.description}`,
  );
}

/**
 * Отказ удара оружием — один на вкладку снаряжения и горячую панель.
 *
 * @param reason - причина запрета
 */
export function refuseWeaponAttack(reason: string): void {
  refuseAction(ACTOR_EQUIPMENT_TAB_LABELS.attackBlockedTitle, reason);
}
