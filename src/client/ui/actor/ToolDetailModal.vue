<script setup lang="ts">
  import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import {
    ABILITY_LABELS,
    TOOL_CATEGORIES,
    TOOLS_LABELS,
  } from '@vtt/shared/system/dnd.js';

  import {
    COPY_TO_ITEMS_LABEL,
    EQUIPMENT_DETAIL_LABELS,
    FORM_FIELD_LABELS,
    TOOL_DETAIL_LABELS,
    TOOL_FORM_LABELS,
  } from './constants';
  import ItemCostWeightRarity from './ItemCostWeightRarity.vue';
  import ItemDetailModalShell from './ItemDetailModalShell.vue';
  import ItemDetailTabs from './ItemDetailTabs.vue';
  import ItemEffectsView from './ItemEffectsView.vue';
  import ItemPropertyBadges from './ItemPropertyBadges.vue';

  const props = defineProps<{
    /** Открыто ли модальное окно */
    open: boolean;
    /** Инструмент для отображения */
    item: DnDGameItem | null;
    /** Z-index модалки (управляется родителем) */
    zIndex?: number;
    /** Смещение позиции для каскадного расположения */
    positionOffset?: number;
    /** Показывать кнопку «Скопировать в предметы» (только для компендиума) */
    showCopyButton?: boolean;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Копировать в предметы */
    'copy': [];
    /** Поднять модалку наверх */
    'bring-to-front': [];
  }>();

  /** JSON-payload текущего инструмента для кнопки «Поделиться в чат» */
  const chatPayload = computed(() =>
    props.item ? JSON.stringify(props.item) : '',
  );

  /** Название характеристики для проверки */
  const abilityLabel = computed(() => {
    if (!props.item?.toolAbility) {
      return undefined;
    }

    return ABILITY_LABELS[props.item.toolAbility];
  });

  /** Название режима владения */
  const proficiencyModeLabel = computed(() => {
    if (!props.item?.toolProficiencyMode) {
      return undefined;
    }

    const map: Record<string, string> = {
      auto: TOOL_FORM_LABELS.proficiencyAuto,
      none: TOOL_FORM_LABELS.proficiencyNone,
      half: TOOL_FORM_LABELS.proficiencyHalf,
      proficient: TOOL_FORM_LABELS.proficiencyProficient,
      expertise: TOOL_FORM_LABELS.proficiencyExpertise,
    };

    return map[props.item.toolProficiencyMode];
  });

  /** Конфигурация свойств инструментов */
  const TOOL_PROPERTY_CONFIG = [
    {
      key: 'magical',
      label: EQUIPMENT_DETAIL_LABELS.magical,
      color: 'primary' as const,
      description: TOOL_DETAIL_LABELS.magicalHint,
      check: (item: DnDGameItem) => Boolean(item.isMagical),
    },
    {
      key: 'focus',
      label: EQUIPMENT_DETAIL_LABELS.focus,
      color: 'warning' as const,
      description: EQUIPMENT_DETAIL_LABELS.focusHint,
      check: (item: DnDGameItem) => Boolean(item.isFocus),
    },
  ];

  /** Активные свойства текущего инструмента */
  const activeToolProperties = computed(() => {
    if (!props.item) {
      return [];
    }

    return TOOL_PROPERTY_CONFIG.filter((property) =>
      property.check(props.item!),
    );
  });
</script>

<template>
  <ItemDetailModalShell
    :open="open"
    :title="item?.name ?? TOOL_DETAIL_LABELS.fallbackTitle"
    :subtitle="item?.nameEn || undefined"
    :source-key="item?.sourceKey"
    :source="item?.source"
    :is-srd="item?.isSRD"
    card-type="tool"
    :chat-payload="chatPayload"
    :z-index="zIndex"
    :position-offset="positionOffset"
    :show-copy-button="showCopyButton"
    :copy-tooltip="COPY_TO_ITEMS_LABEL"
    @update:open="emit('update:open', $event)"
    @copy="emit('copy')"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <ItemDetailTabs v-if="item">
        <!-- Вкладка «Основное» — характеристики, свойства и описание -->
        <template #general>
          <div class="flex flex-col gap-4">
            <!-- Основные характеристики -->
            <div class="rounded-lg border border-default/50 bg-elevated/30 p-3">
              <div class="grid grid-cols-2 gap-3 text-sm">
                <!-- Категория инструмента -->
                <div v-if="item.toolCategory">
                  <span class="text-xs text-dimmed">
                    {{ TOOL_FORM_LABELS.category }}
                  </span>

                  <p class="text-highlighted">
                    {{
                      TOOL_CATEGORIES[item.toolCategory] ?? item.toolCategory
                    }}
                  </p>
                </div>

                <!-- Базовый инструмент -->
                <div v-if="item.baseToolType">
                  <span class="text-xs text-dimmed">
                    {{ TOOL_FORM_LABELS.typeTitle }}
                  </span>

                  <p class="text-highlighted">
                    {{ TOOLS_LABELS[item.baseToolType] ?? item.baseToolType }}
                  </p>
                </div>

                <!-- Умение -->
                <div v-if="proficiencyModeLabel">
                  <span class="text-xs text-dimmed">
                    {{ TOOL_FORM_LABELS.proficiencyMode }}
                  </span>

                  <p class="text-highlighted">
                    {{ proficiencyModeLabel }}
                  </p>
                </div>

                <!-- Характеристика -->
                <div v-if="abilityLabel">
                  <span class="text-xs text-dimmed">
                    {{ FORM_FIELD_LABELS.ability }}
                  </span>

                  <p class="text-highlighted">
                    {{ abilityLabel }}
                  </p>
                </div>

                <!-- Бонус -->
                <div v-if="item.toolBonus">
                  <span class="text-xs text-dimmed">
                    {{ TOOL_FORM_LABELS.bonus }}
                  </span>

                  <p class="font-mono font-bold text-info-muted">
                    +{{ item.toolBonus }}
                  </p>
                </div>
              </div>
            </div>

            <!-- Свойства инструмента -->
            <ItemPropertyBadges :properties="activeToolProperties" />

            <!-- Описание -->
            <div v-if="item.description">
              <span
                class="mb-1.5 block text-xs font-semibold tracking-wider text-dimmed uppercase"
              >
                {{ FORM_FIELD_LABELS.description }}
              </span>

              <ItemDescriptionRenderer :content="item.description" />
            </div>

            <!-- Стоимость, Вес и Редкость -->
            <ItemCostWeightRarity
              :cost="item.cost"
              :weight="item.weight"
              :rarity="item.rarity"
            />
          </div>
        </template>

        <!-- Вкладка «Эффекты» — только просмотр -->
        <template #effects>
          <ItemEffectsView
            :effects="item.activeEffects ?? []"
            :owner-name="item.name"
          />
        </template>
      </ItemDetailTabs>
    </template>
  </ItemDetailModalShell>
</template>
