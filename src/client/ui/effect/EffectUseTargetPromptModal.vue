<!--
  Плашка «На кого применить»: висит, пока применяющий выбирает получателя
  щелчком по фишке на карте — себя или другого («Зелье лечения» выпивают сами
  или вливают другому).
  Показывает, кто выбран и далеко ли он. Дальше предела касания игрок
  применяет только с разрешения ведущего — кнопка тогда просит его, а ответ
  ждёт следующий шаг; сам ведущий применяет к любой фишке.
-->
<script setup lang="ts">
  import type { Spell } from '@vtt/shared/system/dnd.js';

  import { computed, onBeforeUnmount, watch } from 'vue';

  import { useProjectileStore } from '@/stores/projectileStore';
  import { useWorldStore } from '@/stores/worldStore';

  import { checkSpellRangeOnScene } from '../../composables/useSceneRangeCheck';
  import { useWorldEntities } from '../../composables/useWorldEntities';
  import { HUD_PROMPTS_TELEPORT_TARGET } from '../actor/constants';
  import {
    EFFECT_USE_TARGET_ICONS,
    EFFECT_USE_TARGET_LABELS,
  } from './constants';
  import { formatPromptTitle } from './utils/promptTitle';

  defineOptions({
    inheritAttrs: false,
  });

  const props = defineProps<{
    open: boolean;
    modalId: string;
    /** Псевдо-заклинание применения: его имя и предел касания */
    spell: Spell;
    /** Кто применяет: от его фишки меряется расстояние */
    userId: string;
    /** Номер выбора целей на карте, который открыл эту плашку */
    targetingSessionId: number;
    /** Выбрана фишка: отдаёт её и нужна ли просьба к ведущему */
    onConfirm: (tokenId: string, needsGmApproval: boolean) => void;
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'close': [];
    'bringToFront': [];
  }>();

  const projectileStore = useProjectileStore();
  const worldStore = useWorldStore();
  const { findCurrentWorldEntity } = useWorldEntities();
  const initialSceneId = worldStore.currentScene?.id;

  let finished = false;

  /** Выбор на карте всё ещё наш: новый каст мог забрать режим себе */
  const ownsTargeting = computed(
    () =>
      projectileStore.isActive
      && projectileStore.sessionId === props.targetingSessionId,
  );

  const title = computed(() =>
    formatPromptTitle(
      EFFECT_USE_TARGET_LABELS.prompt,
      EFFECT_USE_TARGET_LABELS.titleSeparator,
      props.spell.name,
    ),
  );

  /** Выбранная фишка: получатель один, берётся первая отмеченная */
  const chosenTokenId = computed(() =>
    ownsTargeting.value
      ? ([...projectileStore.assignedTargets.keys()][0] ?? null)
      : null,
  );

  /**
   * Кто выбран и далеко ли он. Расстояние пересчитывается само: фишки
   * двигаются, пока плашка открыта.
   */
  const chosen = computed(() => {
    const tokenId = chosenTokenId.value;

    if (!tokenId) {
      return null;
    }

    const token = worldStore.currentScene?.tokens?.find(
      (entry) => entry.id === tokenId,
    );

    const entity = token ? findCurrentWorldEntity(token.actorId) : undefined;

    const rangeCheck = checkSpellRangeOnScene(
      props.spell,
      props.userId,
      tokenId,
    );

    if (!entity || !rangeCheck) {
      return null;
    }

    return {
      tokenId,
      name: entity.name,
      inReach: rangeCheck.allowed,
      distance: `${rangeCheck.distance} ${rangeCheck.unitLabel}`,
    };
  });

  /** Строка о выбранном: имя и расстояние либо подсказка, что делать */
  const chosenLabel = computed(() =>
    chosen.value
      ? `${chosen.value.name}${EFFECT_USE_TARGET_LABELS.distancePrefix}${chosen.value.distance}`
      : EFFECT_USE_TARGET_LABELS.pickHint,
  );

  const chosenLabelClass = computed(() =>
    chosen.value ? 'text-highlighted' : 'text-dimmed',
  );

  /** Выбранный дальше касания, а применяет не ведущий — нужен ведущий */
  const needsGmApproval = computed(
    () => chosen.value?.inReach === false && !worldStore.isGM,
  );

  /** Дальнего получателя кнопка не применяет, а просит ведущего */
  const confirmLabel = computed(() =>
    needsGmApproval.value
      ? EFFECT_USE_TARGET_LABELS.askGm
      : EFFECT_USE_TARGET_LABELS.apply,
  );

  /** Освобождает выбор на карте, если он ещё наш */
  function releaseTargeting(): void {
    if (ownsTargeting.value) {
      projectileStore.stopTargeting();
    }
  }

  /** Закрывает плашку и отпускает выбор на карте */
  function close(): void {
    finished = true;
    releaseTargeting();
    emit('update:open', false);
    emit('close');
  }

  /** Отдаёт выбранного и закрывает плашку */
  function handleConfirm(): void {
    const target = chosen.value;

    if (!target) {
      return;
    }

    const askGm = needsGmApproval.value;

    close();
    props.onConfirm(target.tokenId, askGm);
  }

  /** Закрытие без выбора: предмет не тратится */
  function handleCancel(): void {
    close();
  }

  onBeforeUnmount(releaseTargeting);

  // Сменилась сцена или выбор на карте забрал другой каст — применять не на
  // кого. Закрытая плашка сюда больше не заходит: `finished` обрывает повтор
  watch(
    [() => props.open, () => worldStore.currentScene?.id, ownsTargeting],
    () => {
      if (finished) {
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
</script>

<template>
  <Teleport :to="HUD_PROMPTS_TELEPORT_TARGET">
    <Transition name="slide-up">
      <div
        v-if="open && ownsTargeting"
        class="pointer-events-auto flex w-95 max-w-full flex-col gap-3 rounded-xl border border-default/50 bg-default/90 px-4 py-3 text-highlighted shadow-xl ring-accented backdrop-blur-sm"
      >
        <div class="flex items-center gap-2 border-b border-muted/50 pb-2">
          <UIcon
            :name="EFFECT_USE_TARGET_ICONS.header"
            class="h-5 w-5 shrink-0 text-toned"
          />

          <span class="min-w-0 text-sm font-medium break-words">
            {{ title }}
          </span>
        </div>

        <p class="text-xs text-dimmed">
          {{ EFFECT_USE_TARGET_LABELS.mapHint }}
        </p>

        <p
          class="text-sm"
          :class="chosenLabelClass"
        >
          {{ chosenLabel }}
        </p>

        <UAlert
          v-if="needsGmApproval"
          :icon="EFFECT_USE_TARGET_ICONS.far"
          color="warning"
          variant="subtle"
          :title="EFFECT_USE_TARGET_LABELS.farTitle"
          :description="EFFECT_USE_TARGET_LABELS.farText"
        />

        <div class="flex items-center justify-center gap-2">
          <UButton
            :label="confirmLabel"
            color="primary"
            variant="solid"
            size="md"
            :disabled="!chosen"
            @click.left.exact.prevent="handleConfirm"
          />

          <UButton
            :label="EFFECT_USE_TARGET_LABELS.cancel"
            color="neutral"
            variant="soft"
            size="md"
            @click.left.exact.prevent="handleCancel"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped src="../hudPromptTransition.css"></style>
