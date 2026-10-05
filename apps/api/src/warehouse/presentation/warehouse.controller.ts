import { Body, Controller, Inject, Param } from '@nestjs/common';
import { Ctx, Op, type RequestContext } from '../../platform';
import { WarehouseService } from '../application/warehouse.service';
@Controller()
export class WarehouseController {
  constructor(@Inject(WarehouseService) private s: WarehouseService) {}
  @Op('receiveCargo') r(@Ctx() c: RequestContext, @Body() b: any) { return this.s.receive(c, b); }
  @Op('listLots') l(@Ctx() c: RequestContext) { return this.s.listLots(c); }
  @Op('placeHold') h(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.placeHold(c, id, b); }
  @Op('requestRelease') rr(@Ctx() c: RequestContext, @Body() b: any) { return this.s.requestRelease(c, b); }
  @Op('listHolds') lh(@Ctx() c: RequestContext) { return this.s.listHolds(c); }
  @Op('releaseHold') rh(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.releaseHold(c, id, b.note); }
  @Op('listReleaseOrders') lro(@Ctx() c: RequestContext) { return this.s.listReleaseOrders(c); }
  @Op('authorizeRelease') ar(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.authorize(c, id); }
}
