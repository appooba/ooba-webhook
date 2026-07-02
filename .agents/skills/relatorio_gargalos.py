#!/usr/bin/env python3
"""
Skill: Relatório de Gargalos do Funil — Luana Vendas
Analisa onde os leads estão parando em cada etapa do funil de vendas.
Compara com metas definidas e benchmarks de mercado.
"""
import os, json, psycopg2, datetime

DB_URL = os.environ.get("DATABASE_URL", "")

if not DB_URL:
    print("❌ DATABASE_URL não configurado")
    exit(1)

conn = psycopg2.connect(DB_URL, sslmode="require")
cur = conn.cursor()

# 1. Distribuição atual dos leads por etapa
cur.execute("""
    SELECT etapa_funil, COUNT(*) as total 
    FROM leads 
    GROUP BY etapa_funil 
    ORDER BY CASE 
        WHEN etapa_funil = 'abertura' THEN 1
        WHEN etapa_funil = 'entendimento' THEN 2
        WHEN etapa_funil = 'educacao' THEN 3
        WHEN etapa_funil = 'recomendacao' THEN 4
        WHEN etapa_funil = 'materiais' THEN 5
        WHEN etapa_funil = 'proposta' THEN 6
        WHEN etapa_funil = 'fechamento' THEN 7
        WHEN etapa_funil = 'reuniao' THEN 8
        WHEN etapa_funil = 'fechado' THEN 9
        ELSE 99
    END
""")
dist = cur.fetchall()

total_leads = sum(r[1] for r in dist)

# Determinar fase atual baseada no total de leads
if total_leads <= 20:
    fase_atual = "Fase 1 (0-20 leads)"
elif total_leads <= 50:
    fase_atual = "Fase 2 (20-50 leads)"
else:
    fase_atual = "Fase 3 (50+ leads)"

print("📊 RELATÓRIO DE GARGALOS DO FUNIL — OOBA MÍDIA INDOOR")
print(f"Data: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}")
print(f"Fase atual: {fase_atual}")
print("=" * 60)

print(f"\nTotal de leads: {total_leads}\n")
print("DISTRIBUIÇÃO POR ETAPA:")
print("-" * 45)

etapas_ordem = ['abertura', 'entendimento', 'educacao', 'recomendacao', 'materiais', 'proposta', 'fechamento', 'reuniao', 'fechado']
etapas_nomes = {
    'abertura': '1. Abertura',
    'entendimento': '2. Entendimento',
    'educacao': '3. Educação',
    'recomendacao': '4. Catálogo/Recomend.',
    'materiais': '5. Materiais',
    'proposta': '6. Proposta/Valores',
    'fechamento': '7. Fechamento',
    'reuniao': '8. Reunião',
    'fechado': '9. Fechado ✅'
}

dist_dict = {r[0]: r[1] for r in dist}
for etapa in etapas_ordem:
    count = dist_dict.get(etapa, 0)
    pct = (count / total_leads * 100) if total_leads > 0 else 0
    bar = "█" * int(pct / 5) + "░" * (20 - int(pct / 5))
    nome = etapas_nomes.get(etapa, etapa)
    print(f"  {nome:25s} {bar} {count:3d} ({pct:.0f}%)")

# 2. Transições registradas
cur.execute("""
    WITH tempos AS (
        SELECT phone, etapa_anterior, etapa_nova, created_at,
               EXTRACT(EPOCH FROM (created_at - LAG(created_at) OVER (PARTITION BY phone ORDER BY created_at))) as tempo_seg
        FROM funil_transicoes
        WHERE created_at > NOW() - INTERVAL '30 days'
    )
    SELECT etapa_anterior, etapa_nova, COUNT(*) as total,
           AVG(tempo_seg) as tempo_medio_seg
    FROM tempos
    WHERE tempo_seg IS NOT NULL
    GROUP BY etapa_anterior, etapa_nova
    ORDER BY COUNT(*) DESC
""")
transicoes = cur.fetchall()

if transicoes:
    print(f"\n\nTRANSIÇÕES REGISTRADAS (últimos 30 dias):")
    print("-" * 60)
    for t in transicoes:
        de = t[0] or "inicio"
        para = t[1]
        count = t[2]
        tempo = t[3]
        tempo_str = f"{int(tempo/3600)}h" if tempo and tempo > 3600 else f"{int(tempo/60)}min" if tempo and tempo > 60 else f"{int(tempo)}s" if tempo else "?"
        print(f"  {de:20s} → {para:20s}  {count:3d}x  tempo méd: {tempo_str}")

# 3. Buscar metas da fase atual
cur.execute("""
    SELECT etapa, meta_percentual, benchmark_mercado, observacao
    FROM funil_metas WHERE ativa = true AND fase = %s
    ORDER BY etapa
""", [fase_atual])
metas = {r[0]: {"meta": float(r[1]), "benchmark": float(r[2]), "obs": r[3]} for r in cur.fetchall()}

# 4. Taxa de avanço por etapa + comparação com metas
print(f"\n\nTAXA DE AVANÇO POR ETAPA — META vs. REAL vs. MERCADO:")
print("-" * 70)
print(f"  {'Etapa':25s} {'Real':>8s} {'Meta':>8s} {'Mercado':>8s}  Status")
print("-" * 70)

gargalos = []
for i, etapa in enumerate(etapas_ordem[:-1]):
    # Contar quantos avançaram dessa etapa
    cur.execute("""
        SELECT COUNT(DISTINCT phone) FROM funil_transicoes 
        WHERE etapa_anterior = %s
    """, [etapa])
    avancaram = cur.fetchone()[0] or 0
    
    # Contar quantos chegaram nessa etapa
    cur.execute("""
        SELECT COUNT(DISTINCT phone) FROM (
            SELECT phone FROM leads WHERE etapa_funil = %s OR etapa_anterior = %s
            UNION
            SELECT phone FROM funil_transicoes WHERE etapa_anterior = %s OR etapa_nova = %s
        ) t
    """, [etapa, etapa, etapa, etapa])
    chegaram = cur.fetchone()[0] or 0
    
    taxa = (avancaram / chegaram * 100) if chegaram > 0 else 0
    nome = etapas_nomes.get(etapa, etapa)
    
    meta = metas.get(etapa, {}).get("meta", 0)
    benchmark = metas.get(etapa, {}).get("benchmark", 0)
    
    if chegaram == 0:
        status = "⚪ sem dados"
    elif taxa >= meta:
        status = "✅ na meta"
    elif taxa >= meta * 0.5:
        status = "🟡 abaixo da meta"
    else:
        status = "🔴 crítico"
        gargalos.append((etapa, taxa, chegaram, avancaram, meta))
    
    print(f"  {nome:25s} {taxa:>7.0f}% {meta:>7.0f}% {benchmark:>7.0f}%  {status}")

# 5. Leads estagnados (sem progressão há mais de 2 dias)
cur.execute("""
    SELECT phone, nome, etapa_funil, updated_at,
           EXTRACT(EPOCH FROM (NOW() - updated_at))/86400 as dias_parado
    FROM leads 
    WHERE etapa_funil NOT IN ('fechado', 'perdido')
      AND updated_at < NOW() - INTERVAL '2 days'
    ORDER BY updated_at ASC
""")
estagnados = cur.fetchall()

if estagnados:
    print(f"\n\n⚠️ LEADS ESTAGNADOS (2+ dias sem progressão):")
    print("-" * 60)
    for e in estagnados:
        dias = int(e[4]) if e[4] else 0
        print(f"  {e[1] or '?':20s} | {e[2]:20s} | {dias}d parado")

# 6. Patches ativos
cur.execute("SELECT count(*) FROM prompt_patches WHERE ativo = true")
patches = cur.fetchone()[0]
print(f"\n\n🧠 PATCHES DE APRENDIZADO ATIVOS: {patches}")

# 7. Recomendações automáticas
print(f"\n\n💡 RECOMENDAÇÕES:")
print("-" * 60)

if gargalos:
    for g in sorted(gargalos, key=lambda x: x[1]):
        nome = etapas_nomes.get(g[0], g[0])
        meta_val = g[4]
        print(f"  • {nome}: {g[1]:.0f}% real vs {meta_val:.0f}% meta ({g[3]}/{g[2]} avançaram)")
        obs = metas.get(g[0], {}).get("obs", "")
        if obs:
            print(f"    → {obs}")
else:
    if total_leads < 20:
        print(f"  • Fase 1 — acumular dados. Meta: 15% na Abertura com 20 leads")
        print(f"  • Leads atuais: {total_leads}/20")
    else:
        print("  • Sem gargalos críticos detectados")

# 8. Progresso geral
print(f"\n\n📈 PROGRESSO GERAL:")
print("-" * 60)

# Calcular conversão total observada
fechados = dist_dict.get('fechado', 0)
conversao_total = (fechados / total_leads * 100) if total_leads > 0 else 0
print(f"  Conversão total (lead → fechado): {conversao_total:.1f}%")
print(f"  Benchmark mercado (B2B inbound): 2.5%")
print(f"  Benchmark mercado (prospecção fria): 0.5-1.5%")

# Projeção
if total_leads > 0 and total_leads <= 20:
    print(f"\n  PROJEÇÃO FASE 1:")
    print(f"  Com 20 leads e meta de 0.18% conversão: ~0 vendas esperadas")
    print(f"  Com 20 leads e benchmark (2.5%): ~0.5 vendas")
    print(f"  ⚠️ Prospecção fria em volume baixo NÃO deve gerar vendas ainda")
    print(f"  Foco deve ser: melhorar taxa de resposta (Abertura → Entendimento)")
elif total_leads > 20:
    print(f"\n  PROJEÇÃO ATUAL:")
    print(f"  Com {total_leads} leads e meta de {fase_atual}: ver resultado")
    print(f"  Para 1 venda: precisar de ~190 leads (Fase 2) ou ~93 (Fase 3)")

print(f"\n  PRÓXIMA META:")
if total_leads < 20:
    print(f"  → Atingir 20 leads e conseguir 15% de resposta na Abertura (3 leads)")
elif total_leads < 50:
    print(f"  → Atingir 50 leads e melhorar Abertura para 20% (10 leads)")
else:
    print(f"  → Atingir benchmark de mercado (25% na Abertura)")

print(f"\n{'='*60}")
print(f"Próxima análise automática: a cada 6h")
print(f"Auditoria completa: segundas-feiras 08h")

cur.close()
conn.close()
