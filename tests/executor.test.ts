import{afterAll,beforeAll,describe,expect,it}from'vitest';
import{chromium,type Browser,type Page}from'playwright';
import{executeClick,executeObserve}from'../server/audit.js';
import{randomUUID}from'node:crypto';
import{tmpdir}from'node:os';
import{join}from'node:path';

let browser:Browser;let page:Page;
beforeAll(async()=>{browser=await chromium.launch({headless:true});page=await browser.newPage()});
afterAll(async()=>{await browser.close()});

describe('planner action executor',()=>{
  it('executes a DOM-grounded click and keeps submit gating server-side',async()=>{
    await page.setContent('<button id="continue" type="button" onclick="this.dataset.clicked=\'yes\'">Continue</button><button id="submit" type="submit">Create account</button>');
    const click=await executeClick(page,{strategy:'role',value:'button:Continue'},false);
    expect(click).toEqual({executed:true,submissionControl:false,reason:null});
    expect(await page.locator('#continue').getAttribute('data-clicked')).toBe('yes');
    expect(await executeClick(page,{strategy:'id',value:'submit'},false)).toEqual({executed:false,submissionControl:true,reason:'submission_not_allowed'});
  });

  it('observes target state, validation errors, and a screenshot',async()=>{
    await page.setContent('<title>Observe fixture</title><label for="phone">Phone</label><input id="phone" name="phone" required aria-describedby="phoneError"><p id="phoneError">Phone is required</p>');
    const screenshotPath=join(tmpdir(),`blocker-agent-observe-${randomUUID()}.png`);
    const observation=await executeObserve(page,{strategy:'label',value:'Phone'},screenshotPath);
    expect(observation.title).toBe('Observe fixture');
    expect(observation.targetVisible).toBe(true);
    expect(observation.validationErrors).toContainEqual({locator:'phone',message:'Phone is required'});
    expect(observation.screenshot).toContain('blocker-agent-observe-');
  });
});
