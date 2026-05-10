"use client";

import { useCallback, useEffect, useState } from "react";

const CHUNK_PREFIX = "#chunk-";

/**
 * Read and set a chunkId fragment in the URL hash.
 *
 * Reading: returns `null` when the hash is absent or doesn't start with
 * `#chunk-`.  Otherwise returns the substring after the prefix.
 *
 * Setting: `navigateToChunk(id)` writes `#chunk-{id}` to
 * `window.location.hash`.  The browser does NOT reload — hash changes
 * are SPA-native and don't trigger a server round-trip.
 *
 * Back/forward works automatically because `hashchange` events are
 * dispatched by the browser.
 */
export function useHashFragment(): [
  chunkId: string | null,
  navigateToChunk: (id: string | null) => void,
] {
  const [chunkId, setChunkId] = useState<string | null>(() =>
    readHash(window.location.hash),
  );

  useEffect(() => {
    function onHashChange() {
      setChunkId(readHash(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigateToChunk = useCallback((id: string | null) => {
    if (id) {
      window.location.hash = `${CHUNK_PREFIX}${id}`;
    } else {
      // Remove the hash without triggering a scroll to top
      history.replaceState(null, "", window.location.pathname + window.location.search);
      setChunkId(null);
    }
  }, []);

  return [chunkId, navigateToChunk];
}

function readHash(hash: string): string | null {
  if (hash.startsWith(CHUNK_PREFIX)) {
    return hash.slice(CHUNK_PREFIX.length);
  }
  return null;
}
