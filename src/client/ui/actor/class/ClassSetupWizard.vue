<script setup lang="ts">
  /**
   * Пошаговый мастер добавления / повышения уровня класса (D&D 5.5 2024).
   *
   * Динамически формирует шаги на основе контекста:
   * - Первый класс: ХП → Спасброски → Владения → Навыки → Умения
   * - Level Up: ХП → Умения → ASI (при необходимости)
   * - Мультикласс: ХП → Владения (сокращённые) → Навыки → Умения
   *
   * Заклинания мастер не спрашивает: вопрос задаёт та запись, которая его
   * задала, — умение или сам класс, — и стоит он в её строке на шаге умений.
   * Таблица класса числами не спрашивает, а показывает норму на листе.
   */
  import type { SkillType, TypedWebSocketClient } from '@vtt/shared';
  import type {
    ClassDefinition,
    DnDAbilityScores,
    DnDActor,
    HitPointMethod,
  } from '@vtt/shared/system/dnd.js';

  import type { WizardAsiState } from './wizard';

  import { computed, toRef } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { resolveActorStats } from '@vtt/shared/system/dnd.js';

  import { useEntityDetailModals } from '../../../composables/useEntityDetailModals';
  import { useFeatChoiceFeats } from '../../../composables/useFeatChoiceFeats';
  import { useFeatChoiceSpells } from '../../../composables/useFeatChoiceSpells';
  import { useGrantedSpellsResolver } from '../../../composables/useGrantedSpellsResolver';
  import { resolveStartingEquipment } from '../../../composables/useStartingEquipment';
  import {
    CLASS_WIZARD_LABELS,
    MODAL_BUTTON_LABELS,
    WIZARD_SKELETON_STEPS,
  } from '../constants';
  import { useClassWizard } from './wizard';
  import WizardStepAsi from './wizard/WizardStepAsi.vue';
  import WizardStepClassEquipment from './wizard/WizardStepClassEquipment.vue';
  import WizardStepFeatures from './wizard/WizardStepFeatures.vue';
  import WizardStepHitPoints from './wizard/WizardStepHitPoints.vue';
  import WizardStepProficiencies from './wizard/WizardStepProficiencies.vue';
  import WizardStepSavingThrows from './wizard/WizardStepSavingThrows.vue';
  import WizardStepSkills from './wizard/WizardStepSkills.vue';

  const props = defineProps<{
    open: boolean;
    actor: DnDActor;
    classDefinition: ClassDefinition | null;
    /** Пак записи класса: ложится на запись актора и ведёт следующие уровни */
    packId?: string;
    /** Сокет для загрузки данных компендиума: черты, заклинания, снаряжение */
    socket: TypedWebSocketClient | null;
    /**
     * Класс ещё грузится: вместо шагов показываем скелетон. Список классов
     * нужен целиком — по нему находится и родитель записи-подкласса, и
     * хоумбрю-подклассы к классу компендиума.
     */
    loading?: boolean;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    /** Вызывается после подтверждения, возвращает обновления для записи в актора */
    'apply': [
      systemUpdates: Partial<DnDActor['system']>,
      rootUpdates: Partial<DnDActor>,
    ];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  /** Карточка заклинания: её открывает плашка выданного заклинания */
  const { openSpellDetail } = useEntityDetailModals();

  const classDefRef = toRef(props, 'classDefinition');
  const actorRef = toRef(props, 'actor');

  /**
   * Черты компендиума для выборов черты умений и режима «Взять черту» шага
   * характеристик. Грузятся при открытии мастера — как в мастере предыстории.
   */
  const { feats: compendiumFeats } = useFeatChoiceFeats(
    toRef(props, 'socket'),
    toRef(props, 'open'),
    toRef(props, 'packId'),
  );

  /**
   * Итоговые характеристики с учётом активных эффектов
   * (бонусы предыстории, прошлые повышения характеристик).
   */
  const resolvedAbilities = computed<DnDAbilityScores>(() => {
    try {
      return resolveActorStats(props.actor).abilities;
    } catch {
      return props.actor.system.abilities;
    }
  });

  const {
    isFirstClass,
    isMulticlass,
    nextLevel,
    isMaxHitDieLevel,
    averageHitPoints,
    hasSubclassSelection,
    skillChoicesCount,
    availableSkills,
    alreadyProficientSkills,
    selectedEquipmentItems,
    levelRows,

    wizardSteps,
    activeStepKey,
    isFirstStep,
    isLastStep,
    currentStepIndex,

    wizardState,
    canProceed,
    preparedFeatChoices,
    asiFeatChoice,
    featChoiceProficiencyBonus,
    grantedSpellSources,
    grantedClassSpellRequests,

    nextStep,
    prevStep,

    buildUpdates,
  } = useClassWizard(
    classDefRef,
    actorRef,
    isOpen,
    compendiumFeats,
    toRef(props, 'packId'),
  );

  /** Granted-заклинания умений текущего уровня с данными из компендиума */
  const { resolvedGrantedSpells } = useGrantedSpellsResolver(
    toRef(props, 'socket'),
    grantedSpellSources,
    grantedClassSpellRequests,
  );

  /**
   * Каталог заклинаний для выборов уровня: «Договор Гримуара» даёт выбрать три
   * заговора, и без каталога такой вопрос остался бы без вариантов вовсе.
   *
   * От всех выборов уровня, а не только от показанных сейчас: выбор заклинания
   * ждёт ответа про класс, и грузить каталог после ответа значило бы показать
   * игроку пустой список.
   */
  const { spells: featChoiceSpells } = useFeatChoiceSpells(
    toRef(props, 'socket'),
    preparedFeatChoices,
    toRef(props, 'packId'),
  );

  /** Заголовок модального окна */
  const modalTitle = computed(() => {
    if (isFirstClass.value) {
      return CLASS_WIZARD_LABELS.addTitle;
    }

    if (isMulticlass.value) {
      return CLASS_WIZARD_LABELS.multiclassTitle;
    }

    return CLASS_WIZARD_LABELS.levelUpTitle;
  });

  /** Текст кнопки «Применить» */
  const applyButtonLabel = computed(() => {
    if (isFirstClass.value) {
      return MODAL_BUTTON_LABELS.apply;
    }

    if (isMulticlass.value) {
      return CLASS_WIZARD_LABELS.addButton;
    }

    return CLASS_WIZARD_LABELS.levelUpButton;
  });

  // ── Обработчики шагов ─────────────────────────────────────

  /** Применяет уровень: подтверждение мастера — последний шаг */
  function handleApplyClick(): void {
    void handleComplete();
  }

  /**
   * Сохраняет результат шага хитов: значение и выбранный метод расчёта.
   *
   * @param payload - данные шага хитов
   * @param payload.value - итоговое количество хитов
   * @param payload.method - метод определения хитов (фикс/бросок/среднее)
   */
  function handleHitPointsUpdate(payload: {
    value: number;
    method: HitPointMethod;
  }) {
    wizardState.hitPoints.value = payload.value;
    wizardState.hitPoints.method = payload.method;
  }

  /**
   * Сохраняет выбранные на шаге навыки в состоянии мастера.
   *
   * @param skills - список выбранных навыков
   */
  function handleSkillsUpdate(skills: SkillType[]) {
    wizardState.selectedSkills = skills;
  }

  /**
   * Сохраняет навыки, названные умением. Отдельно от классовых: те берут при
   * взятии класса, эти даёт конкретное умение уровня — и по его ключу, чтобы
   * ответы двух умений одного уровня не смешались.
   *
   * @param rowKey - ключ строки уровня, чьё умение спросило навык
   * @param skills - выбранные навыки
   */
  function handleFeatureSkillsUpdate(rowKey: string, skills: SkillType[]) {
    wizardState.selectedFeatureSkills = {
      ...wizardState.selectedFeatureSkills,
      [rowKey]: skills,
    };
  }

  /**
   * Сохраняет выбор вариантов умений класса в состоянии мастера.
   *
   * @param choices - карта «ключ умения → ключи выбранных вариантов»
   */
  function handleFeatureChoicesUpdate(choices: Record<string, string[]>) {
    wizardState.featureChoices = choices;
  }

  /**
   * Сохраняет ответы на вопросы вариантов, заданные в карточке умения. Список
   * ответов общий с полями выбора внизу: у обоих один и тот же набор ключей.
   *
   * @param selections - ответы: ключ выбора → значения
   */
  function handleFeatSelectionsUpdate(selections: Record<string, string[]>) {
    wizardState.featDataChoices = selections;
  }

  /**
   * Сохраняет состояние шага повышения характеристик (ASI) в мастере.
   *
   * @param asiState - состояние выбора ASI
   */
  function handleAsiUpdate(asiState: WizardAsiState) {
    wizardState.asi = asiState;
  }

  /**
   * Сохраняет черту, выбранную в умении уровня. Ответ лежит там же, где ответы
   * на остальные выборы даров: ключ выбора → значения.
   *
   * @param key - ключ выбора черты
   * @param featId - ключ черты компендиума; null — выбор снят
   */
  function handleFeatSelection(key: string, featId: string | null) {
    wizardState.featDataChoices = {
      ...wizardState.featDataChoices,
      [key]: featId ? [featId] : [],
    };
  }

  /** Переход к конкретному шагу по индексу */
  function goToStep(targetIndex: number) {
    currentStepIndex.value = targetIndex;
  }

  /**
   * Завершает работу мастера: собирает обновления актора, эмитит их
   * родителю через событие `apply` и закрывает модальное окно.
   */
  async function handleComplete(): Promise<void> {
    const { systemUpdates, rootUpdates } = buildUpdates(
      resolvedGrantedSpells.value,
    );

    // Стартовое снаряжение — отдельным шагом после сборки: позиции надо
    // сопоставить с компендиумом, а это асинхронно
    const granted = await resolveStartingEquipment(
      props.socket,
      selectedEquipmentItems.value,
      props.packId,
    );

    if (granted.length > 0) {
      rootUpdates.equipment = [...(props.actor.equipment ?? []), ...granted];
    }

    emit('apply', systemUpdates, rootUpdates);
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="true"
    :resizable="false"
    :min-width="800"
    :initial-width="800"
    :min-height="400"
    :title="modalTitle"
  >
    <template #body>
      <!-- Скелетон повторяет разметку мастера: шапка класса, лента шагов и
        поле шага — окно не прыгает, когда класс доезжает -->
      <div
        v-if="loading"
        class="flex flex-col gap-4"
      >
        <div class="rounded-lg border border-default/50 bg-elevated/30 p-3">
          <USkeleton class="h-6 w-48" />

          <USkeleton class="mt-2 h-4 w-32" />
        </div>

        <div class="flex items-center gap-1">
          <USkeleton
            v-for="step in WIZARD_SKELETON_STEPS"
            :key="step"
            class="h-6 flex-1 rounded-full"
          />
        </div>

        <USkeleton class="min-h-50 w-full" />
      </div>

      <div
        v-else-if="classDefinition"
        class="flex flex-col gap-4"
      >
        <!-- Инфо о классе -->
        <div class="rounded-lg border border-default/50 bg-elevated/30 p-3">
          <div>
            <h3 class="text-lg font-medium text-highlighted">
              {{ classDefinition.name }}
            </h3>

            <p class="text-sm text-dimmed">
              {{ CLASS_WIZARD_LABELS.gainedLevelPrefix }}
              <span class="font-bold text-toned">{{ nextLevel }}</span>
            </p>
          </div>
        </div>

        <!-- Индикатор прогресса (шаги) -->
        <div
          v-if="wizardSteps.length > 1"
          class="flex items-center gap-1"
        >
          <template
            v-for="(step, stepIdx) in wizardSteps"
            :key="step.value"
          >
            <!-- Разделитель между шагами -->
            <div
              v-if="stepIdx > 0"
              class="h-px flex-1"
              :class="
                stepIdx <= currentStepIndex ? 'bg-primary/60' : 'bg-accented/50'
              "
            />

            <!-- Кружок шага -->
            <button
              class="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors"
              :class="[
                stepIdx === currentStepIndex
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
                  : stepIdx < currentStepIndex
                    ? 'bg-success/10 text-healing'
                    : 'text-dimmed',
                stepIdx > currentStepIndex
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-accented/30',
              ]"
              :disabled="stepIdx > currentStepIndex"
              @click.left.exact.prevent="goToStep(stepIdx)"
            >
              <span class="hidden sm:inline">{{ step.title }}</span>
            </button>
          </template>
        </div>

        <!-- Контент текущего шага -->
        <div class="min-h-50 space-y-3">
          <!-- ХП -->
          <WizardStepHitPoints
            v-if="activeStepKey === 'hitPoints'"
            :class-definition="classDefinition"
            :next-level="nextLevel"
            :is-max-hit-die-level="isMaxHitDieLevel"
            :hit-point-value="wizardState.hitPoints.value"
            :hit-point-method="wizardState.hitPoints.method"
            :average-hit-points="averageHitPoints"
            @update:hit-points="handleHitPointsUpdate"
          />

          <!-- Спасброски -->
          <WizardStepSavingThrows
            v-if="activeStepKey === 'savingThrows'"
            :class-definition="classDefinition"
            :is-first-class="isFirstClass"
          />

          <!-- Владения -->
          <WizardStepProficiencies
            v-if="activeStepKey === 'proficiencies'"
            v-model:tool-proficiencies="wizardState.toolProficiencies"
            :class-definition="classDefinition"
            :is-first-class="isFirstClass"
            :is-multiclass="isMulticlass"
            :socket="socket"
          />

          <!-- Навыки -->
          <WizardStepSkills
            v-if="activeStepKey === 'skills'"
            :available-skills="availableSkills"
            :selected-skills="wizardState.selectedSkills"
            :max-count="skillChoicesCount"
            :already-proficient-skills="alreadyProficientSkills"
            @update:selected-skills="handleSkillsUpdate"
          />

          <!-- Стартовое снаряжение (только на 1 уровне класса) -->
          <WizardStepClassEquipment
            v-if="
              activeStepKey === 'equipment' && classDefinition.startingEquipment
            "
            v-model:selected-index="wizardState.selectedEquipmentIndex"
            :options="classDefinition.startingEquipment"
          />

          <!-- Умения: и всё, о чём уровень спрашивает, — в строке того, кто
            спрашивает -->
          <WizardStepFeatures
            v-if="activeStepKey === 'features'"
            :rows="levelRows"
            :feature-choices="wizardState.featureChoices"
            :feat-selections="wizardState.featDataChoices"
            :feature-skills="wizardState.selectedFeatureSkills"
            :has-subclass-selection="hasSubclassSelection"
            :subclasses="classDefinition.subclasses"
            :subclass-key="wizardState.subclassKey"
            :subclass-label="classDefinition.subclassLabel"
            :feats="compendiumFeats"
            :actor="actor"
            :proficiency-bonus="featChoiceProficiencyBonus"
            :spells="featChoiceSpells"
            :granted-spells="resolvedGrantedSpells"
            @update:feature-choices="handleFeatureChoicesUpdate"
            @update:subclass-key="wizardState.subclassKey = $event"
            @update:feat-selection="handleFeatSelection"
            @update:feat-selections="handleFeatSelectionsUpdate"
            @update:feature-skills="handleFeatureSkillsUpdate"
            @open-spell="openSpellDetail"
          />

          <!-- ASI -->
          <WizardStepAsi
            v-if="activeStepKey === 'asi'"
            :current-abilities="resolvedAbilities"
            :asi-state="wizardState.asi"
            :feats="compendiumFeats"
            :actor="actor"
            :feat-choice="asiFeatChoice"
            @update:asi-state="handleAsiUpdate"
          />
        </div>
      </div>
    </template>

    <template #footer>
      <!-- Пока класс грузится, из навигации осмысленна одна «Отмена» -->
      <div
        v-if="loading"
        class="flex justify-end"
      >
        <UButton
          variant="ghost"
          color="neutral"
          @click.left.exact.prevent="isOpen = false"
        >
          {{ MODAL_BUTTON_LABELS.cancel }}
        </UButton>
      </div>

      <!-- Навигация: Назад / Далее / Применить -->
      <div
        v-else
        class="flex justify-between"
      >
        <UButton
          v-if="!isFirstStep"
          variant="ghost"
          color="neutral"
          icon="tabler:arrow-left"
          @click.left.exact.prevent="prevStep"
        >
          {{ MODAL_BUTTON_LABELS.back }}
        </UButton>

        <!-- Пустой спейсер если нет кнопки «Назад» -->
        <div
          v-else
          class="w-1"
        />

        <div class="flex gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            @click.left.exact.prevent="isOpen = false"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            v-if="!isLastStep"
            color="primary"
            :disabled="!canProceed"
            @click.left.exact.prevent="nextStep"
          >
            {{ MODAL_BUTTON_LABELS.next }}
            <template #trailing>
              <UIcon name="tabler:arrow-right" />
            </template>
          </UButton>

          <UButton
            v-else
            color="primary"
            :disabled="!canProceed"
            @click.left.exact.prevent="handleApplyClick"
          >
            {{ applyButtonLabel }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
