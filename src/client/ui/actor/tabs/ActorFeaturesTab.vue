<script setup lang="ts">
  import type { Feature, TypedWebSocketClient } from '@vtt/shared';
  import type {
    ActiveEffect,
    DnDActor,
    DnDGameItem,
  } from '@vtt/shared/system/dnd.js';

  import type { FeatureOriginKey } from '../constants';
  import type { AppliedFeatFeature } from '../feat/featApply';

  import { computed, ref } from 'vue';

  import { generateEntityId } from '@/core/entityUtils';
  import { startHotbarDrag } from '@/core/utils/hotbarDrag';
  import { ContextMenuDangerItem } from '@/shared_ui/components';
  import { useModalManager } from '@/shared_ui/composables/useModalManager';
  import { useChatStore } from '@/stores/chatStore';
  import { getTotalLevel } from '@vtt/shared/system/dnd.js';

  import { toggleEntityEffect } from '../../../composables/effectToggle';
  import { useFeatModal } from '../../../composables/useFeatModal';
  import {
    DND_MACRO_TYPES,
    FEATURE_TOGGLE_MACRO_ICON,
  } from '../../../macros/constants';
  import { useSystemDataStore } from '../../../stores/systemDataStore';
  import {
    ACTOR_FEATURES_TAB_LABELS,
    FEATURE_GROUP_KEYS,
    FEATURE_ORIGIN_HINTS,
    FEATURE_ORIGIN_LABELS,
    FEATURE_ORIGIN_ORDER,
    FEATURE_TOGGLE_MENU_LABELS,
    FILTER_ROW_CONTROL_SIZE,
    LEVEL_BADGE_SUFFIX,
    SHEET_ROW_MENU_LABELS,
  } from '../constants';
  import { reapplyFeatToActor, removeFeatFromActor } from '../feat/featApply';
  import FeatListItem from '../FeatListItem.vue';
  import {
    findFeatureToggleEffect,
    listFeatureEffects,
    saveFeatureEffects,
  } from '../featureEffects';
  import FilterChip from '../FilterChip.vue';
  import FilterResetButton from '../FilterResetButton.vue';

  interface Props {
    actor: DnDActor;
    isEditMode: boolean;
    /**
     * WebSocket-клиент: окно правки черты берёт из компендиума требуемые
     * записи и выдаваемые заклинания. Без него эти выборы недоступны.
     */
    socket?: TypedWebSocketClient | null;
    isDragOver?: boolean;
    /** Особенность с переключателем можно вынести на панель быстрого доступа */
    allowHotbarDrag?: boolean;
  }

  /** Что возвращает окно особенности */
  interface FeatureFormData {
    name: string;
    description: string;
    level?: number;
    selectedChoiceKey?: string;
    activeEffects: ActiveEffect[];
  }

  const props = defineProps<Props>();

  const emit = defineEmits<{
    'update:actor': [updates: Partial<DnDActor>];
    'immediate-save': [];
  }>();

  /**
   * Запрашивает у хозяина вкладки немедленное сохранение актёра — только вне
   * режима редактирования. В режиме редактирования изменения копятся в
   * локальной копии до «Сохранить»: немедленный push рассинхронизировал бы
   * снапшот отката (последующая «Отмена» затирала бы уже сохранённое).
   */
  function triggerSaveIfNotEdit(): void {
    if (!props.isEditMode) {
      emit('immediate-save');
    }
  }

  const { openModal } = useModalManager();
  const { openFeatDescription } = useFeatModal();
  const systemDataStore = useSystemDataStore();
  const chatStore = useChatStore();

  // --- Контекстное меню ---
  const isContextMenuOpen = ref(false);
  const contextMenuX = ref(0);
  const contextMenuY = ref(0);
  const contextMenuFeature = ref<Feature | null>(null);

  /**
   * Открывает контекстное меню для особенности
   * @param event - событие мыши
   * @param feature - особенность
   */
  function openContextMenu(event: MouseEvent, feature: Feature): void {
    event.preventDefault();
    event.stopPropagation();

    contextMenuX.value = event.clientX;
    contextMenuY.value = event.clientY;
    contextMenuFeature.value = feature;
    isContextMenuOpen.value = true;
  }

  /** Закрывает контекстное меню */
  function closeContextMenu(): void {
    isContextMenuOpen.value = false;
    contextMenuFeature.value = null;
  }

  /** Обрабатывает выбор пункта контекстного меню */
  function handleContextMenuAction(
    action: 'edit' | 'delete' | 'share' | 'toggle',
  ): void {
    if (!contextMenuFeature.value) {
      return;
    }

    if (action === 'edit') {
      editFeature(contextMenuFeature.value);
    } else if (action === 'delete') {
      removeFeature(contextMenuFeature.value);
    } else if (action === 'share') {
      shareFeatureToChat(contextMenuFeature.value);
    } else if (action === 'toggle') {
      switchFeatureEffect(contextMenuFeature.value);
    }

    closeContextMenu();
  }

  /**
   * Отправляет карточку особенности в чат
   * @param feature - особенность для публикации
   */
  function shareFeatureToChat(feature: Feature): void {
    chatStore.sendItemCard({
      cardType: 'feature',
      title: feature.name,
      payload: JSON.stringify(feature),
    });
  }

  /** Суммарный уровень персонажа (для показа видовых особенностей по уровню) */
  const totalLevel = computed(() => getTotalLevel(props.actor.system.classes));

  /** Особенности (от класса, вида, подкласса, кастомные) */
  const regularFeatures = computed(() =>
    props.actor.features.filter((feature) => {
      if (feature.featureType === 'feat') {
        return false;
      }

      // Видовые особенности появляются по достижении своего уровня.
      if (
        feature.featureType === 'species'
        && (feature.level ?? 1) > totalLevel.value
      ) {
        return false;
      }

      return true;
    }),
  );

  /** Черты (feats) */
  const featsList = computed(() =>
    props.actor.features.filter((feature) => feature.featureType === 'feat'),
  );

  /**
   * Выдана ли черта предысторией. Метка живёт на самой особенности
   * (`grantedByBackgroundKey`) — черта при этом обычная, со своим провенансом,
   * и метка говорит лишь о происхождении.
   *
   * @param feature - особенность листа
   */
  function grantedByBackground(feature: AppliedFeatFeature): boolean {
    return Boolean(feature.grantedByBackgroundKey);
  }

  /**
   * Выдана ли черта видом — даром вроде «Универсальности» человека. Метка та же
   * по смыслу, что и у предыстории: черта обычная, снимется вместе с видом.
   *
   * @param feature - особенность листа
   */
  function grantedBySpecies(feature: AppliedFeatFeature): boolean {
    return Boolean(feature.grantedBySpeciesKey);
  }

  // --- Отбор по источнику особенности ---

  /**
   * Источник особенности. Записи без явного типа считаются своими: их заводят
   * руками прямо на листе, и отдельного источника у них нет.
   *
   * @param feature - особенность списка
   * @returns источник для чипа отбора
   */
  function getFeatureOrigin(feature: Feature): FeatureOriginKey {
    const featureType = feature.featureType;

    if (
      featureType === 'species'
      || featureType === 'class'
      || featureType === 'subclass'
      || featureType === 'background'
    ) {
      return featureType;
    }

    return 'custom';
  }

  /** Отмеченные чипами источники; пусто — список не сужается */
  const pickedOrigins = ref<Set<FeatureOriginKey>>(new Set());

  /**
   * Источники, которые есть на вкладке: по ним и отбирают. Черты считаются
   * наравне с остальными — раздел у них свой, но чип в ряду общий.
   */
  const availableOrigins = computed(() => {
    const origins = new Set(regularFeatures.value.map(getFeatureOrigin));

    if (featsList.value.length > 0) {
      origins.add('feat');
    }

    return FEATURE_ORIGIN_ORDER.filter((origin) => origins.has(origin));
  });

  /**
   * Ряд отбора: стоит на вкладке всегда, пока на ней есть хоть одна запись.
   * Единственным чипом список не сузить, зато он сразу говорит, откуда взялось
   * то, что видно ниже, — и вкладка не встречает пустотой.
   */
  const hasFilterControls = computed(() => availableOrigins.value.length > 0);

  /**
   * Действующий отбор: источники считаются от доступных, поэтому выбор,
   * которого в списке уже нет (особенность убрали вместе с последней записью
   * источника), сам собой перестаёт сужать список.
   */
  const activeOrigins = computed(() =>
    availableOrigins.value.filter((origin) => pickedOrigins.value.has(origin)),
  );

  /** Список сужен: отбор есть что сбросить */
  const hasActiveFilter = computed(() => activeOrigins.value.length > 0);

  /**
   * Чипы источников: подпись целиком («Вид», «Предыстория») — ряд коротких
   * слов помещается и на узком листе.
   */
  const originChips = computed(() =>
    availableOrigins.value.map((origin) => ({
      origin,
      label: FEATURE_ORIGIN_LABELS[origin],
      tooltip: FEATURE_ORIGIN_HINTS[origin],
      isPicked: activeOrigins.value.includes(origin),
    })),
  );

  /**
   * Нажатие на чип источника: источники набираются по одному, повторное
   * нажатие снимает источник с отбора.
   *
   * @param origin - источник особенности
   */
  function toggleOriginFilter(origin: FeatureOriginKey): void {
    const nextOrigins = new Set(pickedOrigins.value);

    if (nextOrigins.has(origin)) {
      nextOrigins.delete(origin);
    } else {
      nextOrigins.add(origin);
    }

    pickedOrigins.value = nextOrigins;
  }

  /** Нажатие на «Сбросить»: список возвращается целиком */
  function resetFilters(): void {
    pickedOrigins.value = new Set();
  }

  /** Особенности, прошедшие отбор */
  const displayFeatures = computed(() => {
    if (!hasActiveFilter.value) {
      return regularFeatures.value;
    }

    return regularFeatures.value.filter((feature) =>
      activeOrigins.value.includes(getFeatureOrigin(feature)),
    );
  });

  /**
   * Эффект с переключателем у каждой видимой особенности: такую строку можно
   * вынести на панель быстрого доступа и включать оттуда («Ярость»).
   */
  const toggleEffectByFeatureId = computed(() => {
    const found = new Map<string, ActiveEffect>();

    for (const feature of displayFeatures.value) {
      const effect = findFeatureToggleEffect(props.actor, feature);

      if (effect) {
        found.set(feature.id, effect);
      }
    }

    return found;
  });

  /**
   * Пункт «Включить / Выключить» меню особенности: только вне правки — в
   * правке лист живёт своей копией, и её сохранение вернуло бы переключатель
   * назад. Нет эффекта с переключателем — пункта нет.
   */
  const contextMenuToggleLabel = computed(() => {
    const feature = contextMenuFeature.value;

    if (!feature || props.isEditMode) {
      return undefined;
    }

    const effect = toggleEffectByFeatureId.value.get(feature.id);

    if (!effect) {
      return undefined;
    }

    return effect.disabled
      ? FEATURE_TOGGLE_MENU_LABELS.on
      : FEATURE_TOGGLE_MENU_LABELS.off;
  });

  /**
   * Группы списка: включаемые особенности («Ярость») стоят отдельным разделом
   * сверху — ими пользуются в бою, и искать их среди описаний неудобно.
   * Пустая группа не показывается.
   */
  const featureGroups = computed(() => {
    const toggles = displayFeatures.value.filter((feature) =>
      toggleEffectByFeatureId.value.has(feature.id),
    );

    const rest = displayFeatures.value.filter(
      (feature) => !toggleEffectByFeatureId.value.has(feature.id),
    );

    return [
      {
        key: FEATURE_GROUP_KEYS.toggles,
        title: ACTOR_FEATURES_TAB_LABELS.togglesTitle,
        features: toggles,
      },
      { key: FEATURE_GROUP_KEYS.rest, title: undefined, features: rest },
    ].filter((group) => group.features.length > 0);
  });

  /**
   * Включён ли сейчас эффект особенности.
   *
   * @param feature - особенность
   * @returns `true`, если эффект с переключателем включён
   */
  function isFeatureEffectOn(feature: Feature): boolean {
    const effect = toggleEffectByFeatureId.value.get(feature.id);

    return effect !== undefined && !effect.disabled;
  }

  /**
   * Классы строк особенностей по id: в просмотре строка кликается, включённая
   * особенность подсвечена.
   */
  const featureRowClassById = computed(() => {
    const clickable = props.isEditMode
      ? ''
      : 'cursor-pointer hover:bg-accented/50';

    return new Map(
      displayFeatures.value.map((feature) => {
        const active = isFeatureEffectOn(feature)
          ? 'bg-primary/10 ring-1 ring-primary/50'
          : 'bg-accented/30';

        return [feature.id, `${active} ${clickable}`];
      }),
    );
  });

  /**
   * Включает или выключает эффект особенности — тем же путём, что кнопка
   * панели быстрого доступа: ресурс тратится, срабатывания «при включении»
   * будятся.
   *
   * @param feature - особенность
   */
  function switchFeatureEffect(feature: Feature): void {
    const effect = toggleEffectByFeatureId.value.get(feature.id);

    if (effect && !props.isEditMode) {
      toggleEntityEffect(props.actor.id, effect.id);
    }
  }

  /**
   * Можно ли вынести особенность на панель: лист не в правке, у особенности
   * есть эффект с переключателем.
   *
   * @param feature - особенность
   * @returns `true`, если строку можно перетащить на панель
   */
  function canDragToHotbar(feature: Feature): boolean {
    return (
      props.allowHotbarDrag === true
      && !props.isEditMode
      && toggleEffectByFeatureId.value.get(feature.id) !== undefined
    );
  }

  /**
   * Кладёт на панель быстрого доступа кнопку особенности: нажатие включает или
   * выключает её эффект.
   *
   * @param event - событие dragstart
   * @param feature - особенность
   */
  function handleFeatureDragStart(event: DragEvent, feature: Feature): void {
    const effect = toggleEffectByFeatureId.value.get(feature.id);

    if (!effect || !canDragToHotbar(feature)) {
      return;
    }

    startHotbarDrag(event, {
      id: `${feature.id}:${effect.id}`,
      type: DND_MACRO_TYPES.featureToggle,
      label: feature.name,
      icon: FEATURE_TOGGLE_MACRO_ICON,
      ref: effect.id,
      actorId: props.actor.id,
    });
  }

  /**
   * Виден ли раздел черт. Под отбором без чипа «Черта» он уезжает целиком,
   * вместе с заголовком: пустой раздел под отбором только сбивает с толку.
   * Перенос новой черты от этого не страдает — его принимает весь лист, а не
   * место под заголовком.
   */
  const isFeatsSectionVisible = computed(
    () => !hasActiveFilter.value || activeOrigins.value.includes('feat'),
  );

  /**
   * Виден ли список обычных особенностей: пустым он не показывается вовсе — ни
   * под отбором одних только черт, ни на листе, где особенностей пока нет.
   *
   * Подписи «нет особенностей» на вкладке нет намеренно: пустая строка занимала
   * место, ничего не сообщая, а чего на вкладке нет, видно и так. Подписи «под
   * отбор ничего не подошло» нет по той же причине: чипы идут от самого списка,
   * поэтому у любого отмеченного источника есть хотя бы одна запись.
   */
  const hasVisibleFeatures = computed(() => displayFeatures.value.length > 0);

  /**
   * Ищет определение особенности вида из SRD по имени и источнику.
   * Возвращает объект с choices, если они есть.
   * @param feature - особенность актора
   */
  function findSpeciesFeatureChoices(feature: Feature) {
    if (feature.featureType !== 'species') {
      return undefined;
    }

    // Определяем ключ вида из актора
    const speciesKey = props.actor.system?.species?.speciesKey;

    if (!speciesKey) {
      return undefined;
    }

    const speciesDef = systemDataStore.speciesDefinitions.find(
      (species) => species.key === speciesKey,
    );

    if (!speciesDef) {
      return undefined;
    }

    // Ищем фичу вида по имени (убираем суффикс с выбором из названия)
    const baseName = feature.name.replace(/\s*\(.*\)\s*$/, '').trim();

    const speciesFeature = speciesDef.features.find(
      (srdFeature) => srdFeature.name === baseName,
    );

    if (!speciesFeature?.choices || speciesFeature.choices.length === 0) {
      return undefined;
    }

    // Определяем текущий выбор из featureChoices актора
    const currentChoiceKey =
      props.actor.system?.species?.featureChoices?.[speciesFeature.key];

    return {
      choices: speciesFeature.choices,
      currentChoiceKey,
      speciesFeatureKey: speciesFeature.key,
    };
  }

  /**
   * Получает актуальное SRD-описание для видовой особенности.
   * Если актор был создан до обновления SRD-данных, его описание может быть устаревшим.
   * @param feature - особенность актора
   */
  function getEnrichedDescription(feature: Feature): string {
    if (feature.featureType !== 'species') {
      return feature.description || '';
    }

    const speciesKey = props.actor.system?.species?.speciesKey;

    if (!speciesKey) {
      return feature.description || '';
    }

    const speciesDef = systemDataStore.speciesDefinitions.find(
      (species) => species.key === speciesKey,
    );

    if (!speciesDef) {
      return feature.description || '';
    }

    const baseName = feature.name.replace(/(?:\s*\(.*\)|\s*:.*)$/, '').trim();

    const srdFeature = speciesDef.features.find(
      (srdFeat) => srdFeat.name === baseName,
    );

    if (!srdFeature) {
      return feature.description || '';
    }

    // Берём актуальное SRD-описание и добавляем выбранный вариант, если есть
    let description = srdFeature.description;

    const choiceKey =
      props.actor.system?.species?.featureChoices?.[srdFeature.key];

    if (choiceKey && srdFeature.choices) {
      const selectedChoice = srdFeature.choices.find(
        (choice) => choice.key === choiceKey,
      );

      if (selectedChoice) {
        description += `${ACTOR_FEATURES_TAB_LABELS.selectedChoiceMarkdownPrefix}${selectedChoice.name}\n${selectedChoice.description}`;
      }
    }

    return description;
  }

  /**
   * Открывает модалку с описанием особенности.
   * @param feature - особенность для отображения
   */
  function showDescription(feature: Feature): void {
    if (feature.featureType === 'feat') {
      openFeatDescription(feature);

      return;
    }

    const badges = [];

    if (feature.featureType === 'species') {
      badges.push({
        text: FEATURE_ORIGIN_LABELS.species,
        color: 'primary',
      });
    } else if (feature.level) {
      badges.push({
        text: `${feature.level}${ACTOR_FEATURES_TAB_LABELS.levelBadgeSuffix}`,
        color: 'primary',
      });
    }

    const description = getEnrichedDescription(feature);

    // Вкладка «Эффекты» — только у особенности с эффектами: у умения-описания
    // («Безрассудная атака») пустая вкладка лишь отвлекала бы
    const effects = listFeatureEffects(props.actor, feature);

    openModal('ActorDescriptionModal', {
      _modalKey: feature.id,
      title: feature.nameEn
        ? `${feature.name} (${feature.nameEn})`
        : feature.name,
      description,
      sourceLabel: undefined,
      isSRD: false,
      ...(effects.length > 0 ? { effects } : {}),
      fields: badges.length > 0 ? [{ badges }] : [],
      shareCard: {
        cardType: 'feature',
        title: feature.name,
        payload: JSON.stringify(feature),
      },
    });
  }

  // --- CRUD особенностей ---
  function addFeature() {
    openModal('EntityEditModal', {
      title: ACTOR_FEATURES_TAB_LABELS.add,
      showLevel: true,
      showEffects: true,
      onSave: (data: FeatureFormData) => {
        const id = generateEntityId('feature');

        const placement = saveFeatureEffects(
          props.actor.activeEffects ?? [],
          [],
          id,
          data.activeEffects,
        );

        const newFeature: AppliedFeatFeature = {
          id,
          name: data.name,
          description: data.description,
          level: data.level,
          ...(placement.effectIds.length > 0
            ? { effectIds: placement.effectIds }
            : {}),
        };

        emit('update:actor', {
          features: [...props.actor.features, newFeature],
          activeEffects: placement.activeEffects,
        });

        triggerSaveIfNotEdit();
      },
    });
  }

  /**
   * Редактирует особенность по объекту (находит индекс по id).
   * @param feature - редактируемая особенность
   */
  function createFeatGameItem(feature: AppliedFeatFeature): DnDGameItem {
    return {
      id: feature.id,
      type: 'feat',
      name: feature.name,
      nameEn: feature.nameEn,
      description: feature.description,
      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common',
      equipped: false,
      isReadOnly: false,
      sourceKey: feature.sourceKey,
      isSRD: feature.isSRD,
      repeatable: feature.repeatable,
      repeatableText: feature.repeatableText,
      activeEffects: feature.activeEffects,
      featData: feature.featData,
    };
  }

  function editFeature(feature: Feature) {
    const index = props.actor.features.findIndex(
      (feat) => feat.id === feature.id,
    );

    if (index === -1) {
      return;
    }

    // Пытаемся подтянуть choices из SRD для видовых особенностей
    const choicesData = findSpeciesFeatureChoices(feature);

    if (feature.featureType === 'feat') {
      const oldFeature = props.actor.features[index];

      openModal('FeatFormModal', {
        socket: props.socket,
        feat: createFeatGameItem(oldFeature),
        onSave: (data: DnDGameItem) => {
          const updatedFeat: AppliedFeatFeature = {
            ...oldFeature,
            name: data.name,
            nameEn: data.nameEn,
            description: data.description,
            sourceKey: data.sourceKey,
            isSRD: data.isSRD,
            repeatable: data.repeatable,
            repeatableText: data.repeatableText,
            featureType: 'feat',
            activeEffects: data.activeEffects,
            featData: data.featData,
          };

          // Пере-применяем дары к актору (владения/эффекты/защиты/тёмное зрение
          // пересобираются из новой версии). Уже выданные заклинания черты
          // переносим без компендиума, чтобы не потерять их на правке.
          const carriedSpells = (props.actor.spells ?? [])
            .filter((spell) => spell.grantedByFeature === oldFeature.name)
            .map((spell) => ({ spell, featureName: updatedFeat.name }));

          const result = reapplyFeatToActor(
            props.actor,
            oldFeature,
            updatedFeat,
            carriedSpells,
          );

          emit('update:actor', {
            features: result.features,
            spells: result.spells,
            activeEffects: result.activeEffects,
            system: {
              ...props.actor.system,
              proficiencies: result.proficiencies,
              classCounters: result.classCounters,
            },
            ...(result.token ? { token: result.token } : {}),
          });

          triggerSaveIfNotEdit();
        },
      });

      return;
    }

    const isSrdFeature =
      feature.featureType === 'species' || feature.featureType === 'class';

    const featureEffects = listFeatureEffects(props.actor, feature);

    openModal('EntityEditModal', {
      title: ACTOR_FEATURES_TAB_LABELS.edit,
      initialName: feature.name,
      initialDescription: isSrdFeature
        ? getEnrichedDescription(feature)
        : feature.description,
      initialLevel: feature.level,
      showLevel: true,
      // Если есть choices — передаём их
      choices: choicesData?.choices,
      initialChoiceKey: choicesData?.currentChoiceKey,
      choiceLabel: choicesData
        ? ACTOR_FEATURES_TAB_LABELS.selectedChoice
        : undefined,
      readonlyCore: isSrdFeature,
      // Эффекты особенности — сами эффекты листа: правка тут видна и на
      // вкладке «Эффекты», и наоборот
      showEffects: true,
      initialEffects: featureEffects,
      onSave: (data: FeatureFormData) => {
        const features = [...props.actor.features];

        const placement = saveFeatureEffects(
          props.actor.activeEffects ?? [],
          featureEffects.map((effect) => effect.id),
          feature.id,
          data.activeEffects,
        );

        // Ссылка пишется и пустой: человек видел список эффектов в окне и
        // сохранил его — «эффектов нет» теперь сказано явно, и искать их по
        // названию больше не нужно
        const updated: AppliedFeatFeature = {
          ...features[index],
          name: data.name,
          description: data.description,
          level: data.level,
          effectIds: placement.effectIds,
        };

        features[index] = updated;

        // Если поменяли выбор (наследие и т.п.) — обновляем также featureChoices
        if (choicesData && data.selectedChoiceKey) {
          const selectedOption = choicesData.choices.find(
            (choice) => choice.key === data.selectedChoiceKey,
          );

          if (selectedOption) {
            // Обновляем название особенности с новым выбором
            const baseName = feature.name
              .replace(/(?:\s*\(.*\)|\s*:.*)$/, '')
              .trim();

            features[index].name = `${baseName}: ${selectedOption.name}`;

            // Обновляем featureChoices в system.species
            const currentSpecies = props.actor.system?.species;

            if (currentSpecies) {
              const updatedFeatureChoices = {
                ...currentSpecies.featureChoices,
                [choicesData.speciesFeatureKey]: data.selectedChoiceKey,
              };

              emit('update:actor', {
                features,
                activeEffects: placement.activeEffects,
                system: {
                  ...props.actor.system,
                  species: {
                    ...currentSpecies,
                    featureChoices: updatedFeatureChoices,
                  },
                },
              });

              triggerSaveIfNotEdit();

              return;
            }
          }
        }

        emit('update:actor', {
          features,
          activeEffects: placement.activeEffects,
        });

        triggerSaveIfNotEdit();
      },
    });
  }

  /**
   * Удаляет особенность по объекту (находит по id).
   *
   * Для черты дополнительно откатывает её дары: снимает выданные заклинания,
   * активные эффекты (по провенансу `feat:<id>`) и владения.
   *
   * @param feature - удаляемая особенность
   */
  function removeFeature(feature: Feature) {
    if (feature.featureType === 'feat') {
      const result = removeFeatFromActor(props.actor, feature);

      emit('update:actor', {
        features: result.features,
        spells: result.spells,
        activeEffects: result.activeEffects,
        system: {
          ...props.actor.system,
          proficiencies: result.proficiencies,
          classCounters: result.classCounters,
        },
      });

      triggerSaveIfNotEdit();

      return;
    }

    const features = props.actor.features.filter(
      (feat) => feat.id !== feature.id,
    );

    // Эффекты особенности уходят вместе с ней: это одна сущность
    const { activeEffects } = saveFeatureEffects(
      props.actor.activeEffects ?? [],
      listFeatureEffects(props.actor, feature).map((effect) => effect.id),
      feature.id,
      [],
    );

    emit('update:actor', { features, activeEffects });
    triggerSaveIfNotEdit();
  }
</script>

<template>
  <div class="flex min-h-50 flex-1 flex-col space-y-3">
    <!-- Шапка вкладки одной строкой: слева чипы источников, справа сброс и
      добавление. Ряд тот же, что у снаряжения и заклинаний, и высота у кнопки с
      чипами общая — иначе строка расходится на пару пикселей.

      Отбор по источнику: чипы идут от самого списка — источника, которого в нём
      нет, нет и среди чипов. Ряд держится и с единственным чипом: сузить им
      нечего, но откуда взялось видное ниже — он говорит. Сброс появляется
      только при отборе: пустой кнопке в ряду делать нечего -->
    <div
      v-if="isEditMode || hasFilterControls"
      class="flex flex-wrap items-center gap-x-1.5 gap-y-2"
    >
      <template v-if="hasFilterControls">
        <FilterChip
          v-for="originChip in originChips"
          :key="originChip.origin"
          :label="originChip.label"
          :tooltip="originChip.tooltip"
          :picked="originChip.isPicked"
          @toggle="toggleOriginFilter(originChip.origin)"
        />
      </template>

      <!-- Правый край ряда держится одной группой: при переносе сброс уезжает
        на новую строку вместе с кнопкой, а не отрывается от неё -->
      <div class="ml-auto flex shrink-0 items-center gap-x-1.5">
        <FilterResetButton
          v-if="hasActiveFilter"
          @reset="resetFilters"
        />

        <UButton
          v-if="isEditMode"
          icon="tabler:plus"
          color="primary"
          variant="soft"
          :size="FILTER_ROW_CONTROL_SIZE"
          @click.left.exact.prevent="addFeature"
        >
          {{ ACTOR_FEATURES_TAB_LABELS.add }}
        </UButton>
      </div>
    </div>

    <!-- Список обычных особенностей: пустым разделом вкладку не занимаем -->
    <template v-if="hasVisibleFeatures">
      <div
        v-for="group in featureGroups"
        :key="group.key"
        class="space-y-1 not-first:mt-3"
      >
        <h4
          v-if="group.title"
          class="mb-1 text-xs font-semibold tracking-wider text-muted uppercase"
        >
          {{ group.title }}
        </h4>

        <div
          v-for="feature in group.features"
          :key="feature.id"
          class="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 transition-colors"
          :class="featureRowClassById.get(feature.id)"
          :draggable="canDragToHotbar(feature)"
          @click.left.exact.prevent="
            isEditMode ? undefined : showDescription(feature)
          "
          @contextmenu="openContextMenu($event, feature)"
          @dragstart="handleFeatureDragStart($event, feature)"
        >
          <div class="flex flex-1 items-center gap-2 overflow-hidden">
            <UBadge
              v-if="feature.featureType === 'species'"
              color="primary"
              variant="subtle"
              size="sm"
              class="shrink-0"
            >
              {{ FEATURE_ORIGIN_LABELS.species }}
            </UBadge>

            <UBadge
              v-else-if="feature.level"
              color="primary"
              variant="subtle"
              size="sm"
              class="shrink-0"
            >
              {{ feature.level }}{{ LEVEL_BADGE_SUFFIX }}
            </UBadge>

            <span class="truncate text-sm text-highlighted">
              {{ feature.name }}
            </span>

            <UIcon
              v-if="canDragToHotbar(feature)"
              :name="FEATURE_TOGGLE_MACRO_ICON"
              :title="ACTOR_FEATURES_TAB_LABELS.hotbarHint"
              class="size-4 shrink-0 text-muted"
            />

            <!-- Черта не выбрана свободно, а пришла от предыстории или вида:
              снимется вместе с ними, и это лучше видеть сразу -->
            <UBadge
              v-if="grantedByBackground(feature)"
              color="neutral"
              variant="subtle"
              size="sm"
              class="shrink-0"
            >
              {{ FEATURE_ORIGIN_LABELS.background }}
            </UBadge>

            <UBadge
              v-else-if="grantedBySpecies(feature)"
              color="neutral"
              variant="subtle"
              size="sm"
              class="shrink-0"
            >
              {{ FEATURE_ORIGIN_LABELS.species }}
            </UBadge>
          </div>

          <div class="flex shrink-0 items-center gap-1">
            <!-- Переключатель эффекта прямо в строке; клик по нему не должен
              открывать описание — строка сама кликабельна -->
            <USwitch
              v-if="!isEditMode && toggleEffectByFeatureId.has(feature.id)"
              :model-value="isFeatureEffectOn(feature)"
              size="sm"
              @click.stop
              @update:model-value="switchFeatureEffect(feature)"
            />

            <UButton
              v-if="isEditMode"
              icon="tabler:pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click.left.exact.prevent="editFeature(feature)"
            />

            <UButton
              v-if="isEditMode"
              icon="tabler:trash"
              color="error"
              variant="ghost"
              size="xs"
              @click.left.exact.prevent="removeFeature(feature)"
            />
          </div>
        </div>
      </div>
    </template>

    <!-- Раздел черт целиком уходит под отбор: чип «Черта» оставляет на вкладке
      только его, а остальные чипы — только список выше -->
    <template v-if="isFeatsSectionVisible">
      <!-- Разделитель: Черты. Отступ сверху нужен, только когда над ним стоит
        список особенностей: без него заголовок сам идёт первым -->
      <h4
        class="mb-1 text-xs font-semibold tracking-wider text-muted uppercase"
        :class="hasVisibleFeatures ? 'mt-5' : ''"
      >
        {{ ACTOR_FEATURES_TAB_LABELS.featsTitle }}
      </h4>

      <!-- Список черт -->
      <div
        v-if="featsList.length === 0"
        class="flex flex-1 items-center justify-center rounded-lg border-2 border-dashed px-3 py-4 text-sm transition-colors"
        :class="
          isDragOver
            ? 'border-primary/50 bg-primary/5 text-primary'
            : 'border-default/30 text-dimmed'
        "
      >
        {{
          isDragOver
            ? ACTOR_FEATURES_TAB_LABELS.featsDropHere
            : ACTOR_FEATURES_TAB_LABELS.featsEmpty
        }}
      </div>

      <div
        v-else
        class="space-y-1"
      >
        <div
          v-for="feat in featsList"
          :key="feat.id"
          @contextmenu="openContextMenu($event, feat)"
        >
          <FeatListItem
            :item="feat"
            variant="sheet"
            :show-edit="isEditMode"
            :show-delete="isEditMode"
            @click="isEditMode ? undefined : showDescription(feat)"
            @edit="editFeature(feat)"
            @delete="removeFeature(feat)"
          />
        </div>
      </div>

      <!-- Invisible flex-grow area to ensure bottom space is drop zone -->
      <div
        v-if="featsList.length > 0"
        class="min-h-5 flex-1"
      />
    </template>
  </div>

  <!-- Контекстное меню (Teleport для корректного z-index) -->
  <Teleport to="body">
    <div
      v-if="isContextMenuOpen && contextMenuFeature"
      class="fixed inset-0 z-10000"
      @click.left.exact.prevent="closeContextMenu"
      @contextmenu.prevent="closeContextMenu"
    >
      <div
        class="absolute min-w-45 rounded-lg border border-default bg-default py-1 shadow-xl"
        :style="{ left: `${contextMenuX}px`, top: `${contextMenuY}px` }"
        @click.stop
      >
        <!-- Включить / выключить эффект особенности -->
        <button
          v-if="contextMenuToggleLabel"
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="handleContextMenuAction('toggle')"
        >
          <UIcon
            :name="FEATURE_TOGGLE_MACRO_ICON"
            class="h-4 w-4 text-muted"
          />
          {{ contextMenuToggleLabel }}
        </button>

        <!-- Редактировать -->
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="handleContextMenuAction('edit')"
        >
          <UIcon
            name="tabler:edit"
            class="h-4 w-4 text-muted"
          />
          {{ SHEET_ROW_MENU_LABELS.edit }}
        </button>

        <!-- Поделиться в чат -->
        <button
          class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-highlighted transition-colors hover:bg-accented/50"
          @click.left.exact.prevent="handleContextMenuAction('share')"
        >
          <UIcon
            name="tabler:message-share"
            class="h-4 w-4 text-muted"
          />
          {{ SHEET_ROW_MENU_LABELS.share }}
        </button>

        <!-- Разделитель -->
        <div class="mx-2 my-1 border-t border-default/50" />

        <!-- Удалить -->
        <ContextMenuDangerItem
          icon="tabler:trash"
          @click="handleContextMenuAction('delete')"
        >
          {{ SHEET_ROW_MENU_LABELS.remove }}
        </ContextMenuDangerItem>
      </div>
    </div>
  </Teleport>
</template>
