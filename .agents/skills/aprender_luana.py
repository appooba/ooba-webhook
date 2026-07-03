#!/usr/bin/env python3
"""
Skill: Aprendizado Automático — Luana Vendas v2
Analisa conversas, identifica padrões, gera:
  1. Patches de correção (prompt_patches) — filtrados por etapa no webhook
  2. Insights estruturados (aprendizado_insights) — respostas ideais por gatilho
  3. Snapshot semanal (aprendizado_luana) — métricas + gargalos
"""
import os, json, psycopg2, datetime, urllib.request

DB_URL = os.environ.get("DATABASE_URL", "")
OPENAI_KEY = os.environ.get("OPENAI_API_KEY", "")

if not DB_URL or not OPENAI_KEY:
    print("❌ DATABASE_URL ou OPENAI_API_KEY não configurados")
    exit(1)

conn = psycopg2.connect(DB_URL, sslmode="require")
cur = conn.cursor()

# 1. Buscar conversas recentes (últimas 24h para análise semanal, 6h para rodadas curtas)
cur.execute("""
    SELECT c.phone, c.messages, l.nome, l.etapa_funil, l.status, l.origem,
           l.empresa, l.negocio, l.cidade, l.updated_at
    FROM conversations c
    LEFT JOIN leads l ON c.phone = l.phone
    WHERE c.updated_at > NOW() - INTERVAL '24 hours'
    ORDER BY c.updated_at DESC
    LIMIT 30
""")
conversas = cur.fetchall()

if not conversas:
    print("📊 Nenhuma conversa nova para análise.")
    cur.close()
    conn.close()
    exit(0)

print(f"📊 {len(conversas)} conversas encontradas")

# 2. Buscar patches e insights existentes pra não duplicar
cur.execute("SELECT conteudo, problema FROM prompt_patches WHERE ativo = true")
patches_existentes = [(r[0] or "", r[1] or "") for r in cur.fetchall()]

cur.execute("SELECT trigger_padrao, resposta_ideal FROM aprendizado_insights WHERE ativo = true")
insights_existentes = [(r[0] or "", r[1] or "") for r in cur.fetchall()]

print(f"🧠 {len(patches_existentes)} patches ativos | {len(insights_existentes)} insights ativos")

# 3. Métricas do funil
cur.execute("""
    SELECT etapa_funil, COUNT(*) as total
    FROM leads WHERE etapa_funil IS NOT NULL
    GROUP BY etapa_funil
""")
distribuicao = cur.fetchall()

cur.execute("""
    SELECT etapa_anterior, etapa_nova, COUNT(*) as total
    FROM funil_transicoes
    WHERE created_at > NOW() - INTERVAL '7 days'
    GROUP BY etapa_anterior, etapa_nova
    ORDER BY COUNT(*) DESC
""")
transicoes = cur.fetchall()

# Contar métricas gerais
cur.execute("SELECT COUNT(*) FROM leads")
total_leads = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE status = 'fechado' OR etapa_funil = 'fechamento'")
leads_avancados = cur.fetchone()[0]
cur.execute("SELECT COUNT(*) FROM leads WHERE reuniao_data IS NOT NULL")
reunioes = cur.fetchone()[0]

# 4. Preparar contexto
contexto_conversas = []
for c in conversas:
    phone, messages, nome, etapa, status, origem, empresa, negocio, cidade, updated = c
    try:
        msgs = json.loads(messages) if isinstance(messages, str) else messages
        if isinstance(msgs, list) and len(msgs) > 1:
            resumo = []
            for m in msgs[-25:]:
                role = "LEAD" if m.get("role") == "user" else "LUANA"
                content = m.get("content", "")[:300]
                resumo.append(f"[{role}] {content}")
            contexto_conversas.append({
                "phone": phone,
                "nome": nome or "?",
                "etapa": etapa or "?",
                "status": status,
                "origem": origem,
                "negocio": negocio,
                "cidade": cidade,
                "mensagens": resumo[-15:]
            })
    except:
        continue

if not contexto_conversas:
    print("📊 Conversas sem conteúdo suficiente.")
    cur.close()
    conn.close()
    exit(0)

# 5. Prompt do GPT — agora gera patches E insights estruturados
prompt_sistema = """Você é um analista de vendas sênior especializado em WhatsApp. Analise conversas entre a Luana (consultora da OOBA Mídia Indoor) e leads.

Sua tarefa é gerar DOIS tipos de aprendizado:

TIPO 1 — PATCHES DE CORREÇÃO:
- Identifique erros de condução (Luana perdeu o lead, foi genérica, não sondou objeção, desistiu cedo, repetiu info)
- Cada patch = UMA instrução clara e acionável (máx 3 linhas)
- Não contradiga regras existentes (nunca fale preço cedo, sempre seja consultiva)
- Máximo 3 patches por rodada

TIPO 2 — INSIGHTS ESTRUTURADOS:
- Padrões de objeção: o que o lead disse → qual seria a resposta ideal
- Argumentos que funcionam: frases que avançaram a conversa
- Momentos de churn: onde os leads param de responder
- Cada insight tem: trigger (o que o lead disse/fez), resposta_ideal (o que responder), etapa do funil
- Máximo 5 insights por rodada

CATEGORIAS DE INSIGHTS:
- objecao: lead resiste ou recusa
- argumento: algo que convenceu o lead
- fluxo: melhoria de condução da conversa
- discovery: melhor forma de sondar necessidades
- churn: prevenir abandono
- conversao: fechar a venda

Responda APENAS em JSON:
{
  "patches": [
    {
      "conteudo": "instrução clara para o prompt da Luana",
      "problema": "o que aconteceu de errado",
      "patch_type": "objection_handling|argument|flow_fix|tone|discovery",
      "etapa_alvo": "abertura|entendimento|recomendacao|fechamento|all",
      "fonte": "telefone do lead"
    }
  ],
  "insights": [
    {
      "categoria": "objecao|argumento|fluxo|discovery|churn|conversao",
      "etapa_funil": "abertura|entendimento|recomendacao|fechamento|all",
      "trigger_padrao": "o que o lead disse ou fez (ex: 'tá caro', 'não quero', 'legal')",
      "resposta_ideal": "a melhor resposta que a Luana deveria dar",
      "contexto": "situação em que isso acontece",
      "score": 1-10 (relevância),
      "fonte_lead": "telefone do lead que gerou o insight"
    }
  ],
  "gargalo_principal": "etapa com maior problema e por quê",
  "sugestao_estrutural": "sugestão de melhoria do funil"
}
"""

prompt_usuario = f"""
PATCHES JÁ ATIVOS (não duplicar):
{chr(10).join(f"- [{r[1][:40]}] {r[0][:80]}" for r in patches_existentes[:8])}

INSIGHTS JÁ ATIVOS (não duplicar):
{chr(10).join(f"- trigger: {r[0][:40]} → {r[1][:60]}" for r in insights_existentes[:5])}

MÉTRICAS DO FUNIL:
- Total de leads: {total_leads}
- Leads em etapa avançada: {leads_avancados}
- Reuniões agendadas: {reunioes}

DISTRIBUIÇÃO POR ETAPA:
{chr(10).join(f"- {d[0]}: {d[1]} leads" for d in distribuicao)}

TRANSIÇÕES (7 dias):
{chr(10).join(f"- {t[0]} → {t[1]}: {t[2]}x" for t in transicoes) if transicoes else "Nenhuma"}

CONVERSAS RECENTES ({len(contexto_conversas[:8])} de {len(contexto_conversas)}):
"""

for c in contexto_conversas[:8]:
    prompt_usuario += f"\n{'='*60}\n"
    prompt_usuario += f"Lead: {c['nome']} | Etapa: {c['etapa']} | Status: {c['status']} | Origem: {c['origem']} | Negócio: {c['negocio']} | Cidade: {c['cidade']}\n"
    prompt_usuario += f"{'='*60}\n"
    for m in c['mensagens']:
        prompt_usuario += f"{m}\n"

# 6. Chamar GPT
data = json.dumps({
    "model": "gpt-4o-mini",
    "messages": [
        {"role": "system", "content": prompt_sistema},
        {"role": "user", "content": prompt_usuario}
    ],
    "temperature": 0.3,
    "max_tokens": 2500
}).encode()

req = urllib.request.Request(
    "https://api.openai.com/v1/chat/completions",
    data=data,
    headers={"Authorization": f"Bearer {OPENAI_KEY}", "Content-Type": "application/json"}
)

try:
    with urllib.request.urlopen(req, timeout=45) as resp:
        result = json.loads(resp.read())
        resposta = result["choices"][0]["message"]["content"]
        
        # Parse JSON
        try:
            analise = json.loads(resposta)
        except:
            import re
            match = re.search(r'\{.*\}', resposta, re.DOTALL)
            if match:
                analise = json.loads(match.group())
            else:
                print(f"⚠️ Resposta não-JSON: {resposta[:200]}")
                analise = {"patches": [], "insights": []}
        
        patches_novos = analise.get("patches", [])
        insights_novos = analise.get("insights", [])
        gargalo = analise.get("gargalo_principal", "")
        sugestao_estrutural = analise.get("sugestao_estrutural", "")
        
        today = datetime.date.today().isoformat()
        
        # 7. Salvar patches
        novos_patches = 0
        for p in patches_novos:
            conteudo = (p.get("conteudo") or "").strip()
            if not conteudo:
                continue
            ja_existe = any(conteudo[:50] in (e[0] or "")[:50] for e in patches_existentes)
            if ja_existe:
                continue
            
            cur.execute("""
                INSERT INTO prompt_patches 
                (semana, patch_type, trigger, conteudo, ativo, eficacia_score,
                 fonte, problema, sugestao, aplicado, etapa_alvo, created_at)
                VALUES (%s, %s, 'auto', %s, true, 0, %s, %s, %s, true, %s, NOW())
            """, [today, p.get("patch_type", "general"), conteudo,
                  p.get("fonte", "auto"), (p.get("problema") or "")[:300],
                  (p.get("sugestao") or "")[:300], p.get("etapa_alvo", "all")])
            novos_patches += 1
            print(f"  📝 PATCH [{p.get('patch_type','?')}] etapa={p.get('etapa_alvo','?')} → {conteudo[:70]}")
            patches_existentes.append((conteudo, p.get("problema", "")))
        
        # 8. Salvar insights estruturados
        novos_insights = 0
        for ins in insights_novos:
            trigger = (ins.get("trigger_padrao") or "").strip()
            resposta_ideal = (ins.get("resposta_ideal") or "").strip()
            if not trigger or not resposta_ideal:
                continue
            ja_existe = any(trigger[:40] in (e[0] or "")[:40] for e in insights_existentes)
            if ja_existe:
                continue
            
            score = int(ins.get("score", 5))
            score = max(1, min(10, score))
            
            cur.execute("""
                INSERT INTO aprendizado_insights
                (semana, categoria, etapa_funil, trigger_padrao, resposta_ideal,
                 contexto, score, fonte_lead, ativo)
                VALUES (CURRENT_DATE, %s, %s, %s, %s, %s, %s, %s, true)
            """, [ins.get("categoria", "fluxo"), ins.get("etapa_funil", "all"),
                  trigger, resposta_ideal, (ins.get("contexto") or "")[:300],
                  score, (ins.get("fonte_lead") or "auto")])
            novos_insights += 1
            print(f"  💡 INSIGHT [{ins.get('categoria','?')}] etapa={ins.get('etapa_funil','?')} score={score} → trigger: {trigger[:40]}")
            insights_existentes.append((trigger, resposta_ideal))
        
        # 9. Salvar snapshot semanal na aprendizado_luana
        principais_objecoes = "; ".join(set(
            ins.get("trigger_padrao", "")[:30]
            for ins in insights_novos
            if ins.get("categoria") == "objecao"
        ))[:500] or "Nenhuma objeção nova identificada"

        argumentos = "; ".join(set(
            ins.get("resposta_ideal", "")[:50]
            for ins in insights_novos
            if ins.get("categoria") in ("argumento", "conversao")
        ))[:500] or "Nenhum argumento novo"

        cur.execute("""
            INSERT INTO aprendizado_luana
            (semana, total_conversas, total_leads, reunioes_agendadas, taxa_conversao,
             principais_objecoes, argumentos_que_converteram, etapa_maior_abandono,
             insights, prompt_patches, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """, [
            today,
            len(contexto_conversas),
            total_leads,
            reunioes,
            round((leads_avancados / total_leads * 100) if total_leads > 0 else 0, 2),
            principais_objecoes,
            argumentos,
            gargalo[:100] if gargalo else "",
            json.dumps({"novos_insights": novos_insights, "novos_patches": novos_patches}, ensure_ascii=False),
            json.dumps({"sugestao": sugestao_estrutural[:500]}, ensure_ascii=False)
        ])
        
        conn.commit()
        
        print(f"\n{'='*50}")
        print(f"🆕 Patches salvos: {novos_patches}")
        print(f"💡 Insights salvos: {novos_insights}")
        print(f"♻️ Duplicados evitados: {len(patches_novos) - novos_patches + len(insights_novos) - novos_insights}")
        if gargalo:
            print(f"📊 Gargalo: {gargalo[:100]}")
        if sugestao_estrutural:
            print(f"💡 Sugestão: {sugestao_estrutural[:150]}")
        
except Exception as e:
    print(f"❌ Erro GPT: {e}")

# 10. Estatísticas finais
cur.execute("SELECT count(*) FROM prompt_patches WHERE ativo = true")
total_patches = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM aprendizado_insights WHERE ativo = true")
total_insights = cur.fetchone()[0]
cur.execute("SELECT count(*) FROM aprendizado_luana")
total_snapshots = cur.fetchone()[0]

print(f"\n📈 Total: {total_patches} patches | {total_insights} insights | {total_snapshots} snapshots")
cur.close()
conn.close()
