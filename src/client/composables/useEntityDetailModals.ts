import type { SourceDefinition } from '@vtt/shared';
import type { EntityDetailOptions } from '@/core/registries';
import type {
  DnDGameItem,
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

/** Термин глоссария в объёме, нужном для открытия его описания. */
export interface GlossaryEntry {
  id: string;
  name: string;
  nameEn?: string;
  /** Раздел глоссария («Состояния», «Действия») */
  category?: string;
  description?: string;
  sourceKey?: string;
  source?: SourceDefinition;
  isSRD?: boolean;
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
  function openItemDetail(item: DnDGameItem, options?: EntityDetailOptions): void {
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

  /**
   * Открывает описание термина глоссария.
   *
   * `options` здесь нет намеренно: копировать термин в инвентарь некуда — это
   * справочный текст, а не сущность листа. Раздел глоссария показываем бейджем
   * над описанием, если он у записи есть.
   *
   * @param entry - термин глоссария
   */
  function openGlossaryDetail(entry: GlossaryEntry): void {
    openModal('ActorDescriptionModal', {
      _modalKey: entry.id,
      title: entry.name,
      subtitle: entry.nameEn,
      description: entry.description,
      sourceKey: entry.sourceKey,
      source: entry.source,
      isSRD: entry.isSRD,
      fields: entry.category
        ? [{ badges: [{ text: entry.category, color: 'neutral' }] }]
        : undefined,
    });
  }

  return {
    openItemDetail,
    openSpellDetail,
    openClassDetail,
    openSpeciesDetail,
    openBackgroundDetail,
    openCreatureDetail,
    openGlossaryDetail,
  };
}
