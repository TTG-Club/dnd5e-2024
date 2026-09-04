<script setup lang="ts">
  import type { Feature, TypedWebSocketClient } from '@vtt/shared';
  import type {
    BackgroundDefinition,
    ClassSpellListRequest,
    DnDActor,
    GrantedSpellSource,
  } from '@vtt/shared/system/dnd.js';

  import type { AppliedFeatFeature } from '../feat/featApply';

  import { computed, ref, toRef, watch } from 'vue';

  import { loadCompendiumKind } from '@/core/compendiumDataClient';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import {
    calculateProficiencyBonus,
    collectFeatGrantedClassSpellRequests,
    collectFeatGrantedSpellSources,
    collectGrantedSpellSources,
    getTotalLevel,
  } from '@vtt/shared/system/dnd.js';

  import { useGrantedSpellsResolver } from '../../../composables/useGrantedSpellsResolver';
  import { useSourceLabels } from '../../../composables/useSourceLabel';
  import { resolveStartingEquipment } from '../../../composables/useStartingEquipment';
  import {
    BACKGROUND_WIZARD_LABELS,
    GRANT_SECTION_LABELS,
    MODAL_BUTTON_LABELS,
  } from '../constants';
  import FeatChoicesFields from '../feat/FeatChoicesFields.vue';
  import {
    backgroundSpellSource,
    useBackgroundWizard,
  } from './useBackgroundWizard';
  import WizardStepAbilities from './WizardStepAbilities.vue';
  import WizardStepEquipment from './WizardStepEquipment.vue';
  import WizardStepOverview from './WizardStepOverview.vue';
  import WizardStepTools from './WizardStepTools.vue';

  const props = defineProps<{
    open: boolean;
    actor: DnDActor;
    backgroundDefinition: BackgroundDefinition | null;
    socket: TypedWebSocketClient | null;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [
      systemUpdates: Partial<DnDActor['system']>,
      rootUpdates: Partial<DnDActor>,
    ];
  }>();

  const { getSourceLabel } = useSourceLabels();

  // Для фитов из SRD
  const featsData = ref<Feature[]>([]);
  const isLoadingFeats = ref(false);

  // Композабл мастера. `definition` — нормализованное определение (компендиум
  // отдаёт блоки даров частично); шаги получают именно его, а не сырой проп.
  const {
    definition,
    currentStepInfo,
    selectedScheme,
    abilityAllocation,
    toolSelections,
    grantedTools,
    grantComplete,
    selectedFeatId,
    selectedFeatChoices,
    grantedFeatData,
    askedFeatChoices,
    namedClassKeys,
    featChoiceSpells,
    selectedEquipmentIndex,
    selectedEquipmentItems,
    wizardSteps: wizardStepKeys,
    canProceed,
    nextStep,
    previousStep,
    buildUpdates,
  } = useBackgroundWizard(
    toRef(props, 'backgroundDefinition'),
    toRef(props, 'actor'),
    toRef(props, 'open'),
    toRef(props, 'socket'),
  );

  const wizardSteps = computed(() => {
    const titles: Record<string, string> = {
      overview: BACKGROUND_WIZARD_LABELS.tabOverview,
      featChoices: BACKGROUND_WIZARD_LABELS.tabFeatChoices,
      tools: GRANT_SECTION_LABELS.tools,
      abilities: BACKGROUND_WIZARD_LABELS.tabAbilities,
      equipment: GRANT_SECTION_LABELS.equipment,
    };

    return wizardStepKeys.value.map((key) => ({
      value: key,
      title: titles[key] || key,
    }));
  });

  function goToStep(targetIndex: number) {
    const step = wizardSteps.value[targetIndex];

    if (step) {
      currentStepInfo.value = {
        stepGroup: step.value,
        index: targetIndex + 1,
        total: wizardSteps.value.length,
      };
    }
  }

  function isFeature(value: unknown): value is Feature {
    // Без требования 'source': у записей компендиума есть только sourceKey,
    // проверка source отсеивала ВСЕ черты — грант предыстории уходил заглушкой
    // с пустым описанием.
    return (
      typeof value === 'object'
      && value !== null
      && 'id' in value
      && 'name' in value
      && 'description' in value
    );
  }

  /**
   * Загружает черты компендиума с сервера (агрегировано по всем пакам: бандл +
   * скачиваемые + модули) в `featsData`.
   */
  async function loadFeats(): Promise<void> {
    if (!props.socket) {
      return;
    }

    isLoadingFeats.value = true;

    // CompendiumEntry[] расширяем до unknown[], т.к. Feature не подтип
    // CompendiumEntry и guard иначе не сузит при filter.
    const entries: unknown[] = await loadCompendiumKind(props.socket, 'feat');

    featsData.value = entries.filter(isFeature);
    isLoadingFeats.value = false;
  }

  // Запрашиваем черты с сервера при открытии модалки, если их ещё нет
  watch(
    () => props.open,
    (isOpen) => {
      if (
        !isOpen
        || featsData.value.length > 0
        || !definition.value
        || !props.socket
      ) {
        return;
      }

      void loadFeats();
    },
    { immediate: true },
  );

  /**
   * Выбранная черта целиком — из неё берутся дары и выборы. Список объявлен
   * типом черты: базовый `Feature` о `featData` не знает.
   */
  const selectedFeat = computed(() => {
    const feats: AppliedFeatFeature[] = featsData.value;

    return feats.find((feat) => feat.id === selectedFeatId.value);
  });

  /** Название выбранной черты — заголовок шага её выборов */
  const grantedFeatName = computed(() => selectedFeat.value?.name ?? '');

  const proficiencyBonus = computed(() =>
    calculateProficiencyBonus(getTotalLevel(props.actor.system.classes)),
  );

  /**
   * Дары выбранной черты уезжают в composable: шаги мастера читают их оттуда, а
   * компендиум знает только это окно. Смена черты сбрасывает сделанный выбор —
   * он относился к прежней.
   */
  watch(
    selectedFeat,
    (feat) => {
      grantedFeatData.value = feat?.featData ?? null;

      selectedFeatChoices.value = {};
    },
    { immediate: true },
  );

  /**
   * Заклинания, автоматически предоставляемые предысторией: от выбранной
   * черты-происхождения (`grantedSpells` черты) И от СОБСТВЕННОГО `featData`
   * предыстории. Источники последних помечаются отдельным именем
   * (`backgroundSpellSource`), чтобы откат снимал их раздельно от черты.
   */
  const grantedSpellSources = computed((): GrantedSpellSource[] => {
    const sources: GrantedSpellSource[] = [];

    if (selectedFeat.value) {
      // Заклинания черты живут в её дарах, а выбранные игроком — в ответах шага
      // выборов: и то, и другое выдаётся от имени самой черты, чтобы снятие
      // предыстории забрало их вместе с ней
      sources.push(
        // Лист передаётся ради уровней доступа: заклинание черты, доступное
        // только с третьего уровня, на первом выдаваться не должно
        ...collectFeatGrantedSpellSources(
          {
            name: selectedFeat.value.name,
            featData: selectedFeat.value.featData,
            choices: selectedFeatChoices.value,
          },
          props.actor,
        ),
        ...collectGrantedSpellSources([selectedFeat.value]),
      );
    }

    const def = definition.value;

    if (def?.featData) {
      const ownSources = collectFeatGrantedSpellSources(
        { name: def.name, featData: def.featData },
        props.actor,
      );

      for (const source of ownSources) {
        sources.push({
          ...source,
          featureName: backgroundSpellSource(def.name),
        });
      }
    }

    return sources;
  });

  /**
   * Запросы «выдать весь список класса» — от черты происхождения и от собственных
   * даров предыстории. Заклинаний они не называют: их подберёт резолвер по
   * компендиуму.
   */
  const grantedClassSpellRequests = computed((): ClassSpellListRequest[] => {
    const requests: ClassSpellListRequest[] = [];

    if (selectedFeat.value) {
      requests.push(
        ...collectFeatGrantedClassSpellRequests(
          {
            name: selectedFeat.value.name,
            featData: selectedFeat.value.featData,
            choices: selectedFeatChoices.value,
          },
          props.actor,
        ),
      );
    }

    const def = definition.value;

    if (def?.featData) {
      for (const request of collectFeatGrantedClassSpellRequests(
        { name: def.name, featData: def.featData },
        props.actor,
      )) {
        requests.push({
          ...request,
          featureName: backgroundSpellSource(def.name),
        });
      }
    }

    return requests;
  });

  /** Granted-заклинания выбранной черты с данными из компендиума */
  const { resolvedGrantedSpells } = useGrantedSpellsResolver(
    toRef(props, 'socket'),
    grantedSpellSources,
    grantedClassSpellRequests,
  );

  async function handleApply() {
    const { systemUpdates, rootUpdates } = buildUpdates(
      featsData.value,
      resolvedGrantedSpells.value,
    );

    // Стартовое снаряжение — отдельным шагом после сборки даров: позиции надо
    // сопоставить с компендиумом, а это асинхронно и к остальным дарам
    // отношения не имеет
    const granted = await resolveStartingEquipment(
      props.socket,
      selectedEquipmentItems.value,
    );

    if (granted.length > 0) {
      rootUpdates.equipment = [...(props.actor.equipment ?? []), ...granted];
    }

    emit('apply', systemUpdates, rootUpdates);
    emit('update:open', false);
  }

  function handleModalClose() {
    emit('update:open', false);
  }
</script>

<template>
  <UDraggableModal
    v-bind="$attrs"
    :open="open"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="800"
    :initial-width="800"
    :min-height="400"
    :title="
      definition
        ? `${BACKGROUND_WIZARD_LABELS.titlePrefix}${definition.name}`
        : BACKGROUND_WIZARD_LABELS.fallbackTitle
    "
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div
        v-if="!definition"
        class="p-6 text-center text-muted"
      >
        {{ BACKGROUND_WIZARD_LABELS.empty }}
      </div>

      <div
        v-else
        class="flex flex-col gap-4"
      >
        <!-- Инфо о предыстории -->
        <div class="rounded-lg border border-default/50 bg-elevated/30 p-3">
          <div class="flex items-center gap-3">
            <div>
              <h3 class="text-lg font-medium text-highlighted">
                {{ definition.name }}
              </h3>

              <p class="text-sm text-dimmed">
                {{ BACKGROUND_WIZARD_LABELS.sourcePrefix }}
                <span class="font-medium text-primary">{{
                  getSourceLabel(definition.sourceKey, definition.source)
                  || 'PHB'
                }}</span>
              </p>
            </div>
          </div>
        </div>

        <!-- Индикатор прогресса (шаги) -->
        <div class="flex items-center gap-1">
          <template
            v-for="(step, stepIdx) in wizardSteps"
            :key="step.value"
          >
            <!-- Разделитель между шагами -->
            <div
              v-if="stepIdx > 0"
              class="h-px flex-1"
              :class="
                stepIdx < currentStepInfo.index
                  ? 'bg-primary/60'
                  : 'bg-accented/50'
              "
            />

            <!-- Кружок шага -->
            <button
              class="flex items-center gap-1.5 rounded-full px-2 py-1 text-xs transition-colors"
              :class="[
                stepIdx === currentStepInfo.index - 1
                  ? 'bg-primary/20 text-primary ring-1 ring-primary/40'
                  : stepIdx < currentStepInfo.index - 1
                    ? 'bg-success/10 text-healing'
                    : 'text-dimmed',
                stepIdx > currentStepInfo.index - 1
                  ? 'cursor-not-allowed opacity-60'
                  : 'hover:bg-accented/30',
              ]"
              :disabled="stepIdx > currentStepInfo.index - 1"
              @click.left.exact.prevent="goToStep(stepIdx)"
            >
              <span class="hidden sm:inline">{{ step.title }}</span>
            </button>
          </template>
        </div>

        <!-- Контент текущего шага -->
        <div class="min-h-50">
          <div
            v-if="isLoadingFeats"
            class="flex h-full items-center justify-center p-20"
          >
            <UIcon
              name="tabler:loader-2"
              class="animate-spin text-3xl text-dimmed"
            />
          </div>

          <template v-else>
            <!-- Шаг 1: Обзор -->
            <WizardStepOverview
              v-if="currentStepInfo.stepGroup === 'overview'"
              v-model:selected-feat-id="selectedFeatId"
              :background-definition="definition"
              :feats-data="featsData"
            />

            <!-- Шаг 1.2: Выборы внутри выданной черты («Умелый» просит навыки) -->
            <div
              v-else-if="currentStepInfo.stepGroup === 'featChoices'"
              class="space-y-3"
            >
              <span class="block text-sm font-medium text-toned">
                {{ grantedFeatName }}
              </span>

              <FeatChoicesFields
                v-model="selectedFeatChoices"
                :choices="askedFeatChoices"
                :actor="actor"
                :proficiency-bonus="proficiencyBonus"
                :spells="featChoiceSpells"
                :named-class-keys="namedClassKeys"
              />
            </div>

            <!-- Шаг 1.5: Инструменты (условно) -->
            <WizardStepTools
              v-else-if="currentStepInfo.stepGroup === 'tools'"
              v-model:choice-selections="toolSelections"
              v-model:granted-tools="grantedTools"
              :background-definition="definition"
              :socket="socket"
              @update:grant-complete="grantComplete = $event"
            />

            <!-- Шаг 2: Характеристики -->
            <WizardStepAbilities
              v-else-if="currentStepInfo.stepGroup === 'abilities'"
              v-model:selected-scheme="selectedScheme"
              v-model:ability-allocation="abilityAllocation"
              :background-definition="definition"
              :current-abilities="actor.system.abilities"
            />

            <!-- Шаг 3: Снаряжение -->
            <WizardStepEquipment
              v-else-if="currentStepInfo.stepGroup === 'equipment'"
              v-model:selected-index="selectedEquipmentIndex"
              :equipment-options="definition.equipmentOptions"
            />
          </template>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-between">
        <UButton
          v-if="currentStepInfo.index > 1"
          variant="ghost"
          color="neutral"
          icon="tabler:arrow-left"
          @click.left.exact.prevent="previousStep"
        >
          {{ MODAL_BUTTON_LABELS.back }}
        </UButton>

        <div
          v-else
          class="w-1"
        />

        <div class="flex gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            @click.left.exact.prevent="handleModalClose"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            v-if="currentStepInfo.index < currentStepInfo.total"
            color="primary"
            :disabled="!canProceed || isLoadingFeats"
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
            :disabled="isLoadingFeats"
            @click.left.exact.prevent="handleApply"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
