import { Body, Controller, Inject, Param } from '@nestjs/common';
import { Ctx, Op, type RequestContext } from '../../platform';
import { CommercialService } from '../application/commercial.service';
@Controller()
export class CommercialController {
  constructor(@Inject(CommercialService) private s: CommercialService) {}
  @Op('listEnquiries') le(@Ctx() c: RequestContext) { return this.s.listEnquiries(c); }
  @Op('createEnquiry') ce(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createEnquiry(c, b); }
  @Op('qualifyEnquiry') qe(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.qualifyEnquiry(c, id); }
  @Op('listQuotes') lq(@Ctx() c: RequestContext) { return this.s.listQuotes(c); }
  @Op('getQuote') gq(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.getQuote(c, id); }
  @Op('createQuote') cq(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createQuote(c, b); }
  @Op('approveQuote') aq(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.approveQuote(c, id); }
  @Op('acceptQuote') acq(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.acceptQuote(c, id, b); }
}
