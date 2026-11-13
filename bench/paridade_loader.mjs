// Paridade do loader (src/loader.js) com o motor sobre o dicionário inteiro, em dados reais.
// Fatia o dicionário de um município do recorte do benchmark como pipeline/gerar_indice.py faz
// (50 mil entradas por fatia), serve os arquivos de um Map e compara as 150 consultas x 3 formas.
//
// Uso: node bench/paridade_loader.mjs <pasta do benchmark> <cod IBGE> <UF>
import { readFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import * as G from "../src/index.js";
const D=(process.argv[2]||".").replace(/\/?$/,"/");
const COD=process.argv[3]||"5300108", UF=process.argv[4]||"DF";
const dic=JSON.parse(gunzipSync(readFileSync(D+`dicionarios/${COD}.json.gz`)));
const csv=readFileSync(D+"amostra.csv","utf8").split("\n"); const cab=csv[0].split(",");
const linhas=csv.slice(1).filter(l=>l.includes(`,${COD},`)).map(l=>{const v=[];let f="",a=false;for(const ch of l){if(ch=='"'){a=!a}else if(ch==","&&!a){v.push(f);f=""}else f+=ch}v.push(f);return Object.fromEntries(cab.map((c,i)=>[c,v[i]]))});
// fatiamento igual ao pipeline: chaves ordenadas, 50k entradas por fatia
const chaves=Object.keys(dic); const vias={},partes=[]; let f=0,ac=0;
for(const k of chaves){const n=dic[k].length; if(ac&&ac+n>50000){f++;ac=0} vias[k]=[f,n]; (partes[f]??={})[k]=dic[k]; ac+=n}
const cb=G.construirIndiceCepBairro({x:dic}).x, ceps={};
for(const k of chaves) for(const e of dic[k]) if(e.c){const c=(ceps[e.c]??=[cb[e.c]||"",0,[]]);c[1]++;if(!c[2].includes(vias[k][0]))c[2].push(vias[k][0])}
const cent=G.centroide(chaves.flatMap(k=>dic[k])); const entradas=chaves.reduce((s,k)=>s+dic[k].length,0);
const arq=new Map(); const put=(p,o)=>{const b=gzipSync(Buffer.from(JSON.stringify(o)));arq.set(p,b);return{nome:p.split("/").pop(),sha256:createHash("sha256").update(b).digest("hex")}};
const fs=[put(`${UF}/${COD}/index.json.gz`,{v:1,cod:COD,entradas,fatias:partes.length,centroide:[cent.lat,cent.lon],vias,ceps})];
partes.forEach((p,i)=>fs.push(put(`${UF}/${COD}/f${String(i).padStart(3,"0")}.json.gz`,p)));
arq.set("manifesto.json",Buffer.from(JSON.stringify({municipios:{[COD]:{uf:UF,tipo:"fatiado",entradas,arquivos:fs}}})));
console.log("fatias",partes.length,"index KB",(arq.get(`${UF}/${COD}/index.json.gz`).length/1e3).toFixed(0),"maior fatia KB",Math.max(...partes.map((_,i)=>arq.get(`${UF}/${COD}/f${String(i).padStart(3,"0")}.json.gz`).length))/1e3);
const idx={[COD]:dic}; const opts={blocking:G.construirBlockingIndex(idx),cepIndex:G.construirIndiceCep(idx),cache:new Map(),totalPontosPorMunicipio:{[COD]:entradas},centroideMunicipio:cent}; opts.cepBairroIndex=G.construirIndiceCepBairro(idx,opts.cepIndex);
let dif=0,n=0,bytes=[],fats=[];
for(const r of linhas){ const via=[r.tipo,r.titulo,r.nome].filter(Boolean).join(" "); const temN=r.num&&r.num!=="0"&&r.modificador!=="SN";
  const comp=temN?`, ${r.num}`:([r.quadra&&`Qd ${r.quadra}`,r.lote&&`Lt ${r.lote}`].filter(Boolean).length?", "+[r.quadra&&`Qd ${r.quadra}`,r.lote&&`Lt ${r.lote}`].filter(Boolean).join(" "):"");
  for(const [end,b,c] of [[via+comp,r.bairro,r.cep],[via+comp,"",""],[via,r.bairro,r.cep]]){
    const pedidos=[]; const g=G.criarGeocodificador({base:"https://x/",fetch:async u=>{const p=u.replace("https://x/","");pedidos.push(p);return new Response(arq.get(p))}});
    const a=G.geocodificar({codMunicipio:COD,enderecoCru:end,bairro:b,cepConsulta:c},idx,opts); const z=await g.geocodificar(end,{municipio:COD,bairro:b,cep:c}); n++;
    if(a.status!==z.status||a.viaKey!==z.viaKey||Math.abs(a.coord.lat-z.coord.lat)>1e-9){dif++; if(dif<6) console.log("DIF",end,b,c,a.status,a.viaKey,"|",z.status,z.viaKey)}
    const fp=pedidos.filter(p=>/f\d+/.test(p)); fats.push(fp.length); bytes.push(pedidos.filter(p=>p!=="manifesto.json").reduce((s,p)=>s+arq.get(p).length,0));
  }}
bytes.sort((x,y)=>x-y); fats.sort((x,y)=>x-y);
console.log(`consultas ${n}, diferenças ${dif}; fatias por consulta mediana ${fats[n>>1]} max ${fats[n-1]}; KB por consulta (frio) mediana ${(bytes[n>>1]/1e3).toFixed(0)} p90 ${(bytes[Math.floor(n*.9)]/1e3).toFixed(0)} max ${(bytes[n-1]/1e3).toFixed(0)}`);
