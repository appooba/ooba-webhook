// ═══════════════════════════════════════════════════════
// OOBA — Reativação por Timing
// POST /api/reativar_timing
// Chamado diariamente pela automação
// Busca leads cuja timing_data chegou e reativa com template
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

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  let client;
  try {
    client = await getDB();

    // Buscar leads cuja timing_data chegou (hoje ou antes) e ainda não foram reativados
    const r = await client.query(`
      SELECT * FROM leads
      WHERE timing_data IS NOT NULL
        AND timing_data <= CURRENT_DATE
        AND (reativado IS FALSE OR reativado IS NULL)
        AND status = 'timing_capturado'
        AND etapa_funil NOT IN ('fechado', 'reuniao')
      ORDER BY timing_data ASC
      LIMIT 20
    `);

    const leads = r.rows;
    console.log(`Reativacao timing: ${leads.length} leads elegiveis`);

    const resultados = [];

    for (const lead of leads) {
      const nome = lead.nome ? lead.nome.split(" ")[0] : "tudo bem";
      const timingTxt = lead.timing_anunciar || "";
      
      // Usar template ooba_consulta_marketing (aprovado) para reabrir janela 24h
      const ok = await sendTemplate(lead.phone, "ooba_consulta_marketing", [nome]);

      if (ok) {
        // Marcar como reativado e atualizar status
        await client.query(`
          UPDATE leads SET
            reativado = TRUE,
            status = 'reativado',
            etapa_funil = 'abertura',
            origem = 'reativacao_timing',
            updated_at = NOW()
          WHERE phone = $1
        `, [lead.phone]);

        // Adicionar nota no historico
        try {
          const hist = await client.query("SELECT messages FROM conversations WHERE phone=$1", [lead.phone]);
          if (hist.rows.length > 0) {
            const msgs = JSON.parse(hist.rows[0].messages);
            msgs.push({ role: "assistant", content: `[REATIVACAO TIMING: Lead disse que queria anunciar em ${timingTxt}. Template enviado pra reabrir janela. Aguardando resposta.]` });
            await client.query("UPDATE conversations SET messages=$1 WHERE phone=$2", [JSON.stringify(msgs), lead.phone]);
          }
        } catch(e) { console.error("Hist update:", e.message); }

        resultados.push({ phone: lead.phone, nome: lead.nome, timing: timingTxt, ok: true });
        console.log(`✅ Reativado por timing: ${lead.phone} (${lead.nome}) — timing: ${timingTxt}`);
      } else {
        resultados.push({ phone: lead.phone, nome: lead.nome, timing: timingTxt, ok: false });
      }

      // Aguardar 5 segundos entre mensagens
      await new Promise(r => setTimeout(r, 5000));
    }

    return res.json({
      success: true,
      total_processados: leads.length,
      enviados: resultados.filter(r => r.ok).length,
      falhos: resultados.filter(r => !r.ok).length,
      detalhes: resultados
    });

  } catch(e) {
    console.error("ERR reativar_timing:", e.message);
    return res.status(500).json({ error: String(e) });
  } finally {
    if (client) await client.end().catch(() => {});
  }
};
