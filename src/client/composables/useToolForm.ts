import type {
  AbilityType,
  ItemRarity,
  SourceDefinition,
  ToolCategory,
  ToolProficiencyMode,
} from '@vtt/shared';
import type {
  ActiveEffect,
  CurrencyType,
  DnDGameItem,
} from '@vtt/shared/system/dnd.js';

import { computed, ref, watch } from 'vue';

import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
import {
  DEFAULT_CURRENCY,
  FALLBACK_SOURCE_KEY,
  isDnDEffect,
  parseCost,
  TOOL_CATEGORIES,
  TOOLS_LIST,
} from '@vtt/shared/system/dnd.js';

import { useItemUsesForm } from './useItemUsesForm';

/**
 * Переключает строку в массиве свойств
 */
function toggleStringProperty(properties: string[], prop: string): void {
  const index = properties.indexOf(prop);

  if (index === -1) {
    properties.push(prop);
  } else {
    properties.splice(index, 1);
  }
}

/**
 * Composable для логики формы инструмента.
 *
 * @param getTool - функция получения текущего редактируемого инструмента
 * @param getIsOpen - функция получения флага открытости модалки
 */
export function useToolForm(
  getTool: () => DnDGameItem | null,
  getIsOpen: () => boolean,
) {
  // --- Reactive-поля формы ---
  const name = ref('');
  const nameEn = ref('');
  const description = ref('');
  const toolCategory = ref<ToolCategory>('other');
  const baseToolType = ref('');
  const weight = ref(0);
  const costValue = ref(0);
  const costCurrency = ref<CurrencyType>(DEFAULT_CURRENCY);
  const sourceKey = ref<string | undefined>(FALLBACK_SOURCE_KEY);
  const source = ref<SourceDefinition | undefined>(undefined);
  const isSRD = ref(false);
  const magicAttunement = ref<'none' | 'required' | 'optional'>('none');
  const isAttuned = ref(false);
  const rarity = ref<ItemRarity>('none');
  const selectedToolProperties = ref<string[]>([]);
  const activeEffects = ref<ActiveEffect[]>([]);
  const itemUses = useItemUsesForm();

  // Tool specific fields
  const toolBonus = ref(0);
  const toolAbility = ref<AbilityType>('dexterity');
  const toolProficiencyMode = ref<ToolProficiencyMode>('auto');

  /**
   * Магическое — вычисляемое на основе selectedToolProperties
   */
  const isMagical = computed(() =>
    selectedToolProperties.value.includes('magical'),
  );

  /**
   * Фокусирующее — вычисляемое на основе selectedToolProperties
   */
  const isFocus = computed(() =>
    selectedToolProperties.value.includes('focus'),
  );

  const systemDataStore = useSystemDataStore();

  // --- Computed-опции из systemDataStore и @vtt/shared ---

  /** Опции категорий инструментов */
  const toolCategoryOptions = computed(() => {
    return Object.entries(TOOL_CATEGORIES).map(([key, categoryName]) => ({
      label: categoryName,
      value: key,
    }));
  });

  /** Опции базовых типов инструментов (связаны с выбранной категорией) */
  const toolBaseTypeOptions = computed(() => {
    return TOOLS_LIST.filter(
      (toolItem) => toolItem.category === toolCategory.value,
    ).map((toolItem) => ({
      label: toolItem.label,
      value: toolItem.key,
    }));
  });

  /** Опции свойств инструментов */
  const toolPropertyOptions = computed(() =>
    systemDataStore.toolProperties.map((prop) => ({
      label: prop.name,
      value: prop.key,
      description: prop.description,
    })),
  );

  /**
   * Переключает свойство инструмента
   */
  function toggleToolProperty(prop: string): void {
    toggleStringProperty(selectedToolProperties.value, prop);
  }

  // Сброс базового типа при смене категории теперь выполняется в ToolFormModal (через @update:model-value)

  // --- Заполнение формы при открытии ---
  watch(
    getIsOpen,
    (open) => {
      if (!open) {
        return;
      }

      const tool = getTool();

      if (tool) {
        name.value = tool.name;
        nameEn.value = tool.nameEn ?? '';
        description.value = tool.description;
        toolCategory.value = tool.toolCategory ?? 'other';
        baseToolType.value = tool.baseToolType ?? '';
        toolBonus.value = tool.toolBonus ?? 0;
        toolAbility.value = tool.toolAbility ?? 'dexterity';
        toolProficiencyMode.value = tool.toolProficiencyMode ?? 'auto';

        weight.value = tool.weight;

        const parsed = parseCost(tool.cost);

        costValue.value = parsed.value;
        costCurrency.value = parsed.currency;
        sourceKey.value = tool.sourceKey ?? FALLBACK_SOURCE_KEY;
        source.value = tool.source;
        isSRD.value = tool.isSRD ?? false;

        // Синхронизируем свойства
        const props: string[] = [];

        if (tool.isMagical) {
          props.push('magical');
        }

        if (tool.isFocus) {
          props.push('focus');
        }

        selectedToolProperties.value = props;

        magicAttunement.value = tool.magicAttunement ?? 'none';
        isAttuned.value = tool.isAttuned ?? false;
        rarity.value = tool.rarity ?? 'none';

        activeEffects.value = [...(tool.activeEffects || [])].filter(
          isDnDEffect,
        );

        itemUses.loadItemUses(tool.uses);
      } else {
        // Дефолты для создания
        name.value = '';
        nameEn.value = '';
        description.value = '';
        toolCategory.value = 'other';
        baseToolType.value = '';
        toolBonus.value = 0;
        toolAbility.value = 'dexterity';
        toolProficiencyMode.value = 'auto';

        weight.value = 0;
        costValue.value = 0;
        costCurrency.value = DEFAULT_CURRENCY;
        sourceKey.value = FALLBACK_SOURCE_KEY;
        source.value = undefined;
        isSRD.value = false;
        selectedToolProperties.value = [];
        magicAttunement.value = 'none';
        isAttuned.value = false;
        rarity.value = 'none';
        activeEffects.value = [];
        itemUses.resetItemUses();
      }
    },
    { immediate: true },
  );

  /**
   * Собирает объект GameItem из текущих полей формы
   * @returns объект GameItem для отправки на сервер
   */
  function buildTool(): DnDGameItem {
    const tool = getTool();

    return {
      id: tool?.id ?? '',
      name: name.value,
      nameEn: nameEn.value || undefined,
      description: description.value,
      type: 'tool',
      quantity: 1,
      weight: weight.value,
      cost:
        costValue.value > 0
          ? { value: costValue.value, currency: costCurrency.value }
          : '',
      rarity: rarity.value,
      equipped: tool?.equipped ?? false,

      toolCategory: toolCategory.value,
      baseToolType: baseToolType.value || undefined,
      toolBonus: toolBonus.value > 0 ? toolBonus.value : undefined,
      toolAbility: toolAbility.value,
      toolProficiencyMode: toolProficiencyMode.value,

      sourceKey: sourceKey.value || undefined,
      source: source.value,
      isSRD: isSRD.value || undefined,
      isReadOnly: false,

      isMagical: isMagical.value || undefined,
      isFocus: isFocus.value || undefined,
      magicAttunement:
        isMagical.value && magicAttunement.value !== 'none'
          ? magicAttunement.value
          : undefined,
      isAttuned: isMagical.value && isAttuned.value ? true : undefined,
      uses: itemUses.buildItemUses(),
      activeEffects:
        activeEffects.value.length > 0 ? activeEffects.value : undefined,
    };
  }

  return {
    // Поля формы
    name,
    nameEn,
    description,
    toolCategory,
    baseToolType,
    toolBonus,
    toolAbility,
    toolProficiencyMode,
    weight,
    costValue,
    costCurrency,
    sourceKey,
    source,
    isSRD,
    isMagical,
    isFocus,
    magicAttunement,
    isAttuned,
    rarity,
    selectedToolProperties,
    activeEffects,
    ...itemUses,

    // Computed
    toolCategoryOptions,
    toolBaseTypeOptions,
    toolPropertyOptions,

    // Методы
    toggleToolProperty,
    buildTool,
  };
}
