// ═══════════════════════════════════════════════════════
// OOBA — Importação de Lista de Leads/Ex-Clientes
// POST /api/importar
// Body: { leads: [...] }
// ═══════════════════════════════════════════════════════

const { Client } = require("pg");
const DATABASE_URL = process.env.DATABASE_URL || "";

async function getDB() {
  const client = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  return client;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const { leads, token } = req.body || {};

  // Autenticação simples
  if (token !== "ooba2026") return res.status(401).json({ error: "unauthorized" });
  if (!leads || !Array.isArray(leads)) return res.status(400).json({ error: "leads deve ser um array" });

  let client;
  try {
    client = await getDB();
    const resultados = [];

    for (const lead of leads) {
      // Normalizar telefone: remover tudo que não é número e garantir 55 no início
      let phone = String(lead.telefone || lead.phone || "").replace(/\D/g, "");
      if (!phone) { resultados.push({ erro: "sem telefone", lead }); continue; }
      if (!phone.startsWith("55")) phone = "55" + phone;

      const dados = {
        phone,
        nome: lead.nome || null,
        email: lead.email || null,
        negocio: lead.negocio || lead.empresa || null,
        cidade: lead.cidade || "Porto Feliz",
        ja_anunciou: lead.ja_anunciou === true || lead.ja_anunciou === "sim" || false,
        telas_anunciadas: lead.telas_anunciadas || lead.telas || null,
        periodo_anuncio: lead.periodo_anuncio || null,
        motivo_saida: lead.motivo_saida || null,
        potencial_retorno: lead.potencial_retorno || "medio",
        tags: lead.tags || (lead.ja_anunciou ? "ex_cliente" : "lista_fria"),
        tipo_lead: lead.ja_anunciou ? "ex_cliente" : (lead.tipo_lead || "outbound"),
        abordagem_ativa: true,
        etapa_funil: "abertura",
        status: "novo",
      };

      await client.query(`
        INSERT INTO leads (
          phone, nome, email, negocio, cidade,
          ja_anunciou, telas_anunciadas, periodo_anuncio, motivo_saida,
          potencial_retorno, tags, tipo_lead, abordagem_ativa,
          etapa_funil, status, first_message, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9,
          $10, $11, $12, $13,
          $14, $15, 'importado', NOW(), NOW()
        )
        ON CONFLICT (phone) DO UPDATE SET
          nome = COALESCE($2, leads.nome),
          email = COALESCE($3, leads.email),
          negocio = COALESCE($4, leads.negocio),
          cidade = COALESCE($5, leads.cidade),
          ja_anunciou = $6,
          telas_anunciadas = COALESCE($7, leads.telas_anunciadas),
          periodo_anuncio = COALESCE($8, leads.periodo_anuncio),
          motivo_saida = COALESCE($9, leads.motivo_saida),
          potencial_retorno = $10,
          tags = $11,
          tipo_lead = $12,
          abordagem_ativa = $13,
          updated_at = NOW()
      `, [
        dados.phone, dados.nome, dados.email, dados.negocio, dados.cidade,
        dados.ja_anunciou, dados.telas_anunciadas, dados.periodo_anuncio, dados.motivo_saida,
        dados.potencial_retorno, dados.tags, dados.tipo_lead, dados.abordagem_ativa,
        dados.etapa_funil, dados.status
      ]);

      resultados.push({ phone, nome: dados.nome, ok: true });
    }

    const ok = resultados.filter(r => r.ok).length;
    const erros = resultados.filter(r => r.erro).length;

    console.log(`Importação: ${ok} leads importados, ${erros} erros`);
    return res.json({ success: true, importados: ok, erros, detalhes: resultados });

  } catch(e) {
    console.error("ERR importar:", e.message);
    return res.status(500).json({ error: String(e) });
  } finally {
    if (client) await client.end().catch(() => {});
  }
};
