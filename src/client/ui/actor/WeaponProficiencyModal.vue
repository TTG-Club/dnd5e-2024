<script setup lang="ts">
  import { computed, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import { useSystemDataStore } from '@/systems/dnd5e/stores/systemDataStore';
  import {
    WEAPON_MASTERIES,
    WEAPON_MASTERY_MAP,
  } from '@vtt/shared/system/dnd.js';

  import { MODAL_BUTTON_LABELS, PROFICIENCY_MODAL_LABELS } from './constants';

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
        // Отсеиваем устаревшие ключи (русские названия из старого формата)
        const validKeys = new Set(
          systemDataStore.weaponBaseTypes.map((bt) => bt.key),
        );

        localWeapons.value = new Set(
          props.selectedWeapons.filter((key) => validKeys.has(key)),
        );

        localMasteries.value = new Set(
          props.selectedMasteries.filter((key) => validKeys.has(key)),
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
    systemDataStore.weaponBaseTypes.filter((bt) => bt.category === 'simple'),
  );

  /** Воинское оружие */
  const martialWeapons = computed(() =>
    systemDataStore.weaponBaseTypes.filter((bt) => bt.category === 'martial'),
  );

  /**
   * Переключает владение конкретным оружием
   * @param key - ключ оружия
   */
  function toggleWeapon(key: string): void {
    const set = new Set(localWeapons.value);

    if (set.has(key)) {
      set.delete(key);

      // Снимаем мастерство при снятии владения
      const masteries = new Set(localMasteries.value);

      masteries.delete(key);
      localMasteries.value = masteries;
    } else {
      set.add(key);
    }

    localWeapons.value = set;
  }

  /**
   * Переключает мастерство конкретным оружием (только если владеет)
   * @param key - ключ оружия
   */
  function toggleMastery(key: string): void {
    if (!localWeapons.value.has(key)) {
      return;
    }

    const set = new Set(localMasteries.value);

    if (set.has(key)) {
      set.delete(key);
    } else {
      set.add(key);
    }

    localMasteries.value = set;
  }

  /**
   * Переключает «{{ PROFICIENCY_MODAL_LABELS.weaponsAllSimple }}» / «{{ PROFICIENCY_MODAL_LABELS.weaponsAllMartial }}»
   * @param category - 'simple' | 'martial'
   */
  function toggleAllCategory(category: 'simple' | 'martial'): void {
    const weapons =
      category === 'simple' ? simpleWeapons.value : martialWeapons.value;

    const allKeys = weapons.map((weapon) => weapon.key);
    const set = new Set(localWeapons.value);
    const allSelected = allKeys.every((key) => set.has(key));

    if (allSelected) {
      // Убрать все
      const masteries = new Set(localMasteries.value);

      for (const key of allKeys) {
        set.delete(key);
        masteries.delete(key);
      }

      localWeapons.value = set;
      localMasteries.value = masteries;
    } else {
      // Добавить все
      for (const key of allKeys) {
        set.add(key);
      }

      localWeapons.value = set;
    }
  }

  /**
   * Проверяет, выбраны ли все оружия категории
   */
  function isAllCategorySelected(category: 'simple' | 'martial'): boolean {
    const weapons =
      category === 'simple' ? simpleWeapons.value : martialWeapons.value;

    return weapons.every((weapon) => localWeapons.value.has(weapon.key));
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
                :model-value="localWeapons.has(weapon.key)"
                @update:model-value="toggleWeapon(weapon.key)"
              />

              <UCheckbox
                :model-value="localMasteries.has(weapon.key)"
                :disabled="!localWeapons.has(weapon.key)"
                @update:model-value="toggleMastery(weapon.key)"
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
                :model-value="localWeapons.has(weapon.key)"
                @update:model-value="toggleWeapon(weapon.key)"
              />

              <UCheckbox
                :model-value="localMasteries.has(weapon.key)"
                :disabled="!localWeapons.has(weapon.key)"
                @update:model-value="toggleMastery(weapon.key)"
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
