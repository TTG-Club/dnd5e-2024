<script setup lang="ts">
  import type { CSSProperties } from 'vue';

  import type { ActorClassEntry, DnDActor } from '@vtt/shared/system/dnd.js';

  import { computed, ref } from 'vue';

  import { useImageFallback } from '@/shared_ui/composables';
  import { getAssetUrl } from '@vtt/shared';
  import {
    calculateExperienceForNextLevel,
    formatVisionRange,
    getTotalLevel,
    MAX_LEVEL,
  } from '@vtt/shared/system/dnd.js';

  import ActorHeaderPlaceholder from './ActorHeaderPlaceholder.vue';
  import {
    CREATURE_SIZE_LABELS,
    CREATURE_TYPE_LABELS,
    EDIT_MODE_TOGGLE_TITLE,
    MISSING_SHEET_SECTIONS,
    MODAL_BUTTON_LABELS,
  } from './constants';
  import LevelUpModal from './LevelUpModal.vue';

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
    isCreating?: boolean;
    canEdit?: boolean;
    /** Является ли текущий пользователь ГМ (может менять вдохновение) */
    isAdmin?: boolean;
    worldPort?: number;
  }

  const props = withDefaults(defineProps<Props>(), {
    isCreating: false,
    canEdit: true,
    isAdmin: false,
    worldPort: undefined,
  });

  /** Данные для запуска мастера повышения уровня */
  interface LevelUpWizardPayload {
    /** Очередь уровней, которые нужно провести через мастер */
    queue: Array<{ classKey: string; targetLevel: number }>;
    /** Итоговый опыт персонажа */
    experience: number;
    /** Классы, применяемые без мастера (принудительное повышение) */
    forceApplies: ActorClassEntry[];
  }

  /** Результат повышения уровня из модалки */
  interface LevelUpResult {
    /** Обновлённый набор классов персонажа */
    classes: ActorClassEntry[];
    /** Итоговый опыт персонажа */
    experience: number;
  }

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
    'toggle-edit-mode': [];
    'open-settings': [];
    'short-rest': [];
    'long-rest': [];
    'save': [];
    'close': [];
    'start-wizard': [payload: LevelUpWizardPayload];
    'remove-class': [classKey: string];
  }>();

  // Вычисляемые свойства

  const tokenFrame = computed(() => {
    const frameUrl = props.actor.token?.frameUrl;

    if (!frameUrl) {
      return null;
    }

    return getAssetUrl(frameUrl, props.worldPort);
  });

  // Показ аватара с фолбэком на иконку при пустом/битом пути
  const { showImage: showTokenImage, handleImageError: onTokenImageError } =
    useImageFallback(() => props.actor.token?.imageUrl || props.actor.avatar);

  const tokenImageStyle = computed(() => {
    const token = props.actor.token;
    const textureScale = token?.textureScale ?? 1;
    const textureX = token?.textureX ?? 0.5;
    const textureY = token?.textureY ?? 0.5;
    const rotation = token?.rotation ?? 0;

    // Порядок: translate → scale → rotate (CSS читает справа налево)
    return {
      transform: `translate(${(textureX - 0.5) * 100}%, ${(textureY - 0.5) * 100}%) scale(${textureScale}) rotate(${rotation}deg)`,
      transformOrigin: 'center center',
    };
  });

  /** Описание одного типа зрения для бейджа-тултипа */
  interface VisionEntry {
    /** Иконка типа зрения (Tabler) */
    icon: string;
    /** Название типа зрения */
    label: string;
    /** Дальность в футах (0 = без ограничений) */
    range: number;
  }

  /**
   * Доступные типы зрения актёра из `token.vision`.
   * Расширяемо: при появлении новых типов зрения достаточно добавить запись.
   */
  const visionEntries = computed<VisionEntry[]>(() => {
    const vision = props.actor.token?.vision;

    if (!vision?.enabled) {
      return [];
    }

    const entries: VisionEntry[] = [];

    // Обычное зрение (range === 0 трактуется как без ограничений)
    entries.push({
      icon: 'tabler:eye',
      label: 'Обычное зрение',
      range: vision.range,
    });

    // Тёмное зрение
    if (vision.darkvision > 0) {
      entries.push({
        icon: 'tabler:moon',
        label: 'Тёмное зрение',
        range: vision.darkvision,
      });
    }

    return entries;
  });

  /** Суммарный уровень из всех классов */
  const totalLevel = computed(() => {
    return getTotalLevel(props.actor.system.classes);
  });

  /** Лейбл основного класса: "Воин 5" или "Класс не выбран" */
  const mainClassLabel = computed(() => {
    const classes = props.actor.system.classes;

    if (!classes || classes.length === 0) {
      return '';
    }

    return classes
      .map((entry) => `${entry.className} ${entry.level}`)
      .join(' / ');
  });

  /** Лейбл предыстории: "Послушник" или "" */
  const backgroundLabel = computed(() => {
    return props.actor.system.background?.backgroundName ?? '';
  });

  /**
   * Уточнение вида в скобках: "Гуманоид, Средний".
   *
   * Незнакомый тип или размер (например, из стороннего компендиума) выводим
   * как есть — лучше сырой ключ, чем пустое место в шапке.
   */
  const speciesDetails = computed(() => {
    const species = props.actor.system.species;

    if (!species) {
      return '';
    }

    const creatureType = species.creatureType
      ? CREATURE_TYPE_LABELS[species.creatureType] || species.creatureType
      : '';

    const size = species.size
      ? CREATURE_SIZE_LABELS[species.size] || species.size
      : '';

    return [creatureType, size].filter(Boolean).join(', ');
  });

  const nextLevelXP = computed(() => {
    return calculateExperienceForNextLevel(totalLevel.value);
  });

  const xpProgress = computed(() => {
    if (nextLevelXP.value === 0) {
      return 100;
    }

    return Math.min(
      100,
      Math.max(0, (props.actor.system.experience / nextLevelXP.value) * 100),
    );
  });

  /**
   * Полоса опыта разорвана посередине подписью «X / Y XP», поэтому состоит из
   * двух половин: первая половина прогресса заполняет левый отрезок, вторая —
   * правый. Вместе они читаются как одна непрерывная линия.
   */
  const xpBarLeftWidth = computed(() => Math.min(100, xpProgress.value * 2));

  /** Заполнение правого отрезка полосы опыта, % (см. `xpBarLeftWidth`) */
  const xpBarRightWidth = computed(() =>
    Math.max(0, xpProgress.value * 2 - 100),
  );

  /** Подпись справа от полосы: следующий уровень или «Максимум» на 20-м */
  const nextLevelLabel = computed(() =>
    totalLevel.value >= MAX_LEVEL
      ? 'Максимум'
      : `Уровень ${totalLevel.value + 1}`,
  );

  /** Классы строки опыта: кликабельная только у того, кто может править лист */
  const experienceRowClass = computed(() =>
    props.canEdit
      ? 'cursor-pointer hover:bg-inverted/5 hover:text-toned'
      : 'cursor-default',
  );

  /** Подсказка строки опыта (без правки прав — без подсказки) */
  const experienceRowTitle = computed(() =>
    props.canEdit ? 'Изменить уровень и опыт' : undefined,
  );

  /**
   * Обновляет поле актёра (name, description — корневые поля)
   */
  function updateField(field: keyof DnDActor, value: DnDActor[keyof DnDActor]) {
    emit('update:actor', { [field]: value });
  }

  /** Есть ли у персонажа вдохновение (у старых актёров поле отсутствует → нет) */
  const hasInspiration = computed(
    () => props.actor.system.inspiration === true,
  );

  /**
   * Даёт или забирает вдохновение (только ГМ). По правилам D&D оно либо есть,
   * либо нет — поэтому просто переключаем.
   */
  function toggleInspiration() {
    if (!props.isAdmin) {
      return;
    }

    emit('update:actor', {
      system: {
        ...props.actor.system,
        inspiration: !hasInspiration.value,
      },
    });
  }

  /** Подсказка для блока вдохновения (зависит от роли и текущего состояния) */
  const inspirationTooltip = computed(() => {
    if (!props.isAdmin) {
      return hasInspiration.value
        ? 'У персонажа есть вдохновение'
        : 'У персонажа нет вдохновения';
    }

    return hasInspiration.value ? 'Забрать вдохновение' : 'Дать вдохновение';
  });

  /** Тег блока вдохновения: кнопка у ГМ, обычный блок у игрока */
  const inspirationTag = computed(() => (props.isAdmin ? 'button' : 'div'));

  /** Классы блока вдохновения: активный (золотой) или приглушённый */
  const inspirationClass = computed(() => {
    const interactive = props.isAdmin
      ? 'cursor-pointer hover:border-primary/70'
      : 'cursor-default';

    const state = hasInspiration.value
      ? 'border-primary/60 bg-primary/15 text-primary'
      : 'border-default/50 bg-elevated/30 text-muted';

    return `${interactive} ${state}`;
  });

  /** Стиль шапки: она же — область перетаскивания окна листа */
  const headerStyle = computed<CSSProperties>(() => ({
    cursor: props.canEdit ? 'move' : 'default',
    userSelect: 'none',
  }));

  /** Иконка переключателя режима редактирования (замок открыт/закрыт) */
  const editModeIcon = computed(() =>
    props.isEditMode ? 'tabler:lock-open' : 'tabler:lock-filled',
  );

  /** Цвет переключателя режима редактирования */
  const editModeClass = computed(() =>
    props.isEditMode ? 'text-primary' : 'text-muted hover:text-highlighted',
  );

  // Модалка повышения уровня
  const isLevelUpOpen = ref(false);

  /**
   * Открывает модалку уровня и опыта.
   *
   * Доступна и вне режима редактирования: опыт меняется по ходу игры чаще
   * всего в шапке, ради него незачем снимать замок со всего листа.
   */
  function openLevelUp() {
    if (!props.canEdit) {
      return;
    }

    isLevelUpOpen.value = true;
  }

  /**
   * Применяет изменения уровня (по классам) и опыта
   */
  function onLevelUpApply(result: LevelUpResult) {
    emit('update:actor', {
      system: {
        ...props.actor.system,
        classes: result.classes,
        experience: result.experience,
      },
    });
  }

  /**
   * Пробрасывает запуск мастера повышения уровня на лист персонажа
   */
  function onStartWizard(payload: LevelUpWizardPayload) {
    emit('start-wizard', payload);
  }

  /**
   * Пробрасывает удаление класса на лист персонажа
   */
  function onRemoveClass(classKey: string) {
    emit('remove-class', classKey);
  }

  /**
   * Скрывает рамку токена, если картинка не загрузилась: битый путь не должен
   * оставлять пустой прямоугольник поверх аватара.
   */
  function handleImageError(event: Event) {
    const image = event.target;

    if (image instanceof HTMLImageElement) {
      image.style.display = 'none';
    }
  }
</script>

<template>
  <header
    class="relative overflow-hidden rounded-t-2xl"
    :style="headerStyle"
  >
    <div class="relative z-10 flex w-full items-center gap-6 px-6 pt-8 pb-10">
      <!-- Аватар и Рамка -->
      <div
        class="relative -my-2 flex h-28 w-28 shrink-0 items-center justify-center"
      >
        <!-- Маска аватара под рамку (как в ActorSettingsModal) -->
        <div
          class="relative h-full w-full bg-elevated"
          style="clip-path: circle(44% at 50% 50%); overflow: hidden"
        >
          <img
            v-if="showTokenImage"
            :src="
              getAssetUrl(actor.token?.imageUrl || actor.avatar, worldPort)
              || undefined
            "
            :alt="actor.name"
            class="absolute inset-0 h-full w-full max-w-none object-contain transition-none select-none"
            :style="tokenImageStyle"
            draggable="false"
            @error="onTokenImageError"
          />

          <div
            v-else
            class="absolute inset-0 flex items-center justify-center text-dimmed"
          >
            <UIcon
              name="tabler:user"
              class="h-1/2 w-1/2"
            />
          </div>
        </div>

        <!-- Рамка токена -->
        <img
          v-if="tokenFrame"
          :src="tokenFrame"
          alt="Token frame"
          class="pointer-events-none absolute inset-0 h-full w-full object-contain drop-shadow-xl select-none"
          draggable="false"
          @error="handleImageError"
        />

        <!-- Бейдж зрения (глазик с тултипом о типах зрения актёра) -->
        <UTooltip
          v-if="visionEntries.length > 0"
          :delay-duration="150"
          :content="{ side: 'bottom' }"
          class="absolute -bottom-1 left-1/2 z-20 -translate-x-1/2"
        >
          <div
            class="flex h-6 w-6 cursor-help items-center justify-center rounded-full border border-primary/40 bg-elevated/95 text-primary shadow-md transition-colors hover:border-primary/80"
          >
            <UIcon
              name="tabler:eye"
              class="h-4 w-4"
            />
          </div>

          <!-- Тултип со списком типов зрения -->
          <template #content>
            <div class="flex flex-col gap-1 px-1 py-0.5 text-[11px]">
              <div
                v-for="entry in visionEntries"
                :key="entry.label"
                class="flex items-center gap-1.5 whitespace-nowrap"
              >
                <UIcon
                  :name="entry.icon"
                  class="h-3.5 w-3.5 shrink-0 text-primary"
                />

                <span class="font-medium">{{ entry.label }}:</span>

                <span class="ml-auto text-dimmed">
                  {{ formatVisionRange(entry.range) }}
                </span>
              </div>
            </div>
          </template>
        </UTooltip>
      </div>

      <!-- Основная информация -->
      <div class="flex min-w-0 flex-1 items-center justify-between">
        <div class="w-full min-w-0 flex-1 space-y-1 pr-4">
          <!-- Имя -->
          <div class="flex min-h-11 items-center">
            <UInput
              v-if="isEditMode"
              :model-value="actor.name"
              placeholder="Имя персонажа"
              variant="none"
              size="xl"
              class="w-full"
              :ui="{
                base: 'bg-inverted/5 text-3xl font-serif text-highlighted placeholder:text-dimmed rounded-lg px-3 py-1 focus:bg-inverted/10 transition-colors',
              }"
              @update:model-value="updateField('name', $event)"
            />

            <h2
              v-else
              class="font-serif text-3xl tracking-wide text-highlighted"
            >
              {{ actor.name }}
            </h2>
          </div>

          <!-- Раса и класс -->
          <div
            class="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-toned"
          >
            <span
              v-if="actor.system.species?.speciesName"
              class="text-toned"
              >{{ actor.system.species.speciesName }}
              <span
                v-if="speciesDetails"
                class="text-dimmed"
              >
                ({{ speciesDetails }})
              </span>
            </span>

            <ActorHeaderPlaceholder
              v-else
              :section="MISSING_SHEET_SECTIONS.species"
            />

            <span class="text-dimmed">—</span>

            <span
              v-if="mainClassLabel"
              class="text-toned"
              >{{ mainClassLabel }}</span
            >

            <ActorHeaderPlaceholder
              v-else
              :section="MISSING_SHEET_SECTIONS.class"
            />

            <span class="text-dimmed">—</span>

            <span
              v-if="backgroundLabel"
              class="text-toned"
              >{{ backgroundLabel }}</span
            >

            <ActorHeaderPlaceholder
              v-else
              :section="MISSING_SHEET_SECTIONS.background"
            />
          </div>

          <!-- Уровень и опыт: клик по всей полосе открывает окно уровня -->
          <button
            type="button"
            :disabled="!canEdit"
            class="-mx-2 flex w-full max-w-xl items-center gap-3 rounded-lg px-2 py-1 text-xs font-medium text-muted transition-colors"
            :class="experienceRowClass"
            :title="experienceRowTitle"
            @click.left.exact.prevent="openLevelUp"
          >
            <span class="whitespace-nowrap">Уровень {{ totalLevel }}</span>

            <!-- Полоса опыта: подпись разрывает её посередине -->
            <span class="flex flex-1 items-center gap-2">
              <span class="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
                <span
                  class="block h-full rounded-full bg-linear-to-r from-primary/60 to-primary transition-all duration-300"
                  :style="{ width: `${xpBarLeftWidth}%` }"
                />
              </span>

              <span
                class="text-[11px] tracking-widest whitespace-nowrap text-dimmed"
              >
                {{ actor.system.experience }} / {{ nextLevelXP }} XP
              </span>

              <span class="h-1 flex-1 overflow-hidden rounded-full bg-elevated">
                <span
                  class="block h-full rounded-full bg-primary transition-all duration-300"
                  :style="{ width: `${xpBarRightWidth}%` }"
                />
              </span>
            </span>

            <span class="whitespace-nowrap">{{ nextLevelLabel }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Кнопки управления (правый верхний угол) -->
    <div class="absolute top-4 right-4 z-20 flex items-center gap-2">
      <!-- Кнопка Создать (при создании нового персонажа) -->
      <button
        v-if="isCreating"
        class="flex h-8 items-center gap-1.5 rounded-full border border-success/50 bg-success/80 px-3 text-sm font-medium text-highlighted transition-colors hover:bg-success/70"
        title="Создать персонажа"
        @click.left.exact.prevent="emit('save')"
      >
        <UIcon
          name="tabler:check"
          class="h-4 w-4"
        />
        {{ MODAL_BUTTON_LABELS.create }}
      </button>

      <!-- Toggle Edit Mode (только для существующих персонажей) -->
      <button
        v-else-if="canEdit"
        class="flex h-8 w-8 items-center justify-center rounded-full border border-default/50 bg-elevated/30 transition-colors hover:bg-accented/50"
        :class="editModeClass"
        :title="EDIT_MODE_TOGGLE_TITLE"
        @click.left.exact.prevent="emit('toggle-edit-mode')"
      >
        <UIcon
          :name="editModeIcon"
          class="h-4 w-4"
        />
      </button>

      <!-- Settings Button -->
      <button
        v-if="canEdit && !isCreating"
        class="flex h-8 w-8 items-center justify-center rounded-full border border-default/50 bg-elevated/30 text-muted transition-colors hover:bg-accented/50 hover:text-highlighted"
        title="Настройки токена и прав"
        @click.left.exact.prevent="emit('open-settings')"
      >
        <UIcon
          name="tabler:settings-filled"
          class="h-4 w-4"
        />
      </button>

      <!-- Close Button -->
      <button
        class="flex h-8 w-8 items-center justify-center rounded-full border border-default/50 bg-elevated/30 text-muted transition-colors hover:bg-accented/50 hover:text-highlighted"
        :title="MODAL_BUTTON_LABELS.close"
        @click.left.exact.prevent="emit('close')"
      >
        <UIcon
          name="tabler:x"
          class="h-5 w-5"
        />
      </button>
    </div>

    <!-- Кнопки отдыха и вдохновение (второй ряд, у золотой линии) -->
    <div
      v-if="!isCreating"
      class="absolute right-4 bottom-10 z-20 flex items-center gap-2"
    >
      <!-- Вдохновение: есть/нет, даёт и забирает только ГМ -->
      <UTooltip :text="inspirationTooltip">
        <component
          :is="inspirationTag"
          class="flex h-9 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition-colors"
          :class="inspirationClass"
          @click.left.exact.prevent="toggleInspiration"
        >
          <UIcon
            name="tabler:sparkles"
            class="h-4 w-4"
          />

          Вдохновение
        </component>
      </UTooltip>

      <UTooltip
        v-if="canEdit"
        text="Короткий отдых"
      >
        <UButton
          icon="tabler:campfire"
          color="neutral"
          variant="ghost"
          size="md"
          square
          class="border border-default/50 bg-elevated/30 text-muted hover:bg-accented/50 hover:text-highlighted"
          @click.left.exact.prevent="emit('short-rest')"
        />
      </UTooltip>

      <UTooltip
        v-if="canEdit"
        text="Продолжительный отдых"
      >
        <UButton
          icon="tabler:moon"
          color="neutral"
          variant="ghost"
          size="md"
          square
          class="border border-default/50 bg-elevated/30 text-muted hover:bg-accented/50 hover:text-highlighted"
          @click.left.exact.prevent="emit('long-rest')"
        />
      </UTooltip>
    </div>

    <!-- Декоративный разделитель шапки: цвет акцента приложения -->
    <div class="absolute bottom-0 left-0 mb-1 flex w-full items-center gap-3">
      <div class="h-px flex-1 bg-primary/50" />

      <div class="h-3 w-3 rotate-45 border border-primary opacity-80" />

      <div class="h-px flex-1 bg-primary/50" />
    </div>
  </header>

  <!-- Модалка повышения уровня -->
  <LevelUpModal
    v-model:open="isLevelUpOpen"
    :classes="actor.system.classes"
    :experience="actor.system.experience"
    @apply="onLevelUpApply"
    @start-wizard="onStartWizard"
    @remove-class="onRemoveClass"
  />
</template>
