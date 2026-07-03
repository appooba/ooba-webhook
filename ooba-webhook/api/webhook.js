// ══════════════════════════════════════════════════════════════
// 🔒 BLOCO TRAVADO — NÃO MODIFICAR
// getTelasDisponiveis — dados hardcoded de todas as telas OOBA
// Qualquer alteração aqui afeta o catálogo inteiro enviado ao lead
// Aprovado em: 13/06/2026
// ══════════════════════════════════════════════════════════════

// Lock anti-processamento concorrente por telefone
const _processingLocks = new Map();
function acquireLock(phone) {
  if (_processingLocks.has(phone)) return false;
  _processingLocks.set(phone, Date.now());
  return true;
}
function releaseLock(phone) {
  _processingLocks.delete(phone);
}

async function getTelasDisponiveis(negocio, cidade) {
  // Versão data-driven: lê telas e conflitos do banco (Neon Postgres)
  // Mudou tela? INSERT no banco. Nova regra de conflito? INSERT. Zero deploy.
  return await getTelasFiltradas(negocio, cidade);
}

// ══════════════════════════════════════════════════════════════
// 🔒 BLOCO TRAVADO — NÃO MODIFICAR
// enviarCatalogoTelas — fluxo oficial de apresentação das telas
// Ordem: conceito de pontos → gancho total → cada tela (texto + URL sozinha) → resumo + CTA
// Aprovado em: 13/06/2026
// ══════════════════════════════════════════════════════════════
async function enviarCatalogoTelas(from, lead, delay = 1500, client = null) {
  const telas = await getTelasDisponiveis(lead.negocio, lead.cidade);
  const cidade = lead.cidade || null;
  if (!cidade) {
    await sendMsg(from, await getMsg("msg_pedir_cidade", {}, client, from));
    return;
  }

  // PASSO 1 — Explicar como funciona (conceito de ponto) — SÓ se ainda não foi explicado antes
  let jaExplicouPontos = false;
  if (client && lead) {
    try {
      // Verificar pela etapa do funil — mais confiável que procurar strings no histórico
      const etapaAtual = lead.etapa_funil || "abertura";
      jaExplicouPontos = ["educacao", "aguardando_catalogo", "recomendacao", "materiais", "fechamento", "proposta"].includes(etapaAtual);
      // Backup: também checar marcadores no histórico (para leads que vieram de fluxos antigos)
      if (!jaExplicouPontos) {
        const histCat = await getHist(client, from);
        jaExplicouPontos = histCat.some(m => m.role === "assistant" &&
          (m.content?.includes("educação automática") ||
           m.content?.includes("catálogo enviado") ||
           m.content?.includes("catálogo automático") ||
           m.content?.includes("reforço de conceito") ||
           m.content?.includes("compra pontos")));
      }
    } catch(e) {}
  }
  if (!jaExplicouPontos) {
    await sendMsg(from, await getMsg("msg_catalogo_explicacao", {}, client, from));
    await new Promise(r => setTimeout(r, delay));
  }

  // PASSO 2 — Gancho de transição com total de giro (direto, sem tabela separada)
  const totalFluxo = telas.reduce((acc, t) => {
    const num = parseInt((t.fluxo || "0").replace(/[^0-9]/g, ""));
    return acc + num;
  }, 0);

  const totalFluxoK = Math.round(totalFluxo/1000).toString();
  await sendMsg(from, await getMsg("msg_catalogo_total", {cidade: cidade, total_telas: telas.length.toString(), total_fluxo_k: totalFluxoK}, client, from));
  await new Promise(r => setTimeout(r, delay));

  // PASSO 3 — Cada tela: texto com giro PRIMEIRO, depois URL sozinha (gera thumbnail)
  for (const tela of telas) {
    // MSG 1: nome + giro + horário (só texto)
    const msgTela = `📍 *${tela.nome}* — ${tela.fluxo} | ${tela.horario}`;
    await sendMsg(from, msgTela);
    await new Promise(r => setTimeout(r, 1800)); // delay maior para WhatsApp gerar thumbnail

    // MSG 2: URL sozinha na mensagem (WhatsApp gera thumbnail automático)
    if (tela.video) {
      await sendMsg(from, tela.video);
    } else {
      await sendMsg(from, tela.descricao || "🎬 Vídeo em produção");
    }
    await new Promise(r => setTimeout(r, 1800));
  }

  // MENSAGEM FINAL PERSUASIVA — após mostrar tudo, CTA direto sem depender do lead
  await new Promise(r => setTimeout(r, delay));
  const negocioFinal = lead?.negocio || "seu negócio";
  const cidadeFinal = lead?.cidade || null;
  if (!cidadeFinal) return; // sem cidade → não envia catálogo
  const totalFinal = telas.reduce((acc, t) => acc + parseInt((t.fluxo||"0").replace(/[^0-9]/g,"")), 0);

  // MSG FINAL — argumento de cobertura + total de giro + CTA (sem repetir cada tela)
  const totalFinalK = Math.round(totalFinal/1000).toString();
  const msgFinal = await getMsg("msg_catalogo_cta", {total_fluxo_k: totalFinalK, negocio: negocioFinal}, client, from);
  if (msgFinal) await sendMsg(from, msgFinal);

  console.log(`CATÁLOGO TELAS enviado para ${from} — ${telas.length} telas`);
}const { Client } = require("pg");
const { getTelasFiltradas, getAllConfig, getConfig } = require("./db_config");

// ══════════════════════════════════════════════════════════════
// getMsg — busca texto do banco (agent_config) com template vars
// Substitui textos hardcoded. Mudou texto? UPDATE no banco, sem deploy.
// ══════════════════════════════════════════════════════════════
const _msgCache = {};
async function getMsg(key, vars = {}, client = null, leadPhone = null) {
  if (!client) client = await getDB();
  
  // ══ A/B TESTING ══
  // Verificar se existe teste A/B ativo para esta key
  if (leadPhone) {
    try {
      const testR = await client.query(
        "SELECT id, status FROM ab_tests WHERE config_key=$1 AND status='active' LIMIT 1", [key]
      );
      if (testR.rows.length > 0) {
        const testId = testR.rows[0].id;
        
        // Verificar se o lead já foi atribuído a uma variante
        const assignR = await client.query(
          "SELECT variant_id FROM ab_test_assignments WHERE test_id=$1 AND lead_phone=$2", [testId, leadPhone]
        );
        
        let variantId, variantContent;
        if (assignR.rows.length > 0) {
          // Lead já tem variante — usar a mesma
          variantId = assignR.rows[0].variant_id;
          const varR = await client.query("SELECT content FROM ab_test_variants WHERE id=$1", [variantId]);
          variantContent = varR.rows[0]?.content;
        } else {
          // Atribuir variante aleatoriamente (distribuição equilibrada)
          const variantsR = await client.query(
            "SELECT id, content FROM ab_test_variants WHERE test_id=$1 ORDER BY assigned_count ASC", [testId]
          );
          if (variantsR.rows.length > 0) {
            // Pegar a variante com menos atribuições (balanceamento)
            const chosen = variantsR.rows[0];
            variantId = chosen.id;
            variantContent = chosen.content;
            
            // Registrar atribuição
            await client.query(
              "INSERT INTO ab_test_assignments (test_id, variant_id, lead_phone) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
              [testId, variantId, leadPhone]
            );
            await client.query(
              "UPDATE ab_test_variants SET assigned_count = assigned_count + 1 WHERE id=$1", [variantId]
            );
            console.log(`A/B test [${key}]: lead ${leadPhone} → variante ${variantId}`);
          }
        }
        
        if (variantContent) {
          // Aplicar template vars na variante
          let text = variantContent;
          for (const [k, v] of Object.entries(vars)) {
            text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
          }
          return text;
        }
      }
    } catch(e) { console.error("A/B test error:", e.message); }
  }
  // ══ FIM A/B TESTING ══
  
  // Cache em memória (por request serverless)
  if (_msgCache[key]) {
    let text = _msgCache[key];
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
    }
    return text;
  }
  
  // Buscar do banco (fallback: texto padrão)
  try {
    const r = await client.query("SELECT value FROM agent_config WHERE key=$1", [key]);
    if (r.rows.length > 0) {
      _msgCache[key] = r.rows[0].value;
      let text = r.rows[0].value;
      for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`{{${k}}}`, 'g'), v);
      }
      return text;
    }
  } catch(e) { console.error("getMsg error:", key, e.message); }
  return null;
}



// ── Body parser manual para Vercel Serverless ──
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", chunk => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch(e) { resolve({}); }
    });
    req.on("error", reject);
  });
}

const VT = "ooba2026";
const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const OAI_KEY = process.env.OPENAI_API_KEY || "";
const DATABASE_URL = process.env.DATABASE_URL || "";
const B44_FUNC_URL = "https://vendedor-ooba-77e0e07d.base44.app/functions/agendarReuniao";
const B44_SLOTS_URL = "https://vendedor-ooba-77e0e07d.base44.app/functions/getSlots";
const B44_API_KEY = process.env.BASE44_API_KEY || "";

// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// TEXT-TO-SPEECH — Luana manda áudio como humano
// ═══════════════════════════════════════════════════════

// Converter texto para áudio usando OpenAI TTS
async function textToSpeech(text) {
  try {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OAI_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "tts-1",
        voice: "nova",
        input: text,
        response_format: "opus"
      })
    });
    if (!res.ok) {
      console.error("TTS error:", await res.text());
      return null;
    }
    const buffer = await res.arrayBuffer();
    return Buffer.from(buffer);
  } catch(e) {
    console.error("TTS exception:", e.message);
    return null;
  }
}

// Upload do áudio para o WhatsApp Media API
async function uploadAudioToWhatsApp(audioBuffer) {
  try {
    const FormData = require("form-data");
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", "audio/ogg");
    form.append("file", audioBuffer, {
      filename: "audio.ogg",
      contentType: "audio/ogg; codecs=opus"
    });

    const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${WAT}`,
        ...form.getHeaders()
      },
      body: form
    });
    const d = await res.json();
    if (d?.error) { console.error("Upload audio error:", JSON.stringify(d.error)); return null; }
    console.log("Audio uploaded, media_id:", d.id);
    return d.id;
  } catch(e) {
    console.error("Upload audio exception:", e.message);
    return null;
  }
}

// Enviar áudio pelo WhatsApp usando media_id
async function sendAudio(to, mediaId) {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "audio",
        audio: { id: mediaId }
      })
    });
    const d = await res.json();
    if (d?.error) { console.error("Send audio error:", JSON.stringify(d.error)); return false; }
    console.log("Audio sent to", to);
    return true;
  } catch(e) {
    console.error("Send audio exception:", e.message);
    return false;
  }
}

// Responde em áudio se o lead mandou áudio nessa mensagem
// Lógica: espelha o comportamento do lead — simples e natural
function deveMandarAudio(tipoMensagemRecebida) {
  return tipoMensagemRecebida === "audio" || tipoMensagemRecebida === "voice";
}

// Limpar texto para áudio (sem links, emojis, markdown ou marcadores)
function limparParaAudio(texto) {
  return texto
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/\[FUNIL:[^\]]+\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


// ETAPAS DO FUNIL
// ═══════════════════════════════════════════════════════
// 1. abertura       → Apresentação e entender marketing atual
// 2. entendimento   → Descobrir negócio, público, cidade
// 3. apresentacao   → Explicar pontos, telas, exposição, diferenciais
// 4. recomendacao   → Indicar telas ideais para o perfil + enviar vídeos
// 5. materiais      → Enviar apresentação institucional + contrato
// 6. proposta       → Apresentar preços e planos
// 7. fechamento     → Superar objeções e fechar / encaminhar para Paulo
// 8. reuniao        → Aguardando reunião com Paulo
// 9. fechado        → Contrato assinado ✅
// 10. perdido       → Lead desistiu ❌

const LINK_APRESENTACAO_INSTITUCIONAL = "https://media.base44.com/files/public/69f645345c37a4db77e0e07d/5b2eabf2a_5aad73535_ApresentaoOOBAMidiaIndoor.pdf";

// ══════════════════════════════════════════════════════════════
// HUMANIZAÇÃO — delay realista antes de enviar resposta
// Simula tempo de leitura + digitação como uma pessoa real
// ══════════════════════════════════════════════════════════════
function humanDelay(text) {
  if (!text) return 1500;
  const palavras = text.split(/\s+/).length;
  // Base: 1.5s de "leitura" + ~300ms por palavra digitada (média de 200 chars/min)
  const base = 1200 + Math.random() * 800; // 1.2-2s de leitura/pensando
  const digitando = palavras * (250 + Math.random() * 150); // 250-400ms por palavra
  const max = 8000; // teto de 8s pra não ficar lento demais
  return Math.min(base + digitando, max);
}

// System prompt base — lido do banco (agent_config key: system_prompt_base)
let _cachedSysPrompt = null;
let _cachedBloqueioPreco = null;
async function getSysPrompt(client) {
  if (_cachedSysPrompt) return _cachedSysPrompt;
  const r = await client.query("SELECT value FROM agent_config WHERE key='system_prompt_base_v2'");
  if (r.rows.length > 0) {
    _cachedSysPrompt = r.rows[0].value;
    return _cachedSysPrompt;
  }
  return "Você é a Luana, consultora virtual da OOBA Mídia Indoor no WhatsApp.";
}

// ═══════════════════════════════════════════════════════
// INSTRUÇÕES DE FUNIL POR ETAPA
// ═══════════════════════════════════════════════════════
async function getSysWithFunil(client, etapa, leadData, patches = [], insights = []) {
  const nome = leadData.nome ? leadData.nome : "";
  const negocio = leadData.negocio ? leadData.negocio : "";
  const cidade = leadData.cidade || null;
  const telas = leadData.telas_interesse ? leadData.telas_interesse : "";
  const pontos = leadData.pontos_interesse ? leadData.pontos_interesse : "";

  const jaAnunciou = leadData.ja_anunciou
    ? `\n🔁 JÁ FOI CLIENTE: anunciou ${leadData.telas_anunciadas || 'nas telas OOBA'}${leadData.periodo_anuncio ? ' em ' + leadData.periodo_anuncio : ''}.`
    : "";
  const empresaInfo = leadData.empresa
    ? `\n🏢 EMPRESA: ${leadData.empresa}`
    : "";
  const origemInfo = leadData.origem
    ? `\n📍 ORIGEM: ${leadData.origem}`
    : "";
  const isProspeccao = leadData.origem === 'prospeccao';

  const abordagemAtiva = leadData.abordagem_ativa
    ? `\n⚡ ABORDAGEM ATIVA: você iniciou o contato. Seja acolhedora e desperte curiosidade.`
    : "";

  // Montar detalhamento de pontos por tela
  let detalhePontos = "";
  if (leadData.pontos_por_tela && typeof leadData.pontos_por_tela === "object") {
    const ppt = leadData.pontos_por_tela;
    const linhas = Object.entries(ppt).map(([t, p]) => `  ${t}: ${p} ponto(s)`).join("\n");
    const totalPts = Object.values(ppt).reduce((a, b) => a + Number(b), 0);
    detalhePontos = `\nPONTOS POR TELA:\n${linhas}\nTOTAL: ${totalPts} pontos`;
  } else if (pontos) {
    detalhePontos = `\nTOTAL DE PONTOS: ${pontos}`;
  }

  const ctx = `
LEAD: ${nome || "(novo)"} | Negócio: ${negocio || "?"} | Cidade: ${cidade || "NÃO INFORMADA — pergunte antes de mostrar catálogo"} | Telas escolhidas: ${telas || "?"}${detalhePontos}${jaAnunciou}${empresaInfo}${origemInfo}${abordagemAtiva}
ETAPA ATUAL: ${etapa.toUpperCase()}
${isProspeccao && etapa === 'abertura' ? '⚠️ PROSPECÇÃO ATIVA: Você já iniciou o contato e se apresentou no template. NÃO se reapresente. NÃO pergunte "qual mídia você usa". Já pule pra entender o negócio.' : ''}

REGRA DE PREÇO: quando o lead escolher pontos por tela, SOME TUDO e mostre apenas o preço do total.
Ex: 2 pontos Sueli + 2 pontos Bonfá = 4 pontos total → mensal R$750/mês | anual R$650/mês

⚠️ MEMÓRIA DE ESCOLHA: Se o lead já escolheu telas/pontos (campo "Telas escolhidas" acima NÃO está vazio), NUNCA reenvie o catálogo completo. Em vez disso, REFERENCIE a escolha que ele já fez: "Você tinha escolhido X, Y e Z — lembra?". Se ele perguntar "quais telas?" ou "quais opções?", lembre-o da escolha dele primeiro e só reenvie o catálogo se ele disser explicitamente "quero ver tudo de novo" ou "esqueci, me mostra tudo".
Se o lead disser que esqueceu como funciona, reexplique de forma breve e personalizada com base no que ele já escolheu — não recomece do zero.`;

  const BASE = await getSysPrompt(client);

  const funil = {
    abertura: `
VOCÊ ESTÁ NA ETAPA: ABERTURA
⚠️ NUNCA se apresente novamente se já houver histórico — o lead já sabe quem você é.

Se o lead ainda não respondeu a pergunta sobre marketing/divulgação:
- Pergunte SÓ: "Hoje você já faz algum tipo de marketing? Redes sociais, panfletos, rádio?"
- NUNCA avance sem essa resposta.

Se o lead já respondeu sobre marketing:
- Se respondeu algo (qualquer coisa) → emita [FUNIL:etapa=entendimento]
- Se disse "não faço marketing" → valide e emita [FUNIL:etapa=entendimento]

Se o lead perguntar "como conseguiu meu contato":
- Responda naturalmente: "Trabalho com empresas da região e achei que a OOBA podia fazer sentido pra você 😊"
- NÃO explique prospecção fria nem dê detalhes técnicos.

Se o lead perguntar preço nesta etapa:
- NÃO dê preços. Diga: "Antes de falar em investimento, preciso entender seu negócio pra te recomendar as telas certas 😊"
- Emita [FUNIL:etapa=entendimento]

[FUNIL:etapa=entendimento]`,

    entendimento: `
VOCÊ ESTÁ NA ETAPA: ENTENDIMENTO
Você já sabe: negócio=${negocio}, cidade=${cidade}

⚠️ REGRA: UMA PERGUNTA POR VEZ. Sequência obrigatória:
- Se não souber a cidade → pergunte SÓ a cidade: "Você é de Porto Feliz ou Boituva?"
  → Marque: [FUNIL:etapa=entendimento;negocio=NEGOCIO] (NÃO avance se não tem cidade!)
- Se souber a cidade → emita [MOSTRAR_CATALOGO] imediatamente com frase de transição
  → Marque: [FUNIL:etapa=recomendacao;negocio=NEGOCIO;cidade=CIDADE]

⛔ NUNCA avance para recomendacao sem saber a cidade.
⛔ NUNCA pergunte objetivo, meta ou o que quer divulgar — o catálogo vem ANTES de qualquer pergunta estratégica.
⛔ NUNCA sugira telas por nome antes do catálogo.
⛔ NUNCA sugira quantos pontos antes do lead ver as telas.
⛔ NUNCA liste telas manualmente — o sistema envia o catálogo automático com vídeos e filtros.
⛔ NUNCA mencione telas bloqueadas (concorrentes diretos) — nem como exemplo, nem com "(não disponível)".
⛔ NUNCA explique por que uma tela está bloqueada — o lead não precisa saber da existência delas.

Quando souber a cidade → frase de transição + [MOSTRAR_CATALOGO]:
"Deixa eu te mostrar as telas disponíveis em [cidade] 👇"
"Olha onde seu anúncio pode aparecer em [cidade] 👇"`,

    apresentacao: `
VOCÊ ESTÁ NA ETAPA: APRESENTAÇÃO
⚠️ Etapa rápida — explique o conceito de ponto em 1 mensagem e já puxe pra recomendação.

MSG ÚNICA:
"Aqui na OOBA funciona por *pontos* — cada ponto é um vídeo de 15 segundos que entra em rotação nas telas. Quanto mais pontos, mais vezes seu anúncio aparece. A mesma pessoa pode ver seu vídeo de 6 a 7 vezes na mesma visita 😊
Deixa eu te mostrar as telas que fazem mais sentido pro seu negócio em ${cidade} 👇"

[FUNIL:etapa=recomendacao]`,

    recomendacao: `
VOCÊ ESTÁ NA ETAPA: RECOMENDAÇÃO

✅ O sistema JÁ ENVIOU automaticamente:
- Explicação de como funciona (pontos, rotação, exposição)
- TODAS as telas disponíveis com fluxo mensal e horários
- Os vídeos de cada tela

SUA TAREFA AGORA: aguardar a reação do lead e responder dúvidas.
O lead acabou de ver as telas e os vídeos. Deixe ele processar e ESCOLHER.

Se o lead perguntar algo sobre as telas → responda com naturalidade.
Se o lead perguntar sobre preço → apresente a tabela.
Se o lead escolher uma tela → siga com o fluxo de fechamento.
Se o lead demonstrar interesse → pergunte qual tela faz mais sentido pra ele.

⚠️ PROIBIDO nessa etapa:
- NÃO recomende telas ou pontos — deixe o lead escolher sozinho
- NÃO sugira combinações ou planos sem o lead pedir
- NÃO explique o que é ponto novamente
- NÃO liste as telas novamente
- NÃO force fechamento — o lead precisa de espaço para absorver

Quando o lead PEDIR sugestão ("qual você indica?", "qual é melhor?") → aí sim faça com dados:
"Pra [negócio] em [cidade], minha indicação são [N] pontos em [tela1] + [tela2] — [X] mil pessoas/mês 🔥"

Quando o lead perguntar preço → apresente os planos mensal e anual com os valores corretos.

[FUNIL:etapa=materiais]
`,

    materiais: `
VOCÊ ESTÁ NA ETAPA: MATERIAIS
O lead já viu os vídeos e demonstrou interesse. Hora de enviar a apresentação.

NÃO peça permissão — já envie:
"Preparei a apresentação completa com todos os planos 👇"
---MSG---
{{LINK_APRESENTACAO_VALORES}}
---MSG---
"Dá uma olhada e me fala — você prefere o mensal sem fidelidade ou já aproveita o desconto de 22% no anual?"

[FUNIL:etapa=proposta]`,

    proposta: `
VOCÊ ESTÁ NA ETAPA: PROPOSTA/VALORES

TABELA DE PREÇOS (use para calcular):
{{TABELA_PRECOS_MENSAL}}
{{TABELA_PRECOS_ANUAL}}

REGRA CRÍTICA DE CÁLCULO:
- Se o lead escolheu telas específicas com pontos (ex: "2 na Sueli e 2 no Bonfá"), SOME O TOTAL.
  2 + 2 = 4 pontos → mensal R$750/mês | anual R$650/mês
- Use SEMPRE o total de pontos do LEAD para mostrar o preço, não a tabela inteira.
- NUNCA mostre a tabela completa se o lead já escolheu os pontos — mostre só o preço dele.

COMO APRESENTAR se o lead já tem um total definido:
"[Nome], com [X] pontos no total — [detalhe por tela] — fica assim:
📅 *Mensal*: R$[VALOR]/mês (sem fidelidade)
📆 *Anual*: R$[VALOR]/mês (22% de desconto[+ vídeo grátis se ≥5 pontos])

Qual você prefere? Já preparo o contrato 😊"

COMO APRESENTAR se o lead ainda não definiu o total (mostrar tabela resumida):
MSG 1:
"📅 *Plano Mensal* (sem fidelidade):
{{TABELA_PRECOS_MENSAL_FORMATADA}}"
---MSG---
MSG 2:
"📆 *Plano Anual* (22% de desconto):
{{TABELA_PRECOS_ANUAL_FORMATADA}}"
---MSG---
MSG 3:
"Com quantos pontos você quer começar? Já calculo exatamente pra você 😊"

BÔNUS (lembrar sempre):
- 5+ pontos no anual: 1º vídeo grátis + 2 vídeos em carrossel 🎁
- Menos de 5: cliente traz o vídeo OU OOBA produz por valor adicional

[FUNIL:etapa=fechamento]
`,
    fechamento: `
VOCÊ ESTÁ NA ETAPA: FECHAMENTO

⚠️ REGRA CRÍTICA: Se o lead JÁ ACEITOU o plano (disse "vou querer", "fechado", "topo", "pode mandar", "quero"), NÃO envie mais materiais, apresentações ou tabelas de preço. Vá DIRETO para: "Perfeito! Me passa seu e-mail que eu já preparo o contrato 😊" — só peça o e-mail e aguarde.

PASSO 1 — Envie o contrato e PUXE O FECHAMENTO na mesma mensagem:
"Manda o contrato pra você dar uma olhada 😊 🔹CONTRATO_PDF🔹"
O sistema vai enviar o PDF automaticamente. NÃO inclua o link do contrato em texto — apenas o marcador 🔹CONTRATO_PDF🔹.
Após o marcador, na mesma mensagem, pergunte diretamente: "O contrato ficou claro? Quer seguir com plano mensal ou anual? Assim que confirmar eu já ativo pra você 🚀"
NUNCA diga "se tiver dúvida me chame" ou "qualquer coisa é só falar" — isso é passivo e mata o momentum. SEMPRE faça uma pergunta que exige resposta.

PASSO 1B — Se o lead disser "obrigado", "valeu", "valeu demais", "obrigada" depois de receber o contrato → NÃO responda "de nada" ou "se precisar é só chamar". Responda puxando o fechamento: "Disponha! 😊 O contrato ficou tranquilo pra você? Quer seguir com mensal ou anual?" — SEMPRE faça uma pergunta de fechamento.

PASSO 2 — Se o lead hesitar UMA VEZ com preço → use argumento de ROI, UMA VEZ SÓ:
"Com [X] pontos você alcança [Y] mil pessoas por mês. Basta 1 cliente novo por mês pra pagar o investimento — e nas nossas telas a chance disso é alta 😊"

PASSO 3 — A reunião é o ÚLTIMO RECURSO, não a primeira saída. Só proponha reunião se:
- O lead disser "não quero", "muito caro", "não sei", "deixa pra depois", "vou pensar", "depois eu falo com você"
- O lead tentar encerrar a conversa explicitamente
- O lead não responder após 2 tentativas de fechamento
NUNCA proponha reunião se o lead ainda estiver engajado, fazendo perguntas, ou mostrando interesse em fechar. Se o lead diz "obrigado" depois de ver o contrato, ele NÃO está recusando — está em momento de decisão. PUXE O FECHAMENTO, não ofereça reunião.

Quando fizer sentido propor reunião:
"Entendo! Antes de encerrar, tenho um especialista da equipe OOBA que consegue montar uma proposta personalizada pra você — sem compromisso, 15 minutinhos pelo Google Meet. Topa?"

⛔ PROIBIDO no passo 3:
- NÃO use mais argumentos de preço
- NÃO tente convencer com ROI
- NÃO ofereça desconto
- NÃO pergunte "por que?" — aceite a resposta e proponha a reunião

PASSO 4 — Se o lead aceitar a reunião → aguarde o sistema enviar os slots automaticamente.
PASSO 4 — Se o lead recusar a reunião também → encerre com elegância:
"Sem problemas! Se mudar de ideia, é só me chamar 😊 Qualquer novidade eu te aviso."

Se hesitar após 2 tentativas suas → acione Paulo:
{{SLOTS_CALENDAR}}
"Que tal a gente marcar 15 minutos pelo Google Meet? Sem compromisso — consigo montar uma proposta do zero pro seu perfil. Qual dia e horário fica melhor pra você? 📅"`,
  };

  const instrucaoEtapa = funil[etapa] || funil.abertura;

  // ── Injetar configuração do banco (preços, bônus, links, contrato, etc.) ──
  const config = await getAllConfig();
  let prompt = BASE + instrucaoEtapa;
  
  // Injetar tabela de preços do banco nos placeholders
  const precosJson = await getConfig(client, "tabela_precos_json");
  if (precosJson) {
    try {
      const precos = JSON.parse(precosJson);
      // Formato compacto (para referência do GPT)
      const mensalCompact = "Mensal: " + Object.entries(precos.mensal).map(([p,v]) => `${p}pt=R$${v}`).join(" | ");
      const anualCompact = "Anual (-22%): " + Object.entries(precos.anual).map(([p,v]) => `${p}pt=R$${v}`).join(" | ");
      // Formato formatado (para exibição)
      const mensalFmt = "• 1 ponto → R$ " + precos.mensal["1"] + "/mês | 2 pontos → R$ " + precos.mensal["2"] + " | 3 pontos → R$ " + precos.mensal["3"] + "\n• 4 pontos → R$ " + precos.mensal["4"] + " | 5 pontos → R$ " + precos.mensal["5"] + " | 10 pontos → R$ " + precos.mensal["10"] + "/mês";
      const anualFmt = "• 1 ponto → R$ " + precos.anual["1"] + "/mês | 2 pontos → R$ " + precos.anual["2"] + " | 3 pontos → R$ " + precos.anual["3"] + "\n• 4 pontos → R$ " + precos.anual["4"] + " | 5 pontos → R$ " + precos.anual["5"] + " ✅ vídeo grátis | 10 pontos → R$ " + precos.anual["10"] + "/mês ✅";
      
      prompt = prompt.split("{{TABELA_PRECOS_MENSAL}}").join(mensalCompact)
                         .split("{{TABELA_PRECOS_ANUAL}}").join(anualCompact)
                         .split("{{TABELA_PRECOS_MENSAL_FORMATADA}}").join(mensalFmt)
                         .split("{{TABELA_PRECOS_ANUAL_FORMATADA}}").join(anualFmt);
    } catch(e) { console.log("Erro ao injetar preços:", e.message); }
  }

  // ── Injetar slots reais do Calendar quando a etapa envolver reunião ──
  if (etapa === 'reuniao' || etapa === 'proposta' || etapa === 'fechamento') {
    try {
      const { texto: slotsTexto } = await buscarSlotsDisponiveis();
      if (slotsTexto) {
        prompt = prompt.replace("{{SLOTS_CALENDAR}}", slotsTexto);
      }
    } catch(e) { console.error("Slots injection:", e.message); }
  }
  prompt = prompt.replace("{{SLOTS_CALENDAR}}", "");

  if (config.tabela_precos) prompt = prompt.replace('{{TABELA_PRECOS}}', config.tabela_precos);
  if (config.tabela_precos) prompt = prompt.replace('{{TABELA_PRECOS_COMPACTA}}', config.tabela_precos.replace(/\|/g, ' ').replace(/\s+/g, ' ').trim());
  if (config.bonus_anual) prompt = prompt.replace('{{BONUS_ANUAL}}', config.bonus_anual);
  // Substituir TODAS as ocorrências dos links (podem aparecer múltiplas vezes no prompt)
  const linkContrato = config.link_contrato || "";
  const linkApresValores = config.link_apresentacao_valores || "";
  prompt = prompt.split('{{LINK_CONTRATO}}').join(linkContrato);
  prompt = prompt.split('{{LINK_APRESENTACAO_VALORES}}').join(linkApresValores);

  // Resumo do contrato SEMPRE disponível — Luana usa pra responder dúvidas sem inventar valores
  if (config.contrato_resumo) {
    prompt += `\n\n═══════════════════════════════════\n${config.contrato_resumo}\n═══════════════════════════════════\nSe o lead pedir pra ver o contrato ("manda o contrato", "quero ver o contrato", "como funciona o cancelamento", etc.), inclua o marcador 🔹CONTRATO_PDF🔹 na sua resposta — o sistema envia o PDF automaticamente como anexo. NUNCA mande o link em texto. Use este resumo pra responder dúvidas sobre cláusulas. NUNCA invente cláusulas que não estão nesse resumo.`;
  }

  return prompt;
}


// ═══════════════════════════════════════════════════════
// BANCO DE DADOS
// ═══════════════════════════════════════════════════════
async function getDB() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function initDB(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      phone VARCHAR(50) PRIMARY KEY,
      messages TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS leads (
      phone VARCHAR(50) PRIMARY KEY,
      first_message TEXT,
      nome VARCHAR(255),
      email VARCHAR(255),
      negocio VARCHAR(255),
      cidade VARCHAR(255),
      etapa_funil VARCHAR(50) DEFAULT 'abertura',
      telas_interesse TEXT,
      pontos_interesse INTEGER,
      pontos_por_tela TEXT,
      plano_interesse VARCHAR(50),
      reuniao_data VARCHAR(100),
      reuniao_hora VARCHAR(20),
      objecoes TEXT,
      score INTEGER DEFAULT 0,
      status VARCHAR(50) DEFAULT 'novo',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Garantir coluna pontos_por_tela em banco existente
  await client.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS pontos_por_tela TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS empresa VARCHAR(255);
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS ja_anunciou VARCHAR(50);
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS origem VARCHAR(50) DEFAULT 'inbound';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS prospeccao_data TIMESTAMP;
  `).catch(() => {});
}

async function getHist(client, phone) {
  try {
    const r = await client.query("SELECT messages FROM conversations WHERE phone=$1", [phone]);
    if (r.rows.length > 0) {
      const msgs = JSON.parse(r.rows[0].messages);
      console.log(`DB: ${msgs.length} msgs para ${phone}`);
      return msgs;
    }
  } catch(e) { console.error("getHist:", e.message); }
  return [];
}

async function saveHist(client, phone, msgs) {
  try {
    await client.query(`
      INSERT INTO conversations (phone, messages, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (phone) DO UPDATE SET messages=$2, updated_at=NOW()
    `, [phone, JSON.stringify(msgs.slice(-60))]);
  } catch(e) { console.error("saveHist:", e.message); }
}

async function getLead(client, phone) {
  try {
    const r = await client.query("SELECT * FROM leads WHERE phone=$1", [phone]);
    if (r.rows.length > 0) return r.rows[0];
  } catch(e) { console.error("getLead:", e.message); }
  return null;
}

async function upsertLead(client, phone, firstMsg, updates = {}) {
  try {
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      // Apenas criar se não existir
      const insertResult = await client.query(`
        INSERT INTO leads (phone, first_message, etapa_funil, updated_at)
        VALUES ($1, $2, 'abertura', NOW())
        ON CONFLICT (phone) DO NOTHING
        RETURNING (xmax = 0) AS is_new
      `, [phone, firstMsg]);
      
      // ── NOTIFICAÇÃO DE NOVO LEAD via WhatsApp ──
      // Se foi inserção real (não conflito), notifica o dono
      const isNewLead = insertResult?.rows?.[0]?.is_new === true;
      if (isNewLead) {
        const numeroNotificacao = "5511995650925"; // João/dono
        const msgNotifTpl = await getConfig(client, "msg_novo_lead") || '🔔 *Novo lead chegou!*\n\nNúmero: +{{phone}}\nPrimeira mensagem: "{{msg}}"\n\nAcompanhe a conversa no painel 😊';
        const msgNotificacao = msgNotifTpl.split('{{phone}}').join(phone).split('{{msg}}').join((firstMsg || '').slice(0, 80));
        sendMsg(numeroNotificacao, msgNotificacao).catch(e => console.log("Notif erro:", e.message));
      }
    } else {
      // Atualizar campos específicos
      const setClauses = fields.map((f, i) => `${f}=$${i + 2}`).join(", ");
      const values = [phone, ...fields.map(f => updates[f])];
      await client.query(`
        INSERT INTO leads (phone, first_message, etapa_funil, updated_at)
        VALUES ($1, $2, 'abertura', NOW())
        ON CONFLICT (phone) DO UPDATE SET ${setClauses}, updated_at=NOW()
      `, [phone, firstMsg, ...fields.map(f => updates[f])].slice(0, values.length));
      // Update específico mais seguro
      await client.query(
        `UPDATE leads SET ${setClauses}, updated_at=NOW() WHERE phone=$1`,
        [phone, ...fields.map(f => updates[f])]
      );
    }
  } catch(e) { console.error("upsertLead:", e.message); }
}

// ═══════════════════════════════════════════════════════
// LIMPAR MARKDOWN — converte [texto](url) para URL limpa
// WhatsApp só gera thumbnail quando URL está solta no texto
// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// INTERCEPTADOR DE PREÇO ANTECIPADO — bloqueia preço antes do funil
// ═══════════════════════════════════════════════════════
function interceptarPrecoAntecipado(msgLead, lead) {
  if (!msgLead) return null;
  const msg = msgLead.toLowerCase().trim();

  const perguntasPreco = [
    "qual o valor", "quanto custa", "qual o preço", "qual o preco",
    "me fala o preço", "me fala o preco", "qual é o valor", "qual e o valor",
    "valor dos planos", "tabela de preço", "tabela de preco", "quanto fica",
    "qual o investimento", "caro?", "é caro", "e caro", "tem desconto",
    "valor mensal", "valor anual", "quanto por mes", "quanto por mês"
  ];

  const isPerguntaPreco = perguntasPreco.some(p => msg.includes(p));
  if (!isPerguntaPreco) return null;

  // Etapas que já passaram da recomendação — pode falar de preço
  const etapasLiberadas = ['recomendacao', 'materiais', 'proposta', 'fechamento', 'reuniao'];
  const etapaAtual = lead?.etapa_funil || 'abertura';
  if (etapasLiberadas.includes(etapaAtual)) return null;

  // Bloqueio: texto lido do banco (msg_bloqueio_preco)
  const negocio = lead?.negocio || 'seu negócio';
  const negocioRef = negocio !== 'seu negócio' ? `sobre ${negocio}` : 'o seu negócio';
  const perguntaSeq = negocio === 'seu negócio' ? 'qual é o seu negócio e em qual cidade você está?' : 'você já conhece as telas que temos disponíveis?';
  // Fallback caso o banco não responda
  const fallback = `Boa pergunta! Mas antes de falar em investimento, preciso entender melhor ${negocioRef} pra te recomendar as telas certas — o valor só faz sentido quando você souber exatamente quantas pessoas vai alcançar 😊\n\nMe conta: ${perguntaSeq}`;
  // Como esta função é síncrona, usa cache do banco carregado no init
  const tpl = (typeof _cachedBloqueioPreco !== 'undefined' && _cachedBloqueioPreco) ? _cachedBloqueioPreco : fallback;
  return tpl.split('{{negocio_ref}}').join(negocioRef).split('{{pergunta_sequencia}}').join(perguntaSeq);
}

// ═══════════════════════════════════════════════════════
// INTERCEPTADOR DE SAÍDA — impede o lead de escapar sem tentar reunião
// ═══════════════════════════════════════════════════════
function interceptarSaida(msgLead, respostaBot, lead, msgs) {
  if (!msgLead || !respostaBot) return respostaBot;

  const msgLeadLower = msgLead.toLowerCase().trim();
  const respostaLower = respostaBot.toLowerCase();
  const etapa = lead?.etapa_funil || "abertura";

  // Nunca interceptar na etapa inicial se ainda não houve apresentação
  // (evita confundir "obrigado" como primeira mensagem com sinal de saída)
  const numTrocas = (msgs || []).length;

  // Sinais FORTES de saída — interceptar sempre (mínimo 1 troca = lead já foi apresentado)
  const sinaisFortes = [
    "nao quero mais", "não quero mais", "nao quero", "não quero",
    "nao tenho interesse", "não tenho interesse", "sem interesse",
    "nao vou", "não vou", "deixa pra la", "deixa pra lá",
    "nao preciso", "não preciso", "nao serve", "não serve",
    "pode fechar", "encerra", "nao quero saber",
    "tchau", "ate mais", "até mais", "flw", "falou"
  ];

  // Sinais FRACOS de saída — só interceptar se já houver ao menos 4 mensagens trocadas
  // (evita pegar "obrigado" de abertura, "blz" de confirmação, etc.)
  const sinaisFracos = [
    "obrigado", "obrigada", "vlw", "valeu", "blz", "tmj",
    "era só isso", "era isso", "por hora", "por enquanto",
    "ta bom", "tá bom", "ok obrigado", "ok, obrigado",
    "vou pensar", "deixa eu pensar", "vou ver", "vou analisar",
    "qualquer coisa te aviso", "qualquer coisa eu te aviso",
    "depois eu te chamo", "depois te chamo", "depois vejo"
  ];

  const ehSaidaForte = sinaisFortes.some(s => msgLeadLower.includes(s));
  const ehSaidaFraca = sinaisFracos.some(s => msgLeadLower.includes(s));

  // Só intercepta sinal fraco se conversa já tem pelo menos 4 mensagens (2 trocas)
  const ehSaida = ehSaidaForte || (ehSaidaFraca && numTrocas >= 4);
  if (!ehSaida) return respostaBot;

  // Verificar se o bot já está propondo reunião nessa resposta → não duplicar
  const jaPropondoReuniao = [
    "qual dia", "qual horário", "qual horario", "fica bom pra você",
    "me passa seu e-mail", "google meet", "agendar", "15 minutos"
  ].some(s => respostaLower.includes(s));
  if (jaPropondoReuniao) return respostaBot;

  // Não interceptar na etapa abertura com sinal fraco (lead está só chegando)
  if (etapa === "abertura" && ehSaidaFraca) return respostaBot;

  // Remover encerramento passivo do GPT
  let novaResposta = respostaBot;
  const padroesFim = [
    /\s*[Oo]brigad[oa] pelo seu tempo[!.,]?\s*$/,
    /\s*[Ss]ucesso[!.,]?\s*$/,
    /\s*[Aa]té mais[!.,]?\s*$/,
    /\s*[Ff]ico [aà] disposição[!.,]?\s*$/,
    /\s*[Qq]uando precisar[^.!]*[.!]\s*$/,
    /\s*[Ee]starei (por )?aqui[!.,]?\s*$/,
    /\s*[Ee]stou (por )?aqui[!.,]?\s*$/,
    /\s*[Tt]chau[!.,]?\s*$/,
    /\s*[Aa]té logo[!.,]?\s*$/,
    /\s*[Ss]e mudar de ideia[^.!]*[.!]\s*$/,
    /\s*[Tt]enha um ótimo dia[!.,]?\s*$/,
    /\s*[Tt]enha um bom dia[!.,]?\s*$/,
    /\s*[Pp]or aqui[!.,]?\s*$/,
    /\s*[Dd]e nada[!.,]\s*[Qq]ualquer coisa[^.!]*[.!]\s*$/,
    /\s*[Rr]espeito sua decisão[!.,]?\s*$/,
    /\s*[Cc]ompreendo[!.,]?\s*$/
  ];
  for (const p of padroesFim) {
    novaResposta = novaResposta.replace(p, "").trim();
  }
  if (!novaResposta || novaResposta.length < 10) novaResposta = "";

  const oi = lead?.nome ? lead.nome.split(" ")[0] : "";
  const etapasQuentes = ["materiais", "proposta", "fechamento", "recomendacao", "videos"];
  const etapaQuente = etapasQuentes.includes(etapa);

  let sufixo;
  if (etapaQuente) {
    const opcoes = [
      `${oi ? oi + ", a" : "A"}ntes de ir — você chegou até aqui e faz todo sentido pro seu negócio. O que ficou travado? Me conta que eu resolvo agora 🎯`,
      `${oi ? oi + ", q" : "Q"}ue tal a gente marcar 15 minutos pelo Google Meet? Sem compromisso — só pra fechar os detalhes. Qual dia essa semana fica bom? 📅`,
      `${oi ? oi + ", p" : "P"}odemos marcar uma conversa rápida — 15 minutos, sem compromisso, pelo Google Meet. Qual dia e horário funciona? 😊`
    ];
    sufixo = opcoes[Math.floor(Math.random() * opcoes.length)];
  } else {
    const opcoes = [
      `${oi ? oi + ", o" : "O"} que ficou de dúvida? Preço, qual tela ou como funciona? Me fala que eu resolvo agora 🎯`,
      `${oi ? oi + ", q" : "Q"}ue tal a gente marcar 15 minutos pelo Google Meet? Sem compromisso — só pra entender melhor o seu negócio. Qual dia fica bom? 📅`,
      `${oi ? oi + ", b" : "B"}asta 1 cliente novo por mês pra pagar o investimento inteiro. Quer ver como ficaria? Me fala um horário que funciona 🎯`
    ];
    sufixo = opcoes[Math.floor(Math.random() * opcoes.length)];
  }

  const prefixo = novaResposta ? novaResposta + "\n\n" : "";
  return prefixo + sufixo;
}


async function injetarPDF(msgLead, respostaBot, client) {
  if (!msgLead || !respostaBot) return respostaBot;

  const lead = msgLead.toLowerCase();
  const bot = respostaBot.toLowerCase();

  // Detectar pedido de PDF/proposta pelo lead
  const pedindoPDF = [
    "manda o pdf", "manda a proposta", "quero o pdf", "quero a proposta",
    "pode mandar", "manda aqui", "sim, pode mandar", "sim pode mandar",
    "quero sim", "pode sim", "manda", "me manda", "pdf", "proposta"
  ].some(s => lead.includes(s));

  if (!pedindoPDF) return respostaBot;

  // Se a resposta já tem o link do drive → não duplicar
  if (bot.includes("drive.google.com") || bot.includes("apresentação") || bot.includes("apresentacao")) {
    return respostaBot;
  }

  // Injetar o link da apresentação com valores (buscar valor real do banco)
  let linkApresentacao = "https://drive.google.com/file/d/1Gv8p8EHx0K44Z3H4ElDfQNL7bmtLsljq/view?usp=drive_link";
  try {
    if (client) {
      const cfgRes = await client.query("SELECT value FROM agent_config WHERE key='link_apresentacao_valores'");
      if (cfgRes.rows[0]?.value) linkApresentacao = cfgRes.rows[0].value;
    }
  } catch (e) { console.error("injetarPDF: erro ao buscar link do banco:", e.message); }

  return respostaBot.trimEnd() + `

Aqui está 👇
${linkApresentacao}

Qualquer dúvida sobre os valores é só falar 😊`;
}

// ═══════════════════════════════════════════════════════
// DETECTOR DE PREÇO — responde direto sem passar pelo GPT
// ═══════════════════════════════════════════════════════
// Tabela de preços OOBA
// Tabela de preços — carregada do banco (agent_config key: tabela_precos_json)
let TABELA_MENSAL = { 1:400, 2:550, 3:650, 4:750, 5:850, 6:950, 7:1050, 8:1150, 9:1250, 10:1350 };
let TABELA_ANUAL  = { 1:200, 2:450, 3:550, 4:650, 5:750, 6:850, 7:950, 8:1050, 9:1150, 10:1250 };
async function carregarTabelaPrecos(client) {
  const r = await client.query("SELECT value FROM agent_config WHERE key='tabela_precos_json'");
  if (r.rows.length > 0) {
    const p = JSON.parse(r.rows[0].value);
    TABELA_MENSAL = p.mensal;
    TABELA_ANUAL = p.anual;
  }
}

// Detecta se o lead especificou pontos na mensagem
// Ex: "2 pontos na sueli e 2 no bonfá", "quero 4 pontos", "3 pontos"
function extrairTotalPontos(txt) {
  const t = txt.toLowerCase()
    // Converter números por extenso para dígitos
    .replace(/\bdez\b/g, "10")
    .replace(/\bnove\b/g, "9")
    .replace(/\boito\b/g, "8")
    .replace(/\bsete\b/g, "7")
    .replace(/\bseis\b/g, "6")
    .replace(/\bcinco\b/g, "5")
    .replace(/\bquatro\b/g, "4")
    .replace(/\btr[eê]s\b/g, "3")
    .replace(/\bdois\b|\bduas\b/g, "2")
    .replace(/\bum\b|\buma\b/g, "1");

  // Padrão: número + "ponto(s)" em um ou mais trechos — soma tudo
  const matches = [...t.matchAll(/(\d+)\s*pont/g)];
  if (matches.length === 0) return null;
  const total = matches.reduce((sum, m) => sum + parseInt(m[1]), 0);
  return total > 0 && total <= 10 ? total : null;
}

function detectarPerguntaPreco(txt) {
  if (!txt) return null;
  const t = txt.toLowerCase().trim();

  const gatilhos = [
    "quanto custa", "qual o custo", "qual o preço", "qual o valor",
    "quais os planos", "tem plano", "planos disponíveis", "planos disponiveis",
    "me fala o preço", "me fala o valor", "me fala os valores",
    "qual o investimento", "quanto é", "quanto fica",
    "tabela de preços", "tabela de precos",
    "preço", "preco", "plano mensal", "plano anual",
    "me mande todos os valores", "todos os valores", "ver os valores"
  ];

  // Gatilhos de VÍDEO — não são pedidos de preço, são pedidos de vídeo das telas
  const gatilhosVideo = [
    "video de todos", "vídeo de todos", "video dos pontos", "vídeo dos pontos",
    "video de todos os pontos", "vídeo de todos os pontos",
    "quero ver os videos", "quero ver os vídeos", "me manda os videos",
    "me manda os vídeos", "ver as telas", "video das telas", "vídeo das telas"
  ];
  if (gatilhosVideo.some(g => t.includes(g))) return null; // não é pedido de preço

  // RECLAMAÇÕES — não são pedidos de preço, são reclamações sobre erro
  const reclamacoes = [
    "preço errado", "preco errado", "valor errado", "valor incorreto",
    "preço incorreto", "preco incorreto", "passou o preço errado",
    "passou o valor errado", "preço ta errado", "preco ta errado",
    "preço está errado", "preco está errado", "fez mais barato",
    "fazer mais barato", "passou preço errado"
  ];
  if (reclamacoes.some(r => t.includes(r))) return null; // reclamação, não pedido de preço

  const perguntando = gatilhos.some(g => t.includes(g));

  // "pontos" só dispara preço se vier com número ou palavra numérica E contexto de preço
  const temPonto = /\d+\s*pont|\b(um|dois|três|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+pont/i.test(t);
  const temContextoPreco = /(quanto|valor|custa|preço|preco|fica|custo)/i.test(t);
  const pontoComPreco = temPonto && temContextoPreco;

  if (!perguntando && !pontoComPreco) return null;

  // ── CASO 1: Lead já especificou quantos pontos quer → resposta direta ──
  const totalPontos = extrairTotalPontos(t);
  if (totalPontos) {
    const mensal = TABELA_MENSAL[totalPontos] || null;
    const anual  = TABELA_ANUAL[totalPontos]  || null;
    if (!mensal) return null;

    const bonus = totalPontos >= 5
      ? "\n⭐ No anual: 1º vídeo grátis + 2 vídeos em carrossel!"
      : "";

    return [
      `Com *${totalPontos} pontos*, aqui estão seus valores:

📅 *Mensal* (sem fidelidade): R$ ${mensal.toLocaleString('pt-BR')}/mês
📆 *Anual* (22% de desconto): R$ ${anual.toLocaleString('pt-BR')}/mês${bonus}`,

      `Qual faz mais sentido pro seu momento — o mensal pra testar sem compromisso, ou o anual com 22% de desconto? 😊`
    ];
  }

  // ── CASO 2: Lead perguntou preço sem especificar pontos → enviar PDF da tabela ──
  return [
    `Segue nossa tabela de preços completa 👇`,
    "🔹TABELA_PRECOS_PDF🔹",
    `Quantos pontos você está pensando? Assim calculo o valor exato pra você 😊`
  ];
}


// Salvar mensagem no histórico sem chamar o GPT
async function salvarMsgHistorico(client, phone, msgUser, msgBot) {
  try {
    const r = await client.query("SELECT messages FROM conversations WHERE phone=$1", [phone]);
    let msgs = [];
    if (r.rows.length > 0) {
      msgs = typeof r.rows[0].messages === 'string'
        ? JSON.parse(r.rows[0].messages)
        : (r.rows[0].messages || []);
    }
    msgs.push({ role: "user", content: msgUser });
    // Limpar separadores antes de salvar no histórico
    const msgBotLimpa = msgBot.replace(/---MSG---/g, ' ').trim();
    msgs.push({ role: "assistant", content: msgBotLimpa });
    if (msgs.length > 60) msgs = msgs.slice(-60);

    if (r.rows.length > 0) {
      await client.query("UPDATE conversations SET messages=$1, updated_at=NOW() WHERE phone=$2",
        [JSON.stringify(msgs), phone]);
    } else {
      await client.query("INSERT INTO conversations (phone, messages, updated_at) VALUES ($1,$2,NOW())",
        [phone, JSON.stringify(msgs)]);
    }
  } catch(e) {
    console.error("salvarMsgHistorico error:", e.message);
  }
}

// ═══════════════════════════════════════════════════════
// DETECTOR DE PERGUNTA SOBRE VÍDEO
// Quando o lead pergunta sobre tipos de vídeo → resposta fixa + catálogo automático
// ═══════════════════════════════════════════════════════
function detectarPerguntaVideo(txt) {
  if (!txt) return false;
  const t = txt.toLowerCase().trim();
  const gatilhos = [
    "tipo de video", "tipo de vídeo", "tipos de video", "tipos de vídeo",
    "que video", "que vídeo", "qual video", "qual vídeo",
    "como é o video", "como é o vídeo",
    "que tipo de video", "que tipo de vídeo",
    "posso fazer video", "posso fazer vídeo",
    "como faço o video", "como faço o vídeo",
    "quais video", "quais vídeo",
    "como fazer o video", "como fazer o vídeo",
    "o video tem que ser", "o vídeo tem que ser",
    "como tem que ser o video", "como tem que ser o vídeo"
  ];
  return gatilhos.some(g => t.includes(g));
}


// ══════════════════════════════════════════════════════════════
// Gera 3 slots de reunião em dias úteis (seg-sex), consultando
// o Google Calendar real para evitar horários já ocupados
// ══════════════════════════════════════════════════════════════
async function gerarSlotsReuniao() {
  const offsetMs = -3 * 60 * 60 * 1000; // UTC-3
  const agora = new Date(Date.now() + offsetMs);
  const nomesDia = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];
  const candidatos = ["09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];

  // Buscar token do Google Calendar via Base44 API (token sempre fresco)
  let gcToken = null;
  try {
    const base44ApiKey = process.env.BASE44_API_KEY;
    const tokenRes = await fetch("https://api.base44.com/api/apps/69f645345c37a4db77e0e07d/connectors/googlecalendar/token", {
      headers: { "x-api-key": base44ApiKey }
    });
    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();
      gcToken = tokenData.access_token || tokenData.token || tokenData.accessToken;
      console.log(`CALENDAR: token obtido via Base44 API ${gcToken ? "✅" : "❌"}`);
    } else {
      console.log(`CALENDAR: falha ao buscar token Base44 → ${tokenRes.status}`);
    }
  } catch(e) {
    console.log(`CALENDAR: erro ao buscar token → ${e.message}`);
  }

  // Buscar eventos ocupados nos próximos 10 dias
  const horariosOcupados = new Set();
  if (gcToken) {
    try {
      const timeMin = new Date(Date.now()).toISOString();
      const timeMax = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      const gcUrl = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`;
      const gcRes = await fetch(gcUrl, { headers: { Authorization: `Bearer ${gcToken}` } });
      if (gcRes.ok) {
        const gcData = await gcRes.json();
        for (const ev of (gcData.items || [])) {
          const start = ev.start?.dateTime;
          if (start) {
            // Converter para UTC-3 e guardar como "YYYY-MM-DD HH:MM"
            const d = new Date(start);
            const local = new Date(d.getTime() + offsetMs);
            const key = local.getUTCFullYear() + "-" +
              String(local.getUTCMonth()+1).padStart(2,"0") + "-" +
              String(local.getUTCDate()).padStart(2,"0") + " " +
              String(local.getUTCHours()).padStart(2,"0") + ":" +
              String(local.getUTCMinutes()).padStart(2,"0");
            horariosOcupados.add(key);
            console.log(`CALENDAR: ocupado → ${key}`);
          }
        }
      }
    } catch(e) {
      console.log(`CALENDAR: erro ao buscar eventos → ${e.message}`);
    }
  }

  const slots = [];
  let d = new Date(agora);
  d.setDate(d.getDate() + 1);

  // Tentar até 14 dias pra frente para achar 3 slots livres
  for (let tentativa = 0; tentativa < 14 && slots.length < 3; tentativa++) {
    const dow = d.getUTCDay();
    if (dow >= 1 && dow <= 5) { // seg a sex apenas
      const diaN = String(d.getUTCDate()).padStart(2,"0");
      const mesN = String(d.getUTCMonth()+1).padStart(2,"0");
      const anoN = d.getUTCFullYear();
      const dataStr = `${anoN}-${mesN}-${diaN}`;

      for (const hora of candidatos) {
        if (slots.length >= 3) break;
        const chave = `${dataStr} ${hora}`;
        if (!horariosOcupados.has(chave)) {
          const horaExib = hora.replace(":00", "h");
          slots.push({ nome: nomesDia[dow], data: `${diaN}/${mesN}`, hora: horaExib, chave });
          break; // 1 slot por dia
        }
      }
    }
    d.setDate(d.getDate() + 1);
  }

  return slots;
}

function splitMensagens(text) {
  if (!text) return [""];

  // 0. Limpar artefatos: remover ---MSG--- inline (quando vem no meio de frase), [FUNIL:...] tags
  let t = text.replace(/\[FUNIL:[^\]]*\]/g, "").trim();

  // 1. Normalizar ---MSG--- (com espaços, asteriscos etc ao redor) → separador padrão
  t = t.replace(/\s*-{3,}MSG-{3,}\s*/g, "|||SPLIT|||");

  if (t.includes("|||SPLIT|||")) {
    return t.split("|||SPLIT|||").map(s => s.trim()).filter(Boolean);
  }

  // 2. Múltiplos links YouTube na mesma mensagem → cada um em mensagem separada
  const youtubeRegex = /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[^\s]+|https?:\/\/youtu\.be\/[^\s]+/g;
  const links = [...t.matchAll(youtubeRegex)];
  if (links.length > 1) {
    const partes = [];
    let restante = t;
    for (const link of links) {
      const url = link[0].replace(/[.,;!?)]+$/, "");
      const idx = restante.indexOf(url);
      const antes = restante.substring(0, idx).trim();
      const linhas = antes.split(/\r?\n/);
      const nomeLinha = linhas[linhas.length - 1].trim();
      const textoAntes = linhas.slice(0, -1).join("\n").trim();
      if (textoAntes) partes.push(textoAntes);
      partes.push((nomeLinha ? nomeLinha + "\n" : "") + url);
      restante = restante.substring(idx + url.length).trim();
    }
    if (restante) partes.push(restante);
    return partes.filter(Boolean);
  }

  // 3. Plano Mensal + Anual juntos → dividir
  const temMensal = /plano mensal/i.test(t);
  const temAnual = /plano anual/i.test(t);
  if (temMensal && temAnual) {
    const match = t.match(/([\s\S]*?)(📆[\s\S]*|plano anual[\s\S]*)/i);
    if (match && match[1] && match[2]) {
      return [match[1].trim(), match[2].trim()].filter(Boolean);
    }
  }

  // 4. Mensagem única
  return [t];
}
function limparMarkdown(text) {
  if (!text) return text;

  // [qualquer texto](https://...) → apenas a URL
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, (match, label, url) => {
    return url;
  });

  // • item: https://link → remover o bullet e o texto antes do link, deixar URL limpa
  // Ex: "• Sueli Bolos: https://youtube..." → "https://youtube..."
  text = text.replace(/[•\-\*]\s*[^:\n]+:\s*(https?:\/\/\S+)/g, (match, url) => {
    return url;
  });

  // **texto** → *texto* (negrito WhatsApp)
  text = text.replace(/\*\*([^*]+)\*\*/g, '*$1*');

  return text;
}

// Separa múltiplos links YouTube/Drive em mensagens individuais com contexto
function separarLinksEmMensagens(text) {
  if (!text) return [text];

  const youtubeRegex = /(https?:\/\/(?:www\.)?youtube\.com\/shorts\/\S+|https?:\/\/youtu\.be\/\S+)/g;
  const driveRegex = /(https?:\/\/drive\.google\.com\/\S+)/g;

  const links = [];
  let match;

  // Coletar todos os links YouTube
  while ((match = youtubeRegex.exec(text)) !== null) {
    links.push({ url: match[1], index: match.index });
  }

  // Se só tem 1 link ou nenhum → não precisa separar
  if (links.length <= 1) return [text];

  // Tem múltiplos links → separar em mensagens
  // Texto antes do primeiro link vai na primeira mensagem
  const firstLinkIdx = links[0].index;
  const textoBefore = text.substring(0, firstLinkIdx).trim();

  const mensagens = [];
  if (textoBefore) mensagens.push(textoBefore);

  // Cada link vira uma mensagem separada com o nome da tela
  const nomeTelas = {
    'ognsjZEtt1w': 'Sueli Bolos Porto Feliz 📍',
    '_87HW8ghUi4': 'Academia R2 📍',
    'gKDJC8mUyM0': 'Pizzaria Monções 📍',
    '2NFvKYSdkHw': 'Pizzaria Rocks 📍',
    '2-W4sHoYHMQ': 'Recanto das Araras 📍',
  };

  for (const link of links) {
    const urlClean = link.url.replace(/[.,;!?]+$/, ''); // remove pontuação no final
    // Identificar nome da tela pelo ID do vídeo
    let nomeTela = '';
    for (const [id, nome] of Object.entries(nomeTelas)) {
      if (urlClean.includes(id)) { nomeTela = nome; break; }
    }
    if (nomeTela) {
      mensagens.push("👇 " + nomeTela + "\n" + urlClean);
    } else {
      mensagens.push(urlClean);
    }
  }

  return mensagens;
}

// ═══════════════════════════════════════════════════════
// PROCESSAR MARCADORES DE FUNIL
// ═══════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════
// REGISTRAR TRANSIÇÃO DE FUNIL (analytics de gargalos)
// ═══════════════════════════════════════════════════════
async function atualizarEtapaFunil(client, phone, novaEtapa, mensagemLead = null, respostaResumida = null) {
  const lead = await getLead(client, phone);
  const etapaAnterior = lead?.etapa_funil || "abertura";
  if (etapaAnterior === novaEtapa) return; // sem mudança
  
  await client.query(
    "UPDATE leads SET etapa_funil=$1, etapa_anterior=$2, updated_at=NOW() WHERE phone=$3",
    [novaEtapa, etapaAnterior, phone]
  ).catch(e => console.error("atualizarEtapaFunil:", e.message));
  
  await client.query(
    "INSERT INTO funil_transicoes (phone, etapa_anterior, etapa_nova, mensagem_lead, momento_resposta) VALUES ($1, $2, $3, $4, $5)",
    [phone, etapaAnterior, novaEtapa, mensagemLead, respostaResumida]
  ).catch(e => console.error("log transicao:", e.message));
  
  // ══ A/B TESTING: marcar conversão ══
  // Quando o lead avança de etapa, todas as atribuições de teste da etapa anterior
  // são marcadas como convertidas (o texto daquela etapa funcionou)
  try {
    await client.query(`
      UPDATE ab_test_assignments SET converted = true, converted_at = NOW()
      WHERE lead_phone = $1 AND converted = false
      AND test_id IN (
        SELECT id FROM ab_tests WHERE etapa_funil = $2 AND status = 'active'
      )
    `, [phone, etapaAnterior]);
    
    // Incrementar converted_count nas variantes
    await client.query(`
      UPDATE ab_test_variants SET converted_count = converted_count + 1
      WHERE id IN (
        SELECT variant_id FROM ab_test_assignments
        WHERE lead_phone = $1 AND converted = true
        AND converted_at > NOW() - INTERVAL '5 seconds'
      )
    `, [phone]);
  } catch(e) { console.error("A/B conversion tracking:", e.message); }
  // ══ FIM A/B TESTING ══
  
  console.log(`FUNIL TRANSICAO [${phone}]: ${etapaAnterior} → ${novaEtapa}`);
}

async function processarFunil(client, rep, phone) {
  const match = rep.match(/\[FUNIL:([^\]]+)\]/g);
  if (!match) return rep;

  for (const tag of match) {
    const inner = tag.match(/\[FUNIL:([^\]]+)\]/)[1];
    const params = {};
    inner.split(";").forEach(p => {
      const [k, v] = p.split("=");
      if (k && v) params[k.trim()] = v.trim();
    });

    const updates = {};
    if (params.etapa) updates.etapa_funil = params.etapa;
    if (params.nome) updates.nome = params.nome;
    if (params.negocio) updates.negocio = params.negocio;
    if (params.cidade) updates.cidade = params.cidade;
    if (params.telas_interesse) updates.telas_interesse = params.telas_interesse;
    if (params.pontos_interesse) updates.pontos_interesse = parseInt(params.pontos_interesse) || null;
    if (params.plano_interesse) updates.plano_interesse = params.plano_interesse;
    if (params.empresa) updates.empresa = params.empresa;
    if (params.ja_anunciou) updates.ja_anunciou = params.ja_anunciou;
    if (params.status) updates.status = params.status;

    if (Object.keys(updates).length > 0) {
      // Se a etapa mudou, registrar transição
      if (updates.etapa_funil) {
        await atualizarEtapaFunil(client, phone, updates.etapa_funil, txt, rep.substring(0, 200));
      }
      // Atualizar outros campos (exceto etapa_funil que já foi atualizado acima)
      const outrosUpdates = { ...updates };
      delete outrosUpdates.etapa_funil;
      if (Object.keys(outrosUpdates).length > 0) {
        const setClauses = Object.keys(outrosUpdates).map((f, i) => `${f}=$${i + 2}`).join(", ");
        await client.query(
          `UPDATE leads SET ${setClauses}, updated_at=NOW() WHERE phone=$1`,
          [phone, ...Object.values(outrosUpdates)]
        ).catch(e => console.error("processarFunil update:", e.message));
      }
      console.log(`FUNIL [${phone}]: ${JSON.stringify(updates)}`);
    }
  }

  // Remover todos os marcadores da resposta enviada ao lead
  return rep.replace(/\[FUNIL:[^\]]+\]/g, "").trim();
}

// ═══════════════════════════════════════════════════════
// PROCESSAR AGENDAMENTO
// ═══════════════════════════════════════════════════════
// Detecta e-mail em qualquer texto
function extrairEmail(txt) {
  const m = txt.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

// Detecta horário em qualquer texto (ex: "15h", "15:00", "3 da tarde")
function extrairHorario(txt) {
  const m = txt.match(/(\d{1,2})[h:](\d{0,2})|às (\d{1,2})h|(\d{1,2}) da tarde|(\d{1,2}) da manhã/i);
  if (!m) return null;
  const hora = m[1] || m[3] || m[4] || m[5];
  const min = m[2] || "00";
  return hora ? `${hora.padStart(2,"0")}:${min.padStart(2,"00")}` : null;
}


// ══════════════════════════════════════════════════════════════
// BUSCAR SLOTS DISPONÍVEIS NO GOOGLE CALENDAR
// Retorna os próximos 3 dias úteis com horários livres
// Pula automaticamente sábado e domingo
// ══════════════════════════════════════════════════════════════
async function buscarSlotsDisponiveis() {
  try {
    const r = await fetch(B44_SLOTS_URL, {
      headers: { "Authorization": "Bearer " + B44_API_KEY }
    });
    const data = await r.json();
    if (data.success && data.slots && data.slots.length > 0) {
      // Formatar os slots como texto para injetar no prompt
      let texto = "\n📋 HORÁRIOS REAIS DISPONÍVEIS (Google Calendar verificado — pula fins de semana):\n";
      for (const dia of data.slots) {
        const livres = dia.slots.filter(s => s.disponivel).map(s => s.hora);
        if (livres.length > 0) {
          texto += `  ${dia.dia_semana} ${dia.data}: ${livres.join(", ")}\n`;
        }
      }
      texto += "\nPROIBIDO oferecer horário fora dessa lista. PROIBIDO oferecer sábado ou domingo.";
      return { texto, slots: data.slots };
    }
    return { texto: "\n⚠️ Não há slots disponíveis nos próximos dias.", slots: [] };
  } catch(e) {
    console.error("Erro buscarSlots:", e.message);
    return { texto: "", slots: [] };
  }
}

// ══════════════════════════════════════════════════════════════
// VALIDAR SE O HORÁRIO ESCOLHIDO É VÁLIDO (não é fim de semana)
// ══════════════════════════════════════════════════════════════
function validarHorarioAgendamento(data, hora) {
  // Aceitar formatos: DD/MM/YYYY, DD/MM, "amanhã", "amanha", dias da semana
  const diasSemana = {
    "segunda": 1, "seg": 1, "terça": 2, "terca": 2, "ter": 2,
    "quarta": 3, "qua": 3, "quinta": 4, "qui": 4, "sexta": 5, "sex": 5,
    "sábado": 6, "sabado": 6, "sab": 6, "domingo": 0, "dom": 0
  };
  
  const dataLower = (data || "").toLowerCase().trim();
  
  // Verificar dia da semana explicitamente
  for (const [palavra, dia] of Object.entries(diasSemana)) {
    if (dataLower.includes(palavra)) {
      if (dia === 0 || dia === 6) {
        return { valido: false, motivo: "Não trabalhamos aos sábados e domingos. Por favor, escolha um dia entre segunda e sexta." };
      }
    }
  }
  
  // Verificar data no formato DD/MM
  const matchDMY = dataLower.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (matchDMY) {
    const day = parseInt(matchDMY[1]);
    const month = parseInt(matchDMY[2]) - 1;
    const year = matchDMY[3] ? (parseInt(matchDMY[3]) < 100 ? 2000 + parseInt(matchDMY[3]) : parseInt(matchDMY[3])) : new Date().getFullYear();
    const dateObj = new Date(year, month, day);
    const dayOfWeek = dateObj.getDay();
    if (dayOfWeek === 6 || dayOfWeek === 0) {
      return { valido: false, motivo: "Não trabalhamos aos sábados e domingos. Por favor, escolha um dia entre segunda e sexta." };
    }
  }
  
  // Verificar horário (deve estar entre 9h e 18h)
  const matchHora = (hora || "").match(/(\d{1,2})[:h]/i);
  if (matchHora) {
    const h = parseInt(matchHora[1]);
    if (h < 9 || h >= 18) {
      return { valido: false, motivo: "Nosso horário de atendimento é de segunda a sexta, das 9h às 18h." };
    }
  }
  
  return { valido: true };
}

async function processarAgendamento(client, rep, phone) {
  // ── DETECÇÃO AUTOMÁTICA ──
  // Se o GPT não emitiu o marcador mas o lead já deu e-mail + horário → dispara sozinho
  const emailNaResposta = extrairEmail(rep);
  const lead = await getLead(client, phone);
  const emailNoLead = lead?.email_lead;

  if (!rep.includes("[AGENDAR_REUNIAO:") && emailNaResposta) {
    // Lead acabou de passar o e-mail — verificar se já temos o horário no histórico
    const hist = await getHist(client, phone);
    let horarioEncontrado = null;
    let dataEncontrada = null;

    // Varrer histórico do usuário em busca de dia e hora
    for (const m of [...hist].reverse()) {
      if (m.role === "user") {
        if (!horarioEncontrado) horarioEncontrado = extrairHorario(m.content);
        if (!dataEncontrada) {
          const dm = m.content.match(/(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|amanhã|amanha|hoje|\d{1,2}\/\d{1,2})/i);
          if (dm) dataEncontrada = dm[0];
        }
        if (horarioEncontrado && dataEncontrada) break;
      }
    }

    // Também checar a mensagem atual do assistente em busca de horário (ex: "amanhã às 15h")
    if (!horarioEncontrado) horarioEncontrado = extrairHorario(rep);
    if (!dataEncontrada) {
      const dm = rep.match(/(segunda|terça|terca|quarta|quinta|sexta|sábado|sabado|domingo|amanhã|amanha|hoje|\d{1,2}\/\d{1,2})/i);
      if (dm) dataEncontrada = dm[0];
    }

    if (horarioEncontrado && dataEncontrada) {
      console.log(`AGENDAMENTO AUTO DETECTADO [${phone}]: email=${emailNaResposta} data=${dataEncontrada} hora=${horarioEncontrado}`);
      // Injetar o marcador automaticamente na resposta
      rep += `\n[AGENDAR_REUNIAO:email=${emailNaResposta};data=${dataEncontrada};hora=${horarioEncontrado};telefone=${phone}]`;
    }
  }

  const match = rep.match(/\[AGENDAR_REUNIAO:([^\]]+)\]/);
  if (!match) return rep;

  const params = {};
  match[1].split(";").forEach(p => {
    const [k, v] = p.split("=");
    if (k && v) params[k.trim()] = v.trim();
  });
  params.telefone = params.telefone || phone;

  // ── VALIDAR: não permitir sábado/domingo nem fora do horário comercial ──
  const validacao = validarHorarioAgendamento(params.data, params.hora);
  if (!validacao.valido) {
    console.log("AGENDAMENTO BLOQUEADO:", validacao.motivo);
    // Remover o marcador e retornar mensagem de correção
    rep = rep.replace(/\[AGENDAR_REUNIAO:[^\]]+\]/g, "");
    rep += `\n\n⚠️ ${validacao.motivo}`;
    return rep;
  }

  console.log("Agendando reunião:", JSON.stringify(params));

  // Salvar dados da reunião no lead
  if (params.data) await atualizarEtapaFunil(client, phone, "reuniao", txt, "agendamento"); await client.query("UPDATE leads SET reuniao_data=$1, reuniao_hora=$2, updated_at=NOW() WHERE phone=$3",
    [params.data, params.hora || "", phone]).catch(e => console.error("saveReuniao:", e.message));

  // Chamar função de agendamento
  try {
    const r = await fetch(B44_FUNC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + B44_API_KEY },
      body: JSON.stringify(params)
    });
    const result = await r.json();
    console.log("Agendamento result:", JSON.stringify(result));
  } catch(e) { console.error("Erro no agendamento:", e.message); }

  return rep.replace(/\[AGENDAR_REUNIAO:[^\]]+\]/g, "").trim();
}


// ═══════════════════════════════════════════════════════
// LOG DE CUSTOS POR MENSAGEM
// ═══════════════════════════════════════════════════════
async function logCusto(client, phone, usage) {
  try {
    const tokens_input = usage?.prompt_tokens || 0;
    const tokens_output = usage?.completion_tokens || 0;
    // gpt-4o-mini: $0.15/1M input | $0.60/1M output
    const custo_usd = (tokens_input / 1_000_000 * 0.15) + (tokens_output / 1_000_000 * 0.60);
    await client.query(`
      INSERT INTO message_log (phone, direction, tokens_input, tokens_output, custo_usd)
      VALUES ($1, 'outbound', $2, $3, $4)
    `, [phone, tokens_input, tokens_output, custo_usd]);
    console.log(`CUSTO [${phone}]: in=${tokens_input} out=${tokens_output} $${custo_usd.toFixed(6)}`);
  } catch(e) { console.error("logCusto:", e.message); }
}

// ═══════════════════════════════════════════════════════
// IA — RESPOSTA COM CONSCIÊNCIA DE FUNIL
// ═══════════════════════════════════════════════════════
async function replyAI(client, txt, phone) {
  const msgs = await getHist(client, phone);
  const isNew = msgs.length === 0;

  // Buscar dados do lead para contexto de funil
  let lead = await getLead(client, phone);
  if (!lead) {
    await upsertLead(client, phone, txt);
    lead = { etapa_funil: "abertura", nome: null, negocio: null, cidade: null, telas_interesse: null, pontos_interesse: null, status: "novo" };
  }

  // ── AUTO-AVANÇO: se já tem histórico e ainda tá em abertura, pular pra entendimento ──
  let etapa = lead.etapa_funil || "abertura";
  if (!isNew && etapa === "abertura") {
    etapa = "entendimento";
    try {
      await client.query("UPDATE leads SET etapa_funil='entendimento', updated_at=NOW() WHERE phone=$1", [phone]);
      console.log(`AUTO-AVANÇO [${phone}]: abertura → entendimento (já tem histórico)`);
    } catch(e) { console.error("Erro auto-avanço:", e.message); }
  }

  // Buscar aprendizado do banco: patches filtrados por etapa + insights estruturados
  let patches = [];
  let insights = [];
  try {
    // Patches de correção — filtrados pela etapa atual do lead
    const patchResult = await client.query(
      "SELECT conteudo, problema, patch_type FROM prompt_patches WHERE ativo = true AND (etapa_alvo = $1 OR etapa_alvo = 'all') ORDER BY created_at DESC LIMIT 8",
      [etapa]
    );
    patches = patchResult.rows;
    
    // Insights estruturados — filtrados pela etapa atual + globais
    const insightResult = await client.query(
      "SELECT categoria, trigger_padrao, resposta_ideal, score FROM aprendizado_insights WHERE ativo = true AND (etapa_funil = $1 OR etapa_funil = 'all') ORDER BY score DESC LIMIT 5",
      [etapa]
    );
    insights = insightResult.rows;
  } catch(e) { console.error("Erro ao buscar aprendizado:", e.message); }

  const sys = await getSysWithFunil(client, etapa, lead, patches, insights);

  msgs.push({ role: "user", content: txt });

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "system", content: sys }, ...msgs],
      max_tokens: 1200,
      temperature: 0.72
    })
  });

  if (!res.ok) { console.error("OpenAI:", res.status, await res.text()); return ""; }

  const d = await res.json();
  let rep = d?.choices?.[0]?.message?.content?.trim() || "";

  // ── TRAVA ANTI-REPETIÇÃO UNIVERSAL: detecta qualquer repetição ──
  if (!isNew && rep) {
    // Pegar últimas 3 mensagens do bot
    const ultimasBot = msgs.filter(m => m.role === "assistant").slice(-3);
    let repetida = false;
    let tipoRepeticao = "";
    
    // Check 1: Repetiu a abertura
    if (rep.includes("Sou a Luana, consultora da OOBA")) {
      const jaApresentou = ultimasBot.some(m => m.content?.includes("Sou a Luana, consultora da OOBA"));
      if (jaApresentou) { repetida = true; tipoRepeticao = "abertura"; }
    }
    
    // Check 2: Mensagem idêntica ou quase idêntica às últimas 3
    if (!repetida) {
      for (const m of ultimasBot) {
        const contAnt = (m.content || "").trim();
        const contNovo = rep.trim();
        if (contAnt.length > 20 && contNovo.length > 20) {
          // Similaridade: se 80%+ das palavras batem, é repetição
          const palavrasAnt = new Set(contAnt.toLowerCase().split(/\s+/).filter(p => p.length > 3));
          const palavrasNovo = new Set(contNovo.toLowerCase().split(/\s+/).filter(p => p.length > 3));
          const inter = [...palavrasAnt].filter(p => palavrasNovo.has(p)).length;
          const maior = Math.max(palavrasAnt.size, palavrasNovo.size);
          if (maior > 0 && (inter / maior) > 0.8) {
            repetida = true;
            tipoRepeticao = "similar";
            break;
          }
        }
      }
    }
    
    // Check 3: Mandou tabela de preços 2x seguidas
    if (!repetida && rep.includes("1 ponto") && rep.includes("R$")) {
      const tabelasRecentes = ultimasBot.filter(m => 
        (m.content || "").includes("1 ponto") && (m.content || "").includes("R$")
      );
      if (tabelasRecentes.length >= 1) {
        repetida = true;
        tipoRepeticao = "tabela_precos";
      }
    }
    
    if (repetida) {
      console.log(`⚠️ Anti-repetição [${phone}]: ${tipoRepeticao} detectada. Regenerando...`);
      const res2 = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${OAI_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: sys + "\n\n⚠️ URGENTE: Sua última resposta foi repetida. NÃO repita o que você já disse. Continue a conversa naturalmente de onde parou. Faça uma pergunta DIFERENTE que avance a conversa." },
            ...msgs
          ],
          max_tokens: 1200,
          temperature: 0.85
        })
      });
      if (res2.ok) {
        const d2 = await res2.json();
        const rep2 = d2?.choices?.[0]?.message?.content?.trim() || "";
        if (rep2 && rep2 !== rep) {
          rep = rep2;
          console.log(`✅ Anti-repetição [${phone}]: resposta corrigida (${tipoRepeticao})`);
        }
      }
    }
  }

  if (rep) {
    msgs.push({ role: "assistant", content: rep });
    await saveHist(client, phone, msgs);

    // Registrar custo da mensagem
    await logCusto(client, phone, d?.usage);

    // Processar marcadores (funil e agendamento)
    rep = await processarFunil(client, rep, phone);
    rep = await processarAgendamento(client, rep, phone);

    // ── DELAY HUMANIZADO — esperar antes de enviar (simula digitação) ──
    const delayEnvio = humanDelay(rep);
    console.log(`HUMAN DELAY [${phone}]: ${delayEnvio}ms (${rep.split(/\s+/).length} palavras)`);
    await new Promise(r => setTimeout(r, delayEnvio));

    // ── MARCADOR [MOSTRAR_CATALOGO] ──
    // Quando o GPT emite esse marcador (ex: após explicar tipos de vídeo),
    // o código dispara o catálogo completo de telas automaticamente
    if (rep.includes("[MOSTRAR_CATALOGO]")) {
      rep = rep.replace(/\[MOSTRAR_CATALOGO\]/g, "").trim();
      // ⛔ TRAVA DE SEGURANÇA: só dispara catálogo se tiver cidade (negocio é opcional)
      if (lead.cidade) {
        lead._dispararCatalogo = true;
      } else {
        // Sem cidade → forçar coleta antes de mostrar catálogo
        rep = "Antes de te mostrar as telas, me conta: você é de Porto Feliz ou Boituva? 😊";
      }
    }

    // Limpar markdown — converte [texto](url) para URL solta (gera thumbnail no WhatsApp)
    rep = limparMarkdown(rep);

    // ── INTERCEPTADOR DE SAÍDA (prioridade máxima) ──
    // Roda SEMPRE — antes de qualquer outra lógica — para não deixar o lead escapar
    rep = interceptarSaida(txt, rep, lead, msgs);

    // ── INTERCEPTADOR DE PREÇO ANTECIPADO ──
    // Só bloqueia preço se NÃO for sinal de saída (para não sobrescrever a retenção)
    const ehSaidaAgora = ["nao quero","não quero","obrigado","obrigada","valeu","tchau","blz","flw","falou","vou pensar","até mais","ate mais","tmj","tá bom","ta bom"].some(s => txt.toLowerCase().includes(s));
    if (!ehSaidaAgora) {
      const bloqueioPreco = interceptarPrecoAntecipado(txt, lead);
      if (bloqueioPreco) rep = bloqueioPreco;
    }

    // ── DETECTOR DE PEDIDO DE PDF ──
    // Se o lead pediu PDF/proposta e a resposta não tem o link → injetar o link da apresentação
    rep = await injetarPDF(txt, rep, client);

    // ── DETECTOR DE PONTOS POR TELA ──
    // Detecta quando o lead fala "X pontos na/no [tela]" e atualiza o banco
    try {
      const txtOriginal = txt.toLowerCase();
      const mapaTelasSinonimos = {
        "sueli": "Sueli Bolos",
        "sueli bolos": "Sueli Bolos",
        "sueli porto": "Sueli Bolos PF",
        "sueli boituva": "Sueli Bolos Boituva",
        "bonfa": "Restaurante Bonfá",
        "bonfá": "Restaurante Bonfá",
        "araras": "Recanto das Araras",
        "recanto": "Recanto das Araras",
        "rocks": "Pizzaria Rocks",
        "pizzaria rocks": "Pizzaria Rocks",
        "monco": "Pizzaria Monções",
        "moncoes": "Pizzaria Monções",
        "monções": "Pizzaria Monções",
        "academia": "Academia R2",
        "r2": "Academia R2"
      };

      // Padrões: "2 pontos na sueli", "sueli 3 pontos", "quero 2 na sueli e 3 no bonfá"
      const padroes = [
        /(\d+)\s+pontos?\s+(?:na|no|em|na\s+tela)?\s+([a-záéíóúâêîôûàèìòùç\s]+)/gi,
        /([a-záéíóúâêîôûàèìòùç\s]+)\s+(?:com|-)?\s*(\d+)\s+pontos?/gi
      ];

      const pontosDetectados = {};
      for (const padrao of padroes) {
        let m;
        padrao.lastIndex = 0;
        while ((m = padrao.exec(txtOriginal)) !== null) {
          let qtd, nomeTela;
          if (!isNaN(m[1])) {
            qtd = parseInt(m[1]);
            nomeTela = m[2].trim();
          } else {
            nomeTela = m[1].trim();
            qtd = parseInt(m[2]);
          }
          // Resolver sinônimo
          for (const [sinonimo, nomeReal] of Object.entries(mapaTelasSinonimos)) {
            if (nomeTela.includes(sinonimo)) {
              pontosDetectados[nomeReal] = (pontosDetectados[nomeReal] || 0) + qtd;
              break;
            }
          }
        }
      }

      if (Object.keys(pontosDetectados).length > 0) {
        // Buscar pontos_por_tela existente e mesclar
        const leadAgora = await getLead(client, phone);
        let ppt = {};
        try { ppt = JSON.parse(leadAgora?.pontos_por_tela || "{}"); } catch(e) {}
        for (const [tela, pts] of Object.entries(pontosDetectados)) {
          ppt[tela] = pts; // Sobrescreve (o lead está sendo específico)
        }
        const totalPts = Object.values(ppt).reduce((a, b) => a + Number(b), 0);
        const telasStr = Object.keys(ppt).join(", ");

        await client.query(
          `UPDATE leads SET pontos_por_tela=$2, pontos_interesse=$3, telas_interesse=$4, updated_at=NOW() WHERE phone=$1`,
          [phone, JSON.stringify(ppt), totalPts, telasStr]
        ).catch(e => console.error("Detector pontos:", e.message));
        console.log(`PONTOS DETECTADOS [${phone}]: ${JSON.stringify(ppt)} → total=${totalPts}`);
      }
    } catch(ePontos) {
      console.error("Detector pontos erro:", ePontos.message);
    }

    // ── FALLBACK DE PROGRESSÃO AUTOMÁTICA ──
    // Se a Luana não emitiu marcador, avançar funil baseado em palavras-chave
    const leadAtual = await getLead(client, phone);
    const etapaAtual = leadAtual?.etapa_funil || "abertura";
    const repLower = rep.toLowerCase();
    const txtLower = txt.toLowerCase();
    const todasMsgs = msgs.map(m => m.content?.toLowerCase() || "").join(" ");

    if (etapaAtual === "abertura") {
      // Detectar negócio e cidade mencionados
      const negocioDetect = todasMsgs.match(/(?:tenho|sou dono|trabalho|minha|nossa)\s+(?:uma?\s+)?([a-záéíóúâêîôûàèìòùç\s]{3,30})/i);
      const cidadeDetect = todasMsgs.includes("porto feliz") ? "Porto Feliz"
                         : todasMsgs.includes("boituva") ? "Boituva" : null;
      if (negocioDetect || cidadeDetect) {
        await atualizarEtapaFunil(client, phone, "entendimento", txt, rep.substring(0, 200));
        if (cidadeDetect) {
          await client.query("UPDATE leads SET cidade=$1, updated_at=NOW() WHERE phone=$2", [cidadeDetect, phone]).catch(()=>{});
        }
        console.log(`FUNIL AUTO [${phone}]: abertura → entendimento`);
      }
    } else if (etapaAtual === "entendimento") {
      // Avançar automaticamente — SÓ se o GPT claramente está mostrando catálogo
      // NÃO avançar só porque mencionou "tela" ou "ponto" em uma validação
      const leadAutoFunil = await getLead(client, phone);
      const temCidadeAuto = leadAutoFunil?.cidade;
      if (temCidadeAuto && (repLower.includes("deixa eu mostrar") || repLower.includes("vou te mostrar") || repLower.includes("olha onde") || repLower.includes("mostrar_catalogo"))) {
        await atualizarEtapaFunil(client, phone, "recomendacao", txt, rep.substring(0, 200));
        console.log(`FUNIL AUTO [${phone}]: entendimento → recomendacao (catalogo sera disparado)`);
      } else {
        console.log(`FUNIL AUTO [${phone}]: entendimento mantido (cidade=${temCidadeAuto || "null"}, GPT validando)`);
      }
    } else if (etapaAtual === "apresentacao") {
      // Avançar se enviou links de vídeo
      if (repLower.includes("youtube.com/shorts") || repLower.includes("ver vídeo") || repLower.includes("ver video")) {
        await atualizarEtapaFunil(client, phone, "recomendacao", txt, rep.substring(0, 200));
        console.log(`FUNIL AUTO [${phone}]: apresentacao → recomendacao`);
      }
    } else if (etapaAtual === "recomendacao") {
      // Avançar se enviou materiais institucionais
      if (repLower.includes("media.base44.com") || repLower.includes("drive.google.com") || repLower.includes("apresentação") || repLower.includes("contrato")) {
        await atualizarEtapaFunil(client, phone, "materiais", txt, rep.substring(0, 200));
        console.log(`FUNIL AUTO [${phone}]: recomendacao → materiais`);
      }
    } else if (etapaAtual === "materiais") {
      // Avançar se mencionou preço/valor
      if (repLower.includes("r$") || repLower.includes("plano") || repLower.includes("mensal") || repLower.includes("anual")) {
        await atualizarEtapaFunil(client, phone, "proposta", txt, rep.substring(0, 200));
        console.log(`FUNIL AUTO [${phone}]: materiais → proposta`);
      }
    } else if (etapaAtual === "proposta" || etapaAtual === "fechamento") {
      // Detectar interesse em reunião
      if (txtLower.includes("seria legal") || txtLower.includes("pode ser") || txtLower.includes("quero a reunião") || txtLower.includes("marcar")) {
        await atualizarEtapaFunil(client, phone, "fechamento", txt, rep.substring(0, 200));
        console.log(`FUNIL AUTO [${phone}]: → fechamento`);
      }
    }

    // ── Marcar no banco sempre que o contrato for enviado (qualquer etapa) ──
    if (repLower.includes("contrato_pdf") || repLower.includes("🔹contrato_pdf🔹") || repLower.includes("contrato-modelo")) {
      await client.query("UPDATE leads SET contrato_enviado=true, updated_at=NOW() WHERE phone=$1", [phone]).catch(e => console.error("contrato_enviado:", e.message));
      console.log(`CONTRATO ENVIADO [${phone}]: marcado no banco`);
    }
  }

  return rep;
}

// ═══════════════════════════════════════════════════════
// WEBHOOK PRINCIPAL
// ═══════════════════════════════════════════════════════
// Enviar PDF como documento anexo (não link) — só dentro da janela de 24h
async function sendDocument(to, link, caption, filename) {
  const resp = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "document",
      document: { link: link, caption: caption || "", filename: filename || "documento.pdf" }
    })
  });
  const d = await resp.json();
  if (d?.error) console.error("WA doc error:", JSON.stringify(d.error));
  else console.log("WA doc sent:", d?.messages?.[0]?.id);
  return d;
}

async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v21.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body, preview_url: true } })
  });
  const d = await res.json();
  if (d?.error) console.error("WA error:", JSON.stringify(d.error));
  else console.log("WA sent:", d?.messages?.[0]?.id);
}

const processedMsgs = new Set();

module.exports = async (req, res) => {
  if (req.method === "GET") {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = req.query;
    if (mode === "subscribe" && token === VT) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
  }

  if (req.method === "POST") {
    let client;
    try {
      const body = await parseBody(req);
      console.log("Body recebido:", JSON.stringify(body).substring(0, 150));
      const v = body?.entry?.[0]?.changes?.[0]?.value;
      if (v?.statuses) return res.json({ ok: true });
      const m = v?.messages?.[0];
      if (!m) return res.json({ ok: true });
      
      console.log(`📩 MSG RECEBIDA de ${m.from} | tipo: ${m.type} | id: ${m.id}`);
      
      // Deduplicação
      const msgId = m.id;
      if (processedMsgs.has(msgId)) { 
        console.log("Duplicata (memória):", msgId); 
        return res.json({ ok: true }); 
      }
      processedMsgs.add(msgId);
      if (processedMsgs.size > 200) processedMsgs.delete(processedMsgs.values().next().value);

      const from = m.from;
      let txt = "";

      if (m.type === "text") {
        txt = m?.text?.body?.trim() || "";
      } else if (m.type === "button") {
        txt = m?.button?.text?.trim() || m?.button?.payload?.trim() || "";
        console.log(`Botão clicado: ${txt}`);
      } else if (m.type === "interactive") {
        txt = m?.interactive?.button_reply?.title?.trim() || 
              m?.interactive?.button_reply?.id?.trim() || 
              m?.interactive?.list_reply?.title?.trim() || "";
        console.log(`Interativo clicado: ${txt}`);
      } else if (m.type === "audio" || m.type === "voice") {
        // ── WHISPER: transcrever o áudio do lead ──
        try {
          console.log("Audio/Voice recebido de", from, "tipo:", m.type, "— transcrevendo...");
          const audioId = m?.audio?.id || m?.voice?.id;
          console.log("Audio ID:", audioId);
          if (!audioId) { console.error("audioId vazio, abortando"); return; }

          // 1. Buscar URL do áudio no Meta
          const mediaRes = await fetch(`https://graph.facebook.com/v21.0/${audioId}`, {
            headers: { "Authorization": `Bearer ${WAT}` }
          });
          const mediaData = await mediaRes.json();
          const mediaDataStr = JSON.stringify(mediaData);
          console.log("Media data COMPLETO:", mediaDataStr);
          const audioUrl = mediaData?.url;
          if (!audioUrl) { 
            console.error("URL do audio nao encontrada. Erro Meta:", mediaDataStr);
            return; 
          }

          // 2. Baixar o arquivo de áudio
          const audioDownload = await fetch(audioUrl, {
            headers: { "Authorization": `Bearer ${WAT}` }
          });
          const audioArrayBuffer = await audioDownload.arrayBuffer();
          const audioBuffer = Buffer.from(audioArrayBuffer);

          // 3. Transcrever com Whisper (OpenAI)
          const FormData = require("form-data");
          const whisperForm = new FormData();
          whisperForm.append("file", audioBuffer, { filename: "audio.ogg", contentType: "audio/ogg" });
          whisperForm.append("model", "whisper-1");
          whisperForm.append("language", "pt");

          const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${OAI_KEY}`,
              ...whisperForm.getHeaders()
            },
            body: whisperForm
          });
          const whisperData = await whisperRes.json();
          console.log("Whisper response:", JSON.stringify(whisperData).substring(0, 200));
          txt = whisperData?.text?.trim() || "";
          if (!txt) { console.error("Transcricao vazia. whisperData:", JSON.stringify(whisperData)); return; }
          console.log(`Transcricao [${from}]: ${txt}`);

        } catch(whisperErr) {
          console.error("Erro Whisper:", whisperErr.message);
          return;
        }
      }

      if (!from || !txt) { console.log('from ou txt vazio, abortando'); return; }

      console.log(`IN [${from}] etapa=? : ${txt}`);
      client = await getDB();
      await initDB(client);
      await carregarTabelaPrecos(client);
      // Carregar bloqueio de preço do banco
      const bpRes = await client.query("SELECT value FROM agent_config WHERE key='msg_bloqueio_preco'");
      if (bpRes.rows.length > 0) _cachedBloqueioPreco = bpRes.rows[0].value;

      // ── BYPASS DE PREÇOS: não passa pelo GPT, manda direto ──
      // 🛑 GUARD DE VALOR: só liberar preços depois que o lead passou pela educação
      const respostasPreco = detectarPerguntaPreco(txt);
      if (respostasPreco) {
        const leadBypassPreco = await getLead(client, from);
        const etapaBypassPreco = leadBypassPreco?.etapa_funil || "abertura";
        const etapasLiberadasPreco = ["recomendacao", "materiais", "proposta", "fechamento", "reuniao"];
        
        if (!etapasLiberadasPreco.includes(etapaBypassPreco)) {
          console.log(`BYPASS PREÇO BLOQUEADO [${from}]: etapa=${etapaBypassPreco} — gerar valor primeiro`);
          // Não manda preços — deixa o GPT + interceptarPrecoAntecipado lidarem
        } else {
          // PROTEÇÃO ANTI-LOOP: se a última msg do bot já foi tabela de preços (texto OU PDF), não repetir
          const histPrecoCheck = await getHist(client, from);
          const ultimasBotPreco = histPrecoCheck.filter(m => m.role === "assistant").slice(-3);
          const jaMandouTabela = ultimasBotPreco.some(m => 
            (m.content || "").includes("1 ponto") && (m.content || "").includes("10 pontos") ||
            (m.content || "").includes("Tabela de preços PDF enviada"));
          if (jaMandouTabela) {
            console.log(`BYPASS PREÇO BLOQUEADO [${from}]: já mandou tabela recentemente, delegando pro GPT`);
          } else {
            const historicoFinal = [];
            for (let i = 0; i < respostasPreco.length; i++) {
              const parteAtual = respostasPreco[i];
              if (parteAtual === "🔹TABELA_PRECOS_PDF🔹") {
                const linkTabelaPdf = await getConfig(client, "link_tabela_precos_pdf") || "https://media.base44.com/files/public/69f645345c37a4db77e0e07d/918c29047_tabela_precos_ooba.pdf";
                await sendDocument(from, linkTabelaPdf, "Tabela de Preços OOBA 💰", "Tabela-de-Precos-OOBA.pdf");
                historicoFinal.push("[Tabela de preços PDF enviada como documento anexo]");
                console.log(`TABELA PREÇOS PDF ENVIADA [${from}]: documento anexado`);
              } else {
                await sendMsg(from, parteAtual);
                historicoFinal.push(parteAtual);
              }
              if (i < respostasPreco.length - 1) await new Promise(r => setTimeout(r, 1500));
            }
            await salvarMsgHistorico(client, from, txt, historicoFinal.join("\n\n---MSG---\n\n"));
            return;
          }
        }
      }

      // ── BYPASS DE OBJETIVO: lead informou objetivo (marca/promoção/lançamento) ──
      // Se está em entendimento e o lead respondeu o objetivo → transição + catálogo direto
      const leadObjt = await getLead(client, from);
      const etapaObjt = leadObjt?.etapa_funil || "abertura";
      const txtLowerObjt = txt.toLowerCase().trim();
      const objetivosDetect = ["marca", "promoção", "promocao", "promoção", "lançamento", "lancamento", 
        "divulgar", "divulgação", "aparecer", "fortalecer", "fixar"];
      // Aceitar bypass em abertura OU entendimento (o GPT às vezes ainda não atualizou a etapa)
      const respondeuObjetivo = (etapaObjt === "entendimento" || etapaObjt === "abertura") && objetivosDetect.some(o => txtLowerObjt.includes(o));

      if (respondeuObjetivo) {
        console.log(`BYPASS OBJETIVO [${from}]: lead informou objetivo em entendimento — disparando catálogo`);
        // ⛔ TRAVA: só dispara catálogo se tiver negócio E cidade coletados
        if (!leadObjt?.negocio || !leadObjt?.cidade) {
          console.log(`BYPASS BLOQUEADO [${from}]: negócio=${leadObjt?.negocio} cidade=${leadObjt?.cidade} — redirecionando para coleta`);
          // Não faz nada — deixa o GPT normal tratar e pedir o que falta
        } else {
        // Frase de transição baseada no objetivo
        const negocioObjt = leadObjt?.negocio || "negócio";
        const cidadeObjt = leadObjt?.cidade;
        let fraseTransicao = `Ótimo! Deixa eu te mostrar onde seu anúncio vai aparecer em ${cidadeObjt} 👇`;
        if (txtLowerObjt.includes("marca")) fraseTransicao = `Marca forte se constrói com repetição. Em ${cidadeObjt} temos telas onde a mesma pessoa vê seu anúncio de 6 a 7 vezes na visita — olha 👇`;
        if (txtLowerObjt.includes("promo")) fraseTransicao = `Promoção precisa aparecer pra quem está ali, no momento certo, com tempo pra absorver. Olha onde seu anúncio vai rodar em ${cidadeObjt} 👇`;
        if (txtLowerObjt.includes("lança") || txtLowerObjt.includes("lanca")) fraseTransicao = `Lançamento precisa de barulho local e repetição. Aqui onde vai aparecer em ${cidadeObjt} 👇`;

        await sendMsg(from, fraseTransicao);
        await new Promise(r => setTimeout(r, 1000));

        // Disparar catálogo completo
        await enviarCatalogoTelas(from, leadObjt, 800, client);

        // Salvar no histórico
        const histObjt = await getHist(client, from);
        histObjt.push({ role: "user", content: txt });
        histObjt.push({ role: "assistant", content: fraseTransicao + "\n[catálogo automático enviado]" });
        await saveHist(client, from, histObjt);

        // Avançar funil para recomendacao
        await client.query("UPDATE leads SET etapa_funil='recomendacao', updated_at=NOW() WHERE phone=$1", [from]).catch(()=>{});
        if (!res.headersSent) res.json({ ok: true });
        return;
        } // fim do else (negócio+cidade ok)
      }

      // ── BYPASS DE VÍDEO: perguntou sobre tipos de vídeo → resposta fixa + catálogo ──
      if (detectarPerguntaVideo(txt)) {
        const leadVideo = await getLead(client, from);
        const msgVideo = "Dois tipos: *institucional* (sua marca, logo, o que vocês fazem) ou *promocional* (oferta, produto, chamada de ação). São até 15 segundos, .mp4, sem áudio — e isso é estratégico: sem som, cores e movimento têm que impactar em segundos 😊\n\nAgora deixa eu te mostrar onde seu vídeo vai aparecer 👇";
        await sendMsg(from, msgVideo);
        await new Promise(r => setTimeout(r, 1000));
        // ⛔ TRAVA: só dispara catálogo se tiver cidade coletada
        if (leadVideo?.cidade) {
          await enviarCatalogoTelas(from, leadVideo, 800, client);
        }
        // Salvar no histórico
        const histVideo = await getHist(client, from);
        histVideo.push({ role: "user", content: txt });
        histVideo.push({ role: "assistant", content: msgVideo + "\n[catálogo de telas enviado]" });
        await saveHist(client, from, histVideo);
        // Avançar funil
        await client.query("UPDATE leads SET etapa_funil='recomendacao', updated_at=NOW() WHERE phone=$1", [from]).catch(()=>{});
        if (!res.headersSent) res.json({ ok: true });
        return;
      }

      // ══════════════════════════════════════════════════════════════
      // 🔒 INTERCEPTADOR DE ACEITE DE REUNIÃO — lead aceitou a proposta de reunião
      // ══════════════════════════════════════════════════════════════
      {
        const leadAceite = await getLead(client, from);
        if (leadAceite?.etapa_funil === "aguardando_reuniao") {
          const txtA = txt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

          const aceitou = txtA.includes("sim") || txtA.includes("ok") || txtA.includes("claro") ||
            txtA.includes("pode ser") || txtA.includes("quero") || txtA.includes("aceito") ||
            txtA.includes("vamos") || txtA.includes("tá") || txtA.includes("ta ") ||
            txtA.includes("blz") || txtA.includes("beleza") || txtA.includes("perfeito") ||
            txtA.includes("show") || txtA.includes("combinado") || txtA.includes("tudo bem") ||
            txtA.includes("pode") || txtA.includes("top") || txtA.includes("bora") ||
            txtA.includes("ótimo") || txtA.includes("otimo") || txtA.includes("massa") ||
            txtA.includes("legal");

          const recusou = (txtA.includes("nao") || txtA.includes("não")) &&
            !txtA.includes("nao sei") && !txtA.includes("não sei");

          if (aceitou && !recusou) {
            console.log(`INTERCEPTADOR ACEITE REUNIÃO [${from}]: lead aceitou → enviando slots`);
            const slots = await gerarSlotsReuniao();
            const slotsLinhas = slots.map(s => "📅 *" + s.nome + ", " + s.data + "* às " + s.hora).join("\n");
            const msgSlots = "Ótimo! Agenda está bem movimentada, mas ainda tenho esses horários disponíveis:\n\n" + slotsLinhas + "\n\nQual desses funciona pra você?";
            await sendMsg(from, msgSlots);

            const histAceite = await getHist(client, from);
            histAceite.push({ role: "user", content: txt });
            histAceite.push({ role: "assistant", content: "[slots_reuniao_ofertado: " + slots.map(s => s.chave).join(", ") + "]" });
            await saveHist(client, from, histAceite);
            await client.query("UPDATE leads SET etapa_funil=\'reuniao_proposta\', updated_at=NOW() WHERE phone=$1", [from]).catch(() => {});
            if (!res.headersSent) res.json({ ok: true });
            return;
          }

          if (recusou) {
            console.log(`INTERCEPTADOR ACEITE REUNIÃO [${from}]: lead recusou reunião → GPT encerra com elegância`);
            await client.query("UPDATE leads SET etapa_funil=\'followup\', updated_at=NOW() WHERE phone=$1", [from]).catch(() => {});
            // Deixa o GPT responder com encerramento elegante
          }
        }
      }
      // ══════════════════════════════════════════════════════════════

      // ══════════════════════════════════════════════════════════════
      // 🔒 INTERCEPTADOR DE ESCOLHA DE TELAS — após catálogo, lead menciona telas
      // → enviar tabela de pontos + preços antes do GPT responder
      // ══════════════════════════════════════════════════════════════
      {
        const leadEscolha = await getLead(client, from);
        const etapaEscolha = leadEscolha?.etapa_funil || "abertura";
        const jaTemTabela = await getHist(client, from).then(h =>
          h.some(m => m.role === "assistant" && 
            (m.content?.includes("R$400") || m.content?.includes("tabela de pontos enviada") ||
             m.content?.includes("1 ponto") && m.content?.includes("10 pontos")))
        );
        const jaTemVideos = await getHist(client, from).then(h =>
          h.some(m => m.role === "assistant" && 
            (m.content?.includes("youtube.com/shorts") || m.content?.includes("catálogo enviado")))
        );

        // Detectar se lead mencionou telas, interesse ou qualquer escolha
        const txtE = txt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const mencionouTela = txtE.includes("sueli") || txtE.includes("bonfa") || txtE.includes("bonfá") ||
          txtE.includes("araras") || txtE.includes("rocks") || txtE.includes("moncoes") || txtE.includes("monções") ||
          txtE.includes("r2") || txtE.includes("academia") || txtE.includes("pizzaria") ||
          txtE.includes("todas") || txtE.includes("todos") || txtE.includes("gostei") ||
          txtE.includes("quero") || txtE.includes("interesse") || txtE.includes("essas");

        if (etapaEscolha === "recomendacao" && jaTemVideos && !jaTemTabela && mencionouTela) {
          console.log(`INTERCEPTADOR TABELA [${from}]: lead escolheu telas → enviando explicação de pontos + tabela`);

          // Msg 1: explicar pontos de 1 a 10
          await sendMsg(from, await getMsg("msg_explicacao_contratacao", {}, client, from));
          await new Promise(r => setTimeout(r, 1800));

          // Msg 2: tabela de preços mensal + anual (do banco)
          const msgTabela = await getMsg("msg_tabela_pontos", {}, client, from);
          if (msgTabela) await sendMsg(from, msgTabela);
          await new Promise(r => setTimeout(r, 1800));

          // Msg 3: pergunta simples
          await sendMsg(from, await getMsg("msg_pedir_pontos", {}, client, from));

          // Salvar no histórico
          const histEscolha = await getHist(client, from);
          histEscolha.push({ role: "user", content: txt });
          histEscolha.push({ role: "assistant", content: "[tabela de pontos enviada: 1 a 10 pontos, mensal e anual]" });
          await saveHist(client, from, histEscolha);

          await client.query("UPDATE leads SET etapa_funil='fechamento', updated_at=NOW() WHERE phone=$1", [from]).catch(() => {});

          if (!res.headersSent) res.json({ ok: true });
          return;
        }
      }
      // ══════════════════════════════════════════════════════════════

      // ══════════════════════════════════════════════════════════════
      // 🔒 INTERCEPTADOR DE HESITAÇÃO/SAÍDA — detecta lead escapando
      // Quando lead diz "não quero", "caro", "não tenho interesse" etc.
      // → código assume controle: tenta reunião com contexto + slots reais
      // ══════════════════════════════════════════════════════════════
      {
        const leadHes = await getLead(client, from);
        const etapaHes = leadHes?.etapa_funil || "abertura";
        const jaOfertouReuniao = await getHist(client, from).then(h =>
          h.filter(m => m.role === "assistant").slice(-4).some(m =>
            m.content?.includes("slots_reuniao_ofertado") || m.content?.includes("Agenda está bem movimentada")
          )
        );

        // Só aciona como fallback: se GPT já tentou ROI e lead ainda resiste
        const etapasComerciais = ["fechamento", "reuniao_proposta"];
        const gptJaTentouROI = await getHist(client, from).then(h =>
          h.filter(m => m.role === "assistant").some(m =>
            m.content?.includes("cliente novo") || m.content?.includes("ROI") ||
            m.content?.includes("pagar o investimento") || m.content?.includes("Basta 1")
          )
        );
        if (!etapasComerciais.includes(etapaHes) || jaOfertouReuniao || !gptJaTentouROI) {
          // não interceptar — deixa o GPT tentar primeiro
        } else {
          const txtH = txt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
          
          // Sinais de saída/hesitação
          const saidaForte = txtH.includes("nao quero") || txtH.includes("não quero") ||
            txtH.includes("nao tenho interesse") || txtH.includes("nao vou") || txtH.includes("não vou") ||
            txtH.includes("deixa pra la") || txtH.includes("deixa pra lá") || 
            txtH.includes("pode parar") || txtH.includes("para de me") ||
            txtH.includes("nao preciso") || txtH.includes("não preciso") ||
            txtH.includes("nao quero mais") || txtH.includes("desisti");

          const saidaFraca = txtH.includes("muito caro") || txtH.includes("caro demais") ||
            txtH.includes("nao tenho dinheiro") || txtH.includes("sem dinheiro") ||
            txtH.includes("fica pra depois") || txtH.includes("vou pensar") ||
            txtH.includes("nao sei") || txtH.includes("não sei") ||
            txtH.includes("ainda nao") || txtH.includes("ainda não") ||
            txtH.includes("atendente") || txtH.includes("humano") || txtH.includes("pessoa") ||
            txtH.includes("falar com alguem") || txtH.includes("responsavel") ||
            txtH.includes("voce garante") || txtH.includes("você garante") ||
            txtH.includes("tem certeza") || txtH.includes("nao funciona") ||
            txtH.includes("nao vale") || txtH.includes("achei caro");

          const ehHesitacao = saidaForte || saidaFraca;

          if (ehHesitacao) {
            console.log(`INTERCEPTADOR HESITAÇÃO [${from}]: saidaForte=${saidaForte}, saidaFraca=${saidaFraca} → ofertando reunião`);

            // Gerar slots reais do Calendar
            const slots = await gerarSlotsReuniao();

            // Mensagem de contexto — diferente para saída forte vs fraca
            let msgContexto = "";
            if (saidaForte) {
              msgContexto = "Entendo! Antes de encerrar, deixa eu te fazer uma proposta 😊 Tenho um especialista da equipe OOBA que consegue montar uma proposta personalizada pro seu perfil — sem compromisso, 15 minutinhos pelo Google Meet.";
            } else {
              msgContexto = "Faz sentido querer ter certeza antes de investir 😊 Tenho um especialista da equipe OOBA disponível pra montar uma proposta no tamanho certo do seu negócio — 15 minutos pelo Google Meet, sem compromisso.";
            }

            // Apenas proposta — sem mostrar slots ainda (aguarda resposta do lead)
            await sendMsg(from, msgContexto);

            // Salvar no histórico
            const histHes = await getHist(client, from);
            histHes.push({ role: "user", content: txt });
            histHes.push({ role: "assistant", content: "[reuniao_proposta_enviada: aguardando resposta do lead]" });
            await saveHist(client, from, histHes);

            // Avançar para etapa aguardando_reuniao
            await client.query("UPDATE leads SET etapa_funil=\'aguardando_reuniao\', updated_at=NOW() WHERE phone=$1", [from]).catch(() => {});

                        if (!res.headersSent) res.json({ ok: true });
            return;
          }
        }
      }
      // ══════════════════════════════════════════════════════════════

      // ══════════════════════════════════════════════════════════════
      // 🔒 INTERCEPTADOR DE CONFIRMAÇÃO — disparo do catálogo após lead confirmar entendimento
      // ══════════════════════════════════════════════════════════════
      {
        const leadConf = await getLead(client, from);
        if (leadConf?.etapa_funil === "aguardando_catalogo") {
          const txtC = txt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
          const confirmou = txtC.includes("sim") || txtC.includes("entend") || txtC.includes("claro") ||
            txtC.includes("ok") || txtC.includes("certo") || txtC.includes("tá") || txtC.includes("ta ") ||
            txtC.includes("blz") || txtC.includes("beleza") || txtC.includes("perfeito") ||
            txtC.includes("show") || txtC.includes("legal") || txtC.includes("bacana") ||
            txtC.includes("compreend") || txtC.includes("ótimo") || txtC.includes("otimo") ||
            txtC.includes("entendido") || txtC.includes("massa") || txtC.includes("top");

          const maisOuMenos = txtC.includes("mais ou menos") || txtC.includes("mais-ou-menos") ||
            txtC.includes("acho que sim") || txtC.includes("talvez") || txtC.includes("acho") ||
            txtC.includes("ou menos") || txtC.includes("nem tanto") || txtC.includes("um pouco");
          
          const naoEntendeu = (txtC.includes("nao ") || txtC.includes("não ") || txtC.includes("duvida") ||
            txtC.includes("dúvida") || txtC.includes("explica") || txtC.includes("?")) && !maisOuMenos;

          if (confirmou && !naoEntendeu) {
            console.log(`INTERCEPTADOR CONFIRMAÇÃO [${from}]: lead confirmou → disparando catálogo`);
            await sendMsg(from, await getMsg("msg_confirmacao_sim", {}, client, from));
            await new Promise(r => setTimeout(r, 1200));
            const leadFrescoConf = await getLead(client, from);
            await enviarCatalogoTelas(from, leadFrescoConf, 1500, client);
            const histConf = await getHist(client, from);
            histConf.push({ role: "user", content: txt });
            histConf.push({ role: "assistant", content: "[catálogo enviado após confirmação do lead]" });
            await saveHist(client, from, histConf);
            await client.query("UPDATE leads SET etapa_funil='recomendacao', updated_at=NOW() WHERE phone=$1", [from]).catch(() => {});
            if (!res.headersSent) res.json({ ok: true });
            return;
          }

          if (maisOuMenos) {
            console.log(`INTERCEPTADOR CONFIRMAÇÃO [${from}]: lead disse mais ou menos → reforço rápido + catálogo`);
            await sendMsg(from, await getMsg("msg_confirmacao_mais_menos", {}, client, from));
            await new Promise(r => setTimeout(r, 1200));
            const leadFrescoMOM = await getLead(client, from);
            await enviarCatalogoTelas(from, leadFrescoMOM, 800, client);
            const histMOM = await getHist(client, from);
            histMOM.push({ role: "user", content: txt });
            histMOM.push({ role: "assistant", content: "[reforço de conceito + catálogo enviado]" });
            await saveHist(client, from, histMOM);
            await client.query("UPDATE leads SET etapa_funil='recomendacao', updated_at=NOW() WHERE phone=$1", [from]).catch(() => {});
            if (!res.headersSent) res.json({ ok: true });
            return;
          }

          if (naoEntendeu) {
            console.log(`INTERCEPTADOR CONFIRMAÇÃO [${from}]: lead tem dúvida → respondendo com GPT`);
            // Deixa o GPT responder a dúvida — continua o fluxo normal abaixo
          }
        }
      }
      // ══════════════════════════════════════════════════════════════

      // ══════════════════════════════════════════════════════════════
      // 🔒 PROSPECÇÃO: Enviar PDF como documento na 1ª resposta do lead
      // ══════════════════════════════════════════════════════════════
      const leadProspPdf = await getLead(client, from);
      if (leadProspPdf?.origem === 'prospeccao' && leadProspPdf?.etapa_funil === 'abertura') {
        const histAposResp = await getHist(client, from);
        const jaRecebeuPdf = histAposResp.some(m => m.role === 'assistant' && m.content?.includes('[PDF apresentação enviado como documento]'));
        if (!jaRecebeuPdf) {
          console.log(`PROSPECÇÃO 1ª RESPOSTA [${from}]: enviando texto + PDF + pergunta de abertura`);
          
          // 1. Salvar a mensagem do lead no histórico PRIMEIRO
          const histInicial = await getHist(client, from);
          histInicial.push({ role: "user", content: txt });
          await saveHist(client, from, histInicial);
          
          // 2. Enviar texto antes do PDF
          await new Promise(r => setTimeout(r, 1200));
          const msgPrePdf = "Tudo bem! 😊 Vou te mandar nossa apresentação pra você conhecer 👇";
          await sendMsg(from, msgPrePdf);
          await new Promise(r => setTimeout(r, 2000));
          
          // 3. Enviar o PDF
          await sendDocument(from,
            LINK_APRESENTACAO_INSTITUCIONAL,
            "Apresentação OOBA Mídia Indoor 📎",
            "Apresentacao-OOBA-Midia-Indoor.pdf"
          );
          await new Promise(r => setTimeout(r, 2000));
          
          // 4. Enviar pergunta de abertura do funil
          const msgPosPdf = "Me conta rapidinho: hoje você já faz algum tipo de divulgação do seu negócio? 😊";
          await sendMsg(from, msgPosPdf);
          
          // 5. Salvar tudo no histórico
          const histFinal = await getHist(client, from);
          histFinal.push({ role: "assistant", content: msgPrePdf + "\n\n[PDF apresentação enviado como documento]\n\n" + msgPosPdf });
          await saveHist(client, from, histFinal);
          await updateLead(client, from, { etapa_funil: 'entendimento', status: 'respondendo' });
          
          console.log(`PROSPECÇÃO CONCLUÍDA [${from}]: texto + PDF + pergunta enviados, etapa=entendimento`);
          if (!res.headersSent) res.json({ ok: true });
          return;
        }
      }

      // ══════════════════════════════════════════════════════════════
      // 🔒 INTERCEPTADOR DE CIDADE — disparo educação via código
      // Detecta cidade na mensagem do lead (qualquer etapa antes de educacao)
      // e envia as 3 msgs fixas + catálogo sem passar pelo GPT.
      // ══════════════════════════════════════════════════════════════
      {
        const leadEntend = await getLead(client, from);
        const etapaEntend = leadEntend?.etapa_funil || "abertura";
        // Guard por etapa do funil (mais confiável que string match)
        const jaTemEdu = ["educacao", "aguardando_catalogo", "recomendacao", "materiais", "fechamento", "proposta"].includes(etapaEntend);

        // Detectar cidade na mensagem
        const txtN = txt.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        const temPF = txtN.includes("porto feliz") || (txtN.includes("porto") && !txtN.includes("porto seguro"));
        const temBT = txtN.includes("boituva");
        const temAmbas = txtN.includes("ambas") || txtN.includes("as duas") || (temPF && temBT);
        const cidadeDetectada = temAmbas ? "Porto Feliz e Boituva" : temBT ? "Boituva" : temPF ? "Porto Feliz" : null;

        // Interceptar se: cidade detectada + antes da educação
        const etapasAntesEdu = ["abertura", "entendimento", "educacao"];
        if (cidadeDetectada && !jaTemEdu && etapasAntesEdu.includes(etapaEntend)) {
          
          // Tentar extrair negócio do histórico se não estiver no banco
          let negocioFinal = leadEntend?.negocio;
          if (!negocioFinal) {
            const histBusca = await getHist(client, from);
            const palavrasNegocio = ["pizzaria","academia","loja","clinica","clínica","petshop","restaurante","salao","salão","barbearia","escola","curso","mercado","farmacia","farmácia","imobiliaria","imobiliária","odonto","dentista","estética","estetica","hotel","pousada","cafeteria","padaria","supermercado","auto","mecanica","mecânica","consultorio","consultório"];
            for (const m of [...histBusca].reverse()) {
              if (m.role === "user") {
                const mN = m.content.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
                const encontrou = palavrasNegocio.find(p => mN.includes(p));
                if (encontrou) { negocioFinal = encontrou; break; }
              }
            }
          }

          console.log(`INTERCEPTADOR CIDADE [${from}]: cidade=${cidadeDetectada}, negocio=${negocioFinal}, etapa=${etapaEntend} → educação completa (3 msgs com pausa, só para na confirmação)`);

          // Salvar cidade e negócio
          await client.query(
            "UPDATE leads SET cidade=$1, negocio=COALESCE(NULLIF(negocio,''),$2), etapa_funil='aguardando_catalogo', updated_at=NOW() WHERE phone=$3",
            [cidadeDetectada, negocioFinal || "", from]
          ).catch(() => {});

          // Se o lead perguntou "porquê/por que", responder brevemente antes da educação
          const txtCidadeLow = txt.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
          const perguntouPorque = txtCidadeLow.includes("por que") || txtCidadeLow.includes("porque") || 
            txtCidadeLow.includes("pra que") || txtCidadeLow.includes("qual a") || txtCidadeLow.includes("por quê");
          if (perguntouPorque) {
            const msgPorque = "Porque nossas telas ficam em comércios de " + cidadeDetectada + " — aí eu te mostro exatamente onde seu anúncio vai aparecer 😊";
            await sendMsg(from, msgPorque);
            await new Promise(r => setTimeout(r, 2000));
          }

          // ── Enviar as 3 mensagens de educação com pausas entre elas ──
          // Pausa longa o suficiente pra lead ler, mas sem travar se ele não responder
          
          // Msg 1: o que é um ponto
          const msg1 = await getMsg("msg_educacao_1", {}, client, from);
          await sendMsg(from, msg1);
          await new Promise(r => setTimeout(r, 5000)); // 5s de pausa pra ler

          // Msg 2: frequência
          const msg2 = await getMsg("msg_educacao_2", {}, client, from);
          await sendMsg(from, msg2);
          await new Promise(r => setTimeout(r, 5000)); // 5s de pausa pra ler

          // Msg 3: formato + pergunta "ficou claro?" — AQUI para e espera resposta
          const msg3 = await getMsg("msg_educacao_3", {}, client, from);
          await sendMsg(from, msg3);

          // Salvar tudo no histórico
          const histEdu = await getHist(client, from);
          histEdu.push({ role: "user", content: txt });
          histEdu.push({ role: "assistant", content: msg1 + "\n\n---MSG---\n\n" + msg2 + "\n\n---MSG---\n\n" + msg3 });
          await saveHist(client, from, histEdu);

          console.log(`EDUCAÇÃO CONCLUÍDA [${from}]: 3 msgs enviadas com pausas, aguardando confirmação em aguardando_catalogo`);
          if (!res.headersSent) res.json({ ok: true });
          return;
        }
      }
      // ══════════════════════════════════════════════════════════════

      const rep = await replyAI(client, txt, from);
      if (rep) {
        console.log(`OUT [${from}]: ${rep.substring(0, 120)}...`);

        // Dividir em múltiplas mensagens se houver separadores ---MSG--- ou blocos distintos de plano
        const partesBruto = splitMensagens(rep);

        // Expandir cada parte: se tiver múltiplos links YouTube, separar em mensagens individuais
        const partes = [];
        for (const p of partesBruto) {
          const subPartes = separarLinksEmMensagens(p);
          partes.push(...subPartes);
        }

        // ── INTERCEPTADOR DE AGENDAMENTO: se GPT pediu "qual dia/horário" → substituir por slots reais ──
        const repJuntada = partes.join(" ").toLowerCase();
        // Só disparar slots se a etapa atual for fechamento E o GPT claramente propôs reunião
        const leadCheck = await getLead(client, from); const etapaAtualCheck = leadCheck?.etapa_funil || "abertura";
        const gptPediuDisponibilidade = etapaAtualCheck === "fechamento" && (
          repJuntada.includes("qual dia") || repJuntada.includes("qual horário") || 
          repJuntada.includes("qual horario") || repJuntada.includes("que dia") ||
          repJuntada.includes("quando fica") || repJuntada.includes("quando você") ||
          repJuntada.includes("quando voce") || repJuntada.includes("melhor pra você") ||
          repJuntada.includes("melhor pra voce")
        ) && (
          repJuntada.includes("meet") || repJuntada.includes("reuni") || 
          repJuntada.includes("15 min")
        );

        if (gptPediuDisponibilidade) {
          const slots = await gerarSlotsReuniao();
          const msgSlots = `Agenda está bem movimentada essa semana 😅 Ainda tenho esses horários disponíveis:\n\n` +
            slots.map(s => `📅 *${s.nome}, ${s.data}* às ${s.hora}`).join("\n") +
            `\n\nQual desses funciona pra você?`;
          await sendMsg(from, msgSlots);
        } else {
          for (let i = 0; i < partes.length; i++) {
            // Limpar qualquer ---MSG--- residual que o GPT tenha incluído no texto
            let parte = partes[i].replace(/---MSG---/g, '').trim();

            // ── INTERCEPTADOR DE CONTRATO PDF: se o GPT incluiu o marcador, enviar PDF como anexo ──
            if (parte.includes("🔹CONTRATO_PDF🔹")) {
              // Remover o marcador do texto e limpar espaços sobrando
              parte = parte.replace(/🔹CONTRATO_PDF🔹/g, '').replace(/\s{2,}/g, ' ').trim();
              if (parte) {
                await sendMsg(from, parte);
                await new Promise(r => setTimeout(r, 1200));
              }
              // Enviar o PDF do contrato como documento anexo
              const linkContratoPdf = await getConfig(client, "link_contrato") || "https://media.base44.com/files/public/69f645345c37a4db77e0e07d/4f3263011_Contrato-MODELO.pdf";
              await sendDocument(from, linkContratoPdf, "Contrato de veiculação OOBA 📄", "Contrato-OOBA-Modelo.pdf");
              console.log(`CONTRATO PDF ENVIADO [${from}]: documento anexado`);
              // Marcar no banco
              await client.query("UPDATE leads SET contrato_enviado=true, updated_at=NOW() WHERE phone=$1", [from]).catch(e => console.error("contrato_enviado:", e.message));
              // Registrar no histórico
              const histContrato = await getHist(client, from);
              histContrato.push({ role: "assistant", content: "[Contrato PDF enviado como documento anexo]" });
              await saveHist(client, from, histContrato);
              continue; // pula o sendMsg normal abaixo
            }

            if (parte) {
              await sendMsg(from, parte);
              if (i < partes.length - 1) await new Promise(r => setTimeout(r, 900));
            }
          }
        }

        // ── CATÁLOGO PÓS-RESPOSTA ──
        // Disparar catálogo se:
        // A) GPT emitiu [MOSTRAR_CATALOGO], OU
        // B) A etapa mudou para recomendacao e ainda não foram enviados vídeos
        const leadPosEnvio = await getLead(client, from);
        const etapaPosEnvio = leadPosEnvio?.etapa_funil || "abertura";
        const histPosEnvio = await getHist(client, from);
        const jaTemVideos = histPosEnvio.some(m => m.role === "assistant" && m.content?.includes("youtube.com/shorts"));

        // 🛑 GUARD: Se o lead mostrou rejeição/despedida, NUNCA forçar catálogo ou educação
        const ultimasMsgsUser = histPosEnvio.filter(m => m.role === "user").slice(-2).map(m => (m.content||"").toLowerCase());
        const sinaisRejeicao = ["xau","tchau","nao quero","não quero","n quero","adeus","ate logo","até logo","para de mandar","para com isso","pare de mandar","stop","cancela","desistir","desistindo","nao quero mais","não quero mais","sem interesse","nao interessa","não interessa","bugado","seu robo","virus","vírus","duvidoso","golpe","spam"];
        const houveRejeicao = ultimasMsgsUser.some(txt => sinaisRejeicao.some(s => txt.includes(s)));
        if (houveRejeicao) {
          console.log(`REJEIÇÃO DETECTADA [${from}]: pulando catálogo/educação forçada`);
          if (!res.headersSent) res.json({ ok: true });
          return;
        }

        // Se etapa avançou para recomendacao mas educação nunca foi enviada → forçar educação + catálogo
        const jaTemEduHist = histPosEnvio.some(m => m.role === "assistant" && 
          (m.content?.includes("você não compra espaço em tela") || m.content?.includes("educação automática")));
        
        // EDUCAÇÃO FORÇADA DESATIVADA — agora a educação é enviada uma msg por vez
        // via interceptador de cidade (etapas educacao_1_enviada, educacao_2_enviada, etc)
        // if (etapaPosEnvio === "recomendacao" && !jaTemVideos && !jaTemEduHist && etapaPosEnvio !== "aguardando_catalogo") {
        //   ... bloco original removido ...
        // }

        const deveLancarCatalogo = (leadPosEnvio?._dispararCatalogo || 
          (etapaPosEnvio === "recomendacao" && !jaTemVideos)) && !houveRejeicao;

        if (deveLancarCatalogo) {
          console.log(`CATÁLOGO AUTO [${from}]: disparando (etapa=${etapaPosEnvio}, jaTemVideos=${jaTemVideos}, negocio=${leadPosEnvio?.negocio}, cidade=${leadPosEnvio?.cidade})`);
          await new Promise(r => setTimeout(r, 1200));
          // Sempre usar dados frescos do banco — nunca do lead em memória
          const leadFresco = await getLead(client, from);
          if (leadFresco?.cidade) { await enviarCatalogoTelas(from, leadFresco, 800, client); }
          // Marcar no histórico
          const histAtual2 = await getHist(client, from);
          histAtual2.push({ role: "assistant", content: "[catálogo automático: conceito de pontos + todas as telas + vídeos enviados]" });
          await saveHist(client, from, histAtual2);
        }

        // ── ÁUDIO: desativado temporariamente ──
        /*
        try {
          if (deveMandarAudio(m.type)) {
            // Pegar só o primeiro parágrafo para o áudio (mais natural e curto)
            const textoParaAudio = limparParaAudio(rep).split("\n\n")[0].slice(0, 280);
            if (textoParaAudio.length > 15) {
              const audioBuffer = await textToSpeech(textoParaAudio);
              if (audioBuffer) {
                const mediaId = await uploadAudioToWhatsApp(audioBuffer);
                if (mediaId) {
                  await new Promise(r => setTimeout(r, 1500));
                  await sendAudio(from, mediaId);
                  console.log("Audio sent to", from);
                }
              }
            }
          }
        } catch(audioErr) {
          console.error("Erro audio (nao critico):", audioErr.message);
        }
        */
      }
      // ── Responder ao Meta após processar tudo ──
      if (!res.headersSent) res.json({ ok: true });
    } catch(e) {
      console.error("ERR:", e.message, e.stack?.substring(0, 300));
      if (!res.headersSent) res.json({ ok: true });
    } finally {
      if (client) await client.end().catch(() => {});
    }
  }

  return res.status(405).json({ error: "method not allowed" });
};
