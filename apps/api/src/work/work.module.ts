import { Body,Controller,Inject,Module,Param,ParseUUIDPipe } from '@nestjs/common';
import { Ctx,Op,Qry,type RequestContext } from '../platform';
import { WorkService } from './work.service';
@Controller()
export class WorkController {
 constructor(@Inject(WorkService) private s:WorkService) {}
 @Op('listWorkCalendars') calendars(@Ctx() c:RequestContext){return this.s.calendars(c);}
 @Op('createWorkCalendar') calendar(@Ctx() c:RequestContext,@Body() b:any){return this.s.createCalendar(c,b);}
 @Op('listWorkTemplates') templates(@Ctx() c:RequestContext){return this.s.templates(c);}
 @Op('createWorkTemplate') template(@Ctx() c:RequestContext,@Body() b:any){return this.s.createTemplate(c,b);}
 @Op('startWorkTemplate') start(@Ctx() c:RequestContext,@Body() b:any){return this.s.startTemplate(c,b);}
 @Op('listWorkItems') list(@Ctx() c:RequestContext,@Qry() q:any){return this.s.list(c,q);}
 @Op('createWorkItem') create(@Ctx() c:RequestContext,@Body() b:any){return this.s.create(c,b);}
 @Op('getWorkItem') get(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string){return this.s.get(c,id);}
 @Op('transitionWorkItem') transition(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:any){return this.s.transition(c,id,b);}
 @Op('assignWorkItem') assign(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:any){return this.s.assign(c,id,b);}
 @Op('getWorkDirectory') directory(@Ctx() c:RequestContext){return this.s.directory(c);}
 @Op('setWorkCapacity') capacity(@Ctx() c:RequestContext,@Body() b:any){return this.s.capacity(c,b);}
 @Op('getWorkload') workload(@Ctx() c:RequestContext){return this.s.workload(c);}
 @Op('checkWorkSlas') slas(@Ctx() c:RequestContext){return this.s.checkSlas(c);}
 @Op('listHandovers') handovers(@Ctx() c:RequestContext){return this.s.handovers(c);}
 @Op('createHandover') handover(@Ctx() c:RequestContext,@Body() b:any){return this.s.createHandover(c,b);}
 @Op('acknowledgeHandover') acknowledge(@Ctx() c:RequestContext,@Param('id',new ParseUUIDPipe()) id:string,@Body() b:any){return this.s.acknowledge(c,id,b);}
}
@Module({providers:[WorkService],controllers:[WorkController]})export class WorkModule{}
