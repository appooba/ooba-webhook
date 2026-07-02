const { Client } = require("pg");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { secret } = req.body || {};
  if (secret !== "ooba2026") return res.status(403).json({ error: "Unauthorized" });
  
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  
  try {
    await client.connect();
    
    const report = { data: new Date().toISOString(), acoes: [], metricas: {} };
    
    // 1. Métricas gerais
    const metrics = await client.query(`
      SELECT etapa_funil, COUNT(*) as total, MAX(updated_at) as ultima
      FROM leads WHERE status NOT IN ('fechado', 'perdido')
      GROUP BY etapa_funil ORDER BY COUNT(*) DESC
    `);
    report.metricas.distribuicao = metrics.rows;
    
    // 2. Leads estagnados
    const estagnados = await client.query(`
      SELECT phone, nome, etapa_funil, updated_at,
             EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 as dias
      FROM leads WHERE status NOT IN ('fechado', 'perdido')
        AND updated_at < NOW() - INTERVAL '3 days'
      ORDER BY updated_at ASC
    `);
    
    for (const lead of estagnados.rows) {
      const dias = Math.floor(lead.dias);
      if (lead.etapa_funil === 'abertura' && dias > 7) {
        await client.query("UPDATE leads SET status = 'frio', updated_at = NOW() WHERE phone = $1", [lead.phone]);
        report.acoes.push("Lead " + (lead.nome || lead.phone) + " marcado como FRIO (" + dias + "d sem resposta)");
      } else if (lead.etapa_funil !== 'abertura' && dias > 3) {
        report.acoes.push("Lead " + (lead.nome || lead.phone) + " estagnado em " + lead.etapa_funil + " ha " + dias + "d");
      }
    }
    
    // 3. Pós-reunião
    const posReuniao = await client.query(`
      SELECT phone, nome, reuniao_data FROM leads 
      WHERE status = 'reuniao_agendada' AND reuniao_data IS NOT NULL
    `);
    for (const lead of posReuniao.rows) {
      const dataReuniao = new Date(lead.reuniao_data);
      const diffDias = Math.floor((new Date() - dataReuniao) / 86400000);
      if (diffDias >= 1 && diffDias <= 5) {
        report.acoes.push("Lead " + lead.nome + " teve reuniao ha " + diffDias + "d — follow-up necessario");
      } else if (diffDias > 5) {
        report.acoes.push("Lead " + lead.nome + " reuniao ha " + diffDias + "d — reabordagem urgente");
      }
    }
    
    // 4. Transições
    const transicoes = await client.query(`
      SELECT etapa_anterior, COUNT(DISTINCT phone) as avancaram
      FROM funil_transicoes WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY etapa_anterior
    `);
    report.metricas.transicoes_7d = transicoes.rows;
    
    // 5. Patches ativos
    const patches = await client.query("SELECT count(*) as total FROM prompt_patches WHERE ativo = true");
    report.metricas.patches_ativos = parseInt(patches.rows[0].total);
    
    // 6. Conversão total
    const totalLeads = await client.query("SELECT count(*) as total FROM leads");
    const fechados = await client.query("SELECT count(*) as total FROM leads WHERE status = 'fechado'");
    report.metricas.total_leads = parseInt(totalLeads.rows[0].total);
    report.metricas.fechados = parseInt(fechados.rows[0].total);
    report.metricas.taxa_conversao = totalLeads.rows[0].total > 0 
      ? ((fechados.rows[0].total / totalLeads.rows[0].total) * 100).toFixed(1) + "%" : "0%";
    
    // 7. Novos 24h
    const novosHoje = await client.query("SELECT count(*) as total FROM leads WHERE created_at > NOW() - INTERVAL '24 hours'");
    report.metricas.novos_24h = parseInt(novosHoje.rows[0].total);
    
    await client.end();
    res.status(200).json(report);
  } catch (err) {
    try { await client.end(); } catch(e) {}
    res.status(500).json({ error: err.message });
  }
};
