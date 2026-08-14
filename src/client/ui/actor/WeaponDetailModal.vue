<script setup lang="ts">
  import type { DnDGameItem } from '@vtt/shared/system/dnd.js';

  import type { ItemPropertyBadge } from './ItemPropertyBadges.vue';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
  import { DISTANCE_UNIT_SHORT } from '@vtt/shared';
  import {
    getWeaponDamageParts,
    WEAPON_MASTERY_MAP,
  } from '@vtt/shared/system/dnd.js';

  import { DICE_LETTER_REPLACEMENT } from '../chat/consts';
  import {
    COPY_TO_ITEMS_LABEL,
    FORM_FIELD_LABELS,
    WEAPON_DETAIL_LABELS,
    WEAPON_FORM_LABELS,
  } from './constants';
  import DamagePartsSummary from './DamagePartsSummary.vue';
  import ItemCostWeightRarity from './ItemCostWeightRarity.vue';
  import ItemDetailModalShell from './ItemDetailModalShell.vue';
  import ItemDetailTabs from './ItemDetailTabs.vue';
  import ItemEffectsView from './ItemEffectsView.vue';
  import ItemPropertyBadges from './ItemPropertyBadges.vue';

  const props = defineProps<{
    /** Открыто ли модальное окно */
    open: boolean;
    /** Оружие для отображения */
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

  const systemDataStore = useSystemDataStore();

  /** JSON-payload текущего оружия для кнопки «Поделиться в чат» */
  const chatPayload = computed(() =>
    props.item ? JSON.stringify(props.item) : '',
  );

  /** Части урона оружия (read-only сводка через общий DamagePartsSummary) */
  const weaponDamageParts = computed(() =>
    props.item ? getWeaponDamageParts(props.item) : [],
  );

  /** Versatile-формула первой части (двуручный хват), если задана */
  const versatileFormula = computed(
    () => props.item?.damageParts?.[0]?.versatileFormula,
  );

  /** Карта key → definition для названия и описания свойства оружия */
  const propertyMap = computed(() => {
    const map = new Map<string, { name: string; description: string }>();

    for (const property of systemDataStore.weaponProperties) {
      map.set(property.key, {
        name: property.name,
        description: property.description,
      });
    }

    return map;
  });

  /** Свойства оружия в формате общего компонента бейджей */
  const weaponPropertyBadges = computed<ItemPropertyBadge[]>(() =>
    (props.item?.weaponProperties ?? []).map((property) => ({
      key: property,
      label: propertyMap.value.get(property)?.name ?? property,
      color: 'primary',
      description: propertyMap.value.get(property)?.description ?? '',
    })),
  );

  /** Карта key → name для категорий оружия */
  const weaponCategoryMap = computed(() => {
    const map = new Map<string, string>();

    for (const category of systemDataStore.weaponCategories) {
      map.set(category.key, category.name);
    }

    return map;
  });

  /** Карта key → name для базовых типов оружия */
  const baseTypeMap = computed(() => {
    const map = new Map<string, string>();

    for (const baseType of systemDataStore.weaponBaseTypes) {
      map.set(baseType.key, baseType.name);
    }

    return map;
  });

  /** Карта key → name для типов боеприпасов */
  const ammunitionTypeMap = computed(() => {
    const map = new Map<string, string>();

    for (const ammunition of systemDataStore.ammunitionTypes) {
      map.set(ammunition.key, ammunition.name);
    }

    return map;
  });

  /** Детали оружейного приёма текущего оружия */
  const masteryDetail = computed(() => {
    const key = props.item?.mastery;

    if (!key) {
      return undefined;
    }

    return WEAPON_MASTERY_MAP.get(key);
  });
</script>

<template>
  <ItemDetailModalShell
    :open="open"
    :title="item?.name ?? WEAPON_DETAIL_LABELS.fallbackTitle"
    :subtitle="item?.nameEn || undefined"
    :source-key="item?.sourceKey"
    :source="item?.source"
    :is-srd="item?.isSRD"
    card-type="equipment"
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
                <!-- Урон / Лечение (части) — общий со заклинаниями компонент -->
                <DamagePartsSummary :parts="weaponDamageParts" />

                <!-- {{ WEAPON_DETAIL_LABELS.attackBonus }} -->
                <div>
                  <span class="text-xs text-dimmed">{{
                    WEAPON_DETAIL_LABELS.attackBonus
                  }}</span>

                  <p class="text-highlighted">+{{ item.attackBonus ?? 0 }}</p>
                </div>

                <!-- Универсальное -->
                <div v-if="versatileFormula">
                  <span class="text-xs text-dimmed">{{
                    WEAPON_DETAIL_LABELS.versatile
                  }}</span>

                  <p class="flex items-center gap-1.5 text-highlighted">
                    <span class="font-mono font-semibold">{{
                      versatileFormula.replace(
                        /(\d+)d(\d+)/gi,
                        DICE_LETTER_REPLACEMENT,
                      )
                    }}</span>
                  </p>
                </div>

                <!-- {{ WEAPON_DETAIL_LABELS.range }} -->
                <div v-if="item.range">
                  <span class="text-xs text-dimmed">{{
                    WEAPON_DETAIL_LABELS.range
                  }}</span>

                  <p class="text-highlighted">
                    {{ item.range.normal }}
                    <span v-if="item.range.long">/{{ item.range.long }}</span>
                    {{ DISTANCE_UNIT_SHORT[item.distanceUnit ?? 'ft'] }}
                  </p>
                </div>

                <!-- {{ WEAPON_DETAIL_LABELS.category }} -->
                <div>
                  <span class="text-xs text-dimmed">{{
                    WEAPON_DETAIL_LABELS.category
                  }}</span>

                  <p class="text-highlighted">
                    {{
                      weaponCategoryMap.get(item.weaponCategory ?? 'simple')
                      ?? item.weaponCategory
                    }}
                  </p>
                </div>

                <!-- Базовый тип -->
                <div v-if="item.baseType">
                  <span class="text-xs text-dimmed">{{
                    WEAPON_DETAIL_LABELS.weaponType
                  }}</span>

                  <p class="text-highlighted">
                    {{ baseTypeMap.get(item.baseType) ?? item.baseType }}
                  </p>
                </div>

                <!-- {{ WEAPON_DETAIL_LABELS.ammunition }} -->
                <div v-if="item.ammunitionType">
                  <span class="text-xs text-dimmed">{{
                    WEAPON_DETAIL_LABELS.ammunition
                  }}</span>

                  <p class="text-highlighted">
                    {{
                      ammunitionTypeMap.get(item.ammunitionType)
                      ?? item.ammunitionType
                    }}
                  </p>
                </div>

                <!-- {{ WEAPON_FORM_LABELS.mastery }} -->
                <div v-if="item.mastery && masteryDetail">
                  <span class="block text-xs text-dimmed">{{
                    WEAPON_FORM_LABELS.mastery
                  }}</span>

                  <UPopover
                    mode="hover"
                    :ui="{ content: 'max-w-xs p-3' }"
                  >
                    <UBadge
                      color="warning"
                      variant="subtle"
                      size="sm"
                      class="mt-1 cursor-help"
                    >
                      {{ masteryDetail.name.ru }} ({{ masteryDetail.name.en }})
                    </UBadge>

                    <template #content>
                      <p class="text-xs leading-relaxed text-toned">
                        {{ masteryDetail.description.ru }}
                      </p>
                    </template>
                  </UPopover>
                </div>
              </div>
            </div>

            <!-- Свойства оружия -->
            <ItemPropertyBadges :properties="weaponPropertyBadges" />

            <!-- {{ WEAPON_DETAIL_LABELS.special }} -->
            <div
              v-if="item.special"
              class="rounded-lg border border-default/50 bg-elevated/30 p-3"
            >
              <span
                class="mb-1.5 block text-xs font-semibold tracking-wider text-dimmed uppercase"
              >
                {{ WEAPON_DETAIL_LABELS.special }}
              </span>

              <p class="text-sm leading-relaxed text-toned">
                {{ item.special }}
              </p>
            </div>

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
