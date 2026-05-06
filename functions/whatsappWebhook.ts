// OOBA v10 - vendedor com historico persistente
import base44 from "npm:@base44/sdk@0.8.25";

const VT = "ooba2026";
const WAT = Deno.env.get("WHATSAPP_TOKEN") || "";
const PID = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") || "118970490080862063";
const OAI = Deno.env.get("OPENAI_API_KEY") || "";
const db = base44.asServiceRole;

const SYS = `Voce e OOBA, vendedor virtual da OOBA Midia Indoor no WhatsApp.
REGRAS: use emojis, NUNCA fale preco primeiro, mensagens curtas max 3 linhas estilo WhatsApp, NUNCA reinicie a conversa - continue de onde parou, se cliente ja disse que usa radio/facebook/outdoor nao pergunte de novo avance, se resistir aprofunde nao recomece, responda em portugues do Brasil.
PRIMEIRA MENSAGEM: apresente-se e pergunte qual marketing usa hoje.
FLUXO: 1 apresentacao mais pergunta marketing 2 valide mais indoor como complemento 3 diferenciais com dados 4 pergunte sobre negocio 5 proposta e precos 6 fechamento.
DADOS: 1h no local, video 15s aparece 6-7x, roda 6h meia-noite, OOH mais 123% 2017-2024, mais 70mil pessoas por mes.
OUTDOOR vs INDOOR: outdoor alcance rapido, indoor fixacao e repeticao, pessoa parada presta mais atencao.
PONTOS: Sueli PF 18300 por mes, Academia R2 13240 por mes, Moncoes 10500 por mes, Rocks 10900 por mes, Araras 9800 por mes, Sueli Boituva 15100 por mes.
PRECOS somente apos gerar valor: 1pt R400 mes R200 anual, 2pt R550 R450, 3pt R650 R550, 4pt R750 R650, 5pt mais R850.
BONUS ANUAL: mais 3pts rodizio, mais 5pts 1video gratis mais carrossel.
CONTATO FINAL: 11 92127-6113, contato@ooba.com.br, www.ooba.com.br.`;

async function getHist(phone: string) {
  try {
    const rs = await db.entities.ConversationHistory.filter({phone});
    if (rs?.length > 0) {
      const msgs = JSON.parse(rs[0].messages || "[]");
      console.log(`HIT ${phone}: ${msgs.length}msgs`);
      return {id: rs[0].id, msgs};
    }
  } catch(e) { console.error("getHist:", String(e)); }
  console.log(`NEW ${phone}`);
  return {id: undefined, msgs: [] as {role:string,content:string}[]};
}

async function saveHist(phone: string, id: string|undefined, msgs: {role:string,content:string}[]) {
  try {
    const p = {phone, messages: JSON.stringify(msgs.slice(-20))};
    if (id) { await db.entities.ConversationHistory.update(id, p); console.log(`UPD ${phone}`); }
    else { const r = await db.entities.ConversationHistory.create(p); console.log(`CRT ${phone} ${r?.id}`); }
  } catch(e) { console.error("saveHist:", String(e)); }
}

async function sendMsg(to: string, body: string) {
  const r = await fetch(`https://graph.facebook.com/v19.0/${PID}/messages`, {
    method:"POST", headers:{"Authorization":`Bearer ${WAT}`,"Content-Type":"application/json"},
    body: JSON.stringify({messaging_product:"whatsapp",to,type:"text",text:{body}}),
  });
  const d = await r.json();
  console.log("WA send:", d?.messages?.[0]?.id || JSON.stringify(d));
}

async function replyAI(txt: string, phone: string) {
  const {id, msgs} = await getHist(phone);
  msgs.push({role:"user", content:txt});
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST", headers:{"Authorization":`Bearer ${OAI}`,"Content-Type":"application/json"},
    body: JSON.stringify({model:"gpt-4o-mini", messages:[{role:"system",content:SYS},...msgs], max_tokens:350, temperature:0.7}),
  });
  const d = await r.json();
  const rep = d?.choices?.[0]?.message?.content?.trim() || "";
  if (rep) { msgs.push({role:"assistant",content:rep}); await saveHist(phone,id,msgs); }
  else console.error("NO_REPLY:", JSON.stringify(d).substring(0,200));
  return rep;
}

Deno.serve(async (req) => {
  try {
    if (req.method==="GET") {
      const u = new URL(req.url);
      if (u.searchParams.get("hub.mode")==="subscribe" && u.searchParams.get("hub.verify_token")===VT)
        return new Response(u.searchParams.get("hub.challenge"),{status:200});
      return new Response("Forbidden",{status:403});
    }
    if (req.method==="POST") {
      const b = await req.json();
      const v = b?.entry?.[0]?.changes?.[0]?.value;
      if (v?.statuses) return Response.json({ok:true});
      const m = v?.messages?.[0];
      if (!m||m.type!=="text") return Response.json({ok:true});
      const from = m.from, txt = m?.text?.body?.trim()||"";
      if (!from||!txt) return Response.json({ok:true});
      console.log(`IN ${from}: ${txt}`);
      const rep = await replyAI(txt, from);
      if (rep) await sendMsg(from, rep);
      return Response.json({ok:true});
    }
    return Response.json({error:"method"},{status:405});
  } catch(e) { console.error("ERR:",e); return Response.json({error:String(e)},{status:500}); }
});
