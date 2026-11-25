import { Controller, Get, Param } from '@nestjs/common';
import { definePreset } from '../../src';

/**
 * A preset, as this repository writes one.
 *
 * The published npm package is the CLI only — the server lives in the image — so a
 * preset is not something a consuming team installs. It is how *this* repository adds
 * a partner's routes, and the shape a team copies if it ever builds its own image:
 *
 *   FROM ghcr.io/<org>/stubbing-server:1.0.0
 *   COPY dist/presets/acme /presets/acme
 *
 * `npm run typecheck:examples` compiles this file, so the seam cannot rot quietly.
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
