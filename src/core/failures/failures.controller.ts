import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { STUB_FAILURES } from './failures.service';
import type { FailureStore, StubFailure } from './failure.types';

/**
 * Makes one call fail, on demand.
 *
 *   POST   /stub/failures        { "key": "C-1", "status": 409 }
 *   GET    /stub/failures        what is installed
 *   DELETE /stub/failures        clear everything
 *   DELETE /stub/failures/:key   clear one
 *
 * `merchantID` is accepted wherever `key` is, so a collection written against the old
 * stub does not have to change.
 */
@Controller('stub/failures')
export class FailuresController {
  constructor(@Inject(STUB_FAILURES) private readonly failures: FailureStore) {}

  @Post()
  @HttpCode(200)
  set(@Body() input: unknown): StubFailure {
    return this.failures.add(input);
  }

  @Get()
  list(): Record<string, StubFailure> {
    return Object.fromEntries(
      this.failures.all().map((failure) => [failure.key, failure]),
    );
  }

  @Delete()
  @HttpCode(200)
  clear(): { cleared: number } {
    return { cleared: this.failures.clear() };
  }

  @Delete(':key')
  @HttpCode(200)
  clearOne(@Param('key') key: string): { cleared: string } {
    if (this.failures.clear(key) === 0) {
      throw new NotFoundException({ message: `No failure for key ${key}` });
    }

    return { cleared: key };
  }
}
