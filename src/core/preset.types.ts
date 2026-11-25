import type { Provider, Type } from '@nestjs/common';
import type { KeyExtractor } from './failures/key-source';

/**
 * A preset is a partner this package was told about: a set of routes and the
 * fixture data behind them. It is data plus, at most, a thin controller.
 *
 * The seam is the point. A team mounts its own preset without editing `core/`; if
 * adding a route required a change to core, core would know too much.
 *
 * This package ships no presets. Remote's CDH and GrabFood routes stay where they
 * are, in Remote.
 */
export interface StubPreset {
  /** Shown at startup, so an operator can see what the container was told to serve. */
  readonly name: string;
  /**
   * NestJS controllers that serve the partner's routes. A controller may answer from
   * fixtures, call the failure store, or do whatever the partner's shape requires.
   */
  readonly controllers?: readonly Type<unknown>[];
  /** Whatever those controllers need: fixture services, config readers, clocks. */
  readonly providers?: readonly Provider[];
  /**
   * Where this partner's failure key lives: a body field, a query parameter, a path
   * segment. Only the preset knows, because only the preset knows what its partner
   * sends.
   *
   * Presets are asked in the order they are mounted, then the generic readers, then
   * the legacy `merchantID` alias.
   */
  readonly keyOf?: KeyExtractor;
}

/** Convenience wrapper that keeps the object literal checked against the interface. */
export function definePreset(preset: StubPreset): StubPreset {
  return preset;
}
