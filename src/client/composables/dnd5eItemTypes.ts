/**
 * Провайдер типов предметов D&D 5e для панели «Предметы» ядра.
 *
 * Всё знание D&D о предметах (какие типы, их иконки/подписи, какую модалку
 * открыть на просмотр/правку и как свернуть сохранённый объект / отправить
 * карточку в чат) живёт ЗДЕСЬ, в системе. Ядровая панель предметов лишь вызывает
 * методы провайдера через `itemTypeRegistry`. Логика перенесена из
 * `modules/items/ui/ItemsPanel.vue` без изменения поведения.
 *
 * @module systems/dnd5e/composables/dnd5eItemTypes
 */

import type {
  ItemFormContext,
  ItemTypeMeta,
  ItemTypeProvider,
} from '@/core/registries';
import type {
  BaseGameItem,
  EquipmentCategory,
  TypedWebSocketClient,
} from '@vtt/shared';
import type { DnDGameItem, Spell } from '@vtt/shared/system/dnd.js';

import { useModalManager } from '@/shared_ui/composables/useModalManager';
import { useChatStore } from '@/stores/chatStore';
import { isRecord } from '@vtt/shared';
import {
  CONDITION_ITEM_TYPE,
  getEquipmentCategoryIcon,
  isDnDGameItem,
} from '@vtt/shared/system/dnd.js';

import { useFeatModal } from './useFeatModal';

/** Конфигурация типа предмета: иконка, префикс модалки, подпись. */
interface ItemTypeConfig {
  icon: string;
  modalPrefix: string;
  label: string;
}

/** Единый словарь типов предметов D&D 5e. */
const ITEM_TYPE_CONFIG: Record<string, ItemTypeConfig> = {
  weapon: { icon: 'tabler:sword', modalPrefix: 'Weapon', label: 'Оружие' },
  equipment: {
    icon: 'tabler:shield',
    modalPrefix: 'Equipment',
    label: 'Снаряжение',
  },
  tool: { icon: 'tabler:tools', modalPrefix: 'Tool', label: 'Инструменты' },
  feat: { icon: 'tabler:star', modalPrefix: 'Feat', label: 'Черты' },
  background: {
    icon: 'tabler:book-2',
    modalPrefix: 'Background',
    label: 'Предыстории',
  },
  species: { icon: 'tabler:user', modalPrefix: 'Species', label: 'Виды' },
  class: {
    icon: 'tabler:users-group',
    modalPrefix: 'Class',
    label: 'Классы',
  },
  spell: { icon: 'tabler:wand', modalPrefix: 'Spell', label: 'Заклинания' },
  [CONDITION_ITEM_TYPE]: {
    icon: 'tabler:activity-heartbeat',
    modalPrefix: 'Condition',
    label: 'Состояния',
  },
};

/**
 * Псевдо-вид меню создания «Безделушка».
 *
 * Безделушка — не отдельный тип предмета, а КАТЕГОРИЯ снаряжения
 * (`equipmentCategory`), поэтому значение ключа совпадает с ключом категории:
 * пункт меню и есть выбор категории. Сохраняется такая запись обычным
 * снаряжением (`type: 'equipment'`) и живёт в разделе «Снаряжение» — своего
 * раздела у псевдо-вида не появляется: разделы панель строит по типам
 * СУЩЕСТВУЮЩИХ записей, а записей с таким типом не бывает.
 *
 * Пункт нужен ровно затем, чтобы не создавать снаряжение и не менять ему тип
 * экипировки руками на вкладке «Подробнее» — безделушек в мире много.
 */
const TRINKET_CATEGORY: EquipmentCategory = 'trinket';

/**
 * Метаданные пункта «Безделушка» в меню создания.
 *
 * Значок берётся у категории (движок), чтобы пункт меню и уже созданные
 * безделушки в списках выглядели одинаково. Подпись здесь своя: названия
 * категорий приезжают данными системы уже после регистрации провайдера, а
 * список видов ядро читает один раз, при регистрации.
 */
const TRINKET_TYPE_META: ItemTypeMeta = {
  type: TRINKET_CATEGORY,
  icon: getEquipmentCategoryIcon(TRINKET_CATEGORY),
  label: 'Безделушка',
};

/**
 * Подпись типа предмета («Оружие»). Словарь типов один на систему: панель
 * предметов, карточки и фильтры окна выбора подписывают тип одинаково, и вторая
 * копия подписей разошлась бы с ним у первого же переименования.
 *
 * @param type - тип предмета (`weapon`, `equipment`, `tool`, …)
 * @returns подпись либо `undefined` у незнакомого типа
 */
export function itemTypeLabel(type: string): string | undefined {
  return ITEM_TYPE_CONFIG[type]?.label;
}

/**
 * Формирует имя модалки по типу и действию (`weapon`+`FormModal`→`WeaponFormModal`).
 *
 * @param type - тип предмета
 * @param action - суффикс (`DetailModal` / `FormModal`)
 * @returns имя модалки
 */
function getModalName(type: string, action: string): string {
  const prefix =
    ITEM_TYPE_CONFIG[type]?.modalPrefix
    ?? type.charAt(0).toUpperCase() + type.slice(1);

  return `${prefix}${action}`;
}

/**
 * Заклинание (Spell), а не GameItem: имеет `type: 'spell'`, но НЕ имеет
 * `quantity` (поле GameItem).
 */
function isSpellEntity(value: unknown): value is Spell {
  return (
    isRecord(value)
    && value.type === 'spell'
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.school === 'string'
    && !('quantity' in value)
  );
}

function isGameItemLike(value: unknown): value is DnDGameItem {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.type === 'string'
    && 'quantity' in value
  );
}

/**
 * Создаёт провайдер типов предметов D&D 5e.
 *
 * @returns реализация `ItemTypeProvider`
 */
export function createDnd5eItemTypeProvider(): ItemTypeProvider {
  // Псевдо-вид «Безделушка» встаёт сразу за снаряжением: это его категория, и
  // в меню создания пункты стоят рядом.
  const types: ItemTypeMeta[] = Object.entries(ITEM_TYPE_CONFIG).flatMap(
    ([type, config]) => {
      const meta: ItemTypeMeta = {
        type,
        icon: config.icon,
        label: config.label,
      };

      return type === 'equipment' ? [meta, TRINKET_TYPE_META] : [meta];
    },
  );

  /** Открывает модалку по вычисленному имени. */
  const openByName = (name: string, props: Record<string, unknown>): void => {
    const { openModal } = useModalManager();

    openModal(name, props);
  };

  const openDetail = (baseItem: BaseGameItem): void => {
    // Ядро отдаёт нейтральный предмет — D&D-форму подтверждает гвард. Простым
    // расширением типа тут не обойтись: `DnDGameItem` не только добавляет поля,
    // но и СУЖАЕТ `activeEffects` до D&D-формы.
    if (!isDnDGameItem(baseItem)) {
      return;
    }

    const item = baseItem;

    // Заклинание: SpellDetailModal ожидает prop `spell` (плоский Spell из spellData).
    if (item.type === 'spell') {
      openByName(getModalName('spell', 'DetailModal'), {
        spell: item.spellData ?? null,
      });

      return;
    }

    // Черта: отдельной модалки нет — стандартное описание (ActorDescriptionModal).
    if (item.type === 'feat') {
      useFeatModal().openFeatDescription(item);

      return;
    }

    // Вид/Класс: *DetailModal ожидают плоское определение из вложенного блоба.
    if (item.type === 'species') {
      openByName(getModalName('species', 'DetailModal'), {
        speciesDefinition: item.speciesData ?? null,
        speciesItemId: item.id ?? null,
      });

      return;
    }

    if (item.type === 'class') {
      openByName(getModalName('class', 'DetailModal'), {
        classDefinition: item.classData ?? null,
        classItemId: item.id ?? null,
      });

      return;
    }

    // Оружие/снаряжение/инструмент/предыстория — обобщённо { item }.
    openByName(getModalName(item.type, 'DetailModal'), { item });
  };

  const openForm = (
    type: string,
    baseItem: BaseGameItem | null,
    ctx: ItemFormContext,
  ): void => {
    // Ядро отдаёт нейтральный предмет — D&D-форму подтверждает гвард
    // (см. openDetail); запись чужой формы открывается как новая.
    const item = baseItem && isDnDGameItem(baseItem) ? baseItem : null;
    const socket: TypedWebSocketClient | null = ctx.socket;
    const onSave = ctx.onSave;
    const modalName = getModalName(type, 'FormModal');

    // Черта: FeatFormModal ждёт prop `feat`, а не `item`.
    if (type === 'feat') {
      openByName(modalName, { onSave, feat: item ?? null, socket });

      return;
    }

    // Предыстория: реюзает редактор заклинаний/эффектов и грузит черты — нужен socket.
    if (type === 'background') {
      openByName(modalName, { item, onSave, socket });

      return;
    }

    // Вид: SpeciesFormModal ждёт плоский speciesDefinition из вложенного блоба.
    if (type === 'species') {
      openByName(modalName, {
        onSave,
        speciesDefinition: item?.speciesData ?? null,
        speciesItemId: item?.id ?? null,
        socket,
      });

      return;
    }

    // Класс: ClassFormModal ждёт плоский classDefinition из вложенного блоба.
    if (type === 'class') {
      openByName(modalName, {
        onSave,
        classDefinition: item?.classData ?? null,
        classItemId: item?.id ?? null,
        socket,
      });

      return;
    }

    // Состояние: форме нужен сокет — «Сбросить к канону» удаляет запись мира.
    if (type === CONDITION_ITEM_TYPE) {
      openByName(modalName, { item, onSave, socket });

      return;
    }

    // Безделушка: та же форма снаряжения, но с заранее выбранной категорией.
    if (type === TRINKET_CATEGORY) {
      openByName(getModalName('equipment', 'FormModal'), {
        item,
        onSave,
        createCategory: TRINKET_CATEGORY,
      });

      return;
    }

    // Оружие/снаряжение/инструмент/заклинание — обобщённо { item, onSave }.
    openByName(modalName, { item, onSave });
  };

  /**
   * Сворачивает сохранённый объект в GameItem. Spell из SpellFormModal
   * оборачивается в GameItem-обёртку со spellData; GameItem — как есть.
   */
  const normalizeSave = (saved: unknown): DnDGameItem | null => {
    if (isSpellEntity(saved)) {
      return {
        id: saved.id,
        name: saved.name,
        nameEn: saved.nameEn,
        description: saved.description,
        type: 'spell',
        quantity: 1,
        weight: 0,
        cost: '',
        rarity: 'common',
        equipped: false,
        sourceKey: saved.sourceKey,
        isSRD: saved.isSRD,
        isReadOnly: false,
        spellData: saved,
      };
    }

    if (isGameItemLike(saved)) {
      return saved;
    }

    return null;
  };

  /**
   * Отправляет карточку предмета в чат. Пока share только у заклинаний: метаданные
   * верхнего уровня сливаются со spellData (карточка чата ждёт объект Spell).
   */
  const shareToChat = (baseItem: BaseGameItem): void => {
    // Ядро отдаёт нейтральный предмет — D&D-форму подтверждает гвард
    // (см. openDetail).
    if (!isDnDGameItem(baseItem)) {
      return;
    }

    const item = baseItem;

    if (item.type !== 'spell' || !item.spellData) {
      return;
    }

    const spell = {
      ...item.spellData,
      id: item.id,
      name: item.name,
      nameEn: item.nameEn,
      description: item.description,
      isSRD: item.isSRD,
      sourceKey: item.sourceKey,
    };

    useChatStore().sendItemCard({
      cardType: 'spell',
      title: item.name,
      payload: JSON.stringify(spell),
    });
  };

  return { types, openDetail, openForm, normalizeSave, shareToChat };
}
