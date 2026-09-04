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
   *
   * Саму черту выбирают в общем окне ({@link ChoicePickerField}) — там же, где
   * игрок выбирает заклинания и варианты умений, и с описанием каждой черты под
   * рукой. Описание выбранной остаётся и в шаге: ради него черту и берут.
   */
  import type { DnDActor, FeatChoice } from '@vtt/shared/system/dnd.js';

  import type { ChoicePickerOption } from '../ChoicePickerModal.vue';
  import type { CompendiumFeat } from './featApply';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';

  import ChoicePickerField from '../ChoicePickerField.vue';
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

  /** Варианты окна: категория пометкой, описание — кнопкой рядом со строкой */
  const options = computed<ChoicePickerOption[]>(() =>
    pool.value.map((feat) => ({
      value: feat.id,
      name: feat.name,
      nameEn: feat.nameEn,
      badge: feat.category,
      description: feat.description,
      repeatable: Boolean(feat.repeatable),
    })),
  );

  /** Выбранное значение списком: строка выбора работает с набором отметок */
  const selected = computed(() => (model.value ? [model.value] : []));

  const selectedFeat = computed(
    () => pool.value.find((feat) => feat.id === model.value) ?? null,
  );

  const title = computed(
    () => props.choice?.label ?? WIZARD_ASI_LABELS.featTitle,
  );

  /**
   * Записывает выбранную черту: окно отдаёт набор отметок, а черту берут одну.
   *
   * @param values - отмеченные значения
   */
  function setValue(values: string[]): void {
    model.value = values[0] ?? null;
  }
</script>

<template>
  <div
    class="flex flex-col gap-2 rounded-xl border border-default/50 bg-elevated/30 p-3"
  >
    <ChoicePickerField
      :label="title"
      :options="options"
      :selected="selected"
      :max="1"
      :empty-text="WIZARD_ASI_LABELS.featEmpty"
      @update:selected="setValue"
    />

    <ItemDescriptionRenderer
      v-if="selectedFeat"
      :content="selectedFeat.description"
      class="text-muted"
    />
  </div>
</template>
