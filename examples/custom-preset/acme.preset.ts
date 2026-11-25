import { Controller, Get, Param } from '@nestjs/common';
import { definePreset } from '@rmc/stubbing';

/**
 * A preset, as a consuming team writes one.
 *
 * It lives in that team's repository, is loaded with `--preset`, and needs no change
 * to this package. The partner below is fictional: there is no real preset in this
 * package, on purpose.
 *
 * Build it with the rest of the consuming project, then:
 *
 *   npx stub-server --preset ./dist/acme.preset.js
 *
 * `npm run typecheck:examples` compiles this file against the package's public API,
 * so the seam cannot rot without the build failing.
 */

/** The answer the partner documented. Fields it did not document are left out. */
interface AcmeOrder {
  id: string;
  status: 'CONFIRMED' | 'CANCELLED';
  totalMinor: number;
  currency: 'PHP';
}

@Controller('acme/orders')
export class AcmeOrdersController {
  @Get(':id')
  get(@Param('id') id: string): AcmeOrder {
    return { id, status: 'CONFIRMED', totalMinor: 129900, currency: 'PHP' };
  }
}

export const acmePreset = definePreset({
  name: 'acme',
  controllers: [AcmeOrdersController],
  /**
   * This partner puts its identifier in the query string, not the body. Only the
   * preset knows that, which is why `keyOf` is here and not in core.
   *
   * With this, `POST /stub/failures { "key": "C-77", "status": 409 }` fails the next
   * call to `GET /acme/orders/42?customerRef=C-77`.
   */
  keyOf: (request) => {
    const key = request.query.customerRef;

    return typeof key === 'string' && key.length > 0 ? key : undefined;
  },
});
