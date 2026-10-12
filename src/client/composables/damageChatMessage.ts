import type {
  ChatBlock,
  ChatFollowUpOptions,
  ChatSendOptions,
  DiceRollData,
} from '@vtt/shared';
import type { AttackDamageRecord } from '@vtt/shared/system/dnd.js';

import {
  ATTACK_DAMAGE_FOLLOW_UP_KIND,
  buildActionChatHeader,
  serializeAttackDamageRecord,
} from '@vtt/shared/system/dnd.js';

/**
 * Параметры отправки сообщения боя: лента чата отмечает такое сообщение
 * полосой по краю карточки. Так выделяются нанесённый урон и любой бросок атаки — и
 * промах, и попадание без урона. Что выделять, решает система — ядро только
 * рисует окраску.
 */
export const DAMAGE_CHAT_OPTIONS = {
  tone: 'damage',
} as const satisfies ChatSendOptions;

/**
 * Параметры сообщения боя от имени того, кто действует: атакующего или
 * заклинателя.
 *
 * Без названной сущности ядро подписывает бросок той, которой пользователь
 * коснулся последней, — а перед атакой это обычно цель: её токен выделяли,
 * чтобы назначить целью. Карточка атаки существа подписывалась именем жертвы.
 * Сервер подпись проверяет: чужой сущностью подписаться нельзя.
 *
 * @param speakerEntityId - кто действует; нет — подпись выберет ядро
 * @param blocks - оформление текстового сообщения блоками; нет — текст
 * @returns параметры для `sendMessage`
 */
export function buildCombatChatOptions(
  speakerEntityId?: string | null,
  blocks?: readonly ChatBlock[],
): ChatSendOptions {
  return {
    ...DAMAGE_CHAT_OPTIONS,
    ...buildSpeakerChatOptions(speakerEntityId),
    ...(blocks && blocks.length > 0 ? { blocks: [...blocks] } : {}),
  };
}

/**
 * Подпись сообщения тем, кто действует (см. {@link buildCombatChatOptions}),
 * без окраски боя: лечение, сводка заклинания без урона.
 *
 * @param speakerEntityId - кто действует; нет — подпись выберет ядро
 * @returns параметры для `sendMessage`; пусто — подпись выберет ядро
 */
export function buildSpeakerChatOptions(
  speakerEntityId?: string | null,
): ChatSendOptions {
  return speakerEntityId ? { speakerEntityId } : {};
}

/**
 * Параметры дополнения чата с уроном атаки: окраска урона и запись, по
 * которой его можно отменить и повторить (кнопки под уроном в карточке). Без
 * записи — урон никому не нанесён — только окраска: отменять нечего.
 *
 * Ядро без действий над дополнениями лишние поля просто не читает.
 *
 * @param record - запись об уроне; нет — отменять нечего
 * @param blocks - оформление текстового дополнения блоками; нет — текст
 * @returns параметры для `appendToMessage`
 */
export function buildAttackDamageChatOptions(
  record: AttackDamageRecord | null | undefined,
  blocks?: readonly ChatBlock[],
): ChatFollowUpOptions {
  const base: ChatFollowUpOptions = {
    ...DAMAGE_CHAT_OPTIONS,
    ...(blocks && blocks.length > 0 ? { blocks: [...blocks] } : {}),
  };

  if (!record || record.targets.length === 0 || record.parts.length === 0) {
    return base;
  }

  return {
    ...base,
    kind: ATTACK_DAMAGE_FOLLOW_UP_KIND,
    payload: serializeAttackDamageRecord(record),
  };
}

/** Часть стора чата, через которую урон уходит в ленту */
interface DamageChatStore {
  sendMessage: (
    content: string,
    type?: 'text' | 'roll',
    rollData?: DiceRollData,
    cardData?: undefined,
    options?: ChatSendOptions,
  ) => unknown;
  appendToMessage?: (
    messageId: string,
    content: string,
    type?: 'text' | 'roll',
    rollData?: DiceRollData,
    options?: ChatFollowUpOptions,
  ) => boolean;
}

/**
 * Бросок урона для отдельной карточки. Его блок собран под карточку атаки —
 * одни строки, действие и цель там называет шапка броска атаки. Отдельной
 * карточке шапку даёт запись об уроне: чем били и по кому.
 *
 * @param rollData - данные броска урона
 * @param record - запись об уроне; нет — назвать действие нечем
 * @returns бросок с шапкой в блоке либо как есть
 */
function withStandaloneHeader(
  rollData: DiceRollData | undefined,
  record: AttackDamageRecord | null | undefined,
): DiceRollData | undefined {
  if (!rollData?.block || rollData.block.title || !record) {
    return rollData;
  }

  return {
    ...rollData,
    block: {
      ...rollData.block,
      ...buildActionChatHeader({
        name: record.label,
        targetNames: record.targets.map((target) => target.name),
      }),
    },
  };
}

/**
 * Отправляет урон в чат: дописывает его в карточку броска атаки, а без неё
 * (урон без броска попадания, старое ядро без дописывания или дописать не
 * вышло) — отдельным сообщением с окраской урона.
 *
 * @param chatStore - стор чата ядра
 * @param attackMessageId - id сообщения с броском атаки; нет — урон без атаки
 * @param content - формула или текст урона
 * @param type - вид сообщения
 * @param rollData - данные броска для `'roll'`
 * @param record - запись об уроне для кнопок «Отменить урон» / «Нанести
 *   урон»; нет — урон никому не нанесён
 * @param speakerEntityId - кто нанёс урон: им подписывается отдельное
 *   сообщение (дописанное наследует подпись карточки атаки)
 */
export function sendDamageToChat(
  chatStore: DamageChatStore,
  attackMessageId: string | null | undefined,
  content: string,
  type: 'text' | 'roll',
  rollData?: DiceRollData,
  record?: AttackDamageRecord | null,
  speakerEntityId?: string | null,
): void {
  if (
    attackMessageId
    && chatStore.appendToMessage?.(
      attackMessageId,
      content,
      type,
      rollData,
      buildAttackDamageChatOptions(record),
    )
  ) {
    return;
  }

  chatStore.sendMessage(
    content,
    type,
    withStandaloneHeader(rollData, record),
    undefined,
    buildCombatChatOptions(speakerEntityId),
  );
}
