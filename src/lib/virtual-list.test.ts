import { describe, expect, test } from "vitest";
import {
  getBottomScrollTop,
  getItemOffset,
  getVirtualListState,
} from "./virtual-list";

describe("getVirtualListState", () => {
  test("renders only the visible chunk window with overscan", () => {
    const state = getVirtualListState({
      itemCount: 1_000,
      scrollTop: 4_800,
      viewportHeight: 600,
      estimatedItemHeight: 120,
      overscan: 2,
      measuredHeights: new Map(),
    });

    expect(state.totalHeight).toBe(120_000);
    expect(state.items[0]?.index).toBe(38);
    expect(state.items.at(-1)?.index).toBe(47);
    expect(state.items.length).toBeLessThan(20);
  });

  test("uses measured chunk heights for offsets and total height", () => {
    const measuredHeights = new Map<number, number>([
      [1, 200],
      [3, 60],
    ]);

    const state = getVirtualListState({
      itemCount: 5,
      scrollTop: 0,
      viewportHeight: 500,
      estimatedItemHeight: 100,
      overscan: 0,
      measuredHeights,
    });

    expect(state.totalHeight).toBe(560);
    expect(state.items.map((item) => item.top)).toEqual([0, 100, 300, 400, 460]);
    expect(
      getItemOffset({ index: 4, estimatedItemHeight: 100, measuredHeights })
    ).toBe(460);
  });

  test("calculates the bottom scroll position for long chat histories", () => {
    expect(
      getBottomScrollTop({
        itemCount: 500,
        viewportHeight: 720,
        estimatedItemHeight: 140,
        measuredHeights: new Map(),
      })
    ).toBe(69_280);
  });
});
