import type { FinanceApi } from '../../shared/types'

declare global {
  interface Window {
    financeBridge: { invoke(method: string, args: unknown[]): Promise<unknown> }
  }
}

export const api = new Proxy({} as FinanceApi, {
  get:
    (_target, method: string) =>
    async (...args: unknown[]) => {
      try {
        return await window.financeBridge.invoke(method, args)
      } catch (e) {
        throw new Error(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    }
})
