<!--
  Поля действия «вырваться»: кто действует, чем платит, проверка (навыки на
  выбор, Сл, режим броска) и что бывает после — состояние при успехе, урон при
  провале. Один блок на сам эффект и на состояние, которое кладёт срабатывание.
-->
<script setup lang="ts">
  import type { DamagePart, DamageType, SkillType } from '@vtt/shared';
  import type {
    ConditionRef,
    EffectEscape,
    EffectEscapeActor,
    EffectEscapeCheck,
    EffectEscapeOutcome,
    EffectEscapeRole,
    EffectEscapeRollMode,
    EffectEscapeSkillOption,
  } from '@vtt/shared/system/dnd.js';

  import { computed } from 'vue';

  import {
    createDefaultEscapeCheck,
    DEFAULT_ESCAPE_ACTOR,
    DEFAULT_ESCAPE_OUTCOME,
    MAX_ESCAPE_SKILLS,
    MIN_ESCAPE_SKILL_DC,
    NEW_ESCAPE_CHECK_SKILL,
    SOURCE_SAVE_DC,
  } from '@vtt/shared/system/dnd.js';

  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import FieldHint from '../../actor/FieldHint.vue';
  import { EFFECT_ESCAPE_SECTION_LABELS } from '../constants';
  import {
    buildConditionItems,
    buildDamageTypeItems,
    EFFECT_ESCAPE_ACTOR_OPTIONS,
    EFFECT_ESCAPE_OUTCOME_OPTIONS,
    EFFECT_ESCAPE_SKILL_OPTIONS,
  } from '../effectFormOptions';
  import {
    EFFECT_ESCAPE_FIELD_LABELS,
    ESCAPE_ROLL_MODE_NORMAL,
    ESCAPE_ROLL_MODE_OPTIONS,
    ESCAPE_SKILL_ROLE_ANY,
    ESCAPE_SKILL_ROLE_OPTIONS,
    ESCAPE_SKILL_ROW_ICONS,
    NEW_ESCAPE_FAIL_DAMAGE,
    NO_ESCAPE_AFTERMATH,
  } from '../escapeLabels';
  import EffectActionCostFields from './EffectActionCostFields.vue';
  import SaveDcField from './SaveDcField.vue';

  const props = defineProps<{
    /** «Авто» доступно там, где Сл источника вообще бывает */
    autoDcAllowed: boolean;
    /** Подпись «Авто» в месте окна; нет — подпись поля по умолчанию */
    autoLabel?: string;
    /** Сл источника для «Авто», если окно её знает */
    sourceSaveDc?: number;
  }>();

  /** Блок действия «вырваться» */
  const escape = defineModel<EffectEscape>({ required: true });

  const systemDataStore = useSystemDataStore();

  const damageTypeOptions = computed(() =>
    buildDamageTypeItems(systemDataStore.damageTypes),
  );

  // Список вычисляемый: кроме канона в него входят состояния, заведённые в мире
  const aftermathItems = computed(() => [
    {
      label: EFFECT_ESCAPE_FIELD_LABELS.onSuccessApplyNone,
      value: NO_ESCAPE_AFTERMATH,
    },
    ...buildConditionItems(),
  ]);

  /**
   * Записывает поля блока.
   *
   * @param patch - новые поля
   */
  function update(patch: Partial<EffectEscape>): void {
    escape.value = { ...escape.value, ...patch };
  }

  /**
   * Записывает поля проверки.
   *
   * @param patch - новые поля
   */
  function updateCheck(patch: Partial<EffectEscapeCheck>): void {
    const { check } = escape.value;

    if (check) {
      update({ check: { ...check, ...patch } });
    }
  }

  const actor = computed({
    get: () => escape.value.by ?? DEFAULT_ESCAPE_ACTOR,
    set: (next: EffectEscapeActor) =>
      update({ by: next === DEFAULT_ESCAPE_ACTOR ? undefined : next }),
  });

  const actionCost = computed({
    get: () => ({
      cost: escape.value.cost,
      moveCostFeet: escape.value.moveCostFeet,
    }),
    set: (next: Pick<EffectEscape, 'cost' | 'moveCostFeet'>) => update(next),
  });

  const outcome = computed({
    get: () => escape.value.onSuccess ?? DEFAULT_ESCAPE_OUTCOME,
    set: (next: EffectEscapeOutcome) =>
      update({ onSuccess: next === DEFAULT_ESCAPE_OUTCOME ? undefined : next }),
  });

  const hasCheck = computed({
    get: () => escape.value.check !== undefined,
    set: (enabled: boolean) =>
      update({
        check: enabled
          ? createDefaultEscapeCheck(props.autoDcAllowed)
          : undefined,
      }),
  });

  const dc = computed({
    get: () => escape.value.check?.dc ?? SOURCE_SAVE_DC,
    set: (next: number) => updateCheck({ dc: next }),
  });

  const dcFormula = computed({
    get: () => escape.value.check?.dcFormula,
    set: (next: string | undefined) => updateCheck({ dcFormula: next }),
  });

  const mode = computed({
    get: () => escape.value.check?.mode ?? ESCAPE_ROLL_MODE_NORMAL,
    set: (next: EffectEscapeRollMode | typeof ESCAPE_ROLL_MODE_NORMAL) =>
      updateCheck({
        mode: next === ESCAPE_ROLL_MODE_NORMAL ? undefined : next,
      }),
  });

  /** Навыки проверки: список либо единственный навык проверки */
  const skills = computed<EffectEscapeSkillOption[]>(() => {
    const { check } = escape.value;

    if (!check) {
      return [];
    }

    return check.skills ?? [{ skill: check.skill }];
  });

  const canAddSkill = computed(() => skills.value.length < MAX_ESCAPE_SKILLS);

  /**
   * Записывает список навыков: первый навык — он же навык проверки, по нему её
   * читают версии системы без списка.
   *
   * @param next - навыки
   */
  function writeSkills(next: EffectEscapeSkillOption[]): void {
    const [first] = next;

    if (first) {
      updateCheck({ skill: first.skill, skills: next });
    }
  }

  /**
   * Меняет один навык списка.
   *
   * @param index - номер навыка
   * @param patch - новые поля
   */
  function updateSkill(
    index: number,
    patch: Partial<EffectEscapeSkillOption>,
  ): void {
    writeSkills(
      skills.value.map((option, at) =>
        at === index ? { ...option, ...patch } : option,
      ),
    );
  }

  /** Добавляет навык: первый, которого в списке ещё нет */
  function addSkill(): void {
    const used = new Set(skills.value.map((option) => option.skill));

    const free = EFFECT_ESCAPE_SKILL_OPTIONS.find(
      (option) => !used.has(option.value),
    );

    writeSkills([
      ...skills.value,
      { skill: free?.value ?? NEW_ESCAPE_CHECK_SKILL },
    ]);
  }

  /**
   * Убирает навык; последний остаётся — без навыка проверки не бывает.
   *
   * @param index - номер навыка
   */
  function removeSkill(index: number): void {
    if (skills.value.length > 1) {
      writeSkills(skills.value.filter((_, at) => at !== index));
    }
  }

  /**
   * Меняет навык строки.
   *
   * @param index - номер навыка
   * @param skill - выбранный навык
   */
  function selectSkill(index: number, skill: SkillType): void {
    updateSkill(index, { skill });
  }

  /**
   * Меняет свою Сл навыка; пусто — Сл проверки.
   *
   * @param index - номер навыка
   * @param value - введённая Сл
   */
  function updateSkillDc(index: number, value: number | null): void {
    updateSkill(index, {
      dc: value === null || value < MIN_ESCAPE_SKILL_DC ? undefined : value,
    });
  }

  /**
   * Меняет, кому доступен навык.
   *
   * @param index - номер навыка
   * @param role - роль либо «всем»
   */
  function selectSkillRole(
    index: number,
    role: EffectEscapeRole | typeof ESCAPE_SKILL_ROLE_ANY,
  ): void {
    updateSkill(index, {
      by: role === ESCAPE_SKILL_ROLE_ANY ? undefined : role,
    });
  }

  /**
   * Меняет пометку навыка.
   *
   * @param index - номер навыка
   * @param value - введённая пометка
   */
  function updateSkillLabel(index: number, value: string | number): void {
    const label = String(value);

    updateSkill(index, { label: label.trim() ? label : undefined });
  }

  /** Строки навыков с готовыми значениями полей */
  const skillRows = computed(() =>
    skills.value.map((option, index) => ({
      index,
      skill: option.skill,
      dc: option.dc ?? null,
      role: option.by ?? ESCAPE_SKILL_ROLE_ANY,
      label: option.label ?? '',
      removable: skills.value.length > 1,
    })),
  );

  const aftermath = computed({
    get: () => escape.value.onSuccessApply ?? NO_ESCAPE_AFTERMATH,
    set: (next: ConditionRef) =>
      update({
        onSuccessApply: next === NO_ESCAPE_AFTERMATH ? undefined : next,
      }),
  });

  const failDamage = computed(() => escape.value.onFailDamage ?? []);

  /**
   * Записывает урон при провале; пустой список — отсутствием поля.
   *
   * @param parts - части урона
   */
  function writeFailDamage(parts: DamagePart[]): void {
    update({ onFailDamage: parts.length > 0 ? parts : undefined });
  }

  /** Добавляет часть урона при провале */
  function addFailDamage(): void {
    writeFailDamage([...failDamage.value, { ...NEW_ESCAPE_FAIL_DAMAGE }]);
  }

  /**
   * Убирает часть урона при провале.
   *
   * @param index - номер части
   */
  function removeFailDamage(index: number): void {
    writeFailDamage(failDamage.value.filter((_, at) => at !== index));
  }

  /**
   * Меняет формулу части урона при провале.
   *
   * @param index - номер части
   * @param value - введённая формула
   */
  function updateFailFormula(index: number, value: string | number): void {
    writeFailDamage(
      failDamage.value.map((part, at) =>
        at === index ? { ...part, formula: String(value) } : part,
      ),
    );
  }

  /**
   * Меняет тип части урона при провале.
   *
   * @param index - номер части
   * @param type - тип урона
   */
  function selectFailType(index: number, type: DamageType): void {
    writeFailDamage(
      failDamage.value.map((part, at) =>
        at === index ? { ...part, type } : part,
      ),
    );
  }
</script>

<template>
  <div class="flex flex-col gap-2 rounded-md border border-default p-2">
    <div class="flex flex-wrap items-end gap-2">
      <UFormField
        :label="EFFECT_ESCAPE_SECTION_LABELS.actor"
        class="w-60"
      >
        <USelect
          v-model="actor"
          :items="EFFECT_ESCAPE_ACTOR_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <EffectActionCostFields
        v-model="actionCost"
        cost-width-class="w-44"
      />

      <UFormField
        :label="EFFECT_ESCAPE_SECTION_LABELS.outcome"
        class="w-44"
      >
        <USelect
          v-model="outcome"
          :items="EFFECT_ESCAPE_OUTCOME_OPTIONS"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>

      <USwitch
        v-model="hasCheck"
        class="mb-2"
        :label="EFFECT_ESCAPE_SECTION_LABELS.checkToggle"
      />
    </div>

    <template v-if="escape.check">
      <div class="flex items-center gap-1 text-xs font-medium text-toned">
        {{ EFFECT_ESCAPE_FIELD_LABELS.skills }}

        <FieldHint :text="EFFECT_ESCAPE_FIELD_LABELS.skillsHint" />
      </div>

      <div
        v-for="row in skillRows"
        :key="row.index"
        class="flex flex-wrap items-end gap-2"
      >
        <UFormField
          :label="EFFECT_ESCAPE_SECTION_LABELS.skill"
          class="w-48"
        >
          <USelect
            :model-value="row.skill"
            :items="EFFECT_ESCAPE_SKILL_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
            @update:model-value="selectSkill(row.index, $event)"
          />
        </UFormField>

        <UFormField
          :label="EFFECT_ESCAPE_FIELD_LABELS.skillDc"
          class="w-36"
        >
          <UInputNumber
            :model-value="row.dc"
            :min="MIN_ESCAPE_SKILL_DC"
            :placeholder="EFFECT_ESCAPE_FIELD_LABELS.skillDcPlaceholder"
            size="sm"
            class="w-full"
            @update:model-value="updateSkillDc(row.index, $event)"
          />
        </UFormField>

        <UFormField
          :label="EFFECT_ESCAPE_FIELD_LABELS.skillRole"
          class="w-52"
        >
          <USelect
            :model-value="row.role"
            :items="ESCAPE_SKILL_ROLE_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
            @update:model-value="selectSkillRole(row.index, $event)"
          />
        </UFormField>

        <UFormField
          :label="EFFECT_ESCAPE_FIELD_LABELS.skillLabel"
          class="w-52"
        >
          <UInput
            :model-value="row.label"
            :placeholder="EFFECT_ESCAPE_FIELD_LABELS.skillLabelPlaceholder"
            size="sm"
            class="w-full"
            @update:model-value="updateSkillLabel(row.index, $event)"
          />
        </UFormField>

        <UButton
          v-if="row.removable"
          :icon="ESCAPE_SKILL_ROW_ICONS.remove"
          :aria-label="EFFECT_ESCAPE_FIELD_LABELS.removeSkill"
          color="neutral"
          variant="ghost"
          size="sm"
          class="mb-0.5"
          @click.left.exact.prevent="removeSkill(row.index)"
        />
      </div>

      <div class="flex flex-wrap items-end gap-2">
        <UButton
          v-if="canAddSkill"
          :icon="ESCAPE_SKILL_ROW_ICONS.add"
          :label="EFFECT_ESCAPE_FIELD_LABELS.addSkill"
          color="neutral"
          variant="soft"
          size="xs"
          class="mb-1"
          @click.left.exact.prevent="addSkill"
        />

        <SaveDcField
          v-model="dc"
          v-model:formula="dcFormula"
          formula-allowed
          :label="EFFECT_ESCAPE_SECTION_LABELS.dc"
          :auto-allowed="autoDcAllowed"
          :auto-label="autoLabel"
          :auto-value="sourceSaveDc"
        />

        <UFormField class="w-48">
          <template #label>
            <span class="flex items-center gap-1">
              {{ EFFECT_ESCAPE_FIELD_LABELS.mode }}

              <FieldHint :text="EFFECT_ESCAPE_FIELD_LABELS.modeHint" />
            </span>
          </template>

          <USelect
            v-model="mode"
            :items="ESCAPE_ROLL_MODE_OPTIONS"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
          />
        </UFormField>
      </div>
    </template>

    <div class="flex flex-wrap items-end gap-2">
      <UFormField class="w-56">
        <template #label>
          <span class="flex items-center gap-1">
            {{ EFFECT_ESCAPE_FIELD_LABELS.onSuccessApply }}

            <FieldHint :text="EFFECT_ESCAPE_FIELD_LABELS.onSuccessApplyHint" />
          </span>
        </template>

        <USelect
          v-model="aftermath"
          :items="aftermathItems"
          value-key="value"
          size="sm"
          class="w-full"
          :portal="false"
        />
      </UFormField>
    </div>

    <template v-if="escape.check">
      <div class="flex items-center gap-1 text-xs font-medium text-toned">
        {{ EFFECT_ESCAPE_FIELD_LABELS.onFailDamage }}

        <FieldHint :text="EFFECT_ESCAPE_FIELD_LABELS.onFailDamageHint" />
      </div>

      <div
        v-for="(part, index) in failDamage"
        :key="index"
        class="flex flex-wrap items-end gap-2"
      >
        <UFormField
          :label="EFFECT_ESCAPE_FIELD_LABELS.onFailDamageFormula"
          class="w-36"
        >
          <UInput
            :model-value="part.formula"
            size="sm"
            class="w-full"
            @update:model-value="updateFailFormula(index, $event)"
          />
        </UFormField>

        <UFormField
          :label="EFFECT_ESCAPE_FIELD_LABELS.onFailDamageType"
          class="w-48"
        >
          <USelect
            :model-value="part.type"
            :items="damageTypeOptions"
            value-key="value"
            size="sm"
            class="w-full"
            :portal="false"
            @update:model-value="selectFailType(index, $event)"
          />
        </UFormField>

        <UButton
          :icon="ESCAPE_SKILL_ROW_ICONS.remove"
          :aria-label="EFFECT_ESCAPE_FIELD_LABELS.removeFailDamage"
          color="neutral"
          variant="ghost"
          size="sm"
          class="mb-0.5"
          @click.left.exact.prevent="removeFailDamage(index)"
        />
      </div>

      <UButton
        :icon="ESCAPE_SKILL_ROW_ICONS.add"
        :label="EFFECT_ESCAPE_FIELD_LABELS.addFailDamage"
        color="neutral"
        variant="soft"
        size="xs"
        class="w-fit"
        @click.left.exact.prevent="addFailDamage"
      />
    </template>
  </div>
</template>
