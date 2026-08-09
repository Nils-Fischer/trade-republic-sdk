import { resolveEnvironment, type Environment, type ResolvedEnvironment } from "./environment.ts";

/** The complete client for Trade Republic Topics and HTTP resources. */
export class TRClient {
  protected readonly environment: ResolvedEnvironment;

  constructor(environment: Environment = {}) {
    this.environment = resolveEnvironment(environment);
  }
}
