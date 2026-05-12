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
  resizeDesktopPanelWidths,
}
