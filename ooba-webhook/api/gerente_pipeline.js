// Endpoint: POST /api/gerente_pipeline
// Orquestrador diário — analisa todo o pipeline e toma ações
// Body: { secret: "ooba2026" }

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { secret } = req.body || {};
  if (secret !== "ooba2026") return res.status(403).json({ error: "Unauthorized" });
  
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { require: true } });
  const client = await pool.connect();
  
  const report = {
    data: new Date().toISOString(),
    acoes: [],
    metricas: {}
  };
  
  // 1. Métricas gerais do pipeline
  const metrics = await client.query(`
    SELECT 
      etapa_funil,
      COUNT(*) as total,
      MAX(updated_at) as ultima_atualizacao
    FROM leads 
    WHERE status NOT IN ('fechado', 'perdido')
    GROUP BY etapa_funil
    ORDER BY COUNT(*) DESC
  `);
  report.metricas.distribuicao = metrics.rows;
  
  // 2. Leads estagnados por mais de 3 dias em qualquer etapa
  const estagnados = await client.query(`
    SELECT phone, nome, etapa_funil, updated_at,
           EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 as dias
    FROM leads 
    WHERE status NOT IN ('fechado', 'perdido')
      AND updated_at < NOW() - INTERVAL '3 days'
    ORDER BY updated_at ASC
  `);
  
  for (const lead of estagnados.rows) {
    const dias = Math.floor(lead.dias);
    // Se está na abertura há mais de 3 dias e é prospecção → marcar como frio
    if (lead.etapa_funil === 'abertura' && dias > 7) {
      await client.query("UPDATE leads SET status = 'frio', updated_at = NOW() WHERE phone = $1", [lead.phone]);
      report.acoes.push(`Lead ${lead.nome || lead.phone} marcado como FRIO (${dias}d sem resposta na abertura)`);
    }
    // Se está em etapa avançada e parou → seguir follow-up (já tratado por automações separadas)
    else if (lead.etapa_funil !== 'abertura' && dias > 3) {
      report.acoes.push(`Lead ${lead.nome || lead.phone} estagnado em ${lead.etapa_funil} há ${dias}d — follow-up automático já configurado`);
    }
  }
  
  // 3. Leads que precisam de follow-up pós-reunião
  const posReuniao = await client.query(`
    SELECT phone, nome, reuniao_data, reuniao_hora
    FROM leads 
    WHERE status = 'reuniao_agendada'
      AND reuniao_data IS NOT NULL
  `);
  
  for (const lead of posReuniao.rows) {
    const dataReuniao = new Date(lead.reuniao_data);
    const agora = new Date();
    const diffDias = Math.floor((agora - dataReuniao) / 86400000);
    
    if (diffDias >= 1 && diffDias <= 5) {
      report.acoes.push(`Lead ${lead.nome} teve reunião há ${diffDias}d — follow-up de fechamento necessário`);
    } else if (diffDias > 5) {
      report.acoes.push(`Lead ${lead.nome} reunião há ${diffDias}d — tentar reabordagem urgente`);
    }
  }
  
  // 4. Análise de gargalos — identificar pior etapa
  const transicoes = await client.query(`
    SELECT etapa_anterior, COUNT(DISTINCT phone) as avancaram
    FROM funil_transicoes
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY etapa_anterior
  `);
  
  const totalPorEtapa = await client.query(`
    SELECT etapa_funil, COUNT(*) as total
    FROM leads
    GROUP BY etapa_funil
  `);
  
  report.metricas.transicoes_7d = transicoes.rows;
  report.metricas.total_por_etapa = totalPorEtapa.rows;
  
  // 5. Patches ativos
  const patches = await client.query("SELECT count(*) as total FROM prompt_patches WHERE ativo = true");
  report.metricas.patches_ativos = parseInt(patches.rows[0].total);
  
  // 6. Conversão total
  const totalLeads = await client.query("SELECT count(*) as total FROM leads");
  const fechados = await client.query("SELECT count(*) as total FROM leads WHERE status = 'fechado'");
  report.metricas.total_leads = parseInt(totalLeads.rows[0].total);
  report.metricas.fechados = parseInt(fechados.rows[0].total);
  report.metricas.taxa_conversao = totalLeads.rows[0].total > 0 
    ? ((fechados.rows[0].total / totalLeads.rows[0].total) * 100).toFixed(1) + "%"
    : "0%";
  
  // 7. Leads novos hoje (para saber se prospecção está rodando)
  const novosHoje = await client.query(`
    SELECT count(*) as total FROM leads 
    WHERE created_at > NOW() - INTERVAL '24 hours'
  `);
  report.metricas.novos_24h = parseInt(novosHoje.rows[0].total);
  
  client.release();
  
  res.status(200).json(report);
}
