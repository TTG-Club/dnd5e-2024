/**
 * Типы «Графа приключения» — визуальной карты кампании (узлы, связи).
 *
 * Граф — псевдо-сцена: строка в scenes.db с `kind='graph'` даёт ему вкладку,
 * место в дереве папок, гейтинг видимости и «Перенести сюда игроков». Сам же
 * контент (узлы/рёбра) живёт в отдельной graphs.db и синхронизируется своими
 * `graph:*` событиями с СЕРВЕРНОЙ фильтрацией по `revealed`.
 *
 * ИНВАРИАНТ: контент графа никогда не кладётся в объект `Scene` — иначе он
 * утёк бы игрокам нефильтрованным через `scene:resync`/`scene:created`.
 *
 * @module shared/types/graph
 */

/** Виды сущностей мира, на которые может ссылаться узел графа */
export type GraphEntityRefKind =
  | 'actor'
  | 'creature'
  | 'item'
  | 'scene'
  | 'note';

/**
 * Ссылка узла на сущность мира. Ядро резолвит только системо-агностичные
 * поля (имя, портрет: `avatar ?? token.imageUrl`); `entity.system` не трогать.
 */
export interface GraphEntityRef {
  /** Вид сущности */
  kind: GraphEntityRefKind;
  /** ID сущности */
  id: string;
}

/** Узел графа приключения */
export interface GraphNode {
  /** Уникальный идентификатор (`gnode_...`) */
  id: string;
  /** ID псевдо-сцены графа (строка в scenes.db с kind='graph') */
  sceneId: string;
  /**
   * Тип узла: встроенные ('scene' | 'actor' | 'creature' | 'event' | 'text' |
   * 'branch' | ...) либо зарегистрированный игровой системой. Открытая строка —
   * ядро не делает exhaustive switch; незнакомый тип рендерится плейсхолдером.
   */
  type: string;
  /** Позиция на канвасе (мировые координаты Vue Flow) */
  x: number;
  /** Позиция на канвасе (мировые координаты Vue Flow) */
  y: number;
  /** Ширина узла; null — авторазмер */
  w: number | null;
  /** Высота узла; null — авторазмер */
  h: number | null;
  /** Заголовок узла */
  title: string;
  /** Текст, видимый игрокам после раскрытия узла */
  playerText: string;
  /**
   * Заметки мастера. Игрокам НИКОГДА не отправляются: сервер вырезает поле
   * (stripGraphNodeGmFields) из любого payload не-админам.
   */
  gmNotes?: string;
  /** Ссылка на сущность мира; null — узел без ссылки */
  ref: GraphEntityRef | null;
  /** Переопределение картинки узла (путь к ассету); null — по ref/типу */
  image: string | null;
  /**
   * Переопределение значка узла (`tabler:*` из локальной коллекции);
   * null — берётся значок типа узла.
   */
  icon: string | null;
  /** Цвет акцента узла (hex); null — цвет типа по умолчанию */
  color: string | null;
  /** Раскрыт ли узел игрокам. Новые узлы создаются скрытыми */
  revealed: boolean;
  /** ID родительского узла-группы; null — узел верхнего уровня */
  parentId: string | null;
  /**
   * Метки узла для поиска по графу («интрига», «зацепка», «побочка»).
   * Хранятся как есть; сравнение и подсказки — без учёта регистра.
   */
  tags: string[];
  /** Порядок наложения/сортировки среди соседей */
  sortOrder: number;
  /** Системо-специфичный payload (для типов узлов внешних систем) */
  data: Record<string, unknown>;
  /** Время создания (epoch ms) */
  createdAt: number;
  /** Время последнего изменения (epoch ms) */
  updatedAt: number;
}

/**
 * Геометрия связи — как линия идёт от узла к узлу.
 * Разные виды отношений удобно различать формой: причинно-следственная —
 * плавной кривой, жёсткая последовательность — ортогональной ступенькой.
 */
export type GraphEdgeShape = 'bezier' | 'straight' | 'smoothstep' | 'step';

/** Начертание линии связи */
export type GraphEdgeLine = 'solid' | 'dashed' | 'dotted' | 'wavy';

/** Стиль отображения связи */
export interface GraphEdgeStyle {
  /** Геометрия линии; по умолчанию 'bezier' */
  shape?: GraphEdgeShape;
  /** Начертание; по умолчанию 'solid' */
  line?: GraphEdgeLine;
  /** Цвет линии (hex) */
  color?: string;
  /** Толщина линии в пикселях; по умолчанию 2 */
  width?: number;
  /**
   * Значок посреди линии (`tabler:*` из локальной коллекции) — обозначает
   * характер связи: бой, торговля, тайна и т.п.
   */
  icon?: string;
  /**
   * Анимация движения по линии. Недоступна для 'solid': сплошную линию
   * двигать нечем — анимировать можно только рисунок штрихов или фазу волны.
   */
  animated?: boolean;
}

/** Связь (ребро) графа приключения */
export interface GraphEdge {
  /** Уникальный идентификатор (`gedge_...`) */
  id: string;
  /** ID псевдо-сцены графа */
  sceneId: string;
  /** ID узла-источника */
  sourceId: string;
  /** ID узла-цели */
  targetId: string;
  /** Хэндл источника Vue Flow; null — дефолтный */
  sourceHandle: string | null;
  /** Хэндл цели Vue Flow; null — дефолтный */
  targetHandle: string | null;
  /** Подпись связи (видна игрокам вместе со связью) */
  label: string;
  /** Стиль отображения; null — стиль по умолчанию */
  style: GraphEdgeStyle | null;
  /**
   * Раскрыта ли связь игрокам. Игрок видит связь только если раскрыта
   * И она сама, И оба её конца-узла.
   */
  revealed: boolean;
  /** Системо-специфичный payload */
  data: Record<string, unknown>;
  /** Время создания (epoch ms) */
  createdAt: number;
  /** Время последнего изменения (epoch ms) */
  updatedAt: number;
}

/** Перемещение одного узла (батч-драг) */
export interface GraphNodeMove {
  /** ID узла */
  id: string;
  /** Новая позиция X */
  x: number;
  /** Новая позиция Y */
  y: number;
}
