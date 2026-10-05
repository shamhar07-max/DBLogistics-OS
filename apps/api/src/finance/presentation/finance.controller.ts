import { Body, Controller, Inject, Param } from '@nestjs/common';
import { Ctx, Op, Qry, type RequestContext } from '../../platform';
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
  @Op('getInvoice') gi(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.getInvoice(c, id); }
  @Op('recordSupplierBill') bill(@Ctx() c: RequestContext, @Body() b: any) { return this.s.recordSupplierBill(c, b); }
  @Op('listCharges') lch(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.listCharges(c, q.jobId); }
  @Op('listPayments') lp(@Ctx() c: RequestContext) { return this.s.listPayments(c); }
  @Op('listSupplierBills') lsb(@Ctx() c: RequestContext) { return this.s.listSupplierBills(c); }
  @Op('getReceivablesAgeing') rag(@Ctx() c: RequestContext) { return this.s.receivablesAgeing(c); }
  @Op('getJobProfitability') jp(@Ctx() c: RequestContext) { return this.s.jobProfitability(c); }
  @Op('recordPayment') pay(@Ctx() c: RequestContext, @Body() b: any) { return this.s.recordPayment(c, b); }
  @Op('allocatePayment') alloc(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.allocatePayment(c, id, b); }
}
