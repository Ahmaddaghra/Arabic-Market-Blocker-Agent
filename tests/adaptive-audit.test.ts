import{afterAll,beforeAll,describe,expect,it}from'vitest';
import{createServer,type Server}from'node:http';
import{readFile}from'node:fs/promises';
import{fileURLToPath}from'node:url';
import{runAudit}from'../server/audit.js';
import type{Field,PlanAction}from'../server/types.js';
import type{PlanResult}from'../server/planner.js';

let server:Server;let targetUrl:string;
beforeAll(async()=>{const fixture=await readFile(fileURLToPath(new URL('../demo-target/adaptive/index.html',import.meta.url)),'utf8');server=createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html; charset=utf-8'});response.end(fixture)});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('Fixture server did not expose a TCP port.');targetUrl=`http://127.0.0.1:${address.port}/demo/adaptive/`});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))});

const result=(actions:PlanAction[],round:number):PlanResult=>({supported:true,reason:`Mock GPT round ${round} mapped visible fields.`,actions,source:'mock-gpt-5.6-adaptive',fallbackReason:null,log:[`Mock GPT response round ${round}: ${actions.length} grounded actions`]});
const adaptiveMock=async(fields:Field[]):Promise<PlanResult>=>fields.some(field=>field.label==='How should we greet you?')?result([
  {action:'fill',fieldPurpose:'greeting name',valueKey:'fullName',locator:{strategy:'label',value:'How should we greet you?'},reason:'Mock GPT recognized an unconventional greeting label as the name field.'},
  {action:'fill',fieldPurpose:'Saudi mobile',valueKey:'phoneLocal',locator:{strategy:'label',value:'Mobile / WhatsApp'},reason:'Mock GPT recognized the contact label as the phone field.'},
  {action:'click',fieldPurpose:'next step',valueKey:null,locator:{strategy:'role',value:'Continue'},reason:'Reveal the next bounded form step.'}
],1):result([
  {action:'fill',fieldPurpose:'work email',valueKey:'email',locator:{strategy:'label',value:'Work email'},reason:'Fill the newly visible email field.'},
  {action:'fill',fieldPurpose:'password',valueKey:'password',locator:{strategy:'label',value:'Password'},reason:'Fill the newly visible password field.'},
  {action:'click',fieldPurpose:'owned benchmark submit',valueKey:null,locator:{strategy:'role',value:'Create workspace'},reason:'Complete the owned controlled flow.'}
],2);

describe('guarded adaptive audit integration',()=>{
  it('executes a valid mock-GPT plan, replans, and completes the multi-step audit',async()=>{
    const audit=await runAudit(new URL(targetUrl),{allowSubmission:true,controlledBenchmark:true,planner:adaptiveMock});
    expect(audit.status).toBe('completed');
    expect(audit.planner).toBe('mock-gpt-5.6-adaptive');
    expect(audit.findings.map(finding=>finding.rootCauseId).sort()).toEqual(['name-ascii-only','phone-us-only']);
    expect(audit.fieldComparisons.map(row=>row.fieldPurpose)).toEqual(expect.arrayContaining(['How should we greet you?','Mobile / WhatsApp','Work email','Password']));
    expect(audit.plannerLog.join('\n')).toContain('Adaptive replan 1');
    expect(audit.plannerLog.join('\n')).toContain('Execution click: locator=role=Create workspace, EN=executed, AR=executed');
    expect(audit.benchmarkEvaluation?.submissionAttempted).toBe(true);
  },30000);

  it('does not create a finding for a missing or stale locator',async()=>{
    const stalePlanner=async():Promise<PlanResult>=>result([
      {action:'fill',fieldPurpose:'stale name',valueKey:'fullName',locator:{strategy:'id',value:'removed-name-field'},reason:'Simulate a locator that disappeared after planning.'},
      {action:'fill',fieldPurpose:'Saudi mobile',valueKey:'phoneLocal',locator:{strategy:'label',value:'Mobile / WhatsApp'},reason:'Keep one valid grounded action as a control.'}
    ],1);
    const audit=await runAudit(new URL(targetUrl),{allowSubmission:false,controlledBenchmark:false,planner:stalePlanner});
    expect(audit.status).toBe('completed');
    expect(audit.plannerLog.join('\n')).toContain('Execution fill failed: valueKey=fullName');
    expect(audit.findings.some(finding=>finding.rootCauseId==='name-ascii-only')).toBe(false);
    expect(audit.fieldComparisons.some(row=>row.english.locator.value==='removed-name-field')).toBe(false);
  },30000);
});
