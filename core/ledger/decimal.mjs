const SCALE=10n**18n;
export function decimalUnits(value){
 if(typeof value!=='string'||! /^-?\d{1,20}(\.\d{1,18})?$/.test(value))throw new Error('INVALID_LEDGER_DECIMAL');
 const negative=value.startsWith('-'),[whole,fraction='']=value.replace(/^-/,'').split('.');
 return (BigInt(whole)*SCALE+BigInt(fraction.padEnd(18,'0')))*(negative?-1n:1n);
}
export function decimalText(units){const sign=units<0n?'-':'';const value=units<0n?-units:units;const fraction=(value%SCALE).toString().padStart(18,'0').replace(/0+$/,'');return sign+(value/SCALE).toString()+(fraction?'.'+fraction:'');}
export function canonicalDecimal(value){return decimalText(decimalUnits(value));}
export function numberDecimal(value){
 if(!Number.isFinite(value))throw new Error('INVALID_LEDGER_NUMBER');
 const text=String(value);if(!text.includes('e'))return canonicalDecimal(text);
 const [mantissa,power]=text.split('e'),negative=mantissa.startsWith('-');
 const [whole,fraction='']=mantissa.replace(/^-/,'').split('.'),digits=whole+fraction,point=whole.length+Number(power);
 const expanded=point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point);
 return canonicalDecimal((negative?'-':'')+expanded);
}
