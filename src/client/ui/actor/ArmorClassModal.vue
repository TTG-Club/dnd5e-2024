<script setup lang="ts">
  import type { ActorArmorClass } from '@vtt/shared';
  import type {
    DnDCustomBonus,
    DnDCustomBonusContext,
  } from '@vtt/shared/system/dnd.js';

  import { computed, reactive, ref, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';
  import {
    BASE_UNARMORED_AC,
    getCustomBonusesValue,
    toStoredCustomBonus,
  } from '@vtt/shared/system/dnd.js';

  import {
    ARMOR_CALCULATION_LABELS,
    ARMOR_CALCULATION_OPTIONS,
    ARMOR_CLASS_SETTINGS_LABELS,
    MODAL_BUTTON_LABELS,
    NATURAL_ARMOR_FORMULA,
    SHEET_TILE_LABELS,
  } from './constants';
  import CustomBonusRows from './CustomBonusRows.vue';
  import { formatSignedNumber } from './utils/formatSignedNumber';

  interface Props {
    open: boolean;
    armorClass: ActorArmorClass;
    /** Свои бонусы к КД листа */
    bonuses?: DnDCustomBonus[];
    /** Числа листа, от которых считается вклад своих бонусов */
    context: DnDCustomBonusContext;
    /** Модификатор ловкости актора (для превью AC) */
    dexModifier: number;
    /** Флаг существа: природная броня не прибавляет модификатор ловкости */
    isCreatureMode?: boolean;
  }

  const props = withDefaults(defineProps<Props>(), { bonuses: () => [] });

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [
      payload: { armorClass: ActorArmorClass; bonuses: DnDCustomBonus[] },
    ];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /**
   * Выбор способа расчёта — из общего списка способов листа. У существа способ
   * «по умолчанию» подписан своим словом: там он включает расчёт от инвентаря,
   * которого у монстра до этого выбора не было вовсе.
   */
  const calculationOptions = computed(() =>
    ARMOR_CALCULATION_OPTIONS.map((value) => ({
      value,
      label:
        props.isCreatureMode && value === 'default'
          ? ARMOR_CLASS_SETTINGS_LABELS.defaultCreatureLabel
          : ARMOR_CALCULATION_LABELS[value],
    })),
  );

  /** Пояснение расчёта «по умолчанию»: у существа оно про инвентарь */
  const defaultCalculationHint = computed(() =>
    props.isCreatureMode
      ? ARMOR_CLASS_SETTINGS_LABELS.defaultCreatureHint
      : ARMOR_CLASS_SETTINGS_LABELS.defaultHint,
  );

  const editArmorClass = reactive<ActorArmorClass>({
    value: 10,
    calculation: 'default',
    formula: '',
    flat: null,
  });

  const draftBonuses = ref<DnDCustomBonus[]>([]);

  // При открытии — подставляем текущие значения. Бонусы копируются: окно
  // остаётся открытым до «Применить», и его правки не должны трогать лист.
  //
  // Способ расчёта подставляется ЯВНО, а не через `Object.assign`: тот не
  // перезаписывает отсутствующий ключ, и у записи без `calculation` в черновике
  // осталось бы засеянное `'default'`. У существа это уже не безобидно —
  // «по умолчанию» означает «считать КД от снаряжения», и одно открытие окна с
  // «Применить» молча увело бы монстра со статблочного КД на расчётный.
  watch(
    () => props.open,
    (opened) => {
      if (opened) {
        // Блок класса доспеха приезжает из записи мира: у существа компендиума
        // и у листа старого мира его может не быть вовсе
        const armorClass: Partial<ActorArmorClass> = props.armorClass ?? {};

        Object.assign(editArmorClass, armorClass);

        editArmorClass.calculation =
          armorClass.calculation ?? (props.isCreatureMode ? 'flat' : 'default');

        draftBonuses.value = props.bonuses.map((bonus) => ({ ...bonus }));
      }
    },
  );

  // При смене типа расчёта — сбрасываем value на корректное значение
  watch(
    () => editArmorClass.calculation,
    (newCalc, oldCalc) => {
      if (newCalc === oldCalc) {
        return;
      }

      if (newCalc === 'default') {
        // Для «По умолчанию» value фиксирован = 10 (формула 10 + DEX)
        editArmorClass.value = 10;
      }
    },
  );

  /** Модификатор Ловкости со знаком — он стоит в обеих подсказках расчёта */
  const formattedDexModifier = computed(() =>
    formatSignedNumber(props.dexModifier),
  );

  /** Пояснение природной брони: у существа модификатор уже вшит в число */
  const naturalArmorHint = computed(() =>
    props.isCreatureMode
      ? ARMOR_CLASS_SETTINGS_LABELS.naturalCreatureHint
      : ARMOR_CLASS_SETTINGS_LABELS.naturalHint,
  );

  /** Стоит ли у фиксированного КД приписка «природный доспех» */
  const isNaturalArmorMark = computed(
    () => editArmorClass.formula === NATURAL_ARMOR_FORMULA,
  );

  /**
   * Ставит и снимает приписку природной брони.
   *
   * @param marked - отмечена ли галочка
   */
  function setNaturalArmorMark(marked: boolean): void {
    editArmorClass.formula = marked ? NATURAL_ARMOR_FORMULA : '';
  }

  /** Вклад своих бонусов черновика — он идёт поверх любого расчёта */
  const bonusValue = computed(() =>
    getCustomBonusesValue(props.context, draftBonuses.value),
  );

  /**
   * Превью итогового AC (с учётом формулы) для отображения в шапке модалки
   */
  const previewAC = computed(() => {
    const base = (() => {
      switch (editArmorClass.calculation) {
        case 'default':
          return BASE_UNARMORED_AC + props.dexModifier;
        case 'natural':
          return props.isCreatureMode
            ? editArmorClass.value
            : editArmorClass.value + props.dexModifier;
        case 'flat':
          return editArmorClass.value;
        default:
          return editArmorClass.value;
      }
    })();

    return base + bonusValue.value;
  });

  /**
   * Применяет изменения класса доспеха
   */
  function applyArmorClass() {
    emit('apply', {
      armorClass: { ...editArmorClass },
      bonuses: draftBonuses.value.map(toStoredCustomBonus),
    });

    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="440"
    :min-height="280"
    :title="SHEET_TILE_LABELS.armorClass"
    :z-index="Z_INDEX.MODAL_ELEVATED"
  >
    <template #body>
      <div class="space-y-4">
        <!-- Текущее значение КД (превью) -->
        <div class="text-center">
          <span class="text-4xl font-bold text-highlighted tabular-nums">{{
            previewAC
          }}</span>
        </div>

        <!-- Разделитель -->
        <div class="border-t border-muted" />

        <!-- Формула -->
        <div class="space-y-3">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
            >{{ ARMOR_CLASS_SETTINGS_LABELS.formulaTitle }}</span
          >

          <!-- Тип расчёта -->
          <div class="flex items-center gap-3">
            <span class="w-28 text-sm text-toned">
              {{ ARMOR_CLASS_SETTINGS_LABELS.calculation }}
            </span>

            <USelect
              v-model="editArmorClass.calculation"
              :items="calculationOptions"
              value-key="value"
              label-key="label"
              class="flex-1"
            />
          </div>

          <!-- Значение — по умолчанию -->
          <div
            v-if="editArmorClass.calculation === 'default'"
            class="rounded border border-info-border/30 bg-info-subtle/10 px-3 py-2"
          >
            <div class="flex items-center gap-2 text-sm text-toned">
              <span class="font-mono text-lg font-bold text-info-muted">
                {{ BASE_UNARMORED_AC }}
              </span>

              <span class="text-muted">
                + {{ ARMOR_CLASS_SETTINGS_LABELS.dexPart }} ({{
                  formattedDexModifier
                }})
              </span>
            </div>

            <p class="mt-1 text-xs leading-relaxed text-dimmed">
              {{ defaultCalculationHint }}
            </p>
          </div>

          <!-- Значение — природная броня -->
          <div
            v-else-if="editArmorClass.calculation === 'natural'"
            class="space-y-2"
          >
            <div class="flex items-center gap-3">
              <span class="w-28 text-sm text-toned">
                {{ ARMOR_CLASS_SETTINGS_LABELS.naturalBase }}
              </span>

              <UInput
                :model-value="editArmorClass.value"
                type="number"
                :min="0"
                size="sm"
                class="flex-1"
                @update:model-value="editArmorClass.value = Number($event)"
              />
            </div>

            <div
              class="rounded border border-success/30 bg-success-subtle/10 px-3 py-2"
            >
              <div class="flex items-center gap-2 text-sm text-toned">
                <span class="font-mono text-lg font-bold text-healing">
                  {{ editArmorClass.value }}
                </span>

                <span
                  v-if="!isCreatureMode"
                  class="text-muted"
                >
                  + {{ ARMOR_CLASS_SETTINGS_LABELS.dexPart }} ({{
                    formattedDexModifier
                  }})
                </span>
              </div>

              <p class="mt-1 text-xs leading-relaxed text-dimmed">
                {{ naturalArmorHint }}
              </p>
            </div>
          </div>

          <!-- Значение — фиксированный -->
          <div
            v-else
            class="space-y-2"
          >
            <div class="flex items-center gap-3">
              <span class="w-28 text-sm text-toned">
                {{ ARMOR_CLASS_SETTINGS_LABELS.flatValue }}
              </span>

              <UInput
                :model-value="editArmorClass.value"
                type="number"
                :min="0"
                size="sm"
                class="flex-1"
                @update:model-value="editArmorClass.value = Number($event)"
              />
            </div>

            <div class="flex items-center gap-3 py-1">
              <UCheckbox
                :model-value="isNaturalArmorMark"
                :label="ARMOR_CLASS_SETTINGS_LABELS.naturalMark"
                @update:model-value="setNaturalArmorMark"
              />
            </div>

            <p class="text-[11px] leading-relaxed text-dimmed">
              {{ ARMOR_CLASS_SETTINGS_LABELS.flatHint }}
            </p>
          </div>
        </div>

        <!-- Разделитель -->
        <div class="border-t border-muted" />

        <!-- Свои бонусы: идут поверх любого расчёта, поэтому стоят отдельным
          разделом, а не внутри ветки формулы -->
        <div class="space-y-3">
          <span
            class="text-[10px] font-bold tracking-wider text-muted uppercase"
          >
            {{ ARMOR_CLASS_SETTINGS_LABELS.bonusesTitle }}
          </span>

          <CustomBonusRows
            v-model="draftBonuses"
            :context="context"
          />

          <p class="text-xs leading-relaxed text-dimmed">
            {{ ARMOR_CLASS_SETTINGS_LABELS.bonusesHint }}
          </p>
        </div>

        <!-- Кнопки -->
        <div class="flex justify-end gap-2 pt-2">
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
            @click.left.exact.prevent="applyArmorClass"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
