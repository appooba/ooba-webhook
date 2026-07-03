#!/usr/bin/env python3
"""
Skill: Aprendizado Automático — Luana Vendas
Analisa conversas, identifica padrões, gera patches de melhoria.
Schema: prompt_patches (conteudo, problema, patch_type, ativo, sugestao, fonte, trigger)
"""
import os, json, psycopg2, datetime, urllib.request

DB_URL = os.environ.get("DATABASE_URL", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")

if not DB_URL or not OPENAI_KEY:
    print("❌ DATABASE_URL ou OPENAI_API_KEY não configurados")
    exit(1)

conn = psycopg2.connect(DB_URL, sslmode="require")
cur = conn.cursor()

# 1. Buscar conversas recentes (últimas 6h)
cur.execute("""
    SELECT c.phone, c.messages, l.nome, l.etapa_funil, l.status, l.origem,
           l.empresa, l.updated_at
    FROM conversations c
    LEFT JOIN leads l ON c.phone = l.phone
    WHERE c.updated_at > NOW() - INTERVAL '6 hours'
       OR (l.etapa_funil IS NOT NULL AND l.updated_at > NOW() - INTERVAL '6 hours')
    ORDER BY c.updated_at DESC
    LIMIT 20
""")
conversas = cur.fetchall()

if not conversas:
    print("📊 Nenhuma conversa nova desde a última análise.")
    cur.close()
    conn.close()
    exit(0)

print(f"📊 {len(conversas)} conversas encontradas para análise")

# 2. Buscar patches existentes pra não duplicar
cur.execute("SELECT conteudo, problema FROM prompt_patches WHERE ativo = true")
patches_rows = cur.fetchall()
patches_existentes = [(r[0] or "", r[1] or "") for r in patches_rows]
print(f"🧠 {len(patches_existentes)} patches já ativos")

# 3. Buscar dados de gargalos do funil
try:
    cur.execute("""
        SELECT etapa_anterior, etapa_nova, COUNT(*) as total
        FROM funil_transicoes
        WHERE created_at > NOW() - INTERVAL '7 days'
        GROUP BY etapa_anterior, etapa_nova
        ORDER BY COUNT(*) DESC
    """)
    transicoes = cur.fetchall()
except:
    transicoes = []

cur.execute("""
    SELECT etapa_funil, COUNT(*) as total
    FROM leads
    WHERE etapa_funil IS NOT NULL
    GROUP BY etapa_funil
""")
distribuicao = cur.fetchall()

# 4. Preparar contexto para o GPT analisar
contexto_conversas = []
for c in conversas:
    phone, messages, nome, etapa, status, origem, empresa, updated = c
    try:
        msgs = json.loads(messages) if isinstance(messages, str) else messages
        if isinstance(msgs, list):
            resumo = []
            for m in msgs[-20:]:
                role = m.get("role", "?")
                content = m.get("content", "")[:200]
                resumo.append(f"[{role}] {content}")
            contexto_conversas.append({
                "phone": phone,
                "nome": nome,
                "etapa": etapa,
                "status": status,
                "origem": origem,
                "empresa": empresa,
                "mensagens": resumo[-10:]
            })
    except:
        continue

if not contexto_conversas:
    print("📊 Conversas sem conteúdo suficiente para análise.")
    cur.close()
    conn.close()
    exit(0)

# 5. Enviar para GPT analisar e gerar patches
prompt_sistema = """Você é um analista de vendas especializado em WhatsApp. Analise conversas entre a Luana (consultora da OOBA Mídia Indoor) e leads.

Sua tarefa:
1. Identificar erros de condução (onde a Luana perdeu o lead, foi genérica, não sondou objeção, desistiu cedo)
2. Identificar acertos (o que funcionou bem e deve ser mantido)
3. Identificar padrões de objeção dos leads
4. Gerar PATCHES de melhoria — instruções curtas e específicas que serão injetadas no prompt da Luana

Também analise os GARGALOS do funil:
- Se muitos leads travam numa etapa, proponha uma correção estrutural

REGRAS DOS PATCHES:
- Cada patch deve ser UMA instrução clara e acionável (máx 3 linhas)
- Não contradiga as regras existentes (nunca fale preço cedo, sempre seja consultiva)
- Foque em comportamento, não em estrutura de código
- Máximo 4 patches por rodada (priorize os mais impactantes)

Responda APENAS em JSON:
{
  "patches": [
    {
      "conteudo": "instrução clara e direta",
      "problema": "descrição do problema identificado",
      "patch_type": "objection_handling | argument | flow_fix | tone | discovery",
      "sugestao": "o que a Luana deveria fazer diferente",
      "fonte": "telefone do lead que gerou o insight"
    }
  ],
  "gargalo_principal": "etapa com maior problema",
  "sugestao_estrutural": "sugestão de melhoria estrutural do funil"
}
"""

prompt_usuario = f"""
PATCHES JÁ ATIVOS (não duplicar):
{chr(10).join(f"- [{r[1][:40] if r[1] else '?'}] {r[0][:80]}" for r in patches_existentes[:10])}

DISTRIBUIÇÃO ATUAL DO FUNIL:
{chr(10).join(f"- {d[0]}: {d[1]} leads" for d in distribuicao)}

TRANSIÇÕES (últimos 7 dias):
{chr(10).join(f"- {t[0]} → {t[1]}: {t[2]}x" for t in transicoes) if transicoes else "Nenhuma transição registrada"}

CONVERSAS RECENTES:
"""

for c in contexto_conversas[:5]:
    prompt_usuario += f"\n--- Lead: {c['nome'] or c['phone']} | Etapa: {c['etapa']} | Status: {c['status']} | Origem: {c['origem']} ---\n"
    for m in c['mensagens']:
        prompt_usuario += f"{m}\n"

# Chamar GPT
data = json.dumps({
    "model": "gpt-4o-mini",
    "messages": [
        {"role": "system", "content": prompt_sistema},
        {"role": "user", "content": prompt_usuario}
    ],
    "temperature": 0.3,
    "max_tokens": 1500
}).encode()

req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=data,
    headers={
        "Authorization": f"Bearer {OPENAI_KEY}",
        "Content-Type": "application/json"
    }
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        result = json.loads(resp.read())
        resposta = result["choices"][0]["message"]["content"]
        
        # Tentar parsear JSON
        try:
            analise = json.loads(resposta)
        except:
            import re
            match = re.search(r'\{.*\}', resposta, re.DOTALL)
            if match:
                analise = json.loads(match.group())
            else:
                print(f"⚠️ Resposta não-JSON do GPT: {resposta[:200]}")
                analise = {"patches": []}
        
        patches_novos = analise.get("patches", [])
        gargalo = analise.get("gargalo_principal", "")
        sugestao_estrutural = analise.get("sugestao_estrutural", "")
        
        novos_salvos = 0
        for p in patches_novos:
            conteudo = (p.get("conteudo") or "").strip()
            problema = (p.get("problema") or "").strip()
            sugestao = (p.get("sugestao") or "").strip()
            patch_type = (p.get("patch_type") or "general").strip()
            fonte = (p.get("fonte") or "auto").strip()
            
            if not conteudo:
                continue
            
            # Verificar duplicata: compara primeiros 60 caracteres do conteudo
            ja_existe = any(
                conteudo[:60] in (existing_conteudo or "")[:60]
                for existing_conteudo, _ in patches_existentes
            )
            if ja_existe:
                continue
            
            today = datetime.date.today().isoformat()
            cur.execute("""
                INSERT INTO prompt_patches 
                (semana, patch_type, trigger, conteudo, ativo, eficacia_score, 
                 fonte, problema, sugestao, aplicado, created_at)
                VALUES (%s, %s, 'auto', %s, true, 0, %s, %s, %s, true, NOW())
            """, [today, patch_type, conteudo, fonte, problema, sugestao])
            
            novos_salvos += 1
            print(f"  ✅ [{patch_type}] {conteudo[:80]}")
            patches_existentes.append((conteudo, problema))
        
        # Log da análise estrutural (como patch inativo ou log separado)
        if gargalo:
            cur.execute("""
                INSERT INTO prompt_patches 
                (semana, patch_type, trigger, conteudo, ativo, eficacia_score,
                 fonte, problema, sugestao, aplicado, created_at)
                VALUES (%s, 'analise_estrutural', 'auto', %s, false, 0,
                        'auto', %s, %s, false, NOW())
            """, [today, f"GARGALO: {gargalo}", gargalo, sugestao_estrutural[:500] if sugestao_estrutural else ""])
        
        conn.commit()
        
        print(f"\n🆕 Novos patches salvos: {novos_salvos}")
        print(f"♻️ Duplicados evitados: {len(patches_novos) - novos_salvos}")
        if gargalo:
            print(f"📊 Gargalo principal: {gargalo}")
        if sugestao_estrutural:
            print(f"💡 Sugestão estrutural: {sugestao_estrutural[:150]}")
        
except Exception as e:
    print(f"❌ Erro ao chamar GPT: {e}")

# Estatísticas finais
cur.execute("SELECT count(*) FROM prompt_patches WHERE ativo = true")
total_ativos = cur.fetchone()[0]
print(f"\n📈 Total de patches ativos: {total_ativos}")

cur.close()
conn.close()
