import type { EntityDetailOptions } from '@/core/registries';
import type {
  GameItem,
  SpeciesDefinition,
  Spell,
} from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';

/** Запись существа компендиума в объёме, нужном для открытия его листа. */
export interface CreatureEntry {
  id: string;
  [key: string]: unknown;
}

/** Определение класса/предыстории: адресуется по `key`, `id` может отсутствовать. */
export interface KeyedDefinition {
  key: string;
  id?: string;
  [key: string]: unknown;
}

/**
 * Открытие детального просмотра записей D&D 5e — какой модалкой показывать
 * заклинание, оружие, класс и т.д.
 *
 * Живёт в системе: ядро (панель предметов, компендиум, переход по ссылке из
 * описания) вызывает эти функции только через хук `openDetail` реестра карточек,
 * не зная D&D. Один и тот же набор используют браузер компендиума (с кнопкой
 * копирования в инвентарь) и разрешение ссылок (без неё) — отсюда `options`
 * вместо зашитого `showCopyButton: true`.
 */
export function useEntityDetailModals() {
  const { openModal } = useModalManager();

  /**
   * Открывает предмет: тип окна выбирается по типу записи.
   *
   * @param item - оружие, снаряжение или инструмент
   * @param options - кнопка копирования в инвентарь и её колбэк
   */
  function openItemDetail(item: GameItem, options?: EntityDetailOptions): void {
    const modal =
      item.type === 'weapon'
        ? 'WeaponDetailModal'
        : item.type === 'tool'
          ? 'ToolDetailModal'
          : 'EquipmentDetailModal';

    openModal(modal, { item, ...options });
  }

  /**
   * Открывает заклинание.
   *
   * @param spell - заклинание
   * @param options - кнопка копирования в инвентарь и её колбэк
   */
  function openSpellDetail(spell: Spell, options?: EntityDetailOptions): void {
    openModal('SpellDetailModal', { spell, ...options });
  }

  /**
   * Открывает класс.
   *
   * @param classDef - определение класса
   */
  function openClassDetail(classDef: KeyedDefinition): void {
    openModal('ClassDetailModal', { classDefinition: classDef });
  }

  /**
   * Открывает вид.
   *
   * @param species - определение вида
   */
  function openSpeciesDetail(species: SpeciesDefinition): void {
    openModal('SpeciesDetailModal', { speciesDefinition: species });
  }

  /**
   * Открывает предысторию.
   *
   * @param backgroundDef - определение предыстории
   * @param options - кнопка копирования в инвентарь и её колбэк
   */
  function openBackgroundDetail(
    backgroundDef: KeyedDefinition,
    options?: EntityDetailOptions,
  ): void {
    openModal('BackgroundDetailModal', {
      backgroundDefinition: backgroundDef,
      ...options,
    });
  }

  /**
   * Открывает лист существа в режиме просмотра.
   *
   * @param creatureEntry - запись существа компендиума
   */
  function openCreatureDetail(creatureEntry: CreatureEntry): void {
    openModal('CreatureSheet', {
      creatureId: creatureEntry.id,
      initialData: creatureEntry,
    });
  }

  return {
    openItemDetail,
    openSpellDetail,
    openClassDetail,
    openSpeciesDetail,
    openBackgroundDetail,
    openCreatureDetail,
  };
}
