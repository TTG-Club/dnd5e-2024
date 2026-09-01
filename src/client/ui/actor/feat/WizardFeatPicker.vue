<script setup lang="ts">
  /**
   * Пикер черты компендиума для выбора черты в дарах: боевой стиль умения
   * класса, черта вместо повышения характеристик, черта происхождения от дара
   * вида («Универсальность» человека) — любой выбор вида `feat`.
   *
   * Пул собирается по записи выбора: перечисленные черты — самый узкий
   * список, иначе категории, иначе правило вызывающего — набор категорий,
   * которые он не предлагает (у класса это черты происхождения, эпические и
   * боевые стили: их дают предыстория, умение 19 уровня и своё умение). Уже
   * взятые черты уходят из пула, повторяемые остаются.
   */
  import type { DnDActor, FeatChoice } from '@vtt/shared/system/dnd.js';

  import type { CompendiumFeat } from './featApply';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';

  import {
    CLASS_FEAT_DEFAULT_EXCLUDED_CATEGORIES,
    WIZARD_ASI_LABELS,
  } from '../constants';

  const props = defineProps<{
    /** Выбор черты из даров умения; null — пул по правилу листа. */
    choice: FeatChoice | null;
    /** Черты компендиума */
    feats: ReadonlyArray<CompendiumFeat>;
    /** Лист персонажа: по нему из пула уходят уже взятые черты */
    actor: DnDActor;
    /**
     * Категории, которые не предлагаются, когда выбор не назвал ни перечня, ни
     * своих категорий. По умолчанию — правило класса; мастер вида передаёт своё
     * (черта происхождения там как раз к месту).
     */
    excludedCategories?: ReadonlyArray<string>;
  }>();

  /** Ключ выбранной черты компендиума; null — не выбрана */
  const model = defineModel<string | null>({ required: true });

  /** Названия черт, уже лежащих на листе */
  const takenNames = computed(
    () =>
      new Set(
        (props.actor.features ?? [])
          .filter((feature) => feature.featureType === 'feat')
          .map((feature) => feature.name),
      ),
  );

  /** Черты, из которых выбирают: выбранная остаётся видимой всегда */
  const pool = computed(() => {
    const listed = new Set(
      (props.choice?.options ?? []).map((option) => option.value),
    );

    const categories = new Set(props.choice?.featCategories ?? []);

    const excluded =
      props.excludedCategories ?? CLASS_FEAT_DEFAULT_EXCLUDED_CATEGORIES;

    return props.feats.filter((feat) => {
      if (feat.id === model.value) {
        return true;
      }

      if (listed.size > 0) {
        if (!listed.has(feat.id)) {
          return false;
        }
      } else if (categories.size > 0) {
        if (!feat.category || !categories.has(feat.category)) {
          return false;
        }
      } else if (feat.category && excluded.includes(feat.category)) {
        return false;
      }

      return Boolean(feat.repeatable) || !takenNames.value.has(feat.name);
    });
  });

  const items = computed(() =>
    pool.value.map((feat) => ({
      label: feat.name,
      value: feat.id,
      description: feat.category ?? '',
    })),
  );

  const selected = computed(
    () => pool.value.find((feat) => feat.id === model.value) ?? null,
  );

  const title = computed(
    () => props.choice?.label ?? WIZARD_ASI_LABELS.featTitle,
  );

  /**
   * Записывает выбранную черту: селект отдаёт значение нетипизированным, а
   * очистка — пустоту.
   *
   * @param value - значение селекта
   */
  function setValue(value: unknown): void {
    model.value = typeof value === 'string' && value ? value : null;
  }
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-xl border border-default/50 bg-elevated/30 p-3"
  >
    <span class="font-medium text-highlighted">{{ title }}</span>

    <p
      v-if="pool.length === 0"
      class="text-xs text-dimmed italic"
    >
      {{ WIZARD_ASI_LABELS.featEmpty }}
    </p>

    <USelectMenu
      v-else
      :model-value="model ?? undefined"
      :items="items"
      value-key="value"
      label-key="label"
      searchable
      :placeholder="WIZARD_ASI_LABELS.featPlaceholder"
      class="w-full"
      @update:model-value="setValue"
    />

    <ItemDescriptionRenderer
      v-if="selected"
      :content="selected.description"
      class="text-muted"
    />
  </div>
</template>
