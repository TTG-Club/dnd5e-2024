/**
 * Типизированные карты WebSocket-событий.
 * Shared между клиентом и сервером.
 *
 * @module shared/wsEvents
 */

/**
 * Манифест клиентского модуля для динамической загрузки.
 * Сервер сканирует world/modules/ и возвращает этот тип клиенту.
 */
import type {
  AmmunitionTypeDefinition,
  ArmorBaseTypeDefinition,
  BaseActor,
  BaseCreature,
  BaseGameItem,
  ChatMessage,
  ClientModuleManifest,
  CompendiumManifest,
  CompendiumSeparator,
  CompendiumSrcIndex,
  CursorPosition,
  DamageTypeDefinition,
  Drawing,
  EncounterState,
  EquipmentCategoryDefinition,
  EquipmentPropertyDefinition,
  FogBrushPoint,
  FogLoadResponse,
  FogLoadSceneResponse,
  FogSavePayload,
  GmBroadcastFrameSync,
  GraphEdge,
  GraphNode,
  GraphNodeMove,
  LightSource,
  MeasurementTemplate,
  Note,
  OnlineUserData,
  Playlist,
  Scene,
  SceneAsset,
  ServerUser,
  SourceDefinition,
  Token,
  TokenTargetMark,
  ToolPropertyDefinition,
  TransitionArea,
  UserSettings,
  WeaponBaseTypeDefinition,
  WeaponCategoryDefinition,
  WeaponPropertyDefinition,
  World,
} from './types/index.js';

// --- Server → Client Events ---

/** Одно событие в топе серверного профайлера */
export interface ServerPerfEvent {
  /** Имя WS-события */
  event: string;
  /** Сколько раз обработано за интервал */
  count: number;
  /** Суммарное время обработки за интервал, мс */
  totalMs: number;
  /** Максимальное время одной обработки, мс */
  maxMs: number;
}

/** Снапшот серверной производительности для панели мониторинга */
export interface ServerPerfStats {
  /** Задержка event-loop за интервал, мс (коррелирует со спайками ping) */
  loopLag: { mean: number; p50: number; p99: number; max: number };
  /** Топ событий по суммарному времени обработки */
  topEvents: ServerPerfEvent[];
  /** Количество подключённых клиентов */
  clients: number;
}

/**
 * Типизированная карта серверных событий (Server → Client).
 * Определяет сигнатуры callback-обработчиков для каждого входящего события.
 */
export interface ServerToClientEvents {
  'connect': () => void;
  'disconnect': () => void;
  'connect_error': () => void;
  'users:list': (users: OnlineUserData[]) => void;
  'user:connected': (user: OnlineUserData) => void;
  'user:disconnected': (userId: string) => void;
  /**
   * Сервер отверг user:register (токен недействителен или истёк).
   * Клиент должен вернуться к экрану входа и пройти авторизацию заново.
   */
  'auth:register-rejected': () => void;
  'user:restrictions_updated': (
    userId: string,
    restrictions: import('./types/index.js').UserRestrictions,
  ) => void;
  'scene:created': (scene: Scene) => void;
  'scene:updated': (scene: Scene) => void;
  /**
   * Ре-синк сцены при входе: сервер досылает входящему клиенту актуальный
   * снапшот сцены. Нужен потому, что scene-scoped бродкасты (token:updated и др.)
   * не доходят до клиента, пока он на другой сцене — на возврате состояние
   * восстанавливается этим событием (иначе позиции токенов/свет/рисунки
   * остаются устаревшими до F5).
   */
  'scene:resync': (scene: Scene) => void;
  /** Легковесное обновление метаданных сцены (без tokens, drawings, assets и пр.) */
  'scene:metadata-updated': (sceneId: string, metadata: Partial<Scene>) => void;
  'scene:deleted': (sceneId: string) => void;
  /** Новый порядок сцен (полный упорядоченный список ID) */
  'scene:reordered': (orderedSceneIds: string[]) => void;
  'creature:created': (creature: BaseCreature) => void;
  'creature:updated': (creature: BaseCreature) => void;
  'creature:deleted': (creatureId: string) => void;
  'actor:created': (actor: BaseActor) => void;
  'actor:updated': (actor: BaseActor) => void;
  /** Легковесное обновление только activeEffects актёра (area-эффекты) */
  'actor:effects-changed': (
    actorId: string,
    activeEffects: BaseActor['activeEffects'],
  ) => void;
  'actor:deleted': (actorId: string) => void;
  'token:created': (sceneId: string, token: Token) => void;
  'token:updated': (sceneId: string, token: Token) => void;
  'token:route-moved': (
    sceneId: string,
    tokenId: string,
    targetX: number,
    targetY: number,
    waypoints: Array<{ x: number; y: number }>,
  ) => void;
  /**
   * Движение оборвано на полпути: зона отняла у сущности возможность двигаться
   * (окаменение, опутывание, спас провален). Токен уже стоит в клетке обрыва —
   * позицию персистит и рассылает обычный `token:updated`, а это событие говорит
   * клиентам ОСТАНОВИТЬ едущую анимацию там же и объяснить игроку причину.
   */
  'token:movement-stopped': (
    sceneId: string,
    tokenId: string,
    x: number,
    y: number,
    reason: string,
  ) => void;
  // Мгновенная перестановка токена без анимации (повторный DnD из списка)
  'token:teleported': (
    sceneId: string,
    tokenId: string,
    x: number,
    y: number,
  ) => void;
  'token:deleted': (sceneId: string, tokenId: string) => void;
  'asset:created': (sceneId: string, asset: SceneAsset) => void;
  'asset:updated': (sceneId: string, asset: SceneAsset) => void;
  'asset:deleted': (sceneId: string, assetId: string) => void;
  'world:updated': (world: World) => void;
  /**
   * Состав пользователей мира — приходит сразу после `user:register`.
   *
   * Отдельное лёгкое событие, а не `world:updated` целиком: тот тянет за собой
   * сцены, актёров и существ, которые при входе и так пересылаются поштучно.
   * Раньше состав ехал открытой ручкой `GET /api/world` ДО входа, из-за чего
   * роли всех участников (в том числе «кто здесь мастер») видел любой, кто
   * знает адрес мира. Теперь он едет по аутентифицированному каналу.
   */
  'world:users': (users: ServerUser[]) => void;
  'module:custom-event': (
    moduleId: string,
    eventName: string,
    payload: unknown,
  ) => void;
  'module:reload': (moduleId: string) => void;
  /** Настройки модуля изменились — клиентам стоит перечитать значение */
  'module:settings-changed': (moduleId: string, key: string) => void;
  'scene:force-view': (sceneId: string) => void;
  'scene:navigable-changed': (sceneId: string, isNavigable: boolean) => void;
  'player:location-changed': (
    playerId: string,
    sceneId: string | null,
    username: string,
  ) => void;
  'transition:created': (sceneId: string, area: TransitionArea) => void;
  'transition:updated': (sceneId: string, area: TransitionArea) => void;
  'transition:deleted': (sceneId: string, areaId: string) => void;
  // Custom areas (polygon / circle)
  'custom-area:created': (
    sceneId: string,
    area: import('./types/index.js').CustomArea,
  ) => void;
  'custom-area:updated': (
    sceneId: string,
    area: import('./types/index.js').CustomArea,
  ) => void;
  'custom-area:deleted': (sceneId: string, areaId: string) => void;
  'transition:teleport-result': (data: {
    success: boolean;
    tokenId: string;
    targetSceneId: string;
    targetX: number;
    targetY: number;
    error?: string;
    initiatedBy?: string;
  }) => void;
  'cursor:update': (cursor: CursorPosition) => void;
  'cursor:remove': (userId: string) => void;
  // --- Кто взял токен в цель (кружки над токеном) ---
  'target:update': (mark: TokenTargetMark) => void;
  'target:state': (sceneId: string, marks: TokenTargetMark[]) => void;
  // --- Трансляционные рамки ГМа (только между ГМами) ---
  'gm-broadcast:upsert': (frame: GmBroadcastFrameSync) => void;
  'gm-broadcast:remove': (frameId: string) => void;
  'gm-broadcast:sync': (frames: GmBroadcastFrameSync[]) => void;
  'playlist:created': (playlist: Playlist) => void;
  'playlist:updated': (playlist: Playlist) => void;
  'playlist:deleted': (playlistId: string) => void;
  'admin:manage-users-result': (data: {
    success: boolean;
    restarting: boolean;
    error?: string;
  }) => void;
  // Initiative / Encounter
  'initiative:state': (
    encounters: EncounterState[],
    activeEncounterId: string | null,
  ) => void;
  // Sound effects
  'sound:play-effect': (soundUrl: string) => void;
  // Audio control
  'audio:muted-all': (muted: boolean) => void;
  // Compendium
  'compendium:manifest': (manifests: CompendiumManifest[]) => void;
  'compendium:data': (
    dataFile: string,
    items: (BaseGameItem | CompendiumSeparator)[],
  ) => void;
  /**
   * Агрегированные по каноническому типу записи всех паков (бандл + скачиваемые +
   * модули) — ответ на `compendium:request-kind`. Используется логикой листа
   * актёра (классы/виды/черты/заклинания) вместо адресации по одному `dataFile`.
   */
  'compendium:kind-data': (
    dataKind: string,
    items: (BaseGameItem | CompendiumSeparator)[],
  ) => void;
  /**
   * Индекс «страница-источник → запись» по всем пакам — ответ на
   * `compendium:request-src-index`. По нему клиент решает, открывать ли ссылку из
   * описания внутри приложения или отдать её браузеру.
   */
  'compendium:src-index': (index: CompendiumSrcIndex) => void;
  /** Компедиум обновлён на сервере — клиентам перезапросить манифесты/данные */
  'compendium:updated': () => void;
  // System data (свойства оружия и т.д.)
  'system:weapon-properties': (properties: WeaponPropertyDefinition[]) => void;
  'system:weapon-base-types': (baseTypes: WeaponBaseTypeDefinition[]) => void;
  'system:damage-types': (damageTypes: DamageTypeDefinition[]) => void;
  'system:weapon-categories': (categories: WeaponCategoryDefinition[]) => void;
  'system:ammunition-types': (types: AmmunitionTypeDefinition[]) => void;
  'system:sources': (sources: SourceDefinition[]) => void;
  'system:equipment-categories': (
    categories: EquipmentCategoryDefinition[],
  ) => void;
  'system:equipment-properties': (
    properties: EquipmentPropertyDefinition[],
  ) => void;
  'system:armor-base-types': (baseTypes: ArmorBaseTypeDefinition[]) => void;
  'system:tool-properties': (properties: ToolPropertyDefinition[]) => void;
  /** Агрегированный ответ на system:request-all — все справочные данные одним пакетом */
  'system:all-data': (data: {
    weaponProperties: WeaponPropertyDefinition[];
    weaponBaseTypes: WeaponBaseTypeDefinition[];
    damageTypes: DamageTypeDefinition[];
    weaponCategories: WeaponCategoryDefinition[];
    ammunitionTypes: AmmunitionTypeDefinition[];
    sources: SourceDefinition[];
    equipmentCategories: EquipmentCategoryDefinition[];
    equipmentProperties: EquipmentPropertyDefinition[];
    armorBaseTypes: ArmorBaseTypeDefinition[];
    toolProperties: ToolPropertyDefinition[];
  }) => void;
  // Items (пользовательские предметы)
  'items:created': (item: BaseGameItem) => void;
  'items:updated': (item: BaseGameItem) => void;
  'items:deleted': (itemId: string) => void;
  'items:list': (items: BaseGameItem[]) => void;
  /** Предмет не принят сервером: в названии или описании исполняемое содержимое */
  'items:rejected': (reason: string) => void;
  // Chat
  'chat:message': (message: ChatMessage) => void;
  'chat:history': (messages: ChatMessage[]) => void;
  'chat:cleared': () => void;
  /** ГМ удалил конкретное сообщение — убрать его у всех клиентов */
  'chat:message-deleted': (messageId: string) => void;
  /**
   * Хеш состояния мира (сцены+существа+актёры) на момент полной синхронизации.
   * Клиент хранит его и шлёт обратно в `user:register`; если на реконнекте хеш
   * совпал — сервер пропускает повторную полную пересылку мира.
   */
  'world:sync-hash': (hash: string) => void;
  // Drawing (Server → Client)
  'drawing:created': (sceneId: string, drawing: Drawing) => void;
  'drawing:updated': (sceneId: string, drawing: Drawing) => void;
  'drawing:deleted': (sceneId: string, drawingId: string) => void;
  'drawing:clear': (sceneId: string) => void;
  'drawings:batch-deleted': (sceneId: string, drawingIds: string[]) => void;
  'walls:clear': (sceneId: string) => void;
  // Fog (Server → Client)
  'fog:updated': (data: {
    sceneId: string;
    actorId: string;
    /** Дельта точек — если присутствует, клиент применяет их напрямую без fog:load */
    points?: Array<{ x: number; y: number; radius: number }>;
  }) => void;
  'scene:clearAllFogOfWar': (sceneId: string) => void;
  'scene:clearActorFogOfWar': (sceneId: string, actorId: string) => void;
  'fog:brush-stroke-added': (sceneId: string, point: FogBrushPoint) => void;
  /** Лёгкое событие очистки brush-точек — заменяет тяжёлый scene:updated */
  'fog:brush-cleared': (sceneId: string) => void;
  // Journal (Server → Client)
  'journal:created': (note: Note) => void;
  /** Запись журнала не принята: в заголовке или странице исполняемое содержимое */
  'journal:rejected': (reason: string) => void;
  'journal:updated': (note: Note) => void;
  'journal:deleted': (noteId: string) => void;
  'journal:list': (notes: Note[]) => void;
  'journal:show-note': (note: Note) => void;
  'journal:note-pinned': (pin: import('./types/index.js').NotePin) => void;
  'journal:note-unpinned': (pinId: string) => void;
  'journal:pins-list': (pins: import('./types/index.js').NotePin[]) => void;
  'journal:pin-moved': (data: { pinId: string; x: number; y: number }) => void;
  'journal:pin-visibility-map': (
    visibilityMap: Record<string, boolean>,
  ) => void;
  'journal:note-data': (note: Note) => void;
  'journal:pin-visibility-changed': (data: {
    noteId: string;
    isPinVisible: boolean;
    pins: import('./types/index.js').NotePin[];
  }) => void;
  // Journal Folders (Server → Client)
  'journal:folder-created': (
    folder: import('./types/index.js').JournalFolder,
  ) => void;
  'journal:folder-updated': (
    folder: import('./types/index.js').JournalFolder,
  ) => void;
  'journal:folder-deleted': (folderId: string) => void;
  'journal:folders-list': (
    folders: import('./types/index.js').JournalFolder[],
  ) => void;
  'journal:reordered': (
    items: import('./types/index.js').JournalReorderItem[],
  ) => void;
  // Граф приключения (Server → Client).
  // Сервер фильтрует ПЕРЕД отправкой: игроки получают только revealed-узлы
  // без gmNotes и рёбра, у которых раскрыты оба конца. Reveal-переходы сервер
  // транслирует игрокам явными created/deleted (паттерн журнала).
  /** Полный (для игрока — отфильтрованный) снапшот графа в ответ на graph:request */
  'graph:data': (
    sceneId: string,
    nodes: GraphNode[],
    edges: GraphEdge[],
  ) => void;
  'graph:node-created': (node: GraphNode) => void;
  /**
   * Полный объект узла (не патч) — обходит ловушку JSON-сериализации
   * хвостовых undefined. Клиент делает upsert: узел мог стать видимым.
   */
  'graph:node-updated': (node: GraphNode) => void;
  'graph:node-deleted': (sceneId: string, nodeId: string) => void;
  /** Батч перемещений (drag); игрокам — только revealed-узлы */
  'graph:nodes-moved': (sceneId: string, moves: GraphNodeMove[]) => void;
  'graph:edge-created': (edge: GraphEdge) => void;
  'graph:edge-updated': (edge: GraphEdge) => void;
  'graph:edge-deleted': (sceneId: string, edgeId: string) => void;
  // Папки сущностей: актёры и существа (Server → Client)
  /**
   * `hiddenEntityIds` — сущности из скрытых веток. Игроку их не показываем
   * вовсе: без этого списка сущность без размещения просто всплыла бы в корень.
   * Для ГМа список всегда пустой.
   */
  'entity-folder:list': (
    kind: import('./types/index.js').EntityFolderKind,
    folders: import('./types/index.js').EntityFolder[],
    placements: import('./types/index.js').EntityFolderPlacement[],
    hiddenEntityIds: string[],
  ) => void;
  'entity-folder:created': (
    folder: import('./types/index.js').EntityFolder,
  ) => void;
  'entity-folder:updated': (
    folder: import('./types/index.js').EntityFolder,
  ) => void;
  'entity-folder:deleted': (
    kind: import('./types/index.js').EntityFolderKind,
    folderId: string,
  ) => void;
  'entity-folder:entities-moved': (
    kind: import('./types/index.js').EntityFolderKind,
    placements: import('./types/index.js').EntityFolderPlacement[],
    hiddenEntityIds: string[],
  ) => void;
  'entity-folder:reordered': (
    kind: import('./types/index.js').EntityFolderKind,
    placements: import('./types/index.js').EntityFolderPlacement[],
    folders: import('./types/index.js').EntityFolder[],
  ) => void;
  // Lighting (Server → Client)
  'lighting:changed': (sceneId: string, mode: 'day' | 'night') => void;
  'light-source:created': (sceneId: string, lightSource: LightSource) => void;
  'light-source:updated': (sceneId: string, lightSource: LightSource) => void;
  'light-source:deleted': (sceneId: string, lightSourceId: string) => void;
  // Template (Server → Client)
  'template:created': (sceneId: string, template: MeasurementTemplate) => void;
  'template:updated': (sceneId: string, template: MeasurementTemplate) => void;
  'template:deleted': (sceneId: string, templateId: string) => void;
  'template:cleared': (sceneId: string) => void;
  // Token selection
  'token:selected': (tokenId: string | null) => void;
  // User settings
  'user:settings': (settings: UserSettings) => void;
  // Cursor (broadcast)
  'cursor:ping': (data: CursorPosition) => void;
  'cursor:gm-ping': (data: CursorPosition) => void;
  // Game pause
  /** Уведомление всем клиентам об изменении состояния паузы */
  'game:paused': (isPaused: boolean) => void;
  // Performance monitor
  /** Периодический снапшот серверной производительности (loop-lag + топ событий) */
  'perf:server-stats': (stats: ServerPerfStats) => void;
}

// --- Client → Server Events ---

/**
 * Типизированная карта клиентских событий (Client → Server).
 * Определяет сигнатуры callback-обработчиков для каждого входящего события от клиента.
 */
export interface ClientToServerEvents {
  // --- User ---
  /**
   * Регистрация WS-сессии. Принимает токен сессии, выданный `/api/login`,
   * а не голый userId — сервер сам определяет пользователя по токену.
   */
  'user:register': (sessionToken: string, clientWorldHash?: string) => void;
  'user:update-settings': (settings: Partial<UserSettings>) => void;
  'user:update_restrictions': (
    userId: string,
    restrictions: import('./types/index.js').UserRestrictions,
  ) => void;
  'admin:manage-users': (
    newUsers: ServerUser[],
    callback: (result: {
      success: boolean;
      restarting: boolean;
      error?: string;
    }) => void,
  ) => void;
  'admin:manage-role-permissions': (
    permissions: Record<string, string[]>,
    callback: (result: {
      success: boolean;
      restarting: boolean;
      error?: string;
    }) => void,
  ) => void;
  'disconnect': () => void;
  /** Ping-замер. Сервер возвращает своё текущее время (мс) для синхронизации часов. */
  'ping': (callback: (serverTime: number) => void) => void;
  // Game pause
  /** Запрос на переключение состояния паузы (только для пользователей с правом TOGGLE_PAUSE) */
  'game:toggle-pause': () => void;

  // --- Scene ---
  'scene:created': (scene: Scene) => void;
  'scene:updated': (scene: Scene) => void;
  'scene:deleted': (sceneId: string) => void;
  /** Запрос на изменение порядка сцен (только админ); полный упорядоченный список ID */
  'scene:reordered': (orderedSceneIds: string[]) => void;
  'scene:updateFogOfWar': (
    sceneId: string,
    actorId: string,
    exploredData: unknown,
  ) => void;
  'scene:clearAllFogOfWar': (sceneId: string) => void;
  'scene:clearActorFogOfWar': (sceneId: string, actorId: string) => void;
  'player:change-scene': (sceneId: string | null) => void;
  'gm:summon-all': (sceneId: string) => void;
  'gm:toggle-navigable': (sceneId: string) => void;

  // --- Drawing ---
  'drawing:created': (sceneId: string, drawing: Drawing) => void;
  'drawing:updated': (sceneId: string, drawing: Drawing) => void;
  'drawing:deleted': (sceneId: string, drawingId: string) => void;
  'drawings:batch-deleted': (sceneId: string, drawingIds: string[]) => void;
  'drawing:clear': (sceneId: string) => void;
  'walls:clear': (sceneId: string) => void;

  // --- Token ---
  'token:created': (sceneId: string, token: Token) => void;
  /**
   * Перемещение (и любая другая правка) токена.
   *
   * `movementPath` — центры клеток пройденного маршрута, от клетки старта до
   * клетки финиша. Нужен зонам сцены: их разовые триггеры срабатывают на
   * ПЕРЕСЕЧЕНИИ, а по двум точкам «откуда» и «куда» пробежка насквозь неотличима
   * от обхода стороной. Сервер маршруту не верит на слово — проверяет связность
   * и концы (см. `tokensModule`), и при непройденной проверке считает по двум
   * точкам, как раньше. Без пути (стрелки, перестановка из списка) поле опущено.
   */
  'token:updated': (
    sceneId: string,
    token: Token,
    movementPath?: Array<{ x: number; y: number }>,
  ) => void;
  'token:route-moved': (
    sceneId: string,
    tokenId: string,
    targetX: number,
    targetY: number,
    waypoints: Array<{ x: number; y: number }>,
  ) => void;
  // Мгновенная перестановка токена без анимации (повторный DnD из списка)
  'token:teleported': (
    sceneId: string,
    tokenId: string,
    x: number,
    y: number,
  ) => void;
  'token:deleted': (sceneId: string, tokenId: string) => void;
  'token:select': (sceneId: string, tokenId: string | null) => void;
  'token:get-selection': (
    sceneId: string,
    userId: string,
    callback: (tokenId: string | null) => void,
  ) => void;

  // --- Asset ---
  'asset:created': (sceneId: string, asset: SceneAsset) => void;
  'asset:updated': (sceneId: string, asset: SceneAsset) => void;
  'asset:deleted': (sceneId: string, assetId: string) => void;

  // --- Actor ---
  'actor:created': (actor: BaseActor) => void;
  'actor:updated': (actor: BaseActor) => void;
  'actor:deleted': (actorId: string) => void;
  'actor:duplicate': (actorId: string) => void;
  /**
   * Продублировать актёра и сразу поставить копию токеном на стол
   * (копирование токена через Ctrl + C / Ctrl + V). Сервер клонирует актёра
   * с ассетами, даёт копии уникальное имя (суффикс " 1", " 2"), создаёт токен
   * (actorId выставляется на id копии) и рассылает actor:created +
   * token:created. Fire-and-forget (без ack), как и `creature:instantiate`.
   *
   * Своё событие, а не пара `actor:duplicate` + `token:created`: без атомарной
   * операции токен и карточка копии расходятся.
   */
  'actor:instantiate': (
    sourceActorId: string,
    sceneId: string,
    token: Token,
    /**
     * ID будущей копии — его придумывает КЛИЕНТ (формат `generateId('actor')`).
     * Иначе id копии знал бы только сервер, и Ctrl + Z умел бы убрать токен, но
     * не карточку. Сервер сверяет формат (`isGeneratedId`) и занятость: чужой
     * или кривой id — отказ целиком, потому что «молча выдать другой» превратило
     * бы отмену в удаление постороннего актёра.
     */
    newActorId: string,
  ) => void;

  // --- Creature ---
  'creature:created': (creature: BaseCreature) => void;
  'creature:updated': (creature: BaseCreature) => void;
  'creature:deleted': (creatureId: string) => void;
  'creature:duplicate': (creatureId: string) => void;
  /**
   * Создать скрытый экземпляр существа и сразу поставить его токеном на стол
   * (Shift-перетаскивание). Сервер клонирует существо с ассетами, помечает
   * isInstance, создаёт токен (actorId перезаписывается на id копии) и
   * рассылает creature:created + token:created. Fire-and-forget (без ack):
   * наш WS-слой передаёт callback только при ackId, а обычный emit его не шлёт.
   */
  'creature:instantiate': (
    sourceCreatureId: string,
    sceneId: string,
    token: Token,
    /**
     * Если ЧИСЛО — текущие и максимальные ХП экземпляра выставляются в это
     * значение (случайный бросок по формуле хитов на клиенте). Используется при
     * Alt-клике по «+1», чтобы каждая копия получила свой запас ХП.
     *
     * `null` в типе не случаен: аргументы событий уезжают через
     * `JSON.stringify`, и хвостовой `undefined` внутри массива превращается в
     * `null`. Получатель обязан проверять `typeof === 'number'`, а не
     * `!== undefined` — иначе «нет перекрытия» затрёт ХП копии нулём.
     */
    hpOverride?: number | null,
  ) => void;

  // --- Боевое состояние сущности ---
  /**
   * Применить к сущности БОЕВОЕ СОСТОЯНИЕ — узкий канал для урона, лечения и
   * наложенных эффектов.
   *
   * Зачем отдельно от `actor:updated` / `creature:updated`: те события заменяют
   * сущность ЦЕЛИКОМ, поэтому сервер пускает в них только владельца и ГМа. Атака
   * же по определению меняет ЧУЖУЮ цель — раньше такое обновление молча
   * отбрасывалось, и урон игрока «не проходил» (по себе проходил, у ГМа работало).
   *
   * `state` — непрозрачный для ядра снимок из `VttSystem.pickCombatState`; сервер
   * лишь маршрутизирует его в `VttSystem.applyCombatState`, которая записывает
   * ТОЛЬКО боевые поля. Остальной лист цели каналом недосягаем.
   *
   * Fire-and-forget: результат для чата вызывающий считает сам, а фактическое
   * изменение прилетает обычным `actor:updated` / `creature:updated`.
   */
  'entity:apply-combat-state': (entityId: string, state: unknown) => void;

  // --- Lighting ---
  'lighting:changed': (sceneId: string, mode: 'day' | 'night') => void;
  'light-source:created': (sceneId: string, lightSource: LightSource) => void;
  'light-source:updated': (sceneId: string, lightSource: LightSource) => void;
  'light-source:deleted': (sceneId: string, lightSourceId: string) => void;

  // --- Template ---
  'template:create': (sceneId: string, template: MeasurementTemplate) => void;
  'template:update': (sceneId: string, template: MeasurementTemplate) => void;
  'template:delete': (sceneId: string, templateId: string) => void;
  'template:clear': (sceneId: string) => void;

  // --- Transition ---
  'transition:create': (
    sceneId: string,
    areaData: Omit<TransitionArea, 'id' | 'sceneId'>,
  ) => void;
  'transition:update': (sceneId: string, area: TransitionArea) => void;
  'transition:delete': (sceneId: string, areaId: string) => void;
  'transition:teleport': (
    sceneId: string,
    areaId: string,
    tokenId: string,
  ) => void;

  // --- Custom Areas ---
  'custom-area:create': (
    sceneId: string,
    areaData: Omit<import('./types/index.js').CustomArea, 'id'>,
  ) => void;
  'custom-area:update': (
    sceneId: string,
    areaId: string,
    updates: Partial<
      Pick<
        import('./types/index.js').CustomArea,
        | 'color'
        | 'points'
        | 'opacity'
        | 'aboveTokens'
        | 'blocksVision'
        | 'blocksLight'
        | 'effects'
        | 'hiddenFromPlayers'
        | 'hideFromBroadcast'
      >
    >,
  ) => void;
  'custom-area:delete': (sceneId: string, areaId: string) => void;

  // --- Fog ---
  'fog:save': (data: {
    sceneId: string;
    actorId: string;
    fogData: FogSavePayload;
  }) => void;
  'fog:append': (
    data: {
      sceneId: string;
      actorId: string;
      deltaPoints: Array<{
        x: number;
        y: number;
        radius: number;
        polygon?: number[];
      }>;
    },
    callback: (response: { success: boolean }) => void,
  ) => void;
  'fog:load': (
    data: { sceneId: string; actorId: string },
    callback: (response: FogLoadResponse) => void,
  ) => void;
  'fog:load-scene': (
    sceneId: string,
    callback: (response: FogLoadSceneResponse) => void,
  ) => void;
  'fog:updated': (data: {
    sceneId: string;
    actorId: string;
    /** Дельта точек для инлайн-передачи другим клиентам */
    points?: Array<{ x: number; y: number; radius: number }>;
  }) => void;
  'fog:brush-stroke': (
    sceneId: string,
    point: FogBrushPoint,
    callback: (response: { ok: boolean }) => void,
  ) => void;
  'fog:brush-points-erased': (sceneId: string, pointIds: string[]) => void;
  'fog:clear-brush': (sceneId: string) => void;

  // --- Cursor ---
  'cursor:move': (sceneId: string, x: number, y: number) => void;
  'cursor:ping': (sceneId: string, x: number, y: number) => void;
  'cursor:gm-ping': (sceneId: string, x: number, y: number) => void;
  'cursor:hide': () => void;

  // --- Выбор цели (общая для всех отметка над токеном) ---
  'target:set': (sceneId: string, tokenId: string | null) => void;
  'target:request-state': (sceneId: string) => void;

  // --- Трансляционные рамки ГМа (только ГМ; сервер гейтит по роли) ---
  'gm-broadcast:upsert': (frame: GmBroadcastFrameSync) => void;
  'gm-broadcast:remove': (frameId: string) => void;
  'gm-broadcast:request': () => void;

  // --- Playlist ---
  'playlist:create': (playlistData: Playlist) => void;
  'playlist:update': (playlistData: Playlist) => void;
  'playlist:delete': (playlistId: string) => void;

  // --- Chat ---
  'chat:send': (
    worldId: string,
    messageData: Omit<ChatMessage, 'id' | 'timestamp'> & { id?: string },
  ) => void;
  'chat:request-history': (worldId: string) => void;
  'chat:clear': (worldId: string) => void;
  'chat:delete-message': (worldId: string, messageId: string) => void;

  // --- Journal ---
  'journal:create': (
    worldId: string,
    noteData: import('./types/index.js').NoteCreateInput,
  ) => void;
  /**
   * Сохранение журнала целиком: набор страниц заменяет прежний (страницы,
   * которых нет в списке, удаляются). Так модалка редактирования отправляет
   * ровно то, что видит пользователь, одним снимком — без гонки между
   * добавлением страницы, её правкой и сортировкой.
   */
  'journal:update': (
    worldId: string,
    noteData: import('./types/index.js').NoteUpdateInput,
  ) => void;
  'journal:delete': (worldId: string, noteId: string) => void;
  'journal:request-list': (worldId: string) => void;
  'journal:show-note': (
    worldId: string,
    noteId: string,
    targetUserIds: string[] | 'all',
  ) => void;
  'journal:pin-note': (
    worldId: string,
    pinData: { noteId: string; sceneId: string; x: number; y: number },
  ) => void;
  'journal:unpin-note': (worldId: string, pinId: string) => void;
  'journal:request-pins': (worldId: string, sceneId: string) => void;
  'journal:move-pin': (
    worldId: string,
    pinId: string,
    position: { x: number; y: number },
  ) => void;
  'journal:request-note': (worldId: string, noteId: string) => void;
  // Journal Folders (Client → Server)
  'journal:folder-create': (
    worldId: string,
    folderData: { name: string; parentId: string | null; isHidden: boolean },
  ) => void;
  'journal:folder-update': (
    worldId: string,
    folderData: Pick<
      import('./types/index.js').JournalFolder,
      'id' | 'name' | 'isHidden'
    >,
  ) => void;
  'journal:folder-delete': (worldId: string, folderId: string) => void;
  'journal:folder-move': (
    worldId: string,
    folderId: string,
    newParentId: string | null,
  ) => void;
  'journal:note-move': (
    worldId: string,
    noteId: string,
    folderId: string | null,
  ) => void;
  'journal:reorder': (
    worldId: string,
    items: import('./types/index.js').JournalReorderItem[],
  ) => void;
  'journal:request-folders': (worldId: string) => void;
  // Граф приключения (Client → Server).
  // Все мутации — только админ (withAdmin); graph:request — любой
  // аутентифицированный, но игроку сервер отвечает только по графу
  // с visibility !== 'hidden' и отдаёт отфильтрованный снапшот.
  'graph:request': (sceneId: string) => void;
  /** Сервер форсит revealed=false при создании — узлы рождаются скрытыми */
  'graph:node-create': (node: GraphNode) => void;
  /** Полный объект узла (не патч) — см. graph:node-updated */
  'graph:node-update': (node: GraphNode) => void;
  /** Каскадно удаляет инцидентные рёбра */
  'graph:node-delete': (sceneId: string, nodeId: string) => void;
  /** Батч перемещений по окончании drag */
  'graph:node-move': (sceneId: string, moves: GraphNodeMove[]) => void;
  'graph:node-reveal': (
    sceneId: string,
    nodeId: string,
    revealed: boolean,
  ) => void;
  'graph:edge-create': (edge: GraphEdge) => void;
  'graph:edge-update': (edge: GraphEdge) => void;
  'graph:edge-delete': (sceneId: string, edgeId: string) => void;
  'graph:edge-reveal': (
    sceneId: string,
    edgeId: string,
    revealed: boolean,
  ) => void;
  // Папки сущностей: актёры и существа (Client → Server)
  'entity-folder:request-list': (
    worldId: string,
    kind: import('./types/index.js').EntityFolderKind,
  ) => void;
  'entity-folder:create': (
    worldId: string,
    kind: import('./types/index.js').EntityFolderKind,
    folderData: { name: string; parentId: string | null; isHidden: boolean },
  ) => void;
  'entity-folder:update': (
    worldId: string,
    kind: import('./types/index.js').EntityFolderKind,
    folderData: Pick<
      import('./types/index.js').EntityFolder,
      'id' | 'name' | 'isHidden'
    >,
  ) => void;
  'entity-folder:delete': (
    worldId: string,
    kind: import('./types/index.js').EntityFolderKind,
    folderId: string,
  ) => void;
  'entity-folder:move': (
    worldId: string,
    kind: import('./types/index.js').EntityFolderKind,
    folderId: string,
    newParentId: string | null,
  ) => void;
  'entity-folder:move-entities': (
    worldId: string,
    kind: import('./types/index.js').EntityFolderKind,
    entityIds: string[],
    folderId: string | null,
  ) => void;
  'entity-folder:reorder': (
    worldId: string,
    kind: import('./types/index.js').EntityFolderKind,
    items: import('./types/index.js').FolderReorderItem[],
  ) => void;
  // Initiative / Encounter
  'initiative:start-encounter': () => void;
  'initiative:add-entries': (actorIds: string[]) => void;
  /**
   * Результат броска инициативы участника.
   *
   * `announced` — о броске уже написала в чат система (её окно броска ведёт
   * свою запись: формула, преимущество/помеха, выбранная видимость). Сервер
   * тогда своё сообщение не дублирует; без флага пишет как раньше.
   */
  'initiative:roll': (
    actorId: string,
    roll: number,
    modifier: number,
    announced?: boolean,
  ) => void;
  'initiative:next-turn': () => void;
  'initiative:prev-turn': () => void;
  'initiative:end-encounter': () => void;
  'initiative:resume-encounter': () => void;
  'initiative:remove-entry': (actorId: string) => void;
  'initiative:set-manual': (actorId: string, total: number) => void;
  'initiative:select-encounter': (encounterId: string) => void;
  'initiative:delete-encounter': (encounterId: string) => void;
  /**
   * Показать бой полосой инициативы на сцене (`sceneId = null` — убрать).
   * На одной сцене показывается не больше одного боя.
   */
  'initiative:set-display-scene': (
    encounterId: string,
    sceneId: string | null,
  ) => void;
  'initiative:request-state': () => void;
  // Sound effects
  'sound:play-effect': (soundUrl: string) => void;
  // Audio control
  'audio:mute-all': (muted: boolean) => void;
  // Compendium
  'compendium:request-manifest': () => void;
  'compendium:request-data': (dataFile: string) => void;
  /**
   * Запросить агрегированные по каноническому типу записи всех паков
   * (ответ — `compendium:kind-data`). `dataKind`: `spell`/`creature`/`class`/… .
   */
  'compendium:request-kind': (dataKind: string) => void;
  /**
   * Запросить индекс страниц-источников всех паков (ответ — `compendium:src-index`).
   * Клиент шлёт его один раз за сессию и перезапрашивает по `compendium:updated`.
   */
  'compendium:request-src-index': () => void;
  // System data
  'system:request-weapon-properties': () => void;
  'system:request-weapon-base-types': () => void;
  'system:request-damage-types': () => void;
  'system:request-weapon-categories': () => void;
  'system:request-ammunition-types': () => void;
  'system:request-sources': () => void;
  'system:request-equipment-categories': () => void;
  'system:request-equipment-properties': () => void;
  'system:request-armor-base-types': () => void;
  'system:request-tool-properties': () => void;
  /** Запрос всех справочных данных одним пакетом */
  'system:request-all': () => void;
  // Items (пользовательские предметы)
  'items:create': (
    item: Omit<BaseGameItem, 'id' | 'source' | 'isReadOnly'>,
  ) => void;
  'items:update': (item: BaseGameItem) => void;
  'items:delete': (itemId: string) => void;
  'items:request': () => void;
  'items:copy-from-compendium': (itemId: string) => void;

  // --- Module Settings ---
  'module:settings-get': (
    moduleId: string,
    key: string,
    callback: (result: {
      success: boolean;
      value?: unknown;
      error?: string;
    }) => void,
  ) => void;
  'module:settings-set': (
    moduleId: string,
    key: string,
    value: unknown,
    callback: (result: { success: boolean; error?: string }) => void,
  ) => void;
  'module:settings-delete': (
    moduleId: string,
    key: string,
    callback: (result: { success: boolean; error?: string }) => void,
  ) => void;
  'module:settings-get-all': (
    moduleId: string,
    callback: (result: {
      success: boolean;
      value?: Record<string, unknown>;
      error?: string;
    }) => void,
  ) => void;
  'module:request-client-manifests': (
    callback: (manifests: ClientModuleManifest[]) => void,
  ) => void;
  'module:custom-event': (
    moduleId: string,
    eventName: string,
    payload: unknown,
  ) => void;
  'module:set-enabled': (
    moduleId: string,
    enabled: boolean,
    callback: (result: { success: boolean; error?: string }) => void,
  ) => void;
  'module:get-enabled-list': (
    callback: (result: Record<string, boolean>) => void,
  ) => void;
  /**
   * Перезапустить сервер мира «по-настоящему» (пересоздать процесс: модули,
   * система и компендиум загружаются с нуля). Используется для применения
   * вкл/выкл модулей. Только админ.
   */
  'module:restart-world': (
    callback: (result: { success: boolean; error?: string }) => void,
  ) => void;
}

/**
 * Типизированные данные, привязанные к WebSocket-клиенту на сервере.
 */
export interface SocketData {
  userId?: string;
  username?: string;
  /** ID сцены, которую клиент сейчас просматривает (для scoped broadcast) */
  currentSceneId?: string;
}
