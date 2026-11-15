'use strict';
function isoMonth(value){
 if(!/^\d{4}-\d{2}$/.test(value))throw Error('חודש לא תקין');
 const [y,m]=value.split('-').map(Number);
 if(y<2020||y>2100||m<1||m>12)throw Error('חודש לא תקין');
 return value+'-01';
}
function nextMonth(date){const d=new Date(date+'T12:00:00Z');d.setUTCMonth(d.getUTCMonth()+1);return d.toISOString().slice(0,7)}
function electricityMonths(start,end){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))throw Error('תאריכי צריכה חסרים');
 const s=new Date(start+'T12:00:00Z'),e=new Date(end+'T12:00:00Z');
 if(!Number.isFinite(s.getTime())||!Number.isFinite(e.getTime())||s.toISOString().slice(0,10)!==start||e.toISOString().slice(0,10)!==end||s>e)throw Error('טווח תאריכים לא תקין');
 const first=nextMonth(start.slice(0,7));
 const second=nextMonth(first);
 const days=(e-s)/86400000;
 if(days<35||days>75)throw Error('תקופת חשמל צריכה להיות בקירוב חודשיים; בדקו את התאריכים');
 return [first,second];
}
function splitAgorot(amount,months){
 const n=Number(amount);if(!Number.isFinite(n)||n<=0||Math.round(n*100)!==n*100&&Math.abs(Math.round(n*100)-n*100)>1e-7)throw Error('סכום לא תקין');
 if(!months.length)throw Error('יש לבחור חודשים');
 const cents=Math.round(n*100),base=Math.floor(cents/months.length),remainder=cents%months.length;
 return months.map((month,i)=>({month:isoMonth(month),amount:((base+(i<remainder?1:0))/100).toFixed(2)}));
}
module.exports={isoMonth,electricityMonths,splitAgorot};
