/**
 * Под-модуль системы D&D 5e: ПРЕДМЕТЫ.
 *
 * Регистрирует провайдер типов предметов (для панели «Предметы» ядра), карточки
 * сущностей предметов (заклинание/оружие/снаряжение/инструмент/черта/предыстория/
 * класс/вид) и карточки чата предметов. Один из «модулей внутри системы».
 *
 * @module systems/dnd5e/modules/items
 */

import type {
  GameItem,
  SpeciesDefinition,
  Spell,
} from '@vtt/shared/system/dnd.js';

import type { ClientSystemAPI } from '@/core/systemBootstrap';

import type { KeyedDefinition } from '../../composables/useEntityDetailModals';

import { createDnd5eItemTypeProvider } from '../../composables/dnd5eItemTypes';
import { useEntityDetailModals } from '../../composables/useEntityDetailModals';
import { useFeatModal } from '../../composables/useFeatModal';
import BackgroundListItem from '../../ui/actor/background/BackgroundListItem.vue';
import ClassListItem from '../../ui/actor/class/ClassListItem.vue';
import EquipmentListItem from '../../ui/actor/EquipmentListItem.vue';
import FeatListItem from '../../ui/actor/FeatListItem.vue';
import SpeciesListItem from '../../ui/actor/species/SpeciesListItem.vue';
import SpellListItem from '../../ui/actor/SpellListItem.vue';
import ToolListItem from '../../ui/actor/ToolListItem.vue';
import WeaponListItem from '../../ui/actor/WeaponListItem.vue';
import BackgroundCardContent from '../../ui/chat/BackgroundCardContent.vue';
import EquipmentCardContent from '../../ui/chat/EquipmentCardContent.vue';
import FeatureCardContent from '../../ui/chat/FeatureCardContent.vue';
import SpellCardContent from '../../ui/chat/SpellCardContent.vue';
import ToolCardContent from '../../ui/chat/ToolCardContent.vue';

/**
 * Определение класса/вида из записи: у GameItem мира оно лежит во вложенном поле
 * (`classData`/`speciesData`), у записи компендиума — на верхнем уровне. Та же
 * развилка, что в `propsFor` этих карточек.
 *
 * @param entry - запись предмета или компендиума
 * @param nested - имя вложенного поля с определением
 */
function definitionOf<T>(
  entry: unknown,
  nested: 'classData' | 'speciesData',
): T {
  const record = entry as Record<string, unknown>;

  return (record[nested] ?? record) as T;
}

/** Регистрирует предметы D&D 5e: типы, карточки сущностей и чата (через SDK). */
export function register(api: ClientSystemAPI): void {
  // Провайдер типов предметов для панели «Предметы» ядра (иконки/подписи,
  // открытие просмотра/правки, нормализация сохранения, отправка в чат).
  api.itemTypes(createDnd5eItemTypeProvider());

  // Карточки сущностей D&D 5e + маппер пропсов (`propsFor`). `spell` разрешает
  // атрибут onShare; остальные типы по умолчанию — { item }.
  //
  // `openDetail` — D&D-специфика: ядро (панель предметов, браузер компендиума,
  // переход по ссылке из описания) открывает деталь через этот хук по типу
  // записи, не зная ни модалок, ни системных композаблов.
  api.entityCard({
    type: 'spell',
    listItemComponent: SpellListItem,
    allowShareAttr: true,
    openDetail: (entry, options) => {
      useEntityDetailModals().openSpellDetail(entry as Spell, options);
    },
  });

  api.entityCard({
    type: 'weapon',
    listItemComponent: WeaponListItem,
    openDetail: (entry, options) => {
      useEntityDetailModals().openItemDetail(entry as GameItem, options);
    },
  });

  api.entityCard({
    type: 'equipment',
    listItemComponent: EquipmentListItem,
    openDetail: (entry, options) => {
      useEntityDetailModals().openItemDetail(entry as GameItem, options);
    },
  });

  api.entityCard({
    type: 'tool',
    listItemComponent: ToolListItem,
    openDetail: (entry, options) => {
      useEntityDetailModals().openItemDetail(entry as GameItem, options);
    },
  });

  api.entityCard({
    type: 'feat',
    listItemComponent: FeatListItem,
    openDetail: (entry, options) => {
      useFeatModal().openFeatDescription(entry as GameItem, options);
    },
  });

  api.entityCard({
    type: 'background',
    listItemComponent: BackgroundListItem,
    propsFor: (entry) => ({ backgroundDefinition: entry }),
    openDetail: (entry, options) => {
      useEntityDetailModals().openBackgroundDetail(
        entry as KeyedDefinition,
        options,
      );
    },
  });

  api.entityCard({
    type: 'class',
    listItemComponent: ClassListItem,
    // GameItem мира несёт класс во вложенном classData; записи компендиума
    // уже плоские — поэтому fallback на сам entry.
    propsFor: (entry) => ({ classDefinition: entry.classData ?? entry }),
    openDetail: (entry) => {
      useEntityDetailModals().openClassDetail(
        definitionOf<KeyedDefinition>(entry, 'classData'),
      );
    },
  });

  api.entityCard({
    type: 'species',
    listItemComponent: SpeciesListItem,
    // GameItem мира несёт вид во вложенном speciesData; записи компендиума
    // уже плоские — поэтому fallback на сам entry.
    propsFor: (entry) => ({ speciesDefinition: entry.speciesData ?? entry }),
    openDetail: (entry) => {
      useEntityDetailModals().openSpeciesDetail(
        definitionOf<SpeciesDefinition>(entry, 'speciesData'),
      );
    },
  });

  // Карточки чата D&D 5e (контент предметов). `systemId` проставляет SDK.
  api.chatCard({
    cardType: 'spell',
    label: 'Заклинание',
    component: SpellCardContent,
  });

  api.chatCard({
    cardType: 'equipment',
    label: 'Снаряжение',
    component: EquipmentCardContent,
  });

  api.chatCard({
    cardType: 'tool',
    label: 'Инструмент',
    component: ToolCardContent,
  });

  api.chatCard({
    cardType: 'background',
    label: 'Предыстория',
    component: BackgroundCardContent,
  });

  api.chatCard({
    cardType: 'feature',
    label: 'Особенность',
    component: FeatureCardContent,
  });
}
