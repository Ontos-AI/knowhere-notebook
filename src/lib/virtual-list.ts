export type VirtualListItem = {
  index: number;
  top: number;
  height: number;
};

export type VirtualListState = {
  totalHeight: number;
  items: VirtualListItem[];
};

export type VirtualListInput = {
  itemCount: number;
  scrollTop: number;
  viewportHeight: number;
  estimatedItemHeight: number;
  overscan: number;
  measuredHeights: ReadonlyMap<number, number>;
};

export type ItemOffsetInput = {
  index: number;
  estimatedItemHeight: number;
  measuredHeights: ReadonlyMap<number, number>;
};

export type BottomScrollInput = {
  itemCount: number;
  viewportHeight: number;
  estimatedItemHeight: number;
  measuredHeights: ReadonlyMap<number, number>;
};

function getPositiveHeight(height: number, fallbackHeight: number): number {
  return height > 0 ? height : fallbackHeight;
}

function getMeasuredHeight(
  measuredHeights: ReadonlyMap<number, number>,
  index: number,
  estimatedItemHeight: number
): number {
  return getPositiveHeight(
    measuredHeights.get(index) ?? estimatedItemHeight,
    estimatedItemHeight
  );
}

export function getItemOffset({
  index,
  estimatedItemHeight,
  measuredHeights,
}: ItemOffsetInput): number {
  let offset = 0;

  for (let i = 0; i < index; i += 1) {
    offset += getMeasuredHeight(measuredHeights, i, estimatedItemHeight);
  }

  return offset;
}

export function getBottomScrollTop({
  itemCount,
  viewportHeight,
  estimatedItemHeight,
  measuredHeights,
}: BottomScrollInput): number {
  const state = getVirtualListState({
    itemCount,
    scrollTop: 0,
    viewportHeight,
    estimatedItemHeight,
    overscan: 0,
    measuredHeights,
  });

  return Math.max(0, state.totalHeight - viewportHeight);
}

export function getVirtualListState({
  itemCount,
  scrollTop,
  viewportHeight,
  estimatedItemHeight,
  overscan,
  measuredHeights,
}: VirtualListInput): VirtualListState {
  const safeItemCount = Math.max(0, itemCount);
  const safeEstimatedItemHeight = getPositiveHeight(estimatedItemHeight, 1);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const safeScrollTop = Math.max(0, scrollTop);
  const safeOverscan = Math.max(0, overscan);

  let totalHeight = 0;
  let startIndex = 0;
  let endIndex = safeItemCount - 1;
  let hasFoundStart = false;
  let hasFoundEnd = false;
  const offsets: number[] = [];
  const heights: number[] = [];
  const viewportBottom = safeScrollTop + safeViewportHeight;

  for (let index = 0; index < safeItemCount; index += 1) {
    const height = getMeasuredHeight(
      measuredHeights,
      index,
      safeEstimatedItemHeight
    );
    const top = totalHeight;
    const bottom = top + height;

    offsets.push(top);
    heights.push(height);

    if (!hasFoundStart && bottom > safeScrollTop) {
      startIndex = Math.max(0, index - safeOverscan);
      hasFoundStart = true;
    }

    if (!hasFoundEnd && top >= viewportBottom) {
      endIndex = Math.min(safeItemCount - 1, index + safeOverscan);
      hasFoundEnd = true;
    }

    totalHeight = bottom;
  }

  if (!hasFoundStart) {
    startIndex = Math.max(0, safeItemCount - 1 - safeOverscan);
  }

  const items: VirtualListItem[] = [];

  for (let index = startIndex; index <= endIndex; index += 1) {
    items.push({
      index,
      top: offsets[index] ?? 0,
      height: heights[index] ?? safeEstimatedItemHeight,
    });
  }

  return {
    totalHeight,
    items,
  };
}
