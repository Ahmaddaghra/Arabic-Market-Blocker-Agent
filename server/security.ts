import dns from 'node:dns/promises';
import net from 'node:net';

const blockedHosts = new Set(['localhost','localhost.localdomain','0.0.0.0']);
export function isPrivateIp(ip:string){
  if(net.isIPv4(ip)){
    const [a,b]=ip.split('.').map(Number);
    return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
  }
  const value=ip.toLowerCase();
  return value==='::1'||value==='::'||value.startsWith('fc')||value.startsWith('fd')||value.startsWith('fe80:')||value.startsWith('::ffff:127.');
}
export async function assertSafeUrl(raw:string){
  let url:URL;
  try{url=new URL(raw);}catch{throw new Error('Enter a valid absolute URL.');}
  if(!['http:','https:'].includes(url.protocol)) throw new Error('Only http and https URLs are supported.');
  if(url.username||url.password) throw new Error('URLs containing credentials are not supported.');
  if(blockedHosts.has(url.hostname.toLowerCase())) throw new Error('Local and private network targets are blocked.');
  const addresses=net.isIP(url.hostname)?[{address:url.hostname}]:await dns.lookup(url.hostname,{all:true,verbatim:true});
  if(!addresses.length) throw new Error('The target hostname could not be resolved.');
  if(process.env.ALLOW_PRIVATE_TARGETS!=='true'&&addresses.some(({address})=>isPrivateIp(address))) throw new Error('Local and private network targets are blocked.');
  return url;
}
