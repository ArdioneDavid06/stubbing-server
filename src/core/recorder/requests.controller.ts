import { Controller, Delete, Get, Query } from '@nestjs/common';
import { Recorder } from './recorder.service';
import type { RecordedRequest } from './recorder.service';

/**
 * Lets a test ask what the application actually sent.
 *
 * `GET /stub/requests?path=customers` returns only the calls whose path contains
 * "customers", so an assertion reads as intent rather than as an array index.
 */
@Controller('stub/requests')
export class RequestsController {
  constructor(private readonly recorder: Recorder) {}

  @Get()
  list(@Query('path') path?: string): RecordedRequest[] {
    return path ? this.recorder.matching(path) : this.recorder.all();
  }

  @Delete()
  clear(): { cleared: true } {
    this.recorder.clear();
    return { cleared: true };
  }
}
