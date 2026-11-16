<script setup lang="ts">
  import type { ProficiencyBaseType } from './utils/proficiencySelection';

  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    WEAPON_MASTERIES,
    WEAPON_MASTERY_MAP,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../stores/systemDataStore';
  import { MODAL_BUTTON_LABELS, PROFICIENCY_MODAL_LABELS } from './constants';
  import {
    filterKnownProficiencyKeys,
    isProficiencyCategorySelected,
    isProficiencyItemSelected,
    toggleProficiencyCategory,
    toggleProficiencyItem,
  } from './utils/proficiencySelection';

  interface Props {
    open: boolean;
    /** Текущие владения оружием (ключи) */
    selectedWeapons: string[];
    /** Текущие мастерства оружием (ключи) */
    selectedMasteries: string[];
    /**
     * Приёмы, которыми персонаж владеет сам по себе (ключи из `WEAPON_MASTERIES`).
     * Отдельно от {@link selectedMasteries}: там ключи ОРУЖИЯ, чей приём достался
     * персонажу, здесь — сами приёмы, безотносительно оружия.
     */
    selectedMasteryProperties: string[];
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [
      weapons: string[],
      masteries: string[],
      masteryProperties: string[],
    ];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const systemDataStore = useSystemDataStore();

  /** Локальная копия владений */
  const localWeapons = ref<Set<string>>(new Set());

  /** Локальная копия мастерств */
  const localMasteries = ref<Set<string>>(new Set());

  /** Локальная копия приёмов, которыми персонаж владеет сам по себе */
  const localMasteryProperties = ref<Set<string>>(new Set());

  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        // Устаревшие русские названия отсеиваем, а категории из даров сохраняем
        const validBaseTypeKeys = new Set(
          systemDataStore.weaponBaseTypes.map((baseType) => baseType.key),
        );

        localWeapons.value = new Set(
          filterKnownProficiencyKeys(
            props.selectedWeapons,
            systemDataStore.weaponBaseTypes,
            systemDataStore.weaponCategories.map((category) => category.key),
          ),
        );

        localMasteries.value = new Set(
          props.selectedMasteries.filter((key) => validBaseTypeKeys.has(key)),
        );

        localMasteryProperties.value = new Set(
          props.selectedMasteryProperties.filter((key) =>
            WEAPON_MASTERY_MAP.has(key),
          ),
        );
      }
    },
  );

  /** Простое оружие */
  const simpleWeapons = computed(() =>
    systemDataStore.weaponBaseTypes.filter(
      (baseType) => baseType.category === 'simple',
    ),
  );

  /** Воинское оружие */
  const martialWeapons = computed(() =>
    systemDataStore.weaponBaseTypes.filter(
      (baseType) => baseType.category === 'martial',
    ),
  );

  /**
   * Проверяет владение оружием с учётом владения всей его категорией.
   *
   * @param weapon - базовый тип оружия
   */
  function isWeaponSelected(weapon: ProficiencyBaseType): boolean {
    return isProficiencyItemSelected(localWeapons.value, weapon);
  }

  /**
   * Переключает владение конкретным оружием.
   *
   * @param weapon - базовый тип оружия
   */
  function toggleWeapon(weapon: ProficiencyBaseType): void {
    const wasSelected = isWeaponSelected(weapon);

    localWeapons.value = toggleProficiencyItem(
      localWeapons.value,
      weapon,
      systemDataStore.weaponBaseTypes.filter(
        (baseType) => baseType.category === weapon.category,
      ),
    );

    if (wasSelected) {
      // Снимаем мастерство при снятии владения
      const masteries = new Set(localMasteries.value);

      masteries.delete(weapon.key);
      localMasteries.value = masteries;
    }
  }

  /**
   * Переключает мастерство конкретным оружием (только если владеет).
   *
   * @param weapon - базовый тип оружия
   */
  function toggleMastery(weapon: ProficiencyBaseType): void {
    if (!isWeaponSelected(weapon)) {
      return;
    }

    const masteries = new Set(localMasteries.value);

    if (masteries.has(weapon.key)) {
      masteries.delete(weapon.key);
    } else {
      masteries.add(weapon.key);
    }

    localMasteries.value = masteries;
  }

  /**
   * Переключает «Все простые» / «Все воинские».
   *
   * @param category - категория оружия
   */
  function toggleAllCategory(category: 'simple' | 'martial'): void {
    const weapons =
      category === 'simple' ? simpleWeapons.value : martialWeapons.value;

    const wasSelected = isProficiencyCategorySelected(
      localWeapons.value,
      category,
      weapons,
    );

    localWeapons.value = toggleProficiencyCategory(
      localWeapons.value,
      category,
      weapons,
    );

    if (wasSelected) {
      const masteries = new Set(localMasteries.value);

      for (const weapon of weapons) {
        masteries.delete(weapon.key);
      }

      localMasteries.value = masteries;
    }
  }

  /**
   * Проверяет, выбраны ли все оружия категории явно либо её ключом.
   *
   * @param category - категория оружия
   */
  function isAllCategorySelected(category: 'simple' | 'martial'): boolean {
    const weapons =
      category === 'simple' ? simpleWeapons.value : martialWeapons.value;

    return isProficiencyCategorySelected(localWeapons.value, category, weapons);
  }

  /**
   * Переключает владение самим приёмом — без привязки к оружию.
   *
   * @param key - ключ приёма
   */
  function toggleMasteryProperty(key: string): void {
    const set = new Set(localMasteryProperties.value);

    if (set.has(key)) {
      set.delete(key);
    } else {
      set.add(key);
    }

    localMasteryProperties.value = set;
  }

  /**
   * Применяет выбранные владения, мастерства и приёмы
   */
  function applySelection(): void {
    emit(
      'apply',
      [...localWeapons.value],
      [...localMasteries.value],
      [...localMasteryProperties.value],
    );

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="600"
    :min-height="400"
    :title="PROFICIENCY_MODAL_LABELS.weaponsTitle"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="flex flex-col gap-3">
        <!-- Две колонки: Простое / Воинское -->
        <div class="grid grid-cols-2 gap-4">
          <!-- Простое оружие -->
          <div class="rounded-lg border border-default/50 bg-elevated/30 p-2">
            <div
              class="mb-2 border-b border-default/50 pb-2 text-center text-xs font-bold tracking-wider text-primary uppercase"
            >
              {{ PROFICIENCY_MODAL_LABELS.weaponsSimple }}
            </div>

            <!-- Заголовок столбцов -->
            <div
              class="mb-1 grid items-center px-1"
              style="grid-template-columns: 1fr 24px 16px; gap: 4px"
            >
              <span />

              <UTooltip :text="PROFICIENCY_MODAL_LABELS.proficient">
                <UIcon
                  name="tabler:circle-dot"
                  class="mx-auto block h-3.5 w-3.5 text-healing"
                />
              </UTooltip>

              <UTooltip :text="PROFICIENCY_MODAL_LABELS.mastery">
                <UIcon
                  name="tabler:medal"
                  class="mx-auto block h-3.5 w-3.5 text-healing"
                />
              </UTooltip>
            </div>

            <!-- {{ PROFICIENCY_MODAL_LABELS.weaponsAllSimple }} -->
            <div
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 text-sm font-semibold text-highlighted">
                {{ PROFICIENCY_MODAL_LABELS.allPrefix
                }}{{ PROFICIENCY_MODAL_LABELS.weaponsSimple }}
              </span>

              <UCheckbox
                :model-value="isAllCategorySelected('simple')"
                @update:model-value="toggleAllCategory('simple')"
              />

              <span class="h-4 w-4" />
            </div>

            <!-- Список -->
            <div
              v-for="weapon in simpleWeapons"
              :key="weapon.key"
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 truncate text-sm text-toned">
                {{ weapon.name }}
              </span>

              <UCheckbox
                :model-value="isWeaponSelected(weapon)"
                @update:model-value="toggleWeapon(weapon)"
              />

              <UCheckbox
                :model-value="localMasteries.has(weapon.key)"
                :disabled="!isWeaponSelected(weapon)"
                @update:model-value="toggleMastery(weapon)"
              />
            </div>
          </div>

          <!-- Воинское оружие -->
          <div class="rounded-lg border border-default/50 bg-elevated/30 p-2">
            <div
              class="mb-2 border-b border-default/50 pb-2 text-center text-xs font-bold tracking-wider text-danger uppercase"
            >
              {{ PROFICIENCY_MODAL_LABELS.weaponsMartial }}
            </div>

            <!-- Заголовок столбцов -->
            <div
              class="mb-1 grid items-center px-1"
              style="grid-template-columns: 1fr 24px 16px; gap: 4px"
            >
              <span />

              <UTooltip :text="PROFICIENCY_MODAL_LABELS.proficient">
                <UIcon
                  name="tabler:circle-dot"
                  class="mx-auto block h-3.5 w-3.5 text-healing"
                />
              </UTooltip>

              <UTooltip :text="PROFICIENCY_MODAL_LABELS.mastery">
                <UIcon
                  name="tabler:medal"
                  class="mx-auto block h-3.5 w-3.5 text-healing"
                />
              </UTooltip>
            </div>

            <!-- {{ PROFICIENCY_MODAL_LABELS.weaponsAllMartial }} -->
            <div
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 text-sm font-semibold text-highlighted">
                {{ PROFICIENCY_MODAL_LABELS.allPrefix
                }}{{ PROFICIENCY_MODAL_LABELS.weaponsMartial }}
              </span>

              <UCheckbox
                :model-value="isAllCategorySelected('martial')"
                @update:model-value="toggleAllCategory('martial')"
              />

              <span class="h-4 w-4" />
            </div>

            <!-- Список -->
            <div
              v-for="weapon in martialWeapons"
              :key="weapon.key"
              class="flex items-center gap-2 rounded px-1 py-0.5 transition-colors hover:bg-accented/30"
            >
              <span class="flex-1 truncate text-sm text-toned">
                {{ weapon.name }}
              </span>

              <UCheckbox
                :model-value="isWeaponSelected(weapon)"
                @update:model-value="toggleWeapon(weapon)"
              />

              <UCheckbox
                :model-value="localMasteries.has(weapon.key)"
                :disabled="!isWeaponSelected(weapon)"
                @update:model-value="toggleMastery(weapon)"
              />
            </div>
          </div>
        </div>

        <!-- Приёмы сами по себе: их даёт «Тактический мастер» и подобные
          умения, где приём не привязан к виду оружия -->
        <div class="rounded-lg border border-default/50 bg-elevated/30 p-2">
          <div
            class="mb-2 border-b border-default/50 pb-2 text-center text-xs font-bold tracking-wider text-primary uppercase"
          >
            {{ PROFICIENCY_MODAL_LABELS.masteryProperties }}
          </div>

          <div class="grid grid-cols-4 gap-1">
            <UCheckbox
              v-for="mastery in WEAPON_MASTERIES"
              :key="mastery.key"
              :model-value="localMasteryProperties.has(mastery.key)"
              :label="mastery.name.ru"
              size="sm"
              @update:model-value="toggleMasteryProperty(mastery.key)"
            />
          </div>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-1">
          <UButton
            variant="ghost"
            color="neutral"
            size="sm"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            color="primary"
            size="sm"
            @click.left.exact.prevent="applySelection"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
