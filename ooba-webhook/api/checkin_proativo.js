// ═══════════════════════════════════════════════════════
// OOBA — Check-in Proativo (TODAS as etapas do funil)
// POST /api/checkin_proativo
// Busca leads em QUALQUER etapa do funil sem resposta há >24h
// e dispara mensagem ativa de retomada
//
// TRAVAS ANTI-SPAM:
// 1. Só manda pra leads com conversa real no banco (c.updated_at IS NOT NULL)
// 2. Auditoria pré-envio: última msg não pode ser check-in
// 3. Deduplicação: nunca mandar a mesma mensagem 2x
// 4. Limite 12h entre check-ins
// 5. Máximo 2 check-ins por lead (depois só reativação manual)
// 6. Excluir números internos
// ═══════════════════════════════════════════════════════

const { Client } = require("pg");

const WAT = process.env.WHATSAPP_TOKEN || "";
const PID = "1189704930882063";
const DATABASE_URL = process.env.DATABASE_URL || "";

async function getDB() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

async function sendMsg(to, body) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  if (d?.error) {
    console.error("WA error:", JSON.stringify(d.error));
    return false;
  }
  console.log("WA sent para", to, ":", d?.messages?.[0]?.id);
  return true;
}

async function sendTemplate(to, templateName, params) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: "pt_BR" },
        components: [{
          type: "body",
          parameters: params.map(p => ({ type: "text", text: p }))
        }]
      }
    })
  });
  const d = await res.json();
  if (d?.error) {
    console.error("WA template error:", JSON.stringify(d.error));
    return false;
  }
  console.log("WA template sent para", to, ":", d?.messages?.[0]?.id);
  return true;
}

// Mensagens de check-in por etapa do funil
function montarCheckin(lead) {
  const nome = lead.nome ? lead.nome.split(" ")[0] : "tudo bem";
  const etapa = lead.etapa_funil;
  const cidade = lead.cidade || "";
  const empresa = lead.empresa || "";

  switch (etapa) {
    case 'abertura':
      return `${nome}, tudo bem? 🙋 Conforme nossa conversa sobre divulgação da sua marca, queria continuar te explicando como funciona. Tem uns 2 minutinhos?`;

    case 'entendimento':
      return `${nome}, tudo bem? 🙋 Lembrei da nossa conversa! ${cidade ? `Para continuar te mostrando as opções em ${cidade}` : 'Pra te mostrar as telas que temos'}, só preciso de mais uma informação rápida. Posso?`;

    case 'educacao':
      return `${nome}, tudo bem? 🙋 Fiquei de te explicar melhor como nossos pontos funcionam. Quer que eu continue? Leva só 1 minutinho 😊`;

    case 'recomendacao':
      return `${nome}, tudo bem? 🙋 Você já viu as telas disponíveis ${cidade ? `em ${cidade}` : ''}? Qual delas faz mais sentido pra ${empresa || 'sua marca'}?`;

    case 'materiais':
      return `${nome}, tudo bem? 🙋 Conseguiu dar uma olhada nos materiais que te enviei? Alguma dúvida?`;

    case 'proposta':
      return `${nome}, tudo bem? 🙋 Passando pra saber se você teve a oportunidade de avaliar nossa proposta de divulgação da sua marca. Posso te esclarecer alguma dúvida?`;

    case 'fechamento':
      return `${nome}, estou no seu aguardo 🙋 tudo bem? Conseguiu dar uma olhada na proposta?`;

    default:
      return `${nome}, tudo bem? 🙋 Estou aqui, qualquer dúvida é só me chamar!`;
  }
}

// ═══ AUDITORIA PRÉ-ENVIO ═══
// Verifica o histórico da conversa antes de mandar qualquer coisa
// Retorna { podeEnviar: bool, motivo: string }
async function auditarConversa(client, lead) {
  try {
    const r = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
    if (r.rows.length === 0) {
      return { podeEnviar: false, motivo: "sem conversa no banco" };
    }

    const msgs = JSON.parse(r.rows[0].messages);
    if (msgs.length === 0) {
      return { podeEnviar: false, motivo: "histórico vazio" };
    }

    // Pegar últimas 5 mensagens do bot
    const ultimasBot = msgs.filter(m => m.role === "assistant").slice(-5);
    if (ultimasBot.length === 0) {
      return { podeEnviar: false, motivo: "sem mensagens do bot no histórico" };
    }

    // 1. Verificar se a ÚLTIMA mensagem do bot já foi um check-in
    const ultimaMsgBot = ultimasBot[ultimasBot.length - 1];
    const conteudoUltima = (ultimaMsgBot.content || "").trim();
    const ehCheckinAnterior = conteudoUltima.includes("[CHECK-IN PROATIVO");
    
    // 2. Verificar se as últimas 2+ mensagens do bot são check-ins (spam)
    let checkinsConsecutivos = 0;
    for (let i = ultimasBot.length - 1; i >= 0; i--) {
      if ((ultimasBot[i].content || "").includes("[CHECK-IN PROATIVO")) {
        checkinsConsecutivos++;
      } else {
        break;
      }
    }

    if (ehCheckinAnterior) {
      return { podeEnviar: false, motivo: `última msg já é check-in (${checkinsConsecutivos} consecutivos)` };
    }

    // 3. Verificar se o lead já respondeu depois do último check-in
    // Se o lead respondeu, o check-in atual é válido (não é spam)
    // Se não respondeu, e já teve check-in antes, não mandar de novo
    if (checkinsConsecutivos > 0) {
      // Verificar se houve resposta do lead após o último check-in
      const idxUltimoCheckin = msgs.findIndex(m => m === ultimaMsgBot);
      const msgsAposCheckin = msgs.slice(idxUltimoCheckin + 1).filter(m => m.role === "user");
      if (msgsAposCheckin.length === 0) {
        return { podeEnviar: false, motivo: `lead não respondeu ao último check-in (${checkinsConsecutivos} check-ins sem resposta)` };
      }
    }

    // 4. Deduplicação: a mensagem que vamos enviar é igual à última?
    const mensagemAEnviar = montarCheckin(lead);
    for (const m of ultimasBot) {
      const cont = (m.content || "").replace(/^\[CHECK-IN PROATIVO[^\]]*\]:\s*/, "").trim();
      if (cont === mensagemAEnviar) {
        return { podeEnviar: false, motivo: "mensagem idêntica já enviada anteriormente" };
      }
    }

    // 5. Verificar se a última mensagem do lead foi há menos de 24h
    // (o JOIN já filtra isso, mas dupla verificação)
    const r2 = await client.query("SELECT updated_at FROM conversations WHERE phone=$1", [lead.phone]);
    if (r2.rows.length > 0 && r2.rows[0].updated_at) {
      const horasDesdeUltima = (Date.now() - new Date(r2.rows[0].updated_at).getTime()) / (1000 * 60 * 60);
      if (horasDesdeUltima < 24) {
        return { podeEnviar: false, motivo: `última interação há ${horasDesdeUltima.toFixed(1)}h (mínimo 24h)` };
      }
    }

    return { podeEnviar: true, motivo: "aprovado" };
  } catch(e) {
    console.error("auditarConversa error:", e.message);
    return { podeEnviar: false, motivo: `erro na auditoria: ${e.message}` };
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  let client;
  try {
    client = await getDB();

    // Buscar leads em qualquer etapa do funil sem resposta há >24h
    // TRAVAS:
    // - c.updated_at IS NOT NULL: só leads com conversa real
    // - >24h de inatividade (antes era 4h, muito agressivo)
    // - 12h desde último check-in
    // - máximo 2 check-ins por lead
    // - excluir números internos
    const r = await client.query(`
      SELECT l.phone, l.nome, l.etapa_funil, l.status, l.cidade, l.empresa,
             c.updated_at as ultima_msg,
             l.ultimo_checkin,
             l.checkin_count
      FROM leads l
      INNER JOIN conversations c ON l.phone = c.phone
      WHERE l.etapa_funil IN ('abertura', 'entendimento', 'educacao', 'recomendacao', 'materiais', 'proposta', 'fechamento')
        AND l.status NOT IN ('fechado', 'reuniao', 'perdido', 'timing_capturado', 'followup', 'recusou', 'nutricao')
        AND l.etapa_funil NOT IN ('followup')
        AND c.updated_at < NOW() - INTERVAL '24 hours'
        AND c.messages IS NOT NULL AND LENGTH(c.messages) > 10
        AND l.phone IS NOT NULL
        AND l.phone NOT IN ('5511995650925', '5515997517779', '5511999999999', '5511921276113', '5511933082786', '55119999876435')
        -- Excluir números internos e de teste
        -- BLOQUEIO ANTI-SPAM: não mandar check-in se já mandou nas últimas 12h
        AND (l.ultimo_checkin IS NULL OR l.ultimo_checkin < NOW() - INTERVAL '12 hours')
        -- LIMITE: máximo 2 check-ins por lead (depois disso só reativação manual ou por timing)
        AND (l.checkin_count IS NULL OR l.checkin_count < 2)
        -- RESPEITO: lead pediu espaço explicitamente (ex: "eu te chamo na segunda")
        AND (l.aguarda_contato_ate IS NULL OR l.aguarda_contato_ate < NOW())
      ORDER BY c.updated_at ASC
      LIMIT 10
    `);

    const leads = r.rows;
    console.log(`Check-in proativo: ${leads.length} leads elegíveis (após filtro SQL)`);

    const resultados = [];
    let bloqueados = 0;

    for (const lead of leads) {
      // ═══ AUDITORIA PRÉ-ENVIO ═══
      const auditoria = await auditarConversa(client, lead);
      if (!auditoria.podeEnviar) {
        bloqueados++;
        resultados.push({ phone: lead.phone, nome: lead.nome, etapa: lead.etapa_funil, ok: false, bloqueado: true, motivo: auditoria.motivo });
        console.log(`🚫 BLOQUEADO [${lead.phone}] ${lead.nome}: ${auditoria.motivo}`);
        continue;
      }

      const mensagem = montarCheckin(lead);

      // Tentar enviar como texto (se janela 24h aberta)
      let ok = await sendMsg(lead.phone, mensagem);

      // Se falhar (janela fechada), tentar template
      if (!ok) {
        console.log(`Janela fechada pra ${lead.phone}, tentando template...`);
        const nome = lead.nome ? lead.nome.split(" ")[0] : "tudo bem";
        ok = await sendTemplate(lead.phone, "ooba_reativacao_followup", [nome]);
      }

      if (ok) {
        // Salvar no historico
        try {
          const hist = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
          if (hist.rows.length > 0) {
            const msgs = JSON.parse(hist.rows[0].messages);
            msgs.push({ role: "assistant", content: `[CHECK-IN PROATIVO - ${lead.etapa_funil}]: ${mensagem}` });
            await client.query("UPDATE conversations SET messages=$1 WHERE phone=$2", [JSON.stringify(msgs.slice(-100)), lead.phone]);
          }
        } catch(e) { console.error("Hist update:", e.message); }

        // Atualizar status + registrar check-in
        await client.query("UPDATE leads SET status='checkin_proativo', updated_at=NOW(), ultimo_checkin=NOW(), checkin_count=COALESCE(checkin_count, 0) + 1 WHERE phone=$1", [lead.phone]);

        resultados.push({ phone: lead.phone, nome: lead.nome, etapa: lead.etapa_funil, ok: true });
        console.log(`✅ Check-in: ${lead.phone} (${lead.nome}) — etapa: ${lead.etapa_funil}`);
      } else {
        resultados.push({ phone: lead.phone, nome: lead.nome, etapa: lead.etapa_funil, ok: false, motivo: "falha no envio WA" });
        console.log(`❌ Check-in falhou: ${lead.phone} (${lead.nome}) — etapa: ${lead.etapa_funil}`);
      }

      // Aguardar 8s entre mensagens (mais natural)
      await new Promise(r => setTimeout(r, 8000));
    }

    return res.json({
      success: true,
      total_elegiveis: leads.length,
      bloqueados_auditoria: bloqueados,
      enviados: resultados.filter(r => r.ok).length,
      falhos: resultados.filter(r => !r.ok && !r.bloqueado).length,
      detalhes: resultados
    });

  } catch(e) {
    console.error("ERR checkin_proativo:", e.message);
    return res.status(500).json({ error: String(e) });
  } finally {
    if (client) await client.end().catch(() => {});
  }
};
