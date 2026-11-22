<script setup lang="ts">
  import type { ChoicePickerOption } from '../../ChoicePickerModal.vue';
  import type {
    WizardFeatureReplacement,
    WizardFeatureReplacementOffer,
  } from './useClassWizard';

  import { computed } from 'vue';

  import ChoicePickerField from '../../ChoicePickerField.vue';
  import { CLASS_WIZARD_LABELS } from '../../constants';
  import { toFeatureChoicePickerOption } from './featureChoiceOptions';

  /**
   * Замена одного взятого раньше варианта умения: что убрать и на что заменить.
   * Колдун 2024, получая уровень, может поменять одно воззвание на другое.
   *
   * Замена необязательна: пока «что убрать» не названо, её нет. Названное
   * убираемое без варианта взамен шаг не пропустит — иначе игрок ушёл бы с
   * уровня, потеряв воззвание.
   *
   * Вариант, отмеченный новым на этом уровне, взамен не предлагается, а взятый
   * взамен — не предлагается новым (это делает строка уровня): один и тот же
   * вариант дважды не берут.
   */
  const props = defineProps<{
    offer: WizardFeatureReplacementOffer;
    /** Задуманная замена; нет — игрок её не начинал */
    replacement?: WizardFeatureReplacement;
    /** Ключи вариантов, выбранных новыми на этом уровне */
    newChoiceKeys: ReadonlyArray<string>;
  }>();

  const emit = defineEmits<{
    'update:replacement': [
      featureKey: string,
      replacement: WizardFeatureReplacement,
    ];
  }>();

  /** Взятое раньше — из него убирают один вариант */
  const removableOptions = computed<ChoicePickerOption[]>(() =>
    props.offer.removable.map(toFeatureChoicePickerOption),
  );

  /** Чем можно заменить: без вариантов, отмеченных новыми на этом уровне */
  const replacementOptions = computed<ChoicePickerOption[]>(() =>
    props.offer.options
      .filter((choice) => !props.newChoiceKeys.includes(choice.key))
      .map(toFeatureChoicePickerOption),
  );

  const removedKey = computed(() => props.replacement?.removedKey ?? null);
  const addedKey = computed(() => props.replacement?.addedKey ?? null);

  const removedSelection = computed(() =>
    removedKey.value ? [removedKey.value] : [],
  );

  const addedSelection = computed(() =>
    addedKey.value ? [addedKey.value] : [],
  );

  /**
   * Запоминает, что убрать. Снятое убираемое снимает и вариант взамен: без
   * первого второй ничего не значит.
   *
   * @param values - отмеченные ключи (берут один)
   */
  function selectRemoved(values: string[]): void {
    const nextRemovedKey = values[0] ?? null;

    emit('update:replacement', props.offer.featureKey, {
      removedKey: nextRemovedKey,
      addedKey: nextRemovedKey ? addedKey.value : null,
    });
  }

  /**
   * Запоминает, на что заменить.
   *
   * @param values - отмеченные ключи (берут один)
   */
  function selectAdded(values: string[]): void {
    emit('update:replacement', props.offer.featureKey, {
      removedKey: removedKey.value,
      addedKey: values[0] ?? null,
    });
  }

  /** Отказ от замены: обе стороны снимаются разом */
  function cancelReplacement(): void {
    emit('update:replacement', props.offer.featureKey, {
      removedKey: null,
      addedKey: null,
    });
  }
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-md border border-default/50 bg-elevated/30 p-3"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span class="text-sm font-medium text-toned">
        {{ CLASS_WIZARD_LABELS.replacementTitle }}
      </span>

      <span class="text-xs text-dimmed">
        {{ CLASS_WIZARD_LABELS.replacementOptional }}
      </span>

      <UButton
        v-if="removedKey"
        :label="CLASS_WIZARD_LABELS.replacementCancel"
        icon="tabler:x"
        color="neutral"
        variant="ghost"
        size="xs"
        class="ml-auto"
        @click.left.exact.prevent="cancelReplacement"
      />
    </div>

    <ChoicePickerField
      :label="CLASS_WIZARD_LABELS.replacementRemove"
      :subtitle="props.offer.featureName"
      :options="removableOptions"
      :selected="removedSelection"
      :max="1"
      @update:selected="selectRemoved"
    />

    <ChoicePickerField
      v-if="removedKey"
      :label="CLASS_WIZARD_LABELS.replacementAdd"
      :subtitle="props.offer.featureName"
      :options="replacementOptions"
      :selected="addedSelection"
      :max="1"
      :empty-text="CLASS_WIZARD_LABELS.replacementNoOptions"
      @update:selected="selectAdded"
    />
  </div>
</template>
