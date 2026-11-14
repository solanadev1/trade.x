import { createHash } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { rpc } from './helius';
import { PUMP_PROGRAM, curveAddress } from './pumpDecoder';
type Account={owner:string;data:[string,string]};
export async function account(address:string):Promise<Account>{const r=await rpc<{value:Account|null}>('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);if(!r.value)throw new Error('Account unavailable');return r.value;}
async function readMintMetadata(mint:string){
 const a=await account(mint),data=Buffer.from(a.data[0],'base64');
 if(!['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(a.owner)||data.length<82)throw new Error('Invalid mint account');
 let before:string|undefined;let createdAt:number|undefined;let creationSlot:number|undefined;const seen=new Set<string>();
 while(true){const rows=await rpc<{signature:string;slot:number;blockTime:number|null;err:unknown}[]>('getSignaturesForAddress',[curveAddress(mint).toBase58(),{limit:1000,...(before?{before}:{})}]);if(!rows.length)break;
 for(const row of rows)if(!row.err&&row.blockTime!==null){createdAt=Math.min(createdAt??Infinity,row.blockTime*1000);creationSlot=Math.min(creationSlot??Infinity,row.slot);}
 const next=rows.at(-1)!.signature;if(seen.has(next))throw new Error('Signature pagination stalled');seen.add(next);before=next;}
 if(createdAt===undefined)throw new Error('Creation history unavailable');
 return {decimals:data[44],createdAt,creationSlot};
}
export async function initialRealReserves(){const address=PublicKey.findProgramAddressSync([Buffer.from('global')],PUMP_PROGRAM)[0];const a=await account(address.toBase58());const data=Buffer.from(a.data[0],'base64');if(a.owner!==PUMP_PROGRAM.toBase58()||data.length<97||!data.subarray(0,8).equals(createHash('sha256').update('account:Global').digest().subarray(0,8)))throw new Error('Invalid Pump Global account');const reserve=data.readBigUInt64LE(89);if(!reserve)throw new Error('Invalid initial reserve');return reserve;}

const metadataCache=new Map<string,Promise<Awaited<ReturnType<typeof readMintMetadata>>>>();
export function mintMetadata(mint:string){let pending=metadataCache.get(mint);if(!pending){pending=readMintMetadata(mint).catch(error=>{metadataCache.delete(mint);throw error;});metadataCache.set(mint,pending);}return pending;}
