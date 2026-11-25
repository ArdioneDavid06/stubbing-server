/**
 * The rule format. This is the contract: everything else in the package may move,
 * these shapes may not.
 *
 * Two shapes describe the same thing, and both must keep working, because a rule is a
 * document a team pastes into a wiki:
 *
 *   flat   { "method": "PUT", "path": "/v1/orders/42", "status": 409, "body": {} }
 *   long   { "request": { "method": "PUT", "path": "/v1/orders/42" },
 *            "response": { "status": 409, "body": {} } }
 *
 * The flat shape is what someone writes by hand. The long shape is where a rule
 * narrows on a query parameter, a header or a body field, because `body` at the top
 * level already means "the answer".
 */

/** A call a rule answers. Every field present must match; an omitted one matches anything. */
export interface RuleRequestMatch {
  /** `GET`, `POST`, … or `*`. Case-insensitive. Defaults to `*`. */
  method?: string;
  /**
   * The path to answer. Supports two placeholders so one rule can cover a family of
   * calls:
   *
   * - `:name` matches one segment: `/v2/customers/:id`
   * - `*` matches anything, including `/`: `/v2/*`
   *
   * A pattern with no placeholder is an exact path. A bare `*` answers everything.
   */
  path: string;
  /** Query parameters the caller must send. Values are compared as strings. */
  query?: Record<string, string>;
  /**
   * Headers the caller must send, by lower-case name. A value wrapped in slashes is
   * a regular expression: `"/^Bearer \\S+$/"`.
   */
  headers?: Record<string, string>;
  /** A subset of the JSON body: nested objects may omit fields, arrays do not. */
  body?: unknown;
}

/** What the stub answers when a rule matches. */
export interface RuleResponseSpec {
  /** HTTP status. Defaults to 200. */
  status?: number;
  /** Extra response headers, e.g. `{ "content-type": "application/xml" }`. */
  headers?: Record<string, string>;
  /**
   * The answer body. Objects and arrays are sent as JSON; a string is sent as
   * text/plain unless a content-type header says otherwise. Omit it for an empty
   * response.
   */
  body?: unknown;
  /** Milliseconds to stall before answering. Pair with a timeout test. */
  delayMs?: number;
}

/** Fields both shapes share. */
export interface RuleCommon {
  /** A label for the run, echoed back by `GET /stub/rules`. */
  name?: string;
  /**
   * Where this rule came from: the partner document, the page, or the ticket.
   *
   * A rule with no source is a guess wearing a test's clothes. Nothing enforces this,
   * because a day-one rule often has no citation yet; the honesty is the reader's.
   */
  description?: string;
  /**
   * Scopes the rule to one run. A scoped rule answers only requests carrying
   * `x-stub-session: <sessionId>`, so two tests can share one container without
   * seeing each other's rules.
   */
  sessionId?: string;
  /**
   * How many calls this rule answers before it removes itself. Omitted or `0` means
   * it stays installed until deleted.
   */
  times?: number;
}

/** The shape someone writes by hand. `headers`, `status`, `body` and `delayMs` are the answer. */
export interface StubRuleInputFlat extends RuleCommon {
  /** `GET`, `POST`, … or `*`. Defaults to `*`. */
  method?: string;
  /** The path to answer. Supports `:name` and `*`. */
  path: string;
  /** HTTP status of the answer. Defaults to 200. */
  status?: number;
  /** Response headers. */
  headers?: Record<string, string>;
  /** The answer body. */
  body?: unknown;
  /** Milliseconds to stall before answering. */
  delayMs?: number;
}

/** The shape for a rule that must be narrower than a path: query, headers, request body. */
export interface StubRuleInputLong extends RuleCommon {
  request: RuleRequestMatch;
  response?: RuleResponseSpec;
}

/** What a caller posts to `POST /stub/rules`. */
export type StubRuleInput = StubRuleInputLong | StubRuleInputFlat;

/** A rule as the stub stores and returns it, normalised to the long shape. */
export interface StubRule {
  id: string;
  name?: string;
  description?: string;
  sessionId?: string;
  /** Which shape the caller wrote, so `GET /stub/rules` can be read back into a wiki. */
  form: 'flat' | 'long';
  request: RuleRequestMatch;
  response: Required<Pick<RuleResponseSpec, 'status' | 'delayMs'>> &
    Omit<RuleResponseSpec, 'status' | 'delayMs'>;
  /** Calls left before the rule removes itself. `0` means unlimited. */
  remaining: number;
  createdAt: string;
}

/** The parts of an incoming request a rule is matched against. */
export interface IncomingRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
  /** The value of `x-stub-session`, when the caller sent one. */
  session?: string;
}
