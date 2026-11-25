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
  Query,
} from '@nestjs/common';
import { STUB_RULES } from './rules.service';
import type { RuleStore } from './rules.service';
import type { StubRule } from './rule.types';

/**
 * Installs stubs at runtime.
 *
 *   POST   /stub/rules              install one, answers 201 with the normalised rule
 *   GET    /stub/rules[?sessionId=] what is installed, in match order
 *   DELETE /stub/rules[?sessionId=] remove every rule, or one run's rules
 *   DELETE /stub/rules/:id          remove one
 *
 * Both shapes are accepted, and both mean the same thing:
 *
 *   { "method": "GET", "path": "/v2/customers/:id", "status": 200, "body": {} }
 *
 *   { "request":  { "method": "GET", "path": "/v2/customers/:id" },
 *     "response": { "status": 200, "body": {} } }
 *
 * The second is the one to reach for when a rule must be narrower than a path:
 * `request.query`, `request.headers` and a partial `request.body`.
 */
@Controller('stub/rules')
export class RulesController {
  constructor(@Inject(STUB_RULES) private readonly rules: RuleStore) {}

  @Post()
  @HttpCode(201)
  create(@Body() input: unknown): StubRule {
    return this.rules.add(input);
  }

  @Get()
  list(@Query('sessionId') sessionId?: string): StubRule[] {
    return this.rules.list(sessionId);
  }

  @Delete()
  clear(@Query('sessionId') sessionId?: string): { cleared: number } {
    return { cleared: this.rules.clear(sessionId) };
  }

  @Delete(':id')
  remove(@Param('id') id: string): { removed: string } {
    if (!this.rules.remove(id)) {
      throw new NotFoundException({ message: `No rule with id ${id}` });
    }

    return { removed: id };
  }
}
