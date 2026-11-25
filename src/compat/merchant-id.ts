import {
  asRecord,
  readString,
  type KeyExtractor,
} from '../core/failures/key-source';

/**
 * `merchantID` is a partner's word for an identifier, not a concept, so it lives
 * here rather than in `core/`.
 *
 * It exists for one reason: Remote's acceptance collection already sends it on every
 * partner call, and a rename in a stub should not turn into a rewrite of 237 requests.
 * Accepting the old name costs one line.
 *
 * It is a compatibility shim, not an API. It can go in a major release, and a team
 * starting fresh should never need to know it exists.
 */
export const merchantIdAliasKeyOf: KeyExtractor = (request) => {
  const body = asRecord(request.body);

  return (
    readString(body?.merchantID) ??
    readString(body?.merchantId) ??
    readString(request.query.merchantID) ??
    readString(request.query.merchantId)
  );
};
