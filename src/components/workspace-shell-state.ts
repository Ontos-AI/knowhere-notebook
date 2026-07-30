const desktopPanelGutterWidth = 8
const collapsedDesktopPanelWidth = 72
const desktopSidePanelCompactThreshold = 120

const minimumDesktopPanelWidths = {
  sources: collapsedDesktopPanelWidth,
  chat: collapsedDesktopPanelWidth,
} as const

const defaultDesktopPanelWidths = {
  sources: 350,
  chat: 800,
} as const

type DesktopPanelKey = keyof typeof minimumDesktopPanelWidths

type DesktopPanelWidths = Record<DesktopPanelKey, number>
type DesktopSidePanelKey = DesktopPanelKey

const desktopPanelKeys = ["sources", "chat"] as const

type DesktopPanelResizeInput = {
  readonly leftPanel: DesktopPanelKey
  readonly rightPanel: DesktopPanelKey
  readonly deltaX: number
  readonly leftWidth: number
  readonly rightWidth: number
}

type WorkspaceShellStateModule = {
  readonly desktopPanelGutterWidth: number
  readonly collapsedDesktopPanelWidth: number
  readonly desktopSidePanelCompactThreshold: number
  readonly minimumDesktopPanelWidths: typeof minimumDesktopPanelWidths
  readonly defaultDesktopPanelWidths: typeof defaultDesktopPanelWidths
  readonly getMinimumDesktopPanelWidth: (
    currentWidths?: Readonly<DesktopPanelWidths>,
  ) => number
  readonly fitDesktopPanelWidthsToContainer: (
    containerWidth: number,
    currentWidths?: Readonly<DesktopPanelWidths>,
  ) => DesktopPanelWidths
  readonly expandDesktopPanelWidth: (
    currentWidths: Readonly<DesktopPanelWidths>,
    panel: DesktopSidePanelKey,
  ) => DesktopPanelWidths
  readonly resizeDesktopPanelWidths: (
    currentWidths: Readonly<DesktopPanelWidths>,
    resize: DesktopPanelResizeInput,
  ) => DesktopPanelWidths
}

function getMinimumDesktopPanelWidth(
  currentWidths: Readonly<DesktopPanelWidths> = defaultDesktopPanelWidths,
): number {
  return (
    getMinimumDesktopPanelContentWidth(currentWidths) +
    getVisibleDesktopPanelGutterCount(currentWidths) * desktopPanelGutterWidth
  )
}

function getDefaultDesktopPanelContentWidth(
  currentWidths: Readonly<DesktopPanelWidths>,
): number {
  return getVisibleDesktopPanelKeys(currentWidths).reduce(
    (totalWidth, panel) =>
      totalWidth + getDefaultDesktopPanelWidth(panel, currentWidths),
    0,
  )
}

function getMinimumDesktopPanelContentWidth(
  currentWidths: Readonly<DesktopPanelWidths>,
): number {
  return getVisibleDesktopPanelKeys(currentWidths).reduce(
    (totalWidth, panel) =>
      totalWidth + getMinimumDesktopPanelWidthForPanel(panel, currentWidths),
    0,
  )
}

function fitDesktopPanelWidthsToContainer(
  containerWidth: number,
  currentWidths: Readonly<DesktopPanelWidths> = defaultDesktopPanelWidths,
): DesktopPanelWidths {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return getDefaultDesktopPanelWidths(currentWidths)
  }

  const visiblePanels = getVisibleDesktopPanelKeys(currentWidths)
  const availableContentWidth =
    containerWidth -
    getVisibleDesktopPanelGutterCount(currentWidths) * desktopPanelGutterWidth
  const defaultContentWidth = getDefaultDesktopPanelContentWidth(currentWidths)
  if (availableContentWidth >= defaultContentWidth) {
    return getDefaultDesktopPanelWidths(currentWidths)
  }

  const minimumContentWidth = getMinimumDesktopPanelContentWidth(currentWidths)
  if (availableContentWidth <= minimumContentWidth) {
    return getMinimumDesktopPanelWidths(currentWidths)
  }

  const defaultExtraWidth = defaultContentWidth - minimumContentWidth
  const availableExtraWidth = availableContentWidth - minimumContentWidth
  const fittedWidths = getMinimumDesktopPanelWidths(currentWidths)
  const flexiblePanels = visiblePanels.filter(
    (panel) =>
      getDefaultDesktopPanelWidth(panel, currentWidths) >
      getMinimumDesktopPanelWidthForPanel(panel, currentWidths),
  )
  let assignedWidth = 0

  for (const [index, panel] of flexiblePanels.entries()) {
    const isLastPanel = index === flexiblePanels.length - 1
    if (isLastPanel) {
      fittedWidths[panel] =
        getMinimumDesktopPanelWidthForPanel(panel, currentWidths) +
        availableExtraWidth -
        assignedWidth
      break
    }

    const panelExtraWidth =
      getDefaultDesktopPanelWidth(panel, currentWidths) -
      getMinimumDesktopPanelWidthForPanel(panel, currentWidths)
    const fittedWidth = Math.round(
      getMinimumDesktopPanelWidthForPanel(panel, currentWidths) +
        (panelExtraWidth / defaultExtraWidth) * availableExtraWidth,
    )
    fittedWidths[panel] = fittedWidth
    assignedWidth +=
      fittedWidth - getMinimumDesktopPanelWidthForPanel(panel, currentWidths)
  }

  return fittedWidths
}

function resizeDesktopPanelWidths(
  currentWidths: Readonly<DesktopPanelWidths>,
  resize: DesktopPanelResizeInput,
): DesktopPanelWidths {
  const totalWidth = resize.leftWidth + resize.rightWidth
  const leftMinimumWidth = minimumDesktopPanelWidths[resize.leftPanel]
  const rightMinimumWidth = minimumDesktopPanelWidths[resize.rightPanel]
  const leftWidth = clamp(
    resize.leftWidth + resize.deltaX,
    leftMinimumWidth,
    totalWidth - rightMinimumWidth,
  )

  return {
    ...currentWidths,
    [resize.leftPanel]: leftWidth,
    [resize.rightPanel]: totalWidth - leftWidth,
  }
}

function expandDesktopPanelWidth(
  currentWidths: Readonly<DesktopPanelWidths>,
  panel: DesktopSidePanelKey,
): DesktopPanelWidths {
  const totalWidth = currentWidths.sources + currentWidths.chat
  const expandedWidth = getExpandedSidePanelWidth(panel, totalWidth)
  const otherPanel = panel === "sources" ? "chat" : "sources"

  return {
    ...currentWidths,
    [panel]: expandedWidth,
    [otherPanel]: Math.max(
      minimumDesktopPanelWidths[otherPanel],
      totalWidth - expandedWidth,
    ),
  }
}

function getExpandedSidePanelWidth(
  panel: DesktopSidePanelKey,
  totalWidth: number,
): number {
  const preferredWidth = defaultDesktopPanelWidths[panel]
  const minimumWidth = minimumDesktopPanelWidths[panel]
  const otherMinimum =
    minimumDesktopPanelWidths[panel === "sources" ? "chat" : "sources"]
  const maximumSideWidth = totalWidth - otherMinimum

  if (maximumSideWidth >= preferredWidth) return preferredWidth
  if (maximumSideWidth >= minimumWidth) return maximumSideWidth
  return minimumWidth
}

function getVisibleDesktopPanelKeys(
  currentWidths: Readonly<DesktopPanelWidths>,
): DesktopPanelKey[] {
  return desktopPanelKeys.filter((panel) => currentWidths[panel] > 0)
}

function getVisibleDesktopPanelGutterCount(
  currentWidths: Readonly<DesktopPanelWidths>,
): number {
  return Math.max(0, getVisibleDesktopPanelKeys(currentWidths).length - 1)
}

function getDefaultDesktopPanelWidths(
  currentWidths: Readonly<DesktopPanelWidths>,
): DesktopPanelWidths {
  return getDesktopPanelWidthsForVisibility(
    currentWidths,
    defaultDesktopPanelWidths,
  )
}

function getMinimumDesktopPanelWidths(
  currentWidths: Readonly<DesktopPanelWidths>,
): DesktopPanelWidths {
  return getDesktopPanelWidthsForVisibility(
    currentWidths,
    minimumDesktopPanelWidths,
  )
}

function getDesktopPanelWidthsForVisibility(
  currentWidths: Readonly<DesktopPanelWidths>,
  visibleWidths: Readonly<DesktopPanelWidths>,
): DesktopPanelWidths {
  return {
    sources: isDesktopPanelCollapsed(currentWidths, "sources")
      ? collapsedDesktopPanelWidth
      : visibleWidths.sources,
    chat: isDesktopPanelCollapsed(currentWidths, "chat")
      ? collapsedDesktopPanelWidth
      : visibleWidths.chat,
  }
}

function getDefaultDesktopPanelWidth(
  panel: DesktopPanelKey,
  currentWidths: Readonly<DesktopPanelWidths>,
): number {
  if (isDesktopPanelCollapsed(currentWidths, panel)) {
    return collapsedDesktopPanelWidth
  }

  return defaultDesktopPanelWidths[panel]
}

function getMinimumDesktopPanelWidthForPanel(
  panel: DesktopPanelKey,
  currentWidths: Readonly<DesktopPanelWidths>,
): number {
  if (isDesktopPanelCollapsed(currentWidths, panel)) {
    return collapsedDesktopPanelWidth
  }

  return minimumDesktopPanelWidths[panel]
}

function isDesktopPanelCollapsed(
  currentWidths: Readonly<DesktopPanelWidths>,
  panel: DesktopSidePanelKey,
): boolean {
  return (
    currentWidths[panel] > 0 &&
    currentWidths[panel] <= desktopSidePanelCompactThreshold
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export const workspaceShellState: WorkspaceShellStateModule = {
  desktopPanelGutterWidth,
  collapsedDesktopPanelWidth,
  desktopSidePanelCompactThreshold,
  minimumDesktopPanelWidths,
  defaultDesktopPanelWidths,
  getMinimumDesktopPanelWidth,
  fitDesktopPanelWidthsToContainer,
  expandDesktopPanelWidth,
  resizeDesktopPanelWidths,
}
