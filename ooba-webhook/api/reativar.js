// ═══════════════════════════════════════════════════════
// OOBA — Sistema de Reativação de Leads (unificado)
// POST /api/reativar           → reativação de leads frios
// POST /api/reativar?mode=timing → reativação por timing
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
  const res = await fetch(`https://graph.facebook.com/v19.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } })
  });
  const d = await res.json();
  if (d?.error) { console.error("WA error:", JSON.stringify(d.error)); return false; }
  return true;
}

async function sendTemplate(to, templateName, params) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${PID}/messages`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${WAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to, type: "template",
      template: { name: templateName, language: { code: "pt_BR" },
        components: [{ type: "body", parameters: params.map(p => ({ type: "text", text: p })) }] }
    })
  });
  const d = await res.json();
  if (d?.error) { console.error("WA template error:", JSON.stringify(d.error)); return false; }
  return true;
}

function montarMensagem(lead) {
  const nome = lead.nome ? lead.nome.split(" ")[0] : null;
  const saudacao = nome ? `Oi ${nome}! 👋` : `Oi! 👋`;
  if (lead.ja_anunciou && lead.telas_anunciadas) {
    return `${saudacao} Sou a Luana da OOBA Mídia Indoor! 😊\n\nVocê já anunciou conosco ${lead.telas_anunciadas ? `na ${lead.telas_anunciadas}` : "nas nossas telas"} — e queria saber se está no momento certo de retomar a divulgação da sua marca.\n\nTemos novidades nas telas e já passamos de +97 mil pessoas/mês em Porto Feliz e Boituva! 🚀\n\nQuer que eu te mostre as opções disponíveis hoje?`;
  }
  if (lead.negocio) {
    return `${saudacao} Sou a Luana da OOBA Mídia Indoor! 😊\n\nA gente já conversou antes sobre divulgar a ${lead.negocio} nas nossas telas.\n\nQueria saber se hoje é um bom momento pra retomar — temos espaços disponíveis e já passamos de +97 mil pessoas/mês nos nossos pontos! 📍\n\nPosso te mostrar as novidades?`;
  }
  return `${saudacao} Sou a Luana, consultora da OOBA Mídia Indoor! 😊\n\nA OOBA leva sua marca para +97 mil pessoas/mês em locais de alta permanência em Porto Feliz e Boituva — cafeterias, pizzarias, academias, restaurantes.\n\nSeu anúncio em vídeo de 15 segundos aparece de 6 a 7 vezes pra mesma pessoa. 🎯\n\nPosso te contar como funciona?`;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const mode = req.query?.mode || "frios";
  let client;

  try {
    client = await getDB();

    if (mode === "timing") {
      // ═══ REATIVAÇÃO POR TIMING ═══
      const r = await client.query(`
        SELECT * FROM leads
        WHERE timing_data IS NOT NULL
          AND timing_data <= CURRENT_DATE
          AND (reativado IS FALSE OR reativado IS NULL)
          AND status = 'timing_capturado'
          AND etapa_funil NOT IN ('fechado', 'reuniao', 'perdido', 'followup', 'nutricao')
        AND status NOT IN ('recusou', 'perdido', 'followup', 'nutricao')
        ORDER BY timing_data ASC LIMIT 20
      `);

      const leads = r.rows;
      console.log(`Reativacao timing: ${leads.length} leads elegiveis`);
      const resultados = [];

      for (const lead of leads) {
        const nome = lead.nome ? lead.nome.split(" ")[0] : "tudo bem";
        const ok = await sendTemplate(lead.phone, "ooba_reativacao_followup", [nome]);

        if (ok) {
          await client.query(`UPDATE leads SET reativado=TRUE, status='reativado', etapa_funil='abertura', origem='reativacao_timing', updated_at=NOW() WHERE phone=$1`, [lead.phone]);
          try {
            const hist = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
            if (hist.rows.length > 0) {
              const msgs = JSON.parse(hist.rows[0].messages);
              msgs.push({ role: "assistant", content: `[REATIVACAO TIMING: Lead disse que queria anunciar em ${lead.timing_anunciar || ""}. Template enviado. Aguardando resposta.]` });
              await client.query("UPDATE conversations SET messages=$1 WHERE phone=$2", [JSON.stringify(msgs), lead.phone]);
            }
          } catch(e) {}
          resultados.push({ phone: lead.phone, nome: lead.nome, timing: lead.timing_anunciar, ok: true });
        } else {
          resultados.push({ phone: lead.phone, nome: lead.nome, timing: lead.timing_anunciar, ok: false });
        }
        await new Promise(r => setTimeout(r, 5000));
      }

      return res.json({ success: true, mode: "timing", total_processados: leads.length, enviados: resultados.filter(r => r.ok).length, falhos: resultados.filter(r => !r.ok).length, detalhes: resultados });
    }

    // ═══ REATIVAÇÃO DE LEADS FRIOS (padrão) ═══
    const r = await client.query(`
      SELECT * FROM leads
      WHERE abordagem_ativa = TRUE
        AND etapa_funil NOT IN ('fechado', 'reuniao', 'perdido', 'followup', 'nutricao')
        AND status NOT IN ('recusou', 'perdido', 'followup', 'nutricao')
        AND (data_ultima_abordagem IS NULL OR data_ultima_abordagem < NOW() - INTERVAL '30 days')
        AND total_abordagens < 3
      ORDER BY ja_anunciou DESC, potencial_retorno DESC, created_at ASC LIMIT 20
    `);

    const leads = r.rows;
    console.log(`Reativação frios: ${leads.length} leads elegíveis`);
    const resultados = [];

    for (const lead of leads) {
      const mensagem = montarMensagem(lead);
      const ok = await sendMsg(lead.phone, mensagem);

      if (ok) {
        await client.query(`UPDATE leads SET data_ultima_abordagem=NOW(), total_abordagens=total_abordagens+1, etapa_funil=CASE WHEN etapa_funil='perdido' THEN 'abertura' ELSE etapa_funil END, updated_at=NOW() WHERE phone=$1`, [lead.phone]);
        await client.query(`DELETE FROM conversations WHERE phone=$1`, [lead.phone]);
        resultados.push({ phone: lead.phone, nome: lead.nome, ok: true });
      } else {
        resultados.push({ phone: lead.phone, nome: lead.nome, ok: false });
      }
      await new Promise(r => setTimeout(r, 3000));
    }

    return res.json({ success: true, mode: "frios", total_processados: leads.length, enviados: resultados.filter(r => r.ok).length, falhos: resultados.filter(r => !r.ok).length, detalhes: resultados });

  } catch(e) {
    console.error("ERR reativar:", e.message);
    return res.status(500).json({ error: String(e) });
  } finally {
    if (client) await client.end().catch(() => {});
  }
};
