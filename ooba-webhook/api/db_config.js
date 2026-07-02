// ══════════════════════════════════════════════════════════════
// OOBA — Camada de configuração vinda do banco (NÃO hardcoded)
// Tudo que antes era constante no código agora vive no Neon Postgres
// Mudou preço? UPDATE no banco. Nova tela? INSERT. Zero deploy.
// ══════════════════════════════════════════════════════════════

const { Client } = require("pg");

async function getConfig(key) {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  try {
    await client.connect();
    const r = await client.query("SELECT value FROM agent_config WHERE key = $1", [key]);
    await client.end();
    return r.rows.length > 0 ? r.rows[0].value : null;
  } catch(e) {
    try { await client.end(); } catch(_) {}
    return null;
  }
}

async function getAllConfig() {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  try {
    await client.connect();
    const r = await client.query("SELECT key, value FROM agent_config");
    await client.end();
    const config = {};
    for (const row of r.rows) {
      config[row.key] = row.value;
    }
    return config;
  } catch(e) {
    try { await client.end(); } catch(_) {}
    return {};
  }
}

async function getTelas(cidade = null) {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  try {
    await client.connect();
    const r = await client.query(
      "SELECT * FROM telas_config WHERE ativa = true ORDER BY ordem ASC"
    );
    await client.end();
    let telas = r.rows;
    if (cidade) {
      const cid = cidade.toLowerCase();
      if (cid.includes("boituva") && !cid.includes("porto feliz")) {
        telas = telas.filter(t => t.cidade === "boituva");
      } else if (cid.includes("porto feliz") && !cid.includes("boituva")) {
        telas = telas.filter(t => t.cidade === "porto feliz");
      }
    }
    return telas;
  } catch(e) {
    try { await client.end(); } catch(_) {}
    return [];
  }
}

async function getConflictRules() {
  const client = new Client({ 
    connectionString: process.env.DATABASE_URL, 
    ssl: { rejectUnauthorized: false } 
  });
  try {
    await client.connect();
    const r = await client.query("SELECT palavras, telas_bloqueadas FROM screen_conflicts");
    await client.end();
    return r.rows;
  } catch(e) {
    try { await client.end(); } catch(_) {}
    return [];
  }
}

async function getTelasFiltradas(negocio, cidade) {
  const telas = await getTelas(cidade);
  const regras = await getConflictRules();
  const neg = (negocio || "").toLowerCase();
  
  const bloqueadas = new Set();
  for (const regra of regras) {
    for (const palavra of regra.palavras) {
      if (neg.includes(palavra.toLowerCase())) {
        regra.telas_bloqueadas.forEach(t => bloqueadas.add(t));
        break;
      }
    }
  }
  
  return telas
    .filter(t => !bloqueadas.has(t.nome))
    .map(t => ({
      nome: t.nome,
      fluxo: t.fluxo,
      horario: t.horario,
      video: t.video_url,
      descricao: t.descricao,
      cidade: t.cidade
    }));
}

module.exports = { getConfig, getAllConfig, getTelas, getConflictRules, getTelasFiltradas };
