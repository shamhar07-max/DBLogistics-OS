import { Body, Controller, Inject, Param } from '@nestjs/common';
import { Ctx, Op, type RequestContext } from '../../platform';
import { FinanceService } from '../application/finance.service';

@Controller()
export class FinanceController {
  constructor(@Inject(FinanceService) private s: FinanceService) {}
  @Op('createCharge') createCharge(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createCharge(c, b); }
  @Op('accrueCharge') accrue(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.accrueCharge(c, id); }
  @Op('createInvoiceDraft') draft(@Ctx() c: RequestContext, @Body() b: any) { return this.s.createInvoiceDraft(c, b); }
  @Op('approveInvoice') approve(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.approveInvoice(c, id); }
  @Op('postInvoice') post(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.postInvoice(c, id, b.postingDate); }
  @Op('listInvoices') list(@Ctx() c: RequestContext) { return this.s.listInvoices(c); }
  @Op('recordSupplierBill') bill(@Ctx() c: RequestContext, @Body() b: any) { return this.s.recordSupplierBill(c, b); }
  @Op('recordPayment') pay(@Ctx() c: RequestContext, @Body() b: any) { return this.s.recordPayment(c, b); }
  @Op('allocatePayment') alloc(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.allocatePayment(c, id, b); }
}
