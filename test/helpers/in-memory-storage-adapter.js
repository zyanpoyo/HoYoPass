function cloneValue(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createAreaHandle({
  map,
  areaName,
  emitChanged,
  isAvailableFn = () => true,
  getWriteErrorFn = () => null,
  getHookFn = () => null,
  getBytesInUseFn = null
}) {
  async function get(keys) {
    if (!isAvailableFn()) {
      return {};
    }
    const hook = getHookFn();
    if (hook) {
      await hook(keys);
    }

    const res = {};
    if (keys === undefined || keys === null) {
      for (const [k, v] of map.entries()) {
        res[k] = cloneValue(v);
      }
      return res;
    }

    if (typeof keys === 'string') {
      if (map.has(keys)) {
        res[keys] = cloneValue(map.get(keys));
      }
      return res;
    }

    if (Array.isArray(keys)) {
      for (const k of keys) {
        if (map.has(k)) {
          res[k] = cloneValue(map.get(k));
        }
      }
      return res;
    }

    if (typeof keys === 'object') {
      for (const [k, defaultVal] of Object.entries(keys)) {
        res[k] = map.has(k) ? cloneValue(map.get(k)) : cloneValue(defaultVal);
      }
      return res;
    }

    return res;
  }

  async function set(items) {
    if (!isAvailableFn() || !items || typeof items !== 'object') {
      return;
    }
    const writeErr = getWriteErrorFn(items);
    if (writeErr) {
      throw writeErr;
    }

    const changes = {};
    let hasChanges = false;
    for (const [k, v] of Object.entries(items)) {
      const hadPrev = map.has(k);
      const oldValue = hadPrev ? cloneValue(map.get(k)) : undefined;
      const newValue = cloneValue(v);
      map.set(k, cloneValue(v));
      changes[k] = hadPrev ? { oldValue, newValue } : { newValue };
      hasChanges = true;
    }
    if (hasChanges) {
      emitChanged(changes, areaName);
    }
  }

  async function remove(keys) {
    if (!isAvailableFn() || keys === undefined || keys === null) {
      return;
    }
    const keyList = Array.isArray(keys) ? keys : [keys];
    const changes = {};
    let hasChanges = false;
    for (const k of keyList) {
      if (map.has(k)) {
        const oldValue = cloneValue(map.get(k));
        map.delete(k);
        changes[k] = { oldValue };
        hasChanges = true;
      }
    }
    if (hasChanges) {
      emitChanged(changes, areaName);
    }
  }

  const handle = {
    isAvailable: isAvailableFn,
    get,
    set,
    remove
  };

  if (getBytesInUseFn) {
    handle.getBytesInUse = getBytesInUseFn;
  }

  return handle;
}

/**
 * Chrome Storage API（local / session / onChanged）仕様に厳密準拠した共通 In-Memory ストレージアダプター。
 */
export function createInMemoryStorageAdapter(options = {}) {
  const localMap = new Map();
  const sessionMap = new Map();
  const changeListeners = new Set();

  let sessionAvailable = options.sessionAvailable ?? true;
  let bytesInUseOverride = options.bytesInUse ?? null;
  let localWriteError = null;
  let localWriteErrorPredicate = null;
  let sessionGetHook = null;

  function emitChanged(changes, areaName) {
    for (const listener of [...changeListeners]) {
      listener(cloneValue(changes), areaName);
    }
  }

  const local = createAreaHandle({
    map: localMap,
    areaName: 'local',
    emitChanged,
    getWriteErrorFn: (items) => {
      if (!localWriteError) return null;
      if (!localWriteErrorPredicate || localWriteErrorPredicate(items)) {
        return localWriteError;
      }
      return null;
    },
    getBytesInUseFn: async () => {
      if (typeof bytesInUseOverride === 'number') {
        return bytesInUseOverride;
      }
      let total = 0;
      for (const [k, v] of localMap.entries()) {
        total += Buffer.byteLength(k + JSON.stringify(v ?? null), 'utf8');
      }
      return total;
    }
  });

  const session = createAreaHandle({
    map: sessionMap,
    areaName: 'session',
    emitChanged,
    isAvailableFn: () => sessionAvailable,
    getHookFn: () => sessionGetHook
  });

  const onChanged = {
    addListener(listener) {
      if (typeof listener === 'function') {
        changeListeners.add(listener);
      }
    },
    removeListener(listener) {
      changeListeners.delete(listener);
    }
  };

  if (options.initialLocal && typeof options.initialLocal === 'object') {
    for (const [k, v] of Object.entries(options.initialLocal)) {
      localMap.set(k, cloneValue(v));
    }
  }
  if (options.initialSession && typeof options.initialSession === 'object') {
    for (const [k, v] of Object.entries(options.initialSession)) {
      sessionMap.set(k, cloneValue(v));
    }
  }

  return {
    local,
    session,
    onChanged,

    // --- テスト制御・観測用ヘルパー ---
    seedLocal(items) {
      if (!items || typeof items !== 'object') return;
      for (const [k, v] of Object.entries(items)) {
        localMap.set(k, cloneValue(v));
      }
    },
    peekLocal(key) {
      return cloneValue(localMap.get(key));
    },
    deleteLocal(key) {
      localMap.delete(key);
    },
    clearLocal() {
      localMap.clear();
    },
    seedSession(items) {
      if (!items || typeof items !== 'object') return;
      for (const [k, v] of Object.entries(items)) {
        sessionMap.set(k, cloneValue(v));
      }
    },
    peekSession(key) {
      return cloneValue(sessionMap.get(key));
    },
    deleteSession(key) {
      sessionMap.delete(key);
    },
    clearSession() {
      sessionMap.clear();
    },
    setBytesInUse(bytesOrNull) {
      bytesInUseOverride = bytesOrNull;
    },
    setSessionAvailable(flag) {
      sessionAvailable = Boolean(flag);
    },
    setLocalWriteError(errOrNull, predicateOrNull = null) {
      localWriteError = errOrNull;
      localWriteErrorPredicate = predicateOrNull;
    },
    setSessionGetHook(fnOrNull) {
      sessionGetHook = fnOrNull;
    }
  };
}
