import express from 'express';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertSafeUrl} from './security.js';
import {runAudit} from './audit.js';
const app=express();const port=Number(process.env.PORT||3000);const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
app.disable('x-powered-by');
// Render terminates TLS and forwards the original client IP through one proxy.
// Trusting exactly one hop lets express-rate-limit identify clients without
// accepting an arbitrary X-Forwarded-For chain outside Render.
if(process.env.RENDER==='true')app.set('trust proxy',1);
app.use(express.json({limit:'8kb'}));app.use('/artifacts',express.static(path.resolve('artifacts'),{fallthrough:false,maxAge:'1h'}));
app.use('/api/audits',rateLimit({windowMs:60_000,limit:5,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Rate limit reached. Try again in one minute.'}}));
app.get('/api/health',(_req,res)=>res.json({ok:true,playwright:true,model:process.env.OPENAI_MODEL||'gpt-5.6'}));
app.post('/api/audits',async(req,res)=>{try{if(typeof req.body?.url!=='string')return res.status(400).json({error:'A URL is required.'});const url=await assertSafeUrl(req.body.url);const result=await Promise.race([runAudit(url),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Audit timed out safely.')),Number(process.env.AUDIT_TIMEOUT_MS||20000)+2000))]);res.json(result);}catch(error){const message=error instanceof Error?error.message:'Audit failed safely.';res.status(message.includes('blocked')||message.includes('valid')?400:422).json({error:message});}});
app.use('/demo',express.static(path.join(root,'demo-target')));app.use(express.static(path.join(root,'dist')));app.use((_req,res)=>res.sendFile(path.join(root,'dist','index.html')));
app.listen(port,()=>console.log(`Arabic Market Blocker Agent listening on http://localhost:${port}`));
