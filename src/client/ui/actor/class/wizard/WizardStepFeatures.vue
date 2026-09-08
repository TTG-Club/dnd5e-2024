<script setup lang="ts">
  /**
   * Шаг мастера: умения класса — и всё, о чём уровень спрашивает.
   *
   * Каждая строка уровня спрашивает своё сама: варианты умения, выборы его
   * даров, черту, навык и заклинания, которые оно выдало. Раньше вопросы
   * стояли порознь — варианты в карточке, дары общим списком под умениями,
   * навык умения вовсе отдельным шагом, — и связать вопрос с умением игроку
   * было не по чему. Дары самой записи класса и подкласса идут такой же
   * строкой, только без описания: их даёт не умение.
   *
   * Строки свёрнуты: описание умения занимает экран целиком — у «Магии
   * договора» колдуна это полстраницы, — и за ним не видно ни остальных умений
   * уровня, ни того, что от игрока чего-то ждут. Поэтому на свёрнутой строке
   * висит пометка со счётом несделанного: развернут её ради него.
   */
  import type { SkillType } from '@vtt/shared';
  import type {
    DnDActor,
    ResolvedGrantedSpell,
    Spell,
    SubclassDefinition,
  } from '@vtt/shared/system/dnd.js';

  import type { ChoicePickerOption } from '../../ChoicePickerModal.vue';
  import type { CompendiumFeat, WizardLevelRow } from './useClassWizard';

  import { computed } from 'vue';

  import ItemDescriptionRenderer from '@/shared_ui/components/ItemDescriptionRenderer.vue';
  import { useSourceLabels } from '@/systems/dnd5e/composables/useSourceLabel';
  import {
    featChoicePendingCount,
    isSkillType,
    SKILLS_LIST,
  } from '@vtt/shared/system/dnd.js';

  import { useExpandedRows } from '../../../../composables/useExpandedRows';
  import { useFeatChoiceWeapons } from '../../../../composables/useFeatChoiceWeapons';
  import ChoicePickerField from '../../ChoicePickerField.vue';
  import { CLASS_WIZARD_LABELS, LEVEL_BADGE_SUFFIX } from '../../constants';
  import FeatChoicesFields from '../../feat/FeatChoicesFields.vue';
  import WizardFeatPicker from '../../feat/WizardFeatPicker.vue';
  import { SKILL_LABELS } from './constants';
  import WizardFeatureChoicePicker from './WizardFeatureChoicePicker.vue';
  import WizardSpellChip from './WizardSpellChip.vue';

  const { getSourceLabel } = useSourceLabels();

  const { isExpanded, toggle } = useExpandedRows();

  /** Виды оружия мира — их просит пул выбора оружия и оружейного приёма */
  const { weaponOptions } = useFeatChoiceWeapons();

  const props = defineProps<{
    /** Строки уровня: умения и дары самих записей */
    rows: WizardLevelRow[];
    /** Выбранные варианты умений: ключ умения → ключи вариантов */
    featureChoices: Record<string, string[]>;
    /** Ответы на выборы даров: ключ выбора → значения */
    featSelections: Record<string, string[]>;
    /** Навыки, названные умениями: ключ строки → навыки */
    featureSkills: Record<string, SkillType[]>;
    hasSubclassSelection?: boolean;
    subclasses?: SubclassDefinition[];
    subclassKey?: string | null;
    subclassLabel?: string;
    /** Черты компендиума — пул пикеров черт */
    feats?: ReadonlyArray<CompendiumFeat>;
    /** Лист персонажа: по нему сужаются пулы и уходят взятые черты */
    actor: DnDActor;
    /** Бонус мастерства: от него зависит количество у части выборов */
    proficiencyBonus: number;
    /** Заклинания каталога — пул выбора заклинания */
    spells?: ReadonlyArray<Spell>;
    /** Заклинания, выданные записями этого уровня */
    grantedSpells?: ReadonlyArray<ResolvedGrantedSpell>;
  }>();

  const emit = defineEmits<{
    'update:featureChoices': [choices: Record<string, string[]>];
    'update:subclassKey': [key: string];
    'update:featSelection': [key: string, featId: string | null];
    'update:featSelections': [selections: Record<string, string[]>];
    'update:featureSkills': [rowKey: string, skills: SkillType[]];
    'open-spell': [spell: Spell];
  }>();

  /** Уровень не спрашивает и не выдаёт ничего — строк нет вовсе */
  const isLevelEmpty = computed(
    () => props.rows.length === 0 && !props.hasSubclassSelection,
  );

  /**
   * Строки со всем, что о них нужно шаблону: пометка, пул навыка и выданные
   * заклинания. Считаются здесь, а не в разметке: пул выбора собирается по
   * всему каталогу заклинаний, и вызов из шаблона повторял бы эту работу на
   * каждую отрисовку каждой строки.
   */
  const rowViews = computed(() =>
    props.rows.map((row) => ({
      row,
      badge: rowBadge(row),
      skillOptions: skillOptions(row),
      grantedSpells: (props.grantedSpells ?? []).filter(
        (granted) => granted.featureName === row.name,
      ),
    })),
  );

  /**
   * Навыки, из которых выбирает умение: пустой пул записи означает «любой
   * навык», и подставляет его мастер.
   *
   * @param row - строка уровня
   */
  function skillOptions(row: WizardLevelRow): ChoicePickerOption[] {
    const from = row.skillChoice?.from.length
      ? row.skillChoice.from
      : SKILLS_LIST.map((skill) => skill.key);

    return from.map((skill) => ({
      value: skill,
      name: SKILL_LABELS[skill] ?? skill,
    }));
  }

  /**
   * Сколько в строке МЕСТ, где игрок ещё не ответил: варианты, выборы даров,
   * черта и навык считаются вместе, по одному за каждое незакрытое поле.
   *
   * Именно мест, а не значений: «три заговора» — это одно место, куда игрок
   * зайдёт один раз, и число 3 в пометке он читал бы как три отдельных дела.
   * Сколько значений брать в самом поле, говорит его счётчик.
   *
   * @param row - строка уровня
   */
  function pendingCount(row: WizardLevelRow): number {
    const context = {
      selections: props.featSelections,
      spells: props.spells,
      weapons: weaponOptions.value,
    };

    const variants =
      row.pick && (props.featureChoices[row.key] ?? []).length < row.pick.count
        ? 1
        : 0;

    const choices = row.choices.filter(
      (choice) =>
        featChoicePendingCount(
          choice,
          props.actor,
          context,
          props.proficiencyBonus,
          props.featSelections,
        ) > 0,
    ).length;

    const featPicks = row.featPicks.filter(
      (choice) => !props.featSelections[choice.key]?.length,
    ).length;

    const skills =
      row.skillChoice
      && (props.featureSkills[row.key] ?? []).length < row.skillChoice.count
        ? 1
        : 0;

    return variants + choices + featPicks + skills;
  }

  /**
   * Пометка строки: пока не набрано — счёт несделанного предупреждением, после
   * — спокойная отметка. Строка, которая ни о чём не спрашивает, пометки не
   * несёт: сообщать «выбор сделан» там не о чем.
   *
   * @param row - строка уровня
   */
  function rowBadge(
    row: WizardLevelRow,
  ): { label: string; color: 'warning' | 'success' } | null {
    const asksAnything =
      row.pick || row.choices.length || row.featPicks.length || row.skillChoice;

    if (!asksAnything) {
      return null;
    }

    const pending = pendingCount(row);

    return pending > 0
      ? {
          label: `${CLASS_WIZARD_LABELS.pendingBadgePrefix}${pending}`,
          color: 'warning',
        }
      : { label: CLASS_WIZARD_LABELS.choiceDoneBadge, color: 'success' };
  }

  /**
   * Значок свёртки строки: показывает, куда уедет её содержимое.
   *
   * @param rowKey - ключ строки
   */
  function toggleIcon(rowKey: string): string {
    return isExpanded(rowKey) ? 'tabler:chevron-down' : 'tabler:chevron-right';
  }

  /**
   * Подпись строки для скринридера: по нажатию она раскрывается и
   * сворачивается, и текст должен говорить, что случится дальше.
   *
   * @param rowKey - ключ строки
   */
  function toggleLabel(rowKey: string): string {
    return isExpanded(rowKey)
      ? CLASS_WIZARD_LABELS.featureCollapse
      : CLASS_WIZARD_LABELS.featureExpand;
  }

  /**
   * Запоминает выбранные варианты умения.
   *
   * @param featureKey - ключ умения
   * @param choiceKeys - ключи выбранных вариантов
   */
  function selectChoice(featureKey: string, choiceKeys: string[]): void {
    emit('update:featureChoices', {
      ...props.featureChoices,
      [featureKey]: choiceKeys,
    });
  }

  /**
   * Запоминает навыки, названные самим умением.
   *
   * Пикер отдаёт значения строками, и здесь они сужаются гвардом: ключа, которого
   * среди навыков нет, в ответе быть не должно, а приведение типа пропустило бы
   * его молча.
   *
   * @param rowKey - ключ строки уровня
   * @param values - отмеченные в пикере значения
   */
  function selectFeatureSkills(rowKey: string, values: string[]): void {
    emit('update:featureSkills', rowKey, values.filter(isSkillType));
  }

  /**
   * Выбранная в пикере черта по ключу выбора.
   *
   * @param key - ключ выбора черты
   */
  function selectedFeatId(key: string): string | null {
    return props.featSelections[key]?.[0] ?? null;
  }

  function selectSubclass(key: string): void {
    emit('update:subclassKey', key);
  }
</script>

<template>
  <div class="space-y-3">
    <span class="mb-2 block text-sm font-medium text-toned">
      {{ CLASS_WIZARD_LABELS.featuresTitle }}
    </span>

    <div
      v-if="isLevelEmpty"
      class="rounded-lg border border-default/50 bg-elevated/30 px-3 py-2.5"
    >
      <span class="text-sm text-muted">
        {{ CLASS_WIZARD_LABELS.featuresEmpty }}
      </span>
    </div>

    <!-- Выбор подкласса -->
    <div
      v-if="hasSubclassSelection"
      class="rounded-lg border border-primary/50 bg-primary/10 p-3"
    >
      <div class="mb-3 flex items-center gap-2">
        <UIcon
          name="tabler:git-branch"
          class="h-5 w-5 text-primary"
        />

        <span class="font-medium text-primary">
          {{ subclassLabel || CLASS_WIZARD_LABELS.subclassFallback }}
        </span>
      </div>

      <div class="flex flex-col gap-2">
        <button
          v-for="sc in subclasses"
          :key="sc.key"
          class="rounded-md border p-2 text-left transition-colors"
          :class="
            subclassKey === sc.key
              ? 'border-primary/50 bg-primary/10'
              : 'border-default/50 bg-default/30 hover:border-accented/50'
          "
          @click.left.exact.prevent="selectSubclass(sc.key)"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-highlighted">{{
              sc.name
            }}</span>

            <span class="text-xs text-dimmed">{{
              getSourceLabel(sc.sourceKey, sc.source)
            }}</span>
          </div>

          <ItemDescriptionRenderer
            :content="sc.description"
            class="mt-0.5 text-muted"
          />
        </button>
      </div>
    </div>

    <div
      v-for="{ row, ...view } in rowViews"
      :key="row.key"
      class="rounded-lg border border-default/50 bg-elevated/30"
    >
      <!-- Нажимается вся строка целиком: попадать в стрелку незачем -->
      <div
        class="flex min-h-11 cursor-pointer items-center gap-2 p-3 transition-colors hover:bg-elevated/50"
        role="button"
        tabindex="0"
        :aria-expanded="isExpanded(row.key)"
        :aria-label="toggleLabel(row.key)"
        @click.left.exact.prevent="toggle(row.key)"
        @keydown.enter.prevent="toggle(row.key)"
        @keydown.space.prevent="toggle(row.key)"
      >
        <UIcon
          :name="toggleIcon(row.key)"
          class="size-4 shrink-0 text-muted"
        />

        <span class="min-w-0 flex-1 truncate text-sm font-medium text-healing">
          {{ row.name }}
        </span>

        <!-- Пометка идёт первой: ради неё строку и открывают -->
        <UBadge
          v-if="view.badge"
          :label="view.badge.label"
          :color="view.badge.color"
          size="md"
          variant="subtle"
          class="shrink-0"
        />

        <UBadge
          v-if="row.isOwnGrants"
          :label="CLASS_WIZARD_LABELS.ownGrantsBadge"
          size="md"
          color="neutral"
          variant="subtle"
          class="hidden shrink-0 md:inline-flex"
        />

        <UBadge
          v-else
          :label="row.sourceName"
          size="md"
          :color="row.isSubclass ? 'primary' : 'neutral'"
          variant="subtle"
          class="hidden shrink-0 md:inline-flex"
        />

        <UBadge
          :label="`${row.level}${LEVEL_BADGE_SUFFIX}`"
          size="md"
          color="neutral"
          variant="subtle"
          class="shrink-0"
        />
      </div>

      <div
        v-if="isExpanded(row.key)"
        class="flex flex-col gap-3 border-t border-default/50 p-3"
      >
        <!-- Умение получено раньше, а выбор к нему открылся сейчас -->
        <p
          v-if="row.isReopened"
          class="text-xs text-dimmed"
        >
          {{ CLASS_WIZARD_LABELS.reopenedHint }}
        </p>

        <!-- Выборы идут ПЕРЕД описанием: у «Использования заклинаний» описание
          на полстраницы, и вопрос под ним игрок находил, только пролистав
          правила, ради которых карточку не открывал -->

        <!-- Варианты умения: боевой стиль, манёвры, воззвания -->
        <WizardFeatureChoicePicker
          v-if="row.pick"
          :pick="row.pick"
          :selected="featureChoices[row.key] ?? []"
          @update:selected="selectChoice"
        />

        <!-- Выборы даров: свои у умения и вопросы взятых им вариантов -->
        <FeatChoicesFields
          v-if="row.choices.length"
          :model-value="featSelections"
          :choices="row.choices"
          :actor="actor"
          :proficiency-bonus="proficiencyBonus"
          :spells="spells"
          @update:model-value="emit('update:featSelections', $event)"
        />

        <!-- Навык, который называет само умение («Эксперт» и подобные) -->
        <ChoicePickerField
          v-if="row.skillChoice"
          :label="CLASS_WIZARD_LABELS.featureSkillLabel"
          :subtitle="row.name"
          :options="view.skillOptions"
          :selected="featureSkills[row.key] ?? []"
          :max="row.skillChoice.count"
          @update:selected="selectFeatureSkills(row.key, $event)"
        />

        <!-- Черта от умения: пул из компендиума черт, поэтому пикер свой -->
        <WizardFeatPicker
          v-for="choice in row.featPicks"
          :key="choice.key"
          :choice="choice"
          :feats="feats ?? []"
          :actor="actor"
          :model-value="selectedFeatId(choice.key)"
          @update:model-value="emit('update:featSelection', choice.key, $event)"
        />

        <!-- Заклинания, выданные записью: снять их нельзя, читать — можно -->
        <div
          v-if="view.grantedSpells.length"
          class="flex flex-col gap-1.5"
        >
          <span class="text-xs text-dimmed">
            {{ CLASS_WIZARD_LABELS.grantedSpellsTitle }}
          </span>

          <div class="flex flex-wrap gap-1.5">
            <WizardSpellChip
              v-for="granted in view.grantedSpells"
              :key="granted.spell.id"
              :spell="granted.spell"
              @open="emit('open-spell', granted.spell)"
            />
          </div>
        </div>

        <!-- Описание — последним: это правила умения, их читают, когда с
          выбором уже разобрались -->
        <ItemDescriptionRenderer
          v-if="row.description"
          :content="row.description"
          class="text-muted"
        />
      </div>
    </div>
  </div>
</template>
