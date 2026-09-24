import type {
  AmmunitionTypeDefinition,
  ArmorBaseTypeDefinition,
  DamageTypeDefinition,
  EquipmentCategoryDefinition,
  EquipmentPropertyDefinition,
  SourceDefinition,
  ToolPropertyDefinition,
  WeaponBaseTypeDefinition,
  WeaponCategoryDefinition,
  WeaponPropertyDefinition,
} from '@vtt/shared';
import type { SpeciesDefinition } from '@vtt/shared/system/dnd.js';

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

/**
 * Хранилище справочных данных D&D (свойства оружия, типы урона и т.д.) —
 * единственное своё хранилище системы. Наполняется один раз при подключении к
 * миру (`systemDataSync`) и читается всеми окнами.
 *
 * Имя с префиксом системы: pinia у нас общая с приложением, и имена хранилищ в
 * ней — плоский общий список. Совпади оно с чужим — два разных хранилища молча
 * стали бы одним.
 *
 * Наружу списки уходят только на чтение: класть в них — дело слоя
 * синхронизации, а из окна это меняло бы данные сразу у всех остальных. Что
 * окну и правда нужно записать, у того есть своё названное действие
 * (`rememberSource`, `rememberSpeciesDefinitions`).
 */
export const useSystemDataStore = defineStore('dnd5e-2024:system-data', () => {
  /** Определения свойств оружия */
  const weaponProperties = ref<WeaponPropertyDefinition[]>([]);

  /** Определения базовых типов оружия */
  const weaponBaseTypes = ref<WeaponBaseTypeDefinition[]>([]);

  /** Определения типов урона */
  const damageTypes = ref<DamageTypeDefinition[]>([]);

  /** Определения категорий оружия */
  const weaponCategories = ref<WeaponCategoryDefinition[]>([]);

  /** Определения типов боеприпасов */
  const ammunitionTypes = ref<AmmunitionTypeDefinition[]>([]);

  /** Источники, встроенные в систему (базовые книги из `data/sources.json`) */
  const builtinSources = ref<SourceDefinition[]>([]);

  /** Источники, приехавшие с паками компендиума (из манифеста пака) */
  const packSources = ref<SourceDefinition[]>([]);

  /** Источники, вписанные пользователем при создании своего контента */
  const customSources = ref<SourceDefinition[]>([]);

  /**
   * Источники контента: вписанные пользователем, приехавшие с паками и
   * встроенные.
   *
   * Система знает только базовые книги, а в компендиуме встречается что угодно
   * (`lfl`, `efa`, …) — без слияния такие записи оставались бы без подписи, а их
   * источник нельзя было бы выбрать при создании своего контента. Порядок
   * приоритета обратный порядку доверия: при совпадении ключа выигрывает
   * встроенный (его название выверено и от пака не зависит), затем пак, и лишь
   * потом вписанное вручную — опечатка в своей книге не должна переименовывать
   * «Книгу игрока».
   */
  const sources = computed<SourceDefinition[]>(() => {
    const byKey = new Map<string, SourceDefinition>();

    for (const source of [
      ...customSources.value,
      ...packSources.value,
      ...builtinSources.value,
    ]) {
      byKey.set(source.key, source);
    }

    return [...byKey.values()];
  });

  /** Определения категорий доспехов */
  const armorCategories = ref<EquipmentCategoryDefinition[]>([]);

  /** Определения базовых типов доспехов */
  const armorBaseTypes = ref<ArmorBaseTypeDefinition[]>([]);

  /** Определения свойств снаряжения */
  const equipmentProperties = ref<EquipmentPropertyDefinition[]>([]);

  /** Определения свойств инструментов */
  const toolProperties = ref<ToolPropertyDefinition[]>([]);

  /** Определения видов (расы) */
  const speciesDefinitions = ref<SpeciesDefinition[]>([]);

  /**
   * Устанавливает свойства оружия из серверных данных
   * @param properties - массив определений свойств
   */
  function setWeaponProperties(properties: WeaponPropertyDefinition[]): void {
    weaponProperties.value = properties;
  }

  /**
   * Устанавливает базовые типы оружия из серверных данных
   * @param baseTypes - массив определений типов
   */
  function setWeaponBaseTypes(baseTypes: WeaponBaseTypeDefinition[]): void {
    weaponBaseTypes.value = baseTypes;
  }

  /**
   * Устанавливает типы урона из серверных данных
   * @param types - массив определений типов урона
   */
  function setDamageTypes(types: DamageTypeDefinition[]): void {
    damageTypes.value = types;
  }

  /**
   * Устанавливает категории оружия из серверных данных
   * @param categories - массив определений категорий
   */
  function setWeaponCategories(categories: WeaponCategoryDefinition[]): void {
    weaponCategories.value = categories;
  }

  /**
   * Устанавливает типы боеприпасов из серверных данных
   * @param types - массив определений типов боеприпасов
   */
  function setAmmunitionTypes(types: AmmunitionTypeDefinition[]): void {
    ammunitionTypes.value = types;
  }

  /**
   * Устанавливает встроенные источники системы из серверных данных
   * @param items - массив определений источников
   */
  function setSources(items: SourceDefinition[]): void {
    builtinSources.value = items;
  }

  /**
   * Устанавливает источники, приехавшие с паками компендиума
   * @param items - определения источников из манифестов паков
   */
  function setPackSources(items: SourceDefinition[]): void {
    packSources.value = items;
  }

  /**
   * Запоминает источник, вписанный пользователем, чтобы он предлагался и в
   * следующих формах. Записи со своим источником везут его определение с собой,
   * поэтому подпись не потеряется и без этого списка — здесь копится только
   * то, что показывать в подсказках при вводе.
   *
   * @param definition - определение источника (ключ уже нормализован)
   */
  function rememberSource(definition: SourceDefinition): void {
    if (!definition.key) {
      return;
    }

    const rest = customSources.value.filter(
      (source) => source.key !== definition.key,
    );

    customSources.value = [...rest, definition];
  }

  /**
   * Устанавливает категории доспехов из серверных данных
   * @param categories - массив определений категорий
   */
  function setArmorCategories(categories: EquipmentCategoryDefinition[]): void {
    armorCategories.value = categories;
  }

  /**
   * Устанавливает базовые типы доспехов из серверных данных
   * @param baseTypes - массив определений базовых типов
   */
  function setArmorBaseTypes(baseTypes: ArmorBaseTypeDefinition[]): void {
    armorBaseTypes.value = baseTypes;
  }

  /**
   * Устанавливает свойства снаряжения из серверных данных
   * @param properties - массив определений свойств
   */
  function setEquipmentProperties(
    properties: EquipmentPropertyDefinition[],
  ): void {
    equipmentProperties.value = properties;
  }

  /**
   * Устанавливает свойства инструментов из серверных данных
   */
  function setToolProperties(properties: ToolPropertyDefinition[]): void {
    toolProperties.value = properties;
  }

  /**
   * Запоминает виды, собранные листом персонажа из компендиума: вкладка умений
   * читает по ним варианты особенностей вида. Сервер виды не присылает — их
   * знает только тот, кто открыл лист, и список живёт до следующего листа.
   *
   * @param speciesList - виды одним списком (паки компендиума мира)
   */
  function rememberSpeciesDefinitions(speciesList: SpeciesDefinition[]): void {
    speciesDefinitions.value = speciesList;
  }

  return {
    // Списки — через `computed`: снаружи их видно, но не переписать целиком
    weaponProperties: computed(() => weaponProperties.value),
    weaponBaseTypes: computed(() => weaponBaseTypes.value),
    damageTypes: computed(() => damageTypes.value),
    weaponCategories: computed(() => weaponCategories.value),
    ammunitionTypes: computed(() => ammunitionTypes.value),
    sources,
    armorCategories: computed(() => armorCategories.value),
    armorBaseTypes: computed(() => armorBaseTypes.value),
    equipmentProperties: computed(() => equipmentProperties.value),
    toolProperties: computed(() => toolProperties.value),
    speciesDefinitions: computed(() => speciesDefinitions.value),
    // Действия: первые десять зовёт слой синхронизации, два последних — окна
    setWeaponProperties,
    setWeaponBaseTypes,
    setDamageTypes,
    setWeaponCategories,
    setAmmunitionTypes,
    setSources,
    setPackSources,
    setArmorCategories,
    setArmorBaseTypes,
    setEquipmentProperties,
    setToolProperties,
    rememberSource,
    rememberSpeciesDefinitions,
  };
});
