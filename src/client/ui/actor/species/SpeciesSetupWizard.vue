<script setup lang="ts">
  import type { TypedWebSocketClient } from '@vtt/shared';
  import type { DnDActor, SpeciesDefinition } from '@vtt/shared/system/dnd.js';

  import { computed, ref, toRef, watch } from 'vue';

  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { Z_INDEX } from '@/shared_ui/consts';

  import { useFeatChoiceFeats } from '../../../composables/useFeatChoiceFeats';
  import { useFeatChoiceSpells } from '../../../composables/useFeatChoiceSpells';
  import { useSpeciesGrantedSpellsResolver } from '../../../composables/useSpeciesGrantedSpellsResolver';
  import { MODAL_BUTTON_LABELS, SPECIES_WIZARD_LABELS } from '../constants';
  import { useSpeciesWizard } from './useSpeciesWizard';
  import WizardStepFeatures from './WizardStepFeatures.vue';
  import WizardStepGrants from './WizardStepGrants.vue';
  import WizardStepOverview from './WizardStepOverview.vue';
  import WizardStepSubspecies from './WizardStepSubspecies.vue';

  const props = defineProps<{
    open: boolean;
    actor: DnDActor;
    speciesDefinition: SpeciesDefinition | null;
    previousSpeciesDefinition?: SpeciesDefinition | null;
    /** Прежний подвид-запись — для точного отката при смене вида */
    previousSubspeciesDefinition?: SpeciesDefinition | null;
    /** Все записи видов (мир + компендиум) — из них собираются подвиды */
    speciesRecords: SpeciesDefinition[];
    /** Сокет для загрузки granted-заклинаний из компендиума */
    socket: TypedWebSocketClient | null;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'apply': [
      systemUpdates: Partial<DnDActor['system']>,
      rootUpdates: Partial<DnDActor>,
    ];
  }>();

  const isOpen = computed({
    get: () => props.open,
    set: (value) => emit('update:open', value),
  });

  const actorRef = computed(() => props.actor);
  const speciesDefRef = computed(() => props.speciesDefinition);
  const speciesRecordsRef = computed(() => props.speciesRecords);

  /**
   * Черты компендиума — пул выбора черты в дарах вида («Универсальность»
   * человека просит черту происхождения) и записи черт, выдаваемых без выбора.
   * Мастеру они нужны дважды: пикеру — показать список, `buildUpdates` — взять
   * дары выбранной черты, поэтому каталог создаётся до мастера и отдаётся ему.
   */
  const needsFeats = ref(false);

  const { feats: featChoiceFeats } = useFeatChoiceFeats(
    toRef(props, 'socket'),
    needsFeats,
  );

  const {
    state,
    steps,
    currentStepIndex,
    currentStep,
    nextStep,
    prevStep,
    canProceed,
    isFinalStep,
    grantedSpellSources,
    subspeciesOptions,
    featDataSources,
    featPickChoices,
    needsCompendiumFeats,
    proficiencyBonus,
    buildUpdates,
  } = useSpeciesWizard(
    actorRef,
    speciesDefRef,
    speciesRecordsRef,
    featChoiceFeats,
  );

  // Надобность каталога знает мастер, а грузит его composable выше: связываем
  // их через флаг — иначе получилась бы ссылка на ещё не созданный мастер
  watch(needsCompendiumFeats, (value) => (needsFeats.value = value), {
    immediate: true,
  });

  /** Granted-заклинания особенностей вида с данными из компендиума (по пакам) */
  const { resolvedGrantedSpells } = useSpeciesGrantedSpellsResolver(
    toRef(props, 'socket'),
    grantedSpellSources,
  );

  /**
   * Все вопросы одним списком — только для загрузки каталога заклинаний: пул
   * выбора и проверка готовности обязаны смотреть на один и тот же список.
   * Вопросы выбранной черты сюда тоже входят: «Посвящённый в магию» черта
   * происхождения, и заговоры ей выбирают прямо здесь.
   */
  const allPreparedFeatChoices = computed(() => [
    ...featDataSources.value.flatMap((source) => source.preparedChoices),
    ...featPickChoices.value.flatMap((pick) => pick.ownChoices),
  ]);

  /** Заклинания каталога для выборов даров (заговор эльфа и подобные) */
  const { spells: featChoiceSpells } = useFeatChoiceSpells(
    toRef(props, 'socket'),
    allPreparedFeatChoices,
  );

  watch(
    () => props.open,
    (newVal) => {
      if (newVal) {
        currentStepIndex.value = 0;
      }
    },
  );

  function handleCancel() {
    isOpen.value = false;
  }

  const activeStepKey = computed(() => currentStep.value?.key);

  function goToStep(index: number) {
    currentStepIndex.value = index;
  }

  function handleApply() {
    if (!canProceed.value) {
      return;
    }

    // Если мы не на последнем шаге - просто идем дальше
    if (!isFinalStep.value) {
      nextStep();

      return;
    }

    const { systemUpdates, rootUpdates } = buildUpdates(
      props.previousSpeciesDefinition,
      resolvedGrantedSpells.value,
      props.previousSubspeciesDefinition,
    );

    emit('apply', systemUpdates, rootUpdates);
    isOpen.value = false;
  }
</script>

<template>
  <UDraggableModal
    v-model:open="isOpen"
    :draggable="false"
    :resizable="false"
    :blocking="true"
    :min-width="800"
    :initial-width="800"
    :min-height="400"
    :title="SPECIES_WIZARD_LABELS.title"
    :z-index="Z_INDEX.MODAL_ELEVATED * 2"
  >
    <template #body>
      <div
        v-if="speciesDefinition"
        class="flex flex-col gap-4"
      >
        <!-- Инфо о виде -->
        <div class="rounded-lg border border-default/50 bg-elevated/30 p-3">
          <div>
            <h3 class="text-lg font-medium text-highlighted">
              {{ speciesDefinition.name }}
            </h3>

            <p class="text-sm text-dimmed">
              {{ SPECIES_WIZARD_LABELS.subtitle }}
            </p>
          </div>
        </div>

        <!-- Индикатор прогресса (шаги) -->
        <div
          v-if="steps.length > 1"
          class="flex items-center gap-1"
        >
          <template
            v-for="(step, stepIdx) in steps"
            :key="step.key"
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
        <div class="min-h-50">
          <WizardStepOverview
            v-if="activeStepKey === 'overview'"
            v-model:state="state"
            :species-definition="speciesDefinition"
          />

          <WizardStepSubspecies
            v-if="activeStepKey === 'subspecies'"
            v-model:state="state"
            :subspecies-options="subspeciesOptions"
          />

          <WizardStepGrants
            v-if="activeStepKey === 'grants'"
            v-model:state="state"
            :species-definition="speciesDefinition"
          />

          <WizardStepFeatures
            v-if="activeStepKey === 'features'"
            v-model:state="state"
            :species-definition="speciesDefinition"
            :granted-spells="resolvedGrantedSpells"
            :actor="actor"
            :proficiency-bonus="proficiencyBonus"
            :feat-data-sources="featDataSources"
            :feat-choice-spells="featChoiceSpells"
            :feat-picks="featPickChoices"
            :feat-choice-feats="featChoiceFeats"
          />
        </div>
      </div>

      <div
        v-else
        class="flex h-full items-center justify-center p-8"
      >
        <UIcon
          name="tabler:loader-2"
          class="animate-spin text-3xl text-dimmed"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between">
        <UButton
          color="neutral"
          variant="ghost"
          icon="tabler:arrow-left"
          :class="{ invisible: currentStepIndex === 0 }"
          @click.left.exact.prevent="prevStep"
        >
          {{ MODAL_BUTTON_LABELS.back }}
        </UButton>

        <div class="flex gap-2">
          <UButton
            variant="ghost"
            color="neutral"
            @click.left.exact.prevent="handleCancel"
          >
            {{ MODAL_BUTTON_LABELS.cancel }}
          </UButton>

          <UButton
            v-if="!isFinalStep"
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
            @click.left.exact.prevent="handleApply"
          >
            {{ MODAL_BUTTON_LABELS.apply }}
          </UButton>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
