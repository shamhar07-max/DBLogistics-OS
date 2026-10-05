import { Body, Controller, Inject, Param } from '@nestjs/common';
import { Ctx, Op, type RequestContext } from '../../platform';
import { LogisticsService } from '../application/logistics.service';
import { FinanceService } from '../../finance';
@Controller()
export class LogisticsController {
  constructor(@Inject(LogisticsService) private s: LogisticsService, @Inject(FinanceService) private fin: FinanceService) {}
  @Op('listJobs') lj(@Ctx() c: RequestContext) { return this.s.listJobs(c); }
  @Op('getJob') gj(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.getJob(c, id); }
  @Op('getJobMargin') gm(@Ctx() c: RequestContext, @Param('id') id: string) { return this.fin.jobMargin(c, id); }
  @Op('closeJob') cj(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.closeJob(c, id, b.acknowledgedExceptions); }
  @Op('createShipment') cs(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createShipment(c, b); }
  @Op('getShipmentTimeline') tl(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.timeline(c, id); }
  @Op('recordTrackingEvent') ev(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.recordEvent(c, id, b); }
  @Op('completeDelivery') cd(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.completeDelivery(c, id, b); }
  @Op('requestBooking') rb(@Ctx() c: RequestContext, @Body() b: any) { return this.s.requestBooking(c, b); }
  @Op('confirmBooking') cb(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.confirmBooking(c, id, b.externalRef); }
  @Op('markBookingOutcomeUnknown') mu(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.markOutcomeUnknown(c, id); }
}
