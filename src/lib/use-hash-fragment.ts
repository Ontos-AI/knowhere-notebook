"use client";

import { useCallback, useEffect, useState } from "react";

const CHUNK_PREFIX = "#chunk-";

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
