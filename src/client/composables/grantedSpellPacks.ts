/**
 * Выдача заклинаний листу вне мастеров: черта, брошенная на лист, перевыбор
 * черты, заклинания вида и черт, открывшиеся с уровнем.
 *
 * Мастера класса, вида и предыстории держат каталог реактивно
 * ({@link useGrantedSpellsResolver}); здесь то же правило поиска одним вызовом.
 */

import type { TypedWebSocketClient } from '@vtt/shared';
import type {
  ClassSpellListRequest,
  DnDActor,
  GrantedSpellPack,
  GrantedSpellSource,
  ResolvedGrantedSpell,
} from '@vtt/shared/system/dnd.js';

import { useItemsStore } from '@/stores/itemsStore';
import {
  expandClassSpellRequests,
  normalizeSpellName,
  resolveGrantedSpellSourcesInPacks,
  WORLD_PACK_ID,
} from '@vtt/shared/system/dnd.js';

import { COMPENDIUM_PICKER_LABELS } from '../ui/actor/constants';
import { extractWorldSpells, loadSpellPacks } from './spellCompendium';
import { finalizeGrantedSpells } from './usePackChoicePrompt';

/**
 * Заклинания мира по пакам: компендиумы в порядке хоста и записи самого мира
 * последним паком. Свои заклинания мира ищутся наравне с компендиумными: черта
 * может выдавать заклинание, заведённое в панели «Предметы». Своим паком —
 * чтобы список класса, ограниченный компендиумом, их не подхватил.
 *
 * @param socket - WebSocket-клиент
 * @returns заклинания по пакам с подписями для окна выбора
 */
export async function loadGrantedSpellPacks(
  socket: TypedWebSocketClient,
): Promise<GrantedSpellPack[]> {
  const { packs } = await loadSpellPacks(socket);

  return [
    ...packs,
    {
      packId: WORLD_PACK_ID,
      packName: COMPENDIUM_PICKER_LABELS.worldPack,
      spells: extractWorldSpells(useItemsStore().itemsByType('spell')),
    },
  ];
}

/** Как выдаются заклинания */
export interface SpellGrantRequest {
  /** Связи «заклинание → умение-источник» */
  sources: GrantedSpellSource[];
  /** Запросы «выдать весь список класса» */
  classRequests?: ClassSpellListRequest[];
  /**
   * Пересборка при повышении уровня: уже лежащее на листе не спрашивается, а о
   * ненайденном не напоминается — об этом сказали, когда запись применяли.
   */
  isLevelUnlock?: boolean;
}

/**
 * Находит выдаваемые заклинания по правилу «свой пак → единственный другой →
 * выбор игрока → нет». Без листа спросить некого — остаются только
 * однозначные.
 *
 * @param socket - WebSocket-клиент (для загрузки компендиума)
 * @param actor - персонаж, которому выдаются заклинания
 * @param request - что выдаётся
 * @returns заклинания, которые лягут на лист
 */
export async function resolveSpellGrantsForActor(
  socket: TypedWebSocketClient | null | undefined,
  actor: DnDActor | null | undefined,
  request: SpellGrantRequest,
): Promise<ResolvedGrantedSpell[]> {
  const classRequests = request.classRequests ?? [];

  if ((request.sources.length === 0 && classRequests.length === 0) || !socket) {
    return [];
  }

  const packs = await loadGrantedSpellPacks(socket);

  const resolution = resolveGrantedSpellSourcesInPacks(packs, [
    ...request.sources,
    ...expandClassSpellRequests(classRequests, packs),
  ]);

  if (!actor) {
    return resolution.resolved;
  }

  if (!request.isLevelUnlock) {
    return finalizeGrantedSpells(actor.id, resolution);
  }

  const knownNames = new Set(
    (actor.spells ?? []).map((spell) => normalizeSpellName(spell.name)),
  );

  return finalizeGrantedSpells(actor.id, {
    resolved: resolution.resolved,
    ambiguous: resolution.ambiguous.filter(
      ({ candidates }) =>
        !candidates.some((candidate) =>
          knownNames.has(normalizeSpellName(candidate.entry.name)),
        ),
    ),
    missing: [],
  });
}
