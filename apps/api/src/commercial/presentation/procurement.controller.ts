import { Body, Controller, Inject, Param, ParseUUIDPipe } from '@nestjs/common';
import { Ctx, Op, type RequestContext } from '../../platform';
import { ProcurementService } from '../application/procurement.service';
@Controller()
export class ProcurementController {
  constructor(@Inject(ProcurementService) private s: ProcurementService) {}
  @Op('listRfqs') list(@Ctx() c: RequestContext) { return this.s.list(c); }
  @Op('getRfq') get(@Ctx() c: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.s.get(c,id); }
  @Op('createRfq') create(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c,b); }
  @Op('issueRfq') issue(@Ctx() c: RequestContext, @Param('id', new ParseUUIDPipe()) id: string) { return this.s.issue(c,id); }
  @Op('recordRfqOffer') offer(@Ctx() c: RequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() b: any) { return this.s.offer(c,id,b); }
  @Op('awardRfq') award(@Ctx() c: RequestContext, @Param('id', new ParseUUIDPipe()) id: string, @Body() b: any) { return this.s.award(c,id,b); }
}
