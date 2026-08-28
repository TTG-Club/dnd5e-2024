<script setup lang="ts">
  import type { FeatChoiceOption } from '@vtt/shared/system/dnd.js';

  import type { EditableGrantRow, GrantRowKind } from './featEditorTypes';

  import { computed } from 'vue';

  import { generateId } from '@vtt/shared';
  import { getFeatChoiceDefaultPool } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import {
    ARMOR_PROF_LABELS,
    CHOICE_COUNT_MAX,
    CLASS_LEVEL_MAX,
    FEAT_GRANTS_LABELS,
    WEAPON_PROF_LABELS,
  } from '../constants';
  import FieldHint from '../FieldHint.vue';
  import FormSection from '../FormSection.vue';
  import {
    createGrantRow,
    GRANT_ROW_KIND_OPTIONS,
    hasKind,
    isMixableKind,
    primaryKind,
  } from './featEditorTypes';
  import GrantOptionRows from './GrantOptionRows.vue';

  /**
   * Редактор даров черты: одна строка — одно, что черта даёт. Режим строки
   * решает, выдаётся ли всё перечисленное сразу или игрок выбирает из набора:
   * механика у этого одна, и разводить их по разным вкладкам значило бы дважды
   * описывать одно и то же.
   *
   * Наборы значений берутся из того же `getFeatChoiceDefaultPool`, которым лист
   * потом собирает пул выбора, — свои списки в окне разошлись бы с тем, что
   * увидит игрок. Виды оружия справочником правил не описаны и приходят из
   * данных мира.
   */
  const rows = defineModel<EditableGrantRow[]>({ required: true });

  const props = withDefaults(
    defineProps<{
      /**
       * Скрыть вид «Характеристика»: у предыстории повышение выдаётся
       * каноническим полем, и здесь оно применилось бы вторым.
       */
      hideAbility?: boolean;
      /** Скрыть вид «Навык» — у предыстории навыки тоже канонические. */
      hideSkill?: boolean;
      /**
       * Ключи выборов, уже занятые чертой (включая вкладку заклинаний): все
       * выборы лежат в одном списке блоба, и ключ обязан быть уникальным.
       */
      takenKeys?: string[];
    }>(),
    { hideAbility: false, hideSkill: false, takenKeys: () => [] },
  );

  const systemDataStore = useSystemDataStore();

  const modeOptions = [
    { value: 'all', label: FEAT_GRANTS_LABELS.modeAll },
    { value: 'choice', label: FEAT_GRANTS_LABELS.modeChoice },
  ];

  const grantsOptions = [
    { value: 'proficiency', label: FEAT_GRANTS_LABELS.grantsProficiency },
    { value: 'expertise', label: FEAT_GRANTS_LABELS.grantsExpertise },
  ];

  /** Виды дара, доступные в этой форме. */
  const kindOptions = computed(() =>
    GRANT_ROW_KIND_OPTIONS.filter(
      (option) =>
        !(props.hideAbility && option.value === 'ability')
        && !(props.hideSkill && option.value === 'skill'),
    ),
  );

  /** Виды оружия мира — общий набор для владения оружием и для приёмов. */
  const weaponOptions = computed<FeatChoiceOption[]>(() =>
    systemDataStore.weaponBaseTypes.map((baseType) => ({
      value: baseType.key,
      name: baseType.name,
    })),
  );

  /** Категории оружия («простое», «воинское») — ими задают владение оптом. */
  const weaponCategoryOptions: FeatChoiceOption[] = [
    { value: 'simple', name: WEAPON_PROF_LABELS.simple },
    { value: 'martial', name: WEAPON_PROF_LABELS.martial },
  ];

  const armorOptions: FeatChoiceOption[] = Object.entries(
    ARMOR_PROF_LABELS,
  ).map(([value, name]) => ({ value, name }));

  /**
   * Набор значений для вида дара. Правила знают навыки, характеристики,
   * инструменты, языки и типы урона; доспехи и оружие — данные мира.
   *
   * @param kind - вид дара
   */
  function poolFor(kind: GrantRowKind): FeatChoiceOption[] {
    if (kind === 'armor') {
      return armorOptions;
    }

    if (kind === 'weapon') {
      return [...weaponCategoryOptions, ...weaponOptions.value];
    }

    if (kind === 'weaponMastery') {
      return weaponOptions.value;
    }

    return getFeatChoiceDefaultPool(kind);
  }

  /**
   * Склеенный набор строки: у смешанной строки виды идут подряд, повторов нет.
   *
   * @param row - строка дара
   */
  function poolForRow(row: EditableGrantRow): FeatChoiceOption[] {
    const seen = new Set<string>();
    const merged: FeatChoiceOption[] = [];

    for (const kind of row.kinds) {
      for (const option of poolFor(kind)) {
        if (seen.has(option.value)) {
          continue;
        }

        seen.add(option.value);
        merged.push(option);
      }
    }

    return merged;
  }

  /** Есть ли у строки готовый набор (иначе варианты вписывают руками). */
  function hasPool(row: EditableGrantRow): boolean {
    return poolForRow(row).length > 0;
  }

  /**
   * Виды, у которых фиксированной выдачи не бывает: тип урона задаётся
   * защитой на вкладке «Автоматизация», а «вариант» без выбора смысла не имеет.
   */
  function isChoiceOnlyKind(kind: GrantRowKind): boolean {
    return kind === 'damageType' || kind === 'option';
  }

  /** Виды, дающие владение: от них зависят настройки владения у строки. */
  const PROFICIENCY_KINDS: ReadonlySet<GrantRowKind> = new Set([
    'skill',
    'savingThrow',
    'tool',
    'language',
    'weapon',
    'weaponMastery',
    'armor',
  ]);

  /** Даёт ли строка владение — хотя бы одним из своих видов. */
  function isProficiencyRow(row: EditableGrantRow): boolean {
    return row.kinds.some((kind) => PROFICIENCY_KINDS.has(kind));
  }

  /** Только выбор — если хотя бы один вид строки фиксированной выдачи не знает. */
  function isChoiceOnlyRow(row: EditableGrantRow): boolean {
    return row.kinds.some(isChoiceOnlyKind);
  }

  /** Отмеченные значения строки. */
  function selectedValues(row: EditableGrantRow): string[] {
    return row.options.map((option) => option.value);
  }

  /**
   * Записывает отмеченные значения: подпись берётся из набора, иначе на
   * кнопках игрока окажется «charisma».
   *
   * @param row - строка дара
   * @param values - отмеченные значения
   */
  function setValues(row: EditableGrantRow, values: string[]): void {
    const names = new Map(
      poolForRow(row).map((option) => [option.value, option.name]),
    );

    row.options = values.map((value) => ({ value, name: names.get(value) }));
  }

  /**
   * Смена вида сбрасывает набор: значения заданы в словаре прежнего вида и в
   * новом означали бы не то (навык «Проницательность» среди языков).
   *
   * @param row - строка дара
   * @param kind - новый вид
   */
  function setKinds(row: EditableGrantRow, kinds: GrantRowKind[]): void {
    const next = kinds.length > 0 ? kinds : [primaryKind(row)];

    // Несмешиваемый вид живёт в строке один: значения оружия и «варианта» по
    // справочнику не разложить, и в общем наборе они стали бы неразличимы
    row.kinds = next.some((kind) => !isMixableKind(kind))
      ? [next[next.length - 1]]
      : next;

    row.options = [];

    if (isChoiceOnlyRow(row)) {
      row.mode = 'choice';
    }

    if (hasKind(row, 'ability')) {
      row.abilityAmount = row.abilityAmount || 1;
      row.abilityUpto = row.abilityUpto || 20;
    } else {
      row.abilityAmount = 0;
      row.abilityUpto = 0;
    }
  }

  function addRow(): void {
    const kind = kindOptions.value[0]?.value ?? 'skill';

    rows.value = [
      ...rows.value,
      createGrantRow(kind, new Set(props.takenKeys)),
    ];
  }

  function removeRow(index: number): void {
    rows.value = rows.value.filter((_, rowIndex) => rowIndex !== index);
  }

  /**
   * Заводит ступень роста: следующая начинается уровнем позже последней и даёт
   * на один выбор больше.
   *
   * @param row - строка дара
   */
  function addScaling(row: EditableGrantRow): void {
    const last = row.scaling.at(-1);

    row.scaling = [
      ...row.scaling,
      {
        uid: generateId('choice-step'),
        level: Math.min(CLASS_LEVEL_MAX, (last?.level ?? 0) + 1),
        count: Math.min(CHOICE_COUNT_MAX, (last?.count ?? row.count) + 1),
      },
    ];
  }

  /**
   * Убирает ступень роста.
   *
   * @param row - строка дара
   * @param index - номер ступени
   */
  function removeScaling(row: EditableGrantRow, index: number): void {
    row.scaling = row.scaling.filter((_, stepIndex) => stepIndex !== index);
  }

  /**
   * Отмеченные виды одной строкой. Несколько читаются как «или»: игрок выбирает
   * из общей кучи, а не получает всё перечисленное.
   *
   * @param row - строка дара
   */
  function kindsLabel(row: EditableGrantRow): string {
    return row.kinds
      .map(
        (value) =>
          GRANT_ROW_KIND_OPTIONS.find((option) => option.value === value)?.label
          ?? value,
      )
      .join(FEAT_GRANTS_LABELS.kindSeparator);
  }

  /** Заголовок строки: что даётся и как. */
  function rowTitle(row: EditableGrantRow): string {
    const kind = row.kinds
      .map(
        (value) =>
          GRANT_ROW_KIND_OPTIONS.find((option) => option.value === value)?.label
          ?? value,
      )
      .join(FEAT_GRANTS_LABELS.kindSeparator);

    const mode =
      row.mode === 'all'
        ? FEAT_GRANTS_LABELS.modeAll
        : FEAT_GRANTS_LABELS.modeChoice;

    return `${kind} — ${mode.toLowerCase()}`;
  }
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="flex items-center gap-1 text-xs text-dimmed">
      {{ FEAT_GRANTS_LABELS.grantsHint }}
      <FieldHint :text="FEAT_GRANTS_LABELS.grantsHintDetails" />
    </p>

    <div
      v-if="rows.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ FEAT_GRANTS_LABELS.grantsEmpty }}
    </div>

    <template
      v-for="(row, index) in rows"
      :key="row.uid"
    >
      <!-- Строки складываются: черта даёт всё перечисленное разом -->
      <div
        v-if="index > 0"
        class="flex items-center gap-2 px-1"
      >
        <span class="h-px flex-1 bg-accented/40" />

        <span class="text-xs font-semibold tracking-wider text-dimmed">
          {{ FEAT_GRANTS_LABELS.rowsAnd }}
        </span>

        <span class="h-px flex-1 bg-accented/40" />
      </div>

      <FormSection
        :title="rowTitle(row)"
        icon="tabler:gift-filled"
      >
        <template #actions>
          <UButton
            icon="tabler:trash"
            color="error"
            variant="ghost"
            size="xs"
            :aria-label="rowTitle(row)"
            @click.left.exact.prevent="removeRow(index)"
          />
        </template>

        <div class="flex flex-col gap-2">
          <!-- Поля строки в одну линию. Подсказка про второй вид вынесена ПОД
            строку: внутри ячейки она распирала её, и соседние поля съезжали
            вниз на её высоту -->
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-end gap-2">
              <UFormField class="min-w-56 flex-1">
                <template #label>
                  <span class="flex items-center gap-1">
                    {{ FEAT_GRANTS_LABELS.kind }}
                    <FieldHint :text="FEAT_GRANTS_LABELS.kindHint" />
                  </span>
                </template>

                <USelectMenu
                  :model-value="row.kinds"
                  :items="kindOptions"
                  value-key="value"
                  label-key="label"
                  multiple
                  class="w-full"
                  @update:model-value="setKinds(row, $event)"
                >
                  <!-- Отмеченные виды читаются как «или»: выбирают из общей кучи -->
                  <span class="truncate">{{ kindsLabel(row) }}</span>
                </USelectMenu>
              </UFormField>

              <UFormField class="w-40 shrink-0">
                <template #label>
                  <span class="flex items-center gap-1">
                    {{ FEAT_GRANTS_LABELS.mode }}
                    <FieldHint :text="FEAT_GRANTS_LABELS.modeHint" />
                  </span>
                </template>

                <USelect
                  v-model="row.mode"
                  :items="modeOptions"
                  value-key="value"
                  label-key="label"
                  :disabled="isChoiceOnlyRow(row)"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="row.mode === 'choice'"
                :label="FEAT_GRANTS_LABELS.count"
                class="w-24 shrink-0"
              >
                <UInputNumber
                  v-model="row.count"
                  :min="1"
                  :max="10"
                  :disabled="row.countEqualsProficiencyBonus"
                  class="w-full"
                />
              </UFormField>

              <div
                v-if="row.mode === 'choice'"
                class="mb-2 flex shrink-0 items-center gap-1"
              >
                <UCheckbox
                  v-model="row.countEqualsProficiencyBonus"
                  :label="FEAT_GRANTS_LABELS.countEqualsProficiencyBonus"
                />

                <FieldHint
                  :text="FEAT_GRANTS_LABELS.countEqualsProficiencyBonusHint"
                />
              </div>
            </div>

            <p
              v-if="row.kinds.length === 1 && isMixableKind(primaryKind(row))"
              class="text-xs text-dimmed"
            >
              {{ FEAT_GRANTS_LABELS.kindSingleHint }}
            </p>
          </div>

          <!-- Что выдаётся / из чего выбирают -->
          <UFormField>
            <template #label>
              <span class="flex items-center gap-1">
                {{
                  row.mode === 'all'
                    ? FEAT_GRANTS_LABELS.values
                    : FEAT_GRANTS_LABELS.pool
                }}

                <FieldHint
                  :text="
                    hasPool(row)
                      ? FEAT_GRANTS_LABELS.poolHint
                      : FEAT_GRANTS_LABELS.poolCustomHint
                  "
                />
              </span>
            </template>

            <USelectMenu
              v-if="hasPool(row)"
              :model-value="selectedValues(row)"
              :items="poolForRow(row)"
              value-key="value"
              label-key="name"
              multiple
              class="w-full"
              @update:model-value="setValues(row, $event)"
            />

            <GrantOptionRows
              v-else
              v-model="row.options"
            />
          </UFormField>

          <!-- Настройки выбора -->
          <template v-if="row.mode === 'choice'">
            <UFormField :label="FEAT_GRANTS_LABELS.label">
              <UInput
                v-model="row.label"
                :placeholder="FEAT_GRANTS_LABELS.labelPlaceholder"
                class="w-full"
              />
            </UFormField>

            <div
              v-if="isProficiencyRow(row)"
              class="flex flex-wrap items-end gap-3"
            >
              <UFormField
                :label="FEAT_GRANTS_LABELS.grants"
                class="w-44"
              >
                <USelect
                  v-model="row.grants"
                  :items="grantsOptions"
                  value-key="value"
                  label-key="label"
                  class="w-full"
                />
              </UFormField>

              <UCheckbox
                v-model="row.onlyIfNotProficient"
                :label="FEAT_GRANTS_LABELS.onlyIfNotProficient"
                class="mb-2"
              />

              <UCheckbox
                v-model="row.onlyIfProficient"
                :label="FEAT_GRANTS_LABELS.onlyIfProficient"
                class="mb-2"
              />

              <UCheckbox
                v-model="row.expertiseIfProficient"
                :label="FEAT_GRANTS_LABELS.expertiseIfProficient"
                class="mb-2"
              />
            </div>

            <div class="flex flex-wrap items-end gap-4">
              <UCheckbox
                v-model="row.rechooseOnLongRest"
                :label="FEAT_GRANTS_LABELS.rechooseOnLongRest"
                class="mb-2"
              />

              <UFormField
                :label="FEAT_GRANTS_LABELS.choiceRequiredLevel"
                :help="FEAT_GRANTS_LABELS.choiceRequiredLevelHint"
                class="w-40"
              >
                <UInputNumber
                  v-model="row.requiredLevel"
                  :min="0"
                  :max="CLASS_LEVEL_MAX"
                  class="w-full"
                />
              </UFormField>
            </div>

            <!-- Рост по уровням: оружейных приёмов у воина три с 1 уровня,
              четыре с 4, пять с 10. Ступень называет, сколько всего выбрано к
              этому уровню, а не сколько добавилось -->
            <div class="flex flex-col gap-2">
              <span class="text-xs font-medium text-muted">
                {{ FEAT_GRANTS_LABELS.choiceScalingTitle }}
              </span>

              <p
                v-if="row.scaling.length === 0"
                class="text-xs text-dimmed italic"
              >
                {{ FEAT_GRANTS_LABELS.choiceScalingEmpty }}
              </p>

              <div
                v-for="(step, stepIndex) in row.scaling"
                :key="step.uid"
                class="flex items-end gap-2"
              >
                <UFormField
                  :label="FEAT_GRANTS_LABELS.choiceScalingLevel"
                  class="w-28"
                >
                  <UInputNumber
                    v-model="step.level"
                    :min="1"
                    :max="CLASS_LEVEL_MAX"
                    size="sm"
                    class="w-full"
                  />
                </UFormField>

                <UFormField
                  :label="FEAT_GRANTS_LABELS.choiceScalingCount"
                  class="w-28"
                >
                  <UInputNumber
                    v-model="step.count"
                    :min="1"
                    :max="CHOICE_COUNT_MAX"
                    size="sm"
                    class="w-full"
                  />
                </UFormField>

                <UButton
                  icon="tabler:trash"
                  color="error"
                  variant="ghost"
                  size="xs"
                  class="mb-1"
                  :aria-label="FEAT_GRANTS_LABELS.choiceScalingTitle"
                  @click.left.exact.prevent="removeScaling(row, stepIndex)"
                />
              </div>

              <UButton
                icon="tabler:plus"
                :label="FEAT_GRANTS_LABELS.addChoiceScaling"
                color="neutral"
                variant="soft"
                size="xs"
                class="self-start"
                @click.left.exact.prevent="addScaling(row)"
              />
            </div>

            <!-- Ряд по уровням соберётся из ступеней: колонкой его набирать не
              нужно -->
            <div
              v-if="row.scaling.length > 0"
              class="flex flex-wrap items-end gap-4"
            >
              <UCheckbox
                v-model="row.showInTable"
                :label="FEAT_GRANTS_LABELS.choiceShowInTable"
                :description="FEAT_GRANTS_LABELS.choiceShowInTableHint"
              />

              <UFormField
                v-if="row.showInTable"
                :label="FEAT_GRANTS_LABELS.choiceShortName"
                class="w-56"
              >
                <UInput
                  v-model="row.shortName"
                  :placeholder="FEAT_GRANTS_LABELS.choiceShortNamePlaceholder"
                  size="sm"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>

          <!-- Повышение характеристики: и у фиксированного дара, и у выбора -->
          <div
            v-if="hasKind(row, 'ability') || hasKind(row, 'savingThrow')"
            class="flex flex-col gap-1"
          >
            <div class="flex items-end gap-3">
              <UFormField
                :label="FEAT_GRANTS_LABELS.abilityAmount"
                class="w-28"
              >
                <UInputNumber
                  v-model="row.abilityAmount"
                  :min="0"
                  :max="5"
                  class="w-full"
                />
              </UFormField>

              <UFormField
                v-if="row.abilityAmount > 0"
                :label="FEAT_GRANTS_LABELS.abilityUpto"
                class="w-28"
              >
                <UInputNumber
                  v-model="row.abilityUpto"
                  :min="0"
                  :max="30"
                  class="w-full"
                />
              </UFormField>
            </div>

            <p class="text-xs text-dimmed">
              {{ FEAT_GRANTS_LABELS.abilityHint }}
            </p>
          </div>
        </div>
      </FormSection>
    </template>

    <UButton
      icon="tabler:plus"
      :label="FEAT_GRANTS_LABELS.addGrant"
      color="primary"
      variant="soft"
      block
      @click.left.exact.prevent="addRow"
    />
  </div>
</template>
