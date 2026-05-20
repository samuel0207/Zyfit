import os
from sqlalchemy import create_engine

url = "postgresql://postgres.vcvvqxnsorwzyxyoivua:153624zyfit22@aws-0-us-east-2.pooler.supabase.com:6543/postgres"
print("Testando conexão com o pooler us-east-2...")
try:
    engine = create_engine(url)
    conn = engine.connect()
    print("✅ SUCESSO: Conexão com o pooler do Supabase us-east-2 estabelecida perfeitamente!")
    conn.close()
except Exception as e:
    print("❌ FALHA:", e)
