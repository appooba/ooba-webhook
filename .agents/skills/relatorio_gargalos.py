#!/usr/bin/env python3
"""
Skill: Relatório de Gargalos do Funil — Luana Vendas
Analisa onde os leads estão parando em cada etapa do funil de vendas.
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

print("📊 RELATÓRIO DE GARGALOS DO FUNIL — OOBA")
print(f"Data: {datetime.datetime.now().strftime('%d/%m/%Y %H:%M')}")
print("=" * 55)

total_leads = sum(r[1] for r in dist)
print(f"\nTotal de leads: {total_leads}\n")
print("DISTRIBUIÇÃO POR ETAPA:")
print("-" * 40)

etapas_ordem = ['abertura', 'entendimento', 'educacao', 'recomendacao', 'materiais', 'proposta', 'fechamento', 'reuniao', 'fechado']
etapas_nomes = {
    'abertura': '1. Abertura',
    'entendimento': '2. Entendimento',
    'educacao': '3. Educação',
    'recomendacao': '4. Catálogo/Recomendação',
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
    print(f"  {nome:30s} {bar} {count:3d} ({pct:.0f}%)")

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
    print("-" * 55)
    for t in transicoes:
        de = t[0] or "inicio"
        para = t[1]
        count = t[2]
        tempo = t[3]
        tempo_str = f"{int(tempo/60)}min" if tempo and tempo > 60 else f"{int(tempo)}s" if tempo else "?"
        print(f"  {de:20s} → {para:20s}  {count:3d}x  tempo méd: {tempo_str}")

# 3. Calcular taxa de conversão entre etapas
print(f"\n\nTAXA DE AVANÇO POR ETAPA:")
print("-" * 55)

for i, etapa in enumerate(etapas_ordem[:-1]):
    na_etapa = dist_dict.get(etapa, 0)
    proxima = etapas_ordem[i+1] if i+1 < len(etapas_ordem) else None
    
    # Contar quantos avançaram dessa etapa
    cur.execute("""
        SELECT COUNT(DISTINCT phone) FROM funil_transicoes 
        WHERE etapa_anterior = %s
    """, [etapa])
    avancaram = cur.fetchone()[0] or 0
    
    # Contar quantos chegaram nessa etapa (tem registro ou estão nela agora)
    cur.execute("""
        SELECT COUNT(DISTINCT phone) FROM (
            SELECT phone FROM leads WHERE etapa_funil = %s OR etapa_anterior = %s
            UNION
            SELECT phone FROM funil_transicoes WHERE etapa_anterior = %s OR etapa_nova = %s
        ) t
    """, [etapa, etapa, etapa, etapa])
    chegaram = cur.fetchone()[0] or 0
    
    taxa = (avancaram / chegaram * 100) if chegaram > 0 else 0
    gargalo = " ⚠️ GARGALO" if taxa < 30 and chegaram > 0 else ""
    nome = etapas_nomes.get(etapa, etapa)
    print(f"  {nome:30s}  {avancaram}/{chegaram} avançaram ({taxa:.0f}%){gargalo}")

# 4. Leads estagnados (sem progressão há mais de 2 dias)
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
    print("-" * 55)
    for e in estagnados:
        dias = int(e[4]) if e[4] else 0
        print(f"  {e[1] or '?':20s} | {e[2]:20s} | {dias}d parado")

# 5. Patches ativos
cur.execute("SELECT count(*) FROM prompt_patches WHERE ativo = true")
patches = cur.fetchone()[0]
print(f"\n\n🧠 PATCHES DE APRENDIZADO ATIVOS: {patches}")

# 6. Recomendações automáticas
print(f"\n\n💡 RECOMENDAÇÕES:")
print("-" * 55)

# Identificar maior gargalo
gargalos = []
for i, etapa in enumerate(etapas_ordem[:-1]):
    cur.execute("""
        SELECT COUNT(DISTINCT phone) FROM funil_transicoes WHERE etapa_anterior = %s
    """, [etapa])
    avancaram = cur.fetchone()[0] or 0
    cur.execute("""
        SELECT COUNT(DISTINCT phone) FROM (
            SELECT phone FROM leads WHERE etapa_funil = %s OR etapa_anterior = %s
            UNION
            SELECT phone FROM funil_transicoes WHERE etapa_anterior = %s OR etapa_nova = %s
        ) t
    """, [etapa, etapa, etapa, etapa])
    chegaram = cur.fetchone()[0] or 0
    taxa = (avancaram / chegaram * 100) if chegaram > 0 else 100
    if taxa < 50:
        gargalos.append((etapa, taxa, chegaram, avancaram))

if gargalos:
    for g in sorted(gargalos, key=lambda x: x[1]):
        nome = etapas_nomes.get(g[0], g[0])
        print(f"  • {nome}: apenas {g[1]:.0f}% avançam ({g[3]}/{g[2]})")
        print(f"    → Investigar objeções nesta etapa e gerar patch específico")
else:
    print("  • Sem gargalos críticos detectados (poucos dados ainda)")
    print(f"  • Continue conversando com leads pra acumular dados")

print(f"\n{'='*55}")
print(f"Próxima análise automática em 6h")

cur.close()
conn.close()
