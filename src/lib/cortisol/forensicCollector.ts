import {queueEmotionWindow,emotionDnaProfiles,emotionFlowRatio,type EmotionPosition,type EmotionProfile} from '../db/cortisolDb';
import {emotionClusterForensics,type EmotionClusterWallet} from './safetyForensics';
import {rpc,allEnhancedHistory,type Trade} from './helius';import {historicalTrades} from './history';import {account,mintMetadata} from './chainMetadata';import {curveAddress,decodePumpCurve} from './pumpDecoder';import {safetyForensics} from './safetyForensics';
export async function collectForensics(mint:string,recent:Trade[],minDecay=55){
 const a=await account(curveAddress(mint).toBase58()),curve=decodePumpCurve(Buffer.from(a.data[0],'base64'));const ownerBalances=new Map<string,bigint>();
 for(let page=1;;page++){const result=await rpc<{token_accounts:{owner:string;amount:number|string}[]}>('getTokenAccounts',{mint,page,limit:1000,displayOptions:{showZeroBalance:false}} as unknown as unknown[]);if(!Array.isArray(result.token_accounts))throw new Error('Holder inventory unavailable');for(const row of result.token_accounts){if(typeof row.amount==='number'&&!Number.isSafeInteger(row.amount))throw new Error('Unsafe holder amount precision');ownerBalances.set(row.owner,(ownerBalances.get(row.owner)??0n)+BigInt(row.amount));}if(result.token_accounts.length<1000)break;}
 const history=await historicalTrades(curveAddress(mint).toBase58());const emotionWindowResult=queueEmotionWindow(mint,[...history,...recent]);const emotionProfiles=emotionDnaProfiles();if(!history.length||history[0].slot===undefined)throw new Error('Creation slot unavailable');const creationSlot=(await mintMetadata(mint)).creationSlot;if(creationSlot===undefined)throw new Error('Creation slot unavailable');const early=new Map<string,bigint>();for(const t of history){if(t.buy&&t.slot!<=creationSlot+1)early.set(t.wallet,(early.get(t.wallet)??0n)+BigInt(Math.round(t.tokens*1e6)));else if(!t.buy&&early.has(t.wallet))early.set(t.wallet,early.get(t.wallet)!-BigInt(Math.round(t.tokens*1e6))>0n?early.get(t.wallet)!-BigInt(Math.round(t.tokens*1e6)):0n);}
 const now=Date.now(),sells=recent.filter(t=>!t.buy&&t.timestamp>=now-60000),sellerVolumes=new Map<string,number>();for(const t of sells)sellerVolumes.set(t.wallet,(sellerVolumes.get(t.wallet)??0)+t.sol);
 const sellers=[];for(const [wallet,volumeSol] of sellerVolumes){const txs=(await allEnhancedHistory(wallet)).sort((a,b)=>a.timestamp-b.timestamp);const funding=txs.flatMap(t=>t.nativeTransfers??[]).find(t=>t.toUserAccount===wallet&&t.fromUserAccount!==wallet);const direct=txs.some(t=>t.source!=='PUMP_FUN'&&(t.tokenTransfers??[]).some(x=>x.mint===mint&&x.toUserAccount===wallet));sellers.push({wallet,volumeSol,fundingParent:funding?.fromUserAccount??null,receivedDirectTransfer:direct});}
 const candles=new Map<number,number>();for(const t of recent)if(!t.buy)candles.set(Math.floor(t.timestamp/30000),(candles.get(Math.floor(t.timestamp/30000))??0)+t.sol);const latest=recent.filter(t=>!t.buy&&t.timestamp>=now-30000).reduce((s,t)=>s+t.sol,0);const peak=Math.max(0,...[...candles].filter(([bucket])=>bucket<Math.floor(now/30000)).map(([,v])=>v));
 const creator=curve.creator.toBase58();const verdict=safetyForensics({complete:true,supplyRaw:curve.tokenTotalSupply,creationSlot,snipers:[...early].map(([wallet,remainingRaw])=>({boughtSlot:creationSlot,remainingRaw:remainingRaw<(ownerBalances.get(wallet)??0n)?remainingRaw:ownerBalances.get(wallet)??0n})),creatorHoldingRaw:ownerBalances.get(creator)??0n,creatorSelling:sells.some(t=>t.wallet===creator),holders:[...ownerBalances].map(([wallet,amountRaw])=>({wallet,amountRaw,isPool:wallet===curveAddress(mint).toBase58()})),sellers,peakPanicSol:peak,latestSellSol:latest,buyers:recent.filter(t=>t.buy&&t.timestamp>=now-60000).map(t=>({wallet:t.wallet,sol:t.sol,fresh:!history.some(old=>old.wallet===t.wallet&&old.timestamp<t.timestamp-60000),smartMoney:false}))},minDecay);const emotionClusterWallets:EmotionClusterWallet[]=[];
 for(const emotionWallet of new Set(recent.filter(emotionTrade=>emotionTrade.buy&&emotionTrade.timestamp>=now-60000).map(emotionTrade=>emotionTrade.wallet))){
 const emotionWalletTrades=emotionWindowResult.emotionTrades.filter(emotionTrade=>emotionTrade.wallet===emotionWallet);
 const emotionEntry=emotionWalletTrades.find(emotionTrade=>emotionTrade.buy);
 if(!emotionEntry)continue;
 const emotionFundingHistory=(await allEnhancedHistory(emotionWallet)).filter(emotionTx=>!emotionTx.transactionError).sort((emotionA,emotionB)=>emotionA.timestamp-emotionB.timestamp);
 const emotionFunding=emotionFundingHistory.flatMap(emotionTx=>emotionTx.nativeTransfers??[]).find(emotionTransfer=>emotionTransfer.toUserAccount===emotionWallet&&emotionTransfer.fromUserAccount!==emotionWallet);
 emotionClusterWallets.push({emotionWallet,emotionFresh:!history.some(emotionTrade=>emotionTrade.wallet===emotionWallet&&emotionTrade.timestamp<now-60000),emotionParent:emotionFunding?.fromUserAccount??null,emotionFundingSol:emotionFunding?emotionFunding.amount/1e9:null,emotionEntryMs:emotionEntry.observedAt??null,emotionBuySol:emotionWalletTrades.filter(emotionTrade=>emotionTrade.buy).reduce((emotionSum,emotionTrade)=>emotionSum+emotionTrade.sol,0),emotionSellSol:emotionWalletTrades.filter(emotionTrade=>!emotionTrade.buy).reduce((emotionSum,emotionTrade)=>emotionSum+emotionTrade.sol,0),emotionObservedMs:Math.max(0,now-emotionEntry.timestamp)});
 }
 const emotionMetadata=await mintMetadata(mint);
 return {...verdict,emotionFlow:emotionFlowRatio(recent,now),emotionPain:emotionPainHorizon(emotionWindowResult.emotionPositions,emotionProfiles,ownerBalances,emotionMetadata.decimals,Number(curve.virtualSolReserves)/Number(curve.virtualTokenReserves)*10**emotionMetadata.decimals/1e9,now,recent),emotionTape:emotionTapeSignals(recent,emotionProfiles,now),emotionClusters:emotionClusterForensics(emotionClusterWallets),top10Pct:Number([...ownerBalances].filter(([wallet])=>wallet!==curveAddress(mint).toBase58()).map(([,v])=>v).sort((a,b)=>a>b?-1:1).slice(0,10).reduce((sum,v)=>sum+v,0n))/Number(curve.tokenTotalSupply)*100,bundledWallets:[...early].filter(([,amount])=>amount>0n).map(([wallet])=>wallet)};
}

export function emotionPainHorizon(
  emotionPositions: EmotionPosition[], emotionProfiles: EmotionProfile[],
  emotionBalances: Map<string, bigint>, emotionDecimals: number,
  emotionPrice: number, emotionNow: number, emotionRecent: Trade[],
) {
  const emotionDna = new Map(emotionProfiles.map(emotionProfile => [emotionProfile.emotionWallet, emotionProfile]));
  const emotionHolders = emotionPositions.filter(emotionPosition => emotionNow - emotionPosition.emotionOpenedAt <= 900000)
    .map(emotionPosition => ({ ...emotionPosition, emotionTokens: Math.min(emotionPosition.emotionTokens,
      Number(emotionBalances.get(emotionPosition.emotionWallet) ?? 0n) / 1e6) }))
    .filter(emotionPosition => emotionPosition.emotionTokens > 0);
  // Emotion Trade token quantities are normalized to six decimals by the existing event decoder.
  const emotionScale = 10 ** (emotionDecimals - 6);
  const emotionTokens = emotionHolders.reduce((emotionSum, emotionPosition) => emotionSum + emotionPosition.emotionTokens, 0);
  const emotionVwap = emotionTokens ? emotionHolders.reduce((emotionSum, emotionPosition) =>
    emotionSum + emotionPosition.emotionTokens * emotionPosition.emotionEntryPrice * emotionScale, 0) / emotionTokens : null;
  const emotionGamblers = emotionHolders.filter(emotionPosition => emotionDna.get(emotionPosition.emotionWallet)?.emotionClass === 'Emotional Retail Gamblers');
  const emotionLevels = emotionGamblers.flatMap(emotionPosition => {
    const emotionCap = emotionDna.get(emotionPosition.emotionWallet)?.emotionCapitulation;
    return emotionCap == null ? [] : [{ emotionWallet: emotionPosition.emotionWallet,
      emotionLevel: emotionPosition.emotionEntryPrice * emotionScale * (1 - Math.max(.25, Math.min(.4, emotionCap))) }];
  }).sort((emotionA, emotionB) => emotionB.emotionLevel - emotionA.emotionLevel);
  const emotionCoverage = emotionGamblers.length ? emotionLevels.length / emotionGamblers.length : 0;
  const emotionRequired = Math.ceil(emotionGamblers.length * .75);
  const emotionThreshold = emotionRequired > 0 && emotionLevels.length >= emotionRequired ? emotionLevels[emotionRequired - 1].emotionLevel : null;
  const emotionUnderwater = emotionLevels.filter(emotionLevel => emotionPrice <= emotionLevel.emotionLevel).length;
  const emotionBins = new Map<number, number>();
  for (const emotionTrade of emotionRecent) if (!emotionTrade.buy && emotionDna.get(emotionTrade.wallet)?.emotionClass === 'Emotional Retail Gamblers' && emotionTrade.timestamp <= emotionNow && emotionTrade.timestamp >= emotionNow - 60000) {
    const emotionBin = Math.floor((emotionNow - emotionTrade.timestamp) / 5000);
    emotionBins.set(emotionBin, (emotionBins.get(emotionBin) ?? 0) + emotionTrade.sol);
  }
  const emotionPeak = Math.max(0, ...emotionBins.values());
  const emotionExhaustionScore = emotionPeak > 0 && emotionGamblers.length ? Math.min(100,
    100 * emotionUnderwater / emotionGamblers.length * (emotionBins.get(0) ?? 0) / emotionPeak) : 0;
  return { emotionVwap, emotionHolders: emotionHolders.length, emotionGamblerHolders: emotionGamblers.length,
    emotionCoverage, emotionPainPrice75: emotionThreshold, emotionExhaustionScore,
    emotionModel: 'Emotion historical-capitulation estimate; not a guaranteed forced-sale price' };
}

export function emotionTapeSignals(emotionTrades: Trade[], emotionProfiles: EmotionProfile[], emotionNow = Date.now()) {
  const emotionDna = new Map(emotionProfiles.map(emotionProfile => [emotionProfile.emotionWallet, emotionProfile]));
  const emotionTape = [...emotionTrades].filter(emotionTrade => emotionTrade.timestamp <= emotionNow && emotionTrade.timestamp >= emotionNow - 60000)
    .sort((emotionA, emotionB) => emotionA.timestamp - emotionB.timestamp);
  const emotionSellSizes = emotionTape.filter(emotionTrade => !emotionTrade.buy).map(emotionTrade => emotionTrade.sol).sort((emotionA, emotionB) => emotionA - emotionB);
  const emotionLarge = emotionSellSizes[Math.floor(emotionSellSizes.length * .75)] ?? Infinity;
  let emotionPreviousImpact: number | null = null;
  const emotionAbsorptions: { emotionSeller: string; emotionDeltaMs: number; emotionImpactPerSol: number; emotionSignal: string }[] = [];
  const emotionUsedBuys = new Set<string>();
  for (let emotionIndex = 1; emotionIndex < emotionTape.length; emotionIndex++) {
    const emotionSell = emotionTape[emotionIndex];
    if (emotionSell.buy) continue;
    const emotionImpact = Math.max(0, emotionTape[emotionIndex - 1].price - emotionSell.price) / emotionSell.sol;
    const emotionShrinking = emotionPreviousImpact !== null && emotionPreviousImpact > 0 && emotionImpact < emotionPreviousImpact;
    emotionPreviousImpact = emotionImpact;
    if (!emotionShrinking || emotionSell.sol < emotionLarge || emotionSell.observedAt === undefined || emotionDna.get(emotionSell.wallet)?.emotionClass !== 'Emotional Retail Gamblers') continue;
    const emotionBuys = emotionTape.slice(emotionIndex + 1).filter(emotionBuy => emotionBuy.buy && emotionBuy.wallet !== emotionSell.wallet &&
      !emotionUsedBuys.has(emotionBuy.signature) && emotionBuy.observedAt !== undefined && emotionBuy.observedAt > emotionSell.observedAt! &&
      emotionBuy.observedAt - emotionSell.observedAt! < 400 && emotionBuy.signature.split(':')[0] !== emotionSell.signature.split(':')[0])
      .sort((emotionA, emotionB) => emotionA.observedAt! - emotionB.observedAt!);
    let emotionAbsorbed = 0;
    for (const emotionBuy of emotionBuys) {
      emotionAbsorbed += emotionBuy.sol;
      if (emotionAbsorbed >= emotionSell.sol && emotionBuy.price >= emotionSell.price) {
        for (const emotionConsumed of emotionBuys.filter(emotionItem => emotionItem.observedAt! <= emotionBuy.observedAt!)) emotionUsedBuys.add(emotionConsumed.signature);
        emotionAbsorptions.push({ emotionSeller: emotionSell.wallet, emotionDeltaMs: emotionBuy.observedAt! - emotionSell.observedAt,
          emotionImpactPerSol: emotionImpact, emotionSignal: 'Emotion Institutional Floor Absorption' }); break;
      }
    }
  }
  const emotionApexBuys = emotionTape.filter(emotionTrade => emotionTrade.buy && emotionTrade.observedAt !== undefined && emotionNow - emotionTrade.observedAt <= 3000 &&
    emotionDna.get(emotionTrade.wallet)?.emotionClass === 'Apex Sharks' && (emotionDna.get(emotionTrade.wallet)?.emotionCopyHerdScore ?? 0) >= 60)
    .map(emotionTrade => ({ emotionWallet: emotionTrade.wallet, emotionSignature: emotionTrade.signature,
      emotionCopyHerdScore: emotionDna.get(emotionTrade.wallet)!.emotionCopyHerdScore, emotionSignal: 'Emotion Apex Copy-Herd Watch' }));
  return { emotionAbsorptions, emotionApexBuys, emotionTimingBasis: 'Emotion local WebSocket receipt milliseconds; not exchange execution time', emotionEvidenceOnly: true };
}
