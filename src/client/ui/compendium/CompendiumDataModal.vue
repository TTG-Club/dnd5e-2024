<script setup lang="ts">
  import type { DraggedCompendiumEntry } from '@/core/entityDragState';
  import type {
    CompendiumManifest,
    CompendiumSeparator,
    CompendiumTreeNode,
    CompendiumView,
    Feature,
    TypedWebSocketClient,
  } from '@vtt/shared';
  import type {
    ClassDefinition,
    CompendiumEntry,
    DnDGameItem,
    GrantedSpellSource,
    SpeciesDefinition,
    Spell,
  } from '@vtt/shared/system/dnd.js';

  import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

  import {
    clearActorDragPayload,
    setActorDragPayload,
  } from '@/core/actorDragState';
  import { getChatService } from '@/core/api/chatService';
  import {
    loadCompendiumKind,
    loadCompendiumManifests,
  } from '@/core/compendiumDataClient';
  import { startCompendiumEntryDrag } from '@/core/entityDragState';
  import { getEntityCard } from '@/core/registries';
  import EntityCard from '@/shared_ui/components/EntityCard.vue';
  import UDraggableModal from '@/shared_ui/components/UDraggableModal.vue';
  import { useCompendiumView } from '@/shared_ui/composables/useCompendiumView';
  import { generateId, getAssetUrl, systemRegistry } from '@vtt/shared';

  import {
    COMPENDIUM_LABELS,
    COMPENDIUM_PACK_BUTTON_CLASS,
    COMPENDIUM_PACK_BUTTON_IDLE_CLASS,
    COMPENDIUM_PACK_BUTTON_SELECTED_CLASS,
    GRANTED_SPELL_FEATURE_PREFIX,
    PINNED_SPELL_FEATURE_PREFIX,
    SHEET_FILTER_LABELS,
  } from '../actor/constants';

  /** Запись существа в компендиуме */
  interface CompendiumCreatureEntry {
    id: string;
    name: string;
    nameEn?: string;
    type: 'creature';
    header?: string;
    description?: string;
    source?: string;
    isSRD?: boolean;
    isReadOnly?: boolean;
    token?: import('@vtt/shared').TokenSettings;
    system: Record<string, unknown>;
    /** Заклинания существа (верхний уровень, D&D 2024) */
    spells?: Spell[];
    /** Инвентарь существа (верхний уровень, как `spells`) */
    equipment?: import('@vtt/shared/system/dnd.js').DnDGameItem[];
  }

  /**
   * Настройка показа по типу записей, узнанная из манифеста. Общая на все окна
   * и на всю сессию: манифест за неё не меняется, а перечитывать его на каждое
   * открытие — значит каждый раз открывать окно не в своём макете.
   */
  const kindViewCache = new Map<string, CompendiumView>();

  // `ClassDefinition`/`SpeciesDefinition` перечислены явно, хотя по форме и
  // подошли бы под `Record<string, unknown>`: интерфейсу TypeScript индексную
  // сигнатуру не выводит, поэтому под этот член союза они НЕ подпадают. Без
  // явного упоминания сужающие предикаты (`isClassDefinition`) отвергались как
  // несовместимые с типом параметра (TS2677).
  type CompendiumDataItem =
    | CompendiumEntry
    | Spell
    | Feature
    | ClassDefinition
    | SpeciesDefinition
    | CompendiumCreatureEntry
    | Record<string, unknown>;

  const props = defineProps<{
    /** Открыто ли модальное окно */
    open: boolean;
    /** Экземпляр WebSocket-клиента */
    socket: TypedWebSocketClient | null;
    /** Имя data-файла для загрузки */
    dataFile?: string;
    /** Заголовок модалки */
    title: string;
    /**
     * Канонический тип записей узла из манифеста: одно из зарегистрированных
     * значений (`spell`/`creature`/`weapon`/`equipment`/`tool`/`feat`/`class`/
     * `species`/`background`/`glossary`), см. docs/CONTENT_AUTHORING.md. Записи
     * с полем `type` рисуются по нему; `dataKind` нужен для определений без
     * `type`.
     */
    dataKind?: string;
    /**
     * Декларативная конфигурация отображения узла из манифеста: макет,
     * фильтры, группировка. Управляет обобщённым движком `useCompendiumView`.
     */
    view?: CompendiumView;
    /** Z-index (управляется родителем для bring-to-front) */
    zIndex?: number;
    savedPosition?: { x: number; y: number };
    savedSize?: { width: number; height: number };
    /**
     * Режим выбора заклинаний 1+ круга: сколько заклинаний можно выбрать.
     * Если не задан — обычный режим просмотра без выбора.
     */
    selectionLimit?: number;
    /**
     * Лимит выбора заговоров (круг 0). Считается отдельно от selectionLimit.
     */
    cantripsLimit?: number;
    /** Начальный фильтр по классу (применяется при открытии) */
    initialClassFilter?: string;
    /** Начальный фильтр по кругам заклинаний (применяется при открытии) */
    initialLevelFilter?: number[];
    /**
     * Идентификаторы уже выбранных заклинаний (из состояния родителя).
     * Предзаполняют набор выбора: отображаются отмеченными и засчитываются в лимит,
     * чтобы при повторном открытии нельзя было превысить лимит.
     */
    preselectedSpellIds?: string[];
    /**
     * Названия заклинаний, которые уже есть у персонажа.
     * В режиме выбора такие заклинания помечаются «Изучено» и недоступны
     * для выбора. Сопоставление по названию, т.к. при добавлении в лист
     * персонажа заклинанию выдаётся новый id.
     */
    knownSpellNames?: string[];
    /**
     * Заклинания, автоматически предоставленные умениями (поле `grantedSpells`
     * умения). В режиме выбора отображаются авто-выбранными и заблокированными
     * (бейдж «Умение: X»), не тратят лимит выбора. Сопоставление по id
     * компендиума, т.к. источники ссылаются именно на него.
     */
    grantedSpells?: GrantedSpellSource[];
    /**
     * Заклинания, доступные персонажу сверх списка класса, — расширение списка
     * от умений, черт и вида. Показываются первыми, своей секцией и независимо
     * от фильтра по классу (иначе он бы их спрятал), а выбираются наравне с
     * классовыми — с бейджем источника.
     */
    pinnedSpells?: GrantedSpellSource[];
  }>();

  const emit = defineEmits<{
    'update:open': [value: boolean];
    'bring-to-front': [];
    /** Эмитируется при подтверждении выбора заклинаний в режиме selectionLimit */
    'select-spells': [spells: Spell[]];
  }>();

  const items = ref<CompendiumDataItem[]>([]);

  /**
   * Настройка показа, взятая из манифеста при загрузке по типу записей. Проп
   * `view` главнее: его задаёт вызывающий, открывший конкретный узел.
   *
   * Начальное значение — из общего запаса: настройка приезжает вместе с
   * данными, следующим тиком после открытия, и без запаса окно каждый раз
   * успевало открыться узким и лишь потом раздаться. Манифест за сессию не
   * меняется, поэтому со второго раза макет известен сразу.
   */
  const kindView = ref<CompendiumView | undefined>(
    props.dataKind ? kindViewCache.get(props.dataKind) : undefined,
  );

  const isLoading = ref(false);
  const loadedFile = ref('');
  const searchQuery = ref('');

  // --- Режим выбора заклинаний ---

  /**
   * Выбранные заклинания в режиме selectionLimit.
   * Инициализируется уже выбранными заклинаниями родителя, чтобы лимит
   * учитывал их и при повторном открытии его нельзя было превысить.
   */
  const selectedSpells = ref<Set<string>>(
    new Set(props.preselectedSpellIds ?? []),
  );

  /** Активен ли режим выбора */
  const isSelectionMode = computed(
    () =>
      props.selectionLimit !== undefined || props.cantripsLimit !== undefined,
  );

  /** Нормализованные названия уже изученных заклинаний персонажа */
  const knownSpellNamesSet = computed(
    () =>
      new Set(
        (props.knownSpellNames ?? []).map((name) => name.trim().toLowerCase()),
      ),
  );

  /**
   * Проверяет, изучено ли заклинание персонажем.
   *
   * @param spell - заклинание компендиума
   */
  function isSpellKnown(spell: Spell): boolean {
    return knownSpellNamesSet.value.has(spell.name.trim().toLowerCase());
  }

  /** Карта «id заклинания компендиума → название умения-источника» */
  const grantedFeatureNameBySpellId = computed(() => {
    const featureNameById = new Map<string, string>();

    for (const granted of props.grantedSpells ?? []) {
      featureNameById.set(granted.spellId, granted.featureName);
    }

    return featureNameById;
  });

  /**
   * Проверяет, предоставлено ли заклинание умением автоматически.
   *
   * @param spell - заклинание компендиума
   */
  function isSpellGranted(spell: Spell): boolean {
    return grantedFeatureNameBySpellId.value.has(spell.id);
  }

  /**
   * Возвращает название умения, предоставившего заклинание.
   *
   * @param spell - заклинание компендиума
   */
  function getGrantedFeatureName(spell: Spell): string {
    return grantedFeatureNameBySpellId.value.get(spell.id) ?? '';
  }

  /** Карта «id заклинания компендиума → запись, открывшая его сверх списка класса» */
  const pinnedFeatureNameBySpellId = computed(() => {
    const featureNameById = new Map<string, string>();

    for (const pinned of props.pinnedSpells ?? []) {
      featureNameById.set(pinned.spellId, pinned.featureName);
    }

    return featureNameById;
  });

  /**
   * Доступно ли заклинание сверх списка класса.
   *
   * @param spell - заклинание компендиума
   */
  function isSpellPinned(spell: Spell): boolean {
    return pinnedFeatureNameBySpellId.value.has(spell.id);
  }

  /**
   * Запись, открывшая заклинание сверх списка класса.
   *
   * @param spell - заклинание компендиума
   */
  function getPinnedFeatureName(spell: Spell): string {
    return pinnedFeatureNameBySpellId.value.get(spell.id) ?? '';
  }

  /**
   * Считает заговоры (круг 0) среди указанных id выбора.
   * Id, отсутствующие в items, заговорами не считаются и потому
   * засчитываются в лимит заклинаний 1+ круга.
   *
   * @param selectionIds - множество id выбранных заклинаний
   */
  function countCantripsInSelection(selectionIds: Set<string>): number {
    let count = 0;

    for (const entry of items.value) {
      if (
        !isSeparator(entry)
        && isSpellDataItem(entry)
        && entry.level === 0
        && selectionIds.has(entry.id)
      ) {
        count++;
      }
    }

    return count;
  }

  /** Количество выбранных заговоров (круг 0) */
  const selectedCantripsCount = computed(() =>
    countCantripsInSelection(selectedSpells.value),
  );

  /** Количество выбранных заклинаний 1+ круга */
  const selectedSpellsCount = computed(
    () => selectedSpells.value.size - selectedCantripsCount.value,
  );

  /** Остаток выбора заклинаний 1+ круга */
  const remainingSpellSelections = computed(() => {
    if (props.selectionLimit === undefined) {
      return 0;
    }

    return props.selectionLimit - selectedSpellsCount.value;
  });

  /** Остаток выбора заговоров */
  const remainingCantripsSelections = computed(() => {
    if (props.cantripsLimit === undefined) {
      return 0;
    }

    return props.cantripsLimit - selectedCantripsCount.value;
  });

  /**
   * Переключает выбор заклинания в режиме выбора.
   * Учитывает раздельные лимиты для заговоров и заклинаний.
   *
   * @param spell - заклинание для переключения
   */
  function toggleSpellSelection(spell: Spell): void {
    // Уже изученные и предоставленные умениями заклинания нельзя переключить
    if (isSpellKnown(spell) || isSpellGranted(spell)) {
      return;
    }

    const newSet = new Set(selectedSpells.value);

    if (newSet.has(spell.id)) {
      newSet.delete(spell.id);
    } else {
      const isCantrip = spell.level === 0;

      const limit = isCantrip ? props.cantripsLimit : props.selectionLimit;

      // При лимите = 1 автоматически отменяем предыдущий выбор той же категории
      if (limit === 1) {
        for (const selectedId of newSet) {
          // Сужаем ДО чтения `id`: среди записей есть и разделители, и
          // определения вида/класса — `id` есть не у всех.
          const found = items.value.find(
            (item) => isSpellDataItem(item) && item.id === selectedId,
          );

          if (
            found
            && isSpellDataItem(found)
            && (isCantrip ? found.level === 0 : found.level > 0)
          ) {
            newSet.delete(selectedId);
          }
        }
      }

      // Остаток считаем по newSet (а не по реактивным computed-остаткам,
      // которые ещё видят отменённый выбор): неопознанные id засчитываются
      // в лимит 1+ круга, поэтому превысить лимит нельзя
      const cantripsInNewSet = countCantripsInSelection(newSet);

      const remaining = isCantrip
        ? (props.cantripsLimit ?? 0) - cantripsInNewSet
        : (props.selectionLimit ?? 0) - (newSet.size - cantripsInNewSet);

      if (remaining > 0) {
        newSet.add(spell.id);
      }
    }

    selectedSpells.value = newSet;
  }

  /**
   * Проверяет, заблокирован ли выбор для данного заклинания (лимит исчерпан).
   *
   * @param spell - заклинание для проверки
   */
  function isSpellSelectionDisabled(spell: Spell): boolean {
    if (isSpellKnown(spell) || isSpellGranted(spell)) {
      return true;
    }

    if (selectedSpells.value.has(spell.id)) {
      return false;
    }

    const isCantrip = spell.level === 0;

    if (isCantrip) {
      // Если лимит 1, выбор не блокируется, чтобы можно было перевыбрать
      if (props.cantripsLimit === 1) {
        return false;
      }

      return remainingCantripsSelections.value === 0;
    }

    // Если лимит 1, выбор не блокируется, чтобы можно было перевыбрать
    if (props.selectionLimit === 1) {
      return false;
    }

    return remainingSpellSelections.value === 0;
  }

  /**
   * Обрабатывает клик по карточке заклинания в зависимости от режима выбора.
   *
   * @param spell - заклинание компендиума
   */
  function handleSpellClick(spell: Spell): void {
    if (
      isSelectionMode.value
      && !isSpellKnown(spell)
      && !isSpellGranted(spell)
    ) {
      toggleSpellSelection(spell);
    } else {
      openSpellDetail(spell);
    }
  }

  /** Подтверждает выбор заклинаний и эмитит событие */
  function confirmSpellSelection(): void {
    // Пока данные не загружены, items пуст — не подтверждаем,
    // иначе предвыбранные заклинания будут потеряны.
    if (isLoading.value || items.value.length === 0) {
      return;
    }

    const chosen = items.value.filter(
      (entry): entry is Spell =>
        !isSeparator(entry)
        && isSpellDataItem(entry)
        && selectedSpells.value.has(entry.id),
    );

    emit('select-spells', chosen);
    emit('update:open', false);
  }

  // --- Тип данных узла ---

  /**
   * Канонический тип записей узла из манифеста (`dataKind`) — одно из
   * зарегистрированных в системе значений (`spell`/`creature`/`weapon`/
   * `equipment`/`tool`/`feat`/`class`/`species`/`background`/`glossary`), см.
   * docs/CONTENT_AUTHORING.md.
   *
   * Записи с собственным полем `type` (заклинания, существа, предметы) рисуются
   * по нему напрямую — `dataKind` здесь нужен лишь для определений без `type`
   * (классы/виды/черты/предыстории) и для сортировки. Угадывание типа по имени
   * файла (`dataFile` — лишь ключ маршрутизации, может содержать префикс пака)
   * НЕ применяется.
   */
  const dataKind = computed(() => props.dataKind ?? '');

  // Обобщённый движок отображения: макет, боковые фильтры и группировка
  // управляются декларативной конфигурацией `view` из манифеста узла.
  // Специфика системы (круги, ПО, типы существ, классы, признак лечения)
  // берётся из VttSystem — компонент о конкретных типах данных не знает.
  const {
    layout: viewLayout,
    showFilters: showFilterSidebar,
    filterSections,
    hasActiveFilters,
    filteredEntries,
    isEnumActive,
    toggleEnum,
    isToggleActive,
    toggleBool,
    resetFilters,
    setEnumSelection,
  } = useCompendiumView({
    view: () => props.view ?? kindView.value,
    items,
    searchQuery,
  });

  /**
   * Записи к показу: заклинания сверх списка класса — первыми, своей секцией и
   * независимо от фильтров. Расширение списка («Заклинания метки», заклинания
   * домена) добавляет персонажу заклинания не его класса, и фильтр по классу
   * спрятал бы их. Сами записи остаются в `items`, поэтому выбор и
   * подтверждение работают для них так же, как для любой записи каталога.
   */
  const visibleEntries = computed<CompendiumDataItem[]>(() => {
    const pinnedIds = pinnedFeatureNameBySpellId.value;

    if (pinnedIds.size === 0) {
      return filteredEntries.value;
    }

    const pinned = items.value.filter(
      (entry): entry is Spell =>
        isSpellDataItem(entry) && pinnedIds.has(entry.id),
    );

    if (pinned.length === 0) {
      return filteredEntries.value;
    }

    const pinnedIdSet = new Set(pinned.map((spell) => spell.id));

    const rest = filteredEntries.value.filter(
      (entry) => !(isSpellDataItem(entry) && pinnedIdSet.has(entry.id)),
    );

    const separator: CompendiumSeparator = {
      type: 'separator',
      name: COMPENDIUM_LABELS.pinnedSection,
    };

    return [separator, ...pinned, ...rest];
  });

  /**
   * Оформление строки фильтра — то же, что у компендиумов и видов дара в окнах
   * выбора: отмеченная подсвечена, прочие теплеют только под курсором. Разметка
   * одна на все три окна: строка фильтра везде означает одно и то же, и разный
   * вид сбивал бы — по этим окнам ходят подряд.
   *
   * @param isActive - отмечено ли значение
   */
  function filterRowClass(isActive: boolean): string {
    const stateClass = isActive
      ? COMPENDIUM_PACK_BUTTON_SELECTED_CLASS
      : COMPENDIUM_PACK_BUTTON_IDLE_CLASS;

    return `${COMPENDIUM_PACK_BUTTON_CLASS} ${stateClass}`;
  }

  /**
   * Цвет значка переключателя. Картой, а не строкой на лету: Tailwind собирает
   * классы статическим просмотром исходников, и `text-${color}` в сборку не
   * попадёт — значок остался бы бесцветным.
   */
  const TOGGLE_ICON_CLASS: Record<string, string> = {
    success: 'text-success',
    warning: 'text-warning',
    error: 'text-error',
    info: 'text-info',
    primary: 'text-primary',
  };

  /** Нужен ли широкий макет с сайдбаром фильтров */
  const isWideLayout = computed(() => viewLayout.value === 'filtered');

  /**
   * Доля окна приложения, которую занимает окно с фильтрами при открытии.
   *
   * От доли, а не от жёсткого размера: на широком мониторе фиксированные
   * пиксели выглядят маленьким окошком посреди пустоты, а на тесном экране —
   * вылезают за край. Доля даёт соразмерное окно и там, и там.
   *
   * По ширине доля меньше, чем по высоте, и потолок ниже: в строке списка
   * стоят название, оригинал и пара значков — на широком окне строка
   * растягивается пустотой, а глаз теряет её край. Расти окну полезно вниз,
   * а не вбок: вниз идут сами записи.
   */
  const WIDE_MODAL_VIEWPORT_RATIO = { width: 0.45, height: 0.85 };

  /**
   * Размер, больше которого окно не открывается даже на очень широком
   * мониторе.
   */
  const WIDE_MODAL_MAXIMUM = { width: 780, height: 1000 };

  /**
   * Размер, меньше которого окно не открывается, пока экран позволяет. Рядом со
   * списком стоит колонка фильтров, и в тесном окне на сам список оставалось
   * несколько строк — в справочнике на полтысячи заклинаний листать его нечем.
   */
  const WIDE_MODAL_MINIMUM = { width: 620, height: 640 };

  /**
   * Размер окна по одной оси: доля экрана, подпёртая снизу и сверху.
   *
   * Экран меньше нижней границы — окно занимает его целиком: вылезти за край
   * оно не должно, иначе до нижних кнопок не добраться.
   *
   * @param available - размер окна приложения по этой оси
   * @param ratio - доля экрана по этой оси
   * @param minimum - размер, ниже которого не опускаемся, пока экран позволяет
   * @param maximum - размер, выше которого не поднимаемся
   * @returns размер окна в пикселях
   */
  function fitToViewport(
    available: number,
    ratio: number,
    minimum: number,
    maximum: number,
  ): number {
    const preferred = Math.round(available * ratio);

    return Math.max(Math.min(minimum, available), Math.min(preferred, maximum));
  }

  /**
   * Размер окна приложения на момент открытия окна.
   *
   * Снимком, а не живой величиной: дальше размером владеет пользователь — он
   * тянет окно за угол, — и пересчёт на каждое изменение размера приложения
   * отменял бы его правку. Снимок свежий у каждого открытия: окно
   * перемонтируется вместе с ним.
   */
  const viewportSize = {
    width: window.innerWidth,
    height: window.innerHeight,
  };

  /** Размеры модалки: увеличенные для макета с фильтрами */
  const modalWidth = computed(() =>
    isWideLayout.value
      ? fitToViewport(
          viewportSize.width,
          WIDE_MODAL_VIEWPORT_RATIO.width,
          WIDE_MODAL_MINIMUM.width,
          WIDE_MODAL_MAXIMUM.width,
        )
      : 380,
  );

  const modalHeight = computed(() =>
    isWideLayout.value
      ? fitToViewport(
          viewportSize.height,
          WIDE_MODAL_VIEWPORT_RATIO.height,
          WIDE_MODAL_MINIMUM.height,
          WIDE_MODAL_MAXIMUM.height,
        )
      : 460,
  );

  const modalMinWidth = computed(() => (isWideLayout.value ? 560 : 320));

  /**
   * Размер окна, который окно применяет НА ХОДУ.
   *
   * Начальный размер (`initial-width`/`initial-height`) окно спрашивает при
   * открытии — а макет к этому моменту ещё не известен: настройка показа с
   * фильтрами приезжает вместе с данными, следующим тиком. Поэтому окно
   * открывалось узким и таким и оставалось, сколько бы ни было прописано для
   * широкого макета.
   *
   * `saved-size` окно, в отличие от начального размера, отслеживает и применяет
   * при каждой смене — колонка фильтров появилась, окно тут же и раздалось.
   * Размер, сохранённый вызывающим, главнее: его задал сам пользователь.
   */
  const autoSize = computed(() => ({
    width: modalWidth.value,
    height: modalHeight.value,
  }));

  /**
   * Приводит запись к форме, которую принимает проп `entry` у `EntityCard`.
   *
   * Хост типизировал этот проп как `EntityCardEntry` — тип с индексной
   * сигнатурой (`[key: string]: unknown`). Наши записи описаны интерфейсами
   * (`Feature`, `Spell`, `SpeciesDefinition`…), а интерфейсам TypeScript
   * индексную сигнатуру НЕ выводит — только псевдонимам типов. Отсюда TS2322
   * на каждой карточке, хотя формы совместимы.
   *
   * Гомоморфный mapped-тип даёт ту же форму, но уже как псевдоним — с
   * подразумеваемой индексной сигнатурой. Приведение чисто типовое: объект
   * возвращается тот же, без копии (сам `EntityCard` внутри всё равно делает
   * `{ ...props.entry }`).
   *
   * Импортировать `EntityCardEntry` напрямую нельзя: барель
   * `@/core/registries` его не экспортирует, а хост правим только на его
   * стороне.
   *
   * @param entry - запись компендиума
   * @returns та же запись в форме, приемлемой для карточки
   */
  function toCardEntry<T extends object>(entry: T): { [K in keyof T]: T[K] } {
    return entry;
  }

  /**
   * Проверяет, является ли запись разделителем секции
   * @param entry - запись компендиума
   */
  function isSeparator(
    entry: CompendiumDataItem,
  ): entry is CompendiumSeparator {
    return 'type' in entry && entry.type === 'separator';
  }

  /** Узел определений классов (`dataKind: 'class'`) */
  const isClassData = computed(() => dataKind.value === 'class');

  /** Узел определений видов (`dataKind: 'species'`) */
  const isSpeciesData = computed(() => dataKind.value === 'species');

  /** Узел определений черт (`dataKind: 'feat'`) */
  const isFeatsData = computed(() => dataKind.value === 'feat');

  /** Узел определений предысторий (`dataKind: 'background'`) */
  const isBackgroundData = computed(() => dataKind.value === 'background');

  /**
   * Тип карточки для записи, не подошедшей ни одной ветке разметки выше: сперва
   * собственное поле `type` записи, затем `dataKind` узла. Пустая строка — такого
   * типа в реестре системы нет, рисовать нечем.
   *
   * Это и есть обещание документации «добавить новый тип = зарегистрировать
   * карточку»: узлу с НОВЫМ `dataKind` (глоссарий и любой будущий) правка этой
   * модалки больше не нужна — хватает `entityCard` в системе. Ветки выше живут
   * ради своих особенностей (перетаскивание существа, выбор заклинаний, кнопка
   * копирования) и потому остаются.
   *
   * @param entry - запись компендиума
   */
  function registeredCardType(entry: CompendiumDataItem): string {
    const ownType =
      'type' in entry && typeof entry.type === 'string' ? entry.type : '';

    const type = ownType || dataKind.value;

    return type && getEntityCard(type) ? type : '';
  }

  /**
   * Открывает деталь записи хуком её зарегистрированной карточки.
   * Копирования в инвентарь не предлагаем: подойдёт ли запись в предметы, знает
   * только система, а общий путь про это ничего не знает.
   *
   * @param entry - запись компендиума
   */
  function openRegisteredDetail(entry: CompendiumDataItem): void {
    const type = registeredCardType(entry);

    if (type) {
      getEntityCard(type)?.openDetail?.(entry);
    }
  }

  /** Обработчик ответа от сервера */
  function handleCompendiumData(
    dataFile: string,
    loadedItems: CompendiumDataItem[],
  ): void {
    if (dataFile === props.dataFile) {
      // Сортируем по алфавиту для классов и видов
      if (isClassData.value || isSpeciesData.value) {
        loadedItems.sort((entryA, entryB) => {
          const nameA =
            'name' in entryA && typeof entryA.name === 'string'
              ? entryA.name
              : '';

          const nameB =
            'name' in entryB && typeof entryB.name === 'string'
              ? entryB.name
              : '';

          return nameA.localeCompare(nameB, 'ru');
        });
      }

      items.value = loadedItems;
      isLoading.value = false;
      loadedFile.value = dataFile;
    }
  }

  /** Запрашивает данные из data-файла */
  function requestData(): void {
    if (!props.socket) {
      return;
    }

    // Узел не назван — грузим ВЕСЬ канонический тип, со всех паков сразу:
    // `dataFile` узла несёт префикс пака (`merged:ttg-club/spells`), и назвать
    // его снаружи нечем, а заклинания одного пака показали бы не весь список
    if (!props.dataFile) {
      void requestKindData();

      return;
    }

    // Уже загружен этот файл
    if (loadedFile.value === props.dataFile) {
      return;
    }

    isLoading.value = true;
    props.socket.emit('compendium:request-data', props.dataFile);
  }

  /**
   * Загружает записи канонического типа со всех паков и настройку показа к ним.
   *
   * Настройка (`view`) живёт у УЗЛА манифеста, а не у типа: без неё не собрать
   * ни боковых фильтров, ни подписей — окно выбора заклинаний осталось бы и без
   * фильтра по классу, и без фильтра по кругам. Узлы одного типа объявляют её
   * одинаково, поэтому берётся первая найденная.
   */
  async function requestKindData(): Promise<void> {
    const socket = props.socket;
    const kind = props.dataKind;

    if (!socket || !kind || loadedFile.value === kind) {
      return;
    }

    isLoading.value = true;

    const [entries, manifests] = await Promise.all([
      loadCompendiumKind(socket, kind),
      loadCompendiumManifests(socket),
    ]);

    const view = findKindView(manifests, kind);

    if (view) {
      kindViewCache.set(kind, view);
    }

    items.value = [...entries];
    kindView.value = view;
    loadedFile.value = kind;
    isLoading.value = false;
  }

  /**
   * Настройка показа для узлов заданного типа записей.
   *
   * @param manifests - манифесты всех паков
   * @param kind - канонический тип записей
   * @returns настройка показа; `undefined` — ни один узел её не объявил
   */
  function findKindView(
    manifests: ReadonlyArray<CompendiumManifest>,
    kind: string,
  ): CompendiumView | undefined {
    const walk = (
      nodes: ReadonlyArray<CompendiumTreeNode>,
    ): CompendiumView | undefined => {
      for (const node of nodes) {
        if (node.dataKind === kind && node.view) {
          return node.view;
        }

        const nested = node.children ? walk(node.children) : undefined;

        if (nested) {
          return nested;
        }
      }

      return undefined;
    };

    for (const manifest of manifests) {
      const view = walk(manifest.tree ?? []);

      if (view) {
        return view;
      }
    }

    return undefined;
  }

  /**
   * Копирует предмет из компедиума в раздел «Предметы».
   * Все паки (бандл + скачиваемые + модули) живут на сервере — копирование
   * единообразно через серверный resolver.
   *
   * @param itemId - ID предмета
   */
  function copyToItems(itemId: string): void {
    if (!props.socket) {
      return;
    }

    props.socket.emit('items:copy-from-compendium', itemId);
  }

  /** Проверяет, является ли запись заклинанием */
  function isSpellDataItem(value: CompendiumDataItem): value is Spell {
    return 'type' in value && value.type === 'spell';
  }

  /** Проверяет, является ли запись определением вида */
  function isSpeciesDefinition(value: unknown): value is SpeciesDefinition {
    return (
      typeof value === 'object'
      && value !== null
      && 'key' in value
      && typeof value.key === 'string'
      && 'creatureType' in value
    );
  }

  /** Проверяет, является ли запись определением предыстории */
  function isBackgroundDefinition(
    value: CompendiumDataItem,
  ): value is { key: string; id?: string; [key: string]: unknown } {
    return (
      'key' in value && typeof value.key === 'string' && 'abilityGrant' in value
    );
  }

  /**
   * Идентификатор предыстории для копирования в предметы. Сервер ищет запись по
   * `id` (`findSrdItemById`), а не по `key`, поэтому отдаём `id` (откат на `key`
   * для совместимости со старыми данными без `id`).
   *
   * @param backgroundDef - определение предыстории из компендиума
   */
  function backgroundCopyId(backgroundDef: {
    key: string;
    id?: string;
  }): string {
    return backgroundDef.id ?? backgroundDef.key;
  }

  /** Проверяет, является ли запись определением класса */
  function isClassDefinition(
    value: CompendiumDataItem,
  ): value is ClassDefinition {
    return 'key' in value && typeof value.key === 'string' && 'hitDie' in value;
  }

  /** Проверяет, является ли запись чертой (Feature без поля type, но с полем featureType) */
  function isFeature(value: CompendiumDataItem): value is Feature {
    return 'featureType' in value;
  }

  /** Проверяет, является ли запись игровым предметом (имеет поле quantity) */
  /** Проверяет, является ли запись существом */
  function isCreatureDataItem(
    value: CompendiumDataItem,
  ): value is CompendiumCreatureEntry {
    return 'type' in value && value.type === 'creature' && 'system' in value;
  }

  /**
   * Проверяет, является ли запись компендиума игровым предметом (GameItem).
   *
   * @param value - проверяемая запись компендиума
   * @returns `true`, если запись содержит поле `quantity` и является предметом
   */
  function isGameItem(value: CompendiumDataItem): value is DnDGameItem {
    return 'quantity' in value;
  }

  /**
   * Открывает модальное окно детального просмотра игрового предмета.
   * Тип окна выбирается по типу предмета (оружие/прочее).
   *
   * @param item - предмет для отображения
   */
  function openDetail(item: DnDGameItem): void {
    // Незнакомый тип (хоумбрю-пак) показываем как снаряжение — так же, как до
    // выноса открытия в реестр карточек.
    const card = getEntityCard(item.type) ?? getEntityCard('equipment');

    card?.openDetail?.(item, {
      showCopyButton: true,
      onCopy: () => copyToItems(item.id),
    });
  }

  /**
   * Открывает модальное окно детального просмотра заклинания.
   *
   * @param spell - заклинание для отображения
   */
  function openSpellDetail(spell: Spell): void {
    getEntityCard('spell')?.openDetail?.(spell, {
      showCopyButton: true,
      onCopy: () => copySpellToItems(spell),
    });
  }

  /**
   * Отправляет карточку заклинания в чат из компендиума
   *
   * @param spell - заклинание для отправки
   */
  function shareSpell(spell: Spell): void {
    getChatService().sendItemCard({
      cardType: 'spell',
      title: spell.name,
      payload: JSON.stringify(spell),
    });
  }

  /**
   * Копирует заклинание из компендиума в предметы, конвертируя Spell → GameItem.
   *
   * @param spell - заклинание для копирования
   */
  function copySpellToItems(spell: Spell): void {
    if (!props.socket) {
      return;
    }

    const itemData = {
      name: spell.name,
      nameEn: spell.nameEn,
      description: spell.description,
      type: 'spell' as const,
      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common' as const,
      equipped: false,
      sourceKey: spell.sourceKey,
      isSRD: spell.isSRD,
      isReadOnly: false,
      spellData: spell,
    };

    props.socket.emit('items:create', itemData);
  }

  /**
   * Копирует вид из компендиума в предметы, оборачивая плоский
   * SpeciesDefinition в GameItem с вложенным speciesData. Ключу присваивается
   * новое значение — копия становится самостоятельным видом и не перекрывается
   * оригиналом SRD при слиянии видов в systemDataStore.
   *
   * @param species - определение вида для копирования
   */
  function copySpeciesToItems(species: SpeciesDefinition): void {
    if (!props.socket) {
      return;
    }

    const itemData: Partial<DnDGameItem> = {
      name: species.name,
      nameEn: species.nameEn,
      description: species.description,
      type: 'species',
      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common',
      equipped: false,
      sourceKey: species.sourceKey,
      isSRD: species.isSRD,
      isReadOnly: false,
      speciesData: { ...species, key: generateId(species.key) },
    };

    props.socket.emit('items:create', itemData);
  }

  /**
   * Копирует класс из компендиума в предметы, оборачивая плоский
   * ClassDefinition в GameItem с вложенным classData. Ключу присваивается новое
   * значение — копия становится самостоятельным классом и не перекрывает
   * оригинал SRD при слиянии классов в актор-листе.
   *
   * @param classDef - определение класса для копирования
   */
  function copyClassToItems(classDef: ClassDefinition): void {
    if (!props.socket) {
      return;
    }

    const itemData: Partial<DnDGameItem> = {
      name: classDef.name,
      nameEn: classDef.nameEn,
      description: classDef.description ?? '',
      type: 'class',
      quantity: 1,
      weight: 0,
      cost: '',
      rarity: 'common',
      equipped: false,
      sourceKey: classDef.sourceKey,
      isSRD: classDef.isSRD,
      isReadOnly: false,
      classData: { ...classDef, key: generateId(classDef.key) },
    };

    props.socket.emit('items:create', itemData);
  }

  /**
   * Открывает детальный просмотр класса.
   * @param classDef - определение класса
   */
  function openClassDetail(classDef: ClassDefinition): void {
    getEntityCard('class')?.openDetail?.(classDef);
  }

  /**
   * Открывает детальный просмотр вида.
   * @param species - определение вида
   */
  function openSpeciesDetail(species: SpeciesDefinition): void {
    getEntityCard('species')?.openDetail?.(species);
  }

  /**
   * Открывает детальный просмотр предыстории.
   * @param backgroundDef - определение предыстории
   */
  function openBackgroundDetail(backgroundDef: {
    key: string;
    id?: string;
    [key: string]: unknown;
  }): void {
    getEntityCard('background')?.openDetail?.(backgroundDef, {
      showCopyButton: true,
      onCopy: () => copyToItems(backgroundCopyId(backgroundDef)),
    });
  }

  /**
   * Открывает лист существа из компендиума (режим только просмотр).
   * @param creatureEntry - запись существа из компендиума
   */
  function openCreatureDetail(creatureEntry: CompendiumCreatureEntry): void {
    getEntityCard('creature')?.openDetail?.(creatureEntry);
  }

  /**
   * Собирает существо мира из записи компендиума: новый id, глубокая копия
   * system/token, нормализация, скрытое имя на сцене. Общий билдер для кнопки
   * «Копировать» и перетаскивания существа из компендиума на стол.
   *
   * @param creatureEntry - запись существа компендиума
   * @returns готовое существо мира (ещё не отправленное на сервер)
   */
  function buildWorldCreature(
    creatureEntry: CompendiumCreatureEntry,
  ): import('@vtt/shared/system/dnd.js').DnDCreature {
    const creature: import('@vtt/shared/system/dnd.js').DnDCreature = {
      id: generateId('creature'),
      // Дискриминатор сущности сцены — по нему ядро отличает существо от
      // актёра. Без него существо, скопированное из компендиума в мир,
      // приезжало на сцену неопознанным.
      entityType: 'creature',
      name: creatureEntry.name,
      nameEn: creatureEntry.nameEn,
      description: creatureEntry.description,
      token: creatureEntry.token
        ? JSON.parse(JSON.stringify(creatureEntry.token))
        : undefined,
      system: JSON.parse(JSON.stringify(creatureEntry.system)),
      spells: creatureEntry.spells
        ? JSON.parse(JSON.stringify(creatureEntry.spells))
        : undefined,
      equipment: creatureEntry.equipment
        ? JSON.parse(JSON.stringify(creatureEntry.equipment))
        : undefined,
    };

    // Применяем нормализацию, чтобы перевести старые поля токена (hasVision -> enabled)
    const system = systemRegistry.getActiveSystem();

    if (system?.normalizeCreature) {
      system.normalizeCreature(creature);
    }

    // Существа из компендиума по умолчанию скрывают имя на сцене
    if (creature.token) {
      creature.token.showName = false;
    }

    return creature;
  }

  /**
   * Копирует существо из компендиума в список существ мира.
   * @param creatureEntry - запись существа
   */
  function copyCreature(creatureEntry: CompendiumCreatureEntry): void {
    if (!props.socket) {
      return;
    }

    props.socket.emit('creature:created', buildWorldCreature(creatureEntry));
  }

  /**
   * Старт перетаскивания существа из компендиума на стол. В dataTransfer
   * кладётся уже собранное существо мира (новый id) с флагом `fromCompendium` —
   * сцена при дропе копирует его в список существ (creature:created) и ставит
   * токен. Каждый dragstart генерирует новое существо с уникальным id, поэтому
   * повторный перенос создаёт отдельную копию.
   *
   * Правая панель приложения принимает существо иначе — через общее описание
   * записи (`startCompendiumEntryDrag`), поэтому оба формата пишутся вместе.
   *
   * @param creatureEntry - запись существа компендиума
   * @param event - событие dragstart
   */
  function onCreatureDragStart(
    creatureEntry: CompendiumCreatureEntry,
    event: DragEvent,
  ): void {
    if (!event.dataTransfer) {
      return;
    }

    const creature = buildWorldCreature(creatureEntry);

    event.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: 'creature',
        fromCompendium: true,
        creature,
      }),
    );

    // Существо для правой панели: она копирует ровно то же, что кнопка
    // «Копировать», — уже собранное существо, а не запись компендиума
    startCompendiumEntryDrag(
      {
        kind: entryKind(creatureEntry),
        title: creature.name,
        image: creature.token?.imageUrl ?? null,
        copyToWorld: () => props.socket?.emit('creature:created', creature),
      },
      event.dataTransfer,
    );

    // Ghost-превью на сцене (тот же механизм, что у списка существ): данные
    // токена в синглтон, нативный drag-image прячем. URL ассетов резолвим без
    // порта — кадры токенов это статика клиента (`assets/token-frames/...`).
    setActorDragPayload({
      imageUrl: getAssetUrl(creature.token?.imageUrl),
      frameUrl: getAssetUrl(creature.token?.frameUrl),
      tokenScale: creature.token?.scale ?? 1,
      textureScale: creature.token?.textureScale ?? 1,
      textureX: creature.token?.textureX ?? 0.5,
      textureY: creature.token?.textureY ?? 0.5,
      entityKind: 'creature',
    });

    const emptyCanvas = document.createElement('canvas');

    emptyCanvas.width = 1;
    emptyCanvas.height = 1;
    event.dataTransfer.setDragImage(emptyCanvas, 0, 0);
  }

  /**
   * Название записи для подписи в зоне сброса.
   *
   * @param entry - запись компендиума
   * @returns название или пустая строка, если его нет
   */
  function entryTitle(entry: CompendiumDataItem): string {
    return 'name' in entry && typeof entry.name === 'string' ? entry.name : '';
  }

  /**
   * Канонический вид записи — по нему приёмник решает, в какой раздел мира она
   * попадёт. Приоритет тот же, что у выбора карточки: собственное поле `type`
   * записи, затем `dataKind` узла (у определений вида, предыстории, класса и
   * черты своего поля нет).
   *
   * @param entry - запись компендиума
   * @returns вид записи; пустая строка — вида нет
   */
  function entryKind(entry: CompendiumDataItem): string {
    const ownType =
      'type' in entry && typeof entry.type === 'string' ? entry.type : '';

    return ownType || dataKind.value;
  }

  /**
   * Разбирает запись в описание перетаскивания: вид, подпись и способ положить
   * её в мир. Вид и способ — те же, что у кнопки «Копировать» в строке: одна
   * запись не может копироваться в мир двумя разными путями.
   *
   * Вид записи не перечисляется здесь заново: у определений (вид, предыстория,
   * класс, черта) его несёт `dataKind` узла, у записей с собственным полем
   * `type` — само поле. Вторая копия этого списка разошлась бы с ветками
   * показа при первом же новом типе.
   *
   * Существо здесь не разбирается: у него свой обработчик, кладущий в буфер
   * ещё и payload для стола.
   *
   * @param entry - запись компендиума
   * @returns описание перетаскивания или null, если запись в мир не копируется
   */
  function resolveEntryDrag(
    entry: CompendiumDataItem,
  ): DraggedCompendiumEntry | null {
    if (isSpeciesData.value && isSpeciesDefinition(entry)) {
      return {
        kind: entryKind(entry),
        title: entry.name,
        image: null,
        copyToWorld: () => copySpeciesToItems(entry),
      };
    }

    if (isBackgroundData.value && isBackgroundDefinition(entry)) {
      return {
        kind: entryKind(entry),
        title: entryTitle(entry),
        image: null,
        copyToWorld: () => copyToItems(backgroundCopyId(entry)),
      };
    }

    if (isClassData.value && isClassDefinition(entry)) {
      return {
        kind: entryKind(entry),
        title: entry.name,
        image: null,
        copyToWorld: () => copyClassToItems(entry),
      };
    }

    if (isFeatsData.value && isFeature(entry)) {
      return {
        kind: entryKind(entry),
        title: entry.name,
        image: null,
        copyToWorld: () => copyToItems(entry.id),
      };
    }

    if (isGameItem(entry)) {
      return {
        kind: entryKind(entry),
        title: entry.name,
        image: null,
        copyToWorld: () => copyToItems(entry.id),
      };
    }

    if (isSpellDataItem(entry)) {
      return {
        kind: entryKind(entry),
        title: entry.name,
        image: null,
        copyToWorld: () => copySpellToItems(entry),
      };
    }

    return null;
  }

  /**
   * Можно ли тащить эту строку. Разделители и записи без пути копирования в
   * мир (глоссарий и прочие типы из реестра карточек) не тащатся; в режиме
   * выбора заклинаний строка занята выбором.
   *
   * @param entry - запись компендиума
   * @returns true, если строку можно перетащить
   */
  function canDragEntry(entry: CompendiumDataItem): boolean {
    if (isSeparator(entry) || isSelectionMode.value) {
      return false;
    }

    return isCreatureDataItem(entry) || resolveEntryDrag(entry) !== null;
  }

  /**
   * Подсказка строки: существо принимает и стол, и правая панель, остальные
   * записи — только панель. У неперетаскиваемой строки подсказки нет.
   *
   * @param entry - запись компендиума
   * @returns текст подсказки или undefined
   */
  function entryDragHint(entry: CompendiumDataItem): string | undefined {
    if (!canDragEntry(entry)) {
      return undefined;
    }

    return isCreatureDataItem(entry)
      ? COMPENDIUM_LABELS.dragHint
      : COMPENDIUM_LABELS.dragHintEntry;
  }

  /**
   * Старт перетаскивания строки компендиума.
   *
   * @param entry - запись компендиума
   * @param event - событие dragstart
   */
  function onEntryDragStart(entry: CompendiumDataItem, event: DragEvent): void {
    if (!event.dataTransfer || !canDragEntry(entry)) {
      return;
    }

    if (isCreatureDataItem(entry)) {
      onCreatureDragStart(entry, event);

      return;
    }

    const dragged = resolveEntryDrag(entry);

    if (dragged) {
      startCompendiumEntryDrag(dragged, event.dataTransfer);
    }
  }

  /**
   * Завершение перетаскивания строки (сброс или отмена). Запись компендиума
   * ядро сбрасывает само по `dragend`, здесь остаётся payload токена.
   */
  function onEntryDragEnd(): void {
    clearActorDragPayload();
  }

  /**
   * Открывает детальный просмотр черты.
   * @param feature - черта для просмотра
   */
  function openFeatDetail(feature: Feature): void {
    getEntityCard('feat')?.openDetail?.(feature, {
      showCopyButton: true,
      onCopy: () => copyToItems(feature.id),
    });
  }

  onMounted(() => {
    if (props.socket) {
      props.socket.on('compendium:data', handleCompendiumData);
    }
  });

  onUnmounted(() => {
    if (props.socket) {
      props.socket.off('compendium:data', handleCompendiumData);
    }
  });

  // Загрузка данных при открытии или смене файла
  watch(
    () => [props.open, props.dataFile] as const,
    ([isOpen, currentFile], oldValue) => {
      // Если файл сменился — сбрасываем кеш и данные
      if (oldValue && currentFile !== oldValue[1]) {
        loadedFile.value = '';
        items.value = [];
        searchQuery.value = '';
        resetFilters();
        selectedSpells.value = new Set();
      }

      if (isOpen) {
        // Применяем начальные фильтры при открытии (id фильтров из манифеста
        // узла заклинаний: `class` — по классу, `level` — по кругу).
        if (props.initialClassFilter) {
          setEnumSelection('class', [props.initialClassFilter]);
        }

        if (props.initialLevelFilter && props.initialLevelFilter.length > 0) {
          setEnumSelection(
            'level',
            props.initialLevelFilter.map((level) => String(level)),
          );
        }

        requestData();
      }
    },
    { immediate: true },
  );
</script>

<template>
  <UDraggableModal
    v-bind="$attrs"
    :open="open"
    :title="title"
    :initial-width="modalWidth"
    :initial-height="modalHeight"
    :min-width="modalMinWidth"
    :min-height="250"
    :z-index="zIndex"
    :saved-position="savedPosition"
    :saved-size="savedSize ?? autoSize"
    :ui="{ body: 'overflow-hidden p-0 flex flex-col' }"
    @update:open="emit('update:open', $event)"
    @bring-to-front="emit('bring-to-front')"
  >
    <template #body>
      <!-- Layout: сайдбар + контент для заклинаний и существ, обычный для остального -->
      <div
        class="flex min-h-0 flex-1"
        :class="showFilterSidebar ? 'flex-row' : 'flex-col'"
      >
        <!-- Боковая панель фильтров (декларативно из view.filters) -->
        <div
          v-if="showFilterSidebar"
          class="flex w-52 shrink-0 flex-col gap-3 overflow-y-auto border-r border-accented/30 p-3"
        >
          <!-- Поиск -->
          <UInput
            v-model="searchQuery"
            icon="tabler:search"
            :placeholder="COMPENDIUM_LABELS.searchPlaceholder"
            size="sm"
            :ui="{ root: 'w-full' }"
          />

          <!-- Секции фильтров -->
          <div
            v-for="section in filterSections"
            :key="section.id"
            class="flex flex-col gap-1.5"
          >
            <span
              class="text-xs font-semibold tracking-wider text-muted uppercase"
            >
              {{ section.label }}
            </span>

            <!-- Короткие значения (круги, ПО) остаются бейджами в ряд: рядом
              они читаются шкалой, а строками заняли бы всю колонку -->
            <div
              v-if="section.type === 'enum' && section.style === 'badges'"
              class="flex flex-wrap gap-1"
            >
              <UBadge
                v-for="option in section.options"
                :key="option.value"
                :color="
                  isEnumActive(section.id, option.value) ? 'primary' : 'neutral'
                "
                :variant="
                  isEnumActive(section.id, option.value) ? 'solid' : 'subtle'
                "
                size="sm"
                class="cursor-pointer transition-all select-none"
                @click.left.exact.prevent="toggleEnum(section.id, option.value)"
              >
                {{ option.short }}
              </UBadge>
            </div>

            <!-- Названия (классы, категории) — строками во всю колонку, как в
              окнах выбора: в узкой плашке они не помещались -->
            <div
              v-else-if="section.type === 'enum'"
              class="flex flex-col gap-1"
            >
              <button
                v-for="option in section.options"
                :key="option.value"
                type="button"
                :class="filterRowClass(isEnumActive(section.id, option.value))"
                @click.left.exact.prevent="toggleEnum(section.id, option.value)"
              >
                <span class="truncate">{{ option.label }}</span>

                <UIcon
                  v-if="isEnumActive(section.id, option.value)"
                  name="tabler:check"
                  class="h-4 w-4 shrink-0 text-primary"
                />
              </button>
            </div>

            <!-- toggles: булевы переключатели — теми же строками -->
            <div
              v-else
              class="flex flex-col gap-1"
            >
              <button
                v-for="toggle in section.toggles"
                :key="toggle.key"
                type="button"
                :class="filterRowClass(isToggleActive(section.id, toggle.key))"
                @click.left.exact.prevent="toggleBool(section.id, toggle.key)"
              >
                <span class="flex min-w-0 items-center gap-1.5">
                  <UIcon
                    v-if="toggle.icon"
                    :name="toggle.icon"
                    class="size-3.5 shrink-0"
                    :class="TOGGLE_ICON_CLASS[toggle.color] ?? 'text-muted'"
                  />

                  <span class="truncate">{{ toggle.label }}</span>
                </span>

                <UIcon
                  v-if="isToggleActive(section.id, toggle.key)"
                  name="tabler:check"
                  class="h-4 w-4 shrink-0 text-primary"
                />
              </button>
            </div>
          </div>

          <!-- Сброс фильтров -->
          <UBadge
            v-if="hasActiveFilters"
            color="error"
            variant="subtle"
            size="sm"
            class="cursor-pointer transition-all select-none"
            @click.left.exact.prevent="resetFilters"
          >
            <UIcon
              name="tabler:x"
              class="mr-0.5 size-3.5"
            />
            {{ COMPENDIUM_LABELS.resetAll }}
          </UBadge>
        </div>

        <!-- Основная часть контента -->
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <!-- Поиск (когда нет сайдбара с фильтрами) -->
          <div
            v-if="!showFilterSidebar"
            class="shrink-0 px-4 pt-2 pb-2"
          >
            <UInput
              v-model="searchQuery"
              icon="tabler:search"
              :placeholder="SHEET_FILTER_LABELS.search"
              size="sm"
              :ui="{ root: 'w-full' }"
            />
          </div>

          <!-- Прокручиваемая область списка -->
          <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <!-- Загрузка -->
            <div
              v-if="isLoading"
              class="flex items-center justify-center py-8"
            >
              <UIcon
                name="tabler:loader-2"
                class="animate-spin text-2xl text-muted"
              />
            </div>

            <!-- Список записей: строки разделены линией, как в окнах выбора.
              Собственная плашка строки снята пропом `flat` — вместе с
              промежутками она превращала список в лесенку из таблеток -->
            <div
              v-else-if="visibleEntries.length > 0"
              class="flex flex-col divide-y divide-accented/25"
            >
              <template
                v-for="(entry, index) in visibleEntries"
                :key="
                  isSeparator(entry)
                    ? `sep-${index}`
                    : 'id' in entry
                      ? entry.id
                      : index
                "
              >
                <!-- Разделитель секции -->
                <div
                  v-if="isSeparator(entry)"
                  class="flex items-center gap-2 px-2 pt-3 pb-1"
                  :class="{ 'pt-1': index === 0 }"
                >
                  <span
                    class="shrink-0 text-xs font-semibold tracking-wider text-muted uppercase"
                  >
                    {{ entry.name }}
                  </span>

                  <div class="h-px flex-1 bg-accented/50" />
                </div>

                <!-- Строка списка целиком перетаскиваемая: существо принимает
                     стол (токен) и правая панель, остальные записи — только
                     правая панель. Одна обёртка на все виды: путь копирования
                     в мир у строки ровно один, и он же стоит за кнопкой
                     «Копировать». -->
                <div
                  v-else
                  :draggable="canDragEntry(entry)"
                  :title="entryDragHint(entry)"
                  @dragstart="onEntryDragStart(entry, $event)"
                  @dragend="onEntryDragEnd"
                >
                  <!-- Предмет: Вид -->
                  <template v-if="isSpeciesData && isSpeciesDefinition(entry)">
                    <EntityCard
                      flat
                      entity-type="species"
                      :entry="toCardEntry(entry)"
                      show-copy
                      @click="openSpeciesDetail(entry)"
                      @copy="copySpeciesToItems(entry)"
                    />
                  </template>

                  <!-- Предмет: Предыстория -->
                  <template
                    v-else-if="
                      isBackgroundData && isBackgroundDefinition(entry)
                    "
                  >
                    <EntityCard
                      flat
                      entity-type="background"
                      :entry="toCardEntry(entry)"
                      show-copy
                      @click="openBackgroundDetail(entry)"
                      @copy="copyToItems(backgroundCopyId(entry))"
                    />
                  </template>

                  <!-- Предмет: Класс -->
                  <template v-else-if="isClassData && isClassDefinition(entry)">
                    <EntityCard
                      flat
                      entity-type="class"
                      :entry="toCardEntry(entry)"
                      show-copy
                      @click="openClassDetail(entry)"
                      @copy="copyClassToItems(entry)"
                    />
                  </template>

                  <!-- Предмет: Черта -->
                  <template v-else-if="isFeatsData && isFeature(entry)">
                    <EntityCard
                      flat
                      entity-type="feat"
                      :entry="toCardEntry(entry)"
                      show-copy
                      @click="openFeatDetail(entry)"
                      @copy="copyToItems(entry.id)"
                    />
                  </template>

                  <!-- Предмет инвентаря (оружие/снаряжение/инструмент): тип
                       карточки берётся из собственного поля `type` записи -->
                  <template v-else-if="isGameItem(entry)">
                    <EntityCard
                      flat
                      :entity-type="entry.type"
                      :entry="toCardEntry(entry)"
                      show-copy
                      @click="openDetail(entry)"
                      @copy="copyToItems(entry.id)"
                    />
                  </template>

                  <!-- Существо: перетаскивание берёт на себя обёртка строки -->
                  <template v-else-if="isCreatureDataItem(entry)">
                    <EntityCard
                      flat
                      entity-type="creature"
                      :entry="toCardEntry(entry)"
                      show-copy
                      @click="openCreatureDetail(entry)"
                      @copy="copyCreature(entry)"
                    />
                  </template>

                  <!-- Предмет: Заклинание -->
                  <template v-else-if="isSpellDataItem(entry)">
                    <div class="flex items-center gap-2">
                      <!-- Предоставлено умением — несъёмная галочка -->
                      <UCheckbox
                        v-if="isSelectionMode && isSpellGranted(entry)"
                        :model-value="true"
                        disabled
                      />

                      <!-- Уже изученное заклинание — пометка вместо чекбокса -->
                      <UIcon
                        v-else-if="isSelectionMode && isSpellKnown(entry)"
                        name="tabler:check"
                        class="size-5 shrink-0 text-success"
                      />

                      <!-- Чекбокс выбора (только в режиме выбора) -->
                      <UCheckbox
                        v-else-if="isSelectionMode"
                        :model-value="selectedSpells.has(entry.id)"
                        :disabled="isSpellSelectionDisabled(entry)"
                        @update:model-value="toggleSpellSelection(entry)"
                      />

                      <!-- Строка занимает всю ширину: рядом с ней в режиме
                        выбора стоит чекбокс, поэтому строка тут флекс-элемент, а
                        не блок, и ширину надо назначить -->
                      <EntityCard
                        class="min-w-0 flex-1"
                        flat
                        :class="{
                          'opacity-60': isSelectionMode && isSpellKnown(entry),
                        }"
                        entity-type="spell"
                        :entry="toCardEntry(entry)"
                        :show-copy="!isSelectionMode"
                        @click="handleSpellClick(entry)"
                        @copy="copySpellToItems(entry)"
                        @share="shareSpell(entry)"
                      />

                      <UBadge
                        v-if="isSelectionMode && isSpellGranted(entry)"
                        color="primary"
                        variant="subtle"
                        size="sm"
                        class="shrink-0"
                      >
                        {{ GRANTED_SPELL_FEATURE_PREFIX
                        }}{{ getGrantedFeatureName(entry) }}
                      </UBadge>

                      <UBadge
                        v-else-if="isSelectionMode && isSpellKnown(entry)"
                        color="success"
                        variant="subtle"
                        size="sm"
                        class="shrink-0"
                      >
                        {{ COMPENDIUM_LABELS.known }}
                      </UBadge>

                      <!-- Сверх списка класса: откуда заклинание, раз оно не из
                        отфильтрованного списка -->
                      <UBadge
                        v-else-if="isSpellPinned(entry)"
                        color="info"
                        variant="subtle"
                        size="sm"
                        class="shrink-0"
                      >
                        {{ PINNED_SPELL_FEATURE_PREFIX
                        }}{{ getPinnedFeatureName(entry) }}
                      </UBadge>
                    </div>
                  </template>

                  <!-- Любой другой тип, ЗАРЕГИСТРИРОВАННЫЙ системой (глоссарий и
                       всё, что появится дальше): карточка и открытие детали берутся
                       из реестра, отдельной ветки на модалке заводить не нужно -->
                  <template v-else-if="registeredCardType(entry)">
                    <EntityCard
                      flat
                      :entity-type="registeredCardType(entry)"
                      :entry="toCardEntry(entry)"
                      @click="openRegisteredDetail(entry)"
                    />
                  </template>
                </div>
              </template>
            </div>

            <!-- Нет результатов поиска -->
            <div
              v-else-if="searchQuery.trim() && items.length > 0"
              class="py-8 text-center text-sm text-dimmed"
            >
              {{ COMPENDIUM_LABELS.nothingFound }}
            </div>

            <!-- Пусто -->
            <div
              v-else
              class="py-8 text-center text-sm text-dimmed"
            >
              {{ COMPENDIUM_LABELS.noData }}
            </div>
          </div>

          <!-- Панель подтверждения выбора (только в режиме выбора) -->
          <div
            v-if="isSelectionMode"
            class="shrink-0 border-t border-default/50 px-4 py-3"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                <span v-if="cantripsLimit !== undefined">
                  {{ COMPENDIUM_LABELS.cantripsPrefix }}
                  <span
                    class="font-semibold"
                    :class="
                      remainingCantripsSelections === 0
                        ? 'text-success'
                        : 'text-toned'
                    "
                  >
                    {{ selectedCantripsCount }}
                  </span>
                  /
                  <span class="font-semibold text-toned">{{
                    cantripsLimit
                  }}</span>
                </span>

                <span v-if="selectionLimit !== undefined">
                  {{ COMPENDIUM_LABELS.spellsPrefix }}
                  <span
                    class="font-semibold"
                    :class="
                      remainingSpellSelections === 0
                        ? 'text-success'
                        : 'text-toned'
                    "
                  >
                    {{ selectedSpellsCount }}
                  </span>
                  /
                  <span class="font-semibold text-toned">{{
                    selectionLimit
                  }}</span>
                </span>
              </div>

              <UButton
                color="primary"
                size="sm"
                :disabled="selectedSpells.size === 0 || isLoading"
                @click.left.exact.prevent="confirmSpellSelection"
              >
                <UIcon
                  name="tabler:check"
                  class="mr-1 size-4"
                />
                {{ COMPENDIUM_LABELS.addSelected }}
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDraggableModal>
</template>
