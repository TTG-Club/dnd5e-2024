<!--
  Панель активных эффектов сущности — общая для листа персонажа и листа
  существа: свои эффекты, эффекты работающего снаряжения и особенностей
  существа и сетка состояний D&D 5e. Шкала Истощения живёт отдельно — в левой
  колонке под здоровьем.

  Оба листа показывают эффекты одинаково, поэтому разметка живёт здесь одна.
  Лист отдаёт свои эффекты и себя, а обратно получает новый список эффектов —
  как именно его сохранять, решает сам лист.

  Эффект «при применении» вместо переключателя получает кнопку «Применить»: его
  копия ложится на владельца или цель. Переключаемый эффект при включении
  тратит ресурс листа и будит срабатывания «При включении» — это идёт боевым
  каналом, потому что срабатывания меняют и хиты.
-->
<script setup lang="ts">
  import type {
    ActiveEffect,
    ActorCounterState,
    CarriedEffectEntry,
    ConditionRef,
    DnDGameItem,
    DnDSceneEntity,
  } from '@vtt/shared/system/dnd.js';

  import { useToast } from '@nuxt/ui/composables';
  import { computed, ref } from 'vue';

  import { emitEntityCombatState } from '@/core/entityUtils';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useItemsStore } from '@/stores/itemsStore';
  import { getActiveSocket } from '@/system-runtime/activeSocket';
  import {
    activateEffectOnEntity,
    advanceEffectStage,
    buildEffectUseSpell,
    buildRuntimeConditionRecord,
    canAdvanceEffectStage,
    canPayActivation,
    describeEscapeUnavailable,
    dnd5eSystemInstance,
    formatEffectEscapeLabel,
    formatEffectStageLabel,
    hasEffectActiveAction,
    isEffectDormant,
    isToggleActivatedEffect,
    isUseActivatedEffect,
    listCarriedEffectEntries,
    listSelectableConditions,
    payActivation,
    resolveActorStats,
    runEffectActiveAction,
  } from '@vtt/shared/system/dnd.js';

  import { applyEffectSource } from '../../composables/effectActivationUse';
  import { runEffectEscape } from '../../composables/effectEscapeAction';
  import { resolveCombatRound } from '../../composables/encounterTurn';
  import { requestEndCasts } from '../../composables/spellCasts';
  import { stampEffectOnApply } from '../../composables/spellResolutionShared';
  import { useActiveEffectModal } from '../../composables/useActiveEffectModal';
  import { useEntityActiveEffects } from '../../composables/useEntityActiveEffects';
  import { CONDITION_MODALS } from '../condition/conditionConsts';
  import ActiveEffectFormModal from '../effect/ActiveEffectFormModal.vue';
  import {
    EFFECT_ACTIVE_ACTION_LABELS,
    EFFECT_CHARGES_LABELS,
    EFFECT_ESCAPE_LABELS,
    EFFECT_STAGE_LABELS,
    EFFECT_USE_LABELS,
  } from '../effect/constants';
  import { formatActiveActionLabel } from '../effect/utils/activeActionLabel';
  import {
    ACTIVE_EFFECT_DEFAULTS,
    ACTIVE_EFFECT_ICON_CLASS,
    ACTIVE_EFFECT_OPEN_HINT,
    CARRIED_EFFECT_BADGES,
    CONCENTRATION_END_LABEL,
    EFFECTS_TAB_LABELS,
    MODAL_BUTTON_LABELS,
  } from './constants';

  interface Props {
    /** Активные эффекты сущности */
    effects: readonly ActiveEffect[];
    /** Лист в режиме правки: доступны добавление, правка и удаление */
    isEditMode: boolean;
    /**
     * Сущность-владелец: на неё ложатся применённые эффекты, на ней
     * выполняются срабатывания включения, её снаряжение и особенности —
     * источник раздела «От снаряжения и особенностей». Нет — эффекты только
     * переключаются
     */
    owner?: DnDSceneEntity;
    /** Ресурсы листа, которые тратят применение и включение */
    counters?: readonly ActorCounterState[];
  }

  const props = withDefaults(defineProps<Props>(), {
    owner: undefined,
    counters: () => [],
  });

  const emit = defineEmits<{
    /** Новый список эффектов сущности */
    'update:effects': [effects: ActiveEffect[]];
    /** Ресурсы после оплаты применения или включения */
    'update:counters': [counters: ActorCounterState[]];
  }>();

  const effectsRef = computed(() => props.effects);

  /**
   * Прерывает концентрацию: сервер закончит каст метки у всех существ и снимет
   * его зону. Сама метка уходит тем же исходом.
   *
   * @param effect - метка концентрации
   */
  function endConcentration(effect: ActiveEffect): void {
    if (effect.concentration && effect.castId && effect.sourceActorId) {
      requestEndCasts(effect.sourceActorId, [effect.castId]);
    }
  }

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

  const toast = useToast();

  /**
   * Недоступна ли кнопка «Применить»: правка листа, нет владельца или ресурса.
   *
   * @param effect - эффект с применением
   * @returns `true`, если применить нельзя
   */
  function isApplyDisabled(effect: ActiveEffect): boolean {
    return (
      props.isEditMode
      || !props.owner
      || !canPayActivation(props.counters, effect.activation)
    );
  }

  /**
   * Предупреждает, что ресурса на применение или включение не хватает.
   *
   * @param effect - эффект с применением
   */
  function warnNoCounter(effect: ActiveEffect): void {
    toast.add({
      title: EFFECT_USE_LABELS.noCounterTitle,
      description: `${EFFECT_USE_LABELS.noCounterPrefix}${effect.activation?.counter ?? ''}${EFFECT_USE_LABELS.noCounterSuffix}`,
      color: 'warning',
    });
  }

  /**
   * Тратит ресурс применения или включения.
   *
   * @param effect - эффект с применением
   */
  function payEffectActivation(effect: ActiveEffect): void {
    if (effect.activation?.counter) {
      emit('update:counters', payActivation(props.counters, effect.activation));
    }
  }

  /**
   * Переключает эффект. Переключаемый эффект на листе в просмотре при
   * включении тратит ресурс и будит срабатывания «При включении»; в правке —
   * просто переключается, как любой.
   *
   * @param effect - эффект строки
   */
  function switchEffect(effect: ActiveEffect): void {
    const { owner } = props;
    const socket = getActiveSocket();

    if (
      !isToggleActivatedEffect(effect)
      || !effect.disabled
      || props.isEditMode
      || !owner
      || !socket
    ) {
      toggleEffectStatus(effect);

      return;
    }

    if (!canPayActivation(props.counters, effect.activation)) {
      warnNoCounter(effect);

      return;
    }

    payEffectActivation(effect);

    emitEntityCombatState(
      socket,
      activateEffectOnEntity(
        owner,
        effect.id,
        (activated) =>
          stampEffectOnApply(activated, {
            carrierId: owner.id,
            sourceId: owner.id,
          }),
        resolveCombatRound(),
      ),
    );
  }

  /**
   * Применяет эффект листа: его копия ложится на владельца или цель, ресурс
   * тратится.
   *
   * @param effect - эффект «при применении»
   */
  function applyUseEffect(effect: ActiveEffect): void {
    const { owner } = props;

    if (!owner) {
      return;
    }

    if (!canPayActivation(props.counters, effect.activation)) {
      warnNoCounter(effect);

      return;
    }

    applyEffectSource(
      buildEffectUseSpell(effect),
      owner,
      resolveActorStats(owner).spellSaveDC,
      () => payEffectActivation(effect),
    );
  }

  /**
   * Строки своих эффектов с готовыми подписями: разметка только показывает,
   * а не считает.
   */
  const effectRows = computed(() =>
    customEffects.value.map((effect) => {
      const showsActiveAction =
        hasEffectActiveAction(effect) && !isToggleActivatedEffect(effect);

      return {
        effect,
        stageLabel: formatEffectStageLabel(effect),
        chargesLabel: effect.charges
          ? `${EFFECT_CHARGES_LABELS.title} ${effect.charges.current}${EFFECT_CHARGES_LABELS.separator}${effect.charges.max}`
          : null,
        showsActiveAction,
        activeActionLabel: showsActiveAction
          ? formatActiveActionLabel(effect)
          : '',
      };
    }),
  );

  /**
   * Запускает действие действующего эффекта: его срабатывания «При действии»
   * идут боевым каналом — они меняют и хиты.
   *
   * @param effect - эффект строки
   */
  function runActiveAction(effect: ActiveEffect): void {
    const { owner } = props;
    const socket = getActiveSocket();

    if (!owner || !socket) {
      return;
    }

    emitEntityCombatState(
      socket,
      runEffectActiveAction(owner, effect.id, resolveCombatRound()),
    );
  }

  /**
   * Переводит эффект на следующую ступень: строки и флаги берутся из неё.
   *
   * @param effect - эффект строки
   */
  function advanceStage(effect: ActiveEffect): void {
    const advanced = advanceEffectStage(effect);

    if (advanced) {
      saveEffect(advanced);
    }
  }

  /**
   * Открывает бросок «вырваться»: по успеху эффект (или наложенное им
   * состояние) снимается.
   *
   * @param effect - эффект строки
   */
  function escapeEffect(effect: ActiveEffect): void {
    const { owner } = props;

    if (!owner) {
      return;
    }

    // Причину отказа показывают, а не глотают: иначе кнопка молча не работает
    const unavailable = describeEscapeUnavailable(effect);

    if (unavailable !== null) {
      toast.add({
        title: EFFECT_ESCAPE_LABELS.hint,
        description: `${EFFECT_ESCAPE_LABELS.unavailablePrefix}${unavailable}`,
        color: 'warning',
      });

      return;
    }

    runEffectEscape({
      entity: owner,
      effect,
      flags: dnd5eSystemInstance.getEntityActiveFlags(owner),
      onEscaped: (effectIds) => {
        emit(
          'update:effects',
          props.effects.filter((entry) => !effectIds.includes(entry.id)),
        );
      },
    });
  }

  const effectModalId = 'active-effect-form-modal';
  const isEffectModalOpen = ref(false);
  const effectModalZIndex = ref<number | undefined>(undefined);
  const { getNextZIndex, openModal } = useModalManager();
  const { openActiveEffectDetail } = useActiveEffectModal();

  const editingEffect = ref<ActiveEffect | undefined>(undefined);

  const itemsStore = useItemsStore();

  /**
   * Открывает карточку состояния: описание и вкладка «Эффекты» с разбором того,
   * что состояние накладывает. Плитка состояние ВКЛЮЧАЕТ, поэтому посмотреть, из
   * чего оно состоит, можно только отдельной кнопкой.
   *
   * @param conditionKey - ключ состояния
   */
  function openConditionDetail(conditionKey: ConditionRef): void {
    const record = buildRuntimeConditionRecord(conditionKey);

    if (record) {
      openModal(CONDITION_MODALS.detail, { item: record });
    }
  }

  /**
   * Открывает форму нового состояния прямо с листа: состояние заводится в мире
   * (как из «Мастерской») и сразу появляется в сетке ниже.
   */
  function createCondition(): void {
    openModal(CONDITION_MODALS.form, {
      item: null,
      socket: getActiveSocket(),
      onSave: saveConditionRecord,
    });
  }

  /**
   * Сохраняет состояние, собранное формой, записью мира.
   *
   * @param saved - запись состояния из формы
   */
  function saveConditionRecord(saved: DnDGameItem): void {
    const socket = getActiveSocket();

    if (!socket) {
      return;
    }

    itemsStore.saveItem(socket, saved, true);
  }

  /**
   * Эффекты надетых предметов и особенностей существа — ровно те, что движок
   * применяет к владельцу. Переключателя у них нет: действуют, пока есть
   * источник.
   */
  const carriedEffects = computed<CarriedEffectEntry[]>(() =>
    props.owner ? listCarriedEffectEntries(props.owner) : [],
  );

  /**
   * Состояния сетки. Истощение исключено: у него своя шкала степеней в левой
   * колонке листа, а плитка умела бы только включить первую степень («Мёртв»
   * отсеян раньше — это производная метка, а не выбор игрока).
   */
  const gridConditions = computed(() =>
    listSelectableConditions().filter(
      (condition) => condition.key !== 'exhaustion',
    ),
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
   * Открывает карточку эффекта от предмета или особенности: в карточке
   * подписан источник.
   *
   * @param entry - строка списка эффектов снаряжения и особенностей
   */
  function openCarriedEffectDetail(entry: CarriedEffectEntry): void {
    openActiveEffectDetail(entry.effect, entry.sourceName);
  }

  /**
   * Оформление карточки состояния.
   *
   * @param key - ключ состояния
   * @returns строка классов
   */
  function conditionCardClass(key: ConditionRef): string {
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
  function conditionIconClass(key: ConditionRef): string {
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
    return isEffectDormant(effect)
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
        v-for="{
          effect,
          stageLabel,
          chargesLabel,
          showsActiveAction,
          activeActionLabel,
        } in effectRows"
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
              v-if="stageLabel"
              class="mt-0.5 text-[10px] wrap-break-word text-toned"
            >
              {{ stageLabel }}
            </div>

            <div
              v-if="chargesLabel"
              class="mt-0.5 text-[10px] text-toned"
            >
              {{ chargesLabel }}
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
          <UButton
            v-if="effect.concentration && effect.castId"
            icon="tabler:player-stop"
            size="xs"
            variant="ghost"
            color="warning"
            class="px-1.5"
            :title="CONCENTRATION_END_LABEL"
            @click.left.exact.prevent="endConcentration(effect)"
          />

          <UButton
            v-if="effect.escape"
            icon="tabler:lock-open"
            size="xs"
            variant="soft"
            color="warning"
            class="px-1.5"
            :label="formatEffectEscapeLabel(effect)"
            :title="EFFECT_ESCAPE_LABELS.hint"
            :disabled="isEditMode || !owner"
            @click.left.exact.prevent="escapeEffect(effect)"
          />

          <UButton
            v-if="canAdvanceEffectStage(effect)"
            icon="tabler:stairs-up"
            size="xs"
            variant="ghost"
            color="neutral"
            class="px-1.5"
            :title="EFFECT_STAGE_LABELS.advanceHint"
            :disabled="isEditMode"
            @click.left.exact.prevent="advanceStage(effect)"
          />

          <UButton
            v-if="showsActiveAction"
            icon="tabler:bolt"
            size="xs"
            variant="soft"
            color="primary"
            class="px-1.5"
            :label="activeActionLabel"
            :title="EFFECT_ACTIVE_ACTION_LABELS.hint"
            :disabled="isEditMode || !owner"
            @click.left.exact.prevent="runActiveAction(effect)"
          />

          <UButton
            v-if="isUseActivatedEffect(effect)"
            icon="tabler:player-play"
            size="xs"
            variant="soft"
            color="primary"
            :label="EFFECT_USE_LABELS.apply"
            :title="EFFECT_USE_LABELS.applyHint"
            :disabled="isApplyDisabled(effect)"
            @click.left.exact.prevent="applyUseEffect(effect)"
          />

          <USwitch
            v-else
            :model-value="!effect.disabled"
            size="sm"
            checked-icon="tabler:check"
            unchecked-icon="tabler:x"
            @update:model-value="switchEffect(effect)"
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

  <!-- Эффекты от снаряжения и особенностей -->
  <div
    v-if="carriedEffects.length > 0"
    class="flex flex-col"
  >
    <h3
      class="mt-5 mb-1 text-xs font-semibold tracking-wider text-muted uppercase"
    >
      {{ EFFECTS_TAB_LABELS.fromRecords }}
    </h3>

    <div class="space-y-1">
      <button
        v-for="entry in carriedEffects"
        :key="`${entry.sourceKind}-${entry.sourceName}-${entry.effect.id}`"
        type="button"
        :title="ACTIVE_EFFECT_OPEN_HINT"
        class="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-lg bg-elevated/50 p-2 text-left transition-colors hover:bg-accented/50"
        @click.left.exact.prevent="openCarriedEffectDetail(entry)"
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
            {{ entry.sourceName }}
          </div>
        </div>

        <span
          class="flex shrink-0 items-center gap-1 rounded-full bg-source/10 px-2 py-0.5 text-[10px] text-source"
          :title="EFFECTS_TAB_LABELS.recordBadgeHint"
        >
          <UIcon
            name="tabler:lock"
            class="size-3"
          />
          {{ CARRIED_EFFECT_BADGES[entry.sourceKind] }}
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
        <div :class="conditionCardClass(condition.key)">
          <button
            type="button"
            class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
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

          <!-- Плитка ВКЛЮЧАЕТ состояние, поэтому карточка открывается отдельной
            кнопкой: иначе посмотреть, из чего состояние состоит, было бы нельзя,
            не навесив его на сущность -->
          <UButton
            icon="tabler:info-circle"
            size="xs"
            variant="ghost"
            color="neutral"
            class="shrink-0 px-1"
            :title="EFFECTS_TAB_LABELS.conditionDetailHint"
            @click.left.exact.prevent="openConditionDetail(condition.key)"
          />
        </div>

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

    <UButton
      v-if="isEditMode"
      size="sm"
      color="primary"
      variant="soft"
      icon="tabler:plus"
      block
      class="mt-2"
      @click.left.exact.prevent="createCondition"
    >
      {{ EFFECTS_TAB_LABELS.addCondition }}
    </UButton>
  </div>

  <ActiveEffectFormModal
    v-model:open="isEffectModalOpen"
    :modal-id="effectModalId"
    :z-index="effectModalZIndex"
    :effect="editingEffect"
    context="ownEffects"
    @save="saveEffect"
  />
</template>
