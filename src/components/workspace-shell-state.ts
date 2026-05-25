const desktopPanelGutterWidth = 8

const minimumDesktopPanelWidths = {
  sources: 260,
  chunks: 480,
  chat: 360,
} as const

const defaultDesktopPanelWidths = {
  sources: 350,
  chunks: 720,
  chat: 420,
} as const

type DesktopPanelKey = keyof typeof minimumDesktopPanelWidths

type DesktopPanelWidths = Record<DesktopPanelKey, number>

const desktopPanelKeys = ["sources", "chunks", "chat"] as const

type DesktopPanelResizeInput = {
  readonly leftPanel: DesktopPanelKey
  readonly rightPanel: DesktopPanelKey
  readonly deltaX: number
  readonly leftWidth: number
  readonly rightWidth: number
}

type WorkspaceShellStateModule = {
  readonly desktopPanelGutterWidth: number
  readonly minimumDesktopPanelWidths: typeof minimumDesktopPanelWidths
  readonly defaultDesktopPanelWidths: typeof defaultDesktopPanelWidths
  readonly getMinimumDesktopPanelWidth: () => number
  readonly fitDesktopPanelWidthsToContainer: (
    containerWidth: number,
  ) => DesktopPanelWidths
  readonly resizeDesktopPanelWidths: (
    currentWidths: Readonly<DesktopPanelWidths>,
    resize: DesktopPanelResizeInput,
  ) => DesktopPanelWidths
}

function getMinimumDesktopPanelWidth(): number {
  return (
    minimumDesktopPanelWidths.sources +
    minimumDesktopPanelWidths.chunks +
    minimumDesktopPanelWidths.chat +
    desktopPanelGutterWidth * 2
  )
}

function getDefaultDesktopPanelContentWidth(): number {
  return (
    defaultDesktopPanelWidths.sources +
    defaultDesktopPanelWidths.chunks +
    defaultDesktopPanelWidths.chat
  )
}

function getMinimumDesktopPanelContentWidth(): number {
  return (
    minimumDesktopPanelWidths.sources +
    minimumDesktopPanelWidths.chunks +
    minimumDesktopPanelWidths.chat
  )
}

function fitDesktopPanelWidthsToContainer(
  containerWidth: number,
): DesktopPanelWidths {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) {
    return { ...defaultDesktopPanelWidths }
  }

  const availableContentWidth = containerWidth - desktopPanelGutterWidth * 2
  const defaultContentWidth = getDefaultDesktopPanelContentWidth()
  if (availableContentWidth >= defaultContentWidth) {
    return { ...defaultDesktopPanelWidths }
  }

  const minimumContentWidth = getMinimumDesktopPanelContentWidth()
  if (availableContentWidth <= minimumContentWidth) {
    return { ...minimumDesktopPanelWidths }
  }

  const defaultExtraWidth = defaultContentWidth - minimumContentWidth
  const availableExtraWidth = availableContentWidth - minimumContentWidth
  const fittedWidths = {} as DesktopPanelWidths
  let assignedWidth = 0

  for (const [index, panel] of desktopPanelKeys.entries()) {
    const isLastPanel = index === desktopPanelKeys.length - 1
    if (isLastPanel) {
      fittedWidths[panel] = availableContentWidth - assignedWidth
      break
    }

    const panelExtraWidth =
      defaultDesktopPanelWidths[panel] - minimumDesktopPanelWidths[panel]
    const fittedWidth = Math.round(
      minimumDesktopPanelWidths[panel] +
        (panelExtraWidth / defaultExtraWidth) * availableExtraWidth,
    )
    fittedWidths[panel] = fittedWidth
    assignedWidth += fittedWidth
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export const workspaceShellState: WorkspaceShellStateModule = {
  desktopPanelGutterWidth,
  minimumDesktopPanelWidths,
  defaultDesktopPanelWidths,
  getMinimumDesktopPanelWidth,
  fitDesktopPanelWidthsToContainer,
  resizeDesktopPanelWidths,
}
