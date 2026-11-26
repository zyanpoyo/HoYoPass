/**
 * Chrome Extension の storage API へアクセスする本番用ストレージアダプター。
 * プロジェクト全体で唯一 chrome.storage を直接参照する。
 * Node.js テスト環境でのトップレベル import 時にエラーを出さないよう、API 参照は呼び出し時に遅延解決する。
 */
export function createChromeStorageAdapter(
  getChromeApi = () => (typeof chrome !== 'undefined' ? chrome : globalThis.chrome)
) {
  return {
    local: {
      isAvailable() {
        return Boolean(getChromeApi()?.storage?.local);
      },
      async get(keys) {
        const local = getChromeApi()?.storage?.local;
        if (!local) return {};
        return local.get(keys);
      },
      async set(items) {
        const local = getChromeApi()?.storage?.local;
        if (!local) return;
        await local.set(items);
      },
      async remove(keys) {
        const local = getChromeApi()?.storage?.local;
        if (local && typeof local.remove === 'function') {
          await local.remove(keys);
        }
      },
      async getBytesInUse() {
        const local = getChromeApi()?.storage?.local;
        if (local && typeof local.getBytesInUse === 'function') {
          return local.getBytesInUse();
        }
        return null;
      }
    },
    session: {
      isAvailable() {
        return Boolean(getChromeApi()?.storage?.session);
      },
      async get(keys) {
        const session = getChromeApi()?.storage?.session;
        if (!session) return {};
        return session.get(keys);
      },
      async set(items) {
        const session = getChromeApi()?.storage?.session;
        if (!session) return;
        await session.set(items);
      },
      async remove(keys) {
        const session = getChromeApi()?.storage?.session;
        if (!session) return;
        if (typeof session.remove === 'function') {
          await session.remove(keys);
        }
      }
    },
    onChanged: {
      addListener(listener) {
        getChromeApi()?.storage?.onChanged?.addListener?.(listener);
      },
      removeListener(listener) {
        getChromeApi()?.storage?.onChanged?.removeListener?.(listener);
      }
    }
  };
}
