/**
 * Видимые строки раздела «Состояния» (карточка, просмотр, форма).
 *
 * @module systems/dnd5e/ui/condition/conditionConsts
 */

/**
 * Значки, предлагаемые формой состояния.
 *
 * Список ЗАКРЫТЫЙ, а не поле для ввода имени иконки: имя вне локальной
 * коллекции `tabler` iconify молча тянет с api.iconify.design — у мастера
 * значок виден, а у игрока без доступа к сети остаётся пустое место. Первые
 * шестнадцать — значки канонных состояний, дальше — набор на свои состояния.
 */
export const CONDITION_ICON_CHOICES: readonly string[] = [
  'tabler:eye-off',
  'tabler:heart',
  'tabler:ear-off',
  'tabler:battery-off',
  'tabler:mood-sad',
  'tabler:hand-stop',
  'tabler:ban',
  'tabler:eye-closed',
  'tabler:user-minus',
  'tabler:diamond',
  'tabler:droplet',
  'tabler:download',
  'tabler:link',
  'tabler:bolt',
  'tabler:zzz',
  'tabler:skull',
  'tabler:flame',
  'tabler:snowflake',
  'tabler:wind',
  'tabler:biohazard',
  'tabler:virus',
  'tabler:bug',
  'tabler:ghost',
  'tabler:spider',
  'tabler:shield',
  'tabler:shield-off',
  'tabler:sparkles',
  'tabler:star',
  'tabler:moon',
  'tabler:sun',
  'tabler:cloud-fog',
  'tabler:flask',
  'tabler:bandage',
  'tabler:heart-broken',
  'tabler:activity-heartbeat',
  'tabler:alert-triangle',
  'tabler:lock',
  'tabler:swords',
  'tabler:wand',
  'tabler:hourglass',
  'tabler:feather',
  'tabler:brain',
  'tabler:bone',
  'tabler:anchor',
];

/** Идентификатор окна правки эффекта, открываемого поверх формы состояния. */
export const CONDITION_EFFECT_MODAL_ID = 'condition-effect-form-modal';

/** Значки формы состояния, зависящие от её состояния. */
export const CONDITION_FORM_ICONS = {
  /** Файловый менеджер раскрыт — кнопка сворачивает его */
  collapseAssets: 'tabler:chevron-up',
  /** Файловый менеджер свёрнут — кнопка раскрывает его */
  expandAssets: 'tabler:folder',
} as const;

/** Имена окон состояния в реестре модалок (ядро открывает их по имени). */
export const CONDITION_MODALS = {
  /** Карточка состояния */
  detail: 'ConditionDetailModal',
  /** Форма создания и правки состояния */
  form: 'ConditionFormModal',
} as const;

/** Подписи карточки и списка состояний. */
export const CONDITION_LABELS = {
  /** Подпись раздела в «Мастерской» */
  kind: 'Состояния',
  /** Пометка канонного состояния, правленного в мире */
  overridden: 'Правка канона',
  /** Пометка состояния без эффекта */
  markOnly: 'без эффекта',
} as const;

/** Подписи окна просмотра состояния. */
export const CONDITION_DETAIL_LABELS = {
  /** Заголовок блока описания */
  description: 'Описание',
  /** Заголовок блока эффекта */
  effect: 'Эффект',
  /** Текст, когда у состояния нет эффекта */
  noEffect:
    'Состояние ничего не считает: это метка, которую мастер трактует сам.',
  /** Подпись английского названия */
  nameEn: 'Английское название',
} as const;

/** Подписи формы состояния. */
export const CONDITION_FORM_LABELS = {
  /** Заголовок создания */
  createTitle: 'Новое состояние',
  /** Заголовок правки */
  editTitle: 'Правка состояния',
  /** Поле названия */
  name: 'Название',
  /** Плейсхолдер названия */
  namePlaceholder: 'Например: Проклятие ведьмы',
  /** Поле английского названия */
  nameEn: 'Английское название',
  /** Плейсхолдер английского названия */
  nameEnPlaceholder: 'Witch Curse',
  /** Кнопка выбора канонного состояния как основы */
  fromPreset: 'Взять из пресета',
  /** Пояснение к кнопке пресетов */
  fromPresetHint: 'Состояния PHB 2024 — как основа для своего',
  /** Пояснение, когда пресет уже взят */
  presetTakenHint: 'Запись заменит канонное состояние в этом мире',
  /** Поле описания */
  description: 'Описание',
  /** Блок значка */
  icon: 'Значок',
  /** Плейсхолдер поля картинки */
  pickImage: 'Своя картинка',
  /** Кнопка раскрытия файлового менеджера мира */
  pickFromWorld: 'Выбрать из файлов мира',
  /** Кнопка сброса картинки */
  clearImage: 'Убрать картинку',
  /** Пояснение к картинке */
  imageHint:
    'Картинка рисуется силуэтом (заливка берётся цветом значка), поэтому годится монохромный SVG или PNG с прозрачным фоном.',
  /** Переключатель значка поверх фишки */
  overlay: 'Значок поверх всей фишки',
  /** Пояснение к переключателю */
  overlayHint:
    'Для состояний, описывающих существо целиком (как «Мёртв»): значок рисуется крупно поверх токена, а не ячейкой в сетке статусов.',
  /** Блок эффекта */
  effect: 'Эффект',
  /** Пояснение к эффекту */
  effectHint:
    'Эффект висит на сущности, пока состояние активно: модификаторы, флаги и иммунитеты к другим состояниям.',
  /** Кнопка настройки эффекта */
  editEffect: 'Настроить эффект',
  /** Кнопка удаления эффекта */
  clearEffect: 'Убрать эффект',
  /** Текст, когда эффекта нет */
  noEffect: 'Эффекта нет — состояние будет чистой меткой',
  /** Кнопка сброса правки канона */
  resetToCanon: 'Сбросить к канону',
  /** Пояснение к сбросу */
  resetHint:
    'Правка канонного состояния живёт в этом мире. Сброс удаляет её и возвращает состояние из системы.',
  /** Пояснение к канонному состоянию со степенями */
  lockedTemplateHint:
    'Эффект Истощения считается по степеням, поэтому правится только оформление: название, значок и описание.',
  /** Кнопка сохранения */
  save: 'Сохранить',
  /** Кнопка отмены */
  cancel: 'Отмена',
} as const;
