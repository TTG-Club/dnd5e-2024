<!--
  Панель активных эффектов сущности — общая для листа персонажа и листа
  существа: свои эффекты, эффекты работающего снаряжения и сетка состояний
  D&D 5e. Шкала Истощения живёт отдельно — в левой колонке под здоровьем.

  Оба листа показывают эффекты одинаково, поэтому разметка живёт здесь одна.
  Лист отдаёт свои эффекты и (у персонажа) снаряжение, а обратно получает новый
  список эффектов — как именно его сохранять, решает сам лист.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    ConditionKey,
    DnDGameItem,
  } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import {
    itemEffectsActive,
    SELECTABLE_CONDITIONS,
  } from '@vtt/shared/system/dnd.js';

  import { useActiveEffectModal } from '../../composables/useActiveEffectModal';
  import { useEntityActiveEffects } from '../../composables/useEntityActiveEffects';
  import {
    ACTIVE_EFFECT_DEFAULTS,
    ACTIVE_EFFECT_ICON_CLASS,
    ACTIVE_EFFECT_OPEN_HINT,
    EFFECTS_TAB_LABELS,
    MODAL_BUTTON_LABELS,
  } from './constants';
  import ActiveEffectFormModal from './tabs/ActiveEffectFormModal.vue';

  interface Props {
    /** Активные эффекты сущности */
    effects: readonly ActiveEffect[];
    /** Лист в режиме правки: доступны добавление, правка и удаление */
    isEditMode: boolean;
    /** Снаряжение владельца — у листа существа его нет */
    equipment?: readonly DnDGameItem[];
  }

  const props = withDefaults(defineProps<Props>(), { equipment: () => [] });

  const emit = defineEmits<{
    /** Новый список эффектов сущности */
    'update:effects': [effects: ActiveEffect[]];
  }>();

  const effectsRef = computed(() => props.effects);

  const {
    customEffects,
    isConditionActive,
    toggleCondition,
    saveEffect,
    deleteEffect,
    toggleEffectStatus,
  } = useEntityActiveEffects({
    effects: effectsRef,
    onChange: (nextEffects) => emit('update:effects', nextEffects),
  });

  const effectModalId = 'active-effect-form-modal';
  const isEffectModalOpen = ref(false);
  const effectModalZIndex = ref<number | undefined>(undefined);
  const { getNextZIndex } = useModalManager();
  const { openActiveEffectDetail } = useActiveEffectModal();

  const editingEffect = ref<ActiveEffect | undefined>(undefined);

  /** Эффект работающего предмета с указанием источника */
  interface EquipmentEffectEntry {
    /** Эффект предмета */
    effect: ActiveEffect;
    /** Название предмета-источника */
    itemName: string;
  }

  /**
   * Эффекты работающих предметов — ровно те, что движок применяет к владельцу.
   * Отбор повторяет `collectActiveEffects`: предмет должен быть надет и (при
   * обязательной настройке) настроен, эффекты «цели при атаке» на владельца не
   * действуют, аура без `applyToSelf` — тоже. Иначе список обещал бы бонус,
   * которого на листе нет.
   */
  const equipmentEffects = computed<EquipmentEffectEntry[]>(() => {
    const entries: EquipmentEffectEntry[] = [];

    for (const item of props.equipment) {
      if (!itemEffectsActive(item) || !item.activeEffects) {
        continue;
      }

      for (const itemEffect of item.activeEffects) {
        if (
          itemEffect.disabled
          || itemEffect.effectTarget === 'target'
          || (itemEffect.aura && !itemEffect.aura.applyToSelf)
        ) {
          continue;
        }

        entries.push({ effect: itemEffect, itemName: item.name });
      }
    }

    return entries;
  });

  /**
   * Состояния сетки. Истощение исключено: у него своя шкала степеней в левой
   * колонке листа, а плитка умела бы только включить первую степень («Мёртв»
   * отсеян раньше — это производная метка, а не выбор игрока).
   */
  const gridConditions = computed(() =>
    SELECTABLE_CONDITIONS.filter((condition) => condition.key !== 'exhaustion'),
  );

  function createCustomEffect(): void {
    editingEffect.value = undefined;
    isEffectModalOpen.value = true;
    effectModalZIndex.value = getNextZIndex();
  }

  function editCustomEffect(effect: ActiveEffect): void {
    editingEffect.value = effect;
    isEffectModalOpen.value = true;
    effectModalZIndex.value = getNextZIndex();
  }

  /**
   * Открывает карточку эффекта от надетого предмета: своего носителя такой
   * эффект уже знает, и в карточке он подписан.
   *
   * @param entry - строка списка эффектов снаряжения
   */
  function openEquipmentEffectDetail(entry: EquipmentEffectEntry): void {
    openActiveEffectDetail(entry.effect, entry.itemName);
  }

  /**
   * Оформление карточки состояния.
   *
   * @param key - ключ состояния
   * @returns строка классов
   */
  function conditionCardClass(key: ConditionKey): string {
    const base =
      'flex items-center gap-2 p-2 rounded-lg transition-all duration-200 w-full cursor-pointer';

    if (isConditionActive(key)) {
      return `${base} bg-primary/20 ring-1 ring-primary/40 hover:bg-primary/30`;
    }

    return `${base} bg-accented/30 hover:bg-accented/50`;
  }

  /**
   * Оформление значка состояния.
   *
   * @param key - ключ состояния
   * @returns строка классов
   */
  function conditionIconClass(key: ConditionKey): string {
    const base = 'size-5 shrink-0 transition-colors duration-200';

    return isConditionActive(key)
      ? `${base} text-primary`
      : `${base} text-dimmed`;
  }

  /**
   * Оформление значка эффекта: у отключённого он гаснет.
   *
   * @param effect - эффект строки
   * @returns строка классов
   */
  function effectIconClass(effect: ActiveEffect): string {
    return effect.disabled
      ? ACTIVE_EFFECT_ICON_CLASS.disabled
      : ACTIVE_EFFECT_ICON_CLASS.active;
  }
</script>

<template>
  <!-- Свои эффекты -->
  <div class="flex flex-col gap-2">
    <div
      v-if="customEffects.length === 0"
      class="rounded-lg border border-dashed border-default p-3 text-center text-xs text-dimmed italic"
    >
      {{ EFFECTS_TAB_LABELS.customEmpty }}
    </div>

    <div
      v-else
      class="space-y-1"
    >
      <div
        v-for="effect in customEffects"
        :key="effect.id"
        class="group flex min-h-11 items-center gap-2 rounded-lg bg-elevated/50 p-2 transition-colors hover:bg-accented/50"
        :class="{ 'opacity-50 grayscale': effect.disabled }"
      >
        <!-- Название эффекта открывает карточку разбора: она только показывает,
          что эффект делает, и доступна независимо от режима правки -->
        <button
          type="button"
          :title="ACTIVE_EFFECT_OPEN_HINT"
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
          @click.left.exact.prevent="openActiveEffectDetail(effect)"
        >
          <UIcon
            :name="effect.icon || ACTIVE_EFFECT_DEFAULTS.fallbackIcon"
            class="size-5 shrink-0"
            :class="effectIconClass(effect)"
          />

          <div class="min-w-0 flex-1">
            <div
              class="flex items-center gap-2 text-sm leading-none font-medium"
            >
              <span class="truncate">{{ effect.name }}</span>
            </div>

            <div
              v-if="effect.description"
              class="mt-0.5 text-[10px] wrap-break-word text-dimmed"
            >
              {{ effect.description }}
            </div>
          </div>
        </button>

        <div class="flex shrink-0 items-center gap-1.5">
          <USwitch
            :model-value="!effect.disabled"
            size="sm"
            checked-icon="tabler:check"
            unchecked-icon="tabler:x"
            @update:model-value="toggleEffectStatus(effect)"
          />

          <div
            v-if="isEditMode"
            class="ml-1 flex gap-1"
          >
            <UButton
              icon="tabler:pencil"
              size="xs"
              variant="ghost"
              color="neutral"
              class="px-1.5"
              @click.left.exact.prevent="editCustomEffect(effect)"
            />

            <UButton
              icon="tabler:trash"
              size="xs"
              variant="ghost"
              color="error"
              class="px-1.5"
              @click.left.exact.prevent="deleteEffect(effect.id)"
            />
          </div>
        </div>
      </div>
    </div>

    <UButton
      v-if="isEditMode"
      size="sm"
      color="primary"
      variant="soft"
      icon="tabler:plus"
      block
      class="mt-1"
      @click.left.exact.prevent="createCustomEffect"
    >
      {{ MODAL_BUTTON_LABELS.addEffect }}
    </UButton>
  </div>

  <!-- Эффекты от снаряжения -->
  <div
    v-if="equipmentEffects.length > 0"
    class="flex flex-col"
  >
    <h3
      class="mt-5 mb-1 text-xs font-semibold tracking-wider text-muted uppercase"
    >
      {{ EFFECTS_TAB_LABELS.fromEquipment }}
    </h3>

    <div class="space-y-1">
      <button
        v-for="entry in equipmentEffects"
        :key="`${entry.itemName}-${entry.effect.id}`"
        type="button"
        :title="ACTIVE_EFFECT_OPEN_HINT"
        class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg bg-elevated/50 p-2 text-left transition-colors hover:bg-accented/50"
        @click.left.exact.prevent="openEquipmentEffectDetail(entry)"
      >
        <UIcon
          :name="entry.effect.icon || ACTIVE_EFFECT_DEFAULTS.fallbackIcon"
          class="size-5 shrink-0 text-source"
        />

        <div class="min-w-0 flex-1">
          <div class="truncate text-sm leading-none font-medium">
            {{ entry.effect.name }}
          </div>

          <div class="mt-0.5 truncate text-[10px] text-dimmed">
            {{ entry.itemName }}
          </div>
        </div>

        <span
          class="shrink-0 rounded-full bg-source/10 px-2 py-0.5 text-[10px] text-source"
        >
          {{ EFFECTS_TAB_LABELS.itemBadge }}
        </span>
      </button>
    </div>
  </div>

  <!-- Состояния -->
  <div class="flex flex-col">
    <div class="flex items-center">
      <h3
        class="mt-5 mb-1 text-xs font-semibold tracking-wider text-muted uppercase"
      >
        {{ EFFECTS_TAB_LABELS.conditionsTitle }}
      </h3>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <UPopover
        v-for="condition in gridConditions"
        :key="condition.key"
        mode="hover"
        :open-delay="300"
        :close-delay="100"
      >
        <button
          :class="conditionCardClass(condition.key)"
          type="button"
          @click.left.exact.prevent="toggleCondition(condition.key)"
        >
          <span
            v-if="condition.customImage"
            :class="conditionIconClass(condition.key)"
            :style="{
              maskImage: `url('${condition.customImage}')`,
              WebkitMaskImage: `url('${condition.customImage}')`,
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
              maskPosition: 'center',
              WebkitMaskPosition: 'center',
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
              backgroundColor: 'currentColor',
            }"
          />

          <UIcon
            v-else
            :name="condition.icon"
            :class="conditionIconClass(condition.key)"
          />

          <div class="min-w-0 flex-1 text-left">
            <p class="truncate text-xs leading-tight font-medium">
              {{ condition.nameRu }}
            </p>

            <p class="truncate text-[10px] leading-tight opacity-50">
              {{ condition.nameEn }}
            </p>
          </div>
        </button>

        <template #content>
          <div class="max-w-xs p-3">
            <p class="mb-1 text-xs font-semibold">
              {{ condition.nameRu }}
            </p>

            <p class="text-xs leading-relaxed text-muted">
              {{ condition.description }}
            </p>
          </div>
        </template>
      </UPopover>
    </div>
  </div>

  <ActiveEffectFormModal
    v-model:open="isEffectModalOpen"
    :modal-id="effectModalId"
    :z-index="effectModalZIndex"
    :effect="editingEffect"
    @save="saveEffect"
  />
</template>
