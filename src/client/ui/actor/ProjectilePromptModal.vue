<script setup lang="ts">
  import type { Spell } from '@vtt/shared/system/dnd.js';

  import { computed, onBeforeUnmount, ref, watch } from 'vue';

  import { useProjectileStore } from '@/stores/projectileStore';
  import { useWorldStore } from '@/stores/worldStore';
  import {
    getSpellEffectTargetCount,
    getSpellProjectileCount,
  } from '@vtt/shared/system/dnd.js';

  import {
    ACTOR_SPELLS_TAB_LABELS,
    HUD_PROMPTS_TELEPORT_TARGET,
    PROJECTILE_PROMPT_LABELS,
    SPELL_EFFECT_TARGET_LABELS,
    SPELL_EFFECT_TARGET_MODE,
    SPELL_LEVEL_SUFFIX,
  } from './constants';

  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    open: boolean;
    spell: Spell;
    /** Уровень персонажа-заклинателя (число снарядов заговоров растёт порогами уровня) */
    casterLevel: number;
    availableSpellLevels: number[];
    modalId: string;
    targetingSessionId: number;
    targetMode?: typeof SPELL_EFFECT_TARGET_MODE;
    onConfirm: (selectedLevel: number) => boolean | void;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  const projectileStore = useProjectileStore();
  const worldStore = useWorldStore();
  const initialSceneId = worldStore.currentScene?.id;
  const targetingSessionId = props.targetingSessionId;

  let confirmed = false;

  const ownsTargeting = computed(
    () =>
      projectileStore.isActive
      && projectileStore.sessionId === targetingSessionId,
  );

  /** Окно выбирает разные цели эффекта, а не раздаёт снаряды */
  const isEffectTargetMode = computed(
    () => props.targetMode === SPELL_EFFECT_TARGET_MODE,
  );

  const assignedLabel = computed(() =>
    isEffectTargetMode.value
      ? SPELL_EFFECT_TARGET_LABELS.assignedPrefix
      : PROJECTILE_PROMPT_LABELS.assignedPrefix,
  );

  /** Освобождает только собственный режим: старое окно не отменяет новый каст. */
  function releaseTargeting(): void {
    if (!confirmed && ownsTargeting.value) {
      projectileStore.stopTargeting();
    }
  }

  onBeforeUnmount(releaseTargeting);

  watch(
    [() => props.open, () => worldStore.currentScene?.id, ownsTargeting],
    () => {
      // Подтверждённое окно закрывается само, и выбор целей переходит к
      // следующему шагу каста. Такое закрытие — не отмена: без проверки
      // наблюдатель принял бы его за отмену и закрыл бы окно повторно
      if (confirmed) {
        return;
      }

      if (
        !props.open
        || worldStore.currentScene?.id !== initialSceneId
        || !ownsTargeting.value
      ) {
        handleCancel();
      }
    },
    { immediate: true },
  );

  /** Выбирает первый доступный круг каста. */
  function resolveInitialSpellLevel(): number {
    if (props.availableSpellLevels.length > 0) {
      return props.availableSpellLevels[0];
    }

    if (props.spell.level > 0) {
      return props.spell.level;
    }

    return 0;
  }

  const selectedSpellLevel = ref(resolveInitialSpellLevel());

  const spellLevelItems = computed(() => {
    return props.availableSpellLevels.map((level) => ({
      label: `${level}${SPELL_LEVEL_SUFFIX}`,
      value: level,
    }));
  });

  const calculatedMaxProjectiles = computed(() =>
    isEffectTargetMode.value
      ? getSpellEffectTargetCount(props.spell, selectedSpellLevel.value)
      : getSpellProjectileCount(props.spell, {
          slotLevel: selectedSpellLevel.value,
          casterLevel: props.casterLevel,
        }),
  );

  /** Подсказка режима распределения (свободный режим не подписывается) */
  const distributionHint = computed(() => {
    if (isEffectTargetMode.value) {
      return SPELL_EFFECT_TARGET_LABELS.distinct;
    }

    const distribution = props.spell.projectiles?.targetDistribution;

    if (distribution === 'single') {
      return PROJECTILE_PROMPT_LABELS.distributionSingle;
    }

    if (distribution === 'distinct') {
      return PROJECTILE_PROMPT_LABELS.distributionDistinct;
    }

    return null;
  });

  watch(
    calculatedMaxProjectiles,
    (newMax) => {
      if (ownsTargeting.value) {
        projectileStore.maxProjectiles = newMax;

        if (projectileStore.assignedProjectilesCount > newMax) {
          projectileStore.assignedTargets.clear();
        }
      }
    },
    { immediate: true },
  );

  /**
   * Каст с нулём розданных снарядов применять нечему: серия бросков выходит по
   * пустому списку целей и гаснет без единой строки в чате. Пока цели не
   * выбраны, галочка неактивна — это единственный внятный сигнал игроку.
   */
  const canConfirm = computed(
    () => ownsTargeting.value && projectileStore.assignedProjectilesCount > 0,
  );

  /** Фиксирует цели до закрытия окна; следующий шаг получает их один раз. */
  function handleConfirm(): void {
    if (!canConfirm.value) {
      return;
    }

    if (props.onConfirm(selectedSpellLevel.value) === false) {
      return;
    }

    confirmed = true;
    emit('update:open', false);
    emit('close');
  }

  /** Отменяет выбор без расхода ресурсов заклинателя. */
  function handleCancel(): void {
    releaseTargeting();

    emit('update:open', false);
    emit('close');
  }
</script>

<template>
  <Teleport :to="HUD_PROMPTS_TELEPORT_TARGET">
    <!-- Имитируем внешний вид и анимации из ActionPromptList -->
    <Transition name="slide-up">
      <div
        v-if="open && ownsTargeting"
        class="pointer-events-auto flex w-95 max-w-full flex-col gap-3 rounded-xl border border-default/50 bg-default/90 px-4 py-3 text-highlighted shadow-xl ring-accented backdrop-blur-sm"
      >
        <div class="flex items-center gap-2 border-b border-muted/50 pb-2">
          <UIcon
            name="tabler:wand"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ ACTOR_SPELLS_TAB_LABELS.castConfirmPrefix }}{{ props.spell.name
            }}{{ ACTOR_SPELLS_TAB_LABELS.castConfirmSuffix }}
          </span>
        </div>

        <p class="text-xs text-dimmed">
          {{ PROJECTILE_PROMPT_LABELS.targetingHint }}
        </p>

        <p
          v-if="distributionHint"
          class="text-xs text-dimmed"
        >
          {{ distributionHint }}
        </p>

        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <USelect
              v-if="props.spell.level > 0"
              v-model.number="selectedSpellLevel"
              :items="spellLevelItems"
              value-key="value"
              label-key="label"
              class="w-32"
              size="sm"
              color="neutral"
              variant="outline"
            />

            <span class="text-sm font-bold text-toned">
              {{ assignedLabel
              }}{{ projectileStore.assignedProjectilesCount }} /
              {{ calculatedMaxProjectiles }}
            </span>
          </div>

          <div class="flex items-center gap-2">
            <UButton
              icon="tabler:check"
              color="primary"
              variant="solid"
              size="sm"
              :disabled="!canConfirm"
              @click.left.exact.prevent="handleConfirm"
            />

            <UButton
              icon="tabler:x"
              color="neutral"
              variant="ghost"
              size="sm"
              @click.left.exact.prevent="handleCancel"
            />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
