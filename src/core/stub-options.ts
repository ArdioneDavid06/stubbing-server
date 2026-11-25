import type { KeyExtractor } from './failures/key-source';
import type { StubPreset } from './preset.types';

/**
 * The wiring a caller can change. Everything else is contract.
 */
export interface StubModuleOptions {
  /**
   * Partners this instance serves. Empty is the normal case: rules, the recorder and
   * failure injection need no knowledge of anyone's API.
   */
  presets?: readonly StubPreset[];
  /**
   * Replaces the generic failure-key readers. Use it when the key is not in
   * `x-stub-key`, `?key=` or `body.key`. Presets' own `keyOf` still runs first.
   */
  keyOf?: KeyExtractor;
  /**
   * Accept `merchantID` wherever a failure key is read. Defaults to `true` so a
   * collection written against the old stub keeps working unchanged; turn it off to
   * prove nothing depends on the old name.
   */
  acceptMerchantIdAlias?: boolean;
  /** How many rules may be installed at once. Defaults to 200. */
  maxRules?: number;
  /** How many requests the recorder keeps. Defaults to 500. */
  maxRecorded?: number;
}

/** What the services actually receive: options with every default applied. */
export interface ResolvedStubOptions {
  presets: readonly StubPreset[];
  keyOf: KeyExtractor;
  maxRules: number;
  maxRecorded: number;
}

export const STUB_OPTIONS = 'STUB_OPTIONS';

export const DEFAULT_MAX_RULES = 200;
export const DEFAULT_MAX_RECORDED = 500;

/** Longer than any test should wait, and short enough to fail rather than hang. */
export const MAX_DELAY_MS = 600_000;
