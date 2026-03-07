import { Effect } from "effect";
import type { ProviderAdapterShape } from "./adapter.js";
import type { ProviderKind, AdapterError } from "./types.js";
import { ValidationError } from "./types.js";

export class ProviderAdapterRegistry {
  private adapters = new Map<ProviderKind, ProviderAdapterShape>();

  register(adapter: ProviderAdapterShape): void {
    this.adapters.set(adapter.provider, adapter);
  }

  get(provider: ProviderKind): Effect.Effect<ProviderAdapterShape, AdapterError> {
    const self = this;
    return Effect.gen(function* () {
      const adapter = self.adapters.get(provider);
      if (!adapter) {
        return yield* Effect.fail(
          new ValidationError({
            message: `No adapter registered for provider: ${provider}`,
            field: "provider",
          })
        );
      }
      return adapter;
    });
  }

  list(): ProviderKind[] {
    return Array.from(this.adapters.keys());
  }

  capabilities(provider: ProviderKind) {
    return this.adapters.get(provider)?.capabilities;
  }
}
